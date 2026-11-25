// Room furnishers for the workshops, labs, plant rooms, garages and stores (work).
// See kit.ts for the Room / Kit API.
//
// Everything here is laid out in a "frame": x runs along one wall, z goes away from it into
// the room, y is up. The main frame sits on a long wall, so the same layout code serves rooms
// of any size and orientation. Big things get one invisible collider each (`solid`), which also
// reserves their footprint so later `fits` checks keep aisles and doorways clear.
import type { Furnisher, Kit, Mat, Room, Side } from './kit.ts';

type Ax = 'x' | 'y' | 'z';
type Wall = 'z0' | 'z1' | 'x0' | 'x1';
interface Zone { x0: number; x1: number; z0: number; z1: number }

/** Primitives dropped for poking outside their room (layout bugs: should stay 0). */
export const WORK_STATS = { dropped: 0 };

const OPP: Record<Side, Side> = { u0: 'u1', u1: 'u0', v0: 'v1', v1: 'v0' };

// ==================================================================== frames

/** The room seen from one wall: x along that wall (0..len), z into the room (0..dep). */
class F {
  readonly r: Room;
  readonly side: Side;
  readonly len: number;
  readonly dep: number;
  private readonly k: Kit;
  private readonly o: [number, number, number, number, number, number];

  constructor(r: Room, k: Kit, side: Side, o: [number, number, number, number, number, number], len: number, dep: number) {
    this.r = r;
    this.k = k;
    this.side = side;
    this.o = o;
    this.len = len;
    this.dep = dep;
  }

  private U(x: number, z: number): number {
    return this.o[0] + this.o[2] * x + this.o[4] * z;
  }
  private V(x: number, z: number): number {
    return this.o[1] + this.o[3] * x + this.o[5] * z;
  }
  /** True when this frame's x runs along the room's u. */
  private get xu(): boolean {
    return this.o[2] !== 0;
  }
  get H(): number {
    return this.r.height;
  }

  box(m: Mat, x: number, z: number, y: number, w: number, h: number, d: number): void {
    const a = this.xu;
    this.k.box(m, this.U(x, z), this.V(x, z), y, a ? w : d, h, a ? d : w);
  }
  /** Invisible collider; it also reserves the footprint for later `fits` checks. */
  solid(x: number, z: number, w: number, d: number, h: number, y = 0): void {
    const a = this.xu;
    this.k.box('none', this.U(x, z), this.V(x, z), y, a ? w : d, Math.min(h, this.H - y), a ? d : w, { solid: true });
  }
  cyl(m: Mat, x: number, z: number, y: number, r: number, h: number, axis: Ax = 'y', seg = 10, r2?: number): void {
    const a: 'y' | 'u' | 'v' = axis === 'y' ? 'y' : (axis === 'x') === this.xu ? 'u' : 'v';
    this.k.cyl(m, this.U(x, z), this.V(x, z), y, r, h, r2 === undefined ? { axis: a, seg } : { axis: a, seg, r2 });
  }
  fits(x: number, z: number, w: number, d: number): boolean {
    const a = this.xu;
    return this.r.fits(this.U(x, z), this.V(x, z), a ? w : d, a ? d : w);
  }
  free(x: number, z: number, rad = 0.3): boolean {
    return this.r.free(this.U(x, z), this.V(x, z), rad);
  }
  /** This frame's point (x, z) in room coordinates. */
  room(x: number, z: number): [number, number] {
    return [this.U(x, z), this.V(x, z)];
  }
  /** A room point (u, v) in this frame. */
  local(u: number, v: number): [number, number] {
    const du = u - this.o[0];
    const dv = v - this.o[1];
    return [du * this.o[2] + dv * this.o[3], du * this.o[4] + dv * this.o[5]];
  }
  /** A child frame at (x, z), turned by quarter turns (1: its x runs along this frame's z). */
  sub(x: number, z: number, turn = 0): F {
    let [, , xu, xv, zu, zv] = this.o;
    for (let i = 0; i < ((turn % 4) + 4) % 4; i += 1) [xu, xv, zu, zv] = [zu, zv, -xu, -xv];
    return new F(this.r, this.k, this.side, [this.U(x, z), this.V(x, z), xu, xv, zu, zv], 0, 0);
  }
  /** The room frame on another wall (relative to this one). */
  wall(w: Wall): F {
    const s = this.side;
    const alongU = s === 'v0' || s === 'v1';
    const t: Side = w === 'z0' ? s : w === 'z1' ? OPP[s] : w === 'x0' ? (alongU ? 'u0' : 'v0') : alongU ? 'u1' : 'v1';
    return frameOf(this.r, this.k, t);
  }
  rand(): number {
    return this.r.rand();
  }
  pick<T>(a: readonly T[]): T {
    return a[Math.min(a.length - 1, Math.floor(this.r.rand() * a.length))];
  }
}

function frameOf(r: Room, k: Kit, s: Side): F {
  const L = r.u1 - r.u0;
  const D = r.v1 - r.v0;
  if (s === 'v0') return new F(r, k, s, [r.u0, r.v0, 1, 0, 0, 1], L, D);
  if (s === 'v1') return new F(r, k, s, [r.u0, r.v1, 1, 0, 0, -1], L, D);
  if (s === 'u0') return new F(r, k, s, [r.u0, r.v0, 0, 1, 1, 0], D, L);
  return new F(r, k, s, [r.u1, r.v0, 0, 1, -1, 0], D, L);
}

function doorSide(r: Room, d: { u: number; v: number; side: Side | null }): Side {
  if (d.side) return d.side;
  const c: [Side, number][] = [['u0', Math.abs(d.u - r.u0)], ['u1', Math.abs(d.u - r.u1)], ['v0', Math.abs(d.v - r.v0)], ['v1', Math.abs(d.v - r.v1)]];
  c.sort((a, b) => a[1] - b[1]);
  return c[0][0];
}

/** Frame on a long wall: the front if that is a long wall, else the long wall with fewer doors. */
function mainFrame(r: Room, k: Kit): F {
  const long: [Side, Side] = r.u1 - r.u0 >= r.v1 - r.v0 ? ['v0', 'v1'] : ['u0', 'u1'];
  if (long.includes(r.front)) return frameOf(r, k, r.front);
  const n = (s: Side) => r.doors.filter((d) => doorSide(r, d) === s).length;
  return frameOf(r, k, n(long[1]) < n(long[0]) ? long[1] : long[0]);
}

/** Drops (and counts) anything that would poke out of the room's clear rectangle. */
function guard(r: Room, k: Kit): Kit {
  const e = 0.012;
  const inside = (u: number, v: number, hu: number, hv: number) => u - hu >= r.u0 - e && u + hu <= r.u1 + e && v - hv >= r.v0 - e && v + hv <= r.v1 + e;
  return {
    box(m, u, v, y, w, h, d, o) {
      const c = Math.abs(Math.cos(o?.rot ?? 0));
      const s = Math.abs(Math.sin(o?.rot ?? 0));
      if (inside(u, v, (w * c + d * s) / 2, (w * s + d * c) / 2)) k.box(m, u, v, y, w, h, d, o);
      else WORK_STATS.dropped += 1;
    },
    cyl(m, u, v, y, rad, h, o) {
      const ax = o?.axis ?? 'y';
      const rr = Math.max(rad, o?.r2 ?? 0);
      if (inside(u, v, ax === 'u' ? h / 2 : rr, ax === 'v' ? h / 2 : rr)) k.cyl(m, u, v, y, rad, h, o);
      else WORK_STATS.dropped += 1;
    },
  };
}

// ==================================================================== placement

interface Item {
  w: number;
  d: number;
  /** Collider height; 0 when the drawing adds its own colliders. */
  h: number;
  draw(f: F, x: number, z: number): void;
}
const item = (w: number, d: number, h: number, draw: (f: F, x: number, z: number) => void): Item => ({ w, d, h, draw });

function put(f: F, it: Item, x: number, z: number): void {
  it.draw(f, x, z);
  if (it.h > 0) f.solid(x, z, it.w, it.d, it.h);
}

/** True when the footprint fits and nothing solid (or a doorway) is within `pad` of it. */
function clear(f: F, x: number, z: number, w: number, d: number, pad: number): boolean {
  if (!f.fits(x, z, w, d)) return false;
  if (pad <= 0) return true;
  const a = Math.max(0.02, x - w / 2 - pad);
  const b = Math.min(f.len - 0.02, x + w / 2 + pad);
  const c = Math.max(0.02, z - d / 2 - pad);
  const e = Math.min(f.dep - 0.02, z + d / 2 + pad);
  return f.fits((a + b) / 2, (c + e) / 2, b - a, e - c);
}

/** Items one after another with their backs to the frame's wall, skipping doorways and anything in the way. */
function alongWall(f: F, next: (i: number) => Item | null, gap = 0.12, max = 999, x0 = 0.04, x1 = f.len - 0.04): number {
  let x = x0;
  let last = x0;
  let n = 0;
  let skip = 0; // when an item finds no room, the next kinds get a turn
  for (let t = 0; t < 800 && n < max; t += 1) {
    const it = next(n + skip);
    if (!it) break;
    if (x + it.w > x1) {
      if (skip >= 3) break;
      skip += 1;
      x = last;
      continue;
    }
    const cx = x + it.w / 2;
    const cz = 0.03 + it.d / 2;
    if (f.fits(cx, cz, it.w, it.d)) {
      put(f, it, cx, cz);
      n += 1;
      x += it.w + gap;
      last = x;
    } else x += 0.2;
  }
  return n;
}

/** A row on an end wall of `f` (x0 / x1), kept between z0 and z1 of `f`. */
function endWall(f: F, w: 'x0' | 'x1', z0: number, z1: number, next: (i: number) => Item | null, gap = 0.15, max = 999): number {
  const e = f.wall(w);
  const a = e.local(...f.room(0, z0))[0];
  const b = e.local(...f.room(0, z1))[0];
  return alongWall(e, next, gap, max, Math.max(0.04, Math.min(a, b)), Math.min(e.len - 0.04, Math.max(a, b)));
}

/** Items centred on the line z, from x0 to x1, with at least `gap` between them and anything else. */
function alongLine(f: F, z: number, x0: number, x1: number, next: (i: number) => Item | null, gap: number, max = 999, pad = Math.min(gap, 1.3) - 0.1): number {
  let x = x0;
  let n = 0;
  for (let t = 0; t < 800 && n < max; t += 1) {
    const it = next(n);
    if (!it || x + it.w > x1) break;
    const cx = x + it.w / 2;
    if (clear(f, cx, z, it.w, it.d, pad)) {
      put(f, it, cx, z);
      n += 1;
      x += it.w + gap;
    } else x += 0.25;
  }
  return n;
}

