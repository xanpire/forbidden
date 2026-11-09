// World timeline engine: schedules the events the player wrote in
// `db.world.timeline` against the in-story clock, applies the state tracker's
// marks, and routes news to the player.
//
// Rules:
// - World events fire on the in-story date (+ every earlier world event),
//   never on turn counts. Each is stamped with the day it happened.
// - Personal beats (playerDriven) are offers; only the state tracker's marks fire them.
// - Nothing fires or expires while the player is mid-fight.
// - Every fired world event is unheard until someone who could know tells the player,
//   one piece of news per turn.
// - The timeline is empty by default: then nothing here ever fires.

import { daysBetween, daysFromCivil, dateSortValue, shiftDate } from './calendar';
import { markDeathsByName } from './deaths';
import { knowersOf } from './facts';
import { resolveEntity } from './entities';
import { mentionsName } from './characterRefs';
import { secondPerson } from './util';
import { conditionHolds } from './lore';
import { playerDisplayNames, playerEntity, playerName } from './player';
import type {
  AppDatabase,
  CalendarDate,
  FactRecord,
  TimelineEvent,
  TimelineKnowledge,
  TimelineProgress,
  TimelineWindow,
} from './types';

export type { TimelineEvent, TimelineKnowledge, TimelineProgress } from './types';

/** Bumped when the progress shape changes. */
export const TIMELINE_VERSION = 1;

/** At most one piece of world news reaches the player per turn. */
export const NEWS_PER_TURN = 1;

/** Event ids for fired timeline events. */
export const TIMELINE_EVENT_PREFIX = 'event_timeline_';

/** The tag every fired timeline event carries. */
export const TIMELINE_TAG = 'timeline';

/** The player is mid-fight (or mid-chase): the world holds its breath. */
export function isCombatPace(pace: string | undefined): boolean {
  return pace === 'combat' || pace === 'chase';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const eventIdFor = (timelineId: string) => `${TIMELINE_EVENT_PREFIX}${timelineId}`;

function dayKey(window: TimelineWindow): number {
  return daysFromCivil(window.year, window.month, window.day ?? 1);
}

/** The world's timeline, sorted by the day each event's window opens. */
export function timelineOf(db: AppDatabase): TimelineEvent[] {
  const list = Array.isArray(db.world?.timeline) ? db.world.timeline : [];

  return [...list].sort((a, b) => dayKey(a.from) - dayKey(b.from));
}

export function timelineEventById(db: AppDatabase, id: string): TimelineEvent | undefined {
  return (db.world?.timeline ?? []).find((event) => event.id === id);
}

/** The in-story moment an event's window opens (08:00 on its first day). */
export function timelineOpensAt(event: TimelineEvent): CalendarDate {
  return {
    year: event.from.year,
    month: event.from.month,
    day: event.from.day ?? 1,
    hour: 8,
    minute: 0,
    second: 0,
  };
}

function windowOpen(event: TimelineEvent, today: number) {
  return {
    started: today >= dayKey(event.from),
    notClosed: !event.to || today <= dayKey(event.to),
  };
}

export function normalizeTimelineProgress(db: AppDatabase): TimelineProgress {
  const progress = db.state.timelineProgress;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(Boolean) : []);

  if (!progress || !Array.isArray(progress.completed)) {
    return { version: TIMELINE_VERSION, completed: [], active: [], engaged: [] };
  }

  return {
    version: typeof progress.version === 'number' ? progress.version : TIMELINE_VERSION,
    baselineDate: progress.baselineDate,
    completed: list(progress.completed),
    active: list(progress.active),
    engaged: list(progress.engaged),
    expired: list(progress.expired),
    heard: progress.heard && typeof progress.heard === 'object' ? progress.heard : {},
    heldForCombat: Boolean(progress.heldForCombat),
  };
}

function withProgress(db: AppDatabase, progress: TimelineProgress): AppDatabase {
  return {
    ...db,
    state: {
      ...db.state,
      timelineProgress: { ...progress, completed: [...new Set(progress.completed)] },
    },
  };
}

const addId = (list: string[], id: string) => (list.includes(id) ? list : [...list, id]);
const dropId = (list: string[], id: string) => list.filter((item) => item !== id);

