import type { CalendarDate, ScenePace } from './types';

export const DEFAULT_DATE: CalendarDate = {
  year: 13,
  month: 10,
  day: 1,
  hour: 22,
  minute: 0,
  second: 0,
};

const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH = 30;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_DAY = 86400;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function monthName(month: number) {
  return MONTH_NAMES[Math.max(0, Math.min(MONTH_NAMES.length - 1, month - 1))];
}

export type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export function timeOfDayOf(date: CalendarDate): DayPeriod {
  const hour = clampHour(date.hour);

  if (hour >= 5 && hour <= 11) return 'morning';
  if (hour >= 12 && hour <= 16) return 'afternoon';
  if (hour >= 17 && hour <= 20) return 'evening';
  return 'night';
}

export function formatClock(date: CalendarDate) {
  const hour = clampHour(date.hour);
  const minute = clampMinute(date.minute);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;

  return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function formatDate(date: CalendarDate) {
  return `Year ${date.year} · Day ${date.day}, ${monthName(date.month)} · ${formatClock(date)}`;
}

export function formatDay(date: CalendarDate) {
  return `Day ${date.day}, ${monthName(date.month)}`;
}

export function formatShortDate(date: CalendarDate) {
  return `Day ${date.day}, ${monthName(date.month)} · ${formatClock(date)}`;
}

export function calculateAge(
  date: CalendarDate,
  birthday: { month: number; day: number },
  birthYear: number
) {
  let age = date.year - birthYear;

  if (
    date.month < birthday.month ||
    (date.month === birthday.month && date.day < birthday.day)
  ) {
    age -= 1;
  }

  return Math.max(0, age);
}

export function formatStoryDate(
  date: CalendarDate,
  birthday: { month: number; day: number },
  birthYear: number
) {
  const age = calculateAge(date, birthday, birthYear);

  return `Age ${age} · Day ${date.day}, ${monthName(date.month)} · ${formatClock(date)}`;
}

export function daysBetween(from: CalendarDate, to: CalendarDate) {
  return dateToDayNumber(to) - dateToDayNumber(from);
}

export function dateSortValue(date: CalendarDate) {
  return (
    dateToDayNumber(date) * SECONDS_PER_DAY +
    clampHour(date.hour) * SECONDS_PER_HOUR +
    clampMinute(date.minute) * SECONDS_PER_MINUTE +
    clampSecond(date.second ?? 0)
  );
}

function dateToDayNumber(date: CalendarDate) {
  return date.year * MONTHS_PER_YEAR * DAYS_PER_MONTH + date.month * DAYS_PER_MONTH + date.day;
}

function dayNumberToDate(value: number) {
  let total = value;
  let year = Math.floor(total / (MONTHS_PER_YEAR * DAYS_PER_MONTH));
  let remainder = total % (MONTHS_PER_YEAR * DAYS_PER_MONTH);
  let month = Math.floor(remainder / DAYS_PER_MONTH);
  remainder %= DAYS_PER_MONTH;
  let day = remainder;

  if (day === 0) {
    day = DAYS_PER_MONTH;
    month -= 1;
  }

  if (month === 0) {
    month = MONTHS_PER_YEAR;
    year -= 1;
  }

  return { year, month, day };
}

export function shiftDate(date: CalendarDate, days: number): CalendarDate {
  const shifted = dayNumberToDate(dateToDayNumber(date) + Math.round(days));

  return { ...date, ...shifted };
}

export function advanceSeconds(date: CalendarDate, seconds: number): CalendarDate {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const total =
    clampHour(date.hour) * SECONDS_PER_HOUR +
    clampMinute(date.minute) * SECONDS_PER_MINUTE +
    clampSecond(date.second ?? 0) +
    safeSeconds;

  const dayShift = Math.floor(total / SECONDS_PER_DAY);
  const remainder = total % SECONDS_PER_DAY;
  const shifted = dayNumberToDate(dateToDayNumber(date) + dayShift);

  return {
    ...date,
    ...shifted,
    hour: Math.floor(remainder / SECONDS_PER_HOUR),
    minute: Math.floor((remainder % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE),
    second: remainder % SECONDS_PER_MINUTE,
  };
}

export function setClock(
  date: CalendarDate,
  hour: number,
  minute: number,
  second = 0
): CalendarDate {
  const targetHour = clampHour(hour);
  const targetMinute = clampMinute(minute);
  const targetSecond = clampSecond(second);
  const current =
    clampHour(date.hour) * SECONDS_PER_HOUR +
    clampMinute(date.minute) * SECONDS_PER_MINUTE +
    clampSecond(date.second ?? 0);
  const target = targetHour * SECONDS_PER_HOUR + targetMinute * SECONDS_PER_MINUTE + targetSecond;

  if (target >= current) {
    return { ...date, hour: targetHour, minute: targetMinute, second: targetSecond };
  }

  return {
    ...shiftDate(date, 1),
    hour: targetHour,
    minute: targetMinute,
    second: targetSecond,
  };
}

export function sameDate(a: CalendarDate, b: CalendarDate) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function isBirthday(date: CalendarDate, birthday: { month: number; day: number }) {
  return date.month === birthday.month && date.day === birthday.day;
}

export function normalizeDate(
  value: Partial<CalendarDate> | undefined,
  fallback: CalendarDate
): CalendarDate {
  if (!value) {
    return fallback;
  }

  const legacy = value as Partial<CalendarDate> & { timeOfDay?: string };
  const legacyHours: Record<string, number> = {
    morning: 8,
    afternoon: 14,
    evening: 19,
    night: 22,
  };

  const year = Number.isFinite(value.year) ? Number(value.year) : fallback.year;
  const month = Number.isFinite(value.month) ? Number(value.month) : fallback.month;
  const day = Number.isFinite(value.day) ? Number(value.day) : fallback.day;
  const hour = Number.isFinite(value.hour)
    ? clampHour(Number(value.hour))
    : legacyHours[legacy.timeOfDay ?? ''] ?? fallback.hour;
  const minute = Number.isFinite(value.minute) ? clampMinute(Number(value.minute)) : fallback.minute;
  const second = Number.isFinite(value.second)
    ? clampSecond(Number(value.second))
    : fallback.second ?? 0;

  return { year, month, day, hour, minute, second };
}

export function paceCapSeconds(pace: ScenePace | undefined, sceneEnded: boolean) {
  switch (pace) {
    case 'combat':
      return sceneEnded ? 7200 : 600;
    case 'chase':
      return sceneEnded ? 7200 : 1800;
    case 'conversation':
      return 3600;
    case 'travel':
      return 3 * SECONDS_PER_DAY;
    case 'downtime':
      return 7 * SECONDS_PER_DAY;
    default:
      return SECONDS_PER_DAY;
  }
}

function clampHour(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(23, Math.round(value)));
}

function clampMinute(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(59, Math.round(value)));
}

function clampSecond(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(59, Math.round(value)));
}

export { SECONDS_PER_DAY, SECONDS_PER_HOUR, SECONDS_PER_MINUTE };
