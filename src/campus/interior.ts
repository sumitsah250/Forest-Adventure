// Walk-in buildings. Every campus building with a use (interiors/program.ts) is built
// from its mapped footprint so the outside matches the real building and the inside fits it:
//
//  - The footprint is turned into the building's own frame (its walls run along u and v,
//    v the long way) and rasterised on a 0.5 m grid.
//  - Layouts: 'corridor' (a corridor down the long axis with rooms either side, or along one
//    side when the building is narrow, or rooms opening into each other when narrower still),
//    'hall' (one open hall, e.g. a workshop, with small rooms partitioned off its far end) and
//    'single' (one room). Rooms split at the footprint's own corners, so they follow its wings.
//  - The main door is on the wall that faces the nearest path (or where mapped steps meet it);
//    if it opens into a room, that room becomes the entrance hall. Long corridors get a back door.
//  - A switchback stair in a room-sized well links the floors of multi-storey buildings.
//  - Every room gets a doorway (to the corridor, or to the room nearer the entrance), a sign,
//    lights and furniture for its use (interiors/work.ts, study.ts, living.ts).
//
// The shell (walls with real windows, floors, ceilings, their colliders) is built at load for
// every building. The contents (partitions, stairs, furniture, signs) are built when the camera
// comes within NEAR metres and dropped beyond FAR, one building per frame, so the whole campus
// can be walk-in without the memory of all of it at once.

import * as THREE from 'three';
import type { GeoBuilder } from '../render/geoBuilder.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { glowSeed, pointInPoly, polyArea, type BuildingData, type Pt } from './geo.ts';
import type { CampusGround } from './ground.ts';
import { Batch, allInteriorMaterials, palette, seeded, type Kit, type Mat, type Room, type Side } from './interiors/kit.ts';
import { furnishRoom, selfLit } from './interiors/furnish.ts';
import type { Layout, Program, RoomSpec } from './interiors/program.ts';

const CELL = 0.5;
const SLAB = 0.22;
const EXT = 0.25;
const INT = 0.14;
const DOOR_H = 2.1;
const RISE = 0.18;
const TREAD = 0.28;
/** The glass area of world.ts facadeTexture() in one bay and storey (u across, v up; the canvas is flipped). */
const WIN_U0 = 52 / 256;
const WIN_U1 = 204 / 256;
const WIN_V0 = 1 - 172 / 256;
const WIN_V1 = 1 - 54 / 256;
/** Contents are built inside NEAR metres of a building and dropped beyond FAR. */
const NEAR = 60;
const FAR = 90;
/** Built contents are drawn only within VIEW metres (through windows, further detail isn't worth the draw calls). */
const VIEW = 45;
/** Time per frame spent building contents (ms); a building takes a few frames, well inside NEAR - VIEW. */
const BUDGET_MS = 2.5;
/** Keep this clear in front of every doorway (m). */
const DOOR_CLEAR = 1.0;

type Collider = ReturnType<PhysicsWorld['addBox']>;

export interface RoofInfo {
  pitched: boolean;
  gable?: boolean;
  rise?: number;
  rect?: { cx: number; cz: number; angle: number; hl: number; hw: number };
  /** Ridge offset across the rectangle (m, as in world.ts hipRoof). */
  ridgeV?: number;
}

export interface PlanOpts {
  levels: number;
  storeyH: number;
  bay: number;
  roof: RoofInfo;
  /** Lower is better: how good a spot just outside a wall is for the main door (world x, z). */
  scoreOut: (x: number, z: number) => number;
}

export interface DoorSpot { x: number; z: number; y: number; facing: number; doorX: number; doorZ: number }

export interface EnterableBuild {
  floor: number;
  top: number;
  /** Outside the main doorway (where people wait), facing out; door centre on the wall. */
  entrance: DoorSpot;
  /** Other outside doors (a long corridor's far end). */
  extra: DoorSpot[];
}

interface Frame {
  w: (u: number, v: number) => [number, number];
  l: (x: number, z: number) => [number, number];
  /** World direction of a local direction. */
  dir: (du: number, dv: number) => [number, number];
}

interface Rect { u0: number; u1: number; v0: number; v1: number }

interface PRoom {
  id: number;
  floor: number;
  spec: RoomSpec;
  rect: Rect;
  doors: { u: number; v: number }[];
  front: Side;
  /** Sign position (on the corridor side of its door) or null. */
  sign: { u: number; v: number; nu: number; nv: number } | null;
}

/** A doorway in a partition: wall along `axis` on grid line `line`, spanning cells [a, b). */
interface IDoor { floor: number; axis: 'u' | 'v'; line: number; a: number; b: number; room: number; other: number }

interface XDoor { edge: number; t: number; w: number; h: number; lu: number; lv: number; probe: [number, number] }

export interface InteriorPlan {
  b: BuildingData;
  prog: Program;
  name: string;
  pts: Pt[];
  F: Frame;
  ry: number;
  nu: number;
  nv: number;
  inside: Uint8Array;
  layout: Layout;
  levels: number;
  H: number;
  bay: number;
  F0: number;
  top: number;
  y0: number;
  openRoof: boolean;
  roof: RoofInfo;
  ids: Int16Array[];
  rooms: PRoom[];
  doors: IDoor[];
  xdoors: XDoor[];
  stair: { side: number; sU0: number; sU1: number; sV0: number; sV1: number; vS: number; holeV1: number; steps: number; flightRun: number } | null;
  corridor: [number, number] | null;
  cx: number;
  cz: number;
  radius: number;
  seed: number;
}

// ==================================================================== plan

