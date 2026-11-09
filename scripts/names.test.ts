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
  identityLine,
  playerKnowsName,
  learnFromCanon,
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

  return {
    ...db,
    state: {
      ...db.state,
      inStoryDate: { year: 17, month: 5, day: 2, hour: 14, minute: 0 },
      location: 'a village in the Land of Grass',
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

/** The news of a milestone reaches Kan (and it has happened in the world). */
function hear(db: AppDatabase, ...ids: string[]): AppDatabase {
  const progress = db.state.canonProgress!;

  return learnFromCanon({
    ...db,
    state: {
      ...db.state,
      canonProgress: {
        ...progress,
        completed: [...new Set([...progress.completed, ...ids])],
        heard: {
          ...(progress.heard ?? {}),
          ...Object.fromEntries(ids.map((id) => [`event_canon_${id}`, { from: 'a rumor', date: db.state.inStoryDate }])),
        },
      },
    },
  });
}

function happen(db: AppDatabase, ...ids: string[]): AppDatabase {
  const progress = db.state.canonProgress!;

  return { ...db, state: { ...db.state, canonProgress: { ...progress, completed: [...new Set([...progress.completed, ...ids])] } } };
}

describe('names Kan knows', () => {
  test('the people he knew at the start keep their names; strangers only have a look', () => {
    const db = save();

    expect(displayName(db, person(db, 'Itachi Uchiha'))).toBe('Itachi Uchiha');
    expect(displayName(db, person(db, 'Hana Inuzuka'))).toBe('Hana Inuzuka');
    // His ANBU colleague, by the name ANBU used.
    expect(displayName(db, person(db, 'Yamato'))).toBe('Tenzo');
    expect(displayName(db, person(db, 'Karin'))).toBe('the red-haired girl');
    expect(displayName(db, person(db, 'Tobi'))).toBe('the masked man');
    expect(playerKnowsName(person(db, 'Karin'))).toBe(false);
  });

  test("Karin first, then Karin Uzumaki once he learns she's an Uzumaki", () => {
    let db = save();
    db = play(
      db,
      '*You watch the girl.*',
      'The red-haired girl adjusts her glasses and glares at you. Behind her, a guard shouts, "Karin! Back to your post!"',
      { ...minutes, characters_present: ['karin'] }
    ).db;

    expect(displayName(db, person(db, 'Karin'))).toBe('Karin');

    db = play(
      db,
      '"What is your clan?"',
      '"Uzumaki," she says, as if it costs her something.',
      { ...minutes, characters_present: ['karin'], names_learned: [{ character_id: 'karin', name: 'Uzumaki', part: 'family', how: 'introduced' }] }
    ).db;

    const karin = person(db, 'Karin');
    expect(displayName(db, karin)).toBe('Karin Uzumaki');
    expect(karin.known?.history?.map((item) => item.how)).toEqual(['overheard', 'introduced']);
    // Silent: no notice for a name.
    expect(db.bonds.find((bond) => bond.entityId === karin.id)?.characterName ?? 'Karin').toBe('Karin');
  });

  test('the masked man → Madara (Tobi stays an alias) → Masked Madara → Obito', () => {
    let db = save();
    const tobi = () => person(db, 'Tobi');

    expect(displayName(db, tobi())).toBe('the masked man');

    db = hear(db, 'masked-man-audience');
    expect(displayName(db, tobi())).toBe('Madara Uchiha');

    db = play(
      db,
      '*You watch the new recruit.*',
      'The man in the orange mask trips over a root. "Tobi is fine!" he squeaks.',
      {
        ...minutes,
        characters_present: ['tobi'],
        names_learned: [{ character_id: 'tobi', name: 'Tobi', part: 'identity', how: 'introduced' }],
      }
    ).db;
    // A persona never replaces a claimed name.
    expect(displayName(db, tobi())).toBe('Madara Uchiha');
    expect(alsoKnownAs(db, tobi())).toContain('Tobi');

    db = hear(db, 'madara-revived');
    expect(displayName(db, tobi())).toBe('Masked Madara');

    db = hear(db, 'obito-unmasked');
    expect(displayName(db, tobi())).toBe('Obito Uchiha');
    expect(alsoKnownAs(db, tobi())).toEqual(expect.arrayContaining(['Tobi', 'Madara Uchiha']));
    expect(resolveEntity(db, 'Obito')?.id).toBe(tobi().id);
  });

  test('meeting the act first reads Tobi, then Madara', () => {
    let db = happen(save(), 'tobi-joins-akatsuki');
    db = play(db, '*You look up.*', '"Senpai! Tobi brought snacks!"', { ...minutes, characters_present: ['tobi'] }).db;

    expect(displayName(db, person(db, 'Tobi'))).toBe('Tobi');

    db = hear(db, 'masked-man-audience');
    expect(displayName(db, person(db, 'Tobi'))).toBe('Madara Uchiha');
  });

  test('Deidara calls him Tobi while Itachi says Madara', () => {
    const db = happen(save(), 'tobi-joins-akatsuki');
    const tobi = person(db, 'Tobi');
    const deidara = person(db, 'Deidara');
    const itachi = person(db, 'Itachi Uchiha');

    expect(nameKnownBy(db, tobi, deidara)).toBe('Tobi');
    expect(nameKnownBy(db, tobi, itachi)).toBe('Madara Uchiha');
    expect(nameKnownBy(db, tobi, person(db, 'Zetsu'))).toBe('Madara Uchiha');

    const crowd = identityLine(db, tobi, [deidara.id, itachi.id]);
    expect(crowd).toContain('Going by "Tobi"');
    expect(crowd).toContain('Tobi is a good boy!');
    expect(crowd).toContain('knows him as Tobi');
    expect(crowd).toContain('Itachi Uchiha: knows him as Madara Uchiha');

    // Alone with someone who knows him as Madara, the act drops.
    expect(identityLine(db, tobi, [itachi.id])).toContain('Going by "Madara Uchiha"');

    // Zetsu knows the truth but plays along.
    const zetsu = person(db, 'Zetsu');
    expect(identityLine(db, tobi, [zetsu.id])).toContain('knows the truth (Obito Uchiha) but plays along');

    // From the summit the whole world hears "Madara".
    const summit = happen(db, 'kage-summit');
    expect(nameKnownBy(summit, tobi, person(summit, 'Gaara'))).toBe('Madara Uchiha');
    expect(nameKnownBy(summit, tobi, person(summit, 'Deidara'))).toBe('Madara Uchiha');
  });

  test('Kisame is recognised on sight; Kakuzu needs an introduction; Pain never', () => {
    let db = save();
    db = play(
      db,
      '*You stop.*',
      'A huge man with blue-grey skin and gills leans on a bandaged sword. Beside him a masked man counts coins, and a pierced man watches from the rain.',
      { ...minutes, characters_present: ['kisame-hoshigaki', 'kakuzu', 'pain'] }
    ).db;

    expect(displayName(db, person(db, 'Kisame Hoshigaki'))).toBe('Kisame Hoshigaki');
    expect(person(db, 'Kisame Hoshigaki').known?.history?.[0]?.how).toBe('recognised');
    expect(displayName(db, person(db, 'Kakuzu'))).toBe('the masked man with stitched arms');
    expect(displayName(db, person(db, 'Pain'))).toBe('the pierced man');

    // Gaara's face goes with his title only once he is Kazekage.
    const before = play(save(), '*You look.*', 'A boy with a gourd.', { ...minutes, characters_present: ['gaara'] }).db;
    expect(playerKnowsName(person(before, 'Gaara'))).toBe(false);
    const after = play(happen(save(), 'gaara-kage'), '*You look.*', 'The Kazekage.', { ...minutes, characters_present: ['gaara'] }).db;
    expect(displayName(after, person(after, 'Gaara'))).toBe('Gaara');
  });

  test('a leaked name is caught, a spoken one is learned', () => {
    let db = save();

    expect(nameLeaks(db, 'Karin pushes her glasses up and looks away.').some((leak) => leak.startsWith('Karin'))).toBe(true);
    expect(nameLeaks(db, 'The girl mutters, "Karin will not be ordered around."')).toEqual([]);
    expect(nameLeaks(db, 'Itachi watches the road.')).toEqual([]);

    const result = play(db, '*You listen.*', 'Someone calls out, "Karin!" and the red-haired girl turns. Karin scowls.', {
      ...minutes,
      characters_present: ['karin'],
    });
    db = result.db;
    expect(displayName(db, person(db, 'Karin'))).toBe('Karin');
    // Once heard, using it in narration is no leak.
    expect(result.nameLeaks).toEqual([]);

    // A shared name ("Madara") is left to the tracker.
    const masked = play(save(), '*You listen.*', '"Madara-sama," the plant-like man says.', { ...minutes, characters_present: ['tobi', 'zetsu'] }).db;
    expect(displayName(masked, person(masked, 'Tobi'))).toBe('the masked man');
  });

  test('a stranger with no name gets a label, then the name they give', () => {
    let db = save();
    db = play(db, '*You wave the ferryman over.*', 'A scarred ferryman poles his boat closer.', {
      ...minutes,
      characters_present: ['the scarred ferryman'],
      new_characters: [
        { is_new: true, name: 'the scarred ferryman', age: 50, role: 'Ferryman', personality: null, speech_style: null, appearance: 'A scar across his jaw.', gender: 'male', attracted_to: null, minor: false, name_known: false },
      ],
    }).db;

    const ferryman = db.entities.find((entity) => entity.unnamed)!;
    expect(ferryman.name).toBe('the scarred ferryman');
    expect(displayName(db, ferryman)).toBe('the scarred ferryman');

    db = play(db, '"Your name?"', '"Genzo," he grunts.', {
      ...minutes,
      characters_present: ['the-scarred-ferryman'],
      names_learned: [{ character_id: 'the-scarred-ferryman', name: 'Genzo', part: 'given', how: 'introduced' }],
    }).db;

    const named = db.entities.find((entity) => entity.id === ferryman.id)!;
    expect(named.name).toBe('Genzo');
    expect(named.unnamed).toBeUndefined();
    expect(displayName(db, named)).toBe('Genzo');
    expect(db.state.sceneCast).toContain('Genzo');
  });

  test('search finds only names Kan knows', () => {
    const db = save();
    const karin = person(db, 'Karin');
    const tobi = person(db, 'Tobi');

    expect(searchableNames(db, karin).some((name) => name.toLowerCase().includes('karin'))).toBe(false);
    expect(searchableNames(db, karin)).toContain('the red-haired girl');
    expect(searchableNames(db, tobi).some((name) => /obito|madara/i.test(name))).toBe(false);
  });

  test('an old save keeps everyone he met by name', () => {
    const seeded = save();
    // Built the way a save from before names looked.
    const legacy = {
      ...seeded,
      state: { ...seeded.state, namesVersion: undefined },
      entities: seeded.entities.map((entity) => {
        const { known: _known, identities: _identities, ...rest } = entity;
        if (entity.name === 'Kakuzu' || entity.name === 'Tobi') return { ...rest, met: true };
        if (entity.name === 'Pain') return { ...rest, hiddenAliases: [{ name: 'Nagato', revealedBy: 'pain-assault' }] };
        return rest;
      }),
    } as AppDatabase;
    const db = normalizeDatabase(legacy);

    expect(displayName(db, person(db, 'Kakuzu'))).toBe('Kakuzu');
    expect(displayName(db, person(db, 'Tobi'))).toBe('Tobi');
    expect(displayName(db, person(db, 'Karin'))).toBe('the red-haired girl');
    expect(displayName(db, person(db, 'Itachi Uchiha'))).toBe('Itachi Uchiha');
    expect(person(db, 'Pain').hiddenAliases).toBeUndefined();
    expect(person(db, 'Pain').identities?.map((identity) => identity.name)).toEqual(['Pain', 'Nagato Uzumaki']);
    expect(db.state.namesVersion).toBe(1);

    // Loading twice changes nothing.
    expect(ensureNames(db).entities).toEqual(db.entities);
  });
});

describe('the prompts', () => {
  test('the narrator sees the label, the truth only as narrator-only, and the rule', () => {
    const db = { ...save(), state: { ...save().state, sceneCast: ['Karin'] } };
    const prompt = buildNarrationPrompt(db, '*You watch her.*').messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('the red-haired girl [narrator only: Karin]');
    expect(prompt).toContain('call them "the red-haired girl" every time');
    expect(NARRATION_SYSTEM).toContain('Narration calls people only by the name the player knows');
    expect(NARRATION_SYSTEM).toContain('How do you know that name?');
    expect(NARRATION_SYSTEM).not.toContain('Itachi dies believing it');
  });

  test("the masked man's card carries his identity in use", () => {
    let db = happen(save(), 'tobi-joins-akatsuki');
    db = { ...db, state: { ...db.state, sceneCast: ['Tobi', 'Deidara'] } };
    const prompt = buildNarrationPrompt(db, '*You wait.*').messages.map((message) => message.content).join('\n');

    expect(prompt).toContain('Truth (narrator only): truly Obito Uchiha; claims to be Madara Uchiha; plays "Tobi"');
    expect(prompt).toContain('Going by "Tobi"');
  });

  test('the tracker sees identities and is asked for names_learned', () => {
    const db = { ...save(), state: { ...save().state, sceneCast: ['Karin'] } };
    const text = buildExtractionPrompt(db, '*You watch.*', 'The red-haired girl glares.').messages.map((message) => message.content).join('\n');
    const schema = TURN_STATE_SCHEMA as unknown as { properties: Record<string, unknown>; required: string[] };

    expect(text).toContain('Obito Uchiha (true)');
    expect(text).toContain('names_learned');
    expect(text).toContain(`you don't know their name (you see "the red-haired girl")`);
    expect(schema.required).toContain('names_learned');
    expect(schema.required).toContain('names_told');
  });
});
