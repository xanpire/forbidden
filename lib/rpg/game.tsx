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
  renameSlot,
  saveApiKey,
  saveSlot,
  switchSlot,
  type StorageMeta,
} from './db';
import { makeId } from './id';
import { buildNarrationPrompt, splitNarrationAndDiff } from './prompt';
import { streamChatCompletion } from '../openrouter';
import {
  appendStoryMessage,
  applyTurnDiff,
  cloneDatabase,
  convertInlineDiff,
  extractTurnDiff,
  getLastExchange,
  pushSnapshot,
  restoreLastSnapshot,
  rollArcSummary,
  rollD20,
  summarizeScene,
  summarizeTimeSkip,
} from './services';
import { daysBetween } from './calendar';
import { generateSceneImageForTurn } from './sceneImage';
import type {
  AppDatabase,
  BondRecord,
  EventRecord,
  Settings,
  SummaryRecord,
  ThreadRecord,
  TurnDiff,
} from './types';

type GameContextValue = {
  db: AppDatabase | null;
  slots: AppDatabase[];
  meta: StorageMeta | null;
  apiKey: string;
  loading: boolean;
  error: string | null;
  processingError: string | null;
  isNarrating: boolean;
  isProcessing: boolean;
  streamingText: string;
  lastPromptTokens: number;
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
  exportActiveSlot: () => string | null;
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
};

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<AppDatabase | null>(null);
  const [slots, setSlots] = useState<AppDatabase[]>([]);
  const [meta, setMeta] = useState<StorageMeta | null>(null);
  const [apiKey, setApiKeyState] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [lastPromptTokens, setLastPromptTokens] = useState(0);

  const dbRef = useRef<AppDatabase | null>(null);
  const backgroundPromiseRef = useRef<Promise<void> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    dbRef.current = db;
  }, [db]);

  const refreshSlots = useCallback(async () => {
    const allSlots = await listSlots();
    setSlots(allSlots);
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([loadStorageMeta(), loadActiveSlot(), loadApiKey(), listSlots()])
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

  const commitDb = useCallback(async (next: AppDatabase) => {
    const normalized = {
      ...next,
      indices: buildIndices(next),
    };

    await saveSlot(normalized);
    dbRef.current = normalized;
    setDb(normalized);

    return normalized;
  }, []);

  const setApiKey = useCallback(async (key: string) => {
    await saveApiKey(key);
    setApiKeyState(key.trim());
  }, []);

  const processBackground = useCallback(
    async (
      activeKey: string,
      currentDb: AppDatabase,
      userMessage: string,
      assistantMessage: string,
      inlineDiff: TurnDiff | null,
      inlineImageWorthy: boolean
    ) => {
      setIsProcessing(true);
      setProcessingError(null);
      const imageWorthy = inlineImageWorthy;

      try {
        const beforeDate = currentDb.state.inStoryDate;
        const extraction = inlineDiff
          ? inlineDiff
          : await extractTurnDiff({
              apiKey: activeKey,
              db: currentDb,
              userMessage,
              assistantMessage,
            });

        let next = extraction ? applyTurnDiff(currentDb, extraction) : currentDb;

        if (Math.abs(daysBetween(beforeDate, next.state.inStoryDate)) >= 180) {
          const timeSkip = await summarizeTimeSkip({
            apiKey: activeKey,
            db: next,
            fromDate: beforeDate,
            toDate: next.state.inStoryDate,
          });

          if (timeSkip) {
            const event: EventRecord = {
              id: makeId('event'),
              chapter: next.state.chapter,
              scene: 'Time skip',
              inStoryDate: next.state.inStoryDate,
              summary: timeSkip,
              importance: 4,
              tags: ['time-skip', 'meanwhile'],
              pinned: false,
              sourceLogId: null,
              createdAt: Date.now(),
            };

            next = {
              ...next,
              events: [...next.events, event],
            };
          }
        }

        const story = next.rawLog.filter((message) => message.kind === 'story');

        const shouldSummarize =
          (inlineDiff !== null && inlineImageWorthy) ||
          extraction?.scene?.ended ||
          story.length >= next.settings.autoSummarizeThreshold;

        if (shouldSummarize) {
          const sceneMessages = story.slice(-Math.min(story.length, 8));
          const summary = await summarizeScene({
            apiKey: activeKey,
            db: next,
            messages: sceneMessages,
          });

          if (summary) {
            const lastEvent = next.events[next.events.length - 1];
            const summaryRecord: SummaryRecord = {
              id: makeId('summary'),
              level: 'chapter',
              range: {
                fromEventId: lastEvent?.id ?? '',
                toEventId: lastEvent?.id ?? '',
                from: next.state.inStoryDate,
                to: next.state.inStoryDate,
              },
              text: summary,
              tokenCount: Math.ceil(summary.length / 4),
              eventIds: lastEvent ? [lastEvent.id] : [],
              createdAt: Date.now(),
            };

            next = {
              ...next,
              summaries: [...next.summaries, summaryRecord],
            };
          }
        }

        const chapterSummaries = next.summaries
          .filter((summary) => summary.level === 'chapter')
          .map((summary) => summary.text);

        if (chapterSummaries.length > 0 && chapterSummaries.length % 3 === 0) {
          const arcSummary = await rollArcSummary({
            apiKey: activeKey,
            db: next,
            chapterSummaries: chapterSummaries.slice(-3),
          });

          if (arcSummary) {
            const arcRecord: SummaryRecord = {
              id: makeId('summary'),
              level: 'arc',
              range: {
                fromEventId: '',
                toEventId: '',
                from: next.state.inStoryDate,
                to: next.state.inStoryDate,
              },
              text: arcSummary,
              tokenCount: Math.ceil(arcSummary.length / 4),
              eventIds: [],
              createdAt: Date.now(),
            };

            next = {
              ...next,
              summaries: [...next.summaries, arcRecord],
            };
          }
        }

        if (chapterSummaries.length >= 12 && chapterSummaries.length % 12 === 0) {
          const yearSummary = await rollArcSummary({
            apiKey: activeKey,
            db: next,
            chapterSummaries: chapterSummaries.slice(-12),
          });

          if (yearSummary) {
            const yearRecord: SummaryRecord = {
              id: makeId('summary'),
              level: 'year',
              range: {
                fromEventId: '',
                toEventId: '',
                from: next.state.inStoryDate,
                to: next.state.inStoryDate,
              },
              text: yearSummary,
              tokenCount: Math.ceil(yearSummary.length / 4),
              eventIds: [],
              createdAt: Date.now(),
            };

            next = {
              ...next,
              summaries: [...next.summaries, yearRecord],
            };
          }
        }

        if (imageWorthy && activeKey) {
          const latestAssistant = [...next.rawLog]
            .reverse()
            .find((message) => message.kind === 'story' && message.role === 'assistant');

          if (latestAssistant && !latestAssistant.image) {
            try {
              const dataUri = await generateSceneImageForTurn({
                apiKey: activeKey,
                db: next,
                logId: latestAssistant.id,
              });

              next = {
                ...next,
                rawLog: next.rawLog.map((entry) =>
                  entry.id === latestAssistant.id
                    ? { ...entry, image: dataUri }
                    : entry
                ),
              };
            } catch {
            }
          }
        }

        if (dbRef.current?.meta.slotId === next.meta.slotId) {
          await commitDb(next);
        } else {
          await saveSlot(next);
        }
      } catch {
        setProcessingError('Memory update failed. Your story is still saved.');
      } finally {
        setIsProcessing(false);
        backgroundPromiseRef.current = null;
      }
    },
    [commitDb]
  );

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
      setError(null);

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

        const controller = new AbortController();
        abortRef.current = controller;

        const result = await streamChatCompletion({
          apiKey: activeKey,
          model: withUser.settings.narrationModel,
          messages: prompt.messages,
          temperature: withUser.settings.temperature,
          maxTokens: withUser.settings.maxTokens,
          signal: controller.signal,
          onDelta: () => {
            // Text is hidden until complete to avoid layout shifts from JSON blocks.
          },
        });

        const { narration, inlineDiff } = splitNarrationAndDiff(result.text);
        const { diff: inlineTurnDiff, imageWorthy } = convertInlineDiff(inlineDiff);

        const withAssistant = appendStoryMessage(
          withUser,
          'assistant',
          narration,
          withUser.settings.narrationModel,
          result.promptTokens,
          result.completionTokens
        );

        const saved =
          dbRef.current?.meta.slotId === withAssistant.meta.slotId
            ? await commitDb(withAssistant)
            : withAssistant;

        if (saved === withAssistant && dbRef.current?.meta.slotId !== withAssistant.meta.slotId) {
          await saveSlot(withAssistant);
        }

        setStreamingText('');

        backgroundPromiseRef.current = processBackground(
          activeKey,
          saved,
          action,
          narration,
          inlineTurnDiff,
          imageWorthy
        );
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : 'The narrator could not respond.';
        setError(message);
      } finally {
        setIsNarrating(false);
        abortRef.current = null;
      }
    },
    [commitDb, processBackground]
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

    await commitDb(restored);
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

    const restored = restoreLastSnapshot(current) ?? current;
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
      const next = await switchSlot(slotId);

      if (!next) {
        return;
      }

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

  const exportActiveSlot = useCallback(() => {
    const current = dbRef.current;
    return current ? exportDatabase(current) : null;
  }, []);

  const importSlot = useCallback(
    async (json: string, slotName?: string) => {
      const imported = await importDatabase(json, slotName);
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

      const rawLog = current.rawLog.map((entry) =>
        entry.id === logId ? { ...entry, image } : entry
      );

      await commitDb({
        ...current,
        rawLog,
      });
    },
    [commitDb]
  );

  const value = useMemo<GameContextValue>(
    () => ({
      db,
      slots,
      meta,
      apiKey,
      loading,
      error,
      processingError,
      isNarrating,
      isProcessing,
      streamingText,
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
      updateThread,
      toggleMemoryPin,
      editMemory,
      deleteMemory,
      attachImage,
    }),
    [
      apiKey,
      createNewSlot,
      db,
      deleteMemory,
      attachImage,
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
      processingError,
      regenerate,
      renameSlotById,
      sendTurn,
      setApiKey,
      slots,
      streamingText,
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
