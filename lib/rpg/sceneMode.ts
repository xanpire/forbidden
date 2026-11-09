// Scene modes: how a scene plays. The narrator writes normal prose, a real
// conversation (mostly speech, short *action* lines), or an intimate scene.
// The mode is decided before each narrator call from two signals:
//
// 1. The player's own input. Speaking, acting in place or leaving is the
//    most reliable signal there is, because the player knows what they meant.
// 2. How the state tracker tagged earlier turns (exchange, instruction,
//    remark, action, travel). Conversation mode is slow to start (two
//    exchanges in a row with the same people, or one plus the player
//    answering in speech) and quick to stop (a scene-changing move).
//
// Before full conversation mode, an exchange already leans the narrator
// toward shorter, more spoken replies, so a wrong call costs one chattier
// turn, not a jarring change. The player can force or switch off a mode from
// the chip on the Story screen (`override`).

import { resolveEntity } from './entities';
import { displayName } from './names';
import { characterRefs } from './characterRefs';
import { isDeceased } from './deaths';
import type {
  AppDatabase,
  TurnKind,
  SceneModeName,
  SceneModeState,
  ScenePace,
} from './types';
import { isPlayer, isPlayerName } from './player';
import { intimacyAllowed } from './intimacy';

/** Exchange beats in a row before conversation mode starts by itself. */
export const CONVERSATION_STREAK = 2;
/** The least time a conversation-mode turn takes (a line or two of talk). */
export const CONVERSATION_MODE_MINIMUM_SECONDS = 20;

export const DEFAULT_SCENE_MODE: SceneModeState = {
  current: 'normal',
  exchangeStreak: 0,
  partners: [],
};

export function sceneModeOf(db: AppDatabase): SceneModeState {
  return db.state.sceneMode ?? DEFAULT_SCENE_MODE;
}

// ---------------------------------------------------------------------------
// Reading the player's input

const QUOTED = /["“”„«»]([^"“”„«»]*[\p{L}\p{N}][^"“”„«»]*)["“”„«»]/u;
const NEGATED = /\b(not|never|won't|wouldn't|don't|do not|can't|cannot|refuse to|without)\s+(?:\w+\s+){0,2}$/i;

function hasMove(text: string, pattern: RegExp) {
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0);
    if (!NEGATED.test(before)) {
      return true;
    }
  }
  return false;
}
const LEAVES =
  /\b(leave|leaves|leaving|walk (?:away|off|out|on|back|to|toward|towards|into|through|down|up|north|south|east|west)|walk away|head (?:out|off|back|north|south|east|west|to|toward|towards|for|into|down|up)|go (?:to|back|out|inside|outside|home|north|south|east|west|into|up|down)|set (?:off|out)|travel|journey|run (?:off|away|to|toward|towards|after)|flee|race (?:off|to|after)|follow (?:him|her|them|the|it)|i follow|you follow|climb|enter|step (?:out|outside|inside|into|through)|jump (?:down|off|into|across|from)|leap (?:down|off|into|across|from|away)|sleep|go to bed|lie down to sleep|turn in for the night|rest (?:for|until) |wait (?:until|till|for (?:the|an?|hours?|nightfall|dawn|morning))|train (?:for|until)|keep (?:walking|moving|going|running))\b/gi;

export type PlayerInput = {
  /** The player says something out loud. */
  speaks: boolean;
  /** The player does something that changes the scene: leaves, moves on, sleeps, waits it out. */
  changesScene: boolean;
};

/** What the player's input is: talk, a scene change, or a small move in place. */
export function readPlayerInput(input: string): PlayerInput {
  const text = input ?? '';
  const speaks = QUOTED.test(text);
  // Only what the player does counts as action, never the words he says.
  const doing = text.replace(new RegExp(QUOTED.source, 'gu'), ' ');
  const plainSpeech = !speaks && !/\*/.test(text) && /\?\s*$/.test(text.trim());

  return {
    speaks: speaks || plainSpeech,
    changesScene: hasMove(doing, LEAVES),
  };
}

// ---------------------------------------------------------------------------
// The mode for the next turn

export type TurnMode = {
  /** The mode this turn is narrated in. */
  mode: SceneModeName;
  /** Not yet a conversation, but talk is building: shorter, more spoken. */
  lean: boolean;
  /** The mode the player's move ends this turn, for a short normal-prose transition. */
  ending?: 'conversation';
  /** True when the player chose the mode from the chip. */
  manual: boolean;
  /** Who the player is talking with (names, for the prompt and the chip). */
  with: string[];
  /** Intimate mode only: the player chose fade to black for this scene. */
  fade?: boolean;
};

function partnerNames(db: AppDatabase, partners: string[]) {
  return partners
    .map((partner) => {
      const entity = db.entities.find((item) => item.id === partner);
      return entity ? (isPlayer(db, entity) ? '' : displayName(db, entity)) : partner;
    })
    .filter((name) => name && !isPlayerName(db, name))
    .slice(0, 4);
}

