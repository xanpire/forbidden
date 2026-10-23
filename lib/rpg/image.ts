import type { AppDatabase } from './types';

export function buildSceneImagePrompt(db: AppDatabase) {
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

  return [
    'Cinematic dark anime illustration.',
    'Visual image only. Do not render any words, letters, numbers, captions, subtitles, logos, watermarks, or readable text anywhere in the image.',
    'Use the attached reference images of Kan to match his face, black spiky hair, build, and anime art style exactly.',
    `Reference image 1: full-body Kan in ${currentOutfit}.`,
    `Reference image 2: close-up of Kan’s face in ${currentOutfit}.`,
    `Reference image 3: full-body Kan in ${alternateOutfit}.`,
    `Reference image 4: close-up of Kan’s face in ${alternateOutfit}.`,
    'Use the close-up references to match facial structure, eyes, nose, mouth, hairline, and expression.',
    'Use the full-body references for build, posture, and outfit.',
    `Kan currently wears ${currentOutfit}.`,
    'Do not redesign Kan’s face or hairstyle. Keep his likeness consistent across images.',
    `Scene: ${db.state.scene}.`,
    `Location: ${db.state.location}.`,
    `Timeline: ${db.state.canonPoint}.`,
    'Characters: Kan is present.',
    `Visual subject: ${visualScene.slice(0, 500)}`,
    'Style: Naruto-inspired anime, gritty realism, moody lighting, rain, red accents, high detail.',
    'Final reminder: no text, lettering, captions, or watermarks in the image.',
  ].join('\n');
}
