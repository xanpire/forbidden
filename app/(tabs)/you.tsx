import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Segmented } from '@/components/List';
import { AppButton } from '@/components/AppButton';
import { router } from 'expo-router';
import { BondsSection } from '@/components/player/BondsSection';
import { JournalSection } from '@/components/player/JournalSection';
import { MapSection } from '@/components/player/MapSection';
import { PortraitHeader } from '@/components/player/PortraitHeader';
import { colors, spacing } from '@/constants/theme';
import { useGame } from '@/lib/rpg/game';

type YouTab = 'bonds' | 'journal' | 'map';

const TABS: { value: YouTab; label: string }[] = [
  { value: 'bonds', label: 'Bonds' },
  { value: 'journal', label: 'Journal' },
  { value: 'map', label: 'Map' },
];

export default function YouScreen() {
  const { db } = useGame();
  const [tab, setTab] = useState<YouTab>('bonds');

  if (!db) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.accent} size="small" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={styles.root}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
        >
          <PortraitHeader />
          <View style={styles.tabsWrap}>
            <Segmented onChange={setTab} options={TABS} value={tab} />
          </View>
          {tab === 'bonds' ? <BondsSection /> : null}
          {tab === 'journal' ? <JournalSection /> : null}
          {tab === 'map' ? <MapSection /> : null}
          <View style={styles.editWrap}>
            <AppButton label="Edit your world and sheet" onPress={() => router.push('/world-editor')} variant="secondary" />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  editWrap: {
    marginTop: 32,
  },
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  tabsWrap: {
    paddingVertical: spacing.xs,
    backgroundColor: colors.background,
  },
});
