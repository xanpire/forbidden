import { characterFaceOf, latestCharacterPortrait } from './characterPortrait';
import { resolveEntity } from './entities';
import { displayName } from './names';
import { mentionsEntity } from './characterRefs';
import { completeChat, type CallUsage } from '../openrouter';
import { currentOutfit } from './portrait';
import type { PlannedReference } from './referencePlan';
import { entityAge, timeOfDayOf } from './calendar';
import {
  chipDirection,
  isScaleShot,
  lightLine,
  lookTags,
  recentShots,
  sceneMoment,
  shotTypeOf,
  type ShotChip,
  type ShotType,
} from './imageDirection';
import { CONDITION_INFO } from './weather';
import { sceneNowLines } from './sceneNow';
import type { AppDatabase, EntityRecord } from './types';
import { isPlayer, isPlayerName, playerEntity, playerName } from './player';

/** At most one earlier scene is sent, for rendering style only (#4). */
const RECENT_IMAGE_LIMIT = 1;
/** The director also reads this many replies before the latest. */
const PREVIOUS_REPLIES = 2;

/** People in the scene: 5 normally, up to 10 for an ensemble shot. */
export const SCENE_CAST_LIMIT = 5;
export const ENSEMBLE_CAST_LIMIT = 10;

function sceneCast(db: AppDatabase, limit = SCENE_CAST_LIMIT): string[] {
  const fromState = (db.state.sceneCast ?? []).filter(
    (name) => !isPlayerName(db, name)
  );

  if (fromState.length > 0) {
    return fromState.slice(0, limit);
  }

  const latestAssistant = [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant');
  const text = `${latestAssistant?.content ?? ''} ${db.state.scene}`;

  return db.entities
    .filter(
      (entity) =>
        entity.type === 'character' &&
        !isPlayer(db, entity) &&
        mentionsEntity(text, entity)
    )
    .slice(0, limit)
    .map((entity) => entity.name);
}

/** Most people sent as references in one scene image (more for an ensemble). */
export const SCENE_CHARACTER_LIMIT = 3;

/**
 * How many people can get their own reference slot: what the model takes,
 * minus the player's face and outfit.
 */
export function personReferenceSlots(maxReferences: number) {
  return Math.max(0, maxReferences - 2);
}

/**
 * People named in the image's ACTION who have a face reference or a painted
 * portrait, in the order the ACTION names them. Their face reference wins
 * over a portrait. Images are still stored references (img:...); load them
 * before sending.
 */
export function sceneCharacterReferences(
  db: AppDatabase,
  action: string,
  limit = SCENE_CHARACTER_LIMIT
): Array<{ entity: EntityRecord; name: string; image: string; source: 'face' | 'portrait' }> {
  const found: Array<{ entity: EntityRecord; name: string; image: string; source: 'face' | 'portrait'; at: number }> = [];

  for (const entity of db.entities) {
    if (entity.type !== 'character' || isPlayer(db, entity) || !mentionsEntity(action, entity)) {
      continue;
    }

    const face = characterFaceOf(db, entity.id);
    const portrait = face ? null : latestCharacterPortrait(db, entity.id);
    const image = face?.image ?? portrait?.image;

    if (!image) {
      continue;
    }

    const lower = action.toLowerCase();
    const at = Math.min(
      ...[entity.name, ...entity.aliases]
        .map((name) => lower.indexOf(name.toLowerCase()))
        .filter((index) => index >= 0),
      Number.MAX_SAFE_INTEGER
    );

    found.push({ entity, name: entity.name, image, source: face ? 'face' : 'portrait', at });
  }

  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, Math.max(0, limit))
    .map(({ at: _at, ...rest }) => rest);
}

export function collectRecentSceneImages(db: AppDatabase) {
  return db.rawLog
    .filter((message) => message.kind === 'story' && message.role === 'assistant' && message.image)
    .slice(-RECENT_IMAGE_LIMIT)
    .map((message) => message.image as string)
    .reverse();
}

/** The shot type of the newest scene image, to decide whether it can guide style. */
export function lastShotType(db: AppDatabase): ShotType | null {
  const last = [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant' && message.image);
  const meta = last?.imageMeta;

  return (meta?.shotType as ShotType | undefined) ?? shotTypeOf(meta?.shot);
}

/**
 * The previous image is only a style guide when it was framed the same way:
 * a different shot type would pull the new image toward the old composition.
 */
export function usePreviousForStyle(db: AppDatabase, shotType: ShotType | null) {
  const last = lastShotType(db);
  return !shotType || !last || last === shotType;
}

function tailOf(text: string, maxLength: number) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `…${text.slice(-maxLength).trimStart()}`;
}

