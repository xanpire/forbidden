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
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import {
  applyPurse,
  formatChange,
  formatPurseLine,
  normalizePurse,
  purseOf,
  currencyOf,
  readAmount,
} from '../lib/rpg/money';
import { NARRATION_SYSTEM, buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase } from '../lib/rpg/types';

function save(): AppDatabase {
  let db = normalizeDatabase(seedDatabase('slot_money', 'Money'));

  for (let index = 0; index < 3; index += 1) {
    db = appendStoryMessage(db, 'user', `*You walk on.* ${index}`, null, 0, 0);
    db = appendStoryMessage(db, 'assistant', `The road goes on. ${index}`, null, 0, 0);
  }

  return {
    ...db,
    state: { ...db.state, location: 'a café in Old Town', locationKind: 'settlement', scenePace: 'conversation' },
  };
}

function play(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>, mark?: (db: AppDatabase) => AppDatabase) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  if (mark) next = mark(next);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const converted = convertStateBlock(block).diff;
  const diff = converted ? resolveCharacterRefs(next, converted) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

const START = 600;
const minutes = { time: { elapsed: 5, unit: 'minutes', clock_time: null }, scene_pace: 'conversation' };

describe('the purse', () => {
  test('a new story starts with the money the player wrote; an old save gets it as a guess', () => {
    const db = save();
    expect(purseOf(db).amount).toBe(START);
    expect(purseOf(db).estimatedStart).toBeUndefined();

    const old = normalizeDatabase({ ...seedDatabase('slot_old', 'Old'), state: { ...seedDatabase('slot_old', 'Old').state, purse: undefined } });
    expect(purseOf(old).amount).toBe(START);
    expect(purseOf(old).estimatedStart).toBe(true);
    expect(normalizePurse({ amount: -50, history: [{ bad: true }] })).toEqual({ amount: 0, history: [] });
  });

  test('the schema, the narrator and the tracker all carry it', () => {
    const props = (TURN_STATE_SCHEMA as { properties: Record<string, unknown>; required: string[] }).properties;
    expect(props.money).toBeDefined();
    expect(props.money_counted).toBeDefined();
    expect((TURN_STATE_SCHEMA as { required: string[] }).required).toContain('money');

    const db = save();
    const narrator = buildNarrationPrompt(db, '*You order a coffee.*').messages.map((m) => m.content).join('\n');
    expect(narrator).toContain('Purse: $600');
    expect(narrator).toContain('Prices: coffee 4-6');
    expect(NARRATION_SYSTEM).toContain('PRICES');

    const tracker = buildExtractionPrompt(db, '*You order a coffee.*', 'The coffee is bitter.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('money_counted');
    expect(tracker).toContain('Purse: $600');
    expect(tracker).toContain('PRICES (dollars)');
  });

  test('the tracker’s amounts are read whatever their form', () => {
    expect(readAmount(-500)).toBe(-500);
    expect(readAmount('-1,200 dollars')).toBe(-1200);
    expect(readAmount('−300')).toBe(-300);
    expect(readAmount('+2000')).toBe(2000);
    expect(readAmount('a lot')).toBeNull();

    const diff = convertStateBlock({ money: [{ amount: '-600', reason: 'coffee and cake' }, { amount: 0, reason: 'nothing' }], money_counted: null }).diff!;
    expect(diff.money).toEqual([{ amount: -600, reason: 'coffee and cake' }]);
    expect(diff.moneyCounted).toBeUndefined();
  });

  test('paying, being paid, and the history newest last', () => {
    let db = play(save(), '*You pay for the coffee.*', 'You set five dollars on the counter.', { ...minutes, money: [{ amount: -5, reason: 'coffee at the café' }], money_counted: null });
    expect(purseOf(db).amount).toBe(595);

    db = play(db, '"My share."', 'Mara counts out your cut: $1,200.', { ...minutes, money: [{ amount: 1200, reason: "Your cut of the night's takings" }], money_counted: null });
    expect(purseOf(db).amount).toBe(1795);
    expect(purseOf(db).history.map((entry) => entry.reason)).toEqual(['Coffee at the café', "Your cut of the night's takings"]);
    expect(formatChange(-400, currencyOf(db))).toBe('−$400');
    expect(formatChange(50000)).toBe('+50,000 money');
  });

  test('the player never pays more than they have, and an empty purse says so', () => {
    const db = play(save(), '*You buy the car.*', 'You hand over everything you have.', { ...minutes, money: [{ amount: -90000, reason: 'a car' }], money_counted: null });
    expect(purseOf(db).amount).toBe(0);
    expect(purseOf(db).history.at(-1)?.change).toBe(-START);
    expect(formatPurseLine(db)).toContain('empty');
    expect(applyPurse(db, [{ amount: -10, reason: 'more' }])).toBe(db);
  });

  test('a total the prose states sets the count and clears the guess', () => {
    const old = { ...save(), state: { ...save().state, purse: { amount: START, history: [], estimatedStart: true } } };
    const db = play(old, '*You count your cash.*', 'You count it twice: $412.', { ...minutes, money: [], money_counted: 412 });
    expect(purseOf(db).amount).toBe(412);
    expect(purseOf(db).estimatedStart).toBeUndefined();
    expect(purseOf(db).history.at(-1)).toMatchObject({ change: 412 - START, counted: true });
  });
});
