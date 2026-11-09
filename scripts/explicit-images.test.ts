// Explicit images (session B): structured prompts only, adults only, in-app
// references only, and nothing leaks into exports or notifications.
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
import { buildRunwareTask, buildWiroForm } from '../lib/explicitProviders';
import {
  ADULT_NEGATIVE,
  addExplicitImage,
  addExplicitRef,
  canPictureThis,
  checkShot,
  cleanSheetField,
  defaultShot,
  explicitImagePrompt,
  explicitReferences,
  referenceSheetPrompt,
  withoutExplicit,
  type ExplicitShot,
} from '../lib/rpg/explicitImages';
import { notificationText } from '../lib/rpg/intimacy';
import { appendStoryMessage, pushSnapshot } from '../lib/rpg/log';
import { paintExplicit } from '../lib/rpg/paintExplicit';
import { seedDatabase } from './fixtures/seed';
import { testSeedInput } from './fixtures/testWorld';
import type { AppDatabase } from '../lib/rpg/types';

const PLANTED = 'PURPLE ELEPHANT';

function story(): AppDatabase {
  const input = testSeedInput();
  input.people = input.people.map((person) =>
    person.name === 'Mara Vance'
      ? { ...person, appearance: 'Petite, young-looking, short dark-red hair, sharp green eyes.', intimacy: { orientation: 'men', interestedInPlayer: 'yes', desires: [`${PLANTED} desire`], boundaries: [] } }
      : person
  );
  input.people.push({
    name: 'Lily',
    gender: 'female',
    role: 'Regular at the bar',
    appearance: 'Curly hair.',
    personality: 'Chatty.',
    speechStyle: 'Fast.',
    relationship: 'friendly',
    yourFeelings: { affinity: 4, note: '' },
    theirFeelings: { affinity: 4, note: '' },
    alive: true,
    knownName: true,
  });
  input.world = { ...input.world, premise: `${PLANTED} premise`, narratorNotes: `${PLANTED} notes`, artStyle: 'cinematic photo, 35mm film' };
  input.content = { pacing: 'fast', interests: [{ label: `${PLANTED} interest`, weight: 'love' }], limits: [] };
  let db = normalizeDatabase(seedDatabase('slot_explicit', 'Explicit', input));
  const mara = db.entities.find((e) => e.name === 'Mara Vance')!;
  // Story text, the player's own words and tracker-written state all carry the planted phrase.
  db = appendStoryMessage(db, 'user', `*I whisper ${PLANTED}.*`, null, 0, 0);
  db = appendStoryMessage(db, 'assistant', `Mara laughs at ${PLANTED} and pulls you close.`, null, 0, 0);
  db = {
    ...db,
    state: {
      ...db.state,
      location: `${PLANTED} hotel`,
      sceneMode: { current: 'intimate', exchangeStreak: 0, partners: [], sex: { with: [mara.id], since: db.state.inStoryDate, turns: 1, phase: 'build-up', done: [] } },
    },
    entities: db.entities.map((e) => (e.id === mara.id ? { ...e, currentLook: `${PLANTED} dress`, scenePosition: `${PLANTED} position` } : e)),
  };
  return db;
}

const id = (db: AppDatabase, name: string) => db.entities.find((e) => e.name === name)!.id;
const playerId = (db: AppDatabase) => db.entities.find((e) => e.tags.includes('player'))!.id;

describe('explicit image prompts', () => {
  test('structured mode: no story or player free text reaches the prompt', () => {
    const db = story();
    const shot = defaultShot(db);
    expect(shot.castIds).toEqual([playerId(db), id(db, 'Mara Vance')]);
    const prompt = explicitImagePrompt(db, shot);
    const everything = JSON.stringify(prompt);
    expect(everything).not.toContain(PLANTED);
    expect(everything.toLowerCase()).not.toContain('purple');
    // The provider requests carry only the built prompt.
    expect(JSON.stringify(buildRunwareTask(prompt, [], 'm'))).not.toContain(PLANTED);
    expect(String(buildWiroForm(prompt, []).get('prompt'))).toBe(prompt.positive);
  });

  test('every person is stated as an adult with an adult body, and the negative prompt rules out anything childlike', () => {
    const db = story();
    const prompt = explicitImagePrompt(db, defaultShot(db));
    const people = prompt.positive.match(/Person \d: [^.]*\./g) ?? [];
    expect(people).toHaveLength(2);
    for (const line of people) expect(line).toMatch(/an adult (man|woman|adult), \d{2} years old, with a fully adult body/);
    expect(prompt.positive).toContain('29 years old');
    expect(prompt.positive).toContain('31 years old');
    expect(prompt.negative).toBe(ADULT_NEGATIVE);
    expect(ADULT_NEGATIVE).toMatch(/child.*minor.*underage.*teen/);
  });

  test('appearance is cleaned of anything that pulls a person younger', () => {
    expect(cleanSheetField('Petite, young-looking, short dark-red hair, sharp green eyes.')).toBe('short dark-red hair, sharp green eyes.');
    expect(cleanSheetField('A girl with "quotes" and {braces}')).toBe('A with quotes and braces');
    const db = story();
    expect(explicitImagePrompt(db, defaultShot(db)).positive).not.toMatch(/petite|young/i);
  });

  test('someone under 18 or with no stated age blocks the request before anything is sent', async () => {
    const db = story();
    const withLily: ExplicitShot = { ...defaultShot(db), castIds: [playerId(db), id(db, 'Lily')] };
    expect(checkShot(db, withLily)).toEqual({ ok: false, reason: "Lily can't be in an explicit picture (no-age)" });
    expect(() => explicitImagePrompt(db, withLily)).toThrow('No picture');

    const young = { ...db, state: { ...db.state, player: { ...db.state.player, age: 17, birthYear: 2009 } } };
    expect(checkShot(young, defaultShot(young)).ok).toBe(false);
    expect(canPictureThis(young)).toBe(false);
    expect(() => referenceSheetPrompt(db, id(db, 'Lily'))).toThrow();

    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      await expect(paintExplicit(db, withLily, 'wiro')).rejects.toThrow('No picture');
      await expect(paintExplicit(db, withLily, 'runware')).rejects.toThrow('No picture');
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(0);
  });
});

