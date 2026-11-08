// The map (living-world Stage 4, section 14).
//
// A stylised map of the shinobi world built on the same geography as the
// GEOGRAPHY lore and geography.ts: the countries, the great villages, the
// places the story uses (the Naka Shrine and the Uzumaki mask shrine in the
// Leaf, Karin's Grass, Uzushio's ruins, the Land of Silence), Kan's road over
// time, and where the people he knows are, as far as he knows. That last part
// is what he was told or last saw, never the truth the save holds.
//
// Coordinates are on a 100 × 90 board (x east, y south).

import { daysBetween } from './calendar';
import { companionsOf } from './companions';
import { isDeceased, kanKnowsDeath } from './deaths';
import {
  REGION_NAME,
  currentRegion,
  isRegion,
  regionOf,
  travelDaysBetween,
  whereaboutsRegion,
  type Region,
} from './geography';
import { localizePlaceNames } from './glossary';
import type { AppDatabase, CalendarDate, EntityRecord, TravelStop } from './types';
import { hashText } from './util';
import { regionWeather, weatherTravelFactor } from './weather';

export const MAP_WIDTH = 100;
export const MAP_HEIGHT = 90;

export type RegionShape = { x: number; y: number; rx: number; ry: number; label: string; sea?: boolean };

/** Rough country shapes, placed as the GEOGRAPHY lore describes them. */
export const REGION_SHAPES: Record<Region, RegionShape> = {
  fire: { x: 60, y: 60, rx: 15, ry: 12, label: 'Fire' },
  rice: { x: 57, y: 41, rx: 7, ry: 5, label: 'Rice Fields' },
  waterfall: { x: 69, y: 39, rx: 5, ry: 4, label: 'Waterfalls' },
  'hot-water': { x: 78, y: 45, rx: 5, ry: 4, label: 'Hot Water' },
  rain: { x: 39, y: 54, rx: 6, ry: 6, label: 'Rain' },
  grass: { x: 40, y: 40, rx: 6, ry: 5, label: 'Grass' },
  rivers: { x: 38, y: 69, rx: 7, ry: 5, label: 'Rivers' },
  wind: { x: 15, y: 66, rx: 13, ry: 13, label: 'Wind' },
  earth: { x: 20, y: 28, rx: 13, ry: 11, label: 'Earth' },
  iron: { x: 52, y: 12, rx: 10, ry: 6, label: 'Iron' },
  lightning: { x: 85, y: 15, rx: 11, ry: 9, label: 'Lightning', sea: true },
  water: { x: 92, y: 59, rx: 6, ry: 10, label: 'Water', sea: true },
  waves: { x: 77, y: 77, rx: 5, ry: 4, label: 'Waves' },
  whirlpools: { x: 88, y: 81, rx: 4, ry: 3.5, label: 'Whirlpools', sea: true },
};

export type MapPlaceKind = 'village' | 'place' | 'shrine' | 'ruin' | 'hideout';

export type MapPlace = {
  id: string;
  name: string;
  /** null for places off every road Kan knows (the Land of Silence). */
  region: Region | null;
  x: number;
  y: number;
  kind: MapPlaceKind;
  /** Matches the story's location text. */
  match: RegExp;
  /** A place inside another (a shrine in the Leaf): listed under it, drawn with it. */
  parent?: string;
  note?: string;
};

