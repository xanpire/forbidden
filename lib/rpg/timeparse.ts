import { advanceSeconds, daysInMonth, shiftDate } from './calendar';
import type { CalendarDate } from './types';

export type ParsedTime = {
  elapsedSeconds: number;
  clock?: { hour: number; minute: number };
  explicitDate?: CalendarDate;
};

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  couple: 2,
  few: 3,
  several: 4,
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  'twenty-first': 21,
  'twenty-second': 22,
  'twenty-third': 23,
  'twenty-fourth': 24,
  'twenty-fifth': 25,
  'twenty-sixth': 26,
  'twenty-seventh': 27,
  'twenty-eighth': 28,
  'twenty-ninth': 29,
  thirtieth: 30,
  'thirty-first': 31,
};

const UNIT_SECONDS: Record<string, number> = {
  second: 1,
  seconds: 1,
  minute: 60,
  minutes: 60,
  hour: 3600,
  hours: 3600,
  day: 86400,
  days: 86400,
  week: 604800,
  weeks: 604800,
  month: 2592000,
  months: 2592000,
};

function countValue(raw: string): number {
  const lower = raw.toLowerCase();

  if (NUMBER_WORDS[lower] !== undefined) {
    return NUMBER_WORDS[lower];
  }

  const parsed = Number.parseInt(lower, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

const CLOCK_WORDS: Array<[RegExp, number]> = [
  [/\bmidnight\b/i, 0],
  [/\bdawn|daybreak|sunrise|first light\b/i, 6],
  [/\bmorning\b/i, 8],
  [/\bnoon|midday\b/i, 12],
  [/\bafternoon\b/i, 14],
  [/\bdusk|sunset\b/i, 19],
  [/\bevening\b/i, 19],
  [/\bnightfall\b/i, 21],
  [/\bnight\b/i, 22],
];

function parseClock(text: string): { hour: number; minute: number } | undefined {
  const explicit = /\b(?:at|by|until|before|around)\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text);

  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = Number(explicit[2]);
    const suffix = explicit[3]?.toLowerCase();

    if (suffix === 'pm' && hour < 12) hour += 12;
    if (suffix === 'am' && hour === 12) hour = 0;

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  const twelveHour = /\b(?:at|by|until|before|around)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+o'clock)?\s*(am|pm|in the morning|in the afternoon|in the evening|at night)?\b/i.exec(text);

  if (twelveHour) {
    let hour = NUMBER_WORDS[twelveHour[1].toLowerCase()] ?? 0;
    const suffix = (twelveHour[2] ?? '').toLowerCase();

    if (
      suffix === 'pm' ||
      suffix.includes('afternoon') ||
      suffix.includes('evening') ||
      suffix.includes('night')
    ) {
      if (hour < 12) hour += 12;
    }

    if (suffix === 'am' && hour === 12) hour = 0;

    return { hour: hour % 24, minute: 0 };
  }

  // Period words only when the prose clearly fixes the time, so "a night's
  // sleep" is not mistaken for 10 PM.
  const periodPhrase = /\b(?:at|by|until|before|around|after)\s+(midnight|dawn|daybreak|sunrise|first light|morning|noon|midday|afternoon|dusk|sunset|evening|nightfall|night)\b/i.exec(text);
  const periodState =
    /\b(?:it is|it was|now|already)\s+(morning|noon|midday|afternoon|evening|night)\b/i.exec(text) ??
    /\b(dawn|daybreak|sunrise|dusk|sunset|nightfall)\s+(?:broke|breaks|settles?|settled|falls?|fell|came|comes)\b/i.exec(text) ??
    /\b(morning|evening|night)\s+(?:came|comes|fell|falls|settled)\b/i.exec(text);
  const word = (periodPhrase?.[1] ?? periodState?.[1] ?? '').toLowerCase();

  if (word) {
    for (const [pattern, hour] of CLOCK_WORDS) {
      if (pattern.test(word)) {
        return { hour, minute: 0 };
      }
    }
  }

  return undefined;
}

function explicitDate(text: string, current: CalendarDate): CalendarDate | undefined {
  const dayFirst = /\b(?:the\s+)?([a-z-]+|\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.exec(text);
  const monthFirst = /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text);

  if (!dayFirst && !monthFirst) {
    return undefined;
  }

  const dayRaw = dayFirst ? dayFirst[1].toLowerCase() : monthFirst?.[2] ?? '';
  const day = ORDINAL_WORDS[dayRaw] ?? Number.parseInt(dayRaw, 10);
  const month = MONTHS[(dayFirst ? dayFirst[2] : monthFirst?.[1] ?? '').toLowerCase()];

  if (!month || !Number.isFinite(day)) {
    return undefined;
  }

  let year = current.year;

  if (month < current.month) {
    year += 1;
  }

  const maxDay = daysInMonth(year, month);
  const safeDay = Math.min(Math.max(1, day), maxDay);

  if (month === current.month && safeDay < current.day) {
    year += 1;
  }

  return {
    year,
    month,
    day: safeDay,
    hour: current.hour,
    minute: current.minute,
    second: current.second ?? 0,
  };
}

// Reads narration into elapsed clock time. Deliberately conservative: only
// clear elapsed phrasing counts, and explicit clocks/dates always win.
export function detectNarrationTime(text: string, current: CalendarDate): ParsedTime {
  if (!text) {
    return { elapsedSeconds: 0 };
  }

  let elapsedSeconds = 0;
  let clock: { hour: number; minute: number } | undefined;

  if (
    /\b(a|one)\s+(good\s+)?night'?s?\s+(sleep|rest)\b|\bslept\s+(through\s+the\s+night|until\s+(dawn|morning|sunrise))\b/i.test(
      text
    )
  ) {
    elapsedSeconds = Math.max(elapsedSeconds, 8.5 * 3600);
  }

  if (/\b(a\s+)?(short\s+rest|nap)\b|\bdosed\s+off\b/i.test(text)) {
    elapsedSeconds = Math.max(elapsedSeconds, 30 * 60);
  }

  if (
    /\ba\s+(heartbeat|little\s+longer\s+than\s+a\s+heartbeat)\b|\ban\s+instant\b|\bin\s+the\s+blink\s+of\s+an\s+eye\b/i.test(
      text
    )
  ) {
    elapsedSeconds = Math.max(elapsedSeconds, 2);
  }

  if (/\b(a\s+)?few\s+seconds\b|\bseconds?\s+later\b/i.test(text)) {
    elapsedSeconds = Math.max(elapsedSeconds, 5);
  }

  if (/\bseconds?\s+of\s+(fighting|clashing|struggle)\b/i.test(text)) {
    elapsedSeconds = Math.max(elapsedSeconds, 15);
  }

  const unitPattern = new RegExp(
    `\\b(${Object.keys(NUMBER_WORDS).join('|')}|\\d+)\\s+(${Object.keys(UNIT_SECONDS).join('|')})\\b`,
    'gi'
  );

  let match: RegExpExecArray | null;

  while ((match = unitPattern.exec(text)) !== null) {
    const amount = countValue(match[1]);
    const unitSeconds = UNIT_SECONDS[match[2].toLowerCase()] ?? 0;
    const before = text.slice(Math.max(0, match.index - 30), match.index).toLowerCase();
    const after = text
      .slice(match.index + match[0].length, match.index + match[0].length + 24)
      .toLowerCase();

    const elapsedMarker =
      /(later|after|passed|of travel|of riding|of marching|on the road|on the trail|of walking|of running)/.test(
        after
      ) ||
      /(spent|travel|travels|traveled|travelled|traveling|travelling|marched|ride|rode|walked|walk|ran|slept|sleep|rested|waited|searched|fought|endured|trained)/.test(
        before
      );

    if (elapsedMarker && amount > 0 && unitSeconds > 0) {
      elapsedSeconds = Math.max(elapsedSeconds, amount * unitSeconds);
    }
  }

  const nextDay = /\bthe (?:next|following)\s+(?:day|morning|dawn|evening|night|afternoon)\b/i.test(
    text
  );

  if (nextDay) {
    elapsedSeconds = Math.max(elapsedSeconds, 86400);
  }

  const parsedClock = parseClock(text);

  if (parsedClock) {
    clock = parsedClock;
  }

  const explicit = explicitDate(text, current);

  if (explicit) {
    return { elapsedSeconds, clock, explicitDate: explicit };
  }

  if (nextDay && !clock) {
    clock = { hour: 7, minute: 0 };
  }

  return { elapsedSeconds, clock };
}

export function applyParsedTime(current: CalendarDate, parsed: ParsedTime): CalendarDate {
  if (parsed.explicitDate) {
    return parsed.clock
      ? {
          ...parsed.explicitDate,
          hour: parsed.clock.hour,
          minute: parsed.clock.minute,
          second: 0,
        }
      : parsed.explicitDate;
  }

  let next = current;

  if (parsed.elapsedSeconds > 0) {
    next = advanceSeconds(next, parsed.elapsedSeconds);
  }

  if (parsed.clock) {
    const targetSeconds = parsed.clock.hour * 3600 + parsed.clock.minute * 60;
    const currentSeconds = next.hour * 3600 + next.minute * 60 + (next.second ?? 0);

    if (parsed.elapsedSeconds === 0 && targetSeconds < currentSeconds) {
      next = shiftDate(next, 1);
    }

    next = { ...next, hour: parsed.clock.hour, minute: parsed.clock.minute, second: 0 };
  }

  return next;
}
