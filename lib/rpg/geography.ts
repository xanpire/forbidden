// Where things are, in shinobi travel days.
//
// The GEOGRAPHY lore (seed.ts) gives the narrator fixed directions and
// travel times. This module turns the same numbers into a small graph so the
// engine can reason about distance too: how long a letter takes, how far a
// rumour has travelled, whether someone could plausibly cross Kan's path.
//
// Regions are coarse (a country, or the land around a great village). Times
// are shinobi days at a hard pace with rest, matching the lore; civilians and
// couriers are slower, birds faster (see letters.ts).

import { localizePlaceNames } from './glossary';
import type { AppDatabase, EntityRecord } from './types';

export type Region =
  | 'fire'
  | 'rain'
  | 'grass'
  | 'waterfall'
  | 'hot-water'
  | 'rice'
  | 'waves'
  | 'rivers'
  | 'wind'
  | 'earth'
  | 'water'
  | 'lightning'
  | 'iron'
  | 'whirlpools';

export const REGION_NAME: Record<Region, string> = {
  fire: 'the Land of Fire',
  rain: 'the Land of Rain',
  grass: 'the Land of Grass',
  waterfall: 'the Land of Waterfalls',
  'hot-water': 'the Land of Hot Water',
  rice: 'the Land of Rice Fields',
  waves: 'the Land of Waves',
  rivers: 'the Land of Rivers',
  wind: 'the Land of Wind',
  earth: 'the Land of Earth',
  water: 'the Land of Water',
  lightning: 'the Land of Lightning',
  iron: 'the Land of Iron',
  whirlpools: 'the Land of Whirlpools',
};

// Earliest match in the text wins, so "a teahouse in the Rain, three days
// from the Leaf" is the Rain.
const PATTERNS: Array<[RegExp, Region]> = [
  [/\b(hidden leaf|konoha|leaf village|land of fire|fire country|naka (river|shrine)|uchiha district|valley of the end)\b/i, 'fire'],
  [/\b(hidden rain|amegakure|land of rain|rain country)\b/i, 'rain'],
  [/\b(hidden grass|kusagakure|land of grass|grass country)\b/i, 'grass'],
  [/\b(hidden waterfall|takigakure|land of waterfalls?|waterfall village)\b/i, 'waterfall'],
  [/\b(land of hot water|hot water country|yugakure|hidden steam|hot springs? town)\b/i, 'hot-water'],
  [/\b(land of rice( fields)?|rice country|hidden sound|otogakure|sound village)\b/i, 'rice'],
  [/\b(land of waves|wave country|great naruto bridge)\b/i, 'waves'],
  [/\b(land of rivers|river country)\b/i, 'rivers'],
  [/\b(hidden sand|sunagakure|land of wind|wind country)\b/i, 'wind'],
  [/\b(hidden stone|iwagakure|land of earth|earth country)\b/i, 'earth'],
  [/\b(hidden mist|kirigakure|land of water|water country)\b/i, 'water'],
  [/\b(hidden cloud|kumogakure|land of lightning|lightning country)\b/i, 'lightning'],
  [/\b(land of iron|iron country|samurai)\b/i, 'iron'],
  // "the Rain", "the Sand": only capitalised, so weather and beaches stay out.
  [/\bthe Leaf\b/, 'fire'],
  [/\bthe Rain\b/, 'rain'],
  [/\bthe Sand\b/, 'wind'],
  [/\bthe Mist\b/, 'water'],
  [/\bthe Cloud\b/, 'lightning'],
  [/\bthe Stone\b/, 'earth'],
  [/\b(land of whirlpools|whirlpool country|uzushio|uzushiogakure|hidden whirlpool|hidden eddy)\b/i, 'whirlpools'],
];

