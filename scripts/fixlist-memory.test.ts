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

import { dateSortValue, shiftSeconds } from '../lib/rpg/calendar';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { factRef } from '../lib/rpg/facts';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep, correctTurnTime } from '../lib/rpg/memoryJobs';
import { buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import type { AppDatabase } from '../lib/rpg/types';

const seed = () => normalizeDatabase(seedDatabase('slot_fix', 'Fix'));

function play(db: AppDatabase, narration: string, state: Record<string, unknown> | null): AppDatabase {
  let next = appendStoryMessage(db, 'user', 'I keep going.', null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = state ? convertStateBlock(state).diff : null;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;

  return applyStateStep(next, diff, { turnLogId, userMessage: 'I keep going.', narration }, new Set()).db;
}

const fact = (db: AppDatabase, text: string) => db.facts.find((item) => item.text.includes(text));
const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const lastAssistant = (db: AppDatabase) => [...db.rawLog].reverse().find((entry) => entry.role === 'assistant')!;
const promptText = (db: AppDatabase) => buildNarrationPrompt(db, '*You wait.*').messages.map((m) => m.content).join('\n');

describe('5. one clock', () => {
  test('correcting a turn moves everything it stamped, and nothing from before', () => {
    let db = seed();
    const before = fact(db, 'Your mother')!.validFrom;
    db = play(db, 'Daniel finds you at the bar. "We need to talk about the shipments."', {
      time: { elapsed: 10, unit: 'minutes', clock_time: null },
      characters_present: ['daniel-okafor'],
      facts: [{ entity: 'daniel-okafor', fact: 'Daniel came to find you at The Anchor.', type: 'event', who_knows: ['player', 'daniel-okafor'], supersedes: [], claimed_by: null, lasts: null, days: null }],
    });
    const turn = lastAssistant(db);
    const stamped = fact(db, 'Daniel came to find you')!.validFrom;
    const end = db.state.inStoryDate;
    expect(stamped).toEqual(end);

    const corrected = correctTurnTime(db, turn.id, 70 * 60)!;
    const delta = (70 - (turn.elapsedSeconds ?? 0) / 60) * 60;
    const shiftedEnd = shiftSeconds(end, delta);

    expect(corrected.state.inStoryDate).toEqual(shiftedEnd);
    expect(fact(corrected, 'Daniel came to find you')!.validFrom).toEqual(shiftedEnd);
    expect(person(corrected, 'Daniel Okafor').lastSeen).toEqual(shiftedEnd);
    // Stamped before the turn: untouched.
    expect(fact(corrected, 'Your mother')!.validFrom).toEqual(before);
  });
});

describe('6. facts can expire or be replaced', () => {
  test('supersedes and facts_ended end the old fact', () => {
    let db = seed();
    const shop = fact(db, 'Your mother still runs the shop')!;
    const secret = fact(db, 'shipments at work that do not add up')!;
    db = play(db, 'Mara tells you your mother sold the shop last week.', {
      characters_present: ['mara-vance'],
      facts: [{ entity: 'player', fact: 'Your mother sold the shop under your old flat.', type: 'knowledge', who_knows: ['player', 'mara-vance'], supersedes: [factRef(shop)], claimed_by: null, lasts: null, days: null }],
      facts_ended: [factRef(secret)],
    });

    expect(fact(db, 'Your mother still runs the shop')!.validTo).toEqual(db.state.inStoryDate);
    expect(fact(db, 'shipments at work that do not add up')!.validTo).not.toBeNull();
    expect(fact(db, 'sold the shop')!.supersedes).toBe(shop.id);
    expect(promptText(db)).not.toContain('Your mother still runs the shop');
  });
  test('a passing condition ends at the next rest; an injury after its days', () => {
    let db = seed();
    db = play(db, 'You are worn out and your arm is cut.', {
      facts: [
        { entity: 'player', fact: 'You are utterly worn out.', type: 'condition', who_knows: ['player'], supersedes: [], claimed_by: null, lasts: 'until_rest', days: null },
        { entity: 'player', fact: 'A shallow cut runs down your left forearm.', type: 'injury', who_knows: ['player'], supersedes: [], claimed_by: null, lasts: 'days', days: 2 },
      ],
    });
    expect(fact(db, 'utterly worn out')!.untilRest).toBe(true);

    db = play(db, 'You sleep through the night.', { time: { elapsed: 8, unit: 'hours', clock_time: null }, scene_pace: 'downtime' });
    expect(fact(db, 'utterly worn out')!.validTo).not.toBeNull();
    expect(fact(db, 'shallow cut')!.validTo).toBeNull();

    db = play(db, 'Two days pass.', { time: { elapsed: 2, unit: 'days', clock_time: null }, scene_pace: 'downtime' });
    expect(fact(db, 'shallow cut')!.validTo).not.toBeNull();
  });

  test('a claim is stored as a claim, with who said it', () => {
    let db = seed();
    db = play(db, '"I once drank the whole dock crew under the table," Mara says.', {
      characters_present: ['mara-vance'],
      facts: [{ entity: 'mara-vance', fact: 'Mara says she drank the whole dock crew under the table.', type: 'event', who_knows: ['player', 'mara-vance'], supersedes: [], claimed_by: 'mara-vance', lasts: null, days: null }],
    });
    const claim = fact(db, 'whole dock crew')!;
    expect(claim.confidence).toBe('claimed');
    expect(claim.claimedBy).toBe(person(db, 'Mara Vance').id);
    expect(claim.subjectEntityId).toBe(person(db, 'Mara Vance').id);
    expect(claim.whoKnows).toEqual([person(db, 'Alex Reyes').id, person(db, 'Mara Vance').id]);
  });

  test('the budget cuts memories and facts before the recent scene', () => {
    let db = seed();
    for (let i = 0; i < 14; i += 1) {
      db = play(db, `Turn ${i}: you walk on through the rain with Mara, saying little.`, {
        characters_present: ['mara-vance'],
        facts: [{ entity: 'mara-vance', fact: `Mara told you story number ${i} about the regulars at The Anchor and the night the jukebox caught fire.`, type: 'event', who_knows: ['player', 'mara-vance'], supersedes: [], claimed_by: null, lasts: null, days: null }],
      });
    }
    const full = buildNarrationPrompt(db, '*You walk.*');
    const tight = buildNarrationPrompt({ ...db, settings: { ...db.settings, promptTokenBudget: full.estimatedTokens - 120 } }, '*You walk.*');

    expect(tight.recentMessages.length).toBe(full.recentMessages.length);
    expect(tight.estimatedTokens).toBeLessThan(full.estimatedTokens);
  });
});

describe('7. lore is plain notes', () => {
  test('lore the player wrote reaches the narrator, with no conditions', () => {
    const db = seed();
    expect(promptText(db)).toContain('locals never carry umbrellas');
  });
});
