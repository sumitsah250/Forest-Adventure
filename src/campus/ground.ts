// Campus ground: a heightfield from the real elevation samples (10 m grid from SRTM,
// smoothed, bicubic), then graded the way a hillside campus is built:
//  - every building stands on its own level platform (footprint plus an apron),
//  - sports grounds, courts, parking and plazas are flattened,
//  - roads and paths follow a smoothed profile along their length,
//  - stairways climb in a straight incline between their two ends,
//  - everything else blends back into the natural slope as grass banks.
// So the campus reads as terraces at different levels, high and low, joined by
// banks, roads and steps. It also keeps a surface-class grid for footsteps and tree
// placement, and provides the subset of the forest TerrainData interface the
// player, camera and physics use.

import { DATA, WORLD_HALF, centroid, orientedRect, pointInPoly, polyArea, segDist, type BuildingData, type Pt } from './geo.ts';
import type { SurfaceKind } from '../world/terrain.ts';

/** Vertices per side: 2 m cells, fine enough for crisp terrace banks. */
export const GROUND_N = 421;

/** Surface classes painted into the class grid (red channel codes). */
export const CLS = { soil: 0, grass: 1, paved: 2, path: 3, building: 4, pitch: 5, water: 6, road: 7 } as const;

/** One grading constraint: a level or profiled surface over a polygon or a line corridor. */
interface Grade {
  /** Higher wins where two constraints overlap. */
  prio: number;
  /** Extra flat margin around the shape (m). */
  apron: number;
  /** Width of the blend back into the natural ground (m). */
  fall: number;
  poly?: Pt[];
  line?: { pts: Pt[]; half: number; s: number[]; prof: (s: number) => number };
  level?: number;
  /** A ramp across a stand: height from `lower` at the inner edge to `upper` at the outer edge. */
  ramp?: Tiers;
  bb: [number, number, number, number];
}

/**
 * Spectator tiers (the WRC parapet): a strip on the bank between an upper level and
 * a sports ground, stepped down to the field. Frame: origin at the middle of the
 * inner (field) edge, `u` along the strip, `v` from the field toward the upper side.
 */
export interface Tiers {
  ox: number;
  oz: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  halfLen: number;
  depth: number;
  count: number;
  lower: number;
  rise: number;
}

const ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service', 'track', 'pedestrian', 'living_street']);
const PATHS = new Set(['footway', 'path', 'cycleway']);

export class CampusGround {
  readonly n = GROUND_N;
  readonly cell = (WORLD_HALF * 2) / (GROUND_N - 1);
  readonly origin = -WORLD_HALF;
  readonly heights: Float32Array;
  /** Elevation of world y = 0 in metres above sea level. */
  readonly datum: number;
  private dem: Float32Array;
  private demN: number;
  private demStep: number;
  private demHalf: number;
  /** Platform level of each building (world y). */
  private pads = new Map<BuildingData, number>();
  /** Stepped spectator stands. */
  readonly tiers: Tiers[] = [];
  /** Surface classes, CLS codes, `clsN`² cells over the playable square. */
  cls: Uint8Array = new Uint8Array(1);
  clsN = 1;

  constructor() {
    const e = DATA.elevation;
    this.demN = e.n;
    this.demHalf = e.half;
    this.demStep = (e.half * 2) / (e.n - 1);
    // One light blur takes the stair-stepping out of the source tiles.
    let g = Float32Array.from(e.h);
    const passes = this.demStep < 30 ? 1 : 2;
    for (let pass = 0; pass < passes; pass += 1) {
      const o = new Float32Array(g.length);
      const n = e.n;
      for (let z = 0; z < n; z += 1) {
        for (let x = 0; x < n; x += 1) {
          let s = 0;
          let w = 0;
          for (let dz = -1; dz <= 1; dz += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              const xx = Math.min(n - 1, Math.max(0, x + dx));
              const zz = Math.min(n - 1, Math.max(0, z + dz));
              const k = dx === 0 && dz === 0 ? 4 : dx === 0 || dz === 0 ? 2 : 1;
              s += g[zz * n + xx] * k;
              w += k;
            }
          }
          o[z * n + x] = s / w;
        }
      }
      g = o;
    }
    this.dem = g;
    const centre = this.demAt(0, 0);
    this.datum = e.base + centre;
    for (let i = 0; i < g.length; i += 1) g[i] -= centre;

