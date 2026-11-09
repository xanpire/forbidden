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
import { isDeceased } from '../lib/rpg/deaths';
import { characterPortraitSignature } from '../lib/rpg/characterPortrait';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { secondPerson } from '../lib/rpg/util';
import type { AppDatabase } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_world', 'World'));

function play(db: AppDatabase, narration: string, state: Record<string, unknown> | null): AppDatabase {
  let next = appendStoryMessage(db, 'user', 'I keep going.', null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = state ? convertStateBlock(state).diff : null;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;

  return applyStateStep(next, diff, { turnLogId, userMessage: 'I keep going.', narration }, new Set()).db;
}

const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const bondOf = (db: AppDatabase, name: string) => db.bonds.find((bond) => bond.entityId === person(db, name).id);

describe('15. the starting cast', () => {
  test('starting people are met, aged from what the player wrote, and the dead have a bond marked so', () => {
    const db = seed();
    for (const name of ['Mara Vance', 'Daniel Okafor']) {
      const entity = person(db, name);
      expect(entity.met).toBe(true);
    }
    expect(entityAge(db.state.inStoryDate, person(db, 'Mara Vance'))).toBe(31);
    expect(bondOf(db, 'Theo Marsh')).toMatchObject({ relationship: 'old friend', status: 'Deceased · old friend' });
    expect(isDeceased(person(db, 'Theo Marsh'))).toBe(true);
  });

  test('a bond shows a death once you know of it, not before', () => {
    let db = seed();
    expect(bondOf(db, 'Daniel Okafor')?.status).toBe('acquaintance');
    db = play(db, 'Mara tells you Daniel died.', { characters_present: ['mara-vance'], deaths: [{ character_id: 'daniel-okafor', cause: 'a car crash' }] });
    expect(bondOf(db, 'Daniel Okafor')?.status).toBe('Deceased · acquaintance');
  });
});

describe('16. minor characters', () => {
  test('a one-scene character gets no bond until a second scene', () => {
    let db = seed();
    db = play(db, 'The deserter turns at the bridge.', {
      location: 'Bridge over the gorge',
      characters_present: ['Goro'],
      new_characters: [{ is_new: true, name: 'Goro', age: 30, role: 'Deserter', personality: null, speech_style: null, appearance: null, gender: 'male', attracted_to: null, minor: true }],
    });
    expect(person(db, 'Goro').met).toBe(true);
    expect(person(db, 'Goro').tier).toBe('minor');
    expect(bondOf(db, 'Goro')).toBeUndefined();

    db = play(db, 'You leave.', { scene_ended: true });
    db = play(db, 'Goro is waiting at the inn.', { location: 'Roadside inn', characters_present: ['goro'] });
    expect(person(db, 'Goro').tier).toBeUndefined();
    expect(bondOf(db, 'Goro')).toBeDefined();
  });
});

describe('17. base look and current look', () => {
  test('updates set the current look; it ends with the scene; portraits and the narrator use both', () => {
    let db = seed();
    const base = person(db, 'Mara Vance').appearance;
    expect(base).not.toContain('leather jacket');

    db = play(db, 'Mara comes in from the rain, soaked to the skin.', {
      characters_present: ['mara-vance'],
      character_updates: [{ character_id: 'mara-vance', mood: null, appearance: 'Soaked, mascara running', lasting_appearance: null }],
    });
    expect(person(db, 'Mara Vance').appearance).toBe(base);
    expect(person(db, 'Mara Vance').currentLook).toBe('Soaked, mascara running');
    expect(characterPortraitSignature(db, person(db, 'Mara Vance')).appearance).toContain('Right now: Soaked');

    db = play(db, 'Morning, somewhere else.', { location: 'Harbour Market', characters_present: ['mara-vance'] });
    expect(person(db, 'Mara Vance').currentLook).toBeUndefined();

    db = play(db, 'Mara has cut her hair short and wears a new leather jacket from now on.', {
      characters_present: ['mara-vance'],
      character_updates: [{ character_id: 'mara-vance', mood: null, appearance: null, lasting_appearance: 'Cropped dark-red hair, sharp green eyes, a battered leather jacket.' }],
    });
    expect(person(db, 'Mara Vance').appearance).toContain('leather jacket');
  });
});

describe('19. scene labels', () => {
  test('a ravine is not a settlement, an ambush is not travel, and you are not in your own cast', () => {
    let db = seed();
    db = play(db, 'They jump you from behind the rocks. A knife lunges at you; you dodge and hit back.', {
      location: 'Ravine below the coast road',
      location_kind: 'settlement',
      scene_pace: 'travel',
      characters_present: ['player', 'mara-vance'],
    });
    expect(db.state.locationKind).toBe('wilderness');
    expect(db.state.scenePace).toBe('combat');
    expect(db.state.sceneCast).toEqual(['Mara Vance']);
  });
});

describe('21. second person', () => {
  test('text that reaches you says "you"', () => {
    const db = seed();
    expect(db.facts.every((fact) => !/\bAlex\b/.test(fact.text))).toBe(true);
    expect(secondPerson("Alex's coat is torn, and Daniel watches Alex.", ['Alex Reyes', 'Alex'])).toBe('Your coat is torn, and Daniel watches you.');
  });
});
