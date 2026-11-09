// Romance and intimacy (the adult layer): relationship labels, attraction,
// who could fall for the player, the intimacy ladder and its pacing, each
// person's own desires and boundaries, the player's content profile, and the
// two hard limits that live in code, never in settings:
//
// 1. Adults only. Everyone in an intimate scene, the player included, has a
//    stated age of 18 or older and is never described as a child.
// 2. No real people. A real, identifiable person never takes part.
//
// Nothing else is filtered: the player's own limits are optional, and the
// app adds no boundaries of its own. Nothing here hard-codes an orientation.

import { entityAge } from './calendar';
import { playerAge } from './player';
import type { AppDatabase, BondRecord, ContentProfile, ContentTag, EntityRecord, IntimacyProfile, TurnDiff } from './types';

/**
 * The fixed set of relationship labels. "partner" means a work
 * partner; a romantic partner is "lover".
 */
export type RelationshipStage =
  | 'stranger'
  | 'acquaintance'
  | 'friendly'
  | 'close'
  | 'old friend'
  | 'family'
  | 'teammate'
  | 'partner'
  | 'mentor'
  | 'student'
  | 'rival'
  | 'enemy'
  | 'romantic interest'
  | 'lover'
  | 'rejected'
  /** Was with the player once; it ended. */
  | 'ex';

export type Attraction = 'none' | 'warm' | 'strong';


export const RELATIONSHIP_STAGES: RelationshipStage[] = [
  'stranger',
  'acquaintance',
  'friendly',
  'close',
  'old friend',
  'family',
  'teammate',
  'partner',
  'mentor',
  'student',
  'rival',
  'enemy',
  'romantic interest',
  'lover',
  'rejected',
  'ex',
];

const ATTRACTIONS: Attraction[] = ['none', 'warm', 'strong'];

export function normalizeRelationship(value: string | undefined): RelationshipStage | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.trim().toLowerCase();

  const exact = RELATIONSHIP_STAGES.find((stage) => stage === lower);

  if (exact) {
    return exact;
  }

  if (
    lower === 'exes' ||
    lower.startsWith('ex-') ||
    lower.startsWith('ex ') ||
    lower.includes('former partner') ||
    lower.includes('former lover') ||
    lower.includes('broke up') ||
    lower.includes('broken up')
  ) {
    return 'ex';
  }

  if (lower.includes('reject') || lower.includes('refus') || lower.includes('deni')) {
    return 'rejected';
  }

  if (lower.includes('lover') || lower.includes('dating') || lower.includes('romantic partner') || lower.includes('girlfriend')) {
    return 'lover';
  }

  if (lower.includes('partner')) {
    return 'partner';
  }

  if (lower.includes('old friend') || lower.includes('childhood')) {
    return 'old friend';
  }

  if (lower.includes('brother') || lower.includes('sister') || lower.includes('family') || lower.includes('cousin')) {
    return 'family';
  }

  if (lower.includes('teammate') || lower.includes('team ')) {
    return 'teammate';
  }

  if (lower.includes('sensei') || lower.includes('mentor') || lower.includes('teacher')) {
    return 'mentor';
  }

  if (lower.includes('student') || lower.includes('pupil')) {
    return 'student';
  }

  if (lower.includes('rival')) {
    return 'rival';
  }

  if (lower.includes('enemy') || lower.includes('hostile') || lower.includes('foe')) {
    return 'enemy';
  }

  if (lower.includes('acquaint')) {
    return 'acquaintance';
  }

  if (lower.includes('romantic') || lower.includes('interest') || lower.includes('crush')) {
    return 'romantic interest';
  }

  if (lower.includes('close') || lower.includes('bonded') || lower.includes('trusted')) {
    return 'close';
  }

  if (lower.includes('friend') || lower.includes('friendly') || lower.includes('ally')) {
    return 'friendly';
  }

  if (lower.includes('stranger')) {
    return 'stranger';
  }

  return undefined;
}

export function normalizeAttraction(value: string | undefined): Attraction | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.trim().toLowerCase();

  const exact = ATTRACTIONS.find((level) => level === lower);

  if (exact) {
    return exact;
  }

  if (lower.includes('none') || lower.includes('no') || lower.includes('indiffer')) {
    return 'none';
  }

  if (lower.includes('strong') || lower.includes('deep')) {
    return 'strong';
  }

  if (lower.includes('warm') || lower.includes('soft') || lower.includes('mild')) {
    return 'warm';
  }

  return undefined;
}

/**
 * Whether someone could fall for the player, from who they are drawn to and
 * the player's own gender. Undefined when the story hasn't said.
 */
