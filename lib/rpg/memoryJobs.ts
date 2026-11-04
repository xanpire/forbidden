/**
 * Background memory pipeline.
 *
 * A turn is two model calls, then background summaries:
 *  1. The narrator streams prose only (no JSON). The prose is saved as soon as
 *     it finishes.
 *  2. The state step: a cheap model reads that prose and returns the state
 *     change (clock, bonds, facts, canon) as structured JSON, which is applied
 *     and saved straight away. It never waits on a summary.
 *  3. Summaries (time skip, scene, arc, year) run afterwards as separate jobs.
 *     Each job reads the latest copy of the save, calls the model, and then
 *     applies its result to whatever the save looks like *now* — never to the
 *     copy it started from — so edits, undo and new turns made in the
 *     meantime are kept.
 *
 * Jobs are stored in the save (`db.memoryJobs`). A job that fails stays there
 * as "pending" until it is retried, and is dropped once the turn it belongs
 * to no longer exists (undo, regenerate).
 */
import { advanceCanon, applyCanonMarks, markNewsHeard } from './canon';
import { daysBetween, secondsBetween, shiftSeconds } from './calendar';
import { mentionsEntity } from './characterRefs';
import { buildIndices } from './db';
import { makeId } from './id';
import { inferScenePace, resolveTurnClock } from './pacing';
import {
  applyTurnDiff,
  extractTurnDiff,
  rollArcSummary,
  storyMessagesSinceLastSummary,
  summarizeScene,
  summarizeTimeSkip,
} from './services';
import { detectNarrationTime } from './timeparse';
import type {
  AppDatabase,
  CalendarDate,
  EventRecord,
  MemoryJob,
  MemoryJobKind,
  RawLogEntry,
  SummaryRecord,
  TurnDiff,
} from './types';

const TIME_SKIP_DAYS = 180;
const SCENE_MESSAGES = 8;
const MERGED_SCENE_MESSAGES = 12;
const ARC_SIZE = 3;
const YEAR_SIZE = 12;
const SUMMARY_TAG = 'summary';

// ---------------------------------------------------------------------------
// Lookups

function jobsOf(db: AppDatabase): MemoryJob[] {
  return db.memoryJobs ?? [];
}

function storyLog(db: AppDatabase): RawLogEntry[] {
  return db.rawLog.filter((entry) => entry.kind === 'story');
}

function hasLog(db: AppDatabase, logId: string) {
  return db.rawLog.some((entry) => entry.id === logId);
}

function lastAssistantId(db: AppDatabase) {
  const story = storyLog(db);

  for (let index = story.length - 1; index >= 0; index -= 1) {
    if (story[index].role === 'assistant') {
      return story[index].id;
    }
  }

  return null;
}

function chapterSummaries(db: AppDatabase) {
  return db.summaries.filter((summary) => summary.level === 'chapter');
}

function sameIds(a: string[] | undefined, b: string[] | undefined) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  return a.every((id, index) => id === b[index]);
}

function errorText(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught ?? '');
  return (message || 'Unknown error').slice(0, 160);
}

function newJob(kind: MemoryJobKind, turnLogId: string, extra: Partial<MemoryJob>): MemoryJob {
  return {
    id: makeId('memjob'),
    kind,
    status: 'queued',
    turnLogId,
    attempts: 0,
    createdAt: Date.now(),
    ...extra,
  };
}

/** Whether a job still makes sense for this copy of the save. */
export function isJobValid(db: AppDatabase, job: MemoryJob): boolean {
  switch (job.kind) {
    case 'state':
      // A state step only belongs to the newest turn: once another turn has
      // been narrated, applying an older turn's clock and bonds would be wrong.
      return lastAssistantId(db) === job.turnLogId;
    case 'timeSkip':
      return hasLog(db, job.turnLogId) && Boolean(job.fromDate && job.toDate);
    case 'scene':
      return (job.logIds ?? []).filter((id) => hasLog(db, id)).length >= 2;
    case 'arc':
    case 'year': {
      const ids = job.summaryIds ?? [];
      const needed = job.kind === 'arc' ? ARC_SIZE : YEAR_SIZE;
      return ids.length >= needed && ids.every((id) => db.summaries.some((s) => s.id === id));
    }
    default:
      return false;
  }
}

