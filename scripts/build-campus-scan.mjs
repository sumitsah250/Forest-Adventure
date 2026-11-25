// Rebuilds the campus from the drone survey in "actual models/" (Agisoft Metashape exports):
//   3d model.obj  textured-by-vertex mesh, vertices in lon / lat / elevation (WGS 84)
//   dem.tif       surface model (roofs and tree tops included), float32, WGS 84, ~15 cm
//
//   node scripts/build-campus-scan.mjs raster   # step 1: both files → 0.5 m rasters in game metres (cached)
//   node scripts/build-campus-scan.mjs          # all steps (reuses the cached rasters)
//
// Game coordinates as in build-campus-data.mjs: +x east, +z south, metres from data.origin.
// The raw survey files are large (400 MB + 90 MB) and stay out of git; only what is derived
// from them (campusData.json changes and the surface map image) is committed.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGeoTiff, streamObj, writePng } from './scan-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'actual models');
const CACHE = join(SRC, '.cache');
const DEBUG = process.env.SCAN_DEBUG ?? join(CACHE, 'debug');
const DATA_PATH = join(ROOT, 'src/campus/campusData.json');

/** Raster spacing and half-extent (m): a little past the playable square (WORLD_HALF 420). */
export const RES = 0.5;
export const HALF = 440;
export const N = Math.round((HALF * 2) / RES) + 1;

const data = JSON.parse(await readFile(DATA_PATH, 'utf8'));
const { lat: LAT0, lon: LON0 } = data.origin;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KZ = 110574;

const toLocalX = (lon) => (lon - LON0) * KX;
const toLocalZ = (lat) => -(lat - LAT0) * KZ;

await mkdir(CACHE, { recursive: true });
await mkdir(DEBUG, { recursive: true });

// ------------------------------------------------------------------ step 1: rasters

async function buildRasters() {
  console.time('dem');
  // Overview level 1 (~0.3 m) is finer than the 0.5 m grid and a quarter of the full image.
  const dem = readGeoTiff(join(SRC, 'dem.tif'), 1);
  console.timeEnd('dem');
  console.log(`dem ${dem.w}x${dem.h}, ${(dem.dlon * KX).toFixed(3)} x ${(dem.dlat * KZ).toFixed(3)} m pixels`);
  const dsm = new Float32Array(N * N).fill(NaN);
  for (let j = 0; j < N; j += 1) {
    const z = -HALF + j * RES;
    const lat = LAT0 - z / KZ;
    const fy = (dem.lat0 - lat) / dem.dlat - 0.5;
    for (let i = 0; i < N; i += 1) {
      const x = -HALF + i * RES;
      const lon = LON0 + x / KX;
      const fx = (lon - dem.lon0) / dem.dlon - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= dem.w || y0 + 1 >= dem.h) continue;
      const tx = fx - x0;
      const ty = fy - y0;
      let s = 0;
      let w = 0;
      for (const [dx, dy, k] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
        const v = dem.data[(y0 + dy) * dem.w + x0 + dx];
        if (Number.isNaN(v)) continue;
        s += v * k;
        w += k;
      }
      if (w > 0.25) dsm[j * N + i] = s / w;
    }
  }

  console.time('obj');
  const cap = 6_000_000;
  let vx = new Float32Array(cap);
  let vz = new Float32Array(cap);
  let vy = new Float32Array(cap);
  let vc = new Uint8Array(cap * 3);
  let nv = 0;
  const top = new Float32Array(N * N).fill(-Infinity);
  const rgb = new Uint8Array(N * N * 3);
  const tri = (a, b, c) => {
    const ax = (vx[a] + HALF) / RES, az = (vz[a] + HALF) / RES;
    const bx = (vx[b] + HALF) / RES, bz = (vz[b] + HALF) / RES;
    const cx = (vx[c] + HALF) / RES, cz = (vz[c] + HALF) / RES;
    const minX = Math.max(0, Math.ceil(Math.min(ax, bx, cx)));
    const maxX = Math.min(N - 1, Math.floor(Math.max(ax, bx, cx)));
    const minZ = Math.max(0, Math.ceil(Math.min(az, bz, cz)));
    const maxZ = Math.min(N - 1, Math.floor(Math.max(az, bz, cz)));
    if (minX > maxX || minZ > maxZ) {
      // Smaller than a cell: splat its centroid.
      const i = Math.round((ax + bx + cx) / 3);
      const j = Math.round((az + bz + cz) / 3);
      if (i < 0 || j < 0 || i >= N || j >= N) return;
      const y = (vy[a] + vy[b] + vy[c]) / 3;
      const k = j * N + i;
      if (y > top[k]) {
        top[k] = y;
        for (let ch = 0; ch < 3; ch += 1) rgb[k * 3 + ch] = (vc[a * 3 + ch] + vc[b * 3 + ch] + vc[c * 3 + ch]) / 3;
      }
      return;
    }
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-9) return;
    for (let j = minZ; j <= maxZ; j += 1) {
      for (let i = minX; i <= maxX; i += 1) {
        const w0 = ((bz - cz) * (i - cx) + (cx - bx) * (j - cz)) / den;
        const w1 = ((cz - az) * (i - cx) + (ax - cx) * (j - cz)) / den;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
        const y = w0 * vy[a] + w1 * vy[b] + w2 * vy[c];
        const k = j * N + i;
        if (y <= top[k]) continue;
        top[k] = y;
        for (let ch = 0; ch < 3; ch += 1) rgb[k * 3 + ch] = w0 * vc[a * 3 + ch] + w1 * vc[b * 3 + ch] + w2 * vc[c * 3 + ch];
      }
    }
  };
  const stats = await streamObj(join(SRC, '3d model.obj'), (lon, lat, el, r, g, b) => {
    if (nv >= vx.length) {
      const grow = (a, n) => { const o = new a.constructor(n); o.set(a); return o; };
      vx = grow(vx, vx.length * 2); vz = grow(vz, vz.length * 2); vy = grow(vy, vy.length * 2); vc = grow(vc, vc.length * 2);
    }
    vx[nv] = toLocalX(lon);
    vz[nv] = toLocalZ(lat);
    vy[nv] = el;
    vc[nv * 3] = Math.round(r * 255);
    vc[nv * 3 + 1] = Math.round(g * 255);
    vc[nv * 3 + 2] = Math.round(b * 255);
    nv += 1;
  }, tri);
  console.timeEnd('obj');
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < nv; i += 1) {
    minX = Math.min(minX, vx[i]); maxX = Math.max(maxX, vx[i]);
    minZ = Math.min(minZ, vz[i]); maxZ = Math.max(maxZ, vz[i]);
    minY = Math.min(minY, vy[i]); maxY = Math.max(maxY, vy[i]);
  }
  console.log(`obj ${stats.vertices} vertices, ${stats.faces} faces; x ${minX.toFixed(0)}..${maxX.toFixed(0)}, z ${minZ.toFixed(0)}..${maxZ.toFixed(0)}, elev ${minY.toFixed(1)}..${maxY.toFixed(1)}`);

  await writeFile(join(CACHE, 'dsm.f32'), Buffer.from(dsm.buffer));
  await writeFile(join(CACHE, 'top.f32'), Buffer.from(top.buffer));
  await writeFile(join(CACHE, 'rgb.u8'), Buffer.from(rgb.buffer));
}

export async function loadRasters() {
  const f32 = async (name) => {
    const b = await readFile(join(CACHE, name));
    return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  };
  const rgbBuf = await readFile(join(CACHE, 'rgb.u8'));
  return { dsm: await f32('dsm.f32'), top: await f32('top.f32'), rgb: new Uint8Array(rgbBuf.buffer, rgbBuf.byteOffset, rgbBuf.byteLength) };
}

/** Debug images at `step` cells per pixel: hillshaded surface, and the mesh colours. */
async function debugRasters(r, step = 2) {
  const W = Math.floor(N / step);
  const shade = new Uint8Array(W * W);
  const col = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = x * step;
      const j = y * step;
      const k = j * N + i;
      const h = r.dsm[k];
      const hx = r.dsm[Math.min(N - 1, i + 1) + j * N] - h;
      const hz = r.dsm[i + Math.min(N - 1, j + 1) * N] - h;
      const nx = -hx / RES, nz = -hz / RES;
      const l = (nx * -0.6 + nz * -0.6 + 1) / Math.hypot(nx, nz, 1);
      shade[y * W + x] = Number.isNaN(h) ? 0 : Math.max(0, Math.min(255, l * 200 + 30));
      for (let c = 0; c < 3; c += 1) col[(y * W + x) * 3 + c] = r.rgb[k * 3 + c];
    }
  }
  await writePng(join(DEBUG, 'dsm-shade.png'), W, W, shade, 1);
  await writePng(join(DEBUG, 'mesh-colour.png'), W, W, col, 3);
}

// ------------------------------------------------------------------ step 2: bare ground

/** Grid of `n`² cells at `res` m, same origin as the 0.5 m rasters. */
function makeGrid(res) {
  const n = Math.round((HALF * 2) / res) + 1;
  return { n, res, a: new Float32Array(n * n).fill(NaN) };
}

/** Min (erode) or max (dilate) over a (2r+1)² square, separable, NaN ignored. */
function morph(src, n, r, useMin) {
  const tmp = new Float32Array(n * n);
  const out = new Float32Array(n * n);
  const pick = useMin ? Math.min : Math.max;
  const init = useMin ? Infinity : -Infinity;
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let v = init;
      for (let d = Math.max(0, i - r); d <= Math.min(n - 1, i + r); d += 1) {
        const s = src[j * n + d];
        if (s === s) v = pick(v, s);
      }
      tmp[j * n + i] = v === init ? NaN : v;
    }
  }
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let v = init;
      for (let d = Math.max(0, j - r); d <= Math.min(n - 1, j + r); d += 1) {
        const s = tmp[d * n + i];
        if (s === s) v = pick(v, s);
      }
      out[j * n + i] = v === init ? NaN : v;
    }
  }
  return out;
}

