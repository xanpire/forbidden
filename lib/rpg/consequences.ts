// Delayed consequences (living-world Stage 3, section 11).
//
// A choice that could come back later is kept as a seed: who was involved,
// who saw it, what they would want, and roughly when and where it could come
// back. The state tracker plants them (consequences).
//
// A seed only comes back when that is realistic: the person is alive and
// could plausibly cross the player's path (out in public, or present for a
// lie to come out), and enough time has passed. It comes back softly, as an
// optional offer to the narrator (SOMETHING COMES BACK), never forced; the
// tracker marks it returned when it plays out. Seeds that never find a
// fitting moment fade.

import { daysBetween, dateSortValue, shiftDate } from './calendar';
import { castWithCompanions } from './companions';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { makeId } from './id';
import { hashText, playerTurnCount } from './util';
import type { AppDatabase, ConsequenceKind, ConsequenceSeed, EntityRecord, TurnDiff } from './types';
import { isPlayerEntity } from './player';

/** Waiting seeds kept at once; the oldest fade first. */
const MAX_WAITING = 24;
/** Ended seeds kept. */
const MAX_ENDED = 20;
/** An eligible seed is pressed (offered every fitting turn) this long after it could first return. */
const PRESS_AFTER_DAYS = 90;

const KINDS = new Set<ConsequenceKind>(['spared', 'lie', 'helped', 'witness', 'betrayal', 'humiliated', 'promise', 'debt']);

export function seedsOf(db: AppDatabase): ConsequenceSeed[] {
  return Array.isArray(db.state.consequences) ? db.state.consequences : [];
}

function withSeeds(db: AppDatabase, seeds: ConsequenceSeed[]): AppDatabase {
  const waiting = seeds.filter((seed) => seed.status === 'waiting');
  const ended = seeds.filter((seed) => seed.status !== 'waiting');
  const kept = [...ended.slice(-MAX_ENDED), ...waiting.slice(-MAX_WAITING)];

  return { ...db, state: { ...db.state, consequences: kept } };
}

export function normalizeConsequences(raw: unknown): ConsequenceSeed[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  return raw.filter(
    (seed): seed is ConsequenceSeed =>
      Boolean(seed) &&
      typeof seed === 'object' &&
      typeof seed.id === 'string' &&
      KINDS.has(seed.kind) &&
      Boolean(seed.after) &&
      Boolean(seed.before)
  );
}

function windowDays(when: 'weeks' | 'months' | 'years' | undefined, seed: string): number {
  const roll = hashText(seed);

  switch (when) {
    case 'weeks':
      return 14 + (roll % 28);
    case 'years':
      return 300 + (roll % 600);
    default:
      return 45 + (roll % 120);
  }
}

/** Someone whose memory of the player matters to the story. */
export function isImportant(db: AppDatabase, entity: EntityRecord): boolean {
  const bond = db.bonds.find((item) => item.entityId === entity.id);

  return Boolean(
    bond?.isMajor || (bond && Math.abs(bond.affinity) >= 5)
  );
}

export type NewSeed = Omit<ConsequenceSeed, 'id' | 'createdOn' | 'after' | 'before' | 'status'> & {
  when?: 'weeks' | 'months' | 'years';
};

/** Plants one seed. */
export function plantSeed(db: AppDatabase, seed: NewSeed): AppDatabase {
  const now = db.state.inStoryDate;
  const id = makeId('seed');
  const window = windowDays(seed.when, `${db.meta.slotId}:${seed.kind}:${seed.who}:${seed.what}`);
  const after = shiftDate(now, window);
  const { when: _when, ...rest } = seed;

  return withSeeds(db, [
    ...seedsOf(db),
    {
      ...rest,
      id,
      createdOn: now,
      after,
      before: shiftDate(after, Math.max(120, window * 3)),
      status: 'waiting',
    },
  ]);
}

/**
 * The tracker's consequences: plant each, unless the same thing is already
 * waiting. Characters remember it through the seed; nothing is shown to you.
 */
