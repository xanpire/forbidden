// The picture check: a cheap vision call after each picture that compares it
// with its ACTION and the scene as it is now. When the roles came out reversed
// (the player doing it to themselves instead of the other person), someone is
// missing, or a position, the clothes or a key prop is wrong, the picture is
// redone once with a sharper rule built from the check's note.

import { completeChat, type CallUsage } from '../openrouter';
import { resolveEntity } from './entities';
import { mentionsEntity } from './characterRefs';
import { sceneNowOf } from './sceneNow';
import { playerEntity } from './player';
import type { AppDatabase } from './types';

export type ImageCheck = {
  rolesOk: boolean;
  extraPeople: boolean;
  /** Someone missing, or a wrong position, clothing state or key prop. */
  missing: boolean;
  note: string;
  usage: CallUsage;
  model: string;
};

export function imageCheckEnabled(db: Pick<AppDatabase, 'settings'>) {
  return db.settings.imageCheck !== false;
}

/** The vision model for the check: the director's, which defaults to the narrator's. */
export function imageCheckModel(db: Pick<AppDatabase, 'settings'>) {
  return db.settings.imageDirectorModel?.trim() || db.settings.narrationModel;
}

/** Reads the check's JSON, forgiving code fences and stray prose. */
export function parseImageCheck(text: string): { rolesOk: boolean; extraPeople: boolean; missing: boolean; note: string } | null {
  const match = /\{[\s\S]*\}/.exec(text);

  if (!match) return null;

  try {
    const value = JSON.parse(match[0]) as { roles_ok?: unknown; extra_people?: unknown; scene_ok?: unknown; note?: unknown };

    if (typeof value.roles_ok !== 'boolean') return null;

    return {
      rolesOk: value.roles_ok,
      extraPeople: value.extra_people === true,
      missing: value.scene_ok === false,
      note: typeof value.note === 'string' ? value.note.slice(0, 300) : '',
    };
  } catch {
    return null;
  }
}

/** The first person named in the action: who should be doing it. */
function actorOf(action: string) {
  return /^\s*([A-Z][\w'-]*(?:\s[A-Z][\w'-]*)?)/.exec(action)?.[1] ?? 'the main character';
}

/** What the picture must show: who is in it, their positions and clothes, and the key props. */
export type ExpectedScene = { people: string[]; positions: string[]; clothing: string[]; props: string[] };

export function expectedScene(db: AppDatabase, action: string): ExpectedScene {
  const player = playerEntity(db);
  const present = [
    ...(player && mentionsEntity(action, player) ? [player] : []),
    ...(db.state.sceneCast ?? []).map((name) => resolveEntity(db, name)).filter((entity): entity is NonNullable<typeof entity> => Boolean(entity) && mentionsEntity(action, entity!)),
  ];
  const unique = [...new Map(present.map((entity) => [entity.id, entity])).values()];
  const now = sceneNowOf(db);
  return {
    people: unique.map((entity) => entity.name),
    positions: unique.filter((entity) => entity.scenePosition).map((entity) => `${entity.name}: ${entity.scenePosition}`),
    clothing: unique.filter((entity) => entity.currentLook).map((entity) => `${entity.name}: ${entity.currentLook}`),
    props: (now?.props ?? []).filter((prop) => action.toLowerCase().includes(prop.toLowerCase().split(' ').slice(-1)[0] ?? '')).slice(0, 4),
  };
}

export async function checkSceneImage(
  apiKey: string,
  db: AppDatabase,
  image: string,
  action: string,
  expected?: ExpectedScene,
  signal?: AbortSignal
): Promise<ImageCheck | null> {
  const model = imageCheckModel(db);
  const actor = actorOf(action);
  const scene = expected
    ? [
        expected.people.length ? `Who must be in it: ${expected.people.join(', ')}.` : '',
        expected.positions.length ? `Positions: ${expected.positions.join('; ')}.` : '',
        expected.clothing.length ? `Clothing: ${expected.clothing.join('; ')}.` : '',
        expected.props.length ? `Key props: ${expected.props.join(', ')}.` : '',
      ].filter(Boolean).join('\n')
    : '';

  try {
    const result = await completeChat({
      apiKey,
      model,
      messages: [
        {
          role: 'user',
          content: `ACTION: ${action}${scene ? `\n${scene}` : ''}\nIn this image, is ${actor} the one doing the action to the others, or is it reversed (someone else doing it, or ${actor} doing it to themselves)? Are there extra people who shouldn't be there (recognisable faces not in the ACTION)? Does it match the scene: is anyone missing, is a position wrong, is anyone dressed when they shouldn't be (or the reverse), is a key prop missing? Answer only JSON: { "roles_ok": true|false, "extra_people": true|false, "scene_ok": true|false, "note": "what is wrong, in one short sentence" }`,
          images: [image],
        },
      ],
      temperature: 0,
      maxTokens: 300,
      signal,
    });
    const parsed = parseImageCheck(result.text);

    return parsed ? { ...parsed, usage: result.usage, model } : null;
  } catch {
    return null;
  }
}

/** A sharper actor rule for the retry, from what the check saw. */
export function sharperActorRule(action: string, check: Pick<ImageCheck, 'note' | 'extraPeople' | 'rolesOk'> & { missing?: boolean }) {
  const actor = actorOf(action);

  return [
    !check.rolesOk
      ? `CORRECTION: a previous attempt got the roles wrong${check.note ? ` (${check.note.replace(/\.$/, '')})` : ''}. ${actor} is the one DOING the action; the others receive it. Draw it exactly that way round.`
      : '',
    check.extraPeople ? 'CORRECTION: a previous attempt added people who are not in the ACTION. Draw only the people the ACTION names.' : '',
    check.missing ? `CORRECTION: a previous attempt did not match the scene${check.note ? ` (${check.note.replace(/\.$/, '')})` : ''}. Show everyone in the ACTION, in exactly the positions and clothing it describes, with the props it names.` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
