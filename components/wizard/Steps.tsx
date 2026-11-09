// The creation wizard's step screens, shared by the wizard (app/new-story.tsx)
// and the world editor during play (app/world-editor.tsx).
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { AddButton, Choice, Field, FieldRow, Hint, ItemCard, ListField, MultiChoice, NumberField, Toggle } from '@/components/Form';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { pickImageFile } from '@/lib/rpg/file';
import { FACE_IMAGE } from '@/lib/rpg/imageCompress';
import { storeImage } from '@/lib/rpg/imageStore';
import { daysBetween, formatDate, shiftDate, todayAt } from '@/lib/rpg/calendar';
import { RELATIONSHIP_STAGES } from '@/lib/rpg/intimacy';
import type { CalendarDate, ClimateType, ContentProfile, ContentTag, IntimacyProfile, PlaceDef, StartingPerson } from '@/lib/rpg/types';
import { CHECK_REASONS, canBeIntimate } from '@/lib/rpg/intimacy';
import {
  CLIMATE_LABELS,
  emptyPerson,
  missingFields,
  newFaction,
  newLore,
  newPlace,
  type HelpSuggestion,
  type WizardDraft,
  type WizardStep,
} from '@/lib/rpg/wizard';

const DAY_OPTIONS = [
  { value: '0', label: 'Today' },
  { value: '1', label: 'Tomorrow' },
  { value: '2', label: 'In 2 days' },
  { value: '3', label: 'In 3 days' },
  { value: '7', label: 'In a week' },
];
const TIME_OPTIONS = [
  { value: '8:30', label: 'Morning' },
  { value: '13:00', label: 'Midday' },
  { value: '17:30', label: 'Late afternoon' },
  { value: '20:00', label: 'Evening' },
  { value: '23:00', label: 'Late night' },
];
const KIND_OPTIONS: { value: PlaceDef['kind']; label: string }[] = [
  { value: 'structure', label: 'Building' },
  { value: 'settlement', label: 'Town or street' },
  { value: 'road', label: 'Road or station' },
  { value: 'wilderness', label: 'Outdoors' },
];
const INTEREST_OPTIONS: { value: IntimacyProfile['interestedInPlayer']; label: string }[] = [
  { value: 'yes', label: 'Drawn to you' },
  { value: 'could-grow', label: 'Could grow' },
  { value: 'no', label: 'Not interested' },
  { value: 'taken', label: 'Heart is taken' },
];
const PACING_OPTIONS: { value: ContentProfile['pacing']; label: string }[] = [
  { value: 'slow-burn', label: 'Slow burn' },
  { value: 'natural', label: 'Natural' },
  { value: 'fast', label: 'Fast' },
];
const WEIGHT_OPTIONS: { value: NonNullable<ContentTag['weight']>; label: string }[] = [
  { value: 'love', label: 'Love' },
  { value: 'like', label: 'Like' },
  { value: 'okay', label: 'Okay' },
];
const LIMIT_OPTIONS: { value: NonNullable<ContentTag['kind']>; label: string }[] = [
  { value: 'hard', label: 'Hard: never, not even mentioned' },
  { value: 'soft', label: 'Soft: only off-page' },
];

export type Updater = (update: (draft: WizardDraft) => WizardDraft) => void;

export function SuggestionCard({ value, onAccept, onDiscard }: { value: HelpSuggestion; onAccept: () => void; onDiscard: () => void }) {
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

export function StepIntro({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.intro}>
      <Text style={type.title}>{title}</Text>
      <Text style={type.body}>{body}</Text>
    </View>
  );
}

