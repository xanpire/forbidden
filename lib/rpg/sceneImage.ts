import { generateImage } from '../openrouter';
import { buildSceneImagePrompt } from './image';
import { loadKanReferenceImages } from './referenceImages';
import type { AppDatabase } from './types';

export async function generateSceneImageForTurn(options: {
  apiKey: string;
  db: AppDatabase;
  logId: string;
}): Promise<string> {
  const { apiKey, db, logId } = options;

  const prompt = buildSceneImagePrompt(db);
  const wearsAkatsukiCloak = db.state.inventory.some((item) =>
    /akatsuki cloak/i.test(item)
  );
  const inputReferences = await loadKanReferenceImages(wearsAkatsukiCloak);

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
