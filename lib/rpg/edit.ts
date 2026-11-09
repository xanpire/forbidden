// Editing the story: your last message (the turn runs again), the narrator's
// last reply by hand (the tracker reads it again), and rewinding to before
// any player message still within the snapshots (log.ts). Everything that
// turn changed (memory, bonds, the clock, the phone) is rolled back first.

import { appendStoryMessage, pushSnapshot, restoreSnapshot, snapshotBefore } from './log';
import { carryOverMemory, type TurnInfo } from './memoryJobs';
import { applySkip } from './skip';
import type { AppDatabase, RawLogEntry } from './types';

function lastStory(db: AppDatabase, role: 'user' | 'assistant'): RawLogEntry | null {
  return [...db.rawLog].reverse().find((entry) => entry.kind === 'story' && entry.role === role) ?? null;
}

/** The save as it was before a player message, with everything since rolled back. Null when it is out of reach. */
export function rewindTo(current: AppDatabase, userEntryId: string): AppDatabase | null {
  const snapshot = snapshotBefore(current, userEntryId);
  const restored = snapshot ? restoreSnapshot(current, snapshot.id) : null;

  return restored ? carryOverMemory(current, restored) : null;
}

/** Player messages that can be rewound to (their snapshot is still kept). */
export function rewindableIds(db: AppDatabase): Set<string> {
  return new Set(
    db.rawLog.filter((entry) => entry.kind === 'story' && entry.role === 'user' && snapshotBefore(db, entry.id)).map((entry) => entry.id)
  );
}

/**
 * The latest reply rewritten by hand: back to before the turn, then the same
 * player message (a skip skips again) and the edited reply, ready for the
 * state step to read. The reply keeps its picture and the mode it was
 * written in. Null when there is no latest turn to edit.
 */
export function rebuildWithEditedReply(current: AppDatabase, text: string): { db: AppDatabase; turn: TurnInfo } | null {
  const reply = lastStory(current, 'assistant');
  const player = lastStory(current, 'user');
  const narration = text.trim();

  if (!reply || !player || !narration || current.rawLog.indexOf(player) > current.rawLog.indexOf(reply)) return null;

  const before = rewindTo(current, player.id);

  if (!before) return null;

  let next = pushSnapshot(before);
  const skip = player.skipTo ? { to: player.skipTo } : undefined;

  if (skip) next = applySkip(next, skip.to)?.db ?? next;

  next = appendStoryMessage(next, 'user', player.content, null, 0, 0);
  next = {
    ...next,
    rawLog: next.rawLog.map((entry, index) =>
      index === next.rawLog.length - 1 ? { ...entry, ...(player.skipTo ? { skipTo: player.skipTo } : {}), ...(player.meanwhile ? { meanwhile: player.meanwhile } : {}) } : entry
    ),
  };
  next = appendStoryMessage(next, 'assistant', narration, reply.model, reply.promptTokens, reply.completionTokens);

  const last = next.rawLog[next.rawLog.length - 1];
  next.rawLog[next.rawLog.length - 1] = {
    ...last,
    ...(reply.sceneMode ? { sceneMode: reply.sceneMode } : {}),
    ...(reply.image ? { image: reply.image } : {}),
    ...(reply.imageMeta ? { imageMeta: reply.imageMeta } : {}),
    edited: true,
  };

  return {
    db: next,
    turn: { turnLogId: last.id, userMessage: player.content, narration, ...(skip ? { options: { skip } } : {}) },
  };
}

/** The latest player message, for editing it (the turn then runs again). */
export function lastPlayerMessage(db: AppDatabase): RawLogEntry | null {
  const player = lastStory(db, 'user');
  const reply = lastStory(db, 'assistant');

  return player && (!reply || db.rawLog.indexOf(player) < db.rawLog.indexOf(reply)) ? player : null;
}
