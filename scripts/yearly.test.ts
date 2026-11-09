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

import { entityAge } from '../lib/rpg/calendar';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase, CalendarDate, EntityRecord } from '../lib/rpg/types';
import { birthdayHabit, birthdayThisYear, knowsBirthday, todayNotes, upcomingBirthdays, yearlyCandidates, yearlyOffer } from '../lib/rpg/yearly';

const seed = () => normalizeDatabase(seedDatabase('slot_yearly', 'Yearly'));
const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;

function at(date: CalendarDate, extra: Partial<AppDatabase['state']> = {}, base: AppDatabase = seed()): AppDatabase {
  return { ...base, state: { ...base.state, inStoryDate: date, scenePace: 'conversation', sceneCast: [], ...extra } };
}

function play(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const diff = resolveCharacterRefs(next, convertStateBlock(block).diff);
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

describe('birthdays, remembrance days and holidays', () => {
  test('ages follow the birthday the player wrote', () => {
    const db = seed();
    expect(entityAge(db.state.inStoryDate, person(db, 'Mara Vance'))).toBe(31);
    expect(entityAge({ ...db.state.inStoryDate, day: 12 }, person(db, 'Mara Vance'))).toBe(32);
  });

  test("a present friend's birthday is offered once, with the bond rule for the tracker", () => {
    const db = at({ year: 2026, month: 10, day: 12, hour: 18, minute: 0 }, { sceneCast: ['Mara Vance'], location: 'The Anchor' });
    const offer = yearlyOffer(db)!;
    expect(offer.kind).toBe('birthday');
    expect(offer.line).toContain("Mara Vance's birthday today (32 today)");
    expect(buildNarrationPrompt(db, '"Mara."').messages[1].content).toContain('THE DAY');
    expect(buildExtractionPrompt(db, '"Happy birthday."', 'Mara grins.').messages[1].content).toMatch(/mara-vance's birthday.*affinity_change \+1/);

    const next = play(db, '"Happy birthday, Mara."', 'Mara grins and flicks a bottle cap at you.', { characters_present: ['mara-vance'], scene_pace: 'conversation' });
    expect(yearlyOffer(next)?.key).not.toBe(offer.key);
    expect(next.state.yearly?.offered[offer.key]).toBe(2026);
  });

  test("someone whose birthday you don't know can let it slip, and you learn it", () => {
    const base = seed();
    const nadia: EntityRecord = { id: 'entity_nadia', name: 'Nadia Kerr', type: 'character', aliases: ['Nadia'], birthday: { month: 10, day: 3 }, birthYear: 1999, met: true, tags: [] };
    const db = at({ year: 2026, month: 10, day: 3, hour: 18, minute: 0 }, { sceneCast: ['Nadia Kerr'], location: 'Harbour Market' }, { ...base, entities: [...base.entities, nadia] });
    expect(knowsBirthday(db, person(db, 'Nadia Kerr'))).toBe(false);
    // Whether she lets it slip depends on how she treats her birthday.
    const slips = ['announces', 'ritual'].includes(birthdayHabit(person(db, 'Nadia Kerr')).kind);
    expect(yearlyCandidates(db).some((offer) => offer.kind === 'birthday-unknown')).toBe(slips);
    const next = play(db, '"Why the cake?"', '"It\'s my birthday, if you must know."', { characters_present: ['nadia-kerr'], birthdays_learned: ['nadia-kerr'], scene_pace: 'conversation' });
    expect(knowsBirthday(next, person(next, 'Nadia Kerr'))).toBe(true);
  });

  test('the dead are remembered on their birthday; nothing mid-action', () => {
    const db = at({ year: 2026, month: 11, day: 3, hour: 9, minute: 0 }, { location: 'Your flat on Kell Street' });
    expect(yearlyOffer(db)?.kind).toBe('remembrance');
    expect(todayNotes(db)).toContain("Theo Marsh's birthday (remembered)");
    expect(yearlyOffer({ ...db, state: { ...db.state, scenePace: 'action' } })).toBeNull();
  });

  test('real holidays, nothing the world wrote', () => {
    expect(yearlyOffer(at({ year: 2026, month: 12, day: 24, hour: 19, minute: 0 }, { location: 'Harbour Market' }))?.key).toBe('christmas-eve');
    expect(yearlyOffer(at({ year: 2026, month: 10, day: 31, hour: 19, minute: 0 }, { location: 'Coast Road' }))?.key).toBe('halloween');
    expect(yearlyOffer(at({ year: 2026, month: 11, day: 20, hour: 19, minute: 0 }, { location: 'Harbour Market' }))).toBeNull();
  });

  test('upcoming birthdays for the bonds screen, and the leap-day birthday', () => {
    const upcoming = upcomingBirthdays(at({ year: 2026, month: 10, day: 1, hour: 9, minute: 0 }), 30);
    expect(upcoming[0]).toMatchObject({ inDays: 11, turning: 32 });
    expect(upcoming[0].entity.name).toBe('Mara Vance');
    expect(birthdayThisYear({ month: 2, day: 29 }, 2027)).toEqual({ month: 2, day: 28 });
    expect(birthdayThisYear({ month: 2, day: 29 }, 2028)).toEqual({ month: 2, day: 29 });
  });

  test('the schema carries birthdays_learned', () => {
    expect(Object.keys((TURN_STATE_SCHEMA as unknown as { properties: Record<string, unknown> }).properties)).toContain('birthdays_learned');
  });
});
