// Quick diagnostic: builds the terrain and prints heights at the designed sites.
import { TerrainData } from '../src/world/terrain.ts';
import { SITES } from '../src/world/layout.ts';

const t0 = performance.now();
const terrain = new TerrainData();
const t1 = performance.now();
console.log(`terrain built in ${(t1 - t0).toFixed(0)} ms`);
let min = Infinity;
let max = -Infinity;
for (const h of terrain.heights) { min = Math.min(min, h); max = Math.max(max, h); }
console.log(`height range ${min.toFixed(1)} .. ${max.toFixed(1)}`);
for (const [name, site] of Object.entries(SITES)) {
  const h = terrain.heightAt(site.x, site.z);
  const water = terrain.waterAt(site.x, site.z);
  const road = terrain.roadAt(site.x, site.z);
  console.log(
    `${name.padEnd(13)} h=${h.toFixed(2).padStart(6)} slope=${terrain.slopeAt(site.x, site.z).toFixed(2)} surface=${terrain.surfaceAt(site.x, site.z)}` +
      (road ? ` road=${road.path.id}@${road.s.toFixed(0)} d=${road.signed.toFixed(1)}` : '') +
      (water ? ` water depth=${water.depth.toFixed(2)}` : ''),
  );
}
const gap = terrain.bridgeGap();
console.log('bridge gap', gap);
const main = terrain.roads[0];
console.log(`main road length ${main.length.toFixed(0)} m`);
let maxGrade = 0;
for (let s = 0; s < main.length - 2; s += 2) {
  const a = main.at(s);
  const b = main.at(s + 2);
  const ha = terrain.heightAt(a.x, a.z);
  const hb = terrain.heightAt(b.x, b.z);
  if (gap && s > gap.s0 - 2 && s < gap.s1 + 2) continue;
  maxGrade = Math.max(maxGrade, Math.abs(hb - ha) / 2);
}
console.log(`max main road grade (sampled on mesh) ${(maxGrade * 100).toFixed(1)}%`);
const ford = terrain.roads[2];
for (let s = 0; s < ford.length; s += 10) {
  const p = ford.at(s);
  const w = terrain.waterAt(p.x, p.z);
  console.log(`ford s=${s.toString().padStart(3)} (${p.x.toFixed(0)},${p.z.toFixed(0)}) h=${terrain.heightAt(p.x, p.z).toFixed(2)}${w ? ' water ' + w.depth.toFixed(2) : ''}`);
}
for (let s = 0; s < terrain.creek.length; s += 60) {
  const c = terrain.creekAt(s);
  const p = terrain.creek.at(s);
  console.log(`creek s=${s.toFixed(0).padStart(4)} (${p.x.toFixed(0)},${p.z.toFixed(0)}) level=${c.level.toFixed(2)} bed=${terrain.heightAt(p.x, p.z).toFixed(2)}`);
}
