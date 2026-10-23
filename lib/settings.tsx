import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
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
import { Platform } from 'react-native';

export type NarrationStyle = 'cinematic' | 'balanced' | 'literary';
export type ImageFrequency = 'off' | 'choice' | 'action';
export type ImageStyle = 'cinematic' | 'ink' | 'painterly';

export type KanSettings = {
  modelId: string;
  modelName: string;
  narrationStyle: NarrationStyle;
  imageFrequency: ImageFrequency;
  imageStyle: ImageStyle;
};

type SettingsContextValue = {
  apiKey: string;
  hydrated: boolean;
  settings: KanSettings;
  updateSettings: (patch: Partial<KanSettings>) => Promise<void>;
  saveApiKey: (key: string) => Promise<void>;
  resetSettings: () => Promise<void>;
};

const SETTINGS_KEY = 'kan.settings.v1';
const API_KEY_KEY = 'kan.openrouter.api-key';

export const DEFAULT_SETTINGS: KanSettings = {
  modelId: 'deepseek/deepseek-v4.1-flash-1017',
  modelName: 'DeepSeek V4.1 Flash',
  narrationStyle: 'cinematic',
  imageFrequency: 'off',
  imageStyle: 'cinematic',
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

async function readApiKey() {
  if (Platform.OS === 'web') {
    return AsyncStorage.getItem(API_KEY_KEY);
  }

  try {
    return await SecureStore.getItemAsync(API_KEY_KEY);
  } catch {
    return null;
  }
}

async function writeApiKey(value: string) {
  if (Platform.OS === 'web') {
    await AsyncStorage.setItem(API_KEY_KEY, value);
    return;
  }

  await SecureStore.setItemAsync(API_KEY_KEY, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function deleteApiKey() {
  if (Platform.OS === 'web') {
    await AsyncStorage.removeItem(API_KEY_KEY);
    return;
  }

  try {
    await SecureStore.deleteItemAsync(API_KEY_KEY);
  } catch {
  }
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<KanSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [hydrated, setHydrated] = useState(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;

    Promise.all([AsyncStorage.getItem(SETTINGS_KEY), readApiKey()])
      .then(([storedSettings, storedKey]) => {
        if (!active) {
          return;
        }

        if (storedSettings) {
          try {
            const parsed = JSON.parse(storedSettings) as Partial<KanSettings>;
            const next = { ...DEFAULT_SETTINGS, ...parsed };
            settingsRef.current = next;
            setSettings(next);
          } catch {
          }
        }

        setApiKey(storedKey ?? '');
      })
      .finally(() => {
        if (active) {
          setHydrated(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<KanSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  }, []);

  const saveApiKey = useCallback(async (key: string) => {
    const trimmed = key.trim();

    if (trimmed) {
      await writeApiKey(trimmed);
    } else {
      await deleteApiKey();
    }

    setApiKey(trimmed);
  }, []);

  const resetSettings = useCallback(async () => {
    await Promise.all([
      AsyncStorage.removeItem(SETTINGS_KEY),
      deleteApiKey(),
    ]);
    settingsRef.current = DEFAULT_SETTINGS;
    setSettings(DEFAULT_SETTINGS);
    setApiKey('');
  }, []);

  const value = useMemo(
    () => ({
      apiKey,
      hydrated,
      settings,
      updateSettings,
      saveApiKey,
      resetSettings,
    }),
    [apiKey, hydrated, resetSettings, saveApiKey, settings, updateSettings]
  );

  return (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);

  if (!context) {
    throw new Error('useSettings must be used inside a SettingsProvider');
  }

  return context;
}
