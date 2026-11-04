import { advanceSeconds, dateSortValue, paceCapSeconds, secondsBetween, setClock } from './calendar';
import type { CalendarDate, ScenePace } from './types';

const COMBAT = /\b(fight|fights|fighting|fought|battle|clash|clashes|strike|strikes|blade|blades|kunai|shuriken|parry|dodge|blood|jutsu|punch|kick|choke|chokes|choked|choking|strangle|opponent|enemy|ambush|skirmish|duel|cut|wound)\b/i;
const CHASE = /\b(chase|chasing|pursuit|flee|fleeing|running|escape|escaped|hunt(ed|ing)?|track(ed|ing)?)\b/i;
const TRAVEL = /\b(travel|traveled|travelling|traveling|road|ride|rode|riding|march|marched|marching|journey|miles|border|trail|crossing|sailed|sailing|walked|walking)\b/i;
const DOWNTIME = /\b(sleep|sleeps|sleeping|slept|rest|rests|rested|resting|camp|camps|camped|recover|recovers|recovering|recovered|train|trains|trained|training|nap|naps|napped|dosed off|wake|wakes|woke|woken|morning)\b/i;
const CONVERSATION = /\b(says|said|asks|asked|replies|replied|answers|answered|speaks|spoke|talks|talked|whispers|whispered|mutters|muttered|silence|stares|looks)\b/i;

// Fallback when the narrator forgets scene_pace. Order matters: combat and
// chase beat travel/rest, because an action scene must never be skipped.
export function inferScenePace(text: string): ScenePace {
  if (!text) {
    return 'conversation';
  }

  if (COMBAT.test(text)) {
    return 'combat';
  }

  if (CHASE.test(text)) {
    return 'chase';
  }

  if (DOWNTIME.test(text)) {
    return 'downtime';
  }

  if (TRAVEL.test(text)) {
    return 'travel';
  }

  if (CONVERSATION.test(text)) {
    return 'conversation';
  }

  return 'conversation';
}

/**
 * The least in-story time a turn of each kind takes. Every turn moves the
 * clock by at least this much, even when the story never says how long.
 */
export const PACE_MINIMUM_SECONDS: Record<ScenePace, number> = {
  combat: 15,
  chase: 60,
  conversation: 120,
  downtime: 600,
  travel: 1800,
};

export function paceMinimumSeconds(pace: ScenePace | undefined) {
  return PACE_MINIMUM_SECONDS[pace ?? 'conversation'];
}

/** Hour a full night's sleep wakes Kan at. */
export const WAKE_HOUR = 7;
const MIN_NIGHT_SECONDS = 4 * 3600;
const LATE_SLEEP_SECONDS = 8 * 3600;

/**
 * Seconds until the next morning. Going to bed after 3 AM means a short night
 * would end before 7, so Kan sleeps eight hours instead.
 */
export function secondsUntilMorning(current: CalendarDate) {
  const now = current.hour * 3600 + current.minute * 60 + (current.second ?? 0);
  let gap = WAKE_HOUR * 3600 - now;

  if (gap < 0) {
    gap += 86400;
  }

  return gap < MIN_NIGHT_SECONDS ? LATE_SLEEP_SECONDS : gap;
}

/** What the story itself says the turn took: max(reported, parsed), capped by pace. */
export function resolveElapsedSeconds(options: {
  reportedSeconds: number;
  detectedSeconds: number;
  pace: ScenePace | undefined;
  sceneEnded: boolean;
}) {
  const desired = Math.max(0, options.reportedSeconds, options.detectedSeconds);
  return Math.min(desired, paceCapSeconds(options.pace, options.sceneEnded));
}

/** A stated hour this close behind the clock is the narrator restating "now". */
const RESTATED_CLOCK_SECONDS = 3600;

/**
 * The single source of truth for how far a turn moves the clock.
 *
 * Time passed = the largest of what the narrator reports, what the narration
 * parser finds, and the minimum for the scene type. Fights cannot skip days
 * (pace cap, no date jumps, no backward clocks); travel only skips days when
 * the story says so; a full night's sleep jumps to the next morning.
 *
 * Returns the total seconds to advance; the caller applies only that.
 */
export function resolveTurnClock(options: {
  reportedSeconds: number;
  /** clock_time from the state model, used when the prose names no hour. */
  reportedClock?: { hour: number; minute: number };
  detected: {
    elapsedSeconds: number;
    clock?: { hour: number; minute: number };
    explicitDate?: CalendarDate;
    sleptNight?: boolean;
  };
  pace: ScenePace | undefined;
  sceneEnded: boolean;
  current: CalendarDate;
}) {
  const { current, pace, sceneEnded } = options;
  const frozen = (pace === 'combat' || pace === 'chase') && !sceneEnded;
  const minimumSeconds = paceMinimumSeconds(pace);
  const storySeconds = resolveElapsedSeconds({
    reportedSeconds: options.reportedSeconds,
    detectedSeconds: options.detected.elapsedSeconds,
    pace,
    sceneEnded,
  });
  const now = dateSortValue(current);
  let target = advanceSeconds(current, storySeconds);
  let storyTimed = storySeconds > 0;

  const explicit = frozen ? undefined : options.detected.explicitDate;

  if (explicit && dateSortValue(explicit) > now) {
    target = explicit;
    storyTimed = true;
  } else {
    const clock = options.detected.clock ?? options.reportedClock;

    if (clock) {
      const sameDay = { ...target, hour: clock.hour, minute: clock.minute, second: 0 };
      const behind = dateSortValue(target) - dateSortValue(sameDay);

      if (storySeconds > 0 && behind <= 0) {
        // "Two hours later, at three": the hour lands on the day the story reached.
        target = sameDay;
        storyTimed = true;
      } else if (storySeconds > 0 && dateSortValue(sameDay) > now) {
        // "The next morning, at seven": same day as the jump, still forward.
        target = sameDay;
        storyTimed = true;
      } else if (storySeconds === 0) {
        const onToday = { ...current, hour: clock.hour, minute: clock.minute, second: 0 };
        const back = now - dateSortValue(onToday);

        if (back <= 0) {
          target = onToday;
          storyTimed = true;
        } else if (!frozen && back > RESTATED_CLOCK_SECONDS) {
          target = setClock(current, clock.hour, clock.minute);
          storyTimed = true;
        }
      }
    }

    if (options.detected.sleptNight && !frozen && !options.detected.clock) {
      const morning = advanceSeconds(current, secondsUntilMorning(current));

      if (dateSortValue(morning) > dateSortValue(target)) {
        target = morning;
      }

      storyTimed = true;
    }
  }

  const elapsedSeconds = Math.max(minimumSeconds, secondsBetween(current, target));

  return {
    /** Total seconds this turn advances the clock. */
    elapsedSeconds,
    /** The pace minimum that applied. */
    minimumSeconds,
    /** False when only the pace minimum moved the clock. */
    storyTimed,
  };
}
