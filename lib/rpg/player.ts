// Who the player is in a save. Nothing else in the app names the player:
// every check goes through these helpers.

import { calculateAge } from './calendar';
import type { AppDatabase, CalendarDate, CharacterDefinition, EntityRecord } from './types';

/** The tag the player's own entity carries. */
export const PLAYER_TAG = 'player';

/** Words the tracker (or a test) may use for the player instead of a name. */
const GENERIC_REFS = ['player', 'you', 'yourself', 'the player'];

function lower(value: string | undefined | null) {
  return (value ?? '').trim().toLowerCase();
}

/** True for the player's own entity. */
export function isPlayerEntity(entity: Pick<EntityRecord, 'tags'> | null | undefined): boolean {
  return Boolean(entity?.tags?.includes(PLAYER_TAG));
}

/** The player's entity: the one tagged `player` (or, failing that, one with the sheet's name). */
export function playerEntity(db: AppDatabase): EntityRecord | null {
  const tagged = db.entities.find((entity) => isPlayerEntity(entity));

  if (tagged) return tagged;

  const name = lower(db.state?.player?.name);

  return name ? db.entities.find((entity) => entity.type === 'character' && lower(entity.name) === name) ?? null : null;
}

/** The player's name, as the player wrote it. */
export function playerName(db: AppDatabase): string {
  return db.state?.player?.name?.trim() || playerEntity(db)?.name || 'You';
}

/** The player's entity id, when the save has one. */
export function playerId(db: AppDatabase): string | null {
  return playerEntity(db)?.id ?? null;
}

/**
 * Every lowercased way a reply may refer to the player: name, aliases, the
 * entity's id, and "player" / "you".
 */
export function playerRefs(db: AppDatabase | null | undefined): string[] {
  if (!db) return [...GENERIC_REFS];

  const entity = playerEntity(db);
  const sheet = db.state?.player;
  const refs = [
    sheet?.name,
    ...(sheet?.aliases ?? []),
    entity?.id,
    entity?.name,
    ...(entity?.aliases ?? []),
    ...GENERIC_REFS,
  ]
    .map(lower)
    .filter((value) => value.length > 0);

  return [...new Set(refs)];
}

/** The player's names as written (name, aliases), for rewriting text into "you". */
export function playerDisplayNames(db: AppDatabase | null | undefined): string[] {
  if (!db) return [];

  const entity = playerEntity(db);
  const names = [db.state?.player?.name, ...(db.state?.player?.aliases ?? []), entity?.name, ...(entity?.aliases ?? [])]
    .map((name) => (name ?? '').trim())
    .filter((name) => name.length > 0);

  return [...new Set(names)];
}

/** True when a name or id refers to the player. */
export function isPlayerRef(refs: readonly string[], value: string | null | undefined): boolean {
  const key = lower(value);
  return key.length > 0 && refs.includes(key);
}

/** True when a name or id refers to the player in this save. */
export function isPlayerName(db: AppDatabase | null | undefined, value: string | null | undefined): boolean {
  return isPlayerRef(playerRefs(db), value);
}

/** True when an entity is the player: tagged, or named like them. */
export function isPlayer(db: AppDatabase | null | undefined, entity: EntityRecord | null | undefined): boolean {
  if (!entity) return false;
  if (isPlayerEntity(entity)) return true;
  return entity.type === 'character' && isPlayerName(db, entity.name);
}

/** The player's age on an in-story date. */
export function playerAgeAt(db: Pick<AppDatabase, 'state'>, date: CalendarDate): number {
  const sheet = db.state.player;

  if (sheet.birthYear !== undefined) {
    return calculateAge(date, sheet.birthday, sheet.birthYear);
  }

  return sheet.age;
}

/** The player's age on the current in-story date. */
export function playerAge(db: Pick<AppDatabase, 'state'>): number {
  return playerAgeAt(db, db.state.inStoryDate);
}

/** Fills any missing sheet field, keeping everything the player wrote. */
export function normalizeCharacter(value: unknown, fallback: CharacterDefinition): CharacterDefinition {
  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const sheet = value as Partial<CharacterDefinition>;
  const text = (item: unknown, otherwise: string) => (typeof item === 'string' ? item : otherwise);
  const strings = (item: unknown) =>
    Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === 'string') : [];

  return {
    ...sheet,
    name: text(sheet.name, fallback.name).trim() || fallback.name,
    aliases: strings(sheet.aliases),
    age: typeof sheet.age === 'number' && Number.isFinite(sheet.age) ? sheet.age : fallback.age,
    gender: text(sheet.gender, ''),
    appearance: text(sheet.appearance, ''),
    outfit: text(sheet.outfit, ''),
    personality: text(sheet.personality, ''),
    speechStyle: text(sheet.speechStyle, ''),
    backstory: text(sheet.backstory, ''),
    role: text(sheet.role, ''),
    ...(typeof sheet.skills === 'string' && sheet.skills.trim() ? { skills: sheet.skills } : {}),
    inventory: strings(sheet.inventory),
    money: typeof sheet.money === 'number' && Number.isFinite(sheet.money) ? sheet.money : 0,
    secrets: strings(sheet.secrets),
    goals: strings(sheet.goals),
    birthYear: typeof sheet.birthYear === 'number' ? sheet.birthYear : fallback.birthYear,
  };
}
