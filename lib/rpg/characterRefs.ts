import { slug } from './id';
import type { AppDatabase, EntityRecord } from './types';

/**
 * Short, readable IDs for characters in the state tracker's prompt
 * ("itachi-uchiha", "kisame-hoshigaki", "kan").
 *
 * The tracker refers to everyone by these IDs, so "Kisame", "Hoshigaki" and
 * "the shark man" all land on one person. IDs come from the current name, so
 * they stay the same from turn to turn (and keep the prompt cacheable); two
 * people with the same name get "-2", "-3" in save order.
 */
export function characterRefs(db: AppDatabase): Map<string, EntityRecord> {
  const refs = new Map<string, EntityRecord>();

  for (const entity of db.entities) {
    if (entity.type !== 'character') {
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

// Names that are also everyday words only count when capitalized ("Pain",
// not "the pain in your side").
const COMMON_WORD_NAMES = new Set(['pain']);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when the text names this person as a whole word: "Lee" is not found
 * in "asleep", "Tobi" is not found in "Sarutobi".
 */
export function mentionsName(text: string, name: string) {
  const trimmed = name.trim();

  if (trimmed.length < 3 || !text) {
    return false;
  }

  const flags = COMMON_WORD_NAMES.has(trimmed.toLowerCase()) ? 'u' : 'iu';

  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}])`, flags).test(text);
}

export function mentionsEntity(text: string, entity: Pick<EntityRecord, 'name' | 'aliases'>) {
  return [entity.name, ...entity.aliases].some((name) => mentionsName(text, name));
}
