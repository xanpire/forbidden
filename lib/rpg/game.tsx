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
import {
  appendStoryMessage,
  cloneDatabase,
  extractTurnDiff,
  getLastExchange,
  pushSnapshot,
  restoreLastSnapshot,
  rollD20,
  trimToSentence,
} from './services';
import {
  applyStateStep,
  applySummaryJob,
  carryOverMemory,
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
  AppDatabase,
  BondRecord,
  EventRecord,
  PortraitSignature,
  Settings,
  ThreadRecord,
  TurnDiff,
} from './types';

/** Moves inline images into IndexedDB and saves, so localStorage only holds references. */
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
  worldEventNotice: string | null;
  dismissWorldEventNotice: () => void;
  setApiKey: (key: string) => Promise<void>;
  sendTurn: (input: string) => Promise<void>;
  regenerate: () => Promise<void>;
  undoLastTurn: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  switchSlotById: (slotId: string) => Promise<void>;
  createNewSlot: (slotName: string) => Promise<void>;
  deleteSlotById: (slotId: string) => Promise<void>;
  duplicateSlotById: (slotId: string, slotName: string) => Promise<void>;
  renameSlotById: (slotId: string, slotName: string) => Promise<void>;
  exportActiveSlot: () => Promise<string | null>;
  importSlot: (json: string, slotName?: string) => Promise<void>;
  updateBond: (bondId: string, patch: Partial<BondRecord>) => Promise<void>;
  updateThread: (threadId: string, patch: Partial<ThreadRecord>) => Promise<void>;
  toggleMemoryPin: (eventId: string) => Promise<void>;
  editMemory: (
    eventId: string,
    patch: Partial<Pick<EventRecord, 'summary' | 'tags' | 'importance' | 'pinned'>>
  ) => Promise<void>;
  deleteMemory: (eventId: string) => Promise<void>;
  attachImage: (logId: string, image: string) => Promise<void>;
  addPortrait: (image: string, signature: PortraitSignature) => Promise<void>;
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
  /** Kan's line for the turn being narrated, shown until the turn is saved. */
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastPromptTokens, setLastPromptTokens] = useState(0);
  const [worldEventNotice, setWorldEventNotice] = useState<string | null>(null);

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

  const showNotice = useCallback((slotId: string, notice: string | null) => {
    if (notice && dbRef.current?.meta.slotId === slotId) {
      setWorldEventNotice(notice);
    }
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
            let notice: string | null = null;

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
              });
              followUps.push(...result.followUpIds);
              notice = result.notice;
              return result.db;
            });

            showNotice(slotId, notice);
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
    [readLatest, setJobActive, showNotice, updateLatest]
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
    async (activeKey: string, slotId: string, turn: TurnInfo) => {
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

        let followUps: string[] = [];
        let notice: string | null = null;

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
          notice = result.notice;
          return result.db;
        });

        showNotice(slotId, notice);
        void scheduleJobs(activeKey, slotId, followUps);
      } catch {
        setError('Your last turn could not be saved. Check your storage space and try again.');
      } finally {
        setStateStepRunning(false);
      }
    },
    [readLatest, scheduleJobs, showNotice, updateLatest]
  );

  const trackBackground = useCallback((task: Promise<void>) => {
    backgroundPromiseRef.current = task;
    void task.catch(() => undefined).finally(() => {
      if (backgroundPromiseRef.current === task) {
        backgroundPromiseRef.current = null;
      }
    });
  }, []);

  const sendTurnInner = useCallback(
    async (action: string, activeKey: string) => {
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
        const snapshotDb = pushSnapshot(current);
        const withUser = appendStoryMessage(
          snapshotDb,
          'user',
          action,
          null,
          0,
          0
        );

        const d20 = rollD20();
        const prompt = buildNarrationPrompt(withUser, action, d20);
        setLastPromptTokens(prompt.estimatedTokens);
        debugTurnId = beginDebugTurn({
          slotId: current.meta.slotId,
          action,
          d20,
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
          const withSnapshot = pushSnapshot(latest);
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
          // Clear the live text in the same tick the saved reply appears, so
          // the turn never shows twice.
          setStreamingText('');
          setPendingAction(null);
          return withReply;
        });

        if (!saved || !turnLogId) {
          return;
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
    async (input: string) => {
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
        await sendTurnInner(action, storedKey);
        return;
      }

      await sendTurnInner(action, apiKey.trim());
    },
    [apiKey, sendTurnInner]
  );


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
    async (slotName: string) => {
      const next = await createSlot(slotName);
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

  const exportActiveSlot = useCallback(async () => {
    const current = dbRef.current;
    return current ? exportDatabase(await inlineImages(current)) : null;
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
    async (logId: string, image: string) => {
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
        entry.id === logId ? { ...entry, image: stored } : entry
      );

      await commitDb({
        ...latest,
        rawLog,
      });
    },
    [commitDb]
  );

  const addPortrait = useCallback(
    async (image: string, signature: PortraitSignature) => {
      const current = dbRef.current;

      if (!current) {
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

  const dismissWorldEventNotice = useCallback(() => {
    setWorldEventNotice(null);
  }, []);

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
      worldEventNotice,
      dismissWorldEventNotice,
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
      updateThread,
      toggleMemoryPin,
      editMemory,
      deleteMemory,
      attachImage,
      addPortrait,
    }),
    [
      apiKey,
      createNewSlot,
      db,
      deleteMemory,
      attachImage,
      addPortrait,
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
      worldEventNotice,
      dismissWorldEventNotice,
      switchSlotById,
      toggleMemoryPin,
      undoLastTurn,
      updateBond,
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
