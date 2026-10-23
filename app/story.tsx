import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronRight,
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
import { SurfaceCard } from '@/components/SurfaceCard';
import { colors, fonts, radius, spacing } from '@/constants/theme';
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
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <ArrowLeft color={colors.text} size={22} strokeWidth={2} />
          </Pressable>

          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>Kan</Text>
            <Text style={styles.headerSubtitle}>Chapter 01 · Rain at the gate</Text>
          </View>

          <Pressable
            accessibilityLabel="Open story settings"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.navigate('/(tabs)/settings')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Settings2 color={colors.text} size={21} strokeWidth={2} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <LinearGradient
            colors={['#24080B', '#131313', '#0D0D0D']}
            locations={[0, 0.55, 1]}
            style={styles.sceneCard}
          >
            <View style={styles.sceneTop}>
              <Text style={styles.sceneLabel}>Scene 01</Text>
              <View style={styles.sceneMeta}>
                <ImageIcon
                  color={settings.imageFrequency === 'off' ? colors.textDim : colors.accent}
                  size={13}
                  strokeWidth={1.8}
                />
                <Text
                  style={[
                    styles.sceneMetaText,
                    settings.imageFrequency !== 'off' && styles.sceneMetaActive,
                  ]}
                >
                  {settings.imageFrequency === 'off' ? 'Images off' : 'Illustrated'}
                </Text>
              </View>
            </View>
            <View style={styles.sceneCopy}>
              <Text style={styles.sceneLocation}>Land of Fire · Dusk</Text>
              <Text style={styles.sceneTitle}>Rain at the gate</Text>
            </View>
          </LinearGradient>

          <View style={styles.narration}>
            <Text style={styles.eyebrow}>Narrator</Text>
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
              <SurfaceCard style={styles.choiceCard}>
                {choices.map((choice, index) => (
                  <View key={choice}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <Pressable
                      accessibilityLabel={`Choose: ${choice}`}
                      accessibilityRole="button"
                      onPress={() => submitAction(choice)}
                      style={({ pressed }) => [
                        styles.choice,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.choiceNumber}>
                        {String(index + 1).padStart(2, '0')}
                      </Text>
                      <Text style={styles.choiceText}>{choice}</Text>
                      <ChevronRight
                        color={colors.textDim}
                        size={17}
                        strokeWidth={1.8}
                      />
                    </Pressable>
                  </View>
                ))}
              </SurfaceCard>
            </View>
          ) : null}

          {turns.map((turn) => (
            <View key={turn.id} style={styles.turnBlock}>
              <Text style={styles.turnLabel}>Kan</Text>
              <View style={styles.turnBubble}>
                <Text style={styles.turnText}>{turn.text}</Text>
              </View>
            </View>
          ))}

          {turns.length > 0 ? (
            <SurfaceCard style={styles.waitingCard}>
              <View style={styles.waitingIcon}>
                <Sparkles color={colors.accent} size={18} strokeWidth={2} />
              </View>
              <View style={styles.waitingCopy}>
                <Text style={styles.waitingTitle}>
                  {hasNarrator ? 'Preview scene' : 'Narrator not connected'}
                </Text>
                <Text style={styles.waitingBody}>
                  {hasNarrator
                    ? 'Narration will appear here when the story engine is connected.'
                    : 'Connect OpenRouter in Settings to continue.'}
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
                  <Text style={styles.connectLabel}>Connect</Text>
                </Pressable>
              ) : null}
            </SurfaceCard>
          ) : null}

          {turns.length > 0 ? (
            <Pressable
              accessibilityLabel="Clear the preview action"
              accessibilityRole="button"
              onPress={() => setTurns([])}
              style={({ pressed }) => [styles.clearAction, pressed && styles.pressed]}
            >
              <Text style={styles.clearLabel}>Clear action</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.composerShell}>
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
              <Send color={colors.onAccent} size={18} strokeWidth={2.2} />
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
    gap: spacing.sm,
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  headerCopy: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
  },
  headerTitle: {
    fontFamily: fonts.bold,
    fontSize: 16,
    lineHeight: 21,
    color: colors.text,
  },
  headerSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  content: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.xxl,
  },
  sceneCard: {
    minHeight: 168,
    padding: 18,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'space-between',
    gap: spacing.xxxl,
  },
  sceneTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sceneLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  sceneMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  sceneMetaText: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  sceneMetaActive: {
    color: colors.accent,
  },
  sceneCopy: {
    gap: 3,
  },
  sceneLocation: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  sceneTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    color: colors.text,
  },
  narration: {
    gap: spacing.lg,
  },
  eyebrow: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  prose: {
    fontFamily: fonts.regular,
    fontSize: 17,
    lineHeight: 28,
    color: colors.text,
  },
  dialogue: {
    paddingLeft: spacing.lg,
    borderLeftWidth: 2,
    borderLeftColor: colors.accent,
  },
  dialogueText: {
    fontFamily: fonts.medium,
    fontSize: 18,
    lineHeight: 27,
    color: colors.text,
  },
  choiceSection: {
    gap: spacing.sm,
  },
  choicePrompt: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  choiceCard: {
    padding: 0,
    overflow: 'hidden',
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: spacing.lg,
  },
  choiceNumber: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  choiceText: {
    flex: 1,
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.text,
  },
  divider: {
    height: 1,
    marginLeft: 42,
    backgroundColor: colors.border,
  },
  turnBlock: {
    gap: spacing.sm,
  },
  turnLabel: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  turnBubble: {
    maxWidth: '90%',
    padding: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  turnText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.text,
  },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  waitingIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  waitingCopy: {
    flex: 1,
    gap: 2,
  },
  waitingTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  waitingBody: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  connectButton: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  connectLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.onAccent,
  },
  clearAction: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  clearLabel: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  composerShell: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: 5,
    paddingLeft: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  composerInput: {
    flex: 1,
    maxHeight: 108,
    minHeight: 42,
    paddingTop: 11,
    paddingBottom: 10,
    fontFamily: fonts.regular,
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
    opacity: 0.3,
  },
});
