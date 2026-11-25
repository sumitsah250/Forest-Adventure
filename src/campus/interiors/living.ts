// Room furnishers (living): hostel rooms, staff quarters, washrooms, the guard room, the changing
// room, the stationery shop, the precision-farming polyhouse and stray sheds. See kit.ts for the
// Room / Kit API.
//
// Layouts are written in frames. A wall frame has x running along a wall (0 .. len) and z pointing
// from that wall into the room (0 .. depth), so "a cot against wall S at x" is one call whatever the
// room's size or orientation. Pieces (cot, chair, almirah ...) are drawn centred on their own
// frame's origin with their front towards +z. Frames only turn in quarter turns, so every box stays
// axis-aligned and every footprint is exact; nothing is ever drawn outside the clear rectangle.

import type { Furnisher, Kit, Mat, Room, Side } from './kit.ts';

const EPS = 0.004;
const SIDES: Side[] = ['u0', 'u1', 'v0', 'v1'];

type Turn = 0 | 1 | 2 | 3;
type Pref = 'start' | 'end' | 'mid' | number;
interface Solid { u0: number; u1: number; v0: number; v1: number; top: number }
interface Hung { side: Side; a0: number; a1: number; y0: number; y1: number }
interface Ctx { solids: Solid[]; hung: Hung[]; paths: Paths }
interface BoxO { solid?: boolean; rot?: number }
interface CylO { ax?: 'y' | 'x' | 'z'; seg?: number; r2?: number; solid?: boolean }

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
function pick<T>(R: () => number, a: readonly T[]): T {
  return a[Math.min(a.length - 1, Math.floor(R() * a.length))];
}

// ==================================================================== walkability

/** Walker radius used for the walkability grid (the player capsule is ~0.35; walls sit 0.1 outside the rectangle). */
const WALK_R = 0.3;

/**
 * Which floor cells a walker can reach from the doors. Every placement asks `keeps` first, so no
 * item ever cuts off a part of the room (bar a sliver under 0.12 m2) from the doorways.
 */
class Paths {
  readonly g: number;
  readonly nu: number;
  readonly nv: number;
  readonly cu0: number;
  readonly cv0: number;
  readonly block: Uint8Array;
  readonly seeds: number[] = [];
  reach: Uint8Array | null = null;

  constructor(r: Room) {
    const lu = r.u1 - r.u0;
    const lv = r.v1 - r.v0;
    this.g = clamp(Math.sqrt(lu * lv) / 30, 0.12, 0.3);
    this.nu = Math.max(1, Math.floor(lu / this.g));
    this.nv = Math.max(1, Math.floor(lv / this.g));
    this.cu0 = r.u0 + (lu - this.nu * this.g) / 2;
    this.cv0 = r.v0 + (lv - this.nv * this.g) / 2;
    this.block = new Uint8Array(this.nu * this.nv);
    const edge = WALK_R - 0.1;
    for (let k = 0; k < this.block.length; k += 1) {
      const [u, v] = this.centre(k);
      if (u < r.u0 + edge || u > r.u1 - edge || v < r.v0 + edge || v > r.v1 - edge) this.block[k] = 1;
    }
    for (const d of r.doors) {
      let u = clamp(d.u, r.u0, r.u1);
      let v = clamp(d.v, r.v0, r.v1);
      const e = [u - r.u0, r.u1 - u, v - r.v0, r.v1 - v];
      const m = e.indexOf(Math.min(...e));
      if (m === 0) u += 0.45;
      else if (m === 1) u -= 0.45;
      else if (m === 2) v += 0.45;
      else v -= 0.45;
      for (let k = 0; k < this.block.length; k += 1) {
        const [cu, cv] = this.centre(k);
        if (!this.block[k] && Math.hypot(cu - u, cv - v) < 0.45) this.seeds.push(k);
      }
    }
  }

  centre(k: number): [number, number] {
    return [this.cu0 + (Math.floor(k / this.nv) + 0.5) * this.g, this.cv0 + ((k % this.nv) + 0.5) * this.g];
  }

  /** True when cell k is within the walker radius of the rectangle. */
  near(k: number, s: Solid): boolean {
    const [u, v] = this.centre(k);
    const du = Math.max(s.u0 - u, 0, u - s.u1);
    const dv = Math.max(s.v0 - v, 0, v - s.v1);
    return du * du + dv * dv < WALK_R * WALK_R;
  }

  add(s: Solid): void {
    const { g, nu, nv } = this;
    const i0 = clamp(Math.floor((s.u0 - WALK_R - this.cu0) / g), 0, nu - 1);
    const i1 = clamp(Math.ceil((s.u1 + WALK_R - this.cu0) / g), 0, nu - 1);
    const j0 = clamp(Math.floor((s.v0 - WALK_R - this.cv0) / g), 0, nv - 1);
    const j1 = clamp(Math.ceil((s.v1 + WALK_R - this.cv0) / g), 0, nv - 1);
    for (let i = i0; i <= i1; i += 1) for (let j = j0; j <= j1; j += 1) if (this.near(i * nv + j, s)) this.block[i * nv + j] = 1;
    this.reach = null;
  }

  flood(extra: Solid | null): Uint8Array {
    const { nu, nv } = this;
    const seen = new Uint8Array(nu * nv);
    const stack: number[] = [];
    const go = (k: number) => {
      if (seen[k] || this.block[k] || (extra && this.near(k, extra))) return;
      seen[k] = 1;
      stack.push(k);
    };
    for (const k of this.seeds) go(k);
    while (stack.length) {
      const k = stack.pop() as number;
      const i = Math.floor(k / nv);
      const j = k % nv;
      if (i > 0) go(k - nv);
      if (i < nu - 1) go(k + nv);
      if (j > 0) go(k - 1);
      if (j < nv - 1) go(k + 1);
    }
    return seen;
  }

  /** Would a new solid here leave everything that is reachable now still reachable? */
  keeps(s: Solid): boolean {
    if (!this.seeds.length) return true;
    if (!this.reach) this.reach = this.flood(null);
    const before = this.reach;
    const after = this.flood(s);
    let lost = 0;
    for (let k = 0; k < before.length; k += 1) if (before[k] && !after[k] && !this.near(k, s)) lost += 1;
    return lost * this.g * this.g <= 0.12;
  }
}

// ==================================================================== frames

/** An axis-aligned frame in the room: local (x, z) maps to (u, v) through two unit axes. */
class F {
  readonly r: Room;
  readonly k: Kit;
  readonly ctx: Ctx;
  readonly ou: number;
  readonly ov: number;
  readonly xu: number;
  readonly xv: number;
  readonly zu: number;
  readonly zv: number;

  constructor(r: Room, k: Kit, ctx: Ctx, ou: number, ov: number, xu: number, xv: number, zu: number, zv: number) {
    this.r = r;
    this.k = k;
    this.ctx = ctx;
    this.ou = ou;
    this.ov = ov;
    this.xu = xu;
    this.xv = xv;
    this.zu = zu;
    this.zv = zv;
  }

  uv(x: number, z: number): [number, number] {
    return [this.ou + x * this.xu + z * this.zu, this.ov + x * this.xv + z * this.zv];
  }

  /** Room point back to local (x, z). */
  local(u: number, v: number): [number, number] {
    const du = u - this.ou;
    const dv = v - this.ov;
    return [du * this.xu + dv * this.xv, du * this.zu + dv * this.zv];
  }

  /** Room-axis size (along u, along v) of a wx (along x) × dz (along z) footprint. */
  size(wx: number, dz: number): [number, number] {
    return this.xu !== 0 ? [wx, dz] : [dz, wx];
  }

  inside(u: number, v: number, w: number, d: number): boolean {
    const r = this.r;
    return u - w / 2 >= r.u0 - EPS && u + w / 2 <= r.u1 + EPS && v - d / 2 >= r.v0 - EPS && v + d / 2 <= r.v1 + EPS;
  }

  /** True when a solid placed here (taller than `above`) overlaps the footprint. */
  hits(u: number, v: number, w: number, d: number, above = -1): boolean {
    const m = 0.01;
    return this.ctx.solids.some(
      (s) => s.top > above && u - w / 2 < s.u1 - m && u + w / 2 > s.u0 + m && v - d / 2 < s.v1 - m && v + d / 2 > s.v0 + m,
    );
  }

  /** The footprint fits on the floor, clear of doorways and solids. */
  fits(x: number, z: number, wx: number, dz: number): boolean {
    const [u, v] = this.uv(x, z);
    const [w, d] = this.size(wx, dz);
    return this.inside(u, v, w, d) && this.r.fits(u, v, w, d);
  }

  /** The footprint is inside the room and clear of solids (doorways allowed): a walkway. */
  open(x: number, z: number, wx: number, dz: number): boolean {
    const [u, v] = this.uv(x, z);
    const [w, d] = this.size(wx, dz);
    return this.inside(u, v, w, d) && !this.hits(u, v, w, d);
  }

  /** Placing a solid footprint here keeps the room walkable from its doors. */
  keeps(x: number, z: number, wx: number, dz: number): boolean {
    const [u, v] = this.uv(x, z);
    const [w, d] = this.size(wx, dz);
    return this.ctx.paths.keeps({ u0: u - w / 2, u1: u + w / 2, v0: v - d / 2, v1: v + d / 2, top: 0 });
  }

  /** fits() and keeps(). */
  ok(x: number, z: number, wx: number, dz: number): boolean {
    return this.fits(x, z, wx, dz) && this.keeps(x, z, wx, dz);
  }

  free(x: number, z: number, rad: number): boolean {
    const [u, v] = this.uv(x, z);
    return this.inside(u, v, rad * 2, rad * 2) && this.r.free(u, v, rad);
  }

  /** Nothing taller than `above` stands on this footprint (for things hung on walls). */
  clearAbove(x: number, z: number, wx: number, dz: number, above: number): boolean {
    const [u, v] = this.uv(x, z);
    const [w, d] = this.size(wx, dz);
    return !this.hits(u, v, w, d, above);
  }

  box(mat: Mat, x: number, z: number, y: number, wx: number, h: number, dz: number, o: BoxO = {}): void {
    const [u, v] = this.uv(x, z);
    const [w, d] = this.size(wx, dz);
    const rot = o.rot ?? 0;
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const bw = w * c + d * s;
    const bd = w * s + d * c;
    if (!this.inside(u, v, bw, bd)) return; // never draw past the clear rectangle
    this.k.box(mat, u, v, y, w, h, d, rot || o.solid ? { rot: rot || undefined, solid: o.solid } : undefined);
    if (o.solid) this.addSolid({ u0: u - bw / 2, u1: u + bw / 2, v0: v - bd / 2, v1: v + bd / 2, top: y + h });
  }

  cyl(mat: Mat, x: number, z: number, y: number, rad: number, h: number, o: CylO = {}): void {
    const [u, v] = this.uv(x, z);
    const R = Math.max(rad, o.r2 ?? rad);
    const ax = o.ax ?? 'y';
    let axis: 'y' | 'u' | 'v' = 'y';
    if (ax === 'x') axis = this.xu !== 0 ? 'u' : 'v';
    else if (ax === 'z') axis = this.zu !== 0 ? 'u' : 'v';
    const w = axis === 'u' ? h : 2 * R;
    const d = axis === 'v' ? h : 2 * R;
    if (!this.inside(u, v, w, d)) return;
    this.k.cyl(mat, u, v, y, rad, h, { axis, seg: o.seg ?? 10, r2: o.r2, solid: o.solid });
    if (o.solid) {
      const top = axis === 'y' ? y + h : y + R;
      this.addSolid({ u0: u - w / 2, u1: u + w / 2, v0: v - d / 2, v1: v + d / 2, top });
    }
  }

