// Replaces the elevation grid in src/campus/campusData.json with a finer one: 10 m
// spacing sampled from the AWS Terrain Tiles (terrarium encoding, zoom 15; SRTM
// 1-arc-second / ~30 m source over Nepal). The original grid came from a 90 m DEM.
//
//   node scripts/build-campus-dem.mjs
//
// Elevation: Mapzen/AWS Terrain Tiles (SRTM, public domain; see
// https://github.com/tilezen/joerd/blob/master/docs/attribution.md).

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'src/campus/campusData.json');
const UA = 'hollow-creek-campus-builder/0.1';
const Z = 15;
const HALF = 420;
const STEP = 10;

const data = JSON.parse(await readFile(DATA, 'utf8'));
const { lat: lat0, lon: lon0 } = data.origin;
const KX = 111320 * Math.cos((lat0 * Math.PI) / 180);
const KZ = 110574;

/** Minimal PNG decoder: 8-bit RGB / RGBA, non-interlaced (what terrarium tiles are). */
function decodePng(buf) {
  let p = 8;
  let w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error('unsupported PNG (bit depth / interlace)');
      ct = body[9];
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${ct}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = out.subarray(y * stride, (y + 1) * stride);
    const up = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = up ? up[i] : 0;
      const c = up && i >= bpp ? up[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  return { w, h, bpp, px: out };
}

const n2 = 2 ** Z;
const tileXY = (lat, lon) => {
  const x = ((lon + 180) / 360) * n2;
  const r = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n2;
  return [x, y];
};
const tiles = new Map();
async function tile(tx, ty) {
  const key = `${tx}/${ty}`;
  if (!tiles.has(key)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    tiles.set(key, decodePng(Buffer.from(await res.arrayBuffer())));
    console.log(`tile ${key}`);
  }
  return tiles.get(key);
}
async function elevPx(gx, gy) {
  // gx, gy: global pixel coordinates at zoom Z (256 px tiles).
  const tx = Math.floor(gx / 256), ty = Math.floor(gy / 256);
  const t = await tile(tx, ty);
  const x = Math.min(255, Math.max(0, gx - tx * 256)), y = Math.min(255, Math.max(0, gy - ty * 256));
  const i = (y * t.w + x) * t.bpp;
  return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768;
}
async function elevation(lat, lon) {
  // Bilinear between pixel centres.
  const [fx, fy] = tileXY(lat, lon);
  const gx = fx * 256 - 0.5, gy = fy * 256 - 0.5;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const tx = gx - x0, ty = gy - y0;
  const a = await elevPx(x0, y0), b = await elevPx(x0 + 1, y0), c = await elevPx(x0, y0 + 1), d = await elevPx(x0 + 1, y0 + 1);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

const n = Math.round((HALF * 2) / STEP) + 1;
const h = [];
for (let zi = 0; zi < n; zi += 1) {
  for (let xi = 0; xi < n; xi += 1) {
    const x = -HALF + xi * STEP;
    const z = -HALF + zi * STEP;
    h.push(await elevation(lat0 - z / KZ, lon0 + x / KX));
  }
}
const base = Math.min(...h);
data.elevation = { half: HALF, n, base: Math.round(base * 10) / 10, h: h.map((v) => Math.round((v - base) * 10) / 10), source: 'AWS Terrain Tiles (SRTM 1 arc-second), terrarium z15' };
data.source = 'OpenStreetMap contributors (ODbL 1.0); elevation SRTM via AWS Terrain Tiles';
await writeFile(DATA, JSON.stringify(data));
console.log(`elevation ${n}x${n} at ${STEP} m, base ${base.toFixed(1)} m, range ${Math.max(...h) - base} m`);
