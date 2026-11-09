// Reading the state model's reply: JSON parsing and snake_case → TurnDiff.

import { readAmount } from './money';
import type {
  AppDatabase,
  ConsequenceKind,
  FactType,
  LocationKind,
  NameHow,
  NamePart,
  TurnDiff,
} from './types';
import { isPlayerRef, playerName, playerRefs } from './player';

const KINDS = ['spared', 'lie', 'helped', 'witness', 'betrayal', 'humiliated', 'promise', 'debt'] as const;

/** How the state reply may name the player: their name, and every ref. */
export type StatePlayer = { name: string; refs: readonly string[] };

const GENERIC_PLAYER: StatePlayer = { name: 'You', refs: playerRefs(null) };

/** The player's name and refs in this save, for convertStateBlock. */
export function statePlayerOf(db: AppDatabase): StatePlayer {
  return { name: playerName(db), refs: playerRefs(db) };
}

/**
 * Turns the state model's snake_case JSON (see stateSchema.ts) into a
 * `TurnDiff`. Lenient: nulls, empty lists and unknown values are ignored, and
 * the older nested `state: { location, ... }` shape is still accepted.
 */
export function convertStateBlock(
  block: Record<string, unknown> | null,
  player: StatePlayer = GENERIC_PLAYER
): { diff: TurnDiff | null; imageWorthy: boolean } {
  const notPlayer = (value: string) => !isPlayerRef(player.refs, value);

  if (!block || typeof block !== 'object') {
    return { diff: null, imageWorthy: false };
  }

  if (Object.keys(block).length === 0) {
    return { diff: null, imageWorthy: false };
  }

  const imageWorthy = block.image_worthy === true;
  const sceneEnded = block.scene_ended === true;
  const diff: TurnDiff = {};

  if (Array.isArray(block.birthdays_learned)) {
    const learned = block.birthdays_learned
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .slice(0, 3)
      .map((name) => ({ name: name.trim() }));

    if (learned.length > 0) {
      diff.birthdaysLearned = learned;
    }
  }

  if (Array.isArray(block.names_learned)) {
    const parts = new Set(['given', 'family', 'full']);
    const hows = new Set(['introduced', 'told', 'written', 'overheard']);
    const learned = block.names_learned
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        character: cleanString(item.character_id) ?? '',
        name: cleanString(item.name)?.slice(0, 60) ?? '',
        part: (typeof item.part === 'string' && parts.has(item.part) ? item.part : 'full') as NamePart,
        how: (typeof item.how === 'string' && hows.has(item.how) ? item.how : 'told') as NameHow,
      }))
      .filter((item) => item.character.length > 0 && item.name.length > 0 && notPlayer(item.character))
      .slice(0, 6);

    if (learned.length > 0) {
      diff.namesLearned = learned;
    }
  }

  if (Array.isArray(block.life_events)) {
    const events = block.life_events
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({ name: cleanString(item.character_id) ?? '', text: cleanString(item.event)?.slice(0, 160) ?? '' }))
      .filter((item) => item.name && item.text && notPlayer(item.name))
      .slice(0, 3);

    if (events.length > 0) {
      diff.lifeEvents = events;
    }
  }

  // Intimacy.
  if (typeof block.intimate_scene === 'boolean') {
    diff.intimateScene = block.intimate_scene;
  }

  const records = (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];

  const stages = records(block.intimacy_stage_changed)
    .map((item) => ({ name: cleanString(item.character_id) ?? '', stage: cleanString(item.stage) ?? '' }))
    .filter((item) => item.name && item.stage && notPlayer(item.name))
    .slice(0, 4);
  if (stages.length > 0) diff.intimacyStages = stages;

  const firsts = records(block.first)
    .map((item) => ({ name: cleanString(item.character_id) ?? '', what: cleanString(item.what)?.slice(0, 120) ?? '' }))
    .filter((item) => item.name && item.what && notPlayer(item.name))
    .slice(0, 3);
  if (firsts.length > 0) diff.firsts = firsts;

  const preferences = records(block.preference_learned)
    .map((item) => ({ name: cleanString(item.character_id) ?? '', preference: cleanString(item.preference)?.slice(0, 140) ?? '', aboutPlayer: item.about_player !== false }))
    .filter((item) => item.name && item.preference && notPlayer(item.name))
    .slice(0, 4);
  if (preferences.length > 0) diff.preferencesLearned = preferences;

  const outfits = records(block.outfit_changed)
    .map((item) => ({ name: cleanString(item.character_id) ?? '', outfit: cleanString(item.outfit) ?? undefined, position: cleanString(item.position) ?? undefined }))
    .filter((item) => item.name && (item.outfit || item.position))
    .slice(0, 6);
  if (outfits.length > 0) diff.outfits = outfits;

  if (block.limit_crossed === true) diff.limitCrossed = true;
  if (block.age_rule_crossed === true) diff.ageRuleCrossed = true;

  if (Array.isArray(block.consequences)) {
    const seeds = block.consequences
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const ref = cleanString(item.character_id);

        return {
          kind: (cleanString(item.kind)?.toLowerCase() ?? '') as ConsequenceKind,
          // The tracker's id; resolveCharacterRefs turns it into a person (or drops it).
          entityId: ref && ref.toLowerCase() !== 'null' ? ref : undefined,
          who: cleanString(item.who)?.slice(0, 120) ?? ref ?? '',
          what: cleanString(item.what)?.slice(0, 200) ?? '',
          want: cleanString(item.want)?.slice(0, 160),
          witnesses: stringItems(item.witnesses).slice(0, 6),
          when: ['weeks', 'months', 'years'].includes(String(item.when)) ? (item.when as 'weeks' | 'months' | 'years') : undefined,
        };
      })
      .filter((item) => (KINDS as readonly string[]).includes(item.kind) && item.who && item.what)
      .slice(0, 2);

    if (seeds.length > 0) {
      diff.consequences = seeds;
    }
  }

  const returned = stringItems(block.consequences_returned).slice(0, 2);

  if (returned.length > 0) {
    diff.consequencesReturned = returned;
  }

  if (Array.isArray(block.grudges)) {
    const events = new Set(['wronged', 'settled', 'forgiven']);
    const grudges = block.grudges
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: cleanString(item.character_id) ?? cleanString(item.name) ?? '',
        event: (typeof item.event === 'string' ? item.event.trim().toLowerCase() : '') as 'wronged' | 'settled' | 'forgiven',
        reason: cleanString(item.reason)?.slice(0, 160),
      }))
      .filter((item) => item.name.length > 0 && notPlayer(item.name) && events.has(item.event))
      .slice(0, 4);

    if (grudges.length > 0) {
      diff.grudges = grudges;
    }
  }

  const time = block.time;

  if (time && typeof time === 'object' && !Array.isArray(time)) {
    const rawTime = time as {
      elapsed?: unknown;
      unit?: unknown;
      clock_time?: unknown;
      days_passed?: unknown;
      time_of_day?: unknown;
    };

    const unitSeconds: Record<string, number> = {
      second: 1,
      seconds: 1,
      minute: 60,
      minutes: 60,
      hour: 3600,
      hours: 3600,
      day: 86400,
      days: 86400,
    };

    if (typeof rawTime.elapsed === 'number' && Number.isFinite(rawTime.elapsed)) {
      const multiplier =
        typeof rawTime.unit === 'string' ? unitSeconds[rawTime.unit.toLowerCase()] ?? 60 : 60;

      diff.state = {
        ...diff.state,
        elapsedSeconds: Math.max(0, Math.min(30 * 86400, Math.round(rawTime.elapsed * multiplier))),
      };
    } else if (typeof rawTime.days_passed === 'number' && Number.isFinite(rawTime.days_passed)) {
      diff.state = {
        ...diff.state,
        elapsedSeconds: Math.max(0, Math.min(30 * 86400, Math.round(rawTime.days_passed * 86400))),
      };
    }

    if (typeof rawTime.clock_time === 'string') {
      const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(rawTime.clock_time);

      if (match) {
        diff.state = {
          ...diff.state,
          clockTime: {
            hour: Math.max(0, Math.min(23, Number(match[1]))),
            minute: Math.max(0, Math.min(59, Number(match[2]))),
          },
        };
      }
    } else if (
      rawTime.time_of_day === 'morning' ||
      rawTime.time_of_day === 'afternoon' ||
      rawTime.time_of_day === 'evening' ||
      rawTime.time_of_day === 'night'
    ) {
      const legacyHours: Record<string, number> = {
        morning: 8,
        afternoon: 14,
        evening: 19,
        night: 22,
      };

      diff.state = {
        ...diff.state,
        clockTime: { hour: legacyHours[rawTime.time_of_day], minute: 0 },
      };
    }
  }

  if (
    block.scene_pace === 'action' ||
    block.scene_pace === 'conversation' ||
    block.scene_pace === 'travel' ||
    block.scene_pace === 'downtime'
  ) {
    diff.state = { ...diff.state, scenePace: block.scene_pace };
  }

  const turnKinds = ['exchange', 'instruction', 'remark', 'action', 'travel'] as const;
  const turnKind = turnKinds.find((kind) => kind === block.turn_kind);

  if (turnKind) {
    diff.turnKind = {
      kind: turnKind,
      with: Array.isArray(block.talking_with)
        ? block.talking_with
            .filter((id): id is string => typeof id === 'string' && id.trim().length > 0 && notPlayer(id))
            .map((id) => id.trim())
            .slice(0, 6)
        : [],
    };
  }

  if (typeof block.mood === 'string' && block.mood.trim()) {
    diff.state = { ...diff.state, mood: block.mood.trim().slice(0, 60) };
  }

  if (typeof block.world_description === 'string' && block.world_description.trim()) {
    diff.state = {
      ...diff.state,
      worldDescription: block.world_description.trim().slice(0, 220),
    };
  }

  const charactersPresent = Array.isArray(block.characters_present)
    ? block.characters_present
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0 && notPlayer(name))
        .slice(0, 8)
    : [];

  if (charactersPresent.length > 0) {
    diff.state = { ...diff.state, sceneCast: charactersPresent };
  }

  if (sceneEnded || charactersPresent.length > 0) {
    diff.scene = {
      ended: sceneEnded,
      ...(charactersPresent.length > 0 ? { entities: charactersPresent } : {}),
    };
  }

  const chapterTitle = cleanString(block.chapter_title)
    ?.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.!?]+$/, '')
    .trim();

  if (chapterTitle && chapterTitle.length >= 2) {
    diff.chapterTitle = chapterTitle.slice(0, 60);
  }

  const money = convertMoney(block.money);

  if (money.length > 0) {
    diff.money = money;
  }

  const counted = readAmount(block.money_counted);

  if (counted !== null && counted >= 0) {
    diff.moneyCounted = counted;
  }

  const home = convertHome(block.home);

  if (home) {
    diff.home = home;
  }

  const weather = cleanString(block.weather);

  if (weather && weather.length >= 2) {
    diff.weather = weather.slice(0, 80);
  }

  const sceneTitle = cleanString(block.scene_title)
    ?.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[.!?]+$/, '')
    .trim();

  if (sceneTitle && sceneTitle.length >= 2) {
    diff.state = { ...diff.state, scene: sceneTitle.slice(0, 60) };
  }

  const flatLocation = cleanString(block.location);
  const flatLocationKind = asLocationKind(block.location_kind);
  const flatWorldPoint = cleanString(block.world_point);
  const inventoryAdded = stringItems(block.inventory_added);
  const inventoryRemoved = stringItems(block.inventory_removed);

  if (flatLocation || flatLocationKind || flatWorldPoint || inventoryAdded.length || inventoryRemoved.length) {
    diff.state = {
      ...diff.state,
      ...(flatLocation ? { location: flatLocation } : {}),
      ...(flatLocationKind ? { locationKind: flatLocationKind } : {}),
      ...(flatWorldPoint ? { worldPoint: flatWorldPoint } : {}),
      ...(inventoryAdded.length ? { inventoryAdded } : {}),
      ...(inventoryRemoved.length ? { inventoryRemoved } : {}),
    };
  }

  const state = block.state;

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const rawState = state as {
      location?: unknown;
      world_point?: unknown;
      inventory_changes?: unknown;
      location_kind?: unknown;
    };

    const inventoryChanges =
      Array.isArray(rawState.inventory_changes) &&
      rawState.inventory_changes.length > 0
        ? rawState.inventory_changes.filter(
            (item): item is string => typeof item === 'string' && item.trim().length > 0
          )
        : [];

    diff.state = {
      ...diff.state,
      location:
        typeof rawState.location === 'string' && rawState.location.trim()
          ? rawState.location.trim()
          : undefined,
      locationKind:
        rawState.location_kind === 'settlement' ||
        rawState.location_kind === 'road' ||
        rawState.location_kind === 'wilderness' ||
        rawState.location_kind === 'structure'
          ? rawState.location_kind
          : undefined,
      worldPoint:
        typeof rawState.world_point === 'string' && rawState.world_point.trim()
          ? rawState.world_point.trim()
          : undefined,
      inventoryAdded: inventoryChanges,
    };
  }

  if (Array.isArray(block.bonds)) {
    diff.bonds = block.bonds
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const bond = item as {
          character_id?: unknown;
          character?: unknown;
          affinity_change?: unknown;
          status?: unknown;
          note?: unknown;
          relationship?: unknown;
          attraction?: unknown;
          romance_note?: unknown;
          your_change?: unknown;
          your_note?: unknown;
        };

        return {
          character:
            cleanString(bond.character_id) ?? (typeof bond.character === 'string' ? bond.character : ''),
          affinityDelta:
            typeof bond.affinity_change === 'number' ? bond.affinity_change : undefined,
          status: typeof bond.status === 'string' ? bond.status : undefined,
          note: typeof bond.note === 'string' ? bond.note : undefined,
          relationship:
            typeof bond.relationship === 'string' ? bond.relationship : undefined,
          attraction: typeof bond.attraction === 'string' ? bond.attraction : undefined,
          romanceNote:
            typeof bond.romance_note === 'string' ? bond.romance_note : undefined,
          yourDelta: typeof bond.your_change === 'number' ? bond.your_change : undefined,
          yourNote: typeof bond.your_note === 'string' ? bond.your_note : undefined,
        };
      })
      .filter((item) => item.character.trim().length > 0);
  }

  if (Array.isArray(block.facts)) {
    diff.facts = block.facts
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const fact = item as {
          entity?: unknown;
          fact?: unknown;
          type?: unknown;
          who_knows?: unknown;
          supersedes?: unknown;
          claimed_by?: unknown;
          lasts?: unknown;
          days?: unknown;
        };
        const whoKnows = stringItems(fact.who_knows);
        const supersedes = stringItems(fact.supersedes);
        const lasts: 'lasting' | 'until_rest' | 'days' | undefined =
          fact.lasts === 'lasting' || fact.lasts === 'until_rest' || fact.lasts === 'days' ? fact.lasts : undefined;
        const claimedBy = cleanString(fact.claimed_by);

        return {
          action: 'add' as const,
          type: asFactType(fact.type),
          text: typeof fact.fact === 'string' ? fact.fact : '',
          subject: cleanString(fact.entity),
          ...(whoKnows.length > 0 ? { whoKnows } : {}),
          ...(supersedes.length > 0 ? { supersedes } : {}),
          ...(claimedBy && notPlayer(claimedBy) ? { claimedBy } : {}),
          ...(lasts ? { lasts } : {}),
          ...(typeof fact.days === 'number' && Number.isFinite(fact.days) && fact.days > 0 ? { days: fact.days } : {}),
        };
      })
      .filter((item) => item.text.trim().length > 0);
  }

  const factsEnded = stringItems(block.facts_ended);

  if (factsEnded.length > 0) {
    diff.factsEnded = factsEnded;
  }

  if (Array.isArray(block.threads)) {
    diff.threads = block.threads
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const thread = item as { title?: unknown; description?: unknown; status?: unknown; participants?: unknown };
        const participants = stringItems(thread.participants).filter(notPlayer);
        const action: 'open' | 'update' | 'resolve' =
          thread.status === 'resolved' || thread.status === 'resolve'
            ? 'resolve'
            : thread.status === 'open'
              ? 'open'
              : 'update';
        const description = cleanString(thread.description);
        const title = cleanString(thread.title) ?? description ?? '';

        return {
          action,
          title: title.slice(0, 80),
          description,
          type: 'other' as const,
          ...(participants.length > 0 ? { participants } : {}),
        };
      })
      .filter((item) => item.title.length > 0);
  }

  if (Array.isArray(block.new_characters)) {
    diff.entities = block.new_characters
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      // A known person flagged is_new: false is never re-added. (Older
      // replies without the flag are still read as new.)
      .filter((item) => item.is_new !== false)
      .map((item) => {
        const character = item as {
          name?: unknown;
          age?: unknown;
          role?: unknown;
          personality?: unknown;
          speech_style?: unknown;
          appearance?: unknown;
          appearance_block?: unknown;
          gender?: unknown;
          attracted_to?: unknown;
        };
        const gender: 'male' | 'female' | undefined =
          character.gender === 'male' || character.gender === 'female' ? character.gender : undefined;
        const attractedTo: 'men' | 'women' | 'both' | 'none' | undefined =
          character.attracted_to === 'men' ||
          character.attracted_to === 'women' ||
          character.attracted_to === 'both' ||
          character.attracted_to === 'none'
            ? character.attracted_to
            : undefined;

        return {
          isNew: true,
          name: typeof character.name === 'string' ? character.name : '',
          age: typeof character.age === 'number' ? character.age : undefined,
          role: typeof character.role === 'string' ? character.role : undefined,
          personality:
            typeof character.personality === 'string' ? character.personality : undefined,
          speechStyle:
            typeof character.speech_style === 'string' ? character.speech_style : undefined,
          appearance:
            typeof character.appearance === 'string'
              ? character.appearance
              : typeof character.appearance_block === 'string'
                ? character.appearance_block
                : undefined,
          ...(gender ? { gender } : {}),
          ...(attractedTo ? { attractedTo } : {}),
          ...((item as { minor?: unknown }).minor === true ? { minor: true } : {}),
          ...((item as { name_known?: unknown }).name_known === false ? { nameKnown: false, label: typeof character.name === 'string' ? character.name : undefined } : {}),
        };
      })
      .filter((item) => item.name.trim().length > 0);
  }

  if (Array.isArray(block.deaths)) {
    const deaths = block.deaths
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: cleanString(item.character_id) ?? cleanString(item.name) ?? '',
        cause: cleanString(item.cause),
      }))
      .filter((item) => item.name.length > 0 && notPlayer(item.name));

    if (deaths.length > 0) {
      diff.deaths = deaths;
    }
  }

  const revived = stringItems(block.revived).map((name) => ({ name }));

  if (revived.length > 0) {
    diff.revived = revived;
  }

  const companionsJoined = companionRefs(block.companions_joined, notPlayer);
  const companionsLeft = companionRefs(block.companions_left, notPlayer);

  if (companionsJoined.length > 0) {
    diff.companionsJoined = companionsJoined;
  }

  if (companionsLeft.length > 0) {
    diff.companionsLeft = companionsLeft;
  }

  if (Array.isArray(block.character_updates)) {
    const updates = block.character_updates
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: cleanString(item.character_id) ?? cleanString(item.name) ?? '',
        mood: cleanString(item.mood),
        appearance: cleanString(item.appearance),
        lastingAppearance: cleanString(item.lasting_appearance),
        whereabouts: cleanString(item.whereabouts),
      }))
      .filter((item) => item.name.length > 0 && (item.mood || item.appearance || item.lastingAppearance || item.whereabouts));

    if (updates.length > 0) {
      diff.entities = [...(diff.entities ?? []), ...updates];
    }
  }

  if (imageWorthy) {
    diff.imageWorthy = true;
  }

  const hasChanges =
    Object.keys(diff).length > 0 &&
    (Object.values(diff).some(
      (value) => Array.isArray(value) ? value.length > 0 : Boolean(value)
    ) ||
      // An intimate scene ending is a change on its own.
      diff.intimateScene === false);

  return { diff: hasChanges ? diff : null, imageWorthy };
}

