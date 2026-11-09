import { describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

import { normalizeDatabase } from '../lib/rpg/db';
import { seedDatabase } from './fixtures/seed';
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { playerName } from '../lib/rpg/player';
import {
  applySuggestion,
  draftToSeedInput,
  emptyDraft,
  emptyPerson,
  helpFillMessages,
  missingFields,
  newFaction,
  newPlace,
  newRegion,
  normalizeDraft,
  parseHelpReply,
  type WizardDraft,
} from '../lib/rpg/wizard';

/** A story built entirely by hand, the way the wizard screens fill a draft. */
function handMadeDraft(): WizardDraft {
  let draft = emptyDraft();
  const quarter = { ...newRegion(), name: 'The French Quarter', description: 'Jazz clubs and narrow streets.', climate: 'rainy' as const };
  const uptown = { ...newRegion(), name: 'Uptown', description: 'Old money and big houses.' };
  quarter.neighbours = [{ id: uptown.id, days: 0.1 }];
  const club = { ...newPlace(quarter.id), name: 'The Blue Room', description: 'A speakeasy behind a barber shop.' };
  const mansion = { ...newPlace(uptown.id), name: 'Delacroix House', kind: 'structure' as const, description: 'A white mansion.' };
  const family = { ...newFaction(), name: 'The Delacroix family', description: 'Sugar money.', territoryRegionIds: [uptown.id] };
  const police = { ...newFaction(), name: 'City police', description: 'On the take.', hasBounties: true };

  return {
    ...draft,
    slotName: 'Blue Room nights',
    world: {
      ...draft.world,
      name: 'New Orleans, 1925',
      premise: 'Prohibition-era New Orleans, where everyone drinks and nobody admits it.',
      regions: [quarter, uptown],
      places: [club, mansion],
      factions: [family, police],
    },
    character: {
      ...draft.character,
      name: 'Celeste Moreau',
      aliases: ['Cece'],
      age: 26,
      gender: 'female',
      role: 'Singer at the Blue Room',
      appearance: 'Tall, dark curls, a gap-toothed smile.',
      outfit: 'A green beaded dress.',
      backstory: 'Came down from Chicago with a suitcase and a stolen name.\n\nShe sings four nights a week.',
      inventory: ['Lipstick', 'A pearl-handled knife'],
      money: 40,
      secrets: ['Celeste Moreau is not your real name.'],
      goals: ['Pay back what you owe Vincent.'],
    },
    truths: [{ text: 'You owe Vincent Duval two hundred dollars.', knownBy: ['you', 'Vincent Duval'] }],
    people: [
      {
        ...emptyPerson(),
        name: 'Vincent Duval',
        age: 38,
        gender: 'male',
        role: 'Owns the Blue Room',
        appearance: 'Silver at the temples, rings on every finger.',
        relationship: 'acquaintance',
        theirFeelings: { affinity: 2, note: 'You are his best singer and his biggest debt.' },
        yourFeelings: { affinity: -1, note: 'You do not trust him.' },
      },
      { ...emptyPerson(), name: 'Rose', gender: 'female', role: 'Pianist', relationship: 'close', age: 30 },
      { ...emptyPerson(), name: 'Old Jack', role: 'Doorman', alive: false, relationship: 'friendly' },
    ],
    opening: {
      location: 'The Blue Room',
      date: { year: 1925, month: 10, day: 2, hour: 23, minute: 30 },
      situation: 'The last set is over. Vincent waves you over to his booth.',
      castNames: ['Vincent Duval', 'Rose', 'Somebody not in the list'],
      threads: ['Pay back what you owe Vincent.', 'Find out who killed Old Jack'],
    },
  };
}

describe('creation wizard', () => {
  test('only name, premise, character name and opening situation are required', () => {
    const missing = missingFields(emptyDraft()).map((item) => `${item.step}.${item.field}`);
    expect(missing).toEqual(['world.name', 'world.premise', 'you.name', 'opening.situation']);
    expect(missingFields(handMadeDraft())).toEqual([]);
  });

  test('a hand-made draft becomes a playable save, with nothing added', () => {
    const input = draftToSeedInput(handMadeDraft());
    // Readable ids, remapped everywhere they are used.
    expect(input.world.regions.map((region) => region.id)).toEqual(['the-french-quarter', 'uptown']);
    expect(input.world.regions[0].neighbours).toEqual([{ id: 'uptown', days: 0.1 }]);
    expect(input.world.places.map((place) => [place.id, place.regionId])).toEqual([
      ['the-blue-room', 'the-french-quarter'],
      ['delacroix-house', 'uptown'],
    ]);
    expect(input.world.factions[0].territoryRegionIds).toEqual(['uptown']);
    expect(input.opening.placeId).toBe('the-blue-room');
    // Unknown cast names are dropped.
    expect(input.opening.castNames).toEqual(['Vincent Duval', 'Rose']);
    // The backstory stays exactly as written.
    expect(input.character.backstory).toBe(handMadeDraft().character.backstory);

    const db = normalizeDatabase(seedDatabase('slot_wizard', 'Blue Room nights', input));
    expect(playerName(db)).toBe('Celeste Moreau');
    expect(db.world.name).toBe('New Orleans, 1925');
    expect(db.state.inStoryDate).toMatchObject({ year: 1925, month: 10, day: 2, hour: 23, minute: 30 });
    expect(db.state.location).toBe('The Blue Room');
    expect(db.state.purse?.amount).toBe(40);
    expect(db.state.inventory).toEqual(['Lipstick', 'A pearl-handled knife']);

    const names = db.entities.filter((entity) => entity.type === 'character').map((entity) => entity.name);
    expect(names).toEqual(expect.arrayContaining(['Celeste Moreau', 'Vincent Duval', 'Rose', 'Old Jack']));
    expect(db.entities.find((entity) => entity.name === 'Old Jack')?.deceased).toBeDefined();
    expect(db.bonds.find((bond) => bond.characterName === 'Vincent Duval')?.affinity).toBe(2);
    expect(db.facts.some((fact) => fact.text.includes('two hundred dollars'))).toBe(true);
    expect(db.threads.map((thread) => thread.title)).toEqual(expect.arrayContaining(['Pay back what you owe Vincent', 'Find out who killed Old Jack']));
    expect(db.state.sceneCast).toEqual(expect.arrayContaining(['Vincent Duval', 'Rose']));

    const narrator = buildNarrationPrompt(db, '"Evening, Vincent."').messages.map((message) => message.content).join('\n');
    expect(narrator).toContain('New Orleans, 1925');
    expect(narrator).toContain('Came down from Chicago with a suitcase and a stolen name.');
    expect(narrator).toContain('The Delacroix family');
    const tracker = buildExtractionPrompt(db, 'Hi.', 'Vincent nods.').messages.map((message) => message.content).join('\n');
    expect(tracker).toContain('the-french-quarter (The French Quarter)');
    expect(tracker).toContain('city-police (City police)');
  });

  test('help only fills empty fields and adds new items', () => {
    const draft = handMadeDraft();
    const filled = applySuggestion(draft, 'you', { appearance: 'Short and blonde.', personality: 'Bold and funny.', inventory: ['A gun'] });
    expect(filled.character.appearance).toBe(draft.character.appearance);
    expect(filled.character.personality).toBe('Bold and funny.');
    expect(filled.character.inventory).toEqual(draft.character.inventory);

    const people = applySuggestion(draft, 'people', {
      people: [
        { name: 'Rose', role: 'Someone else' },
        { name: 'Marcel Fontaine', age: 41, role: 'Detective' },
        { name: 'Too Young', age: 15, role: 'Paper boy' },
      ],
    });
    expect(people.people.map((person) => person.name)).toEqual(['Vincent Duval', 'Rose', 'Old Jack', 'Marcel Fontaine', 'Too Young']);
    expect(people.people.find((person) => person.name === 'Rose')?.role).toBe('Pianist');
    // A suggested age under 18 is never kept.
    expect(people.people.find((person) => person.name === 'Too Young')?.age).toBeUndefined();

    const places = applySuggestion(draft, 'places', { places: [{ name: 'Canal Street', region: 'Uptown', kind: 'road' }] });
    const street = places.world.places.find((place) => place.name === 'Canal Street')!;
    expect(street.kind).toBe('road');
    expect(street.regionId).toBe(draft.world.regions[1].id);
  });

  test('help asks for adults and a grounded world, as JSON', () => {
    const [system] = helpFillMessages('people', handMadeDraft());
    expect(system.content).toContain('18 or older');
    expect(system.content).toContain('no magic');
    expect(parseHelpReply('Sure! {"tone": "smoky"} hope that helps')).toEqual({ tone: 'smoky' });
    expect(parseHelpReply('no json here')).toBeNull();
  });

  test('anyone with an intimacy section needs a stated adult age, and the profile reaches the save', () => {
    const draft = handMadeDraft();
    const withIntimacy: WizardDraft = {
      ...draft,
      content: { ...draft.content, pacing: 'slow-burn', interests: [{ label: 'slow dancing', weight: 'love' }], limits: [] },
      people: draft.people.map((person) =>
        person.name === 'Rose'
          ? { ...person, age: undefined, intimacy: { orientation: 'women', interestedInPlayer: 'yes' as const, desires: [], boundaries: [] } }
          : person.name === 'Vincent Duval'
            ? { ...person, intimacy: { orientation: 'women', interestedInPlayer: 'could-grow' as const, desires: [], boundaries: ['being rushed'] } }
            : person
      ),
    };
    expect(missingFields(withIntimacy).map((item) => item.message)).toEqual([
      'Rose has no stated age: give an age of 18 or older, or remove their intimacy section.',
    ]);
    const input = draftToSeedInput(withIntimacy);
    expect(input.people.find((person) => person.name === 'Rose')?.intimacy).toBeUndefined();
    expect(input.content?.pacing).toBe('slow-burn');
    const db = seedDatabase('slot_wizard_intimacy', 'x', input);
    expect(db.content.interests[0].label).toBe('slow dancing');
    expect(db.entities.find((entity) => entity.name === 'Vincent Duval')?.intimacy?.boundaries).toEqual(['being rushed']);
  });

  test('a saved draft survives a reload, even half-broken', () => {
    const round = normalizeDraft(JSON.parse(JSON.stringify(handMadeDraft())))!;
    expect(round.character.name).toBe('Celeste Moreau');
    expect(round.world.regions).toHaveLength(2);
    const broken = normalizeDraft({ step: 'nowhere', people: 'x' })!;
    expect(broken.step).toBe('world');
    expect(broken.people).toEqual([]);
  });
});

describe('nothing built in', () => {
  test('a save without input is blank: no people, places, lore or story', async () => {
    const { seedDatabase: seedApp } = await import('../lib/rpg/seed');
    const db = seedApp('blank', 'Blank');
    expect(db.entities.filter((entity) => entity.type === 'character' && !entity.tags.includes('player'))).toHaveLength(0);
    expect(db.world.places).toHaveLength(0);
    expect(db.world.lore).toHaveLength(0);
    expect(db.loreEntries).toHaveLength(0);
    expect(db.bonds).toHaveLength(0);
    expect(db.state.player.name).toBe('');
  });
});
