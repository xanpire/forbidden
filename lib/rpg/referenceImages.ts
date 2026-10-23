import { Asset } from 'expo-asset';

const kanNoCloak = require('../../assets/images/kan-no-cloak.jpg');
const kanAkatsuki = require('../../assets/images/kan-akatsuki.jpg');
const kanFaceNoCloak = require('../../assets/images/kan-face-no-cloak.jpg');
const kanFaceAkatsuki = require('../../assets/images/kan-face-akatsuki.jpg');

const referenceCache = new Map<boolean, Promise<string[]>>();

export function loadKanReferenceImages(wearsAkatsukiCloak: boolean) {
  const cached = referenceCache.get(wearsAkatsukiCloak);

  if (cached) {
    return cached;
  }

  const currentFull = wearsAkatsukiCloak ? kanAkatsuki : kanNoCloak;
  const currentFace = wearsAkatsukiCloak ? kanFaceAkatsuki : kanFaceNoCloak;
  const alternateFull = wearsAkatsukiCloak ? kanNoCloak : kanAkatsuki;
  const alternateFace = wearsAkatsukiCloak ? kanFaceNoCloak : kanFaceAkatsuki;

  const references = Promise.all([
    toDataUri(Asset.fromModule(currentFull)),
    toDataUri(Asset.fromModule(currentFace)),
    toDataUri(Asset.fromModule(alternateFull)),
    toDataUri(Asset.fromModule(alternateFace)),
  ]).then((values) => values.filter(Boolean));

  referenceCache.set(wearsAkatsukiCloak, references);

  return references;
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
