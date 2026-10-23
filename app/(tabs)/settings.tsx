import * as WebBrowser from 'expo-web-browser';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Info,
  KeyRound,
  Lock,
  RotateCcw,
  Sparkles,
  Trash2,
  WandSparkles,
} from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/AppBackground';
import { AppButton } from '@/components/AppButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ModelPickerModal } from '@/components/ModelPickerModal';
import { SectionHeader } from '@/components/SectionHeader';
import { SegmentedControl } from '@/components/SegmentedControl';
import { SurfaceCard } from '@/components/SurfaceCard';
import { useToast } from '@/components/Toast';
import { Wordmark } from '@/components/Wordmark';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { testOpenRouterKey } from '@/lib/openrouter';
import {
  useSettings,
  type ImageFrequency,
  type ImageStyle,
  type NarrationStyle,
} from '@/lib/settings';

type Feedback = {
  tone: 'success' | 'error';
  message: string;
};

const narrationOptions: { value: NarrationStyle; label: string }[] = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'literary', label: 'Literary' },
];

const narrationCopy: Record<
  NarrationStyle,
  { description: string; preview: string }
> = {
  cinematic: {
    description: 'Wide shots, weather and tension. Built for atmosphere.',
    preview: 'Rain needled the gate. Kan stepped through it without slowing.',
  },
  balanced: {
    description: 'Clear action with room for mood and dialogue.',
    preview: 'Rain tapped the gate. Kan stepped through and let the silence settle.',
  },
  literary: {
    description: 'Interior, sensory prose. A slower, closer telling.',
    preview:
      'The rain remembered every roof it touched. Kan remembered none of them.',
  },
};

const imageFrequencyOptions: { value: Exclude<ImageFrequency, 'off'>; label: string }[] = [
  { value: 'choice', label: 'Every choice' },
  { value: 'action', label: 'Every action' },
];

const imageStyleOptions: { value: ImageStyle; label: string }[] = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'ink', label: 'Ink' },
  { value: 'painterly', label: 'Painterly' },
];

