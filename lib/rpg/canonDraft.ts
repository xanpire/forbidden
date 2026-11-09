// "Draft from canon" (session 6): for a real period or a grounded known
// setting ("Victorian London", "Tokyo 1990s", a realistic show or novel), the
// AI drafts a cast, groups, places, a timeline and lore in the wizard's own
// shapes. One call per kind keeps replies small. Nothing is saved until the
// player accepts an item; accepted items land in the normal editors.
//
// Rules, in the prompt and again in code:
// - Grounded only: no magic, powers or supernatural beings. A setting that
//   needs them is refused.
// - Drafted people are adults with stated ages; anyone under 18 or without an
//   age loses any intimacy section.
// - Real historical figures are background only: marked realPerson, never
//   given an intimacy section.
// - Timeline beats are dated, placed and say who could know; personal beats
//   only when the player asks for them.

import { emptyPerson, newFaction, newLore, newPlace, newRegion, newTimelineEvent, type WizardDraft } from './wizard';
import type { ClimateType, OpenRouterMessage, PlaceDef, StartingPerson, TimelineEvent, TimelineKnowledge } from './types';

export const CANON_KINDS = ['cast', 'factions', 'places', 'timeline', 'lore'] as const;
export type CanonKind = (typeof CANON_KINDS)[number];

export const CANON_LABELS: Record<CanonKind, string> = {
  cast: 'Main cast',
  factions: 'Groups',
  places: 'Areas and places',
  timeline: 'Timeline',
  lore: 'Lore',
};

const SHAPES: Record<CanonKind, string> = {
  cast: '{"people": [{"name": string, "age": number, "gender": string, "role": string, "appearance": string, "personality": string, "speechStyle": string, "realPerson": boolean, "fame": "sight" | "heard" | null, "alive": boolean, "birthday": {"month": number, "day": number} | null, "heartTaken": string | null, "openToRomance": boolean}]}',
  factions: '{"factions": [{"name": string, "description": string, "hasBounties": boolean}]}',
  places: '{"regions": [{"name": string, "description": string, "climate": one of temperate|continental|desert|tundra|tropical|monsoon|rainy|coastal|mountain|none, "travelDaysTo": {"<other region name>": number}}], "places": [{"name": string, "region": region name, "kind": one of settlement|structure|road|wilderness, "description": string}]}',
  timeline: '{"timeline": [{"title": string, "description": string, "year": number, "month": number, "day": number | null, "region": region name | null, "knowledge": one of public|faction|witnesses|secret, "group": group name | null, "major": boolean, "deaths": string[], "personal": boolean}]}',
  lore: '{"lore": [{"keywords": string[], "text": string}]}',
};

export type CanonRequest = { kind: CanonKind; setting: string; startPoint: string; personalBeats?: boolean };

export function canonDraftMessages(request: CanonRequest, draft: WizardDraft): OpenRouterMessage[] {
  const known = [
    draft.world.regions.length ? `Areas already written: ${draft.world.regions.map((r) => r.name).join(', ')}.` : '',
    draft.world.factions.length ? `Groups already written: ${draft.world.factions.map((f) => f.name).join(', ')}.` : '',
    draft.people.length ? `People already written: ${draft.people.map((p) => p.name).join(', ')}.` : '',
  ].filter(Boolean);
  const system = [
    `You draft source material for a grounded roleplay set in ${request.setting}, starting at: ${request.startPoint || 'the beginning'}. Stay true to the real history or the source as it stands at that point.`,
    'Grounded in reality only: no magic, powers, supernatural beings or impossible technology. If this setting cannot be told without them, reply {"error": "needs magic or powers"} and nothing else.',
    'Every person is an adult with a stated age of 18 or older at the start point; leave out anyone younger. Real, identifiable people (historical figures, celebrities) may appear only as background: set realPerson true for them.',
    request.kind === 'timeline'
      ? `Timeline events happen after the start point, with real dates, where they happen and who could know. ${request.personalBeats ? 'You may mark a few as personal (offered to the player).' : 'Set personal false for all of them.'}`
      : '',
    'Do not repeat anything already written.',
    `Reply with one JSON object only, in this shape: ${SHAPES[request.kind]}. Concrete and short, plain English, at most 8 items.`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: [`Setting: ${request.setting}`, `Start point: ${request.startPoint || 'the beginning'}`, ...known, `Draft: ${CANON_LABELS[request.kind]}.`].join('\n') },
  ];
}

