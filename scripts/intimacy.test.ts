// The adult layer (session A): content profile, people's own desires, the
// intimacy ladder at the story's pacing, memory, the post-check, and the two
// hard limits in code (adults only, no real people).
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
import {
  CORRECTIVE_NOTE,
  FADE_TO_BLACK_LINE,
  PACING_BEATS,
  applyIntimateScene,
  canBeIntimate,
  entityCanBeIntimate,
  formatIntimacyBlock,
  notificationText,
  postCheckDecision,
  stageLabel,
} from '../lib/rpg/intimacy';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { buildExtractionPrompt, buildNarrationPrompt, buildSceneSummaryPrompt } from '../lib/rpg/prompt';
import { resolveTurnMode } from '../lib/rpg/sceneMode';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import { testSeedInput } from './fixtures/testWorld';
import type { AppDatabase, ContentProfile } from '../lib/rpg/types';

function story(pacing: ContentProfile['pacing'] = 'natural'): AppDatabase {
  const input = testSeedInput();
  input.content = {
    pacing,
    interests: [{ label: 'slow teasing', weight: 'love' }, { label: 'banter', weight: 'like' }],
    limits: [{ label: 'cheating', kind: 'hard' }, { label: 'bruises', kind: 'soft' }],
    narratorVoice: 'warm and unhurried',
    vagueRecaps: true,
  };
  input.people = input.people.map((person) =>
    person.name === 'Mara Vance'
      ? { ...person, intimacy: { orientation: 'men and women', interestedInPlayer: 'could-grow', desires: ['being kissed slowly'], boundaries: ['anything in public'], style: 'teasing' } }
      : person
  );
  input.people.push(
    {
      name: 'Sam Hale',
      age: 28,
      gender: 'female',
      role: 'Bartender at The Anchor',
      appearance: 'Tall, freckles, a shaved head.',
      personality: 'Bold and direct.',
      speechStyle: 'Short and dry.',
      relationship: 'friendly',
      yourFeelings: { affinity: 4, note: '' },
      theirFeelings: { affinity: 4, note: '' },
      alive: true,
      knownName: true,
      intimacy: { orientation: 'men', interestedInPlayer: 'yes', desires: [], boundaries: [] },
    },
    {
      name: 'Lily',
      gender: 'female',
      role: 'Regular at the bar',
      appearance: 'Curly hair, a yellow raincoat.',
      personality: 'Chatty.',
      speechStyle: 'Fast.',
      relationship: 'friendly',
      yourFeelings: { affinity: 4, note: '' },
      theirFeelings: { affinity: 4, note: '' },
      alive: true,
      knownName: true,
      // No age written: the seed keeps her intimacy section, but the hard check blocks her.
      intimacy: { orientation: 'men', interestedInPlayer: 'yes', desires: [], boundaries: [] },
    }
  );
  input.opening = { ...input.opening, castNames: ['Mara Vance', 'Sam Hale', 'Lily'] };
  return normalizeDatabase(seedDatabase('slot_intimacy', 'Intimacy', input));
}

