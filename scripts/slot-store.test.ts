import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';

// In-memory AsyncStorage with an optional size cap, standing in for localStorage.
const local = new Map<string, string>();
let localCap = Infinity;

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => local.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      let used = value.length;
      for (const [k, v] of local) if (k !== key) used += v.length;
      if (used > localCap) throw new Error('QuotaExceededError');
      local.set(key, value);
    },
    removeItem: async (key: string) => {
      local.delete(key);
    },
    getAllKeys: async () => [...local.keys()],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

import { loadSlot, saveSlot } from '../lib/rpg/db';
import { pushSnapshot } from '../lib/rpg/log';
import { seedDatabase } from '../lib/rpg/seed';
import { readSlotJson, resetSlotStoreForTests, slotBackend } from '../lib/rpg/slotStore';
import { STORAGE_KEYS } from '../lib/brand';

const KEY = `${STORAGE_KEYS.slotPrefix}slot_test.v1`;

function bigStory(turns: number) {
  let db = seedDatabase('slot_test', 'Test');
  const line = 'Rain hisses on the river while Mara watches the far bank in silence. '.repeat(40);
  db = {
    ...db,
    rawLog: Array.from({ length: turns }, (_, i) => ({
      ...({} as any),
      id: `log_${i}`,
      turn: i,
      kind: 'story',
      role: i % 2 ? 'assistant' : 'user',
      content: line,
      model: null,
      promptTokens: 0,
      completionTokens: 0,
      chapter: 1,
      scene: 'river',
      inStoryDate: db.state.date,
      createdAt: i,
    })) as any,
  };
  for (let k = 0; k < 3; k += 1) db = pushSnapshot(db, 3);
  return db;
}

describe('slot storage', () => {
  beforeEach(() => {
    local.clear();
    localCap = Infinity;
    (globalThis as any).indexedDB = new IDBFactory();
    resetSlotStoreForTests();
  });

  afterEach(() => {
    delete (globalThis as any).indexedDB;
    resetSlotStoreForTests();
  });

  test('saves go to IndexedDB, not localStorage', async () => {
    expect(await slotBackend()).toBe('indexeddb');
    await saveSlot(seedDatabase('slot_test', 'Test'));
    expect(local.has(KEY)).toBe(false);
    expect((await loadSlot('slot_test')).meta.slotName).toBe('Test');
  });

  test('an old localStorage save is moved over and removed', async () => {
    const old = seedDatabase('slot_test', 'Old story');
    local.set(KEY, JSON.stringify(old));
    const loaded = await loadSlot('slot_test');
    expect(loaded.meta.slotName).toBe('Old story');
    expect(local.has(KEY)).toBe(false);
    expect(await readSlotJson(KEY)).not.toBeNull();
  });

  test('when both copies exist, the newer one wins', async () => {
    const older = seedDatabase('slot_test', 'Older');
    await saveSlot(older);
    const newer = { ...older, meta: { ...older.meta, slotName: 'Newer', updatedAt: Date.now() + 60_000 } };
    local.set(KEY, JSON.stringify(newer));
    expect((await loadSlot('slot_test')).meta.slotName).toBe('Newer');
    expect(local.has(KEY)).toBe(false);
  });

  test('a long story with undo snapshots that would overflow localStorage saves whole', async () => {
    localCap = 5_000_000;
    const db = bigStory(1200);
    const size = JSON.stringify(db).length;
    expect(size).toBeGreaterThan(localCap);
    await saveSlot(db);
    const back = await loadSlot('slot_test');
    expect(back.rawLog.length).toBe(1200);
    expect(back.snapshots.length).toBe(3);
  });

  test('without IndexedDB it falls back to AsyncStorage', async () => {
    delete (globalThis as any).indexedDB;
    resetSlotStoreForTests();
    expect(await slotBackend()).toBe('asyncstorage');
    await saveSlot(seedDatabase('slot_test', 'Native'));
    expect(local.has(KEY)).toBe(true);
    expect((await loadSlot('slot_test')).meta.slotName).toBe('Native');
  });
});
