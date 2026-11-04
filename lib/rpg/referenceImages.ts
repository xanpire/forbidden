import { Asset } from 'expo-asset';

const kanFaceSheet = require('../../assets/images/kan-face-sheet.jpg');
const kanOutfitBlack = require('../../assets/images/kan-outfit-black.jpg');
const kanOutfitAkatsuki = require('../../assets/images/kan-outfit-akatsuki.jpg');

let referencesPromise: Promise<string[]> | null = null;

export type KanReferences = { face: string; outfit: string; alternate: string };

export function loadKanReferenceImages(wearsAkatsukiCloak: boolean): Promise<KanReferences> {
  if (!referencesPromise) {
    referencesPromise = Promise.all([
      toDataUri(Asset.fromModule(kanFaceSheet)),
      toDataUri(Asset.fromModule(kanOutfitBlack)),
      toDataUri(Asset.fromModule(kanOutfitAkatsuki)),
    ]).then((values) => values.filter(Boolean));
  }

  return referencesPromise.then(([face, black, akatsuki]) => {
    const current = wearsAkatsukiCloak ? akatsuki : black;
    const alternate = wearsAkatsukiCloak ? black : akatsuki;

    return { face: face ?? '', outfit: current ?? '', alternate: alternate ?? '' };
  });
}

async function toDataUri(asset: Asset) {
  try {
    await asset.downloadAsync();
  } catch {
    // downloadAsync is a no-op for web assets; the remote URI still works.
  }

  const uri = asset.localUri ?? asset.uri;

  if (!uri) {
    return '';
  }

  if (uri.startsWith('data:')) {
    return uri;
  }

  try {
    const response = await fetch(uri);

    if (!response.ok) {
      return uri;
    }

    const blob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(new Error('Could not read reference image.'));
      reader.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

export { faceDroppedWarning, planReferences } from './referencePlan';
export type { PlannedReference, ReferenceKind } from './referencePlan';