function play(db: AppDatabase, narration: string, state: Record<string, unknown> | null, input = 'I lean in.'): AppDatabase {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = state ? convertStateBlock(state).diff : null;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

const entity = (db: AppDatabase, name: string) => db.entities.find((item) => item.name === name)!;
const bond = (db: AppDatabase, name: string) => db.bonds.find((item) => item.entityId === entity(db, name).id)!;
const narrator = (db: AppDatabase, input = 'I smile.') => buildNarrationPrompt(db, input).messages.map((m) => m.content).join('\n');

describe('hard limits in code', () => {
  test('canBeIntimate: stated adults only, no childlike descriptions, no real people', () => {
    expect(canBeIntimate({ age: 25 }).ok).toBe(true);
    expect(canBeIntimate({ age: 18 }).ok).toBe(true);
    expect(canBeIntimate({ age: 17 })).toEqual({ ok: false, reason: 'under-18' });
    expect(canBeIntimate({})).toEqual({ ok: false, reason: 'no-age' });
    expect(canBeIntimate({ age: null })).toEqual({ ok: false, reason: 'no-age' });
    expect(canBeIntimate({ age: 30, realPerson: true })).toEqual({ ok: false, reason: 'real-person' });
    expect(canBeIntimate({ age: 900, appearance: 'An ageless being who looks like a child.' })).toEqual({ ok: false, reason: 'childlike' });
    expect(canBeIntimate({ age: 19, role: 'High-schooler' })).toEqual({ ok: false, reason: 'childlike' });
    expect(canBeIntimate({ age: 22, appearance: 'Petite, a teenage look about her.' })).toEqual({ ok: false, reason: 'childlike' });
  });

  test('the seeded cast is checked: Lily has no age, so she can never be part of an intimate scene', () => {
    const db = story();
    expect(entityCanBeIntimate(db, entity(db, 'Mara Vance')).ok).toBe(true);
    expect(entityCanBeIntimate(db, entity(db, 'Lily'))).toEqual({ ok: false, reason: 'no-age' });

    // The tracker says an intimate scene starts with Lily: it doesn't.
    const blocked = applyIntimateScene(db, true, [entity(db, 'Lily').id], false);
    expect(blocked.state.sceneMode?.intimateWith).toBeUndefined();
    expect(resolveTurnMode(blocked, 'I kiss her.').mode).not.toBe('intimate');

    // Her ladder never reaches a physical stage, however often the page says so.
    let next = db;
    for (let i = 0; i < 12; i += 1) {
      next = play(next, 'Lily laughs.', { intimacy_stage_changed: [{ character_id: 'lily', stage: 'lovers' }] });
    }
    expect(bond(next, 'Lily').intimacyStage ?? 0).toBeLessThan(3);

    // The tracker is told who can never be part of anything sexual.
    const tracker = buildExtractionPrompt(db, 'Hi.', 'Lily waves.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('INTIMACY CHECKS');
    expect(tracker).toMatch(/Never part of anything sexual[^\n]*lily \(has no stated age\)/);
  });

  test('a player who is not a stated adult gets no intimacy at all', () => {
    const db = story();
    const young = { ...db, state: { ...db.state, player: { ...db.state.player, age: 16, birthYear: 2010 } } };
    expect(formatIntimacyBlock(young)).toContain('no romance or sexual content');
    expect(applyIntimateScene(young, true, [entity(young, 'Mara Vance').id], false).state.sceneMode?.intimateWith).toBeUndefined();
  });

  test('the post-check rewrites once, then fades to black', () => {
    expect(postCheckDecision(null, 0)).toBe('keep');
    expect(postCheckDecision({}, 0)).toBe('keep');
    expect(postCheckDecision({ limitCrossed: true }, 0)).toBe('rewrite');
    expect(postCheckDecision({ ageRuleCrossed: true }, 0)).toBe('rewrite');
    expect(postCheckDecision({ ageRuleCrossed: true }, 1)).toBe('fade');
    expect(CORRECTIVE_NOTE).toContain('Write it again');
    expect(FADE_TO_BLACK_LINE.length).toBeGreaterThan(0);

    // The tracker's flags reach the diff.
    const { diff } = convertStateBlock({ limit_crossed: true, age_rule_crossed: false });
    expect(diff?.limitCrossed).toBe(true);
    expect(diff?.ageRuleCrossed).toBeUndefined();
    const required = TURN_STATE_SCHEMA.required as readonly string[];
    for (const field of ['intimate_scene', 'intimacy_stage_changed', 'first', 'preference_learned', 'outfit_changed', 'limit_crossed', 'age_rule_crossed']) {
      expect(required).toContain(field);
    }
  });
});

describe('content profile in the narrator prompt', () => {
  test('reaches the narrator as prose in a cached block, never JSON', () => {
    const db = story();
    const prompt = buildNarrationPrompt(db, 'I smile.');
    const system = prompt.messages[0];
    const cached = (system.parts ?? []).filter((part) => part.cache).map((part) => part.text).join('\n');
    expect(cached).toContain('INTIMACY');
    expect(cached).toContain('the player loves slow teasing');
    expect(cached).toContain('Pacing: Natural');
    expect(cached).toContain('warm and unhurried');
    const block = cached.slice(cached.indexOf('INTIMACY ('), cached.indexOf('STORY SO FAR'));
    expect(block).not.toMatch(/[{}[\]]|"\w+":|pacing:|weight/);
    // A profile edit changes only that block, so the rules prefix stays cached.
    const before = system.parts![0].text;
    const edited = { ...db, content: { ...db.content, pacing: 'fast' as const } };
    expect(buildNarrationPrompt(edited, 'I smile.').messages[0].parts![0].text).toBe(before);
  });

  test('hard limits appear only as things never to write; soft limits stay off-page', () => {
    const text = narrator(story());
    const lines = text.split('\n').filter((line) => line.toLowerCase().includes('cheating'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^- Never write, mention or hint at/);
    expect(text).not.toMatch(/enjoys[^\n]*cheating/);
    expect(text).toContain('Off-page only: bruises');
  });

  test('a person\'s own desires and boundaries reach the narrator once things are close', () => {
    let db = story('fast');
    expect(narrator(db)).toContain('heart: could be open to you');
    expect(narrator(db)).not.toContain("won't: anything in public");
    db = play(db, 'Mara flirts back.', { intimacy_stage_changed: [{ character_id: 'mara-vance', stage: 'interest' }] });
    db = play(db, 'Mara flirts back.', { intimacy_stage_changed: [{ character_id: 'mara-vance', stage: 'flirting' }] });
    const text = narrator(db);
    expect(text).toContain("won't: anything in public");
    expect(text).toContain('likes: being kissed slowly');
    expect(text).toContain('between you: flirting');
  });
});

describe('relationship progression', () => {
  test('stages advance only at the pacing threshold, one step at a time', () => {
    const beats = PACING_BEATS.natural;
    expect(beats).toBe(2);
    let db = story('natural');
    // Jumping straight to "lovers" is one step forward, and only after enough beats.
    db = play(db, 'Mara holds your gaze.', { intimacy_stage_changed: [{ character_id: 'mara-vance', stage: 'lovers' }] });
    expect(bond(db, 'Mara Vance').intimacyStage ?? 0).toBe(0);
    db = play(db, 'Mara holds your gaze.', { intimacy_stage_changed: [{ character_id: 'mara-vance', stage: 'lovers' }] });
    expect(bond(db, 'Mara Vance').intimacyStage).toBe(1);

    let fast = story('fast');
    fast = play(fast, 'Sam grins.', { intimacy_stage_changed: [{ character_id: 'sam-hale', stage: 'interest' }] });
    expect(bond(fast, 'Sam Hale').intimacyStage).toBe(1);

    let slow = story('slow-burn');
    for (let i = 0; i < 3; i += 1) slow = play(slow, 'Sam grins.', { intimacy_stage_changed: [{ character_id: 'sam-hale', stage: 'interest' }] });
    expect(bond(slow, 'Sam Hale').intimacyStage ?? 0).toBe(0);
    slow = play(slow, 'Sam grins.', { intimacy_stage_changed: [{ character_id: 'sam-hale', stage: 'interest' }] });
    expect(bond(slow, 'Sam Hale').intimacyStage).toBe(1);

    // A step back is immediate.
    const cooled = play(fast, 'Sam turns away.', { intimacy_stage_changed: [{ character_id: 'sam-hale', stage: 'none' }] });
    expect(bond(cooled, 'Sam Hale').intimacyStage).toBe(0);
  });

  test('two adult partners go from flirting to lovers at natural pacing, and remember', () => {
    let db = story('natural');
    const steps = ['interest', 'flirting', 'first kiss', 'lovers'];
    for (const stage of steps) {
      for (let i = 0; i < PACING_BEATS.natural; i += 1) {
        db = play(db, `Mara and you, ${stage}.`, {
          intimacy_stage_changed: [
            { character_id: 'mara-vance', stage },
            { character_id: 'sam-hale', stage },
          ],
        });
      }
    }
    expect(stageLabel(db, bond(db, 'Mara Vance').intimacyStage)).toBe('lovers');
    expect(stageLabel(db, bond(db, 'Sam Hale').intimacyStage)).toBe('lovers');

    // Firsts and learned preferences are kept and reach the narrator.
    db = play(db, 'Mara kisses you, slow.', {
      first: [{ character_id: 'mara-vance', what: 'first night together' }],
      preference_learned: [{ character_id: 'mara-vance', preference: 'being teased', about_player: true }],
      outfit_changed: [{ character_id: 'mara-vance', outfit: 'your shirt, nothing else', position: 'curled up beside you' }],
    });
    expect(bond(db, 'Mara Vance').firsts?.[0]).toMatchObject({ what: 'first night together' });
    expect(bond(db, 'Mara Vance').learnedPreferences).toEqual(['knows you like being teased']);
    expect(entity(db, 'Mara Vance').currentLook).toBe('your shirt, nothing else');
    const text = narrator(db);
    expect(text).toContain('they remember: knows you like being teased');
    expect(text).toContain('where they are now: curled up beside you');
  });
});

describe('intimate scenes', () => {
  test('the scene mode follows the tracker, and fade to black holds for the scene', () => {
    let db = story('fast');
    db = play(db, 'Mara pulls you close.', { intimate_scene: true, characters_present: ['mara-vance'] });
    expect(db.state.sceneMode?.intimateWith).toEqual([entity(db, 'Mara Vance').id]);
    const mode = resolveTurnMode(db, '*I kiss her neck.*');
    expect(mode.mode).toBe('intimate');
    expect(buildNarrationPrompt(db, '*I kiss her neck.*').messages[1].content).toContain('SCENE MODE: intimate with Mara');

    const faded = { ...db, state: { ...db.state, sceneMode: { ...db.state.sceneMode!, fadeToBlack: true } } };
    expect(buildNarrationPrompt(faded, '*I kiss her.*').messages[1].content).toContain('fade to black');

    // Leaving the scene ends it.
    expect(resolveTurnMode(db, 'I leave the bar.').mode).not.toBe('intimate');
    const ended = play(db, 'Later, you walk home.', { intimate_scene: false });
    expect(ended.state.sceneMode?.intimateWith).toBeUndefined();
  });

  test('intimate turns are summarised, never kept verbatim, and recaps stay vague', () => {
    let db = story('fast');
    db = play(db, 'Mara pulls you close. A very explicit line.', { intimate_scene: true, characters_present: ['mara-vance'], scene_ended: true });
    const reply = db.rawLog.filter((entry) => entry.role === 'assistant').at(-1)!;
    expect(reply.intimate).toBe(true);
    const memory = db.events.find((event) => event.tags.includes('intimate'));
    expect(memory?.summary).toBe('An intimate moment with Mara Vance.');
    expect(memory?.summary).not.toContain('explicit line');

    const summary = buildSceneSummaryPrompt(db, db.rawLog.filter((entry) => entry.kind === 'story')).messages[1].content;
    expect(summary).toContain('one plain, non-explicit sentence');
  });

  test('steer chips and OOC notes are one-turn lines outside the story', () => {
    const db = story();
    const steered = buildNarrationPrompt(db, 'I wait.', { steer: 'slower', oocNote: 'Make Mara a bit shyer tonight.' }).messages[1].content;
    expect(steered).toContain("PLAYER'S STEER: slow down.");
    expect(steered).toContain('OUT-OF-CHARACTER NOTE FROM THE PLAYER');
    expect(steered).toContain('Make Mara a bit shyer tonight.');
    expect(buildNarrationPrompt(db, 'I wait.').messages[1].content).not.toContain('OUT-OF-CHARACTER');
  });

  test('notifications never carry story text', () => {
    const db = story();
    const storyText = [db.state.location, db.state.player.name, ...db.entities.map((e) => e.name)].map((t) => t.toLowerCase());
    for (const kind of ['reply', 'image', 'letter', 'generic'] as const) {
      const text = notificationText(kind).toLowerCase();
      for (const word of storyText) expect(text).not.toContain(word);
    }
  });
});
