import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizePost } from './letters';
import { normalizeYearly } from './yearly';
import { normalizeReputation } from './reputation';
import { normalizeRenown } from './renown';
import { normalizeConsequences } from './consequences';
import { normalizeDeaths } from './deaths';
import { ensureNames } from './names';
import { knowersOf } from './facts';

import { DEFAULT_SETTINGS, emptyIndex, normalizePromptBudget } from './defaults';
import { makeId } from './id';
import { stripNarrationJson } from './prompt';
import { TIMELINE_VERSION } from './timeline';
import { normalizeDate } from './calendar';
import { seedDatabase } from './seed';
import { intimacyFromLegacy, normalizeContentProfile, normalizeIntimacy } from './intimacy';
import type { SeedInput } from './types';
import { repairUnmetLabels } from './met';
import { readSlotJson, removeSlotJson, writeSlotJson } from './slotStore';
import { normalizeSceneMode } from './sceneMode';
import type { AppDatabase, EntityRecord, MemoryIndex, WeatherLock } from './types';
import { normalizeTravelLog } from './mapData';
import { WEATHER_CONDITIONS } from './weather';
import { normalizeFlashbacks } from './flashbacks';
import { normalizeSafehouses } from './safehouses';
import { normalizePurse } from './money';
import { APP_NAME, STORAGE_KEYS } from '../brand';
import { isPlayerEntity, normalizeCharacter } from './player';
import { normalizeWorld } from './world';

const META_KEY = STORAGE_KEYS.meta;
const SLOT_PREFIX = STORAGE_KEYS.slotPrefix;
const API_KEY_KEY = STORAGE_KEYS.apiKey;

export type StorageMeta = {
  activeSlotId: string;
  slotOrder: string[];
};

const DEFAULT_SLOT_ID = 'slot_main';
const DEFAULT_SLOT_NAME = 'Main Story';

export async function loadStorageMeta(): Promise<StorageMeta> {
  const stored = await AsyncStorage.getItem(META_KEY);

  if (!stored) {
    const meta: StorageMeta = {
      activeSlotId: DEFAULT_SLOT_ID,
      slotOrder: [DEFAULT_SLOT_ID],
    };
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
    await ensureSlot(DEFAULT_SLOT_ID, DEFAULT_SLOT_NAME);
    return meta;
  }

  try {
    const parsed = JSON.parse(stored) as StorageMeta;

    if (!parsed.activeSlotId || !Array.isArray(parsed.slotOrder) || parsed.slotOrder.length === 0) {
      const meta: StorageMeta = {
        activeSlotId: DEFAULT_SLOT_ID,
        slotOrder: [DEFAULT_SLOT_ID],
      };
      await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
      await ensureSlot(DEFAULT_SLOT_ID, DEFAULT_SLOT_NAME);
      return meta;
    }

    return parsed;
  } catch {
    const meta: StorageMeta = {
      activeSlotId: DEFAULT_SLOT_ID,
      slotOrder: [DEFAULT_SLOT_ID],
    };
    await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
    await ensureSlot(DEFAULT_SLOT_ID, DEFAULT_SLOT_NAME);
    return meta;
  }
}

export async function saveStorageMeta(meta: StorageMeta) {
  await AsyncStorage.setItem(META_KEY, JSON.stringify(meta));
}

export async function ensureSlot(slotId: string, slotName: string) {
  const existing = await readSlotJson(`${SLOT_PREFIX}${slotId}.v1`);

  if (existing) {
    return;
  }

  const db = seedDatabase(slotId, slotName);
  await saveSlot(db);
}

export async function loadSlot(slotId: string): Promise<AppDatabase> {
  const stored = await readSlotJson(`${SLOT_PREFIX}${slotId}.v1`);

  if (!stored) {
    return seedDatabase(slotId, DEFAULT_SLOT_NAME);
  }

  try {
    const parsed = JSON.parse(stored) as AppDatabase;

    if (!parsed || parsed.schemaVersion !== 1) {
      return seedDatabase(slotId, DEFAULT_SLOT_NAME);
    }

    return normalizeDatabase(parsed);
  } catch {
    return seedDatabase(slotId, DEFAULT_SLOT_NAME);
  }
}

/** Loads a slot only if it is actually stored, without seeding a fresh one. */
export async function loadStoredSlot(slotId: string): Promise<AppDatabase | null> {
  const stored = await readSlotJson(`${SLOT_PREFIX}${slotId}.v1`);

  if (!stored) {
    return null;
  }

  try {
    const parsed = JSON.parse(stored) as AppDatabase;
    return parsed && parsed.schemaVersion === 1 ? normalizeDatabase(parsed) : null;
  } catch {
    return null;
  }
}

