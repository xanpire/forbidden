// Personal letters: the people Kan is close to write to him, and he can write
// back. Separate from canon news (newsDelivery.ts): these are their own
// words, about their own lives and how they feel about him.
//
// - Incoming, unprompted: now and then someone Kan is close to who is far
//   away (not travelling with him, not in the scene, not seen for a while)
//   sends a letter, a crow, or a coded note. At most one in a few weeks of
//   story time, and each person at most every month and a half.
// - Outgoing: when the story shows Kan send a letter (the state tracker's
//   letters_sent), it travels for some days. When it arrives the bond moves,
//   the recipient remembers it, and they write back: the reply sets out and
//   reaches Kan some days later.
// - Delivery is always on the page: the narrator is offered the letter
//   (A LETTER FOR YOU) and the state tracker marks it received
//   (letters_received). Nothing ever arrives as an app notification.
//
// Everything is deterministic per save and turn, so a regenerate gets the
// same offer.

import { applyBondDiff } from './bonds';
import { daysBetween, dateSortValue, shiftDate } from './calendar';
import { isCombatPace } from './canon';
import { castWithCompanions } from './companions';
import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { applyFactDiff } from './facts';
import { makeId } from './id';
import { clamp, hashText } from './util';
import type { AppDatabase, BondRecord, CalendarDate, EntityRecord, Letter, PostState, TurnDiff } from './types';

/** A letter is on the road this many days, depending on distance and luck. */
export const LETTER_MIN_DAYS = 3;
export const LETTER_MAX_DAYS = 9;

/** No unprompted letter until this many days after the last one reached Kan. */
export const LETTER_GAP_DAYS = 21;

/** The same person writes unprompted at most this often. */
export const LETTER_PER_PERSON_DAYS = 45;

/** They must not have seen Kan for this long to write unprompted. */
export const LETTER_MIN_DAYS_APART = 10;

/** Affinity at which someone cares enough to write unprompted. */
export const LETTER_MIN_AFFINITY = 5;

/** Kan's letter arriving lifts the bond this much (half for someone cold toward him). */
export const LETTER_BOND_GAIN = 2;

/** Below this they read it but do not answer. */
export const LETTER_REPLY_FLOOR = -3;

const CLOSE_STAGES = new Set(['close', 'romantic interest', 'partner']);

/** Turns a letter, once offered, may wait before the offer is pressed. */
const LETTER_LINGER_DAYS = 5;

export function postOf(db: AppDatabase): PostState {
  return db.state.post ?? { letters: [] };
}

function withPost(db: AppDatabase, post: PostState): AppDatabase {
  return { ...db, state: { ...db.state, post } };
}

export function normalizePost(raw: unknown): PostState | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const value = raw as Partial<PostState>;
  const letters = Array.isArray(value.letters)
    ? value.letters.filter(
        (letter): letter is Letter =>
          Boolean(letter) &&
          typeof letter.id === 'string' &&
          (letter.direction === 'to-kan' || letter.direction === 'from-kan') &&
          typeof letter.entityId === 'string' &&
          Boolean(letter.sentOn) &&
          Boolean(letter.arrivesOn)
      )
    : [];

  // Keep the post small: everything still travelling, plus the last 40 done.
  const travelling = letters.filter((letter) => letter.status === 'travelling');
  const done = letters.filter((letter) => letter.status !== 'travelling').slice(-40);

  return {
    letters: [...done, ...travelling],
    ...(value.lastLetterIn ? { lastLetterIn: value.lastLetterIn } : {}),
  };
}

/** Days on the road for one letter, fixed by its id. */
export function travelDays(seed: string) {
  return LETTER_MIN_DAYS + (hashText(seed) % (LETTER_MAX_DAYS - LETTER_MIN_DAYS + 1));
}

function isKan(entity: EntityRecord) {
  return entity.name.trim().toLowerCase() === 'kan' || entity.tags.includes('player');
}

function bondOf(db: AppDatabase, entityId: string): BondRecord | null {
  return db.bonds.find((bond) => bond.entityId === entityId) ?? null;
}

function inScene(db: AppDatabase): Set<string> {
  const ids = new Set<string>();

  for (const name of castWithCompanions(db, db.state.sceneCast ?? [])) {
    const entity = resolveEntity(db, name);

    if (entity) ids.add(entity.id);
  }

  return ids;
}

