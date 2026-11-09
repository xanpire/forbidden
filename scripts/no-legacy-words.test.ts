// No prompt the app sends (narrator, tracker, summaries, images) carries any
// word from the old Naruto setting. The list is the session 2 grep list.
import { describe, expect, mock, test } from 'bun:test';

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    getAllKeys: async () => [],
    multiGet: async () => [],
    multiSet: async () => undefined,
    multiRemove: async () => undefined,
  },
}));

import { normalizeDatabase } from '../lib/rpg/db';
import { seedDatabase } from '../lib/rpg/seed';
import { appendStoryMessage } from '../lib/rpg/log';
import {
  NARRATION_SYSTEM,
  buildArcSummaryPrompt,
  buildExtractionPrompt,
  buildNarrationPrompt,
  buildSceneSummaryPrompt,
  buildTimeSkipPrompt,
} from '../lib/rpg/prompt';
import { buildSceneImagePrompt } from '../lib/rpg/image';
import { buildPortraitPrompt, portraitSignature } from '../lib/rpg/portrait';
import { buildCharacterPortraitPrompt, characterPortraitSignature } from '../lib/rpg/characterPortrait';

const LEGACY = /naruto|chakra|jutsu|\bryo\b|ryō|hokage|uchiha|akatsuki|itachi|konoha|leaf village|hidden leaf|shinobi|ninja|\bkan\b/i;

function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

describe('no legacy setting words in any prompt', () => {
  let db = normalizeDatabase(seedDatabase('slot_words', 'Words'));
  db = appendStoryMessage(db, 'user', 'I order a drink.', 'm', 0, 0);
  db = appendStoryMessage(db, 'assistant', 'Mara slides a glass across the bar.', 'm', 0, 0);
  const story = db.rawLog.filter((entry) => entry.kind === 'story');
  const mara = db.entities.find((entity) => entity.name === 'Mara Vance')!;

  const prompts: Record<string, string> = {
    'narrator system': NARRATION_SYSTEM,
    narrator: text(buildNarrationPrompt(db, 'I look around.').messages),
    tracker: text(buildExtractionPrompt(db, 'I look around.', 'Rain on the windows.').messages),
    'scene summary': text(buildSceneSummaryPrompt(db, story)),
    'arc summary': text(buildArcSummaryPrompt(db, ['You met Mara at the bar.'])),
    'time skip': text(buildTimeSkipPrompt(db, 'tonight', 'next week')),
    'scene image': buildSceneImagePrompt(db, [], 'Alex Reyes leans on the bar while Mara pours.'),
    portrait: buildPortraitPrompt(db, portraitSignature(db), []),
    'character portrait': buildCharacterPortraitPrompt(db, mara, characterPortraitSignature(db, mara), []),
  };

  for (const [name, prompt] of Object.entries(prompts)) {
    test(`${name} prompt is clean`, () => {
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt.match(LEGACY)?.[0] ?? null).toBeNull();
    });
  }

  test('the narrator gets the player-written world and character as prose', () => {
    const narrator = buildNarrationPrompt(db, 'I look around.').messages.map((message) => message.content).join('\n');
    expect(narrator).toContain('THE WORLD');
    expect(narrator).toContain('WHO YOU ARE');
    expect(narrator).toContain(db.state.player.backstory);
    expect(narrator).not.toMatch(/"\w+":/);
  });
});
