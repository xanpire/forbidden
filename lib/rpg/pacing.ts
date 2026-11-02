import { paceCapSeconds } from './calendar';
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

// Combines what the narrator reported with what the prose actually says, then
// applies the pace ceiling. Combat can never skip days around the player.
export function resolveElapsedSeconds(options: {
  reportedSeconds: number;
  detectedSeconds: number;
  pace: ScenePace | undefined;
  sceneEnded: boolean;
}) {
  const desired = Math.max(0, options.reportedSeconds, options.detectedSeconds);
  return Math.min(desired, paceCapSeconds(options.pace, options.sceneEnded));
}

// Resolves the turn clock in one place: caps elapsed time, blocks date jumps
// during a fight Kan is in, and only lets the clock move forward mid-combat.
export function resolveTurnClock(options: {
  reportedSeconds: number;
  detected: {
    elapsedSeconds: number;
    clock?: { hour: number; minute: number };
    explicitDate?: CalendarDate;
  };
  pace: ScenePace | undefined;
  sceneEnded: boolean;
  current: CalendarDate;
}) {
  const elapsedSeconds = resolveElapsedSeconds({
    reportedSeconds: options.reportedSeconds,
    detectedSeconds: options.detected.elapsedSeconds,
    pace: options.pace,
    sceneEnded: options.sceneEnded,
  });

  const frozen = (options.pace === 'combat' || options.pace === 'chase') && !options.sceneEnded;
  const currentMinutes = options.current.hour * 60 + options.current.minute;
  const clock = options.detected.clock
    ? !frozen ||
      options.detected.clock.hour * 60 + options.detected.clock.minute >= currentMinutes
      ? options.detected.clock
      : undefined
    : undefined;

  return {
    elapsedSeconds,
    clock,
    explicitDate: frozen ? undefined : options.detected.explicitDate,
  };
}
