// News delivery: who brings the player the news, and how it reaches them.
//
// timeline.ts decides WHAT the player has not heard yet. This module decides how the
// next piece reaches them this turn:
//
// - Bearers: anyone in the scene who could plausibly know (a companion, a
//   contact, a local) is offered first, then the event's named bearers, with
//   the dead removed.
// - Delivery style: one way of hearing it that fits the place and the kind
//   of news (gossip at the next table, a notice, a call, a message from the
//   group itself...). The pick is
//   deterministic per turn, so a regenerate gets the same one, and it varies
//   from turn to turn.
// - Catch-up reports: when the player has heard nothing for a while (a time skip, a
//   long stretch away) and news has piled up, it can come as ONE report: a
//   stack of messages, a friend catching them up over a drink, covering
//   several events at once.

import {
  NEWS_PER_TURN,
  isCombatPace,
  lastNewsHeardDate,
  newsUrgency,
  unheardNews,
  type UnheardNews,
} from './timeline';
import { displayName, narratorName } from './names';
import { daysBetween } from './calendar';
import { castWithCompanions } from './companions';
import { isDeceased } from './deaths';
import { locationKindOf } from './encounters';
import { resolveEntity } from './entities';
import { isFreeCharacter } from './returning';
import { hashText, playerTurnCount, uniqueList } from './util';
import type { AppDatabase, EntityRecord, LocationKind } from './types';
import { isPlayerEntity } from './player';

/** The player has heard nothing for this many in-story days: piled-up news comes as one report. */
export const CATCH_UP_QUIET_DAYS = 14;

/** At most this many events in one catch-up report. */
export const CATCH_UP_MAX = 4;

export type NewsOffer = {
  mode: 'single' | 'catch-up';
  items: OfferedNews[];
  /** How it reaches the player this time. */
  style: string;
  /** catch-up: days since the player last heard any news. */
  quietDays: number;
};

export type OfferedNews = UnheardNews & {
  /** People in the scene who could know, best first, with a short label. */
  sceneBearers: string[];
  /** The named bearers, minus the dead and anyone already in the scene. */
  otherBearers: string[];
  urgency: 'fresh' | 'due' | 'overdue';
};

// ---------------------------------------------------------------------------
// Bearers

function sceneEntities(db: AppDatabase): EntityRecord[] {
  const names = castWithCompanions(db, db.state.sceneCast ?? []);
  const seen = new Set<string>();
  const people: EntityRecord[] = [];

  for (const name of names) {
    const entity = resolveEntity(db, name);

    if (!entity || seen.has(entity.id) || isPlayerEntity(entity) || isDeceased(entity)) {
      continue;
    }

    seen.add(entity.id);
    people.push(entity);
  }

  return people;
}

function profileText(entity: EntityRecord) {
  return `${entity.role ?? ''} ${entity.status ?? ''} ${entity.notes ?? ''} ${entity.tags.join(' ')}`.toLowerCase();
}

function sameEntity(db: AppDatabase, entity: EntityRecord, names: string[]) {
  return names.some((name) => resolveEntity(db, name)?.id === entity.id);
}

/** A member of this faction: tagged with its id, or its name in their role or notes. */
function inFaction(db: AppDatabase, entity: EntityRecord, factionId: string | undefined) {
  if (!factionId) return false;
  if (entity.tags.includes(factionId)) return true;

  const name = db.world?.factions?.find((faction) => faction.id === factionId)?.name?.toLowerCase();

  return Boolean(name && name.length >= 3 && profileText(entity).includes(name));
}

/** Could this person in the scene plausibly know about this event? */
export function couldKnow(db: AppDatabase, entity: EntityRecord, item: UnheardNews): boolean {
  const named = item.bearers;

  switch (item.knowledge) {
    case 'secret':
    case 'witnesses':
      return sameEntity(db, entity, named);
    case 'faction':
      return inFaction(db, entity, item.factionId) || sameEntity(db, entity, named);
    case 'public':
    default:
      // Public news is everywhere: anyone in the scene may have heard it.
      return true;
  }
}

function bearerLabel(db: AppDatabase, entity: EntityRecord) {
  const name = narratorName(db, entity);
  if (entity.companion) return `${name} (travelling with you)`;
  if (isFreeCharacter(db, entity)) return `${name} (here with you; someone you know)`;
  return `${name} (here with you)`;
}

/** Locals who carry public talk, by kind of place. */
const LOCAL_BEARERS: Partial<Record<LocationKind, string>> = {
  settlement: 'someone local here (a bartender, a regular, a shopkeeper)',
  road: 'a traveller passing on this road',
};

