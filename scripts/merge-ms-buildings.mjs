// Adds buildings that OpenStreetMap is missing to src/campus/campusData.json, from
// Microsoft's Global ML Building Footprints (footprints detected in satellite imagery).
//
// Checked against each other on the campus, the two sources agree closely: matched
// buildings sit within about 1 m and their areas agree within a few percent, so OSM
// stays the primary source. Microsoft footprints are added only where no OSM building
// covers them (confident detections, at least 12 m², overlapping no OSM building).
//
//   node scripts/merge-ms-buildings.mjs            (downloads the 31 MB tile)
//   node scripts/merge-ms-buildings.mjs tile.csv.gz (uses a downloaded tile)
//
// Run after build-campus-data.mjs (which rewrites the file from OSM) and
// build-campus-dem.mjs. Building footprints © Microsoft, ODbL 1.0.

import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src/campus/campusData.json');
const LINKS = 'https://bfppub.blob.core.windows.net/%24web/2026-07-24/dataset-links.csv';
const UA = 'hollow-creek-campus-builder/0.1';
const RANGE = 460;
const MIN_CONF = 0.85;
const MIN_AREA = 12;

const data = JSON.parse(await readFile(DATA, 'utf8'));
const { lat: lat0, lon: lon0 } = data.origin;
const KX = 111320 * Math.cos((lat0 * Math.PI) / 180);
const KZ = 110574;

function quadkey(lat, lon, z) {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  let q = '';
  for (let i = z; i > 0; i -= 1) {
    const m = 1 << (i - 1);
    q += ((x & m) ? 1 : 0) + ((y & m) ? 2 : 0);
  }
  return q;
}

let tile = process.argv[2];
if (!tile) {
  const qk = quadkey(lat0, lon0, 9);
  const links = await (await fetch(LINKS, { headers: { 'User-Agent': UA } })).text();
  const row = links.split('\n').find((l) => l.startsWith('Nepal,') && l.split(',')[1] === qk);
  if (!row) throw new Error(`no Microsoft footprint tile for quadkey ${qk}`);
  const url = row.split(',')[2];
  tile = join(await mkdtemp(join(tmpdir(), 'msb-')), 'tile.csv.gz');
  console.log(`downloading ${url}`);
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tile));
}

const pip = (x, z, p) => {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i];
    const [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const area = (p) => {
  let s = 0;
  for (let i = 0; i < p.length; i += 1) {
    const [a, b] = p[i];
    const [c, d] = p[(i + 1) % p.length];
    s += a * d - b * c;
  }
  return Math.abs(s / 2);
};
const bbox = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];

// Footprints in range.
const ms = [];
const rl = createInterface({ input: createReadStream(tile).pipe(createGunzip()) });
for await (const line of rl) {
  let f;
  try {
    f = JSON.parse(line);
  } catch {
    continue;
  }
  const ring = f.geometry?.coordinates?.[0];
  if (!ring) continue;
  const pts = ring.map(([lon, lat]) => [Math.round((lon - lon0) * KX * 10) / 10, Math.round(-(lat - lat0) * KZ * 10) / 10]);
  if (pts.every(([x, z]) => Math.abs(x) > RANGE || Math.abs(z) > RANGE)) continue;
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  ms.push({ pts, conf: f.properties?.confidence ?? 0 });
}

// Keep only footprints that no OSM building overlaps (sampled on a 0.5 m grid).
const osm = data.buildings.filter((b) => b.source !== 'ms').map((b) => ({ pts: b.pts, bb: bbox(b.pts) }));
data.buildings = data.buildings.filter((b) => b.source !== 'ms');
let added = 0;
for (const m of ms) {
  const a = area(m.pts);
  if (m.conf < MIN_CONF || a < MIN_AREA) continue;
  const bb = bbox(m.pts);
  const near = osm.filter((o) => o.bb[0] < bb[2] + 1 && o.bb[2] > bb[0] - 1 && o.bb[1] < bb[3] + 1 && o.bb[3] > bb[1] - 1);
  let inside = 0;
  let hit = 0;
  for (let x = bb[0]; x <= bb[2]; x += 0.5) {
    for (let z = bb[1]; z <= bb[3]; z += 0.5) {
      if (!pip(x, z, m.pts)) continue;
      inside += 1;
      if (near.some((o) => pip(x, z, o.pts))) hit += 1;
    }
  }
  if (!inside || hit / inside > 0.1) continue;
  const cx = m.pts.reduce((s, p) => s + p[0], 0) / m.pts.length;
  const cz = m.pts.reduce((s, p) => s + p[1], 0) / m.pts.length;
  data.buildings.push({ pts: m.pts, kind: 'yes', inside: pip(cx, cz, data.boundary), source: 'ms' });
  added += 1;
}
data.source = `${data.source}; extra footprints Microsoft Global ML Building Footprints (ODbL 1.0)`.replace(/(; extra footprints[^;]*)+/, '; extra footprints Microsoft Global ML Building Footprints (ODbL 1.0)');
await writeFile(DATA, JSON.stringify(data));
console.log(`${ms.length} Microsoft footprints in range; added ${added} that OSM lacks (${data.buildings.filter((b) => b.source === 'ms' && b.inside).length} inside the campus)`);
