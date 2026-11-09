import { StyleSheet, Text, View } from 'react-native';

import { ListCard, ListRow, SectionLabel } from '@/components/List';
import { colors, fonts, spacing, type } from '@/constants/theme';
import { formatDayMonth } from '@/lib/rpg/calendar';
import {
  STANDING_LABEL,
  WANTED_LABEL,
  factionStandings,
  reputationOf,
  wantedListings,
} from '@/lib/rpg/reputation';
import { currencyOf, formatMoney } from '@/lib/rpg/money';
import { renownOf } from '@/lib/rpg/renown';
import type { AppDatabase } from '@/lib/rpg/types';

/**
 * What the world has on you: the wanted lists you know you're on, and how the
 * groups you deal with regard you. Listings you haven't seen stay hidden,
 * like news you haven't heard.
 */
export function ReputationCard({ db }: { db: AppDatabase }) {
  const known = wantedListings(db).filter((listing) => listing.known);
  const standings = factionStandings(db);
  const currency = currencyOf(db);
  const reputation = reputationOf(db);
  const epithets = renownOf(db).epithets;

  return (
    <>
      <SectionLabel first>Your name out there</SectionLabel>
      <ListCard>
        {known.length === 0 ? (
          <ListRow
            body="As far as you know, nobody has put a price on your head. A poster, a warrant or someone naming your price would tell you."
            title="Not wanted, as far as you know"
          />
        ) : (
          known.map((listing) => (
            <ListRow
              key={listing.factionId}
              meta={`${WANTED_LABEL[listing.level]}${listing.listedOn ? ` · listed ${formatDayMonth(listing.listedOn)}, Year ${listing.listedOn.year}` : ''}`}
              title={listing.name}
            >
              <Text style={styles.bounty}>
                {formatMoney(listing.bounty, currency)}
                {epithets[listing.factionId]?.known ? ` · “${epithets[listing.factionId]!.name}”` : ''}
              </Text>
              {listing.lastReason ? <Text style={type.rowBody}>{listing.lastReason}</Text> : null}
            </ListRow>
          ))
        )}
        {standings.map(({ faction, standing, band }) => (
          <ListRow
            body={reputation.factions[faction.id]?.lastReason ?? `How ${faction.name} regards you.`}
            key={`standing-${faction.id}`}
            title={faction.name}
            trailing={<Text style={styles.standing}>{STANDING_LABEL[band]}</Text>}
          >
            <View style={styles.track}>
              <View style={styles.mid} />
              <View
                style={[
                  styles.fill,
                  standing >= 0
                    ? { left: '50%', width: `${Math.min(100, standing) / 2}%` }
                    : { right: '50%', width: `${Math.min(100, -standing) / 2}%`, backgroundColor: colors.textDim },
                ]}
              />
            </View>
          </ListRow>
        ))}
      </ListCard>
    </>
  );
}

const styles = StyleSheet.create({
  bounty: {
    fontFamily: fonts.bold,
    fontSize: 13,
    color: colors.textSoft,
    marginTop: 2,
  },
  standing: {
    fontFamily: fonts.bold,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.accentText,
  },
  track: {
    height: 4,
    marginTop: spacing.sm,
    borderRadius: 2,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  mid: {
    position: 'absolute',
    left: '50%',
    width: 1,
    height: 4,
    backgroundColor: colors.borderStrong,
  },
  fill: {
    position: 'absolute',
    height: 4,
    backgroundColor: colors.accent,
  },
});