export const MAP_PLACES: MapPlace[] = [
  { id: 'leaf', name: 'Hidden Leaf', region: 'fire', x: 60, y: 59, kind: 'village', match: /\b(hidden leaf|konoha(gakure)?|leaf village|the Leaf)\b/i },
  { id: 'uchiha-district', name: 'Uchiha district', region: 'fire', x: 60, y: 59, kind: 'ruin', parent: 'leaf', match: /\buchiha (district|compound|quarter)\b/i, note: 'Your clan’s streets, empty since the massacre.' },
  { id: 'naka-shrine', name: 'Naka Shrine', region: 'fire', x: 60, y: 59, kind: 'shrine', parent: 'leaf', match: /\bnaka shrine\b/i, note: 'The Uchiha stone tablet lies beneath it.' },
  { id: 'naka-river', name: 'Naka River', region: 'fire', x: 60, y: 59, kind: 'place', parent: 'leaf', match: /\bnaka river\b/i },
  { id: 'mask-shrine', name: 'Uzumaki mask shrine', region: 'fire', x: 60, y: 59, kind: 'shrine', parent: 'leaf', match: /\b(uzumaki )?mask shrine\b/i, note: 'Kept by the Uzumaki since Uzushio fell, on the edge of the Leaf.' },
  { id: 'valley-end', name: 'Valley of the End', region: 'fire', x: 56, y: 47, kind: 'place', match: /\bvalley of the end\b/i },
  { id: 'tanzaku', name: 'Tanzaku Town', region: 'fire', x: 52, y: 66, kind: 'place', match: /\btanzaku\b/i },
  { id: 'fire-temple', name: 'Fire Temple', region: 'fire', x: 68, y: 52, kind: 'shrine', match: /\bfire temple\b/i },
  { id: 'sand', name: 'Hidden Sand', region: 'wind', x: 14, y: 67, kind: 'village', match: /\b(hidden sand|sunagakure|the Sand)\b/i },
  { id: 'rain', name: 'Hidden Rain', region: 'rain', x: 38, y: 55, kind: 'village', match: /\b(hidden rain|amegakure|the Rain)\b/i, note: 'The Akatsuki’s stronghold, in the tower.' },
  { id: 'grass', name: 'Hidden Grass', region: 'grass', x: 40, y: 38.5, kind: 'village', match: /\b(hidden grass|kusagakure)\b/i, note: 'Where Karin is from.' },
  { id: 'waterfall', name: 'Hidden Waterfall', region: 'waterfall', x: 69, y: 37.5, kind: 'village', match: /\b(hidden waterfall|takigakure)\b/i },
  { id: 'hot-springs', name: 'Hot springs towns', region: 'hot-water', x: 78, y: 43.5, kind: 'place', match: /\b(yugakure|hot springs?|hidden steam)\b/i },
  { id: 'sound', name: 'Sound hideouts', region: 'rice', x: 56, y: 39, kind: 'hideout', match: /\b(hidden sound|otogakure|sound (village|hideout|base)|orochimaru'?s (hideout|lair|base))\b/i },
  { id: 'naruto-bridge', name: 'Great Naruto Bridge', region: 'waves', x: 77, y: 76, kind: 'place', match: /\bgreat naruto bridge\b/i },
  { id: 'uzushio', name: 'Ruins of Uzushio', region: 'whirlpools', x: 88, y: 79.5, kind: 'ruin', match: /\b(uzushio(gakure)?|hidden whirlpool|hidden eddy)\b/i, note: 'Your father’s people. Ruins, old seals and graves.' },
  { id: 'stone', name: 'Hidden Stone', region: 'earth', x: 20, y: 28, kind: 'village', match: /\b(hidden stone|iwagakure|the Stone)\b/i },
  { id: 'mist', name: 'Hidden Mist', region: 'water', x: 92, y: 59, kind: 'village', match: /\b(hidden mist|kirigakure|the Mist)\b/i },
  { id: 'cloud', name: 'Hidden Cloud', region: 'lightning', x: 85, y: 16, kind: 'village', match: /\b(hidden cloud|kumogakure|the Cloud)\b/i },
  { id: 'iron', name: 'Samurai of Iron', region: 'iron', x: 52, y: 12, kind: 'place', match: /\b(land of iron|iron country|samurai)\b/i },
  { id: 'silence', name: 'Land of Silence', region: null, x: 31, y: 16, kind: 'place', match: /\bland of silence\b/i, note: 'A small country far from the great villages and off every road you know.' },
];

const PLACE_BY_ID = new Map(MAP_PLACES.map((place) => [place.id, place]));

export function mapPlace(id: string | undefined | null): MapPlace | null {
  return id ? PLACE_BY_ID.get(id) ?? null : null;
}

/** The map place a location names (earliest mention wins; a shrine in the Leaf beats the Leaf). */
export function placeIdOf(text: string | undefined | null): string | null {
  if (!text) return null;

  const localized = localizePlaceNames(text);
  let best: { index: number; place: MapPlace } | null = null;

  for (const place of MAP_PLACES) {
    const found = place.match.exec(localized);

    if (!found) continue;
    // Prefer the earliest mention; on a tie, the more specific (a place with a parent).
    if (!best || found.index < best.index || (found.index === best.index && place.parent && !best.place.parent)) {
      best = { index: found.index, place };
    }
  }

  // "the Naka Shrine in the ruins of the Hidden Leaf": the shrine, not the Leaf.
  if (best && !best.place.parent) {
    const child = MAP_PLACES.find((place) => place.parent === best!.place.id && place.match.test(localized));

    if (child) return child.id;
  }

  return best?.place.id ?? null;
}

const TRAVEL_LOG_LIMIT = 400;

function samePlace(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * After a turn: a new place goes on Kan's road. A place that names no
 * country stays in the country he was last in.
 */
export function recordTravel(db: AppDatabase): AppDatabase {
  const log = db.state.travelLog ?? [];
  const last = log[log.length - 1];
  const place = db.state.location?.trim();

  if (!place || (last && samePlace(last.place, place))) return db;

  const region = regionOf(place) ?? (last && isRegion(last.region) ? last.region : null) ?? (log.length === 0 ? currentRegion(db) : null);
  const stop: TravelStop = {
    place: place.slice(0, 140),
    ...(region ? { region } : {}),
    ...(placeIdOf(place) ? { placeId: placeIdOf(place)! } : {}),
    date: db.state.inStoryDate,
  };

  return { ...db, state: { ...db.state, travelLog: [...log, stop].slice(-TRAVEL_LOG_LIMIT) } };
}

export function normalizeTravelLog(value: unknown, location: string, date: CalendarDate): TravelStop[] {
  const stops = Array.isArray(value)
    ? (value as TravelStop[]).filter(
        (stop) => stop && typeof stop.place === 'string' && stop.date && typeof stop.date.year === 'number'
      )
    : [];

  if (stops.length > 0) return stops.slice(-TRAVEL_LOG_LIMIT);

  // Older saves: the road starts where Kan is now.
  const region = regionOf(location);
  const placeId = placeIdOf(location);

  return location
    ? [{ place: location.slice(0, 140), ...(region ? { region } : {}), ...(placeId ? { placeId } : {}), date }]
    : [];
}

export type MapPoint = { x: number; y: number };

/** Where a stop goes on the board: its place, else its country (spread a little so stops don't stack). */
export function pointOfStop(stop: Pick<TravelStop, 'place' | 'region' | 'placeId'>): MapPoint | null {
  const place = mapPlace(stop.placeId);

  if (place) return { x: place.x, y: place.y };
  if (!isRegion(stop.region)) return null;

  const shape = REGION_SHAPES[stop.region];
  const hash = hashText(stop.place.toLowerCase());
  const angle = ((hash % 360) * Math.PI) / 180;
  const reach = 0.25 + ((hash >>> 9) % 40) / 100;

  return {
    x: shape.x + Math.cos(angle) * shape.rx * reach,
    y: shape.y + Math.sin(angle) * shape.ry * reach,
  };
}

/** Kan's road as points, oldest first, with repeats of the same spot folded. */
export function routePoints(db: AppDatabase, limit = 60): (MapPoint & { date: CalendarDate; place: string })[] {
  const points: (MapPoint & { date: CalendarDate; place: string })[] = [];

  for (const stop of db.state.travelLog ?? []) {
    const point = pointOfStop(stop);

    if (!point) continue;

    const previous = points[points.length - 1];

    if (previous && Math.abs(previous.x - point.x) < 0.5 && Math.abs(previous.y - point.y) < 0.5) continue;

    points.push({ ...point, date: stop.date, place: stop.place });
  }

  return points.slice(-limit);
}

export type PlaceVisits = { count: number; first: CalendarDate; last: CalendarDate };

/** How often and when Kan has been at each map place (a shrine also counts for its village). */
export function placeVisits(db: AppDatabase): Map<string, PlaceVisits> {
  const visits = new Map<string, PlaceVisits>();
  const add = (id: string, date: CalendarDate) => {
    const known = visits.get(id);

    visits.set(id, known ? { count: known.count + 1, first: known.first, last: date } : { count: 1, first: date, last: date });
  };

  for (const stop of db.state.travelLog ?? []) {
    const place = mapPlace(stop.placeId);

    if (!place) continue;

    add(place.id, stop.date);
    if (place.parent) add(place.parent, stop.date);
  }

  return visits;
}

/** Countries Kan has set foot in. */
export function regionsVisited(db: AppDatabase): Set<Region> {
  return new Set((db.state.travelLog ?? []).map((stop) => stop.region).filter(isRegion));
}

/**
 * Shinobi days from where Kan is to a place, plain and in the weather
 * where he is now. Null for a place off every road.
 */
export function travelEstimate(db: AppDatabase, to: Region | null): { days: number; inWeather: number } | null {
  if (!to) return null;

  const from = currentRegion(db);
  const days = travelDaysBetween(from, to);
  const factor = Math.max(weatherTravelFactor(regionWeather(db, from)), weatherTravelFactor(regionWeather(db, to)));

  return { days, inWeather: Math.round(days * factor * 4) / 4 };
}

export function formatTravelDays(days: number) {
  if (days < 1) return 'under a day';
  if (days === 1) return 'about a day';

  const rounded = Math.round(days * 2) / 2;

  return `about ${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} days`;
}

export type KnownWhereabouts = {
  entity: EntityRecord;
  region: Region;
  /** told: the story said where they went; seen: where you last saw them; assumed: their home; with-you: travelling with you. */
  basis: 'told' | 'seen' | 'assumed' | 'with-you';
  /** In your words, for the list. */
  detail: string;
  /** How old that knowledge is, in days. */
  daysOld?: number;
};

const HOME_TAGS = ['akatsuki', 'leaf', 'sand', 'mist', 'cloud', 'stone', 'sound', 'rain', 'waves', 'waterfall'];

/**
 * Where the people Kan has met are, as far as he knows: what he was told,
 * else where he last saw them, else where they would usually be. Someone
 * who died without Kan knowing is still where he thinks they are.
 */
export function knownWhereabouts(db: AppDatabase): KnownWhereabouts[] {
  const companions = new Set(companionsOf(db).map((entity) => entity.id));
  const here = currentRegion(db);
  const now = db.state.inStoryDate;
  const result: KnownWhereabouts[] = [];

  for (const entity of db.entities) {
    if (entity.type !== 'character' || entity.name === 'Kan' || entity.met === false || entity.tier === 'minor') continue;
    if (isDeceased(entity) && kanKnowsDeath(db, entity)) continue;

    if (companions.has(entity.id)) {
      result.push({ entity, region: here, basis: 'with-you', detail: 'Travelling with you' });
      continue;
    }

    const told = regionOf(entity.whereabouts);
    const seen = regionOf(entity.lastSeenAt);
    const daysOld = entity.lastSeen ? Math.max(0, daysBetween(entity.lastSeen, now)) : undefined;
    const ago = daysOld === undefined ? '' : daysOld < 1 ? 'today' : daysOld < 2 ? 'yesterday' : `${Math.round(daysOld)} days ago`;

    if (told) {
      result.push({ entity, region: told, basis: 'told', detail: `Last word: ${localizePlaceNames(entity.whereabouts!)}`, daysOld });
      continue;
    }

    if (seen) {
      result.push({ entity, region: seen, basis: 'seen', detail: `You saw them there${ago ? ` ${ago}` : ''}`, daysOld });
      continue;
    }

    const home = regionOf(entity.role) ?? whereaboutsFromTags(entity);

    if (home) result.push({ entity, region: home, basis: 'assumed', detail: 'Where they would usually be', daysOld });
  }

  const order = { 'with-you': 0, told: 1, seen: 2, assumed: 3 } as const;

  return result.sort(
    (a, b) => order[a.basis] - order[b.basis] || (a.daysOld ?? 9999) - (b.daysOld ?? 9999) || a.entity.name.localeCompare(b.entity.name)
  );
}

function whereaboutsFromTags(entity: EntityRecord): Region | null {
  if (!HOME_TAGS.some((tag) => entity.tags.includes(tag))) return null;

  return whereaboutsRegion({ ...entity, whereabouts: undefined, lastSeenAt: undefined, role: undefined });
}

export function regionLabel(region: Region | null) {
  return region ? REGION_NAME[region].replace(/^the /, 'The ') : 'Off the map';
}