export function applyConsequences(
  db: AppDatabase,
  planted: TurnDiff['consequences'],
  returned: TurnDiff['consequencesReturned'],
  offered: ConsequenceSeed | null
): { db: AppDatabase; remembered: string | null } {
  let next = db;
  let remembered: string | null = null;
  const now = db.state.inStoryDate;

  // Only the offered seed can be marked returned (it was the one in the prompt).
  if (offered && returned?.includes(offered.id)) {
    next = withSeeds(
      next,
      seedsOf(next).map((seed) => (seed.id === offered.id ? { ...seed, status: 'returned', resolvedOn: now } : seed))
    );
  }

  for (const item of planted ?? []) {
    const what = item.what.trim();
    const who = item.who.trim();

    if (!what || !who || !KINDS.has(item.kind)) continue;

    const entity = item.entityId ? next.entities.find((person) => person.id === item.entityId) : resolveEntity(next, who);

    if (entity && isPlayerEntity(entity)) continue;

    const duplicate = seedsOf(next).some(
      (seed) =>
        seed.status === 'waiting' &&
        seed.kind === item.kind &&
        (seed.entityId ? seed.entityId === entity?.id : seed.who.toLowerCase() === who.toLowerCase())
    );

    if (duplicate) continue;

    const witnesses = (item.witnesses ?? [])
      .map((name) => resolveEntity(next, name)?.id)
      .filter((id): id is string => Boolean(id) && id !== entity?.id);

    next = plantSeed(next, {
      kind: item.kind,
      entityId: entity?.id,
      who: entity?.name ?? who,
      what,
      want: item.want?.trim() || undefined,
      witnesses,
      when: item.when,
    });

    if (!remembered && entity && isImportant(next, entity)) {
      remembered = entity.name;
    }
  }

  return { db: next, remembered };
}

/** Seeds whose time ran out fade. Runs every turn. */
export function advanceConsequences(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  let changed = false;
  const seeds = seedsOf(db).map((seed) => {
    if (seed.status !== 'waiting') return seed;

    const person = seed.entityId ? db.entities.find((entity) => entity.id === seed.entityId) : null;

    // The person it would come back through is gone.
    if (person && isDeceased(person)) {
      changed = true;
      return { ...seed, status: 'faded' as const, resolvedOn: now };
    }

    if (dateSortValue(now) > dateSortValue(seed.before)) {
      changed = true;
      return { ...seed, status: 'faded' as const, resolvedOn: now };
    }

    return seed;
  });

  return changed ? withSeeds(db, seeds) : db;
}

// ---------------------------------------------------------------------------
// Coming back

function sceneIds(db: AppDatabase): Set<string> {
  const ids = new Set<string>();

  for (const name of castWithCompanions(db, db.state.sceneCast ?? [])) {
    const entity = resolveEntity(db, name);

    if (entity) ids.add(entity.id);
  }

  return ids;
}

/** Could this seed realistically come back here and now? */
export function canReturn(db: AppDatabase, seed: ConsequenceSeed): boolean {
  if (seed.status !== 'waiting' || dateSortValue(db.state.inStoryDate) < dateSortValue(seed.after)) return false;

  const here = sceneIds(db);
  // Out in public (a street, a bar, a station), people cross paths; alone at home, nobody turns up unasked.
  const kind = db.state.locationKind ?? 'structure';
  const home = db.state.player.home?.trim().toLowerCase();
  const atHome = Boolean(home && db.state.location.toLowerCase().includes(home));
  const out = !atHome && kind !== 'wilderness';
  const person = seed.entityId ? db.entities.find((entity) => entity.id === seed.entityId) ?? null : null;

  if (person && (isDeceased(person) || (person.companion && !['lie', 'betrayal', 'promise', 'debt'].includes(seed.kind)))) {
    return false;
  }

  switch (seed.kind) {
    // These come out face to face: the person has to be here.
    case 'lie':
    case 'betrayal':
    case 'promise':
    case 'debt':
      return person ? here.has(person.id) : out;
    // Talk and gratitude reach the player out among people.
    case 'helped':
    case 'witness':
      return out;
    // Spared, humiliated: they turn up where the player is, or are already here.
    default:
      return person ? here.has(person.id) || out : out;
  }
}

