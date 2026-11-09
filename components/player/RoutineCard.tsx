// Someone's week on their bond page: written, or read from their job, and
// editable (routines.ts).
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ListCard } from '@/components/List';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { useGame } from '@/lib/rpg/game';
import { inferredRoutine } from '@/lib/rpg/routines';
import type { EntityRecord } from '@/lib/rpg/types';

export function RoutineCard({ entity }: { entity: EntityRecord }) {
  const { changeSave } = useGame();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entity.routine ?? '');
  const written = entity.routine?.trim();

  const save = async () => {
    const routine = draft.trim();
    await changeSave((latest) => ({
      ...latest,
      entities: latest.entities.map((person) => (person.id === entity.id ? { ...person, routine: routine || undefined } : person)),
    }));
    setEditing(false);
  };

  return (
    <ListCard>
      <View style={styles.card}>
        <View style={styles.top}>
          <Text style={type.sectionLabel}>Their week</Text>
          <Pressable accessibilityRole="button" hitSlop={8} onPress={() => (editing ? void save() : setEditing(true))}>
            <Text style={styles.action}>{editing ? 'Save' : 'Edit'}</Text>
          </Pressable>
        </View>
        {editing ? (
          <TextInput
            accessibilityLabel="Their week"
            multiline
            onChangeText={setDraft}
            placeholder={inferredRoutine(entity)}
            placeholderTextColor={colors.textDim}
            style={styles.input}
            value={draft}
          />
        ) : (
          <Text style={type.rowBody}>{written || `From their job: ${inferredRoutine(entity)}`}</Text>
        )}
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.lg, gap: spacing.sm },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  action: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accentText },
  input: { minHeight: 60, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceRaised, color: colors.text, fontFamily: fonts.regular, fontSize: 14 },
});