function latestStoryReply(db: AppDatabase) {
  return [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant');
}

function latestPlayerAction(db: AppDatabase, beforeId?: string) {
  const log = db.rawLog;
  const end = beforeId ? log.findIndex((message) => message.id === beforeId) : log.length;

  for (let i = (end < 0 ? log.length : end) - 1; i >= 0; i -= 1) {
    const message = log[i];

    if (message.kind === 'story' && message.role === 'user' && message.content.trim()) {
      return message.content.trim();
    }
  }

  return '';
}

function cleanProse(text: string) {
  return text
    .replace(/["“”]/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const IMAGE_ACTION_SYSTEM = `You are the director of one picture from an interactive story set in the real world today, like a film's director of photography. The player character is named on the PLAYER line.

Read the narrator's latest reply (and the replies before it for anything still in the scene) and pick the single INSTANT to show, normally the one at the END of the latest reply: a freeze frame of the whole moment, not a summary. Then write three lines.

ACTION: exactly who does what to whom at that instant, where, and with what around them.
- Two or three sentences, at most 70 words, present tense, third person.
- The actor first, then the action, then the target. Keep the roles right; never swap who acts and who is acted on.
- Name people by name (the player by their name). Unnamed people get a plain description of their role ("a waiter"), never of their age or body.
- Only people physically present at that instant, with their body positions, what they are doing and their expressions.
- Everything visible that makes the moment: the room and furniture, props from SCENE NOW (food, drinks, a phone, the TV and what is on it), the light sources.
- Never describe anyone's age, body type, face or hair: the app adds each person's looks from their own sheet. What they are wearing (or not) is fine.
- No dialogue, sounds, thoughts or backstory, and no text in the image.

SHOT: frame that instant like a film still in a wide 16:9 frame. One line, in this order:
- shot type: extreme close-up | close-up | medium | full body | wide | extreme wide | aerial | over-the-shoulder | ensemble
- angle: low angle | eye level | high angle | from above | point of view | over-the-shoulder | dutch tilt
- lens feel: wide-angle | telephoto compression | shallow depth of field
- composition: where the people sit in the frame and what fills the rest (the room, the city at night, the screen's glow)
- focus: the ONE person who gets the sharpest light and the most space (usually the player or the person they are with)
- light: its source and colour (a TV in a dark room, neon through the window, morning sun, candles)
Pick the shot that sells the moment: close-ups for feelings, wide for a room or a place, from above for two people in bed, point of view for what the player sees. Avoid eye-level medium shots of people standing and centered symmetrical framing.

CAPTION: the same moment for the player's photo album. Call the player "you" and "your", never their name or "he"/"she": one sentence, at most 20 words, present tense, plain words ("You curl up on the sofa while the film flickers."). Call people only by the name you know them by (after "to you:"), or describe them.

Output exactly three lines and nothing else:
ACTION: <the action sentences>
SHOT: <the camera line>
CAPTION: <the caption>`;

/** Added for a sexual scene: the director describes it as it is, never ages or bodies. */
const EXPLICIT_DIRECTION = `This is a sexual scene between adults and the picture is explicit. In ACTION, say exactly who does what to whom: positions, hands and mouths, who is on top, what each person has taken off and what is still on, their expressions, and the setting and props around them, as plainly as the story has it. Use only the names given; never describe anyone as young, never give an age, and never describe faces or bodies beyond what they are doing.`;

const LABELS = ['action', 'shot', 'caption'] as const;

/**
 * Splits the director's reply into the action, the camera line and the
 * caption. A reply without labels is all action (no shot, no caption).
 */
export function parseImageAction(text: string): { action: string; shot?: string; caption?: string } {
  const found: Partial<Record<(typeof LABELS)[number], string>> = {};
  let rest = text;

  for (const label of ['shot', 'caption'] as const) {
    const match = new RegExp(`^\\s*\\**${label}\\**\\s*:\\s*(.+)$`, 'im').exec(rest);

    if (match) {
      found[label] = cleanProse(match[1]);
      rest = rest.replace(match[0], ' ');
    }
  }

  const caption = found.caption?.slice(0, 200);
  const shot = found.shot?.slice(0, 500);
  const action = cleanProse(rest).replace(/^action:\s*/i, '').slice(0, 700);

  return { action, ...(shot ? { shot } : {}), ...(caption ? { caption } : {}) };
}

export type DirectorOptions = {
  /** A shot the player picked with a chip. */
  chip?: ShotChip;
  /** The picture goes to an explicit provider: the director gets the explicit section. */
  explicit?: boolean;
};

export type DirectedImage = {
  action: string;
  shot?: string;
  shotType: ShotType | null;
  caption?: string;
  usage: CallUsage;
  model: string;
};

/** People in the scene with their mood and how they look right now. */
function peopleNotes(db: AppDatabase, cast: string[]) {
  return cast
    .map((name) => {
      const entity = resolveEntity(db, name);
      const bits = [entity?.mood ? `mood: ${entity.mood}` : '', entity?.currentLook ? `looks: ${entity.currentLook}` : '']
        .filter(Boolean)
        .join('; ');

      return bits ? `${name} (${bits.slice(0, 160)})` : '';
    })
    .filter(Boolean);
}

/** What the director reads besides the reply: who, how they feel, light, variety. */
export function directorContext(db: AppDatabase, options: DirectorOptions = {}): string | null {
  const reply = latestStoryReply(db);

  if (!reply?.content.trim()) {
    return null;
  }

  const cast = sceneCast(db, ENSEMBLE_CAST_LIMIT);
  const playerAction = latestPlayerAction(db, reply.id);
  const moment = sceneMoment(db);
  const shots = recentShots(db);
  const forced = chipDirection(options.chip);
  const outfit = currentOutfit(db);
  const notes = peopleNotes(db, cast);
  const castEntities = cast
    .map((name) => resolveEntity(db, name))
    .filter((entity): entity is EntityRecord => Boolean(entity));
  const player = playerEntity(db);
  const now = sceneNowLines(db, [...(player ? [player] : []), ...castEntities]);
  // The replies before the latest, for anything still in the scene.
  const story = db.rawLog.filter((message) => message.kind === 'story' && message.role === 'assistant');
  const earlier = story.slice(Math.max(0, story.length - PREVIOUS_REPLIES - 1), -1);

  const who = playerName(db);

  return [
    `PLAYER: ${who}.`,
    `Location: ${db.state.location}.`,
    `Scene: ${db.state.scene}.`,
    !outfit ? '' : `${who} wears ${outfit.replace(/\.$/, '')}.`,
    !db.state.mood ? '' : `${who}'s mood: ${db.state.mood}.`,
    cast.length > 0 ? `Known people in the scene: ${cast.map((name) => {
          const entity = resolveEntity(db, name);
          const known = entity ? displayName(db, entity) : name;

          return known === name ? name : `${name} (to you: ${known})`;
        }).join(', ')}.` : `Known people in the scene: none besides ${who}.`,
    notes.length > 0 ? `How they are: ${notes.join('; ')}.` : '',
    now.length > 0 ? `SCENE NOW:\n${now.join('\n')}` : '',
    `Time and weather: ${timeOfDayOf(moment.date)}, ${String(moment.date.hour ?? 12).padStart(2, '0')}:${String(moment.date.minute ?? 0).padStart(2, '0')}; ${moment.weatherText ?? CONDITION_INFO[moment.condition].label}${moment.indoors ? ' (indoors)' : ''}.`,
    forced ? `The player asked for this shot: ${forced}. Use it.` : '',
    shots.length > 0
      ? `Recent images were framed: ${shots.map((shot) => `"${shot.slice(0, 90)}"`).join('; ')}. Don't repeat the same shot type and angle as last time unless the moment demands it.`
      : '',
    playerAction ? `What the player wrote this turn: ${tailOf(playerAction, 600)}` : '',
    ...(earlier.length > 0 ? ['', 'EARLIER IN THE SCENE (oldest first):', ...earlier.map((message) => tailOf(message.content.trim(), 900))] : []),
    '',
    'NARRATOR REPLY:',
    tailOf(reply.content.trim(), 4000),
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** A chip's shot type, to keep when the director answers with another. */
const CHIP_SHOT: Partial<Record<ShotChip, ShotType>> = {
  closeup: 'close-up',
  wide: 'wide',
  ensemble: 'ensemble',
  close: 'close-up',
  above: 'from above',
  pov: 'point of view',
  room: 'wide',
};

/**
 * The director: writes the image's action, camera line and caption fresh
 * from the latest reply. Runs on the director model (the narrator model
 * unless Settings picks another) at a high temperature for varied framing,
 * and falls back to the cheap memory model. Returns null if both fail.
 */
export async function writeImageAction(
  apiKey: string,
  db: AppDatabase,
  signal?: AbortSignal,
  options: DirectorOptions = {}
): Promise<DirectedImage | null> {
  const context = directorContext(db, options);

  if (!context) {
    return null;
  }

  const director = db.settings.imageDirectorModel?.trim() || db.settings.narrationModel;
  const cheap = db.settings.extractionModel || db.settings.summaryModel;
  const attempts = [
    { model: director, temperature: 0.75 },
    ...(cheap && cheap !== director ? [{ model: cheap, temperature: 0.5 }] : []),
  ];

  for (const attempt of attempts) {
    try {
      const result = await completeChat({
        apiKey,
        model: attempt.model,
        messages: [
          { role: 'system', content: options.explicit ? `${IMAGE_ACTION_SYSTEM}\n\n${EXPLICIT_DIRECTION}` : IMAGE_ACTION_SYSTEM },
          { role: 'user', content: context },
        ],
        temperature: attempt.temperature,
        maxTokens: 900,
        signal,
      });
      const parsed = parseImageAction(result.text);

      if (!parsed.action) continue;

      let shot = parsed.shot;
      let shotType = shotTypeOf(shot);
      const wanted = options.chip ? CHIP_SHOT[options.chip] : undefined;

      // A picked chip wins over the director's choice.
      if (wanted && shotType !== wanted) {
        shot = `${wanted}${shot ? `, ${shot}` : ''}`;
        shotType = wanted;
      }

      return {
        action: parsed.action,
        ...(shot ? { shot } : {}),
        shotType,
        ...(parsed.caption ? { caption: parsed.caption } : {}),
        usage: result.usage,
        model: attempt.model,
      };
    } catch {
      if (signal?.aborted) return null;
    }
  }

  return null;
}

/** The player's look in words, for when no face reference is sent. */
function playerLook(db: AppDatabase) {
  const entity = playerEntity(db);
  const look = db.state.player.appearance.trim() || entity?.appearance?.trim() || 'the main character';

  return `${playerName(db)}: ${look.replace(/\.$/, '')}.`;
}

/** The image style opener: the world's art style, framed as a widescreen still. */
function styleOpener(db: AppDatabase) {
  const style = db.world?.artStyle?.trim() || 'cinematic photo, natural light';

  return `A dramatic widescreen still: ${style.replace(/\.$/, '')}; dynamic composition, strong contrast.`;
}

const IDENTITY_ONLY =
  'Identity only: copy face, hair, eyes and clothing design. Ignore its pose, expression, framing, lighting and background. The expression comes from the ACTION and SHOT.';

export type ScenePromptOptions = {
  shot?: string;
  shotType?: ShotType | null;
};

export function buildSceneImagePrompt(
  db: AppDatabase,
  references: PlannedReference[],
  action: string,
  options: ScenePromptOptions = {}
) {
  const who = playerName(db);
  const shotType = options.shotType ?? shotTypeOf(options.shot);
  const ensemble = shotType === 'ensemble';
  const cast = sceneCast(db, ensemble ? ENSEMBLE_CAST_LIMIT : SCENE_CAST_LIMIT);
  const sceneText = `${action} ${options.shot ?? ''}`;
  const outfit = currentOutfit(db).replace(/\.$/, '') || 'their usual clothes';

  const hasFace = references.some((reference) => reference.kind === 'face');
  const hasOutfit = references.some((reference) => reference.kind === 'outfit');
  const referenced = new Set(
    references.flatMap((reference) =>
      reference.kind === 'character' && reference.name ? [reference.name] : reference.kind === 'cast' ? reference.names ?? [] : []
    )
  );
  const date = db.state.inStoryDate;
  // Anyone without a reference gets a look tag.
  const looks = lookTags(db, action, {
    exclude: new Set(
      db.entities
        .filter((entity) => referenced.has(entity.name))
        .map((entity) => entity.name)
    ),
    limit: ensemble ? 10 : 5,
    ageAt: (id) => {
      const entity = db.entities.find((item) => item.id === id);
      return entity ? entityAge(date, entity) : undefined;
    },
  });

  // 1. Frame and style first: image models weight the start most.
  const lines = [
    styleOpener(db),
    'Visual image only: no words, letters, numbers, captions, subtitles, logos, watermarks, or readable text anywhere.',
  ];

  // 2. The camera, 3. the action.
  if (options.shot) {
    lines.push(`SHOT: ${options.shot}`);
  }

  lines.push(`ACTION (depict this exactly): ${action}`);

  // 4. Light and atmosphere from the real weather and clock.
  lines.push(lightLine(db, sceneText));

  lines.push(`Location: ${db.state.location}.`);

  // The player's look.
  if (!hasFace) {
    lines.push(playerLook(db));
  }

  lines.push(hasOutfit ? `${who} currently wears ${outfit}.` : `${who} wears ${outfit}.`);

  if (looks.length > 0) {
    lines.push(`How the others look: ${looks.join(' | ')}.`);
  }

  // 5. Reference labels, short, identity only.
  if (references.length > 0) {
    lines.push('Use the attached reference images as labelled below.');
  }

  references.forEach((reference, i) => {
    const n = i + 1;

    if (reference.kind === 'edit') {
      lines.push(`Reference image ${n}: the image to edit.`);
    } else if (reference.kind === 'face') {
      lines.push(
        `Reference image ${n}: ${who}'s face. Match the face exactly: hair, eyes, facial structure, hairline. ${IDENTITY_ONLY}`
      );
    } else if (reference.kind === 'outfit') {
      lines.push(
        `Reference image ${n}: the clothes ${who} currently wears (${outfit}). Dress ${who} in exactly these clothes. ${IDENTITY_ONLY}`
      );
    } else if (reference.kind === 'alternate') {
      lines.push(
        `Reference image ${n}: another outfit of ${who}'s. Use only if the story explicitly changes their clothing.`
      );
    } else if (reference.kind === 'character') {
      const name = reference.name ?? 'this person';
      lines.push(
        reference.source === 'face'
          ? `Reference image ${n}: ${name}'s face, at their current age, in this image's art style. ${IDENTITY_ONLY}`
          : `Reference image ${n}: a portrait of ${name}: their face, hair, colouring and usual clothing. ${IDENTITY_ONLY}`
      );
    } else if (reference.kind === 'cast') {
      const names = reference.names ?? [];
      lines.push(
        `Reference image ${n} is a cast sheet: left to right ${names.join(', ')}. Match each face to its name. The labels on the sheet are for you only; never draw them. ${IDENTITY_ONLY}`
      );
    } else {
      lines.push(
        `Reference image ${n}: a previous scene image, for rendering style and line quality only, not composition, camera or lighting. Ignore any characters or figures in it; they belonged to an older scene and must NOT appear now.`
      );
    }
  });

  if (hasFace) {
    lines.push(
      references.some((reference) => reference.kind === 'character' || reference.kind === 'cast')
        ? `${who}'s face and outfit images are for ${who} only; each other person's reference is for that person only, and never give one person another's face. Do not redesign ${who}'s face or hairstyle.`
        : `The reference images are for ${who}'s face and clothing only, and any other people in them must not appear. Do not redesign ${who}'s face or hairstyle.`
    );
  }

  // 6. Rules, condensed at the end.
  lines.push(
    `ACTOR RULE: ${who} performs the action unless the ACTION says someone else does. Any other person in the ACTION is the one being acted upon — a target, a captive, an ally. NEVER depict ${who} as the victim of their own action. If the ACTION says ${who} chokes someone, draw ${who} choking the other person, never ${who} holding their own throat.`,
    isScaleShot(shotType)
      ? 'Only the people named in the ACTION may appear with recognisable faces. Unnamed extras described there are allowed, and so are tiny, distant, faceless figures, rooftops, smoke columns, a whole city or crowd below. No other recognisable faces.'
      : 'Only the people named in the ACTION may appear. Unnamed extras explicitly described there (for example "a security guard") are allowed. No other faces, no crowd, no bystanders.',
    cast.length > 0
      ? `Named people in this scene besides ${who}: ${cast.join(', ')}.`
      : `Named people in this scene besides ${who}: none — any other person must come from the ACTION text itself.`,
    ensemble
      ? 'Ensemble: keep every person distinct and readable; the focal person named in the SHOT gets the sharpest light and the most space.'
      : '',
    'Compose for the wide 16:9 frame: subjects off-center, the rest of the frame doing work (sky, landscape, effects).',
    'Final reminder: no text, lettering, captions, or watermarks in the image.',
  );

  return (lines.filter(Boolean).join('\n'));
}

/** A short edit of an existing image (#12): the image, plus the player's face so it doesn't drift. */
export function buildRetouchPrompt(tweak: string, references: PlannedReference[], name = 'the main character') {
  const lines = [
    `Edit this image: ${tweak.trim()}. Keep everything else the same: characters, faces, clothing, composition, style.`,
  ];

  references.forEach((reference, i) => {
    const n = i + 1;

    if (reference.kind === 'edit') {
      lines.push(`Reference image ${n}: the image to edit.`);
    } else if (reference.kind === 'face') {
      lines.push(`Reference image ${n}: ${name}'s face. Keep that face exactly like this. ${IDENTITY_ONLY}`);
    }
  });

  lines.push('No text, lettering, captions, or watermarks in the image.');
  return lines.join('\n');
}