/** Jobs waiting for a retry: everything valid that isn't running right now. */
export function pendingMemoryJobs(db: AppDatabase | null, activeIds: ReadonlySet<string>) {
  if (!db) {
    return [];
  }

  return jobsOf(db).filter((job) => !activeIds.has(job.id) && isJobValid(db, job));
}

function withJobs(db: AppDatabase, jobs: MemoryJob[]): AppDatabase {
  return { ...db, memoryJobs: jobs };
}

export function removeJob(db: AppDatabase, jobId: string): AppDatabase {
  return withJobs(
    db,
    jobsOf(db).filter((job) => job.id !== jobId)
  );
}

export function markJobFailed(db: AppDatabase, jobId: string, caught: unknown): AppDatabase {
  return withJobs(
    db,
    jobsOf(db).map((job) =>
      job.id === jobId
        ? { ...job, status: 'failed', attempts: job.attempts + 1, error: errorText(caught) }
        : job
    )
  );
}

export function markJobsQueued(db: AppDatabase, jobIds: string[]): AppDatabase {
  const ids = new Set(jobIds);
  return withJobs(
    db,
    jobsOf(db).map((job) => (ids.has(job.id) ? { ...job, status: 'queued', error: undefined } : job))
  );
}

/** Drops jobs whose turn no longer exists. */
export function pruneJobs(db: AppDatabase, keepIds: ReadonlySet<string> = new Set()): AppDatabase {
  const jobs = jobsOf(db);
  const kept = jobs.filter((job) => keepIds.has(job.id) || isJobValid(db, job));
  return kept.length === jobs.length ? db : withJobs(db, kept);
}

// ---------------------------------------------------------------------------
// Phase 1: the state step

export type TurnInfo = {
  turnLogId: string;
  userMessage: string;
  narration: string;
};

export type StateStepResult = {
  db: AppDatabase;
  /** Follow-up summary jobs that were queued by this step. */
  followUpIds: string[];
  /** Short "world news" line to show, if a canon event was relayed. */
  notice: string | null;
  /** The diff that was applied, after the app settled the clock. */
  appliedDiff: TurnDiff | null;
};

/**
 * Applies a turn's state change to `latest` and queues the summaries it
 * calls for. Pure: the caller saves the result.
 */
export function applyStateStep(
  latest: AppDatabase,
  extraction: TurnDiff | null,
  turn: TurnInfo,
  activeIds: ReadonlySet<string>
): StateStepResult {
  const beforeDate = latest.state.inStoryDate;
  const parsedTime = detectNarrationTime(turn.narration, beforeDate);
  const reportedSeconds = extraction?.state?.elapsedSeconds ?? 0;
  const pace = extraction?.state?.scenePace ?? inferScenePace(turn.narration);
  const sceneEnded = extraction?.scene?.ended ?? false;
  const clock = resolveTurnClock({
    reportedSeconds,
    reportedClock: extraction?.state?.clockTime,
    detected: parsedTime,
    pace,
    sceneEnded,
    current: beforeDate,
  });

  // The clock always moves: resolveTurnClock folds the reported time, the
  // parsed time and the pace minimum into one forward step.
  const merged = { ...(extraction ?? {}) };
  merged.state = {
    ...(merged.state ?? {}),
    elapsedSeconds: clock.elapsedSeconds,
    scenePace: merged.state?.scenePace ?? pace,
    clockTime: undefined,
    inStoryDate: undefined,
  };
  const effectiveDiff: TurnDiff = merged;

  let next = applyTurnDiff(latest, effectiveDiff);
  const appliedSeconds = Math.max(0, secondsBetween(beforeDate, next.state.inStoryDate));
  const stalled = latest.state.turnsWithoutTimeChange ?? 0;

  next = {
    ...next,
    // The chip under the reply shows this, and tapping it corrects it.
    rawLog: next.rawLog.map((entry) =>
      entry.id === turn.turnLogId ? { ...entry, elapsedSeconds: appliedSeconds } : entry
    ),
    state: {
      ...next.state,
      // Counts turns where only the pace minimum moved the clock.
      turnsWithoutTimeChange: clock.storyTimed ? 0 : Math.min(stalled + 1, 9),
    },
  };
  const relays = extraction?.newsRelayed ?? [];

  next = applyCanonMarks(
    next,
    extraction?.canonCompleted ?? [],
    extraction?.canonEngaged ?? [],
    extraction?.canonPassed ?? []
  );
  next = markNewsHeard(next, relays);
  next = advanceCanon(next);

  let notice: string | null = null;

  if (relays.length > 0) {
    const id = relays[0].id.startsWith('event_canon_')
      ? relays[0].id
      : `event_canon_${relays[0].id}`;
    const delivered = next.events.find((event) => event.id === id);

    if (delivered) {
      const title = delivered.summary.split(':')[0].trim();
      const from = relays[0].from?.trim() || 'a rumor';
      notice = `${title} — from ${from}`.slice(0, 110);
    }
  }

  // The state step is done; any earlier state job for this turn is settled.
  next = withJobs(
    next,
    jobsOf(next).filter((job) => !(job.kind === 'state' && job.turnLogId === turn.turnLogId))
  );

  const followUpIds: string[] = [];

  if (Math.abs(daysBetween(beforeDate, next.state.inStoryDate)) >= TIME_SKIP_DAYS) {
    const job = newJob('timeSkip', turn.turnLogId, {
      fromDate: beforeDate,
      toDate: next.state.inStoryDate,
    });
    next = withJobs(next, [...jobsOf(next), job]);
    followUpIds.push(job.id);
  }

  const shouldSummarize =
    extraction?.imageWorthy === true ||
    sceneEnded ||
    storyMessagesSinceLastSummary(next) >= next.settings.autoSummarizeThreshold;

  if (shouldSummarize) {
    const planned = queueSceneJob(next, turn.turnLogId, activeIds);
    next = planned.db;

    if (planned.jobId) {
      followUpIds.push(planned.jobId);
    }
  }

  return { db: next, followUpIds, notice, appliedDiff: effectiveDiff };
}

