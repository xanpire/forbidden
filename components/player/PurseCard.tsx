import { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { ListCard, ListRow, SectionLabel } from '@/components/List';
import { colors, fonts, spacing, type } from '@/constants/theme';
import { formatDayMonth } from '@/lib/rpg/calendar';
import { currencyOf, formatChange, formatMoney, purseFeel, purseOf } from '@/lib/rpg/money';
import type { AppDatabase } from '@/lib/rpg/types';

/** Changes shown before "Show all". */
const SHORT_LIST = 4;

/** Your money: what you carry, and what moved it, newest first. */
export function PurseCard({ db }: { db: AppDatabase }) {
  const purse = purseOf(db);
  const currency = currencyOf(db);
  const [expanded, setExpanded] = useState(false);
  const history = [...purse.history].reverse();
  const shown = expanded ? history : history.slice(0, SHORT_LIST);

  return (
    <>
      <SectionLabel>Your purse</SectionLabel>
      <ListCard>
        <ListRow
          meta={
            purse.estimatedStart
              ? 'About what you had on you. Counting your money in the story sets it right.'
              : null
          }
          title={purseFeel(db)}
          trailing={<Text style={styles.total}>{formatMoney(purse.amount, currency)}</Text>}
        />
        {history.length === 0 ? (
          <ListRow body="Nothing spent or earned yet. What you pay, earn, find or lose shows up here." />
        ) : (
          shown.map((entry, index) => (
            <ListRow
              key={`${index}-${entry.reason}`}
              meta={`${formatDayMonth(entry.date)}, Year ${entry.date.year}`}
              title={entry.reason}
              trailing={
                <Text style={[styles.change, entry.change < 0 ? styles.spent : styles.earned]}>
                  {formatChange(entry.change, currency)}
                </Text>
              }
            />
          ))
        )}
        {history.length > SHORT_LIST ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((value) => !value)}
            style={styles.more}
          >
            <Text style={type.rowMeta}>{expanded ? 'Show less' : `Show all ${history.length}`}</Text>
          </Pressable>
        ) : null}
      </ListCard>
    </>
  );
}

const styles = StyleSheet.create({
  total: {
    fontFamily: fonts.extrabold,
    fontSize: 17,
    color: colors.text,
  },
  change: {
    fontFamily: fonts.bold,
    fontSize: 13,
  },
  spent: {
    color: colors.textMuted,
  },
  earned: {
    color: colors.success,
  },
  more: {
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
});
