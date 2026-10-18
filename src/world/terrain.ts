// Terrain generation: a designed heightfield (valley, ravine, ridge) carved by the
// creek, flattened at clearings and graded under roads. Pure data, no rendering,
// so it runs in Node tests as well as the browser.

import { Noise2D, clamp, lerp, smoothstep } from './noise.ts';
import { Path, stampPath, type GridSpec } from './paths.ts';
import { CLEARINGS, CREEK, GRAVEL_PADS, ROAD_DEFS, WORLD_HALF, type CreekPoint } from './layout.ts';

export const TERRAIN_N = 385; // vertices per side
export const TERRAIN_CELL = (WORLD_HALF * 2) / (TERRAIN_N - 1);
/** Resolution of the surface data textures (road distance, splat). */
export const SURFACE_N = 1024;
export const SURFACE_CELL = (WORLD_HALF * 2) / SURFACE_N;

export type SurfaceKind = 'gravel' | 'mud' | 'forest' | 'moss' | 'rock' | 'water' | 'grass';

interface RoadProfile {
  path: Path;
  /** Road surface height sampled every metre of arc length. */
  heights: Float32Array;
  /** Arc-length range where the road is not graded (the collapsed bridge gap). */
  gap: [number, number] | null;
}

export interface CreekSample {
  level: number;
  depth: number;
  channel: number;
  floor: number;
  wall: number;
}

function zTrend(z: number): number {
  // Valley profile from south (z = +300) to north (z = -300).
  const table: [number, number][] = [
    [320, 16.5], [260, 15], [150, 12], [60, 8.6], [0, 7.2], [-55, 5.6], [-80, 4.4],
    [-105, 7.4], [-140, 12.4], [-180, 16.6], [-240, 21.5], [-320, 25],
  ];
  for (let i = 0; i < table.length - 1; i += 1) {
    const [z0, h0] = table[i];
    const [z1, h1] = table[i + 1];
    if (z <= z0 && z >= z1) {
      const t = (z0 - z) / (z0 - z1);
      const s = t * t * (3 - 2 * t);
      return lerp(h0, h1, s);
    }
  }
  return z > 0 ? table[0][1] : table[table.length - 1][1];
}

export class TerrainData {
  readonly n = TERRAIN_N;
  readonly cell = TERRAIN_CELL;
  readonly origin = -WORLD_HALF;
  readonly heights: Float32Array;
  readonly creek: Path;
  readonly roads: Path[];
  readonly creekSamples: CreekSample[];
  /** Per surface texel: signed distance to the nearest road/track (m), 99 when far. */
  readonly roadSigned: Float32Array;
  /** Per surface texel: index of that road in `roads` (255 = none). */
  readonly roadId: Uint8Array;
  /** Per surface texel: arc length along that road. */
  readonly roadS: Float32Array;
  /** Per surface texel: signed distance to the creek centreline. */
  readonly creekSigned: Float32Array;
  readonly creekS: Float32Array;
  /** RGBA8 splat: R mud, G moss, B leaf litter, A wetness. */
  readonly splat: Uint8Array;
  private noise = new Noise2D(1337);
  private detail = new Noise2D(7331);
  private profiles: RoadProfile[] = [];
  private clearingTargets: number[] = [];

