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
  STARTING_RYO,
  applyPurse,
  formatChange,
  formatPurseLine,
  normalizePurse,
  purseOf,
  readRyo,
} from '../lib/rpg/money';
import { NARRATION_SYSTEM, buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from '../lib/rpg/seed';
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
    state: { ...db.state, location: 'a teahouse in Tanzaku Quarters', locationKind: 'settlement', scenePace: 'conversation' },
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

const minutes = { time: { elapsed: 5, unit: 'minutes', clock_time: null }, scene_pace: 'conversation' };

describe('the purse', () => {
  test('a new story starts with the pouch Kan left with; an old save gets it as a guess', () => {
    const db = save();
    expect(purseOf(db).ryo).toBe(STARTING_RYO);
    expect(purseOf(db).estimatedStart).toBeUndefined();

    const old = normalizeDatabase({ ...seedDatabase('slot_old', 'Old'), state: { ...seedDatabase('slot_old', 'Old').state, purse: undefined } });
    expect(purseOf(old).ryo).toBe(STARTING_RYO);
    expect(purseOf(old).estimatedStart).toBe(true);
    expect(normalizePurse({ ryo: -50, history: [{ bad: true }] })).toEqual({ ryo: 0, history: [] });
  });

  test('the schema, the narrator and the tracker all carry it', () => {
    const props = (TURN_STATE_SCHEMA as { properties: Record<string, unknown>; required: string[] }).properties;
    expect(props.money).toBeDefined();
    expect(props.money_counted).toBeDefined();
    expect((TURN_STATE_SCHEMA as { required: string[] }).required).toContain('money');

    const db = save();
    const narrator = buildNarrationPrompt(db, '*You order tea.*').messages.map((m) => m.content).join('\n');
    expect(narrator).toContain('Purse: 4,000 ryō');
    expect(NARRATION_SYSTEM).toContain('PRICES (ryō)');

    const tracker = buildExtractionPrompt(db, '*You order tea.*', 'The tea is bitter.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('money_counted');
    expect(tracker).toContain('Purse: 4,000 ryō');
  });

  test('the tracker’s amounts are read whatever their form', () => {
    expect(readRyo(-500)).toBe(-500);
    expect(readRyo('-1,200 ryō')).toBe(-1200);
    expect(readRyo('−300')).toBe(-300);
    expect(readRyo('+2000')).toBe(2000);
    expect(readRyo('a lot')).toBeNull();

    const diff = convertStateBlock({ money: [{ amount: '-600', reason: 'tea and rice' }, { amount: 0, reason: 'nothing' }], money_counted: null }).diff!;
    expect(diff.money).toEqual([{ amount: -600, reason: 'tea and rice' }]);
    expect(diff.moneyCounted).toBeUndefined();
  });

  test('paying, being paid, and the history newest last', () => {
    let db = play(save(), '*You pay for the tea.*', 'You set 400 ryō on the counter.', { ...minutes, money: [{ amount: -400, reason: 'tea at the teahouse' }], money_counted: null });
    expect(purseOf(db).ryo).toBe(3600);

    db = play(db, '"My share."', 'Kakuzu counts out your cut: 50,000 ryō.', { ...minutes, money: [{ amount: 50000, reason: "Kakuzu's cut of the bounty" }], money_counted: null });
    expect(purseOf(db).ryo).toBe(53600);
    expect(purseOf(db).history.map((entry) => entry.reason)).toEqual(['Tea at the teahouse', "Kakuzu's cut of the bounty"]);
    expect(formatChange(-400)).toBe('−400 ryō');
    expect(formatChange(50000)).toBe('+50,000 ryō');
  });

  test('Kan never pays more than he has, and an empty purse says so', () => {
    const db = play(save(), '*You buy the sword.*', 'You hand over everything you have.', { ...minutes, money: [{ amount: -90000, reason: 'a sword' }], money_counted: null });
    expect(purseOf(db).ryo).toBe(0);
    expect(purseOf(db).history.at(-1)?.change).toBe(-STARTING_RYO);
    expect(formatPurseLine(db)).toContain('empty');
    expect(applyPurse(db, [{ amount: -10, reason: 'more' }])).toBe(db);
  });

  test('a total the prose states sets the count and clears the guess', () => {
    const old = { ...save(), state: { ...save().state, purse: { ryo: STARTING_RYO, history: [], estimatedStart: true } } };
    const db = play(old, '*You count your coins.*', 'You count it twice: 12,350 ryō.', { ...minutes, money: [], money_counted: 12350 });
    expect(purseOf(db).ryo).toBe(12350);
    expect(purseOf(db).estimatedStart).toBeUndefined();
    expect(purseOf(db).history.at(-1)).toMatchObject({ change: 12350 - STARTING_RYO, counted: true });
  });

  test('a turn inside a flashback never touches the present purse', () => {
    const db = play(
      save(),
      '*You buy dango.*',
      'Your mother pays 200 ryō for dango.',
      { ...minutes, money: [{ amount: -200, reason: 'dango' }], money_counted: null },
      (next) => ({
        ...next,
        rawLog: next.rawLog.map((entry, index) =>
          index >= next.rawLog.length - 2 ? { ...entry, flashback: { id: 'nine-tails-night', date: next.state.inStoryDate } } : entry
        ),
      })
    );
    expect(purseOf(db).ryo).toBe(STARTING_RYO);
  });
});
