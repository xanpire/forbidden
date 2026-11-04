import { fetchImageModelCaps, type ImageModelCaps } from '../openrouter';
import type { AppDatabase, Settings } from './types';

/** Caps older than this are looked up again before use. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The saved capabilities of the current image model, looked up (and saved)
 * if they are missing, stale, or belong to a different model.
 */
export async function ensureImageCaps(
  db: AppDatabase,
  updateSettings: (patch: Partial<Settings>) => Promise<void>
): Promise<ImageModelCaps> {
  const saved = db.settings.imageModelCaps;
  const model = db.settings.imageModel.trim();

  if (saved && saved.modelId === model && Date.now() - saved.fetchedAt < MAX_AGE_MS) {
    return saved;
  }

  try {
    const caps = await fetchImageModelCaps(model);
    await updateSettings({ imageModelCaps: caps });
    return caps;
  } catch (caught) {
    if (saved && saved.modelId === model) {
      return saved;
    }

    throw new Error(
      caught instanceof Error
        ? `Couldn’t check what ${model} accepts: ${caught.message}`
        : `Couldn’t check what ${model} accepts.`
    );
  }
}

/** One line for Settings describing what the model takes. */
export function describeImageCaps(caps: ImageModelCaps) {
  if (caps.maxReferences === 0) {
    return 'Takes no reference images. Kan’s face can’t be sent, so his look may drift.';
  }

  const extras: string[] = [];
  const aspect = caps.params.aspect_ratio;
  const resolution = caps.params.resolution;

  if (resolution?.type === 'enum') extras.push(resolution.values.join('/'));
  if (aspect?.type === 'enum') extras.push(`${aspect.values.length} aspect ratios`);

  const refs =
    caps.maxReferences === 1
      ? 'Takes 1 reference image: only Kan’s face is sent.'
      : `Takes up to ${caps.maxReferences} reference images.`;

  return extras.length > 0 ? `${refs} ${extras.join(' · ')}.` : refs;
}
