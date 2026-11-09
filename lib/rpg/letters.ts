// Personal letters and messages: the people the player is close to write to
// them, and they can write back. Separate from world news (newsDelivery.ts):
// these are their own words, about their own lives and how they feel about
// the player. "Letter" covers whatever fits the era: a letter by post, a
// courier, an email, a text message.
//
// - Incoming, unprompted: now and then someone the player is close to who is far
//   away (not travelling with them, not in the scene, not seen for a while)
//   writes, by one of the world's carriers. At most one in a few weeks of
//   story time, and each person at most every month and a half. On the player's
//   birthday someone close and far away may write regardless.
// - Outgoing: when the story shows the player send a letter (the state tracker's
//   letters_sent), it travels for as long as the distance and the carrier
//   take (geography.ts). When it arrives the bond moves, the recipient
//   remembers it, and they write back: the reply sets out and reaches the player
//   some days later.
// - Letters are kept: the archive holds the player's own words (the player writes
//   them; only spelling and punctuation are tidied) and the words the
//   narrator gave each writer.
// - The road is real: a faction that reads mail (`readsMail`) or wants the
//   player can read a letter on the way (an interception plants a delayed
//   consequence, consequences.ts), and a letter can be lost: it went astray,
//   the reader moved on or died first. Codes and hand delivery are safer.
// - Letters to the dead are never sent; they are kept.
// - Delivery is always on the page: the narrator is offered the letter
//   (A LETTER FOR YOU) and the state tracker marks it received
//   (letters_received). Nothing ever arrives as an app notification.
//
// Everything is deterministic per save, person and day, so a regenerate gets
// the same offer and the same road.

import { applyBondDiff } from './bonds';
import { displayName, displayNameOf } from './names';
import { daysBetween, dateSortValue, shiftDate } from './calendar';
import { isCombatPace } from './pacing';
import { castWithCompanions } from './companions';
import { plantSeed } from './consequences';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { applyFactDiff } from './facts';
import { regionOf, travelDaysBetween, whereaboutsRegion, type Region } from './geography';
import { makeId } from './id';
import { markLifeKnown, newsOfTheirLife } from './lives';
import { factionById, factionName, factionsOf, territoryOf, wantedListings } from './reputation';
import { clamp, hashText } from './util';
import type {
  AppDatabase,
  BondRecord,
  CalendarDate,
  EntityRecord,
  Interceptor,
  Letter,
  LetterCarrierKind,
  PostState,
  TurnDiff,
} from './types';
import { isPlayerEntity } from './player';

/** A letter is on the road at least / at most this many days. */
export const LETTER_MIN_DAYS = 1;
export const LETTER_MAX_DAYS = 21;
/** When nobody knows where either side is: the old 3-9 days. */
const UNKNOWN_MIN_DAYS = 3;
const UNKNOWN_SPREAD_DAYS = 7;

/** No unprompted letter until this many days after the last one reached the player. */
export const LETTER_GAP_DAYS = 21;

/** The same person writes unprompted at most this often. */
export const LETTER_PER_PERSON_DAYS = 45;

/** They must not have seen the player for this long to write unprompted. */
export const LETTER_MIN_DAYS_APART = 10;

/** Affinity at which someone cares enough to write unprompted. */
export const LETTER_MIN_AFFINITY = 5;

/** The player's letter arriving lifts the bond this much (half for someone cold toward them). */
export const LETTER_BOND_GAIN = 2;

/** Below this they read it but do not answer. */
export const LETTER_REPLY_FLOOR = -3;

/** A birthday letter: a birthday letter the player writes counts if sent this close to the day. */
const BIRTHDAY_LETTER_DAYS = 3;

/** Letters kept in the archive with their words / without. */
const ARCHIVE_WITH_TEXT = 200;
const ARCHIVE_WITHOUT_TEXT = 40;

const CLOSE_STAGES = new Set(['close', 'old friend', 'family', 'partner', 'mentor', 'romantic interest', 'lover']);

/** Turns a letter, once offered, may wait before the offer is pressed. */
const LETTER_LINGER_DAYS = 5;

export function postOf(db: AppDatabase): PostState {
  return db.state.post ?? { letters: [] };
}

function withPost(db: AppDatabase, post: PostState): AppDatabase {
  return { ...db, state: { ...db.state, post } };
}

const STATUSES = new Set(['travelling', 'delivered', 'lost', 'unsent']);

