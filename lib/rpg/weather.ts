// Seasons and weather.
//
// One local weather for where the story is set: the world's climate
// (`db.world.climate`, one of the CLIMATE_TYPES below) and real seasons
// (reversed south of the equator, `db.world.southern`). It is deterministic
// per save and six-hour block, and spells last (each block mostly keeps the
// last one's weather), so the sky doesn't flip from turn to turn.
//
// Once a scene starts its weather is held (state.weather) so it stays the
// same through the scene. The story can change it (a storm rolls in, the
// rain stops): the state tracker reports `weather`, and that holds for a while.
//
// The narrator gets one WEATHER line a turn: what it is, the season and the
// feel. It also feeds the light in pictures and the ambient sound.

import { daysFromCivil, civilFromDays, secondsBetween, timeOfDayOf } from './calendar';
import { locationKindOf } from './places';
import type { AppDatabase, CalendarDate, ClimateType, WeatherCondition, WeatherLock } from './types';
import { hashText } from './util';

export type Season = 'winter' | 'spring' | 'summer' | 'autumn';

export const WEATHER_CONDITIONS: WeatherCondition[] = [
  'clear',
  'cloudy',
  'drizzle',
  'rain',
  'downpour',
  'storm',
  'fog',
  'snow',
  'blizzard',
  'sleet',
  'wind',
  'sandstorm',
  'heat',
  'humid',
];

type ConditionInfo = {
  /** How the narrator should picture it. */
  label: string;
  /** At night, when it reads differently. */
  night?: string;
  /** The feel it gives a scene. */
  mood: string;
  /** Shown on the Story header. */
  short: string;
};

export const CONDITION_INFO: Record<WeatherCondition, ConditionInfo> = {
  clear: { label: 'clear skies', night: 'a clear night', mood: 'open and bright', short: 'Clear' },
  cloudy: { label: 'a grey, overcast sky', night: 'a dark, starless night', mood: 'flat and grey', short: 'Overcast' },
  drizzle: { label: 'a thin, steady drizzle', mood: 'damp and dreary', short: 'Drizzle' },
  rain: { label: 'steady rain', mood: 'heavy and grey; rain on the windows', short: 'Rain' },
  downpour: { label: 'a hard downpour', mood: 'everyone runs for cover; streets awash', short: 'Downpour' },
  storm: { label: 'a thunderstorm', mood: 'tense and wild; flickering lights', short: 'Storm' },
  fog: { label: 'thick fog', mood: 'muffled and close', short: 'Fog' },
  snow: { label: 'falling snow', mood: 'quiet and cold; breath that shows', short: 'Snow' },
  blizzard: { label: 'a blizzard', mood: 'everything shut, everyone stuck inside', short: 'Blizzard' },
  sleet: { label: 'cold sleet', mood: 'miserable, slush underfoot', short: 'Sleet' },
  wind: { label: 'a strong, gusting wind', mood: 'restless; doors slam, hair everywhere', short: 'Wind' },
  sandstorm: { label: 'a dust storm', mood: 'gritty and stinging; people stay in', short: 'Dust storm' },
  heat: { label: 'fierce, dry heat', night: 'a warm, close night', mood: 'heavy and slow; air conditioning humming', short: 'Heat' },
  humid: { label: 'thick, humid heat', night: 'a sticky, airless night', mood: 'sticky and heavy', short: 'Humid' },
};

type Weights = Partial<Record<WeatherCondition, number>>;
type Climate = Record<Season, Weights> & {
  /** The weather sticks around: chance each block keeps the last one's (default 0.78). */
  persistence?: number;
  /** Per-month overrides (a monsoon's rainy season). */
  months?: Partial<Record<number, Weights>>;
  /** A line about the place's weather that is always true. */
  note?: string;
  /** Per-month names for the season ("the rainy season"). */
  seasons?: Partial<Record<number, string>>;
  /** Cold-climate wording for the season. */
  cold?: Partial<Record<Season, string>>;
};

const TEMPERATE: Climate = {
  winter: { clear: 3, cloudy: 3, rain: 1, fog: 1.5, sleet: 0.6, snow: 0.8, wind: 1 },
  spring: { clear: 4, cloudy: 2, drizzle: 2, rain: 1.2, fog: 1 },
  summer: { humid: 4, heat: 2, storm: 1.6, downpour: 0.8, clear: 2 },
  autumn: { clear: 4, cloudy: 2.5, rain: 1.6, wind: 1, fog: 1.2, storm: 0.4 },
};

