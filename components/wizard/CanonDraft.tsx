// "Draft from canon": the AI drafts cast, groups, places, timeline and lore
// for a known grounded setting; the player accepts each item or skips it.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Field, ItemCard, MultiChoice, Toggle } from '@/components/Form';
import { useToast } from '@/components/Toast';
import { colors, fonts, spacing, type } from '@/constants/theme';
import { completeChat } from '@/lib/openrouter';
import { CANON_KINDS, CANON_LABELS, acceptCanonItem, canonDraftMessages, parseCanonDraft, type CanonItem, type CanonKind } from '@/lib/rpg/canonDraft';
import { useGame } from '@/lib/rpg/game';
import type { WizardDraft } from '@/lib/rpg/wizard';

export function CanonDraftPanel({ draft, update }: { draft: WizardDraft; update: (fn: (d: WizardDraft) => WizardDraft) => void }) {
  const { apiKey, db } = useGame();
  const { showToast } = useToast();
  const [kinds, setKinds] = useState<string[]>(['cast', 'timeline']);
  const [startPoint, setStartPoint] = useState('');
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<CanonItem[]>([]);
  const setting = draft.world.knownUniverse?.name?.trim();

  if (!setting) return null;

  const run = async () => {
    if (!apiKey) {
      showToast('Add your OpenRouter key in Settings first.', 'error');
      return;
    }
    setBusy(true);
    const found: CanonItem[] = [];
    // Areas and groups first, so places and events can link to them by name.
    const ordered = CANON_KINDS.filter((kind) => kinds.includes(kind)).sort((a, b) => ['places', 'factions', 'cast', 'timeline', 'lore'].indexOf(a) - ['places', 'factions', 'cast', 'timeline', 'lore'].indexOf(b));
    try {
      for (const kind of ordered as CanonKind[]) {
        const request = { kind, setting, startPoint: startPoint.trim() || draft.world.era.period, personalBeats: personal };
        const reply = await completeChat({
          apiKey,
          model: db?.settings.summaryModel ?? 'google/gemini-2.5-flash',
          messages: canonDraftMessages(request, draft),
          temperature: 0.4,
          maxTokens: 2400,
          responseFormatJson: true,
        });
        const parsed = parseCanonDraft(request, reply.text, draft);
        if (parsed.error) {
          showToast(parsed.error, 'error');
          break;
        }
        found.push(...parsed.items);
        setItems([...found]);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The draft failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const accept = (item: CanonItem) => {
    update((d) => acceptCanonItem(d, item));
    setItems((current) => current.filter((other) => other !== item));
  };

  return (
    <View style={styles.panel}>
      <Text style={type.heading}>Draft from {setting}</Text>
      <Text style={type.rowMeta}>Optional. Drafts are suggestions in the normal editors: use what you like, skip the rest. Grounded only; real people are background only and never intimate; everyone drafted is an adult.</Text>
      <MultiChoice label="What to draft" onChange={setKinds} options={CANON_KINDS.map((kind) => ({ value: kind, label: CANON_LABELS[kind] }))} values={kinds} />
      <Field hint="When in the setting the story starts." label="Start point" onChange={setStartPoint} placeholder={draft.world.era.period} value={startPoint} />
      <Toggle hint="Beats offered to you that only happen if you take part." label="Include personal beats in the timeline" onChange={setPersonal} value={personal} />
      <AppButton disabled={kinds.length === 0} label="Draft it" loading={busy} loadingLabel="Drafting…" onPress={() => void run()} variant="secondary" />
      {items.length > 0 ? (
        <>
          <View style={styles.row}>
            <AppButton compact label={`Use all (${items.length})`} onPress={() => items.forEach(accept)} style={styles.flex} />
            <AppButton compact label="Skip all" onPress={() => setItems([])} style={styles.flex} variant="ghost" />
          </View>
          {items.map((item, index) => (
            <ItemCard key={`${item.kind}-${index}-${item.label}`} title={item.label}>
              <Text style={styles.kind}>{item.kind === 'event' ? 'Timeline' : item.kind === 'person' ? 'Person' : item.kind === 'region' ? 'Area' : item.kind === 'place' ? 'Place' : item.kind === 'faction' ? 'Group' : 'Lore'}</Text>
              <View style={styles.row}>
                <AppButton compact label="Skip" onPress={() => setItems((current) => current.filter((other) => other !== item))} style={styles.flex} variant="ghost" />
                <AppButton compact label="Use" onPress={() => accept(item)} style={styles.flex} />
              </View>
            </ItemCard>
          ))}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderColor: colors.border, borderRadius: 16, borderWidth: 1, gap: spacing.sm, marginBottom: spacing.xl, padding: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  flex: { flex: 1 },
  kind: { color: colors.textDim, fontFamily: fonts.medium, fontSize: 12, marginBottom: spacing.sm },
});
