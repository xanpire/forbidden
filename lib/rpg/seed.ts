// Builds a new save from what the player wrote: the world, their character,
// the people they added and the opening scene. It only converts that input
// into save records; it never adds story of its own.

import { DEFAULT_SETTINGS, emptyIndex } from './defaults';
import { knowersOf } from './facts';
import { makeId } from './id';
import { startingPurse } from './money';
import { PLAYER_TAG } from './player';
import { normalizeRelationship } from './romance';
import { testSeedInput, type SeedInput } from './testWorld';
import { normalizeWorld } from './world';
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
  StartingPerson,
  ThreadRecord,
} from './types';

export type { SeedInput } from './testWorld';

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

function personEntity(person: StartingPerson, id: string, date: CalendarDate): EntityRecord {
  return {
    id,
    name: person.name.trim(),
    type: 'character',
    aliases: (person.aliases ?? []).filter((alias) => alias.trim().length > 0),
    ...(typeof person.age === 'number' ? { age: person.age, birthYear: date.year - person.age } : {}),
    role: person.role,
    personality: person.personality,
    speechStyle: person.speechStyle,
    mood: 'Unknown',
    appearance: person.appearance || 'Unknown',
    gender: genderOf(person.gender),
    ...(person.romanceAccessibility === 'winnable'
      ? { romanceAccessibility: 'winnable' as const }
      : person.romanceAccessibility === 'taken'
        ? { romanceAccessibility: 'lore-locked' as const }
        : person.romanceAccessibility
          ? { romanceAccessibility: 'not-applicable' as const }
          : {}),
    ...(person.whereabouts ? { whereabouts: person.whereabouts } : {}),
    ...(person.alive ? {} : { deceased: { known: true }, status: 'Deceased' }),
    ...(person.knownName ? {} : { known: { label: person.role || 'someone you know' } }),
    met: true,
    tags: [],
  };
}

/**
 * A new save from the player's world, character, people and opening scene.
 * Without input it uses the built-in test world.
 */
export function seedDatabase(slotId: string, slotName: string, input: SeedInput = testSeedInput()): AppDatabase {
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
    aliases: character.aliases,
    ...(character.birthday ? { birthday: character.birthday } : {}),
    birthYear: date.year - character.age,
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

  const factionEntities: EntityRecord[] = world.factions.map((faction) => ({
    id: makeId('entity'),
    name: faction.name,
    type: 'faction',
    aliases: [],
    notes: faction.description,
    tags: ['faction', faction.id],
  }));

  const entities = [player, ...peopleEntities, placeEntity, ...factionEntities];

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

  const bonds: BondRecord[] = people.map((person, index) => {
    const theirs = { affinity: clampAffinity(person.theirFeelings.affinity), note: person.theirFeelings.note };
    const yours = { affinity: clampAffinity(person.yourFeelings.affinity), note: person.yourFeelings.note };

    return {
      id: makeId('bond'),
      entityId: peopleIds[index],
      characterName: person.name.trim(),
      affinity: theirs.affinity,
      status: person.alive ? person.relationship || 'Known' : `Deceased · ${person.relationship || 'Known'}`,
      lastKeyEventId: castIds.includes(peopleIds[index]) ? openingEvent.id : null,
      note: theirs.note,
      theirFeelings: theirs,
      yourFeelings: yours,
      isMajor: true,
      relationship: normalizeRelationship(person.relationship) ?? 'acquaintance',
      attraction: attractionOf(person.attraction),
      updatedInStoryDate: date,
    };
  });

  const facts: FactRecord[] = [
    ...character.secrets.map((text) => ({ text, about: playerId, knowers: [playerId], type: 'secret' as const })),
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
    entities,
    events: [openingEvent],
    eventEntities,
    bonds,
    facts,
    threads,
    loreEntries: world.lore.map((entry) => ({ ...entry })),
    summaries: [],
    state: {
      player: { ...character, birthYear: date.year - character.age },
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
    },
    indices: emptyIndex(),
    snapshots: [],
  };
}
