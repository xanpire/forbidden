import { entityAge } from './calendar';
import { localizePlaceNames } from './glossary';
import { shownField } from './disclosure';
import { makeId } from './id';
import { expressionFromMood } from './portrait';
import type { PlannedReference } from './referencePlan';
import type {
  AppDatabase,
  CharacterFaceRecord,
  CharacterPortraitRecord,
  CharacterPortraitSignature,
  EntityRecord,
  PortraitExpression,
} from './types';

/**
 * Portraits for the people in your bonds. Like Kan's, each is painted only
 * when you ask, remembers the few traits it was painted with, and says when
 * the person has changed enough to repaint.
 *
 * Canon characters have no built-in reference sheet, so you can give anyone a
 * face reference (an image you choose, kept only on this device). It is sent
 * with every portrait of them, so their face stays on-model.
 */

/** Portraits kept per person: the newest is shown, the one before guides style. */
export const PORTRAITS_PER_CHARACTER = 4;

/** Their base look, plus how they look right now when that is known. */
function cleanAppearance(db: AppDatabase, entity: EntityRecord) {
  // As Kan has seen them: no canon secret painted before he knows it.
  const text = shownField(db, entity, 'appearance')?.trim() ?? '';
  const base = text && text !== 'Unknown' ? text : '';
  const now = entity.currentLook?.trim();

  return now ? [base, `Right now: ${now}`].filter(Boolean).join(' ') : base;
}

/** Age at death for the dead, so their portrait does not keep ageing. */
function portraitAge(db: AppDatabase, entity: EntityRecord) {
  const date = entity.deceased?.date ?? db.state.inStoryDate;
  return entityAge(date, entity) ?? null;
}

export function characterPortraitSignature(
  db: AppDatabase,
  entity: EntityRecord
): CharacterPortraitSignature {
  return {
    age: portraitAge(db, entity),
    expression: expressionFromMood(entity.mood ?? ''),
    appearance: cleanAppearance(db, entity),
  };
}

export function characterPortraitsOf(db: AppDatabase, entityId: string): CharacterPortraitRecord[] {
  return (db.characterPortraits ?? []).filter((portrait) => portrait.entityId === entityId);
}

export function latestCharacterPortrait(
  db: AppDatabase,
  entityId: string
): CharacterPortraitRecord | null {
  const portraits = characterPortraitsOf(db, entityId);
  return portraits.length > 0 ? portraits[portraits.length - 1] : null;
}

/** Newest portrait per person, for the bonds list. */
export function latestCharacterPortraitMap(db: AppDatabase): Map<string, string> {
  const map = new Map<string, string>();

  for (const portrait of db.characterPortraits ?? []) {
    map.set(portrait.entityId, portrait.image);
  }

  return map;
}

export function characterFaceOf(db: AppDatabase, entityId: string): CharacterFaceRecord | null {
  return (db.characterFaces ?? []).find((face) => face.entityId === entityId) ?? null;
}

/** Why their latest portrait no longer matches them, or null if it still does. */
export function characterPortraitStaleReason(
  latest: CharacterPortraitRecord | null,
  current: CharacterPortraitSignature,
  options: { dead?: boolean; hasFace?: boolean } = {}
): string | null {
  if (!latest) {
    return 'No portrait yet';
  }

  // A face reference added after the last painting is worth a repaint.
  if (options.hasFace && !latest.usedFace) {
    return 'Face reference added';
  }

  // The dead do not change.
  if (options.dead) {
    return null;
  }

  const before = latest.signature;

  if (current.age !== null && before.age !== current.age) {
    return `Turned ${current.age}`;
  }

  if (current.appearance && before.appearance !== current.appearance) {
    return 'Their look has changed';
  }

  if (before.expression !== current.expression) {
    return `Looks ${current.expression} now`;
  }

  return null;
}

const EXPRESSION_TEXT: Record<PortraitExpression, string> = {
  calm: 'calm and composed',
  grim: 'guarded and grim, eyes sharp',
  angry: 'angry, brows drawn, a hard glare',
  tired: 'tired and worn, shoulders heavy',
  warm: 'warm, the hint of a smile',
  sad: 'sorrow held behind a steady face',
};

