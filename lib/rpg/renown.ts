// Rumours, posters and the player's name (living-world Stage 3, section 10).
//
// - Deeds: every time a faction's people see the player do something and live
//   to tell it (the state tracker's `reputation`), the deed is kept with where
//   and when it happened.
// - The player's name grows by itself: each audience (a faction, or ordinary
//   people) calls them by an epithet that grows from what they saw, never one
//   the player picks. It can change over the years as new deeds outweigh old
//   ones. A name the story itself gives them (someone in the prose calls them
//   by it: the tracker's `epithet`) is kept for that audience.
// - Rumours: in bars, cafés, markets and at checkpoints, people talk about
//   the player's deeds. News travels only as far and as fast as people carry
//   it, and it is distorted by distance and time: close to the truth nearby,
//   grown in the telling further off, a monster story far away.
// - Wanted notices: where a faction that has the player wanted or worse holds
//   the land, its notice is up with the price and a name; the picture is poor
//   at first, good at the top.
//
// The narrator gets one line of what they call the player here (inside YOUR
// NAME OUT THERE) and, now and then, an optional TALK OF YOU line.

import { daysBetween, timeOfDayOf } from './calendar';
import { isCombatPace } from './pacing';
import { encounterRisk, locationKindOf } from './encounters';
import { regionName, regionOf, travelDaysBetween, type Region } from './geography';
import { makeId } from './id';
import { currencyOf, formatMoney } from './money';
import { WANTED_LABEL, factionById, factionsOf, territoryOf, wantedListings, type WantedLevel } from './reputation';
import { hashText, playerTurnCount } from './util';
import type { AppDatabase, Audience, Deed, Epithet, RenownState, TurnDiff } from './types';

/** Ordinary people: everyone who is not a faction. */
export const COMMON_AUDIENCE = 'common';

const MAX_DEEDS = 40;
/** A theme needs this much weight before an audience names the player after it. */
const NAME_AT = 12;
/** A new theme replaces the old name only when it leads by this much... */
const RENAME_LEAD = 1.25;
/** ...and the old name has stood this long. */
const RENAME_AFTER_DAYS = 120;
/** One rumour turn in this many (in places where people talk). */
const RUMOUR_WINDOW_TURNS = 5;
const RUMOUR_MIN_TURN = 4;

/** Every audience in this world: its factions, then ordinary people. */
export function audiencesOf(db: Pick<AppDatabase, 'world'>): Audience[] {
  return [...factionsOf(db).map((faction) => faction.id), COMMON_AUDIENCE];
}

export function audienceName(db: Pick<AppDatabase, 'world'>, audience: Audience): string {
  return audience === COMMON_AUDIENCE ? 'ordinary people' : factionById(db, audience)?.name ?? 'someone';
}

type Tone = 'formal' | 'street';

type Theme = {
  id: string;
  test: RegExp;
  names: { formal: string; street: string };
  /** Old news counts for less. */
  fades?: boolean;
};

const THEMES: Theme[] = [
  {
    id: 'ghost',
    test: /\b(vanish(ed)?|unseen|without a trace|slipped (away|past|through)|disappear(ed)?|escaped|evaded|got away|no one saw)\b/i,
    names: { formal: 'the Ghost', street: 'the One Who Got Away' },
  },
  {
    id: 'violence',
    test: /\b(killed|beat (up|down)?|beaten|stabbed|shot|hurt|broke (his|her|their) |murdered|attacked)\b/i,
    names: { formal: 'the Butcher', street: 'the Red Hand' },
  },
  {
    id: 'mercy',
    test: /\b(spared|saved|protected|helped|sheltered|rescued|let (them|him|her) (live|go))\b/i,
    names: { formal: 'the Samaritan', street: 'the Kind Stranger' },
  },
  {
    id: 'thief',
    test: /\b(stole|robbed|conned|broke in|burgl(ed|ary)|pickpocket(ed)?|swindled)\b/i,
    names: { formal: 'the Thief', street: 'Light Fingers' },
  },
  {
    id: 'liar',
    test: /\b(lied|forged|fake[d]?|disguise[d]?|impersonat(ed|ing)|posed as)\b/i,
    names: { formal: 'the Impostor', street: 'Two Faces' },
  },
  {
    id: 'charmer',
    test: /\b(seduced|charmed|flirted|kissed|slept with|affair)\b/i,
    names: { formal: 'the Charmer', street: 'the Heartbreaker' },
  },
  {
    id: 'money',
    test: /\b(bribed|paid off|bought|spent|tipped|threw money)\b/i,
    names: { formal: 'Deep Pockets', street: 'the Big Spender' },
  },
  {
    id: 'fire',
    test: /\b(burn(ed|ing|t)?|arson|set fire|torched|blaze)\b/i,
    names: { formal: 'the Arsonist', street: 'Firestarter' },
  },
];

