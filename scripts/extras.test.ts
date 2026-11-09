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
import { approveFlashback, flashbackDraftMessages, parseFlashbackDraft } from '../lib/rpg/flashbackDraft';
import { flashbacksOf } from '../lib/rpg/flashbacks';
import { layoutWorld } from '../lib/rpg/mapLayout';
import { seedDatabase } from './fixtures/seed';
import { checkPin, shownAppName, validPin, withPin } from '../lib/privacy';

const seed = () => normalizeDatabase(seedDatabase('slot_extras', 'Extras'));

describe('the drawn map', () => {
  test('areas sit inside the frame, neighbours closer than strangers, the same every time', () => {
    const db = seed();
    const layout = layoutWorld(db.world);
    expect(layout.regions.map((region) => region.id)).toEqual(['old-town', 'the-docks', 'northgate']);
    for (const point of [...layout.regions, ...layout.places]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(1);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(1);
    }
    expect(layout.roads).toHaveLength(2);
    const at = (id: string) => layout.regions.find((region) => region.id === id)!;
    const dist = (a: string, b: string) => Math.hypot(at(a).x - at(b).x, at(a).y - at(b).y);
    expect(dist('old-town', 'the-docks')).toBeLessThan(dist('the-docks', 'northgate'));
    expect(layoutWorld(db.world)).toEqual(layout);
    expect(layout.places.find((place) => place.id === 'the-anchor')?.regionId).toBe('old-town');
    expect(layoutWorld({ regions: [], places: [] }).regions).toEqual([]);
  });
});

describe('backstory flashbacks', () => {
  test('proposals come from the backstory, are dated before the story, and only approved ones are offered', () => {
    const db = seed();
    const [system, user] = flashbackDraftMessages(db);
    expect(system.content).toContain('Never invent major new facts');
    expect(system.content).toContain('under 18');
    expect(user.content).toContain('Grew up in Old Town above his mother');

    const reply = JSON.stringify({
      memories: [
        { title: 'The last night with Theo', year: 2025, month: 12, day: 20, place: 'The docks', kind: 'road', cast: ['Theo Marsh', 'Someone Invented'], scene: 'You and Theo walk the docks the night before his fall.', fixed: ['Theo is alive in this memory'], hidden: ['How Theo really died'], triggerWords: ['docks', 'Theo'], triggerPeople: ['Theo Marsh'], memoryLine: 'You walked the docks with Theo the night before he fell.' },
        { title: 'Next week', year: 2027, month: 1, day: 1, place: 'Nowhere', kind: 'structure', cast: [], scene: 'Not yet.' },
      ],
    });
    const proposals = parseFlashbackDraft(db, reply);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ title: 'The last night with Theo', cast: ['Theo Marsh'], hidden: ['How Theo really died'], triggers: { words: ['docks', 'theo'], people: ['Theo Marsh'] } });
    expect(proposals[0].date.year).toBe(2025);
    expect(flashbacksOf(db)).toHaveLength(0);

    const approved = approveFlashback(db, proposals[0]);
    expect(flashbacksOf(approved).map((record) => record.title)).toEqual(['The last night with Theo']);
    expect(approveFlashback(approved, proposals[0])).toBe(approved);
    expect(parseFlashbackDraft(db, 'not json')).toEqual([]);
  });
});

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
