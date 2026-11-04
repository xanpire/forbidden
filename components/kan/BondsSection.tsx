import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Search } from 'lucide-react-native';

import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { colors, fonts, radius, spacing } from '@/constants/theme';
import { formatDayMonth } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import type { BondRecord, CalendarDate, EntityRecord } from '@/lib/rpg/types';

type BondEntry = {
  entity: EntityRecord;
  bond: BondRecord | null;
};

function dateValue(date: CalendarDate | undefined | null) {
  return date ? date.year * 10000 + date.month * 100 + date.day : -1;
}

function contactDate(entry: BondEntry) {
  return Math.max(dateValue(entry.entity.lastSeen), dateValue(entry.bond?.updatedInStoryDate));
}

export function formatAffinity(affinity: number) {
  return `${affinity > 0 ? '+' : ''}${affinity}`;
}

export function bondSubtitle(entry: BondEntry, today: CalendarDate) {
  const { entity, bond } = entry;
  const relation =
    bond?.relationship && bond.relationship !== 'stranger'
      ? bond.relationship.charAt(0).toUpperCase() + bond.relationship.slice(1)
      : bond?.status || entity.status || entity.role || 'Unknown';
  const seen = entity.lastSeen
    ? dateValue(entity.lastSeen) === dateValue(today)
      ? 'seen today'
      : `last seen ${formatDayMonth(entity.lastSeen)}`
    : null;

  return seen ? `${relation} · ${seen}` : relation;
}

export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  );
}

export function AffinityBar({ affinity }: { affinity: number }) {
  const width = `${Math.min(10, Math.abs(affinity)) * 10}%` as const;

  return (
    <View style={styles.barRow}>
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width, backgroundColor: affinity >= 0 ? colors.accent : colors.textDim },
          ]}
        />
      </View>
      <Text style={styles.barValue}>{formatAffinity(affinity)}</Text>
    </View>
  );
}

export function BondsSection() {
  const { db } = useGame();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const entries = useMemo<BondEntry[]>(() => {
    if (!db) {
      return [];
    }

    const term = query.trim().toLowerCase();

    return db.entities
      .filter((entity) => entity.type === 'character' && entity.name !== 'Kan')
      .map((entity) => ({
        entity,
        bond: db.bonds.find((bond) => bond.entityId === entity.id) ?? null,
      }))
      .filter(({ entity, bond }) => {
        if (!term) {
          return true;
        }

        return (
          entity.name.toLowerCase().includes(term) ||
          entity.aliases.some((alias) => alias.toLowerCase().includes(term)) ||
          (bond?.status.toLowerCase().includes(term) ?? false)
        );
      })
      .sort((a, b) => {
        const contact = contactDate(b) - contactDate(a);

        if (contact !== 0) {
          return contact;
        }

        const major = Number(Boolean(b.bond?.isMajor)) - Number(Boolean(a.bond?.isMajor));

        if (major !== 0) {
          return major;
        }

        return (b.bond?.affinity ?? 0) - (a.bond?.affinity ?? 0);
      });
  }, [db, query]);

  if (!db) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={styles.search}>
        <Search color={colors.textDim} size={16} strokeWidth={2} />
        <TextInput
          accessibilityLabel="Search bonds"
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder="Search bonds"
          placeholderTextColor={colors.textDim}
          style={styles.searchInput}
          value={query}
        />
      </View>

      <SectionLabel>{query ? 'Results' : 'Seen recently'}</SectionLabel>

      {entries.length === 0 ? (
        <EmptyRow
          body={query ? 'Try another name.' : 'People appear here as you meet them.'}
          title={query ? 'You don’t know anyone by that name' : 'No one yet'}
        />
      ) : (
        <ListCard>
          {entries.map((entry) => (
            <ListRow
              accessibilityLabel={`Open ${entry.entity.name}`}
              chevron
              key={entry.entity.id}
              leading={<Avatar name={entry.entity.name} />}
              meta={bondSubtitle(entry, db.state.inStoryDate)}
              onPress={() =>
                router.push({ pathname: '/bond/[id]', params: { id: entry.entity.id } })
              }
            >
              <View style={styles.nameRow}>
                <Text numberOfLines={1} style={styles.name}>
                  {entry.entity.name}
                </Text>
                {entry.bond?.isMajor ? <Text style={styles.major}>Major</Text> : null}
              </View>
              {entry.bond ? <AffinityBar affinity={entry.bond.affinity} /> : null}
            </ListRow>
          ))}
        </ListCard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    height: 44,
    fontFamily: fonts.regular,
    fontSize: 15,
    color: colors.text,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  avatarText: {
    fontFamily: fonts.bold,
    color: colors.accentText,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  name: {
    flexShrink: 1,
    fontFamily: fonts.bold,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
  },
  major: {
    fontFamily: fonts.bold,
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.accentText,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginVertical: 2,
  },
  barTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  barFill: {
    height: 4,
    borderRadius: 2,
  },
  barValue: {
    width: 26,
    textAlign: 'right',
    fontFamily: fonts.bold,
    fontSize: 12,
    color: '#D4D4D4',
  },
});