export function planEnterable(b: BuildingData, ground: CampusGround, prog: Program, o: PlanOpts): InteriorPlan | null {
  let pts = b.pts.slice();
  if (pts.length < 3) return null;
  if (polyArea(pts) < 0) pts = pts.reverse();
  const area = polyArea(pts);
  if (area < 5) return null;

  // ---------------------------------------------------------------- frame
  const hist = new Map<number, number>();
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const c = pts[(i + 1) % pts.length];
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    let ang = Math.atan2(c[1] - a[1], c[0] - a[0]);
    ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const k = Math.round((ang * 180) / Math.PI) % 90;
    hist.set(k, (hist.get(k) ?? 0) + len);
  }
  let th = (([...hist.entries()].sort((p, q) => q[1] - p[1])[0][0]) * Math.PI) / 180;
  const extent = (t: number) => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const us = pts.map(([x, z]) => x * c + z * s);
    const vs = pts.map(([x, z]) => -x * s + z * c);
    return { du: Math.max(...us) - Math.min(...us), dv: Math.max(...vs) - Math.min(...vs), mu: Math.min(...us), mv: Math.min(...vs) };
  };
  if (extent(th).du > extent(th).dv) th += Math.PI / 2;
  const ex = extent(th);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const F: Frame = {
    w: (u, v) => [(u + ex.mu) * c - (v + ex.mv) * s, (u + ex.mu) * s + (v + ex.mv) * c],
    l: (x, z) => [x * c + z * s - ex.mu, -x * s + z * c - ex.mv],
    dir: (du, dv) => [du * c - dv * s, du * s + dv * c],
  };
  const ry = -th;
  const lpts: Pt[] = pts.map(([x, z]) => F.l(x, z));

  // ---------------------------------------------------------------- grid
  const nu = Math.ceil(ex.du / CELL) + 1;
  const nv = Math.ceil(ex.dv / CELL) + 1;
  // Cells whose centre is inside (scanline fill), and cells within 0.55 m of a wall line.
  const inside = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j += 1) {
    const v = (j + 0.5) * CELL;
    const xs: number[] = [];
    for (let k = 0; k < lpts.length; k += 1) {
      const a = lpts[k];
      const q = lpts[(k + 1) % lpts.length];
      if ((a[1] > v) !== (q[1] > v)) xs.push(a[0] + ((v - a[1]) * (q[0] - a[0])) / (q[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil(xs[k] / CELL - 0.5));
      const i1 = Math.min(nu - 1, Math.floor(xs[k + 1] / CELL - 0.5));
      for (let i = i0; i <= i1; i += 1) inside[j * nu + i] = 1;
    }
  }
  const nearWall = new Uint8Array(nu * nv);
  for (let k = 0; k < lpts.length; k += 1) {
    const a = lpts[k];
    const q = lpts[(k + 1) % lpts.length];
    const ia = Math.max(0, Math.floor(Math.min(a[0], q[0]) / CELL) - 2);
    const ib = Math.min(nu - 1, Math.floor(Math.max(a[0], q[0]) / CELL) + 2);
    const ja = Math.max(0, Math.floor(Math.min(a[1], q[1]) / CELL) - 2);
    const jb = Math.min(nv - 1, Math.floor(Math.max(a[1], q[1]) / CELL) + 2);
    for (let j = ja; j <= jb; j += 1) for (let i = ia; i <= ib; i += 1) {
      if (!nearWall[j * nu + i] && segDist((i + 0.5) * CELL, (j + 0.5) * CELL, a, q) < 0.45) nearWall[j * nu + i] = 1;
    }
  }
  const isIn = (i: number, j: number) => i >= 0 && j >= 0 && i < nu && j < nv && inside[j * nu + i] === 1;

  // ---------------------------------------------------------------- levels
  const levels = Math.max(1, o.levels);
  const H = o.storeyH;
  let gmin = Infinity;
  for (const [x, z] of pts) gmin = Math.min(gmin, ground.heightAt(x, z));
  const pad = ground.padLevel(b) ?? gmin;
  const F0 = pad + 0.45;
  const top = F0 + levels * H;
  const y0 = Math.min(gmin, pad) - 0.6;

  let layout: Layout = prog.layout;
  if (layout !== 'corridor' && levels > 1) layout = 'corridor';
  if (layout === 'corridor' && levels === 1 && (area < 40 || ex.du < 4.2)) layout = 'single';
  const openRoof = o.roof.pitched && layout !== 'corridor';

  // Main body: columns inside for most of the length.
  const rowsIn = new Array(nv).fill(0).map((_, j) => inside.subarray(j * nu, (j + 1) * nu).some((x) => x)).filter(Boolean).length;
  const colCount = new Array(nu).fill(0).map((_, i) => {
    let k = 0;
    for (let j = 0; j < nv; j += 1) k += inside[j * nu + i];
    return k;
  });
  const bodyCols = colCount.map((k, i) => (k >= rowsIn * 0.8 ? i : -1)).filter((i) => i >= 0);
  const b0 = bodyCols.length ? bodyCols[0] : 0;
  const b1 = bodyCols.length ? bodyCols[bodyCols.length - 1] + 1 : nu;

  // ---------------------------------------------------------------- corridor and room slots
  let c0 = 0;
  let c1 = 0;
  if (layout === 'corridor') {
    const W = (b1 - b0) * CELL;
    if (W >= prog.corridor + 2 * 2.7) {
      const half = Math.round(prog.corridor / CELL / 2);
      const mid = Math.round((b0 + b1) / 2);
      c0 = mid - half;
      c1 = mid + half;
    } else if (W >= 1.5 + 2.7) {
      c0 = b0;
      c1 = b0 + 3;
    } else {
      c0 = b0;
      c1 = b0;
    }
  }
  const segs: [number, number][] = [];
  {
    const vy = [...new Set(lpts.map((p) => Math.round(p[1] / CELL)))].sort((p, q) => p - q);
    const cuts: number[] = [];
    const minGap = Math.max(4, Math.round((prog.roomLen * 0.55) / CELL));
    for (const y of vy) if (!cuts.length || y - cuts[cuts.length - 1] >= minGap) cuts.push(y);
    if (cuts.length < 2) cuts.push(nv - 1);
    if (cuts[cuts.length - 1] < nv - 1) cuts[cuts.length - 1] = nv - 1;
    if (cuts[0] > 0) cuts[0] = 0;
    for (let k = 0; k < cuts.length - 1; k += 1) {
      const a = cuts[k];
      const z = cuts[k + 1];
      const parts = Math.max(1, Math.round(((z - a) * CELL) / prog.roomLen));
      for (let p = 0; p < parts; p += 1) segs.push([Math.round(a + ((z - a) * p) / parts), Math.round(a + ((z - a) * (p + 1)) / parts)]);
    }
  }
  const segOf = new Int16Array(nv).fill(-1);
  segs.forEach(([a, z], k) => {
    for (let j = a; j < z; j += 1) segOf[j] = k;
  });
  if (segs.length) for (let j = segs[segs.length - 1][1]; j < nv; j += 1) segOf[j] = segs.length - 1;
  const keyAt = (i: number, j: number): string | null => {
    if (layout !== 'corridor') return null;
    if (i >= c0 && i < c1) return null;
    const seg = segOf[j];
    if (seg < 0) return null;
    return `${i < c0 ? -1 : 1}:${seg}`;
  };
  const roomKeys: string[] = [];
  for (const side of [-1, 1]) for (let k = 0; k < segs.length; k += 1) roomKeys.push(`${side}:${k}`);

  // ---------------------------------------------------------------- stairs
  const steps = Math.round(H / 2 / RISE);
  const flightRun = steps * TREAD;
  let stair: InteriorPlan['stair'] = null;
  const stairKeys = new Set<string>();
  if (layout === 'corridor' && levels > 1) {
    const need = flightRun + 2.6;
    let best: { side: number; k0: number; k1: number; iu0: number; iu1: number; score: number } | null = null;
    for (let k0 = 0; k0 < segs.length; k0 += 1) {
      for (const span of [0, 1]) {
        const k1 = k0 + span;
        if (k1 >= segs.length) continue;
        for (const side of [-1, 1]) {
          const iu0 = side < 0 ? b0 : c1;
          const iu1 = side < 0 ? c0 : b1;
          if ((iu1 - iu0) * CELL < 2.6) continue;
          const jv0 = segs[k0][0];
          const jv1 = segs[k1][1];
          if ((jv1 - jv0) * CELL < need) continue;
          let ok = true;
          for (let j = jv0; j < jv1 && ok; j += 1) for (let i = iu0; i < iu1 && ok; i += 1) if (!isIn(i, j)) ok = false;
          if (!ok) continue;
          const score = Math.abs((jv0 + jv1) / 2 - nv / 2) * CELL + span * 4;
          if (!best || score < best.score) best = { side, k0, k1, iu0, iu1, score };
        }
      }
    }
    if (best) {
      for (let k = best.k0; k <= best.k1; k += 1) stairKeys.add(`${best.side}:${k}`);
      const sV0 = segs[best.k0][0] * CELL;
      const sV1 = segs[best.k1][1] * CELL;
      const vS = sV0 + 1.0;
      stair = { side: best.side, sU0: best.iu0 * CELL, sU1: best.iu1 * CELL, sV0, sV1, vS, holeV1: Math.min(sV1 - 0.2, vS + flightRun + 1.5), steps, flightRun };
    }
  }

  // ---------------------------------------------------------------- rooms named by mapped points
  const alias = new Map<string, string>();
  const poiKey = new Map<string, RoomSpec>();
  if (layout === 'corridor') {
    for (const p of prog.pois) {
      const [pu, pv] = F.l(p.x, p.z);
      let key: string | null = null;
      let bd = Infinity;
      for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
          if (!isIn(i, j)) continue;
          const k = keyAt(i, j);
          if (!k || stairKeys.has(k) || poiKey.has(k)) continue;
          const d = Math.hypot((i + 0.5) * CELL - pu, (j + 0.5) * CELL - pv);
          if (d < bd && d < 8) {
            bd = d;
            key = k;
          }
        }
      }
      if (!key) continue;
      poiKey.set(key, p.spec);
      if (p.spec.big) {
        const [side, seg] = key.split(':').map(Number);
        for (const n of [seg + 1, seg - 1]) {
          const nk = `${side}:${n}`;
          if (n < 0 || n >= segs.length || stairKeys.has(nk) || poiKey.has(nk) || alias.has(nk)) continue;
          alias.set(nk, key);
          break;
        }
      }
    }
  }

  const floorIds = (f: number, lobbyKey: string) => {
    const id = new Int16Array(nu * nv).fill(-1);
    for (let j = 0; j < nv; j += 1) {
      for (let i = 0; i < nu; i += 1) {
        if (!inside[j * nu + i]) continue;
        let k = keyAt(i, j);
        if (!k) {
          id[j * nu + i] = 0;
          continue;
        }
        k = (f === 0 ? alias.get(k) : undefined) ?? k;
        id[j * nu + i] = stairKeys.has(k) || (f === 0 && k === lobbyKey) ? 0 : roomKeys.indexOf(k) + 1;
      }
    }
    return id;
  };

  // ---------------------------------------------------------------- outside doors
  const ids0 = floorIds(0, '');
  const inStair = (u: number, v: number) => !!stair && u > stair.sU0 - 0.5 && u < stair.sU1 + 0.5 && v > stair.sV0 && v < stair.sV1;
  const cands: { x: XDoor; score: number; id: number; key: string | null }[] = [];
  const mkDoors = (w: number, h: number) => {
    const out: { x: XDoor; score: number; id: number; key: string | null }[] = [];
    for (let i = 0; i < lpts.length; i += 1) {
      const p = lpts[i];
      const q = lpts[(i + 1) % lpts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < w + 0.7) continue;
      const du = (q[0] - p[0]) / len;
      const dv = (q[1] - p[1]) / len;
      let inU = -dv;
      let inV = du;
      const mu = (p[0] + q[0]) / 2;
      const mv = (p[1] + q[1]) / 2;
      if (!pointInPoly(mu + inU * 0.4, mv + inV * 0.4, lpts)) {
        inU = -inU;
        inV = -inV;
      }
      const span = len - w - 0.6;
      const n = Math.max(1, Math.floor(span / 3) + 1);
      for (let sI = 0; sI < n; sI += 1) {
        const at = w / 2 + 0.3 + (n === 1 ? span / 2 : (span * sI) / (n - 1));
        const t = at / len;
        const pu = p[0] + du * at;
        const pv = p[1] + dv * at;
        const probe: [number, number] = [pu + inU * 0.6, pv + inV * 0.6];
        const ci = Math.floor(probe[0] / CELL);
        const cj = Math.floor(probe[1] / CELL);
        if (!isIn(ci, cj)) continue;
        // Both jambs must open onto floor too.
        let ok = true;
        for (const sd of [-1, 1]) {
          const ju = pu + du * sd * (w / 2 - 0.1) + inU * 0.6;
          const jv = pv + dv * sd * (w / 2 - 0.1) + inV * 0.6;
          if (!pointInPoly(ju, jv, lpts)) ok = false;
        }
        if (!ok) continue;
        const id = ids0[cj * nu + ci];
        // The whole doorway opens into one space for the first 1.2 m (no partition meets it).
        for (const sd of [-1, -0.5, 0, 0.5, 1]) {
          for (const dep of [0.35, 0.8, 1.25]) {
            const qu = pu + du * sd * (w / 2 - 0.12) + inU * dep;
            const qv = pv + dv * sd * (w / 2 - 0.12) + inV * dep;
            if (cellId(ids0, nu, nv, qu, qv) !== id) ok = false;
          }
        }
        if (!ok) continue;
        const key = keyAt(ci, cj);
        const [ox, oz] = F.w(pu - inU * 3, pv - inV * 3);
        let score = o.scoreOut(ox, oz) - Math.min(len, 12) * 0.15 + Math.abs(t - 0.5) * len * 0.04;
        // Into a room: it becomes the entrance hall, unless it is a named room (then it keeps its door).
        if (id > 0) score += key && poiKey.has(alias.get(key) ?? key) ? 1 : 2.5;
        if (inStair(probe[0], probe[1])) score += 20;
        out.push({ x: { edge: i, t, w, h, lu: pu, lv: pv, probe }, score, id, key });
      }
    }
    return out;
  };
  const doorH = Math.max(2.1, Math.min(prog.doorH, H - 0.35));
  cands.push(...mkDoors(prog.doorW, doorH));
  if (!cands.length) cands.push(...mkDoors(1.0, Math.max(2.0, Math.min(2.2, H - 0.3))));
  if (!cands.length) return null;
  cands.sort((p, q) => p.score - q.score);
  const main = cands[0];
  const xdoors: XDoor[] = [main.x];
  const mainKey = main.key ? (alias.get(main.key) ?? main.key) : '';
  const lobbyKey = layout === 'corridor' && main.id > 0 && mainKey && !poiKey.has(mainKey) ? mainKey : '';
  if (prog.backDoor && layout === 'corridor' && ex.dv >= 24) {
    const back = mkDoors(1.6, Math.max(2.1, Math.min(2.4, H - 0.35)))
      .filter((d) => d.id === 0 && !inStair(d.x.probe[0], d.x.probe[1]) && Math.hypot(d.x.lu - main.x.lu, d.x.lv - main.x.lv) > 15 && d.x.edge !== main.x.edge && d.score < main.score + 25)
      .sort((p, q) => p.score - q.score)[0];
    if (back) xdoors.push(back.x);
  }

  // ---------------------------------------------------------------- per-floor ids
  const ids: Int16Array[] = [];
  for (let f = 0; f < levels; f += 1) ids.push(floorIds(f, lobbyKey));
  // A hall's far end: an office and a store partitioned off, away from the main door.
  if (layout === 'hall' && prog.endRooms?.length && ex.dv >= 14) {
    const id = ids[0];
    let jMin = nv;
    let jMax = -1;
    for (let j = 0; j < nv; j += 1) for (let i = 0; i < nu; i += 1) if (inside[j * nu + i]) {
      jMin = Math.min(jMin, j);
      jMax = Math.max(jMax, j);
    }
    const depth = 7;
    const far = main.x.lv < ex.dv / 2;
    const ja = far ? jMax + 1 - depth : jMin;
    const jb = far ? jMax + 1 : jMin + depth;
    const pj = Math.floor(main.x.probe[1] / CELL);
    if (pj < ja - 2 || pj >= jb + 2) {
      let iMin = nu;
      let iMax = -1;
      for (let j = ja; j < jb; j += 1) for (let i = 0; i < nu; i += 1) if (isIn(i, j)) {
        iMin = Math.min(iMin, i);
        iMax = Math.max(iMax, i);
      }
      const two = prog.endRooms.length > 1 && (iMax - iMin + 1) * CELL >= 6;
      const split = Math.round((iMin + iMax + 1) / 2);
      for (let j = ja; j < jb; j += 1) for (let i = 0; i < nu; i += 1) if (isIn(i, j)) id[j * nu + i] = two && i >= split ? 2 : 1;
    }
  }
  // Slivers too small or narrow to be rooms (odd corners of the footprint) stay open.
  for (const id of ids) {
    const drop = new Set<number>();
    for (const [rid, bb] of boxesOf(id, nu, nv)) {
      if (rid <= 0) continue;
      const r = maxRect(bb, (i, j) => id[j * nu + i] === rid);
      if (!r || Math.min(r.i1 - r.i0, r.j1 - r.j0) * CELL < 1.8 || (r.i1 - r.i0) * (r.j1 - r.j0) < 14) drop.add(rid);
    }
    if (drop.size) for (let k = 0; k < id.length; k += 1) if (drop.has(id[k])) id[k] = 0;
  }

  // ---------------------------------------------------------------- doors between spaces
  const doors: IDoor[] = [];
  for (let f = 0; f < levels; f += 1) doors.push(...connect(ids[f], nu, nv, f));

  // ---------------------------------------------------------------- rooms
  const rooms: PRoom[] = [];
  const rectOf = (mask: (i: number, j: number) => boolean, bb: Box): Rect | null => {
    const r = maxRect(bb, (i, j) => mask(i, j) && !nearWall[j * nu + i]);
    const fb = r ?? maxRect(bb, mask);
    if (!fb) return null;
    const pad = r ? 0.09 : 0.35;
    return { u0: fb.i0 * CELL + pad, u1: fb.i1 * CELL - pad, v0: fb.j0 * CELL + pad, v1: fb.j1 * CELL - pad };
  };
  const doorCentre = (d: IDoor): { u: number; v: number } => (d.axis === 'v' ? { u: d.line * CELL, v: ((d.a + d.b) / 2) * CELL } : { u: ((d.a + d.b) / 2) * CELL, v: d.line * CELL });
  for (let f = 0; f < levels; f += 1) {
    const id = ids[f];
    const present = [...new Set(id)].filter((x) => x > 0).sort((p, q) => p - q);
    const specs = new Map<number, RoomSpec>();
    if (layout === 'corridor') {
      const free: number[] = [];
      for (const r of present) {
        const key = roomKeys[r - 1];
        const poi = f === 0 ? poiKey.get(key) : undefined;
        if (poi) specs.set(r, poi);
        else free.push(r);
      }
      const names = prog.rooms(f, free.length);
      free.forEach((r, k) => specs.set(r, names[k] ?? { name: `Room ${f}${String(k + 1).padStart(2, '0')}`, kind: 'office' }));
    } else {
      present.forEach((r, k) => specs.set(r, prog.endRooms?.[k] ?? { name: 'Store', kind: 'store' }));
    }
    // Each space's cell bounds, so the rectangle search stays local.
    const boxes = boxesOf(id, nu, nv);
    const add = (rid: number, spec: RoomSpec, mask: (i: number, j: number) => boolean, withXDoors: boolean) => {
      const bb = boxes.get(rid);
      const rect = bb ? rectOf(mask, bb) : null;
      if (!rect || rect.u1 - rect.u0 < 0.6 || rect.v1 - rect.v0 < 0.6) return;
      const ds: { u: number; v: number }[] = [];
      let sign: PRoom['sign'] = null;
      for (const d of doors) {
        if (d.floor !== f || (d.room !== rid && d.other !== rid)) continue;
        const cc = doorCentre(d);
        ds.push(cc);
        if (d.room === rid && d.other === 0 && rid > 0 && prog.signs) {
          // The sign faces the space on the other side of the door.
          const step = 0.3;
          let nu2 = 0;
          let nv2 = 0;
          if (d.axis === 'v') nu2 = cellId(id, nu, nv, cc.u + step, cc.v) === 0 ? 1 : -1;
          else nv2 = cellId(id, nu, nv, cc.u, cc.v + step) === 0 ? 1 : -1;
          sign = { u: cc.u, v: cc.v, nu: nu2, nv: nv2 };
        }
      }
      if (withXDoors && f === 0) for (const x of xdoors) if (mask(Math.floor(x.probe[0] / CELL), Math.floor(x.probe[1] / CELL))) ds.push({ u: x.lu, v: x.lv });
      rooms.push({ id: rid, floor: f, spec, rect, doors: ds, front: frontOf(rect, ds), sign });
    };
    for (const r of present) add(r, specs.get(r)!, (i, j) => cellId2(id, nu, nv, i, j) === r, true);
    if (layout !== 'corridor' && f === 0) {
      add(0, prog.hall ?? prog.rooms(0, 1)[0] ?? { name: 'Room', kind: 'office' }, (i, j) => cellId2(id, nu, nv, i, j) === 0, true);
    } else if (f === 0 && lobbyKey) {
      add(0, { name: 'Entrance Hall', kind: 'lobby' }, (i, j) => cellId2(id, nu, nv, i, j) === 0 && keyAt(i, j) === lobbyKey, true);
    }
  }

  const [cx, cz] = pts.reduce(([sx, sz], [x, z]) => [sx + x / pts.length, sz + z / pts.length], [0, 0]);
  const radius = Math.max(...pts.map(([x, z]) => Math.hypot(x - cx, z - cz)));
  return {
    b, prog, name: b.name ?? prog.display, pts, F, ry, nu, nv, inside, layout, levels, H, bay: o.bay, F0, top, y0, openRoof, roof: o.roof,
    ids, rooms, doors, xdoors, stair, corridor: layout === 'corridor' && c1 > c0 ? [c0 * CELL, c1 * CELL] : null,
    cx, cz, radius, seed: glowSeed(b),
  };
}

