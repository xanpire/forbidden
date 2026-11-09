// The creation wizard: the player builds their own world, character, people
// and opening scene by hand, screen by screen, then starts the story.
// Drafts autosave. "Help me fill this" is optional on every screen and only
// suggests values for empty fields, shown as a draft to accept or discard.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';

import { AppButton } from '@/components/AppButton';
import { CanonDraftPanel } from '@/components/wizard/CanonDraft';
import { draftFromTemplate, loadTemplates, type WorldTemplate } from '@/lib/rpg/worldEdit';
import { AddButton, Choice, Field, FieldRow, Hint, ItemCard, ListField, MultiChoice, NumberField, Toggle } from '@/components/Form';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { completeChat } from '@/lib/openrouter';
import { pickImageFile } from '@/lib/rpg/file';
import { useGame } from '@/lib/rpg/game';
import { FACE_IMAGE } from '@/lib/rpg/imageCompress';
import { storeImage } from '@/lib/rpg/imageStore';
import { RELATIONSHIP_STAGES } from '@/lib/rpg/intimacy';
import type { CalendarDate, ClimateType, ContentProfile, ContentTag, IntimacyProfile, PlaceDef, StartingPerson, TimelineKnowledge } from '@/lib/rpg/types';
import { CHECK_REASONS, canBeIntimate } from '@/lib/rpg/intimacy';
import {
  CLIMATE_LABELS,
  STEP_LABELS,
  WIZARD_STEPS,
  WORLD_PRESETS,
  applyPreset,
  applySuggestion,
  clearDraft,
  draftToSeedInput,
  emptyDraft,
  emptyPerson,
  helpFillMessages,
  loadDraft,
  missingFields,
  newFaction,
  newLore,
  newPlace,
  newRegion,
  newTimelineEvent,
  parseHelpReply,
  saveDraft,
  type HelpSection,
  type HelpSuggestion,
  type WizardDraft,
  type WizardStep,
} from '@/lib/rpg/wizard';

import {
  BackstoryStep,
  IntimacyStep,
  LoreStep,
  OpeningStep,
  PeopleStep,
  PlacesStep,
  ReviewStep,
  SuggestionCard,
  TimelineStep,
  WorldStep,
  YouStep,
  wizardStyles as styles,
  type Updater,
} from '@/components/wizard/Steps';