/** One climate per ClimateType. */
const CLIMATE_TYPES: Record<ClimateType, Climate> = {
  temperate: TEMPERATE,
  continental: {
    winter: { snow: 3, clear: 3, cloudy: 2, blizzard: 0.6, wind: 1 },
    spring: { clear: 3, rain: 2, cloudy: 2, wind: 1, drizzle: 1 },
    summer: { clear: 4, heat: 3, storm: 1.5, humid: 1 },
    autumn: { clear: 3, cloudy: 2, rain: 1.5, wind: 1, snow: 0.4 },
    cold: { winter: 'a hard continental winter' },
  },
  desert: {
    winter: { clear: 5, wind: 2, sandstorm: 0.6, cloudy: 1 },
    spring: { clear: 4, wind: 2, sandstorm: 1.2, heat: 2 },
    summer: { heat: 6, clear: 3, sandstorm: 0.8 },
    autumn: { clear: 4, heat: 2, sandstorm: 0.8, wind: 1 },
    note: 'desert: scorching by day, freezing at night',
  },
  tundra: {
    winter: { snow: 5, blizzard: 2, clear: 1, cloudy: 1 },
    spring: { snow: 2, sleet: 2, cloudy: 2, clear: 2 },
    summer: { clear: 4, cloudy: 2, rain: 1.5, fog: 1 },
    autumn: { cloudy: 2, sleet: 2, snow: 2, clear: 2, wind: 1 },
    note: 'snow lies on the land most of the year',
    cold: { winter: 'a deep polar winter', spring: 'a late, cold spring', autumn: 'an early winter' },
  },
  tropical: {
    winter: { humid: 3, clear: 3, rain: 2, storm: 1 },
    spring: { humid: 4, clear: 2, downpour: 1.5, storm: 1.5 },
    summer: { humid: 4, storm: 3, downpour: 2.5, heat: 1 },
    autumn: { humid: 3, rain: 3, storm: 2, clear: 1.5 },
    persistence: 0.7,
    note: 'warm all year, and the rain comes hard and fast',
  },
  monsoon: {
    ...TEMPERATE,
    months: {
      // The rainy season, then monsoon heat with afternoon thunder.
      6: { rain: 4, drizzle: 3, downpour: 2, humid: 2, cloudy: 1.5 },
      7: { humid: 5, storm: 2.5, downpour: 1.5, heat: 1.5, clear: 1 },
      8: { humid: 4, heat: 3, storm: 2, clear: 1.5 },
      9: { clear: 3, humid: 1.5, storm: 1.5, rain: 2, wind: 1 },
    },
    seasons: { 6: 'the rainy season', 7: 'monsoon heat, high summer', 8: 'monsoon heat, high summer' },
  },
  rainy: {
    winter: { drizzle: 3, rain: 5, downpour: 2, storm: 1, fog: 1, sleet: 1 },
    spring: { drizzle: 3, rain: 5, downpour: 3, storm: 2, fog: 1 },
    summer: { drizzle: 2, rain: 4, downpour: 4, storm: 3 },
    autumn: { drizzle: 3, rain: 5, downpour: 3, storm: 2, fog: 1 },
    persistence: 0.86,
    note: 'it almost never stops raining here',
  },
  coastal: {
    winter: { wind: 3, cloudy: 3, rain: 2, fog: 2, storm: 1 },
    spring: { fog: 3, clear: 2, drizzle: 2, cloudy: 2 },
    summer: { clear: 4, humid: 2, storm: 1 },
    autumn: { storm: 1.5, wind: 2, rain: 2, clear: 2, fog: 1 },
    note: 'the sea is never far',
  },
  mountain: {
    winter: { snow: 3, clear: 3, wind: 2, cloudy: 2, blizzard: 1 },
    spring: { clear: 4, wind: 2, cloudy: 2, rain: 1, snow: 0.6 },
    summer: { clear: 4, storm: 1.5, wind: 1, cloudy: 1 },
    autumn: { clear: 3, wind: 2, cloudy: 2, rain: 1, snow: 0.5 },
    note: 'the weather turns fast up here',
    cold: { winter: 'a hard mountain winter' },
  },
};

/** The climate where the story is set (temperate when the world names none). */
export function climateOf(db: Pick<AppDatabase, 'world'>): ClimateType {
  const climate = db.world?.climate;

  return climate && climate in CLIMATE_TYPES ? climate : 'temperate';
}

export function seasonOf(month: number): Season {
  if (month === 12 || month <= 2) return 'winter';
  if (month <= 5) return 'spring';
  if (month <= 8) return 'summer';
  return 'autumn';
}

/** The month as the seasons run where the story is set (south of the equator they are six months on). */
function seasonalMonth(month: number, southern: boolean) {
  return southern ? ((month + 5) % 12) + 1 : month;
}

