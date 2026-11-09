// Where the player has been, and where the people they know are (living-world
// Stage 4, section 14).
//
// Built on the world the player wrote: its regions (with travel days between
// them) and the places inside them. There are no map coordinates; the You tab
// shows a list (regions → places, the player's road, people as far as the
// player knows). Where people are is what the player was told or last saw,
// never the truth the save holds.

import { daysBetween } from './calendar';
import { companionsOf } from './companions';
import { isDeceased } from './deaths';
import { currentRegion, isRegion, regionName, regionOf, travelDaysBetween, whereaboutsRegion, type Region } from './geography';
import type { AppDatabase, CalendarDate, EntityRecord, PlaceDef, TravelStop } from './types';
import { regionWeather, weatherTravelFactor } from './weather';
import { isPlayer } from './player';

type WithWorld = Pick<AppDatabase, 'world'>;

function placesOf(db: WithWorld | null | undefined): PlaceDef[] {
  return Array.isArray(db?.world?.places) ? db!.world.places : [];
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mapPlace(db: WithWorld | null | undefined, id: string | undefined | null): PlaceDef | null {
  return id ? placesOf(db).find((place) => place.id === id) ?? null : null;
}

/** The world place a location names (earliest mention wins; on a tie, the longer name). */
export function placeIdOf(db: WithWorld | null | undefined, text: string | undefined | null): string | null {
  if (!text) return null;

  let best: { index: number; place: PlaceDef } | null = null;

  for (const place of placesOf(db)) {
    const name = place.name.trim();

    if (name.length < 3) continue;

    const found = new RegExp(`\\b${escape(name)}\\b`, 'i').exec(text);

    if (!found) continue;

    if (!best || found.index < best.index || (found.index === best.index && name.length > best.place.name.length)) {
      best = { index: found.index, place };
    }
  }

  return best?.place.id ?? null;
}

const TRAVEL_LOG_LIMIT = 400;

function samePlace(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * After a turn: a new place goes on the player's road. A place that names no
 * region stays in the region the player was last in.
 */
export function recordTravel(db: AppDatabase): AppDatabase {
  const log = db.state.travelLog ?? [];
  const last = log[log.length - 1];
  const place = db.state.location?.trim();

  if (!place || (last && samePlace(last.place, place))) return db;

  const placeId = placeIdOf(db, place);
  const region =
    regionOf(db, place) ??
    (last && isRegion(db, last.region) ? last.region : null) ??
    (log.length === 0 ? currentRegion(db) : null);
  const stop: TravelStop = {
    place: place.slice(0, 140),
    ...(region ? { region } : {}),
    ...(placeId ? { placeId } : {}),
    date: db.state.inStoryDate,
  };

  return { ...db, state: { ...db.state, travelLog: [...log, stop].slice(-TRAVEL_LOG_LIMIT) } };
}

export function normalizeTravelLog(db: WithWorld, value: unknown, location: string, date: CalendarDate): TravelStop[] {
  const stops = Array.isArray(value)
    ? (value as TravelStop[]).filter(
        (stop) => stop && typeof stop.place === 'string' && stop.date && typeof stop.date.year === 'number'
      )
    : [];

  if (stops.length > 0) return stops.slice(-TRAVEL_LOG_LIMIT);

  // A new or older save: the road starts where the player is now.
  const region = regionOf(db, location);
  const placeId = placeIdOf(db, location);

  return location
    ? [{ place: location.slice(0, 140), ...(region ? { region } : {}), ...(placeId ? { placeId } : {}), date }]
    : [];
}

export type PlaceVisits = { count: number; first: CalendarDate; last: CalendarDate };

/** How often and when the player has been at each world place. */
export function placeVisits(db: AppDatabase): Map<string, PlaceVisits> {
  const visits = new Map<string, PlaceVisits>();

  for (const stop of db.state.travelLog ?? []) {
    const place = mapPlace(db, stop.placeId);

    if (!place) continue;

    const known = visits.get(place.id);

    visits.set(
      place.id,
      known ? { count: known.count + 1, first: known.first, last: stop.date } : { count: 1, first: stop.date, last: stop.date }
    );
  }

  return visits;
}

/** Regions the player has set foot in. */
export function regionsVisited(db: AppDatabase): Set<Region> {
  return new Set((db.state.travelLog ?? []).map((stop) => stop.region).filter((region): region is Region => isRegion(db, region)));
}

/**
 * Travel days from where the player is to a region, plain and in the weather
 * where they are now. Null when the world has no geography.
 */
export function travelEstimate(db: AppDatabase, to: Region | null): { days: number; inWeather: number } | null {
  const from = currentRegion(db);

  if (!to || !from) return null;

  const days = travelDaysBetween(db, from, to);
  const factor = Math.max(weatherTravelFactor(regionWeather(db, from)), weatherTravelFactor(regionWeather(db, to)));

  return { days, inWeather: Math.round(days * factor * 4) / 4 };
}

export function formatTravelDays(days: number) {
  if (days < 1 / 12) return 'a few minutes';
  if (days < 0.5) return `about ${Math.max(1, Math.round(days * 24))} hours`;
  if (days < 1) return 'under a day';
  if (days === 1) return 'about a day';

  const rounded = Math.round(days * 2) / 2;

  return `about ${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} days`;
}

export type KnownWhereabouts = {
  entity: EntityRecord;
  region: Region | null;
  /** told: the story said where they went; seen: where you last saw them; assumed: their home; with-you: travelling with you. */
  basis: 'told' | 'seen' | 'assumed' | 'with-you';
  /** In your words, for the list. */
  detail: string;
  /** How old that knowledge is, in days. */
  daysOld?: number;
};

/**
 * Where the people the player has met are, as far as they know: what they
 * were told, else where they last saw them, else where they would usually be.
 * Someone who died without the player knowing is still where the player thinks.
 */
export function knownWhereabouts(db: AppDatabase): KnownWhereabouts[] {
  const companions = new Set(companionsOf(db).map((entity) => entity.id));
  const here = currentRegion(db);
  const now = db.state.inStoryDate;
  const result: KnownWhereabouts[] = [];

  for (const entity of db.entities) {
    if (entity.type !== 'character' || isPlayer(db, entity) || entity.met === false || entity.tier === 'minor') continue;
    if (isDeceased(entity)) continue;

    if (companions.has(entity.id)) {
      result.push({ entity, region: here, basis: 'with-you', detail: 'With you' });
      continue;
    }

    const daysOld = entity.lastSeen ? Math.max(0, daysBetween(entity.lastSeen, now)) : undefined;
    const ago = daysOld === undefined ? '' : daysOld < 1 ? 'today' : daysOld < 2 ? 'yesterday' : `${Math.round(daysOld)} days ago`;

    if (entity.whereabouts) {
      result.push({ entity, region: regionOf(db, entity.whereabouts), basis: 'told', detail: `Last word: ${entity.whereabouts}`, daysOld });
      continue;
    }

    if (entity.lastSeenAt) {
      result.push({
        entity,
        region: regionOf(db, entity.lastSeenAt),
        basis: 'seen',
        detail: `You saw them at ${entity.lastSeenAt}${ago ? ` ${ago}` : ''}`,
        daysOld,
      });
      continue;
    }

    const home = whereaboutsRegion(db, entity);

    if (home) result.push({ entity, region: home, basis: 'assumed', detail: 'Where they would usually be', daysOld });
  }

  const order = { 'with-you': 0, told: 1, seen: 2, assumed: 3 } as const;

  return result.sort(
    (a, b) => order[a.basis] - order[b.basis] || (a.daysOld ?? 9999) - (b.daysOld ?? 9999) || a.entity.name.localeCompare(b.entity.name)
  );
}

export function regionLabel(db: WithWorld, region: Region | null) {
  return regionName(db, region) ?? 'Somewhere else';
}