// ---------------------------------------------------------------------------
// How a letter finds a missing-nin

const CARRIERS_BY_NAME: Array<[RegExp, string]> = [
  [/^itachi\b/i, 'one of his crows'],
  [/^hana\b/i, 'one of her ninken tracking your scent, or a Leaf hawk she sent off the books'],
  [/^suzume\b/i, 'a coded note in the old Team 3 cipher, passed through a courier'],
  [/^konan\b/i, 'a paper butterfly that unfolds into the message'],
  [/^kisame\b/i, 'a scroll left at an Akatsuki dead drop'],
  [/^jiraiya\b/i, 'one of his toads, or a note tucked inside a cheap novel'],
  [/^kakashi\b/i, 'one of his ninken'],
];

const CARRIERS_BY_TAG: Array<[string, string]> = [
  ['akatsuki', 'a coded message through an Akatsuki dead drop'],
  ['leaf', 'a Leaf messenger hawk sent off the books'],
];

const GENERIC_CARRIERS = [
  'a letter passed along by a courier who owes them a favor',
  'a carrier bird that knows your chakra',
  'a coded note slipped to you by a merchant',
  'a letter left at a dead drop you both know',
];

export function letterCarrier(entity: EntityRecord): string {
  for (const [pattern, carrier] of CARRIERS_BY_NAME) {
    if (pattern.test(entity.name)) return carrier;
  }

  for (const [tag, carrier] of CARRIERS_BY_TAG) {
    if (entity.tags.includes(tag)) return carrier;
  }

  return GENERIC_CARRIERS[hashText(entity.id) % GENERIC_CARRIERS.length];
}

// ---------------------------------------------------------------------------
// Who writes to Kan

export type LetterOffer = {
  kind: 'reply' | 'unprompted';
  entity: EntityRecord;
  bond: BondRecord | null;
  carrier: string;
  /** The waiting reply, when kind is reply. */
  letter?: Letter;
  /** Kan's letter it answers. */
  answering?: Letter;
  daysWaiting: number;
};

function lastLetterFrom(db: AppDatabase, entityId: string): CalendarDate | null {
  const dates = postOf(db)
    .letters.filter((letter) => letter.direction === 'to-kan' && letter.entityId === entityId && letter.status === 'delivered')
    .map((letter) => letter.deliveredOn ?? letter.arrivesOn);

  return dates.sort((a, b) => dateSortValue(b) - dateSortValue(a))[0] ?? null;
}

function storyStart(db: AppDatabase): CalendarDate {
  return db.state.canonProgress?.baselineDate ?? db.rawLog[0]?.inStoryDate ?? db.state.inStoryDate;
}

/** People close enough to Kan to write unprompted right now, warmest first. */
export function correspondents(db: AppDatabase): EntityRecord[] {
  const now = db.state.inStoryDate;
  const here = inScene(db);
  const pending = new Set(
    postOf(db)
      .letters.filter((letter) => letter.status === 'travelling')
      .map((letter) => letter.entityId)
  );

  return db.entities
    .filter((entity) => {
      if (entity.type !== 'character' || isKan(entity) || isDeceased(entity) || entity.met === false) return false;
      if (entity.companion || here.has(entity.id) || pending.has(entity.id)) return false;

      const bond = bondOf(db, entity.id);

      if (!bond) return false;
      if (bond.relationship === 'rejected' && bond.affinity < LETTER_MIN_AFFINITY) return false;
      if (bond.affinity < LETTER_MIN_AFFINITY && !CLOSE_STAGES.has(bond.relationship ?? '')) return false;

      const apart = entity.lastSeen ? daysBetween(entity.lastSeen, now) : daysBetween(storyStart(db), now);

      if (apart < LETTER_MIN_DAYS_APART) return false;

      const last = lastLetterFrom(db, entity.id);

      return !last || daysBetween(last, now) >= LETTER_PER_PERSON_DAYS;
    })
    .sort((a, b) => {
      const score = (entity: EntityRecord) => {
        const bond = bondOf(db, entity.id)!;
        const romance = bond.relationship === 'partner' ? 3 : bond.relationship === 'romantic interest' ? 2 : 0;

        return bond.affinity + romance;
      };

      return score(b) - score(a) || hashText(`${db.meta.slotId}:${a.id}`) - hashText(`${db.meta.slotId}:${b.id}`);
    });
}

