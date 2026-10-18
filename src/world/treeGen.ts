// Procedural plant geometry: conifers (fir, spruce, pine), broadleaf trees,
// dead snags, saplings, bushes, ferns and grass. Every model is generated with a
// seed so each variant has its own silhouette.
//
// Trees come in levels of detail built from the same seed, so they share one
// silhouette and swap without popping:
//  - 'hero': close to the viewer. Conifer branches are woody limbs carrying several
//    layered needle sprays, trunks have buttress roots and dead lower branches,
//    broadleaf crowns branch three levels deep.
//  - 'mid' / 'low': one card per branch, fewer radial segments.
// The main random stream is identical between levels; hero-only detail draws from
// a second stream so it never shifts the shared structure.

import * as THREE from 'three';
import { GeoBuilder, card, tube } from '../render/geoBuilder.ts';
import type { AtlasRegion, FoliageAtlas } from '../render/foliageAtlas.ts';
import { mulberry32, range, type Rng } from './rng.ts';

export type TreeKind = 'fir' | 'spruce' | 'pine' | 'broadleaf' | 'snag' | 'sapling';
export type TreeLod = 'hero' | 'mid' | 'low';

export interface PlantModel {
  kind: TreeKind | 'bush' | 'fern' | 'grass';
  bark: GeoBuilder | null;
  foliage: GeoBuilder | null;
  height: number;
  crownRadius: number;
  /** Trunk radius at 1 m (for collision). */
  trunkRadius: number;
  /** Autumn-coloured broadleaf (used for per-instance colour variation). */
  autumn?: boolean;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Trunk centreline. Rings are dense near the base so the root flare reads as a
 * smooth curve, then roughly every 1.6 m up the stem.
 */
function trunkPath(rng: Rng, height: number, lean: number, spacing = 1.6): THREE.Vector3[] {
  const ys = [0, 0.18, 0.42, 0.75, 1.2];
  for (let y = 1.2 + spacing; y < height - 0.3; y += spacing) ys.push(y);
  ys.push(height);
  const la = rng() * Math.PI * 2;
  const wob = range(rng, 0, Math.PI * 2);
  // A gentle S-bend so tall stems are not ruler-straight.
  const sAmp = range(rng, 0.04, 0.16);
  return ys.map((y) => {
    const t = y / height;
    const bend = lean * t * t;
    const s = Math.sin(t * Math.PI * 1.6 + wob) * sAmp * t;
    return new THREE.Vector3(
      Math.cos(la) * bend + Math.sin(t * 7 + wob) * 0.04 * t + Math.cos(la + 1.4) * s,
      y,
      Math.sin(la) * bend + Math.cos(t * 5 + wob) * 0.04 * t + Math.sin(la + 1.4) * s,
    );
  });
}

function axisAt(pts: THREE.Vector3[], y: number): THREE.Vector3 {
  for (let i = 0; i < pts.length - 1; i += 1) {
    if (y <= pts[i + 1].y || i === pts.length - 2) {
      const span = Math.max(1e-4, pts[i + 1].y - pts[i].y);
      const f = THREE.MathUtils.clamp((y - pts[i].y) / span, 0, 1);
      return pts[i].clone().lerp(pts[i + 1], f);
    }
  }
  return pts[pts.length - 1].clone();
}

/** Crown-volume normals: outward from the trunk axis and slightly up, blended with the card. */
function crownNormal(pts: THREE.Vector3[], upBias: number, cardWeight: number) {
  const out = new THREE.Vector3();
  return (p: THREE.Vector3, cn: THREE.Vector3) => {
    const a = axisAt(pts, p.y);
    out.set(p.x - a.x, 0, p.z - a.z);
    const l = out.length() || 1;
    out.multiplyScalar(1 / l);
    out.y = upBias;
    out.normalize().multiplyScalar(1 - cardWeight).addScaledVector(cn, cardWeight).normalize();
    return out;
  };
}

interface TrunkOpts {
  flare: number;
  topRadius: number;
  tint?: THREE.Color;
}

function trunkRadii(pts: THREE.Vector3[], r0: number, top: number): number[] {
  const H = pts[pts.length - 1].y;
  // Stems taper quickly over the first metres above the flare, then slowly.
  return pts.map((p) => {
    const t = p.y / H;
    return top + (r0 - top) * Math.pow(1 - t, 0.85);
  });
}

/** World-space azimuths (radians, atan2(z, x)) of the trunk's buttress lobes. */
type Lobes = number[];

function barkTrunk(b: GeoBuilder, rng: Rng, pts: THREE.Vector3[], r0: number, radial: number, opts: TrunkOpts): Lobes {
  const radii = trunkRadii(pts, r0, opts.topRadius);
  const lobes = 3 + Math.floor(rng() * 3);
  const phase = rng() * 6.28;
  const ph2 = rng() * 6.28;
  const height = pts[pts.length - 1].y;
  // Lobe k peaks where ang * lobes + phase = pi/2 + 2 pi k. The tube's ring angle
  // `ang` maps to the world direction (sin ang, 0, cos ang) on a vertical stem.
  const lobeAz: Lobes = [];
  for (let k = 0; k < lobes; k += 1) {
    const ang = (Math.PI / 2 + k * Math.PI * 2 - phase) / lobes;
    lobeAz.push(Math.atan2(Math.cos(ang), Math.sin(ang)));
  }
  tube(b, pts, radii, {
    radial,
    // The bark photographs cover ~0.6 m of real bark; keep plates their true size
    // (the old mapping stretched them twice as tall as wide).
    uMetres: 0.62,
    vMetres: 0.78,
    ao: (t) => 0.58 + 0.42 * Math.min(1, (t * height) / 2.8),
    wind: (t) => t * t * 0.15,
    radiusFn: (t, ang, r) => {
      const y = t * height;
      // Sharp buttress lobes at the very base, fading into a round stem by ~1.5 m.
      const lobe = Math.pow(0.5 + 0.5 * Math.sin(ang * lobes + phase), 2.2);
      const flare = 1 + opts.flare * Math.exp(-y / 0.5) * (0.4 + 0.9 * lobe);
      // Shallow vertical furrows and the odd bulge break up the perfect cylinder.
      const furrow = 1 + 0.035 * Math.sin(ang * 11 + ph2 + y * 0.35) + 0.025 * Math.sin(ang * 5 - y * 0.8 + phase);
      return r * flare * furrow;
    },
    capEnd: true,
    tint: opts.tint,
  });
  return lobeAz;
}

/**
 * Surface roots that continue the flare's buttress lobes outward and dive under the
 * soil after a short run, curving a little on the way; only their shoulders show.
 */
function roots(b: GeoBuilder, rng: Rng, base: THREE.Vector3, r0: number, lobes: Lobes, tint: THREE.Color | undefined, radial: number): void {
  for (const lobeAz of lobes) {
    const az = lobeAz + range(rng, -0.12, 0.12);
    const len = r0 * range(rng, 1.3, 2.8) + range(rng, 0.1, 0.4);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const bendDir = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(range(rng, -0.35, 0.35));
    const at = (f: number, y: number) => base.clone().addScaledVector(dir, r0 * 0.75 + len * f).addScaledVector(bendDir, len * f * f).setY(base.y + y);
    const rr = r0 * range(rng, 0.24, 0.32);
    // Starts inside the lobe, low on the flare, so the joint is hidden.
    tube(b, [at(0, rr * 1.5 + 0.08), at(0.3, rr * 0.85 + 0.04), at(0.65, rr * 0.15), at(1, -0.3)], [rr, rr * 0.72, rr * 0.45, 0.012], {
      radial, uMetres: 0.45, vMetres: 0.6, ao: (t) => 0.55 + 0.12 * t, wind: () => 0, tint,
    });
  }
}

/**
 * Dead lower branches of a conifer: thin grey wood stubs (often with a wisp of dead
 * twigs) from the shaded lower trunk up to the living crown.
 */
function deadBranches(bark: GeoBuilder, foliage: GeoBuilder, rng: Rng, pts: THREE.Vector3[], from: number, to: number, reach: number, deadRegion: AtlasRegion, radial: number, keep = 0.7): void {
  const grey = new THREE.Color(0.58, 0.57, 0.56);
  for (let y = from; y < to; y += range(rng, 0.35, 0.75)) {
    const n = rng() < 0.55 ? 1 : 2;
    for (let k = 0; k < n; k += 1) {
      if (rng() > keep) continue;
      const az = rng() * Math.PI * 2;
      // Higher stubs are longer (they died more recently).
      const f = (y - from) / Math.max(0.5, to - from);
      const len = (range(rng, 0.2, 0.45) + f * range(rng, 0.3, 1.0)) * reach;
      const pitch = range(rng, -0.7, -0.1);
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)).normalize();
      const o = axisAt(pts, y);
      const r = 0.012 + 0.018 * f;
      const mid = o.clone().addScaledVector(dir, len * 0.5).add(new THREE.Vector3(0, -len * 0.05, 0));
      const tip = o.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, -len * 0.14, 0));
      tube(bark, [o, mid, tip], [r, r * 0.6, 0.004], {
        radial, uMetres: 0.3, vMetres: 0.5, ao: () => 0.7, wind: () => 0.05, tint: grey,
      });
      if (rng() < 0.55) {
        const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
        card(foliage, o.clone().addScaledVector(dir, len * 0.35), dir, side, {
          length: len * 0.8, width: len * 0.75, segments: 1, droop: 0.1, curl: 0, region: deadRegion,
          aoBase: 0.5, aoTip: 0.8, windBase: 0, windTip: 0.1,
          tint: new THREE.Color(0.62, 0.58, 0.52),
        });
      }
    }
  }
}

