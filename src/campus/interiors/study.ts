// Room furnishers (study): classrooms, studios, labs, halls, offices, sections, libraries,
// the canteen and the like. See kit.ts for the Room / Kit API.
//
// Layouts are written "front-relative" through a Frame: f is the distance from the room's
// front wall (board, stage, counter wall) and x the offset across the room from its middle
// line, so one layout works for every room orientation. Small things are built in an Obj's
// own axes (a = the way it faces, b = sideways) so a chair or a desk can face any way. Only
// quarter turns are used, so nothing depends on which way the building's axes are handed.

import type { Furnisher, Kit, Mat, Room, Side } from './kit.ts';

const EPS = 1e-6;

// ==================================================================== frames

type Wall = 'front' | 'back' | 'left' | 'right';

/** Wall things already hung (boards, frames) or stood (cupboards), so others avoid them. */
interface Mark { side: Side; a: number; b: number; y0: number; y1: number }
interface Ctx { room: Room; k: Kit; marks: Mark[] }

/** Unit (u, v) vectors of the depth axis (away from the front wall) and the across axis. */
const AXES: Record<Side, readonly [number, number, number, number]> = {
  u0: [1, 0, 0, 1],
  u1: [-1, 0, 0, -1],
  v0: [0, 1, -1, 0],
  v1: [0, -1, 1, 0],
};
const OPP: Record<Side, Side> = { u0: 'u1', u1: 'u0', v0: 'v1', v1: 'v0' };
/** The wall whose outward normal is (du, dv). */
const sideOf = (du: number, dv: number): Side => (du > 0.5 ? 'u1' : du < -0.5 ? 'u0' : dv > 0.5 ? 'v1' : 'v0');
const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

class Frame {
  readonly c: Ctx;
  readonly side: Side;
  /** Across (x) and deep (f) extents and the clear height. */
  readonly W: number;
  readonly D: number;
  readonly H: number;
  /** Door centres in this frame. */
  readonly doors: { f: number; x: number }[];
  private readonly fu: number;
  private readonly fv: number;
  private readonly xu: number;
  private readonly xv: number;
  private readonly ou: number;
  private readonly ov: number;
  private readonly alongU: boolean;

  constructor(c: Ctx, side: Side) {
    const r = c.room;
    this.c = c;
    this.side = side;
    const ax = AXES[side];
    this.fu = ax[0];
    this.fv = ax[1];
    this.xu = ax[2];
    this.xv = ax[3];
    this.alongU = this.fu !== 0;
    this.D = this.alongU ? r.u1 - r.u0 : r.v1 - r.v0;
    this.W = this.alongU ? r.v1 - r.v0 : r.u1 - r.u0;
    this.H = r.height;
    this.ou = side === 'u0' ? r.u0 : side === 'u1' ? r.u1 : (r.u0 + r.u1) / 2;
    this.ov = side === 'v0' ? r.v0 : side === 'v1' ? r.v1 : (r.v0 + r.v1) / 2;
    this.doors = r.doors.map((d) => this.local(d.u, d.v));
  }

  get room(): Room {
    return this.c.room;
  }

  rand(): number {
    return this.c.room.rand();
  }

  /** The frame whose front is the given wall of this one. */
  wall(w: Wall): Frame {
    const s = w === 'front' ? this.side : w === 'back' ? OPP[this.side] : w === 'right' ? sideOf(this.xu, this.xv) : sideOf(-this.xu, -this.xv);
    return s === this.side ? this : new Frame(this.c, s);
  }

  uv(f: number, x: number): [number, number] {
    return [this.ou + f * this.fu + x * this.xu, this.ov + f * this.fv + x * this.xv];
  }

  local(u: number, v: number): { f: number; x: number } {
    const du = u - this.ou;
    const dv = v - this.ov;
    return { f: du * this.fu + dv * this.fv, x: du * this.xu + dv * this.xv };
  }

  /** A point of `o` (another frame) in this one. */
  from(o: Frame, f: number, x: number): { f: number; x: number } {
    const [u, v] = o.uv(f, x);
    return this.local(u, v);
  }

  inside(f: number, x: number, w: number, d: number): boolean {
    return f - d / 2 >= -EPS && f + d / 2 <= this.D + EPS && Math.abs(x) + w / 2 <= this.W / 2 + EPS;
  }

  /** w across × d deep footprint centred at (f, x): in the room, clear of doorways and solids. */
  fits(f: number, x: number, w: number, d: number): boolean {
    if (!this.inside(f, x, w, d)) return false;
    const [u, v] = this.uv(f, x);
    return this.alongU ? this.c.room.fits(u, v, d, w) : this.c.room.fits(u, v, w, d);
  }

  free(f: number, x: number, r = 0.3): boolean {
    return this.fits(f, x, r * 2, r * 2);
  }

  /** Something that should be there was asked for outside the room (a no-op in the game). */
  private miss(): void {}

  box(m: Mat, f: number, x: number, y: number, w: number, h: number, d: number, solid = false): void {
    if (!(w > 0 && h > 0 && d > 0)) return;
    if (y < -EPS || y + h > this.H + 0.005 || !this.inside(f, x, w - 0.004, d - 0.004)) return this.miss();
    const [u, v] = this.uv(f, x);
    const o = solid ? { solid } : undefined;
    if (this.alongU) this.c.k.box(m, u, v, y, d, h, w, o);
    else this.c.k.box(m, u, v, y, w, h, d, o);
  }

  /** axis 'y' upright (y = bottom); 'f' / 'x' lying along that axis (y = centre). */
  cyl(m: Mat, f: number, x: number, y: number, r: number, h: number, o: { axis?: 'y' | 'f' | 'x'; seg?: number; r2?: number } = {}): void {
    const axis = o.axis ?? 'y';
    const rr = Math.max(r, o.r2 ?? r);
    const [w, d, lo, hi] = axis === 'y' ? [rr * 2, rr * 2, y, y + h] : axis === 'f' ? [rr * 2, h, y - rr, y + rr] : [h, rr * 2, y - rr, y + rr];
    if (lo < -EPS || hi > this.H + 0.005 || !this.inside(f, x, w - 0.004, d - 0.004)) return this.miss();
    const [u, v] = this.uv(f, x);
    const kAxis = axis === 'y' ? 'y' : (axis === 'f') === this.alongU ? 'u' : 'v';
    this.c.k.cyl(m, u, v, y, r, h, { axis: kAxis, seg: o.seg ?? 10, r2: o.r2 });
  }

  /** An invisible collider that also reserves the footprint. */
  reserve(f: number, x: number, w: number, d: number, h: number): void {
    this.box('none', f, x, 0, w, Math.min(h, this.H), d, true);
  }

  /** Reserve the footprint if it fits. */
  put(f: number, x: number, w: number, d: number, h: number): boolean {
    if (!this.fits(f, x, w, d)) return false;
    this.reserve(f, x, w, d, h);
    return true;
  }

  // ------------------------------------------------ this frame's front wall as a wall

  /** True when a w-wide span of the front wall at x, heights y0..y1, is clear of doors and other wall things. */
  wallFree(x: number, w: number, y0: number, y1: number): boolean {
    if (Math.abs(x) + w / 2 > this.W / 2 + EPS) return false;
    if (this.doors.some((d) => Math.hypot(Math.max(0, d.f), Math.max(0, Math.abs(d.x - x) - w / 2)) < 0.65)) return false;
    return !this.c.marks.some((m) => m.side === this.side && x - w / 2 < m.b - 0.01 && x + w / 2 > m.a + 0.01 && y0 < m.y1 && y1 > m.y0);
  }

  mark(x: number, w: number, y0: number, y1: number): void {
    this.c.marks.push({ side: this.side, a: x - w / 2, b: x + w / 2, y0, y1 });
  }

  /** The clear spot on the front wall nearest `prefer` for a w-wide wall thing, or null. */
  spot(w: number, y0: number, y1: number, prefer = 0): number | null {
    const xs: number[] = [];
    for (let x = -this.W / 2 + w / 2; x <= this.W / 2 - w / 2 + EPS; x += 0.1) xs.push(x);
    xs.sort((p, q) => Math.abs(p - prefer) - Math.abs(q - prefer));
    for (const x of xs) if (this.wallFree(x, w, y0, y1)) return x;
    return null;
  }

  /**
   * Stand up to n things (sb wide along the wall, sa deep, h high) against the front wall, best
   * `score` first. Each is reserved and handed over as an Obj facing into the room.
   */
  run(sb: number, sa: number, h: number, n: number, score: (x: number) => number, draw: (o: Obj, i: number) => void, ok?: (x: number) => boolean): number {
    const xs: number[] = [];
    for (let x = -this.W / 2 + sb / 2; x <= this.W / 2 - sb / 2 + EPS; x += 0.1) xs.push(x);
    xs.sort((p, q) => score(p) - score(q));
    let placed = 0;
    for (const x of xs) {
      if (placed >= n) break;
      if (ok && !ok(x)) continue;
      if (!this.wallFree(x, sb, 0, h)) continue;
      if (!this.put(sa / 2, x, sb, sa, h)) continue;
      this.mark(x, sb, 0, h);
      draw(new Obj(this, sa / 2, x, 2), placed);
      placed += 1;
    }
    return placed;
  }
}

function frameOf(room: Room, k: Kit): Frame {
  return new Frame({ room, k, marks: [] }, room.front);
}

/** Scores for Frame.run: lower is better. */
const corners = (x: number): number => -Math.abs(x);
const middle = (x: number): number => Math.abs(x);
/** Along wall frame G, nearer the back (door side) of frame F first. */
const towardBack = (F: Frame, G: Frame) => (x: number): number => -F.from(G, 0.4, x).f;
const towardFront = (F: Frame, G: Frame) => (x: number): number => F.from(G, 0.4, x).f;
/** Filter for Frame.run on wall G: the sb-wide thing stays out of F's depth band f0..f1. */
const outside = (F: Frame, G: Frame, sb: number, f0: number, f1: number) => (x: number): boolean => {
  const c = F.from(G, 0.3, x).f;
  return c + sb / 2 <= f0 || c - sb / 2 >= f1;
};

// ==================================================================== objects

type Dir = 0 | 1 | 2 | 3;
/** Facing vectors in (f, x): 0 = toward the front wall, 2 = toward the back. */
const FACE: readonly (readonly [number, number])[] = [[-1, 0], [0, 1], [1, 0], [0, -1]];

/** A thing at (f, x) of a frame, facing `dir`: a = forward, b = sideways. */
class Obj {
  readonly F: Frame;
  readonly f: number;
  readonly x: number;
  readonly dir: Dir;
  private readonly af: number;
  private readonly ax: number;
  private readonly bf: number;
  private readonly bx: number;

  constructor(F: Frame, f: number, x: number, dir: Dir) {
    this.F = F;
    this.f = f;
    this.x = x;
    this.dir = dir;
    [this.af, this.ax] = FACE[dir];
    [this.bf, this.bx] = FACE[(dir + 1) % 4];
  }

  pt(a: number, b: number): [number, number] {
    return [this.f + a * this.af + b * this.bf, this.x + a * this.ax + b * this.bx];
  }

  private get alongF(): boolean {
    return this.af !== 0;
  }

  /** sa along the facing, sb sideways. */
  box(m: Mat, a: number, b: number, y: number, sa: number, h: number, sb: number, solid = false): void {
    const [f, x] = this.pt(a, b);
    if (this.alongF) this.F.box(m, f, x, y, sb, h, sa, solid);
    else this.F.box(m, f, x, y, sa, h, sb, solid);
  }

  cyl(m: Mat, a: number, b: number, y: number, r: number, h: number, o: { axis?: 'y' | 'a' | 'b'; seg?: number; r2?: number } = {}): void {
    const [f, x] = this.pt(a, b);
    const axis = o.axis === 'a' ? (this.alongF ? 'f' : 'x') : o.axis === 'b' ? (this.alongF ? 'x' : 'f') : 'y';
    this.F.cyl(m, f, x, y, r, h, { axis, seg: o.seg, r2: o.r2 });
  }

  fits(a: number, b: number, sa: number, sb: number): boolean {
    const [f, x] = this.pt(a, b);
    return this.alongF ? this.F.fits(f, x, sb, sa) : this.F.fits(f, x, sa, sb);
  }

  free(a: number, b: number, r = 0.25): boolean {
    const [f, x] = this.pt(a, b);
    return this.F.free(f, x, r);
  }

  reserve(a: number, b: number, sa: number, sb: number, h: number): void {
    const [f, x] = this.pt(a, b);
    if (this.alongF) this.F.reserve(f, x, sb, sa, h);
    else this.F.reserve(f, x, sa, sb, h);
  }

  put(a: number, b: number, sa: number, sb: number, h: number): boolean {
    if (!this.fits(a, b, sa, sb)) return false;
    this.reserve(a, b, sa, sb, h);
    return true;
  }

  /** A thing at (a, b) of this one, turned `turn` quarter turns from this one's facing. */
  sub(a: number, b: number, turn = 0): Obj {
    const [f, x] = this.pt(a, b);
    return new Obj(this.F, f, x, ((this.dir + turn) % 4) as Dir);
  }
}

const at = (F: Frame, f: number, x: number, dir: Dir = 0): Obj => new Obj(F, f, x, dir);

// ==================================================================== layout helpers

