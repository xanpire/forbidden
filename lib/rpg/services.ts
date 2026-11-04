import { completeChat, type ChatRequest } from '../openrouter';
import { recordDebugCall, recordDebugState, type DebugCallKind } from './debug';
import { TURN_STATE_SCHEMA, TURN_STATE_SCHEMA_NAME } from './stateSchema';
import { advanceSeconds, dateSortValue, normalizeDate, formatDate, daysBetween, setClock } from './calendar';
import { characterRefs } from './characterRefs';
import { buildArcSummaryPrompt, buildExtractionPrompt, buildSceneSummaryPrompt, buildTimeSkipPrompt } from './prompt';
import { normalizeRelationship, normalizeAttraction } from './romance';
import { classifyLocation } from './encounters';
import { makeId } from './id';
import { normalizeJutsuNature } from './jutsu';
import { buildIndices } from './db';
import type {
  AppDatabase,
  BondRecord,
  CalendarDate,
  EntityRecord,
  EventRecord,
  FactType,
  LocationKind,
  RawLogEntry,
  TurnDiff,
  TurnSnapshot,
} from './types';

export function rollD20() {
  return 1 + Math.floor(Math.random() * 20);
}

/**
 * Turns the state model's snake_case JSON (see stateSchema.ts) into a
 * `TurnDiff`. Lenient: nulls, empty lists and unknown values are ignored, and
 * the older nested `state: { location, ... }` shape is still accepted.
 */
