import type { CalendarDate } from './types';

export const DEFAULT_DATE: CalendarDate = {
  year: 13,
  month: 10,
  day: 1,
  timeOfDay: 'night',
};

const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH = 30;

export function dateKey(date: CalendarDate) {
  return `${date.year}-${date.month}-${date.day}`;
}

export function formatDate(date: CalendarDate) {
  return `Year ${date.year} · Month ${date.month} · Day ${date.day} · ${capitalize(date.timeOfDay)}`;
}

export function formatShortDate(date: CalendarDate) {
  return `Day ${date.day} · Month ${date.month} · Year ${date.year} · ${capitalize(date.timeOfDay)}`;
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

  return `Age ${age} · Day ${date.day} · Month ${date.month} · Year ${date.year} · ${capitalize(date.timeOfDay)}`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function daysBetween(from: CalendarDate, to: CalendarDate) {
  const fromDays =
    from.year * MONTHS_PER_YEAR * DAYS_PER_MONTH +
    from.month * DAYS_PER_MONTH +
    from.day;
  const toDays =
    to.year * MONTHS_PER_YEAR * DAYS_PER_MONTH +
    to.month * DAYS_PER_MONTH +
    to.day;

  return toDays - fromDays;
}

export function shiftDate(date: CalendarDate, days: number): CalendarDate {
  const totalDays =
    date.year * MONTHS_PER_YEAR * DAYS_PER_MONTH +
    date.month * DAYS_PER_MONTH +
    date.day +
    days;

  let year = Math.floor(totalDays / (MONTHS_PER_YEAR * DAYS_PER_MONTH));
  let remainder = totalDays % (MONTHS_PER_YEAR * DAYS_PER_MONTH);
  let month = Math.floor(remainder / DAYS_PER_MONTH);
  remainder = remainder % DAYS_PER_MONTH;
  let day = remainder;

  if (day === 0) {
    day = DAYS_PER_MONTH;
    month -= 1;
  }

  if (month === 0) {
    month = MONTHS_PER_YEAR;
    year -= 1;
  }

  return {
    ...date,
    year,
    month,
    day,
  };
}

export function sameDate(a: CalendarDate, b: CalendarDate) {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

export function isBirthday(date: CalendarDate, birthday: { month: number; day: number }) {
  return date.month === birthday.month && date.day === birthday.day;
}

export function normalizeDate(value: Partial<CalendarDate> | undefined, fallback: CalendarDate): CalendarDate {
  if (!value) {
    return fallback;
  }

  const year = Number.isFinite(value.year) ? Number(value.year) : fallback.year;
  const month = Number.isFinite(value.month) ? Number(value.month) : fallback.month;
  const day = Number.isFinite(value.day) ? Number(value.day) : fallback.day;
  const timeOfDay =
    value.timeOfDay === 'morning' ||
    value.timeOfDay === 'afternoon' ||
    value.timeOfDay === 'evening' ||
    value.timeOfDay === 'night'
      ? value.timeOfDay
      : fallback.timeOfDay;

  return {
    year,
    month,
    day,
    timeOfDay,
  };
}
