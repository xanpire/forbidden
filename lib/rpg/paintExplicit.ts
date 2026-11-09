// Painting explicit pictures and their reference sheets (session B).
import { generateImage } from '../openrouter';
import { PROVIDERS, explicitModel, loadProviderKey, type ExplicitResult } from '../explicitProviders';
import { ensureImageCaps } from './imageCaps';
import { loadImages } from './imageStore';
import { explicitImagePrompt, referenceSheetPrompt, type ExplicitProviderId, type ExplicitShot } from './explicitImages';
import type { AppDatabase } from './types';

export type PaintedExplicit = ExplicitResult & { provider: ExplicitProviderId; model: string; prompt: string };

/** One explicit picture on one provider. Refuses (throws) before any request if anyone fails the checks. */
export async function paintExplicit(db: AppDatabase, shot: ExplicitShot, provider: ExplicitProviderId, signal?: AbortSignal): Promise<PaintedExplicit> {
  const adapter = PROVIDERS[provider];
  const prompt = explicitImagePrompt(db, shot, { maxReferences: adapter.caps.maxReferences });
  const apiKey = await loadProviderKey(provider);
  const model = explicitModel(provider, db.settings);
  const references = (await loadImages(prompt.references.map((ref) => ref.image))).filter(Boolean);
  const result = await adapter.generate(prompt, references, { apiKey, model, signal });
  return { ...result, provider, model, prompt: prompt.positive };
}

/** The same picture on both providers, to compare quality and cost (Debug). */
export async function paintSideBySide(db: AppDatabase, shot: ExplicitShot) {
  const settle = (provider: ExplicitProviderId) =>
    paintExplicit(db, shot, provider).then(
      (painted) => ({ provider, ok: true as const, painted }),
      (error: unknown) => ({ provider, ok: false as const, error: error instanceof Error ? error.message : String(error) })
    );
  return Promise.all([settle('runware'), settle('wiro')]);
}

/**
 * A non-explicit reference sheet for someone, painted on the standard image
 * model from their written appearance only (no reference images are sent).
 */
export async function paintReferenceSheet(
  db: AppDatabase,
  entityId: string,
  apiKey: string,
  updateSettings: (patch: Partial<AppDatabase['settings']>) => Promise<void>
): Promise<string> {
  const prompt = referenceSheetPrompt(db, entityId);
  const caps = await ensureImageCaps(db, updateSettings);
  const result = await generateImage({ apiKey, caps, prompt, inputReferences: [], aspectRatio: '16:9' });
  return result.dataUri;
}
