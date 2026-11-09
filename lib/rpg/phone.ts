// The player's phone: contacts, text threads (one-to-one and groups) and the
// texts people send back on their own schedule.
//
// - A contact appears when numbers are exchanged on the page (the tracker's
//   phone.numbers_exchanged). Someone without a contact entry can still text:
//   their thread shows as an unknown number.
// - The player texts from the phone screen, or on the page ("I text Maya").
//   Either way a text job (memoryJobs.ts) asks the narrator model to write
//   what they send back. The app decides when it lands, from their routine
//   (asleep, at work, free) and how they feel about the player
//   (routines.ts). Texts wait in `pending` until the story clock reaches
//   them; then they land, unread, and the narrator hears the phone buzz.
// - A text can carry effects that apply when it lands: a change in how they
//   feel, a plan, news from their life, or "coming over" (they arrive in the
//   scene after that long).
// - Close people text on their own now and then, and on the player's
//   birthday and holidays. No real push notifications: everything happens in
//   story time.
// - Pictures in texts are words until the player opens them; then they are
//   painted through the one picture pipeline (paintScene.ts).

import type { ChatRequest } from '../openrouter';
import { completeChat } from '../openrouter';
import { applyBondDiff } from './bonds';
import { dateSortValue, daysBetween, entityAge, formatClock, formatDate, secondsBetween, shiftSeconds, weekdayOf } from './calendar';
import { companionsOf } from './companions';
import { buildIndices } from './db';
import { recordDebugCall } from './debug';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { applyThreadDiff } from './facts';
import { makeId } from './id';
import { entityCanBeIntimate } from './intimacy';
import { applyLifeEvents, markLifeKnown } from './lives';
import { displayName } from './names';
import { isPlayer, playerName } from './player';
import { replyDelayMinutes, routineAt, whereNow } from './routines';
import { parseJsonObject } from './stateBlock';
import { hashText } from './util';
import { holidayToday, isClose } from './yearly';
import type {
  AppDatabase,
  CalendarDate,
  EntityRecord,
  EventRecord,
  MemoryJob,
  PendingText,
  PhoneMessage,
  PhoneState,
  PhoneThread,
  TextEffects,
  TextReason,
  TurnDiff,
} from './types';

export const PLAYER = 'player';
const UNKNOWN = 'unknown';

/** Texts kept on the phone (the oldest go first). */
const MESSAGES_KEPT = 600;
/** Waiting for a reply jumps the clock at most this far. */
const WAIT_LIMIT_HOURS = 12;
/** A thread quiet this long lets a close person text first. */
const QUIET_HOURS = 12;
/** At most this many unprompted texts in a story day. */
const UNPROMPTED_PER_DAY = 1;

const EMPTY: PhoneState = { contacts: [], threads: [], messages: [], pending: [], arrivals: [], sent: [] };

export function phoneOf(db: AppDatabase): PhoneState {
  const phone = db.phone;

  if (!phone) return EMPTY;

  return {
    contacts: phone.contacts ?? [],
    threads: phone.threads ?? [],
    messages: phone.messages ?? [],
    pending: phone.pending ?? [],
    arrivals: phone.arrivals ?? [],
    sent: phone.sent ?? [],
  };
}

function withPhone(db: AppDatabase, phone: PhoneState): AppDatabase {
  return { ...db, phone };
}

function dayKey(date: CalendarDate) {
  return `${date.year}-${date.month}-${date.day}`;
}

function before(a: CalendarDate, b: CalendarDate) {
  return dateSortValue(a) <= dateSortValue(b);
}

// ---------------------------------------------------------------------------
// Contacts and threads

export function hasNumber(db: AppDatabase, entityId: string) {
  return phoneOf(db).contacts.some((contact) => contact.entityId === entityId);
}

function addContacts(db: AppDatabase, entityIds: string[]): AppDatabase {
  const phone = phoneOf(db);
  const fresh = [...new Set(entityIds)].filter(
    (id) => !phone.contacts.some((contact) => contact.entityId === id) && db.entities.some((entity) => entity.id === id && !isPlayer(db, entity))
  );

  if (fresh.length === 0) return db;

  return withPhone(db, { ...phone, contacts: [...phone.contacts, ...fresh.map((entityId) => ({ entityId, since: db.state.inStoryDate }))] });
}

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** The one-to-one thread with these people, made if there is none. */
export function ensureThread(db: AppDatabase, members: string[], options: { group?: boolean; name?: string } = {}): { db: AppDatabase; thread: PhoneThread } {
  const phone = phoneOf(db);
  const existing = options.group
    ? undefined
    : phone.threads.find((thread) => !thread.group && sameMembers(thread.members, members));

  if (existing) return { db, thread: existing };

  const thread: PhoneThread = {
    id: makeId('thread'),
    members,
    lastAt: db.state.inStoryDate,
    ...(options.group ? { group: true, name: options.name?.trim() || undefined } : {}),
  };

  return { db: withPhone(db, { ...phone, threads: [...phone.threads, thread] }), thread };
}

/** A group chat with these contacts. */
export function createGroup(db: AppDatabase, memberIds: string[], name?: string): { db: AppDatabase; thread: PhoneThread } {
  return ensureThread(db, [...new Set(memberIds)], { group: true, name });
}