/** x centres of units w wide, in blocks no wider than `block` split by aisles, with side aisles. */
function columns(W: number, w: number, gap: number, side: number, aisle: number, block: number): number[][] {
  const usable = W - 2 * side;
  // Too narrow for aisles both sides: one unit against a side wall, the aisle along the other.
  if (usable < w) return W - 0.95 >= w ? [[-W / 2 + 0.05 + w / 2]] : [];
  const maxB = Math.max(block, w);
  let nB = Math.max(1, Math.ceil((usable + aisle) / (maxB + aisle)));
  let blockW = 0;
  let per = 0;
  for (; nB >= 1; nB -= 1) {
    blockW = (usable - (nB - 1) * aisle) / nB;
    per = Math.floor((blockW + gap + EPS) / (w + gap));
    if (per >= 1) break;
  }
  if (per < 1) return [];
  const out: number[][] = [];
  const used = per * w + (per - 1) * gap;
  for (let b = 0; b < nB; b += 1) {
    const start = -usable / 2 + b * (blockW + aisle) + (blockW - used) / 2 + w / 2;
    out.push(Array.from({ length: per }, (_, i) => start + i * (w + gap)));
  }
  return out;
}

interface GridOpts {
  /** Depth range the units may use. */
  f0: number;
  f1: number;
  /** Unit footprint: w across, d deep. */
  w: number;
  d: number;
  pitch: number;
  gap?: number;
  side?: number;
  aisle?: number;
  block?: number;
  /** Keep this much clear across (x) between each unit and things already in the room. */
  clear?: number;
  /** Unit x centres, instead of the usual blocks and aisles. */
  xs?: number[];
}

/** Rows of units facing the front, with aisles; calls `cb` for each unit that fits. */
function grid(F: Frame, o: GridOpts, cb: (f: number, x: number, row: number) => void): number {
  const xs = o.xs ?? columns(F.W, o.w, o.gap ?? 0.1, o.side ?? 0.8, o.aisle ?? 1.0, o.block ?? 1e9).flat();
  let n = 0;
  // First pick the cells (with their clearance, before any unit is placed), then place them.
  const cells: [number, number, number][] = [];
  const c = o.clear ?? 0;
  let row = 0;
  for (let f = o.f0 + o.d / 2; f + o.d / 2 <= o.f1 + EPS; f += o.pitch, row += 1) {
    for (const x of xs) if (F.fits(f, x, o.w, o.d) && (!c || F.fits(f, x, Math.min(o.w + 2 * c, F.W - 2 * Math.abs(x)), o.d))) cells.push([f, x, row]);
  }
  for (const [f, x, r] of cells) {
    if (!F.fits(f, x, o.w, o.d)) continue;
    cb(f, x, r);
    n += 1;
  }
  return n;
}

/** Stretches of x in [x0, x1] where a d-deep strip at depth f fits, at least `min` long. */
function spans(F: Frame, f: number, d: number, x0: number, x1: number, min: number): [number, number][] {
  const out: [number, number][] = [];
  const step = 0.1;
  let s: number | null = null;
  for (let x = x0; x <= x1 + EPS; x += step) {
    const ok = x + step <= x1 + EPS && F.fits(f, x + step / 2, step, d);
    if (ok && s === null) s = x;
    if (!ok && s !== null) {
      if (x - s >= min - EPS) out.push([s, x]);
      s = null;
    }
  }
  return out;
}

const pick = <T>(F: Frame, xs: readonly T[]): T => xs[Math.floor(F.rand() * xs.length) % xs.length];
const has = (room: Room, re: RegExp): boolean => re.test(room.name);

// ==================================================================== furniture

function chair(o: Obj, mat: Mat = 'chair', legs: Mat = 'metal'): void {
  o.box(mat, 0, 0, 0.43, 0.42, 0.04, 0.44);
  o.box(mat, -0.2, 0, 0.47, 0.03, 0.42, 0.42);
  for (const s of [-1, 1]) o.box(legs, 0, s * 0.19, 0, 0.4, 0.43, 0.03);
}

function officeChair(o: Obj, mat: Mat = 'black', high = false): void {
  o.box(mat, 0, 0, 0.42, 0.46, 0.07, 0.46);
  o.box(mat, -0.22, 0, 0.5, 0.06, high ? 0.75 : 0.48, high ? 0.5 : 0.44);
  o.cyl('metal', 0, 0, 0.07, 0.03, 0.35, { seg: 8 });
  o.cyl('black', 0, 0, 0.02, 0.27, 0.05, { seg: 10 });
}

function stool(o: Obj, top: Mat = 'wood', h = 0.62): void {
  o.cyl(top, 0, 0, h - 0.04, 0.17, 0.04, { seg: 10 });
  o.cyl('metal', 0, 0, 0.03, 0.025, h - 0.07, { seg: 8 });
  o.cyl('metal', 0, 0, 0, 0.19, 0.03, { seg: 10 });
}

/** A four-legged table: sa deep, sb wide, h high (from y0). */
function table(o: Obj, sa: number, sb: number, h = 0.75, top: Mat = 'wood', legs: Mat = 'metal', y0 = 0): void {
  o.box(top, 0, 0, y0 + h - 0.04, sa, 0.04, sb);
  for (const s of [-1, 1]) for (const t of [-1, 1]) o.box(legs, s * (sa / 2 - 0.05), t * (sb / 2 - 0.05), y0, 0.04, h - 0.04, 0.04);
}

/** A desk with panel ends and a modesty panel on its far (+a) side. */
function desk(o: Obj, sa: number, sb: number, top: Mat = 'wood', body: Mat = 'wood', y0 = 0): void {
  o.box(top, 0, 0, y0 + 0.72, sa, 0.04, sb);
  for (const s of [-1, 1]) o.box(body, 0, s * (sb / 2 - 0.02), y0, sa - 0.04, 0.72, 0.03);
  o.box(body, sa / 2 - 0.04, 0, y0 + 0.3, 0.02, 0.4, sb - 0.06);
}

/** A monitor at (a, b) standing on a surface at y, its screen facing -a. */
function monitor(o: Obj, a: number, b: number, y: number, w = 0.5): void {
  o.box('black', a, b, y, 0.12, 0.1, 0.16);
  o.box('screen', a - 0.02, b, y + 0.1, 0.03, w * 0.6, w);
}

function keyboard(o: Obj, a: number, b: number, y: number): void {
  o.box('black', a, b, y, 0.15, 0.02, 0.42);
}

/** A single-faced bookshelf with its back to the wall, books on the +a face. */
function bookshelf(o: Obj, sb: number, sa: number, h: number, carcass: Mat = 'darkwood'): void {
  o.box(carcass, 0, 0, 0, sa, h, sb);
  const n = Math.max(1, Math.ceil((sb - 0.04) / 1.0));
  const cw = (sb - 0.04) / n;
  for (let i = 0; i < n; i += 1) o.box('books', sa / 2 + 0.004, -sb / 2 + 0.02 + cw * (i + 0.5), 0.08, 0.01, h - 0.16, cw - 0.04);
}

/** A double-faced library stack: books on both long faces. */
function stack(o: Obj, sb: number, sa: number, h: number): void {
  o.box('darkwood', 0, 0, 0, sa, h, sb);
  const n = Math.max(1, Math.ceil((sb - 0.04) / 1.0));
  const cw = (sb - 0.04) / n;
  for (let i = 0; i < n; i += 1) o.box('books', 0, -sb / 2 + 0.02 + cw * (i + 0.5), 0.08, sa + 0.02, h - 0.17, cw - 0.04);
}

/** A steel almirah (two-door cupboard). */
function almirah(o: Obj, sb: number, h: number, mat: Mat = 'metal'): void {
  o.box(mat, 0, 0, 0, 0.45, h, sb);
  o.box('black', 0.226, 0, 0.1, 0.004, h - 0.2, 0.012);
  for (const s of [-1, 1]) o.box('chrome', 0.235, s * 0.05, h * 0.5, 0.02, 0.16, 0.02);
}

/** An open steel rack, sb long, filled with bundles of `fills`. */
function rack(o: Obj, sb: number, sa: number, h: number, fills: readonly Mat[], shelves = 5): void {
  const bays = Math.max(1, Math.round(sb / 1.0));
  const bw = sb / bays;
  for (let i = 0; i <= bays; i += 1) o.box('metal', 0, -sb / 2 + 0.015 + i * ((sb - 0.03) / bays), 0, sa, h, 0.03);
  const gap = (h - 0.12) / (shelves - 1);
  for (let s = 0; s < shelves; s += 1) {
    const y = 0.08 + s * gap;
    o.box('metal', 0, 0, y, sa, 0.025, sb - 0.04);
    if (s === shelves - 1) break;
    for (let i = 0; i < bays; i += 1) {
      const fw = (bw - 0.08) * (0.65 + o.F.rand() * 0.3);
      const fh = Math.min(gap - 0.06, gap * (0.45 + o.F.rand() * 0.4));
      o.box(pick(o.F, fills), (o.F.rand() - 0.5) * 0.04, -sb / 2 + bw * (i + 0.5) + (o.F.rand() - 0.5) * (bw - 0.08 - fw), y + 0.025, sa * 0.82, fh, fw);
    }
  }
}

/** A sofa sb long, seat facing +a. */
function sofa(o: Obj, sb: number, mat: Mat = 'cushion'): void {
  o.box(mat, 0.04, 0, 0, 0.72, 0.42, sb - 0.3);
  o.box(mat, -0.32, 0, 0, 0.16, 0.82, sb);
  for (const s of [-1, 1]) o.box(mat, 0, s * (sb / 2 - 0.075), 0, 0.8, 0.6, 0.15);
}

function bench(o: Obj, sb: number, mat: Mat = 'wood', legs: Mat = 'metal'): void {
  o.box(mat, 0, 0, 0.42, 0.4, 0.04, sb);
  for (const s of [-1, 1]) o.box(legs, 0, s * (sb / 2 - 0.1), 0, 0.36, 0.42, 0.04);
}

function plant(o: Obj, s = 1): void {
  o.cyl('orange', 0, 0, 0, 0.14 * s, 0.32 * s, { r2: 0.18 * s, seg: 10 });
  o.cyl('soil', 0, 0, 0.3 * s, 0.165 * s, 0.02, { seg: 10 });
  o.cyl('plant', 0, 0, 0.32 * s, 0.21 * s, 0.6 * s, { r2: 0.08 * s, seg: 8 });
  o.cyl('plant', 0, 0, 0.55 * s, 0.17 * s, 0.45 * s, { r2: 0.02, seg: 8 });
}

function dustbin(o: Obj, mat: Mat = 'blue'): void {
  o.cyl(mat, 0, 0, 0, 0.14, 0.38, { r2: 0.17, seg: 10 });
}

function dispenser(o: Obj): void {
  o.box('white', 0, 0, 0, 0.32, 0.95, 0.32);
  o.cyl('blue', 0, 0, 0.95, 0.13, 0.42, { seg: 10 });
  o.box('chrome', 0.17, 0, 0.68, 0.04, 0.06, 0.06);
}

/** A flag on a stand: Nepal's crimson with a blue border, or other colours. It flies toward the room's middle. */
function flag(o: Obj, field: Mat = 'red', border: Mat = 'blue'): void {
  const ph = Math.min(2.0, o.F.H - 0.1);
  const [, xp] = o.pt(0, 1);
  const s = (xp - o.x) * o.x > 0 ? -1 : 1;
  o.cyl('black', 0, 0, 0, 0.2, 0.05, { seg: 10 });
  o.cyl('chrome', 0, 0, 0.05, 0.016, ph - 0.05, { seg: 8 });
  o.box(border, 0, s * 0.26, ph - 0.66, 0.012, 0.58, 0.48);
  o.box(field, 0, s * 0.26, ph - 0.63, 0.02, 0.52, 0.42);
}

/** Wall things on frame G's front wall (x along the wall, f out from it). */
function greenboard(G: Frame, x: number, w: number): void {
  const top = Math.min(2.2, G.H - 0.2);
  const y0 = 0.85;
  if (top - y0 < 0.6) return;
  G.box('darkwood', 0.025, x, y0, w + 0.12, top - y0, 0.05);
  G.box('greenboard', 0.056, x, y0 + 0.06, w, top - y0 - 0.12, 0.012);
  G.box('darkwood', 0.1, x, y0, w + 0.12, 0.035, 0.1);
  G.box('white', 0.1, x - w * 0.3, y0 + 0.035, 0.08, 0.012, 0.012);
  G.box('black', 0.1, x + w * 0.25, y0 + 0.035, 0.13, 0.035, 0.055);
  G.mark(x, w + 0.12, y0, top);
}

function whiteboard(G: Frame, x: number, w: number): void {
  const top = Math.min(2.1, G.H - 0.2);
  const y0 = 0.9;
  if (top - y0 < 0.6) return;
  G.box('metal', 0.02, x, y0, w + 0.06, top - y0, 0.04);
  G.box('board', 0.045, x, y0 + 0.03, w, top - y0 - 0.06, 0.01);
  G.box('metal', 0.08, x, y0 - 0.02, w * 0.8, 0.03, 0.07);
  G.mark(x, w + 0.06, y0, top);
}

function noticeBoard(G: Frame, x: number, w: number, y = 1.05, h = 0.9): void {
  if (y + h > G.H - 0.05) return;
  G.box('darkwood', 0.015, x, y, w, h, 0.03);
  G.box('cream', 0.034, x, y + 0.04, w - 0.08, h - 0.08, 0.01);
  const n = Math.max(2, Math.round(w * 2.5));
  for (let i = 0; i < n; i += 1) {
    G.box(G.rand() < 0.8 ? 'paper' : pick(G, ['yellow', 'blue', 'red'] as const), 0.041, x + (G.rand() - 0.5) * (w - 0.35), y + 0.08 + G.rand() * (h - 0.5), 0.21, 0.3, 0.004);
  }
  G.mark(x, w, y, y + h);
}

