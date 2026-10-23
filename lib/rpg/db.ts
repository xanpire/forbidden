import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_SETTINGS, emptyIndex } from './defaults';
import { makeId } from './id';
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

export async function saveSlot(db: AppDatabase) {
  const next = {
    ...db,
    meta: {
      ...db.meta,
      updatedAt: Date.now(),
    },
  };

  await AsyncStorage.setItem(
    `${SLOT_PREFIX}${next.meta.slotId}.v1`,
    JSON.stringify(next)
  );
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

  if (slotOrder.length === 0) {
    return;
  }

  await AsyncStorage.removeItem(`${SLOT_PREFIX}${slotId}.v1`);

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
    },
    rawLog: Array.isArray(db.rawLog) ? db.rawLog : [],
    entities: Array.isArray(db.entities) ? db.entities : [],
    events: Array.isArray(db.events) ? db.events : [],
    eventEntities: Array.isArray(db.eventEntities) ? db.eventEntities : [],
    bonds: Array.isArray(db.bonds) ? db.bonds : [],
    facts: Array.isArray(db.facts) ? db.facts : [],
    threads: Array.isArray(db.threads) ? db.threads : [],
    loreEntries: Array.isArray(db.loreEntries) ? db.loreEntries : [],
    summaries: Array.isArray(db.summaries) ? db.summaries : [],
    state: db.state ?? seedDatabase(db.meta?.slotId ?? makeId('slot'), DEFAULT_SLOT_NAME).state,
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

function pushIndex(record: Record<string, string[]>, key: string, value: string) {
  if (!record[key]) {
    record[key] = [];
  }

  if (!record[key].includes(value)) {
    record[key].push(value);
  }
}