/**
 * Sets how much time a past reply took (the "+2 min" chip). The clock, and
 * every later entry's timestamp, shifts by the difference. Pure.
 */
export function correctTurnTime(db: AppDatabase, logId: string, seconds: number): AppDatabase | null {
  const index = db.rawLog.findIndex((entry) => entry.id === logId);
  const entry = db.rawLog[index];

  if (!entry || entry.role !== 'assistant') {
    return null;
  }

  const target = Math.max(0, Math.min(30 * 86400, Math.round(seconds)));
  const delta = target - (entry.elapsedSeconds ?? 0);

  if (delta === 0) {
    return null;
  }

  const nextDate = shiftSeconds(db.state.inStoryDate, delta);
  let next = applyTurnDiff(db, { state: { inStoryDate: nextDate } });

  next = {
    ...next,
    rawLog: next.rawLog.map((item, position) =>
      position === index
        ? { ...item, elapsedSeconds: target, timeCorrected: true }
        : position > index
          ? { ...item, inStoryDate: shiftSeconds(item.inStoryDate, delta) }
          : item
    ),
  };

  return delta > 0 ? advanceCanon(next) : next;
}

/**
 * Queues a scene summary for the latest story messages. If an earlier scene
 * summary is still pending (and not running), it is widened to cover the new
 * messages instead of stacking a second job each turn.
 */
function queueSceneJob(
  db: AppDatabase,
  turnLogId: string,
  activeIds: ReadonlySet<string>
): { db: AppDatabase; jobId: string | null } {
  const story = storyLog(db);
  const recentIds = story.slice(-SCENE_MESSAGES).map((entry) => entry.id);

  if (recentIds.length === 0) {
    return { db, jobId: null };
  }

  const existing = jobsOf(db).find((job) => job.kind === 'scene' && !activeIds.has(job.id));

  if (existing) {
    const wanted = new Set([...(existing.logIds ?? []), ...recentIds]);
    const logIds = story
      .filter((entry) => wanted.has(entry.id))
      .slice(-MERGED_SCENE_MESSAGES)
      .map((entry) => entry.id);

    return {
      db: withJobs(
        db,
        jobsOf(db).map((job) =>
          job.id === existing.id
            ? { ...job, logIds, turnLogId, status: 'queued', error: undefined }
            : job
        )
      ),
      jobId: existing.id,
    };
  }

  const job = newJob('scene', turnLogId, { logIds: recentIds });
  return { db: withJobs(db, [...jobsOf(db), job]), jobId: job.id };
}

