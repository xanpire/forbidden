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
import { AddButton, Choice, Field, FieldRow, Hint, ItemCard, ListField, MultiChoice, NumberField, Toggle } from '@/components/Form';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { completeChat } from '@/lib/openrouter';
import { pickImageFile } from '@/lib/rpg/file';
import { useGame } from '@/lib/rpg/game';
import { FACE_IMAGE } from '@/lib/rpg/imageCompress';
import { storeImage } from '@/lib/rpg/imageStore';
import { RELATIONSHIP_STAGES } from '@/lib/rpg/romance';
import type { CalendarDate, ClimateType, PlaceDef, StartingPerson, TimelineKnowledge } from '@/lib/rpg/types';
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

const WHEN_OPTIONS = [
  { value: 'past' as const, label: 'Past' },
  { value: 'present' as const, label: 'Present' },
  { value: 'future' as const, label: 'Future' },
];
const KIND_OPTIONS: { value: PlaceDef['kind']; label: string }[] = [
  { value: 'structure', label: 'Building' },
  { value: 'settlement', label: 'Town or street' },
  { value: 'road', label: 'Road or station' },
  { value: 'wilderness', label: 'Outdoors' },
];
const KNOWLEDGE_OPTIONS: { value: TimelineKnowledge; label: string }[] = [
  { value: 'public', label: 'Everyone hears' },
  { value: 'faction', label: 'One group' },
  { value: 'witnesses', label: 'Only those there' },
  { value: 'secret', label: 'Secret' },
];
const ACCESS_OPTIONS: { value: NonNullable<StartingPerson['romanceAccessibility']>; label: string }[] = [
  { value: 'winnable', label: 'Could fall for you' },
  { value: 'taken', label: 'Heart is taken' },
  { value: 'not-interested', label: 'Not interested' },
  { value: 'not-applicable', label: 'Not relevant' },
];

type Updater = (update: (draft: WizardDraft) => WizardDraft) => void;

export default function NewStoryScreen() {
  const { apiKey, db, createNewSlot } = useGame();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [helping, setHelping] = useState<HelpSection | null>(null);
  const [suggestion, setSuggestion] = useState<{ section: HelpSection; value: HelpSuggestion } | null>(null);
  const [starting, setStarting] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void loadDraft().then((loaded) => setDraft(loaded ?? emptyDraft()));
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
          {draft.step === 'world' ? <WorldStep draft={draft} update={update} /> : null}
          {draft.step === 'places' ? <PlacesStep draft={draft} update={update} /> : null}
          {draft.step === 'lore' ? <LoreStep draft={draft} update={update} /> : null}
          {draft.step === 'you' ? <YouStep draft={draft} update={update} /> : null}
          {draft.step === 'backstory' ? <BackstoryStep draft={draft} update={update} /> : null}
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

function SuggestionCard({ value, onAccept, onDiscard }: { value: HelpSuggestion; onAccept: () => void; onDiscard: () => void }) {
  const lines = Object.entries(value).flatMap(([key, item]) => {
    if (Array.isArray(item)) {
      return item.map((entry) => `${key}: ${typeof entry === 'object' && entry ? Object.values(entry as Record<string, unknown>).filter((v) => typeof v === 'string' || typeof v === 'number').join(' · ') : String(entry)}`);
    }
    return [`${key}: ${String(item)}`];
  });
  return (
    <ItemCard title="Suggestions">
      {lines.map((line, i) => (
        <Text key={i} style={styles.suggestionLine}>
          {line}
        </Text>
      ))}
      <View style={styles.suggestionButtons}>
        <AppButton compact label="Discard" onPress={onDiscard} style={styles.flex} variant="secondary" />
        <AppButton compact label="Use these" onPress={onAccept} style={styles.flex} />
      </View>
    </ItemCard>
  );
}

// ---------------------------------------------------------------------------

function StepIntro({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.intro}>
      <Text style={type.title}>{title}</Text>
      <Text style={type.body}>{body}</Text>
    </View>
  );
}

