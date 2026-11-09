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

import {
  AMBIENCE_BEDS,
  INDOOR_BEDS,
  ambienceInputOf,
  ambienceMix,
  currentAmbience,
  describeAmbience,
  isIndoors,
  type AmbienceInput,
} from '../lib/rpg/ambience';
import { normalizeDatabase } from '../lib/rpg/db';
import { seedDatabase } from './fixtures/seed';
import type { AppDatabase } from '../lib/rpg/types';

const base: AmbienceInput = {
  condition: 'clear',
  period: 'evening',
  hour: 19,
  season: 'autumn',
  kind: 'structure',
  place: 'Your apartment',
  recent: '',
  hushed: false,
};
const mix = (change: Partial<AmbienceInput>) => ambienceMix({ ...base, ...change });
const seed = () => normalizeDatabase(seedDatabase('slot_ambience', 'Ambience'));
const at = (db: AppDatabase, change: Partial<AppDatabase['state']>): AppDatabase => ({ ...db, state: { ...db.state, ...change } });

describe('ambience: present-day sounds', () => {
  test('a quiet apartment hums, with the city faint through the glass', () => {
    const home = mix({});
    expect(home.indoors).toBe(true);
    expect(home.beds.apartment).toBeGreaterThan(0);
    expect(home.beds.traffic).toBeLessThan(0.3);
    expect(home.beds.birds).toBeUndefined();
  });

  test('rain is heard on the windows from inside, and as rain outside', () => {
    const inside = mix({ condition: 'rain' });
    expect(inside.beds['rain-window']).toBeGreaterThan(0.5);
    expect(inside.beds['rain-light']).toBeUndefined();
    const outside = mix({ condition: 'downpour', kind: 'settlement', place: 'Elm Street' });
    expect(outside.beds['rain-heavy']).toBeGreaterThan(0);
    expect(outside.beds['rain-window']).toBeUndefined();
  });

  test('a street has people and traffic, busier by day, quiet late at night', () => {
    const street = mix({ kind: 'settlement', place: 'Elm Street', period: 'afternoon', hour: 15 });
    const late = mix({ kind: 'settlement', place: 'Elm Street', period: 'night', hour: 3 });
    expect(street.beds.street).toBeGreaterThan(0.4);
    expect(street.beds.traffic).toBeGreaterThan(0.4);
    expect(late.beds.traffic!).toBeLessThan(street.beds.traffic!);
    expect(late.beds.street!).toBeLessThan(street.beds.street!);
  });

  test('a busy bar, a café crowd, an office and a taxi', () => {
    expect(mix({ place: 'The Anchor bar' }).beds.bar).toBeGreaterThan(0.5);
    expect(mix({ place: 'A corner cafe' }).beds.crowd).toBeGreaterThan(0);
    expect(mix({ place: 'The offices downtown', period: 'morning', hour: 10 }).beds.office).toBeGreaterThan(0.5);
    const taxi = mix({ kind: 'road', place: 'In the back seat of a taxi', condition: 'rain' });
    expect(taxi.beds.engine).toBeGreaterThan(0);
    expect(taxi.beds['rain-window']).toBeGreaterThan(0);
    expect(taxi.beds.apartment).toBeUndefined();
  });

  test('a TV on and the shower running come from the scene', () => {
    expect(mix({ recent: 'The TV mutters a late-night film while she curls up beside you.' }).beds.tv).toBeGreaterThan(0);
    expect(mix({ place: 'Your bathroom', recent: 'The shower runs hot and the mirror fogs.' }).beds.shower).toBeGreaterThan(0);
    expect(mix({}).beds.tv).toBeUndefined();
    expect(mix({}).beds.shower).toBeUndefined();
  });

  test('a park has birds by day, fewer in winter, none in a storm', () => {
    const park = mix({ kind: 'wilderness', place: 'A bench in the park', period: 'morning', hour: 10 });
    expect(park.indoors).toBe(false);
    expect(park.beds.birds).toBeGreaterThan(0.4);
    expect(mix({ kind: 'wilderness', place: 'A bench in the park', period: 'morning', hour: 10, season: 'winter' }).beds.birds!).toBeLessThan(park.beds.birds!);
    expect(mix({ kind: 'wilderness', place: 'A bench in the park', period: 'morning', hour: 10, condition: 'storm' }).beds.birds).toBeUndefined();
  });

  test('the beach has the sea; a fireplace crackles; snow is hushed', () => {
    expect(mix({ kind: 'wilderness', place: 'The beach at dusk' }).beds.sea).toBeGreaterThan(0.5);
    expect(mix({ place: 'The cabin living room, by the fireplace' }).beds.fire).toBeGreaterThan(0);
    expect(mix({ kind: 'settlement', place: 'Elm Street', condition: 'snow' }).beds['snow-quiet']).toBe(1);
  });

  test('no wilderness sounds are left', () => {
    for (const bed of ['forest-day', 'forest-night', 'cicadas', 'stream', 'river', 'waterfall', 'cave', 'wind-high', 'village']) {
      expect((AMBIENCE_BEDS as readonly string[]).includes(bed)).toBe(false);
    }
  });

  test('an intimate scene is marked so the player can lower the ambience; nothing is added', () => {
    const calm = mix({});
    const hushed = mix({ hushed: true });
    expect(hushed.hushed).toBe(true);
    expect(hushed.beds).toEqual(calm.beds);
    expect(hushed.key).not.toBe(calm.key);
  });

  test('indoor beds are the only ones that skip the outdoor muffle', () => {
    expect([...INDOOR_BEDS].sort()).toEqual(['apartment', 'bar', 'crowd', 'engine', 'fire', 'office', 'rain-window', 'shower', 'tv']);
    expect(isIndoors({ kind: 'structure', place: 'The rooftop' })).toBe(false);
    expect(isIndoors({ kind: 'settlement', place: 'The noodle bar, inside' })).toBe(true);
  });

  test('every level stays between 0 and 1, and the key only changes with the mix', () => {
    const conditions = ['clear', 'cloudy', 'drizzle', 'rain', 'downpour', 'storm', 'fog', 'snow', 'blizzard', 'sleet', 'wind', 'heat', 'humid'] as const;
    for (const condition of conditions) {
      for (const kind of ['settlement', 'road', 'wilderness', 'structure'] as const) {
        const result = mix({ condition, kind, place: 'The bar by the beach, near the park', recent: 'The TV is on. The shower runs.' });
        for (const level of Object.values(result.beds)) {
          expect(level).toBeGreaterThan(0);
          expect(level).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(mix({}).key).toBe(mix({}).key);
  });

  test('describes what is playing in a few words', () => {
    expect(describeAmbience(mix({ condition: 'rain' }))).toMatch(/^Rain on the windows/);
    expect(describeAmbience(mix({ condition: 'downpour', place: 'Elm Street', kind: 'settlement' }))).not.toMatch(/^Rain, /);
    expect(describeAmbience({ beds: {}, indoors: false, hushed: false, key: '' })).toBe('Silence');
  });
});

describe('ambience: read from the save', () => {
  test('uses the scene weather, the place, the clock, the last reply and the scene mode', () => {
    let db = at(seed(), {
      location: 'Your flat on Kell Street',
      locationKind: 'structure',
      inStoryDate: { ...seed().state.inStoryDate, hour: 21, minute: 0 },
    });
    db = at(db, { weather: { condition: 'storm', since: db.state.inStoryDate, source: 'story', text: 'thunder' } });
    db = { ...db, rawLog: [...db.rawLog, { ...db.rawLog[0], id: 'reply', role: 'assistant', kind: 'story', content: 'The TV flickers with the late news.' }] };
    const input = ambienceInputOf(db);
    expect(input.condition).toBe('storm');
    expect(input.period).toBe('night');
    const result = currentAmbience(db);
    expect(result.beds.storm).toBe(1);
    expect(result.beds.tv).toBeGreaterThan(0);

    const intimate = at(db, { sceneMode: { current: 'intimate', exchangeStreak: 0, partners: [] } });
    expect(currentAmbience(intimate).hushed).toBe(true);
  });

  test('a new save has something to hear', () => {
    expect(Object.keys(currentAmbience(seed()).beds).length).toBeGreaterThan(0);
  });
});
