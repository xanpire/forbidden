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
import { appendStoryMessage } from '../lib/rpg/log';
import { applySummaryJob, unsummarizedStory } from '../lib/rpg/memoryJobs';
import { applyTurnDiff } from '../lib/rpg/services';
import { seedDatabase } from './fixtures/seed';
import { convertStateBlock } from '../lib/rpg/stateBlock';
import { TURN_STATE_SCHEMA } from '../lib/rpg/stateSchema';
import { parseTitledSummary, shortTitle, titleAndBody } from '../lib/rpg/util';
import type { AppDatabase, MemoryJob } from '../lib/rpg/types';

function withStory(count: number): AppDatabase {
  let db = normalizeDatabase(seedDatabase('slot_journal', 'Journal'));

  for (let index = 0; index < count; index += 1) {
    db = appendStoryMessage(
      db,
      index % 2 === 0 ? 'user' : 'assistant',
      `Message ${index}. The rain keeps falling on the road north.`,
      null,
      0,
      0
    );
  }

  return db;
}

function sceneJob(db: AppDatabase, logIds: string[]): { db: AppDatabase; job: MemoryJob } {
  const job: MemoryJob = {
    id: `memjob_${logIds[0]}`,
    kind: 'scene',
    status: 'queued',
    turnLogId: logIds[logIds.length - 1],
    logIds,
    attempts: 0,
    createdAt: Date.now(),
  };
  return { db: { ...db, memoryJobs: [...(db.memoryJobs ?? []), job] }, job };
}

const SUMMARY =
  'You follow Mara north through the rain. He says little, and you do not press him. By nightfall you reach an empty shrine and sleep under its broken roof.';

describe('summary replies', () => {
  test('reads TITLE / MEMORY / SUMMARY', () => {
    const parsed = parseTitledSummary(
      `TITLE: North through the rain\nMEMORY: You walk north with Mara and sleep in a ruined shrine.\nSUMMARY: ${SUMMARY}`
    );
    expect(parsed?.title).toBe('North through the rain');
    expect(parsed?.memory).toBe('You walk north with Mara and sleep in a ruined shrine.');
    expect(parsed?.summary).toBe(SUMMARY);
  });

  test('accepts bold labels and a reply without labels', () => {
    expect(parseTitledSummary(`**TITLE:** The shrine\n**SUMMARY:** ${SUMMARY}`)?.title).toBe('The shrine');
    const plain = parseTitledSummary(SUMMARY);
    expect(plain?.title).toBeNull();
    expect(plain?.summary).toBe(SUMMARY);
  });

  test('a reply cut off before its summary is empty, and a cut-off summary ends on a sentence', () => {
    expect(parseTitledSummary('TITLE: The shrine\nMEMORY: You sleep.')).toBeNull();
    const cut = parseTitledSummary(`TITLE: The shrine\nSUMMARY: ${SUMMARY} Before dawn you wake to`);
    expect(cut?.summary).toBe(SUMMARY);
  });
});

describe('journal titles', () => {
  test('long text without a short sentence becomes a short title plus the rest', () => {
    const prose =
      'The rain had not stopped since the city lights fell behind you, and every step north along the coast road felt heavier than the last, mud sucking at your boots';
    const { title, body } = titleAndBody(prose);
    expect(title.length).toBeLessThanOrEqual(62);
    expect(title.endsWith('…')).toBe(true);
    expect(body?.startsWith('…')).toBe(true);
    // Nothing lost: title and body together hold the whole text.
    expect(`${title.slice(0, -1)} ${body!.slice(1)}`.replace(/\s+/g, ' ')).toBe(prose);
  });

  test('a short first sentence is still the title', () => {
    expect(titleAndBody(SUMMARY).title).toBe('You follow Mara north through the rain.');
    expect(shortTitle(SUMMARY)).toBe('You follow Mara north through the rain');
  });
});

