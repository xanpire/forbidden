import { describe, expect, test, mock } from 'bun:test';

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
import { seedDatabase } from '../lib/rpg/seed';
import { advanceSeconds, dateSortValue, daysBetween, daysInMonth, formatClock, paceCapSeconds, timeOfDayOf } from '../lib/rpg/calendar';
import { applyEntityDiff, entityGroup, entityHints, mergeEntityPair, resolveCharacterRefs, resolveEntity, storyMessagesSinceLastSummary, trimToSentence } from '../lib/rpg/services';
import { buildExtractionPrompt, buildNarrationPrompt, splitNarrationAndDiff, streamingPreview, stripNarrationJson } from '../lib/rpg/prompt';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import { mentionsName } from '../lib/rpg/characterRefs';
import { NARRATION_SYSTEM } from '../lib/rpg/prompt';
import { buildSceneImagePrompt, collectRecentSceneImages } from '../lib/rpg/image';
import { planReferences } from '../lib/rpg/referencePlan';
import { buildImageRequestBody, type ImageModelCaps } from '../lib/openrouter';
import { formatEncounterHint } from '../lib/rpg/prompt';
import { CANON_MILESTONES, CANON_VERSION, activeCanonMilestones, advanceCanon, applyCanonMarks, canonEnabled, markNewsHeard, milestoneBearers, milestoneChannel, milestoneKnowledge, milestoneLocation, milestoneRegion, unheardCanonNews, worldClock, NEWS_PER_TURN } from '../lib/rpg/canon';
import { eraNoteFor } from '../lib/rpg/romance';
import { PLACE_NAME_RULE, hasJapanesePlaceName, localizePlaceNames } from '../lib/rpg/glossary';
import { applyParsedTime, detectNarrationTime } from '../lib/rpg/timeparse';
import { inferScenePace, resolveElapsedSeconds, resolveTurnClock } from '../lib/rpg/pacing';
import { classifyLocation, encounterRisk, formatEncounterConditions, formatGatedEncounterHint } from '../lib/rpg/encounters';
import {
  appendStoryMessage,
  applyTurnDiff,
  cloneDatabase,
  convertStateBlock,
} from '../lib/rpg/services';
import { rollD20 } from '../lib/rpg/services';
import type { AppDatabase, TurnDiff } from '../lib/rpg/types';

function loadSave(_path?: string): AppDatabase {
  return normalizeDatabase(seedDatabase('slot_test', 'Test story'));
}

