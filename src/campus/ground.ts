// Campus ground: a heightfield from the real elevation samples (smoothed, bicubic) and a
// surface-class grid for footsteps and tree placement. It provides the subset of the forest
// TerrainData interface the player, camera and physics use.

import { DATA, WORLD_HALF } from './geo.ts';
import type { SurfaceKind } from '../world/terrain.ts';

export const GROUND_N = 211;

/** Surface classes painted into the class grid (red channel codes). */
export const CLS = { soil: 0, grass: 1, paved: 2, path: 3, building: 4, pitch: 5, water: 6, road: 7 } as const;

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
  /** Surface classes, CLS codes, `clsN`² cells over the playable square. */
  cls: Uint8Array = new Uint8Array(1);
  clsN = 1;

  constructor() {
    const e = DATA.elevation;
    this.demN = e.n;
    this.demHalf = e.half;
    this.demStep = (e.half * 2) / (e.n - 1);
    // The 90 m source grid is resampled at 60 m, which repeats rows and columns: blur it twice.
    let g = Float32Array.from(e.h);
    for (let pass = 0; pass < 2; pass += 1) {
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

    this.heights = new Float32Array(this.n * this.n);
    for (let zi = 0; zi < this.n; zi += 1) {
      for (let xi = 0; xi < this.n; xi += 1) {
        const x = this.origin + xi * this.cell;
        const z = this.origin + zi * this.cell;
        this.heights[zi * this.n + xi] = this.demAt(x, z) + micro(x, z);
      }
    }
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

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

/** Small undulation so lawns are not perfectly flat. */
function micro(x: number, z: number): number {
  return Math.sin(x * 0.11 + Math.sin(z * 0.07)) * 0.12 + Math.sin(z * 0.13 + x * 0.05) * 0.1;
}