describe('scene title', () => {
  test('is in the state schema and moves the scene name', () => {
    expect(TURN_STATE_SCHEMA.properties).toHaveProperty('scene_title');
    expect(TURN_STATE_SCHEMA.required).toContain('scene_title');

    const { diff } = convertStateBlock({ scene_title: '"Ambush at the river ford."' });
    expect(diff?.state?.scene).toBe('Ambush at the river ford');

    const db = withStory(2);
    expect(applyTurnDiff(db, diff).state.scene).toBe('Ambush at the river ford');
  });

  test('a scene that ends while a new one is named keeps its own name as the memory title', () => {
    const db = withStory(2);
    const before = db.state.scene;
    const { diff } = convertStateBlock({ scene_ended: true, scene_title: 'The road north' });
    const next = applyTurnDiff(db, diff);
    const memory = next.events[next.events.length - 1];
    expect(memory.title).toBe(before);
    expect(next.state.scene).toBe('The road north');
  });
});

describe('chapter summaries', () => {
  test('cover only messages since the last summary', () => {
    const db = withStory(10);
    const ids = db.rawLog.filter((entry) => entry.kind === 'story').map((entry) => entry.id);
    const first = sceneJob(db, ids.slice(0, 6));
    const applied = applySummaryJob(first.db, first.job, {
      text: SUMMARY,
      title: 'North through the rain',
      memory: 'You walk north with Mara.',
      logIds: ids.slice(0, 6),
    })!.db;

    expect(unsummarizedStory(applied).map((entry) => entry.id)).toEqual(ids.slice(6));
  });

  test('saves the title, the chapter, and a short memory, linked both ways; the chapter stays', () => {
    const db = withStory(6);
    const ids = db.rawLog.filter((entry) => entry.kind === 'story').map((entry) => entry.id);
    const { db: queued, job } = sceneJob(db, ids);
    const chapter = queued.state.chapter;
    const next = applySummaryJob(queued, job, {
      text: SUMMARY,
      title: 'North through the rain',
      memory: 'You walk north with Mara and sleep in a ruined shrine.',
      logIds: ids,
    })!.db;

    const summary = next.summaries[next.summaries.length - 1];
    expect(summary.title).toBe('North through the rain');
    expect(summary.chapter).toBe(chapter);
    // A summary is compression inside a chapter, never a chapter break.
    expect(next.state.chapter).toBe(chapter);

    const memory = next.events.find((event) => event.summaryId === summary.id)!;
    expect(summary.eventIds).toEqual([memory.id]);
    expect(memory.title).toBe('North through the rain');
    expect(memory.summary).toBe('You walk north with Mara and sleep in a ruined shrine.');
  });

  test('without a title or memory from the model, both are cut from the summary', () => {
    const db = withStory(4);
    const ids = db.rawLog.filter((entry) => entry.kind === 'story').map((entry) => entry.id);
    const { db: queued, job } = sceneJob(db, ids);
    const next = applySummaryJob(queued, job, { text: SUMMARY, logIds: ids })!.db;
    const memory = next.events[next.events.length - 1];
    expect(memory.title).toBe('You follow Mara north through the rain');
    expect(memory.summary).toBe('You follow Mara north through the rain. He says little, and you do not press him.');
  });

  test('a summary of messages already summarized is not saved again', () => {
    const db = withStory(6);
    const ids = db.rawLog.filter((entry) => entry.kind === 'story').map((entry) => entry.id);
    const one = sceneJob(db, ids);
    const once = applySummaryJob(one.db, one.job, { text: SUMMARY, logIds: ids })!.db;
    const two = sceneJob(once, ids);
    const again = applySummaryJob(two.db, two.job, { text: `${SUMMARY} Again.`, logIds: ids })!.db;

    expect(again.summaries.filter((summary) => summary.level === 'chapter')).toHaveLength(1);
    expect(again.memoryJobs ?? []).toHaveLength(0);
  });

  test('duplicate summaries in an old save are dropped on load', () => {
    const db = withStory(2);
    const record = {
      id: 'summary_a',
      level: 'chapter' as const,
      range: { fromEventId: '', toEventId: '', from: db.state.inStoryDate, to: db.state.inStoryDate },
      text: SUMMARY,
      tokenCount: 10,
      eventIds: [],
      createdAt: 1,
    };
    const loaded = normalizeDatabase({ ...db, summaries: [record, { ...record, id: 'summary_b' }] });
    expect(loaded.summaries).toHaveLength(1);
  });
});