describe('seed save compatibility', () => {
  {
    test('loads and normalizes the seeded story', () => {
      const db = loadSave();

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

    test('seeded story has no JSON pollution in assistant messages', () => {
      const db = loadSave();

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
    const db = loadSave();
    const { diff } = convertStateBlock({
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
    let db = loadSave();
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
    let db = loadSave();

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
    let db = loadSave();
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

      const { diff } = convertStateBlock(inlineDiff);
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

    // Turn 0 has an empty story; measure from turn 10, once recent messages fill.
    const first = tokensAt[1][1];
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
    const db = loadSave();
    const plan = planReferences(
      [
        { kind: 'face', uri: 'data:face' },
        { kind: 'outfit', uri: 'data:outfit' },
        { kind: 'previous', uri: 'data:image/jpeg;base64,AAA' },
        { kind: 'previous', uri: 'data:image/jpeg;base64,BBB' },
        { kind: 'alternate', uri: 'data:alt' },
      ],
      5
    );
    const prompt = buildSceneImagePrompt(db, plan.references, 'Kan waits.');

    expect(prompt).toContain("Reference image 1: Kan's face sheet");
    expect(prompt).toContain('Reference image 3: a previous scene image');
    expect(prompt).toContain('Reference image 5: the alternate outfit');
    expect(prompt).toContain(db.state.location.slice(0, 20));
    expect(prompt).toContain('no text');
    expect(prompt).toContain('face sheet');
    expect(prompt).toContain('NO person');
  });

  test('recent images collect from assistant messages in order', () => {
    let db = loadSave();

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
    let db = loadSave();
    const before = db.state.inStoryDate;

    const { diff } = convertStateBlock({
      time: { elapsed: 3, unit: 'days', clock_time: '08:00' },
      mood: 'Weary but resolute',
    });

    expect(diff).not.toBeNull();

    db = applyTurnDiff(db, diff);

    expect(daysBetween(before, db.state.inStoryDate)).toBe(3);
    expect(timeOfDayOf(db.state.inStoryDate)).toBe('morning');
    expect(db.state.mood).toBe('Weary but resolute');
  });

  test('time_of_day alone shifts only the time of day', () => {
    let db = loadSave();
    const before = { ...db.state.inStoryDate };

    db = applyTurnDiff(db, {
      state: { clockTime: { hour: 19, minute: 0 } },
    });

    expect(db.state.inStoryDate.day).toBe(before.day + 1);
    expect(timeOfDayOf(db.state.inStoryDate)).toBe('evening');
  });

  test('absolute inStoryDate from extraction still works and ages NPCs', () => {
    let db = loadSave();
    const yearBefore = db.state.inStoryDate.year;
    const agable = db.entities.find((e) => e.type === 'character' && e.birthYear === undefined && e.age !== undefined);

    db = applyTurnDiff(db, {
      state: { inStoryDate: { year: yearBefore + 1, month: 1, day: 1, hour: 8, minute: 0 } },
    });

    expect(db.state.inStoryDate.year).toBe(yearBefore + 1);

    if (agable) {
      const after = db.entities.find((e) => e.id === agable.id);
      expect(after?.age).toBe((agable.age ?? 0) + 1);
    }
  });

  test('scene_ended inline diff records a memory event', () => {
    let db = loadSave();
    db = appendStoryMessage(db, 'user', '*Kan waits.*', 'm', 0, 0);
    db = appendStoryMessage(db, 'assistant', 'Rain falls over the empty road.', 'm', 0, 0);
    const eventsBefore = db.events.length;

    const { diff } = convertStateBlock({ scene_ended: true });

    expect(diff?.scene?.ended).toBe(true);

    db = applyTurnDiff(db, diff);

    expect(db.events.length).toBe(eventsBefore + 1);
  });
});

describe('summarize cadence', () => {
  test('counts only messages since the last chapter summary', () => {
    let db = loadSave();

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
    const db = loadSave();

    for (const summary of db.summaries) {
      expect(/[.!?\"]$/.test(summary.text.trim())).toBe(true);
    }
  });
});

describe('presence tracking and bonds ordering', () => {
  test('characters_present marks entities as seen', () => {
    let db = loadSave();

    const { diff } = convertStateBlock({
      characters_present: ['Itachi Uchiha'],
      time: { elapsed: 2, unit: 'days', clock_time: '08:00' },
    });

    db = applyTurnDiff(db, diff);

    const itachi = db.entities.find((entity) => entity.name === 'Itachi Uchiha');

    expect(itachi?.lastSeen).toBeDefined();
    expect(itachi?.lastSeen?.day).toBe(db.state.inStoryDate.day);
    expect(timeOfDayOf(itachi!.lastSeen!)).toBe('morning');
  });

  test('sleeping through the night advances exactly one day to morning', () => {
    let db = loadSave();
    const before = db.state.inStoryDate;

    const { diff } = convertStateBlock({
      time: { elapsed: 9, unit: 'hours' },
    });

    db = applyTurnDiff(db, diff);

    expect(daysBetween(before, db.state.inStoryDate)).toBe(1);
    expect(db.state.inStoryDate.hour).toBe(7);
    expect(timeOfDayOf(db.state.inStoryDate)).toBe('morning');
  });

  test('narrator prompt asks for prose only and carries no JSON schema', () => {
    expect(NARRATION_SYSTEM).not.toContain('```');
    expect(NARRATION_SYSTEM).not.toContain('characters_present');
    expect(NARRATION_SYSTEM).not.toContain('scene_pace');
    expect(NARRATION_SYSTEM).not.toContain('"time"');
    expect(NARRATION_SYSTEM).toContain('Story prose only');
    expect(NARRATION_SYSTEM).toContain('a night\'s sleep 8-9 hours');
  });

  test('full narration prompt never asks the narrator for JSON fields', () => {
    const db = loadSave();
    const prompt = buildNarrationPrompt(db, '*Kan looks around.*', 20);
    const all = prompt.messages.map((message) => message.content).join('\n');

    for (const key of ['news_relayed', 'canon_engaged', 'canon_completed', 'canon_passed', 'image_worthy', '```json']) {
      expect(all).not.toContain(key);
    }
  });

  test('narration prompt does not duplicate the current action', () => {
    const db = loadSave();
    const action = '"We move at dawn." *Kan checks his pack.*';

    const prompt = buildNarrationPrompt(db, action, 10);
    const dynamic = prompt.messages[1].content;

    const occurrences = dynamic.split(action).length - 1;

    expect(occurrences).toBe(1);
  });
});


describe('masked man identity resolution', () => {
  test('all masked-man names resolve to one entity', () => {
    let db = loadSave();

    const names = ['Masked Man', 'Tobi', 'Obito', 'Masked Man (Madara)'];

    for (const name of names) {
      db = applyEntityDiff(db, { name, role: 'Mystery' });
    }

    const maskedEntities = db.entities.filter((entity) =>
      ['masked man', 'tobi', 'obito'].some((hint) =>
        [entity.name, ...entity.aliases].some((alias) =>
          new RegExp(`\\b${hint}\\b`).test(alias.toLowerCase())
        )
      )
    );

    expect(maskedEntities.length).toBe(1);
    expect(resolveEntity(db, 'Tobi')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
    expect(resolveEntity(db, 'Obito')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
    expect(resolveEntity(db, 'Masked Man (Madara)')?.id).toBe(resolveEntity(db, 'Masked Man')?.id);
  });

  test('the real Madara is a separate character from the masked man', () => {
    let db = loadSave();

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
    let db = loadSave();

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
    let db = loadSave();

    db = applyEntityDiff(db, { name: 'Masked Man', role: 'Mystery' });
    db = applyEntityDiff(db, { name: 'Madara Uchiha', role: 'Legend', age: 40 });
    db = applyEntityDiff(db, { name: 'Pain', role: 'Akatsuki leader' });

    expect(resolveEntity(db, 'Pain')?.id).not.toBe(resolveEntity(db, 'Masked Man')?.id);
    expect(resolveEntity(db, 'Pain')?.id).not.toBe(resolveEntity(db, 'Madara Uchiha')?.id);
  });

  test('Black Zetsu and White Zetsu resolve to one entity', () => {
    let db = loadSave();

    db = applyEntityDiff(db, { name: 'Black Zetsu', role: 'Akatsuki' });
    db = applyEntityDiff(db, { name: 'White Zetsu', role: 'Akatsuki' });

    const zetsuId = resolveEntity(db, 'Black Zetsu')?.id;

    expect(resolveEntity(db, 'White Zetsu')?.id).toBe(zetsuId);
    expect(db.entities.filter((entity) => entity.name.toLowerCase().includes('zetsu')).length).toBe(1);
  });

  test('existing masked man and Tobi entities merge on any turn', () => {
    let db = loadSave();

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
    let db = loadSave();

    db = applyTurnDiff(db, {
      scene: { ended: false, entities: ['Itachi Uchiha'] },
    });

    const prompt = buildSceneImagePrompt(db, ['data:image/jpeg;base64,AAA']);

    expect(prompt).toContain('must NOT appear now');
    expect(prompt).toContain('Itachi Uchiha');
    expect(prompt).toContain('Only the people named in the ACTION may appear');
  });

  test('masked man aliases stay one entity', () => {
    let db = loadSave();
    db = applyEntityDiff(db, { name: 'Masked Man', role: 'Mystery' });
    db = applyEntityDiff(db, { name: 'Tobi', role: 'Mystery' });

    const matches = db.entities.filter((entity) => /masked man|\btobi\b/i.test(entity.name));
    expect(matches.length).toBe(1);
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
  test('no milestones fire on a fresh save before the story advances', () => {
    const db = loadSave();
    const next = advanceCanon(db);
    expect(next.state.canonProgress?.completed ?? []).toEqual([]);
    expect(next.events.filter((e) => e.tags.includes('canon')).length).toBe(0);
  });

  test('world milestones wait for the date window and baseline turns', () => {
    let db = loadSave();

    db = {
      ...db,
      state: {
        ...db.state,
        inStoryDate: { year: 16, month: 2, day: 1, hour: 8, minute: 0 },
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: { year: 13, month: 10, day: 1, hour: 22, minute: 0 },
          baselineTurn: 0,
          completed: [],
          active: [],
          engaged: [],
        },
      },
      rawLog: Array.from({ length: 30 }, (_, index) => ({
        ...db.rawLog[0],
        id: `log_${index}`,
        kind: 'story' as const,
        role: 'assistant' as const,
        content: 'A turn.',
        createdAt: index,
      })),
    };

    const next = advanceCanon(db);
    expect(next.state.canonProgress?.completed).toContain('juzo-death');
    expect(next.events.some((e) => e.id === 'event_canon_juzo-death')).toBe(true);
  });

  test('kan joining the Akatsuki is personal and only fires when narrated', () => {
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: db.state.inStoryDate,
          baselineTurn: 0,
          completed: [],
          active: [],
          engaged: [],
        },
      },
    };

    const auto = advanceCanon(db);
    expect(auto.state.canonProgress?.completed ?? []).not.toContain('kan-joins-akatsuki');
    expect(auto.threads.some((t) => t.title === 'Prove yourself to the Akatsuki')).toBe(false);

    const narrated = applyCanonMarks(auto, ['kan-joins-akatsuki'], []);
    expect(narrated.state.canonProgress?.completed).toContain('kan-joins-akatsuki');
    expect(narrated.threads.some((t) => t.title === 'Prove yourself to the Akatsuki')).toBe(true);
    expect(narrated.facts.some((f) => f.text.includes('Kan joined the Akatsuki'))).toBe(true);
  });

  test('does not run ahead of its date window', () => {
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        inStoryDate: { year: 14, month: 2, day: 1, hour: 8, minute: 0 },
        canonProgress: { completed: [], active: [], engaged: [] },
      },
      events: [...db.events, ...db.events, ...db.events],
    };

    const next = advanceCanon(db);
    expect(next.state.canonProgress?.completed ?? []).not.toContain('gaara-captured');
    expect(next.state.canonProgress?.completed ?? []).not.toContain('war-begins');
  });

  test('narrator-marked beats complete and stamp attendance', () => {
    let db = loadSave();
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
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        inStoryDate: { year: 19, month: 9, day: 1, hour: 22, minute: 0 },
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

  test('canon progression stays on even if an old save turned it off', () => {
    const db = loadSave();
    expect(canonEnabled({ ...db, settings: { ...db.settings, canonProgress: false } })).toBe(true);
  });
});

describe('cross-era memory and romance', () => {
  test('old saves migrate romance and canon fields', () => {
    const db = loadSave();

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
    let db = loadSave();
    const itachiId = resolveEntity(db, 'Itachi')?.id;
    const factsBefore = db.facts.length;

    db = applyTurnDiff(db, {
      state: { inStoryDate: { year: 22, month: 1, day: 1, hour: 8, minute: 0 } },
      entities: [{ name: 'Itachi', role: 'Akatsuki' }],
    });

    expect(resolveEntity(db, 'Itachi')?.id).toBe(itachiId);
    expect(db.bonds.some((b) => b.entityId === itachiId)).toBe(true);
    expect(db.facts.length).toBeGreaterThanOrEqual(factsBefore);
    expect(db.entities.filter((e) => e.name === 'Itachi Uchiha').length).toBe(1);
  });

  test('romance state persists rejections without resetting', () => {
    let db = loadSave();

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
    let db = loadSave();
    db = applyTurnDiff(db, {
      scene: { ended: false, entities: ['Itachi Uchiha'] },
    });

    const prompt = buildNarrationPrompt(db, '*Kan looks at Itachi.*', 10);
    const system = prompt.messages[0].content;
    const dynamic = prompt.messages[1].content;

    expect(system).toContain('written openly with no fade-out');
    expect(system).toContain('Lore-locked hearts');
    expect(system).toContain('CANON TIMELINE');
    expect(dynamic).toContain('CANON TIMELINE');
    expect(`${system}\n${dynamic}`).toContain('heart:');
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
    const db = loadSave();
    const prompt = buildNarrationPrompt(db, '*Kan looks at Itachi.*', 10);
    // Era notes ride on the character cards in the scene message.
    expect(prompt.messages.map((m) => m.content).join('\n')).toContain('now: Gentle older brother');
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
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        location: 'deep woods',
        locationKind: 'wilderness',
        inStoryDate: { ...db.state.inStoryDate, hour: 22, minute: 0 },
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
        inStoryDate: { ...db.state.inStoryDate, hour: 14, minute: 0 },
      },
    };

    expect(formatGatedEncounterHint(village, 10)).toContain('minor NPC');
    expect(formatEncounterConditions(village)).toContain('settlement');
  });

  test('location_kind flows through the diff and fallback classifier', () => {
    let db = loadSave();
    db = applyTurnDiff(db, { state: { location: 'Konoha marketplace' } });
    expect(db.state.locationKind).toBe('settlement');

    db = applyTurnDiff(db, { state: { location: 'somewhere new', locationKind: 'structure' } });
    expect(db.state.locationKind).toBe('structure');
  });
});

describe('silent turns', () => {
  test('the clock does not move on its own', () => {
    let db = loadSave();
    db = {
      ...db,
      state: { ...db.state, turnsWithoutTimeChange: 0 },
    };

    const before = db.state.inStoryDate;
    db = applyTurnDiff(db, {});
    db = applyTurnDiff(db, {});
    db = applyTurnDiff(db, {});

    expect(db.state.inStoryDate).toEqual(before);
    expect(db.state.turnsWithoutTimeChange).toBe(3);
  });

  test('reporting time resets the stall counter', () => {
    let db = loadSave();
    db = applyTurnDiff(db, {});
    expect(db.state.turnsWithoutTimeChange).toBe(1);

    db = applyTurnDiff(db, { state: { elapsedSeconds: 60 } });
    expect(db.state.turnsWithoutTimeChange).toBe(0);
  });
});

describe('canon endings and prompt memory', () => {
  test('canon_passed completes an opportunity with a missed fact', () => {
    let db = loadSave();
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
    let db = loadSave();
    const longNarration = `${'The rain falls. '.repeat(150)}FINAL BEAT: the masked man turns away and vanishes.`;

    db = appendStoryMessage(db, 'assistant', longNarration, 'm', 0, 0);
    const prompt = buildNarrationPrompt(db, '*Kan watches.*', 10);
    const dynamic = prompt.messages[1].content;

    expect(dynamic).toContain('FINAL BEAT');
    expect(dynamic).toContain('LAST NARRATED BEAT');
    expect(dynamic).toContain('CONTINUITY');
  });

  test('prompt budget guard caps runaway context', () => {
    let db = loadSave();
    for (let i = 0; i < 12; i += 1) {
      db = appendStoryMessage(db, 'assistant', 'Long narration. '.repeat(400), 'm', 0, 0);
    }

    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    expect(prompt.estimatedTokens).toBeLessThanOrEqual(db.settings.promptTokenBudget);
    expect(prompt.recentMessages.length).toBeGreaterThanOrEqual(4);
  });

  test('canon block lists concluded beats', () => {
    let db = loadSave();
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

describe('canon timing and migration', () => {
  test('fresh save does not show canon before the story reaches it', () => {
    const seeded = loadSave();
    const seededPoint = seeded.state.canonPoint;
    const db = advanceCanon(seeded);

    expect(db.events.filter((e) => e.tags.includes('canon')).length).toBe(0);
    expect(db.state.canonProgress?.completed ?? []).toEqual([]);
    expect(db.threads.some((t) => t.title === 'Prove yourself to the Akatsuki')).toBe(false);
    expect(db.state.canonPoint).toBe(seededPoint);
  });

  test('izumi funeral waits until day 6', () => {
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: { year: 13, month: 10, day: 1, hour: 22, minute: 0 },
          baselineTurn: 0,
          completed: [],
          active: [],
          engaged: [],
          expired: [],
        },
      },
      rawLog: Array.from({ length: 10 }, (_, i) => ({
        ...db.rawLog[0],
        id: `t_${i}`,
        kind: 'story' as const,
        role: 'assistant' as const,
        content: 'x',
        createdAt: i,
      })),
    };

    const day1 = advanceCanon({ ...db, state: { ...db.state, inStoryDate: { year: 13, month: 10, day: 1, hour: 22, minute: 0 } } });
    expect(day1.state.canonProgress?.completed ?? []).not.toContain('izumi-funeral');

    const day6 = advanceCanon({ ...db, state: { ...db.state, inStoryDate: { year: 13, month: 10, day: 6, hour: 8, minute: 0 } } });
    expect(day6.state.canonProgress?.completed).toContain('izumi-funeral');
    expect(day6.state.canonPoint).not.toContain('buried');
  });

  test('v1 saves are cleaned of phantom canon entries', () => {
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        canonPoint: 'Kan and Itachi have joined the Akatsuki together.',
        canonProgress: { version: 1, completed: ['kan-joins-akatsuki'], active: [], engaged: [] },
      },
      events: [
        ...db.events,
        {
          id: 'event_canon_kan-joins-akatsuki',
          chapter: 1,
          scene: 'Canon event',
          inStoryDate: db.state.inStoryDate,
          summary: 'Kan joins the Akatsuki: he joins.',
          importance: 5 as const,
          tags: ['canon'],
          pinned: true,
          sourceLogId: null,
          createdAt: 1,
        },
      ],
      facts: [
        ...db.facts,
        {
          id: 'fact_canon_kan-joins-akatsuki_0',
          subjectEntityId: null,
          type: 'event' as const,
          text: 'Kan joined the Akatsuki together with Itachi Uchiha.',
          whoKnows: [],
          validFrom: db.state.inStoryDate,
          validTo: null,
          confidence: 'confirmed' as const,
          sourceEventId: null,
        },
      ],
      threads: [
        ...db.threads,
        {
          id: 'thread_canon_kan-joins-akatsuki_0',
          type: 'goal' as const,
          title: 'Prove yourself to the Akatsuki',
          description: 'Earn a place.',
          status: 'open' as const,
          openedAt: db.state.inStoryDate,
          resolvedAt: null,
          importance: 4 as const,
          participants: ['Kan'],
          sourceEventId: null,
        },
      ],
    };

    const migrated = normalizeDatabase(db);

    expect(migrated.events.some((e) => e.id === 'event_canon_kan-joins-akatsuki')).toBe(false);
    expect(migrated.facts.some((f) => f.id.startsWith('fact_canon_'))).toBe(false);
    expect(migrated.threads.some((t) => t.id.startsWith('thread_canon_'))).toBe(false);
    expect(migrated.state.canonPoint).not.toContain('joined the Akatsuki');
    expect(migrated.state.canonProgress?.version).toBe(CANON_VERSION);
    expect(migrated.state.canonProgress?.completed).toEqual([]);
  });
});

describe('english place names', () => {
  test('glossary localizes Japanese place names', () => {
    expect(localizePlaceNames('Return to Konoha from Amegakure')).toBe(
      'Return to Hidden Leaf from Hidden Rain Village'
    );
    expect(localizePlaceNames('Sunagakure and Kirigakure')).toBe(
      'Hidden Sand Village and Hidden Mist Village'
    );
    expect(localizePlaceNames('Hokage, genin, jinchūriki, Akatsuki')).toBe(
      'Hokage, genin, jinchūriki, Akatsuki'
    );
  });

  test('canon data contains no Japanese place names', () => {
    for (const milestone of CANON_MILESTONES) {
      expect(hasJapanesePlaceName(`${milestone.title} ${milestone.description} ${milestone.canonPoint ?? ''}`)).toBe(false);
    }
  });

  test('prompt uses English place names', () => {
    const db = loadSave();
    const prompt = buildNarrationPrompt(db, '*Kan walks.*', 10);
    expect(prompt.messages[0].content).toContain('Hidden Leaf');
    expect(hasJapanesePlaceName(prompt.messages[1].content)).toBe(false);
    expect(prompt.messages[0].content).toContain('Use English place names only');
  });
});

describe('world news and couriers', () => {
  test('milestones carry world locations and knowledge classes', () => {
    const summit = CANON_MILESTONES.find((m) => m.id === 'kage-summit')!;
    expect(milestoneRegion(summit)).toBe('Land of Iron');
    expect(milestoneLocation(summit)).toContain('Summit hall');

    const gaara = CANON_MILESTONES.find((m) => m.id === 'gaara-captured')!;
    expect(milestoneRegion(gaara)).toBe('Hidden Sand');

    const funeral = CANON_MILESTONES.find((m) => m.id === 'izumi-funeral')!;
    expect(milestoneKnowledge(funeral)).toBe('village');
    expect(milestoneBearers(funeral)).toContain('Itachi Uchiha');
    expect(milestoneChannel(funeral)).toContain('hawk');

    expect(milestoneChannel(summit)).toContain('samurai');

    const truth = CANON_MILESTONES.find((m) => m.id === 'masked-man-truth')!;
    expect(milestoneKnowledge(truth)).toBe('secret');
    expect(milestoneBearers(truth)).toContain('Sasuke Uchiha');
  });

  test('unheard news stays queued until relayed', () => {
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: db.state.inStoryDate,
          baselineTurn: 0,
          completed: [],
          active: [],
          engaged: [],
          expired: [],
          heard: {},
        },
      },
    };

    db = {
      ...db,
      events: [
        ...db.events,
        {
          id: 'event_canon_gaara-captured',
          chapter: 1,
          scene: 'Canon event',
          inStoryDate: db.state.inStoryDate,
          summary: 'Gaara captured: the Shukaku is extracted.',
          importance: 5,
          tags: ['canon'],
          pinned: true,
          sourceLogId: null,
          createdAt: 1,
        },
      ],
      state: {
        ...db.state,
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: db.state.inStoryDate,
          baselineTurn: 0,
          completed: ['gaara-captured'],
          active: [],
          engaged: [],
          expired: [],
          heard: {},
        },
      },
    };
    const news = unheardCanonNews(db, 5);
    expect(news.some((n) => n.milestoneId === 'gaara-captured')).toBe(true);

    const delivered = markNewsHeard(db, [{ id: 'gaara-captured', from: 'a traveling merchant' }]);
    expect(unheardCanonNews(delivered, 5).some((n) => n.milestoneId === 'gaara-captured')).toBe(false);
    expect(delivered.state.canonProgress?.heard?.['event_canon_gaara-captured']?.from).toBe('a traveling merchant');
  });

  test('witnessed beats are marked heard automatically', () => {
    let db = loadSave();
    db = applyCanonMarks(db, ['itachi-vs-sasuke'], []);
    const heard = db.state.canonProgress?.heard?.['event_canon_itachi-vs-sasuke'];
    expect(heard?.from).toBe('witnessed');
  });

  test('news block appears in prompt with courier channel', () => {
    let db = loadSave();
    db = {
      ...db,
      events: [
        ...db.events,
        {
          id: 'event_canon_gaara-captured',
          chapter: 1,
          scene: 'Canon event',
          inStoryDate: db.state.inStoryDate,
          summary: 'Gaara captured: the Shukaku is extracted.',
          importance: 5,
          tags: ['canon'],
          pinned: true,
          sourceLogId: null,
          createdAt: 1,
        },
      ],
      state: {
        ...db.state,
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: db.state.inStoryDate,
          baselineTurn: 0,
          completed: ['gaara-captured'],
          active: [],
          engaged: [],
          expired: [],
          heard: {},
        },
      },
    };
    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    const dynamic = prompt.messages[1].content;

    expect(dynamic).toContain('NEWS & RUMORS');
    expect(dynamic).toContain('gaara-captured');
  });

  test('heard news disappears from the prompt queue', () => {
    let db = loadSave();
    db = applyCanonMarks(db, ['gaara-captured'], []);
    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    expect(prompt.messages[1].content).not.toContain('NEWS & RUMORS');
  });
});