/** A block of w × d cells in rows along x, centred in the zone, aisles gx / gz between them. */
function grid(f: F, zn: Zone, w: number, d: number, gx: number, gz: number, next: (i: number, row: number) => Item | null): number {
  const nx = Math.floor((zn.x1 - zn.x0 + gx) / (w + gx));
  const nz = Math.floor((zn.z1 - zn.z0 + gz) / (d + gz));
  if (nx < 1 || nz < 1) return 0;
  const xs = (zn.x0 + zn.x1) / 2 - (nx * (w + gx) - gx) / 2 + w / 2;
  const zs = (zn.z0 + zn.z1) / 2 - (nz * (d + gz) - gz) / 2 + d / 2;
  const pad = Math.min(gx, gz, 1.3) - 0.1;
  let n = 0;
  for (let j = 0; j < nz; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const it = next(n, j);
      if (!it) return n;
      const x = xs + i * (w + gx);
      const z = zs + j * (d + gz);
      if (clear(f, x, z, it.w, it.d, pad)) {
        put(f, it, x, z);
        n += 1;
      }
    }
  }
  return n;
}

/** Tries x positions spreading out from xPref until the item fits against the wall. */
function nearWall(f: F, xPref: number, it: Item): boolean {
  const z = 0.03 + it.d / 2;
  for (let s = 0; s < 40; s += 1) {
    const x = xPref + (s % 2 ? 1 : -1) * Math.ceil(s / 2) * 0.3;
    if (x - it.w / 2 < 0.03 || x + it.w / 2 > f.len - 0.03) continue;
    if (f.fits(x, z, it.w, it.d)) {
      put(f, it, x, z);
      return true;
    }
  }
  return false;
}

/**
 * Rows on the two long walls (and the end walls when the room is long enough); returns the
 * clear centre zone. Rows are only used where they leave a walkable aisle.
 */
function perimeter(
  f: F,
  back: ((i: number) => Item | null) | null,
  dB: number,
  far: ((i: number) => Item | null) | null,
  dF: number,
  ends: ((i: number) => Item | null) | null = null,
  dE = 0,
  aisle = 1.3,
): Zone {
  const useB = !!back && f.dep >= dB + 0.9;
  const useF = !!far && f.dep >= (useB ? dB : 0) + dF + aisle;
  if (useB && back) alongWall(f, back);
  if (useF && far) alongWall(f.wall('z1'), far);
  const useE = !!ends && f.len >= 2 * dE + 2 * aisle + 2.0 && f.dep >= 2.5;
  if (useE && ends) {
    // Keep the end-wall rows clear of the long-wall rows.
    const z0 = useB ? dB + 0.6 : 0.04;
    const z1 = f.dep - (useF ? dF + 0.6 : 0.04);
    for (const w of ['x0', 'x1'] as const) endWall(f, w, z0, z1, ends);
  }
  return {
    x0: (useE ? dE : 0) + aisle,
    x1: f.len - (useE ? dE : 0) - aisle,
    z0: (useB ? dB : 0) + aisle,
    z1: f.dep - (useF ? dF : 0) - aisle,
  };
}

/** Yellow floor lines round a machine (edges against a wall are left out). */
function lines(f: F, x: number, z: number, w: number, d: number, g = 0.3): void {
  const a = x - w / 2 - g;
  const b = x + w / 2 + g;
  const c = z - d / 2 - g;
  const e = z + d / 2 + g;
  const A = Math.max(a, 0.03);
  const B = Math.min(b, f.len - 0.03);
  const C = Math.max(c, 0.03);
  const E = Math.min(e, f.dep - 0.03);
  const t = 0.05;
  if (c >= 0.03) f.box('yellow', (A + B) / 2, c + t / 2, 0, B - A, 0.01, t);
  if (e <= f.dep - 0.03) f.box('yellow', (A + B) / 2, e - t / 2, 0, B - A, 0.01, t);
  if (a >= 0.03) f.box('yellow', a + t / 2, (C + E) / 2, 0, t, 0.01, E - C);
  if (b <= f.len - 0.03) f.box('yellow', b - t / 2, (C + E) / 2, 0, t, 0.01, E - C);
}

/** Tube-light fittings in a grid: hung on rods under an open roof, else on the ceiling. */
function lights(f: F): void {
  const r = f.r;
  const nx = Math.max(1, Math.round(f.len / 3.4));
  const nz = Math.max(1, Math.round(f.dep / 3));
  const L = Math.min(1.22, f.len - 0.1);
  const y = r.openRoof ? Math.min(r.height + 1.0, 4.2) : r.height - 0.13;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const x = ((i + 0.5) * f.len) / nx;
      const z = ((j + 0.5) * f.dep) / nz;
      f.box('metal', x, z, y + 0.03, L + 0.04, 0.05, 0.14);
      f.box('light', x, z, y, L, 0.03, 0.08);
      if (r.openRoof) {
        const rod = Math.max(0.6, r.height + 1.1 - y);
        for (const s of [-1, 1]) f.box('metal', x + s * L * 0.4, z, y + 0.08, 0.015, rod, 0.015);
      }
    }
  }
}

// ==================================================================== shared pieces

/** Bench: top at 0.9 m on steel end frames with a low stretcher. */
function bench(f: F, x: number, z: number, w: number, d: number, top: Mat = 'darkwood', frame: Mat = 'metal'): void {
  f.box(top, x, z, 0.85, w, 0.05, d);
  for (const s of [-1, 1]) f.box(frame, x + s * (w / 2 - 0.07), z, 0, 0.06, 0.85, d - 0.1);
  if (w > 1.2) f.box(frame, x, z, 0.14, w - 0.2, 0.04, 0.05);
}

/** Bench vice on a bench edge; jaws towards +z (dir 1) or -z (dir -1). */
function vice(f: F, x: number, z: number, dir = 1, y = 0.9): void {
  f.box('machineDark', x, z, y, 0.13, 0.11, 0.22);
  f.box('steel', x, z + dir * 0.12, y + 0.02, 0.17, 0.09, 0.03);
  f.cyl('chrome', x, z + dir * 0.15, y + 0.05, 0.009, 0.26, 'x', 6);
}

/** Pegboard with a few tool outlines, on the wall behind a bench (z = the wall face). */
function pegboard(f: F, x: number, z: number, w: number): void {
  if (f.H < 2.2) return;
  f.box('plywood', x, z + 0.01, 1.05, w, 0.7, 0.02);
  f.box('black', x - w * 0.25, z + 0.025, 1.25, 0.04, 0.3, 0.01);
  f.box('red', x + w * 0.2, z + 0.025, 1.4, 0.25, 0.05, 0.01);
}

const viceBench = (w: number, d: number, n: number, top: Mat = 'darkwood'): Item =>
  item(w, d, 0.9, (f, x, z) => {
    bench(f, x, z, w, d, top);
    for (let i = 0; i < n; i += 1) vice(f, x + (i - (n - 1) / 2) * (w / n), z + d / 2 - 0.12);
    pegboard(f, x, z - d / 2, w * 0.85);
  });

const toolChest = (): Item =>
  item(0.72, 0.48, 1.0, (f, x, z) => {
    f.box('red', x, z, 0.1, 0.72, 0.86, 0.48);
    for (let i = 0; i < 4; i += 1) f.box('chrome', x, z + 0.235, 0.3 + i * 0.17, 0.5, 0.02, 0.012);
    for (const sx of [-0.3, 0.3]) for (const sz of [-0.18, 0.18]) f.cyl('rubber', x + sx, z + sz, 0, 0.045, 0.1, 'y', 6);
  });

const cupboard = (mat: Mat = 'machine', w = 0.9): Item =>
  item(w, 0.45, 1.8, (f, x, z) => {
    const h = Math.min(1.85, f.H - 0.2);
    f.box(mat, x, z, 0, w, h, 0.45);
    f.box('machineDark', x, z + 0.224, 0.05, 0.012, h - 0.1, 0.005);
    for (const s of [-1, 1]) f.box('chrome', x + s * 0.05, z + 0.23, h * 0.5, 0.02, 0.14, 0.012);
  });

const tyres = (): Item =>
  item(0.7, 0.7, 0.85, (f, x, z) => {
    const n = 3 + Math.floor(f.rand() * 2);
    for (let i = 0; i < n; i += 1) f.cyl('rubber', x + (f.rand() - 0.5) * 0.04, z, i * 0.21, 0.32, 0.2, 'y', 10);
    f.cyl('black', x, z, n * 0.21 - 0.005, 0.17, 0.01, 'y', 8);
  });

const drums = (n: number, mat: Mat = 'blue'): Item =>
  item(0.62 * n, 0.62, 0.9, (f, x, z) => {
    for (let i = 0; i < n; i += 1) {
      const dx = x + (i - (n - 1) / 2) * 0.62;
      f.cyl(f.rand() < 0.3 ? 'red' : mat, dx, z, 0, 0.29, 0.88, 'y', 12);
      f.cyl('metal', dx, z, 0.3, 0.297, 0.03, 'y', 12);
    }
  });

type Fill = 'cartons' | 'parts' | 'bottles' | 'samples' | 'none';

/** Slotted-angle steel rack with shelves and something on them. */
function shelving(f: F, x: number, z: number, w: number, d: number, hMax: number, fill: Fill, post: Mat = 'metal'): void {
  const h = Math.min(hMax, f.H - 0.2);
  const levels = Math.max(2, Math.min(5, Math.round(h / 0.5)));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(post, x + sx * (w / 2 - 0.02), z + sz * (d / 2 - 0.02), 0, 0.04, h, 0.04);
  const step = (h - 0.15) / (levels - 1);
  for (let i = 0; i < levels; i += 1) {
    const y = 0.1 + i * step;
    f.box('metal', x, z, y, w, 0.025, d);
    if (i === levels - 1 && h > 1.6) break; // nothing on a top shelf above head height
    const gap = Math.min(step, 0.5) - 0.06;
    const top = y + 0.025;
    if (fill === 'cartons') {
      const n = f.rand() < 0.15 ? 0 : 1 + Math.floor(f.rand() * 2);
      for (let c = 0; c < n; c += 1) {
        const cw = Math.min(w / n - 0.06, 0.35 + f.rand() * 0.3);
        const cx = x - w / 2 + (w / n) * (c + 0.5) + (f.rand() - 0.5) * (w / n - cw - 0.04);
        f.box('plywood', cx, z, top, cw, Math.min(gap, 0.18 + f.rand() * 0.25), d - 0.08);
      }
    } else if (fill === 'parts') {
      f.box('blue', x - w * 0.22, z, top, w * 0.5, Math.min(gap, 0.14), d - 0.06);
      f.box(f.pick<Mat>(['red', 'yellow', 'orange']), x + w * 0.28, z, top, w * 0.38, Math.min(gap, 0.12), d - 0.06);
    } else if (fill === 'bottles') {
      for (let c = 0; c < 4; c += 1) {
        f.cyl(f.pick<Mat>(['blue', 'green', 'orange', 'white', 'red']), x - w / 2 + (w / 4) * (c + 0.5), z, top, 0.045, Math.min(gap, 0.24), 'y', 8);
      }
    } else if (fill === 'samples') {
      f.box('concrete', x - w * 0.25, z, top, 0.45, 0.15, 0.15);
      f.cyl('concrete', x + w * 0.22, z, top, 0.075, Math.min(gap, 0.3), 'y', 8);
    }
  }
}