describe('explicit references', () => {
  test('never an uploaded photo: only in-app reference sheets or portraits painted without a face reference', () => {
    let db = story();
    const mara = id(db, 'Mara Vance');
    const daniel = id(db, 'Daniel Okafor');
    // Uploads: the player's face and outfit, and a face reference for Mara.
    db = {
      ...db,
      state: { ...db.state, player: { ...db.state.player, faceImage: 'img:uploaded-player-face', outfitImage: 'img:uploaded-outfit' } },
      characterFaces: [{ entityId: mara, image: 'img:uploaded-mara-face', addedAt: 1 }],
      portraits: [{ id: 'p', image: 'img:player-portrait', signature: { age: 29, outfit: 'x', expression: 'calm', setting: 'indoors' }, inStoryDate: db.state.inStoryDate, location: 'x', createdAt: 1 }],
      characterPortraits: [
        { id: 'c1', entityId: mara, image: 'img:mara-from-face', signature: {} as never, usedFace: true, inStoryDate: db.state.inStoryDate, createdAt: 1 },
        { id: 'c2', entityId: daniel, image: 'img:daniel-from-text', signature: {} as never, usedFace: false, inStoryDate: db.state.inStoryDate, createdAt: 1 },
      ],
    };
    const refs = explicitReferences(db, [playerId(db), mara, daniel]);
    expect(refs.map((ref) => ref.image)).toEqual(['img:daniel-from-text']);
    const all = JSON.stringify(explicitImagePrompt(db, defaultShot(db)));
    expect(all).not.toMatch(/uploaded|from-face|player-portrait/);

    // A generated reference sheet is used, for the player too.
    db = addExplicitRef(db, playerId(db), 'img:player-sheet');
    db = addExplicitRef(db, mara, 'img:mara-sheet');
    expect(explicitImagePrompt(db, defaultShot(db)).references.map((ref) => ref.image)).toEqual(['img:player-sheet', 'img:mara-sheet']);
    expect(explicitImagePrompt(db, defaultShot(db)).positive).toContain('matches reference image 2');
  });

  test('reference sheets are non-explicit and come from written appearance only', () => {
    const db = story();
    const prompt = referenceSheetPrompt(db, id(db, 'Mara Vance'));
    expect(prompt).toContain('31 years old, with a fully adult face and body');
    expect(prompt).toContain('everyday clothes');
    expect(prompt).not.toMatch(/explicit|nude|PURPLE/i);
  });
});

describe('storage and privacy', () => {
  test('explicit images are kept with the save but left out of exports unless chosen', () => {
    let db = story();
    db = addExplicitImage(db, { image: 'img:pic', shot: defaultShot(db), provider: 'wiro', model: 'm' });
    db = addExplicitRef(db, playerId(db), 'img:sheet');
    db = pushSnapshot(db);
    expect(db.explicitImages).toHaveLength(1);
    const exported = withoutExplicit(db);
    expect(exported.explicitImages).toBeUndefined();
    expect(exported.explicitRefs).toBeUndefined();
    expect(JSON.stringify(exported)).not.toContain('img:pic');
    expect(JSON.stringify(exported)).not.toContain('img:sheet');
    // Notifications never mention pictures' content.
    expect(notificationText('image')).toBe('A picture is ready.');
  });

  test('Picture this only shows in an intimate scene everyone may be in', () => {
    const db = story();
    expect(canPictureThis(db)).toBe(true);
    const none = { ...db, state: { ...db.state, sceneMode: { ...db.state.sceneMode!, sex: undefined } } };
    expect(canPictureThis(none)).toBe(false);
  });
});
