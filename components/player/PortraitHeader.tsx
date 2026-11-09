import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { RefreshCw, X } from 'lucide-react-native';

import { useToast } from '@/components/Toast';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { generateImage } from '@/lib/openrouter';
import { beginPainting, endPainting, portraitKey } from '@/lib/rpg/characterPortrait';
import { recordDebugImage } from '@/lib/rpg/debug';
import { calculateAge, formatDayMonth } from '@/lib/rpg/calendar';
import { playerAge, playerName } from '@/lib/rpg/player';
import { useGame } from '@/lib/rpg/game';
import { loadImage, useStoredImage } from '@/lib/rpg/imageStore';
import {
  buildPortraitPrompt,
  latestPortrait,
  portraitSignature,
  portraitStaleReason,
  portraitTag,
} from '@/lib/rpg/portrait';
import { ensureImageCaps } from '@/lib/rpg/imageCaps';
import {
  faceDroppedWarning,
  loadPlayerReferenceImages,
  planReferences,
} from '@/lib/rpg/referenceImages';
import type { PortraitRecord } from '@/lib/rpg/types';

/** Empty frame until the player's first portrait is painted. */
function EmptyPortrait() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>No portrait yet</Text>
    </View>
  );
}

function PortraitImage({ value, width, height }: { value: string | null; width: number; height: number }) {
  const uri = useStoredImage(value);

  if (!value) {
    return <EmptyPortrait />;
  }

  if (!uri) {
    return <ActivityIndicator color={colors.textDim} size="small" />;
  }

  return <Image resizeMode="cover" source={{ uri }} style={StyleSheet.absoluteFill} />;
}

function Thumb({
  portrait,
  tag,
  onOpen,
}: {
  portrait: PortraitRecord;
  tag: string;
  onOpen: (portrait: PortraitRecord) => void;
}) {
  return (
    <Pressable
      accessibilityLabel={`Portrait at age ${portrait.signature.age}, ${formatDayMonth(portrait.inStoryDate)}`}
      accessibilityRole="imagebutton"
      onPress={() => onOpen(portrait)}
      style={({ pressed }) => [styles.thumb, pressed && styles.pressed]}
    >
      <PortraitImage height={58} value={portrait.image} width={44} />
      <View style={styles.thumbTag}>
        <Text style={styles.thumbTagText}>{tag}</Text>
      </View>
    </Pressable>
  );
}

