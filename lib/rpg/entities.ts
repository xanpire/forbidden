// People and places: name/identity resolution, the state tracker's character
// IDs, entity updates, presence, and duplicate merging.

import { dateSortValue } from './calendar';
import { characterRefs } from './characterRefs';
import { makeId } from './id';
import { uniqueList } from './util';
import type { AppDatabase, EntityRecord, TurnDiff } from './types';

type CharacterRef = { entityId?: string; name: string };

/**
 * Turns the state tracker's character IDs back into people. Each reference is
 * a KNOWN CHARACTERS ID ("kisame-hoshigaki"), the exact name of someone added
 * this turn under new_characters, or — when the model slipped — a name or
 * alias of someone already known. Anything else is dropped rather than
 * becoming a new person: only new_characters with is_new: true can add one.
 */
export function resolveCharacterRefs(db: AppDatabase, diff: TurnDiff): TurnDiff {
  const refs = characterRefs(db);
  const newNames = new Map(
    (diff.entities ?? [])
      .filter((entity) => entity.isNew && entity.name.trim())
      .map((entity) => [entity.name.trim().toLowerCase(), entity.name.trim()])
  );

  const resolve = (raw: string | undefined): CharacterRef | null => {
    const value = raw?.trim();

    if (!value) {
      return null;
    }

    const lower = value.toLowerCase();
    const byRef = refs.get(lower);

    if (byRef) {
      return { entityId: byRef.id, name: byRef.name };
    }

    const fresh = newNames.get(lower);

    if (fresh) {
      return { name: fresh };
    }

    const byName = resolveEntity(db, value) ?? (value.includes('-') ? resolveEntity(db, value.replace(/-/g, ' ')) : null);

    return byName ? { entityId: byName.id, name: byName.name } : null;
  };

  /** For free-text fields (fact subjects, jutsu users): an ID becomes a name, anything else stays. */
  const nameOf = (raw: string | undefined) => (raw ? (resolve(raw)?.name ?? raw) : raw);
  const people = (names: string[]) =>
    uniqueList(names.map((name) => resolve(name)?.name).filter((name): name is string => Boolean(name)));

  const next: TurnDiff = { ...diff };

  if (diff.entities) {
    next.entities = diff.entities.flatMap((entity) => {
      if (entity.isNew) {
        // "New" but written as a known ID: it is an update, not a second person.
        const known = refs.get(entity.name.trim().toLowerCase());

        return [known ? { ...entity, entityId: known.id, name: known.name, isNew: false } : entity];
      }

      const ref = resolve(entity.entityId ?? entity.name);

      return ref?.entityId ? [{ ...entity, entityId: ref.entityId, name: ref.name, isNew: false }] : [];
    });
  }

  if (diff.bonds) {
    next.bonds = diff.bonds.flatMap((bond) => {
      const ref = resolve(bond.entityId ?? bond.character);

      return ref ? [{ ...bond, character: ref.name, entityId: ref.entityId }] : [];
    });
  }

  if (diff.state?.sceneCast) {
    next.state = { ...diff.state, sceneCast: people(diff.state.sceneCast) };
  }

  if (diff.scene?.entities) {
    next.scene = { ...diff.scene, entities: people(diff.scene.entities) };
  }

  if (diff.facts) {
    next.facts = diff.facts.map((fact) => ({
      ...fact,
      subject: nameOf(fact.subject),
      whoKnows: fact.whoKnows ? uniqueList(fact.whoKnows.map((name) => nameOf(name) ?? name)) : fact.whoKnows,
    }));
  }

  if (diff.jutsuUsed) {
    next.jutsuUsed = diff.jutsuUsed.map((jutsu) => ({ ...jutsu, user: nameOf(jutsu.user) ?? jutsu.user }));
  }

  if (diff.threads) {
    next.threads = diff.threads.map((thread) => ({
      ...thread,
      participants: thread.participants
        ? uniqueList(thread.participants.map((name) => nameOf(name) ?? name))
        : thread.participants,
    }));
  }

  if (diff.deaths) {
    next.deaths = diff.deaths.flatMap((death) => {
      const ref = resolve(death.entityId ?? death.name);

      return ref ? [{ ...death, name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  if (diff.revived) {
    next.revived = diff.revived.flatMap((person) => {
      const ref = resolve(person.entityId ?? person.name);

      return ref?.entityId ? [{ name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  // A new person can join this turn: their name passes through and is
  // resolved once they exist (applyCompanionChanges).
  const companions = (list: { entityId?: string; name: string; reason?: string }[]) =>
    list.flatMap((person) => {
      const ref = resolve(person.entityId ?? person.name);

      return ref ? [{ ...person, name: ref.name, entityId: ref.entityId }] : [];
    });

  if (diff.companionsJoined) {
    next.companionsJoined = companions(diff.companionsJoined);
  }

  if (diff.companionsLeft) {
    next.companionsLeft = companions(diff.companionsLeft);
  }

  if (diff.newsRelayed) {
    next.newsRelayed = diff.newsRelayed.map((news) => ({ ...news, from: nameOf(news.from) }));
  }

  // Letters only go to and come from people the save knows.
  if (diff.lettersSent) {
    next.lettersSent = diff.lettersSent.flatMap((letter) => {
      const ref = resolve(letter.entityId ?? letter.name);

      return ref?.entityId ? [{ ...letter, name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  if (diff.lettersReceived) {
    next.lettersReceived = diff.lettersReceived.flatMap((letter) => {
      const ref = resolve(letter.entityId ?? letter.name);

      return ref?.entityId ? [{ name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  return next;
}

// Shared-identity clusters (Naruto lore): characters known by many names, or
// bodies controlled by one mind. Members of the same group are ONE character:
// - The masked man is known as Tobi, Obito, "fake Madara".
// - The REAL Madara Uchiha is a separate person who appears later.
// - Pain is the Six Paths of Pain — six bodies (Deva, Asura, Animal, Human,
//   Preta, Naraka) controlled by Nagato Uzumaki, who is Pain's true identity.
//   Nagato knows everything every Pain body has seen or heard.
// - Zetsu is one being split into Black Zetsu and White Zetsu halves.
const FAKE_HINTS = ['tobi', 'obito', 'masked man', 'fake madara'];

const REAL_MADARA_HINTS = ['madara'];

const PAIN_HINTS = [
  'pain',
  'nagato',
  'six paths of pain',
  'deva path',
  'asura path',
  'animal path',
  'human path',
  'preta path',
  'naraka path',
];

const ZETSU_HINTS = ['zetsu', 'black zetsu', 'white zetsu'];

const PERSON_HINTS = [...FAKE_HINTS, ...REAL_MADARA_HINTS, ...PAIN_HINTS, ...ZETSU_HINTS];

type IdentityGroup = 'masked-man' | 'real-madara' | 'pain' | 'zetsu';

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function containsHint(name: string, hint: string) {
  // "pain" is a common English word; only treat it as a name hint in short
  // proper names ("Pain", "Nagato's Pain", "Six Paths of Pain" via its own hint).
  if (hint === 'pain') {
    return countWords(name) <= 3 && containsWord(name, 'pain');
  }

  return containsWord(name, hint);
}

export function entityGroup(hints: Set<string>): IdentityGroup | null {
  if ([...hints].some((hint) => FAKE_HINTS.includes(hint))) {
    return 'masked-man';
  }

  if (hints.has('madara')) {
    return 'real-madara';
  }

  if ([...hints].some((hint) => PAIN_HINTS.includes(hint))) {
    return 'pain';
  }

  if ([...hints].some((hint) => ZETSU_HINTS.includes(hint))) {
    return 'zetsu';
  }

  return null;
}

export function entityHints(entity: EntityRecord): Set<string> {
  const names = [entity.name.toLowerCase(), ...entity.aliases.map((alias) => alias.toLowerCase())];

  return new Set(
    [...names, ...names.flatMap((name) => nameCandidates(name))].flatMap((name) =>
      PERSON_HINTS.filter((hint) => containsHint(name, hint))
    )
  );
}

function nameHints(rawName: string): Set<string> {
  const names = [rawName.toLowerCase(), ...nameCandidates(rawName).map((candidate) => candidate.toLowerCase())];

  return new Set(
    PERSON_HINTS.filter((hint) => names.some((name) => containsHint(name, hint)))
  );
}

function entityIsFake(entity: EntityRecord): boolean {
  return entityGroup(entityHints(entity)) === 'masked-man';
}

// Bare "Madara" refers to the masked man, who claims that name. Qualified
// real-Madara names ("Madara Uchiha", "the real Madara") refer to the real
// Madara, who appears much later in the story.
function isBareMadara(rawName: string) {
  return normalizeName(rawName).toLowerCase() === 'madara';
}

function findFakeEntity(db: AppDatabase): EntityRecord | null {
  return findEntityByGroup(db, 'masked-man');
}

function findEntityByGroup(db: AppDatabase, group: IdentityGroup): EntityRecord | null {
  return (
    db.entities.find(
      (entity) => entity.type === 'character' && entityGroup(entityHints(entity)) === group
    ) ?? null
  );
}

function findRealMadara(db: AppDatabase): EntityRecord | null {
  return findEntityByGroup(db, 'real-madara');
}

export function mergeDuplicateEntities(db: AppDatabase): AppDatabase {
  let next = db;

  for (let i = 0; i < next.entities.length; i += 1) {
    const primary = next.entities[i];

    if (primary.type !== 'character') {
      continue;
    }

    const primaryHints = entityHints(primary);

    if (primaryHints.size === 0) {
      continue;
    }

    for (let j = next.entities.length - 1; j > i; j -= 1) {
      const other = next.entities[j];

      if (other.type !== 'character') {
        continue;
      }

      const otherHints = entityHints(other);

      if (otherHints.size === 0) {
        continue;
      }

      // Merge only when both entities belong to the same identity group
      // (duplicates of the masked man, of Pain, of Zetsu, or of the real
      // Madara). Members of different groups are different people.
      const primaryGroup = entityGroup(primaryHints);
      const otherGroup = entityGroup(otherHints);

      if (!primaryGroup || primaryGroup !== otherGroup) {
        continue;
      }

      const keep = i < j ? primary : other;
      const drop = keep === primary ? other : primary;

      next = mergeEntityPair(next, keep.id, drop.id);
    }
  }

  return next;
}

function known(value: string | undefined) {
  return value && value !== 'Unknown' ? value : undefined;
}

/**
 * Folds one character into another: the dropped person's names become
 * aliases, missing details are filled in, and every bond, fact, memory link,
 * thread, jutsu record and scene reference moves to the kept person. Used by
 * the automatic identity merge (Tobi / masked man, Pain / Nagato) and by
 * "Merge with…" on the bond screen.
 */
export function mergeEntityPair(db: AppDatabase, keepId: string, dropId: string): AppDatabase {
  const keep = db.entities.find((entity) => entity.id === keepId);
  const drop = db.entities.find((entity) => entity.id === dropId);

  // You are never folded into someone else.
  if (!keep || !drop || keep.id === drop.id || drop.name.toLowerCase() === 'kan') {
    return db;
  }

  const aliases = [...keep.aliases, drop.name, ...drop.aliases]
    .filter(
      (alias, index, list) =>
        alias.trim().length > 0 &&
        alias.toLowerCase() !== keep.name.toLowerCase() &&
        list.findIndex((item) => item.toLowerCase() === alias.toLowerCase()) === index
    )
    .slice(0, 10);

  const lastSeen =
    keep.lastSeen && drop.lastSeen
      ? dateSortValue(keep.lastSeen) >= dateSortValue(drop.lastSeen)
        ? keep.lastSeen
        : drop.lastSeen
      : (keep.lastSeen ?? drop.lastSeen);

  const merged: EntityRecord = {
    ...drop,
    ...keep,
    aliases,
    age: keep.age ?? drop.age,
    birthday: keep.birthday ?? drop.birthday,
    birthYear: keep.birthYear ?? drop.birthYear,
    role: known(keep.role) ?? drop.role,
    personality: known(keep.personality) ?? drop.personality,
    speechStyle: known(keep.speechStyle) ?? drop.speechStyle,
    status:
      keep.status && keep.status !== 'Not yet met' && keep.status !== 'Newly met'
        ? keep.status
        : (drop.status ?? keep.status),
    notes: [keep.notes, drop.notes].filter(Boolean).join(' ').trim() || keep.notes,
    mood: known(keep.mood) ?? drop.mood,
    appearance: known(keep.appearance) ?? drop.appearance,
    lastSeen,
    lastSeenAt: lastSeen && lastSeen === drop.lastSeen ? (drop.lastSeenAt ?? keep.lastSeenAt) : (keep.lastSeenAt ?? drop.lastSeenAt),
    met: keep.met === false && drop.met === false ? false : undefined,
    tags: uniqueList([...keep.tags, ...drop.tags]),
  };

  if (merged.met === undefined) {
    delete merged.met;
  }

  const entities = db.entities
    .filter((entity) => entity.id !== drop.id)
    .map((entity) => (entity.id === keep.id ? merged : entity));

  // One bond survives: the more recently updated one, with gaps filled from the other.
  const keepBond = db.bonds.find((bond) => bond.entityId === keep.id);
  const dropBond = db.bonds.find((bond) => bond.entityId === drop.id);
  let bonds = db.bonds.filter((bond) => bond.entityId !== drop.id);

  if (dropBond && !keepBond) {
    bonds = [...bonds, { ...dropBond, entityId: keep.id, characterName: merged.name }];
  } else if (dropBond && keepBond) {
    const newer =
      dateSortValue(dropBond.updatedInStoryDate) > dateSortValue(keepBond.updatedInStoryDate)
        ? dropBond
        : keepBond;
    const older = newer === keepBond ? dropBond : keepBond;

    bonds = bonds.map((bond) =>
      bond.id === keepBond.id
        ? {
            ...older,
            ...newer,
            id: keepBond.id,
            entityId: keep.id,
            characterName: merged.name,
            note: newer.note || older.note,
            romanceNote: newer.romanceNote || older.romanceNote,
            isMajor: keepBond.isMajor || dropBond.isMajor,
            lastKeyEventId: newer.lastKeyEventId ?? older.lastKeyEventId,
          }
        : bond
    );
  } else if (keepBond) {
    bonds = bonds.map((bond) =>
      bond.id === keepBond.id ? { ...bond, characterName: merged.name } : bond
    );
  }

  const dropNames = new Set([drop.name, ...drop.aliases].map((name) => name.toLowerCase()));
  const rename = (name: string) => (dropNames.has(name.trim().toLowerCase()) ? merged.name : name);
  const renameAll = (names: string[]) => uniqueList(names.map(rename));

  const links = db.eventEntities.map((link) =>
    link.entityId === drop.id ? { ...link, entityId: keep.id } : link
  );

  return {
    ...db,
    entities,
    bonds,
    facts: db.facts.map((fact) => ({
      ...fact,
      subjectEntityId: fact.subjectEntityId === drop.id ? keep.id : fact.subjectEntityId,
      whoKnows: renameAll(fact.whoKnows),
    })),
    eventEntities: links.filter(
      (link, index) =>
        links.findIndex(
          (other) => other.eventId === link.eventId && other.entityId === link.entityId
        ) === index
    ),
    threads: db.threads.map((thread) => ({
      ...thread,
      participants: renameAll(thread.participants),
    })),
    jutsuRecords: db.jutsuRecords.map((record) => ({ ...record, user: rename(record.user) })),
    state: {
      ...db.state,
      sceneCast: Array.isArray(db.state.sceneCast) ? renameAll(db.state.sceneCast) : db.state.sceneCast,
    },
  };
}

export function recordPresence(db: AppDatabase, names: string[]): AppDatabase {
  const matched = new Set(names.map((name) => resolveEntity(db, name)?.id).filter(Boolean) as string[]);

  if (matched.size === 0) {
    return db;
  }

  return {
    ...db,
    entities: db.entities.map((entity) =>
      entity.type === 'character' && matched.has(entity.id) && !entity.deceased && entity.status !== 'Deceased'
        ? { ...entity, lastSeen: db.state.inStoryDate, lastSeenAt: db.state.location || entity.lastSeenAt, met: true }
        : entity
    ),
  };
}

type EntityDiff = NonNullable<TurnDiff['entities']>[number];

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsWord(haystack: string, needle: string) {
  if (needle.length < 3) {
    return false;
  }

  return new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(haystack);
}

function normalizeName(rawName: string) {
  return rawName.replace(/\s*\([^)]*\)\s*/g, '').trim();
}

function nameCandidates(rawName: string) {
  const name = rawName.trim();
  const core = normalizeName(name);
  const parentheticals = [...name.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim());

  return [...new Set([name, core, ...parentheticals])].filter(
    (candidate) => candidate.length > 0
  );
}

export function resolveEntity(db: AppDatabase, rawName: string): EntityRecord | null {
  if (!rawName || typeof rawName !== 'string') {
    return null;
  }

  const candidates = nameCandidates(rawName).map((candidate) => candidate.toLowerCase());

  if (candidates.length === 0) {
    return null;
  }

  const hints = nameHints(rawName);
  const isRealMadara = hints.has('madara') && ![...hints].some((hint) => FAKE_HINTS.includes(hint));
  const realMadaraExists = isRealMadara ? findEntityByGroup(db, 'real-madara') !== null : false;

  for (const entity of db.entities) {
    if (entity.type !== 'character') {
      continue;
    }

    // Once the real Madara exists, "Madara" (and any real-Madara name) refers
    // to him — never to the masked man, even via the masked man's aliases.
    if (isRealMadara && realMadaraExists && entityIsFake(entity)) {
      continue;
    }

    const names = [entity.name.toLowerCase(), ...entity.aliases.map((alias) => alias.toLowerCase())];

    if (candidates.some((candidate) => names.includes(candidate))) {
      return entity;
    }
  }

  for (const entity of db.entities) {
    if (entity.type !== 'character') {
      continue;
    }

    // A real-Madara reference must never fall back to the masked man entity,
    // even when the real Madara has not been registered yet.
    if (isRealMadara && entityIsFake(entity)) {
      continue;
    }

    const names = [entity.name.toLowerCase(), ...entity.aliases.map((alias) => alias.toLowerCase())];

    if (
      candidates.some((candidate) =>
        names.some((name) => containsWord(name, candidate) || containsWord(candidate, name))
      )
    ) {
      return entity;
    }
  }

  // Group fallback: shared-identity names resolve to their one entity even
  // without a direct name match. "Nagato" resolves to the Pain entity, "Tobi"
  // to the masked man, "Black Zetsu" to the Zetsu entity. Once the real
  // Madara exists, an unqualified "Madara" refers to him; before that, it
  // refers to the masked man (who claims that name).
  const group = entityGroup(hints);

  if (group === 'real-madara') {
    const realMadara = findEntityByGroup(db, 'real-madara');

    if (realMadara) {
      return realMadara;
    }

    return isBareMadara(rawName) ? findEntityByGroup(db, 'masked-man') : null;
  }

  if (group) {
    return findEntityByGroup(db, group);
  }

  return null;
}

export function applyEntityDiff(db: AppDatabase, entity: EntityDiff): AppDatabase {
  if (!entity?.name || typeof entity.name !== 'string') {
    return db;
  }

  const name = entity.name.trim();
  const hints = nameHints(name);
  const group = entityGroup(hints);

  const byId = entity.entityId
    ? (db.entities.find((item) => item.id === entity.entityId) ?? null)
    : null;
  let existing = byId ?? resolveEntity(db, name);

  // The real Madara must never be merged into the masked man entity.
  // (An exact ID from the state tracker is trusted as-is.)
  if (!byId && existing && group === 'real-madara' && entityIsFake(existing)) {
    existing = findRealMadara(db);
  }

  // Shared-identity aliases always resolve to their one entity, never a new
  // character: masked-man names (Tobi, Obito, ...), Pain/Nagato and the six
  // paths, and Zetsu halves.
  if (!byId && !existing && group) {
    existing = findEntityByGroup(db, group);

    // Bare "Madara" with no real Madara in the story yet refers to the masked
    // man, who claims that name. Qualified names ("Madara Uchiha") create the
    // real Madara as a new character.
    if (!existing && group === 'real-madara' && isBareMadara(name)) {
      existing = findFakeEntity(db);
    }
  }

  // Only someone the tracker flagged as new may be created; an update for a
  // person who cannot be found is dropped instead of becoming a duplicate.
  if (!existing && entity.isNew === false) {
    return db;
  }

  if (!existing) {
    const newEntity = {
      id: makeId('entity'),
      name,
      type: 'character' as const,
      aliases: [],
      birthYear:
        entity.age !== undefined
          ? db.state.inStoryDate.year - entity.age
          : undefined,
      age: entity.age,
      role: entity.role?.trim() || 'Unknown',
      personality: entity.personality?.trim() || 'Unknown',
      speechStyle: entity.speechStyle?.trim() || 'Unknown',
      status: 'Newly met',
      notes: '',
      mood: entity.mood?.trim() || 'Unknown',
      appearance: entity.appearance?.trim() || 'Unknown',
      tags: [],
    };

    return {
      ...db,
      entities: [...db.entities, newEntity],
    };
  }

  const entities = [...db.entities];
  const existingIndex = entities.findIndex((item) => item.id === existing.id);

  const nextMood = entity.mood?.trim() || existing.mood;
  const nextAge = entity.age !== undefined ? entity.age : existing.age;

  const extraAlias =
    name.toLowerCase() !== existing.name.toLowerCase() &&
    !existing.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase())
      ? [name]
      : [];

  entities[existingIndex] = {
    ...existing,
    aliases: [...existing.aliases, ...extraAlias].slice(0, 10),
    met: true,
    // The dead are not "seen": a memory, a dream or a body must not push them
    // to the top of the bonds list.
    lastSeen: existing.deceased || existing.status === 'Deceased' ? existing.lastSeen : db.state.inStoryDate,
    lastSeenAt: existing.deceased || existing.status === 'Deceased' ? existing.lastSeenAt : db.state.location || existing.lastSeenAt,
    age: nextAge,
    birthYear:
      entity.age !== undefined
        ? db.state.inStoryDate.year - entity.age
        : existing.birthYear,
    role: entity.role?.trim() || existing.role,
    personality: entity.personality?.trim() || existing.personality,
    speechStyle: entity.speechStyle?.trim() || existing.speechStyle,
    mood: nextMood,
    appearance: entity.appearance?.trim() || existing.appearance,
  };

  const nextState =
    existing.name.toLowerCase() === 'kan' && nextMood
      ? { ...db.state, mood: nextMood }
      : db.state;

  return {
    ...db,
    state: nextState,
    entities,
  };
}
