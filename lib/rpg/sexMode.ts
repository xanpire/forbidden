// Sex mode: how a sexual scene plays.
//
// It starts by itself when the scene turns sexual (the player's own input, or
// the state tracker reporting it) and only when everyone in it passes the
// adults-only and no-real-people checks (intimacy.ts). The chip on the Story
// screen can force it on or off. While it runs, every turn is short and fully
// explicit, the partners act on their own desires and limits, and the player
// gets exactly four next moves plus free typing. The scene builds up,
// escalates and reaches a climax; what was already done is kept so it doesn't
// repeat itself. When the act ends, one normal-length reply covers the
// aftermath, then the story goes back to normal and the scene becomes a
// memory like any other.

import { isDeceased } from './deaths';
import { resolveEntity } from './entities';
import { entityCanBeIntimate, intimacyAllowed, playerCanBeIntimate } from './intimacy';
import { displayName } from './names';
import { isPlayer, isPlayerName, playerEntity } from './player';
import type { AppDatabase, EntityRecord, SexEnd, SexPhase, SexScene, TurnDiff } from './types';

/** Exactly this many next moves are offered each turn. */
export const SEX_OPTION_COUNT = 4;
/** Turns of build-up before the scene escalates by itself. */
export const BUILD_UP_TURNS = 2;
/** Turns before a climax is due on its own (the player can always get there sooner). */
export const CLIMAX_DUE_TURNS = 6;
const MAX_DONE = 16;
const PHASES: SexPhase[] = ['build-up', 'escalation', 'climax'];

export function sexSceneOf(db: AppDatabase): SexScene | undefined {
  return db.state.sceneMode?.sex;
}

/** The partners in the sexual scene under way (entity ids). */
export function sexPartners(db: AppDatabase): string[] {
  return sexSceneOf(db)?.with ?? [];
}

// ---------------------------------------------------------------------------
// Reading the player's input

/** Words in the player's own move that make the scene sexual. */
const SEXUAL_MOVE =
  /\b(sex|fuck|fucks|fucking|have sex|make love|making love|go down on|goes down on|going down on|blowjob|blow job|oral|cum|come inside|inside (?:her|him|them|you)|ride (?:him|her|them|you)|riding (?:him|her|them|you)|strip (?:her|him|them)(?: naked)?|strips|stripping|undress(?:es|ing)? (?:her|him|them|me|myself)?|(?:pull|pulls|take|takes|slip|slips|tug|tugs) (?:off )?(?:her|his|their|my) (?:clothes|dress|shirt|top|blouse|skirt|jeans|pants|trousers|bra|panties|underwear|boxers|briefs|lingerie)(?: off)?|take off (?:her|his|their) (?:bra|panties|underwear|boxers|briefs)|pull (?:down|off) (?:her|his|their) (?:panties|underwear|boxers|briefs|pants|jeans)|naked|nude|between (?:her|his|their) legs|grind(?:s|ing)? (?:against|on)|lick(?:s|ing)? (?:her|his|their) (?:pussy|cock|clit|nipples?)|pussy|cock|dick|clit|nipples?|breasts?|tits|finger(?:s|ing)? (?:her|him|them)|stroke (?:his|her) (?:cock|dick)|condom)\b/i;
