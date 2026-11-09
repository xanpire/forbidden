import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { WeatherIcon } from '@/components/WeatherIcon';
import { WorldMap } from '@/components/player/WorldMap';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { dateSortValue, formatDayMonth } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import { currentRegion, type Region } from '@/lib/rpg/geography';
import {
  formatTravelDays,
  knownWhereabouts,
  placeVisits,
  regionLabel,
  travelEstimate,
  type KnownWhereabouts,
} from '@/lib/rpg/mapData';
import type { AppDatabase, CalendarDate, RegionDef } from '@/lib/rpg/types';
import { CONDITION_INFO, climateOf, currentWeather, regionWeather, seasonLabel } from '@/lib/rpg/weather';
import {
  END_LABEL,
  activeSafehouses,
  currentSafehouse,
  formerSafehouses,
  isOvergrown,
  kindLabel,
  residentNames,
  whoKnows,
} from '@/lib/rpg/safehouses';
import type { Safehouse } from '@/lib/rpg/types';
import { displayName } from '@/lib/rpg/names';

// The world as a list (no drawn map until a later session): the regions the
// player wrote with their places, the player's own places, where people are
// as far as the player knows, and the road so far.

const ROAD_PREVIEW = 12;

function dateLine(date: CalendarDate) {
  return `${formatDayMonth(date)}, year ${date.year}`;
}

function PersonRows({ entries }: { entries: KnownWhereabouts[] }) {
  const router = useRouter();
  const { db } = useGame();

  return (
    <ListCard>
      {entries.map((entry) => (
        <ListRow
          accessibilityRole="link"
          chevron
          key={entry.entity.id}
          meta={entry.detail}
          onPress={() => router.push({ pathname: '/bond/[id]', params: { id: entry.entity.id } })}
          title={db ? displayName(db, entry.entity) : entry.entity.name}
        />
      ))}
    </ListCard>
  );
}

function RegionCard({ db, region, here }: { db: AppDatabase; region: RegionDef; here: Region | null }) {
  const visits = placeVisits(db);
  const places = db.world.places.filter((place) => place.regionId === region.id);
  const estimate = region.id === here ? null : travelEstimate(db, region.id);
  const climate = climateOf(db, region.id);
  const condition = climate === 'none' ? null : regionWeather(db, region.id);
  const travel =
    region.id === here
      ? 'You are here.'
      : estimate
        ? estimate.inWeather > estimate.days + 0.05
          ? `From here: ${formatTravelDays(estimate.days)}, ${formatTravelDays(estimate.inWeather)} in this weather`
          : `From here: ${formatTravelDays(estimate.days)}`
        : '';

  return (
    <View style={styles.group}>
      <ListCard>
        <ListRow
          body={[region.description, travel].filter(Boolean).join('\n') || null}
          bodyLines={4}
          leading={
            condition ? (
              <View style={styles.weatherBadge}>
                <WeatherIcon color={colors.textMuted} condition={condition} night={false} size={16} />
              </View>
            ) : undefined
          }
          meta={condition ? `${CONDITION_INFO[condition].short}, ${seasonLabel(climate, db.state.inStoryDate)}` : 'Indoors'}
          title={region.name}
        />
        {places.map((place) => {
          const visit = visits.get(place.id);

          return (
            <ListRow
              body={place.description || null}
              bodyLines={2}
              key={place.id}
              meta={
                visit
                  ? visit.count === 1
                    ? `Once, ${dateLine(visit.first)}`
                    : `${visit.count} times · last ${dateLine(visit.last)}`
                  : 'Not yet visited'
              }
              title={place.name}
            />
          );
        })}
      </ListCard>
    </View>
  );
}

/** What you can see of a place: a search while you were away shows only once you are back. */
function shownStash(house: Safehouse) {
  return house.raided && !house.raided.seen ? house.raided.lost : house.stash;
}

function knownCompromised(house: Safehouse) {
  return Boolean(house.compromised) && (!house.raided || house.raided.seen);
}