const str = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const strs = (value: unknown) => (Array.isArray(value) ? value.map(str).filter(Boolean) : []);
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : undefined);
const records = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : []);
const CLIMATES: ClimateType[] = ['temperate', 'continental', 'desert', 'tundra', 'tropical', 'monsoon', 'rainy', 'coastal', 'mountain', 'none'];
const KINDS: PlaceDef['kind'][] = ['settlement', 'structure', 'road', 'wilderness'];
const KNOWLEDGE: TimelineKnowledge[] = ['public', 'faction', 'witnesses', 'secret'];

/** One drafted item the player can accept or skip. */
export type CanonItem =
  | { kind: 'person'; label: string; value: StartingPerson }
  | { kind: 'faction'; label: string; value: ReturnType<typeof newFaction> }
  | { kind: 'region'; label: string; value: ReturnType<typeof newRegion>; travel: Record<string, number> }
  | { kind: 'place'; label: string; value: ReturnType<typeof newPlace>; regionName: string }
  | { kind: 'event'; label: string; value: TimelineEvent; regionName?: string; groupName?: string }
  | { kind: 'lore'; label: string; value: ReturnType<typeof newLore> };

export type CanonParse = { items: CanonItem[]; error?: string };

/** Reads the model's reply into accept-or-skip items, enforcing the rules again in code. */
export function parseCanonDraft(request: CanonRequest, text: string, draft: WizardDraft): CanonParse {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { items: [], error: 'No draft came back.' };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(match[0]);
  } catch {
    return { items: [], error: 'The draft was not readable.' };
  }
  if (str(json.error)) return { items: [], error: `Can't draft this setting: ${str(json.error)}.` };

  const items: CanonItem[] = [];
  const start = draft.opening.date;

  if (request.kind === 'cast') {
    for (const raw of records(json.people).slice(0, 8)) {
      const name = str(raw.name);
      const age = num(raw.age);
      if (!name || age === undefined || age < 18) continue; // adults with stated ages only
      const real = raw.realPerson === true;
      const birthday = raw.birthday && typeof raw.birthday === 'object' ? (raw.birthday as Record<string, unknown>) : null;
      const taken = str(raw.heartTaken);
      const person: StartingPerson = {
        ...emptyPerson(),
        name,
        age: Math.round(age),
        gender: str(raw.gender),
        role: str(raw.role),
        appearance: str(raw.appearance),
        personality: str(raw.personality),
        speechStyle: str(raw.speechStyle),
        relationship: 'stranger',
        alive: raw.alive !== false,
        knownName: raw.fame === 'sight' || raw.fame === 'heard',
        met: false,
        ...(real ? { realPerson: true } : {}),
        ...(raw.fame === 'sight' || raw.fame === 'heard' ? { fame: raw.fame } : {}),
        ...(birthday && num(birthday.month) && num(birthday.day) ? { birthday: { month: num(birthday.month)!, day: num(birthday.day)! } } : {}),
        // Real people never get an intimacy section; fictional ones only as the source has them.
        ...(!real && (raw.openToRomance === true || taken)
          ? { intimacy: { orientation: '', interestedInPlayer: taken ? ('taken' as const) : ('could-grow' as const), desires: [], boundaries: [], ...(taken ? { devotion: taken } : {}) } }
          : {}),
      };
      items.push({ kind: 'person', label: `${name}, ${person.age} · ${person.role}${real ? ' (real, background only)' : ''}`, value: person });
    }
  }

  if (request.kind === 'factions') {
    for (const raw of records(json.factions).slice(0, 8)) {
      const name = str(raw.name);
      if (!name) continue;
      items.push({ kind: 'faction', label: name, value: { ...newFaction(), name, description: str(raw.description), ...(raw.hasBounties === true ? { hasBounties: true } : {}) } });
    }
  }

  if (request.kind === 'places') {
    for (const raw of records(json.regions).slice(0, 8)) {
      const name = str(raw.name);
      if (!name) continue;
      const climate = str(raw.climate) as ClimateType;
      const travel: Record<string, number> = {};
      if (raw.travelDaysTo && typeof raw.travelDaysTo === 'object') {
        for (const [other, days] of Object.entries(raw.travelDaysTo as Record<string, unknown>)) {
          const value = num(days);
          if (value !== undefined && value > 0) travel[other] = value;
        }
      }
      items.push({ kind: 'region', label: name, value: { ...newRegion(), name, description: str(raw.description), climate: CLIMATES.includes(climate) ? climate : 'temperate' }, travel });
    }
    for (const raw of records(json.places).slice(0, 8)) {
      const name = str(raw.name);
      if (!name) continue;
      const kind = str(raw.kind) as PlaceDef['kind'];
      items.push({ kind: 'place', label: `${name} (${str(raw.region) || 'no area'})`, value: { ...newPlace(''), name, kind: KINDS.includes(kind) ? kind : 'structure', description: str(raw.description) }, regionName: str(raw.region) });
    }
  }

  if (request.kind === 'timeline') {
    for (const raw of records(json.timeline).slice(0, 8)) {
      const title = str(raw.title);
      const year = num(raw.year);
      const month = num(raw.month);
      if (!title || year === undefined || month === undefined || month < 1 || month > 12) continue;
      const knowledge = str(raw.knowledge) as TimelineKnowledge;
      const day = num(raw.day);
      const event: TimelineEvent = {
        ...newTimelineEvent(start),
        title,
        description: str(raw.description) || title,
        from: { year: Math.round(year), month: Math.round(month), ...(day ? { day: Math.max(1, Math.min(31, Math.round(day))) } : {}) },
        knowledge: KNOWLEDGE.includes(knowledge) ? knowledge : 'public',
        ...(raw.major === true ? { major: true } : {}),
        ...(strs(raw.deaths).length ? { deaths: strs(raw.deaths) } : {}),
        ...(request.personalBeats && raw.personal === true ? { playerDriven: true } : {}),
        facts: [str(raw.description) || title],
      };
      items.push({ kind: 'event', label: `${title} · ${event.from.year}-${String(event.from.month).padStart(2, '0')}`, value: event, regionName: str(raw.region) || undefined, groupName: str(raw.group) || undefined });
    }
  }

  if (request.kind === 'lore') {
    for (const raw of records(json.lore).slice(0, 8)) {
      const text = str(raw.text);
      if (!text) continue;
      items.push({ kind: 'lore', label: text.slice(0, 60), value: { ...newLore(), text, keywords: strs(raw.keywords).map((word) => word.toLowerCase()) } });
    }
  }

  return { items };
}