/**
 * The letter that may reach Kan this turn: a reply that has arrived first,
 * otherwise (if it has been long enough) an unprompted one. Null mid-fight.
 */
export function letterOffer(db: AppDatabase): LetterOffer | null {
  if (isCombatPace(db.state.scenePace)) {
    return null;
  }

  const now = db.state.inStoryDate;
  const post = postOf(db);
  const here = inScene(db);

  // Replies that have arrived, oldest first. A writer who is here in person
  // just says it; the letter waits until they are apart again.
  const arrived = post.letters
    .filter(
      (letter) =>
        letter.direction === 'to-kan' &&
        letter.status === 'travelling' &&
        dateSortValue(letter.arrivesOn) <= dateSortValue(now) &&
        !here.has(letter.entityId)
    )
    .sort((a, b) => dateSortValue(a.arrivesOn) - dateSortValue(b.arrivesOn));

  for (const letter of arrived) {
    const entity = db.entities.find((item) => item.id === letter.entityId);

    if (!entity) continue;

    return {
      kind: 'reply',
      entity,
      bond: bondOf(db, entity.id),
      carrier: letterCarrier(entity),
      letter,
      answering: post.letters.find((item) => item.id === letter.replyTo),
      daysWaiting: Math.max(0, daysBetween(letter.arrivesOn, now)),
    };
  }

  const since = post.lastLetterIn ?? storyStart(db);

  if (daysBetween(since, now) < LETTER_GAP_DAYS) {
    return null;
  }

  const [entity] = correspondents(db);

  if (!entity) {
    return null;
  }

  return {
    kind: 'unprompted',
    entity,
    bond: bondOf(db, entity.id),
    carrier: letterCarrier(entity),
    daysWaiting: Math.max(0, daysBetween(since, now) - LETTER_GAP_DAYS),
  };
}

export function formatLetterOffer(offer: LetterOffer | null): string {
  if (!offer) {
    return '';
  }

  const { entity, bond } = offer;
  const feeling = bond
    ? `${bond.status || 'they know you'}${bond.relationship && bond.relationship !== 'stranger' ? `; ${bond.relationship}` : ''}`
    : 'they know you';
  const answering =
    offer.kind === 'reply'
      ? `, answering the letter you sent${offer.answering?.gist ? ` (${offer.answering.gist})` : ''}`
      : '';
  const press =
    offer.daysWaiting >= LETTER_LINGER_DAYS
      ? ' It has been waiting: bring it in this turn unless the scene truly cannot hold it.'
      : ' If the scene cannot hold it right now, leave it for a later turn.';

  return [
    `A LETTER FOR YOU (personal, from someone far away; never mid-fight). ${entity.name} has written to you${answering}.`,
    `It reaches you by ${offer.carrier}. You are a missing-nin with no address, so show how it found you; if nothing could have found you here, leave it for later.`,
    `Write the letter in their own voice: short, in character, about their own life and what they could know, shaped by how they feel about you (${feeling}). No canon news Kan has not heard.${press}`,
  ].join(' ');
}

