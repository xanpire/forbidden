// Reputation: what the world's factions have on the player.
//
// - Heat. Each faction keeps a `heat` for the player (0-100): how badly it
//   wants them. Deeds its people survive to report raise it (the state
//   tracker's `reputation`); time without new deeds cools it slowly. A
//   faction that keeps a wanted list (`hasBounties`) lists the player past
//   LIST_HEAT, with a level and a price in the world's currency; an entry,
//   once written, is never torn out.
// - Standing (-100..100): how a faction regards the player, which changes
//   how its people treat them (a company, a family, a crew).
// - The player does not know what is written about them until the story
//   shows them (a poster, a hunter naming their price, someone telling them):
//   the tracker's `bounty_seen` marks a faction's entry as known. The narrator
//   always knows, so strangers react honestly; the player's screen shows only
//   what the player has seen.
//
// The narrator gets YOUR NAME OUT THERE: how the people where the player
// stands would react to their face, and, now and then, an optional hunter.

import { daysBetween, timeOfDayOf } from './calendar';
import { isCombatPace } from './timeline';
import { encounterRisk, locationKindOf } from './encounters';
import { regionOf } from './geography';
import { currencyOf, formatMoney } from './money';
import { clamp, hashText, playerTurnCount } from './util';
import type {
  AppDatabase,
  CalendarDate,
  FactionDef,
  FactionStanding,
  ReputationState,
  TurnDiff,
} from './types';

/** Heat at which a faction with a wanted list writes the player onto it. */
export const LIST_HEAT = 15;

export type WantedLevel = 'noted' | 'wanted' | 'high' | 'top';

/** Level thresholds (heat at or above). */
const LEVELS: Array<[number, WantedLevel]> = [
  [85, 'top'],
  [60, 'high'],
  [35, 'wanted'],
  [LIST_HEAT, 'noted'],
];

export const WANTED_LABEL: Record<WantedLevel, string> = {
  noted: 'on file',
  wanted: 'wanted',
  high: 'high priority',
  top: 'most wanted',
};

/** Days without a new deed before a faction's heat starts to cool. */
export const COOL_AFTER_DAYS = 60;
/** Once cooling, one point of heat per this many days. */
export const COOL_DAYS_PER_POINT = 20;

/** Per turn, one faction's heat moves at most this much. */
const MAX_RISE = 25;
const MAX_FALL = 15;

/** Hunters: one optional offer per window of player turns, at most. */
export const HUNTER_WINDOW_TURNS = 10;
const HUNTER_MIN_TURN = 8;

export function factionsOf(db: Pick<AppDatabase, 'world'>): FactionDef[] {
  return Array.isArray(db.world?.factions) ? db.world.factions : [];
}

export function factionById(db: Pick<AppDatabase, 'world'>, id: string | null | undefined): FactionDef | undefined {
  return id ? factionsOf(db).find((faction) => faction.id === id) : undefined;
}

export function factionName(db: Pick<AppDatabase, 'world'>, id: string | null | undefined): string {
  return factionById(db, id)?.name ?? 'someone';
}

export function reputationOf(db: AppDatabase): ReputationState {
  return db.state.reputation ?? emptyReputation();
}

function withReputation(db: AppDatabase, reputation: ReputationState): AppDatabase {
  return { ...db, state: { ...db.state, reputation } };
}

function emptyReputation(): ReputationState {
  return { factions: {}, recent: [] };
}

export function normalizeReputation(raw: unknown): ReputationState {
  if (!raw || typeof raw !== 'object') {
    return emptyReputation();
  }

  const value = raw as Partial<ReputationState>;
  const factions: ReputationState['factions'] = {};

  for (const [id, entry] of Object.entries(value.factions ?? {})) {
    if (entry && typeof entry.heat === 'number' && Number.isFinite(entry.heat)) {
      factions[id] = {
        ...entry,
        heat: clamp(Math.round(entry.heat), 0, 100),
        ...(typeof entry.standing === 'number' && Number.isFinite(entry.standing)
          ? { standing: clamp(Math.round(entry.standing), -100, 100) }
          : {}),
        known: Boolean(entry.known),
      };
    }
  }

  return {
    factions,
    recent: Array.isArray(value.recent)
      ? value.recent.filter((item) => item && typeof item.faction === 'string').slice(-12)
      : [],
  };
}