  private addSolid(s: Solid): void {
    this.ctx.solids.push(s);
    this.ctx.paths.add(s);
  }

  /** An invisible collider that also reserves the footprint. */
  solid(x: number, z: number, wx: number, h: number, dz: number): void {
    this.box('none', x, z, 0, wx, h, dz, { solid: true });
  }

  /** A child frame at (x, z), turned by quarter turns. */
  at(x: number, z: number, t: Turn = 0): F {
    const [ou, ov] = this.uv(x, z);
    const { xu, xv, zu, zv } = this;
    if (t === 1) return new F(this.r, this.k, this.ctx, ou, ov, zu, zv, -xu, -xv);
    if (t === 2) return new F(this.r, this.k, this.ctx, ou, ov, -xu, -xv, -zu, -zv);
    if (t === 3) return new F(this.r, this.k, this.ctx, ou, ov, -zu, -zv, xu, xv);
    return new F(this.r, this.k, this.ctx, ou, ov, xu, xv, zu, zv);
  }
}

/** A wall frame: x along the wall (0 .. len), z out from it into the room (0 .. depth). */
class Wall extends F {
  side: Side = 'u0';
  len = 0;
  depth = 0;
  /** Door positions along this wall. */
  doors: number[] = [];

  doorNear(a: number, half: number): boolean {
    return this.doors.some((d) => Math.abs(d - a) < half + 0.6);
  }

  /** Candidate positions along the wall for something w wide, best first. */
  cands(w: number, pref: Pref, step = 0.1): number[] {
    const out: number[] = [];
    const lo = w / 2;
    const hi = this.len - w / 2;
    if (hi < lo - EPS) return out;
    const n = Math.floor((hi - lo) / step + EPS);
    for (let i = 0; i <= n; i += 1) out.push(lo + i * step);
    if (hi - out[out.length - 1] > 0.02) out.push(hi);
    const t = pref === 'start' ? lo : pref === 'end' ? hi : pref === 'mid' ? this.len / 2 : pref;
    return out.sort((p, q) => Math.abs(p - t) - Math.abs(q - t));
  }

  /** Where a w × d item (n off the wall) fits with `clear` metres of walkway in front of it. */
  slot(w: number, d: number, clear: number, pref: Pref = 'start', n = 0): number | null {
    for (const a of this.cands(w, pref)) {
      if (!this.fits(a, n + d / 2, w, d)) continue;
      if (clear > 0 && !this.open(a, n + d + clear / 2, w, clear)) continue;
      if (!this.keeps(a, n + d / 2, w, d)) continue;
      return a;
    }
    return null;
  }

  /** The longest stretch where a d-deep strip with `clear` in front fits, as [a0, a1]. */
  run(d: number, clear: number, minLen = 0.5): [number, number] | null {
    const step = 0.1;
    const N = Math.floor(this.len / step + EPS);
    let best: [number, number] | null = null;
    let start = -1;
    for (let i = 0; i <= N; i += 1) {
      const a = (i + 0.5) * step;
      const ok = i < N && this.fits(a, d / 2, step, d) && (clear <= 0 || this.open(a, d + clear / 2, step, clear));
      if (ok && start < 0) start = i;
      if (!ok && start >= 0) {
        const s: [number, number] = [start * step + 0.01, i * step - 0.01];
        if (!best || s[1] - s[0] > best[1] - best[0]) best = s;
        start = -1;
      }
    }
    if (!best) return null;
    // Trim it (alternately from each end) until it no longer cuts anything off.
    let [a0, a1] = best;
    for (let t = 0; a1 - a0 >= minLen; t += 1) {
      if (this.keeps((a0 + a1) / 2, d / 2, a1 - a0, d)) return [a0, a1];
      if (t % 2) a0 += 0.3;
      else a1 -= 0.3;
    }
    return null;
  }

  /** A spot to hang something w wide from y0 to y1: no door below, nothing tall in front, nothing hung there. */
  hang(w: number, y0: number, y1: number, pref: Pref = 'mid'): number | null {
    if (y1 > this.r.height - 0.05) return null;
    for (const a of this.cands(w, pref)) {
      if (this.doorNear(a, w / 2)) continue;
      if (!this.clearAbove(a, 0.2, w, 0.4, y0 - 0.05)) continue;
      if (this.ctx.hung.some((h) => h.side === this.side && a - w / 2 < h.a1 + 0.05 && a + w / 2 > h.a0 - 0.05 && y0 < h.y1 && y1 > h.y0)) continue;
      this.ctx.hung.push({ side: this.side, a0: a - w / 2, a1: a + w / 2, y0, y1 });
      return a;
    }
    return null;
  }
}

function makeWall(r: Room, k: Kit, ctx: Ctx, side: Side): Wall {
  const { u0, u1, v0, v1 } = r;
  const p: [number, number, number, number, number, number] =
    side === 'u0' ? [u0, v0, 0, 1, 1, 0] : side === 'u1' ? [u1, v0, 0, 1, -1, 0] : side === 'v0' ? [u0, v0, 1, 0, 0, 1] : [u0, v1, 1, 0, 0, -1];
  const W = new Wall(r, k, ctx, ...p);
  W.side = side;
  W.len = side === 'u0' || side === 'u1' ? v1 - v0 : u1 - u0;
  W.depth = side === 'u0' || side === 'u1' ? u1 - u0 : v1 - v0;
  for (const d of r.doors) {
    const [a, z] = W.local(d.u, d.v);
    if (a < -0.6 || a > W.len + 0.6) continue;
    if (d.side === side || (d.side === null && Math.abs(z) < 0.35)) W.doors.push(a);
  }
  return W;
}

const OPP: Record<Side, Side> = { u0: 'u1', u1: 'u0', v0: 'v1', v1: 'v0' };

interface C {
  r: Room;
  R: () => number;
  /** The room frame: x = u, z = v. */
  rf: F;
  W: Record<Side, Wall>;
  front: Wall;
  back: Wall;
  /** The two walls beside the front one, quiet (doorless) and long first. */
  sides: Wall[];
  area: number;
}

function setup(r: Room, k: Kit): C {
  const ctx: Ctx = { solids: [], hung: [], paths: new Paths(r) };
  const W = {} as Record<Side, Wall>;
  for (const s of SIDES) W[s] = makeWall(r, k, ctx, s);
  const front = W[r.front];
  const back = W[OPP[r.front]];
  const sides = SIDES.filter((s) => s !== r.front && s !== OPP[r.front])
    .map((s) => W[s])
    .sort((a, b) => a.doors.length - b.doors.length || b.len - a.len);
  return {
    r,
    R: () => r.rand(),
    rf: new F(r, k, ctx, 0, 0, 1, 0, 0, 1),
    W,
    front,
    back,
    sides,
    area: (r.u1 - r.u0) * (r.v1 - r.v0),
  };
}

/** Front wall, then the sides, then the door wall. */
const byFront = (c: C): Wall[] => [c.front, ...c.sides, c.back];
/** Doorless walls first, longest first. */
const byQuiet = (c: C): Wall[] => byFront(c).sort((a, b) => Math.min(1, a.doors.length) - Math.min(1, b.doors.length) || b.len - a.len);

interface Spot {
  W: Wall;
  a: number;
}

/** Puts a w (along the wall) × d item against the first wall that has room for it. */
function place(ws: Wall[], w: number, d: number, clear: number, draw: (f: F) => void, pref: Pref = 'start', turn: Turn = 0, n = 0): Spot | null {
  for (const W of ws) {
    const a = W.slot(w, d, clear, pref, n);
    if (a === null) continue;
    draw(W.at(a, n + d / 2, turn));
    return { W, a };
  }
  return null;
}

/** A free-standing spot (w along u, d along v, or turned) with an m-metre walkway all round. */
function spot(c: C, w: number, d: number, m: number, near?: [number, number]): F | null {
  const { r, rf } = c;
  const cu = near ? near[0] : (r.u0 + r.u1) / 2;
  const cv = near ? near[1] : (r.v0 + r.v1) / 2;
  const tries: [number, number, Turn][] = [[w, d, 0]];
  if (Math.abs(w - d) > 0.01) tries.push([d, w, 1]);
  const pts: [number, number, number, Turn][] = [];
  for (const [ww, dd, t] of tries) {
    const ulo = r.u0 + ww / 2 + m;
    const uhi = r.u1 - ww / 2 - m;
    const vlo = r.v0 + dd / 2 + m;
    const vhi = r.v1 - dd / 2 - m;
    if (uhi < ulo - EPS || vhi < vlo - EPS) continue;
    for (let u = ulo; u <= uhi + EPS; u += 0.2) for (let v = vlo; v <= vhi + EPS; v += 0.2) pts.push([u, v, Math.hypot(u - cu, v - cv) + t * 0.05, t]);
    pts.push([clamp(cu, ulo, uhi), clamp(cv, vlo, vhi), -1 + t * 0.05, t]);
  }
  pts.sort((p, q) => p[2] - q[2]);
  for (const [u, v, , t] of pts) {
    const [ww, dd] = t ? [d, w] : [w, d];
    if (rf.fits(u, v, ww, dd) && rf.open(u, v, ww + 2 * m, dd + 2 * m) && rf.keeps(u, v, ww, dd)) return rf.at(u, v, t);
  }
  return null;
}

/** The free corner spots of the room (for plants, sticks, buckets). */
function corner(c: C, rad: number): F | null {
  const { r, rf, R } = c;
  const o = rad + 0.03;
  const cs: [number, number][] = [
    [r.u0 + o, r.v0 + o],
    [r.u1 - o, r.v0 + o],
    [r.u0 + o, r.v1 - o],
    [r.u1 - o, r.v1 - o],
  ];
  const s = Math.floor(R() * 4);
  for (let i = 0; i < 4; i += 1) {
    const [u, v] = cs[(s + i) % 4];
    if (rf.free(u, v, rad) && !rf.hits(u, v, rad * 2, rad * 2)) {
      rf.solid(u, v, rad * 2, 0.05, rad * 2); // reserve (a 5 cm collider is stepped over)
      return rf.at(u, v);
    }
  }
  return null;
}

// ==================================================================== pieces
// Drawn centred on the frame origin, front towards +z, back towards -z.

const BLANKETS: Mat[] = ['fabric', 'blue', 'red', 'green', 'cushion', 'orange'];
const TRUNKS: Mat[] = ['steel', 'blue', 'green', 'black', 'steel'];
const POSTERS: Mat[] = ['paper', 'red', 'blue', 'yellow', 'green', 'black', 'orange', 'sign', 'cream'];
const CLOTHES: Mat[] = ['fabric', 'white', 'red', 'blue', 'green', 'yellow', 'black', 'orange'];
const PLASTIC: Mat[] = ['red', 'blue', 'green', 'orange', 'yellow'];

interface CotO {
  frame: Mat;
  blanket: Mat;
  messy: boolean;
  trunk: Mat | null;
  len?: number;
  wid?: number;
}

/** A single cot, length along x, head at -x: steel or wooden frame, mattress, pillow, blanket, trunk below. */
function cot(f: F, R: () => number, o: CotO): void {
  const L = o.len ?? 1.9;
  const D = o.wid ?? 0.9;
  f.solid(0, 0, L, 0.45, D);
  f.box(o.frame, 0, 0, 0.27, L, 0.06, D);
  f.box(o.frame, -L / 2 + 0.02, 0, 0, 0.04, 0.85, D);
  f.box(o.frame, L / 2 - 0.02, 0, 0, 0.04, 0.6, D);
  f.box('mattress', 0, 0, 0.33, L - 0.08, 0.12, D - 0.04);
  f.box('pillow', -L / 2 + 0.28, 0, 0.45, 0.34, 0.1, D * 0.62);
  if (o.messy) f.box(o.blanket, 0.2, 0, 0.45, L * 0.55, 0.05, D - 0.2, { rot: (R() - 0.5) * 0.2 });
  else f.box(o.blanket, L / 2 - 0.3, 0, 0.45, 0.38, 0.12, D * 0.66);
  if (o.trunk) {
    f.box(o.trunk, 0.15, 0, 0, 0.76, 0.22, D * 0.5);
    f.box('metal', 0.15, 0, 0.2, 0.78, 0.03, D * 0.5 + 0.02);
  }
}

