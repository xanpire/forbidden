// Names the player knows. The narrator and the UI only ever call someone by a name
// the player has actually learned: strangers are described by how they look until
// they give their name, someone else says it, or a text or document shows it.
// A person can still lie about their name in the prose.
//
// Everything comes from the entity itself: `nameParts` and `known` (what the
// player knows of their name).

import { entityAge } from './calendar';
import { resolveEntity } from './entities';
import type {
  AppDatabase,
  EntityRecord,
  NameHow,
  NameKnowledge,
  NamePart,
  NameParts,
  TurnDiff,
} from './types';
import { isPlayerEntity } from './player';


const HISTORY_CAP = 12;

const lower = (value: string) => value.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Name parts

/** How a name splits: given, family, and the whole name shown once both are known. */
export function namePartsOf(entity: Pick<EntityRecord, 'name' | 'nameParts'>): NameParts {
  if (entity.nameParts) return entity.nameParts;

  const words = entity.name.trim().split(/\s+/).filter(Boolean);

  return words.length === 2 ? { given: words[0], family: words[1] } : { given: entity.name.trim() };
}

function fullNameOf(entity: Pick<EntityRecord, 'name' | 'nameParts'>) {
  return namePartsOf(entity).full ?? entity.name;
}

// ---------------------------------------------------------------------------
// What the player knows

/** The player knows at least one of their names. */
export function playerKnowsName(entity: EntityRecord) {
  if (isPlayerEntity(entity) || entity.unnamed) return isPlayerEntity(entity);
  if (entity.known === undefined) return true;

  return Boolean(entity.known.given || entity.known.family);
}

/** The player knows their whole name (both parts). */
function playerKnowsFully(entity: EntityRecord) {
  if (isPlayerEntity(entity)) return true;
  if (entity.unnamed) return false;
  if (entity.known === undefined) return true;

  const parts = namePartsOf(entity);

  return Boolean((!parts.given || entity.known.given) && (!parts.family || entity.known.family));
}

/** The short description for someone the player cannot name yet. */
export function labelOf(db: AppDatabase, entity: EntityRecord): string {
  return entity.known?.label ?? (entity.unnamed ? entity.name : makeLabel(db, entity));
}

/**
 * The one name everything shows: the parts of the name they have heard (given only: "Sam"; both: "Sam Hale";
 * family only: "Hale"), else their description of them.
 */
export function displayName(db: AppDatabase, entity: EntityRecord | null | undefined): string {
  if (!entity) return 'someone';
  if (entity.type !== 'character' || isPlayerEntity(entity)) return entity.name;
  if (entity.unnamed) return labelOf(db, entity);
  if (entity.known === undefined) return entity.name;

  const parts = namePartsOf(entity);
  const given = entity.known.given && parts.given;
  const family = entity.known.family && parts.family;

  if (given && (family || !parts.family)) return family ? fullNameOf(entity) : parts.given!;
  if (given) return parts.given!;
  if (family) return parts.family!;

  return labelOf(db, entity);
}

/** Looks up a person by id and returns their display name. */
export function displayNameOf(db: AppDatabase, entityId: string | null | undefined, fallback = 'someone') {
  const entity = entityId ? db.entities.find((item) => item.id === entityId) : undefined;

  return entity ? displayName(db, entity) : fallback;
}

/** Other names the player has learned for them, for "Also known as". */
export function alsoKnownAs(db: AppDatabase, entity: EntityRecord): string[] {
  if (entity.type !== 'character' || isPlayerEntity(entity)) return [];

  const shown = lower(displayName(db, entity));
  const names = new Set<string>();

  for (const item of entity.known?.history ?? []) {
    if (item.part === 'full') names.add(item.name);
  }

  // Older saves and story people: the aliases they already had are names the player knew.
  if (entity.known === undefined && !entity.unnamed) {
    for (const alias of entity.aliases.slice(0, 4)) names.add(alias);
  }

  // "Sam" and "Sam Hale" are only the shown name again; "Mad Dog Sam" is another.
  const shownWords = new Set(shown.split(/\s+/));
  const sameName = (name: string) => lower(name).split(/\s+/).every((word) => shownWords.has(word));

  return [...names].filter((name) => name.trim().length > 0 && !sameName(name)).slice(0, 6);
}