function cellId(id: Int16Array, nu: number, nv: number, u: number, v: number): number {
  return cellId2(id, nu, nv, Math.floor(u / CELL), Math.floor(v / CELL));
}
function cellId2(id: Int16Array, nu: number, nv: number, i: number, j: number): number {
  return i >= 0 && j >= 0 && i < nu && j < nv ? id[j * nu + i] : -1;
}

/** The wall of the rect farthest from its doors. */
function frontOf(r: Rect, doors: { u: number; v: number }[]): Side {
  if (!doors.length) return 'v0';
  const sides: [Side, number][] = [
    ['u0', Math.min(...doors.map((d) => Math.abs(d.u - r.u0)))],
    ['u1', Math.min(...doors.map((d) => Math.abs(d.u - r.u1)))],
    ['v0', Math.min(...doors.map((d) => Math.abs(d.v - r.v0)))],
    ['v1', Math.min(...doors.map((d) => Math.abs(d.v - r.v1)))],
  ];
  return sides.sort((p, q) => q[1] - p[1])[0][0];
}

interface Box { i0: number; i1: number; j0: number; j1: number }

/** Cell bounds of each space id. */
function boxesOf(id: Int16Array, nu: number, nv: number): Map<number, Box> {
  const boxes = new Map<number, Box>();
  for (let j = 0; j < nv; j += 1) for (let i = 0; i < nu; i += 1) {
    const x = id[j * nu + i];
    if (x < 0) continue;
    const bx = boxes.get(x);
    if (!bx) boxes.set(x, { i0: i, i1: i + 1, j0: j, j1: j + 1 });
    else {
      bx.i0 = Math.min(bx.i0, i);
      bx.i1 = Math.max(bx.i1, i + 1);
      bx.j0 = Math.min(bx.j0, j);
      bx.j1 = Math.max(bx.j1, j + 1);
    }
  }
  return boxes;
}