function entityOf(db: AppDatabase, id: string) {
  return db.entities.find((entity) => entity.id === id) ?? null;
}

/** The name a thread shows: the contact, an unknown number, or the group. */
export function threadTitle(db: AppDatabase, thread: PhoneThread): string {
  if (thread.group) {
    return thread.name || thread.members.map((id) => displayName(db, entityOf(db, id))).join(', ');
  }

  const id = thread.members[0];

  if (!id || !hasNumber(db, id)) return 'Unknown number';

  return displayName(db, entityOf(db, id));
}

/** Who a message is from, as the phone shows it. */
export function senderName(db: AppDatabase, from: string): string {
  if (from === PLAYER) return 'You';
  if (from === UNKNOWN || !hasNumber(db, from)) return 'Unknown number';

  return displayName(db, entityOf(db, from));
}

export function threadMessages(db: AppDatabase, threadId: string): PhoneMessage[] {
  return phoneOf(db).messages.filter((message) => message.threadId === threadId);
}

export function unreadCount(db: AppDatabase, threadId?: string): number {
  return phoneOf(db).messages.filter((message) => !message.read && (!threadId || message.threadId === threadId)).length;
}

/** Threads, newest first. */
export function threadsByRecent(db: AppDatabase): PhoneThread[] {
  return [...phoneOf(db).threads].sort((a, b) => dateSortValue(b.lastAt) - dateSortValue(a.lastAt));
}

/** The player opens a thread: everything in it is read, and what it says becomes memory. */
export function markThreadRead(db: AppDatabase, threadId: string): AppDatabase {
  const phone = phoneOf(db);

  if (!phone.messages.some((message) => message.threadId === threadId && !message.read)) return db;

  const read = withPhone(db, {
    ...phone,
    messages: phone.messages.map((message) => (message.threadId === threadId ? { ...message, read: true } : message)),
  });

  return recordTextMemory(read, threadId);
}

/** Someone is about to text in this thread (the next text is due within a few minutes). */
export function isTyping(db: AppDatabase, threadId: string): boolean {
  const now = db.state.inStoryDate;

  return phoneOf(db).pending.some(
    (pending) => pending.threadId === threadId && pending.text && secondsBetween(now, pending.dueAt) <= 5 * 60
  );
}

function addMessage(phone: PhoneState, message: PhoneMessage): PhoneState {
  return {
    ...phone,
    messages: [...phone.messages, message].slice(-MESSAGES_KEPT),
    threads: phone.threads.map((thread) =>
      thread.id === message.threadId
        ? { ...thread, lastAt: message.at, ...(message.from === PLAYER ? { readAt: undefined } : {}) }
        : thread
    ),
  };
}

// ---------------------------------------------------------------------------
// Sending and the text job

function lastAssistantId(db: AppDatabase) {
  return [...db.rawLog].reverse().find((entry) => entry.role === 'assistant')?.id ?? '';
}

function textJob(db: AppDatabase, threadId: string, reason: TextReason, from?: string): MemoryJob {
  return {
    id: makeId('memjob'),
    kind: 'text',
    status: 'queued',
    turnLogId: lastAssistantId(db),
    threadId,
    textReason: reason,
    ...(from ? { textFrom: from } : {}),
    attempts: 0,
    createdAt: Date.now(),
  };
}

function withJob(db: AppDatabase, job: MemoryJob): AppDatabase {
  return { ...db, memoryJobs: [...(db.memoryJobs ?? []), job] };
}

/**
 * The player sends a text. Returns the job that will write what comes back;
 * the caller runs it.
 */
export function sendText(db: AppDatabase, threadId: string, text: string): { db: AppDatabase; jobId: string | null } {
  const phone = phoneOf(db);
  const clean = text.trim().slice(0, 1000);

  if (!clean || !phone.threads.some((thread) => thread.id === threadId)) return { db, jobId: null };

  const message: PhoneMessage = { id: makeId('text'), threadId, from: PLAYER, text: clean, at: db.state.inStoryDate, read: true };
  let next = withPhone(db, addMessage(phone, message));
  next = recordTextMemory(next, threadId);
  const job = textJob(next, threadId, 'reply');

  return { db: withJob(next, job), jobId: job.id };
}

/** A text job still makes sense: its thread is there. */
export function isTextJobValid(db: AppDatabase, job: MemoryJob) {
  return Boolean(job.threadId && phoneOf(db).threads.some((thread) => thread.id === job.threadId));
}

/** The player's texts nobody has answered yet in this thread. */
function unanswered(db: AppDatabase, threadId: string): PhoneMessage[] {
  const messages = threadMessages(db, threadId);
  const lastReply = messages.map((message) => message.from !== PLAYER).lastIndexOf(true);
  const pendingFor = phoneOf(db).pending.some((pending) => pending.threadId === threadId);

  return pendingFor ? [] : messages.slice(lastReply + 1).filter((message) => message.from === PLAYER);
}

type TextPlan = {
  messages: { from: string; text: string; minutesAfter: number; photo?: string }[];
  leftOnRead: boolean;
  comingOverMinutes?: number;
  plan?: string;
  feelingChange?: number;
  feelingNote?: string;
  lifeEvent?: string;
  sharedNews?: boolean;
};

