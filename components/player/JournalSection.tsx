import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyRow, FilterPills, ListCard, ListRow, SectionLabel } from '@/components/List';
import { colors, spacing, type } from '@/constants/theme';
import { dateSortValue, formatClock, formatDayMonth } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import type { AppDatabase, EventRecord, ThreadRecord } from '@/lib/rpg/types';
import { shortTitle, titleAndBody } from '@/lib/rpg/util';
import { todayNotes } from '@/lib/rpg/yearly';
import { PurseCard } from '@/components/player/PurseCard';
import { ScrapbookView } from '@/components/player/ScrapbookView';
import { displayName } from '@/lib/rpg/names';
import { isPlayer } from '@/lib/rpg/player';
import { threadTitle, threadsByRecent, unreadCount } from '@/lib/rpg/phone';
import { router } from 'expo-router';

type JournalView = 'now' | 'recap' | 'world' | 'memories' | 'scrapbook';

const VIEWS: { value: JournalView; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: 'recap', label: 'Recap' },
  { value: 'world', label: 'World' },
  { value: 'memories', label: 'Memories' },
  { value: 'scrapbook', label: 'Scrapbook' },
];

// Kept here too: the bond screen imports it from this file.
export { titleAndBody };

/** A memory's title and description: its own title, else one cut from its text. */
export function memoryTitle(event: EventRecord): { title: string; body: string | null } {
  if (event.title?.trim()) {
    return { title: event.title.trim(), body: event.summary.trim() || null };
  }

  return titleAndBody(event.summary);
}

function peopleIn(db: AppDatabase, eventId: string) {
  const ids = db.eventEntities
    .filter((link) => link.eventId === eventId)
    .map((link) => link.entityId);

  return db.entities
    .filter((entity) => ids.includes(entity.id) && entity.type === 'character' && !isPlayer(db, entity))
    .slice(0, 2)
    .map((entity) => displayName(db, entity));
}

function ThreadRows({ threads }: { threads: ThreadRecord[] }) {
  return (
    <ListCard>
      {threads.map((thread) => (
        <ListRow
          body={thread.description || null}
          bodyLines={3}
          key={thread.id}
          meta={`Opened ${formatDayMonth(thread.openedAt)}`}
          title={thread.title}
        />
      ))}
    </ListCard>
  );
}

function NowView({ db }: { db: AppDatabase }) {
  const open = db.threads.filter((thread) => thread.status === 'open');
  const plans = open.filter((thread) => thread.type === 'plan');
  const goals = open.filter((thread) => thread.type === 'goal');
  const other = open.filter((thread) => thread.type !== 'plan' && thread.type !== 'goal');
  // Birthdays, anniversaries and holidays on today's date, as far as you know.
  const today = todayNotes(db);

  return (
    <>
      <SectionLabel>Now</SectionLabel>
      <ListCard>
        <ListRow
          meta={`${formatClock(db.state.inStoryDate)}, ${formatDayMonth(db.state.inStoryDate)} · ${db.state.location}`}
          title={`Chapter ${db.state.chapter}${db.state.chapterTitle ? `: ${db.state.chapterTitle}` : ""} · ${db.state.scene}`}
        />
        {today.length > 0 ? <ListRow body={today.join(' · ')} bodyLines={3} title="Today" /> : null}
      </ListCard>

      <PurseCard db={db} />

      <SectionLabel>Plans</SectionLabel>
      {plans.length > 0 ? <ThreadRows threads={plans} /> : <EmptyRow title="Nothing planned. For now." />}

      <SectionLabel>Goals</SectionLabel>
      {goals.length > 0 ? <ThreadRows threads={goals} /> : <EmptyRow title="Nothing you’ll admit to" />}

      {other.length > 0 ? (
        <>
          <SectionLabel>Unanswered</SectionLabel>
          <ThreadRows threads={other} />
        </>
      ) : null}
    </>
  );
}

type RecapEntry = { id: string; when: string; title: string; body: string | null };

