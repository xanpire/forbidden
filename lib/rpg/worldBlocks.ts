// The two cached narrator blocks that describe what the player wrote:
// THE WORLD (the setting) and WHO YOU ARE (the player's character).
// Both are plain prose with no ids or JSON (invariant 2), and both change only
// when the player edits the world or the character, so they sit right after
// the rules in the cached prefix (invariant 10).

import { playerAge } from './player';
import { priceGuideOf } from './money';
import type { AppDatabase, WorldDefinition } from './types';

const WHEN_LABEL: Record<WorldDefinition['era']['when'], string> = {
  past: 'the past',
  present: 'the present day',
  future: 'the future',
};

function clean(value: string | undefined) {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function line(label: string, value: string | undefined) {
  const text = clean(value);
  return text ? `${label}: ${text}` : '';
}

function list(values: string[] | undefined) {
  return (values ?? []).map(clean).filter(Boolean);
}

function prices(db: AppDatabase) {
  const guide = clean(priceGuideOf(db));
  if (!guide) return '';
  return `Prices: ${guide.replace(/^PRICES\s*(\([^)]*\))?\s*:\s*/i, '')}`;
}

/** THE WORLD: the setting as the player wrote it. */
export function formatWorldBlock(db: AppDatabase): string {
  const world = db.world;
  const regionName = new Map(world.regions.map((region) => [region.id, region.name]));
  const era = world.era;
  const currency = world.currency;

  const factions = world.factions
    .filter((faction) => clean(faction.name))
    .map((faction) => {
      const territory = list(faction.territoryRegionIds?.map((id) => regionName.get(id) ?? ''));
      const extra = [
        territory.length > 0 ? `holds ${territory.join(', ')}` : '',
        faction.hasBounties ? 'keeps a wanted list and pays for people' : '',
      ].filter(Boolean);
      return `- ${clean(faction.name)}${clean(faction.description) ? `: ${clean(faction.description)}` : ''}${extra.length > 0 ? ` (${extra.join('; ')})` : ''}`;
    });

  const regions = world.regions
    .filter((region) => clean(region.name))
    .map((region) => {
      const near = region.neighbours
        .map((next) => {
          const name = regionName.get(next.id);
          if (!name) return '';
          return `${name} ${formatTravel(next.days)}`;
        })
        .filter(Boolean);
      const places = world.places.filter((place) => place.regionId === region.id && clean(place.name)).map((place) => clean(place.name));
      return [
        `- ${clean(region.name)}${clean(region.description) ? `: ${clean(region.description)}` : ''}`,
        places.length > 0 ? ` Places: ${places.join(', ')}.` : '',
        near.length > 0 ? ` Travel: ${near.join(', ')}.` : '',
      ].join('');
    });

  return [
    'THE WORLD (written by the player; this is the setting, true from the first page)',
    line('Name', world.name),
    line('Premise', world.premise),
    line('Genre', world.genre),
    line('Tone', world.tone),
    `When: ${WHEN_LABEL[era?.when] ?? 'the present day'}${clean(era?.period) ? `, ${clean(era.period)}` : ''}`,
    line('What exists', era?.techNotes),
    clean(currency?.name) ? `Money: ${clean(currency.name)}${clean(currency.symbol) ? ` (${clean(currency.symbol)})` : ''}` : '',
    prices(db),
    list(world.letterCarriers).length > 0 ? `How messages travel: ${list(world.letterCarriers).join(', ')}` : '',
    factions.length > 0 ? `Groups:\n${factions.join('\n')}` : '',
    regions.length > 0 ? `Areas:\n${regions.join('\n')}` : '',
    clean(world.narratorNotes) ? `The player's own rules for you: ${clean(world.narratorNotes)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function formatTravel(days: number) {
  if (!Number.isFinite(days) || days <= 0) return 'close by';
  if (days < 0.05) return 'a few minutes away';
  if (days < 0.5) {
    const minutes = Math.round((days * 24 * 60) / 5) * 5;
    return minutes < 60 ? `about ${minutes} minutes away` : `about ${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? '' : 's'} away`;
  }
  if (days < 1.5) return 'about a day away';
  return `about ${Math.round(days)} days away`;
}

/** WHO YOU ARE: the player's character. The backstory is kept verbatim. */
export function formatWhoYouAre(db: AppDatabase): string {
  const player = db.state.player;
  const secrets = list(player.secrets);
  const goals = list(player.goals);

  return [
    'WHO YOU ARE (the player, written by the player; never act, speak or decide for them)',
    `Name: ${clean(player.name) || 'unnamed'}`,
    list(player.aliases).length > 0 ? `Also called: ${list(player.aliases).join(', ')}` : '',
    `Age: ${playerAge(db)}`,
    line('Gender', player.gender),
    player.birthday ? `Birthday: month ${player.birthday.month}, day ${player.birthday.day}` : '',
    line('Role', player.role),
    line('Looks', player.appearance),
    line('Usually wears', player.outfit),
    line('Personality', player.personality),
    line('Speech', player.speechStyle),
    line('Skills', player.skills),
    goals.length > 0 ? `Goals: ${goals.join(' | ')}` : '',
    (player.backstory ?? '').trim() ? `Backstory, in the player's words:\n${(player.backstory ?? '').trim()}` : '',
    secrets.length > 0 ? `Secrets (narrator only: true, but nobody knows them unless the story shows it): ${secrets.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
