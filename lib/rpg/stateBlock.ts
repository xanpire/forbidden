// Reading the state model's reply: JSON parsing and snake_case → TurnDiff.

import type { FactType, LocationKind, ReputationFaction, TurnDiff, VillageFaction } from './types';

/**
 * Turns the state model's snake_case JSON (see stateSchema.ts) into a
 * `TurnDiff`. Lenient: nulls, empty lists and unknown values are ignored, and
 * the older nested `state: { location, ... }` shape is still accepted.
 */
export function convertStateBlock(
  block: Record<string, unknown> | null
): { diff: TurnDiff | null; imageWorthy: boolean } {
  if (!block || typeof block !== 'object') {
    return { diff: null, imageWorthy: false };
  }

  if (Object.keys(block).length === 0) {
    return { diff: null, imageWorthy: false };
  }

  const imageWorthy = block.image_worthy === true;
  const sceneEnded = block.scene_ended === true;
  const diff: TurnDiff = {};

  if (Array.isArray(block.canon_completed)) {
    diff.canonCompleted = block.canon_completed.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
  }

  if (Array.isArray(block.canon_engaged)) {
    diff.canonEngaged = block.canon_engaged.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
  }

  if (Array.isArray(block.canon_passed)) {
    diff.canonPassed = block.canon_passed.filter(
      (id): id is string => typeof id === 'string' && id.trim().length > 0
    );
  }

  if (Array.isArray(block.news_relayed)) {
    diff.newsRelayed = block.news_relayed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : '',
        from: typeof item.from === 'string' ? item.from : undefined,
      }))
      .filter((item) => item.id.trim().length > 0);
  }

  if (Array.isArray(block.letters_sent)) {
    const sent = block.letters_sent
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: typeof item.to === 'string' ? item.to.trim() : '',
        gist: typeof item.gist === 'string' && item.gist.trim() ? item.gist.trim().slice(0, 160) : undefined,
      }))
      .filter((item) => item.name.length > 0)
      .slice(0, 3);

    if (sent.length > 0) {
      diff.lettersSent = sent;
    }
  }

  if (Array.isArray(block.letters_received)) {
    const received = block.letters_received
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .slice(0, 3)
      .map((name) => ({ name: name.trim() }));

    if (received.length > 0) {
      diff.lettersReceived = received;
    }
  }

  if (Array.isArray(block.reputation)) {
    const factions = new Set(['leaf', 'sand', 'mist', 'cloud', 'stone', 'akatsuki']);
    const changes = block.reputation
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        faction: (typeof item.faction === 'string' ? item.faction.trim().toLowerCase() : '') as ReputationFaction,
        change: typeof item.change === 'number' && Number.isFinite(item.change) ? item.change : 0,
        reason: cleanString(item.reason)?.slice(0, 160),
      }))
      .filter((item) => factions.has(item.faction) && item.change !== 0)
      .slice(0, 6);

    if (changes.length > 0) {
      diff.reputation = changes;
    }
  }

  const seen = stringItems(block.bounty_seen)
    .map((item) => item.toLowerCase())
    .filter((item): item is VillageFaction => ['leaf', 'sand', 'mist', 'cloud', 'stone'].includes(item));

  if (seen.length > 0) {
    diff.bountySeen = [...new Set(seen)];
  }

  if (Array.isArray(block.grudges)) {
    const events = new Set(['wronged', 'struck', 'settled', 'forgiven']);
    const grudges = block.grudges
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        name: cleanString(item.character_id) ?? cleanString(item.name) ?? '',
        event: (typeof item.event === 'string' ? item.event.trim().toLowerCase() : '') as 'wronged' | 'struck' | 'settled' | 'forgiven',
        reason: cleanString(item.reason)?.slice(0, 160),
      }))
      .filter((item) => item.name.length > 0 && item.name.toLowerCase() !== 'kan' && events.has(item.event))
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
    block.scene_pace === 'combat' ||
    block.scene_pace === 'chase' ||
    block.scene_pace === 'conversation' ||
    block.scene_pace === 'travel' ||
    block.scene_pace === 'downtime'
  ) {
    diff.state = { ...diff.state, scenePace: block.scene_pace };
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
        .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
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

  const flatLocation = cleanString(block.location);
  const flatLocationKind = asLocationKind(block.location_kind);
  const flatCanonPoint = cleanString(block.canon_point);
  const inventoryAdded = stringItems(block.inventory_added);
  const inventoryRemoved = stringItems(block.inventory_removed);

  if (flatLocation || flatLocationKind || flatCanonPoint || inventoryAdded.length || inventoryRemoved.length) {
    diff.state = {
      ...diff.state,
      ...(flatLocation ? { location: flatLocation } : {}),
      ...(flatLocationKind ? { locationKind: flatLocationKind } : {}),
      ...(flatCanonPoint ? { canonPoint: flatCanonPoint } : {}),
      ...(inventoryAdded.length ? { inventoryAdded } : {}),
      ...(inventoryRemoved.length ? { inventoryRemoved } : {}),
    };
  }

  const state = block.state;

  if (state && typeof state === 'object' && !Array.isArray(state)) {
    const rawState = state as {
      location?: unknown;
      canon_point?: unknown;
      inventory_and_jutsu_changes?: unknown;
      location_kind?: unknown;
    };

    const inventoryChanges =
      Array.isArray(rawState.inventory_and_jutsu_changes) &&
      rawState.inventory_and_jutsu_changes.length > 0
        ? rawState.inventory_and_jutsu_changes.filter(
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
      canonPoint:
        typeof rawState.canon_point === 'string' && rawState.canon_point.trim()
          ? rawState.canon_point.trim()
          : undefined,
      inventoryAdded: inventoryChanges,
    };
  }

  if (Array.isArray(block.jutsu_used)) {
    diff.jutsuUsed = block.jutsu_used
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const jutsu = item as {
          name?: unknown;
          user?: unknown;
          chakra_nature?: unknown;
          chakraNature?: unknown;
          effect?: unknown;
          visual?: unknown;
        };

        return {
          name: typeof jutsu.name === 'string' ? jutsu.name : '',
          user: typeof jutsu.user === 'string' && jutsu.user.trim() ? jutsu.user.trim() : 'Kan',
          chakraNature:
            typeof jutsu.chakra_nature === 'string'
              ? jutsu.chakra_nature
              : typeof jutsu.chakraNature === 'string'
                ? jutsu.chakraNature
                : undefined,
          effect: typeof jutsu.effect === 'string' ? jutsu.effect : undefined,
          visual: typeof jutsu.visual === 'string' ? jutsu.visual : undefined,
        };
      })
      .filter((item) => item.name.trim().length > 0);
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
        };
      })
      .filter((item) => item.character.trim().length > 0);
  }

  if (Array.isArray(block.facts)) {
    diff.facts = block.facts
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const fact = item as { entity?: unknown; fact?: unknown; type?: unknown; who_knows?: unknown };
        const whoKnows = stringItems(fact.who_knows);

        return {
          action: 'add' as const,
          type: asFactType(fact.type),
          text: typeof fact.fact === 'string' ? fact.fact : '',
          subject: cleanString(fact.entity),
          ...(whoKnows.length > 0 ? { whoKnows } : {}),
        };
      })
      .filter((item) => item.text.trim().length > 0);
  }

  if (Array.isArray(block.threads)) {
    diff.threads = block.threads
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => {
        const thread = item as { title?: unknown; description?: unknown; status?: unknown };
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
        };

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
      .filter((item) => item.name.length > 0 && item.name.toLowerCase() !== 'kan');

    if (deaths.length > 0) {
      diff.deaths = deaths;
    }
  }

  const revived = stringItems(block.revived).map((name) => ({ name }));

  if (revived.length > 0) {
    diff.revived = revived;
  }

  const companionsJoined = companionRefs(block.companions_joined);
  const companionsLeft = companionRefs(block.companions_left);

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
      }))
      .filter((item) => item.name.length > 0 && (item.mood || item.appearance));

    if (updates.length > 0) {
      diff.entities = [...(diff.entities ?? []), ...updates];
    }
  }

  if (imageWorthy) {
    diff.imageWorthy = true;
  }

  const hasChanges =
    Object.keys(diff).length > 0 &&
    Object.values(diff).some(
      (value) => Array.isArray(value) ? value.length > 0 : Boolean(value)
    );

  return { diff: hasChanges ? diff : null, imageWorthy };
}

function companionRefs(value: unknown): { name: string; reason?: string }[] {
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
    .filter((item) => item.name.length > 0 && item.name.toLowerCase() !== 'kan')
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
  'death', 'injury', 'secret', 'knowledge', 'membership', 'possession', 'event', 'other',
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
