import { characterFaceOf, latestCharacterPortrait } from './characterPortrait';
import { mentionsEntity } from './characterRefs';
import { localizePlaceNames } from './glossary';
import { completeChat, type CallUsage } from '../openrouter';
import { wearsAkatsukiCloak } from './portrait';
import type { PlannedReference } from './referencePlan';
import type { AppDatabase, EntityRecord } from './types';

const RECENT_IMAGE_LIMIT = 2;

function sceneCast(db: AppDatabase): string[] {
  const fromState = (db.state.sceneCast ?? []).filter(
    (name) => name.toLowerCase() !== 'kan'
  );

  if (fromState.length > 0) {
    return fromState.slice(0, 5);
  }

  const latestAssistant = [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant');
  const text = `${latestAssistant?.content ?? ''} ${db.state.scene}`;

  return db.entities
    .filter(
      (entity) =>
        entity.type === 'character' &&
        entity.name.toLowerCase() !== 'kan' &&
        mentionsEntity(text, entity)
    )
    .slice(0, 5)
    .map((entity) => entity.name);
}

/** Most people sent as references in one scene image. */
export const SCENE_CHARACTER_LIMIT = 3;

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
    if (entity.type !== 'character' || entity.name.toLowerCase() === 'kan' || !mentionsEntity(action, entity)) {
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

/** Used when the description call fails: the end of the reply, cleaned up. */
export function fallbackImageAction(db: AppDatabase) {
  const reply = latestStoryReply(db);
  return tailOf(cleanProse(reply?.content ?? db.state.scene), 700);
}

const IMAGE_ACTION_SYSTEM = `You write the action line for one illustration of an interactive Naruto story. The player character is Kan.

Read the narrator's latest reply and describe the single most visual moment from it, normally the one at the END of the reply, as the picture should show it.
- One or two sentences, at most 45 words, present tense, third person.
- Say exactly who does what to whom, and where: the actor first, then the action, then the target. Keep the roles right; never swap who acts and who is acted on.
- Name people by name ("Kan", "Itachi"). Unnamed people get a short description ("a Stone ninja").
- Only people physically present in that moment. Include body positions, expressions, and any visible jutsu, weapon, or weather.
- No dialogue, sounds, thoughts, backstory, or text in the image.

Then write a caption for the same moment, for the player's scrapbook of photos of Kan's life. The player is Kan, so the caption calls Kan "you" and "your", never "Kan", "he" or "his": one sentence, at most 20 words, present tense, plain words ("You kneel at Izumi's grave and set down a white flower.").

Output exactly two lines and nothing else:
ACTION: <the action sentences>
CAPTION: <the caption>`;

/**
 * Splits the reply into the action line and the caption. A reply without
 * the labels is all action (no caption).
 */
export function parseImageAction(text: string): { action: string; caption?: string } {
  const captionMatch = /^\s*caption\s*:\s*(.+)$/im.exec(text);
  const caption = captionMatch ? cleanProse(captionMatch[1]).slice(0, 200) : undefined;
  const withoutCaption = captionMatch ? text.replace(captionMatch[0], ' ') : text;
  const action = cleanProse(withoutCaption).replace(/^action:\s*/i, '').slice(0, 400);

  return { action, ...(caption ? { caption } : {}) };
}

/**
 * Writes the image's action line fresh from the latest reply with a small,
 * cheap call. Returns null if the call fails, so the caller can fall back.
 */
export async function writeImageAction(
  apiKey: string,
  db: AppDatabase,
  signal?: AbortSignal
): Promise<{ action: string; caption?: string; usage: CallUsage; model: string } | null> {
  const reply = latestStoryReply(db);

  if (!reply?.content.trim()) {
    return null;
  }

  const cast = sceneCast(db);
  const model = db.settings.extractionModel || db.settings.summaryModel;
  const playerAction = latestPlayerAction(db, reply.id);
  const context = [
    `Location: ${db.state.location}.`,
    `Scene: ${db.state.scene}.`,
    `Kan wears ${wearsAkatsukiCloak(db) ? 'the Akatsuki cloak' : 'a plain black shinobi outfit'}.`,
    cast.length > 0 ? `Known people in the scene: ${cast.join(', ')}.` : 'Known people in the scene: none besides Kan.',
    playerAction ? `What Kan's player wrote this turn: ${tailOf(playerAction, 600)}` : '',
    '',
    'NARRATOR REPLY:',
    tailOf(reply.content.trim(), 4000),
  ]
    .filter((line) => line !== '')
    .join('\n');

  try {
    const result = await completeChat({
      apiKey,
      model,
      messages: [
        { role: 'system', content: IMAGE_ACTION_SYSTEM },
        { role: 'user', content: context },
      ],
      temperature: 0.3,
      maxTokens: 600,
      signal,
    });
    const { action, caption } = parseImageAction(result.text);

    return action ? { action, ...(caption ? { caption } : {}), usage: result.usage, model } : null;
  } catch {
    return null;
  }
}

const KAN_LOOK =
  'Kan: a lean young shinobi with black spiky hair and brown eyes, guarded expression.';

export function buildSceneImagePrompt(
  db: AppDatabase,
  references: PlannedReference[],
  action: string
) {
  const cast = sceneCast(db);
  const cloak = wearsAkatsukiCloak(db);

  const currentOutfit = cloak
    ? 'the Akatsuki cloak'
    : 'the plain black shinobi outfit without the Akatsuki cloak';

  const alternateOutfit = cloak
    ? 'the plain black shinobi outfit without the Akatsuki cloak'
    : 'the Akatsuki cloak';

  const hasFace = references.some((reference) => reference.kind === 'face');
  const hasOutfit = references.some((reference) => reference.kind === 'outfit');

  const lines = [
    'Cinematic dark anime illustration.',
    'Visual image only. Do not render any words, letters, numbers, captions, subtitles, logos, watermarks, or readable text anywhere in the image.',
  ];

  if (references.length > 0) {
    lines.push('Use the attached reference images as labelled below.');
  }

  references.forEach((reference, i) => {
    const n = i + 1;

    if (reference.kind === 'face') {
      lines.push(
        `Reference image ${n}: Kan's face sheet — front, both profiles, and back of head, with no clothes shown. Match his face exactly: black spiky hair, brown eyes, facial structure, hairline.`
      );
    } else if (reference.kind === 'outfit') {
      lines.push(
        `Reference image ${n}: the clothes Kan currently wears (${currentOutfit}) — front, side, and back views with NO person. Dress Kan in exactly these clothes.`
      );
    } else if (reference.kind === 'alternate') {
      lines.push(
        `Reference image ${n}: the alternate outfit (${alternateOutfit}) — front, side, and back views with NO person. Use only if the story explicitly changes his clothing.`
      );
    } else if (reference.kind === 'character') {
      const name = reference.name ?? 'this person';
      lines.push(
        reference.source === 'face'
          ? `Reference image ${n}: ${name}'s face. When ${name} appears, match their face, eyes, hair and colouring exactly, at their current age, in this image's art style. Ignore the reference's pose, clothes, background and art style.`
          : `Reference image ${n}: a portrait of ${name}. When ${name} appears, match their face, hair, colouring and usual clothing. Ignore the portrait's pose and background.`
      );
    } else {
      lines.push(
        `Reference image ${n}: a previous scene image. Use it ONLY for art style, color palette, lighting, and rendering continuity. Ignore any characters or figures in it; they belonged to an older scene and must NOT appear now.`
      );
    }
  });

  if (hasFace) {
    lines.push(
      'Use the face sheet for facial structure, eyes, nose, mouth, hairline, and hairstyle. Do not redesign Kan’s face or hairstyle.',
      references.some((reference) => reference.kind === 'character')
        ? 'Kan\'s face sheet and outfit images are for Kan only; each other person\'s reference is for that person only. Ignore poses and backgrounds in all references, and never give one person another\'s face.'
        : 'The reference images are for Kan\'s face and clothing only. Ignore their poses, background, and any other people in them.'
    );
  } else {
    lines.push(KAN_LOOK);
  }

  if (!hasOutfit) {
    lines.push(
      cloak
        ? 'Kan wears the Akatsuki cloak: long black cloak with red clouds outlined in white, high collar.'
        : 'Kan wears a plain black shinobi outfit: fitted black top and pants, no Akatsuki cloak.'
    );
  } else {
    lines.push(`Kan currently wears ${currentOutfit}.`);
  }

  lines.push(
    `Scene: ${db.state.scene}.`,
    `Location: ${db.state.location}.`,
    `Timeline: ${db.state.canonPoint}.`,
    `ACTION (depict this exactly): ${action}`,
    'ACTOR RULE: Kan performs the action unless the ACTION says someone else does. Any other person in the ACTION is the one being acted upon — a target, a captive, an ally. NEVER depict Kan as the victim of his own action. If the ACTION says Kan chokes someone, draw Kan choking the other person, never Kan holding his own throat.',
    'Only the people named in the ACTION may appear. Unnamed extras explicitly described there (for example "a Stone ninja") are allowed. No other faces, no crowd, no bystanders.',
    cast.length > 0
      ? `Named people in this scene besides Kan: ${cast.join(', ')}.`
      : 'Named people in this scene besides Kan: none — any other person must come from the ACTION text itself.',
    'Style: Naruto-inspired anime, gritty realism, moody lighting, rain, red accents, high detail.',
    'Final reminder: no text, lettering, captions, or watermarks in the image.',
  );

  return localizePlaceNames(lines.join('\n'));
}