function castNames(db: AppDatabase) {
  return (db.state.sceneCast ?? []).filter((name) => {
    const entity = resolveEntity(db, name);
    return !isPlayerName(db, name) && !(entity && isPlayer(db, entity)) && !(entity && isDeceased(entity));
  });
}

/**
 * The mode a turn will be narrated in, from the scene so far and what the player
 * writes now. Pure and deterministic, so a regenerated turn gets the same.
 */
export function resolveTurnMode(db: AppDatabase, input: string): TurnMode {
  const state = sceneModeOf(db);
  const said = readPlayerInput(input);
  const talking = state.exchangeStreak > 0 && !db.state.sceneClosed;
  const talkers = partnerNames(db, state.partners);
  const people = talkers.length > 0 ? talkers : castNames(db).slice(0, 4);
  const wasConversation = state.current === 'conversation';

  if (state.override === 'normal') {
    return { mode: 'normal', lean: false, manual: true, with: [] };
  }

  // An intimate scene goes on until the tracker says it ended or the player
  // moves on, and only while everyone in it passes the adults-only check.
  const intimateWith = (state.intimateWith ?? []).filter((id) => db.entities.some((entity) => entity.id === id && !isDeceased(entity)));
  if (intimateWith.length > 0 && !said.changesScene && intimacyAllowed(db, intimateWith)) {
    const names = intimateWith.map((id) => db.entities.find((entity) => entity.id === id)!).map((entity) => displayName(db, entity));
    return { mode: 'intimate', lean: false, manual: false, with: names, fade: state.fadeToBlack === true };
  }

  if (state.override === 'conversation') {
    return { mode: 'conversation', lean: false, manual: true, with: people };
  }

  // Quick to stop: a move that changes the scene ends the talk now.
  if (said.changesScene) {
    return {
      mode: 'normal',
      lean: false,
      ending: wasConversation || state.exchangeStreak >= CONVERSATION_STREAK ? 'conversation' : undefined,
      manual: false,
      with: [],
    };
  }

  // Slow to start: two exchanges in a row, or one and the player answering out loud.
  const settled =
    talking &&
    (state.exchangeStreak >= CONVERSATION_STREAK ||
      (state.exchangeStreak >= CONVERSATION_STREAK - 1 && said.speaks));

  if (settled) {
    return { mode: 'conversation', lean: false, manual: false, with: people };
  }

  // The dial: talk is building, so the reply leans spoken.
  const lean = talking || (said.speaks && castNames(db).length > 0);
  return { mode: 'normal', lean, manual: false, with: lean ? people : [] };
}

// ---------------------------------------------------------------------------
// After the turn

function resolvePartners(db: AppDatabase, raw: string[]): string[] {
  const refs = characterRefs(db);
  const ids = raw
    .map((value) => {
      const trimmed = value.trim();
      const entity = refs.get(trimmed.toLowerCase()) ?? resolveEntity(db, trimmed) ?? resolveEntity(db, trimmed.replace(/-/g, ' '));
      return entity ? entity.id : trimmed.toLowerCase();
    })
    .filter((value) => value && !isPlayerName(db, value));

  return [...new Set(ids)].slice(0, 6);
}

/** When the tracker gave no turn kind: read it from the pace and the player's input. */
export function fallbackTurnKind(pace: ScenePace | undefined, input: string, narration: string): TurnKind {
  const said = readPlayerInput(input);

  if (pace === 'travel') return 'travel';
  if (said.changesScene) return 'action';
  if (said.speaks && QUOTED.test(narration)) return 'exchange';
  return QUOTED.test(narration) ? 'remark' : 'action';
}

/**
 * Records how the turn played: the exchange streak and who it is with, the
 * mode it was narrated in, and clears a chip choice that no longer applies.
 */
