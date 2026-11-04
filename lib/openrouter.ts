import type { OpenRouterMessage } from './rpg/types';

const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const IMAGE_MODELS_URL = 'https://openrouter.ai/api/v1/images/models';
const IMAGES_URL = 'https://openrouter.ai/api/v1/images';
const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const KEY_URL = 'https://openrouter.ai/api/v1/key';
const GENERATION_URL = 'https://openrouter.ai/api/v1/generation';

export type OpenRouterModelSummary = {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: string | null;
  recommended: boolean;
};

type RawModel = {
  id?: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string };
};

export type OpenRouterImageModelSummary = {
  id: string;
  name: string;
  description: string;
  supportsStreaming: boolean;
  supportsImageInput: boolean;
  supportedParameters: string[];
};

export type ImageGenerationResult = {
  dataUri: string;
  mediaType: string;
  cost: number | null;
};

export type KeyTestResult =
  | { ok: true; label: string }
  | { ok: false; message: string };

export type ChatRequest = {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  responseFormatJson?: boolean;
  /**
   * Ask for OpenRouter structured output against this JSON schema. Falls
   * back to plain JSON mode, then to an ordinary reply, if the model (or
   * every provider for it) can't do structured output.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> };
  /**
   * OpenRouter reasoning settings. `exclude: true` keeps the thinking out of
   * the reply text; it still counts against max_tokens.
   */
  reasoning?: { effort?: 'low' | 'medium' | 'high'; exclude?: boolean };
};

/** What OpenRouter reported for one call. Nothing here is estimated unless `estimated` says so. */
export type CallUsage = {
  promptTokens: number;
  completionTokens: number;
  /** Thinking tokens (billed as completion tokens). */
  reasoningTokens: number;
  /** Prompt tokens served from the provider's cache. */
  cachedTokens: number;
  /** True when OpenRouter sent no usage and the counts are a length estimate. */
  estimated: boolean;
  /** USD, as billed by OpenRouter. Null until known. */
  cost: number | null;
  generationId: string | null;
  /** The model that actually answered (can differ from the one asked for). */
  servedModel: string | null;
  provider: string | null;
  durationMs: number;
};

export type StreamResult = {
  text: string;
  promptTokens: number;
  completionTokens: number;
  finishReason?: string;
  usage: CallUsage;
};

type RawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
  prompt_tokens_details?: { cached_tokens?: number };
};

function readUsage(
  raw: RawUsage | undefined,
  meta: { id?: string; model?: string; provider?: string },
  fallback: { prompt: number; completion: number },
  startedAt: number
): CallUsage {
  const hasCounts = typeof raw?.prompt_tokens === 'number' && raw.prompt_tokens > 0;

  return {
    promptTokens: hasCounts ? (raw?.prompt_tokens as number) : fallback.prompt,
    completionTokens:
      typeof raw?.completion_tokens === 'number' ? raw.completion_tokens : fallback.completion,
    reasoningTokens: raw?.completion_tokens_details?.reasoning_tokens ?? 0,
    cachedTokens: raw?.prompt_tokens_details?.cached_tokens ?? 0,
    estimated: !hasCounts,
    cost: typeof raw?.cost === 'number' ? raw.cost : null,
    generationId: meta.id ?? null,
    servedModel: meta.model ?? null,
    provider: meta.provider ?? null,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * Looks up the billed cost of a finished call. OpenRouter needs a moment to
 * settle the stats, so this retries a few times. Returns null if it never
 * becomes available.
 */
export async function fetchGenerationCost(
  apiKey: string,
  generationId: string
): Promise<number | null> {
  const delays = [1500, 3000, 6000];

  for (const delay of delays) {
    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      const response = await fetch(
        `${GENERATION_URL}?id=${encodeURIComponent(generationId)}`,
        { headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } }
      );

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as { data?: { total_cost?: number } };

      if (typeof payload.data?.total_cost === 'number') {
        return payload.data.total_cost;
      }
    } catch {
      // Try again after the next delay.
    }
  }

  return null;
}

const RECOMMENDED_MODELS = new Set([
  'deepseek/deepseek-v4.1-flash-1017',
  'anthropic/claude-sonnet-5.5',
  'google/gemini-4-argon',
  'openai/gpt-6.1-sol',
]);

