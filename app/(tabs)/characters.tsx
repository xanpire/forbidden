import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, Users } from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';

export default function CharactersScreen() {
  const { db, updateBond } = useGame();
  const [query, setQuery] = useState('');

  const bonds = useMemo(() => {
    if (!db) {
      return [];
    }

    const term = query.trim().toLowerCase();

    return [...db.bonds]
      .filter(
        (bond) =>
          !term ||
          bond.characterName.toLowerCase().includes(term) ||
          bond.status.toLowerCase().includes(term)
      )
      .sort((a, b) => {
        if (a.isMajor !== b.isMajor) {
          return a.isMajor ? -1 : 1;
        }

        return b.affinity - a.affinity;
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
            <Text style={styles.title}>Characters</Text>
            <Text style={styles.subtitle}>
              Bonds earned through the story, not given for free.
            </Text>
          </View>

          <View style={styles.searchWrap}>
            <Search color={colors.textDim} size={16} strokeWidth={2} />
            <TextInput
              accessibilityLabel="Search characters"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Search bonds"
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              value={query}
            />
          </View>

          {bonds.length === 0 ? (
            <SurfaceCard style={styles.emptyCard}>
              <Users color={colors.textDim} size={18} strokeWidth={2} />
              <Text style={styles.emptyTitle}>No bonds yet</Text>
              <Text style={styles.emptyBody}>
                Meet people in the story and they will appear here.
              </Text>
            </SurfaceCard>
          ) : (
            bonds.map((bond) => (
              <SurfaceCard key={bond.id} style={styles.bondCard}>
                <View style={styles.bondTop}>
                  <View style={styles.nameWrap}>
                    <Text numberOfLines={1} style={styles.name}>
                      {bond.characterName}
                    </Text>
                    <Text numberOfLines={1} style={styles.status}>
                      {bond.status}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.affinity,
                      bond.affinity >= 0 ? styles.affinityPositive : styles.affinityNegative,
                    ]}
                  >
                    {bond.affinity > 0 ? '+' : ''}
                    {bond.affinity}
                  </Text>
                </View>

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

                <View style={styles.footer}>
                  <Text style={styles.meta}>
                    Updated {formatShortDate(bond.updatedInStoryDate)}
                  </Text>
                  {bond.isMajor ? <Text style={styles.majorTag}>Major bond</Text> : null}
                </View>

                <TextInput
                  accessibilityLabel={`Edit note for ${bond.characterName}`}
                  multiline
                  onBlur={() => void updateBond(bond.id, { note: bond.note })}
                  onChangeText={(value) => void updateBond(bond.id, { note: value })}
                  placeholder="Add a note about this bond"
                  placeholderTextColor={colors.textDim}
                  style={styles.noteInput}
                  value={bond.note}
                />
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
  bondCard: {
    gap: 10,
  },
  bondTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
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
  noteInput: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textMuted,
    textAlignVertical: 'top',
  },
});