/** Adds a confirmed event fact unless an open fact with the same text exists. */
function addFactOnce(
  db: AppDatabase,
  id: string,
  text: string,
  whoKnows: string[],
  validFrom: CalendarDate = db.state.inStoryDate,
  subjectEntityId: string | null = factSubject(db, text),
  sourceEventId: string | null = null
): AppDatabase {
  // Timeline text may name the player; what you read says "you".
  text = secondPerson(text, playerDisplayNames(db));
  const lower = text.toLowerCase();

  if (db.facts.some((fact) => fact.validTo === null && fact.text.toLowerCase() === lower)) {
    return db;
  }

  const knowers = knowersOf(db, whoKnows);
  const fact: FactRecord = {
    id,
    subjectEntityId,
    type: 'event',
    text: text.slice(0, 200),
    whoKnows: knowers.ids,
    ...(knowers.groups.length > 0 ? { whoKnowsGroups: knowers.groups } : {}),
    validFrom,
    validTo: null,
    confidence: 'confirmed',
    sourceEventId,
  };

  return { ...db, facts: [...db.facts, fact] };
}

function addMissedFact(db: AppDatabase, event: TimelineEvent): AppDatabase {
  if (!event.attendanceFact) {
    return db;
  }

  const who = event.encounter?.who ?? event.title;

  return addFactOnce(
    db,
    `fact_missed_${event.id}`,
    `You never crossed paths with ${who} before this window closed.`,
    [playerName(db)]
  );
}

function resolveThread(db: AppDatabase, titleKey: string): AppDatabase {
  const lower = titleKey.toLowerCase();

  return {
    ...db,
    threads: db.threads.map((thread) =>
      thread.status === 'open' &&
      (thread.title.toLowerCase() === lower || thread.title.toLowerCase().includes(lower))
        ? { ...thread, status: 'resolved', resolvedAt: db.state.inStoryDate }
        : thread
    ),
  };
}

/** Who a timeline fact is about: you when it says "you", else the first person it names, else you. */
function factSubject(db: AppDatabase, text: string): string | null {
  const you = playerEntity(db);

  if (/\b(you|your)\b/i.test(text)) {
    return you?.id ?? null;
  }

  let first: { id: string; at: number } | null = null;

  for (const entity of db.entities) {
    if (entity.type !== 'character' || entity === you) continue;

    for (const name of [entity.name, ...entity.aliases]) {
      const at = text.toLowerCase().indexOf(name.toLowerCase());

      if (at !== -1 && mentionsName(text, name) && (!first || at < first.at)) {
        first = { id: entity.id, at };
      }
    }
  }

  return first?.id ?? you?.id ?? null;
}

/** Where a personal beat stands: offered to you, accepted (under way), or completed on the page. */
export function timelineStage(db: AppDatabase, id: string): 'offered' | 'accepted' | 'completed' | null {
  const progress = normalizeTimelineProgress(db);

  if (progress.completed.includes(id)) return 'completed';
  if (progress.engaged.includes(id)) return 'accepted';
  if (upcomingTimelineBeats(db, 99).some((event) => event.id === id)) return 'offered';
  return null;
}

export const hasFired = (db: AppDatabase, id: string) => db.events.some((event) => event.id === eventIdFor(id));

