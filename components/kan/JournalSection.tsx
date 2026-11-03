import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyRow, FilterPills, ListCard, ListRow, SectionLabel } from '@/components/List';
import { colors, spacing, type } from '@/constants/theme';
import { dateSortValue, formatClock, formatDayMonth } from '@/lib/rpg/calendar';
import { localizePlaceNames } from '@/lib/rpg/glossary';
import { useGame } from '@/lib/rpg/game';
import type { AppDatabase, EventRecord, ThreadRecord } from '@/lib/rpg/types';

type JournalView = 'now' | 'recap' | 'world' | 'memories';

const VIEWS: { value: JournalView; label: string }[] = [
  { value: 'now', label: 'Now' },
  { value: 'recap', label: 'Recap' },
  { value: 'world', label: 'World' },
  { value: 'memories', label: 'Memories' },
];

/** Splits a summary into a short title (first sentence or "Title: …") and the rest. */
export function titleAndBody(text: string): { title: string; body: string | null } {
  const trimmed = text.trim();
  const colon = /^([^:.!?]{3,70}):\s+(.+)$/s.exec(trimmed);

  if (colon) {
    return { title: colon[1].trim(), body: colon[2].trim() };
  }

  const sentence = /^(.{8,120}?[.!?…])(?:["'”’)]*)\s+(.+)$/s.exec(trimmed);

  if (sentence) {
    return { title: sentence[1].trim(), body: sentence[2].trim() };
  }

  return { title: trimmed, body: null };
}

function peopleIn(db: AppDatabase, eventId: string) {
  const ids = db.eventEntities
    .filter((link) => link.eventId === eventId)
    .map((link) => link.entityId);

  return db.entities
    .filter((entity) => ids.includes(entity.id) && entity.type === 'character' && entity.name !== 'Kan')
    .slice(0, 2)
    .map((entity) => entity.name);
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
  const missions = open.filter((thread) => thread.type === 'quest');
  const goals = open.filter((thread) => thread.type === 'goal');
  const other = open.filter((thread) => thread.type !== 'quest' && thread.type !== 'goal');

  return (
    <>
      <SectionLabel>Now</SectionLabel>
      <ListCard>
        <ListRow
          meta={`${formatClock(db.state.inStoryDate)}, ${formatDayMonth(db.state.inStoryDate)} · ${localizePlaceNames(db.state.location)}`}
          title={`Chapter ${db.state.chapter} · ${db.state.scene}`}
        />
      </ListCard>

      <SectionLabel>Missions</SectionLabel>
      {missions.length > 0 ? <ThreadRows threads={missions} /> : <EmptyRow title="No open missions" />}

      <SectionLabel>Goals</SectionLabel>
      {goals.length > 0 ? <ThreadRows threads={goals} /> : <EmptyRow title="No open goals" />}

      {other.length > 0 ? (
        <>
          <SectionLabel>Open threads</SectionLabel>
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
        .sort((a, b) => dateSortValue(b.range.to) - dateSortValue(a.range.to))
        .slice(0, 16)
        .map((summary) => {
          const lastEvent = db.events.find((event) => event.id === summary.range.toEventId);
          const level = summary.level.charAt(0).toUpperCase() + summary.level.slice(1);
          const from = formatDayMonth(summary.range.from);
          const to = formatDayMonth(summary.range.to);

          return {
            id: summary.id,
            when: `${level} · ${from === to ? from : `${from} – ${to}`}, year ${summary.range.to.year}`,
            title:
              lastEvent?.scene && lastEvent.scene !== 'Canon event'
                ? lastEvent.scene
                : titleAndBody(summary.text).title,
            body: summary.text,
          };
        });
    }

    return [...db.events]
      .filter((event) => !event.tags.includes('canon'))
      .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
      .slice(0, 20)
      .map((event) => {
        const { title, body } = titleAndBody(event.summary);

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
        <EmptyRow body="Chapter recaps appear here as the story unfolds." title="Nothing to recap yet" />
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
  const news = useMemo(() => {
    const now = dateSortValue(db.state.inStoryDate);
    const heard = db.state.canonProgress?.heard ?? {};

    return db.events
      .filter(
        (event) =>
          event.tags.includes('canon') &&
          Boolean(heard[event.id]) &&
          dateSortValue(event.inStoryDate) <= now
      )
      .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
      .slice(0, 40);
  }, [db]);
  const heard = db.state.canonProgress?.heard ?? {};

  return (
    <>
      <SectionLabel>News Kan has heard</SectionLabel>
      {news.length === 0 ? (
        <EmptyRow
          body="World events reach Kan through people and couriers as time passes."
          title="No news yet"
        />
      ) : (
        <ListCard>
          {news.map((event) => {
            const { title, body } = titleAndBody(event.summary);
            const source = heard[event.id]?.from;
            const how = source === 'witnessed' ? 'witnessed' : source ? `heard from ${source}` : null;

            return (
              <ListRow
                body={body}
                key={event.id}
                meta={[formatDayMonth(event.inStoryDate), how].filter(Boolean).join(' · ')}
                title={title}
              />
            );
          })}
        </ListCard>
      )}

      <SectionLabel>Where things stand</SectionLabel>
      <ListCard>
        <ListRow body={localizePlaceNames(db.state.worldDescription)} title="The world" />
        <ListRow body={localizePlaceNames(db.state.canonPoint)} title="Timeline" />
      </ListCard>

      {db.loreEntries.length > 0 ? (
        <>
          <SectionLabel>Lore</SectionLabel>
          <ListCard>
            {db.loreEntries.map((lore) => (
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
      db.events
        .filter((event) => !event.tags.includes('canon'))
        .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
        .slice(0, 80),
    [db]
  );

  return (
    <>
      <SectionLabel>What Kan remembers</SectionLabel>
      {memories.length === 0 ? (
        <EmptyRow body="Important moments are kept here." title="No memories yet" />
      ) : (
        <ListCard>
          {memories.map((memory) => {
            const { title, body } = titleAndBody(memory.summary);
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

export function JournalSection() {
  const { db } = useGame();
  const [view, setView] = useState<JournalView>('now');

  if (!db) {
    return null;
  }

  return (
    <View style={styles.section}>
      <FilterPills onChange={setView} options={VIEWS} value={view} />
      {view === 'now' ? <NowView db={db} /> : null}
      {view === 'recap' ? <RecapView db={db} /> : null}
      {view === 'world' ? <WorldView db={db} /> : null}
      {view === 'memories' ? <MemoriesView db={db} /> : null}
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
