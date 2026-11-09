// The drawn map of the player's world (session 7): areas laid out from the
// travel graph, roads with travel times, places around their area, and you.
import { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import { colors, radius, spacing } from '@/constants/theme';
import { currentRegion } from '@/lib/rpg/geography';
import { layoutWorld } from '@/lib/rpg/mapLayout';
import type { AppDatabase } from '@/lib/rpg/types';

function travelLabel(days: number) {
  const hours = days * 24;
  if (hours < 1) return `${Math.max(5, Math.round(hours * 60))} min`;
  if (hours < 36) return `${Math.round(hours)} h`;
  return `${Math.round(days)} d`;
}

export function WorldMap({ db }: { db: AppDatabase }) {
  const { width: screen } = useWindowDimensions();
  const layout = useMemo(() => layoutWorld(db.world), [db.world]);
  const here = currentRegion(db);
  const hereId = db.world.regions.find((region) => region.name === here || region.id === here)?.id;
  const place = db.world.places.find((item) => item.name.toLowerCase() === db.state.location.toLowerCase());
  if (layout.regions.length === 0) return null;
  const width = Math.min(screen, 680) - spacing.xl * 2;
  const height = Math.round(width * 0.75);
  const at = (p: { x: number; y: number }) => ({ x: p.x * width, y: p.y * height });
  const byId = new Map(layout.regions.map((region) => [region.id, region]));

  return (
    <View style={styles.card}>
      <Svg accessibilityLabel="Map of your world" height={height} width={width}>
        {layout.roads.map((road) => {
          const a = at(byId.get(road.from)!);
          const b = at(byId.get(road.to)!);
          return (
            <G key={`${road.from}-${road.to}`}>
              <Line stroke={colors.borderStrong} strokeDasharray="4 4" strokeWidth={1.5} x1={a.x} x2={b.x} y1={a.y} y2={b.y} />
              <SvgText fontFamily="Manrope_600SemiBold" fill={colors.textDim} fontSize={10} textAnchor="middle" x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4}>
                {travelLabel(road.days)}
              </SvgText>
            </G>
          );
        })}
        {layout.places.map((item) => {
          const p = at(item);
          const isHere = place?.id === item.id;
          return (
            <G key={item.id}>
              <Circle cx={p.x} cy={p.y} fill={isHere ? colors.accent : colors.textMuted} r={isHere ? 4 : 2.5} />
              <SvgText fontFamily="Manrope_600SemiBold" fill={isHere ? colors.accentText : colors.textDim} fontSize={9} textAnchor="middle" x={p.x} y={p.y + 13}>
                {item.name.length > 18 ? `${item.name.slice(0, 17)}…` : item.name}
              </SvgText>
            </G>
          );
        })}
        {layout.regions.map((region) => {
          const p = at(region);
          const isHere = region.id === hereId;
          return (
            <G key={region.id}>
              <Circle cx={p.x} cy={p.y} fill={isHere ? colors.accentSoft : colors.surfaceRaised} r={14} stroke={isHere ? colors.accent : colors.borderStrong} strokeWidth={isHere ? 2 : 1} />
              <SvgText fontFamily="Manrope_600SemiBold" fill={isHere ? colors.accentText : colors.text} fontSize={11} fontWeight="700" textAnchor="middle" x={p.x} y={p.y - 20}>
                {region.name}
              </SvgText>
            </G>
          );
        })}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.xl, borderWidth: 1, marginBottom: spacing.md, paddingVertical: spacing.sm },
});