/** Records the timeline event as a story event plus its facts, threads and world point. */
function fireEvent(
  db: AppDatabase,
  event: TimelineEvent,
  happenedAt: CalendarDate = db.state.inStoryDate,
  /** Who saw it happen (the player and the scene cast); world events go by how word travels instead. */
  witnesses?: string[]
): AppDatabase {
  if (hasFired(db, event.id)) {
    return db;
  }

  let next: AppDatabase = {
    ...db,
    events: [
      ...db.events,
      {
        id: eventIdFor(event.id),
        chapter: db.state.chapter,
        scene: 'World event',
        inStoryDate: happenedAt,
        summary: `${event.title}: ${event.description}`.slice(0, 240),
        importance: event.major ? 5 : 3,
        tags: [TIMELINE_TAG, `timeline-${event.id}`, ...(event.era ? [event.era.toLowerCase()] : [])],
        pinned: Boolean(event.major),
        sourceLogId: null,
        createdAt: Date.now(),
      },
    ],
  };

  // Outcome facts carry the real moment, who they are about, and who knows:
  // the people who were there, or (for world events) the groups word reaches.
  const knowers = witnesses ?? [`${event.knowledge ?? 'public'} knowledge`];

  for (const text of event.facts ?? []) {
    next = addFactOnce(
      next,
      `fact_timeline_${event.id}_${next.facts.length}`,
      text,
      knowers,
      happenedAt,
      factSubject(next, text),
      eventIdFor(event.id)
    );
  }

  if (event.deaths?.length) {
    next = markDeathsByName(next, event.deaths, {
      date: happenedAt,
      timelineEventId: eventIdFor(event.id),
    });
  }

  for (const [name, status] of Object.entries(event.setsStatus ?? {})) {
    const entity = resolveEntity(next, name);

    if (entity) {
      next = { ...next, entities: next.entities.map((item) => (item.id === entity.id ? { ...item, status } : item)) };
    }
  }

  for (const title of event.resolvesThreadTitles ?? []) {
    next = resolveThread(next, title);
  }

  for (const seed of event.opensThreads ?? []) {
    const lower = seed.title.toLowerCase();

    if (next.threads.some((thread) => thread.title.toLowerCase() === lower)) {
      continue;
    }

    next = {
      ...next,
      threads: [
        ...next.threads,
        {
          id: `thread_timeline_${event.id}_${next.threads.length}`,
          type: seed.type,
          title: seed.title,
          description: secondPerson(seed.description, playerDisplayNames(next)),
          status: 'open',
          openedAt: happenedAt,
          resolvedAt: null,
          importance: seed.importance ?? 3,
          participants: seed.participants ?? [],
          participantIds: (seed.participants ?? [])
            .map((name) => resolveEntity(next, name)?.id)
            .filter((id): id is string => Boolean(id)),
          sourceEventId: eventIdFor(event.id),
        },
      ],
    };
  }

  if (event.worldPoint) {
    next = { ...next, state: { ...next.state, worldPoint: event.worldPoint.slice(0, 220) } };
  }

  return next;
}

/** A gated beat is open only once the beat it follows has actually happened. */
function gateOpen(db: AppDatabase, event: TimelineEvent): boolean {
  return (!event.after || hasFired(db, event.after)) && (!event.requires || conditionHolds(db, event.requires));
}

/** You and whoever is in the scene. */
function sceneWitnesses(db: AppDatabase): string[] {
  return [playerName(db), ...(db.state.sceneCast ?? [])];
}

// ---------------------------------------------------------------------------
// State-tracker marks
// ---------------------------------------------------------------------------

/**
 * completed → happened with the player there (attendance fact, heard as "witnessed").
 * engaged   → a personal beat has started but not finished.
 * passed    → the window closed without the player; logs a "never crossed paths" fact.
 */