const rack = (w: number, d: number, h: number, fill: Fill, post: Mat = 'metal'): Item =>
  item(w, d, h, (f, x, z) => shelving(f, x, z, w, d, h, fill, post));

/** Stool (not solid). */
function stool(f: F, x: number, z: number): void {
  if (!f.free(x, z, 0.22)) return;
  f.cyl('metal', x, z, 0, 0.18, 0.03, 'y', 8);
  f.cyl('metal', x, z, 0.03, 0.025, 0.6, 'y', 6);
  f.cyl('black', x, z, 0.62, 0.17, 0.05, 'y', 10);
}

/** Office chair facing -z (seat, back, post). Not solid. */
function chair(f: F, x: number, z: number, dir = 1): void {
  if (!f.free(x, z, 0.25)) return;
  f.cyl('metal', x, z, 0, 0.025, 0.45, 'y', 6);
  f.box('chair', x, z, 0.45, 0.44, 0.07, 0.42);
  f.box('chair', x, z + dir * 0.2, 0.52, 0.42, 0.42, 0.05);
}

/** A car along x (front at +x), wheels on y. ~4.1 × 1.72 × 1.44 m. */
function car(f: F, x: number, z: number, y: number, col: Mat, bonnet = false): void {
  for (const sx of [-1.3, 1.3]) {
    for (const sz of [-0.73, 0.73]) {
      f.cyl('rubber', x + sx, z + sz, y + 0.31, 0.31, 0.21, 'z', 12);
      f.cyl('steel', x + sx, z + sz * 1.01, y + 0.31, 0.17, 0.2, 'z', 8);
    }
  }
  f.box(col, x, z, y + 0.3, 4.0, 0.62, 1.7);
  f.box('black', x - 0.3, z, y + 0.92, 2.1, 0.44, 1.5);
  f.box(col, x - 0.3, z, y + 1.36, 1.95, 0.07, 1.5);
  f.box(col, x - 0.45, z, y + 0.92, 0.12, 0.44, 1.52);
  for (const s of [-1, 1]) {
    f.box('black', x + s * 2.0, z, y + 0.27, 0.08, 0.16, 1.72);
    f.box(s > 0 ? 'cream' : 'red', x + s * 1.995, z - 0.58, y + 0.68, 0.03, 0.12, 0.3);
    f.box(s > 0 ? 'cream' : 'red', x + s * 1.995, z + 0.58, y + 0.68, 0.03, 0.12, 0.3);
    f.box('red', x + s * 2.03, z, y + 0.45, 0.02, 0.11, 0.36);
  }
  if (bonnet) {
    f.box('machineDark', x + 1.38, z, y + 0.92, 1.15, 0.02, 1.45);
    f.box('metal', x + 1.35, z, y + 0.92, 0.5, 0.16, 0.6);
    f.box('black', x + 1.62, z + 0.5, y + 0.92, 0.24, 0.18, 0.18);
    f.box(col, x + 0.76, z, y + 0.95, 0.04, Math.min(0.95, f.H - y - 1.0), 1.5);
  }
}

const CAR_COLOURS: readonly Mat[] = ['white', 'red', 'blue', 'black', 'cream', 'white'];

/** A motorbike along this frame's x (front at +x), centred on the origin. ~1.95 × 0.7 m. */
function motorbike(f: F, col: Mat): void {
  for (const sx of [-0.66, 0.66]) f.cyl('rubber', sx, 0, 0.3, 0.3, 0.09, 'z', 10);
  f.box('metal', 0.02, 0, 0.2, 0.42, 0.3, 0.22);
  f.box(col, 0.22, 0, 0.6, 0.44, 0.2, 0.28);
  f.box('black', -0.3, 0, 0.68, 0.62, 0.1, 0.26);
  f.box(col, -0.66, 0, 0.62, 0.48, 0.08, 0.16);
  f.box('chrome', 0.6, 0, 0.3, 0.06, 0.66, 0.14);
  f.cyl('chrome', 0.57, 0, 0.98, 0.014, 0.68, 'z', 6);
  f.cyl('cream', 0.69, 0, 0.84, 0.07, 0.08, 'x', 8);
  f.cyl('chrome', -0.32, 0.17, 0.3, 0.04, 0.62, 'x', 6);
}

// ==================================================================== workshop machines

/** Centre lathe along x (headstock at -x), operator at +z. Footprint 2.1 × 0.8. */
function lathe(f: F, x: number, z: number): void {
  f.box('machine', x - 0.7, z - 0.03, 0, 0.5, 0.74, 0.55);
  f.box('machine', x + 0.75, z - 0.03, 0, 0.4, 0.74, 0.5);
  f.box('machineDark', x - 0.7, z - 0.34, 0.12, 0.32, 0.3, 0.08);
  f.box('metal', x, z, 0.72, 2.0, 0.06, 0.66);
  f.box('machine', x + 0.1, z - 0.05, 0.78, 1.8, 0.2, 0.32);
  f.box('machine', x - 0.75, z - 0.05, 0.98, 0.5, 0.36, 0.42);
  f.cyl('steel', x - 0.44, z - 0.05, 1.13, 0.1, 0.12, 'x', 10);
  f.box('machine', x + 0.75, z - 0.05, 0.98, 0.24, 0.24, 0.22);
  f.cyl('steel', x + 0.56, z - 0.05, 1.12, 0.025, 0.16, 'x', 6);
  f.box('machineDark', x + 0.05, z + 0.17, 0.6, 0.32, 0.38, 0.1);
  f.box('machineDark', x + 0.05, z - 0.05, 0.98, 0.26, 0.06, 0.5);
  f.box('steel', x + 0.05, z, 1.04, 0.1, 0.1, 0.1);
  f.cyl('chrome', x - 0.05, z + 0.24, 0.85, 0.07, 0.03, 'z', 10);
  f.cyl('steel', x + 0.1, z + 0.14, 0.7, 0.012, 1.7, 'x', 6);
}

/** Knee-type milling machine, operator at +z. Footprint 1.35 × 1.0. */
function mill(f: F, x: number, z: number): void {
  const top = Math.min(2.1, f.H - 0.15);
  f.box('machine', x, z - 0.05, 0, 0.75, 0.15, 0.9);
  f.box('machine', x, z - 0.25, 0.15, 0.55, top - 0.55, 0.5);
  f.box('machine', x, z + 0.17, 0.4, 0.5, 0.45, 0.45);
  f.box('machineDark', x, z + 0.2, 0.85, 0.45, 0.1, 0.35);
  f.box('steel', x, z + 0.2, 0.95, 1.3, 0.07, 0.3);
  f.box('machine', x, z - 0.15, top - 0.4, 0.4, 0.3, 0.7);
  f.box('machine', x, z + 0.25, top - 0.85, 0.3, 0.5, 0.28);
  f.cyl('chrome', x, z + 0.25, top - 1.0, 0.035, 0.15, 'y', 8);
  f.cyl('chrome', x + 0.66, z + 0.2, 0.985, 0.06, 0.03, 'x', 10);
}

/** Shaper: ram along z over a box table at the front. Footprint 0.8 × 1.4. */
function shaper(f: F, x: number, z: number): void {
  f.box('machine', x, z - 0.25, 0, 0.7, 1.12, 0.9);
  f.box('machine', x, z - 0.05, 1.12, 0.36, 0.28, 1.25);
  f.box('machineDark', x, z + 0.5, 0.88, 0.2, 0.36, 0.14);
  f.box('machineDark', x, z + 0.45, 0.42, 0.6, 0.4, 0.3);
  f.box('steel', x, z + 0.45, 0.82, 0.26, 0.08, 0.2);
  f.cyl('chrome', x + 0.37, z - 0.3, 0.7, 0.2, 0.04, 'x', 10);
}

/** Pillar drill press. Footprint 0.55 × 0.6. */
function drill(f: F, x: number, z: number): void {
  f.box('machineDark', x, z, 0, 0.5, 0.08, 0.58);
  f.cyl('steel', x, z - 0.17, 0.08, 0.05, 1.5, 'y', 8);
  f.box('machine', x, z + 0.05, 0.82, 0.36, 0.04, 0.32);
  f.box('machine', x, z - 0.08, 0.78, 0.12, 0.08, 0.2);
  f.box('machine', x, z - 0.04, 1.3, 0.28, 0.3, 0.44);
  f.cyl('machine', x, z - 0.17, 1.6, 0.1, 0.24, 'y', 10);
  f.cyl('chrome', x, z + 0.07, 1.14, 0.025, 0.16, 'y', 6);
  f.cyl('black', x + 0.2, z + 0.02, 1.4, 0.01, 0.3, 'x', 6);
}

/** Double-ended bench grinder on a pedestal. Footprint 0.6 × 0.4. */
function grinder(f: F, x: number, z: number): void {
  f.box('machineDark', x, z, 0, 0.4, 0.04, 0.4);
  f.cyl('machine', x, z, 0.04, 0.07, 0.86, 'y', 8);
  f.cyl('machine', x, z, 1.02, 0.09, 0.28, 'x', 10);
  for (const s of [-1, 1]) {
    f.cyl('concrete', x + s * 0.2, z, 1.02, 0.1, 0.03, 'x', 12);
    f.box('machine', x + s * 0.2, z - 0.03, 1.07, 0.05, 0.08, 0.16);
  }
}

const surfacePlate = (): Item =>
  item(0.95, 0.65, 0.85, (f, x, z) => {
    f.box('machineDark', x, z, 0, 0.8, 0.7, 0.55);
    f.box('black', x, z, 0.7, 0.92, 0.13, 0.62);
  });

const machine = (w: number, d: number, h: number, draw: (f: F, x: number, z: number) => void, g = 0.3): Item =>
  item(w, d, h, (f, x, z) => {
    draw(f, x, z);
    lines(f, x, z, w, d, g);
  });

const latheItem = () => machine(2.1, 0.8, 1.3, lathe, 0.25);
const millItem = () => machine(1.35, 1.0, 2.0, mill);
const shaperItem = () => machine(0.8, 1.45, 1.4, shaper);
const drillItem = () => machine(0.55, 0.6, 1.7, drill, 0.25);
const grinderItem = () => machine(0.6, 0.4, 1.2, grinder, 0.25);

// ==================================================================== workshops