/** "early winter", "the rainy season", "monsoon heat": the season as people there would say it. */
export function seasonLabel(climate: ClimateType, date: CalendarDate, southern = false): string {
  const month = seasonalMonth(date.month, southern);
  const season = seasonOf(month);
  const table = CLIMATE_TYPES[climate];
  const named = table.seasons?.[month];

  if (named) return named;

  const cold = table.cold?.[season];

  if (cold) return cold;

  // Dec, Mar, Jun, Sep open a season; Feb, May, Aug, Nov close one.
  const position = [12, 3, 6, 9].includes(month) ? 'early' : [2, 5, 8, 11].includes(month) ? 'late' : 'mid';

  return `${position} ${season}`;
}

const BLOCK_HOURS = 6;
const BLOCKS_PER_DAY = 24 / BLOCK_HOURS;
/**
 * Spells are walked forward from a fixed anchor (every four days, two days
 * of warm-up before it), so neighbouring hours share the same chain and only
 * change when the weather itself changes.
 */
const ANCHOR_BLOCKS = 16;
const WARM_UP = 8;

function blockOf(date: CalendarDate) {
  return daysFromCivil(date.year, date.month, date.day) * BLOCKS_PER_DAY + Math.floor(date.hour / BLOCK_HOURS);
}

function monthOfBlock(block: number) {
  return civilFromDays(Math.floor(block / BLOCKS_PER_DAY)).month;
}

function weightsFor(climateType: ClimateType, month: number, part: number): Weights {
  const climate = CLIMATE_TYPES[climateType];
  const base = { ...(climate.months?.[month] ?? climate[seasonOf(month)]) };

  // Fog gathers before and around dawn; summer thunder builds in the afternoon.
  if (base.fog && part <= 1) base.fog *= 1.4;
  if (base.storm && part === 2 && seasonOf(month) === 'summer') base.storm *= 1.5;

  return base;
}

function pick(weights: Weights, roll: number): WeatherCondition {
  const entries = Object.entries(weights).filter(([, weight]) => (weight ?? 0) > 0) as [WeatherCondition, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);

  if (entries.length === 0 || total <= 0) return 'clear';

  let target = roll * total;

  for (const [condition, weight] of entries) {
    target -= weight;

    if (target < 0) return condition;
  }

  return entries[entries.length - 1][0];
}

function roll(seed: string, block: number, salt: string) {
  return hashText(`${seed}:weather:${block}:${salt}`) / 4294967296;
}

/**
 * The world's own weather at a moment. Same save and hour always give the
 * same answer; a spell usually lasts a day or more.
 */
export function weatherAt(seed: string, climate: ClimateType, date: CalendarDate, southern = false): WeatherCondition {
  const target = blockOf(date);
  const persistence = CLIMATE_TYPES[climate].persistence ?? 0.78;
  let condition: WeatherCondition | null = null;

  const start = Math.floor(target / ANCHOR_BLOCKS) * ANCHOR_BLOCKS - WARM_UP;

  for (let block = start; block <= target; block += 1) {
    const weights = weightsFor(climate, seasonalMonth(monthOfBlock(block), southern), block % BLOCKS_PER_DAY);
    const keeps = condition !== null && (weights[condition] ?? 0) > 0 && roll(seed, block, 'keep') < persistence;

    if (!keeps) condition = pick(weights, roll(seed, block, 'pick'));
  }

  return condition ?? 'clear';
}

/** How long story weather holds, and how long a scene keeps its weather. */
const STORY_HOLD_HOURS = 8;
const SCENE_HOLD_HOURS = 12;

function hoursSince(from: CalendarDate, to: CalendarDate) {
  return secondsBetween(from, to) / 3600;
}

function lockHolds(lock: WeatherLock | undefined, db: Pick<AppDatabase, 'state'>): lock is WeatherLock {
  if (!lock) return false;

  const hours = hoursSince(lock.since, db.state.inStoryDate);

  if (hours < 0) return false;
  if (lock.source === 'story') return hours < STORY_HOLD_HOURS;

  return lock.sceneSeq === db.state.sceneSeq && hours < SCENE_HOLD_HOURS;
}

export type WeatherNow = {
  climate: ClimateType;
  condition: WeatherCondition;
  season: Season;
  seasonLabel: string;
  /** The story's own words, when it set the weather. */
  text?: string;
  source: 'world' | 'story';
  night: boolean;
};

function worldWeather(db: Pick<AppDatabase, 'state' | 'meta' | 'world'>, date: CalendarDate) {
  return weatherAt(db.meta.slotId, climateOf(db), date, db.world?.southern === true);
}

/** The weather right now: the scene's held weather, else the world's. */
export function currentWeather(db: Pick<AppDatabase, 'state' | 'meta' | 'world'>): WeatherNow {
  const climate = climateOf(db);
  const southern = db.world?.southern === true;
  const date = db.state.inStoryDate;
  const lock = db.state.weather;
  const held = lockHolds(lock, db);
  const condition = held ? lock.condition : worldWeather(db, date);

  return {
    climate,
    condition,
    season: seasonOf(seasonalMonth(date.month, southern)),
    seasonLabel: seasonLabel(climate, date, southern),
    text: held ? lock.text : undefined,
    source: held ? lock.source : 'world',
    night: timeOfDayOf(date) === 'night',
  };
}

