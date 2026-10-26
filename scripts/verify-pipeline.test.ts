import { describe, expect, test, mock } from 'bun:test';
import { readFileSync } from 'fs';

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

import { buildIndices, normalizeDatabase } from '../lib/rpg/db';
import { daysBetween } from '../lib/rpg/calendar';
import { storyMessagesSinceLastSummary, trimToSentence } from '../lib/rpg/services';
import { buildNarrationPrompt, splitNarrationAndDiff, stripNarrationJson } from '../lib/rpg/prompt';
import { NARRATION_SYSTEM } from '../lib/rpg/prompt';
import { buildSceneImagePrompt, collectRecentSceneImages } from '../lib/rpg/image';
import { formatEncounterHint } from '../lib/rpg/prompt';
import {
  appendStoryMessage,
  applyTurnDiff,
  cloneDatabase,
  convertInlineDiff,
} from '../lib/rpg/services';
import { rollD20 } from '../lib/rpg/services';
import type { AppDatabase, TurnDiff } from '../lib/rpg/types';

const SAVE_PATHS = [
  'saves/kan-story-Main_Story.json',
  'saves/kan-story-Main_Story-clean.json',
];

function loadSave(path: string): AppDatabase {
  const raw = readFileSync(path, 'utf8');
  return normalizeDatabase(JSON.parse(raw) as AppDatabase);
}

describe('save file compatibility', () => {
  for (const path of SAVE_PATHS) {
    test(`loads and normalizes ${path}`, () => {
      const db = loadSave(path);

      expect(db.state).toBeDefined();
      expect(db.state.player).toBeDefined();
      expect(Array.isArray(db.rawLog)).toBe(true);
      expect(Array.isArray(db.bonds)).toBe(true);
      expect(Array.isArray(db.jutsuRecords)).toBe(true);

      for (const entity of db.entities) {
        expect(Array.isArray(entity.aliases)).toBe(true);
      }

      for (const fact of db.facts) {
        expect(Array.isArray(fact.whoKnows)).toBe(true);
      }
    });

    test(`${path} has no JSON pollution in assistant messages`, () => {
      const db = loadSave(path);

      for (const entry of db.rawLog) {
        if (entry.kind === 'story' && entry.role === 'assistant' && entry.content) {
          const { narration } = splitNarrationAndDiff(entry.content);
          expect(narration).toBe(entry.content);
          expect(entry.content.includes('```')).toBe(false);
        }
      }
    });
  }
});

describe('inline diff wiring', () => {
  test('jutsu_used creates jutsu records', () => {
    const db = loadSave(SAVE_PATHS[1]);
    const { diff } = convertInlineDiff({
      state: { location: 'Training field' },
      jutsu_used: [
        {
          name: 'Fire Release: Great Fireball',
          user: 'Kan',
          chakra_nature: 'Fire',
          effect: 'A large sphere of fire.',
          visual: 'A cone of roaring flames.',
        },
      ],
    });

    expect(diff).not.toBeNull();
    expect(diff?.jutsuUsed?.length).toBe(1);

    const next = applyTurnDiff(db, diff);
    const record = next.jutsuRecords.find(
      (item) => item.name === 'Fire Release: Great Fireball' && item.user === 'Kan'
    );

    expect(record).toBeDefined();
    expect(record?.chakraNature).toBe('Fire');
    expect(record?.timesUsed).toBe(1);
  });

  test('bonds accumulate and clamp, repeated threads dedupe', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const threadsBefore = db.threads.length;

    db = applyTurnDiff(db, {
      bonds: [{ character: 'Itachi Uchiha', affinityDelta: 3, status: 'Ally', note: 'Trained together' }],
      facts: [{ action: 'add', type: 'event', text: 'Kan trained with Itachi at dawn.', subject: 'Kan' }],
      threads: [{ action: 'update', title: 'Find a reason to keep going after the massacre', description: 'Find a reason to keep going after the massacre', type: 'goal' }],
    });

    db = applyTurnDiff(db, {
      bonds: [{ character: 'Itachi Uchiha', affinityDelta: 2 }],
      threads: [{ action: 'update', title: 'Find a reason to keep going', description: 'Find a reason to keep going', type: 'goal' }],
    });

    const bond = db.bonds.find((item) => item.characterName === 'Itachi Uchiha');
    expect(bond?.affinity).toBeGreaterThanOrEqual(3);
    expect(db.threads.filter((item) => item.status === 'open').length).toBeLessThanOrEqual(
      threadsBefore + 1
    );
  });

  test('state strings and lists stay capped', () => {
    let db = loadSave(SAVE_PATHS[1]);

    for (let turn = 0; turn < 40; turn += 1) {
      const diff: TurnDiff = {
        state: {
          worldDescription: 'A very long world description. '.repeat(30),
          canonPoint: 'A very long canon point. '.repeat(30),
          location: `Location variant ${turn}`,
          inventoryAdded: [`item ${turn}`],
          jutsuAdded: [`jutsu ${turn}`],
        },
        facts: [{ action: 'add', type: 'event', text: `Fact number ${turn} happened.`, subject: 'Kan' }],
      };

      db = applyTurnDiff(db, diff);
    }

    expect(db.state.inventory.length).toBeLessThanOrEqual(12);
    expect(db.state.jutsu.length).toBeLessThanOrEqual(12);
    expect(db.state.worldDescription.length).toBeLessThanOrEqual(220);
    expect(db.state.canonPoint.length).toBeLessThanOrEqual(220);
    expect(db.state.location.length).toBeLessThanOrEqual(100);
  });
});