function projScreen(G: Frame, x: number, w: number): void {
  const top = Math.min(2.8, G.H - 0.15);
  const h = Math.min(w * 0.62, top - 0.95);
  if (h < 0.7) return;
  G.box('black', 0.05, x, top - 0.09, w + 0.12, 0.09, 0.1);
  G.box('white', 0.03, x, top - 0.09 - h, w, h, 0.01);
  G.mark(x, w + 0.12, top - 0.09 - h, top);
}

function tv(G: Frame, x: number, y: number, w: number): void {
  const h = w * 0.58;
  if (y + h > G.H - 0.05) return;
  G.box('black', 0.03, x, y, w, h, 0.05);
  G.box('screen', 0.058, x, y + 0.025, w - 0.05, h - 0.05, 0.006);
  G.mark(x, w, y, y + h);
}

function picture(G: Frame, x: number, y: number, w: number, h: number, inner: Mat = 'paper'): void {
  if (y + h > G.H - 0.05) return;
  G.box('darkwood', 0.015, x, y, w, h, 0.03);
  G.box(inner, 0.033, x, y + 0.05, w - 0.1, h - 0.1, 0.006);
  G.mark(x, w, y, y + h);
}

function clock(G: Frame, x: number): void {
  const y = Math.min(2.3, G.H - 0.3);
  G.cyl('white', 0.02, x, y, 0.15, 0.04, { axis: 'f', seg: 12 });
  G.cyl('black', 0.045, x, y, 0.02, 0.01, { axis: 'f', seg: 8 });
  G.mark(x, 0.3, y - 0.15, y + 0.15);
}

/** Hang a w-wide wall thing on one of F's walls, at the spot nearest the middle. */
function hang(F: Frame, walls: readonly Wall[], w: number, y0: number, y1: number, draw: (G: Frame, x: number) => void): boolean {
  for (const wl of walls) {
    const G = F.wall(wl);
    const x = G.spot(w, y0, y1);
    if (x === null) continue;
    draw(G, x);
    return true;
  }
  return false;
}

/** A ceiling fan (four blades: two crossed bars) hanging at (f, x). */
function fan(F: Frame, f: number, x: number): void {
  const yb = Math.max(2.35, F.H - 0.55);
  if (yb + 0.15 > F.H || !F.inside(f, x, 1.3, 1.3)) return;
  F.cyl('metal', f, x, yb + 0.07, 0.016, F.H - yb - 0.07, { seg: 8 });
  F.cyl('white', f, x, yb - 0.02, 0.1, 0.09, { seg: 10 });
  F.box('metal', f, x, yb + 0.01, 1.2, 0.012, 0.12);
  F.box('metal', f, x, yb + 0.01, 0.12, 0.012, 1.2);
}

function fans(F: Frame, spacing = 3.6, cap = 12): void {
  if (F.H < 2.55) return;
  let nx = Math.max(1, Math.round(F.W / spacing));
  let nf = Math.max(1, Math.round(F.D / spacing));
  while (nx * nf > cap) {
    if (nx >= nf) nx -= 1;
    else nf -= 1;
  }
  for (let i = 0; i < nf; i += 1) for (let j = 0; j < nx; j += 1) fan(F, (F.D * (i + 0.5)) / nf, -F.W / 2 + (F.W * (j + 0.5)) / nx);
}

/** A ceiling projector at (f, x), lens toward the front. */
function projector(F: Frame, f: number, x: number): void {
  if (F.H < 2.6) return;
  const y = F.H - 0.47;
  F.cyl('metal', f, x, y + 0.12, 0.02, F.H - y - 0.12, { seg: 8 });
  F.box('white', f, x, y, 0.32, 0.12, 0.3);
  F.cyl('black', f - 0.17, x, y + 0.06, 0.035, 0.04, { axis: 'f', seg: 10 });
}

/** A thing in a free corner of the room (front corners first, or back ones). */
function inCorner(F: Frame, size: number, back: boolean, draw: (o: Obj) => void): boolean {
  const fs = back ? [F.D - size / 2 - 0.05, size / 2 + 0.05] : [size / 2 + 0.05, F.D - size / 2 - 0.05];
  for (const f of fs) {
    for (const s of [1, -1]) {
      const x = s * (F.W / 2 - size / 2 - 0.05);
      if (!F.fits(f, x, size, size)) continue;
      draw(at(F, f, x, f < F.D / 2 ? 2 : 0));
      return true;
    }
  }
  return false;
}

/** The teacher's / instructor's table at the front, its user facing the room. */
function frontTable(F: Frame, f: number, x: number, y0 = 0, withMonitor = false): boolean {
  const o = at(F, f, x, 2);
  if (y0 === 0 && !o.fits(-0.2, 0, 1.2, 1.2)) return false;
  if (y0 === 0) o.reserve(0, 0, 0.6, 1.2, 0.76);
  else o.box('none', 0, 0, y0, 0.6, 0.76, 1.2, true);
  desk(o, 0.6, 1.2, 'wood', 'wood', y0);
  o.box('paper', 0.12, 0.3, y0 + 0.76, 0.3, 0.03, 0.22);
  if (withMonitor) {
    monitor(o, 0.25, -0.15, y0 + 0.76);
    keyboard(o, 0.0, -0.15, y0 + 0.76);
  } else o.box('blue', 0.05, -0.35, y0 + 0.76, 0.25, 0.06, 0.32);
  const c = o.sub(-0.45, 0, 0);
  if (y0 === 0) chair(c, 'wood', 'wood');
  else {
    c.box('wood', 0, 0, y0 + 0.43, 0.42, 0.04, 0.44);
    c.box('wood', -0.2, 0, y0 + 0.47, 0.03, 0.42, 0.42);
    for (const s of [-1, 1]) c.box('wood', 0, s * 0.19, y0, 0.4, 0.43, 0.03);
  }
  return true;
}

// ==================================================================== rooms

const classroom: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  // Green chalkboard on the front wall.
  let bw = clamp(W * 0.55, 1.2, 5);
  let bx: number | null = null;
  for (; bw >= 1.2 && bx === null; bw -= 0.4) bx = F.spot(bw + 0.12, 0.85, 2.2);
  bw += 0.4;
  if (bx !== null) greenboard(F, bx, bw);
  // Teacher's platform (one step) with the table and chair.
  const pd = D >= 6 ? 1.5 : 0;
  const pw = Math.min(W - 1.4, Math.max(bw + 1.2, 3));
  let platform = false;
  if (pd > 0 && pw >= 2 && F.fits(pd / 2, 0, pw, pd)) {
    F.box(F.rand() < 0.5 ? 'wood' : 'concrete', pd / 2, 0, 0, pw, 0.15, pd, true);
    platform = true;
    frontTable(F, pd * 0.62, pw >= 3 ? -(pw / 2 - 0.8) : 0, 0.15);
  } else frontTable(F, 0.95, W >= 3.6 ? -(W / 2 - 1.0) : 0);
  // Benches for three, in two columns facing the board.
  const uw = W >= 5 ? 1.4 : 1.2;
  const ud = 0.95;
  grid(F, { f0: (platform ? pd : 1.6) + 0.8, f1: D - 1.0, w: uw, d: ud, pitch: 1.2, gap: 0.1, side: 0.65, aisle: 0.95, block: uw * 2 + 0.1 }, (f, x) => {
    const o = at(F, f, x, 0);
    F.reserve(f, x, uw, ud, 0.76);
    o.box('wood', ud / 2 - 0.2, 0, 0.72, 0.4, 0.035, uw);
    o.box('wood', ud / 2 - 0.02, 0, 0.42, 0.02, 0.3, uw - 0.06);
    o.box('wood', -(ud / 2 - 0.15), 0, 0.43, 0.3, 0.04, uw);
    for (const s of [-1, 1]) o.box('metal', 0, s * (uw / 2 - 0.03), 0, ud, 0.43, 0.035);
    for (const s of [-1, 1]) o.box('metal', ud / 2 - 0.2, s * (uw / 2 - 0.03), 0.43, 0.05, 0.29, 0.035);
    if (F.rand() < 0.35) o.box('paper', ud / 2 - 0.2, (F.rand() - 0.5) * (uw - 0.4), 0.755, 0.22, 0.012, 0.3);
  });
  // Notice board and clock on the back wall, a bin in a front corner, fans overhead.
  hang(F, ['back', 'left', 'right'], 1.5, 1.05, 1.95, (G, x) => noticeBoard(G, x, 1.5));
  hang(F, ['back', 'left'], 0.3, 2.0, 2.45, (G, x) => clock(G, x));
  inCorner(F, 0.4, false, (o) => dustbin(o));
  fans(F, 3.8, 6);
};

const drawing: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const wx = F.spot(Math.min(3, W * 0.5), 0.9, 2.1);
  if (wx !== null) whiteboard(F, wx, Math.min(3, W * 0.5) - 0.06);
  frontTable(F, 0.95, W >= 3.6 ? (W / 2 - 1.0) : 0);
  // Plan chests along the back wall.
  const back = F.wall('back');
  const chests = back.run(1.3, 0.9, 0.85, Math.max(1, Math.floor(W / 4)), corners, (o) => {
    o.box('darkwood', 0, 0, 0, 0.9, 0.85, 1.3);
    o.box('wood', 0.452, 0, 0.08, 0.006, 0.7, 1.22);
    for (let i = 0; i < 4; i += 1) o.box('chrome', 0.46, 0, 0.17 + i * 0.17, 0.012, 0.02, 0.3);
  });
  // Drafting tables (stepped, tilted boards) with stools, in rows.
  grid(F, { f0: 1.9, f1: D - (chests ? 1.9 : 1.0), w: 1.1, d: 1.35, pitch: 1.6, gap: 0.35, side: 0.8, aisle: 1.0, block: 4.5 }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0.3, 0, 0.75, 1.1, 1.0);
    for (const s of [-1, 1]) o.box('metal', 0.3, s * 0.45, 0, 0.55, 0.84, 0.04);
    for (let i = 0; i < 3; i += 1) o.box('plywood', 0.05 + i * 0.25, 0, 0.84 + i * 0.05, 0.25, 0.025, 1.0);
    o.box('paper', 0.3, (F.rand() - 0.5) * 0.3, 0.915, 0.24, 0.006, 0.55);
    stool(o.sub(-0.4, 0), 'wood', 0.66);
  });
  fans(F, 3.8, 6);
};

const computerLab: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const sw = clamp(W * 0.45, 1.5, 3.5);
  const sx = F.spot(sw + 0.12, 0.9, 2.8);
  if (sx !== null) projScreen(F, sx, sw);
  projector(F, Math.min(D * 0.45, 4.5), sx ?? 0);
  frontTable(F, 1.0, W >= 3.6 ? (W / 2 - 1.0) : 0, 0, true);
  // Long desks of 2–4 computers each.
  const seats = W >= 9 ? 4 : W >= 5.5 ? 3 : 2;
  const uw = seats * 0.75;
  grid(F, { f0: 2.0, f1: D - 1.0, w: uw, d: 1.4, pitch: 1.75, gap: 0, side: 0.75, aisle: 1.0, block: uw }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0.35, 0, 0.7, uw, 0.76);
    o.box('cream', 0.35, 0, 0.72, 0.7, 0.03, uw);
    for (const s of [-1, 1]) o.box('metal', 0.35, s * (uw / 2 - 0.02), 0, 0.66, 0.72, 0.03);
    o.box('metal', 0.67, 0, 0.3, 0.02, 0.4, uw - 0.06);
    for (let i = 0; i < seats; i += 1) {
      const b = -uw / 2 + 0.375 + i * 0.75;
      monitor(o, 0.55, b, 0.75, 0.48);
      keyboard(o, 0.2, b, 0.75);
      o.box('black', 0.4, b + 0.24, 0, 0.42, 0.4, 0.18);
      officeChair(o.sub(-0.3, b), 'chair');
    }
  });
  hang(F, ['back', 'left', 'right'], 1.2, 1.05, 1.95, (G, x) => noticeBoard(G, x, 1.2));
  inCorner(F, 0.4, true, (o) => dustbin(o));
  fans(F, 4, 6);
};

// ------------------------------------------------ science labs

type LabKind = 'chem' | 'physics' | 'soil' | 'hydraulics' | 'survey' | 'structures' | 'thermo' | 'metrology';

function labKind(room: Room): LabKind {
  if (has(room, /hydraul|fluid/i)) return 'hydraulics';
  if (has(room, /soil|geotech|transport|highway|material|concrete/i)) return 'soil';
  if (has(room, /survey|gnss|geodes/i)) return 'survey';
  if (has(room, /struct/i)) return 'structures';
  if (has(room, /thermo|heat/i)) return 'thermo';
  if (has(room, /metrolog/i)) return 'metrology';
  if (has(room, /physic/i)) return 'physics';
  return 'chem';
}

