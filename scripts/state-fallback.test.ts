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
import { fallbackDiffFromProse, presentFromProse } from '../lib/rpg/proseFallback';
import { applyTurnDiff } from '../lib/rpg/services';
import { applyStateStep } from '../lib/rpg/memoryJobs';

const seed = () => normalizeDatabase(seedDatabase('slot_test', 'Test story'));

describe('repairTruncatedJson', () => {
  test('keeps the complete part of a cut-off reply', () => {
    const cut = '{"elapsed_seconds": 120, "scene_pace": "conversation", "present": ["Mara Vance", "Dani';
    expect(parseJsonObject(cut)).toBeNull();
    const repaired = repairTruncatedJson(cut);
    expect(repaired?.elapsed_seconds).toBe(120);
    expect(repaired?.scene_pace).toBe('conversation');
    expect(repaired?.present).toEqual(['Mara Vance']);
  });

  test('handles cuts inside nested objects and strings with braces and commas', () => {
    const cut = '{"bonds": [{"character": "Mara", "note": "a, {tense} talk", "delta": 2}, {"character": "Dan';
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
      'Mara stands by the door. Rain beads on her coat. Mara does not look back at you.';
    expect(presentFromProse(db, narration)).toContain('Mara Vance');
  });

  test('ignores a single passing mention of someone new', () => {
    const db = seed();
    const present = presentFromProse(db, 'Somewhere far off, people still whisper about Celeste Moreau.');
    expect(present).not.toContain('Celeste Moreau');
  });

  test('an unreadable turn changes nothing; who the prose shows is only a suggestion', () => {
    const db = seed();
    const turnLogId = db.rawLog.filter((entry) => entry.role === 'assistant').at(-1)?.id ?? 'log_x';
    const turn = {
      turnLogId,
      userMessage: 'I wait.',
      narration: 'Mara watches you from behind the bar. Mara says nothing.',
    };
    expect(fallbackDiffFromProse(db, turn)).toBeDefined();

    const result = applyStateStep(db, null, turn, new Set());
    expect(result.appliedDiff?.suggestedCast).toContain('Mara Vance');
    // Only the state reply's characters_present stamps who was seen.
    const before = db.entities.find((e) => e.name === 'Mara Vance');
    const mara = result.db.entities.find((e) => e.name === 'Mara Vance');
    expect(mara?.lastSeen).toEqual(before?.lastSeen);
    expect(result.db.state.sceneCast ?? []).toEqual(db.state.sceneCast ?? []);
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

describe('meeting someone', () => {
  const unmet = (db: ReturnType<typeof seed>) =>
    db.entities.find((entity) => entity.met === false && entity.status === 'Not yet met' && !entity.deceased)!;

  test('first seen in a scene: "Newly met" and a bond', () => {
    const db = seed();
    const person = unmet(db);
    const next = applyTurnDiff(db, { scene: { ended: false, entities: [person.name] } });
    const after = next.entities.find((entity) => entity.id === person.id)!;
    expect(after.met).toBe(true);
    expect(after.status).toBe('Newly met');
    expect(next.bonds.some((bond) => bond.entityId === person.id)).toBe(true);
  });

  test('a failed state turn meets no one, even someone the prose names', () => {
    const db = seed();
    const person = unmet(db);
    const first = person.name.split(' ')[0];
    const turnLogId = db.rawLog.filter((entry) => entry.role === 'assistant').at(-1)?.id ?? 'log_x';
    const result = applyStateStep(
      db,
      null,
      { turnLogId, userMessage: 'I wait.', narration: `${person.name} steps out of the rain. ${first} studies you.` },
      new Set()
    );
    const after = result.db.entities.find((entity) => entity.id === person.id)!;
    expect(after.met).toBe(false);
    expect(after.status).toBe('Not yet met');
    expect(result.db.bonds.some((bond) => bond.entityId === person.id)).toBe(false);
  });

  test('old saves with a met person stuck on "Not yet met" are repaired', () => {
    const db = seed();
    const person = unmet(db);
    const broken = {
      ...db,
      entities: db.entities.map((entity) => (entity.id === person.id ? { ...entity, met: true } : entity)),
    };
    const fixed = normalizeDatabase(broken);
    expect(fixed.entities.find((entity) => entity.id === person.id)?.status).toBe('Newly met');
    expect(fixed.bonds.some((bond) => bond.entityId === person.id)).toBe(true);
  });
});
