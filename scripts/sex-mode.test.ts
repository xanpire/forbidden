// Sex mode: starts and ends by itself, four next moves, the scene strip, the
// hard-limit gate, pacing and variety, the aftermath and the memory.
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
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { normalizeSceneMode, resolveTurnMode, setSceneModeOverride } from '../lib/rpg/sceneMode';
import { SEX_OPTION_COUNT, sexOptions, sexStrip, sexualMove } from '../lib/rpg/sexMode';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase } from '../lib/rpg/types';
import { seedDatabase } from './fixtures/seed';
import { testSeedInput } from './fixtures/testWorld';

function story(): AppDatabase {
  const input = testSeedInput();
  input.people = input.people.map((person) =>
    person.name === 'Mara Vance'
      ? { ...person, intimacy: { orientation: 'men and women', interestedInPlayer: 'yes', desires: ['being kissed slowly', 'taking the lead'], boundaries: ['anything in public'] } }
      : person
  );
  input.people.push(
    {
      name: 'Sam Hale',
      age: 28,
      gender: 'female',
      role: 'Bartender',
      appearance: 'Tall, freckles, a shaved head.',
      personality: 'Bold.',
      speechStyle: 'Dry.',
      relationship: 'friendly',
      yourFeelings: { affinity: 4, note: '' },
      theirFeelings: { affinity: 4, note: '' },
      alive: true,
      knownName: true,
      intimacy: { orientation: 'men and women', interestedInPlayer: 'yes', desires: [], boundaries: [] },
    },
    {
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
    }
  );
  input.opening = { ...input.opening, location: 'Your flat on Kell Street', castNames: ['Mara Vance'] };
  return normalizeDatabase(seedDatabase('slot_sex', 'Sex', input));
}

const off = { on: null, with: [], phase: null, done: [], ended: null, options: [] };