/** Heat today: a faction forgets slowly, but never takes the player off its list. */
export function currentHeat(entry: FactionStanding | undefined, now: CalendarDate): number {
  if (!entry) {
    return 0;
  }

  const quiet = entry.lastDeedOn ? daysBetween(entry.lastDeedOn, now) : 0;
  const cooled = quiet > COOL_AFTER_DAYS ? Math.floor((quiet - COOL_AFTER_DAYS) / COOL_DAYS_PER_POINT) : 0;
  const floor = entry.listedOn ? LIST_HEAT : 0;

  return Math.max(Math.min(entry.heat, floor), entry.heat - cooled);
}

export function levelFor(heat: number): WantedLevel | null {
  for (const [threshold, level] of LEVELS) {
    if (heat >= threshold) {
      return level;
    }
  }

  return null;
}

/** Two significant figures, so a price reads like one a person would name. */
function roundPrice(amount: number) {
  if (amount <= 0) return 0;

  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(amount)) - 1);
  return Math.round(amount / magnitude) * magnitude;
}

/**
 * The price on the player's head, in the world's currency: scaled to what the
 * player started with, so it means the same in any world (about 3× at the
 * first level, 50× at the top).
 */
export function bountyFor(db: AppDatabase, heat: number): number {
  if (heat < LIST_HEAT) {
    return 0;
  }

  const base = Math.max(100, db.state.player?.money ?? 0);
  return roundPrice((base * heat * heat) / 1500);
}

export type WantedListing = {
  factionId: string;
  name: string;
  heat: number;
  level: WantedLevel;
  bounty: number;
  known: boolean;
  listedOn?: CalendarDate;
  lastReason?: string;
};

/** Every faction that has the player on its wanted list, worst first. */
export function wantedListings(db: AppDatabase): WantedListing[] {
  const reputation = reputationOf(db);
  const now = db.state.inStoryDate;
  const listings: WantedListing[] = [];

  for (const faction of factionsOf(db)) {
    if (!faction.hasBounties) continue;

    const entry = reputation.factions[faction.id];
    const heat = currentHeat(entry, now);
    const level = levelFor(heat);

    if (entry?.listedOn && level) {
      listings.push({
        factionId: faction.id,
        name: faction.name,
        heat,
        level,
        bounty: bountyFor(db, heat),
        known: Boolean(entry.known),
        listedOn: entry.listedOn,
        lastReason: entry.lastReason,
      });
    }
  }

  return listings.sort((a, b) => b.heat - a.heat);
}

/** The highest price on the player's head anywhere: what a hunter would chase. */
export function topBounty(db: AppDatabase): WantedListing | null {
  return wantedListings(db)[0] ?? null;
}

export type StandingBand = 'suspected' | 'doubted' | 'unproven' | 'trusted' | 'valued';

export function standingBand(standing: number): StandingBand {
  if (standing <= -50) return 'suspected';
  if (standing <= -15) return 'doubted';
  if (standing < 15) return 'unproven';
  if (standing < 50) return 'trusted';
  return 'valued';
}

export const STANDING_LABEL: Record<StandingBand, string> = {
  suspected: 'Suspected',
  doubted: 'Doubted',
  unproven: 'Unproven',
  trusted: 'Trusted',
  valued: 'Valued',
};

/** Factions whose view of the player has moved, with their band. */
export function factionStandings(db: AppDatabase): { faction: FactionDef; standing: number; band: StandingBand }[] {
  const reputation = reputationOf(db);

  return factionsOf(db)
    .map((faction) => ({ faction, standing: reputation.factions[faction.id]?.standing ?? 0 }))
    .filter((item) => item.standing !== 0)
    .map((item) => ({ ...item, band: standingBand(item.standing) }));
}

// ---------------------------------------------------------------------------
// Applying the state tracker's report

export function applyReputationChanges(
  db: AppDatabase,
  changes: TurnDiff['reputation'],
  seen: TurnDiff['bountySeen']
): AppDatabase {
  if ((!changes || changes.length === 0) && (!seen || seen.length === 0)) {
    return db;
  }

  const now = db.state.inStoryDate;
  const current = reputationOf(db);
  const factions = { ...current.factions };
  const recent = [...current.recent];
  // One move per faction per turn, however the tracker split it up.
  const moved = new Set<string>();

  for (const change of changes ?? []) {
    const faction = factionById(db, change.faction);

    if (!faction || moved.has(faction.id)) {
      continue;
    }

    const delta = clamp(Math.round(change.change), -MAX_FALL, MAX_RISE);

    if (!Number.isFinite(delta) || delta === 0) {
      continue;
    }

    moved.add(faction.id);
    const reason = change.reason?.trim().slice(0, 160) || undefined;
    recent.push({ faction: faction.id, change: delta, reason, date: now });

    const entry = factions[faction.id];
    // Bake in the cooling so far, then add the new deed.
    const heat = clamp(currentHeat(entry, now) + delta, 0, 100);
    const listedOn = entry?.listedOn ?? (faction.hasBounties && heat >= LIST_HEAT ? now : undefined);
    // Standing moves the other way from heat: a deed against them lowers it.
    const standing = clamp((entry?.standing ?? 0) - delta, -100, 100);

    factions[faction.id] = {
      heat: listedOn ? Math.max(LIST_HEAT, heat) : heat,
      ...(standing !== 0 ? { standing } : {}),
      ...(listedOn ? { listedOn } : {}),
      lastDeedOn: delta > 0 ? now : (entry?.lastDeedOn ?? now),
      lastReason: reason ?? entry?.lastReason,
      known: entry?.known ?? false,
    };
  }

  for (const id of seen ?? []) {
    const entry = factions[id];

    if (entry?.listedOn) {
      factions[id] = { ...entry, known: true };
    }
  }

  return withReputation(db, { factions, recent: recent.slice(-12) });
}

