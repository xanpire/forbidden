import { sameDate } from './calendar';
import type { AppDatabase } from './types';

const RECENT_IMAGE_LIMIT = 2;

function sceneCast(db: AppDatabase): string[] {
  return db.entities
    .filter(
      (entity) =>
        entity.type === 'character' &&
        entity.name.toLowerCase() !== 'kan' &&
        entity.lastSeen &&
        sameDate(entity.lastSeen, db.state.inStoryDate)
    )
    .slice(0, 4)
    .map((entity) => entity.name);
}

export function collectRecentSceneImages(db: AppDatabase) {
  return db.rawLog
    .filter((message) => message.kind === 'story' && message.role === 'assistant' && message.image)
    .slice(-RECENT_IMAGE_LIMIT)
    .map((message) => message.image as string);
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
    `Scene: ${db.state.scene}.`,
    `Location: ${db.state.location}.`,
    `Timeline: ${db.state.canonPoint}.`,
    'Characters rule: only the cast listed below may appear; no one else.',
    cast.length > 0
      ? `Cast: Kan${cast.map((name) => `, ${name}`).join('')}.`
      : 'Cast: Kan is alone. No other person may appear in the image.',
    `Visual subject: ${visualScene.slice(0, 500)}`,
    'Style: Naruto-inspired anime, gritty realism, moody lighting, rain, red accents, high detail.',
    'Final reminder: no text, lettering, captions, or watermarks in the image.',
  );

  return lines.join('\n');
}
