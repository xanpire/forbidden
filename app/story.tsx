import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronRight,
  Feather,
  Image as ImageIcon,
  Send,
  Settings2,
  Sparkles,
} from 'lucide-react-native';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/AppBackground';
import { SceneArt } from '@/components/SceneArt';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { useSettings } from '@/lib/settings';

type Turn = {
  id: number;
  text: string;
};

const choices = [
  'Ask who has been waiting for you.',
  'Step past the gatekeeper without a word.',
  'Study the gate before you answer.',
];

export default function StoryScreen() {
  const router = useRouter();
  const { apiKey, settings } = useSettings();
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const scrollRef = useRef<ScrollView>(null);
  const hasNarrator = Boolean(apiKey.trim());

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/(tabs)');
  };

  const submitAction = (value: string) => {
    const text = value.trim();

    if (!text) {
      return;
    }

    setTurns((current) => [
      ...current,
      {
        id: Date.now(),
        text,
      },
    ]);
    setDraft('');
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <AppBackground />
      <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back to story home"
            accessibilityRole="button"
            hitSlop={8}
            onPress={goBack}
            style={({ pressed }) => [
              styles.headerButton,
              pressed && styles.pressed,
            ]}
          >
            <ArrowLeft color={colors.textMuted} size={20} strokeWidth={1.8} />
          </Pressable>

          <View style={styles.headerCopy}>
            <Text style={styles.headerEyebrow}>CHAPTER I</Text>
            <Text numberOfLines={1} style={styles.headerTitle}>
              Rain at the gate
            </Text>
          </View>

          <Pressable
            accessibilityLabel="Open story settings"
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

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.previewBanner}>
            <Sparkles color={colors.gold} size={15} strokeWidth={1.8} />
            <Text style={styles.previewText}>
              Interface preview · narration and images arrive in the next build.
            </Text>
          </View>

          <View style={styles.sceneFrame}>
            <SceneArt />
            <LinearGradient
              colors={['transparent', 'rgba(8, 7, 6, 0.18)', 'rgba(8, 7, 6, 0.92)']}
              locations={[0, 0.5, 1]}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.sceneTopRow}>
              <View style={styles.scenePill}>
                <Text style={styles.scenePillText}>SCENE I</Text>
              </View>
              <View style={styles.scenePill}>
                <ImageIcon
                  color={settings.imageFrequency === 'off' ? colors.textDim : colors.gold}
                  size={11}
                  strokeWidth={1.8}
                />
                <Text style={styles.scenePillText}>
                  {settings.imageFrequency === 'off' ? 'IMAGE OFF' : 'ILLUSTRATED'}
                </Text>
              </View>
            </View>
            <View style={styles.sceneCopy}>
              <Text style={styles.sceneEyebrow}>LAND OF FIRE · DUSK</Text>
              <Text style={styles.sceneTitle}>Rain at the gate</Text>
            </View>
          </View>

          <View style={styles.narration}>
            <View style={styles.narrationHeading}>
              <View style={styles.narrationMark}>
                <Feather color={colors.accentBright} size={15} strokeWidth={1.8} />
              </View>
              <Text style={type.eyebrow}>Narrator</Text>
              <View style={styles.narrationRule} />
              <Text style={styles.narrationIndex}>01</Text>
            </View>

            <Text style={styles.prose}>
              Rain moved through the gate in silver threads. The village beyond
              it had no name on any map Kan had seen, but the gatekeeper looked
              at him as if he had been expected for years.
            </Text>

            <View style={styles.dialogue}>
              <Text style={styles.dialogueText}>“You’re late,” she said.</Text>
            </View>

            <Text style={styles.prose}>
              Kan kept his hood low. Somewhere behind the rain, a bell rang once.
            </Text>
          </View>

          {turns.length === 0 ? (
            <View style={styles.choiceSection}>
              <Text style={styles.choicePrompt}>What does Kan do?</Text>
              {choices.map((choice, index) => (
                <Pressable
                  accessibilityLabel={`Choose: ${choice}`}
                  accessibilityRole="button"
                  key={choice}
                  onPress={() => submitAction(choice)}
                  style={({ pressed }) => [
                    styles.choice,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.choiceLetter}>
                    <Text style={styles.choiceLetterText}>
                      {String.fromCharCode(65 + index)}
                    </Text>
                  </View>
                  <Text style={styles.choiceText}>{choice}</Text>
                  <ChevronRight color={colors.textDim} size={17} strokeWidth={1.8} />
                </Pressable>
              ))}
            </View>
          ) : null}

          {turns.map((turn) => (
            <View key={turn.id} style={styles.turnBlock}>
              <View style={styles.turnHeading}>
                <Text style={styles.turnLabel}>KAN</Text>
                <View style={styles.turnRule} />
              </View>
              <View style={styles.turnBubble}>
                <Text style={styles.turnText}>{turn.text}</Text>
              </View>
            </View>
          ))}

          {turns.length > 0 ? (
            <View style={styles.waitingCard}>
              <View style={styles.waitingIcon}>
                <Sparkles color={colors.gold} size={18} strokeWidth={1.8} />
              </View>
              <View style={styles.waitingCopy}>
                <Text style={styles.waitingTitle}>
                  {hasNarrator ? 'The narrator is ready' : 'Wake the narrator'}
                </Text>
                <Text style={styles.waitingBody}>
                  {hasNarrator
                    ? 'Story generation connects in the next build. Your move is waiting.'
                    : 'Connect OpenRouter to let the world answer Kan’s next move.'}
                </Text>
              </View>
              {!hasNarrator ? (
                <Pressable
                  accessibilityLabel="Open settings to connect OpenRouter"
                  accessibilityRole="button"
                  onPress={() => router.navigate('/(tabs)/settings')}
                  style={({ pressed }) => [
                    styles.connectButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.connectButtonText}>Connect</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {turns.length > 0 ? (
            <Pressable
              accessibilityLabel="Return to the moment before acting"
              accessibilityRole="button"
              onPress={() => setTurns([])}
              style={({ pressed }) => [styles.rewind, pressed && styles.pressed]}
            >
              <Text style={styles.rewindText}>Rewind this preview</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.composerShell}>
          <View style={styles.composerMeta}>
            <Text style={styles.composerRole}>YOU ARE KAN</Text>
            <Text style={styles.composerMode}>PREVIEW</Text>
          </View>
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="What does Kan do?"
              maxLength={500}
              multiline
              onChangeText={setDraft}
              placeholder="Speak, act, or think as Kan…"
              placeholderTextColor={colors.textDim}
              style={styles.composerInput}
              value={draft}
            />
            <Pressable
              accessibilityLabel="Send Kan's action"
              accessibilityRole="button"
              disabled={!draft.trim()}
              onPress={() => submitAction(draft)}
              style={({ pressed }) => [
                styles.sendButton,
                !draft.trim() && styles.sendButtonDisabled,
                pressed && draft.trim() ? styles.pressed : null,
              ]}
            >
              <Send color={colors.onAccent} size={18} strokeWidth={2} />
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: 'rgba(10, 9, 8, 0.92)',
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  headerEyebrow: {
    fontFamily: fonts.mono,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 1.4,
    color: colors.textDim,
  },
  headerTitle: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 24,
    color: colors.text,
  },
  pressed: {
    opacity: 0.7,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.xl,
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  previewText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  sceneFrame: {
    height: 254,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    justifyContent: 'space-between',
    padding: spacing.lg,
    backgroundColor: '#120D0B',
  },
  sceneTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scenePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(244, 234, 214, 0.16)',
    backgroundColor: 'rgba(10, 9, 8, 0.42)',
  },
  scenePillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  sceneCopy: {
    gap: 3,
  },
  sceneEyebrow: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.5,
    color: colors.gold,
  },
  sceneTitle: {
    fontFamily: fonts.display,
    fontSize: 31,
    lineHeight: 37,
    letterSpacing: -0.3,
    color: colors.text,
  },
  narration: {
    gap: spacing.md,
  },
  narrationHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  narrationMark: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  narrationRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  narrationIndex: {
    fontFamily: fonts.mono,
    fontSize: 9,
    color: colors.textDim,
  },
  prose: {
    fontFamily: fonts.display,
    fontSize: 18,
    lineHeight: 29,
    color: colors.textMuted,
  },
  dialogue: {
    paddingLeft: spacing.lg,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  dialogueText: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 29,
    color: colors.text,
    fontStyle: 'italic',
  },
  choiceSection: {
    gap: spacing.sm,
  },
  choicePrompt: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.gold,
    marginBottom: 2,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 62,
    padding: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceLetter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  choiceLetterText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.textMuted,
  },
  choiceText: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  turnBlock: {
    gap: spacing.sm,
  },
  turnHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  turnLabel: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.accentBright,
  },
  turnRule: {
    flex: 1,
    height: 1,
    backgroundColor: colors.accentBorder,
  },
  turnBubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  turnText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  waitingIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: 'rgba(199, 164, 103, 0.08)',
  },
  waitingCopy: {
    flex: 1,
    gap: 2,
  },
  waitingTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  waitingBody: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  connectButton: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  connectButtonText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.gold,
  },
  rewind: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  rewindText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.textDim,
    textDecorationLine: 'underline',
  },
  composerShell: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  composerRole: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1.2,
    color: colors.accentBright,
  },
  composerMode: {
    fontFamily: fonts.mono,
    fontSize: 8,
    letterSpacing: 1.2,
    color: colors.textDim,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: 6,
    paddingLeft: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  composerInput: {
    flex: 1,
    maxHeight: 108,
    minHeight: 42,
    paddingTop: 11,
    paddingBottom: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  sendButtonDisabled: {
    opacity: 0.35,
  },
});
