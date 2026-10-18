import { TerrainData } from '../src/world/terrain.ts';
const terrain = new TerrainData();
const gap = terrain.bridgeGap();
for (const [ri, road] of terrain.roads.entries()) {
  const rows: string[] = [];
  for (let s = 0; s < road.length - 2; s += 2) {
    const a = road.at(s); const b = road.at(s + 2);
    if (ri === 0 && gap && s > gap.s0 - 2 && s < gap.s1 + 2) continue;
    const g = Math.abs(terrain.heightAt(b.x, b.z) - terrain.heightAt(a.x, a.z)) / 2;
    if (g > 0.17) rows.push(`s=${s} (${a.x.toFixed(0)},${a.z.toFixed(0)}) grade=${(g*100).toFixed(0)}% h=${terrain.heightAt(a.x,a.z).toFixed(2)} prof=${terrain.roadSurfaceHeight(ri, s).toFixed(2)}`);
  }
  console.log(road.id, road.kind, rows.length ? rows.slice(0, 12).join('\n  ') : 'ok');
}
