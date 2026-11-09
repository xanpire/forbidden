// Home: where the player lives (the character sheet's `home`), where they are
// staying when it isn't home (`state.stayingAt`: a hotel, a friend's couch),
// and who lives with them (EntityRecord.livesWithYou: a partner, a roommate).
// An ordinary place: no stash, no upgrades, nothing to defend. The state
// tracker reports moves (`home`), and the narrator sees one HOME line.

import { displayName } from './names';
import { isDeceased } from './deaths';
import { isPlayerEntity } from './player';
import type { AppDatabase, EntityRecord, TurnDiff } from './types';

/** Everyone alive who lives with the player. */
export function housemates(db: AppDatabase): EntityRecord[] {
  return db.entities.filter((entity) => entity.type === 'character' && entity.livesWithYou && !isPlayerEntity(entity) && !isDeceased(entity));
}

/** The tracker's home report: a move, a stay elsewhere (or back home), people moving in or out. */
export function applyHome(db: AppDatabase, home: TurnDiff['home']): AppDatabase {
  if (!home) return db;

  let next = db;

  if (home.livesAt) {
    next = { ...next, state: { ...next.state, player: { ...next.state.player, home: home.livesAt }, stayingAt: undefined } };
  }

  if (home.stayingAt !== undefined) {
    const staying = home.stayingAt.trim();
    next = { ...next, state: { ...next.state, stayingAt: staying || undefined } };
  }

  const moved = new Map<string, boolean>([...home.movedIn.map((id) => [id, true] as const), ...home.movedOut.map((id) => [id, false] as const)]);

  if (moved.size > 0) {
    next = {
      ...next,
      entities: next.entities.map((entity) => {
        if (!moved.has(entity.id) || isPlayerEntity(entity)) return entity;

        const { livesWithYou: _old, ...rest } = entity;

        return moved.get(entity.id) ? { ...rest, livesWithYou: true } : rest;
      }),
    };
  }

  return next;
}

/** One line for the narrator: where the player lives, where they are staying, and who lives with them. */
export function formatHomeLine(db: AppDatabase): string {
  const home = db.state.player.home?.trim();
  const staying = db.state.stayingAt?.trim();
  const people = housemates(db).map((entity) => displayName(db, entity));

  if (!home && !staying && people.length === 0) return '';

  return [
    `HOME: ${home || 'not written yet'}`,
    staying ? `; staying at ${staying} for now` : '',
    people.length > 0 ? `; lives with ${people.join(', ')} (they are home when the player is, unless their own day says otherwise)` : '',
    '.',
  ].join('');
}

/** For the state tracker: the rule for reporting home changes. */
export const HOME_TRACKING =
  'home: null unless this turn changes it. lives_at: the new home, only when the player moves. staying_at: where the player is staying when it isn\'t home (a hotel, a friend\'s place), "" when they go back home, null otherwise. moved_in / moved_out: ids of people who start or stop living with the player (a partner moving in, a roommate leaving).';