export async function fetchOpenRouterModels(): Promise<OpenRouterModelSummary[]> {
  const response = await fetch(MODELS_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Could not load OpenRouter models.');
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      context_length?: number;
      pricing?: { prompt?: string };
    }>;
  };

  return (payload.data ?? [])
    .filter((model): model is RawModel & { id: string; name: string } => Boolean(model.id && model.name))
    .map((model) => ({
      id: model.id,
      name: model.name.includes(':')
        ? model.name.split(':').slice(1).join(':').trim()
        : model.name,
      contextLength: model.context_length ?? 0,
      promptPrice: formatPrice(model.pricing?.prompt),
      recommended: RECOMMENDED_MODELS.has(model.id),
    }))
    .sort((a, b) => {
      if (a.recommended !== b.recommended) {
        return a.recommended ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

export async function fetchOpenRouterImageModels(): Promise<OpenRouterImageModelSummary[]> {
  const response = await fetch(IMAGE_MODELS_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Could not load OpenRouter image models.');
  }

  const payload = (await response.json()) as {
    data?: Array<{
      id?: string;
      name?: string;
      description?: string;
      supports_streaming?: boolean;
      supported_parameters?: Record<string, unknown>;
      architecture?: { input_modalities?: string[] };
    }>;
  };

  return (payload.data ?? [])
    .filter(
      (
        model
      ): model is {
        id: string;
        name: string;
        description?: string;
        supports_streaming?: boolean;
        supported_parameters?: Record<string, unknown>;
        architecture?: { input_modalities?: string[] };
      } => Boolean(model.id && model.name)
    )
    .map((model) => ({
      id: model.id,
      name: model.name,
      description: model.description ?? '',
      supportsStreaming: Boolean(model.supports_streaming),
      supportsImageInput: Boolean(
        model.architecture?.input_modalities?.includes('image')
      ),
      supportedParameters: Object.keys(model.supported_parameters ?? {}),
    }))
    .sort((a, b) => {
      if (a.supportsImageInput !== b.supportsImageInput) {
        return a.supportsImageInput ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

export async function generateImage({
  apiKey,
  model,
  prompt,
  inputReferences,
  aspectRatio = '16:9',
  signal,
}: {
  apiKey: string;
  model: string;
  prompt: string;
  inputReferences?: string[];
  aspectRatio?: '16:9' | '3:4';
  signal?: AbortSignal;
}): Promise<ImageGenerationResult> {
  if (!apiKey) {
    throw new Error('Add your OpenRouter API key in Settings first.');
  }

  const fullBody: Record<string, unknown> = {
    model,
    prompt,
    n: 1,
    resolution: '1K',
    aspect_ratio: aspectRatio,
    quality: 'high',
    output_format: 'jpeg',
    output_compression: 80,
  };

  const references = inputReferences?.filter(Boolean) ?? [];

  if (references.length > 0) {
    fullBody.input_references = references.map((url) => ({
      type: 'image_url',
      image_url: { url },
    }));
  }

  let response = await fetch(IMAGES_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey, false),
    body: JSON.stringify(fullBody),
    signal,
  });

  if ((response.status === 400 || response.status === 422) && references.length > 2) {
    response = await fetch(IMAGES_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey, false),
      body: JSON.stringify({
        ...fullBody,
        input_references: references.slice(0, 2).map((url) => ({
          type: 'image_url',
          image_url: { url },
        })),
      }),
      signal,
    });
  }

  if ((response.status === 400 || response.status === 422) && references.length > 0) {
    const withoutReferences = { ...fullBody };
    delete withoutReferences.input_references;

    response = await fetch(IMAGES_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey, false),
      body: JSON.stringify(withoutReferences),
      signal,
    });
  }

  if (response.status === 400 || response.status === 422) {
    response = await fetch(IMAGES_URL, {
      method: 'POST',
      headers: buildHeaders(apiKey, false),
      body: JSON.stringify({ model, prompt }),
      signal,
    });
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  const payload = (await response.json()) as {
    data?: Array<{
      b64_json?: string;
      media_type?: string;
    }>;
    usage?: { cost?: number };
  };

  const image = payload.data?.[0];

  if (!image?.b64_json) {
    throw new Error('The image model did not return an image.');
  }

  const mediaType = image.media_type ?? 'image/png';

  return {
    dataUri: `data:${mediaType};base64,${image.b64_json}`,
    mediaType,
    cost: payload.usage?.cost ?? null,
  };
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
      return { ok: false, message: 'OpenRouter rejected this key.' };
    }

    if (response.status === 429) {
      return { ok: false, message: 'OpenRouter is rate limiting. Try again soon.' };
    }

    if (!response.ok) {
      return { ok: false, message: 'OpenRouter could not verify this key.' };
    }

    const payload = (await response.json()) as { data?: { label?: string } };
    return { ok: true, label: payload.data?.label?.trim() || 'OpenRouter key' };
  } catch {
    return { ok: false, message: 'Could not reach OpenRouter.' };
  } finally {
    clearTimeout(timeout);
  }
}

function formatPrice(value: string | undefined) {
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

  if (perMillion < 1) {
    return `$${perMillion.toFixed(2)} / 1M`;
  }

  if (perMillion < 10) {
    return `$${perMillion.toFixed(1)} / 1M`;
  }

  return `$${Math.round(perMillion)} / 1M`;
}

function buildHeaders(apiKey: string, json: boolean) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-Title': 'Kan RPG',
  };

  if (json) {
    headers.Accept = 'application/json';
  }

  return headers;
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    return payload.error?.message ?? `OpenRouter request failed (${response.status}).`;
  } catch {
    return `OpenRouter request failed (${response.status}).`;
  }
}

/**
 * Model families whose caching only kicks in with explicit cache_control
 * breakpoints. OpenAI, DeepSeek, Grok, Moonshot and others cache a repeated
 * prefix on their own, so they get plain string content.
 */
function needsCacheBreakpoints(model: string) {
  return /^(anthropic|google|qwen)\//.test(model);
}

