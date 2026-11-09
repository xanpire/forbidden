// The world editor during play: change the world, your sheet and your
// intimacy settings, add a person by hand, and keep the world as a template.
// Saved edits take effect on the next turn.
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { X } from 'lucide-react-native';

import { AppButton } from '@/components/AppButton';
import { ItemCard, Toggle } from '@/components/Form';
import { useToast } from '@/components/Toast';
import {
  IntimacyStep,
  LoreStep,
  PersonFields,
  PlacesStep,
  StepIntro,
  WorldStep,
  YouStep,
  wizardStyles as styles,
  type Updater,
} from '@/components/wizard/Steps';
import { type } from '@/constants/theme';
import { downloadJson, pickJsonFile } from '@/lib/rpg/file';
import { useGame } from '@/lib/rpg/game';
import { emptyPerson, saveDraft, type WizardDraft } from '@/lib/rpg/wizard';
import {
  addPersonToSave,
  applyCharacterEdit,
  applyContentEdit,
  applyWorldEdit,
  deleteTemplate,
  draftFromSave,
  draftFromTemplate,
  exportTemplate,
  importTemplate,
  loadTemplates,
  saveWorldAsTemplate,
  type WorldTemplate,
} from '@/lib/rpg/worldEdit';
import type { StartingPerson } from '@/lib/rpg/types';

const TABS = ['world', 'places', 'lore', 'you', 'intimacy', 'person', 'templates'] as const;
type Tab = (typeof TABS)[number];
const LABELS: Record<Tab, string> = {
  world: 'World',
  places: 'Places',
  lore: 'Lore',
  you: 'You',
  intimacy: 'Intimacy',
  person: 'Add a person',
  templates: 'Templates',
};

export default function WorldEditorScreen() {
  const { db, changeSave } = useGame();
  const { showToast } = useToast();
  const [draft, setDraft] = useState<WizardDraft | null>(null);
  const [tab, setTab] = useState<Tab>('world');
  const [person, setPerson] = useState<StartingPerson>({ ...emptyPerson(), met: true });
  const [templates, setTemplates] = useState<WorldTemplate[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (db && !draft) setDraft(draftFromSave(db));
  }, [db, draft]);
  useEffect(() => {
    void loadTemplates().then(setTemplates);
  }, []);

  if (!db || !draft) return <SafeAreaView style={styles.root} />;

  const update: Updater = (fn) => setDraft((current) => (current ? fn(current) : current));
  const close = () => (router.canGoBack() ? router.back() : router.replace('/you'));

  const save = async () => {
    setSaving(true);
    try {
      await changeSave((latest) => applyContentEdit(applyCharacterEdit(applyWorldEdit(latest, draft.world), draft.character), draft.content));
      showToast('Saved. It counts from your next turn.', 'success');
      close();
    } finally {
      setSaving(false);
    }
  };

  const addPerson = async () => {
    if (!person.name.trim()) {
      showToast('Give them a name.', 'error');
      return;
    }
    await changeSave((latest) => addPersonToSave(latest, person));
    showToast(`${person.name.trim()} is in your story now.`, 'success');
    setPerson({ ...emptyPerson(), met: true });
  };

  const refreshTemplates = async () => setTemplates(await loadTemplates());

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.root}>
      <View style={styles.header}>
        <Text style={type.pageTitle}>Your world</Text>
        <Pressable accessibilityLabel="Close without saving" accessibilityRole="button" hitSlop={12} onPress={close}>
          <X color="#A3A3A3" size={22} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.steps} horizontal showsHorizontalScrollIndicator={false} style={styles.stepsBar}>
        {TABS.map((item) => (
          <Pressable key={item} onPress={() => setTab(item)} style={[styles.stepPill, item === tab && styles.stepPillActive]}>
            <Text style={[styles.stepText, item === tab && styles.stepTextActive]}>{LABELS[item]}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {tab === 'world' ? <WorldStep draft={draft} update={update} /> : null}
          {tab === 'places' ? <PlacesStep draft={draft} update={update} /> : null}
          {tab === 'lore' ? <LoreStep draft={draft} update={update} /> : null}
          {tab === 'you' ? <YouStep draft={draft} update={update} /> : null}
          {tab === 'intimacy' ? <IntimacyStep draft={draft} update={update} /> : null}
          {tab === 'person' ? (
            <>
              <StepIntro body="Someone who should exist in your story now. They're added straight away." title="Add a person" />
              <ItemCard title={person.name || 'New person'}>
                <PersonFields person={person} set={(patch) => setPerson((current) => ({ ...current, ...patch }))} />
              </ItemCard>
              <Toggle hint="Off: they exist in the world, but you haven't met them yet." label="You know them already" onChange={(met) => setPerson((current) => ({ ...current, met }))} value={person.met !== false} />
              <AppButton label="Add to the story" onPress={() => void addPerson()} />
            </>
          ) : null}
          {tab === 'templates' ? (
            <>
              <StepIntro body="Keep this world (only the world: no character, no story) to start other stories in it, or share it as a file." title="World templates" />
              <AppButton
                label="Save this world as a template"
                onPress={() =>
                  void saveWorldAsTemplate(applyWorldEdit(db, draft.world).world).then(async (template) => {
                    await refreshTemplates();
                    showToast(`Saved "${template.name}".`, 'success');
                  })
                }
              />
              <View style={{ height: 12 }} />
              <AppButton
                label="Import a world file"
                onPress={() =>
                  void pickJsonFile()
                    .then(importTemplate)
                    .then(async (template) => {
                      await refreshTemplates();
                      showToast(`Imported "${template.name}".`, 'success');
                    })
                    .catch((error: unknown) => showToast(error instanceof Error ? error.message : 'Could not import that file.', 'error'))
                }
                variant="secondary"
              />
              <View style={{ height: 16 }} />
              {templates.map((template) => (
                <ItemCard key={template.id} onRemove={() => void deleteTemplate(template.id).then(refreshTemplates)} title={template.name}>
                  <Text style={type.rowBody}>{template.world.premise || template.world.where}</Text>
                  <View style={{ flexDirection: 'row', gap: 12, marginVertical: 12 }}>
                    <AppButton
                      compact
                      label="New story here"
                      onPress={() => void saveDraft(draftFromTemplate(template)).then(() => router.push('/new-story'))}
                      style={styles.flex}
                    />
                    <AppButton compact label="Export" onPress={() => downloadJson(`${template.name}.world.json`, exportTemplate(template))} style={styles.flex} variant="secondary" />
                  </View>
                </ItemCard>
              ))}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {tab !== 'person' && tab !== 'templates' ? (
        <View style={styles.footer}>
          <AppButton label="Cancel" onPress={close} style={styles.flex} variant="secondary" />
          <AppButton label="Save changes" loading={saving} onPress={() => void save()} style={styles.flex} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}