/** A few things on a lab bench top (y = top surface), spread along b in [-span/2, span/2]. */
function apparatus(o: Obj, kind: LabKind, y: number, span: number): void {
  const F = o.F;
  const n = span > 1.5 ? 3 : 2;
  for (let i = 0; i < n; i += 1) {
    const b = -span / 2 + (span * (i + 0.5)) / n;
    const a = (F.rand() - 0.5) * 0.2;
    switch (kind) {
      case 'chem':
        o.cyl('glass', a, b - 0.12, y, 0.045, 0.12, { seg: 8 });
        o.cyl('glass', a + 0.05, b, y, 0.065, 0.16, { r2: 0.016, seg: 8 });
        o.cyl(pick(F, ['orange', 'blue', 'cream'] as const), a - 0.05, b + 0.13, y, 0.04, 0.15, { seg: 8 });
        break;
      case 'physics':
      case 'thermo':
        o.box(kind === 'thermo' ? 'machine' : 'cream', a, b, y, 0.16, 0.13, 0.22);
        o.box('screen', a - 0.081, b, y + 0.04, 0.004, 0.06, 0.12);
        if (i === 0) {
          o.box('metal', a, b + 0.3, y, 0.15, 0.02, 0.25);
          o.cyl('metal', a, b + 0.3, y + 0.02, 0.008, 0.6, { seg: 6 });
          o.cyl('metal', a, b + 0.3, y + 0.62, 0.006, 0.25, { axis: 'b', seg: 6 });
        }
        break;
      case 'soil':
        o.box('black', a, b, y, 0.3, 0.1, 0.3);
        o.cyl('steel', a, b, y + 0.1, 0.11, 0.24, { seg: 10 });
        o.cyl('chrome', a, b, y + 0.34, 0.115, 0.03, { seg: 10 });
        o.cyl('metal', a + 0.02, b + 0.28, y, 0.055, 0.13, { seg: 8 });
        break;
      case 'hydraulics':
        o.box('blue', a, b, y, 0.3, 0.28, 0.4);
        o.cyl('chrome', a, b + 0.3, y + 0.15, 0.02, 0.2, { axis: 'b', seg: 8 });
        break;
      case 'survey':
        o.box('yellow', a, b, y, 0.22, 0.26, 0.32);
        o.box('paper', a - 0.05, b + 0.35, y, 0.4, 0.004, 0.3);
        break;
      case 'structures':
      case 'metrology':
        o.box(kind === 'metrology' ? 'black' : 'metal', a, b, y, 0.3, 0.06, 0.4);
        o.cyl('chrome', a, b + 0.32, y, 0.03, 0.12, { seg: 8 });
        break;
    }
  }
}

/** An island lab bench (2.4 × 1.2) with a sink, a reagent upstand and stools both sides. */
function labBench(o: Obj, kind: LabKind, len: number): void {
  o.box('wood', 0, 0, 0, 1.1, 0.86, len - 0.1);
  o.box('black', 0, 0, 0.86, 1.2, 0.04, len);
  o.box('steel', 0, len / 2 - 0.3, 0.9, 0.42, 0.012, 0.34);
  o.cyl('chrome', -0.25, len / 2 - 0.3, 0.9, 0.016, 0.3, { seg: 8 });
  o.cyl('chrome', -0.17, len / 2 - 0.3, 1.18, 0.012, 0.16, { axis: 'a', seg: 8 });
  o.box('wood', 0, -0.15, 1.25, 0.2, 0.03, len - 0.8);
  for (const s of [-1, 1]) o.cyl('metal', 0, -0.15 + s * (len / 2 - 0.5), 0.9, 0.015, 0.35, { seg: 6 });
  for (let i = 0; i < 3; i += 1) o.cyl(pick(o.F, ['glass', 'orange', 'blue', 'cream'] as const), 0, -0.15 + (i - 1) * 0.35, 1.28, 0.04, 0.16, { seg: 8 });
  apparatus(o.sub(0.32, -0.25), kind, 0.9, len - 0.9);
  apparatus(o.sub(-0.32, -0.25), kind, 0.9, len - 0.9);
  for (const s of [-1, 1]) for (const b of [-len / 4, len / 4]) stool(o.sub(s * 0.92, b), 'wood', 0.66);
}

function fumeCupboard(o: Obj): void {
  const top = Math.min(2.3, o.F.H - 0.1);
  o.box('white', 0, 0, 0, 0.8, 0.85, 1.2);
  o.box('black', 0.02, 0, 0.85, 0.78, 0.03, 1.16);
  o.box('white', -0.32, 0, 0.88, 0.16, top - 0.88 - 0.35, 1.2);
  for (const s of [-1, 1]) o.box('white', 0.06, s * 0.575, 0.88, 0.64, top - 0.88 - 0.35, 0.05);
  o.box('glass', 0.37, 0, 1.15, 0.02, Math.max(0.2, top - 0.35 - 1.15), 1.1);
  o.box('white', 0, 0, top - 0.35, 0.8, 0.35, 1.2);
  o.cyl('metal', -0.1, 0, top, 0.1, o.F.H - top, { seg: 10 });
}

/** A glazed cabinet with bottles on its shelves. */
function glassCabinet(o: Obj, sb: number, h: number, wood: Mat = 'darkwood'): void {
  o.box(wood, -0.2, 0, 0, 0.04, h, sb);
  for (const s of [-1, 1]) o.box(wood, 0, s * (sb / 2 - 0.02), 0, 0.42, h, 0.04);
  o.box(wood, 0, 0, 0, 0.42, 0.1, sb - 0.08);
  o.box(wood, 0, 0, h - 0.04, 0.42, 0.04, sb - 0.08);
  for (let i = 1; i <= 3; i += 1) {
    const y = 0.1 + (i * (h - 0.14)) / 4;
    o.box('glass', 0, 0, y, 0.38, 0.012, sb - 0.08);
    o.cyl(pick(o.F, ['white', 'orange', 'blue'] as const), -0.02, -sb / 4, y + 0.012, 0.045, 0.16, { seg: 8 });
    o.cyl('glass', 0.02, sb / 5, y + 0.012, 0.05, 0.2, { seg: 8 });
  }
  o.box('glass', 0.21, 0, 0.1, 0.01, h - 0.14, sb - 0.08);
}

/** Open wooden shelves of reagent bottles. */
function reagentShelf(o: Obj, sb: number, h: number): void {
  for (const s of [-1, 1]) o.box('wood', 0, s * (sb / 2 - 0.02), 0, 0.35, h, 0.04);
  const n = 4;
  for (let i = 0; i < n; i += 1) {
    const y = 0.1 + (i * (h - 0.15)) / (n - 1);
    o.box('wood', 0, 0, y, 0.35, 0.025, sb - 0.08);
    if (i === n - 1) break;
    for (let j = 0; j < 3; j += 1) o.cyl(pick(o.F, ['glass', 'orange', 'blue', 'cream', 'white'] as const), 0, -sb / 2 + 0.2 + j * ((sb - 0.4) / 2), y + 0.025, 0.045, 0.18, { seg: 8 });
  }
}

/** A collapsed tripod with an instrument on its head. */
function tripod(o: Obj): void {
  for (let i = 0; i < 3; i += 1) {
    const t = (i * Math.PI * 2) / 3;
    o.cyl('wood', Math.cos(t) * 0.06, Math.sin(t) * 0.06, 0, 0.018, 1.15, { seg: 6 });
  }
  o.cyl('metal', 0, 0, 1.15, 0.08, 0.05, { seg: 8 });
  o.box('yellow', 0, 0, 1.2, 0.16, 0.18, 0.14);
  o.cyl('black', 0, 0, 1.32, 0.03, 0.26, { axis: 'a', seg: 8 });
}

/** A flume: a glass-sided channel with water, a head tank and a sump, along the room's depth. */
function flume(F: Frame, f0: number, f1: number): boolean {
  const L = f1 - f0;
  if (L < 3 || !F.put((f0 + f1) / 2, 0, 1.0, L, 1.6)) return false;
  const c0 = f0 + 0.9;
  const c1 = f1 - 0.9;
  const cl = c1 - c0;
  F.box('blue', f0 + 0.4, 0, 0, 0.95, 1.5, 0.8);
  F.box('blue', f1 - 0.4, 0, 0, 0.95, 0.55, 0.8);
  F.cyl('machine', f1 - 0.4, 0.3, 0.7, 0.14, 0.3, { axis: 'x', seg: 10 });
  F.cyl('chrome', f1 - 0.4, 0, 1.0, 0.05, 0.8, { axis: 'y', seg: 8 });
  const stations = Math.max(2, Math.round(cl / 1.5) + 1);
  for (let i = 0; i < stations; i += 1) {
    const f = c0 + 0.05 + ((cl - 0.1) * i) / (stations - 1);
    for (const s of [-1, 1]) F.box('metal', f, s * 0.3, 0, 0.05, 0.8, 0.05);
  }
  F.box('metal', (c0 + c1) / 2 - 0.1, 0, 0.8, 0.64, 0.05, cl + 0.2);
  for (const s of [-1, 1]) F.box('glass', (c0 + c1) / 2 - 0.1, s * 0.3, 0.85, 0.015, 0.42, cl + 0.2);
  F.box('water', (c0 + c1) / 2 - 0.1, 0, 0.85, 0.57, 0.16, cl + 0.18);
  F.box('metal', c0 + cl * 0.6, 0, 0.85, 0.6, 0.3, 0.02);
  return true;
}

const scienceLab: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const kind = labKind(room);
  const bw = clamp(W * 0.4, 1.2, 3);
  const bx = F.spot(bw + 0.12, 0.85, 2.2);
  if (bx !== null) greenboard(F, bx, bw);
  // Demonstration bench at the front, the instructor facing the class.
  const demo = at(F, 1.2, bx !== null && Math.abs(bx) < 0.5 ? 0 : (bx ?? 0), 2);
  const dl = Math.min(2.2, W - 2.8);
  let band: [number, number] = [-1, -1];
  if (D >= 5 && dl >= 1.2 && demo.fits(-0.1, 0, 1.4, dl)) {
    band = [0.4, 2.0];
    demo.reserve(0.1, 0, 0.75, dl, 0.9);
    demo.box('wood', 0.1, 0, 0, 0.7, 0.86, dl - 0.1);
    demo.box('black', 0.1, 0, 0.86, 0.75, 0.04, dl);
    apparatus(demo.sub(0.1, 0), kind, 0.9, dl - 0.6);
    stool(demo.sub(-0.5, 0), 'wood', 0.66);
  }
  const L = F.wall('left');
  const R = F.wall('right');
  const B = F.wall('back');
  const hWall = Math.min(1.9, F.H - 0.3);
  // Wall equipment by the kind of lab.
  if (kind === 'chem' || kind === 'physics' || kind === 'thermo') {
    const fumes = kind === 'chem' ? (W * D > 60 ? 2 : 1) : 0;
    let left = fumes;
    for (const G of [L, R]) left -= G.run(1.2, 0.8, Math.min(2.3, F.H - 0.1), left, towardBack(F, G), (o) => fumeCupboard(o), outside(F, G, 1.2, band[0], band[1]));
    for (const G of [R, L]) if (W * D >= 12 && G.run(1.4, 0.35, hWall, 1, middle, (o) => reagentShelf(o, 1.4, hWall), outside(F, G, 1.4, band[0], band[1]))) break;
  }
  if (kind === 'soil') {
    for (const G of [L, R]) if (G.run(1.8, 0.45, hWall, 1, middle, (o) => rack(o, 1.8, 0.45, hWall, ['soil', 'soil', 'white', 'paper'], 5), outside(F, G, 1.8, band[0], band[1]))) break;
    for (const G of [R, L]) {
      const n = G.run(0.7, 0.6, 1.5, 1, towardBack(F, G), (o) => {
        o.box('white', 0, 0, 0, 0.6, 1.0, 0.7);
        o.box('black', 0.301, 0, 0.45, 0.004, 0.45, 0.5);
        o.box('steel', 0, 0, 1.0, 0.5, 0.02, 0.6);
      }, outside(F, G, 0.7, band[0], band[1]));
      if (n) break;
    }
  }
  if (kind === 'survey') {
    const tl = Math.min(2.4, W * 0.4);
    for (const G of [L, R, B]) {
      const n = G.run(tl, 0.5, 1.6, 1, towardFront(F, G), (o) => {
        const nT = Math.max(1, Math.floor(tl / 0.5));
        for (let i = 0; i < nT; i += 1) tripod(o.sub(0, -tl / 2 + 0.25 + i * 0.5));
      }, G === B ? undefined : outside(F, G, tl, band[0], band[1]));
      if (n) break;
    }
    const sh = Math.min(2.0, F.H - 0.3);
    for (const G of [R, L, B]) {
      const n = G.run(1.2, 0.25, sh, 1, middle, (o) => {
        o.box('darkwood', -0.1, 0, sh - 0.4, 0.04, 0.08, 1.2);
        for (let i = 0; i < 4; i += 1) o.box(i % 2 ? 'white' : 'yellow', -0.02, -0.5 + i * 0.14, 0, 0.03, sh - 0.1, 0.06);
        for (let i = 0; i < 3; i += 1) {
          o.cyl('red', 0.02, 0.1 + i * 0.16, 0, 0.015, sh * 0.5, { seg: 6 });
          o.cyl('white', 0.02, 0.1 + i * 0.16, sh * 0.5, 0.015, sh * 0.45, { seg: 6 });
        }
      }, G === B ? undefined : outside(F, G, 1.2, band[0], band[1]));
      if (n) break;
    }
  }
  if (kind === 'structures' || kind === 'metrology') {
    // A loading frame / surface plate stand against a side wall.
    for (const G of [L, R]) {
      const n = G.run(2.0, 0.8, Math.min(2.4, F.H - 0.1), 1, middle, (o) => {
        const top = Math.min(2.4, o.F.H - 0.1);
        o.box('machineDark', 0, 0, 0, 0.8, 0.3, 2.0);
        for (const s of [-1, 1]) o.box('machine', 0, s * 0.85, 0.3, 0.2, top - 0.3, 0.2);
        o.box('machine', 0, 0, top - 0.3, 0.3, 0.3, 2.0);
        o.box('yellow', 0, 0, top - 0.75, 0.2, 0.45, 0.2);
        o.box('metal', 0, 0, 0.6, 0.15, 0.15, 1.6);
      }, outside(F, G, 2.0, band[0], band[1]));
      if (n) break;
    }
  }
  for (const G of [B, R, L]) if (G.run(1.0, 0.45, hWall, W * D > 50 ? 2 : 1, corners, (o) => glassCabinet(o, 1.0, hWall), G === B ? undefined : outside(F, G, 1.0, band[0], band[1]))) break;
  // The flume runs down the middle of a hydraulics lab.
  let f0 = 2.4;
  const channel = kind === 'hydraulics' && D >= 6 && flume(F, f0, D - 1.3);
  // Island benches (either side of the flume when there is one).
  if (D - f0 - 1.0 < 2.4) f0 = Math.max(1.2, D - 3.4);
  const len = W >= 5 && !channel ? 2.4 : 1.8;
  const xs = channel ? [0, 1, 2, 3].flatMap((i) => [-1, 1].map((s) => s * (0.5 + 0.9 + len / 2 + i * (len + 1.3)))).filter((x) => Math.abs(x) + len / 2 <= W / 2 - 0.9) : undefined;
  grid(F, { f0, f1: D - 1.0, w: len, d: 2.4, pitch: 3.1, gap: 1.2, side: 0.95, aisle: 1.2, block: len, clear: channel ? 0 : 0.7, xs }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0, 0, 1.2, len, 1.3);
    labBench(o, kind, len);
  });
  inCorner(F, 0.4, true, (o) => dustbin(o, 'red'));
  fans(F, 4, 6);
};

