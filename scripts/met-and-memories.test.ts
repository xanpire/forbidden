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
import { applyStateStep, applySummaryJob } from '../lib/rpg/memoryJobs';
import { presentFromProse } from '../lib/rpg/proseFallback';
import { seedDatabase } from './fixtures/seed';
import { sharedMemories } from '../lib/rpg/sharedMemories';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import type { AppDatabase, EntityRecord, MemoryJob } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_met', 'Met'));

/** One full turn: the player's message, the narration, then the state reply applied. */
function play(db: AppDatabase, narration: string, state: Record<string, unknown> | null): AppDatabase {
  let next = appendStoryMessage(db, 'user', 'I keep going.', null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = state ? convertStateBlock(state).diff : null;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;

  return applyStateStep(next, diff, { turnLogId, userMessage: 'I keep going.', narration }, new Set()).db;
}

const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const bondOf = (db: AppDatabase, entity: EntityRecord) => db.bonds.find((bond) => bond.entityId === entity.id);

function summarizeNext(db: AppDatabase, text: string): AppDatabase {
  const job = (db.memoryJobs ?? []).find((item) => item.kind === 'scene') as MemoryJob;
  expect(job).toBeDefined();
  const result = applySummaryJob(db, job, { text, title: text.split('.')[0], memory: text, logIds: job.logIds });
  expect(result).not.toBeNull();
  return result!.db;
}

function memoryTitled(db: AppDatabase, title: string) {
  return db.events.find((event) => event.tags.includes('summary') && event.title === title)!;
}

function linked(db: AppDatabase, eventId: string) {
  return db.eventEntities
    .filter((link) => link.eventId === eventId)
    .map((link) => ({ name: db.entities.find((entity) => entity.id === link.entityId)?.name, role: link.role }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

describe('only the scene cast meets people', () => {
  test('mentioned only: unmet, no bond — even with a bond change, a grudge and an update', () => {
    let db = seed();
    db = play(db, 'Jonah slides a flyer across the bar. "Ricky Sloane. Skipped bail, and someone is paying twenty thousand dollars for him."', {
      characters_present: ['jonah-pike'],
      new_characters: [{ is_new: true, name: 'Ricky Sloane', age: 24, role: 'Bail jumper with a price on him', personality: 'reckless', speech_style: 'loud', appearance: 'scarred jaw' }],
      bonds: [{ character_id: 'Ricky Sloane', affinity_change: -2, status: 'Owes you', note: 'Owes you money', relationship: null, attraction: null, romance_note: null }],
      grudges: [{ character_id: 'Ricky Sloane', event: 'wronged', reason: 'You are hunting him' }],
      character_updates: [{ character_id: 'Ricky Sloane', mood: 'hunted', appearance: null }],
    });

    const ricky = person(db, 'Ricky Sloane');
    expect(ricky.met).toBe(false);
    expect(ricky.status).toBe('Not yet met');
    expect(ricky.lastSeen).toBeUndefined();
    expect(bondOf(db, ricky)).toBeUndefined();

    // Jonah was there: met, "Newly met", and a bond.
    const jonah = person(db, 'Jonah Pike');
    expect(jonah.met).toBe(true);
    expect(jonah.status).toBe('Newly met');
    expect(bondOf(db, jonah)).toBeDefined();
  });

  test('mentioned and present: "Newly met" with a bond', () => {
    let db = seed();
    db = play(db, 'A man with a scarred jaw steps out of the alley. "You must be the one hunting me."', {
      characters_present: ['Ricky Sloane'],
      new_characters: [{ is_new: true, name: 'Ricky Sloane', age: 24, role: 'Bail jumper', personality: 'reckless', speech_style: 'loud', appearance: 'scarred jaw' }],
    });

    const ricky = person(db, 'Ricky Sloane');
    expect(ricky.met).toBe(true);
    expect(ricky.status).toBe('Newly met');
    expect(ricky.lastSeen).toEqual(db.state.inStoryDate);
    expect(bondOf(db, ricky)?.status).toBe('Newly met');
  });

  test('someone met before is met later by stepping into a scene', () => {
    let db = seed();
    db = play(db, 'Mara talks about the bail jumper Ricky.', {
      characters_present: ['mara-vance'],
      new_characters: [{ is_new: true, name: 'Ricky Sloane', age: 24, role: 'Bail jumper', personality: null, speech_style: null, appearance: null }],
    });
    expect(person(db, 'Ricky Sloane').met).toBe(false);

    db = play(db, 'Ricky Sloane steps out from behind the van.', { characters_present: ['mara-vance', 'ricky-sloane'] });
    expect(person(db, 'Ricky Sloane').status).toBe('Newly met');
    expect(bondOf(db, person(db, 'Ricky Sloane'))).toBeDefined();
  });

  test('a description never touches an unmet person or becomes one', () => {
    let db = seed();
    const narration = 'The masked man counts his money. The masked man does not look up. Mara grunts.';
    db = play(db, narration, {
      characters_present: ['mara-vance', 'the masked man'],
      bonds: [{ character_id: 'the masked man', affinity_change: -1, status: 'Wary', note: 'Cold', relationship: null, attraction: null, romance_note: null }],
      character_updates: [{ character_id: 'Masked man', mood: 'bored', appearance: null }],
      facts: [{ entity: 'the masked man', fact: 'Mara owes money to someone.', type: 'knowledge', who_knows: ['player', 'the masked man'] }],
      new_characters: [{ is_new: true, name: 'The masked man', age: null, role: 'Loan shark', personality: null, speech_style: null, appearance: null }],
    });

    const jonah = person(db, 'Jonah Pike');
    expect(jonah.met).toBe(false);
    expect(jonah.lastSeen).toBeUndefined();
    expect(jonah.mood).not.toBe('bored');
    expect(bondOf(db, jonah)).toBeUndefined();
    expect(db.facts.some((fact) => fact.whoKnows.includes(jonah.id))).toBe(false);
    expect(db.entities.some((entity) => /masked man/i.test(entity.name))).toBe(false);
    expect(presentFromProse(db, narration)).not.toContain('Jonah Pike');
    expect(person(db, 'Mara Vance').met).toBe(true);
  });

  test('a failed state reply meets no one and keeps the scene cast', () => {
    let db = seed();
    db = play(db, 'Mara waits.', { characters_present: ['mara-vance'] });
    db = play(db, 'Jonah Pike grins at you. Jonah Pike cracks his knuckles.', null);

    expect(person(db, 'Jonah Pike').met).toBe(false);
    expect(db.state.sceneCast).toEqual(['Mara Vance']);
  });
});

describe('shared memories', () => {
  test('three people in a room all get the memory, named in its text or not', () => {
    let db = seed();
    db = play(db, 'Daniel, Jonah and Mara stand with you in the yard office.', {
      location: 'Yard office, upper floor',
      characters_present: ['daniel-okafor', 'jonah-pike', 'mara-vance'],
    });
    db = play(db, 'No one speaks. The rain hammers the glass.', { scene_ended: true });

    db = summarizeNext(db, 'You wait in the yard office while Daniel watches the rain.');
    const memory = memoryTitled(db, 'You wait in the yard office while Daniel watches the rain');

    expect(linked(db, memory.id)).toEqual([
      { name: 'Daniel Okafor', role: 'present' },
      { name: 'Jonah Pike', role: 'present' },
      { name: 'Mara Vance', role: 'present' },
    ]);

    for (const name of ['Daniel Okafor', 'Jonah Pike', 'Mara Vance']) {
      expect(sharedMemories(db, person(db, name).id).map((event) => event.id)).toContain(memory.id);
    }
  });

  test('a memory never takes in a neighbouring scene or its cast', () => {
    let db = seed();
    // The platform: Mara is there.
    db = play(db, 'Daniel hands you a key card on the loading platform. Mara watches.', {
      location: 'Loading platform',
      characters_present: ['daniel-okafor', 'mara-vance'],
    });
    db = play(db, 'Mara turns away into the rain.', { characters_present: ['daniel-okafor', 'mara-vance'], scene_ended: true });
    // The office: only Daniel.
    db = play(db, 'The office door closes behind you and Daniel.', {
      location: 'Daniel\'s office',
      characters_present: ['daniel-okafor'],
    });
    db = play(db, 'Daniel finally tells you the truth. Mara’s name never comes up again tonight.', {
      characters_present: ['daniel-okafor'],
      scene_ended: true,
    });

    // Two scenes: summed up one at a time, never together.
    const pending = (db.memoryJobs ?? []).filter((job) => job.kind === 'scene');
    expect(pending).toHaveLength(1);
    const platformTurns = new Set(db.rawLog.filter((entry) => entry.sceneSeq === db.rawLog.find((e) => e.kind === 'story' && e.sceneSeq !== undefined)?.sceneSeq).map((e) => e.id));
    expect(pending[0].logIds?.every((id) => platformTurns.has(id))).toBe(true);

    db = summarizeNext(db, 'Daniel gives you the key card while Mara watches.');
    db = summarizeNext(db, 'A long night in the office with Daniel, though Mara is on your mind.');

    const platform = memoryTitled(db, 'Daniel gives you the key card while Mara watches');
    const cell = memoryTitled(db, 'A long night in the office with Daniel, though Mara is on your mind');

    expect(linked(db, platform.id)).toEqual([
      { name: 'Daniel Okafor', role: 'present' },
      { name: 'Mara Vance', role: 'present' },
    ]);
    // Named in the cell memory's text, but not there: not linked.
    expect(linked(db, cell.id)).toEqual([{ name: 'Daniel Okafor', role: 'present' }]);

    const mara = person(db, 'Mara Vance');
    const shared = sharedMemories(db, mara.id).map((event) => event.id);
    expect(shared).toContain(platform.id);
    expect(shared).not.toContain(cell.id);

    // The scene-end memories were folded into their own scene's memory only.
    expect(db.events.filter((event) => event.sourceLogId === null && event.turnLogId)).toHaveLength(0);
  });

  test('the bond page leaves out memories someone is only mentioned in', () => {
    let db = seed();
    db = play(db, 'Mara waits outside.', { characters_present: ['mara-vance'] });
    const jonah = person(db, 'Jonah Pike');
    const event = db.events[db.events.length - 1];
    db = {
      ...db,
      eventEntities: [...db.eventEntities, { eventId: event.id, entityId: jonah.id, role: 'mentioned' }],
    };

    expect(sharedMemories(db, jonah.id).map((item) => item.id)).not.toContain(event.id);
  });
});