function auto(f: F): void {
  const zone = perimeter(
    f,
    (i) => (i % 3 === 2 ? toolChest() : viceBench(2.0, 0.75, 2)),
    0.75,
    (i) => [tyres(), tyres(), drums(2), rack(1.8, 0.5, 1.8, 'parts'), toolChest(), compressor()][i % 6],
    0.72,
  );
  const band = zone.z1 - zone.z0;
  const bays = [liftBay(), floorCar(), engineCorner()];
  if (band >= 2.9) {
    const n = Math.floor((band + 1.4) / (2.9 + 1.4));
    const z0 = (zone.z0 + zone.z1) / 2 - (n * 4.3 - 1.4) / 2 + 1.45;
    for (let j = 0; j < n; j += 1) alongLine(f, z0 + j * 4.3, zone.x0, zone.x1, (i) => bays[(i + j) % 3], 1.5);
  } else if (band >= 1.9) {
    alongLine(f, (zone.z0 + zone.z1) / 2, zone.x0, zone.x1, (i) => bays[1 + (i % 2)], 1.5);
  } else if (band >= 1.3) {
    alongLine(f, (zone.z0 + zone.z1) / 2, zone.x0, zone.x1, () => bays[2], 1.4);
  }
}

/** Two-post lift with a car raised on it. 4.4 × 2.9. */
const liftBay = (): Item =>
  item(4.4, 2.9, 0, (f, x, z) => {
    const postH = Math.min(3.1, f.H - 0.08);
    const raise = Math.max(0.25, Math.min(1.45, postH - 1.75));
    for (const s of [-1, 1]) {
      const pz = z + s * 1.3;
      f.box('blue', x, pz, 0, 0.3, postH, 0.28);
      f.box('metal', x, pz, 0, 0.6, 0.02, 0.28);
      f.box('machineDark', x, pz - s * 0.2, raise - 0.32, 0.32, 0.3, 0.14);
      for (const ax of [-0.55, 0.55]) f.box('blue', x + ax, z + s * 0.75, raise - 0.1, 0.1, 0.08, 1.0);
      f.solid(x, pz, 0.3, 0.28, postH);
    }
    if (postH > 2.6) f.box('blue', x, z, postH - 0.16, 0.24, 0.16, 2.88);
    car(f, x, z, raise, f.pick(CAR_COLOURS));
    f.solid(x, z, 4.1, 1.72, 1.44, raise);
    lines(f, x, z, 4.4, 2.9, 0.2);
  });

/** A car on the floor with its bonnet up and a jack beside the front wheel. */
const floorCar = (): Item =>
  item(4.2, 2.4, 1.45, (f, x, z) => {
    car(f, x, z - 0.3, 0, f.pick(CAR_COLOURS), true);
    jack(f, x + 1.0, z + 0.95);
  });

/** Hydraulic floor jack along x (saddle at +x). */
function jack(f: F, x: number, z: number): void {
  f.box('red', x, z, 0.06, 0.7, 0.13, 0.3);
  f.cyl('black', x + 0.28, z, 0.19, 0.07, 0.04, 'y', 8);
  f.cyl('metal', x - 0.6, z, 0.24, 0.015, 0.55, 'x', 6);
  f.cyl('rubber', x + 0.28, z, 0.06, 0.06, 0.34, 'z', 8);
}

/** Engine on an engine stand, a floor jack beside it. 2.2 × 1.2. */
const engineCorner = (): Item =>
  item(2.2, 1.2, 0, (f, x, z) => {
    const ex = x - 0.55;
    f.box('red', ex, z, 0, 0.9, 0.06, 0.08);
    f.box('red', ex - 0.4, z, 0, 0.08, 0.06, 0.8);
    f.box('red', ex - 0.4, z, 0.06, 0.08, 0.72, 0.08);
    f.box('red', ex - 0.25, z, 0.7, 0.3, 0.08, 0.08);
    f.box('metal', ex + 0.15, z, 0.45, 0.55, 0.45, 0.45);
    f.box('machineDark', ex + 0.15, z, 0.9, 0.5, 0.12, 0.34);
    f.cyl('steel', ex - 0.15, z, 0.66, 0.17, 0.04, 'x', 10);
    f.solid(ex, z, 1.0, 0.85, 1.02);
    jack(f, x + 0.6, z + 0.25);
    f.solid(x + 0.55, z + 0.25, 1.0, 0.36, 0.3);
    lines(f, ex, z, 1.0, 0.85, 0.2);
  });

const compressor = (): Item =>
  item(1.2, 0.55, 0.95, (f, x, z) => {
    f.cyl('red', x, z, 0.36, 0.25, 1.1, 'x', 12);
    f.box('black', x, z, 0, 0.9, 0.12, 0.4);
    f.cyl('machine', x - 0.25, z, 0.72, 0.1, 0.3, 'x', 8);
    f.box('machineDark', x + 0.2, z, 0.6, 0.28, 0.3, 0.24);
    f.box('red', x - 0.0, z + 0.15, 0.62, 0.2, 0.25, 0.08);
  });

function carpentry(f: F): void {
  const zone = perimeter(
    f,
    (i) => [lumberRack(), clampRack(), cupboard('wood'), lumberRack()][i % 4],
    0.75,
    (i) => [planer(), cupboard('wood'), offcutBin(), viceBench(1.8, 0.7, 2, 'wood')][i % 4],
    0.8,
  );
  // Machine corner (table saw with its sawdust) first, the bench rows after it.
  let x0 = zone.x0;
  if (zone.z1 - zone.z0 >= 1.5 && zone.x1 - zone.x0 >= 3.0) {
    const zc = (zone.z0 + zone.z1) / 2;
    if (alongLine(f, zc, zone.x0, zone.x0 + 2.0, () => tableSaw(), 1.3, 1)) x0 = zone.x0 + 1.9 + 1.3;
  }
  grid(f, { ...zone, x0 }, 1.8, 0.8, 1.2, 1.3, () => woodBench());
}

/** Joiner's bench: thick top, wooden vice on the front edge, tool well. */
const woodBench = (): Item =>
  item(1.8, 0.8, 0.9, (f, x, z) => {
    f.box('darkwood', x, z, 0.82, 1.8, 0.08, 0.8);
    for (const s of [-1, 1]) {
      f.box('wood', x + s * 0.78, z, 0, 0.08, 0.82, 0.7);
    }
    f.box('wood', x, z, 0.18, 1.5, 0.06, 0.7);
    f.box('wood', x - 0.6, z + 0.43, 0.6, 0.35, 0.26, 0.06);
    f.cyl('steel', x - 0.6, z + 0.49, 0.75, 0.012, 0.3, 'x', 6);
    if (f.rand() < 0.6) f.box('plywood', x + 0.2 + f.rand() * 0.3, z, 0.9, 0.6, 0.04, 0.18);
  });

const lumberRack = (): Item =>
  item(3.0, 0.7, 2.0, (f, x, z) => {
    const h = Math.min(2.1, f.H - 0.2);
    for (const px of [-1.4, 0, 1.4]) f.box('metal', x + px, z - 0.3, 0, 0.08, h, 0.08);
    for (let i = 0; i < 3; i += 1) {
      const y = 0.35 + i * ((h - 0.5) / 2);
      for (const px of [-1.4, 0, 1.4]) f.box('metal', x + px, z, y, 0.05, 0.05, 0.62);
      const n = 2 + Math.floor(f.rand() * 3);
      f.box(i === 1 ? 'plywood' : 'wood', x, z + 0.02, y + 0.05, 2.9, 0.035 * n, 0.55);
    }
  });

const clampRack = (): Item =>
  item(1.4, 0.25, 1.8, (f, x, z) => {
    f.box('plywood', x, z - 0.1, 0.9, 1.3, 0.9, 0.03);
    f.box('metal', x, z, 1.62, 1.3, 0.04, 0.2);
    for (let i = 0; i < 7; i += 1) {
      const cx = x - 0.55 + i * 0.18;
      f.box('steel', cx, z + 0.03, 1.05, 0.025, 0.6, 0.025);
      f.box(i % 2 ? 'orange' : 'red', cx, z + 0.05, 1.5, 0.05, 0.12, 0.12);
    }
  });

const planer = (): Item =>
  machine(1.3, 0.8, 1.1, (f, x, z) => {
    f.box('machine', x, z, 0, 0.9, 0.82, 0.7);
    f.box('steel', x, z, 0.82, 1.3, 0.05, 0.55);
    f.box('machine', x, z - 0.1, 0.87, 0.5, 0.2, 0.5);
    f.box('plywood', x + 0.5, z + 0.3, 0, 0.3, 0.04, 0.2);
  });

const offcutBin = (): Item =>
  item(0.8, 0.6, 0.7, (f, x, z) => {
    f.box('plywood', x, z, 0, 0.8, 0.6, 0.6);
    f.box('wood', x - 0.1, z, 0.6, 0.12, 0.25, 0.4);
    f.box('wood', x + 0.15, z, 0.6, 0.1, 0.18, 0.5);
  });

/** Table saw on a cabinet, with an outfeed table and a pile of sawdust. */
const tableSaw = (): Item =>
  machine(1.9, 1.2, 1.0, (f, x, z) => {
    f.box('machine', x - 0.35, z, 0, 0.6, 0.85, 0.6);
    f.box('steel', x - 0.35, z, 0.85, 1.0, 0.04, 0.85);
    f.cyl('steel', x - 0.35, z, 0.93, 0.13, 0.008, 'x', 12);
    f.box('orange', x - 0.35, z - 0.25, 0.89, 0.9, 0.05, 0.04);
    bench(f, x + 0.5, z, 0.75, 0.9, 'plywood');
    f.cyl('plywood', x - 0.4, z + 0.45, 0, 0.25, 0.1, 'y', 8, 0.05);
  });

function welding(f: F): void {
  // Booths (2.2 wide × 2.0 deep) only when they leave a walkable aisle in front.
  const booths = f.dep >= 2.0 + 1.3 + 0.5;
  const zone = perimeter(
    f,
    booths ? () => booth() : (i) => [gasRack(), anvil(), quenchTank(), cupboard('machine')][i % 4],
    booths ? 2.0 : 0.6,
    (i) => [gasRack(), anvil(), hoodBench(), quenchTank(), gasRack(), cupboard('machine')][i % 6],
    0.9,
  );
  if (!booths) return;
  grid(f, zone, 1.2, 0.8, 1.4, 1.4, (i) =>
    i % 3 === 2
      ? machine(0.5, 0.45, 0.75, (g, x, z) => weldSet(g, x, z), 0.2)
      : item(1.2, 0.8, 0.85, (g, x, z) => {
          bench(g, x, z, 1.2, 0.8, 'steel');
          stool(g, x, z + 0.75);
        }),
  );
}

/** Arc-welding transformer set with cable coil. */
function weldSet(f: F, x: number, z: number): void {
  f.box('blue', x, z, 0.06, 0.45, 0.66, 0.42);
  f.box('black', x, z + 0.21, 0.4, 0.3, 0.2, 0.012);
  f.cyl('black', x, z, 0.72, 0.15, 0.06, 'y', 10);
  for (const s of [-1, 1]) f.cyl('rubber', x + s * 0.15, z, 0.06, 0.06, 0.4, 'z', 8);
}

