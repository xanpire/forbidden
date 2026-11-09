// Routines: where someone usually is through the day and the week.
//
// A person's routine is plain text on their sheet ("weekdays 9-17:30 at the
// office; sleeps 23:30-7; Fridays 21-2 at Lola's"), written by the player,
// filled in by "Help me fill this", or changed by a life event. When nobody
// wrote one, a rough one is read from their job. The story always wins: where
// the page last said someone is beats their routine for the rest of that
// stretch. Routines decide where people are, how fast they answer a text and
// when they could drop by.

import { daysFromCivil, secondsBetween, shiftSeconds } from './calendar';
import { hashText } from './util';
import type { AppDatabase, CalendarDate, EntityRecord } from './types';

type RoutineDoing = 'sleep' | 'work' | 'out' | 'home';

type RoutineBlock = {
  /** Days of the week, 0 = Sunday. */
  days: number[];
  /** Minutes after midnight. `to` below `from` runs past midnight. */
  from: number;
  to: number;
  doing: RoutineDoing;
  where: string;
};

/** What someone is doing at a moment, by their routine. */
type RoutineNow = {
  doing: RoutineDoing | 'free';
  where?: string;
  /** When this stretch ends. */
  until?: CalendarDate;
};

/** How long the story's word on someone's whereabouts beats their routine. */
const STORY_WHEREABOUTS_HOURS = 6;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const DAY_NAMES: [RegExp, number][] = [
  [/^sun/, 0], [/^mon/, 1], [/^tue/, 2], [/^wed/, 3], [/^thu/, 4], [/^fri/, 5], [/^sat/, 6],
];

export function dayOfWeek(date: CalendarDate) {
  return (((daysFromCivil(date.year, date.month, date.day) + 4) % 7) + 7) % 7;
}

function parseDays(text: string): number[] {
  const lower = text.toLowerCase();

  if (/\bweekdays?\b|\bwork ?days?\b/.test(lower)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(lower)) return [0, 6];

  const range = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\s*(?:-|–|to|through)\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*/.exec(lower);

  if (range) {
    const start = DAY_NAMES.find(([pattern]) => pattern.test(range[1]))![1];
    const end = DAY_NAMES.find(([pattern]) => pattern.test(range[2]))![1];
    const days: number[] = [];

    for (let day = start; ; day = (day + 1) % 7) {
      days.push(day);
      if (day === end || days.length > 7) break;
    }

    return days;
  }

  const named = [...lower.matchAll(/\b(sun|mon|tue|wed|thu|fri|sat)(?:day|s|days|urday|nesday|rsday|sday)?s?\b/g)]
    .map((match) => DAY_NAMES.find(([pattern]) => pattern.test(match[1]))![1]);

  return named.length > 0 ? [...new Set(named)] : EVERY_DAY;
}

function clockMinutes(hour: number, minute: number, half: string | undefined) {
  let value = hour % 24;

  if (half === 'pm' && value < 12) value += 12;
  if (half === 'am' && value === 12) value = 0;

  return value * 60 + minute;
}

const TIME_RANGE =
  /(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|till)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i;

function parseHours(text: string): { from: number; to: number } | null {
  const match = TIME_RANGE.exec(text);

  if (!match) return null;

  const fromHalf = match[3]?.toLowerCase();
  const toHalf = match[6]?.toLowerCase() ?? (fromHalf === 'am' ? undefined : fromHalf);
  const from = clockMinutes(Number(match[1]), Number(match[2] ?? 0), fromHalf);
  let to = clockMinutes(Number(match[4]), Number(match[5] ?? 0), toHalf);

  // "9-5": an end hour before the start, with no am/pm, is in the afternoon
  // when that still fits the day; otherwise the stretch runs past midnight.
  if (!toHalf && to <= from && to + 12 * 60 > from && to + 12 * 60 <= 24 * 60) {
    to += 12 * 60;
  }

  return { from, to: to % (24 * 60) };
}

function parseDoing(text: string): RoutineDoing {
  const lower = text.toLowerCase();

  if (/\b(sleep|sleeps|asleep|bed)\b/.test(lower)) return 'sleep';
  if (/\bhome\b/.test(lower) && !/\b(work|office|shift|class|school)\b/.test(lower)) return 'home';
  if (/\b(work|works|working|office|shift|shifts|job|class|classes|school|lectures?|studio|clinic|hospital|shop|store)\b/.test(lower)) return 'work';

  return 'out';
}

function parseWhere(text: string, doing: RoutineDoing): string {
  const at = /\b(?:at|in)\s+(.+)$/i.exec(text.replace(TIME_RANGE, '').trim());
  const where = at?.[1]?.replace(/[.,;]+$/, '').trim();

  if (where) return where.slice(0, 60);
  if (doing === 'sleep' || doing === 'home') return 'home';
  if (doing === 'work') return 'work';

  return 'out';
}

/** Reads a routine written in plain words: one stretch per line, or split by ";". */
export function parseRoutine(text: string | undefined): RoutineBlock[] {
  if (!text?.trim()) return [];

  return text
    .split(/[\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const hours = parseHours(line);

      if (!hours) return [];

      const doing = parseDoing(line);

      return [{ days: parseDays(line), ...hours, doing, where: parseWhere(line, doing) }];
    });
}

