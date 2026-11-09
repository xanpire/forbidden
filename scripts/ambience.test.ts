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
  INDOOR_BEDS,
  ambienceInputOf,
  ambienceMix,
  currentAmbience,
  describeAmbience,
  isIndoors,
  type AmbienceInput,
} from '../lib/rpg/ambience';
import { normalizeDatabase } from '../lib/rpg/db';
import { seedDatabase } from '../lib/rpg/seed';
import type { AppDatabase } from '../lib/rpg/types';

const base: AmbienceInput = {
  condition: 'clear',
  period: 'morning',
  hour: 10,
  season: 'spring',
  climate: 'temperate',
  kind: 'wilderness',
  place: 'Forest north of the city',
  fight: false,
};
const mix = (change: Partial<AmbienceInput>) => ambienceMix({ ...base, ...change });
const seed = () => normalizeDatabase(seedDatabase('slot_ambience', 'Ambience'));
const at = (db: AppDatabase, change: Partial<AppDatabase['state']>): AppDatabase => ({ ...db, state: { ...db.state, ...change } });

describe('ambience: what you hear where you are', () => {
  test('a forest by day has birds and a little wind; at night, insects', () => {
    const day = mix({});
    expect(day.beds['forest-day']).toBeGreaterThan(0.5);
    expect(day.beds['wind-light']).toBeGreaterThan(0);
    expect(day.beds['forest-night']).toBeUndefined();

    const night = mix({ period: 'night', hour: 23 });
    expect(night.beds['forest-day']).toBeUndefined();
    expect(night.beds['forest-night']).toBeGreaterThan(0.5);
  });

  test('dawn birds are louder; winter birds are fewer and winter nights have no insects', () => {
    expect(mix({ hour: 6 }).beds['forest-day']!).toBeGreaterThan(mix({ hour: 10 }).beds['forest-day']!);
    expect(mix({ season: 'winter' }).beds['forest-day']!).toBeLessThan(mix({}).beds['forest-day']!);
    expect(mix({ season: 'winter', period: 'night', hour: 2 }).beds['forest-night']!).toBeLessThan(0.3);
  });

  test('summer afternoons in a warm climate bring cicadas; a cold one does not', () => {
    expect(mix({ season: 'summer', period: 'afternoon', hour: 14 }).beds.cicadas).toBeGreaterThan(0);
    expect(mix({ season: 'summer', period: 'afternoon', hour: 14, climate: 'continental' }).beds.cicadas).toBeUndefined();
  });

  test('rain outside is rain; inside it is rain on the roof, and outside sounds are muffled', () => {
    const out = mix({ condition: 'rain' });
    expect(out.beds['rain-light']).toBeGreaterThan(0);
    expect(out.beds['rain-heavy']).toBeGreaterThan(0);
    expect(out.indoors).toBe(false);

    const inside = mix({ condition: 'rain', kind: 'structure', place: 'A rented room at a roadside inn' });
    expect(inside.indoors).toBe(true);
    expect(inside.beds['rain-roof']).toBeGreaterThan(0.5);
    expect(inside.beds['rain-light']).toBeUndefined();
    expect(inside.beds.room).toBeGreaterThan(0);
    expect(inside.beds.murmur).toBeGreaterThan(0);
  });

  test('heavy rain silences the birds; a storm adds thunder and wind', () => {
    expect(mix({ condition: 'downpour' }).beds['forest-day']).toBeUndefined();
    const storm = mix({ condition: 'storm' });
    expect(storm.beds.storm).toBe(1);
    expect(storm.beds['wind-strong']).toBeGreaterThan(0);
  });

  test('snow is hushed; a blizzard howls; sand storms roar', () => {
    expect(mix({ condition: 'snow', climate: 'tundra' }).beds['snow-quiet']).toBe(1);
    const blizzard = mix({ condition: 'blizzard', climate: 'tundra' });
    expect(blizzard.beds['wind-strong']).toBe(1);
    expect(blizzard.beds['wind-high']).toBeGreaterThan(0);
    expect(mix({ condition: 'sandstorm', climate: 'desert', place: 'Open desert' }).beds['wind-strong']).toBe(1);
  });

  test('high places get the wind over the heights', () => {
    expect(mix({ place: 'Mountain pass into the north' }).beds['wind-high']).toBeGreaterThan(0);
  });

  test('water comes from the words of the place', () => {
    expect(mix({ place: 'The river path', kind: 'road' }).beds.river).toBeGreaterThan(0.5);
    expect(mix({ place: 'Below the waterfall' }).beds.waterfall).toBeGreaterThan(0.7);
    expect(mix({ place: 'A stream in the woods' }).beds.stream).toBeGreaterThan(0);
    expect(mix({ place: 'Rocky coast', kind: 'road' }).beds.sea).toBeGreaterThan(0.5);
    // A coastal region: the sea is never far outside.
    expect(mix({ place: 'Market square', kind: 'settlement', climate: 'coastal' }).beds.sea).toBeGreaterThan(0);
    // A plain forest has no water.
    const dry = mix({});
    expect(dry.beds.river ?? dry.beds.stream ?? dry.beds.sea ?? dry.beds.waterfall).toBeUndefined();
  });

  test('villages bustle by day, markets more, and go quiet at night', () => {
    const street = mix({ kind: 'settlement', place: 'Old Town, a side street' });
    const market = mix({ kind: 'settlement', place: 'Market street, Old Town' });
    const night = mix({ kind: 'settlement', place: 'Old Town, a side street', period: 'night', hour: 1 });
    expect(street.beds.village).toBeGreaterThan(0.4);
    expect(market.beds.village!).toBeGreaterThan(street.beds.village!);
    expect(night.beds.village!).toBeLessThan(0.2);
  });

  test('a hearth or a campfire crackles; a cave drips', () => {
    expect(mix({ place: 'By the campfire', period: 'evening', hour: 19 }).beds.fire).toBeGreaterThan(0);
    expect(mix({ kind: 'structure', place: 'Farmhouse kitchen by the hearth' }).beds.fire).toBeGreaterThan(0);
    const cave = mix({ kind: 'structure', place: 'A cave behind the falls' });
    expect(cave.indoors).toBe(true);
    expect(cave.beds.cave).toBeGreaterThan(0);
    expect(cave.beds['forest-day']).toBeUndefined();
  });

  test('a fight is marked so the player can lower the ambience; nothing is added', () => {
    const calm = mix({});
    const fight = mix({ fight: true });
    expect(fight.fight).toBe(true);
    expect(fight.beds).toEqual(calm.beds);
    expect(fight.key).not.toBe(calm.key);
  });

  test('indoor beds are the only ones that skip the outdoor muffle', () => {
    expect([...INDOOR_BEDS].sort()).toEqual(['bar', 'cave', 'engine', 'fire', 'hum', 'murmur', 'office', 'rain-roof', 'rain-window', 'room']);
    expect(isIndoors({ kind: 'structure', place: 'Shrine courtyard' })).toBe(false);
    expect(isIndoors({ kind: 'settlement', place: 'The noodle bar, inside' })).toBe(true);
  });

  test('every level stays between 0 and 1, and the key only changes with the mix', () => {
    const conditions = ['clear', 'cloudy', 'drizzle', 'rain', 'downpour', 'storm', 'fog', 'snow', 'blizzard', 'sleet', 'wind', 'sandstorm', 'heat', 'humid'] as const;
    for (const condition of conditions) {
      for (const kind of ['settlement', 'road', 'wilderness', 'structure'] as const) {
        const result = mix({ condition, kind, place: 'Forest river by the coast, near a mountain camp' });
        for (const level of Object.values(result.beds)) {
          expect(level).toBeGreaterThan(0);
          expect(level).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(mix({}).key).toBe(mix({}).key);
  });

  test('describes what is playing in a few words', () => {
    expect(describeAmbience(mix({ condition: 'rain', kind: 'structure', place: 'Inn room' }))).toMatch(/^Rain on the roof/);
    expect(describeAmbience(mix({ condition: 'downpour', place: 'Open road', kind: 'road' }))).not.toMatch(/^Rain, /);
    expect(describeAmbience({ beds: {}, indoors: false, fight: false, key: '' })).toBe('Silence');
  });
});

describe('ambience: read from the save', () => {
  test('uses the scene weather, the place, the clock and the scene mode', () => {
    let db = at(seed(), {
      location: 'The river path, Old Town',
      locationKind: 'road',
      inStoryDate: { ...seed().state.inStoryDate, hour: 9, minute: 0 },
    });
    db = at(db, { weather: { region: 'old-town', condition: 'storm', since: db.state.inStoryDate, source: 'story', text: 'thunder' } });
    const input = ambienceInputOf(db);
    expect(input.condition).toBe('storm');
    expect(input.climate).toBe('coastal');
    expect(input.period).toBe('morning');
    const result = currentAmbience(db);
    expect(result.beds.storm).toBe(1);
    expect(result.beds.river).toBeGreaterThan(0);

    const fighting = at(db, { sceneMode: { current: 'fight', exchangeStreak: 0, partners: [] } });
    expect(currentAmbience(fighting).fight).toBe(true);
  });

  test('a new save has something to hear', () => {
    expect(Object.keys(currentAmbience(seed()).beds).length).toBeGreaterThan(0);
  });
});


describe('modern places (session 7)', () => {
  test('a city street, a bar, a flat, a car, an office and rain on the windows', () => {
    expect(mix({ kind: 'settlement', place: 'Kell Street', era: 'present' }).beds.traffic).toBeGreaterThan(0);
    expect(mix({ kind: 'settlement', place: 'Kell Street', era: 'past' }).beds.traffic).toBeUndefined();
    expect(mix({ kind: 'structure', place: 'The Anchor bar', era: 'present' }).beds.bar).toBeGreaterThan(0);
    expect(mix({ kind: 'structure', place: 'Your flat on Kell Street', era: 'present' }).beds.hum).toBeGreaterThan(0);
    expect(mix({ kind: 'road', place: 'In the back seat of a taxi', era: 'present' }).beds.engine).toBeGreaterThan(0);
    expect(mix({ kind: 'structure', place: 'Marlow & Finch offices', era: 'future' }).beds.office).toBeGreaterThan(0);
    const wet = mix({ kind: 'structure', place: 'Your flat on Kell Street', era: 'present', condition: 'rain' });
    expect(wet.beds['rain-window']).toBeGreaterThan(0);
  });
});
