// Whether the first-launch setup (app/setup.tsx) has been finished or skipped.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from './brand';

export async function setupDone(): Promise<boolean> {
  return (await AsyncStorage.getItem(STORAGE_KEYS.setupDone).catch(() => null)) === '1';
}

export async function markSetupDone() {
  await AsyncStorage.setItem(STORAGE_KEYS.setupDone, '1').catch(() => undefined);
}