const electronicsLab: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const wx = F.spot(Math.min(3, W * 0.5), 0.9, 2.1);
  if (wx !== null) whiteboard(F, wx, Math.min(3, W * 0.5) - 0.06);
  frontTable(F, 0.95, W >= 3.6 ? -(W / 2 - 1.0) : 0, 0, true);
  // Component drawer cabinets on the side walls.
  for (const G of [F.wall('left'), F.wall('right')]) {
    G.run(0.9, 0.4, 1.2, 1, towardBack(F, G), (o) => {
      o.box('metal', 0, 0, 0, 0.4, 1.2, 0.9);
      o.box('cream', 0.201, 0, 0.08, 0.004, 1.04, 0.82);
      for (let i = 0; i < 5; i += 1) o.box('metal', 0.205, 0, 0.18 + i * 0.2, 0.006, 0.012, 0.82);
    });
  }
  grid(F, { f0: 1.9, f1: D - 1.0, w: 1.8, d: 1.3, pitch: 1.65, gap: 0.6, side: 0.95, aisle: 1.0, block: 4.2, clear: 0.7 }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0.3, 0, 0.7, 1.8, 1.4);
    o.box('wood', 0.3, 0, 0.74, 0.7, 0.04, 1.8);
    for (const s of [-1, 1]) o.box('metal', 0.3, s * 0.88, 0, 0.66, 0.74, 0.04);
    o.box('wood', 0.52, 0, 1.12, 0.26, 0.03, 1.7);
    for (const s of [-1, 1]) o.box('metal', 0.62, s * 0.8, 0.78, 0.04, 0.34, 0.04);
    // Oscilloscope and power supply on the shelf, breadboard and meter on the bench.
    o.box('cream', 0.52, -0.45, 1.15, 0.26, 0.18, 0.34);
    o.box('screen', 0.388, -0.5, 1.19, 0.004, 0.1, 0.15);
    o.box('blue', 0.52, 0.35, 1.15, 0.24, 0.14, 0.26);
    o.box('screen', 0.398, 0.32, 1.22, 0.004, 0.04, 0.1);
    o.box('white', 0.2, -0.2, 0.78, 0.07, 0.015, 0.17);
    o.box('yellow', 0.2, 0.3, 0.78, 0.15, 0.04, 0.08);
    o.box('black', 0.25, 0.65, 0.78, 0.14, 0.08, 0.12);
    for (const b of [-0.45, 0.45]) stool(o.sub(-0.35, b), 'black', 0.62);
  });
  inCorner(F, 0.4, true, (o) => dustbin(o));
  fans(F, 4, 6);
};

const seminar: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const sw = clamp(W * 0.45, 1.8, 4);
  const sx = F.spot(sw + 0.12, 0.9, 2.8);
  if (sx !== null) projScreen(F, sx, sw);
  projector(F, Math.min(D * 0.45, 6), sx ?? 0);
  // A raised dais with the head table, and a lectern to the side.
  const pd = D >= 8 ? 2.2 : 0;
  const pw = Math.min(W - 1.6, 6);
  let dais = false;
  if (pd && pw >= 3 && F.fits(pd / 2, 0, pw, pd)) {
    F.box('wood', pd / 2, 0, 0, pw, 0.15, pd, true);
    dais = true;
    const t = at(F, pd * 0.62, 0, 2);
    const tl = Math.min(2.4, pw - 1.6);
    t.box('none', 0, 0, 0.15, 0.6, 0.76, tl, true);
    t.box('white', 0, 0, 0.15 + 0.72, 0.62, 0.04, tl);
    t.box('blue', 0.3, 0, 0.15 + 0.2, 0.02, 0.56, tl);
    for (const s of [-1, 1]) t.box('metal', 0, s * (tl / 2 - 0.06), 0.15, 0.5, 0.72, 0.04);
    const nc = Math.max(1, Math.floor(tl / 0.75));
    for (let i = 0; i < nc; i += 1) {
      const c = t.sub(-0.5, -tl / 2 + (tl * (i + 0.5)) / nc, 0);
      c.box('cushion', 0, 0, 0.15 + 0.43, 0.44, 0.06, 0.46);
      c.box('cushion', -0.21, 0, 0.15 + 0.49, 0.05, 0.5, 0.44);
      for (const s of [-1, 1]) c.box('chrome', 0, s * 0.2, 0.15, 0.4, 0.43, 0.03);
    }
  }
  const lx = (pw / 2 - 0.5) * (sx !== null && sx > 0 ? -1 : 1);
  const lf = dais ? pd * 0.5 : 1.0;
  const lo = at(F, lf, dais ? lx : clamp(lx, -(W / 2 - 0.5), W / 2 - 0.5), 2);
  const ly = dais ? 0.15 : 0;
  if (dais || lo.put(0, 0, 0.5, 0.6, 1.2)) {
    if (dais) lo.box('none', 0, 0, ly, 0.5, 1.15, 0.6, true);
    lo.box('darkwood', 0, 0, ly, 0.45, 1.05, 0.55);
    lo.box('darkwood', 0, 0, ly + 1.05, 0.5, 0.05, 0.6);
    lo.box('sign', 0.23, 0, ly + 0.55, 0.01, 0.3, 0.4);
    lo.cyl('black', 0.1, 0.15, ly + 1.1, 0.008, 0.3, { seg: 6 });
  }
  // Rows of chairs with a centre aisle.
  grid(F, { f0: (dais ? pd : 1.6) + 1.1, f1: D - 1.1, w: 0.5, d: 0.5, pitch: 0.9, gap: 0.08, side: 0.9, aisle: 1.2, block: 6 }, (f, x) => {
    chair(at(F, f, x, 0), 'chair');
  });
  inCorner(F, 0.45, true, (o) => plant(o));
  fans(F, 4.5, 10);
};

/** A long meeting table down a frame's depth with chairs all round. */
function meetingTable(F: Frame, f0: number, maxL: number, top: Mat, seat: (o: Obj) => void): boolean {
  const tw = F.W >= 3.8 ? 1.2 : F.W >= 3.0 ? 0.9 : 0;
  if (!tw) return false;
  let L = Math.min(F.D - f0 - 1.5, maxL);
  while (L >= 1.2 && !F.fits(f0 + L / 2, 0, tw, L)) L -= 0.3;
  if (L < 1.2) return false;
  const fm = f0 + L / 2;
  F.reserve(fm, 0, tw, L, 0.76);
  F.box(top, fm, 0, 0.72, tw, 0.045, L);
  for (const s of [-1, 1]) F.box(top, fm + s * (L / 2 - 0.45), 0, 0, tw * 0.45, 0.72, 0.12);
  F.box(top, fm, 0, 0.1, 0.08, 0.08, L - 0.9);
  const n = Math.max(1, Math.floor((L - 0.2) / 0.7));
  for (let i = 0; i < n; i += 1) {
    const f = fm - ((n - 1) * 0.7) / 2 + i * 0.7;
    for (const s of [-1, 1]) {
      const x = s * (tw / 2 + 0.3);
      if (F.free(f, x, 0.22)) seat(at(F, f, x, s > 0 ? 3 : 1));
    }
    if (F.rand() < 0.6) F.box('paper', f, s1(F) * (tw / 2 - 0.25), 0.765, 0.3, 0.01, 0.22);
  }
  if (F.free(f0 + L + 0.35, 0, 0.22)) seat(at(F, f0 + L + 0.35, 0, 0));
  if (F.free(f0 - 0.35, 0, 0.22) && f0 > 1.0) seat(at(F, f0 - 0.35, 0, 2));
  return true;
}

const s1 = (F: Frame): number => (F.rand() < 0.5 ? -1 : 1);

const conference: Furnisher = (room, k) => {
  const F0 = frameOf(room, k);
  // Run the table down the longer way, the TV on that end wall.
  const F = F0.W > F0.D * 1.15 ? F0.wall('left') : F0;
  const tx = F.spot(1.3, 1.0, 1.8);
  if (tx !== null) tv(F, tx, 1.05, 1.3);
  F.run(1.6, 0.45, 0.7, 1, (x) => Math.abs(x - (tx ?? 0)), (o) => {
    o.box('darkwood', 0, 0, 0, 0.45, 0.7, 1.6);
    o.box('black', 0.226, 0, 0.35, 0.004, 0.005, 1.5);
  });
  meetingTable(F, 1.3, 7, 'darkwood', (o) => officeChair(o, 'black', true));
  for (const wl of ['left', 'right'] as const) {
    const G = F.wall(wl);
    if (G.run(1.0, 0.35, Math.min(1.9, F.H - 0.3), 1, towardBack(F, G), (o) => bookshelf(o, 1.0, 0.35, Math.min(1.9, F.H - 0.3)))) break;
  }
  hang(F, ['back', 'left', 'right'], 0.9, 1.3, 2.0, (G, x) => picture(G, x, 1.35, 0.9, 0.65, 'cream'));
  inCorner(F, 0.5, false, (o) => plant(o, 1.1));
  inCorner(F, 0.45, true, (o) => dispenser(o));
  fans(F, 4, 4);
};

const auditorium: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D, H } = F;
  // Stage.
  const sh = clamp(0.6 + (D - 10) * 0.02, 0.6, 0.9);
  const sd = D >= 10 ? clamp(D * 0.22, 3, 6) : clamp(D * 0.28, 1.6, 3);
  let stage = false;
  let sw = W;
  if (H - sh >= 2.4) {
    for (const w of [W, W - 1.6, W - 3]) {
      if (w >= 3 && F.fits(sd / 2, 0, w, sd)) {
        sw = w;
        stage = true;
        break;
      }
    }
  }
  let f0 = 1.2;
  if (stage) {
    F.box('darkwood', sd / 2, 0, 0, sw, sh, sd, true);
    F.box('black', sd + 0.01, 0, 0.02, sw - 0.02, sh - 0.06, 0.02);
    // Steps up at each side (each rise ≤ 0.18 m).
    const n = Math.ceil(sh / 0.17);
    const rise = sh / n;
    const sl = (n - 1) * 0.3;
    for (const s of [-1, 1]) {
      const x = s * (sw / 2 - 0.7);
      if (!F.fits(sd + sl / 2, x, 1.0, sl)) continue;
      for (let i = 1; i < n; i += 1) F.box('darkwood', sd + (i - 0.5) * 0.3, x, 0, 1.0, sh - i * rise, 0.3, true);
    }
    f0 = sd + Math.max(1.2, sl + 0.5);
    // Curtains: backdrop, valance and gathered side curtains at the proscenium.
    const top = H - 0.05;
    F.box('red', 0.05, 0, sh, sw, top - sh, 0.06);
    F.box('red', sd - 0.35, 0, top - 0.45, sw, 0.45, 0.1);
    for (const s of [-1, 1]) {
      for (let j = 0; j < 3; j += 1) F.box('red', sd - 0.45 + (j % 2) * 0.07, s * (sw / 2 - 0.2 - j * 0.3), sh, 0.34, top - 0.45 - sh, 0.08);
    }
    const bw = Math.min(6, sw * 0.5);
    if (sh + 2.6 < top - 0.5) F.box('cream', 0.09, 0, sh + 2.2, bw, 0.7, 0.02);
    // Podium, and a row of guest chairs on stage.
    const p = at(F, sd - 1.1, sw * 0.28, 2);
    p.box('darkwood', 0, 0, sh, 0.5, 1.1, 0.6, true);
    p.box('sign', 0.255, 0, sh + 0.5, 0.01, 0.35, 0.45);
    p.cyl('black', 0.12, 0.18, sh + 1.1, 0.008, 0.32, { seg: 6 });
    const gl = Math.min(4, sw * 0.4);
    const t = at(F, Math.max(sd * 0.45, 1.0), -sw * 0.12, 2);
    if (sd >= 2.6) t.box('white', 0, 0, sh, 0.6, 0.76, gl, true);
    for (let i = 0; sd >= 2.6 && i < Math.floor(gl / 0.7); i += 1) {
      const c = t.sub(-0.55, -gl / 2 + 0.35 + i * 0.7);
      c.box('cushion', 0, 0, sh + 0.43, 0.44, 0.06, 0.46);
      c.box('cushion', -0.21, 0, sh + 0.49, 0.05, 0.55, 0.44);
      for (const s of [-1, 1]) c.box('chrome', 0, s * 0.2, sh, 0.4, 0.43, 0.03);
    }
  }
  // Seating: rows of cushioned seats in blocks with aisles; the back rows raked if the hall is long.
  const pitch = 0.95;
  const side = 1.0;
  const f1 = D - 1.3;
  const R = Math.max(0, Math.floor((f1 - f0) / pitch));
  const blocks = columns(W, 0.55, 0, side, 1.2, W >= 16 ? 7.2 : W >= 9 ? 5.5 : 4.4);
  const r0 = 4;
  let T = D >= 14 && R >= r0 + 3 ? Math.min(R - r0, Math.floor((H - 2.4) / 0.15)) : 0;
  let fe = f0 + R * pitch;
  let tierW = W;
  if (T > 0) {
    const fs = f0 + r0 * pitch;
    let ok = false;
    for (const w of [W, W - 2 * side]) {
      for (let e = fe; e - fs >= 3 * pitch; e -= pitch) {
        if (F.fits((fs + e) / 2, 0, w, e - fs)) {
          ok = true;
          fe = e;
          tierW = w;
          break;
        }
      }
      if (ok) break;
    }
    if (!ok) T = 0;
    T = Math.min(T, Math.round((fe - fs) / pitch));
    for (let t = 1; t <= T; t += 1) {
      const a = f0 + (r0 + t - 1) * pitch;
      F.box(t % 2 ? 'darkwood' : 'wood', (a + fe) / 2, 0, (t - 1) * 0.15, tierW, 0.15, fe - a, true);
    }
    if (T > 0 && T * 0.15 + 0.9 < H) F.box('metal', fe - 0.03, 0, T * 0.15, tierW, 0.9, 0.04);
  }
  for (let r = 0; r < R; r += 1) {
    const f = f0 + (r + 0.5) * pitch;
    const tier = T > 0 && r >= r0 && f < fe ? Math.min(r - r0 + 1, T) : 0;
    const y = tier * 0.15;
    for (const xs of blocks) {
      let run: number[] = [];
      const flush = () => {
        if (run.length) F.box('metal', f + 0.12, (run[0] + run[run.length - 1]) / 2, y, run[run.length - 1] - run[0] + 0.5, 0.36, 0.1);
        run = [];
      };
      for (const x of xs) {
        const onTier = tier > 0 && Math.abs(x) + 0.28 <= tierW / 2;
        if (tier > 0 && !onTier) {
          flush();
          continue;
        }
        if (!onTier && !F.fits(f, x, 0.55, pitch - 0.1)) {
          flush();
          continue;
        }
        const o = at(F, f, x, 0);
        o.box('cushion', 0.02, 0, y + 0.36, 0.46, 0.1, 0.5);
        o.box('cushion', -0.25, 0, y + 0.36, 0.08, 0.62, 0.5);
        run.push(x);
      }
      flush();
    }
  }
  fans(F, 5, 16);
};

