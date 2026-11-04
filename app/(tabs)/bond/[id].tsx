import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Flame, Footprints, GitMerge, HeartPulse, Skull, UserMinus } from 'lucide-react-native';

import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { formatAffinity } from '@/components/kan/BondsSection';
import { CharacterPortraitCard } from '@/components/kan/CharacterPortraitCard';
import { titleAndBody } from '@/components/kan/JournalSection';
import { MergeSheet } from '@/components/kan/MergeSheet';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { dateSortValue, entityAge, formatDayMonth } from '@/lib/rpg/calendar';
import { MAX_COMPANIONS, companionsOf, daysTogether, formatTogether } from '@/lib/rpg/companions';
import { kanKnowsDeath } from '@/lib/rpg/deaths';
import { STAGE_LABEL, grudgeStage } from '@/lib/rpg/grudges';
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
  const { db, mergeCharacters, setCharacterDeceased, setTravelling } = useGame();
  const [merging, setMerging] = useState(false);

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

  const age = entityAge(db.state.inStoryDate, entity);
  // Only once the story has told you: a death still on its way is not spoiled here.
  const dead = kanKnowsDeath(db, entity);
  const death = entity.deceased;
  const deathLabel = dead
    ? death?.date
      ? `Died ${formatDayMonth(death.date)} · Year ${death.date.year}`
      : 'Deceased'
    : null;
  const affinity = bond?.affinity ?? 0;
  const relationship =
    bond?.relationship && bond.relationship !== 'stranger'
      ? bond.relationship.charAt(0).toUpperCase() + bond.relationship.slice(1)
      : bond?.status || null;
  const seen = dead
    ? null
    : entity.lastSeen
    ? dateSortValue(entity.lastSeen) >= dateSortValue({ ...db.state.inStoryDate, hour: 0, minute: 0 })
      ? 'Seen today'
      : `Last seen ${formatDayMonth(entity.lastSeen)}`
    : null;
  const companion = !dead ? entity.companion : undefined;
  const together = companion ? daysTogether(db, entity) : 0;
  const togetherLabel = companion
    ? together <= 0
      ? 'Joined you today'
      : `Together ${formatTogether(together)}`
    : null;
  const grudge = !dead && bond?.grudge ? bond.grudge : null;
  const stage = grudge && bond ? grudgeStage(db, bond) : null;
  const STAGE_TEXT = {
    resentful: 'They resent you, and left alone it will only grow.',
    vengeful: 'They want you to pay, and will act when they get the chance.',
    hunting: 'They are coming after you.',
  } as const;
  const grudgeMeta = grudge
    ? [
        `Since ${formatDayMonth(grudge.since)}, Year ${grudge.since.year}`,
        grudge.strikes > 0 ? `struck ${grudge.strikes === 1 ? 'once' : `${grudge.strikes} times`}` : 'hasn’t acted yet',
        grudge.lastStrike ? `last ${formatDayMonth(grudge.lastStrike)}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  const partyFull = !companion && companionsOf(db).length >= MAX_COMPANIONS;
  const details = [
    { label: 'Died', value: dead ? death?.cause : undefined },
    { label: 'Mood', value: dead ? undefined : entity.mood },
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
        <CharacterPortraitCard
          dead={dead}
          entity={entity}
          subtitle={[deathLabel, !dead && age !== undefined ? `Age ${age}` : null, entity.role ?? entity.status]
            .filter(Boolean)
            .join(' · ')}
        />

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
                {dead ? <Chip label="Deceased" /> : null}
                {companion ? <Chip accent label="Travelling with you" /> : null}
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

        {grudge && stage ? (
          <>
            <SectionLabel>Grudge</SectionLabel>
            <ListCard>
              <ListRow
                body={`${STAGE_TEXT[stage]} ${grudge.reason}`}
                leading={<Flame color={colors.danger} size={18} strokeWidth={2} />}
                meta={grudgeMeta}
                title={STAGE_LABEL[stage]}
              />
            </ListCard>
          </>
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
          <EmptyRow title="Nothing shared yet" />
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

        {entity.name.toLowerCase() !== 'kan' ? (
          <>
            {!dead ? (
              <>
                <SectionLabel>Travelling</SectionLabel>
                <ListCard>
                  {companion ? (
                    <ListRow
                      body={[
                        companion.reason ? `${companion.reason.charAt(0).toUpperCase()}${companion.reason.slice(1)}.` : null,
                        companion.sinceLocation ? `Joined you at ${companion.sinceLocation}.` : null,
                        'In every scene with you until the story parts you. The scenes you share move their bond.',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      leading={<Footprints color={colors.accentText} size={18} strokeWidth={2} />}
                      meta={`${togetherLabel} · ${companion.sharedScenes} scene${companion.sharedScenes === 1 ? '' : 's'} shared`}
                      title="Travelling with you"
                    />
                  ) : null}
                  <ListRow
                    accessibilityLabel={
                      companion ? `Part ways with ${entity.name}` : `Travel together with ${entity.name}`
                    }
                    body={
                      companion
                        ? 'If they left in the story and it was missed, let them go.'
                        : partyFull
                          ? `You already travel with ${MAX_COMPANIONS} people. Part ways with someone first.`
                          : 'If they are coming along and the story missed it, keep them at your side.'
                    }
                    leading={
                      companion ? (
                        <UserMinus color={colors.textMuted} size={18} strokeWidth={2} />
                      ) : (
                        <Footprints color={colors.textMuted} size={18} strokeWidth={2} />
                      )
                    }
                    onPress={partyFull ? undefined : () => setTravelling(entity.id, !companion)}
                    title={companion ? 'Part ways' : 'Travel together'}
                  />
                </ListCard>
              </>
            ) : null}

            <SectionLabel>Same person?</SectionLabel>
            <ListCard>
              <ListRow
                accessibilityLabel={`Merge ${entity.name} with someone else`}
                body="If the story split one person into two, fold them back together."
                chevron
                leading={<GitMerge color={colors.textMuted} size={18} strokeWidth={2} />}
                onPress={() => setMerging(true)}
                title="Merge with…"
              />
            </ListCard>

            <SectionLabel>{dead ? 'Not really dead?' : 'Died in the story?'}</SectionLabel>
            <ListCard>
              <ListRow
                accessibilityLabel={dead ? `Mark ${entity.name} as alive` : `Mark ${entity.name} as dead`}
                body={
                  dead
                    ? 'If the story got this wrong, or they truly came back, bring them back.'
                    : 'If they died and the story missed it, mark them dead so they stay dead.'
                }
                leading={
                  dead ? (
                    <HeartPulse color={colors.textMuted} size={18} strokeWidth={2} />
                  ) : (
                    <Skull color={colors.textMuted} size={18} strokeWidth={2} />
                  )
                }
                onPress={() => setCharacterDeceased(entity.id, !dead)}
                title={dead ? 'Mark as alive' : 'Mark as dead'}
              />
            </ListCard>
          </>
        ) : null}
      </ScrollView>

      <MergeSheet
        db={db}
        entity={entity}
        onCancel={() => setMerging(false)}
        onMerge={async (keepId, dropId) => {
          await mergeCharacters(keepId, dropId);
          setMerging(false);

          if (keepId !== entity.id) {
            router.replace({ pathname: '/bond/[id]', params: { id: keepId } });
          }
        }}
        visible={merging}
      />
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
