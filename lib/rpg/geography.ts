// Where things are, in travel days, from the world the player wrote.
//
// `db.world.regions` lists each region and its neighbours with the days
// between them. This module turns that into a small graph so the engine can
// reason about distance: how long a letter takes, how far a rumour has
// travelled, whether someone could plausibly cross the player's path.
//
// Region ids are the ids in `db.world.regions`. A world with no regions has
// no geography: every lookup returns null and distances fall back to a guess.

import type { AppDatabase, EntityRecord, RegionDef } from './types';

/** A region id from `db.world.regions`. */
export type Region = string;

type WithWorld = Pick<AppDatabase, 'world'>;

/** Days between two regions when the world gives no road between them. */
export const UNKNOWN_DISTANCE_DAYS = 4;

/** Within one region, when it has no neighbours to judge by. */
const SAME_REGION_DAYS = 0.75;

function regionsOf(db: WithWorld | null | undefined): RegionDef[] {
  return Array.isArray(db?.world?.regions) ? db!.world.regions : [];
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordPattern(name: string): RegExp | null {
  const trimmed = name.trim();
  return trimmed.length >= 3 ? new RegExp(`\\b${escape(trimmed)}\\b`, 'i') : null;
}

export function isRegion(db: WithWorld | null | undefined, value: unknown): value is Region {
  return typeof value === 'string' && regionsOf(db).some((region) => region.id === value);
}

/** The region's name as the player wrote it, or null for an unknown id. */
export function regionName(db: WithWorld | null | undefined, id: string | null | undefined): string | null {
  if (!id) return null;
  return regionsOf(db).find((region) => region.id === id)?.name ?? null;
}

/**
 * The region a place description is in, or null when it names none: a region
 * by name, or a place the world lists (its region). Earliest match wins, so
 * "a bar in Old Town, ten minutes from the docks" is Old Town.
 */
export function regionOf(db: WithWorld | null | undefined, text: string | undefined | null): Region | null {
  if (!text) return null;

  const regions = regionsOf(db);
  const places = Array.isArray(db?.world?.places) ? db!.world.places : [];
  let best: { index: number; region: Region } | null = null;

  const consider = (name: string, region: Region) => {
    const pattern = wordPattern(name);
    const match = pattern?.exec(text);

    if (match && (!best || match.index < best.index)) best = { index: match.index, region };
  };

  for (const region of regions) consider(region.name, region.id);

  for (const place of places) {
    if (regions.some((region) => region.id === place.regionId)) consider(place.name, place.regionId);
  }

  return (best as { index: number; region: Region } | null)?.region ?? null;
}

/** Shortest travel days between two regions over the world's neighbour links. */
export function travelDaysBetween(db: WithWorld | null | undefined, from: Region, to: Region): number {
  const regions = regionsOf(db);

  if (from === to) {
    const own = regions.find((region) => region.id === from);
    const nearest = Math.min(...(own?.neighbours ?? []).map((link) => link.days));

    return Number.isFinite(nearest) ? Math.min(SAME_REGION_DAYS, nearest / 2) : SAME_REGION_DAYS;
  }

  // Dijkstra over a handful of regions; links count both ways.
  const edges = new Map<string, { id: string; days: number }[]>();
  const link = (a: string, b: string, days: number) => {
    edges.set(a, [...(edges.get(a) ?? []), { id: b, days }]);
  };

  for (const region of regions) {
    for (const neighbour of region.neighbours ?? []) {
      link(region.id, neighbour.id, neighbour.days);
      link(neighbour.id, region.id, neighbour.days);
    }
  }

  const dist = new Map<string, number>([[from, 0]]);
  const done = new Set<string>();

  while (true) {
    let current: string | null = null;

    for (const [id, days] of dist) {
      if (!done.has(id) && (current === null || days < dist.get(current)!)) current = id;
    }

    if (current === null) break;
    if (current === to) return dist.get(current)!;

    done.add(current);

    for (const next of edges.get(current) ?? []) {
      const through = dist.get(current)! + next.days;

      if (through < (dist.get(next.id) ?? Infinity)) dist.set(next.id, through);
    }
  }

  return UNKNOWN_DISTANCE_DAYS;
}

/** A faction's home region, from its territory. */
function factionRegion(db: WithWorld | null | undefined, entity: EntityRecord): Region | null {
  for (const faction of db?.world?.factions ?? []) {
    if (entity.tags.includes(faction.id) && faction.territoryRegionIds?.length) {
      return faction.territoryRegionIds[0];
    }
  }

  return null;
}

/**
 * Where someone most likely is right now, as far as the save knows: where
 * the story last said they were going, else where the player last saw them,
 * else their role, else their faction's territory.
 */
export function whereaboutsRegion(db: WithWorld | null | undefined, entity: EntityRecord): Region | null {
  return (
    regionOf(db, entity.whereabouts) ??
    regionOf(db, entity.lastSeenAt) ??
    regionOf(db, entity.role) ??
    factionRegion(db, entity)
  );
}

/**
 * The region the player is in now: the one their location names, else the
 * last one on their road (a back alley is still in the district they were
 * last in), else the world's first region, else null (no geography).
 */
export function currentRegion(db: Pick<AppDatabase, 'state' | 'world'>): Region | null {
  const named = regionOf(db, db.state.location);

  if (named) return named;

  const road = db.state.travelLog ?? [];

  for (let index = road.length - 1; index >= 0; index -= 1) {
    const region = road[index].region;

    if (isRegion(db, region)) return region;
  }

  return regionsOf(db)[0]?.id ?? null;
}
