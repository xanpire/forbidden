// Who is dead. A death is recorded on the person's own record, so the
// narrator, the state tracker and the bonds screen all see it every turn —
// not only as a fact that may or may not make the 10-fact cut.
//
// Two ways someone dies during play:
// - a timeline event fires (its `deaths`), stamped with that event, so the
//   player only "knows" once that news reaches them or they were there;
// - the state tracker reports `deaths` (someone dies on screen, or the player sees
//   the body or is told), which the player knows at once.
//
// What the player knows matters: the bonds screen never shows a death before the
// story has told them, so it cannot spoil news that is still on its way.

import { eventIdFor } from './timeline';
import type { AppDatabase, CalendarDate, EntityRecord } from './types';
import { isPlayer } from './player';

/** Tag left by markAlive, so loading a save never kills them again. */
const REVIVED_TAG = 'revived';

export type DeathMark = {
  date?: CalendarDate;
  cause?: string;
  /** The player saw it or was told. */
  known?: boolean;
  /** The timeline event that killed them; the player knows once this news is heard. */
  timelineEventId?: string;
};

/** Dead, whether or not the player knows it yet. */
export function isDeceased(entity: Pick<EntityRecord, 'deceased' | 'status'>): boolean {
  return Boolean(entity.deceased) || entity.status === 'Deceased';
}

/** Dead, and the story has let the player know. */
export function playerKnowsDeath(db: AppDatabase, entity: EntityRecord): boolean {
  if (!isDeceased(entity)) {
    return false;
  }

  const death = entity.deceased;

  if (!death) {
    // Seeded as deceased with no record (old saves): treat as known.
    return true;
  }

  if (death.known) {
    return true;
  }

  return Boolean(death.timelineEventId && db.state.timelineProgress?.heard?.[death.timelineEventId]);
}

export function markDeceased(db: AppDatabase, entityId: string, mark: DeathMark): AppDatabase {
  const index = db.entities.findIndex((entity) => entity.id === entityId);

  if (index === -1) {
    return db;
  }

  const entity = db.entities[index];

  if (entity.type !== 'character' || isPlayer(db, entity)) {
    return db;
  }

  const previous = entity.deceased;
  const cause = mark.cause?.trim().slice(0, 120);
  const deceased = {
    date: previous?.date ?? mark.date ?? db.state.inStoryDate,
    ...(previous?.cause || cause ? { cause: previous?.cause || cause } : {}),
    known: Boolean(previous?.known || mark.known),
    ...(previous?.timelineEventId || mark.timelineEventId
      ? { timelineEventId: previous?.timelineEventId ?? mark.timelineEventId }
      : {}),
  };

  if (
    previous &&
    previous.known === deceased.known &&
    previous.timelineEventId === deceased.timelineEventId &&
    previous.cause === deceased.cause
  ) {
    return db;
  }

  const entities = [...db.entities];
  entities[index] = { ...entity, deceased };

  return { ...db, entities };
}

/**
 * Timeline deaths, by exact name or alias only (identities included, since
 * this is the world's own data), so a similar name never lands on the wrong
 * person. People the save does not have are skipped.
 */
/** Every name a person goes by in the world's own data, identities included. */
function identityNames(entity: EntityRecord): string[] {
  // Never a name someone else owns (a claimed identity marked alias: false).
  const identities = (entity.identities ?? []).filter((identity) => identity.alias !== false);

  return [
    entity.name,
    ...entity.aliases,
    ...identities.map((identity) => identity.name),
    ...identities.map((identity) => identity.name.split(/\s+/)[0]),
  ];
}

export function markDeathsByName(db: AppDatabase, names: string[], mark: DeathMark): AppDatabase {
  let next = db;

  for (const name of names) {
    const wanted = name.trim().toLowerCase();
    const entity = next.entities.find(
      (item) =>
        item.type === 'character' &&
        // World data, not story text: an identity the player hasn't learned still
        // finds its person, without revealing it anywhere.
        identityNames(item).some((candidate) => candidate.trim().toLowerCase() === wanted)
    );

    if (entity) {
      next = markDeceased(next, entity.id, mark);
    }
  }

  return next;
}

/** A genuine return to life (or a death recorded by mistake). */
export function markAlive(db: AppDatabase, entityId: string): AppDatabase {
  const index = db.entities.findIndex((entity) => entity.id === entityId);

  if (index === -1 || !isDeceased(db.entities[index])) {
    return db;
  }

  const { deceased: _dropped, ...rest } = db.entities[index];
  const entities = [...db.entities];
  entities[index] = {
    ...rest,
    status: rest.status === 'Deceased' ? 'Alive' : rest.status,
    tags: rest.tags.includes(REVIVED_TAG) ? rest.tags : [...rest.tags, REVIVED_TAG],
  };

  return { ...db, entities };
}

/**
 * Brings older saves up to date when they load:
 * - timeline events that already fired mark their dead;
 * - people who started out "Deceased" get a death record. If a timeline
 *   event names them the player knows once that news is heard; otherwise
 *   they already know.
 * Safe to run on every load: nothing changes once the records exist.
 */
export function normalizeDeaths(db: AppDatabase): AppDatabase {
  let next = db;
  const fired = new Set(next.events.map((event) => event.id));
  const timelineDeathEvent = new Map<string, string>();

  for (const milestone of next.world?.timeline ?? []) {
    const eventId = eventIdFor(milestone.id);

    for (const name of milestone.deaths ?? []) {
      timelineDeathEvent.set(name.toLowerCase(), eventId);
    }

    if (!milestone.deaths?.length || !fired.has(eventId)) {
      continue;
    }

    const event = next.events.find((item) => item.id === eventId);
    const living = {
      ...next,
      entities: next.entities.filter((entity) => !entity.tags?.includes(REVIVED_TAG)),
    };
    const marked = markDeathsByName(living, milestone.deaths, {
      date: event?.inStoryDate,
      timelineEventId: eventId,
    });

    if (marked !== living) {
      const byId = new Map(marked.entities.map((entity) => [entity.id, entity]));
      next = { ...next, entities: next.entities.map((entity) => byId.get(entity.id) ?? entity) };
    }
  }

  const entities = next.entities.map((entity) => {
    if (entity.deceased || entity.status !== 'Deceased' || entity.type !== 'character') {
      return entity;
    }

    const eventId = identityNames(entity)
      .map((name) => timelineDeathEvent.get(name.toLowerCase()))
      .find(Boolean);

    return {
      ...entity,
      deceased: eventId ? { known: false, timelineEventId: eventId } : { known: true },
    };
  });

  return entities.some((entity, index) => entity !== next.entities[index]) ? { ...next, entities } : next;
}

/**
 * Once you know someone died, their bond says so ("Deceased · Teammate"),
 * instead of reading as if they were still alive. Before you know, nothing
 * changes, so the bonds screen never spoils a death.
 */
export function markKnownDeathsOnBonds(db: AppDatabase): AppDatabase {
  let changed = false;

  const bonds = db.bonds.map((bond) => {
    const entity = db.entities.find((item) => item.id === bond.entityId);

    if (!entity || !playerKnowsDeath(db, entity) || /^deceased\b/i.test(bond.status)) {
      return bond;
    }

    changed = true;
    return { ...bond, status: `Deceased · ${bond.status || 'Gone'}`.slice(0, 80) };
  });

  return changed ? { ...db, bonds } : db;
}