/** Welding booth: two side screens and a back screen, steel table, transformer, extraction hood. */
const booth = (): Item =>
  item(2.2, 2.0, 0, (f, x, z) => {
    const h = Math.min(1.85, f.H - 0.2);
    for (const s of [-1, 1]) {
      f.box('orange', x + s * 1.08, z + 0.02, 0.12, 0.03, h - 0.12, 1.9);
      f.box('metal', x + s * 1.08, z + 0.02, 0, 0.06, 0.12, 1.9);
      f.solid(x + s * 1.08, z + 0.02, 0.06, 1.9, h);
    }
    f.box('orange', x, z - 0.96, 0.12, 2.1, h - 0.12, 0.03);
    bench(f, x - 0.15, z - 0.35, 1.0, 0.7, 'steel');
    f.solid(x - 0.15, z - 0.35, 1.0, 0.7, 0.9);
    weldSet(f, x + 0.72, z - 0.65);
    f.solid(x + 0.72, z - 0.65, 0.45, 0.42, 0.8);
    if (f.H > 2.3) {
      f.cyl('metal', x - 0.15, z - 0.35, 1.55, 0.22, 0.25, 'y', 10, 0.07);
      f.cyl('metal', x - 0.15, z - 0.35, 1.8, 0.07, f.H - 1.85, 'y', 8);
    }
  });

/** Oxygen (black) and acetylene (maroon) cylinders chained to the wall. */
const gasRack = (): Item =>
  item(0.95, 0.35, 1.5, (f, x, z) => {
    for (let i = 0; i < 4; i += 1) {
      const cx = x - 0.34 + i * 0.23;
      const ox = i % 2 === 0;
      const h = ox ? 1.42 : 1.2;
      f.cyl(ox ? 'black' : 'red', cx, z, 0, 0.11, h, 'y', 10);
      f.cyl('metal', cx, z, h, 0.05, 0.1, 'y', 8, 0.03);
    }
    for (const y of [0.55, 1.0]) f.box('metal', x, z + 0.13, y, 0.9, 0.02, 0.015);
    f.box('metal', x, z - 0.16, 0.95, 0.95, 0.12, 0.02);
  });

const anvil = (): Item =>
  item(0.7, 0.5, 0.8, (f, x, z) => {
    f.cyl('darkwood', x, z, 0, 0.24, 0.5, 'y', 10);
    f.box('machineDark', x, z, 0.5, 0.34, 0.1, 0.24);
    f.box('machineDark', x, z, 0.6, 0.2, 0.1, 0.14);
    f.box('machineDark', x - 0.04, z, 0.7, 0.42, 0.1, 0.16);
    f.cyl('machineDark', x + 0.25, z, 0.76, 0.045, 0.14, 'x', 8);
  });

const quenchTank = (): Item =>
  item(1.0, 0.6, 0.6, (f, x, z) => {
    f.box('metal', x, z, 0, 1.0, 0.56, 0.6);
    f.box('water', x, z, 0.56, 0.92, 0.01, 0.52);
  });

/** Grinding/forge bench under a wall-mounted fume hood and duct. */
const hoodBench = (): Item =>
  item(1.4, 0.9, 0.9, (f, x, z) => {
    bench(f, x, z, 1.3, 0.8, 'steel');
    if (f.H > 2.4) {
      f.box('metal', x, z, 1.95, 1.3, 0.3, 0.85);
      f.box('metal', x, z - 0.2, 2.25, 0.35, f.H - 2.3, 0.35);
    }
  });

function sheetmetal(f: F): void {
  const zone = perimeter(
    f,
    (i) => [sheetRack(), brake(), roller(), cupboard('machine')][i % 4],
    0.95,
    (i) => [shear(), stakeBench(), cupboard('machine'), stakeBench()][i % 4],
    0.9,
  );
  grid(f, zone, 2.0, 0.9, 1.3, 1.3, () => stakeBench());
}

const sheetRack = (): Item =>
  item(2.5, 0.9, 1.6, (f, x, z) => {
    const h = Math.min(1.5, f.H - 0.3);
    f.box('metal', x, z, 0, 2.5, 0.1, 0.85);
    f.box('metal', x, z, 0.1, 2.4, h, 0.06);
    f.box('steel', x, z - 0.2, 0.1, 2.3, h - 0.2, 0.18);
    f.box('chrome', x - 0.1, z + 0.2, 0.1, 2.1, h - 0.35, 0.16);
  });

/** Bending brake: a long box machine with an apron and counterweight handles. */
const brake = (): Item =>
  machine(2.6, 0.85, 1.25, (f, x, z) => {
    f.box('machine', x, z - 0.1, 0, 2.4, 0.8, 0.6);
    f.box('machineDark', x, z - 0.1, 0.8, 2.5, 0.22, 0.4);
    f.box('steel', x, z + 0.22, 0.65, 2.4, 0.18, 0.06);
    for (const s of [-1, 1]) f.cyl('metal', x + s * 1.25, z + 0.25, 0.8, 0.03, 0.25, 'z', 6);
  });

const roller = (): Item =>
  machine(1.7, 0.7, 1.2, (f, x, z) => {
    for (const s of [-1, 1]) f.box('machine', x + s * 0.7, z, 0, 0.26, 1.05, 0.6);
    for (const [dz, y] of [[-0.08, 0.95], [0.08, 0.95], [0, 0.82]]) f.cyl('steel', x, z + dz, y, 0.05, 1.2, 'x', 10);
    f.cyl('machineDark', x - 0.84, z, 0.95, 0.18, 0.04, 'x', 10);
  });

const shear = (): Item =>
  machine(1.3, 0.6, 1.2, (f, x, z) => {
    f.box('machine', x - 0.2, z, 0, 0.35, 0.85, 0.5);
    f.box('steel', x - 0.2, z, 0.85, 0.45, 0.15, 0.2);
    f.cyl('metal', x + 0.25, z, 1.05, 0.02, 0.8, 'x', 6);
  });

/** Steel-topped bench with stakes and a mallet. */
const stakeBench = (): Item =>
  item(2.0, 0.9, 0.9, (f, x, z) => {
    bench(f, x, z, 2.0, 0.9, 'steel');
    for (const s of [-0.55, 0.55]) {
      f.box('machineDark', x + s, z + 0.3, 0.9, 0.08, 0.15, 0.08);
      f.cyl('machineDark', x + s, z + 0.3, 1.05, 0.05, 0.1, 'y', 8, 0.02);
    }
    f.box('wood', x, z - 0.1, 0.9, 0.3, 0.05, 0.05);
  });

function fitting(f: F): void {
  const zone = perimeter(
    f,
    (i) => [drillItem(), grinderItem(), surfacePlate(), cupboard('machine'), cupboard('blue')][i % 5],
    0.7,
    (i) => [cupboard('machine'), drillItem(), cupboard('blue'), grinderItem()][i % 4],
    0.65,
  );
  // Long double-sided fitting benches (up to 5.4 m) with a vice every 0.9 m on both sides.
  const span = zone.x1 - zone.x0;
  const w = Math.max(1.8, (span + 1.3) / Math.ceil((span + 1.3) / 6.7) - 1.3);
  grid(f, zone, w, 1.2, 1.3, 1.5, () => fittingBench(w));
}

const fittingBench = (w: number): Item =>
  item(w, 1.2, 0.9, (f, x, z) => {
    bench(f, x, z, w, 1.2, 'darkwood');
    if (w > 3) f.box('metal', x, z, 0, 0.06, 0.85, 1.1);
    f.box('metal', x, z, 0.9, w - 0.1, 0.32, 0.02);
    const n = Math.max(1, Math.floor(w / 0.9));
    for (let i = 0; i < n; i += 1) {
      const vx = x + (i - (n - 1) / 2) * (w / n);
      vice(f, vx, z + 0.48, 1);
      vice(f, vx, z - 0.48, -1);
    }
  });

function machining(f: F): void {
  const zone = perimeter(
    f,
    (i) => [millItem(), shaperItem(), drillItem(), grinderItem(), cupboard('machine')][i % 5],
    1.45,
    (i) => [latheItem(), cupboard('machine'), surfacePlate(), latheItem(), drillItem()][i % 5],
    0.95,
  );
  grid(f, zone, 2.1, 0.8, 1.0, 1.5, () => latheItem());
}

function plumbing(f: F): void {
  const zone = perimeter(
    f,
    (i) => (i === 0 ? pipeRack(Math.min(5.0, f.len - 0.5)) : [threadBench(), cupboard('blue'), pipeRack(3.0)][i % 3]),
    0.65,
    (i) => [waterTank(), threadBench(), cupboard('machine'), rack(1.5, 0.5, 1.8, 'parts')][i % 4],
    1.3,
  );
  grid(f, zone, 2.4, 0.8, 1.2, 1.4, () => trainingFrame());
}

/** Pipe rack: uprights with arms, long pipes laid along the wall. */
const pipeRack = (w: number): Item =>
  item(w, 0.65, 1.8, (f, x, z) => {
    const h = Math.min(1.8, f.H - 0.2);
    const n = Math.max(2, Math.ceil(w / 1.6) + 1);
    for (let i = 0; i < n; i += 1) f.box('metal', x - w / 2 + 0.05 + (i * (w - 0.1)) / (n - 1), z - 0.28, 0, 0.08, h, 0.08);
    for (let l = 0; l < 3; l += 1) {
      const y = 0.4 + l * ((h - 0.5) / 2);
      f.box('metal', x, z, y, w - 0.05, 0.04, 0.6);
      const mats: Mat[] = l === 0 ? ['steel', 'steel', 'metal'] : l === 1 ? ['white', 'white', 'white'] : ['metal', 'steel', 'white'];
      for (let p = 0; p < 3; p += 1) f.cyl(mats[p], x, z - 0.15 + p * 0.16, y + 0.1, 0.055 - p * 0.01, w - 0.15, 'x', 8);
    }
  });

/** Pipe threading bench: pipe vice and a threading machine. */
const threadBench = (): Item =>
  item(2.0, 0.75, 0.9, (f, x, z) => {
    bench(f, x, z, 2.0, 0.75, 'steel');
    f.box('blue', x - 0.6, z + 0.2, 0.9, 0.18, 0.2, 0.22);
    f.box('machine', x + 0.4, z - 0.05, 0.9, 0.8, 0.4, 0.45);
    f.cyl('steel', x + 0.1, z + 0.2, 1.1, 0.03, 1.4, 'x', 8);
  });

/** Black plastic water tank (the rooftop kind) on a steel stand. */
const waterTank = (): Item =>
  item(1.3, 1.3, 1.6, (f, x, z) => {
    const h = Math.min(1.25, f.H - 0.6);
    f.box('metal', x, z, 0, 1.2, 0.35, 1.2);
    f.cyl('black', x, z, 0.35, 0.6, h, 'y', 12);
    f.cyl('black', x, z, 0.35 + h, 0.25, 0.08, 'y', 10);
    f.cyl('white', x + 0.45, z + 0.45, 0.2, 0.025, 0.6, 'y', 6);
  });

