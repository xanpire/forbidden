import { mentionsEntity } from './characterRefs';
import { localizePlaceNames } from './glossary';
import type { AppDatabase } from './types';

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

export function collectRecentSceneImages(db: AppDatabase) {
  return db.rawLog
    .filter((message) => message.kind === 'story' && message.role === 'assistant' && message.image)
    .slice(-RECENT_IMAGE_LIMIT)
    .map((message) => message.image as string);
}

function tailOf(text: string, maxLength: number) {
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `…${text.slice(-maxLength).trimStart()}`;
}

export function buildSceneImagePrompt(db: AppDatabase, recentImages: string[] = []) {
  const cast = sceneCast(db);
  const latestAssistant = [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant');

  const sceneText = latestAssistant?.content ?? db.state.scene;

  const visualScene = sceneText
    .replace(/["“”]/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const imageBrief = (db.state.imageBrief ?? '').trim();
  const action = imageBrief || tailOf(visualScene, 700);

  const wearsAkatsukiCloak = db.state.inventory.some((item) =>
    /akatsuki cloak/i.test(item)
  );

  const currentOutfit = wearsAkatsukiCloak
    ? 'the Akatsuki cloak'
    : 'the plain black shinobi outfit without the Akatsuki cloak';

  const alternateOutfit = wearsAkatsukiCloak
    ? 'the plain black shinobi outfit without the Akatsuki cloak'
    : 'the Akatsuki cloak';

  const lines = [
    'Cinematic dark anime illustration.',
    'Visual image only. Do not render any words, letters, numbers, captions, subtitles, logos, watermarks, or readable text anywhere in the image.',
    'Use the attached reference images of Kan to depict him accurately: his face from the face sheet, his clothes from the outfit sheet, and the same anime art style throughout.',
  ];

  let index = 1;

  for (const _ of recentImages) {
    lines.push(
      `Reference image ${index}: a previous scene image. Use it ONLY for art style, color palette, lighting, and rendering continuity. Ignore any characters or figures in it; they belonged to an older scene and must NOT appear now.`,
    );
    index += 1;
  }

  lines.push(
    `Reference image ${index}: Kan's face sheet — front, both profiles, and back of head, with no clothes shown. Match his face exactly: black spiky hair, brown eyes, facial structure, hairline.`,
  );
  index += 1;
  lines.push(
    `Reference image ${index}: the clothes Kan currently wears (${currentOutfit}) — front, side, and back views with NO person. Dress the face reference in exactly these clothes.`,
  );
  index += 1;
  lines.push(
    `Reference image ${index}: the alternate outfit (${alternateOutfit}) — front, side, and back views with NO person. Use only if the story explicitly changes his clothing.`,
  );
  index += 1;

  lines.push(
    'Use the face sheet for facial structure, eyes, nose, mouth, hairline, hairstyle, and expression.',
    'The outfit sheets show clothes without a person: combine the face sheet with the correct outfit sheet to depict Kan accurately.',
    `Kan currently wears ${currentOutfit}.`,
    'Do not redesign Kan’s face or hairstyle. Keep his likeness consistent across images.',
    'The reference images are for Kan\'s face and clothing only. Ignore their poses, background, and any other people in them.',
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
