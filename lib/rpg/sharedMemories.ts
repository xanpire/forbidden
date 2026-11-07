// The memories a person shares with Kan: ones they were there for.

import { dateSortValue } from './calendar';
import type { AppDatabase, EventRecord } from './types';

/**
 * Memories this person was present for (or took part in), newest first.
 * Being named in a memory's text is not sharing it.
 */
export function sharedMemories(db: AppDatabase, entityId: string, limit = 12): EventRecord[] {
  const eventIds = new Set(
    db.eventEntities
      .filter((link) => link.entityId === entityId && (link.role === 'present' || link.role === 'participant'))
      .map((link) => link.eventId)
  );

  return db.events
    .filter((event) => eventIds.has(event.id) && !event.tags.includes('canon'))
    .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
    .slice(0, limit);
}
