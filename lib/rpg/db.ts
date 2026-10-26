import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_SETTINGS, emptyIndex } from './defaults';
import { makeId } from './id';
import { stripNarrationJson } from './prompt';
import { normalizeJutsuNature } from './jutsu';
import { seedDatabase } from './seed';
import type { AppDatabase, MemoryIndex } from './types';

const META_KEY = 'kan.meta.v1';
const SLOT_PREFIX = 'kan.slot.';
const API_KEY_KEY = 'kan.apiKey.v1';

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
  const existing = await AsyncStorage.getItem(`${SLOT_PREFIX}${slotId}.v1`);

  if (existing) {
    return;
  }

  const db = seedDatabase(slotId, slotName);
  await saveSlot(db);
}

export async function loadSlot(slotId: string): Promise<AppDatabase> {
  const stored = await AsyncStorage.getItem(`${SLOT_PREFIX}${slotId}.v1`);

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

const MAX_STORED_IMAGES = 3;
const MAX_SNAPSHOTS = 1;

function trimDatabase(db: AppDatabase, maxImages: number, maxSnapshots: number): AppDatabase {
  const imageIndexes: number[] = [];

  for (let index = db.rawLog.length - 1; index >= 0; index -= 1) {
    const entry = db.rawLog[index];

    if (entry.image) {
      imageIndexes.push(index);
    }
  }

  const keepImages = new Set(imageIndexes.slice(0, maxImages));

  const rawLog = db.rawLog.map((entry, index) =>
    entry.image && !keepImages.has(index) ? { ...entry, image: null } : entry
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
      await AsyncStorage.setItem(key, JSON.stringify(attempt));
      return;
    } catch (error) {
      if (attempt === attempts[attempts.length - 1]) {
        throw error;
      }
    }
  }
}

export async function createSlot(slotName: string): Promise<AppDatabase> {
  const slotId = makeId('slot');
  const db = seedDatabase(slotId, slotName || 'New story');
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

  await AsyncStorage.removeItem(`${SLOT_PREFIX}${slotId}.v1`);

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
    throw new Error('This save file is not a valid Kan story database.');
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

export function normalizeDatabase(db: AppDatabase): AppDatabase {
  const normalized: AppDatabase = {
    schemaVersion: 1,
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
      canonProgress: db.settings?.canonProgress ?? DEFAULT_SETTINGS.canonProgress,
    },
    rawLog: Array.isArray(db.rawLog)
      ? db.rawLog.map((entry) =>
          entry.kind === 'story' && entry.role === 'assistant' && entry.content
            ? { ...entry, content: stripNarrationJson(entry.content) }
            : entry
        )
      : [],
    jutsuRecords: Array.isArray(db.jutsuRecords)
      ? db.jutsuRecords.map((record) => ({
          ...record,
          chakraNature: normalizeJutsuNature(record.chakraNature),
          effect: record.effect ?? record.description ?? '',
          visual: record.visual ?? '',
          description: record.description ?? '',
        }))
      : [],
    entities: Array.isArray(db.entities)
      ? db.entities.map((entity) => ({
          ...entity,
          mood:
            entity.mood ??
            (entity.type === 'character' ? 'Unknown' : undefined),
          appearance:
            entity.appearance ??
            (entity.type === 'character' ? 'Unknown' : undefined),
          romanceAccessibility:
            entity.type === 'character'
              ? (entity.romanceAccessibility ?? 'winnable')
              : undefined,
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
        }))
      : [],
    facts: Array.isArray(db.facts) ? db.facts : [],
    threads: Array.isArray(db.threads) ? db.threads : [],
    loreEntries: Array.isArray(db.loreEntries) ? db.loreEntries : [],
    summaries: Array.isArray(db.summaries) ? db.summaries : [],
    state: normalizeState(db.state),
    indices: db.indices ?? emptyIndex(),
    snapshots: Array.isArray(db.snapshots) ? db.snapshots : [],
  };

  normalized.indices = buildIndices(normalized);

  return normalized;
}

export function buildIndices(db: AppDatabase): MemoryIndex {
  const index = emptyIndex();

  for (const event of db.events) {
    const dateKey = `${event.inStoryDate.year}-${event.inStoryDate.month}-${event.inStoryDate.day}`;

    pushIndex(index.eventsByTag, dateKey, event.id);

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

function normalizeState(state: AppDatabase['state'] | undefined): AppDatabase['state'] {
  const seeded = seedDatabase(makeId('slot'), DEFAULT_SLOT_NAME).state;

  if (!state) {
    return seeded;
  }

  return {
    player: state.player
      ? {
          ...state.player,
          birthYear: state.player.birthYear ?? seeded.player.birthYear,
        }
      : seeded.player,
    mood: state.mood ?? seeded.mood,
    worldDescription: state.worldDescription ?? seeded.worldDescription,
    jutsu: Array.isArray(state.jutsu) ? state.jutsu : seeded.jutsu,
    inventory: Array.isArray(state.inventory) ? state.inventory : seeded.inventory,
    location: state.location ?? seeded.location,
    inStoryDate: state.inStoryDate ?? seeded.inStoryDate,
    canonPoint: state.canonPoint ?? seeded.canonPoint,
    canonProgress:
      state.canonProgress && Array.isArray(state.canonProgress.completed)
        ? {
            completed: state.canonProgress.completed.filter(Boolean),
            active: Array.isArray(state.canonProgress.active)
              ? state.canonProgress.active.filter(Boolean)
              : [],
            engaged: Array.isArray(state.canonProgress.engaged)
              ? state.canonProgress.engaged.filter(Boolean)
              : [],
          }
        : { completed: [], active: [], engaged: [] },
    chapter: state.chapter ?? seeded.chapter,
    scene: state.scene ?? seeded.scene,
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
