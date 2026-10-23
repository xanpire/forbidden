import { Check, CircleAlert, RefreshCw, Search, Sparkles, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppButton } from '@/components/AppButton';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import {
  FALLBACK_MODELS,
  fetchNarratorModels,
  modelMeta,
  type OpenRouterModel,
} from '@/lib/openrouter';

type ModelPickerModalProps = {
  visible: boolean;
  selectedId: string;
  onClose: () => void;
  onSelect: (model: { id: string; name: string }) => void;
};

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export function ModelPickerModal({
  visible,
  selectedId,
  onClose,
  onSelect,
}: ModelPickerModalProps) {
  const insets = useSafeAreaInsets();
  const [models, setModels] = useState<OpenRouterModel[]>(FALLBACK_MODELS);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [query, setQuery] = useState('');
  const [customId, setCustomId] = useState('');
  const loadedOnce = useRef(false);

  const loadModels = async () => {
    setLoadState('loading');

    try {
      const result = await fetchNarratorModels();
      setModels(result);
      setLoadState('ready');
      loadedOnce.current = true;
    } catch {
      setLoadState('error');
    }
  };

  useEffect(() => {
    if (visible && !loadedOnce.current && loadState === 'idle') {
      void loadModels();
    }
  }, [visible]);

  const filteredModels = useMemo(() => {
    const term = query.trim().toLowerCase();

    if (!term) {
      return models;
    }

    return models.filter(
      (model) =>
        model.name.toLowerCase().includes(term) ||
        model.id.toLowerCase().includes(term)
    );
  }, [models, query]);

  const useCustomModel = () => {
    const id = customId.trim();

    if (!id) {
      return;
    }

    const known = models.find((model) => model.id === id);
    onSelect({ id, name: known?.name ?? id });
    setCustomId('');
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable
          accessibilityLabel="Close model picker"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={type.eyebrow}>Narrator</Text>
              <Text style={styles.title}>Choose a model</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityLabel="Refresh model list"
                accessibilityRole="button"
                disabled={loadState === 'loading'}
                hitSlop={8}
                onPress={() => void loadModels()}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.pressed,
                ]}
              >
                {loadState === 'loading' ? (
                  <ActivityIndicator color={colors.textMuted} size="small" />
                ) : (
                  <RefreshCw color={colors.textMuted} size={18} strokeWidth={1.8} />
                )}
              </Pressable>
              <Pressable
                accessibilityLabel="Close model picker"
                accessibilityRole="button"
                hitSlop={8}
                onPress={onClose}
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.pressed,
                ]}
              >
                <X color={colors.textMuted} size={19} strokeWidth={1.8} />
              </Pressable>
            </View>
          </View>

          <View style={styles.searchWrap}>
            <Search color={colors.textDim} size={17} strokeWidth={1.8} />
            <TextInput
              accessibilityLabel="Search models"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setQuery}
              placeholder="Search by name or provider"
              placeholderTextColor={colors.textDim}
              style={styles.searchInput}
              value={query}
            />
            {query ? (
              <Pressable
                accessibilityLabel="Clear search"
                hitSlop={10}
                onPress={() => setQuery('')}
              >
                <X color={colors.textDim} size={16} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>

          {loadState === 'error' ? (
            <View style={styles.notice}>
              <CircleAlert color={colors.gold} size={17} strokeWidth={1.8} />
              <Text style={styles.noticeText}>
                Couldn&apos;t refresh OpenRouter. Showing the recommended set.
              </Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void loadModels()}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {loadState === 'loading' && !loadedOnce.current ? (
            <View style={styles.notice}>
              <ActivityIndicator color={colors.gold} size="small" />
              <Text style={styles.noticeText}>Refreshing the OpenRouter catalog…</Text>
            </View>
          ) : null}

          <FlatList
            contentContainerStyle={styles.listContent}
            data={filteredModels}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No models found</Text>
                <Text style={styles.emptyBody}>
                  Try another search, or enter a model ID below.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const selected = item.id === selectedId;

              return (
                <Pressable
                  accessibilityLabel={`Select ${item.name}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelect({ id: item.id, name: item.name })}
                  style={({ pressed }) => [
                    styles.modelRow,
                    selected && styles.modelRowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.modelIcon, selected && styles.modelIconSelected]}>
                    <Sparkles
                      color={selected ? colors.accentBright : colors.textDim}
                      size={16}
                      strokeWidth={1.8}
                    />
                  </View>
                  <View style={styles.modelCopy}>
                    <View style={styles.modelTitleRow}>
                      <Text numberOfLines={1} style={styles.modelName}>
                        {item.name}
                      </Text>
                      {item.recommended ? (
                        <Text style={styles.recommended}>PICK</Text>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.modelId}>
                      {item.id}
                    </Text>
                    <Text style={styles.modelMeta}>{modelMeta(item)}</Text>
                  </View>
                  {selected ? (
                    <View style={styles.check}>
                      <Check color={colors.onAccent} size={13} strokeWidth={2.4} />
                    </View>
                  ) : null}
                </Pressable>
              );
            }}
            style={styles.list}
          />

          <View style={styles.customBox}>
            <Text style={styles.customLabel}>Use a specific model ID</Text>
            <View style={styles.customRow}>
              <TextInput
                accessibilityLabel="Custom model ID"
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setCustomId}
                onSubmitEditing={useCustomModel}
                placeholder="provider/model"
                placeholderTextColor={colors.textDim}
                returnKeyType="done"
                style={styles.customInput}
                value={customId}
              />
              <AppButton
                compact
                disabled={!customId.trim()}
                label="Use"
                onPress={useCustomModel}
                style={styles.customButton}
                variant="secondary"
              />
            </View>
            <Text style={styles.customHint}>
              Any text model available to your OpenRouter key works here.
            </Text>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    width: '100%',
    maxWidth: 680,
    height: '89%',
    paddingTop: 10,
    paddingHorizontal: 18,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  headerCopy: {
    gap: 2,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 27,
    lineHeight: 33,
    color: colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.7,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    marginTop: spacing.lg,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: spacing.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
  },
  retry: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.gold,
  },
  list: {
    flex: 1,
    marginTop: spacing.md,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  modelRowSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  modelIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modelIconSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: 'rgba(201, 74, 52, 0.16)',
  },
  modelCopy: {
    flex: 1,
    gap: 2,
  },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelName: {
    flexShrink: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  recommended: {
    fontFamily: fonts.bodyMedium,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1,
    color: colors.gold,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.goldBorder,
    backgroundColor: colors.goldSoft,
    overflow: 'hidden',
  },
  modelId: {
    fontFamily: fonts.mono,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  modelMeta: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  empty: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textDim,
    textAlign: 'center',
  },
  customBox: {
    gap: 8,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  customLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.textMuted,
  },
  customRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  customInput: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
  },
  customButton: {
    minWidth: 68,
  },
  customHint: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textDim,
  },
});
