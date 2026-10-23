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

  const outfit = wearsAkatsukiCloak
    ? 'Kan wears the Akatsuki cloak from reference image 2.'
    : 'Kan wears the plain black shinobi outfit from reference image 1, without the Akatsuki cloak.';

  return [
    'Cinematic dark anime illustration.',
    'Visual image only. Do not render any words, letters, numbers, captions, subtitles, logos, watermarks, or readable text anywhere in the image.',
    'Use the attached reference images of Kan to match his face, black spiky hair, build, and anime art style exactly.',
    'Reference image 1: Kan without the Akatsuki cloak. Reference image 2: Kan wearing the Akatsuki cloak.',
    outfit,
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