// ---------------------------------------------------------------------------
// Where the player stands, and who would know their face

/** The faction whose territory the player is in (by region, or by name in the location), or null. */
export function territoryOf(db: AppDatabase, location: string): FactionDef | null {
  const region = regionOf(db, location);
  const factions = factionsOf(db);

  if (region) {
    const holder = factions.find((faction) => faction.territoryRegionIds?.includes(region));

    if (holder) return holder;
  }

  const lower = (location ?? '').toLowerCase();

  return factions.find((faction) => faction.name.trim().length >= 3 && lower.includes(faction.name.toLowerCase())) ?? null;
}

function insiderLine(db: AppDatabase, name: string, listing: WantedListing | undefined) {
  if (!listing) {
    return `${name} has nothing on you: its people see a stranger.`;
  }

  const entry = `${name} has you ${WANTED_LABEL[listing.level]} (${formatMoney(listing.bounty, currencyOf(db))} on your head)`;

  switch (listing.level) {
    case 'top':
      return `${entry}. Nearly everyone who works for them knows your face; they act or send for help on sight.`;
    case 'high':
      return `${entry}. Most of their people would know your face; anyone who spots you reports it or moves on you.`;
    case 'wanted':
      return `${entry}. Their investigators and enforcers may know your face; most of their people would not.`;
    default:
      return `${entry}. Only someone who studies their files would place you, and only with a good look.`;
  }
}

function publicLine(listing: WantedListing | undefined) {
  return listing?.level === 'top'
    ? 'Your face has been shown around here; even ordinary people may recognize you.'
    : 'Ordinary people do not know your face.';
}

function standingLines(db: AppDatabase) {
  const text: Record<StandingBand, string> = {
    suspected: 'they suspect you: you are watched, tested, and told nothing',
    doubted: 'they doubt you: curt answers, short leashes',
    unproven: 'you are still unproven to them',
    trusted: 'they trust you: more freedom, more said openly',
    valued: 'they value you: room to choose your own way, and plans shared with you',
  };

  return factionStandings(db).map(({ faction, band }) => `${faction.name} (${STANDING_LABEL[band].toLowerCase()}): ${text[band]}.`);
}

/**
 * The narrator block: how people where the player stands would react to
 * them. Skipped where nobody would be around, except for how groups regard
 * them.
 */
