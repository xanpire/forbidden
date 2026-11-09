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

import { ambienceInputOf, currentAmbience, isIndoors } from '../lib/rpg/ambience';
import { dateSortValue, shiftDate } from '../lib/rpg/calendar';
import { consequenceOffer, seedsOf } from '../lib/rpg/consequences';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { formatLetterOffer } from '../lib/rpg/letters';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import {
  activeSafehouses,
  currentSafehouse,
  formatSafehouseLine,
  formerSafehouses,
  headingTo,
  isOvergrown,
  kindLabel,
  letterAddress,
  normalizeSafehouses,
  placesLine,
  rentedUntil,
} from '../lib/rpg/safehouses';
import { seedDatabase } from '../lib/rpg/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase, CalendarDate } from '../lib/rpg/types';

const NOW: CalendarDate = { year: 2026, month: 7, day: 10, hour: 21, minute: 0, second: 0 };

function save(change: Partial<AppDatabase['state']> = {}): AppDatabase {
  let db = normalizeDatabase(seedDatabase('slot_safehouses', 'Safehouses'));

  for (let index = 0; index < 4; index += 1) {
    db = appendStoryMessage(db, 'user', `*You walk on.* ${index}`, null, 0, 0);
    db = appendStoryMessage(db, 'assistant', `The road goes on. ${index}`, null, 0, 0);
  }

  return {
    ...db,
    state: {
      ...db.state,
      inStoryDate: NOW,
      location: 'a hidden cave above the falls in the hills of Northgate',
      locationKind: 'wilderness',
      scenePace: 'downtime',
      sceneCast: [],
      ...change,
    },
  };
}

function play(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const converted = convertStateBlock(block).diff;
  const diff = converted ? resolveCharacterRefs(next, converted) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()).db;
}

const night = { time: { elapsed: 8, unit: 'hours', clock_time: null }, scene_pace: 'downtime' };
const minutes = (count: number) => ({ time: { elapsed: count, unit: 'minutes', clock_time: null }, scene_pace: 'downtime' });
const days = (count: number) => ({ time: { elapsed: count, unit: 'days', clock_time: null }, scene_pace: 'travel' });

const emptySafehouse = {
  id: null, name: null, kind: null, paid_nights: null, host: null, stored: [], taken: [], upgrade: null,
  shown_to: [], residents_joined: [], residents_left: [], ended: null,
};

/** The player belongs to Marlow & Finch (a membership fact). */
const member = (db: AppDatabase): AppDatabase => joined(db, 'You work for Marlow & Finch.');

/** A membership fact about the player, newest. */
const joined = (db: AppDatabase, text: string): AppDatabase => {
  const you = db.entities.find((entity) => entity.tags.includes('player'))!;
  return {
    ...db,
    facts: [
      ...db.facts,
      { ...db.facts[0], id: `fact_${text.length}_${db.facts.length}`, subjectEntityId: you.id, type: 'membership', text, validFrom: db.state.inStoryDate, validTo: null },
    ],
  };
};

const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;

/** The player settles in a cave of their own, with Mara there. */
function settled() {
  const db = save({ sceneCast: ['Mara Vance'] });
  return play(db, '*You clear the cave and lay out your bedroll.*', 'You sweep the stones aside. Mara watches the falls while you sleep. By morning the cave feels like yours.', {
    ...night,
    characters_present: ['mara-vance'],
    safehouse: { ...emptySafehouse, name: 'the cave above the falls', kind: 'own' },
  });
}

