// Who is dead. A death is recorded on the person's own record, so the
// narrator, the state tracker and the bonds screen all see it every turn —
// not only as a fact that may or may not make the 10-fact cut.
//
// Someone dies during play only when the state tracker reports `deaths`
// (someone dies on screen, or the player sees the body or is told). A person
// may also start the story dead.

import type { AppDatabase, CalendarDate, EntityRecord } from './types';
import { isPlayer } from './player';

/** Tag left by markAlive, so loading a save never kills them again. */
const REVIVED_TAG = 'revived';

export type DeathMark = {
  date?: CalendarDate;
  cause?: string;
};

/** Dead, whether or not the player knows it yet. */
export function isDeceased(entity: Pick<EntityRecord, 'deceased' | 'status'>): boolean {
  return Boolean(entity.deceased) || entity.status === 'Deceased';
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
  };

  if (previous && previous.cause === deceased.cause) {
    return db;
  }

  const entities = [...db.entities];
  entities[index] = { ...entity, deceased };

  return { ...db, entities };
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

/** People who started out "Deceased" get a death record. Safe on every load. */
export function normalizeDeaths(db: AppDatabase): AppDatabase {
  const entities = db.entities.map((entity) =>
    entity.deceased || entity.status !== 'Deceased' || entity.type !== 'character' ? entity : { ...entity, deceased: {} }
  );

  return entities.some((entity, index) => entity !== db.entities[index]) ? { ...db, entities } : db;
}

/** Once someone died, their bond says so ("Deceased · Teammate"), instead of reading as if they were still alive. */
export function markKnownDeathsOnBonds(db: AppDatabase): AppDatabase {
  let changed = false;

  const bonds = db.bonds.map((bond) => {
    const entity = db.entities.find((item) => item.id === bond.entityId);

    if (!entity || !isDeceased(entity) || /^deceased\b/i.test(bond.status)) {
      return bond;
    }

    changed = true;
    return { ...bond, status: `Deceased · ${bond.status || 'Gone'}`.slice(0, 80) };
  });

  return changed ? { ...db, bonds } : db;
}