/** Plumbing training frame: a panel with a sink, tap, WC and pipe runs on the +z face. */
const trainingFrame = (): Item =>
  item(2.4, 0.8, 0, (f, x, z) => {
    const h = Math.min(2.1, f.H - 0.3);
    f.box('plywood', x, z - 0.3, 0.1, 2.4, h - 0.1, 0.04);
    for (const s of [-1, 1]) f.box('metal', x + s * 1.12, z - 0.1, 0, 0.08, 0.1, 0.5);
    f.solid(x, z - 0.15, 2.4, 0.5, h);
    f.box('white', x - 0.55, z - 0.08, 0.75, 0.5, 0.15, 0.4);
    f.cyl('chrome', x - 0.55, z - 0.17, 1.0, 0.015, 0.14, 'z', 6);
    f.cyl('steel', x - 0.55, z - 0.26, 0.9, 0.015, 0.95, 'y', 6);
    f.cyl('white', x, z - 0.26, 1.75, 0.022, 2.2, 'x', 8);
    f.cyl('steel', x - 0.1, z - 0.26, 1.3, 0.016, 2.0, 'x', 6);
    f.box('red', x + 0.2, z - 0.25, 1.26, 0.06, 0.08, 0.06);
    f.box('white', x + 0.6, z - 0.2, 1.1, 0.45, 0.35, 0.16);
    f.box('white', x + 0.6, z + 0.05, 0, 0.36, 0.4, 0.5);
    f.solid(x + 0.6, z + 0.15, 0.36, 0.3, 0.4);
  });

function generic(f: F): void {
  const zone = perimeter(
    f,
    (i) => (i % 3 === 2 ? cupboard('machine') : viceBench(2.0, 0.75, 2)),
    0.75,
    (i) => [rack(1.8, 0.5, 1.9, 'parts'), viceBench(1.8, 0.7, 1), drillItem(), toolChest()][i % 4],
    0.75,
  );
  grid(f, zone, 2.0, 0.9, 1.3, 1.4, (i) => (i % 4 === 3 ? grinderItem() : viceBench(2.0, 0.9, 2, 'wood')));
}

const WORKSHOPS: Record<string, (f: F) => void> = {
  auto,
  carpentry,
  welding,
  sheetmetal,
  fitting,
  machining,
  plumbing,
  generic,
};

// ==================================================================== labs

function electricalLab(f: F): void {
  const fr = frontFrame(f);
  nearWall(fr, fr.len / 2, distPanel());
  const zone = perimeter(
    f,
    () => testBench(),
    0.75,
    () => testBench(),
    0.75,
    () => trainerBoard(),
    0.12,
  );
  grid(f, zone, 2.2, 0.9, 1.4, 1.4, () => machine(2.2, 0.9, 0.95, mgSet, 0.25));
}

/** Motor-generator set on a concrete plinth. */
function mgSet(f: F, x: number, z: number): void {
  f.box('concrete', x, z, 0, 2.2, 0.25, 0.9);
  f.box('machineDark', x, z, 0.25, 1.9, 0.06, 0.5);
  f.cyl('blue', x - 0.5, z, 0.6, 0.26, 0.65, 'x', 12);
  f.box('blue', x - 0.5, z, 0.31, 0.5, 0.1, 0.45);
  f.cyl('machine', x + 0.45, z, 0.6, 0.28, 0.7, 'x', 12);
  f.box('machine', x + 0.45, z, 0.31, 0.5, 0.1, 0.45);
  f.cyl('steel', x - 0.05, z, 0.6, 0.08, 0.22, 'x', 8);
  f.box('machineDark', x - 0.5, z, 0.85, 0.2, 0.12, 0.18);
  f.box('machineDark', x + 0.45, z, 0.87, 0.2, 0.12, 0.18);
}

/** Test bench with a vertical panel of meters, terminals and two stools. */
const testBench = (): Item =>
  item(1.8, 0.75, 0.9, (f, x, z) => {
    bench(f, x, z, 1.8, 0.75, 'darkwood');
    f.box('machineDark', x, z - 0.3, 0.9, 1.8, Math.min(0.65, f.H - 1.1), 0.05);
    for (let i = 0; i < 4; i += 1) f.box('screen', x + (i - 1.5) * 0.4, z - 0.27, 1.25, 0.18, 0.16, 0.02);
    f.box('red', x - 0.2, z - 0.27, 1.02, 1.1, 0.04, 0.02);
    f.box('black', x + 0.2, z - 0.27, 1.1, 1.1, 0.04, 0.02);
    for (const s of [-0.45, 0.45]) stool(f, x + s, z + 0.75);
  });

/** Wiring trainer board on a wall (switches, sockets, an MCB box, wires). */
const trainerBoard = (): Item =>
  item(1.3, 0.08, 2.0, (f, x, z) => {
    f.box('plywood', x, z - 0.02, 0.9, 1.25, 0.9, 0.03);
    f.box('white', x - 0.3, z + 0.01, 1.55, 0.35, 0.12, 0.03);
    f.box('black', x + 0.25, z + 0.01, 1.2, 0.4, 0.08, 0.03);
    f.box('white', x + 0.35, z + 0.01, 1.5, 0.22, 0.25, 0.04);
    f.box('red', x, z + 0.005, 1.4, 1.0, 0.012, 0.012);
    f.box('blue', x - 0.05, z + 0.005, 1.0, 0.012, 0.6, 0.012);
  });

const distPanel = (): Item =>
  item(1.2, 0.45, 2.0, (f, x, z) => {
    const h = Math.min(2.0, f.H - 0.2);
    f.box('machine', x, z, 0, 1.2, h, 0.45);
    f.box('machineDark', x, z + 0.224, 0.05, 0.012, h - 0.1, 0.005);
    f.box('red', x + 0.1, z + 0.23, h * 0.5, 0.03, 0.15, 0.03);
    f.box('yellow', x - 0.3, z + 0.226, h - 0.45, 0.3, 0.22, 0.005);
    f.box('red', x - 0.3, z + 0.229, h - 0.4, 0.2, 0.12, 0.005);
    f.box('rubber', x, z + 0.75, 0, 1.2, 0.01, 0.9);
  });

/** The frame on the room's front wall. */
function frontFrame(f: F): F {
  for (const w of ['z0', 'z1', 'x0', 'x1'] as const) {
    const g = f.wall(w);
    if (g.side === f.r.front) return g;
  }
  return f;
}

function civilLab(f: F): void {
  const zone = perimeter(
    f,
    (i) => [utm(), utmConsole(), ctm(), oven(), rack(1.5, 0.45, 1.8, 'samples')][i % 5],
    1.0,
    (i) => [curingTank(), rack(1.8, 0.45, 1.8, 'samples'), oven(), curingTank()][i % 4],
    0.9,
  );
  grid(f, zone, 1.8, 0.8, 1.3, 1.4, (i) => (i % 3 === 1 ? sieveShaker() : i % 3 === 2 ? slumpBench() : cubeBench()));
}

/** Universal testing machine: base, two columns, crossheads. */
const utm = (): Item =>
  machine(1.3, 1.0, 2.6, (f, x, z) => {
    const top = Math.min(2.7, f.H - 0.15);
    f.box('machine', x, z, 0, 1.2, 0.75, 0.8);
    for (const s of [-1, 1]) f.cyl('chrome', x + s * 0.45, z, 0.75, 0.06, top - 0.95, 'y', 10);
    f.box('machine', x, z, top - 0.25, 1.15, 0.25, 0.42);
    f.box('machine', x, z, (top + 0.75) / 2, 1.05, 0.22, 0.38);
    f.box('steel', x, z, 0.75, 0.3, 0.1, 0.3);
    f.box('steel', x, z, (top + 0.75) / 2 - 0.1, 0.18, 0.1, 0.18);
  });

const utmConsole = (): Item =>
  item(0.9, 0.6, 1.2, (f, x, z) => {
    f.box('machine', x, z, 0, 0.9, 0.85, 0.6);
    f.box('machineDark', x, z - 0.1, 0.85, 0.9, 0.4, 0.3);
    f.box('screen', x - 0.15, z + 0.06, 0.95, 0.35, 0.25, 0.02);
    f.cyl('white', x + 0.25, z + 0.06, 1.05, 0.08, 0.02, 'z', 12);
  });

/** Compression testing machine with its pump unit. */
const ctm = (): Item =>
  machine(1.2, 0.75, 1.7, (f, x, z) => {
    const cx = x - 0.2;
    f.box('blue', cx, z, 0, 0.7, 0.45, 0.6);
    f.box('blue', cx, z, 1.35, 0.7, 0.3, 0.6);
    for (const s of [-1, 1]) f.box('blue', cx + s * 0.3, z, 0.45, 0.1, 0.9, 0.5);
    f.cyl('steel', cx, z, 0.45, 0.16, 0.08, 'y', 12);
    f.cyl('steel', cx, z, 1.25, 0.16, 0.1, 'y', 12);
    f.box('concrete', cx, z, 0.53, 0.15, 0.15, 0.15);
    f.box('machine', x + 0.4, z, 0, 0.35, 0.9, 0.5);
    f.cyl('white', x + 0.4, z + 0.26, 1.0, 0.08, 0.02, 'z', 12);
  });

const oven = (): Item =>
  item(0.8, 0.65, 1.6, (f, x, z) => {
    f.box('metal', x, z, 0, 0.75, 0.6, 0.6);
    f.box('white', x, z, 0.6, 0.8, 0.9, 0.65);
    f.box('black', x, z + 0.326, 0.65, 0.01, 0.8, 0.005);
    f.box('screen', x + 0.25, z + 0.33, 1.35, 0.15, 0.06, 0.01);
  });

const curingTank = (): Item =>
  item(2.0, 0.9, 0.9, (f, x, z) => {
    f.box('tile', x, z, 0, 2.0, 0.85, 0.9);
    f.box('water', x, z, 0.85, 1.85, 0.01, 0.75);
    for (let i = 0; i < 3; i += 1) f.box('concrete', x - 0.5 + i * 0.4, z, 0.8, 0.15, 0.06, 0.15);
  });

const cubeBench = (): Item =>
  item(1.8, 0.8, 0.9, (f, x, z) => {
    bench(f, x, z, 1.8, 0.8, 'steel');
    for (let i = 0; i < 6; i += 1) f.box(i < 4 ? 'metal' : 'concrete', x - 0.6 + i * 0.24, z + (i % 2 ? 0.15 : -0.15), 0.9, 0.17, 0.15, 0.17);
    f.cyl('steel', x + 0.6, z, 0.9, 0.012, 0.6, 'x', 6);
  });

const sieveShaker = (): Item =>
  machine(0.7, 0.7, 1.1, (f, x, z) => {
    f.box('machine', x, z, 0, 0.55, 0.3, 0.55);
    for (let i = 0; i < 5; i += 1) f.cyl(i % 2 ? 'chrome' : 'steel', x, z, 0.32 + i * 0.07, 0.16, 0.065, 'y', 12);
    for (const s of [-1, 1]) f.cyl('steel', x + s * 0.22, z, 0.3, 0.012, 0.5, 'y', 6);
    f.box('steel', x, z, 0.8, 0.5, 0.04, 0.06);
  }, 0.2);

