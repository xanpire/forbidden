import { daysBetween, entityAge } from './calendar';
import { narratorName } from './names';
import { mentionsEntity } from './characterRefs';
import { isDeceased } from './deaths';
import { locationKindOf } from './places';
import type { AppDatabase, BondRecord, EntityRecord, LocationKind } from './types';
import { isPlayerEntity } from './player';

/**
 * Characters who come back.
 *
 * Every so often the narrator is offered ONE person the player has a bond with
 * and has not seen in a while, who would plausibly be at the current place:
 * they were last seen there, their role or notes tie them to it, or their work
 * keeps them out and about (a driver, a courier) and the player is out in town.
 * The offer is optional; the narrator uses it only if it fits.
 *
 * The choice is deterministic (slot + turn), so regenerating a turn gets the
 * same offer, and once someone resurfaces their lastSeen resets and they drop
 * out of the pool.
 */

/** Player turns per window; at most one offer per window. */
export const RETURN_WINDOW_TURNS = 8;
/** In-story days since the player last saw them before they can be offered. */
export const RETURN_MIN_DAYS_AWAY = 14;
/** No offers in the first few turns of a story. */
const RETURN_MIN_TURN = 6;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'near', 'outside', 'inside', 'edge', 'side', 'just',
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western',
  'upper', 'lower', 'old', 'new', 'small', 'little', 'great', 'big', 'deep',
  'neighbourhood', 'neighborhood', 'area', 'downtown', 'uptown', 'somewhere',
  'town', 'city', 'street', 'road', 'avenue', 'lane', 'park', 'outskirts',
  'room', 'house', 'home', 'place', 'there', 'from', 'with', 'into',
  'toward', 'towards', 'between', 'along', 'beyond', 'above', 'below', 'under',
  'district', 'market', 'station',
  'corner', 'block', 'square', 'plaza', 'shop', 'cafe', 'bar', 'office', 'flat', 'apartment',
]);

const OUT_AND_ABOUT_ROLE =
  /\b(salesman|saleswoman|sales rep|courier|driver|delivery|rider|performer|musician|busker|journalist|reporter|photographer|trucker|tour guide|street vendor)\b/i;

export type ReturningOffer = {
  entity: EntityRecord;
  bond: BondRecord;
  daysAway: number;
  reason: 'last-seen-here' | 'tied-to-place' | 'out-and-about';
};

function hash(text: string) {
  let value = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }

  return value >>> 0;
}

export function placeTokens(text: string | undefined): Set<string> {
  if (!text) {
    return new Set();
  }

  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length >= 3 && !STOPWORDS.has(word))
  );
}

function overlaps(a: Set<string>, b: Set<string>) {
  for (const word of a) {
    if (b.has(word)) {
      return true;
    }
  }

  return false;
}

function playerTurn(db: AppDatabase) {
  return db.rawLog.filter((entry) => entry.kind === 'story' && entry.role === 'user').length;
}

/** True on the one turn of each window that may carry an offer. */
export function isReturnTurn(db: AppDatabase, turn = playerTurn(db)) {
  if (turn < RETURN_MIN_TURN) {
    return false;
  }

  const window = Math.floor(turn / RETURN_WINDOW_TURNS);
  const slot = hash(`${db.meta.slotId}:${window}`) % RETURN_WINDOW_TURNS;

  return turn % RETURN_WINDOW_TURNS === slot;
}

/** Someone the story is free to bring back: a character, not the player. */
export function isFreeCharacter(_db: AppDatabase, entity: EntityRecord) {
  return entity.type === 'character' && !isPlayerEntity(entity);
}

function fitFor(
  entity: EntityRecord,
  here: Set<string>,
  kind: LocationKind
): { score: number; reason: ReturningOffer['reason'] } | null {
  if (here.size > 0 && overlaps(placeTokens(entity.lastSeenAt), here)) {
    return { score: 3, reason: 'last-seen-here' };
  }

  if (here.size > 0 && overlaps(placeTokens(`${entity.role ?? ''} ${entity.notes ?? ''}`), here)) {
    return { score: 2, reason: 'tied-to-place' };
  }

  if ((kind === 'road' || kind === 'settlement') && OUT_AND_ABOUT_ROLE.test(entity.role ?? '')) {
    return { score: 1, reason: 'out-and-about' };
  }

  return null;
}

/**
 * Everyone who could come back here right now, best fit first. Ignores the
 * turn cadence (see pickReturningCharacter).
 */
