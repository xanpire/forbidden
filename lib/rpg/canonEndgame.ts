// Canon-bound hearts: winnable, but canon wins in the end.
//
// Some characters can truly fall for Kan (Temari, Ino, Karui), yet canon pairs
// them with someone else. As that time nears, the narrator is told to bring
// the romance to a natural end; from the canon date on, the bond is settled
// here: a partner becomes an ex, an open romance cools to closeness, and the
// story is reminded she is with her canon partner. If the canon partner has
// died, canon cannot happen and nothing is forced.

import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { loreProfileFor, type CharacterLoreProfile, type RelationshipStage } from './romance';
import type { AppDatabase, BondRecord, CalendarDate, EntityRecord } from './types';

/** How long before the canon date the narrator starts steering. */
export const ENDGAME_LEAD_MONTHS = 18;

const ENDED = 'Ended:';

export type EndgamePhase = 'open' | 'nearing' | 'settled';

function monthIndex(date: { year: number; month: number }) {
  return date.year * 12 + (date.month - 1);
}

function partnerAlive(db: AppDatabase, partner: string) {
  const entity = resolveEntity(db, partner);

  return !entity || !isDeceased(entity);
}

/** Where a canon-bound heart stands on a date; null if she has no canon endgame. */
export function endgamePhase(
  profile: CharacterLoreProfile | null,
  date: CalendarDate
): EndgamePhase | null {
  const endgame = profile?.canonEndgame;

  if (!endgame) {
    return null;
  }

  const left = monthIndex(endgame.from) - monthIndex(date);

  if (left <= 0) {
    return 'settled';
  }

  return left <= ENDGAME_LEAD_MONTHS ? 'nearing' : 'open';
}

/** The line the narrator sees next to her heart, for the current date. */
export function endgameNote(db: AppDatabase, name: string): string {
  const profile = loreProfileFor(name);
  const phase = endgamePhase(profile, db.state.inStoryDate);
  const partner = profile?.canonEndgame?.partner;

  if (!phase || !partner || !partnerAlive(db, partner)) {
    return '';
  }

  if (phase === 'open') {
    return `; canon-bound: may love Kan now, but ends up with ${partner} from year ${profile!.canonEndgame!.from.year}`;
  }

  if (phase === 'nearing') {
    return `; canon-bound, time nearly up: if she is with Kan, let it end naturally soon; her heart is turning to ${partner}`;
  }

  return `; with ${partner} now; Kan is at most her ex, and she will not go back`;
}

function entityFor(db: AppDatabase, entityId: string): EntityRecord | undefined {
  return db.entities.find((entity) => entity.id === entityId);
}

/**
 * Settles every canon-bound bond whose canon date has passed. Runs after each
 * turn and each canon advance, so a time skip lands the same way.
 */
export function applyCanonEndgames(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  let changed = false;

  const bonds = db.bonds.map((bond): BondRecord => {
    const entity = entityFor(db, bond.entityId);
    const name = entity?.name ?? bond.characterName;
    const profile = loreProfileFor(name);

    if (endgamePhase(profile, now) !== 'settled' || !profile?.canonEndgame) {
      return bond;
    }

    if (entity && isDeceased(entity)) {
      return bond;
    }

    const { partner, from } = profile.canonEndgame;

    if (!partnerAlive(db, partner)) {
      return bond;
    }

    // Once with Kan, always his ex; an open romance that never became one
    // cools to closeness. Friendship and everything else stay as they are.
    const wasWithKan = bond.relationship === 'partner' || bond.romanceNote?.startsWith(ENDED) === true;
    const relationship: RelationshipStage | undefined =
      bond.relationship === 'partner' || bond.relationship === 'romantic interest'
        ? wasWithKan
          ? 'ex'
          : 'close'
        : bond.relationship;
    const attraction = bond.attraction === 'strong' ? 'warm' : bond.attraction;

    if (relationship === bond.relationship && attraction === bond.attraction) {
      return bond;
    }

    changed = true;

    return {
      ...bond,
      relationship,
      attraction,
      romanceNote:
        relationship === 'ex'
          ? `${ENDED} by ${from.year} she was with ${partner}, as canon has it.`
          : bond.romanceNote,
      updatedInStoryDate: now,
    };
  });

  return changed ? { ...db, bonds } : db;
}