const TEXTING_SYSTEM = `You write the text messages people send in an interactive story set in the real world today. Write only what they type on their phone, in their own voice: their speech style, their mood, how they feel about the player, and what they are doing right now. Texts are short and real. Several short messages rather than one long one when that is how they text; lowercase, slang, typos and emoji only if they would use them. They can answer late, leave the player on read, double-text, joke, flirt, argue, make plans, ask to come over, or say no. Never write narration, actions or anything they would not type.

This is an adults-only story: flirting and sexting are fine between adults who both want it, written as frankly as they would. Everyone in anything sexual is 18 or older and never described as a child. People marked "nothing sexual" stay that way.

Return one JSON object:
- messages: what they send, in order. from: who sends it (their name as written). minutes_after_previous: minutes after the one before (0-2 for a quick burst, more for a double-text later); the first is ignored. photo: only when they send a picture (the player asked for one, or they would on their own): a short description of what it shows, who is in it, what they wear and where; otherwise null.
- left_on_read: true if they read it and do not answer (then messages is []).
- coming_over_minutes: minutes until they get to the player when they are coming over or dropping by; otherwise null.
- plan: a plan they agree on with the player in a few words ("drinks Friday at eight at Lola's"); otherwise null.
- feeling_change: -3..3, how this exchange moves how they feel about the player (0 for most texts; an argument or a hurtful text is negative).
- feeling_note: a few words on why, when feeling_change is not 0; otherwise null.
- life_event: something new in their own life they tell the player, in a few words, third person without their name ("got the job"); otherwise null.
- shared_news: true when they tell the player what has been going on with them lately (their news below).`;

const TEXT_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    messages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          text: { type: 'string' },
          minutes_after_previous: { type: 'number' },
          photo: { type: ['string', 'null'] },
        },
        required: ['from', 'text', 'minutes_after_previous', 'photo'],
        additionalProperties: false,
      },
    },
    left_on_read: { type: 'boolean' },
    coming_over_minutes: { type: ['number', 'null'] },
    plan: { type: ['string', 'null'] },
    feeling_change: { type: 'number' },
    feeling_note: { type: ['string', 'null'] },
    life_event: { type: ['string', 'null'] },
    shared_news: { type: 'boolean' },
  },
  required: ['messages', 'left_on_read', 'coming_over_minutes', 'plan', 'feeling_change', 'feeling_note', 'life_event', 'shared_news'],
  additionalProperties: false,
} as const;

function personLines(db: AppDatabase, entity: EntityRecord): string {
  const now = db.state.inStoryDate;
  const age = entityAge(now, entity);
  const bond = db.bonds.find((item) => item.entityId === entity.id);
  const routine = routineAt(entity, now);
  const doing = whereNow(entity, now) ?? (routine.doing === 'free' ? 'free right now' : routine.doing);
  const intimate = entityCanBeIntimate(db, entity).ok;
  const news = (entity.lifeEvents ?? []).filter((event) => !event.known).slice(-2).map((event) => event.text);
  const profile = entity.intimacy;

  return [
    `${entity.name}${age !== undefined ? `, ${age}` : ''}${entity.gender && entity.gender !== 'unknown' ? `, ${entity.gender}` : ''}${entity.role && entity.role !== 'Unknown' ? `, ${entity.role}` : ''}`,
    entity.personality && entity.personality !== 'Unknown' ? `  Personality: ${entity.personality}` : '',
    entity.speechStyle && entity.speechStyle !== 'Unknown' ? `  How they talk: ${entity.speechStyle}` : '',
    entity.mood && entity.mood !== 'Unknown' ? `  Mood lately: ${entity.mood}` : '',
    bond
      ? `  With the player: ${bond.relationship ?? bond.status}; they feel ${bond.affinity}/10 about them${bond.note ? ` (${bond.note})` : ''}${bond.grudge ? `; holding a grudge: ${bond.grudge.reason ?? 'something the player did'}` : ''}`
      : '  With the player: they barely know each other',
    `  Right now: ${doing}`,
    news.length ? `  Their news the player has not heard: ${news.join('; ')}` : '',
    intimate && profile
      ? `  Heart: ${profile.interestedInPlayer === 'yes' ? 'drawn to the player' : profile.interestedInPlayer === 'could-grow' ? 'could be open to the player' : profile.interestedInPlayer === 'taken' ? `taken${profile.devotion ? ` (${profile.devotion})` : ''}` : 'not interested in the player'}${profile.desires.length ? `; likes ${profile.desires.join(', ')}` : ''}${profile.boundaries.length ? `; won't ${profile.boundaries.join(', ')}` : ''}`
      : '',
    intimate ? '' : '  Nothing sexual or flirty with them.',
  ]
    .filter(Boolean)
    .join('\n');
}

function messageLine(db: AppDatabase, message: PhoneMessage) {
  const who = message.from === PLAYER ? 'Player' : message.from === UNKNOWN ? 'Unknown' : entityOf(db, message.from)?.name ?? 'Someone';
  const when = `${weekdayOf(message.at).slice(0, 3)} ${formatClock(message.at)}`;

  return `[${when}] ${who}: ${message.text}${message.photo ? ` [photo: ${message.photo.description}]` : ''}`;
}