const office: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const ch = Math.min(1.9, F.H - 0.3);
  // Steel almirahs and a bookshelf along the front wall.
  const na = F.run(0.9, 0.45, ch, Math.max(1, Math.min(4, Math.floor(W / 2))), corners, (o) => almirah(o, 0.9, ch));
  F.run(1.0, 0.35, ch, W > 3.5 ? 1 : 0, middle, (o) => bookshelf(o, 1.0, 0.35, ch));
  // Desks, each with a computer and a chair, the staff facing the door.
  const f0 = na ? 1.4 : 0.6;
  const placed = grid(F, { f0, f1: D - 1.1, w: 1.4, d: 1.35, pitch: 2.0, gap: 0.9, side: 0.75, aisle: 1.0, block: 3.0, clear: 0.7 }, (f, x) => {
    const o = at(F, f, x, 2);
    o.reserve(0.32, 0, 0.7, 1.4, 0.76);
    desk(o.sub(0.32, 0), 0.7, 1.3);
    monitor(o, 0.52, -0.2, 0.76);
    keyboard(o, 0.3, -0.2, 0.76);
    o.box('paper', 0.35, 0.42, 0.76, 0.3, 0.04 + F.rand() * 0.1, 0.24);
    if (F.rand() < 0.6) o.box(pick(F, ['blue', 'red', 'yellow'] as const), 0.5, 0.35, 0.76, 0.26, 0.05, 0.33);
    officeChair(o.sub(-0.32, 0), 'black');
  });
  if (!placed) frontTable(F, Math.min(1.3, D / 2), 0, 0, true);
  // Visitors' bench, a water dispenser and a notice board.
  for (const wl of ['left', 'right', 'back'] as const) {
    const G = F.wall(wl);
    if (G.run(1.5, 0.45, 0.9, 1, towardBack(F, G), (o) => bench(o.sub(-0.02, 0), 1.5, 'steel', 'metal'))) break;
  }
  inCorner(F, 0.4, true, (o) => dispenser(o));
  hang(F, ['left', 'right', 'back'], 1.2, 1.1, 2.0, (G, x) => noticeBoard(G, x, 1.2, 1.1));
  hang(F, ['back', 'right'], 0.3, 2.0, 2.45, (G, x) => clock(G, x));
  fans(F, 3.8, 4);
};

const chief: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const sh = Math.min(2.0, F.H - 0.3);
  // Bookshelves behind the desk, a framed photo between them.
  F.run(1.0, 0.4, sh, W >= 4 ? 2 : 1, corners, (o) => bookshelf(o, 1.0, 0.4, sh));
  const px = F.spot(0.8, 1.45, 2.2);
  if (px !== null) picture(F, px, 1.5, 0.6, 0.75, 'cream');
  // Executive desk with a glass top, high-back chair, two visitor chairs.
  const df = clamp(D * 0.3, 1.45, 2.2);
  const dw = Math.min(1.8, W - 1.7);
  const o = at(F, df, 0, 2);
  let band: [number, number] = [-1, -1];
  if (dw >= 1.2 && o.put(0.15, 0, 0.9, dw, 0.8)) {
    band = [0.3, df + 1.5];
    o.box('darkwood', 0.15, 0, 0.74, 0.9, 0.05, dw);
    o.box('glass', 0.15, 0, 0.79, 0.86, 0.01, dw - 0.06);
    for (const s of [-1, 1]) o.box('darkwood', 0.15, s * (dw / 2 - 0.25), 0, 0.85, 0.74, 0.45);
    o.box('darkwood', 0.57, 0, 0.2, 0.03, 0.54, dw - 0.94);
    o.box('sign', 0.48, 0.2, 0.8, 0.05, 0.07, 0.25);
    o.box('black', 0.1, -0.35, 0.8, 0.3, 0.02, 0.38);
    o.box('paper', 0.15, dw / 2 - 0.35, 0.8, 0.3, 0.06, 0.24);
    o.cyl('black', 0.3, -(dw / 2 - 0.15), 0.8, 0.04, 0.1, { seg: 8 });
    officeChair(o.sub(-0.6, 0), 'black', true);
    for (const s of [-1, 1]) {
      const v = o.sub(1.0, s * 0.45, 2);
      if (v.free(0, 0, 0.22)) chair(v, 'cushion', 'darkwood');
    }
    F.box('cushion', df + 0.5, 0, 0, Math.min(3, W - 1), 0.008, 1.6);
  } else frontTable(F, Math.min(1.3, D / 2), 0, 0, true);
  // Flag by the desk.
  for (const s of [1, -1]) {
    const fx = s * (W / 2 - 0.4);
    if (Math.abs(fx) > 1.3 && F.free(0.75, fx, 0.25)) {
      flag(at(F, 0.75, fx, 2));
      break;
    }
  }
  // Sofa set with a coffee table along a side wall toward the door.
  for (const wl of ['right', 'left'] as const) {
    const G = F.wall(wl);
    let sofaX: number | null = null;
    const n = G.run(2.0, 0.85, 0.85, 1, towardBack(F, G), (s) => {
      sofa(s, 2.0);
      sofaX = s.x;
    }, W >= 6 ? undefined : outside(F, G, 2.0, band[0], band[1]));
    if (!n || sofaX === null) continue;
    const t = at(G, 0.85 + 0.65, sofaX, 2);
    if (t.put(0, 0, 0.6, 1.1, 0.45)) {
      t.box('darkwood', 0, 0, 0, 0.55, 0.4, 1.05);
      t.box('glass', 0, 0, 0.4, 0.6, 0.02, 1.1);
      t.cyl('white', 0, 0.3, 0.42, 0.05, 0.1, { seg: 8 });
      const a = t.sub(0.75, 0, 2);
      if (a.fits(0, 0, 0.8, 0.9)) sofa(a, 0.9);
    }
    break;
  }
  const lw = F.wall('left');
  lw.run(0.9, 0.45, sh, 1, towardFront(F, lw), (a) => almirah(a, 0.9, sh, 'darkwood'), W >= 6 ? undefined : outside(F, lw, 0.9, band[0], band[1]));
  inCorner(F, 0.5, true, (p) => plant(p, 1.1));
  hang(F, ['back', 'right'], 0.3, 2.0, 2.45, (G, x) => clock(G, x));
  fans(F, 4, 2);
};

const counter: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D, H } = F;
  if (D < 3.8 || W < 2.4) {
    office(room, k);
    return;
  }
  // The counter crosses the room; the public stays on the door side, the clerks toward the front.
  const fc = clamp(D * 0.5, 2.1, D - 1.9);
  const runs = spans(F, fc, 0.6, -W / 2, W / 2, 1.2);
  const passage = 0.85;
  let made = 0;
  for (const [r0, r1] of runs) {
    // Leave a way through to the clerks' side at one end.
    let a0 = r0;
    let b = r1;
    const gl = r0 + W / 2;
    const gr = W / 2 - r1;
    if (gl < passage && gr < passage) {
      if (gr <= gl) b = r1 - (passage - gr);
      else a0 = r0 + (passage - gl);
    }
    const L = b - a0;
    const xm = (a0 + b) / 2;
    if (L < 1.2 || !F.put(fc, xm, L, 0.6, 1.1)) continue;
    made += 1;
    F.box('wood', fc, xm, 0, L, 1.0, 0.55);
    F.box('darkwood', fc, xm, 1.0, L, 0.04, 0.66);
    F.box('sign', fc + 0.28, xm - L * 0.2, 0.68, 0.6, 0.16, 0.01);
    // Glass panes with a slot to talk and pass papers through, or a grille on short counters.
    const top = Math.min(2.1, H - 0.15);
    if (top - 1.04 > 0.6) {
      const grille = L <= 2.6 && F.rand() < 0.5;
      const bays = Math.max(1, Math.round(L / 1.2));
      for (let i = 0; i <= bays; i += 1) F.box('metal', fc, xm - L / 2 + 0.02 + (i * (L - 0.04)) / bays, 1.04, 0.04, top - 1.04, 0.04);
      F.box('metal', fc, xm, top - 0.04, L, 0.04, 0.05);
      if (grille) {
        const nb = Math.floor(L / 0.15);
        for (let i = 1; i < nb; i += 1) F.box('metal', fc, xm - L / 2 + i * (L / nb), 1.3, 0.012, top - 1.34, 0.012);
        F.box('metal', fc, xm, 1.28, L, 0.03, 0.03);
      } else {
        for (let i = 0; i < bays; i += 1) F.box('glass', fc, xm - L / 2 + ((i + 0.5) * L) / bays, 1.3, L / bays - 0.06, top - 1.34, 0.01);
      }
      for (let i = 0; i < Math.min(3, bays + 1); i += 1) F.box('paper', fc + 0.012, xm - L / 2 + ((i + 0.5) * L) / Math.min(3, bays + 1), 1.45 + F.rand() * 0.2, 0.21, 0.3, 0.004);
    }
    // Clerks' desks right behind it, facing the public.
    for (let x = a0 + 0.8; x + 0.6 <= b + EPS; x += 1.6) {
      const o = at(F, fc - 0.32 - 0.36, x, 2);
      if (!o.fits(-0.3, 0, 1.25, 1.2)) continue;
      o.reserve(0, 0, 0.65, 1.2, 0.76);
      desk(o, 0.65, 1.2);
      monitor(o, 0.15, -0.25, 0.76);
      keyboard(o, -0.12, -0.25, 0.76);
      o.box('paper', 0.05, 0.35, 0.76, 0.3, 0.05 + F.rand() * 0.15, 0.24);
      officeChair(o.sub(-0.6, 0), 'black');
    }
  }
  if (!made) {
    office(room, k);
    return;
  }
  // File racks crammed with paper along the front wall and the clerks' side walls.
  const rh = Math.min(2.1, H - 0.2);
  const files: readonly Mat[] = ['paper', 'paper', 'cream', 'blue', 'red', 'paper'];
  F.run(1.0, 0.45, rh, Math.floor(W / 1.05), corners, (o) => rack(o, 1.0, 0.45, rh, files));
  for (const wl of ['left', 'right'] as const) {
    const G = F.wall(wl);
    G.run(1.0, 0.45, rh, 2, towardFront(F, G), (o, i) => {
      if (i === 0) rack(o, 1.0, 0.45, rh, files);
      else almirah(o, 1.0, Math.min(1.9, rh));
    }, outside(F, G, 1.0, fc - 2.0, D));
  }
  // The public side: a queue bench, a notice board and drinking water.
  for (const wl of ['back', 'left', 'right'] as const) {
    const G = F.wall(wl);
    const n = G.run(1.8, 0.45, 0.9, 1, wl === 'back' ? corners : towardBack(F, G), (o) => bench(o.sub(-0.02, 0), 1.8, 'steel', 'metal'), wl === 'back' ? undefined : outside(F, G, 1.8, 0, fc + 1.2));
    if (n) break;
  }
  for (const wl of ['left', 'right', 'back'] as const) {
    const G = F.wall(wl);
    const x = G.spot(1.2, 1.1, 2.0, 0);
    if (x === null || F.from(G, 0.3, x).f < fc + 0.5) continue;
    noticeBoard(G, x, 1.2, 1.1);
    break;
  }
  inCorner(F, 0.4, true, (o) => dispenser(o));
  fans(F, 4, 4);
};