export function buildCharacterPortraitPrompt(
  db: AppDatabase,
  entity: EntityRecord,
  signature: CharacterPortraitSignature,
  references: PlannedReference[]
) {
  const name = entity.name;
  const lines = [
    `Character portrait of ${name}, a person from the Naruto world. Dark cinematic anime illustration.`,
    'Visual image only. No words, letters, numbers, captions, logos, watermarks or readable text anywhere.',
  ];

  references.forEach((reference, i) => {
    const n = i + 1;

    if (reference.kind === 'face') {
      lines.push(
        `Reference image ${n}: this is ${name}. Match their face exactly — face shape, eyes and eye colour, hair style and colour, skin tone, markings and scars — but redraw them in the style described below, at the age given below.`
      );
    } else if (reference.kind === 'previous') {
      lines.push(
        `Reference image ${n}: ${name}'s previous portrait. Keep the same person, art style, framing and lighting; update age and expression as described below.`
      );
    }
  });

  if (!references.some((reference) => reference.kind === 'face')) {
    lines.push(
      `If ${name} is a character from the Naruto series, draw them with their canon design. Otherwise, follow the description below.`
    );
  }

  if (signature.appearance) {
    lines.push(`Appearance: ${signature.appearance}`);
  }

  const role = shownField(db, entity, 'role');

  if (role) {
    lines.push(`Who they are: ${role}.`);
  }

  if (signature.age !== null) {
    lines.push(`Age: ${signature.age}. Draw them with the build and face of a ${signature.age}-year-old.`);
  }

  lines.push(
    `Expression: ${EXPRESSION_TEXT[signature.expression]}.${entity.mood && entity.mood !== 'Unknown' ? ` Current mood: ${entity.mood}.` : ''}`,
    'Background: dark, softly blurred and atmospheric, nothing that competes with the face.',
    `Framing: head and upper body, three-quarter view, centered, vertical portrait. ${name} alone, no other people.`,
    'Style: Naruto-inspired anime, gritty realism, moody lighting, red accents, high detail.',
    'Final reminder: no text or lettering in the image.'
  );

  return localizePlaceNames(lines.join('\n'));
}

export function faceReferenceWarning(model: string) {
  return `Their face reference wasn’t sent: ${model} doesn’t accept reference images, so they may look off. Pick a reference-capable image model in Settings.`;
}

/** Adds a painted portrait, keeping the newest few per person. */
/** A painting's details as one comparable key. */
export function portraitKey(entityId: string, signature: object, extra = '') {
  return `${entityId}|${JSON.stringify(signature)}|${extra}`;
}

/**
 * Paintings in flight, by entity and details. Each costs money, so a second
 * tap, a second mounted card or a re-run effect never starts another while
 * one is running.
 */
const paintingNow = new Set<string>();

/** Claims the right to paint; false when the same painting is already under way. */
export function beginPainting(key: string): boolean {
  if (paintingNow.has(key)) {
    return false;
  }

  paintingNow.add(key);
  return true;
}

export function endPainting(key: string) {
  paintingNow.delete(key);
}

/** Whether their latest portrait was already painted with exactly these details. */
export function alreadyPainted(
  latest: CharacterPortraitRecord | null,
  signature: CharacterPortraitSignature,
  usedFace: boolean
) {
  return Boolean(latest && JSON.stringify(latest.signature) === JSON.stringify(signature) && latest.usedFace === usedFace);
}

export function addCharacterPortraitToDb(
  db: AppDatabase,
  entityId: string,
  image: string,
  signature: CharacterPortraitSignature,
  usedFace: boolean
): AppDatabase {
  // The same painting landing twice (a double trigger) is kept once.
  const theirLatest = (db.characterPortraits ?? []).filter((portrait) => portrait.entityId === entityId).at(-1) ?? null;

  if (alreadyPainted(theirLatest, signature, usedFace) && Date.now() - (theirLatest?.createdAt ?? 0) < 10 * 60_000) {
    return db;
  }

  const all = [
    ...(db.characterPortraits ?? []),
    {
      id: makeId('cportrait'),
      entityId,
      image,
      signature,
      usedFace,
      inStoryDate: db.state.inStoryDate,
      createdAt: Date.now(),
    },
  ];
  const theirs = all.filter((portrait) => portrait.entityId === entityId);
  const drop = new Set(
    theirs.slice(0, Math.max(0, theirs.length - PORTRAITS_PER_CHARACTER)).map((portrait) => portrait.id)
  );

  return { ...db, characterPortraits: all.filter((portrait) => !drop.has(portrait.id)) };
}

/** Sets or (with null) removes someone's face reference. */
export function setCharacterFaceInDb(
  db: AppDatabase,
  entityId: string,
  image: string | null
): AppDatabase {
  const others = (db.characterFaces ?? []).filter((face) => face.entityId !== entityId);

  return {
    ...db,
    characterFaces: image ? [...others, { entityId, image, addedAt: Date.now() }] : others,
  };
}

/** When two people are merged, their portraits and face reference go to the one kept. */
export function moveCharacterImages(db: AppDatabase, keepId: string, dropId: string): AppDatabase {
  const portraits = db.characterPortraits ?? [];
  const faces = db.characterFaces ?? [];
  const keepFace = faces.find((face) => face.entityId === keepId);
  const dropFace = faces.find((face) => face.entityId === dropId);

  if (!portraits.some((portrait) => portrait.entityId === dropId) && !dropFace) {
    return db;
  }

  const moved = portraits
    .map((portrait) => (portrait.entityId === dropId ? { ...portrait, entityId: keepId } : portrait))
    .sort((a, b) => a.createdAt - b.createdAt);
  const theirs = moved.filter((portrait) => portrait.entityId === keepId);
  const drop = new Set(
    theirs.slice(0, Math.max(0, theirs.length - PORTRAITS_PER_CHARACTER)).map((portrait) => portrait.id)
  );

  return {
    ...db,
    characterPortraits: moved.filter((portrait) => !drop.has(portrait.id)),
    characterFaces: faces
      .filter((face) => face.entityId !== dropId && face.entityId !== keepId)
      .concat(keepFace ? [keepFace] : dropFace ? [{ ...dropFace, entityId: keepId }] : []),
  };
}