/** Fills NaN cells from a coarse-to-fine pyramid; known cells keep their values. */
function fillHoles(a, n) {
  if (n <= 2) {
    let s = 0, c = 0;
    for (const v of a) if (v === v) { s += v; c += 1; }
    return a.map((v) => (v === v ? v : c ? s / c : 0));
  }
  const m = Math.ceil(n / 2);
  const small = new Float32Array(m * m).fill(NaN);
  for (let j = 0; j < m; j += 1) {
    for (let i = 0; i < m; i += 1) {
      let s = 0, c = 0;
      for (let dj = 0; dj < 2; dj += 1) for (let di = 0; di < 2; di += 1) {
        const x = i * 2 + di, z = j * 2 + dj;
        if (x >= n || z >= n) continue;
        const v = a[z * n + x];
        if (v === v) { s += v; c += 1; }
      }
      if (c) small[j * m + i] = s / c;
    }
  }
  const filled = fillHoles(small, m);
  const out = Float32Array.from(a);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const k = j * n + i;
      if (out[k] === out[k]) continue;
      const fx = Math.min(m - 1.001, Math.max(0, (i - 0.5) / 2));
      const fz = Math.min(m - 1.001, Math.max(0, (j - 0.5) / 2));
      const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
      const g = (x, z) => filled[Math.min(m - 1, z) * m + Math.min(m - 1, x)];
      out[k] = (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
    }
  }
  return out;
}

function blur(a, n, passes) {
  let g = a;
  for (let p = 0; p < passes; p += 1) {
    const o = new Float32Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        let s = 0, w = 0;
        for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
          const x = Math.min(n - 1, Math.max(0, i + di)), z = Math.min(n - 1, Math.max(0, j + dj));
          const k = (di === 0 ? 2 : 1) * (dj === 0 ? 2 : 1);
          s += g[z * n + x] * k;
          w += k;
        }
        o[j * n + i] = s / w;
      }
    }
    g = o;
  }
  return g;
}

/**
 * Bare ground from the surface model: a progressive morphological filter (Zhang et al. 2003)
 * on a 1 m minimum grid. Openings with growing windows strip objects narrower than the window;
 * a cell is off-ground when it stands above the opened surface by more than the slope allows.
 * Windows reach 51 m, wider than the widest campus block.
 */
function bareGround(r) {
  const g = makeGrid(1);
  const n = g.n;
  const k = Math.round(1 / RES);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      let v = Infinity;
      for (let dj = 0; dj < k; dj += 1) for (let di = 0; di < k; di += 1) {
        const x = i * k + di, z = j * k + dj;
        if (x >= N || z >= N) continue;
        const s = r.dsm[z * N + x];
        if (s === s) v = Math.min(v, s);
      }
      g.a[j * n + i] = v === Infinity ? NaN : v;
    }
  }
  const valid = g.a.map((v) => (v === v ? 1 : 0));
  const pmf = new Uint8Array(n * n);
  let surf = Float32Array.from(g.a);
  let prevW = 1;
  for (const rad of [1, 2, 4, 8, 13, 19, 25]) {
    const w = rad * 2 + 1;
    const opened = morph(morph(surf, n, rad, true), n, rad, false);
    const dh = Math.min(3.2, 0.35 + 0.22 * (w - prevW));
    for (let c = 0; c < n * n; c += 1) {
      if (surf[c] === surf[c] && opened[c] === opened[c] && surf[c] - opened[c] > dh) pmf[c] = 1;
    }
    surf = opened;
    prevW = w;
  }
  // The filter also strips upper terraces narrower than its widest window. Each flagged patch is
  // judged on its own: kept off the ground if it is walled in (a drop on most of its rim, like a
  // building), rough (tree crowns) or under a mapped building; otherwise it is a terrace.
  const rough = roughness(g.a, n);
  const footprint = new Uint8Array(n * n);
  for (const b of data.buildings) {
    const c = cellsIn(b.pts, 1);
    for (let i = 0; i < c.length; i += 2) {
      const x = Math.round(c[i] + HALF), z = Math.round(c[i + 1] + HALF);
      if (x >= 0 && z >= 0 && x < n && z < n) footprint[z * n + x] = 1;
    }
  }
  const offGround = new Uint8Array(n * n);
  const seen = new Uint8Array(n * n);
  const stack = [];
  let terraces = 0;
  for (let s = 0; s < n * n; s += 1) {
    if (!pmf[s] || seen[s]) continue;
    const comp = [];
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const c = stack.pop();
      comp.push(c);
      const x = c % n, z = (c - x) / n;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, zz = z + dz;
        if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
        const o = zz * n + xx;
        if (pmf[o] && !seen[o]) { seen[o] = 1; stack.push(o); }
      }
    }
    let rim = 0, drop = 0, rsum = 0, fp = 0;
    for (const c of comp) {
      rsum += rough[c];
      fp += footprint[c];
      const x = c % n, z = (c - x) / n;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx * 2, zz = z + dz * 2;
        if (xx < 0 || zz < 0 || xx >= n || zz >= n) continue;
        const o = zz * n + xx;
        if (pmf[o] || !valid[o]) continue;
        rim += 1;
        if (g.a[c] - g.a[o] > 1.2) drop += 1;
      }
    }
    const walled = rim === 0 || drop / rim > 0.45;
    const treeish = rsum / comp.length > 0.45;
    const mapped = fp / comp.length > 0.3;
    if (walled || treeish || mapped || comp.length < 30) for (const c of comp) offGround[c] = 1;
    else terraces += 1;
  }
  for (let c = 0; c < n * n; c += 1) if (footprint[c]) offGround[c] = 1;
  console.log(`ground: ${terraces} raised patches kept as terraces`);
  const ground = new Float32Array(n * n).fill(NaN);
  for (let c = 0; c < n * n; c += 1) if (valid[c] && !offGround[c]) ground[c] = g.a[c];
  const dtm = blur(fillHoles(ground, n), n, 2);
  return { n, res: 1, dtm, offGround, valid };
}

/** Bilinear lookup in a grid with the rasters' origin. */
function sample(grid, n, res, x, z) {
  const fx = Math.min(n - 1.0001, Math.max(0, (x + HALF) / res));
  const fz = Math.min(n - 1.0001, Math.max(0, (z + HALF) / res));
  const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
  const g = (i, j) => grid[j * n + i];
  return (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
}

/** Mean |Laplacian| over 3×3: ~0 on planes (flat or pitched roofs, ground), large in tree crowns. */
function roughness(a, n) {
  const lap = new Float32Array(n * n);
  for (let z = 1; z < n - 1; z += 1) {
    for (let x = 1; x < n - 1; x += 1) {
      const c = z * n + x;
      const v = 4 * a[c] - a[c - 1] - a[c + 1] - a[c - n] - a[c + n];
      lap[c] = v === v ? Math.min(5, Math.abs(v)) : 0;
    }
  }
  const out = new Float32Array(n * n);
  for (let z = 1; z < n - 1; z += 1) {
    for (let x = 1; x < n - 1; x += 1) {
      let s = 0;
      for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) s += lap[(z + dz) * n + x + dx];
      out[z * n + x] = s / 9;
    }
  }
  return out;
}

/** Green by colour (excess-green index): tree crowns, grass, and also green-painted tin roofs. */
const isGreen = (r, g, b) => 2 * g - r - b > 18 && g > 50;

/** 0.5 m roughness of the surface model, set once the rasters are loaded. */
let ROUGH = null;
/** Vegetation: green and rough. A smooth green surface is a painted roof or a lawn. */
const isVeg = (k, rgb) => isGreen(rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2]) && ROUGH[k] > 0.12;

// ------------------------------------------------------------------ step 3: alignment

function pointInPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Cell centres (`res` spacing) inside a polygon, flat [x, z, x, z, ...]. */
function cellsIn(pts, res) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const out = [];
  for (let z = Math.ceil(z0 / res) * res; z <= z1; z += res) {
    for (let x = Math.ceil(x0 / res) * res; x <= x1; x += res) if (pointInPoly(x, z, pts)) out.push(x, z);
  }
  return out;
}

/** Height above bare ground of every 0.5 m cell. */
function heightAboveGround(r, ground) {
  const h = new Float32Array(N * N);
  for (let j = 0; j < N; j += 1) {
    for (let i = 0; i < N; i += 1) h[j * N + i] = r.dsm[j * N + i] - sample(ground.dtm, ground.n, 1, -HALF + i * RES, -HALF + j * RES);
  }
  return h;
}

/**
 * The survey and the OSM tracing (satellite imagery) are each georeferenced a little differently.
 * Finds the shift (dx, dz) to add to game coordinates to land on the survey: the one that puts the
 * most OSM building area onto raised, non-green survey cells.
 */
function findShift(r, hag) {
  const raised = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k += 1) {
    const c = k * 3;
    raised[k] = hag[k] > 2.2 && !isVeg(k, r.rgb) ? 1 : 0;
  }
  const pts = [];
  for (const b of data.buildings) {
    if (b.source === 'ms') continue;
    const c = cellsIn(b.pts, 1);
    for (let i = 0; i < c.length; i += 2) if (Math.abs(c[i]) < 400 && Math.abs(c[i + 1]) < 400) pts.push(c[i], c[i + 1]);
  }
  const score = (dx, dz) => {
    let s = 0;
    for (let i = 0; i < pts.length; i += 2) {
      const ii = Math.round((pts[i] + dx + HALF) / RES), jj = Math.round((pts[i + 1] + dz + HALF) / RES);
      s += raised[jj * N + ii];
    }
    return s / (pts.length / 2);
  };
  let best = { dx: 0, dz: 0, s: score(0, 0) };
  const at0 = best.s;
  for (let dz = -15; dz <= 15; dz += 1) for (let dx = -15; dx <= 15; dx += 1) {
    const s = score(dx, dz);
    if (s > best.s) best = { dx, dz, s };
  }
  const c = { ...best };
  for (let dz = c.dz - 1; dz <= c.dz + 1; dz += 0.25) for (let dx = c.dx - 1; dx <= c.dx + 1; dx += 0.25) {
    const s = score(dx, dz);
    if (s > best.s) best = { dx, dz, s };
  }
  console.log(`alignment: OSM buildings on raised survey cells ${(at0 * 100).toFixed(1)}% unshifted, ${(best.s * 100).toFixed(1)}% shifted by (${best.dx}, ${best.dz}) m`);
  return { dx: best.dx, dz: best.dz, raised };
}