export interface ConiferParams {
  height: number;
  r0: number;
  crownBase: number;
  crownRadius: number;
  spacing: number;
  perWhorl: number;
  droop: number;
  region: AtlasRegion;
  deadRegion: AtlasRegion;
  cardSegments: number;
  /** Probability of an extra crossed card per branch (mid/low only). */
  cross: number;
  kind: TreeKind;
  /** Crown shape exponent: < 1 bulges (broad, old), > 1 is a narrow spire. */
  shape?: number;
  /** Lean of the stem in metres at the top. */
  lean?: [number, number];
}

export function conifer(seed: number, p: ConiferParams, lod: TreeLod): PlantModel {
  const rng = mulberry32(seed);
  const rd = mulberry32(seed ^ 0x5bd1e995);
  const hero = lod === 'hero';
  const bark = new GeoBuilder();
  const foliage = new GeoBuilder();
  const lean = p.lean ?? [0.05, 0.35];
  const pts = trunkPath(rng, p.height, range(rng, lean[0], lean[1]));
  const radial = hero ? 12 : lod === 'mid' ? 8 : 6;
  const big = p.kind !== 'sapling';
  const lobes = barkTrunk(bark, rng, pts, p.r0, radial, { flare: big ? 0.6 : 0.2, topRadius: 0.015, tint: new THREE.Color(0.74, 0.7, 0.66) });
  if (big && lod !== 'low') roots(bark, rd, pts[0], p.r0, lobes, new THREE.Color(0.7, 0.66, 0.62), hero ? 6 : 4);
  const nrm = crownNormal(pts, 0.55, 0.25);
  const H = p.height;
  const cb = p.crownBase * H;
  if (big) deadBranches(bark, foliage, rng, pts, 1.3, cb, Math.min(0.85, p.crownRadius / 3.5), p.deadRegion, hero ? 4 : 3);
  const shape = p.shape ?? 0.92;
  // Living whorls from crown base to the leader.
  let whorl = rng() * Math.PI;
  for (let y = cb; y < H - 0.25; y += p.spacing * range(rng, 0.8, 1.25)) {
    const c = (y - cb) / Math.max(0.1, H - cb);
    const count = c > 0.85 ? Math.max(3, p.perWhorl - 2) : p.perWhorl;
    whorl += 2.399;
    const o0 = axisAt(pts, y);
    for (let k = 0; k < count; k += 1) {
      if (rng() < 0.1) continue; // missing branch
      const az = whorl + (k / count) * Math.PI * 2 + range(rng, -0.3, 0.3);
      const len = Math.max(0.35, p.crownRadius * Math.pow(1 - c, shape) * range(rng, 0.78, 1.12) + 0.3 * (1 - c));
      const pitch = -(0.08 + p.droop * (1 - c)) + range(rng, -0.12, 0.12);
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)).normalize();
      const side = new THREE.Vector3().crossVectors(dir, UP).normalize();
      side.applyAxisAngle(dir, range(rng, -0.4, 0.4));
      const inner = 0.6 + 0.16 * c;
      const widthJ = range(rng, 0.88, 1.08);
      const crossRoll = rng();
      const opts = {
        length: len,
        width: len * widthJ,
        segments: p.cardSegments,
        droop: 0.12 + 0.18 * (1 - c),
        curl: p.kind === 'spruce' ? 0.05 : 0.03,
        region: p.region,
        aoBase: inner * (0.78 + 0.22 * c),
        aoTip: 0.95 + 0.08 * c,
        windBase: 0.05 + 0.4 * c,
        windTip: 0.35 + 0.6 * c,
        normalFn: nrm,
      };
      if (hero && len > 0.7) {
        heroBranch(bark, foliage, rd, o0, dir, side, len, c, p, nrm);
      } else {
        card(foliage, o0, dir, side, opts);
        if (crossRoll < p.cross) {
          const side2 = side.clone().applyAxisAngle(dir, Math.PI / 2 + range(rd, -0.3, 0.3));
          card(foliage, o0, dir, side2, { ...opts, width: opts.width * 0.8, length: len * 0.92 });
        }
      }
    }
  }
  // Leader at the very top.
  const top = axisAt(pts, H - 0.9);
  for (const s of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    card(foliage, top, UP.clone(), s, {
      length: 1.1, width: 0.55, segments: 1, droop: 0, curl: 0, region: p.region,
      aoBase: 0.9, aoTip: 1, windBase: 0.6, windTip: 1, normalFn: nrm,
    });
  }
  return { kind: p.kind, bark, foliage, height: H, crownRadius: p.crownRadius, trunkRadius: p.r0 * 0.82 };
}

