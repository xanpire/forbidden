// The creation wizard's data: a draft the player fills in by hand, screen by
// screen, then turns into a save with seedDatabase. Everything here is plain
// player input. The only AI involvement is "Help me fill this", which
// suggests values for the EMPTY fields of one section; the player accepts,
// edits or discards each suggestion. Nothing is saved unasked.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../brand';
import { makeId, slug } from './id';
import { emptyWorld, normalizeWorld } from './world';
import { CHECK_REASONS, canBeIntimate, defaultContentProfile, normalizeContentProfile } from './intimacy';
import type {
  CharacterDefinition,
  ClimateType,
  ContentProfile,
  FactionDef,
  LoreRecord,
  OpenRouterMessage,
  OpeningScene,
  PlaceDef,
  SeedInput,
  StartingPerson,
  StartingTruth,
  WorldDefinition,
} from './types';

export const WIZARD_STEPS = ['world', 'places', 'lore', 'you', 'backstory', 'intimacy', 'people', 'opening', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_LABELS: Record<WizardStep, string> = {
  world: 'World',
  places: 'Places',
  lore: 'Lore',
  you: 'You',
  backstory: 'Backstory',
  intimacy: 'Intimacy',
  people: 'People',
  opening: 'Opening',
  review: 'Review',
};

export type WizardDraft = {
  version: 1;
  step: WizardStep;
  world: WorldDefinition;
  character: CharacterDefinition;
  truths: StartingTruth[];
  people: StartingPerson[];
  opening: OpeningScene;
  content: ContentProfile;
  /** The story's name in the Stories list. */
  slotName: string;
  updatedAt: number;
};

export function emptyCharacter(): CharacterDefinition {
  return {
    name: '',
    aliases: [],
    age: 25,
    gender: '',
    appearance: '',
    outfit: '',
    personality: '',
    speechStyle: '',
    backstory: '',
    role: '',
    skills: '',
    inventory: [],
    money: 0,
    secrets: [],
    goals: [],
  };
}

export function emptyPerson(): StartingPerson {
  return {
    name: '',
    aliases: [],
    gender: '',
    role: '',
    appearance: '',
    personality: '',
    speechStyle: '',
    relationship: 'acquaintance',
    yourFeelings: { affinity: 0, note: '' },
    theirFeelings: { affinity: 0, note: '' },
    alive: true,
    knownName: true,
    met: true,
  };
}

export function emptyDraft(): WizardDraft {
  const world = emptyWorld('');
  return {
    version: 1,
    step: 'world',
    world,
    character: emptyCharacter(),
    truths: [],
    people: [],
    opening: { location: '', date: { ...world.calendar.start }, situation: '', castNames: [], threads: [] },
    content: defaultContentProfile(),
    slotName: '',
    updatedAt: Date.now(),
  };
}

export const CLIMATE_LABELS: Record<ClimateType, string> = {
  temperate: 'Temperate',
  continental: 'Continental',
  desert: 'Desert',
  tundra: 'Tundra',
  tropical: 'Tropical',
  monsoon: 'Monsoon',
  rainy: 'Rainy',
  coastal: 'Coastal',
  mountain: 'Mountain',
};

// ---------------------------------------------------------------------------
// New list items

export function newPlace(): PlaceDef {
  return { id: makeId('place'), name: '', kind: 'structure', description: '' };
}

export function newFaction(): FactionDef {
  return { id: makeId('faction'), name: '', description: '' };
}

export function newLore(): LoreRecord {
  return { id: makeId('lore'), keywords: [], priority: 2, text: '', enabled: true };
}

// ---------------------------------------------------------------------------
// Validation: only four fields are required.

export type MissingField = { step: WizardStep; field: string; message: string };

export function missingFields(draft: WizardDraft): MissingField[] {
  const missing: MissingField[] = [];
  if (!draft.world.name.trim()) missing.push({ step: 'world', field: 'name', message: 'Give your world a name.' });
  if (!draft.world.premise.trim()) missing.push({ step: 'world', field: 'premise', message: 'Write a short premise for your world.' });
  if (!draft.character.name.trim()) missing.push({ step: 'you', field: 'name', message: 'Give your character a name.' });
  if (!draft.opening.situation.trim()) missing.push({ step: 'opening', field: 'situation', message: 'Say what is happening when the story opens.' });
  // Adults only: anyone with an "In bed" section needs a stated age of 18+.
  draft.people.forEach((person, index) => {
    if (!person.intimacy || !person.name.trim()) return;
    const check = canBeIntimate({ age: person.age, appearance: person.appearance, role: person.role, personality: person.personality, realPerson: person.realPerson });
    if (!check.ok) {
      missing.push({
        step: 'people',
        field: `people.${index}.age`,
        message: `${person.name.trim()} ${CHECK_REASONS[check.reason]}: give an age of 18 or older, or clear their "In bed" section.`,
      });
    }
  });
  return missing;
}

// ---------------------------------------------------------------------------
// Draft → seed input. Cleans what the player wrote; adds nothing of its own.

function clean(value: string | undefined) {
  return (value ?? '').trim();
}

function cleanList(values: string[] | undefined) {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/** Readable ids from names ("The Blue Door" → "the-blue-door"), unique within the list. */
function withReadableIds<T extends { id: string; name: string }>(items: T[]): { items: T[]; idMap: Map<string, string> } {
  const used = new Set<string>();
  const idMap = new Map<string, string>();
  const out = items.map((item) => {
    const base = slug(item.name) || 'item';
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    idMap.set(item.id, id);
    return { ...item, id };
  });
  return { items: out, idMap };
}

export function draftToSeedInput(draft: WizardDraft): SeedInput {
  const raw = draft.world;
  const factions = withReadableIds(raw.factions.filter((faction) => clean(faction.name)));
  const places = withReadableIds(raw.places.filter((place) => clean(place.name)));

  const world: WorldDefinition = normalizeWorld({
    ...raw,
    name: clean(raw.name),
    premise: clean(raw.premise),
    factions: factions.items.map((faction) => ({ ...faction, name: clean(faction.name), description: clean(faction.description) })),
    places: places.items.map((place) => ({ ...place, name: clean(place.name), description: clean(place.description), ...(clean(place.who) ? { who: clean(place.who) } : {}) })),
    lore: raw.lore
      .filter((entry) => clean(entry.text))
      .map((entry) => ({ ...entry, text: clean(entry.text), keywords: cleanList(entry.keywords).map((word) => word.toLowerCase()) })),
    calendar: { start: { ...draft.opening.date } },
  });

  const character: CharacterDefinition = {
    ...draft.character,
    name: clean(draft.character.name),
    aliases: cleanList(draft.character.aliases),
    age: Math.max(0, Math.round(Number(draft.character.age) || 0)),
    inventory: cleanList(draft.character.inventory),
    secrets: cleanList(draft.character.secrets),
    goals: cleanList(draft.character.goals),
    money: Math.max(0, Number(draft.character.money) || 0),
    ...(clean(draft.character.home) ? { home: clean(draft.character.home) } : {}),
    backstory: draft.character.backstory, // verbatim
  };

  const people = draft.people
    .filter((person) => clean(person.name))
    .map((person) => ({
      ...person,
      name: clean(person.name),
      aliases: cleanList(person.aliases),
      age: person.age === undefined || person.age === null || Number.isNaN(Number(person.age)) ? undefined : Math.round(Number(person.age)),
      secrets: cleanList(person.secrets),
    }));

  const placeIdOf = (name: string) => world.places.find((place) => place.name.toLowerCase() === name.trim().toLowerCase())?.id;
  const location = clean(draft.opening.location) || world.places[0]?.name || world.name;

  const opening: OpeningScene = {
    ...draft.opening,
    location,
    placeId: draft.opening.placeId ? places.idMap.get(draft.opening.placeId) ?? placeIdOf(location) : placeIdOf(location),
    situation: clean(draft.opening.situation),
    castNames: cleanList(draft.opening.castNames).filter((name) => people.some((person) => person.name === name || person.aliases?.includes(name))),
    threads: cleanList(draft.opening.threads),
  };

  const truths = draft.truths
    .filter((truth) => clean(truth.text))
    .map((truth) => ({ ...truth, text: clean(truth.text), knownBy: cleanList(truth.knownBy).length ? cleanList(truth.knownBy) : ['you'] }));

  // People who fail the adults-only check never carry an intimacy profile.
  const checkedPeople = people.map((person) =>
    person.intimacy && !canBeIntimate({ age: person.age, appearance: person.appearance, role: person.role, personality: person.personality, realPerson: person.realPerson }).ok
      ? { ...person, intimacy: undefined }
      : person
  );

  return { world, character, people: checkedPeople, opening, truths, content: normalizeContentProfile(draft.content) };
}

// ---------------------------------------------------------------------------
// Autosave

export async function saveDraft(draft: WizardDraft) {
  await AsyncStorage.setItem(STORAGE_KEYS.wizardDraft, JSON.stringify({ ...draft, updatedAt: Date.now() }));
}

export async function loadDraft(): Promise<WizardDraft | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.wizardDraft);
    if (!raw) return null;
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function clearDraft() {
  await AsyncStorage.removeItem(STORAGE_KEYS.wizardDraft);
}

export function normalizeDraft(value: unknown): WizardDraft | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Partial<WizardDraft>;
  const base = emptyDraft();
  return {
    ...base,
    ...input,
    version: 1,
    step: WIZARD_STEPS.includes(input.step as WizardStep) ? (input.step as WizardStep) : 'world',
    world: normalizeWorld(input.world ?? base.world),
    character: { ...base.character, ...(input.character ?? {}) },
    truths: Array.isArray(input.truths) ? input.truths : [],
    people: Array.isArray(input.people) ? input.people.map((person) => ({ ...emptyPerson(), ...person })) : [],
    opening: { ...base.opening, ...(input.opening ?? {}) },
    content: normalizeContentProfile(input.content),
    slotName: typeof input.slotName === 'string' ? input.slotName : '',
  };
}

