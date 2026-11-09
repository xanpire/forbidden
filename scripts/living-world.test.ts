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

import { shiftDate } from '../lib/rpg/calendar';
import { advanceConsequences, applyConsequences, canReturn, consequenceOffer, plantSeed, seedsOf } from '../lib/rpg/consequences';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { regionOf, travelDaysBetween, whereaboutsRegion } from '../lib/rpg/geography';
import {
  deliverLetters,
  interceptionRisks,
  keepPlayersWords,
  letterArchive,
  letterDays,
  sendLetters,
  tidyLetter,
} from '../lib/rpg/letters';
import { advanceLives, applyLifeEvents, isSideCharacter, markReunions, sinceYouLastSaw } from '../lib/rpg/lives';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { latestPov, parsePovLines, povCandidates, povInstruction, resolvePovs } from '../lib/rpg/povMemories';
import { buildExtractionPrompt, buildNarrationPrompt, buildSceneSummaryPrompt } from '../lib/rpg/prompt';
import { applyEpithet, knownEpithets, recordDeeds, renownOf } from '../lib/rpg/renown';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase, EntityRecord } from '../lib/rpg/types';
import { parseTitledSummary } from '../lib/rpg/util';

const seed = () => normalizeDatabase(seedDatabase('slot_living', 'Living world'));
const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const later = (db: AppDatabase, days: number, extra: Partial<AppDatabase['state']> = {}): AppDatabase => ({
  ...db,
  state: { ...db.state, inStoryDate: shiftDate(db.state.inStoryDate, days), scenePace: 'downtime', ...extra },
});
const update = (db: AppDatabase, name: string, change: Partial<EntityRecord>): AppDatabase => ({
  ...db,
  entities: db.entities.map((entity) => (entity.name === name ? { ...entity, ...change } : entity)),
});
const narratorText = (db: AppDatabase, input = '*You wait.*') =>
  buildNarrationPrompt(db, input).messages.map((message) => message.content).join('\n');
const trackerText = (db: AppDatabase) => buildExtractionPrompt(db, '*You wait.*', 'Nothing happens.').messages[1].content;

function play(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const diff = resolveCharacterRefs(next, convertStateBlock(block).diff);
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set());
}

/** A save in Northgate with nobody around. */
function away(): AppDatabase {
  const base = seed();
  return { ...base, state: { ...base.state, location: 'a café in Northgate', locationKind: 'settlement', sceneCast: [], scenePace: 'downtime' } };
}

describe('geography', () => {
  test('regions from place text, and travel days from the world', () => {
    const db = seed();
    expect(regionOf(db, 'A bar in Old Town')).toBe('old-town');
    expect(regionOf(db, 'the container yard at The Docks')).toBe('the-docks');
    expect(regionOf(db, 'a cave, out of the rain')).toBeNull();
    expect(travelDaysBetween(db, 'old-town', 'the-docks')).toBe(0.1);
    // Northgate to the docks goes through Old Town.
    expect(travelDaysBetween(db, 'northgate', 'the-docks')).toBeCloseTo(0.3);
  });

  test('where someone is: what the story said, else where they were last seen', () => {
    const db = seed();
    expect(whereaboutsRegion(db, person(db, 'Daniel Okafor'))).toBe('the-docks');
    expect(whereaboutsRegion(db, { ...person(db, 'Mara Vance'), whereabouts: 'visiting family in Northgate' })).toBe('northgate');
  });
});

