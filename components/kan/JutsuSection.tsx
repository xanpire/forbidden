import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { spacing, type } from '@/constants/theme';
import { formatDayMonth } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import { groupJutsuByNature } from '@/lib/rpg/jutsu';

export function JutsuSection() {
  const { db } = useGame();
  const [openId, setOpenId] = useState<string | null>(null);

  const groups = useMemo(() => (db ? groupJutsuByNature(db.jutsuRecords) : []), [db]);

  if (!db) {
    return null;
  }

  if (groups.length === 0) {
    return (
      <View style={styles.section}>
        <SectionLabel>Jutsu</SectionLabel>
        <EmptyRow
          body="Every technique Kan or anyone else uses is recorded here permanently."
          title="No jutsu recorded yet"
        />
      </View>
    );
  }

  return (
    <View style={styles.section}>
      {groups.map((group) => (
        <View key={group.nature} style={styles.group}>
          <SectionLabel>
            {group.nature} · {group.jutsu.length}
          </SectionLabel>
          <ListCard>
            {group.jutsu.map((record) => {
              const open = openId === record.id;
              const meta =
                record.user === 'Kan'
                  ? `Used ${record.timesUsed}×`
                  : `${record.user} · used ${record.timesUsed}×`;

              return (
                <ListRow
                  accessibilityState={{ expanded: open }}
                  body={record.effect}
                  bodyLines={open ? undefined : 2}
                  key={record.id}
                  meta={
                    open
                      ? `${meta} · first seen ${formatDayMonth(record.firstSeen)}, year ${record.firstSeen.year}`
                      : meta
                  }
                  onPress={() => setOpenId(open ? null : record.id)}
                  title={record.name}
                >
                  {open && record.visual ? (
                    <Text style={type.rowBody}>
                      <Text style={styles.label}>Looks like </Text>
                      {record.visual}
                    </Text>
                  ) : null}
                  {open && record.description ? (
                    <Text style={type.rowBody}>{record.description}</Text>
                  ) : null}
                </ListRow>
              );
            })}
          </ListCard>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  group: {
    gap: spacing.md,
  },
  label: {
    ...type.rowMeta,
    fontSize: 13,
  },
});