/**
 * A close-up conifer branch: a drooping woody limb that carries several smaller
 * needle sprays fanned out to alternate sides, so the branch has depth instead
 * of reading as one flat card.
 */
function heroBranch(
  bark: GeoBuilder, foliage: GeoBuilder, rng: Rng, o: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3,
  len: number, c: number, p: ConiferParams, nrm: (p: THREE.Vector3, cn: THREE.Vector3) => THREE.Vector3,
): void {
  const sag = (0.1 + 0.16 * (1 - c)) * len;
  const limbAt = (t: number) => o.clone().addScaledVector(dir, len * t).add(new THREE.Vector3(0, -sag * t * t + (p.kind === 'spruce' ? 0.25 * len * Math.max(0, t - 0.7) ** 2 : 0), 0));
  const limbPts = [0, 0.3, 0.6, 0.9].map(limbAt);
  const r = 0.012 + 0.02 * Math.min(1, len / 3);
  tube(bark, limbPts, [r, r * 0.7, r * 0.45, 0.004], {
    radial: 4, uMetres: 0.3, vMetres: 0.6, ao: (t) => 0.55 + 0.25 * t, wind: (t) => (0.05 + 0.4 * c) * t, tint: new THREE.Color(0.7, 0.66, 0.62),
  });
  const sprays = len > 2 ? 4 : 3;
  for (let i = 0; i < sprays; i += 1) {
    const t = 0.22 + (i / sprays) * 0.7;
    const at = limbAt(t);
    const alt = i % 2 === 0 ? 1 : -1;
    const yaw = alt * range(rng, 0.25, 0.6) * (1 - t * 0.5);
    const sdir = dir.clone().applyAxisAngle(UP, yaw);
    sdir.y += range(rng, -0.12, 0.06) - sag / len * 0.5;
    sdir.normalize();
    const sside = new THREE.Vector3().crossVectors(sdir, UP).normalize().applyAxisAngle(sdir, range(rng, -0.35, 0.35));
    const sl = len * (0.62 - 0.22 * t) * range(rng, 0.85, 1.1);
    card(foliage, at, sdir, sside, {
      length: sl, width: sl * range(rng, 0.75, 0.95), segments: 2, droop: 0.15 + 0.12 * (1 - c), curl: 0.03,
      region: p.region, aoBase: 0.62 + 0.18 * t + 0.1 * c, aoTip: 0.92 + 0.08 * c,
      windBase: (0.05 + 0.4 * c) * t + 0.05, windTip: 0.35 + 0.6 * c, normalFn: nrm,
    });
  }
  // The leading spray continues the branch.
  const tip = limbAt(0.6);
  const tdir = limbAt(1).sub(tip).normalize();
  card(foliage, tip, tdir, side, {
    length: len * 0.5, width: len * 0.42, segments: 2, droop: 0.1, curl: 0.03, region: p.region,
    aoBase: 0.86, aoTip: 1.0, windBase: 0.3 + 0.3 * c, windTip: 0.4 + 0.6 * c, normalFn: nrm,
  });
}

