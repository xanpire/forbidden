// Smaller images: generated pictures arrive as large JPEG/PNG data URIs
// (~900 KB). On the web they are redrawn as WebP, stepping quality down until
// they fit, so a save's images take a fraction of the space.

export type CompressOptions = {
  /** Longest side in pixels after resizing. */
  maxSide: number;
  /** Starting WebP quality (0-1). */
  quality: number;
  /** Aim for at most this many bytes. */
  maxBytes: number;
};

/** Scene images and portraits. */
export const SCENE_IMAGE: CompressOptions = { maxSide: 1376, quality: 0.8, maxBytes: 200_000 };
/** Face references: small, they only need to show a face. */
export const FACE_IMAGE: CompressOptions = { maxSide: 512, quality: 0.8, maxBytes: 60_000 };

/** Bytes held by a base64 data URI. */
export function dataUriBytes(dataUri: string): number {
  const comma = dataUri.indexOf(',');
  const body = comma === -1 ? dataUri : dataUri.slice(comma + 1);
  return Math.floor((body.length * 3) / 4);
}

function loadBitmap(dataUri: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = dataUri;
    } catch {
      resolve(null);
    }
  });
}

/**
 * Re-encodes a data URI as WebP within the size limits. Returns the input
 * unchanged where there is no canvas (native), WebP is not supported, or the
 * result would not be smaller.
 */
export async function compressImage(dataUri: string, options: CompressOptions = SCENE_IMAGE): Promise<string> {
  if (typeof document === 'undefined' || !dataUri.startsWith('data:image/') || dataUri.startsWith('data:image/svg')) {
    return dataUri;
  }

  const image = await loadBitmap(dataUri);

  if (!image || !image.naturalWidth || !image.naturalHeight) {
    return dataUri;
  }

  const scale = Math.min(1, options.maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');

  if (!context) {
    return dataUri;
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = options.quality;
  let best = dataUri;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const encoded = canvas.toDataURL('image/webp', quality);

    if (!encoded.startsWith('data:image/webp')) {
      return dataUri;
    }

    if (dataUriBytes(encoded) < dataUriBytes(best)) {
      best = encoded;
    }

    if (dataUriBytes(encoded) <= options.maxBytes) {
      break;
    }

    quality = Math.max(0.4, quality - 0.12);
  }

  return best;
}
