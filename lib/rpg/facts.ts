// Permanent facts, plot threads and scene-end memories from a turn.

import { normalizeDate } from './calendar';
import { resolveEntity } from './entities';
import { makeId } from './id';
import { trimToSentence, uniqueList } from './util';
import type { AppDatabase, EntityRecord, EventRecord, TurnDiff } from './types';

type FactDiff = NonNullable<TurnDiff['facts']>[number];

type ThreadDiff = NonNullable<TurnDiff['threads']>[number];

export function applyFactDiff(db: AppDatabase, fact: FactDiff): AppDatabase {
  if (!fact?.text || typeof fact.text !== 'string') {
    return db;
  }

  const text = fact.text.trim();

  if (!text) {
    return db;
  }

  const currentDate = fact.validFrom
    ? normalizeDate(fact.validFrom, db.state.inStoryDate)
    : db.state.inStoryDate;

  if (fact.action === 'end') {
    const facts = db.facts.map((item) => {
      if (
        item.validTo === null &&
        (item.text.toLowerCase() === text.toLowerCase() ||
          item.text.toLowerCase().includes(text.toLowerCase()))
      ) {
        return {
          ...item,
          validTo: currentDate,
        };
      }

      return item;
    });

    return {
      ...db,
      facts,
    };
  }

  const subjectEntity = fact.subject ? resolveEntity(db, fact.subject) : null;

  const duplicate = db.facts.find(
    (item) =>
      item.validTo === null &&
      (item.text.toLowerCase() === text.toLowerCase() ||
        (text.length > 30 &&
          item.text.toLowerCase().includes(text.toLowerCase())))
  );

  if (duplicate) {
    return db;
  }

  const newFact = {
    id: makeId('fact'),
    subjectEntityId: subjectEntity?.id ?? null,
    type: fact.type ?? 'other',
    text: text.slice(0, 200),
    whoKnows: Array.isArray(fact.whoKnows) ? fact.whoKnows.filter(Boolean) : [],
    validFrom: currentDate,
    validTo: null,
    confidence: 'confirmed' as const,
    sourceEventId: null,
  };

  return {
    ...db,
    facts: [...db.facts, newFact],
  };
}

export function applyThreadDiff(db: AppDatabase, thread: ThreadDiff): AppDatabase {
  if (!thread?.title || typeof thread.title !== 'string') {
    return db;
  }

  const title = thread.title.trim().toLowerCase();

  if (!title) {
    return db;
  }

  const descriptionKey = (thread.description?.trim() || title).toLowerCase().slice(0, 40);
  const existingIndex = db.threads.findIndex(
    (item) =>
      item.title.toLowerCase() === title ||
      (thread.description?.trim() &&
        item.status === 'open' &&
        (item.title.toLowerCase().startsWith(descriptionKey) ||
          item.description.toLowerCase().startsWith(descriptionKey) ||
          descriptionKey.startsWith(item.title.toLowerCase().slice(0, 40))))
  );

  if (thread.action === 'resolve') {
    if (existingIndex === -1) {
      return db;
    }

    const threads = [...db.threads];
    threads[existingIndex] = {
      ...threads[existingIndex],
      status: 'resolved',
      resolvedAt: db.state.inStoryDate,
      description: thread.description?.trim() || threads[existingIndex].description,
    };

    return {
      ...db,
      threads,
    };
  }

  if (existingIndex === -1) {
    const newThread = {
      id: makeId('thread'),
      type: thread.type ?? 'other',
      title,
      description: thread.description?.trim() || '',
      status: 'open' as const,
      openedAt: db.state.inStoryDate,
      resolvedAt: null,
      importance: 3 as 1 | 2 | 3 | 4 | 5,
      participants: Array.isArray(thread.participants)
        ? thread.participants.filter(Boolean)
        : [],
      sourceEventId: null,
    };

    return {
      ...db,
      threads: [...db.threads, newThread],
    };
  }

  const threads = [...db.threads];
  threads[existingIndex] = {
    ...threads[existingIndex],
    description: thread.description?.trim() || threads[existingIndex].description,
    type: thread.type ?? threads[existingIndex].type,
    participants: Array.isArray(thread.participants)
      ? uniqueList([...threads[existingIndex].participants, ...thread.participants])
      : threads[existingIndex].participants,
  };

  return {
    ...db,
    threads,
  };
}

export function recordSceneEvent(db: AppDatabase, diff: TurnDiff): AppDatabase {
  const scene = diff.scene;
  const summary =
    scene?.summary?.trim() ||
    trimToSentence(
      db.rawLog
        .filter((message) => message.kind === 'story')
        .slice(-2)
        .map((message) => message.content)
        .join(' ')
    ).slice(0, 240);

  if (!summary) {
    return db;
  }

  const event: EventRecord = {
    id: makeId('event'),
    chapter: db.state.chapter,
    scene: db.state.scene,
    inStoryDate: db.state.inStoryDate,
    summary: trimToSentence(summary.slice(0, 220)),
    importance: scene?.importance ?? 3,
    tags: Array.isArray(scene?.tags) ? scene.tags.filter(Boolean).slice(0, 6) : [],
    pinned: false,
    sourceLogId: null,
    createdAt: Date.now(),
  };

  const eventEntities = (scene?.entities ?? [])
    .map((name) => resolveEntity(db, name))
    .filter((entity): entity is EntityRecord => Boolean(entity))
    .map((entity) => ({
      eventId: event.id,
      entityId: entity.id,
      role: 'present' as const,
    }));

  return {
    ...db,
    events: [...db.events, event],
    eventEntities: [...db.eventEntities, ...eventEntities],
  };
}
