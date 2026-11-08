// People with their own lives (living-world Stage 3, section 8).
//
// - Side characters do not freeze between Kan's visits. As story time passes,
//   the people Kan knows who have little canon story of their own (Hana,
//   Suzume, the people Kan met on the road) get small life events: a hard
//   mission, an injury, a posting, a new team, a move, a promotion, a
//   wedding. Canon characters only get events that cannot touch their canon
//   path; romance, moves and promotions are for original characters only.
// - When Kan meets someone again after a long time, the narrator gets a short
//   "since you last saw them" note: their canon events since then (from the
//   fired milestones that name them), their life events, how the era has
//   changed them, and, where canon says nothing, room for one small change
//   of the narrator's own that the state tracker then keeps (life_events).
//
// Everything is deterministic per save and person, so a regenerated turn
// gets the same world.

import { dateSortValue, daysBetween, entityAge, shiftDate } from './calendar';
import { CANON_MILESTONES } from './canonData';
import { mentionsEntity } from './characterRefs';
import { castWithCompanions } from './companions';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { eraNoteFor } from './romance';
import { isOriginalCharacter } from './returning';
import { hashText } from './util';
import type { AppDatabase, CalendarDate, EntityRecord, LifeEvent, LifeEventKind, TurnDiff } from './types';

/** Apart this long, meeting again is a reunion with a "since you last saw them" note. */
export const REUNION_DAYS = 30;

/** A side character's life moves on about this often while Kan is away. */
export const LIFE_EVENT_MIN_DAYS = 60;
export const LIFE_EVENT_SPREAD_DAYS = 90;

/** Each person keeps at most this many life events. */
const LIFE_EVENTS_KEPT = 8;

/** A canon character named in this many world milestones has a canon story of their own. */
const CANON_STORY_MILESTONES = 3;

/** Reunion notes per narrator turn. */
const REUNION_NOTES_PER_TURN = 2;

function isKan(entity: EntityRecord) {
  return entity.name.trim().toLowerCase() === 'kan' || entity.tags.includes('player');
}

