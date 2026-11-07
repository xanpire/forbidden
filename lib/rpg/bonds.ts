// Bonds: affinity, status and romance stage for each person Kan knows.

import { resolveEntity } from './entities';
import { makeId } from './id';
import { normalizeAttraction, normalizeRelationship } from './romance';
import { clamp } from './util';
import type { AppDatabase, TurnDiff } from './types';

type BondDiff = NonNullable<TurnDiff['bonds']>[number];

export type BondOptions = {
  /**
   * The turn's scene cast. Given for bonds from the state tracker: someone
   * unmet who isn't here gets no bond. Left out by the app's own callers
   * (letters, companions), which only touch people Kan already knows.
   */
  presentIds?: ReadonlySet<string>;
};

/**
 * A bond change. Never marks anyone met (only the scene cast does, and the
 * first-meeting step gives them their first bond), and never creates a
 * person: the tracker adds people through new_characters.
 */
export function applyBondDiff(db: AppDatabase, bond: BondDiff, options: BondOptions = {}): AppDatabase {
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

  if (!existingEntity) {
    return db;
  }

  // Talked about, not met: no bond until they are in a scene with Kan.
  if (existingEntity.met === false && options.presentIds && !options.presentIds.has(existingEntity.id)) {
    return db;
  }

  if (existingIndex === -1) {
    const bondEntity = existingEntity;

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

    return {
      ...db,
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
