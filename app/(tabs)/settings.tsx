import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react-native';

import { AppBackground } from '@/components/AppBackground';
import { AppButton } from '@/components/AppButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ModelSelect } from '@/components/ModelSelect';
import { SurfaceCard } from '@/components/SurfaceCard';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { testOpenRouterKey } from '@/lib/openrouter';
import { downloadJson, pickJsonFile } from '@/lib/rpg/file';
import { useGame } from '@/lib/rpg/game';

type Feedback = {
  tone: 'success' | 'error';
  message: string;
};

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
    db,
    slots,
    setApiKey,
    updateSettings,
    createNewSlot,
    deleteSlotById,
    duplicateSlotById,
    renameSlotById,
    switchSlotById,
    exportActiveSlot,
    importSlot,
  } = useGame();
  const { showToast } = useToast();

  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [testingKey, setTestingKey] = useState(false);
  const [removingKey, setRemovingKey] = useState(false);

  const [newSlotName, setNewSlotName] = useState('');
  const [renamingSlotId, setRenamingSlotId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteSlotId, setDeleteSlotId] = useState<string | null>(null);
  const [deletingSlot, setDeletingSlot] = useState(false);

  useEffect(() => {
    setKeyDraft(apiKey);
  }, [apiKey]);

  useEffect(() => {
    if (!db) {
      return;
    }

  }, [db]);

  const handleSaveKey = async () => {
    setKeyError(null);
    setFeedback(null);

    if (!keyDraft.trim()) {
      setKeyError('Enter your OpenRouter API key.');
      return;
    }

    setSavingKey(true);

    try {
      await setApiKey(keyDraft);
      setFeedback({ tone: 'success', message: 'API key saved on this device.' });
    } catch {
      setFeedback({
        tone: 'error',
        message: 'Could not save the key. Check your storage permissions.',
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
        await setApiKey(keyDraft);
        setFeedback({
          tone: 'success',
          message: `Connected to OpenRouter · ${result.label}.`,
        });
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
      await setApiKey('');
      setKeyDraft('');
      setFeedback({ tone: 'success', message: 'API key removed.' });
    } catch {
      setFeedback({ tone: 'error', message: 'Could not remove the key.' });
    } finally {
      setRemovingKey(false);
    }
  };

  const handleExport = () => {
    const json = exportActiveSlot();

    if (!json) {
      return;
    }

    downloadJson(`kan-story-${db?.meta.slotName ?? 'save'}.json`, json);
    showToast('Save file downloaded.', 'success');
  };

  const handleImport = async () => {
    try {
      const json = await pickJsonFile();
      await importSlot(json);
      showToast('Story imported.', 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import that file.';
      showToast(message, 'error');
    }
  };

  const handleCreateSlot = async () => {
    const name = newSlotName.trim() || 'New story';
    await createNewSlot(name);
    setNewSlotName('');
    showToast(`Created ${name}.`, 'success');
  };

  const handleRename = async () => {
    if (!renamingSlotId) {
      return;
    }

    const name = renameValue.trim();

    if (!name) {
      return;
    }

    await renameSlotById(renamingSlotId, name);
    setRenamingSlotId(null);
    setRenameValue('');
    showToast('Story renamed.', 'success');
  };

  const handleDeleteSlot = async () => {
    if (!deleteSlotId) {
      return;
    }

    setDeletingSlot(true);

    try {
      await deleteSlotById(deleteSlotId);
      setDeleteSlotId(null);
      showToast('Story deleted.', 'success');
    } catch {
      showToast('Could not delete that story.', 'error');
    } finally {
      setDeletingSlot(false);
    }
  };

  if (!db) {
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
            <Text style={styles.pageSubtitle}>
              Connect the narrator, choose models, and manage your saves.
            </Text>
          </View>

          <View style={styles.section}>
            <SectionTitle hint="Your key stays on this device." title="OpenRouter" />
            <SurfaceCard style={styles.card}>
              <View style={styles.keyStatus}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: apiKey ? colors.success : colors.textDim },
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
                      <EyeOff color={colors.textDim} size={18} strokeWidth={2} />
                    ) : (
                      <Eye color={colors.textDim} size={18} strokeWidth={2} />
                    )}
                  </Pressable>
                </View>
                {keyError ? (
                  <Text accessibilityLiveRegion="polite" style={styles.fieldError}>
                    {keyError}
                  </Text>
                ) : (
                  <Text style={styles.fieldHint}>
                    Stored locally and sent only to OpenRouter.
                  </Text>
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
                  onPress={() =>
                    void import('expo-web-browser').then((module) =>
                      module.openBrowserAsync('https://openrouter.ai/keys')
                    )
                  }
                  style={({ pressed }) => [styles.textLink, pressed && styles.pressed]}
                >
                  <Text style={styles.textLinkLabel}>Get a key</Text>
                  <ExternalLink color={colors.textMuted} size={13} strokeWidth={2} />
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
                      <Trash2 color={colors.danger} size={13} strokeWidth={2} />
                    )}
                    <Text style={styles.removeLabel}>Remove key</Text>
                  </Pressable>
                ) : null}
              </View>
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionTitle hint="Use different models for narration, summaries, and extraction." title="Models" />
            <SurfaceCard style={styles.card}>
              <ModelSelect
                hint="Writes the story."
                label="Narration model"
                onChange={(value) => void updateSettings({ narrationModel: value })}
                value={db.settings.narrationModel}
              />
              <ModelSelect
                hint="Rolls chapters and arcs into summaries."
                label="Summary model"
                onChange={(value) => void updateSettings({ summaryModel: value })}
                value={db.settings.summaryModel}
              />
              <ModelSelect
                hint="Extracts state, bonds, facts, and threads."
                label="Extraction model"
                onChange={(value) => void updateSettings({ extractionModel: value })}
                value={db.settings.extractionModel}
              />
              <ModelSelect
                hint="Generates story scene images."
                kind="image"
                label="Image model"
                onChange={(value) => void updateSettings({ imageModel: value })}
                value={db.settings.imageModel}
              />
            </SurfaceCard>
          </View>

          <View style={styles.section}>
            <SectionTitle hint="Multiple independent stories." title="Save slots" />
            <SurfaceCard style={styles.card}>
              <View style={styles.newSlotRow}>
                <TextInput
                  accessibilityLabel="New story name"
                  onChangeText={setNewSlotName}
                  placeholder="New story name"
                  placeholderTextColor={colors.textDim}
                  style={styles.newSlotInput}
                  value={newSlotName}
                />
                <AppButton
                  compact
                  icon={<Plus color={colors.onAccent} size={16} strokeWidth={2.2} />}
                  label="New"
                  onPress={() => void handleCreateSlot()}
                  style={styles.newSlotButton}
                />
              </View>

              <View style={styles.slotList}>
                {slots.map((slot) => {
                  const active = slot.meta.slotId === db.meta.slotId;

                  return (
                    <View key={slot.meta.slotId} style={styles.slotCard}>
                      <View style={styles.slotTop}>
                        <View style={styles.slotCopy}>
                          {renamingSlotId === slot.meta.slotId ? (
                            <TextInput
                              accessibilityLabel="Rename story"
                              autoFocus
                              onChangeText={setRenameValue}
                              onSubmitEditing={() => void handleRename()}
                              style={styles.renameInput}
                              value={renameValue}
                            />
                          ) : (
                            <Text numberOfLines={1} style={styles.slotName}>
                              {slot.meta.slotName}
                            </Text>
                          )}
                          <Text style={styles.slotMeta}>
                            Chapter {slot.state.chapter} · {slot.rawLog.length} log entries
                          </Text>
                        </View>
                        <Text style={[active ? styles.activeTag : styles.inactiveTag]}>
                          {active ? 'Active' : 'Saved'}
                        </Text>
                      </View>

                      <View style={styles.slotActions}>
                        {!active ? (
                          <AppButton
                            compact
                            label="Switch"
                            onPress={() => void switchSlotById(slot.meta.slotId)}
                            style={styles.slotButton}
                            variant="secondary"
                          />
                        ) : null}
                        <AppButton
                          compact
                          icon={<Copy color={colors.text} size={14} strokeWidth={2} />}
                          label="Copy"
                          onPress={() =>
                            void duplicateSlotById(
                              slot.meta.slotId,
                              `${slot.meta.slotName} copy`
                            )
                          }
                          style={styles.slotButton}
                          variant="secondary"
                        />
                        <AppButton
                          compact
                          icon={<Pencil color={colors.text} size={14} strokeWidth={2} />}
                          label="Rename"
                          onPress={() => {
                            setRenamingSlotId(slot.meta.slotId);
                            setRenameValue(slot.meta.slotName);
                          }}
                          style={styles.slotButton}
                          variant="secondary"
                        />
                        <AppButton
                          compact
                          icon={<Trash2 color={colors.danger} size={14} strokeWidth={2} />}
                          label="Delete"
                          onPress={() => setDeleteSlotId(slot.meta.slotId)}
                          style={styles.slotButton}
                          variant="destructive"
                        />
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={styles.importExportRow}>
                <AppButton
                  compact
                  icon={<Download color={colors.onAccent} size={15} strokeWidth={2} />}
                  label="Export"
                  onPress={handleExport}
                  style={styles.flexButton}
                />
                <AppButton
                  compact
                  icon={<Upload color={colors.text} size={15} strokeWidth={2} />}
                  label="Import"
                  onPress={() => void handleImport()}
                  style={styles.flexButton}
                  variant="secondary"
                />
              </View>
            </SurfaceCard>
          </View>

          <View style={styles.about}>
            <Text style={styles.aboutText}>KAN · v0.2</Text>
            <Text style={styles.aboutText}>an app made by xanpire.</Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      <ConfirmDialog
        body="This permanently deletes this story slot and its saved memory."
        busy={deletingSlot}
        confirmLabel="Delete"
        onCancel={() => setDeleteSlotId(null)}
        onConfirm={() => void handleDeleteSlot()}
        title="Delete this story?"
        visible={Boolean(deleteSlotId)}
      />
    </View>
  );
}

function clampNumber(value: string, min: number, max: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(max, Math.max(min, parsed));
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
    borderColor: colors.border,
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
  numberRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  numberField: {
    flex: 1,
    gap: 7,
  },
  numberInput: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.text,
  },
  retrievalField: {
    gap: 7,
  },
  newSlotRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  newSlotInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.text,
  },
  newSlotButton: {
    minWidth: 78,
  },
  slotList: {
    gap: spacing.sm,
  },
  slotCard: {
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  slotTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  slotCopy: {
    flex: 1,
    gap: 2,
  },
  slotName: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  slotMeta: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  activeTag: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: colors.accent,
  },
  inactiveTag: {
    fontFamily: fonts.semibold,
    fontSize: 10,
    color: colors.textDim,
  },
  renameInput: {
    minHeight: 36,
    paddingHorizontal: 9,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.medium,
    fontSize: 13,
    color: colors.text,
  },
  slotActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  slotButton: {
    minWidth: 72,
  },
  importExportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