/** Largest axis-aligned rectangle of cells within `bb` where `ok` holds (cell index bounds, end exclusive). */
function maxRect(bb: Box, ok: (i: number, j: number) => boolean): Box | null {
  const nu = bb.i1 - bb.i0;
  const h = new Int32Array(nu);
  let best: Box | null = null;
  let bestA = 0;
  for (let j = bb.j0; j < bb.j1; j += 1) {
    for (let i = 0; i < nu; i += 1) h[i] = ok(bb.i0 + i, j) ? h[i] + 1 : 0;
    const stack: number[] = [];
    for (let i = 0; i <= nu; i += 1) {
      const hi = i < nu ? h[i] : 0;
      while (stack.length && h[stack[stack.length - 1]] >= hi) {
        const top = stack.pop()!;
        const height = h[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const a = height * (i - left);
        // Prefer squarer rectangles a little (a 1-cell strip is no room).
        const score = a * Math.min(1, Math.min(height, i - left) / 4);
        if (height && score > bestA) {
          bestA = score;
          best = { i0: bb.i0 + left, i1: bb.i0 + i, j0: j - height + 1, j1: j + 1 };
        }
      }
      stack.push(i);
    }
  }
  return best;
}

/**
 * Doorways so every room can be reached: each room opens to the open space (corridor, hall,
 * stair well) where it touches it along at least 1.5 m, else to a room already reachable.
 */
function connect(id: Int16Array, nu: number, nv: number, f: number): IDoor[] {
  type Run = { axis: 'u' | 'v'; line: number; a: number; b: number; p: number; q: number };
  const runs: Run[] = [];
  // Boundary units, grouped into straight runs between the same two spaces.
  const open = new Map<string, Run>();
  const flushAll = (keep: Set<string>) => {
    for (const [k, r] of open) if (!keep.has(k)) {
      runs.push(r);
      open.delete(k);
    }
  };
  // Walls along v (between columns i-1 and i), scanning j.
  for (let i = 1; i < nu; i += 1) {
    for (let j = 0; j <= nv; j += 1) {
      const keep = new Set<string>();
      if (j < nv) {
        const a = id[j * nu + i - 1];
        const b = id[j * nu + i];
        if (a >= 0 && b >= 0 && a !== b) {
          const p = Math.min(a, b);
          const q = Math.max(a, b);
          const k = `v:${i}:${p}:${q}`;
          const r = open.get(k);
          if (r && r.b === j) r.b = j + 1;
          else open.set(k, { axis: 'v', line: i, a: j, b: j + 1, p, q });
          keep.add(k);
        }
      }
      flushAll(keep);
    }
  }
  for (let j = 1; j < nv; j += 1) {
    for (let i = 0; i <= nu; i += 1) {
      const keep = new Set<string>();
      if (i < nu) {
        const a = id[(j - 1) * nu + i];
        const b = id[j * nu + i];
        if (a >= 0 && b >= 0 && a !== b) {
          const p = Math.min(a, b);
          const q = Math.max(a, b);
          const k = `u:${j}:${p}:${q}`;
          const r = open.get(k);
          if (r && r.b === i) r.b = i + 1;
          else open.set(k, { axis: 'u', line: j, a: i, b: i + 1, p, q });
          keep.add(k);
        }
      }
      flushAll(keep);
    }
  }
  const rooms = [...new Set(id)].filter((x) => x > 0);
  const connected = new Set<number>([0]);
  if (!id.includes(0) && rooms.length) connected.add(rooms[0]);
  const out: IDoor[] = [];
  for (const minLen of [3, 2]) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const r of rooms) {
        if (connected.has(r)) continue;
        const cand = runs
          .filter((x) => (x.p === r && connected.has(x.q)) || (x.q === r && connected.has(x.p)))
          .filter((x) => x.b - x.a >= minLen)
          .sort((x, y) => ((x.p === 0 ? 0 : 1) - (y.p === 0 ? 0 : 1)) || (y.b - y.a) - (x.b - x.a));
        const c = cand[0];
        if (!c) continue;
        const w = Math.min(3, c.b - c.a);
        const a = c.a + Math.floor((c.b - c.a - w) / 2);
        out.push({ floor: f, axis: c.axis, line: c.line, a, b: a + w, room: r, other: c.p === r ? c.q : c.p });
        connected.add(r);
        progress = true;
      }
    }
  }
  return out;
}

function segDist(x: number, z: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
  return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t);
}

// ==================================================================== shell (built at load)

const INSIDE = new THREE.Color('#efe9dc');
const PLINTH = new THREE.Color('#8c877c');

