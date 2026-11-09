// Builds a new save from what the player wrote: the world, their character,
// the people they added and the opening scene. It only converts that input
// into save records; it never adds story of its own.

import { DEFAULT_SETTINGS, emptyIndex } from './defaults';
import { knowersOf } from './facts';
import { makeId } from './id';
import { startingPurse } from './money';
import { PLAYER_TAG } from './player';
import { normalizeContentProfile, normalizeIntimacy, normalizeRelationship } from './intimacy';
import { DEFAULT_DATE } from './calendar';
import { emptyWorld, normalizeWorld } from './world';
import type {
  AppDatabase,
  Attraction,
  BondRecord,
  CalendarDate,
  EntityRecord,
  EventEntityRecord,
  EventRecord,
  FactRecord,
  Gender,
  SeedInput,
  StartingPerson,
  ThreadRecord,
} from './types';

/** The written aliases plus the given name ("Sam" for "Sam Hale"), so the prose can use either. */
export function withGivenName(name: string, aliases: string[]): string[] {
  const clean = aliases.map((alias) => alias.trim()).filter(Boolean);
  const given = name.trim().split(/\s+/)[0] ?? '';
  const out = given.length >= 2 && given !== name.trim() && !clean.some((alias) => alias.toLowerCase() === given.toLowerCase()) ? [given, ...clean] : clean;
  return [...new Set(out)];
}

export type { SeedInput } from './types';

/** A blank save's input: an empty world, an unnamed character, nobody else. New stories come from the wizard. */
export function blankSeedInput(): SeedInput {
  return {
    world: emptyWorld(),
    character: { name: '', aliases: [], age: 25, gender: '', appearance: '', outfit: '', personality: '', speechStyle: '', backstory: '', role: '', skills: '', inventory: [], money: 0, secrets: [], goals: [] },
    people: [],
    opening: { location: '', date: { ...DEFAULT_DATE }, situation: '', castNames: [] },
  };
}

function genderOf(value: string | undefined): Gender {
  const lower = (value ?? '').trim().toLowerCase();

  if (/^(m|male|man)$/.test(lower)) return 'male';
  if (/^(f|female|woman)$/.test(lower)) return 'female';
  return 'unknown';
}

function attractionOf(value: number | undefined): Attraction {
  if (typeof value !== 'number') return 'none';
  if (value >= 7) return 'strong';
  if (value >= 4) return 'warm';
  return 'none';
}

function clampAffinity(value: number) {
  return Math.max(-10, Math.min(10, Math.round(value)));
}

/** The year someone was born, from their age at the start and their birthday (still to come this year: born a year earlier). */
export function birthYearOf(age: number, start: CalendarDate, birthday?: { month: number; day: number }) {
  const notYet = birthday && (birthday.month > start.month || (birthday.month === start.month && birthday.day > start.day));
  return start.year - age - (notYet ? 1 : 0);
}

export function personEntity(person: StartingPerson, id: string, date: CalendarDate): EntityRecord {
  return {
    id,
    name: person.name.trim(),
    type: 'character',
    aliases: withGivenName(person.name, person.aliases ?? []),
    ...(typeof person.age === 'number' ? { age: person.age, birthYear: birthYearOf(person.age, date, person.birthday) } : {}),
    ...(person.birthday ? { birthday: person.birthday } : {}),
    role: person.role,
    personality: person.personality,
    speechStyle: person.speechStyle,
    mood: 'Unknown',
    appearance: person.appearance || 'Unknown',
    gender: genderOf(person.gender),
    ...(person.intimacy ? { intimacy: normalizeIntimacy(person.intimacy) } : {}),
    ...(person.realPerson ? { realPerson: true } : {}),
    ...(person.whereabouts ? { whereabouts: person.whereabouts } : {}),
    ...(person.livesWithYou ? { livesWithYou: true } : {}),
    ...(person.alive ? {} : { deceased: {}, status: 'Deceased' }),
    ...(person.knownName ? {} : { known: { label: person.role || 'someone you know' } }),
    met: person.met !== false,
    // Someone the player already knows was last seen around the start of the story.
    ...(person.met !== false && person.alive ? { lastSeen: date } : {}),
    ...(person.met === false ? { status: person.alive ? 'Not yet met' : 'Deceased' } : {}),
    tags: [],
  };
}