export function normalizePost(raw: unknown): PostState | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const value = raw as Partial<PostState>;
  const letters = Array.isArray(value.letters)
    ? value.letters.filter(
        (letter): letter is Letter =>
          Boolean(letter) &&
          typeof letter.id === 'string' &&
          (letter.direction === 'to-player' || letter.direction === 'from-player') &&
          typeof letter.entityId === 'string' &&
          STATUSES.has(letter.status) &&
          Boolean(letter.sentOn) &&
          Boolean(letter.arrivesOn)
      )
    : [];

  // Keep the post small: everything still travelling, the archive of
  // letters with their words, and the last few without.
  const travelling = letters.filter((letter) => letter.status === 'travelling');
  const done = letters.filter((letter) => letter.status !== 'travelling');
  const withText = new Set(done.filter((letter) => letter.text).slice(-ARCHIVE_WITH_TEXT).map((letter) => letter.id));
  const withoutText = new Set(done.filter((letter) => !letter.text).slice(-ARCHIVE_WITHOUT_TEXT).map((letter) => letter.id));

  return {
    letters: [...done.filter((letter) => withText.has(letter.id) || withoutText.has(letter.id)), ...travelling],
    ...(value.lastLetterIn ? { lastLetterIn: value.lastLetterIn } : {}),
  };
}

function bondOf(db: AppDatabase, entityId: string): BondRecord | null {
  return db.bonds.find((bond) => bond.entityId === entityId) ?? null;
}

function inScene(db: AppDatabase): Set<string> {
  const ids = new Set<string>();

  for (const name of castWithCompanions(db, db.state.sceneCast ?? [])) {
    const entity = resolveEntity(db, name);

    if (entity) ids.add(entity.id);
  }

  return ids;
}

/** A roll that is the same for the same letter on the same day: 0-99. */
function roll(db: AppDatabase, ...parts: string[]) {
  return hashText([db.meta.slotId, ...parts].join(':')) % 100;
}

function dayKey(date: CalendarDate) {
  return `${date.year}-${date.month}-${date.day}`;
}

export function playerRegion(db: AppDatabase): Region | null {
  return regionOf(db, db.state.location) ?? regionOf(db, db.state.scene);
}

// ---------------------------------------------------------------------------
// How a letter travels

export type CarrierSpeed = 'instant' | 'fast' | 'normal' | 'slow';

/** How fast a carrier is, from its name: a text arrives at once, a ship takes its time. */
export function carrierSpeed(carrier: LetterCarrierKind | undefined): CarrierSpeed {
  const name = (carrier ?? '').toLowerCase();

  if (/\b(phone|text|sms|e-?mail|message|messag|call|radio|telegra|dm|chat|video|voicemail|app)\b/.test(name)) return 'instant';
  if (/\b(express|rider|pigeon|bird|raven|hawk|drone|telex)\b/.test(name)) return 'fast';
  if (/\b(ship|boat|caravan|dead[- ]drop|sea mail|surface mail)\b/.test(name)) return 'slow';
  return 'normal';
}

/** Travel days times this: how fast each kind of carrier is. */
const SPEED_FACTOR: Record<CarrierSpeed, number> = { instant: 0, fast: 0.5, normal: 1.2, slow: 1.8 };

/** The carriers this person would use: their faction's own, else the world's. */
function carriersFor(db: AppDatabase, entity: EntityRecord): string[] {
  for (const faction of factionsOf(db)) {
    if (entity.tags.includes(faction.id) && faction.carriers?.length) return faction.carriers;
  }

  const world = db.world?.letterCarriers ?? [];

  return world.length > 0 ? world : ['courier'];
}

function carrierOf(db: AppDatabase, entity: EntityRecord): LetterCarrierKind {
  const carriers = carriersFor(db, entity);

  return carriers[hashText(entity.id) % carriers.length];
}

/** How a letter from this person reaches the player, in words ("text message"). */
export function letterCarrier(db: AppDatabase, entity: EntityRecord): string {
  return carrierOf(db, entity);
}

/** Days on the road between two regions for this carrier, fixed by its seed. */
export function letterDays(
  db: AppDatabase,
  from: Region | null,
  to: Region | null,
  carrier: LetterCarrierKind,
  seed: string
): number {
  const speed = carrierSpeed(carrier);

  if (speed === 'instant') return 0;

  const jitter = hashText(seed) % 3;

  if (!from || !to) {
    return UNKNOWN_MIN_DAYS + (hashText(seed) % UNKNOWN_SPREAD_DAYS);
  }

  const days = Math.round(travelDaysBetween(db, from, to) * SPEED_FACTOR[speed]) + jitter;

  return clamp(days, LETTER_MIN_DAYS, LETTER_MAX_DAYS);
}