/** Debug: height above ground (black 0 → white 15 m), green tint for vegetation, OSM outlines in red after the shift. */
async function debugHeights(r, hag, shift) {
  const step = 2;
  const W = Math.floor(N / step);
  const px = new Uint8Array(W * W * 3);
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const k = y * step * N + x * step;
      const v = Math.max(0, Math.min(255, (hag[k] / 15) * 255));
      const c = k * 3;
      const veg = isVeg(k, r.rgb);
      px[(y * W + x) * 3] = veg ? v * 0.4 : v;
      px[(y * W + x) * 3 + 1] = v;
      px[(y * W + x) * 3 + 2] = veg ? v * 0.4 : v;
    }
  }
  const plot = (gx, gz, col) => {
    const x = Math.round((gx + HALF) / RES / step), y = Math.round((gz + HALF) / RES / step);
    if (x < 0 || y < 0 || x >= W || y >= W) return;
    px.set(col, (y * W + x) * 3);
  };
  for (const b of data.buildings) {
    const col = b.source === 'ms' ? [60, 140, 255] : [255, 40, 40];
    for (let i = 0; i < b.pts.length; i += 1) {
      const [ax, az] = b.pts[i];
      const [bx, bz] = b.pts[(i + 1) % b.pts.length];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= len; t += 0.5) plot(ax + ((bx - ax) * t) / len + shift.dx, az + ((bz - az) * t) / len + shift.dz, col);
    }
  }
  await writePng(join(DEBUG, 'heights-osm.png'), W, W, px, 3);
}

/** Debug crop at full resolution: mesh colour (left) and height above ground (right), OSM outlines on both. */
async function debugCrop(r, hag, name, x0, z0, x1, z1, extra = []) {
  const w = Math.round((x1 - x0) / RES), h = Math.round((z1 - z0) / RES);
  const W = w * 2 + 4;
  const px = new Uint8Array(W * h * 3).fill(255);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = Math.round((x0 + x * RES + HALF) / RES), j = Math.round((z0 + y * RES + HALF) / RES);
      const k = j * N + i;
      for (let c = 0; c < 3; c += 1) px[(y * W + x) * 3 + c] = r.rgb[k * 3 + c];
      const v = Math.max(0, Math.min(255, (hag[k] / 15) * 255));
      const t = hag[k] < 0.4 ? [0, 0, 0] : hag[k] > 15 ? [255, 255, 255] : [v, v, v];
      px.set(t, (y * W + x + w + 4) * 3);
    }
  }
  const plot = (gx, gz, col) => {
    const x = Math.round((gx - x0) / RES), y = Math.round((gz - z0) / RES);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    px.set(col, (y * W + x) * 3);
    px.set(col, (y * W + x + w + 4) * 3);
  };
  const outline = (pts, col, closed = true) => {
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i += 1) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[(i + 1) % pts.length];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      for (let t = 0; t <= len; t += 0.25) plot(ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, col);
    }
  };
  for (const b of data.buildings) outline(b.pts, b.source === 'ms' ? [60, 140, 255] : [255, 40, 40]);
  for (const e of extra) outline(e.pts, e.col, e.closed !== false);
  await writePng(join(DEBUG, `${name}.png`), W, h, px, 3);
}

// ------------------------------------------------------------------ step 4: buildings

function orientedRect(p) {
  let best = null;
  for (let i = 0; i < p.length; i += 1) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of p) {
      const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) {
      const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
      best = { cx: um * c - vm * s, cz: um * s + vm * c, angle: ang, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2, area };
    }
  }
  if (best.hw > best.hl) return { ...best, angle: best.angle + Math.PI / 2, hl: best.hw, hw: best.hl };
  return best;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i += 1) {
    const [x0, z0] = p[i];
    const [x1, z1] = p[(i + 1) % p.length];
    a += x0 * z1 - x1 * z0;
  }
  return a / 2;
}

function edgeDist(x, z, p) {
  let d = Infinity;
  for (let i = 0; i < p.length; i += 1) {
    const [ax, az] = p[i];
    const [bx, bz] = p[(i + 1) % p.length];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return d;
}

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

/** Mean ground over a footprint, sampled the way ground.ts levels a building's pad. */
function padGround(ground, pts) {
  let s = 0, k = 0;
  for (const [x, z] of pts) { s += sample(ground.dtm, ground.n, 1, x, z); k += 1; }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const st = Math.max(2, Math.min(x1 - x0, z1 - z0) / 6);
  for (let x = x0; x <= x1; x += st) for (let z = z0; z <= z1; z += st) {
    if (!pointInPoly(x, z, pts)) continue;
    s += sample(ground.dtm, ground.n, 1, x, z);
    k += 1;
  }
  return s / k;
}

/**
 * Measures one footprint against the survey: roof level, flat or pitched (a roof that falls from
 * the long centre line to the eaves), ridge rise, and how much of it is really there.
 */
function measureBuilding(b, r, ground) {
  const pts = b.pts;
  const area = Math.abs(polyArea(pts));
  const cells = cellsIn(pts, RES);
  const total = cells.length / 2;
  if (total < 8) return null;
  const rect = orientedRect(pts);
  const ca = Math.cos(rect.angle), sa = Math.sin(rect.angle);
  const margin = Math.min(0.8, rect.hw * 0.3);
  let valid = 0, green = 0;
  const roof = [];
  for (let c = 0; c < cells.length; c += 2) {
    const x = cells[c], z = cells[c + 1];
    const i = Math.round((x + HALF) / RES), j = Math.round((z + HALF) / RES);
    const k = j * N + i;
    const y = r.dsm[k];
    if (y !== y) continue;
    valid += 1;
    if (isVeg(k, r.rgb)) { green += 1; continue; }
    if (edgeDist(x, z, pts) < margin) continue;
    const v = (-(x - rect.cx) * sa + (z - rect.cz) * ca) / rect.hw;
    const u = ((x - rect.cx) * ca + (z - rect.cz) * sa) / rect.hl;
    roof.push({ y, v: Math.max(-1, Math.min(1, v)), u: Math.max(-1, Math.min(1, u)) });
  }
  if (valid / total < 0.7) return { covered: false };
  const g = padGround(ground, pts);
  const plinth = b.inside ? 0.45 : 0.2;
  const raised = roof.filter((q) => q.y - g > 1.6);
  const out = { covered: true, area, ground: g, greenFrac: green / valid, raisedFrac: raised.length / Math.max(1, total) };
  if (raised.length < Math.max(6, total * 0.25)) return { ...out, present: false };
  const ys = raised.map((q) => q.y).sort((a, c) => a - c);
  const p50 = pct(ys, 0.5);
  // Pitched roof fit: y = a + s·d + t·u, with d the distance from a ridge line at v0 out to the eaves
  // (0 on the ridge, 1 at either eave) and t a fall along the length (blocks stepping down the hill).
  // The ridge is searched across the width: workshop roofs here often have it off centre.
  const n = raised.length;
  let fit = null;
  for (let v0 = -0.6; v0 <= 0.601; v0 += 0.1) {
    const D = raised.map((q) => (q.v >= v0 ? (q.v - v0) / (1 - v0) : (v0 - q.v) / (1 + v0)));
    // Normal equations for [a, s, t].
    let S1 = 0, Sd = 0, Su = 0, Sdd = 0, Suu = 0, Sdu = 0, Sy = 0, Sdy = 0, Suy = 0;
    raised.forEach((q, i) => { const d = D[i]; S1 += 1; Sd += d; Su += q.u; Sdd += d * d; Suu += q.u * q.u; Sdu += d * q.u; Sy += q.y; Sdy += d * q.y; Suy += q.u * q.y; });
    const M = [[S1, Sd, Su], [Sd, Sdd, Sdu], [Su, Sdu, Suu]];
    const R = [Sy, Sdy, Suy];
    const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    const d0 = det(M);
    if (Math.abs(d0) < 1e-9) continue;
    const sol = [0, 1, 2].map((c) => det(M.map((row, ri) => row.map((v, ci) => (ci === c ? R[ri] : v)))) / d0);
    let ssr = 0, sst = 0;
    const my = Sy / S1;
    raised.forEach((q, i) => { ssr += (q.y - sol[0] - sol[1] * D[i] - sol[2] * q.u) ** 2; sst += (q.y - my) ** 2; });
    const r2 = sst > 0 ? 1 - ssr / sst : 0;
    if (!fit || r2 > fit.r2) fit = { v0, a: sol[0], slope: sol[1], t: sol[2], r2, D };
  }
  const slope = fit ? fit.slope : 0;
  const r2 = fit ? fit.r2 : 0;
  // A pitched roof falls steadily from the ridge line to the eaves: the mean height (along-length fall
  // taken out) of each quarter of the way out is lower than the last. A flat roof with a stair room or
  // tank in the middle steps instead.
  const bins = [0, 0, 0, 0], cnt = [0, 0, 0, 0];
  if (fit) raised.forEach((q, i) => { const k = Math.min(3, Math.floor(fit.D[i] * 4)); bins[k] += q.y - fit.t * q.u; cnt[k] += 1; });
  let steady = !!fit && cnt.every((c) => c >= 3);
  for (let k = 1; k < 4 && steady; k += 1) steady = bins[k] / cnt[k] < bins[k - 1] / cnt[k - 1] - 0.08 * -slope;
  // Walls under a pitched roof are at least 2 m tall: otherwise this is a flat block with a taller wing.
  const walls = fit ? fit.a + slope - g - (b.inside ? 0.45 : 0.2) : 0;
  const pitched = rect.hw > 1.5 && slope < -0.7 && r2 > 0.6 && steady && -slope < rect.hw * 1.2 && walls >= 2;
  // Gable (ridge runs to the ends) or hip (the roof also falls at the ends): heights along the ridge line.
  let hip = false;
  if (pitched) {
    const near = raised.filter((q, i) => fit.D[i] < 0.25);
    const mid = near.filter((q) => Math.abs(q.u) < 0.5).map((q) => q.y - fit.t * q.u);
    const ends = near.filter((q) => Math.abs(q.u) > 0.85).map((q) => q.y - fit.t * q.u);
    const avg = (l) => l.reduce((p, v) => p + v, 0) / Math.max(1, l.length);
    hip = ends.length > 4 && mid.length > 4 && avg(mid) - avg(ends) > 0.35 * -slope;
  }
  // Higher parts on a flat roof (stair rooms, an extra storey over part of the block).
  const upperFrac = raised.filter((q) => q.y > p50 + 2.4).length / n;
  if (pitched) {
    // Eaves at the middle of the length (the game builds one level per block).
    const eave = fit.a + slope;
    // The ridge as a world point (so it survives the outline being walked the other way round).
    const ridge = [round1(rect.cx - fit.v0 * rect.hw * sa), round1(rect.cz + fit.v0 * rect.hw * ca)];
    return { ...out, present: true, roofShape: 'pitched', top: eave, rise: -slope, height: eave - g - plinth, r2, upperFrac, hip, ridge: Math.abs(fit.v0) > 0.25 ? ridge : null };
  }
  // Two roof levels (a taller wing over part of the block): split the roof heights in two (1-D k-means).
  let lo = pct(ys, 0.2), hi = pct(ys, 0.8);
  for (let it = 0; it < 12; it += 1) {
    let sl = 0, cl = 0, sh = 0, ch = 0;
    for (const y of ys) {
      if (Math.abs(y - lo) <= Math.abs(y - hi)) { sl += y; cl += 1; } else { sh += y; ch += 1; }
    }
    if (!cl || !ch) break;
    lo = sl / cl;
    hi = sh / ch;
  }
  const split = (lo + hi) / 2;
  const upperShare = ys.filter((y) => y > split).length / ys.length;
  const tiered = hi - lo > 2.4 && upperShare > 0.1 && upperShare < 0.9;
  const base = tiered ? pct(ys.filter((y) => y <= split), 0.5) : p50;
  return { ...out, present: true, roofShape: 'flat', top: base, height: base - g - plinth, spread: pct(ys, 0.9) - pct(ys, 0.1), r2, upperFrac, split: tiered ? split : null };
}

/** Convex hull (monotone chain) of [x, z] points. */
function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/**
 * A footprint for a blob of 0.5 m cells: its minimum-area rectangle when the blob fills it (most
 * blocks here are rectangular), else its convex hull when that fits. Null for ragged blobs.
 */
function blobFootprint(cells) {
  const pts = [];
  for (const [x, z] of cells) pts.push([x - RES / 2, z - RES / 2], [x + RES / 2, z - RES / 2], [x + RES / 2, z + RES / 2], [x - RES / 2, z + RES / 2]);
  const h = hull(pts);
  if (h.length < 3) return null;
  const area = cells.length * RES * RES;
  const r = orientedRect(h);
  const ca = Math.cos(r.angle), sa = Math.sin(r.angle);
  const rect = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => [
    Math.round((r.cx + u * r.hl * ca - v * r.hw * sa) * 10) / 10,
    Math.round((r.cz + u * r.hl * sa + v * r.hw * ca) * 10) / 10,
  ]);
  if (area / (4 * r.hl * r.hw) > 0.78) return { pts: rect, hw: r.hw };
  if (area / Math.abs(polyArea(h)) > 0.88) return { pts: h.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), hw: r.hw };
  return null;
}

