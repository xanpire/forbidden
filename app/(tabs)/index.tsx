import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ChevronRight,
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
import { colors, fonts, radius, spacing } from '@/constants/theme';
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
  const hasNarrator = Boolean(apiKey.trim());

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
                styles.iconButton,
                pressed && styles.pressed,
              ]}
            >
              <Settings2 color={colors.textMuted} size={21} strokeWidth={1.8} />
            </Pressable>
          </View>

          <View style={styles.hero}>
            <LinearGradient
              colors={['#22080B', '#111111', '#0C0C0C']}
              locations={[0, 0.5, 1]}
              style={styles.heroGradient}
            >
              <View style={styles.heroTop}>
                <Text style={styles.heroKicker}>Original Naruto story</Text>
                <Text style={styles.chapter}>Chapter 01</Text>
              </View>

              <View style={styles.heroCopy}>
                <Text style={styles.heroTitle}>Kan</Text>
                <Text style={styles.heroTagline}>
                  No village. No orders. Every choice leaves a mark.
                </Text>
              </View>

              <AppButton
                label="Begin story"
                onPress={() => router.push('/story')}
                style={styles.heroButton}
              />
            </LinearGradient>
          </View>

          <Pressable
            accessibilityLabel="Open narrator settings"
            accessibilityRole="button"
            onPress={() => router.navigate('/(tabs)/settings')}
            style={({ pressed }) => [styles.statusRow, pressed && styles.pressed]}
          >
            {!hydrated ? (
              <>
                <ActivityIndicator color={colors.textDim} size="small" />
                <Text style={styles.statusText}>Loading your setup…</Text>
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: hasNarrator
                        ? colors.success
                        : colors.accent,
                    },
                  ]}
                />
                <Text
                  style={[
                    styles.statusText,
                    !hasNarrator && styles.statusTextAccent,
                  ]}
                >
                  {hasNarrator ? 'Narrator ready' : 'Narrator not connected'}
                </Text>
                <Text numberOfLines={1} style={styles.statusDetail}>
                  {hasNarrator ? settings.modelName : 'OpenRouter'}
                </Text>
              </>
            )}
            <ChevronRight color={colors.textDim} size={16} strokeWidth={1.8} />
          </Pressable>

          <View style={styles.intro}>
            <Text style={styles.introTitle}>The road remembers.</Text>
            <Text style={styles.introBody}>
              Play as Kan in the world of Naruto. Speak, act, and let every
              choice shape the road ahead.
            </Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Your setup</Text>
            <SurfaceCard style={styles.setupCard}>
              <Pressable
                accessibilityLabel="Change narrator model"
                accessibilityRole="button"
                onPress={() => router.navigate('/(tabs)/settings')}
                style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
              >
                <Sparkles color={colors.textDim} size={18} strokeWidth={1.8} />
                <View style={styles.settingCopy}>
                  <Text style={styles.settingLabel}>Narrator</Text>
                  <Text numberOfLines={1} style={styles.settingValue}>
                    {settings.modelName}
                  </Text>
                </View>
                <ChevronRight color={colors.textDim} size={17} strokeWidth={1.8} />
              </Pressable>

              <View style={styles.divider} />

              <Pressable
                accessibilityLabel="Change scene image frequency"
                accessibilityRole="button"
                onPress={() => router.navigate('/(tabs)/settings')}
                style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
              >
                <ImageIcon color={colors.textDim} size={18} strokeWidth={1.8} />
                <View style={styles.settingCopy}>
                  <Text style={styles.settingLabel}>Scene images</Text>
                  <Text style={styles.settingValue}>
                    {imageLabels[settings.imageFrequency]}
                  </Text>
                </View>
                <ChevronRight color={colors.textDim} size={17} strokeWidth={1.8} />
              </Pressable>

              <View style={styles.divider} />

              <Pressable
                accessibilityLabel="Change narration style"
                accessibilityRole="button"
                onPress={() => router.navigate('/(tabs)/settings')}
                style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
              >
                <PenLine color={colors.textDim} size={18} strokeWidth={1.8} />
                <View style={styles.settingCopy}>
                  <Text style={styles.settingLabel}>Narration</Text>
                  <Text style={styles.settingValue}>
                    {narrationLabels[settings.narrationStyle]}
                  </Text>
                </View>
                <ChevronRight color={colors.textDim} size={17} strokeWidth={1.8} />
              </Pressable>
            </SurfaceCard>
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
    paddingTop: spacing.md,
    paddingBottom: spacing.xxxl,
    gap: spacing.xxl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
  },
  pressed: {
    opacity: 0.65,
  },
  hero: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  heroGradient: {
    minHeight: 300,
    padding: 22,
    justifyContent: 'space-between',
    gap: spacing.xxxl,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  heroKicker: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  chapter: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  heroCopy: {
    gap: 8,
  },
  heroTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 64,
    lineHeight: 66,
    letterSpacing: -2.5,
    color: colors.text,
  },
  heroTagline: {
    maxWidth: 320,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textMuted,
  },
  heroButton: {
    alignSelf: 'flex-start',
    minWidth: 148,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -spacing.sm,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.text,
  },
  statusTextAccent: {
    color: colors.accent,
  },
  statusDetail: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
    textAlign: 'right',
  },
  intro: {
    gap: 6,
  },
  introTitle: {
    fontFamily: fonts.bold,
    fontSize: 25,
    lineHeight: 31,
    letterSpacing: -0.6,
    color: colors.text,
  },
  introBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
  },
  section: {
    gap: 0,
  },
  sectionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textDim,
    marginBottom: spacing.sm,
  },
  setupCard: {
    padding: 0,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.lg,
  },
  settingCopy: {
    flex: 1,
    gap: 2,
  },
  settingLabel: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textDim,
  },
  settingValue: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  divider: {
    height: 1,
    marginLeft: 47,
    backgroundColor: colors.border,
  },
});
