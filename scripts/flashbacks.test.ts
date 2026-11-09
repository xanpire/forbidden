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

import { DEFAULT_DATE, dateSortValue } from '../lib/rpg/calendar';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { appendStoryMessage, storyMessagesSinceLastSummary } from '../lib/rpg/log';
import { applyStateStep, applySummaryJob, isJobValid, unsummarizedStory } from '../lib/rpg/memoryJobs';
import { buildExtractionPrompt, buildNarrationPrompt, getRecentMessages } from '../lib/rpg/prompt';
import { seedDatabase } from '../lib/rpg/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import { currentAmbience } from '../lib/rpg/ambience';
import { currentWeather, weatherAt } from '../lib/rpg/weather';
import { buildSceneImagePrompt } from '../lib/rpg/image';
import { scrapbook, MEMORY_ERA } from '../lib/rpg/scrapbook';
import { yearlyOffer } from '../lib/rpg/yearly';
import {
  flashbackById,
  FLASHBACK_HARD_CAP,
  REMEMBER_INPUT,
  activeFlashback,
  beginFlashback,
  flashbackDateLine,
  flashbackOffer,
  flashbackView,
  playerAgeAt,
  normalizeFlashbacks,
  rememberChip,
} from '../lib/rpg/flashbacks';
import type { AppDatabase, CalendarDate, FlashbackRecord, TurnDiff } from '../lib/rpg/types';

const NOW: CalendarDate = { year: 2027, month: 3, day: 3, hour: 19, minute: 0, second: 0 };

/** The player's own memories, as session 7 (or the world editor) would add them. */
const MEMORIES: FlashbackRecord[] = [
  {
    id: 'first-shift',
    number: 1,
    title: 'First shift at The Anchor',
    date: { year: 2019, month: 5, day: 10, hour: 21, minute: 0 },
    place: 'The Anchor, Old Town',
    locationKind: 'structure',
    cast: ['Mara Vance', 'Theo Marsh'],
    scene: 'Mara gives you a trial shift behind the bar; Theo drinks for free and heckles you.',
    hint: 'something about the bar, a bottle, Mara pouring a drink',
    triggers: { people: ['Mara Vance'], words: ['first shift', 'behind the bar'] },
    fixed: ['Mara hires you for the summer.'],
    hidden: ['Why Mara left the family business.'],
    memoryLine: 'Mara gave you your first job behind the bar, with Theo heckling.',
    importance: 4,
  },
  {
    id: 'the-last-call',
    number: 2,
    title: 'The last call',
    date: { year: 2025, month: 11, day: 3, hour: 2, minute: 0 },
    place: 'Your flat on Kell Street',
    locationKind: 'structure',
    cast: ['Theo Marsh'],
    scene: 'Theo calls you at two in the morning from the docks; it is the last time you hear his voice.',
    hint: 'a phone ringing late at night',
    triggers: { dates: [{ month: 11, day: 3 }] },
    fixed: ['Theo calls you from the docks.', 'You never see him again.'],
    memoryLine: 'The last phone call with Theo, the night before he died.',
    importance: 5,
  },
  {
    id: 'the-ledger',
    number: 3,
    title: 'The ledger',
    date: { year: 2025, month: 10, day: 20, hour: 18, minute: 0 },
    place: 'Theo\'s locker at the docks',
    locationKind: 'structure',
    cast: ['Theo Marsh'],
    scene: 'Theo shows you a ledger he found in yard 9.',
    hint: 'a ledger, numbers that do not add up',
    triggers: { words: ['ledger', 'yard 9'] },
    fixed: ['Theo found a ledger in yard 9.'],
    requires: ['audit-offer'],
    memoryLine: 'Theo showed you the ledger from yard 9.',
    importance: 5,
  },
];