/** Every name the player may search by: only names the player knows, never a hidden one. */
export function searchableNames(db: AppDatabase, entity: EntityRecord): string[] {
  const label = !playerKnowsName(entity) ? [labelOf(db, entity)] : [];

  return [displayName(db, entity), ...alsoKnownAs(db, entity), ...label];
}

/**
 * For the narrator's lists (bonds, the dead, elsewhere, companions): the name
 * The player knows, or their description with the truth marked as narrator-only.
 */
export function narratorName(db: AppDatabase, entity: EntityRecord): string {
  const shown = displayName(db, entity);

  if (isPlayerEntity(entity) || entity.unnamed || playerKnowsName(entity)) return shown;

  return `${shown} [the player doesn't know their name; narrator only: ${entity.name}]`;
}

// ---------------------------------------------------------------------------
// Labels

function nounFor(db: AppDatabase, entity: EntityRecord) {
  const age = entityAge(db.state.inStoryDate, entity);

  if (entity.gender === 'female') {
    if (age !== undefined && age < 16) return 'girl';
    if (age !== undefined && age >= 60) return 'old woman';
    if (age !== undefined && age < 22) return 'young woman';
    return 'woman';
  }

  if (entity.gender === 'male') {
    if (age !== undefined && age < 16) return 'boy';
    if (age !== undefined && age >= 60) return 'old man';
    if (age !== undefined && age < 22) return 'young man';
    return 'man';
  }

  return 'stranger';
}

const LOOK_WORDS = new Set([
  'hair', 'eyes', 'eye', 'mask', 'scar', 'scars', 'cloak', 'tattoo', 'tattoos', 'markings', 'beard', 'goatee', 'glasses',
  'cap', 'robe', 'robes', 'armor', 'armour', 'sword', 'cane', 'fan', 'bandages', 'braid', 'braids', 'bun', 'ponytail',
  'horns', 'teeth', 'skin', 'piercings', 'hood', 'staff', 'pipe', 'scythe', 'cleaver', 'umbrella', 'kimono', 'apron',
]);
const STOP_WORDS = new Set(['with', 'a', 'an', 'the', 'and', 'in', 'of', 'his', 'her', 'their', 'over', 'under', 'on', 'wearing', 'usually']);

/** "Athletic girl with tousled brown hair, …" → "the girl with tousled brown hair". */
function makeLabel(db: AppDatabase, entity: EntityRecord): string {
  const noun = nounFor(db, entity);
  const words = (entity.appearance ?? '').split(/[.;]/)[0].split(/\s+/).filter(Boolean);
  const at = words.findIndex((word) => LOOK_WORDS.has(word.toLowerCase().replace(/[^a-z]/g, '')));

  if (at === -1) return `the ${noun}`;

  const phrase: string[] = [words[at].replace(/[^\p{L}-]/gu, '')];

  for (let index = at - 1; index >= 0 && phrase.length < 4; index -= 1) {
    const word = words[index];
    const bare = word.toLowerCase().replace(/[^\p{L}-]/gu, '');

    // Stop at a clause break, a joining word, or a name ("the dog Biscuit").
    if (!bare || /[,:()]$/.test(word) || STOP_WORDS.has(bare) || /^\p{Lu}/u.test(word) && index > 0) break;
    phrase.unshift(bare);
  }

  return `the ${noun} with ${phrase.join(' ').toLowerCase()}`;
}

function placeWord(location: string) {
  return location.replace(/\s*\(.*\)$/, '').split(/[,·—-]/)[0].trim();
}

/** A label nobody else on the bonds list has: a detail is added if two would match. */
export function uniqueLabel(db: AppDatabase, entity: EntityRecord, label: string): string {
  const taken = new Set(
    db.entities
      .filter((item) => item.id !== entity.id && item.type === 'character' && !playerKnowsName(item) && item.met !== false)
      .map((item) => lower(labelOf(db, item)))
  );

  if (!taken.has(lower(label))) return label;

  const place = placeWord(db.state.location ?? '');
  const withPlace = place ? `${label} (${place})` : label;

  if (!taken.has(lower(withPlace))) return withPlace;

  for (let index = 2; index < 20; index += 1) {
    const numbered = `${label} (${index})`;
    if (!taken.has(lower(numbered))) return numbered;
  }

  return label;
}