// ---------------------------------------------------------------------------
// "Help me fill this": one optional call per section.

export type HelpSection = 'world' | 'places' | 'lore' | 'you' | 'backstory' | 'intimacy' | 'people' | 'opening';

const HELP_SHAPES: Record<HelpSection, string> = {
  world:
    '{"genre": string, "tone": string, "where": string, "currencyName": string, "priceGuide": string, "artStyle": string}',
  places:
    '{"places": [{"name": string, "kind": one of structure|settlement|road|wilderness, "description": string, "who": string}], "factions": [{"name": string, "description": string}]}',
  lore: '{"lore": [{"keywords": string[], "text": string}]}',
  you: '{"appearance": string, "outfit": string, "personality": string, "speechStyle": string, "role": string, "skills": string, "home": string, "inventory": string[], "goals": string[]}',
  backstory: '{"backstory": string, "truths": string[], "secrets": string[]}',
  intimacy: '{"interests": string[], "narratorVoice": string}',
  people:
    '{"people": [{"name": string, "age": number, "gender": string, "role": string, "appearance": string, "personality": string, "speechStyle": string, "relationship": string, "drawnTo": string, "turnOns": string[], "wontDo": string[], "inBed": string, "routine": string (their week in plain words, like "weekdays 9-17:30 at the office; sleeps 23:30-7; Fridays 21-1 at the bar")}]}',
  opening: '{"location": string, "situation": string, "threads": string[]}',
};