export function buildShell(
  p: InteriorPlan, ground: CampusGround, physics: PhysicsWorld,
  B: { facade: GeoBuilder; see: GeoBuilder; plain: GeoBuilder }, shell: Batch, wall: THREE.Color,
): EnterableBuild {
  const { pts, F0, top, H, levels, y0 } = p;
  const seed = p.seed;
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i];
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - a[0];
    const dz = q[1] - a[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.05) continue;
    const nx = dz / len;
    const nz = -dx / len;
    const n = new THREE.Vector3(nx, 0, nz);
    const inward = new THREE.Vector3(-nx, 0, -nz);
    const bays = Math.max(1, Math.round(len / p.bay));
    // Pieces along the edge: [t0, t1, bottom, top?]. A doorway leaves a gap up to its head; the
    // strip over it to the first floor is its own piece, so the floors above get real windows.
    const pieces: [number, number, number, number?][] = [];
    let at = 0;
    for (const d of p.xdoors.filter((x) => x.edge === i).sort((x, y) => x.t - y.t)) {
      const t0 = Math.max(at, d.t - d.w / 2 / len);
      const t1 = Math.min(1, d.t + d.w / 2 / len);
      pieces.push([at, t0, F0], [t0, t1, F0 + d.h, F0 + H]);
      if (levels > 1) pieces.push([t0, t1, F0 + H]);
      at = t1;
    }
    pieces.push([at, 1, F0]);
    const glazed = len >= 1.5;
    for (const [t0, t1, bottom, pieceTop] of pieces) {
      if (t1 - t0 < 1e-3) continue;
      const hi = pieceTop ?? top;
      if (hi - bottom < 0.01) continue;
      const W = glazed && Math.abs((bottom - F0) / H - Math.round((bottom - F0) / H)) < 1e-6 ? B.see : B.facade;
      const P0: Pt = [a[0] + dx * t0, a[1] + dz * t0];
      const P1: Pt = [a[0] + dx * t1, a[1] + dz * t1];
      const u0 = t0 * bays;
      const u1 = t1 * bays;
      const v0 = (bottom - F0) / H;
      const v1 = (hi - F0) / H;
      const A0 = new THREE.Vector3(P0[0], bottom, P0[1]);
      const A1 = new THREE.Vector3(P0[0], hi, P0[1]);
      const C1 = new THREE.Vector3(P1[0], hi, P1[1]);
      const C0 = new THREE.Vector3(P1[0], bottom, P1[1]);
      W.quad(W.vert(A0, n, u0, v0, 0.92, seed, wall), W.vert(A1, n, u0, v1, 1, seed, wall), W.vert(C1, n, u1, v1, 1, seed, wall), W.vert(C0, n, u1, v0, 0.92, seed, wall));
      const off = (v: THREE.Vector3) => v.clone().addScaledVector(n, -EXT);
      W.quad(W.vert(off(C0), inward, u1, v0, 0.9, 0, INSIDE), W.vert(off(C1), inward, u1, v1, 1, 0, INSIDE), W.vert(off(A1), inward, u0, v1, 1, 0, INSIDE), W.vert(off(A0), inward, u0, v0, 0.9, 0, INSIDE));
      if (W === B.see) {
        // Each window opening: glass a few cm in from the outside face, plastered reveals
        // through the wall, and a stone sill. A window cut by a doorway loses that reveal.
        const ry2 = Math.atan2(-dz, dx);
        const pos = (t: number, out: number): [number, number] => [a[0] + dx * t + nx * out, a[1] + dz * t + nz * out];
        for (let f = Math.round((bottom - F0) / H); f < levels; f += 1) {
          const ya = F0 + (f + WIN_V0) * H;
          const yb = F0 + (f + WIN_V1) * H;
          if (yb > hi + 0.01) continue;
          for (let k = 0; k < bays; k += 1) {
            const wa = (k + WIN_U0) / bays;
            const wb = (k + WIN_U1) / bays;
            const ta = Math.max(wa, t0);
            const tb = Math.min(wb, t1);
            if ((tb - ta) * len < 0.12) continue;
            const cutA = wa < t0;
            const cutB = wb > t1;
            const wl = (tb - ta) * len;
            let [x, z] = pos((ta + tb) / 2, -0.07);
            shell.box('glass', wl, yb - ya, 0.012, x, (ya + yb) / 2, z, ry2);
            const span = (e: number): [number, number] => {
              const s0 = ta - (cutA ? 0 : e / len);
              const s1 = tb + (cutB ? 0 : e / len);
              return [(s0 + s1) / 2, (s1 - s0) * len];
            };
            let [tm, w] = span(0.05);
            [x, z] = pos(tm, -EXT / 2);
            shell.box('reveal', w, 0.05, EXT - 0.02, x, yb + 0.025, z, ry2);
            [tm, w] = span(0.08);
            [x, z] = pos(tm, (0.1 - EXT) / 2);
            shell.box('sill', w, 0.06, EXT + 0.1, x, ya - 0.03, z, ry2);
            for (const [t, cut, dir] of [[ta, cutA, -1], [tb, cutB, 1]] as [number, boolean, number][]) {
              if (cut) continue;
              [x, z] = pos(t + (dir * 0.025) / len, -EXT / 2);
              shell.box('reveal', 0.05, yb - ya, EXT - 0.02, x, (ya + yb) / 2, z, ry2);
            }
          }
        }
      }
      const segLen = len * (t1 - t0);
      const mx = (P0[0] + P1[0]) / 2 - (nx * EXT) / 2;
      const mz = (P0[1] + P1[1]) / 2 - (nz * EXT) / 2;
      if (segLen > 0.05) physics.tag(physics.addBox({ x: mx, y: (bottom + hi) / 2, z: mz, hx: segLen / 2, hy: (hi - bottom) / 2, hz: EXT / 2, rotY: Math.atan2(-dz, dx) }), 'rock');
    }
    // Door reveals (wall thickness) round each opening.
    for (const d of p.xdoors.filter((x) => x.edge === i)) {
      const ry2 = Math.atan2(-dz, dx);
      for (const t of [d.t - d.w / 2 / len, d.t + d.w / 2 / len]) {
        shell.box('frame', 0.12, d.h, EXT + 0.04, a[0] + dx * t - (nx * EXT) / 2, F0 + d.h / 2, a[1] + dz * t - (nz * EXT) / 2, ry2);
      }
      shell.box('frame', d.w + 0.24, 0.12, EXT + 0.04, a[0] + dx * d.t - (nx * EXT) / 2, F0 + d.h - 0.06, a[1] + dz * d.t - (nz * EXT) / 2, ry2);
    }
    // Plinth below the floor.
    const P0 = new THREE.Vector3(a[0] + nx * 0.06, y0, a[1] + nz * 0.06);
    const P1 = new THREE.Vector3(a[0] + nx * 0.06, F0, a[1] + nz * 0.06);
    const Q1 = new THREE.Vector3(q[0] + nx * 0.06, F0, q[1] + nz * 0.06);
    const Q0 = new THREE.Vector3(q[0] + nx * 0.06, y0, q[1] + nz * 0.06);
    B.plain.quad(B.plain.vert(P0, n, 0, y0 / 3, 0.85, 0, PLINTH), B.plain.vert(P1, n, 0, F0 / 3, 1, 0, PLINTH), B.plain.vert(Q1, n, len / 3, F0 / 3, 1, 0, PLINTH), B.plain.vert(Q0, n, len / 3, y0 / 3, 0.85, 0, PLINTH));
    physics.addBox({ x: (a[0] + q[0]) / 2 - (nx * EXT) / 2, y: (y0 + F0) / 2, z: (a[1] + q[1]) / 2 - (nz * EXT) / 2, hx: len / 2, hy: (F0 - y0) / 2, hz: EXT / 2, rotY: Math.atan2(-dz, dx) });
  }

  // ---------------------------------------------------------------- floors and ceilings
  const S = p.stair;
  const hole: Pt[] | null = S ? [[S.sU0, S.vS], [S.sU1, S.vS], [S.sU1, S.holeV1], [S.sU0, S.holeV1]].map(([u, v]) => p.F.w(u, v)) : null;
  const contour = pts.map((q) => new THREE.Vector2(q[0], q[1]));
  const slab = (y: number, up: boolean, withHole: boolean, mat: Mat) => {
    const outline = contour.map((v) => v.clone());
    const holes = withHole && hole ? [hole.map(([x, z]) => new THREE.Vector2(x, z))] : [];
    const tris = THREE.ShapeUtils.triangulateShape(outline, holes);
    const all = [...outline, ...holes.flat()];
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    for (const t of tris) {
      const [p0, p1, p2] = [all[t[0]], all[t[1]], all[t[2]]];
      const ny = (p2.x - p0.x) * (p1.y - p0.y) - (p1.x - p0.x) * (p2.y - p0.y);
      const order = (ny > 0) === up ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
      for (const k of order) {
        pos.push(all[k].x, y, all[k].y);
        nor.push(0, up ? 1 : -1, 0);
        uv.push(all[k].x / 2, all[k].y / 2);
      }
    }
    shell.raw(mat, pos, nor, uv);
  };
  const { F, ry, nu, nv, inside } = p;
  const floorBoxes = (yTop: number, thick: number, withHole: boolean) => {
    const inHole = (i: number, j: number) => withHole && !!S && (i + 0.5) * CELL > S.sU0 && (i + 0.5) * CELL < S.sU1 && (j + 0.5) * CELL > S.vS && (j + 0.5) * CELL < S.holeV1;
    const isIn = (i: number, j: number) => inside[j * nu + i] === 1;
    let prev: { i0: number; i1: number; j0: number }[] = [];
    const flush = (r: { i0: number; i1: number; j0: number }, j1: number) => {
      const [x, z] = F.w(((r.i0 + r.i1) * CELL) / 2, ((r.j0 + j1) * CELL) / 2);
      physics.tag(physics.addBox({ x, y: yTop - thick / 2, z, hx: ((r.i1 - r.i0) * CELL) / 2, hy: thick / 2, hz: ((j1 - r.j0) * CELL) / 2, rotY: ry }), 'rock');
    };
    for (let j = 0; j <= nv; j += 1) {
      const runs: { i0: number; i1: number }[] = [];
      if (j < nv) {
        let i = 0;
        while (i < nu) {
          if (!isIn(i, j) || inHole(i, j)) {
            i += 1;
            continue;
          }
          const i0 = i;
          while (i < nu && isIn(i, j) && !inHole(i, j)) i += 1;
          runs.push({ i0, i1: i });
        }
      }
      const next: { i0: number; i1: number; j0: number }[] = [];
      for (const r of runs) {
        const q = prev.find((x) => x.i0 === r.i0 && x.i1 === r.i1);
        next.push(q ? q : { ...r, j0: j });
      }
      for (const q of prev) if (!next.includes(q)) flush(q, j);
      prev = next;
    }
  };
  slab(F0, true, false, 'floor');
  floorBoxes(F0, 0.6, false);
  for (let f = 1; f < levels; f += 1) {
    const y = F0 + f * H;
    slab(y, true, true, 'floor');
    slab(y - SLAB, false, true, 'ceiling');
    floorBoxes(y, SLAB, true);
  }
  if (!p.openRoof) slab(top - 0.05, false, false, 'ceiling');

  // ---------------------------------------------------------------- where people wait
  const spot = (d: XDoor, out: number): DoorSpot => {
    const p0 = pts[d.edge];
    const p1 = pts[(d.edge + 1) % pts.length];
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const nx = (p1[1] - p0[1]) / len;
    const nz = -(p1[0] - p0[0]) / len;
    const [dwx, dwz] = F.w(d.lu, d.lv);
    return { x: dwx + nx * out, z: dwz + nz * out, y: ground.heightAt(dwx + nx * out, dwz + nz * out), facing: Math.atan2(nx, nz), doorX: dwx, doorZ: dwz };
  };
  return { floor: F0, top, entrance: spot(p.xdoors[0], 2.6), extra: p.xdoors.slice(1).map((d) => spot(d, 2.4)) };
}

