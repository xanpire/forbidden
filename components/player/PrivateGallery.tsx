// The private gallery of explicit pictures, at the end of the Scrapbook.
// Hidden until asked for; with a PIN set, it asks for it again.
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { EmptyRow, SectionLabel } from '@/components/List';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { checkPin, usePrivacy } from '@/lib/privacy';
import { deleteExplicitImage } from '@/lib/rpg/explicitImages';
import { useGame } from '@/lib/rpg/game';
import { useStoredImage } from '@/lib/rpg/imageStore';
import type { ExplicitImageRecord } from '@/lib/rpg/types';

function Picture({ item, onDelete }: { item: ExplicitImageRecord; onDelete: () => void }) {
  const uri = useStoredImage(item.image);
  return (
    <View style={styles.item}>
      {uri ? <Image accessibilityLabel="Private picture" resizeMode="cover" source={{ uri }} style={styles.image} /> : <View style={styles.image} />}
      <View style={styles.meta}>
        <Text style={type.rowMeta}>{item.provider} · {item.model}</Text>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onDelete}>
          <Text style={styles.delete}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function PrivateGallery() {
  const { db, changeSave } = useGame();
  const { settings } = usePrivacy();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const items = [...(db?.explicitImages ?? [])].reverse();

  return (
    <>
      <SectionLabel>Private</SectionLabel>
      {!open ? (
        settings.pinHash ? (
          <View style={styles.lock}>
            <TextInput
              accessibilityLabel="PIN for private pictures"
              inputMode="numeric"
              keyboardType="number-pad"
              maxLength={8}
              onChangeText={(text) => {
                const next = text.replace(/\D/g, '');
                setPin(next);
                if (checkPin(settings, next)) {
                  setOpen(true);
                  setPin('');
                }
              }}
              placeholder="PIN to show private pictures"
              placeholderTextColor={colors.textDim}
              secureTextEntry
              style={styles.input}
              value={pin}
            />
          </View>
        ) : (
          <AppButton compact label={`Show private pictures (${items.length})`} onPress={() => setOpen(true)} variant="secondary" />
        )
      ) : items.length === 0 ? (
        <EmptyRow body="Pictures you make with Picture this in an intimate scene are kept here." title="Nothing yet" />
      ) : (
        <>
          <AppButton compact label="Hide" onPress={() => setOpen(false)} variant="ghost" />
          {items.map((item) => (
            <Picture item={item} key={item.id} onDelete={() => void changeSave((latest) => deleteExplicitImage(latest, item.id))} />
          ))}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  lock: { marginBottom: spacing.lg },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  item: { marginBottom: spacing.lg },
  image: { width: '100%', aspectRatio: 1, borderRadius: radius.lg, backgroundColor: colors.surface },
  meta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  delete: { color: colors.danger, fontFamily: fonts.medium, fontSize: 13 },
});
