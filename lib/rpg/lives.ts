// People with their own lives (living-world Stage 3, section 8).
//
// - Side characters do not freeze between the player's visits. As story time passes,
//   the people the player knows get small life events: a hard stretch at work,
//   an injury, a new job, a move, a promotion, a wedding.
// - When the player meets someone again after a long time, the narrator gets a short
//   "since you last saw them" note: their life events and, where nothing is known, room for one small
//   change of the narrator's own that the state tracker then keeps (life_events).
//
// Everything is deterministic per save and person, so a regenerated turn
// gets the same world.

import { dateSortValue, daysBetween, entityAge, shiftDate } from './calendar';
import { castWithCompanions } from './companions';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { hashText } from './util';
import type { AppDatabase, CalendarDate, EntityRecord, LifeEvent, LifeEventKind, TurnDiff } from './types';
import { isPlayerEntity } from './player';

/** Apart this long, meeting again is a reunion with a "since you last saw them" note. */
export const REUNION_DAYS = 30;

/** A side character's life moves on about this often while the player is away. */
export const LIFE_EVENT_MIN_DAYS = 60;
export const LIFE_EVENT_SPREAD_DAYS = 90;

/** Each person keeps at most this many life events. */
const LIFE_EVENTS_KEPT = 8;

/** Reunion notes per narrator turn. */
const REUNION_NOTES_PER_TURN = 2;

function sceneIds(db: AppDatabase): Set<string> {
  const ids = new Set<string>();

  for (const name of castWithCompanions(db, db.state.sceneCast ?? [])) {
    const entity = resolveEntity(db, name);

    if (entity) ids.add(entity.id);
  }

  return ids;
}

/** Anyone but the player. */
export function isSideCharacter(_db: AppDatabase, entity: EntityRecord): boolean {
  return entity.type === 'character' && !isPlayerEntity(entity);
}

// ---------------------------------------------------------------------------
// Life events

type Template = {
  kind: LifeEventKind;
  text: string;
  /** Only from this age. */
  minAge?: number;
};

type Walk = 'service' | 'medic' | 'teacher' | 'trade' | 'office' | 'civilian' | 'child';

const TEMPLATES: Record<Walk, Template[]> = {
  service: [
    { kind: 'work', text: 'spent weeks on a hard assignment far from home and came back thinner and quieter' },
    { kind: 'injury', text: 'was hurt on the job; it has healed, but they favour that side now' },
    { kind: 'posting', text: 'was moved to night shifts for a season' },
    { kind: 'team', text: 'worked with a new partner for a stretch' },
    { kind: 'loss', text: 'lost a colleague and does not talk about it' },
    { kind: 'skill', text: 'passed a hard qualification and is quietly proud of it' },
    { kind: 'promotion', text: 'was promoted', minAge: 20 },
    { kind: 'romance', text: 'has started seeing someone, and is guarded about it', minAge: 18 },
  ],
  medic: [
    { kind: 'work', text: 'worked through a bad flu season at the hospital, short on sleep for weeks' },
    { kind: 'work', text: 'has been training a junior colleague, and complains about it fondly' },
    { kind: 'loss', text: 'lost a patient they had fought hard for' },
    { kind: 'skill', text: 'finished a specialist course' },
    { kind: 'romance', text: 'has started seeing someone from work', minAge: 18 },
  ],
  teacher: [
    { kind: 'team', text: 'took on a new class, and already has opinions about every one of them' },
    { kind: 'work', text: 'had a former student come back to thank them' },
    { kind: 'work', text: 'fought the school board over something and lost' },
    { kind: 'posting', text: 'was asked to run the exams this year' },
  ],
  trade: [
    { kind: 'work', text: 'had a bad season and is still making up for it' },
    { kind: 'work', text: 'took on an apprentice' },
    { kind: 'work', text: 'opened a second place across town' },
    { kind: 'move', text: 'moved their business to another part of town' },
    { kind: 'family', text: 'got married in a small ceremony', minAge: 18 },
    { kind: 'injury', text: 'was robbed and still has the scar' },
  ],
  office: [
    { kind: 'work', text: 'survived a round of layoffs and is still nervous about it' },
    { kind: 'work', text: 'landed a big project and has been working late' },
    { kind: 'team', text: 'got a new boss they cannot stand' },
    { kind: 'promotion', text: 'was promoted', minAge: 20 },
    { kind: 'move', text: 'moved to a new flat' },
    { kind: 'romance', text: 'has started seeing someone, and is guarded about it', minAge: 18 },
  ],
  civilian: [
    { kind: 'move', text: 'moved to another part of town' },
    { kind: 'loss', text: 'lost someone in the family over the winter' },
    { kind: 'work', text: 'found new work and seems steadier for it' },
    { kind: 'family', text: 'got married', minAge: 18 },
    { kind: 'romance', text: 'has started seeing someone', minAge: 18 },
    { kind: 'move', text: 'moved away to another town' },
  ],
  child: [
    { kind: 'growth', text: 'has grown a head taller' },
    { kind: 'skill', text: 'is proud of something new they learned to do' },
    { kind: 'growth', text: 'made a new best friend and talks about them constantly' },
  ],
};

const NEXT_RANK: Array<[RegExp, string]> = [
  [/junior/i, 'senior'],
  [/assistant/i, 'associate'],
  [/officer/i, 'sergeant'],
  [/sergeant/i, 'lieutenant'],
];

