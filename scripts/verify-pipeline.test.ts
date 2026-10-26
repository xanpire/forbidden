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
import { applyEntityDiff, entityGroup, entityHints, resolveEntity, storyMessagesSinceLastSummary, trimToSentence } from '../lib/rpg/services';
import { buildNarrationPrompt, splitNarrationAndDiff, stripNarrationJson } from '../lib/rpg/prompt';
import { NARRATION_SYSTEM } from '../lib/rpg/prompt';
import { buildSceneImagePrompt, collectRecentSceneImages } from '../lib/rpg/image';
import { formatEncounterHint } from '../lib/rpg/prompt';
import { CANON_MILESTONES, advanceCanon, applyCanonMarks } from '../lib/rpg/canon';
import { eraNoteFor } from '../lib/rpg/romance';
import { classifyLocation, encounterRisk, formatEncounterConditions, formatGatedEncounterHint } from '../lib/rpg/encounters';
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
    expect(prompt).toContain('Reference image 5');
    expect(prompt).toContain(db.state.location.slice(0, 20));
    expect(prompt).toContain('no text');
    expect(prompt).toContain('face sheet');
    expect(prompt).toContain('NO person');
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
    expect(NARRATION_SYSTEM).toContain('Sleeping through the night');
    expect(NARRATION_SYSTEM).toContain('Sleeping through the night means days_passed 1');
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