  constructor() {
    this.clearingTargets = CLEARINGS.map((c) => this.natural(c.x, c.z) + (c.offset ?? 0));
    this.creek = new Path(
      { id: 'creek', kind: 'creek', halfWidth: 3, points: CREEK.map((p) => [p.x, p.z] as const) },
      0.75,
    );
    this.creekSamples = this.buildCreekSamples();
    this.roads = ROAD_DEFS.map((def) => new Path(def, 0.4));

    const n = this.n;
    const grid: GridSpec = { origin: this.origin, cell: this.cell, n };
    const count = n * n;

    // 1. Natural terrain + clearings.
    const h = new Float32Array(count);
    for (let zi = 0; zi < n; zi += 1) {
      for (let xi = 0; xi < n; xi += 1) {
        const x = this.origin + xi * this.cell;
        const z = this.origin + zi * this.cell;
        h[zi * n + xi] = this.withClearings(x, z, this.natural(x, z));
      }
    }

    // 2. Creek valley carved with a smooth minimum.
    const cDist = new Float32Array(count).fill(1e9);
    const cSigned = new Float32Array(count);
    const cS = new Float32Array(count);
    stampPath(this.creek, grid, 75, cDist, cSigned, cS, null, 0);
    for (let k = 0; k < count; k += 1) {
      if (cDist[k] > 1e8) continue;
      const carved = this.creekProfile(cDist[k], cS[k]);
      h[k] = smin(h[k], carved, 2.2);
    }

    // 3. Roads graded on top (profiles sampled from the carved terrain). Side roads
    //    are blended into the main road profile at junctions, and the main road is
    //    graded last so its surface always wins.
    this.heights = h;
    const mainProfile = this.buildProfile(this.roads[0], null);
    this.profiles = this.roads.map((path, i) => (i === 0 ? mainProfile : this.buildProfile(path, mainProfile)));
    const order = [...this.roads.keys()].filter((i) => i !== 0).concat([0]);
    for (const r of order) {
      const path = this.roads[r];
      if (path.kind === 'foot') continue;
      const dist = new Float32Array(count).fill(1e9);
      const signed = new Float32Array(count);
      const sArr = new Float32Array(count);
      stampPath(path, grid, path.halfWidth + 16, dist, signed, sArr, null, 0);
      const prof = this.profiles[r];
      for (let k = 0; k < count; k += 1) {
        if (dist[k] > 1e8) continue;
        h[k] = this.gradeRoad(h[k], dist[k], sArr[k], prof);
      }
    }

    // 4. Surface data at higher resolution for shading and gameplay queries.
    const sn = SURFACE_N;
    const sgrid: GridSpec = { origin: this.origin + SURFACE_CELL / 2, cell: SURFACE_CELL, n: sn };
    const scount = sn * sn;
    const rDist = new Float32Array(scount).fill(1e9);
    this.roadSigned = new Float32Array(scount).fill(99);
    this.roadId = new Uint8Array(scount).fill(255);
    this.roadS = new Float32Array(scount);
    this.roads.forEach((path, i) => stampPath(path, sgrid, path.halfWidth + 9, rDist, this.roadSigned, this.roadS, this.roadId, i));
    const ccDist = new Float32Array(scount).fill(1e9);
    this.creekSigned = new Float32Array(scount).fill(99);
    this.creekS = new Float32Array(scount);
    stampPath(this.creek, sgrid, 30, ccDist, this.creekSigned, this.creekS, null, 0);
    this.splat = this.buildSplat();
  }

  // ---------------------------------------------------------------- shaping

  /** Designed large-scale landform plus layered noise. */
  natural(x: number, z: number): number {
    const nz = this.noise;
    let h = zTrend(z);
    // Ridge around the lookout, plateau above the ravine, low ground east.
    h += 5 * Math.exp(-((x + 100) ** 2 + (z + 245) ** 2) / (2 * 80 * 80));
    h += 11 * smoothstep(-30, -190, x) * smoothstep(-70, -150, z);
    h -= 4 * smoothstep(60, 280, x) * smoothstep(60, -60, z);
    // Rolling relief: broad swells, mid hummocks, small undulation.
    h += 5.2 * nz.fbm(x / 190 + 3.1, z / 190 - 1.7, 4);
    h += 1.5 * nz.fbm(x / 47 - 9.2, z / 47 + 4.4, 3);
    h += 0.32 * this.detail.noise(x / 9.5, z / 9.5);
    // Rim of higher wooded hills hides the map edge.
    const edge = Math.max(Math.abs(x), Math.abs(z));
    h += 20 * smoothstep(225, 300, edge) * (0.75 + 0.25 * nz.noise(x / 60, z / 60));
    return h;
  }

  private withClearings(x: number, z: number, h: number): number {
    for (let i = 0; i < CLEARINGS.length; i += 1) {
      const c = CLEARINGS[i];
      const d = Math.hypot(x - c.x, z - c.z);
      if (d > c.radius + c.blend) continue;
      const target = this.clearingTargets[i];
      const relief = (h - target) * c.keep;
      const w = 1 - smoothstep(c.radius, c.radius + c.blend, d);
      h = lerp(h, target + relief, w);
    }
    return h;
  }

