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
import { applyEntityDiff, entityGroup, entityHints, mergeEntityPair, resolveCharacterRefs, resolveEntity } from '../lib/rpg/entities';
import { appendStoryMessage, cloneDatabase, storyMessagesSinceLastSummary } from '../lib/rpg/log';
import { trimToSentence } from '../lib/rpg/util';
import { convertStateBlock, statePlayerOf } from '../lib/rpg/stateBlock';
import { buildExtractionPrompt, buildNarrationPrompt, splitNarrationAndDiff, streamingPreview, stripNarrationJson } from '../lib/rpg/prompt';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import { mentionsName } from '../lib/rpg/characterRefs';
import { NARRATION_SYSTEM } from '../lib/rpg/prompt';
import { buildSceneImagePrompt, collectRecentSceneImages } from '../lib/rpg/image';
import { planReferences } from '../lib/rpg/referencePlan';
import { buildImageRequestBody, type ImageModelCaps } from '../lib/openrouter';
import { activeTimelineEvents, advanceTimeline, applyTimelineMarks, markNewsHeard, unheardNews } from '../lib/rpg/timeline';
import { RELATIONSHIP_STAGES, normalizeRelationship } from '../lib/rpg/romance';
import { slug } from '../lib/rpg/id';
import { applyParsedTime, detectNarrationTime } from '../lib/rpg/timeparse';
import { inferScenePace, resolveElapsedSeconds, resolveTurnClock } from '../lib/rpg/pacing';
import { classifyLocation, encounterRisk, formatEncounterConditions } from '../lib/rpg/encounters';
import { applyTurnDiff } from '../lib/rpg/services';
import { isDeceased, playerKnowsDeath, markDeathsByName, markDeceased } from '../lib/rpg/deaths';
import { CATCH_UP_QUIET_DAYS, couldKnow, livingBearers, newsAllowance, newsOffer } from '../lib/rpg/newsDelivery';
import { deliverLetters, letterOffer, receiveLetters, sendLetters, LETTER_BOND_GAIN, LETTER_MAX_DAYS } from '../lib/rpg/letters';
import { entityAge, shiftDate } from '../lib/rpg/calendar';
import type { AppDatabase, TurnDiff } from '../lib/rpg/types';

function loadSave(_path?: string): AppDatabase {
  return loadSaveBase();
}

function loadSaveBase(): AppDatabase {
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
  test('bonds accumulate and clamp, repeated threads dedupe', () => {
    let db = loadSave();
    const threadsBefore = db.threads.length;

    db = applyTurnDiff(db, {
      bonds: [{ character: 'Mara Vance', affinityDelta: 3, status: 'Ally', note: 'Trained together' }],
      facts: [{ action: 'add', type: 'event', text: 'Alex Reyes trained with Mara at dawn.', subject: 'Alex Reyes' }],
      threads: [{ action: 'update', title: 'Find a reason to keep going after the massacre', description: 'Find a reason to keep going after the massacre', type: 'goal' }],
    });

    db = applyTurnDiff(db, {
      bonds: [{ character: 'Mara Vance', affinityDelta: 2 }],
      threads: [{ action: 'update', title: 'Find a reason to keep going', description: 'Find a reason to keep going', type: 'goal' }],
    });

    const bond = db.bonds.find((item) => item.characterName === 'Mara Vance');
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
          worldPoint: 'A very long world point. '.repeat(30),
          location: `Location variant ${turn}`,
          inventoryAdded: [`item ${turn}`],
        },
        facts: [{ action: 'add', type: 'event', text: `Fact number ${turn} happened.`, subject: 'Alex Reyes' }],
      };

      db = applyTurnDiff(db, diff);
    }

    expect(db.state.inventory.length).toBeLessThanOrEqual(12);
    expect(db.state.worldDescription.length).toBeLessThanOrEqual(220);
    expect(db.state.worldPoint.length).toBeLessThanOrEqual(220);
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
      const userText = `"We should keep moving." *Alex Reyes adjusts his pack and scans the treeline.* (turn ${turn})`;
      const narrationBody = [
        `The wind carries ash from the valley as you push through the undergrowth. Mara walks half a step ahead, his crimson eyes tracking movement you cannot see. Somewhere behind, the hounds have lost the scent — for now.`,
        `You cross a stream, cold water biting through worn tabi, and climb the far bank into deeper shadow. Daniel's voice still echoes somewhere in your memory, sharp with accusation.`,
        `Mara stops. He tilts his head, listening. A crow bursts from the canopy above and wheels east, against the wind. Turn ${turn}, and the road grows no shorter.`,
      ].join(' ');
      const narration =
        turn % 3 === 0
          ? `${narrationBody}\n\n\`\`\`json\n{"state":{"location":"High ridge above the stream"},"facts":[{"entity":"Alex Reyes","fact":"Crossed the stream at dawn on turn ${turn}."}]}\n\`\`\``
          : narrationBody;

      db = appendStoryMessage(cloneDatabase(db), 'user', userText, 'm', 0, 0);
      const { narration: clean, inlineDiff } = splitNarrationAndDiff(narration);
      db = appendStoryMessage(db, 'assistant', clean, 'm', 3000, 400);

      const { diff } = convertStateBlock(inlineDiff);
      const fallback: TurnDiff = diff ?? {
        facts: [{ action: 'add', type: 'event', text: `Quiet turn ${turn}: nothing of note.`, subject: 'Alex Reyes' }],
      };

      if (turn % 5 === 0) {
        fallback.threads = [
          { action: 'update', title: `Open question raised on turn ${turn}`, description: `Open question raised on turn ${turn}`, type: 'mystery' },
        ];
      }

      if (turn % 6 === 0) {
        fallback.entities = [
          { name: `Scout ${turn}`, age: 20 + (turn % 10), role: 'Bodyguard', personality: 'Cold, precise', speechStyle: 'Clipped', mood: 'Wary', appearance: 'Dark suit, earpiece' },
        ];
      }

      db = applyTurnDiff(db, fallback);

      if (turn % 10 === 0 || turn === totalTurns - 1) {
        const prompt = buildNarrationPrompt(db, userText);
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
    ['unfenced truncated JSON', 'Story. {"state":{"location":"Y", "world_point":', null],
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
    const prompt = buildSceneImagePrompt(db, plan.references, 'Alex Reyes waits.');

    expect(prompt).toContain("Reference image 1: Alex Reyes's face.");
    expect(prompt).toContain('Reference image 3: a previous scene image');
    expect(prompt).toContain("Reference image 5: another outfit of Alex Reyes's");
    expect(prompt).toContain(db.state.location.slice(0, 20));
    expect(prompt).toContain('no text');
    expect(prompt).toContain('Identity only');
    expect(prompt).toContain('must NOT appear');
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
    // At most one earlier scene goes along, for rendering style only.
    expect(recent.length).toBe(1);
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
    db = appendStoryMessage(db, 'user', '*Alex Reyes waits.*', 'm', 0, 0);
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
    const cut = 'Alex Reyes fled through the rain. Mara followed without a word and the boar-masked ANBU captain attacked with Fire Style, but';
    const trimmed = trimToSentence(cut);

    expect(trimmed.endsWith('but')).toBe(false);
    expect(trimmed).toBe('Alex Reyes fled through the rain.');
  });

  test('keeps complete text intact', () => {
    const full = 'Alex Reyes fled through the rain. Mara followed without a word.';
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
      characters_present: ['Mara Vance'],
      time: { elapsed: 2, unit: 'days', clock_time: '08:00' },
    });

    db = applyTurnDiff(db, diff);

    const mara = db.entities.find((entity) => entity.name === 'Mara Vance');

    expect(mara?.lastSeen).toBeDefined();
    expect(mara?.lastSeen?.day).toBe(db.state.inStoryDate.day);
    expect(timeOfDayOf(mara!.lastSeen!)).toBe('morning');
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
    const prompt = buildNarrationPrompt(db, '*Alex Reyes looks around.*');
    const all = prompt.messages.map((message) => message.content).join('\n');

    for (const key of ['news_relayed', 'timeline_engaged', 'timeline_completed', 'timeline_passed', 'image_worthy', '```json']) {
      expect(all).not.toContain(key);
    }
  });

  test('narration prompt does not duplicate the current action', () => {
    const db = loadSave();
    const action = '"We move at dawn." *Alex Reyes checks his pack.*';

    const prompt = buildNarrationPrompt(db, action);
    const dynamic = prompt.messages[1].content;

    const occurrences = dynamic.split(action).length - 1;

    expect(occurrences).toBe(1);
  });
});



