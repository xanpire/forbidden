// The creation wizard's data: a draft the player fills in by hand, screen by
// screen, then turns into a save with seedDatabase. Everything here is plain
// player input. The only AI involvement is "Help me fill this", which
// suggests values for the EMPTY fields of one section; the player accepts,
// edits or discards each suggestion. Nothing is saved unasked.

import AsyncStorage from '@react-native-async-storage/async-storage';

import { STORAGE_KEYS } from '../brand';
import { DEFAULT_DATE } from './calendar';
import { makeId, slug } from './id';
import { emptyWorld, normalizeWorld } from './world';
import type {
  CalendarDate,
  CharacterDefinition,
  ClimateType,
  FactionDef,
  LoreRecord,
  OpenRouterMessage,
  OpeningScene,
  PlaceDef,
  RegionDef,
  SeedInput,
  StartingPerson,
  StartingTruth,
  TimelineEvent,
  WorldDefinition,
} from './types';

export const WIZARD_STEPS = ['world', 'places', 'lore', 'you', 'backstory', 'people', 'opening', 'timeline', 'review'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export const STEP_LABELS: Record<WizardStep, string> = {
  world: 'World',
  places: 'Places',
  lore: 'Lore',
  you: 'You',
  backstory: 'Backstory',
  people: 'People',
  opening: 'Opening',
  timeline: 'Timeline',
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
    slotName: '',
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Presets: grounded starting points. They only prefill fields.

export type WorldPreset = {
  id: string;
  label: string;
  apply: (world: WorldDefinition) => WorldDefinition;
};

const today = (): CalendarDate => ({ ...DEFAULT_DATE, year: new Date().getFullYear() });

export const WORLD_PRESETS: WorldPreset[] = [
  {
    id: 'city-today',
    label: 'Big city today',
    apply: (world) => ({
      ...world,
      genre: world.genre || 'contemporary drama',
      era: { when: 'present', period: world.era.period && world.era.period !== 'today' ? world.era.period : 'today, a big city', techNotes: 'Phones, cars, the internet: the real world as it is now.' },
      currency: { name: 'dollars', symbol: '$', priceGuide: 'coffee 4-6; a cheap meal 12-20; a drink at a bar 8-15; a taxi across town 20-40; a month of rent 1,800-3,000; a hotel night 150-300' },
      calendar: { ...world.calendar, start: today() },
      letterCarriers: ['text message', 'phone', 'email', 'post'],
      artStyle: 'cinematic photo, 35mm film, natural light',
    }),
  },
  {
    id: 'small-town',
    label: 'Small town',
    apply: (world) => ({
      ...world,
      genre: world.genre || 'small-town drama',
      era: { when: 'present', period: 'today, a small town where everyone knows everyone', techNotes: 'Phones and cars; the nearest city is an hour away.' },
      currency: { name: 'dollars', symbol: '$', priceGuide: 'coffee 3-4; a diner meal 10-15; a beer 5-7; a month of rent 900-1,300' },
      calendar: { ...world.calendar, start: today() },
      letterCarriers: ['text message', 'phone', 'post'],
      artStyle: 'cinematic photo, warm natural light',
    }),
  },
  {
    id: 'historical-court',
    label: 'Historical court',
    apply: (world) => ({
      ...world,
      genre: world.genre || 'historical court intrigue',
      era: { when: 'past', period: 'a royal court, 1700s', techNotes: 'Candles, horses and carriages, letters by courier; no electricity, no phones.' },
      currency: { name: 'crowns', priceGuide: 'a loaf of bread 1; a meal at an inn 3-5; a room for the night 10; a good horse 300; a servant\'s yearly wage 200' },
      calendar: { yearLabel: 'Year', start: { year: 1750, month: 5, day: 1, hour: 18, minute: 0 } },
      letterCarriers: ['courier', 'messenger on horseback', 'sealed letter'],
      artStyle: 'oil painting, candlelit, rich period detail',
    }),
  },
  {
    id: 'twenties',
    label: '1920s',
    apply: (world) => ({
      ...world,
      genre: world.genre || 'jazz-age drama',
      era: { when: 'past', period: 'a big city, 1920s', techNotes: 'Telephones in homes and booths, telegrams, motor cars and trains; radio is new.' },
      currency: { name: 'dollars', symbol: '$', priceGuide: 'a coffee 5 cents; a diner meal 50 cents; a bootleg drink 1; a taxi 1-2; a month of rent 50-80; a good suit 40' },
      calendar: { yearLabel: 'Year', start: { year: 1925, month: 10, day: 1, hour: 21, minute: 0 } },
      letterCarriers: ['telephone', 'telegram', 'post', 'courier boy'],
      artStyle: 'black-and-white film still, 1920s, grainy',
    }),
  },
  {
    id: 'near-future',
    label: 'Near future',
    apply: (world) => ({
      ...world,
      genre: world.genre || 'near-future drama',
      era: { when: 'future', period: '2060, a crowded megacity', techNotes: 'Better phones, self-driving cabs, everywhere cameras; nothing impossible, no robots that think like people.' },
      currency: { name: 'credits', priceGuide: 'a coffee 8; a meal 25-40; a drink 15; a cab ride 30; a month of rent for a tiny flat 3,000' },
      calendar: { yearLabel: 'Year', start: { year: 2060, month: 3, day: 1, hour: 20, minute: 0 } },
      letterCarriers: ['message', 'call', 'video call'],
      artStyle: 'cinematic photo, neon and rain, shallow depth of field',
    }),
  },
  {
    id: 'post-collapse',
    label: 'After the collapse',
    apply: (world) => ({
      ...world,
      genre: world.genre || 'survival drama',
      era: { when: 'future', period: 'a few years after the collapse of everything', techNotes: 'No working grid or networks; hand radios, old cars when there is fuel, barter.' },
      currency: { name: 'rounds', priceGuide: 'a can of food 2; a night under a roof 5; a litre of fuel 10; a working radio 40' },
      calendar: { yearLabel: 'Year', start: { year: 2041, month: 9, day: 1, hour: 17, minute: 0 } },
      letterCarriers: ['hand radio', 'note left at a drop', 'a traveller'],
      artStyle: 'cinematic photo, dusty, desaturated',
    }),
  },
];

export function applyPreset(draft: WizardDraft, presetId: string): WizardDraft {
  const preset = WORLD_PRESETS.find((item) => item.id === presetId);
  if (!preset) return draft;
  const world = preset.apply(draft.world);
  return { ...draft, world, opening: { ...draft.opening, date: { ...world.calendar.start } } };
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
  none: 'Indoors (no weather)',
};

// ---------------------------------------------------------------------------
// New list items

export function newRegion(): RegionDef {
  return { id: makeId('region'), name: '', description: '', climate: 'temperate', neighbours: [] };
}

export function newPlace(regionId = ''): PlaceDef {
  return { id: makeId('place'), name: '', regionId, kind: 'structure', description: '' };
}

export function newFaction(): FactionDef {
  return { id: makeId('faction'), name: '', description: '' };
}

export function newLore(): LoreRecord {
  return { id: makeId('lore'), keywords: [], priority: 2, text: '', enabled: true };
}

export function newTimelineEvent(start: CalendarDate): TimelineEvent {
  return {
    id: makeId('event'),
    title: '',
    description: '',
    from: { year: start.year, month: start.month, day: start.day },
    knowledge: 'public',
    facts: [],
  };
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

/** Readable ids from names ("The Anchor" → "the-anchor"), unique within the list. */
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
  const regions = withReadableIds(raw.regions.filter((region) => clean(region.name)));
  const factions = withReadableIds(raw.factions.filter((faction) => clean(faction.name)));
  const places = withReadableIds(raw.places.filter((place) => clean(place.name)));
  const regionId = (id: string | undefined) => (id ? regions.idMap.get(id) ?? (regions.items.some((r) => r.id === id) ? id : undefined) : undefined);

  const world: WorldDefinition = normalizeWorld({
    ...raw,
    name: clean(raw.name),
    premise: clean(raw.premise),
    regions: regions.items.map((region) => ({
      ...region,
      name: clean(region.name),
      description: clean(region.description),
      neighbours: region.neighbours
        .map((next) => ({ id: regionId(next.id) ?? '', days: Math.max(0, Number(next.days) || 0) }))
        .filter((next) => next.id && next.id !== region.id),
    })),
    factions: factions.items.map((faction) => ({
      ...faction,
      name: clean(faction.name),
      description: clean(faction.description),
      territoryRegionIds: (faction.territoryRegionIds ?? []).map((id) => regionId(id)).filter((id): id is string => Boolean(id)),
      carriers: cleanList(faction.carriers).length ? cleanList(faction.carriers) : undefined,
    })),
    places: places.items.map((place) => ({ ...place, name: clean(place.name), description: clean(place.description), regionId: regionId(place.regionId) ?? regions.items[0]?.id ?? '' })),
    lore: raw.lore
      .filter((entry) => clean(entry.text))
      .map((entry) => ({ ...entry, text: clean(entry.text), keywords: cleanList(entry.keywords).map((word) => word.toLowerCase()) })),
    timeline: raw.timeline
      .filter((event) => clean(event.title))
      .map((event) => ({
        ...event,
        id: slug(event.title) || event.id,
        title: clean(event.title),
        description: clean(event.description) || clean(event.title),
        regionId: regionId(event.regionId),
        factionId: event.factionId ? factions.idMap.get(event.factionId) ?? event.factionId : undefined,
        facts: cleanList(event.facts).length ? cleanList(event.facts) : [clean(event.description) || clean(event.title)],
      })),
    letterCarriers: cleanList(raw.letterCarriers).length ? cleanList(raw.letterCarriers) : emptyWorld().letterCarriers,
    calendar: { ...raw.calendar, start: { ...draft.opening.date } },
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

  return { world, character, people, opening, truths };
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
    slotName: typeof input.slotName === 'string' ? input.slotName : '',
  };
}

// ---------------------------------------------------------------------------
// "Help me fill this": one optional call per section.

export type HelpSection = 'world' | 'places' | 'lore' | 'you' | 'backstory' | 'people' | 'opening' | 'timeline';

const HELP_SHAPES: Record<HelpSection, string> = {
  world:
    '{"genre": string, "tone": string, "period": string, "techNotes": string, "currencyName": string, "priceGuide": string, "artStyle": string, "letterCarriers": string[]}',
  places:
    '{"regions": [{"name": string, "description": string, "climate": one of temperate|continental|desert|tundra|tropical|monsoon|rainy|coastal|mountain|none}], "places": [{"name": string, "region": region name, "kind": one of settlement|structure|road|wilderness, "description": string}], "factions": [{"name": string, "description": string}]}',
  lore: '{"lore": [{"keywords": string[], "text": string}]}',
  you: '{"appearance": string, "outfit": string, "personality": string, "speechStyle": string, "role": string, "skills": string, "inventory": string[], "goals": string[]}',
  backstory: '{"backstory": string, "truths": string[], "secrets": string[]}',
  people:
    '{"people": [{"name": string, "age": number, "gender": string, "role": string, "appearance": string, "personality": string, "speechStyle": string, "relationship": string}]}',
  opening: '{"location": string, "situation": string, "threads": string[]}',
  timeline: '{"timeline": [{"title": string, "description": string, "monthsFromStart": number}]}',
};

function draftSummary(draft: WizardDraft) {
  const world = draft.world;
  const character = draft.character;
  const lines = [
    `World: ${world.name || '(unnamed)'}. ${world.premise}`,
    world.genre ? `Genre: ${world.genre}. Tone: ${world.tone}.` : '',
    `When: ${world.era.when}, ${world.era.period}. ${world.era.techNotes ?? ''}`,
    world.regions.length ? `Areas: ${world.regions.map((region) => region.name).filter(Boolean).join(', ')}.` : '',
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
    'You help a player set up their own roleplay story. Suggest values only for what is still empty in the section asked for; never change what the player already wrote, and keep to their world, period and tone.',
    'The world is grounded in reality: no magic, powers or supernatural beings, and technology fits the period.',
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
const CLIMATES: ClimateType[] = ['temperate', 'continental', 'desert', 'tundra', 'tropical', 'monsoon', 'rainy', 'coastal', 'mountain', 'none'];
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
          era: { ...world.era, period: fill(world.era.period, s.period), techNotes: fill(world.era.techNotes, s.techNotes) },
          currency: { ...world.currency, name: fill(world.currency.name, s.currencyName), priceGuide: fill(world.currency.priceGuide, s.priceGuide) },
          artStyle: fill(world.artStyle, s.artStyle),
          letterCarriers: fillList(world.letterCarriers, s.letterCarriers),
        },
      };
    }
    case 'places': {
      const regions = [...draft.world.regions];
      for (const item of Array.isArray(s.regions) ? s.regions : []) {
        const name = str((item as Record<string, unknown>).name);
        if (!name || regions.some((region) => region.name.toLowerCase() === name.toLowerCase())) continue;
        const climate = str((item as Record<string, unknown>).climate) as ClimateType;
        regions.push({ ...newRegion(), name, description: str((item as Record<string, unknown>).description), climate: CLIMATES.includes(climate) ? climate : 'temperate' });
      }
      const places = [...draft.world.places];
      for (const item of Array.isArray(s.places) ? s.places : []) {
        const record = item as Record<string, unknown>;
        const name = str(record.name);
        if (!name || places.some((place) => place.name.toLowerCase() === name.toLowerCase())) continue;
        const region = regions.find((r) => r.name.toLowerCase() === str(record.region).toLowerCase()) ?? regions[0];
        const kind = str(record.kind) as PlaceDef['kind'];
        places.push({ ...newPlace(region?.id ?? ''), name, kind: KINDS.includes(kind) ? kind : 'structure', description: str(record.description) });
      }
      const factions = [...draft.world.factions];
      for (const item of Array.isArray(s.factions) ? s.factions : []) {
        const name = str((item as Record<string, unknown>).name);
        if (!name || factions.some((faction) => faction.name.toLowerCase() === name.toLowerCase())) continue;
        factions.push({ ...newFaction(), name, description: str((item as Record<string, unknown>).description) });
      }
      return { ...draft, world: { ...draft.world, regions, places, factions } };
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
    case 'people': {
      const people = [...draft.people];
      for (const item of Array.isArray(s.people) ? s.people : []) {
        const record = item as Record<string, unknown>;
        const name = str(record.name);
        if (!name || people.some((person) => person.name.toLowerCase() === name.toLowerCase())) continue;
        const age = Number(record.age);
        people.push({
          ...emptyPerson(),
          name,
          age: Number.isFinite(age) && age >= 18 ? Math.round(age) : undefined,
          gender: str(record.gender),
          role: str(record.role),
          appearance: str(record.appearance),
          personality: str(record.personality),
          speechStyle: str(record.speechStyle),
          relationship: str(record.relationship) || 'acquaintance',
        });
      }
      return { ...draft, people };
    }
    case 'opening': {
      const o = draft.opening;
      return { ...draft, opening: { ...o, location: fill(o.location, s.location), situation: fill(o.situation, s.situation), threads: fillList(o.threads, s.threads) } };
    }
    case 'timeline': {
      const timeline = [...draft.world.timeline];
      const start = draft.opening.date;
      for (const item of Array.isArray(s.timeline) ? s.timeline : []) {
        const record = item as Record<string, unknown>;
        const title = str(record.title);
        if (!title) continue;
        const months = Math.max(0, Math.round(Number(record.monthsFromStart) || 0));
        const total = start.month - 1 + months;
        timeline.push({
          ...newTimelineEvent(start),
          title,
          description: str(record.description),
          from: { year: start.year + Math.floor(total / 12), month: (total % 12) + 1 },
        });
      }
      return { ...draft, world: { ...draft.world, timeline } };
    }
  }
}

/** Plain-text lines → list ("one per line"), and back. */
export function linesToList(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function listToLines(values: string[] | undefined): string {
  return (values ?? []).join('\n');
}

/** Comma-separated text → list, and back. */
export function commaToList(text: string): string[] {
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

export function listToComma(values: string[] | undefined): string {
  return (values ?? []).join(', ');
}
