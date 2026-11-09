/**
 * Image storage outside the save file.
 *
 * Generated images are large data URIs, so they go into their own IndexedDB
 * store and the save only keeps a short reference
 * like `img:abc123`. Where IndexedDB is unavailable (native, private mode),
 * storeImage falls back to returning the data URI itself, so callers never
 * need a second code path.
 */
import { useEffect, useState } from 'react';

import { IDB_NAMES } from '../brand';
import { makeId } from './id';
import { compressImage, FACE_IMAGE, SCENE_IMAGE, type CompressOptions } from './imageCompress';
import type { AppDatabase } from './types';

const DB_NAME = IDB_NAMES.images;
const STORE = 'images';
const REF_PREFIX = 'img:';

const cache = new Map<string, string>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

export function isImageRef(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith(REF_PREFIX);
}

function isDataUri(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.startsWith('data:');
}

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
        request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }

        try {
          const tx = db.transaction(STORE, mode);
          const request = action(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

function dataUriToBlob(dataUri: string): Blob | null {
  try {
    const [header, body] = dataUri.split(',', 2);
    const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

function blobToDataUri(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Stores an image and returns a reference (or the data URI if storage is
 * unavailable). It is recompressed first (WebP, see imageCompress.ts) and kept
 * as binary data, not text, so it takes about a quarter of the room.
 */
export async function storeImage(dataUri: string, options: CompressOptions = SCENE_IMAGE): Promise<string> {
  if (!isDataUri(dataUri)) {
    return dataUri;
  }

  const compressed = await compressImage(dataUri, options).catch(() => dataUri);
  const key = makeId('pic');
  const blob = typeof Blob !== 'undefined' ? dataUriToBlob(compressed) : null;
  const ok = await run('readwrite', (store) => store.put(blob ?? compressed, key));

  if (ok === null) {
    return compressed;
  }

  const ref = `${REF_PREFIX}${key}`;
  cache.set(ref, compressed);
  return ref;
}

/** Resolves a reference or data URI to something an <Image> can show. */
export async function loadImage(value: string | null | undefined): Promise<string | null> {
  if (!value) {
    return null;
  }

  if (!isImageRef(value)) {
    return value;
  }

  const cached = cache.get(value);

  if (cached) {
    return cached;
  }

  const stored = await run<string | Blob>('readonly', (store) =>
    store.get(value.slice(REF_PREFIX.length))
  );

  // Older images were kept as text; newer ones as binary.
  const uri =
    typeof stored === 'string'
      ? stored
      : typeof Blob !== 'undefined' && stored instanceof Blob
        ? await blobToDataUri(stored)
        : null;

  if (uri) {
    cache.set(value, uri);
    return uri;
  }

  return null;
}

export async function loadImages(values: string[]): Promise<string[]> {
  const resolved = await Promise.all(values.map((value) => loadImage(value)));
  return resolved.filter((value): value is string => Boolean(value));
}

export function useStoredImage(value: string | null | undefined): string | null {
  const immediate = !value ? null : isImageRef(value) ? cache.get(value) ?? null : value;
  const [resolved, setResolved] = useState<string | null>(immediate);

  useEffect(() => {
    let active = true;

    if (immediate || !value) {
      setResolved(immediate);
      return;
    }

    void loadImage(value).then((uri) => {
      if (active) {
        setResolved(uri);
      }
    });

    return () => {
      active = false;
    };
  }, [immediate, value]);

  return resolved;
}

function hasInlineImages(db: AppDatabase) {
  return (
    db.rawLog.some((entry) => isDataUri(entry.image)) ||
    (db.portraits ?? []).some((portrait) => isDataUri(portrait.image)) ||
    (db.characterPortraits ?? []).some((portrait) => isDataUri(portrait.image)) ||
    (db.characterFaces ?? []).some((face) => isDataUri(face.image))
  );
}

async function externalizeOne<T extends { image: string }>(item: T): Promise<T> {
  return isDataUri(item.image) ? { ...item, image: await storeImage(item.image) } : item;
}

async function inlineOne<T extends { image: string }>(item: T): Promise<T> {
  return { ...item, image: (await loadImage(item.image)) ?? '' };
}

/** Moves inline data URIs out of the save into IndexedDB. Returns null if nothing changed. */
export async function externalizeImages(db: AppDatabase): Promise<AppDatabase | null> {
  if (!hasInlineImages(db)) {
    return null;
  }

  const rawLog = await Promise.all(
    db.rawLog.map(async (entry) =>
      isDataUri(entry.image) ? { ...entry, image: await storeImage(entry.image) } : entry
    )
  );
  const portraits = db.portraits
    ? await Promise.all(
        db.portraits.map(async (portrait) =>
          isDataUri(portrait.image)
            ? { ...portrait, image: await storeImage(portrait.image) }
            : portrait
        )
      )
    : db.portraits;
  const characterPortraits = db.characterPortraits
    ? await Promise.all(db.characterPortraits.map(externalizeOne))
    : db.characterPortraits;
  const characterFaces = db.characterFaces
    ? await Promise.all(
        db.characterFaces.map(async (face) =>
          isDataUri(face.image) ? { ...face, image: await storeImage(face.image, FACE_IMAGE) } : face
        )
      )
    : db.characterFaces;

  // Snapshots are kept (undo needs them); they never hold inline images.
  const snapshots = db.snapshots.map((snapshot) => ({
    ...snapshot,
    database: {
      ...snapshot.database,
      rawLog: snapshot.database.rawLog.map((entry) => (isDataUri(entry.image) ? { ...entry, image: null } : entry)),
      portraits: undefined,
      characterPortraits: undefined,
      characterFaces: undefined,
    },
  }));

  return { ...db, rawLog, portraits, characterPortraits, characterFaces, snapshots };
}

/** Inlines referenced images back into data URIs, for export files. */
export async function inlineImages(db: AppDatabase): Promise<AppDatabase> {
  const rawLog = await Promise.all(
    db.rawLog.map(async (entry) =>
      isImageRef(entry.image) ? { ...entry, image: await loadImage(entry.image) } : entry
    )
  );
  const portraits = db.portraits
    ? (
        await Promise.all(
          db.portraits.map(async (portrait) => ({
            ...portrait,
            image: (await loadImage(portrait.image)) ?? '',
          }))
        )
      ).filter((portrait) => portrait.image)
    : db.portraits;
  const characterPortraits = db.characterPortraits
    ? (await Promise.all(db.characterPortraits.map(inlineOne))).filter((item) => item.image)
    : db.characterPortraits;
  const characterFaces = db.characterFaces
    ? (await Promise.all(db.characterFaces.map(inlineOne))).filter((item) => item.image)
    : db.characterFaces;

  return { ...db, rawLog, portraits, characterPortraits, characterFaces };
}
