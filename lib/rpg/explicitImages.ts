// Explicit images (session B): pictures of intimate scenes, on demand only.
//
// Safeguards, in code:
// - Everyone in the shot passes canBeIntimate (stated adult, not described as
//   a child, not a real person); otherwise the request is never built.
// - Every character line states an adult age and an adult body, and a fixed
//   negative prompt rules out anything childlike.
// - Structured prompts: built only from fixed lists (position, clothing,
//   setting, framing, shot) and validated sheet fields (adult age, a cleaned
//   appearance, a cleaned art style). Story text and anything the player types
//   in play never reach the prompt.
// - References are only images made inside the app from written appearance:
//   generated reference sheets, or portraits painted without a face reference.
//   Uploaded photos (the player's face/outfit, people's face references) are
//   never sent, so the app can't make explicit images of real people.
// - Explicit images live with the save behind the PIN lock, are never shown in
//   notifications, and are left out of exports unless the player opts in.

import { entityAge } from './calendar';
import { latestCharacterPortrait } from './characterPortrait';
import { makeId } from './id';
import { entityCanBeIntimate, playerCanBeIntimate } from './intimacy';
import { playerAge, playerEntity } from './player';
import type { AppDatabase, EntityRecord } from './types';

export type ExplicitProviderId = 'runware' | 'wiro';

export const EXPLICIT_PROVIDERS: { id: ExplicitProviderId; label: string; filtered: boolean; note: string }[] = [
  { id: 'runware', label: 'Runware', filtered: true, note: 'Content check off; the provider still blocks illegal content.' },
  { id: 'wiro', label: 'Wiro', filtered: false, note: 'Uncensored Seedream: no provider filter, so the app is the only safeguard.' },
];

export const DEFAULT_EXPLICIT_MODELS: Record<ExplicitProviderId, string> = {
  runware: 'runware:101@1',
  wiro: 'ByteDance/seedream-v4-5-uncensored',
};

// ---------------------------------------------------------------------------
// The fixed lists the structured choices come from

export const POSITIONS = {
  embrace: 'holding each other close',
  kiss: 'kissing deeply',
  undressing: 'undressing each other',
  bed: 'lying together in bed',
  lap: 'one sitting astride the other\'s lap',
  shower: 'together in the shower',
  after: 'resting together afterwards, tangled in the sheets',
  solo: 'alone, reclining and looking at the viewer',
} as const;

export const CLOTHING = {
  dressed: 'fully dressed',
  partly: 'partly undressed',
  underwear: 'in underwear',
  nude: 'nude',
} as const;

export const SETTINGS_LIST = {
  bedroom: 'a bedroom',
  hotel: 'a hotel room',
  living: 'a living room sofa',
  bathroom: 'a bathroom',
  car: 'the back seat of a car',
  outdoors: 'a secluded spot outdoors',
  period: 'a room fitting the period',
} as const;

export const FRAMINGS = {
  close: 'close-up',
  medium: 'medium shot',
  wide: 'wide shot',
} as const;

export const SHOTS = {
  eye: 'eye-level camera',
  high: 'high angle from above',
  low: 'low angle',
  pov: 'point-of-view shot',
} as const;

export type ExplicitShot = {
  /** Entity ids of everyone in the picture (the player's id included when they are). */
  castIds: string[];
  position: keyof typeof POSITIONS;
  clothing: keyof typeof CLOTHING;
  setting: keyof typeof SETTINGS_LIST;
  framing: keyof typeof FRAMINGS;
  shot: keyof typeof SHOTS;
  /** Whose face the camera favours. */
  focusId?: string;
};

export const ADULT_NEGATIVE =
  'child, children, kid, minor, underage, teen, teenager, adolescent, young-looking, childlike face, childlike body, school uniform, loli, shota, small child-like proportions, real celebrity likeness, text, watermark, logo';

// ---------------------------------------------------------------------------
// Validated fields

/** Words that pull a description younger; dropped from anything that reaches an explicit prompt. */
const YOUNGER = /\b(young(?:-looking|ish)?|youthful|little|tiny|petite|small-framed|childlike|child-like|child|kid|girl|girls|boy|boys|baby|babyish|innocent|school|schoolgirl|schoolboy|uniform|teen|teenage|teenager|minor|underage|loli|lolita|shota|cub|barely legal|flat-chested|immature|adolescent|juvenile|preteen|tween)\b/gi;

