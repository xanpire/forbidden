import { completeChat } from '../openrouter';
import { normalizeDate, formatDate, daysBetween } from './calendar';
import { buildArcSummaryPrompt, buildExtractionPrompt, buildSceneSummaryPrompt, buildTimeSkipPrompt } from './prompt';
import { makeId } from './id';
import { normalizeJutsuNature } from './jutsu';
import { buildIndices } from './db';
import type {
  AppDatabase,
  CalendarDate,
  EventRecord,
  RawLogEntry,
  TurnDiff,
  TurnSnapshot,
} from './types';

export function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

export function cloneDatabase(db: AppDatabase): AppDatabase {
  return JSON.parse(JSON.stringify(db)) as AppDatabase;
}

export function currentTurn(db: AppDatabase) {
  return db.rawLog.filter((message) => message.kind === 'story').length + 1;
}

export function createSnapshot(db: AppDatabase): TurnSnapshot {
  const snapshotDatabase = cloneDatabase(db);
  snapshotDatabase.snapshots = [];

  const snapshot: TurnSnapshot = {
    id: makeId('snapshot'),
    turn: currentTurn(db),
    database: snapshotDatabase,
    createdAt: Date.now(),
  };

  return snapshot;
}

export function pushSnapshot(db: AppDatabase, limit = 3): AppDatabase {
  const snapshot = createSnapshot(db);
  const snapshots = [...db.snapshots, snapshot].slice(-limit);

  return {
    ...db,
    snapshots,
  };
}

export function restoreLastSnapshot(db: AppDatabase): AppDatabase | null {
  const snapshot = db.snapshots[db.snapshots.length - 1];

  if (!snapshot) {
    return null;
  }

  const restored = cloneDatabase(snapshot.database);
  restored.snapshots = db.snapshots.slice(0, -1);

  return restored;
}

export function appendStoryMessage(
  db: AppDatabase,
  role: 'user' | 'assistant',
  content: string,
  model: string | null,
  promptTokens: number,
  completionTokens: number
): AppDatabase {
  const message: RawLogEntry = {
    id: makeId('log'),
    turn: currentTurn(db),
    kind: 'story',
    role,
    content,
    model,
    promptTokens,
    completionTokens,
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: db.state.inStoryDate,
    createdAt: Date.now(),
  };

  return {
    ...db,
    rawLog: [...db.rawLog, message],
  };
}

export function getLastExchange(db: AppDatabase) {
  const story = db.rawLog.filter((message) => message.kind === 'story');
  const lastUser = [...story].reverse().find((message) => message.role === 'user');
  const lastAssistant = [...story].reverse().find((message) => message.role === 'assistant');

  return {
    userMessage: lastUser?.content ?? null,
    assistantMessage: lastAssistant?.content ?? null,
  };
}

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

  if (Array.isArray(diff.jutsuUsed)) {
    for (const jutsu of diff.jutsuUsed) {
      next = applyJutsuDiff(next, jutsu);
    }
  }

  if (Array.isArray(diff.bonds)) {
    for (const bond of diff.bonds) {
      next = applyBondDiff(next, bond);
    }
  }

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

  if (diff.scene?.ended) {
    next = recordSceneEvent(next, diff);
  }

  next.indices = buildIndices(next);

  return next;
}

type StateDiff = NonNullable<TurnDiff['state']>;
type EntityDiff = NonNullable<TurnDiff['entities']>[number];
type JutsuDiff = NonNullable<TurnDiff['jutsuUsed']>[number];
type BondDiff = NonNullable<TurnDiff['bonds']>[number];
type FactDiff = NonNullable<TurnDiff['facts']>[number];
type ThreadDiff = NonNullable<TurnDiff['threads']>[number];