/** Days on the road for one letter when nobody knows where anyone is (older callers). */
export function travelDays(db: AppDatabase, seed: string) {
  return letterDays(db, null, null, 'courier', seed);
}

// ---------------------------------------------------------------------------
// The road: who reads it, and why it never arrives

const SAFETY: Partial<Record<string, number>> = { hand: 0.2 };

/**
 * Who might read a letter between the player and this person, with the chance
 * in percent: a faction that reads mail (`readsMail`, 0-1) on whose ground
 * either end is, and a faction that wants the player whose ground the letter
 * crosses.
 */
export function interceptionRisks(
  db: AppDatabase,
  entity: EntityRecord,
  carrier: LetterCarrierKind,
  coded: boolean
): { who: Interceptor; chance: number }[] {
  const risks: { who: Interceptor; chance: number }[] = [];
  const theirs = territoryOf(db, entity.whereabouts ?? entity.lastSeenAt ?? '');
  const mine = territoryOf(db, `${db.state.location} ${db.state.scene ?? ''}`);
  const listings = wantedListings(db);

  for (const faction of factionsOf(db)) {
    const onTheirGround = faction.id === theirs?.id || faction.id === mine?.id;

    if (!onTheirGround || entity.tags.includes(faction.id)) continue;

    const reads = typeof faction.readsMail === 'number' ? Math.max(0, Math.min(1, faction.readsMail)) : 0;
    const wanted = listings.find((item) => item.factionId === faction.id);
    const chance = Math.round(reads * 30) + (wanted ? 6 + { noted: 0, wanted: 4, high: 8, top: 12 }[wanted.level] : 0);

    if (chance > 0) risks.push({ who: faction.id, chance });
  }

  const safety = (SAFETY[carrier] ?? 1) * (coded ? 0.5 : 1);

  return risks.map((risk) => ({ ...risk, chance: Math.round(risk.chance * safety) }));
}

function interceptorName(db: AppDatabase, who: Interceptor) {
  return factionName(db, who);
}

/** Reads a letter on the way, perhaps. Returns the letter and the save (with a seed planted). */
function crossTheRoad(db: AppDatabase, letter: Letter, entity: EntityRecord): { db: AppDatabase; letter: Letter } {
  const carrier = letter.carrier ?? 'courier';

  for (const risk of interceptionRisks(db, entity, carrier, letter.coded === true)) {
    if (roll(db, 'intercept', risk.who, entity.name, dayKey(letter.sentOn), letter.direction) >= risk.chance) continue;

    const towards = letter.direction === 'from-player' ? `your letter to ${entity.name}` : `${entity.name}'s letter to you`;
    const seized = carrierSpeed(carrier) !== 'instant' && roll(db, 'seized', entity.name, dayKey(letter.sentOn)) < 34;
    const name = interceptorName(db, risk.who);
    const next = plantSeed(db, {
      kind: 'intercepted',
      who: name,
      what: `${name} read ${towards}${letter.gist ? ` (${letter.gist})` : ''} on its way`,
      want: 'to find you through it, or to learn what you know',
      witnesses: [entity.id],
      faction: factionById(db, risk.who) ? risk.who : undefined,
      region: whereaboutsRegion(db, entity) ?? undefined,
      letterId: letter.id,
      when: 'weeks',
    });

    return {
      db: next,
      letter: {
        ...letter,
        interceptedBy: risk.who,
        ...(seized ? { status: 'lost' as const, lostReason: 'it was taken on the way' } : {}),
      },
    };
  }

  return { db, letter };
}