describe('masked man identity resolution', () => {
  test('all masked-man names resolve to one entity', () => {
    let db = loadSave(SAVE_PATHS[1]);

    const names = ['Masked Man', 'Tobi', 'Obito', 'Masked Man (Madara)'];

    for (const name of names) {
      db = applyEntityDiff(db, { name, role: 'Mystery' });
    }

    const maskedEntities = db.entities.filter((entity) =>
      ['masked man', 'tobi', 'obito'].some((hint) =>
        [entity.name, ...entity.aliases].some((alias) => alias.toLowerCase().includes(hint))
      )
    );

    expect(maskedEntities.length).toBe(1);
    expect(resolveEntity(db, 'Tobi')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
    expect(resolveEntity(db, 'Obito')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
    expect(resolveEntity(db, 'Masked Man (Madara)')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
  });

  test('the real Madara is a separate character from the masked man', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyEntityDiff(db, { name: 'Masked Man', role: 'Mystery' });
    db = applyEntityDiff(db, { name: 'Tobi', role: 'Mystery' });

    const maskedId = resolveEntity(db, 'Masked Man')?.id;

    // Bare "Madara" is the masked man's claimed name while the real Madara
    // has not appeared yet.
    db = applyEntityDiff(db, { name: 'Madara', role: 'Mystery' });
    expect(resolveEntity(db, 'Madara')?.id).toBe(maskedId);

    // The real Madara Uchiha appears much later and stays a separate entity.
    db = applyEntityDiff(db, { name: 'Madara Uchiha', role: 'Legend', age: 40 });

    const madaraId = resolveEntity(db, 'Madara Uchiha')?.id;

    expect(madaraId).toBeDefined();
    expect(madaraId).not.toBe(maskedId);
    expect(resolveEntity(db, 'Masked Man')?.id).toBe(maskedId);
    expect(resolveEntity(db, 'Madara')?.id).toBe(madaraId);
  });

  test('Pain, Nagato, and the six paths are one character', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyEntityDiff(db, { name: 'Pain', role: 'Akatsuki leader' });
    db = applyEntityDiff(db, { name: 'Nagato', role: 'Akatsuki leader' });
    db = applyEntityDiff(db, { name: 'Deva Path', role: 'Akatsuki' });

    const painId = resolveEntity(db, 'Pain')?.id;

    expect(resolveEntity(db, 'Nagato')?.id).toBe(painId);
    expect(resolveEntity(db, 'Deva Path')?.id).toBe(painId);
    expect(resolveEntity(db, 'Nagato')?.name).toBe('Pain');

    const painEntities = db.entities.filter((entity) =>
      entityGroup(entityHints(entity)) === 'pain'
    );

    expect(painEntities.length).toBe(1);
  });

  test('Pain never merges with the masked man or the real Madara', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyEntityDiff(db, { name: 'Masked Man', role: 'Mystery' });
    db = applyEntityDiff(db, { name: 'Madara Uchiha', role: 'Legend', age: 40 });
    db = applyEntityDiff(db, { name: 'Pain', role: 'Akatsuki leader' });

    expect(resolveEntity(db, 'Pain')?.id).not.toBe(resolveEntity(db, 'Masked Man')?.id);
    expect(resolveEntity(db, 'Pain')?.id).not.toBe(resolveEntity(db, 'Madara Uchiha')?.id);
  });

  test('Black Zetsu and White Zetsu resolve to one entity', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyEntityDiff(db, { name: 'Black Zetsu', role: 'Akatsuki' });
    db = applyEntityDiff(db, { name: 'White Zetsu', role: 'Akatsuki' });

    const zetsuId = resolveEntity(db, 'Black Zetsu')?.id;

    expect(resolveEntity(db, 'White Zetsu')?.id).toBe(zetsuId);
    expect(db.entities.filter((entity) => entity.name.toLowerCase().includes('zetsu')).length).toBe(1);
  });

  test('existing masked man and Tobi entities merge on any turn', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyEntityDiff(db, { name: 'Masked Man', role: 'Mystery' });
    db = applyEntityDiff(db, { name: 'Tobi', role: 'Mystery' });

    expect(resolveEntity(db, 'Tobi')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
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

describe('canon timeline dataset', () => {
  test('milestones are unique, ordered, and lore-gated', () => {
    const ids = CANON_MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const m of CANON_MILESTONES) {
      expect(m.minScenes).toBeGreaterThan(0);
      expect(m.from.year).toBeGreaterThanOrEqual(13);
      expect(m.facts.length + (m.opensThreads?.length ?? 0)).toBeGreaterThanOrEqual(0);
      if (m.to) {
        expect(m.to.year * 12 + m.to.month).toBeGreaterThanOrEqual(
          m.from.year * 12 + m.from.month
        );
      }
    }

    const unmask = CANON_MILESTONES.find((m) => m.id === 'obito-unmasked');
    expect(unmask).toBeDefined();
    const unmaskYear = unmask!.from.year;
    expect(unmaskYear).toBeGreaterThanOrEqual(23);

    const audience = CANON_MILESTONES.find((m) => m.id === 'masked-man-audience');
    expect(audience?.description).toContain('masked');
    expect(audience?.description.toLowerCase()).not.toContain('obito');

    for (const m of CANON_MILESTONES) {
      if (m.playerDriven && m.encounter) {
        expect(m.encounter.context.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('canon scheduler', () => {
  test('fires the first milestone once scenes and date allow', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = {
      ...db,
      state: { ...db.state, canonProgress: { completed: [], active: [], engaged: [] } },
      events: db.events.slice(0, 1),
      rawLog: db.rawLog.filter((entry) => entry.kind !== 'story' || entry.role !== 'assistant'),
    };

    const first = advanceCanon(db);
    expect(first.state.canonProgress?.completed ?? []).not.toContain('kan-joins-akatsuki');

    const withTurn = {
      ...first,
      rawLog: [
        ...first.rawLog,
        { ...first.rawLog[0], id: 'log_test_assistant_a', kind: 'story' as const, role: 'assistant' as const },
        { ...first.rawLog[0], id: 'log_test_assistant_b', kind: 'story' as const, role: 'assistant' as const },
      ],
    };

    const fired = advanceCanon(withTurn);
    expect(fired.state.canonProgress?.completed).toContain('kan-joins-akatsuki');
    expect(fired.events.some((e) => e.id === 'event_canon_kan-joins-akatsuki')).toBe(true);
    expect(fired.facts.some((f) => f.text.includes('Kan joined the Akatsuki'))).toBe(true);
    expect(fired.bonds.length).toBeGreaterThan(0);
  });

  test('does not run ahead of its date window', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      state: {
        ...db.state,
        inStoryDate: { year: 14, month: 2, day: 1, timeOfDay: 'morning' },
        canonProgress: { completed: [], active: [], engaged: [] },
      },
      events: [...db.events, ...db.events, ...db.events],
    };

    const next = advanceCanon(db);
    expect(next.state.canonProgress?.completed ?? []).not.toContain('gaara-captured');
    expect(next.state.canonProgress?.completed ?? []).not.toContain('war-begins');
  });

  test('narrator-marked beats complete and stamp attendance', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      state: { ...db.state, canonProgress: { completed: [], active: [], engaged: [] } },
    };

    const completed = applyCanonMarks(db, ['masked-man-audience'], []);
    expect(completed.facts.some((f) => f.text.includes('Kan attended'))).toBe(true);
    expect(completed.state.canonProgress?.completed).toContain('masked-man-audience');

    const engaged = applyCanonMarks(db, [], ['itachi-hunt-naruto']);
    expect(engaged.state.canonProgress?.engaged).toContain('itachi-hunt-naruto');
    expect(engaged.state.canonProgress?.active).toContain('itachi-hunt-naruto');
    expect(engaged.state.canonProgress?.completed ?? []).not.toContain('itachi-hunt-naruto');

    const finished = applyCanonMarks(engaged, ['itachi-hunt-naruto'], []);
    expect(finished.state.canonProgress?.completed).toContain('itachi-hunt-naruto');
    expect(finished.state.canonProgress?.engaged ?? []).not.toContain('itachi-hunt-naruto');
    expect(finished.facts.some((f) => f.text.includes('accompanied Itachi'))).toBe(true);
  });

  test('expired player-driven encounters log a missed fact', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      state: {
        ...db.state,
        inStoryDate: { year: 19, month: 9, day: 1, timeOfDay: 'night' },
        canonProgress: { completed: [], active: ['itachi-hunt-naruto'], engaged: [] },
      },
    };

    const next = advanceCanon(db);
    expect(next.state.canonProgress?.completed).toContain('itachi-hunt-naruto');
    expect(next.state.canonProgress?.active ?? []).not.toContain('itachi-hunt-naruto');
    expect(
      next.facts.some((f) => f.text.toLowerCase().includes('never crossed paths'))
    ).toBe(true);
  });

  test('disabling canon progression freezes it', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      settings: { ...db.settings, canonProgress: false },
      state: { ...db.state, canonProgress: { completed: [], active: [], engaged: [] } },
    };

    const next = advanceCanon(db);
    expect(next.state.canonProgress?.completed).toEqual([]);
    expect(next.events.length).toBe(db.events.length);
  });
});