/** A rough routine from someone's job, for anyone without a written one. */
export function inferredRoutine(entity: Pick<EntityRecord, 'role' | 'notes'>): string {
  const role = `${entity.role ?? ''} ${entity.notes ?? ''}`.toLowerCase();

  if (/\b(bartender|barkeep|barman|barmaid|waiter|waitress|bouncer|dj|dancer|stripper|club|nightclub|cocktail)\b/.test(role)) {
    return 'Wed-Sun 18:00-2:00 at work; sleeps 3:00-11:00';
  }
  if (/\b(nurse|doctor|paramedic|surgeon|firefighter|police|officer|detective|security)\b/.test(role)) {
    return 'Mon-Thu 7:00-19:00 at work; sleeps 23:00-6:00';
  }
  if (/\b(student|undergrad|grad student|phd)\b/.test(role)) {
    return 'weekdays 10:00-16:00 at class; sleeps 1:00-9:00';
  }
  if (!role.trim() || /\b(unknown|unemployed|retired|between jobs|none)\b/.test(role)) {
    return 'sleeps 0:00-8:00';
  }

  return 'weekdays 9:00-17:30 at work; sleeps 23:30-7:00';
}

/** Their routine in words: written, or read from their job. */
function routineTextOf(entity: EntityRecord): string {
  return entity.routine?.trim() || inferredRoutine(entity);
}

function covers(block: RoutineBlock, date: CalendarDate): { start: CalendarDate; end: CalendarDate } | null {
  const minutes = date.hour * 60 + date.minute;
  const today = dayOfWeek(date);
  const yesterday = (today + 6) % 7;
  const startOfDay = { ...date, hour: 0, minute: 0, second: 0 };
  const at = (base: CalendarDate, offsetMinutes: number) => shiftSeconds(base, offsetMinutes * 60);

  if (block.to > block.from) {
    return block.days.includes(today) && minutes >= block.from && minutes < block.to
      ? { start: at(startOfDay, block.from), end: at(startOfDay, block.to) }
      : null;
  }

  // Past midnight: tonight's start, or the tail of last night's.
  if (block.days.includes(today) && minutes >= block.from) {
    return { start: at(startOfDay, block.from), end: at(startOfDay, 24 * 60 + block.to) };
  }
  if (block.days.includes(yesterday) && minutes < block.to) {
    return { start: at(startOfDay, block.from - 24 * 60), end: at(startOfDay, block.to) };
  }

  return null;
}

/** What someone's routine has them doing at this moment. */
export function routineAt(entity: EntityRecord, date: CalendarDate): RoutineNow {
  const blocks = parseRoutine(routineTextOf(entity));
  // A written stretch wins over sleep when they overlap.
  const ordered = [...blocks.filter((block) => block.doing !== 'sleep'), ...blocks.filter((block) => block.doing === 'sleep')];

  for (const block of ordered) {
    const span = covers(block, date);

    if (span) return { doing: block.doing, where: block.where, until: span.end };
  }

  return { doing: 'free' };
}

/** The story said where they are, recently enough to beat their routine. */
export function storyWhereaboutsHold(entity: EntityRecord, now: CalendarDate) {
  if (!entity.whereabouts) return false;
  if (!entity.whereaboutsAt) return true;

  return secondsBetween(entity.whereaboutsAt, now) < STORY_WHEREABOUTS_HOURS * 3600;
}

/** Where they are now in a few words, by the story first and their routine second. */
export function whereNow(entity: EntityRecord, now: CalendarDate): string | null {
  if (storyWhereaboutsHold(entity, now)) return entity.whereabouts ?? null;

  const routine = routineAt(entity, now);

  if (routine.doing === 'sleep') return routine.where === 'home' ? 'asleep at home' : `asleep (${routine.where})`;
  if (routine.doing === 'free') return null;

  return routine.where === 'work' ? 'at work' : routine.where === 'home' ? 'at home' : `at ${routine.where}`;
}

const CLOSE = new Set(['lover', 'romantic interest', 'close', 'old friend', 'family']);

/**
 * How many minutes until someone answers a text, from their routine and how
 * they feel about the player. Deterministic for the same message.
 */
export function replyDelayMinutes(db: AppDatabase, entity: EntityRecord, now: CalendarDate, key: string): number {
  const roll = (min: number, max: number) => min + (hashText(`${db.meta.slotId}:${entity.id}:${key}`) % (max - min + 1));
  const routine = storyWhereaboutsHold(entity, now) ? { doing: 'out' as const, until: undefined } : routineAt(entity, now);
  let minutes: number;

  switch (routine.doing) {
    case 'sleep': {
      const untilWake = routine.until ? Math.max(0, secondsBetween(now, routine.until) / 60) : 6 * 60;
      minutes = untilWake + roll(5, 40);
      break;
    }
    case 'work':
      minutes = roll(10, 120);
      break;
    case 'out':
      minutes = roll(3, 50);
      break;
    default:
      minutes = roll(1, 12);
  }

  const bond = db.bonds.find((item) => item.entityId === entity.id);

  if (bond?.grudge) minutes *= 3;
  else if ((bond?.affinity ?? 0) < 0) minutes *= 2;
  else if (CLOSE.has(bond?.relationship ?? '') && routine.doing !== 'sleep') minutes *= 0.5;

  return Math.max(1, Math.round(minutes));
}