const MAX_STORED_IMAGES = 3;
const MAX_SNAPSHOTS = 1;

function trimDatabase(db: AppDatabase, maxImages: number, maxSnapshots: number): AppDatabase {
  const imageIndexes: number[] = [];

  for (let index = db.rawLog.length - 1; index >= 0; index -= 1) {
    const entry = db.rawLog[index];

    if (entry.image?.startsWith('data:')) {
      imageIndexes.push(index);
    }
  }

  const keepImages = new Set(imageIndexes.slice(0, maxImages));

  const rawLog = db.rawLog.map((entry, index) =>
    entry.image?.startsWith('data:') && !keepImages.has(index)
      ? { ...entry, image: null }
      : entry
  );

  return {
    ...db,
    rawLog,
    snapshots: db.snapshots.slice(-maxSnapshots),
  };
}

export async function saveSlot(db: AppDatabase) {
  const next = {
    ...db,
    meta: {
      ...db.meta,
      updatedAt: Date.now(),
    },
  };

  const key = `${SLOT_PREFIX}${next.meta.slotId}.v1`;

  // Progressive trimming: try the full save first, then strip increasingly
  // heavy data until the write succeeds or there is nothing left to cut.
  const attempts = [
    next,
    trimDatabase(next, MAX_STORED_IMAGES, MAX_SNAPSHOTS),
    trimDatabase(next, 1, 0),
    trimDatabase(next, 0, 0),
  ];

  for (const attempt of attempts) {
    try {
      await writeSlotJson(key, JSON.stringify(attempt));
      return;
    } catch (error) {
      if (attempt === attempts[attempts.length - 1]) {
        throw error;
      }
    }
  }
}

export async function createSlot(slotName: string, input?: SeedInput, settings?: AppDatabase['settings']): Promise<AppDatabase> {
  const slotId = makeId('slot');
  const seeded = seedDatabase(slotId, slotName || 'New story', input);
  // A new story keeps the player's model choices.
  const db = settings ? { ...seeded, settings: { ...seeded.settings, ...settings } } : seeded;
  await saveSlot(db);

  const meta = await loadStorageMeta();
  const nextMeta = {
    activeSlotId: db.meta.slotId,
    slotOrder: [...meta.slotOrder, db.meta.slotId],
  };
  await saveStorageMeta(nextMeta);

  return db;
}