/** Bench with a slump cone, base plate and tamping rod; a mixing tray on the floor. */
const slumpBench = (): Item =>
  item(1.8, 0.8, 0.9, (f, x, z) => {
    bench(f, x, z, 1.8, 0.8, 'steel');
    f.box('metal', x - 0.4, z, 0.9, 0.5, 0.01, 0.5);
    f.cyl('metal', x - 0.4, z, 0.91, 0.1, 0.3, 'y', 12, 0.05);
    f.cyl('steel', x + 0.3, z + 0.1, 0.92, 0.008, 0.6, 'x', 6);
    f.box('concrete', x + 0.4, z - 0.1, 0.9, 0.4, 0.06, 0.3);
  });

function maker(f: F): void {
  const fr = frontFrame(f);
  nearWall(fr, fr.len / 2, whiteboard(Math.min(2.4, fr.len - 1.0)));
  const zone = perimeter(
    f,
    (i) => [printerBench(), rack(1.0, 0.45, 1.9, 'parts'), printerBench(), robotBench()][i % 4],
    0.7,
    (i) => [rack(1.0, 0.45, 1.9, 'parts'), robotBench(), rack(1.0, 0.45, 1.9, 'cartons')][i % 3],
    0.7,
  );
  const big = zone.z1 - zone.z0 >= 2.2 && zone.x1 - zone.x0 >= 2.4;
  const w = big ? 2.4 : 1.6;
  const d = big ? 1.2 : 0.8;
  grid(f, zone, w, d, 1.3, 2.0, () => labTable(w, d));
}

const whiteboard = (w: number): Item =>
  item(Math.max(0.8, w), 0.08, 0, (f, x, z) => {
    if (f.H < 2.2) return;
    const bw = Math.max(0.8, w);
    f.box('board', x, z - 0.02, 0.9, bw, 1.2, 0.03);
    f.box('metal', x, z, 0.88, bw, 0.03, 0.08);
    f.solid(x, z - 0.02, bw, 0.05, 2.1);
  });

/** Lab table with laptops and monitors, chairs along both long sides. */
const labTable = (w: number, d: number): Item =>
  item(w, d, 0.78, (f, x, z) => {
    f.box('white', x, z, 0.72, w, 0.04, d);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box('metal', x + sx * (w / 2 - 0.06), z + sz * (d / 2 - 0.06), 0, 0.05, 0.72, 0.05);
    const n = Math.max(1, Math.floor(w / 1.1));
    for (let i = 0; i < n; i += 1) {
      const sx = x + (i - (n - 1) / 2) * (w / n);
      for (const s of [-1, 1]) {
        if (d < 1 && s < 0) continue;
        const sz = z + s * (d / 2 - 0.25);
        if (f.rand() < 0.55) {
          f.box('black', sx, sz, 0.76, 0.34, 0.02, 0.24);
          f.box('screen', sx, sz - s * 0.12, 0.78, 0.33, 0.22, 0.01);
        } else {
          f.box('black', sx, sz - s * 0.08, 0.76, 0.06, 0.2, 0.06);
          f.box('screen', sx, sz - s * 0.1, 0.92, 0.55, 0.32, 0.02);
        }
        chair(f, sx, z + s * (d / 2 + 0.35), s);
      }
    }
  });

/** Bench with two 3D printers and a spool. */
const printerBench = (): Item =>
  item(1.8, 0.7, 0.9, (f, x, z) => {
    bench(f, x, z, 1.8, 0.7, 'plywood');
    for (const s of [-0.45, 0.45]) printer3d(f, x + s, z, 0.9);
  });

function printer3d(f: F, x: number, z: number, y: number): void {
  f.box('black', x, z, y, 0.44, 0.08, 0.44);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box('black', x + sx * 0.2, z + sz * 0.2, y + 0.08, 0.03, 0.42, 0.03);
  f.box('black', x, z, y + 0.5, 0.44, 0.04, 0.44);
  f.box('metal', x, z, y + 0.16, 0.3, 0.012, 0.3);
  f.box(f.pick<Mat>(['orange', 'red', 'white', 'blue']), x, z, y + 0.172, 0.08, 0.07, 0.08);
  f.cyl('orange', x + 0.1, z - 0.15, y + 0.62, 0.09, 0.06, 'x', 10);
}

/** Bench with a small robot arm and a parts box. */
const robotBench = (): Item =>
  item(1.6, 0.7, 0.9, (f, x, z) => {
    bench(f, x, z, 1.6, 0.7, 'plywood');
    const y = 0.9;
    const ax = x - 0.3;
    f.cyl('orange', ax, z, y, 0.12, 0.08, 'y', 12);
    f.cyl('orange', ax, z, y + 0.08, 0.08, 0.14, 'y', 10);
    f.cyl('white', ax, z, y + 0.22, 0.04, 0.34, 'y', 8);
    f.cyl('orange', ax, z, y + 0.56, 0.055, 0.13, 'z', 10);
    f.cyl('white', ax + 0.16, z, y + 0.56, 0.035, 0.3, 'x', 8);
    f.box('black', ax + 0.33, z, y + 0.5, 0.06, 0.1, 0.08);
    for (const s of [-1, 1]) f.box('metal', ax + 0.38, z + s * 0.03, y + 0.44, 0.06, 0.07, 0.012);
    f.box('blue', x + 0.45, z, y, 0.4, 0.12, 0.3);
    f.box('green', x + 0.1, z + 0.1, y, 0.16, 0.015, 0.1);
  });

// ==================================================================== power house

function power(f: F): void {
  // Switchgear along the main wall, a rubber mat in front of it.
  const panels = Math.max(1, Math.min(24, Math.floor((f.len - 1.0) / 0.8)));
  const n = alongWall(f, (i) => (i < panels ? switchgear() : null), 0, panels, 0.4);
  for (let x = 0.65; x + 0.25 < Math.min(f.len, 0.4 + n * 0.8 + 1.2); x += 0.5) {
    if (f.free(x, 1.1, 0.1)) f.box('rubber', x, 1.1, 0, 0.5, 0.012, 0.9);
  }
  // Transformers in their fenced bay at one end of the far wall, generator sets along the rest.
  const far = f.wall('z1');
  if (f.dep >= 0.65 + 1.3 + 3.2) nearWall(far, far.len - 3.0, transformerBay(2)) || nearWall(far, far.len - 2.0, transformerBay(1));
  if (f.dep >= 0.65 + 1.3 + 1.2) alongWall(far, () => dgSet(), 1.4, Math.max(1, Math.floor(f.len / 12)), 0.6);
  // Battery racks and cupboards on the end walls, an operator's desk when there is room.
  if (f.len >= 9 && f.dep >= 4.5) {
    for (const w of ['x0', 'x1'] as const) endWall(f, w, 0.65 + 1.3, f.dep - 1.3 - 1.25, (i) => [batteryRack(), cupboard('machine')][i % 2], 0.3, 3);
    if (f.dep >= 0.65 + 1.3 + 0.8 + 1.3 + 1.25 + 1.3) alongLine(f, 0.65 + 1.3 + 1.2, 2.0, f.len - 2.0, () => controlDesk(), 1.3, 1);
  }
  cableTrays(f);
}

/** Two-tier rack of black lead-acid cells. */
const batteryRack = (): Item =>
  item(1.6, 0.5, 1.1, (f, x, z) => {
    for (const sx of [-1, 1]) f.box('metal', x + sx * 0.78, z, 0, 0.04, 1.05, 0.5);
    for (const y of [0.1, 0.6]) {
      f.box('metal', x, z, y, 1.6, 0.03, 0.5);
      f.box('black', x, z, y + 0.03, 1.45, 0.3, 0.32);
      f.box('red', x, z + 0.1, y + 0.33, 1.4, 0.025, 0.03);
    }
  });

/** Operator's desk with a SCADA screen and a chair. */
const controlDesk = (): Item =>
  item(1.6, 0.8, 0.78, (f, x, z) => {
    f.box('machine', x, z, 0, 1.6, 0.74, 0.8);
    f.box('black', x, z - 0.25, 0.74, 0.08, 0.15, 0.08);
    f.box('screen', x, z - 0.27, 0.86, 0.9, 0.45, 0.03);
    f.box('black', x + 0.1, z + 0.1, 0.74, 0.45, 0.02, 0.15);
    chair(f, x, z + 0.75, 1);
  });

/** Switchgear cabinet: meters, indicator lamps, a danger plate. */
const switchgear = (): Item =>
  item(0.8, 0.6, 2.1, (f, x, z) => {
    const h = Math.min(2.1, f.H - 0.15);
    f.box('machine', x, z, 0, 0.78, h, 0.6);
    f.box('machineDark', x, z + 0.3, 0.1, 0.7, 0.012, 0.004);
    f.box('machineDark', x, z + 0.3, h * 0.55, 0.7, 0.012, 0.004);
    for (const s of [-1, 1]) f.cyl('white', x + s * 0.17, z + 0.31, h * 0.75, 0.07, 0.02, 'z', 12);
    f.box(f.pick<Mat>(['red', 'green']), x, z + 0.305, h * 0.65, 0.3, 0.03, 0.012);
    f.box('black', x + 0.25, z + 0.31, h * 0.45, 0.04, 0.16, 0.02);
    f.box('red', x - 0.2, z + 0.302, h * 0.3, 0.22, 0.15, 0.004);
  });

/** One or two transformers inside a chain-link fence with danger plates. */
const transformerBay = (count: number): Item => {
  const w = count === 2 ? 5.0 : 2.8;
  return item(w, 3.2, 0, (f, x, z) => {
    for (let i = 0; i < count; i += 1) transformer(f, x + (count === 2 ? (i - 0.5) * 2.2 : 0), z - 0.1);
    const fh = Math.min(2.0, f.H - 0.2);
    const zf = z + 1.55; // fence front
    // Chain-link fence: posts and rails with a see-through infill. Front with a gate, two
    // sides; the wall closes the back.
    for (const s of [-1, 1]) {
      const xs = x + s * (w / 2 - 0.03);
      for (const y of [0.05, fh - 0.05]) f.box('metal', xs, z, y, 0.04, 0.04, 3.1);
      f.box('glass', xs, z, 0.1, 0.01, fh - 0.15, 3.1);
      f.box('metal', xs, z, 0, 0.05, fh, 0.05);
      f.solid(xs, z, 0.05, 3.1, fh);
    }
    const gate = 1.0;
    const seg = (w - gate) / 2;
    for (const s of [-1, 1]) {
      const sx = x + s * (gate / 2 + seg / 2);
      for (const y of [0.05, fh * 0.5, fh - 0.05]) f.box('metal', sx, zf, y, seg, 0.04, 0.04);
      f.box('glass', sx, zf, 0.1, seg, fh - 0.15, 0.01);
      f.box('metal', sx + s * (seg / 2 - 0.03), zf, 0, 0.05, fh, 0.05);
      f.solid(sx, zf, seg, 0.06, fh);
      f.box('red', sx, zf + 0.03, 1.2, 0.35, 0.25, 0.01);
      f.box('yellow', sx, zf + 0.04, 1.25, 0.25, 0.12, 0.006);
    }
    f.box('metal', x, zf, 0.05, gate, fh - 0.1, 0.03);
    f.solid(x, zf, gate, 0.06, fh);
  });
};

