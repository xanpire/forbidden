// How scene images are framed: the director's shot vocabulary, the light
// line built from the real weather and clock, timeline art direction, and
// the variety tracker. Pure, so it can be tested.
//
// See docs: claude/image-generator-cinematic.md.

import { eventIdFor, timelineOf } from './timeline';
import { mentionsEntity } from './characterRefs';
import { secondsBetween } from './calendar';
import { currentWeather } from './weather';
import type { AppDatabase, CalendarDate, RawLogEntry, WeatherCondition } from './types';
import { isPlayer } from './player';

// ---------------------------------------------------------------------------
// Shot types
// ---------------------------------------------------------------------------

export type ShotType =
  | 'impact frame'
  | 'extreme close-up'
  | 'close-up'
  | 'medium'
  | 'full body'
  | 'wide'
  | 'extreme wide'
  | 'aerial'
  | 'ensemble'
  | 'over-the-shoulder';

/** Matched in this order: the most specific words first. */
const SHOT_PATTERNS: [RegExp, ShotType][] = [
  [/\bimpact[- ]frame\b/i, 'impact frame'],
  [/\bextreme close[- ]?up\b/i, 'extreme close-up'],
  [/\bclose[- ]?up\b/i, 'close-up'],
  [/\bensemble\b|\bline[- ]?up\b|\bbattle lines\b|\bgathering in a circle\b/i, 'ensemble'],
  [/\bextreme wide\b|\bestablishing\b/i, 'extreme wide'],
  [/\baerial\b|\bbird'?s[- ]eye\b/i, 'aerial'],
  [/\bover[- ]the[- ]shoulder\b/i, 'over-the-shoulder'],
  [/\bwide\b/i, 'wide'],
  [/\bfull[- ]body\b/i, 'full body'],
  [/\bmedium\b/i, 'medium'],
];

/** The shot type a SHOT line opens with, or null when it names none. */
export function shotTypeOf(shot: string | undefined): ShotType | null {
  if (!shot) return null;

  // The shot type comes first in the line: judge the opening words first,
  // so "close-up ... with a wide sky behind" stays a close-up.
  const head = shot.split(/[,;:.]/)[0] ?? '';

  for (const text of [head, shot]) {
    for (const [pattern, type] of SHOT_PATTERNS) {
      if (pattern.test(text)) return type;
    }
  }

  return null;
}

/** Shots that show a big space: tiny faceless figures and crowds are allowed. */
export function isScaleShot(type: ShotType | null) {
  return type === 'wide' || type === 'extreme wide' || type === 'aerial';
}

// ---------------------------------------------------------------------------
// Shot chips
// ---------------------------------------------------------------------------

export type ShotChip = 'auto' | 'closeup' | 'action' | 'impact' | 'epic' | 'ensemble' | 'aftermath';

export const SHOT_CHIPS: { value: ShotChip; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'The director picks the shot.' },
  { value: 'closeup', label: 'Close-up', hint: 'A face at its peak emotion.' },
  { value: 'action', label: 'Action', hint: 'Low angle, the action filling the frame.' },
  { value: 'impact', label: 'Impact', hint: 'The instant a blow lands, in an impact frame.' },
  { value: 'epic', label: 'Epic wide', hint: 'A tiny figure in a huge landscape and sky.' },
  { value: 'ensemble', label: 'Ensemble', hint: 'Everyone in the scene in one frame.' },
  { value: 'aftermath', label: 'Aftermath', hint: 'From above, looking down on what is left.' },
];

const CHIP_DIRECTION: Record<Exclude<ShotChip, 'auto'>, string> = {
  closeup: 'close-up or extreme close-up on the face at the emotional peak',
  action: "low angle or worm's-eye, the action filling most of the frame",
  impact: 'impact frame: the instant the blow lands or the shock hits',
  epic: 'extreme wide: the figures tiny, a huge landscape and sky around them',
  ensemble: 'ensemble: everyone in the scene in one frame, using one of the ensemble layouts',
  aftermath: "aerial or bird's-eye view of the aftermath and destruction",
};

export function chipDirection(chip: ShotChip | undefined): string | null {
  return chip && chip !== 'auto' ? CHIP_DIRECTION[chip] : null;
}

/** Ensemble shots can carry more people (sceneCast, references, action words). */
export function wantsEnsemble(chip: ShotChip | undefined, shotType: ShotType | null) {
  return chip === 'ensemble' || shotType === 'ensemble';
}

