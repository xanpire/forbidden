import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Ellipse, G, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { EmptyRow, ListCard, ListRow, SectionLabel } from '@/components/List';
import { WeatherIcon } from '@/components/WeatherIcon';
import { colors, fonts, radius, spacing, type } from '@/constants/theme';
import { formatDayMonth } from '@/lib/rpg/calendar';
import { useGame } from '@/lib/rpg/game';
import { REGION_NAME, currentRegion, type Region } from '@/lib/rpg/geography';
import { localizePlaceNames } from '@/lib/rpg/glossary';
import {
  MAP_HEIGHT,
  MAP_PLACES,
  MAP_WIDTH,
  REGION_SHAPES,
  formatTravelDays,
  knownWhereabouts,
  mapPlace,
  placeVisits,
  pointOfStop,
  regionLabel,
  regionsVisited,
  routePoints,
  travelEstimate,
  type KnownWhereabouts,
  type MapPlace,
} from '@/lib/rpg/mapData';
import type { AppDatabase, CalendarDate } from '@/lib/rpg/types';
import { CONDITION_INFO, currentWeather, regionWeather, seasonLabel } from '@/lib/rpg/weather';

type Selection = { kind: 'place'; id: string } | { kind: 'region'; id: Region };

const REGIONS = Object.keys(REGION_SHAPES) as Region[];
const TOP_PLACES = MAP_PLACES.filter((place) => !place.parent);
const ROAD_PREVIEW = 12;

function dateLine(date: CalendarDate) {
  return `${formatDayMonth(date)}, year ${date.year}`;
}

function placeLabel(place: MapPlace) {
  return place.region ? `${place.name} · ${regionLabel(place.region)}` : place.name;
}

/** The board: countries, places, Kan's road and where he is. */
function WorldBoard({
  db,
  selection,
  onSelect,
}: {
  db: AppDatabase;
  selection: Selection | null;
  onSelect: (selection: Selection) => void;
}) {
  const [width, setWidth] = useState(0);
  const height = (width * MAP_HEIGHT) / MAP_WIDTH;
  const scale = width / MAP_WIDTH;
  const here = currentRegion(db);
  const visited = useMemo(() => regionsVisited(db), [db]);
  const visits = useMemo(() => placeVisits(db), [db]);
  const route = useMemo(() => routePoints(db), [db]);
  const people = useMemo(() => knownWhereabouts(db), [db]);
  const lastStop = db.state.travelLog?.[db.state.travelLog.length - 1];
  const you = (lastStop && pointOfStop(lastStop)) ?? { x: REGION_SHAPES[here].x, y: REGION_SHAPES[here].y };
  const peopleByRegion = useMemo(() => {
    const counts = new Map<Region, number>();

    for (const entry of people) {
      if (entry.basis !== 'with-you') counts.set(entry.region, (counts.get(entry.region) ?? 0) + 1);
    }

    return counts;
  }, [people]);

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const selectedRegion =
    selection?.kind === 'region' ? selection.id : selection?.kind === 'place' ? mapPlace(selection.id)?.region ?? null : null;

  return (
    <View onLayout={onLayout} style={[styles.board, { height: height || 260 }]}>
      {width > 0 ? (
        <>
          <Svg height={height} viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} width={width}>
            <Rect fill="#07090b" height={MAP_HEIGHT} width={MAP_WIDTH} x={0} y={0} />
            {REGIONS.map((region) => {
              const shape = REGION_SHAPES[region];
              const isHere = region === here;
              const isSelected = region === selectedRegion;
              const beenThere = visited.has(region);

              return (
                <G key={region}>
                  <Ellipse
                    cx={shape.x}
                    cy={shape.y}
                    fill={beenThere ? '#1a1012' : '#121212'}
                    rx={shape.rx}
                    ry={shape.ry}
                    stroke={isHere ? colors.accent : isSelected ? colors.textMuted : beenThere ? colors.accentBorder : '#262626'}
                    strokeDasharray={shape.sea ? '1.2 0.8' : undefined}
                    strokeWidth={isHere || isSelected ? 0.5 : 0.3}
                  />
                  <SvgText
                    fill={isHere ? colors.accentTint : colors.textDim}
                    fontFamily={fonts.semibold}
                    fontSize={2.3}
                    textAnchor="middle"
                    x={shape.x}
                    y={shape.y + shape.ry - 1.4}
                  >
                    {shape.label}
                    {peopleByRegion.get(region) ? ` · ${peopleByRegion.get(region)}` : ''}
                  </SvgText>
                </G>
              );
            })}

            {route.length > 1 ? (
              <Polyline
                fill="none"
                points={route.map((point) => `${point.x},${point.y}`).join(' ')}
                stroke={colors.accent}
                strokeDasharray="1 0.7"
                strokeLinejoin="round"
                strokeOpacity={0.55}
                strokeWidth={0.45}
              />
            ) : null}

            {TOP_PLACES.map((place) => {
              const beenThere = visits.has(place.id);
              const isSelected = selection?.kind === 'place' && selection.id === place.id;
              const size = place.kind === 'village' ? 1.3 : 0.9;

              return (
                <Circle
                  cx={place.x}
                  cy={place.y}
                  fill={beenThere ? colors.textSoft : '#050505'}
                  key={place.id}
                  r={isSelected ? size + 0.5 : size}
                  stroke={isSelected ? colors.white : beenThere ? colors.textSoft : colors.textDim}
                  strokeWidth={0.35}
                />
              );
            })}

            <Circle cx={you.x} cy={you.y} fill={colors.accent} fillOpacity={0.2} r={3} />
            <Circle cx={you.x} cy={you.y} fill={colors.accent} r={1.2} stroke={colors.white} strokeWidth={0.3} />
          </Svg>

          {/* Tap targets sit over the drawing: countries first, places on top. */}
          {REGIONS.map((region) => {
            const shape = REGION_SHAPES[region];

            return (
              <Pressable
                accessibilityLabel={REGION_NAME[region]}
                accessibilityRole="button"
                key={`r-${region}`}
                onPress={() => onSelect({ kind: 'region', id: region })}
                style={{
                  position: 'absolute',
                  left: (shape.x - shape.rx * 0.7) * scale,
                  top: (shape.y - shape.ry * 0.7) * scale,
                  width: shape.rx * 1.4 * scale,
                  height: shape.ry * 1.4 * scale,
                  borderRadius: 999,
                }}
              />
            );
          })}
          {TOP_PLACES.map((place) => (
            <Pressable
              accessibilityLabel={place.name}
              accessibilityRole="button"
              hitSlop={4}
              key={`p-${place.id}`}
              onPress={() => onSelect({ kind: 'place', id: place.id })}
              style={{
                position: 'absolute',
                left: place.x * scale - 12,
                top: place.y * scale - 12,
                width: 24,
                height: 24,
                borderRadius: 12,
              }}
            />
          ))}
        </>
      ) : null}
    </View>
  );
}

