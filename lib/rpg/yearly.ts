// The yearly calendar: birthdays, anniversaries, New Year and festivals.
//
// Rules (living-world Stage 2):
// - At most one yearly offer per turn, never in a fight, each one once a year.
// - The player only knows the birthdays they plausibly would: the people they
//   are close to (or were), and those they learned in the story.
// - Birthdays come up mostly when the person is in the scene; sometimes the player
//   thinks of a close person who is far away (rarer). The dead get
//   remembrance days.
// - The player's own hard days come first: the day someone close to them died.
// - Festivals (the world's own, `db.world.festivals`) only when the player is
//   in or near where they are held.
// - Offered, never forced: the narrator gets one line.

import { daysFromCivil, entityAge, isLeapYear } from './calendar';
import { playerAge } from './player';
import { displayName, narratorName } from './names';
import { isCombatPace } from './timeline';
import { castWithCompanions } from './companions';
import { isDeceased, playerKnowsDeath } from './deaths';
import { resolveEntity } from './entities';
import type { AppDatabase, BondRecord, CalendarDate, EntityRecord, FestivalDef, TurnDiff, YearlyState } from './types';
import { isPlayerEntity } from './player';

export type BirthdayHabitKind = 'announces' | 'hides' | 'hates' | 'ritual' | 'quiet';

export type BirthdayHabit = { kind: BirthdayHabitKind; note: string };

const CLOSE_STAGES = new Set(['close', 'old friend', 'family', 'romantic interest', 'lover']);
/** Affinity at which a bond is close enough to know (or be told) a birthday. */
const CLOSE_AFFINITY = 6;

export type YearlyOffer = {
  /** Unique per kind and person; offered at most once a year. */
  key: string;
  kind: 'anniversary' | 'player-birthday' | 'birthday' | 'birthday-unknown' | 'birthday-absent' | 'remembrance' | 'festival' | 'new-year';
  /** The one line the narrator gets. */
  line: string;
  /** Who it is about, for the state tracker. */
  entity?: EntityRecord;
};

export function yearlyOf(db: AppDatabase): YearlyState {
  const yearly = db.state.yearly;

  return {
    knownBirthdays: Array.isArray(yearly?.knownBirthdays) ? yearly.knownBirthdays.filter(Boolean) : [],
    offered: yearly?.offered && typeof yearly.offered === 'object' ? yearly.offered : {},
  };
}

export function normalizeYearly(raw: unknown): YearlyState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<YearlyState>;

  return {
    knownBirthdays: Array.isArray(value.knownBirthdays) ? value.knownBirthdays.filter((id) => typeof id === 'string') : [],
    offered:
      value.offered && typeof value.offered === 'object'
        ? Object.fromEntries(Object.entries(value.offered).filter(([, year]) => typeof year === 'number'))
        : {},
  };
}

export function birthdayHabit(_entity: Pick<EntityRecord, 'name'>): BirthdayHabit {
  return { kind: 'quiet', note: 'lets the day pass unless someone remembers' };
}

/** The world's festivals. */
export function festivalsOf(db: Pick<AppDatabase, 'world'>): FestivalDef[] {
  return Array.isArray(db.world?.festivals) ? db.world.festivals : [];
}

/** The day someone's birthday falls on this year: a leap-day birthday is kept on Feb 28 otherwise. */
export function birthdayThisYear(birthday: { month: number; day: number }, year: number) {
  return birthday.month === 2 && birthday.day === 29 && !isLeapYear(year) ? { month: 2, day: 28 } : birthday;
}

function isToday(date: CalendarDate, day: { month: number; day: number }) {
  const shown = birthdayThisYear(day, date.year);
  return date.month === shown.month && date.day === shown.day;
}

function bondOf(db: AppDatabase, entityId: string): BondRecord | null {
  return db.bonds.find((bond) => bond.entityId === entityId) ?? null;
}

/** Close to the player now, or before they died: a strong bond or a close relationship. */
export function isClose(db: AppDatabase, entity: EntityRecord) {
  const bond = bondOf(db, entity.id);
  return Boolean(bond && (bond.affinity >= CLOSE_AFFINITY || CLOSE_STAGES.has(bond.relationship ?? '')));
}