export function interestFor(
  attractedTo: string | undefined,
  playerGender: string | undefined
): IntimacyProfile['interestedInPlayer'] | undefined {
  const drawn = attractedTo?.trim().toLowerCase();

  if (!drawn || drawn === 'unknown') return undefined;
  if (drawn === 'none') return 'no';
  if (drawn === 'both' || drawn === 'anyone') return 'could-grow';

  const player = playerGender?.trim().toLowerCase() ?? '';
  const playerIsMan = /^(m|male|man)$/.test(player);
  const playerIsWoman = /^(f|female|woman)$/.test(player);

  if (!playerIsMan && !playerIsWoman) return undefined;
  if (drawn === 'men') return playerIsMan ? 'could-grow' : 'no';
  if (drawn === 'women') return playerIsWoman ? 'could-grow' : 'no';
  return undefined;
}

// Prompt rules: injected into the narration system prompt. Kept compact to
// protect the token budget.
export const ROMANCE_RULES = `ROMANCE AND SEX
- Sex happens when both people want it: a slow romance, a fling, or a one-night stand with someone the player just met. Whether someone wants it comes from who they are, their mood and their card (what draws them, what they like, what they won't do), never from how long they have known the player.
- Someone not drawn to the player, or whose heart belongs elsewhere, says no unless the story gives them a real reason; friendship can still grow.
- Love is earned over time and can fail. Bonds show where things stand between people.
- Only adults: everyone involved is 18 or older in the story. Anyone under 18, or whose age is not stated, is never romantic or sexual, in any scene or framing.
- A no holds: pushing again only hardens it. People can change their minds, from their own side and for a reason the story shows.
- People remember what they did together: what they liked, what they didn't want, how it ended. Let it shape what they say and want next time.`;

// ---------------------------------------------------------------------------
// The intimacy ladder and pacing

export const DEFAULT_STAGE_LABELS = ['none', 'interest', 'flirting', 'first kiss', 'lovers', 'established'];

/** The first stage that is physical: from here on both sides must pass canBeIntimate. */
export const FIRST_PHYSICAL_STAGE = 3;

export function defaultContentProfile(): ContentProfile {
  return { pacing: 'natural', interests: [], limits: [] };
}

function cleanText(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function cleanList(value: unknown, max = 20): string[] {
  return Array.isArray(value) ? value.map((item) => cleanText(item)).filter(Boolean).slice(0, max) : [];
}

function cleanTags(value: unknown, kind: 'interest' | 'limit'): ContentTag[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ContentTag | null => {
      if (typeof item === 'string') return cleanText(item) ? { label: cleanText(item, 80), ...(kind === 'interest' ? { weight: 'like' as const } : { kind: 'hard' as const }) } : null;
      if (!item || typeof item !== 'object') return null;
      const raw = item as Record<string, unknown>;
      const label = cleanText(raw.label, 80);
      if (!label) return null;
      const note = cleanText(raw.note);
      if (kind === 'interest') {
        const weight = raw.weight === 'love' || raw.weight === 'okay' ? raw.weight : 'like';
        return { label, weight, ...(note ? { note } : {}) };
      }
      return { label, kind: raw.kind === 'soft' ? 'soft' : 'hard', ...(note ? { note } : {}) };
    })
    .filter((tag): tag is ContentTag => Boolean(tag))
    .slice(0, 40);
}

export function normalizeContentProfile(value: unknown): ContentProfile {
  const base = defaultContentProfile();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Partial<ContentProfile>;
  const labels = cleanList(raw.stageLabels, 8);
  return {
    pacing: raw.pacing === 'slow-burn' || raw.pacing === 'fast' ? raw.pacing : 'natural',
    interests: cleanTags(raw.interests, 'interest'),
    limits: cleanTags(raw.limits, 'limit'),
    ...(cleanText(raw.narratorVoice) ? { narratorVoice: cleanText(raw.narratorVoice) } : {}),
    ...(labels.length === DEFAULT_STAGE_LABELS.length ? { stageLabels: labels } : {}),
  };
}

export function stageLabels(db: Pick<AppDatabase, 'content'>): string[] {
  return db.content?.stageLabels?.length === DEFAULT_STAGE_LABELS.length ? db.content.stageLabels : DEFAULT_STAGE_LABELS;
}

export function stageLabel(db: Pick<AppDatabase, 'content'>, index: number | undefined): string {
  const labels = stageLabels(db);
  return labels[Math.max(0, Math.min(labels.length - 1, index ?? 0))];
}