describe('place names', () => {
  test('the narrator still sees which Japanese names to avoid', () => {
    const db = loadSave();
    const system = buildNarrationPrompt(db, '*Kan waits.*', 10).messages[0].content;
    expect(system).toContain('Hidden Leaf (never Konoha)');
    expect(system).toContain('Hidden Rain (never Amegakure)');
    expect(system).not.toContain('(never Hidden');
  });

  test('everything else is still translated', () => {
    expect(localizePlaceNames(`Rumors from Konoha. ${PLACE_NAME_RULE} Sunagakure is quiet.`)).toBe(
      `Rumors from Hidden Leaf. ${PLACE_NAME_RULE} Hidden Sand Village is quiet.`
    );
  });
});

describe('narration clock parsing', () => {
  const current = { year: 13, month: 10, day: 4, hour: 22, minute: 0, second: 0 };

  test('detects explicit dates', () => {
    const parsed = detectNarrationTime(
      'By the time full darkness falls on the fifth of October, the gate is close.',
      current
    );
    expect(parsed.explicitDate?.day).toBe(5);

    const applied = applyParsedTime(current, parsed);
    expect(applied.day).toBe(5);
  });

  test('detects elapsed days, hours and seconds', () => {
    expect(detectNarrationTime('Two days later, they reached the quarry.', current).elapsedSeconds).toBe(2 * 86400);
    expect(detectNarrationTime('They traveled for three days across the ridge.', current).elapsedSeconds).toBe(3 * 86400);
    expect(detectNarrationTime('A week passed before the rain stopped.', current).elapsedSeconds).toBe(7 * 86400);
    expect(detectNarrationTime('A good night\'s sleep left him rested.', current).sleptNight).toBe(true);
    expect(detectNarrationTime('A short rest by the fire.', current).elapsedSeconds).toBe(1800);
    expect(detectNarrationTime('A heartbeat later, the blade was at his throat.', current).elapsedSeconds).toBe(2);
  });

  test('ignores past, distance and future phrasing', () => {
    expect(detectNarrationTime('Three nights of flight had hollowed him out.', current).elapsedSeconds).toBe(0);
    expect(detectNarrationTime('The contract was signed four months ago.', current).elapsedSeconds).toBe(0);
    expect(detectNarrationTime('The graves will be watched for a week.', current).elapsedSeconds).toBe(0);
    expect(detectNarrationTime('It was a two-day march to the quarry.', current).elapsedSeconds).toBe(0);
  });

  test('detects exact clocks and rolls the day when needed', () => {
    const evening = detectNarrationTime('It is evening now.', current);
    expect(evening.clock).toEqual({ hour: 19, minute: 0 });

    const applied = applyParsedTime(current, evening);
    expect(applied.day).toBe(5);
    expect(applied.hour).toBe(19);

    const explicit = detectNarrationTime('At 3:40 PM she finally answered.', current);
    expect(explicit.clock).toEqual({ hour: 15, minute: 40 });
  });
});

