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
import { resolveCharacterRefs, resolveEntity } from '../lib/rpg/entities';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import {
  alsoKnownAs,
  displayName,
  ensureNames,
  playerKnowsName,
  learnFromTimeline,
  nameKnownBy,
  nameLeaks,
  searchableNames,
} from '../lib/rpg/names';
import { NARRATION_SYSTEM, buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from '../lib/rpg/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase, EntityRecord } from '../lib/rpg/types';

function save(): AppDatabase {
  let db = normalizeDatabase(seedDatabase('slot_names', 'Names'));

  for (let index = 0; index < 3; index += 1) {
    db = appendStoryMessage(db, 'user', `*You walk on.* ${index}`, null, 0, 0);
    db = appendStoryMessage(db, 'assistant', `The road goes on. ${index}`, null, 0, 0);
  }

  const date = db.state.inStoryDate;
  const extra: EntityRecord[] = [
    // A woman the player has seen but never been told the name of.
    { id: 'entity_nadia', name: 'Nadia Kerr', type: 'character', aliases: ['Nadia'], role: 'Courier', appearance: 'Short, quick, always with a red umbrella.', gender: 'female', met: false, known: { label: 'the woman with the red umbrella' }, tags: [] },
    // A man known by a false name until the news exposes him.
    {
      id: 'entity_victor', name: 'Victor Lane', type: 'character', aliases: [], role: 'Fixer', appearance: 'Silver hair, grey suit, never smiles.', gender: 'male', met: false,
      identities: [
        { name: 'Mr. Grey', kind: 'claimed', publicFrom: 'start' },
        { name: 'Victor Lane', kind: 'true', learnedWith: ['grey-exposed'] },
      ],
      known: { identities: ['Mr. Grey'] },
      tags: [],
    },
    // A famous singer: recognised on sight.
    { id: 'entity_celeste', name: 'Celeste Moreau', type: 'character', aliases: ['Celeste'], role: 'Singer', appearance: 'Famous face from every billboard in town.', gender: 'female', met: false, fame: 'sight', known: { label: 'the woman in the white coat' }, tags: [] },
    // Someone not famous: stays a description.
    { id: 'entity_bruno', name: 'Bruno Hale', type: 'character', aliases: ['Bruno'], role: 'Bouncer', appearance: 'Huge, bald, silent.', gender: 'male', met: false, known: { label: 'the bald bouncer' }, tags: [] },
  ];

  return {
    ...db,
    entities: [...db.entities, ...extra],
    world: {
      ...db.world,
      timeline: [
        ...db.world.timeline,
        { id: 'grey-exposed', title: 'Mr. Grey exposed', description: 'The papers reveal that the fixer called Mr. Grey is Victor Lane.', from: { year: 2026, month: 10, day: 1 }, knowledge: 'public', facts: [] },
      ],
    },
    state: {
      ...db.state,
      inStoryDate: { ...date, hour: 14, minute: 0 },
      location: 'Harbour Market',
      locationKind: 'settlement',
      scenePace: 'conversation',
    },
  };
}

const minutes = { time: { elapsed: 5, unit: 'minutes', clock_time: null }, scene_pace: 'conversation' };

function play(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const converted = convertStateBlock(block).diff;
  const diff = converted ? resolveCharacterRefs(next, converted) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set());
}

function person(db: AppDatabase, name: string): EntityRecord {
  return db.entities.find((entity) => entity.name === name)!;
}

/** The news of a timeline event reaches the player (and it has happened in the world). */
function hear(db: AppDatabase, ...ids: string[]): AppDatabase {
  const progress = db.state.timelineProgress ?? { completed: [], active: [], engaged: [] };

  return learnFromTimeline({
    ...db,
    state: {
      ...db.state,
      timelineProgress: {
        ...progress,
        completed: [...new Set([...progress.completed, ...ids])],
        heard: {
          ...(progress.heard ?? {}),
          ...Object.fromEntries(ids.map((id) => [`event_timeline_${id}`, { from: 'a rumor', date: db.state.inStoryDate }])),
        },
      },
    },
  });
}

