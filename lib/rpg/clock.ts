// The in-story clock as the state diff moves it. The forward step for a turn
// is decided earlier by resolveTurnClock (pacing.ts); this applies it and
// ages everyone across a year boundary.

import { advanceSeconds, normalizeDate, setClock } from './calendar';
import type { AppDatabase, CalendarDate, TurnDiff } from './types';

type StateDiff = NonNullable<TurnDiff['state']>;

/** Applies inStoryDate / elapsedSeconds / clockTime from the diff. */
export function applyClockChange(db: AppDatabase, state: StateDiff): AppDatabase {
  const previousDate = db.state.inStoryDate;
  let updatedDate: CalendarDate | null = null;

  if (state.inStoryDate) {
    updatedDate = normalizeDate(state.inStoryDate, db.state.inStoryDate);
  } else {
    let working = db.state.inStoryDate;

    const hadElapsed = typeof state.elapsedSeconds === 'number' && state.elapsedSeconds > 0;

    if (hadElapsed) {
      working = advanceSeconds(working, state.elapsedSeconds ?? 0);
    }

    if (state.clockTime) {
      working = hadElapsed
        ? {
            ...working,
            hour: state.clockTime.hour,
            minute: state.clockTime.minute,
            second: 0,
          }
        : setClock(working, state.clockTime.hour, state.clockTime.minute);
    }

    if (working !== db.state.inStoryDate) {
      updatedDate = working;
    }
  }

  if (!updatedDate) {
    return db;
  }

  const finalDate = updatedDate;
  const yearDelta = finalDate.year - previousDate.year;
  const next: AppDatabase = { ...db, state: { ...db.state, inStoryDate: finalDate } };

  if (yearDelta === 0) {
    return next;
  }

  // Ages without a birth year move with the calendar.
  return {
    ...next,
    entities: next.entities.map((entity) =>
      entity.birthYear === undefined && entity.age !== undefined
        ? { ...entity, age: Math.max(0, entity.age + yearDelta) }
        : entity
    ),
    bonds: next.bonds.map((bond) => ({ ...bond, updatedInStoryDate: finalDate })),
  };
}

/** Counts turns with no time reported; drives a prompt nudge only. */
export function applyClockTick(db: AppDatabase, diff: TurnDiff): AppDatabase {
  const state = diff.state;
  const hadTimeUpdate = Boolean(
    state?.inStoryDate ||
    state?.clockTime ||
    (typeof state?.elapsedSeconds === 'number' && state.elapsedSeconds > 0)
  );

  const turns = db.state.turnsWithoutTimeChange ?? 0;

  // The clock never advances on its own. This counter only drives a prompt
  // nudge when the story has gone several turns without any time reporting.
  return {
    ...db,
    state: {
      ...db.state,
      turnsWithoutTimeChange: hadTimeUpdate ? 0 : Math.min(turns + 1, 9),
    },
  };
}
