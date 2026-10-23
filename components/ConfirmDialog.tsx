import { TriangleAlert } from 'lucide-react-native';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppButton } from '@/components/AppButton';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';

type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onCancel}
      transparent
      visible={visible}
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityLabel="Cancel"
          onPress={busy ? undefined : onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dialog}>
          <View style={styles.icon}>
            <TriangleAlert color={colors.danger} size={22} strokeWidth={1.8} />
          </View>
          <Text style={type.eyebrow}>Careful</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          <View style={styles.actions}>
            <AppButton
              compact
              disabled={busy}
              label="Keep settings"
              onPress={onCancel}
              style={styles.action}
              variant="secondary"
            />
            <AppButton
              compact
              label={confirmLabel}
              loading={busy}
              onPress={onConfirm}
              style={styles.action}
              variant="destructive"
            />
          </View>
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.danger} size="small" />
              <Text style={styles.busyText}>Clearing local settings…</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.overlay,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    padding: 22,
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(227, 107, 93, 0.24)',
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 25,
    lineHeight: 31,
    color: colors.text,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: spacing.xs,
  },
  busyText: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textDim,
  },
});
