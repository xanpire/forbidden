import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CircleDot,
  Pin,
  ScrollText,
  Target,
} from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { AppButton } from '@/components/AppButton';
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import type { EventRecord, ThreadRecord } from '@/lib/rpg/types';

export default function JournalScreen() {
  const {
    db,
    editMemory,
    deleteMemory,
    toggleMemoryPin,
  } = useGame();

  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editSummary, setEditSummary] = useState('');

  const missions = useMemo(() => {
    if (!db) {
      return [];
    }

    return db.threads.filter((thread) => thread.type === 'quest');
  }, [db]);

  const goals = useMemo(() => {
    if (!db) {
      return [];
    }

    return db.threads.filter((thread) => thread.type === 'goal');
  }, [db]);

  const memories = useMemo(() => {
    if (!db) {
      return [];
    }

    return [...db.events]
      .sort((a, b) => {
        if (a.pinned !== b.pinned) {
          return a.pinned ? -1 : 1;
        }

        return b.createdAt - a.createdAt;
      })
      .slice(0, 80);
  }, [db]);

  const startEdit = (memory: EventRecord) => {
    setEditingMemoryId(memory.id);
    setEditSummary(memory.summary);
  };

  const saveEdit = async () => {
    if (!editingMemoryId) {
      return;
    }

    const summary = editSummary.trim();

    if (summary) {
      await editMemory(editingMemoryId, { summary });
    }

    setEditingMemoryId(null);
    setEditSummary('');
  };

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
            <Text numberOfLines={2} style={styles.threadBody}>
              {thread.description}
            </Text>
          ) : null}
        </View>
        <Text
          style={[
            styles.threadStatus,
            thread.status === 'resolved' ? styles.resolved : styles.open,
          ]}
        >
          {thread.status === 'resolved' ? 'Done' : 'Open'}
        </Text>
      </View>

      <View style={styles.threadFooter}>
        <Text style={styles.threadMeta}>
          Opened {formatShortDate(thread.openedAt)}
        </Text>
      </View>
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
            <Text style={styles.subtitle}>Missions, goals, and the moments worth keeping.</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Missions</Text>
            {missions.length === 0 ? (
              <SurfaceCard style={styles.emptyCard}>
                <ScrollText color={colors.textDim} size={17} strokeWidth={2} />
                <Text style={styles.emptyTitle}>No missions yet</Text>
                <Text style={styles.emptyBody}>
                  When the story gives Kan a job, it will show up here.
                </Text>
              </SurfaceCard>
            ) : (
              missions.map(renderThread)
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Goals</Text>
            {goals.length === 0 ? (
              <SurfaceCard style={styles.emptyCard}>
                <CircleDot color={colors.textDim} size={17} strokeWidth={2} />
                <Text style={styles.emptyTitle}>No goals yet</Text>
                <Text style={styles.emptyBody}>
                  Kan’s personal aims will appear here.
                </Text>
              </SurfaceCard>
            ) : (
              goals.map(renderThread)
            )}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Memories</Text>

            {memories.length === 0 ? (
              <SurfaceCard style={styles.emptyCard}>
                <ScrollText color={colors.textDim} size={17} strokeWidth={2} />
                <Text style={styles.emptyTitle}>No memories yet</Text>
                <Text style={styles.emptyBody}>
                  Important moments from the story will be kept here.
                </Text>
              </SurfaceCard>
            ) : (
              memories.map((memory) => (
                <SurfaceCard key={memory.id} style={styles.memoryCard}>
                  <View style={styles.memoryTop}>
                    <View style={styles.memoryMeta}>
                      <Text style={styles.memoryDate}>
                        {formatShortDate(memory.inStoryDate)}
                      </Text>
                      <Text style={styles.memoryImportance}>
                        Importance {memory.importance}/5
                      </Text>
                    </View>
                    <View style={styles.memoryActions}>
                      <AppButton
                        compact
                        label={memory.pinned ? 'Unpin' : 'Pin'}
                        onPress={() => void toggleMemoryPin(memory.id)}
                        style={styles.memoryActionButton}
                        variant="secondary"
                      />
                      <AppButton
                        compact
                        label="Edit"
                        onPress={() => startEdit(memory)}
                        style={styles.memoryActionButton}
                        variant="secondary"
                      />
                      <AppButton
                        compact
                        label="Delete"
                        onPress={() => void deleteMemory(memory.id)}
                        style={styles.memoryActionButton}
                        variant="secondary"
                      />
                    </View>
                  </View>

                  {editingMemoryId === memory.id ? (
                    <View style={styles.editWrap}>
                      <TextInput
                        accessibilityLabel="Edit memory summary"
                        multiline
                        onChangeText={setEditSummary}
                        style={styles.editInput}
                        value={editSummary}
                      />
                      <View style={styles.editActions}>
                        <AppButton
                          compact
                          label="Cancel"
                          onPress={() => setEditingMemoryId(null)}
                          style={styles.editButton}
                          variant="secondary"
                        />
                        <AppButton
                          compact
                          label="Save"
                          onPress={() => void saveEdit()}
                          style={styles.editButton}
                        />
                      </View>
                    </View>
                  ) : (
                    <Text style={styles.memorySummary}>{memory.summary}</Text>
                  )}

                  {memory.tags.length > 0 ? (
                    <View style={styles.tagRow}>
                      {memory.tags.map((tag) => (
                        <Text key={tag} style={styles.tag}>
                          {tag}
                        </Text>
                      ))}
                    </View>
                  ) : null}

                  {memory.pinned ? (
                    <View style={styles.pinnedRow}>
                      <Pin color={colors.accent} size={12} strokeWidth={2} />
                      <Text style={styles.pinnedText}>Pinned</Text>
                    </View>
                  ) : null}
                </SurfaceCard>
              ))
            )}
          </View>
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
    gap: spacing.xxxl,
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
    gap: spacing.sm,
  },
  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
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
  threadStatus: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: colors.textMuted,
  },
  resolved: {
    color: colors.success,
  },
  open: {
    color: colors.accent,
  },
  threadFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  threadMeta: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textDim,
  },
  memoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  memoryCard: {
    gap: 10,
  },
  memoryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
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
  memoryActions: {
    flexDirection: 'row',
    gap: 6,
  },
  memoryActionButton: {
    minWidth: 52,
  },
  memorySummary: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 20,
    color: colors.text,
  },
  editWrap: {
    gap: 8,
  },
  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  editInput: {
    minHeight: 84,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
    textAlignVertical: 'top',
  },
  editButton: {
    minWidth: 72,
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
  pinnedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pinnedText: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    color: colors.accent,
  },
});
