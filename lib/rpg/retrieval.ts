import { daysBetween, sameDate } from './calendar';
import type {
  AppDatabase,
  EntityRecord,
  EventRecord,
  FactRecord,
  LoreRecord,
  RawLogEntry,
} from './types';

const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','your','with','that','this','have','from',
  'what','when','where','who','how','why','was','were','been','being','into','onto',
  'about','after','before','again','there','their','them','they','then','than','some',
  'just','only','very','much','more','most','over','under','between','through','while',
  'does','doing','done','said','says','say','tell','told','back','away','around',
]);

export type RetrievalQuery = {
  recentMessages: RawLogEntry[];
  userMessage: string;
};

export function retrieveMemories(
  db: AppDatabase,
  query: RetrievalQuery,
  limit: number
): EventRecord[] {
  const combinedText = [
    ...query.recentMessages.map((message) => message.content),
    query.userMessage,
  ]
    .join('\n')
    .toLowerCase();

  const entities = matchEntities(db, combinedText);
  const entityIds = new Set(entities.map((entity) => entity.id));
  const tags = extractTags(combinedText);
  const candidateIds = new Set<string>();

  for (const entity of entities) {
    for (const eventId of db.indices.eventsByEntity[entity.id] ?? []) {
      candidateIds.add(eventId);
    }
  }

  for (const tag of tags) {
    for (const eventId of db.indices.eventsByTag[tag] ?? []) {
      candidateIds.add(eventId);
    }
  }

  const locationEntity = db.entities.find(
    (entity) =>
      entity.type === 'place' &&
      db.state.location.toLowerCase().includes(entity.name.toLowerCase())
  );

  if (locationEntity) {
    for (const eventId of db.indices.eventsByEntity[locationEntity.id] ?? []) {
      candidateIds.add(eventId);
    }
  }

  for (const event of db.events) {
    if (event.pinned) {
      candidateIds.add(event.id);
    }
  }

  if (candidateIds.size < limit * 3) {
    for (const event of [...db.events]
      .sort((a, b) => b.importance - a.importance)
      .slice(0, limit * 3)) {
      candidateIds.add(event.id);
    }
  }

  const eventsById = new Map(db.events.map((event) => [event.id, event]));
  const scored = [...candidateIds]
    .map((id) => eventsById.get(id))
    .filter((event): event is EventRecord => Boolean(event))
    .map((event) => ({
      event,
      score: scoreEvent(event, entityIds, tags, db),
    }))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, limit).map((item) => item.event);

  return selected;
}

function scoreEvent(
  event: EventRecord,
  entityIds: Set<string>,
  tags: Set<string>,
  db: AppDatabase
) {
  let score = event.importance * 2;

  if (event.pinned) {
    score += 10;
  }

  for (const entityId of entityIds) {
    if (db.indices.eventsByEntity[entityId]?.includes(event.id)) {
      score += 5;
    }
  }

  for (const tag of tags) {
    if (event.tags.some((eventTag) => eventTag.toLowerCase() === tag)) {
      score += 3;
    }
  }

  if (sameDate(event.inStoryDate, db.state.inStoryDate)) {
    score += 3;
  }

  const dayDistance = Math.abs(daysBetween(event.inStoryDate, db.state.inStoryDate));

  if (dayDistance <= 7) {
    score += 2;
  } else if (dayDistance <= 30) {
    score += 1;
  }

  return score;
}

export function relevantFacts(
  db: AppDatabase,
  entityIds: Set<string>,
  text: string
): FactRecord[] {
  const active = db.facts.filter((fact) => fact.validTo === null);
  const matched = new Set<FactRecord>();

  for (const entityId of entityIds) {
    for (const factId of db.indices.factsBySubject[entityId] ?? []) {
      const fact = active.find((item) => item.id === factId);

      if (fact) {
        matched.add(fact);
      }
    }
  }

  for (const fact of active) {
    if (text.includes(fact.text.toLowerCase().slice(0, 20))) {
      matched.add(fact);
    }
  }

  if (matched.size < 4) {
    for (const fact of active.slice(0, 4)) {
      matched.add(fact);
    }
  }

  return [...matched].slice(0, 12);
}

export function triggeredLore(db: AppDatabase, text: string): LoreRecord[] {
  const lower = text.toLowerCase();
  const triggered = db.loreEntries.filter(
    (lore) =>
      lore.enabled &&
      lore.keywords.some((keyword) => lower.includes(keyword.toLowerCase()))
  );

  return triggered
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4);
}

function matchEntities(db: AppDatabase, text: string): EntityRecord[] {
  return db.entities.filter((entity) => {
    const names = [entity.name, ...entity.aliases];

    return names.some((name) => name.length > 2 && text.includes(name.toLowerCase()));
  });
}

function extractTags(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOPWORDS.has(word));

  return new Set(words.slice(-80));
}