/** Gives everyone present whom the player cannot name a stable, unique label. */
export function ensureLabels(db: AppDatabase, ids: Iterable<string>): AppDatabase {
  const wanted = new Set(ids);
  let next = db;

  for (const entity of db.entities) {
    if (!wanted.has(entity.id) || entity.type !== 'character' || isPlayerEntity(entity) || playerKnowsName(entity) || entity.known?.label) {
      continue;
    }

    const current = next.entities.find((item) => item.id === entity.id)!;
    const label = uniqueLabel(next, current, labelOf(next, current));
    next = withEntity(next, { ...current, known: { ...(current.known ?? {}), label } });
  }

  return next;
}

// ---------------------------------------------------------------------------
// Learning names

function withEntity(db: AppDatabase, entity: EntityRecord): AppDatabase {
  return { ...db, entities: db.entities.map((item) => (item.id === entity.id ? entity : item)) };
}

/** Everything the player knows of them, made explicit (an older record with no `known` knows its name). */
function explicitKnowledge(entity: EntityRecord): NameKnowledge {
  if (entity.known) return entity.known;

  return entity.unnamed ? {} : { given: true, family: true };
}

/**
 * The player learns a name: a part of it or the whole of it. A stranger the story never named takes the name. Silent: no
 * notice, as in life.
 */
export function learnName(
  db: AppDatabase,
  entityId: string,
  learned: { name: string; part?: NamePart; how: NameHow }
): AppDatabase {
  const entity = db.entities.find((item) => item.id === entityId);
  const name = learned.name.trim().replace(/^["“”']+|["“”']+$/g, '');

  if (!entity || entity.type !== 'character' || isPlayerEntity(entity) || !name) return db;

  const date = db.state.inStoryDate;
  const knowledge = explicitKnowledge(entity);
  const record = (part: NamePart) =>
    [...(knowledge.history ?? []).filter((item) => !(lower(item.name) === lower(name) && item.part === part)), { name, part, how: learned.how, date }].slice(-HISTORY_CAP);

  // A stranger with only a label: the name they gave becomes theirs.
  if (entity.unnamed) {
    const words = name.split(/\s+/).filter(Boolean);
    const parts: NameParts = words.length === 2 ? { given: words[0], family: words[1] } : { given: name };
    const renamed: EntityRecord = {
      ...entity,
      name,
      nameParts: parts,
      unnamed: undefined,
      known: { label: labelOf(db, entity), given: true, family: words.length === 2, history: record(words.length === 2 ? 'full' : 'given') },
    };
    delete renamed.unnamed;

    const oldName = lower(entity.name);

    return {
      ...withEntity(db, renamed),
      bonds: db.bonds.map((bond) => (bond.entityId === entity.id ? { ...bond, characterName: name } : bond)),
      state: {
        ...db.state,
        sceneCast: (db.state.sceneCast ?? []).map((item) => (lower(item) === oldName ? name : item)),
      },
    };
  }

  const parts = namePartsOf(entity);
  const wanted = lower(name);
  const full = lower(fullNameOf(entity));
  const words = wanted.split(/\s+/);
  let given = Boolean(knowledge.given);
  let family = Boolean(knowledge.family);
  let part: NamePart | null = null;

  // The whole name ("Sam Hale"), never just a record named by its given name ("Sam").
  const whole = parts.family ? wanted === full || (words.includes(lower(parts.given ?? '')) && words.includes(lower(parts.family))) : wanted === full;

  if (whole) {
    given = true;
    family = true;
    part = 'full';
  } else if (parts.given && (wanted === lower(parts.given) || words.includes(lower(parts.given)))) {
    given = true;
    part = 'given';
  } else if (parts.family && (wanted === lower(parts.family) || words.includes(lower(parts.family)))) {
    family = true;
    part = 'family';
  } else if (entity.aliases.some((alias) => lower(alias) === wanted)) {
    // Another name they go by ("Mad Dog Sam"): it carries the given name with it.
    given = true;
    part = 'full';
  }

  if (!part || (given === Boolean(knowledge.given) && family === Boolean(knowledge.family))) return db;

  return withEntity(db, { ...entity, known: { ...knowledge, given, family, history: record(part) } });
}

/** The state tracker's names_learned for this turn. */
export function applyNamesLearned(db: AppDatabase, learned: TurnDiff['namesLearned']): AppDatabase {
  let next = db;

  for (const item of learned ?? []) {
    // A stranger added this turn is found by the label they were added under.
    const id = item.entityId ?? resolveEntity(next, item.character)?.id;

    if (id) next = learnName(next, id, item);
  }

  return next;
}

// ---------------------------------------------------------------------------
// Safety nets: names spoken aloud, and names that leak into narration

const QUOTED = /"([^"\n]{1,600})"|“([^”\n]{1,600})”/g;