export function convertStateBlock(
  block: Record<string, unknown> | null
): { diff: TurnDiff | null; imageWorthy: boolean } {
  if (!block || typeof block !== 'object') {
    return { diff: null, imageWorthy: false };
  }

  if (Object.keys(block).length === 0) {
    return { diff: null, imageWorthy: false };
  }

  const imageWorthy = block.image_worthy === true;
  const sceneEnded = block.scene_ended === true;
  const diff: TurnDiff = {};

  if (Array.isArray(block.canon_completed)) {
    diff.canonCompleted = block.canon_completed.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
  }

  if (Array.isArray(block.canon_engaged)) {
    diff.canonEngaged = block.canon_engaged.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
  }

  if (Array.isArray(block.canon_passed)) {
    diff.canonPassed = block.canon_passed.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
  }

  if (Array.isArray(block.news_relayed)) {
    diff.newsRelayed = block.news_relayed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        from: typeof item.from === 'string' ? item.from : undefined,
      }))
      .filter((item) => item.id.trim().length > 0);
  }

  const time = block.time;

  if (time && typeof time === 'object' && !Array.isArray(time)) {
    const rawTime = time as {
      elapsed?: unknown;
      unit?: unknown;
      clock_time?: unknown;
      days_passed?: unknown;
      time_of_day?: unknown;
    };

    const unitSeconds: Record<string, number> = {
      second: 1,
      seconds: 1,
      minute: 60,
      minutes: 60,
      hour: 3600,
      hours: 3600,
      day: 86400,
      days: 86400,
    };

    if (typeof rawTime.elapsed === 'number' && Number.isFinite(rawTime.elapsed)) {
      const multiplier =
        typeof rawTime.unit === 'string' ? unitSeconds[rawTime.unit.toLowerCase()] ?? 60 : 60;

      diff.state = {
        ...diff.state,
        elapsedSeconds: Math.max(0, Math.min(30 * 86400, Math.round(rawTime.elapsed * multiplier))),
      };
    } else if (typeof rawTime.days_passed === 'number' && Number.isFinite(rawTime.days_passed)) {
      diff.state = {
        ...diff.state,
        elapsedSeconds: Math.max(0, Math.min(30 * 86400, Math.round(rawTime.days_passed * 86400))),
      };
    }

    if (typeof rawTime.clock_time === 'string') {
      const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(rawTime.clock_time);

      if (match) {
        diff.state = {
          ...diff.state,
          clockTime: {
            hour: Math.max(0, Math.min(23, Number(match[1]))),
            minute: Math.max(0, Math.min(59, Number(match[2]))),
          },
        };
      }
    } else if (
      rawTime.time_of_day === 'morning' ||
      rawTime.time_of_day === 'afternoon' ||
      rawTime.time_of_day === 'evening' ||
      rawTime.time_of_day === 'night'
    ) {
      const legacyHours: Record<string, number> = {
        morning: 8,
        afternoon: 14,
        evening: 19,
        night: 22,
      };

      diff.state = {
        ...diff.state,
        clockTime: { hour: legacyHours[rawTime.time_of_day], minute: 0 },
      };
    }
  }

  if (
    block.scene_pace === 'combat' ||
    block.scene_pace === 'chase' ||
    block.scene_pace === 'conversation' ||
    block.scene_pace === 'travel' ||
    block.scene_pace === 'downtime'
  ) {
    diff.state = { ...diff.state, scenePace: block.scene_pace };
  }

  if (typeof block.mood === 'string' && block.mood.trim()) {
    diff.state = { ...diff.state, mood: block.mood.trim().slice(0, 60) };
  }

  if (typeof block.world_description === 'string' && block.world_description.trim()) {
    diff.state = {
      ...diff.state,
      worldDescription: block.world_description.trim().slice(0, 220),
    };
  }

  const charactersPresent = Array.isArray(block.characters_present)
    ? block.characters_present
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
        .slice(0, 8)
    : [];

  if (charactersPresent.length > 0) {
    diff.state = { ...diff.state, sceneCast: charactersPresent };
  }

  if (sceneEnded || charactersPresent.length > 0) {
    diff.scene = {
      ended: sceneEnded,
      ...(charactersPresent.length > 0 ? { entities: charactersPresent } : {}),
    };
  }

  const flatLocation = cleanString(block.location);
  const flatLocationKind = asLocationKind(block.location_kind);
  const flatCanonPoint = cleanString(block.canon_point);
  const inventoryAdded = stringItems(block.inventory_added);
  const inventoryRemoved = stringItems(block.inventory_removed);

  if (flatLocation || flatLocationKind || flatCanonPoint || inventoryAdded.length || inventoryRemoved.length) {
    diff.state = {
      ...diff.state,
      ...(flatLocation ? { location: flatLocation } : {}),
      ...(flatLocationKind ? { locationKind: flatLocationKind } : {}),
      ...(flatCanonPoint ? { canonPoint: flatCanonPoint } : {}),
      ...(inventoryAdded.length ? { inventoryAdded } : {}),
      ...(inventoryRemoved.length ? { inventoryRemoved } : {}),
    };
  }

  const state = block.state;

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const rawState = state as {
      location?: unknown;
      canon_point?: unknown;
      inventory_and_jutsu_changes?: unknown;
      location_kind?: unknown;
    };

    const inventoryChanges =
      Array.isArray(rawState.inventory_and_jutsu_changes) &&
      rawState.inventory_and_jutsu_changes.length > 0
        ? rawState.inventory_and_jutsu_changes.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0
          )
        : [];

    diff.state = {
      ...diff.state,
      location:
        typeof rawState.location === 'string' && rawState.location.trim()
          ? rawState.location.trim()
          : undefined,
      locationKind:
        rawState.location_kind === 'settlement' ||
        rawState.location_kind === 'road' ||
        rawState.location_kind === 'wilderness' ||
        rawState.location_kind === 'structure'
          ? rawState.location_kind
          : undefined,
      canonPoint:
        typeof rawState.canon_point === 'string' && rawState.canon_point.trim()
          ? rawState.canon_point.trim()
          : undefined,
      inventoryAdded: inventoryChanges,
    };
  }

  if (Array.isArray(block.jutsu_used)) {
    diff.jutsuUsed = block.jutsu_used
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const jutsu = item as {
          name?: unknown;
          user?: unknown;
          chakra_nature?: unknown;
          chakraNature?: unknown;
          effect?: unknown;
          visual?: unknown;
        };

        return {
          name: typeof jutsu.name === 'string' ? jutsu.name : '',
          user: typeof jutsu.user === 'string' && jutsu.user.trim() ? jutsu.user.trim() : 'Kan',
          chakraNature:
            typeof jutsu.chakra_nature === 'string'
              ? jutsu.chakra_nature
              : typeof jutsu.chakraNature === 'string'
                ? jutsu.chakraNature
                : undefined,
          effect: typeof jutsu.effect === 'string' ? jutsu.effect : undefined,
          visual: typeof jutsu.visual === 'string' ? jutsu.visual : undefined,
        };
      })
      .filter((item) => item.name.trim().length > 0);
  }

  if (Array.isArray(block.bonds)) {
    diff.bonds = block.bonds
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const bond = item as {
          character_id?: unknown;
          character?: unknown;
          affinity_change?: unknown;
          status?: unknown;
          note?: unknown;
          relationship?: unknown;
          attraction?: unknown;
          romance_note?: unknown;
        };

        return {
          character:
            cleanString(bond.character_id) ?? (typeof bond.character === 'string' ? bond.character : ''),
          affinityDelta:
            typeof bond.affinity_change === 'number' ? bond.affinity_change : undefined,
          status: typeof bond.status === 'string' ? bond.status : undefined,
          note: typeof bond.note === 'string' ? bond.note : undefined,
          relationship:
            typeof bond.relationship === 'string' ? bond.relationship : undefined,
          attraction: typeof bond.attraction === 'string' ? bond.attraction : undefined,
          romanceNote:
            typeof bond.romance_note === 'string' ? bond.romance_note : undefined,
        };
      })
      .filter((item) => item.character.trim().length > 0);
  }

  if (Array.isArray(block.facts)) {
    diff.facts = block.facts
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const fact = item as { entity?: unknown; fact?: unknown; type?: unknown; who_knows?: unknown };
        const whoKnows = stringItems(fact.who_knows);

        return {
          action: 'add' as const,
          type: asFactType(fact.type),
          text: typeof fact.fact === 'string' ? fact.fact : '',
          subject: cleanString(fact.entity),
          ...(whoKnows.length > 0 ? { whoKnows } : {}),
        };
      })
      .filter((item) => item.text.trim().length > 0);
  }

  if (Array.isArray(block.threads)) {
    diff.threads = block.threads
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const thread = item as { title?: unknown; description?: unknown; status?: unknown };
        const action: 'open' | 'update' | 'resolve' =
          thread.status === 'resolved' || thread.status === 'resolve'
            ? 'resolve'
            : thread.status === 'open'
              ? 'open'
              : 'update';
        const description = cleanString(thread.description);
        const title = cleanString(thread.title) ?? description ?? '';

        return {
          action,
          title: title.slice(0, 80),
          description,
          type: 'other' as const,
        };
      })
      .filter((item) => item.title.length > 0);
  }

  if (Array.isArray(block.new_characters)) {
    diff.entities = block.new_characters
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      // A known person flagged is_new: false is never re-added. (Older
      // replies without the flag are still read as new.)
      .filter((item) => item.is_new !== false)
      .map((item) => {
        const character = item as {
          name?: unknown;
          age?: unknown;
          role?: unknown;
          personality?: unknown;
          speech_style?: unknown;
          appearance?: unknown;
          appearance_block?: unknown;
        };

        return {
          isNew: true,
          name: typeof character.name === 'string' ? character.name : '',
          age: typeof character.age === 'number' ? character.age : undefined,
          role: typeof character.role === 'string' ? character.role : undefined,
          personality:
            typeof character.personality === 'string' ? character.personality : undefined,
          speechStyle:
            typeof character.speech_style === 'string' ? character.speech_style : undefined,
          appearance:
            typeof character.appearance === 'string'
              ? character.appearance
              : typeof character.appearance_block === 'string'
                ? character.appearance_block
                : undefined,
        };
      })
      .filter((item) => item.name.trim().length > 0);
  }

  if (Array.isArray(block.character_updates)) {
    const updates = block.character_updates
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: cleanString(item.character_id) ?? cleanString(item.name) ?? '',
        mood: cleanString(item.mood),
        appearance: cleanString(item.appearance),
      }))
      .filter((item) => item.name.length > 0 && (item.mood || item.appearance));

    if (updates.length > 0) {
      diff.entities = [...(diff.entities ?? []), ...updates];
    }
  }

  if (imageWorthy) {
    diff.imageWorthy = true;
  }

  const hasChanges =
    Object.keys(diff).length > 0 &&
    Object.values(diff).some(
      (value) => Array.isArray(value) ? value.length > 0 : Boolean(value)
    );

  return { diff: hasChanges ? diff : null, imageWorthy };
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function asLocationKind(value: unknown): LocationKind | undefined {
  return value === 'settlement' || value === 'road' || value === 'wilderness' || value === 'structure'
    ? value
    : undefined;
}