// ---------------------------------------------------------------------------
// Variety tracker (#7) and impact-frame rarity (#11)
// ---------------------------------------------------------------------------

function paintedReplies(db: Pick<AppDatabase, 'rawLog'>): RawLogEntry[] {
  return db.rawLog.filter((entry) => entry.kind === 'story' && entry.role === 'assistant' && entry.image && entry.imageMeta);
}

/** The camera lines of the last few scene images, newest last. */
export function recentShots(db: Pick<AppDatabase, 'rawLog'>, count = 3): string[] {
  return paintedReplies(db)
    .slice(-count)
    .map((entry) => entry.imageMeta?.shot ?? entry.imageMeta?.shotType ?? '')
    .filter(Boolean);
}

/** About 1 in 6 at most: no impact frame among the last five images. */
export function impactFrameAllowed(db: Pick<AppDatabase, 'rawLog'>) {
  return !paintedReplies(db)
    .slice(-5)
    .some((entry) => (entry.imageMeta?.shotType ?? shotTypeOf(entry.imageMeta?.shot)) === 'impact frame');
}

// ---------------------------------------------------------------------------
// Light and atmosphere (#3)
// ---------------------------------------------------------------------------

const WEATHER_VISUAL: Record<WeatherCondition, { day: string; night?: string }> = {
  clear: { day: 'a clear sky with wind-torn clouds', night: 'a clear starry sky and a bright moon' },
  cloudy: { day: 'heavy overcast clouds, soft diffuse light', night: 'a dark, starless sky' },
  drizzle: { day: 'a fine drizzle, a wet sheen on every surface' },
  rain: { day: 'steady rain, wet reflections on the ground' },
  downpour: { day: 'heavy driving rain in sheets, water streaming everywhere' },
  storm: { day: 'a thunderstorm, lightning forking through black clouds' },
  fog: { day: 'thick fog, shapes fading into white' },
  snow: { day: 'drifting snow, a white hush over everything' },
  blizzard: { day: 'a howling blizzard, snow streaking sideways' },
  sleet: { day: 'grey sleet slanting down, icy puddles' },
  wind: { day: 'strong wind tearing at cloaks, hair and leaves' },
  sandstorm: { day: 'a sandstorm, an orange haze swallowing the horizon' },
  heat: { day: 'shimmering heat haze under a bleached sky', night: 'a still, warm night, heat rising off the stone' },
  humid: { day: 'hazy, humid air with a soft glow' },
};

function lightOfHour(hour: number, indoors: boolean) {
  if (indoors) {
    return hour >= 7 && hour <= 18
      ? 'daylight falling through openings, deep shadows inside'
      : 'warm lamplight and torchlight, deep shadows';
  }

  if (hour >= 4 && hour <= 6) return 'dawn: a cold blue sky warming to a pink and gold horizon';
  if (hour >= 7 && hour <= 10) return 'clean morning light, long soft shadows';
  if (hour >= 11 && hour <= 14) return 'harsh noon sun, short hard shadows';
  if (hour >= 15 && hour <= 16) return 'warm afternoon light';
  if (hour >= 17 && hour <= 19) return 'golden hour sliding into dusk: a burning orange sky, long shadows';
  if (hour >= 20 && hour <= 21) return 'blue hour dusk, the last light on the horizon';
  return 'night: moonlight and deep blue shadows';
}

/** Colour accents a scene's effects give it, from its words. */
const ACCENTS: [RegExp, string][] = [
  [/\b(lightning|thunder ?storm)\b/i, 'white-blue lightning'],
  [/\b(fire|flames?|burning|blaze|embers?|candle ?light|fireplace)\b/i, 'orange and red firelight'],
  [/\b(neon|sign ?light)\b/i, 'neon pink and blue'],
  [/\b(sea|ocean|harbou?r|waves?)\b/i, 'deep ocean blue'],
  [/\b(sand|desert|dunes?)\b/i, 'gold sand'],
  [/\b(police lights?|sirens?)\b/i, 'flashing red and blue'],
  [/\b(blood|bleeding|bloodied|wound)\b/i, 'crimson blood'],
];

export function colourAccent(text: string): string | null {
  const found = ACCENTS.filter(([pattern]) => pattern.test(text)).map(([, accent]) => accent);
  return found.length > 0 ? found.slice(0, 2).join(' and ') : null;
}