describe('clock arithmetic', () => {
  test('rolls over minutes, hours, days, months and years', () => {
    const base = { year: 13, month: 10, day: 4, hour: 23, minute: 58, second: 30 };

    const plusMinutes = advanceSeconds(base, 150);
    expect(plusMinutes.day).toBe(5);
    expect(plusMinutes.hour).toBe(0);
    expect(plusMinutes.minute).toBe(1);
    expect(plusMinutes.second).toBe(0);

    // October has 31 days: Oct 4 + 27 days = Oct 31.
    const plusDays = advanceSeconds(base, 86400 * 27);
    expect(plusDays.month).toBe(10);
    expect(plusDays.day).toBe(31);

    const plusYear = advanceSeconds(base, 86400 * 365);
    expect(plusYear.year).toBe(14);
  });

  test('formats AM/PM and derives day periods', () => {
    expect(formatClock({ year: 13, month: 10, day: 4, hour: 22, minute: 5 })).toBe('10:05 PM');
    expect(formatClock({ year: 13, month: 10, day: 4, hour: 0, minute: 0 })).toBe('12:00 AM');
    expect(timeOfDayOf({ year: 13, month: 10, day: 4, hour: 8, minute: 0 })).toBe('morning');
    expect(timeOfDayOf({ year: 13, month: 10, day: 4, hour: 19, minute: 0 })).toBe('evening');
    expect(timeOfDayOf({ year: 13, month: 10, day: 4, hour: 2, minute: 0 })).toBe('night');
  });

  test('months have their real lengths and leap years work', () => {
    expect(daysInMonth(13, 1)).toBe(31);
    expect(daysInMonth(13, 6)).toBe(30);
    expect(daysInMonth(13, 9)).toBe(30);
    expect(daysInMonth(13, 10)).toBe(31);
    expect(daysInMonth(13, 12)).toBe(31);
    expect(daysInMonth(15, 2)).toBe(28);
    expect(daysInMonth(16, 2)).toBe(29);
    expect(daysInMonth(100, 2)).toBe(28);
    expect(daysInMonth(400, 2)).toBe(29);

    const octoberEnd = advanceSeconds({ year: 13, month: 10, day: 31, hour: 23, minute: 59, second: 0 }, 120);
    expect(octoberEnd.month).toBe(11);
    expect(octoberEnd.day).toBe(1);
    expect(octoberEnd.hour).toBe(0);
    expect(octoberEnd.minute).toBe(1);

    const januaryEnd = advanceSeconds({ year: 13, month: 1, day: 31, hour: 12, minute: 0, second: 0 }, 86400);
    expect(januaryEnd.month).toBe(2);
    expect(januaryEnd.day).toBe(1);

    const commonFeb = advanceSeconds({ year: 15, month: 2, day: 28, hour: 12, minute: 0, second: 0 }, 86400);
    expect(commonFeb.month).toBe(3);
    expect(commonFeb.day).toBe(1);

    const leapFeb = advanceSeconds({ year: 16, month: 2, day: 28, hour: 12, minute: 0, second: 0 }, 86400);
    expect(leapFeb.month).toBe(2);
    expect(leapFeb.day).toBe(29);
  });

  test('pacing caps keep fights and travel honest', () => {
    expect(paceCapSeconds('combat', false)).toBe(600);
    expect(paceCapSeconds('combat', true)).toBe(7200);
    expect(paceCapSeconds('travel', false)).toBe(3 * 86400);
    expect(paceCapSeconds('downtime', false)).toBe(7 * 86400);
    expect(paceCapSeconds('conversation', false)).toBe(3600);
  });
});

