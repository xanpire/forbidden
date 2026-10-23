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
    ? 'Kan wears the Akatsuki cloak shown in reference images 2 and 4.'
    : 'Kan wears the plain black shinobi outfit shown in reference images 1 and 3, without the Akatsuki cloak.';

  return [
    'Cinematic dark anime illustration.',
    'Visual image only. Do not render any words, letters, numbers, captions, subtitles, logos, watermarks, or readable text anywhere in the image.',
    'Use the attached reference images of Kan to match his face, black spiky hair, build, and anime art style exactly.',
    'Reference image 1: full-body Kan without the Akatsuki cloak.',
    'Reference image 2: full-body Kan wearing the Akatsuki cloak.',
    'Reference image 3: close-up of Kan’s face without the Akatsuki cloak.',
    'Reference image 4: close-up of Kan’s face wearing the Akatsuki cloak.',
    'Use the close-up references to match facial structure, eyes, nose, mouth, hairline, and expression.',
    'Use the full-body references for build, posture, and outfit.',
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
