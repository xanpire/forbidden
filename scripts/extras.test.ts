// Session 7 extras: the drawn map, backstory flashbacks, and the PIN lock.
import { describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

import { normalizeDatabase } from '../lib/rpg/db';
import { seedDatabase } from './fixtures/seed';
import { checkPin, shownAppName, validPin, withPin } from '../lib/privacy';

const seed = () => normalizeDatabase(seedDatabase('slot_extras', 'Extras'));
describe('privacy', () => {
  test('a PIN is 4 to 8 digits, stored salted, and checked', () => {
    expect(validPin('1234')).toBe(true);
    expect(validPin('12')).toBe(false);
    expect(validPin('12345678')).toBe(true);
    expect(validPin('abcd')).toBe(false);
    const settings = withPin({ neutralName: false }, '2468');
    expect(settings.pinHash).toBeDefined();
    expect(JSON.stringify(settings)).not.toContain('2468');
    expect(checkPin(settings, '2468')).toBe(true);
    expect(checkPin(settings, '1357')).toBe(false);
    expect(withPin(settings, null).pinHash).toBeUndefined();
    expect(shownAppName({ neutralName: true })).toBe('Notes');
    expect(shownAppName({ neutralName: false })).toBe('frbddn');
  });
});