const FACT_TYPE_VALUES: FactType[] = [
  'death', 'injury', 'secret', 'knowledge', 'membership', 'possession', 'event', 'other',
];

function asFactType(value: unknown): FactType {
  return typeof value === 'string' && (FACT_TYPE_VALUES as string[]).includes(value)
    ? (value as FactType)
    : 'event';
}

export function cloneDatabase(db: AppDatabase): AppDatabase {
  return JSON.parse(JSON.stringify(db)) as AppDatabase;
}

export function currentTurn(db: AppDatabase) {
  return db.rawLog.filter((message) => message.kind === 'story').length + 1;
}

export function createSnapshot(db: AppDatabase): TurnSnapshot {
  const snapshotDatabase = cloneDatabase(db);
  snapshotDatabase.snapshots = [];

  const snapshot: TurnSnapshot = {
    id: makeId('snapshot'),
    turn: currentTurn(db),
    database: snapshotDatabase,
    createdAt: Date.now(),
  };

  return snapshot;
}

export function pushSnapshot(db: AppDatabase, limit = 3): AppDatabase {
  const snapshot = createSnapshot(db);
  const snapshots = [...db.snapshots, snapshot].slice(-limit);

  return {
    ...db,
    snapshots,
  };
}

export function restoreLastSnapshot(db: AppDatabase): AppDatabase | null {
  const snapshot = db.snapshots[db.snapshots.length - 1];

  if (!snapshot) {
    return null;
  }

  const restored = cloneDatabase(snapshot.database);
  restored.snapshots = db.snapshots.slice(0, -1);

  return restored;
}

