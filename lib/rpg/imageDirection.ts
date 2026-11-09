// How scene images are framed: the director's shot vocabulary, the light
// line built from the real weather and clock, and the variety tracker. Pure, so it can be tested.
//
// See docs: claude/image-generator-cinematic.md.

import { mentionsEntity } from './characterRefs';
import { currentWeather } from './weather';
import type { AppDatabase, CalendarDate, RawLogEntry, WeatherCondition } from './types';
import { isPlayer } from './player';

// ---------------------------------------------------------------------------
// Shot types
// ---------------------------------------------------------------------------

export type ShotType =
  | 'extreme close-up'
  | 'close-up'
  | 'medium'
  | 'full body'
  | 'wide'
  | 'extreme wide'
  | 'aerial'
  | 'ensemble'
  | 'over-the-shoulder'
  | 'point of view'
  | 'from above';

/** Matched in this order: the most specific words first. */
const SHOT_PATTERNS: [RegExp, ShotType][] = [
  [/\bextreme close[- ]?up\b/i, 'extreme close-up'],
  [/\bclose[- ]?up\b/i, 'close-up'],
  [/\bensemble\b|\bline[- ]?up\b|\bbattle lines\b|\bgathering in a circle\b/i, 'ensemble'],
  [/\bextreme wide\b|\bestablishing\b/i, 'extreme wide'],
  [/\baerial\b|\bbird'?s[- ]eye\b/i, 'aerial'],
  [/\bover[- ]the[- ]shoulder\b/i, 'over-the-shoulder'],
  [/\bpoint[- ]of[- ]view\b|\bpov\b/i, 'point of view'],
  [/\bfrom above\b|\boverhead\b|\btop[- ]down\b/i, 'from above'],
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

export type ShotChip = 'auto' | 'closeup' | 'action' | 'wide' | 'ensemble' | 'close' | 'above' | 'pov' | 'room';

/** The shot chips; the intimate ones show in a sexual scene. */
export const SHOT_CHIPS: { value: ShotChip; label: string; hint: string; intimate?: true }[] = [
  { value: 'auto', label: 'Auto', hint: 'The director picks the shot.' },
  { value: 'closeup', label: 'Close-up', hint: 'A face at its peak emotion.' },
  { value: 'action', label: 'Action', hint: 'Low angle, the movement filling the frame.' },
  { value: 'wide', label: 'Wide', hint: 'The whole place, with you in it.' },
  { value: 'ensemble', label: 'Ensemble', hint: 'Everyone in the scene in one frame.' },
  { value: 'close', label: 'Close', hint: 'Close on the two of you, bodies and faces.', intimate: true },
  { value: 'above', label: 'From above', hint: 'Looking straight down at the bed or the sofa.', intimate: true },
  { value: 'pov', label: 'POV', hint: 'What you see, from your own eyes.', intimate: true },
  { value: 'room', label: 'Wide room', hint: 'The whole room: where you are and everything around you.', intimate: true },
];

const CHIP_DIRECTION: Record<Exclude<ShotChip, 'auto'>, string> = {
  closeup: 'close-up or extreme close-up on the face at the emotional peak',
  action: 'low angle, the movement filling most of the frame',
  wide: 'wide: the whole place, the people part of it',
  ensemble: 'ensemble: everyone in the scene in one frame, each readable',
  close: 'close-up on the bodies and faces of the people together, shallow depth of field',
  above: 'from above: looking straight down on them, the bed or sofa filling the frame',
  pov: "point of view: through the player's own eyes, the player's hands or body at the frame's edge, the other person facing the camera",
  room: 'wide room: the whole room, the people together in it, the props and light sources visible',
};

export function chipDirection(chip: ShotChip | undefined): string | null {
  return chip && chip !== 'auto' ? CHIP_DIRECTION[chip] : null;
}

/** Ensemble shots can carry more people (sceneCast, references, action words). */
export function wantsEnsemble(chip: ShotChip | undefined, shotType: ShotType | null) {
  return chip === 'ensemble' || shotType === 'ensemble';
}

// ---------------------------------------------------------------------------
// Variety tracker (#7)
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

/** The scene's clock and weather. */
export function sceneMoment(db: AppDatabase): {
  date: CalendarDate;
  condition: WeatherCondition;
  weatherText?: string;
  indoors: boolean;
} {
  const now = currentWeather(db);

  return {
    date: db.state.inStoryDate,
    condition: now.condition,
    weatherText: now.text,
    indoors: db.state.locationKind === 'structure',
  };
}

/** One line of light and atmosphere from the real weather and time of day. */
export function lightLine(db: AppDatabase, sceneText: string): string {
  const moment = sceneMoment(db);
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
// Look tags for the people in a shot (#6c)
// ---------------------------------------------------------------------------

/** "Sam: short dark-red hair…" for each person named in the action. */
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
