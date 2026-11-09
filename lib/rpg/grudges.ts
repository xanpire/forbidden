// Grudges: the dark mirror of romance.
//
// Love is slow and earned; so is resentment. When a bond sours far enough
// (affinity at GRUDGE_AFFINITY or below), or the story shows the player truly
// wrong someone (the state tracker's grudges: wronged), that person starts
// holding a grudge. It lives on their bond:
//
// - heat (0-100) grows while it is left alone (stewing), grows when the player
//   hurts them again, and cools only when the bond really improves.
// - The stage follows the heat: resentful, then vengeful (they want to get
//   back at the player). There is no chase: they act in character when their
//   life and the player's cross, or through ordinary means (a word in the
//   wrong ear, a cold shoulder, a text).
// - It ends only when the story earns it: real amends (the bond climbs back to
//   LET_GO_AFFINITY), a reckoning they accept (settled), forgiveness, or death.
//
// Each grudge also opens a "grudge" thread, so the narrator treats it as
// binding and the Journal shows it.

import { daysBetween } from './calendar';
import { displayName } from './names';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { makeId } from './id';
import { applyFactDiff, applyThreadDiff } from './facts';
import { clamp } from './util';
import type { AppDatabase, BondRecord, CalendarDate, EntityRecord, Grudge, TurnDiff } from './types';
import { isPlayerEntity, playerName } from './player';

/** A bond this cold turns into a grudge. */
export const GRUDGE_AFFINITY = -6;
/** A grudge fades once the bond climbs back this far. */
export const LET_GO_AFFINITY = -2;

export const VENGEFUL_HEAT = 40;

/** Left alone, a grudge gains a point of heat every this many days... */
export const STEW_DAYS = 10;
/** ...up to this much since it last moved. */
export const STEW_CAP = 20;

export type GrudgeStage = 'resentful' | 'vengeful';


export const GRUDGE_RULES = `ENEMIES
- Hatred is the dark mirror of love: slow, earned, and lasting. Someone the player truly wronged remembers it. A grudge grows while it is left alone, never fades just because time passed, and ends only when the story earns it: real amends, a reckoning they accept, their revenge, or death.
- People with a grudge act in character and within what they can really do in an ordinary life: a cold shoulder, gossip, a scene when your paths cross, a text, telling someone a secret. They are rarely stupid, and they never stalk the player across town.`;

export function stageFor(heat: number): GrudgeStage {
  return heat >= VENGEFUL_HEAT ? 'vengeful' : 'resentful';
}

/** Heat now, counting the stewing since it last moved. */
export function grudgeHeat(grudge: Grudge, now: CalendarDate): number {
  const quiet = Math.max(0, daysBetween(grudge.updatedOn, now));

  return clamp(grudge.heat + Math.min(STEW_CAP, Math.floor(quiet / STEW_DAYS)), 0, 100);
}

export function grudgeStage(db: AppDatabase, bond: BondRecord): GrudgeStage | null {
  return bond.grudge ? stageFor(grudgeHeat(bond.grudge, db.state.inStoryDate)) : null;
}

export const STAGE_LABEL: Record<GrudgeStage, string> = {
  resentful: 'Resentful',
  vengeful: 'Wants to get back at you',
};

function threadTitle(name: string) {
  return `${name}'s grudge against you`;
}

function canHold(entity: EntityRecord | undefined): entity is EntityRecord {
  return Boolean(
    entity &&
      entity.type === 'character' &&
      !isPlayerEntity(entity) &&
      !isDeceased(entity)
  );
}

function setGrudge(db: AppDatabase, entityId: string, grudge: Grudge | undefined): AppDatabase {
  return {
    ...db,
    bonds: db.bonds.map((bond) => {
      if (bond.entityId !== entityId) {
        return bond;
      }

      if (grudge) {
        return { ...bond, grudge };
      }

      const { grudge: _old, ...rest } = bond;

      return rest;
    }),
  };
}

function startGrudge(db: AppDatabase, entity: EntityRecord, heat: number, reason: string): AppDatabase {
  const now = db.state.inStoryDate;
  const grudge: Grudge = {
    since: now,
    reason: reason.slice(0, 160) || 'You wronged them.',
    heat: clamp(Math.round(heat), 0, 100),
    updatedOn: now,
  };

  let next = setGrudge(db, entity.id, grudge);
  next = applyThreadDiff(next, {
    action: 'open',
    type: 'grudge',
    title: threadTitle(entity.name),
    description: grudge.reason,
    participants: [entity.name],
  });
  next = applyFactDiff(next, {
    action: 'add',
    type: 'other',
    text: `${displayName(db, entity)} holds a grudge against you: ${grudge.reason}`,
    subject: entity.name,
    whoKnows: [entity.name],
  });

  return next;
}

