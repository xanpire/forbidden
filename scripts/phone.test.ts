// The phone and routines: numbers swapped on the page, texting back and forth
// with reply times from people's routines, a text landing mid-scene, and
// "come over" bringing someone into the scene.
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

import { dateSortValue, secondsBetween } from '../lib/rpg/calendar';
import { normalizeDatabase } from '../lib/rpg/db';
import { resolveCharacterRefs } from '../lib/rpg/entities';
import { appendStoryMessage } from '../lib/rpg/log';
import { applyStateStep } from '../lib/rpg/memoryJobs';
import {
  applyTextPlan,
  buildTextingPrompt,
  ensureThread,
  formatPhoneBlock,
  hasNumber,
  isTyping,
  markThreadRead,
  phoneOf,
  queueOwnTexts,
  sendText,
  threadMessages,
  unreadCount,
  waitForNext,
} from '../lib/rpg/phone';
import { whereaboutsOf } from '../lib/rpg/places';
import { buildExtractionPrompt, buildNarrationPrompt } from '../lib/rpg/prompt';
import { dayOfWeek, inferredRoutine, parseRoutine, replyDelayMinutes, routineAt, whereNow } from '../lib/rpg/routines';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import type { AppDatabase, CalendarDate, MemoryJob } from '../lib/rpg/types';
import { seedDatabase } from './fixtures/seed';
import { testSeedInput } from './fixtures/testWorld';

const MARA_WEEK = 'Wed-Sun 17:00-1:00 working at The Anchor; sleeps 2:00-10:00';

function story(): AppDatabase {
  const input = testSeedInput();
  input.people = input.people.map((person) => (person.name === 'Mara Vance' ? { ...person, routine: MARA_WEEK, whereabouts: undefined } : person));
  input.opening = { ...input.opening, location: 'The Anchor', castNames: ['Mara Vance'] };
  return normalizeDatabase(seedDatabase('slot_phone', 'Phone', input));
}

const noPhone = { numbers_exchanged: [], texts_received: [], texts_sent: [] };

/** One turn through the state step, as game.tsx plays it. */
function play(db: AppDatabase, input: string, narration: string, state: Record<string, unknown>) {
  let next = appendStoryMessage(db, 'user', input, null, 0, 0);
  next = appendStoryMessage(next, 'assistant', narration, null, 0, 0);
  const turnLogId = next.rawLog[next.rawLog.length - 1].id;
  const reply = convertStateBlock({ phone: noPhone, ...state }).diff;
  const diff = reply ? resolveCharacterRefs(next, reply) : null;
  return applyStateStep(next, diff, { turnLogId, userMessage: input, narration }, new Set());
}

const mara = (db: AppDatabase) => db.entities.find((entity) => entity.name === 'Mara Vance')!;
const jobOf = (db: AppDatabase, id: string | null) => (db.memoryJobs ?? []).find((job) => job.id === id) as MemoryJob;
const minutes = (from: CalendarDate, to: CalendarDate) => secondsBetween(from, to) / 60;