describe('letters and messages', () => {
  test('travel time follows the distance and the carrier; a text is instant', () => {
    const db = seed();
    expect(letterDays(db, 'old-town', 'northgate', 'text message', 'x')).toBe(0);
    expect(letterDays(db, 'old-town', 'northgate', 'pigeon', 'x')).toBeLessThanOrEqual(letterDays(db, 'old-town', 'northgate', 'post', 'x'));
    const unknown = letterDays(db, null, 'old-town', 'post', 'x');
    expect(unknown).toBeGreaterThanOrEqual(3);
    expect(unknown).toBeLessThanOrEqual(9);
  });

  test("the player's own words are kept, only spelling and punctuation tidied", () => {
    expect(tidyLetter('mara , i am fine.i miss the bar')).toBe('Mara, I am fine. I miss the bar.');
    const input = '*I text Mara.* "mara , i am fine and i am sorry i left without a word"';
    expect(keepPlayersWords('Mara, I am fine and I am sorry I left without a word.', input)).toBe('Mara, I am fine and I am sorry I left without a word.');
    expect(keepPlayersWords('My dearest Mara, my heart aches with regret for leaving.', input)).toBe('Mara, I am fine and I am sorry I left without a word.');
  });

  test('a letter to the dead is kept, never sent, and needs no reply', () => {
    let db = away();
    const theo = person(db, 'Theo Marsh');
    db = sendLetters(db, [{ entityId: theo.id, name: theo.name, text: 'I still have your lighter.', carrier: 'post' }], '"I still have your lighter."');
    expect(db.state.post!.letters[0].status).toBe('unsent');
    db = deliverLetters(later(db, 30));
    expect(db.state.post!.letters.some((item) => item.direction === 'to-player')).toBe(false);
    expect(letterArchive(db)[0].label).toBe('To Theo Marsh · never sent');
  });

  test('a faction that reads mail on its own ground can intercept; codes and a hand delivery lower the risk', () => {
    let db = away();
    db = { ...db, world: { ...db.world, factions: db.world.factions.map((faction) => (faction.id === 'vance-family' ? { ...faction, readsMail: 0.8 } : faction)) } };
    const daniel = person(db, 'Daniel Okafor');
    const plain = interceptionRisks(db, daniel, 'post', false);
    expect(plain.find((risk) => risk.who === 'vance-family')?.chance).toBe(24);
    expect(interceptionRisks(db, daniel, 'hand', true).find((risk) => risk.who === 'vance-family')!.chance).toBeLessThan(5);
    // Nobody reads mail where neither end is on their ground.
    const home = { ...db, state: { ...db.state, location: 'The Anchor, Old Town' } };
    expect(interceptionRisks(home, daniel, 'post', false).some((risk) => risk.who === 'vance-family')).toBe(false);
  });

  test('the state block carries the letter words, the carrier, and received letters with text', () => {
    const db = seed();
    const { diff } = convertStateBlock({
      letters_sent: [{ to: 'mara-vance', gist: 'fine', text: 'Mara, I am fine.', carrier: 'text message', coded: false }],
      letters_received: [{ from: 'daniel-okafor', text: 'Call me.' }],
    });
    const resolved = resolveCharacterRefs(db, diff!);
    expect(resolved.lettersSent?.[0]).toMatchObject({ name: 'Mara Vance', text: 'Mara, I am fine.', carrier: 'text message' });
    expect(resolved.lettersReceived?.[0]).toMatchObject({ name: 'Daniel Okafor', text: 'Call me.' });
    expect(trackerText(db)).toContain('ONLY spelling, commas and punctuation corrected');
  });
});

