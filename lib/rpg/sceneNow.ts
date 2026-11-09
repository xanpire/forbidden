// The scene as a picture would show it, kept turn to turn by the state
// tracker: the things around (a bowl of chips, the TV, drinks, a phone), what's
// on any screen, the mood, and what each person is doing. Positions and
// clothes live on the people themselves (intimacy.ts applyOutfits). The
// picture director reads all of it, so a reply that only says "she leans in"
// still gets the chips and the film in the picture. A new scene starts empty.

import { displayName } from './names';
import { isPlayer } from './player';
import type { AppDatabase, EntityRecord, SceneNow, TurnDiff } from './types';

const MAX_PROPS = 12;

function clean(text: string | undefined, max = 80) {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The scene's live state, only while it belongs to the current scene. */
export function sceneNowOf(db: AppDatabase): SceneNow | null {
  const now = db.state.sceneNow;
  return now && now.seq === (db.state.sceneSeq ?? 0) ? now : null;
}

/** Applies what the tracker saw this turn: props in and out, screens, mood, and what people are doing. */
export function applySceneNow(db: AppDatabase, diff: Pick<TurnDiff, 'sceneNow' | 'outfits'> | null | undefined): AppDatabase {
  const seq = db.state.sceneSeq ?? 0;
  const before = sceneNowOf(db) ?? { seq, props: [], doing: {} };
  const report = diff?.sceneNow;
  const removed = new Set((report?.propsRemoved ?? []).map((item) => clean(item).toLowerCase()));
  const props = before.props.filter((item) => !removed.has(item.toLowerCase()));
  for (const item of report?.propsAdded ?? []) {
    const prop = clean(item);
    if (prop && !props.some((old) => old.toLowerCase() === prop.toLowerCase())) props.push(prop);
  }
  const doing = { ...before.doing };
  for (const item of diff?.outfits ?? []) {
    const what = clean(item.doing, 120);
    if (item.entityId && what) doing[item.entityId] = what;
  }
  const screens = report?.screens !== undefined ? clean(report.screens, 120) : before.screens;
  const mood = report?.mood !== undefined ? clean(report.mood, 60) : before.mood;
  const next: SceneNow = {
    seq,
    props: props.slice(-MAX_PROPS),
    doing,
    ...(screens ? { screens } : {}),
    ...(mood ? { mood } : {}),
  };
  const empty = next.props.length === 0 && !next.screens && !next.mood && Object.keys(next.doing).length === 0;
  if (empty && !db.state.sceneNow) return db;
  return { ...db, state: { ...db.state, sceneNow: next } };
}

/** The scene now, in plain lines for the picture director. */
export function sceneNowLines(db: AppDatabase, people: EntityRecord[]): string[] {
  const now = sceneNowOf(db);
  const lines: string[] = [];
  if (now?.props.length) lines.push(`In the scene: ${now.props.join(', ')}.`);
  if (now?.screens) lines.push(`On screen: ${now.screens}.`);
  if (now?.mood) lines.push(`Mood of the scene: ${now.mood}.`);
  for (const entity of people) {
    const name = isPlayer(db, entity) ? 'The player' : displayName(db, entity);
    const bits = [
      entity.scenePosition ? `position: ${entity.scenePosition}` : '',
      entity.currentLook ? `wearing: ${entity.currentLook}` : '',
      now?.doing[entity.id] ? `doing: ${now.doing[entity.id]}` : '',
    ].filter(Boolean);
    if (bits.length) lines.push(`${name}: ${bits.join('; ')}.`);
  }
  return lines;
}

/** What the state tracker is asked to keep. */
export const SCENE_NOW_TRACKING =
  'scene_now: what a picture of this scene would show besides the people. props_added: things that come into the scene this turn (a bowl of chips, the TV, two glasses of wine, a phone); props_removed: things that leave it (eaten, put away, switched off). screens: what is on a TV, laptop or phone screen right now, when the prose says ("a horror film"), else null. mood: the scene\'s atmosphere in a few words when it changes, else null. In outfit_changed, doing: what that person is doing right now (watching the film, eating chips), when the prose shows it.';
