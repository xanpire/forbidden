import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame, Search } from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import type { JutsuRecord } from '@/lib/rpg/types';

type JutsuGroup = {
  user: string;
  jutsu: JutsuRecord[];
};

export default function JutsuScreen() {
  const { db } = useGame();

  const groups = useMemo<JutsuGroup[]>(() => {
    if (!db) {
      return [];
    }

    const byUser = new Map<string, JutsuRecord[]>();

    for (const record of db.jutsuRecords) {
      const key = record.user;
      const current = byUser.get(key) ?? [];
      current.push(record);
      byUser.set(key, current);
    }

    return [...byUser.entries()]
      .map(([user, jutsu]) => ({
        user,
        jutsu: [...jutsu].sort((a, b) => b.timesUsed - a.timesUsed),
      }))
      .sort((a, b) => {
        const aKan = a.user === 'Kan' ? 1 : 0;
        const bKan = b.user === 'Kan' ? 1 : 0;

        if (aKan !== bKan) {
          return bKan - aKan;
        }

        return a.user.localeCompare(b.user);
      });
  }, [db]);

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
              Techniques used by Kan and the people around him.
            </Text>
          </View>

          {groups.length === 0 ? (
            <SurfaceCard style={styles.emptyCard}>
              <Flame color={colors.textDim} size={18} strokeWidth={2} />
              <Text style={styles.emptyTitle}>No jutsu recorded yet</Text>
              <Text style={styles.emptyBody}>
                Techniques appear here when the story uses them.
              </Text>
            </SurfaceCard>
          ) : (
            groups.map((group) => (
              <View key={group.user} style={styles.group}>
                <Text style={styles.groupLabel}>{group.user}</Text>
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
                            {record.timesUsed === 1 ? 'time' : 'times'}
                          </Text>
                        </View>
                      </View>

                      {record.description ? (
                        <Text style={styles.description}>{record.description}</Text>
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
  description: {
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