function walkOf(entity: EntityRecord, age: number | null): Walk {
  if (age !== null && age < 12) return 'child';

  const role = `${entity.role ?? ''} ${entity.notes ?? ''}`.toLowerCase();

  if (/\b(medic|doctor|nurse|paramedic|surgeon|vet|pharmacist)\b/.test(role)) return 'medic';
  if (/\b(teacher|professor|lecturer|instructor|tutor|coach)\b/.test(role)) return 'teacher';
  if (/\b(shop|owner|trader|barkeep|bartender|runs|cafe|café|bar|restaurant|chef|cook|baker|vendor|mechanic|smith)\b/.test(role)) return 'trade';
  if (/\b(police|officer|detective|soldier|guard|security|firefighter|agent|investigator|military|enforcer)\b/.test(role)) return 'service';
  if (/\b(analyst|manager|lead|clerk|accountant|lawyer|engineer|developer|executive|assistant|consultant)\b/.test(role)) return 'office';

  return 'civilian';
}

function lifeOf(entity: EntityRecord): LifeEvent[] {
  return Array.isArray(entity.lifeEvents) ? entity.lifeEvents : [];
}

/** People whose lives move on by themselves while the player is away. */
function livesOnOwn(db: AppDatabase, entity: EntityRecord, here: Set<string>): boolean {
  if (!isSideCharacter(db, entity) || entity.met === false || isDeceased(entity)) return false;
  if (entity.companion || entity.tier === 'minor' || here.has(entity.id)) return false;

  return db.bonds.some((bond) => bond.entityId === entity.id);
}

function pickTemplate(db: AppDatabase, entity: EntityRecord, date: CalendarDate, past: LifeEvent[]): Template | null {
  const age = entityAge(date, entity) ?? null;
  const options = TEMPLATES[walkOf(entity, age)].filter(
    (template) =>
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
 * dated before the player last saw them.
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

  // Drop the oldest ones the player already knows first, then the oldest.
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

    if (!entity || isPlayerEntity(entity) || !text) continue;
    if (lifeOf(entity).some((event) => event.text.toLowerCase() === text.toLowerCase())) continue;

    const events = trimLife([...lifeOf(entity), { date: now, text, kind: 'other', source: 'story', known: true }]);

    next = { ...next, entities: next.entities.map((person) => (person.id === entity.id ? { ...person, lifeEvents: events } : person)) };
  }

  return next;
}

/** The player learned these from them (in person or by letter). */
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

// ---------------------------------------------------------------------------
// Reunions

/**
 * After a turn: anyone now present whom the player had not seen for REUNION_DAYS is
 * a reunion. The note stays with them for the rest of that scene, and what
 * happened in their life is now something the player can see or be told.
 */
export function markReunions(before: AppDatabase, after: AppDatabase): AppDatabase {
  const previous = new Map(before.entities.map((entity) => [entity.id, entity]));
  let next = after;

  for (const entity of after.entities) {
    const old = previous.get(entity.id);

    if (!old?.lastSeen || !entity.lastSeen || dateSortValue(entity.lastSeen) === dateSortValue(old.lastSeen)) continue;
    if (daysBetween(old.lastSeen, entity.lastSeen) < REUNION_DAYS || isPlayerEntity(entity)) continue;

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

/**
 * The "since you last saw them" note for one person, or '' when it does not
 * apply: they are a reunion in this scene, or the player is about to meet them
 * (named in the turn) after REUNION_DAYS apart.
 */
export function sinceYouLastSaw(db: AppDatabase, entity: EntityRecord): string {
  if (isPlayerEntity(entity) || isDeceased(entity) || entity.met === false || entity.companion) return '';

  const now = db.state.inStoryDate;
  const reunion = entity.reunion && entity.reunion.seq === db.state.sceneSeq ? entity.reunion : null;
  const lastSeen = reunion?.lastSeen ?? entity.lastSeen;

  if (!lastSeen) return '';
  if (!reunion && (sceneIds(db).has(entity.id) || daysBetween(lastSeen, now) < REUNION_DAYS)) return '';

  const days = daysBetween(lastSeen, now);
  const where = reunion?.lastSeenAt ?? entity.lastSeenAt;
  const parts: string[] = [];
  const life = lifeOf(entity).filter(
    (event) => dateSortValue(event.date) > dateSortValue(lastSeen) && dateSortValue(event.date) <= dateSortValue(now)
  );

  if (life.length) parts.push(`their life: ${life.slice(-3).map((event) => event.text).join('; ')}`);

  const ageThen = entityAge(lastSeen, entity);
  const ageNow = entityAge(now, entity);

  if (ageThen !== undefined && ageNow !== undefined && ageNow > ageThen && ageNow < 20) parts.push(`${ageThen} then, ${ageNow} now`);

  // Named but not here yet: only if they turn up.
  const opening = `${reunion ? '' : 'Only if they appear: '}Since you last saw them (${apartLabel(days)} ago${where ? `, at ${where}` : ''})`;

  if (parts.length === 0) {
    return `${opening}: nothing is known of their life since. Give them one small change of their own that fits who they are (new work, an injury, a move, a new habit), and make it plain on the page so it is kept.`;
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

/** Life events the player knows of, newest first (the bond screen). */
export function knownLife(entity: EntityRecord): LifeEvent[] {
  return lifeOf(entity)
    .filter((event) => event.known)
    .sort((a, b) => dateSortValue(b.date) - dateSortValue(a.date));
}

