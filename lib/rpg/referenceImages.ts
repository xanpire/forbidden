import { loadImage } from './imageStore';
import type { AppDatabase } from './types';

/**
 * The player's own reference images: the face and outfit pictures they
 * uploaded for their character (`state.player.faceImage` / `outfitImage`).
 * Either may be missing; then the prompt describes the player in words.
 * There is no bundled alternate outfit any more: `alternate` is always empty.
 */
export type PlayerReferences = { face: string; outfit: string; alternate: string };

export async function loadPlayerReferenceImages(db: Pick<AppDatabase, 'state'>): Promise<PlayerReferences> {
  const [face, outfit] = await Promise.all([
    loadImage(db.state.player?.faceImage ?? null),
    loadImage(db.state.player?.outfitImage ?? null),
  ]);

  return { face: face ?? '', outfit: outfit ?? '', alternate: '' };
}

export { faceDroppedWarning, planReferences } from './referencePlan';
export type { PlannedReference } from './referencePlan';