function draftSummary(draft: WizardDraft) {
  const world = draft.world;
  const character = draft.character;
  const lines = [
    `World: ${world.name || '(unnamed)'}. ${world.premise}`,
    world.genre ? `Genre: ${world.genre}. Tone: ${world.tone}.` : '',
    world.where ? `Set in: ${world.where}, today.` : 'Set today.',
    world.places.length ? `Places: ${world.places.map((place) => place.name).filter(Boolean).join(', ')}.` : '',
    world.factions.length ? `Groups: ${world.factions.map((faction) => faction.name).filter(Boolean).join(', ')}.` : '',
    character.name ? `The player's character: ${character.name}, ${character.age}, ${character.role}. ${character.personality}` : '',
    character.backstory ? `Backstory: ${character.backstory}` : '',
    draft.people.length ? `People: ${draft.people.map((person) => `${person.name} (${person.role})`).join(', ')}.` : '',
    draft.opening.situation ? `Opening: ${draft.opening.situation}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

export function helpFillMessages(section: HelpSection, draft: WizardDraft): OpenRouterMessage[] {
  const system = [
    'You help a player set up their own roleplay story. Suggest values only for what is still empty in the section asked for; never change what the player already wrote, and keep to their world, where it is set and its tone.',
    'The story is set in the real world today: phones, the internet, cars; no magic, powers or supernatural beings.',
    'Every person you suggest is an adult with a stated age of 18 or older, and is fictional (never a real, identifiable person).',
    `Reply with one JSON object only, in this shape: ${HELP_SHAPES[section]}. Leave out any key the player already filled. Short, concrete values in plain English.`,
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: `What the player has written so far:\n${draftSummary(draft)}\n\nSuggest the empty fields for the "${STEP_LABELS[section]}" section.` },
  ];
}

export type HelpSuggestion = Record<string, unknown>;

/** Reads the model's reply into a suggestion; null when it isn't usable JSON. */
export function parseHelpReply(text: string): HelpSuggestion | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as HelpSuggestion) : null;
  } catch {
    return null;
  }
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strs = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);
const fill = (current: string | undefined, next: unknown) => (clean(current) ? (current as string) : str(next) || current || '');
const fillList = (current: string[] | undefined, next: unknown) => (cleanList(current).length ? (current as string[]) : strs(next));
const KINDS: PlaceDef['kind'][] = ['settlement', 'structure', 'road', 'wilderness'];

/**
 * Applies an accepted suggestion: fills only fields that are still empty and
 * adds suggested list items. What the player wrote is never overwritten.
 */
export function applySuggestion(draft: WizardDraft, section: HelpSection, suggestion: HelpSuggestion): WizardDraft {
  const s = suggestion;
  switch (section) {
    case 'world': {
      const world = draft.world;
      return {
        ...draft,
        world: {
          ...world,
          genre: fill(world.genre, s.genre),
          tone: fill(world.tone, s.tone),
          where: fill(world.where, s.where),
          currency: { ...world.currency, name: fill(world.currency.name, s.currencyName), priceGuide: fill(world.currency.priceGuide, s.priceGuide) },
          artStyle: fill(world.artStyle, s.artStyle),
        },
      };
    }
    case 'places': {
      const places = [...draft.world.places];
      for (const item of Array.isArray(s.places) ? s.places : []) {
        const record = item as Record<string, unknown>;
        const name = str(record.name);
        if (!name || places.some((place) => place.name.toLowerCase() === name.toLowerCase())) continue;
        const kind = str(record.kind) as PlaceDef['kind'];
        const who = str(record.who);
        places.push({ ...newPlace(), name, kind: KINDS.includes(kind) ? kind : 'structure', description: str(record.description), ...(who ? { who } : {}) });
      }
      const factions = [...draft.world.factions];
      for (const item of Array.isArray(s.factions) ? s.factions : []) {
        const name = str((item as Record<string, unknown>).name);
        if (!name || factions.some((faction) => faction.name.toLowerCase() === name.toLowerCase())) continue;
        factions.push({ ...newFaction(), name, description: str((item as Record<string, unknown>).description) });
      }
      return { ...draft, world: { ...draft.world, places, factions } };
    }
    case 'lore': {
      const lore = [...draft.world.lore];
      for (const item of Array.isArray(s.lore) ? s.lore : []) {
        const record = item as Record<string, unknown>;
        const text = str(record.text);
        if (text) lore.push({ ...newLore(), text, keywords: strs(record.keywords) });
      }
      return { ...draft, world: { ...draft.world, lore } };
    }
    case 'you': {
      const c = draft.character;
      return {
        ...draft,
        character: {
          ...c,
          appearance: fill(c.appearance, s.appearance),
          outfit: fill(c.outfit, s.outfit),
          personality: fill(c.personality, s.personality),
          speechStyle: fill(c.speechStyle, s.speechStyle),
          role: fill(c.role, s.role),
          skills: fill(c.skills, s.skills),
          home: fill(c.home, s.home),
          inventory: fillList(c.inventory, s.inventory),
          goals: fillList(c.goals, s.goals),
        },
      };
    }
    case 'backstory': {
      const c = draft.character;
      const truths = draft.truths.length ? draft.truths : strs(s.truths).map((text) => ({ text, knownBy: ['you'] }));
      return { ...draft, character: { ...c, backstory: fill(c.backstory, s.backstory), secrets: fillList(c.secrets, s.secrets) }, truths };
    }
    case 'intimacy': {
      const c = draft.content;
      const known = new Set(c.interests.map((tag) => tag.label.toLowerCase()));
      const interests = [...c.interests, ...strs(s.interests).filter((label) => !known.has(label.toLowerCase())).map((label) => ({ label, weight: 'like' as const }))];
      return { ...draft, content: { ...c, interests, narratorVoice: fill(c.narratorVoice, s.narratorVoice) } };
    }
    case 'people': {
      const people = [...draft.people];
      // Desires, turn-ons, limits and how they are in bed: only where still empty.
      const withDesires = (person: StartingPerson, record: Record<string, unknown>): StartingPerson => {
        const current = person.intimacy ?? { orientation: '', interestedInPlayer: 'could-grow' as const, desires: [], boundaries: [] };
        const next = {
          ...current,
          orientation: fill(current.orientation, record.drawnTo),
          desires: fillList(current.desires, record.turnOns),
          boundaries: fillList(current.boundaries, record.wontDo),
          style: fill(current.style, record.inBed) || undefined,
        };
        const any = next.orientation || next.desires.length || next.boundaries.length || next.style;
        const routine = fill(person.routine ?? '', record.routine);
        const withRoutine = routine ? { ...person, routine } : person;
        return any ? { ...withRoutine, intimacy: next } : withRoutine;
      };
      for (const item of Array.isArray(s.people) ? s.people : []) {
        const record = item as Record<string, unknown>;
        const name = str(record.name);
        const existing = people.findIndex((person) => person.name.toLowerCase() === name.toLowerCase());
        if (name && existing >= 0) {
          people[existing] = withDesires(people[existing], record);
          continue;
        }
        if (!name) continue;
        const age = Number(record.age);
        people.push(withDesires({
          ...emptyPerson(),
          name,
          age: Number.isFinite(age) && age >= 18 ? Math.round(age) : undefined,
          gender: str(record.gender),
          role: str(record.role),
          appearance: str(record.appearance),
          personality: str(record.personality),
          speechStyle: str(record.speechStyle),
          relationship: str(record.relationship) || 'acquaintance',
        }, record));
      }
      return { ...draft, people };
    }
    case 'opening': {
      const o = draft.opening;
      return { ...draft, opening: { ...o, location: fill(o.location, s.location), situation: fill(o.situation, s.situation), threads: fillList(o.threads, s.threads) } };
    }
  }
}