describe('people with their own lives', () => {
  test('the people the player wrote are side characters; someone the timeline follows is not', () => {
    const db = seed();
    expect(isSideCharacter(db, person(db, 'Mara Vance'))).toBe(true);
    const followed = {
      ...db,
      world: {
        ...db.world,
        timeline: [1, 2, 3].map((n) => ({ id: `mara-${n}`, title: `Mara Vance, part ${n}`, description: 'Mara Vance does something big.', from: { year: 2026, month: 11, day: n }, facts: [] })),
      },
    };
    expect(isSideCharacter(followed, person(db, 'Mara Vance'))).toBe(false);
  });

  test('a life moves on while the player is away, the same way every time, unknown until they meet', () => {
    const base = later(away(), 400);
    const db = advanceLives(base);
    const life = person(db, 'Mara Vance').lifeEvents ?? [];
    expect(life.length).toBeGreaterThanOrEqual(1);
    expect(life.every((event) => !event.known)).toBe(true);
    expect(advanceLives(base).entities.find((e) => e.name === 'Mara Vance')!.lifeEvents).toEqual(life);
  });

  test('meeting again after months: the narrator gets a "since you last saw them" note', () => {
    let db = advanceLives(later(away(), 200));
    const before = db;
    db = {
      ...db,
      state: { ...db.state, sceneCast: ['Mara Vance'] },
      entities: db.entities.map((entity) => (entity.name === 'Mara Vance' ? { ...entity, lastSeen: db.state.inStoryDate } : entity)),
    };
    db = markReunions(before, update(db, 'Mara Vance', {}));
    const mara = person(db, 'Mara Vance');
    expect(sinceYouLastSaw(db, mara)).toContain('Since you last saw them');
    expect(narratorText(db, '"Mara."')).toContain('Since you last saw them');
  });

  test('the tracker keeps what the page said about their life', () => {
    let db = seed();
    const { diff } = convertStateBlock({ life_events: [{ character_id: 'mara-vance', event: 'bought out her uncle\'s share of the bar' }] });
    db = applyLifeEvents(db, resolveCharacterRefs(db, diff!).lifeEvents);
    const life = person(db, 'Mara Vance').lifeEvents!;
    expect(life[life.length - 1]).toMatchObject({ text: "bought out her uncle's share of the bar", source: 'story', known: true });
  });
});

describe('what people call you', () => {
  test('a name the story gives the player sticks, and the player knows it', () => {
    let db = later(seed(), 2);
    db = recordDeeds(db, []);
    db = applyEpithet(db, { audience: 'harbour-police', name: 'the Night Clerk' });
    expect(renownOf(db).epithets['harbour-police']).toMatchObject({ name: 'the Night Clerk', theme: 'story', known: true });
    expect(knownEpithets(db).map((item) => item.epithet.name)).toContain('the Night Clerk');
  });

  test('the schema carries epithets, consequences and life events', () => {
    const { diff } = convertStateBlock({ epithet: { audience: 'common', name: 'the Ghost of Kell Street' } });
    expect(diff?.epithet).toEqual({ audience: 'common', name: 'the Ghost of Kell Street' });
    expect(TURN_STATE_SCHEMA.required).toEqual(expect.arrayContaining(['epithet', 'consequences', 'consequences_returned', 'life_events']));
  });
});

describe('delayed consequences', () => {
  test('the tracker plants a seed; it waits, and only comes back where it is realistic', () => {
    let db = { ...seed(), state: { ...seed().state, location: 'Coast Road above Northgate', locationKind: 'road' as const, sceneCast: [] } };
    const { diff } = convertStateBlock({
      consequences: [{ kind: 'spared', character_id: null, who: 'the mugger you let go', what: 'You let the mugger go on Coast Road', want: 'to repay you, or to get even', witnesses: [], faction: null, when: 'weeks' }],
    });
    db = applyConsequences(db, resolveCharacterRefs(db, diff!).consequences, [], null).db;
    const [seedRecord] = seedsOf(db);
    expect(seedRecord).toMatchObject({ kind: 'spared', status: 'waiting', region: 'northgate' });
    expect(canReturn(db, seedRecord)).toBe(false);

    const back = later(db, 60, { locationKind: 'road', scenePace: 'travel' });
    expect(canReturn(back, seedRecord)).toBe(true);
    expect(canReturn({ ...back, state: { ...back.state, locationKind: 'wilderness' } }, seedRecord)).toBe(false);
  });

  test('a lie comes out only face to face', () => {
    let db = seed();
    db = applyConsequences(db, [{ kind: 'lie', entityId: person(db, 'Mara Vance').id, who: 'Mara Vance', what: 'You lied to Mara about where you were', when: 'weeks' }], [], null).db;
    const [lie] = seedsOf(db);
    const apart = later(db, 60, { sceneCast: [] });
    expect(canReturn(apart, lie)).toBe(false);
    expect(canReturn({ ...apart, state: { ...apart.state, sceneCast: ['Mara Vance'] } }, lie)).toBe(true);
  });

  test('a seed fades when its time runs out', () => {
    let db = seed();
    db = plantSeed(db, { kind: 'debt', who: 'a loan shark', what: 'You owe a loan shark', witnesses: [], when: 'weeks' });
    db = advanceConsequences(later(db, 400));
    expect(seedsOf(db)[0].status).toBe('faded');
  });

  test('offered to the narrator softly and marked returned by the tracker', () => {
    let db = { ...seed(), state: { ...seed().state, location: 'Coast Road above Northgate', locationKind: 'road' as const, sceneCast: [] } };
    db = applyConsequences(db, [{ kind: 'spared', who: 'the mugger you let go', what: 'You let the mugger go', when: 'weeks' }], [], null).db;
    db = later(db, 150, { locationKind: 'road', scenePace: 'travel', inStoryDate: { ...shiftDate(db.state.inStoryDate, 150), hour: 13 } });

    let offered = null;
    let probe = db;
    for (let i = 0; i < 12 && !offered; i += 1) {
      probe = appendStoryMessage(probe, 'user', 'walk', null, 0, 0);
      offered = consequenceOffer(probe);
    }
    expect(offered).not.toBeNull();
    expect(narratorText(probe)).toContain('SOMETHING COMES BACK');
    expect(trackerText(probe)).toContain(`consequences_returned ["${offered!.id}"]`);

    const result = play(probe, '*I keep walking.*', 'The mugger steps out of a doorway and holds up his hands.', { consequences_returned: [offered!.id] });
    expect(seedsOf(result.db).find((item) => item.id === offered!.id)?.status).toBe('returned');
    expect(result.notice).toBeNull();
  });
});