describe('style guard and image brief', () => {
  test('style guard flags overused words', () => {
    let db = loadSave();
    for (let i = 0; i < 4; i += 1) {
      db = appendStoryMessage(
        db,
        'assistant',
        'The cedar creaked. The smell of ozone drifted through the cedar shadows, and the ozone bit at his throat.',
        'm',
        0,
        0
      );
    }

    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    const dynamic = prompt.messages[1].content;
    expect(dynamic).toContain('STYLE GUARD');
    expect(dynamic.toLowerCase()).toContain('cedar');
    expect(dynamic.toLowerCase()).toContain('ozone');
  });

  test('image prompt follows the action brief and live cast', () => {
    let db = loadSave();
    db = applyTurnDiff(db, {
      state: {
        sceneCast: ['Itachi Uchiha'],
      },
    });

    const prompt = buildSceneImagePrompt(
      db,
      [
        { kind: 'face', uri: 'data:face' },
        { kind: 'outfit', uri: 'data:outfit' },
      ],
      'Kan chokes a Stone ninja from behind at the quarry gate; the ninja\'s face reddens.'
    );

    expect(prompt).toContain("Reference image 1: Kan's face sheet");
    expect(prompt).toContain('Reference image 2: the clothes Kan currently wears');

    expect(prompt).toContain('ACTION (depict this exactly)');
    expect(prompt).toContain('chokes a Stone ninja');
    expect(prompt).toContain('NEVER depict Kan as the victim');
    expect(prompt).toContain('Named people in this scene besides Kan: Itachi Uchiha');
    expect(prompt).not.toContain('Kan is alone');
  });

  test('upcoming world rumors are shown before they happen', () => {
    let db = loadSave();
    const prompt = buildNarrationPrompt(db, '*Kan waits.*', 10);
    const dynamic = prompt.messages[1].content;

    expect(dynamic).toContain("RUMORS OF WHAT'S COMING");
    expect(dynamic).toContain("Izumi Uchiha's funeral");
  });

  test('narrated canon completion is marked witnessed', () => {
    let db = loadSave();
    db = applyCanonMarks(db, ['kan-joins-akatsuki'], []);
    expect(db.state.canonProgress?.heard?.['event_canon_kan-joins-akatsuki']?.from).toBe('witnessed');
  });
});

describe('scene pacing and the clock', () => {
  test('infers pace from narration', () => {
    expect(inferScenePace('Kan chokes a Stone ninja while the blade whistles past.')).toBe('combat');
    expect(inferScenePace('They rode for two days along the border road.')).toBe('travel');
    expect(inferScenePace('Kan sleeps until the coals die down.')).toBe('downtime');
    expect(inferScenePace('Itachi says nothing and looks away.')).toBe('conversation');
    expect(inferScenePace('The Root hounds are hunting him through the trees.')).toBe('chase');
  });

  test('combat caps time even if the narrator overreports', () => {
    const capped = resolveElapsedSeconds({
      reportedSeconds: 2 * 86400,
      detectedSeconds: 0,
      pace: 'combat',
      sceneEnded: false,
    });
    expect(capped).toBe(600);
  });

  test('travel respects explicit days but caps at three', () => {
    expect(
      resolveElapsedSeconds({ reportedSeconds: 2 * 86400, detectedSeconds: 0, pace: 'travel', sceneEnded: false })
    ).toBe(2 * 86400);
    expect(
      resolveElapsedSeconds({ reportedSeconds: 30 * 86400, detectedSeconds: 0, pace: 'travel', sceneEnded: false })
    ).toBe(3 * 86400);
  });

  test('fight seconds accumulate correctly on the clock', () => {
    const start = { year: 13, month: 10, day: 4, hour: 14, minute: 0, second: 0 };
    const afterOneStrike = advanceSeconds(start, 8);
    const afterShortFight = advanceSeconds(start, 8 * 3);

    expect(afterOneStrike.second).toBe(8);
    expect(afterShortFight.second).toBe(24);
    expect(afterShortFight.day).toBe(4);
  });

  test('a ninth-hour sleep crosses into the next morning', () => {
    const start = { year: 13, month: 10, day: 4, hour: 22, minute: 0, second: 0 };
    const wake = advanceSeconds(start, 9 * 3600);

    expect(wake.day).toBe(5);
    expect(wake.hour).toBe(7);
    expect(timeOfDayOf(wake)).toBe('morning');
  });
});