/** Queues arc / year roll-ups once enough chapter summaries exist. */
function queueRollups(db: AppDatabase, turnLogId: string): { db: AppDatabase; jobIds: string[] } {
  const chapters = chapterSummaries(db);
  const count = chapters.length;
  const jobIds: string[] = [];
  let next = db;

  const plan = (kind: 'arc' | 'year', size: number) => {
    const summaryIds = chapters.slice(-size).map((summary) => summary.id);
    const alreadyDone = next.summaries.some(
      (summary) => summary.level === kind && sameIds(summary.sourceSummaryIds, summaryIds)
    );
    const alreadyQueued = jobsOf(next).some(
      (job) => job.kind === kind && sameIds(job.summaryIds, summaryIds)
    );

    if (alreadyDone || alreadyQueued) {
      return;
    }

    const job = newJob(kind, turnLogId, { summaryIds });
    next = withJobs(next, [...jobsOf(next), job]);
    jobIds.push(job.id);
  };

  if (count > 0 && count % ARC_SIZE === 0) {
    plan('arc', ARC_SIZE);
  }

  if (count >= YEAR_SIZE && count % YEAR_SIZE === 0) {
    plan('year', YEAR_SIZE);
  }

  return { db: next, jobIds };
}

/** Records a state step that couldn't run (the extraction call failed) so it can be retried. */
export function queueStateRetry(
  db: AppDatabase,
  turn: Pick<TurnInfo, 'turnLogId' | 'userMessage'>,
  caught: unknown
): AppDatabase {
  const others = jobsOf(db).filter(
    (job) => !(job.kind === 'state' && job.turnLogId === turn.turnLogId)
  );
  const job: MemoryJob = {
    ...newJob('state', turn.turnLogId, { userMessage: turn.userMessage }),
    status: 'failed',
    attempts: 1,
    error: errorText(caught),
  };

  return withJobs(db, [...others, job]);
}

/** Re-runs the state call for a turn whose first attempt failed. */
export async function extractStateForJob(apiKey: string, db: AppDatabase, job: MemoryJob) {
  const narration = db.rawLog.find((entry) => entry.id === job.turnLogId)?.content ?? '';

  return extractTurnDiff({
    apiKey,
    db,
    userMessage: job.userMessage ?? '',
    assistantMessage: narration,
    debugTurnId: job.turnLogId,
  });
}

// ---------------------------------------------------------------------------
// Phase 2: summary jobs

export type SummaryJobOutput = {
  text: string;
  /** Inputs actually used, so the result can be checked against the latest save. */
  logIds?: string[];
};

/** Calls the model for one summary job, using `base` only as context. Throws on failure. */
export async function runSummaryJob(
  apiKey: string,
  base: AppDatabase,
  job: MemoryJob
): Promise<SummaryJobOutput> {
  let text: string | null = null;
  let logIds: string[] | undefined;

  switch (job.kind) {
    case 'timeSkip':
      text = await summarizeTimeSkip({
        apiKey,
        db: base,
        fromDate: job.fromDate as CalendarDate,
        toDate: job.toDate as CalendarDate,
        debugTurnId: job.turnLogId,
      });
      break;
    case 'scene': {
      const wanted = new Set(job.logIds ?? []);
      const messages = base.rawLog.filter((entry) => wanted.has(entry.id));
      logIds = messages.map((entry) => entry.id);
      text = await summarizeScene({ apiKey, db: base, messages, debugTurnId: job.turnLogId });
      break;
    }
    case 'arc':
    case 'year': {
      const wanted = job.summaryIds ?? [];
      const texts = wanted
        .map((id) => base.summaries.find((summary) => summary.id === id)?.text)
        .filter((value): value is string => Boolean(value));
      text = await rollArcSummary({
        apiKey,
        db: base,
        chapterSummaries: texts,
        debugTurnId: job.turnLogId,
        debugKind: job.kind,
      });
      break;
    }
    default:
      throw new Error(`Unknown memory step: ${job.kind}`);
  }

  if (!text) {
    throw new Error('The summary came back empty.');
  }

  return { text, logIds };
}

/**
 * Applies a finished summary to the latest save. Returns null when the job no
 * longer applies (turn undone, job removed), so nothing is written.
 */
