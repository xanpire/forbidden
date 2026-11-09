// The world the player wrote (`db.world`). Empty by default; the creation
// wizard fills it, and normalizeWorld repairs whatever a save holds.

import { DEFAULT_DATE } from './calendar';
import { makeId } from './id';
import type { ClimateType, LocationKind, WorldDefinition } from './types';

export const CLIMATE_TYPE_LIST: ClimateType[] = [
  'temperate',
  'continental',
  'desert',
  'tundra',
  'tropical',
  'monsoon',
  'rainy',
  'coastal',
  'mountain',
  'none',
];

const PLACE_KINDS: LocationKind[] = ['settlement', 'road', 'wilderness', 'structure'];

/** A blank world: every list empty, sensible defaults for the rest. */
export function emptyWorld(name = 'Untitled world'): WorldDefinition {
  return {
    id: makeId('world'),
    name,
    premise: '',
    genre: '',
    tone: '',
    abilityCategories: [],
    abilityLabel: 'Abilities',
    currency: { name: 'coins', priceGuide: '' },
    calendar: { yearLabel: 'Year', start: { ...DEFAULT_DATE } },
    factions: [],
    regions: [],
    places: [],
    lore: [],
    timeline: [],
    festivals: [],
    letterCarriers: ['courier'],
    artStyle: 'painterly concept art',
  };
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function strings(value: unknown): string[] {
  return list<unknown>(value).filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

/** Fills missing fields and drops broken entries; never adds story. */
export function normalizeWorld(value: unknown): WorldDefinition {
  const base = emptyWorld();

  if (!value || typeof value !== 'object') {
    return base;
  }

  const world = value as Partial<WorldDefinition>;
  const currency = (world.currency ?? {}) as Partial<WorldDefinition['currency']>;
  const calendar = (world.calendar ?? {}) as Partial<WorldDefinition['calendar']>;

  return {
    ...base,
    ...world,
    id: text(world.id) || base.id,
    name: text(world.name) || base.name,
    premise: text(world.premise),
    genre: text(world.genre),
    tone: text(world.tone),
    abilityCategories: strings(world.abilityCategories),
    abilityLabel: text(world.abilityLabel) || base.abilityLabel,
    currency: {
      ...currency,
      name: text(currency.name) || base.currency.name,
      priceGuide: text(currency.priceGuide),
    },
    calendar: {
      ...calendar,
      yearLabel: text(calendar.yearLabel) || base.calendar.yearLabel,
      start: calendar.start && typeof calendar.start === 'object' ? calendar.start : base.calendar.start,
    },
    factions: list<WorldDefinition['factions'][number]>(world.factions).filter(
      (faction) => faction && typeof faction.id === 'string' && typeof faction.name === 'string'
    ),
    regions: list<WorldDefinition['regions'][number]>(world.regions)
      .filter((region) => region && typeof region.id === 'string' && typeof region.name === 'string')
      .map((region) => ({
        ...region,
        description: text(region.description),
        climate: CLIMATE_TYPE_LIST.includes(region.climate) ? region.climate : 'temperate',
        neighbours: list<{ id: string; days: number }>(region.neighbours).filter(
          (link) => link && typeof link.id === 'string' && typeof link.days === 'number' && link.days > 0
        ),
      })),
    places: list<WorldDefinition['places'][number]>(world.places)
      .filter((place) => place && typeof place.id === 'string' && typeof place.name === 'string')
      .map((place) => ({
        ...place,
        regionId: text(place.regionId),
        description: text(place.description),
        kind: PLACE_KINDS.includes(place.kind) ? place.kind : 'settlement',
      })),
    lore: list<WorldDefinition['lore'][number]>(world.lore).filter(
      (entry) => entry && typeof entry.id === 'string' && typeof entry.text === 'string'
    ),
    timeline: list<WorldDefinition['timeline'][number]>(world.timeline).filter(
      (event) => event && typeof event.id === 'string' && event.from && typeof event.from === 'object'
    ),
    festivals: list<WorldDefinition['festivals'][number]>(world.festivals).filter(
      (festival) => festival && typeof festival.id === 'string' && typeof festival.month === 'number'
    ),
    letterCarriers: strings(world.letterCarriers).length > 0 ? strings(world.letterCarriers) : base.letterCarriers,
    artStyle: text(world.artStyle) || base.artStyle,
  };
}