/** The bond for someone the player already knows, as they wrote both sides of it. */
export function personBond(person: StartingPerson, entityId: string, date: CalendarDate, lastKeyEventId: string | null = null): BondRecord {
  const theirs = { affinity: clampAffinity(person.theirFeelings.affinity), note: person.theirFeelings.note };
  const yours = { affinity: clampAffinity(person.yourFeelings.affinity), note: person.yourFeelings.note };

  return {
    id: makeId('bond'),
    entityId,
    characterName: person.name.trim(),
    affinity: theirs.affinity,
    status: person.alive ? person.relationship || 'Known' : `Deceased · ${person.relationship || 'Known'}`,
    lastKeyEventId,
    note: theirs.note,
    theirFeelings: theirs,
    yourFeelings: yours,
    isMajor: true,
    relationship: normalizeRelationship(person.relationship) ?? 'acquaintance',
    attraction: attractionOf(person.attraction),
    updatedInStoryDate: date,
  };
}

/**
 * A new save from the player's world, character, people and opening scene.
 * Without input it is a blank save (nothing built in).
 */
export function seedDatabase(slotId: string, slotName: string, input: SeedInput = blankSeedInput()): AppDatabase {
  const now = Date.now();
  const world = normalizeWorld(input.world);
  const character = input.character;
  const opening = input.opening;
  const date: CalendarDate = { ...opening.date, second: opening.date.second ?? 0 };
  const playerId = makeId('entity');

  const player: EntityRecord = {
    id: playerId,
    name: character.name.trim() || 'You',
    type: 'character',
    aliases: withGivenName(character.name, character.aliases ?? []),
    ...(character.birthday ? { birthday: character.birthday } : {}),
    birthYear: birthYearOf(character.age, date, character.birthday),
    age: character.age,
    role: character.role,
    personality: character.personality,
    speechStyle: character.speechStyle,
    mood: 'Unknown',
    appearance: [character.appearance, character.outfit].filter(Boolean).join(' '),
    gender: genderOf(character.gender),
    met: true,
    tags: [PLAYER_TAG],
  };

  const people = input.people.filter((person) => person.name.trim().length > 0);
  const peopleIds = people.map(() => makeId('entity'));
  const peopleEntities = people.map((person, index) => personEntity(person, peopleIds[index], date));

  const place = opening.placeId ? world.places.find((item) => item.id === opening.placeId) : undefined;
  const placeEntity: EntityRecord = {
    id: makeId('entity'),
    name: opening.location || place?.name || 'Somewhere',
    type: 'place',
    aliases: [],
    ...(place?.description ? { notes: place.description } : {}),
    tags: ['location'],
  };

  const entities = [player, ...peopleEntities, placeEntity];

  const openingEvent: EventRecord = {
    id: makeId('event'),
    chapter: 1,
    scene: opening.location || 'The beginning',
    inStoryDate: date,
    summary: opening.situation,
    importance: 5,
    tags: ['opening'],
    pinned: true,
    sourceLogId: null,
    createdAt: now,
  };

  const castIds = opening.castNames
    .map((name) => peopleEntities.find((entity) => entity.name.toLowerCase() === name.trim().toLowerCase())?.id)
    .filter((id): id is string => Boolean(id));

  const eventEntities: EventEntityRecord[] = [
    { eventId: openingEvent.id, entityId: playerId, role: 'participant' },
    ...castIds.map((entityId) => ({ eventId: openingEvent.id, entityId, role: 'present' as const })),
    { eventId: openingEvent.id, entityId: placeEntity.id, role: 'present' },
  ];

  // Someone the player has not met yet has no bond until they meet.
  const bonds: BondRecord[] = people
    .flatMap((person, index) => (person.met === false ? [] : [{ person, index }]))
    .map(({ person, index }) => personBond(person, peopleIds[index], date, castIds.includes(peopleIds[index]) ? openingEvent.id : null));

  const byName = (name: string | undefined) => {
    const wanted = (name ?? '').trim().toLowerCase();
    if (!wanted || wanted === 'you' || wanted === 'player' || wanted === player.name.toLowerCase()) return playerId;
    return peopleEntities.find((entity) => entity.name.toLowerCase() === wanted || entity.aliases.some((alias) => alias.toLowerCase() === wanted))?.id ?? null;
  };

  const facts: FactRecord[] = [
    ...character.secrets.map((text) => ({ text, about: playerId, knowers: [playerId], type: 'secret' as const })),
    ...(input.truths ?? []).map((truth) => ({
      text: truth.text,
      about: byName(truth.about) ?? playerId,
      knowers: (truth.knownBy && truth.knownBy.length > 0 ? truth.knownBy : ['you']).map((name) => byName(name) ?? name),
      type: truth.type ?? ('event' as const),
    })),
    ...people.flatMap((person, index) =>
      (person.secrets ?? []).map((text) => ({
        text,
        about: peopleIds[index],
        knowers: [peopleIds[index]],
        type: 'secret' as const,
      }))
    ),
  ]
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({
      id: makeId('fact'),
      subjectEntityId: item.about,
      type: item.type,
      text: item.text.trim().slice(0, 200),
      whoKnows: knowersOf({ entities } as AppDatabase, item.knowers).ids,
      validFrom: date,
      validTo: null,
      confidence: 'confirmed' as const,
      sourceEventId: openingEvent.id,
    }));

  const threads: ThreadRecord[] = [...(opening.threads ?? []), ...character.goals]
    .map((title) => title.trim().replace(/[.!]+$/, ''))
    .filter((title, index, all) => title.length > 0 && all.findIndex((other) => other.toLowerCase() === title.toLowerCase()) === index)
    .map((title) => ({
      id: makeId('thread'),
      type: 'goal' as const,
      title: title.slice(0, 80),
      description: title,
      status: 'open' as const,
      openedAt: date,
      resolvedAt: null,
      importance: 4 as const,
      participants: [player.name],
      participantIds: [playerId],
      sourceEventId: openingEvent.id,
    }));

  return {
    schemaVersion: 1,
    meta: { slotId, slotName, createdAt: now, updatedAt: now },
    settings: DEFAULT_SETTINGS,
    rawLog: [],
    world,
    content: normalizeContentProfile(input.content),
    entities,
    events: [openingEvent],
    eventEntities,
    bonds,
    facts,
    threads,
    loreEntries: world.lore.map((entry) => ({ ...entry })),
    summaries: [],
    state: {
      player: { ...character, birthYear: birthYearOf(character.age, date, character.birthday) },
      mood: 'Unknown',
      worldDescription: world.premise,
      inventory: [...character.inventory],
      location: opening.location || place?.name || 'Somewhere',
      ...(place ? { locationKind: place.kind } : {}),
      inStoryDate: date,
      worldPoint: '',
      chapter: 1,
      chapterStart: { turn: 1, date },
      scene: opening.location || 'The beginning',
      sceneCast: opening.castNames.filter((name) => name.trim().length > 0),
      purse: startingPurse(character.money),
      // The player wrote these birthdays down: they know them.
      yearly: { knownBirthdays: peopleEntities.filter((entity) => entity.birthday && entity.met !== false).map((entity) => entity.id), offered: {} },
    },
    indices: emptyIndex(),
    snapshots: [],
  };
}