/** How the condition reads at this hour (a clear night, a warm, close night). */
export function weatherPhrase(now: Pick<WeatherNow, 'condition' | 'night' | 'climate'>): string {
  const info = CONDITION_INFO[now.condition];

  if (now.night && now.climate === 'desert' && (now.condition === 'heat' || now.condition === 'clear')) {
    return 'a cold, clear desert night';
  }

  return now.night && info.night ? info.night : info.label;
}

/** Story words → a condition. Order matters: "rain turning to snow" is snow. */
const STORY_PATTERNS: [RegExp, WeatherCondition][] = [
  [/\b(blizzard|white-?out)\b/i, 'blizzard'],
  [/\bsand ?storm|dust ?storm\b/i, 'sandstorm'],
  [/\b(rain|downpour|storm|drizzle)\b[^.]*\b(stops?|stopped|eases?|eased|lets up|let up|clears?|cleared|ends?|ended|passes|passed)\b/i, 'cloudy'],
  [/\b(fog|mist)\b[^.]*\b(lifts?|lifted|clears?|cleared|burns? off|thins?)\b/i, 'clear'],
  [/\b(thunder|lightning|thunderstorm|storm|typhoon|gale)\b/i, 'storm'],
  [/\b(downpour|pouring|torrential|sheets of rain|deluge|cloudburst)\b/i, 'downpour'],
  [/\bsleet\b/i, 'sleet'],
  [/\b(snow|snowfall|snowing|flurr(y|ies))\b/i, 'snow'],
  [/\b(drizzle|drizzling|mizzle)\b/i, 'drizzle'],
  [/\b(fog|mist|haze)\b/i, 'fog'],
  [/\b(rain|raining|rainfall|showers?)\b/i, 'rain'],
  [/\b(wind|gusts?|gusting)\b/i, 'wind'],
  [/\b(humid|muggy|sticky|sweltering)\b/i, 'humid'],
  [/\b(heat|scorching|blazing|baking|hot)\b/i, 'heat'],
  [/\b(clear|sun|sunny|sunlight|stars|cloudless)\b/i, 'clear'],
  [/\b(cloud|clouds|cloudy|overcast|grey sky|gray sky)\b/i, 'cloudy'],
];

export function conditionFromText(text: string | undefined | null): WeatherCondition | null {
  if (!text) return null;

  for (const [pattern, condition] of STORY_PATTERNS) {
    if (pattern.test(text)) return condition;
  }

  return null;
}

/**
 * After a turn: the story's weather if the page changed it, else keep the
 * scene's held weather, else hold the world's weather for this new scene.
 */
export function applyWeather(db: AppDatabase, reported: string | undefined): AppDatabase {
  const fromStory = conditionFromText(reported);

  if (fromStory) {
    return {
      ...db,
      state: {
        ...db.state,
        weather: {
          condition: fromStory,
          text: reported!.trim().slice(0, 60),
          since: db.state.inStoryDate,
          sceneSeq: db.state.sceneSeq,
          source: 'story',
        },
      },
    };
  }

  const lock = db.state.weather;

  if (lockHolds(lock, db)) {
    // Story weather that outlives its scene still holds; a world lock follows the scene.
    return lock.sceneSeq === db.state.sceneSeq || lock.source === 'story'
      ? db
      : { ...db, state: { ...db.state, weather: { ...lock, sceneSeq: db.state.sceneSeq } } };
  }

  return {
    ...db,
    state: {
      ...db.state,
      weather: {
        condition: worldWeather(db, db.state.inStoryDate),
        since: db.state.inStoryDate,
        sceneSeq: db.state.sceneSeq,
        source: 'world',
      },
    },
  };
}

/** One line for the narrator: the weather, the season, and its feel. */
export function formatWeatherLine(db: AppDatabase): string {
  const now = currentWeather(db);
  const info = CONDITION_INFO[now.condition];
  const climateNote = CLIMATE_TYPES[now.climate].note;
  const indoors = locationKindOf(db) === 'structure';
  const phrase = now.text ? `${weatherPhrase(now)} (as the story has it: ${now.text})` : weatherPhrase(now);

  return `WEATHER (${now.seasonLabel}${climateNote ? `; ${climateNote}` : ''}): ${indoors ? `outside, ${phrase}` : phrase}. Feel: ${info.mood}. Keep it the same through this scene unless the story changes it.`;
}

/** For the state tracker: what the weather is now. */
export function formatWeatherTracking(db: AppDatabase): string {
  const now = currentWeather(db);

  return `WEATHER NOW\n${weatherPhrase(now)} (${now.seasonLabel})`;
}
