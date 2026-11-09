// What you can see of someone on their profile.
//
// Profiles show what the save holds about a person: what the player wrote for
// them, and what the state tracker kept from the page. Secrets live in facts
// (with who knows them), never in these fields, so nothing here needs hiding.

import type { AppDatabase, EntityRecord } from './types';

type ProfileField = 'role' | 'personality' | 'speechStyle' | 'appearance';

/** One profile field as the player can know it. */
export function shownField(_db: AppDatabase, entity: EntityRecord, field: ProfileField): string | undefined {
  return entity[field] ?? undefined;
}

/** The four profile fields as the player can know them. */
export function shownProfile(db: AppDatabase, entity: EntityRecord) {
  return {
    role: shownField(db, entity, 'role'),
    personality: shownField(db, entity, 'personality'),
    speechStyle: shownField(db, entity, 'speechStyle'),
    appearance: shownField(db, entity, 'appearance'),
  };
}

// ---------------------------------------------------------------------------
// Feelings and grudges

/** How someone seems toward the player, in words: what they can read off them, not a number. */
export function howTheySeem(affinity: number): string {
  if (affinity <= -7) return 'hostile';
  if (affinity <= -4) return 'cold';
  if (affinity <= -1) return 'guarded';
  if (affinity === 0) return 'hard to read';
  if (affinity <= 3) return 'friendly';
  if (affinity <= 6) return 'warm';
  if (affinity <= 8) return 'close';
  return 'devoted';
}

/** The player knows of a grudge once they have acted on it. Until then it stews unseen. */
export function grudgeKnown(grudge: { strikes: number } | undefined | null): boolean {
  return Boolean(grudge && grudge.strikes > 0);
}