function PersonRows({ entries }: { entries: KnownWhereabouts[] }) {
  const router = useRouter();

  return (
    <ListCard>
      {entries.map((entry) => (
        <ListRow
          accessibilityRole="link"
          chevron
          key={entry.entity.id}
          meta={entry.detail}
          onPress={() => router.push({ pathname: '/bond/[id]', params: { id: entry.entity.id } })}
          title={entry.entity.name}
        />
      ))}
    </ListCard>
  );
}

function SelectedCard({ db, selection, people }: { db: AppDatabase; selection: Selection; people: KnownWhereabouts[] }) {
  const visits = placeVisits(db);
  const here = currentRegion(db);
  const place = selection.kind === 'place' ? mapPlace(selection.id) : null;
  const region: Region | null = place ? place.region : selection.kind === 'region' ? selection.id : null;
  const title = place ? place.name : region ? regionLabel(region) : 'Somewhere';
  const estimate = travelEstimate(db, region);
  const children = place ? MAP_PLACES.filter((child) => child.parent === place.id) : [];
  const regionPlaces = !place && region ? TOP_PLACES.filter((item) => item.region === region) : [];
  const visit = place ? visits.get(place.id) : null;
  const theirs = people.filter((entry) => entry.basis !== 'with-you' && region && entry.region === region);
  const condition = region ? regionWeather(db, region) : null;

  let travel: string;

  if (!region) {
    travel = 'Off every road you know. You would have to find the way.';
  } else if (region === here) {
    travel = place ? 'In the country you are in now.' : 'You are here.';
  } else if (estimate) {
    travel =
      estimate.inWeather > estimate.days + 0.2
        ? `From here: ${formatTravelDays(estimate.days)} at a shinobi’s pace, ${formatTravelDays(estimate.inWeather)} in this weather`
        : `From here: ${formatTravelDays(estimate.days)} at a shinobi’s pace`;
  } else {
    travel = '';
  }

  return (
    <>
      <SectionLabel>{place ? 'Place' : 'Country'}</SectionLabel>
      <ListCard>
        <ListRow
          body={[place?.note, travel].filter(Boolean).join('\n') || null}
          bodyLines={4}
          leading={
            condition ? (
              <View style={styles.weatherBadge}>
                <WeatherIcon color={colors.textMuted} condition={condition} night={false} size={16} />
              </View>
            ) : undefined
          }
          meta={[
            place && region ? regionLabel(region) : null,
            condition && region ? `${CONDITION_INFO[condition].short}, ${seasonLabel(region, db.state.inStoryDate)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
          title={title}
        />
        {visit ? (
          <ListRow
            meta={
              visit.count === 1
                ? `Once, ${dateLine(visit.first)}`
                : `${visit.count} times · first ${dateLine(visit.first)} · last ${dateLine(visit.last)}`
            }
            title="You have been here"
          />
        ) : place ? (
          <ListRow meta="Not yet" title="You have been here" />
        ) : null}
      </ListCard>

      {children.length > 0 ? (
        <>
          <SectionLabel>Inside</SectionLabel>
          <ListCard>
            {children.map((child) => {
              const childVisit = visits.get(child.id);

              return (
                <ListRow
                  body={child.note ?? null}
                  bodyLines={2}
                  key={child.id}
                  meta={childVisit ? `Last there ${dateLine(childVisit.last)}` : 'Not yet visited'}
                  title={child.name}
                />
              );
            })}
          </ListCard>
        </>
      ) : null}

      {regionPlaces.length > 0 ? (
        <>
          <SectionLabel>Places</SectionLabel>
          <ListCard>
            {regionPlaces.map((item) => {
              const itemVisit = visits.get(item.id);

              return (
                <ListRow
                  key={item.id}
                  meta={itemVisit ? `Last there ${dateLine(itemVisit.last)}` : 'Not yet visited'}
                  title={item.name}
                />
              );
            })}
          </ListCard>
        </>
      ) : null}

      {region ? (
        <>
          <SectionLabel>Here, as far as you know</SectionLabel>
          {theirs.length > 0 ? <PersonRows entries={theirs} /> : <EmptyRow title="No one you know of" />}
        </>
      ) : null}
    </>
  );
}

export function MapSection() {
  const { db } = useGame();
  const [selection, setSelection] = useState<Selection | null>(null);
  const [wholeRoad, setWholeRoad] = useState(false);

  const people = useMemo(() => (db ? knownWhereabouts(db) : []), [db]);
  const road = useMemo(() => [...(db?.state.travelLog ?? [])].reverse(), [db]);

  if (!db) return null;

  const here = currentRegion(db);
  const weather = currentWeather(db);
  const lastStop = db.state.travelLog?.[db.state.travelLog.length - 1];
  const herePlace = mapPlace(lastStop?.placeId);
  const shown: Selection = selection ?? (herePlace && !herePlace.parent ? { kind: 'place', id: herePlace.id } : { kind: 'region', id: here });
  const withYou = people.filter((entry) => entry.basis === 'with-you');
  const elsewhere = people.filter((entry) => entry.basis !== 'with-you');
  const byRegion = new Map<Region, KnownWhereabouts[]>();

  for (const entry of elsewhere) byRegion.set(entry.region, [...(byRegion.get(entry.region) ?? []), entry]);

  const visibleRoad = wholeRoad ? road : road.slice(0, ROAD_PREVIEW);

  return (
    <>
      <SectionLabel>You are here</SectionLabel>
      <ListCard>
        <ListRow
          leading={
            <View style={styles.weatherBadge}>
              <WeatherIcon color={colors.accentTint} condition={weather.condition} night={weather.night} size={16} />
            </View>
          }
          meta={`${regionLabel(here)} · ${CONDITION_INFO[weather.condition].short}, ${weather.seasonLabel}`}
          title={localizePlaceNames(db.state.location)}
        />
        {withYou.length > 0 ? (
          <ListRow meta="Travelling with you" title={withYou.map((entry) => entry.entity.name).join(', ')} />
        ) : null}
      </ListCard>

      <WorldBoard db={db} onSelect={setSelection} selection={shown} />
      <Text style={styles.legend}>
        Tap a country or a place. White dots are places you have been; the red line is your road. Numbers count people you know of there.
      </Text>

      <SelectedCard db={db} people={people} selection={shown} />

      <SectionLabel>Where people are, as far as you know</SectionLabel>
      {byRegion.size > 0 ? (
        <>
          <Text style={styles.legend}>What you were told or last saw. It may not be true any more.</Text>
          {[...byRegion.entries()].map(([region, entries]) => (
            <View key={region} style={styles.group}>
              <Text style={styles.groupLabel}>{regionLabel(region)}</Text>
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
              meta={`${dateLine(stop.date)}${stop.region ? ` · ${regionLabel(stop.region as Region)}` : ''}`}
              title={localizePlaceNames(stop.place)}
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
  board: {
    width: '100%',
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#07090b',
  },
  legend: {
    ...type.rowMeta,
    color: colors.textDim,
    marginTop: -spacing.xs,
  },
  weatherBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