export default function NewStoryScreen() {
  const { apiKey, db, createNewSlot } = useGame();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [helping, setHelping] = useState<HelpSection | null>(null);
  const [suggestion, setSuggestion] = useState<{ section: HelpSection; value: HelpSuggestion } | null>(null);
  const [starting, setStarting] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [templates, setTemplates] = useState<WorldTemplate[]>([]);

  useEffect(() => {
    void loadDraft().then((loaded) => setDraft(loaded ?? emptyDraft()));
    void loadTemplates().then(setTemplates);
  }, []);

  // Autosave, a moment after the last change.
  useEffect(() => {
    if (!draft) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveDraft(draft), 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [draft]);

  const update: Updater = useCallback((fn) => setDraft((current) => (current ? fn(current) : current)), []);

  const goTo = (step: WizardStep) => {
    update((current) => ({ ...current, step }));
    setSuggestion(null);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };

  const askForHelp = async (section: HelpSection) => {
    if (!draft) return;
    if (!apiKey) {
      showToast('Add your OpenRouter key in Settings to use help.', 'error');
      return;
    }
    setHelping(section);
    try {
      const result = await completeChat({
        apiKey,
        model: db?.settings.summaryModel ?? 'google/gemini-2.5-flash',
        messages: helpFillMessages(section, draft),
        temperature: 0.8,
        maxTokens: 1400,
        responseFormatJson: true,
      });
      const parsed = parseHelpReply(result.text);
      if (!parsed || Object.keys(parsed).length === 0) {
        showToast('No suggestions came back. Try again.', 'error');
      } else {
        setSuggestion({ section, value: parsed });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Help failed.', 'error');
    } finally {
      setHelping(null);
    }
  };

  const start = async () => {
    if (!draft) return;
    const missing = missingFields(draft);
    if (missing.length > 0) {
      showToast(missing[0].message, 'error');
      goTo(missing[0].step);
      return;
    }
    setStarting(true);
    try {
      const input = draftToSeedInput(draft);
      await createNewSlot(draft.slotName.trim() || input.world.name, input);
      await clearDraft();
      showToast(`Started ${draft.slotName.trim() || input.world.name}.`, 'success');
      router.replace('/');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not start the story.', 'error');
    } finally {
      setStarting(false);
    }
  };

  if (!draft) {
    return <SafeAreaView style={styles.root} />;
  }

  const index = WIZARD_STEPS.indexOf(draft.step);
  const helpSection = draft.step === 'review' ? null : (draft.step as HelpSection);

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <Text style={type.pageTitle}>New story</Text>
        <Pressable accessibilityLabel="Close" accessibilityRole="button" hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          <X color={colors.textMuted} size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.steps} horizontal showsHorizontalScrollIndicator={false} style={styles.stepsBar}>
        {WIZARD_STEPS.map((step, i) => (
          <Pressable key={step} onPress={() => goTo(step)} style={[styles.stepPill, step === draft.step && styles.stepPillActive]}>
            <Text style={[styles.stepText, step === draft.step && styles.stepTextActive]}>
              {i + 1}. {STEP_LABELS[step]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" ref={scroll}>
          {draft.step === 'world' && templates.length > 0 ? (
            <Choice
              hint="Fills in the whole world from one you saved. Your character and story stay yours."
              label="Start from a saved world"
              onChange={(id) => {
                const template = templates.find((item) => item.id === id);
                if (!template) return;
                const fromTemplate = draftFromTemplate(template);
                update((d) => ({ ...d, world: fromTemplate.world, opening: { ...d.opening, date: fromTemplate.opening.date } }));
              }}
              options={templates.map((template) => ({ value: template.id, label: template.name }))}
              value={undefined}
            />
          ) : null}
          {draft.step === 'world' ? <WorldStep draft={draft} update={update} /> : null}
          {draft.step === 'world' ? <CanonDraftPanel draft={draft} update={update} /> : null}
          {draft.step === 'places' ? <PlacesStep draft={draft} update={update} /> : null}
          {draft.step === 'lore' ? <LoreStep draft={draft} update={update} /> : null}
          {draft.step === 'you' ? <YouStep draft={draft} update={update} /> : null}
          {draft.step === 'backstory' ? <BackstoryStep draft={draft} update={update} /> : null}
          {draft.step === 'intimacy' ? <IntimacyStep draft={draft} update={update} /> : null}
          {draft.step === 'people' ? <PeopleStep draft={draft} update={update} /> : null}
          {draft.step === 'opening' ? <OpeningStep draft={draft} update={update} /> : null}
          {draft.step === 'timeline' ? <TimelineStep draft={draft} update={update} /> : null}
          {draft.step === 'review' ? <ReviewStep draft={draft} goTo={goTo} update={update} /> : null}

          {helpSection ? (
            <View style={styles.help}>
              {suggestion && suggestion.section === helpSection ? (
                <SuggestionCard
                  onAccept={() => {
                    update((current) => applySuggestion(current, suggestion.section, suggestion.value));
                    setSuggestion(null);
                    showToast('Added. Edit anything you like.', 'success');
                  }}
                  onDiscard={() => setSuggestion(null)}
                  value={suggestion.value}
                />
              ) : (
                <AppButton
                  label="Help me fill this"
                  loading={helping === helpSection}
                  loadingLabel="Thinking…"
                  onPress={() => void askForHelp(helpSection)}
                  variant="ghost"
                />
              )}
              <Text style={styles.helpNote}>Optional. Suggests only what's still empty; nothing is kept unless you accept it.</Text>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.footer}>
        <AppButton disabled={index === 0} label="Back" onPress={() => goTo(WIZARD_STEPS[Math.max(0, index - 1)])} style={styles.flex} variant="secondary" />
        {draft.step === 'review' ? (
          <AppButton label="Start the story" loading={starting} onPress={() => void start()} style={styles.flex} />
        ) : (
          <AppButton label="Next" onPress={() => goTo(WIZARD_STEPS[index + 1])} style={styles.flex} />
        )}
      </View>
    </SafeAreaView>
  );
}