/** A stage the tracker named, as an index on the ladder (by label, default label or number). */
export function stageIndex(db: Pick<AppDatabase, 'content'>, value: string): number | undefined {
  const lower = value.trim().toLowerCase();
  const custom = stageLabels(db).findIndex((label) => label.toLowerCase() === lower);
  if (custom >= 0) return custom;
  const standard = DEFAULT_STAGE_LABELS.indexOf(lower);
  if (standard >= 0) return standard;
  const number = Number(lower);
  return Number.isInteger(number) && number >= 0 && number < DEFAULT_STAGE_LABELS.length ? number : undefined;
}

// ---------------------------------------------------------------------------
// People's own desires

export function normalizeIntimacy(value: unknown): IntimacyProfile | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Partial<IntimacyProfile>;
  const interested = ['yes', 'could-grow', 'no', 'taken'].includes(raw.interestedInPlayer as string)
    ? (raw.interestedInPlayer as IntimacyProfile['interestedInPlayer'])
    : 'could-grow';
  return {
    orientation: cleanText(raw.orientation, 120),
    interestedInPlayer: interested,
    desires: cleanList(raw.desires),
    boundaries: cleanList(raw.boundaries),
    ...(cleanText(raw.style) ? { style: cleanText(raw.style, 120) } : {}),
    ...(cleanText(raw.experience) ? { experience: cleanText(raw.experience, 120) } : {}),
    ...(cleanText(raw.devotion) ? { devotion: cleanText(raw.devotion, 160) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Hard limits (code, not settings)

/** Words that describe a child. Any of these on someone keeps them out of intimate scenes. */
const CHILDLIKE =
  /\b(child|children|childlike|child-like|kid|kids|minor|underage|under-age|preteen|pre-teen|teen|teens|teenage|teenager|adolescent|pubescent|prepubescent|schoolgirl|schoolboy|grade-schooler|middle-schooler|high-schooler|loli|lolita|shota|toddler|infant|baby-faced child|little girl|little boy|young girl|young boy|tween|juvenile|elementary school|middle school|junior high)\b/i;
/** "Ageless" framings that dodge a stated age. */
const AGELESS = /\b(ageless|looks? (?:like )?(?:a )?(?:child|kid|minor|\d{1,2}[- ]year[- ]old)|appears? (?:to be )?(?:a )?(?:child|minor)|centuries? old but|thousand[- ]year[- ]old)\b/i;

export type IntimacyCheck = { ok: true } | { ok: false; reason: 'no-age' | 'under-18' | 'childlike' | 'real-person' };

/** The adults-only and no-real-people check for one person (or the player). */
export function canBeIntimate(subject: {
  age?: number | null;
  appearance?: string;
  role?: string;
  personality?: string;
  description?: string;
  realPerson?: boolean;
}): IntimacyCheck {
  if (subject.realPerson) return { ok: false, reason: 'real-person' };
  if (typeof subject.age !== 'number' || !Number.isFinite(subject.age) || subject.age <= 0) return { ok: false, reason: 'no-age' };
  if (subject.age < 18) return { ok: false, reason: 'under-18' };
  const text = [subject.appearance, subject.role, subject.personality, subject.description].filter(Boolean).join(' ');
  if (CHILDLIKE.test(text) || AGELESS.test(text)) return { ok: false, reason: 'childlike' };
  return { ok: true };
}

export function entityCanBeIntimate(db: AppDatabase, entity: EntityRecord): IntimacyCheck {
  if (entity.tags.includes('player')) return playerCanBeIntimate(db);
  return canBeIntimate({
    age: entityAge(db.state.inStoryDate, entity),
    appearance: [entity.appearance, entity.currentLook].filter(Boolean).join(' '),
    role: entity.role,
    personality: entity.personality,
    realPerson: entity.realPerson,
  });
}

export function playerCanBeIntimate(db: AppDatabase): IntimacyCheck {
  const player = db.state.player;
  return canBeIntimate({ age: playerAge(db), appearance: player.appearance, role: player.role, personality: player.personality });
}

/** Everyone named (and the player) passes the hard checks. */
export function intimacyAllowed(db: AppDatabase, entityIds: string[] = []): boolean {
  if (!playerCanBeIntimate(db).ok) return false;
  return entityIds.every((id) => {
    const entity = db.entities.find((item) => item.id === id);
    return entity ? entityCanBeIntimate(db, entity).ok : false;
  });
}

export const CHECK_REASONS: Record<Exclude<IntimacyCheck, { ok: true }>['reason'], string> = {
  'no-age': 'has no stated age',
  'under-18': 'is under 18',
  childlike: 'is described as a child',
  'real-person': 'is a real person',
};

// ---------------------------------------------------------------------------
// Applying what the tracker saw

function bondFor(db: AppDatabase, entityId: string | undefined): BondRecord | undefined {
  return entityId ? db.bonds.find((bond) => bond.entityId === entityId) : undefined;
}

function updateBond(db: AppDatabase, id: string, patch: (bond: BondRecord) => BondRecord): AppDatabase {
  return { ...db, bonds: db.bonds.map((bond) => (bond.id === id ? patch(bond) : bond)) };
}

/**
 * The ladder only describes where things stand: it moves to whatever step
 * the page showed, forward (even straight to lovers after one night) or back.
 * A physical step needs both sides to pass the hard checks.
 */
export function applyIntimacyStages(db: AppDatabase, items: TurnDiff['intimacyStages']): AppDatabase {
  let next = db;

  for (const item of items ?? []) {
    const bond = bondFor(next, item.entityId);
    const target = stageIndex(next, item.stage);
    if (!bond || target === undefined || target === (bond.intimacyStage ?? 0)) continue;
    const entity = next.entities.find((e) => e.id === bond.entityId);
    if (target >= FIRST_PHYSICAL_STAGE && (!entity || !intimacyAllowed(next, [entity.id]))) continue;
    next = updateBond(next, bond.id, (b) => ({ ...b, intimacyStage: target }));
  }

  return next;
}

export function applyFirsts(db: AppDatabase, items: TurnDiff['firsts']): AppDatabase {
  let next = db;
  for (const item of items ?? []) {
    const bond = bondFor(next, item.entityId);
    const what = cleanText(item.what, 120);
    if (!bond || !what) continue;
    const first = { what, when: next.state.inStoryDate, where: next.state.location };
    next = updateBond(next, bond.id, (b) => ({ ...b, firsts: [...(b.firsts ?? []), first].slice(-12) }));
  }
  return next;
}

export const MAX_LEARNED_PREFERENCES = 8;

export function applyPreferences(db: AppDatabase, items: TurnDiff['preferencesLearned']): AppDatabase {
  let next = db;
  for (const item of items ?? []) {
    const bond = bondFor(next, item.entityId);
    const text = cleanText(item.preference, 140);
    if (!bond || !text) continue;
    const line = item.aboutPlayer ? `knows you like ${text.replace(/^(that )?you like /i, '')}` : `you know they like ${text.replace(/^(that )?(they|he|she) likes? /i, '')}`;
    next = updateBond(next, bond.id, (b) => {
      const kept = (b.learnedPreferences ?? []).filter((old) => old.toLowerCase() !== line.toLowerCase());
      return { ...b, learnedPreferences: [...kept, line].slice(-MAX_LEARNED_PREFERENCES) };
    });
  }
  return next;
}

export function applyOutfits(db: AppDatabase, items: TurnDiff['outfits']): AppDatabase {
  let next = db;
  for (const item of items ?? []) {
    if (!item.entityId) continue;
    const outfit = cleanText(item.outfit, 200);
    const position = cleanText(item.position, 160);
    next = {
      ...next,
      entities: next.entities.map((entity) =>
        entity.id === item.entityId
          ? { ...entity, ...(outfit ? { currentLook: outfit, currentLookSeq: next.state.sceneSeq } : {}), ...(position ? { scenePosition: position } : {}) }
          : entity
      ),
    };
  }
  return next;
}

// ---------------------------------------------------------------------------
// Prompt text

const WEIGHT_WORD: Record<NonNullable<ContentTag['weight']>, string> = { love: 'loves', like: 'likes', okay: 'is fine with' };

function tagText(tag: ContentTag) {
  return tag.note ? `${tag.label} (${tag.note})` : tag.label;
}

/**
 * The INTIMACY block: a cached block after WHO YOU ARE. It changes only when
 * the player edits their content profile (invariant 10). Plain prose.
 */
export function formatIntimacyBlock(db: AppDatabase): string {
  if (!playerCanBeIntimate(db).ok) {
    return 'INTIMACY\n- The player\'s character is not a stated adult, so there is no romance or sexual content in this story, ever.';
  }
  const profile = db.content ?? defaultContentProfile();
  const pacing =
    profile.pacing === 'slow-burn'
      ? 'Slow burn: the player enjoys tension, looks and almost-moments; let attraction simmer before it boils over, unless both people clearly want it now.'
      : profile.pacing === 'fast'
        ? 'Fast: once both people want it, things move quickly.'
        : 'Natural: things move at the pace these people would, scene by scene.';
  const byWeight = (weight: NonNullable<ContentTag['weight']>) =>
    profile.interests.filter((tag) => (tag.weight ?? 'like') === weight).map(tagText);
  const interests = (['love', 'like', 'okay'] as const)
    .map((weight) => (byWeight(weight).length ? `the player ${WEIGHT_WORD[weight]} ${byWeight(weight).join(', ')}` : ''))
    .filter(Boolean);
  const hard = profile.limits.filter((tag) => tag.kind !== 'soft').map(tagText);
  const soft = profile.limits.filter((tag) => tag.kind === 'soft').map(tagText);

  return [
    'INTIMACY (how the player wants romance and sex in this story)',
    '- This is an adult story. When a scene between consenting adults becomes sexual, write it fully explicit and uncensored, with the same care for character, feeling and consequence as any other scene. Never write the player\'s actions, words, feelings or reactions.',
    `- Pacing: ${pacing}`,
    interests.length ? `- What the player enjoys (weave in when it fits the people and the moment; never force every one into every scene): ${interests.join('; ')}.` : '',
    soft.length ? `- Off-page only: ${soft.join(', ')} may happen, but only implied or skipped over, never described.` : '',
    hard.length ? `- Never write, mention or hint at, in any form: ${hard.join(', ')}.` : '',
    profile.narratorVoice ? `- Voice for these scenes: ${profile.narratorVoice}.` : '',
    '- People have their own desires and boundaries (their cards say so): they want things, refuse things, tease, set terms and change their minds. Respect what someone will not do.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** A short line on someone's heart and desires for their card. */
export function heartLine(entity: EntityRecord, withDesires: boolean): string {
  const profile = entity.intimacy;
  if (!profile) return '';
  const open =
    profile.interestedInPlayer === 'yes'
      ? 'drawn to you'
      : profile.interestedInPlayer === 'could-grow'
        ? 'could be open to you'
        : profile.interestedInPlayer === 'taken'
          ? `belongs elsewhere${profile.devotion ? ` (${profile.devotion})` : ''}`
          : 'not open to you';
  const parts = [
    `heart: ${open}`,
    profile.orientation ? `drawn to ${profile.orientation}` : '',
    withDesires && profile.style ? `style: ${profile.style}` : '',
    withDesires && profile.experience ? `experience: ${profile.experience}` : '',
    withDesires && profile.desires.length ? `likes: ${profile.desires.join(', ')}` : '',
    withDesires && profile.boundaries.length ? `won't: ${profile.boundaries.join(', ')}` : '',
  ].filter(Boolean);
  return parts.join('; ');
}

/** The steer chips and the OOC note, as one-turn lines for the narrator. */
export const STEER_LINES: Record<'slower' | 'more' | 'skip-ahead' | 'fade-to-black', string> = {
  slower: 'PLAYER\'S STEER: slow down. Stay in this moment, more detail and dialogue, nothing moves on yet.',
  more: 'PLAYER\'S STEER: more of this. Go further and deeper into what is happening now.',
  'skip-ahead': 'PLAYER\'S STEER: skip ahead. Close this beat in a line or two and move to what comes next.',
  'fade-to-black': 'PLAYER\'S STEER: fade to black. Cut away from anything intimate in this scene and pick up afterwards.',
};

export function formatOocNote(note: string | undefined): string {
  const text = cleanText(note, 400);
  return text ? `OUT-OF-CHARACTER NOTE FROM THE PLAYER (follow it for this reply only; it never enters the story and nobody in it hears it): ${text}` : '';
}

/** Sent when a reply crossed a hard limit and is being written again. */
export const CORRECTIVE_NOTE =
  'The last version of this reply broke a hard rule (a hard limit of the player, or a sexual scene with someone under 18, of no stated age or described as a child). Write it again without it.';

/** What replaces a reply that crossed a limit twice. */
export const FADE_TO_BLACK_LINE = 'The moment passes, and the scene fades. Later, the night has moved on.';

/** Text for any notification the app shows outside the story: never story content. */
export function notificationText(kind: 'reply' | 'image' | 'letter' | 'generic'): string {
  return kind === 'reply' ? 'Your story continued.' : kind === 'image' ? 'A picture is ready.' : kind === 'letter' ? 'Something new is waiting.' : 'frbddn has an update.';
}

/** What the post-check does with a reply: keep it, write it again once, or fade it to black. */
export function postCheckDecision(diff: Pick<TurnDiff, 'limitCrossed' | 'ageRuleCrossed'> | null, retry: number): 'keep' | 'rewrite' | 'fade' {
  if (!diff || (!diff.limitCrossed && !diff.ageRuleCrossed)) return 'keep';
  return retry < 1 ? 'rewrite' : 'fade';
}