export function applySummaryJob(
  latest: AppDatabase,
  job: MemoryJob,
  output: SummaryJobOutput
): { db: AppDatabase; followUpIds: string[] } | null {
  const current = jobsOf(latest).find((entry) => entry.id === job.id);

  if (!current || !isJobValid(latest, current)) {
    return null;
  }

  let next = latest;
  let followUpIds: string[] = [];

  switch (job.kind) {
    case 'timeSkip': {
      const duplicate = next.events.some(
        (event) => event.sourceLogId === job.turnLogId && event.tags.includes('time-skip')
      );

      if (!duplicate) {
        const event: EventRecord = {
          id: makeId('event'),
          chapter: next.state.chapter,
          scene: 'Time skip',
          inStoryDate: job.toDate ?? next.state.inStoryDate,
          summary: output.text,
          importance: 4,
          tags: ['time-skip', 'meanwhile'],
          pinned: false,
          sourceLogId: job.turnLogId,
          createdAt: Date.now(),
        };
        next = { ...next, events: [...next.events, event] };
      }
      break;
    }
    case 'scene': {
      const used = new Set(output.logIds ?? []);
      const messages = next.rawLog.filter((entry) => used.has(entry.id));

      // The covered messages were undone while the summary was being written.
      if (messages.length < 2) {
        return { db: removeJob(next, job.id), followUpIds: [] };
      }

      const first = messages[0];
      const last = messages[messages.length - 1];
      const lastEvent = next.events[next.events.length - 1];
      const record: SummaryRecord = {
        id: makeId('summary'),
        level: 'chapter',
        range: {
          fromEventId: lastEvent?.id ?? '',
          toEventId: lastEvent?.id ?? '',
          from: first.inStoryDate,
          to: last.inStoryDate,
        },
        text: output.text,
        tokenCount: Math.ceil(output.text.length / 4),
        eventIds: lastEvent ? [lastEvent.id] : [],
        // Stamped just after the last covered message, so a summary that
        // lands late (after a retry) doesn't hide newer, unsummarized turns.
        createdAt: last.createdAt + 1,
        sourceLogIds: messages.map((entry) => entry.id),
      };
      next = { ...next, summaries: [...next.summaries, record] };
      next = saveSummaryMemory(next, record, messages);

      // If the job was widened while this one was running, keep the newer
      // messages queued instead of marking them as summarized.
      const remaining = (current.logIds ?? []).filter((id) => !used.has(id) && hasLog(next, id));

      if (remaining.length >= 2) {
        next = withJobs(
          next,
          jobsOf(next).map((entry) =>
            entry.id === job.id ? { ...entry, logIds: remaining, status: 'queued' } : entry
          )
        );
        followUpIds.push(job.id);
      } else {
        next = removeJob(next, job.id);
      }

      const rollups = queueRollups(next, job.turnLogId);
      next = rollups.db;
      followUpIds = [...followUpIds, ...rollups.jobIds];
      return { db: next, followUpIds };
    }
    case 'arc':
    case 'year': {
      const summaryIds = job.summaryIds ?? [];
      const duplicate = next.summaries.some(
        (summary) => summary.level === job.kind && sameIds(summary.sourceSummaryIds, summaryIds)
      );

      if (!duplicate) {
        const sources = next.summaries.filter((summary) => summaryIds.includes(summary.id));
        const from = sources[0]?.range.from ?? next.state.inStoryDate;
        const to = sources[sources.length - 1]?.range.to ?? next.state.inStoryDate;
        const record: SummaryRecord = {
          id: makeId('summary'),
          level: job.kind,
          range: { fromEventId: '', toEventId: '', from, to },
          text: output.text,
          tokenCount: Math.ceil(output.text.length / 4),
          eventIds: [],
          createdAt: Date.now(),
          sourceSummaryIds: summaryIds,
        };
        next = { ...next, summaries: [...next.summaries, record] };
      }
      break;
    }
    default:
      return null;
  }

  return { db: removeJob(next, job.id), followUpIds };
}

/**
 * Every chapter summary is also saved as a memory, so it can be recalled
 * later by who and what it mentions. The short "scene ended" memories made
 * during the same stretch of story are folded into it.
 */