function sceneBearersFor(db: AppDatabase, item: UnheardNews, present: EntityRecord[]): string[] {
  const knowing = present
    .filter((entity) => couldKnow(db, entity, item))
    // Companions first: they are the ones the player talks to.
    .sort((a, b) => Number(Boolean(b.companion)) - Number(Boolean(a.companion)));
  const labels = knowing.map((entity) => bearerLabel(db, entity));
  const local = item.knowledge === 'public' ? LOCAL_BEARERS[locationKindOf(db)] : undefined;

  return local ? [...labels, local] : labels;
}

/** The event's named bearers, minus the dead and anyone already in the scene. */
export function livingBearers(db: AppDatabase, item: UnheardNews, present: EntityRecord[] = []): string[] {
  const presentIds = new Set(present.map((entity) => entity.id));

  return uniqueList(
    item.bearers.filter((name) => {
      const entity = resolveEntity(db, name);

      return !entity || (!isDeceased(entity) && !presentIds.has(entity.id));
    })
  );
}

// ---------------------------------------------------------------------------
// Delivery styles

const PLACE_STYLES: Record<LocationKind, string[]> = {
  settlement: [
    'gossip overheard at the next table',
    'a notice or headline someone points out',
    'the news on a screen or a radio in the background, or a paper left on a table',
    'someone complaining about what it has done to prices or plans',
    'a bartender or shopkeeper passing it on',
    'people on the street talking about nothing else',
  ],
  road: [
    'a traveller met on the way, still talking about it',
    'a driver or passenger who heard it before setting out',
    'a checkpoint or roadblock with new orders',
    'a stop on the way where everyone is talking about it',
  ],
  wilderness: [
    'someone who heard it in the last town',
    'a message that finally gets through',
    'a lone traveller crossing your path, talking more than they should',
  ],
  structure: [
    'a message waiting for you',
    'someone coming in with the news',
    'the news on a screen or a radio, or a paper left lying around',
  ],
};

const KNOWLEDGE_STYLES: Partial<Record<UnheardNews['knowledge'], string[]>> = {
  faction: ['a message from inside the group', 'someone from the group letting it slip'],
  secret: ['told privately, face to face, away from other ears'],
  witnesses: ['someone who was actually there, still shaken, telling it'],
};

const CATCH_UP_STYLES: Record<LocationKind, string[]> = {
  settlement: [
    'a pile of messages waiting for you',
    'a contact in town running through everything that changed',
    'an evening of catching up on the news you missed',
  ],
  road: ['a long talk at a stop with people who have heard it all', 'a driver who has been following every story'],
  wilderness: ['a whole bundle of messages arriving at once', 'the first signal or the first town in a long while'],
  structure: ['a pile of messages waiting for you', 'someone sitting you down to tell you everything you missed'],
};

function pick<T>(list: T[], seed: string): T {
  return list[hashText(seed) % list.length];
}

function turnSeed(db: AppDatabase) {
  return `${db.meta.slotId}:${playerTurnCount(db)}`;
}

function singleStyle(db: AppDatabase, item: OfferedNews, present: EntityRecord[]): string {
  const knowledgeStyles = KNOWLEDGE_STYLES[item.knowledge] ?? [];

  // Secret and witnessed news only travels face to face.
  if (item.knowledge === 'secret' || item.knowledge === 'witnesses') {
    return knowledgeStyles[0];
  }

  const pool = [...PLACE_STYLES[locationKindOf(db)], ...knowledgeStyles];
  const knowingCompanion = present.find((entity) => entity.companion && couldKnow(db, entity, item));

  if (knowingCompanion) {
    pool.push(`${displayName(db, knowingCompanion)} bringing it up in passing, from word they picked up`);
  }

  // Overdue news cannot wait for a chance meeting: it comes looking for the player.
  if (item.urgency === 'overdue') {
    return pick(
      [item.channel, 'a message that finds you wherever you are', 'someone who tracked you down to tell you'],
      `${turnSeed(db)}:${item.eventId}`
    );
  }

  return pick(pool, `${turnSeed(db)}:${item.eventId}`);
}

function catchUpStyle(db: AppDatabase, present: EntityRecord[]): string {
  const companion = present.find((entity) => entity.companion);
  const pool = [...CATCH_UP_STYLES[locationKindOf(db)]];

  if (companion) {
    pool.unshift(`${displayName(db, companion)} catching you up on everything they have heard`);
  }

  return pick(pool, `${turnSeed(db)}:catch-up`);
}

// ---------------------------------------------------------------------------
// The offer