function DateFields({ value, onChange, withTime = true }: { value: CalendarDate; onChange: (value: CalendarDate) => void; withTime?: boolean }) {
  return (
    <FieldRow>
      <NumberField label="Year" onChange={(year) => onChange({ ...value, year: year ?? value.year })} value={value.year} />
      <NumberField label="Month" onChange={(month) => onChange({ ...value, month: clamp(month ?? 1, 1, 12) })} value={value.month} />
      <NumberField label="Day" onChange={(day) => onChange({ ...value, day: clamp(day ?? 1, 1, 31) })} value={value.day} />
      {withTime ? <NumberField label="Hour" onChange={(hour) => onChange({ ...value, hour: clamp(hour ?? 0, 0, 23) })} value={value.hour} /> : null}
      {withTime ? <NumberField label="Min" onChange={(minute) => onChange({ ...value, minute: clamp(minute ?? 0, 0, 59) })} value={value.minute} /> : null}
    </FieldRow>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function WorldStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const world = draft.world;
  const setWorld = (patch: Partial<typeof world>) => update((d) => ({ ...d, world: { ...d.world, ...patch } }));
  return (
    <>
      <StepIntro body="Where and when your story happens. Everything is grounded in the real world: no magic or powers." title="Your world" />
      <Choice
        label="When is it set?"
        onChange={(when) => setWorld({ era: { ...world.era, when } })}
        options={WHEN_OPTIONS}
        value={world.era.when}
      />
      <Field
        hint="Free text: Rome, 50 BC · London, 1960s · today · 2090"
        label="Period and place"
        onChange={(period) => setWorld({ era: { ...world.era, period } })}
        value={world.era.period}
      />
      <Choice
        hint="Presets only fill in fields; change anything after."
        label="Start from a preset (optional)"
        onChange={(id) => update((d) => applyPreset(d, id))}
        options={WORLD_PRESETS.map((preset) => ({ value: preset.id, label: preset.label }))}
        value={undefined}
      />
      <Field label="World name" onChange={(name) => setWorld({ name })} placeholder="Harbourside" required value={world.name} />
      <Field label="Premise" lines={4} multiline onChange={(premise) => setWorld({ premise })} placeholder="A paragraph about this world and what makes it interesting." required value={world.premise} />
      <FieldRow>
        <Field label="Genre" onChange={(genre) => setWorld({ genre })} placeholder="noir crime drama" value={world.genre} />
        <Field label="Tone" onChange={(tone) => setWorld({ tone })} placeholder="warm, slow-burn" value={world.tone} />
      </FieldRow>
      <Field
        hint="What exists and what doesn't, in plain words."
        label="Technology"
        multiline
        lines={2}
        onChange={(techNotes) => setWorld({ era: { ...world.era, techNotes } })}
        value={world.era.techNotes ?? ''}
      />
      <FieldRow>
        <Field label="Money" onChange={(name) => setWorld({ currency: { ...world.currency, name } })} placeholder="dollars" value={world.currency.name} />
        <Field label="Symbol" onChange={(symbol) => setWorld({ currency: { ...world.currency, symbol } })} placeholder="$" value={world.currency.symbol ?? ''} />
      </FieldRow>
      <Field
        hint="Rough prices, so the narrator charges believable amounts."
        label="Price guide"
        lines={3}
        multiline
        onChange={(priceGuide) => setWorld({ currency: { ...world.currency, priceGuide } })}
        placeholder="coffee 4; a meal 15; a hotel night 150"
        value={world.currency.priceGuide}
      />
      <ListField
        label="How messages travel"
        onChange={(letterCarriers) => setWorld({ letterCarriers })}
        placeholder="text message, phone, post"
        separator="commas"
        values={world.letterCarriers}
      />
      <Field hint="The opening line of every image prompt." label="Art style" onChange={(artStyle) => setWorld({ artStyle })} placeholder="cinematic photo, 35mm film" value={world.artStyle} />
      <Field
        hint="Your own extra rules for the narrator."
        label="Narrator notes"
        lines={3}
        multiline
        onChange={(narratorNotes) => setWorld({ narratorNotes })}
        value={world.narratorNotes ?? ''}
      />
    </>
  );
}

function PlacesStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const world = draft.world;
  const setWorld = (patch: Partial<typeof world>) => update((d) => ({ ...d, world: { ...d.world, ...patch } }));
  const regionOptions = world.regions.filter((region) => region.name.trim()).map((region) => ({ value: region.id, label: region.name }));

  const setRegion = (id: string, patch: Partial<(typeof world.regions)[number]>) =>
    setWorld({ regions: world.regions.map((region) => (region.id === id ? { ...region, ...patch } : region)) });
  const setTravel = (from: string, to: string, days: number | undefined) =>
    setWorld({
      regions: world.regions.map((region) => {
        if (region.id !== from && region.id !== to) return region;
        const other = region.id === from ? to : from;
        const rest = region.neighbours.filter((next) => next.id !== other);
        return { ...region, neighbours: days && days > 0 ? [...rest, { id: other, days }] : rest };
      }),
    });

  return (
    <>
      <StepIntro body="Areas (a district, a town, a country), the places inside them, and the groups that matter." title="Places & groups" />
      <Text style={type.sectionLabel}>Areas</Text>
      {world.regions.map((region) => (
        <ItemCard key={region.id} onRemove={() => setWorld({ regions: world.regions.filter((item) => item.id !== region.id) })} title={region.name || 'New area'}>
          <Field label="Name" onChange={(name) => setRegion(region.id, { name })} value={region.name} />
          <Field label="Description" multiline lines={2} onChange={(description) => setRegion(region.id, { description })} value={region.description} />
          <Choice
            label="Climate"
            onChange={(climate) => setRegion(region.id, { climate: climate as ClimateType })}
            options={Object.entries(CLIMATE_LABELS).map(([value, label]) => ({ value, label }))}
            value={region.climate}
          />
          {world.regions
            .filter((other) => other.id !== region.id && other.name.trim())
            .map((other) => (
              <NumberField
                allowEmpty
                hint="In days: 0.1 is about 2 hours. Empty = not next to each other."
                key={other.id}
                label={`Travel to ${other.name}`}
                onChange={(days) => setTravel(region.id, other.id, days)}
                value={region.neighbours.find((next) => next.id === other.id)?.days}
              />
            ))}
        </ItemCard>
      ))}
      <AddButton label="Add an area" onPress={() => setWorld({ regions: [...world.regions, newRegion()] })} />

      <Text style={type.sectionLabel}>Places</Text>
      {world.places.map((place) => {
        const setPlace = (patch: Partial<typeof place>) => setWorld({ places: world.places.map((item) => (item.id === place.id ? { ...item, ...patch } : item)) });
        return (
          <ItemCard key={place.id} onRemove={() => setWorld({ places: world.places.filter((item) => item.id !== place.id) })} title={place.name || 'New place'}>
            <Field label="Name" onChange={(name) => setPlace({ name })} value={place.name} />
            <Choice label="Kind" onChange={(kind) => setPlace({ kind })} options={KIND_OPTIONS} value={place.kind} />
            <Choice label="Area" onChange={(regionId) => setPlace({ regionId })} options={regionOptions} value={place.regionId} />
            <Field label="Description" multiline lines={2} onChange={(description) => setPlace({ description })} value={place.description} />
          </ItemCard>
        );
      })}
      <AddButton label="Add a place" onPress={() => setWorld({ places: [...world.places, newPlace(world.regions[0]?.id ?? '')] })} />

      <Text style={type.sectionLabel}>Groups</Text>
      <Hint>Any group that matters: a company, a family, a gang, the police, a friend group.</Hint>
      {world.factions.map((faction) => {
        const setFaction = (patch: Partial<typeof faction>) => setWorld({ factions: world.factions.map((item) => (item.id === faction.id ? { ...item, ...patch } : item)) });
        return (
          <ItemCard key={faction.id} onRemove={() => setWorld({ factions: world.factions.filter((item) => item.id !== faction.id) })} title={faction.name || 'New group'}>
            <Field label="Name" onChange={(name) => setFaction({ name })} value={faction.name} />
            <Field label="Description" multiline lines={2} onChange={(description) => setFaction({ description })} value={faction.description} />
            <MultiChoice label="Holds these areas" onChange={(territoryRegionIds) => setFaction({ territoryRegionIds })} options={regionOptions} values={faction.territoryRegionIds ?? []} />
            <Toggle hint="They can put a price on someone." label="Keeps a wanted list" onChange={(hasBounties) => setFaction({ hasBounties })} value={Boolean(faction.hasBounties)} />
            <ListField label="How they send word (optional)" onChange={(carriers) => setFaction({ carriers })} separator="commas" values={faction.carriers} />
          </ItemCard>
        );
      })}
      <AddButton label="Add a group" onPress={() => setWorld({ factions: [...world.factions, newFaction()] })} />
    </>
  );
}

function LoreStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const lore = draft.world.lore;
  const setLore = (next: typeof lore) => update((d) => ({ ...d, world: { ...d.world, lore: next } }));
  return (
    <>
      <StepIntro body="Facts about your world the narrator should know. An entry is used when the story mentions one of its keywords, or always." title="Lore" />
      {lore.map((entry, i) => {
        const set = (patch: Partial<typeof entry>) => setLore(lore.map((item) => (item.id === entry.id ? { ...item, ...patch } : item)));
        return (
          <ItemCard key={entry.id} onRemove={() => setLore(lore.filter((item) => item.id !== entry.id))} title={entry.keywords[0] ?? `Entry ${i + 1}`}>
            <ListField label="Keywords" onChange={(keywords) => set({ keywords })} separator="commas" values={entry.keywords} />
            <Field label="What's true" multiline lines={3} onChange={(text) => set({ text })} value={entry.text} />
            <Toggle label="Always on" onChange={(always) => set({ always })} value={Boolean(entry.always)} />
            <Toggle hint="The narrator knows it, but it never shows in your Journal." label="Hidden from you" onChange={(hidden) => set({ hidden })} value={Boolean(entry.hidden)} />
          </ItemCard>
        );
      })}
      <AddButton label="Add a lore entry" onPress={() => setLore([...lore, newLore()])} />
    </>
  );
}

function YouStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const { showToast } = useToast();
  const c = draft.character;
  const set = (patch: Partial<typeof c>) => update((d) => ({ ...d, character: { ...d.character, ...patch } }));
  const upload = async (field: 'faceImage' | 'outfitImage') => {
    const uri = await pickImageFile(768);
    if (!uri) return;
    try {
      set({ [field]: await storeImage(uri, FACE_IMAGE) });
    } catch {
      showToast('Could not use that image.', 'error');
    }
  };
  return (
    <>
      <StepIntro body="Who you are. You control only this person; the AI plays everyone else." title="You" />
      <Field label="Name" onChange={(name) => set({ name })} required value={c.name} />
      <ListField label="Other names" onChange={(aliases) => set({ aliases })} separator="commas" values={c.aliases} />
      <FieldRow>
        <NumberField label="Age" onChange={(age) => set({ age: age ?? 0 })} value={c.age} />
        <Field label="Gender" onChange={(gender) => set({ gender })} value={c.gender} />
      </FieldRow>
      <FieldRow>
        <NumberField allowEmpty label="Birthday month" onChange={(month) => set({ birthday: month ? { month: clamp(month, 1, 12), day: c.birthday?.day ?? 1 } : undefined })} value={c.birthday?.month} />
        <NumberField allowEmpty label="Birthday day" onChange={(day) => set({ birthday: c.birthday ? { ...c.birthday, day: clamp(day ?? 1, 1, 31) } : undefined })} value={c.birthday?.day} />
      </FieldRow>
      <Field label="Role" onChange={(role) => set({ role })} placeholder="what you do: your job, your place in the world" value={c.role} />
      <Field label="Appearance" multiline lines={3} onChange={(appearance) => set({ appearance })} value={c.appearance} />
      <Field label="Usual clothes" multiline lines={2} onChange={(outfit) => set({ outfit })} value={c.outfit} />
      <Field label="Personality" multiline lines={2} onChange={(personality) => set({ personality })} value={c.personality} />
      <Field label="How you talk" multiline lines={2} onChange={(speechStyle) => set({ speechStyle })} value={c.speechStyle} />
      <Field hint="Plain text: training, languages, what you're good and bad at." label="Skills" multiline lines={3} onChange={(skills) => set({ skills })} value={c.skills ?? ''} />
      <ListField label="What you carry" onChange={(inventory) => set({ inventory })} values={c.inventory} />
      <NumberField label={`Money (${draft.world.currency.name || 'money'})`} onChange={(money) => set({ money: money ?? 0 })} value={c.money} />
      <ListField label="Goals" onChange={(goals) => set({ goals })} values={c.goals} />
      <View style={styles.images}>
        <AppButton compact label={c.faceImage ? 'Face image ✓ (replace)' : 'Upload a face image'} onPress={() => void upload('faceImage')} style={styles.flex} variant="secondary" />
        <AppButton compact label={c.outfitImage ? 'Outfit image ✓ (replace)' : 'Upload an outfit image'} onPress={() => void upload('outfitImage')} style={styles.flex} variant="secondary" />
      </View>
      {c.faceImage || c.outfitImage ? (
        <AppButton compact label="Remove images" onPress={() => set({ faceImage: undefined, outfitImage: undefined })} variant="ghost" />
      ) : null}
      <Hint>Optional. Without images, pictures describe you from your appearance.</Hint>
    </>
  );
}

function BackstoryStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const c = draft.character;
  const knowerOptions = [{ value: 'you', label: 'You' }, ...draft.people.filter((p) => p.name.trim()).map((p) => ({ value: p.name, label: p.name }))];
  const setTruths = (truths: WizardDraft['truths']) => update((d) => ({ ...d, truths }));
  return (
    <>
      <StepIntro body="Your story so far, in your own words. It's kept exactly as you write it." title="Backstory" />
      <Field label="Backstory" lines={10} multiline onChange={(backstory) => update((d) => ({ ...d, character: { ...d.character, backstory } }))} value={c.backstory} />
      <Text style={type.sectionLabel}>Things that are true</Text>
      <Hint>Each one becomes a fact the story remembers. Mark who knows it.</Hint>
      {draft.truths.map((truth, i) => (
        <ItemCard key={i} onRemove={() => setTruths(draft.truths.filter((_, j) => j !== i))} title={`Fact ${i + 1}`}>
          <Field label="What's true" multiline lines={2} onChange={(text) => setTruths(draft.truths.map((item, j) => (j === i ? { ...item, text } : item)))} value={truth.text} />
          <MultiChoice label="Who knows it" onChange={(knownBy) => setTruths(draft.truths.map((item, j) => (j === i ? { ...item, knownBy } : item)))} options={knowerOptions} values={truth.knownBy ?? ['you']} />
        </ItemCard>
      ))}
      <AddButton label="Add a fact" onPress={() => setTruths([...draft.truths, { text: '', knownBy: ['you'] }])} />
      <ListField hint="One per line. Only the narrator knows these until the story shows them." label="Secrets" onChange={(secrets) => update((d) => ({ ...d, character: { ...d.character, secrets } }))} values={c.secrets} />
    </>
  );
}

export function PersonFields({ person, set }: { person: StartingPerson; set: (patch: Partial<StartingPerson>) => void }) {
  return (
    <>
      <Field label="Name" onChange={(name) => set({ name })} value={person.name} />
      <ListField label="Other names" onChange={(aliases) => set({ aliases })} separator="commas" values={person.aliases} />
      <FieldRow>
        <NumberField allowEmpty label="Age" onChange={(age) => set({ age })} value={person.age} />
        <Field label="Gender" onChange={(gender) => set({ gender })} value={person.gender} />
      </FieldRow>
      <Field label="Role" onChange={(role) => set({ role })} value={person.role} />
      <Field label="Appearance" multiline lines={2} onChange={(appearance) => set({ appearance })} value={person.appearance} />
      <Field label="Personality" multiline lines={2} onChange={(personality) => set({ personality })} value={person.personality} />
      <Field label="How they talk" onChange={(speechStyle) => set({ speechStyle })} value={person.speechStyle} />
      <Choice label="Relationship" onChange={(relationship) => set({ relationship })} options={RELATIONSHIP_STAGES.map((stage) => ({ value: stage, label: stage }))} value={person.relationship} />
      <FieldRow>
        <NumberField label="How they feel about you (-10..10)" onChange={(affinity) => set({ theirFeelings: { ...person.theirFeelings, affinity: clamp(affinity ?? 0, -10, 10) } })} value={person.theirFeelings.affinity} />
        <NumberField label="How you feel about them (-10..10)" onChange={(affinity) => set({ yourFeelings: { ...person.yourFeelings, affinity: clamp(affinity ?? 0, -10, 10) } })} value={person.yourFeelings.affinity} />
      </FieldRow>
      <Field label="Their side, in words" onChange={(note) => set({ theirFeelings: { ...person.theirFeelings, note } })} value={person.theirFeelings.note} />
      <Field label="Your side, in words" onChange={(note) => set({ yourFeelings: { ...person.yourFeelings, note } })} value={person.yourFeelings.note} />
      <NumberField allowEmpty label="Attraction to you (0..10)" onChange={(attraction) => set({ attraction: attraction === undefined ? undefined : clamp(attraction, 0, 10) })} value={person.attraction} />
      <Choice label="Romance" onChange={(romanceAccessibility) => set({ romanceAccessibility })} options={ACCESS_OPTIONS} value={person.romanceAccessibility} />
      <Toggle label="Alive" hint="Off: they died before the story starts." onChange={(alive) => set({ alive })} value={person.alive} />
      <Toggle label="You know their name" onChange={(knownName) => set({ knownName })} value={person.knownName} />
      <Toggle label="You've met before" onChange={(met) => set({ met })} value={person.met !== false} />
      <Field label="Where they are now" onChange={(whereabouts) => set({ whereabouts })} value={person.whereabouts ?? ''} />
      <ListField label="Their secrets" onChange={(secrets) => set({ secrets })} values={person.secrets} />
    </>
  );
}

function PeopleStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const setPeople = (people: StartingPerson[]) => update((d) => ({ ...d, people }));
  return (
    <>
      <StepIntro body="The people in your life when the story begins. The story will add more as you meet them." title="People" />
      {draft.people.map((person, i) => (
        <ItemCard key={i} onRemove={() => setPeople(draft.people.filter((_, j) => j !== i))} title={person.name || `Person ${i + 1}`}>
          <PersonFields person={person} set={(patch) => setPeople(draft.people.map((item, j) => (j === i ? { ...item, ...patch } : item)))} />
        </ItemCard>
      ))}
      <AddButton label="Add a person" onPress={() => setPeople([...draft.people, emptyPerson()])} />
    </>
  );
}

function OpeningStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const o = draft.opening;
  const set = (patch: Partial<typeof o>) => update((d) => ({ ...d, opening: { ...d.opening, ...patch } }));
  const placeOptions = draft.world.places.filter((place) => place.name.trim()).map((place) => ({ value: place.name, label: place.name }));
  const castOptions = draft.people.filter((p) => p.name.trim() && p.alive).map((p) => ({ value: p.name, label: p.name }));
  return (
    <>
      <StepIntro body="Where you are and what's happening on the first page." title="Opening" />
      {placeOptions.length > 0 ? <Choice label="Pick a place" onChange={(location) => set({ location })} options={placeOptions} value={o.location} /> : null}
      <Field label="Where you are" onChange={(location) => set({ location })} value={o.location} />
      <Text style={styles.label}>Date and time</Text>
      <DateFields onChange={(date) => set({ date })} value={o.date} />
      <Field label="What's happening" lines={5} multiline onChange={(situation) => set({ situation })} required value={o.situation} />
      <MultiChoice label="Who's there" onChange={(castNames) => set({ castNames })} options={castOptions} values={o.castNames} />
      <ListField hint="One per line. Each becomes an open thread the story follows." label="Starting goals" onChange={(threads) => set({ threads })} values={o.threads} />
    </>
  );
}

function TimelineStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const timeline = draft.world.timeline;
  const setTimeline = (next: typeof timeline) => update((d) => ({ ...d, world: { ...d.world, timeline: next } }));
  const regionOptions = draft.world.regions.filter((r) => r.name.trim()).map((r) => ({ value: r.id, label: r.name }));
  const factionOptions = draft.world.factions.filter((f) => f.name.trim()).map((f) => ({ value: f.id, label: f.name }));
  return (
    <>
      <StepIntro body="Optional. Things that will happen in the world on their own dates, whether you're there or not. News reaches you only through people who could know." title="Timeline" />
      {timeline.map((event) => {
        const set = (patch: Partial<typeof event>) => setTimeline(timeline.map((item) => (item.id === event.id ? { ...item, ...patch } : item)));
        const from = { year: event.from.year, month: event.from.month, day: event.from.day ?? 1, hour: 0, minute: 0 };
        return (
          <ItemCard key={event.id} onRemove={() => setTimeline(timeline.filter((item) => item.id !== event.id))} title={event.title || 'New event'}>
            <Field label="Title" onChange={(title) => set({ title })} value={event.title} />
            <Field label="What happens" multiline lines={3} onChange={(description) => set({ description })} value={event.description} />
            <Text style={styles.label}>When</Text>
            <DateFields onChange={(date) => set({ from: { year: date.year, month: date.month, day: date.day } })} value={from} withTime={false} />
            <Choice label="Where" onChange={(regionId) => set({ regionId })} options={regionOptions} value={event.regionId} />
            <Choice label="Who hears of it" onChange={(knowledge) => set({ knowledge })} options={KNOWLEDGE_OPTIONS} value={event.knowledge ?? 'public'} />
            {event.knowledge === 'faction' ? <Choice label="Which group" onChange={(factionId) => set({ factionId })} options={factionOptions} value={event.factionId} /> : null}
            <Toggle hint="It's offered to you and only happens if you take part." label="Involves you" onChange={(playerDriven) => set({ playerDriven })} value={Boolean(event.playerDriven)} />
            {event.playerDriven ? <Field label="It's done when…" onChange={(completesWhen) => set({ completesWhen })} value={event.completesWhen ?? ''} /> : null}
            <Toggle label="Big news" onChange={(major) => set({ major })} value={Boolean(event.major)} />
          </ItemCard>
        );
      })}
      <AddButton label="Add an event" onPress={() => setTimeline([...timeline, newTimelineEvent(draft.opening.date)])} />
    </>
  );
}