/** A table on two side panels (study tables, desks). */
function deskTable(f: F, w: number, d: number, mat: Mat = 'wood', h = 0.75): void {
  f.box(mat, 0, 0, h - 0.04, w, 0.04, d, { solid: true });
  f.box(mat, -w / 2 + 0.03, 0, 0, 0.04, h - 0.04, d - 0.06);
  f.box(mat, w / 2 - 0.03, 0, 0, 0.04, h - 0.04, d - 0.06);
}

/** A table on four legs. */
function table4(f: F, w: number, d: number, top: Mat, legs: Mat, h = 0.75): void {
  f.box(top, 0, 0, h - 0.04, w, 0.04, d, { solid: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(legs, sx * (w / 2 - 0.05), sz * (d / 2 - 0.05), 0, 0.05, h - 0.04, 0.05);
}

/** A chair; its back is on the `back` side of z (it faces the other way). */
function chair(f: F, mat: Mat = 'wood', back: 1 | -1 = -1): void {
  f.box(mat, 0, 0, 0.43, 0.42, 0.04, 0.42);
  f.box(mat, 0, back * 0.19, 0, 0.42, 0.9, 0.04);
  f.box(mat, -0.18, -back * 0.18, 0, 0.04, 0.43, 0.04);
  f.box(mat, 0.18, -back * 0.18, 0, 0.04, 0.43, 0.04);
}

/** A stool: round seat on a post. */
function stool(f: F, seat: Mat, h = 0.6): void {
  f.cyl('metal', 0, 0, 0, 0.03, h - 0.04, { seg: 8 });
  f.cyl(seat, 0, 0, h - 0.04, 0.17, 0.05, { seg: 10 });
}

/** A steel almirah / wardrobe with its door seam and handle. */
function almirah(f: F, mat: Mat, w = 0.9, d = 0.5, h = 1.9): void {
  f.box(mat, 0, 0, 0, w, h, d, { solid: true });
  f.box('black', 0, d / 2, 0.06, 0.012, h - 0.12, 0.01);
  f.box('chrome', 0.06, d / 2 + 0.008, h * 0.48, 0.025, 0.16, 0.02);
}

/** A bookshelf full of books. */
function bookshelf(f: F, w: number, d: number, h: number): void {
  f.box('darkwood', 0, -0.01, 0, w, h, d - 0.02, { solid: true });
  f.box('books', 0, d / 2 - 0.01, 0.05, w - 0.06, h - 0.1, 0.02);
}

function bucket(f: F, mat: Mat, x = 0, z = 0): void {
  f.cyl(mat, x, z, 0, 0.12, 0.3, { r2: 0.15, seg: 10 });
}

function mug(f: F, mat: Mat, x: number, z: number, y = 0): void {
  f.cyl(mat, x, z, y, 0.045, 0.11, { seg: 8 });
}

/** A bench (seat, end legs, optional back on the -z side). */
function bench(f: F, w: number, mat: Mat = 'wood', back = false, d = 0.38): void {
  f.box(mat, 0, 0, 0.42, w, 0.05, d, { solid: true });
  f.box(mat, -w / 2 + 0.06, 0, 0, 0.05, 0.42, d - 0.04);
  f.box(mat, w / 2 - 0.06, 0, 0, 0.05, 0.42, d - 0.04);
  if (w > 2.2) f.box(mat, 0, 0, 0, 0.05, 0.42, d - 0.04);
  if (back) f.box(mat, 0, -d / 2 + 0.025, 0.47, w, 0.4, 0.04);
}

/** A sofa w wide: base, back, arms and seat cushions. */
function sofa(f: F, w: number, body: Mat, cush: Mat, R: () => number, d = 0.8): void {
  f.box(body, 0, 0, 0, w, 0.4, d, { solid: true });
  f.box(body, 0, -d / 2 + 0.1, 0.4, w, 0.42, 0.2);
  f.box(body, -w / 2 + 0.08, 0.05, 0.4, 0.16, 0.2, d - 0.1);
  f.box(body, w / 2 - 0.08, 0.05, 0.4, 0.16, 0.2, d - 0.1);
  const n = Math.max(1, Math.round((w - 0.32) / 0.6));
  const sw = (w - 0.32) / n;
  for (let i = 0; i < n; i += 1) f.box(cush, -w / 2 + 0.16 + (i + 0.5) * sw, 0.08, 0.4, sw - 0.02, 0.1, d - 0.3);
  if (R() < 0.7) f.box('pillow', -w / 2 + 0.32, -d / 2 + 0.26, 0.5, 0.34, 0.3, 0.1);
}

/** A TV cabinet with the TV on it. */
function tvUnit(f: F, w: number, d: number, big: boolean): void {
  const tw = big ? 1.1 : 0.9;
  const th = big ? 0.64 : 0.52;
  f.box('darkwood', 0, 0, 0, w, 0.5, d, { solid: true });
  f.box('black', 0, -d / 2 + 0.12, 0.5, 0.3, 0.03, 0.18);
  f.box('black', 0, -d / 2 + 0.12, 0.53, tw, th, 0.05);
  f.box('screen', 0, -d / 2 + 0.15, 0.56, tw - 0.05, th - 0.06, 0.01);
}

/** A wall poster or picture (on a wall frame at x = a). */
function poster(W: Wall, a: number, y: number, w: number, h: number, mat: Mat): void {
  W.box(mat, a, 0.006, y, w, h, 0.012);
}

/** A framed photo. */
function photo(W: Wall, a: number, y: number, w: number, h: number): void {
  W.box('darkwood', a, 0.01, y, w, h, 0.02);
  W.box('paper', a, 0.022, y + 0.04, w - 0.08, h - 0.08, 0.006);
}

/** A round wall clock centred at height y. */
function clock(W: Wall, a: number, y: number): void {
  W.cyl('white', a, 0.02, y, 0.14, 0.04, { ax: 'z', seg: 12 });
  W.box('black', a, 0.045, y - 0.01, 0.012, 0.1, 0.008);
  W.box('black', a + 0.03, 0.045, y - 0.006, 0.07, 0.012, 0.008);
}

/** A ceiling fan hanging from `top`. */
function fan(f: F, x: number, z: number, top: number, span: number): void {
  if (top < 2.45 || span < 0.6) return;
  const y = Math.min(top - 0.4, 2.75);
  f.cyl('white', x, z, y + 0.08, 0.013, top - y - 0.08, { seg: 8 });
  f.cyl('white', x, z, y, 0.09, 0.09, { seg: 10 });
  f.box('white', x, z, y + 0.035, span, 0.012, 0.11);
  f.box('white', x, z, y + 0.035, 0.11, 0.012, span);
}

/** Ceiling fans on a ~3.6 m grid. */
function fans(c: C, max = 6): void {
  const { r, rf } = c;
  const lu = r.u1 - r.u0;
  const lv = r.v1 - r.v0;
  const nu = clamp(Math.round(lu / 3.6), 1, 4);
  const nv = clamp(Math.round(lv / 3.6), 1, 4);
  const span = Math.min(1.1, Math.min(lu / nu, lv / nv) - 0.2);
  let n = 0;
  for (let i = 0; i < nu; i += 1) for (let j = 0; j < nv; j += 1) {
    if (n++ >= max) return;
    fan(rf, r.u0 + ((i + 0.5) * lu) / nu, r.v0 + ((j + 0.5) * lv) / nv, r.height, span);
  }
}

/** An open register on a desk top. */
function register(f: F, x: number, z: number, y: number, cover: Mat): void {
  f.box(cover, x, z, y, 0.48, 0.012, 0.32);
  f.box('paper', x, z, y + 0.012, 0.45, 0.01, 0.3);
}

/** A desk telephone. */
function phone(f: F, x: number, z: number, y: number): void {
  f.box('black', x, z, y, 0.2, 0.06, 0.18);
  f.box('black', x, z - 0.05, y + 0.06, 0.19, 0.04, 0.05);
}

/** A potted plant. */
function plant(f: F, R: () => number, h = 0.7): void {
  f.cyl(pick(R, ['brick', 'orange', 'cream'] as const), 0, 0, 0, 0.13, 0.28, { r2: 0.16, seg: 10 });
  f.cyl('plant', 0, 0, 0.26, 0.22, h * (0.8 + R() * 0.4), { r2: 0.04, seg: 8 });
}

// ==================================================================== hostel

const dorm: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const order = byQuiet(c);
  const nBeds = clamp(Math.floor(c.area / 4.8), 1, 4);
  const frame: Mat = R() < 0.65 ? 'metal' : 'wood';
  const messy = R() < 0.45;
  const beds: (Spot & { along: boolean })[] = [];
  for (let i = 0; i < nBeds; i += 1) {
    const draw = (f: F) =>
      cot(f, R, { frame, blanket: pick(R, BLANKETS), messy: messy && R() < 0.7, trunk: R() < 0.85 ? pick(R, TRUNKS) : null });
    let p = place(order, 1.9, 0.9, 0.75, draw, i % 2 ? 'end' : 'start');
    let along = true;
    if (!p) {
      p = place(order, 0.9, 1.9, 0.75, draw, i % 2 ? 'end' : 'start', 1);
      along = false;
    }
    if (!p) break;
    beds.push({ ...p, along });
  }
  // Posters and slippers by the beds.
  for (const b of beds) {
    if (R() < 0.6) {
      const w = 0.38 + R() * 0.25;
      const h = 0.5 + R() * 0.2;
      const a = b.along ? b.W.hang(w, 0.95, 0.95 + h, b.a + (R() - 0.5) * 0.8) : b.W.hang(w, 1.0, 1.0 + h, b.a);
      if (a !== null) poster(b.W, a, b.along ? 0.95 : 1.0, w, h, pick(R, POSTERS));
    }
    if (b.along && R() < 0.55) {
      const x = b.a + (R() - 0.5) * 0.9;
      if (b.W.free(x, 1.05, 0.15)) {
        const m = pick(R, ['blue', 'black', 'red', 'rubber'] as const);
        b.W.box(m, x - 0.06, 1.05, 0, 0.1, 0.03, 0.25);
        b.W.box(m, x + 0.07, 1.06, 0, 0.1, 0.03, 0.25);
      }
    }
  }
  // Shared almirah(s) and a bookshelf.
  const alm = pick(R, ['metal', 'metal', 'cream', 'green', 'steel'] as const);
  place(order, 0.9, 0.5, 0.8, (f) => almirah(f, alm), 'end');
  if (beds.length >= 3 && c.area > 17) place(order, 0.9, 0.5, 0.8, (f) => almirah(f, alm), 'end');
  place(order, 0.8, 0.3, 0.75, (f) => bookshelf(f, 0.8, 0.3, 1.1 + R() * 0.5), 'mid');
  // A study table and chair per bed.
  for (let i = 0; i < Math.max(1, beds.length); i += 1) {
    place(
      order,
      0.9,
      0.55,
      1.25,
      (f) => {
        deskTable(f, 0.9, 0.55, R() < 0.7 ? 'wood' : 'plywood');
        f.box('books', -0.25, -0.12, 0.75, 0.22, 0.06 + R() * 0.14, 0.16);
        if (R() < 0.6) f.cyl(pick(R, ['blue', 'white', 'green'] as const), 0.32, -0.15, 0.75, 0.035, 0.24, { seg: 8 });
        if (R() < 0.4) f.box('paper', 0.05, 0.05, 0.75, 0.3, 0.01, 0.22, { rot: (R() - 0.5) * 0.6 });
        const ch = f.at((R() - 0.5) * 0.2, 0.42);
        chair(ch, 'wood', 1);
        if (messy && R() < 0.5) ch.box(pick(R, CLOTHES), 0, 0.19, 0.62, 0.4, 0.3, 0.07);
      },
      i % 2 ? 'end' : 'start',
    );
  }
  // Bucket and mug.
  place(order, 0.5, 0.32, 0.5, (f) => {
    bucket(f, pick(R, PLASTIC), -0.08, 0);
    mug(f, pick(R, PLASTIC), 0.18, 0.04);
  }, 'end');
  // Clothes line across the room, or hooks with a towel.
  const lineW = order[0];
  const yl = Math.min(2.1, r.height - 0.3);
  if (yl > 1.95 && R() < 0.5 && lineW.len > 1.5) {
    lineW.cyl('black', lineW.len / 2, 0.45, yl, 0.006, lineW.len, { ax: 'x', seg: 8 });
    const n = 2 + Math.floor(R() * 3);
    for (let i = 0; i < n; i += 1) {
      const a = 0.4 + R() * (lineW.len - 0.8);
      const h = 0.35 + R() * 0.3;
      if (lineW.clearAbove(a, 0.45, 0.45, 0.04, yl - h - 0.05)) lineW.box(pick(R, CLOTHES), a, 0.45, yl - h, 0.45, h, 0.03);
    }
  } else {
    for (const W of order) {
      const a = W.hang(0.7, 1.15, 1.8, 'end');
      if (a === null) continue;
      W.box('wood', a, 0.015, 1.72, 0.7, 0.06, 0.03);
      W.box(pick(R, CLOTHES), a - 0.15, 0.02, 1.2, 0.3, 0.52, 0.02);
      if (R() < 0.6) W.box(pick(R, CLOTHES), a + 0.18, 0.02, 1.3, 0.25, 0.42, 0.02);
      break;
    }
  }
  fans(c, c.area > 22 ? 2 : 1);
};

/** A desk with its chair, facing the door if the room is deep enough (chair between desk and wall). */
function officeDesk(c: C, w: number, d: number, mat: Mat): F | null {
  const W = c.front;
  if (W.depth >= 3.2) {
    const a = W.slot(w, d, 1.0, 'mid', 0.85);
    if (a !== null) {
      const f = W.at(a, 0.85 + d / 2);
      deskTable(f, w, d, mat);
      chair(W.at(a, 0.45), 'wood', -1);
      return f;
    }
  }
  let out: F | null = null;
  place(byFront(c), w, d, 1.2, (f) => {
    deskTable(f, w, d, mat);
    chair(f.at(0, d / 2 + 0.15), 'wood', 1);
    out = f;
  }, 'mid');
  return out;
}

const warden: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const desk = officeDesk(c, 1.2, 0.6, 'darkwood');
  if (desk) {
    register(desk, -0.2, 0, 0.75, pick(R, ['red', 'blue', 'black'] as const));
    phone(desk, 0.38, -0.1, 0.75);
    desk.box(pick(R, ['yellow', 'blue', 'paper'] as const), 0.35, 0.15, 0.75, 0.32, 0.1 + R() * 0.1, 0.24);
    desk.cyl('black', 0.1, -0.2, 0.75, 0.035, 0.1, { seg: 8 });
  }
  const walls = [...c.sides, c.back, c.front];
  if (!place(walls, 1.5, 0.4, 0.8, (f) => bench(f, 1.5, 'wood', true), 'mid') && desk) {
    // No wall for a bench: two visitor chairs in front of the desk.
    for (const x of [-0.35, 0.35]) {
      const [u, v] = desk.uv(x, 0.65);
      if (c.rf.free(u, v, 0.22)) chair(desk.at(x, 0.65), 'wood', 1);
    }
  }
  place(byQuiet(c), 1.9, 0.85, 0.75, (f) => cot(f, R, { frame: 'metal', blanket: pick(R, BLANKETS), messy: false, trunk: null, wid: 0.85 }), 'end');
  place(byQuiet(c), 0.9, 0.5, 0.8, (f) => almirah(f, 'metal'), 'end');
  // Key board, notice board, clock.
  for (const W of walls) {
    const a = W.hang(0.6, 1.3, 1.75);
    if (a === null) continue;
    W.box('wood', a, 0.01, 1.3, 0.6, 0.45, 0.02);
    for (let i = 0; i < 2; i += 1) for (let j = 0; j < 4; j += 1) {
      if (R() < 0.2) continue;
      W.box(pick(R, ['yellow', 'chrome'] as const), a - 0.21 + j * 0.14, 0.025, 1.38 + i * 0.2, 0.025, 0.07, 0.01);
    }
    break;
  }
  for (const W of walls) {
    const a = W.hang(0.9, 1.2, 1.8);
    if (a === null) continue;
    W.box('board', a, 0.01, 1.2, 0.9, 0.6, 0.02);
    for (let i = 0; i < 3; i += 1) W.box('paper', a - 0.28 + i * 0.28, 0.022, 1.3 + R() * 0.15, 0.2, 0.28, 0.004);
    break;
  }
  const ca = c.front.hang(0.3, 1.9, 2.2);
  if (ca !== null) clock(c.front, ca, 2.05);
  fans(c, 1);
};