function applyStateDiff(db: AppDatabase, state: StateDiff): AppDatabase {
  const next = { ...db, state: { ...db.state } };

  if (typeof state.mood === 'string' && state.mood.trim()) {
    next.state.mood = state.mood.trim();

    next.entities = next.entities.map((entity) =>
      entity.name.toLowerCase() === 'kan'
        ? { ...entity, mood: next.state.mood }
        : entity
    );
  }

  if (typeof state.worldDescription === 'string' && state.worldDescription.trim()) {
    next.state.worldDescription = state.worldDescription.trim();
  }

  if (Array.isArray(state.jutsuAdded)) {
    next.state.jutsu = uniqueList([
      ...next.state.jutsu,
      ...state.jutsuAdded.filter(Boolean),
    ]);
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
    ]);
  }

  if (Array.isArray(state.inventoryRemoved)) {
    next.state.inventory = next.state.inventory.filter(
      (item) => !state.inventoryRemoved?.includes(item)
    );
  }

  if (typeof state.location === 'string' && state.location.trim()) {
    next.state.location = state.location.trim();
  }

  if (state.inStoryDate) {
    next.state.inStoryDate = normalizeDate(
      state.inStoryDate,
      next.state.inStoryDate
    );
  }

  if (typeof state.canonPoint === 'string' && state.canonPoint.trim()) {
    next.state.canonPoint = state.canonPoint.trim();
  }

  if (typeof state.chapter === 'number' && Number.isFinite(state.chapter)) {
    next.state.chapter = Math.max(1, Math.round(state.chapter));
  }

  if (typeof state.scene === 'string' && state.scene.trim()) {
    next.state.scene = state.scene.trim();
  }

  return next;
}

function applyEntityDiff(db: AppDatabase, entity: EntityDiff): AppDatabase {
  if (!entity?.name || typeof entity.name !== 'string') {
    return db;
  }

  const name = entity.name.trim();

  if (!name) {
    return db;
  }

  const existingIndex = db.entities.findIndex(
    (item) =>
      item.name.toLowerCase() === name.toLowerCase() ||
      item.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase())
  );

  if (existingIndex === -1) {
    const newEntity = {
      id: makeId('entity'),
      name,
      type: 'character' as const,
      aliases: [],
      status: 'Newly met',
      notes: '',
      mood: entity.mood?.trim() || 'Unknown',
      appearance: entity.appearance?.trim() || 'Unknown',
      tags: [],
    };

    return {
      ...db,
      entities: [...db.entities, newEntity],
    };
  }

  const entities = [...db.entities];
  const existing = entities[existingIndex];

  const nextMood = entity.mood?.trim() || existing.mood;

  entities[existingIndex] = {
    ...existing,
    mood: nextMood,
    appearance: entity.appearance?.trim() || existing.appearance,
  };

  const nextState =
    existing.name.toLowerCase() === 'kan' && nextMood
      ? { ...db.state, mood: nextMood }
      : db.state;

  return {
    ...db,
    state: nextState,
    entities,
  };
}

function applyJutsuDiff(db: AppDatabase, jutsu: JutsuDiff): AppDatabase {
  if (!jutsu?.name || typeof jutsu.name !== 'string' || !jutsu.user) {
    return db;
  }

  const name = jutsu.name.trim();
  const user = jutsu.user.trim();

  if (!name || !user) {
    return db;
  }

  const existingIndex = db.jutsuRecords.findIndex(
    (item) =>
      item.name.toLowerCase() === name.toLowerCase() &&
      item.user.toLowerCase() === user.toLowerCase()
  );

  if (existingIndex === -1) {
    const record = {
      id: makeId('jutsu'),
      name,
      user,
      chakraNature: normalizeJutsuNature(jutsu.chakraNature),
      effect: jutsu.effect?.trim() || jutsu.description?.trim() || '',
      visual: jutsu.visual?.trim() || '',
      firstSeen: db.state.inStoryDate,
      lastSeen: db.state.inStoryDate,
      timesUsed: 1,
      description: jutsu.description?.trim() || '',
      tags: [],
    };

    return {
      ...db,
      jutsuRecords: [...db.jutsuRecords, record],
    };
  }

  const jutsuRecords = [...db.jutsuRecords];
  const existing = jutsuRecords[existingIndex];

  jutsuRecords[existingIndex] = {
    ...existing,
    chakraNature: normalizeJutsuNature(jutsu.chakraNature ?? existing.chakraNature),
    effect: jutsu.effect?.trim() || existing.effect,
    visual: jutsu.visual?.trim() || existing.visual,
    lastSeen: db.state.inStoryDate,
    timesUsed: existing.timesUsed + 1,
    description: jutsu.description?.trim() || existing.description,
  };

  return {
    ...db,
    jutsuRecords,
  };
}