export function pine(seed: number, atlas: FoliageAtlas, height: number, lod: TreeLod, old = false): PlantModel {
  const rng = mulberry32(seed);
  const rd = mulberry32(seed ^ 0x27d4eb2f);
  const hero = lod === 'hero';
  const bark = new GeoBuilder();
  const foliage = new GeoBuilder();
  const pts = trunkPath(rng, height, range(rng, 0.1, 0.5));
  const r0 = height * 0.0155 + 0.09;
  const radial = hero ? 12 : lod === 'mid' ? 8 : 6;
  const tint = new THREE.Color(0.86, 0.76, 0.7);
  // Limb wood is greyer and finer-barked than the plated stem.
  const limbTint = new THREE.Color(0.62, 0.57, 0.53);
  const lobes = barkTrunk(bark, rng, pts, r0, radial, { flare: 0.45, topRadius: 0.03, tint });
  if (lod !== 'low') roots(bark, rd, pts[0], r0, lobes, tint, hero ? 6 : 4);
  const nrm = crownNormal(pts, 0.6, 0.2);
  const cb = height * (old ? range(rng, 0.52, 0.6) : range(rng, 0.34, 0.45));
  // Pines prune themselves well: only a few short grey stubs below the crown.
  deadBranches(bark, foliage, rng, pts, 3, cb - 0.8, 0.4, atlas.regions.dead, hero ? 4 : 3, 0.35);
  const crownR = height * (old ? 0.21 : 0.17);
  // Sparse, irregular whorls (2-4 limbs, frequent gaps) rather than a limb every
  // half metre: an open pine crown with daylight through it.
  let y = cb;
  while (y < height - 0.8) {
    const c = (y - cb) / (height - cb);
    const count = 2 + Math.floor(rng() * 3);
    const whorlAz = rng() * Math.PI * 2;
    for (let k = 0; k < count; k += 1) {
      const az = whorlAz + (k / count) * Math.PI * 2 + range(rng, -0.5, 0.5);
      const skip = rng() < 0.2;
      // Young pines are conical; old ones are flat-topped, longest limbs high up.
      const profile = old ? 0.4 + 0.6 * Math.sin(Math.min(1, c * 1.1 + 0.12) * Math.PI * 0.82) : 0.3 + 0.7 * Math.pow(1 - c, 0.75);
      const len = crownR * profile * range(rng, 0.6, 1.25);
      const pitch = old ? range(rng, -0.12, 0.3) : range(rng, -0.02, 0.4);
      if (skip || len < 0.4) continue;
      const dir = new THREE.Vector3(Math.cos(az) * Math.cos(pitch), Math.sin(pitch), Math.sin(az) * Math.cos(pitch)).normalize();
      const o = axisAt(pts, y);
      // The limb sags a little, then turns up toward the light at the tip.
      const limbEnd = o.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, len * 0.16, 0));
      const limbMid = o.clone().lerp(limbEnd, 0.5).add(new THREE.Vector3(0, -len * 0.08, 0));
      tube(bark, [o, limbMid, limbEnd], [r0 * 0.3, r0 * 0.17, r0 * 0.06], {
        radial: hero ? 5 : 4, uMetres: 0.5, vMetres: 0.7, ao: () => 0.7, wind: (t) => 0.3 * t, tint: limbTint,
      });
      // Needle clumps at the limb end; long limbs fork, each fork ending in a clump.
      const ends: { p: THREE.Vector3; d: THREE.Vector3; small?: boolean }[] = [{ p: limbEnd, d: limbEnd.clone().sub(limbMid).normalize() }];
      // Twigs of needles along the outer half of the limb, not only at its end.
      if (lod !== 'low' && len > 1.1) {
        for (const t of [0.55, 0.78]) ends.push({ p: o.clone().lerp(limbEnd, t).add(new THREE.Vector3(0, -len * 0.05, 0)), d: dir, small: true });
      }
      if (len > 1.6) {
        const forks = hero ? 2 : 1;
        for (let f = 0; f < forks; f += 1) {
          const from = o.clone().lerp(limbEnd, range(rng, 0.5, 0.75));
          const fd = dir.clone().applyAxisAngle(UP, (f ? 1 : -1) * range(rng, 0.45, 0.9)).add(new THREE.Vector3(0, range(rng, 0.2, 0.5), 0)).normalize();
          const fe = from.clone().addScaledVector(fd, len * range(rng, 0.25, 0.4));
          tube(bark, [from, fe], [r0 * 0.1, r0 * 0.04], { radial: 4, uMetres: 0.4, vMetres: 0.6, ao: () => 0.75, wind: () => 0.35, tint: limbTint });
          ends.push({ p: fe, d: fd });
        }
      }
      for (const end of ends) {
        const clump = end.small ? 1 : hero ? 3 : 2;
        for (let j = 0; j < clump; j += 1) {
          const tdir = end.d.clone().add(new THREE.Vector3(range(rd, -0.45, 0.45), range(rd, 0.35, 0.9), range(rd, -0.45, 0.45))).normalize();
          const side = new THREE.Vector3().crossVectors(tdir, UP).normalize().applyAxisAngle(tdir, range(rd, -0.8, 0.8));
          const size = range(rd, 1.5, 2.3) * (end.p === limbEnd ? 1 : end.small ? 0.7 : 0.85) * (hero ? 0.9 : 1.05);
          const opts = {
            length: size, width: size * 0.95, segments: 1, droop: 0.02, curl: 0, region: atlas.regions.pine,
            aoBase: 0.68 + 0.24 * c, aoTip: 1, windBase: 0.4, windTip: 0.8, normalFn: nrm,
            widthFn: () => 1,
          };
          const at = end.p.clone().addScaledVector(tdir, -size * 0.45);
          card(foliage, at, tdir, side, opts);
          if (lod !== 'low') card(foliage, at, tdir, side.clone().applyAxisAngle(tdir, Math.PI / 2), opts);
        }
      }
    }
    y += range(rng, 0.75, 1.4) * (old ? 1.15 : 1);
  }
  // Leader tuft.
  const top = axisAt(pts, height - 0.6);
  for (const sd of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    card(foliage, top, UP.clone(), sd, {
      length: 1.5, width: 1.3, segments: 1, droop: 0, curl: 0, region: atlas.regions.pine,
      aoBase: 0.9, aoTip: 1, windBase: 0.6, windTip: 1, normalFn: nrm, widthFn: () => 1,
    });
  }
  return { kind: 'pine', bark, foliage, height, crownRadius: crownR, trunkRadius: r0 * 0.85 };
}

