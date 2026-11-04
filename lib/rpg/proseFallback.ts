// What a turn can still record when the state model's reply was unreadable.
// The clock and pace are read from the prose elsewhere (timeparse, pacing);
// this adds who was there and which jutsu Kan used, so a failed state call
// doesn't leave presence and the jutsu list blank for that turn.

import { mentionsEntity, mentionsName } from './characterRefs';
import { isCompanion } from './companions';
import type { AppDatabase, TurnDiff } from './types';

/** Sentences that describe someone else, or talk about a jutsu, not Kan using it. */
const NOT_USING =
  /\b(watch|watches|watched|see|sees|saw|seen|ask|asks|asked|about|remember|remembers|recall|tell|tells|told|explain|explains|how|teach|teaches|taught|learn|learns|study|studies|think|thinks)\b/i;

/** Lead words that are part of the sentence, not the jutsu's name. */
const LEAD_WORDS = new Set(['i', 'the', 'my', 'a', 'an', 'then', 'and', 'with', 'kan', 'so', 'now']);

const STYLE_PATTERN =
  /((?:[A-Z][\p{L}'-]*\s+){0,2}(?:Style|Release)\s*:\s*(?:[A-Z][\p{L}'-]*\s*){1,6})/gu;
const JUTSU_PATTERN = /((?:[A-Z][\p{L}'-]*\s+){1,5}(?:no\s+)?(?:Jutsu|Technique))\b/gu;

function sentences(text: string) {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanJutsuName(raw: string) {
  const words = raw.trim().replace(/[\s,;:.!?]+$/, '').split(/\s+/);

  while (words.length > 1 && LEAD_WORDS.has(words[0].toLowerCase())) {
    words.shift();
  }

  const name = words.join(' ');
  // "Jutsu" or "Technique" on its own is not a name.
  return /^(no\s+)?(jutsu|technique)$/i.test(name) ? '' : name;
}

/** Known characters the narration shows in the scene. */
export function presentFromProse(db: AppDatabase, narration: string): string[] {
  if (!narration.trim()) {
    return [];
  }

  const parts = sentences(narration);
  const cast = new Set((db.state.sceneCast ?? []).map((name) => name.toLowerCase()));
  const present: string[] = [];

  for (const entity of db.entities) {
    if (
      entity.type !== 'character' ||
      entity.name === 'Kan' ||
      entity.deceased ||
      entity.status === 'Deceased'
    ) {
      continue;
    }

    const hits = parts.filter((part) => mentionsEntity(part, entity)).length;

    if (hits === 0) {
      continue;
    }

    // A single passing mention ("rumors of Orochimaru") isn't enough for
    // someone new; it is for someone already here or travelling with Kan.
    const alreadyHere =
      isCompanion(entity) ||
      cast.has(entity.name.toLowerCase()) ||
      entity.aliases.some((alias) => cast.has(alias.toLowerCase()));

    if (alreadyHere || hits >= 2) {
      present.push(entity.name);
    }
  }

  return present.slice(0, 8);
}

/** Jutsu Kan uses in the player's own message: ones he already knows, and named techniques. */
export function kanJutsuFromMessage(db: AppDatabase, userMessage: string): string[] {
  if (!userMessage.trim()) {
    return [];
  }

  const known = [
    ...db.jutsuRecords.filter((record) => record.user === 'Kan').map((record) => record.name),
    ...(db.state.jutsu ?? []),
  ];
  const found = new Map<string, string>();
  const add = (name: string) => {
    const key = name.toLowerCase();

    if (name && !found.has(key)) {
      found.set(key, name);
    }
  };

  for (const part of sentences(userMessage)) {
    if (NOT_USING.test(part)) {
      continue;
    }

    for (const name of known) {
      if (mentionsName(part, name)) {
        add(name);
      }
    }

    for (const pattern of [STYLE_PATTERN, JUTSU_PATTERN]) {
      for (const match of part.matchAll(pattern)) {
        const name = cleanJutsuName(match[1]);
        // Prefer the stored spelling when it's one Kan already has.
        const stored = known.find((item) => item.toLowerCase() === name.toLowerCase());
        add(stored ?? name);
      }
    }
  }

  // Drop a short match that is only part of a longer one ("Fireball Jutsu" in
  // "Fire Style: Fireball Jutsu").
  const names = [...found.values()];
  return names
    .filter(
      (name) =>
        !names.some(
          (other) => other !== name && other.toLowerCase().includes(name.toLowerCase())
        )
    )
    .slice(0, 4);
}

/** The diff a turn gets when the state model's reply couldn't be read. */
export function fallbackDiffFromProse(
  db: AppDatabase,
  turn: { userMessage: string; narration: string }
): TurnDiff | null {
  const present = presentFromProse(db, turn.narration);
  const jutsu = kanJutsuFromMessage(db, turn.userMessage);

  if (present.length === 0 && jutsu.length === 0) {
    return null;
  }

  const diff: TurnDiff = {};

  if (present.length > 0) {
    diff.scene = { ended: false, entities: present };
  }

  if (jutsu.length > 0) {
    diff.jutsuUsed = jutsu.map((name) => ({ name, user: 'Kan' }));
  }

  return diff;
}
