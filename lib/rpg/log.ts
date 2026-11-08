// Story log and undo snapshots.

import { makeId } from './id';
import type { AppDatabase, RawLogEntry, TurnSnapshot } from './types';

export function cloneDatabase(db: AppDatabase): AppDatabase {
  return JSON.parse(JSON.stringify(db)) as AppDatabase;
}

export function currentTurn(db: AppDatabase) {
  return db.rawLog.filter((message) => message.kind === 'story').length + 1;
}

/** Undo keeps this many turns. Snapshots hold no images, so they stay small. */
export const SNAPSHOT_LIMIT = 5;

const isInline = (value: string | null | undefined) => typeof value === 'string' && value.startsWith('data:');

/**
 * A lightweight copy of the state before a turn: everything but images.
 * Image references (img:…) are kept; inline images and the portrait and
 * face collections are left out, and come back from the live save on undo.
 */
export function createSnapshot(db: AppDatabase): TurnSnapshot {
  const { snapshots: _snapshots, portraits: _portraits, characterPortraits: _cp, characterFaces: _cf, ...rest } = db;
  const snapshotDatabase = cloneDatabase({
    ...rest,
    snapshots: [],
    rawLog: db.rawLog.map((entry) => (isInline(entry.image) ? { ...entry, image: null } : entry)),
  } as AppDatabase);

  const snapshot: TurnSnapshot = {
    id: makeId('snapshot'),
    turn: currentTurn(db),
    database: snapshotDatabase,
    createdAt: Date.now(),
  };

  return snapshot;
}

export function pushSnapshot(db: AppDatabase, limit = SNAPSHOT_LIMIT): AppDatabase {
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
  // Images are not in snapshots: they come from the live save.
  const liveImages = new Map(db.rawLog.filter((entry) => entry.image).map((entry) => [entry.id, entry.image]));
  restored.rawLog = restored.rawLog.map((entry) =>
    !entry.image && liveImages.has(entry.id) ? { ...entry, image: liveImages.get(entry.id) } : entry
  );
  restored.portraits = db.portraits;
  restored.characterPortraits = db.characterPortraits;
  restored.characterFaces = db.characterFaces;

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

export function storyMessagesSinceLastSummary(db: AppDatabase): number {
  const lastChapterSummaryAt = [...db.summaries]
    .filter((summary) => summary.level === 'chapter')
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.createdAt ?? 0;

  // Flashback turns are written up on their own (see flashbacks.ts).
  return db.rawLog.filter(
    (message) => message.kind === 'story' && !message.flashback && message.createdAt > lastChapterSummaryAt
  ).length;
}