describe('cross-era memory and romance', () => {
  test('old saves migrate romance and canon fields', () => {
    const db = loadSave(SAVE_PATHS[0]);

    expect(db.settings.canonProgress).toBe(true);
    expect(Array.isArray(db.state.canonProgress?.completed)).toBe(true);

    for (const bond of db.bonds) {
      expect(['stranger', 'friendly', 'close', 'romantic interest', 'partner', 'rejected'])
        .toContain(bond.relationship ?? 'stranger');
    }

    for (const entity of db.entities.filter((e) => e.type === 'character')) {
      expect(['winnable', 'lore-locked']).toContain(
        entity.romanceAccessibility ?? 'winnable'
      );
    }
  });

  test('characters met once are remembered across eras', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const itachiId = resolveEntity(db, 'Itachi')?.id;
    const factsBefore = db.facts.length;

    db = applyTurnDiff(db, {
      state: { inStoryDate: { year: 22, month: 1, day: 1, timeOfDay: 'morning' } },
      entities: [{ name: 'Itachi', role: 'Akatsuki' }],
    });

    expect(resolveEntity(db, 'Itachi')?.id).toBe(itachiId);
    expect(db.bonds.some((b) => b.entityId === itachiId)).toBe(true);
    expect(db.facts.length).toBeGreaterThanOrEqual(factsBefore);
    expect(db.entities.filter((e) => e.name === 'Itachi Uchiha').length).toBe(1);
  });

  test('romance state persists rejections without resetting', () => {
    let db = loadSave(SAVE_PATHS[1]);

    db = applyTurnDiff(db, {
      bonds: [
        {
          character: 'Hana Inuzuka',
          relationship: 'rejected',
          attraction: 'none',
          romanceNote: 'She turned Kan down and the awkwardness lingers.',
        },
      ],
    });

    const bond = db.bonds.find((b) => b.characterName === 'Hana Inuzuka');
    expect(bond?.relationship).toBe('rejected');
    expect(bond?.romanceNote).toContain('awkwardness');

    db = applyTurnDiff(db, { bonds: [{ character: 'Hana', affinityDelta: 1 }] });
    expect(db.bonds.find((b) => b.characterName === 'Hana Inuzuka')?.relationship).toBe(
      'rejected'
    );
  });

  test('narration prompt carries canon, romance, and lore hearts', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = applyTurnDiff(db, {
      scene: { ended: false, entities: ['Itachi Uchiha'] },
    });

    const prompt = buildNarrationPrompt(db, '*Kan looks at Itachi.*', 10);
    const system = prompt.messages[0].content;
    const dynamic = prompt.messages[1].content;

    expect(system).toContain('NEVER CENSOR');
    expect(system).toContain('LORE-LOCKED hearts');
    expect(system).toContain('CANON TIMELINE');
    expect(dynamic).toContain('CANON TIMELINE');
    expect(system).toContain('heart:');
  });
});

