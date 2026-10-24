import { generateImage } from '../openrouter';
import { buildSceneImagePrompt, collectRecentSceneImages } from './image';
import { loadKanReferenceImages } from './referenceImages';
import type { AppDatabase } from './types';

export async function generateSceneImageForTurn(options: {
  apiKey: string;
  db: AppDatabase;
  logId: string;
}): Promise<string> {
  const { apiKey, db, logId } = options;

  const recentImages = collectRecentSceneImages(db);
  const prompt = buildSceneImagePrompt(db, recentImages);
  const wearsAkatsukiCloak = db.state.inventory.some((item) =>
    /akatsuki cloak/i.test(item)
  );
  const staticReferences = await loadKanReferenceImages(wearsAkatsukiCloak);
  const inputReferences = [...recentImages, ...staticReferences];

  const result = await generateImage({
    apiKey,
    model: db.settings.imageModel,
    prompt,
    inputReferences,
  });

  return await attachImageToLog(logId, result.dataUri);
}

async function attachImageToLog(_logId: string, dataUri: string): Promise<string> {
  return dataUri;
}