/** One turn, the way game.tsx plays it: the mode is decided first and saved on the reply. */
function play(db: AppDatabase, input: string, narration: string, state: Record<string, unknown>): AppDatabase {
  const mode = resolveTurnMode(db, input).mode;
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  next = { ...next, rawLog: next.rawLog.map((entry) => (entry.id === turnLogId ? { ...entry, sceneMode: mode } : entry)) };
  const reply = convertStateBlock({ characters_present: ['mara-vance'], ...state }).diff;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

const lastReply = (db: AppDatabase) => db.rawLog.filter((entry) => entry.role === 'assistant').at(-1)!;
const mara = (db: AppDatabase) => db.entities.find((entity) => entity.name === 'Mara Vance')!;

describe('sex mode starts and ends by itself', () => {
  test('the player\'s own sexual move starts it, with whoever here is an adult; talk about sex does not', () => {
    const db = story();
    expect(sexualMove('*I pull her dress off and kiss her breasts.*')).toBe(true);
    expect(sexualMove('"Do you want to have sex?" I ask.')).toBe(false);
    expect(sexualMove("*I don't undress her.*")).toBe(false);

    const turn = resolveTurnMode(db, '*I pull her dress off and kiss her breasts.*');
    expect(turn.mode).toBe('intimate');
    expect(turn.sex?.with).toEqual([mara(db).id]);
    expect(resolveTurnMode(db, '"Rough day?"').mode).not.toBe('intimate');

    const prompt = buildNarrationPrompt(db, '*I pull her dress off.*').messages[1].content;
    expect(prompt).toContain('SCENE MODE: sex with Mara');
    expect(prompt).toContain('fully explicit');
    expect(prompt).toContain('a will of their own');
  });

  test('the tracker starts it too, and the scene is saved with its partners', () => {
    const db = play(story(), '*I lean in.*', 'Mara pulls you onto the couch and straddles you.', {
      sex: { ...off, on: true, with: ['mara-vance'], phase: 'build-up', done: ['her on your lap'], options: [] },
    });
    const sex = db.state.sceneMode?.sex;
    expect(sex?.with).toEqual([mara(db).id]);
    expect(sex?.done).toEqual(['her on your lap']);
    expect(resolveTurnMode(db, '*I kiss her neck.*').mode).toBe('intimate');
  });

  test('when the act ends, one aftermath reply, then normal mode and a memory', () => {
    let db = play(story(), '*I strip her naked.*', 'She laughs and pulls you down onto the bed.', {
      sex: { ...off, on: true, with: ['mara-vance'] },
    });
    expect(db.state.sceneMode?.sex?.turns).toBe(1);
    db = play(db, '*I go faster.*', 'She comes with a cry, and you follow her over the edge.', {
      sex: { ...off, on: true, with: ['mara-vance'], phase: 'climax', ended: 'finished' },
    });
    expect(db.state.sceneMode?.sex?.ended).toBe('finished');
    expect(lastReply(db).sceneOptions).toBeUndefined();

    const after = resolveTurnMode(db, '*I hold her.*');
    expect(after.mode).toBe('normal');
    expect(after.aftermath?.ended).toBe('finished');
    expect(buildNarrationPrompt(db, '*I hold her.*').messages[1].content).toContain('One normal-length reply for the aftermath');

    db = play(db, '*I hold her.*', 'Afterwards you lie tangled in the sheets, talking about nothing.', { sex: off });
    expect(db.state.sceneMode?.sex).toBeUndefined();
    expect(mara(db).scenePosition).toBeUndefined();
    expect(resolveTurnMode(db, '*I get up.*').mode).toBe('normal');
    // The scene goes to the summary queue, so it becomes a memory like any other.
    expect((db.memoryJobs ?? []).some((job) => job.kind === 'scene')).toBe(true);
    expect(db.rawLog.filter((entry) => entry.intimate).length).toBeGreaterThan(0);
  });

  test('leaving the scene ends it without an aftermath', () => {
    let db = play(story(), '*I undress her.*', 'Her dress hits the floor.', { sex: { ...off, on: true, with: ['mara-vance'] } });
    expect(resolveTurnMode(db, 'I leave the flat.').mode).toBe('normal');
    db = play(db, 'I leave the flat.', 'You step out into the rain.', { sex: off, scene_ended: true });
    expect(db.state.sceneMode?.sex).toBeUndefined();
  });
});

describe('the chip forces it on or off', () => {
  test('on: starts with whoever here passes; off: ends it now', () => {
    let db = setSceneModeOverride(story(), 'intimate');
    const turn = resolveTurnMode(db, '*I look at her.*');
    expect(turn.mode).toBe('intimate');
    expect(turn.manual).toBe(true);

    db = play(db, '*I look at her.*', 'She smiles and pulls her top off.', { sex: off });
    expect(db.state.sceneMode?.sex?.with).toEqual([mara(db).id]);

    db = setSceneModeOverride(db, 'normal');
    expect(db.state.sceneMode?.sex).toBeUndefined();
    expect(resolveTurnMode(db, '*I kiss her.*').mode).toBe('normal');
    // The saved choice survives a reload.
    expect(normalizeSceneMode({ current: 'normal', exchangeStreak: 0, partners: [], override: 'intimate' })?.override).toBe('intimate');
  });
});

describe('four next moves', () => {
  test('always exactly four, from the tracker first, filled from the scene, never twice', () => {
    let db = play(story(), '*I undress her.*', 'Her dress slides off.', {
      sex: { ...off, on: true, with: ['mara-vance'], options: ['Pull her onto the bed', 'pull her onto the bed', 'Kiss her slowly'] },
    });
    const options = lastReply(db).sceneOptions!;
    expect(options).toHaveLength(SEX_OPTION_COUNT);
    expect(options[0]).toBe('Pull her onto the bed');
    expect(options[1]).toBe('Kiss her slowly');
    expect(new Set(options.map((option) => option.toLowerCase())).size).toBe(SEX_OPTION_COUNT);

    db = play(db, '*Pull her onto the bed.*', 'She lands laughing.', {
      sex: { ...off, on: true, with: ['mara-vance'], options: ['A', 'B', 'C', 'D', 'E', 'F'] },
    });
    expect(lastReply(db).sceneOptions).toEqual(['A', 'B', 'C', 'D']);
    expect(sexOptions(db, [])).toHaveLength(SEX_OPTION_COUNT);
  });
});

describe('the scene strip', () => {
  test('shows each person\'s position and clothes, and the location; no meter', () => {
    let db = play(story(), '*I undress her.*', 'She sits on the edge of the bed in her underwear.', {
      sex: { ...off, on: true, with: ['mara-vance'] },
      outfit_changed: [{ character_id: 'mara-vance', outfit: 'black underwear', position: 'sitting on the edge of the bed' }],
    });
    let strip = sexStrip(db)!;
    expect(strip.location).toBe(db.state.location);
    expect(strip.people.map((person) => person.name)).toEqual(['You', 'Mara Vance']);
    expect(strip.people[1]).toMatchObject({ position: 'sitting on the edge of the bed', wearing: 'black underwear' });
    expect(JSON.stringify(strip)).not.toMatch(/arous|intensity|meter/i);

    // A change of position shows at once.
    db = play(db, '*Change position.*', 'She rolls you over and climbs on top.', {
      sex: { ...off, on: true, with: ['mara-vance'], done: ['her on top'] },
      outfit_changed: [{ character_id: 'mara-vance', outfit: 'nothing', position: 'on top of you' }],
    });
    strip = sexStrip(db)!;
    expect(strip.people[1]).toMatchObject({ position: 'on top of you', wearing: 'nothing' });
  });
});

describe('the hard-limit gate', () => {
  test('nobody without a stated adult age, and no under-18 player, can be in it', () => {
    let db = story();
    db = { ...db, state: { ...db.state, sceneCast: ['Lily'] } };
    expect(resolveTurnMode(db, '*I undress her.*').mode).not.toBe('intimate');
    const blocked = play(db, '*I undress her.*', 'Lily laughs.', { characters_present: ['lily'], sex: { ...off, on: true, with: ['lily'] } });
    expect(blocked.state.sceneMode?.sex).toBeUndefined();

    const young = { ...story(), state: { ...story().state, player: { ...story().state.player, age: 17, birthYear: 2009 } } };
    expect(resolveTurnMode(setSceneModeOverride(young, 'intimate'), '*I kiss her.*').mode).not.toBe('intimate');
    expect(play(young, '*I undress her.*', 'x', { sex: { ...off, on: true, with: ['mara-vance'] } }).state.sceneMode?.sex).toBeUndefined();
  });

  test('someone who fails the check never joins a scene under way', () => {
    let db = play(story(), '*I undress her.*', 'x', { sex: { ...off, on: true, with: ['mara-vance'] } });
    db = play(db, '*I kiss her.*', 'Lily walks in.', { characters_present: ['mara-vance', 'lily'], sex: { ...off, on: true, with: ['mara-vance', 'lily'] } });
    expect(db.state.sceneMode?.sex?.with).toEqual([mara(db).id]);
  });
});

describe('more than two people, pacing and variety', () => {
  test('each partner is tracked separately', () => {
    let db = { ...story(), state: { ...story().state, sceneCast: ['Mara Vance', 'Sam Hale'] } };
    db = play(db, '*I pull them both onto the bed.*', 'They tumble onto the bed with you.', {
      characters_present: ['mara-vance', 'sam-hale'],
      sex: { ...off, on: true, with: ['mara-vance', 'sam-hale'] },
      outfit_changed: [
        { character_id: 'mara-vance', outfit: 'nothing', position: 'kissing you' },
        { character_id: 'sam-hale', outfit: 'an open shirt', position: 'behind you' },
      ],
    });
    expect(db.state.sceneMode?.sex?.with).toHaveLength(2);
    const strip = sexStrip(db)!;
    expect(strip.people.map((person) => person.position)).toEqual(['', 'kissing you', 'behind you']);
    expect(buildNarrationPrompt(db, '*I kiss Sam.*').messages[1].content).toMatch(/SCENE MODE: sex with Mara Vance and Sam Hale/);
  });

  test('build-up, then escalation, then climax; what was done is not repeated', () => {
    let db = play(story(), '*I undress her.*', 'x', { sex: { ...off, on: true, with: ['mara-vance'], done: ['slow kisses'] } });
    expect(db.state.sceneMode?.sex?.phase).toBe('build-up');
    expect(buildNarrationPrompt(db, '*I kiss her.*').messages[1].content).toContain('no climax yet');
    db = play(db, '*I kiss her.*', 'x', { sex: { ...off, on: true, with: ['mara-vance'], done: ['oral on the couch'] } });
    // Two turns in, it escalates by itself; the phase never goes back.
    expect(db.state.sceneMode?.sex?.phase).toBe('escalation');
    db = play(db, '*I slow down.*', 'x', { sex: { ...off, on: true, with: ['mara-vance'], phase: 'build-up' } });
    expect(db.state.sceneMode?.sex?.phase).toBe('escalation');
    const prompt = buildNarrationPrompt(db, '*I slow down.*').messages[1].content;
    expect(prompt).toContain('Already done in this scene: slow kisses; oral on the couch');
    expect(prompt).toContain('Vary it');
  });
});

describe('the tracker', () => {
  test('is asked for the scene, and the schema carries it', () => {
    const db = play(story(), '*I undress her.*', 'x', { sex: { ...off, on: true, with: ['mara-vance'] } });
    const text = buildExtractionPrompt(db, '*I kiss her.*', 'She kisses back.').messages.map((m) => m.content).join('\n');
    expect(text).toContain('SEX\nUnder way with mara-vance');
    expect(text).toContain('exactly 4 short next moves');
    const schema = TURN_STATE_SCHEMA as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> };
    expect(Object.keys(schema.properties.sex.properties ?? {})).toEqual(['on', 'with', 'phase', 'done', 'ended', 'options']);
  });
});