export function letterTrackingLines(offer: LetterOffer | null, idOf: (entity: EntityRecord) => string): string[] {
  const lines = [
    '- letters_sent: {to: id, gist} only when Kan actually writes and sends (or hands off) a letter or message to someone NOT in the scene this turn; gist = what it says, in a few words.',
  ];

  if (offer) {
    lines.push(
      `- letter from ${idOf(offer.entity)}: letters_received ["${idOf(offer.entity)}"] only if their letter actually reached Kan on the page this turn.`
    );
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Applying a turn

/** Kan sends letters: each sets out and arrives some days later. */
export function sendLetters(db: AppDatabase, sent: TurnDiff['lettersSent']): AppDatabase {
  if (!sent || sent.length === 0) {
    return db;
  }

  const now = db.state.inStoryDate;
  const post = postOf(db);
  const here = inScene(db);
  const letters = [...post.letters];

  for (const item of sent) {
    const entity = item.entityId ? db.entities.find((person) => person.id === item.entityId) : resolveEntity(db, item.name);

    // A note handed across the fire is not a letter.
    if (!entity || isKan(entity) || here.has(entity.id)) continue;

    const id = makeId('letter');

    letters.push({
      id,
      direction: 'from-kan',
      entityId: entity.id,
      name: entity.name,
      sentOn: now,
      arrivesOn: shiftDate(now, travelDays(`${db.meta.slotId}:${id}`)),
      gist: item.gist,
      status: 'travelling',
    });
  }

  return withPost(db, { ...post, letters });
}

/** Letters whose reader read them on the page this turn. */
export function receiveLetters(db: AppDatabase, received: TurnDiff['lettersReceived']): AppDatabase {
  if (!received || received.length === 0) {
    return db;
  }

  const now = db.state.inStoryDate;
  const post = postOf(db);
  let letters = [...post.letters];
  let any = false;

  for (const item of received) {
    const entityId = item.entityId ?? resolveEntity(db, item.name)?.id;

    if (!entityId) continue;

    const waiting = letters.find(
      (letter) =>
        letter.direction === 'to-kan' &&
        letter.entityId === entityId &&
        letter.status === 'travelling' &&
        dateSortValue(letter.arrivesOn) <= dateSortValue(now)
    );

    if (waiting) {
      letters = letters.map((letter) =>
        letter.id === waiting.id ? { ...letter, status: 'delivered', deliveredOn: now } : letter
      );
    } else {
      // Unprompted (or the narrator brought one we did not plan): record it.
      const entity = db.entities.find((person) => person.id === entityId);

      if (!entity) continue;

      letters.push({
        id: makeId('letter'),
        direction: 'to-kan',
        entityId,
        name: entity.name,
        sentOn: shiftDate(now, -travelDays(`${db.meta.slotId}:${entityId}:${now.year}-${now.month}`)),
        arrivesOn: now,
        status: 'delivered',
        deliveredOn: now,
      });
    }

    any = true;
  }

  return any ? withPost(db, { ...post, letters, lastLetterIn: now }) : db;
}

/**
 * Kan's letters that reached their reader by now: the bond moves, they
 * remember it, and (unless they are cold toward him) a reply sets out.
 */
export function deliverLetters(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  const post = postOf(db);
  const due = post.letters.filter(
    (letter) =>
      letter.direction === 'from-kan' &&
      letter.status === 'travelling' &&
      dateSortValue(letter.arrivesOn) <= dateSortValue(now)
  );

  if (due.length === 0) {
    return db;
  }

  let next = db;
  let letters = [...post.letters];

  for (const letter of due) {
    const entity = next.entities.find((person) => person.id === letter.entityId);

    if (!entity || isDeceased(entity)) {
      letters = letters.map((item) => (item.id === letter.id ? { ...item, status: 'lost' } : item));
      continue;
    }

    letters = letters.map((item) =>
      item.id === letter.id ? { ...item, status: 'delivered', deliveredOn: letter.arrivesOn } : item
    );

    const bond = bondOf(next, entity.id);
    const affinity = bond?.affinity ?? 0;
    const gain = affinity < -2 ? Math.ceil(LETTER_BOND_GAIN / 2) : LETTER_BOND_GAIN;

    next = applyBondDiff(next, {
      entityId: entity.id,
      character: entity.name,
      affinityDelta: clamp(gain, 0, 10),
    });
    next = applyFactDiff(next, {
      action: 'add',
      type: 'event',
      text: `${entity.name} received a letter from Kan${letter.gist ? `: ${letter.gist}` : ''}.`,
      subject: entity.name,
      whoKnows: [entity.name],
      validFrom: letter.arrivesOn,
    });

    if (affinity + gain >= LETTER_REPLY_FLOOR) {
      const id = makeId('letter');

      letters.push({
        id,
        direction: 'to-kan',
        entityId: entity.id,
        name: entity.name,
        sentOn: letter.arrivesOn,
        arrivesOn: shiftDate(letter.arrivesOn, travelDays(`${db.meta.slotId}:${id}`)),
        status: 'travelling',
        replyTo: letter.id,
      });
    }
  }

  return withPost(next, { ...postOf(next), letters });
}

/** Letters on the road right now, soonest first (for the world clock screen). */
export function lettersInTransit(db: AppDatabase): Letter[] {
  return postOf(db)
    .letters.filter((letter) => letter.status === 'travelling')
    .sort((a, b) => dateSortValue(a.arrivesOn) - dateSortValue(b.arrivesOn));
}
