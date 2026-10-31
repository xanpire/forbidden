import type { CalendarDate } from './types';

export type ParsedClock = {
  days: number;
  timeOfDay?: CalendarDate['timeOfDay'];
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
  couple: 2,
  few: 3,
  several: 4,
};


const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
  ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14,
  fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19,
  twentieth: 20, 'twenty-first': 21, 'twenty-second': 22, 'twenty-third': 23,
  'twenty-fourth': 24, 'twenty-fifth': 25, 'twenty-sixth': 26, 'twenty-seventh': 27,
  'twenty-eighth': 28, 'twenty-ninth': 29, thirtieth: 30, 'thirty-first': 31,
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

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function countValue(raw: string): number {
  const lower = raw.toLowerCase();

  if (NUMBER_WORDS[lower] !== undefined) {
    return NUMBER_WORDS[lower];
  }

  const parsed = Number.parseInt(lower, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

function unitDays(unit: string): number {
  const lower = unit.toLowerCase();

  if (lower.startsWith('week')) {
    return 7;
  }

  if (lower.startsWith('month')) {
    return 30;
  }

  return 1;
}

function normalizeTimeOfDay(raw: string): CalendarDate['timeOfDay'] | undefined {
  const lower = raw.toLowerCase();

  if (/dawn|daybreak|sunrise|first light|early light|gray morning|grey morning|morning light/.test(lower)) {
    return 'morning';
  }

  if (/noon|midday|mid-day|mid afternoon|mid-afternoon|high sun/.test(lower)) {
    return 'afternoon';
  }

  if (/dusk|sunset|evening|twilight|gloaming|bluish hour/.test(lower)) {
    return 'evening';
  }

  if (/nightfall|midnight|dead of night|full dark|darkness falls|after dark|night has|settled into night|under the stars/.test(lower)) {
    return 'night';
  }

  return undefined;
}

function lastTimeOfDay(text: string): CalendarDate['timeOfDay'] | undefined {
  const pattern = /dawn|daybreak|sunrise|first light|early light|morning light|noon|midday|mid-day|mid afternoon|mid-afternoon|dusk|sunset|evening|twilight|gloaming|nightfall|midnight|dead of night|full dark|darkness falls|after dark|night has|settled into night/gi;
  let last: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    last = match[0];
  }

  return last ? normalizeTimeOfDay(last) : undefined;
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

  const maxDay = MONTH_DAYS[month - 1] ?? 30;
  const safeDay = Math.min(Math.max(1, day), maxDay);
  let year = current.year;

  if (month < current.month || (month === current.month && safeDay < current.day)) {
    year += 1;
  }

  return {
    year,
    month,
    day: safeDay,
    timeOfDay: current.timeOfDay,
  };
}

// Reads the narration and returns how much time actually passed in it. Kept
// deliberately conservative: only clear elapsed-time phrasing counts, so
// "three nights of flight" (past), "four months ago" (age), or "a week"
// (future watch) do not move the calendar.
export function detectNarrationClock(text: string, current: CalendarDate): ParsedClock {
  const result: ParsedClock = { days: 0 };

  if (!text) {
    return result;
  }

  const explicit = explicitDate(text, current);

  if (explicit) {
    result.explicitDate = explicit;
  }

  const explicitDateKey = explicit
    ? explicit.year * 10000 + explicit.month * 100 + explicit.day
    : 0;
  const currentKey = current.year * 10000 + current.month * 100 + current.day;

  if (explicit && explicitDateKey > currentKey) {
    result.days = Math.max(result.days, daysBetweenKeys(current, explicit));
  }

  const elapsedPatterns = [
    /\b(?:after|over|across)\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|\d+)\s+(day|days|night|nights|week|weeks|month|months)\b/gi,
    /\b(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|\d+)\s+(day|days|night|nights|week|weeks|month|months)\s+(?:later|after|passed|of travel|of riding|of marching|on the road|on the trail)\b/gi,
    /\b(?:traveled|travelled|marched|rode|walked|slept|spent|searched|waited)\s+for\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|\d+)\s+(day|days|night|nights|week|weeks|month|months)\b/gi,
  ];

  for (const pattern of elapsedPatterns) {
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      const amount = countValue(match[1]);
      const unit = unitDays(match[2]);

      if (amount > 0) {
        result.days = Math.max(result.days, amount * unit);
      }
    }
  }

  const nextDay = /\bthe (?:next|following)\s+(?:day|morning|dawn|evening|night|afternoon)\b/i.test(text);

  if (nextDay) {
    const crossesDay = current.timeOfDay === 'evening' || current.timeOfDay === 'night' || /next\s+(?:day|morning|dawn)/i.test(text);
    result.days = Math.max(result.days, crossesDay ? 1 : 0);
  }

  const dawnNext = /\b(?:by|at|before|until)\s+(?:the\s+)?next\s+(?:dawn|morning)\b/i.test(text);

  if (dawnNext) {
    result.days = Math.max(result.days, 1);
  }

  const parsedTime = lastTimeOfDay(text);

  if (parsedTime) {
    result.timeOfDay = parsedTime;
  }

  result.days = Math.min(3650, Math.max(0, Math.round(result.days)));

  if (result.explicitDate) {
    result.timeOfDay = parsedTime ?? result.explicitDate.timeOfDay;
    result.explicitDate = { ...result.explicitDate, timeOfDay: result.timeOfDay };
  } else if (result.days > 0) {
    const next = shiftPlain(current, result.days);
    result.timeOfDay =
      parsedTime ?? (current.timeOfDay === 'night' ? 'morning' : current.timeOfDay);
    result.explicitDate = { ...next, timeOfDay: result.timeOfDay };
  }

  return result;
}

function daysBetweenKeys(from: CalendarDate, to: CalendarDate) {
  return Math.max(0, to.day - from.day) + (to.month - from.month) * 30 + (to.year - from.year) * 365;
}

function shiftPlain(date: CalendarDate, days: number): CalendarDate {
  let year = date.year;
  let month = date.month;
  let day = date.day + days;

  for (;;) {
    const maxDay = MONTH_DAYS[month - 1] ?? 30;

    if (day <= maxDay) {
      break;
    }

    day -= maxDay;
    month += 1;

    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return { year, month, day, timeOfDay: date.timeOfDay };
}