/** 8-connected blobs of the 0.5 m cells where `test(k)` holds, inside the box [x0, z0, x1, z1]. */
function blobs(test, x0, z0, x1, z1) {
  const i0 = Math.max(0, Math.floor((x0 + HALF) / RES)), i1 = Math.min(N - 1, Math.ceil((x1 + HALF) / RES));
  const j0 = Math.max(0, Math.floor((z0 + HALF) / RES)), j1 = Math.min(N - 1, Math.ceil((z1 + HALF) / RES));
  const seen = new Set();
  const out = [];
  for (let j = j0; j <= j1; j += 1) {
    for (let i = i0; i <= i1; i += 1) {
      const k = j * N + i;
      if (seen.has(k) || !test(k)) continue;
      const comp = [];
      const stack = [k];
      seen.add(k);
      while (stack.length) {
        const c = stack.pop();
        const ci = c % N, cj = (c - ci) / N;
        comp.push([-HALF + ci * RES, -HALF + cj * RES, c]);
        for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
          const ii = ci + di, jj = cj + dj;
          if (ii < i0 || jj < j0 || ii > i1 || jj > j1) continue;
          const o = jj * N + ii;
          if (!seen.has(o) && test(o)) { seen.add(o); stack.push(o); }
        }
      }
      out.push(comp);
    }
  }
  return out;
}

/** The taller wing(s) of a two-level block, as extra footprints standing inside it. */
function upperParts(b, m, r) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of b.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const inFoot = new Set();
  const c = cellsIn(b.pts, RES);
  for (let i = 0; i < c.length; i += 2) inFoot.add(Math.round((c[i + 1] + HALF) / RES) * N + Math.round((c[i] + HALF) / RES));
  const parts = [];
  for (const blob of blobs((k) => inFoot.has(k) && r.dsm[k] > m.split && !isVeg(k, r.rgb), x0, z0, x1, z1)) {
    const area = blob.length * RES * RES;
    if (area < 25 || area < m.area * 0.08) continue;
    const fp = blobFootprint(blob);
    if (!fp || fp.hw < 2) continue;
    parts.push({ pts: fp.pts, area });
  }
  return parts;
}

function measureAll(r, ground) {
  const rows = [];
  for (const b of data.buildings) rows.push({ b, m: measureBuilding(b, r, ground) });
  const covered = rows.filter((x) => x.m?.covered);
  const absent = covered.filter((x) => x.m.present === false);
  const present = covered.filter((x) => x.m.present);
  const pitched = present.filter((x) => x.m.roofShape === 'pitched');
  const multi = present.filter((x) => x.m.upperFrac > 0.15);
  console.log(`buildings: ${rows.length} mapped, ${covered.length} inside the survey, ${present.length} measured (${pitched.length} pitched), ${absent.length} not found standing, ${multi.length} with a higher part`);
  console.log(`  not found: ${absent.map((x) => `${x.b.name ?? '?'}${x.b.source === 'ms' ? '(ms)' : ''} ${x.m.area.toFixed(0)}m² green ${(x.m.greenFrac * 100).toFixed(0)}%`).join('; ')}`);
  for (const x of present.filter((q) => q.b.inside).sort((a, c) => (a.b.name ?? '~').localeCompare(c.b.name ?? '~'))) {
    const m = x.m;
    console.log(`  ${(x.b.name ?? '(unnamed)').padEnd(44)} ${m.area.toFixed(0).padStart(5)} m²  ${m.roofShape.padEnd(7)} h ${m.height.toFixed(1).padStart(5)}${m.rise ? ` rise ${m.rise.toFixed(1)}` : ''}  was ${x.b.height ?? (x.b.levels ? `${x.b.levels} fl` : '-')}  upper ${(m.upperFrac * 100).toFixed(0)}%`);
  }
  return rows;
}

// ------------------------------------------------------------------ step 5: surfaces (pathways)

/** Surface codes in the exported map. */
export const SURF = { none: 0, grass: 1, dirt: 2, paved: 3, road: 4, built: 5, scrub: 6 };

/**
 * Classifies the ground seen from above, from the mesh colours: grass (green), bare earth and dirt
 * paths (warm, unsaturated browns), paving and concrete (grey), asphalt (dark grey), buildings
 * (raised), scrub (rough vegetation). Shadows and cars are filled from their surroundings, and a
 * few majority passes clean the speckle. Returns a 1 m grid over the playable square.
 */
function surfaces(r, hag) {
  const S = 420;
  const n = S * 2 + 1;
  const half = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k += 1) {
    if (r.dsm[k] !== r.dsm[k]) continue;
    const R = r.rgb[k * 3], G = r.rgb[k * 3 + 1], B = r.rgb[k * 3 + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const sat = mx ? (mx - mn) / mx : 0;
    const exg = 2 * G - R - B;
    if (hag[k] > 1.8) { half[k] = isVeg(k, r.rgb) ? SURF.scrub : SURF.built; continue; }
    if (hag[k] > 0.6 && ROUGH[k] > 0.12) { half[k] = SURF.scrub; continue; }
    if (mx < 55) continue; // shadow: unknown, filled below
    if (exg > 14 && G > 60) half[k] = SURF.grass;
    else if (sat < 0.13) half[k] = mx < 120 ? SURF.road : SURF.paved;
    else if (R > B + 14 && exg < 14) half[k] = SURF.dirt;
    else if (sat < 0.2) half[k] = SURF.paved;
  }
  // To 1 m by majority, ignoring unknowns.
  let g = new Uint8Array(n * n);
  const off = Math.round((HALF - S) / RES);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const cnt = new Uint8Array(8);
      for (let dj = 0; dj < 2; dj += 1) for (let di = 0; di < 2; di += 1) {
        const ii = off + i * 2 + di, jj = off + j * 2 + dj;
        if (ii < N && jj < N) cnt[half[jj * N + ii]] += 1;
      }
      let best = 0;
      for (let c = 1; c < 8; c += 1) if (cnt[c] > cnt[best] || (best === 0 && cnt[c] > 0)) best = c;
      g[j * n + i] = best;
    }
  }
  // Majority filter (radius 1, then 2): speckle out, gaps (shadows) filled.
  for (const rad of [1, 1, 2]) {
    const o = new Uint8Array(n * n);
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const cnt = new Uint16Array(8);
        for (let dj = -rad; dj <= rad; dj += 1) for (let di = -rad; di <= rad; di += 1) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          cnt[g[jj * n + ii]] += 1;
        }
        const own = g[j * n + i];
        // Raised classes are measured, not guessed: they keep their cells.
        if (own === SURF.built) { o[j * n + i] = own; continue; }
        let best = own, bc = own ? cnt[own] : 0;
        for (let c = 1; c < 8; c += 1) if (c !== SURF.built && cnt[c] > bc) { best = c; bc = cnt[c]; }
        o[j * n + i] = best;
      }
    }
    g = o;
  }
  return { n, S, g };
}

