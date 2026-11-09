import { withoutExplicit } from './explicitImages';
import { CORRECTIVE_NOTE, FADE_TO_BLACK_LINE, notificationText, postCheckDecision } from './intimacy';
import { setTabTitle } from '../privacy';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  buildIndices,
  createSlot,
  deleteSlot,
  duplicateSlot,
  exportDatabase,
  importDatabase,
  listSlots,
  loadActiveSlot,
  loadApiKey,
  loadStorageMeta,
  loadStoredSlot,
  renameSlot,
  saveApiKey,
  saveSlot,
  switchSlot,
  type StorageMeta,
} from './db';
import { makeId } from './id';
import { externalizeImages, inlineImages, storeImage } from './imageStore';
import { FACE_IMAGE } from './imageCompress';
import { buildNarrationPrompt, stripNarrationJson } from './prompt';
import {
  beginDebugTurn,
  describeStateChange,
  failDebugTurn,
  linkDebugTurn,
  loadDebugLog,
  recordDebugCall,
  recordDebugState,
} from './debug';
import { streamChatCompletion } from '../openrouter';
import { extractTurnDiff } from './services';
import { appendStoryMessage, cloneDatabase, getLastExchange, pushSnapshot, restoreLastSnapshot } from './log';
import { markAlive, markDeceased } from './deaths';
import { endCompanion, setCompanion } from './companions';
import { mergeEntityPair } from './entities';
import { addCharacterPortraitToDb, setCharacterFaceInDb } from './characterPortrait';
import { trimToSentence } from './util';
import { setSceneModeOverride } from './sceneMode';
import {
  applyStateStep,
  applySummaryJob,
  carryOverMemory,
  correctTurnTime as correctTurnTimeInDb,
  extractStateForJob,
  isJobValid,
  markJobFailed,
  markJobsQueued,
  pendingMemoryJobs,
  pruneJobs,
  queueStateRetry,
  removeJob,
  runSummaryJob,
  type TurnInfo,
} from './memoryJobs';
import type {
  SeedInput,
  SteerChip,
  AppDatabase,
  BondRecord,
  EventRecord,
  PortraitSignature,
  CharacterPortraitSignature,
  SceneImageMeta,
  SceneModeName,
  Settings,
  ThreadRecord,
  TurnDiff,
} from './types';

/** The save with every image left out: scene images, portraits and face references. */
function withoutImages(db: AppDatabase): AppDatabase {
  return {
    ...db,
    rawLog: db.rawLog.map((entry) => (entry.image ? { ...entry, image: null } : entry)),
    portraits: [],
    characterPortraits: [],
    characterFaces: [],
    snapshots: [],
  };
}

/** Moves inline images into IndexedDB and saves, so the save only holds references. */
async function withStoredImages(db: AppDatabase): Promise<AppDatabase> {
  try {
    const moved = await externalizeImages(db);

    if (!moved) {
      return db;
    }

    await saveSlot(moved);
    return moved;
  } catch {
    return db;
  }
}

