// One turn's state change (applyTurnDiff) and the model calls behind memory:
// the state step and the summaries. The pieces live in entities, bonds,
// facts, clock, jutsu, log and stateBlock.

import { type ChatRequest, completeChat } from '../openrouter';
import { applyBondDiff } from './bonds';
import { applyCanonEndgames } from './canonEndgame';
import { daysBetween, formatDate } from './calendar';
import { applyClockChange, applyClockTick } from './clock';
import { applyCompanionChanges, applySharedScene, castWithCompanions } from './companions';
import { markAlive, markDeceased } from './deaths';
import { buildIndices } from './db';
import { type DebugCallKind, recordDebugCall, recordDebugState } from './debug';
import { classifyLocation } from './encounters';
import { applyEntityDiff, mergeDuplicateEntities, recordPresence, resolveCharacterRefs, resolveEntity } from './entities';
import { applyGrudgeChanges } from './grudges';
import { applyReputationChanges } from './reputation';
import { applyFactDiff, applyThreadDiff, recordSceneEvent } from './facts';
import { applyJutsuDiff } from './jutsu';
import { cloneDatabase } from './log';
import { buildArcSummaryPrompt, buildExtractionPrompt, buildSceneSummaryPrompt, buildTimeSkipPrompt } from './prompt';
import { convertStateBlock, parseJsonObject, repairTruncatedJson } from './stateBlock';
import { TURN_STATE_SCHEMA, TURN_STATE_SCHEMA_NAME } from './stateSchema';
import { trimToSentence, uniqueList } from './util';
import type { AppDatabase, CalendarDate, RawLogEntry, TurnDiff } from './types';

/** Room for the state reply. Thinking tokens count against this too. */
const STATE_MAX_TOKENS = 3000;
/** A retry after the first reply hit the cap. */
const STATE_RETRY_MAX_TOKENS = 4500;

export function applyTurnDiff(db: AppDatabase, diff: TurnDiff | null): AppDatabase {
  if (!diff || typeof diff !== 'object') {
    return db;
  }

  let next = cloneDatabase(db);

  if (diff.state) {
    next = applyStateDiff(next, diff.state);
  }

  if (Array.isArray(diff.entities)) {
    for (const entity of diff.entities) {
      next = applyEntityDiff(next, entity);
    }
  }

  // After entities, so someone introduced and killed in the same turn exists.
  if (Array.isArray(diff.revived)) {
    for (const person of diff.revived) {
      if (person.entityId) {
        next = markAlive(next, person.entityId);
      }
    }
  }

  if (Array.isArray(diff.deaths)) {
    for (const death of diff.deaths) {
      const entity = death.entityId
        ? next.entities.find((item) => item.id === death.entityId)
        : resolveEntity(next, death.name);

      if (entity) {
        next = markDeceased(next, entity.id, { cause: death.cause, known: true });
      }
    }
  }

  if (Array.isArray(diff.jutsuUsed)) {
    for (const jutsu of diff.jutsuUsed) {
      next = applyJutsuDiff(next, jutsu);
    }
  }

  // Joins and partings: after people and deaths, before bonds, so a bond
  // the story gives a new companion lands on the bond they start with.
  next = applyCompanionChanges(next, diff);

  // Whose bond the story itself moved this turn (shared time adds nothing on top).
  const storyMovedBond = new Set<string>();

  if (Array.isArray(diff.bonds)) {
    for (const bond of diff.bonds) {
      next = applyBondDiff(next, bond);

      if (typeof bond.affinityDelta === 'number' && bond.affinityDelta !== 0) {
        const id = bond.entityId ?? resolveEntity(next, bond.character)?.id;

        if (id) {
          storyMovedBond.add(id);
        }
      }
    }
  }

  // After bonds and deaths: a soured bond can turn into a grudge, and the
  // dead let theirs go.
  next = applyGrudgeChanges(next, diff);
  next = applyReputationChanges(next, diff.reputation, diff.bountySeen);

  if (Array.isArray(diff.facts)) {
    for (const fact of diff.facts) {
      next = applyFactDiff(next, fact);
    }
  }

  if (Array.isArray(diff.threads)) {
    for (const thread of diff.threads) {
      next = applyThreadDiff(next, thread);
    }
  }

  // Companions are in every scene, whether or not the tracker listed them.
  const present = castWithCompanions(next, diff.scene?.entities ?? []);

  if (diff.scene?.ended) {
    next = recordSceneEvent(next, { ...diff, scene: { ...diff.scene, entities: present } });
    next = applySharedScene(next, { pace: next.state.scenePace, storyMovedBond });
  }

  next = mergeDuplicateEntities(next);

  if (present.length > 0) {
    next = recordPresence(next, present);
    const cast =
      Array.isArray(next.state.sceneCast) && next.state.sceneCast.length > 0
        ? next.state.sceneCast
        : present;
    next = {
      ...next,
      state: {
        ...next.state,
        sceneCast: castWithCompanions(next, cast).slice(0, 6),
      },
    };
  }

  next = applyClockTick(next, diff);
  // After the clock: a bond the story set this turn cannot outlast canon.
  next = applyCanonEndgames(next);

  next.indices = buildIndices(next);

  return next;
}

