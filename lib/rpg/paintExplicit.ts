// Reference sheets for explicit pictures: painted on the standard image model
// from written appearance only (no reference images are sent), so explicit
// pictures keep each person's face and body the same without ever using an
// uploaded photo.
import { generateImage } from '../openrouter';
import { ensureImageCaps } from './imageCaps';
import { referenceSheetPrompt } from './explicitImages';
import type { AppDatabase } from './types';

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