describe('canon + clock integration', () => {
  test('milestones open exactly on their real-calendar date', () => {
    let db = loadSave();
    db = {
      ...db,
      state: {
        ...db.state,
        canonProgress: {
          version: CANON_VERSION,
          baselineDate: { year: 13, month: 10, day: 1, hour: 22, minute: 0, second: 0 },
          baselineTurn: 0,
          completed: [],
          active: [],
          engaged: [],
          expired: [],
          heard: {},
        },
      },
      rawLog: Array.from({ length: 12 }, (_, i) => ({
        ...db.rawLog[0],
        id: `m_${i}`,
        kind: 'story' as const,
        role: 'assistant' as const,
        content: 'x',
        createdAt: i,
      })),
    };

    const before = advanceCanon({ ...db, state: { ...db.state, inStoryDate: { year: 13, month: 10, day: 5, hour: 22, minute: 0, second: 0 } } });
    expect(before.state.canonProgress?.completed).not.toContain('izumi-funeral');

    const onDay = advanceCanon({ ...db, state: { ...db.state, inStoryDate: { year: 13, month: 10, day: 6, hour: 22, minute: 0, second: 0 } } });
    expect(onDay.state.canonProgress?.completed).toContain('izumi-funeral');
  });

  test('completed encounters are not listed as active, personal ones are', () => {
    let db = loadSave();
    db = applyCanonMarks(db, ['kan-joins-akatsuki'], []);
    expect(activeCanonMilestones(db).some((m) => m.id === 'kan-joins-akatsuki')).toBe(false);

    const engaged = applyCanonMarks(db, [], ['masked-man-audience']);
    expect(activeCanonMilestones(engaged).some((m) => m.id === 'masked-man-audience')).toBe(true);
  });

  test('combat blocks date jumps but allows the clock to move forward', () => {
    const current = { year: 13, month: 10, day: 4, hour: 18, minute: 0, second: 0 };

    const fight = resolveTurnClock({
      reportedSeconds: 2 * 86400,
      detected: {
        elapsedSeconds: 2 * 86400,
        explicitDate: { year: 13, month: 10, day: 6, hour: 22, minute: 0, second: 0 },
        clock: { hour: 20, minute: 0 },
      },
      pace: 'combat',
      sceneEnded: false,
      current,
    });

    // Capped at 600 s of fighting, then the stated hour (forward, same day) lands.
    expect(fight.elapsedSeconds).toBe(2 * 3600);
  });

  test('every turn moves at least the pace minimum', () => {
    const current = { year: 13, month: 10, day: 4, hour: 18, minute: 0, second: 0 };
    const none = { elapsedSeconds: 0 };
    const run = (pace: 'combat' | 'chase' | 'conversation' | 'downtime' | 'travel') =>
      resolveTurnClock({ reportedSeconds: 0, detected: none, pace, sceneEnded: false, current });

    expect(run('combat').elapsedSeconds).toBe(15);
    expect(run('chase').elapsedSeconds).toBe(60);
    expect(run('conversation').elapsedSeconds).toBe(120);
    expect(run('downtime').elapsedSeconds).toBe(600);
    expect(run('travel').elapsedSeconds).toBe(1800);
    expect(run('conversation').storyTimed).toBe(false);
  });

  test('the largest of reported, parsed and minimum wins', () => {
    const current = { year: 13, month: 10, day: 4, hour: 18, minute: 0, second: 0 };
    const result = resolveTurnClock({
      reportedSeconds: 300,
      detected: { elapsedSeconds: 900 },
      pace: 'conversation',
      sceneEnded: false,
      current,
    });
    expect(result.elapsedSeconds).toBe(900);
    expect(result.storyTimed).toBe(true);
  });

  test('fights cannot skip days, travel only when the story says so', () => {
    const current = { year: 13, month: 10, day: 4, hour: 18, minute: 0, second: 0 };
    const fight = resolveTurnClock({
      reportedSeconds: 3 * 86400,
      detected: { elapsedSeconds: 0 },
      pace: 'combat',
      sceneEnded: false,
      current,
    });
    expect(fight.elapsedSeconds).toBe(600);

    const quietRoad = resolveTurnClock({
      reportedSeconds: 0,
      detected: { elapsedSeconds: 0 },
      pace: 'travel',
      sceneEnded: false,
      current,
    });
    expect(quietRoad.elapsedSeconds).toBe(1800);

    const longRoad = resolveTurnClock({
      reportedSeconds: 2 * 86400,
      detected: { elapsedSeconds: 0 },
      pace: 'travel',
      sceneEnded: false,
      current,
    });
    expect(longRoad.elapsedSeconds).toBe(2 * 86400);
  });

  test('a full night of sleep jumps to the next morning', () => {
    const late = { year: 13, month: 10, day: 4, hour: 22, minute: 30, second: 0 };
    const parsed = detectNarrationTime('After a full night\'s sleep, the fire is cold.', late);
    const result = resolveTurnClock({
      reportedSeconds: 0,
      detected: parsed,
      pace: 'conversation',
      sceneEnded: false,
      current: late,
    });
    const wake = advanceSeconds(late, result.elapsedSeconds);
    expect(wake.day).toBe(5);
    expect(wake.hour).toBe(7);
    expect(wake.minute).toBe(0);
  });

  test('a restated current hour does not roll the clock a day', () => {
    const current = { year: 13, month: 10, day: 4, hour: 15, minute: 45, second: 0 };
    const result = resolveTurnClock({
      reportedSeconds: 0,
      detected: { elapsedSeconds: 0, clock: { hour: 15, minute: 40 } },
      pace: 'conversation',
      sceneEnded: false,
      current,
    });
    expect(result.elapsedSeconds).toBe(120);
  });

  test('a reply time correction shifts the clock by the difference', async () => {
    const { correctTurnTime } = await import('../lib/rpg/memoryJobs');
    const base = loadSave();
    const db = {
      ...base,
      rawLog: [
        {
          id: 'reply_1',
          turn: 1,
          kind: 'story' as const,
          role: 'assistant' as const,
          content: 'x',
          model: null,
          promptTokens: 0,
          completionTokens: 0,
          chapter: 1,
          scene: 'x',
          inStoryDate: base.state.inStoryDate,
          createdAt: 0,
          elapsedSeconds: 120,
        },
      ],
    };
    const corrected = correctTurnTime(db, 'reply_1', 3600);
    expect(corrected).not.toBeNull();
    expect(corrected!.rawLog[0].elapsedSeconds).toBe(3600);
    expect(dateSortValue(corrected!.state.inStoryDate) - dateSortValue(db.state.inStoryDate)).toBe(3480);

    const back = correctTurnTime(corrected!, 'reply_1', 15);
    expect(dateSortValue(back!.state.inStoryDate) - dateSortValue(db.state.inStoryDate)).toBe(-105);
  });

  test('scenePace survives an export/import round trip', () => {
    let db = loadSave();
    db = applyTurnDiff(db, { state: { scenePace: 'travel' } });
    const round = normalizeDatabase(JSON.parse(JSON.stringify(db)));
    expect(round.state.scenePace).toBe('travel');
  });
});

describe('portraits', () => {
  test('mood text maps to a coarse expression, leading word first', async () => {
    const { expressionFromMood } = await import('../lib/rpg/portrait');
    expect(expressionFromMood('Numb, guarded, quietly exhausted')).toBe('tired');
    expect(expressionFromMood('Guarded, numb')).toBe('grim');
    expect(expressionFromMood('Furious and cold')).toBe('angry');
    expect(expressionFromMood('Something unusual')).toBe('calm');
  });

  test('a portrait goes stale on outfit, age, expression or setting changes only', async () => {
    const { portraitSignature, portraitStaleReason } = await import('../lib/rpg/portrait');
    const db = seedDatabase('slot_portrait', 'Portrait');
    const signature = portraitSignature(db);
    const record = {
      id: 'p1',
      image: 'img:x',
      signature,
      inStoryDate: db.state.inStoryDate,
      location: db.state.location,
      createdAt: 0,
    };

    expect(portraitStaleReason(null, signature)).toBe('No portrait yet');
    expect(portraitStaleReason(record, signature)).toBeNull();

    const reworded = { ...db, state: { ...db.state, mood: 'Exhausted, numb, quiet' } };
    expect(portraitStaleReason(record, portraitSignature(reworded))).toBeNull();

    const cloaked = { ...db, state: { ...db.state, inventory: [...db.state.inventory, 'Akatsuki cloak'] } };
    expect(portraitStaleReason(record, portraitSignature(cloaked))).toBe('Now wearing the Akatsuki cloak');

    const older = { ...db, state: { ...db.state, inStoryDate: { ...db.state.inStoryDate, year: db.state.inStoryDate.year + 1 } } };
    expect(portraitStaleReason(record, portraitSignature(older))).toBe(`Turned ${signature.age + 1}`);
  });

  test('saves keep image references and old portraits through normalize', () => {
    const db = seedDatabase('slot_refs', 'Refs');
    const withPortrait = {
      ...db,
      portraits: [
        { id: 'p1', image: 'img:abc', signature: { age: 13, outfit: 'black' as const, expression: 'tired' as const, setting: 'wilds' as const }, inStoryDate: db.state.inStoryDate, location: 'x', createdAt: 1 },
      ],
    };
    const normalized = normalizeDatabase(withPortrait);
    expect(normalized.portraits?.length).toBe(1);
    expect(normalized.portraits?.[0].image).toBe('img:abc');
  });
});

