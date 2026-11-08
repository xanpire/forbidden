// Cast sheets (#6b): several face references drawn side by side on one
// canvas, each with its name baked in under it, sent as ONE reference image.
// Models cap how many references they take; a cast sheet turns 3 faces into
// 10+ without going over. Web only: where there is no canvas the people go
// one per slot as before.

import type { PlannedReference } from './referencePlan';

/** Most faces on one sheet, so each stays big enough to read. */
export const CAST_SHEET_MAX = 6;

const TILE = 240;
const LABEL = 44;
const GAP = 8;

function loadBitmap(uri: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    try {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = uri;
    } catch {
      resolve(null);
    }
  });
}

export function canBuildCastSheet() {
  return typeof document !== 'undefined';
}

/** Draws the faces left to right with their names under them. Null when it can't. */
export async function buildCastSheet(people: { name: string; uri: string }[]): Promise<string | null> {
  if (!canBuildCastSheet() || people.length === 0) {
    return null;
  }

  const bitmaps = await Promise.all(people.map((person) => loadBitmap(person.uri)));

  if (bitmaps.some((bitmap) => !bitmap || !bitmap.naturalWidth)) {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = people.length * TILE + (people.length + 1) * GAP;
  canvas.height = TILE + LABEL + GAP * 2;
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  bitmaps.forEach((bitmap, index) => {
    const image = bitmap as HTMLImageElement;
    const x = GAP + index * (TILE + GAP);
    // Cover-crop to a square, keeping the top (faces sit high in portraits).
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    const sx = (image.naturalWidth - side) / 2;
    const sy = image.naturalHeight > side ? (image.naturalHeight - side) * 0.2 : 0;

    context.drawImage(image, sx, sy, side, side, x, GAP, TILE, TILE);

    context.fillStyle = '#000000';
    context.font = 'bold 22px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const label = people[index].name.split(' ')[0];
    context.fillText(label, x + TILE / 2, GAP + TILE + LABEL / 2, TILE - 8);
  });

  const encoded = canvas.toDataURL('image/jpeg', 0.85);
  return encoded.startsWith('data:image/') ? encoded : null;
}

/**
 * Fits the people into the slots they have. When there are more people than
 * slots and a cast sheet can be drawn, everyone goes onto sheets of up to six
 * (as few sheets as possible, at most one per slot). Otherwise one per slot,
 * the first ones first.
 */
export async function packPeopleReferences(
  people: { name: string; uri: string; source?: 'face' | 'portrait' }[],
  slots: number,
  draw: (people: { name: string; uri: string }[]) => Promise<string | null> = buildCastSheet
): Promise<PlannedReference[]> {
  const ready = people.filter((person) => person.uri);
  const individual = (list: typeof ready) =>
    list.map((person) => ({ kind: 'character' as const, uri: person.uri, name: person.name, source: person.source }));

  if (slots <= 0) {
    return [];
  }

  if (ready.length <= slots) {
    return individual(ready);
  }

  const kept = ready.slice(0, slots * CAST_SHEET_MAX);
  const sheetCount = Math.min(slots, Math.ceil(kept.length / CAST_SHEET_MAX));
  const perSheet = Math.ceil(kept.length / sheetCount);
  const sheets: PlannedReference[] = [];

  for (let i = 0; i < kept.length; i += perSheet) {
    const group = kept.slice(i, i + perSheet);
    const uri = group.length === 1 ? group[0].uri : await draw(group);

    if (!uri) {
      return individual(ready.slice(0, slots));
    }

    sheets.push(
      group.length === 1
        ? individual(group)[0]
        : { kind: 'cast', uri, names: group.map((person) => person.name) }
    );
  }

  return sheets;
}