export function broadleaf(seed: number, height: number, region: AtlasRegion, lod: TreeLod, autumn = false): PlantModel {
  const rng = mulberry32(seed);
  const rd = mulberry32(seed ^ 0x165667b1);
  const hero = lod === 'hero';
  const bark = new GeoBuilder();
  const foliage = new GeoBuilder();
  const split = height * range(rng, 0.36, 0.48);
  const pts = trunkPath(rng, split + 1, range(rng, 0.1, 0.6), 1.2);
  const r0 = height * 0.015 + 0.07;
  const tint = new THREE.Color(0.95, 0.95, 0.92);
  const lobes = barkTrunk(bark, rng, pts, r0, hero ? 12 : lod === 'mid' ? 8 : 6, { flare: 0.45, topRadius: r0 * 0.55, tint });
  if (lod !== 'low') roots(bark, rd, pts[0], r0, lobes, tint, hero ? 6 : 4);
  const crownC = new THREE.Vector3(pts[pts.length - 1].x, height * 0.64, pts[pts.length - 1].z);
  const rx = height * range(rng, 0.2, 0.27);
  const ry = height * 0.3;
  const limbs = 4 + Math.floor(rng() * 3);
  const anchors: THREE.Vector3[] = [];
  const twigR = hero ? 6 : 4;
  for (let i = 0; i < limbs; i += 1) {
    const az = (i / limbs) * Math.PI * 2 + range(rng, -0.4, 0.4);
    // Limbs leave the trunk at different heights and reach different parts of the crown.
    const startT = range(rng, 0.55, 1);
    const start = pts[Math.max(1, Math.floor(startT * (pts.length - 1)))].clone();
    const end = crownC.clone().add(new THREE.Vector3(Math.cos(az) * rx * range(rng, 0.55, 0.85), range(rng, -0.25, 0.55) * ry, Math.sin(az) * rx * range(rng, 0.55, 0.85)));
    // Limbs arc outward then up, like a real crown, rather than running straight.
    const mid = start.clone().lerp(end, 0.45).add(new THREE.Vector3(0, ry * 0.05, 0)).add(end.clone().sub(crownC).setY(0).multiplyScalar(0.18));
    tube(bark, [start, mid, end], [r0 * 0.58, r0 * 0.36, r0 * 0.1], {
      radial: twigR, uMetres: 0.45, vMetres: 0.6, ao: (t) => 0.7 + 0.2 * t, wind: (t) => 0.2 * t, tint,
    });
    anchors.push(end);
    // Secondary branches fork off each limb toward the outside of the crown,
    // and (close up) tertiary twigs fork again from those.
    const secondaries = hero ? 3 : 2;
    for (let k = 0; k < secondaries; k += 1) {
      const rr = k < 2 ? rng : rd;
      const from = mid.clone().lerp(end, range(rr, 0.15, 0.75));
      const out = from.clone().sub(crownC).setY(0).normalize();
      const tipPos = from.clone().add(out.multiplyScalar(rx * range(rr, 0.3, 0.55))).add(new THREE.Vector3(range(rr, -0.6, 0.6), range(rr, 0.1, 0.9), range(rr, -0.6, 0.6)));
      const bend = from.clone().lerp(tipPos, 0.5).add(new THREE.Vector3(0, -0.15, 0));
      tube(bark, [from, bend, tipPos], [r0 * 0.14, r0 * 0.08, r0 * 0.03], {
        radial: 4, uMetres: 0.4, vMetres: 0.6, ao: () => 0.8, wind: () => 0.4, tint,
      });
      anchors.push(tipPos);
      if (hero) {
        for (let q = 0; q < 2; q += 1) {
          const f2 = from.clone().lerp(tipPos, range(rd, 0.4, 0.85));
          const d2 = tipPos.clone().sub(from).normalize().add(new THREE.Vector3(range(rd, -0.7, 0.7), range(rd, 0, 0.6), range(rd, -0.7, 0.7))).normalize();
          const t2 = f2.clone().addScaledVector(d2, rx * range(rd, 0.15, 0.3));
          tube(bark, [f2, t2], [r0 * 0.04, 0.006], { radial: 3, uMetres: 0.3, vMetres: 0.5, ao: () => 0.85, wind: () => 0.5, tint });
          anchors.push(t2);
        }
      }
    }
  }
  const nrm = (p: THREE.Vector3, cn: THREE.Vector3) => {
    const out = p.clone().sub(crownC);
    out.y *= 0.7;
    out.normalize().add(new THREE.Vector3(0, 0.35, 0)).normalize();
    return out.multiplyScalar(0.8).addScaledVector(cn, 0.2).normalize();
  };
  const clusters = hero ? 120 : lod === 'mid' ? 72 : 46;
  for (let i = 0; i < clusters; i += 1) {
    // Most leaf clusters gather around branch tips; the rest fill an ellipsoid shell
    // (denser on top) so the crown reads as one mass with an irregular, gappy edge.
    let p: THREE.Vector3;
    let shell: number;
    const rr = i < 46 ? rng : rd;
    if (i % 3 !== 2 && anchors.length) {
      const anchor = anchors[Math.floor(rr() * anchors.length)];
      p = anchor.clone().add(new THREE.Vector3(range(rr, -1.1, 1.1), range(rr, -0.5, 0.9), range(rr, -1.1, 1.1)).multiplyScalar(height / 15));
      shell = Math.min(1, p.clone().sub(crownC).length() / Math.max(rx, ry));
    } else {
      const u = rr() * Math.PI * 2;
      const v = Math.acos(range(rr, -0.55, 1));
      shell = range(rr, 0.6, 1.0);
      p = new THREE.Vector3(Math.sin(v) * Math.cos(u) * rx * shell, Math.cos(v) * ry * shell, Math.sin(v) * Math.sin(u) * rx * shell).add(crownC);
    }
    const outward = p.clone().sub(crownC).normalize();
    const dir = outward.clone().add(new THREE.Vector3(range(rr, -0.5, 0.5), 0.35, range(rr, -0.5, 0.5))).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize().applyAxisAngle(dir, range(rr, -1.2, 1.2));
    if (side.lengthSq() < 0.1) side.set(1, 0, 0);
    const size = range(rr, 1.4, 2.3) * (height / 15) * (hero ? 0.88 : 1);
    const depthAo = 0.62 + 0.38 * shell * (0.6 + 0.4 * Math.max(0, outward.y));
    card(foliage, p.clone().addScaledVector(dir, -size * 0.5), dir, side, {
      length: size, width: size * 0.95, segments: 1, droop: 0.05, curl: 0, region,
      aoBase: depthAo * 0.85, aoTip: depthAo, windBase: 0.4, windTip: 0.9, normalFn: nrm, widthFn: () => 1,
    });
  }
  return { kind: 'broadleaf', bark, foliage, height, crownRadius: rx, trunkRadius: r0 * 0.85, autumn };
}