/** A sheet field cleaned for an explicit prompt: no age-lowering words, no quotes or line breaks, short. */
export function cleanSheetField(value: string | undefined, max = 220): string {
  return (value ?? '')
    .replace(/["“”`{}<>[\]]/g, ' ')
    .replace(YOUNGER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/(^[,.;:\s]+|[,;:\s]+$)/g, '')
    .trim()
    .slice(0, max);
}

export type ShotMember = { entityId: string; age: number; gender: string; look: string; isPlayer: boolean };

export type ExplicitCheck = { ok: true; members: ShotMember[] } | { ok: false; reason: string };

function memberOf(db: AppDatabase, id: string): ShotMember | string {
  const entity = db.entities.find((item) => item.id === id);
  if (!entity) return 'someone in the picture is not in the story';
  const isPlayer = entity.tags.includes('player');
  const check = isPlayer ? playerCanBeIntimate(db) : entityCanBeIntimate(db, entity);
  if (!check.ok) return `${entity.name} can't be in an explicit picture (${check.reason})`;
  const age = isPlayer ? playerAge(db) : entityAge(db.state.inStoryDate, entity);
  if (typeof age !== 'number' || age < 18) return `${entity.name} has no stated adult age`;
  const gender = isPlayer ? db.state.player.gender : entity.gender ?? '';
  const look = cleanSheetField(isPlayer ? db.state.player.appearance : entity.appearance === 'Unknown' ? '' : entity.appearance);
  return { entityId: entity.id, age, gender: /^(f|female|woman)$/i.test(gender) ? 'woman' : /^(m|male|man)$/i.test(gender) ? 'man' : 'adult', look, isPlayer };
}

/** The adults-only check for a whole picture: everyone must pass, or nothing is built. */
export function checkShot(db: AppDatabase, shot: ExplicitShot): ExplicitCheck {
  if (shot.castIds.length === 0) return { ok: false, reason: 'nobody is in the picture' };
  if (shot.castIds.length > 3) return { ok: false, reason: 'at most three people in a picture' };
  const members: ShotMember[] = [];
  for (const id of shot.castIds) {
    const member = memberOf(db, id);
    if (typeof member === 'string') return { ok: false, reason: member };
    members.push(member);
  }
  return { ok: true, members };
}

// ---------------------------------------------------------------------------
// The prompt

export type ExplicitPrompt = { positive: string; negative: string; references: ExplicitReference[] };

export type ExplicitReference = { entityId: string; image: string; label: string };

/**
 * Builds the explicit image prompt from structured choices only. Throws when
 * anyone in the shot fails the adults-only check (the request is never built).
 */
export function explicitImagePrompt(db: AppDatabase, shot: ExplicitShot, options: { maxReferences?: number } = {}): ExplicitPrompt {
  const check = checkShot(db, shot);
  if (!check.ok) throw new Error(`No picture: ${check.reason}.`);

  const references = explicitReferences(db, check.members.map((m) => m.entityId)).slice(0, options.maxReferences ?? 4);
  const refIndex = new Map(references.map((ref, index) => [ref.entityId, index + 1]));
  const style = cleanSheetField(db.world?.artStyle, 120) || 'cinematic photo, natural light';
  const solo = check.members.length === 1;
  const position = solo ? POSITIONS.solo : POSITIONS[shot.position === 'solo' ? 'embrace' : shot.position];

  const people = check.members.map((member, index) => {
    const ref = refIndex.get(member.entityId);
    return [
      `Person ${index + 1}: an adult ${member.gender}, ${member.age} years old, with a fully adult body`,
      member.look ? `; ${member.look}` : '',
      ref ? `; matches reference image ${ref}` : '',
      '.',
    ].join('');
  });
  const focusIndex = shot.focusId ? check.members.findIndex((m) => m.entityId === shot.focusId) : -1;

  const positive = [
    `${style}.`,
    `An intimate, explicit adult scene between consenting adults, all clearly over 18.`,
    ...people,
    `${solo ? 'Person 1 is' : 'They are'} ${position}, ${CLOTHING[shot.clothing]}, in ${SETTINGS_LIST[shot.setting]}.`,
    `${FRAMINGS[shot.framing]}, ${SHOTS[shot.shot]}${focusIndex >= 0 ? `, focused on person ${focusIndex + 1}'s face` : ''}.`,
    references.length ? 'Use the reference images for faces and bodies only; ignore their clothes, poses and backgrounds.' : '',
    'Adult proportions and adult faces only. No text, no watermark.',
  ]
    .filter(Boolean)
    .join(' ');

  return { positive, negative: ADULT_NEGATIVE, references };
}

/** The default choices for a picture of the current intimate scene. */
export function defaultShot(db: AppDatabase): ExplicitShot {
  const player = playerEntity(db);
  const partners = (db.state.sceneMode?.intimateWith ?? []).slice(0, 2);
  const castIds = [...(player ? [player.id] : []), ...partners];
  const location = db.state.location.toLowerCase();
  const setting: ExplicitShot['setting'] =
    /hotel|motel|inn/.test(location) ? 'hotel' : /bath|shower/.test(location) ? 'bathroom' : /car\b/.test(location) ? 'car' : db.state.locationKind === 'wilderness' ? 'outdoors' : 'bedroom';
  return { castIds, position: partners.length ? 'embrace' : 'solo', clothing: 'partly', setting, framing: 'medium', shot: 'eye', focusId: partners[0] };
}

// ---------------------------------------------------------------------------
// References: only images made inside the app from written appearance

/**
 * The reference for each person, in order: a generated reference sheet, else
 * a portrait painted without a face reference. Never an uploaded photo, never
 * a portrait painted from one, never the player's face or outfit upload.
 */
export function explicitReferences(db: AppDatabase, entityIds: string[]): ExplicitReference[] {
  const out: ExplicitReference[] = [];
  for (const id of entityIds) {
    const sheet = [...(db.explicitRefs ?? [])].reverse().find((ref) => ref.entityId === id);
    if (sheet) {
      out.push({ entityId: id, image: sheet.image, label: 'reference sheet' });
      continue;
    }
    const entity = db.entities.find((item) => item.id === id);
    if (!entity || entity.tags.includes('player')) continue;
    const portrait = latestCharacterPortrait(db, id);
    if (portrait && !portrait.usedFace) out.push({ entityId: id, image: portrait.image, label: 'portrait' });
  }
  return out;
}

/** Who still needs a reference sheet before their explicit pictures stay consistent. */
export function missingReferences(db: AppDatabase, entityIds: string[]): EntityRecord[] {
  const have = new Set(explicitReferences(db, entityIds).map((ref) => ref.entityId));
  return entityIds.map((id) => db.entities.find((entity) => entity.id === id)).filter((entity): entity is EntityRecord => Boolean(entity) && !have.has(entity!.id));
}

/** A non-explicit reference sheet prompt, from written appearance only (standard pipeline, no references). */
export function referenceSheetPrompt(db: AppDatabase, entityId: string): string {
  const member = memberOf(db, entityId);
  if (typeof member === 'string') throw new Error(`No reference: ${member}.`);
  const style = cleanSheetField(db.world?.artStyle, 120) || 'cinematic photo, natural light';
  return [
    `Character reference sheet, ${style}.`,
    `An adult ${member.gender}, ${member.age} years old, with a fully adult face and body${member.look ? `: ${member.look}` : ''}.`,
    'Two views side by side: a head-and-shoulders portrait and a full-body standing view, in simple everyday clothes, neutral pose, plain light background.',
    'Visual image only: no words, letters, captions or watermarks.',
  ].join(' ');
}

export function addExplicitRef(db: AppDatabase, entityId: string, image: string): AppDatabase {
  const kept = (db.explicitRefs ?? []).filter((ref) => ref.entityId !== entityId);
  return { ...db, explicitRefs: [...kept, { entityId, image, createdAt: Date.now() }] };
}

// ---------------------------------------------------------------------------
// The gallery

export function addExplicitImage(
  db: AppDatabase,
  record: { image: string; shot: ExplicitShot; provider: ExplicitProviderId; model: string; cost?: number }
): AppDatabase {
  const item = {
    id: makeId('explicit'),
    image: record.image,
    shot: record.shot,
    provider: record.provider,
    model: record.model,
    ...(typeof record.cost === 'number' ? { cost: record.cost } : {}),
    inStoryDate: db.state.inStoryDate,
    createdAt: Date.now(),
  };
  return { ...db, explicitImages: [...(db.explicitImages ?? []), item].slice(-200) };
}

export function deleteExplicitImage(db: AppDatabase, id: string): AppDatabase {
  return { ...db, explicitImages: (db.explicitImages ?? []).filter((item) => item.id !== id) };
}

/** A save without its explicit images and reference sheets (exports, unless the player opts in). */
export function withoutExplicit(db: AppDatabase): AppDatabase {
  const { explicitImages: _images, explicitRefs: _refs, ...rest } = db;
  return {
    ...rest,
    snapshots: db.snapshots.map((snapshot) => {
      const { explicitImages: _i, explicitRefs: _r, ...database } = snapshot.database as AppDatabase;
      return { ...snapshot, database };
    }),
  } as AppDatabase;
}

/** "Picture this" shows only in an intimate scene that everyone in it is allowed to be in. */
export function canPictureThis(db: AppDatabase): boolean {
  const partners = db.state.sceneMode?.intimateWith ?? [];
  if (partners.length === 0) return false;
  return checkShot(db, defaultShot(db)).ok;
}
