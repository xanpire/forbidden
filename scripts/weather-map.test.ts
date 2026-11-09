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

import { advanceSeconds, shiftDate } from '../lib/rpg/calendar';
import { startCompanion } from '../lib/rpg/companions';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { currentRegion } from '../lib/rpg/geography';
import { parseImageAction } from '../lib/rpg/image';
import { appendStoryMessage } from '../lib/rpg/log';
import { knownWhereabouts, normalizeTravelLog, placeIdOf, placeVisits, recordTravel, travelEstimate } from '../lib/rpg/mapData';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { captionOf, eraOfDate, placeAt, scrapbook, STORY_ERA } from '../lib/rpg/scrapbook';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase, CalendarDate, ClimateType, EntityRecord } from '../lib/rpg/types';
import { applyWeather, conditionFromText, currentWeather, formatWeatherLine, seasonLabel, seasonOf, weatherAt } from '../lib/rpg/weather';

const seed = () => normalizeDatabase(seedDatabase('slot_weather', 'Weather'));
const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const update = (db: AppDatabase, name: string, change: Partial<EntityRecord>): AppDatabase => ({
  ...db,
  entities: db.entities.map((entity) => (entity.name === name ? { ...entity, ...change } : entity)),
});
const at = (db: AppDatabase, change: Partial<AppDatabase['state']>): AppDatabase => ({ ...db, state: { ...db.state, ...change } });
const narratorText = (db: AppDatabase, input = '*You wait.*') => buildNarrationPrompt(db, input).messages.map((message) => message.content).join('\n');
const weatherLine = (db: AppDatabase) => narratorText(db).split('\n').find((line) => line.startsWith('WEATHER')) ?? '';
/** Outside on the street, so the weather shows. */
const outside = (db: AppDatabase) => at(db, { location: 'Harbour Market, Old Town', locationKind: 'settlement' });

