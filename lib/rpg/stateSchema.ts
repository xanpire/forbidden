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
    user: { type: 'string' },
    chakra_nature: nullableString,
    effect: nullableString,
    visual: nullableString,
  }),
  bonds: list({
    character: { type: 'string' },
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
  new_characters: list({
    name: { type: 'string' },
    age: nullableNumber,
    role: nullableString,
    personality: nullableString,
    speech_style: nullableString,
    appearance: nullableString,
  }),
  character_updates: list({
    name: { type: 'string' },
    mood: nullableString,
    appearance: nullableString,
  }),
  characters_present: stringList,
  image_brief: nullableString,
  image_worthy: { type: 'boolean' },
  scene_ended: { type: 'boolean' },
  canon_engaged: stringList,
  canon_completed: stringList,
  canon_passed: stringList,
  news_relayed: list({
    id: { type: 'string' },
    from: nullableString,
  }),
});

export const TURN_STATE_SCHEMA_NAME = 'kan_turn_state';
