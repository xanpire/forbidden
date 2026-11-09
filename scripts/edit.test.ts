// Edit and rewind: a reply edited by hand is read again by the tracker (and
// the first reading is rolled back), and rewinding three turns restores the
// save from three turns ago: memory, bonds, the clock and the phone.
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
import { lastPlayerMessage, rebuildWithEditedReply, rewindTo, rewindableIds } from '../lib/rpg/edit';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { SNAPSHOT_LIMIT, appendStoryMessage, pushSnapshot } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { phoneOf } from '../lib/rpg/phone';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import type { AppDatabase, TurnDiff } from '../lib/rpg/types';
import { seedDatabase } from './fixtures/seed';
import { testSeedInput } from './fixtures/testWorld';

function story(): AppDatabase {
  const input = testSeedInput();
  input.opening = { ...input.opening, location: 'The Anchor', castNames: ['Mara Vance'] };
  return normalizeDatabase(seedDatabase('slot_edit', 'Edit', input));
}

const diffOf = (db: AppDatabase, state: Record<string, unknown>): TurnDiff | null => {
  const reply = convertStateBlock(state).diff;
  return reply ? resolveCharacterRefs(db, reply) : null;
};

/** One turn as game.tsx plays it: a snapshot first, then the two entries, then the state step. */
function play(db: AppDatabase, input: string, narration: string, state: Record<string, unknown>): AppDatabase {
  let next = pushSnapshot(db);
  next = appendStoryMessage(next, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  return applyStateStep(next, diffOf(next, state), { turnLogId, userMessage: input, narration }, new Set()).db;
}

const mara = (db: AppDatabase) => db.entities.find((entity) => entity.name === 'Mara Vance')!;
const maraBond = (db: AppDatabase) => db.bonds.find((bond) => bond.entityId === mara(db).id)!.affinity;
const userEntries = (db: AppDatabase) => db.rawLog.filter((entry) => entry.kind === 'story' && entry.role === 'user');

function fourTurns() {
  const turns: AppDatabase[] = [];
  let db = story();
  db = play(db, '"Rough night?"', 'Mara laughs and pours you one on the house.', {
    characters_present: ['mara-vance'],
    bonds: [{ character_id: 'mara-vance', affinity_change: 2, note: 'you made her laugh', your_change: null, your_note: null, relationship: null, attraction: null, romance_note: null }],
  });
  turns.push(db);
  db = play(db, '"Give me your number."', 'She takes your phone and types it in.', {
    characters_present: ['mara-vance'],
    phone: { numbers_exchanged: ['mara-vance'], texts_received: [], texts_sent: [] },
  });
  turns.push(db);
  db = play(db, 'I walk home.', 'You walk home through the rain.', {
    characters_present: [],
    location: 'Your flat on Kell Street',
    time: { elapsed: 25, unit: 'minutes', clock_time: null },
  });
  turns.push(db);
  db = play(db, 'I sleep.', 'You sleep through the night.', {
    characters_present: [],
    time: { elapsed: 8, unit: 'hours', clock_time: null },
    scene_pace: 'downtime',
  });
  turns.push(db);
  return { db, turns };
}

describe('rewind', () => {
  test('rewinding 3 turns restores the state from 3 turns ago', () => {
    const { db, turns } = fourTurns();
    const threeAgo = turns[0];
    expect(maraBond(db)).toBe(maraBond(threeAgo));
    expect(phoneOf(db).contacts).toHaveLength(1);

    const target = userEntries(db)[1];
    expect(rewindableIds(db).has(target.id)).toBe(true);
    const back = rewindTo(db, target.id)!;

    expect(back.state.inStoryDate).toEqual(threeAgo.state.inStoryDate);
    expect(back.state.location).toBe(threeAgo.state.location);
    expect(back.state.sceneCast).toEqual(threeAgo.state.sceneCast);
    expect(maraBond(back)).toBe(maraBond(threeAgo));
    expect(phoneOf(back).contacts).toHaveLength(0);
    expect(back.rawLog.map((entry) => entry.id)).toEqual(threeAgo.rawLog.map((entry) => entry.id));
    expect(back.events.map((event) => event.id)).toEqual(threeAgo.events.map((event) => event.id));
    expect(back.snapshots).toHaveLength(1);
    // And from there the story goes on.
    expect(lastPlayerMessage(back)?.content).toBe('"Rough night?"');
  });

  test('undo and rewind reach back the last ten turns', () => {
    let db = story();
    for (let index = 0; index < SNAPSHOT_LIMIT + 3; index += 1) {
      db = play(db, `"Line ${index}"`, `Mara answers ${index}.`, { characters_present: ['mara-vance'] });
    }
    expect(SNAPSHOT_LIMIT).toBe(10);
    expect(rewindableIds(db).size).toBe(SNAPSHOT_LIMIT);
    expect(rewindTo(db, userEntries(db)[0].id)).toBeNull();
  });
});

describe('edit', () => {
  test('editing a reply changes what the tracker records, and the first reading is rolled back', () => {
    let db = story();
    db = play(db, '"Rough night?"', 'Mara laughs.', { characters_present: ['mara-vance'] });
    const before = db;
    // The narrator had her kiss you; the tracker read a big jump.
    db = play(db, '"Stay a while?"', 'Mara leans over the bar and kisses you.', {
      characters_present: ['mara-vance'],
      bonds: [{ character_id: 'mara-vance', affinity_change: 3, note: 'she kissed you', your_change: null, your_note: null, relationship: null, attraction: null, romance_note: null }],
    });
    expect(maraBond(db)).toBe(maraBond(before) + 3);

    // You rewrite it: she shakes her head and leaves.
    const rebuilt = rebuildWithEditedReply(db, 'Mara shakes her head, grabs her coat and leaves you with the bill.')!;
    expect(rebuilt.turn.narration).toContain('grabs her coat');
    const reply = rebuilt.db.rawLog[rebuilt.db.rawLog.length - 1];
    expect(reply).toMatchObject({ role: 'assistant', edited: true });
    expect(maraBond(rebuilt.db)).toBe(maraBond(before));

    const reread = applyStateStep(
      rebuilt.db,
      diffOf(rebuilt.db, {
        characters_present: [],
        bonds: [{ character_id: 'mara-vance', affinity_change: -1, note: 'you pushed too fast', your_change: null, your_note: null, relationship: null, attraction: null, romance_note: null }],
      }),
      rebuilt.turn,
      new Set()
    ).db;
    expect(maraBond(reread)).toBe(maraBond(before) - 1);
    expect(reread.state.sceneCast).toEqual([]);
    expect(reread.rawLog.filter((entry) => entry.kind === 'story')).toHaveLength(before.rawLog.filter((entry) => entry.kind === 'story').length + 2);
    // Undo still works after an edit.
    expect(rewindTo(reread, lastPlayerMessage(reread)!.id)!.rawLog.length).toBe(before.rawLog.length);
  });

  test('your last message can be edited; the turn before it is untouched', () => {
    const { db } = fourTurns();
    const last = lastPlayerMessage(db)!;
    expect(last.content).toBe('I sleep.');
    const back = rewindTo(db, last.id)!;
    expect(lastPlayerMessage(back)?.content).toBe('I walk home.');
    expect(back.state.location).toBe('Your flat on Kell Street');
  });
});