// ==================================================================== contents (streamed)

interface Built { group: THREE.Group; colliders: Collider[]; disposables: { dispose(): void }[] }

/** Builds a building's contents in one go (after a teleport, when they're needed now). */
function buildContents(p: InteriorPlan, physics: PhysicsWorld, parent: THREE.Group): Built {
  const it = buildContentsSteps(p, physics, parent);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/**
 * The contents, a piece at a time: the streamer runs it for a couple of milliseconds a frame.
 * Built in one frame, a big building (the RIC, a hostel block) took 40-65 ms: a hitch every time
 * you walked or drove within 60 m of one. The group joins the scene only when it is complete.
 */
function* buildContentsSteps(p: InteriorPlan, physics: PhysicsWorld, parent: THREE.Group): Generator<void, Built, void> {
  const { F, ry, H, F0, top, levels, nu, nv } = p;
  const batch = new Batch();
  const colliders: Collider[] = [];
  const disposables: { dispose(): void }[] = [];
  const group = new THREE.Group();
  group.name = `interior-${p.name}`;
  const L = (u: number, v: number, y: number, w: number, h: number, d: number, mat: Mat, solid = true, rot = 0) => {
    const [x, z] = F.w(u, v);
    batch.box(mat, w, h, d, x, y, z, ry + rot);
    if (solid) colliders.push(physics.addBox({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, rotY: ry + rot }));
  };
  const ceilOf = (f: number) => (f < levels - 1 ? F0 + (f + 1) * H - SLAB : p.openRoof ? top : top - 0.05);

  // ---------------------------------------------------------------- partitions and door frames
  for (let f = 0; f < levels; f += 1) {
    const base = F0 + f * H;
    const ceil = ceilOf(f);
    const id = p.ids[f];
    const at = (i: number, j: number) => cellId2(id, nu, nv, i, j);
    const doorUnits = new Set<string>();
    for (const d of p.doors) {
      if (d.floor !== f) continue;
      for (let k = d.a; k < d.b; k += 1) doorUnits.add(`${d.axis}:${d.line}:${k}`);
    }
    const runsV = new Map<number, [number, number, boolean][]>();
    const runsU = new Map<number, [number, number, boolean][]>();
    for (let j = 0; j < nv; j += 1) {
      for (let i = 0; i < nu; i += 1) {
        const a = at(i, j);
        if (a < 0) continue;
        const r = at(i + 1, j);
        if (r >= 0 && r !== a) {
          const list = runsV.get(i + 1) ?? [];
          list.push([j, j + 1, doorUnits.has(`v:${i + 1}:${j}`)]);
          runsV.set(i + 1, list);
        }
        const u = at(i, j + 1);
        if (u >= 0 && u !== a) {
          const list = runsU.get(j + 1) ?? [];
          list.push([i, i + 1, doorUnits.has(`u:${j + 1}:${i}`)]);
          runsU.set(j + 1, list);
        }
      }
    }
    const piece = (alongU: boolean, line: number, s0: number, s1: number, yb: number, yt: number) => {
      const len = (s1 - s0) * CELL;
      const mid = ((s0 + s1) / 2) * CELL;
      const [u, v] = alongU ? [mid, line * CELL] : [line * CELL, mid];
      L(u, v, (yb + yt) / 2, alongU ? len + INT : INT, yt - yb, alongU ? INT : len + INT, 'wall');
    };
    for (const [runs, alongU] of [[runsV, false], [runsU, true]] as [Map<number, [number, number, boolean][]>, boolean][]) {
      for (const [line, units] of runs) {
        units.sort((x, y) => x[0] - y[0]);
        let k = 0;
        while (k < units.length) {
          const door = units[k][2];
          const s0 = units[k][0];
          let s1 = units[k][1];
          while (k + 1 < units.length && units[k + 1][0] === s1 && units[k + 1][2] === door) {
            k += 1;
            s1 = units[k][1];
          }
          piece(alongU, line, s0, s1, door ? base + DOOR_H : base, ceil);
          k += 1;
        }
      }
    }
    for (const d of p.doors) {
      if (d.floor !== f) continue;
      const w = (d.b - d.a) * CELL;
      const mid = ((d.a + d.b) / 2) * CELL;
      const l = d.line * CELL;
      const at2 = (along: number): [number, number] => (d.axis === 'v' ? [l, along] : [along, l]);
      const [pu0, pv0] = at2(mid - w / 2);
      const [pu1, pv1] = at2(mid + w / 2);
      const [hu, hv] = at2(mid);
      const fw = d.axis === 'v' ? INT + 0.06 : 0.08;
      const fd = d.axis === 'v' ? 0.08 : INT + 0.06;
      L(pu0, pv0, base + DOOR_H / 2, fw, DOOR_H, fd, 'frame', false);
      L(pu1, pv1, base + DOOR_H / 2, fw, DOOR_H, fd, 'frame', false);
      L(hu, hv, base + DOOR_H + 0.04, d.axis === 'v' ? INT + 0.06 : w + 0.08, 0.08, d.axis === 'v' ? w + 0.08 : INT + 0.06, 'frame', false);
    }
    yield;
  }

  // ---------------------------------------------------------------- stairs
  const S = p.stair;
  if (S) {
    const sMid = (S.sU0 + S.sU1) / 2;
    const corridorSideLow = S.side > 0; // the corridor is at the stair's low-u side
    const arrive: [number, number] = corridorSideLow ? [S.sU0, sMid] : [sMid, S.sU1];
    const climb: [number, number] = corridorSideLow ? [sMid, S.sU1] : [S.sU0, sMid];
    const rise = H / 2 / S.steps;
    const ramp = (u: number, width: number, v0: number, yb: number, dir: number) => {
      const beta = Math.atan2(H / 2, S.flightRun);
      const hyp = Math.hypot(H / 2, S.flightRun);
      const hy = 0.1;
      const vm = v0 + (dir * S.flightRun) / 2;
      const ym = yb + H / 4;
      const cv = vm + dir * Math.sin(beta) * hy;
      const cy = ym - Math.cos(beta) * hy;
      const [x, z] = F.w(u, cv);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-dir * beta, ry, 0, 'YXZ'));
      colliders.push(physics.addBox({ x, y: cy, z, hx: width / 2, hy, hz: hyp / 2, quat: { x: q.x, y: q.y, z: q.z, w: q.w } }));
    };
    for (let f = 0; f < levels - 1; f += 1) {
      const base = F0 + f * H;
      const landY = base + H / 2;
      for (let k = 0; k < S.steps; k += 1) {
        const t = base + (k + 1) * rise;
        const bot = Math.max(base, t - 0.35);
        L((climb[0] + climb[1]) / 2, S.vS + (k + 0.5) * TREAD, (bot + t) / 2, climb[1] - climb[0] - 0.1, t - bot, TREAD + 0.01, 'stair', false);
      }
      ramp((climb[0] + climb[1]) / 2, climb[1] - climb[0] - 0.1, S.vS, base, 1);
      L(sMid, S.vS + S.flightRun + 0.7, landY - 0.12, S.sU1 - S.sU0 - 0.1, 0.24, 1.4, 'stair');
      for (let k = 0; k < S.steps; k += 1) {
        const t = landY + (k + 1) * rise;
        const bot = Math.max(landY - 0.2, t - 0.35);
        L((arrive[0] + arrive[1]) / 2, S.vS + S.flightRun - (k + 0.5) * TREAD, (bot + t) / 2, arrive[1] - arrive[0] - 0.1, t - bot, TREAD + 0.01, 'stair', false);
      }
      ramp((arrive[0] + arrive[1]) / 2, arrive[1] - arrive[0] - 0.1, S.vS + S.flightRun, landY, -1);
      L(sMid, S.vS + S.flightRun / 2, base + H / 2, 0.12, H - 0.2, S.flightRun + 0.1, 'wall');
    }
    for (let f = 1; f < levels; f += 1) {
      const y = F0 + f * H;
      const edgeU = corridorSideLow ? S.sU0 : S.sU1;
      L(edgeU, (S.vS + S.holeV1) / 2, y + 0.5, 0.06, 1.0, S.holeV1 - S.vS, 'rail');
      L(sMid, S.holeV1, y + 0.5, S.sU1 - S.sU0, 1.0, 0.06, 'rail');
      if (f === levels - 1) L((climb[0] + climb[1]) / 2, S.vS, y + 0.5, climb[1] - climb[0], 1.0, 0.06, 'rail');
    }
    yield;
  }

  // ---------------------------------------------------------------- rooms
  let n = 0;
  for (const r of p.rooms) {
    const base = F0 + r.floor * H;
    const ceil = ceilOf(r.floor);
    const reserved: Rect[] = [];
    const rand = seeded(p.seed * 7919 + r.floor * 131 + r.id * 17 + (n += 1));
    const rect = r.rect;
    const doorBlocked = (u0: number, v0: number, u1: number, v1: number) => r.doors.some((d) => {
      const cx = Math.max(u0, Math.min(u1, d.u));
      const cz = Math.max(v0, Math.min(v1, d.v));
      return Math.hypot(cx - d.u, cz - d.v) < DOOR_CLEAR;
    });
    const fits = (u: number, v: number, w: number, d: number) => {
      const u0 = u - w / 2, u1 = u + w / 2, v0 = v - d / 2, v1 = v + d / 2;
      if (u0 < rect.u0 - 1e-3 || u1 > rect.u1 + 1e-3 || v0 < rect.v0 - 1e-3 || v1 > rect.v1 + 1e-3) return false;
      if (doorBlocked(u0, v0, u1, v1)) return false;
      return !reserved.some((q) => u0 < q.u1 - 0.02 && u1 > q.u0 + 0.02 && v0 < q.v1 - 0.02 && v1 > q.v0 + 0.02);
    };
    const room: Room = {
      name: r.spec.name, kind: r.spec.kind, sub: r.spec.sub, building: p.prog.display,
      ...rect, height: ceil - base, openRoof: p.openRoof && r.floor === levels - 1, floor: r.floor,
      doors: r.doors.map((d) => ({ u: d.u, v: d.v, side: sideOf(rect, d) })), front: r.front,
      free: (u, v, rr = 0.3) => fits(u, v, rr * 2, rr * 2),
      fits, rand,
    };
    const kit: Kit = {
      box(mat, u, v, y, w, h, d, o) {
        const rot = o?.rot ?? 0;
        L(u, v, base + y + h / 2, w, h, d, mat, !!o?.solid, rot);
        if (o?.solid) {
          const cs = Math.abs(Math.cos(rot));
          const sn = Math.abs(Math.sin(rot));
          const hu = (cs * w + sn * d) / 2;
          const hv = (sn * w + cs * d) / 2;
          reserved.push({ u0: u - hu, u1: u + hu, v0: v - hv, v1: v + hv });
        }
      },
      cyl(mat, u, v, y, rr, h, o) {
        const axis = o?.axis ?? 'y';
        const [x, z] = F.w(u, v);
        const cy = axis === 'y' ? base + y + h / 2 : base + y;
        batch.cyl(mat, rr, o?.r2 ?? rr, h, x, cy, z, ry, axis === 'y' ? 'y' : axis === 'u' ? 'x' : 'z', o?.seg ?? 10);
        if (o?.solid) {
          const r2 = Math.max(rr, o?.r2 ?? rr);
          const [w, hh, d] = axis === 'y' ? [r2 * 2, h, r2 * 2] : axis === 'u' ? [h, r2 * 2, r2 * 2] : [r2 * 2, r2 * 2, h];
          colliders.push(physics.addBox({ x, y: cy, z, hx: w / 2, hy: hh / 2, hz: d / 2, rotY: ry }));
          reserved.push({ u0: u - w / 2, u1: u + w / 2, v0: v - d / 2, v1: v + d / 2 });
        }
      },
    };
    furnishRoom(room, kit);
    // Lights, unless the furnisher hangs its own.
    if (!selfLit(r.spec.kind)) {
      const W = rect.u1 - rect.u0;
      const D = rect.v1 - rect.v0;
      const nu2 = Math.max(1, Math.round(W / 3.2));
      const nv2 = Math.max(1, Math.round(D / 3.2));
      const hang = room.openRoof;
      const y = hang ? base + Math.min(room.height - 0.2, 3.6) : ceil - 0.03;
      for (let a = 0; a < nu2; a += 1) {
        for (let c = 0; c < nv2; c += 1) {
          const u = rect.u0 + ((a + 0.5) * W) / nu2;
          const v = rect.v0 + ((c + 0.5) * D) / nv2;
          L(u, v, y, W > D ? 1.2 : 0.3, 0.04, W > D ? 0.3 : 1.2, 'light', false);
          if (hang) L(u, v, (y + base + room.height + 1) / 2, 0.02, base + room.height + 1 - y, 0.02, 'metal', false);
        }
      }
    }
    yield;
  }
  // Corridor lights.
  if (p.corridor) {
    const cu = (p.corridor[0] + p.corridor[1]) / 2;
    for (let f = 0; f < levels; f += 1) {
      for (let v = 2; v < nv * CELL - 1.5; v += 4) {
        if (cellId(p.ids[f], nu, nv, cu, v) !== 0) continue;
        L(cu, v, ceilOf(f) - 0.03, 0.6, 0.04, 1.2, 'light', false);
      }
    }
  }
  if (S) for (let f = 0; f < levels; f += 1) L((S.sU0 + S.sU1) / 2, S.sV1 - 0.6, ceilOf(f) - 0.03, 0.6, 0.04, 0.6, 'light', false);

  // ---------------------------------------------------------------- roof trusses (open halls)
  if (p.openRoof && p.roof.pitched && p.roof.rect) {
    const r = p.roof.rect;
    const ca = Math.cos(r.angle);
    const sa = Math.sin(r.angle);
    const W = r.hw + 0.55;
    const rise = p.roof.rise ?? Math.min(3.2, W * 0.42);
    const v0 = p.roof.ridgeV ?? 0;
    const P = (u: number, v: number, h: number) => new THREE.Vector3(r.cx + u * ca - v * sa, top + h, r.cz + u * sa + v * ca);
    const roofAt = (v: number) => (v < v0 ? (rise * (v + W)) / (W + v0) : (rise * (W - v)) / (W - v0));
    const ends = p.roof.gable ? 0.6 : W + 0.3;
    const span = r.hl - ends;
    if (span > 0.5) {
      const count = Math.max(1, Math.round((2 * span) / 4.2));
      for (let k = 0; k <= count; k += 1) {
        const u = -span + (2 * span * k) / count;
        const e = r.hw - 0.3;
        const drop = 0.16;
        batch.beam('machineDark', P(u, -e, -0.12), P(u, e, -0.12), 0.1, 0.14);
        batch.beam('machineDark', P(u, -e, roofAt(-e) - drop), P(u, v0, roofAt(v0) - drop), 0.1, 0.14);
        batch.beam('machineDark', P(u, e, roofAt(e) - drop), P(u, v0, roofAt(v0) - drop), 0.1, 0.14);
        batch.beam('machineDark', P(u, v0, -0.12), P(u, v0, roofAt(v0) - drop), 0.08, 0.08);
        for (const sd of [-1, 1]) {
          const vm = (v0 + sd * e) / 2;
          batch.beam('machineDark', P(u, vm, -0.12), P(u, v0 + (sd * e - v0) * 0.25, roofAt(v0 + (sd * e - v0) * 0.25) - drop), 0.06, 0.06);
        }
      }
      // Purlins along the length.
      for (const f of [0.33, 0.66]) for (const sd of [-1, 1]) {
        const v = v0 + (sd * (r.hw - 0.3) - v0) * f;
        batch.beam('machineDark', P(-span, v, roofAt(v) - 0.12), P(span, v, roofAt(v) - 0.12), 0.06, 0.1);
      }
    }
  }

  yield;

  // ---------------------------------------------------------------- signs
  const signs: { lines: string[]; floor: boolean; at: THREE.Vector3; n: THREE.Vector3; w: number; h: number }[] = [];
  for (const r of p.rooms) {
    if (!r.sign) continue;
    const base = F0 + r.floor * H;
    const off = INT / 2 + 0.012;
    const [x, z] = F.w(r.sign.u + r.sign.nu * off, r.sign.v + r.sign.nv * off);
    const [dx, dz] = F.dir(r.sign.nu, r.sign.nv);
    signs.push({ lines: [r.spec.name], floor: false, at: new THREE.Vector3(x, base + DOOR_H + 0.3, z), n: new THREE.Vector3(dx, 0, dz), w: 1.7, h: 0.3 });
  }
  if (S && p.corridor) {
    const cu = (p.corridor[0] + p.corridor[1]) / 2;
    for (let f = 0; f < levels; f += 1) {
      const [x, z] = F.w(cu, (S.sV0 + S.sV1) / 2);
      for (const sd of [1, -1]) {
        const [dx, dz] = F.dir(0, sd);
        signs.push({ lines: [FLOOR_NAMES[f] ?? `Floor ${f}`, p.prog.display.toUpperCase()], floor: true, at: new THREE.Vector3(x + dx * 0.01, ceilOf(f) - 0.45, z + dz * 0.01), n: new THREE.Vector3(dx, 0, dz), w: 1.5, h: 0.4 });
      }
    }
  }
  let signMat: THREE.MeshStandardMaterial | null = null;
  if (signs.length) {
    // Packed in columns at most 2048 px tall: one column of a hostel's 65 signs at 512 x 96 each was
    // 512 x 6240, past the 4096 px texture limit of many phones (every sign blank there) and a 20 ms,
    // 13 MB upload as the building came into view. 384 x 72 is still about 250 texels a metre.
    const RW = 384;
    const RH = 72;
    const perCol = Math.floor(2048 / RH);
    const cols = Math.ceil(signs.length / perCol);
    const cv = document.createElement('canvas');
    cv.width = RW * cols;
    cv.height = RH * Math.min(signs.length, perCol);
    const cell = (k: number) => ({ x0: Math.floor(k / perCol) * RW, y0: (k % perCol) * RH });
    const x = cv.getContext('2d', { willReadFrequently: true })!;
    signs.forEach((sg, k) => {
      const { x0, y0 } = cell(k);
      x.fillStyle = sg.floor ? '#23324f' : '#7a1f1f';
      x.fillRect(x0, y0, RW, RH);
      x.strokeStyle = '#f2d27a';
      x.lineWidth = 4;
      x.strokeRect(x0 + 6, y0 + 6, RW - 12, RH - 12);
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      const lines = sg.floor ? sg.lines : [sg.lines[0].toUpperCase()];
      lines.forEach((t, li) => {
        let size = sg.floor ? (li === 0 ? 27 : 14) : 30;
        x.font = `700 ${size}px "Segoe UI", Arial, sans-serif`;
        while (x.measureText(t).width > RW - 33 && size > 9) {
          size -= 1;
          x.font = `700 ${size}px "Segoe UI", Arial, sans-serif`;
        }
        x.fillStyle = li === 0 ? '#ffffff' : '#f2d27a';
        x.fillText(t, x0 + RW / 2, y0 + (lines.length === 1 ? RH / 2 : li === 0 ? RH * 0.4 : RH * 0.74));
      });
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
    disposables.push(tex, signMat);
    signs.forEach((sg, k) => {
      const R = new THREE.Vector3(sg.n.z, 0, -sg.n.x);
      const up = new THREE.Vector3(0, 1, 0);
      const c = sg.at;
      const pts4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => c.clone().addScaledVector(R, (a * sg.w) / 2).addScaledVector(up, (b * sg.h) / 2));
      // The canvas is flipped on upload (flipY): its top row is v = 1.
      const { x0, y0 } = cell(k);
      const u0 = x0 / cv.width;
      const u1 = (x0 + RW) / cv.width;
      const vTop = 1 - y0 / cv.height;
      const vBot = 1 - (y0 + RH) / cv.height;
      batch.raw('sign', pts4.flatMap((q) => [q.x, q.y, q.z]), [0, 1, 2, 3].flatMap(() => [sg.n.x, 0, sg.n.z]), [u0, vBot, u1, vBot, u1, vTop, u0, vTop], [0, 1, 2, 0, 2, 3]);
    });
  }

  yield;
  const mats: Record<string, THREE.Material> = { ...palette() };
  if (signMat) mats.sign = signMat;
  const meshes: THREE.Mesh[] = [];
  yield* batch.buildSteps(group, mats, 'interior', meshes);
  for (const m of meshes) disposables.push(m.geometry);
  parent.add(group);
  return { group, colliders, disposables };
}