describe('names the player knows', () => {
  test('the people they knew at the start keep their names; strangers only have a look', () => {
    const db = save();

    expect(displayName(db, person(db, 'Mara Vance'))).toBe('Mara Vance');
    expect(displayName(db, person(db, 'Daniel Okafor'))).toBe('Daniel Okafor');
    expect(displayName(db, person(db, 'Nadia Kerr'))).toBe('the woman with the red umbrella');
    expect(displayName(db, person(db, 'Victor Lane'))).toBe('Mr. Grey');
    expect(playerKnowsName(person(db, 'Nadia Kerr'))).toBe(false);
  });

  test('a first name overheard, then the family name when she gives it', () => {
    let db = save();
    db = play(
      db,
      '*You watch the woman.*',
      'The woman with the red umbrella shakes the rain off. Across the market someone shouts, "Nadia! Your parcel!"',
      { ...minutes, characters_present: ['nadia-kerr'] }
    ).db;

    expect(displayName(db, person(db, 'Nadia Kerr'))).toBe('Nadia');

    db = play(
      db,
      '"Nadia what?"',
      '"Kerr," she says, as if it costs her something.',
      { ...minutes, characters_present: ['nadia-kerr'], names_learned: [{ character_id: 'nadia-kerr', name: 'Kerr', part: 'family', how: 'introduced' }] }
    ).db;

    const nadia = person(db, 'Nadia Kerr');
    expect(displayName(db, nadia)).toBe('Nadia Kerr');
    expect(nadia.known?.history?.map((item) => item.how)).toEqual(['overheard', 'introduced']);
  });

  test('a false name gives way to the true one when the news reaches you; the old one stays an alias', () => {
    let db = save();
    const victor = () => person(db, 'Victor Lane');

    expect(displayName(db, victor())).toBe('Mr. Grey');
    db = hear(db, 'grey-exposed');
    expect(displayName(db, victor())).toBe('Victor Lane');
    expect(alsoKnownAs(db, victor())).toContain('Mr. Grey');
    expect(resolveEntity(db, 'Victor Lane')?.id).toBe(victor().id);
  });

  test('someone famous is recognised on sight; anyone else needs an introduction', () => {
    let db = save();
    db = play(
      db,
      '*You stop.*',
      'A woman in a white coat signs autographs by the fish stall while a bald bouncer keeps the crowd back.',
      { ...minutes, characters_present: ['celeste-moreau', 'bruno-hale'] }
    ).db;

    expect(displayName(db, person(db, 'Celeste Moreau'))).toBe('Celeste Moreau');
    expect(person(db, 'Celeste Moreau').known?.history?.[0]?.how).toBe('recognised');
    expect(displayName(db, person(db, 'Bruno Hale'))).toBe('the bald bouncer');
  });

  test('a leaked name is caught, a spoken one is learned', () => {
    let db = save();

    expect(nameLeaks(db, 'Nadia shakes out her umbrella and looks away.').some((leak) => leak.startsWith('Nadia'))).toBe(true);
    expect(nameLeaks(db, 'The courier mutters, "Nadia does not wait for anyone."')).toEqual([]);
    expect(nameLeaks(db, 'Mara watches the road.')).toEqual([]);

    const result = play(db, '*You listen.*', 'Someone calls out, "Nadia!" and the woman with the red umbrella turns. Nadia scowls.', {
      ...minutes,
      characters_present: ['nadia-kerr'],
    });
    db = result.db;
    expect(displayName(db, person(db, 'Nadia Kerr'))).toBe('Nadia');
    // Once heard, using it in narration is no leak.
    expect(result.nameLeaks).toEqual([]);
  });

  test('a stranger with no name gets a label, then the name they give', () => {
    let db = save();
    db = play(db, '*You wave the ferryman over.*', 'A scarred ferryman steers his water taxi closer.', {
      ...minutes,
      characters_present: ['the scarred ferryman'],
      new_characters: [
        { is_new: true, name: 'the scarred ferryman', age: 50, role: 'Water taxi driver', personality: null, speech_style: null, appearance: 'A scar across his jaw.', gender: 'male', attracted_to: null, minor: false, name_known: false },
      ],
    }).db;

    const ferryman = db.entities.find((entity) => entity.unnamed)!;
    expect(ferryman.name).toBe('the scarred ferryman');
    expect(displayName(db, ferryman)).toBe('the scarred ferryman');

    db = play(db, '"Your name?"', '"Gino," he grunts.', {
      ...minutes,
      characters_present: ['the-scarred-ferryman'],
      names_learned: [{ character_id: 'the-scarred-ferryman', name: 'Gino', part: 'given', how: 'introduced' }],
    }).db;

    const named = db.entities.find((entity) => entity.id === ferryman.id)!;
    expect(named.name).toBe('Gino');
    expect(named.unnamed).toBeUndefined();
    expect(displayName(db, named)).toBe('Gino');
    expect(db.state.sceneCast).toContain('Gino');
  });

  test('search finds only names the player knows', () => {
    const db = save();

    expect(searchableNames(db, person(db, 'Nadia Kerr')).some((name) => name.toLowerCase().includes('nadia'))).toBe(false);
    expect(searchableNames(db, person(db, 'Nadia Kerr'))).toContain('the woman with the red umbrella');
    expect(searchableNames(db, person(db, 'Victor Lane')).some((name) => /victor/i.test(name))).toBe(false);
  });

  test('nameKnownBy: the player sees the name in use; ensureNames keeps saves stable', () => {
    const db = save();
    const again = ensureNames(db);
    expect(displayName(again, person(again, 'Victor Lane'))).toBe('Mr. Grey');
    expect(nameKnownBy(db, person(db, 'Mara Vance'), person(db, 'Daniel Okafor'))).toBeTruthy();
  });
});

describe('the prompts', () => {
  test('the narrator sees the label, the truth only as narrator-only, and the rule', () => {
    const db = { ...save(), state: { ...save().state, sceneCast: ['Nadia Kerr'] } };
    const prompt = buildNarrationPrompt(db, '*You watch her.*').messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('the woman with the red umbrella [narrator only: Nadia Kerr]');
    expect(NARRATION_SYSTEM).toContain('Narration calls people only by the name the player knows');
    expect(NARRATION_SYSTEM).toContain('How do you know that name?');
  });

  test('the tracker sees identities and is asked for names_learned', () => {
    const db = { ...save(), state: { ...save().state, sceneCast: ['Nadia Kerr', 'Victor Lane'] } };
    const text = buildExtractionPrompt(db, '*You watch.*', 'The woman with the red umbrella glares at Mr. Grey.').messages.map((message) => message.content).join('\n');
    const schema = TURN_STATE_SCHEMA as unknown as { properties: Record<string, unknown>; required: string[] };

    expect(text).toContain('Victor Lane (true)');
    expect(text).toContain('names_learned');
    expect(text).toContain(`you don't know their name (you see "the woman with the red umbrella")`);
    expect(schema.required).toContain('names_learned');
    expect(schema.required).toContain('names_told');
  });
});
