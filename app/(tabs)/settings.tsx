import * as WebBrowser from 'expo-web-browser';
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Eye,
  EyeOff,
  RotateCcw,
  Trash2,
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
import { SegmentedControl } from '@/components/SegmentedControl';
import { SurfaceCard } from '@/components/SurfaceCard';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing } from '@/constants/theme';
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

const narrationDescription: Record<NarrationStyle, string> = {
  cinematic: 'Atmospheric and visual. Built for tension and scene-setting.',
  balanced: 'Clear action with room for mood and dialogue.',
  literary: 'Closer and more sensory. A slower, more detailed telling.',
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

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

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
          <ActivityIndicator color={colors.accent} size="small" />
          <Text style={styles.loadingText}>Loading settings…</Text>
        </SafeAreaView>
      </View>
    );
  }

  const imagesEnabled = settings.imageFrequency !== 'off';
  const imageFrequency = imagesEnabled ? settings.imageFrequency : 'choice';
  const imageDescription =
    imageFrequency === 'action'
      ? 'A new image every time Kan speaks or acts.'
      : 'A new image each time the narrator offers choices.';
  const storageCopy =
    Platform.OS === 'web'
      ? 'Stored in this browser and sent only to OpenRouter.'
      : 'Stored securely on this device and sent only to OpenRouter.';

  return (
    <View style={styles.root}>
      <AppBackground />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pageHeading}>
            <Text style={styles.pageTitle}>Settings</Text>
            <Text style={styles.pageSubtitle}>Narrator and story preferences.</Text>
          </View>

          <View style={styles.section}>
            <SectionTitle
              hint="Connect your key to enable narration."
              title="OpenRouter"
            />
            <SurfaceCard style={styles.card}>
              <View style={styles.keyStatus}>
                <View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: apiKey ? colors.success : colors.textDim,
                    },
                  ]}
                />
                <Text style={styles.keyStatusText}>
                  {apiKey ? 'Key saved' : 'No key saved'}
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>API key</Text>
                <View style={[styles.inputWrap, keyError ? styles.inputError : null]}>
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
                      <EyeOff color={colors.textDim} size={18} strokeWidth={1.8} />
                    ) : (
                      <Eye color={colors.textDim} size={18} strokeWidth={1.8} />
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
                  disabled={removingKey || testingKey}
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
                <View accessibilityLiveRegion="polite" style={styles.feedback}>
                  {feedback.tone === 'success' ? (
                    <CircleCheck color={colors.success} size={16} strokeWidth={2} />
                  ) : (
                    <CircleAlert color={colors.danger} size={16} strokeWidth={2} />
                  )}
                  <Text style={styles.feedbackText}>{feedback.message}</Text>
                </View>
              ) : null}

              <View style={styles.keyLinks}>
                <Pressable
                  accessibilityRole="link"
                  onPress={openKeyPage}
                  style={({ pressed }) => [styles.textLink, pressed && styles.pressed]}
                >
                  <Text style={styles.textLinkLabel}>Get a key</Text>
                  <ExternalLink color={colors.textMuted} size={13} strokeWidth={1.8} />
                </Pressable>
                {apiKey ? (
                  <Pressable
                    accessibilityLabel="Remove saved API key"
                    accessibilityRole="button"
                    disabled={removingKey || savingKey || testingKey}
                    onPress={() => void handleRemoveKey()}
                    style={({ pressed }) => [styles.textLink, pressed && styles.pressed]}
                  >
                    {removingKey ? (
                      <ActivityIndicator color={colors.danger} size="small" />
                    ) : (
                      <Trash2 color={colors.danger} size={13} strokeWidth={1.8} />
                    )}
                    <Text style={styles.removeLabel}>Remove key</Text>
                  </Pressable>
                ) : null}
              </View>
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionTitle hint="Any model on OpenRouter." title="Narrator model" />
            <Pressable
              accessibilityLabel="Choose narrator model"
              accessibilityRole="button"
              onPress={() => setModelPickerVisible(true)}
              style={({ pressed }) => [styles.modelCard, pressed && styles.pressed]}
            >
              <View style={styles.modelCopy}>
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
            <SectionTitle title="Narration" />
            <SurfaceCard style={styles.card}>
              <SegmentedControl
                accessibilityLabel="Narration style"
                onChange={(value) => void handlePreference({ narrationStyle: value })}
                options={narrationOptions}
                value={settings.narrationStyle}
              />
              <Text style={styles.preferenceHint}>
                {narrationDescription[settings.narrationStyle]}
              </Text>
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionTitle title="Scene images" />
            <SurfaceCard style={styles.card}>
              <View style={styles.switchRow}>
                <View style={styles.switchCopy}>
                  <Text style={styles.switchTitle}>Generate images</Text>
                  <Text style={styles.switchHint}>
                    Uses an image-capable OpenRouter model.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Generate scene images"
                  ios_backgroundColor={colors.surfaceSoft}
                  onValueChange={handleImageToggle}
                  thumbColor={colors.white}
                  trackColor={{
                    false: colors.surfaceSoft,
                    true: colors.accent,
                  }}
                  value={imagesEnabled}
                />
              </View>

              {imagesEnabled ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.fieldLabel}>Frequency</Text>
                  <SegmentedControl
                    accessibilityLabel="Image frequency"
                    onChange={(value) =>
                      void handlePreference({ imageFrequency: value })
                    }
                    options={imageFrequencyOptions}
                    value={imageFrequency}
                  />
                  <Text style={styles.preferenceHint}>{imageDescription}</Text>

                  <View style={styles.divider} />
                  <Text style={styles.fieldLabel}>Style</Text>
                  <SegmentedControl
                    accessibilityLabel="Image style"
                    onChange={(value) => void handlePreference({ imageStyle: value })}
                    options={imageStyleOptions}
                    value={settings.imageStyle}
                  />
                </>
              ) : null}
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionTitle title="Data" />
            <Pressable
              accessibilityLabel="Reset all settings"
              accessibilityRole="button"
              onPress={() => setResetVisible(true)}
              style={({ pressed }) => [styles.resetRow, pressed && styles.pressed]}
            >
              <RotateCcw color={colors.danger} size={18} strokeWidth={1.8} />
              <Text style={styles.resetLabel}>Reset all settings</Text>
              <ChevronRight color={colors.textDim} size={17} strokeWidth={1.8} />
            </Pressable>
          </View>

          <View style={styles.about}>
            <Text style={styles.aboutText}>KAN · v0.1</Text>
            <Text style={styles.aboutText}>
              Fan-made and unofficial. Set in the world of Naruto.
            </Text>
            {Platform.OS === 'web' ? (
              <Text style={styles.aboutText}>
                Install from your browser menu to play full screen.
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
        body="This removes your OpenRouter key, chosen model, narration style and image preferences from this device."
        busy={resetting}
        confirmLabel="Reset"
        onCancel={() => setResetVisible(false)}
        onConfirm={() => void handleReset()}
        title="Reset everything?"
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
    maxWidth: 640,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xl,
    paddingBottom: spacing.giant,
    gap: spacing.xxxl,
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
  pageHeading: {
    gap: 4,
  },
  pageTitle: {
    fontFamily: fonts.extrabold,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -1.2,
    color: colors.text,
  },
  pageSubtitle: {
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
  },
  section: {
    gap: 0,
  },
  sectionHeading: {
    gap: 2,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: colors.text,
  },
  sectionHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
  },
  card: {
    gap: spacing.md,
  },
  keyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  keyStatusText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  field: {
    gap: 7,
  },
  fieldLabel: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 13,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  inputError: {
    borderColor: colors.danger,
  },
  input: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: fonts.medium,
    fontSize: 15,
    color: colors.text,
  },
  fieldHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  fieldError: {
    fontFamily: fonts.medium,
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
    gap: 8,
    paddingTop: 2,
  },
  feedbackText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
  keyLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  textLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 32,
  },
  textLinkLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  removeLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    lineHeight: 17,
    color: colors.danger,
  },
  pressed: {
    opacity: 0.65,
  },
  modelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 68,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modelCopy: {
    flex: 1,
    gap: 2,
  },
  modelName: {
    fontFamily: fonts.semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.text,
  },
  modelId: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  preferenceHint: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textDim,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
  },
  switchCopy: {
    flex: 1,
    gap: 2,
  },
  switchTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  switchHint: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 60,
    paddingHorizontal: 16,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  resetLabel: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.danger,
  },
  about: {
    alignItems: 'center',
    gap: 3,
  },
  aboutText: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
    textAlign: 'center',
  },
});