export async function duplicateSlot(sourceSlotId: string, slotName: string): Promise<AppDatabase> {
  const source = await loadSlot(sourceSlotId);
  const slotId = makeId('slot');
  const copy: AppDatabase = {
    ...source,
    meta: {
      ...source.meta,
      slotId,
      slotName: slotName || `${source.meta.slotName} copy`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    snapshots: [],
  };

  await saveSlot(copy);

  const meta = await loadStorageMeta();
  await saveStorageMeta({
    activeSlotId: slotId,
    slotOrder: [...meta.slotOrder, slotId],
  });

  return copy;
}

export async function deleteSlot(slotId: string) {
  const meta = await loadStorageMeta();
  const slotOrder = meta.slotOrder.filter((id) => id !== slotId);

  await removeSlotJson(`${SLOT_PREFIX}${slotId}.v1`);

  if (slotOrder.length === 0) {
    const fresh = seedDatabase(slotId, DEFAULT_SLOT_NAME);
    await saveSlot(fresh);
    await saveStorageMeta({
      activeSlotId: slotId,
      slotOrder: [slotId],
    });
    return;
  }

  const activeSlotId =
    meta.activeSlotId === slotId ? slotOrder[slotOrder.length - 1] : meta.activeSlotId;

  await saveStorageMeta({
    activeSlotId,
    slotOrder,
  });
}

export async function renameSlot(slotId: string, slotName: string) {
  const db = await loadSlot(slotId);
  const next = {
    ...db,
    meta: {
      ...db.meta,
      slotName,
    },
  };
  await saveSlot(next);
  return next;
}

export async function switchSlot(slotId: string) {
  const meta = await loadStorageMeta();

  if (!meta.slotOrder.includes(slotId)) {
    return null;
  }

  await saveStorageMeta({
    ...meta,
    activeSlotId: slotId,
  });

  return loadSlot(slotId);
}

export async function listSlots(): Promise<AppDatabase[]> {
  const meta = await loadStorageMeta();
  const slots = await Promise.all(meta.slotOrder.map((id) => loadSlot(id)));
  return slots;
}

export async function loadActiveSlot(): Promise<AppDatabase> {
  const meta = await loadStorageMeta();
  return loadSlot(meta.activeSlotId);
}

export async function loadApiKey(): Promise<string> {
  return (await AsyncStorage.getItem(API_KEY_KEY)) ?? '';
}

export async function saveApiKey(key: string) {
  const trimmed = key.trim();

  if (trimmed) {
    await AsyncStorage.setItem(API_KEY_KEY, trimmed);
    return;
  }

  await AsyncStorage.removeItem(API_KEY_KEY);
}

export function exportDatabase(db: AppDatabase) {
  const exportable = {
    ...db,
    snapshots: [],
  };

  return JSON.stringify(exportable, null, 2);
}

export async function importDatabase(
  json: string,
  slotName?: string
): Promise<AppDatabase> {
  const parsed = JSON.parse(json) as AppDatabase;

  if (!parsed || parsed.schemaVersion !== 1) {
    throw new Error(`This save file is not a valid ${APP_NAME} story database.`);
  }

  const slotId = makeId('slot');
  const normalized = normalizeDatabase(parsed);
  const imported: AppDatabase = {
    ...normalized,
    meta: {
      ...normalized.meta,
      slotId,
      slotName: slotName?.trim() || `${normalized.meta.slotName} import`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    snapshots: [],
  };

  await saveSlot(imported);

  const meta = await loadStorageMeta();
  await saveStorageMeta({
    activeSlotId: slotId,
    slotOrder: [...meta.slotOrder, slotId],
  });

  return imported;
}

/** The intimacy profile, folding in the old romanceAccessibility / canonDevotion / orientation. */
function normalizeEntityIntimacy(entity: EntityRecord): Partial<EntityRecord> {
  const raw = entity as EntityRecord & Record<string, unknown>;
  const { romanceAccessibility: _a, canonDevotion: _d, orientation: _o, ...rest } = raw;
  void rest;
  const intimacy =
    entity.type !== 'character' || isPlayerEntity(entity) ? undefined : normalizeIntimacy(entity.intimacy) ?? intimacyFromLegacy(raw);
  return { intimacy, romanceAccessibility: undefined, canonDevotion: undefined, orientation: undefined } as Partial<EntityRecord>;
}

export function normalizeDatabase(db: AppDatabase): AppDatabase {
  const normalized: AppDatabase = {
    schemaVersion: 1,
    content: normalizeContentProfile((db as Partial<AppDatabase>).content),
    meta: db.meta ?? {
      slotId: makeId('slot'),
      slotName: DEFAULT_SLOT_NAME,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    settings: {
      ...DEFAULT_SETTINGS,
      ...(db.settings ?? {}),
      contextMessages: DEFAULT_SETTINGS.contextMessages,
      retrievalLimit: DEFAULT_SETTINGS.retrievalLimit,
      autoSummarizeThreshold: DEFAULT_SETTINGS.autoSummarizeThreshold,
      temperature: DEFAULT_SETTINGS.temperature,
      maxTokens: DEFAULT_SETTINGS.maxTokens,
      worldTimeline: true,
      promptTokenBudget: normalizePromptBudget(db.settings?.promptTokenBudget),
    },
    rawLog: Array.isArray(db.rawLog)
      ? db.rawLog.map((entry) =>
          entry.kind === 'story' && entry.role === 'assistant' && entry.content
            ? { ...entry, content: stripNarrationJson(entry.content) }
            : entry
        )
      : [],
    entities: Array.isArray(db.entities)
      ? db.entities.map((entity) => ({
          ...entity,
          mood: entity.mood ?? (entity.type === 'character' ? 'Unknown' : undefined),
          appearance: entity.appearance ?? (entity.type === 'character' ? 'Unknown' : undefined),
          gender: entity.type === 'character' ? (entity.gender ?? 'unknown') : undefined,
          // Nobody's heart is decided by gender: it comes from the entity
          // (written or tracked). Older saves' romance fields fold in here.
          ...normalizeEntityIntimacy(entity),
        }))
      : [],
    events: Array.isArray(db.events) ? db.events : [],
    eventEntities: Array.isArray(db.eventEntities) ? db.eventEntities : [],
    bonds: Array.isArray(db.bonds)
      ? db.bonds.map((bond) => ({
          ...bond,
          relationship:
            bond.relationship ??
            (bond.affinity >= 7
              ? 'close'
              : bond.affinity >= 4
                ? 'friendly'
                : bond.affinity <= -4
                  ? 'rejected'
                  : 'stranger'),
          attraction: bond.attraction ?? 'none',
          theirFeelings: { affinity: bond.affinity, note: bond.note ?? '' },
          yourFeelings: bond.yourFeelings ?? { affinity: bond.affinity, note: '' },
        }))
      : [],
    facts: Array.isArray(db.facts) ? db.facts : [],
    threads: Array.isArray(db.threads) ? db.threads : [],
    loreEntries: Array.isArray(db.loreEntries) ? db.loreEntries : [],
    // The same summary saved twice (a job that ran twice) is kept once.
    summaries: Array.isArray(db.summaries)
      ? db.summaries.filter(
          (summary, index, all) =>
            all.findIndex(
              (other) => other.level === summary.level && other.text.trim() === summary.text.trim()
            ) === index
        )
      : [],
    world: normalizeWorld(db.world),
    state: normalizeState(db.state, normalizeWorld(db.world)),
    indices: db.indices ?? emptyIndex(),
    snapshots: Array.isArray(db.snapshots) ? db.snapshots : [],
    portraits: Array.isArray(db.portraits)
      ? db.portraits.filter((portrait) => portrait && typeof portrait.image === 'string')
      : [],
    characterPortraits: Array.isArray(db.characterPortraits)
      ? db.characterPortraits.filter(
          (portrait) => portrait && typeof portrait.image === 'string' && typeof portrait.entityId === 'string'
        )
      : [],
    characterFaces: Array.isArray(db.characterFaces)
      ? db.characterFaces.filter(
          (face) => face && typeof face.image === 'string' && typeof face.entityId === 'string'
        )
      : [],
    memoryJobs: Array.isArray(db.memoryJobs)
      ? db.memoryJobs.filter((job) => job && typeof job.turnLogId === 'string')
      : [],
  };

  const withDeaths = ensureNames(repairUnmetLabels(normalizeDeaths(normalizeFactKnowers(normalized))));
  withDeaths.indices = buildIndices(withDeaths);

  return withDeaths;
}

/** who_knows holds entity ids (plus group tags); names from older saves and the seed are converted. */
function normalizeFactKnowers(db: AppDatabase): AppDatabase {
  const ids = new Set(db.entities.map((entity) => entity.id));

  if (db.facts.every((fact) => fact.whoKnows.every((name) => ids.has(name)))) {
    return db;
  }

  return {
    ...db,
    facts: db.facts.map((fact) => {
      if (fact.whoKnows.every((name) => ids.has(name))) {
        return fact;
      }

      const knowers = knowersOf(db, fact.whoKnows);
      const groups = [...new Set([...(fact.whoKnowsGroups ?? []), ...knowers.groups])];

      return { ...fact, whoKnows: knowers.ids, ...(groups.length > 0 ? { whoKnowsGroups: groups } : {}) };
    }),
  };
}

export function buildIndices(db: AppDatabase): MemoryIndex {
  const index = emptyIndex();

  for (const event of db.events) {
    // Year-month-day, padded so keys sort ("13-10-01").
    const dateKey = `${String(event.inStoryDate.year).padStart(2, '0')}-${String(event.inStoryDate.month).padStart(2, '0')}-${String(event.inStoryDate.day).padStart(2, '0')}`;

    pushIndex(index.eventsByDate, dateKey, event.id);

    for (const tag of event.tags) {
      pushIndex(index.eventsByTag, tag.toLowerCase(), event.id);
    }

    for (const link of db.eventEntities) {
      if (link.eventId !== event.id) {
        continue;
      }

      pushIndex(index.eventsByEntity, link.entityId, event.id);
    }
  }

  for (const fact of db.facts) {
    if (fact.subjectEntityId) {
      pushIndex(index.factsBySubject, fact.subjectEntityId, fact.id);
    }
  }

  for (const thread of db.threads) {
    pushIndex(index.threadsByStatus, thread.status, thread.id);
  }

  for (const lore of db.loreEntries) {
    for (const keyword of lore.keywords) {
      pushIndex(index.loreByKeyword, keyword.toLowerCase(), lore.id);
    }
  }

  return index;
}

function normalizeState(state: AppDatabase['state'] | undefined, world: AppDatabase['world']): AppDatabase['state'] {
  const seeded = seedDatabase(makeId('slot'), DEFAULT_SLOT_NAME).state;

  if (!state) {
    return seeded;
  }

  return {
    player: normalizeCharacter(state.player, seeded.player),
    mood: state.mood ?? seeded.mood,
    worldDescription: state.worldDescription ?? seeded.worldDescription,
    inventory: Array.isArray(state.inventory) ? state.inventory : seeded.inventory,
    location: state.location ?? seeded.location,
    locationKind:
      state.locationKind === 'settlement' ||
      state.locationKind === 'road' ||
      state.locationKind === 'wilderness' ||
      state.locationKind === 'structure'
        ? state.locationKind
        : undefined,
    inStoryDate: normalizeDate(state.inStoryDate, seeded.inStoryDate),
    turnsWithoutTimeChange:
      typeof state.turnsWithoutTimeChange === 'number'
        ? Math.max(0, Math.round(state.turnsWithoutTimeChange))
        : 0,
    worldPoint: typeof state.worldPoint === 'string' ? state.worldPoint : seeded.worldPoint,
    timelineProgress:
      state.timelineProgress && Array.isArray(state.timelineProgress.completed)
        ? {
            version: state.timelineProgress.version ?? TIMELINE_VERSION,
            baselineDate: state.timelineProgress.baselineDate,
            completed: state.timelineProgress.completed.filter(Boolean),
            active: Array.isArray(state.timelineProgress.active) ? state.timelineProgress.active.filter(Boolean) : [],
            engaged: Array.isArray(state.timelineProgress.engaged) ? state.timelineProgress.engaged.filter(Boolean) : [],
            expired: Array.isArray(state.timelineProgress.expired) ? state.timelineProgress.expired.filter(Boolean) : [],
            heard:
              state.timelineProgress.heard && typeof state.timelineProgress.heard === 'object'
                ? state.timelineProgress.heard
                : {},
          }
        : {
            version: TIMELINE_VERSION,
            baselineDate: state.inStoryDate,
            completed: [],
            active: [],
            engaged: [],
            expired: [],
            heard: {},
          },
    chapter: state.chapter ?? seeded.chapter,
    chapterTitle: typeof state.chapterTitle === 'string' ? state.chapterTitle : undefined,
    chapterStart: state.chapterStart,
    chapters: Array.isArray(state.chapters) ? state.chapters : [],
    sceneSeq: typeof state.sceneSeq === 'number' ? state.sceneSeq : undefined,
    sceneClosed: state.sceneClosed === true,
    scene: state.scene ?? seeded.scene,
    scenePace:
      state.scenePace === 'combat' ||
      state.scenePace === 'chase' ||
      state.scenePace === 'conversation' ||
      state.scenePace === 'travel' ||
      state.scenePace === 'downtime'
        ? state.scenePace
        : undefined,
    sceneCast: Array.isArray(state.sceneCast)
      ? state.sceneCast.filter(Boolean).slice(0, 6)
      : [],
    sceneMode: normalizeSceneMode(state.sceneMode),
    post: normalizePost(state.post),
    reputation: normalizeReputation(state.reputation),
    yearly: normalizeYearly(state.yearly),
    renown: normalizeRenown(state.renown),
    consequences: normalizeConsequences(state.consequences),
    weather: normalizeWeather(state.weather),
    travelLog: normalizeTravelLog({ world }, state.travelLog, state.location ?? seeded.location, normalizeDate(state.inStoryDate, seeded.inStoryDate)),
    flashbacks: normalizeFlashbacks(state.flashbacks, world.flashbacks),
    safehouses: normalizeSafehouses(state.safehouses),
    purse: normalizePurse(state.purse, normalizeCharacter(state.player, seeded.player).money),
  };
}

function normalizeWeather(value: unknown): WeatherLock | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const lock = value as WeatherLock;

  if (!WEATHER_CONDITIONS.includes(lock.condition) || typeof lock.region !== 'string' || !lock.since) return undefined;

  return {
    region: lock.region,
    condition: lock.condition,
    ...(typeof lock.text === 'string' ? { text: lock.text.slice(0, 60) } : {}),
    since: lock.since,
    ...(typeof lock.sceneSeq === 'number' ? { sceneSeq: lock.sceneSeq } : {}),
    source: lock.source === 'story' ? 'story' : 'world',
  };
}

function pushIndex(record: Record<string, string[]>, key: string, value: string) {
  if (!record[key]) {
    record[key] = [];
  }

  if (!record[key].includes(value)) {
    record[key].push(value);
  }
}
