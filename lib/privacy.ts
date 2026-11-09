// Privacy for an adult app on a shared device: a PIN lock on open and when the
// app is hidden, a quick-hide that covers the screen at once, an optional
// neutral name in the browser tab, and notification text that never carries
// story content. This keeps a story away from casual eyes; it is not
// encryption (saves are not encrypted yet; see the plan's "before release").
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext } from 'react';
import { Platform } from 'react-native';

import { APP_NAME, STORAGE_KEYS } from './brand';

export type PrivacySettings = {
  /** Salted hash of the PIN; unset = no lock. */
  pinHash?: string;
  pinSalt?: string;
  /** Show a neutral name ("Notes") in the browser tab and on the lock screen. */
  neutralName: boolean;
};

export const NEUTRAL_NAME = 'Notes';

export const DEFAULT_PRIVACY: PrivacySettings = { neutralName: false };

export async function loadPrivacy(): Promise<PrivacySettings> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.privacy);
    if (!raw) return DEFAULT_PRIVACY;
    const parsed = JSON.parse(raw) as Partial<PrivacySettings>;
    return {
      neutralName: parsed.neutralName === true,
      ...(typeof parsed.pinHash === 'string' && typeof parsed.pinSalt === 'string' ? { pinHash: parsed.pinHash, pinSalt: parsed.pinSalt } : {}),
    };
  } catch {
    return DEFAULT_PRIVACY;
  }
}

export async function savePrivacy(settings: PrivacySettings) {
  await AsyncStorage.setItem(STORAGE_KEYS.privacy, JSON.stringify(settings));
}

/** A PIN is 4–8 digits. */
export function validPin(pin: string) {
  return /^\d{4,8}$/.test(pin);
}

/** A stretched, salted hash of the PIN (FNV-1a rounds): enough for a screen lock, not a vault. */
export function hashPin(pin: string, salt: string): string {
  let hash = 0x811c9dc5;
  let text = `${salt}:${pin}`;
  for (let round = 0; round < 2000; round += 1) {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    text = `${hash.toString(36)}${salt}`;
  }
  return hash.toString(36);
}

export function makeSalt() {
  return Math.random().toString(36).slice(2, 10);
}

export function withPin(settings: PrivacySettings, pin: string | null): PrivacySettings {
  if (!pin) {
    const { pinHash: _h, pinSalt: _s, ...rest } = settings;
    return rest;
  }
  const salt = makeSalt();
  return { ...settings, pinSalt: salt, pinHash: hashPin(pin, salt) };
}

export function checkPin(settings: PrivacySettings, pin: string) {
  return Boolean(settings.pinHash && settings.pinSalt && hashPin(pin, settings.pinSalt) === settings.pinHash);
}

/** The name shown wherever someone else might see it. */
export function shownAppName(settings: Pick<PrivacySettings, 'neutralName'>) {
  return settings.neutralName ? NEUTRAL_NAME : APP_NAME;
}

/** Sets the browser tab title (web only). */
export function setTabTitle(title: string) {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    document.title = title;
  }
}

export type PrivacyContextValue = {
  settings: PrivacySettings;
  update: (settings: PrivacySettings) => Promise<void>;
  /** Cover the screen now (and lock, when a PIN is set). */
  hide: () => void;
};

export const PrivacyContext = createContext<PrivacyContextValue>({
  settings: DEFAULT_PRIVACY,
  update: async () => undefined,
  hide: () => undefined,
});

export function usePrivacy() {
  return useContext(PrivacyContext);
}