function quotedSpans(text: string) {
  return [...text.matchAll(QUOTED)].map((match) => match[1] ?? match[2] ?? '');
}

function withoutQuotes(text: string) {
  return text.replace(QUOTED, ' ');
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A capitalised, whole-word name in the text ("Dan", not "Jordan"; "Guy", not "the guy"). */
function namesInText(text: string, name: string) {
  const trimmed = name.trim();

  if (trimmed.length < 2 || !/^\p{Lu}/u.test(trimmed)) return false;

  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

/** How many people in the save go by this name (a shared name is left to the tracker). */
function owners(db: AppDatabase, name: string) {
  const wanted = lower(name);

  return db.entities.filter(
    (entity) =>
      entity.type === 'character' &&
      [entity.name, ...entity.aliases, namePartsOf(entity).given ?? ''].some((item) => lower(item) === wanted)
  ).length;
}

/** The names of theirs the player does not know yet, each with how learning it would count. */
function unknownNames(entity: EntityRecord): { name: string; part: NamePart }[] {
  if (entity.type !== 'character' || isPlayerEntity(entity) || entity.unnamed || entity.known === undefined) return [];

  const parts = namePartsOf(entity);
  const out: { name: string; part: NamePart }[] = [];

  if (!playerKnowsFully(entity)) out.push({ name: fullNameOf(entity), part: 'full' });
  if (parts.given && !entity.known.given) out.push({ name: parts.given, part: 'given' });

  return out;
}

/**
 * Backup for the tracker: a present person's own, unshared name said aloud in
 * the narration's dialogue counts as heard.
 */
export function learnFromDialogue(db: AppDatabase, narration: string, presentIds: Iterable<string>): AppDatabase {
  const spoken = quotedSpans(narration).join('\n');

  if (!spoken) return db;

  let next = db;

  for (const id of presentIds) {
    const entity = next.entities.find((item) => item.id === id);

    if (!entity) continue;

    for (const candidate of unknownNames(entity)) {
      if (owners(next, candidate.name) === 1 && namesInText(spoken, candidate.name)) {
        next = learnName(next, entity.id, { ...candidate, how: 'overheard' });
      }
    }
  }

  return next;
}

/** Names the narration used outside dialogue that the player could not know: for the Debug panel. */
export function nameLeaks(db: AppDatabase, narration: string): string[] {
  const prose = withoutQuotes(narration);
  const known = new Set(
    db.entities.filter((entity) => entity.type === 'character').flatMap((entity) => [lower(displayName(db, entity)), ...alsoKnownAs(db, entity).map(lower)])
  );
  const leaks: string[] = [];

  for (const entity of db.entities) {
    for (const candidate of unknownNames(entity)) {
      if (known.has(lower(candidate.name)) || !namesInText(prose, candidate.name)) continue;

      leaks.push(`${candidate.name} (you know them as ${displayName(db, entity)})`);
      break;
    }
  }

  return leaks.slice(0, 8);
}

/**
 * For CHARACTERS IN SCENE: how the player knows them, and what the narrator may
 * call them.
 */
export function playerKnowsLine(db: AppDatabase, entity: EntityRecord): string {
  if (isPlayerEntity(entity)) return '';

  if (!playerKnowsName(entity)) {
    return `The player doesn't know their name: call them "${labelOf(db, entity)}" every time until they learn it`;
  }

  if (!playerKnowsFully(entity)) {
    return `The player knows them only as ${displayName(db, entity)} (narrator only: ${fullNameOf(entity)})`;
  }

  return `The player knows them as ${displayName(db, entity)}`;
}

/** Everyone the player learned about in the scene this turn. */
export function applyNameStep(
  db: AppDatabase,
  input: { learned?: TurnDiff['namesLearned']; narration: string; presentIds: string[] }
): AppDatabase {
  let next = applyNamesLearned(db, input.learned);
  next = learnFromDialogue(next, input.narration, input.presentIds);
  next = ensureLabels(next, input.presentIds);

  return next;
}