describe('encounter realism', () => {
  test('location classification and risk matrix', () => {
    expect(classifyLocation('Harbour Market stalls at noon')).toBe('settlement');
    expect(classifyLocation('deep forest outside the village')).toBe('wilderness');
    expect(classifyLocation('abandoned temple in the mountains')).toBe('structure');
    expect(classifyLocation('the road north')).toBe('road');

    expect(encounterRisk('settlement', 'morning')).toBe('high');
    expect(encounterRisk('settlement', 'night')).toBe('low');
    expect(encounterRisk('wilderness', 'afternoon')).toBe('low');
    expect(encounterRisk('wilderness', 'night')).toBe('none');
    expect(encounterRisk('structure', 'night')).toBe('none');
  });

  test('encounter conditions follow place and time', () => {
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

    expect(formatEncounterConditions(db)).toContain('isolated');

    const village = {
      ...db,
      state: {
        ...db.state,
        location: 'Harbour Market',
        locationKind: 'settlement' as const,
        inStoryDate: { ...db.state.inStoryDate, hour: 14, minute: 0 },
      },
    };

    expect(formatEncounterConditions(village)).toContain('settlement');
    expect(formatEncounterConditions(village)).toContain('crowded');
  });

  test('location_kind flows through the diff and fallback classifier', () => {
    let db = loadSave();
    db = applyTurnDiff(db, { state: { location: 'Harbour Market stalls' } });
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

  test('spoken plans never move the clock', () => {
    const morning = { year: 13, month: 10, day: 4, hour: 10, minute: 0, second: 0 };
    const spoken = detectNarrationTime(
      'Mara does not slow. "Walk until nightfall, Alex Reyes. We rest at dawn, and in two days we cross the border." He waits for your answer.',
      morning
    );
    expect(spoken.clock).toBeUndefined();
    expect(spoken.elapsedSeconds).toBe(0);

    const curly = detectNarrationTime('“We leave the next morning,” he says.', morning);
    expect(curly.elapsedSeconds).toBe(0);
    expect(curly.clock).toBeUndefined();

    // Narration outside the quotes still counts.
    const narrated = detectNarrationTime('"Keep up." You walk until nightfall.', morning);
    expect(narrated.clock).toEqual({ hour: 21, minute: 0 });

    // A quote left open runs to the end of its paragraph only.
    const open = detectNarrationTime('"Until nightfall, then\nTwo hours later, you reach the river.', morning);
    expect(open.clock).toBeUndefined();
    expect(open.elapsedSeconds).toBe(2 * 3600);
  });

  test('allows a word or two between the number and the unit', () => {
    expect(detectNarrationTime('After two relentless hours, the trees thin out.', current).elapsedSeconds).toBe(2 * 3600);
    expect(detectNarrationTime('Three long, cold days later, the border appears.', current).elapsedSeconds).toBe(3 * 86400);
    expect(detectNarrationTime('You spent a few more days in the hideout.', current).elapsedSeconds).toBe(3 * 86400);
    expect(detectNarrationTime('You waited a couple of minutes.', current).elapsedSeconds).toBe(120);
    // Still no elapsed marker, still nothing.
    expect(detectNarrationTime('The two silent men watched for hours.', current).elapsedSeconds).toBe(0);
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

describe('scene pacing and the clock', () => {
  test('infers pace from narration', () => {
    expect(inferScenePace('Alex Reyes chokes a dock guard while the blade whistles past.')).toBe('combat');
    expect(inferScenePace('They rode for two days along the border road.')).toBe('travel');
    expect(inferScenePace('Alex Reyes sleeps until the coals die down.')).toBe('downtime');
    expect(inferScenePace('Mara says nothing and looks away.')).toBe('conversation');
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

    // Two wordings of the same mood keep the portrait.
    const tired = { ...db, state: { ...db.state, mood: 'Numb, guarded, quietly exhausted' } };
    const tiredRecord = { ...record, signature: portraitSignature(tired) };
    const reworded = { ...db, state: { ...db.state, mood: 'Exhausted, numb, quiet' } };
    expect(portraitStaleReason(tiredRecord, portraitSignature(reworded))).toBeNull();

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

describe('character portraits', () => {
  async function setup() {
    const mod = await import('../lib/rpg/characterPortrait');
    const db = seedDatabase('slot_cportrait', 'Character portraits');
    const mara = db.entities.find((entity) => entity.name.startsWith('Mara'))!;
    return { mod, db, mara };
  }

  test('a character portrait goes stale on age, look, expression or a new face reference', async () => {
    const { mod, db, mara } = await setup();
    const signature = mod.characterPortraitSignature(db, mara);
    const withPortrait = mod.addCharacterPortraitToDb(db, mara.id, 'img:a', signature, false);
    const latest = mod.latestCharacterPortrait(withPortrait, mara.id)!;

    expect(mod.characterPortraitStaleReason(null, signature)).toBe('No portrait yet');
    expect(mod.characterPortraitStaleReason(latest, signature)).toBeNull();
    expect(mod.characterPortraitStaleReason(latest, signature, { hasFace: true })).toBe('Face reference added');

    const older = { ...db, state: { ...db.state, inStoryDate: { ...db.state.inStoryDate, year: db.state.inStoryDate.year + 1 } } };
    const olderSig = mod.characterPortraitSignature(older, mara);
    if (signature.age !== null) {
      expect(mod.characterPortraitStaleReason(latest, olderSig)).toBe(`Turned ${signature.age + 1}`);
    }
    // The dead stop ageing and changing.
    expect(mod.characterPortraitStaleReason(latest, olderSig, { dead: true })).toBeNull();

    const restyled = mod.characterPortraitSignature(db, { ...mara, appearance: 'Long black hair, a red leather jacket.' });
    expect(mod.characterPortraitStaleReason(latest, restyled)).toBe('Their look has changed');

    const angry = mod.characterPortraitSignature(db, { ...mara, mood: 'Furious' });
    expect(mod.characterPortraitStaleReason(latest, angry)).toBe('Looks angry now');
  });

  test('only the newest few portraits are kept per person', async () => {
    const { mod, db, mara } = await setup();
    const signature = mod.characterPortraitSignature(db, mara);
    let next = db;
    for (let i = 0; i < mod.PORTRAITS_PER_CHARACTER + 3; i += 1) {
      next = mod.addCharacterPortraitToDb(next, mara.id, `img:${i}`, { ...signature, appearance: `${signature.appearance} ${i}` }, false);
    }
    next = mod.addCharacterPortraitToDb(next, 'someone-else', 'img:other', signature, false);
    expect(mod.characterPortraitsOf(next, mara.id).length).toBe(mod.PORTRAITS_PER_CHARACTER);
    expect(mod.latestCharacterPortrait(next, mara.id)?.image).toBe(`img:${mod.PORTRAITS_PER_CHARACTER + 2}`);
    expect(mod.latestCharacterPortraitMap(next).get('someone-else')).toBe('img:other');
  });

  test('the same painting landing twice is kept once, and a second one cannot start while one runs', async () => {
    const { mod, db, mara } = await setup();
    const signature = mod.characterPortraitSignature(db, mara);
    let next = mod.addCharacterPortraitToDb(db, mara.id, 'img:a', signature, false);
    next = mod.addCharacterPortraitToDb(next, mara.id, 'img:b', signature, false);
    expect(mod.characterPortraitsOf(next, mara.id).map((portrait: { image: string }) => portrait.image)).toEqual(['img:a']);
    expect(mod.alreadyPainted(mod.latestCharacterPortrait(next, mara.id), signature, false)).toBe(true);

    const key = mod.portraitKey(mara.id, signature);
    expect(mod.beginPainting(key)).toBe(true);
    expect(mod.beginPainting(key)).toBe(false);
    mod.endPainting(key);
    expect(mod.beginPainting(key)).toBe(true);
    mod.endPainting(key);
  });

  test('the prompt uses the face reference when sent, the written look otherwise', async () => {
    const { mod, db, mara } = await setup();
    const signature = mod.characterPortraitSignature(db, mara);
    const withFace = mod.buildCharacterPortraitPrompt(db, mara, signature, [{ kind: 'face', uri: 'data:x' }]);
    expect(withFace).toContain(`Reference image 1: this is ${mara.name}.`);
    const bare = mod.buildCharacterPortraitPrompt(db, mara, signature, []);
    expect(bare).not.toContain('Reference image');
    expect(bare).toContain(`Appearance: ${mara.appearance}`);
    expect(bare).toContain('no other people');
  });

  test('face references are set, replaced and removed; merges carry images over', async () => {
    const { mod, db, mara } = await setup();
    const signature = mod.characterPortraitSignature(db, mara);
    let next = mod.setCharacterFaceInDb(db, mara.id, 'img:face1');
    next = mod.setCharacterFaceInDb(next, mara.id, 'img:face2');
    expect(next.characterFaces?.length).toBe(1);
    expect(mod.characterFaceOf(next, mara.id)?.image).toBe('img:face2');
    expect(mod.characterFaceOf(mod.setCharacterFaceInDb(next, mara.id, null), mara.id)).toBeNull();

    // A duplicate "Mara" with a portrait and a face folds into the real one.
    const dupe = { ...mara, id: 'dupe-mara', name: 'The redhead from the bar', aliases: [] };
    let split = { ...db, entities: [...db.entities, dupe] };
    split = mod.addCharacterPortraitToDb(split, dupe.id, 'img:dupe', signature, true);
    split = mod.setCharacterFaceInDb(split, dupe.id, 'img:dupeface');
    const merged = mergeEntityPair(split, mara.id, dupe.id);
    expect(mod.latestCharacterPortrait(merged, mara.id)?.image).toBe('img:dupe');
    expect(mod.characterFaceOf(merged, mara.id)?.image).toBe('img:dupeface');
    expect(mod.characterPortraitsOf(merged, dupe.id).length).toBe(0);
  });

  test('scene images send the faces of people named in the action', async () => {
    const { mod, db, mara } = await setup();
    const { sceneCharacterReferences } = await import('../lib/rpg/image');
    const daniel = db.entities.find((entity) => entity.name.startsWith('Daniel'))!;
    const signature = mod.characterPortraitSignature(db, mara);
    let next = mod.addCharacterPortraitToDb(db, mara.id, 'img:mara-portrait', signature, false);
    next = mod.setCharacterFaceInDb(next, daniel.id, 'img:daniel-face');
    next = mod.addCharacterPortraitToDb(next, daniel.id, 'img:daniel-portrait', signature, true);

    const action = `${daniel.name.split(' ')[0]} grips Alex Reyes's wrist while ${mara.name.split(' ')[0]} watches from the trees.`;
    const refs = sceneCharacterReferences(next, action);
    // Named order, face reference over portrait, nobody who isn't named.
    expect(refs.map((ref) => [ref.name, ref.image, ref.source])).toEqual([
      [daniel.name, 'img:daniel-face', 'face'],
      [mara.name, 'img:mara-portrait', 'portrait'],
    ]);
    expect(sceneCharacterReferences(next, 'Alex Reyes stands alone in the rain.')).toEqual([]);
    expect(sceneCharacterReferences(next, action, 1).length).toBe(1);

    const plan = planReferences(
      [
        { kind: 'face', uri: 'data:player' },
        { kind: 'outfit', uri: 'data:outfit' },
        { kind: 'previous', uri: 'data:old' },
        ...refs.map((ref) => ({ kind: 'character' as const, uri: 'data:' + ref.name, name: ref.name, source: ref.source })),
      ],
      4
    );
    // People outrank older scenes.
    expect(plan.references.map((r) => r.kind)).toEqual(['face', 'outfit', 'character', 'character']);
    const prompt = buildSceneImagePrompt(next, plan.references, action);
    expect(prompt).toContain(`Reference image 3: ${daniel.name}'s face,`);
    expect(prompt).toContain(`Reference image 4: a portrait of ${mara.name}:`);
    expect(prompt).toContain('Identity only');
    expect(prompt).toContain('never give one person another');
  });

  test('character portraits and faces survive normalize', async () => {
    const { mod, db, mara } = await setup();
    const signature = mod.characterPortraitSignature(db, mara);
    const saved = mod.setCharacterFaceInDb(
      mod.addCharacterPortraitToDb(db, mara.id, 'img:p', signature, true),
      mara.id,
      'img:f'
    );
    const normalized = normalizeDatabase({ ...saved, characterFaces: [...(saved.characterFaces ?? []), { bad: true } as never] });
    expect(normalized.characterPortraits?.[0].image).toBe('img:p');
    expect(normalized.characterFaces?.length).toBe(1);
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
      location: 'Coast Road, north of town',
      location_kind: 'road',
      mood: null,
      world_description: null,
      world_point: null,
      inventory_added: ['Takeaway coffee'],
      inventory_removed: [],
      bonds: [{ character: 'Mara Vance', affinity_change: 1, status: null, note: null, relationship: null, attraction: null, romance_note: null }],
      facts: [{ entity: 'Alex Reyes', fact: 'Alex Reyes knows the massacre happened.', type: 'knowledge', who_knows: ['Alex Reyes', 'Mara Vance'] }],
      threads: [{ title: 'Reach the safe house', description: 'You and Mara head for the safe house.', status: 'open' }],
      new_characters: [],
      character_updates: [{ name: 'Mara Vance', mood: 'withdrawn', appearance: null }],
      characters_present: ['Mara Vance'],
      image_worthy: true,
      scene_ended: false,
      timeline_engaged: [],
      timeline_completed: [],
      timeline_passed: [],
      news_relayed: [],
    });

    expect(imageWorthy).toBe(true);
    expect(diff?.imageWorthy).toBe(true);
    expect(diff?.state?.elapsedSeconds).toBe(7200);
    expect(diff?.state?.scenePace).toBe('travel');
    expect(diff?.state?.location).toBe('Coast Road, north of town');
    expect(diff?.state?.locationKind).toBe('road');
    expect(diff?.state?.inventoryAdded).toEqual(['Takeaway coffee']);
    expect(diff?.state?.mood).toBeUndefined();
    expect(diff?.bonds?.[0].affinityDelta).toBe(1);
    expect(diff?.facts?.[0].type).toBe('knowledge');
    expect(diff?.facts?.[0].whoKnows).toEqual(['Alex Reyes', 'Mara Vance']);
    expect(diff?.threads?.[0]).toMatchObject({ action: 'open', title: 'Reach the safe house' });
    expect(diff?.entities?.[0]).toMatchObject({ name: 'Mara Vance', mood: 'withdrawn' });
    expect(diff?.timelineCompleted ?? []).toEqual([]);
  });

  test('an all-unchanged structured reply is no diff', () => {
    const { diff } = convertStateBlock({
      time: { elapsed: null, unit: null, clock_time: null },
      scene_pace: null, location: null, location_kind: null, mood: null,
      world_description: null, world_point: null, inventory_added: [], inventory_removed: [],
      bonds: [], facts: [], threads: [], new_characters: [], character_updates: [],
      characters_present: [], image_worthy: false, scene_ended: false,
      timeline_engaged: [], timeline_completed: [], timeline_passed: [], news_relayed: [],
    });

    expect(diff).toBeNull();
  });

  test('state prompt carries the turn prose and canon ids', () => {
    const db = loadSave();
    const prompt = buildExtractionPrompt(db, '*Alex Reyes follows.*', 'You walk for an hour behind Mara.');
    const user = prompt.messages[1].content;

    expect(prompt.messages[0].content).toContain('state tracker');
    expect(user).toContain('THIS TURN');
    expect(user).toContain('You walk for an hour behind Mara.');
    expect(user).toContain('TIME BEFORE THIS TURN');

    const tracked = [
      ...activeTimelineEvents(db).slice(0, 2).map((event) => event.id),
      ...unheardNews(db, 3).map((item) => item.timelineId),
    ];

    for (const id of tracked) {
      expect(user).toContain(id);
    }
  });

  test('streaming preview hides any code block or JSON a model adds anyway', () => {
    expect(streamingPreview('Rain falls.\n\nMara waits.')).toBe('Rain falls.\n\nMara waits.');
    expect(streamingPreview('Rain falls.\n\n```json\n{"mood"')).toBe('Rain falls.');
    expect(streamingPreview('Rain falls.\n{"state":')).toBe('Rain falls.');
    expect(streamingPreview('Rain falls. "Move," he says.')).toBe('Rain falls. "Move," he says.');
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

  test('Alex Reyes\'s face is the last reference to be left out', () => {
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

  test('a scene without the face reference describes the player in words', () => {
    const db = loadSave();
    const prompt = buildSceneImagePrompt(db, [], 'Alex Reyes stands in the rain.');
    expect(prompt).not.toContain('Reference image');
    expect(prompt).toContain(`Alex Reyes: ${db.state.player.appearance}`);
  });
});

describe('deaths', () => {
  const jonahOf = (db: AppDatabase) => db.entities.find((entity) => entity.name === 'Jonah Pike')!;
  // A timeline event that kills Jonah off-screen on 12 October.
  const withJonahDeath = (db: AppDatabase): AppDatabase => ({
    ...db,
    world: {
      ...db.world,
      timeline: [
        ...db.world.timeline,
        {
          id: 'jonah-dies',
          title: 'Jonah Pike is found in the harbour',
          description: 'The night foreman is pulled out of the water by the container yards.',
          from: { year: 2026, month: 10, day: 12 },
          regionId: 'the-docks',
          location: 'The Docks',
          knowledge: 'public',
          major: true,
          facts: ['Jonah Pike was found dead in the harbour.'],
          deaths: ['Jonah Pike'],
        },
      ],
    },
  });
  // The world moves on to 13 October: Jonah's death fires off-screen.
  const afterJonah = (db: AppDatabase) =>
    advanceTimeline(
      { ...withJonahDeath(db), state: { ...db.state, inStoryDate: { year: 2026, month: 10, day: 13, hour: 8, minute: 0, second: 0 } } },
      { inCombat: false }
    );

  test('the seeded dead are recorded and known; the living are not dead', () => {
    const db = loadSave();
    const theo = db.entities.find((entity) => entity.name === 'Theo Marsh')!;
    const daniel = db.entities.find((entity) => entity.name === 'Daniel Okafor')!;

    expect(isDeceased(theo)).toBe(true);
    expect(playerKnowsDeath(db, theo)).toBe(true);
    expect(isDeceased(daniel)).toBe(false);
  });

  test('a timeline death marks the record, and the player knows only once the news reaches them', () => {
    let db = withJonahDeath(loadSave());
    db = applyTimelineMarks(db, ['jonah-dies'], []);
    // completed = witnessed
    expect(isDeceased(jonahOf(db))).toBe(true);
    expect(playerKnowsDeath(db, jonahOf(db))).toBe(true);

    let fresh = afterJonah(loadSave());
    expect(isDeceased(jonahOf(fresh))).toBe(true);
    expect(playerKnowsDeath(fresh, jonahOf(fresh))).toBe(false);
    fresh = markNewsHeard(fresh, [{ id: 'jonah-dies', from: 'mara-vance' }]);
    expect(playerKnowsDeath(fresh, jonahOf(fresh))).toBe(true);
  });

  test('timeline deaths use exact names only', () => {
    let db = loadSave();
    db = applyEntityDiff(db, { name: 'Jonah Pike Junior', isNew: true, role: 'Dock hand' });
    db = markDeathsByName(db, ['Jonah Pik', 'Pike'], {});
    expect(isDeceased(jonahOf(db))).toBe(false);
    expect(isDeceased(db.entities.find((e) => e.name === 'Jonah Pike Junior')!)).toBe(false);
  });

  test('the state tracker reports a death on screen, including someone new this turn', () => {
    let db = loadSave();
    const { diff } = convertStateBlock({
      new_characters: [{ is_new: true, name: 'Goro the Mugger', age: 30, role: 'Mugger', personality: null, speech_style: null, appearance: null }],
      deaths: [
        { character_id: 'Goro the Mugger', cause: 'Fell from the quay in the struggle' },
        { character_id: 'jonah-pike', cause: null },
        { character_id: 'player', cause: null },
        { character_id: 'nobody-at-all', cause: null },
      ],
    });

    db = applyTurnDiff(db, resolveCharacterRefs(db, diff as TurnDiff));

    const goro = db.entities.find((entity) => entity.name === 'Goro the Mugger')!;
    expect(goro.deceased?.known).toBe(true);
    expect(goro.deceased?.cause).toBe('Fell from the quay in the struggle');
    expect(isDeceased(jonahOf(db))).toBe(true);
    expect(isDeceased(db.entities.find((e) => e.name === 'Alex Reyes')!)).toBe(false);
  });

  test('being told of a death makes it known; revived brings them back', () => {
    let db = loadSave();
    const danielId = db.entities.find((entity) => entity.name === 'Daniel Okafor')!.id;
    const { diff } = convertStateBlock({ deaths: [{ character_id: 'daniel-okafor', cause: null }] });
    db = applyTurnDiff(db, resolveCharacterRefs(db, diff as TurnDiff));
    expect(playerKnowsDeath(db, db.entities.find((e) => e.id === danielId)!)).toBe(true);

    db = afterJonah(db);
    expect(isDeceased(jonahOf(db))).toBe(true);
    const back = convertStateBlock({ revived: ['jonah-pike'] }).diff;
    db = applyTurnDiff(db, resolveCharacterRefs(db, back as TurnDiff));
    expect(isDeceased(jonahOf(db))).toBe(false);
    // Reloading never kills a revived person again.
    expect(isDeceased(jonahOf(normalizeDatabase(db)))).toBe(false);
  });

  test('the dead are not "seen", and loading backfills deaths for older saves', () => {
    let db = afterJonah(loadSave());
    const before = jonahOf(db).lastSeen;
    db = applyTurnDiff(db, { scene: { ended: false, entities: ['Jonah Pike'] } });
    expect(jonahOf(db).lastSeen).toEqual(before);

    const old = {
      ...db,
      entities: db.entities.map((entity) => {
        const { deceased: _d, ...rest } = entity;
        return entity.name === 'Jonah Pike' ? rest : entity;
      }),
    };
    expect(isDeceased(jonahOf(normalizeDatabase(old)))).toBe(true);
  });

  test('every turn the narrator and the state tracker see who is dead', () => {
    let db = afterJonah(loadSave());
    db = { ...db, facts: [...Array(30)].map((_, index) => ({ ...db.facts[0], id: `f${index}`, text: `Filler fact ${index}` })).concat(db.facts) };

    const narration = buildNarrationPrompt(db, '*You wait.*').messages.map((m) => m.content).join('\n');
    expect(narration).toContain('THE DEAD');
    expect(narration).toContain('- Jonah Pike (you do not know yet)');
    expect(narration).toContain('- Theo Marsh');

    const state = buildExtractionPrompt(db, '*You wait.*', 'Rain falls.').messages.map((m) => m.content).join('\n');
    expect(state).toMatch(/- jonah-pike: Jonah Pike.*deceased, you do not know yet\]/);
    expect(JSON.stringify(TURN_STATE_SCHEMA)).toContain('"deaths"');
  });

  test('death names resolve to people in the cast', () => {
    const db = loadSave();
    for (const name of ['Mara Vance', 'Jonah Pike', 'Daniel Okafor']) {
      const marked = markDeathsByName(db, [name], {});
      expect(marked).not.toBe(db);
    }
  });
});

describe('characters who come back', () => {
  const { returningCandidates, pickReturningCharacter, isReturnTurn, formatReturningCharacter, RETURN_WINDOW_TURNS } =
    require('../lib/rpg/returning') as typeof import('../lib/rpg/returning');

  function withOriginal(overrides: Partial<AppDatabase['entities'][number]> = {}) {
    const db = loadSave();
    const lastSeen = { ...db.state.inStoryDate, year: db.state.inStoryDate.year - 1 };

    return {
      ...db,
      state: {
        ...db.state,
        location: 'Tanzaku Town gambling district',
        locationKind: 'settlement' as const,
        scenePace: 'downtime' as const,
        sceneCast: [],
        inStoryDate: { ...db.state.inStoryDate, hour: 14, minute: 0 },
      },
      entities: [
        ...db.entities,
        {
          id: 'entity_mei',
          name: 'Mei Tanaka',
          type: 'character' as const,
          aliases: ['Mei'],
          role: 'Teahouse owner',
          personality: 'Sharp-tongued, kind underneath.',
          lastSeen,
          lastSeenAt: 'a teahouse in Tanzaku Town',
          tags: [],
          ...overrides,
        },
      ],
    };
  }

  function atReturnTurn(db: AppDatabase): AppDatabase {
    for (let turn = 6; turn < 6 + RETURN_WINDOW_TURNS * 3; turn += 1) {
      const log = Array.from({ length: turn }, (_, index) => ({
        id: `log_${index}`,
        turn: index,
        kind: 'story' as const,
        role: 'user' as const,
        content: 'I look around.',
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        chapter: 1,
        scene: 'test',
        inStoryDate: db.state.inStoryDate,
        createdAt: 0,
      }));
      const candidate = { ...db, rawLog: log };

      if (isReturnTurn(candidate)) {
        return candidate;
      }
    }

    throw new Error('no return turn found');
  }

  test('an original last seen here long ago is a candidate', () => {
    const db = withOriginal();
    const candidates = returningCandidates(db);

    expect(candidates.map((offer) => offer.entity.name)).toContain('Mei Tanaka');
    expect(candidates[0].reason).toBe('last-seen-here');
  });

  test('canon cast, the recently seen, the dead and people elsewhere are never offered', () => {
    const db = withOriginal();

    for (const offer of returningCandidates(db)) {
      expect(offer.entity.tags).not.toContain('canon');
      expect(offer.entity.name).not.toBe('Alex Reyes');
    }

    expect(returningCandidates(withOriginal({ lastSeen: db.state.inStoryDate }))).toHaveLength(0);
    expect(returningCandidates(withOriginal({ status: 'Deceased' }))).toHaveLength(0);
    expect(returningCandidates(withOriginal({ lastSeenAt: 'the Hidden Mist Village', role: 'Fisherman' }))).toHaveLength(0);
    expect(returningCandidates(withOriginal(), 'Mei waved at you yesterday.')).toHaveLength(0);
  });

  test('travellers can turn up on roads and in towns', () => {
    const db = withOriginal({ lastSeenAt: 'the Hidden Mist Village', role: 'Wandering merchant' });

    expect(returningCandidates(db)[0]?.reason).toBe('traveller');
  });

  test('offers are occasional, deterministic and skipped in fights or empty places', () => {
    const db = atReturnTurn(withOriginal());

    expect(pickReturningCharacter(db)?.entity.name).toBe('Mei Tanaka');
    expect(pickReturningCharacter(db)?.entity.id).toBe(pickReturningCharacter(db)?.entity.id);
    expect(formatReturningCharacter(db)).toContain('A FAMILIAR FACE');
    expect(formatReturningCharacter(db)).toContain('Mei Tanaka');

    const fight = { ...db, state: { ...db.state, scenePace: 'combat' as const } };
    expect(pickReturningCharacter(fight)).toBeNull();

    const empty = { ...db, state: { ...db.state, locationKind: 'wilderness' as const, inStoryDate: { ...db.state.inStoryDate, hour: 23 } } };
    expect(pickReturningCharacter(empty)).toBeNull();

    // At most one offer turn per window.
    let offers = 0;
    for (let turn = 0; turn < RETURN_WINDOW_TURNS; turn += 1) {
      if (isReturnTurn(db, RETURN_WINDOW_TURNS * 5 + turn)) offers += 1;
    }
    expect(offers).toBe(1);
  });

  test('presence records where Alex Reyes saw someone', () => {
    let db = withOriginal({ lastSeenAt: undefined });
    db = applyTurnDiff(db, { state: { location: 'Northgate' }, scene: { entities: ['Mei Tanaka'] } } as TurnDiff);

    expect(db.entities.find((entity) => entity.id === 'entity_mei')?.lastSeenAt).toBe('Northgate');
  });
});

import {
  BOND_POINTS_PER_STEP,
  MAX_COMPANIONS,
  SHARED_TIME_AFFINITY_CAP,
  companionsOf,
  setCompanion,
} from '../lib/rpg/companions';

describe('companions', () => {
  const maraOf = (db: AppDatabase) => db.entities.find((entity) => entity.name === 'Mara Vance')!;
  const bondOf = (db: AppDatabase, id: string) => db.bonds.find((bond) => bond.entityId === id);
  const withMara = () => {
    const db = loadSave();
    const id = maraOf(db).id;

    return { db: applyTurnDiff(db, { companionsJoined: [{ entityId: id, name: 'Mara Vance', reason: 'leaving town together' }] }), id };
  };

  test('the state reply joins and parts companions', () => {
    const block = {
      companions_joined: [{ character_id: 'mara-vance', reason: 'leaving together' }],
      companions_left: [{ character_id: 'player', reason: null }],
    };
    const db = loadSave();
    const { diff } = convertStateBlock(block, statePlayerOf(db));

    expect(diff?.companionsJoined).toEqual([{ name: 'mara-vance', reason: 'leaving together' }]);
    expect(diff?.companionsLeft).toBeUndefined();

    const resolved = resolveCharacterRefs(db, diff!);
    expect(resolved.companionsJoined?.[0].entityId).toBe(maraOf(db).id);
    expect(TURN_STATE_SCHEMA.required).toContain('companions_joined');
    expect(TURN_STATE_SCHEMA.required).toContain('companions_left');
  });

  test('a companion is in every scene, even when the tracker leaves them out', () => {
    const { db, id } = withMara();

    expect(companionsOf(db).map((entity) => entity.id)).toEqual([id]);
    expect(maraOf(db).companion?.reason).toBe('leaving town together');
    expect(bondOf(db, id)).toBeDefined();
    expect(db.facts.some((fact) => fact.text.startsWith('Mara Vance began travelling with you'))).toBe(true);

    const later = applyTurnDiff(db, {
      state: { sceneCast: ['Jonah Pike'], elapsedSeconds: 3600 },
      scene: { ended: true, entities: ['Jonah Pike'] },
    });

    expect(later.state.sceneCast).toContain('Mara Vance');
    expect(later.state.sceneCast?.[0]).toBe('Mara Vance');
    expect(dateSortValue(maraOf(later).lastSeen!)).toBe(dateSortValue(later.state.inStoryDate));

    const scene = later.events[later.events.length - 1];
    expect(later.eventEntities.some((link) => link.eventId === scene.id && link.entityId === id)).toBe(true);
    expect(maraOf(later).companion?.sharedScenes).toBe(1);

    // A bare clock step (time correction path) still keeps them present.
    const tick = applyTurnDiff(db, { state: { elapsedSeconds: 60 } });
    expect(tick.state.sceneCast).toContain('Mara Vance');
  });

  test('shared scenes slowly build the bond; the story moving it resets the count', () => {
    let { db, id } = withMara();
    db = { ...db, bonds: db.bonds.map((bond) => (bond.entityId === id ? { ...bond, affinity: 2 } : bond)) };
    const start = 2;

    // Calm scenes: one point each.
    for (let index = 0; index < BOND_POINTS_PER_STEP; index += 1) {
      db = applyTurnDiff(db, { state: { scenePace: 'conversation' }, scene: { ended: true } });
    }
    expect(bondOf(db, id)!.affinity).toBe(start + 1);

    // A fight survived together counts double.
    db = applyTurnDiff(db, { state: { scenePace: 'combat' }, scene: { ended: true } });
    expect(maraOf(db).companion?.bondPoints).toBe(2);

    // The story moved the bond itself: no extra drift, count starts over.
    db = applyTurnDiff(db, {
      state: { scenePace: 'combat' },
      bonds: [{ entityId: id, character: 'Mara Vance', affinityDelta: -2 }],
      scene: { ended: true },
    });
    expect(bondOf(db, id)!.affinity).toBe(start - 1);
    expect(maraOf(db).companion?.bondPoints).toBe(0);

    // Time alone never pushes past the cap.
    db = { ...db, bonds: db.bonds.map((bond) => (bond.entityId === id ? { ...bond, affinity: SHARED_TIME_AFFINITY_CAP } : bond)) };
    for (let index = 0; index < BOND_POINTS_PER_STEP * 3; index += 1) {
      db = applyTurnDiff(db, { scene: { ended: true } });
    }
    expect(bondOf(db, id)!.affinity).toBe(SHARED_TIME_AFFINITY_CAP);
  });

  test('time together does not soften real hostility', () => {
    let { db, id } = withMara();
    db = { ...db, bonds: db.bonds.map((bond) => (bond.entityId === id ? { ...bond, affinity: -5 } : bond)) };

    for (let index = 0; index < BOND_POINTS_PER_STEP * 2; index += 1) {
      db = applyTurnDiff(db, { scene: { ended: true } });
    }

    expect(bondOf(db, id)!.affinity).toBe(-5);
  });

  test('companions leave when the story parts them, or when they die', () => {
    const { db, id } = withMara();
    const parted = applyTurnDiff(db, {
      state: { sceneCast: ['Mara Vance'] },
      companionsLeft: [{ entityId: id, name: 'Mara Vance', reason: 'called away by her family' }],
    });

    expect(companionsOf(parted)).toHaveLength(0);
    expect(parted.state.sceneCast ?? []).not.toContain('Mara Vance');
    expect(parted.facts.some((fact) => fact.text.startsWith('Mara Vance parted ways with you'))).toBe(true);

    const died = applyTurnDiff(db, { deaths: [{ entityId: id, name: 'Mara Vance', cause: 'illness' }] });
    expect(companionsOf(died)).toHaveLength(0);
    expect(maraOf(died).companion).toBeUndefined();
  });

  test('a person introduced this turn can join at once; Alex Reyes and the dead never join', () => {
    const db = loadSave();
    const raw = convertStateBlock({
      new_characters: [{ is_new: true, name: 'Rokuro Tanabe', age: 30, role: 'Ferryman', personality: null, speech_style: null, appearance: null }],
      companions_joined: [{ character_id: 'Rokuro Tanabe', reason: 'hired as a guide' }],
      characters_present: ['Rokuro Tanabe'],
    }).diff!;
    const next = applyTurnDiff(db, resolveCharacterRefs(db, raw));

    expect(companionsOf(next).map((entity) => entity.name)).toEqual(['Rokuro Tanabe']);

    const player = db.entities.find((entity) => entity.name === 'Alex Reyes')!;
    expect(setCompanion(db, player.id, true)).toBe(db);

    const dead = db.entities.find((entity) => entity.deceased)!;
    expect(setCompanion(db, dead.id, true)).toBe(db);
  });

  test('the party has a size limit', () => {
    let db = loadSave();
    for (const name of ['Rosa Lind', 'Sam Okoro', 'Ivo Brandt']) {
      db = applyEntityDiff(db, { name, isNew: true, role: 'Friend' });
    }
    const people = db.entities.filter((entity) => entity.type === 'character' && entity.name !== 'Alex Reyes' && !entity.deceased);

    for (const person of people.slice(0, MAX_COMPANIONS + 2)) {
      db = setCompanion(db, person.id, true);
    }

    expect(companionsOf(db)).toHaveLength(MAX_COMPANIONS);
    expect(db.state.sceneCast!.length).toBeLessThanOrEqual(6);
  });

  test('both prompts know who travels with Alex Reyes', () => {
    const { db } = withMara();
    const narration = buildNarrationPrompt(db, '"We move at dawn."');
    const system = narration.messages[0].content;
    const user = narration.messages[1].content;

    expect(system).toContain("TRAVELLING WITH YOU is physically at the player's side in every scene");
    expect(user).toContain('TRAVELLING WITH YOU (at your side');
    expect(user).toMatch(/- Mara Vance: joined today \(leaving town together/);
    expect(user).toContain('CHARACTERS IN SCENE');
    expect(JSON.stringify(narration.messages)).not.toContain('companions_joined');

    const state = buildExtractionPrompt(db, 'We move.', 'You walk on beside Mara.');
    const stateText = state.messages.map((message) => message.content).join('\n');
    expect(stateText).toContain('TRAVELLING WITH YOU: mara-vance (Mara Vance)');
    expect(stateText).toContain('[travelling with you]');
    expect(stateText).toContain('companions_joined');

    const alone = buildExtractionPrompt(loadSave(), 'Wait.', 'You wait.');
    expect(alone.messages[1].content).toContain('TRAVELLING WITH YOU: nobody');
  });

  test('companions survive a merge and a reload', () => {
    const { db, id } = withMara();
    const reloaded = normalizeDatabase(JSON.parse(JSON.stringify(db)));
    expect(companionsOf(reloaded).map((entity) => entity.id)).toEqual([id]);

    const duplicate = applyEntityDiff(reloaded, { isNew: true, name: 'Hayate Moriya' });
    const dupId = duplicate.entities.find((entity) => entity.name === 'Hayate Moriya')!.id;
    const merged = mergeEntityPair(duplicate, dupId, id);
    expect(companionsOf(merged).map((entity) => entity.id)).toEqual([dupId]);
  });
});

describe('personal letters', () => {
  // Post only: a text message would arrive at once.
  const loadSave = (): AppDatabase => {
    const db = loadSaveBase();
    return { ...db, world: { ...db.world, letterCarriers: ['post'], factions: db.world.factions.map((faction) => ({ ...faction, carriers: undefined })) } };
  };
  const hanaOf = (db: AppDatabase) => db.entities.find((entity) => entity.name === 'Daniel Okafor')!;
  const later = (db: AppDatabase, days: number): AppDatabase => ({
    ...db,
    state: { ...db.state, inStoryDate: shiftDate(db.state.inStoryDate, days), scenePace: 'downtime' },
  });
  const affinity = (db: AppDatabase, id: string) => db.bonds.find((bond) => bond.entityId === id)?.affinity ?? 0;

  test('Alex Reyes writes to Daniel: it travels, arrives, moves the bond, and she writes back', () => {
    let db: AppDatabase = { ...loadSave(), state: { ...loadSave().state, sceneCast: [] } };
    const daniel = hanaOf(db);
    const before = affinity(db, daniel.id);

    db = sendLetters(db, [{ entityId: daniel.id, name: daniel.name, gist: 'you are alive and sorry you left' }]);
    expect(db.state.post!.letters).toHaveLength(1);
    expect(db.state.post!.letters[0]).toMatchObject({ direction: 'from-player', status: 'travelling' });

    // Not there yet the same day (a letter by post takes at least a day).
    db = deliverLetters(db);
    expect(affinity(db, daniel.id)).toBe(before);

    db = deliverLetters(later(db, LETTER_MAX_DAYS));
    expect(affinity(db, daniel.id)).toBe(Math.min(10, before + LETTER_BOND_GAIN));
    expect(db.facts.some((fact) => fact.text.includes('Daniel Okafor received a letter from you'))).toBe(true);

    const reply = db.state.post!.letters.find((letter) => letter.direction === 'to-player')!;
    expect(reply.status).toBe('travelling');

    db = later(db, LETTER_MAX_DAYS + 1);
    const offer = letterOffer(db)!;
    expect(offer.kind).toBe('reply');
    expect(offer.entity.id).toBe(daniel.id);

    const prompt = buildNarrationPrompt(db, '*Alex Reyes waits.*').messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('A LETTER FOR YOU');
    expect(prompt).toContain('answering the letter you sent (you are alive and sorry you left)');
    expect(buildExtractionPrompt(db, '*Alex Reyes reads.*', 'A ninken finds you.').messages[1].content).toContain('letters_received');

    db = receiveLetters(db, [{ entityId: daniel.id, name: daniel.name }]);
    expect(db.state.post!.letters.find((letter) => letter.id === reply.id)!.status).toBe('delivered');
    expect(db.state.post!.lastLetterIn).toEqual(db.state.inStoryDate);
    // The post goes quiet for a while after a letter.
    expect(letterOffer(later(db, 2))).toBeNull();
  });

  test('someone close writes unprompted after a while apart, never mid-fight', () => {
    const base = loadSave();
    // Mara is close enough to write.
    const seed = { ...base, bonds: base.bonds.map((bond) => (bond.characterName === 'Mara Vance' ? { ...bond, affinity: 7 } : bond)) };
    const db = later({ ...seed, state: { ...seed.state, sceneCast: [] } }, 40);
    const offer = letterOffer(db);
    expect(offer?.kind).toBe('unprompted');
    expect(offer!.entity.name).toBe('Mara Vance');

    expect(letterOffer({ ...db, state: { ...db.state, scenePace: 'combat' } })).toBeNull();
    // Too soon after the story starts: nothing yet.
    expect(letterOffer(later({ ...seed, state: { ...seed.state, sceneCast: [] } }, 3))).toBeNull();
  });

  test('a letter to someone who died is lost, with no reply', () => {
    let db: AppDatabase = { ...loadSave(), state: { ...loadSave().state, sceneCast: [] } };
    const daniel = hanaOf(db);
    db = sendLetters(db, [{ entityId: daniel.id, name: daniel.name }]);
    db = { ...db, entities: db.entities.map((entity) => (entity.id === daniel.id ? { ...entity, deceased: { known: false } } : entity)) };
    db = deliverLetters(later(db, LETTER_MAX_DAYS + 1));
    expect(db.state.post!.letters[0].status).toBe('lost');
    expect(db.state.post!.letters.some((letter) => letter.direction === 'to-player')).toBe(false);
  });

  test('the state block carries letters, resolved to known people', () => {
    const db = loadSave();
    const { diff } = convertStateBlock({
      letters_sent: [{ to: 'daniel-okafor', gist: 'meet me at the old bridge' }],
      letters_received: ['daniel-okafor'],
    });
    const resolved = resolveCharacterRefs(db, diff!);
    expect(resolved.lettersSent?.[0]).toMatchObject({ name: 'Daniel Okafor', gist: 'meet me at the old bridge' });
    expect(resolved.lettersReceived?.[0].name).toBe('Daniel Okafor');
    expect(TURN_STATE_SCHEMA.required).toEqual(expect.arrayContaining(['letters_sent', 'letters_received']));
  });

  test('saves keep their post through a reload', () => {
    let db: AppDatabase = { ...loadSave(), state: { ...loadSave().state, sceneCast: [] } };
    const daniel = hanaOf(db);
    db = sendLetters(db, [{ entityId: daniel.id, name: daniel.name }]);
    const reloaded = normalizeDatabase(JSON.parse(JSON.stringify(db)));
    expect(reloaded.state.post?.letters).toHaveLength(1);
  });
});

describe('clock, prompt memory and people (from the old canon blocks)', () => {
  test('recent messages keep the newest narration ending', () => {
    let db = loadSave();
    const longNarration = `${'The rain falls. '.repeat(150)}FINAL BEAT: the masked man turns away and vanishes.`;

    db = appendStoryMessage(db, 'assistant', longNarration, 'm', 0, 0);
    const prompt = buildNarrationPrompt(db, '*Alex Reyes watches.*');
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

    const prompt = buildNarrationPrompt(db, '*Alex Reyes waits.*');
    expect(prompt.estimatedTokens).toBeLessThanOrEqual(db.settings.promptTokenBudget);
    expect(prompt.recentMessages.length).toBeGreaterThanOrEqual(4);
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


  test('a stated duration beats a guessed clock_time', () => {
    const current = { year: 13, month: 10, day: 4, hour: 8, minute: 0, second: 0 };
    // "Two relentless hours" + a guessed 14:00 used to move six hours.
    const guessed = resolveTurnClock({
      reportedSeconds: 2 * 3600,
      reportedClock: { hour: 14, minute: 0 },
      detected: detectNarrationTime('After two relentless hours, the trees thin out.', current),
      pace: 'travel',
      sceneEnded: false,
      current,
    });
    expect(guessed.elapsedSeconds).toBe(2 * 3600);

    // A reported clock that fits the duration still lands.
    const fits = resolveTurnClock({
      reportedSeconds: 2 * 3600,
      reportedClock: { hour: 10, minute: 15 },
      detected: { elapsedSeconds: 0 },
      pace: 'travel',
      sceneEnded: false,
      current,
    });
    expect(fits.elapsedSeconds).toBe(2 * 3600 + 15 * 60);

    // An hour the prose names still wins over the duration.
    const named = resolveTurnClock({
      reportedSeconds: 2 * 3600,
      detected: detectNarrationTime('Two hours later, by dusk, you reach the river.', current),
      pace: 'travel',
      sceneEnded: false,
      current,
    });
    expect(named.elapsedSeconds).toBe(11 * 3600);

    // With no duration, a reported clock never rolls into tomorrow.
    const backwards = resolveTurnClock({
      reportedSeconds: 0,
      reportedClock: { hour: 6, minute: 0 },
      detected: { elapsedSeconds: 0 },
      pace: 'conversation',
      sceneEnded: false,
      current,
    });
    expect(backwards.elapsedSeconds).toBe(120);
  });


  test('an order in dialogue does not jump the clock', () => {
    const current = { year: 13, month: 10, day: 4, hour: 10, minute: 0, second: 0 };
    const prose = 'Mara looks back once. "Walk until nightfall, Alex Reyes." The forest is quiet.';
    const result = resolveTurnClock({
      reportedSeconds: 0,
      detected: detectNarrationTime(prose, current),
      pace: 'conversation',
      sceneEnded: false,
      current,
    });
    expect(result.elapsedSeconds).toBe(120);
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

  test('the state prompt lists everyone by id', () => {
    const db = loadSave();
    const prompt = buildExtractionPrompt(db, 'I nod.', 'Jonah grins at you.')
      .messages.map((message) => message.content)
      .join('\n');

    expect(prompt).toContain('KNOWN CHARACTERS');
    expect(prompt).toContain('- jonah-pike: Jonah Pike (Jonah) [not met yet]');
    expect(prompt).toContain('- mara-vance: Mara Vance');
    expect(prompt).toContain('CHARACTERS IN THIS TURN');
    expect(TURN_STATE_SCHEMA.properties.bonds.items.properties).toHaveProperty('character_id');
    expect(TURN_STATE_SCHEMA.properties.new_characters.items.properties).toHaveProperty('is_new');
  });


  test('ids resolve to known people; only is_new adds someone', () => {
    let db = loadSave();
    const before = db.entities.length;
    const { diff } = convertStateBlock({
      characters_present: ['jonah-pike', 'mara-vance', 'Haku the Fisherman'],
      bonds: [
        { character_id: 'jonah-pike', affinity_change: 1, status: 'Wary', note: null, relationship: null, attraction: null, romance_note: null },
        { character_id: 'some-stranger', affinity_change: 2, status: null, note: null, relationship: null, attraction: null, romance_note: null },
      ],
      new_characters: [
        { is_new: false, name: 'Jonah', age: 30, role: null, personality: null, speech_style: null, appearance: null },
        { is_new: true, name: 'Jonah Pike', age: null, role: 'Foreman', personality: null, speech_style: null, appearance: null },
        { is_new: true, name: 'Haku the Fisherman', age: 50, role: 'Ferryman', personality: null, speech_style: null, appearance: null },
      ],
      character_updates: [
        { character_id: 'mara-vance', mood: 'tired', appearance: null },
        { character_id: 'nobody-at-all', mood: 'angry', appearance: null },
      ],
    });

    db = applyTurnDiff(db, resolveCharacterRefs(db, diff as TurnDiff));

    const jonah = db.entities.find((entity) => entity.name === 'Jonah Pike');

    expect(db.entities.filter((entity) => entity.name === 'Jonah Pike')).toHaveLength(1);
    expect(jonah?.met).toBe(true);
    expect(db.bonds.find((bond) => bond.entityId === jonah?.id)?.status).toBe('Wary');
    expect(db.bonds.some((bond) => bond.characterName === 'some-stranger')).toBe(false);
    expect(db.entities.length).toBe(before + 1);
    expect(db.entities.some((entity) => entity.name === 'Haku the Fisherman')).toBe(true);
    expect(db.entities.find((entity) => entity.name === 'Mara Vance')?.mood).toBe('tired');
    expect(db.state.sceneCast).toEqual(['Jonah Pike', 'Mara Vance', 'Haku the Fisherman']);
  });


  test('merging folds one person into another', () => {
    let db = loadSave();
    db = applyEntityDiff(db, { name: 'Shark-faced man', isNew: true, role: 'Swordsman' });
    // Met in a scene: the scene cast is what makes him met and gives him a bond.
    db = applyTurnDiff(db, {
      scene: { ended: false, entities: ['Shark-faced man'] },
      bonds: [{ character: 'Shark-faced man', affinityDelta: 3, status: 'Respect' }],
    });

    const shark = db.entities.find((entity) => entity.name === 'Shark-faced man')!;
    const jonah = db.entities.find((entity) => entity.name === 'Jonah Pike')!;

    db = mergeEntityPair(db, jonah.id, shark.id);

    const merged = db.entities.find((entity) => entity.id === jonah.id);

    expect(db.entities.some((entity) => entity.id === shark.id)).toBe(false);
    expect(merged?.aliases).toContain('Shark-faced man');
    expect(merged?.met).toBeUndefined();
    expect(db.bonds.filter((bond) => bond.entityId === jonah.id).length).toBe(1);
    expect(db.bonds.find((bond) => bond.entityId === jonah.id)?.affinity).toBe(3);
    expect(resolveEntity(db, 'Shark-faced man')?.id).toBe(jonah.id);
  });

  test('the narrator gets no dice roll and no style guard', () => {
    const db = loadSave();
    const prompt = buildNarrationPrompt(db, '*You wait.*');
    const text = prompt.messages.map((m) => m.content).join('\n');

    expect(text).not.toContain('ENCOUNTER HINT');
    expect(text).not.toContain('d20');
    expect(text).not.toContain('STYLE GUARD');
    expect(text).toContain('ENCOUNTER CONDITIONS');
    expect(NARRATION_SYSTEM).toContain('never reuse a description');
  });


});
