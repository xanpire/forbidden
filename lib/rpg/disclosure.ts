// What you can see of someone on their profile.
//
// The cast seed (canonCast.ts) describes people as canon knows them, and the
// narrator gets all of it: Sasori really sits inside Hiruko, Yagura is under
// a genjutsu, Minato is Naruto's father. The bond screens are the player's view, so
// until the story reveals it (the milestone in `revealedBy` is witnessed,
// heard of or engaged), a profile shows the version the player could know instead.
//
// Only seed text is covered: once the story itself rewrites a field (the
// state tracker's character updates, from what was on the page), that is
// what the player saw, and it shows as it is.

import { CANON_CAST } from './canonCast';
import { milestoneKnown } from './entities';
import type { AppDatabase, EntityRecord } from './types';

type ProfileField = 'role' | 'personality' | 'speechStyle' | 'appearance';

type Disclosure = Partial<Record<ProfileField, string>> & {
  /** The milestone that lets the player know the truth; null: only the story itself can tell them. */
  revealedBy: string | null;
};

const DISCLOSURES: Record<string, Disclosure> = {
  Tobi: {
    role: 'Akatsuki · the masked man',
    personality: 'Impossible to read; you never know what he really wants.',
    speechStyle: 'Low and controlled.',
    revealedBy: 'obito-unmasked',
  },
  Sasori: {
    appearance: 'A hunched figure in the Akatsuki cloak, a cloth mask over the lower face and a segmented scorpion tail. You have never seen what is inside.',
    revealedBy: 'sasori-falls',
  },
  'Kabuto Yakushi': {
    role: 'Leaf medical ninja',
    personality: 'Polite, helpful and modest; hard to read.',
    revealedBy: 'kabuto-embedded',
  },
  Yagura: {
    personality: 'Cold and merciless; the Mist bled under him.',
    revealedBy: 'yagura-puppet',
  },
  'Zabuza Momochi': {
    personality: 'Brutal and cold.',
    revealedBy: 'team-kakashi-bridge',
  },
  'Minato Namikaze': {
    role: 'Fourth Hokage',
    revealedBy: 'pain-assault',
  },
  'Kushina Uzumaki': {
    role: 'Leaf kunoichi · the Fourth Hokage’s wife',
    revealedBy: 'pain-assault',
  },
  'Nine-Tails': {
    role: 'Tailed beast · sealed in Naruto',
    personality: 'Full of hatred and contempt for humans.',
    revealedBy: 'kurama-mastered',
  },
  'Hizashi Hyuga': {
    personality: 'Resented the main house; died for the village after the Cloud incident.',
    revealedBy: null,
  },
  'Izuna Uchiha': {
    personality: 'Devoted to his brother, deeply distrustful of the Senju.',
    revealedBy: 'obito-unmasked',
  },
  Yashamaru: {
    personality: 'Gentle and kind; a medic who looked after his nephew.',
    revealedBy: null,
  },
  Pakura: {
    personality: 'Proud, skilled and generous as a teacher.',
    revealedBy: 'war-begins',
  },
  'Dosu Kinuta': {
    personality: 'Watchful and cold.',
    revealedBy: 'dosu-falls',
  },
  Sakon: {
    appearance: 'Grey hair over one eye, dark lipstick.',
    revealedBy: 'sound-four-fall',
  },
  Ukon: {
    appearance: 'Identical to Sakon.',
    revealedBy: 'sound-four-fall',
  },
};

// Built on first use: entities.ts → characterPortrait.ts → here is an import cycle.
let seedByName: Map<string, (typeof CANON_CAST)[number]> | null = null;

function seedOf(name: string) {
  seedByName ??= new Map(CANON_CAST.map((entry) => [entry.name, entry]));
  return seedByName.get(name);
}

/** Whether the story has let the player know the truth behind this person's profile. */
function revealed(db: AppDatabase, disclosure: Disclosure) {
  return disclosure.revealedBy !== null && milestoneKnown(db, disclosure.revealedBy);
}

/** One profile field as the player can know it. */
export function shownField(db: AppDatabase, entity: EntityRecord, field: ProfileField): string | undefined {
  const value = entity[field] ?? undefined;
  const disclosure = DISCLOSURES[entity.name];
  const seeded = seedOf(entity.name)?.[field];

  if (!disclosure?.[field] || !value || value !== seeded || revealed(db, disclosure)) {
    return value;
  }

  return disclosure[field];
}

/** The four profile fields as the player can know them. */
export function shownProfile(db: AppDatabase, entity: EntityRecord) {
  return {
    role: shownField(db, entity, 'role'),
    personality: shownField(db, entity, 'personality'),
    speechStyle: shownField(db, entity, 'speechStyle'),
    appearance: shownField(db, entity, 'appearance'),
  };
}

// ---------------------------------------------------------------------------
// Feelings and grudges

/** How someone seems toward the player, in words: what he can read off them, not a number. */
export function howTheySeem(affinity: number): string {
  if (affinity <= -7) return 'hostile';
  if (affinity <= -4) return 'cold';
  if (affinity <= -1) return 'guarded';
  if (affinity === 0) return 'hard to read';
  if (affinity <= 3) return 'friendly';
  if (affinity <= 6) return 'warm';
  if (affinity <= 8) return 'close';
  return 'devoted';
}

/** The player knows of a grudge once they have acted on it. Until then it stews unseen. */
export function grudgeKnown(grudge: { strikes: number } | undefined | null): boolean {
  return Boolean(grudge && grudge.strikes > 0);
}
