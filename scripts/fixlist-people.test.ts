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
import { applyStateStep, CHAPTER_MIN_TURNS } from '../lib/rpg/memoryJobs';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import type { AppDatabase } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_people', 'People'));

function play(db: AppDatabase, narration: string, state: Record<string, unknown> | null): AppDatabase {
  let next = appendStoryMessage(db, 'user', 'I keep going.', null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = state ? convertStateBlock(state).diff : null;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;

  return applyStateStep(next, diff, { turnLogId, userMessage: 'I keep going.', narration }, new Set()).db;
}

const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const bondOf = (db: AppDatabase, name: string) => db.bonds.find((bond) => bond.entityId === person(db, name).id)!;

describe('10. real chapters', () => {
  test('summaries and scene ends never move the chapter; a break needs a real reason and enough story', () => {
    let db = seed();
    expect(db.state.chapter).toBe(1);
    const firstTitle = db.state.chapterTitle;

    // Many scenes ending, and an early chapter title, change nothing.
    db = play(db, 'You leave the bar.', { scene_ended: true, chapter_title: 'Too soon' });
    for (let i = 0; i < CHAPTER_MIN_TURNS; i += 1) {
      db = play(db, `Turn ${i}`, { scene_ended: i % 2 === 0, time: { elapsed: 20, unit: 'minutes', clock_time: null } });
    }
    expect(db.state.chapter).toBe(1);

    db = play(db, 'The hills of Northgate rise above the city.', { chapter_title: 'Up in Northgate', location: 'Northgate, Coast Road' });
    expect(db.state.chapter).toBe(2);
    expect(db.state.chapterTitle).toBe('Up in Northgate');
    expect(db.state.chapters).toEqual([expect.objectContaining({ chapter: 1, title: firstTitle ?? 'Chapter 1' })]);
    expect(db.rawLog.at(-1)?.chapter).toBe(2);

    // Right after a break, even a time skip waits for the minimum.
    db = play(db, 'Three days pass.', { time: { elapsed: 3, unit: 'days', clock_time: null } });
    expect(db.state.chapter).toBe(2);
  });
});

describe('12. threads are not opened twice', () => {
  test('a lowercase copy of a seeded thread updates it; new threads keep their casing and people', () => {
    let db = seed();
    const before = db.threads.length;
    db = play(db, 'You go over the numbers again.', {
      threads: [{ title: 'find out what the missing shipments are', description: 'Three containers a week vanish from the books.', status: 'open', participants: [] }],
    });
    expect(db.threads.length).toBe(before);
    expect(db.threads.find((thread) => thread.title === 'Find out what the missing shipments are')?.description).toBe('Three containers a week vanish from the books.');

    db = play(db, 'Mara asks you to find her missing cousin.', {
      characters_present: ['mara-vance'],
      threads: [{ title: 'find mara’s missing cousin', description: 'Mara wants you to find her cousin.', status: 'open', participants: ['mara-vance'] }],
    });
    const thread = db.threads.at(-1)!;
    expect(thread.title).toBe('Find mara’s missing cousin');
    expect(thread.participantIds).toEqual([person(db, 'Alex Reyes').id, person(db, 'Mara Vance').id]);
    expect(thread.sourceLogId).toBe(db.rawLog.at(-1)?.id);
    expect(thread.sourceEventId).not.toBeNull();
  });
});

describe('13. romance follows who someone is', () => {
  test('no gender is ruled out by the app; new people by who they are drawn to', () => {
    let db = seed();
    expect(person(db, 'Mara Vance').intimacy?.interestedInPlayer).toBe('could-grow');
    expect(person(db, 'Alex Reyes').intimacy).toBeUndefined();

    db = play(db, 'Three strangers share the table.', {
      new_characters: [
        { is_new: true, name: 'Leo Brandt', age: 27, role: 'Barista', personality: null, speech_style: null, appearance: null, gender: 'male', attracted_to: 'men' },
        { is_new: true, name: 'Ines Duarte', age: 25, role: 'Courier', personality: null, speech_style: null, appearance: null, gender: 'female', attracted_to: 'women' },
        { is_new: true, name: 'Rei Kudo', age: 30, role: 'Mechanic', personality: null, speech_style: null, appearance: null, gender: 'female', attracted_to: null },
      ],
    });
    // The player (Alex) is a man.
    expect(person(db, 'Leo Brandt').intimacy?.interestedInPlayer).toBe('could-grow');
    expect(person(db, 'Ines Duarte').intimacy?.interestedInPlayer).toBe('no');
    expect(person(db, 'Rei Kudo').intimacy).toBeUndefined();
  });
});

describe('14. two-sided bonds', () => {
  test('a starting person keeps both sides as the player wrote them', () => {
    const db = seed();
    const mara = bondOf(db, 'Mara Vance');
    expect(mara.relationship).toBe('friendly');
    expect(mara.theirFeelings?.affinity).toBe(4);
    expect(mara.yourFeelings?.affinity).toBe(5);
  });

  test('your inner thoughts move only your side; what they see moves theirs', () => {
    let db = seed();
    db = play(db, 'You decide you cannot trust her with this.', {
      characters_present: ['mara-vance'],
      bonds: [{ character_id: 'mara-vance', affinity_change: null, status: null, note: null, relationship: null, attraction: null, romance_note: null, your_change: -3, your_note: 'You cannot trust her with this.' }],
    });
    const after = bondOf(db, 'Mara Vance');
    expect(after.yourFeelings).toEqual({ affinity: 2, note: 'You cannot trust her with this.' });
    expect(after.theirFeelings?.affinity).toBe(4);
    expect(after.affinity).toBe(4);
    expect(after.relationship).toBe('friendly');
  });
});