const SURF_COLOUR = { 0: [0, 0, 0], 1: [96, 150, 60], 2: [176, 140, 96], 3: [200, 196, 186], 4: [80, 80, 84], 5: [200, 70, 60], 6: [40, 90, 40] };

async function debugSurfaces(s, name = 'surfaces', box = null) {
  const [x0, z0, x1, z1] = box ?? [-s.S, -s.S, s.S, s.S];
  const sc = box ? 2 : 1;
  const w = (x1 - x0) * sc, h = (z1 - z0) * sc;
  const px = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = Math.floor(x / sc) + x0 + s.S, j = Math.floor(y / sc) + z0 + s.S;
    px.set(SURF_COLOUR[s.g[j * s.n + i]], (y * w + x) * 3);
  }
  if (box) {
    const plot = (gx, gz, col) => {
      const x = Math.round((gx - x0) * sc), y = Math.round((gz - z0) * sc);
      if (x >= 0 && y >= 0 && x < w && y < h) px.set(col, (y * w + x) * 3);
    };
    for (const l of data.lines) {
      const col = /footway|path|steps|pedestrian/.test(l.kind) ? [255, 0, 255] : /service|residential|primary|secondary|tertiary|unclassified|track/.test(l.kind) ? [0, 160, 255] : null;
      if (!col) continue;
      for (let i = 0; i < l.pts.length - 1; i += 1) {
        const [ax, az] = l.pts[i];
        const [bx, bz] = l.pts[i + 1];
        const len = Math.hypot(bx - ax, bz - az) || 1;
        for (let t = 0; t <= len; t += 0.25) plot(ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len, col);
      }
    }
  }
  await writePng(join(DEBUG, `${name}.png`), w, h, px, 3);
}

/**
 * Turns the raw classes into what the ground painter needs: built and scrub cells take the ground
 * class around them (the buildings and trees are modelled separately); dark grey counts as asphalt
 * only near a mapped road (elsewhere it is shadowed rock or soil).
 */
function groundSurfaces(s) {
  const { n, S } = s;
  const nearRoad = new Uint8Array(n * n);
  for (const l of data.lines) {
    if (!/service|residential|primary|secondary|tertiary|unclassified|track|living_street/.test(l.kind)) continue;
    const reach = l.w / 2 + 3;
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      const [ax, az] = l.pts[i];
      const [bx, bz] = l.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      for (let t = 0; t <= len; t += 0.5) {
        const cx = ax + ((bx - ax) * t) / len, cz = az + ((bz - az) * t) / len;
        for (let dz = -reach; dz <= reach; dz += 1) for (let dx = -reach; dx <= reach; dx += 1) {
          if (dx * dx + dz * dz > reach * reach) continue;
          const i2 = Math.round(cx + dx + S), j2 = Math.round(cz + dz + S);
          if (i2 >= 0 && j2 >= 0 && i2 < n && j2 < n) nearRoad[j2 * n + i2] = 1;
        }
      }
    }
  }
  let g = Uint8Array.from(s.g);
  for (let k = 0; k < n * n; k += 1) if (g[k] === SURF.road && !nearRoad[k]) g[k] = SURF.dirt;
  // Fill raised cells from the ground around them (grows inward a ring per pass).
  const fillable = (c) => c === SURF.built || c === SURF.scrub;
  for (let pass = 0; pass < 40; pass += 1) {
    let changed = 0;
    const o = Uint8Array.from(g);
    for (let j = 1; j < n - 1; j += 1) {
      for (let i = 1; i < n - 1; i += 1) {
        const k = j * n + i;
        if (!fillable(g[k])) continue;
        const cnt = new Uint8Array(8);
        for (const d of [-1, 1, -n, n, -n - 1, -n + 1, n - 1, n + 1]) {
          const c = g[k + d];
          if (c && !fillable(c)) cnt[c] += 1;
        }
        let best = 0;
        for (let c = 1; c < 8; c += 1) if (cnt[c] > cnt[best]) best = c;
        if (best) { o[k] = best; changed += 1; }
      }
    }
    g = o;
    if (!changed) break;
  }
  // Scrub left in the middle of large thickets stays scrub; built leftovers become grass.
  for (let k = 0; k < n * n; k += 1) if (g[k] === SURF.built) g[k] = SURF.grass;
  return { n, S, g };
}

// ------------------------------------------------------------------ step 6: export

const round1 = (v) => Math.round(v * 10) / 10;
const ASSETS = join(ROOT, 'public/assets/campus');

/** Buildings the survey shows that no footprint covers (inside the campus and just around it). */
function findMissing(r, hag) {
  const mask = new Uint8Array(N * N);
  for (const b of data.buildings) {
    const c = cellsIn(b.pts, RES);
    for (let i = 0; i < c.length; i += 2) {
      const ci = Math.round((c[i] + HALF) / RES), cj = Math.round((c[i + 1] + HALF) / RES);
      for (let dj = -3; dj <= 3; dj += 1) for (let di = -3; di <= 3; di += 1) {
        const ii = ci + di, jj = cj + dj;
        if (ii >= 0 && jj >= 0 && ii < N && jj < N) mask[jj * N + ii] = 1;
      }
    }
  }
  const near = (x, z) => pointInPoly(x, z, data.boundary) || edgeDist(x, z, data.boundary) < 20;
  const out = [];
  for (const blob of blobs((k) => !mask[k] && hag[k] > 2.2 && !isVeg(k, r.rgb) && ROUGH[k] < 0.3, -400, -400, 400, 400)) {
    const area = blob.length * RES * RES;
    if (area < 20) continue;
    let rs = 0, hs = 0;
    for (const [, , k] of blob) { rs += ROUGH[k]; hs += hag[k]; }
    if (rs / blob.length > 0.08 || hs / blob.length < 2.4) continue;
    const fp = blobFootprint(blob);
    if (!fp || fp.hw < 1.8) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of fp.pts) { cx += x / fp.pts.length; cz += z / fp.pts.length; }
    if (!near(cx, cz)) continue;
    out.push({ pts: fp.pts, kind: 'yes', inside: pointInPoly(cx, cz, data.boundary), source: 'scan' });
  }
  return out;
}

const hex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Per-channel median of colour samples (flat [r, g, b, ...]). */
function medianColour(s) {
  const n = s.length / 3;
  if (n < 5) return null;
  const out = [];
  for (let ch = 0; ch < 3; ch += 1) {
    const v = [];
    for (let i = 0; i < n; i += 1) v.push(s[i * 3 + ch]);
    v.sort((a, b) => a - b);
    out.push(v[Math.floor(n / 2)]);
  }
  return out;
}

/** Roof colour as the drone saw it: the median over the roof, away from the edges. */
function roofColour(b, r) {
  const c = cellsIn(b.pts, RES);
  const s = [];
  for (let i = 0; i < c.length; i += 2) {
    if (edgeDist(c[i], c[i + 1], b.pts) < 0.8) continue;
    const k = Math.round((c[i + 1] + HALF) / RES) * N + Math.round((c[i] + HALF) / RES);
    if (r.dsm[k] !== r.dsm[k] || isVeg(k, r.rgb)) continue;
    s.push(r.rgb[k * 3], r.rgb[k * 3 + 1], r.rgb[k * 3 + 2]);
  }
  return medianColour(s);
}

/**
 * Wall colours from the mesh: vertices within 0.8 m of a footprint's outline, between a metre above
 * its ground and just under its roof (the facade the drone photographed obliquely). One more pass
 * over the OBJ, with the outlines in a 1 m grid.
 */
async function wallColours(list) {
  const grid = new Map();
  list.forEach(({ b }, bi) => {
    for (let i = 0; i < b.pts.length; i += 1) {
      const [ax, az] = b.pts[i];
      const [bx, bz] = b.pts[(i + 1) % b.pts.length];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      for (let t = 0; t <= len; t += 0.5) {
        const x = Math.round(ax + ((bx - ax) * t) / len), z = Math.round(az + ((bz - az) * t) / len);
        for (let dz = -1; dz <= 1; dz += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const key = (z + dz + 1000) * 4000 + x + dx + 1000;
          const l = grid.get(key);
          if (!l) grid.set(key, [bi]);
          else if (l[l.length - 1] !== bi && !l.includes(bi)) l.push(bi);
        }
      }
    }
  });
  const samples = list.map(() => []);
  await streamObj(join(SRC, '3d model.obj'), (lon, lat, el, rr, gg, bb) => {
    const x = toLocalX(lon), z = toLocalZ(lat);
    const l = grid.get((Math.round(z) + 1000) * 4000 + Math.round(x) + 1000);
    if (!l) return;
    for (const bi of l) {
      const { b, m } = list[bi];
      if (el < m.ground + 1.0 || el > m.top - 0.5) continue;
      if (edgeDist(x, z, b.pts) > 0.8) continue;
      samples[bi].push(rr * 255, gg * 255, bb * 255);
    }
  }, () => {});
  return samples.map(litColour);
}

/** Mean of the brighter samples (55th–90th brightness percentile): lit paint, not windows and shaded sides. */
function litColour(s) {
  const n = s.length / 3;
  if (n < 12) return null;
  const idx = [...Array(n).keys()].map((i) => [0.3 * s[i * 3] + 0.59 * s[i * 3 + 1] + 0.11 * s[i * 3 + 2], i]).sort((a, b) => a[0] - b[0]);
  const out = [0, 0, 0];
  let c = 0;
  for (let q = Math.floor(n * 0.55); q < Math.floor(n * 0.9); q += 1) {
    const i = idx[q][1];
    for (let ch = 0; ch < 3; ch += 1) out[ch] += s[i * 3 + ch];
    c += 1;
  }
  return c ? out.map((v) => v / c) : null;
}

