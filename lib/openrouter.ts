export type OpenRouterModel = {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: string | null;
  isFree: boolean;
  recommended: boolean;
};

export type KeyTestResult =
  | { ok: true; label: string }
  | { ok: false; message: string };

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/key';

const RECOMMENDED_IDS = new Set([
  'deepseek/deepseek-v4.1-flash-1017',
  'anthropic/claude-sonnet-5.5',
  'google/gemini-4-argon',
  'openai/gpt-6.1-sol',
]);

type RawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
  architecture?: {
    output_modalities?: string[];
  };
};

type RawKeyResponse = {
  data?: {
    label?: string;
    limit?: number | null;
    usage?: number;
  };
};

function modelName(value: string) {
  const name = value.includes(':') ? value.split(':').slice(1).join(':').trim() : value;
  return name || value;
}

function contextLabel(length: number) {
  if (!length || !Number.isFinite(length)) {
    return 'Context unknown';
  }

  if (length >= 1_000_000) {
    return `${(length / 1_000_000).toFixed(1).replace('.0', '')}M context`;
  }

  return `${Math.round(length / 1_000)}K context`;
}

function priceLabel(value: string | undefined) {
  if (value === undefined) {
    return null;
  }

  const price = Number(value);

  if (!Number.isFinite(price)) {
    return null;
  }

  if (price === 0) {
    return 'Free';
  }

  const perMillion = price * 1_000_000;
  const formatted =
    perMillion < 1
      ? perMillion.toFixed(2)
      : perMillion < 10
        ? perMillion.toFixed(1).replace('.0', '')
        : Math.round(perMillion).toString();

  return `$${formatted} / 1M`;
}

function toModel(raw: RawModel): OpenRouterModel | null {
  if (!raw.id || !raw.name || raw.id.endsWith(':batch')) {
    return null;
  }

  const outputs = raw.architecture?.output_modalities ?? ['text'];

  if (!outputs.includes('text')) {
    return null;
  }

  return {
    id: raw.id,
    name: modelName(raw.name),
    contextLength: raw.context_length ?? 0,
    promptPrice: priceLabel(raw.pricing?.prompt),
    isFree: Number(raw.pricing?.prompt ?? '1') === 0,
    recommended: RECOMMENDED_IDS.has(raw.id),
  };
}

export const FALLBACK_MODELS: OpenRouterModel[] = [
  {
    id: 'deepseek/deepseek-v4.1-flash-1017',
    name: 'DeepSeek V4.1 Flash',
    contextLength: 1048576,
    promptPrice: '$0.15 / 1M',
    isFree: false,
    recommended: true,
  },
  {
    id: 'anthropic/claude-sonnet-5.5',
    name: 'Claude Sonnet 5.5',
    contextLength: 1000000,
    promptPrice: '$2 / 1M',
    isFree: false,
    recommended: true,
  },
  {
    id: 'google/gemini-4-argon',
    name: 'Gemini 4 Argon',
    contextLength: 1048576,
    promptPrice: '$2 / 1M',
    isFree: false,
    recommended: true,
  },
  {
    id: 'openai/gpt-6.1-sol',
    name: 'GPT-6.1 Sol',
    contextLength: 1050000,
    promptPrice: '$2 / 1M',
    isFree: false,
    recommended: true,
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Llama 3.3 70B Instruct',
    contextLength: 131072,
    promptPrice: '$0.10 / 1M',
    isFree: false,
    recommended: false,
  },
  {
    id: 'google/gemini-3-flash-preview',
    name: 'Gemini 3 Flash Preview',
    contextLength: 1048576,
    promptPrice: '$0.50 / 1M',
    isFree: false,
    recommended: false,
  },
];

export function modelMeta(model: OpenRouterModel) {
  return [contextLabel(model.contextLength), model.promptPrice]
    .filter(Boolean)
    .join(' · ');
}

export async function fetchNarratorModels(): Promise<OpenRouterModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(MODELS_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error('OpenRouter model list is unavailable.');
    }

    const payload = (await response.json()) as { data?: RawModel[] };
    const models = (payload.data ?? [])
      .map(toModel)
      .filter((model): model is OpenRouterModel => model !== null)
      .sort((a, b) => {
        if (a.recommended !== b.recommended) {
          return a.recommended ? -1 : 1;
        }

        return a.name.localeCompare(b.name);
      });

    if (models.length === 0) {
      throw new Error('OpenRouter returned no text models.');
    }

    return models;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OpenRouter took too long to respond.');
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testOpenRouterKey(key: string): Promise<KeyTestResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(KEY_URL, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${key.trim()}`,
      },
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        message: 'OpenRouter rejected this key. Check it and try again.',
      };
    }

    if (response.status === 429) {
      return {
        ok: false,
        message: 'OpenRouter is rate limiting right now. Try again in a moment.',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        message: 'OpenRouter could not verify the key. Try again shortly.',
      };
    }

    const payload = (await response.json()) as RawKeyResponse;
    return {
      ok: true,
      label: payload.data?.label?.trim() || 'OpenRouter key',
    };
  } catch {
    return {
      ok: false,
      message: 'Could not reach OpenRouter. Check your connection and try again.',
    };
  } finally {
    clearTimeout(timeout);
  }
}
