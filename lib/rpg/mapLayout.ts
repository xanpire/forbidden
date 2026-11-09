// The drawn map (session 7): an automatic layout of the world's areas from the
// travel graph (neighbours pull together, everyone else pushes apart), with
// each area's places in a small ring around it. Deterministic: the same world
// always draws the same map.
import type { WorldDefinition } from './types';

export type MapPoint = { id: string; name: string; x: number; y: number };
export type MapLayout = { regions: MapPoint[]; places: (MapPoint & { regionId: string })[]; roads: { from: string; to: string; days: number }[] };

export function layoutWorld(world: Pick<WorldDefinition, 'regions' | 'places'>): MapLayout {
  const regions = world.regions.filter((region) => region.name.trim());
  const n = regions.length;
  const index = new Map(regions.map((region, i) => [region.id, i]));
  // Start on a circle.
  const pos = regions.map((_, i) => ({ x: Math.cos((2 * Math.PI * i) / Math.max(1, n)), y: Math.sin((2 * Math.PI * i) / Math.max(1, n)) }));
  const roads: MapLayout['roads'] = [];
  const seen = new Set<string>();
  for (const region of regions) {
    for (const next of region.neighbours) {
      if (!index.has(next.id)) continue;
      const key = [region.id, next.id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      roads.push({ from: region.id, to: next.id, days: next.days });
    }
  }
  const longest = Math.max(1e-6, ...roads.map((road) => road.days));

  for (let step = 0; step < 300; step += 1) {
    const force = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d2 = Math.max(0.01, dx * dx + dy * dy);
        const push = 0.02 / d2;
        force[i].x += dx * push;
        force[i].y += dy * push;
        force[j].x -= dx * push;
        force[j].y -= dy * push;
      }
    }
    for (const road of roads) {
      const a = index.get(road.from)!;
      const b = index.get(road.to)!;
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      // Longer roads want more room.
      const want = 0.35 + 0.65 * Math.sqrt(road.days / longest);
      const pull = (d - want) * 0.08;
      force[a].x += (dx / d) * pull;
      force[a].y += (dy / d) * pull;
      force[b].x -= (dx / d) * pull;
      force[b].y -= (dy / d) * pull;
    }
    const cool = 1 - step / 300;
    for (let i = 0; i < n; i += 1) {
      pos[i].x += Math.max(-0.1, Math.min(0.1, force[i].x)) * cool;
      pos[i].y += Math.max(-0.1, Math.min(0.1, force[i].y)) * cool;
    }
  }

  // Fit into 0.12..0.88 so labels have room.
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(1e-6, maxX - minX, maxY - minY);
  const fit = (value: number, min: number, size: number) => (n === 1 ? 0.5 : 0.12 + 0.76 * ((value - min) / span) + (0.76 - (0.76 * size) / span) / 2);
  const regionPoints = regions.map((region, i) => ({ id: region.id, name: region.name, x: fit(pos[i].x, minX, maxX - minX), y: fit(pos[i].y, minY, maxY - minY) }));

  const places = world.places
    .filter((place) => place.name.trim())
    .map((place) => {
      const home = regionPoints.find((region) => region.id === place.regionId);
      const siblings = world.places.filter((other) => other.regionId === place.regionId);
      const k = siblings.findIndex((other) => other.id === place.id);
      const angle = (2 * Math.PI * k) / Math.max(1, siblings.length) + 0.4;
      return { id: place.id, name: place.name, regionId: place.regionId, x: (home?.x ?? 0.5) + Math.cos(angle) * 0.13, y: (home?.y ?? 0.5) + Math.sin(angle) * 0.09 };
    });

  return { regions: regionPoints, places, roads };
}