const common: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const big = c.area > 30;
  // TV on a stand, the sofas facing it.
  const tv = place([c.front, ...c.sides], 1.2, 0.45, 2.2, (f) => tvUnit(f, 1.2, 0.45, true), 'mid');
  const body = pick(R, ['fabric', 'cushion', 'darkwood'] as const);
  const cush: Mat = body === 'darkwood' ? 'cushion' : 'pillow';
  if (tv) {
    const sw = Math.min(2.0, tv.W.len - 1.6);
    if (sw >= 1.2) facing(tv, 2.0, sw, 0.8, (f) => sofa(f, sw, body, cush, R));
  }
  // Benches along the walls.
  for (let i = 0; i < (big ? 3 : 1); i += 1) place(byQuiet(c), 1.6, 0.42, 0.8, (f) => bench(f, 1.6, 'wood', true, 0.42), i % 2 ? 'end' : 'start');
  // Carrom board on a stand, with two stools.
  const cr = spot(c, 0.85, 0.85, 0.75);
  if (cr) carrom(cr, R);
  // Table tennis if the room is large.
  if (c.area >= 40) {
    const tt = spot(c, 2.74, 1.525, 1.1);
    if (tt) {
      tt.box(R() < 0.5 ? 'blue' : 'green', 0, 0, 0.73, 2.74, 0.03, 1.525, { solid: true });
      tt.box('white', 0, 0, 0.76, 2.74, 0.002, 0.02);
      tt.box('white', 0, 0, 0.76, 0.015, 0.15, 1.525);
      tt.box('metal', -0.9, 0, 0, 0.06, 0.73, 1.2);
      tt.box('metal', 0.9, 0, 0, 0.06, 0.73, 1.2);
    }
  }
  // A reading table with the day's papers.
  if (c.area >= 22) {
    const rt = spot(c, 1.5, 0.8, 0.85);
    if (rt) {
      table4(rt, 1.5, 0.8, 'wood', 'wood');
      for (const x of [-0.4, 0.4]) {
        chair(rt.at(x, -0.62), 'wood', -1);
        chair(rt.at(x, 0.62), 'wood', 1);
      }
      for (let i = 0; i < 3; i += 1) rt.box('paper', -0.4 + i * 0.4, (R() - 0.5) * 0.3, 0.75, 0.38, 0.006 + i * 0.002, 0.28, { rot: (R() - 0.5) * 0.4 });
    }
  }
  // Newspaper rack.
  place(byQuiet(c), 0.8, 0.35, 0.8, (f) => {
    f.box('wood', -0.38, 0, 0, 0.04, 1.0, 0.35, { solid: true });
    f.box('wood', 0.38, 0, 0, 0.04, 1.0, 0.35, { solid: true });
    for (let i = 0; i < 3; i += 1) {
      f.box('wood', 0, -0.1 + i * 0.1, 0.55 + i * 0.15, 0.72, 0.025, 0.025);
      f.box('paper', 0, -0.1 + i * 0.1, 0.25 + i * 0.15, 0.6, 0.31, 0.008);
    }
  }, 'end');
  for (const W of [...c.sides, c.back]) {
    const a = W.hang(1.0, 1.2, 1.9);
    if (a === null) continue;
    W.box('board', a, 0.01, 1.2, 1.0, 0.7, 0.02);
    for (let i = 0; i < 4; i += 1) W.box('paper', a - 0.36 + i * 0.24, 0.022, 1.3 + R() * 0.25, 0.18, 0.25, 0.004);
    break;
  }
  const ca = c.front.hang(0.3, 1.95, 2.25, 'start');
  if (ca !== null) clock(c.front, ca, 2.1);
  fans(c);
};

/** A seat facing an item against a wall (the TV): `gap` metres away, keeping a walkway behind or beside. */
function facing(at: Spot, gap: number, w: number, d: number, draw: (f: F) => void): number | null {
  const W = at.W;
  const z0 = 0.45 + gap + d / 2;
  const zs: number[] = [];
  for (let z = z0; z <= W.depth - d / 2 + EPS; z += 0.2) zs.push(z);
  if (W.depth - d / 2 >= 0.45 + 1.4 + d / 2) zs.push(W.depth - d / 2);
  for (const z of zs) {
    for (const da of [0, -0.3, 0.3, -0.6, 0.6]) {
      const a = at.a + da;
      if (!W.fits(a, z, w, d)) continue;
      const againstBack = z + d / 2 >= W.depth - 0.02;
      if (!againstBack && !W.open(a, z + d / 2 + 0.4, w, 0.8)) continue;
      // A way round it: a 0.8 m gap at one end.
      if (!W.open(a - w / 2 - 0.4, z, 0.8, d) && !W.open(a + w / 2 + 0.4, z, 0.8, d)) continue;
      if (!W.keeps(a, z, w, d)) continue;
      draw(W.at(a, z, 2));
      return z;
    }
  }
  return null;
}

/** A carrom board on a stand with two stools. */
function carrom(f: F, R: () => number): void {
  f.box('darkwood', 0, 0, 0, 0.5, 0.62, 0.5, { solid: true });
  f.box('plywood', 0, 0, 0.62, 0.74, 0.03, 0.74);
  f.box('darkwood', 0, 0.38, 0.62, 0.82, 0.06, 0.05);
  f.box('darkwood', 0, -0.38, 0.62, 0.82, 0.06, 0.05);
  f.box('darkwood', 0.38, 0, 0.62, 0.05, 0.06, 0.72);
  f.box('darkwood', -0.38, 0, 0.62, 0.05, 0.06, 0.72);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl('black', sx * 0.33, sz * 0.33, 0.645, 0.025, 0.01, { seg: 8 });
  for (let i = 0; i < 5; i += 1) f.cyl(i % 2 ? 'black' : 'cream', (R() - 0.5) * 0.4, (R() - 0.5) * 0.4, 0.65, 0.016, 0.008, { seg: 8 });
  stool(f.at(0, 0.62), pick(R, PLASTIC), 0.45);
  stool(f.at(0, -0.62), pick(R, PLASTIC), 0.45);
}