function RecapView({ db }: { db: AppDatabase }) {
  const entries = useMemo<RecapEntry[]>(() => {
    if (db.summaries.length > 0) {
      return [...db.summaries]
        .filter(
          (summary, index, all) =>
            all.findIndex((other) => other.text.trim() === summary.text.trim()) === index
        )
        .sort((a, b) => dateSortValue(b.range.to) - dateSortValue(a.range.to))
        .slice(0, 16)
        .map((summary) => {
          const level = summary.level.charAt(0).toUpperCase() + summary.level.slice(1);
          const label = summary.chapter ? `${level} ${summary.chapter}` : level;
          const from = formatDayMonth(summary.range.from);
          const to = formatDayMonth(summary.range.to);

          return {
            id: summary.id,
            when: `${label} · ${from === to ? from : `${from} – ${to}`}, year ${summary.range.to.year}`,
            title: summary.title?.trim() || shortTitle(summary.text),
            body: summary.text,
          };
        });
    }

    return [...db.events]
      .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
      .slice(0, 20)
      .map((event) => {
        const { title, body } = memoryTitle(event);

        return {
          id: event.id,
          when: `Chapter ${event.chapter} · ${formatDayMonth(event.inStoryDate)} · ${event.scene}`,
          title,
          body,
        };
      });
  }, [db]);

  if (entries.length === 0) {
    return (
      <>
        <SectionLabel>Chapters</SectionLabel>
        <EmptyRow body="Each chapter is summed up here once it ends." title="Nothing behind you yet" />
      </>
    );
  }

  return (
    <>
      <SectionLabel>Chapters</SectionLabel>
      <View style={styles.timeline}>
        {entries.map((entry, index) => (
          <View key={entry.id} style={styles.timelineItem}>
            <View style={styles.rail}>
              <View style={[styles.dot, index === 0 ? styles.dotNow : styles.dotPast]} />
              {index < entries.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={styles.timelineText}>
              <Text style={type.rowMeta}>{entry.when}</Text>
              <Text style={type.rowTitle}>{entry.title}</Text>
              {entry.body ? <Text style={type.rowBody}>{entry.body}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    </>
  );
}

function WorldView({ db }: { db: AppDatabase }) {
  const visibleLore = db.loreEntries.filter((lore) => !lore.hidden && lore.enabled);

  return (
    <>

      <SectionLabel>The world as you know it</SectionLabel>
      <ListCard>
        <ListRow body={db.state.worldDescription} title="The world" />
      </ListCard>

      {visibleLore.length > 0 ? (
        <>
          <SectionLabel>Lore</SectionLabel>
          <ListCard>
            {visibleLore.map((lore) => (
              <ListRow
                body={lore.text}
                key={lore.id}
                title={lore.keywords.slice(0, 3).join(', ')}
              />
            ))}
          </ListCard>
        </>
      ) : null}
    </>
  );
}

function MemoriesView({ db }: { db: AppDatabase }) {
  const memories = useMemo<EventRecord[]>(
    () =>
      [...db.events]
        .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
        .slice(0, 80),
    [db]
  );

  return (
    <>
      <SectionLabel>What you remember</SectionLabel>
      {memories.length === 0 ? (
        <EmptyRow body="The moments that matter stay here." title="Nothing worth keeping yet" />
      ) : (
        <ListCard>
          {memories.map((memory) => {
            const { title, body } = memoryTitle(memory);
            const people = peopleIn(db, memory.id);

            return (
              <ListRow
                body={body}
                key={memory.id}
                meta={[formatDayMonth(memory.inStoryDate), ...people].join(' · ')}
                title={title}
              />
            );
          })}
        </ListCard>
      )}
    </>
  );
}

/** Unread texts and the latest thread, for the Journal's phone row. */
function phoneLine(db: AppDatabase) {
  const unread = unreadCount(db);
  const latest = threadsByRecent(db)[0];

  if (unread) return `${unread} unread`;
  if (latest) return `Latest: ${threadTitle(db, latest)}`;

  return 'Texts and contacts';
}

export function JournalSection() {
  const { db } = useGame();
  const [view, setView] = useState<JournalView>('now');

  if (!db) {
    return null;
  }

  return (
    <View style={styles.section}>
      <ListCard>
        <ListRow
          body={phoneLine(db)}
          chevron
          onPress={() => router.push('/phone')}
          title="Phone"
        />
      </ListCard>
      <FilterPills onChange={setView} options={VIEWS} value={view} />
      {view === 'now' ? <NowView db={db} /> : null}
      {view === 'recap' ? <RecapView db={db} /> : null}
      {view === 'world' ? <WorldView db={db} /> : null}
      {view === 'memories' ? <MemoriesView db={db} /> : null}
      {view === 'scrapbook' ? <ScrapbookView db={db} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  timeline: {
    paddingTop: 4,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 14,
  },
  rail: {
    width: 12,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 3,
  },
  dotNow: {
    backgroundColor: colors.accent,
  },
  dotPast: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  line: {
    flex: 1,
    width: 2,
    marginTop: 4,
    backgroundColor: colors.border,
  },
  timelineText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    paddingBottom: 22,
  },
});
