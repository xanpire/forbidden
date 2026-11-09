// Time skips: the button's presets and typed times, what fills the gap (texts,
// routines, people leaving), the narrator's line, and the reply after a skip
// not moving the clock again.
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

import { secondsBetween } from '../lib/rpg/calendar';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import { applyTextPlan, ensureThread, phoneOf, sendText, unreadCount } from '../lib/rpg/phone';
import { buildNarrationPrompt } from '../lib/rpg/prompt';
import { whereNow } from '../lib/rpg/routines';
import { applySkip, canSkip, parseSkipTarget, presetTarget } from '../lib/rpg/skip';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import type { AppDatabase, CalendarDate, MemoryJob } from '../lib/rpg/types';
import { seedDatabase } from './fixtures/seed';
import { TEST_START, testSeedInput } from './fixtures/testWorld';

function story(): AppDatabase {
  const input = testSeedInput();
  input.people = input.people.map((person) =>
    person.name === 'Mara Vance' ? { ...person, routine: 'Wed-Sun 17:00-1:00 working at The Anchor; sleeps 2:00-10:00', whereabouts: undefined } : person
  );
  input.opening = { ...input.opening, location: 'The Anchor', castNames: ['Mara Vance'] };
  return normalizeDatabase(seedDatabase('slot_skip', 'Skip', input));
}

function play(db: AppDatabase, input: string, narration: string, state: Record<string, unknown>, skip?: { to: CalendarDate }) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = convertStateBlock(state).diff;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration, options: skip ? { skip } : undefined }, new Set()).db;
}

const at = (day: number, hour: number, minute = 0): CalendarDate => ({ ...TEST_START, day, hour, minute, second: 0 });
const person = (db: AppDatabase, name: string) => db.entities.find((entity) => entity.name === name)!;

describe('when a skip lands', () => {
  // Thursday 1 October 2026, 10 PM.
  const now = TEST_START;

  test('the presets', () => {
    expect(presetTarget(now, 'hour')).toEqual(at(1, 23));
    expect(presetTarget(now, 'tonight')).toBeNull();
    expect(presetTarget({ ...now, hour: 15 }, 'tonight')).toEqual(at(1, 21));
    expect(presetTarget(now, 'morning')).toEqual(at(2, 7, 30));
    expect(presetTarget({ ...now, day: 2, hour: 2 }, 'morning')).toEqual(at(2, 7, 30));
  });

  test('typed times', () => {
    expect(parseSkipTarget('Friday night', now)).toEqual(at(2, 21));
    expect(parseSkipTarget('tomorrow at 9am', now)).toEqual(at(2, 9));
    expect(parseSkipTarget('in 3 hours', now)).toEqual(at(2, 1));
    expect(parseSkipTarget('noon', now)).toEqual(at(2, 12));
    expect(parseSkipTarget('Saturday 8:30pm', now)).toEqual(at(3, 20, 30));
    expect(parseSkipTarget('next Thursday', now)).toEqual(at(8, 7, 30));
    expect(parseSkipTarget('Thursday evening', now)).toEqual(at(8, 19));
    expect(parseSkipTarget('the 14th of October', now)).toEqual(at(14, 7, 30));
    expect(parseSkipTarget('whenever', now)).toBeNull();
  });
});

