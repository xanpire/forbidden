// Time skips: the Skip button (an hour, until tonight, the next morning, or
// anything typed like "Friday night"). A skip moves the clock in one step and
// fills in what happened in between: texts that arrived, everyone's routine
// moving on (routines.ts puts them where their day says), small life events,
// and a short "meanwhile" line. Then the narrator opens the new moment.
// Typing a skip into the story ("I sleep until morning") still works through
// the ordinary turn clock (pacing.ts). No skip during sex.

import { formatClock, formatDate, secondsBetween, shiftDate, shiftSeconds, weekdayOf } from './calendar';
import { companionsOf } from './companions';
import { advanceConsequences } from './consequences';
import { expireFacts } from './facts';
import { advanceLives } from './lives';
import { displayName } from './names';
import { WAKE_HOUR } from './pacing';
import { deliverDueTexts, phoneOf } from './phone';
import { resolveEntity } from './entities';
import { sexPartners } from './sexMode';
import { detectNarrationTime } from './timeparse';
import type { AppDatabase, CalendarDate } from './types';

export type SkipChoice = 'hour' | 'tonight' | 'morning';

/** Skips longer than this send the people who aren't with the player on their way. */
const PARTING_HOURS = 3;
/** Never skip further than this in one go. */
const SKIP_LIMIT_DAYS = 30;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PERIODS: [RegExp, number, number][] = [
  [/\bmidnight\b/, 0, 0],
  [/\b(dawn|sunrise|first light)\b/, 6, 0],
  [/\bmorning\b/, WAKE_HOUR, 30],
  [/\b(noon|midday|lunch(?:time)?)\b/, 12, 0],
  [/\bafternoon\b/, 14, 0],
  [/\b(evening|dinner(?:time)?|after work)\b/, 19, 0],
  [/\b(tonight|night)\b/, 21, 0],
];

function at(date: CalendarDate, hour: number, minute: number): CalendarDate {
  return { ...date, hour, minute, second: 0 };
}

function after(a: CalendarDate, b: CalendarDate) {
  return secondsBetween(b, a) > 0;
}

function dayIndex(date: CalendarDate) {
  return WEEKDAYS.indexOf(weekdayOf(date).toLowerCase());
}

function clockIn(text: string): { hour: number; minute: number } | null {
  const match = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/i.exec(text);

  if (match) {
    let hour = Number(match[1] ?? match[4]);
    const minute = Number(match[2] ?? match[5] ?? 0);
    const half = match[3]?.toLowerCase();

    if (half === 'pm' && hour < 12) hour += 12;
    if (half === 'am' && hour === 12) hour = 0;
    if (hour <= 23 && minute <= 59) return { hour, minute };
  }

  for (const [pattern, hour, minute] of PERIODS) {
    if (pattern.test(text)) return { hour, minute };
  }

  return null;
}

/** When a preset skip lands. Null when it makes no sense now ("until tonight" when it is already night). */
export function presetTarget(now: CalendarDate, choice: SkipChoice): CalendarDate | null {
  switch (choice) {
    case 'hour':
      return shiftSeconds(now, 3600);
    case 'tonight':
      return now.hour >= 20 || now.hour < 5 ? null : at(now, 21, 0);
    case 'morning':
      return now.hour < 5 ? at(now, WAKE_HOUR, 30) : at(shiftDate(now, 1), WAKE_HOUR, 30);
  }
}

/**
 * Reads a typed skip: "Friday night", "tomorrow at 9am", "next Monday
 * morning", "in 3 hours", "the 14th of November", "noon". Always later than
 * now; null when it can't be read.
 */
export function parseSkipTarget(raw: string, now: CalendarDate): CalendarDate | null {
  const text = raw.toLowerCase().trim();

  if (!text) return null;

  const span = /\bin\s+(\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(minutes?|hours?|days?|weeks?)\b/.exec(text);

  if (span) {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12 };
    const amount = words[span[1]] ?? Number(span[1]);
    const unit = span[2].replace(/s$/, '');
    const seconds = amount * (unit === 'minute' ? 60 : unit === 'hour' ? 3600 : unit === 'day' ? 86400 : 604800);

    return seconds > 0 ? shiftSeconds(now, seconds) : null;
  }

  const clock = clockIn(text);
  let day: CalendarDate | null = null;
  const explicit = detectNarrationTime(raw, now).explicitDate;
  const weekday = WEEKDAYS.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));

  if (explicit) {
    day = explicit;
  } else if (/\btomorrow\b/.test(text)) {
    day = shiftDate(now, 1);
  } else if (/\btoday\b|\btonight\b|\bthis (morning|afternoon|evening)\b/.test(text)) {
    day = now;
  } else if (weekday >= 0) {
    let ahead = (weekday - dayIndex(now) + 7) % 7;
    if (/\bnext\b/.test(text) && ahead === 0) ahead = 7;
    day = shiftDate(now, ahead);
  }

  if (!day && !clock) return null;

  const time = clock ?? { hour: WAKE_HOUR, minute: 30 };
  let target = at(day ?? now, time.hour, time.minute);

  // "midnight" tonight is the start of tomorrow.
  if (time.hour === 0 && clock && !explicit) target = at(shiftDate(day ?? now, 1), 0, 0);
  // A time that has already passed means its next turn: tomorrow, or next week for a weekday.
  if (!after(target, now)) target = shiftDate(target, day && weekday >= 0 && !explicit ? 7 : 1);
  if (!after(target, now)) return null;

  return target;
}

