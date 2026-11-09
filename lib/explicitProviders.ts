// The two explicit image providers behind one interface (session B).
//
// Runware: REST POST https://api.runware.ai/v1, `Authorization: Bearer <key>`,
//   a JSON array of tasks; `imageInference` with positivePrompt,
//   negativePrompt, model, width, height. Content check is off; the provider
//   still blocks illegal content.
// Wiro: POST https://api.wiro.ai/v1/Run/{owner}/{model}/sync with `x-api-key`;
//   Seedream takes `prompt`, `maxImages`, `watermark` and `inputImage` (files
//   or public URLs). Output URLs are in tasklist[0].outputs[].url. A sync
//   timeout (504) returns a taskid to poll at POST /Task/Detail. No filter.
//
// The app only ever sends prompts built by explicitScenePrompt (checked cast,
// checked director text, adults-only) and in-app reference images.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from './brand';
import { DEFAULT_EXPLICIT_MODELS, type ExplicitPrompt, type ExplicitProviderId } from './rpg/explicitImages';

export type ExplicitCaps = { maxReferences: number; canEdit: boolean };

export type ExplicitResult = { dataUri: string; cost?: number };

export type ExplicitImageProvider = {
  id: ExplicitProviderId;
  /** Does the provider filter content itself? Unfiltered ones get structured prompts only (always, here). */
  filtered: boolean;
  caps: ExplicitCaps;
  generate(prompt: ExplicitPrompt, references: string[], options: { apiKey: string; model: string; signal?: AbortSignal }): Promise<ExplicitResult>;
};

/**
 * Calls a provider directly; if the browser blocks it (CORS), goes through
 * the app's own /api/explicit function on Vercel instead.
 */
async function providerFetch(provider: ExplicitProviderId, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if ((init.signal as AbortSignal | undefined)?.aborted || typeof window === 'undefined') throw error;
    const path = new URL(url).pathname;
    return fetch(`/api/explicit?provider=${provider}&path=${encodeURIComponent(path)}`, init);
  }
}

function uuid() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Fetches an image URL into a data URI (falls back to the URL when the host blocks it). */
async function toDataUri(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) return url;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return url;
  }
}

function dataUriToBlob(dataUri: string): Blob {
  const [head, data] = dataUri.split(',');
  const mime = head.match(/data:([^;]+)/)?.[1] ?? 'image/jpeg';
  const bytes = atob(data);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

export function buildRunwareTask(prompt: ExplicitPrompt, references: string[], model: string) {
  return {
    taskType: 'imageInference',
    taskUUID: uuid(),
    model,
    positivePrompt: prompt.positive,
    negativePrompt: prompt.negative,
    width: 1344,
    height: 768,
    numberResults: 1,
    outputType: 'dataURI',
    outputFormat: 'JPG',
    includeCost: true,
    ...(references.length ? { referenceImages: references } : {}),
  };
}

export const runwareProvider: ExplicitImageProvider = {
  id: 'runware',
  filtered: true,
  caps: { maxReferences: 4, canEdit: false },
  async generate(prompt, references, { apiKey, model, signal }) {
    if (!apiKey) throw new Error('Add your Runware API key in Settings first.');
    const send = async (refs: string[]) =>
      providerFetch('runware', 'https://api.runware.ai/v1', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([buildRunwareTask(prompt, refs, model)]),
        signal,
      });
    let response = await send(references);
    let json = (await response.json().catch(() => null)) as { data?: Record<string, unknown>[]; errors?: { message?: string }[] } | null;
    // Not every model takes reference images: try once without them.
    if ((!response.ok || json?.errors?.length) && references.length && /reference/i.test(JSON.stringify(json?.errors ?? ''))) {
      response = await send([]);
      json = (await response.json().catch(() => null)) as typeof json;
    }
    if (!response.ok || json?.errors?.length) {
      throw new Error(`Runware: ${json?.errors?.[0]?.message ?? `HTTP ${response.status}`}`);
    }
    const item = json?.data?.[0] ?? {};
    const dataUri = typeof item.imageDataURI === 'string' ? item.imageDataURI : typeof item.imageURL === 'string' ? await toDataUri(item.imageURL, signal) : '';
    if (!dataUri) throw new Error('Runware returned no image.');
    return { dataUri, ...(typeof item.cost === 'number' ? { cost: item.cost } : {}) };
  },
};

type WiroTask = { status?: string; pexit?: string; outputs?: { url?: string }[] };

export function buildWiroForm(prompt: ExplicitPrompt, references: string[]): FormData {
  const form = new FormData();
  form.append('prompt', prompt.positive);
  form.append('maxImages', '1');
  form.append('watermark', 'false');
  references.forEach((ref, index) => {
    if (/^https?:/i.test(ref)) form.append('inputImage', ref);
    else form.append('inputImage', dataUriToBlob(ref), `reference-${index + 1}.jpg`);
  });
  return form;
}

export const wiroProvider: ExplicitImageProvider = {
  id: 'wiro',
  filtered: false,
  caps: { maxReferences: 4, canEdit: false },
  async generate(prompt, references, { apiKey, model, signal }) {
    if (!apiKey) throw new Error('Add your Wiro API key in Settings first.');
    const base = 'https://api.wiro.ai/v1';
    const response = await providerFetch('wiro', `${base}/Run/${model}/sync`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: buildWiroForm(prompt, references),
      signal,
    });
    const json = (await response.json().catch(() => null)) as { result?: boolean; errors?: unknown[]; taskid?: string; tasklist?: WiroTask[] } | null;
    let task: WiroTask | undefined = json?.tasklist?.[0];

    // A sync timeout hands back a task id to keep polling.
    if (!task?.outputs?.length && json?.taskid) {
      for (let i = 0; i < 40 && !task?.outputs?.length; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const detail = await providerFetch('wiro', `${base}/Task/Detail`, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskid: json.taskid }),
          signal,
        });
        const body = (await detail.json().catch(() => null)) as { tasklist?: WiroTask[] } | null;
        task = body?.tasklist?.[0];
        if (task?.status === 'task_cancel' || (task?.pexit && task.pexit !== '0')) break;
      }
    }

    const url = task?.outputs?.find((output) => output.url)?.url;
    if (!url) {
      throw new Error(`Wiro: ${json?.errors?.length ? JSON.stringify(json.errors[0]).slice(0, 120) : response.ok ? 'no image came back' : `HTTP ${response.status}`}`);
    }
    return { dataUri: await toDataUri(url, signal) };
  },
};

export const PROVIDERS: Record<ExplicitProviderId, ExplicitImageProvider> = { runware: runwareProvider, wiro: wiroProvider };

export function explicitModel(provider: ExplicitProviderId, settings: { runwareModel?: string; wiroModel?: string }) {
  return (provider === 'runware' ? settings.runwareModel : settings.wiroModel)?.trim() || DEFAULT_EXPLICIT_MODELS[provider];
}

const KEY_NAMES: Record<ExplicitProviderId, string> = { runware: STORAGE_KEYS.runwareKey, wiro: STORAGE_KEYS.wiroKey };

/** Provider keys stay on this device, outside the save. */
export async function loadProviderKey(provider: ExplicitProviderId): Promise<string> {
  return ((await AsyncStorage.getItem(KEY_NAMES[provider])) ?? '').trim();
}

export async function saveProviderKey(provider: ExplicitProviderId, key: string) {
  if (key.trim()) await AsyncStorage.setItem(KEY_NAMES[provider], key.trim());
  else await AsyncStorage.removeItem(KEY_NAMES[provider]);
}
