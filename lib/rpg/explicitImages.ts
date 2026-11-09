// Explicit pictures: the last step of the one picture pipeline (paintScene.ts).
//
// The director writes the shot like for any picture; when it goes to an
// explicit provider (Runware or Wiro), these safeguards hold, in code:
// - Raw story text never reaches the image model: the director writes a new
//   description of the moment, and only that is sent.
// - People's looks and ages come only from their checked sheets and in-app
//   reference sheets. The director describes what people do, never how old
//   they are or what their bodies look like.
// - The director's description is checked before sending, and the picture is
//   dropped if it calls anyone young or childlike, mentions an age, or names a
//   real person.
// - Everyone in the picture passes canBeIntimate (a stated adult, never
//   described as a child, never a real person), or no explicit picture is made.
// - Every person line states an adult age and an adult body, and a fixed
//   negative prompt rules out anything childlike.
// - References are only images made inside the app from written appearance:
//   generated reference sheets, or portraits painted without a face
//   reference. Uploaded photos are never sent to an explicit provider.

import { entityAge } from './calendar';
import { latestCharacterPortrait } from './characterPortrait';
import { entityCanBeIntimate, playerCanBeIntimate, CHECK_REASONS } from './intimacy';
import { lightLine } from './imageDirection';
import { playerAge } from './player';
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

export const ADULT_NEGATIVE =
  'child, children, kid, minor, underage, teen, teenager, adolescent, young-looking, childlike face, childlike body, school uniform, loli, shota, small child-like proportions, real celebrity likeness, text, watermark, logo';

export type ExplicitPrompt = { positive: string; negative: string; references: ExplicitReference[] };
export type ExplicitReference = { entityId: string; image: string; label: string };

// ---------------------------------------------------------------------------
// Checked text

/** Words that pull a description younger; dropped from sheet text that reaches an explicit prompt. */
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

/** Anyone called young or childlike in the director's words. */
const CHILDLIKE_WORDS =
  /\b(child|children|childlike|child-like|kid|kids|kiddo|minor|minors|underage|under-age|teen|teens|teenage|teenager|adolescent|preteen|pre-teen|tween|juvenile|young|younger|youthful|girl|girls|boy|boys|little girl|little boy|petite|baby-faced|babyish|schoolgirl|schoolboy|school uniform|student uniform|loli|lolita|shota|barely legal|innocent-looking|flat-chested|pubescent|prepubescent)\b/i;
/** Any age at all: the sheets are the only place ages come from. */
const AGE_WORDS = /\b(\d{1,3}[- ]?(?:years?|yrs?|y\/o|yo)[- ]?old|\d{1,3}[- ]year[- ]old|aged? \d{1,3}|age of \d{1,3}|in (?:her|his|their) (?:teens|twenties|thirties|forties|fifties)|ageless|eighteen|nineteen)\b/i;

export type TextCheck = { ok: true } | { ok: false; reason: string };

/** The director's description, checked before anything is sent to an explicit provider. */
export function checkDirectorText(db: AppDatabase, text: string): TextCheck {
  const childlike = CHILDLIKE_WORDS.exec(text);
  if (childlike) return { ok: false, reason: `the description called someone "${childlike[0]}"` };
  const age = AGE_WORDS.exec(text);
  if (age) return { ok: false, reason: 'the description mentioned an age' };
  const real = db.entities.find(
    (entity) => entity.realPerson && [entity.name, ...entity.aliases].some((name) => name.trim().length > 2 && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text))
  );
  if (real) return { ok: false, reason: `the description names a real person (${real.name})` };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Who is in the picture

export type PictureMember = { entity: EntityRecord; name: string; age: number; gender: string; look: string; isPlayer: boolean };
export type CastCheck = { ok: true; members: PictureMember[] } | { ok: false; reason: string };

function memberOf(db: AppDatabase, entity: EntityRecord): PictureMember | string {
  const isPlayer = entity.tags.includes('player');
  const check = isPlayer ? playerCanBeIntimate(db) : entityCanBeIntimate(db, entity);
  if (!check.ok) return `${entity.name} ${CHECK_REASONS[check.reason]}`;
  const age = isPlayer ? playerAge(db) : entityAge(db.state.inStoryDate, entity);
  if (typeof age !== 'number' || age < 18) return `${entity.name} has no stated adult age`;
  const gender = isPlayer ? db.state.player.gender : entity.gender ?? '';
  const look = cleanSheetField(isPlayer ? db.state.player.appearance : entity.appearance === 'Unknown' ? '' : entity.appearance);
  return {
    entity,
    name: entity.name,
    age,
    gender: /^(f|female|woman)$/i.test(gender) ? 'woman' : /^(m|male|man)$/i.test(gender) ? 'man' : 'adult',
    look,
    isPlayer,
  };
}

/** The adults-only check for a whole picture: everyone must pass, or nothing is made. */
export function checkPictureCast(db: AppDatabase, people: EntityRecord[]): CastCheck {
  if (people.length === 0) return { ok: false, reason: 'nobody is in the picture' };
  const members: PictureMember[] = [];
  for (const entity of people) {
    const member = memberOf(db, entity);
    if (typeof member === 'string') return { ok: false, reason: member };
    members.push(member);
  }
  return { ok: true, members };
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
  const entity = db.entities.find((item) => item.id === entityId);
  const member = entity ? memberOf(db, entity) : 'someone in the picture is not in the story';
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
// The prompt

/**
 * The explicit provider's prompt: the art style, each person from their
 * checked sheet only, then the director's checked shot and action, the light
 * from the clock and weather, and the place. Throws when the cast or the
 * director's text fails a check (the request is never sent).
 */
export function explicitScenePrompt(
  db: AppDatabase,
  people: EntityRecord[],
  directed: { action: string; shot?: string },
  options: { maxReferences?: number } = {}
): ExplicitPrompt {
  const cast = checkPictureCast(db, people);
  if (!cast.ok) throw new Error(`No picture: ${cast.reason}.`);
  const text = checkDirectorText(db, `${directed.action} ${directed.shot ?? ''}`);
  if (!text.ok) throw new Error(`No picture: ${text.reason}.`);

  const references = explicitReferences(db, cast.members.map((member) => member.entity.id)).slice(0, options.maxReferences ?? 4);
  const refIndex = new Map(references.map((ref, index) => [ref.entityId, index + 1]));
  const style = cleanSheetField(db.world?.artStyle, 120) || 'cinematic photo, natural light';

  const lines = cast.members.map((member) => {
    const ref = refIndex.get(member.entity.id);
    return [
      `${member.name}: an adult ${member.gender}, ${member.age} years old, with a fully adult body`,
      member.look ? `; ${member.look}` : '',
      ref ? `; matches reference image ${ref}` : '',
      '.',
    ].join('');
  });

  const positive = [
    `${style}; a widescreen still.`,
    'An explicit adult scene between consenting adults, all clearly over 18. Only the people listed here appear.',
    ...lines,
    directed.shot ? `SHOT: ${directed.shot}` : '',
    `ACTION (depict this exactly): ${directed.action}`,
    lightLine(db, directed.action),
    `Location: ${cleanSheetField(db.state.location, 120)}.`,
    references.length ? 'Use the reference images for faces and bodies only; ignore their clothes, poses and backgrounds.' : '',
    'Adult proportions and adult faces only. No text, no watermark.',
  ]
    .filter(Boolean)
    .join('\n');

  return { positive, negative: ADULT_NEGATIVE, references };
}