function transformer(f: F, x: number, z: number): void {
  const H = f.H;
  const tank = Math.min(1.5, H - 1.0);
  f.box('machineDark', x, z, 0, 1.5, 0.12, 0.9);
  f.box('machine', x, z, 0.12, 1.2, tank, 0.85);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i += 1) f.box('machineDark', x - 0.35 + i * 0.35, z + s * 0.55, 0.25, 0.08, tank - 0.3, 0.25);
  const top = 0.12 + tank;
  if (H - top > 0.6) {
    f.cyl('machine', x - 0.3, z - 0.25, top + 0.25, 0.17, 0.8, 'x', 10);
    f.box('machine', x - 0.3, z - 0.25, top, 0.06, 0.1, 0.06);
    for (let i = 0; i < 3; i += 1) f.cyl('cream', x - 0.35 + i * 0.35, z + 0.2, top, 0.06, Math.min(0.45, H - top - 0.1), 'y', 8, 0.03);
  }
  f.solid(x, z, 1.5, 1.2, top + 0.3);
}

/** Diesel generator: skid, engine, alternator, radiator, silencer and exhaust stack. */
const dgSet = (): Item =>
  item(3.2, 1.2, 1.5, (f, x, z) => {
    f.box('machineDark', x, z, 0, 3.2, 0.2, 1.1);
    f.box('yellow', x + 0.3, z, 0.2, 1.3, 0.9, 0.8);
    f.cyl('yellow', x - 0.85, z, 0.62, 0.4, 0.8, 'x', 12);
    f.box('machine', x - 0.85, z, 1.02, 0.4, 0.3, 0.3);
    f.box('machineDark', x + 1.4, z, 0.2, 0.22, 1.25, 1.05);
    f.box('black', x + 1.52, z, 0.3, 0.02, 1.05, 0.9);
    f.cyl('metal', x + 0.2, z - 0.3, 1.25, 0.15, 0.9, 'x', 10);
    if (f.H > 1.5) f.cyl('metal', x - 0.3, z - 0.3, 1.25, 0.08, f.H - 1.3, 'y', 8);
    f.box('red', x + 1.2, z + 0.4, 0.2, 0.35, 0.3, 0.25);
    lines(f, x, z, 3.2, 1.2, 0.3);
  });

/** Cable trays overhead, along the room and one across it, hung from the roof or ceiling. */
function cableTrays(f: F): void {
  if (f.H < 2.6) return;
  const y = Math.min(f.H - 0.45, 3.2);
  const hang = f.H - y - 0.06;
  const L = f.len - 0.3;
  f.box('metal', f.len / 2, 0.7, y, L, 0.06, 0.3);
  f.box('black', f.len / 2, 0.7, y + 0.06, L - 0.1, 0.05, 0.22);
  for (let x = 0.6; x < f.len - 0.4; x += 2.4) f.box('metal', x, 0.7, y + 0.06, 0.02, hang, 0.02);
  if (f.dep > 3) {
    const xa = f.len - 1.4;
    f.box('metal', xa, (0.85 + f.dep - 0.2) / 2, y, 0.3, 0.06, f.dep - 1.05);
    f.box('black', xa, (0.85 + f.dep - 0.2) / 2, y + 0.06, 0.22, 0.05, f.dep - 1.15);
  }
}

// ==================================================================== garages and stores

function garage(f: F, sub: string): void {
  if (sub === 'carwash') carwash(f);
  else bikes(f);
}

function carwash(f: F): void {
  const zone = perimeter(
    f,
    (i) => [hoseReel(), rack(1.2, 0.4, 1.8, 'bottles'), pressureWasher(), hoseReel()][i % 4],
    0.6,
    (i) => [rack(1.2, 0.4, 1.8, 'bottles'), drums(1), rack(1.2, 0.4, 1.8, 'cartons')][i % 3],
    0.62,
  );
  // Wash bays (car, grates, wet floor) in rows; a cramped room gets one car in the middle.
  if (!grid(f, zone, 4.6, 2.7, 1.4, 1.6, () => washBay())) alongLine(f, f.dep / 2, 0.3, f.len - 0.3, () => washBay(), 0.4, 1, 0);
  for (let i = 0; i < 4; i += 1) {
    const x = 0.6 + f.rand() * (f.len - 1.2);
    const z = 1.2 + f.rand() * Math.max(0.1, f.dep - 1.8);
    if (f.free(x, z, 0.35)) f.cyl(f.pick<Mat>(['blue', 'red', 'orange']), x, z, 0, 0.13, 0.3, 'y', 10, 0.16);
  }
}

/** Car in a wash bay with a drain grate strip each side and a wet patch. */
const washBay = (): Item =>
  item(4.6, 2.7, 0, (f, x, z) => {
    f.box('water', x, z, 0, 4.4, 0.004, 2.5);
    for (const s of [-1, 1]) {
      f.box('metal', x, z + s * 1.28, 0, 4.6, 0.012, 0.16);
      f.box('black', x, z + s * 1.28, 0.012, 4.5, 0.002, 0.1);
    }
    car(f, x, z, 0, f.pick(CAR_COLOURS));
    f.solid(x, z, 4.1, 1.72, 1.44);
  });

const hoseReel = (): Item =>
  item(0.7, 0.35, 1.4, (f, x, z) => {
    f.box('metal', x, z - 0.15, 0.8, 0.5, 0.6, 0.03);
    f.cyl('red', x, z, 1.1, 0.28, 0.2, 'z', 12);
    f.cyl('black', x, z, 1.1, 0.24, 0.22, 'z', 12);
    f.cyl('black', x + 0.2, z + 0.05, 0.4, 0.015, 0.75, 'y', 6);
  });

const pressureWasher = (): Item =>
  item(0.6, 0.5, 0.9, (f, x, z) => {
    f.box('yellow', x, z, 0.12, 0.55, 0.6, 0.45);
    for (const s of [-1, 1]) f.cyl('rubber', x - 0.15, z + s * 0.2, 0.12, 0.12, 0.06, 'z', 10);
    f.cyl('black', x + 0.1, z, 0.72, 0.012, 0.4, 'x', 6);
  });

function bikes(f: F): void {
  const bikeRow = (): Item =>
    item(0.85, 2.0, 1.0, (g, x, z) => {
      const turn = g.rand() < 0.5 ? 1 : 3;
      motorbike(g.sub(x, z, turn), g.pick<Mat>(['red', 'blue', 'black', 'black', 'white', 'machine', 'orange']));
    });
  // Bays along the walls; rows back-to-back down the middle when the room is deep enough.
  const zone = perimeter(f, () => bikeRow(), 2.0, () => bikeRow(), 2.0, () => bikeRow(), 2.0, 1.6);
  if (zone.z1 - zone.z0 >= 4.0) {
    grid(f, zone, 0.85, 4.0, 0.02, 1.8, () =>
      item(0.85, 4.0, 1.0, (g, x, z) => {
        for (const s of [-1, 1]) {
          const turn = s > 0 ? (g.rand() < 0.7 ? 1 : 3) : g.rand() < 0.7 ? 3 : 1;
          motorbike(g.sub(x, z + s * 1.0, turn), g.pick<Mat>(['red', 'blue', 'black', 'black', 'white', 'machine', 'orange']));
        }
      }),
    );
  }
  // Painted bay lines on the floor along the main wall.
  for (let x = 0.5; x < f.len - 0.4; x += 0.85) {
    if (f.free(x, 2.15, 0.05)) f.box('white', x, 2.15, 0, 0.05, 0.006, 0.3);
  }
}

function store(f: F): void {
  deskByDoor(f);
  const dr = f.wall('x1');
  alongWall(dr, () => drums(2), 0.2, 1, 0.3);
  const zone = perimeter(f, () => rack(2.0, 0.5, 2.1, 'cartons'), 0.5, () => rack(2.0, 0.5, 2.1, 'cartons'), 0.5, () => rack(1.6, 0.5, 2.1, 'cartons'), 0.5, 1.2);
  // Back-to-back rack runs, with a cross aisle every four bays.
  const runs = Math.floor((zone.z1 - zone.z0 + 1.2) / (1.0 + 1.2));
  if (runs < 1 || zone.x1 - zone.x0 < 2.0) return;
  const z0 = (zone.z0 + zone.z1) / 2 - (runs * 2.2 - 1.2) / 2 + 0.5;
  for (let j = 0; j < runs; j += 1) {
    const z = z0 + j * 2.2;
    let x = zone.x0;
    let k = 0;
    while (x + 2.0 <= zone.x1) {
      const cx = x + 1.0;
      if (f.fits(cx, z, 2.0, 1.0)) {
        put(f, rack(2.0, 1.0, 2.1, 'cartons'), cx, z);
        k += 1;
        x += 2.02;
        if (k % 4 === 0) x += 1.2;
      } else x += 0.25;
    }
  }
}

/** A storekeeper's desk and chair beside the first door. */
function deskByDoor(f: F): void {
  const d = f.r.doors[0];
  if (!d) return;
  const s = doorSide(f.r, d);
  for (const w of ['z0', 'z1', 'x0', 'x1'] as const) {
    const g = f.wall(w);
    if (g.side !== s) continue;
    const [dx] = g.local(d.u, d.v);
    for (const off of [1.6, -1.6, 2.2, -2.2, 3.0, -3.0]) {
      const x = dx + off;
      if (x - 0.6 < 0.03 || x + 0.6 > g.len - 0.03) continue;
      if (g.fits(x, 0.35, 1.2, 0.6)) {
        g.box('darkwood', x, 0.35, 0.72, 1.2, 0.04, 0.6);
        for (const sx of [-1, 1]) g.box('darkwood', x + sx * 0.56, 0.35, 0, 0.05, 0.72, 0.55);
        g.box('paper', x - 0.2, 0.35, 0.76, 0.35, 0.03, 0.25);
        g.box('books', x + 0.35, 0.3, 0.76, 0.3, 0.06, 0.22);
        g.solid(x, 0.35, 1.2, 0.6, 0.76);
        chair(g, x, 1.0, 1);
        return;
      }
    }
  }
}

// ==================================================================== exports

const run =
  (fn: (f: F) => void): Furnisher =>
  (room, kit) => {
    const f = mainFrame(room, guard(room, kit));
    fn(f);
    lights(f);
  };

export const FURNISH: Record<string, Furnisher> = {
  workshop: (room, kit) => run((f) => (WORKSHOPS[room.sub ?? 'generic'] ?? generic)(f))(room, kit),
  electricalLab: run(electricalLab),
  civilLab: run(civilLab),
  maker: run(maker),
  power: run(power),
  garage: (room, kit) => run((f) => garage(f, room.sub ?? 'bikes'))(room, kit),
  store: run(store),
};