function sceneIds(db: AppDatabase): Set<string> {
  const ids = new Set<string>();

  for (const name of castWithCompanions(db, db.state.sceneCast ?? [])) {
    const entity = resolveEntity(db, name);

    if (entity) ids.add(entity.id);
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Who has a canon story of their own

/** Canon people seeded with the story itself (they carry no `canon` tag). */
const SEEDED_CANON = new Set(['Itachi Uchiha', 'Hana Inuzuka', 'Suzume', 'Izumi Uchiha', 'Shisui Uchiha']);

/** A Naruto character (from the canon cast or seeded with the story), not one the story made up. */
export function isCanonFigure(entity: EntityRecord): boolean {
  return SEEDED_CANON.has(entity.name) || (entity.type === 'character' && !isKan(entity) && !isOriginalCharacter(entity));
}

const canonStoryCache = new Map<string, number>();

/** How many world (not personal) milestones name this person. */
export function canonStoryWeight(entity: Pick<EntityRecord, 'name' | 'aliases'>): number {
  const key = entity.name;
  const cached = canonStoryCache.get(key);

  if (cached !== undefined) return cached;

  const count = CANON_MILESTONES.filter((milestone) => {
    if (milestone.playerDriven) return false;
    const text = [milestone.title, milestone.description, ...milestone.facts, ...(milestone.deaths ?? [])].join(' ');

    return mentionsEntity(text, entity);
  }).length;

  canonStoryCache.set(key, count);
  return count;
}

/** Someone whose life the canon timeline does not already fill. */
export function isSideCharacter(entity: EntityRecord): boolean {
  if (entity.type !== 'character' || isKan(entity)) return false;
  if (entity.tags.includes('tailed-beast') || entity.tags.includes('summon')) return false;

  return !isCanonFigure(entity) || canonStoryWeight(entity) < CANON_STORY_MILESTONES;
}

// ---------------------------------------------------------------------------
// Life events

type Template = {
  kind: LifeEventKind;
  text: string;
  /** Safe for canon characters: cannot touch their canon path. */
  canonSafe: boolean;
  /** Only from this age. */
  minAge?: number;
};

type Walk = 'shinobi' | 'medic' | 'teacher' | 'merchant' | 'civilian' | 'child';

const TEMPLATES: Record<Walk, Template[]> = {
  shinobi: [
    { kind: 'mission', text: 'spent weeks on a hard mission far from home and came back thinner and quieter', canonSafe: true },
    { kind: 'injury', text: 'was hurt on a mission; it has healed, but they favour that side now', canonSafe: true },
    { kind: 'posting', text: 'was posted to the border for a season, long nights on watch', canonSafe: true },
    { kind: 'team', text: 'worked with a new squad for a stretch of missions', canonSafe: true },
    { kind: 'loss', text: 'lost a comrade on a mission and does not talk about it', canonSafe: true },
    { kind: 'skill', text: 'worked hard on a new technique and is quietly proud of it', canonSafe: true },
    { kind: 'promotion', text: 'was promoted', canonSafe: false, minAge: 14 },
    { kind: 'romance', text: 'has started seeing someone, and is guarded about it', canonSafe: false, minAge: 17 },
  ],
  medic: [
    { kind: 'work', text: 'worked through a fever season at the hospital, short on sleep for weeks', canonSafe: true },
    { kind: 'work', text: 'has been training a junior medic, and complains about it fondly', canonSafe: true },
    { kind: 'loss', text: 'lost a patient they had fought hard for', canonSafe: true },
    { kind: 'injury', text: 'caught a blade meant for someone else on a field posting; it healed clean', canonSafe: true },
    { kind: 'romance', text: 'has started seeing someone from the hospital', canonSafe: false, minAge: 17 },
  ],
  teacher: [
    { kind: 'team', text: 'took on a new class, and already has opinions about every one of them', canonSafe: true },
    { kind: 'work', text: 'saw a student they taught come home from a mission in a coffin', canonSafe: true },
    { kind: 'mission', text: 'was called back to field duty for a few weeks, and liked it more than they admit', canonSafe: true },
    { kind: 'posting', text: 'was asked to help run the Academy exams this year', canonSafe: true },
  ],
  merchant: [
    { kind: 'work', text: 'had a bad season when the roads closed and is still making up for it', canonSafe: true },
    { kind: 'work', text: 'took on an apprentice', canonSafe: true },
    { kind: 'work', text: 'opened a second stall in the next town over', canonSafe: false },
    { kind: 'move', text: 'moved their trade to another town', canonSafe: false },
    { kind: 'family', text: 'got married in a small ceremony', canonSafe: false, minAge: 18 },
    { kind: 'injury', text: 'was robbed on the road and still has the scar', canonSafe: true },
  ],
  civilian: [
    { kind: 'move', text: 'moved to another part of town', canonSafe: false },
    { kind: 'loss', text: 'lost someone in the family over the winter', canonSafe: true },
    { kind: 'work', text: 'found new work and seems steadier for it', canonSafe: true },
    { kind: 'family', text: 'got married', canonSafe: false, minAge: 18 },
    { kind: 'romance', text: 'has started courting someone', canonSafe: false, minAge: 16 },
    { kind: 'move', text: 'moved away to another town', canonSafe: false },
  ],
  child: [
    { kind: 'growth', text: 'has grown a head taller', canonSafe: true },
    { kind: 'skill', text: 'is proud of something new they learned to do', canonSafe: true },
    { kind: 'growth', text: 'made a new best friend and talks about them constantly', canonSafe: true },
  ],
};

const NEXT_RANK: Array<[RegExp, string]> = [
  [/\bgenin\b/i, 'chunin'],
  [/\bch[uū]nin\b/i, 'jonin'],
];

function walkOf(entity: EntityRecord, age: number | null): Walk {
  if (age !== null && age < 12) return 'child';

  const role = `${entity.role ?? ''} ${entity.notes ?? ''}`.toLowerCase();

  if (/\b(medic|healer|vet|doctor|nurse|herbalist)\b/.test(role)) return 'medic';
  if (/\b(sensei|teacher|instructor|academy)\b/.test(role)) return 'teacher';
  if (/\b(merchant|shop|trader|innkeeper|teahouse|vendor|smith|cook|peddler|tavern|baker)\b/.test(role)) return 'merchant';
  if (
    /\b(genin|ch[uū]nin|j[oō]nin|ninja|shinobi|anbu|nin|kunoichi|hunter|mercenary|samurai|guard|ronin|bodyguard)\b/.test(role) ||
    ['leaf', 'sand', 'mist', 'cloud', 'stone', 'rain', 'sound', 'anbu', 'root'].some((tag) => entity.tags.includes(tag))
  ) {
    return 'shinobi';
  }

  return 'civilian';
}

function lifeOf(entity: EntityRecord): LifeEvent[] {
  return Array.isArray(entity.lifeEvents) ? entity.lifeEvents : [];
}

/** People whose lives move on by themselves while Kan is away. */
function livesOnOwn(db: AppDatabase, entity: EntityRecord, here: Set<string>): boolean {
  if (!isSideCharacter(entity) || entity.met === false || isDeceased(entity)) return false;
  if (entity.companion || entity.tier === 'minor' || here.has(entity.id)) return false;

  return db.bonds.some((bond) => bond.entityId === entity.id);
}

function pickTemplate(db: AppDatabase, entity: EntityRecord, date: CalendarDate, past: LifeEvent[]): Template | null {
  const age = entityAge(date, entity) ?? null;
  const canon = isCanonFigure(entity);
  const options = TEMPLATES[walkOf(entity, age)].filter(
    (template) =>
      (!canon || template.canonSafe) &&
      (template.minAge === undefined || (age !== null && age >= template.minAge)) &&
      // The same thing twice in a row reads like a loop.
      past[past.length - 1]?.text !== template.text &&
      // One wedding, one courtship.
      !(template.kind === 'family' && past.some((event) => event.kind === 'family')) &&
      !(template.kind === 'romance' && past.some((event) => event.kind === 'romance' || event.kind === 'family')) &&
      !(template.kind === 'promotion' && !NEXT_RANK.some(([pattern]) => pattern.test(entity.role ?? '')))
  );

  if (options.length === 0) return null;

  return options[hashText(`${db.meta.slotId}:life:${entity.id}:${date.year}-${date.month}-${date.day}`) % options.length];
}

function promote(role: string | undefined): { role: string; rank: string } | null {
  if (!role) return null;

  for (const [pattern, rank] of NEXT_RANK) {
    if (pattern.test(role)) return { role: role.replace(pattern, rank), rank };
  }

  return null;
}

/**
 * Moves side characters' lives forward to the current date. A long time
 * skip catches up a few events at once, each on its own day; nothing is
 * dated before Kan last saw them.
 */
export function advanceLives(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  const here = sceneIds(db);
  let changed = false;

  const entities = db.entities.map((entity) => {
    if (!livesOnOwn(db, entity, here)) return entity;

    const past = lifeOf(entity);
    const lastWorld = [...past].reverse().find((event) => event.source === 'world')?.date;
    const anchors = [lastWorld, entity.lastSeen].filter((date): date is CalendarDate => Boolean(date));

    if (anchors.length === 0) return entity;

    let anchor = anchors.sort((a, b) => dateSortValue(b) - dateSortValue(a))[0];
    let next = entity;
    let events = past;

    for (let added = 0; added < 3; added += 1) {
      const gap = LIFE_EVENT_MIN_DAYS + (hashText(`${db.meta.slotId}:gap:${entity.id}:${events.length}`) % LIFE_EVENT_SPREAD_DAYS);
      const date = { ...shiftDate(anchor, gap), hour: 12, minute: 0 };

      if (dateSortValue(date) > dateSortValue(now)) break;

      const template = pickTemplate(db, next, date, events);

      if (!template) break;

      let text = template.text;

      if (template.kind === 'promotion') {
        const promoted = promote(next.role);

        if (!promoted) break;
        text = `was promoted to ${promoted.rank}`;
        next = { ...next, role: promoted.role };
      }

      events = [...events, { date, text, kind: template.kind, source: 'world' }];
      anchor = date;
    }

    if (events === past) return entity;

    changed = true;
    return { ...next, lifeEvents: trimLife(events) };
  });

  return changed ? { ...db, entities } : db;
}

function trimLife(events: LifeEvent[]): LifeEvent[] {
  if (events.length <= LIFE_EVENTS_KEPT) return events;

  // Drop the oldest ones Kan already knows first, then the oldest.
  const known = events.findIndex((event) => event.known);
  const drop = known >= 0 ? known : 0;

  return trimLife(events.filter((_, index) => index !== drop));
}

/** The tracker's life_events: what the page said about someone's own life. */
export function applyLifeEvents(db: AppDatabase, items: TurnDiff['lifeEvents']): AppDatabase {
  if (!items || items.length === 0) return db;

  const now = db.state.inStoryDate;
  let next = db;

  for (const item of items) {
    const entity = item.entityId ? next.entities.find((person) => person.id === item.entityId) : resolveEntity(next, item.name);
    const text = item.text.trim().replace(/\.$/, '');

    if (!entity || isKan(entity) || !text) continue;
    if (lifeOf(entity).some((event) => event.text.toLowerCase() === text.toLowerCase())) continue;

    const events = trimLife([...lifeOf(entity), { date: now, text, kind: 'other', source: 'story', known: true }]);

    next = { ...next, entities: next.entities.map((person) => (person.id === entity.id ? { ...person, lifeEvents: events } : person)) };
  }

  return next;
}

/** Kan learned these from them (in person or by letter). */
export function markLifeKnown(db: AppDatabase, entityId: string, upTo: CalendarDate = db.state.inStoryDate): AppDatabase {
  let changed = false;
  const entities = db.entities.map((entity) => {
    if (entity.id !== entityId || !lifeOf(entity).some((event) => !event.known && dateSortValue(event.date) <= dateSortValue(upTo))) {
      return entity;
    }

    changed = true;
    return {
      ...entity,
      lifeEvents: lifeOf(entity).map((event) =>
        dateSortValue(event.date) <= dateSortValue(upTo) ? { ...event, known: true } : event
      ),
    };
  });

  return changed ? { ...db, entities } : db;
}

/** The newest life event Kan has not heard of yet: something a letter could tell. */
export function newsOfTheirLife(entity: EntityRecord, before: CalendarDate): LifeEvent | null {
  return (
    [...lifeOf(entity)]
      .reverse()
      .find((event) => !event.known && dateSortValue(event.date) <= dateSortValue(before)) ?? null
  );
}

// ---------------------------------------------------------------------------
// Reunions

/**
 * After a turn: anyone now present whom Kan had not seen for REUNION_DAYS is
 * a reunion. The note stays with them for the rest of that scene, and what
 * happened in their life is now something Kan can see or be told.
 */
export function markReunions(before: AppDatabase, after: AppDatabase): AppDatabase {
  const previous = new Map(before.entities.map((entity) => [entity.id, entity]));
  let next = after;

  for (const entity of after.entities) {
    const old = previous.get(entity.id);

    if (!old?.lastSeen || !entity.lastSeen || dateSortValue(entity.lastSeen) === dateSortValue(old.lastSeen)) continue;
    if (daysBetween(old.lastSeen, entity.lastSeen) < REUNION_DAYS || isKan(entity)) continue;

    next = {
      ...next,
      entities: next.entities.map((person) =>
        person.id === entity.id
          ? { ...person, reunion: { on: entity.lastSeen!, lastSeen: old.lastSeen!, lastSeenAt: old.lastSeenAt, seq: after.state.sceneSeq } }
          : person
      ),
    };
    next = markLifeKnown(next, entity.id, entity.lastSeen);
  }

  return next;
}

function apartLabel(days: number) {
  if (days >= 700) return `${Math.round(days / 365)} years`;
  if (days >= 330) return 'about a year';
  if (days >= 50) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 7)} weeks`;
}

/** The fired world events since then that name this person, oldest first. */
function canonSince(db: AppDatabase, entity: EntityRecord, since: CalendarDate): string[] {
  const now = dateSortValue(db.state.inStoryDate);
  const from = dateSortValue(since);

  return db.events
    .filter(
      (event) =>
        event.tags.includes('canon') &&
        dateSortValue(event.inStoryDate) > from &&
        dateSortValue(event.inStoryDate) <= now &&
        mentionsEntity(event.summary, entity)
    )
    .sort((a, b) => dateSortValue(a.inStoryDate) - dateSortValue(b.inStoryDate))
    .map((event) => event.summary.split(':')[0].trim())
    .slice(-3);
}

/**
 * The "since you last saw them" note for one person, or '' when it does not
 * apply: they are a reunion in this scene, or Kan is about to meet them
 * (named in the turn) after REUNION_DAYS apart.
 */
export function sinceYouLastSaw(db: AppDatabase, entity: EntityRecord): string {
  if (isKan(entity) || isDeceased(entity) || entity.met === false || entity.companion) return '';

  const now = db.state.inStoryDate;
  const reunion = entity.reunion && entity.reunion.seq === db.state.sceneSeq ? entity.reunion : null;
  const lastSeen = reunion?.lastSeen ?? entity.lastSeen;

  if (!lastSeen) return '';
  if (!reunion && (sceneIds(db).has(entity.id) || daysBetween(lastSeen, now) < REUNION_DAYS)) return '';

  const days = daysBetween(lastSeen, now);
  const where = reunion?.lastSeenAt ?? entity.lastSeenAt;
  const parts: string[] = [];
  const canon = canonSince(db, entity, lastSeen);

  if (canon.length) parts.push(`canon: ${canon.join('; ')}`);

  const life = lifeOf(entity).filter(
    (event) => dateSortValue(event.date) > dateSortValue(lastSeen) && dateSortValue(event.date) <= dateSortValue(now)
  );

  if (life.length) parts.push(`their life: ${life.slice(-3).map((event) => event.text).join('; ')}`);

  const then = eraNoteFor(entity.name, lastSeen.year);
  const nowNote = eraNoteFor(entity.name, now.year);

  if (nowNote && nowNote !== then) parts.push(`they have changed: ${nowNote}`);

  const ageThen = entityAge(lastSeen, entity);
  const ageNow = entityAge(now, entity);

  if (ageThen !== undefined && ageNow !== undefined && ageNow > ageThen && ageNow < 20) parts.push(`${ageThen} then, ${ageNow} now`);

  // Named but not here yet: only if they turn up.
  const opening = `${reunion ? '' : 'Only if they appear: '}Since you last saw them (${apartLabel(days)} ago${where ? `, at ${where}` : ''})`;
  const canonPath = isCanonFigure(entity) ? ' Nothing that changes their canon path.' : '';

  if (parts.length === 0) {
    return `${opening}: canon says nothing of their life since. Give them one small change of their own that fits who they are (a mission, an injury, new work, a move), and make it plain on the page so it is kept.${canonPath}`;
  }

  return `${opening}: ${parts.join('. ')}. Let it show in how they look and talk; they tell you only what they would share.`;
}

/** Reunion notes for the people in this turn's character cards (at most two). */
export function reunionNotes(db: AppDatabase, entities: EntityRecord[]): Map<string, string> {
  const notes = new Map<string, string>();

  for (const entity of entities) {
    if (notes.size >= REUNION_NOTES_PER_TURN) break;

    const note = sinceYouLastSaw(db, entity);

    if (note) notes.set(entity.id, note);
  }

  return notes;
}

/** Life events Kan knows of, newest first (the bond screen). */
export function knownLife(entity: EntityRecord): LifeEvent[] {
  return lifeOf(entity)
    .filter((event) => event.known)
    .sort((a, b) => dateSortValue(b.date) - dateSortValue(a.date));
}

export function normalizeLifeEvents(raw: unknown): LifeEvent[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const events = raw.filter(
    (event): event is LifeEvent =>
      Boolean(event) && typeof event === 'object' && typeof event.text === 'string' && Boolean(event.date)
  );

  return events.length ? events.slice(-LIFE_EVENTS_KEPT) : undefined;
}