/** The one seed that may come back this turn, or null. Deterministic per turn. */
export function consequenceOffer(db: AppDatabase): ConsequenceSeed | null {
  if (db.state.scenePace === 'action') return null;

  const turn = playerTurnCount(db);
  const now = db.state.inStoryDate;
  const eligible = seedsOf(db)
    .filter((seed) => canReturn(db, seed))
    .sort((a, b) => dateSortValue(a.after) - dateSortValue(b.after));

  for (const seed of eligible) {
    const pressed = daysBetween(seed.after, now) >= PRESS_AFTER_DAYS;

    if (pressed || hashText(`${db.meta.slotId}:seed:${seed.id}:${turn}`) % 3 === 0) return seed;
  }

  return null;
}

/** The seed the narrator is offered this turn. */
export function turnConsequenceOffer(db: AppDatabase): ConsequenceSeed | null {
  return consequenceOffer(db);
}

function agoLabel(days: number) {
  if (days >= 700) return `${Math.round(days / 365)} years`;
  if (days >= 330) return 'about a year';
  if (days >= 50) return `${Math.round(days / 30)} months`;
  return `${Math.max(1, Math.round(days / 7))} weeks`;
}

const HOW: Record<ConsequenceKind, string> = {
  spared: 'They could turn up grateful or bitter: a warning, a favour repaid, or a knife.',
  lie: 'The lie can come out now: something they saw, heard, or were told.',
  helped: 'The people you helped remember: shelter, a warning, food, a door that opens.',
  witness: 'Someone who saw it talked: people around you have heard a version of it, and it has grown.',
  betrayal: 'They have not forgotten, and they have not forgiven.',
  humiliated: 'They have not forgotten how it felt.',
  promise: 'Someone comes to see whether you kept your word.',
  debt: 'Someone comes to collect.',
};

export function formatConsequenceOffer(db: AppDatabase, seed: ConsequenceSeed | null): string {
  if (!seed) return '';

  const ago = agoLabel(daysBetween(seed.createdOn, db.state.inStoryDate));
  const how = HOW[seed.kind];

  return [
    `SOMETHING COMES BACK (optional: use it only if it fits this scene; never forced). ${ago} ago: ${seed.what} (${seed.who}).`,
    seed.want ? `What they want now: ${seed.want}.` : '',
    how,
    `Make it realistic: show how it found you. If it does not fit, leave it for another time.`,
  ]
    .filter(Boolean)
    .join(' ');
}

export function consequenceTrackingLines(seed: ConsequenceSeed | null): string[] {
  const lines = [
    `consequences: only for a real choice someone would remember that could plausibly come back later: you let someone off, lie to someone, help someone in need, do something others saw and will talk about, betray, humiliate, promise, or owe someone. kind (spared, lie, helped, witness, betrayal, humiliated, promise, debt); character_id (their id, or null for someone unnamed); who (their name, or a short description: 'the guy you shoved outside the bar'); what (what you did, second person); want (what they would want now); witnesses (ids); when (weeks, months, years: how soon it could return). Most turns [].`,
    `grudges: {character_id, event, reason} when someone starts holding a real grudge against you this turn (wronged: you truly hurt, cheated or humiliated them), when it is settled (settled: amends, a reckoning, or their revenge), or forgiven (forgiven: they let it go for a clear reason on the page); otherwise [].`,
  ];

  if (seed) {
    lines.push(`consequence ${seed.id} (${seed.what}): consequences_returned ["${seed.id}"] only if it actually came back on the page this turn.`);
  }

  return lines;
}

/** Applying the turn's offer: remember it was offered today. */
export function markConsequenceOffered(db: AppDatabase, seed: ConsequenceSeed | null): AppDatabase {
  if (!seed) return db;

  return withSeeds(
    db,
    seedsOf(db).map((item) => (item.id === seed.id && item.status === 'waiting' ? { ...item, offeredOn: db.state.inStoryDate } : item))
  );
}

