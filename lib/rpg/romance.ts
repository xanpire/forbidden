// Relationship labels, attraction, and who could ever fall for the player.
// Nothing here hard-codes an orientation: who someone is drawn to comes from
// the entity (written by the player, or reported by the tracker).

/**
 * The fixed set of relationship labels. "partner" means a work or mission
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

export type RomanceAccessibility = 'winnable' | 'lore-locked' | 'not-applicable';

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

/** The romantic stages, for code that cares whether a bond is a romance. */
export const ROMANTIC_STAGES = new Set<RelationshipStage>(['romantic interest', 'lover']);

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
 * Whether the player could win someone's heart, from who they are drawn to
 * and the player's own gender. Undefined when the story hasn't said.
 */
export function romanceFor(
  attractedTo: string | undefined,
  playerGender: string | undefined
): RomanceAccessibility | undefined {
  const drawn = attractedTo?.trim().toLowerCase();

  if (!drawn || drawn === 'unknown') return undefined;
  if (drawn === 'none') return 'not-applicable';
  if (drawn === 'both' || drawn === 'anyone') return 'winnable';

  const player = playerGender?.trim().toLowerCase() ?? '';
  const playerIsMan = /^(m|male|man)$/.test(player);
  const playerIsWoman = /^(f|female|woman)$/.test(player);

  if (!playerIsMan && !playerIsWoman) return undefined;
  if (drawn === 'men') return playerIsMan ? 'winnable' : 'not-applicable';
  if (drawn === 'women') return playerIsWoman ? 'winnable' : 'not-applicable';
  return undefined;
}

// Prompt rules: injected into the narration system prompt. Kept compact to
// protect the token budget.
export const ROMANCE_RULES = `ROMANCE
- Romance is earned over scenes, and can fail. People have loves and lives of their own. Bonds show a stage, an attraction, and whether their heart could open to the player.
- Only someone whose heart is open to the player can become a romance; anyone not drawn to the player stays a friend at most, whatever their bond, and friendship, loyalty and closeness still grow.
- Someone whose heart belongs elsewhere (a devoted partner, a vow, a grief) does not turn to the player unless the story gives them a real reason over time; friendship can still grow.
- Romance and intimacy only between adults: everyone involved is 18 or older in-story. Anyone under 18, or whose age is not stated, is never romantic or sexual, in any scene, flashback or framing.
- A rejection holds by default: the refusal stands, and the player pushing again only hardens it. Over a long stretch of in-story time someone can change their mind as they truly come to know the player; the change comes from their side, needs a clear reason in the story, and moves in steps (rejected → friendly/close → romantic interest).`;
