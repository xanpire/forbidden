// Story threads that open and close with the story itself, so the big
// personal hooks are always on the page at the right time: Izumi's grave
// once you know she is gone, surviving Kakuzu once he is your partner, your
// bingo-book page once the Leaf has written one.

import { conditionHolds } from './lore';
import { threadKey } from './facts';
import type { AppDatabase, LoreCondition, ThreadRecord, ThreadType } from './types';

type StoryHook = {
  title: string;
  description: string;
  type: ThreadType;
  importance: 1 | 2 | 3 | 4 | 5;
  participants: string[];
  /** Opens once this holds. */
  opensWhen: LoreCondition;
  /** Resolves once this holds. */
  resolvesWhen?: LoreCondition;
};

export const STORY_HOOKS: StoryHook[] = [
  {
    title: "Visit Izumi's grave",
    description: "Izumi is buried in the Uchiha cemetery outside the Leaf. You have not stood at her grave yet.",
    type: 'goal',
    importance: 5,
    participants: ['Kan'],
    opensWhen: { flag: 'knowsIzumiDead' },
    resolvesWhen: { milestone: 'kan-mangekyo' },
  },
  {
    title: 'Survive Kakuzu',
    description: 'Kakuzu has killed every partner he has ever had. You mean to be the first who lives.',
    type: 'goal',
    importance: 4,
    participants: ['Kan', 'Kakuzu'],
    opensWhen: { milestone: 'kan-joins-akatsuki' },
    resolvesWhen: { milestone: 'roster-completes' },
  },
  {
    title: 'Your name in the bingo books',
    description: 'Itachi warned you the Leaf would brand you both. You have not seen what they wrote about you.',
    type: 'mystery',
    importance: 3,
    participants: ['Kan', 'Itachi Uchiha'],
    opensWhen: { milestone: 'itachi-bingo-book' },
    resolvesWhen: { milestone: 'kan-bingo-book' },
  },
];

/** Opens and resolves the story hooks the story has reached. */
export function applyStoryHooks(db: AppDatabase): AppDatabase {
  let threads = db.threads;
  let changed = false;

  for (const hook of STORY_HOOKS) {
    const key = threadKey(hook.title);
    const index = threads.findIndex((thread) => threadKey(thread.title) === key);
    const resolved = hook.resolvesWhen ? conditionHolds(db, hook.resolvesWhen) : false;

    if (index === -1) {
      if (!conditionHolds(db, hook.opensWhen) || resolved) continue;

      const thread: ThreadRecord = {
        id: `thread_hook_${key.replace(/\s+/g, '-')}`,
        type: hook.type,
        title: hook.title,
        description: hook.description,
        status: 'open',
        openedAt: db.state.inStoryDate,
        resolvedAt: null,
        importance: hook.importance,
        participants: hook.participants,
        participantIds: hook.participants
          .map((name) => db.entities.find((entity) => entity.name === name)?.id)
          .filter((id): id is string => Boolean(id)),
        sourceEventId: db.events.at(-1)?.id ?? null,
      };
      threads = [...threads, thread];
      changed = true;
    } else if (resolved && threads[index].status === 'open') {
      threads = threads.map((thread, position) =>
        position === index ? { ...thread, status: 'resolved', resolvedAt: db.state.inStoryDate } : thread
      );
      changed = true;
    }
  }

  return changed ? { ...db, threads } : db;
}
