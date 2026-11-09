// Lore entries that switch on or off as the story reaches things: a note that
// ends once a thread resolves, one that starts after a timeline event, and so on.

import type { AppDatabase, LoreCondition, LoreFlag, LoreRecord } from './types';

/** State flags lore can wait for. */
export const LORE_FLAGS: Record<LoreFlag, (db: AppDatabase) => boolean> = {
  // Someone living is your romantic interest or lover.
  inRomance: (db) =>
    db.bonds.some((bond) => {
      if (bond.relationship !== 'lover' && bond.relationship !== 'romantic interest') return false;
      const entity = db.entities.find((item) => item.id === bond.entityId);
      return Boolean(entity && !entity.deceased);
    }),
};

export function conditionHolds(db: AppDatabase, condition: LoreCondition): boolean {
  if (condition.milestone) {
    const progress = db.state.timelineProgress;
    const reached =
      progress?.completed.includes(condition.milestone) || progress?.engaged.includes(condition.milestone);

    if (!reached) return false;
  }

  if (condition.thread) {
    const wanted = condition.thread.trim().toLowerCase();
    const status = condition.threadStatus ?? 'resolved';
    const thread = db.threads.find((item) => item.title.trim().toLowerCase() === wanted);

    if (!thread || thread.status !== status) return false;
  }

  if (condition.fact) {
    const wanted = condition.fact.toLowerCase();

    if (!db.facts.some((fact) => fact.validTo === null && fact.text.toLowerCase().includes(wanted))) return false;
  }

  if (condition.flag && !LORE_FLAGS[condition.flag]?.(db)) {
    return false;
  }

  return true;
}

/** Whether a lore entry applies right now: enabled, past its activeAfter, not yet at its activeUntil. */
export function loreActive(db: AppDatabase, lore: LoreRecord): boolean {
  if (!lore.enabled) return false;
  if (lore.activeAfter && !conditionHolds(db, lore.activeAfter)) return false;
  if (lore.activeUntil && conditionHolds(db, lore.activeUntil)) return false;
  return true;
}