function ReviewStep({ draft, update, goTo }: { draft: WizardDraft; update: Updater; goTo: (step: WizardStep) => void }) {
  const missing = useMemo(() => missingFields(draft), [draft]);
  const w = draft.world;
  const c = draft.character;
  const rows: [WizardStep, string, string][] = [
    ['world', 'World', `${w.name || '—'} · ${w.era.when}, ${w.era.period}`],
    ['places', 'Places & groups', `${w.regions.length} areas · ${w.places.length} places · ${w.factions.length} groups`],
    ['lore', 'Lore', `${w.lore.length} entries`],
    ['you', 'You', c.name ? `${c.name}, ${c.age}${c.role ? ` · ${c.role}` : ''}` : '—'],
    ['backstory', 'Backstory', `${c.backstory.trim() ? `${c.backstory.trim().split(/\s+/).length} words` : 'none'} · ${draft.truths.length} facts · ${c.secrets.length} secrets`],
    ['people', 'People', draft.people.map((p) => p.name).filter(Boolean).join(', ') || 'none yet'],
    ['opening', 'Opening', draft.opening.situation ? `${draft.opening.location || 'somewhere'} · ${draft.opening.situation.slice(0, 80)}` : '—'],
    ['timeline', 'Timeline', `${w.timeline.length} events`],
  ];
  return (
    <>
      <StepIntro body="Check it over. You can change the world and your sheet later too." title="Ready?" />
      <Field label="Story name" onChange={(slotName) => update((d) => ({ ...d, slotName }))} placeholder={w.name || 'My story'} value={draft.slotName} />
      {missing.map((item) => (
        <Pressable key={item.field + item.step} onPress={() => goTo(item.step)}>
          <Text style={styles.missing}>• {item.message}</Text>
        </Pressable>
      ))}
      {rows.map(([step, label, body]) => (
        <Pressable key={step} onPress={() => goTo(step)} style={styles.reviewRow}>
          <Text style={type.rowTitle}>{label}</Text>
          <Text style={type.rowBody}>{body}</Text>
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  stepsBar: { flexGrow: 0, marginTop: spacing.md },
  steps: { gap: spacing.sm, paddingHorizontal: spacing.xl },
  stepPill: { borderColor: colors.border, borderRadius: radius.full, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2 },
  stepPillActive: { backgroundColor: colors.accentSoft, borderColor: colors.accentBorder },
  stepText: { fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted },
  stepTextActive: { color: colors.accentText },
  body: { padding: spacing.xl, paddingBottom: spacing.giant, maxWidth: 720, width: '100%', alignSelf: 'center' },
  intro: { gap: spacing.sm, marginBottom: spacing.xxl },
  footer: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, borderTopColor: colors.divider, borderTopWidth: 1 },
  help: { marginTop: spacing.lg, gap: spacing.sm },
  helpNote: { fontFamily: fonts.regular, fontSize: 12, color: colors.textDim, textAlign: 'center' },
  suggestionLine: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, color: colors.textSoft, marginBottom: spacing.xs },
  suggestionButtons: { flexDirection: 'row', gap: spacing.md, marginVertical: spacing.lg },
  images: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.sm },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.textSoft, marginBottom: spacing.xs },
  missing: { fontFamily: fonts.medium, fontSize: 14, color: colors.warning, marginBottom: spacing.sm },
  reviewRow: { borderBottomColor: colors.divider, borderBottomWidth: 1, paddingVertical: spacing.md, gap: 2 },
});
