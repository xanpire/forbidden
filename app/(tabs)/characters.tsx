import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, UserRound, Users } from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import type { BondRecord, EntityRecord } from '@/lib/rpg/types';

type CharacterCard = {
  entity: EntityRecord;
  bond: BondRecord | null;
};

export default function CharactersScreen() {
  const { db } = useGame();
  const [query, setQuery] = useState('');

  const characters = useMemo<CharacterCard[]>(() => {
    if (!db) {
      return [];
    }

    const term = query.trim().toLowerCase();

    return db.entities
      .filter((entity) => entity.type === 'character')
      .map((entity) => ({
        entity,
        bond:
          db.bonds.find((bond) => bond.entityId === entity.id) ?? null,
      }))
      .filter(({ entity, bond }) => {
        if (!term) {
          return true;
        }

        return (
          entity.name.toLowerCase().includes(term) ||
          entity.aliases.some((alias) => alias.toLowerCase().includes(term)) ||
          (bond?.status.toLowerCase().includes(term) ?? false)
        );
      })
      .sort((a, b) => {
        const aPlayer = a.entity.name === 'Kan' ? 1 : 0;
        const bPlayer = b.entity.name === 'Kan' ? 1 : 0;

        if (aPlayer !== bPlayer) {
          return bPlayer - aPlayer;
        }

        const aMajor = a.bond?.isMajor ? 1 : 0;
        const bMajor = b.bond?.isMajor ? 1 : 0;

        if (aMajor !== bMajor) {
          return bMajor - aMajor;
        }

        return (b.bond?.affinity ?? 0) - (a.bond?.affinity ?? 0);
      });
  }, [db, query]);

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
            <Text style={styles.title}>Bonds</Text>
            <Text style={styles.subtitle}>
              Moods, appearances, and bonds shaped by the story.
            </Text>
          </View>

          <View style={styles.searchWrap}>
            <Search color={colors.textDim} size={16} strokeWidth={2} />
            <TextInput
              accessibilityLabel="Search bonds"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Search bonds"
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              value={query}
            />
          </View>

          {characters.length === 0 ? (
            <SurfaceCard style={styles.emptyCard}>
              <Users color={colors.textDim} size={18} strokeWidth={2} />
              <Text style={styles.emptyTitle}>No bonds found</Text>
              <Text style={styles.emptyBody}>
                People appear here as the story introduces them.
              </Text>
            </SurfaceCard>
          ) : (
            characters.map(({ entity, bond }) => (
              <SurfaceCard key={entity.id} style={styles.characterCard}>
                <View style={styles.topRow}>
                  <View style={styles.iconWrap}>
                    <UserRound color={colors.accent} size={17} strokeWidth={2} />
                  </View>
                  <View style={styles.nameWrap}>
                    <Text numberOfLines={1} style={styles.name}>
                      {entity.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.status}>
                      {entity.status ?? bond?.status ?? 'Unknown'}
                    </Text>
                  </View>
                  {bond ? (
                    <Text
                      style={[
                        styles.affinity,
                        bond.affinity >= 0
                          ? styles.affinityPositive
                          : styles.affinityNegative,
                      ]}
                    >
                      {bond.affinity > 0 ? '+' : ''}
                      {bond.affinity}
                    </Text>
                  ) : null}
                </View>

                {bond ? (
                  <View style={styles.trustTrack}>
                    {Array.from({ length: 10 }).map((_, index) => {
                      const filled = index < Math.abs(bond.affinity);

                      return (
                        <View
                          key={index}
                          style={[
                            styles.trustSegment,
                            filled && styles.trustSegmentFilled,
                            bond.affinity < 0 && filled && styles.trustSegmentNegative,
                          ]}
                        />
                      );
                    })}
                  </View>
                ) : null}

                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Mood</Text>
                  <Text style={styles.detailValue}>
                    {entity.mood ?? 'Unknown'}
                  </Text>
                </View>

                <View style={styles.detailBlock}>
                  <Text style={styles.detailLabel}>Appearance</Text>
                  <Text style={styles.detailValue}>
                    {entity.appearance ?? 'Unknown'}
                  </Text>
                </View>

                {bond?.note ? (
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>Bond note</Text>
                    <Text style={styles.detailValue}>{bond.note}</Text>
                  </View>
                ) : null}

                <View style={styles.footer}>
                  <Text style={styles.meta}>
                    {bond
                      ? `Updated ${formatShortDate(bond.updatedInStoryDate)}`
                      : 'No bond yet'}
                  </Text>
                  {bond?.isMajor ? (
                    <Text style={styles.majorTag}>Major bond</Text>
                  ) : null}
                </View>
              </SurfaceCard>
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
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
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
  characterCard: {
    gap: 10,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
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
    fontSize: 17,
    lineHeight: 22,
    color: colors.text,
  },
  status: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  affinity: {
    fontFamily: fonts.bold,
    fontSize: 15,
    color: colors.text,
  },
  affinityPositive: {
    color: colors.success,
  },
  affinityNegative: {
    color: colors.danger,
  },
  trustTrack: {
    flexDirection: 'row',
    gap: 3,
  },
  trustSegment: {
    flex: 1,
    height: 5,
    borderRadius: 2,
    backgroundColor: colors.surfaceSoft,
  },
  trustSegmentFilled: {
    backgroundColor: colors.accent,
  },
  trustSegmentNegative: {
    backgroundColor: colors.danger,
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
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  meta: {
    fontFamily: fonts.regular,
    fontSize: 10,
    color: colors.textDim,
  },
  majorTag: {
    fontFamily: fonts.semibold,
    fontSize: 9,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.accent,
  },
});