export function appendStoryMessage(
  db: AppDatabase,
  role: 'user' | 'assistant',
  content: string,
  model: string | null,
  promptTokens: number,
  completionTokens: number
): AppDatabase {
  const message: RawLogEntry = {
    id: makeId('log'),
    turn: currentTurn(db),
    kind: 'story',
    role,
    content,
    model,
    promptTokens,
    completionTokens,
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: db.state.inStoryDate,
    createdAt: Date.now(),
  };

  return {
    ...db,
    rawLog: [...db.rawLog, message],
  };
}

export function getLastExchange(db: AppDatabase) {
  const story = db.rawLog.filter((message) => message.kind === 'story');
  const lastUser = [...story].reverse().find((message) => message.role === 'user');
  const lastAssistant = [...story].reverse().find((message) => message.role === 'assistant');

  return {
    userMessage: lastUser?.content ?? null,
    assistantMessage: lastAssistant?.content ?? null,
  };
}

export function storyMessagesSinceLastSummary(db: AppDatabase): number {
  const lastChapterSummaryAt = [...db.summaries]
    .filter((summary) => summary.level === 'chapter')
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.createdAt ?? 0;

  return db.rawLog.filter(
    (message) => message.kind === 'story' && message.createdAt > lastChapterSummaryAt
  ).length;
}

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

  if (diff.newsRelayed) {
    next.newsRelayed = diff.newsRelayed.map((news) => ({ ...news, from: nameOf(news.from) }));
  }

  return next;
}

