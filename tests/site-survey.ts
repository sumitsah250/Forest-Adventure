// Survey: ASCII map of slope and features, plus flatness at candidate mission sites.
// Run with: node tests/site-survey.ts [x z ...]
import { TerrainData } from '../src/world/terrain.ts';
import { SITES } from '../src/world/layout.ts';

const t = new TerrainData();
const step = 10;
const rows: string[] = [];
for (let z = -290; z <= 290; z += step) {
  let row = `${String(z).padStart(5)} `;
  for (let x = -290; x <= 290; x += step) {
    const road = t.roadAt(x, z);
    const water = t.waterAt(x, z);
    let ch = '.';
    const s = t.slopeAt(x, z);
    if (s > 0.6) ch = '#';
    else if (s > 0.35) ch = '+';
    else if (s > 0.18) ch = ':';
    if (water) ch = '~';
    if (road && Math.abs(road.signed) < road.path.halfWidth + 1) ch = road.path.kind === 'foot' ? 'f' : road.path.kind === 'track' ? 't' : 'R';
    for (const [name, site] of Object.entries(SITES)) if (Math.hypot(site.x - x, site.z - z) < step * 0.6) ch = name[0].toUpperCase();
    row += ch;
  }
  rows.push(row);
}
console.log(`x from -290 to 290 step ${step}; '.' flat, ':' gentle, '+' steep, '#' cliff, R road, t track, f trail, ~ water, capitals = sites`);
console.log(rows.join('\n'));

/** Flatness of a disc: max height deviation from the centre within radius r. */
function flat(x: number, z: number, r: number): { h: number; dev: number; slope: number } {
  const h = t.heightAt(x, z);
  let dev = 0;
  for (let a = 0; a < 16; a += 1) {
    for (const f of [0.5, 1]) {
      const px = x + Math.cos((a / 16) * Math.PI * 2) * r * f;
      const pz = z + Math.sin((a / 16) * Math.PI * 2) * r * f;
      dev = Math.max(dev, Math.abs(t.heightAt(px, pz) - h));
    }
  }
  return { h, dev, slope: t.slopeAt(x, z) };
}

const args = (globalThis as unknown as { process: { argv: string[] } }).process.argv.slice(2).map(Number);
for (let i = 0; i + 1 < args.length; i += 2) {
  const f = flat(args[i], args[i + 1], 12);
  const road = t.roadAt(args[i], args[i + 1]);
  console.log(`(${args[i]}, ${args[i + 1]}) h=${f.h.toFixed(1)} dev12=${f.dev.toFixed(2)} slope=${f.slope.toFixed(2)} surface=${t.surfaceAt(args[i], args[i + 1])}${road ? ` road ${road.path.id} s=${road.s.toFixed(0)} d=${road.signed.toFixed(1)}` : ''}`);
}