/** A save some way into the story, in a quiet scene. */
function quietSave(change: Partial<AppDatabase['state']> = {}): AppDatabase {
  let db = normalizeDatabase(seedDatabase('slot_flashbacks', 'Flashbacks'));
  db = { ...db, world: { ...db.world, flashbacks: MEMORIES } };

  for (let index = 0; index < 13; index += 1) {
    db = appendStoryMessage(db, 'user', `*You walk on.* ${index}`, null, 0, 0);
    db = appendStoryMessage(db, 'assistant', `The road goes on. ${index}`, null, 0, 0);
  }

  return {
    ...db,
    state: { ...db.state, inStoryDate: NOW, location: 'a quiet café in Old Town', locationKind: 'structure', scenePace: 'downtime', sceneCast: [], ...change },
  };
}

const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;
const narratorText = (db: AppDatabase, input = '*You sit by the window.*') =>
  buildNarrationPrompt(db, input).messages.map((message) => message.content).join('\n');
/** One present turn: the reply carries the offer the prompt made, like game.tsx. */
function playPresent(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  const prompt = buildNarrationPrompt(db, input);
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const last = next.rawLog.length - 1;
  next.rawLog[last] = {
    ...next.rawLog[last],
    sceneMode: prompt.sceneMode.mode,
    ...(prompt.flashback.offerId ? { flashbackOffer: prompt.flashback.offerId } : {}),
  };
  const turnLogId = next.rawLog[last].id;
  const converted = convertStateBlock(block).diff;
  const diff = converted ? resolveCharacterRefs(next, converted) : null;
  return { ...applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()), prompt };
}

/** One turn inside the memory: both entries are stamped with it, like game.tsx. */
function playMemory(db: AppDatabase, input: string, narration: string, block: Record<string, unknown>) {
  const prompt = buildNarrationPrompt(db, input);
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const last = next.rawLog.length - 1;
  const memory = prompt.flashback.active!;
  next.rawLog[last] = { ...next.rawLog[last], sceneMode: prompt.sceneMode.mode, flashback: memory };
  next.rawLog[last - 1] = { ...next.rawLog[last - 1], flashback: memory };
  const turnLogId = next.rawLog[last].id;
  const converted = convertStateBlock(block).diff;
  const diff = converted ? resolveCharacterRefs(next, converted) : null;
  return { ...applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set()), prompt };
}