function applyBondDiff(db: AppDatabase, bond: BondDiff): AppDatabase {
  if (!bond?.character || typeof bond.character !== 'string') {
    return db;
  }

  const characterName = bond.character.trim();

  if (!characterName) {
    return db;
  }

  const existingIndex = db.bonds.findIndex(
    (item) => item.characterName.toLowerCase() === characterName.toLowerCase()
  );

  if (existingIndex === -1) {
    const entity =
      db.entities.find(
        (item) =>
          item.name.toLowerCase() === characterName.toLowerCase() ||
          item.aliases.some(
            (alias) => alias.toLowerCase() === characterName.toLowerCase()
          )
      ) ?? null;

    let bondEntity = entity;

    if (!bondEntity) {
      bondEntity = {
        id: makeId('entity'),
        name: characterName,
        type: 'character' as const,
        aliases: [],
        status: 'Newly met',
        notes: '',
        mood: 'Unknown',
        appearance: 'Unknown',
        tags: [],
      };
    }

    const newBond = {
      id: makeId('bond'),
      entityId: bondEntity.id,
      characterName,
      affinity: clamp(
        typeof bond.affinityDelta === 'number' ? bond.affinityDelta : 0,
        -10,
        10
      ),
      status: bond.status?.trim() || 'Acquaintance',
      lastKeyEventId: null,
      note: bond.note?.trim() || '',
      isMajor: Boolean(bond.isMajor),
      updatedInStoryDate: db.state.inStoryDate,
    };

    const entities = bondEntity && !db.entities.some((item) => item.id === bondEntity.id)
      ? [...db.entities, bondEntity]
      : db.entities;

    return {
      ...db,
      entities,
      bonds: [...db.bonds, newBond],
    };
  }

  const bonds = [...db.bonds];
  const existing = bonds[existingIndex];

  bonds[existingIndex] = {
    ...existing,
    affinity: clamp(
      existing.affinity +
        (typeof bond.affinityDelta === 'number' ? bond.affinityDelta : 0),
      -10,
      10
    ),
    status: bond.status?.trim() || existing.status,
    note: bond.note?.trim() || existing.note,
    isMajor: typeof bond.isMajor === 'boolean' ? bond.isMajor : existing.isMajor,
    updatedInStoryDate: db.state.inStoryDate,
  };

  return {
    ...db,
    bonds,
  };
}

function applyFactDiff(db: AppDatabase, fact: FactDiff): AppDatabase {
  if (!fact?.text || typeof fact.text !== 'string') {
    return db;
  }

  const text = fact.text.trim();

  if (!text) {
    return db;
  }

  const currentDate = fact.validFrom
    ? normalizeDate(fact.validFrom, db.state.inStoryDate)
    : db.state.inStoryDate;

  if (fact.action === 'end') {
    const facts = db.facts.map((item) => {
      if (
        item.validTo === null &&
        (item.text.toLowerCase() === text.toLowerCase() ||
          item.text.toLowerCase().includes(text.toLowerCase()))
      ) {
        return {
          ...item,
          validTo: currentDate,
        };
      }

      return item;
    });

    return {
      ...db,
      facts,
    };
  }

  const subjectEntity = fact.subject
    ? db.entities.find(
        (entity) =>
          entity.name.toLowerCase() === fact.subject?.toLowerCase() ||
          entity.aliases.some(
            (alias) => alias.toLowerCase() === fact.subject?.toLowerCase()
          )
      ) ?? null
    : null;

  const newFact = {
    id: makeId('fact'),
    subjectEntityId: subjectEntity?.id ?? null,
    type: fact.type ?? 'other',
    text,
    whoKnows: Array.isArray(fact.whoKnows) ? fact.whoKnows.filter(Boolean) : [],
    validFrom: currentDate,
    validTo: null,
    confidence: 'confirmed' as const,
    sourceEventId: null,
  };

  return {
    ...db,
    facts: [...db.facts, newFact],
  };
}

