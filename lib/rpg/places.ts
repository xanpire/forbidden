// Places: the world is a flat list of places the player wrote (home, work,
// the bar, someone's apartment), each with a short description and who lives
// or works there. There is no map, no regions and no travel days: getting
// around is narrated in present-day terms and takes minutes or hours.
//
// This module knows what kind of place
// the player is at (a building, the street, a road or station, outdoors), and
// where the people the player knows are, as far as the player knows.

import { daysBetween } from './calendar';
import { companionsOf } from './companions';
import { isDeceased } from './deaths';
import { isPlayer } from './player';
import type { AppDatabase, EntityRecord, LocationKind } from './types';

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// What kind of place

const KIND_WORDS: Record<LocationKind, string[]> = {
  structure: [
    'apartment', 'flat', 'house', 'home', 'room', 'bedroom', 'bathroom', 'kitchen', 'office', 'bar', 'pub', 'club',
    'restaurant', 'cafe', 'café', 'shop', 'store', 'hotel', 'motel', 'gym', 'hospital', 'studio', 'loft', 'basement',
    'garage', 'lobby', 'elevator', 'hallway', 'warehouse', 'theatre', 'theater', 'cinema', 'library', 'school', 'church',
  ],
  settlement: ['street', 'avenue', 'square', 'plaza', 'market', 'downtown', 'neighbourhood', 'neighborhood', 'district', 'city', 'town', 'corner', 'sidewalk', 'alley'],
  road: ['road', 'highway', 'motorway', 'bridge', 'station', 'airport', 'platform', 'bus stop', 'parking', 'car park', 'car', 'taxi', 'train', 'subway', 'metro'],
  wilderness: ['park', 'beach', 'forest', 'woods', 'lake', 'river', 'mountain', 'trail', 'field', 'garden', 'countryside', 'shore', 'coast', 'rooftop'],
};

function earliestMatch(text: string, words: string[]) {
  let best = -1;

  for (const word of words) {
    const index = new RegExp(`\\b${escape(word)}\\b`).exec(text)?.index ?? -1;

    if (index !== -1 && (best === -1 || index < best)) best = index;
  }

  return best;
}

/** The kind of place a location's words describe ("the bar on Elm Street" is a building). */
export function classifyLocation(text: string): LocationKind {
  const lower = text.toLowerCase();
  const found = (Object.keys(KIND_WORDS) as LocationKind[])
    .map((kind) => ({ kind, index: earliestMatch(lower, KIND_WORDS[kind]) }))
    .filter((item) => item.index !== -1)
    .sort((a, b) => a.index - b.index);

  return found[0]?.kind ?? 'structure';
}

/**
 * Checks the state model's location kind against the place's own name: when
 * the name says one kind ("a park") and nothing in it fits the kind given
 * ("structure"), the name wins.
 */
export function validateLocationKind(location: string, given: LocationKind | undefined): LocationKind {
  if (!given) return classifyLocation(location);

  const lower = location.toLowerCase();
  const fitsGiven = earliestMatch(lower, KIND_WORDS[given]) !== -1;
  const named = (Object.keys(KIND_WORDS) as LocationKind[]).some((kind) => earliestMatch(lower, KIND_WORDS[kind]) !== -1);

  return !fitsGiven && named ? classifyLocation(location) : given;
}

export function locationKindOf(db: AppDatabase): LocationKind {
  const kind = db.state.locationKind;

  if (kind === 'settlement' || kind === 'road' || kind === 'wilderness' || kind === 'structure') return kind;

  return classifyLocation(`${db.state.location} ${db.state.scene}`);
}

// ---------------------------------------------------------------------------
// Where people are, as far as the player knows

export type KnownWhereabouts = {
  entity: EntityRecord;
  /** told: the story said where they went; seen: where you last saw them; with-you: with you now. */
  basis: 'told' | 'seen' | 'with-you';
  /** In your words, for the bond page ("At work", "Last seen at the bar"). */
  detail: string;
  /** How old that knowledge is, in days. */
  daysOld?: number;
};

/**
 * Where someone the player has met is, as far as they know: with them, what
 * they were told, or where they last saw them. Never the truth the save holds.
 */
export function whereaboutsOf(db: AppDatabase, entity: EntityRecord): KnownWhereabouts | null {
  if (entity.type !== 'character' || isPlayer(db, entity) || entity.met === false || isDeceased(entity)) return null;

  if (companionsOf(db).some((item) => item.id === entity.id)) {
    return { entity, basis: 'with-you', detail: 'With you' };
  }

  const daysOld = entity.lastSeen ? Math.max(0, daysBetween(entity.lastSeen, db.state.inStoryDate)) : undefined;
  const ago = daysOld === undefined ? '' : daysOld < 1 ? 'today' : daysOld < 2 ? 'yesterday' : `${Math.round(daysOld)} days ago`;

  if (entity.whereabouts) {
    return { entity, basis: 'told', detail: entity.whereabouts.charAt(0).toUpperCase() + entity.whereabouts.slice(1), daysOld };
  }

  if (entity.lastSeenAt) {
    return { entity, basis: 'seen', detail: `Last seen at ${entity.lastSeenAt}${ago ? `, ${ago}` : ''}`, daysOld };
  }

  return null;
}
