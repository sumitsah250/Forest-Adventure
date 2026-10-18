// Smooth 2D paths (roads, tracks, creek) sampled densely for fast nearest-point
// stamping onto grids. Coordinates are world metres on the XZ plane.

export type PathKind = 'road' | 'track' | 'foot' | 'creek';

export interface PathDef {
  id: string;
  kind: PathKind;
  points: readonly (readonly [number, number])[];
  /** Half width of the travelled surface in metres. */
  halfWidth: number;
}

export interface PathPoint {
  x: number;
  z: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  s: number;
}

export class Path {
  readonly id: string;
  readonly kind: PathKind;
  readonly halfWidth: number;
  /** Interleaved x,z of each sample. */
  readonly xz: Float32Array;
  /** Interleaved unit tangent of each sample. */
  readonly tan: Float32Array;
  /** Arc length at each sample. */
  readonly s: Float32Array;
  readonly count: number;
  readonly length: number;
  readonly spacing: number;

  constructor(def: PathDef, spacing = 0.5) {
    this.id = def.id;
    this.kind = def.kind;
    this.halfWidth = def.halfWidth;
    this.spacing = spacing;

    // Densely evaluate a centripetal Catmull-Rom spline, then resample uniformly by arc length.
    const dense: number[] = [];
    const pts = def.points;
    const n = pts.length;
    const get = (i: number): readonly [number, number] => {
      if (i < 0) {
        const a = pts[0];
        const b = pts[1];
        return [2 * a[0] - b[0], 2 * a[1] - b[1]];
      }
      if (i >= n) {
        const a = pts[n - 1];
        const b = pts[n - 2];
        return [2 * a[0] - b[0], 2 * a[1] - b[1]];
      }
      return pts[i];
    };
    for (let i = 0; i < n - 1; i += 1) {
      const p0 = get(i - 1);
      const p1 = get(i);
      const p2 = get(i + 1);
      const p3 = get(i + 2);
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(4, Math.ceil(segLen / 0.25));
      for (let k = 0; k < steps; k += 1) {
        const [x, z] = centripetal(p0, p1, p2, p3, k / steps);
        dense.push(x, z);
      }
    }
    dense.push(pts[n - 1][0], pts[n - 1][1]);

    const cum: number[] = [0];
    for (let i = 2; i < dense.length; i += 2) {
      cum.push(cum[cum.length - 1] + Math.hypot(dense[i] - dense[i - 2], dense[i + 1] - dense[i - 1]));
    }
    const total = cum[cum.length - 1];
    const count = Math.max(2, Math.floor(total / spacing) + 1);
    this.count = count;
    this.length = total;
    this.xz = new Float32Array(count * 2);
    this.tan = new Float32Array(count * 2);
    this.s = new Float32Array(count);
    let j = 0;
    for (let i = 0; i < count; i += 1) {
      const target = (i / (count - 1)) * total;
      while (j < cum.length - 2 && cum[j + 1] < target) j += 1;
      const span = cum[j + 1] - cum[j] || 1;
      const t = (target - cum[j]) / span;
      this.xz[i * 2] = dense[j * 2] + (dense[j * 2 + 2] - dense[j * 2]) * t;
      this.xz[i * 2 + 1] = dense[j * 2 + 1] + (dense[j * 2 + 3] - dense[j * 2 + 1]) * t;
      this.s[i] = target;
    }
    for (let i = 0; i < count; i += 1) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      const dx = this.xz[b * 2] - this.xz[a * 2];
      const dz = this.xz[b * 2 + 1] - this.xz[a * 2 + 1];
      const len = Math.hypot(dx, dz) || 1;
      this.tan[i * 2] = dx / len;
      this.tan[i * 2 + 1] = dz / len;
    }
  }

  /** Point and tangent at arc length s (clamped). */
  at(s: number): PathPoint {
    const f = Math.min(this.count - 1, Math.max(0, (s / this.length) * (this.count - 1)));
    const i = Math.min(this.count - 2, Math.floor(f));
    const t = f - i;
    const x = this.xz[i * 2] + (this.xz[i * 2 + 2] - this.xz[i * 2]) * t;
    const z = this.xz[i * 2 + 1] + (this.xz[i * 2 + 3] - this.xz[i * 2 + 1]) * t;
    const tx = this.tan[i * 2] + (this.tan[i * 2 + 2] - this.tan[i * 2]) * t;
    const tz = this.tan[i * 2 + 1] + (this.tan[i * 2 + 3] - this.tan[i * 2 + 1]) * t;
    const len = Math.hypot(tx, tz) || 1;
    return { x, z, tx: tx / len, tz: tz / len, s: Math.min(this.length, Math.max(0, s)) };
  }

  /** Brute-force nearest sample; fine for occasional gameplay queries. */
  nearest(x: number, z: number): { index: number; dist: number; s: number; lateral: number } {
    let best = Infinity;
    let bi = 0;
    // Coarse pass then refine around the best coarse sample.
    const stride = 8;
    for (let i = 0; i < this.count; i += stride) {
      const dx = x - this.xz[i * 2];
      const dz = z - this.xz[i * 2 + 1];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    const lo = Math.max(0, bi - stride);
    const hi = Math.min(this.count - 1, bi + stride);
    for (let i = lo; i <= hi; i += 1) {
      const dx = x - this.xz[i * 2];
      const dz = z - this.xz[i * 2 + 1];
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = i; }
    }
    const dx = x - this.xz[bi * 2];
    const dz = z - this.xz[bi * 2 + 1];
    // Left-hand normal (-tz, tx): positive lateral is to the left of travel.
    const lateral = dx * -this.tan[bi * 2 + 1] + dz * this.tan[bi * 2];
    return { index: bi, dist: Math.sqrt(best), s: this.s[bi], lateral };
  }

  /** Heading angle (radians, rotation about +Y) of travel at arc length s, for objects facing along -Z. */
  headingAt(s: number): number {
    const p = this.at(s);
    return Math.atan2(-p.tx, -p.tz);
  }
}