const mess: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const W = c.front;
  // Serving counter along the front wall, with a gap at one end for the cooks.
  let cz = 0;
  for (let len = Math.min(W.len - 1.2, 4.5); len >= 1.2; len -= 0.5) {
    const n = W.depth >= 6 ? 0.85 : 0;
    const a = W.slot(len, 0.6, 1.5, 'start', n);
    if (a === null) continue;
    const f = W.at(a, n + 0.3);
    f.box(R() < 0.5 ? 'tile' : 'concrete', 0, 0, 0, len, 0.86, 0.6, { solid: true });
    f.box('steel', 0, 0, 0.86, len, 0.03, 0.6);
    const pots = Math.min(4, Math.floor(len / 0.6));
    for (let i = 0; i < pots; i += 1) {
      const x = -len / 2 + 0.35 + i * 0.55;
      const pr = 0.18 + R() * 0.05;
      f.cyl('steel', x, -0.02, 0.89, pr, 0.26 + R() * 0.1, { seg: 12 });
      f.cyl('steel', x + 0.05, 0.05, 1.0, 0.012, 0.35, { seg: 8 });
    }
    const px = len / 2 - 0.25;
    f.cyl('steel', px, 0.05, 0.89, 0.14, 0.18 + R() * 0.1, { seg: 12 });
    if (len > 1.8) f.cyl('steel', px - 0.32, 0.05, 0.89, 0.14, 0.12 + R() * 0.1, { seg: 12 });
    cz = n + 0.6;
    break;
  }
  // Long tables with benches, in rows parallel to the counter.
  const avail = W.len - 1.8;
  const nseg = Math.max(1, Math.ceil(avail / 5));
  const sl = (avail - (nseg - 1) * 1.0) / nseg;
  if (sl >= 1.2) {
    const unit = 1.55;
    for (let z = cz + 1.6; z + unit <= W.depth - 0.9 + EPS; z += unit + 0.9) {
      for (let s = 0; s < nseg; s += 1) {
        const a = 0.9 + s * (sl + 1.0) + sl / 2;
        const zc = z + unit / 2;
        if (!W.ok(a, zc, sl, unit)) continue;
        const f = W.at(a, zc);
        deskTable(f, sl, 0.75, 'wood', 0.75);
        if (sl > 2.4) f.box('wood', 0, 0, 0, 0.04, 0.71, 0.69);
        f.at(0, -0.6).box('wood', 0, 0, 0.42, sl, 0.05, 0.3, { solid: true });
        f.at(0, 0.6).box('wood', 0, 0, 0.42, sl, 0.05, 0.3, { solid: true });
        for (const bz of [-0.6, 0.6]) for (const sx of [-1, 1]) f.box('metal', sx * (sl / 2 - 0.1), bz, 0, 0.05, 0.42, 0.26);
        const plates = Math.floor(R() * 4);
        for (let i = 0; i < plates; i += 1) f.cyl('steel', -sl / 2 + 0.3 + R() * (sl - 0.6), R() < 0.5 ? -0.2 : 0.2, 0.75, 0.14, 0.015, { seg: 12 });
      }
    }
  }
  // Water filter on a stand.
  place([...c.sides, c.back], 0.5, 0.45, 0.8, (f) => {
    f.box('metal', 0, 0, 0, 0.5, 0.7, 0.45, { solid: true });
    f.cyl('steel', 0, -0.02, 0.7, 0.19, 0.6, { seg: 12 });
    f.cyl('chrome', 0, 0.2, 0.82, 0.015, 0.08, { ax: 'z', seg: 8 });
    f.cyl('steel', 0.14, 0.12, 0.7, 0.035, 0.1, { seg: 8 });
  }, 'start');
  // Menu board.
  for (const Wl of c.sides) {
    const a = Wl.hang(0.9, 1.3, 1.9);
    if (a === null) continue;
    Wl.box('board', a, 0.01, 1.3, 0.9, 0.6, 0.02);
    Wl.box('paper', a, 0.022, 1.38, 0.6, 0.44, 0.004);
    break;
  }
  fans(c);
};

// ==================================================================== kitchen

/** A kitchen platform (slab on piers, tiled splash-back) from a0 to a1 along wall W. */
function platform(W: Wall, a0: number, a1: number, top: Mat, shelf: boolean, d = 0.6): void {
  const len = a1 - a0;
  const ac = (a0 + a1) / 2;
  W.box(top, ac, d / 2, 0.8, len, 0.05, d, { solid: true });
  if (shelf) W.box('concrete', ac, d / 2, 0.3, len - 0.1, 0.04, d - 0.06);
  const n = Math.max(2, Math.ceil(len / 1.2) + 1);
  for (let i = 0; i < n; i += 1) W.box('concrete', a0 + 0.05 + (i * (len - 0.1)) / (n - 1), d / 2, 0, 0.1, 0.8, d - 0.02);
  W.box('tile', ac, 0.006, 0.85, len, 0.55, 0.012);
}

const kitchen: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const hostel = /hostel|mess|canteen/i.test(`${r.building} ${r.name}`);
  const top: Mat = R() < 0.5 ? 'tile' : 'concrete';
  // The long arm of the L along the front wall (or the first wall that takes it).
  let arm1: [Wall, number, number] | null = null;
  for (const W of byFront(c)) {
    const s = W.run(0.6, 0.9, 1.2);
    if (!s) continue;
    arm1 = [W, s[0], Math.min(s[1], s[0] + (hostel ? 4.2 : 3.2))];
    break;
  }
  if (arm1) {
    const [W, a0, a1] = arm1;
    platform(W, a0, a1, top, false);
    // Stove at the far end with the LPG cylinder under the slab.
    const sa = a1 - 0.45;
    W.box('black', sa, 0.32, 0.85, 0.62, 0.07, 0.36);
    W.cyl('steel', sa - 0.15, 0.32, 0.92, 0.08, 0.02, { seg: 10 });
    W.cyl('steel', sa + 0.15, 0.32, 0.92, 0.08, 0.02, { seg: 10 });
    if (R() < 0.7) W.cyl('steel', sa - 0.15, 0.32, 0.94, 0.11, 0.18, { seg: 10 });
    if (R() < 0.6) W.cyl('black', sa + 0.15, 0.32, 0.94, 0.13, 0.06, { seg: 10 });
    W.cyl('red', sa, 0.3, 0, 0.15, 0.55, { seg: 10 });
    W.cyl('red', sa, 0.3, 0.55, 0.07, 0.08, { seg: 8 });
    W.box('black', sa, 0.3, 0.63, 0.06, 0.05, 0.06);
    // Under the slab: a rice tin and a water gagri.
    W.cyl('steel', a0 + 0.3, 0.3, 0, 0.16, 0.35, { seg: 10 });
    if (a1 - a0 > 1.6) W.cyl('orange', a0 + 0.7, 0.3, 0, 0.16, 0.38, { r2: 0.07, seg: 10 });
    // Utensil shelf above it.
    const sw = Math.min(1.6, a1 - a0);
    const ha = W.hang(sw, 1.45, 1.8, (a0 + a1) / 2 - 0.2);
    if (ha !== null) {
      W.box(R() < 0.5 ? 'steel' : 'wood', ha, 0.14, 1.45, sw, 0.025, 0.28);
      const n = Math.floor((sw - 0.2) / 0.2);
      for (let i = 0; i < n; i += 1) {
        const x = ha - sw / 2 + 0.15 + i * 0.2;
        if (i % 3 === 0) W.cyl('steel', x, 0.06, 1.62, 0.14, 0.012, { ax: 'z', seg: 12 });
        else if (i % 3 === 1) W.cyl('steel', x, 0.16, 1.475, 0.035, 0.1, { seg: 8 });
        else W.cyl('steel', x, 0.15, 1.475, 0.09, 0.13, { seg: 10 });
      }
    }
    // The short arm of the L, with the sink, on the side wall nearest the stove-less end.
    const [cu, cv] = W.uv(a0, 0.3);
    const L = [...c.sides, c.back].filter((x) => x !== W).sort((p, q) => Math.abs(p.local(cu, cv)[1]) - Math.abs(q.local(cu, cv)[1]))[0];
    let sunk = false;
    if (L) {
      const s = L.run(0.6, 0.9, 1.0);
      if (s) {
        const ca = L.local(cu, cv)[0];
        const [b0, b1] = Math.abs(ca - s[0]) < Math.abs(ca - s[1]) ? [s[0], Math.min(s[1], s[0] + 2.0)] : [Math.max(s[0], s[1] - 2.0), s[1]];
        platform(L, b0, b1, top, true);
        sink(L, (b0 + b1) / 2 + ((b1 - b0) / 2 - 0.4) * (Math.abs(ca - b0) < Math.abs(ca - b1) ? 1 : -1));
        sunk = true;
      }
    }
    if (!sunk && a1 - a0 >= 1.9) sink(W, a0 + 0.4);
  }
  if (hostel) {
    // Big cooking pots on low burners, spare cylinders, a water drum and rice sacks.
    for (let i = 0; i < 3; i += 1) {
      place(byQuiet(c), 0.75, 0.75, 1.0, (f) => {
        f.box('black', 0, 0, 0, 0.65, 0.35, 0.65, { solid: true });
        f.cyl('steel', 0, 0, 0.35, 0.29 + R() * 0.06, 0.38 + R() * 0.15, { seg: 12 });
      }, i % 2 ? 'end' : 'mid');
    }
    place(byQuiet(c), 0.7, 0.35, 0.7, (f) => {
      f.cyl('red', -0.17, 0, 0, 0.16, 0.75, { seg: 10, solid: true });
      f.cyl('red', 0.17, 0, 0, 0.16, 0.75, { seg: 10, solid: true });
    }, 'end');
    place(byQuiet(c), 0.65, 0.65, 0.7, (f) => f.cyl('blue', 0, 0, 0, 0.3, 0.85, { seg: 12, solid: true }), 'start');
    place(byQuiet(c), 1.0, 0.55, 0.7, (f) => {
      for (let i = 0; i < 3; i += 1) f.box('cream', -0.3 + i * 0.3, 0, 0, 0.32, 0.55 + R() * 0.15, 0.5, { solid: i === 1 });
    }, 'end');
  } else {
    // Fridge and a small dish rack.
    place(byQuiet(c), 0.62, 0.65, 0.8, (f) => {
      f.box('white', 0, 0, 0, 0.6, 1.6, 0.62, { solid: true });
      f.box('machineDark', 0, 0.31, 1.15, 0.58, 0.01, 0.01);
      f.box('chrome', 0.24, 0.325, 0.75, 0.025, 0.3, 0.02);
      f.box('chrome', 0.24, 0.325, 1.25, 0.025, 0.2, 0.02);
    }, 'end');
  }
  // Exhaust fan high on a wall.
  for (const W of byQuiet(c)) {
    const a = W.hang(0.35, r.height - 0.75, r.height - 0.35, 'end');
    if (a === null) continue;
    W.cyl('machineDark', a, 0.03, r.height - 0.55, 0.16, 0.06, { ax: 'z', seg: 12 });
    break;
  }
};

/** A steel sink set into a platform at a, with its tap. */
function sink(W: Wall, a: number): void {
  W.box('steel', a, 0.33, 0.85, 0.55, 0.015, 0.42);
  W.box('black', a, 0.33, 0.855, 0.42, 0.012, 0.3);
  W.cyl('chrome', a, 0.07, 0.85, 0.015, 0.3, { seg: 8 });
  W.cyl('chrome', a, 0.13, 1.13, 0.012, 0.12, { ax: 'z', seg: 8 });
}

// ==================================================================== washrooms