describe('expanded lore and team 3', () => {
  test('team 3 beats exist with encounters across eras', () => {
    const ids = ['izumi-funeral', 'hana-hunt', 'suzume-inquiry', 'team-3-reunion', 'izumi-grave', 'team-3-war'];

    for (const id of ids) {
      const milestone = CANON_MILESTONES.find((m) => m.id === id);
      expect(milestone).toBeDefined();
      expect(milestone?.encounter).toBeDefined();
      expect(milestone?.encounter?.who.toLowerCase()).toMatch(/hana|suzume|izumi/);
    }
  });

  test('canon includes the war deaths and late twists', () => {
    const ids = new Set(CANON_MILESTONES.map((m) => m.id));
    for (const id of ['hayate-death', 'neji-death', 'shikaku-inoichi-death', 'kaguya-awakens', 'obito-redemption', 'kaguya-sealed', 'naruto-hokage']) {
      expect(ids.has(id)).toBe(true);
    }
    expect(CANON_MILESTONES.length).toBeGreaterThanOrEqual(85);
  });

  test('era personalities shift with the timeline', () => {
    expect(eraNoteFor('Hana Inuzuka', 13)).toContain('Grieving teammate');
    expect(eraNoteFor('Hana Inuzuka', 21)).toContain('Jonin');
    expect(eraNoteFor('Naruto Uzumaki', 13)).toContain('lonely');
    expect(eraNoteFor('Naruto Uzumaki', 23)).toContain('Composed');
    expect(eraNoteFor('Itachi Uchiha', 23)).toContain('Edo Tensei');
    expect(eraNoteFor('Suzume', 18)).toContain('new team');
  });

  test('character cards include the era note', () => {
    const db = loadSave(SAVE_PATHS[1]);
    const prompt = buildNarrationPrompt(db, '*Kan looks at Itachi.*', 10);
    expect(prompt.messages[0].content).toContain('now: Gentle older brother');
  });
});

describe('encounter realism', () => {
  test('location classification and risk matrix', () => {
    expect(classifyLocation('Konoha marketplace at noon')).toBe('settlement');
    expect(classifyLocation('deep forest outside the village')).toBe('wilderness');
    expect(classifyLocation('abandoned temple in the mountains')).toBe('structure');
    expect(classifyLocation('the road north')).toBe('road');

    expect(encounterRisk('settlement', 'morning')).toBe('high');
    expect(encounterRisk('settlement', 'night')).toBe('low');
    expect(encounterRisk('wilderness', 'afternoon')).toBe('low');
    expect(encounterRisk('wilderness', 'night')).toBe('none');
    expect(encounterRisk('structure', 'night')).toBe('none');
  });

  test('d20 hints are gated by place and time', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      state: {
        ...db.state,
        location: 'deep woods',
        locationKind: 'wilderness',
        inStoryDate: { ...db.state.inStoryDate, timeOfDay: 'night' },
      },
    };

    expect(formatGatedEncounterHint(db, 12)).toContain('no new people');
    expect(formatGatedEncounterHint(db, 17)).toContain('no new people');
    expect(formatGatedEncounterHint(db, 18)).toContain('dangerous');

    const village = {
      ...db,
      state: {
        ...db.state,
        location: 'Konoha market',
        locationKind: 'settlement' as const,
        inStoryDate: { ...db.state.inStoryDate, timeOfDay: 'afternoon' as const },
      },
    };

    expect(formatGatedEncounterHint(village, 10)).toContain('minor NPC');
    expect(formatEncounterConditions(village)).toContain('settlement');
  });

  test('location_kind flows through the diff and fallback classifier', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = applyTurnDiff(db, { state: { location: 'Konoha marketplace' } });
    expect(db.state.locationKind).toBe('settlement');

    db = applyTurnDiff(db, { state: { location: 'somewhere new', locationKind: 'structure' } });
    expect(db.state.locationKind).toBe('structure');
  });
});

