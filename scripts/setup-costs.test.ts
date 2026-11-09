// Step 9: provider links and key tests, recommended narrator models, the
// refusal / fade warning, and the cost tracker.
import { afterAll, describe, expect, mock, test } from 'bun:test';

const store = new Map<string, string>();
mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => void store.set(key, value),
    removeItem: async (key: string) => void store.delete(key),
    getAllKeys: async () => [...store.keys()],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

const { testProviderKey } = await import('../lib/explicitProviders');
const { EXPLICIT_PROVIDERS, DEFAULT_EXPLICIT_MODELS } = await import('../lib/rpg/explicitImages');
const { ROLEPLAY_MODELS } = await import('../lib/openrouter');
const { DEFAULT_SETTINGS } = await import('../lib/rpg/defaults');
const { narratorHeldBack } = await import('../lib/rpg/refusal');
const { costLineText, providerOf, recordCost, resetCostsForTests, settleCost, useCosts } = await import('../lib/costs');


const realFetch = globalThis.fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('explicit providers', () => {
  test('each has a key link, a model catalog, a prefilled model and a rough price', () => {
    for (const provider of EXPLICIT_PROVIDERS) {
      expect(provider.keyUrl).toMatch(/^https:\/\//);
      expect(provider.modelsUrl).toMatch(/^https:\/\//);
      expect(provider.modelNote).toMatch(/\$\d/);
      expect(provider.estimate).toBeGreaterThan(0);
    }
    expect(DEFAULT_EXPLICIT_MODELS.wiro).toBe('bytedance/seedream-v4-5-uncensored');
  });

  test('Test key checks without making a picture', async () => {
    const seen: { url: string; body: string; headers: Record<string, string> }[] = [];
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), body: String(init?.body ?? ''), headers: (init?.headers ?? {}) as Record<string, string> });
      if (String(url).includes('runware')) {
        const bad = String(init?.body).includes('"apiKey":"bad"');
        return new Response(JSON.stringify(bad ? { errors: [{ message: 'Invalid API key' }] } : { data: [{ taskType: 'authentication' }] }), { status: bad ? 401 : 200 });
      }
      const bad = (init?.headers as Record<string, string>)['x-api-key'] === 'bad';
      return new Response(JSON.stringify({ result: false, errors: [{ message: 'task not found' }] }), { status: bad ? 401 : 200 });
    }) as typeof fetch;

    expect(await testProviderKey('runware', 'good')).toEqual({ ok: true, message: 'Runware key works.' });
    expect((await testProviderKey('runware', 'bad')).ok).toBe(false);
    expect(seen[0].body).toContain('"taskType":"authentication"');
    expect(await testProviderKey('wiro', 'good')).toEqual({ ok: true, message: 'Wiro key works.' });
    expect((await testProviderKey('wiro', 'bad')).ok).toBe(false);
    expect(seen.some((call) => call.url.endsWith('/Task/Detail'))).toBe(true);
    expect((await testProviderKey('wiro', '  ')).ok).toBe(false);
    // No request ever asked for a picture.
    expect(seen.some((call) => /imageInference|\/Run\//.test(call.body + call.url))).toBe(false);
  });
});

describe('narrator models', () => {
  test('a short recommended list with a note on each, and a default from it', () => {
    expect(ROLEPLAY_MODELS.length).toBeGreaterThanOrEqual(3);
    for (const model of ROLEPLAY_MODELS) {
      expect(model.id).toMatch(/^[a-z0-9-]+\/[a-z0-9.-]+$/);
      expect(model.note.length).toBeGreaterThan(20);
      expect(model.id).not.toMatch(/^anthropic\//);
    }
    expect(ROLEPLAY_MODELS.map((model) => model.id)).toContain(DEFAULT_SETTINGS.narrationModel);
  });

  test('a refusal, or a fade to black nobody asked for, is noticed', () => {
    expect(narratorHeldBack("I'm sorry, but I can't write that scene.", { inSexScene: true, playerAskedToFade: false })).toBe('refused');
    expect(narratorHeldBack('I cannot continue with this request as it violates the content policy.', { inSexScene: false, playerAskedToFade: false })).toBe('refused');
    expect(narratorHeldBack('She pulls you close. The scene fades to black.', { inSexScene: true, playerAskedToFade: false })).toBe('faded');
    expect(narratorHeldBack('She pulls you close. The scene fades to black.', { inSexScene: true, playerAskedToFade: true })).toBeNull();
    expect(narratorHeldBack('She pulls you close. The scene fades to black.', { inSexScene: false, playerAskedToFade: false })).toBeNull();
    expect(narratorHeldBack('"You can’t be serious," she laughs, and drags you to bed.', { inSexScene: true, playerAskedToFade: false })).toBeNull();
  });
});

describe('the cost tracker', () => {
  test('pictures and money per provider, for the session and the month; estimates are marked', async () => {
    resetCostsForTests();
    recordCost({ provider: providerOf('wiro:bytedance/seedream-v4-5-uncensored'), image: true, cost: null, estimate: 0.04 });
    recordCost({ provider: providerOf('runware:runware:101@1'), image: true, cost: 0.0038 });
    recordCost({ provider: providerOf('deepseek/deepseek-v4.1-flash-1017'), image: false, cost: 0.0012 });
    recordCost({ provider: 'openrouter', image: false, cost: null });
    settleCost('openrouter', 0.0005);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(typeof useCosts).toBe('function');
    const saved = JSON.parse(store.get('frbddn.costs.v1') ?? '{}');
    expect(saved.totals.wiro).toMatchObject({ images: 1, estimated: 0.04, cost: 0 });
    expect(saved.totals.runware).toMatchObject({ images: 1, cost: 0.0038 });
    expect(saved.totals.openrouter.textCalls).toBe(2);
    expect(saved.totals.openrouter.cost).toBeCloseTo(0.0017, 6);
    expect(saved.totals.openrouter.unpriced).toBe(0);
    expect(costLineText(saved.totals.wiro)).toBe('1 picture · about $0.04 (estimate)');
    expect(costLineText(saved.totals.runware)).toBe('1 picture · $0.0038');
    expect(costLineText({ images: 0, textCalls: 0, cost: 0, estimated: 0, unpriced: 0 })).toBe('Nothing yet');
  });
});
