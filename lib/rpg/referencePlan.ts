/** Which reference images go with an image request. Pure, so it can be tested. */
export type ReferenceKind = 'face' | 'outfit' | 'alternate' | 'previous';

export type PlannedReference = { kind: ReferenceKind; uri: string };

/**
 * Picks the references that fit the model's limit, most important first:
 * Kan's face always comes first so it is the last thing to be left out.
 * `faceDropped` is true when the face could not be sent, so the caller can
 * warn instead of silently drawing a stranger.
 */
export function planReferences(
  candidates: PlannedReference[],
  maxReferences: number
): {
  references: PlannedReference[];
  /** Why Kan's face isn't in the request, or null when it is. */
  faceDropped: 'no-references' | 'not-loaded' | null;
  leftOut: ReferenceKind[];
} {
  const order: ReferenceKind[] = ['face', 'outfit', 'previous', 'alternate'];
  const available = candidates
    .filter((candidate) => Boolean(candidate.uri))
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (a, b) =>
        order.indexOf(a.candidate.kind) - order.indexOf(b.candidate.kind) || a.index - b.index
    )
    .map((entry) => entry.candidate);
  const references = available.slice(0, Math.max(0, maxReferences));
  const leftOut = available.slice(references.length).map((reference) => reference.kind);
  const faceLoaded = available.some((reference) => reference.kind === 'face');
  const faceSent = references.some((reference) => reference.kind === 'face');

  return {
    references,
    faceDropped: faceSent ? null : faceLoaded ? 'no-references' : 'not-loaded',
    leftOut,
  };
}

export function faceDroppedWarning(
  reason: 'no-references' | 'not-loaded',
  model: string
) {
  return reason === 'not-loaded'
    ? 'Kan’s face reference couldn’t be loaded, so this image went without it and his face may not match.'
    : `Kan’s face reference wasn’t sent: ${model} doesn’t accept reference images, so his face may not match. Pick a reference-capable image model in Settings.`;
}
