import { describe, expect, test, mock } from 'bun:test';

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
import { seedDatabase } from '../lib/rpg/seed';
import { parseJsonObject, repairTruncatedJson } from '../lib/rpg/stateBlock';
import { fallbackDiffFromProse, kanJutsuFromMessage, presentFromProse } from '../lib/rpg/proseFallback';
import { applyStateStep } from '../lib/rpg/memoryJobs';

const seed = () => normalizeDatabase(seedDatabase('slot_test', 'Test story'));

describe('repairTruncatedJson', () => {
  test('keeps the complete part of a cut-off reply', () => {
    const cut = '{"elapsed_seconds": 120, "scene_pace": "conversation", "present": ["Itachi Uchiha", "Kisa';
    expect(parseJsonObject(cut)).toBeNull();
    const repaired = repairTruncatedJson(cut);
    expect(repaired?.elapsed_seconds).toBe(120);
    expect(repaired?.scene_pace).toBe('conversation');
    expect(repaired?.present).toEqual(['Itachi Uchiha']);
  });

  test('handles cuts inside nested objects and strings with braces and commas', () => {
    const cut = '{"bonds": [{"character": "Itachi", "note": "a, {tense} talk", "delta": 2}, {"character": "Kis';
    const repaired = repairTruncatedJson(cut) as { bonds: Array<Record<string, unknown>> };
    expect(repaired.bonds).toHaveLength(2);
    expect(repaired.bonds[0].note).toBe('a, {tense} talk');
  });

  test('gives up on nothing usable', () => {
    expect(repairTruncatedJson('I could not')).toBeNull();
    expect(repairTruncatedJson('{"elap')).toBeNull();
  });
});

describe('prose fallback', () => {
  test('records people the narration shows in the scene', () => {
    const db = seed();
    const narration =
      'Itachi stands at the treeline. Rain beads on his cloak. Itachi does not look back at you.';
    expect(presentFromProse(db, narration)).toContain('Itachi Uchiha');
  });

  test('ignores a single passing mention of someone new', () => {
    const db = seed();
    const present = presentFromProse(db, 'Somewhere far off, people still whisper about Orochimaru.');
    expect(present).not.toContain('Orochimaru');
  });

  test('pulls jutsu from the player message', () => {
    const db = seed();
    expect(kanJutsuFromMessage(db, 'I weave the signs for Fire Style: Fireball Jutsu.')).toEqual([
      'Fire Style: Fireball Jutsu',
    ]);
    expect(kanJutsuFromMessage(db, 'I use Shadow Clone Jutsu and slip away.')).toEqual([
      'Shadow Clone Jutsu',
    ]);
    expect(kanJutsuFromMessage(db, 'I reach for Thousand Souls.')).toEqual(['Thousand Souls']);
    expect(kanJutsuFromMessage(db, 'I ask Itachi about the Shadow Clone Jutsu.')).toEqual([]);
    expect(kanJutsuFromMessage(db, 'I nod and keep walking.')).toEqual([]);
  });

  test('an unreadable turn still records presence and jutsu', () => {
    const db = seed();
    const turnLogId = db.rawLog.filter((entry) => entry.role === 'assistant').at(-1)?.id ?? 'log_x';
    const turn = {
      turnLogId,
      userMessage: 'I use Shadow Clone Jutsu.',
      narration: 'Itachi watches your clones scatter. Itachi says nothing.',
    };
    expect(fallbackDiffFromProse(db, turn)?.jutsuUsed?.[0]?.name).toBe('Shadow Clone Jutsu');

    const result = applyStateStep(db, null, turn, new Set());
    expect(result.db.jutsuRecords.some((r) => r.name === 'Shadow Clone Jutsu' && r.user === 'Kan')).toBe(true);
    const itachi = result.db.entities.find((e) => e.name === 'Itachi Uchiha');
    expect(itachi?.lastSeen).toEqual(result.db.state.inStoryDate);
  });
});

describe('state call retry', () => {
  const reply = (content: string, finish: string) =>
    new Response(
      JSON.stringify({
        id: 'gen',
        choices: [{ message: { content }, finish_reason: finish }],
        usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0 },
      }),
      { status: 200 }
    );

  test('retries once with more room when the reply was cut off, and sends low reasoning', async () => {
    const { extractTurnDiff } = await import('../lib/rpg/services');
    const bodies: Array<Record<string, unknown>> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      return bodies.length === 1 ? reply('{"scene_pace": "comb', 'length') : reply('{}', 'stop');
    }) as typeof fetch;

    try {
      await extractTurnDiff({ apiKey: 'k', db: seed(), userMessage: 'I wait.', assistantMessage: 'Rain.' });
    } finally {
      globalThis.fetch = original;
    }

    const chat = bodies.filter((body) => 'messages' in body);
    expect(chat).toHaveLength(2);
    expect(chat[0].max_tokens).toBe(3000);
    expect(chat[1].max_tokens).toBe(4500);
    expect(chat[0].reasoning).toEqual({ exclude: true, effort: 'low' });
  });
});