function applyThreadDiff(db: AppDatabase, thread: ThreadDiff): AppDatabase {
  if (!thread?.title || typeof thread.title !== 'string') {
    return db;
  }

  const title = thread.title.trim();

  if (!title) {
    return db;
  }

  const existingIndex = db.threads.findIndex(
    (item) => item.title.toLowerCase() === title.toLowerCase()
  );

  if (thread.action === 'resolve') {
    if (existingIndex === -1) {
      return db;
    }

    const threads = [...db.threads];
    threads[existingIndex] = {
      ...threads[existingIndex],
      status: 'resolved',
      resolvedAt: db.state.inStoryDate,
      description: thread.description?.trim() || threads[existingIndex].description,
    };

    return {
      ...db,
      threads,
    };
  }

  if (existingIndex === -1) {
    const newThread = {
      id: makeId('thread'),
      type: thread.type ?? 'other',
      title,
      description: thread.description?.trim() || '',
      status: 'open' as const,
      openedAt: db.state.inStoryDate,
      resolvedAt: null,
      importance: 3 as 1 | 2 | 3 | 4 | 5,
      participants: Array.isArray(thread.participants)
        ? thread.participants.filter(Boolean)
        : [],
      sourceEventId: null,
    };

    return {
      ...db,
      threads: [...db.threads, newThread],
    };
  }

  const threads = [...db.threads];
  threads[existingIndex] = {
    ...threads[existingIndex],
    description: thread.description?.trim() || threads[existingIndex].description,
    type: thread.type ?? threads[existingIndex].type,
    participants: Array.isArray(thread.participants)
      ? uniqueList([...threads[existingIndex].participants, ...thread.participants])
      : threads[existingIndex].participants,
  };

  return {
    ...db,
    threads,
  };
}

function recordSceneEvent(db: AppDatabase, diff: TurnDiff): AppDatabase {
  const scene = diff.scene;
  const summary =
    scene?.summary?.trim() ||
    db.rawLog
      .filter((message) => message.kind === 'story')
      .slice(-2)
      .map((message) => message.content)
      .join(' ')
      .slice(0, 240);

  if (!summary) {
    return db;
  }

  const event: EventRecord = {
    id: makeId('event'),
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: db.state.inStoryDate,
    summary,
    importance: scene?.importance ?? 3,
    tags: Array.isArray(scene?.tags) ? scene.tags.filter(Boolean).slice(0, 12) : [],
    pinned: false,
    sourceLogId: null,
    createdAt: Date.now(),
  };

  const eventEntities = (scene?.entities ?? [])
    .map((name) =>
      db.entities.find(
        (entity) =>
          entity.name.toLowerCase() === name.toLowerCase() ||
          entity.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase())
      )
    )
    .filter((entity): entity is NonNullable<typeof entity> => Boolean(entity))
    .map((entity) => ({
      eventId: event.id,
      entityId: entity.id,
      role: 'present' as const,
    }));

  return {
    ...db,
    events: [...db.events, event],
    eventEntities: [...db.eventEntities, ...eventEntities],
  };
}

export async function extractTurnDiff(options: {
  apiKey: string;
  db: AppDatabase;
  userMessage: string;
  assistantMessage: string;
}): Promise<TurnDiff | null> {
  const { apiKey, db, userMessage, assistantMessage } = options;
  const prompt = buildExtractionPrompt(db, userMessage, assistantMessage);

  const result = await completeChat({
    apiKey,
    model: db.settings.extractionModel,
    messages: prompt.messages,
    temperature: 0,
    maxTokens: 700,
    responseFormatJson: true,
  });

  const parsed = parseJsonObject(result.text);

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  return parsed as TurnDiff;
}

export async function summarizeScene(options: {
  apiKey: string;
  db: AppDatabase;
  messages: RawLogEntry[];
}): Promise<string | null> {
  const { apiKey, db, messages } = options;

  if (messages.length === 0) {
    return null;
  }

  const prompt = buildSceneSummaryPrompt(db, messages);

  const result = await completeChat({
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 350,
  });

  const text = result.text.trim();

  return text || null;
}

export async function summarizeTimeSkip(options: {
  apiKey: string;
  db: AppDatabase;
  fromDate: CalendarDate;
  toDate: CalendarDate;
}): Promise<string | null> {
  const { apiKey, db, fromDate, toDate } = options;

  if (Math.abs(daysBetween(fromDate, toDate)) < 180) {
    return null;
  }

  const prompt = buildTimeSkipPrompt(
    db,
    formatDate(fromDate),
    formatDate(toDate)
  );

  const result = await completeChat({
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 350,
  });

  return result.text.trim() || null;
}

export async function rollArcSummary(options: {
  apiKey: string;
  db: AppDatabase;
  chapterSummaries: string[];
}): Promise<string | null> {
  const { apiKey, db, chapterSummaries } = options;

  if (chapterSummaries.length < 3) {
    return null;
  }

  const prompt = buildArcSummaryPrompt(db, chapterSummaries);

  const result = await completeChat({
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 400,
  });

  return result.text.trim() || null;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  if (!trimmed || trimmed === '{}') {
    return {};
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const candidates = [withoutFence];

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function uniqueList(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
