import type { JutsuRecord } from './types';

export const JUTSU_NATURES = [
  'Fire',
  'Water',
  'Wind',
  'Earth',
  'Lightning',
  'Wood',
  'Ice',
  'Lava',
  'Boil',
  'Storm',
  'Yin',
  'Yang',
  'Yin-Yang',
  'Physical',
  'Genjutsu',
  'Space-Time',
  'Unknown',
] as const;

export type JutsuNature = (typeof JUTSU_NATURES)[number];

const NATURE_RULES: Array<{ nature: Exclude<JutsuNature, 'Unknown'>; keywords: string[] }> = [
  { nature: 'Fire', keywords: ['fire', 'flame', 'burn', 'katon'] },
  { nature: 'Water', keywords: ['water', 'suiton', 'aqua'] },
  { nature: 'Wind', keywords: ['wind', 'air', 'futon', 'gale'] },
  { nature: 'Earth', keywords: ['earth', 'stone', 'mud', 'doton'] },
  { nature: 'Lightning', keywords: ['lightning', 'thunder', 'raiton'] },
  { nature: 'Wood', keywords: ['wood', 'tree', 'mokuton'] },
  { nature: 'Ice', keywords: ['ice', 'frost', 'hyoton'] },
  { nature: 'Lava', keywords: ['lava', 'magma', 'yoton'] },
  { nature: 'Boil', keywords: ['boil', 'steam', 'futton'] },
  { nature: 'Storm', keywords: ['storm', 'tempest'] },
  { nature: 'Yin', keywords: ['yin', 'shadow', 'spirit'] },
  { nature: 'Yang', keywords: ['yang', 'life', 'vitality'] },
  { nature: 'Yin-Yang', keywords: ['yin-yang', 'yin and yang'] },
  { nature: 'Physical', keywords: ['physical', 'taijutsu', 'kenjutsu', 'weapon', 'none'] },
  { nature: 'Genjutsu', keywords: ['genjutsu', 'illusion'] },
  { nature: 'Space-Time', keywords: ['space-time', 'space', 'time', 'teleport', 'summon'] },
];

export function normalizeJutsuNature(value: string | undefined): JutsuNature {
  const nature = value?.trim().toLowerCase();

  if (!nature) {
    return 'Unknown';
  }

  for (const rule of NATURE_RULES) {
    if (rule.keywords.some((keyword) => nature.includes(keyword))) {
      return rule.nature;
    }
  }

  return 'Unknown';
}

export function groupJutsuByNature(records: JutsuRecord[]) {
  const grouped = new Map<JutsuNature, JutsuRecord[]>();

  for (const record of records) {
    const nature = normalizeJutsuNature(record.chakraNature);
    const current = grouped.get(nature) ?? [];
    current.push(record);
    grouped.set(nature, current);
  }

  return [...grouped.entries()]
    .map(([nature, jutsu]) => ({
      nature,
      jutsu: [...jutsu].sort((a, b) => {
        if (a.user !== b.user) {
          const aKan = a.user === 'Kan' ? 1 : 0;
          const bKan = b.user === 'Kan' ? 1 : 0;

          if (aKan !== bKan) {
            return bKan - aKan;
          }

          return a.user.localeCompare(b.user);
        }

        return b.timesUsed - a.timesUsed;
      }),
    }))
    .sort((a, b) => {
      const aIndex = JUTSU_NATURES.indexOf(a.nature);
      const bIndex = JUTSU_NATURES.indexOf(b.nature);

      if (aIndex !== bIndex) {
        return aIndex - bIndex;
      }

      return a.nature.localeCompare(b.nature);
    });
}

export function countJutsuByNature(records: JutsuRecord[]) {
  const counts = new Map<JutsuNature, number>();

  for (const record of records) {
    const nature = normalizeJutsuNature(record.chakraNature);
    counts.set(nature, (counts.get(nature) ?? 0) + 1);
  }

  return counts;
}