const records: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D, H } = F;
  const rh = Math.min(2.2, H - 0.2);
  const files: readonly Mat[] = ['paper', 'cream', 'paper', 'paper', 'blue', 'red'];
  // Single racks against the front wall, then double rows with a main aisle.
  F.run(1.0, 0.45, rh, Math.floor(W), corners, (o) => rack(o, 1.0, 0.45, rh, files));
  const halves: [number, number][] = W >= 3.4 ? [[-W / 2, -0.6], [0.6, W / 2]] : [[-W / 2, W / 2 - 1.0]];
  for (let f = 0.45 + 0.95 + 0.3; f + 0.3 <= D - 1.2 + EPS; f += 1.55) {
    for (const [x0, x1] of halves) {
      for (const [a, b] of spans(F, f, 0.6, x0, x1, 0.9)) {
        if (!F.put(f, (a + b) / 2, b - a, 0.6, rh)) continue;
        rack(at(F, f, (a + b) / 2, 0), b - a, 0.6, rh, files);
      }
    }
  }
  // A ladder against the back wall and a table to sort files.
  const B = F.wall('back');
  const aisle = (x: number): boolean => Math.abs(x) > (W >= 3.4 ? 1.0 : 0) + 0.3;
  B.run(0.5, 0.12, Math.min(2.4, H - 0.1), 1, corners, (o) => {
    const lh = Math.min(2.4, H - 0.1);
    for (const s of [-1, 1]) o.box('metal', 0, s * 0.22, 0, 0.05, lh, 0.04);
    for (let i = 1; i * 0.3 < lh - 0.1; i += 1) o.box('metal', 0, 0, i * 0.3, 0.03, 0.025, 0.42);
  }, aisle);
  if (D >= 5 && W >= 3.4) {
    B.run(1.2, 0.6, 0.76, 1, corners, (o) => {
      table(o, 0.6, 1.2, 0.75, 'wood', 'metal');
      o.box('paper', 0, 0.2, 0.75, 0.3, 0.2, 0.25);
    }, (x) => aisle(x) && Math.abs(x) > 1.6);
  }
};

const library: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D, H } = F;
  const sh = Math.min(2.1, H - 0.25);
  // Issue / return counter by the door, the librarian between it and a side wall.
  const dx = F.doors.length ? F.doors[0].x : 0;
  for (const wl of (dx > 0 ? ['left', 'right'] : ['right', 'left']) as Wall[]) {
    const G = F.wall(wl);
    let done = false;
    const xs: number[] = [];
    for (let x = -G.W / 2 + 1.3; x <= G.W / 2 - 1.3; x += 0.2) xs.push(x);
    xs.sort((p, q) => towardBack(F, G)(p) - towardBack(F, G)(q));
    for (const x of xs) {
      if (G.D < 4 || !G.fits(0.75, x, 2.4, 1.5) || !G.wallFree(x, 2.4, 0, 1.2)) continue;
      const o = at(G, 1.2, x, 2);
      o.reserve(0, 0, 0.6, 2.2, 1.1);
      o.box('wood', 0, 0, 0, 0.55, 1.0, 2.2);
      o.box('darkwood', 0, 0, 1.0, 0.62, 0.04, 2.25);
      o.box('books', 0, -0.7, 1.04, 0.3, 0.2, 0.4);
      monitor(o, -0.05, 0.4, 1.04);
      officeChair(o.sub(-0.65, 0), 'black');
      G.mark(x, 2.4, 0, 1.2);
      done = true;
      break;
    }
    if (done) break;
  }
  // Catalogue cabinet and a newspaper stand on the walls.
  for (const wl of ['back', 'left', 'right'] as const) {
    const G = F.wall(wl);
    if (G.run(0.9, 0.5, 1.2, 1, wl === 'back' ? corners : towardBack(F, G), (o) => {
      o.box('wood', 0, 0, 0, 0.5, 1.1, 0.9);
      o.box('cream', 0.251, 0, 0.1, 0.004, 0.9, 0.82);
      for (let i = 0; i < 4; i += 1) o.box('wood', 0.255, 0, 0.1 + i * 0.225, 0.006, 0.02, 0.82);
      o.box('darkwood', 0, 0, 1.1, 0.5, 0.03, 0.9);
    })) break;
  }
  // Books all along the front wall.
  F.run(1.0, 0.35, sh, Math.floor(W / 1.02), corners, (o) => bookshelf(o, 1.0, 0.35, sh));
  // Rows of double stacks in the front part, reading tables in the back part.
  const split = D >= 9 ? D * 0.55 : D >= 6 ? D * 0.45 : 0;
  if (split > 0) {
    const usable = W - 2.4;
    const nB = Math.max(1, Math.ceil((usable + 1.4) / (5 + 1.4)));
    const bl = (usable - (nB - 1) * 1.4) / nB;
    if (bl >= 0.9) {
      for (let f = 0.35 + 1.25 + 0.28; f + 0.28 <= split + EPS; f += 1.84) {
        for (let b = 0; b < nB; b += 1) {
          const x = -usable / 2 + b * (bl + 1.4) + bl / 2;
          if (!F.put(f, x, bl, 0.56, sh)) continue;
          stack(at(F, f, x, 0), bl, 0.56, sh);
        }
      }
    }
  }
  const tl = W >= 5 ? 2.4 : 1.6;
  grid(F, { f0: split > 0 ? split + 0.6 : 1.6, f1: D - 1.1, w: tl, d: 2.1, pitch: 2.5, gap: 1.2, side: 1.2, aisle: 1.4, block: tl, clear: 0.7 }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0, 0, 1.0, tl, 0.76);
    table(o, 1.0, tl, 0.75, 'wood', 'darkwood');
    const per = Math.floor(tl / 0.8);
    for (let i = 0; i < per; i += 1) {
      const b = -tl / 2 + (tl * (i + 0.5)) / per;
      chair(o.sub(0.78, b, 2), 'wood', 'wood');
      chair(o.sub(-0.78, b, 0), 'wood', 'wood');
      if (F.rand() < 0.3) o.box('books', 0.2 * s1(F), b, 0.75, 0.22, 0.04, 0.16);
    }
  });
  newspaperStand(F);
  inCorner(F, 0.5, true, (o) => plant(o, 1.1));
  hang(F, ['back', 'left'], 0.3, 2.0, 2.45, (G, x) => clock(G, x));
  fans(F, 4.5, 16);
};

function newspaperStand(F: Frame): void {
  for (const wl of ['left', 'right', 'back'] as const) {
    const G = F.wall(wl);
    const n = G.run(1.2, 0.5, 1.5, 1, towardBack(F, G), (o) => {
      for (const s of [-1, 1]) o.box('wood', 0, s * 0.57, 0, 0.45, 1.5, 0.05);
      o.box('wood', -0.1, 0, 1.42, 0.06, 0.06, 1.1);
      for (let i = 0; i < 3; i += 1) o.box('wood', 0.05 - i * 0.05, 0, 0.75 + i * 0.07, 0.12, 0.02, 1.1);
      for (let i = 0; i < 3; i += 1) o.box('paper', -0.12, -0.38 + i * 0.38, 0.95, 0.01, 0.45, 0.34);
    });
    if (n) return;
  }
}

const reading: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  const sh = Math.min(2.0, F.H - 0.3);
  F.run(1.0, 0.35, sh, Math.floor(W / 1.02), corners, (o) => bookshelf(o, 1.0, 0.35, sh));
  for (const wl of ['left', 'right'] as const) {
    const G = F.wall(wl);
    G.run(1.0, 0.35, sh, Math.max(0, Math.floor(D / 3)), towardFront(F, G), (o) => bookshelf(o, 1.0, 0.35, sh));
  }
  const tl = W >= 5 ? 2.4 : 1.6;
  const n = grid(F, { f0: 1.4, f1: D - 1.0, w: tl, d: 2.1, pitch: 2.5, gap: 1.2, side: 0.9, aisle: 1.2, block: tl, clear: 0.7 }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0, 0, 1.0, tl, 0.76);
    table(o, 1.0, tl, 0.75, 'wood', 'darkwood');
    const per = Math.floor(tl / 0.8);
    for (let i = 0; i < per; i += 1) {
      const b = -tl / 2 + (tl * (i + 0.5)) / per;
      chair(o.sub(0.78, b, 2), 'wood', 'wood');
      chair(o.sub(-0.78, b, 0), 'wood', 'wood');
      if (F.rand() < 0.35) o.box(F.rand() < 0.5 ? 'paper' : 'books', 0.2 * s1(F), b, 0.75, 0.24, 0.03, 0.18);
    }
  });
  if (!n) {
    // Too small for a long table: a small one with two chairs.
    const o = at(F, D / 2, 0, 0);
    if (o.put(0, 0, 0.7, 1.0, 0.76)) {
      table(o, 0.7, 1.0, 0.75, 'wood', 'darkwood');
      for (const s of [-1, 1]) if (o.free(s * 0.6, 0, 0.22)) chair(o.sub(s * 0.6, 0, s > 0 ? 2 : 0), 'wood', 'wood');
    }
  }
  newspaperStand(F);
  fans(F, 4, 6);
};

const canteen: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D, H } = F;
  // Kitchen strip along the front wall: a steel worktop with a stove and pots.
  const deep = D >= 5;
  const kl = Math.min(3.2, W - 1.2);
  if (deep && kl >= 1.2) {
    F.run(kl, 0.6, 0.95, 1, middle, (o) => {
      o.box('steel', 0, 0, 0, 0.6, 0.86, kl);
      o.box('black', 0, -kl / 4, 0.86, 0.5, 0.08, 0.7);
      o.cyl('steel', 0, -kl / 4 - 0.17, 0.94, 0.15, 0.25, { seg: 10 });
      o.cyl('metal', 0, -kl / 4 + 0.17, 0.94, 0.17, 0.18, { seg: 10 });
      o.cyl('steel', 0, kl / 4, 0.86, 0.2, 0.35, { seg: 10 });
    });
  }
  // Menu board above it.
  const mx = F.spot(1.6, 1.4, 2.4);
  if (mx !== null && H > 2.5) {
    const top = Math.min(2.4, H - 0.1);
    F.box('black', 0.02, mx, top - 0.9, 1.6, 0.9, 0.03);
    F.box('sign', 0.04, mx, top - 0.22, 1.5, 0.16, 0.01);
    for (let i = 0; i < 5; i += 1) F.box('white', 0.04, mx - 0.25 + (i % 2) * 0.1, top - 0.36 - i * 0.1, 0.9 - (i % 3) * 0.15, 0.03, 0.006);
    F.mark(mx, 1.6, top - 0.9, top);
  }
  // Serving counter with trays, urns, the chiya urn and a snack case.
  const cf = deep ? 1.55 : 0.4;
  const cl = Math.min(5, W - 1.8);
  let cEnd = 0;
  if (cl >= 1.2) {
    const cx = -(W / 2 - cl / 2) + 0.05;
    const o = at(F, cf, cx, 2);
    if (o.put(0, 0, 0.65, cl, 1.0)) {
      cEnd = cf + 0.35;
      o.box('tile', 0, 0, 0, 0.6, 0.9, cl);
      o.box('steel', 0, 0, 0.9, 0.66, 0.04, cl + 0.02);
      const b0 = -cl / 2;
      o.cyl('chrome', 0, b0 + 0.35, 0.94, 0.2, 0.55, { seg: 12 });
      o.cyl('chrome', 0, b0 + 0.35, 1.49, 0.12, 0.08, { r2: 0.04, seg: 10 });
      o.box('black', 0.21, b0 + 0.35, 1.05, 0.06, 0.05, 0.04);
      o.cyl('white', 0.1, b0 + 0.75, 0.94, 0.045, 0.2, { seg: 8 });
      o.cyl('white', -0.1, b0 + 0.75, 0.94, 0.045, 0.15, { seg: 8 });
      if (cl >= 2) {
        for (let i = 0; i < 2; i += 1) {
          o.cyl('steel', 0, b0 + 1.2 + i * 0.4, 0.94, 0.15, 0.36, { seg: 10 });
          o.cyl('chrome', 0, b0 + 1.2 + i * 0.4, 1.3, 0.16, 0.03, { seg: 10 });
        }
      }
      if (cl >= 3.2) {
        o.box('orange', 0, b0 + 2.4, 0.94, 0.4, 0.12, 0.8);
        o.box('glass', 0, b0 + 2.4, 0.94, 0.48, 0.45, 0.9);
      }
      for (let i = 0; i < Math.max(1, Math.floor((cl - 3.3) / 0.5)); i += 1) {
        if (b0 + 3.15 + i * 0.5 > cl / 2 - 0.2) break;
        o.box('steel', 0, b0 + 3.15 + i * 0.5, 0.94, 0.45, 0.03 + i * 0.01, 0.35);
      }
    }
  }
  // Tables for four with plastic chairs or benches.
  grid(F, { f0: Math.max(cEnd + 1.2, 1.4), f1: D - 1.0, w: 1.2, d: 1.9, pitch: 2.25, gap: 0.8, side: 0.75, aisle: 1.0, block: 4.0, clear: 0.7 }, (f, x) => {
    const o = at(F, f, x, 0);
    o.reserve(0, 0, 0.7, 1.0, 0.76);
    table(o, 0.7, 1.0, 0.75, F.rand() < 0.5 ? 'cream' : 'wood', 'metal');
    if (F.rand() < 0.25) {
      for (const s of [-1, 1]) bench(o.sub(s * 0.6, 0, s > 0 ? 2 : 0), 1.0, 'wood', 'metal');
    } else {
      const mat: Mat = F.rand() < 0.5 ? 'red' : 'blue';
      for (const s of [-1, 1]) for (const b of [-0.25, 0.25]) chair(o.sub(s * 0.6, b, s > 0 ? 2 : 0), mat, mat);
    }
    if (F.rand() < 0.5) o.cyl('white', 0, 0.1, 0.75, 0.04, 0.09, { seg: 8 });
  });
  // Hand-wash sinks on a side wall, a bin, a water filter.
  for (const wl of ['left', 'right'] as const) {
    const G = F.wall(wl);
    const n = G.run(1.3, 0.5, 1.9, 1, towardBack(F, G), (o) => {
      for (const s of [-1, 1]) {
        o.box('white', 0, s * 0.32, 0, 0.18, 0.8, 0.18);
        o.box('white', 0.03, s * 0.32, 0.8, 0.45, 0.06, 0.55);
        o.box('water', 0.05, s * 0.32, 0.81, 0.3, 0.05, 0.4);
        o.cyl('chrome', -0.17, s * 0.32, 0.86, 0.015, 0.2, { seg: 8 });
        if (H > 2) o.box('glass', -0.24, s * 0.32, 1.3, 0.01, 0.5, 0.45);
      }
    });
    if (n) break;
  }
  inCorner(F, 0.45, true, (o) => dustbin(o, 'green'));
  inCorner(F, 0.4, true, (o) => dispenser(o));
  fans(F, 4, 12);
};