/**
 * Trees from the survey: peaks of the canopy (vegetation 2.5 m or more above the ground, smoothed
 * over a metre), each the highest point within a crown radius that grows with its height. Returns
 * [x, z, height] in game metres, none on a building footprint.
 */
function findTrees(r, hag) {
  const chm = new Float32Array(N * N);
  for (let k = 0; k < N * N; k += 1) {
    const veg = isVeg(k, r.rgb) || (ROUGH[k] > 0.25 && hag[k] > 3);
    chm[k] = veg && hag[k] > 2.5 ? hag[k] : 0;
  }
  // 1 m box smooth (3×3 cells at 0.5 m), so a single crown has a single peak.
  const sm = new Float32Array(N * N);
  for (let j = 1; j < N - 1; j += 1) for (let i = 1; i < N - 1; i += 1) {
    let s = 0;
    for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) s += chm[(j + dj) * N + i + di];
    sm[j * N + i] = s / 9;
  }
  const foot = new Uint8Array(N * N);
  for (const b of data.buildings) {
    const c = cellsIn(b.pts, RES);
    for (let i = 0; i < c.length; i += 2) foot[Math.round((c[i + 1] + HALF) / RES) * N + Math.round((c[i] + HALF) / RES)] = 1;
  }
  const out = [];
  const lim = Math.round((HALF - 418) / RES);
  for (let j = lim; j < N - lim; j += 1) {
    for (let i = lim; i < N - lim; i += 1) {
      const k = j * N + i;
      const h = sm[k];
      if (h < 3 || foot[k]) continue;
      const rad = Math.round(Math.min(5, Math.max(1.8, 1.2 + 0.18 * h)) / RES);
      let peak = true;
      for (let dj = -rad; dj <= rad && peak; dj += 1) for (let di = -rad; di <= rad; di += 1) {
        if (di * di + dj * dj > rad * rad || (!di && !dj)) continue;
        const q = sm[(j + dj) * N + i + di];
        // Ties go to the first cell in scan order.
        if (q > h || (q === h && (dj < 0 || (dj === 0 && di < 0)))) { peak = false; break; }
      }
      if (!peak) continue;
      out.push([round1(-HALF + i * RES), round1(-HALF + j * RES), round1(Math.min(24, chm[k] || h))]);
    }
  }
  return out;
}

/**
 * Footpaths fitted to the trails in the survey photo. Each mapped footway / path is resampled every
 * 2 m and slid sideways (up to 3 m) to where the ground looks most like a path: lighter than its
 * surroundings, paved or bare, not grass, crowns or buildings. Offsets are smoothed along the path
 * and fade to zero at its ends, so junctions stay joined. Each path also gets its surface (paved or
 * dirt, from the class map).
 */
function snapPaths(r, hag, surf) {
  const lum = new Float32Array(N * N);
  for (let k = 0; k < N * N; k += 1) lum[k] = 0.3 * r.rgb[k * 3] + 0.59 * r.rgb[k * 3 + 1] + 0.11 * r.rgb[k * 3 + 2];
  // Local mean brightness over 6 m (box via a coarse 3 m grid, bilinear).
  const C = 6, cn = Math.ceil(N / C);
  const cm = new Float32Array(cn * cn);
  for (let cj = 0; cj < cn; cj += 1) for (let ci = 0; ci < cn; ci += 1) {
    let s = 0, c = 0;
    for (let j = cj * C; j < Math.min(N, cj * C + C); j += 1) for (let i = ci * C; i < Math.min(N, ci * C + C); i += 1) { s += lum[j * N + i]; c += 1; }
    cm[cj * cn + ci] = s / c;
  }
  const meanAt = (i, j) => {
    let s = 0, c = 0;
    for (let dj = -1; dj <= 1; dj += 1) for (let di = -1; di <= 1; di += 1) {
      const a = Math.floor(i / C) + di, b = Math.floor(j / C) + dj;
      if (a < 0 || b < 0 || a >= cn || b >= cn) continue;
      s += cm[b * cn + a]; c += 1;
    }
    return s / c;
  };
  const score = (x, z) => {
    const i = Math.round((x + HALF) / RES), j = Math.round((z + HALF) / RES);
    if (i < 1 || j < 1 || i >= N - 1 || j >= N - 1) return 0;
    const k = j * N + i;
    if (r.dsm[k] !== r.dsm[k]) return 0;
    if (hag[k] > 1.2) return -40;
    const R = r.rgb[k * 3], G = r.rgb[k * 3 + 1], B = r.rgb[k * 3 + 2];
    let s = lum[k] - meanAt(i, j);
    if (2 * G - R - B > 14) s -= 12;
    const c = surf.g[Math.round(z + surf.S) * surf.n + Math.round(x + surf.S)];
    if (c === SURF.paved || c === SURF.road) s += 10;
    if (c === SURF.dirt) s += 4;
    return s;
  };
  let moved = 0, total = 0;
  for (const l of data.lines) {
    if (!/^(footway|path|pedestrian)$/.test(l.kind) || l.area || l.tunnel || l.pts.length < 2) continue;
    // Resample every 2 m.
    const pts = [];
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      const [ax, az] = l.pts[i];
      const [bx, bz] = l.pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 2));
      for (let s = 0; s < n; s += 1) pts.push([ax + ((bx - ax) * s) / n, az + ((bz - az) * s) / n]);
    }
    pts.push(l.pts[l.pts.length - 1]);
    if (pts.length < 3) continue;
    total += 1;
    const half = Math.max(0.6, l.w / 2);
    const offs = pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len;
      const nx = -tz, nz = tx;
      const at = (o) => {
        let s = 0, c = 0;
        for (let t = -2; t <= 2; t += 1) for (let w = -half; w <= half + 1e-6; w += 0.5) {
          s += score(p[0] + nx * (o + w) + tx * t, p[1] + nz * (o + w) + tz * t);
          c += 1;
        }
        return s / c;
      };
      const base = at(0);
      let best = { o: 0, s: base };
      for (let o = -3; o <= 3; o += 0.5) { const s = at(o); if (s > best.s) best = { o, s }; }
      // Only move for a clear gain.
      return { o: best.s - base > 4 ? best.o : 0, nx, nz };
    });
    // Smooth the offsets along the path (±3 samples) and fade them in over 6 m from each end.
    const sm = offs.map((_, i) => {
      let s = 0, c = 0;
      for (let k = Math.max(0, i - 3); k <= Math.min(offs.length - 1, i + 3); k += 1) { s += offs[k].o; c += 1; }
      const fade = Math.min(1, Math.min(i, offs.length - 1 - i) * 2 / 6);
      return (s / c) * fade;
    });
    const out = pts.map((p, i) => [round1(p[0] + offs[i].nx * sm[i]), round1(p[1] + offs[i].nz * sm[i])]);
    if (sm.some((o) => Math.abs(o) > 0.4)) moved += 1;
    // Keep corners only (drop points within 0.3 m of the line between their neighbours).
    const keep = [out[0]];
    for (let i = 1; i < out.length - 1; i += 1) {
      const a = keep[keep.length - 1], b = out[i + 1], p = out[i];
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const d = Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / (Math.hypot(dx, dz) || 1);
      if (d > 0.3) keep.push(p);
    }
    keep.push(out[out.length - 1]);
    l.pts = keep;
    // Surface along the path from the class map.
    let paved = 0, cnt = 0;
    for (const [x, z] of out) {
      const c = surf.g[Math.round(z + surf.S) * surf.n + Math.round(x + surf.S)];
      if (c === SURF.paved || c === SURF.road) paved += 1;
      if (c) cnt += 1;
    }
    if (cnt) l.surface = paved / cnt > 0.45 ? 'paved' : 'dirt';
  }
  console.log(`export: ${moved} of ${total} footpaths moved onto the trails in the survey photo`);
}

/**
 * Poles along the roads (street lights, electricity): thin spikes in the surface model, at least
 * 4.5 m above the ground with low ground all round them 1.5–2 m out, not in tree crowns, within
 * reach of a mapped road. Returns [x, z, height, road direction (rad), side of the road (+1/-1)].
 */
function findPoles(r, hag) {
  const roads = data.lines.filter((l) => /primary|secondary|tertiary|residential|unclassified|service|living_street/.test(l.kind) && !l.area);
  const nearestRoad = (x, z) => {
    let best = null;
    for (const l of roads) {
      for (let i = 0; i < l.pts.length - 1; i += 1) {
        const [ax, az] = l.pts[i];
        const [bx, bz] = l.pts[i + 1];
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        const px = ax + dx * t, pz = az + dz * t;
        const d = Math.hypot(x - px, z - pz);
        if (!best || d < best.d) best = { d, w: l.w, ang: Math.atan2(dz, dx), side: Math.sign((x - ax) * dz - (z - az) * dx) || 1 };
      }
    }
    return best;
  };
  const out = [];
  const ring = [];
  for (let a = 0; a < 16; a += 1) for (const rad of [1.5, 2]) ring.push([Math.round((Math.cos((a / 16) * Math.PI * 2) * rad) / RES), Math.round((Math.sin((a / 16) * Math.PI * 2) * rad) / RES)]);
  const lim = Math.round((HALF - 418) / RES);
  for (let j = lim; j < N - lim; j += 1) {
    for (let i = lim; i < N - lim; i += 1) {
      const k = j * N + i;
      const h = hag[k];
      if (!(h >= 4.5 && h < 14) || isVeg(k, r.rgb)) continue;
      // The highest cell within a metre.
      let peak = true;
      for (let dj = -2; dj <= 2 && peak; dj += 1) for (let di = -2; di <= 2; di += 1) if ((di || dj) && hag[k + dj * N + di] > h) { peak = false; break; }
      if (!peak) continue;
      let low = 0;
      for (const [di, dj] of ring) if (hag[k + dj * N + di] < h - 3.5) low += 1;
      if (low < ring.length * 0.9) continue;
      const x = -HALF + i * RES, z = -HALF + j * RES;
      const road = nearestRoad(x, z);
      if (!road || road.d > road.w / 2 + 6) continue;
      if (out.some((p) => Math.hypot(p[0] - x, p[1] - z) < 6)) continue;
      out.push([round1(x), round1(z), round1(h), Math.round(road.ang * 1000) / 1000, road.side]);
    }
  }
  return out;
}