function memoriesWith(db: AppDatabase, ids: string[]): string[] {
  const eventIds = new Set(db.eventEntities.filter((link) => ids.includes(link.entityId)).map((link) => link.eventId));

  return db.events
    .filter((event) => eventIds.has(event.id))
    .slice(-4)
    .map((event) => `- ${event.summary.slice(0, 220)}`);
}

const REASON_LINES: Record<TextReason, string> = {
  reply: "Answer the player's latest texts (or don't, if they wouldn't).",
  unprompted: 'Text the player first, about whatever is on their mind right now: their day, something that reminded them of the player, a plan, missing them, news.',
  birthday: "It is the player's birthday today: text them.",
  holiday: 'It is a holiday today: text the player.',
};

/** The prompt for one text job. Names only; no ids. */
export function buildTextingPrompt(db: AppDatabase, job: MemoryJob) {
  const phone = phoneOf(db);
  const thread = phone.threads.find((item) => item.id === job.threadId);
  const members = (thread?.members ?? []).map((id) => entityOf(db, id)).filter((entity): entity is EntityRecord => Boolean(entity));
  const writers = job.textFrom ? members.filter((entity) => entity.id === job.textFrom) : members;
  const holiday = holidayToday(db.state.inStoryDate);
  const limits = (db.content?.limits ?? []).filter((tag) => tag.kind !== 'soft').map((tag) => tag.label);
  const story = db.summaries.filter((summary) => summary.level === 'arc' || summary.level === 'chapter').slice(-1)[0]?.text;
  const player = db.state.player;

  const content = [
    `NOW: ${formatDate(db.state.inStoryDate)}${holiday && job.textReason === 'holiday' ? ` (${holiday.name})` : ''}`,
    `THE PLAYER: ${playerName(db)}${player.gender ? `, ${player.gender}` : ''}${player.age ? `, ${player.age}` : ''}. Where they are: ${db.state.location || 'unknown'}.`,
    writers.length
      ? `${thread?.group ? `GROUP CHAT${thread.name ? ` "${thread.name}"` : ''} (anyone in it can answer, or nobody)` : 'WHO TEXTS'}\n${writers.map((entity) => personLines(db, entity)).join('\n')}`
      : 'WHO TEXTS\nSomeone the player has no name for: an unknown number. Keep who they are consistent with the texts so far.',
    story ? `THE STORY SO FAR\n${story.slice(0, 700)}` : '',
    memoriesWith(db, members.map((entity) => entity.id)).length ? `WHAT THEY'VE BEEN THROUGH TOGETHER\n${memoriesWith(db, members.map((entity) => entity.id)).join('\n')}` : '',
    limits.length ? `NEVER WRITE: ${limits.join(', ')}.` : '',
    `THE THREAD SO FAR\n${threadMessages(db, job.threadId ?? '').slice(-20).map((message) => messageLine(db, message)).join('\n') || '(nothing yet)'}`,
    `NOW: ${REASON_LINES[job.textReason ?? 'reply']}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return [
    { role: 'system' as const, content: TEXTING_SYSTEM },
    { role: 'user' as const, content },
  ];
}

function readPlan(raw: Record<string, unknown> | null): TextPlan | null {
  if (!raw) return null;

  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => ({
          from: typeof item.from === 'string' ? item.from.trim() : '',
          text: typeof item.text === 'string' ? item.text.trim().slice(0, 800) : '',
          minutesAfter: typeof item.minutes_after_previous === 'number' && Number.isFinite(item.minutes_after_previous) ? Math.max(0, Math.min(item.minutes_after_previous, 600)) : 0,
          ...(typeof item.photo === 'string' && item.photo.trim() ? { photo: item.photo.trim().slice(0, 300) } : {}),
        }))
        .filter((item) => item.text || item.photo)
        .slice(0, 8)
    : [];
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 160) : undefined);
  const minutes = typeof raw.coming_over_minutes === 'number' && raw.coming_over_minutes >= 0 ? Math.min(raw.coming_over_minutes, 180) : undefined;
  const feeling = typeof raw.feeling_change === 'number' ? Math.max(-3, Math.min(3, Math.round(raw.feeling_change))) : 0;

  return {
    messages,
    leftOnRead: raw.left_on_read === true || messages.length === 0,
    ...(minutes !== undefined ? { comingOverMinutes: minutes } : {}),
    ...(text(raw.plan) ? { plan: text(raw.plan) } : {}),
    ...(feeling ? { feelingChange: feeling, feelingNote: text(raw.feeling_note) } : {}),
    ...(text(raw.life_event) ? { lifeEvent: text(raw.life_event) } : {}),
    ...(raw.shared_news === true ? { sharedNews: true } : {}),
  };
}

/** Nothing to answer: a reply job whose texts were already answered. */
function textJobHasWork(db: AppDatabase, job: MemoryJob) {
  return job.textReason !== 'reply' || unanswered(db, job.threadId ?? '').length > 0;
}

/** Calls the model for one text job, using `base` as context. Throws on failure. */
export async function writeTexts(apiKey: string, base: AppDatabase, job: MemoryJob): Promise<TextPlan | null> {
  if (!textJobHasWork(base, job)) return null;

  const request: ChatRequest = {
    apiKey,
    model: base.settings.narrationModel,
    messages: buildTextingPrompt(base, job),
    temperature: 0.9,
    maxTokens: 900,
    reasoning: { effort: 'low', exclude: true },
    jsonSchema: { name: 'text_messages', schema: TEXT_PLAN_SCHEMA as unknown as Record<string, unknown> },
  };

  try {
    const result = await completeChat(request);
    recordDebugCall(job.turnLogId, { kind: 'text', model: request.model, usage: result.usage, finishReason: result.finishReason, apiKey });
    const plan = readPlan(parseJsonObject(result.text));

    if (!plan) throw new Error('The text reply could not be read.');

    return plan;
  } catch (caught) {
    if (!(caught instanceof Error && caught.message === 'The text reply could not be read.')) {
      recordDebugCall(job.turnLogId, { kind: 'text', model: request.model, usage: null, error: caught instanceof Error ? caught.message : String(caught) });
    }
    throw caught;
  }
}

function senderFor(db: AppDatabase, thread: PhoneThread, name: string, fallback?: string): string {
  if (thread.members.length === 0) return UNKNOWN;

  const lower = name.toLowerCase();
  const match = thread.members.find((id) => {
    const entity = entityOf(db, id);
    return entity && (entity.name.toLowerCase() === lower || entity.name.toLowerCase().split(/\s+/)[0] === lower.split(/\s+/)[0] || displayName(db, entity).toLowerCase() === lower);
  });

  return match ?? fallback ?? thread.members[0];
}

/**
 * Puts what came back from a text job on its way: each text lands when the
 * story clock reaches it. A reply's first text waits as long as their
 * routine and feelings say (routines.ts); the rest follow the gaps the
 * model gave. Pure; returns null when the job no longer applies.
 */
export function applyTextPlan(latest: AppDatabase, job: MemoryJob, plan: TextPlan | null): AppDatabase {
  const withoutJob = { ...latest, memoryJobs: (latest.memoryJobs ?? []).filter((entry) => entry.id !== job.id) };
  const phone = phoneOf(withoutJob);
  const thread = phone.threads.find((item) => item.id === job.threadId);

  if (!thread || !plan) return withoutJob;

  const now = withoutJob.state.inStoryDate;
  const first = plan.messages[0];
  const firstFrom = first ? senderFor(withoutJob, thread, first.from, job.textFrom) : (job.textFrom ?? thread.members[0] ?? UNKNOWN);
  const firstEntity = entityOf(withoutJob, firstFrom);
  const lastPlayer = [...threadMessages(withoutJob, thread.id)].reverse().find((message) => message.from === PLAYER);
  const startDelay =
    job.textReason === 'reply' && firstEntity
      ? replyDelayMinutes(withoutJob, firstEntity, now, lastPlayer?.id ?? job.id)
      : job.textReason === 'reply'
        ? 5
        : 1;
  let due = shiftSeconds(now, startDelay * 60);
  const pending: PendingText[] = [];

  plan.messages.forEach((message, index) => {
    if (index > 0) due = shiftSeconds(due, Math.max(0.2, message.minutesAfter) * 60);

    pending.push({
      id: makeId('pending'),
      threadId: thread.id,
      from: senderFor(withoutJob, thread, message.from, job.textFrom),
      text: message.text,
      dueAt: due,
      ...(message.photo ? { photo: message.photo } : {}),
    });
  });

  if (pending.length === 0) {
    pending.push({ id: makeId('pending'), threadId: thread.id, from: firstFrom, text: '', dueAt: due });
  }

  const effects: TextEffects = {
    ...(plan.feelingChange ? { feeling: { delta: plan.feelingChange, note: plan.feelingNote } } : {}),
    ...(plan.plan ? { plan: plan.plan } : {}),
    ...(plan.lifeEvent ? { lifeEvent: plan.lifeEvent } : {}),
    ...(plan.sharedNews ? { sharedNews: true } : {}),
    ...(plan.comingOverMinutes !== undefined ? { comingOverMinutes: plan.comingOverMinutes } : {}),
    ...(plan.leftOnRead ? { leftOnRead: true } : {}),
  };
  const last = pending[pending.length - 1];
  pending[pending.length - 1] = { ...last, effects };

  return withPhone(withoutJob, { ...phone, pending: [...phone.pending, ...pending] });
}

// ---------------------------------------------------------------------------
// Delivery

function textMemoryTitle(db: AppDatabase, thread: PhoneThread) {
  return `Texts with ${threadTitle(db, thread)}`;
}

/**
 * One memory per thread per day, rewritten as texts come and go: texts
 * become memory once the player has read them (an unread text is not
 * something they know yet).
 */
function recordTextMemory(db: AppDatabase, threadId: string): AppDatabase {
  const thread = phoneOf(db).threads.find((item) => item.id === threadId);

  if (!thread) return db;

  const read = phoneOf(db).messages.filter((message) => message.threadId === threadId && message.read && message.text).slice(-30);
  let next = db;

  for (const day of [...new Set(read.map((message) => dayKey(message.at)))]) {
    next = recordTextDay(next, thread, day, read.filter((message) => dayKey(message.at) === day));
  }

  return next;
}

function recordTextDay(db: AppDatabase, thread: PhoneThread, day: string, texts: PhoneMessage[]): AppDatabase {
  const tag = `text:${thread.id}:${day}`;
  const lines = texts.map((message) => `${message.from === PLAYER ? 'you' : entityOf(db, message.from)?.name ?? 'them'}: "${message.text.slice(0, 120)}"`);
  let summary = `By text — ${lines.join(' · ')}`;

  while (summary.length > 420 && lines.length > 1) {
    lines.shift();
    summary = `By text (later that day) — ${lines.join(' · ')}`;
  }

  const existing = db.events.find((event) => event.tags.includes(tag));

  if (existing) {
    return existing.summary === summary.slice(0, 420)
      ? db
      : { ...db, events: db.events.map((event) => (event.id === existing.id ? { ...event, summary: summary.slice(0, 420) } : event)) };
  }

  const event: EventRecord = {
    id: makeId('event'),
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: texts[0].at,
    title: textMemoryTitle(db, thread),
    summary: summary.slice(0, 420),
    importance: 2,
    tags: ['text', tag],
    pinned: false,
    sourceLogId: null,
    createdAt: Date.now(),
  };
  const next = {
    ...db,
    events: [...db.events, event],
    eventEntities: [...db.eventEntities, ...thread.members.map((entityId) => ({ eventId: event.id, entityId, role: 'present' as const }))],
  };

  return { ...next, indices: buildIndices(next) };
}

function applyEffects(db: AppDatabase, pending: PendingText): AppDatabase {
  const effects = pending.effects;
  const entity = entityOf(db, pending.from);

  if (!effects) return db;

  let next = db;
  const phone = phoneOf(next);

  if (effects.leftOnRead && !pending.text) {
    next = withPhone(next, { ...phone, threads: phone.threads.map((thread) => (thread.id === pending.threadId ? { ...thread, readAt: pending.dueAt } : thread)) });
  }

  if (!entity) return next;

  if (effects.feeling && next.bonds.some((bond) => bond.entityId === entity.id)) {
    next = applyBondDiff(next, { entityId: entity.id, character: entity.name, affinityDelta: effects.feeling.delta, ...(effects.feeling.note ? { note: effects.feeling.note } : {}) });
  }
  if (effects.plan) {
    next = applyThreadDiff(next, { action: 'open', title: effects.plan, type: 'plan', participants: [entity.name], description: `Planned by text with ${entity.name}.` });
  }
  if (effects.sharedNews) {
    next = markLifeKnown(next, entity.id);
  }
  if (effects.lifeEvent) {
    next = applyLifeEvents(next, [{ entityId: entity.id, name: entity.name, text: effects.lifeEvent }]);
  }
  if (effects.comingOverMinutes !== undefined) {
    const arriveAt = shiftSeconds(pending.dueAt, effects.comingOverMinutes * 60);
    const current = phoneOf(next);
    next = withPhone(next, { ...current, arrivals: [...current.arrivals.filter((item) => item.entityId !== entity.id), { entityId: entity.id, dueAt: arriveAt }] });
    next = {
      ...next,
      entities: next.entities.map((person) => (person.id === entity.id ? { ...person, whereabouts: 'on the way to you', whereaboutsAt: pending.dueAt } : person)),
    };
  }

  return next;
}

/** Lands every text whose time has come, in order, with what it changes. */
export function deliverDueTexts(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  const due = phoneOf(db).pending.filter((pending) => before(pending.dueAt, now)).sort((a, b) => dateSortValue(a.dueAt) - dateSortValue(b.dueAt));

  if (due.length === 0) return db;

  const dueIds = new Set(due.map((pending) => pending.id));
  let next = withPhone(db, { ...phoneOf(db), pending: phoneOf(db).pending.filter((pending) => !dueIds.has(pending.id)) });
  for (const pending of due) {
    if (pending.text || pending.photo) {
      const message: PhoneMessage = {
        id: makeId('text'),
        threadId: pending.threadId,
        from: pending.from,
        text: pending.text,
        at: pending.dueAt,
        read: false,
        ...(pending.photo ? { photo: { description: pending.photo } } : {}),
      };
      next = withPhone(next, addMessage(phoneOf(next), message));
    }

    next = applyEffects(next, pending);
  }

  return next;
}

/** The next moment something lands: a text or someone arriving. */
export function nextPhoneEvent(db: AppDatabase): CalendarDate | null {
  const phone = phoneOf(db);
  const times = [...phone.pending.map((item) => item.dueAt), ...phone.arrivals.map((item) => item.dueAt)].filter(
    (date) => dateSortValue(date) > dateSortValue(db.state.inStoryDate)
  );

  return times.sort((a, b) => dateSortValue(a) - dateSortValue(b))[0] ?? null;
}

// ---------------------------------------------------------------------------
// The page: what the tracker saw, and texts people send on their own

function idOf(db: AppDatabase, item: { entityId?: string; name: string }) {
  const entity = item.entityId ? entityOf(db, item.entityId) : resolveEntity(db, item.name);

  return entity && !isPlayer(db, entity) ? entity.id : null;
}

function norm(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The phone as the page showed it: numbers swapped, texts that arrived in
 * the prose (read: the player saw them), and texts the player sent there
 * (each gets a reply job). Returns the jobs to run.
 */
export function applyPhoneDiff(db: AppDatabase, diff: TurnDiff['phone']): { db: AppDatabase; jobIds: string[] } {
  if (!diff) return { db, jobIds: [] };

  let next = addContacts(db, (diff.numbersExchanged ?? []).map((item) => idOf(db, item)).filter((id): id is string => Boolean(id)));
  const jobIds: string[] = [];

  for (const item of diff.received ?? []) {
    const id = item.from.toLowerCase() === UNKNOWN ? null : idOf(next, { entityId: item.entityId, name: item.from });
    const opened = ensureThread(next, id ? [id] : []);
    next = opened.db;
    const recent = threadMessages(next, opened.thread.id).slice(-12);

    if (recent.some((message) => norm(message.text) === norm(item.text))) continue;

    const message: PhoneMessage = { id: makeId('text'), threadId: opened.thread.id, from: id ?? UNKNOWN, text: item.text.slice(0, 800), at: next.state.inStoryDate, read: true };
    next = recordTextMemory(withPhone(next, addMessage(phoneOf(next), message)), opened.thread.id);
  }

  for (const item of diff.sent ?? []) {
    const id = idOf(next, { entityId: item.entityId, name: item.to });

    if (!id) continue;

    const opened = ensureThread(next, [id]);
    next = opened.db;

    if (threadMessages(next, opened.thread.id).slice(-6).some((message) => message.from === PLAYER && norm(message.text) === norm(item.text))) continue;

    const sent = sendText(next, opened.thread.id, item.text);
    next = sent.db;
    if (sent.jobId) jobIds.push(sent.jobId);
  }

  return { db: next, jobIds };
}

function inScene(db: AppDatabase, entity: EntityRecord) {
  const cast = new Set((db.state.sceneCast ?? []).map((name) => resolveEntity(db, name)?.id));

  return cast.has(entity.id) || companionsOf(db).some((item) => item.id === entity.id);
}

/**
 * Close people text on their own: now and then when the thread has been
 * quiet, on the player's birthday, and on holidays. Each at most once (per
 * day, or per year). Returns the jobs to run.
 */
export function queueOwnTexts(db: AppDatabase): { db: AppDatabase; jobIds: string[] } {
  const now = db.state.inStoryDate;
  const phone = phoneOf(db);
  const holiday = holidayToday(now);
  const birthday = db.state.player.birthday && db.state.player.birthday.month === now.month && db.state.player.birthday.day === now.day;
  const today = dayKey(now);
  const unpromptedToday = phone.sent.filter((key) => key.startsWith('u:') && key.endsWith(`:${today}`)).length;
  let next = db;
  const jobIds: string[] = [];
  const sent: string[] = [];

  const close = phone.contacts
    .map((contact) => entityOf(db, contact.entityId))
    .filter((entity): entity is EntityRecord => Boolean(entity) && !isDeceased(entity!) && entity!.met !== false && isClose(db, entity!) && !inScene(db, entity!));

  for (const entity of close) {
    const routine = routineAt(entity, now);
    const awake = routine.doing !== 'sleep';
    const thread = phone.threads.find((item) => !item.group && sameMembers(item.members, [entity.id]));
    const quietFor = thread ? secondsBetween(thread.lastAt, now) / 3600 : Infinity;
    const busy = phone.pending.some((item) => item.from === entity.id) || (next.memoryJobs ?? []).some((job) => job.kind === 'text' && job.threadId === thread?.id);

    if (!awake || busy) continue;

    let reason: TextReason | null = null;
    let key = '';

    if (birthday && !phone.sent.includes(`b:${entity.id}:${now.year}`)) {
      reason = 'birthday';
      key = `b:${entity.id}:${now.year}`;
    } else if (holiday && holiday.key !== 'halloween' && (holiday.key !== 'valentines' || ['lover', 'romantic interest'].includes(db.bonds.find((bond) => bond.entityId === entity.id)?.relationship ?? '')) && !phone.sent.includes(`h:${holiday.key}:${entity.id}:${now.year}`)) {
      reason = 'holiday';
      key = `h:${holiday.key}:${entity.id}:${now.year}`;
    } else if (
      unpromptedToday + sent.filter((item) => item.startsWith('u:')).length < UNPROMPTED_PER_DAY &&
      quietFor >= QUIET_HOURS &&
      routine.doing !== 'work' &&
      now.hour >= 9 &&
      now.hour <= 23 &&
      !phone.sent.includes(`u:${entity.id}:${today}`)
    ) {
      // Not every day: about one day in three, after an hour of their own.
      const roll = hashText(`${db.meta.slotId}:own:${entity.id}:${today}`);
      if (roll % 3 === 0 && now.hour >= 10 + (roll % 12)) {
        reason = 'unprompted';
        key = `u:${entity.id}:${today}`;
      }
    }

    if (!reason) continue;

    const opened = ensureThread(next, [entity.id]);
    next = opened.db;
    const job = textJob(next, opened.thread.id, reason, entity.id);
    next = withJob(next, job);
    jobIds.push(job.id);
    sent.push(key);
  }

  if (sent.length === 0) return { db, jobIds: [] };

  const current = phoneOf(next);

  return { db: withPhone(next, { ...current, sent: [...current.sent, ...sent].slice(-200) }), jobIds };
}

/**
 * After a turn: someone who was due to arrive has been told to the narrator
 * (or is in the scene now), so the arrival is done.
 */
export function settleArrivals(before: AppDatabase, after: AppDatabase): AppDatabase {
  const phone = phoneOf(after);
  const kept = phone.arrivals.filter((arrival) => {
    const entity = entityOf(after, arrival.entityId);
    return entity && !inScene(after, entity) && !isDeceased(entity) && dateSortValue(arrival.dueAt) > dateSortValue(before.state.inStoryDate);
  });

  return kept.length === phone.arrivals.length ? after : withPhone(after, { ...phone, arrivals: kept });
}

/**
 * Waits for the next text or arrival: the clock jumps there (at most
 * WAIT_LIMIT_HOURS) and it lands. Null when nothing is on its way.
 */
export function waitForNext(db: AppDatabase): AppDatabase | null {
  const next = nextPhoneEvent(db);

  if (!next) return null;

  const limit = shiftSeconds(db.state.inStoryDate, WAIT_LIMIT_HOURS * 3600);
  const target = dateSortValue(next) <= dateSortValue(limit) ? next : limit;

  return deliverDueTexts({ ...db, state: { ...db.state, inStoryDate: target } });
}

// ---------------------------------------------------------------------------
// Prompt lines

function quote(text: string, max = 90) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return `"${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}"`;
}

/** "Mara (2), Jess" */
function countBy<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();

  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);

  return [...counts].map(([name, count]) => (count > 1 ? `${name} (${count})` : name)).join(', ');
}

/** The narrator's view of the phone: what just buzzed, what's unread, who's on the way. Names only. */
export function formatPhoneBlock(db: AppDatabase): string {
  const phone = phoneOf(db);
  const now = db.state.inStoryDate;

  if (phone.contacts.length === 0 && phone.messages.length === 0 && phone.arrivals.length === 0) return '';

  const lastBeat = [...db.rawLog].reverse().find((entry) => entry.role === 'assistant')?.inStoryDate;
  const unread = phone.messages.filter((message) => !message.read);
  const fresh = unread.filter((message) => !lastBeat || dateSortValue(message.at) > dateSortValue(lastBeat) || secondsBetween(message.at, now) <= 10 * 60);
  const older = unread.filter((message) => !fresh.includes(message));
  const nameOf = (id: string) => (id === UNKNOWN || !hasNumber(db, id) ? 'an unknown number' : displayName(db, entityOf(db, id)));

  const read = phone.messages.filter((message) => message.read && message.text && secondsBetween(message.at, now) <= 3 * 3600).slice(-4);
  const lines = [
    fresh.length ? `- Just buzzed, unread: ${countBy(fresh, (message) => `${nameOf(message.from)}${message.photo ? ' (with a photo)' : ''}`)}. The player feels or hears it; they only know what it says once they look.` : '',
    older.length ? `- Still unread: ${countBy(older, (message) => nameOf(message.from))}.` : '',
    read.length ? `- Recent texts the player has read: ${read.map((message) => `${message.from === PLAYER ? 'you' : nameOf(message.from)}: ${quote(message.text)}`).join(' · ')}` : '',
    ...phone.arrivals.map((arrival) => {
      const entity = entityOf(db, arrival.entityId);
      if (!entity || inScene(db, entity)) return '';
      const minutes = Math.round(secondsBetween(now, arrival.dueAt) / 60);
      return minutes <= 0
        ? `- Arriving now: ${displayName(db, entity)}, who said by text they were coming over. They get here this beat (the buzzer, a knock, or they let themselves in if they have a key).`
        : `- On the way: ${displayName(db, entity)}, about ${minutes} minutes out (they said by text they're coming over).`;
    }),
    '- Replies come on their own time through the phone: never write a text reply someone sends unless it is listed here.',
  ].filter(Boolean);

  return `PHONE\n${lines.join('\n')}`;
}