export function formatReputationBlock(db: AppDatabase): string {
  const lines: string[] = [];
  const risk = encounterRisk(locationKindOf(db), timeOfDayOf(db.state.inStoryDate));

  if (risk !== 'none') {
    const listings = wantedListings(db);
    const byFaction = new Map(listings.map((listing) => [listing.factionId, listing]));
    const here = territoryOf(db, `${db.state.location} ${db.state.scene ?? ''}`);

    if (here && (byFaction.has(here.id) || listings.length > 0)) {
      lines.push(insiderLine(db, here.name, byFaction.get(here.id)));
    } else if (listings.length > 0) {
      lines.push(
        `Word of the price on you travels with people who hunt for money: ${listings
          .map((listing) => `${listing.name}, ${WANTED_LABEL[listing.level]} (${formatMoney(listing.bounty, currencyOf(db))})`)
          .join('; ')}.`
      );
    }

    const elsewhere = listings.filter((listing) => listing.factionId !== here?.id);

    if (here && elsewhere.length > 0) {
      lines.push(`Also wanted by: ${elsewhere.map((listing) => `${listing.name} (${WANTED_LABEL[listing.level]})`).join(', ')}.`);
    }

    if (listings.length > 0) {
      lines.push(publicLine(here ? byFaction.get(here.id) : listings[0]));
    }
  }

  lines.push(...standingLines(db));

  if (lines.length === 0) {
    return '';
  }

  const unknown = wantedListings(db).filter((listing) => !listing.known);

  return [
    'YOUR NAME OUT THERE (how strangers react to you; never state these numbers as narration)',
    ...lines.map((line) => `- ${line}`),
    unknown.length > 0
      ? `- You have not seen what ${unknown.map((listing) => listing.name).join(' or ')} has on you; you can find out through a notice, a hunter naming their price, or someone telling you.`
      : '',
    '- Recognition takes a good look and someone who would know. When it happens, show it: a double take, a lowered voice, a sudden exit, a price named. Nobody recognizes you just because you are wanted.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Hunters

/** True on the one turn of each window that may carry a hunter. */
function isHunterTurn(db: AppDatabase, turn: number) {
  if (turn < HUNTER_MIN_TURN) {
    return false;
  }

  const window = Math.floor(turn / HUNTER_WINDOW_TURNS);
  const slot = hashText(`${db.meta.slotId}:hunter:${window}`) % HUNTER_WINDOW_TURNS;

  return turn % HUNTER_WINDOW_TURNS === slot;
}

/** Chance a window's hunter turn actually carries one, by the top level, in quarters. */
const HUNTER_ODDS: Record<WantedLevel, number> = { noted: 1, wanted: 2, high: 3, top: 4 };

const HUNTER_KINDS = [
  'someone who has been asking about you along this road',
  'a pair of hired hands who think the price on you is worth the risk',
  'someone at the counter who recognizes your face and quietly makes a call',
  "an investigator following a weeks-old lead on you, sent by the group's own people",
  'an informant who would sell where you are to whoever pays',
];

export type HunterOffer = { listing: WantedListing; kind: string };

export function hunterOffer(db: AppDatabase): HunterOffer | null {
  if (isCombatPace(db.state.scenePace)) {
    return null;
  }

  const kind = locationKindOf(db);

  if (kind !== 'road' && kind !== 'settlement') {
    return null;
  }

  if (encounterRisk(kind, timeOfDayOf(db.state.inStoryDate)) === 'none') {
    return null;
  }

  const listing = topBounty(db);
  const turn = playerTurnCount(db);

  if (!listing || !isHunterTurn(db, turn)) {
    return null;
  }

  const window = Math.floor(turn / HUNTER_WINDOW_TURNS);

  if (hashText(`${db.meta.slotId}:hunter-odds:${window}`) % 4 >= HUNTER_ODDS[listing.level]) {
    return null;
  }

  // The group's own people only come for the player on its own ground.
  const kinds =
    territoryOf(db, db.state.location)?.id === listing.factionId
      ? HUNTER_KINDS
      : HUNTER_KINDS.filter((item) => !item.includes("group's own people"));

  return { listing, kind: kinds[hashText(`${db.meta.slotId}:hunter-kind:${window}`) % kinds.length] };
}

export function formatHunterOffer(db: AppDatabase, offer: HunterOffer | null): string {
  if (!offer) {
    return '';
  }

  return [
    'A PRICE ON YOUR HEAD (optional)',
    `${offer.listing.name} pays ${formatMoney(offer.listing.bounty, currencyOf(db))} for you. Here that could mean ${offer.kind}.`,
    "If it fits the scene, bring them in: someone watching too long, a name asked at the counter, a tail on the way home. They are this turn's encounter, as capable as real people in their line of work, and can be bought off, outrun, fooled, or beaten. If it does not fit, ignore this.",
  ].join('\n');
}

export function reputationTrackingLines(db: AppDatabase): string[] {
  const factions = factionsOf(db);

  if (factions.length === 0) {
    return ['reputation: []. bounty_seen: [].'];
  }

  const ids = factions.map((faction) => `${faction.id} (${faction.name})`).join(', ');
  const unknown = wantedListings(db).filter((listing) => !listing.known);

  return [
    `reputation: a faction id (${ids}), with change and a short reason, only when THIS turn gave that faction something to hold against the player: its people saw the player do it, the player hurt or crossed its people, or was linked to a deed by witnesses. Usually 3-10; 15-25 for something serious done to them. Negative when the player clearly earns their trust or does them a real service. Otherwise [].`,
    unknown.length > 0
      ? `bounty_seen: faction ids whose wanted entry or price on the player they see or are told about this turn (not yet seen: ${unknown.map((listing) => listing.factionId).join(', ')}). Otherwise [].`
      : 'bounty_seen: faction ids whose wanted entry or price on the player they see or are told about this turn; otherwise [].',
  ];
}