/**
 * Water towers as surveyed: the highest point within 8 m of the mapped one is the top of the tank;
 * its height above the lowest ground around, its radius from the area standing within 25% of the top.
 */
function measureTowers(r) {
  for (const p of data.points) {
    if (p.kind !== 'watertower') continue;
    const at = (x, z) => r.dsm[Math.round((z + HALF) / RES) * N + Math.round((x + HALF) / RES)];
    let top = { y: -Infinity, x: p.x, z: p.z };
    for (let dz = -8; dz <= 8; dz += RES) for (let dx = -8; dx <= 8; dx += RES) {
      const y = at(p.x + dx, p.z + dz);
      if (y > top.y) top = { y, x: p.x + dx, z: p.z + dz };
    }
    let g = Infinity;
    for (let dz = -12; dz <= 12; dz += 1) for (let dx = -12; dx <= 12; dx += 1) { const y = at(top.x + dx, top.z + dz); if (y === y) g = Math.min(g, y); }
    const h = top.y - g;
    if (!(h > 5)) continue;
    let cells = 0, sx = 0, sz = 0;
    for (let dz = -8; dz <= 8; dz += RES) for (let dx = -8; dx <= 8; dx += RES) {
      if (at(top.x + dx, top.z + dz) > top.y - h * 0.25) { cells += 1; sx += top.x + dx; sz += top.z + dz; }
    }
    p.x = round1(sx / cells);
    p.z = round1(sz / cells);
    p.h = round1(h);
    p.r = round1(Math.sqrt((cells * RES * RES) / Math.PI));
    console.log(`export: water tower at (${p.x}, ${p.z}): ${p.h} m tall, tank radius ${p.r} m`);
  }
}

/** Writes the measured heights, roofs, taller wings and found buildings into the map data. */
async function applyBuildings(measured, r, hag) {
  let changed = 0, wings = 0;
  for (const { b, m } of measured) {
    if (!m?.present) continue;
    const h = Math.max(2.2, m.height);
    delete b.height;
    delete b.levels;
    b.height = round1(h);
    b.levels = Math.max(1, Math.round(h / 3.15));
    b.roofShape = m.roofShape;
    delete b.roofRise; delete b.roofForm; delete b.roofRidge;
    if (m.roofShape === 'pitched') {
      b.roofRise = round1(Math.min(6, Math.max(0.6, m.rise)));
      b.roofForm = m.hip ? 'hip' : 'gable';
      if (m.ridge) b.roofRidge = m.ridge;
    }
    delete b.parts;
    if (m.split) {
      const plinth = b.inside ? 0.45 : 0.2;
      const parts = [];
      for (const p of upperParts(b, m, r)) {
        const c = cellsIn(p.pts, RES);
        const ys = [];
        for (let i = 0; i < c.length; i += 2) {
          const k = Math.round((c[i + 1] + HALF) / RES) * N + Math.round((c[i] + HALF) / RES);
          if (r.dsm[k] > m.split && !isVeg(k, r.rgb)) ys.push(r.dsm[k]);
        }
        if (ys.length < 20) continue;
        ys.sort((a, q) => a - q);
        const ph = pct(ys, 0.5) - m.ground - plinth;
        if (ph < h + 1.5) continue;
        parts.push({ pts: p.pts, height: round1(ph) });
      }
      if (parts.length) { b.parts = parts; wings += parts.length; }
    }
    b.scanned = true;
    const rc = roofColour(b, r);
    if (rc) b.roof = hex(rc);
    changed += 1;
  }
  const walls = await wallColours(measured.filter((x) => x.m?.present));
  let wi = 0;
  for (const x of measured) {
    if (!x.m?.present) continue;
    const c = walls[wi++];
    if (c) x.b.wall = hex(c);
  }
  const found = findMissing(r, hag);
  const ground = measured.ground;
  let added = 0;
  for (const nb of found) {
    const m = measureBuilding(nb, r, ground);
    if (!m?.present) continue;
    nb.height = round1(Math.max(2.2, m.height));
    nb.levels = Math.max(1, Math.round(m.height / 3.15));
    nb.roofShape = m.roofShape;
    if (m.roofShape === 'pitched') {
      nb.roofRise = round1(Math.min(6, Math.max(0.6, m.rise)));
      nb.roofForm = m.hip ? 'hip' : 'gable';
      if (m.ridge) nb.roofRidge = m.ridge;
    }
    nb.scanned = true;
    const nrc = roofColour(nb, r);
    if (nrc) nb.roof = hex(nrc);
    data.buildings.push(nb);
    added += 1;
  }
  console.log(`export: ${changed} buildings measured, ${wings} taller wings, ${added} unmapped buildings added from the survey`);
}

/**
 * The bare-ground grid the game reads (DATA.elevation): 4 m spacing over the playable square, from
 * the survey; outside the survey, the previous (SRTM) grid shifted onto the survey's datum.
 */
function exportElevation(ground) {
  const old = data.elevation;
  const oldStep = (old.half * 2) / (old.n - 1);
  const oldAt = (x, z) => {
    const fx = Math.min(old.n - 1.001, Math.max(0, (x + old.half) / oldStep));
    const fz = Math.min(old.n - 1.001, Math.max(0, (z + old.half) / oldStep));
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const g = (i, j) => old.base + old.h[j * old.n + i];
    return (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
  };
  const gn = ground.n;
  const validAt = (x, z) => {
    const i = Math.round(x + HALF), j = Math.round(z + HALF);
    return i >= 0 && j >= 0 && i < gn && j < gn && ground.valid[j * gn + i];
  };
  const diffs = [];
  for (let z = -400; z <= 400; z += 10) for (let x = -400; x <= 400; x += 10) if (validAt(x, z)) diffs.push(sample(ground.dtm, gn, 1, x, z) - oldAt(x, z));
  diffs.sort((a, b) => a - b);
  const offset = diffs.length ? pct(diffs, 0.5) : 0;
  const half = 420, step = 4, n = half * 2 / step + 1;
  const raw = [];
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const x = -half + i * step, z = -half + j * step;
      // Weight by how much of the 13 m around has survey coverage, so the seam blends.
      let w = 0, c = 0;
      for (let dz = -6; dz <= 6; dz += 3) for (let dx = -6; dx <= 6; dx += 3) { c += 1; if (validAt(x + dx, z + dz)) w += 1; }
      w /= c;
      // In the survey's datum (Metashape writes ellipsoidal heights), then back onto sea level.
      raw.push(w * sample(ground.dtm, gn, 1, x, z) + (1 - w) * (oldAt(x, z) + offset) - offset);
    }
  }
  const base = Math.floor(Math.min(...raw) * 10) / 10;
  data.elevation = { half, n, base, h: raw.map((v) => round1(v - base)) };
  console.log(`export: elevation ${n}x${n} at ${step} m from the survey (old grid differed by ${offset.toFixed(1)} m)`);
  return offset;
}

/**
 * Reference values for checking the game against the survey (scripts/scan-check.mjs): every measured
 * roof (sea-level elevation of the wall top) and bare-ground samples away from buildings and trees.
 */
async function writeCheck(measured, ground, offset) {
  const roofs = [];
  for (const { b, m } of measured) {
    if (!m?.present) continue;
    let cx = 0, cz = 0;
    for (const [x, z] of b.pts) { cx += x / b.pts.length; cz += z / b.pts.length; }
    roofs.push({ name: b.name ?? null, cx: round1(cx), cz: round1(cz), area: Math.round(m.area), inside: b.inside, shape: m.roofShape, roof: round1(m.top - offset), rise: m.rise ? round1(m.rise) : undefined });
  }
  const samples = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let tries = 0; samples.length < 600 && tries < 20000; tries += 1) {
    const x = -400 + rnd() * 800, z = -400 + rnd() * 800;
    const i = Math.round(x + HALF), j = Math.round(z + HALF);
    let clear = true;
    for (let dj = -3; dj <= 3 && clear; dj += 1) for (let di = -3; di <= 3 && clear; di += 1) {
      const c = (j + dj) * ground.n + i + di;
      if (!ground.valid[c] || ground.offGround[c]) clear = false;
    }
    if (!clear) continue;
    samples.push([round1(x), round1(z), round1(sample(ground.dtm, ground.n, 1, x, z) - offset)]);
  }
  await writeFile(join(CACHE, 'check.json'), JSON.stringify({ offset, roofs, ground: samples }));
}

/** Surface classes as a grey PNG (one byte per metre, SURF codes). */
async function exportSurfaces(s) {
  await writePng(join(ASSETS, 'surface.png'), s.n, s.n, s.g, 1);
}

/**
 * The ground as the drone saw it, 0.5 m per pixel over the playable square: buildings, tree crowns
 * and their shadows painted out (filled from the ground around), transparent where not surveyed.
 * Encoded to WebP by the local Chrome (playwright-core), as there is no image encoder in Node.
 */
