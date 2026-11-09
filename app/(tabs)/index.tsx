import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
  Clock3,
  RotateCcw,
  Sparkles,
  Wand2,
  Undo2,
  X,
} from 'lucide-react-native';

import { AppButton } from '@/components/AppButton';
import { addExplicitRef } from '@/lib/rpg/explicitImages';
import { storeImage } from '@/lib/rpg/imageStore';
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
import { streamingPreview, stripNarrationJson } from '@/lib/rpg/prompt';
import { useGame } from '@/lib/rpg/game';
import { companionsOf } from '@/lib/rpg/companions';
import { useToast } from '@/components/Toast';
import { downloadImage } from '@/lib/rpg/file';
import { ensureImageCaps } from '@/lib/rpg/imageCaps';
import { useStoredImage } from '@/lib/rpg/imageStore';
import { SHOT_CHIPS, type ShotChip } from '@/lib/rpg/imageDirection';
import { paintScene, retouchSceneImage, sexualMoment, type PaintedTake } from '@/lib/rpg/paintScene';
import { currentWeather, weatherPhrase } from '@/lib/rpg/weather';
import { WeatherIcon } from '@/components/WeatherIcon';
import { resolveTurnMode, sceneOptionInput } from '@/lib/rpg/sceneMode';
import { sexStrip } from '@/lib/rpg/sexMode';
import { setupDone } from '@/lib/setup';
import type { SceneModeName, SteerChip } from '@/lib/rpg/types';
import { displayName } from '@/lib/rpg/names';
import { playerAge } from '@/lib/rpg/player';
import { APP_NAME } from '@/lib/brand';

type StoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  image: string | null;
  elapsedSeconds?: number;
  sceneOptions?: string[];
  heldBack?: 'refused' | 'faded';
};

const STEER_CHIPS: { value: SteerChip; label: string; intimateOnly: boolean }[] = [
  { value: 'slower', label: 'Slower', intimateOnly: true },
  { value: 'more', label: 'More', intimateOnly: true },
  { value: 'skip-ahead', label: 'Skip ahead', intimateOnly: false },
  { value: 'fade-to-black', label: 'Fade to black', intimateOnly: true },
];

const MODE_LABEL: Record<SceneModeName, string> = {
  normal: 'Narration',
  conversation: 'Conversation',
  intimate: 'Sex',
};

const MODE_CHOICES: { value: SceneModeName | null; title: string; body: string }[] = [
  { value: null, title: 'Automatic', body: 'Talk turns into a conversation, and sex into sex mode, on their own.' },
  { value: 'conversation', title: 'Conversation', body: 'Mostly speech, even while you walk or drive.' },
  { value: 'intimate', title: 'Sex mode', body: 'Short, explicit turns with four next moves, with whoever here is an adult.' },
  { value: 'normal', title: 'Normal narration', body: 'Full prose; ends a sex scene or a conversation now.' },
];

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

/** A narration paragraph: *action lines* and thoughts in italics. */
function NarrationParagraph({ text }: { text: string }) {
  const parts = text.split(/(\*[^*\n]+\*)/g).filter(Boolean);
  const prose = type.prose;

  if (parts.length === 1) {
    return <Text style={prose}>{text}</Text>;
  }

  return (
    <Text style={prose}>
      {parts.map((part, index) =>
        part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
          <Text key={index} style={styles.narrationAction}>
            {part.slice(1, -1)}
          </Text>
        ) : (
          <Text key={index}>{part}</Text>
        )
      )}
    </Text>
  );
}

/** Renders the player's turn with *actions* in italics and everything else plain. */
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

/** The newest scene images load straight away; older ones wait for a tap. */
const EAGER_SCENE_IMAGES = 3;

