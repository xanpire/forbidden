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

import { buildIndices, normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { compressImage, dataUriBytes } from '../lib/rpg/imageCompress';
import { appendStoryMessage, pushSnapshot, restoreLastSnapshot, SNAPSHOT_LIMIT } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { formatVarietyBlock, questionEndings, repeatedMotifs } from '../lib/rpg/variety';
import type { AppDatabase } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_story', 'Story'));

function play(db: AppDatabase, narration: string, state: Record<string, unknown> | null): AppDatabase {
  let next = appendStoryMessage(db, 'user', 'I keep going.', null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = state ? convertStateBlock(state).diff : null;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;

  return applyStateStep(next, diff, { turnLogId, userMessage: 'I keep going.', narration }, new Set()).db;
}

const promptText = (db: AppDatabase) => buildNarrationPrompt(db, '*You wait.*').messages.map((m) => m.content).join('\n');
const thread = (db: AppDatabase, title: string) => db.threads.find((item) => item.title === title);

describe('22. indices and undo snapshots', () => {
  test('events are indexed by a padded date, not under tags', () => {
    const db = seed();
    const index = buildIndices(db);
    expect(index.eventsByDate['2026-10-01']).toEqual([db.events[0].id]);
    expect(index.eventsByTag['2026-10-1']).toBeUndefined();
  });

  test('snapshots hold no images, keep the last few, and undo brings images back', () => {
    let db = seed();
    db = { ...db, characterPortraits: [{ id: 'p', entityId: 'e', image: 'img:portrait', signature: { age: 13, expression: 'calm', appearance: '' }, usedFace: false, inStoryDate: db.state.inStoryDate, createdAt: 1 }] };
    for (let i = 0; i < SNAPSHOT_LIMIT + 2; i += 1) {
      db = pushSnapshot(appendStoryMessage(db, 'assistant', `Turn ${i}`, null, 0, 0));
    }
    db = { ...db, rawLog: db.rawLog.map((entry, index) => (index === 0 ? { ...entry, image: 'data:image/png;base64,AAAA' } : entry)) };
    db = pushSnapshot(db);

    expect(db.snapshots).toHaveLength(SNAPSHOT_LIMIT);
    const latest = db.snapshots.at(-1)!.database;
    expect(latest.characterPortraits).toBeUndefined();
    expect(latest.rawLog[0].image).toBeNull();

    const restored = restoreLastSnapshot(db)!;
    expect(restored.characterPortraits?.[0].image).toBe('img:portrait');
    expect(restored.rawLog[0].image).toBe('data:image/png;base64,AAAA');
  });
});

describe('23. narrator variety', () => {
  test('question endings, repeated images and settled decisions are named', () => {
    let db = seed();
    for (const ending of ['Can you keep up, Alex?', 'How do you take it?', 'Will you come?']) {
      db = appendStoryMessage(db, 'assistant', `The smell of diesel hangs over the yard. ${ending}`, null, 0, 0);
    }
    expect(questionEndings(db)).toBe(3);
    expect(repeatedMotifs(db)).toContain('smell of diesel');

    db = { ...db, threads: db.threads.map((item) => (item.title === 'Find out what the missing shipments are' ? { ...item, status: 'resolved' } : item)) };
    const block = formatVarietyBlock(db);
    expect(block).toContain('ended on a question');
    expect(block).toContain('"smell of diesel"');
    expect(block).toContain('never ask again: Find out what the missing shipments are');
    expect(promptText(db)).toContain('VARIETY');
  });
});

describe('24-26. clock, numbers, places, gear', () => {
  test('the narrator gets the exact time, stated figures, where others are, the world and its kit', () => {
    let db = seed();
    db = play(db, '"Twenty thousand dollars," Daniel says, "and nobody signs for it." Mara leaves to wait at the station.', {
      characters_present: ['daniel-okafor', 'mara-vance'],
      facts: [{ entity: 'daniel-okafor', fact: 'The missing shipments are worth $20,000 a week.', type: 'figure', who_knows: ['player', 'daniel-okafor'], supersedes: [], claimed_by: null, lasts: null, days: null }],
    });
    db = play(db, 'Mara is gone.', {
      characters_present: ['daniel-okafor'],
      character_updates: [{ character_id: 'mara-vance', mood: null, appearance: null, lasting_appearance: null, whereabouts: 'waiting at the station' }],
    });
    const text = promptText(db);

    expect(text).toMatch(/exactly \d{1,2}:\d{2} (AM|PM)/);
    expect(text).toContain('FIGURES ALREADY SAID');
    expect(text).toContain('$20,000');
    expect(text).toContain('Mara Vance: waiting at the station');
    expect(text).toContain('THE WORLD');
    expect(text).toContain('Old Town');
    expect(text).toContain('The Docks about 2 hours away');
    expect(db.state.inventory).toContain('Company badge');
  });
});

describe('28. story hooks', () => {
  test('a timeline beat opens its thread with its people; a later one resolves it', () => {
    let db = seed();
    expect(thread(db, 'Audit the dock shipments')).toBeUndefined();

    db = play(db, '"I\'ll do it," you tell Daniel.', { characters_present: ['daniel-okafor'], timeline_completed: ['audit-offer'] });
    expect(thread(db, 'Audit the dock shipments')?.status).toBe('open');
    expect(thread(db, 'Audit the dock shipments')?.participantIds).toContain(db.entities.find((e) => e.name === 'Daniel Okafor')!.id);

    db = {
      ...db,
      world: {
        ...db.world,
        timeline: [
          ...db.world.timeline,
          {
            id: 'audit-done',
            title: 'You hand Daniel the audit',
            description: 'You give Daniel what you found.',
            from: { year: 2026, month: 10, day: 1 },
            playerDriven: true,
            facts: ['You handed Daniel the finished audit.'],
            resolvesThreadTitles: ['Audit the dock shipments'],
          },
        ],
      },
    };
    db = play(db, 'You slide the folder across his desk.', { characters_present: ['daniel-okafor'], timeline_completed: ['audit-done'] });
    expect(thread(db, 'Audit the dock shipments')?.status).toBe('resolved');
    expect(db.facts.some((fact) => fact.text.includes('finished audit'))).toBe(true);
  });
});

describe('27. smaller images', () => {
  test('without a canvas the image is kept as it is; sizes are measured', async () => {
    const uri = 'data:image/png;base64,AAAAAAAA';
    expect(await compressImage(uri)).toBe(uri);
    expect(dataUriBytes(uri)).toBe(6);
  });
});
