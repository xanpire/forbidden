// The two cached narrator blocks that describe what the player wrote:
// THE WORLD (the setting) and WHO YOU ARE (the player's character).
// Both are plain prose with no ids or JSON (invariant 2), and both change only
// when the player edits the world or the character, so they sit right after
// the rules in the cached prefix (invariant 10).

import { playerAge } from './player';
import { priceGuideOf } from './money';
import type { AppDatabase } from './types';

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
  const currency = world.currency;

  const factions = world.factions
    .filter((faction) => clean(faction.name))
    .map((faction) => `- ${clean(faction.name)}${clean(faction.description) ? `: ${clean(faction.description)}` : ''}`);

  const places = world.places
    .filter((place) => clean(place.name))
    .map((place) => `- ${clean(place.name)}${clean(place.description) ? `: ${clean(place.description)}` : ''}${clean(place.who) ? ` (${clean(place.who)})` : ''}`);

  return [
    'THE WORLD (written by the player; this is the setting, true from the first page)',
    line('Name', world.name),
    line('Premise', world.premise),
    line('Genre', world.genre),
    line('Tone', world.tone),
    line('Where', world.where),
    'When: the present day. Phones, the internet, cars, apps: the real world as it is now.',
    clean(currency?.name) ? `Money: ${clean(currency.name)}${clean(currency.symbol) ? ` (${clean(currency.symbol)})` : ''}` : '',
    prices(db),
    factions.length > 0 ? `Groups:\n${factions.join('\n')}` : '',
    places.length > 0 ? `Places:\n${places.join('\n')}` : '',
    clean(world.narratorNotes) ? `The player's own rules for you: ${clean(world.narratorNotes)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
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
    line('Lives at', player.home),
    goals.length > 0 ? `Goals: ${goals.join(' | ')}` : '',
    (player.backstory ?? '').trim() ? `Backstory, in the player's words:\n${(player.backstory ?? '').trim()}` : '',
    secrets.length > 0 ? `Secrets (narrator only: true, but nobody knows them unless the story shows it): ${secrets.join(' | ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
