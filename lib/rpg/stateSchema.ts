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
export const SCENE_PACES = ['action', 'conversation', 'travel', 'downtime'] as const;
export const TURN_KINDS = ['exchange', 'instruction', 'remark', 'action', 'travel'] as const;
export const LOCATION_KINDS = ['settlement', 'road', 'wilderness', 'structure'] as const;
export const RELATIONSHIPS = [
  'stranger',
  'acquaintance',
  'friendly',
  'close',
  'old friend',
  'family',
  'teammate',
  'partner',
  'mentor',
  'student',
  'rival',
  'enemy',
  'romantic interest',
  'lover',
  'rejected',
  'ex',
] as const;
export const ATTRACTIONS = ['none', 'warm', 'strong'] as const;
export const GENDERS = ['male', 'female', 'unknown'] as const;
export const ATTRACTED_TO = ['men', 'women', 'both', 'none', 'unknown'] as const;
export const FACT_TYPES = [
  'death',
  'injury',
  'condition',
  'secret',
  'knowledge',
  'membership',
  'possession',
  'relationship',
  'plan',
  'figure',
  'event',
  'other',
] as const;
export const FACT_LASTS = ['lasting', 'until_rest', 'days'] as const;
export const GRUDGE_EVENTS = ['wronged', 'settled', 'forgiven'] as const;
export const THREAD_STATUSES = ['open', 'update', 'resolved'] as const;
export const CONSEQUENCE_KINDS = ['spared', 'lie', 'helped', 'witness', 'betrayal', 'humiliated', 'promise', 'debt'] as const;

export const TURN_STATE_SCHEMA = object({
  time: object({
    elapsed: nullableNumber,
    unit: nullableEnum(TIME_UNITS),
    clock_time: nullableString,
  }),
  scene_pace: nullableEnum(SCENE_PACES),
  // How this turn played (the player's input and the reply together), and who the player was talking with.
  turn_kind: nullableEnum(TURN_KINDS),
  talking_with: stringList,
  location: nullableString,
  location_kind: nullableEnum(LOCATION_KINDS),
  mood: nullableString,
  world_description: nullableString,
  inventory_added: stringList,
  inventory_removed: stringList,
  // Every change to the player's own money this turn, in the world's currency
  // (negative when they pay), and their total only when the prose states it.
  money: list({
    amount: { type: 'number' },
    reason: { type: 'string' },
  }),
  money_counted: nullableNumber,
  // People are referred to by their ID from KNOWN CHARACTERS (or, for someone
  // added this turn under new_characters, by that exact name).
  // Two sides: affinity_change / note are how THEY feel about the player (only from
  // what they could see or hear); your_change / your_note are how the player feels
  // about them (their inner thoughts move only this side).
  bonds: list({
    character_id: { type: 'string' },
    affinity_change: nullableNumber,
    status: nullableString,
    note: nullableString,
    your_change: nullableNumber,
    your_note: nullableString,
    relationship: nullableEnum(RELATIONSHIPS),
    attraction: nullableEnum(ATTRACTIONS),
    romance_note: nullableString,
  }),
  // entity: who the fact is about (an id; "player" when it is about the player).
  // supersedes: refs of active facts this one replaces. claimed_by: the
  // speaker, when this is only what someone said. lasts/days: how long a
  // temporary condition, injury or plan holds.
  facts: list({
    entity: { type: 'string' },
    fact: { type: 'string' },
    type: nullableEnum(FACT_TYPES),
    who_knows: stringList,
    supersedes: stringList,
    claimed_by: nullableString,
    lasts: nullableEnum(FACT_LASTS),
    days: nullableNumber,
  }),
  // Refs of active facts that stopped being true this turn.
  facts_ended: stringList,
  // participants: ids of the people the thread is about (besides the player).
  threads: list({
    title: { type: 'string' },
    description: nullableString,
    status: { type: 'string', enum: [...THREAD_STATUSES] },
    participants: stringList,
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
    gender: nullableEnum(GENDERS),
    attracted_to: nullableEnum(ATTRACTED_TO),
    // A one-scene character: a waiter, a guard, a shopkeeper.
    minor: { type: 'boolean' },
    // false for a stranger whose name the player has not learned: name is then a
    // short description of how they look to the player ("the woman in the green coat").
    name_known: { type: 'boolean' },
  }),
  // appearance: how they look right now (clothes, wet, bloodied, dressed up). lasting_appearance: only a real lasting change to their base look.
  character_updates: list({
    character_id: { type: 'string' },
    mood: nullableString,
    appearance: nullableString,
    lasting_appearance: nullableString,
    whereabouts: nullableString,
  }),
  // A death the prose makes certain this turn — on screen, a body the player sees,
  // or someone telling the player — by character id. revived is only someone who
  // turns out to be alive after all (a wrong report, a faked death).
  deaths: list({
    character_id: { type: 'string' },
    cause: nullableString,
  }),
  revived: stringList,
  characters_present: stringList,
  // Someone who clearly sets out with the player this turn, or a companion who truly
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
  // The weather, only when the page changes it from WEATHER NOW.
  weather: nullableString,
  // Home: where the player lives now (only when they move), where they are
  // staying if not at home ("" when they go back home), and who moved in or out.
  home: {
    type: ['object', 'null'],
    properties: {
      lives_at: nullableString,
      staying_at: nullableString,
      moved_in: stringList,
      moved_out: stringList,
    },
    required: ['lives_at', 'staying_at', 'moved_in', 'moved_out'],
    additionalProperties: false,
  },
  // A title for a new chapter, only when this turn opens one (a major story
  // turn, a big change of place, or a time skip).
  chapter_title: nullableString,
  // Intimacy (intimacy.ts): scene on/off, ladder steps, firsts, learned
  // preferences, clothes and positions, and the two hard-limit flags.
  intimate_scene: { type: ['boolean', 'null'] },
  intimacy_stage_changed: list({
    character_id: { type: 'string' },
    stage: { type: 'string' },
  }),
  first: list({
    character_id: { type: 'string' },
    what: { type: 'string' },
  }),
  preference_learned: list({
    character_id: { type: 'string' },
    preference: { type: 'string' },
    about_player: { type: 'boolean' },
  }),
  outfit_changed: list({
    character_id: { type: 'string' },
    outfit: nullableString,
    position: nullableString,
  }),
  limit_crossed: { type: 'boolean' },
  age_rule_crossed: { type: 'boolean' },
  // Something in a person's own life away from the player that this turn revealed.
  life_events: list({
    character_id: { type: 'string' },
    event: { type: 'string' },
  }),
  // People whose birthday the player learned on the page this turn.
  birthdays_learned: stringList,
  // Names the player heard or read this turn, within their hearing or reading.
  names_learned: list({
    character_id: { type: 'string' },
    name: { type: 'string' },
    part: { type: 'string', enum: ['given', 'family', 'full'] },
    how: { type: 'string', enum: ['introduced', 'told', 'written', 'overheard'] },
  }),
  // Choices that could come back later, and offered ones that came back.
  consequences: list({
    kind: { type: 'string', enum: [...CONSEQUENCE_KINDS] },
    character_id: nullableString,
    who: { type: 'string' },
    what: { type: 'string' },
    want: nullableString,
    witnesses: stringList,
    when: nullableEnum(['weeks', 'months', 'years']),
  }),
  consequences_returned: stringList,
  // Grudges against the player: started, settled, or forgiven.
  grudges: list({
    character_id: { type: 'string' },
    event: { type: 'string', enum: [...GRUDGE_EVENTS] },
    reason: nullableString,
  }),
});

export const TURN_STATE_SCHEMA_NAME = 'turn_state';
