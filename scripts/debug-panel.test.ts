import { describe, expect, test, mock } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
}));

import { seedDatabase } from '../lib/rpg/seed';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import {
  beginDebugTurn,
  clearDebugLog,
  describeStateChange,
  linkDebugTurn,
  recordDebugCall,
  recordDebugState,
  turnCost,
  getDebugLog,
} from '../lib/rpg/debug';
import { completeChat, streamChatCompletion } from '../lib/openrouter';

const realFetch = globalThis.fetch;

function usage(cost: number | null) {
  return {
    promptTokens: 100,
    completionTokens: 20,
    reasoningTokens: 0,
    cachedTokens: 0,
    estimated: false,
    cost,
    generationId: null,
    servedModel: null,
    provider: null,
    durationMs: 10,
  };
}

describe('debug log', () => {
  test('describes what a state step changed, field by field', () => {
    const before = seedDatabase('slot_t', 'T');
    const result = applyStateStep(
      before,
      { state: { location: 'Ame outskirts', mood: 'wary', elapsedSeconds: 600 } },
      { turnLogId: 'log_x', userMessage: 'walk', narration: 'You walk for ten minutes.' },
      new Set()
    );
    const changes = describeStateChange(before, result.db);
    const paths = changes.map((change) => change.path);

    expect(paths).toContain('state.location');
    expect(changes.find((c) => c.path === 'state.location')?.to).toBe('Ame outskirts');
    expect(paths.some((path) => path.startsWith('state.inStoryDate'))).toBe(true);
    expect(paths.some((path) => path.startsWith('memoryJobs'))).toBe(false);
    expect(result.appliedDiff?.state?.elapsedSeconds).toBeGreaterThan(0);
  });

  test('an unchanged save reports no changes', () => {
    const db = seedDatabase('slot_t', 'T');
    expect(describeStateChange(db, db)).toEqual([]);
  });

  test('turn cost adds every call and flags missing costs', () => {
    clearDebugLog();
    const id = beginDebugTurn({
      slotId: 's', action: 'a', d20: 10, narratorModel: 'm', prompt: [], promptEstimate: 1,
    });
    recordDebugCall(id, { kind: 'narrator', model: 'm', usage: usage(0.01) });
    linkDebugTurn(id, 'log_1');
    recordDebugCall('log_1', { kind: 'state', model: 'm2', usage: usage(0.002) });
    recordDebugState('log_1', { status: 'applied', changes: [] });

    recordDebugCall('log_1', { kind: 'scene', model: 'm3', usage: usage(null) });

    const turn = getDebugLog().turns[0];
    expect(turn.id).toBe('log_1');
    expect(turn.calls.map((call) => call.kind)).toEqual(['narrator', 'state', 'scene']);
    expect(turn.state?.status).toBe('applied');
    const cost = turnCost(turn);
    expect(cost.total).toBeCloseTo(0.012, 6);
    expect(cost.complete).toBe(false);
    expect(turn.calls[2].costSource).toBe('unavailable');
  });
});

describe('openrouter usage', () => {
  test('non-streaming call returns billed cost, reasoning and cached tokens', async () => {
    let sentBody: Record<string, unknown> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          id: 'gen-1',
          model: 'google/gemini-x',
          provider: 'Google',
          choices: [{ message: { content: '{}' }, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 300,
            cost: 0.00123,
            completion_tokens_details: { reasoning_tokens: 200 },
            prompt_tokens_details: { cached_tokens: 800 },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const result = await completeChat({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    globalThis.fetch = realFetch;

    expect(sentBody.usage).toEqual({ include: true });
    expect(result.usage.cost).toBe(0.00123);
    expect(result.usage.reasoningTokens).toBe(200);
    expect(result.usage.cachedTokens).toBe(800);
    expect(result.usage.generationId).toBe('gen-1');
    expect(result.usage.estimated).toBe(false);
  });

  test('streaming call reads usage from the final chunk', async () => {
    const chunks = [
      `data: ${JSON.stringify({ id: 'gen-2', model: 'm', choices: [{ delta: { content: 'You ' } }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'gen-2', choices: [{ delta: { content: 'wait.' }, finish_reason: 'stop' }] })}\n\n`,
      `data: ${JSON.stringify({ id: 'gen-2', choices: [], usage: { prompt_tokens: 5000, completion_tokens: 900, cost: 0.0421 } })}\n\n`,
      'data: [DONE]\n\n',
    ];
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
            controller.close();
          },
        }),
        { status: 200 }
      )) as typeof fetch;

    const result = await streamChatCompletion({
      apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'x' }], onDelta: () => undefined,
    });
    globalThis.fetch = realFetch;

    expect(result.text).toBe('You wait.');
    expect(result.usage.cost).toBe(0.0421);
    expect(result.usage.promptTokens).toBe(5000);
    expect(result.usage.generationId).toBe('gen-2');
  });
});