describe('prompt token stability', () => {
  test('tokens plateau as the story grows', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const story = () => db.rawLog.filter((message) => message.kind === 'story');

    const tokensAt: Array<[number, number]> = [];
    const totalTurns = 60;

    for (let turn = 0; turn < totalTurns; turn += 1) {
      const userText = `"We should keep moving." *Kan adjusts his pack and scans the treeline.* (turn ${turn})`;
      const narrationBody = [
        `The wind carries ash from the valley as you push through the undergrowth. Itachi walks half a step ahead, his crimson eyes tracking movement you cannot see. Somewhere behind, the hounds have lost the scent — for now.`,
        `You cross a stream, cold water biting through worn tabi, and climb the far bank into deeper shadow. Hana's voice still echoes somewhere in your memory, sharp with accusation.`,
        `Itachi stops. He tilts his head, listening. A crow bursts from the canopy above and wheels east, against the wind. Turn ${turn}, and the road grows no shorter.`,
      ].join(' ');
      const narration =
        turn % 3 === 0
          ? `${narrationBody}\n\n\`\`\`json\n{"state":{"location":"High ridge above the stream"},"facts":[{"entity":"Kan","fact":"Crossed the stream at dawn on turn ${turn}."}]}\n\`\`\``
          : narrationBody;

      db = appendStoryMessage(cloneDatabase(db), 'user', userText, 'm', 0, 0);
      const { narration: clean, inlineDiff } = splitNarrationAndDiff(narration);
      db = appendStoryMessage(db, 'assistant', clean, 'm', 3000, 400);

      const { diff } = convertInlineDiff(inlineDiff);
      const fallback: TurnDiff = diff ?? {
        facts: [{ action: 'add', type: 'event', text: `Quiet turn ${turn}: nothing of note.`, subject: 'Kan' }],
      };

      if (turn % 5 === 0) {
        fallback.threads = [
          { action: 'update', title: `Open question raised on turn ${turn}`, description: `Open question raised on turn ${turn}`, type: 'mystery' },
        ];
      }

      if (turn % 6 === 0) {
        fallback.entities = [
          { name: `Scout ${turn}`, age: 20 + (turn % 10), role: 'Hunter-nin', personality: 'Cold, precise', speechStyle: 'Clipped', mood: 'Wary', appearance: 'Masked, grey cloak' },
        ];
      }

      if (turn % 7 === 0) {
        fallback.jutsuUsed = [
          { name: `Wind Scythe ${turn}`, user: 'Kan', chakraNature: 'Wind', effect: 'Slashes of compressed air.', visual: 'Curved white arcs.' },
        ];
      }

      db = applyTurnDiff(db, fallback);

      if (turn % 10 === 0 || turn === totalTurns - 1) {
        const prompt = buildNarrationPrompt(db, userText, rollD20());
        tokensAt.push([turn, prompt.estimatedTokens]);
      }
    }

    const first = tokensAt[0][1];
    const last = tokensAt[tokensAt.length - 1][1];
    const growth = (last - first) / first;

    console.log(
      'token samples:',
      tokensAt.map(([turn, tokens]) => `turn ${turn}: ${tokens}`).join(' | ')
    );

    expect(growth).toBeLessThan(0.35);
  });
});
describe('narration JSON stripping edge cases', () => {
  const cases: Array<[string, string, string | null]> = [
    ['complete fenced block', 'Story text.\n\n\`\`\`json\n{"state":{"location":"X"}}\n\`\`\`', 'state'],
    ['truncated fenced block', 'Story text.\n\n\`\`\`json\n{"state":{"location":"X"},"facts":[', null],
    ['unparseable fenced block', 'Story.\n\n\`\`\`json\n{broken json "state": [', null],
    ['unfenced complete JSON', 'Story. {"state":{"location":"Y"}}', 'state'],
    ['unfenced truncated JSON', 'Story. {"state":{"location":"Y", "canon_point":', null],
    ['trailing label', 'Story.\n\nState update:', null],
    ['no JSON at all', 'Just a story paragraph.', null],
  ];

  for (const [name, raw, diffKey] of cases) {
    test(name, () => {
      const { narration, inlineDiff } = splitNarrationAndDiff(raw);

      expect(narration.includes('\u0060\u0060\u0060')).toBe(false);
      expect(narration.includes('"state"')).toBe(false);
      expect(narration.includes('State update')).toBe(false);
      expect(stripNarrationJson(raw)).toBe(narration);

      if (diffKey) {
        expect(inlineDiff).not.toBeNull();
        expect(Object.keys(inlineDiff ?? {})).toContain(diffKey);
      }
    });
  }
});

