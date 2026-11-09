// Session 5: the world editor during play and reusable world templates.
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
import { playerName } from '../lib/rpg/player';
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { seedDatabase } from '../lib/rpg/seed';
import { draftToSeedInput, emptyPerson, newFaction, newLore, newPlace, newRegion } from '../lib/rpg/wizard';
import {
  addPersonToSave,
  applyCharacterEdit,
  applyContentEdit,
  applyWorldEdit,
  draftFromSave,
  draftFromTemplate,
  exportTemplate,
  importTemplate,
  templateFromWorld,
} from '../lib/rpg/worldEdit';

const seed = () => normalizeDatabase(seedDatabase('slot_edit', 'Edit'));
const narrator = (db: ReturnType<typeof seed>) => buildNarrationPrompt(db, 'I look around.').messages.map((m) => m.content).join('\n');

describe('world editor during play', () => {
  test('a world edit shows up in the next narrator and tracker prompts, with readable ids', () => {
    const db = seed();
    const draft = draftFromSave(db);
    const harbour = { ...newRegion(), name: 'The Harbour Front', description: 'Ferries and fish markets.', neighbours: [{ id: 'old-town', days: 0.05 }] };
    const pier = { ...newPlace(harbour.id), name: 'Pier Nine', description: 'A late-night bar on stilts.' };
    const union = { ...newFaction(), name: 'The Dockers Union', description: 'Loud, loyal, everywhere.', territoryRegionIds: [harbour.id, 'the-docks'] };
    const lore = { ...newLore(), keywords: ['pier nine'], text: 'Pier Nine never closes before dawn.' };
    const edited = applyWorldEdit(db, {
      ...draft.world,
      premise: 'A rainy port city on the edge of a strike.',
      regions: [...draft.world.regions, harbour],
      places: [...draft.world.places, pier],
      factions: [...draft.world.factions, union],
      lore: [...draft.world.lore, lore],
    });

    expect(edited.world.regions.map((region) => region.id)).toEqual(['old-town', 'the-docks', 'northgate', 'the-harbour-front']);
    expect(edited.world.places.find((place) => place.name === 'Pier Nine')).toMatchObject({ id: 'pier-nine', regionId: 'the-harbour-front' });
    expect(edited.world.factions.find((faction) => faction.name === 'The Dockers Union')?.territoryRegionIds).toEqual(['the-harbour-front', 'the-docks']);
    expect(edited.entities.some((entity) => entity.tags.includes('the-dockers-union'))).toBe(true);
    expect(edited.loreEntries.some((entry) => entry.text === 'Pier Nine never closes before dawn.')).toBe(true);

    const text = narrator(edited);
    expect(text).toContain('A rainy port city on the edge of a strike.');
    expect(text).toContain('The Dockers Union');
    expect(text).toContain('Places: Pier Nine');
    const tracker = buildExtractionPrompt(edited, 'Hi.', 'Rain.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('the-dockers-union (The Dockers Union)');
    expect(tracker).toContain('the-harbour-front (The Harbour Front)');
  });

  test('your own sheet and intimacy settings can be edited mid-story', () => {
    const db = seed();
    const draft = draftFromSave(db);
    const edited = applyContentEdit(
      applyCharacterEdit(db, { ...draft.character, name: 'Alex Moreno', aliases: ['Lex'], personality: 'Restless and funny.', age: 30 }),
      { ...draft.content, pacing: 'slow-burn' }
    );
    expect(playerName(edited)).toBe('Alex Moreno');
    expect(edited.entities.find((entity) => entity.tags.includes('player'))?.aliases).toEqual(['Alex', 'Lex']);
    expect(edited.state.player.birthYear).toBe(1996);
    const text = narrator(edited);
    expect(text).toContain('Name: Alex Moreno');
    expect(text).toContain('Personality: Restless and funny.');
    expect(text).toContain('Slow burn');
  });

  test('a person added by hand gets an entity, and a bond only when you already know them', () => {
    const db = seed();
    const known = addPersonToSave(db, { ...emptyPerson(), name: 'Nadia Cole', age: 33, role: 'Ferry captain', relationship: 'old friend', theirFeelings: { affinity: 6, note: 'Glad you came back.' } });
    expect(known.entities.find((entity) => entity.name === 'Nadia Cole')?.aliases).toEqual(['Nadia']);
    expect(known.bonds.find((bond) => bond.characterName === 'Nadia Cole')).toMatchObject({ affinity: 6, relationship: 'old friend' });
    const stranger = addPersonToSave(db, { ...emptyPerson(), name: 'Victor Hale', met: false });
    expect(stranger.entities.find((entity) => entity.name === 'Victor Hale')?.met).toBe(false);
    expect(stranger.bonds.some((bond) => bond.characterName === 'Victor Hale')).toBe(false);
    expect(addPersonToSave(db, emptyPerson())).toBe(db);
  });
});

describe('world templates', () => {
  test('a template keeps only the world, survives a file round trip, and starts a second character there', async () => {
    const db = seed();
    const template = templateFromWorld(db.world);
    expect(Object.keys(template).sort()).toEqual(['id', 'name', 'savedAt', 'world']);
    expect(JSON.stringify(template)).not.toContain('Alex Reyes');

    const file = exportTemplate(template);
    expect(JSON.parse(file).kind).toBe('frbddn-world');
    const imported = await importTemplate(file);
    expect(imported.world.name).toBe('Harbourside');
    expect(imported.id).not.toBe(template.id);
    await expect(importTemplate('{"nope": true}')).rejects.toThrow('not a world template');

    const draft = draftFromTemplate(imported);
    expect(draft.step).toBe('you');
    const second = seedDatabase('slot_second', 'Second', draftToSeedInput({
      ...draft,
      character: { ...draft.character, name: 'Jo Park', age: 41 },
      opening: { ...draft.opening, location: 'The Anchor', situation: 'Jo walks into The Anchor for the first time.' },
    }));
    expect(second.world.name).toBe('Harbourside');
    expect(second.world.regions.map((region) => region.id)).toEqual(db.world.regions.map((region) => region.id));
    expect(playerName(second)).toBe('Jo Park');
    expect(second.entities.some((entity) => entity.name === 'Mara Vance')).toBe(false);
  });
});