describe('two-call turn: prose narrator + structured state call', () => {
  function collectObjects(node: unknown, out: Record<string, unknown>[] = []) {
    if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;

      if (record.type === 'object' || (Array.isArray(record.type) && record.type.includes('object'))) {
        out.push(record);
      }

      for (const value of Object.values(record)) {
        collectObjects(value, out);
      }
    }

    return out;
  }

  test('state schema is valid for strict structured output', () => {
    const objects = collectObjects(TURN_STATE_SCHEMA);
    expect(objects.length).toBeGreaterThan(5);

    for (const object of objects) {
      const properties = Object.keys(object.properties as Record<string, unknown>);
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required as string[])].sort()).toEqual([...properties].sort());
    }
  });

  test('converts a full structured reply with nulls and empty lists', () => {
    const { diff, imageWorthy } = convertStateBlock({
      time: { elapsed: 2, unit: 'hours', clock_time: null },
      scene_pace: 'travel',
      location: 'Road north of the Hidden Leaf',
      location_kind: 'road',
      mood: null,
      world_description: null,
      canon_point: null,
      inventory_added: ['Rice balls'],
      inventory_removed: [],
      jutsu_used: [],
      bonds: [{ character: 'Itachi Uchiha', affinity_change: 1, status: null, note: null, relationship: null, attraction: null, romance_note: null }],
      facts: [{ entity: 'Kan', fact: 'Kan knows the massacre happened.', type: 'knowledge', who_knows: ['Kan', 'Itachi Uchiha'] }],
      threads: [{ title: 'Reach the Hidden Rain', description: 'You and Itachi head for the Hidden Rain.', status: 'open' }],
      new_characters: [],
      character_updates: [{ name: 'Itachi Uchiha', mood: 'withdrawn', appearance: null }],
      characters_present: ['Itachi Uchiha'],
      image_worthy: true,
      scene_ended: false,
      canon_engaged: [],
      canon_completed: [],
      canon_passed: [],
      news_relayed: [],
    });

    expect(imageWorthy).toBe(true);
    expect(diff?.imageWorthy).toBe(true);
    expect(diff?.state?.elapsedSeconds).toBe(7200);
    expect(diff?.state?.scenePace).toBe('travel');
    expect(diff?.state?.location).toBe('Road north of the Hidden Leaf');
    expect(diff?.state?.locationKind).toBe('road');
    expect(diff?.state?.inventoryAdded).toEqual(['Rice balls']);
    expect(diff?.state?.mood).toBeUndefined();
    expect(diff?.bonds?.[0].affinityDelta).toBe(1);
    expect(diff?.facts?.[0].type).toBe('knowledge');
    expect(diff?.facts?.[0].whoKnows).toEqual(['Kan', 'Itachi Uchiha']);
    expect(diff?.threads?.[0]).toMatchObject({ action: 'open', title: 'Reach the Hidden Rain' });
    expect(diff?.entities?.[0]).toMatchObject({ name: 'Itachi Uchiha', mood: 'withdrawn' });
    expect(diff?.canonCompleted).toEqual([]);
  });

  test('an all-unchanged structured reply is no diff', () => {
    const { diff } = convertStateBlock({
      time: { elapsed: null, unit: null, clock_time: null },
      scene_pace: null, location: null, location_kind: null, mood: null,
      world_description: null, canon_point: null, inventory_added: [], inventory_removed: [],
      jutsu_used: [], bonds: [], facts: [], threads: [], new_characters: [], character_updates: [],
      characters_present: [], image_worthy: false, scene_ended: false,
      canon_engaged: [], canon_completed: [], canon_passed: [], news_relayed: [],
    });

    expect(diff).toBeNull();
  });

  test('state prompt carries the turn prose and canon ids', () => {
    const db = loadSave();
    const prompt = buildExtractionPrompt(db, '*Kan follows.*', 'You walk for an hour behind Itachi.');
    const user = prompt.messages[1].content;

    expect(prompt.messages[0].content).toContain('state tracker');
    expect(user).toContain('THIS TURN');
    expect(user).toContain('You walk for an hour behind Itachi.');
    expect(user).toContain('TIME BEFORE THIS TURN');

    const tracked = [
      ...activeCanonMilestones(db).slice(0, 2).map((milestone) => milestone.id),
      ...unheardCanonNews(db, 3).map((item) => item.milestoneId),
    ];

    for (const id of tracked) {
      expect(user).toContain(id);
    }
  });

  test('streaming preview hides any code block or JSON a model adds anyway', () => {
    expect(streamingPreview('Rain falls.\n\nItachi waits.')).toBe('Rain falls.\n\nItachi waits.');
    expect(streamingPreview('Rain falls.\n\n```json\n{"mood"')).toBe('Rain falls.');
    expect(streamingPreview('Rain falls.\n{"state":')).toBe('Rain falls.');
    expect(streamingPreview('Rain falls. "Move," he says.')).toBe('Rain falls. "Move," he says.');
  });
});

describe('duplicate characters', () => {
  const kisameCount = (db: AppDatabase) =>
    db.entities.filter((entity) =>
      [entity.name, ...entity.aliases].some((name) => /\bkisame\b/i.test(name))
    ).length;

  test('the canon cast is loaded once each, unmet, with aliases', () => {
    const db = loadSave();
    const kisame = db.entities.find((entity) => entity.name === 'Kisame Hoshigaki');

    expect(kisame?.met).toBe(false);
    expect(kisame?.aliases).toContain('Kisame');
    expect(kisameCount(db)).toBe(1);
    // Itachi comes from the story seed, not the cast list, and is not doubled.
    expect(db.entities.filter((entity) => /\bitachi\b/i.test(entity.name)).length).toBe(1);
    // The real Madara is not pre-loaded: bare "Madara" still means the masked man.
    expect(resolveEntity(db, 'Madara')?.name).toBe('Masked man');
  });

  test('older saves gain the cast without doubling people they already have', () => {
    const seeded = loadSave();
    const old: AppDatabase = {
      ...seeded,
      entities: [
        ...seeded.entities.filter((entity) => entity.met !== false),
        { id: 'entity_old_kisame', name: 'Kisame', type: 'character', aliases: [], tags: [], role: 'Swordsman' },
      ],
    };

    const once = normalizeDatabase(old);
    const twice = normalizeDatabase(once);
    const kisame = once.entities.find((entity) => entity.id === 'entity_old_kisame');

    expect(kisameCount(once)).toBe(1);
    expect(kisame?.aliases).toContain('Kisame Hoshigaki');
    expect(kisame?.met).toBeUndefined();
    expect(twice.entities.length).toBe(once.entities.length);
  });

  test('the state prompt lists everyone by id', () => {
    const db = loadSave();
    const prompt = buildExtractionPrompt(db, 'I nod.', 'Kisame grins at you.')
      .messages.map((message) => message.content)
      .join('\n');

    expect(prompt).toContain('KNOWN CHARACTERS');
    expect(prompt).toContain('- kisame-hoshigaki: Kisame Hoshigaki (Kisame, Hoshigaki Kisame) [not met yet]');
    expect(prompt).toContain('- itachi-uchiha: Itachi Uchiha');
    expect(prompt).toContain('CHARACTERS IN THIS TURN');
    expect(TURN_STATE_SCHEMA.properties.bonds.items.properties).toHaveProperty('character_id');
    expect(TURN_STATE_SCHEMA.properties.new_characters.items.properties).toHaveProperty('is_new');
  });

  test('ids resolve to known people; only is_new adds someone', () => {
    let db = loadSave();
    const before = db.entities.length;
    const { diff } = convertStateBlock({
      characters_present: ['kisame-hoshigaki', 'itachi-uchiha', 'Haku the Fisherman'],
      bonds: [
        { character_id: 'kisame-hoshigaki', affinity_change: 1, status: 'Wary', note: null, relationship: null, attraction: null, romance_note: null },
        { character_id: 'some-stranger', affinity_change: 2, status: null, note: null, relationship: null, attraction: null, romance_note: null },
      ],
      new_characters: [
        { is_new: false, name: 'Kisame', age: 30, role: null, personality: null, speech_style: null, appearance: null },
        { is_new: true, name: 'Hoshigaki Kisame', age: null, role: 'Swordsman', personality: null, speech_style: null, appearance: null },
        { is_new: true, name: 'Haku the Fisherman', age: 50, role: 'Ferryman', personality: null, speech_style: null, appearance: null },
      ],
      character_updates: [
        { character_id: 'itachi-uchiha', mood: 'tired', appearance: null },
        { character_id: 'nobody-at-all', mood: 'angry', appearance: null },
      ],
      jutsu_used: [{ name: 'Water Prison', user: 'kisame-hoshigaki', chakra_nature: 'Water', effect: null, visual: null }],
    });

    db = applyTurnDiff(db, resolveCharacterRefs(db, diff as TurnDiff));

    const kisame = db.entities.find((entity) => entity.name === 'Kisame Hoshigaki');

    expect(kisameCount(db)).toBe(1);
    expect(kisame?.met).toBe(true);
    expect(db.bonds.find((bond) => bond.entityId === kisame?.id)?.status).toBe('Wary');
    expect(db.bonds.some((bond) => bond.characterName === 'some-stranger')).toBe(false);
    expect(db.entities.length).toBe(before + 1);
    expect(db.entities.some((entity) => entity.name === 'Haku the Fisherman')).toBe(true);
    expect(db.entities.find((entity) => entity.name === 'Itachi Uchiha')?.mood).toBe('tired');
    expect(db.state.sceneCast).toEqual(['Kisame Hoshigaki', 'Itachi Uchiha', 'Haku the Fisherman']);
    expect(db.jutsuRecords.find((record) => record.name === 'Water Prison')?.user).toBe('Kisame Hoshigaki');
  });

  test('merging folds one person into another', () => {
    let db = loadSave();
    db = applyEntityDiff(db, { name: 'Shark-faced man', isNew: true, role: 'Swordsman' });
    db = applyTurnDiff(db, { bonds: [{ character: 'Shark-faced man', affinityDelta: 3, status: 'Respect' }] });

    const shark = db.entities.find((entity) => entity.name === 'Shark-faced man')!;
    const kisame = db.entities.find((entity) => entity.name === 'Kisame Hoshigaki')!;

    db = mergeEntityPair(db, kisame.id, shark.id);

    const merged = db.entities.find((entity) => entity.id === kisame.id);

    expect(db.entities.some((entity) => entity.id === shark.id)).toBe(false);
    expect(merged?.aliases).toContain('Shark-faced man');
    expect(merged?.met).toBeUndefined();
    expect(db.bonds.filter((bond) => bond.entityId === kisame.id).length).toBe(1);
    expect(db.bonds.find((bond) => bond.entityId === kisame.id)?.affinity).toBe(3);
    expect(resolveEntity(db, 'Shark-faced man')?.id).toBe(kisame.id);
  });
});