const washroom: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const lu = r.u1 - r.u0;
  const lv = r.v1 - r.v0;
  if (Math.min(lu, lv) < 2.0 || c.area < 6.5) {
    smallToilet(c);
    return;
  }
  const part: Mat = R() < 0.5 ? 'tile' : 'cream';
  const doorM: Mat = R() < 0.75 ? 'blue' : 'green';
  const H = Math.min(2.0, r.height - 0.3);
  // A row of cubicles along the front (or first wall that takes them).
  let used: Wall | null = null;
  for (const W of byFront(c)) {
    const cd = Math.min(1.4, W.depth - 1.0);
    if (cd < 1.1) continue;
    const s = W.run(cd, 1.0, 1.0);
    if (!s) continue;
    const cw = 0.92;
    const n = Math.min(8, Math.floor((s[1] - s[0] - 0.04) / cw));
    if (n < 1) continue;
    const a0 = s[0];
    const B = n * cw + 0.04;
    for (let i = 0; i <= n; i += 1) W.box(part, a0 + 0.02 + i * cw, cd / 2, 0, 0.04, H, cd, { solid: true });
    W.box(part, a0 + B / 2, cd - 0.03, H - 0.1, B, 0.1, 0.05);
    for (let i = 0; i < n; i += 1) {
      const ai = a0 + 0.02 + (i + 0.5) * cw;
      const dw = cw - 0.08;
      if (R() < 0.3) W.box(doorM, ai - cw / 2 + 0.05, cd - 0.03 - dw / 2, 0.12, 0.03, H - 0.25, dw);
      else W.box(doorM, ai, cd - 0.03, 0.12, dw, H - 0.25, 0.03, { solid: true });
      W.box('white', ai, cd * 0.5, 0, 0.42, 0.04, 0.58);
      W.box('black', ai, cd * 0.5 + 0.1, 0.035, 0.14, 0.01, 0.2);
      W.cyl('chrome', ai + 0.25, 0.06, 0.5, 0.012, 0.12, { ax: 'z', seg: 8 });
      mug(W, pick(R, PLASTIC), ai + 0.25, 0.2);
      if (R() < 0.4) bucket(W, pick(R, PLASTIC), ai - 0.22, 0.22);
    }
    // Drain strip along the cubicle fronts.
    W.box('steel', a0 + B / 2, cd + 0.18, 0, B, 0.008, 0.1);
    used = W;
    break;
  }
  const rest = byQuiet(c).filter((W) => W !== used);
  // Urinals (not in a girls' block).
  if (!/girl|women|ladies/i.test(`${r.building} ${r.name}`)) {
    for (const W of rest) {
      const s = W.run(0.35, 0.8, 1.2);
      if (!s) continue;
      const n = Math.min(5, Math.floor((s[1] - s[0]) / 0.65));
      for (let i = 0; i < n; i += 1) {
        const a = s[0] + 0.325 + i * 0.65;
        W.box('white', a, 0.15, 0.45, 0.36, 0.55, 0.3, { solid: true });
        W.cyl('chrome', a, 0.03, 1.0, 0.012, 0.35, { seg: 8 });
        if (i > 0) W.box('cream', a - 0.325, 0.2, 0.4, 0.03, 0.75, 0.4);
      }
      break;
    }
  }
  // Wash basins with a mirror strip.
  for (const W of rest) {
    const s = W.run(0.45, 0.8, 0.7);
    if (!s) continue;
    const n = Math.min(4, Math.floor((s[1] - s[0]) / 0.7));
    const a0 = s[0];
    for (let i = 0; i < n; i += 1) basin(W.at(a0 + 0.35 + i * 0.7, 0.225));
    const mw = n * 0.7 - 0.1;
    if (r.height > 2.0) W.box('chrome', a0 + (n * 0.7) / 2, 0.008, 1.15, mw, Math.min(0.65, r.height - 1.25), 0.012);
    break;
  }
  // Spare buckets and mugs.
  for (let i = 0; i < 2; i += 1) {
    place(rest, 0.45, 0.32, 0.6, (f) => {
      bucket(f, pick(R, PLASTIC), -0.07, 0);
      mug(f, pick(R, PLASTIC), 0.15, 0.05);
    }, i ? 'end' : 'start');
  }
};

/** A wash basin on its pedestal with a tap (frame at the basin centre, back to the wall). */
function basin(f: F): void {
  f.box('white', 0, 0, 0.66, 0.5, 0.16, 0.42, { solid: true });
  f.cyl('white', 0, -0.04, 0, 0.07, 0.66, { seg: 10 });
  f.cyl('chrome', 0, -0.17, 0.82, 0.015, 0.14, { seg: 8 });
}

/** A one-seat toilet: pan or commode, tap, bucket and mug, a basin with a mirror. */
function smallToilet(c: C): void {
  const { R, r } = c;
  const western = /quarter|staff|warden|house|bungalow/i.test(`${r.building} ${r.name}`) || R() < 0.3;
  const walls = byFront(c);
  const seat = place(walls, 0.5, 0.65, 0.45, (f) => {
    if (western) {
      f.box('white', 0, -0.24, 0.4, 0.4, 0.38, 0.16);
      f.cyl('white', 0, 0.05, 0, 0.17, 0.4, { r2: 0.2, seg: 12, solid: true });
      f.cyl('white', 0, 0.05, 0.4, 0.2, 0.03, { seg: 12 });
    } else {
      f.box('white', 0, 0, 0, 0.42, 0.04, 0.6);
      f.box('black', 0, 0.1, 0.035, 0.14, 0.01, 0.2);
    }
  }, 'mid');
  place(walls, 0.45, 0.32, 0.35, (f) => {
    bucket(f, pick(R, PLASTIC), -0.07, 0);
    mug(f, pick(R, PLASTIC), 0.15, 0.05);
    f.cyl('chrome', -0.07, -0.13, 0.55, 0.012, 0.06, { ax: 'z', seg: 8 });
  }, seat ? seat.a + 0.5 : 'start');
  const others = walls.filter((W) => !seat || W !== seat.W);
  place([...others, ...walls], 0.5, 0.42, 0.45, (f) => {
    basin(f);
    if (r.height > 1.9) f.box('chrome', 0, -0.205, 1.12, 0.42, Math.min(0.55, r.height - 1.2), 0.01);
  }, 'mid');
  for (const W of walls) {
    const a = W.hang(0.35, 1.2, 1.75, 'end');
    if (a === null) continue;
    W.box('chrome', a, 0.015, 1.68, 0.3, 0.03, 0.03);
    W.box(pick(R, CLOTHES), a, 0.02, 1.2, 0.28, 0.48, 0.015);
    break;
  }
}

// ==================================================================== staff quarters

const living: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const body = pick(R, ['fabric', 'cushion', 'fabric', 'darkwood'] as const);
  const cush: Mat = body === 'darkwood' ? 'cushion' : pick(R, ['pillow', 'cushion', 'cream'] as const);
  const rug = pick(R, ['red', 'blue', 'cushion'] as const);
  // TV cabinet on the front wall, the sofa facing it, a centre table and rug between.
  const tv = place([c.front, ...c.sides], 1.4, 0.45, 2.0, (f) => {
    tvUnit(f, 1.4, 0.45, false);
    if (R() < 0.6) f.cyl('plant', 0.55, 0, 0.5, 0.08, 0.25, { r2: 0.02, seg: 8 });
  }, 'mid');
  let sofaDone = false;
  if (tv) {
    const W = tv.W;
    const sw = Math.min(1.9, W.len - 1.4);
    if (sw >= 1.3) {
      const z = facing(tv, 1.7, sw, 0.8, (f) => sofa(f, sw, body, cush, R));
      if (z !== null) {
        sofaDone = true;
        const gap = z - 0.4 - 0.45;
        if (gap >= 1.5) {
          const zt = z - 0.4 - 0.4 - 0.25;
          if (W.ok(tv.a, zt, 1.0, 0.5)) {
            W.box(rug, tv.a, (zt + z - 0.4) / 2 - 0.05, 0, Math.min(2.0, sw + 0.2), 0.01, Math.min(1.6, gap - 0.2));
            const t = W.at(tv.a, zt);
            table4(t, 1.0, 0.5, 'darkwood', 'darkwood', 0.42);
            if (R() < 0.6) t.box('paper', 0.2, 0, 0.42, 0.3, 0.01, 0.22, { rot: 0.3 });
            if (R() < 0.6) t.cyl('white', -0.25, 0.05, 0.42, 0.04, 0.09, { seg: 8 });
          }
        }
        // Single seats along the side walls, facing in, beside the centre table (never beside the sofa).
        const [su, sv] = W.uv(tv.a, (0.45 + z - 0.4) / 2);
        for (const L of c.sides) {
          if (L === W || L.side === OPP[W.side] || R() < 0.25) continue;
          const a = L.local(su, sv)[0];
          if (z - 0.4 - 0.45 < 0.95 + 0.5 || !L.ok(a, 0.4, 0.95, 0.8) || !L.open(a, 0.8 + 0.4, 0.95, 0.8)) continue;
          sofa(L.at(a, 0.4), 0.95, body, cush, R);
        }
      }
    }
  }
  if (!sofaDone) place(byQuiet(c), 1.9, 0.8, 0.9, (f) => sofa(f, 1.9, body, cush, R), 'mid');
  // Dining table with four chairs if there is space.
  const dt = spot(c, 1.2, 0.8, 0.85);
  if (dt) {
    table4(dt, 1.2, 0.8, 'wood', 'darkwood');
    for (const x of [-0.3, 0.3]) {
      chair(dt.at(x, -0.6), 'wood', -1);
      chair(dt.at(x, 0.6), 'wood', 1);
    }
    if (R() < 0.7) dt.cyl('steel', 0, 0, 0.75, 0.12, 0.08, { seg: 10 });
  }
  // Showcase with crockery and trophies.
  place(byQuiet(c), 1.0, 0.4, 0.9, (f) => {
    f.solid(0, 0, 1.0, 1.84, 0.4);
    f.box('darkwood', 0, 0, 0, 1.0, 0.8, 0.4);
    f.box('darkwood', 0, -0.185, 0.8, 1.0, 1.0, 0.03);
    f.box('darkwood', -0.485, 0.015, 0.8, 0.03, 1.0, 0.37);
    f.box('darkwood', 0.485, 0.015, 0.8, 0.03, 1.0, 0.37);
    f.box('darkwood', 0, 0, 1.8, 1.0, 0.04, 0.4);
    f.box('glass', 0, 0, 1.3, 0.94, 0.015, 0.36);
    f.box('glass', 0, 0.19, 0.8, 0.94, 1.0, 0.01);
    for (let i = 0; i < 4; i += 1) {
      const m = pick(R, ['white', 'yellow', 'chrome', 'cream'] as const);
      f.cyl(m, -0.33 + i * 0.22, -0.02, i % 2 ? 1.315 : 0.8, 0.05, 0.12 + R() * 0.15, { seg: 8 });
    }
  }, 'end');
  const pc = corner(c, 0.22);
  if (pc) plant(pc, R, 0.8);
  for (const W of [...c.sides, c.front]) {
    const a = W.hang(0.5, 1.45, 1.85, 'mid');
    if (a === null) continue;
    photo(W, a, 1.45, 0.5, 0.38);
    break;
  }
  for (const W of [c.back, ...c.sides]) {
    const a = W.hang(0.3, 1.95, 2.25);
    if (a === null) continue;
    clock(W, a, 2.1);
    break;
  }
  fans(c, 2);
};