/** Messages as sent on the wire: cacheable blocks become marked text parts where the model needs them. */
function toWireMessages(model: string, messages: OpenRouterMessage[]) {
  const explicit = needsCacheBreakpoints(model);

  return messages.map((message) => {
    if (!explicit || !message.parts || message.parts.length === 0) {
      return { role: message.role, content: message.content };
    }

    return {
      role: message.role,
      content: message.parts.map((part) =>
        part.cache
          ? { type: 'text', text: part.text, cache_control: { type: 'ephemeral' } }
          : { type: 'text', text: part.text }
      ),
    };
  });
}

export async function completeChat({
  apiKey,
  model,
  messages,
  temperature = 0.7,
  maxTokens = 900,
  signal,
  responseFormatJson = false,
  jsonSchema,
}: ChatRequest): Promise<StreamResult> {
  if (!apiKey) {
    throw new Error('Add your OpenRouter API key in Settings first.');
  }

  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(model, messages),
    temperature,
    max_tokens: maxTokens,
    stream: false,
    reasoning: { exclude: true },
    usage: { include: true },
  };

  const startedAt = Date.now();

  if (jsonSchema) {
    body.response_format = {
      type: 'json_schema',
      json_schema: { name: jsonSchema.name, strict: true, schema: jsonSchema.schema },
    };
    // Only route to providers that actually enforce the schema.
    body.provider = { require_parameters: true };
  } else if (responseFormatJson) {
    body.response_format = { type: 'json_object' };
  }

  const wantsJson = Boolean(jsonSchema) || responseFormatJson;

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey, wantsJson),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    // 400/422: parameter rejected. 404: no provider supports it.
    const unsupported =
      response.status === 400 || response.status === 404 || response.status === 422;

    if (jsonSchema && unsupported) {
      return completeChat({
        apiKey,
        model,
        messages,
        temperature,
        maxTokens,
        signal,
        responseFormatJson: true,
      });
    }

    if (responseFormatJson && unsupported) {
      return completeChat({
        apiKey,
        model,
        messages,
        temperature,
        maxTokens,
        signal,
        responseFormatJson: false,
      });
    }

    throw new Error(message);
  }

  const payload = (await response.json()) as {
    id?: string;
    model?: string;
    provider?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: RawUsage;
  };

  const text = payload.choices?.[0]?.message?.content ?? '';
  const usage = readUsage(
    payload.usage,
    payload,
    {
      prompt: estimateTokens(messages),
      completion: estimateTokens([{ role: 'assistant', content: text }]),
    },
    startedAt
  );

  return {
    text,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    finishReason: payload.choices?.[0]?.finish_reason,
    usage,
  };
}

export async function streamChatCompletion({
  apiKey,
  model,
  messages,
  temperature = 0.7,
  maxTokens = 900,
  signal,
  reasoning,
  onDelta,
}: ChatRequest & { onDelta: (delta: string) => void }): Promise<StreamResult> {
  if (!apiKey) {
    throw new Error('Add your OpenRouter API key in Settings first.');
  }

  const body: Record<string, unknown> = {
    model,
    messages: toWireMessages(model, messages),
    temperature,
    max_tokens: maxTokens,
    stream: true,
    usage: { include: true },
  };

  if (reasoning) {
    body.reasoning = reasoning;
  }

  const startedAt = Date.now();

  const response = await fetch(CHAT_URL, {
    method: 'POST',
    headers: buildHeaders(apiKey, false),
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  if (!response.body) {
    const text = await response.text();
    onDelta(text);
    const usage = readUsage(
      undefined,
      {},
      {
        prompt: estimateTokens(messages),
        completion: estimateTokens([{ role: 'assistant', content: text }]),
      },
      startedAt
    );

    return {
      text,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      usage,
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let rawUsage: RawUsage | undefined;
  const meta: { id?: string; model?: string; provider?: string } = {};
  let finishReason: string | undefined;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) {
        continue;
      }

      const data = trimmed.slice(5).trim();

      if (data === '[DONE]') {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as {
          id?: string;
          model?: string;
          provider?: string;
          choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
          usage?: RawUsage;
        };

        meta.id = parsed.id ?? meta.id;
        meta.model = parsed.model ?? meta.model;
        meta.provider = parsed.provider ?? meta.provider;

        if (parsed.choices?.[0]?.finish_reason) {
          finishReason = parsed.choices[0].finish_reason ?? finishReason;
        }

        const delta = parsed.choices?.[0]?.delta?.content;

        if (delta) {
          full += delta;
          onDelta(delta);
        }

        if (parsed.usage) {
          rawUsage = parsed.usage;
        }
      } catch {
        // Ignore malformed SSE fragments.
      }
    }
  }

  const usage = readUsage(
    rawUsage,
    meta,
    {
      prompt: estimateTokens(messages),
      completion: estimateTokens([{ role: 'assistant', content: full }]),
    },
    startedAt
  );

  return {
    text: full,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    finishReason,
    usage,
  };
}

export function estimateTokens(messages: OpenRouterMessage[]) {
  const text = messages.map((message) => message.content).join('\n');
  return Math.ceil(text.length / 4);
}