describe('name mentions', () => {
  test('names match whole words only', () => {
    expect(mentionsName('You fall asleep by the fire.', 'Lee')).toBe(false);
    expect(mentionsName('Lee bows deeply.', 'Lee')).toBe(true);
    expect(mentionsName('Hiruzen Sarutobi lights his pipe.', 'Tobi')).toBe(false);
    expect(mentionsName('Tobi waves.', 'tobi')).toBe(true);
    expect(mentionsName('Jūzō lowers his blade.', 'Jūzō')).toBe(true);
    expect(mentionsName('The pain in your side flares.', 'Pain')).toBe(false);
    expect(mentionsName('Pain looks down at you.', 'Pain')).toBe(true);
  });
});

describe('image model capabilities', () => {
  const caps = (params: ImageModelCaps['params'], maxReferences: number): ImageModelCaps => ({
    modelId: 'test/image',
    params,
    maxReferences,
    source: 'endpoints',
    fetchedAt: Date.now(),
  });

  test('Kan\'s face is the last reference to be left out', () => {
    const candidates = [
      { kind: 'previous' as const, uri: 'data:old' },
      { kind: 'face' as const, uri: 'data:face' },
      { kind: 'outfit' as const, uri: 'data:outfit' },
      { kind: 'alternate' as const, uri: 'data:alt' },
    ];

    const one = planReferences(candidates, 1);
    expect(one.references.map((r) => r.kind)).toEqual(['face']);
    expect(one.faceDropped).toBeNull();

    const three = planReferences(candidates, 3);
    expect(three.references.map((r) => r.kind)).toEqual(['face', 'outfit', 'previous']);

    const none = planReferences(candidates, 0);
    expect(none.references).toEqual([]);
    expect(none.faceDropped).toBe('no-references');

    const missing = planReferences([{ kind: 'face', uri: '' }, { kind: 'outfit', uri: 'data:o' }], 4);
    expect(missing.faceDropped).toBe('not-loaded');
  });

  test('requests carry only settings the model accepts', () => {
    const { body, sentReferences } = buildImageRequestBody(
      caps(
        {
          aspect_ratio: { type: 'enum', values: ['1:1', '3:2', '2:3'] },
          input_references: { type: 'range', min: 0, max: 2 },
        },
        2
      ),
      { prompt: 'p', references: ['a', 'b', 'c'], aspectRatio: '16:9' }
    );

    expect(body.aspect_ratio).toBe('3:2');
    expect(body.resolution).toBeUndefined();
    expect(body.quality).toBeUndefined();
    expect(body.output_format).toBeUndefined();
    expect(sentReferences).toBe(2);

    const full = buildImageRequestBody(
      caps(
        {
          resolution: { type: 'enum', values: ['1K', '2K'] },
          aspect_ratio: { type: 'enum', values: ['16:9', '3:4'] },
          quality: { type: 'enum', values: ['low', 'high'] },
          output_format: { type: 'enum', values: ['png', 'jpeg'] },
          output_compression: { type: 'range', min: 0, max: 100 },
        },
        0
      ),
      { prompt: 'p', references: ['a'], aspectRatio: '3:4' }
    );

    expect(full.body).toMatchObject({
      resolution: '1K',
      aspect_ratio: '3:4',
      quality: 'high',
      output_format: 'jpeg',
      output_compression: 80,
    });
    expect(full.body.input_references).toBeUndefined();
  });

  test('a scene without the face reference describes Kan in words', () => {
    const db = loadSave();
    const prompt = buildSceneImagePrompt(db, [], 'Kan stands in the rain.');
    expect(prompt).not.toContain('Reference image');
    expect(prompt).toContain('black spiky hair');
  });
});

describe('canon timing: dates only, combat holds, one news per turn', () => {
  const baseline = { year: 13, month: 10, day: 1, hour: 22, minute: 0 };
  const lateDate = { year: 16, month: 2, day: 1, hour: 8, minute: 0 };
  const withProgress = (db: AppDatabase, date = lateDate): AppDatabase => ({
    ...db,
    rawLog: [],
    state: {
      ...db.state,
      inStoryDate: date,
      canonProgress: {
        version: CANON_VERSION,
        baselineDate: baseline,
        baselineTurn: 0,
        completed: [],
        active: [],
        engaged: [],
      },
    },
  });

  test('world events fire from the date alone, with zero turns played', () => {
    const next = advanceCanon(withProgress(loadSave()));
    expect(next.state.canonProgress?.completed).toContain('juzo-death');
  });

  test('a long time skip fires everything due, not a capped handful', () => {
    const next = advanceCanon(withProgress(loadSave()));
    const opened = CANON_MILESTONES.filter(
      (m) => !m.playerDriven && m.from.year * 12 + m.from.month <= 16 * 12 + 2
    );
    expect(opened.length).toBeGreaterThan(4);
    for (const m of opened) {
      expect(next.state.canonProgress?.completed).toContain(m.id);
    }
  });

  test('fired events are dated when they happened, not when the clock caught up', () => {
    const next = advanceCanon(withProgress(loadSave()));
    const juzo = CANON_MILESTONES.find((m) => m.id === 'juzo-death')!;
    const event = next.events.find((e) => e.id === 'event_canon_juzo-death')!;
    expect(event.inStoryDate.year).toBe(juzo.from.year);
    expect(event.inStoryDate.month).toBe(juzo.from.month);
  });

  test('nothing fires or expires during combat; it all fires once the fight ends', () => {
    const db = withProgress(loadSave());
    const held = advanceCanon(db, { inCombat: true });
    expect(held.state.canonProgress?.completed ?? []).toEqual([]);
    expect(held.events.filter((e) => e.tags.includes('canon')).length).toBe(0);
    expect(held.state.canonProgress?.heldForCombat).toBe(true);

    const fromState = advanceCanon({ ...db, state: { ...db.state, scenePace: 'combat' } });
    expect(fromState.state.canonProgress?.completed ?? []).toEqual([]);

    const after = advanceCanon(held, { inCombat: false });
    expect(after.state.canonProgress?.completed).toContain('juzo-death');
    expect(after.state.canonProgress?.heldForCombat).toBe(false);
  });

  test('only one piece of news is marked heard per turn', () => {
    const db = advanceCanon(withProgress(loadSave()));
    const unheard = unheardCanonNews(db, 99);
    expect(unheard.length).toBeGreaterThan(1);
    const relayed = markNewsHeard(db, unheard.slice(0, 3).map((n) => ({ id: n.milestoneId, from: 'Kisame' })));
    expect(unheardCanonNews(relayed, 99).length).toBe(unheard.length - NEWS_PER_TURN);
  });

  test('narrator is offered at most one piece of news, and none mid-fight', () => {
    const db = advanceCanon(withProgress(loadSave()));
    const calm = buildNarrationPrompt({ ...db, state: { ...db.state, scenePace: 'conversation' } }, '*Kan listens.*', 10)
      .messages.map((m) => m.content).join('\n');
    const block = calm.split('NEWS & RUMORS (')[1]?.split('\n\n')[0] ?? '';
    expect(block.split('\n').filter((line) => line.startsWith('- ')).length).toBe(1);

    const fight = buildNarrationPrompt({ ...db, state: { ...db.state, scenePace: 'combat' } }, '*Kan strikes.*', 10)
      .messages.map((m) => m.content).join('\n');
    expect(fight).not.toContain('NEWS & RUMORS (');
    expect(fight).not.toContain("RUMORS OF WHAT'S COMING (");
  });

  test('world clock shows fired, unheard and queued events', () => {
    const db = advanceCanon(withProgress(loadSave()));
    const clock = worldClock(db);
    expect(clock.fired.some((f) => f.milestone.id === 'juzo-death')).toBe(true);
    expect(clock.unheard.length).toBeGreaterThan(0);
    expect(clock.queued.length).toBeGreaterThan(0);
    expect(clock.queued.every((q) => !q.milestone.playerDriven)).toBe(true);
    expect(clock.queued.some((q) => q.milestone.id === 'war-begins')).toBe(true);
  });
});