const bedroom: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const sheet = pick(R, ['fabric', 'red', 'blue', 'cream', 'green', 'cushion'] as const);
  const walls = [c.front, ...c.sides, c.back];
  // Double bed, head to a wall, with bedside tables.
  const bed2 = (bw: number, tables: boolean) => (f: F) => {
    const L = 2.0;
    f.box('wood', 0, 0, 0, bw, 0.4, L, { solid: true });
    f.box('darkwood', 0, -L / 2 + 0.03, 0, bw, 1.05, 0.06);
    f.box('mattress', 0, 0.03, 0.4, bw - 0.06, 0.16, L - 0.12);
    f.box(sheet, 0, 0.27, 0.56, bw - 0.04, 0.03, L - 0.62);
    for (const s of [-1, 1]) f.box('pillow', (s * bw) / 4, -L / 2 + 0.3, 0.56, bw / 2 - 0.12, 0.12, 0.36);
    if (tables) {
      for (const s of [-1, 1]) {
        const t = f.at(s * (bw / 2 + 0.25), -L / 2 + 0.21);
        t.box('wood', 0, 0, 0, 0.42, 0.55, 0.42, { solid: true });
        if (s < 0 || R() < 0.5) {
          t.cyl('steel', 0, -0.05, 0.55, 0.06, 0.25, { seg: 8 });
          t.cyl('cream', 0, -0.05, 0.8, 0.14, 0.18, { r2: 0.08, seg: 10 });
        }
      }
    }
  };
  place(walls, 1.5 + 1.0, 2.0, 0.7, bed2(1.5, true), 'mid') ??
    place(walls, 1.5, 2.0, 0.7, bed2(1.5, false), 'mid') ??
    place(walls, 1.2, 2.0, 0.6, bed2(1.2, false), 'mid') ??
    place(walls, 1.9, 0.9, 0.6, (f) => cot(f, R, { frame: 'wood', blanket: sheet, messy: false, trunk: null }), 'mid');
  place(byQuiet(c), 1.2, 0.6, 0.8, (f) => {
    almirah(f, pick(R, ['darkwood', 'wood', 'metal'] as const), 1.2, 0.6, 2.0);
    f.box('black', -0.3, 0.3, 0.06, 0.01, 1.88, 0.01);
  }, 'end');
  // Dressing table with mirror and stool.
  place(byQuiet(c), 0.8, 0.45, 0.8, (f) => {
    f.box('wood', 0, 0, 0, 0.8, 0.72, 0.42, { solid: true });
    f.box('darkwood', 0, -0.19, 0.72, 0.6, 0.85, 0.03);
    f.box('chrome', 0, -0.17, 0.78, 0.52, 0.72, 0.01);
    for (let i = 0; i < 2 + Math.floor(R() * 2); i += 1) f.cyl(pick(R, ['white', 'red', 'chrome', 'yellow'] as const), -0.3 + i * 0.09, 0.08, 0.72, 0.025, 0.09 + R() * 0.08, { seg: 8 });
    f.cyl('cushion', 0, 0.48, 0, 0.17, 0.45, { seg: 10 });
  }, 'start');
  // Study desk.
  place(byQuiet(c), 1.0, 0.55, 1.2, (f) => {
    deskTable(f, 1.0, 0.55, 'wood');
    f.box('books', -0.3, -0.12, 0.75, 0.25, 0.1 + R() * 0.12, 0.18);
    if (R() < 0.5) {
      f.box('black', 0.15, -0.12, 0.75, 0.36, 0.02, 0.25);
      f.box('black', 0.15, -0.24, 0.77, 0.36, 0.24, 0.015);
    }
    chair(f.at(0, 0.42), 'wood', 1);
  }, 'end');
  for (const W of walls) {
    const a = W.hang(0.45, 1.5, 1.85);
    if (a === null) continue;
    photo(W, a, 1.5, 0.45, 0.35);
    break;
  }
  fans(c, 1);
};

// ==================================================================== small rooms

const guard: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const order = byQuiet(c);
  const desk = place(order, 0.9, 0.5, 0.8, (f) => {
    deskTable(f, 0.9, 0.5, 'wood');
    register(f, -0.15, 0, 0.75, pick(R, ['red', 'blue', 'black'] as const));
    phone(f, 0.3, -0.05, 0.75);
    if (R() < 0.6) f.cyl('red', 0.35, 0.15, 0.75, 0.04, 0.28, { seg: 8 });
    chair(f.at(0, 0.45), 'wood', 1);
  }, 'start');
  const cotO = { frame: 'metal' as Mat, blanket: pick(R, BLANKETS), messy: R() < 0.5, trunk: null, len: 1.8, wid: 0.75 };
  if (!place(order, 1.8, 0.75, 0.6, (f) => cot(f, R, cotO), 'end')) place(order, 0.75, 1.8, 0.6, (f) => cot(f, R, cotO), 'end', 1);
  if (desk) {
    const a = desk.W.hang(0.3, 1.85, 2.15, desk.a);
    if (a !== null) clock(desk.W, a, 2.0);
  }
  for (const W of order) {
    const a = W.hang(0.32, 1.3, 1.75, 'end');
    if (a === null) continue;
    W.box('metal', a, 0.04, 1.3, 0.3, 0.4, 0.08);
    W.box('black', a, 0.081, 1.33, 0.008, 0.34, 0.004);
    W.box('chrome', a + 0.05, 0.085, 1.48, 0.02, 0.05, 0.01);
    break;
  }
  // The lathi stands in a corner.
  const cs = corner(c, 0.06);
  if (cs) cs.cyl('wood', 0, 0, 0, 0.016, 1.5, { seg: 8 });
  if (c.area >= 5) fans(c, 1);
};

const changing: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const lu = r.u1 - r.u0;
  const lv = r.v1 - r.v0;
  const longWalls = lu >= lv ? [c.W.v0, c.W.v1] : [c.W.u0, c.W.u1];
  const lm: Mat = R() < 0.5 ? 'metal' : 'blue';
  const h = Math.min(1.85, r.height - 0.3);
  // Lockers along the long walls.
  for (const W of longWalls) {
    const s = W.run(0.45, 1.0, 0.8);
    if (!s) continue;
    const a0 = s[0];
    const a1 = Math.min(s[1], s[0] + 6);
    const len = a1 - a0;
    W.box(lm, (a0 + a1) / 2, 0.225, 0, len, h, 0.45, { solid: true });
    const n = Math.max(1, Math.round(len / 0.4));
    const cw = len / n;
    for (let i = 1; i < n; i += 1) W.box('black', a0 + i * cw, 0.452, 0.05, 0.01, h - 0.1, 0.006);
    W.box('black', (a0 + a1) / 2, 0.452, h / 2, len - 0.04, 0.01, 0.006);
    for (let i = 0; i < n; i += 1) W.box('chrome', a0 + (i + 0.8) * cw, 0.46, h / 2 + 0.15, 0.02, 0.07, 0.012);
  }
  // Benches down the middle, along the long axis.
  const W0 = longWalls[0];
  let benched = false;
  for (let bl = Math.min(W0.len - 1.8, 6); bl >= 1.0; bl -= 0.5) {
    const z = W0.depth / 2;
    const a = W0.len / 2;
    if (W0.fits(a, z, bl, 0.35) && W0.open(a, z, bl, 0.35 + 1.3) && W0.keeps(a, z, bl, 0.35)) {
      bench(W0.at(a, z), bl, 'wood', false, 0.35);
      benched = true;
      break;
    }
  }
  if (!benched) place(byQuiet(c), 1.5, 0.38, 0.8, (f) => bench(f, 1.5), 'mid');
  // Hooks with a few things hanging, and a mirror.
  for (const W of byQuiet(c)) {
    const a = W.hang(1.2, 1.2, 1.8);
    if (a === null) continue;
    W.box('wood', a, 0.015, 1.65, 1.2, 0.08, 0.03);
    for (let i = 0; i < 4; i += 1) {
      const x = a - 0.45 + i * 0.3;
      W.box('chrome', x, 0.05, 1.62, 0.02, 0.02, 0.06);
      if (R() < 0.45) W.box(pick(R, CLOTHES), x, 0.04, 1.15, 0.28, 0.48, 0.03);
    }
    break;
  }
  for (const W of [...byQuiet(c)].reverse()) {
    const a = W.hang(0.6, 1.05, 1.95);
    if (a === null) continue;
    W.box('chrome', a, 0.008, 1.05, 0.6, 0.9, 0.012);
    break;
  }
};

const shop: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const W = c.front;
  const H = Math.min(2.0, r.height - 0.2);
  // Shelves of pens, paper and files against the front wall.
  let backDepth = 0;
  const s = W.run(0.35, 0.7, 0.9);
  if (s) {
    const n = Math.min(c.area < 12 ? 2 : 3, Math.floor((s[1] - s[0]) / 1.0));
    for (let i = 0; i < n; i += 1) shelfUnit(W.at(s[0] + 0.5 + i * 1.0, 0.175), H, R);
    if (n > 0) backDepth = 0.35;
  }
  // The photocopier behind the counter (front wall) if there is room, else anywhere.
  const pc = place([W], 0.65, 0.65, 0.7, (f) => copier(f), 'end');
  if (pc) backDepth = 0.65;
  // Glass-topped counter across the shop with a gap at one end; the shopkeeper's stool behind it.
  let counter = false;
  for (const zb of [backDepth, 0.35, 0]) {
    const zc = zb + 0.75 + 0.275;
    for (let cl = Math.min(W.len - 0.9, 3.0); cl >= 1.0; cl -= 0.4) {
      const a = W.slot(cl, 0.55, 0.9, 'start', zc - 0.275);
      if (a === null) continue;
      const f = W.at(a, zc);
      f.box('plywood', 0, 0, 0, cl, 0.6, 0.55, { solid: true });
      f.box('glass', 0, 0, 0.6, cl, 0.3, 0.55);
      f.box('wood', 0, 0, 0.9, cl, 0.02, 0.55);
      for (let i = 0; i < Math.min(5, Math.floor(cl / 0.45)); i += 1) f.box(pick(R, ['blue', 'red', 'paper', 'yellow', 'black', 'green'] as const), -cl / 2 + 0.25 + i * 0.45, (R() - 0.5) * 0.2, 0.6, 0.18, 0.03, 0.12 + R() * 0.1);
      // Printer and a small monitor on the counter.
      f.box('black', cl / 2 - 0.3, -0.05, 0.92, 0.42, 0.2, 0.34);
      f.box('paper', cl / 2 - 0.3, 0.05, 1.12, 0.3, 0.005, 0.2);
      if (cl > 1.6) {
        f.box('black', -cl / 2 + 0.3, -0.15, 0.92, 0.12, 0.12, 0.1);
        f.box('black', -cl / 2 + 0.3, -0.15, 1.04, 0.42, 0.28, 0.03);
        f.box('screen', -cl / 2 + 0.3, -0.13, 1.06, 0.38, 0.24, 0.01);
      }
      const sa = a + (R() - 0.5) * 0.4;
      if (W.free(sa, zc - 0.275 - 0.35, 0.17)) stool(W.at(sa, zc - 0.275 - 0.35), pick(R, PLASTIC));
      counter = true;
      break;
    }
    if (counter) break;
  }
  if (!pc) place(byQuiet(c), 0.65, 0.65, 0.8, (f) => copier(f), 'end');
  // A rack of notebooks on the customer side.
  place([...c.sides, c.back], 1.0, 0.3, 0.8, (f) => shelfUnit(f, Math.min(1.6, H), R, 0.3), 'mid');
  fans(c, 1);
};