export function applyTurnKind(
  db: AppDatabase,
  options: {
    turnKind?: { kind: TurnKind; with: string[] };
    modeUsed?: SceneModeName;
    input: string;
    narration: string;
    pace: ScenePace | undefined;
    sceneEnded: boolean;
  }
): AppDatabase {
  const before = sceneModeOf(db);
  const kind = options.turnKind?.kind ?? fallbackTurnKind(options.pace, options.input, options.narration);
  const said = readPlayerInput(options.input);
  let partners = resolvePartners(db, options.turnKind?.with ?? []);

  if (partners.length === 0 && kind === 'exchange') {
    partners = resolvePartners(db, castNames(db));
  }

  let streak = before.exchangeStreak;
  let kept = before.partners;

  if (options.sceneEnded || kind === 'action' || kind === 'travel') {
    streak = 0;
    kept = [];
  } else if (kind === 'exchange') {
    const overlaps =
      before.partners.length === 0 || partners.length === 0 || partners.some((id) => before.partners.includes(id));

    if (streak > 0 && overlaps) {
      // Someone joining in turns it into a group conversation.
      streak += 1;
      kept = [...new Set([...before.partners, ...partners])].slice(0, 6);
    } else {
      streak = 1;
      kept = partners;
    }
  } else if (streak < CONVERSATION_STREAK && options.modeUsed !== 'conversation') {
    // A passing line or an order never starts a conversation, and breaks a
    // talk that hadn't settled yet. A settled one carries on through it.
    streak = 0;
    kept = [];
  }

  // The player's own scene-changing move ends the talk, whatever the tag said.
  if (said.changesScene && kind !== 'exchange') {
    streak = 0;
    kept = [];
  }

  let override = before.override;

  if (override === 'normal' && streak === 0) {
    // Switched off until this conversation was over; now it is.
    override = undefined;
  }

  const next: SceneModeState = {
    current: options.modeUsed ?? before.current,
    exchangeStreak: Math.min(streak, 99),
    partners: kept,
    lastKind: kind,
    ...(override ? { override } : {}),
    ...(before.intimateWith ? { intimateWith: before.intimateWith } : {}),
    ...(before.fadeToBlack ? { fadeToBlack: true } : {}),
  };

  return { ...db, state: { ...db.state, sceneMode: next } };
}

/** The player's choice from the mode chip: a mode, or null for automatic. */
export function setSceneModeOverride(db: AppDatabase, mode: SceneModeName | null): AppDatabase {
  const before = sceneModeOf(db);
  const { override: _drop, ...rest } = before;
  const next: SceneModeState = mode ? { ...rest, override: mode } : rest;
  return { ...db, state: { ...db.state, sceneMode: next } };
}

/** An offered move as the player's input. */
export function sceneOptionInput(option: string) {
  const text = option.trim().replace(/^\*+|\*+$/g, '').replace(/[.!]*$/, '');
  return `*${text}.*`;
}

export function normalizeSceneMode(value: unknown): SceneModeState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const raw = value as Partial<SceneModeState>;
  const modes: SceneModeName[] = ['normal', 'conversation', 'intimate'];
  const beats: TurnKind[] = ['exchange', 'instruction', 'remark', 'action', 'travel'];

  return {
    current: modes.includes(raw.current as SceneModeName) ? (raw.current as SceneModeName) : 'normal',
    exchangeStreak:
      typeof raw.exchangeStreak === 'number' && Number.isFinite(raw.exchangeStreak)
        ? Math.max(0, Math.min(99, Math.floor(raw.exchangeStreak)))
        : 0,
    partners: Array.isArray(raw.partners) ? raw.partners.filter((item) => typeof item === 'string').slice(0, 6) : [],
    ...(beats.includes(raw.lastKind as TurnKind) ? { lastKind: raw.lastKind } : {}),
    ...(modes.includes(raw.override as SceneModeName) && raw.override !== 'intimate' ? { override: raw.override } : {}),
    ...(Array.isArray(raw.intimateWith) && raw.intimateWith.length > 0
      ? { intimateWith: raw.intimateWith.filter((item) => typeof item === 'string').slice(0, 4) }
      : {}),
    ...(raw.fadeToBlack === true ? { fadeToBlack: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// Prompt lines

/** One or two lines for the narrator: which mode this turn is, and with whom. */
export function formatSceneModeLine(turn: TurnMode): string {
  const who = turn.with.length > 0 ? ` with ${turn.with.join(', ')}` : '';
  const chosen = turn.manual ? ' (the player chose this mode: keep it even if the scene moves on)' : '';

  if (turn.mode === 'intimate') {
    return turn.fade
      ? `SCENE MODE: an intimate scene${who}, but the player chose to fade to black: cut away from anything intimate and pick up afterwards.`
      : `SCENE MODE: intimate${who}. Slow, close and sensory, plenty of dialogue; a shorter reply that leaves room for the player.`;
  }

  if (turn.mode === 'conversation') {
    return `SCENE MODE: conversation${who}${chosen}. Mostly speech, short *action* lines, length follows the talk.`;
  }

  if (turn.ending === 'conversation') {
    return 'SCENE MODE: the player\'s move ends the conversation. A short transition in normal prose, then carry on normally.';
  }

  if (turn.lean) {
    return `SCENE MODE: talk is building${who}. Keep this reply shorter and more spoken than usual.`;
  }

  if (turn.manual) {
    return 'SCENE MODE: normal narration (the player chose this).';
  }

  return '';
}

/** The same, for the state tracker. */
export function formatSceneModeTracking(turn: TurnMode | null, modeUsed: SceneModeName | undefined): string {
  const mode = modeUsed ?? turn?.mode ?? 'normal';
  return `SCENE MODE THIS TURN: ${mode === 'normal' ? 'normal narration' : mode}`;
}
