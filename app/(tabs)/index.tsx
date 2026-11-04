import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import {
  ArrowUp,
  CircleAlert,
  Download,
  Image as ImageIcon,
  Moon,
  Clock3,
  RotateCcw,
  Sparkles,
  Sun,
  Undo2,
  X,
} from 'lucide-react-native';

import { AppButton } from '@/components/AppButton';
import { FilterPills, ListCard, ListRow, SectionLabel } from '@/components/List';
import { Wordmark } from '@/components/Wordmark';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import {
  formatClock,
  formatDayMonth,
  formatElapsed,
  formatStoryDate,
  timeOfDayOf,
} from '@/lib/rpg/calendar';
import { localizePlaceNames } from '@/lib/rpg/glossary';
import { streamingPreview, stripNarrationJson } from '@/lib/rpg/prompt';
import { useGame } from '@/lib/rpg/game';
import { companionsOf } from '@/lib/rpg/companions';
import { useToast } from '@/components/Toast';
import { downloadImage } from '@/lib/rpg/file';
import {
  buildSceneImagePrompt,
  collectRecentSceneImages,
  fallbackImageAction,
  sceneCharacterReferences,
  writeImageAction,
} from '@/lib/rpg/image';
import { ensureImageCaps } from '@/lib/rpg/imageCaps';
import { loadImage, loadImages, useStoredImage } from '@/lib/rpg/imageStore';
import {
  faceDroppedWarning,
  loadKanReferenceImages,
  planReferences,
} from '@/lib/rpg/referenceImages';
import { wearsAkatsukiCloak } from '@/lib/rpg/portrait';
import { generateImage } from '@/lib/openrouter';
import { recordDebugImage, recordDebugSideCall } from '@/lib/rpg/debug';

type StoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image: string | null;
  elapsedSeconds?: number;
};

const TIME_PRESETS: { value: string; label: string; seconds: number }[] = [
  { value: '15', label: '15 s', seconds: 15 },
  { value: '60', label: '1 min', seconds: 60 },
  { value: '120', label: '2 min', seconds: 120 },
  { value: '600', label: '10 min', seconds: 600 },
  { value: '1800', label: '30 min', seconds: 1800 },
  { value: '3600', label: '1 h', seconds: 3600 },
  { value: '10800', label: '3 h', seconds: 10800 },
  { value: '28800', label: '8 h', seconds: 28800 },
  { value: '86400', label: '1 day', seconds: 86400 },
  { value: '259200', label: '3 days', seconds: 259200 },
];

type TimeUnit = 'min' | 'h' | 'd';

const UNIT_SECONDS: Record<TimeUnit, number> = { min: 60, h: 3600, d: 86400 };

function TimeChip({ seconds, onPress }: { seconds: number; onPress: () => void }) {
  const label = formatElapsed(seconds);

  return (
    <Pressable
      accessibilityLabel={`This took ${label.slice(1)}. Tap to correct the time.`}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.timeChip, pressed && styles.pressed]}
    >
      <Clock3 color={colors.textDim} size={12} strokeWidth={2} />
      <Text style={styles.timeChipLabel}>{label}</Text>
    </Pressable>
  );
}

function paragraphsOf(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Renders Kan's turn with *actions* in italics and everything else plain. */
function PlayerText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);

  return (
    <Text style={styles.playerText}>
      {parts.map((part, index) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
          <Text key={index} style={styles.playerAction}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          <Text key={index}>{part}</Text>
        )
      )}
    </Text>
  );
}

function SceneImage({ value, onOpen }: { value: string; onOpen: (uri: string) => void }) {
  const uri = useStoredImage(value);

  return (
    <Pressable
      accessibilityLabel="Open scene image"
      accessibilityRole="imagebutton"
      disabled={!uri}
      onPress={() => uri && onOpen(uri)}
      style={styles.sceneImageWrap}
    >
      {uri ? (
        <Image
          accessibilityLabel="Generated story scene"
          resizeMode="cover"
          source={{ uri }}
          style={styles.sceneImage}
        />
      ) : (
        <ActivityIndicator color={colors.textDim} size="small" />
      )}
    </Pressable>
  );
}

function InlineAction({
  label,
  icon,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.inlineAction,
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator color={colors.textMuted} size="small" /> : icon}
      <Text style={styles.inlineActionLabel}>{busy ? 'Painting…' : label}</Text>
    </Pressable>
  );
}