describe('image reference pipeline', () => {
  test('prompt numbers references dynamically and carries scene data', () => {
    const db = loadSave(SAVE_PATHS[1]);
    const recent = ['data:image/jpeg;base64,AAA', 'data:image/jpeg;base64,BBB'];
    const prompt = buildSceneImagePrompt(db, recent);

    expect(prompt).toContain('Reference image 1: a previous scene image');
    expect(prompt).toContain('Reference image 6');
    expect(prompt).toContain(db.state.location.slice(0, 20));
    expect(prompt).toContain('no text');
  });

  test('recent images collect from assistant messages in order', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = appendStoryMessage(db, 'assistant', 'First scene.', 'm', 0, 0);
    db = appendStoryMessage(db, 'assistant', 'Second scene.', 'm', 0, 0);
    db = appendStoryMessage(db, 'assistant', 'Third scene.', 'm', 0, 0);
    db = {
      ...db,
      rawLog: db.rawLog.map((entry, index) =>
        entry.kind === 'story' && entry.role === 'assistant'
          ? { ...entry, image: `data:image/jpeg;base64,IMG${index}` }
          : entry
      ),
    };

    const recent = collectRecentSceneImages(db);
    expect(recent.length).toBe(2);
  });
});

describe('time progression via inline diffs', () => {
  test('days_passed and time_of_day advance the date', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const before = db.state.inStoryDate;

    const { diff } = convertInlineDiff({
      time: { days_passed: 3, time_of_day: 'morning' },
      mood: 'Weary but resolute',
    });

    expect(diff).not.toBeNull();

    db = applyTurnDiff(db, diff);

    expect(daysBetween(before, db.state.inStoryDate)).toBe(3);
    expect(db.state.inStoryDate.timeOfDay).toBe('morning');
    expect(db.state.mood).toBe('Weary but resolute');
  });

  test('time_of_day alone shifts only the time of day', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const before = { ...db.state.inStoryDate };

    db = applyTurnDiff(db, {
      state: { timeOfDay: 'evening' },
    });

    expect(db.state.inStoryDate.day).toBe(before.day);
    expect(db.state.inStoryDate.timeOfDay).toBe('evening');
  });

  test('absolute inStoryDate from extraction still works and ages NPCs', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const yearBefore = db.state.inStoryDate.year;
    const agable = db.entities.find((e) => e.type === 'character' && e.birthYear === undefined && e.age !== undefined);

    db = applyTurnDiff(db, {
      state: { inStoryDate: { year: yearBefore + 1, month: 1, day: 1, timeOfDay: 'morning' } },
    });

    expect(db.state.inStoryDate.year).toBe(yearBefore + 1);

    if (agable) {
      const after = db.entities.find((e) => e.id === agable.id);
      expect(after?.age).toBe((agable.age ?? 0) + 1);
    }
  });

  test('scene_ended inline diff records a memory event', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const eventsBefore = db.events.length;

    const { diff } = convertInlineDiff({ scene_ended: true });

    expect(diff?.scene?.ended).toBe(true);

    db = applyTurnDiff(db, diff);

    expect(db.events.length).toBe(eventsBefore + 1);
  });
});

describe('summarize cadence', () => {
  test('counts only messages since the last chapter summary', () => {
    let db = loadSave(SAVE_PATHS[1]);

    for (let i = 0; i < 14; i += 1) {
      db = appendStoryMessage(db, 'user', `msg ${i}`, 'm', 0, 0);
    }

    const sinceBefore = storyMessagesSinceLastSummary(db);
    expect(sinceBefore).toBeGreaterThan(12);

    const now = Date.now();
    db = {
      ...db,
      summaries: [
        ...db.summaries,
        {
          id: 'summary_test',
          level: 'chapter' as const,
          range: { fromEventId: '', toEventId: '', from: db.state.inStoryDate, to: db.state.inStoryDate },
          text: 'A fresh summary resetting the cadence.',
          tokenCount: 10,
          eventIds: [],
          createdAt: now,
        },
      ],
    };

    expect(storyMessagesSinceLastSummary(db)).toBe(0);
  });
});