export function applyTurnDiff(db: AppDatabase, diff: TurnDiff | null): AppDatabase {
  if (!diff || typeof diff !== 'object') {
    return db;
  }

  let next = cloneDatabase(db);

  if (diff.state) {
    next = applyStateDiff(next, diff.state);
  }

  if (Array.isArray(diff.entities)) {
    for (const entity of diff.entities) {
      next = applyEntityDiff(next, entity);
    }
  }

  if (Array.isArray(diff.jutsuUsed)) {
    for (const jutsu of diff.jutsuUsed) {
      next = applyJutsuDiff(next, jutsu);
    }
  }

  if (Array.isArray(diff.bonds)) {
    for (const bond of diff.bonds) {
      next = applyBondDiff(next, bond);
    }
  }

  if (Array.isArray(diff.facts)) {
    for (const fact of diff.facts) {
      next = applyFactDiff(next, fact);
    }
  }

  if (Array.isArray(diff.threads)) {
    for (const thread of diff.threads) {
      next = applyThreadDiff(next, thread);
    }
  }

  if (diff.scene?.ended) {
    next = recordSceneEvent(next, diff);
  }

  next = mergeDuplicateEntities(next);

  if (Array.isArray(diff.scene?.entities) && diff.scene.entities.length > 0) {
    next = recordPresence(next, diff.scene.entities);
    next = {
      ...next,
      state: {
        ...next.state,
        sceneCast:
          Array.isArray(next.state.sceneCast) && next.state.sceneCast.length > 0
            ? next.state.sceneCast.slice(0, 6)
            : diff.scene.entities.slice(0, 6),
      },
    };
  }

  next = applyClockTick(next, diff);

  next.indices = buildIndices(next);

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

function mergeDuplicateEntities(db: AppDatabase): AppDatabase {
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

function applyClockTick(db: AppDatabase, diff: TurnDiff): AppDatabase {
  const state = diff.state;
  const hadTimeUpdate = Boolean(
    state?.inStoryDate ||
    state?.clockTime ||
    (typeof state?.elapsedSeconds === 'number' && state.elapsedSeconds > 0)
  );

  const turns = db.state.turnsWithoutTimeChange ?? 0;

  // The clock never advances on its own. This counter only drives a prompt
  // nudge when the story has gone several turns without any time reporting.
  return {
    ...db,
    state: {
      ...db.state,
      turnsWithoutTimeChange: hadTimeUpdate ? 0 : Math.min(turns + 1, 9),
    },
  };
}

function recordPresence(db: AppDatabase, names: string[]): AppDatabase {
  const matched = new Set(names.map((name) => resolveEntity(db, name)?.id).filter(Boolean) as string[]);

  if (matched.size === 0) {
    return db;
  }

  return {
    ...db,
    entities: db.entities.map((entity) =>
      entity.type === 'character' && matched.has(entity.id)
        ? { ...entity, lastSeen: db.state.inStoryDate, met: true }
        : entity
    ),
  };
}

type StateDiff = NonNullable<TurnDiff['state']>;
type EntityDiff = NonNullable<TurnDiff['entities']>[number];
type JutsuDiff = NonNullable<TurnDiff['jutsuUsed']>[number];
type BondDiff = NonNullable<TurnDiff['bonds']>[number];
type FactDiff = NonNullable<TurnDiff['facts']>[number];
type ThreadDiff = NonNullable<TurnDiff['threads']>[number];

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

function applyStateDiff(db: AppDatabase, state: StateDiff): AppDatabase {
  const next = { ...db, state: { ...db.state } };
  const previousDate = db.state.inStoryDate;

  if (typeof state.mood === 'string' && state.mood.trim()) {
    next.state.mood = state.mood.trim().slice(0, 60);

    next.entities = next.entities.map((entity) =>
      entity.name.toLowerCase() === 'kan'
        ? { ...entity, mood: next.state.mood }
        : entity
    );
  }

  if (typeof state.worldDescription === 'string' && state.worldDescription.trim()) {
    next.state.worldDescription = state.worldDescription.trim().slice(0, 220);
  }

  if (Array.isArray(state.jutsuAdded)) {
    next.state.jutsu = uniqueList([
      ...next.state.jutsu,
      ...state.jutsuAdded.filter(Boolean),
    ]).slice(-12);
  }

  if (Array.isArray(state.jutsuRemoved)) {
    next.state.jutsu = next.state.jutsu.filter(
      (jutsu) => !state.jutsuRemoved?.includes(jutsu)
    );
  }

  if (Array.isArray(state.inventoryAdded)) {
    next.state.inventory = uniqueList([
      ...next.state.inventory,
      ...state.inventoryAdded.filter(Boolean),
    ]).slice(-12);
  }

  if (Array.isArray(state.inventoryRemoved)) {
    next.state.inventory = next.state.inventory.filter(
      (item) => !state.inventoryRemoved?.includes(item)
    );
  }

  if (typeof state.location === 'string' && state.location.trim()) {
    next.state.location = state.location.trim().slice(0, 100);
    next.state.locationKind = state.locationKind ?? classifyLocation(next.state.location);
  } else if (state.locationKind) {
    next.state.locationKind = state.locationKind;
  }

  if (Array.isArray(state.sceneCast)) {
    next.state.sceneCast = state.sceneCast.filter(Boolean).slice(0, 6);
  }

  if (
    state.scenePace === 'combat' ||
    state.scenePace === 'chase' ||
    state.scenePace === 'conversation' ||
    state.scenePace === 'travel' ||
    state.scenePace === 'downtime'
  ) {
    next.state.scenePace = state.scenePace;
  }

  let updatedDate: CalendarDate | null = null;

  if (state.inStoryDate) {
    updatedDate = normalizeDate(state.inStoryDate, next.state.inStoryDate);
  } else {
    let working = next.state.inStoryDate;

    const hadElapsed = typeof state.elapsedSeconds === 'number' && state.elapsedSeconds > 0;

    if (hadElapsed) {
      working = advanceSeconds(working, state.elapsedSeconds ?? 0);
    }

    if (state.clockTime) {
      working = hadElapsed
        ? {
            ...working,
            hour: state.clockTime.hour,
            minute: state.clockTime.minute,
            second: 0,
          }
        : setClock(working, state.clockTime.hour, state.clockTime.minute);
    }

    if (working !== next.state.inStoryDate) {
      updatedDate = working;
    }
  }

  if (updatedDate) {
    const finalDate = updatedDate;
    const yearDelta = finalDate.year - previousDate.year;

    next.state.inStoryDate = finalDate;

    if (yearDelta !== 0) {
      next.entities = next.entities.map((entity) => {
        if (entity.birthYear !== undefined) {
          return entity;
        }

        if (entity.age === undefined) {
          return entity;
        }

        return {
          ...entity,
          age: Math.max(0, entity.age + yearDelta),
        };
      });

      next.bonds = next.bonds.map((bond) => ({
        ...bond,
        updatedInStoryDate: finalDate,
      }));
    }
  }

  if (typeof state.canonPoint === 'string' && state.canonPoint.trim()) {
    next.state.canonPoint = state.canonPoint.trim().slice(0, 220);
  }

  if (typeof state.chapter === 'number' && Number.isFinite(state.chapter)) {
    next.state.chapter = Math.max(1, Math.round(state.chapter));
  }

  if (typeof state.scene === 'string' && state.scene.trim()) {
    next.state.scene = state.scene.trim().slice(0, 140);
  }

  return next;
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
    lastSeen: db.state.inStoryDate,
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

function applyJutsuDiff(db: AppDatabase, jutsu: JutsuDiff): AppDatabase {
  if (!jutsu?.name || typeof jutsu.name !== 'string' || !jutsu.user) {
    return db;
  }

  const name = jutsu.name.trim();
  const user = jutsu.user.trim();

  if (!name || !user) {
    return db;
  }

  const existingIndex = db.jutsuRecords.findIndex(
    (item) =>
      item.name.toLowerCase() === name.toLowerCase() &&
      (item.user.toLowerCase() === user.toLowerCase() ||
        resolveEntity(db, user)?.id === resolveEntity(db, item.user)?.id)
  );

  if (existingIndex === -1) {
    const record = {
      id: makeId('jutsu'),
      name,
      user,
      chakraNature: normalizeJutsuNature(jutsu.chakraNature),
      effect: jutsu.effect?.trim() || jutsu.description?.trim() || '',
      visual: jutsu.visual?.trim() || '',
      firstSeen: db.state.inStoryDate,
      lastSeen: db.state.inStoryDate,
      timesUsed: 1,
      description: jutsu.description?.trim() || '',
      tags: [],
    };

    return {
      ...db,
      jutsuRecords: [...db.jutsuRecords, record],
    };
  }

  const jutsuRecords = [...db.jutsuRecords];
  const existing = jutsuRecords[existingIndex];

  jutsuRecords[existingIndex] = {
    ...existing,
    chakraNature: normalizeJutsuNature(jutsu.chakraNature ?? existing.chakraNature),
    effect: jutsu.effect?.trim() || existing.effect,
    visual: jutsu.visual?.trim() || existing.visual,
    lastSeen: db.state.inStoryDate,
    timesUsed: existing.timesUsed + 1,
    description: jutsu.description?.trim() || existing.description,
  };

  return {
    ...db,
    jutsuRecords,
  };
}

function applyBondDiff(db: AppDatabase, bond: BondDiff): AppDatabase {
  if (!bond?.character || typeof bond.character !== 'string') {
    return db;
  }

  const characterName = bond.character.trim();

  if (!characterName) {
    return db;
  }

  const existingEntity =
    (bond.entityId ? db.entities.find((item) => item.id === bond.entityId) : undefined) ??
    resolveEntity(db, characterName);

  const byEntity = existingEntity
    ? db.bonds.findIndex((item) => item.entityId === existingEntity.id)
    : -1;
  const existingIndex =
    byEntity !== -1
      ? byEntity
      : db.bonds.findIndex(
          (item) => item.characterName.toLowerCase() === characterName.toLowerCase()
        );

  // A bond means you know them now: canon cast members join the bonds list.
  if (existingEntity && existingEntity.met === false) {
    db = {
      ...db,
      entities: db.entities.map((item) =>
        item.id === existingEntity.id ? { ...item, met: true } : item
      ),
    };
  }

  if (existingIndex === -1) {
    let bondEntity = existingEntity;

    if (!bondEntity) {
      bondEntity = {
        id: makeId('entity'),
        name: characterName,
        type: 'character' as const,
        aliases: [],
        status: 'Newly met',
        notes: '',
        mood: 'Unknown',
        appearance: 'Unknown',
        tags: [],
      };
    }

    const newBond = {
      id: makeId('bond'),
      entityId: bondEntity.id,
      characterName: bondEntity.name,
      affinity: clamp(
        typeof bond.affinityDelta === 'number' ? bond.affinityDelta : 0,
        -10,
        10
      ),
      status: bond.status?.trim() || 'Acquaintance',
      lastKeyEventId: null,
      note: bond.note?.trim() || '',
      isMajor: Boolean(bond.isMajor),
      relationship: normalizeRelationship(bond.relationship),
      attraction: normalizeAttraction(bond.attraction),
      romanceNote: bond.romanceNote?.trim() || undefined,
      updatedInStoryDate: db.state.inStoryDate,
    };

    const entities = bondEntity && !db.entities.some((item) => item.id === bondEntity.id)
      ? [...db.entities, bondEntity]
      : db.entities;

    return {
      ...db,
      entities,
      bonds: [...db.bonds, newBond],
    };
  }

  const bonds = [...db.bonds];
  const existing = bonds[existingIndex];

  bonds[existingIndex] = {
    ...existing,
    characterName: existingEntity?.name ?? existing.characterName,
    affinity: clamp(
      existing.affinity +
        (typeof bond.affinityDelta === 'number' ? bond.affinityDelta : 0),
      -10,
      10
    ),
    status: bond.status?.trim() || existing.status,
    note: bond.note?.trim() || existing.note,
    isMajor: typeof bond.isMajor === 'boolean' ? bond.isMajor : existing.isMajor,
    relationship:
      normalizeRelationship(bond.relationship) ?? existing.relationship ?? 'stranger',
    attraction:
      normalizeAttraction(bond.attraction) ?? existing.attraction ?? 'none',
    romanceNote: bond.romanceNote?.trim() || existing.romanceNote,
    updatedInStoryDate: db.state.inStoryDate,
  };

  return {
    ...db,
    bonds,
  };
}

function applyFactDiff(db: AppDatabase, fact: FactDiff): AppDatabase {
  if (!fact?.text || typeof fact.text !== 'string') {
    return db;
  }

  const text = fact.text.trim();

  if (!text) {
    return db;
  }

  const currentDate = fact.validFrom
    ? normalizeDate(fact.validFrom, db.state.inStoryDate)
    : db.state.inStoryDate;

  if (fact.action === 'end') {
    const facts = db.facts.map((item) => {
      if (
        item.validTo === null &&
        (item.text.toLowerCase() === text.toLowerCase() ||
          item.text.toLowerCase().includes(text.toLowerCase()))
      ) {
        return {
          ...item,
          validTo: currentDate,
        };
      }

      return item;
    });

    return {
      ...db,
      facts,
    };
  }

  const subjectEntity = fact.subject ? resolveEntity(db, fact.subject) : null;

  const duplicate = db.facts.find(
    (item) =>
      item.validTo === null &&
      (item.text.toLowerCase() === text.toLowerCase() ||
        (text.length > 30 &&
          item.text.toLowerCase().includes(text.toLowerCase())))
  );

  if (duplicate) {
    return db;
  }

  const newFact = {
    id: makeId('fact'),
    subjectEntityId: subjectEntity?.id ?? null,
    type: fact.type ?? 'other',
    text: text.slice(0, 200),
    whoKnows: Array.isArray(fact.whoKnows) ? fact.whoKnows.filter(Boolean) : [],
    validFrom: currentDate,
    validTo: null,
    confidence: 'confirmed' as const,
    sourceEventId: null,
  };

  return {
    ...db,
    facts: [...db.facts, newFact],
  };
}

function applyThreadDiff(db: AppDatabase, thread: ThreadDiff): AppDatabase {
  if (!thread?.title || typeof thread.title !== 'string') {
    return db;
  }

  const title = thread.title.trim().toLowerCase();

  if (!title) {
    return db;
  }

  const descriptionKey = (thread.description?.trim() || title).toLowerCase().slice(0, 40);
  const existingIndex = db.threads.findIndex(
    (item) =>
      item.title.toLowerCase() === title ||
      (thread.description?.trim() &&
        item.status === 'open' &&
        (item.title.toLowerCase().startsWith(descriptionKey) ||
          item.description.toLowerCase().startsWith(descriptionKey) ||
          descriptionKey.startsWith(item.title.toLowerCase().slice(0, 40))))
  );

  if (thread.action === 'resolve') {
    if (existingIndex === -1) {
      return db;
    }

    const threads = [...db.threads];
    threads[existingIndex] = {
      ...threads[existingIndex],
      status: 'resolved',
      resolvedAt: db.state.inStoryDate,
      description: thread.description?.trim() || threads[existingIndex].description,
    };

    return {
      ...db,
      threads,
    };
  }

  if (existingIndex === -1) {
    const newThread = {
      id: makeId('thread'),
      type: thread.type ?? 'other',
      title,
      description: thread.description?.trim() || '',
      status: 'open' as const,
      openedAt: db.state.inStoryDate,
      resolvedAt: null,
      importance: 3 as 1 | 2 | 3 | 4 | 5,
      participants: Array.isArray(thread.participants)
        ? thread.participants.filter(Boolean)
        : [],
      sourceEventId: null,
    };

    return {
      ...db,
      threads: [...db.threads, newThread],
    };
  }

  const threads = [...db.threads];
  threads[existingIndex] = {
    ...threads[existingIndex],
    description: thread.description?.trim() || threads[existingIndex].description,
    type: thread.type ?? threads[existingIndex].type,
    participants: Array.isArray(thread.participants)
      ? uniqueList([...threads[existingIndex].participants, ...thread.participants])
      : threads[existingIndex].participants,
  };

  return {
    ...db,
    threads,
  };
}

function recordSceneEvent(db: AppDatabase, diff: TurnDiff): AppDatabase {
  const scene = diff.scene;
  const summary =
    scene?.summary?.trim() ||
    trimToSentence(
      db.rawLog
        .filter((message) => message.kind === 'story')
        .slice(-2)
        .map((message) => message.content)
        .join(' ')
    ).slice(0, 240);

  if (!summary) {
    return db;
  }

  const event: EventRecord = {
    id: makeId('event'),
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: db.state.inStoryDate,
    summary: trimToSentence(summary.slice(0, 220)),
    importance: scene?.importance ?? 3,
    tags: Array.isArray(scene?.tags) ? scene.tags.filter(Boolean).slice(0, 6) : [],
    pinned: false,
    sourceLogId: null,
    createdAt: Date.now(),
  };

  const eventEntities = (scene?.entities ?? [])
    .map((name) => resolveEntity(db, name))
    .filter((entity): entity is EntityRecord => Boolean(entity))
    .map((entity) => ({
      eventId: event.id,
      entityId: entity.id,
      role: 'present' as const,
    }));

  return {
    ...db,
    events: [...db.events, event],
    eventEntities: [...db.eventEntities, ...eventEntities],
  };
}

/** completeChat, with the call (tokens, cost, errors) recorded against a turn in the debug log. */
async function tracedChat(kind: DebugCallKind, debugTurnId: string | undefined, request: ChatRequest) {
  try {
    const result = await completeChat(request);
    recordDebugCall(debugTurnId, {
      kind,
      model: request.model,
      usage: result.usage,
      finishReason: result.finishReason,
      apiKey: request.apiKey,
    });
    return result;
  } catch (caught) {
    recordDebugCall(debugTurnId, {
      kind,
      model: request.model,
      usage: null,
      error: caught instanceof Error ? caught.message : String(caught),
    });
    throw caught;
  }
}

/**
 * Call 2 of a turn: a cheap model reads the narrator's prose and returns the
 * state change through structured JSON output. Throws if the call fails, so
 * the caller can queue a retry.
 */
export async function extractTurnDiff(options: {
  apiKey: string;
  db: AppDatabase;
  userMessage: string;
  assistantMessage: string;
  signal?: AbortSignal;
  /** The narrator reply this belongs to, for the debug log. */
  debugTurnId?: string;
}): Promise<TurnDiff | null> {
  const { apiKey, db, userMessage, assistantMessage, signal, debugTurnId } = options;
  const prompt = buildExtractionPrompt(db, userMessage, assistantMessage);
  recordDebugState(debugTurnId, { status: 'running' });

  const result = await tracedChat('state', debugTurnId, {
    apiKey,
    model: db.settings.extractionModel,
    messages: prompt.messages,
    temperature: 0,
    maxTokens: 1200,
    signal,
    jsonSchema: { name: TURN_STATE_SCHEMA_NAME, schema: TURN_STATE_SCHEMA },
  });

  const parsed = parseJsonObject(result.text);
  recordDebugState(debugTurnId, { status: 'running', raw: result.text });

  // Unreadable reply: fall back to what the app can read from the prose
  // itself (clock, pace) rather than blocking the turn.
  if (!parsed) {
    return null;
  }

  const diff = convertStateBlock(parsed).diff;

  return diff ? resolveCharacterRefs(db, diff) : null;
}

export async function summarizeScene(options: {
  apiKey: string;
  db: AppDatabase;
  messages: RawLogEntry[];
  debugTurnId?: string;
}): Promise<string | null> {
  const { apiKey, db, messages, debugTurnId } = options;

  if (messages.length === 0) {
    return null;
  }

  const prompt = buildSceneSummaryPrompt(db, messages);

  const result = await tracedChat('scene', debugTurnId, {
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 700,
  });

  const text = trimToSentence(result.text);

  return text || null;
}

export async function summarizeTimeSkip(options: {
  apiKey: string;
  db: AppDatabase;
  fromDate: CalendarDate;
  toDate: CalendarDate;
  debugTurnId?: string;
}): Promise<string | null> {
  const { apiKey, db, fromDate, toDate, debugTurnId } = options;

  if (Math.abs(daysBetween(fromDate, toDate)) < 180) {
    return null;
  }

  const prompt = buildTimeSkipPrompt(
    db,
    formatDate(fromDate),
    formatDate(toDate)
  );

  const result = await tracedChat('timeSkip', debugTurnId, {
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 700,
  });

  return trimToSentence(result.text) || null;
}

export async function rollArcSummary(options: {
  apiKey: string;
  db: AppDatabase;
  chapterSummaries: string[];
  debugTurnId?: string;
  debugKind?: 'arc' | 'year';
}): Promise<string | null> {
  const { apiKey, db, chapterSummaries, debugTurnId, debugKind = 'arc' } = options;

  if (chapterSummaries.length < 3) {
    return null;
  }

  const prompt = buildArcSummaryPrompt(db, chapterSummaries);

  const result = await tracedChat(debugKind, debugTurnId, {
    apiKey,
    model: db.settings.summaryModel,
    messages: prompt.messages,
    temperature: 0.2,
    maxTokens: 900,
  });

  return trimToSentence(result.text) || null;
}

export function trimToSentence(text: string): string {
  let cleaned = text.trim();

  const fenceStart = cleaned.indexOf('```');

  if (fenceStart !== -1) {
    cleaned = cleaned.slice(0, fenceStart).trim();
  }

  const labelMatch = /(?:^|\n)\s*(?:chapter|arc|year)\s+summary\s*:\s*\n?/i.exec(cleaned);

  if (labelMatch && cleaned.slice(labelMatch.index + labelMatch[0].length).trim().length > 0) {
    cleaned = cleaned.slice(labelMatch.index + labelMatch[0].length).trim();
  }

  const sentenceEnd = /[.!?](?:["'”’)]+)?(?=\s|$)/g;
  let lastEnd = -1;

  for (const match of cleaned.matchAll(sentenceEnd)) {
    lastEnd = match.index + match[0].length;
  }

  if (lastEnd > 0 && lastEnd < cleaned.length) {
    return cleaned.slice(0, lastEnd).trim();
  }

  return cleaned;
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  if (!trimmed || trimmed === '{}') {
    return {};
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const candidates = [withoutFence];

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function uniqueList(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}