function offered(db: AppDatabase, item: UnheardNews, present: EntityRecord[]): OfferedNews {
  return {
    ...item,
    sceneBearers: sceneBearersFor(db, item, present),
    // As the player knows them: a name they have not learned stays a label.
    otherBearers: livingBearers(db, item, present).map((name) => {
      const entity = db.entities.find((person) => person.type === 'character' && person.name === name);

      return entity ? narratorName(db, entity) : name;
    }),
    urgency: newsUrgency(item),
  };
}

/**
 * The news that may reach the player this turn, or null (nothing unheard, or a
 * fight). Pass `ignoreCombat` to size the allowance after a turn.
 */
export function newsOffer(db: AppDatabase, options: { ignoreCombat?: boolean } = {}): NewsOffer | null {
  if (!options.ignoreCombat && isCombatPace(db.state.scenePace)) {
    return null;
  }

  const unheard = unheardNews(db, 99);

  if (unheard.length === 0) {
    return null;
  }

  const present = sceneEntities(db);
  const quietDays = Math.max(0, daysBetween(lastNewsHeardDate(db), db.state.inStoryDate));
  // Secrets and eyewitness accounts never travel in a bundle.
  const bundleable = unheard.filter((item) => item.knowledge !== 'secret' && item.knowledge !== 'witnesses');

  if (quietDays >= CATCH_UP_QUIET_DAYS && bundleable.length >= 2) {
    return {
      mode: 'catch-up',
      items: bundleable.slice(0, CATCH_UP_MAX).map((item) => offered(db, item, present)),
      style: catchUpStyle(db, present),
      quietDays,
    };
  }

  const item = offered(db, unheard[0], present);

  return { mode: 'single', items: [item], style: singleStyle(db, item, present), quietDays };
}

/** How many news relays the state step may record for a turn built on `db`. */
export function newsAllowance(db: AppDatabase): number {
  const offer = newsOffer(db, { ignoreCombat: true });

  return Math.max(NEWS_PER_TURN, offer?.mode === 'catch-up' ? offer.items.length : 0);
}

// ---------------------------------------------------------------------------
// Prompt text

function bearerLine(item: OfferedNews) {
  const parts: string[] = [];

  if (item.sceneBearers.length > 0) {
    parts.push(`In the scene: ${item.sceneBearers.slice(0, 4).join(', ')}.`);
  }

  if (item.otherBearers.length > 0) {
    parts.push(`${parts.length > 0 ? 'Elsewhere' : 'Could be known by'}: ${item.otherBearers.slice(0, 4).join(', ')}.`);
  }

  if (parts.length === 0) {
    parts.push('Only someone who was there could know.');
  }

  return parts.join(' ');
}

const URGENCY_TEXT: Record<OfferedNews['urgency'], (item: OfferedNews) => string> = {
  fresh: (item) => (item.major ? '' : ' Minor news: only if it comes up naturally.'),
  due: () => ' It has waited a while: bring it in this turn if any bearer or the delivery fits.',
  overdue: (item) => ` OVERDUE: deliver it this turn; if nobody here could know, it comes to you (${item.channel}).`,
};

export function formatNewsOffer(offer: NewsOffer | null): string {
  if (!offer) {
    return '';
  }

  if (offer.mode === 'catch-up') {
    return [
      `NEWS & RUMORS — CATCH-UP (you have heard no news for about ${offer.quietDays} days, and these events piled up). Deliver them together as ONE report this turn, not one at a time: ${offer.style}. Each event can only come from someone or something that could know it (listed per line), so split the report between sources where needed, like public news from the papers and a group's own business from one of its people. Make clear who or what brings each part, and that some of it is old news by now. Never deliver any other world news.`,
      ...offer.items.map((item) => `- ${item.title} (${item.location}, ${item.region}). ${bearerLine(item)}`),
    ].join('\n');
  }

  const [item] = offer.items;

  return [
    'NEWS & RUMORS (an event you have NOT learned yet; deliver at most this one this turn). Prefer a bearer already in the scene. Make clear who tells you. Never deliver any other world news.',
    `- ${item.title} (${item.location}, ${item.region}). ${bearerLine(item)} Delivery this time: ${offer.style}.${URGENCY_TEXT[item.urgency](item)}`,
  ].join('\n');
}

/** Lines for the state tracker's WORLD TIMELINE TRACKING block. */
export function newsTrackingLines(offer: NewsOffer | null): string[] {
  if (!offer) {
    return [];
  }

  if (offer.mode === 'catch-up') {
    return offer.items.map(
      (item) =>
        `- ${item.timelineId}: ${item.title} (news, part of a catch-up report). news_relayed with "from" = the speaker or channel, for each event the report actually told the player this turn.`
    );
  }

  return offer.items.map(
    (item) =>
      `- ${item.timelineId}: ${item.title} (news the player has not heard). news_relayed with "from" = the speaker or channel, only if someone actually told the player this turn.`
  );
}