function SceneImage({ value, onOpen, eager }: { value: string; onOpen: (uri: string) => void; eager: boolean }) {
  const [wanted, setWanted] = useState(eager);
  const uri = useStoredImage(wanted || eager ? value : null);

  if (!wanted && !eager) {
    return (
      <Pressable
        accessibilityLabel="Show scene image"
        accessibilityRole="button"
        onPress={() => setWanted(true)}
        style={styles.sceneImageWrap}
      >
        <Text style={type.rowBody}>Show image</Text>
      </Pressable>
    );
  }

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
  onLongPress,
  disabled,
  busy,
  glow,
  accessibilityHint,
}: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** A key moment: the action invites you. */
  glow?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      delayLongPress={450}
      disabled={disabled || busy}
      onLongPress={onLongPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.inlineAction,
        glow && styles.inlineActionGlow,
        pressed && styles.pressed,
        (disabled || busy) && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator color={colors.textMuted} size="small" /> : icon}
      <Text style={[styles.inlineActionLabel, glow && styles.inlineActionGlowLabel]}>{busy ? 'Painting…' : label}</Text>
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
    sendTurn,
    regenerate,
    undoLastTurn,
    attachImage,
    correctTurnTime,
    updateSettings,
    setSceneMode,
    changeSave,
    loading,
  } = useGame();
  const { showToast } = useToast();

  // First launch: no OpenRouter key and the setup never finished.
  useEffect(() => {
    if (loading || apiKey) return;
    void setupDone().then((done) => {
      if (!done) router.push('/setup');
    });
  }, [apiKey, loading, router]);

  const [input, setInput] = useState('');
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [viewer, setViewer] = useState<{ uri: string; logId?: string } | null>(null);
  const selectedImage = viewer?.uri ?? null;
  /** The shot menu (long-press Paint): a forced shot and how many takes. */
  const [shotMenuOpen, setShotMenuOpen] = useState(false);
  const [shotChip, setShotChip] = useState<ShotChip>('auto');
  /** Two takes waiting for you to keep one. */
  const [pendingTakes, setPendingTakes] = useState<{ turnId: string; takes: PaintedTake[] } | null>(null);
  /** The retouch field in the viewer, and an edited version waiting to be kept. */
  const [retouchText, setRetouchText] = useState<string | null>(null);
  const [retouchDraft, setRetouchDraft] = useState<PaintedTake | null>(null);
  const [isRetouching, setIsRetouching] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [timeTarget, setTimeTarget] = useState<{ id: string; seconds: number } | null>(null);
  const [customAmount, setCustomAmount] = useState('');
  const [customUnit, setCustomUnit] = useState<TimeUnit>('min');
  const [modeOpen, setModeOpen] = useState(false);
  const imageScale = useSharedValue(1);
  const imageTranslateX = useSharedValue(0);
  const imageTranslateY = useSharedValue(0);
  const gestureStartScale = useSharedValue(1);
  const gestureStartTranslateX = useSharedValue(0);
  const gestureStartTranslateY = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const [steer, setSteer] = useState<SteerChip | null>(null);
  const [oocNote, setOocNote] = useState('');
  const [oocOpen, setOocOpen] = useState(false);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const lastActionRef = useRef('');

  const messages = useMemo<StoryMessage[]>(() => {
    if (!db) {
      return [];
    }

    const story = db.rawLog.filter((message) => message.kind === 'story');

    return story.map((message) => {
      return {
        id: message.id,
        role: message.role === 'user' ? 'user' : 'assistant',
        content:
          message.role === 'assistant'
            ? stripNarrationJson(message.content)
            : message.content,
        image: message.image ?? null,
        elapsedSeconds: message.role === 'assistant' ? message.elapsedSeconds : undefined,
        sceneOptions: message.role === 'assistant' ? message.sceneOptions : undefined,
        heldBack: message.role === 'assistant' ? message.heldBack : undefined,
      };
    });
  }, [db]);

  // The mode the next turn will be narrated in, read live from what you type.
  const turnMode = useMemo(() => (db ? resolveTurnMode(db, input) : null), [db, input]);

  const eagerImages = useMemo(
    () => new Set(messages.filter((message) => message.image).slice(-EAGER_SCENE_IMAGES).map((message) => message.id)),
    [messages]
  );

  const liveParagraphs = useMemo(
    () => (isNarrating ? paragraphsOf(streamingPreview(streamingText)) : []),
    [isNarrating, streamingText]
  );

  // The story only scrolls itself at two moments: when a save is opened (jump
  // to the latest turn) and when you send an action (show it and where the
  // reply will start). While the narrator streams, the screen stays wherever
  // you put it, so you can scroll up and down freely.
  const slotId = db?.meta.slotId ?? null;
  const scrolledSlotRef = useRef<string | null>(null);

  useEffect(() => {
    if (!slotId || messages.length === 0 || scrolledSlotRef.current === slotId) {
      return;
    }

    scrolledSlotRef.current = slotId;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: false });
    });
  }, [slotId, messages.length]);

  useEffect(() => {
    if (!isNarrating) {
      return;
    }

    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [isNarrating]);

  const submit = useCallback(
    async (value: string) => {
      const action = value.trim();

      if (!action || isNarrating) {
        return;
      }

      lastActionRef.current = action;
      setInput('');
      selectionRef.current = null;
      // The steer chip and the OOC note count for this one turn.
      const extras = { ...(steer ? { steer } : {}), ...(oocNote.trim() ? { oocNote: oocNote.trim() } : {}) };
      setSteer(null);
      setOocNote('');
      setOocOpen(false);

      await sendTurn(action, Object.keys(extras).length > 0 ? extras : undefined);
    },
    [isNarrating, sendTurn, steer, oocNote]
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

  const generateSceneImage = useCallback(
    async (chip: ShotChip = 'auto', twoTakes = Boolean(db?.settings.imageTwoTakes)) => {
      if (!db || isGeneratingImage || !apiKey) {
        return;
      }

      setIsGeneratingImage(true);

      try {
        const caps = await ensureImageCaps(db, updateSettings);
        const result = await paintScene({
          apiKey,
          db,
          caps,
          chip,
          takes: twoTakes ? 2 : 1,
          onWarning: (message) => showToast(message, 'error'),
          updateSettings,
        });

        // Reference sheets painted for an explicit picture are kept for the next ones.
        for (const sheet of result.refSheets) {
          const stored = await storeImage(sheet.image);
          await changeSave((latest) => addExplicitRef(latest, sheet.entityId, stored));
        }

        if (result.takes.length > 1) {
          setPendingTakes(result);
          return;
        }

        const take = result.takes[0];
        await attachImage(result.turnId, take.dataUri, take.meta);

        if (take.meta.mightBeOff) {
          showToast('This one might be off: who does what may be swapped. Retouch or paint again.', 'error');
        }
      } catch (caught) {
        const message =
          caught instanceof Error ? caught.message : 'The scene wouldn’t paint. Try again.';
        showToast(message, 'error');
      } finally {
        setIsGeneratingImage(false);
      }
    },
    [apiKey, attachImage, changeSave, db, isGeneratingImage, showToast, updateSettings]
  );

  const keepTake = useCallback(
    async (take: PaintedTake) => {
      const pending = pendingTakes;
      setPendingTakes(null);

      if (pending) {
        await attachImage(pending.turnId, take.dataUri, take.meta);
      }
    },
    [attachImage, pendingTakes]
  );

  const retouch = useCallback(async () => {
    const tweak = retouchText?.trim();

    if (!db || !apiKey || !viewer?.logId || !tweak || isRetouching) {
      return;
    }

    setIsRetouching(true);

    try {
      const caps = await ensureImageCaps(db, updateSettings);
      const draft = await retouchSceneImage({
        apiKey,
        db,
        caps,
        logId: viewer.logId,
        image: viewer.uri,
        tweak,
      });
      setRetouchDraft(draft);
      setRetouchText(null);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The retouch didn’t work. Try again.', 'error');
    } finally {
      setIsRetouching(false);
    }
  }, [apiKey, db, isRetouching, retouchText, showToast, updateSettings, viewer]);

  const keepRetouch = useCallback(async () => {
    const draft = retouchDraft;
    const logId = viewer?.logId;

    if (!draft || !logId) {
      return;
    }

    setRetouchDraft(null);
    setViewer({ uri: draft.dataUri, logId });
    await attachImage(logId, draft.dataUri, draft.meta);
  }, [attachImage, retouchDraft, viewer]);

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
    (uri: string, logId?: string) => {
      resetImageZoom();
      setRetouchText(null);
      setRetouchDraft(null);
      setViewer({ uri, logId });
    },
    [resetImageZoom]
  );

  const closeViewer = useCallback(() => {
    resetImageZoom();
    setRetouchText(null);
    setRetouchDraft(null);
    setViewer(null);
  }, [resetImageZoom]);

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
  const weather = currentWeather(db);
  const canSend = Boolean(input.trim()) && !isNarrating;
  const override = state.sceneMode?.override ?? null;
  const shownMode: SceneModeName = turnMode?.mode ?? 'normal';
  const latestSceneOptions = !isNarrating ? messages.find((message) => message.id === lastAssistantId)?.sceneOptions ?? [] : [];
  const modeHint =
    shownMode === 'normal' && turnMode?.lean && !override
      ? 'Talk is building'
      : turnMode?.with.length && shownMode !== 'normal'
        ? turnMode.with.slice(0, 2).join(', ')
        : null;
  const location = state.location;
  const strip = shownMode === 'intimate' && !isNarrating ? sexStrip(db) : null;

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
            <WeatherIcon color={colors.textMuted} condition={weather.condition} night={night} />
          </Pressable>
        </View>


        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <Text style={type.sectionLabel}>
            Chapter {db.state.chapter} · {db.state.scene}
          </Text>

          {!storyStarted && !db.state.player.name.trim() ? (
            <View style={styles.seed}>
              <Text style={styles.seedTitle}>No story yet</Text>
              <Text style={type.prose}>Make your world, who you are and where it starts.</Text>
              <AppButton label="Create your own story" onPress={() => router.push('/new-story')} style={styles.seedButton} />
            </View>
          ) : !storyStarted ? (
            <View style={styles.seed}>
              <Text style={styles.seedTitle}>{db.state.location}</Text>
              <Text style={type.prose}>
                {db.events.find((event) => event.tags.includes('opening'))?.summary ?? db.state.worldDescription}
              </Text>
              <AppButton
                disabled={!apiKey}
                label="Begin"
                onPress={() => void submit('*You take in where you are.*')}
                style={styles.seedButton}
              />
              <AppButton
                label="Create your own story"
                onPress={() => router.push('/new-story')}
                style={styles.seedButton}
                variant="secondary"
              />
            </View>
          ) : null}

          {messages.map((message) => (
            <Fragment key={message.id}>
            {message.role === 'user' ? (
              <View style={styles.playerBlock}>
                <PlayerText text={message.content} />
              </View>
            ) : (
              <View style={styles.narration}>
                {paragraphsOf(message.content).map((paragraph, index) => (
                  <NarrationParagraph key={index} text={paragraph} />
                ))}
                {message.image ? (
                  <SceneImage
                    eager={eagerImages.has(message.id)}
                    onOpen={(uri) => openImage(uri, message.id)}
                    value={message.image}
                  />
                ) : null}
                {message.id === lastAssistantId && !isNarrating && message.heldBack ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.navigate('/(tabs)/settings')}
                    style={({ pressed }) => [styles.heldBack, pressed && styles.pressed]}
                  >
                    <Text style={styles.heldBackText}>
                      {message.heldBack === 'refused'
                        ? 'The narrator model refused this scene. Some models won’t write sex scenes: try Retry, or switch the Story model to a recommended one in Settings → Models.'
                        : 'The narrator faded out on its own. If you wanted the scene, try Retry, or switch the Story model to a recommended one in Settings → Models.'}
                    </Text>
                  </Pressable>
                ) : null}
                {message.id === lastAssistantId && !isNarrating ? (
                  <View style={styles.inlineActions}>
                    {message.elapsedSeconds !== undefined ? (
                      <TimeChip
                        onPress={() => openTimeSheet(message.id, message.elapsedSeconds ?? 0)}
                        seconds={message.elapsedSeconds}
                      />
                    ) : null}
                    <InlineAction
                      accessibilityHint="Long-press to pick the shot"
                      busy={isGeneratingImage}
                      disabled={!apiKey}
                      icon={<ImageIcon color={colors.textMuted} size={15} strokeWidth={2} />}
                      label="Picture"
                      onLongPress={() => setShotMenuOpen(true)}
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
            )}
            </Fragment>
          ))}

          {isNarrating && pendingAction ? (
            <View style={styles.playerBlock}>
              <PlayerText text={pendingAction} />
            </View>
          ) : null}

          {isNarrating ? (
            <View style={styles.narration}>
              {liveParagraphs.map((paragraph, index) => (
                <NarrationParagraph key={index} text={paragraph} />
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
          {strip ? (
            <View accessibilityLabel="Scene" style={styles.sexStrip}>
              <Text numberOfLines={1} style={styles.sexStripPlace}>
                {strip.location}
              </Text>
              {strip.people.map((person) => (
                <Text key={person.name} numberOfLines={1} style={styles.sexStripLine}>
                  <Text style={styles.sexStripName}>{person.name}</Text>
                  {[person.position, person.wearing].filter(Boolean).length > 0
                    ? ` · ${[person.position, person.wearing].filter(Boolean).join(' · ')}`
                    : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {latestSceneOptions.length > 0 ? (
            <ScrollView
              contentContainerStyle={styles.sceneOptions}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
            >
              {latestSceneOptions.map((option) => (
                <Pressable
                  accessibilityLabel={`Option: ${option}`}
                  accessibilityRole="button"
                  disabled={isNarrating}
                  key={option}
                  onPress={() => void submit(sceneOptionInput(option))}
                  style={({ pressed }) => [styles.sceneOption, pressed && styles.pressed]}
                >
                  <Text numberOfLines={2} style={styles.sceneOptionLabel}>
                    {option}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {storyStarted ? (
            <View style={styles.modeRow}>
              <Pressable
                accessibilityLabel={`Scene mode: ${MODE_LABEL[shownMode]}${override ? ', set by you' : ', automatic'}. Change it`}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => setModeOpen(true)}
                style={({ pressed }) => [
                  styles.modeChip,
                  shownMode === 'conversation' && styles.modeChipTalk,
                  shownMode === 'intimate' && styles.modeChipIntimate,
                  pressed && styles.pressed,
                ]}
              >
                {shownMode !== 'normal' ? (
                  <View style={[styles.modeDot, shownMode === 'intimate' && styles.modeDotIntimate]} />
                ) : null}
                <Text
                  style={[
                    styles.modeChipLabel,
                    shownMode !== 'normal' && styles.modeChipLabelOn,
                  ]}
                >
                  {MODE_LABEL[shownMode]}
                  {override ? ' · set by you' : ''}
                </Text>
              </Pressable>
              {modeHint ? (
                <Text numberOfLines={1} style={styles.modeHint}>
                  {modeHint}
                </Text>
              ) : null}
            </View>
          ) : null}
          {storyStarted ? (
            <ScrollView
              contentContainerStyle={styles.steerRow}
              horizontal
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={false}
            >
              {STEER_CHIPS.filter((chip) => !chip.intimateOnly || shownMode === 'intimate').map((chip) => {
                const on = steer === chip.value;
                return (
                  <Pressable
                    accessibilityLabel={`Steer: ${chip.label}${on ? ', on for your next turn' : ''}`}
                    accessibilityRole="button"
                    key={chip.value}
                    onPress={() => setSteer(on ? null : chip.value)}
                    style={({ pressed }) => [styles.steerChip, on && styles.steerChipOn, pressed && styles.pressed]}
                  >
                    <Text style={[styles.steerLabel, on && styles.steerLabelOn]}>{chip.label}</Text>
                  </Pressable>
                );
              })}
              <Pressable
                accessibilityLabel="Out-of-character note to the narrator"
                accessibilityRole="button"
                onPress={() => setOocOpen((open) => !open)}
                style={({ pressed }) => [styles.steerChip, (oocOpen || oocNote.trim()) && styles.steerChipOn, pressed && styles.pressed]}
              >
                <Text style={[styles.steerLabel, (oocOpen || oocNote.trim()) && styles.steerLabelOn]}>OOC note</Text>
              </Pressable>
            </ScrollView>
          ) : null}
          {oocOpen ? (
            <TextInput
              accessibilityLabel="Out-of-character note"
              maxLength={400}
              onChangeText={setOocNote}
              placeholder="A note to the narrator for your next turn only (never in the story)"
              placeholderTextColor={colors.textDim}
              style={styles.oocInput}
              value={oocNote}
            />
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
        onRequestClose={() => setModeOpen(false)}
        transparent
        visible={modeOpen}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            accessibilityLabel="Close scene mode"
            onPress={() => setModeOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <SectionLabel first>How scenes play</SectionLabel>
            <ListCard>
              {MODE_CHOICES.map((choice) => {
                const selected = (override ?? null) === choice.value;

                return (
                  <ListRow
                    body={choice.body}
                    key={choice.title}
                    onPress={() => {
                      setModeOpen(false);
                      void setSceneMode(choice.value);
                    }}
                    title={choice.title}
                    trailing={
                      selected ? <View style={[styles.modeDot, styles.modeDotSelected]} /> : undefined
                    }
                  />
                );
              })}
            </ListCard>
            <AppButton
              label="Close"
              onPress={() => setModeOpen(false)}
              style={styles.sheetClose}
              variant="secondary"
            />
          </View>
        </View>
      </Modal>

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
                meta={formatStoryDate(state.inStoryDate, playerAge(db))}
                title={location}
              />
              <ListRow meta="Mood" title={state.mood} />
              {db ? (
                <ListRow
                  meta={`Weather · ${weather.seasonLabel}`}
                  title={capitalize(weatherPhrase(weather))}
                />
              ) : null}
              {db && companionsOf(db).length > 0 ? (
                <ListRow
                  meta="With you"
                  title={companionsOf(db).map((entity) => displayName(db, entity)).join(', ')}
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
        onRequestClose={closeViewer}
        transparent
        visible={Boolean(selectedImage)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.imageOverlay,
            { paddingBottom: Math.max(insets.bottom + (retouchText !== null || retouchDraft ? 150 : 80), spacing.xxxl) },
          ]}
        >
          <Pressable
            accessibilityLabel="Close image"
            onPress={closeViewer}
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
                  accessibilityLabel={retouchDraft ? 'Retouched scene, not kept yet' : 'Generated story scene'}
                  resizeMode="contain"
                  source={{ uri: retouchDraft?.dataUri ?? selectedImage }}
                  style={[styles.fullscreenImage, fullscreenImageStyle]}
                />
              </GestureDetector>

              <View
                style={[styles.imageActionsColumn, { bottom: Math.max(insets.bottom + 20, spacing.xl) }]}
              >
                {retouchDraft ? (
                  <>
                    <Text style={styles.retouchNote}>Retouched: “{retouchDraft.meta.tweak}”. Keep it?</Text>
                    <View style={styles.imageActionsRow}>
                      <AppButton
                        compact
                        label="Keep"
                        onPress={() => void keepRetouch()}
                        style={styles.imageActionButton}
                      />
                      <AppButton
                        compact
                        label="Discard"
                        onPress={() => setRetouchDraft(null)}
                        style={styles.imageActionButton}
                        variant="secondary"
                      />
                    </View>
                  </>
                ) : retouchText !== null ? (
                  <>
                    <TextInput
                      accessibilityLabel="What to change"
                      autoFocus
                      editable={!isRetouching}
                      onChangeText={setRetouchText}
                      onSubmitEditing={() => void retouch()}
                      placeholder="Make him angrier, more fire, night not day…"
                      placeholderTextColor={colors.textDim}
                      returnKeyType="send"
                      style={styles.retouchInput}
                      value={retouchText}
                    />
                    <View style={styles.imageActionsRow}>
                      <AppButton
                        compact
                        disabled={!retouchText.trim() || isRetouching}
                        icon={isRetouching ? <ActivityIndicator color={colors.onAccent} size="small" /> : undefined}
                        label={isRetouching ? 'Retouching…' : 'Retouch'}
                        onPress={() => void retouch()}
                        style={styles.imageActionButton}
                      />
                      <AppButton
                        compact
                        disabled={isRetouching}
                        label="Cancel"
                        onPress={() => setRetouchText(null)}
                        style={styles.imageActionButton}
                        variant="secondary"
                      />
                    </View>
                  </>
                ) : (
                  <View style={styles.imageActionsRow}>
                    <AppButton
                      compact
                      icon={<Download color={colors.onAccent} size={15} strokeWidth={2} />}
                      label="Download"
                      onPress={() => {
                        downloadImage(`${APP_NAME}-scene-${Date.now()}.jpg`, selectedImage);
                        resetImageZoom();
                      }}
                      style={styles.imageActionButton}
                    />
                    {viewer?.logId && apiKey ? (
                      <AppButton
                        compact
                        icon={<Wand2 color={colors.text} size={15} strokeWidth={2} />}
                        label="Retouch"
                        onPress={() => {
                          resetImageZoom();
                          setRetouchText('');
                        }}
                        style={styles.imageActionButton}
                        variant="secondary"
                      />
                    ) : null}
                    <AppButton
                      compact
                      icon={<X color={colors.text} size={15} strokeWidth={2} />}
                      label="Close"
                      onPress={closeViewer}
                      style={styles.imageActionButton}
                      variant="secondary"
                    />
                  </View>
                )}
              </View>
            </>
          ) : null}
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setShotMenuOpen(false)}
        transparent
        visible={shotMenuOpen}
      >
        <View style={styles.sheetOverlay}>
          <Pressable
            accessibilityLabel="Close shot menu"
            onPress={() => setShotMenuOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <SectionLabel first>Paint this moment</SectionLabel>
            <FilterPills
              onChange={setShotChip}
              options={SHOT_CHIPS.filter((chip) => !chip.intimate || sexualMoment(db)).map((chip) => ({ value: chip.value, label: chip.label }))}
              value={shotChip}
            />
            <Text style={type.rowBody}>{SHOT_CHIPS.find((chip) => chip.value === shotChip)?.hint}</Text>
            <ListRow
              accessibilityLabel="Two takes"
              accessibilityRole="switch"
              accessibilityState={{ checked: Boolean(db.settings.imageTwoTakes) }}
              meta="Paint two and keep the better one. Costs double."
              onPress={() => void updateSettings({ imageTwoTakes: !db.settings.imageTwoTakes })}
              title="Two takes"
              trailing={
                <Switch
                  onValueChange={(value) => void updateSettings({ imageTwoTakes: value })}
                  thumbColor={colors.text}
                  trackColor={{ false: colors.surfaceSoft, true: colors.accent }}
                  value={Boolean(db.settings.imageTwoTakes)}
                  {...(Platform.OS === 'web' ? { activeThumbColor: colors.text } : {})}
                />
              }
            />
            <AppButton
              disabled={!apiKey || isGeneratingImage}
              icon={<Sparkles color={colors.onAccent} size={15} strokeWidth={2} />}
              label="Paint"
              onPress={() => {
                setShotMenuOpen(false);
                void generateSceneImage(shotChip);
              }}
            />
            <AppButton label="Cancel" onPress={() => setShotMenuOpen(false)} variant="secondary" />
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        onRequestClose={() => setPendingTakes(null)}
        transparent
        visible={Boolean(pendingTakes)}
      >
        <View style={[styles.imageOverlay, styles.takesOverlay]}>
          <SectionLabel first>Two takes · tap the one to keep</SectionLabel>
          <ScrollView contentContainerStyle={styles.takesList}>
            {pendingTakes?.takes.map((take, index) => (
              <Pressable
                accessibilityLabel={`Keep take ${index + 1}${take.meta.mightBeOff ? ', might be off' : ''}`}
                accessibilityRole="button"
                key={index}
                onPress={() => void keepTake(take)}
                style={({ pressed }) => [styles.takeCard, pressed && styles.pressed]}
              >
                <Image resizeMode="cover" source={{ uri: take.dataUri }} style={styles.takeImage} />
                <Text style={type.rowMeta}>
                  Take {index + 1}
                  {take.meta.mightBeOff ? ' · might be off' : ''}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <AppButton label="Keep neither" onPress={() => setPendingTakes(null)} variant="secondary" />
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
  narrationAction: {
    fontStyle: 'italic',
    color: colors.textMuted,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeChipTalk: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  modeChipIntimate: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  modeChipLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    color: colors.textDim,
  },
  modeChipLabelOn: {
    color: colors.text,
  },
  modeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },
  modeDotIntimate: {
    backgroundColor: colors.accentBright,
  },
  modeDotSelected: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  modeHint: {
    ...type.rowMeta,
    flexShrink: 1,
  },
  heldBack: {
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  heldBackText: {
    ...type.rowMeta,
    color: colors.warning,
  },
  sexStrip: {
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  sexStripPlace: {
    ...type.rowMeta,
  },
  sexStripLine: {
    fontFamily: fonts.regular,
    fontSize: 12,
    color: colors.textDim,
  },
  sexStripName: {
    fontFamily: fonts.semibold,
    color: colors.text,
  },
  sceneOptions: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  sceneOption: {
    maxWidth: 220,
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  sceneOptionLabel: {
    fontFamily: fonts.semibold,
    fontSize: 13,
    lineHeight: 17,
    color: colors.text,
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
  steerRow: {
    gap: 6,
    paddingHorizontal: spacing.xs,
  },
  steerChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  steerChipOn: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  steerLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.textMuted,
  },
  steerLabelOn: {
    color: colors.accentText,
  },
  oocInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
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
  imageActionsColumn: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    gap: spacing.sm,
  },
  imageActionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  retouchInput: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
  },
  retouchNote: {
    ...type.rowBody,
    color: colors.text,
    textAlign: 'center',
  },
  takesOverlay: {
    gap: spacing.md,
    paddingTop: spacing.xxxl,
  },
  takesList: {
    gap: spacing.lg,
  },
  takeCard: {
    gap: spacing.xs,
  },
  takeImage: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
  inlineActionGlow: {
    borderWidth: 1,
    borderRadius: radius.lg,
    borderColor: colors.accent,
    shadowColor: colors.accent,
    shadowOpacity: 0.6,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  inlineActionGlowLabel: {
    color: colors.text,
  },
  imageActionButton: {
    flex: 1,
  },
});

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
