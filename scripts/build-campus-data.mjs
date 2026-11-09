// Builds src/campus/campusData.json: the IOE Pashchimanchal Campus (Lamachaur, Pokhara) from
// OpenStreetMap (buildings, paths, grounds, trees, landmarks) plus a coarse elevation grid from
// Open-Meteo (Copernicus DEM). Coordinates are local metres: +x east, +z south, origin at the
// centre of the campus boundary.
//
//   node scripts/build-campus-data.mjs
//
// Map data © OpenStreetMap contributors, ODbL 1.0. Elevation: Copernicus DEM GLO-90 via Open-Meteo.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/campus/campusData.json');
const CAMPUS_WAY = 120748084;
const UA = 'hollow-creek-campus-builder/0.1';
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

async function overpass(query) {
  let last;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: AbortSignal.timeout(90000) });
      const text = await res.text();
      if (res.ok && text.trim().startsWith('{')) return JSON.parse(text);
      last = new Error(`${url}: HTTP ${res.status} ${text.slice(0, 80)}`);
    } catch (e) {
      last = e;
    }
    console.warn(`overpass attempt ${attempt + 1} failed: ${last.message}`);
    await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
  }
  throw last;
}

const inside = await overpass(`[out:json][timeout:90];way(${CAMPUS_WAY});out geom;way(${CAMPUS_WAY});map_to_area->.a;(nwr(area.a););out geom;`);
const boundaryWay = inside.elements.find((e) => e.type === 'way' && e.id === CAMPUS_WAY);
let mnla = 90, mxla = -90, mnlo = 180, mxlo = -180;
for (const p of boundaryWay.geometry) {
  mnla = Math.min(mnla, p.lat); mxla = Math.max(mxla, p.lat);
  mnlo = Math.min(mnlo, p.lon); mxlo = Math.max(mxlo, p.lon);
}
const lat0 = (mnla + mxla) / 2;
const lon0 = (mnlo + mxlo) / 2;
const KX = 111320 * Math.cos((lat0 * Math.PI) / 180);
const KZ = 110574;
const toLocal = (p) => [Math.round((p.lon - lon0) * KX * 10) / 10, Math.round(-(p.lat - lat0) * KZ * 10) / 10];

// Context outside the campus: roads and buildings within ~130 m of the boundary.
const pad = 0.0013;
const around = await overpass(`[out:json][timeout:90];(way["highway"](${mnla - pad},${mnlo - pad},${mxla + pad},${mxlo + pad});way["building"](${mnla - pad},${mnlo - pad},${mxla + pad},${mxlo + pad}););out geom;`);

const seen = new Set();
const all = [];
for (const e of [...inside.elements, ...around.elements]) {
  const key = `${e.type}${e.id}`;
  if (seen.has(key)) continue;
  seen.add(key);
  all.push(e);
}
const insideIds = new Set(inside.elements.map((e) => `${e.type}${e.id}`));

function rings(e) {
  if (e.type === 'way') return e.geometry ? [e.geometry] : [];
  if (e.type === 'relation') return (e.members || []).filter((m) => m.role === 'outer' && m.geometry).map((m) => m.geometry);
  return [];
}
const closed = (g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon;
const poly = (g) => {
  const pts = g.map(toLocal);
  if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
  return pts;
};
const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};
const colour = (v) => {
  if (!v) return undefined;
  const named = { white: '#ecebe4', grey: '#8d9091', gray: '#8d9091', brown: '#7a4a32', blue: '#3d6aa0', red: '#a3352b', orange: '#d98a3f', green: '#4f7b3c', yellow: '#e8d77a', cream: '#efe6c8', maroon: '#6e2a2a' };
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  return named[v.toLowerCase()];
};

const out = {
  source: 'OpenStreetMap contributors (ODbL 1.0); elevation Copernicus DEM GLO-90 via Open-Meteo',
  origin: { lat: lat0, lon: lon0 },
  boundary: poly(boundaryWay.geometry),
  buildings: [],
  areas: [],
  lines: [],
  points: [],
  elevation: null,
};

const AREA_KIND = (t) => {
  if (t.leisure === 'pitch') return 'pitch';
  if (t.landuse === 'recreation_ground') return 'ground';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  if (t.landuse === 'grass' || t.natural === 'grassland' || t.landuse === 'greenfield') return 'grass';
  if (t.landuse === 'orchard' || t.landuse === 'farmland') return 'orchard';
  if (t.natural === 'scrub' || t.natural === 'shrub') return 'scrub';
  if (t.amenity === 'parking' || t.amenity === 'motorcycle_parking' || t.amenity === 'bicycle_parking') return 'parking';
  if (t.natural === 'water' || t.man_made === 'reservoir_covered') return 'water';
  if (t.leisure === 'outdoor_seating' || t.leisure === 'bleachers') return 'plaza';
  if (t.landuse === 'residential') return 'residential';
  return null;
};
const LINE_WIDTH = { primary: 9, secondary: 8, tertiary: 7, unclassified: 6, residential: 5.5, service: 4.5, track: 3, footway: 2.4, path: 1.6, steps: 2.4, pedestrian: 4, cycleway: 2 };

