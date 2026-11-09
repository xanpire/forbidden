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
import { NARRATION_SYSTEM, buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import {
  CONVERSATION_MODE_MINIMUM_SECONDS,
  sceneOptionInput,
  readPlayerInput,
  resolveTurnMode,
  setSceneModeOverride,
} from '../lib/rpg/sceneMode';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_modes', 'Modes'));

type Reply = {
  beat?: string | null;
  with?: string[];
  pace?: string | null;
  ended?: boolean;
  present?: string[];
};

/** One turn the way game.tsx plays it: prompt → reply saved with its mode → state step. */
function play(db: AppDatabase, input: string, narration: string, reply: Reply | null) {
  const prompt = buildNarrationPrompt(appendStoryMessage(db, 'user', input, null, 0, 0), input);
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  next.rawLog[next.rawLog.length - 1] = { ...next.rawLog[next.rawLog.length - 1], sceneMode: prompt.sceneMode.mode };
  const block = reply
    ? {
        turn_kind: reply.beat ?? null,
        talking_with: reply.with ?? [],
        scene_pace: reply.pace ?? null,
        scene_ended: reply.ended ?? false,
        characters_present: reply.present ?? ['mara-vance'],
      }
    : null;
  const converted = block ? convertStateBlock(block).diff : null;
  const diff = converted ? resolveCharacterRefs(next, converted) : null;
  const result = applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;

  return { db: result, prompt, reply: result.rawLog.find((entry) => entry.id === turnLogId)! };
}

const promptText = (db: AppDatabase, input: string) =>
  buildNarrationPrompt(db, input).messages.map((message) => message.content).join('\n');

/** Two exchanges with Mara, so the next spoken line is a conversation. */
function talking() {
  let db = seed();
  db = play(db, '"Is it done?"', '"It is done," Mara says. He does not look at you.', {
    beat: 'exchange',
    with: ['mara-vance'],
    pace: 'conversation',
  }).db;
  db = play(db, '"Why?"', '"Because it had to be," he says. "Ask me again when we are far from here."', {
    beat: 'exchange',
    with: ['mara-vance'],
    pace: 'conversation',
  }).db;
  return db;
}

describe('reading the player\'s input', () => {
  test('speech, scene changes and small moves in place', () => {
    expect(readPlayerInput('"Where are we going?"').speaks).toBe(true);
    expect(readPlayerInput('*I look deep in Mara\'s eyes* "This is not like you."')).toMatchObject({
      speaks: true,
      changesScene: false,
    });
    expect(readPlayerInput('*I follow her.*').changesScene).toBe(true);
    expect(readPlayerInput('*I say nothing and look away.*')).toMatchObject({ changesScene: false });
    expect(readPlayerInput('*I stand up and leave.*').changesScene).toBe(true);
    expect(sceneOptionInput('Pull her closer')).toBe('*Pull her closer.*');
  });
});

describe('conversation mode', () => {
  test('a single instruction never flips it', () => {
    let db = seed();
    db = play(db, '*I wait.*', '"Follow me," Mara says, already turning away.', {
      beat: 'instruction',
      with: ['mara-vance'],
    }).db;

    expect(db.state.sceneMode?.exchangeStreak).toBe(0);
    expect(resolveTurnMode(db, '*I follow her.*').mode).toBe('normal');
    expect(resolveTurnMode(db, '*I follow her.*').lean).toBe(false);
  });

  test('slow to start: one exchange leans, you answering out loud settles it', () => {
    let db = seed();
    const first = play(db, '"Is it done?"', '"It is done," Mara says.', {
      beat: 'exchange',
      with: ['mara-vance'],
      pace: 'conversation',
    });
    db = first.db;
    expect(first.reply.sceneMode).toBe('normal');
    expect(db.state.sceneMode?.exchangeStreak).toBe(1);
    expect(db.state.sceneMode?.partners).toHaveLength(1);

    // Doing something in place keeps it leaning, not full conversation.
    expect(resolveTurnMode(db, '*I stare at her.*')).toMatchObject({ mode: 'normal', lean: true });
    expect(promptText(db, '*I stare at her.*')).toContain('SCENE MODE: talk is building with Mara Vance');
    // Answering in speech makes it a conversation by the second reply.
    expect(resolveTurnMode(db, '"Why?"')).toMatchObject({ mode: 'conversation', with: ['Mara Vance'] });
  });

  test('after two exchanges small actions stay in it, and the prompt says so', () => {
    const db = talking();
    expect(db.state.sceneMode?.exchangeStreak).toBe(2);
    expect(db.state.sceneMode?.current).toBe('conversation');

    const look = '*I look deep in Mara\'s eyes* "This is not like you."';
    expect(resolveTurnMode(db, look).mode).toBe('conversation');
    expect(resolveTurnMode(db, '*I say nothing and look away.*').mode).toBe('conversation');
    expect(promptText(db, look)).toContain('SCENE MODE: conversation with Mara Vance');
  });

  test('a remark mid-conversation keeps it going; leaving ends it with a transition', () => {
    let db = talking();
    db = play(db, '"Fine."', '*Mara nods.* "Good."', { beat: 'remark', with: ['mara-vance'], pace: 'conversation' }).db;
    expect(resolveTurnMode(db, '"And then?"').mode).toBe('conversation');

    const leave = resolveTurnMode(db, '*I stand up and leave.*');
    expect(leave).toMatchObject({ mode: 'normal', ending: 'conversation' });
    expect(promptText(db, '*I stand up and leave.*')).toContain('ends the conversation');

    db = play(db, '*I stand up and leave.*', 'You step out into the rain. Behind you, the fire crackles.', {
      beat: 'action',
      pace: 'travel',
    }).db;
    expect(db.state.sceneMode?.exchangeStreak).toBe(0);
    expect(resolveTurnMode(db, '*I keep going.*').mode).toBe('normal');
  });

  test('someone joining turns it into a group conversation', () => {
    let db = talking();
    db = play(db, '"Who is that?"', '"Jonah," Mara says. The big man grins. "Nice to meet you, kid."', {
      beat: 'exchange',
      with: ['mara-vance', 'jonah-pike'],
      pace: 'conversation',
      present: ['mara-vance', 'jonah-pike'],
    }).db;
    expect(db.state.sceneMode?.exchangeStreak).toBe(3);
    expect(db.state.sceneMode?.partners).toHaveLength(2);
  });

  test('a conversation-mode turn takes seconds, not minutes', () => {
    const db = talking();
    const before = db.state.inStoryDate;
    const turn = play(db, '"Then tell me."', '"Not yet."', { beat: 'exchange', with: ['mara-vance'], pace: 'conversation' });
    expect(turn.reply.sceneMode).toBe('conversation');
    expect(turn.reply.elapsedSeconds).toBe(CONVERSATION_MODE_MINIMUM_SECONDS);
    expect(turn.db.state.inStoryDate).not.toEqual(before);
  });
});
describe('manual override', () => {
  test('forced conversation lasts through a walk', () => {
    let db = setSceneModeOverride(seed(), 'conversation');
    expect(resolveTurnMode(db, '*We walk north together.*')).toMatchObject({ mode: 'conversation', manual: true });

    db = play(db, '*We walk north together.* "Tell me about the Vance family."', '"They are dangerous," Mara says as the road climbs.', {
      beat: 'travel',
      pace: 'travel',
    }).db;
    expect(db.state.sceneMode?.override).toBe('conversation');
    expect(resolveTurnMode(db, '"How dangerous?"').mode).toBe('conversation');
  });

  test('switching it off holds until the conversation is over, then automatic resumes', () => {
    let db = setSceneModeOverride(talking(), 'normal');
    expect(resolveTurnMode(db, '"Why?"')).toMatchObject({ mode: 'normal', manual: true });
    expect(promptText(db, '"Why?"')).toContain('normal narration (the player chose this)');

    db = play(db, '*I walk away.*', 'You walk into the trees alone.', { beat: 'action', pace: 'travel', present: [] }).db;
    expect(db.state.sceneMode?.override).toBeUndefined();
    expect(setSceneModeOverride(db, null).state.sceneMode?.override).toBeUndefined();
  });

  test('the choice and the streak survive a reload', () => {
    const db = setSceneModeOverride(talking(), 'normal');
    const reloaded = normalizeDatabase(JSON.parse(JSON.stringify(db)));
    expect(reloaded.state.sceneMode).toMatchObject({ override: 'normal', exchangeStreak: 2, current: 'conversation' });
  });
});

describe('prompts and schema', () => {
  test('the narrator rules describe the modes without any state field names', () => {
    expect(NARRATION_SYSTEM).toContain('SCENE MODES');
    expect(NARRATION_SYSTEM).not.toContain('talking_with');
    expect(NARRATION_SYSTEM).not.toContain('turn_kind');
  });

  test('normal turns add no mode line', () => {
    expect(promptText(seed(), '*I wait.*')).not.toContain('SCENE MODE:');
  });

  test('the state tracker tags the turn and sees the mode the reply used', () => {
    expect(TURN_STATE_SCHEMA.required).toContain('turn_kind');
    expect(TURN_STATE_SCHEMA.required).toContain('talking_with');

    let db = appendStoryMessage(seed(), 'user', '"Hi"', null, 0, 0);
    db = appendStoryMessage(db, 'assistant', '"Hello."', null, 0, 0);
    db.rawLog[db.rawLog.length - 1] = { ...db.rawLog[db.rawLog.length - 1], sceneMode: 'conversation' };
    const text = buildExtractionPrompt(db, '"Hi"', '"Hello."').messages.map((message) => message.content).join('\n');
    expect(text).toContain('SCENE MODE THIS TURN: conversation');
    expect(text).toContain('TURN: turn_kind tags how this turn played');
  });

  test('a turn with no state reply still keeps the streak sensible', () => {
    let db = seed();
    db = play(db, '"Is it done?"', '"It is done," Mara says.', null).db;
    expect(db.state.sceneMode?.lastKind).toBe('exchange');
  });
});