describe('a skip fills in what happened', () => {
  test('skipping to the next morning delivers the overnight texts and moves everyone to where their routines put them', () => {
    let db = story();
    db = play(db, '"Number?"', 'Mara puts her number in your phone.', {
      characters_present: ['mara-vance'],
      phone: { numbers_exchanged: ['mara-vance'], texts_received: [], texts_sent: [] },
    });
    db = play(db, 'I head home.', 'You walk home in the rain.', { characters_present: [], location: 'Your flat on Kell Street' });

    const mara = person(db, 'Mara Vance');
    const thread = ensureThread(db, [mara.id]);
    const sent = sendText(thread.db, thread.thread.id, 'night. thanks for tonight');
    db = applyTextPlan(sent.db, (sent.db.memoryJobs ?? []).find((job) => job.id === sent.jobId) as MemoryJob, {
      messages: [{ from: 'Mara', text: 'night x', minutesAfter: 0 }],
      leftOnRead: false,
    });
    expect(unreadCount(db)).toBe(0);
    expect(canSkip(db)).toBe(true);

    const before = db.state.inStoryDate;
    const target = presetTarget(before, 'morning')!;
    const skipped = applySkip(db, target)!;
    db = skipped.db;

    expect(db.state.inStoryDate).toEqual(at(2, 7, 30));
    expect(unreadCount(db)).toBe(1);
    expect(skipped.meanwhile).toContain('Texts came in: 1 from Mara Vance');
    expect(skipped.label).toContain('The next morning');
    // Friday 7:30 AM: Mara sleeps until ten; Daniel's working day hasn't begun.
    expect(whereNow(person(db, 'Mara Vance'), db.state.inStoryDate)).toBe('asleep at home');
    expect(whereNow(person(db, 'Daniel Okafor'), { ...db.state.inStoryDate, hour: 10 })).toBe('at work');

    // The narrator opens the new moment; the reply doesn't move the clock again.
    const prompt = buildNarrationPrompt(db, skipped.label, { skip: { from: before, to: target, meanwhile: skipped.meanwhile } }).messages[1].content;
    expect(prompt).toContain('TIME SKIP');
    expect(prompt).toContain('Texts came in');
    expect(prompt).toContain('PHONE');
    db = play(
      db,
      skipped.label,
      'Nine hours later, grey light finds you tangled in the sheets. Your phone glows on the nightstand.',
      { characters_present: [], time: { elapsed: 9, unit: 'hours', clock_time: { hour: 16, minute: 30 } } },
      { to: target }
    );
    expect(secondsBetween(target, db.state.inStoryDate)).toBeLessThanOrEqual(30 * 60);
    expect(db.state.inStoryDate.day).toBe(2);
    // The scene before the skip becomes a memory.
    expect((db.memoryJobs ?? []).some((job) => job.kind === 'scene')).toBe(true);
  });

  test('a long skip sends people on with their day; companions stay', () => {
    let db = story();
    db = play(db, 'I order a drink.', 'Mara slides a glass across the bar.', { characters_present: ['mara-vance'] });
    expect(db.state.sceneCast).toContain('Mara Vance');
    const short = applySkip(db, presetTarget(db.state.inStoryDate, 'hour')!)!;
    expect(short.db.state.sceneCast).toContain('Mara Vance');
    const long = applySkip(db, presetTarget(db.state.inStoryDate, 'morning')!)!;
    expect(long.db.state.sceneCast).toEqual([]);
    expect(long.meanwhile).toContain('Mara Vance went on with their day');
  });

  test('someone coming over who would have arrived during the skip is arriving now', () => {
    let db = story();
    db = play(db, 'I head home.', 'You walk home.', { characters_present: [], location: 'Your flat on Kell Street' });
    const mara = person(db, 'Mara Vance');
    db = { ...db, phone: { ...phoneOf(db), arrivals: [{ entityId: mara.id, dueAt: at(1, 22, 40) }] } };
    const skipped = applySkip(db, presetTarget(db.state.inStoryDate, 'hour')!)!;
    expect(buildNarrationPrompt(skipped.db, 'x').messages[1].content).toContain('Arriving now: Mara');
  });

  test('no skip during sex, and none before the story starts', () => {
    const fresh = normalizeDatabase(seedDatabase('slot_skip2', 'Skip', testSeedInput()));
    expect(canSkip(fresh)).toBe(false);
    let db = story();
    db = play(db, 'I kiss her.', 'She kisses you back.', { characters_present: ['mara-vance'] });
    const mara = person(db, 'Mara Vance');
    db = { ...db, state: { ...db.state, sceneMode: { ...(db.state.sceneMode ?? {}), sex: { with: [mara.id], since: db.state.inStoryDate, turns: 1, phase: 'build-up', done: [] } } as never } };
    expect(canSkip(db)).toBe(false);
    expect(applySkip(db, presetTarget(db.state.inStoryDate, 'hour')!)).toBeNull();
  });
});