for (const e of all) {
  const t = e.tags || {};
  const isInside = insideIds.has(`${e.type}${e.id}`);
  if (e.type === 'node') {
    const [x, z] = toLocal(e);
    let kind = null;
    if (t.natural === 'tree') kind = 'tree';
    else if (t.amenity === 'bench') kind = 'bench';
    else if (t.highway === 'street_lamp') kind = 'lamp';
    else if (t.tourism === 'artwork' || t.historic === 'memorial') kind = 'statue';
    else if (t.amenity === 'fountain') kind = 'fountain';
    else if (t.man_made === 'flagpole') kind = 'flagpole';
    else if (t.tourism === 'information') kind = 'board';
    else if (t.amenity === 'waste_disposal' || t.amenity === 'waste_basket') kind = 'bin';
    else if (t.man_made === 'water_tower') kind = 'watertower';
    else if (t.amenity === 'drinking_water' || t.man_made === 'water_tap' || t.amenity === 'water_point') kind = 'tap';
    else if (t.name) kind = 'poi';
    if (kind) out.points.push({ kind, x, z, ...(t.name ? { name: t['name:en'] || t.name } : {}) });
    continue;
  }
  if (e.id === CAMPUS_WAY) continue;
  if (t.building) {
    for (const g of rings(e)) {
      if (!closed(g)) continue;
      const pts = poly(g);
      const levels = num(t['building:levels']);
      let height = num(t.height);
      if (height !== undefined && height < 2) height = undefined; // e.g. motorcycle shed tagged 0.25
      out.buildings.push({
        ...(t.name ? { name: t['name:en'] || t.name } : {}),
        pts,
        ...(levels ? { levels } : {}),
        ...(height ? { height } : {}),
        ...(colour(t['building:colour']) ? { wall: colour(t['building:colour']) } : {}),
        ...(colour(t['roof:colour']) ? { roof: colour(t['roof:colour']) } : {}),
        ...(t['roof:shape'] ? { roofShape: t['roof:shape'] } : {}),
        kind: t.amenity === 'library' ? 'library' : t.building,
        inside: isInside,
      });
    }
    continue;
  }
  if (t.highway && e.type === 'way' && e.geometry) {
    const area = t.area === 'yes' || (closed(e.geometry) && t.highway === 'pedestrian');
    out.lines.push({ kind: t.highway, pts: e.geometry.map(toLocal), w: LINE_WIDTH[t.highway] ?? 3, ...(t.surface ? { surface: t.surface } : {}), ...(t.name ? { name: t['name:en'] || t.name } : {}), ...(area ? { area: true } : {}), ...(t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.covered === 'yes' ? { tunnel: true } : {}) });
    continue;
  }
  if (t.barrier === 'fence' || t.barrier === 'wall' || t.man_made === 'wall' || t.man_made === 'wal') {
    if (e.geometry) out.lines.push({ kind: t.barrier === 'fence' ? 'fence' : 'wall', pts: e.geometry.map(toLocal), w: 0.3 });
    if (t.landuse !== 'grass') continue;
  }
  if (t.waterway === 'drain' && e.geometry) {
    out.lines.push({ kind: 'drain', pts: e.geometry.map(toLocal), w: 0.8 });
    continue;
  }
  const kind = AREA_KIND(t);
  if (kind) {
    for (const g of rings(e)) {
      if (!closed(g)) continue;
      out.areas.push({ kind, pts: poly(g), ...(t.sport ? { sport: t.sport } : {}), ...(t.name ? { name: t['name:en'] || t.name } : {}), ...(t.surface ? { surface: t.surface } : {}) });
    }
  }
}

// Elevation grid (metres above the lowest sample), 60 m spacing over the playable square.
const HALF = 420;
const STEP = 60;
const n = Math.round((HALF * 2) / STEP) + 1;
const coords = [];
for (let zi = 0; zi < n; zi += 1) {
  for (let xi = 0; xi < n; xi += 1) {
    const x = -HALF + xi * STEP;
    const z = -HALF + zi * STEP;
    coords.push({ lat: lat0 - z / KZ, lon: lon0 + x / KX });
  }
}
const heights = [];
for (let i = 0; i < coords.length; i += 100) {
  const chunk = coords.slice(i, i + 100);
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${chunk.map((c) => c.lat.toFixed(6)).join(',')}&longitude=${chunk.map((c) => c.lon.toFixed(6)).join(',')}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`elevation HTTP ${res.status}`);
  const j = await res.json();
  heights.push(...j.elevation);
  await new Promise((r) => setTimeout(r, 400));
}
const base = Math.min(...heights);
out.elevation = { half: HALF, n, base, h: heights.map((h) => Math.round((h - base) * 10) / 10) };

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${out.buildings.length} buildings, ${out.areas.length} areas, ${out.lines.length} lines, ${out.points.length} points, elevation ${n}x${n} (${base} m base, range ${Math.max(...out.elevation.h)} m)`);