async function exportGroundPhoto(r, hag, surf, ground) {
  const S = 420;
  const n = Math.round((S * 2) / RES);
  const off = Math.round((HALF - S) / RES);
  const lum = (k) => 0.3 * r.rgb[k * 3] + 0.59 * r.rgb[k * 3 + 1] + 0.11 * r.rgb[k * 3 + 2];
  // Local brightness of the lit ground (15 m box over non-raised cells) to find shadows.
  const lit = new Float32Array(n * n).fill(NaN);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const k = (j + off) * N + i + off;
    if (r.dsm[k] === r.dsm[k] && hag[k] < 1.2) lit[j * n + i] = lum(k);
  }
  const coarse = 30; // 15 m
  const cn = Math.ceil(n / coarse);
  const cmean = new Float32Array(cn * cn);
  for (let cj = 0; cj < cn; cj += 1) for (let ci = 0; ci < cn; ci += 1) {
    const vals = [];
    for (let j = cj * coarse; j < Math.min(n, (cj + 1) * coarse); j += 2) for (let i = ci * coarse; i < Math.min(n, (ci + 1) * coarse); i += 2) {
      const v = lit[j * n + i];
      if (v === v) vals.push(v);
    }
    vals.sort((a, b) => a - b);
    cmean[cj * cn + ci] = vals.length ? pct(vals, 0.6) : 140;
  }
  // Lit ground brightness, interpolated between the 15 m block centres (no block seams).
  const refAt = (i, j) => {
    const fx = Math.min(cn - 1.001, Math.max(0, i / coarse - 0.5)), fz = Math.min(cn - 1.001, Math.max(0, j / coarse - 0.5));
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const g = (a, b) => cmean[Math.min(cn - 1, b) * cn + Math.min(cn - 1, a)];
    return (g(x0, z0) * (1 - tx) + g(x0 + 1, z0) * tx) * (1 - tz) + (g(x0, z0 + 1) * (1 - tx) + g(x0 + 1, z0 + 1) * tx) * tz;
  };
  const rgba = new Uint8Array(n * n * 4);
  const R = new Float32Array(n * n).fill(NaN), G = new Float32Array(n * n).fill(NaN), B = new Float32Array(n * n).fill(NaN);
  // Raised cells (buildings, walls, crowns), grown by a metre to take the wall fringes with them.
  const raised = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const k = (j + off) * N + i + off;
    const gi = Math.round(-S + i * RES + HALF), gj = Math.round(-S + j * RES + HALF);
    if (r.dsm[k] === r.dsm[k] && ground.offGround[gj * ground.n + gi] && hag[k] > 0.5) raised[j * n + i] = 1;
  }
  const grown = Uint8Array.from(raised);
  for (let j = 2; j < n - 2; j += 1) for (let i = 2; i < n - 2; i += 1) {
    if (!raised[j * n + i]) continue;
    for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) grown[(j + dj) * n + i + di] = 1;
  }
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const k = (j + off) * N + i + off;
    const o = j * n + i;
    if (r.dsm[k] !== r.dsm[k]) continue;
    rgba[o * 4 + 3] = 255;
    if (grown[o]) continue;
    // Shadows relit: brightened back to the lit ground around, the blue skylight cast taken out.
    const ref = refAt(i, j);
    const l = Math.max(8, lum(k));
    let f = 1, warm = 0;
    if (l < ref * 0.8) {
      f = Math.min(3.2, (ref * 0.9) / l);
      warm = Math.min(1, (f - 1) / 1.5);
    }
    R[o] = r.rgb[k * 3] * f * (1 + 0.06 * warm);
    G[o] = r.rgb[k * 3 + 1] * f;
    B[o] = r.rgb[k * 3 + 2] * f * (1 - 0.14 * warm);
  }
  // Painted-out cells take the overall lit colour of their surface class (from the 1 m class map),
  // then a soft blur over them and a metre around blends the patch edges into the photo.
  const cls = (i, j) => surf.g[Math.min(surf.n - 1, Math.round(j / 2)) * surf.n + Math.min(surf.n - 1, Math.round(i / 2))];
  const csum = new Float64Array(8 * 4);
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const o = j * n + i;
    if (R[o] !== R[o]) continue;
    const c = cls(i, j);
    csum[c * 4] += R[o]; csum[c * 4 + 1] += G[o]; csum[c * 4 + 2] += B[o]; csum[c * 4 + 3] += 1;
  }
  let seed = 99;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return ((seed >> 8) & 255) / 255 - 0.5; };
  for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) {
    const o = j * n + i;
    if (!rgba[o * 4 + 3] || R[o] === R[o]) continue;
    const c = cls(i, j);
    const cnt = csum[c * 4 + 3] || 1;
    const v = noise() * 9;
    R[o] = csum[c * 4] / cnt + v; G[o] = csum[c * 4 + 1] / cnt + v; B[o] = csum[c * 4 + 2] / cnt + v * 0.8;
  }
  const edge = new Uint8Array(n * n);
  for (let j = 2; j < n - 2; j += 1) for (let i = 2; i < n - 2; i += 1) {
    if (!grown[j * n + i]) continue;
    for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) edge[(j + dj) * n + i + di] = 1;
  }
  const fr = Float32Array.from(R), fg = Float32Array.from(G), fb = Float32Array.from(B);
  for (let j = 2; j < n - 2; j += 1) for (let i = 2; i < n - 2; i += 1) {
    const o = j * n + i;
    if (!edge[o] || !rgba[o * 4 + 3]) continue;
    let sr = 0, sg = 0, sb = 0, w = 0;
    for (let dj = -2; dj <= 2; dj += 1) for (let di = -2; di <= 2; di += 1) {
      const q = o + dj * n + di;
      if (R[q] !== R[q]) continue;
      sr += R[q]; sg += G[q]; sb += B[q]; w += 1;
    }
    if (!w) continue;
    const keep = grown[o] ? 0.35 : 0.6;
    fr[o] = R[o] * keep + (sr / w) * (1 - keep); fg[o] = G[o] * keep + (sg / w) * (1 - keep); fb[o] = B[o] * keep + (sb / w) * (1 - keep);
  }
  for (let o = 0; o < n * n; o += 1) {
    if (!rgba[o * 4 + 3]) continue;
    const col = [fr[o], fg[o], fb[o]];
    // Drone haze off: a little more contrast and saturation.
    const l = 0.3 * col[0] + 0.59 * col[1] + 0.11 * col[2];
    for (let ch = 0; ch < 3; ch += 1) {
      const sat = l + (col[ch] - l) * 1.2;
      rgba[o * 4 + ch] = Math.max(0, Math.min(255, (sat - 128) * 1.06 + 126));
    }
  }
  await writePng(join(DEBUG, 'ground-photo.png'), n, n, rgba, 4);
  const { chromium } = await import('playwright-core');
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  try {
    const page = await browser.newPage();
    const b64 = await page.evaluate(async ({ n, data }) => {
      const bytes = Uint8ClampedArray.from(atob(data), (ch) => ch.charCodeAt(0));
      const c = new OffscreenCanvas(n, n);
      c.getContext('2d').putImageData(new ImageData(bytes, n, n), 0, 0);
      const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.82 });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, { n, data: Buffer.from(rgba).toString('base64') });
    const out = Buffer.from(b64, 'base64');
    await writeFile(join(ASSETS, 'ground.webp'), out);
    console.log(`export: ground photo ${n}x${n}, ${(out.length / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
  }
}

/** Debug: hillshade of the bare ground, 1 m per pixel. */
async function debugGround(ground) {
  const n = ground.n;
  const px = new Uint8Array(n * n);
  for (let z = 0; z < n - 1; z += 1) {
    for (let x = 0; x < n - 1; x += 1) {
      const h = ground.dtm[z * n + x];
      const nx = -(ground.dtm[z * n + x + 1] - h), nz = -(ground.dtm[(z + 1) * n + x] - h);
      const l = (nx * -0.6 + nz * -0.6 + 1) / Math.hypot(nx, nz, 1);
      px[z * n + x] = ground.valid[z * n + x] ? Math.max(0, Math.min(255, l * 200 + 30)) : 0;
    }
  }
  await writePng(join(DEBUG, 'ground-shade.png'), n, n, px, 1);
}

const step = process.argv[2] ?? 'all';
if (step === 'raster' || !existsSync(join(CACHE, 'dsm.f32'))) {
  await buildRasters();
  await debugRasters(await loadRasters());
}
if (step !== 'raster') {
  const r = await loadRasters();
  ROUGH = roughness(r.dsm, N);
  console.time('ground');
  const ground = bareGround(r);
  console.timeEnd('ground');
  const hag = heightAboveGround(r, ground);
  const shift = findShift(r, hag);
  await debugHeights(r, hag, shift);
  const measured = measureAll(r, ground);
  await debugGround(ground);
  const surf = groundSurfaces(surfaces(r, hag));
  await debugSurfaces(surf);
  await debugSurfaces(surf, 'surfaces-core', [-40, -200, 240, 60]);
  if (step === 'all' || step === 'export') {
    await mkdir(ASSETS, { recursive: true });
    measured.ground = ground;
    await applyBuildings(measured, r, hag);
    const offset = exportElevation(ground);
    await writeCheck(measured, ground, offset);
    await exportSurfaces(surf);
    data.trees = findTrees(r, hag);
    data.poles = findPoles(r, hag);
    console.log(`export: ${data.poles.length} poles along the roads`);
    measureTowers(r);
    snapPaths(r, hag, surf);
    console.log(`export: ${data.trees.length} trees from the survey canopy`);
    await exportGroundPhoto(r, hag, surf, ground);
    data.source = data.source.replace(/; survey .*$/, '') + '; survey: drone photogrammetry (Agisoft Metashape) of the campus — heights, roofs, ground and surfaces';
    await writeFile(DATA_PATH, JSON.stringify(data));
    console.log('export: wrote src/campus/campusData.json');
  }
  if (process.env.SCAN_CROPS) {
    const absent = measured.filter((x) => x.m?.covered && x.m.present === false).map((x) => ({ pts: x.b.pts, col: [255, 230, 0] }));
    await debugCrop(r, hag, 'crop-core', -20, -190, 220, 30, absent);
    await debugCrop(r, hag, 'crop-south', -150, 20, 150, 200, absent);
    await debugCrop(r, hag, 'crop-all', -400, -400, 400, 400, absent);
    const paths = data.lines.filter((l) => /footway|path|steps|pedestrian/.test(l.kind)).map((l) => ({ pts: l.pts, col: [255, 0, 255], closed: false }));
    await debugCrop(r, hag, 'paths-core', 20, -170, 200, -40, paths);
    await debugCrop(r, hag, 'paths-west', -120, -60, 60, 60, paths);
  }
}
