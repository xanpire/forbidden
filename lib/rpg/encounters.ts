import { formatClock, timeOfDayOf } from './calendar';
import type { DayPeriod } from './calendar';
import type { AppDatabase, LocationKind } from './types';

export type EncounterRisk = 'none' | 'very-low' | 'low' | 'medium' | 'high';

const SETTLEMENT_WORDS = [
  'village', 'city', 'town', 'street', 'market', 'inn', 'tavern', 'shop',
  'plaza', 'district', 'port', 'docks', 'camp', 'village hidden', 'compound',
  'academy', 'hospital', 'temple town', 'outpost', 'checkpoint', 'palace',
  'mansion', 'teahouse', 'restaurant', 'barracks',
];

const STRUCTURE_WORDS = [
  'temple', 'shrine', 'ruins', 'abandoned', 'hideout', 'cave', 'catacomb',
  'tomb', 'dungeon', 'bunker', 'sewer', 'tunnel', 'monastery', 'fortress',
  'castle', 'lighthouse', 'warehouse', 'basement', 'crypt',
];

const ROAD_WORDS = [
  'road', 'path', 'trail', 'bridge', 'border', 'crossing', 'highway', 'route',
  'pass', 'valley road', 'riverbank', 'shore', 'coast',
];

const WILDERNESS_WORDS = [
  'forest', 'woods', 'jungle', 'mountain', 'cliff', 'desert', 'sea', 'ocean',
  'lake', 'river', 'swamp', 'marsh', 'field', 'meadow', 'snow', 'tundra',
  'canyon', 'ravine', 'island', 'wilderness', 'treeline', 'grove',
];

function earliestMatch(text: string, words: string[]) {
  let best = -1;

  for (const word of words) {
    const index = text.indexOf(word);

    if (index !== -1 && (best === -1 || index < best)) {
      best = index;
    }
  }

  return best;
}

export function classifyLocation(text: string): LocationKind {
  const lower = text.toLowerCase();

  // The first place-type word usually describes the setting ("forest outside
  // the village" is wilderness, not a settlement).
  const groups: Array<{ kind: LocationKind; index: number }> = (
    [
      { kind: 'structure' as LocationKind, index: earliestMatch(lower, STRUCTURE_WORDS) },
      { kind: 'settlement' as LocationKind, index: earliestMatch(lower, SETTLEMENT_WORDS) },
      { kind: 'road' as LocationKind, index: earliestMatch(lower, ROAD_WORDS) },
      { kind: 'wilderness' as LocationKind, index: earliestMatch(lower, WILDERNESS_WORDS) },
    ]
  ).filter((group) => group.index !== -1);

  if (groups.length === 0) {
    return 'wilderness';
  }

  return groups.sort((a, b) => a.index - b.index)[0].kind;
}

export function locationKindOf(db: AppDatabase): LocationKind {
  const kind = db.state.locationKind;

  if (
    kind === 'settlement' ||
    kind === 'road' ||
    kind === 'wilderness' ||
    kind === 'structure'
  ) {
    return kind;
  }

  return classifyLocation(`${db.state.location} ${db.state.scene}`);
}

export function encounterRisk(kind: LocationKind, timeOfDay: DayPeriod): EncounterRisk {
  if (kind === 'settlement') {
    if (timeOfDay === 'morning' || timeOfDay === 'afternoon') return 'high';
    if (timeOfDay === 'evening') return 'medium';
    return 'low';
  }

  if (kind === 'road') {
    if (timeOfDay === 'morning' || timeOfDay === 'afternoon') return 'medium';
    if (timeOfDay === 'evening') return 'low';
    return 'very-low';
  }

  if (kind === 'wilderness') {
    if (timeOfDay === 'morning' || timeOfDay === 'afternoon') return 'low';
    return 'none';
  }

  return 'none';
}

const RISK_LABEL: Record<EncounterRisk, string> = {
  none: 'isolated — almost nobody would be here',
  'very-low': 'remote — people are rare',
  low: 'sparse — occasional people',
  medium: 'some traffic — people pass through',
  high: 'crowded — people everywhere',
};

export function formatEncounterConditions(db: AppDatabase) {
  const kind = locationKindOf(db);
  const time = timeOfDayOf(db.state.inStoryDate);
  const risk = encounterRisk(kind, time);

  return `ENCOUNTER CONDITIONS: ${kind}, ${time} (${formatClock(db.state.inStoryDate)}) — ${RISK_LABEL[risk]}.`;
}