export function applyTimelineMarks(
  db: AppDatabase,
  completedIds: string[],
  engagedIds: string[],
  passedIds: string[] = []
): AppDatabase {
  let next = db;
  let progress = normalizeTimelineProgress(next);

  for (const id of completedIds) {
    const event = timelineEventById(next, id);

    if (!event) {
      continue;
    }

    if (!progress.completed.includes(id)) {
      // The state reply confirmed the moment itself: it happens now, seen by
      // you and whoever is in the scene.
      next = fireEvent(next, event, next.state.inStoryDate, sceneWitnesses(next));
      progress = { ...progress, completed: [...progress.completed, id] };
    }

    progress = {
      ...progress,
      heard: {
        ...(progress.heard ?? {}),
        [eventIdFor(id)]: { from: 'witnessed', date: next.state.inStoryDate },
      },
      active: dropId(progress.active, id),
      engaged: dropId(progress.engaged, id),
    };

    if (event.attendanceFact) {
      next = addFactOnce(next, `fact_attended_${id}`, event.attendanceFact, [playerName(next)]);
    }
  }

  for (const id of engagedIds) {
    const event = timelineEventById(next, id);

    if (!event?.playerDriven || progress.completed.includes(id)) {
      continue;
    }

    // Accepted, not done: nothing it promises is true yet (no facts, no
    // threads, no world point) until the state reply marks it completed.
    progress = {
      ...progress,
      active: addId(progress.active, id),
      engaged: addId(progress.engaged, id),
    };
  }

  for (const id of passedIds) {
    const event = timelineEventById(next, id);

    if (!event?.attendanceFact) {
      continue;
    }

    if (!progress.completed.includes(id)) {
      next = fireEvent(next, event);
    }

    progress = {
      ...progress,
      completed: addId(progress.completed, id),
      active: dropId(progress.active, id),
      engaged: dropId(progress.engaged, id),
    };
    next = addMissedFact(next, event);
  }

  return withProgress(next, progress);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Moves the world forward to the current in-story date. Only the date decides
 * what fires — never how many turns have been played. While the player is in a fight
 * nothing fires or expires; everything due waits until the fight is over.
 */
export function advanceTimeline(db: AppDatabase, options: { inCombat?: boolean } = {}): AppDatabase {
  let next = db;
  let progress = normalizeTimelineProgress(next);
  const now = next.state.inStoryDate;
  const inCombat = options.inCombat ?? isCombatPace(next.state.scenePace);

  if (!progress.baselineDate) {
    progress = { ...progress, version: TIMELINE_VERSION, baselineDate: now };
  }

  if (inCombat) {
    return withProgress(next, { ...progress, heldForCombat: true });
  }

  progress = { ...progress, heldForCombat: false };

  const baseline = progress.baselineDate ?? now;
  const baselineKey = dayKey(baseline);
  const baselineSort = dateSortValue(baseline);
  const nowSort = dateSortValue(now);
  const today = dayKey(now);
  const completed = new Set(progress.completed);
  const complete = (id: string) => {
    completed.add(id);
    progress = { ...progress, completed: addId(progress.completed, id) };
  };

  // A world event is stamped with the day it happened, not the day the player's
  // clock caught up with it (clamped to the start of this save).
  const happenedAt = (event: TimelineEvent): CalendarDate => {
    const opens = timelineOpensAt(event);
    const sort = dateSortValue(opens);

    if (sort > nowSort) return now;
    if (sort < baselineSort) return baseline;
    return opens;
  };

  // Every earlier world event must have fired first.
  let worldChainIntact = true;

  for (const event of timelineOf(next)) {
    const { id } = event;

    if (completed.has(id)) {
      continue;
    }

    // Closed before this save began: done silently, never shown.
    if (event.to && dayKey(event.to) < baselineKey) {
      complete(id);
      progress = { ...progress, expired: addId(progress.expired ?? [], id) };
      continue;
    }

    const { started, notClosed } = windowOpen(event, today);

    if (event.playerDriven) {
      if (progress.engaged.includes(id)) {
        progress = { ...progress, active: addId(progress.active, id) };
      } else if (!notClosed) {
        complete(id);
        progress = { ...progress, active: dropId(progress.active, id) };
        if (gateOpen(next, event)) {
          next = addMissedFact(next, event);
        }
      }

      continue;
    }

    if (!started || !worldChainIntact) {
      worldChainIntact = false;
      continue;
    }

    next = fireEvent(next, event, happenedAt(event));
    complete(id);

    if (event.encounter) {
      if (notClosed) {
        progress = { ...progress, active: addId(progress.active, id) };
      } else {
        next = addMissedFact(next, event);
      }
    }
  }

  // Close encounter windows that have run out.
  for (const activeId of [...progress.active]) {
    const event = timelineEventById(next, activeId);

    if (event && !(event.to && today > dayKey(event.to))) {
      continue;
    }

    progress = { ...progress, active: dropId(progress.active, activeId) };

    if (!event) {
      continue;
    }

    const wasEngaged = progress.engaged.includes(activeId);

    complete(activeId);
    progress = { ...progress, engaged: dropId(progress.engaged, activeId) };

    // A beat you accepted is not missed: if the page never showed the moment
    // itself, it happened off the page by the time its window closed.
    if (!wasEngaged) {
      next = addMissedFact(next, event);
    } else if (!hasFired(next, event.id)) {
      next = fireEvent(next, event, next.state.inStoryDate, sceneWitnesses(next));
    }
  }

  return withProgress(next, progress);
}

// ---------------------------------------------------------------------------
// Queries used by the prompt
// ---------------------------------------------------------------------------

export function activeTimelineEvents(db: AppDatabase): TimelineEvent[] {
  const progress = normalizeTimelineProgress(db);

  return timelineOf(db).filter(({ id }) => progress.active.includes(id) && !progress.completed.includes(id));
}

/** How many personal beats the narrator is offered per turn. */
export const PERSONAL_OFFERS_PER_TURN = 2;

/**
 * Personal beats whose window is open and that have not started: priority
 * beats first, then the one closing soonest, so a short offer is not buried
 * under a beat that stays open for years.
 */
export function upcomingTimelineBeats(db: AppDatabase, limit = 3): TimelineEvent[] {
  const progress = normalizeTimelineProgress(db);
  const today = dayKey(db.state.inStoryDate);
  const closes = (event: TimelineEvent) => (event.to ? dayKey(event.to) : Number.POSITIVE_INFINITY);

  return timelineOf(db)
    .filter((event) => {
      const { started, notClosed } = windowOpen(event, today);

      return (
        event.playerDriven &&
        !progress.completed.includes(event.id) &&
        !progress.engaged.includes(event.id) &&
        started &&
        notClosed &&
        gateOpen(db, event)
      );
    })
    .sort((a, b) => {
      if (Boolean(a.priority) !== Boolean(b.priority)) return a.priority ? -1 : 1;
      return closes(a) === closes(b) ? 0 : closes(a) < closes(b) ? -1 : 1;
    })
    .slice(0, limit);
}

export function recentlyConcludedTimelineEvents(db: AppDatabase, limit = 3): TimelineEvent[] {
  const progress = normalizeTimelineProgress(db);
  const expired = new Set(progress.expired ?? []);

  return timelineOf(db)
    .filter(({ id }) => progress.completed.includes(id) && !expired.has(id))
    .slice(-limit)
    .reverse();
}

/** World events planned within the next `days` days (at most 3). */
export function upcomingWorldEvents(db: AppDatabase, days = 10): { event: TimelineEvent; daysUntil: number }[] {
  const progress = normalizeTimelineProgress(db);
  const now = db.state.inStoryDate;
  const today = dayKey(now);
  const horizon = dayKey(shiftDate(now, days));

  return timelineOf(db)
    .filter((event) => {
      const opens = dayKey(event.from);

      return !event.playerDriven && !progress.completed.includes(event.id) && opens > today && opens <= horizon;
    })
    .map((event) => ({
      event,
      daysUntil: Math.max(0, daysBetween(now, timelineOpensAt(event))),
    }))
    .sort((a, b) => a.daysUntil - b.daysUntil)
    .slice(0, 3);
}

export function recentTimelineEvents(db: AppDatabase, limit = 4) {
  return db.events
    .filter((event) => event.tags.includes(TIMELINE_TAG))
    .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// News: where events happen, who could know, and how word travels
// ---------------------------------------------------------------------------

/** The name of the region an event happens in, or the world's name. */
export function timelineRegion(db: AppDatabase, event: TimelineEvent): string {
  const region = event.regionId ? db.world?.regions?.find((item) => item.id === event.regionId) : undefined;

  return region?.name ?? (db.world?.name?.trim() || 'the world');
}

export function timelineLocation(db: AppDatabase, event: TimelineEvent): string {
  return event.location ?? timelineRegion(db, event);
}

export function timelineKnowledge(event: TimelineEvent): TimelineKnowledge {
  return event.knowledge ?? 'public';
}

/** The named people who can carry this news. */
export function timelineBearers(event: TimelineEvent): string[] {
  return event.bearers ?? [];
}

/** How word of this event travels: the faction's own carriers, or the world's. */
export function timelineChannel(db: AppDatabase, event: TimelineEvent): string {
  const knowledge = timelineKnowledge(event);

  if (knowledge === 'secret') return 'only a named confidant, face to face';
  if (knowledge === 'witnesses') return 'only someone who was actually there';

  const faction = event.factionId ? db.world?.factions?.find((item) => item.id === event.factionId) : undefined;
  const carriers = faction?.carriers?.length ? faction.carriers : db.world?.letterCarriers ?? [];

  if (carriers.length > 0) {
    return carriers.slice(0, 3).join(', or ');
  }

  return knowledge === 'faction' ? 'a messenger from the group itself' : 'a traveller, a local, or the talk of the town';
}

export type UnheardNews = {
  eventId: string;
  timelineId: string;
  title: string;
  summary: string;
  date: CalendarDate;
  major: boolean;
  region: string;
  location: string;
  bearers: string[];
  channel: string;
  knowledge: TimelineKnowledge;
  /** For faction knowledge: whose members know. */
  factionId?: string;
  daysOld: number;
};

/** Major news counts this many times over while it waits. */
export const MAJOR_NEWS_WEIGHT = 4;

/** Waiting this long (weighted) makes news overdue: a week for major news, four for minor. */
export const NEWS_OVERDUE_WEIGHTED_DAYS = 28;

/** Waiting this long (weighted) makes news due: it should come in when any bearer fits. */
export const NEWS_DUE_WEIGHTED_DAYS = 12;

/**
 * How pressing a piece of news is. Major news escalates fast; minor news
 * escalates too, just four times slower, so it never starves behind the big
 * stories.
 */
export function newsUrgency(item: Pick<UnheardNews, 'major' | 'daysOld'>): 'fresh' | 'due' | 'overdue' {
  const weighted = item.daysOld * (item.major ? MAJOR_NEWS_WEIGHT : 1);

  if (weighted >= NEWS_OVERDUE_WEIGHTED_DAYS) return 'overdue';
  if (weighted >= NEWS_DUE_WEIGHTED_DAYS) return 'due';
  return 'fresh';
}

/** Queue order: (days waiting + 1) × weight, so fresh major news leads but old minor news catches up. */
function newsPriority(item: Pick<UnheardNews, 'major' | 'daysOld'>) {
  return (item.daysOld + 1) * (item.major ? MAJOR_NEWS_WEIGHT : 1);
}

/** The last time any news reached the player (not counting beats they witnessed), or the story's start. */
export function lastNewsHeardDate(db: AppDatabase): CalendarDate {
  const progress = normalizeTimelineProgress(db);
  let latest: CalendarDate | null = null;

  for (const record of Object.values(progress.heard ?? {})) {
    if (record.from === 'witnessed' || !record.date) {
      continue;
    }

    if (!latest || dateSortValue(record.date) > dateSortValue(latest)) {
      latest = record.date;
    }
  }

  return latest ?? progress.baselineDate ?? db.state.inStoryDate;
}

/**
 * Fired events the player has not heard about, most pressing first: by weighted
 * waiting time, then major first, then oldest first.
 */
export function unheardNews(db: AppDatabase, limit = 3): UnheardNews[] {
  const heard = normalizeTimelineProgress(db).heard ?? {};
  const news: UnheardNews[] = [];

  for (const record of db.events) {
    if (!record.tags.includes(TIMELINE_TAG) || heard[record.id]) {
      continue;
    }

    const timelineId = record.id.replace(TIMELINE_EVENT_PREFIX, '');
    const event = timelineEventById(db, timelineId);

    if (!event) {
      continue;
    }

    news.push({
      eventId: record.id,
      timelineId,
      title: event.title,
      summary: event.description,
      date: record.inStoryDate,
      major: Boolean(event.major),
      region: timelineRegion(db, event),
      location: timelineLocation(db, event),
      bearers: timelineBearers(event),
      channel: timelineChannel(db, event),
      knowledge: timelineKnowledge(event),
      ...(event.factionId ? { factionId: event.factionId } : {}),
      daysOld: Math.max(0, daysBetween(record.inStoryDate, db.state.inStoryDate)),
    });
  }

  return news
    .sort(
      (a, b) =>
        newsPriority(b) - newsPriority(a) ||
        (a.major !== b.major ? (a.major ? -1 : 1) : dayKey(a.date) - dayKey(b.date))
    )
    .slice(0, limit);
}

/**
 * Records who told the player. Accepts at most `limit` relays per call: one piece
 * of news per turn, or the size of a catch-up report (see newsDelivery.ts).
 */
export function markNewsHeard(
  db: AppDatabase,
  relays: { id: string; from?: string }[],
  limit = NEWS_PER_TURN
): AppDatabase {
  if (relays.length === 0) {
    return db;
  }

  const progress = normalizeTimelineProgress(db);
  const heard = { ...(progress.heard ?? {}) };
  let delivered = 0;

  for (const relay of relays) {
    if (delivered >= limit) {
      break;
    }

    const eventId = relay.id.startsWith(TIMELINE_EVENT_PREFIX) ? relay.id : eventIdFor(relay.id);

    if (heard[eventId] || !db.events.some((event) => event.id === eventId)) {
      continue;
    }

    delivered += 1;
    heard[eventId] = { from: relay.from?.trim() || 'a rumor', date: db.state.inStoryDate };
  }

  return withProgress(db, { ...progress, heard });
}

export function hasHeardNews(db: AppDatabase, eventId: string): boolean {
  return Boolean(normalizeTimelineProgress(db).heard?.[eventId]);
}

// ---------------------------------------------------------------------------
// World clock: a read-only view of the scheduler for the hidden screen.
// ---------------------------------------------------------------------------

export type WorldClockFired = {
  event: TimelineEvent;
  date: CalendarDate;
  heardFrom: string | null;
  heardOn: CalendarDate | null;
  expired: boolean;
};

export type WorldClockQueued = {
  event: TimelineEvent;
  opensAt: CalendarDate;
  daysUntil: number;
  /** Its date has arrived but it is waiting (a fight, or an earlier event). */
  due: boolean;
};

export type WorldClock = {
  now: CalendarDate;
  heldForCombat: boolean;
  inCombat: boolean;
  fired: WorldClockFired[];
  unheard: UnheardNews[];
  queued: WorldClockQueued[];
  offers: TimelineEvent[];
  missed: TimelineEvent[];
};

export function worldClock(db: AppDatabase): WorldClock {
  const progress = normalizeTimelineProgress(db);
  const completed = new Set(progress.completed);
  const expired = new Set(progress.expired ?? []);
  const heard = progress.heard ?? {};
  const now = db.state.inStoryDate;
  const nowSort = dateSortValue(now);
  const today = dayKey(now);
  const all = timelineOf(db);
  const world = all.filter((event) => !event.playerDriven);
  const personal = all.filter((event) => event.playerDriven);

  const fired: WorldClockFired[] = world
    .flatMap((event) => {
      const record = db.events.find((item) => item.id === eventIdFor(event.id));

      if (!record && !completed.has(event.id)) {
        return [];
      }

      const heardRecord = heard[eventIdFor(event.id)];

      return [
        {
          event,
          date: record?.inStoryDate ?? timelineOpensAt(event),
          heardFrom: heardRecord?.from ?? null,
          heardOn: heardRecord?.date ?? null,
          expired: expired.has(event.id) && !record,
        },
      ];
    })
    .sort((a, b) => dateSortValue(b.date) - dateSortValue(a.date));

  const queued: WorldClockQueued[] = world
    .filter((event) => !completed.has(event.id))
    .map((event) => {
      const opensAt = timelineOpensAt(event);

      return {
        event,
        opensAt,
        daysUntil: Math.max(0, daysBetween(now, opensAt)),
        due: dateSortValue(opensAt) <= nowSort,
      };
    });

  const offers = personal.filter((event) => {
    const { started, notClosed } = windowOpen(event, today);
    return !completed.has(event.id) && started && notClosed;
  });

  const missed = personal.filter(
    (event) => completed.has(event.id) && db.facts.some((fact) => fact.id === `fact_missed_${event.id}`)
  );

  return {
    now,
    heldForCombat: Boolean(progress.heldForCombat),
    inCombat: isCombatPace(db.state.scenePace),
    fired,
    unheard: unheardNews(db, 99),
    queued,
    offers,
    missed,
  };
}