/** A skip is possible: the story has begun and no sex scene is under way. */
export function canSkip(db: AppDatabase) {
  return db.rawLog.some((entry) => entry.role === 'assistant') && sexPartners(db).length === 0;
}

function spanLabel(now: CalendarDate, target: CalendarDate) {
  const hours = secondsBetween(now, target) / 3600;

  if (hours < 1.5) return 'An hour later';
  if (target.day === now.day && target.month === now.month) return `Later that ${target.hour >= 17 ? 'evening' : 'day'}`;
  if (hours <= 36 && target.hour < 12) return 'The next morning';
  if (hours <= 48) return `${weekdayOf(target)} ${target.hour >= 17 ? 'evening' : target.hour >= 12 ? 'afternoon' : 'morning'}`;

  return `${Math.round(hours / 24)} days later`;
}

type SkipResult = {
  db: AppDatabase;
  /** What the player sees: "⏩ The next morning · Friday 2 October 2026 · 7:30 AM". */
  label: string;
  /** What happened in between, in a line or two (texts, who left). */
  meanwhile: string;
};

/**
 * Jumps the clock to `target` and fills in what happened in between. Pure;
 * the caller takes a snapshot first so the skip can be undone.
 */
export function applySkip(db: AppDatabase, target: CalendarDate): SkipResult | null {
  const now = db.state.inStoryDate;

  if (!canSkip(db) || !after(target, now) || secondsBetween(now, target) > SKIP_LIMIT_DAYS * 86400) return null;

  const hours = secondsBetween(now, target) / 3600;
  const crossedNight = hours >= 6 || target.day !== now.day;
  const unreadBefore = new Set(phoneOf(db).messages.filter((message) => !message.read).map((message) => message.id));

  let next: AppDatabase = { ...db, state: { ...db.state, inStoryDate: target, sceneClosed: true } };

  // Ages move with the calendar for anyone without a birth year.
  if (target.year !== now.year) {
    next = {
      ...next,
      entities: next.entities.map((entity) =>
        entity.birthYear === undefined && entity.age !== undefined ? { ...entity, age: entity.age + (target.year - now.year) } : entity
      ),
    };
  }

  // Someone coming over who would have arrived during the skip is arriving now.
  const phone = phoneOf(next);
  next = { ...next, phone: { ...phone, arrivals: phone.arrivals.map((arrival) => (after(target, arrival.dueAt) ? { ...arrival, dueAt: target } : arrival)) } };
  next = deliverDueTexts(next);
  next = expireFacts(next, { rested: crossedNight });
  next = advanceLives(next);
  next = advanceConsequences(next);

  // A long skip: whoever isn't with the player (or living with them, at home) has gone on with their day.
  const left: string[] = [];

  if (hours >= PARTING_HOURS) {
    const keep = new Set(companionsOf(next).map((entity) => entity.id));
    const home = next.state.player.home?.toLowerCase();
    const atHome = Boolean(home && next.state.location && (next.state.location.toLowerCase().includes(home) || home.includes(next.state.location.toLowerCase())));
    const cast = (next.state.sceneCast ?? []).filter((name) => {
      const entity = resolveEntity(next, name);
      const stays = Boolean(entity && (keep.has(entity.id) || (atHome && entity.livesWithYou)));
      if (!stays && entity) left.push(displayName(next, entity));
      return stays;
    });
    next = { ...next, state: { ...next.state, sceneCast: cast } };
  }

  const arrived = phoneOf(next).messages.filter((message) => !message.read && !unreadBefore.has(message.id));
  const byPerson = new Map<string, number>();

  for (const message of arrived) {
    const who = message.from === 'unknown' ? 'an unknown number' : displayName(next, next.entities.find((entity) => entity.id === message.from));
    byPerson.set(who, (byPerson.get(who) ?? 0) + 1);
  }

  const meanwhile = [
    left.length ? `${left.join(', ')} went on with ${left.length === 1 ? 'their' : 'their own'} day.` : '',
    byPerson.size ? `Texts came in: ${[...byPerson].map(([who, count]) => `${count} from ${who}`).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    db: next,
    label: `⏩ ${spanLabel(now, target)} · ${formatDate(target)}`,
    meanwhile,
  };
}

/** The narrator's line for the turn after a skip. */
export function formatSkipLine(from: CalendarDate, to: CalendarDate, meanwhile: string) {
  return [
    `TIME SKIP: the story jumps from ${formatDate(from)} to ${formatClock(to)} on ${weekdayOf(to)}. ${meanwhile}`.trim(),
    'Open the new moment: where the player is now and what has changed (the light, the weather, who is around). Sum up the skipped hours in a line at most; do not play them out, and do not move the clock further.',
  ].join('\n');
}