function endGrudge(db: AppDatabase, entity: EntityRecord, how: 'let-go' | 'settled' | 'forgiven' | 'died', reason?: string) {
  let next = setGrudge(db, entity.id, undefined);
  const outcome: Record<typeof how, string> = {
    'let-go': `${displayName(db, entity)} let go of their grudge against you.`,
    settled: `${displayName(db, entity)}'s grudge against you was settled${reason ? `: ${reason}` : '.'}`,
    forgiven: `${displayName(db, entity)} forgave you${reason ? `: ${reason}` : '.'}`,
    died: `${displayName(db, entity)} died still holding a grudge against you.`,
  };

  next = applyThreadDiff(next, {
    action: 'resolve',
    title: threadTitle(entity.name),
    description: outcome[how],
  });

  if (how !== 'died') {
    next = applyFactDiff(next, {
      action: 'add',
      type: 'other',
      text: outcome[how].slice(0, 200),
      subject: entity.name,
      whoKnows: [entity.name, playerName(db)],
    });
  }

  return next;
}

function entityOf(db: AppDatabase, ref: { entityId?: string; name?: string; character?: string }) {
  return (
    (ref.entityId ? db.entities.find((item) => item.id === ref.entityId) : undefined) ??
    resolveEntity(db, ref.name ?? ref.character ?? '') ??
    undefined
  );
}

function bondFor(db: AppDatabase, entityId: string) {
  return db.bonds.find((bond) => bond.entityId === entityId) ?? null;
}

/**
 * Runs after the turn's bonds and deaths. Bond moves heat or cool a grudge
 * (or start one), the tracker's grudge events start or end one, and the
 * dead let go of theirs.
 */
export function applyGrudgeChanges(
  db: AppDatabase,
  diff: TurnDiff,
  options: { presentIds?: ReadonlySet<string> } = {}
): AppDatabase {
  let next = db;
  const now = next.state.inStoryDate;
  const touched = new Set<string>();

  for (const event of diff.grudges ?? []) {
    const entity = entityOf(next, event);

    if (!canHold(entity)) {
      continue;
    }

    const bond = bondFor(next, entity.id);
    const reason = event.reason?.trim() ?? '';
    touched.add(entity.id);

    if (event.event === 'wronged') {
      // Someone unmet who isn't here only hears of it: no grudge, no bond,
      // and they stay unmet. Only the scene cast makes someone met.
      if (entity.met === false && !options.presentIds?.has(entity.id)) {
        continue;
      }

      if (!bond) {
        // Hatred needs a bond to live on; give them one.
        next = {
          ...next,
          bonds: [
            ...next.bonds,
            {
              id: makeId('bond'),
              entityId: entity.id,
              characterName: entity.name,
              affinity: GRUDGE_AFFINITY,
              status: 'Wronged by you',
              lastKeyEventId: null,
              note: reason,
              isMajor: false,
              relationship: 'stranger',
              attraction: 'none',
              updatedInStoryDate: now,
            },
          ],
        };
      }

      const current = bondFor(next, entity.id)!;

      next = current.grudge
        ? setGrudge(next, entity.id, {
            ...current.grudge,
            heat: clamp(grudgeHeat(current.grudge, now) + 25, 0, 100),
            updatedOn: now,
            reason: current.grudge.reason,
          })
        : startGrudge(next, entity, 45, reason || 'You wronged them.');
      continue;
    }

    if (!bond?.grudge) {
      continue;
    }

    next = endGrudge(next, entity, event.event, reason || undefined);
  }

  for (const change of diff.bonds ?? []) {
    const entity = entityOf(next, change);

    if (!canHold(entity) || touched.has(entity.id)) {
      continue;
    }

    const bond = bondFor(next, entity.id);
    const delta = typeof change.affinityDelta === 'number' ? change.affinityDelta : 0;

    if (!bond) {
      continue;
    }

    if (bond.grudge) {
      if (bond.affinity >= LET_GO_AFFINITY) {
        next = endGrudge(next, entity, 'let-go');
        continue;
      }

      if (delta !== 0) {
        const heat = grudgeHeat(bond.grudge, now) + (delta < 0 ? -delta * 4 : -delta * 5);
        next = setGrudge(next, entity.id, { ...bond.grudge, heat: clamp(heat, 0, 100), updatedOn: now });
      }

      continue;
    }

    if (delta < 0 && bond.affinity <= GRUDGE_AFFINITY) {
      const reason = (change.note?.trim() || change.status?.trim() || bond.note || bond.status || 'You turned them against you.').slice(0, 160);
      next = startGrudge(next, entity, 30 + (GRUDGE_AFFINITY - bond.affinity) * 5, reason);
    }
  }

  // The dead carry their grudges to the grave.
  for (const bond of next.bonds) {
    if (!bond.grudge) continue;
    const entity = next.entities.find((item) => item.id === bond.entityId);

    if (entity && isDeceased(entity)) {
      next = endGrudge(next, entity, 'died');
    }
  }

  return next;
}