describe('routines', () => {
  test('plain words become a week, past midnight included', () => {
    const blocks = parseRoutine('weekdays 9-5 at the office; sleeps 23:30-7; Fridays 21-2 at the club');
    expect(blocks[0]).toMatchObject({ days: [1, 2, 3, 4, 5], from: 9 * 60, to: 17 * 60, doing: 'work', where: 'the office' });
    expect(blocks[1]).toMatchObject({ doing: 'sleep', from: 23 * 60 + 30, to: 7 * 60 });
    expect(blocks[2]).toMatchObject({ days: [5], from: 21 * 60, to: 2 * 60, doing: 'out', where: 'the club' });
    expect(parseRoutine('Mon-Thu 7:00-19:00 at work')[0].days).toEqual([1, 2, 3, 4]);
  });

  test('where someone is follows their routine unless the story said otherwise', () => {
    const db = story();
    const thursday = db.state.inStoryDate; // Thursday 1 October 2026, 10 PM
    expect(dayOfWeek(thursday)).toBe(4);
    const person = { ...mara(db) };
    expect(routineAt(person, thursday)).toMatchObject({ doing: 'work', where: 'The Anchor' });
    // Friday 1 AM is still Thursday night's shift; 3 AM she's asleep.
    expect(routineAt(person, { ...thursday, day: 2, hour: 0, minute: 30 }).doing).toBe('work');
    expect(routineAt(person, { ...thursday, day: 2, hour: 3 }).doing).toBe('sleep');
    expect(whereNow({ ...person, whereabouts: 'at her sister’s', whereaboutsAt: thursday }, thursday)).toBe('at her sister’s');
    expect(whereNow({ ...person, whereabouts: 'at her sister’s', whereaboutsAt: { ...thursday, day: 1, hour: 10 } }, thursday)).toBe('at The Anchor');
    expect(inferredRoutine({ role: 'Bartender' })).toContain('18:00-2:00');
    expect(inferredRoutine({ role: 'Logistics analyst' })).toContain('weekdays 9:00-17:30');
  });

  test('reply times come from the routine: asleep waits for morning, free is quick', () => {
    const db = story();
    const person = mara(db);
    const asleep = replyDelayMinutes(db, person, { ...db.state.inStoryDate, day: 2, hour: 4, minute: 0 }, 'a');
    expect(asleep).toBeGreaterThanOrEqual(6 * 60 + 5);
    const free = replyDelayMinutes(db, person, { ...db.state.inStoryDate, day: 2, hour: 12, minute: 0 }, 'a');
    expect(free).toBeLessThanOrEqual(12);
  });

  test('the bond page and ELSEWHERE use the routine', () => {
    let db = story();
    db = { ...db, state: { ...db.state, sceneCast: [], location: 'Your flat on Kell Street' } };
    expect(whereaboutsOf(db, mara(db))?.detail).toBe('Usually at The Anchor around now');
    expect(buildNarrationPrompt(db, 'I sit down.').messages[1].content).toContain('Mara Vance: at The Anchor');
  });
});

