import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CircleDot, ScrollText, Target } from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { dateSortValue, formatShortDate, formatStoryDate } from '@/lib/rpg/calendar';
import { localizePlaceNames } from '@/lib/rpg/glossary';
import { useGame } from '@/lib/rpg/game';
import type { EventRecord, ThreadRecord } from '@/lib/rpg/types';

type JournalTab = 'story' | 'so-far' | 'world' | 'memories';

export default function JournalScreen() {
  const { db } = useGame();
  const [tab, setTab] = useState<JournalTab>('story');

  const threads = useMemo(() => {
    if (!db) {
      return [];
    }

    return db.threads.filter((thread) => thread.status === 'open');
  }, [db]);

  const missions = threads.filter((thread) => thread.type === 'quest');
  const goals = threads.filter((thread) => thread.type === 'goal');
  const otherThreads = threads.filter(
    (thread) => thread.type !== 'quest' && thread.type !== 'goal'
  );

  const storySummaries = useMemo(() => {
    if (!db) {
      return [];
    }

    return [...db.summaries]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 12);
  }, [db]);

  const storyEvents = useMemo(() => {
    if (!db) {
      return [];
    }

    return [...db.events]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
  }, [db]);

  const memories = useMemo(() => {
    if (!db) {
      return [];
    }

    return [...db.events]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 80);
  }, [db]);

  const canonTimeline = useMemo(() => {
    if (!db) {
      return [];
    }

    const now = db.state.inStoryDate;
    const nowKey = now.year * 10000 + now.month * 100 + now.day;
    const heard = db.state.canonProgress?.heard ?? {};

    return [...db.events]
      .filter(
        (event) =>
          event.tags.includes('canon') &&
          Boolean(heard[event.id]) &&
          event.inStoryDate.year * 10000 +
            event.inStoryDate.month * 100 +
            event.inStoryDate.day <=
            nowKey
      )
      .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
      .slice(0, 40);
  }, [db]) as EventRecord[];

  const renderThread = (thread: ThreadRecord) => (
    <SurfaceCard key={thread.id} style={styles.threadCard}>
      <View style={styles.threadTop}>
        <View style={styles.threadIcon}>
          <Target color={colors.accent} size={15} strokeWidth={2} />
        </View>
        <View style={styles.threadCopy}>
          <Text numberOfLines={1} style={styles.threadTitle}>
            {thread.title}
          </Text>
          {thread.description ? (
            <Text numberOfLines={3} style={styles.threadBody}>
              {thread.description}
            </Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.threadMeta}>
        Opened {formatShortDate(thread.openedAt)}
      </Text>
    </SurfaceCard>
  );

  return (
    <View style={styles.root}>
      <AppBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heading}>
            <Text style={styles.title}>Journal</Text>
            <Text style={styles.subtitle}>
              The story, the world, and what Kan remembers.
            </Text>
          </View>

          <SegmentedControl
            accessibilityLabel="Journal sections"
            onChange={(value) => setTab(value)}
            options={[
              { value: 'story', label: 'Story' },
              { value: 'so-far', label: 'So far' },
              { value: 'world', label: 'World' },
              { value: 'memories', label: 'Memories' },
            ]}
            value={tab}
          />

          {tab === 'story' && db ? (
            <View style={styles.section}>
              <SurfaceCard style={styles.card}>
                <Text style={styles.cardLabel}>Current story</Text>
                <Text style={styles.cardValue}>
                  Chapter {db.state.chapter} · {db.state.scene}
                </Text>
                <Text style={styles.cardMeta}>
                  {localizePlaceNames(db.state.location)} · {formatStoryDate(
                    db.state.inStoryDate,
                    db.state.player.birthday,
                    db.state.player.birthYear
                  )}
                </Text>
              </SurfaceCard>

              <View style={styles.threadSection}>
                <Text style={styles.sectionLabel}>Missions</Text>
                {missions.length === 0 ? (
                  <Text style={styles.emptyText}>No open missions.</Text>
                ) : (
                  missions.map(renderThread)
                )}
              </View>

              <View style={styles.threadSection}>
                <Text style={styles.sectionLabel}>Goals</Text>
                {goals.length === 0 ? (
                  <Text style={styles.emptyText}>No open goals.</Text>
                ) : (
                  goals.map(renderThread)
                )}
              </View>

              <View style={styles.threadSection}>
                <Text style={styles.sectionLabel}>Open threads</Text>
                {otherThreads.length === 0 ? (
                  <Text style={styles.emptyText}>No other open threads.</Text>
                ) : (
                  otherThreads.map(renderThread)
                )}
              </View>
            </View>
          ) : null}

          {tab === 'so-far' && db ? (
            <View style={styles.section}>
              {storySummaries.length === 0 && storyEvents.length === 0 ? (
                <SurfaceCard style={styles.emptyCard}>
                  <ScrollText color={colors.textDim} size={18} strokeWidth={2} />
                  <Text style={styles.emptyTitle}>No story history yet</Text>
                  <Text style={styles.emptyBody}>
                    Summaries appear here as chapters and arcs unfold.
                  </Text>
                </SurfaceCard>
              ) : storySummaries.length === 0 ? (
                storyEvents.map((event) => (
                  <SurfaceCard key={event.id} style={styles.card}>
                    <Text style={styles.cardLabel}>
                      {formatShortDate(event.inStoryDate)} · {event.scene}
                    </Text>
                    <Text style={styles.cardValue}>{event.summary}</Text>
                  </SurfaceCard>
                ))
              ) : (
                storySummaries.map((summary) => (
                  <SurfaceCard key={summary.id} style={styles.card}>
                    <Text style={styles.cardLabel}>
                      {summary.level} · {formatShortDate(summary.range.to)}
                    </Text>
                    <Text style={styles.cardValue}>{summary.text}</Text>
                  </SurfaceCard>
                ))
              )}
            </View>
          ) : null}

          {tab === 'world' && db ? (
            <View style={styles.section}>
              <SurfaceCard style={styles.card}>
                <Text style={styles.cardLabel}>World</Text>
                <Text style={styles.cardValue}>{localizePlaceNames(db.state.worldDescription)}</Text>
              </SurfaceCard>

              <SurfaceCard style={styles.card}>
                <Text style={styles.cardLabel}>Location</Text>
                <Text style={styles.cardValue}>{localizePlaceNames(db.state.location)}</Text>
                <Text style={styles.cardMeta}>
                  {formatStoryDate(
                    db.state.inStoryDate,
                    db.state.player.birthday,
                    db.state.player.birthYear
                  )}
                </Text>
              </SurfaceCard>

              <SurfaceCard style={styles.card}>
                <Text style={styles.cardLabel}>Canon point</Text>
                <Text style={styles.cardValue}>{localizePlaceNames(db.state.canonPoint)}</Text>
              </SurfaceCard>

              <View style={styles.threadSection}>
                <Text style={styles.sectionLabel}>World timeline</Text>
                {canonTimeline.length === 0 ? (
                  <Text style={styles.emptyText}>
                    World events appear here as the timeline advances.
                  </Text>
                ) : (
                  canonTimeline.map((event) => (
                    <SurfaceCard key={event.id} style={styles.card}>
                      <Text style={styles.cardLabel}>
                        {formatShortDate(event.inStoryDate)}
                        {event.pinned ? ' · major' : ''}
                        {db.state.canonProgress?.heard?.[event.id]
                          ? ` · ${db.state.canonProgress.heard[event.id].from === 'witnessed' ? 'witnessed' : `heard from ${db.state.canonProgress.heard[event.id].from}`}`
                          : ''}
                      </Text>
                      <Text style={styles.cardValue}>{event.summary}</Text>
                    </SurfaceCard>
                  ))
                )}
              </View>

              <View style={styles.threadSection}>
                <Text style={styles.sectionLabel}>Lore</Text>
                {db.loreEntries.length === 0 ? (
                  <Text style={styles.emptyText}>No lore recorded yet.</Text>
                ) : (
                  db.loreEntries.map((lore) => (
                    <SurfaceCard key={lore.id} style={styles.card}>
                      <Text style={styles.cardLabel}>
                        {lore.keywords.join(', ')}
                      </Text>
                      <Text style={styles.cardValue}>{lore.text}</Text>
                    </SurfaceCard>
                  ))
                )}
              </View>
            </View>
          ) : null}

          {tab === 'memories' && db ? (
            <View style={styles.section}>
              {memories.length === 0 ? (
                <SurfaceCard style={styles.emptyCard}>
                  <CircleDot color={colors.textDim} size={18} strokeWidth={2} />
                  <Text style={styles.emptyTitle}>No memories yet</Text>
                  <Text style={styles.emptyBody}>
                    Important moments will be kept here.
                  </Text>
                </SurfaceCard>
              ) : (
                memories.map((memory) => (
                  <SurfaceCard key={memory.id} style={styles.memoryCard}>
                    <View style={styles.memoryMeta}>
                      <Text style={styles.memoryDate}>
                        {formatShortDate(memory.inStoryDate)}
                      </Text>
                      <Text style={styles.memoryImportance}>
                        Importance {memory.importance}/5
                      </Text>
                    </View>

                    <Text style={styles.memorySummary}>{memory.summary}</Text>

                    {memory.tags.length > 0 ? (
                      <View style={styles.tagRow}>
                        {memory.tags.map((tag) => (
                          <Text key={tag} style={styles.tag}>
                            {tag}
                          </Text>
                        ))}
                      </View>
                    ) : null}
                  </SurfaceCard>
                ))
              )}
            </View>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safe: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.giant,
    gap: spacing.md,
  },
  heading: {
    gap: 4,
  },
  title: {
    fontFamily: fonts.extrabold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -1,
    color: colors.text,
  },
  subtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
  },
  section: {
    gap: spacing.md,
  },
  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginTop: spacing.sm,
  },
  card: {
    gap: 6,
  },
  cardLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  cardValue: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  cardMeta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  threadSection: {
    gap: spacing.sm,
  },
  threadCard: {
    gap: 10,
  },
  threadTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  threadIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  threadCopy: {
    flex: 1,
    gap: 2,
  },
  threadTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  threadBody: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 17,
    color: colors.textMuted,
  },
  threadMeta: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textDim,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
  },
  emptyCard: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.xxxl,
  },
  emptyTitle: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
    textAlign: 'center',
  },
  memoryCard: {
    gap: 10,
  },
  memoryMeta: {
    gap: 2,
  },
  memoryDate: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: colors.textMuted,
  },
  memoryImportance: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textDim,
  },
  memorySummary: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  tag: {
    fontFamily: fonts.medium,
    fontSize: 9,
    color: colors.accent,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
    backgroundColor: colors.accentSoft,
    overflow: 'hidden',
  },
});