/** The player knows this birthday: someone they are (or were) close to, or one they learned in the story. */
export function knowsBirthday(db: AppDatabase, entity: EntityRecord) {
  if (!entity.birthday || entity.met === false || isPlayerEntity(entity)) return false;
  return isClose(db, entity) || yearlyOf(db).knownBirthdays.includes(entity.id);
}

function sceneIds(db: AppDatabase): Set<string> {
  const ids = new Set<string>();

  for (const name of castWithCompanions(db, db.state.sceneCast ?? [])) {
    const entity = resolveEntity(db, name);
    if (entity) ids.add(entity.id);
  }

  return ids;
}

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function yearsSince(year: number, now: CalendarDate) {
  const years = now.year - year;
  return years === 1 ? 'one year' : `${years} years`;
}

function ageOn(db: AppDatabase, entity: EntityRecord) {
  return entity.birthYear !== undefined ? entityAge(db.state.inStoryDate, entity) : undefined;
}

function turns(age: number | undefined) {
  return age !== undefined ? ` (${age} today)` : '';
}

/** The player is in or near a place: its words appear in the location. */
function nearPlace(db: AppDatabase, words: string[]) {
  const location = db.state.location.toLowerCase();
  return words.length === 0 || words.some((word) => word.trim().length > 0 && location.includes(word.trim().toLowerCase()));
}

function festivalToday(festival: FestivalDef, now: CalendarDate) {
  const start = daysFromCivil(now.year, festival.month, festival.day);
  const today = daysFromCivil(now.year, now.month, now.day);
  return today >= start && today < start + (festival.days ?? 1);
}

// ---------------------------------------------------------------------------
// What could come up today, most important first.

function playerAnniversaries(db: AppDatabase): YearlyOffer[] {
  const now = db.state.inStoryDate;
  const offers: YearlyOffer[] = [];

  // The day someone close to the player died, once the player knows it.
  for (const entity of db.entities) {
    const died = entity.deceased?.date;

    if (entity.type !== 'character' || isPlayerEntity(entity) || !died || !isClose(db, entity)) continue;
    if (!playerKnowsDeath(db, entity) || now.year <= died.year || !isToday(now, died)) continue;

    offers.push({
      key: `anniversary:death:${entity.id}`,
      kind: 'anniversary',
      entity,
      line: `Today is ${yearsSince(died.year, now)} since ${narratorName(db, entity)} died. A quiet, heavy day; a visit to the grave fits if you are near.`,
    });
  }

  if (db.state.player.birthday && isToday(now, db.state.player.birthday)) {
    const here = sceneIds(db);
    const rememberers = db.entities
      .filter(
        (entity) =>
          entity.type === 'character' &&
          !isPlayerEntity(entity) &&
          entity.met !== false &&
          !isDeceased(entity) &&
          isClose(db, entity)
      )
      .sort((a, b) => Number(here.has(b.id)) - Number(here.has(a.id)) || (bondOf(db, b.id)?.affinity ?? 0) - (bondOf(db, a.id)?.affinity ?? 0))
      .slice(0, 3);
    const present = rememberers.filter((entity) => here.has(entity.id)).map((entity) => narratorName(db, entity));
    const far = rememberers.filter((entity) => !here.has(entity.id)).map((entity) => narratorName(db, entity));
    const who = [
      present.length ? `${present.join(' and ')} (here) might remember` : '',
      far.length ? `${far.join(' and ')} might send word from far away` : '',
    ]
      .filter(Boolean)
      .join('; ');
    const age: number | undefined = playerAge(db);
    const views: string[] = [];

    offers.push({
      key: 'player-birthday',
      kind: 'player-birthday',
      line: `Today is your birthday${age !== undefined ? `: you are ${age}` : ''}. ${who ? `${who}.` : 'Nobody close enough to remember is near.'}${views.length ? ` If it came out: ${views.join('; ')}.` : ''} Most people do not know the date; you never announce it.`,
    });
  }

  return offers;
}