describe('becoming a safehouse', () => {
  test('the schema and the tracker prompt carry the field and the list', () => {
    const props = (TURN_STATE_SCHEMA as { properties: Record<string, { properties?: Record<string, unknown> }> }).properties;
    expect(props.safehouse).toBeDefined();
    expect(Object.keys(props.safehouse.properties ?? {})).toContain('shown_to');

    const db = settled();
    const tracker = buildExtractionPrompt(db, '*You wake.*', 'Morning light in the falls.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('SAFEHOUSES');
    expect(tracker).toContain('the cave above the falls (own;');
    expect(tracker).toContain('[you are here]');
  });

  test('the tracker tags a place: named, kind, who knows, you are there', () => {
    const db = settled();
    const house = currentSafehouse(db)!;
    expect(house.name).toBe('the cave above the falls');
    expect(house.kind).toBe('own');
    expect(house.region).toBe('northgate');
    expect(house.nights).toBe(1);
    expect(house.knownBy).toContain(person(db, 'Mara Vance').id);
  });

  test('a night at an inn with no tag becomes a rented room, paid for one night', () => {
    const db = save({ location: 'a roadside inn in Old Town', locationKind: 'structure' });
    const next = play(db, '*You take a room and sleep.*', 'You sleep until the cocks crow.', night);
    const house = currentSafehouse(next)!;
    expect(house.kind).toBe('rented');
    expect(house.knownGroups).toContain('the landlord');
    expect(house.until).toEqual(rentedUntil(NOW, 1));
    expect(house.until!.day).toBe(11);
    expect(house.until!.hour).toBe(10);
  });

  test('a rented room runs out once you are gone and the paid time passes; staying on pays again', () => {
    let db = save({ location: 'a room at the Harbour Inn', locationKind: 'structure' });
    db = play(db, '*You pay for three nights.*', 'The innkeeper takes your coins for three nights.', {
      ...minutes(10),
      safehouse: { ...emptySafehouse, name: 'a room at the Harbour Inn', kind: 'rented', paid_nights: 3 },
    });
    const id = currentSafehouse(db)!.id;
    expect(currentSafehouse(db)!.until!.day).toBe(13);

    db = play(db, '*You pay two more nights.*', 'You hand over more coins.', { ...minutes(5), safehouse: { ...emptySafehouse, id, paid_nights: 2 } });
    expect(currentSafehouse(db)!.until!.day).toBe(15);

    db = play(db, '*You leave town.*', 'You take the north road for a day.', { ...days(1), location: 'the north road out of Old Town', location_kind: 'road' });
    expect(activeSafehouses(db).find((house) => house.id === id)).toBeDefined();

    db = { ...db, state: { ...db.state, inStoryDate: shiftDate(db.state.inStoryDate, 5) } };
    db = play(db, '*You walk on.*', 'The pass climbs.', { ...minutes(30), location: 'a mountain pass in the north hills', location_kind: 'road' });
    const former = formerSafehouses(db).find((house) => house.id === id)!;
    expect(former.ended?.reason).toBe('expired');
  });

  test('a camp is gone when you leave it, and becomes his own if he comes back', () => {
    let db = save({ location: 'a clearing in the woods near Northgate', locationKind: 'wilderness' });
    db = play(db, '*You sleep under the trees.*', 'You sleep under the stars.', night);
    const camp = currentSafehouse(db)!;
    expect(camp.kind).toBe('camp');

    db = play(db, '*You move on.*', 'You walk for an hour.', { time: { elapsed: 1, unit: 'hours', clock_time: null }, scene_pace: 'travel', location: 'the road to Old Town', location_kind: 'road' });
    expect(formerSafehouses(db).find((house) => house.id === camp.id)?.ended?.reason).toBe('left');

    db = play(db, '*You go back to the clearing.*', 'You return and sleep there again.', { ...night, location: 'a clearing in the woods near Northgate', location_kind: 'wilderness' });
    const back = currentSafehouse(db)!;
    expect(back.id).toBe(camp.id);
    expect(back.kind).toBe('own');
  });

  test('"camp" means a night in the wild only when it is one: a company camp is a base', () => {
    const sleepAt = (location: string, locationKind: AppDatabase['state']['locationKind'], scene = 'A night') =>
      currentSafehouse(play(save({ location, locationKind, scene }), '*You sleep.*', 'You sleep.', night));

    const company = currentSafehouse(play(member(save({ location: 'the Marlow & Finch company camp up the coast', locationKind: 'settlement' })), '*You sleep.*', 'You sleep.', night))!;
    expect(company.kind).toBe('base');
    expect(company.knownGroups).toContain('Marlow & Finch');


    // Not his: a guess makes nothing (a prisoner? sneaking in?).
    expect(sleepAt('the Vance family compound in Northgate', 'settlement')).toBeNull();

    // A camp of strangers is still a night among them, gone when he leaves.
    expect(sleepAt('a refugee camp on the edge of town', 'settlement')!.kind).toBe('camp');
    expect(sleepAt('a merchant caravan camp on the road', 'road')!.kind).toBe('camp');
    // A camp by a river in the wild is a camp.
    expect(sleepAt('a camp by the river', 'wilderness')!.kind).toBe('camp');
    // "Camp" alone in a village or a building makes nothing by itself.
    expect(sleepAt('the old camp office in Old Town', 'settlement')).toBeNull();
    // Ruins still make camps.
    expect(sleepAt('the ruins of a watchtower', 'structure')!.kind).toBe('camp');
  });

  test('a base is only his while he belongs; a guest is borrowed; leaving ends it', () => {
    // The story says he stays at a family compound he doesn't belong to: a guest.
    let guest = save({ location: 'the Vance family compound in Northgate', locationKind: 'settlement' });
    guest = play(guest, '*You sleep.*', 'They let you sleep in the guest wing.', { ...night, safehouse: { ...emptySafehouse, name: 'the guest wing of the Vance compound', kind: 'base' } });
    const tent = currentSafehouse(guest)!;
    expect(tent.kind).toBe('borrowed');
    expect(tent.hostName).toBe('The Vance family');
    expect(kindLabel(tent)).toBe('a guest of The Vance family');

    // A family compound is his while he travels with one of the family.
    let early = save({ location: 'the Vance family compound in Northgate', locationKind: 'structure', sceneCast: ['Mara Vance'] });
    early = { ...early, entities: early.entities.map((entity) => (entity.name === 'Mara Vance' ? { ...entity, tags: [...entity.tags, 'vance-family'], companion: { since: NOW, sharedScenes: 0, bondPoints: 0 } } : entity)) };
    early = play(early, '*You sleep.*', 'You sleep in the hideout.', { ...night, characters_present: ['mara-vance'] });
    expect(currentSafehouse(early)!.kind).toBe('base');

    // Someone who quits the company loses his room once he's gone from it.
    let db = member(save({ location: 'the Marlow & Finch headquarters at the docks', locationKind: 'structure' }));
    db = play(db, '*You sleep.*', 'You sleep.', night);
    const room = currentSafehouse(db)!;
    expect(room.kind).toBe('base');
    db = joined(db, 'You quit Marlow & Finch for good.');
    db = play(db, '*You leave.*', 'You walk out into the rain for a day.', { ...days(1), location: 'the road along the coast', location_kind: 'road' });
    const gone = formerSafehouses(db).find((house) => house.id === room.id)!;
    expect(gone.ended?.reason).toBe('withdrawn');
    expect(gone.ended?.note).toContain('no longer belong to Marlow & Finch');
  });

  test('no safehouse in a fight', () => {
    const db = save();
    const next = play(db, '*You strike.*', 'Steel rings.', {
      time: { elapsed: 10, unit: 'seconds', clock_time: null },
      scene_pace: 'combat',
      safehouse: { ...emptySafehouse, name: 'the ford', kind: 'camp' },
    });
    expect(activeSafehouses(next)).toHaveLength(0);
  });
});

describe('what a safehouse holds', () => {
  test('a stash: items leave the inventory and come back', () => {
    let db = settled();
    db = { ...db, state: { ...db.state, inventory: [...db.state.inventory, 'Folder of shipping manifests'] } };
    const id = currentSafehouse(db)!.id;

    db = play(db, '*You hide the folder under a stone.*', 'You tuck the folder away.', { ...minutes(5), safehouse: { ...emptySafehouse, id, stored: ['folder of shipping manifests'] } });
    expect(db.state.inventory).not.toContain('Folder of shipping manifests');
    expect(currentSafehouse(db)!.stash).toEqual(['Folder of shipping manifests']);

    const narrator = buildNarrationPrompt(db, '*You look around.*').messages.map((m) => m.content).join('\n');
    expect(narrator).toContain('SAFEHOUSE (where you are): the cave above the falls');
    expect(narrator).toContain('Stashed here: Folder of shipping manifests');
    expect(narrator).toContain('Who knows of it: Mara Vance');

    db = play(db, '*You take the folder back.*', 'You lift the stone.', { ...minutes(2), safehouse: { ...emptySafehouse, id, taken: ['the shipping manifests folder'] } });
    expect(currentSafehouse(db)!.stash).toEqual([]);
    expect(db.state.inventory).toContain('Folder of shipping manifests');
  });

  test('upgrades come from the story; a camp set up properly becomes his own', () => {
    let db = save({ location: 'a clearing in the woods near Northgate', locationKind: 'wilderness' });
    db = play(db, '*You sleep.*', 'You sleep.', night);
    const id = currentSafehouse(db)!.id;
    db = play(db, '*You rig a tarp and dig a firepit.*', 'Over the day you rig a tarp and dig a proper firepit.', {
      time: { elapsed: 6, unit: 'hours', clock_time: null },
      scene_pace: 'downtime',
      safehouse: { ...emptySafehouse, id, upgrade: 'a tarp and a firepit' },
    });
    const house = currentSafehouse(db)!;
    expect(house.kind).toBe('own');
    expect(house.upgrades.map((item) => item.name)).toEqual(['a tarp and a firepit']);
  });

  test('a night somewhere safe heals wounds faster', () => {
    let db = settled();
    db = play(db, '*You bind the cut.*', 'The cut on your arm is deep.', {
      ...minutes(5),
      facts: [{ entity: 'player', fact: 'You have a deep cut on your arm.', type: 'injury', who_knows: ['player'], supersedes: [], claimed_by: null, lasts: 'days', days: 3 }],
    });
    const wound = db.facts.find((fact) => fact.text.includes('deep cut'))!;
    expect(wound.validTo).toBeNull();

    db = play(db, '*You sleep.*', 'You sleep through the night.', night);
    const healed = db.facts.find((fact) => fact.id === wound.id)!;
    // 3 days, minus 8 hours slept, minus 2 days of safe rest: still a few hours left.
    expect(dateSortValue(healed.expiresAt!)).toBeLessThan(dateSortValue(wound.expiresAt!));
    db = play(db, '*You sleep again.*', 'Another full night.', night);
    expect(db.facts.find((fact) => fact.id === wound.id)!.validTo).not.toBeNull();
  });

  test('residents: someone living there is there while you are away', () => {
    let db = settled();
    db = { ...db, entities: db.entities.map((entity) => (entity.name === 'Daniel Okafor' ? { ...entity, whereabouts: undefined } : entity)) };
    const id = currentSafehouse(db)!.id;
    db = play(db, '*"Stay here, Daniel."*', 'Daniel nods and unrolls a sleeping bag.', {
      ...minutes(3),
      new_characters: [],
      safehouse: { ...emptySafehouse, id, residents_joined: ['daniel-okafor'] },
    });
    const daniel = person(db, 'Daniel Okafor');
    expect(currentSafehouse(db)!.residents).toContain(daniel.id);

    db = play(db, '*You leave for the docks.*', 'Two days down at the docks.', { ...days(2), location: 'The Docks', location_kind: 'settlement' });
    expect(person(db, 'Daniel Okafor').whereabouts).toContain('the cave above the falls');
  });
});

describe('the narrator', () => {
  test('nothing about safehouses on a quiet turn with none', () => {
    const db = save({ location: 'the road to Old Town', locationKind: 'road' });
    const narrator = buildNarrationPrompt(db, '*You walk.*').messages.map((m) => m.content).join('\n');
    expect(narrator).not.toContain('SAFEHOUSE');
    expect(narrator).not.toContain('Places you can go back to');
  });

  test('away: CURRENT STATE names the places he can go back to; heading there gets the line', () => {
    let db = settled();
    db = play(db, '*You leave.*', 'You travel a day east.', { ...days(1), location: 'the road along the coast', location_kind: 'road' });
    expect(currentSafehouse(db)).toBeNull();
    expect(placesLine(db)).toContain('the cave above the falls (Northgate)');

    expect(headingTo(db, '*You head back to the cave above the falls.*')?.name).toBe('the cave above the falls');
    expect(headingTo(db, '*You go back to the safehouse.*')?.name).toBe('the cave above the falls');
    expect(headingTo(db, '*You look at the sky.*')).toBeNull();
    expect(formatSafehouseLine(db, '*You head back to the cave above the falls.*')).toContain('SAFEHOUSE (where you are heading)');
  });

  test('a place not visited in years is overgrown', () => {
    let db = settled();
    db = play(db, '*You leave.*', 'You travel a day.', { ...days(1), location: 'the road along the coast', location_kind: 'road' });
    const house = activeSafehouses(db)[0];
    const later = { ...db, state: { ...db.state, inStoryDate: shiftDate(db.state.inStoryDate, 800) } };
    expect(isOvergrown(later, house)).toBe(true);
  });

  test('a letter from someone who knows the place can wait there', () => {
    const db = settled();
    const mara = person(db, 'Mara Vance');
    expect(letterAddress(db, mara.id)?.name).toBe('the cave above the falls');
    const line = formatLetterOffer(
      { kind: 'unprompted', entity: mara, bond: null, carrier: 'text message', daysWaiting: 0 },
      'the cave above the falls'
    );
    expect(line).toContain('waiting for you at the cave above the falls');
  });
});

describe('being found', () => {
  test('a detective who sees it: a found seed, offered when you are there, and the place is compromised', () => {
    let db = settled();
    const id = currentSafehouse(db)!.id;
    db = play(db, '*You see a figure on the ridge.*', 'A man in a raincoat watches you from the ridge, then is gone.', {
      ...minutes(2),
      safehouse: { ...emptySafehouse, id, shown_to: ['Detective Hale'] },
    });
    const seed = seedsOf(db).find((item) => item.kind === 'found')!;
    expect(seed.safehouseId).toBe(id);
    expect(seed.faction).toBe('vance-family');

    // Weeks later, at the cave.
    // Long past its time, so it is pressed every fitting turn.
    const later = { ...db, state: { ...db.state, inStoryDate: shiftDate(seed.after, 91) } };
    expect(consequenceOffer(later)?.id).toBe(seed.id);

    const struck = play(later, '*You wake to a sound.*', 'Police cars ring the hillside.', { ...minutes(1), consequences_returned: [seed.id] });
    expect(currentSafehouse(struck)!.compromised?.by).toBe('Detective Hale');
    expect(formatSafehouseLine(struck, '*You wait.*')).toContain('Sleeping here is a risk now');
  });

  test('away when they come: the stash is searched, and you only see it once you are back', () => {
    let db = settled();
    const id = currentSafehouse(db)!.id;
    db = { ...db, state: { ...db.state, inventory: [...db.state.inventory, 'Envelope of cash'] } };
    db = play(db, '*You hide the envelope and leave.*', 'You hide the envelope. A police officer sees you go.', {
      ...minutes(5),
      safehouse: { ...emptySafehouse, id, stored: ['Envelope of cash'], shown_to: ['a police officer'] },
    });
    expect(seedsOf(db).some((seed) => seed.kind === 'found' && seed.safehouseId === id)).toBe(true);

    db = play(db, '*You leave.*', 'You travel south.', { ...days(1), location: 'a road along the coast', location_kind: 'road' });
    const seed = seedsOf(db).find((item) => item.kind === 'found' && item.safehouseId === id)!;
    db = { ...db, state: { ...db.state, inStoryDate: shiftDate(seed.after, 10) } };
    db = play(db, '*You wait out the season.*', 'The boats come in.', { ...minutes(30), location: 'a fishing town down the coast', location_kind: 'settlement' });
    const raided = activeSafehouses(db).find((house) => house.id === id)!;
    expect(raided.stash).toEqual([]);
    expect(raided.raided?.lost).toEqual(['Envelope of cash']);
    expect(raided.raided?.seen).toBe(false);

    db = play(db, '*You go back to the cave above the falls.*', 'You climb up to the cave after three days.', {
      ...days(3),
      location: 'the cave above the falls in the hills of Northgate',
      location_kind: 'wilderness',
      safehouse: { ...emptySafehouse, id },
    });
    expect(currentSafehouse(db)!.raided?.seen).toBe(true);
    expect(formatSafehouseLine(db, '*You look around.*')).toContain('someone searched it');
  });

  test('a compromised place: you may not sleep, so "until rest" conditions stay', () => {
    let db = settled();
    const id = currentSafehouse(db)!.id;
    db = play(db, '*You sit.*', 'You are exhausted.', {
      ...minutes(5),
      facts: [{ entity: 'player', fact: 'You are bone-tired.', type: 'condition', who_knows: ['player'], supersedes: [], claimed_by: null, lasts: 'until_rest', days: null }],
      safehouse: { ...emptySafehouse, id },
    });
    db = {
      ...db,
      state: {
        ...db.state,
        safehouses: { ...db.state.safehouses!, places: db.state.safehouses!.places.map((house) => (house.id === id ? { ...house, compromised: { on: NOW, by: 'the police' } } : house)) },
      },
    };
    db = play(db, '*You try to sleep.*', 'You lie awake all night.', night);
    expect(db.facts.find((fact) => fact.text.includes('bone-tired'))!.validTo).toBeNull();
  });

  test('a faction learning of a private place is a found seed; its own base is not', () => {
    // The company wants the player: it keeps a wanted list and has them on it.
    const wanted = (save: AppDatabase): AppDatabase => ({
      ...save,
      world: { ...save.world, factions: save.world.factions.map((faction) => (faction.id === 'marlow-finch' ? { ...faction, hasBounties: true } : faction)) },
      state: { ...save.state, reputation: { factions: { 'marlow-finch': { heat: 80, listedOn: NOW, known: true } }, recent: [] } },
    });
    let db = wanted(settled());
    const id = currentSafehouse(db)!.id;
    db = play(db, '*You see a security guard by the path.*', 'A Marlow & Finch security guard sees your cave.', { ...minutes(2), safehouse: { ...emptySafehouse, id, shown_to: ['Marlow & Finch security'] } });
    expect(seedsOf(db).find((seed) => seed.kind === 'found')?.faction).toBe('marlow-finch');

    let base = member(save({ location: 'the Marlow & Finch headquarters at the docks', locationKind: 'structure', scene: 'Arriving at headquarters' }));
    base = play(base, '*You sleep.*', 'You sleep on the couch in the staff room.', { ...night, safehouse: { ...emptySafehouse, name: 'the staff room at headquarters', kind: 'base' } });
    expect(currentSafehouse(base)!.knownGroups).toContain('Marlow & Finch');
    base = play(base, '*A guard passes.*', 'A security guard passes your door.', { ...minutes(1), safehouse: { ...emptySafehouse, shown_to: ['Marlow & Finch security'] } });
    expect(seedsOf(base).some((seed) => seed.kind === 'found')).toBe(false);
  });

  test('a borrowed place ends when you know the host died', () => {
    let db = save({ location: "Mara's spare room in Old Town", locationKind: 'structure', sceneCast: ['Mara Vance'] });
    db = play(db, '*You sleep in the spare room.*', 'Mara lets you sleep in her spare room.', {
      ...night,
      characters_present: ['mara-vance'],
      safehouse: { ...emptySafehouse, name: "Mara's spare room", kind: 'borrowed', host: 'mara-vance' },
    });
    const house = currentSafehouse(db)!;
    expect(house.hostName).toBe('Mara Vance');
    db = play(db, '*You leave.*', 'You slip out before dawn.', { ...days(1), location: 'the road along the coast', location_kind: 'road' });
    db = play(db, '*You read the news.*', 'A text tells you Mara Vance is dead.', { ...minutes(5), deaths: [{ character_id: 'mara-vance', cause: 'a car crash' }] });
    expect(formerSafehouses(db).find((item) => item.id === house.id)?.ended?.reason).toBe('withdrawn');
  });
});

describe('around it', () => {
  test('ambience: his own place has walls; a camp has none and a fire at night', () => {
    const db = settled();
    const input = ambienceInputOf(db);
    expect(input.shelter).toBe('own');
    expect(isIndoors(input)).toBe(true);
    expect(currentAmbience(db).beds.cave).toBeGreaterThan(0);

    let camp = save({ location: 'a clearing in the woods near Northgate', locationKind: 'wilderness' });
    camp = play(camp, '*You sleep.*', 'You sleep.', night);
    camp = { ...camp, state: { ...camp.state, inStoryDate: { ...camp.state.inStoryDate, hour: 22 } } };
    expect(isIndoors(ambienceInputOf(camp))).toBe(false);
    expect(currentAmbience(camp).beds.fire).toBeGreaterThan(0);
  });

  test('caves and ruins can be camps, and each sounds like what it is', () => {
    const campAt = (location: string, kind: AppDatabase['state']['locationKind'], hour = 22) => {
      let db = save({ location, locationKind: kind });
      db = play(db, '*You sleep.*', 'You sleep.', night);
      expect(currentSafehouse(db)?.kind).toBe('camp');
      db = { ...db, state: { ...db.state, inStoryDate: { ...db.state.inStoryDate, hour } } };
      return db;
    };
    const rainy = (db: AppDatabase) => ({ ...db, state: { ...db.state, weather: { region: 'old-town', condition: 'rain' as const, since: db.state.inStoryDate, sceneSeq: db.state.sceneSeq, source: 'story' as const } } });

    // A cave: dripping stone, the fire, the rain kept out.
    const cave = rainy(campAt('a shallow cave in the hills above the coast', 'wilderness'));
    const caveMix = currentAmbience(cave);
    expect(caveMix.indoors).toBe(true);
    expect(caveMix.beds.cave).toBeGreaterThan(0);
    expect(caveMix.beds.fire).toBeGreaterThan(0);
    // The rain stays outside the mouth: heard through the indoor filter, never on a roof.
    expect(caveMix.beds['rain-roof'] ?? 0).toBe(0);
    expect(formatSafehouseLine(cave, '*You wait.*')).toContain('Rock overhead');

    // Ruins (untagged, a structure): open to the sky but broken up; rain drips, wind in the gaps, no street.
    const dryRuin = campAt('the ruins of an old chapel on the coast', 'structure');
    const dry = { ...dryRuin, state: { ...dryRuin.state, weather: { region: 'old-town', condition: 'clear' as const, since: dryRuin.state.inStoryDate, sceneSeq: dryRuin.state.sceneSeq, source: 'story' as const } } };
    expect(currentAmbience(dry).beds['wind-light']).toBeGreaterThan(0);
    expect(currentAmbience(dry).beds.village ?? 0).toBe(0);
    const ruin = rainy(dryRuin);
    const ruinMix = currentAmbience(ruin);
    expect(ruinMix.indoors).toBe(false);
    expect(ruinMix.beds['rain-light']).toBeGreaterThan(0);
    expect(ruinMix.beds['rain-roof']).toBeGreaterThan(0);
    expect(ruinMix.beds.fire).toBeGreaterThan(0);
    expect(formatSafehouseLine(ruin, '*You wait.*')).toContain('Half a shelter');

    // An abandoned hut in the woods: walls, a quiet room, rain on the roof.
    let hut = save({ location: 'a woodcutter’s hut in the woods above the coast', locationKind: 'wilderness' });
    hut = play(hut, '*You sleep.*', 'You sleep.', { ...night, safehouse: { ...emptySafehouse, name: 'the woodcutter’s hut', kind: 'camp' } });
    hut = rainy({ ...hut, state: { ...hut.state, inStoryDate: { ...hut.state.inStoryDate, hour: 22 } } });
    const hutMix = currentAmbience(hut);
    expect(hutMix.indoors).toBe(true);
    expect(hutMix.beds['rain-roof']).toBeGreaterThan(0);
    expect(formatSafehouseLine(hut, '*You wait.*')).toContain('Walls of a sort');

    // The open: no roof.
    const open = campAt('a clearing in the woods near Northgate', 'wilderness');
    expect(currentAmbience(open).indoors).toBe(false);
    expect(formatSafehouseLine(open, '*You wait.*')).toContain('No roof');
  });

  test('a flashback never sees the present\'s places', () => {
    const db = settled();
    const inMemory = {
      ...db,
      state: {
        ...db.state,
        flashbacks: {
          played: [],
          offered: {},
          active: { id: 'old-days', date: { year: 2015, month: 9, day: 20, hour: 9, minute: 0 }, place: 'Old Town', locationKind: 'settlement' as const, startedOn: NOW, turns: 0, castIds: [], nudges: {} },
        },
      },
    };
    expect(currentSafehouse(inMemory)).toBeNull();
    expect(formatSafehouseLine(inMemory, '*You look around.*')).toBe('');
    expect(ambienceInputOf(inMemory).shelter).toBeUndefined();
  });

  test('saves keep their places through normalize', () => {
    const db = settled();
    const again = normalizeDatabase(JSON.parse(JSON.stringify(db)));
    expect(again.state.safehouses?.places).toHaveLength(1);
    expect(again.state.safehouses?.current).toBe(db.state.safehouses?.current);
    expect(normalizeSafehouses({ places: [{ id: 'x' }] })).toBeUndefined();
  });
});