  private buildCreekSamples(): CreekSample[] {
    // Interpolate the designed cross-section along the creek, then make the water
    // level follow the land: never above (natural - 1.6) and never rising downstream.
    const path = this.creek;
    const ctrl = CREEK;
    const ctrlS: number[] = ctrl.map((p) => path.nearest(p.x, p.z).s);
    const out: CreekSample[] = [];
    const steps = Math.ceil(path.length);
    let minLevel = Infinity;
    for (let i = 0; i <= steps; i += 1) {
      const s = (i / steps) * path.length;
      let j = 0;
      while (j < ctrl.length - 2 && ctrlS[j + 1] < s) j += 1;
      const t = clamp((s - ctrlS[j]) / Math.max(1e-3, ctrlS[j + 1] - ctrlS[j]), 0, 1);
      const a = ctrl[j];
      const b = ctrl[j + 1];
      const mix = (key: keyof CreekPoint) => lerp(a[key] as number, b[key] as number, t);
      const p = path.at(s);
      const ground = this.natural(p.x, p.z) - 1.6;
      minLevel = Math.min(minLevel, ground, mix('level'));
      out.push({ level: minLevel, depth: mix('depth'), channel: mix('channel'), floor: mix('floor'), wall: mix('wall') });
    }
    // Smooth the level so cascades are gentle.
    const smooth = out.map((o) => o.level);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let i = 1; i < smooth.length - 1; i += 1) smooth[i] = Math.min(smooth[i - 1], (smooth[i - 1] + smooth[i] + smooth[i + 1]) / 3);
    }
    out.forEach((o, i) => { o.level = smooth[i]; });
    return out;
  }

  creekAt(s: number): CreekSample {
    const f = clamp(s, 0, this.creek.length);
    const i = Math.min(this.creekSamples.length - 2, Math.floor(f));
    const t = f - i;
    const a = this.creekSamples[i];
    const b = this.creekSamples[i + 1];
    return {
      level: lerp(a.level, b.level, t),
      depth: lerp(a.depth, b.depth, t),
      channel: lerp(a.channel, b.channel, t),
      floor: lerp(a.floor, b.floor, t),
      wall: lerp(a.wall, b.wall, t),
    };
  }

  private creekProfile(d: number, s: number): number {
    const c = this.creekAt(s);
    if (d < c.channel) {
      const u = d / c.channel;
      return c.level - c.depth * (1 - u * u);
    }
    const bank = 0.75 * smoothstep(c.channel, c.channel + 1.8, d);
    const floorRise = 0.04 * Math.max(0, d - c.channel);
    const wall = Math.max(0, d - c.channel - c.floor) * c.wall;
    return c.level + bank + Math.min(floorRise, 0.6) + wall;
  }

  private buildProfile(path: Path, main: RoadProfile | null): RoadProfile {
    const len = Math.ceil(path.length);
    const raw = new Float32Array(len + 1);
    for (let i = 0; i <= len; i += 1) {
      const p = path.at(i);
      raw[i] = this.sampleGrid(p.x, p.z);
      if (main && path.kind !== 'foot') {
        // Meet the main road at its own height where the two join.
        const near = main.path.nearest(p.x, p.z);
        const reach = main.path.halfWidth + 7;
        if (near.dist < reach) {
          const w = 1 - smoothstep(main.path.halfWidth * 0.5, reach, near.dist);
          raw[i] = lerp(raw[i], this.roadHeightAt(main, near.s), w);
        }
      }
    }
    let gap: [number, number] | null = null;
    if (path.id === 'main') {
      // Find where the road crosses the creek; the bridge spans a gap there.
      let best = Infinity;
      let sCross = 0;
      for (let i = 0; i <= len; i += 1) {
        const p = path.at(i);
        const d = this.creek.nearest(p.x, p.z).dist;
        if (d < best) { best = d; sCross = i; }
      }
      const pc = path.at(sCross);
      const creekLevel = this.creekAt(this.creek.nearest(pc.x, pc.z).s).level;
      const deck = creekLevel + 2.7;
      gap = [sCross - 8.5, sCross + 8.5];
      for (let i = 0; i <= len; i += 1) {
        const w = 1 - smoothstep(9, 42, Math.abs(i - sCross));
        raw[i] = lerp(raw[i], deck, w);
      }
    }
    // Moving average then grade limit, so the road climbs like an engineered road.
    const window = path.kind === 'foot' ? 3 : path.kind === 'track' ? 7 : 14;
    const heights = new Float32Array(len + 1);
    for (let i = 0; i <= len; i += 1) {
      let sum = 0;
      let wsum = 0;
      for (let k = -window; k <= window; k += 1) {
        const j = clamp(i + k, 0, len);
        const w = 1 - Math.abs(k) / (window + 1);
        sum += raw[j] * w;
        wsum += w;
      }
      heights[i] = sum / wsum;
    }
    if (gap) {
      // Keep the abutments at deck height after smoothing.
      const mid = (gap[0] + gap[1]) / 2;
      const deck = heights[Math.round(mid)];
      for (let i = 0; i <= len; i += 1) {
        const w = 1 - smoothstep(10, 30, Math.abs(i - mid));
        heights[i] = lerp(heights[i], deck, w);
      }
    }
    const maxGrade = path.kind === 'track' ? 0.2 : 0.15;
    for (let pass = 0; pass < 4; pass += 1) {
      for (let i = 1; i <= len; i += 1) heights[i] = clamp(heights[i], heights[i - 1] - maxGrade, heights[i - 1] + maxGrade);
      for (let i = len - 1; i >= 0; i -= 1) heights[i] = clamp(heights[i], heights[i + 1] - maxGrade, heights[i + 1] + maxGrade);
    }
    return { path, heights, gap };
  }

  roadHeightAt(profile: RoadProfile, s: number): number {
    const len = profile.heights.length - 1;
    const f = clamp(s, 0, len);
    const i = Math.min(len - 1, Math.floor(f));
    return lerp(profile.heights[i], profile.heights[i + 1], f - i);
  }

  private gradeRoad(h: number, d: number, s: number, prof: RoadProfile): number {
    const { path } = prof;
    if (prof.gap && s > prof.gap[0] && s < prof.gap[1]) return h;
    // Fade out at path ends that stop in the open (tracks joining roads).
    const hw = path.halfWidth;
    let target = this.roadHeightAt(prof, s);
    // Slight crown on roads; tracks sag between the ruts.
    const u = d / hw;
    if (path.kind === 'road') target += 0.07 * (1 - Math.min(1, u * u));
    else if (path.kind === 'track') target -= 0.05 * Math.exp(-((Math.abs(d) - 0.8) ** 2) / 0.08);
    const delta = Math.abs(h - target);
    const shoulder = Math.max(2.5, 1.6 * delta + 1.2);
    let w = 1 - smoothstep(hw + 0.4, hw + shoulder, d);
    if (prof.gap) {
      // Ramp the grading back in either side of the bridge gap.
      const edge = Math.min(Math.abs(s - prof.gap[0]), Math.abs(s - prof.gap[1]));
      const inside = s > prof.gap[0] - 1.5 && s < prof.gap[1] + 1.5;
      if (inside) w *= smoothstep(0, 1.5, edge);
    }
    let out = lerp(h, target, w);
    // Drainage ditch where the road is cut into a slope.
    if (h > target + 0.25 && path.kind === 'road') {
      const ditch = Math.exp(-((d - hw - 1.1) ** 2) / 0.5) * Math.min(1, (h - target) * 0.6);
      out -= 0.32 * ditch;
    }
    return out;
  }

  // ---------------------------------------------------------------- surface

  private buildSplat(): Uint8Array {
    const sn = SURFACE_N;
    const out = new Uint8Array(sn * sn * 4);
    const nz = this.noise;
    for (let zi = 0; zi < sn; zi += 1) {
      for (let xi = 0; xi < sn; xi += 1) {
        const k = zi * sn + xi;
        const x = this.origin + (xi + 0.5) * SURFACE_CELL;
        const z = this.origin + (zi + 0.5) * SURFACE_CELL;
        const big = nz.fbm(x / 70 + 40, z / 70 - 12, 3);
        const mid = nz.fbm(x / 18 - 3, z / 18 + 8, 3);
        const fine = this.detail.noise(x / 4.3, z / 4.3);
        const cd = Math.abs(this.creekSigned[k]);
        const cs = this.creekAt(this.creekS[k]);
        const slope = this.slopeAt(x, z);

        // Leaf litter where broadleaf trees grow: near water and in patches.
        let leaves = clamp(0.35 + big * 0.9 + mid * 0.35, 0, 1) * 0.75;
        leaves = Math.max(leaves, (1 - smoothstep(cs.channel + 4, cs.channel + 18, cd)) * 0.85);
        // Moss on damp banks, shaded hollows and in scattered carpets.
        let moss = smoothstep(0.15, 0.55, mid * 0.6 - big * 0.3 + fine * 0.15) * 0.8;
        moss = Math.max(moss, (1 - smoothstep(cs.channel + 0.5, cs.channel + 6, cd)) * 0.9);
        // Mud: wet hollows, creek margins, worn ground near structures.
        let mud = smoothstep(0.45, 0.8, -big * 0.5 + mid * 0.6 + fine * 0.2) * 0.7;
        mud = Math.max(mud, (1 - smoothstep(cs.channel - 0.5, cs.channel + 1.6, cd)));
        let wet = 0;
        // Grass in sunny clearings.
        for (const c of CLEARINGS) {
          const d = Math.hypot(x - c.x, z - c.z);
          const inside = 1 - smoothstep(c.radius * 0.6, c.radius + 4, d + mid * 4);
          moss = Math.max(moss, inside * 0.55);
          leaves *= 1 - inside * 0.6;
        }
        // Road influence: mud in the ruts and on soft shoulders, puddles in low spots.
        const rd = this.roadSigned[k];
        const rid = this.roadId[k];
        if (rid !== 255) {
          const path = this.roads[rid];
          const hw = path.halfWidth;
          const ad = Math.abs(rd);
          const shoulder = 1 - smoothstep(hw - 0.2, hw + 2.2 + mid, ad);
          if (path.kind === 'road') {
            mud = Math.max(mud, shoulder * (0.4 + 0.3 * fine) * smoothstep(hw - 0.8, hw + 0.4, ad));
            const rut = Math.exp(-((ad - 0.85) ** 2) / 0.05);
            const puddle = smoothstep(0.55, 0.75, mid * 0.7 + fine * 0.4) * rut;
            wet = Math.max(wet, puddle);
            leaves *= 1 - shoulder;
            moss *= 1 - shoulder * 0.8;
          } else if (path.kind === 'track') {
            const rut = Math.exp(-((ad - 0.8) ** 2) / 0.06);
            mud = Math.max(mud, rut * 0.95, shoulder * 0.35);
            moss = Math.max(moss * (1 - rut), (1 - smoothstep(0.0, 0.45, ad)) * 0.85);
            wet = Math.max(wet, rut * smoothstep(0.4, 0.7, mid * 0.6 + fine * 0.5));
            leaves *= 1 - shoulder * 0.7;
          } else {
            const trail = 1 - smoothstep(hw * 0.4, hw + 0.4 + fine * 0.3, ad);
            mud = Math.max(mud, trail * 0.75);
            moss *= 1 - trail;
            leaves *= 1 - trail * 0.8;
          }
        }
        for (const pad of GRAVEL_PADS) {
          const inside = 1 - smoothstep(pad.r - 1.5, pad.r + 1.5, Math.hypot(x - pad.x, z - pad.z) + fine * 1.2);
          moss *= 1 - inside * 0.85;
          leaves *= 1 - inside;
          mud = Math.max(mud * (1 - inside), inside * 0.25 * (0.5 + fine));
        }
        if (slope > 0.75) moss *= 0.5;
        out[k * 4] = clamp(mud, 0, 1) * 255;
        out[k * 4 + 1] = clamp(moss, 0, 1) * 255;
        out[k * 4 + 2] = clamp(leaves, 0, 1) * 255;
        out[k * 4 + 3] = clamp(wet, 0, 1) * 255;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- queries

  private sampleGrid(x: number, z: number): number {
    const fx = clamp((x - this.origin) / this.cell, 0, this.n - 1.001);
    const fz = clamp((z - this.origin) / this.cell, 0, this.n - 1.001);
    const xi = Math.floor(fx);
    const zi = Math.floor(fz);
    const tx = fx - xi;
    const tz = fz - zi;
    const n = this.n;
    const h00 = this.heights[zi * n + xi];
    const h10 = this.heights[zi * n + xi + 1];
    const h01 = this.heights[(zi + 1) * n + xi];
    const h11 = this.heights[(zi + 1) * n + xi + 1];
    // Matches the mesh triangulation (diagonal from (x0,z0) to (x1,z1)).
    if (tx >= tz) return h00 + (h10 - h00) * tx + (h11 - h10) * tz;
    return h00 + (h11 - h01) * tx + (h01 - h00) * tz;
  }

  heightAt(x: number, z: number): number {
    return this.sampleGrid(x, z);
  }

  normalAt(x: number, z: number): [number, number, number] {
    const e = this.cell * 0.5;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const nx = -hx;
    const ny = 2 * e;
    const nzv = -hz;
    const len = Math.hypot(nx, ny, nzv);
    return [nx / len, ny / len, nzv / len];
  }

  /** 0 = flat, 1 = vertical. */
  slopeAt(x: number, z: number): number {
    return 1 - this.normalAt(x, z)[1];
  }

  private surfaceIndex(x: number, z: number): number {
    const xi = clamp(Math.floor((x - this.origin) / SURFACE_CELL), 0, SURFACE_N - 1);
    const zi = clamp(Math.floor((z - this.origin) / SURFACE_CELL), 0, SURFACE_N - 1);
    return zi * SURFACE_N + xi;
  }

  /** Nearest road/track at this point (null when none within ~9 m of its edge). */
  roadAt(x: number, z: number): { path: Path; signed: number; s: number } | null {
    const k = this.surfaceIndex(x, z);
    const id = this.roadId[k];
    if (id === 255) return null;
    return { path: this.roads[id], signed: this.roadSigned[k], s: this.roadS[k] };
  }

  /** Water surface height and depth at a point, or null when dry. */
  waterAt(x: number, z: number): { level: number; depth: number } | null {
    const k = this.surfaceIndex(x, z);
    const d = Math.abs(this.creekSigned[k]);
    if (d > 20) return null;
    const c = this.creekAt(this.creekS[k]);
    if (d > c.channel + 0.3) return null;
    const ground = this.heightAt(x, z);
    const depth = c.level - ground;
    return depth > 0.02 ? { level: c.level, depth } : null;
  }

  surfaceAt(x: number, z: number): SurfaceKind {
    if (this.waterAt(x, z)) return 'water';
    for (const pad of GRAVEL_PADS) if (Math.hypot(x - pad.x, z - pad.z) < pad.r) return 'gravel';
    const road = this.roadAt(x, z);
    if (road) {
      const ad = Math.abs(road.signed);
      const hw = road.path.halfWidth;
      if (road.path.kind === 'road' && ad < hw) return 'gravel';
      if (road.path.kind === 'track' && ad < hw) return Math.abs(ad - 0.8) < 0.35 ? 'mud' : 'grass';
      if (road.path.kind === 'foot' && ad < hw) return 'mud';
    }
    if (this.slopeAt(x, z) > 0.33) return 'rock';
    const k = this.surfaceIndex(x, z) * 4;
    const mud = this.splat[k];
    const moss = this.splat[k + 1];
    if (mud > 150) return 'mud';
    if (moss > 150) return 'moss';
    return 'forest';
  }

  /** Main-road height profile (used by structures that sit on the road). */
  roadSurfaceHeight(roadIndex: number, s: number): number {
    return this.roadHeightAt(this.profiles[roadIndex], s);
  }

  bridgeGap(): { s0: number; s1: number; deck: number } | null {
    const prof = this.profiles[0];
    if (!prof.gap) return null;
    const mid = (prof.gap[0] + prof.gap[1]) / 2;
    return { s0: prof.gap[0], s1: prof.gap[1], deck: this.roadHeightAt(prof, mid) };
  }
}

/** Polynomial smooth minimum. */
function smin(a: number, b: number, k: number): number {
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return lerp(b, a, h) - k * h * (1 - h);
}
