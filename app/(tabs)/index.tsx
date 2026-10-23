import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  CircleAlert,
  Heart,
  MapPin,
  MessageCircle,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  Sword,
  Undo2,
  Zap,
} from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { AppButton } from '@/components/AppButton';
import { SurfaceCard } from '@/components/SurfaceCard';
import { Wordmark } from '@/components/Wordmark';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatShortDate } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';

type InputMode = 'speech' | 'action';

type StoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function StoryScreen() {
  const router = useRouter();
  const {
    db,
    apiKey,
    error,
    isNarrating,
    isProcessing,
    streamingText,
    lastPromptTokens,
    sendTurn,
    regenerate,
    undoLastTurn,
  } = useGame();

  const [input, setInput] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('speech');
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const lastActionRef = useRef('');

  const messages = useMemo<StoryMessage[]>(() => {
    if (!db) {
      return [];
    }

    return db.rawLog
      .filter((message) => message.kind === 'story')
      .map((message) => ({
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      }));
  }, [db]);

  useEffect(() => {
    if (messages.length === 0 && streamingText.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length, streamingText]);

  const submit = useCallback(
    async (value: string, mode: InputMode) => {
      const raw = value.trim();

      if (!raw || isNarrating) {
        return;
      }

      const action = formatPlayerInput(raw, mode);

      lastActionRef.current = action;
      setInput('');
      await sendTurn(action);
    },
    [isNarrating, sendTurn]
  );

  const submitCurrent = useCallback(() => {
    void submit(input, inputMode);
  }, [input, inputMode, submit]);

  const retry = useCallback(async () => {
    const action = lastActionRef.current;

    if (action) {
      await sendTurn(action);
      return;
    }

    await regenerate();
  }, [regenerate, sendTurn]);

  if (!db) {
    return (
      <View style={styles.loadingRoot}>
        <AppBackground />
        <SafeAreaView edges={['top']} style={styles.loadingState}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.loadingText}>Loading your story…</Text>
        </SafeAreaView>
      </View>
    );
  }

  const storyStarted = messages.length > 0;
  const state = db.state;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <AppBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Wordmark compact />
          <Pressable
            accessibilityLabel="Open settings"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.navigate('/(tabs)/settings')}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Settings2 color={colors.text} size={20} strokeWidth={2} />
          </Pressable>
        </View>

        <View style={styles.statusRow}>
          <View style={styles.statusChip}>
            <Heart color={colors.accent} size={12} strokeWidth={2} />
            <Text style={styles.statusText}>
              HP {state.hp.current}/{state.hp.max}
            </Text>
          </View>
          <View style={styles.statusChip}>
            <Zap color={colors.accent} size={12} strokeWidth={2} />
            <Text style={styles.statusText}>
              Chakra {state.chakra.current}/{state.chakra.max}
            </Text>
          </View>
          <View style={styles.statusChip}>
            <MapPin color={colors.textMuted} size={12} strokeWidth={2} />
            <Text numberOfLines={1} style={styles.statusText}>
              {state.location}
            </Text>
          </View>
          <View style={styles.statusChip}>
            <Text style={styles.statusText}>{formatShortDate(state.inStoryDate)}</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          {!storyStarted ? (
            <SurfaceCard style={styles.seedCard}>
              <View style={styles.seedTop}>
                <Text style={styles.seedKicker}>Chapter {state.chapter}</Text>
                <Text style={styles.seedScene}>{state.scene}</Text>
              </View>
              <Text style={styles.seedTitle}>The rain hasn’t stopped.</Text>
              <Text style={styles.seedBody}>
                Kan waits in the forest outside Konoha. The Uchiha massacre is
                finished, and Itachi still hasn’t come. Thunder moves through the
                trees, and every drop sounds like footsteps.
              </Text>
              <AppButton
                label="Kan waits for Itachi"
                onPress={() => void submit('Kan waits for Itachi in the rain.', 'action')}
                style={styles.seedButton}
              />
            </SurfaceCard>
          ) : null}

          {messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageRow,
                message.role === 'user' ? styles.userRow : styles.assistantRow,
              ]}
            >
              <View
                style={[
                  styles.messageBubble,
                  message.role === 'user' ? styles.userBubble : styles.assistantBubble,
                ]}
              >
                <Text
                  style={[
                    styles.messageText,
                    message.role === 'user' ? styles.userText : styles.assistantText,
                  ]}
                >
                  {message.content}
                </Text>
              </View>
            </View>
          ))}

          {isNarrating ? (
            <View style={styles.messageRow}>
              <View style={styles.assistantBubble}>
                {streamingText.length > 0 ? (
                  <Text style={styles.assistantText}>{streamingText}</Text>
                ) : (
                  <View style={styles.typingRow}>
                    <ActivityIndicator color={colors.accent} size="small" />
                    <Text style={styles.typingText}>The world is moving…</Text>
                  </View>
                )}
              </View>
            </View>
          ) : null}

          {error ? (
            <SurfaceCard style={styles.errorCard}>
              <CircleAlert color={colors.danger} size={16} strokeWidth={2} />
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>The narrator stumbled</Text>
                <Text style={styles.errorBody}>{error}</Text>
              </View>
              <AppButton
                compact
                label="Retry"
                onPress={() => void retry()}
                style={styles.retryButton}
                variant="secondary"
              />
            </SurfaceCard>
          ) : null}

          {!apiKey ? (
            <SurfaceCard style={styles.apiCard}>
              <Sparkles color={colors.accent} size={16} strokeWidth={2} />
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Connect your narrator</Text>
                <Text style={styles.errorBody}>
                  Add an OpenRouter API key in Settings to begin.
                </Text>
              </View>
              <AppButton
                compact
                label="Settings"
                onPress={() => router.navigate('/(tabs)/settings')}
                style={styles.retryButton}
                variant="secondary"
              />
            </SurfaceCard>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.composerShell,
            { paddingBottom: Math.max(insets.bottom, spacing.sm) },
          ]}
        >
          <View style={styles.modeRow}>
            <Pressable
              accessibilityLabel="Speech input mode"
              accessibilityRole="button"
              accessibilityState={{ checked: inputMode === 'speech' }}
              onPress={() => setInputMode('speech')}
              style={({ pressed }) => [
                styles.modeButton,
                inputMode === 'speech' && styles.modeButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <MessageCircle
                color={inputMode === 'speech' ? colors.onAccent : colors.textMuted}
                size={13}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.modeLabel,
                  inputMode === 'speech' && styles.modeLabelActive,
                ]}
              >
                Speech
              </Text>
            </Pressable>

            <Pressable
              accessibilityLabel="Action input mode"
              accessibilityRole="button"
              accessibilityState={{ checked: inputMode === 'action' }}
              onPress={() => setInputMode('action')}
              style={({ pressed }) => [
                styles.modeButton,
                inputMode === 'action' && styles.modeButtonActive,
                pressed && styles.pressed,
              ]}
            >
              <Sword
                color={inputMode === 'action' ? colors.onAccent : colors.textMuted}
                size={13}
                strokeWidth={2}
              />
              <Text
                style={[
                  styles.modeLabel,
                  inputMode === 'action' && styles.modeLabelActive,
                ]}
              >
                Action
              </Text>
            </Pressable>
          </View>

          <View style={styles.composerMeta}>
            {isProcessing ? (
              <View style={styles.processingRow}>
                <ActivityIndicator color={colors.accent} size="small" />
                <Text style={styles.processingText}>Memory updating…</Text>
              </View>
            ) : (
              <Text style={styles.tokenText}>
                {lastPromptTokens > 0 ? `~${lastPromptTokens} prompt tokens` : 'Ready'}
              </Text>
            )}
            <View style={styles.composerActions}>
              <Pressable
                accessibilityLabel="Undo last turn"
                accessibilityRole="button"
                disabled={!storyStarted || isNarrating}
                onPress={() => void undoLastTurn()}
                style={({ pressed }) => [
                  styles.smallButton,
                  pressed && styles.pressed,
                  (!storyStarted || isNarrating) && styles.disabled,
                ]}
              >
                <Undo2 color={colors.textMuted} size={15} strokeWidth={2} />
              </Pressable>
              <Pressable
                accessibilityLabel="Regenerate last reply"
                accessibilityRole="button"
                disabled={!storyStarted || isNarrating}
                onPress={() => void regenerate()}
                style={({ pressed }) => [
                  styles.smallButton,
                  pressed && styles.pressed,
                  (!storyStarted || isNarrating) && styles.disabled,
                ]}
              >
                <RotateCcw color={colors.textMuted} size={15} strokeWidth={2} />
              </Pressable>
            </View>
          </View>

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="What does Kan do?"
              editable={!isNarrating}
              maxLength={1000}
              multiline
              onChangeText={setInput}
              placeholder={
                inputMode === 'speech'
                  ? 'What does Kan say?'
                  : 'What does Kan do?'
              }
              placeholderTextColor={colors.textDim}
              style={styles.composerInput}
              value={input}
            />
            <Pressable
              accessibilityLabel="Send Kan's action"
              accessibilityRole="button"
              disabled={!input.trim() || isNarrating}
              onPress={submitCurrent}
              style={({ pressed }) => [
                styles.sendButton,
                pressed && styles.pressed,
                (!input.trim() || isNarrating) && styles.sendDisabled,
              ]}
            >
              {isNarrating ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : (
                <Send color={colors.onAccent} size={18} strokeWidth={2.2} />
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function formatPlayerInput(value: string, mode: InputMode) {
  const cleaned = value
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/^\*\*+|\*\*+$/g, '')
    .trim();

  if (!cleaned) {
    return '';
  }

  return mode === 'speech' ? `"${cleaned}"` : `**${cleaned}**`;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safe: {
    flex: 1,
  },
  loadingRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.textDim,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
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
  statusRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
  },
  seedCard: {
    gap: 12,
    marginBottom: spacing.sm,
  },
  seedTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  seedKicker: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textDim,
  },
  seedScene: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textMuted,
  },
  seedTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.8,
    color: colors.text,
  },
  seedBody: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.textMuted,
  },
  seedButton: {
    alignSelf: 'flex-start',
    minWidth: 170,
  },
  messageRow: {
    flexDirection: 'row',
  },
  userRow: {
    justifyContent: 'flex-end',
  },
  assistantRow: {
    justifyContent: 'flex-start',
  },
  messageBubble: {
    maxWidth: '92%',
    padding: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
    borderBottomRightRadius: radius.sm,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderBottomLeftRadius: radius.sm,
  },
  messageText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
  },
  userText: {
    color: colors.onAccent,
  },
  assistantText: {
    color: colors.text,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textDim,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorCopy: {
    flex: 1,
    gap: 2,
  },
  errorTitle: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  errorBody: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  retryButton: {
    minWidth: 68,
  },
  apiCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  modeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 13,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeButtonActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  modeLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  modeLabelActive: {
    color: colors.onAccent,
  },
  composerShell: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  composerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
    marginBottom: 6,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  processingText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.accent,
  },
  tokenText: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.textDim,
  },
  composerActions: {
    flexDirection: 'row',
    gap: 6,
  },
  smallButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  disabled: {
    opacity: 0.35,
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
    maxHeight: 112,
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
  sendDisabled: {
    opacity: 0.3,
  },
});
