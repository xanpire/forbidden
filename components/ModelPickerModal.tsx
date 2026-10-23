import { Check, CircleAlert, RefreshCw, Search, X } from 'lucide-react-native';
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
import { colors, fonts, radius, spacing } from '@/constants/theme';
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
            <Text style={styles.title}>Choose model</Text>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityLabel="Refresh model list"
                accessibilityRole="button"
                disabled={loadState === 'loading'}
                hitSlop={8}
                onPress={() => void loadModels()}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
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
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <X color={colors.textMuted} size={20} strokeWidth={1.8} />
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
              placeholder="Search models"
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
              <CircleAlert color={colors.textMuted} size={16} strokeWidth={1.8} />
              <Text style={styles.noticeText}>
                Couldn&apos;t refresh OpenRouter. Showing recommended models.
              </Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void loadModels()}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            </View>
          ) : null}

          {loadState === 'loading' && !loadedOnce.current ? (
            <View style={styles.notice}>
              <ActivityIndicator color={colors.textMuted} size="small" />
              <Text style={styles.noticeText}>Refreshing models…</Text>
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
                  <View style={styles.modelCopy}>
                    <View style={styles.modelTitleRow}>
                      <Text numberOfLines={1} style={styles.modelName}>
                        {item.name}
                      </Text>
                      {item.recommended ? (
                        <Text style={styles.recommended}>Recommended</Text>
                      ) : null}
                    </View>
                    <Text numberOfLines={1} style={styles.modelId}>
                      {item.id}
                    </Text>
                    <Text style={styles.modelMeta}>{modelMeta(item)}</Text>
                  </View>
                  {selected ? (
                    <Check color={colors.accent} size={18} strokeWidth={2.2} />
                  ) : null}
                </Pressable>
              );
            }}
            style={styles.list}
          />

          <View style={styles.customBox}>
            <Text style={styles.customLabel}>Custom model ID</Text>
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
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.6,
    color: colors.text,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 4,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 46,
    marginTop: spacing.lg,
    paddingHorizontal: 13,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
  },
  noticeText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textMuted,
  },
  retry: {
    fontFamily: fonts.semibold,
    fontSize: 11,
    color: colors.accent,
  },
  list: {
    flex: 1,
    marginTop: spacing.md,
  },
  listContent: {
    gap: 6,
    paddingBottom: spacing.sm,
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  modelRowSelected: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  modelCopy: {
    flex: 1,
    gap: 1,
  },
  modelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modelName: {
    flexShrink: 1,
    fontFamily: fonts.semibold,
    fontSize: 14,
    lineHeight: 19,
    color: colors.text,
  },
  recommended: {
    fontFamily: fonts.medium,
    fontSize: 9,
    lineHeight: 12,
    color: colors.accent,
  },
  modelId: {
    fontFamily: fonts.regular,
    fontSize: 10,
    lineHeight: 14,
    color: colors.textDim,
  },
  modelMeta: {
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 15,
    color: colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontFamily: fonts.semibold,
    fontSize: 14,
    color: colors.text,
  },
  emptyBody: {
    fontFamily: fonts.regular,
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
    fontFamily: fonts.semibold,
    fontSize: 11,
    lineHeight: 15,
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
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.text,
  },
  customButton: {
    minWidth: 68,
  },
});