type StateDiff = NonNullable<TurnDiff['state']>;

function applyStateDiff(db: AppDatabase, state: StateDiff): AppDatabase {
  let next = { ...db, state: { ...db.state } };

  if (typeof state.mood === 'string' && state.mood.trim()) {
    next.state.mood = state.mood.trim().slice(0, 60);

    next.entities = next.entities.map((entity) =>
      entity.name.toLowerCase() === 'kan'
        ? { ...entity, mood: next.state.mood }
        : entity
    );
  }

  if (typeof state.worldDescription === 'string' && state.worldDescription.trim()) {
    next.state.worldDescription = state.worldDescription.trim().slice(0, 220);
  }

  if (Array.isArray(state.jutsuAdded)) {
    next.state.jutsu = uniqueList([
      ...next.state.jutsu,
      ...state.jutsuAdded.filter(Boolean),
    ]).slice(-12);
  }

  if (Array.isArray(state.jutsuRemoved)) {
    next.state.jutsu = next.state.jutsu.filter(
      (jutsu) => !state.jutsuRemoved?.includes(jutsu)
    );
  }

  if (Array.isArray(state.inventoryAdded)) {
    next.state.inventory = uniqueList([
      ...next.state.inventory,
      ...state.inventoryAdded.filter(Boolean),
    ]).slice(-12);
  }

  if (Array.isArray(state.inventoryRemoved)) {
    next.state.inventory = next.state.inventory.filter(
      (item) => !state.inventoryRemoved?.includes(item)
    );
  }

  if (typeof state.location === 'string' && state.location.trim()) {
    next.state.location = state.location.trim().slice(0, 100);
    next.state.locationKind = state.locationKind ?? classifyLocation(next.state.location);
  } else if (state.locationKind) {
    next.state.locationKind = state.locationKind;
  }

  if (Array.isArray(state.sceneCast)) {
    next.state.sceneCast = state.sceneCast.filter(Boolean).slice(0, 6);
  }

  if (
    state.scenePace === 'combat' ||
    state.scenePace === 'chase' ||
    state.scenePace === 'conversation' ||
    state.scenePace === 'travel' ||
    state.scenePace === 'downtime'
  ) {
    next.state.scenePace = state.scenePace;
  }

  next = applyClockChange(next, state);

  if (typeof state.canonPoint === 'string' && state.canonPoint.trim()) {
    next.state.canonPoint = state.canonPoint.trim().slice(0, 220);
  }

  if (typeof state.chapter === 'number' && Number.isFinite(state.chapter)) {
    next.state.chapter = Math.max(1, Math.round(state.chapter));
  }

  if (typeof state.scene === 'string' && state.scene.trim()) {
    next.state.scene = state.scene.trim().slice(0, 140);
  }

  return next;
}

/** completeChat, with the call (tokens, cost, errors) recorded against a turn in the debug log. */
async function tracedChat(kind: DebugCallKind, debugTurnId: string | undefined, request: ChatRequest) {
  try {
    const result = await completeChat(request);
    recordDebugCall(debugTurnId, {
      kind,
      model: request.model,
      usage: result.usage,
      finishReason: result.finishReason,
      apiKey: request.apiKey,
    });
    return result;
  } catch (caught) {
    recordDebugCall(debugTurnId, {
      kind,
      model: request.model,
      usage: null,
      error: caught instanceof Error ? caught.message : String(caught),
    });
    throw caught;
  }
}

/**
 * Call 2 of a turn: a cheap model reads the narrator's prose and returns the
 * state change through structured JSON output. Throws if the call fails, so
 * the caller can queue a retry.
 */
