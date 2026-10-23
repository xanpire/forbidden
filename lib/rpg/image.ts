import type { AppDatabase } from './types';

export function buildSceneImagePrompt(db: AppDatabase) {
  const latestAssistant = [...db.rawLog]
    .reverse()
    .find((message) => message.kind === 'story' && message.role === 'assistant');

  const sceneText = latestAssistant?.content ?? db.state.scene;

  return [
    'Cinematic dark anime illustration.',
    `Scene: ${db.state.scene}.`,
    `Location: ${db.state.location}.`,
    `Timeline: ${db.state.canonPoint}.`,
    `Characters: Kan, a quiet teenage ANBU shinobi of Uchiha-Uzumaki heritage, is present.`,
    `Scene text: ${sceneText.slice(0, 600)}`,
    'Style: Naruto-inspired anime, gritty realism, moody lighting, rain, red accents, high detail.',
  ].join('\n');
}
