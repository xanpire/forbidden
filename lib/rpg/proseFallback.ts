// What a turn can still record when the state model's reply was unreadable.
// The clock and pace are read from the prose elsewhere (timeparse, pacing);
// this suggests who the prose shows (never applied: only the state reply's
// characters_present can say who is there).

import { mentionsEntity } from './characterRefs';
import { isCompanion } from './companions';
import type { AppDatabase, TurnDiff } from './types';
import { isPlayer } from './player';

function sentences(text: string) {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Known characters the narration shows in the scene. */
export function presentFromProse(db: AppDatabase, narration: string): string[] {
  if (!narration.trim()) {
    return [];
  }

  const parts = sentences(narration);
  const cast = new Set((db.state.sceneCast ?? []).map((name) => name.toLowerCase()));
  const present: string[] = [];

  for (const entity of db.entities) {
    if (
      entity.type !== 'character' ||
      isPlayer(db, entity) ||
      entity.deceased ||
      entity.status === 'Deceased'
    ) {
      continue;
    }

    const hits = parts.filter((part) => mentionsEntity(part, entity)).length;

    if (hits === 0) {
      continue;
    }

    // A single passing mention ("rumours about the mayor") isn't enough for
    // someone new; it is for someone already here or travelling with the player.
    const alreadyHere =
      isCompanion(entity) ||
      cast.has(entity.name.toLowerCase()) ||
      entity.aliases.some((alias) => cast.has(alias.toLowerCase()));

    if (alreadyHere || hits >= 2) {
      present.push(entity.name);
    }
  }

  return present.slice(0, 8);
}

/** The diff a turn gets when the state model's reply couldn't be read. */
export function fallbackDiffFromProse(
  db: AppDatabase,
  turn: { userMessage: string; narration: string }
): TurnDiff | null {
  const present = presentFromProse(db, turn.narration);

  if (present.length === 0) {
    return null;
  }

  // Only a suggestion: reading names in prose never marks anyone met or
  // seen, and never changes the scene cast (the last one carries on).
  return { suggestedCast: present };
}