export function PortraitHeader() {
  const { db, apiKey, addPortrait, updateSettings } = useGame();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<PortraitRecord | null>(null);
  const viewingUri = useStoredImage(viewing?.image ?? null);

  const latest = db ? latestPortrait(db) : null;
  const signature = useMemo(() => (db ? portraitSignature(db) : null), [db]);
  const staleReason = signature ? portraitStaleReason(latest, signature) : null;
  const history = useMemo(() => [...(db?.portraits ?? [])], [db?.portraits]);

  const refresh = useCallback(async () => {
    if (!db || !signature || busy) {
      return;
    }

    if (!apiKey) {
      showToast('Add your OpenRouter key in Settings first.', 'error');
      return;
    }

    if (latest && JSON.stringify(latest.signature) === JSON.stringify(signature)) {
      showToast('Your portrait already shows you as you are now.');
      return;
    }

    const lock = portraitKey('player', signature);

    if (!beginPainting(lock)) {
      return;
    }

    setBusy(true);

    try {
      const [caps, playerRefImages] = await Promise.all([
        ensureImageCaps(db, updateSettings),
        loadPlayerReferenceImages(db),
      ]);
      const previous = latest ? await loadImage(latest.image) : null;
      const plan = planReferences(
        [
          { kind: 'face', uri: playerRefImages.face },
          { kind: 'outfit', uri: playerRefImages.outfit },
          { kind: 'previous', uri: previous ?? '' },
        ],
        caps.maxReferences
      );

      if (plan.faceDropped) {
        showToast(faceDroppedWarning(plan.faceDropped, caps.modelId), 'error');
      }

      const startedAt = Date.now();
      const result = await generateImage({
        apiKey,
        caps,
        prompt: buildPortraitPrompt(db, signature, plan.references),
        inputReferences: plan.references.map((reference) => reference.uri),
        aspectRatio: '3:4',
      });
      recordDebugImage(null, 'portrait', caps.modelId, result.cost, Date.now() - startedAt);
      await addPortrait(result.dataUri, signature);
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'The portrait wouldn’t paint. Try again.', 'error');
    } finally {
      endPainting(lock);
      setBusy(false);
    }
  }, [addPortrait, apiKey, busy, db, latest, showToast, signature, updateSettings]);

  if (!db) {
    return null;
  }

  const age = playerAge(db);
  const stale = Boolean(staleReason);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Open current portrait"
          accessibilityRole="imagebutton"
          disabled={!latest}
          onPress={() => latest && setViewing(latest)}
          style={styles.portrait}
        >
          <PortraitImage height={138} value={latest?.image ?? null} width={104} />
          {busy ? (
            <View style={styles.painting}>
              <Text style={styles.paintingText}>Painting…</Text>
            </View>
          ) : null}
        </Pressable>

        <View style={styles.info}>
          <Text style={type.pageTitle}>{playerName(db)}</Text>
          <Text style={styles.role}>
            Age {age} · {db.state.player.role}
          </Text>
          <Text numberOfLines={2} style={type.rowMeta}>
            {db.state.mood}
          </Text>
          <View style={styles.spacer} />
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: stale ? colors.warning : colors.success }]} />
            <Text numberOfLines={1} style={[styles.statusText, stale && styles.statusStale]}>
              {busy
                ? 'Painting a new portrait…'
                : stale
                  ? latest
                    ? `You’ve changed · ${staleReason}`
                    : staleReason
                  : `Painted ${formatDayMonth(latest!.inStoryDate)}`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="Refresh portrait"
            accessibilityRole="button"
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={() => void refresh()}
            style={({ pressed }) => [
              styles.refresh,
              stale ? styles.refreshPrimary : styles.refreshQuiet,
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={colors.text} size="small" />
            ) : (
              <RefreshCw color={stale ? colors.onAccent : colors.textSoft} size={15} strokeWidth={2} />
            )}
            <Text style={[styles.refreshLabel, !stale && styles.refreshLabelQuiet]}>
              {latest ? 'Repaint' : 'Paint portrait'}
            </Text>
          </Pressable>
        </View>
      </View>

      {history.length > 0 ? (
        <View style={styles.historyRow}>
          <Text style={type.sectionLabel}>Portraits</Text>
          <ScrollView
            contentContainerStyle={styles.historyList}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {history
              .map((portrait, index) => ({ portrait, tag: portraitTag(portrait, index, history) }))
              .reverse()
              .map(({ portrait, tag }) => (
                <Thumb key={portrait.id} onOpen={setViewing} portrait={portrait} tag={tag} />
              ))}
          </ScrollView>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setViewing(null)}
        transparent
        visible={Boolean(viewing)}
      >
        <View style={styles.viewer}>
          <Pressable
            accessibilityLabel="Close portrait"
            onPress={() => setViewing(null)}
            style={StyleSheet.absoluteFill}
          />
          {viewingUri ? (
            <Image resizeMode="contain" source={{ uri: viewingUri }} style={styles.viewerImage} />
          ) : (
            <ActivityIndicator color={colors.textDim} />
          )}
          {viewing ? (
            <Text style={styles.viewerCaption}>
              Age {viewing.signature.age} · {formatDayMonth(viewing.inStoryDate)} · {viewing.location}
            </Text>
          ) : null}
          <Pressable
            accessibilityLabel="Close portrait"
            accessibilityRole="button"
            onPress={() => setViewing(null)}
            style={({ pressed }) => [styles.viewerClose, pressed && styles.pressed]}
          >
            <X color={colors.text} size={20} strokeWidth={2} />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
  },
  emptyText: {
    color: colors.textMeta,
    fontFamily: fonts.medium,
    fontSize: 11,
    textAlign: 'center',
  },
  wrap: {
    gap: 14,
  },
  header: {
    flexDirection: 'row',
    gap: 14,
  },
  portrait: {
    width: 104,
    height: 138,
    borderRadius: 14,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  painting: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5, 5, 5, 0.72)',
  },
  paintingText: {
    fontFamily: fonts.bold,
    fontSize: 11,
    color: colors.text,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  role: {
    ...type.rowBody,
    color: colors.textMuted,
  },
  spacer: {
    flex: 1,
    minHeight: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    flex: 1,
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMeta,
  },
  statusStale: {
    color: colors.warning,
  },
  refresh: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 40,
    marginTop: 6,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  refreshPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  refreshQuiet: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  refreshLabel: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.onAccent,
  },
  refreshLabelQuiet: {
    color: colors.textSoft,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  historyList: {
    gap: spacing.sm,
  },
  thumb: {
    width: 44,
    height: 58,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  thumbTag: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 2,
    backgroundColor: 'rgba(5, 5, 5, 0.78)',
  },
  thumbTagText: {
    fontFamily: fonts.bold,
    fontSize: 9,
    textAlign: 'center',
    color: colors.textSoft,
  },
  pressed: {
    opacity: 0.65,
  },
  disabled: {
    opacity: 0.6,
  },
  viewer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
  },
  viewerImage: {
    width: '100%',
    flex: 1,
  },
  viewerCaption: {
    ...type.rowMeta,
    textAlign: 'center',
  },
  viewerClose: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
});