function centripetal(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  const alpha = 0.5;
  const tj = (ti: number, a: readonly [number, number], b: readonly [number, number]) =>
    ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-4, alpha);
  const t0 = 0;
  const t1 = tj(t0, p0, p1);
  const t2 = tj(t1, p1, p2);
  const t3 = tj(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const lerp2 = (a: readonly [number, number], b: readonly [number, number], ta: number, tb: number): [number, number] => {
    const w = (tt - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w];
  };
  const a1 = lerp2(p0, p1, t0, t1);
  const a2 = lerp2(p1, p2, t1, t2);
  const a3 = lerp2(p2, p3, t2, t3);
  const b1 = lerp2(a1, a2, t0, t2);
  const b2 = lerp2(a2, a3, t1, t3);
  return lerp2(b1, b2, t1, t2);
}

export interface GridSpec {
  /** World coordinate of grid point 0 along X and Z. */
  origin: number;
  /** Distance between grid points. */
  cell: number;
  /** Points per side. */
  n: number;
}

/**
 * Writes, for every grid point within maxDist of the path, the signed distance to
 * the path (positive on the left) and the arc length of the nearest sample.
 * Only overwrites a point when this path is closer than what is already stored.
 */
export function stampPath(
  path: Path,
  grid: GridSpec,
  maxDist: number,
  outDist: Float32Array,
  outSigned: Float32Array,
  outS: Float32Array | null,
  outId: Uint8Array | null,
  id: number,
): void {
  const { origin, cell, n } = grid;
  const r = Math.ceil(maxDist / cell);
  const maxD2 = maxDist * maxDist;
  for (let i = 0; i < path.count; i += 1) {
    const px = path.xz[i * 2];
    const pz = path.xz[i * 2 + 1];
    const nx = -path.tan[i * 2 + 1];
    const nz = path.tan[i * 2];
    const gx = Math.round((px - origin) / cell);
    const gz = Math.round((pz - origin) / cell);
    const x0 = Math.max(0, gx - r);
    const x1 = Math.min(n - 1, gx + r);
    const z0 = Math.max(0, gz - r);
    const z1 = Math.min(n - 1, gz + r);
    for (let zi = z0; zi <= z1; zi += 1) {
      const wz = origin + zi * cell;
      const dz = wz - pz;
      const row = zi * n;
      for (let xi = x0; xi <= x1; xi += 1) {
        const wx = origin + xi * cell;
        const dx = wx - px;
        const d2 = dx * dx + dz * dz;
        if (d2 > maxD2) continue;
        const k = row + xi;
        const d = Math.sqrt(d2);
        if (d < outDist[k]) {
          outDist[k] = d;
          const side = dx * nx + dz * nz >= 0 ? 1 : -1;
          outSigned[k] = side * d;
          if (outS) outS[k] = path.s[i];
          if (outId) outId[k] = id;
        }
      }
    }
  }
}