/** The story's first moment: a day close to today and a time of day. */
function OpeningTime({ value, onChange }: { value: CalendarDate; onChange: (value: CalendarDate) => void }) {
  const today = todayAt(0, 0);
  const offset = Math.round(daysBetween(today, { ...value, hour: 0, minute: 0, second: 0 }));
  const day = DAY_OPTIONS.some((option) => option.value === String(offset)) ? String(offset) : undefined;
  const time = `${value.hour}:${String(value.minute).padStart(2, '0')}`;
  const setDay = (days: string) => {
    const date = shiftDate(today, Number(days));
    onChange({ ...date, hour: value.hour, minute: value.minute, second: 0 });
  };
  const setTime = (clock: string) => {
    const [hour, minute] = clock.split(':').map(Number);
    onChange({ ...value, hour, minute, second: 0 });
  };
  return (
    <>
      <Choice hint={formatDate(value)} label="When it starts" onChange={setDay} options={DAY_OPTIONS} value={day} />
      <Choice label="Time of day" onChange={setTime} options={TIME_OPTIONS} value={TIME_OPTIONS.some((option) => option.value === time) ? time : undefined} />
      <FieldRow>
        <NumberField label="Hour" onChange={(hour) => onChange({ ...value, hour: clamp(hour ?? 0, 0, 23) })} value={value.hour} />
        <NumberField label="Min" onChange={(minute) => onChange({ ...value, minute: clamp(minute ?? 0, 0, 59) })} value={value.minute} />
      </FieldRow>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function WorldStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const world = draft.world;
  const setWorld = (patch: Partial<typeof world>) => update((d) => ({ ...d, world: { ...d.world, ...patch } }));
  return (
    <>
      <StepIntro body="Where your story happens. It's always today, in the real world: phones, the internet, no magic." title="Your world" />
      <Field
        hint="A real place or one you make up: Lisbon · a small town in Ohio · a seaside city"
        label="Where it's set"
        onChange={(where) => setWorld({ where })}
        value={world.where}
      />
      <Field label="World name" onChange={(name) => setWorld({ name })} required value={world.name} />
      <Field label="Premise" lines={4} multiline onChange={(premise) => setWorld({ premise })} placeholder="A paragraph about this world and what makes it interesting." required value={world.premise} />
      <FieldRow>
        <Field label="Genre" onChange={(genre) => setWorld({ genre })} placeholder="noir crime drama" value={world.genre} />
        <Field label="Tone" onChange={(tone) => setWorld({ tone })} placeholder="warm, slow-burn" value={world.tone} />
      </FieldRow>
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
      <Choice
        hint="Where the story is set: its seasons and weather follow."
        label="Climate"
        onChange={(climate) => setWorld({ climate: climate as ClimateType })}
        options={Object.entries(CLIMATE_LABELS).map(([value, label]) => ({ value, label }))}
        value={world.climate}
      />
      <Toggle hint="Seasons run six months on (summer at Christmas)." label="South of the equator" onChange={(southern) => setWorld({ southern })} value={Boolean(world.southern)} />
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

export function PlacesStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const world = draft.world;
  const setWorld = (patch: Partial<typeof world>) => update((d) => ({ ...d, world: { ...d.world, ...patch } }));

  return (
    <>
      <StepIntro body="The places in your story (home, work, the bar, someone's apartment) and the groups that matter. Getting around is just narrated." title="Places & groups" />
      <Text style={type.sectionLabel}>Places</Text>
      {world.places.map((place) => {
        const setPlace = (patch: Partial<typeof place>) => setWorld({ places: world.places.map((item) => (item.id === place.id ? { ...item, ...patch } : item)) });
        return (
          <ItemCard key={place.id} onRemove={() => setWorld({ places: world.places.filter((item) => item.id !== place.id) })} title={place.name || 'New place'}>
            <Field label="Name" onChange={(name) => setPlace({ name })} value={place.name} />
            <Choice label="Kind" onChange={(kind) => setPlace({ kind })} options={KIND_OPTIONS} value={place.kind} />
            <Field label="Description" multiline lines={2} onChange={(description) => setPlace({ description })} value={place.description} />
            <Field hint="Optional." label="Who lives or works there" onChange={(who) => setPlace({ who })} placeholder="Sam works the bar most nights" value={place.who ?? ''} />
          </ItemCard>
        );
      })}
      <AddButton label="Add a place" onPress={() => setWorld({ places: [...world.places, newPlace()] })} />

      <Text style={type.sectionLabel}>Groups</Text>
      <Hint>Any group that matters: a workplace, a family, a friend group, a band.</Hint>
      {world.factions.map((faction) => {
        const setFaction = (patch: Partial<typeof faction>) => setWorld({ factions: world.factions.map((item) => (item.id === faction.id ? { ...item, ...patch } : item)) });
        return (
          <ItemCard key={faction.id} onRemove={() => setWorld({ factions: world.factions.filter((item) => item.id !== faction.id) })} title={faction.name || 'New group'}>
            <Field label="Name" onChange={(name) => setFaction({ name })} value={faction.name} />
            <Field label="Description" multiline lines={2} onChange={(description) => setFaction({ description })} value={faction.description} />
          </ItemCard>
        );
      })}
      <AddButton label="Add a group" onPress={() => setWorld({ factions: [...world.factions, newFaction()] })} />
    </>
  );
}

export function LoreStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
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

export function YouStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
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
      <Field hint="Where you live: a flat, a house, a dorm room." label="Home" onChange={(home) => set({ home })} placeholder="a small flat above a bakery" value={c.home ?? ''} />
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

export function BackstoryStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
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

export function IntimacyFields({ person, set }: { person: StartingPerson; set: (patch: Partial<StartingPerson>) => void }) {
  const profile = person.intimacy;
  const setProfile = (patch: Partial<IntimacyProfile>) => set({ intimacy: { ...(profile ?? { orientation: '', interestedInPlayer: 'could-grow', desires: [], boundaries: [] }), ...patch } });
  const check = canBeIntimate({ age: person.age, appearance: person.appearance, role: person.role, personality: person.personality, realPerson: person.realPerson });
  return (
    <>
      <Toggle hint="A real, identifiable person (a celebrity, someone you know). They can appear, but never in an intimate scene." label="Real person" onChange={(realPerson) => set({ realPerson })} value={Boolean(person.realPerson)} />
      <Toggle
        hint="Their own desires and boundaries. Needs a stated age of 18 or older."
        label="Can be part of intimate scenes"
        onChange={(on) => set({ intimacy: on ? { orientation: '', interestedInPlayer: 'could-grow', desires: [], boundaries: [] } : undefined })}
        value={Boolean(profile)}
      />
      {profile ? (
        <View style={styles.nested}>
          {!check.ok ? <Text style={styles.missing}>{person.name || 'This person'} {CHECK_REASONS[check.reason]}: they can't be part of intimate scenes until that changes.</Text> : null}
          <Field label="Drawn to" onChange={(orientation) => setProfile({ orientation })} placeholder="men, women, anyone…" value={profile.orientation} />
          <Choice label="Toward you" onChange={(interestedInPlayer) => setProfile({ interestedInPlayer })} options={INTEREST_OPTIONS} value={profile.interestedInPlayer} />
          {profile.interestedInPlayer === 'taken' ? <Field label="Whose heart is it" onChange={(devotion) => setProfile({ devotion })} value={profile.devotion ?? ''} /> : null}
          <ListField label="What they like" onChange={(desires) => setProfile({ desires })} values={profile.desires} />
          <ListField hint="One per line. Empty means none written: the narrator plays them from their personality." label="What they won't do" onChange={(boundaries) => setProfile({ boundaries })} values={profile.boundaries} />
          <FieldRow>
            <Field label="Style" onChange={(style) => setProfile({ style })} placeholder="shy, bold, teasing, tender…" value={profile.style ?? ''} />
            <Field label="Experience" onChange={(experience) => setProfile({ experience })} value={profile.experience ?? ''} />
          </FieldRow>
        </View>
      ) : null}
    </>
  );
}

export function TagList({
  title,
  tags,
  onChange,
  kind,
}: {
  title: string;
  tags: ContentTag[];
  onChange: (tags: ContentTag[]) => void;
  kind: 'interest' | 'limit';
}) {
  return (
    <>
      <Text style={type.sectionLabel}>{title}</Text>
      {tags.map((tag, i) => {
        const set = (patch: Partial<ContentTag>) => onChange(tags.map((item, j) => (j === i ? { ...item, ...patch } : item)));
        return (
          <ItemCard key={i} onRemove={() => onChange(tags.filter((_, j) => j !== i))} title={tag.label || (kind === 'interest' ? 'New interest' : 'New limit')}>
            <Field label={kind === 'interest' ? 'What you want more of' : 'What it is'} onChange={(label) => set({ label })} value={tag.label} />
            <Field label="Note (optional)" onChange={(note) => set({ note })} value={tag.note ?? ''} />
            {kind === 'interest' ? (
              <Choice label="How much" onChange={(weight) => set({ weight })} options={WEIGHT_OPTIONS} value={tag.weight ?? 'like'} />
            ) : (
              <Choice label="Kind" onChange={(value) => set({ kind: value })} options={LIMIT_OPTIONS} value={tag.kind ?? 'hard'} />
            )}
          </ItemCard>
        );
      })}
      <AddButton label={kind === 'interest' ? 'Add an interest' : 'Add a limit'} onPress={() => onChange([...tags, kind === 'interest' ? { label: '', weight: 'like' } : { label: '', kind: 'hard' }])} />
    </>
  );
}

export function IntimacyStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const c = draft.content;
  const set = (patch: Partial<ContentProfile>) => update((d) => ({ ...d, content: { ...d.content, ...patch } }));
  const player = draft.character;
  const check = canBeIntimate({ age: player.age, appearance: player.appearance, role: player.role, personality: player.personality });
  if (!check.ok) {
    return (
      <>
        <StepIntro body="Romance and sex in your story." title="Intimacy" />
        <Text style={styles.missing}>Your character {CHECK_REASONS[check.reason]}. Give them an age of 18 or older on the You step to set this up.</Text>
      </>
    );
  }
  return (
    <>
      <StepIntro
        body="Romance and sex are part of this story, built up over time like anything else. Scenes are written fully explicit. Everything here is optional and yours: an empty list means nothing is off the table. You can change it later."
        title="Intimacy"
      />
      <Choice hint="How fast relationships move. The story only moves a step when a scene shows it." label="Pacing" onChange={(pacing) => set({ pacing })} options={PACING_OPTIONS} value={c.pacing} />
      <TagList kind="interest" onChange={(interests) => set({ interests })} tags={c.interests} title="What you want more of" />
      <TagList kind="limit" onChange={(limits) => set({ limits })} tags={c.limits} title="Your limits" />
      <Field hint="Free text: lush and slow, blunt and short…" label="Narrator voice for these scenes" onChange={(narratorVoice) => set({ narratorVoice })} value={c.narratorVoice ?? ''} />
      <Toggle hint={'Keeps intimate details out of "previously…" recaps and summaries.'} label="Keep recaps vague" onChange={(vagueRecaps) => set({ vagueRecaps })} value={c.vagueRecaps} />
      <Hint>Two rules always hold and can't be changed: everyone in an intimate scene is an adult (18+), and never a real person.</Hint>
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
      <IntimacyFields person={person} set={set} />
      <Toggle label="Alive" hint="Off: they died before the story starts." onChange={(alive) => set({ alive })} value={person.alive} />
      <Toggle label="You know their name" onChange={(knownName) => set({ knownName })} value={person.knownName} />
      <Toggle label="You've met before" onChange={(met) => set({ met })} value={person.met !== false} />
      <Toggle hint="A partner, a roommate: they share your home." label="Lives with you" onChange={(livesWithYou) => set({ livesWithYou })} value={Boolean(person.livesWithYou)} />
      <Field label="Where they are now" onChange={(whereabouts) => set({ whereabouts })} value={person.whereabouts ?? ''} />
      <ListField label="Their secrets" onChange={(secrets) => set({ secrets })} values={person.secrets} />
    </>
  );
}

export function PeopleStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
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

export function OpeningStep({ draft, update }: { draft: WizardDraft; update: Updater }) {
  const o = draft.opening;
  const set = (patch: Partial<typeof o>) => update((d) => ({ ...d, opening: { ...d.opening, ...patch } }));
  const placeOptions = draft.world.places.filter((place) => place.name.trim()).map((place) => ({ value: place.name, label: place.name }));
  const castOptions = draft.people.filter((p) => p.name.trim() && p.alive).map((p) => ({ value: p.name, label: p.name }));
  return (
    <>
      <StepIntro body="Where you are and what's happening on the first page." title="Opening" />
      {placeOptions.length > 0 ? <Choice label="Pick a place" onChange={(location) => set({ location })} options={placeOptions} value={o.location} /> : null}
      <Field label="Where you are" onChange={(location) => set({ location })} value={o.location} />
      <OpeningTime onChange={(date) => set({ date })} value={o.date} />
      <Field label="What's happening" lines={5} multiline onChange={(situation) => set({ situation })} required value={o.situation} />
      <MultiChoice label="Who's there" onChange={(castNames) => set({ castNames })} options={castOptions} values={o.castNames} />
      <ListField hint="One per line. Each becomes an open thread the story follows." label="Starting goals" onChange={(threads) => set({ threads })} values={o.threads} />
    </>
  );
}

export function ReviewStep({ draft, update, goTo }: { draft: WizardDraft; update: Updater; goTo: (step: WizardStep) => void }) {
  const missing = useMemo(() => missingFields(draft), [draft]);
  const w = draft.world;
  const c = draft.character;
  const rows: [WizardStep, string, string][] = [
    ['world', 'World', `${w.name || '—'}${w.where ? ` · ${w.where}` : ''}`],
    ['places', 'Places & groups', `${w.places.length} places · ${w.factions.length} groups`],
    ['lore', 'Lore', `${w.lore.length} entries`],
    ['you', 'You', c.name ? `${c.name}, ${c.age}${c.role ? ` · ${c.role}` : ''}` : '—'],
    ['intimacy', 'Intimacy', `${draft.content.pacing} · ${draft.content.interests.length} interests · ${draft.content.limits.length} limits`],
    ['backstory', 'Backstory', `${c.backstory.trim() ? `${c.backstory.trim().split(/\s+/).length} words` : 'none'} · ${draft.truths.length} facts · ${c.secrets.length} secrets`],
    ['people', 'People', draft.people.map((p) => p.name).filter(Boolean).join(', ') || 'none yet'],
    ['opening', 'Opening', draft.opening.situation ? `${draft.opening.location || 'somewhere'} · ${draft.opening.situation.slice(0, 80)}` : '—'],
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

export const wizardStyles = StyleSheet.create({

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
  nested: { borderLeftColor: colors.accentBorder, borderLeftWidth: 2, paddingLeft: spacing.md, marginBottom: spacing.md },
  reviewRow: { borderBottomColor: colors.divider, borderBottomWidth: 1, paddingVertical: spacing.md, gap: 2 },
});

const styles = wizardStyles;