const QUOTED = /["“”„«»][^"“”„«»]*["“”„«»]/gu;
const NEGATED = /\b(not|never|won't|wouldn't|don't|do not|can't|cannot|refuse to|without|stop)\s+(?:\w+\s+){0,3}$/i;

/** The player's own move (not their words) turns the scene sexual. */
export function sexualMove(input: string): boolean {
  const doing = (input ?? '').replace(QUOTED, ' ');
  for (const match of doing.matchAll(new RegExp(SEXUAL_MOVE.source, 'gi'))) {
    const before = doing.slice(Math.max(0, (match.index ?? 0) - 30), match.index ?? 0);
    if (!NEGATED.test(before)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Who can be in it

function castEntities(db: AppDatabase): EntityRecord[] {
  const seen = new Set<string>();
  return (db.state.sceneCast ?? [])
    .map((name) => resolveEntity(db, name))
    .filter((entity): entity is EntityRecord => {
      if (!entity || seen.has(entity.id) || isPlayer(db, entity) || isDeceased(entity) || entity.type !== 'character') return false;
      seen.add(entity.id);
      return true;
    });
}

/** The people in the scene who may be in a sexual scene: stated adults, never real people. */
export function eligiblePartners(db: AppDatabase, ids?: string[]): string[] {
  if (!playerCanBeIntimate(db).ok) return [];
  const candidates = ids
    ? ids.map((id) => db.entities.find((entity) => entity.id === id)).filter((entity): entity is EntityRecord => Boolean(entity))
    : castEntities(db);
  return candidates
    .filter((entity) => !isPlayer(db, entity) && !isDeceased(entity) && entityCanBeIntimate(db, entity).ok)
    .map((entity) => entity.id)
    .slice(0, 4);
}

/** Sex mode can start with these partners: at least one, and every one passes the hard checks. */
export function canStartSex(db: AppDatabase, ids: string[]): boolean {
  return ids.length > 0 && intimacyAllowed(db, ids);
}

export function newSexScene(db: AppDatabase, ids: string[]): SexScene {
  return { with: ids.slice(0, 4), since: db.state.inStoryDate, turns: 0, phase: 'build-up', done: [] };
}

// ---------------------------------------------------------------------------
// After a turn

function cleanMove(text: string) {
  return text
    .replace(/^[\s*"“”-]+|[\s*"“”.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 70);
}

function phaseIndex(phase: SexPhase | undefined) {
  return phase ? PHASES.indexOf(phase) : -1;
}

/**
 * The scene's phase after a turn: never backwards, the tracker can move it
 * on, and the build-up turns into escalation after a few turns by itself.
 */
function nextPhase(current: SexPhase, reported: SexPhase | undefined, turns: number): SexPhase {
  let index = Math.max(phaseIndex(current), phaseIndex(reported));
  if (index < 1 && turns >= BUILD_UP_TURNS) index = 1;
  return PHASES[Math.max(0, index)];
}

export type SexStep = {
  db: AppDatabase;
  /** The scene ended for good this turn (after its aftermath, or cut off): summarise it. */
  closed: boolean;
  /** The player's next moves, when the scene goes on. */
  options: string[];
};

function withSex(db: AppDatabase, sex: SexScene | undefined): AppDatabase {
  const mode = db.state.sceneMode;
  if (!mode) return db;
  const { sex: _old, fadeToBlack: _fade, ...rest } = mode;
  const next = sex ? { ...rest, sex, ...(mode.fadeToBlack ? { fadeToBlack: true } : {}) } : { ...rest, current: mode.current === 'intimate' ? 'normal' as const : mode.current };
  return { ...db, state: { ...db.state, sceneMode: next } };
}

/** Clears the scene and everyone's positions in it. */
export function endSexScene(db: AppDatabase): AppDatabase {
  const cleared = withSex(db, undefined);
  return { ...cleared, entities: cleared.entities.map((entity) => (entity.scenePosition ? { ...entity, scenePosition: undefined } : entity)) };
}

/**
 * Applies what the tracker saw to the sexual scene: it starts (only past the
 * hard checks), goes on (turns, phase, what was done), ends (the next reply is
 * the aftermath), or closes after its aftermath.
 */
export function applySexStep(
  db: AppDatabase,
  options: {
    report: TurnDiff['sex'];
    /** The mode the reply was narrated in. */
    modeUsed: string | undefined;
    /** The reply was the aftermath of an ended scene. */
    aftermath: boolean;
    /** Who was in the scene this turn (entity ids). */
    castIds: string[];
    sceneEnded: boolean;
    /** The player's move left the scene. */
    leftScene: boolean;
  }
): SexStep {
  const before = sexSceneOf(db);
  const report = options.report;

  // The aftermath reply is done: back to normal, and the scene becomes a memory.
  if (before?.ended && options.aftermath) {
    return { db: endSexScene(db), closed: true, options: [] };
  }

  // The player walked out, or the scene ended outright: no aftermath to write.
  if (before && (options.sceneEnded || options.leftScene) && options.modeUsed !== 'intimate') {
    return { db: endSexScene(db), closed: true, options: [] };
  }

  const reportedIds = (report?.with ?? []).map((item) => item.entityId).filter((id): id is string => Boolean(id));
  let sex = before;

  if (!sex) {
    const wanted = report?.on === true || (options.modeUsed === 'intimate' && report?.on !== false);
    if (!wanted) return { db, closed: false, options: [] };
    const ids = eligiblePartners(db, reportedIds.length ? reportedIds : options.castIds);
    const requested = reportedIds.length ? reportedIds : ids;
    // Everyone the tracker named has to pass; anyone who doesn't keeps it from starting.
    if (!canStartSex(db, requested) || ids.length === 0) return { db, closed: false, options: [] };
    sex = newSexScene(db, ids);
  } else if (reportedIds.length) {
    // Someone joins (a threesome): only past the same checks.
    const joining = reportedIds.filter((id) => !sex!.with.includes(id) && canStartSex(db, [id]));
    if (joining.length) sex = { ...sex, with: [...sex.with, ...joining].slice(0, 4) };
  }

  const turns = sex.turns + (options.modeUsed === 'intimate' ? 1 : 0);
  const done = [...sex.done];
  for (const item of report?.done ?? []) {
    const move = cleanMove(item);
    if (move && !done.some((old) => old.toLowerCase() === move.toLowerCase())) done.push(move);
  }
  const ended: SexEnd | undefined = report?.ended ?? (report?.on === false ? 'stopped' : undefined);
  const next: SexScene = {
    ...sex,
    turns,
    phase: ended === 'finished' ? 'climax' : nextPhase(sex.phase, report?.phase, turns),
    done: done.slice(-MAX_DONE),
    ...(ended ? { ended } : {}),
  };

  return {
    db: withSex(db, next),
    closed: false,
    options: ended ? [] : sexOptions(withSex(db, next), report?.options ?? []),
  };
}

// ---------------------------------------------------------------------------
// The player's four next moves

function partnerEntities(db: AppDatabase): EntityRecord[] {
  return sexPartners(db)
    .map((id) => db.entities.find((entity) => entity.id === id))
    .filter((entity): entity is EntityRecord => Boolean(entity));
}

const DRESSED = /\b(dress|shirt|blouse|top|jeans|pants|trousers|skirt|jacket|coat|hoodie|sweater|suit|uniform|bra|panties|underwear|boxers|briefs|lingerie|socks|t-shirt|tee)\b/i;
const BARE = /\b(naked|nude|nothing on|bare|undressed)\b/i;

/** Moves that fit the scene as it is now, for when the tracker gave too few. */
function fallbackMoves(db: AppDatabase): string[] {
  const partners = partnerEntities(db);
  const first = partners[0];
  const them = partners.length > 1 ? 'them' : first?.gender === 'female' ? 'her' : first?.gender === 'male' ? 'him' : 'them';
  const sex = sexSceneOf(db);
  const dressed = partners.some((entity) => {
    const look = entity.currentLook ?? '';
    return look && DRESSED.test(look) && !BARE.test(look);
  });
  const place = (db.state.location ?? '').toLowerCase();
  const moves = [
    dressed ? `Undress ${them}` : '',
    'Change position',
    `Let ${them} take the lead`,
    sex && sex.phase === 'build-up' ? 'Take it slower' : 'Go faster',
    'Tell them what you want',
    /\bbed(room)?\b/.test(place) ? 'Move to the shower' : 'Take this to the bed',
    'Try something new',
    `Kiss ${them}`,
  ];
  return moves.filter(Boolean);
}

/** Exactly four next moves: the tracker's, then ones that fit the scene, never the same twice. */
export function sexOptions(db: AppDatabase, reported: string[]): string[] {
  const picked: string[] = [];
  const done = new Set((sexSceneOf(db)?.done ?? []).map((item) => item.toLowerCase()));
  for (const raw of [...reported, ...fallbackMoves(db)]) {
    const move = cleanMove(raw);
    if (!move) continue;
    const key = move.toLowerCase();
    if (picked.some((item) => item.toLowerCase() === key)) continue;
    if (reported.length === 0 && done.has(key)) continue;
    picked.push(move.charAt(0).toUpperCase() + move.slice(1));
    if (picked.length === SEX_OPTION_COUNT) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------
// What's on screen: the scene strip

export type SexStripPerson = { name: string; position: string; wearing: string };
export type SexStrip = { location: string; people: SexStripPerson[] };

/** Each person's position and what they're wearing, and where it happens. No meters. */
export function sexStrip(db: AppDatabase): SexStrip | null {
  const sex = sexSceneOf(db);
  if (!sex || sex.with.length === 0) return null;
  const player = playerEntity(db);
  const people = [player, ...partnerEntities(db)]
    .filter((entity): entity is EntityRecord => Boolean(entity))
    .map((entity) => ({
      name: isPlayer(db, entity) ? 'You' : displayName(db, entity),
      position: entity.scenePosition ?? '',
      wearing: entity.currentLook ?? (isPlayer(db, entity) ? db.state.player.outfit ?? '' : ''),
    }));
  return { location: db.state.location, people };
}

// ---------------------------------------------------------------------------
// Prompt lines

function names(db: AppDatabase, ids: string[]) {
  return ids
    .map((id) => db.entities.find((entity) => entity.id === id))
    .filter((entity): entity is EntityRecord => Boolean(entity) && !isPlayerName(db, entity!.name))
    .map((entity) => displayName(db, entity));
}

const PHASE_LINE: Record<SexPhase, string> = {
  'build-up': 'Build-up: take it slow, tease and explore; no climax yet.',
  escalation: 'Escalation: more intense and urgent, building toward a climax; it can come when it fits or when the player pushes for it.',
  climax: 'Climax: let it peak, for them and for the player as the player chooses.',
};

/** The narrator's line for a sex-mode turn. */
export function formatSexLine(db: AppDatabase, sex: SexScene, fade: boolean): string {
  const who = names(db, sex.with);
  const partner = who.length ? who.join(' and ') : 'them';
  if (fade) {
    return `SCENE MODE: sex with ${partner}, but the player chose to fade to black: cut away from anything explicit and pick up afterwards.`;
  }
  const turn = sex.turns + 1;
  const phase = turn > CLIMAX_DUE_TURNS && sex.phase === 'escalation' ? 'Escalation, running long: bring it toward a climax unless the player slows it down.' : PHASE_LINE[sex.phase];
  return [
    `SCENE MODE: sex with ${partner} (turn ${turn}). A short reply covering only a few moments, fully explicit and specific: bodies, touch, sounds, what each person does and says, how they react. No skipping, no fading out, no summing up.`,
    `${who.length > 1 ? 'Each of them has' : `${partner} has`} a will of their own: they take initiative, ask for things, suggest changes and react, following their own desires and limits (their cards). Track each person's position and clothing exactly.`,
    phase,
    sex.done.length ? `Already done in this scene: ${sex.done.slice(-8).join('; ')}. Vary it; don't repeat a beat unless the player asks.` : '',
    'End on their move or a pause that leaves room for the player.',
  ]
    .filter(Boolean)
    .join(' ');
}

const END_WORDS: Record<SexEnd, string> = {
  finished: 'it is over',
  interrupted: 'it was interrupted',
  stopped: 'it stopped',
};

/** The narrator's line for the one aftermath reply. */
export function formatAftermathLine(db: AppDatabase, sex: SexScene): string {
  const who = names(db, sex.with);
  return `SCENE MODE: the sex with ${who.join(' and ') || 'them'} is over (${END_WORDS[sex.ended ?? 'finished']}). One normal-length reply for the aftermath: lying together, talking, getting dressed, someone leaving. After it, the story goes on normally.`;
}

/** What the state tracker needs to know about the scene. */
export function formatSexTracking(db: AppDatabase, refOf: (entity: EntityRecord) => string): string {
  const sex = sexSceneOf(db);
  const rule =
    'sex: on true while a sexual scene with the player is under way this turn (it starts or goes on), false when it ends or never was, null when nothing sexual happens. with: ids of everyone in it besides the player. phase: build-up, escalation or climax, where this turn left it. done: positions and acts shown this turn, a few words each ("her on top", "oral on the couch"). ended: finished (someone came and it is over), interrupted, or stopped (someone said no or changed their mind), only on the turn it ends. options: exactly 4 short next moves for the player, verb first, from the scene as it is (positions, clothes, what they want, what was not done yet).';
  if (!sex) return `SEX\n${rule}`;
  const partners = sex.with
    .map((id) => db.entities.find((entity) => entity.id === id))
    .filter((entity): entity is EntityRecord => Boolean(entity))
    .map(refOf);
  return `SEX\nUnder way with ${partners.join(', ')} (${sex.phase}, ${sex.turns} turns${sex.done.length ? `; done: ${sex.done.slice(-6).join('; ')}` : ''}).\n${rule}`;
}
