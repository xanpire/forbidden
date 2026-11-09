// "Picture this": an explicit picture of the current intimate scene, on demand
// only. The player picks from fixed lists; nothing typed reaches the prompt.
import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { Choice, MultiChoice } from '@/components/Form';
import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import {
  CLOTHING,
  EXPLICIT_PROVIDERS,
  FRAMINGS,
  POSITIONS,
  SETTINGS_LIST,
  SHOTS,
  addExplicitImage,
  addExplicitRef,
  checkShot,
  defaultShot,
  missingReferences,
  type ExplicitShot,
} from '@/lib/rpg/explicitImages';
import { useGame } from '@/lib/rpg/game';
import { storeImage } from '@/lib/rpg/imageStore';
import { displayName } from '@/lib/rpg/names';
import { paintExplicit, paintReferenceSheet } from '@/lib/rpg/paintExplicit';

const options = <T extends Record<string, string>>(record: T) =>
  (Object.keys(record) as (keyof T & string)[]).map((value) => ({ value, label: record[value] }));

export function ExplicitSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { db, apiKey, changeSave, updateSettings } = useGame();
  const { showToast } = useToast();
  const [shot, setShot] = useState<ExplicitShot | null>(null);
  const [busy, setBusy] = useState<'refs' | 'paint' | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const current = shot ?? (db ? defaultShot(db) : null);
  const people = useMemo(() => {
    if (!db) return [];
    const ids = new Set([...(db.state.sceneMode?.intimateWith ?? []), ...db.entities.filter((e) => e.tags.includes('player')).map((e) => e.id)]);
    return db.entities.filter((entity) => ids.has(entity.id)).map((entity) => ({ value: entity.id, label: displayName(db, entity) }));
  }, [db]);

  if (!db || !current) return null;
  const check = checkShot(db, current);
  const missing = missingReferences(db, current.castIds);
  const provider = db.settings.explicitProvider ?? 'runware';
  const set = (patch: Partial<ExplicitShot>) => setShot({ ...current, ...patch });

  const makeReferences = async () => {
    setBusy('refs');
    try {
      for (const entity of missing) {
        const image = await paintReferenceSheet(db, entity.id, apiKey, updateSettings);
        const stored = await storeImage(image);
        await changeSave((latest) => addExplicitRef(latest, entity.id, stored));
      }
      showToast('Reference sheets ready.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not make the reference sheets.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const paint = async () => {
    setBusy('paint');
    setResult(null);
    try {
      const painted = await paintExplicit(db, current, provider);
      const stored = await storeImage(painted.dataUri);
      await changeSave((latest) => addExplicitImage(latest, { image: stored, shot: current, provider, model: painted.model, cost: painted.cost }));
      setResult(painted.dataUri);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'The picture failed.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={styles.sheet} style={styles.sheetOuter}>
          <Text style={type.pageTitle}>Picture this</Text>
          <Text style={type.rowMeta}>
            {EXPLICIT_PROVIDERS.find((item) => item.id === provider)?.label} · pick from the lists; the story's words are never sent.
          </Text>
          {result ? <Image accessibilityLabel="The new picture" resizeMode="contain" source={{ uri: result }} style={styles.result} /> : null}
          <MultiChoice label="Who's in it" onChange={(castIds) => set({ castIds: castIds.slice(0, 3) })} options={people} values={current.castIds} />
          <Choice label="What" onChange={(position) => set({ position })} options={options(POSITIONS)} value={current.position} />
          <Choice label="Clothes" onChange={(clothing) => set({ clothing })} options={options(CLOTHING)} value={current.clothing} />
          <Choice label="Where" onChange={(setting) => set({ setting })} options={options(SETTINGS_LIST)} value={current.setting} />
          <Choice label="Framing" onChange={(framing) => set({ framing })} options={options(FRAMINGS)} value={current.framing} />
          <Choice label="Camera" onChange={(value) => set({ shot: value })} options={options(SHOTS)} value={current.shot} />
          {!check.ok ? <Text style={styles.blocked}>Can't make this picture: {check.reason}.</Text> : null}
          {check.ok && missing.length > 0 ? (
            <AppButton
              label={`Make reference sheets first (${missing.map((entity) => displayName(db, entity)).join(', ')})`}
              loading={busy === 'refs'}
              onPress={() => void makeReferences()}
              variant="secondary"
            />
          ) : null}
          <View style={styles.row}>
            <AppButton label="Close" onPress={onClose} style={styles.flex} variant="secondary" />
            <AppButton disabled={!check.ok || busy !== null} label={result ? 'Another one' : 'Paint it'} loading={busy === 'paint'} onPress={() => void paint()} style={styles.flex} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheetOuter: { maxHeight: '92%', backgroundColor: colors.surfaceRaised, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl },
  sheet: { padding: spacing.xl, gap: spacing.sm, maxWidth: 680, width: '100%', alignSelf: 'center' },
  result: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.surface, marginVertical: spacing.sm },
  blocked: { color: colors.warning, fontFamily: fonts.medium, fontSize: 13 },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  flex: { flex: 1 },
});
