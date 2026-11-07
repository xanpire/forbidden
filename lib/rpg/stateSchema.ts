/**
 * JSON schema for the per-turn state call (call 2 of a turn).
 *
 * The narrator writes prose only. A cheap model then reads that prose and
 * returns this object through OpenRouter's structured output
 * (`response_format: { type: "json_schema", strict: true }`).
 *
 * Strict mode requires every property to be listed in `required` and
 * `additionalProperties: false` everywhere, so "unchanged" is expressed as
 * `null` for single values and `[]` for lists. `convertStateBlock` in
 * services.ts ignores nulls and empty lists, and turns the rest into a
 * `TurnDiff`.
 */

const nullableString = { type: ['string', 'null'] } as const;
const nullableNumber = { type: ['number', 'null'] } as const;
const stringList = { type: 'array', items: { type: 'string' } } as const;

function nullableEnum(values: readonly string[]) {
  return { type: ['string', 'null'], enum: [...values, null] };
}

function object(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function list(properties: Record<string, unknown>) {
  return { type: 'array', items: object(properties) };
}

export const TIME_UNITS = ['seconds', 'minutes', 'hours', 'days'] as const;
export const SCENE_PACES = ['combat', 'chase', 'conversation', 'travel', 'downtime'] as const;
export const LOCATION_KINDS = ['settlement', 'road', 'wilderness', 'structure'] as const;
export const RELATIONSHIPS = [
  'stranger',
  'friendly',
  'close',
  'romantic interest',
  'partner',
  'rejected',
  'ex',
] as const;
export const ATTRACTIONS = ['none', 'warm', 'strong'] as const;
export const FACT_TYPES = [
  'death',
  'injury',
  'secret',
  'knowledge',
  'membership',
  'possession',
  'event',
  'other',
] as const;
export const REPUTATION_FACTIONS = ['leaf', 'sand', 'mist', 'cloud', 'stone', 'akatsuki'] as const;
export const VILLAGE_FACTIONS = ['leaf', 'sand', 'mist', 'cloud', 'stone'] as const;
export const GRUDGE_EVENTS = ['wronged', 'struck', 'settled', 'forgiven'] as const;
export const THREAD_STATUSES = ['open', 'update', 'resolved'] as const;

export const TURN_STATE_SCHEMA = object({
  time: object({
    elapsed: nullableNumber,
    unit: nullableEnum(TIME_UNITS),
    clock_time: nullableString,
  }),
  scene_pace: nullableEnum(SCENE_PACES),
  location: nullableString,
  location_kind: nullableEnum(LOCATION_KINDS),
  mood: nullableString,
  world_description: nullableString,
  canon_point: nullableString,
  inventory_added: stringList,
  inventory_removed: stringList,
  jutsu_used: list({
    name: { type: 'string' },
    // A character ID ("kan", "kisame-hoshigaki"), or a description for an unnamed user.
    user: { type: 'string' },
    chakra_nature: nullableString,
    effect: nullableString,
    visual: nullableString,
  }),
  // People are referred to by their ID from KNOWN CHARACTERS (or, for someone
  // added this turn under new_characters, by that exact name).
  bonds: list({
    character_id: { type: 'string' },
    affinity_change: nullableNumber,
    status: nullableString,
    note: nullableString,
    relationship: nullableEnum(RELATIONSHIPS),
    attraction: nullableEnum(ATTRACTIONS),
    romance_note: nullableString,
  }),
  facts: list({
    entity: nullableString,
    fact: { type: 'string' },
    type: nullableEnum(FACT_TYPES),
    who_knows: stringList,
  }),
  threads: list({
    title: { type: 'string' },
    description: nullableString,
    status: { type: 'string', enum: [...THREAD_STATUSES] },
  }),
  // Only people absent from KNOWN CHARACTERS, each with is_new: true. Entries
  // with is_new: false are dropped, so a known person can never be re-added.
  new_characters: list({
    is_new: { type: 'boolean' },
    name: { type: 'string' },
    age: nullableNumber,
    role: nullableString,
    personality: nullableString,
    speech_style: nullableString,
    appearance: nullableString,
  }),
  character_updates: list({
    character_id: { type: 'string' },
    mood: nullableString,
    appearance: nullableString,
  }),
  // A death the prose makes certain this turn — on screen, a body Kan sees,
  // or someone telling Kan — by character id. revived is only a true return
  // to life (Chiyo's jutsu, say), never an Edo Tensei reanimation.
  deaths: list({
    character_id: { type: 'string' },
    cause: nullableString,
  }),
  revived: stringList,
  characters_present: stringList,
  // Someone who clearly sets out with Kan this turn, or a companion who truly
  // parts ways (not a short step away), by character id.
  companions_joined: list({
    character_id: { type: 'string' },
    reason: nullableString,
  }),
  companions_left: list({
    character_id: { type: 'string' },
    reason: nullableString,
  }),
  image_worthy: { type: 'boolean' },
  scene_ended: { type: 'boolean' },
  // A short name for the scene, only when a new scene starts this turn.
  scene_title: nullableString,
  canon_engaged: stringList,
  canon_completed: stringList,
  canon_passed: stringList,
  news_relayed: list({
    id: { type: 'string' },
    from: nullableString,
  }),
  // A letter or message Kan writes and sends to someone not in the scene.
  letters_sent: list({
    to: { type: 'string' },
    gist: nullableString,
  }),
  // People whose letter actually reached Kan on the page this turn.
  letters_received: stringList,
  // What a village (or the Akatsuki) now has on Kan, from deeds its people
  // saw or survived this turn; and villages whose entry on him he learned of.
  reputation: list({
    faction: { type: 'string', enum: [...REPUTATION_FACTIONS] },
    change: { type: 'number' },
    reason: nullableString,
  }),
  bounty_seen: { type: 'array', items: { type: 'string', enum: [...VILLAGE_FACTIONS] } },
  // Grudges against Kan: started, acted on, settled, or forgiven.
  grudges: list({
    character_id: { type: 'string' },
    event: { type: 'string', enum: [...GRUDGE_EVENTS] },
    reason: nullableString,
  }),
});

export const TURN_STATE_SCHEMA_NAME = 'kan_turn_state';