/** Travel times between neighbours, in shinobi days (from the GEOGRAPHY lore). */
const ROADS: Array<[Region, Region, number]> = [
  ['fire', 'rain', 3],
  ['fire', 'grass', 2.5],
  ['fire', 'waterfall', 2],
  ['fire', 'rice', 1.5],
  ['fire', 'waves', 2],
  ['fire', 'rivers', 1.5],
  ['fire', 'wind', 3],
  ['fire', 'earth', 5],
  ['fire', 'water', 4.5],
  ['fire', 'lightning', 6],
  ['fire', 'hot-water', 1.5],
  ['fire', 'whirlpools', 2.5],
  ['fire', 'iron', 5.5],
  ['rain', 'grass', 1],
  ['rain', 'wind', 3],
  ['rain', 'rivers', 1.5],
  ['rain', 'earth', 3],
  ['grass', 'earth', 2.5],
  ['rivers', 'wind', 1.5],
  ['earth', 'iron', 3],
  ['iron', 'lightning', 3],
  ['hot-water', 'lightning', 4],
  ['waves', 'water', 2.5],
  ['waves', 'whirlpools', 1],
  ['waterfall', 'hot-water', 1],
];

/** Within one country: a day or so. */
const SAME_REGION_DAYS = 0.75;

let table: Map<string, number> | null = null;

function distances(): Map<string, number> {
  if (table) return table;

  const regions = Object.keys(REGION_NAME) as Region[];
  const dist = new Map<string, number>();
  const key = (a: Region, b: Region) => `${a}|${b}`;

  for (const a of regions) {
    for (const b of regions) dist.set(key(a, b), a === b ? 0 : Infinity);
  }

  for (const [a, b, days] of ROADS) {
    dist.set(key(a, b), Math.min(days, dist.get(key(a, b))!));
    dist.set(key(b, a), Math.min(days, dist.get(key(b, a))!));
  }

  // Floyd-Warshall: 14 regions, computed once.
  for (const k of regions) {
    for (const i of regions) {
      for (const j of regions) {
        const through = dist.get(key(i, k))! + dist.get(key(k, j))!;

        if (through < dist.get(key(i, j))!) dist.set(key(i, j), through);
      }
    }
  }

  table = dist;
  return dist;
}

/** The region a place description is in, or null when it names none. */
export function regionOf(text: string | undefined | null): Region | null {
  if (!text) return null;

  const localized = localizePlaceNames(text);
  let best: { index: number; region: Region } | null = null;

  for (const [pattern, region] of PATTERNS) {
    const match = pattern.exec(localized);

    if (match && (!best || match.index < best.index)) best = { index: match.index, region };
  }

  return best?.region ?? null;
}

/** Shinobi travel days between two regions. */
export function travelDaysBetween(from: Region, to: Region): number {
  if (from === to) return SAME_REGION_DAYS;

  return distances().get(`${from}|${to}`) ?? 4;
}

const HOME_BY_TAG: Array<[string, Region]> = [
  ['akatsuki', 'rain'],
  ['rain', 'rain'],
  ['leaf', 'fire'],
  ['sand', 'wind'],
  ['mist', 'water'],
  ['cloud', 'lightning'],
  ['stone', 'earth'],
  ['sound', 'rice'],
  ['waves', 'waves'],
  ['waterfall', 'waterfall'],
];

/**
 * Where someone most likely is right now, as far as the save knows: where
 * the story last said they were going, else where Kan last saw them, else
 * their home village.
 */
export function whereaboutsRegion(entity: EntityRecord): Region | null {
  const told = regionOf(entity.whereabouts);

  if (told) return told;

  const seen = regionOf(entity.lastSeenAt);

  if (seen) return seen;

  const fromRole = regionOf(entity.role);

  if (fromRole) return fromRole;

  for (const [tag, region] of HOME_BY_TAG) {
    if (entity.tags.includes(tag)) return region;
  }

  return null;
}

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && value in REGION_NAME;
}

/**
 * The region Kan is in now: the one his location names, else the last one
 * on his road (a forest clearing is still in the country he was last in),
 * else the Land of Fire, where the story starts.
 */
export function currentRegion(db: Pick<AppDatabase, 'state'>): Region {
  const named = regionOf(db.state.location);

  if (named) return named;

  const road = db.state.travelLog ?? [];

  for (let index = road.length - 1; index >= 0; index -= 1) {
    const region = road[index].region;

    if (isRegion(region)) return region;
  }

  return 'fire';
}