export default function StoryScreen() {
  const router = useRouter();
  const {
    db,
    apiKey,
    error,
    isNarrating,
    isProcessing,
    pendingMemoryCount,
    retryPendingMemory,
    streamingText,
    pendingAction,
    worldEventNotice,
    dismissWorldEventNotice,
    sendTurn,
    regenerate,
    undoLastTurn,
    attachImage,
    correctTurnTime,
    updateSettings,
  } = useGame();
  const { showToast } = useToast();

  const [input, setInput] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [timeTarget, setTimeTarget] = useState<{ id: string; seconds: number } | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [customUnit, setCustomUnit] = useState<TimeUnit>('min');
  const imageScale = useSharedValue(1);
  const imageTranslateX = useSharedValue(0);
  const imageTranslateY = useSharedValue(0);
  const gestureStartScale = useSharedValue(1);
  const gestureStartTranslateX = useSharedValue(0);
  const gestureStartTranslateY = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
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
        content:
          message.role === 'assistant'
            ? stripNarrationJson(message.content)
            : message.content,
        image: message.image ?? null,
        elapsedSeconds: message.role === 'assistant' ? message.elapsedSeconds : undefined,
      }));
  }, [db]);

  const liveParagraphs = useMemo(
    () => (isNarrating ? paragraphsOf(streamingPreview(streamingText)) : []),
    [isNarrating, streamingText]
  );

  useEffect(() => {
    if (messages.length === 0 && streamingText.length === 0) {
      return;
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages.length, streamingText]);

  const submit = useCallback(
    async (value: string) => {
      const action = value.trim();

      if (!action || isNarrating) {
        return;
      }

      lastActionRef.current = action;
      setInput('');
      selectionRef.current = null;
      await sendTurn(action);
    },
    [isNarrating, sendTurn]
  );

  const resetImageZoom = useCallback(() => {
    imageScale.value = withTiming(1);
    imageTranslateX.value = withTiming(0);
    imageTranslateY.value = withTiming(0);
  }, [imageScale, imageTranslateX, imageTranslateY]);

  const imagePinchGesture = Gesture.Pinch()
    .onBegin(() => {
      gestureStartScale.value = imageScale.value;
    })
    .onUpdate((event) => {
      const nextScale = gestureStartScale.value * event.scale;
      imageScale.value = Math.min(5, Math.max(1, nextScale));
    });

  const imagePanGesture = Gesture.Pan()
    .onBegin(() => {
      gestureStartTranslateX.value = imageTranslateX.value;
      gestureStartTranslateY.value = imageTranslateY.value;
    })
    .onUpdate((event) => {
      if (imageScale.value <= 1) {
        return;
      }

      imageTranslateX.value = gestureStartTranslateX.value + event.translationX;
      imageTranslateY.value = gestureStartTranslateY.value + event.translationY;
    });

  const imageDoubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      imageScale.value = withTiming(1);
      imageTranslateX.value = withTiming(0);
      imageTranslateY.value = withTiming(0);
    });

  const fullscreenImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: imageTranslateX.value },
      { translateY: imageTranslateY.value },
      { scale: imageScale.value },
    ],
  }));

  const generateSceneImage = useCallback(async () => {
    if (!db || isGeneratingImage || !apiKey) {
      return;
    }

    const latestAssistant = [...db.rawLog]
      .reverse()
      .find((message) => message.kind === 'story' && message.role === 'assistant');

    if (!latestAssistant) {
      showToast('Start the story first — there’s nothing to paint yet.', 'error');
      return;
    }

    setIsGeneratingImage(true);

    try {
      const [caps, written, recentImages, kanRefs] = await Promise.all([
        ensureImageCaps(db, updateSettings),
        writeImageAction(apiKey, db),
        loadImages(collectRecentSceneImages(db)),
        loadKanReferenceImages(wearsAkatsukiCloak(db)),
      ]);

      if (written) {
        recordDebugSideCall(latestAssistant.id, {
          kind: 'imageAction',
          model: written.model,
          usage: written.usage,
          apiKey,
        });
      }

      const action = written?.action ?? fallbackImageAction(db);
      // People named in the action who have a face reference or a portrait.
      const people = await Promise.all(
        sceneCharacterReferences(db, action).map(async (person) => ({
          kind: 'character' as const,
          uri: (await loadImage(person.image)) ?? '',
          name: person.name,
          source: person.source,
        }))
      );
      const plan = planReferences(
        [
          { kind: 'face', uri: kanRefs.face },
          { kind: 'outfit', uri: kanRefs.outfit },
          ...people,
          ...recentImages.map((uri) => ({ kind: 'previous' as const, uri })),
          { kind: 'alternate', uri: kanRefs.alternate },
        ],
        caps.maxReferences
      );

      if (plan.faceDropped) {
        showToast(faceDroppedWarning(plan.faceDropped, caps.modelId), 'error');
      }

      const prompt = buildSceneImagePrompt(db, plan.references, action);
      const startedAt = Date.now();
      const result = await generateImage({
        apiKey,
        caps,
        prompt,
        inputReferences: plan.references.map((reference) => reference.uri),
      });
      recordDebugImage(
        latestAssistant.id,
        'image',
        caps.modelId,
        result.cost,
        Date.now() - startedAt
      );
      await attachImage(latestAssistant.id, result.dataUri);
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'The scene wouldn’t paint. Try again.';
      showToast(message, 'error');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [apiKey, attachImage, db, isGeneratingImage, showToast, updateSettings]);

  const insertMarker = useCallback((marker: string) => {
    setInput((current) => {
      const selection = selectionRef.current;

      if (!selection) {
        return current + marker;
      }

      const next =
        current.slice(0, selection.start) + marker + current.slice(selection.end);

      selectionRef.current = {
        start: selection.start + marker.length,
        end: selection.start + marker.length,
      };

      return next;
    });

    inputRef.current?.focus();
  }, []);

  const retry = useCallback(async () => {
    const action = lastActionRef.current;

    if (action) {
      await sendTurn(action);
      return;
    }

    await regenerate();
  }, [regenerate, sendTurn]);

  const openImage = useCallback(
    (uri: string) => {
      resetImageZoom();
      setSelectedImage(uri);
    },
    [resetImageZoom]
  );

  if (!db) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={styles.loadingState}>
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.loadingText}>Loading your story…</Text>
        </SafeAreaView>
      </View>
    );
  }

  const openTimeSheet = (id: string, seconds: number) => {
    setCustomAmount('');
    setCustomUnit(seconds >= 86400 ? 'd' : seconds >= 3600 ? 'h' : 'min');
    setTimeTarget({ id, seconds });
  };

  const applyTime = (seconds: number) => {
    const target = timeTarget;
    setTimeTarget(null);

    if (target && Math.round(seconds) !== target.seconds) {
      void correctTurnTime(target.id, seconds);
    }
  };

  const customSeconds = (() => {
    const amount = Number.parseFloat(customAmount.replace(',', '.'));
    return Number.isFinite(amount) && amount >= 0 ? amount * UNIT_SECONDS[customUnit] : null;
  })();

  const storyStarted = messages.length > 0;
  const state = db.state;
  const lastAssistantId = [...messages].reverse().find((m) => m.role === 'assistant')?.id;
  const night = ['night', 'evening'].includes(timeOfDayOf(state.inStoryDate));
  const canSend = Boolean(input.trim()) && !isNarrating;
  const location = localizePlaceNames(state.location);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.root}
    >
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Wordmark compact />
          <Pressable
            accessibilityLabel="Show your status"
            accessibilityRole="button"
            delayLongPress={700}
            onLongPress={() => router.push('/world-clock')}
            onPress={() => setStatusOpen(true)}
            style={({ pressed }) => [styles.statusButton, pressed && styles.pressed]}
          >
            <View style={styles.statusCopy}>
              <Text numberOfLines={1} style={styles.statusTime}>
                {formatClock(state.inStoryDate)} · {formatDayMonth(state.inStoryDate)}
              </Text>
              <Text numberOfLines={1} style={styles.statusPlace}>
                {location}
              </Text>
            </View>
            {night ? (
              <Moon color={colors.textMuted} size={18} strokeWidth={2} />
            ) : (
              <Sun color={colors.textMuted} size={18} strokeWidth={2} />
            )}
          </Pressable>
        </View>

        {worldEventNotice ? (
          <View style={styles.newsStrip}>
            <View style={styles.newsDot} />
            <Text numberOfLines={2} style={styles.newsText}>
              <Text style={styles.newsLead}>Word reaches you: </Text>
              {worldEventNotice}
            </Text>
            <Pressable
              accessibilityLabel="Dismiss news"
              accessibilityRole="button"
              hitSlop={6}
              onPress={dismissWorldEventNotice}
              style={({ pressed }) => [styles.newsClose, pressed && styles.pressed]}
            >
              <X color={colors.textDim} size={14} strokeWidth={2} />
            </Pressable>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <Text style={type.sectionLabel}>
            Chapter {state.chapter} · {state.scene}
          </Text>

          {!storyStarted ? (
            <View style={styles.seed}>
              <Text style={styles.seedTitle}>The rain hasn’t stopped.</Text>
              <Text style={type.prose}>
                Days ago Itachi told you he would kill the clan. You fought him, you lost, and he
                sent you here to wait. Now you crouch in the forest outside the Leaf, soaked to the
                bone, not knowing if he went through with it — or who is still alive. He promised you
                an answer. Every drop sounds like footsteps.
              </Text>
              <AppButton
                disabled={!apiKey}
                label="Wait for him"
                onPress={() => void submit('*You wait in the rain for Itachi.*')}
                style={styles.seedButton}
              />
            </View>
          ) : null}

          {messages.map((message) =>
            message.role === 'user' ? (
              <View key={message.id} style={styles.playerBlock}>
                <PlayerText text={message.content} />
              </View>
            ) : (
              <View key={message.id} style={styles.narration}>
                {paragraphsOf(message.content).map((paragraph, index) => (
                  <Text key={index} style={type.prose}>
                    {paragraph}
                  </Text>
                ))}
                {message.image ? <SceneImage onOpen={openImage} value={message.image} /> : null}
                {message.id === lastAssistantId && !isNarrating ? (
                  <View style={styles.inlineActions}>
                    {message.elapsedSeconds !== undefined ? (
                      <TimeChip
                        onPress={() => openTimeSheet(message.id, message.elapsedSeconds ?? 0)}
                        seconds={message.elapsedSeconds}
                      />
                    ) : null}
                    <InlineAction
                      busy={isGeneratingImage}
                      disabled={!apiKey}
                      icon={<ImageIcon color={colors.textMuted} size={15} strokeWidth={2} />}
                      label="Paint"
                      onPress={() => void generateSceneImage()}
                    />
                    <InlineAction
                      icon={<RotateCcw color={colors.textMuted} size={15} strokeWidth={2} />}
                      label="Retry"
                      onPress={() => void regenerate()}
                    />
                    <InlineAction
                      icon={<Undo2 color={colors.textMuted} size={15} strokeWidth={2} />}
                      label="Undo"
                      onPress={() => void undoLastTurn()}
                    />
                  </View>
                ) : message.elapsedSeconds !== undefined ? (
                  <View style={styles.inlineActions}>
                    <TimeChip
                      onPress={() => openTimeSheet(message.id, message.elapsedSeconds ?? 0)}
                      seconds={message.elapsedSeconds}
                    />
                  </View>
                ) : null}
              </View>
            )
          )}

          {isNarrating && pendingAction ? (
            <View style={styles.playerBlock}>
              <PlayerText text={pendingAction} />
            </View>
          ) : null}

          {isNarrating ? (
            <View style={styles.narration}>
              {liveParagraphs.map((paragraph, index) => (
                <Text key={index} style={type.prose}>
                  {paragraph}
                </Text>
              ))}
              {liveParagraphs.length === 0 ? (
                <View style={styles.typingRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={type.rowMeta}>The world is moving…</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {error ? (
            <ListCard>
              <ListRow
                body={error}
                leading={<CircleAlert color={colors.danger} size={18} strokeWidth={2} />}
                title="The story lost its thread"
                trailing={
                  <AppButton
                    compact
                    label="Retry"
                    onPress={() => void retry()}
                    variant="secondary"
                  />
                }
              />
            </ListCard>
          ) : null}

          {!apiKey ? (
            <ListCard>
              <ListRow
                body="Add your OpenRouter key in Settings to begin."
                leading={<Sparkles color={colors.accentText} size={18} strokeWidth={2} />}
                title="No narrator yet"
                trailing={
                  <AppButton
                    compact
                    label="Settings"
                    onPress={() => router.navigate('/(tabs)/settings')}
                    variant="secondary"
                  />
                }
              />
            </ListCard>
          ) : null}
        </ScrollView>

        <View style={styles.composerShell}>
          {isProcessing ? (
            <View style={styles.processingRow}>
              <ActivityIndicator color={colors.accent} size="small" />
              <Text style={type.rowMeta}>Memory updating…</Text>
            </View>
          ) : pendingMemoryCount > 0 ? (
            <View
              accessibilityLabel={`Memory pending: ${pendingMemoryCount} ${
                pendingMemoryCount === 1 ? 'step' : 'steps'
              } didn't finish. Your story is saved.`}
              style={styles.processingRow}
            >
              <CircleAlert color={colors.warning} size={14} strokeWidth={2.2} />
              <Text style={[type.rowMeta, styles.pendingLabel]}>
                Memory pending{pendingMemoryCount > 1 ? ` · ${pendingMemoryCount}` : ''}
              </Text>
              <Pressable
                accessibilityLabel="Retry memory update"
                accessibilityRole="button"
                disabled={isNarrating}
                hitSlop={8}
                onPress={() => void retryPendingMemory()}
                style={({ pressed }) => [
                  styles.pendingRetry,
                  pressed && styles.pressed,
                  isNarrating && styles.disabled,
                ]}
              >
                <RotateCcw color={colors.textMuted} size={12} strokeWidth={2.2} />
                <Text style={styles.inlineActionLabel}>Retry</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={styles.composer}>
            <Pressable
              accessibilityLabel="Insert speech marks"
              accessibilityRole="button"
              onPress={() => insertMarker('"')}
              style={({ pressed }) => [styles.markerButton, pressed && styles.pressed]}
            >
              <Text style={styles.markerLabel}>“</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Insert action marker"
              accessibilityRole="button"
              onPress={() => insertMarker('*')}
              style={({ pressed }) => [
                styles.markerButton,
                styles.markerTight,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.markerLabel}>*</Text>
            </Pressable>
            <TextInput
              accessibilityLabel="What do you do?"
              editable={!isNarrating}
              maxLength={1000}
              multiline
              numberOfLines={1}
              onChangeText={setInput}
              onSelectionChange={(event) => {
                selectionRef.current = {
                  start: event.nativeEvent.selection.start,
                  end: event.nativeEvent.selection.end,
                };
              }}
              placeholder="What do you do?"
              placeholderTextColor={colors.textDim}
              ref={inputRef}
              style={styles.composerInput}
              value={input}
            />
            <Pressable
              accessibilityLabel="Send"
              accessibilityRole="button"
              disabled={!canSend}
              onPress={() => void submit(input)}
              style={({ pressed }) => [
                styles.sendButton,
                !canSend && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              {isNarrating ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : (
                <ArrowUp color={colors.onAccent} size={19} strokeWidth={2.4} />
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>

      <Modal
        animationType="fade"
        onRequestClose={() => setStatusOpen(false)}
        transparent
        visible={statusOpen}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            accessibilityLabel="Close status"
            onPress={() => setStatusOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <SectionLabel first>Right now</SectionLabel>
            <ListCard>
              <ListRow
                meta={formatStoryDate(
                  state.inStoryDate,
                  state.player.birthday,
                  state.player.birthYear
                )}
                title={location}
              />
              <ListRow meta="Mood" title={state.mood} />
              {db && companionsOf(db).length > 0 ? (
                <ListRow
                  meta="Travelling with you"
                  title={companionsOf(db).map((entity) => entity.name).join(', ')}
                />
              ) : null}
              <ListRow meta={`Chapter ${state.chapter}`} title={state.scene} />
            </ListCard>
            <AppButton
              label="Close"
              onPress={() => setStatusOpen(false)}
              style={styles.sheetClose}
              variant="secondary"
            />
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setTimeTarget(null)}
        transparent
        visible={Boolean(timeTarget)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            accessibilityLabel="Close time"
            onPress={() => setTimeTarget(null)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <SectionLabel first>How long did this take?</SectionLabel>
            <Text style={type.rowBody}>
              {timeTarget ? `Now ${formatElapsed(timeTarget.seconds).slice(1)}. ` : ''}
              Your clock moves by the difference.
            </Text>
            <FilterPills
              onChange={(value) => {
                const preset = TIME_PRESETS.find((item) => item.value === value);
                if (preset) applyTime(preset.seconds);
              }}
              options={TIME_PRESETS}
              value={
                (TIME_PRESETS.find((item) => item.seconds === timeTarget?.seconds)?.value ??
                  '') as string
              }
            />
            <View style={styles.timeCustomRow}>
              <TextInput
                accessibilityLabel="Custom amount"
                inputMode="decimal"
                keyboardType="decimal-pad"
                onChangeText={setCustomAmount}
                onSubmitEditing={() => {
                  if (customSeconds !== null) applyTime(customSeconds);
                }}
                placeholder="Amount"
                placeholderTextColor={colors.textDim}
                style={styles.timeCustomInput}
                value={customAmount}
              />
              <FilterPills
                onChange={setCustomUnit}
                options={[
                  { value: 'min', label: 'min' },
                  { value: 'h', label: 'hours' },
                  { value: 'd', label: 'days' },
                ]}
                value={customUnit}
              />
            </View>
            <AppButton
              disabled={customSeconds === null}
              label="Set time"
              onPress={() => {
                if (customSeconds !== null) applyTime(customSeconds);
              }}
            />
            <AppButton
              label="Cancel"
              onPress={() => setTimeTarget(null)}
              variant="secondary"
            />
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => {
          resetImageZoom();
          setSelectedImage(null);
        }}
        transparent
        visible={Boolean(selectedImage)}
      >
        <View
          style={[
            styles.imageOverlay,
            { paddingBottom: Math.max(insets.bottom + 80, spacing.xxxl) },
          ]}
        >
          <Pressable
            accessibilityLabel="Close image"
            onPress={() => setSelectedImage(null)}
            style={StyleSheet.absoluteFill}
          />

          {selectedImage ? (
            <>
              <GestureDetector
                gesture={Gesture.Simultaneous(
                  imagePinchGesture,
                  imagePanGesture,
                  imageDoubleTapGesture
                )}
              >
                <Animated.Image
                  accessibilityLabel="Generated story scene"
                  resizeMode="contain"
                  source={{ uri: selectedImage }}
                  style={[styles.fullscreenImage, fullscreenImageStyle]}
                />
              </GestureDetector>

              <View
                style={[styles.imageActions, { bottom: Math.max(insets.bottom + 20, spacing.xl) }]}
              >
                <AppButton
                  compact
                  icon={<Download color={colors.onAccent} size={15} strokeWidth={2} />}
                  label="Download"
                  onPress={() => {
                    downloadImage(`kan-scene-${Date.now()}.jpg`, selectedImage);
                    resetImageZoom();
                  }}
                  style={styles.imageActionButton}
                />
                <AppButton
                  compact
                  icon={<X color={colors.text} size={15} strokeWidth={2} />}
                  label="Close"
                  onPress={() => {
                    resetImageZoom();
                    setSelectedImage(null);
                  }}
                  style={styles.imageActionButton}
                  variant="secondary"
                />
              </View>
            </>
          ) : null}
        </View>
      </Modal>
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    ...type.rowMeta,
  },
  pressed: {
    opacity: 0.65,
  },
  disabled: {
    opacity: 0.35,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingLeft: spacing.xl,
    paddingRight: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  statusButton: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingLeft: spacing.md,
  },
  statusCopy: {
    flexShrink: 1,
    alignItems: 'flex-end',
    gap: 1,
  },
  statusTime: {
    fontFamily: fonts.bold,
    fontSize: 13,
    lineHeight: 18,
    color: colors.text,
  },
  statusPlace: {
    fontFamily: fonts.medium,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  newsStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  newsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accentText,
  },
  newsText: {
    ...type.rowBody,
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  newsLead: {
    color: colors.text,
    fontFamily: fonts.semibold,
  },
  newsClose: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: 22,
  },
  seed: {
    gap: 14,
  },
  seedTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.6,
    color: colors.text,
  },
  seedButton: {
    alignSelf: 'flex-start',
    minWidth: 190,
  },
  narration: {
    gap: 14,
  },
  playerBlock: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  playerText: {
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 23,
    color: colors.text,
  },
  playerAction: {
    fontStyle: 'italic',
    color: '#C8C8C8',
  },
  sceneImageWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sceneImage: {
    width: '100%',
    height: '100%',
  },
  inlineActions: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: -10,
    marginTop: -6,
  },
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  timeChipLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textDim,
    fontVariant: ['tabular-nums'],
  },
  timeCustomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  timeCustomInput: {
    width: 96,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
  },
  inlineActionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textMuted,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  composerShell: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: 6,
  },
  processingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
  },
  pendingLabel: {
    flex: 1,
  },
  pendingRetry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    padding: 4,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  markerButton: {
    width: 40,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerTight: {
    marginLeft: -6,
  },
  markerLabel: {
    fontFamily: fonts.bold,
    fontSize: 22,
    lineHeight: 26,
    marginTop: 6,
    color: colors.textMuted,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingTop: 11,
    paddingBottom: 11,
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
    backgroundColor: '#3A1013',
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.overlay,
  },
  sheet: {
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    borderTopWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  sheetClose: {
    marginTop: spacing.sm,
  },
  imageOverlay: {
    flex: 1,
    padding: spacing.xl,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
  },
  fullscreenImage: {
    flex: 1,
    width: '100%',
  },
  imageActions: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  imageActionButton: {
    flex: 1,
  },
});
