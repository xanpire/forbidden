// The world the player wrote (`db.world`). Empty by default; the creation
// wizard fills it, and normalizeWorld repairs whatever a save holds.

import { DEFAULT_DATE } from './calendar';
import { makeId } from './id';
import type { ClimateType, LocationKind, WorldDefinition, WorldEra } from './types';

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
    era: { when: 'present', period: 'today' },
    currency: { name: 'dollars', priceGuide: '' },
    calendar: { yearLabel: 'Year', start: { ...DEFAULT_DATE } },
    climate: 'temperate',
    factions: [],
    places: [],
    lore: [],
    festivals: [],
    artStyle: 'cinematic photo, natural light',
  };
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const ERA_WHEN: WorldEra['when'][] = ['past', 'present', 'future'];

/** Fills missing fields and drops broken entries; never adds story. */
export function normalizeWorld(value: unknown): WorldDefinition {
  const base = emptyWorld();

  if (!value || typeof value !== 'object') {
    return base;
  }

  const world = value as Partial<WorldDefinition>;
  const era = (world.era ?? {}) as Partial<WorldEra>;
  const currency = (world.currency ?? {}) as Partial<WorldDefinition['currency']>;
  const calendar = (world.calendar ?? {}) as Partial<WorldDefinition['calendar']>;

  return {
    id: text(world.id) || base.id,
    name: text(world.name) || base.name,
    premise: text(world.premise),
    genre: text(world.genre),
    tone: text(world.tone),
    era: {
      when: ERA_WHEN.includes(era.when as WorldEra['when']) ? (era.when as WorldEra['when']) : base.era.when,
      period: text(era.period) || base.era.period,
      ...(text(era.techNotes) ? { techNotes: text(era.techNotes) } : {}),
    },
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
    ).map((faction) => ({ id: faction.id, name: faction.name, description: text(faction.description) })),
    climate: CLIMATE_TYPE_LIST.includes(world.climate as ClimateType) ? (world.climate as ClimateType) : base.climate,
    ...(world.southern === true ? { southern: true } : {}),
    places: list<WorldDefinition['places'][number]>(world.places)
      .filter((place) => place && typeof place.id === 'string' && typeof place.name === 'string')
      .map((place) => ({
        id: place.id,
        name: place.name,
        description: text(place.description),
        kind: PLACE_KINDS.includes(place.kind) ? place.kind : 'structure',
        ...(text(place.who) ? { who: text(place.who) } : {}),
      })),
    lore: list<WorldDefinition['lore'][number]>(world.lore).filter(
      (entry) => entry && typeof entry.id === 'string' && typeof entry.text === 'string'
    ),
    festivals: list<WorldDefinition['festivals'][number]>(world.festivals).filter(
      (festival) => festival && typeof festival.id === 'string' && typeof festival.month === 'number'
    ),
    artStyle: text(world.artStyle) || base.artStyle,
    ...(text(world.narratorNotes) ? { narratorNotes: text(world.narratorNotes) } : {}),
  };
}