/** Adds one accepted item to the draft, linking areas and groups by name. */
export function acceptCanonItem(draft: WizardDraft, item: CanonItem): WizardDraft {
  const world = draft.world;
  const regionId = (name: string | undefined) => (name ? world.regions.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id : undefined);
  switch (item.kind) {
    case 'person':
      return draft.people.some((p) => p.name === item.value.name) ? draft : { ...draft, people: [...draft.people, item.value] };
    case 'faction':
      return { ...draft, world: { ...world, factions: [...world.factions, item.value] } };
    case 'region': {
      const neighbours = Object.entries(item.travel)
        .map(([name, days]) => ({ id: regionId(name) ?? '', days }))
        .filter((next) => next.id);
      const region = { ...item.value, neighbours };
      // Travel goes both ways.
      const regions = world.regions.map((r) => {
        const back = neighbours.find((next) => next.id === r.id);
        return back ? { ...r, neighbours: [...r.neighbours.filter((n) => n.id !== region.id), { id: region.id, days: back.days }] } : r;
      });
      return { ...draft, world: { ...world, regions: [...regions, region] } };
    }
    case 'place':
      return { ...draft, world: { ...world, places: [...world.places, { ...item.value, regionId: regionId(item.regionName) ?? world.regions[0]?.id ?? '' }] } };
    case 'event': {
      const factionId = item.groupName ? world.factions.find((f) => f.name.toLowerCase() === item.groupName!.toLowerCase())?.id : undefined;
      const event = {
        ...item.value,
        ...(regionId(item.regionName) ? { regionId: regionId(item.regionName) } : {}),
        ...(factionId ? { factionId } : item.value.knowledge === 'faction' ? { knowledge: 'public' as const } : {}),
      };
      return { ...draft, world: { ...world, timeline: [...world.timeline, event] } };
    }
    case 'lore':
      return { ...draft, world: { ...world, lore: [...world.lore, item.value] } };
  }
}