describe('the phone', () => {
  test('the tracker has a phone field, and texts show up in both prompts by name only', () => {
    expect(JSON.stringify(TURN_STATE_SCHEMA)).toContain('numbers_exchanged');
    expect(buildExtractionPrompt(story(), 'hi', 'Hi.').messages[0].content).toContain('PHONE: phone.numbers_exchanged');
  });

  test('exchange numbers, text back and forth, a text mid-scene, and "come over" brings her in', () => {
    // At the bar: you swap numbers.
    let db = story();
    db = play(db, '"Give me your number."', 'Mara takes your phone and types her number in. "Don\'t make me regret it."', {
      characters_present: ['mara-vance'],
      phone: { ...noPhone, numbers_exchanged: ['mara-vance'] },
    }).db;
    expect(hasNumber(db, mara(db).id)).toBe(true);

    // Home: you text her.
    db = play(db, 'I head home.', 'You walk home through the rain and let yourself into the flat.', {
      characters_present: [],
      location: 'Your flat on Kell Street',
      time: { elapsed: 20, unit: 'minutes', clock_time: null },
    }).db;
    expect(formatPhoneBlock(db)).toContain('PHONE');
    const thread = ensureThread(db, [mara(db).id]);
    db = thread.db;
    const sent = sendText(db, thread.thread.id, 'home safe. still busy?');
    db = sent.db;
    const job = jobOf(db, sent.jobId);
    expect(job.kind).toBe('text');
    // The texting prompt names people; it never shows ids.
    const prompt = buildTextingPrompt(db, job).map((message) => message.content).join('\n');
    expect(prompt).toContain('Mara Vance');
    expect(prompt).toContain('home safe. still busy?');
    expect(prompt).not.toMatch(/entity_|thread_|memjob_/);

    // What the model wrote: two texts, the second a minute after the first.
    const sentAt = db.state.inStoryDate;
    db = applyTextPlan(db, job, {
      messages: [
        { from: 'Mara', text: 'slammed. friday crowd came early', minutesAfter: 0 },
        { from: 'Mara', text: 'text me tomorrow', minutesAfter: 1 },
      ],
      leftOnRead: false,
      feelingChange: 1,
      feelingNote: 'you checked in',
    });
    const pending = phoneOf(db).pending;
    expect(pending).toHaveLength(2);
    // She's working: not instant.
    expect(minutes(sentAt, pending[0].dueAt)).toBeGreaterThanOrEqual(10);
    expect(minutes(pending[0].dueAt, pending[1].dueAt)).toBeCloseTo(1, 5);
    expect(unreadCount(db)).toBe(0);
    expect((db.memoryJobs ?? []).some((item) => item.id === job.id)).toBe(false);

    // Mid-scene: time passes on the page and the phone buzzes.
    const lastDue = phoneOf(db).pending[1].dueAt;
    const affinityBefore = db.bonds.find((bond) => bond.entityId === mara(db).id)!.affinity;
    db = play(db, 'I make tea and watch the rain.', 'Two hours slip by with the tea and the rain on the window.', {
      characters_present: [],
      time: { elapsed: 2, unit: 'hours', clock_time: null },
      scene_pace: 'downtime',
    }).db;
    expect(dateSortValue(db.state.inStoryDate)).toBeGreaterThanOrEqual(dateSortValue(lastDue));
    expect(unreadCount(db)).toBe(2);
    expect(db.bonds.find((bond) => bond.entityId === mara(db).id)!.affinity).toBe(affinityBefore + 1);
    const narrator = buildNarrationPrompt(db, 'I check my phone.').messages[1].content;
    expect(narrator).toContain('Just buzzed, unread: Mara Vance (2)');
    expect(narrator).not.toContain('slammed');
    // Texts become memory once read.
    expect(db.events.some((event) => event.tags.includes('text') && event.summary.includes('slammed'))).toBe(false);
    db = markThreadRead(db, thread.thread.id);
    expect(db.events.some((event) => event.tags.includes('text') && event.summary.includes('slammed'))).toBe(true);
    expect(buildNarrationPrompt(db, 'I text back.').messages[1].content).toContain('Recent texts the player has read');

    // "Come over?" She says yes; waiting moves the clock to her text, then to her arrival.
    const ask = sendText(db, thread.thread.id, 'come over when you close?');
    db = ask.db;
    db = applyTextPlan(db, jobOf(db, ask.jobId), {
      messages: [{ from: 'Mara', text: 'omw. 20 min', minutesAfter: 0 }],
      leftOnRead: false,
      comingOverMinutes: 20,
    });
    expect(isTyping(db, thread.thread.id) || phoneOf(db).pending.length === 1).toBe(true);
    db = waitForNext(db)!;
    expect(threadMessages(db, thread.thread.id).at(-1)?.text).toBe('omw. 20 min');
    expect(phoneOf(db).arrivals).toHaveLength(1);
    expect(mara(db).whereabouts).toBe('on the way to you');
    expect(buildNarrationPrompt(db, 'I wait.').messages[1].content).toMatch(/On the way: Mara.*about 20 minutes/);
    db = waitForNext(db)!;
    expect(buildNarrationPrompt(db, 'I open the door.').messages[1].content).toContain('Arriving now: Mara');

    // The narrator brings her in; the arrival is done.
    db = play(db, 'I open the door.', 'Mara is on the landing, rain in her hair, a bottle under her arm.', {
      characters_present: ['mara-vance'],
    }).db;
    expect(phoneOf(db).arrivals).toHaveLength(0);
    expect(buildNarrationPrompt(db, 'I let her in.').messages[1].content).not.toContain('Arriving now');
  });

  test('texts on the page: one sent queues a reply, one received is kept once and read', () => {
    let db = story();
    db = play(db, '"Number?"', 'She writes it on your hand, then puts it in your phone herself.', {
      characters_present: ['mara-vance'],
      phone: { ...noPhone, numbers_exchanged: ['mara-vance'] },
    }).db;
    const step = play(db, 'I text Mara "miss you already".', 'You type it out and hit send before you can think better of it.', {
      characters_present: [],
      phone: { ...noPhone, texts_sent: [{ to: 'mara-vance', text: 'miss you already' }] },
    });
    db = step.db;
    expect(step.followUpIds.some((id) => jobOf(db, id)?.kind === 'text')).toBe(true);
    expect(phoneOf(db).messages.at(-1)).toMatchObject({ from: 'player', text: 'miss you already' });

    const received = { ...noPhone, texts_received: [{ from: 'mara-vance', text: 'who gave you this number' }] };
    db = play(db, 'I look at the screen.', 'The screen lights up: "who gave you this number"', { characters_present: [], phone: received }).db;
    db = play(db, 'I read it again.', 'You read it again: "who gave you this number"', { characters_present: [], phone: received }).db;
    const fromHer = phoneOf(db).messages.filter((message) => message.from === mara(db).id);
    expect(fromHer).toHaveLength(1);
    expect(fromHer[0].read).toBe(true);
  });

  test('an unknown number can text, and being left on read shows', () => {
    let db = story();
    db = play(db, 'I check my phone.', 'A text from a number you don\'t know: "is this alex?"', {
      characters_present: [],
      phone: { ...noPhone, texts_received: [{ from: 'unknown', text: 'is this alex?' }] },
    }).db;
    const thread = phoneOf(db).threads[0];
    expect(thread.members).toEqual([]);
    expect(formatPhoneBlock(db)).toContain('unknown number');

    const opened = ensureThread(db, [mara(db).id]);
    db = opened.db;
    const sent = sendText(db, opened.thread.id, 'you up?');
    db = applyTextPlan(sent.db, jobOf(sent.db, sent.jobId), { messages: [], leftOnRead: true });
    db = waitForNext(db)!;
    expect(phoneOf(db).threads.find((item) => item.id === opened.thread.id)?.readAt).toBeDefined();
    expect(unreadCount(db, opened.thread.id)).toBe(0);
  });

  test('close people text on your birthday, once', () => {
    let db = story();
    const now = db.state.inStoryDate;
    db = { ...db, state: { ...db.state, sceneCast: [], player: { ...db.state.player, birthday: { month: now.month, day: now.day } } } };
    db = { ...db, bonds: db.bonds.map((bond) => (bond.entityId === mara(db).id ? { ...bond, affinity: 8 } : bond)) };
    db = { ...db, entities: db.entities.map((entity) => (entity.name === 'Mara Vance' ? { ...entity, routine: 'sleeps 3:00-9:00' } : entity)) };
    db = { ...db, phone: { ...phoneOf(db), contacts: [{ entityId: mara(db).id, since: now }] } };
    const first = queueOwnTexts(db);
    expect(first.jobIds).toHaveLength(1);
    expect(jobOf(first.db, first.jobIds[0]).textReason).toBe('birthday');
    const again = queueOwnTexts(first.db);
    expect(again.jobIds).toHaveLength(0);
  });

  test('waiting never jumps past the limit, and nothing waits when nothing is coming', () => {
    const db = story();
    expect(waitForNext(db)).toBeNull();
    const opened = ensureThread(db, [mara(db).id]);
    const far = { ...opened.db, phone: { ...phoneOf(opened.db), pending: [{ id: 'p', threadId: opened.thread.id, from: mara(db).id, text: 'later', dueAt: { ...db.state.inStoryDate, day: 4 } }] } };
    const waited = waitForNext(far)!;
    expect(dateSortValue(waited.state.inStoryDate)).toBeLessThan(dateSortValue({ ...db.state.inStoryDate, day: 4 }));
    expect(unreadCount(waited)).toBe(0);
  });
});