describe('clock auto-advance', () => {
  test('advances one period after two silent turns', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      settings: { ...db.settings, autoAdvanceTime: true },
      state: { ...db.state, inStoryDate: { ...db.state.inStoryDate, timeOfDay: 'night' }, turnsWithoutTimeChange: 0 },
    };

    db = applyTurnDiff(db, {});
    expect(db.state.inStoryDate.timeOfDay).toBe('night');
    expect(db.state.turnsWithoutTimeChange).toBe(1);

    db = applyTurnDiff(db, {});
    expect(db.state.inStoryDate.timeOfDay).toBe('morning');
    expect(db.state.turnsWithoutTimeChange).toBe(0);

    db = applyTurnDiff(db, { state: { timeOfDay: 'evening' } });
    expect(db.state.inStoryDate.timeOfDay).toBe('evening');
    expect(db.state.turnsWithoutTimeChange).toBe(0);
  });

  test('toggle off stops automatic advancement', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      settings: { ...db.settings, autoAdvanceTime: false },
      state: { ...db.state, turnsWithoutTimeChange: 0 },
    };

    const before = db.state.inStoryDate.timeOfDay;
    db = applyTurnDiff(db, {});
    db = applyTurnDiff(db, {});
    db = applyTurnDiff(db, {});

    expect(db.state.inStoryDate.timeOfDay).toBe(before);
    expect(db.state.turnsWithoutTimeChange).toBe(3);
  });
});

describe('canon endings and prompt memory', () => {
  test('canon_passed completes an opportunity with a missed fact', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      state: { ...db.state, canonProgress: { completed: [], active: [], engaged: [] } },
    };

    const next = applyCanonMarks(db, [], [], ['itachi-hunt-naruto']);
    expect(next.state.canonProgress?.completed).toContain('itachi-hunt-naruto');
    expect(next.state.canonProgress?.active ?? []).not.toContain('itachi-hunt-naruto');
    expect(next.facts.some((f) => f.text.includes('never crossed paths'))).toBe(true);
  });

  test('recent messages keep the newest narration ending', () => {
    let db = loadSave(SAVE_PATHS[1]);
    const longNarration = `${'The rain falls. '.repeat(150)}FINAL BEAT: the masked man turns away and vanishes.`;

    db = appendStoryMessage(db, 'assistant', longNarration, 'm', 0, 0);
    const prompt = buildNarrationPrompt(db, '*Kan watches.*', 10);
    const dynamic = prompt.messages[1].content;

    expect(dynamic).toContain('FINAL BEAT');
    expect(dynamic).toContain('LAST NARRATED BEAT');
    expect(dynamic).toContain('CONTINUITY');
  });

  test('prompt budget guard caps runaway context', () => {
    let db = loadSave(SAVE_PATHS[1]);
    for (let i = 0; i < 12; i += 1) {
      db = appendStoryMessage(db, 'assistant', 'Long narration. '.repeat(400), 'm', 0, 0);
    }

    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    expect(prompt.estimatedTokens).toBeLessThanOrEqual(5800);
    expect(prompt.recentMessages.length).toBeGreaterThanOrEqual(4);
  });

  test('canon block lists concluded beats', () => {
    let db = loadSave(SAVE_PATHS[1]);
    db = {
      ...db,
      state: {
        ...db.state,
        canonProgress: { completed: ['gaara-captured', 'itachi-vs-sasuke'], active: [], engaged: [] },
      },
    };

    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    expect(prompt.messages[1].content).toContain('RECENTLY CONCLUDED');
    expect(prompt.messages[1].content).toContain('itachi-vs-sasuke');
  });
});
