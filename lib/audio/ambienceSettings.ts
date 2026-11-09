// Ambience settings live on the device, not in a save: they belong to this
// phone, the same for every story.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

import { STORAGE_KEYS } from '../brand';

export type AmbienceSettings = {
  enabled: boolean;
  /** 0–1. */
  volume: number;
};

export const DEFAULT_AMBIENCE: AmbienceSettings = { enabled: true, volume: 0.6 };

const KEY = STORAGE_KEYS.ambience;

let current: AmbienceSettings = DEFAULT_AMBIENCE;
let loaded = false;
const listeners = new Set<(settings: AmbienceSettings) => void>();

function normalize(value: unknown): AmbienceSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<AmbienceSettings>;
  const volume = typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : DEFAULT_AMBIENCE.volume;
  return { enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_AMBIENCE.enabled, volume };
}

async function load() {
  if (loaded) return current;
  loaded = true;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) current = normalize(JSON.parse(stored));
  } catch {
    // Keep the defaults.
  }
  for (const listener of listeners) listener(current);
  return current;
}

export function setAmbienceSettings(change: Partial<AmbienceSettings>) {
  current = normalize({ ...current, ...change });
  for (const listener of listeners) listener(current);
  void AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
}

export function useAmbienceSettings(): AmbienceSettings {
  const [settings, setSettings] = useState(current);

  useEffect(() => {
    listeners.add(setSettings);
    void load().then(setSettings);
    return () => {
      listeners.delete(setSettings);
    };
  }, []);

  return settings;
}