export function snag(seed: number, height: number, lod: TreeLod, style: 'stubs' | 'broken' | 'leaning' = 'stubs'): PlantModel {
  const rng = mulberry32(seed);
  const rd = mulberry32(seed ^ 0x3c6ef372);
  const bark = new GeoBuilder();
  const lean = style === 'leaning' ? range(rng, 1.2, 2.0) : range(rng, 0.1, 0.4);
  const pts = trunkPath(rng, height, lean);
  const r0 = height * 0.022 + 0.1;
  const grey = new THREE.Color(0.72, 0.7, 0.68);
  const top = style === 'broken' ? r0 * 0.62 : r0 * 0.4;
  const lobes = barkTrunk(bark, rng, pts, r0, lod === 'hero' ? 10 : 7, { flare: 0.5, topRadius: top, tint: grey });
  if (lod !== 'low') roots(bark, rd, pts[0], r0, lobes, grey, 4);
  if (style === 'broken') {
    // Jagged splinters where the top snapped off.
    const t = pts[pts.length - 1];
    for (let k = 0; k < 5; k += 1) {
      const az = (k / 5) * Math.PI * 2 + range(rng, -0.3, 0.3);
      const o = t.clone().add(new THREE.Vector3(Math.cos(az) * top * 0.7, -0.05, Math.sin(az) * top * 0.7));
      tube(bark, [o, o.clone().add(new THREE.Vector3(Math.cos(az) * 0.05, range(rng, 0.25, 0.8), Math.sin(az) * 0.05))], [top * 0.35, 0.01], {
        radial: 3, uMetres: 0.3, vMetres: 0.6, ao: () => 0.8, tint: grey,
      });
    }
  }
  const stubs = style === 'leaning' ? 5 : 8;
  for (let i = 0; i < stubs; i += 1) {
    const y = range(rng, 2.2, height * 0.92);
    const az = rng() * Math.PI * 2;
    const len = range(rng, 0.3, 1.1);
    const o = axisAt(pts, y);
    const end = o.clone().add(new THREE.Vector3(Math.cos(az) * len, -range(rng, 0.15, 0.6) * len, Math.sin(az) * len));
    tube(bark, [o, end], [r0 * 0.22, 0.012], { radial: 4, uMetres: 0.4, vMetres: 0.8, ao: () => 0.75, tint: grey });
  }
  return { kind: 'snag', bark, foliage: null, height, crownRadius: 1.2, trunkRadius: r0 * 0.85 };
}