const firstaid: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  // Examination bed along a side wall, with a screen partition beside it.
  for (const wl of ['left', 'right'] as const) {
    const G = F.wall(wl);
    let bx: number | null = null;
    const n = G.run(1.95, 0.8, 0.85, 1, towardFront(F, G), (o) => {
      for (const s of [-1, 1]) for (const t of [-1, 1]) o.box('metal', s * 0.34, t * 0.88, 0, 0.04, 0.62, 0.04);
      o.box('metal', 0, 0, 0.62, 0.8, 0.05, 1.95);
      o.box('mattress', 0, 0, 0.67, 0.76, 0.09, 1.9);
      o.box('pillow', 0, 0.7, 0.76, 0.45, 0.08, 0.35);
      o.box('white', 0, 0.2, 0.761, 0.76, 0.004, 1.0);
      bx = o.x;
    });
    if (!n || bx === null) continue;
    const p = at(G, 0.8 + 0.35, bx, 2);
    if (W * D >= 12 && p.fits(0, 0, 0.3, 1.3)) {
      for (const s of [-1, 1]) {
        p.box('metal', 0, s * 0.32, 0, 0.3, 0.03, 0.04);
        p.box('metal', 0, s * 0.32, 0.03, 0.02, 1.7, 0.02);
        p.box(F.rand() < 0.5 ? 'green' : 'fabric', 0, s * 0.32, 0.3, 0.01, 1.35, 0.6);
      }
    }
    break;
  }
  // Doctor's desk, chairs.
  const dxs = [W / 2 - 1.0, -(W / 2 - 1.0), 0];
  for (const x of dxs) {
    const o = at(F, 1.0, x, 2);
    if (!o.fits(-0.2, 0, 1.2, 1.1)) continue;
    o.reserve(0.1, 0, 0.6, 1.1, 0.76);
    desk(o.sub(0.1, 0), 0.6, 1.1);
    o.box('paper', 0.15, 0.25, 0.76, 0.3, 0.03, 0.22);
    o.cyl('black', 0.2, -0.35, 0.76, 0.04, 0.1, { seg: 8 });
    chair(o.sub(-0.45, 0, 0), 'chair');
    if (o.free(0.8, 0, 0.22)) chair(o.sub(0.8, 0, 2), 'chair');
    break;
  }
  // Medicine cabinet, a first-aid box on the wall, a wheelchair.
  const mh = Math.min(1.8, F.H - 0.3);
  for (const wl of ['front', 'right', 'left', 'back'] as const) {
    const G = F.wall(wl);
    if (G.run(0.8, 0.35, mh, 1, corners, (o) => {
      o.box('white', 0, 0, 0, 0.35, mh, 0.8);
      o.box('glass', 0.178, 0, mh * 0.45, 0.006, mh * 0.5, 0.72);
      o.box('red', 0.18, 0, mh * 0.2, 0.006, 0.24, 0.07);
      o.box('red', 0.18, 0, mh * 0.2 + 0.085, 0.006, 0.07, 0.24);
    })) break;
  }
  hang(F, ['front', 'right', 'left', 'back'], 0.4, 1.3, 1.65, (G, x) => {
    G.box('white', 0.06, x, 1.35, 0.36, 0.28, 0.12);
    G.box('red', 0.122, x, 1.4, 0.06, 0.18, 0.004);
    G.box('red', 0.122, x, 1.46, 0.18, 0.06, 0.004);
    G.mark(x, 0.4, 1.3, 1.65);
  });
  inCorner(F, 0.75, true, (o) => {
    o.box('black', 0, 0, 0.48, 0.45, 0.05, 0.45);
    o.box('black', -0.22, 0, 0.53, 0.03, 0.45, 0.45);
    for (const s of [-1, 1]) {
      o.cyl('rubber', -0.05, s * 0.29, 0.3, 0.3, 0.03, { axis: 'b', seg: 12 });
      o.cyl('rubber', 0.25, s * 0.2, 0.07, 0.07, 0.03, { axis: 'b', seg: 8 });
    }
    o.box('metal', 0.3, 0, 0.12, 0.15, 0.02, 0.35);
  });
  inCorner(F, 0.4, false, (o) => dustbin(o, 'white'));
  if (W * D > 12) inCorner(F, 0.4, true, (o) => dispenser(o));
  fans(F, 4, 2);
};

const lobby: Furnisher = (room, k) => {
  const F = frameOf(room, k);
  const { W, D } = F;
  // Reception desk facing the entrance.
  const rf = clamp(D * 0.35, 1.5, 3.5);
  const rl = Math.min(2.2, W - 2.6);
  const o = at(F, rf, 0, 2);
  let band: [number, number] = [-1, -1];
  if (rl >= 1.2 && o.put(0, 0, 1.2, rl, 1.1)) {
    band = [rf - 1.0, rf + 1.0];
    o.box('wood', 0.25, 0, 0, 0.12, 1.05, rl);
    o.box('darkwood', 0.25, 0, 1.05, 0.3, 0.04, rl + 0.05);
    o.box('wood', -0.05, 0, 0.72, 0.55, 0.04, rl);
    for (const s of [-1, 1]) o.box('wood', 0, s * (rl / 2 - 0.03), 0, 0.6, 1.05, 0.06);
    o.box('sign', 0.315, 0, 0.6, 0.01, 0.22, Math.min(0.9, rl - 0.3));
    monitor(o, 0.05, -0.4, 0.76);
    o.box('paper', -0.05, 0.4, 0.76, 0.3, 0.03, 0.24);
    officeChair(o.sub(-0.5, 0), 'black');
    const sx = F.spot(2.0, 1.6, 2.4);
    if (sx !== null && F.H > 2.6) {
      F.box('sign', 0.02, sx, 1.65, 2.0, Math.min(0.6, F.H - 1.8), 0.03);
      F.mark(sx, 2.0, 1.6, 2.4);
    }
  }
  // Building directory near the way in, notice boards on the side walls.
  for (const wl of ['left', 'right', 'back'] as const) {
    const G = F.wall(wl);
    const xs: number[] = [];
    for (let x = -G.W / 2 + 0.6; x <= G.W / 2 - 0.6; x += 0.2) xs.push(x);
    xs.sort((p, q) => towardBack(F, G)(p) - towardBack(F, G)(q));
    const x = xs.find((v) => G.wallFree(v, 1.1, 0.8, 2.2));
    if (x === undefined || F.H < 2.4) continue;
    G.box('darkwood', 0.02, x, 0.8, 1.1, 1.4, 0.04);
    G.box('black', 0.045, x, 0.85, 1.0, 1.3, 0.01);
    G.box('sign', 0.052, x, 1.95, 0.9, 0.15, 0.004);
    for (let i = 0; i < 6; i += 1) G.box('white', 0.052, x - 0.1 + (i % 2) * 0.05, 1.8 - i * 0.15, 0.7 - (i % 3) * 0.1, 0.04, 0.004);
    G.mark(x, 1.1, 0.8, 2.2);
    break;
  }
  hang(F, ['left'], 1.8, 1.05, 1.95, (G, x) => noticeBoard(G, x, 1.8));
  hang(F, ['right'], 1.8, 1.05, 1.95, (G, x) => noticeBoard(G, x, 1.8));
  // Seating along the side walls.
  for (const wl of ['left', 'right'] as const) {
    const G = F.wall(wl);
    G.run(1.8, 0.8, 0.85, clamp(Math.floor(D / 4), 1, 4), middle, (s, i) => {
      if ((i + (wl === 'left' ? 0 : 1)) % 2) bench(s.sub(-0.2, 0), 1.8, 'steel', 'metal');
      else sofa(s, 1.8, 'fabric');
    }, W >= 7 ? undefined : outside(F, G, 1.8, band[0], band[1]));
  }
  // A round planter in the middle of a big hall.
  const pf = D * 0.65;
  if (W * D >= 60 && W >= 7 && F.put(pf, 0, 2.4, 2.4, 0.5)) {
    F.cyl('brick', pf, 0, 0, 1.15, 0.45, { seg: 12 });
    F.cyl('soil', pf, 0, 0.45, 1.05, 0.02, { seg: 12 });
    for (const [a, b] of [[0, 0], [0.5, 0.4], [-0.45, -0.35], [0.4, -0.5]]) F.cyl('plant', pf + a, b, 0.47, 0.32, 0.8 + (a + b) * 0.2, { r2: 0.05, seg: 8 });
  }
  // Potted plants in the corners.
  let plants = 0;
  for (let i = 0; i < 4 && plants < 4; i += 1) {
    const f = i < 2 ? 0.35 : D - 0.35;
    const x = (i % 2 ? 1 : -1) * (W / 2 - 0.35);
    if (F.fits(f, x, 0.6, 0.6)) {
      F.reserve(f, x, 0.45, 0.45, 1.0);
      plant(at(F, f, x, 0), 1.2);
      plants += 1;
    }
  }
  inCorner(F, 0.4, true, (b) => dustbin(b, 'green'));
  if (D >= 5) inCorner(F, 0.4, false, (b) => dispenser(b));
  fans(F, 4.5, 6);
};

const union: Furnisher = (room, k) => {
  const F0 = frameOf(room, k);
  const F = F0.W > F0.D * 1.2 ? F0.wall('left') : F0;
  const { W } = F;
  const ch = Math.min(1.9, F.H - 0.3);
  // Cupboards on the front wall, the union banner and flags.
  F.run(0.9, 0.45, ch, W >= 5 ? 2 : 1, corners, (o) => almirah(o, 0.9, ch, F.rand() < 0.5 ? 'metal' : 'darkwood'));
  const bx = F.spot(2.0, 1.3, 2.3);
  if (bx !== null && F.H > 2.5) {
    F.box('red', 0.015, bx, 1.4, 2.0, Math.min(0.8, F.H - 1.6), 0.02);
    F.box('white', 0.03, bx, 1.6, 1.4, 0.25, 0.006);
    F.mark(bx, 2.0, 1.3, 2.3);
  }
  let flags = 0;
  for (const s of [1, -1]) {
    const fx = s * (W / 2 - 0.4);
    if (F.free(0.8, fx, 0.25)) {
      flag(at(F, 0.8, fx, 2), flags ? 'blue' : 'red', flags ? 'white' : 'blue');
      flags += 1;
    }
  }
  meetingTable(F, 1.6, 4, 'wood', (o) => chair(o, 'chair'));
  // Posters and notice boards, a sofa.
  for (const wl of ['left', 'right', 'back'] as const) {
    const G = F.wall(wl);
    const x = G.spot(1.5, 1.05, 1.95);
    if (x !== null) noticeBoard(G, x, 1.5);
    for (let i = 0; i < (G.W >= 3.5 ? 2 : G.W >= 2.8 ? 1 : 0); i += 1) {
      const px = G.spot(0.55, 1.2, 1.95, (i ? 1 : -1) * G.W * 0.3);
      if (px === null) continue;
      G.box(pick(F, ['red', 'blue', 'yellow', 'orange', 'green'] as const), 0.01, px, 1.25, 0.5, 0.7, 0.01);
      G.box('paper', 0.018, px, 1.5, 0.36, 0.2, 0.004);
      G.mark(px, 0.55, 1.2, 1.95);
    }
  }
  for (const wl of ['back', 'right', 'left'] as const) {
    const G = F.wall(wl);
    if (G.run(2.0, 0.85, 0.85, 1, wl === 'back' ? corners : towardBack(F, G), (o) => sofa(o, 2.0, 'fabric'))) break;
  }
  inCorner(F, 0.4, true, (o) => dispenser(o));
  inCorner(F, 0.4, false, (o) => dustbin(o));
  fans(F, 4, 6);
};

export const FURNISH: Record<string, Furnisher> = {
  classroom,
  drawing,
  computerLab,
  scienceLab,
  electronicsLab,
  seminar,
  conference,
  auditorium,
  office,
  chief,
  counter,
  records,
  library,
  reading,
  canteen,
  firstaid,
  lobby,
  union,
};