const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor', 'Third Floor', 'Fourth Floor', 'Fifth Floor'];

function sideOf(r: Rect, d: { u: number; v: number }): Side | null {
  const ds: [Side, number][] = [['u0', Math.abs(d.u - r.u0)], ['u1', Math.abs(d.u - r.u1)], ['v0', Math.abs(d.v - r.v0)], ['v1', Math.abs(d.v - r.v1)]];
  ds.sort((a, b) => a[1] - b[1]);
  return ds[0][1] < 0.8 ? ds[0][0] : null;
}

// ==================================================================== streaming

export class InteriorStreamer {
  readonly group = new THREE.Group();
  private plans: InteriorPlan[] = [];
  private live = new Map<InteriorPlan, Built>();

  private physics: PhysicsWorld;

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
    this.group.name = 'interiors';
    this.group.userData.walkIn = [];
    // One hidden triangle per material, so the shader warm-up compiles them all at load.
    const warm = new THREE.Group();
    warm.name = 'interior-warmup';
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, -500, 0, 0.01, -500, 0, 0, -500, 0.01], 3));
    tri.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    tri.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
    for (const m of allInteriorMaterials()) {
      const mesh = new THREE.Mesh(tri, m);
      mesh.visible = false;
      mesh.frustumCulled = false;
      warm.add(mesh);
    }
    this.group.add(warm);
  }

  add(p: InteriorPlan): void {
    this.plans.push(p);
    // Where things are (tests and tools).
    (this.group.userData.walkIn as unknown[]).push({
      name: p.name, use: p.prog.use, floors: [...Array(p.levels).keys()].map((f) => p.F0 + f * p.H),
      rooms: p.rooms.map((r) => {
        const [x, z] = p.F.w((r.rect.u0 + r.rect.u1) / 2, (r.rect.v0 + r.rect.v1) / 2);
        return { name: r.spec.name, kind: r.spec.kind, floor: r.floor, x, z, y: p.F0 + r.floor * p.H };
      }),
      // Foot of the first flight (the half of the well away from the corridor) and its climb direction.
      stairFoot: p.stair ? p.F.w(p.stair.side > 0 ? (p.stair.sU0 + 3 * p.stair.sU1) / 4 : (3 * p.stair.sU0 + p.stair.sU1) / 4, p.stair.vS - 0.6) : null,
      stairUp: p.stair ? p.F.dir(0, 1) : null,
    });
  }

  get count(): number {
    return this.plans.length;
  }

  /** The building whose contents are being built, a slice per frame. */
  private job: { p: InteriorPlan; it: Generator<void, Built, void> } | null = null;

  /** Builds the nearest unbuilt building within NEAR (a few ms of it per call) and drops those beyond FAR. */
  update(at: THREE.Vector3): void {
    let best: InteriorPlan | null = null;
    let bd = Infinity;
    for (const p of this.plans) {
      const d = Math.hypot(at.x - p.cx, at.z - p.cz) - p.radius;
      const built = this.live.get(p);
      if (built && d > FAR) this.drop(p, built);
      else if (built) built.group.visible = d < VIEW;
      else if (!built && p !== this.job?.p && d < NEAR && d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!this.job && best) this.job = { p: best, it: buildContentsSteps(best, this.physics, this.group) };
    if (this.job) {
      const t0 = performance.now();
      do {
        if (this.step()) break;
      } while (performance.now() - t0 < BUDGET_MS);
    }
  }

  /** Runs one slice of the current build; true when it finished. */
  private step(): boolean {
    const job = this.job;
    if (!job) return true;
    const r = job.it.next();
    if (!r.done) return false;
    // Hidden until update() finds it within VIEW: added visible, it was drawn (and its buffers and sign
    // texture uploaded) on the frame it finished even 50 m away, a 50-70 ms frame, then hidden again.
    r.value.group.visible = false;
    this.live.set(job.p, r.value);
    this.job = null;
    return true;
  }

  /** Builds everything within `r` metres now (e.g. after a teleport). */
  ensure(at: THREE.Vector3, r = NEAR): void {
    while (this.job && !this.step()) {
      // Finish the building in progress first.
    }
    for (const p of this.plans) {
      if (this.live.has(p)) continue;
      if (Math.hypot(at.x - p.cx, at.z - p.cz) - p.radius < r) this.live.set(p, buildContents(p, this.physics, this.group));
    }
  }

  private drop(p: InteriorPlan, b: Built): void {
    for (const c of b.colliders) this.physics.removeCollider(c);
    for (const d of b.disposables) d.dispose();
    this.group.remove(b.group);
    this.live.delete(p);
  }
}