function birthdays(db: AppDatabase): YearlyOffer[] {
  const now = db.state.inStoryDate;
  const here = sceneIds(db);
  const present: YearlyOffer[] = [];
  const remembrance: YearlyOffer[] = [];
  const absent: YearlyOffer[] = [];

  for (const entity of db.entities) {
    if (entity.type !== 'character' || isPlayerEntity(entity) || !entity.birthday || entity.met === false) continue;
    if (!isToday(now, entity.birthday)) continue;

    const habit = birthdayHabit(entity);
    const knows = knowsBirthday(db, entity);

    if (isDeceased(entity)) {
      // Only the dead the player was close to, and knows are dead.
      if (knows && playerKnowsDeath(db, entity)) {
        remembrance.push({
          key: `remembrance:${entity.id}`,
          kind: 'remembrance',
          entity,
          line: `It would have been ${narratorName(db, entity)}'s birthday today. A remembrance day: a quiet moment of your own, or a visit to the grave if you are near it.${sharedMemoryLine(db, entity)}`,
        });
      }
      continue;
    }

    const age = ageOn(db, entity);

    if (here.has(entity.id)) {
      if (knows) {
        present.push({
          key: `birthday:${entity.id}`,
          kind: 'birthday',
          entity,
          line: `It is ${narratorName(db, entity)}'s birthday today${turns(age)}, and you know it. They ${habit.note}. If it fits, the day can come up; never force it.`,
        });
      } else if (habit.kind === 'announces' || habit.kind === 'ritual') {
        present.push({
          key: `birthday:${entity.id}`,
          kind: 'birthday-unknown',
          entity,
          line: `It is ${narratorName(db, entity)}'s birthday today${turns(age)}, which you do not know. They ${habit.note}, so they may let it slip.`,
        });
      }
      continue;
    }

    // Far away: only people the player is close to, and only some years.
    if (knows && isClose(db, entity) && hash(`${db.meta.slotId}:${entity.id}:${now.year}`) % 2 === 0) {
      absent.push({
        key: `birthday:${entity.id}`,
        kind: 'birthday-absent',
        entity,
        line: `It is ${narratorName(db, entity)}'s birthday today${turns(age)}, far from you. A passing thought of them would fit a quiet moment; a letter sent now would still reach them late.`,
      });
    }
  }

  return [...present, ...remembrance, ...absent];
}

function festivals(db: AppDatabase): YearlyOffer[] {
  const now = db.state.inStoryDate;
  const offers: YearlyOffer[] = [];

  for (const festival of festivalsOf(db)) {
    if (!festivalToday(festival, now) || !nearPlace(db, festival.where)) continue;

    offers.push({
      key: `festival:${festival.id}`,
      kind: 'festival',
      line: `${festival.name.charAt(0).toUpperCase()}${festival.name.slice(1)} is on here${festival.note ? ` (${festival.note})` : ''}. It can colour the scene: crowds, food, lights, people off work.`,
    });
  }

  if (now.month === 1 && now.day === 1) {
    offers.push({
      key: 'new-year',
      kind: 'new-year',
      line:
        db.state.locationKind === 'settlement'
          ? "It is New Year's Day: quiet streets, people sleeping off the night before or keeping the day the way people here do."
          : "It is New Year's Day, even out here.",
    });
  }

  return offers;
}

/** Everything the calendar holds for today, most important first (offered or not). */
/** A flashback the player lived through with someone who is gone, for their remembrance day. */
function sharedMemoryLine(db: AppDatabase, entity: EntityRecord): string {
  const linked = new Set(db.eventEntities.filter((link) => link.entityId === entity.id).map((link) => link.eventId));
  const memory = db.events
    .filter((event) => linked.has(event.id) && event.tags.includes('flashback'))
    .sort((a, b) => b.importance - a.importance)[0];

  return memory ? ` A memory you lived again with them may come back today: ${memory.title ?? memory.scene} (${memory.summary.replace(/\.$/, '')}).` : '';
}

export function yearlyCandidates(db: AppDatabase): YearlyOffer[] {
  const birthdayOffers = birthdays(db);
  const festivalOffers = festivals(db);

  return [
    ...playerAnniversaries(db),
    ...birthdayOffers.filter((offer) => offer.kind === 'birthday' || offer.kind === 'birthday-unknown'),
    ...birthdayOffers.filter((offer) => offer.kind === 'remembrance'),
    ...festivalOffers,
    ...birthdayOffers.filter((offer) => offer.kind === 'birthday-absent'),
  ];
}

/** The one yearly line for this turn, if any: never in a fight, each once a year. */
export function yearlyOffer(db: AppDatabase): YearlyOffer | null {
  if (isCombatPace(db.state.scenePace)) return null;

  const { offered } = yearlyOf(db);
  const year = db.state.inStoryDate.year;

  return yearlyCandidates(db).find((offer) => offered[offer.key] !== year) ?? null;
}

