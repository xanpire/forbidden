// A small hand-written, present-day setting used by New story until the
// creation wizard exists (session 4), and by the tests. Everything here is
// ordinary player-written input: seedDatabase only turns it into save records.

import type {
  CalendarDate,
  CharacterDefinition,
  OpeningScene,
  StartingPerson,
  WorldDefinition,
} from './types';

export const TEST_START: CalendarDate = { year: 2026, month: 10, day: 1, hour: 22, minute: 0, second: 0 };

export type SeedInput = {
  world: WorldDefinition;
  character: CharacterDefinition;
  people: StartingPerson[];
  opening: OpeningScene;
};

export function testWorld(): WorldDefinition {
  return {
    id: 'world_test_harbourside',
    name: 'Harbourside',
    premise:
      'A rainy port city where old shipping money and new tech money live on the same streets. Everyone knows someone, and nothing stays secret for long.',
    genre: 'contemporary drama',
    tone: 'grounded, warm, slow-burn',
    era: { when: 'present', period: 'today, a mid-sized coastal city', techNotes: 'Phones, cars, the internet: the real world as it is now.' },
    currency: {
      name: 'dollars',
      symbol: '$',
      priceGuide:
        'PRICES (dollars): coffee 4-6; a cheap meal 12-20, a good dinner 60-120; a drink at a bar 7-14; a taxi across town 15-30; a month of rent for a small flat 1,400-2,000; a night in a decent hotel 150-250.',
    },
    calendar: { yearLabel: 'Year', start: { ...TEST_START } },
    factions: [
      {
        id: 'marlow-finch',
        name: 'Marlow & Finch',
        description: 'An old shipping and logistics company that owns half the docks.',
        territoryRegionIds: ['the-docks'],
        carriers: ['email', 'phone'],
      },
      {
        id: 'vance-family',
        name: 'The Vance family',
        description: 'A wealthy, close-knit family with a restaurant empire and a long memory.',
        territoryRegionIds: ['northgate'],
        carriers: ['phone', 'text message'],
      },
    ],
    regions: [
      {
        id: 'old-town',
        name: 'Old Town',
        description: 'Cobbled streets, bars, small flats above shops.',
        climate: 'coastal',
        neighbours: [
          { id: 'the-docks', days: 0.1 },
          { id: 'northgate', days: 0.2 },
        ],
      },
      {
        id: 'the-docks',
        name: 'The Docks',
        description: 'Cranes, warehouses, container yards and the company offices.',
        climate: 'coastal',
        neighbours: [{ id: 'old-town', days: 0.1 }],
      },
      {
        id: 'northgate',
        name: 'Northgate',
        description: 'Quiet hills of big houses and old gardens above the city.',
        climate: 'coastal',
        neighbours: [{ id: 'old-town', days: 0.2 }],
      },
    ],
    places: [
      { id: 'kell-street-flat', name: 'Your flat on Kell Street', regionId: 'old-town', kind: 'structure', description: 'A small top-floor flat with a leaky window.' },
      { id: 'the-anchor', name: 'The Anchor', regionId: 'old-town', kind: 'structure', description: 'A dim bar with a pool table and a loyal crowd.' },
      { id: 'harbour-market', name: 'Harbour Market', regionId: 'old-town', kind: 'settlement', description: 'Covered stalls, food carts, street music.' },
      { id: 'mf-offices', name: 'Marlow & Finch offices', regionId: 'the-docks', kind: 'structure', description: 'Glass and steel over the container yard.' },
      { id: 'coast-road', name: 'Coast Road', regionId: 'northgate', kind: 'road', description: 'The winding road up to the hills.' },
    ],
    lore: [],
    timeline: [],
    festivals: [],
    flashbacks: [],
    letterCarriers: ['text message', 'phone', 'email', 'post'],
    artStyle: 'cinematic photo, 35mm film, natural light',
  };
}

export function testCharacter(): CharacterDefinition {
  return {
    name: 'Alex Reyes',
    aliases: ['Alex'],
    age: 29,
    birthday: { month: 3, day: 14 },
    gender: 'male',
    appearance: 'Tall, dark hair always a little too long, tired brown eyes, a crooked smile.',
    outfit: 'A worn grey coat over a dark shirt and jeans.',
    personality: 'Wry, observant, slow to trust, loyal once he does.',
    speechStyle: 'Dry jokes, short answers, says more with a look.',
    backstory:
      'Grew up in Old Town above his mother\'s shop. Works as a logistics analyst at Marlow & Finch. Moved back to Harbourside a year ago after things fell apart in the capital.',
    role: 'Logistics analyst at Marlow & Finch',
    skills: 'Good with numbers and spreadsheets, reads people well, drives badly.',
    inventory: ['Phone', 'Keys to the flat', 'Wallet', 'Company badge'],
    money: 600,
    secrets: ['You noticed shipments at work that do not add up, and you have told no one.'],
    goals: ['Find out what the missing shipments are.'],
  };
}

export function testPeople(): StartingPerson[] {
  return [
    {
      name: 'Mara Vance',
      aliases: ['Mara'],
      age: 31,
      gender: 'female',
      role: 'Runs The Anchor; the black sheep of the Vance family',
      appearance: 'Short dark-red hair, sharp green eyes, rolled sleeves, a silver ring on her thumb.',
      personality: 'Blunt, funny, protective, hates being told what to do.',
      speechStyle: 'Fast and teasing; drops the jokes when it matters.',
      relationship: 'friendly',
      yourFeelings: { affinity: 5, note: 'You like her more than you let on.' },
      theirFeelings: { affinity: 4, note: 'She thinks you are trouble, the good kind.' },
      attraction: 4,
      romanceAccessibility: 'winnable',
      alive: true,
      knownName: true,
      whereabouts: 'The Anchor',
    },
    {
      name: 'Daniel Okafor',
      aliases: ['Dan'],
      age: 34,
      gender: 'male',
      role: 'Your team lead at Marlow & Finch',
      appearance: 'Neat beard, glasses, always in a pressed shirt.',
      personality: 'Careful, ambitious, kind under the pressure.',
      speechStyle: 'Polite and measured, chooses every word.',
      relationship: 'acquaintance',
      yourFeelings: { affinity: 2, note: 'A good boss, but you are not sure whose side he is on.' },
      theirFeelings: { affinity: 3, note: 'He rates your work and wishes you talked more.' },
      alive: true,
      knownName: true,
      whereabouts: 'Marlow & Finch offices',
    },
  ];
}

export function testOpening(): OpeningScene {
  return {
    location: 'The Anchor',
    placeId: 'the-anchor',
    date: { ...TEST_START },
    situation:
      'A wet Thursday night. You came to The Anchor to forget the numbers that will not add up, and Mara is closing early.',
    castNames: ['Mara Vance'],
    threads: ['Find out what the missing shipments are'],
  };
}

export function testSeedInput(): SeedInput {
  return { world: testWorld(), character: testCharacter(), people: testPeople(), opening: testOpening() };
}