const THEME_BY_ID = new Map(THEMES.map((theme) => [theme.id, theme]));

export function renownOf(db: AppDatabase): RenownState {
  const renown = db.state.renown;

  return {
    deeds: Array.isArray(renown?.deeds) ? renown.deeds : [],
    epithets: renown?.epithets && typeof renown.epithets === 'object' ? renown.epithets : {},
  };
}

function withRenown(db: AppDatabase, renown: RenownState): AppDatabase {
  return { ...db, state: { ...db.state, renown } };
}

export function normalizeRenown(raw: unknown): RenownState | undefined {
  if (!raw || typeof raw !== 'object') return undefined;

  const value = raw as Partial<RenownState>;
  const deeds = Array.isArray(value.deeds)
    ? value.deeds.filter((deed): deed is Deed => Boolean(deed) && typeof deed.text === 'string' && Boolean(deed.date))
    : [];
  const epithets: RenownState['epithets'] = {};

  for (const [audience, epithet] of Object.entries(value.epithets ?? {})) {
    if (epithet && typeof epithet.name === 'string' && epithet.since) epithets[audience] = epithet;
  }

  return { deeds: deeds.slice(-MAX_DEEDS), epithets };
}

function nameFor(theme: Theme, audience: Audience): string {
  const tone: Tone = audience === COMMON_AUDIENCE ? 'street' : 'formal';
  return theme.names[tone];
}

/** How much each deed counts for an audience. */
function deedWeightFor(db: AppDatabase, deed: Deed, audience: Audience): number {
  const age = daysBetween(deed.date, db.state.inStoryDate);
  const fresh = age > 730 ? 0.5 : 1;
  const base = Math.abs(deed.weight) * fresh;

  if (audience === COMMON_AUDIENCE) return base * 0.6;
  return deed.faction === audience ? base : 0;
}

/** Theme scores for one audience, highest first. */
export function themeScores(db: AppDatabase, audience: Audience): { theme: Theme; score: number }[] {
  const scores = new Map<string, number>();
  const age = (deed: Deed) => daysBetween(deed.date, db.state.inStoryDate);

  for (const deed of renownOf(db).deeds) {
    const weight = deedWeightFor(db, deed, audience);

    if (weight <= 0) continue;

    for (const theme of THEMES) {
      if (!theme.test.test(deed.text)) continue;

      // Old news fades for themes that do; later deeds outgrow it.
      const fade = theme.fades && age(deed) > 365 ? 0.35 : 1;
      scores.set(theme.id, (scores.get(theme.id) ?? 0) + weight * fade);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ theme: THEME_BY_ID.get(id)!, score }))
    // Ties go to the theme listed first.
    .sort((a, b) => b.score - a.score || THEMES.indexOf(a.theme) - THEMES.indexOf(b.theme));
}

/** Re-names the player where the deeds call for it. Story-given names stand while they are young. */
function settleEpithets(db: AppDatabase): AppDatabase {
  const now = db.state.inStoryDate;
  const renown = renownOf(db);
  const epithets = { ...renown.epithets };
  let changed = false;

  for (const audience of audiencesOf(db)) {
    const [top] = themeScores(db, audience);

    if (!top || top.score < NAME_AT) continue;

    const current = epithets[audience];
    const name = nameFor(top.theme, audience);

    if (current?.theme === top.theme.id || current?.name === name) continue;

    if (current) {
      const standing = daysBetween(current.since, now);
      const currentScore = themeScores(db, audience).find((item) => item.theme.id === current.theme)?.score ?? 0;
      const story = current.theme === 'story';

      if (standing < (story ? RENAME_AFTER_DAYS * 6 : RENAME_AFTER_DAYS)) continue;
      if (top.score < Math.max(currentScore, story ? NAME_AT * 2 : 0) * RENAME_LEAD) continue;
    }

    epithets[audience] = {
      name,
      since: now,
      theme: top.theme.id,
      known: false,
      history: current ? [...(current.history ?? []), { name: current.name, since: current.since }].slice(-6) : undefined,
    };
    changed = true;
  }

  return changed ? withRenown(db, { ...renownOf(db), epithets }) : db;
}

