// No prompt the app sends (narrator, tracker, summaries, images), and no text
// in the app's own code, carries a word from the old Naruto setting or the
// adventure game it grew from (clans, missions, villages, enemies, inns...).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
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
import { seedDatabase } from './fixtures/seed';
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

const LEGACY =
  /naruto|chakra|jutsu|\bryo\b|ryō|hokage|uchiha|akatsuki|itachi|konoha|leaf village|hidden leaf|shinobi|ninja|\bkan\b|\bclans?\b|\bmissions?\b|\bvillages?\b|\benemies\b|\btravell?ing\b|\binns?\b|\binnkeepers?\b|\bquests?\b|\bbount(y|ies)\b|\bepithets?\b|\bsafehouses?\b|\btaverns?\b|\bwanted posters?\b/i;

/** Every quoted string in the app's own code (comments and regex literals are not copy). */
function appStrings(): { file: string; text: string }[] {
  const root = join(import.meta.dir, '..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name)) files.push(path);
    }
  };
  for (const dir of ['app', 'components', 'lib', 'constants']) walk(join(root, dir));
  return files.flatMap((file) => {
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    return [...code.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((match) => ({ file, text: match[0] }));
  });
}

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

  test('no legacy words in the app\'s own text', () => {
    const hits = appStrings()
      .filter((item) => LEGACY.test(item.text))
      .map((item) => `${item.file.split('/').slice(-2).join('/')}: ${item.text.slice(0, 80)}`);
    expect(hits).toEqual([]);
  });

  test('the narrator gets the player-written world and character as prose', () => {
    const narrator = buildNarrationPrompt(db, 'I look around.').messages.map((message) => message.content).join('\n');
    expect(narrator).toContain('THE WORLD');
    expect(narrator).toContain('WHO YOU ARE');
    expect(narrator).toContain(db.state.player.backstory);
    expect(narrator).not.toMatch(/"\w+":/);
  });
});
