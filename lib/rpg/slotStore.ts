/**
 * Where save slots are stored.
 *
 * localStorage only holds about 5 MB for the whole app, shared by every slot,
 * and a long story with its undo snapshots outgrows that. So on the web each
 * slot's JSON lives in IndexedDB (hundreds of MB), and the small things —
 * slot list, API key — stay in AsyncStorage.
 *
 * Old saves are moved over on first read: the IndexedDB copy is written, then
 * the localStorage copy is removed to free the quota. If IndexedDB cannot be
 * opened (native, some private modes), everything stays in AsyncStorage as
 * before. The choice is made once per session, so reads and writes never
 * split across the two.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { IDB_NAMES } from '../brand';

const DB_NAME = IDB_NAMES.saves;
const STORE = 'slots';

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  void requestPersistentStorage();
  return dbPromise;
}

let persistRequested = false;

/**
 * Asks the browser not to clear the app's data when the device is low on
 * space. Browsers may grant it silently (installed PWAs usually are) or
 * ignore it; either way nothing else depends on the answer.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (persistRequested) {
    return false;
  }

  persistRequested = true;

  try {
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;

    if (!storage?.persist) {
      return false;
    }

    if (storage.persisted && (await storage.persisted())) {
      return true;
    }

    return await storage.persist();
  } catch {
    return false;
  }
}

function idbGet(db: IDBDatabase, key: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () =>
        resolve(typeof request.result === 'string' ? request.result : null);
      request.onerror = () => reject(request.error ?? new Error('Could not read the save.'));
    } catch (error) {
      reject(error);
    }
  });
}

/** Resolves once the write is committed; rejects on quota or other errors. */
function idbWrite(db: IDBDatabase, key: string, value: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);

      if (value === null) {
        store.delete(key);
      } else {
        store.put(value, key);
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Could not write the save.'));
      tx.onabort = () => reject(tx.error ?? new Error('The save was aborted.'));
    } catch (error) {
      reject(error);
    }
  });
}

function updatedAtOf(json: string): number {
  try {
    const parsed = JSON.parse(json) as { meta?: { updatedAt?: unknown } };
    return typeof parsed?.meta?.updatedAt === 'number' ? parsed.meta.updatedAt : 0;
  } catch {
    return -1;
  }
}

/** The stored JSON for a slot key, or null. Moves a localStorage copy into IndexedDB. */
export async function readSlotJson(key: string): Promise<string | null> {
  const db = await openDb();

  if (!db) {
    return AsyncStorage.getItem(key);
  }

  const [stored, legacy] = await Promise.all([
    idbGet(db, key),
    AsyncStorage.getItem(key).catch(() => null),
  ]);

  if (!legacy) {
    return stored;
  }

  // Both exist only mid-migration or after a session that couldn't open
  // IndexedDB; keep whichever was saved last.
  const winner = stored && updatedAtOf(stored) >= updatedAtOf(legacy) ? stored : legacy;

  try {
    if (winner !== stored) {
      await idbWrite(db, key, winner);
    }
    await AsyncStorage.removeItem(key);
  } catch {
    // Leave both in place; the next read tries again.
  }

  return winner;
}

/** Writes a slot's JSON. Rejects if it doesn't fit, so callers can trim and retry. */
export async function writeSlotJson(key: string, json: string): Promise<void> {
  const db = await openDb();

  if (!db) {
    await AsyncStorage.setItem(key, json);
    return;
  }

  await idbWrite(db, key, json);
  // Drop any leftover localStorage copy so it can't shadow this one or eat quota.
  await AsyncStorage.removeItem(key).catch(() => undefined);
}

export async function removeSlotJson(key: string): Promise<void> {
  const db = await openDb();

  if (db) {
    await idbWrite(db, key, null).catch(() => undefined);
  }

  await AsyncStorage.removeItem(key).catch(() => undefined);
}

/** Which backend this session uses (for Settings/debug and tests). */
export async function slotBackend(): Promise<'indexeddb' | 'asyncstorage'> {
  return (await openDb()) ? 'indexeddb' : 'asyncstorage';
}

/** Tests only: forget the opened database so a new environment is picked up. */
export function resetSlotStoreForTests() {
  dbPromise = null;
  persistRequested = false;
}
