import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame } from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/rpg/calendar';
import { countJutsuByNature, groupJutsuByNature, type JutsuNature } from '@/lib/rpg/jutsu';
import { useGame } from '@/lib/rpg/game';

type NatureFilter = 'all' | JutsuNature;

export default function JutsuScreen() {
  const { db } = useGame();
  const [natureFilter, setNatureFilter] = useState<NatureFilter>('all');

  const groups = useMemo(() => {
    if (!db) {
      return [];
    }

    return groupJutsuByNature(db.jutsuRecords);
  }, [db]);

  const counts = useMemo(() => {
    if (!db) {
      return new Map<JutsuNature, number>();
    }

    return countJutsuByNature(db.jutsuRecords);
  }, [db]);

  const visibleGroups = useMemo(() => {
    if (natureFilter === 'all') {
      return groups;
    }

    return groups.filter((group) => group.nature === natureFilter);
  }, [groups, natureFilter]);

  const totalJutsu = db?.jutsuRecords.length ?? 0;

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
            <Text style={styles.title}>Jutsu</Text>
            <Text style={styles.subtitle}>
              Techniques grouped by chakra nature.
            </Text>
          </View>

          {totalJutsu > 0 ? (
            <ScrollView
              contentContainerStyle={styles.natureChipRow}
              horizontal
              showsHorizontalScrollIndicator={false}
            >
              <Pressable
                accessibilityLabel="Show all jutsu natures"
                accessibilityRole="button"
                accessibilityState={{ selected: natureFilter === 'all' }}
                onPress={() => setNatureFilter('all')}
                style={({ pressed }) => [
                  styles.natureChip,
                  natureFilter === 'all' && styles.natureChipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.natureChipText,
                    natureFilter === 'all' && styles.natureChipTextActive,
                  ]}
                >
                  All · {totalJutsu}
                </Text>
              </Pressable>

              {groups.map((group) => (
                <Pressable
                  accessibilityLabel={`Show ${group.nature} jutsu`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: natureFilter === group.nature }}
                  key={group.nature}
                  onPress={() => setNatureFilter(group.nature)}
                  style={({ pressed }) => [
                    styles.natureChip,
                    natureFilter === group.nature && styles.natureChipActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text
                    style={[
                      styles.natureChipText,
                      natureFilter === group.nature && styles.natureChipTextActive,
                    ]}
                  >
                    {group.nature} · {counts.get(group.nature) ?? group.jutsu.length}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}

          {visibleGroups.length === 0 ? (
            <SurfaceCard style={styles.emptyCard}>
              <Flame color={colors.textDim} size={18} strokeWidth={2} />
              <Text style={styles.emptyTitle}>No jutsu recorded yet</Text>
              <Text style={styles.emptyBody}>
                Techniques appear here when the story uses them.
              </Text>
            </SurfaceCard>
          ) : (
            visibleGroups.map((group) => (
              <View key={group.nature} style={styles.group}>
                <Text style={styles.groupLabel}>{group.nature}</Text>
                <View style={styles.groupList}>
                  {group.jutsu.map((record) => (
                    <SurfaceCard key={record.id} style={styles.jutsuCard}>
                      <View style={styles.topRow}>
                        <View style={styles.iconWrap}>
                          <Flame color={colors.accent} size={16} strokeWidth={2} />
                        </View>
                        <View style={styles.nameWrap}>
                          <Text numberOfLines={1} style={styles.name}>
                            {record.name}
                          </Text>
                          <Text style={styles.meta}>
                            Used {record.timesUsed}{' '}
                            {record.timesUsed === 1 ? 'time' : 'times'} · {record.user}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.natureRow}>
                        <Text style={styles.natureLabel}>Chakra</Text>
                        <Text style={styles.natureValue}>{record.chakraNature}</Text>
                      </View>

                      {record.effect ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>Effect</Text>
                          <Text style={styles.detailValue}>{record.effect}</Text>
                        </View>
                      ) : null}

                      {record.visual ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>Appearance</Text>
                          <Text style={styles.detailValue}>{record.visual}</Text>
                        </View>
                      ) : null}

                      {record.description ? (
                        <View style={styles.detailBlock}>
                          <Text style={styles.detailLabel}>Notes</Text>
                          <Text style={styles.detailValue}>{record.description}</Text>
                        </View>
                      ) : null}

                      <Text style={styles.date}>
                        Last seen {formatShortDate(record.lastSeen)}
                      </Text>
                    </SurfaceCard>
                  ))}
                </View>
              </View>
            ))
          )}
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
  natureChipRow: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 2,
  },
  natureChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  natureChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  natureChipText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  natureChipTextActive: {
    color: colors.onAccent,
  },
  pressed: {
    opacity: 0.65,
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
  group: {
    gap: spacing.sm,
  },
  groupLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  groupList: {
    gap: spacing.sm,
  },
  jutsuCard: {
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  nameWrap: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  natureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  natureLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  natureValue: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.accent,
  },
  detailBlock: {
    gap: 3,
  },
  detailLabel: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  detailValue: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  date: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
});