function play(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const diff = resolveCharacterRefs(next, convertStateBlock(block).diff);
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

/** Every six hours across a year in one climate. */
function yearOf(climate: ClimateType) {
  const days: { date: CalendarDate; condition: string }[] = [];
  let date: CalendarDate = { year: 2026, month: 1, day: 1, hour: 3, minute: 0 };
  for (let index = 0; index < 365 * 4; index += 1) {
    days.push({ date, condition: weatherAt('slot', 'region', climate, date) });
    date = advanceSeconds(date, 6 * 3600);
  }
  return days;
}

describe('seasons', () => {
  test('real seasons from the calendar, named the way the climate would', () => {
    expect(seasonOf(1)).toBe('winter');
    expect(seasonOf(4)).toBe('spring');
    expect(seasonOf(7)).toBe('summer');
    expect(seasonOf(10)).toBe('autumn');
    expect(seasonLabel('temperate', { year: 2026, month: 12, day: 10, hour: 9, minute: 0 })).toBe('early winter');
    expect(seasonLabel('monsoon', { year: 2026, month: 7, day: 10, hour: 9, minute: 0 })).toContain('monsoon');
  });
});

describe('weather', () => {
  test('the same save, place and hour always give the same weather', () => {
    const date: CalendarDate = { year: 2026, month: 3, day: 12, hour: 14, minute: 0 };
    expect(weatherAt('a', 'old-town', 'coastal', date)).toBe(weatherAt('a', 'old-town', 'coastal', date));
  });

  test('a rainy climate rarely dries out; tundra snows in winter; the desert never snows', () => {
    const rain = yearOf('rainy');
    expect(rain.filter((entry) => ['drizzle', 'rain', 'downpour', 'storm', 'fog', 'sleet'].includes(entry.condition)).length / rain.length).toBeGreaterThan(0.8);
    const winter = yearOf('tundra').filter((entry) => seasonOf(entry.date.month) === 'winter');
    expect(winter.filter((entry) => entry.condition === 'snow' || entry.condition === 'blizzard').length / winter.length).toBeGreaterThan(0.5);
    expect(yearOf('desert').some((entry) => ['snow', 'blizzard', 'sleet'].includes(entry.condition))).toBe(false);
  });

  test('spells last: the sky does not flip every few hours', () => {
    const year = yearOf('temperate');
    expect(year.filter((entry, index) => index > 0 && entry.condition !== year[index - 1].condition).length).toBeLessThan(365);
  });

  test("a scene keeps its weather; a new scene gets the world's", () => {
    const held = applyWeather(outside(seed()), undefined);
    expect(held.state.weather?.source).toBe('world');
    const forced = at(held, { weather: { ...held.state.weather!, condition: 'fog' } });
    const later = at(forced, { inStoryDate: advanceSeconds(forced.state.inStoryDate, 5 * 3600) });
    expect(currentWeather(later).condition).toBe('fog');
    const next = at(later, { sceneSeq: (later.state.sceneSeq ?? 0) + 1 });
    expect(currentWeather(next).condition).toBe(weatherAt(next.meta.slotId, 'old-town', 'coastal', next.state.inStoryDate));
  });

  test('the story can change the weather, and it holds a while', () => {
    expect(conditionFromText('the rain stops')).toBe('cloudy');
    expect(conditionFromText('snow begins to fall')).toBe('snow');
    expect(conditionFromText('thunder rolls in')).toBe('storm');
    expect(conditionFromText('the fog lifts')).toBe('clear');
    expect(conditionFromText(null)).toBeNull();

    const db = play(outside(seed()), '*You keep walking.*', 'Thunder cracks overhead and the sky opens.', {
      weather: 'a thunderstorm breaks', scene_pace: 'travel', time: { elapsed: 2, unit: 'minutes', clock_time: null },
    });
    expect(db.state.weather?.source).toBe('story');
    expect(db.state.weather?.condition).toBe('storm');
    expect(weatherLine(db)).toContain('as the story has it');
    const gone = at(db, { sceneSeq: (db.state.sceneSeq ?? 0) + 1, inStoryDate: advanceSeconds(db.state.inStoryDate, 9 * 3600) });
    expect(currentWeather(gone).source).toBe('world');
  });

  test('the narrator gets one short line; indoors the weather is outside; a no-weather region has none', () => {
    const base = applyWeather(outside(seed()), undefined);
    const rain = at(base, { weather: { ...base.state.weather!, condition: 'rain' } });
    const line = weatherLine(rain);
    expect(line).toContain('Old Town');
    expect(line).toMatch(/autumn/);
    expect(line.length).toBeLessThan(420);
    expect(formatWeatherLine(rain, 'fight')).toContain('In this fight');
    expect(formatWeatherLine(at(rain, { locationKind: 'structure', location: 'a cellar in Old Town' }), 'normal')).toContain('outside');

    const underground = { ...rain, world: { ...rain.world, regions: rain.world.regions.map((region) => (region.id === 'old-town' ? { ...region, climate: 'none' as const } : region)) } };
    expect(formatWeatherLine(underground, 'normal')).toBe('');
  });

  test('the state tracker sees the weather and can change it; old saves load without it', () => {
    const db = seed();
    expect(buildExtractionPrompt(db, 'x', 'y').messages[1].content).toContain('WEATHER NOW');
    expect((TURN_STATE_SCHEMA as { properties: Record<string, unknown> }).properties.weather).toBeTruthy();
    expect(convertStateBlock({ weather: 'Snow starts falling' }).diff.weather).toBe('Snow starts falling');
    const old = normalizeDatabase({ ...db, state: { ...db.state, weather: undefined, travelLog: undefined } } as AppDatabase);
    expect(old.state.weather).toBeUndefined();
    expect(old.state.travelLog?.length).toBe(1);
  });
});

describe('places and your road', () => {
  test('locations find the places the player wrote', () => {
    const db = seed();
    expect(placeIdOf(db, 'the back booth at The Anchor')).toBe('the-anchor');
    expect(placeIdOf(db, 'Harbour Market at noon')).toBe('harbour-market');
    expect(placeIdOf(db, 'a cave in the hills')).toBeNull();
  });

  test('your road: each new place once, with its region', () => {
    let db = seed();
    expect(db.state.travelLog?.[0].region).toBe('old-town');
    db = play(db, '*You drive up the hill.*', 'Twenty minutes up the Coast Road.', {
      location: 'Coast Road', location_kind: 'road', scene_pace: 'travel', time: { elapsed: 20, unit: 'minutes', clock_time: null },
    });
    expect(db.state.travelLog?.at(-1)).toMatchObject({ place: 'Coast Road', region: 'northgate', placeId: 'coast-road' });
    db = play(db, '*You pull over.*', 'A lay-by under the trees.', {
      location: 'a lay-by under the trees', location_kind: 'road', scene_pace: 'downtime', time: { elapsed: 5, unit: 'minutes', clock_time: null },
    });
    expect(currentRegion(db)).toBe('northgate');
    const count = db.state.travelLog!.length;
    expect(recordTravel(db).state.travelLog!.length).toBe(count);
  });

  test('visits are counted per place', () => {
    const date: CalendarDate = { year: 2026, month: 2, day: 1, hour: 9, minute: 0 };
    const base = seed();
    const db = at(base, {
      travelLog: normalizeTravelLog(base, [
        { place: 'The Anchor', region: 'old-town', placeId: 'the-anchor', date },
        { place: 'Harbour Market', region: 'old-town', placeId: 'harbour-market', date: shiftDate(date, 1) },
        { place: 'The Anchor', region: 'old-town', placeId: 'the-anchor', date: shiftDate(date, 2) },
      ], 'x', date),
    });
    expect(placeVisits(db).get('the-anchor')?.count).toBe(2);
    expect(placeVisits(db).get('harbour-market')?.count).toBe(1);
  });

  test('travel times from where you are, slower in bad weather', () => {
    const base = applyWeather(outside(seed()), undefined);
    const clear = at(base, { weather: { ...base.state.weather!, condition: 'clear' } });
    const storm = at(base, { weather: { ...base.state.weather!, condition: 'storm' } });
    expect(travelEstimate(clear, 'northgate')?.days).toBe(0.2);
    expect(travelEstimate(storm, 'northgate')!.inWeather).toBeGreaterThan(travelEstimate(storm, 'northgate')!.days);
    expect(travelEstimate(clear, null)).toBeNull();
  });

  test('where people are, as far as you know, not the truth', () => {
    let db = seed();
    db = update(db, 'Mara Vance', { whereabouts: 'visiting her mother in Northgate' });
    db = update(db, 'Daniel Okafor', { whereabouts: undefined, lastSeenAt: 'The Docks', lastSeen: db.state.inStoryDate });
    const known = knownWhereabouts(db);
    expect(known.find((entry) => entry.entity.name === 'Mara Vance')).toMatchObject({ region: 'northgate', basis: 'told' });
    expect(known.find((entry) => entry.entity.name === 'Daniel Okafor')?.basis).toBe('seen');
    // Unmet people and the known dead never show.
    expect(known.some((entry) => entry.entity.name === 'Jonah Pike')).toBe(false);
    expect(known.some((entry) => entry.entity.name === 'Theo Marsh')).toBe(false);
    const together = startCompanion(db, person(db, 'Mara Vance').id, 'heading north');
    expect(knownWhereabouts(together).find((entry) => entry.entity.name === 'Mara Vance')?.basis).toBe('with-you');
  });
});

describe('the scrapbook', () => {
  test("eras follow the world's timeline, or one era when it names none", () => {
    const db = seed();
    expect(eraOfDate(db, db.state.inStoryDate)).toBe(STORY_ERA);
    const eras = { ...db, world: { ...db.world, timeline: [{ id: 'e1', era: 'Before the strike', title: 'x', description: '', from: { year: 2026, month: 1 }, facts: [] }, { id: 'e2', era: 'After the strike', title: 'y', description: '', from: { year: 2026, month: 10, day: 5 }, facts: [] }] } };
    expect(eraOfDate(eras, { year: 2026, month: 10, day: 2, hour: 9, minute: 0 })).toBe('Before the strike');
    expect(eraOfDate(eras, { year: 2026, month: 11, day: 2, hour: 9, minute: 0 })).toBe('After the strike');
  });

  test('photos by chapter, with captions in your words', () => {
    let db = seed();
    db = appendStoryMessage(db, 'assistant', 'Alex stands at the end of the pier. Gulls wheel overhead.', null, 0, 0);
    const first = db.rawLog.at(-1)!.id;
    db = {
      ...db,
      rawLog: db.rawLog.map((entry) =>
        entry.id === first
          ? { ...entry, image: 'img:one', imageMeta: { prompt: '', action: 'Alex throws a stone into the harbour.', caption: 'You throw a stone into the harbour.', references: [], model: 'x', createdAt: 0 } }
          : entry
      ),
    };
    const later = at(db, { inStoryDate: { year: 2026, month: 12, day: 1, hour: 9, minute: 0 }, chapter: 4, chapterTitle: 'Winter books' });
    let next = appendStoryMessage(later, 'assistant', '*The office is silent.* You read the ledger again.', null, 0, 0);
    const second = next.rawLog.at(-1)!.id;
    next = { ...next, rawLog: next.rawLog.map((entry) => (entry.id === second ? { ...entry, image: 'img:two' } : entry)) };

    const book = scrapbook(next);
    const chapters = book.flatMap((era) => era.chapters);
    expect(chapters[0].photos[0].caption).toBe('You throw a stone into the harbour.');
    expect(chapters[0].photos[0].age).toBe(29);
    expect(chapters.at(-1)!.chapter).toBe(4);
    expect(chapters.at(-1)!.title).toBe('Winter books');
    expect(chapters.at(-1)!.photos[0].caption).toBe('The office is silent.');
  });

  test('captions: the one written in your words, else the narration, never the action line', () => {
    const meta = { prompt: '', action: 'Alex draws the knife and steps forward.', references: [], model: 'x', createdAt: 0 };
    expect(captionOf({ content: 'You draw the knife. Rain falls.', imageMeta: meta })).toBe('You draw the knife.');
    expect(captionOf({ content: 'You draw the knife.', imageMeta: { ...meta, caption: 'You draw the knife in the rain.' } })).toBe('You draw the knife in the rain.');
    expect(parseImageAction('ACTION: Alex draws the knife.\nCAPTION: You draw the knife.')).toEqual({ action: 'Alex draws the knife.', caption: 'You draw the knife.' });
    const db = seed();
    expect(placeAt(db, shiftDate(db.state.inStoryDate, -5))).toBeNull();
  });
});

describe('prompt size', () => {
  test('the weather adds one short line, and nothing else new', () => {
    const lines = narratorText(outside(seed())).split('\n').filter((line) => line.startsWith('WEATHER'));
    expect(lines.length).toBe(1);
    expect(lines[0].length).toBeLessThan(420);
  });
});