describe('offers', () => {
  test('no memories written: nothing is ever offered', () => {
    const db = { ...quietSave({ sceneCast: ['Mara Vance'] }), world: { ...quietSave().world, flashbacks: [] } };
    expect(flashbackOffer(db, '"Mara."', 'conversation')).toBeNull();
  });

  test('a fitting quiet moment offers one; the narrator gets one optional line', () => {
    const db = quietSave({ sceneCast: ['Mara Vance'] });
    expect(flashbackOffer(db, '"Remember my first shift?"', 'conversation')?.id).toBe('first-shift');
    const text = narratorText(db, '"Remember my first shift?"');
    expect(text).toContain('A MEMORY (optional): a flashback fits here: First shift at The Anchor');
    expect(text).toContain('do not start the memory');
  });

  test('nothing in a fight, on the road or early in the story', () => {
    const withMara = quietSave({ sceneCast: ['Mara Vance'] });
    expect(flashbackOffer(withMara, '*You attack.*', 'fight')).toBeNull();
    expect(flashbackOffer({ ...withMara, state: { ...withMara.state, scenePace: 'combat' } }, '"Mara."', 'conversation')).toBeNull();
    expect(flashbackOffer({ ...withMara, state: { ...withMara.state, scenePace: 'travel' } }, '"Mara."', 'normal')).toBeNull();
    const early = normalizeDatabase(seedDatabase('slot_early', 'Early'));
    const fresh = { ...early, world: { ...early.world, flashbacks: MEMORIES }, state: { ...early.state, sceneCast: ['Mara Vance'], scenePace: 'downtime' as const } };
    expect(flashbackOffer(fresh, '"Mara."', 'normal')).toBeNull();
  });

  test('a date-tied memory is offered only near its day', () => {
    expect(flashbackOffer(quietSave({ inStoryDate: { year: 2027, month: 11, day: 3, hour: 20, minute: 0 } }), '*You sit.*', 'normal')?.id).toBe('the-last-call');
    expect(flashbackOffer(quietSave({ inStoryDate: { year: 2027, month: 11, day: 20, hour: 20, minute: 0 } }), '*You sit.*', 'normal')).toBeNull();
  });

  test('at most one offer a month, and a played memory never comes back', () => {
    const db = quietSave({ sceneCast: ['Mara Vance'] });
    const offered = { ...db, state: { ...db.state, flashbacks: { played: [], offered: {}, lastOfferOn: { ...NOW, day: 1 } } } };
    expect(flashbackOffer(offered, '"Mara."', 'conversation')).toBeNull();
    const played = { ...db, state: { ...db.state, flashbacks: { played: ['first-shift'], offered: {} } } };
    expect(flashbackOffer(played, '"Mara."', 'conversation')?.id).not.toBe('first-shift');
  });

  test('a memory that needs a timeline event waits until the player has reached it', () => {
    const db = quietSave();
    expect(flashbackOffer(db, 'You think of the ledger from yard 9.', 'normal')?.id).not.toBe('the-ledger');
    const reached = { ...db, state: { ...db.state, timelineProgress: { ...(db.state.timelineProgress ?? { completed: [], active: [], engaged: [] }), completed: ['audit-offer'] } } };
    expect(flashbackOffer(reached, 'You think of the ledger from yard 9.', 'normal')?.id).toBe('the-ledger');
  });

  test('a shown offer waits as a Remember chip; following it starts it next turn; the tracker knows', () => {
    const db = quietSave({ sceneCast: ['Mara Vance'] });
    const shown = playPresent(db, '"Remember my first shift?"', 'Mara laughs and slides a bottle across the bar.', { flashback: 'offered' }).db;
    expect(shown.state.flashbacks!.pending?.id).toBe('first-shift');
    expect(rememberChip(shown, shown.rawLog[shown.rawLog.length - 1].id)?.id).toBe('first-shift');
    const tracker = buildExtractionPrompt(shown, '*You stare at it.*', 'The label is faded.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('A MEMORY IS WAITING: "First shift at The Anchor"');
    expect((TURN_STATE_SCHEMA as { properties: Record<string, unknown> }).properties.flashback).toBeDefined();

    const follows = playPresent(shown, '*You close your eyes and remember that summer.*', 'The café fades.', { flashback: 'started' }).db;
    expect(activeFlashback(follows)?.record.id).toBe('first-shift');
    expect(follows.state.location).toBe(db.state.location);

    let ignored = playPresent(shown, '"Anyway."', 'Mara shrugs.', {}).db;
    ignored = playPresent(ignored, '"Good."', 'You drink.', {}).db;
    expect(ignored.state.flashbacks!.pending).toBeUndefined();
  });
});

describe('playing a flashback', () => {
  const start = (id = 'first-shift') => beginFlashback(quietSave({ sceneCast: ['Mara Vance'], inventory: ['Phone', 'Company badge'] }), id);

  test('the narrator gets the memory instead of the present; the dead are alive in it', () => {
    const db = start();
    expect(activeFlashback(db)?.active.date).toEqual(flashbackById(db, 'first-shift')!.date);
    const text = narratorText(db, REMEMBER_INPUT);
    expect(text).toContain('FLASHBACK — A MEMORY YOU ARE LIVING THROUGH');
    expect(text).toContain('THIS TURN THE MEMORY BEGINS');
    expect(text).toContain('Why Mara left the family business');
    expect(text).toContain('- Theo Marsh, 26');
    expect(text).toContain('(dead in the present; alive here)');
    expect(text).not.toContain('CURRENT STATE\nDate:');
    expect(text).not.toContain('ENCOUNTER CONDITIONS:');
  });

  test('a memory turn moves only the memory: the present clock, place and inventory stand still', () => {
    const db = start();
    const before = db.state;
    const turn = playMemory(db, REMEMBER_INPUT, 'The café slips away. Seven years younger, you stand behind the bar while Mara watches.', {
      time: { elapsed: 20, unit: 'minutes', clock_time: null },
      location: 'Behind the bar at The Anchor',
      location_kind: 'structure',
      characters_present: ['mara-vance', 'theo-marsh'],
      inventory_added: ['a bar towel'],
      facts: [{ action: 'add', type: 'event', text: 'Mara tested you.', entity: 'player', who_knows: ['player'] }],
      flashback: null,
    }).db;

    expect(turn.state.inStoryDate).toEqual(before.inStoryDate);
    expect(turn.state.location).toBe(before.location);
    expect(turn.state.inventory).toEqual(before.inventory);
    expect(turn.facts.length).toBe(db.facts.length);
    const memory = activeFlashback(turn)!.active;
    expect(dateSortValue(memory.date)).toBeGreaterThan(dateSortValue(flashbackById(db, 'first-shift')!.date));
    expect(memory.place).toBe('Behind the bar at The Anchor');
    expect(memory.turns).toBe(1);
    expect(unsummarizedStory(turn).some((entry) => entry.flashback)).toBe(false);
    expect(storyMessagesSinceLastSummary(turn)).toBe(storyMessagesSinceLastSummary(db));
  });

  test('the weather follows the memory; the present’s held weather is untouched', () => {
    const db = start();
    const view = flashbackView(db)!;
    expect(currentWeather(view).condition).toBe(weatherAt(db.meta.slotId, 'old-town', 'coastal', flashbackById(db, 'first-shift')!.date));
    expect(db.state.weather).toEqual(quietSave({ sceneCast: ['Mara Vance'] }).state.weather);
  });

  test('ending: a past-dated, shared memory, a small bond nudge, and the present picks up the same second', () => {
    let db = start();
    const mara = person(db, 'Mara Vance');
    const bondBefore = db.bonds.find((bond) => bond.entityId === mara.id)!.affinity;
    db = playMemory(db, REMEMBER_INPUT, 'Seven years younger, you pour your first pint while Mara watches.', {
      characters_present: ['mara-vance', 'theo-marsh'],
      bonds: [{ character_id: 'mara-vance', affinity_change: 5, note: 'impressed' }],
    }).db;
    const ended = playMemory(db, '"Hired?"', 'Mara nods once. The bar fades, and the café is there again, the same second you left it.', {
      characters_present: ['mara-vance', 'theo-marsh'],
      flashback: 'ended',
    });
    const next = ended.db;

    expect(activeFlashback(next)).toBeNull();
    expect(next.state.flashbacks!.played).toContain('first-shift');
    expect(next.state.inStoryDate).toEqual(NOW);
    const memory = next.events.find((event) => event.tags.includes('flashback'))!;
    expect(memory.inStoryDate).toEqual(flashbackById(next, 'first-shift')!.date);
    expect(memory.title).toBe('First shift at The Anchor');
    expect(next.eventEntities.filter((link) => link.eventId === memory.id).map((link) => link.entityId)).toContain(mara.id);
    expect(next.bonds.find((bond) => bond.entityId === mara.id)!.affinity - bondBefore).toBe(1);

    const job = next.memoryJobs!.find((item) => item.kind === 'flashback')!;
    expect(job.flashbackId).toBe('first-shift');
    expect(isJobValid(next, job)).toBe(true);
    expect(narratorText(next, '*You blink.*')).toContain('BACK FROM A MEMORY');
    expect(getRecentMessages(next, 40).some((entry) => entry.flashback)).toBe(false);

    const written = applySummaryJob(next, job, {
      text: 'Mara gives you a trial shift and keeps you on.',
      memory: 'The night Mara hired you.',
      povs: [{ entityId: mara.id, text: 'You spilled every pint and I kept you anyway.' }],
    })!.db;
    expect(written.events.find((event) => event.id === memory.id)!.summary).toContain('Mara hired you');
  });

  test('a memory the narrator never closes lets go after the hard cap; it is told to wrap up first', () => {
    let db = start();
    for (let turn = 0; turn < 6; turn += 1) {
      db = playMemory(db, '"Again."', `Mara makes you pour it again. ${turn}`, { characters_present: ['mara-vance'] }).db;
    }
    expect(narratorText(db, '"Again."')).toContain("look for the scene's natural end");
    for (let turn = 6; turn < FLASHBACK_HARD_CAP; turn += 1) {
      db = playMemory(db, '"Again."', `Again. ${turn}`, { characters_present: ['mara-vance'] }).db;
    }
    expect(activeFlashback(db)).toBeNull();
    expect(db.state.flashbacks!.returned?.forced).toBe(true);
  });

  test('inside the memory the tracker sees its clock and none of the present’s timeline or letters', () => {
    const tracker = buildExtractionPrompt(start(), REMEMBER_INPUT, 'The café slips away.').messages.map((m) => m.content).join('\n');
    expect(tracker).toContain('THIS TURN IS A MEMORY');
    expect(tracker).toContain('CURRENT STATE (inside the memory)');
    expect(tracker).not.toMatch(/\nWORLD TIMELINE TRACKING/);
  });

  test('a scene image of a memory shows the player at their age then; its photos sit before the story', () => {
    let db = start();
    db = playMemory(db, REMEMBER_INPUT, 'Mara grins at you across the bar.', { characters_present: ['mara-vance'] }).db;
    const prompt = buildSceneImagePrompt(db, [], 'Alex and Mara stand behind the bar.');
    expect(prompt).toContain('THIS IS A MEMORY');
    expect(prompt).toContain('Mara Vance (age 24)');
    expect(prompt).not.toContain('Company badge');

    const replyId = db.rawLog[db.rawLog.length - 1].id;
    db = { ...db, rawLog: db.rawLog.map((entry) => (entry.id === replyId ? { ...entry, image: 'img:test' } : entry)) };
    const book = scrapbook(db);
    expect(book[0].era).toBe(MEMORY_ERA);
    expect(book[0].chapters[0].title).toBe('First shift at The Anchor');
    expect(book[0].chapters[0].photos[0].age).toBe(22);
  });
});

describe('around the edges', () => {
  test('older saves load without flashbacks; a broken one is let go', () => {
    expect(normalizeFlashbacks(undefined)).toBeUndefined();
    expect(normalizeFlashbacks({ played: ['first-shift', 'nope'], offered: { nope: NOW }, active: { id: 'nope' } }, MEMORIES)).toEqual({ played: ['first-shift'], offered: {} });
    expect(activeFlashback(normalizeDatabase(beginFlashback(quietSave(), 'first-shift')))?.record.id).toBe('first-shift');
  });

  test('a remembrance day remembers a memory lived again with the dead', () => {
    let db = beginFlashback(quietSave(), 'first-shift');
    db = playMemory(db, REMEMBER_INPUT, 'Theo heckles you from his stool.', { characters_present: ['theo-marsh', 'mara-vance'] }).db;
    db = playMemory(db, '"Shut up, Theo."', 'The bar fades, and the café is there again.', { characters_present: ['theo-marsh'], flashback: 'ended' }).db;
    const birthday = { ...db, state: { ...db.state, inStoryDate: { year: 2027, month: 11, day: 3, hour: 9, minute: 0 }, sceneCast: [] } };
    const offer = yearlyOffer(birthday);
    expect(offer?.kind).toBe('remembrance');
    expect(offer?.line).toContain('First shift at The Anchor');
  });

  test('a memory turn whose flashback is gone changes nothing', () => {
    const db = quietSave();
    let next = appendStoryMessage(db, 'user', '"Hm."', null, 0, 0);
    next = appendStoryMessage(next, 'assistant', 'Nothing.', null, 0, 0);
    const last = next.rawLog.length - 1;
    next.rawLog[last] = { ...next.rawLog[last], flashback: { id: 'gone', date: NOW } };
    const diff: TurnDiff = { state: { location: 'somewhere else' } };
    const result = applyStateStep(next, diff, { turnLogId: next.rawLog[last].id, userMessage: '"Hm."', narration: 'Nothing.' }, new Set());
    expect(result.db.state.location).toBe(db.state.location);
  });
});
