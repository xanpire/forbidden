// Ambient sound.
//
// Ambience only: no music, no stingers. The point is to make you feel where
// the player is, today: rain on the window, traffic outside, a busy bar, a
// quiet apartment, a TV on, the shower running.
//
// This module is pure. It reads state the app already tracks (the scene's
// weather, the location and its kind, the clock, the season, the last reply
// and the scene mode) and returns a mix: how loud each sound bed should be.
// The player (lib/audio/) synthesises the beds and crossfades between mixes.
// The narrator's prompt is untouched.

import { timeOfDayOf, type DayPeriod } from './calendar';
import { locationKindOf } from './places';
import { sceneNowOf } from './sceneNow';
import { sceneModeOf } from './sceneMode';
import type { AppDatabase, LocationKind, WeatherCondition } from './types';
import { currentWeather, type Season } from './weather';

export const AMBIENCE_BEDS = [
  // Weather
  'rain-light',
  'rain-heavy',
  'rain-window',
  'storm',
  'wind-light',
  'wind-strong',
  'snow-quiet',
  // Outside
  'birds',
  'sea',
  'street',
  'traffic',
  // Inside
  'crowd',
  'bar',
  'apartment',
  'office',
  'engine',
  'tv',
  'shower',
  'fire',
] as const;

export type AmbienceBed = (typeof AMBIENCE_BEDS)[number];

/** Beds that sit inside with the player; everything else is outside and gets muffled indoors. */
export const INDOOR_BEDS: ReadonlySet<AmbienceBed> = new Set<AmbienceBed>(['rain-window', 'crowd', 'bar', 'apartment', 'office', 'engine', 'tv', 'shower', 'fire']);

export type AmbienceInput = {
  condition: WeatherCondition;
  period: DayPeriod;
  hour: number;
  season: Season;
  kind: LocationKind;
  /** The location, in words. */
  place: string;
  /** The last narrator reply: a TV on, the shower running. */
  recent: string;
  /** An intimate scene: everything around goes quiet. */
  hushed: boolean;
};

export type AmbienceMix = {
  /** Bed levels, 0–1. Beds not listed are silent. */
  beds: Partial<Record<AmbienceBed, number>>;
  /** The player is inside: outside sounds go through a low-pass and drop. */
  indoors: boolean;
  /** An intimate scene lowers everything instead of adding anything. */
  hushed: boolean;
  /** Stable text for the mix, to tell when it changes. */
  key: string;
};

const INDOOR_WORDS =
  /\b(inside|indoors|room|rooms|bar|pub|club|nightclub|lounge|restaurant|cafe|café|coffee shop|diner|house|home|flat|apartment|loft|studio|attic|basement|hall|office|offices|cubicle|boardroom|library|kitchen|bedroom|bathroom|living room|hallway|corridor|lobby|elevator|lift|hotel|motel|gym|shop|store|hospital|car|cab|taxi|back seat|front seat|bus|train|subway|metro)\b/i;
const OUTSIDE_WORDS =
  /\b(outside|out front|rooftop|balcony|terrace|patio|courtyard|garden|yard|street|streets|sidewalk|pavement|square|plaza|market|bridge|park|beach|pier|dock|docks|parking lot|car park|bus stop|platform)\b/i;