    const n = this.n;
    const natural = new Float32Array(n * n);
    for (let zi = 0; zi < n; zi += 1) {
      for (let xi = 0; xi < n; xi += 1) {
        const x = this.origin + xi * this.cell;
        const z = this.origin + zi * this.cell;
        natural[zi * n + xi] = this.demAt(x, z) + micro(x, z);
      }
    }
    this.heights = this.grade(natural);
  }

  /** Platform level a building was given (world y), if it has one. */
  padLevel(b: BuildingData): number | undefined {
    return this.pads.get(b);
  }

  /** Height to stand or place things at: the ground, or the top of a spectator tier. */
  standAt(x: number, z: number): number {
    let y = this.heightAt(x, z);
    for (const t of this.tiers) {
      const u = (x - t.ox) * t.ux + (z - t.oz) * t.uz;
      const v = (x - t.ox) * t.vx + (z - t.oz) * t.vz;
      if (Math.abs(u) > t.halfLen || v < 0 || v > t.depth) continue;
      const k = Math.min(t.count - 1, Math.floor(v / (t.depth / t.count)));
      y = Math.max(y, t.lower + (k + 1) * t.rise);
    }
    return y;
  }

  // ------------------------------------------------------------ grading

  private grade(natural: Float32Array): Float32Array {
    const grades: Grade[] = [];
    const stepEnds: { ends: { h0: number; h1: number }; a: Pt; b: Pt }[] = [];
    const meanOver = (pts: Pt[]) => {
      // Mean natural height over the shape: its corners plus an interior sample grid.
      let s = 0;
      let k = 0;
      for (const [x, z] of pts) {
        s += this.demAt(x, z);
        k += 1;
      }
      const bb = bounds(pts);
      const step = Math.max(2, Math.min(bb[2] - bb[0], bb[3] - bb[1]) / 6);
      for (let x = bb[0]; x <= bb[2]; x += step) {
        for (let z = bb[1]; z <= bb[3]; z += step) {
          if (!pointInPoly(x, z, pts)) continue;
          s += this.demAt(x, z);
          k += 1;
        }
      }
      return s / k;
    };
    // Building platforms.
    for (const b of DATA.buildings) {
      if (b.pts.length < 3 || Math.abs(polyArea(b.pts)) < 4) continue;
      const level = meanOver(b.pts);
      this.pads.set(b, level);
      const apron = b.inside ? 2 : 1;
      grades.push({ prio: 3, apron, fall: b.inside ? 7 : 5, poly: b.pts, level, bb: grow(bounds(b.pts), apron + 7) });
    }
    // Sports grounds, courts, parking and plazas: flat.
    const STAND = /parapet|stand|bleacher|gallery|seating/i;
    const flats: { pts: Pt[]; level: number }[] = [];
    for (const a of DATA.areas) {
      if (!['pitch', 'ground', 'parking', 'plaza'].includes(a.kind) || a.pts.length < 3 || STAND.test(a.name ?? '')) continue;
      const fall = a.kind === 'ground' ? 12 : 7;
      const level = meanOver(a.pts);
      flats.push({ pts: a.pts, level });
      grades.push({ prio: 2, apron: 0.6, fall, poly: a.pts, level, bb: grow(bounds(a.pts), fall + 1) });
    }
    // Spectator stands: stepped down from the upper ground to the field they face.
    for (const a of DATA.areas) {
      if (!STAND.test(a.name ?? '') || a.pts.length < 3) continue;
      const r = orientedRect(a.pts);
      const ux = Math.cos(r.angle);
      const uz = Math.sin(r.angle);
      // The long edge nearer a flat area is the field side.
      let best: { side: number; level: number; d: number } | null = null;
      for (const side of [-1, 1]) {
        const ex = r.cx - uz * r.hw * side;
        const ez = r.cz + ux * r.hw * side;
        for (const f of flats) {
          const [fx, fz] = centroid(f.pts);
          const inside = pointInPoly(ex - (r.cx - ex) * 0.2, ez - (r.cz - ez) * 0.2, f.pts);
          const d = inside ? 0 : Math.hypot(fx - ex, fz - ez);
          if (!best || d < best.d) best = { side, level: f.level, d };
        }
      }
      if (!best) continue;
      const ox = r.cx - uz * r.hw * best.side;
      const oz = r.cz + ux * r.hw * best.side;
      const vx = (r.cx - ox) / r.hw;
      const vz = (r.cz - oz) / r.hw;
      const depth = r.hw * 2;
      let upper = 0;
      for (let k = -4; k <= 4; k += 1) upper += this.demAt(ox + vx * (depth + 1) + ux * (k / 4) * r.hl, oz + vz * (depth + 1) + uz * (k / 4) * r.hl) / 9;
      const drop = upper - best.level;
      if (drop < 0.4) {
        grades.push({ prio: 2, apron: 0.6, fall: 7, poly: a.pts, level: meanOver(a.pts), bb: grow(bounds(a.pts), 8) });
        continue;
      }
      const count = Math.max(2, Math.min(Math.round(depth / 0.8), Math.round(drop / 0.45)));
      const t: Tiers = { ox, oz, ux, uz, vx, vz, halfLen: r.hl, depth, count, lower: best.level, rise: drop / count };
      this.tiers.push(t);
      grades.push({ prio: 3, apron: 0, fall: 6, poly: a.pts, ramp: t, bb: grow(bounds(a.pts), 7) });
    }
    // Roads, paths and steps: profiled corridors.
    for (const l of DATA.lines) {
      if (l.area || l.pts.length < 2) continue;
      const road = ROADS.has(l.kind);
      const steps = l.kind === 'steps';
      if (!road && !steps && !PATHS.has(l.kind)) continue;
      const s = [0];
      for (let i = 1; i < l.pts.length; i += 1) s.push(s[i - 1] + Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]));
      const len = s[s.length - 1];
      if (len < 0.5) continue;
      const at = (d: number): Pt => {
        let i = 1;
        while (i < s.length - 1 && s[i] < d) i += 1;
        const t = (d - s[i - 1]) / Math.max(1e-6, s[i] - s[i - 1]);
        return [l.pts[i - 1][0] + (l.pts[i][0] - l.pts[i - 1][0]) * t, l.pts[i - 1][1] + (l.pts[i][1] - l.pts[i - 1][1]) * t];
      };
      let prof: (d: number) => number;
      if (steps) {
        // A straight flight between the levels at its two ends (set in the second pass).
        const ends = { h0: this.demAt(...l.pts[0]), h1: this.demAt(...l.pts[l.pts.length - 1]) };
        prof = (d) => ends.h0 + (ends.h1 - ends.h0) * Math.min(1, Math.max(0, d / len));
        stepEnds.push({ ends, a: l.pts[0], b: l.pts[l.pts.length - 1] });
      } else {
        // Natural profile, smoothed along the line (roads more than footpaths).
        const step = 2;
        const count = Math.max(2, Math.ceil(len / step) + 1);
        const raw: number[] = [];
        for (let i = 0; i < count; i += 1) raw.push(this.demAt(...at((i / (count - 1)) * len)));
        const win = Math.max(1, Math.round((road ? 14 : 6) / step));
        const sm = raw.map((_, i) => {
          let t = 0;
          let k = 0;
          for (let j = Math.max(0, i - win); j <= Math.min(count - 1, i + win); j += 1) {
            t += raw[j];
            k += 1;
          }
          return t / k;
        });
        prof = (d) => {
          const f = (Math.min(len, Math.max(0, d)) / len) * (count - 1);
          const i = Math.min(count - 2, Math.floor(f));
          return sm[i] + (sm[i + 1] - sm[i]) * (f - i);
        };
      }
      const half = l.w / 2 + (road ? 0.4 : 0.15);
      const fall = road ? 4 : steps ? 3 : 2.5;
      grades.push({ prio: steps ? 4 : 1, apron: 0, fall, line: { pts: l.pts, half, s, prof }, bb: grow(bounds(l.pts), half + fall + 1) });
    }

    // Pass 1: everything but the stairs. Pass 2: stairs, from the levels pass 1
    // produced at their two ends, so a flight meets the ground at both ends.
    const first = this.applyGrades(natural, grades.filter((g) => g.prio !== 4));
    for (const s of stepEnds) {
      s.ends.h0 = this.sample(first, s.a[0], s.a[1]);
      s.ends.h1 = this.sample(first, s.b[0], s.b[1]);
    }
    return this.applyGrades(first, grades.filter((g) => g.prio === 4), true);
  }

  /** Bilinear sample of a grid shaped like `heights`. */
  private sample(h: Float32Array, x: number, z: number): number {
    const n = this.n;
    const fx = Math.min(n - 1.001, Math.max(0, (x - this.origin) / this.cell));
    const fz = Math.min(n - 1.001, Math.max(0, (z - this.origin) / this.cell));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const r0 = h[iz * n + ix] * (1 - tx) + h[iz * n + ix + 1] * tx;
    const r1 = h[(iz + 1) * n + ix] * (1 - tx) + h[(iz + 1) * n + ix + 1] * tx;
    return r0 * (1 - tz) + r1 * tz;
  }

  /**
   * Applies constraints over a base grid. Inside a shape its target wins (highest
   * priority first); around it the ground blends back over `fall` metres. Where
   * several blends overlap the nearest dominates (weights to the 4th power), so
   * neighbouring terraces meet in one clean bank instead of a sawtooth.
   */
  private applyGrades(base: Float32Array, grades: Grade[], keepOutside = false): Float32Array {
    const n = this.n;
    const bestPrio = new Int8Array(n * n).fill(-1);
    const bestT = new Float32Array(n * n);
    const sumW = new Float32Array(n * n);
    const sumWT = new Float32Array(n * n);
    const maxW = new Float32Array(n * n);
    for (const gr of grades) {
      const x0 = Math.max(0, Math.floor((gr.bb[0] - this.origin) / this.cell));
      const x1 = Math.min(n - 1, Math.ceil((gr.bb[2] - this.origin) / this.cell));
      const z0 = Math.max(0, Math.floor((gr.bb[1] - this.origin) / this.cell));
      const z1 = Math.min(n - 1, Math.ceil((gr.bb[3] - this.origin) / this.cell));
      for (let zi = z0; zi <= z1; zi += 1) {
        for (let xi = x0; xi <= x1; xi += 1) {
          const x = this.origin + xi * this.cell;
          const z = this.origin + zi * this.cell;
          let d: number;
          let t: number;
          if (gr.ramp) {
            const R = gr.ramp;
            const u = (x - R.ox) * R.ux + (z - R.oz) * R.uz;
            const v = (x - R.ox) * R.vx + (z - R.oz) * R.vz;
            const du = Math.max(0, Math.abs(u) - R.halfLen);
            const dv = v < 0 ? -v : Math.max(0, v - R.depth);
            // Corners of the mapped outline beyond the fitted rectangle still belong to the stand.
            d = gr.poly && pointInPoly(x, z, gr.poly) ? 0 : Math.hypot(du, dv);
            t = R.lower + R.rise * R.count * Math.min(1, Math.max(0, v / R.depth));
          } else if (gr.poly) {
            d = pointInPoly(x, z, gr.poly) ? 0 : Math.max(0, edgeDist(x, z, gr.poly) - gr.apron);
            t = gr.level!;
          } else {
            const L = gr.line!;
            let best = Infinity;
            let along = 0;
            for (let i = 0; i < L.pts.length - 1; i += 1) {
              const r = segDist(x, z, L.pts[i], L.pts[i + 1]);
              if (r.d < best) {
                best = r.d;
                along = L.s[i] + (L.s[i + 1] - L.s[i]) * r.t;
              }
            }
            d = Math.max(0, best - L.half);
            t = L.prof(along);
          }
          if (d >= gr.fall) continue;
          const i = zi * n + xi;
          if (d === 0) {
            if (gr.prio > bestPrio[i]) {
              bestPrio[i] = gr.prio;
              bestT[i] = t;
            }
          } else {
            const u = d / gr.fall;
            const w = 1 - u * u * (3 - 2 * u);
            const w4 = w * w * w * w;
            sumW[i] += w4;
            sumWT[i] += w4 * t;
            maxW[i] = Math.max(maxW[i], w);
          }
        }
      }
    }
    const out = new Float32Array(n * n);
    for (let i = 0; i < n * n; i += 1) {
      if (bestPrio[i] >= 0) out[i] = bestT[i];
      else if (sumW[i] > 0) out[i] = base[i] + (sumWT[i] / sumW[i] - base[i]) * Math.min(1, maxW[i]);
      else out[i] = base[i];
    }
    void keepOutside;
    return out;
  }

  /** Bicubic (Catmull-Rom) sample of the smoothed elevation grid, clamped at the edges. */
  demAt(x: number, z: number): number {
    const n = this.demN;
    const fx = (x + this.demHalf) / this.demStep;
    const fz = (z + this.demHalf) / this.demStep;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const at = (xx: number, zz: number) => this.dem[Math.min(n - 1, Math.max(0, zz)) * n + Math.min(n - 1, Math.max(0, xx))];
    const row = (zz: number) => cubic(at(ix - 1, zz), at(ix, zz), at(ix + 1, zz), at(ix + 2, zz), tx);
    return cubic(row(iz - 1), row(iz), row(iz + 1), row(iz + 2), tz);
  }

  /** Height of the rendered and simulated ground (bilinear over the heightfield grid, like the collider). */
  heightAt(x: number, z: number): number {
    const fx = (x - this.origin) / this.cell;
    const fz = (z - this.origin) / this.cell;
    if (fx < 0 || fz < 0 || fx >= this.n - 1 || fz >= this.n - 1) return this.demAt(x, z);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h = this.heights;
    const n = this.n;
    const a = h[iz * n + ix];
    const b = h[iz * n + ix + 1];
    const c = h[(iz + 1) * n + ix];
    const d = h[(iz + 1) * n + ix + 1];
    // Same diagonal split as the Rapier heightfield triangles.
    if (tx + tz <= 1) return a + (b - a) * tx + (c - a) * tz;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  /** Steepness at a point: rise over run (0 = flat, 1 = 45°). */
  slopeAt(x: number, z: number): number {
    const e = this.cell;
    const gx = (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e);
    const gz = (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }

  waterAt(): null {
    return null;
  }

  classAt(x: number, z: number): number {
    const n = this.clsN;
    const xi = Math.floor(((x + WORLD_HALF) / (WORLD_HALF * 2)) * n);
    const zi = Math.floor(((z + WORLD_HALF) / (WORLD_HALF * 2)) * n);
    if (xi < 0 || zi < 0 || xi >= n || zi >= n) return CLS.soil;
    return this.cls[zi * n + xi];
  }

  surfaceAt(x: number, z: number): SurfaceKind {
    switch (this.classAt(x, z)) {
      case CLS.paved:
      case CLS.road:
      case CLS.pitch:
      case CLS.building:
        return 'rock';
      case CLS.path:
        return 'gravel';
      case CLS.soil:
        return 'mud';
      default:
        return 'grass';
    }
  }
}

function bounds(p: Pt[]): [number, number, number, number] {
  let a = Infinity;
  let b = Infinity;
  let c = -Infinity;
  let d = -Infinity;
  for (const [x, z] of p) {
    a = Math.min(a, x);
    b = Math.min(b, z);
    c = Math.max(c, x);
    d = Math.max(d, z);
  }
  return [a, b, c, d];
}

function grow(bb: [number, number, number, number], m: number): [number, number, number, number] {
  return [bb[0] - m, bb[1] - m, bb[2] + m, bb[3] + m];
}

function edgeDist(x: number, z: number, p: Pt[]): number {
  let d = Infinity;
  for (let i = 0; i < p.length; i += 1) d = Math.min(d, segDist(x, z, p[i], p[(i + 1) % p.length]).d);
  return d;
}

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** Small undulation so lawns are not perfectly flat. */
function micro(x: number, z: number): number {
  return Math.sin(x * 0.11 + Math.sin(z * 0.07)) * 0.12 + Math.sin(z * 0.13 + x * 0.05) * 0.1;
}
