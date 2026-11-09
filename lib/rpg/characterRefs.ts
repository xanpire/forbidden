import { slug } from './id';
import { isPlayerEntity } from './player';
import type { AppDatabase, EntityRecord } from './types';

/**
 * Short, readable IDs for characters in the state tracker's prompt
 * ("mara-vell", "old-tom"). The player is always "player".
 *
 * The tracker refers to everyone by these IDs, so "Mara", "Voss" and
 * "the shark man" all land on one person. IDs come from the current name, so
 * they stay the same from turn to turn (and keep the prompt cacheable); two
 * people with the same name get "-2", "-3" in save order.
 */
/** The player's ID in the tracker prompt. */
export const PLAYER_REF = 'player';

export function characterRefs(db: AppDatabase): Map<string, EntityRecord> {
  const refs = new Map<string, EntityRecord>();
  const player = db.entities.find((entity) => entity.type === 'character' && isPlayerEntity(entity));

  if (player) {
    refs.set(PLAYER_REF, player);
  }

  for (const entity of db.entities) {
    if (entity.type !== 'character' || entity === player) {
      continue;
    }

    const base = slug(entity.name) || 'character';
    let ref = base;
    let counter = 2;

    while (refs.has(ref)) {
      ref = `${base}-${counter}`;
      counter += 1;
    }

    refs.set(ref, entity);
  }

  return refs;
}

/** The reverse lookup: entity id to its prompt ID. */
export function refByEntityId(db: AppDatabase): Map<string, string> {
  return new Map([...characterRefs(db)].map(([ref, entity]) => [entity.id, ref]));
}

// Names that are also everyday words only count when capitalized ("Hope",
// not "the hope in your voice").
const COMMON_WORD_NAMES = new Set(['hope', 'grace', 'faith', 'kin', 'will', 'rose', 'mark', 'jack']);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when the text names this person as a whole word: "Lee" is not found
 * in "asleep", "Ana" is not found in "Banana".
 */
export function mentionsName(text: string, name: string) {
  const trimmed = name.trim();

  if (trimmed.length < 2 || !text) {
    return false;
  }

  // Two-letter names (Ao, Fū) only count when written as a name, capitalized.
  const caseSensitive = trimmed.length < 3 || COMMON_WORD_NAMES.has(trimmed.toLowerCase());
  const flags = caseSensitive ? 'u' : 'iu';

  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}])`, flags).test(text);
}

export function mentionsEntity(text: string, entity: Pick<EntityRecord, 'name' | 'aliases'>) {
  return [entity.name, ...entity.aliases].some((name) => mentionsName(text, name));
}
