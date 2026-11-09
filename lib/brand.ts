// The app's name and every storage key, in one place so a rename is one edit.

/** The app's name, shown in the UI. */
export const APP_NAME = 'frbddn';

/** Prefix for every AsyncStorage (localStorage) key. */
export const STORAGE_PREFIX = 'frbddn';

/** AsyncStorage keys. */
export const STORAGE_KEYS = {
  meta: `${STORAGE_PREFIX}.meta.v1`,
  slotPrefix: `${STORAGE_PREFIX}.slot.`,
  apiKey: `${STORAGE_PREFIX}.apiKey.v1`,
  ambience: `${STORAGE_PREFIX}.ambience.v1`,
  wizardDraft: `${STORAGE_PREFIX}.wizardDraft.v1`,
  privacy: `${STORAGE_PREFIX}.privacy.v1`,
} as const;

/** IndexedDB database names. */
export const IDB_NAMES = {
  saves: `${STORAGE_PREFIX}-saves`,
  images: `${STORAGE_PREFIX}-images`,
  debug: `${STORAGE_PREFIX}-debug`,
} as const;