/** Keeps this turn's deeds (from the tracker's reputation changes) and lets the names follow. */
export function recordDeeds(db: AppDatabase, changes: TurnDiff['reputation']): AppDatabase {
  let renown = renownOf(db);
  const now = db.state.inStoryDate;
  const region = regionOf(db, db.state.location) ?? regionOf(db, db.state.scene) ?? undefined;
  const deeds = [...renown.deeds];

  for (const change of changes ?? []) {
    if (!change.reason?.trim() || change.change === 0) continue;
    // A deed that won them over is not what people gossip about.
    if (change.change < 0) continue;

    deeds.push({
      id: makeId('deed'),
      date: now,
      text: change.reason.trim(),
      faction: change.faction,
      region,
      weight: Math.min(25, Math.abs(change.change)),
    });
  }

  if (deeds.length === renown.deeds.length) return settleEpithets(db);

  renown = { ...renown, deeds: deeds.slice(-MAX_DEEDS) };
  return settleEpithets(withRenown(db, renown));
}

/** The tracker's epithet: someone called the player by a name on the page. */
export function applyEpithet(db: AppDatabase, heard: TurnDiff['epithet']): AppDatabase {
  if (!heard?.name?.trim() || !audiencesOf(db).includes(heard.audience)) return db;

  const renown = renownOf(db);
  const name = heard.name.trim().replace(/^["'“”]+|["'“”]+$/g, '').slice(0, 60);
  const current = renown.epithets[heard.audience];

  if (current && current.name.toLowerCase() === name.toLowerCase()) {
    return current.known ? db : withRenown(db, { ...renown, epithets: { ...renown.epithets, [heard.audience]: { ...current, known: true } } });
  }

  // Heard under another audience's name: the player learns that one.
  for (const audience of Object.keys(renown.epithets)) {
    const other = renown.epithets[audience];

    if (other && other.name.toLowerCase() === name.toLowerCase()) {
      return withRenown(db, { ...renown, epithets: { ...renown.epithets, [audience]: { ...other, known: true } } });
    }
  }

  return withRenown(db, {
    ...renown,
    epithets: {
      ...renown.epithets,
      [heard.audience]: {
        name,
        since: db.state.inStoryDate,
        theme: 'story',
        known: true,
        history: current ? [...(current.history ?? []), { name: current.name, since: current.since }].slice(-6) : undefined,
      },
    },
  });
}

/** The player saw a faction's wanted notice: they now know what it calls them. */
export function markEpithetsSeen(db: AppDatabase, factions: TurnDiff['bountySeen']): AppDatabase {
  if (!factions?.length) return db;

  const renown = renownOf(db);
  const epithets = { ...renown.epithets };
  let changed = false;

  for (const faction of factions) {
    const epithet = epithets[faction];

    if (epithet && !epithet.known) {
      epithets[faction] = { ...epithet, known: true };
      changed = true;
    }
  }

  return changed ? withRenown(db, { ...renown, epithets }) : db;
}

/** Whose name for the player strangers use where they stand. */
export function localAudience(db: AppDatabase): Audience {
  return territoryOf(db, `${db.state.location} ${db.state.scene ?? ''}`)?.id ?? COMMON_AUDIENCE;
}

/** The name strangers here would use, if there is one yet. */
export function localEpithet(db: AppDatabase): { audience: Audience; epithet: Epithet } | null {
  const epithets = renownOf(db).epithets;
  const audience = localAudience(db);
  const order: Audience[] = [audience, COMMON_AUDIENCE];

  for (const item of order) {
    const epithet = epithets[item];

    if (epithet) return { audience: item, epithet };
  }

  return null;
}

/** Names the player has heard themselves called, for the You tab. */
export function knownEpithets(db: AppDatabase): { audience: Audience; epithet: Epithet }[] {
  const epithets = renownOf(db).epithets;

  return Object.keys(epithets).flatMap((audience) => {
    const epithet = epithets[audience];

    return epithet?.known ? [{ audience, epithet }] : [];
  });
}

// ---------------------------------------------------------------------------
// The narrator

/** One line for YOUR NAME OUT THERE: what they call the player here. */
export function epithetLines(db: AppDatabase): string[] {
  const local = localEpithet(db);
  const risk = encounterRisk(locationKindOf(db), timeOfDayOf(db.state.inStoryDate));

  if (!local || risk === 'none') return [];

  return [
    `What strangers here call you: "${local.epithet.name}" (${audienceName(db, local.audience)}); people who talk about you use it${local.epithet.known ? '' : ', and you have never heard it'}.`,
  ];
}

function checkpoint(db: AppDatabase) {
  return /\b(checkpoint|border|gate|toll|barrier station|outpost)\b/i.test(`${db.state.location} ${db.state.scene ?? ''}`);
}

/** Where people gather and talk: towns and busy places, and checkpoints on the road. */
function placeThatTalks(db: AppDatabase) {
  const kind = locationKindOf(db);

  return kind === 'settlement' || (kind === 'road' && checkpoint(db));
}

const PICTURE: Partial<Record<WantedLevel, string>> = { wanted: 'poor', high: 'fair', top: 'good' };

/** The wanted notice that is up here, if any. */
export function posterLine(db: AppDatabase): string {
  if (!placeThatTalks(db)) return '';

  const faction = territoryOf(db, `${db.state.location} ${db.state.scene ?? ''}`);
  const listing = wantedListings(db).find((item) => item.factionId === faction?.id && item.level !== 'noted');

  if (!listing || !faction) return '';

  const name = renownOf(db).epithets[faction.id]?.name;

  return `WANTED NOTICES: ${faction.name}'s notice for you is up here (bars, the notice board, the checkpoint): ${WANTED_LABEL[listing.level]}, ${formatMoney(listing.bounty, currencyOf(db))}${name ? `, as "${name}"` : ''}, with a ${PICTURE[listing.level]} picture. Only if you look at one do you learn what it says.`;
}

export type RumourOffer = { deed: Deed; level: 0 | 1 | 2; daysAgo: number; from: Region | null };

/** The deed people might be talking about here this turn, or null. Deterministic per turn. */
export function rumourOffer(db: AppDatabase): RumourOffer | null {
  if (isCombatPace(db.state.scenePace) || !placeThatTalks(db)) return null;
  if (encounterRisk(locationKindOf(db), timeOfDayOf(db.state.inStoryDate)) === 'none') return null;

  const turn = playerTurnCount(db);

  if (turn < RUMOUR_MIN_TURN || hashText(`${db.meta.slotId}:rumour:${turn}`) % RUMOUR_WINDOW_TURNS !== 0) return null;

  const here = regionOf(db, db.state.location) ?? regionOf(db, db.state.scene);
  const now = db.state.inStoryDate;
  const heard = renownOf(db)
    .deeds.map((deed) => {
      const daysAgo = Math.max(0, daysBetween(deed.date, now));
      const distance = here && deed.region ? travelDaysBetween(db, here, deed.region as Region) : 3;

      return { deed, daysAgo, distance };
    })
    // Talk walks: it needs time to get here, about four days per day of road.
    .filter((item) => item.daysAgo >= item.distance * 4 && item.daysAgo <= 1100)
    .sort((a, b) => b.deed.weight / (1 + b.daysAgo / 180) - a.deed.weight / (1 + a.daysAgo / 180));

  if (heard.length === 0) return null;

  const pick = heard[hashText(`${db.meta.slotId}:rumour-pick:${turn}`) % Math.min(3, heard.length)];
  const level: 0 | 1 | 2 = pick.distance <= 1 && pick.daysAgo < 60 ? 0 : pick.distance <= 3 && pick.daysAgo < 400 ? 1 : 2;

  return { deed: pick.deed, level, daysAgo: pick.daysAgo, from: (pick.deed.region as Region) ?? null };
}

const DISTORTION = [
  'Close to the truth: a detail or two wrong.',
  'It has grown in the telling: wrong numbers, the wrong place, a worse version of you.',
  'Barely recognisable by now, a monster story ("they say you put a man in the harbour with your bare hands").',
];

function ago(days: number) {
  if (days >= 330) return `${Math.max(1, Math.round(days / 365))} year(s) ago`;
  if (days >= 50) return `${Math.round(days / 30)} months ago`;
  return `${Math.max(1, Math.round(days / 7))} week(s) ago`;
}

/** TALK OF YOU: the optional rumour and the poster that hangs here. */
export function formatRenownBlock(db: AppDatabase): string {
  const lines: string[] = [];
  const rumour = rumourOffer(db);

  if (rumour) {
    const name = localEpithet(db)?.epithet.name;

    lines.push(
      `TALK OF YOU (optional; only if people here would gossip): someone at a bar, café, market or checkpoint talks about a thing you did ${ago(rumour.daysAgo)}${rumour.from && regionName(db, rumour.from) ? ` in ${regionName(db, rumour.from)}` : ''}: ${rumour.deed.text}. ${DISTORTION[rumour.level]}${name ? ` They call you "${name}".` : ''} They do not know they are talking to you unless they recognize you.`
    );
  }

  const poster = posterLine(db);

  if (poster) lines.push(poster);

  return lines.join('\n');
}

export function renownTrackingLine(db: AppDatabase): string {
  const local = localEpithet(db);
  const audiences = audiencesOf(db)
    .map((audience) => (audience === COMMON_AUDIENCE ? `${COMMON_AUDIENCE} (ordinary people)` : `${audience} (${audienceName(db, audience)})`))
    .join(', ');

  return `epithet: {audience, name} only when someone in the prose calls you by a name or title of their own for you (a nickname, a title on a wanted notice); audience = whose name it is: ${audiences}; otherwise null.${local ? ` Here they call you "${local.epithet.name}" (${local.audience}).` : ''}`;
}