export async function extractTurnDiff(options: {
  apiKey: string;
  db: AppDatabase;
  userMessage: string;
  assistantMessage: string;
  signal?: AbortSignal;
  /** The narrator reply this belongs to, for the debug log. */
  debugTurnId?: string;
}): Promise<TurnDiff | null> {
  const { apiKey, db, userMessage, assistantMessage, signal, debugTurnId } = options;
  const prompt = buildExtractionPrompt(db, userMessage, assistantMessage);
  recordDebugState(debugTurnId, { status: 'running' });

  const request: ChatRequest = {
    apiKey,
    model: db.settings.extractionModel,
    messages: prompt.messages,
    temperature: 0,
    // The schema asks for every field every turn, and any thinking the model
    // does counts against this cap too. Too low and the JSON is cut off.
    maxTokens: STATE_MAX_TOKENS,
    signal,
    reasoning: { effort: 'low', exclude: true },
    jsonSchema: { name: TURN_STATE_SCHEMA_NAME, schema: TURN_STATE_SCHEMA },
  };

  const first = await tracedChat('state', debugTurnId, request);
  let raw = first.text;
  let parsed = parseJsonObject(first.text);
  let note: string | undefined;

  // Unreadable reply: ask once more (with more room if it ran out), and if
  // that fails too, salvage whatever complete part of either reply exists.
  if (!parsed && !signal?.aborted) {
    const cutOff = first.finishReason === 'length';
    let second: Awaited<ReturnType<typeof tracedChat>> | null = null;

    try {
      second = await tracedChat('state', debugTurnId, {
        ...request,
        maxTokens: cutOff ? STATE_RETRY_MAX_TOKENS : STATE_MAX_TOKENS,
      });
    } catch {
      // Fall through to repairing the first reply.
    }

    if (second) {
      raw = `${first.text}\n\n--- retry ---\n\n${second.text}`;
      parsed = parseJsonObject(second.text);
    }

    if (parsed) {
      note = `First reply unreadable${cutOff ? ' (cut off at the token cap)' : ''}; the retry was read.`;
    } else {
      const repaired =
        (second ? repairTruncatedJson(second.text) : null) ?? repairTruncatedJson(first.text);

      if (repaired) {
        parsed = repaired;
        note = 'Reply was cut off; the complete part of it was applied.';
      }
    }
  }

  recordDebugState(debugTurnId, { status: 'running', raw, note });

  // Still unreadable: the caller falls back to what the app can read from
  // the prose itself (clock, pace, who is named, jutsu Kan called).
  if (!parsed) {
    return null;
  }

  const diff = convertStateBlock(parsed).diff;

  return diff ? resolveCharacterRefs(db, diff) : null;
}

export async function summarizeScene(options: {
  apiKey: string;
  db: AppDatabase;
  messages: RawLogEntry[];
  debugTurnId?: string;
}): Promise<string | null> {
  const { apiKey, db, messages, debugTurnId } = options;

  if (messages.length === 0) {
    return null;
  }

  const prompt = buildSceneSummaryPrompt(db, messages);

  const result = await tracedChat('scene', debugTurnId, {
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 700,
  });

  const text = trimToSentence(result.text);

  return text || null;
}

export async function summarizeTimeSkip(options: {
  apiKey: string;
  db: AppDatabase;
  fromDate: CalendarDate;
  toDate: CalendarDate;
  debugTurnId?: string;
}): Promise<string | null> {
  const { apiKey, db, fromDate, toDate, debugTurnId } = options;

  if (Math.abs(daysBetween(fromDate, toDate)) < 180) {
    return null;
  }

  const prompt = buildTimeSkipPrompt(
    db,
    formatDate(fromDate),
    formatDate(toDate)
  );

  const result = await tracedChat('timeSkip', debugTurnId, {
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 700,
  });

  return trimToSentence(result.text) || null;
}

export async function rollArcSummary(options: {
  apiKey: string;
  db: AppDatabase;
  chapterSummaries: string[];
  debugTurnId?: string;
  debugKind?: 'arc' | 'year';
}): Promise<string | null> {
  const { apiKey, db, chapterSummaries, debugTurnId, debugKind = 'arc' } = options;

  if (chapterSummaries.length < 3) {
    return null;
  }

  const prompt = buildArcSummaryPrompt(db, chapterSummaries);

  const result = await tracedChat(debugKind, debugTurnId, {
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 900,
  });

  return trimToSentence(result.text) || null;
}