/** The scene's clock and weather: the memory's own in a flashback. */
export function sceneMoment(db: AppDatabase, inMemory: boolean): {
  date: CalendarDate;
  condition: WeatherCondition;
  weatherText?: string;
  indoors: boolean;
} {
  const memory = inMemory ? db.state.flashbacks?.active ?? null : null;

  if (memory) {
    return {
      date: memory.date,
      condition: memory.weather?.condition ?? 'clear',
      weatherText: memory.weather?.text,
      indoors: memory.locationKind === 'structure',
    };
  }

  const now = currentWeather(db);

  return {
    date: db.state.inStoryDate,
    condition: now.condition,
    weatherText: now.text,
    indoors: db.state.locationKind === 'structure',
  };
}

/** One line of light and atmosphere from the real weather and time of day. */
export function lightLine(db: AppDatabase, sceneText: string, inMemory = false): string {
  const moment = sceneMoment(db, inMemory);
  const hour = Math.max(0, Math.min(23, moment.date.hour ?? 12));
  const night = hour >= 22 || hour <= 3;
  const visual = WEATHER_VISUAL[moment.condition];
  const weather = moment.weatherText?.trim() || (night && visual.night ? visual.night : visual.day);
  const accent = colourAccent(sceneText);

  return [
    `Light and atmosphere: ${lightOfHour(hour, moment.indoors)}`,
    moment.indoors ? `; outside, ${weather}` : `; ${weather}`,
    accent ? `; colour accent: ${accent}` : '',
    '.',
  ].join('');
}

// ---------------------------------------------------------------------------
// Timeline art direction (#13)
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(['the', 'of', 'land', 'village', 'an', 'a', 'near', 'outside', 'in', 'at']);

function placeWords(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/** Within this long after a timeline event happened, its art direction still applies. */
const ART_DIRECTION_WINDOW_SECONDS = 2 * 24 * 3600;

/**
 * A fixed visual hint when the story is at, or just past, a timeline event
 * that carries one (`artDirection`): the beat the player took on, or an event
 * that happened in the last two days where they are.
 */
export function timelineArtDirection(db: AppDatabase): string | null {
  const date = db.state.inStoryDate;
  const progress = db.state.timelineProgress;

  if (!progress) return null;

  const here = new Set(placeWords(db.state.location ?? ''));

  for (const event of timelineOf(db)) {
    if (!event.artDirection) continue;

    if (progress.engaged.includes(event.id) && !progress.completed.includes(event.id)) {
      return event.artDirection;
    }

    if (!progress.completed.includes(event.id)) continue;

    const record = db.events.find((item) => item.id === eventIdFor(event.id));

    if (!record) continue;

    const since = secondsBetween(record.inStoryDate, date);

    if (since < 0 || since > ART_DIRECTION_WINDOW_SECONDS) continue;

    const region = event.regionId ? db.world.regions.find((item) => item.id === event.regionId)?.name ?? '' : '';
    const there = placeWords(`${event.location ?? ''} ${region}`);

    if (there.some((word) => here.has(word))) {
      return event.artDirection;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Look tags for the people in a shot (#6c)
// ---------------------------------------------------------------------------

/** "Mara: short dark-red hair…" for each person named in the action. */
export function lookTags(
  db: AppDatabase,
  action: string,
  options: { exclude?: Set<string>; limit?: number; ageAt?: (entityId: string) => number | undefined } = {}
): string[] {
  const lower = action.toLowerCase();

  return db.entities
    .filter(
      (entity) =>
        entity.type === 'character' &&
        !isPlayer(db, entity) &&
        !options.exclude?.has(entity.name) &&
        (entity.appearance?.trim() || entity.currentLook?.trim()) &&
        mentionsEntity(action, entity)
    )
    .map((entity) => {
      const at = Math.min(
        ...[entity.name, ...entity.aliases].map((name) => lower.indexOf(name.toLowerCase())).filter((i) => i >= 0),
        Number.MAX_SAFE_INTEGER
      );
      const age = options.ageAt?.(entity.id);
      const look = [entity.appearance?.trim(), entity.currentLook?.trim() ? `right now: ${entity.currentLook.trim()}` : '']
        .filter(Boolean)
        .join('; ')
        .replace(/\.(?=;|$)/g, '');

      return { at, line: `${entity.name}${age !== undefined ? ` (age ${age})` : ''}: ${look.slice(0, 220)}` };
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, options.limit ?? 10)
    .map((entry) => entry.line);
}