/** An open shelf unit 1 m wide of paper reams, files and pens (frame at its centre). */
function shelfUnit(f: F, h: number, R: () => number, d = 0.35): void {
  f.solid(0, 0, 1.0, h, d);
  f.box('plywood', 0, -d / 2 + 0.01, 0, 1.0, h, 0.02);
  f.box('wood', -0.485, 0, 0, 0.03, h, d);
  f.box('wood', 0.485, 0, 0, 0.03, h, d);
  const n = Math.max(2, Math.floor(h / 0.5));
  for (let i = 0; i < n; i += 1) {
    const y = 0.05 + (i * (h - 0.1)) / n;
    f.box('wood', 0, 0, y, 0.94, 0.025, d - 0.02);
    let x = -0.42;
    while (x < 0.36) {
      const w = 0.2 + R() * 0.16;
      if (x + w > 0.46) break;
      const m = pick(R, ['paper', 'paper', 'blue', 'red', 'yellow', 'green', 'books'] as const);
      f.box(m, x + w / 2, 0, y + 0.025, w - 0.02, 0.08 + R() * 0.22, d - 0.08);
      x += w + 0.03;
    }
  }
}

/** A big office photocopier on its cabinet. */
function copier(f: F): void {
  f.box('machineDark', 0, 0, 0, 0.6, 0.45, 0.6, { solid: true });
  f.box('white', 0, 0, 0.45, 0.62, 0.38, 0.62);
  f.box('machine', 0, -0.03, 0.83, 0.6, 0.04, 0.5);
  f.box('white', 0.2, 0.22, 0.83, 0.18, 0.02, 0.1);
  f.box('screen', 0.2, 0.25, 0.85, 0.12, 0.02, 0.06);
  f.box('paper', -0.15, 0.1, 0.64, 0.3, 0.02, 0.4);
}

// ==================================================================== polyhouse

const farm: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const lu = r.u1 - r.u0;
  const lv = r.v1 - r.v0;
  // Beds run along the long axis; the service end (tank, rack, controller) is the end farthest from the doors.
  const ends = lu >= lv ? [c.W.u0, c.W.u1] : [c.W.v0, c.W.v1];
  ends.sort((p, q) => (q.side === r.front ? 1 : 0) - (p.side === r.front ? 1 : 0) || p.doors.length - q.doors.length);
  const E = ends[0];
  const L = E.depth;
  const Wd = E.len;
  const service = L >= 7 ? 1.3 : L >= 4.5 ? 0.7 : 0;
  if (service > 0) {
    // Water tank on a plinth in one corner, a seedling rack beside it, the controller on a post.
    for (const x of [0.6, Wd - 0.6]) {
      if (L < 7 || !E.ok(x, 0.6, 1.2, 1.2)) continue;
      E.box('concrete', x, 0.6, 0, 1.1, 0.3, 1.1, { solid: true });
      E.cyl('black', x, 0.6, 0.3, 0.5, 1.1, { seg: 12 });
      E.cyl('black', x, 0.6, 1.4, 0.12, 0.06, { seg: 8 });
      break;
    }
    const ra = E.slot(1.2, 0.5, 0.75, 'mid');
    if (ra !== null) rack(E.at(ra, 0.25), R);
    const ca = E.slot(0.4, 0.3, 0.6, 'end');
    if (ca !== null) {
      const f = E.at(ca, 0.15);
      f.cyl('metal', 0, 0, 0, 0.04, 1.6, { seg: 8, solid: true });
      f.box('white', 0, 0.05, 1.0, 0.4, 0.5, 0.18);
      f.box('screen', 0, 0.145, 1.2, 0.26, 0.18, 0.01);
      f.box('green', -0.12, 0.145, 1.08, 0.04, 0.04, 0.01);
      f.box('red', -0.04, 0.145, 1.08, 0.04, 0.04, 0.01);
    }
  }
  const z0 = service > 0 ? (L >= 7 ? 1.3 : 0.5) + 0.75 : 0.75;
  const z1 = L - 0.9;
  const bw = Wd >= 7 ? 1.2 : 1.0;
  const aisle = 0.75;
  const nb = Math.max(1, Math.floor((Wd + aisle) / (bw + aisle)));
  const span = nb * bw + (nb - 1) * aisle;
  const bedMat: Mat = R() < 0.5 ? 'concrete' : 'wood';
  if (span <= Wd + EPS && z1 - z0 >= 1.2) {
    for (let i = 0; i < nb; i += 1) {
      const x = (Wd - span) / 2 + bw / 2 + i * (bw + aisle);
      const crop = Math.floor(R() * 4);
      // Split the bed round any doorway that cuts it.
      let start = -1;
      for (let z = z0; z <= z1 + 0.05; z += 0.1) {
        const ok = z + 0.1 <= z1 + EPS && E.fits(x, z + 0.05, bw, 0.1);
        if (ok && start < 0) start = z;
        if (!ok && start >= 0) {
          if (z - start >= 1.2 && E.keeps(x, (start + z) / 2, bw, z - start)) raisedBed(E, x, start + 0.01, z - 0.01, bw, bedMat, crop, R);
          start = -1;
        }
      }
    }
  }
  if (service === 0) place(byQuiet(c), 1.2, 0.5, 0.7, (f) => rack(f, R), 'mid');
};

/** A raised planter bed from za to zb (along the frame's z) with plants and drip lines. */
function raisedBed(E: Wall, x: number, za: number, zb: number, bw: number, mat: Mat, crop: number, R: () => number): void {
  const len = zb - za;
  const zc = (za + zb) / 2;
  E.box(mat, x, zc, 0, bw, 0.4, len, { solid: true });
  E.box('soil', x, zc, 0.4, bw - 0.1, 0.02, len - 0.1);
  const rows = bw >= 1.2 ? 3 : 2;
  const sp = [0.4, 0.5, 0.45, 0.35][crop];
  const n = Math.min(40, Math.floor((len - 0.2) / sp));
  for (let j = 0; j < rows; j += 1) {
    const xr = x - bw / 2 + ((j + 0.5) * bw) / rows;
    E.cyl('black', xr, zc, 0.43, 0.008, len - 0.2, { ax: 'z', seg: 8 });
    for (let i = 0; i < n; i += 1) {
      const z = za + 0.1 + sp / 2 + i * sp + (j % 2 ? sp / 4 : 0);
      if (z > zb - 0.1) break;
      if (R() < 0.08) continue;
      const g = 0.7 + R() * 0.5;
      if (crop === 0) E.box('plant', xr, z, 0.42, 0.2 * g, 0.12 * g, 0.2 * g); // lettuce
      else if (crop === 1) E.cyl('plant', xr, z, 0.42, 0.17, 0.75 * g, { r2: 0.03, seg: 8 }); // tomato
      else if (crop === 2) E.cyl('plant', xr, z, 0.42, 0.14, 0.4 * g, { r2: 0.09, seg: 8 }); // capsicum
      else E.cyl('plant', xr, z, 0.42, 0.11, 0.12 * g, { r2: 0.07, seg: 8 }); // strawberry
    }
  }
}

/** A steel rack of seedling trays (frame at its centre, 1.2 × 0.5). */
function rack(f: F, R: () => number): void {
  f.solid(0, 0, 1.2, 1.5, 0.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box('metal', sx * 0.58, sz * 0.23, 0, 0.04, 1.5, 0.04);
  for (let i = 0; i < 3; i += 1) {
    const y = 0.3 + i * 0.5;
    f.box('metal', 0, 0, y, 1.2, 0.03, 0.5);
    f.box('black', 0, 0, y + 0.03, 1.1, 0.05, 0.44);
    f.box('plant', 0, 0, y + 0.08, 1.06, 0.04 + R() * 0.08, 0.4);
  }
}

// ==================================================================== sheds

const utility: Furnisher = (r, k) => {
  const c = setup(r, k);
  const { R } = c;
  const order = byQuiet(c);
  const items: [number, number, (f: F) => void][] = [
    [0.9, 0.5, (f) => almirah(f, 'metal')],
    [0.5, 0.5, (f) => chairStack(f, pick(R, ['red', 'white', 'chair'] as const), 2 + Math.floor(R() * 4))],
    [1.0, 0.6, (f) => cartons(f, R)],
    [1.7, 0.55, (f) => bicycle(f, pick(R, ['black', 'red', 'blue', 'green'] as const))],
    [0.9, 0.5, (f) => {
      for (let i = 0; i < 3; i += 1) f.cyl(pick(R, ['cream', 'paper', 'cream'] as const), -0.28 + i * 0.28, (R() - 0.5) * 0.08, 0, 0.17, 0.5 + R() * 0.15, { r2: 0.14, seg: 8, solid: i === 1 });
    }],
    [1.2, 0.6, (f) => deskTable(f, 1.2, 0.6, 'wood')],
  ];
  // Shuffle so sheds differ.
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(R() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  const n = clamp(Math.round(c.area / 3), 2, items.length);
  for (let i = 0; i < n; i += 1) {
    const [w, d, draw] = items[i];
    place(order, w, d, 0.7, draw, pick(R, ['start', 'end', 'mid'] as const));
  }
  // A shovel in a corner.
  const cs = corner(c, 0.12);
  if (cs) {
    cs.cyl('wood', 0, 0, 0.25, 0.017, 1.0, { seg: 8 });
    cs.box('metal', 0, 0, 0, 0.22, 0.28, 0.03);
  }
};

/** Plastic chairs stacked n high. */
function chairStack(f: F, mat: Mat, n: number): void {
  f.solid(0, 0, 0.46, 0.9 + n * 0.07, 0.46);
  chair(f, mat, -1);
  for (let i = 1; i < n; i += 1) {
    f.box(mat, 0, 0.01, 0.43 + i * 0.07, 0.44, 0.04, 0.42);
    f.box(mat, 0, -0.19, 0.5 + i * 0.07, 0.42, 0.4, 0.04);
  }
}

/** A heap of cardboard cartons. */
function cartons(f: F, R: () => number): void {
  f.solid(0, 0, 1.0, 0.5, 0.6);
  f.box('plywood', -0.25, 0, 0, 0.48, 0.42, 0.55);
  f.box('plywood', 0.25, -0.02, 0, 0.46, 0.36 + R() * 0.12, 0.5);
  f.box('plywood', -0.22, 0.02, 0.42, 0.4, 0.3, 0.42);
  if (R() < 0.6) f.box('plywood', -0.2, 0, 0.72, 0.3, 0.22, 0.3);
  if (R() < 0.5) f.box('paper', 0.25, 0, 0.5, 0.3, 0.12, 0.3);
}

/** A bicycle leaning on its stand, along x. */
function bicycle(f: F, mat: Mat): void {
  f.solid(0, 0, 1.6, 1.0, 0.3);
  for (const x of [-0.52, 0.52]) f.cyl('rubber', x, 0, 0.33, 0.32, 0.04, { ax: 'z', seg: 12 });
  f.box(mat, 0.05, 0, 0.72, 0.62, 0.035, 0.035);
  f.box(mat, 0.02, 0, 0.45, 0.7, 0.035, 0.035);
  f.box(mat, -0.26, 0, 0.32, 0.52, 0.03, 0.05);
  f.cyl(mat, -0.28, 0, 0.32, 0.018, 0.55, { seg: 8 });
  f.box('black', -0.28, 0, 0.87, 0.24, 0.05, 0.11);
  f.cyl(mat, 0.47, 0, 0.33, 0.018, 0.65, { seg: 8 });
  f.cyl('black', 0.47, 0, 0.98, 0.015, 0.5, { ax: 'z', seg: 8 });
}

export const FURNISH: Record<string, Furnisher> = {
  dorm,
  warden,
  common,
  mess,
  kitchen,
  washroom,
  toilet: washroom,
  living,
  bedroom,
  guard,
  changing,
  shop,
  farm,
  utility,
};
