// Changing the world mid-story (session 5): edit the world, your own sheet and
// your content profile, add a person by hand, and keep worlds as reusable
// templates (saved on this device, exported and imported as JSON files).
// Edits change the cached THE WORLD / WHO YOU ARE / INTIMACY blocks, so they
// take effect on the next turn.
import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../brand';
import { birthYearOf, personBond, personEntity, withGivenName } from './seed';
import { makeId, slug } from './id';
import { normalizeContentProfile } from './intimacy';
import { playerEntity } from './player';
import { emptyDraft, type WizardDraft } from './wizard';
import { normalizeWorld } from './world';
import type { AppDatabase, CharacterDefinition, ContentProfile, StartingPerson, WorldDefinition } from './types';

/** A draft the shared step screens can edit, filled from the save. */
export function draftFromSave(db: AppDatabase): WizardDraft {
  const base = emptyDraft();
  return {
    ...base,
    step: 'world',
    world: JSON.parse(JSON.stringify(db.world)),
    character: JSON.parse(JSON.stringify(db.state.player)),
    content: JSON.parse(JSON.stringify(db.content)),
    opening: { ...base.opening, date: { ...db.state.inStoryDate } },
    slotName: db.meta.slotName,
  };
}

const NEW_ID = /^(place|faction|lore)_[a-z0-9]+$/;

/**
 * Items made in the editor get readable ids ("the-blue-room") that never clash
 * with ids already in the story; references to them are moved along.
 */
export function withReadableNewIds(world: WorldDefinition, before: WorldDefinition): WorldDefinition {
  const name = <T extends { id: string }>(items: T[], label: (item: T) => string, existing: string[]) => {
    const used = new Set(existing);
    return items.map((item) => {
      if (!NEW_ID.test(item.id)) {
        used.add(item.id);
        return item;
      }
      const base = slug(label(item)) || 'item';
      let id = base;
      for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
      used.add(id);
      return { ...item, id };
    });
  };
  return {
    ...world,
    places: name(world.places, (p) => p.name, before.places.map((p) => p.id)),
    factions: name(world.factions, (f) => f.name, before.factions.map((f) => f.id)),
  };
}

/** The world the player edited replaces the save's; lore in play follows it. */
export function applyWorldEdit(db: AppDatabase, edited: WorldDefinition): AppDatabase {
  const world = normalizeWorld(withReadableNewIds(edited, db.world));
  const oldLore = new Set(db.world.lore.map((entry) => entry.id));
  const loreEntries = [...db.loreEntries.filter((entry) => !oldLore.has(entry.id)), ...world.lore.map((entry) => ({ ...entry }))];
  return { ...db, world, loreEntries };
}

/** Your own sheet: the player entity follows the name, look and manner. */
export function applyCharacterEdit(db: AppDatabase, edited: CharacterDefinition): AppDatabase {
  const before = db.state.player;
  const ageChanged = edited.age !== before.age || edited.birthday?.month !== before.birthday?.month || edited.birthday?.day !== before.birthday?.day;
  const player = {
    ...edited,
    birthYear: ageChanged ? birthYearOf(edited.age, db.state.inStoryDate, edited.birthday) : before.birthYear,
  };
  const entity = playerEntity(db);
  return {
    ...db,
    state: { ...db.state, player },
    entities: db.entities.map((item) =>
      entity && item.id === entity.id
        ? {
            ...item,
            name: edited.name.trim() || item.name,
            aliases: withGivenName(edited.name, edited.aliases ?? []),
            appearance: edited.appearance || item.appearance,
            personality: edited.personality,
            speechStyle: edited.speechStyle,
            role: edited.role,
            age: edited.age,
            birthYear: player.birthYear,
            ...(edited.birthday ? { birthday: edited.birthday } : {}),
          }
        : item
    ),
  };
}

export function applyContentEdit(db: AppDatabase, content: ContentProfile): AppDatabase {
  return { ...db, content: normalizeContentProfile(content) };
}

/** Someone added by hand mid-story: an entity, and a bond when the player already knows them. */
export function addPersonToSave(db: AppDatabase, person: StartingPerson): AppDatabase {
  if (!person.name.trim()) return db;
  const id = makeId('entity');
  const entity = personEntity(person, id, db.state.inStoryDate);
  const bonds = person.met === false ? db.bonds : [...db.bonds, personBond(person, id, db.state.inStoryDate)];
  return { ...db, entities: [...db.entities, entity], bonds };
}

// ---------------------------------------------------------------------------
// World templates

export type WorldTemplate = { id: string; name: string; world: WorldDefinition; savedAt: number };

export async function loadTemplates(): Promise<WorldTemplate[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.worldTemplates);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeTemplate).filter((item): item is WorldTemplate => Boolean(item)) : [];
  } catch {
    return [];
  }
}

async function saveTemplates(templates: WorldTemplate[]) {
  await AsyncStorage.setItem(STORAGE_KEYS.worldTemplates, JSON.stringify(templates));
}

/** The world only: no character, no story, no progress. */
export function templateFromWorld(world: WorldDefinition, name?: string): WorldTemplate {
  return { id: makeId('template'), name: (name ?? world.name).trim() || 'Untitled world', world: normalizeWorld(JSON.parse(JSON.stringify(world))), savedAt: Date.now() };
}

export async function saveWorldAsTemplate(world: WorldDefinition, name?: string): Promise<WorldTemplate> {
  const template = templateFromWorld(world, name);
  const all = await loadTemplates();
  await saveTemplates([...all.filter((item) => item.name !== template.name), template]);
  return template;
}

export async function deleteTemplate(id: string) {
  await saveTemplates((await loadTemplates()).filter((item) => item.id !== id));
}

export function normalizeTemplate(value: unknown): WorldTemplate | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<WorldTemplate> & { kind?: string };
  if (!raw.world || typeof raw.world !== 'object') return null;
  const world = normalizeWorld(raw.world);
  return { id: typeof raw.id === 'string' ? raw.id : makeId('template'), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : world.name, world, savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now() };
}

export function exportTemplate(template: WorldTemplate): string {
  return JSON.stringify({ kind: 'frbddn-world', version: 1, ...template }, null, 2);
}

export async function importTemplate(json: string): Promise<WorldTemplate> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('That file is not a world template.');
  }
  const template = normalizeTemplate(parsed);
  if (!template || !template.world.name) throw new Error('That file is not a world template.');
  const fresh = { ...template, id: makeId('template'), savedAt: Date.now() };
  const all = await loadTemplates();
  await saveTemplates([...all.filter((item) => item.name !== fresh.name), fresh]);
  return fresh;
}

/** A wizard draft for a new story in a saved world: the world is filled in, the rest is yours. */
export function draftFromTemplate(template: WorldTemplate): WizardDraft {
  const draft = emptyDraft();
  const world = normalizeWorld({ ...JSON.parse(JSON.stringify(template.world)), id: makeId('world') });
  return { ...draft, step: 'you', world };
}