function placeMeta(db: AppDatabase, house: Safehouse, here: boolean) {
  const until = house.kind === 'rented' && house.until ? house.until : null;
  const overdue = until && dateSortValue(until) <= dateSortValue(db.state.inStoryDate);

  return [
    kindLabel(house),
    house.region ? regionLabel(db, house.region) : null,
    here ? 'You are here' : `Last there ${dateLine(house.lastVisit)}`,
    until ? (overdue ? 'Paid time ran out' : `Paid until ${dateLine(until)}`) : null,
    knownCompromised(house) ? 'Found' : null,
    isOvergrown(db, house) ? 'Overgrown' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function placeBody(db: AppDatabase, house: Safehouse) {
  const known = whoKnows(db, house);
  const stash = shownStash(house);
  const residents = residentNames(db, house);

  return [
    house.place && house.place !== house.name ? house.place : null,
    known.length > 0 ? `Who knows: ${known.join(', ')}` : 'No one else knows of it',
    residents.length > 0 ? `Living there: ${residents.join(', ')}` : null,
    stash.length > 0 ? `Stashed: ${stash.join(', ')}` : null,
    house.upgrades.length > 0 ? `Built up: ${house.upgrades.map((item) => item.name).join(', ')}` : null,
    house.raided?.seen ? `Searched while you were away${house.raided.lost.length ? `: ${house.raided.lost.join(', ')} gone` : ''}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The player's places: homes, rooms, hideouts, and the ones they lost. */
function PlacesList({ db }: { db: AppDatabase }) {
  const here = currentSafehouse(db)?.id;
  const active = [...activeSafehouses(db)].sort((a, b) =>
    a.id === here ? -1 : b.id === here ? 1 : dateSortValue(b.lastVisit) - dateSortValue(a.lastVisit)
  );
  const former = formerSafehouses(db);
  const [allFormer, setAllFormer] = useState(false);
  const shownFormer = allFormer ? former : former.slice(0, 5);

  return (
    <>
      <SectionLabel>Your places</SectionLabel>
      {active.length > 0 ? (
        <ListCard>
          {active.map((house) => (
            <ListRow body={placeBody(db, house)} bodyLines={8} key={house.id} meta={placeMeta(db, house, house.id === here)} title={house.name} />
          ))}
        </ListCard>
      ) : (
        <EmptyRow body="Wherever you sleep or settle in can become one." title="Nowhere to go back to, yet" />
      )}

      {former.length > 0 ? (
        <>
          <SectionLabel>Former places</SectionLabel>
          <ListCard>
            {shownFormer.map((house) => (
              <ListRow
                body={house.ended?.note ? house.ended.note.charAt(0).toUpperCase() + house.ended.note.slice(1) : null}
                key={house.id}
                meta={[
                  house.ended ? `${END_LABEL[house.ended.reason]} ${dateLine(house.ended.on)}` : null,
                  house.region ? regionLabel(db, house.region) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                title={house.name}
              />
            ))}
            {former.length > 5 ? (
              <ListRow
                accessibilityRole="button"
                onPress={() => setAllFormer((value) => !value)}
                title={allFormer ? 'Show less' : `Show all ${former.length}`}
              />
            ) : null}
          </ListCard>
        </>
      ) : null}
    </>
  );
}

export function MapSection() {
  const { db } = useGame();
  const [wholeRoad, setWholeRoad] = useState(false);

  const people = useMemo(() => (db ? knownWhereabouts(db) : []), [db]);
  const road = useMemo(() => [...(db?.state.travelLog ?? [])].reverse(), [db]);

  if (!db) return null;

  const here = currentRegion(db);
  const weather = currentWeather(db);
  const withYou = people.filter((entry) => entry.basis === 'with-you');
  const elsewhere = people.filter((entry) => entry.basis !== 'with-you');
  const byRegion = new Map<string, KnownWhereabouts[]>();

  for (const entry of elsewhere) {
    const key = entry.region ?? '';
    byRegion.set(key, [...(byRegion.get(key) ?? []), entry]);
  }

  const visibleRoad = wholeRoad ? road : road.slice(0, ROAD_PREVIEW);
  const weatherMeta = weather.climate === 'none' ? 'Indoors' : `${CONDITION_INFO[weather.condition].short}, ${weather.seasonLabel}`;

  return (
    <>
      {db.world.regions.length > 0 ? <SectionLabel>Map</SectionLabel> : null}
      <WorldMap db={db} />
      <SectionLabel>You are here</SectionLabel>
      <ListCard>
        <ListRow
          leading={
            weather.climate === 'none' ? undefined : (
              <View style={styles.weatherBadge}>
                <WeatherIcon color={colors.accentTint} condition={weather.condition} night={weather.night} size={16} />
              </View>
            )
          }
          meta={[here ? regionLabel(db, here) : null, weatherMeta].filter(Boolean).join(' · ')}
          title={db.state.location}
        />
        {withYou.length > 0 ? (
          <ListRow meta="With you" title={withYou.map((entry) => displayName(db, entry.entity)).join(', ')} />
        ) : null}
      </ListCard>

      {db.world.regions.length > 0 ? (
        <>
          <SectionLabel>The world</SectionLabel>
          {db.world.regions.map((region) => (
            <RegionCard db={db} here={here} key={region.id} region={region} />
          ))}
        </>
      ) : null}

      <PlacesList db={db} />

      <SectionLabel>Where people are, as far as you know</SectionLabel>
      {byRegion.size > 0 ? (
        <>
          <Text style={styles.legend}>What you were told or last saw. It may not be true any more.</Text>
          {[...byRegion.entries()].map(([region, entries]) => (
            <View key={region || 'elsewhere'} style={styles.group}>
              <Text style={styles.groupLabel}>{region ? regionLabel(db, region) : 'Elsewhere'}</Text>
              <PersonRows entries={entries.slice(0, 12)} />
            </View>
          ))}
        </>
      ) : (
        <EmptyRow title="No one you know of, yet" />
      )}

      <SectionLabel>Your road</SectionLabel>
      {road.length > 0 ? (
        <ListCard>
          {visibleRoad.map((stop, index) => (
            <ListRow
              key={`${stop.date.year}-${stop.date.month}-${stop.date.day}-${stop.date.hour}-${stop.date.minute}-${index}`}
              meta={`${dateLine(stop.date)}${stop.region ? ` · ${regionLabel(db, stop.region)}` : ''}`}
              title={stop.place}
            />
          ))}
          {road.length > ROAD_PREVIEW ? (
            <ListRow
              accessibilityRole="button"
              onPress={() => setWholeRoad((value) => !value)}
              title={wholeRoad ? 'Show less' : `Show all ${road.length} stops`}
            />
          ) : null}
        </ListCard>
      ) : (
        <EmptyRow title="Your road starts here" />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  legend: {
    ...type.rowMeta,
    color: colors.textDim,
    marginTop: -spacing.xs,
  },
  weatherBadge: {
    width: 32,
    height: 32,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceSoft,
  },
  group: {
    gap: spacing.xs,
  },
  groupLabel: {
    ...type.rowMeta,
    fontFamily: fonts.semibold,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
});