function endsMidSentence(text: string) {
  const trimmed = text.trim();

  if (!trimmed) {
    return false;
  }

  return !/[.!?…](?:["'”’)]+)?$/.test(trimmed);
}


/** One-turn extras the player picks by the input. */
export type TurnOptions = {
  steer?: SteerChip;
  oocNote?: string;
  /** Internal: this turn is a rewrite after a reply crossed a hard limit. */
  retry?: number;
};

type GameContextValue = {
  db: AppDatabase | null;
  slots: AppDatabase[];
  meta: StorageMeta | null;
  apiKey: string;
  loading: boolean;
  error: string | null;
  isNarrating: boolean;
  /** True while the state step or any summary step is running. */
  isProcessing: boolean;
  /** Memory steps that failed or were interrupted and are waiting for a retry. */
  pendingMemoryCount: number;
  retryPendingMemory: () => Promise<void>;
  streamingText: string;
  pendingAction: string | null;
  lastPromptTokens: number;
  setApiKey: (key: string) => Promise<void>;
  /** Sends the player's input. */
  sendTurn: (input: string, options?: TurnOptions) => Promise<void>;
  regenerate: () => Promise<void>;
  undoLastTurn: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  switchSlotById: (slotId: string) => Promise<void>;
  createNewSlot: (slotName: string, input?: SeedInput) => Promise<void>;
  deleteSlotById: (slotId: string) => Promise<void>;
  duplicateSlotById: (slotId: string, slotName: string) => Promise<void>;
  renameSlotById: (slotId: string, slotName: string) => Promise<void>;
  /** The save as JSON; without images it is a small file of story and memory only. */
  exportActiveSlot: (options?: { withImages?: boolean; withExplicit?: boolean }) => Promise<string | null>;
  importSlot: (json: string, slotName?: string) => Promise<void>;
  updateBond: (bondId: string, patch: Partial<BondRecord>) => Promise<void>;
  /** Folds dropId into keepId: one person, with both histories. */
  mergeCharacters: (keepId: string, dropId: string) => Promise<void>;
  /** Hand correction when the story got someone's death wrong. */
  setCharacterDeceased: (entityId: string, deceased: boolean) => Promise<void>;
  /** Hand correction: starts or ends someone being with the player. */
  setWithYou: (entityId: string, withYou: boolean) => Promise<void>;
  /** The mode chip: force conversation, fight or normal narration, or null for automatic. */
  setSceneMode: (mode: SceneModeName | null) => Promise<void>;
  updateThread: (threadId: string, patch: Partial<ThreadRecord>) => Promise<void>;
  toggleMemoryPin: (eventId: string) => Promise<void>;
  editMemory: (
    eventId: string,
    patch: Partial<Pick<EventRecord, 'summary' | 'tags' | 'importance' | 'pinned'>>
  ) => Promise<void>;
  deleteMemory: (eventId: string) => Promise<void>;
  attachImage: (logId: string, image: string, meta?: SceneImageMeta) => Promise<void>;
  /** Sets how many in-story seconds a reply took; the clock shifts to match. */
  correctTurnTime: (logId: string, seconds: number) => Promise<void>;
  addPortrait: (image: string, signature: PortraitSignature) => Promise<void>;
  /** Saves a painted portrait of someone in your bonds. */
  /** Applies a change to the latest copy of the save (explicit pictures, reference sheets, world edits). */
  changeSave: (change: (db: AppDatabase) => AppDatabase) => Promise<void>;
  addCharacterPortrait: (
    entityId: string,
    image: string,
    signature: CharacterPortraitSignature,
    usedFace: boolean
  ) => Promise<void>;
  /** Sets (or, with null, removes) someone's face reference. */
  setCharacterFace: (entityId: string, image: string | null) => Promise<void>;
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [slots, setSlots] = useState<AppDatabase[]>([]);
  const [meta, setMeta] = useState<StorageMeta | null>(null);
  const [apiKey, setApiKeyState] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);
  const [stateStepRunning, setStateStepRunning] = useState(false);
  const [activeJobCount, setActiveJobCount] = useState(0);
  const [streamingText, setStreamingText] = useState('');
  /** The player's line for the turn being narrated, shown until the turn is saved. */
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastPromptTokens, setLastPromptTokens] = useState(0);

  const dbRef = useRef<AppDatabase | null>(null);
  /** The current turn's state step. The next turn, undo and regenerate wait for it. */
  const backgroundPromiseRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** Saves run one at a time, in order, so an older copy never lands last. */
  const saveQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Serializes read-modify-write on slots that aren't open right now. */
  const inactiveLockRef = useRef<Promise<unknown>>(Promise.resolve());
  /** Summary steps run one after another on this chain. */
  const memoryChainRef = useRef<Promise<void>>(Promise.resolve());
  const activeJobIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  useEffect(() => {
    void loadDebugLog();
  }, []);

  const refreshSlots = useCallback(async () => {
    const allSlots = await listSlots();
    setSlots(allSlots);
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([
      loadStorageMeta(),
      loadActiveSlot().then(withStoredImages),
      loadApiKey(),
      listSlots(),
    ])
      .then(([storageMeta, activeSlot, storedApiKey, allSlots]) => {
        if (!active) {
          return;
        }

        setMeta(storageMeta);
        setDb(activeSlot);
        setApiKeyState(storedApiKey);
        setSlots(allSlots);
      })
      .catch(() => {
        if (active) {
          setError('Could not load your story. Refresh the app and try again.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const enqueueSave = useCallback((next: AppDatabase) => {
    const write = saveQueueRef.current.catch(() => undefined).then(() => saveSlot(next));
    saveQueueRef.current = write;
    return write;
  }, []);

  const commitDb = useCallback(
    async (next: AppDatabase) => {
      const normalized = {
        ...next,
        indices: buildIndices(next),
      };

      // Update the in-memory copy first (synchronously), so anything that
      // reads dbRef next builds on this version rather than the one before it.
      dbRef.current = normalized;
      setDb(normalized);
      await enqueueSave(normalized);

      return normalized;
    },
    [enqueueSave]
  );

  /** The newest copy of a slot: the open one in memory, otherwise what's stored. */
  const readLatest = useCallback(async (slotId: string) => {
    const active = dbRef.current;

    if (active?.meta.slotId === slotId) {
      return active;
    }

    await saveQueueRef.current.catch(() => undefined);
    return loadStoredSlot(slotId);
  }, []);

  /**
   * Applies a change to the latest copy of a slot and saves it. `mutate`
   * returns null to skip the write (e.g. the turn it belonged to is gone).
   */
  const updateLatest = useCallback(
    async (
      slotId: string,
      mutate: (latest: AppDatabase) => AppDatabase | null
    ): Promise<AppDatabase | null> => {
      const active = dbRef.current;

      if (active?.meta.slotId === slotId) {
        const next = mutate(active);
        return next ? commitDb(next) : null;
      }

      const run = inactiveLockRef.current
        .catch(() => undefined)
        .then(async (): Promise<AppDatabase | null | 'reopened'> => {
          await saveQueueRef.current.catch(() => undefined);

          if (dbRef.current?.meta.slotId === slotId) {
            return 'reopened';
          }

          const stored = await loadStoredSlot(slotId);

          if (!stored) {
            return null;
          }

          const next = mutate(stored);

          if (!next) {
            return null;
          }

          const normalized = { ...next, indices: buildIndices(next) };
          await enqueueSave(normalized);
          return normalized;
        });

      inactiveLockRef.current = run;
      const result = await run;

      if (result === 'reopened') {
        // The player switched back to this slot while we waited.
        const reopened = dbRef.current;
        const next = reopened ? mutate(reopened) : null;
        return next ? commitDb(next) : null;
      }

      return result;
    },
    [commitDb, enqueueSave]
  );

  const setApiKey = useCallback(async (key: string) => {
    await saveApiKey(key);
    setApiKeyState(key.trim());
  }, []);

  const setJobActive = useCallback((jobId: string, active: boolean) => {
    if (active) {
      activeJobIdsRef.current.add(jobId);
    } else {
      activeJobIdsRef.current.delete(jobId);
    }

    setActiveJobCount(activeJobIdsRef.current.size);
  }, []);


  /**
   * Runs memory jobs one at a time. Each job reads the latest save, calls the
   * model, then applies its result to the save as it is at that moment. A
   * failure only marks that one job as pending; the others still run.
   */
  const drainJobs = useCallback(
    async (activeKey: string, slotId: string, jobIds: string[]) => {
      const queue = [...jobIds];

      while (queue.length > 0) {
        const jobId = queue.shift() as string;
        const followUps: string[] = [];

        try {
          const base = await readLatest(slotId);
          const job = base?.memoryJobs?.find((entry) => entry.id === jobId);

          if (!base || !job) {
            continue;
          }

          if (!isJobValid(base, job)) {
            await updateLatest(slotId, (latest) => removeJob(latest, jobId));
            continue;
          }

          if (job.kind === 'state') {
            const extraction = await extractStateForJob(activeKey, base, job);

            await updateLatest(slotId, (latest) => {
              const current = latest.memoryJobs?.find((entry) => entry.id === jobId);

              if (!current || !isJobValid(latest, current)) {
                return null;
              }

              const narration =
                latest.rawLog.find((entry) => entry.id === job.turnLogId)?.content ?? '';
              const result = applyStateStep(
                latest,
                extraction,
                {
                  turnLogId: job.turnLogId,
                  userMessage: job.userMessage ?? '',
                  narration,
                },
                activeJobIdsRef.current
              );
              recordDebugState(job.turnLogId, {
                status: extraction ? 'applied' : 'fallback',
                diff: result.appliedDiff,
                changes: describeStateChange(latest, result.db),
                ...(result.nameLeaks?.length ? { nameLeaks: result.nameLeaks } : {}),
              });
              followUps.push(...result.followUpIds);
              return result.db;
            });
          } else {
            const output = await runSummaryJob(activeKey, base, job);

            await updateLatest(slotId, (latest) => {
              const result = applySummaryJob(latest, job, output);

              if (!result) {
                return null;
              }

              followUps.push(...result.followUpIds);
              return result.db;
            });
          }
        } catch (caught) {
          const failed = (await readLatest(slotId).catch(() => null))?.memoryJobs?.find(
            (entry) => entry.id === jobId
          );

          if (failed?.kind === 'state') {
            recordDebugState(failed.turnLogId, {
              status: 'failed',
              error: caught instanceof Error ? caught.message : String(caught),
            });
          }

          try {
            await updateLatest(slotId, (latest) =>
              latest.memoryJobs?.some((entry) => entry.id === jobId)
                ? markJobFailed(latest, jobId, caught)
                : null
            );
          } catch {
            // Storage itself failed; the job stays queued and shows as pending.
          }
        } finally {
          for (const id of followUps) {
            setJobActive(id, true);

            if (!queue.includes(id)) {
              queue.push(id);
            }
          }

          if (!queue.includes(jobId)) {
            setJobActive(jobId, false);
          }
        }
      }
    },
    [readLatest, setJobActive, updateLatest]
  );

  const scheduleJobs = useCallback(
    (activeKey: string, slotId: string, jobIds: string[]) => {
      if (jobIds.length === 0) {
        return memoryChainRef.current;
      }

      jobIds.forEach((id) => setJobActive(id, true));

      const run = memoryChainRef.current
        .catch(() => undefined)
        .then(() => drainJobs(activeKey, slotId, jobIds));

      memoryChainRef.current = run;
      return run;
    },
    [drainJobs, setJobActive]
  );

  /**
   * Phase 1 of a turn: apply and save the state change straight away. The
   * summaries it calls for are queued and run afterwards on their own.
   */
  const runStateStep = useCallback(
    async (activeKey: string, slotId: string, turnIn: TurnInfo) => {
      let turn = turnIn;
      setStateStepRunning(true);

      try {
        let extraction: TurnDiff | null;

        try {
          // Context for the state call is the save *before* this turn's
          // changes; the turn's own prose is passed separately.
          const base = await readLatest(slotId);

          if (!base) {
            return;
          }

          extraction = await extractTurnDiff({
            apiKey: activeKey,
            db: base,
            userMessage: turn.userMessage,
            assistantMessage: turn.narration,
            debugTurnId: turn.turnLogId,
          });
        } catch (caught) {
          recordDebugState(turn.turnLogId, {
            status: 'failed',
            error: caught instanceof Error ? caught.message : String(caught),
          });
          await updateLatest(slotId, (latest) =>
            latest.rawLog.some((entry) => entry.id === turn.turnLogId)
              ? queueStateRetry(latest, turn, caught)
              : null
          );
          return;
        }

        // The post-check: a reply that wrote one of the player's hard limits,
        // or made someone who isn't a stated adult part of anything sexual, is
        // thrown away and written again once with a corrective note. If it
        // happens again, a fade-to-black line stands in for it.
        const decision = postCheckDecision(extraction, turn.options?.retry ?? 0);
        if (extraction && decision !== 'keep') {
          const retry = turn.options?.retry ?? 0;
          recordDebugState(turn.turnLogId, {
            status: 'failed',
            error: `Reply crossed ${extraction.ageRuleCrossed ? 'the adults-only rule' : "a hard limit"}; ${retry < 1 ? 'writing it again' : 'faded to black'}.`,
          });

          if (decision === 'rewrite') {
            await updateLatest(slotId, (latest) => {
              if (!latest.rawLog.some((entry) => entry.id === turn.turnLogId)) return null;
              const snapshot = restoreLastSnapshot(latest);
              return snapshot ? carryOverMemory(latest, snapshot) : null;
            });
            const options = {
              ...turn.options,
              retry: retry + 1,
              oocNote: [CORRECTIVE_NOTE, turn.options?.oocNote].filter(Boolean).join(' '),
            };
            setTimeout(() => void rewriteRef.current?.(turn.userMessage, options), 0);
            return;
          }

          await updateLatest(slotId, (latest) => ({
            ...latest,
            rawLog: latest.rawLog.map((entry) => (entry.id === turn.turnLogId ? { ...entry, content: FADE_TO_BLACK_LINE } : entry)),
          }));
          turn = { ...turn, narration: FADE_TO_BLACK_LINE };
          extraction = { sex: { on: false } };
        }

        let followUps: string[] = [];

        await updateLatest(slotId, (latest) => {
          if (!latest.rawLog.some((entry) => entry.id === turn.turnLogId)) {
            return null;
          }

          const result = applyStateStep(latest, extraction, turn, activeJobIdsRef.current);
          recordDebugState(turn.turnLogId, {
            status: extraction ? 'applied' : 'fallback',
            diff: result.appliedDiff,
            changes: describeStateChange(latest, result.db),
          });
          followUps = result.followUpIds;
          return result.db;
        });

        void scheduleJobs(activeKey, slotId, followUps);
      } catch {
        setError('Your last turn could not be saved. Check your storage space and try again.');
      } finally {
        setStateStepRunning(false);
      }
    },
    [readLatest, scheduleJobs, updateLatest]
  );

  /** Set below once sendTurn exists: the post-check uses it to write a reply again. */
  const rewriteRef = useRef<((input: string, options: TurnOptions) => Promise<void>) | null>(null);

  const trackBackground = useCallback((task: Promise<void>) => {
    backgroundPromiseRef.current = task;
    void task.catch(() => undefined).finally(() => {
      if (backgroundPromiseRef.current === task) {
        backgroundPromiseRef.current = null;
      }
    });
  }, []);

  const sendTurnInner = useCallback(
    async (action: string, activeKey: string, turnOptions: TurnOptions = {}) => {
      if (backgroundPromiseRef.current) {
        await backgroundPromiseRef.current;
      }

      const current = dbRef.current;

      if (!current) {
        setError('Your story is still loading. Try again in a moment.');
        return;
      }

      setIsNarrating(true);
      setStreamingText('');
      setPendingAction(action);
      setError(null);
      let debugTurnId: string | null = null;
      let narratorRecorded = false;

      try {
        // "Fade to black" holds for the rest of the scene.
        const fade = (db: AppDatabase) =>
          turnOptions.steer === 'fade-to-black' && db.state.sceneMode
            ? { ...db, state: { ...db.state, sceneMode: { ...db.state.sceneMode, fadeToBlack: true } } }
            : db;
        const snapshotDb = fade(pushSnapshot(current));
        const withUser = appendStoryMessage(
          snapshotDb,
          'user',
          action,
          null,
          0,
          0
        );

        const prompt = buildNarrationPrompt(withUser, action, { steer: turnOptions.steer, oocNote: turnOptions.oocNote });
        setLastPromptTokens(prompt.estimatedTokens);
        debugTurnId = beginDebugTurn({
          slotId: current.meta.slotId,
          action,
          narratorModel: withUser.settings.narrationModel,
          prompt: prompt.messages,
          promptEstimate: prompt.estimatedTokens,
        });

        const controller = new AbortController();
        abortRef.current = controller;

        // Call 1: the narrator writes prose only and streams it straight to
        // the screen. State is extracted afterwards by a second call.
        let streamed = '';
        let flushTimer: ReturnType<typeof setTimeout> | null = null;
        const flush = () => {
          flushTimer = null;
          setStreamingText(streamed);
        };

        let result;

        try {
          result = await streamChatCompletion({
            apiKey: activeKey,
            model: withUser.settings.narrationModel,
            messages: prompt.messages,
            temperature: withUser.settings.temperature,
            maxTokens: withUser.settings.maxTokens,
            // Medium thinking, kept out of the streamed text. max_tokens is
            // sized so the thinking can't eat the room for prose + state.
            reasoning: { effort: 'medium', exclude: true },
            signal: controller.signal,
            onDelta: (delta) => {
              streamed += delta;

              if (!flushTimer) {
                flushTimer = setTimeout(flush, 60);
              }
            },
          });
        } finally {
          if (flushTimer) {
            clearTimeout(flushTimer);
          }
        }

        recordDebugCall(debugTurnId, {
          kind: 'narrator',
          model: withUser.settings.narrationModel,
          usage: result.usage,
          finishReason: result.finishReason,
          apiKey: activeKey,
        });
        narratorRecorded = true;

        const promptTokens = result.promptTokens;
        const completionTokens = result.completionTokens;
        // Safety net only: the narrator is no longer asked for JSON, but a
        // model that adds some anyway must never get it into the story.
        const prose = stripNarrationJson(result.text);
        const narration =
          result.finishReason === 'length' || endsMidSentence(prose)
            ? trimToSentence(prose)
            : prose;

        if (!narration.trim()) {
          throw new Error('The narrator returned an empty reply. Try again.');
        }

        // Save onto the latest copy, not the one the prompt was built from,
        // so summaries that finished during narration are kept.
        const slotId = current.meta.slotId;
        const model = withUser.settings.narrationModel;
        let turnLogId = '';

        const saved = await updateLatest(slotId, (latest) => {
          // The snapshot is taken first, so undo restores the turn before.
          const withSnapshot = fade(pushSnapshot(latest));
          const withPlayer = appendStoryMessage(withSnapshot, 'user', action, null, 0, 0);
          const withReply = appendStoryMessage(
            withPlayer,
            'assistant',
            narration,
            model,
            promptTokens,
            completionTokens
          );
          turnLogId = withReply.rawLog[withReply.rawLog.length - 1].id;
          // Which mode the reply was written in: the state step reads it for
          // the clock and the conversation streak.
          withReply.rawLog[withReply.rawLog.length - 1] = {
            ...withReply.rawLog[withReply.rawLog.length - 1],
            sceneMode: prompt.sceneMode.mode,
          };
          // Clear the live text in the same tick the saved reply appears, so
          // the turn never shows twice.
          setStreamingText('');
          setPendingAction(null);
          return withReply;
        });

        if (!saved || !turnLogId) {
          return;
        }

        // A reply that lands while the tab is hidden only says that something happened.
        if (typeof document !== 'undefined' && document.hidden) {
          setTabTitle(notificationText('reply'));
        }

        if (debugTurnId) {
          linkDebugTurn(debugTurnId, turnLogId);
        }

        // Call 2: read the state change out of the prose, in the background.
        trackBackground(
          runStateStep(activeKey, slotId, {
            turnLogId,
            userMessage: action,
            narration,
            options: turnOptions,
          })
        );
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : 'The narrator could not respond.';
        setError(message);

        if (debugTurnId) {
          if (!narratorRecorded) {
            recordDebugCall(debugTurnId, {
              kind: 'narrator',
              model: current.settings.narrationModel,
              usage: null,
              error: message,
            });
          }

          failDebugTurn(debugTurnId, message);
        }
      } finally {
        setIsNarrating(false);
        setStreamingText('');
        setPendingAction(null);
        abortRef.current = null;
      }
    },
    [runStateStep, trackBackground, updateLatest]
  );


  const sendTurn = useCallback(
    async (input: string, options?: TurnOptions) => {
      const action = input.trim();

      if (!action) {
        return;
      }

      if (!apiKey.trim()) {
        const storedKey = (await loadApiKey()).trim();

        if (!storedKey) {
          setError('Add your OpenRouter API key in Settings before starting the story.');
          return;
        }

        setApiKeyState(storedKey);
        await sendTurnInner(action, storedKey, options);
        return;
      }

      await sendTurnInner(action, apiKey.trim(), options);
    },
    [apiKey, sendTurnInner]
  );


  rewriteRef.current = sendTurn;

  const undoLastTurn = useCallback(async () => {
    if (backgroundPromiseRef.current) {
      await backgroundPromiseRef.current;
    }

    const current = dbRef.current;

    if (!current) {
      return;
    }

    const restored = restoreLastSnapshot(current);

    if (!restored) {
      return;
    }

    await commitDb(carryOverMemory(current, restored));
    setStreamingText('');
    setError(null);
  }, [commitDb]);

  const regenerate = useCallback(async () => {
    if (backgroundPromiseRef.current) {
      await backgroundPromiseRef.current;
    }

    const current = dbRef.current;

    if (!current) {
      return;
    }

    const { userMessage } = getLastExchange(current);

    if (!userMessage) {
      return;
    }

    const snapshot = restoreLastSnapshot(current);
    const restored = snapshot ? carryOverMemory(current, snapshot) : current;
    await commitDb(restored);
    await sendTurn(userMessage);
  }, [commitDb, sendTurn]);

  const updateSettings = useCallback(
    async (patch: Partial<Settings>) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      await commitDb({
        ...current,
        settings: {
          ...current.settings,
          ...patch,
        },
      });
    },
    [commitDb]
  );

  const switchSlotById = useCallback(
    async (slotId: string) => {
      // Let pending writes land first so the slot is read back up to date.
      await saveQueueRef.current.catch(() => undefined);
      await inactiveLockRef.current.catch(() => undefined);
      const loaded = await switchSlot(slotId);

      if (!loaded) {
        return;
      }

      const next = await withStoredImages(loaded);

      setDb(next);
      dbRef.current = next;
      await refreshSlots();
    },
    [refreshSlots]
  );

  const createNewSlot = useCallback(
    async (slotName: string, input?: SeedInput) => {
      const next = await createSlot(slotName, input, dbRef.current?.settings);
      setDb(next);
      dbRef.current = next;
      setMeta(await loadStorageMeta());
      await refreshSlots();
    },
    [refreshSlots]
  );

  const deleteSlotById = useCallback(
    async (slotId: string) => {
      await deleteSlot(slotId);
      const next = await loadActiveSlot();
      setDb(next);
      dbRef.current = next;
      setMeta(await loadStorageMeta());
      await refreshSlots();
    },
    [refreshSlots]
  );

  const duplicateSlotById = useCallback(
    async (slotId: string, slotName: string) => {
      const next = await duplicateSlot(slotId, slotName);
      setDb(next);
      dbRef.current = next;
      setMeta(await loadStorageMeta());
      await refreshSlots();
    },
    [refreshSlots]
  );

  const renameSlotById = useCallback(
    async (slotId: string, slotName: string) => {
      await renameSlot(slotId, slotName);
      await refreshSlots();

      if (dbRef.current?.meta.slotId === slotId) {
        const next = cloneDatabase(dbRef.current);
        next.meta.slotName = slotName;
        await commitDb(next);
      }
    },
    [commitDb, refreshSlots]
  );

  const exportActiveSlot = useCallback(async (options: { withImages?: boolean; withExplicit?: boolean } = {}) => {
    // Explicit pictures stay out of exports unless the player asks for them.
    const current = dbRef.current && !options.withExplicit ? withoutExplicit(dbRef.current) : dbRef.current;

    if (!current) {
      return null;
    }

    if (options.withImages === false) {
      return exportDatabase(withoutImages(current));
    }

    return exportDatabase(await inlineImages(current));
  }, []);

  const importSlot = useCallback(
    async (json: string, slotName?: string) => {
      const imported = await withStoredImages(await importDatabase(json, slotName));
      setDb(imported);
      dbRef.current = imported;
      setMeta(await loadStorageMeta());
      await refreshSlots();
    },
    [refreshSlots]
  );

  const updateBond = useCallback(
    async (bondId: string, patch: Partial<BondRecord>) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const bonds = current.bonds.map((bond) =>
        bond.id === bondId ? { ...bond, ...patch } : bond
      );

      await commitDb({
        ...current,
        bonds,
      });
    },
    [commitDb]
  );

  const mergeCharacters = useCallback(
    async (keepId: string, dropId: string) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const merged = mergeEntityPair(current, keepId, dropId);

      if (merged === current) {
        return;
      }

      await commitDb(merged);
    },
    [commitDb]
  );

  const setCharacterDeceased = useCallback(
    async (entityId: string, deceased: boolean) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      // The dead are no longer with you.
      const next = deceased
        ? endCompanion(markDeceased(current, entityId, {}), entityId, 'died')
        : markAlive(current, entityId);

      if (next === current) {
        return;
      }

      await commitDb(next);
    },
    [commitDb]
  );

  const setWithYou = useCallback(
    async (entityId: string, withYou: boolean) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const next = setCompanion(current, entityId, withYou);

      if (next === current) {
        return;
      }

      await commitDb(next);
    },
    [commitDb]
  );

  const setSceneMode = useCallback(
    async (mode: SceneModeName | null) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      await commitDb(setSceneModeOverride(current, mode));
    },
    [commitDb]
  );

  const updateThread = useCallback(
    async (threadId: string, patch: Partial<ThreadRecord>) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const threads = current.threads.map((thread) =>
        thread.id === threadId ? { ...thread, ...patch } : thread
      );

      await commitDb({
        ...current,
        threads,
      });
    },
    [commitDb]
  );

  const toggleMemoryPin = useCallback(
    async (eventId: string) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const events = current.events.map((event) =>
        event.id === eventId ? { ...event, pinned: !event.pinned } : event
      );

      await commitDb({
        ...current,
        events,
      });
    },
    [commitDb]
  );

  const editMemory = useCallback(
    async (
      eventId: string,
      patch: Partial<Pick<EventRecord, 'summary' | 'tags' | 'importance' | 'pinned'>>
    ) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const events = current.events.map((event) =>
        event.id === eventId ? { ...event, ...patch } : event
      );

      await commitDb({
        ...current,
        events,
      });
    },
    [commitDb]
  );

  const deleteMemory = useCallback(
    async (eventId: string) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const events = current.events.filter((event) => event.id !== eventId);
      const eventEntities = current.eventEntities.filter(
        (link) => link.eventId !== eventId
      );

      await commitDb({
        ...current,
        events,
        eventEntities,
      });
    },
    [commitDb]
  );

  const attachImage = useCallback(
    async (logId: string, image: string, meta?: SceneImageMeta) => {
      if (backgroundPromiseRef.current) {
        await backgroundPromiseRef.current;
      }

      const current = dbRef.current;

      if (!current) {
        return;
      }

      const stored = await storeImage(image);
      const latest = dbRef.current ?? current;
      const rawLog = latest.rawLog.map((entry) =>
        entry.id === logId ? { ...entry, image: stored, ...(meta ? { imageMeta: meta } : {}) } : entry
      );

      await commitDb({
        ...latest,
        rawLog,
      });
    },
    [commitDb]
  );

  const correctTurnTime = useCallback(
    async (logId: string, seconds: number) => {
      const slotId = dbRef.current?.meta.slotId;

      if (!slotId) {
        return;
      }

      try {
        await updateLatest(slotId, (latest) => correctTurnTimeInDb(latest, logId, seconds));
      } catch {
        setError('The time change could not be saved. Check your storage space and try again.');
      }
    },
    [updateLatest]
  );

  const addPortrait = useCallback(
    async (image: string, signature: PortraitSignature) => {
      const current = dbRef.current;

      if (!current) {
        return;
      }

      const latestBefore = (dbRef.current ?? current).portraits?.at(-1);

      // The same painting landing twice (a double trigger) is kept once.
      if (
        latestBefore &&
        JSON.stringify(latestBefore.signature) === JSON.stringify(signature) &&
        Date.now() - latestBefore.createdAt < 10 * 60_000
      ) {
        return;
      }

      const stored = await storeImage(image);
      const latest = dbRef.current ?? current;

      await commitDb({
        ...latest,
        portraits: [
          ...(latest.portraits ?? []),
          {
            id: makeId('portrait'),
            image: stored,
            signature,
            inStoryDate: latest.state.inStoryDate,
            location: latest.state.location,
            createdAt: Date.now(),
          },
        ].slice(-24),
      });
    },
    [commitDb]
  );

  const changeSave = useCallback(
    async (change: (db: AppDatabase) => AppDatabase) => {
      const latest = dbRef.current;
      if (!latest) return;
      await commitDb(change(latest));
    },
    [commitDb]
  );

  const addCharacterPortrait = useCallback(
    async (entityId: string, image: string, signature: CharacterPortraitSignature, usedFace: boolean) => {
      const stored = await storeImage(image);
      const latest = dbRef.current;

      if (!latest) {
        return;
      }

      await commitDb(addCharacterPortraitToDb(latest, entityId, stored, signature, usedFace));
    },
    [commitDb]
  );

  const setCharacterFace = useCallback(
    async (entityId: string, image: string | null) => {
      const stored = image ? await storeImage(image, FACE_IMAGE) : null;
      const latest = dbRef.current;

      if (!latest) {
        return;
      }

      await commitDb(setCharacterFaceInDb(latest, entityId, stored));
    },
    [commitDb]
  );

  const retryPendingMemory = useCallback(async () => {
    const current = dbRef.current;

    if (!current) {
      return;
    }

    const activeKey = apiKey.trim() || (await loadApiKey()).trim();

    if (!activeKey) {
      setError('Add your OpenRouter API key in Settings to retry.');
      return;
    }

    if (backgroundPromiseRef.current) {
      await backgroundPromiseRef.current;
    }

    const slotId = current.meta.slotId;
    const pending = pendingMemoryJobs(dbRef.current, activeJobIdsRef.current);

    if (pending.length === 0) {
      return;
    }

    const ids = pending.map((job) => job.id);
    await updateLatest(slotId, (latest) =>
      markJobsQueued(pruneJobs(latest, activeJobIdsRef.current), ids)
    );

    const run = scheduleJobs(activeKey, slotId, ids);

    // A state step must land before the next turn is narrated.
    if (pending.some((job) => job.kind === 'state')) {
      trackBackground(run);
    }

    await run;
  }, [apiKey, scheduleJobs, trackBackground, updateLatest]);

  const pendingMemoryCount = useMemo(
    () => pendingMemoryJobs(db, activeJobIdsRef.current).length,
    // activeJobCount changes whenever the running set does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, activeJobCount]
  );

  const isProcessing = stateStepRunning || activeJobCount > 0;


  const value = useMemo<GameContextValue>(
    () => ({
      db,
      slots,
      meta,
      apiKey,
      loading,
      error,
      isNarrating,
      isProcessing,
      pendingMemoryCount,
      retryPendingMemory,
      streamingText,
      pendingAction,
      lastPromptTokens,
      setApiKey,
      sendTurn,
      regenerate,
      undoLastTurn,
      updateSettings,
      switchSlotById,
      createNewSlot,
      deleteSlotById,
      duplicateSlotById,
      renameSlotById,
      exportActiveSlot,
      importSlot,
      updateBond,
      mergeCharacters,
      setCharacterDeceased,
      setWithYou,
      setSceneMode,
      updateThread,
      toggleMemoryPin,
      editMemory,
      deleteMemory,
      attachImage,
      correctTurnTime,
      addPortrait,
      changeSave,
      addCharacterPortrait,
      setCharacterFace,
    }),
    [
      apiKey,
      createNewSlot,
      db,
      deleteMemory,
      attachImage,
      addPortrait,
      changeSave,
      addCharacterPortrait,
      setCharacterFace,
      correctTurnTime,
      deleteSlotById,
      duplicateSlotById,
      editMemory,
      error,
      exportActiveSlot,
      importSlot,
      isNarrating,
      isProcessing,
      lastPromptTokens,
      loading,
      meta,
      pendingMemoryCount,
      retryPendingMemory,
      regenerate,
      renameSlotById,
      sendTurn,
      setApiKey,
      slots,
      streamingText,
      pendingAction,
      switchSlotById,
      toggleMemoryPin,
      undoLastTurn,
      updateBond,
      mergeCharacters,
      setCharacterDeceased,
      setWithYou,
      setSceneMode,
      updateSettings,
      updateThread,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const context = useContext(GameContext);

  if (!context) {
    throw new Error('useGame must be used inside a GameProvider');
  }

  return context;
}
