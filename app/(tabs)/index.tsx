import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ChevronRight,
  CircleCheck,
  Feather,
  Image as ImageIcon,
  PenLine,
  Settings2,
  Sparkles,
} from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/AppBackground';
import { AppButton } from '@/components/AppButton';
import { SurfaceCard } from '@/components/SurfaceCard';
import { Wordmark } from '@/components/Wordmark';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { useSettings, type ImageFrequency, type NarrationStyle } from '@/lib/settings';

const imageLabels: Record<ImageFrequency, string> = {
  off: 'Off',
  choice: 'Every choice',
  action: 'Every action',
};

const narrationLabels: Record<NarrationStyle, string> = {
  cinematic: 'Cinematic',
  balanced: 'Balanced',
  literary: 'Literary',
};

export default function StoryHomeScreen() {
  const router = useRouter();
  const { apiKey, hydrated, settings } = useSettings();
  const needsNarrator = !apiKey.trim();

  return (
    <View style={styles.root}>
      <AppBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Wordmark />
            <Pressable
              accessibilityLabel="Open settings"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.navigate('/(tabs)/settings')}
              style={({ pressed }) => [
                styles.headerButton,
                pressed && styles.pressed,
              ]}
            >
              <Settings2 color={colors.textMuted} size={19} strokeWidth={1.8} />
            </Pressable>
          </View>

          <View style={styles.heroShell}>
            <LinearGradient
              colors={['#2C1A14', '#19100D', '#0D0908']}
              locations={[0, 0.52, 1]}
              style={styles.hero}
            >
              <View pointerEvents="none" style={styles.heroArt}>
                <View style={styles.sun} />
                <View style={styles.sunRing} />
                <Text style={styles.heroLetter}>K</Text>
                <View style={styles.slash} />
              </View>

              <View style={styles.heroTop}>
                <View style={styles.eyebrowRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.heroEyebrow}>An original Naruto story</Text>
                </View>
                <View style={styles.chapterPill}>
                  <Text style={styles.chapterPillText}>CHAPTER I</Text>
                </View>
              </View>

              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>Kan</Text>
                <Text style={styles.heroTagline}>
                  A name without a village. A road without an end.
                </Text>
              </View>

              <View style={styles.heroFooter}>
                <View style={styles.heroMetaItem}>
                  <Text style={styles.heroMetaLabel}>World</Text>
                  <Text style={styles.heroMetaValue}>Naruto</Text>
                </View>
                <View style={styles.heroMetaRule} />
                <View style={styles.heroMetaItem}>
                  <Text style={styles.heroMetaLabel}>Path</Text>
                  <Text style={styles.heroMetaValue}>Unwritten</Text>
                </View>
                <View style={styles.heroMetaRule} />
                <View style={styles.heroMetaItem}>
                  <Text style={styles.heroMetaLabel}>You are</Text>
                  <Text style={styles.heroMetaValue}>Kan</Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          {!hydrated ? (
            <View style={styles.loadingCard}>
              <ActivityIndicator color={colors.gold} size="small" />
              <Text style={styles.loadingText}>Preparing your story…</Text>
            </View>
          ) : needsNarrator ? (
            <Pressable
              accessibilityLabel="Connect the narrator in settings"
              accessibilityRole="button"
              onPress={() => router.navigate('/(tabs)/settings')}
              style={({ pressed }) => [
                styles.notice,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.noticeIcon}>
                <Sparkles color={colors.gold} size={18} strokeWidth={1.8} />
              </View>
              <View style={styles.noticeCopy}>
                <Text style={styles.noticeTitle}>Wake the narrator</Text>
                <Text style={styles.noticeBody}>
                  Add your OpenRouter key and choose a model to begin.
                </Text>
              </View>
              <ChevronRight color={colors.gold} size={18} strokeWidth={1.8} />
            </Pressable>
          ) : (
            <View style={styles.readyCard}>
              <CircleCheck color={colors.success} size={18} strokeWidth={1.8} />
              <View style={styles.noticeCopy}>
                <Text style={styles.readyTitle}>Narrator ready</Text>
                <Text style={styles.readyBody}>{settings.modelName}</Text>
              </View>
              <View style={styles.readyDot} />
            </View>
          )}

          <AppButton
            disabled={!hydrated}
            icon={<Feather color={colors.onAccent} size={17} strokeWidth={2} />}
            label="Begin the story"
            onPress={() => router.push('/story')}
            style={styles.primaryAction}
          />

          <View style={styles.premise}>
            <Text style={type.eyebrow}>The premise</Text>
            <Text style={styles.premiseTitle}>The road remembers.</Text>
            <Text style={styles.premiseBody}>
              You are Kan, a shinobi in the world of Naruto. No village owns your
              name. No order binds your hand. Every place you go, someone is
              watching—and every choice you make leaves a mark.
            </Text>
          </View>

          <SurfaceCard style={styles.tellingCard}>
            <View style={styles.cardHeadingRow}>
              <Text style={type.eyebrow}>The telling</Text>
              <Text style={styles.cardIndex}>SETTINGS / 01</Text>
            </View>

            <Pressable
              accessibilityLabel="Change narrator model"
              accessibilityRole="button"
              onPress={() => router.navigate('/(tabs)/settings')}
              style={({ pressed }) => [
                styles.settingRow,
                pressed && styles.pressed,
              ]}
            >
              <Sparkles color={colors.textDim} size={17} strokeWidth={1.7} />
              <View style={styles.settingCopy}>
                <Text style={styles.settingLabel}>Narrator</Text>
                <Text numberOfLines={1} style={styles.settingValue}>
                  {settings.modelName}
                </Text>
              </View>
              <ChevronRight color={colors.textDim} size={16} />
            </Pressable>

            <View style={styles.rule} />

            <Pressable
              accessibilityLabel="Change scene image frequency"
              accessibilityRole="button"
              onPress={() => router.navigate('/(tabs)/settings')}
              style={({ pressed }) => [
                styles.settingRow,
                pressed && styles.pressed,
              ]}
            >
              <ImageIcon color={colors.textDim} size={17} strokeWidth={1.7} />
              <View style={styles.settingCopy}>
                <Text style={styles.settingLabel}>Scene images</Text>
                <Text style={styles.settingValue}>
                  {imageLabels[settings.imageFrequency]}
                </Text>
              </View>
              <ChevronRight color={colors.textDim} size={16} />
            </Pressable>

            <View style={styles.rule} />

            <Pressable
              accessibilityLabel="Change narration style"
              accessibilityRole="button"
              onPress={() => router.navigate('/(tabs)/settings')}
              style={({ pressed }) => [
                styles.settingRow,
                pressed && styles.pressed,
              ]}
            >
              <PenLine color={colors.textDim} size={17} strokeWidth={1.7} />
              <View style={styles.settingCopy}>
                <Text style={styles.settingLabel}>Narration</Text>
                <Text style={styles.settingValue}>
                  {narrationLabels[settings.narrationStyle]}
                </Text>
              </View>
              <ChevronRight color={colors.textDim} size={16} />
            </Pressable>
          </SurfaceCard>

          <View style={styles.footer}>
            <View style={styles.footerRule} />
            <Text style={styles.quote}>
              “A shinobi is not born. They are written.”
            </Text>
            <Text style={styles.version}>KAN · FIRST DRAFT</Text>
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
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxxl,
    gap: spacing.lg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.7,
  },
  heroShell: {
    borderRadius: radius.xxl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 34,
    elevation: 12,
  },
  hero: {
    minHeight: 352,
    padding: 22,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  heroArt: {
    ...StyleSheet.absoluteFillObject,
  },
  sun: {
    position: 'absolute',
    width: 250,
    height: 250,
    borderRadius: 125,
    right: -56,
    top: 34,
    backgroundColor: 'rgba(201, 74, 52, 0.42)',
  },
  sunRing: {
    position: 'absolute',
    width: 304,
    height: 304,
    borderRadius: 152,
    right: -83,
    top: 7,
    borderWidth: 1,
    borderColor: 'rgba(199, 164, 103, 0.28)',
  },
  heroLetter: {
    position: 'absolute',
    right: -2,
    top: 96,
    fontFamily: fonts.display,
    fontSize: 238,
    lineHeight: 258,
    color: 'rgba(244, 234, 214, 0.08)',
  },
  slash: {
    position: 'absolute',
    width: 500,
    height: 1,
    right: -160,
    top: 202,
    backgroundColor: 'rgba(244, 234, 214, 0.12)',
    transform: [{ rotate: '-38deg' }],
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.accentBright,
  },
  heroEyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  chapterPill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: 'rgba(10, 9, 8, 0.38)',
  },
  chapterPillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 1.2,
    color: colors.gold,
  },
  heroCopy: {
    gap: 2,
    maxWidth: 310,
    paddingTop: spacing.xxxl,
  },
  heroTitle: {
    fontFamily: fonts.display,
    fontSize: 72,
    lineHeight: 76,
    letterSpacing: -2.4,
    color: colors.text,
  },
  heroTagline: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
    maxWidth: 250,
  },
  heroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  heroMetaItem: {
    gap: 2,
  },
  heroMetaLabel: {
    fontFamily: fonts.body,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  heroMetaValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.text,
  },
  heroMetaRule: {
    width: 1,
    height: 24,
    backgroundColor: colors.border,
  },
  loadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 66,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textDim,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 70,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  noticeIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(199, 164, 103, 0.1)',
    borderWidth: 1,
    borderColor: colors.goldBorder,
  },
  noticeCopy: {
    flex: 1,
    gap: 2,
  },
  noticeTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  noticeBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  readyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(134, 186, 152, 0.2)',
    backgroundColor: colors.successSoft,
  },
  readyTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  readyBody: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  readyDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  primaryAction: {
    marginTop: 2,
  },
  premise: {
    gap: 6,
    paddingTop: spacing.md,
  },
  premiseTitle: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.4,
    color: colors.text,
  },
  premiseBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 23,
    color: colors.textMuted,
    maxWidth: 580,
  },
  tellingCard: {
    marginTop: spacing.xs,
  },
  cardHeadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardIndex: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.textDim,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingVertical: 5,
  },
  settingCopy: {
    flex: 1,
    gap: 1,
  },
  settingLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textDim,
  },
  settingValue: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  rule: {
    height: 1,
    marginLeft: 29,
    backgroundColor: colors.border,
  },
  footer: {
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.sm,
  },
  footerRule: {
    width: 36,
    height: 1,
    backgroundColor: colors.goldBorder,
  },
  quote: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textMuted,
    textAlign: 'center',
    maxWidth: 280,
  },
  version: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.textDim,
  },
});