describe('summary text hygiene', () => {
  test('trims mid-sentence truncation to the last complete sentence', () => {
    const cut = 'Kan fled through the rain. Itachi followed without a word and the boar-masked ANBU captain attacked with Fire Style, but';
    const trimmed = trimToSentence(cut);

    expect(trimmed.endsWith('but')).toBe(false);
    expect(trimmed).toBe('Kan fled through the rain.');
  });

  test('keeps complete text intact', () => {
    const full = 'Kan fled through the rain. Itachi followed without a word.';
    expect(trimToSentence(full)).toBe(full);
  });

  test('strips stray code fences and label lines', () => {
    expect(trimToSentence('A clean summary.\n\n```json')).toBe('A clean summary.');
    expect(trimToSentence('Chapter summary:\nAnother sentence here.')).toBe('Another sentence here.');
  });

  test('save summaries all end at sentence boundaries', () => {
    const db = loadSave(SAVE_PATHS[1]);

    for (const summary of db.summaries) {
      expect(/[.!?\"]$/.test(summary.text.trim())).toBe(true);
    }
  });
});

describe('presence tracking and bonds ordering', () => {
  test('characters_present marks entities as seen', () => {
    let db = loadSave(SAVE_PATHS[1]);

    const { diff } = convertInlineDiff({
      characters_present: ['Itachi Uchiha'],
      time: { days_passed: 2, time_of_day: 'morning' },
    });

    db = applyTurnDiff(db, diff);

    const itachi = db.entities.find((entity) => entity.name === 'Itachi Uchiha');

    expect(itachi?.lastSeen).toBeDefined();
    expect(itachi?.lastSeen?.day).toBe(db.state.inStoryDate.day);
    expect(itachi?.lastSeen?.timeOfDay).toBe('morning');
  });

  test('sleeping through the night advances exactly one day to morning', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const before = db.state.inStoryDate;

    const { diff } = convertInlineDiff({
      time: { days_passed: 1, time_of_day: 'morning' },
    });

    db = applyTurnDiff(db, diff);

    expect(daysBetween(before, db.state.inStoryDate)).toBe(1);
    expect(db.state.inStoryDate.timeOfDay).toBe('morning');
  });

  test('narration schema documents sleep and characters_present', () => {
    expect(NARRATION_SYSTEM).toContain('characters_present');
    expect(NARRATION_SYSTEM).toContain('sleeps through the night');
    expect(NARRATION_SYSTEM).toContain('days_passed is 1');
  });

  test('narration prompt does not duplicate the current action', () => {
    const db = loadSave(SAVE_PATHS[1]);
    const action = '"We move at dawn." *Kan checks his pack.*';

    const prompt = buildNarrationPrompt(db, action, 10);
    const dynamic = prompt.messages[1].content;

    const occurrences = dynamic.split(action).length - 1;

    expect(occurrences).toBe(1);
  });
});

describe('encounter frequency and image cast', () => {
  test('most d20 rolls yield a quiet turn', () => {
    const quiet = [1, 4, 7, 9, 11, 12].every((roll) => formatEncounterHint(roll).includes('quiet'));
    const minor = formatEncounterHint(14).includes('minor NPC');
    const named = formatEncounterHint(18).includes('named canon character');
    const major = formatEncounterHint(20).includes('major canon event');

    expect(quiet).toBe(true);
    expect(minor).toBe(true);
    expect(named).toBe(true);
    expect(major).toBe(true);
  });

  test('image prompt forbids characters from previous images and lists the cast', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyTurnDiff(db, {
      scene: { ended: false, entities: ['Itachi Uchiha'] },
      state: { advanceDays: 0 },
    });

    const prompt = buildSceneImagePrompt(db, ['data:image/jpeg;base64,AAA']);

    expect(prompt).toContain('must NOT appear now');
    expect(prompt).toContain('Itachi Uchiha');
    expect(prompt).toContain('only the cast listed below may appear');
  });

  test('saves have no duplicate tobi/madara entities', () => {
    const db = loadSave(SAVE_PATHS[1]);
    const matches = db.entities.filter((entity) => /tobi|madara/i.test(entity.name));
    expect(matches.length).toBeLessThanOrEqual(1);
    expect(matches[0]?.aliases.map((a) => a.toLowerCase())).toContain('tobi');
  });
});
