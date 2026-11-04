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
import { externalizeImages, inlineImages, storeImage } from './imageStore';
import { buildNarrationPrompt, splitNarrationAndDiff } from './prompt';
import { advanceCanon, applyCanonMarks, markNewsHeard } from './canon';
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
  storyMessagesSinceLastSummary,
  summarizeScene,
  trimToSentence,
  summarizeTimeSkip,
} from './services';
import { daysBetween } from './calendar';
import { detectNarrationTime } from './timeparse';
import { inferScenePace, resolveTurnClock } from './pacing';
import type {
  AppDatabase,
  BondRecord,
  EventRecord,
  PortraitSignature,
  Settings,
  SummaryRecord,
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
  processingError: string | null;
  isNarrating: boolean;
  isProcessing: boolean;
  streamingText: string;
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
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [isNarrating, setIsNarrating] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [lastPromptTokens, setLastPromptTokens] = useState(0);
  const [worldEventNotice, setWorldEventNotice] = useState<string | null>(null);

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

        const parsedTime = detectNarrationTime(assistantMessage, currentDb.state.inStoryDate);
        const reportedSeconds = extraction?.state?.elapsedSeconds ?? 0;
        const pace = extraction?.state?.scenePace ?? inferScenePace(assistantMessage);
        const sceneEnded = extraction?.scene?.ended ?? false;
        const clock = resolveTurnClock({
          reportedSeconds,
          detected: parsedTime,
          pace,
          sceneEnded,
          current: currentDb.state.inStoryDate,
        });

        let effectiveDiff = extraction;

        if (clock.elapsedSeconds > 0 || clock.clock || clock.explicitDate || pace) {
          const merged = { ...(extraction ?? {}) };
          merged.state = {
            ...(merged.state ?? {}),
            elapsedSeconds: clock.elapsedSeconds,
            scenePace: merged.state?.scenePace ?? pace,
            clockTime: clock.clock ?? merged.state?.clockTime,
            inStoryDate: clock.explicitDate ?? merged.state?.inStoryDate,
          };
          effectiveDiff = merged;
        }

        let next = effectiveDiff ? applyTurnDiff(currentDb, effectiveDiff) : currentDb;

        const relays = extraction?.newsRelayed ?? [];

        next = applyCanonMarks(
          next,
          extraction?.canonCompleted ?? [],
          extraction?.canonEngaged ?? [],
          extraction?.canonPassed ?? []
        );
        next = markNewsHeard(next, relays);
        next = advanceCanon(next);

        if (relays.length > 0) {
          const delivered = next.events.find((event) => {
            const id = relays[0].id.startsWith('event_canon_')
              ? relays[0].id
              : `event_canon_${relays[0].id}`;
            return event.id === id;
          });

          if (delivered) {
            const title = delivered.summary.split(':')[0].trim();
            const from = relays[0].from?.trim() || 'a rumor';
            setWorldEventNotice(`${title} — from ${from}`.slice(0, 110));
          }
        }

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
          storyMessagesSinceLastSummary(next) >= next.settings.autoSummarizeThreshold;

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

        let fullText = result.text;
        let promptTokens = result.promptTokens;
        let completionTokens = result.completionTokens;

        const firstSplit = splitNarrationAndDiff(fullText);
        const likelyCut =
          result.finishReason === 'length' ||
          (!firstSplit.inlineDiff && endsMidSentence(firstSplit.narration));

        if (likelyCut) {
          try {
            const continuation = await streamChatCompletion({
              apiKey: activeKey,
              model: withUser.settings.narrationModel,
              messages: [
                ...prompt.messages,
                { role: 'assistant', content: fullText },
                {
                  role: 'user',
                  content:
                    'Continue from the exact cut-off point. Finish the sentence and the turn, then output the state JSON block as instructed.',
                },
              ],
              temperature: withUser.settings.temperature,
              maxTokens: 700,
              signal: controller.signal,
              onDelta: () => {},
            });

            fullText = `${fullText}${continuation.text}`;
            promptTokens += continuation.promptTokens;
            completionTokens += continuation.completionTokens;
          } catch {
            // Keep the original reply if the continuation fails.
          }
        }

        const split = splitNarrationAndDiff(fullText);
        const narration = endsMidSentence(split.narration)
          ? trimToSentence(split.narration)
          : split.narration;
        const { diff: inlineTurnDiff, imageWorthy } = convertInlineDiff(split.inlineDiff);

        const withAssistant = appendStoryMessage(
          withUser,
          'assistant',
          narration,
          withUser.settings.narrationModel,
          promptTokens,
          completionTokens
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
      processingError,
      isNarrating,
      isProcessing,
      streamingText,
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
      processingError,
      regenerate,
      renameSlotById,
      sendTurn,
      setApiKey,
      slots,
      streamingText,
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