/** The tracker's view: numbers already saved and texts already on the phone, so nothing is reported twice. */
export function formatPhoneTracking(db: AppDatabase, refOf: (entity: EntityRecord) => string): string {
  const phone = phoneOf(db);
  const saved = phone.contacts.map((contact) => entityOf(db, contact.entityId)).filter((entity): entity is EntityRecord => Boolean(entity)).map(refOf);
  const recent = phone.messages.filter((message) => message.text && daysBetween(message.at, db.state.inStoryDate) < 1).slice(-5);

  if (saved.length === 0 && recent.length === 0) return '';

  return [
    'PHONE (already saved: never report these again)',
    saved.length ? `Numbers saved: ${saved.join(', ')}` : '',
    recent.length ? `Texts already on the phone: ${recent.map((message) => `${message.from === PLAYER ? 'player' : entityOf(db, message.from) ? refOf(entityOf(db, message.from)!) : 'unknown'}: ${quote(message.text, 60)}`).join(' · ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Contacts as people, for the phone screen. */
export function contactsOf(db: AppDatabase): EntityRecord[] {
  return phoneOf(db).contacts
    .map((contact) => entityOf(db, contact.entityId))
    .filter((entity): entity is EntityRecord => Boolean(entity) && !isDeceased(entity!));
}