export function formatYearlyBlock(offer: YearlyOffer | null): string {
  return offer ? `THE DAY\n- ${offer.line}` : '';
}

/** What the state tracker needs to know about today's offer. */
export function yearlyTrackingLines(offer: YearlyOffer | null, idOf: (entity: EntityRecord) => string): string[] {
  if (!offer?.entity) return [];

  const id = idOf(offer.entity);

  if (offer.kind === 'birthday') {
    return [
      `It is ${id}'s birthday and you know it. If you mark it on the page (a word, a gift), give ${id} a bonds entry: affinity_change +1, or +2 for a real gift. If you let the day pass beside them without a word, -1.`,
    ];
  }

  if (offer.kind === 'birthday-unknown') {
    return [`It is ${id}'s birthday. If they or anyone tells you on the page, list ${id} in birthdays_learned; if you then mark it, affinity_change +1.`];
  }

  return [];
}

/** After a turn: the offer is spent for the year, and birthdays the player learned are kept. */
export function applyYearly(
  db: AppDatabase,
  offer: YearlyOffer | null,
  learned: TurnDiff['birthdaysLearned']
): AppDatabase {
  const yearly = yearlyOf(db);
  let changed = false;
  const offered = { ...yearly.offered };
  const knownBirthdays = [...yearly.knownBirthdays];

  if (offer) {
    offered[offer.key] = db.state.inStoryDate.year;
    changed = true;
  }

  for (const item of learned ?? []) {
    const entity =
      (item.entityId ? db.entities.find((candidate) => candidate.id === item.entityId) : null) ?? resolveEntity(db, item.name);

    if (entity && !knownBirthdays.includes(entity.id) && entity.birthday) {
      knownBirthdays.push(entity.id);
      changed = true;
    }
  }

  return changed ? { ...db, state: { ...db.state, yearly: { knownBirthdays, offered } } } : db;
}

// ---------------------------------------------------------------------------
// For the screens

export type UpcomingBirthday = {
  entity: EntityRecord;
  /** Days from today (0 = today). */
  inDays: number;
  month: number;
  day: number;
  /** The age they turn, when known. */
  turning?: number;
  dead: boolean;
};

/** Birthdays the player knows in the next `days` days: the living, and the dead they know are gone. */
export function upcomingBirthdays(db: AppDatabase, days = 30): UpcomingBirthday[] {
  const now = db.state.inStoryDate;
  const today = daysFromCivil(now.year, now.month, now.day);
  const out: UpcomingBirthday[] = [];

  for (const entity of db.entities) {
    if (entity.type !== 'character' || !entity.birthday || !knowsBirthday(db, entity)) continue;

    const dead = isDeceased(entity);
    if (dead && !playerKnowsDeath(db, entity)) continue;

    for (const year of [now.year, now.year + 1]) {
      const shown = birthdayThisYear(entity.birthday, year);
      const inDays = daysFromCivil(year, shown.month, shown.day) - today;

      if (inDays >= 0 && inDays <= days) {
        out.push({
          entity,
          inDays,
          month: shown.month,
          day: shown.day,
          turning: !dead && entity.birthYear !== undefined ? year - entity.birthYear : undefined,
          dead,
        });
        break;
      }
    }
  }

  return out.sort((a, b) => a.inDays - b.inDays || a.entity.name.localeCompare(b.entity.name));
}

/** Short notes for the journal: what today is, as far as the player knows. */
export function todayNotes(db: AppDatabase): string[] {
  const now = db.state.inStoryDate;
  const notes: string[] = [];

  if (db.state.player.birthday && isToday(now, db.state.player.birthday)) notes.push('Your birthday');
  if (now.month === 1 && now.day === 1) notes.push("New Year's Day");

  for (const birthday of upcomingBirthdays(db, 0)) {
    notes.push(birthday.dead ? `${displayName(db, birthday.entity)}'s birthday (remembered)` : `${displayName(db, birthday.entity)}'s birthday`);
  }

  for (const festival of festivalsOf(db)) {
    if (festivalToday(festival, now) && nearPlace(db, festival.where)) {
      notes.push(festival.name.charAt(0).toUpperCase() + festival.name.slice(1));
    }
  }

  return notes;
}