function saveSummaryMemory(
  db: AppDatabase,
  summary: SummaryRecord,
  messages: RawLogEntry[]
): AppDatabase {
  const first = messages[0];
  const last = messages[messages.length - 1];

  if (db.events.some((event) => event.tags.includes(SUMMARY_TAG) && event.sourceLogId === last.id)) {
    return db;
  }

  const superseded = db.events.filter(
    (event) =>
      event.sourceLogId === null &&
      !event.pinned &&
      !event.tags.includes('time-skip') &&
      event.createdAt >= first.createdAt &&
      event.createdAt <= last.createdAt + 60_000
  );
  const supersededIds = new Set(superseded.map((event) => event.id));
  const mentioned = db.entities.filter(
    (entity) => entity.name.toLowerCase() !== 'kan' && mentionsEntity(summary.text, entity)
  );

  const event: EventRecord = {
    id: makeId('event'),
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: last.inStoryDate,
    summary: summary.text,
    importance: Math.max(3, ...superseded.map((entry) => entry.importance)) as EventRecord['importance'],
    tags: [
      SUMMARY_TAG,
      ...new Set([
        ...superseded.flatMap((entry) => entry.tags),
        ...mentioned.map((entity) => entity.name.split(/\s+/)[0].toLowerCase()),
      ]),
    ].slice(0, 10),
    pinned: false,
    sourceLogId: last.id,
    createdAt: summary.createdAt,
  };

  const links = [
    ...db.eventEntities
      .filter((link) => supersededIds.has(link.eventId))
      .map((link) => ({ ...link, eventId: event.id })),
    ...mentioned.map((entity) => ({ eventId: event.id, entityId: entity.id, role: 'mentioned' as const })),
  ].filter(
    (link, index, all) => all.findIndex((other) => other.entityId === link.entityId) === index
  );

  const next: AppDatabase = {
    ...db,
    events: [...db.events.filter((entry) => !supersededIds.has(entry.id)), event],
    eventEntities: [
      ...db.eventEntities.filter((link) => !supersededIds.has(link.eventId)),
      ...links,
    ],
  };

  return { ...next, indices: buildIndices(next) };
}

// ---------------------------------------------------------------------------
// Undo / regenerate

/**
 * Undo restores a snapshot taken before the turn. Summaries that finished
 * after that snapshot are carried over when everything they were written
 * from still exists, and so are pending jobs that still apply.
 */
export function carryOverMemory(current: AppDatabase, restored: AppDatabase): AppDatabase {
  const restoredLogIds = new Set(restored.rawLog.map((entry) => entry.id));
  const restoredSummaryIds = new Set(restored.summaries.map((summary) => summary.id));
  const restoredEventIds = new Set(restored.events.map((event) => event.id));

  const extraSummaries: SummaryRecord[] = [];

  for (const summary of current.summaries) {
    if (restoredSummaryIds.has(summary.id)) {
      continue;
    }

    const logsOk = (summary.sourceLogIds ?? []).every((id) => restoredLogIds.has(id));
    const sourcesOk = (summary.sourceSummaryIds ?? []).every(
      (id) => restoredSummaryIds.has(id) || extraSummaries.some((extra) => extra.id === id)
    );
    const traceable = Boolean(summary.sourceLogIds?.length || summary.sourceSummaryIds?.length);

    if (traceable && logsOk && sourcesOk) {
      extraSummaries.push(summary);
    }
  }

  const extraEvents = current.events.filter(
    (event) =>
      !restoredEventIds.has(event.id) &&
      (event.tags.includes('time-skip') || event.tags.includes(SUMMARY_TAG)) &&
      event.sourceLogId !== null &&
      restoredLogIds.has(event.sourceLogId)
  );
  const extraEventIds = new Set(extraEvents.map((event) => event.id));

  const merged: AppDatabase = {
    ...restored,
    summaries: [...restored.summaries, ...extraSummaries],
    events: [...restored.events, ...extraEvents],
    eventEntities: [
      ...restored.eventEntities,
      ...current.eventEntities.filter((link) => extraEventIds.has(link.eventId)),
    ],
    memoryJobs: jobsOf(current),
  };

  return pruneJobs(extraEvents.length > 0 ? { ...merged, indices: buildIndices(merged) } : merged);
}