function companionRefs(value: unknown, notPlayer: (name: string) => boolean): { name: string; reason?: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      typeof item === 'string'
        ? { name: item.trim() }
        : item && typeof item === 'object'
          ? {
              name: cleanString((item as Record<string, unknown>).character_id) ?? cleanString((item as Record<string, unknown>).name) ?? '',
              reason: cleanString((item as Record<string, unknown>).reason),
            }
          : { name: '' }
    )
    .filter((item) => item.name.length > 0 && notPlayer(item.name))
    .map((item) => (item.reason ? item : { name: item.name }));
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringItems(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    : [];
}

function asLocationKind(value: unknown): LocationKind | undefined {
  return value === 'settlement' || value === 'road' || value === 'wilderness' || value === 'structure'
    ? value
    : undefined;
}

const FACT_TYPE_VALUES: FactType[] = [
  'death', 'injury', 'condition', 'secret', 'knowledge', 'membership', 'possession',
  'relationship', 'plan', 'figure', 'event', 'other',
];

function asFactType(value: unknown): FactType {
  return typeof value === 'string' && (FACT_TYPE_VALUES as string[]).includes(value)
    ? (value as FactType)
    : 'event';
}

export function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();

  if (!trimmed || trimmed === '{}') {
    return {};
  }

  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  const candidates = [withoutFence];

  const firstBrace = withoutFence.indexOf('{');
  const lastBrace = withoutFence.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(withoutFence.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

/**
 * Salvages a JSON object that was cut off part-way (the reply hit its token
 * cap). Walks back from the end to the last point where a value was complete,
 * drops the half-written tail and closes every open array and object.
 * Returns null if nothing usable is left.
 */
export function repairTruncatedJson(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = trimmed.indexOf('{');

  if (start === -1) {
    return null;
  }

  const body = trimmed.slice(start);
  // Cut points, newest last: [index to cut at, closers needed there].
  const cuts: Array<[number, string]> = [];
  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  const closers = () => stack.slice().reverse().join('');

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{' || char === '[') {
      stack.push(char === '{' ? '}' : ']');
      cuts.push([index + 1, closers()]);
    } else if (char === '}' || char === ']') {
      stack.pop();
      cuts.push([index + 1, closers()]);

      if (stack.length === 0) {
        break;
      }
    } else if (char === ',') {
      // Everything before the comma is a finished value.
      cuts.push([index, closers()]);
    }
  }

  for (let position = cuts.length - 1, tries = 0; position >= 0 && tries < 400; position -= 1, tries += 1) {
    const [cut, close] = cuts[position];

    try {
      const parsed = JSON.parse(body.slice(0, cut) + close);

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try an earlier cut.
    }
  }

  return null;
}

/** The tracker's money changes: a signed amount and a reason each, zeros dropped. */
function convertMoney(value: unknown): { amount: number; reason: string }[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;

      const entry = item as Record<string, unknown>;
      const amount = readAmount(entry.amount);

      if (amount === null || amount === 0) return null;

      return { amount, reason: (cleanString(entry.reason) ?? '').slice(0, 80) };
    })
    .filter((item): item is { amount: number; reason: string } => Boolean(item))
    .slice(0, 6);
}

/** The tracker's home report, or null when it says nothing. */
function convertHome(value: unknown): TurnDiff['home'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const item = value as Record<string, unknown>;
  const livesAt = cleanString(item.lives_at)?.slice(0, 120);
  // "" (or "home") means back home: the tracker clears where the player was staying.
  const staying = typeof item.staying_at === 'string' ? item.staying_at.trim().slice(0, 120) : null;
  const movedIn = stringItems(item.moved_in).slice(0, 4);
  const movedOut = stringItems(item.moved_out).slice(0, 4);
  const stayingAt = staying === null ? undefined : /^(home|null)$/i.test(staying) ? '' : staying;

  if (!livesAt && stayingAt === undefined && movedIn.length === 0 && movedOut.length === 0) return null;

  return { ...(livesAt ? { livesAt } : {}), ...(stayingAt !== undefined ? { stayingAt } : {}), movedIn, movedOut };
}
