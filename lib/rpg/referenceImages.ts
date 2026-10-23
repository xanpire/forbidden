import { Image } from 'react-native';

const kanNoCloak = require('../../assets/images/kan-no-cloak.jpg');
const kanAkatsuki = require('../../assets/images/kan-akatsuki.jpg');
const kanFaceNoCloak = require('../../assets/images/kan-face-no-cloak.jpg');
const kanFaceAkatsuki = require('../../assets/images/kan-face-akatsuki.jpg');

let cachedReferences: Promise<string[]> | null = null;

export function loadKanReferenceImages() {
  if (!cachedReferences) {
    cachedReferences = Promise.all([
      toDataUri(Image.resolveAssetSource(kanNoCloak).uri),
      toDataUri(Image.resolveAssetSource(kanAkatsuki).uri),
      toDataUri(Image.resolveAssetSource(kanFaceNoCloak).uri),
      toDataUri(Image.resolveAssetSource(kanFaceAkatsuki).uri),
    ]).then((references) => references.filter(Boolean));
  }

  return cachedReferences;
}

async function toDataUri(uri: string) {
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