describe('memories from their point of view', () => {
  test('the summary asks the people it mattered to for their own line, and reads it back', () => {
    let db = seed();
    db = appendStoryMessage({ ...db, state: { ...db.state, sceneCast: ['Mara Vance'] } }, 'user', '"Lock the door."', null, 0, 0);
    db = appendStoryMessage(db, 'assistant', 'Mara turns the key.', null, 0, 0);
    const mara = person(db, 'Mara Vance');
    const messages = db.rawLog.slice(-2).map((entry) => ({ ...entry, sceneCastIds: [mara.id] }));
    const candidates = povCandidates(db, messages);
    expect(candidates.map((entity) => entity.name)).toContain('Mara Vance');
    expect(povInstruction(candidates)).toContain('POV:');
    expect(buildSceneSummaryPrompt(db, messages).messages[1].content).toContain('POINTS OF VIEW: Mara Vance');

    const parsed = parseTitledSummary(
      'TITLE: Closing time\nMEMORY: Mara locks up with you.\nSUMMARY: Mara locks the bar with you inside.\nPOV:\n- Mara Vance: You stayed. I did not ask you to.\n- Someone: whatever.'
    )!;
    expect(parsed.summary).not.toContain('POV');
    expect(resolvePovs(candidates, parsePovLines(parsed.pov))).toEqual([{ entityId: mara.id, text: 'You stayed. I did not ask you to.' }]);
  });

  test('their latest line sits on their character card for the narrator', () => {
    let db = seed();
    const mara = person(db, 'Mara Vance');
    db = {
      ...db,
      events: [
        ...db.events,
        { id: 'event_pov', chapter: 1, scene: 'Closing', inStoryDate: db.state.inStoryDate, summary: 'Mara locks up.', importance: 4, tags: ['summary'], pinned: false, sourceLogId: null, povs: [{ entityId: mara.id, text: 'You stayed.' }], createdAt: 1 },
      ],
      state: { ...db.state, sceneCast: ['Mara Vance'] },
    };
    expect(latestPov(db, mara.id)).toBe('You stayed.');
    expect(narratorText(db, '"Mara."')).toContain('remembers of you: "You stayed."');
  });
});

describe('prompt size', () => {
  test('nothing extra reaches the narrator on a quiet turn', () => {
    const text = buildNarrationPrompt(seed(), '*You wait.*').messages[1].content;
    for (const block of ['SOMETHING COMES BACK', 'TALK OF YOU', 'WANTED POSTERS', 'Since you last saw them']) {
      expect(text).not.toContain(block);
    }
  });
});
