// Bonds: affinity, status and romance stage for each person Kan knows.

import { resolveEntity } from './entities';
import { makeId } from './id';
import { normalizeAttraction, normalizeRelationship } from './romance';
import { clamp } from './util';
import type { AppDatabase, TurnDiff } from './types';

type BondDiff = NonNullable<TurnDiff['bonds']>[number];

export function applyBondDiff(db: AppDatabase, bond: BondDiff): AppDatabase {
  if (!bond?.character || typeof bond.character !== 'string') {
    return db;
  }

  const characterName = bond.character.trim();

  if (!characterName) {
    return db;
  }

  const existingEntity =
    (bond.entityId ? db.entities.find((item) => item.id === bond.entityId) : undefined) ??
    resolveEntity(db, characterName);

  const byEntity = existingEntity
    ? db.bonds.findIndex((item) => item.entityId === existingEntity.id)
    : -1;
  const existingIndex =
    byEntity !== -1
      ? byEntity
      : db.bonds.findIndex(
          (item) => item.characterName.toLowerCase() === characterName.toLowerCase()
        );

  // A bond means you know them now: canon cast members join the bonds list.
  if (existingEntity && existingEntity.met === false) {
    db = {
      ...db,
      entities: db.entities.map((item) =>
        item.id === existingEntity.id ? { ...item, met: true } : item
      ),
    };
  }

  if (existingIndex === -1) {
    let bondEntity = existingEntity;

    if (!bondEntity) {
      bondEntity = {
        id: makeId('entity'),
        name: characterName,
        type: 'character' as const,
        aliases: [],
        status: 'Newly met',
        notes: '',
        mood: 'Unknown',
        appearance: 'Unknown',
        tags: [],
      };
    }

    const newBond = {
      id: makeId('bond'),
      entityId: bondEntity.id,
      characterName: bondEntity.name,
      affinity: clamp(
        typeof bond.affinityDelta === 'number' ? bond.affinityDelta : 0,
        -10,
        10
      ),
      status: bond.status?.trim() || 'Acquaintance',
      lastKeyEventId: null,
      note: bond.note?.trim() || '',
      isMajor: Boolean(bond.isMajor),
      relationship: normalizeRelationship(bond.relationship),
      attraction: normalizeAttraction(bond.attraction),
      romanceNote: bond.romanceNote?.trim() || undefined,
      updatedInStoryDate: db.state.inStoryDate,
    };

    const entities = bondEntity && !db.entities.some((item) => item.id === bondEntity.id)
      ? [...db.entities, bondEntity]
      : db.entities;

    return {
      ...db,
      entities,
      bonds: [...db.bonds, newBond],
    };
  }

  const bonds = [...db.bonds];
  const existing = bonds[existingIndex];

  bonds[existingIndex] = {
    ...existing,
    characterName: existingEntity?.name ?? existing.characterName,
    affinity: clamp(
      existing.affinity +
        (typeof bond.affinityDelta === 'number' ? bond.affinityDelta : 0),
      -10,
      10
    ),
    status: bond.status?.trim() || existing.status,
    note: bond.note?.trim() || existing.note,
    isMajor: typeof bond.isMajor === 'boolean' ? bond.isMajor : existing.isMajor,
    relationship:
      normalizeRelationship(bond.relationship) ?? existing.relationship ?? 'stranger',
    attraction:
      normalizeAttraction(bond.attraction) ?? existing.attraction ?? 'none',
    romanceNote: bond.romanceNote?.trim() || existing.romanceNote,
    updatedInStoryDate: db.state.inStoryDate,
  };

  return {
    ...db,
    bonds,
  };
}
