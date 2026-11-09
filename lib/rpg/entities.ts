// People and places: name/identity resolution, the state tracker's character
// IDs, entity updates, presence, and duplicate merging.

import { dateSortValue } from './calendar';
import { moveCharacterImages } from './characterPortrait';
import { characterRefs } from './characterRefs';
import { makeId } from './id';
import { isPlaceholderStatus, NEWLY_MET_STATUS, UNMET_STATUS } from './met';
import { romanceFor } from './romance';
import { uniqueList } from './util';
import type { AppDatabase, EntityRecord, TurnDiff } from './types';
import { isPlayer } from './player';

type CharacterRef = { entityId?: string; name: string };

/**
 * Turns the state tracker's character IDs back into people. Each reference is
 * a KNOWN CHARACTERS ID ("mara-voss"), the exact name of someone added
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

  /** For free-text fields (fact subjects): an ID becomes a name, anything else stays. */
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
      claimedBy: fact.claimedBy ? resolve(fact.claimedBy)?.name : undefined,
      whoKnows: fact.whoKnows ? uniqueList(fact.whoKnows.map((name) => nameOf(name) ?? name)) : fact.whoKnows,
    }));
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

  // Grudges belong to people the save knows.
  if (diff.grudges) {
    next.grudges = diff.grudges.flatMap((grudge) => {
      const ref = resolve(grudge.entityId ?? grudge.name);

      return ref?.entityId ? [{ ...grudge, name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  if (diff.birthdaysLearned) {
    next.birthdaysLearned = diff.birthdaysLearned.flatMap((item) => {
      const ref = resolve(item.entityId ?? item.name);

      return ref?.entityId ? [{ name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  if (diff.lettersReceived) {
    next.lettersReceived = diff.lettersReceived.flatMap((letter) => {
      const ref = resolve(letter.entityId ?? letter.name);

      return ref?.entityId ? [{ name: ref.name, entityId: ref.entityId, ...(letter.text ? { text: letter.text } : {}) }] : [];
    });
  }

  // Names the player learned belong to someone the save knows (a stranger added this
  // turn included, by the label they were added under).
  const freshId = (raw: string) => {
    const ref = resolve(raw);
    return ref?.entityId ? ref : ref ? { name: ref.name } : null;
  };

  if (diff.namesLearned) {
    next.namesLearned = diff.namesLearned.flatMap((item) => {
      const ref = freshId(item.entityId ?? item.character);

      return ref ? [{ ...item, character: ref.name, entityId: ref.entityId }] : [];
    });
  }

  if (diff.namesTold) {
    next.namesTold = diff.namesTold.flatMap((item) => {
      const ref = resolve(item.entityId ?? item.character);
      const toldTo = item.toldTo.map((raw) => resolve(raw)?.entityId).filter((id): id is string => Boolean(id));

      return ref?.entityId && toldTo.length > 0 ? [{ ...item, character: ref.name, entityId: ref.entityId, toldTo }] : [];
    });
  }

  // Life events belong to people the save knows.
  if (diff.lifeEvents) {
    next.lifeEvents = diff.lifeEvents.flatMap((item) => {
      const ref = resolve(item.entityId ?? item.name);

      return ref?.entityId ? [{ ...item, name: ref.name, entityId: ref.entityId }] : [];
    });
  }

  // A consequence can belong to someone unnamed; a named one is resolved, and
  // witnesses become names.
  if (diff.consequences) {
    next.consequences = diff.consequences.map((seed) => {
      const ref = seed.entityId ? resolve(seed.entityId) : null;

      return {
        ...seed,
        entityId: ref?.entityId,
        who: ref?.entityId ? ref.name : seed.who,
        witnesses: seed.witnesses ? people(seed.witnesses) : seed.witnesses,
      };
    });
  }

  return next;
}

/**
 * Duplicates are merged by hand (MergeSheet, mergeEntityPair): names alone
 * never prove two records are one person. Kept so callers stay the same.
 */
export function mergeDuplicateEntities(db: AppDatabase): AppDatabase {
  return db;
}

function known(value: string | undefined) {
  return value && value !== 'Unknown' ? value : undefined;
}

/** A stranger's label, made unique so two look-alikes stay two people. */
function strangerName(db: AppDatabase, raw: string) {
  const base = /^(?:the|a|an)\s/i.test(raw) ? raw.replace(/^(?:a|an)\s/i, 'the ') : `the ${raw}`;
  const taken = new Set(db.entities.map((entity) => entity.name.toLowerCase()));

  if (!taken.has(base.toLowerCase())) {
    return base;
  }

  for (let index = 2; index < 30; index += 1) {
    if (!taken.has(`${base} (${index})`.toLowerCase())) {
      return `${base} (${index})`;
    }
  }

  return base;
}

/** The player knows the merged person by everything he knew of either record. */
function mergeKnown(keep: EntityRecord, drop: EntityRecord): EntityRecord['known'] {
  const named = (entity: EntityRecord) => !entity.unnamed && entity.known === undefined;

  if (named(keep) || named(drop)) {
    return undefined;
  }

  const a = keep.known ?? {};
  const b = drop.known ?? {};

  return {
    ...(a.label ?? b.label ? { label: a.label ?? b.label } : {}),
    ...(a.given || b.given ? { given: true } : {}),
    ...(a.family || b.family ? { family: true } : {}),
    ...(a.identities || b.identities ? { identities: uniqueList([...(a.identities ?? []), ...(b.identities ?? [])]) } : {}),
    ...(a.history || b.history ? { history: [...(a.history ?? []), ...(b.history ?? [])].slice(-12) } : {}),
  };
}

/**
 * Folds one character into another: the dropped person's names become
 * aliases, missing details are filled in, and every bond, fact, memory link,
 * thread and scene reference moves to the kept person. Used by "Merge with…"
 * on the bond screen.
 */
export function mergeEntityPair(db: AppDatabase, keepId: string, dropId: string): AppDatabase {
  const keep = db.entities.find((entity) => entity.id === keepId);
  const drop = db.entities.find((entity) => entity.id === dropId);

  // You are never folded into someone else.
  if (!keep || !drop || keep.id === drop.id || isPlayer(db, drop)) {
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
    // What the player knew of either name carries over to the one person.
    known: mergeKnown(keep, drop),
    unnamed: keep.unnamed && drop.unnamed ? true : undefined,
    identities: keep.identities ?? drop.identities,
    age: keep.age ?? drop.age,
    birthday: keep.birthday ?? drop.birthday,
    birthYear: keep.birthYear ?? drop.birthYear,
    role: known(keep.role) ?? drop.role,
    personality: known(keep.personality) ?? drop.personality,
    speechStyle: known(keep.speechStyle) ?? drop.speechStyle,
    // A real status beats a placeholder; between placeholders, having met
    // them on either side wins over "Not yet met".
    status: !isPlaceholderStatus(keep.status)
      ? keep.status
      : !isPlaceholderStatus(drop.status)
        ? drop.status
        : keep.met === false && drop.met === false
          ? keep.status || drop.status
          : NEWLY_MET_STATUS,
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

  return moveCharacterImages({
    ...db,
    entities,
    bonds,
    facts: db.facts.map((fact) => ({
      ...fact,
      subjectEntityId: fact.subjectEntityId === drop.id ? keep.id : fact.subjectEntityId,
      whoKnows: uniqueList(fact.whoKnows.map((id) => (id === drop.id ? keep.id : id))),
      claimedBy: fact.claimedBy === drop.id ? keep.id : fact.claimedBy,
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
    state: {
      ...db.state,
      sceneCast: Array.isArray(db.state.sceneCast) ? renameAll(db.state.sceneCast) : db.state.sceneCast,
    },
  }, keep.id, drop.id);
}

/**
 * The scene cast (characters_present, plus companions) is the one thing
 * that marks people met and stamps when and where the player last saw them.
 */
export function recordPresence(db: AppDatabase, names: string[]): AppDatabase {
  const matched = new Set(names.map((name) => resolveEntity(db, name)?.id).filter(Boolean) as string[]);

  if (matched.size === 0) {
    return db;
  }

  return {
    ...db,
    entities: db.entities.map((entity) =>
      entity.type === 'character' && matched.has(entity.id) && !entity.deceased && entity.status !== 'Deceased'
        ? { ...entity, lastSeen: db.state.inStoryDate, lastSeenAt: db.state.location || entity.lastSeenAt, met: true, whereabouts: undefined }
        : entity
    ),
  };
}

type EntityDiff = NonNullable<TurnDiff['entities']>[number];

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

// Words that describe or address someone rather than name them: "Lady
// Voss", "Mara from the docks", "old man Teo".
const DESCRIPTOR_WORDS = new Set([
  'the', 'of', 'from', 'a', 'an', 'lady', 'lord', 'sir', 'old', 'young', 'little',
  'big', 'great', 'granny', 'grandpa', 'master', 'sensei', 'sama', 'san', 'kun',
  'chan', 'captain', 'general', 'elder', 'brother', 'sister', 'uncle', 'aunt',
  'mister', 'miss', 'man', 'woman', 'boy', 'girl', 'kid',
]);

// Words that describe someone instead of naming them. A name made only of
// these ("the masked man", "the leader", "the woman", "an old man") is a
// description and never matches anyone.
const GENERIC_WORDS = new Set([
  ...DESCRIPTOR_WORDS,
  'masked', 'mask', 'hooded', 'cloaked', 'tall', 'short', 'stranger', 'leader',
  'person', 'figure', 'someone', 'guard', 'man\'s', 'men',
  'women', 'other', 'one', 'that', 'this', 'his', 'her', 'their', 'your',
  'partner', 'boss', 'traveler', 'merchant', 'hunter', 'stitched', 'scarred',
  'red-haired', 'dark-haired', 'blond', 'hidden', 'cloak', 'orange',
]);

const SINGLE_GENERIC_WORDS = new Set([
  'man', 'woman', 'boy', 'girl', 'kid', 'stranger', 'leader', 'person', 'figure',
  'someone', 'guard', 'partner', 'boss', 'traveler', 'merchant',
  'hunter', 'masked', 'mask', 'elder', 'captain', 'officer', 'master', 'lord', 'lady',
]);

/** True for a description ("the masked man") rather than a name. */
export function isGenericDescription(rawName: string) {
  const words = rawName
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}'-]/gu, ''))
    .filter(Boolean);

  if (words.length === 0) {
    return true;
  }

  // One word is only a description when it is a plain noun ("Stranger"):
  // a lone "A" may be someone's name, not an article.
  if (words.length === 1) {
    return SINGLE_GENERIC_WORDS.has(words[0]);
  }

  return words.every((word) => GENERIC_WORDS.has(word));
}

const LEADING_TITLES = /^(?:the|lady|lord|sir|master|granny|grandpa|elder|captain|mister|miss)\s+/i;
const TRAILING_HONORIFICS = /(?:\s*-\s*|\s+)(?:sama|san|kun|chan|sensei|senpai|dono)$/i;

/** The ways a written name can be the same exact name: "Lady Vance", "Mara-san". */
function exactCandidates(rawName: string) {
  const out = new Set<string>();

  for (const candidate of nameCandidates(rawName)) {
    let value = candidate.toLowerCase().trim();
    out.add(value);

    for (let i = 0; i < 3; i += 1) {
      const stripped = value.replace(LEADING_TITLES, '').replace(TRAILING_HONORIFICS, '').trim();

      if (stripped === value || !stripped) {
        break;
      }

      value = stripped;
      out.add(value);
    }
  }

  return [...out].filter((candidate) => candidate.length > 0 && !isGenericDescription(candidate));
}

/** Names this person can be matched by: their name and visible aliases (never hidden ones). */
function matchNames(entity: EntityRecord) {
  return [entity.name, ...entity.aliases]
    .map((name) => name.toLowerCase().trim())
    .filter((name) => name && !isGenericDescription(name));
}

/**
 * Finds the person a name refers to: only an exact name or visible alias,
 * allowing for titles and honorifics ("Lady Vance", "Mara-san").
 * Descriptions ("the masked man") and hidden spoiler names never match.
 * `exactOnly` is kept for callers; every lookup is exact now.
 */
export function resolveEntity(
  db: AppDatabase,
  rawName: string,
  _options: { exactOnly?: boolean } = {}
): EntityRecord | null {
  if (!rawName || typeof rawName !== 'string') {
    return null;
  }

  const candidates = exactCandidates(rawName);

  if (candidates.length === 0) {
    return null;
  }

  for (const entity of db.entities) {
    if (entity.type !== 'character') {
      continue;
    }

    const names = matchNames(entity);

    if (candidates.some((candidate) => names.includes(candidate))) {
      return entity;
    }
  }

  return null;
}

export function applyEntityDiff(db: AppDatabase, entity: EntityDiff): AppDatabase {
  if (!entity?.name || typeof entity.name !== 'string') {
    return db;
  }

  const name = entity.name.trim();

  const byId = entity.entityId
    ? (db.entities.find((item) => item.id === entity.entityId) ?? null)
    : null;
  // Someone flagged as new is only a known person under a name they already
  // go by: "Dan the Fisherman" is not Dan, "Mara Kell" is not Mara Vance.
  // A stranger the player cannot name yet is always someone new: their "name" is
  // only how they look to the player, and two strangers can look alike.
  const stranger = !byId && entity.isNew === true && entity.nameKnown === false;
  let existing = stranger ? null : (byId ?? resolveEntity(db, name, { exactOnly: entity.isNew === true }));

  // Only someone the tracker flagged as new may be created; an update for a
  // person who cannot be found is dropped instead of becoming a duplicate.
  // A description ("the masked man") is never a new person either.
  if (!existing && (entity.isNew === false || (isGenericDescription(name) && !stranger))) {
    return db;
  }

  if (!existing) {
    const label = stranger ? strangerName(db, entity.label?.trim() || name) : null;
    const newEntity = {
      id: makeId('entity'),
      name: label ?? name,
      ...(label ? { unnamed: true as const, known: { label } } : {}),
      type: 'character' as const,
      aliases: [],
      birthYear:
        entity.age !== undefined
          ? db.state.inStoryDate.year - entity.age
          : undefined,
      // Age comes from birthYear (and birthday) on the in-story date, never a stored number.
      role: entity.role?.trim() || 'Unknown',
      personality: entity.personality?.trim() || 'Unknown',
      speechStyle: entity.speechStyle?.trim() || 'Unknown',
      // Being named in the story is not meeting them: only the scene cast
      // (characters_present) makes someone met (settleNewlyMet). The state
      // tracker still knows who they are.
      status: UNMET_STATUS,
      met: false,
      notes: '',
      mood: entity.mood?.trim() || 'Unknown',
      appearance: entity.appearance?.trim() || 'Unknown',
      gender: entity.gender ?? 'unknown',
      ...(entity.minor ? { tier: 'minor' as const } : {}),
      // From who they are, never a default of "winnable".
      romanceAccessibility: romanceFor(entity.attractedTo, db.state.player?.gender),
      ...(entity.attractedTo && entity.attractedTo !== 'unknown' ? { orientation: `Attracted to ${entity.attractedTo}` } : {}),
      tags: [],
    } as EntityRecord;

    return {
      ...db,
      entities: [...db.entities, newEntity],
    };
  }

  const entities = [...db.entities];
  const existingIndex = entities.findIndex((item) => item.id === existing.id);

  const nextMood = entity.mood?.trim() || existing.mood;

  // An identity the player has not learned never becomes a matchable alias.
  const hidden = new Set(
    (existing.identities ?? [])
      .filter((identity) => !existing.aliases.some((alias) => alias.toLowerCase() === identity.name.toLowerCase()))
      .map((identity) => identity.name.toLowerCase())
  );
  const extraAlias =
    name.toLowerCase() !== existing.name.toLowerCase() &&
    !isGenericDescription(name) &&
    !hidden.has(name.toLowerCase()) &&
    !existing.aliases.some((alias) => alias.toLowerCase() === name.toLowerCase())
      ? [name]
      : [];

  // An update changes what is known about them; it never marks them met or
  // seen. Only the scene cast does that (recordPresence).
  entities[existingIndex] = {
    ...existing,
    aliases: [...existing.aliases, ...extraAlias].slice(0, 10),
    age: undefined,
    birthYear:
      entity.age !== undefined
        ? db.state.inStoryDate.year - entity.age
        : existing.birthYear,
    role: entity.role?.trim() || existing.role,
    personality: entity.personality?.trim() || existing.personality,
    speechStyle: entity.speechStyle?.trim() || existing.speechStyle,
    mood: nextMood,
    // An update only says how they look right now; the base look changes
    // only for a real lasting change.
    appearance: entity.lastingAppearance?.trim() || existing.appearance,
    ...(entity.appearance?.trim()
      ? { currentLook: entity.appearance.trim().slice(0, 200), currentLookSeq: undefined }
      : {}),
    ...(entity.whereabouts?.trim() ? { whereabouts: entity.whereabouts.trim().slice(0, 120) } : {}),
  };

  const nextState =
    isPlayer(db, existing) && nextMood
      ? { ...db.state, mood: nextMood }
      : db.state;

  return {
    ...db,
    state: nextState,
    entities,
  };
}

/** Whether the player has learned what a timeline event reveals: its news reached them, or they were part of it. */
export function milestoneKnown(db: AppDatabase, milestoneId: string) {
  const progress = db.state.timelineProgress;

  return Boolean(
    progress?.heard?.[`event_timeline_${milestoneId}`] ||
      progress?.heard?.[milestoneId] ||
      progress?.engaged?.includes(milestoneId)
  );
}