export default function SettingsScreen() {
  const {
    apiKey,
    hydrated,
    resetSettings,
    saveApiKey,
    settings,
    updateSettings,
  } = useSettings();
  const { showToast } = useToast();
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [resetVisible, setResetVisible] = useState(false);
  const [resetting, setResetting] = useState(false);
  const lastImageFrequency = useRef<Exclude<ImageFrequency, 'off'>>('choice');

  useEffect(() => {
    if (hydrated) {
      setKeyDraft(apiKey);
    }
  }, [apiKey, hydrated]);

  const handleSaveKey = async () => {
    setKeyError(null);
    setFeedback(null);

    if (!keyDraft.trim()) {
      setKeyError('Enter your OpenRouter API key.');
      return;
    }

    setSavingKey(true);

    try {
      await saveApiKey(keyDraft);
      setFeedback({
        tone: 'success',
        message: 'API key saved on this device.',
      });
    } catch {
      setFeedback({
        tone: 'error',
        message: 'Could not save the key. Check your storage permissions and try again.',
      });
    } finally {
      setSavingKey(false);
    }
  };

  const handleTestKey = async () => {
    setKeyError(null);
    setFeedback(null);

    if (!keyDraft.trim()) {
      setKeyError('Enter your OpenRouter API key before testing.');
      return;
    }

    setTestingKey(true);

    try {
      const result = await testOpenRouterKey(keyDraft);

      if (result.ok) {
        try {
          await saveApiKey(keyDraft);
          setFeedback({
            tone: 'success',
            message: `Connected to OpenRouter · ${result.label}. Key saved.`,
          });
        } catch {
          setFeedback({
            tone: 'error',
            message:
              'The key works, but it could not be saved on this device. Try again.',
          });
        }
      } else {
        setFeedback({ tone: 'error', message: result.message });
      }
    } finally {
      setTestingKey(false);
    }
  };

  const handleRemoveKey = async () => {
    setRemovingKey(true);
    setFeedback(null);

    try {
      await saveApiKey('');
      setKeyDraft('');
      setFeedback({
        tone: 'success',
        message: 'API key removed from this device.',
      });
    } catch {
      setFeedback({
        tone: 'error',
        message: 'Could not remove the key. Try again.',
      });
    } finally {
      setRemovingKey(false);
    }
  };

  const handlePreference = async (patch: Parameters<typeof updateSettings>[0]) => {
    try {
      await updateSettings(patch);
    } catch {
      showToast('Could not save that preference. Try again.', 'error');
    }
  };

  const handleSelectModel = async (model: { id: string; name: string }) => {
    setModelPickerVisible(false);

    try {
      await updateSettings({ modelId: model.id, modelName: model.name });
      showToast(`${model.name} is now narrating.`, 'success');
    } catch {
      showToast('Could not save that model. Try again.', 'error');
    }
  };

  const handleImageToggle = (enabled: boolean) => {
    if (enabled) {
      void handlePreference({ imageFrequency: lastImageFrequency.current });
      return;
    }

    if (settings.imageFrequency !== 'off') {
      lastImageFrequency.current = settings.imageFrequency;
    }

    void handlePreference({ imageFrequency: 'off' });
  };

  const handleReset = async () => {
    setResetting(true);

    try {
      await resetSettings();
      setKeyDraft('');
      setFeedback(null);
      setResetVisible(false);
      showToast('Settings reset.', 'success');
    } catch {
      showToast('Could not reset settings. Try again.', 'error');
    } finally {
      setResetting(false);
    }
  };

  const openKeyPage = () => {
    void WebBrowser.openBrowserAsync('https://openrouter.ai/keys');
  };

  if (!hydrated) {
    return (
      <View style={styles.root}>
        <AppBackground />
        <SafeAreaView edges={['top']} style={styles.loadingState}>
          <ActivityIndicator color={colors.gold} size="small" />
          <Text style={styles.loadingText}>Loading your settings…</Text>
        </SafeAreaView>
      </View>
    );
  }

  const narration = narrationCopy[settings.narrationStyle];
  const imagesEnabled = settings.imageFrequency !== 'off';
  const imageFrequency = imagesEnabled ? settings.imageFrequency : 'choice';
  const imageDescription =
    imageFrequency === 'action'
      ? 'A new illustration every time Kan speaks or acts.'
      : 'A new illustration whenever the narrator offers a fresh set of choices.';
  const storageCopy =
    Platform.OS === 'web'
      ? 'Stored in this browser only. Never sent anywhere except OpenRouter.'
      : 'Encrypted in this device’s secure storage. Never sent anywhere except OpenRouter.';

  return (
    <View style={styles.root}>
      <AppBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Wordmark compact />
            <View style={styles.localPill}>
              <Lock color={colors.success} size={11} strokeWidth={2} />
              <Text style={styles.localPillText}>On device</Text>
            </View>
          </View>

          <View style={styles.pageHeading}>
            <Text style={type.eyebrow}>The telling</Text>
            <Text style={styles.pageTitle}>Settings</Text>
            <Text style={styles.pageSubtitle}>
              Shape the voice, pace and look of Kan’s world.
            </Text>
          </View>

          <View style={styles.section}>
            <SectionHeader
              description="Kan uses your OpenRouter account to narrate every turn."
              eyebrow="Connection"
              title="OpenRouter"
            />
            <SurfaceCard style={styles.connectionCard}>
              <View style={styles.cardTitleRow}>
                <View style={styles.keyIcon}>
                  <KeyRound color={colors.gold} size={18} strokeWidth={1.7} />
                </View>
                <View style={styles.cardTitleCopy}>
                  <Text style={styles.cardTitle}>API key</Text>
                  <Text style={styles.cardSubtitle}>
                    {apiKey ? 'A key is saved.' : 'No key saved yet.'}
                  </Text>
                </View>
                <View
                  style={[
                    styles.stateDot,
                    {
                      backgroundColor: apiKey ? colors.success : colors.textDim,
                    },
                  ]}
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>OpenRouter key</Text>
                <View
                  style={[
                    styles.inputWrap,
                    keyError ? styles.inputWrapError : null,
                  ]}
                >
                  <TextInput
                    accessibilityLabel="OpenRouter API key"
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect={false}
                    onChangeText={(value) => {
                      setKeyDraft(value);
                      setKeyError(null);
                      setFeedback(null);
                    }}
                    onSubmitEditing={() => void handleSaveKey()}
                    placeholder="sk-or-v1-..."
                    placeholderTextColor={colors.textDim}
                    returnKeyType="done"
                    secureTextEntry={!showKey}
                    style={styles.input}
                    value={keyDraft}
                  />
                  <Pressable
                    accessibilityLabel={showKey ? 'Hide API key' : 'Show API key'}
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setShowKey((current) => !current)}
                  >
                    {showKey ? (
                      <EyeOff color={colors.textDim} size={18} strokeWidth={1.7} />
                    ) : (
                      <Eye color={colors.textDim} size={18} strokeWidth={1.7} />
                    )}
                  </Pressable>
                </View>
                {keyError ? (
                  <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                    {keyError}
                  </Text>
                ) : (
                  <Text style={styles.fieldHint}>{storageCopy}</Text>
                )}
              </View>

              <View style={styles.buttonRow}>
                <AppButton
                  compact
                  disabled={removingKey}
                  label="Save key"
                  loading={savingKey}
                  loadingLabel="Saving…"
                  onPress={() => void handleSaveKey()}
                  style={styles.flexButton}
                />
                <AppButton
                  compact
                  disabled={savingKey || removingKey}
                  label="Test"
                  loading={testingKey}
                  loadingLabel="Checking…"
                  onPress={() => void handleTestKey()}
                  style={styles.flexButton}
                  variant="secondary"
                />
              </View>

              {feedback ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={[
                    styles.feedback,
                    feedback.tone === 'success'
                      ? styles.feedbackSuccess
                      : styles.feedbackError,
                  ]}
                >
                  {feedback.tone === 'success' ? (
                    <CircleCheck color={colors.success} size={17} strokeWidth={1.8} />
                  ) : (
                    <CircleAlert color={colors.danger} size={17} strokeWidth={1.8} />
                  )}
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              ) : null}

              <View style={styles.keyLinks}>
                <Pressable
                  accessibilityRole="link"
                  onPress={openKeyPage}
                  style={({ pressed }) => [
                    styles.inlineLink,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.inlineLinkText}>Get an OpenRouter key</Text>
                  <ExternalLink color={colors.gold} size={13} strokeWidth={1.8} />
                </Pressable>
                {apiKey ? (
                  <Pressable
                    accessibilityLabel="Remove saved API key"
                    accessibilityRole="button"
                    disabled={removingKey}
                    onPress={() => void handleRemoveKey()}
                    style={({ pressed }) => [
                      styles.inlineLink,
                      pressed && styles.pressed,
                    ]}
                  >
                    {removingKey ? (
                      <ActivityIndicator color={colors.danger} size="small" />
                    ) : (
                      <Trash2 color={colors.danger} size={12} strokeWidth={1.8} />
                    )}
                    <Text style={styles.removeLinkText}>Remove key</Text>
                  </Pressable>
                ) : null}
              </View>
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionHeader
              description="Any text model on OpenRouter can take the narrator’s chair."
              eyebrow="Narrator"
              title="Voice of the world"
            />
            <Pressable
              accessibilityLabel="Choose narrator model"
              accessibilityRole="button"
              onPress={() => setModelPickerVisible(true)}
              style={({ pressed }) => [
                styles.modelCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.modelGlyph}>
                <Sparkles color={colors.accentBright} size={19} strokeWidth={1.8} />
              </View>
              <View style={styles.modelCopy}>
                <Text style={styles.modelLabel}>Selected model</Text>
                <Text numberOfLines={1} style={styles.modelName}>
                  {settings.modelName}
                </Text>
                <Text numberOfLines={1} style={styles.modelId}>
                  {settings.modelId}
                </Text>
              </View>
              <ChevronRight color={colors.textDim} size={18} strokeWidth={1.8} />
            </Pressable>
          </View>

          <View style={styles.section}>
            <SectionHeader
              description="Choose how much room the prose leaves for mood and detail."
              eyebrow="Narration"
              title="How the world sounds"
            />
            <SurfaceCard>
              <SegmentedControl
                accessibilityLabel="Narration style"
                onChange={(value) => void handlePreference({ narrationStyle: value })}
                options={narrationOptions}
                value={settings.narrationStyle}
              />
              <Text style={styles.preferenceDescription}>
                {narration.description}
              </Text>
              <View style={styles.previewBox}>
                <Text style={styles.previewLabel}>PREVIEW</Text>
                <Text style={styles.previewQuote}>{narration.preview}</Text>
              </View>
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionHeader
              description="Give each turn a face. Images are generated through OpenRouter."
              eyebrow="Scene images"
              title="Paint the moment"
            />
            <SurfaceCard>
              <View style={styles.switchRow}>
                <View style={styles.switchIcon}>
                  <WandSparkles color={colors.gold} size={18} strokeWidth={1.7} />
                </View>
                <View style={styles.switchCopy}>
                  <Text style={styles.switchTitle}>Generate scene images</Text>
                  <Text style={styles.switchHint}>
                    Illustrate the story as it unfolds.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Generate scene images"
                  ios_backgroundColor={colors.surfaceSoft}
                  onValueChange={handleImageToggle}
                  thumbColor={colors.text}
                  trackColor={{
                    false: colors.surfaceSoft,
                    true: colors.accent,
                  }}
                  value={imagesEnabled}
                />
              </View>

              {imagesEnabled ? (
                <>
                  <View style={styles.rule} />

                  <View style={styles.preference}>
                    <Text style={styles.preferenceLabel}>Frequency</Text>
                    <SegmentedControl
                      accessibilityLabel="Image frequency"
                      onChange={(value) =>
                        void handlePreference({ imageFrequency: value })
                      }
                      options={imageFrequencyOptions}
                      value={imageFrequency}
                    />
                    <Text style={styles.preferenceDescription}>
                      {imageDescription}
                    </Text>
                  </View>

                  <View style={styles.rule} />

                  <View style={styles.preference}>
                    <Text style={styles.preferenceLabel}>Visual language</Text>
                    <SegmentedControl
                      accessibilityLabel="Image style"
                      onChange={(value) =>
                        void handlePreference({ imageStyle: value })
                      }
                      options={imageStyleOptions}
                      value={settings.imageStyle}
                    />
                  </View>
                </>
              ) : (
                <View style={styles.imageOffHint}>
                  <ImageIcon color={colors.textDim} size={15} strokeWidth={1.7} />
                  <Text style={styles.imageOffText}>
                    Images stay off until you turn them on.
                  </Text>
                </View>
              )}

              <View style={styles.infoNote}>
                <Info color={colors.textDim} size={14} strokeWidth={1.7} />
                <Text style={styles.infoText}>
                  Image generation needs an image-capable model. It will be wired
                  into the story engine in the next build.
                </Text>
              </View>
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionHeader
              description="The key and preferences above live only on this device."
              eyebrow="Local data"
              title="Start fresh"
            />
            <Pressable
              accessibilityLabel="Reset all settings"
              accessibilityRole="button"
              onPress={() => setResetVisible(true)}
              style={({ pressed }) => [
                styles.resetRow,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.resetIcon}>
                <RotateCcw color={colors.danger} size={18} strokeWidth={1.8} />
              </View>
              <View style={styles.resetCopy}>
                <Text style={styles.resetTitle}>Reset all settings</Text>
                <Text style={styles.resetBody}>
                  Clears your key, model and story preferences.
                </Text>
              </View>
              <Trash2 color={colors.textDim} size={17} strokeWidth={1.7} />
            </Pressable>
          </View>

          <View style={styles.about}>
            <View style={styles.aboutRule} />
            <Text style={styles.aboutTitle}>KAN · v0.1</Text>
            <Text style={styles.aboutBody}>
              A fan-made roleplaying experience set in the world of Naruto.
              Original character, unofficial story.
            </Text>
            {Platform.OS === 'web' ? (
              <Text style={styles.aboutBody}>
                Install Kan from your browser menu to play full screen on Android.
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>

      <ModelPickerModal
        onClose={() => setModelPickerVisible(false)}
        onSelect={(model) => void handleSelectModel(model)}
        selectedId={settings.modelId}
        visible={modelPickerVisible}
      />

      <ConfirmDialog
        body="This removes your OpenRouter key, chosen model, narration style and image preferences from this device. You can reconnect at any time."
        busy={resetting}
        confirmLabel="Reset everything"
        onCancel={() => setResetVisible(false)}
        onConfirm={() => void handleReset()}
        title="Forget these settings?"
        visible={resetVisible}
      />
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
    paddingBottom: spacing.giant,
    gap: spacing.xxxl,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textDim,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  localPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(134, 186, 152, 0.2)',
    backgroundColor: colors.successSoft,
  },
  localPillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.success,
  },
  pageHeading: {
    gap: 4,
    marginTop: -spacing.md,
  },
  pageTitle: {
    fontFamily: fonts.display,
    fontSize: 44,
    lineHeight: 50,
    letterSpacing: -1,
    color: colors.text,
  },
  pageSubtitle: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
    maxWidth: 400,
  },
  section: {
    gap: 0,
  },
  connectionCard: {
    gap: spacing.lg,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  keyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  cardTitleCopy: {
    flex: 1,
    gap: 1,
  },
  cardTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  cardSubtitle: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textDim,
  },
  stateDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 50,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  inputWrapError: {
    borderColor: 'rgba(227, 107, 93, 0.64)',
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: fonts.mono,
    fontSize: 14,
    color: colors.text,
  },
  fieldHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  fieldError: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 16,
    color: colors.danger,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  feedback: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  feedbackSuccess: {
    borderColor: 'rgba(134, 186, 152, 0.22)',
    backgroundColor: colors.successSoft,
  },
  feedbackError: {
    borderColor: 'rgba(227, 107, 93, 0.24)',
    backgroundColor: colors.dangerSoft,
  },
  feedbackText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  inlineLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    minHeight: 24,
  },
  keyLinks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  inlineLinkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.gold,
  },
  removeLinkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.7,
  },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 82,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modelGlyph: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  modelCopy: {
    flex: 1,
    gap: 2,
  },
  modelLabel: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textDim,
  },
  modelName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  modelId: {
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  preferenceDescription: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
    marginTop: spacing.sm,
  },
  previewBox: {
    gap: 5,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  previewLabel: {
    fontFamily: fonts.mono,
    fontSize: 8,
    lineHeight: 11,
    letterSpacing: 1.2,
    color: colors.textDim,
  },
  previewQuote: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textMuted,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
  },
  switchIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  switchCopy: {
    flex: 1,
    gap: 1,
  },
  switchTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  switchHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  rule: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  preference: {
    gap: 0,
  },
  preferenceLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  imageOffHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  imageOffText: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  infoNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: spacing.lg,
  },
  infoText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 78,
    padding: spacing.lg,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(227, 107, 93, 0.16)',
    backgroundColor: colors.surface,
  },
  resetIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(227, 107, 93, 0.22)',
    backgroundColor: colors.dangerSoft,
  },
  resetCopy: {
    flex: 1,
    gap: 2,
  },
  resetTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.danger,
  },
  resetBody: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  about: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  aboutRule: {
    width: 32,
    height: 1,
    backgroundColor: colors.goldBorder,
    marginBottom: spacing.xs,
  },
  aboutTitle: {
    fontFamily: fonts.mono,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 1.2,
    color: colors.textDim,
  },
  aboutBody: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 17,
    color: colors.textDim,
    textAlign: 'center',
    maxWidth: 330,
  },
});