const CROWD_WORDS = /\b(restaurant|cafe|café|coffee shop|diner|canteen|food court|party|wedding|gala|lobby|waiting room)\b/i;
const MARKET_WORDS = /\b(market|festival|fair|stalls?|shopping street|mall|crowd|crowded|busy street|main street|high street)\b/i;
const GREEN_WORDS = /\b(park|garden|gardens|yard|backyard|woods|trees|lawn|cemetery|campus green)\b/i;
const BAR_WORDS = /\b(bar|pub|club|nightclub|lounge|speakeasy)\b/i;
const HOME_WORDS = /\b(flat|apartment|home|house|bedroom|living room|kitchen|studio|loft|hotel room|motel room|dorm)\b/i;
const CAR_WORDS = /\b(car|cab|taxi|uber|van|truck|back seat|front seat|driver'?s seat|passenger seat)\b/i;
const OFFICE_WORDS = /\b(office|offices|workplace|cubicle|meeting room|boardroom|newsroom|precinct|co-?working)\b/i;
const SEA_WORDS = /\b(sea|seaside|ocean|beach|shore|shoreline|bay|harbou?r|pier|boardwalk|ferry)\b/i;
const FIRE_WORDS = /\b(fireplace|log fire|fire pit|bonfire|campfire|wood stove|wood-burner)\b/i;
const TV_WORDS = /\b(tv|the tv is on|television|telly|the screen flickers|a film plays|the film plays|the movie plays|the news is on|netflix|a show on|the show on)\b/i;
const SHOWER_WORDS = /\b(in the shower|the shower runs|shower running|shower is running|under the spray|under the water|turns on the shower|steam fills the bathroom)\b/i;

/** Where the player is right now, read from the save. */
export function ambienceInputOf(db: AppDatabase): AmbienceInput {
  const weather = currentWeather(db);
  const lastReply = [...db.rawLog].reverse().find((entry) => entry.role === 'assistant' && entry.kind === 'story');
  const now = sceneNowOf(db);

  return {
    condition: weather.condition,
    period: timeOfDayOf(db.state.inStoryDate),
    hour: db.state.inStoryDate.hour,
    season: weather.season,
    kind: locationKindOf(db),
    place: db.state.location ?? '',
    // The scene as the tracker keeps it: a TV on, something on screen.
    recent: [lastReply?.content ?? '', ...(now?.props ?? []), now?.screens ? `the TV is on: ${now.screens}` : ''].join(' '),
    hushed: sceneModeOf(db).current === 'intimate',
  };
}

/** Is the player inside? The location's own words decide; a building counts unless it says outside. */
export function isIndoors(input: Pick<AmbienceInput, 'kind' | 'place'>): boolean {
  const location = input.place;

  if (OUTSIDE_WORDS.test(location) && !INDOOR_WORDS.test(location)) return false;
  if (INDOOR_WORDS.test(location)) return true;

  return input.kind === 'structure';
}

function add(beds: Partial<Record<AmbienceBed, number>>, bed: AmbienceBed, level: number) {
  if (level <= 0) return;
  beds[bed] = Math.min(1, Math.max(beds[bed] ?? 0, level));
}

function scale(beds: Partial<Record<AmbienceBed, number>>, bed: AmbienceBed, factor: number) {
  const level = beds[bed];

  if (level === undefined) return;
  if (level * factor < 0.03) delete beds[bed];
  else beds[bed] = level * factor;
}

/** How hard it is raining, 0–1. */
function rainOf(condition: WeatherCondition) {
  switch (condition) {
    case 'drizzle':
      return 0.3;
    case 'sleet':
      return 0.4;
    case 'rain':
      return 0.6;
    case 'downpour':
      return 0.9;
    case 'storm':
      return 1;
    default:
      return 0;
  }
}

/** What the player should hear, from where they are. */
export function ambienceMix(input: AmbienceInput): AmbienceMix {
  const beds: Partial<Record<AmbienceBed, number>> = {};
  const indoors = isIndoors(input);
  const { condition, period, season, kind, place, recent } = input;
  const day = period === 'morning' || period === 'afternoon';
  const night = period === 'night';
  const lateNight = night && input.hour >= 1 && input.hour < 6;
  const rain = rainOf(condition);
  const car = CAR_WORDS.test(place);

  // ---- Weather ------------------------------------------------------------
  if (rain > 0) {
    if (indoors) {
      // From inside, rain is heard on the windows.
      add(beds, 'rain-window', 0.35 + rain * 0.55);
    } else {
      add(beds, 'rain-light', rain >= 0.9 ? 0.35 : 0.3 + rain * 0.5);
      if (rain >= 0.5) add(beds, 'rain-heavy', (rain - 0.3) * 1.2);
    }
  }
  if (condition === 'storm') {
    add(beds, 'storm', 1);
    add(beds, 'wind-strong', 0.55);
  }
  if (condition === 'sleet') add(beds, 'wind-light', 0.45);
  if (condition === 'snow') {
    add(beds, 'snow-quiet', 1);
    add(beds, 'wind-light', 0.2);
  }
  if (condition === 'blizzard') {
    add(beds, 'wind-strong', 1);
    add(beds, 'snow-quiet', 0.4);
  }
  if (condition === 'wind') add(beds, 'wind-strong', 0.7);
  if (condition === 'fog') add(beds, 'wind-light', 0.1);
  // A little wind in the open, on calm days too.
  const calm = condition === 'clear' || condition === 'cloudy' || condition === 'heat' || condition === 'humid';
  if (calm && !indoors && (kind === 'wilderness' || SEA_WORDS.test(place))) add(beds, 'wind-light', 0.25);

  // ---- Outside --------------------------------------------------------------
  const harsh = rain >= 0.6 || condition === 'blizzard' || condition === 'storm';
  if (!harsh && (day || input.hour === 5 || input.hour === 6) && (GREEN_WORDS.test(place) || kind === 'wilderness')) {
    let level = GREEN_WORDS.test(place) ? 0.6 : 0.4;
    if (input.hour >= 5 && input.hour <= 8) level += 0.2;
    if (season === 'winter') level *= 0.4;
    if (rain > 0) level *= 0.5;
    add(beds, 'birds', level);
  }
  if (SEA_WORDS.test(place)) add(beds, 'sea', indoors ? 0.3 : 0.75);

  if (!indoors && !car && (kind === 'settlement' || kind === 'road')) {
    const busy = MARKET_WORDS.test(place);
    const people = night ? 0.12 : period === 'evening' ? (busy ? 0.6 : 0.4) : busy ? 0.9 : 0.5;
    add(beds, 'street', rain >= 0.6 || condition === 'blizzard' ? people * 0.35 : people);
    add(beds, 'traffic', lateNight ? 0.15 : night ? 0.3 : busy ? 0.35 : 0.55);
  }

  // ---- Inside ---------------------------------------------------------------
  if (car) {
    add(beds, 'engine', 0.7);
    if (rain > 0) add(beds, 'rain-window', 0.3 + rain * 0.4);
  }
  if (indoors && BAR_WORDS.test(place)) add(beds, 'bar', night && input.hour >= 2 && input.hour < 6 ? 0.2 : 0.7);
  if (indoors && CROWD_WORDS.test(place) && !BAR_WORDS.test(place)) add(beds, 'crowd', lateNight ? 0.1 : 0.55);
  if (indoors && OFFICE_WORDS.test(place)) add(beds, 'office', day ? 0.6 : 0.25);
  if (indoors && !car && (HOME_WORDS.test(place) || !(BAR_WORDS.test(place) || CROWD_WORDS.test(place) || OFFICE_WORDS.test(place)))) {
    // A quiet apartment, or any quiet room.
    add(beds, 'apartment', 0.5);
  }
  if (indoors && (TV_WORDS.test(place) || TV_WORDS.test(recent))) add(beds, 'tv', 0.45);
  if (SHOWER_WORDS.test(recent) || /\bshower\b/i.test(place)) add(beds, 'shower', 0.75);
  if (FIRE_WORDS.test(place) || FIRE_WORDS.test(recent)) add(beds, 'fire', 0.6);
  // The city is still out there, through the glass.
  if (indoors && !car && kind !== 'wilderness') add(beds, 'traffic', lateNight ? 0.1 : 0.2);

  if (indoors) {
    // Outside sounds come through the walls, quieter.
    for (const bed of ['wind-light', 'wind-strong', 'birds', 'street'] as const) scale(beds, bed, 0.3);
    scale(beds, 'snow-quiet', 0.5);
  }

  const key = Object.entries(beds)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bed, level]) => `${bed}:${(level ?? 0).toFixed(2)}`)
    .concat(indoors ? 'in' : 'out', input.hushed ? 'hushed' : 'calm')
    .join(' ');

  return { beds, indoors, hushed: input.hushed, key };
}

