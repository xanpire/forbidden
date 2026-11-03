import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';

import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { Avatar, formatAffinity } from '@/components/kan/BondsSection';
import { titleAndBody } from '@/components/kan/JournalSection';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { calculateAge, dateSortValue, formatDayMonth } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';

function Chip({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <View style={[styles.chip, accent && styles.chipAccent]}>
      <Text style={[styles.chipText, accent && styles.chipTextAccent]}>{label}</Text>
    </View>
  );
}

export default function BondScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { db } = useGame();

  const entity = db?.entities.find((item) => item.id === id) ?? null;
  const bond = db?.bonds.find((item) => item.entityId === id) ?? null;

  const shared = useMemo(() => {
    if (!db || !id) {
      return [];
    }

    const eventIds = new Set(
      db.eventEntities.filter((link) => link.entityId === id).map((link) => link.eventId)
    );

    return db.events
      .filter((event) => eventIds.has(event.id) && !event.tags.includes('canon'))
      .sort((a, b) => dateSortValue(b.inStoryDate) - dateSortValue(a.inStoryDate))
      .slice(0, 12);
  }, [db, id]);

  // Tabs' back() falls through to the first tab (Story), so go to Kan explicitly.
  const back = () => router.navigate('/(tabs)/kan');

  if (!db || !entity) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.content}>
          <EmptyRow body="This person isn’t in the current story." title="Not found" />
        </View>
      </SafeAreaView>
    );
  }

  const age =
    entity.birthYear !== undefined && entity.birthday
      ? calculateAge(db.state.inStoryDate, entity.birthday, entity.birthYear)
      : entity.age;
  const affinity = bond?.affinity ?? 0;
  const relationship =
    bond?.relationship && bond.relationship !== 'stranger'
      ? bond.relationship.charAt(0).toUpperCase() + bond.relationship.slice(1)
      : bond?.status || null;
  const seen = entity.lastSeen
    ? dateSortValue(entity.lastSeen) >= dateSortValue({ ...db.state.inStoryDate, hour: 0, minute: 0 })
      ? 'Seen today'
      : `Last seen ${formatDayMonth(entity.lastSeen)}`
    : null;
  const details = [
    { label: 'Mood', value: entity.mood },
    { label: 'Personality', value: entity.personality },
    { label: 'Speaks', value: entity.speechStyle },
    { label: 'Appearance', value: entity.appearance },
  ].filter((item) => item.value && item.value !== 'Unknown');

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="Back to bonds"
          accessibilityRole="button"
          onPress={back}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ChevronLeft color={colors.text} size={22} strokeWidth={2} />
          <Text style={styles.backLabel}>Bonds</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.identity}>
          <Avatar name={entity.name} size={56} />
          <View style={styles.identityText}>
            <Text style={type.pageTitle}>{entity.name}</Text>
            <Text style={type.rowBody}>
              {[age !== undefined ? `Age ${age}` : null, entity.role ?? entity.status]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </View>
        </View>

        {bond ? (
          <ListCard>
            <View style={styles.bondCard}>
              <View style={styles.bondTop}>
                <Text style={type.sectionLabel}>Bond</Text>
                <Text style={styles.bondValue}>{formatAffinity(affinity)}</Text>
              </View>
              <View style={styles.segments}>
                {Array.from({ length: 10 }).map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.segment,
                      index < Math.abs(affinity) && {
                        backgroundColor: affinity >= 0 ? colors.accent : colors.textDim,
                      },
                    ]}
                  />
                ))}
              </View>
              <View style={styles.chips}>
                {relationship ? <Chip label={relationship} /> : null}
                {bond.isMajor ? <Chip accent label="Major bond" /> : null}
                {bond.attraction && bond.attraction !== 'none' ? (
                  <Chip label={`Attraction ${bond.attraction}`} />
                ) : null}
                {seen ? <Chip label={seen} /> : null}
              </View>
              {bond.note ? <Text style={type.rowBody}>{bond.note}</Text> : null}
              {bond.romanceNote ? <Text style={type.rowBody}>{bond.romanceNote}</Text> : null}
            </View>
          </ListCard>
        ) : null}

        {details.length > 0 ? (
          <ListCard>
            {details.map((item) => (
              <View key={item.label} style={styles.detail}>
                <Text style={styles.detailLabel}>{item.label}</Text>
                <Text style={styles.detailValue}>{item.value}</Text>
              </View>
            ))}
          </ListCard>
        ) : null}

        <SectionLabel>Shared memories</SectionLabel>
        {shared.length === 0 ? (
          <EmptyRow title="No shared memories yet" />
        ) : (
          <ListCard>
            {shared.map((event) => {
              const { title, body } = titleAndBody(event.summary);

              return (
                <ListRow
                  body={body}
                  key={event.id}
                  meta={`${formatDayMonth(event.inStoryDate)} · ${event.scene}`}
                  title={title}
                />
              );
            })}
          </ListCard>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pressed: {
    opacity: 0.65,
  },
  topBar: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  backLabel: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    color: colors.textMuted,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: spacing.xs,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  bondCard: {
    gap: 10,
    padding: spacing.lg,
  },
  bondTop: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  bondValue: {
    fontFamily: fonts.extrabold,
    fontSize: 22,
    color: colors.text,
  },
  segments: {
    flexDirection: 'row',
    gap: 4,
  },
  segment: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingTop: 2,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  chipAccent: {
    backgroundColor: colors.accentSoft,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: '#D4D4D4',
  },
  chipTextAccent: {
    fontFamily: fonts.bold,
    color: colors.accentTint,
  },
  detail: {
    gap: 4,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
  },
  detailLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMeta,
  },
  detailValue: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSoft,
  },
});