export function returningCandidates(db: AppDatabase, recentText = ''): ReturningOffer[] {
  const kind = locationKindOf(db);
  const here = placeTokens(db.state.location);
  const cast = new Set((db.state.sceneCast ?? []).map((name) => name.toLowerCase()));
  const now = db.state.inStoryDate;

  const offers: Array<ReturningOffer & { score: number }> = [];

  for (const entity of db.entities) {
    // Companions never left, so they can't come back.
    if (!isFreeCharacter(db, entity) || entity.met === false || isDeceased(entity) || entity.companion || !entity.lastSeen) {
      continue;
    }

    if ([entity.name, ...entity.aliases].some((name) => cast.has(name.toLowerCase()))) {
      continue;
    }

    // Already part of the conversation: no need to bring them back.
    if (recentText && mentionsEntity(recentText, entity)) {
      continue;
    }

    const daysAway = daysBetween(entity.lastSeen, now);

    if (daysAway < RETURN_MIN_DAYS_AWAY) {
      continue;
    }

    const fit = fitFor(entity, here, kind);

    if (!fit) {
      continue;
    }

    // Only people the player has a bond with come back.
    const bond = db.bonds.find((item) => item.entityId === entity.id);

    if (!bond) {
      continue;
    }

    const score = fit.score + (bond.isMajor ? 1 : 0);

    offers.push({ entity, bond, daysAway, reason: fit.reason, score });
  }

  return offers
    .sort((a, b) => b.score - a.score || b.daysAway - a.daysAway)
    .map(({ score: _score, ...offer }) => offer);
}

/**
 * The one character to offer this turn, or null. Only on the window's offer
 * turn, never in the middle of a quick physical scene or an intimate one, and
 * never out in nature at night where nobody would be around.
 */
export function pickReturningCharacter(db: AppDatabase, recentText = ''): ReturningOffer | null {
  if (!isReturnTurn(db) || db.state.scenePace === 'action' || db.state.sceneMode?.current === 'intimate') {
    return null;
  }

  if (locationKindOf(db) === 'wilderness' && db.state.inStoryDate.hour >= 22) {
    return null;
  }

  const candidates = returningCandidates(db, recentText);

  if (candidates.length === 0) {
    return null;
  }

  // Rotate among the best few so the same person is not offered every time.
  const top = candidates.slice(0, 3);
  const window = Math.floor(playerTurn(db) / RETURN_WINDOW_TURNS);

  return top[hash(`${db.meta.slotId}:pick:${window}`) % top.length];
}

function formatAway(days: number) {
  if (days < 21) return `${days} days`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks`;
  if (days < 365 * 2) return `about ${Math.max(2, Math.round(days / 30))} months`;

  return `about ${Math.round(days / 365)} years`;
}

function clip(text: string | undefined, max: number) {
  const value = (text ?? '').trim();

  if (!value || value === 'Unknown') return '';

  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

export function formatReturningCharacter(db: AppDatabase, recentText = '') {
  const offer = pickReturningCharacter(db, recentText);

  if (!offer) {
    return '';
  }

  const { entity, bond, daysAway, reason } = offer;
  const age = entityAge(db.state.inStoryDate, entity);
  const who = [narratorName(db, entity), age !== undefined ? `age ${age}` : '', clip(entity.role, 50)]
    .filter(Boolean)
    .join(', ');
  const where = entity.lastSeenAt ? ` at ${entity.lastSeenAt}` : '';
  const why =
    reason === 'last-seen-here'
      ? 'you last met them around here'
      : reason === 'tied-to-place'
        ? 'they have ties to this place'
        : 'their work keeps them out and about';
  const bondLine = `Between them: ${clip(bond.status, 60) || 'they know each other'}${clip(bond.note, 90) ? ` (${clip(bond.note, 90)})` : ''}.`;
  const traits = [clip(entity.personality, 90), clip(entity.speechStyle, 60)].filter(Boolean).join(' ');

  return [
    'A FAMILIAR FACE (optional)',
    `${who}. Last seen ${formatAway(daysAway)} ago${where}; ${why}. ${bondLine}${traits ? ` ${traits}` : ''}`,
    'If it fits the scene naturally, they can resurface: a face in the crowd, a voice at the next table, word that they are nearby, or them seeking you out. They remember you and have lived their own life since. If you use them, they are this turn\'s encounter; if it does not fit, ignore this.',
  ].join('\n');
}