/** Why this letter never arrives, or null. Rolled once, when it is due. */
function lossOnTheRoad(db: AppDatabase, letter: Letter, entity: EntityRecord): string | null {
  if (letter.carrier === 'hand') return null;

  const days = Math.max(0, daysBetween(letter.sentOn, letter.arrivesOn));
  const speed = carrierSpeed(letter.carrier ?? 'courier');
  const base: Record<CarrierSpeed, number> = { instant: 1, fast: 3, normal: 4, slow: 3 };
  const chance = base[speed] + Math.floor(days / 2);

  if (roll(db, 'loss', letter.name, dayKey(letter.sentOn), letter.direction) < chance) {
    return speed === 'instant' ? 'it never went through' : 'it went astray on the way and never arrived';
  }

  // They moved on before it got there.
  if (letter.direction === 'from-player' && letter.toRegion) {
    const now = whereaboutsRegion(db, entity);

    if (now && now !== letter.toRegion && roll(db, 'moved', letter.name, dayKey(letter.sentOn)) < 50) {
      return 'they had moved on before it arrived';
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// The player's own words

/**
 * Tidies a letter the player wrote: spacing, capitals at sentence starts, "i" → "I",
 * spaces before punctuation, a closing full stop. Never the wording.
 */
export function tidyLetter(text: string): string {
  let out = text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[^\s\d"'”’)])/g, '$1 ')
    .replace(/\bi\b(?=[ ,.;:!?'’]|$)/g, 'I')
    .replace(/\bi'(m|ll|ve|d)\b/gi, (_, rest: string) => `I'${rest.toLowerCase()}`)
    .replace(/([.!?])([A-Za-z]+)(?=[\s,;:!?]|$)/g, '$1 $2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Capital letter at the start of each sentence.
  out = out.replace(/(^|[.!?]\s+|\n\s*)([a-z])/g, (_, lead: string, letter: string) => `${lead}${letter.toUpperCase()}`);

  if (out && !/[.!?…"'”’)]$/.test(out)) out = `${out}.`;

  return out;
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

/**
 * The player's letter as it should be kept: the tracker's copy (spelling fixed) when
 * it kept to his words, else the words in his own input. Never a rewrite.
 */
export function keepPlayersWords(trackerText: string | undefined, userMessage: string | undefined): string | undefined {
  const own = userMessage?.trim() ?? '';
  const quoted = [...own.matchAll(/"([^"]{12,})"|“([^”]{12,})”/g)].map((match) => match[1] ?? match[2]).join('\n\n');
  const fallback = quoted || own.replace(/\*[^*]*\*/g, ' ').trim();

  if (!trackerText?.trim()) {
    return fallback.length >= 12 ? tidyLetter(fallback) : undefined;
  }

  const ownWords = new Set(words(own));
  const theirs = words(trackerText);
  const kept = theirs.filter((word) => ownWords.has(word)).length;

  // A spelling fix changes a word here and there, never most of them.
  if (theirs.length === 0 || kept / theirs.length < 0.75 || theirs.length > words(own).length * 1.15 + 3) {
    return fallback.length >= 12 ? tidyLetter(fallback) : undefined;
  }

  return tidyLetter(trackerText);
}

// ---------------------------------------------------------------------------
// Who writes to the player

export type LetterOffer = {
  kind: 'reply' | 'unprompted' | 'birthday';
  entity: EntityRecord;
  bond: BondRecord | null;
  carrier: string;
  /** The waiting reply, when kind is reply. */
  letter?: Letter;
  /** The player's letter it answers. */
  answering?: Letter;
  daysWaiting: number;
  /** News of their own life the letter can carry. */
  theirNews?: string;
};

function lastLetterFrom(db: AppDatabase, entityId: string): CalendarDate | null {
  const dates = postOf(db)
    .letters.filter((letter) => letter.direction === 'to-player' && letter.entityId === entityId && letter.status === 'delivered')
    .map((letter) => letter.deliveredOn ?? letter.arrivesOn);

  return dates.sort((a, b) => dateSortValue(b) - dateSortValue(a))[0] ?? null;
}

function storyStart(db: AppDatabase): CalendarDate {
  return db.rawLog[0]?.inStoryDate ?? db.world.calendar.start;
}

function writesToPlayer(db: AppDatabase, entity: EntityRecord, here: Set<string>, pending: Set<string>) {
  if (entity.type !== 'character' || isPlayerEntity(entity) || isDeceased(entity) || entity.met === false) return false;
  if (entity.companion || here.has(entity.id) || pending.has(entity.id)) return false;

  return true;
}

function warmth(db: AppDatabase, entity: EntityRecord) {
  const bond = bondOf(db, entity.id);
  const romance = bond?.relationship === 'lover' ? 3 : bond?.relationship === 'romantic interest' ? 2 : 0;

  return (bond?.affinity ?? 0) + romance;
}

function pendingWriters(db: AppDatabase) {
  return new Set(
    postOf(db)
      .letters.filter((letter) => letter.status === 'travelling' && letter.direction === 'to-player')
      .map((letter) => letter.entityId)
  );
}

/** People close enough to the player to write unprompted right now, warmest first. */
export function correspondents(db: AppDatabase): EntityRecord[] {
  const now = db.state.inStoryDate;
  const here = inScene(db);
  const pending = new Set(
    postOf(db)
      .letters.filter((letter) => letter.status === 'travelling')
      .map((letter) => letter.entityId)
  );

  return db.entities
    .filter((entity) => {
      if (!writesToPlayer(db, entity, here, pending)) return false;

      const bond = bondOf(db, entity.id);

      if (!bond) return false;
      if (bond.relationship === 'rejected' && bond.affinity < LETTER_MIN_AFFINITY) return false;
      if (bond.affinity < LETTER_MIN_AFFINITY && !CLOSE_STAGES.has(bond.relationship ?? '')) return false;

      const apart = entity.lastSeen ? daysBetween(entity.lastSeen, now) : daysBetween(storyStart(db), now);

      if (apart < LETTER_MIN_DAYS_APART) return false;

      const last = lastLetterFrom(db, entity.id);

      return !last || daysBetween(last, now) >= LETTER_PER_PERSON_DAYS;
    })
    .sort(
      (a, b) =>
        warmth(db, b) - warmth(db, a) || hashText(`${db.meta.slotId}:${a.id}`) - hashText(`${db.meta.slotId}:${b.id}`)
    );
}

/** The player's birthday was today or in the last couple of days (a letter may be late). */
function birthdayJustPassed(db: AppDatabase): boolean {
  const birthday = db.state.player.birthday;

  if (!birthday) return false;

  const now = db.state.inStoryDate;
  const day = { ...now, month: birthday.month, day: birthday.day };
  const since = daysBetween(day, now);

  return since >= 0 && since <= 2;
}

/** Who writes for the player's birthday this year: someone close who knows the date, far away. */
function birthdayWriter(db: AppDatabase): EntityRecord | null {
  const now = db.state.inStoryDate;
  const already = postOf(db).letters.some(
    (letter) => letter.direction === 'to-player' && letter.occasion === 'birthday' && letter.arrivesOn.year === now.year
  );

  if (already || !birthdayJustPassed(db)) return null;

  const here = inScene(db);
  const pending = pendingWriters(db);

  return (
    db.entities
      .filter((entity) => {
        if (!writesToPlayer(db, entity, here, pending)) return false;
        const bond = bondOf(db, entity.id);

        if (!bond || bond.affinity < 0) return false;
        return bond.affinity >= 6 || CLOSE_STAGES.has(bond.relationship ?? '');
      })
      .sort((a, b) => warmth(db, b) - warmth(db, a))[0] ?? null
  );
}

/**
 * The letter that may reach the player this turn: a reply that has arrived first,
 * then a birthday letter, otherwise (if it has been long enough) an
 * unprompted one. Null mid-fight.
 */
export function letterOffer(db: AppDatabase): LetterOffer | null {
  if (isCombatPace(db.state.scenePace)) {
    return null;
  }

  const now = db.state.inStoryDate;
  const post = postOf(db);
  const here = inScene(db);
  const news = (entity: EntityRecord) => newsOfTheirLife(entity, now)?.text;

  // Replies that have arrived, oldest first. A writer who is here in person
  // just says it; the letter waits until they are apart again.
  const arrived = post.letters
    .filter(
      (letter) =>
        letter.direction === 'to-player' &&
        letter.status === 'travelling' &&
        dateSortValue(letter.arrivesOn) <= dateSortValue(now) &&
        !here.has(letter.entityId)
    )
    .sort((a, b) => dateSortValue(a.arrivesOn) - dateSortValue(b.arrivesOn));

  for (const letter of arrived) {
    const entity = db.entities.find((item) => item.id === letter.entityId);

    if (!entity) continue;

    return {
      kind: 'reply',
      entity,
      bond: bondOf(db, entity.id),
      carrier: letterCarrier(db, entity),
      letter,
      answering: post.letters.find((item) => item.id === letter.replyTo),
      daysWaiting: Math.max(0, daysBetween(letter.arrivesOn, now)),
      theirNews: news(entity),
    };
  }

  const birthday = birthdayWriter(db);

  if (birthday) {
    return {
      kind: 'birthday',
      entity: birthday,
      bond: bondOf(db, birthday.id),
      carrier: letterCarrier(db, birthday),
      daysWaiting: 0,
      theirNews: news(birthday),
    };
  }

  const since = post.lastLetterIn ?? storyStart(db);

  if (daysBetween(since, now) < LETTER_GAP_DAYS) {
    return null;
  }

  const [entity] = correspondents(db);

  if (!entity) {
    return null;
  }

  return {
    kind: 'unprompted',
    entity,
    bond: bondOf(db, entity.id),
    carrier: letterCarrier(db, entity),
    daysWaiting: Math.max(0, daysBetween(since, now) - LETTER_GAP_DAYS),
    theirNews: news(entity),
  };
}

/** The letter offered this turn, if any. */
export function turnLetterOffer(db: AppDatabase): LetterOffer | null {
  return letterOffer(db);
}

export function formatLetterOffer(offer: LetterOffer | null, address?: string, writer?: string): string {
  if (!offer) {
    return '';
  }

  const { entity, bond } = offer;
  const feeling = bond
    ? `${bond.status || 'they know you'}${bond.relationship && bond.relationship !== 'stranger' ? `; ${bond.relationship}` : ''}`
    : 'they know you';
  const answering =
    offer.kind === 'reply'
      ? `, answering the letter you sent${offer.answering?.gist ? ` (${offer.answering.gist})` : ''}`
      : offer.kind === 'birthday'
        ? ' for your birthday: they remembered'
        : '';
  const press =
    offer.daysWaiting >= LETTER_LINGER_DAYS
      ? ' It has been waiting: bring it in this turn unless the scene truly cannot hold it.'
      : ' If the scene cannot hold it right now, leave it for a later turn.';
  const life = offer.theirNews ? ` If it fits, they mention news of their own life: they ${offer.theirNews}.` : '';

  return [
    `A LETTER FOR YOU (personal, from someone far away; never mid-fight). ${writer ?? entity.name} has written to you${answering}.`,
    address
      ? `It reaches you by ${offer.carrier}, or it was waiting for you at ${address}: they know you stay here.`
      : `It reaches you by ${offer.carrier}. Show how it found you; if nothing could have reached you here, leave it for later.`,
    `Write the letter out in their own voice, in full on the page (it is kept): short, in character, about their own life and what they could know, shaped by how they feel about you (${feeling}). No world news you have not heard.${life}${press}`,
  ].join(' ');
}

export function letterTrackingLines(
  db: AppDatabase,
  offer: LetterOffer | null,
  idOf: (entity: EntityRecord) => string
): string[] {
  const carriers = [...new Set([...(db.world?.letterCarriers ?? []), ...factionsOf(db).flatMap((faction) => faction.carriers ?? [])])];
  const lines = [
    `- letters_sent: {to: id, gist, text, carrier, coded} only when the player actually writes and sends (or hands off) a letter or message to someone NOT in the scene this turn, or writes to someone dead (it is kept, never sent). gist = what it says, in a few words. text = the letter exactly as the player wrote it in their input, with ONLY spelling, commas and punctuation corrected: never change a word choice, the tone or the content; null if the player's words are not given. carrier: how it goes (${carriers.length ? carriers.join(', ') : 'courier'}), or hand (a trusted person carries it). coded: true if it is in a cipher or code.`,
  ];

  if (offer) {
    lines.push(
      `- letter from ${idOf(offer.entity)}: letters_received [{from: "${idOf(offer.entity)}", text}] only if their letter actually reached the player on the page this turn; text = the letter's words exactly as the narration gives them (null if it only summarizes). life_events for anything it says happened in their own life.`
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Applying a turn

function nearTheirBirthday(entity: EntityRecord, date: CalendarDate) {
  if (!entity.birthday) return false;

  const day = { ...date, month: entity.birthday.month, day: entity.birthday.day };

  return Math.abs(daysBetween(day, date)) <= BIRTHDAY_LETTER_DAYS;
}

/**
 * The player sends letters: each sets out and arrives as many days later as the
 * road takes. Letters to the dead are kept, never sent.
 */
export function sendLetters(db: AppDatabase, sent: TurnDiff['lettersSent'], userMessage?: string): AppDatabase {
  if (!sent || sent.length === 0) {
    return db;
  }

  const now = db.state.inStoryDate;
  const here = inScene(db);
  const from = playerRegion(db);
  let next = db;
  const letters = [...postOf(db).letters];

  for (const item of sent) {
    const entity = item.entityId ? db.entities.find((person) => person.id === item.entityId) : resolveEntity(db, item.name);

    if (!entity || isPlayerEntity(entity)) continue;

    const id = makeId('letter');
    const text = keepPlayersWords(item.text, userMessage);

    // To the dead: kept, never sent.
    if (isDeceased(entity)) {
      letters.push({
        id,
        direction: 'from-player',
        entityId: entity.id,
        name: entity.name,
        sentOn: now,
        arrivesOn: now,
        gist: item.gist,
        text,
        status: 'unsent',
      });
      continue;
    }

    // A note handed across the fire is not a letter.
    if (here.has(entity.id)) continue;

    const carrier = item.carrier?.trim() || db.world?.letterCarriers?.[0] || 'courier';
    const to = whereaboutsRegion(db, entity);
    const seed = `${db.meta.slotId}:${entity.name}:${dayKey(now)}`;
    let letter: Letter = {
      id,
      direction: 'from-player',
      entityId: entity.id,
      name: entity.name,
      sentOn: now,
      arrivesOn: shiftDate(now, letterDays(next, from, to, carrier, seed)),
      gist: item.gist,
      text,
      status: 'travelling',
      carrier,
      ...(item.coded ? { coded: true } : {}),
      ...(to ? { toRegion: to } : {}),
      ...(nearTheirBirthday(entity, now) ? { occasion: 'birthday' as const } : {}),
    };
    const road = crossTheRoad(next, letter, entity);

    next = road.db;
    letter = road.letter;
    letters.push(letter);
  }

  return withPost(next, { ...postOf(next), letters });
}

/** Letters whose reader read them on the page this turn. */
export function receiveLetters(db: AppDatabase, received: TurnDiff['lettersReceived'], offer?: LetterOffer | null): AppDatabase {
  if (!received || received.length === 0) {
    return db;
  }

  const now = db.state.inStoryDate;
  const post = postOf(db);
  let letters = [...post.letters];
  let next = db;
  let any = false;

  for (const item of received) {
    const entityId = item.entityId ?? resolveEntity(db, item.name)?.id;

    if (!entityId) continue;

    const text = item.text?.trim() ? item.text.trim().slice(0, 2400) : undefined;
    const waiting = letters.find(
      (letter) =>
        letter.direction === 'to-player' &&
        letter.entityId === entityId &&
        letter.status === 'travelling' &&
        dateSortValue(letter.arrivesOn) <= dateSortValue(now)
    );

    if (waiting) {
      letters = letters.map((letter) =>
        letter.id === waiting.id ? { ...letter, status: 'delivered', deliveredOn: now, ...(text ? { text } : {}) } : letter
      );
    } else {
      // Unprompted (or the narrator brought one we did not plan): record it.
      const entity = db.entities.find((person) => person.id === entityId);

      if (!entity) continue;

      const carrier = carrierOf(db, entity);

      letters.push({
        id: makeId('letter'),
        direction: 'to-player',
        entityId,
        name: entity.name,
        sentOn: shiftDate(now, -letterDays(db, whereaboutsRegion(db, entity), playerRegion(db), carrier, `${db.meta.slotId}:${entityId}:${now.year}-${now.month}`)),
        arrivesOn: now,
        status: 'delivered',
        deliveredOn: now,
        carrier,
        ...(text ? { text } : {}),
        ...(offer?.kind === 'birthday' && offer.entity.id === entityId ? { occasion: 'birthday' as const } : {}),
      });
    }

    // Whatever their life news was, the player has it now.
    if (offer?.theirNews && offer.entity.id === entityId) {
      next = markLifeKnown(next, entityId);
    }

    any = true;
  }

  return any ? withPost(next, { ...postOf(next), letters, lastLetterIn: now }) : db;
}

/**
 * Letters that reached the end of their road by now. The player's: the bond moves,
 * they remember it, and (unless they are cold toward him) a reply sets out,
 * which may itself be read on the way. Some never arrive at all.
 */
export function deliverLetters(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  const post = postOf(db);
  const due = post.letters.filter(
    (letter) => letter.status === 'travelling' && dateSortValue(letter.arrivesOn) <= dateSortValue(now)
  );

  if (due.length === 0) {
    return db;
  }

  let next = db;
  let letters = [...post.letters];
  const replace = (id: string, change: Partial<Letter>) => {
    letters = letters.map((item) => (item.id === id ? { ...item, ...change } : item));
  };

  for (const letter of due) {
    const entity = next.entities.find((person) => person.id === letter.entityId);

    // Replies to the player: lost ones simply never come. The rest wait for the page.
    if (letter.direction === 'to-player') {
      const lost = entity && !letter.lostReason ? lossOnTheRoad(next, letter, entity) : null;

      if (lost) replace(letter.id, { status: 'lost', lostReason: lost });
      continue;
    }

    if (!entity || isDeceased(entity)) {
      replace(letter.id, { status: 'lost', lostReason: 'they died before it arrived' });
      continue;
    }

    const lost = lossOnTheRoad(next, letter, entity);

    if (lost) {
      replace(letter.id, { status: 'lost', lostReason: lost });
      continue;
    }

    replace(letter.id, { status: 'delivered', deliveredOn: letter.arrivesOn });

    const bond = bondOf(next, entity.id);
    const affinity = bond?.affinity ?? 0;
    const gain = (affinity < -2 ? Math.ceil(LETTER_BOND_GAIN / 2) : LETTER_BOND_GAIN) + (letter.occasion === 'birthday' ? 1 : 0);

    next = applyBondDiff(next, {
      entityId: entity.id,
      character: entity.name,
      affinityDelta: clamp(gain, 0, 10),
    });
    next = applyFactDiff(next, {
      action: 'add',
      type: 'event',
      text: `${displayName(db, entity)} received a ${letter.occasion === 'birthday' ? 'birthday letter' : 'letter'} from you${letter.gist ? `: ${letter.gist}` : ''}.`,
      subject: entity.name,
      whoKnows: [entity.name],
      validFrom: letter.arrivesOn,
    });

    if (affinity + gain >= LETTER_REPLY_FLOOR) {
      const id = makeId('letter');
      const carrier = carrierOf(db, entity);
      let reply: Letter = {
        id,
        direction: 'to-player',
        entityId: entity.id,
        name: entity.name,
        sentOn: letter.arrivesOn,
        arrivesOn: shiftDate(
          letter.arrivesOn,
          letterDays(next, whereaboutsRegion(next, entity), playerRegion(next), carrier, `${db.meta.slotId}:reply:${entity.name}:${dayKey(letter.arrivesOn)}`)
        ),
        status: 'travelling',
        replyTo: letter.id,
        carrier,
      };
      const road = crossTheRoad(next, reply, entity);

      next = road.db;
      reply = road.letter;
      letters.push(reply);
    }
  }

  // Seeds planted on the road live in the save already; the post is ours.
  return withPost(next, { ...postOf(next), letters });
}

/** Letters on the road right now, soonest first (for the world clock screen). */
export function lettersInTransit(db: AppDatabase): Letter[] {
  return postOf(db)
    .letters.filter((letter) => letter.status === 'travelling')
    .sort((a, b) => dateSortValue(a.arrivesOn) - dateSortValue(b.arrivesOn));
}

export type ArchivedLetter = Letter & {
  /** What the player can tell of it, in second person. */
  label: string;
};

/**
 * The letters the player can reread, newest first: everything he wrote (sent or
 * kept) and everything that reached him. Letters lost to him on the way
 * never show; his own read on the way show it only once that came back.
 */
export function letterArchive(db: AppDatabase): ArchivedLetter[] {
  const post = postOf(db);
  const answered = new Set(
    post.letters.filter((letter) => letter.direction === 'to-player' && letter.status === 'delivered' && letter.replyTo).map((letter) => letter.replyTo!)
  );
  const discovered = new Set(
    (db.state.consequences ?? [])
      .filter((seed) => seed.kind === 'intercepted' && seed.status === 'returned' && seed.letterId)
      .map((seed) => seed.letterId!)
  );

  return post.letters
    .filter((letter) => (letter.direction === 'to-player' ? letter.status === 'delivered' : true))
    .map((letter) => {
      let label: string;
      // As you know them now (a stranger who later gave a name shows it).
      const name = displayNameOf(db, letter.entityId, letter.name);

      if (letter.direction === 'to-player') {
        label = letter.occasion === 'birthday' ? `Birthday letter from ${name}` : `From ${name}`;
      } else if (letter.status === 'unsent') {
        label = `To ${name} · never sent`;
      } else if (answered.has(letter.id)) {
        label = `To ${name} · answered`;
      } else if (letter.status === 'travelling') {
        label = `To ${name} · on its way`;
      } else {
        label = `To ${name} · no answer yet`;
      }

      if (letter.interceptedBy && discovered.has(letter.id)) {
        label = `${label} · read on the way`;
      }

      return { ...letter, label };
    })
    .sort((a, b) => dateSortValue(b.deliveredOn ?? b.sentOn) - dateSortValue(a.deliveredOn ?? a.sentOn));
}