export function bush(seed: number, region: AtlasRegion, size: number): PlantModel {
  const rng = mulberry32(seed);
  const foliage = new GeoBuilder();
  const n = 15;
  const c = new THREE.Vector3(0, size * 0.35, 0);
  const nrm = (p: THREE.Vector3, cn: THREE.Vector3) => p.clone().sub(new THREE.Vector3(0, -size * 0.2, 0)).normalize().multiplyScalar(0.8).addScaledVector(cn, 0.2).normalize();
  for (let i = 0; i < n; i += 1) {
    const az = (i / n) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const up = range(rng, 0.25, 1.2);
    const dir = new THREE.Vector3(Math.cos(az), up, Math.sin(az)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize().applyAxisAngle(dir, range(rng, -0.8, 0.8));
    const len = size * range(rng, 0.75, 1.1);
    card(foliage, c.clone().addScaledVector(dir, -len * 0.35).setY(0.02), dir, side, {
      length: len, width: len * 0.9, segments: 2, droop: 0.12, curl: 0, region,
      aoBase: 0.55, aoTip: 0.95, windBase: 0, windTip: 0.7, normalFn: nrm, widthFn: (t) => 0.55 + 0.45 * Math.sin(t * Math.PI * 0.9),
    });
  }
  return { kind: 'bush', bark: null, foliage, height: size, crownRadius: size * 0.7, trunkRadius: 0 };
}

export function fern(seed: number, atlas: FoliageAtlas, size: number): PlantModel {
  const rng = mulberry32(seed);
  const foliage = new GeoBuilder();
  const fronds = 7 + Math.floor(rng() * 4);
  const nrm = (p: THREE.Vector3, cn: THREE.Vector3) => new THREE.Vector3(p.x, size * 0.9, p.z).normalize().multiplyScalar(0.6).addScaledVector(cn, 0.4).normalize();
  for (let i = 0; i < fronds; i += 1) {
    const az = (i / fronds) * Math.PI * 2 + range(rng, -0.25, 0.25);
    const lift = range(rng, 0.55, 1.1);
    const dir = new THREE.Vector3(Math.cos(az), lift, Math.sin(az)).normalize();
    const side = new THREE.Vector3().crossVectors(dir, UP).normalize().applyAxisAngle(dir, range(rng, -0.35, 0.35));
    const len = size * range(rng, 0.8, 1.15);
    card(foliage, new THREE.Vector3(0, 0.02, 0), dir, side, {
      length: len, width: len * 0.3, segments: 4, droop: range(rng, 0.45, 0.7), curl: 0,
      region: atlas.ferns[Math.floor(rng() * atlas.ferns.length)],
      aoBase: 0.5, aoTip: 1, windBase: 0, windTip: 0.8, normalFn: nrm, widthFn: (t) => 0.7 + 0.3 * Math.sin(t * Math.PI),
    });
  }
  return { kind: 'fern', bark: null, foliage, height: size * 0.7, crownRadius: size, trunkRadius: 0 };
}

export function grassClump(seed: number, atlas: FoliageAtlas, height: number): PlantModel {
  const rng = mulberry32(seed);
  const foliage = new GeoBuilder();
  const region = atlas.grass[Math.floor(rng() * atlas.grass.length)];
  const nrm = (_p: THREE.Vector3, cn: THREE.Vector3) => new THREE.Vector3(0, 1, 0).multiplyScalar(0.7).addScaledVector(cn, 0.3).normalize();
  for (let i = 0; i < 3; i += 1) {
    const az = (i / 3) * Math.PI + range(rng, -0.2, 0.2);
    const side = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const dir = new THREE.Vector3(range(rng, -0.08, 0.08), 1, range(rng, -0.08, 0.08)).normalize();
    card(foliage, new THREE.Vector3(0, -0.03, 0), dir, side, {
      length: height, width: height * 2, segments: 2, droop: 0, curl: 0, region,
      aoBase: 0.8, aoTip: 1.05, windBase: 0, windTip: 1, normalFn: nrm, widthFn: () => 1,
    });
  }
  return { kind: 'grass', bark: null, foliage, height, crownRadius: height, trunkRadius: 0 };
}

/** Number of tree variants (also the number of impostor slots needed). */
export const TREE_VARIANTS = 21;

/**
 * The tree variants used across the forest, at one level of detail. Every level
 * returns the same variants in the same order with the same silhouettes.
 */
export function buildTreeVariants(atlas: FoliageAtlas, lod: TreeLod): PlantModel[] {
  const r = atlas.regions;
  const segs = lod === 'low' ? 2 : 3;
  const cross = lod === 'low' ? 0.35 : 0.6;
  const v: PlantModel[] = [];
  const fir = (seed: number, h: number, cb: number, cr: number, shape = 0.92) =>
    conifer(seed, { height: h, r0: h * 0.013 + 0.09, crownBase: cb, crownRadius: cr, spacing: 0.44, perWhorl: 6, droop: 0.42, region: r.fir, deadRegion: r.dead, cardSegments: segs, cross, kind: 'fir', shape }, lod);
  const spruce = (seed: number, h: number, cb: number, cr: number, shape = 0.92) =>
    conifer(seed, { height: h, r0: h * 0.014 + 0.08, crownBase: cb, crownRadius: cr, spacing: 0.38, perWhorl: 6, droop: 0.62, region: r.spruce, deadRegion: r.dead, cardSegments: segs, cross, kind: 'spruce', shape }, lod);
  v.push(fir(101, 24, 0.34, 3.1));
  v.push(fir(102, 29, 0.42, 3.4));
  v.push(fir(103, 18, 0.22, 2.6));
  // Narrow subalpine spire and a broad, older fir with a rounded crown.
  v.push(fir(104, 26, 0.3, 2.2, 1.35));
  v.push(fir(105, 32, 0.5, 4.2, 0.7));
  v.push(spruce(201, 26, 0.3, 3.0));
  v.push(spruce(202, 21, 0.18, 2.7));
  v.push(spruce(203, 31, 0.45, 3.3));
  v.push(spruce(204, 23, 0.12, 2.4, 1.2));
  v.push(pine(301, atlas, 24, lod));
  v.push(pine(302, atlas, 28, lod));
  v.push(pine(303, atlas, 26, lod, true));
  v.push(broadleaf(401, 15, r.leafA, lod));
  v.push(broadleaf(402, 17, r.leafB, lod));
  v.push(broadleaf(403, 14, r.leafAutumnA, lod, true));
  v.push(broadleaf(404, 16, r.leafAutumnB, lod, true));
  v.push(snag(501, 13, lod, 'stubs'));
  v.push(snag(502, 8, lod, 'broken'));
  v.push(snag(503, 11, lod, 'leaning'));
  v.push(conifer(601, { height: 4.2, r0: 0.07, crownBase: 0.04, crownRadius: 1.25, spacing: 0.32, perWhorl: 5, droop: 0.3, region: r.young, deadRegion: r.dead, cardSegments: 2, cross: 0.5, kind: 'sapling' }, lod === 'hero' ? 'mid' : lod));
  v.push(conifer(603, { height: 7.5, r0: 0.11, crownBase: 0.08, crownRadius: 1.8, spacing: 0.38, perWhorl: 5, droop: 0.35, region: r.fir, deadRegion: r.dead, cardSegments: 2, cross: 0.4, kind: 'sapling' }, lod));
  // Tiny saplings are drawn only close up (as ground cover would be).
  return v;
}

/** A small young conifer used as undergrowth near the viewer. */
export function smallSapling(atlas: FoliageAtlas): PlantModel {
  return conifer(602, { height: 2.2, r0: 0.04, crownBase: 0.03, crownRadius: 0.8, spacing: 0.26, perWhorl: 4, droop: 0.25, region: atlas.regions.young, deadRegion: atlas.regions.dead, cardSegments: 1, cross: 0.6, kind: 'sapling' }, 'mid');
}