/** The mix for the save's scene. */
export function currentAmbience(db: AppDatabase): AmbienceMix {
  return ambienceMix(ambienceInputOf(db));
}

const BED_LABEL: Record<AmbienceBed, string> = {
  'rain-light': 'rain',
  'rain-heavy': 'heavy rain',
  'rain-window': 'rain on the windows',
  storm: 'thunder',
  'wind-light': 'a little wind',
  'wind-strong': 'strong wind',
  'snow-quiet': 'the hush of snow',
  birds: 'birds',
  sea: 'the sea',
  street: 'the street',
  traffic: 'traffic',
  crowd: 'voices',
  bar: 'the bar',
  apartment: 'a quiet apartment',
  office: 'the office',
  engine: 'the engine',
  tv: 'the TV',
  shower: 'the shower',
  fire: 'a fire',
};

/** What's playing, loudest first, in a few words ("Rain on the windows, the TV"). */
export function describeAmbience(mix: AmbienceMix, limit = 3): string {
  const beds = (Object.entries(mix.beds) as Array<[AmbienceBed, number]>)
    .filter(([, level]) => level >= 0.1)
    .sort((a, b) => b[1] - a[1]);
  // Heavy rain already says rain.
  const names = beds.map(([bed]) => bed).filter((bed) => !(bed === 'rain-light' && mix.beds['rain-heavy']));
  const text = names.slice(0, limit).map((bed) => BED_LABEL[bed]).join(', ');

  if (!text) return 'Silence';
  return text.charAt(0).toUpperCase() + text.slice(1);
}
