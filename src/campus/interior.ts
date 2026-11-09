// Walk-in buildings (buildingOverrides.ts: enterable). Built from the mapped
// footprint, so the outside matches the real building and the inside fits it:
//
//  - The footprint is turned into the building's own frame (its walls run along
//    u and v) and rasterised on a 0.5 m grid.
//  - A central corridor runs down the long axis of the main body. Rooms line both
//    sides, split at the footprint's own corners (where the real walls step), so
//    rooms follow the building's wings.
//  - Ground floor: the widest side bump is the entrance lobby, open to the
//    corridor, with the doorway in its outer wall. Upper floors use it as a hall.
//  - A switchback stair in a room-sized well beside the corridor links all floors.
//  - Each room gets a doorway off the corridor, a sign, ceiling lights and
//    furniture for its use (classroom, lab, department office, hall, store).
//  - Everything walkable or solid has a collider: floors, slabs, stairs (15-18 cm
//    risers the character steps up), walls, rails and big furniture.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GeoBuilder } from '../render/geoBuilder.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { signTexture } from '../world/build.ts';
import { pointInPoly, polyArea, type BuildingData, type Pt } from './geo.ts';
import type { CampusGround } from './ground.ts';

const CELL = 0.5;
const STOREY = 3.6;
const SLAB = 0.22;
const EXT = 0.25;
const INT = 0.14;
const CORRIDOR = 2.5;
const DOOR_H = 2.2;
const RISE = 0.18;
const TREAD = 0.28;

/** Room names per floor, given out west side first then east, along the building. */
const FLOOR_ROOMS: string[][] = [
  ['RIC Office', 'Department of Computer Engineering', 'Department of Electronics Engineering', 'Faculty Room', 'Store',
    'Classroom G-01', 'Classroom G-02', 'Computer Lab 1', 'Classroom G-03', 'Classroom G-04', 'Electronics Lab', 'Classroom G-05', 'Classroom G-06'],
  ['Research Lab 1', 'Research Lab 2', 'Seminar Hall', 'Department of Electrical Engineering', 'Faculty Room',
    'Classroom 101', 'Classroom 102', 'Computer Lab 2', 'Classroom 103', 'Classroom 104', 'Robotics Lab', 'Classroom 105', 'Classroom 106'],
  ['Innovation Lab', 'Incubation Centre', 'Conference Hall', 'Department of Architecture', 'Library Corner',
    'Classroom 201', 'Classroom 202', 'Computer Lab 3', 'Classroom 203', 'Classroom 204', 'Drawing Studio', 'Classroom 205', 'Classroom 206'],
];
const FLOOR_NAMES = ['Ground Floor', 'First Floor', 'Second Floor'];

type RoomKind = 'classroom' | 'lab' | 'office' | 'hall' | 'store';
const kindOf = (name: string): RoomKind =>
  /classroom|studio/i.test(name) ? 'classroom'
    : /lab|incubation/i.test(name) ? 'lab'
      : /hall|seminar|conference/i.test(name) ? 'hall'
        : /store/i.test(name) ? 'store' : 'office';

export interface EnterableBuild {
  floor: number;
  top: number;
  /** Outside the main doorway (where people wait), facing out; door centre on the wall. */
  entrance: { x: number; z: number; y: number; facing: number; doorX: number; doorZ: number };
}

interface Frame {
  c: number;
  s: number;
  mu: number;
  mv: number;
  w: (u: number, v: number) => [number, number];
  l: (x: number, z: number) => [number, number];
}

/** Box geometries grouped by material, merged at the end. */
class Parts {
  private lists = new Map<string, THREE.BufferGeometry[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  add(mat: string, w: number, h: number, d: number, x: number, y: number, z: number, ry: number): void {
    const g = new THREE.BoxGeometry(w, h, d);
    this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(this.m);
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(g);
  }
  geom(mat: string, g: THREE.BufferGeometry): void {
    let l = this.lists.get(mat);
    if (!l) this.lists.set(mat, (l = []));
    l.push(g);
  }
  build(group: THREE.Group, mats: Record<string, THREE.Material>): void {
    for (const [k, list] of this.lists) {
      const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false);
      if (!g) continue;
      const m = new THREE.Mesh(g, mats[k]);
      m.castShadow = k !== 'light' && k !== 'glass';
      m.receiveShadow = true;
      m.name = `interior-${k}`;
      group.add(m);
    }
  }
}

export function buildEnterable(
  b: BuildingData, ground: CampusGround, physics: PhysicsWorld, group: THREE.Group,
  B: { facade: GeoBuilder; plain: GeoBuilder; flat: GeoBuilder }, wall: THREE.Color,
): EnterableBuild | null {
  let pts = b.pts.slice();
  if (polyArea(pts) < 0) pts = pts.reverse();
  if (pts.length < 4) return null;
  const levels = Math.max(1, Math.min(FLOOR_ROOMS.length, b.levels ?? 3));

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
    c, s, mu: ex.mu, mv: ex.mv,
    w: (u, v) => [(u + ex.mu) * c - (v + ex.mv) * s, (u + ex.mu) * s + (v + ex.mv) * c],
    l: (x, z) => [x * c + z * s - ex.mu, -x * s + z * c - ex.mv],
  };
  const ry = -th; // rotation.y that maps local +u to the world direction of u
  const lpts: Pt[] = pts.map(([x, z]) => F.l(x, z));

  // ---------------------------------------------------------------- grid
  const nu = Math.ceil(ex.du / CELL) + 1;
  const nv = Math.ceil(ex.dv / CELL) + 1;
  const inside = new Uint8Array(nu * nv);
  for (let j = 0; j < nv; j += 1) for (let i = 0; i < nu; i += 1) inside[j * nu + i] = pointInPoly((i + 0.5) * CELL, (j + 0.5) * CELL, lpts) ? 1 : 0;
  const isIn = (i: number, j: number) => i >= 0 && j >= 0 && i < nu && j < nv && inside[j * nu + i] === 1;
  // Main body: columns inside for most of the length.
  const rowsIn = new Array(nv).fill(0).map((_, j) => inside.subarray(j * nu, (j + 1) * nu).some((x) => x)).filter(Boolean).length;
  const colCount = new Array(nu).fill(0).map((_, i) => {
    let k = 0;
    for (let j = 0; j < nv; j += 1) k += inside[j * nu + i];
    return k;
  });
  const bodyCols = colCount.map((k, i) => (k >= rowsIn * 0.8 ? i : -1)).filter((i) => i >= 0);
  const b0 = bodyCols[0];
  const b1 = bodyCols[bodyCols.length - 1] + 1;
  const half = Math.round(CORRIDOR / CELL / 2);
  const mid = Math.round((b0 + b1) / 2);
  const c0 = mid - half; // corridor cells [c0, c1)
  const c1 = mid + half;

  // Room cuts along v at the footprint's own corners, merged and split to 5-9 m rooms.
  const vy = [...new Set(lpts.map((p) => Math.round(p[1] / CELL)))].sort((p, q) => p - q);
  const cuts: number[] = [];
  for (const y of vy) if (!cuts.length || y - cuts[cuts.length - 1] >= Math.round(4.5 / CELL)) cuts.push(y);
  if (cuts[cuts.length - 1] < nv - 1) cuts[cuts.length - 1] = nv - 1;
  const segs: [number, number][] = [];
  for (let k = 0; k < cuts.length - 1; k += 1) {
    const a = cuts[k];
    const z = cuts[k + 1];
    const parts = Math.max(1, Math.round(((z - a) * CELL) / 8));
    for (let p = 0; p < parts; p += 1) segs.push([Math.round(a + ((z - a) * p) / parts), Math.round(a + ((z - a) * (p + 1)) / parts)]);
  }

  // Lobby: the segment on the side with the biggest bump beyond the main body.
  let lobby: { side: number; seg: number; area: number } | null = null;
  for (let k = 0; k < segs.length; k += 1) {
    for (const side of [-1, 1]) {
      let area = 0;
      for (let j = segs[k][0]; j < segs[k][1]; j += 1) {
        for (let i = 0; i < nu; i += 1) if (inside[j * nu + i] && (side < 0 ? i < b0 : i >= b1)) area += 1;
      }
      if (!lobby || area > lobby.area) lobby = { side, seg: k, area };
    }
  }
  if (lobby && lobby.area < 8) lobby = null;
  // Stair well: a west/east room near the middle, at least 6.5 m long and 4.6 m deep.
  const centreSeg = (k: number) => Math.abs((segs[k][0] + segs[k][1]) / 2 - nv / 2);
  let stair: { side: number; seg: number } | null = null;
  for (const k of [...segs.keys()].sort((p, q) => centreSeg(p) - centreSeg(q))) {
    for (const side of [-1, 1]) {
      if (lobby && lobby.seg === k && lobby.side === side) continue;
      const len = (segs[k][1] - segs[k][0]) * CELL;
      const depth = (side < 0 ? c0 - b0 : b1 - c1) * CELL;
      if (len >= 6.5 && depth >= 4.6) {
        stair = { side, seg: k };
        break;
      }
    }
    if (stair) break;
  }
  if (!stair) return null;

  // Room ids per floor: 0 corridor/open, 1.. rooms. Same partition on every floor.
  const segOf = new Int16Array(nv).fill(-1);
  segs.forEach(([a, z], k) => {
    for (let j = a; j < z; j += 1) segOf[j] = k;
  });
  const roomOf = (i: number, j: number): { side: number; seg: number } | null => {
    if (i >= c0 && i < c1) return null;
    return { side: i < c0 ? -1 : 1, seg: segOf[j] };
  };
  const roomKeys: string[] = [];
  for (const side of [-1, 1]) for (let k = 0; k < segs.length; k += 1) roomKeys.push(`${side}:${k}`);
  const stairKey = `${stair.side}:${stair.seg}`;
  const lobbyKey = lobby ? `${lobby.side}:${lobby.seg}` : '';
  const floorIds = (f: number) => {
    const id = new Int16Array(nu * nv).fill(-1);
    for (let j = 0; j < nv; j += 1) {
      for (let i = 0; i < nu; i += 1) {
        if (!inside[j * nu + i]) continue;
        const r = roomOf(i, j);
        if (!r || r.seg < 0) {
          id[j * nu + i] = 0;
          continue;
        }
        const key = `${r.side}:${r.seg}`;
        id[j * nu + i] = key === stairKey || (f === 0 && key === lobbyKey) ? 0 : roomKeys.indexOf(key) + 1;
      }
    }
    return id;
  };

  // ---------------------------------------------------------------- levels
  let gmin = Infinity;
  for (const [x, z] of pts) gmin = Math.min(gmin, ground.heightAt(x, z));
  const pad = ground.padLevel(b) ?? gmin;
  const F0 = pad + 0.45;
  const top = F0 + levels * STOREY;
  const y0 = Math.min(gmin, pad) - 0.6;

  // ---------------------------------------------------------------- entrance
  // Doorway in the lobby's outer wall (the longest polygon edge on that side within it).
  let door: { a: Pt; b: Pt; t: number } | null = null;
  if (lobby) {
    const [va, vz] = segs[lobby.seg];
    let best = 0;
    for (let i = 0; i < lpts.length; i += 1) {
      const p = lpts[i];
      const q = lpts[(i + 1) % lpts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const mv = (p[1] + q[1]) / 2 / CELL;
      const mu = (p[0] + q[0]) / 2 / CELL;
      const along = Math.abs(q[0] - p[0]) < 0.3;
      const onSide = lobby.side < 0 ? mu < b0 : mu >= b1;
      if (along && onSide && mv > va && mv < vz && len > best) {
        best = len;
        door = { a: p, b: q, t: 0.5 };
      }
    }
  }
  if (!door) {
    // Fall back to the middle of the long west wall.
    let best = 0;
    for (let i = 0; i < lpts.length; i += 1) {
      const p = lpts[i];
      const q = lpts[(i + 1) % lpts.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (Math.abs(q[0] - p[0]) < 0.3 && len > best && p[0] / CELL < mid) {
        best = len;
        door = { a: p, b: q, t: 0.5 };
      }
    }
  }
  if (!door) return null;
  const doorW = 2.4;
  const doorH = 2.7;
  const dl: Pt = [door.a[0] + (door.b[0] - door.a[0]) * door.t, door.a[1] + (door.b[1] - door.a[1]) * door.t];
  const [dwx, dwz] = F.w(dl[0], dl[1]);
  const doorEdgeIndex = pts.findIndex((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const [pa, pb] = [F.l(p[0], p[1]), F.l(q[0], q[1])];
    return Math.hypot(pa[0] - door!.a[0], pa[1] - door!.a[1]) < 0.01 && Math.hypot(pb[0] - door!.b[0], pb[1] - door!.b[1]) < 0.01;
  });

  // ---------------------------------------------------------------- shell
  const parts = new Parts();
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
    const bays = Math.max(1, Math.round(len / 3.3));
    // Pieces along the edge: [t0, t1, bottom] (the doorway leaves a gap up to doorH).
    const pieces: [number, number, number][] = [];
    if (i === doorEdgeIndex) {
      const t0 = Math.max(0, door.t - doorW / 2 / len);
      const t1 = Math.min(1, door.t + doorW / 2 / len);
      pieces.push([0, t0, F0], [t0, t1, F0 + doorH], [t1, 1, F0]);
    } else pieces.push([0, 1, F0]);
    for (const [t0, t1, bottom] of pieces) {
      if (t1 - t0 < 1e-3) continue;
      const P0: Pt = [a[0] + dx * t0, a[1] + dz * t0];
      const P1: Pt = [a[0] + dx * t1, a[1] + dz * t1];
      const u0 = t0 * bays;
      const u1 = t1 * bays;
      const v0 = (bottom - F0) / STOREY;
      const v1 = (top - F0) / STOREY;
      // Outside face (windows texture), and the inside face of the same wall.
      const A0 = new THREE.Vector3(P0[0], bottom, P0[1]);
      const A1 = new THREE.Vector3(P0[0], top, P0[1]);
      const C1 = new THREE.Vector3(P1[0], top, P1[1]);
      const C0 = new THREE.Vector3(P1[0], bottom, P1[1]);
      B.facade.quad(B.facade.vert(A0, n, u0, v0, 0.92, 0, wall), B.facade.vert(A1, n, u0, v1, 1, 0, wall), B.facade.vert(C1, n, u1, v1, 1, 0, wall), B.facade.vert(C0, n, u1, v0, 0.92, 0, wall));
      const off = (p: THREE.Vector3) => p.clone().addScaledVector(n, -EXT);
      B.facade.quad(B.facade.vert(off(C0), inward, u1, v0, 0.9, 0, INSIDE), B.facade.vert(off(C1), inward, u1, v1, 1, 0, INSIDE), B.facade.vert(off(A1), inward, u0, v1, 1, 0, INSIDE), B.facade.vert(off(A0), inward, u0, v0, 0.9, 0, INSIDE));
      const segLen = len * (t1 - t0);
      const mx = (P0[0] + P1[0]) / 2 - nx * EXT / 2;
      const mz = (P0[1] + P1[1]) / 2 - nz * EXT / 2;
      physics.tag(physics.addBox({ x: mx, y: (bottom + top) / 2, z: mz, hx: segLen / 2, hy: (top - bottom) / 2, hz: EXT / 2, rotY: Math.atan2(-dz, dx) }), 'rock');
    }
    // Door reveal (wall thickness) around the opening.
    if (i === doorEdgeIndex) {
      for (const t of [door.t - doorW / 2 / len, door.t + doorW / 2 / len]) {
        const px = a[0] + dx * t - nx * EXT / 2;
        const pz = a[1] + dz * t - nz * EXT / 2;
        parts.add('frame', 0.12, doorH, EXT + 0.04, px, F0 + doorH / 2, pz, Math.atan2(-dz, dx));
      }
      parts.add('frame', doorW + 0.24, 0.12, EXT + 0.04, a[0] + dx * door.t - nx * EXT / 2, F0 + doorH - 0.06, a[1] + dz * door.t - nz * EXT / 2, Math.atan2(-dz, dx));
    }
    // Plinth below the floor.
    const P0 = new THREE.Vector3(a[0] + nx * 0.06, y0, a[1] + nz * 0.06);
    const P1 = new THREE.Vector3(a[0] + nx * 0.06, F0, a[1] + nz * 0.06);
    const Q1 = new THREE.Vector3(q[0] + nx * 0.06, F0, q[1] + nz * 0.06);
    const Q0 = new THREE.Vector3(q[0] + nx * 0.06, y0, q[1] + nz * 0.06);
    B.plain.quad(B.plain.vert(P0, n, 0, y0 / 3, 0.85, 0, PLINTH), B.plain.vert(P1, n, 0, F0 / 3, 1, 0, PLINTH), B.plain.vert(Q1, n, len / 3, F0 / 3, 1, 0, PLINTH), B.plain.vert(Q0, n, len / 3, y0 / 3, 0.85, 0, PLINTH));
    physics.addBox({ x: (a[0] + q[0]) / 2 - nx * EXT / 2, y: (y0 + F0) / 2, z: (a[1] + q[1]) / 2 - nz * EXT / 2, hx: len / 2, hy: (F0 - y0) / 2, hz: EXT / 2, rotY: Math.atan2(-dz, dx) });
  }

  // ---------------------------------------------------------------- floors and slabs
  const S = stair;
  const sU0 = (S.side < 0 ? b0 : c1) * CELL;
  const sU1 = (S.side < 0 ? c0 : b1) * CELL;
  const sV0 = segs[S.seg][0] * CELL;
  const sV1 = segs[S.seg][1] * CELL;
  const sMid = (sU0 + sU1) / 2;
  const flightRun = Math.round(STOREY / 2 / RISE) * TREAD;
  // Flights start / arrive here: on a grid line, so the slab edge meets the stair flush.
  const vS = sV0 + 1.0;
  const holeV1 = Math.min(sV1 - 0.2, vS + flightRun + 1.5);
  // The flight next to the corridor arrives (so you step off straight into the corridor).
  const arriveNearCorridor = S.side < 0 ? [sMid, sU1] : [sU0, sMid];
  const climbFar = S.side < 0 ? [sU0, sMid] : [sMid, sU1];
  const hole: Pt[] = [[sU0, vS], [sU1, vS], [sU1, holeV1], [sU0, holeV1]].map(([u, v]) => F.w(u, v));
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  const slab = (y: number, up: boolean, withHole: boolean) => {
    // Fresh copies: triangulateShape reverses its inputs in place.
    const outline = contour.map((v) => v.clone());
    const holes = withHole ? [hole.map(([x, z]) => new THREE.Vector2(x, z))] : [];
    const tris = THREE.ShapeUtils.triangulateShape(outline, holes);
    const all = [...outline, ...holes.flat()];
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    for (const t of tris) {
      // Wind each triangle so it faces up (floors) or down (ceilings), whatever the input order.
      const [p0, p1, p2] = [all[t[0]], all[t[1]], all[t[2]]];
      const ny = (p2.x - p0.x) * (p1.y - p0.y) - (p1.x - p0.x) * (p2.y - p0.y);
      const facesUp = ny > 0;
      const order = facesUp === up ? [t[0], t[1], t[2]] : [t[0], t[2], t[1]];
      for (const k of order) {
        pos.push(all[k].x, y, all[k].y);
        nor.push(0, up ? 1 : -1, 0);
        uv.push(all[k].x / 2, all[k].y / 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    return g;
  };
  // Floor colliders: merged runs of grid cells, outside the stair hole on upper floors.
  const floorBoxes = (yTop: number, thick: number, withHole: boolean) => {
    const inHole = (i: number, j: number) => withHole && (i + 0.5) * CELL > sU0 && (i + 0.5) * CELL < sU1 && (j + 0.5) * CELL > vS && (j + 0.5) * CELL < holeV1;
    let prev: { i0: number; i1: number; j0: number }[] = [];
    const flush = (r: { i0: number; i1: number; j0: number }, j1: number) => {
      const u0 = r.i0 * CELL;
      const u1 = r.i1 * CELL;
      const v0 = r.j0 * CELL;
      const v1 = j1 * CELL;
      const [x, z] = F.w((u0 + u1) / 2, (v0 + v1) / 2);
      physics.tag(physics.addBox({ x, y: yTop - thick / 2, z, hx: (u1 - u0) / 2, hy: thick / 2, hz: (v1 - v0) / 2, rotY: ry }), 'rock');
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
        const p = prev.find((x) => x.i0 === r.i0 && x.i1 === r.i1);
        next.push(p ? p : { ...r, j0: j });
      }
      for (const p of prev) if (!next.includes(p)) flush(p, j);
      prev = next;
    }
  };
  parts.geom('floor', slab(F0, true, false));
  floorBoxes(F0, 0.6, false);
  for (let f = 1; f < levels; f += 1) {
    const y = F0 + f * STOREY;
    parts.geom('floor', slab(y, true, true));
    parts.geom('ceiling', slab(y - SLAB, false, true));
    floorBoxes(y, SLAB, true);
    // Slab edge inside the stair hole.
    const [hx, hz] = F.w((sU0 + sU1) / 2, (vS + holeV1) / 2);
    void hx;
    void hz;
  }
  parts.geom('ceiling', slab(top - 0.05, false, false));
  // Roof and parapet are part of the shared roof builders.
  {
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const up = new THREE.Vector3(0, 1, 0);
    const roofCol = new THREE.Color('#d8d6d0');
    for (const t of tris) {
      const ids = [t[0], t[2], t[1]].map((k) => B.flat.vert(new THREE.Vector3(contour[k].x, top + 0.02, contour[k].y), up, contour[k].x / 4, contour[k].y / 4, 1, 0, roofCol));
      B.flat.tri(ids[0], ids[1], ids[2]);
    }
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (len < 0.05) continue;
      parts.add('parapet', len + 0.2, 0.9, 0.22, (a[0] + q[0]) / 2, top + 0.45, (a[1] + q[1]) / 2, Math.atan2(-(q[1] - a[1]), q[0] - a[0]));
    }
  }

  // ---------------------------------------------------------------- stairs
  const L = (u: number, v: number, y: number, w: number, h: number, d: number, mat: string, solid = true) => {
    const [x, z] = F.w(u, v);
    parts.add(mat, w, h, d, x, y, z, ry);
    if (solid) physics.addBox({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, rotY: ry });
  };
  const steps = Math.round(STOREY / 2 / RISE);
  const rise = STOREY / 2 / steps;
  /** Ramp collider for one flight: from (v0, y0) climbing half a storey toward dir (+1 = +v). */
  const ramp = (u: number, width: number, v0: number, y0: number, dir: number) => {
    const beta = Math.atan2(STOREY / 2, flightRun);
    const hyp = Math.hypot(STOREY / 2, flightRun);
    const hy = 0.1;
    const vm = v0 + (dir * flightRun) / 2;
    const ym = y0 + STOREY / 4;
    const cv = vm + dir * Math.sin(beta) * hy;
    const cy = ym - Math.cos(beta) * hy;
    const [x, z] = F.w(u, cv);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-dir * beta, ry, 0, 'YXZ'));
    physics.addBox({ x, y: cy, z, hx: width / 2, hy, hz: hyp / 2, quat: { x: q.x, y: q.y, z: q.z, w: q.w } });
  };
  for (let f = 0; f < levels - 1; f += 1) {
    const base = F0 + f * STOREY;
    const landY = base + STOREY / 2;
    // Flight 1 (far half) climbs away from the corridor end, flight 2 comes back.
    const [a0, a1] = climbFar;
    const [b0u, b1u] = arriveNearCorridor;
    // Steps are drawn; you walk on a smooth ramp along them (reliable for the character).
    for (let k = 0; k < steps; k += 1) {
      const t = base + (k + 1) * rise;
      const v = vS + (k + 0.5) * TREAD;
      const bot = Math.max(base, t - 0.35);
      L((a0 + a1) / 2, v, (bot + t) / 2, a1 - a0 - 0.1, t - bot, TREAD + 0.01, 'stair', false);
    }
    ramp((a0 + a1) / 2, a1 - a0 - 0.1, vS, base, 1);
    // Landing across both halves.
    L((sU0 + sU1) / 2, vS + flightRun + 0.7, landY - 0.12, sU1 - sU0 - 0.1, 0.24, 1.4, 'stair');
    for (let k = 0; k < steps; k += 1) {
      const t = landY + (k + 1) * rise;
      const v = vS + flightRun - (k + 0.5) * TREAD;
      const bot = Math.max(landY - 0.2, t - 0.35);
      L((b0u + b1u) / 2, v, (bot + t) / 2, b1u - b0u - 0.1, t - bot, TREAD + 0.01, 'stair', false);
    }
    ramp((b0u + b1u) / 2, b1u - b0u - 0.1, vS + flightRun, landY, -1);
    // Wall between the flights (stringer) and a handrail on top.
    L(sMid, vS + flightRun / 2, base + STOREY / 2, 0.12, STOREY - 0.2, flightRun + 0.1, 'wall');
  }
  // Rails round the stair hole on upper floors (open where flights arrive and leave).
  for (let f = 1; f < levels; f += 1) {
    const y = F0 + f * STOREY;
    const corridorEdgeU = S.side < 0 ? sU1 : sU0;
    L(corridorEdgeU, (vS + holeV1) / 2, y + 0.5, 0.06, 1.0, holeV1 - vS, 'rail');
    L((sU0 + sU1) / 2, holeV1, y + 0.5, sU1 - sU0, 1.0, 0.06, 'rail');
    if (f === levels - 1) L((climbFar[0] + climbFar[1]) / 2, vS, y + 0.5, climbFar[1] - climbFar[0], 1.0, 0.06, 'rail');
  }

  // ---------------------------------------------------------------- partitions, doors, rooms
  const mats = materials();
  const roomList: { name: string; floor: number; x: number; z: number; y: number; door: [number, number] | null }[] = [];
  const signs = new THREE.Group();
  signs.name = 'interior-signs';
  for (let f = 0; f < levels; f += 1) {
    const base = F0 + f * STOREY;
    const ceil = f < levels - 1 ? base + STOREY - SLAB : top - 0.05;
    const wallH = ceil - base;
    const id = floorIds(f);
    const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < nu && j < nv ? id[j * nu + i] : -1);
    // Rooms present on this floor, in naming order.
    const present = roomKeys.map((_, r) => r + 1).filter((r) => id.includes(r));
    const names = FLOOR_ROOMS[f] ?? [];
    const roomName = new Map<number, string>();
    present.forEach((r, k) => roomName.set(r, names[k] ?? `Room ${f}${String(k + 1).padStart(2, '0')}`));
    // Doors: for each room, the corridor-side run of boundary cells nearest the room's middle.
    const doorCells = new Set<string>();
    const doorAt = new Map<number, { u: number; v: number; along: 'u' | 'v'; dir: number }>();
    for (const r of present) {
      const cand: { i: number; j: number; along: 'u' | 'v'; dir: number }[] = [];
      for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
          if (at(i, j) !== r) continue;
          if (at(i + 1, j) === 0) cand.push({ i: i + 1, j, along: 'v', dir: 1 });
          if (at(i - 1, j) === 0) cand.push({ i, j, along: 'v', dir: -1 });
        }
      }
      if (!cand.length) continue;
      const mj = cand.reduce((s2, p) => s2 + p.j, 0) / cand.length;
      cand.sort((p, q) => Math.abs(p.j - mj) - Math.abs(q.j - mj));
      const d = cand[0];
      for (let k = -1; k <= 1; k += 1) doorCells.add(`${d.i}:${d.j + k}`);
      doorAt.set(r, { u: d.i * CELL, v: (d.j + 0.5) * CELL, along: 'v', dir: d.dir });
    }
    // Wall units between different spaces, merged into runs.
    const runsV = new Map<number, [number, number, boolean][]>(); // along v at line u=i
    const runsU = new Map<number, [number, number][]>(); // along u at line v=j
    for (let j = 0; j < nv; j += 1) {
      for (let i = 0; i < nu; i += 1) {
        const a = at(i, j);
        if (a < 0) continue;
        const r = at(i + 1, j);
        if (r >= 0 && r !== a) {
          const isDoor = doorCells.has(`${i + 1}:${j}`);
          const list = runsV.get(i + 1) ?? [];
          list.push([j, j + 1, isDoor]);
          runsV.set(i + 1, list);
        }
        const u = at(i, j + 1);
        if (u >= 0 && u !== a) {
          const list = runsU.get(j + 1) ?? [];
          list.push([i, i + 1]);
          runsU.set(j + 1, list);
        }
      }
    }
    const wallPiece = (u0: number, v0: number, u1: number, v1: number, yb: number, yt: number) => {
      const len = Math.hypot(u1 - u0, v1 - v0);
      const alongU = Math.abs(u1 - u0) > Math.abs(v1 - v0);
      L((u0 + u1) / 2, (v0 + v1) / 2, (yb + yt) / 2, alongU ? len + INT : INT, yt - yb, alongU ? INT : len + INT, 'wall');
    };
    for (const [line, units] of runsV) {
      units.sort((p, q) => p[0] - q[0]);
      let k = 0;
      while (k < units.length) {
        const door = units[k][2];
        const j0 = units[k][0];
        let j1 = units[k][1];
        while (k + 1 < units.length && units[k + 1][0] === j1 && units[k + 1][2] === door) {
          k += 1;
          j1 = units[k][1];
        }
        if (door) wallPiece(line * CELL, j0 * CELL, line * CELL, j1 * CELL, base + DOOR_H, ceil);
        else wallPiece(line * CELL, j0 * CELL, line * CELL, j1 * CELL, base, ceil);
        k += 1;
      }
    }
    for (const [line, units] of runsU) {
      units.sort((p, q) => p[0] - q[0]);
      let k = 0;
      while (k < units.length) {
        const i0 = units[k][0];
        let i1 = units[k][1];
        while (k + 1 < units.length && units[k + 1][0] === i1) {
          k += 1;
          i1 = units[k][1];
        }
        wallPiece(i0 * CELL, line * CELL, i1 * CELL, line * CELL, base, ceil);
        k += 1;
      }
    }
    void wallH;
    // Rooms: lights, furniture, door sign.
    for (const r of present) {
      let i0 = nu, i1 = 0, j0 = nv, j1 = 0;
      for (let j = 0; j < nv; j += 1) {
        for (let i = 0; i < nu; i += 1) {
          if (at(i, j) !== r) continue;
          i0 = Math.min(i0, i); i1 = Math.max(i1, i + 1); j0 = Math.min(j0, j); j1 = Math.max(j1, j + 1);
        }
      }
      // Furnish the largest rectangle of the room: its main body next to the corridor.
      const side = i0 * CELL < c0 * CELL ? -1 : 1;
      const room = { u0: i0 * CELL + 0.25, u1: i1 * CELL - 0.25, v0: j0 * CELL + 0.25, v1: j1 * CELL - 0.25, side };
      const name = roomName.get(r) ?? '';
      furnish(kindOf(name), room, base, L, at, r);
      const [rcx, rcz] = F.w((room.u0 + room.u1) / 2, (room.v0 + room.v1) / 2);
      roomList.push({ name, floor: f, x: rcx, z: rcz, y: base, door: doorAt.get(r) ? F.w(doorAt.get(r)!.u, doorAt.get(r)!.v) : null });
      for (let v = room.v0 + 2; v < room.v1 - 1; v += 3.2) L((room.u0 + room.u1) / 2, v, ceil - 0.03, 1.2, 0.04, 0.6, 'light', false);
      const d = doorAt.get(r);
      if (d) {
        const signU = d.u + d.dir * 0.09;
        const [sx, sz] = F.w(signU, d.v);
        const tex = signTexture([
          { text: name.toUpperCase(), size: name.length > 26 ? 34 : 46, weight: 700, color: '#ffffff' },
        ], { w: 768, h: 128, bg: '#7a1f1f', border: '#f2d27a' });
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.32), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
        sign.position.set(sx, base + DOOR_H + 0.3, sz);
        // Faces the corridor (local +u if the door is on the room's +u side).
        sign.rotation.y = ry + (d.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        signs.add(sign);
        // Door frame.
        L(d.u, d.v - 0.75, base + DOOR_H / 2, INT + 0.06, DOOR_H, 0.08, 'frame', false);
        L(d.u, d.v + 0.75, base + DOOR_H / 2, INT + 0.06, DOOR_H, 0.08, 'frame', false);
        L(d.u, d.v, base + DOOR_H + 0.04, INT + 0.06, 0.08, 1.58, 'frame', false);
      }
    }
    // Corridor lights and a floor sign by the stairs.
    for (let v = 2; v < nv * CELL - 2; v += 4) L((c0 + c1) * CELL / 2, v, ceil - 0.03, 0.6, 0.04, 1.2, 'light', false);
    const tex = signTexture([{ text: FLOOR_NAMES[f] ?? `Floor ${f}`, size: 56, weight: 700, color: '#ffffff' }, { text: 'RESEARCH AND INNOVATION CENTRE', size: 26, weight: 600, color: '#f2d27a' }], { w: 768, h: 192, bg: '#23324f', border: '#f2d27a' });
    const fs = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    const signSideU = S.side < 0 ? sU1 + 0.02 : sU0 - 0.02;
    const [fx, fz] = F.w(c0 * CELL + (S.side < 0 ? 0.02 : CORRIDOR - 0.02), sV1 + 0.6);
    void signSideU;
    fs.position.set(fx, base + 1.7, fz);
    fs.rotation.y = ry + (S.side < 0 ? Math.PI / 2 : -Math.PI / 2);
    signs.add(fs);
  }
  // Lobby reception desk and name board on the ground floor.
  if (lobby) {
    const [va, vz] = segs[lobby.seg];
    const u = lobby.side < 0 ? (b0 - 1.5 / CELL) * CELL : (b1 + 1.5 / CELL) * CELL;
    L(Math.max(0.8, Math.min(ex.du - 0.8, u)), (va + vz) / 2 * CELL + 2.2, F0 + 0.55, 0.7, 1.1, 2.6, 'wood');
  }
  parts.build(group, mats);
  group.add(signs);
  // Where the stairs are (tests and tools): foot of the first flight and its climb direction.
  const [footX, footZ] = F.w((climbFar[0] + climbFar[1]) / 2, vS - 0.6);
  const [upX, upZ] = F.w((climbFar[0] + climbFar[1]) / 2, vS + 1);
  group.userData.walkIn ??= [];
  (group.userData.walkIn as unknown[]).push({ name: b.name, floors: [...Array(levels).keys()].map((f) => F0 + f * STOREY), stairFoot: [footX, footZ], stairUp: [upX - footX, upZ - footZ], flightRun, rooms: roomList, landingDepth: 1.4, flight2Start: F.w((arriveNearCorridor[0] + arriveNearCorridor[1]) / 2, vS + flightRun + 0.5), flight2Up: (() => { const [p2x, p2z] = F.w(0, 0); const [q2x, q2z] = F.w(0, -1); return [q2x - p2x, q2z - p2z]; })() });

  // Entrance outside the doorway, facing out.
  const di = doorEdgeIndex;
  const p = pts[di];
  const q = pts[(di + 1) % pts.length];
  const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const nx = (q[1] - p[1]) / len;
  const nz = -(q[0] - p[0]) / len;
  return {
    floor: F0,
    top,
    entrance: { x: dwx + nx * 2.6, z: dwz + nz * 2.6, y: ground.heightAt(dwx + nx * 2.6, dwz + nz * 2.6), facing: Math.atan2(nx, nz), doorX: dwx, doorZ: dwz },
  };
}

const INSIDE = new THREE.Color('#efe9dc');
const PLINTH = new THREE.Color('#8c877c');

type Place = (u: number, v: number, y: number, w: number, h: number, d: number, mat: string, solid?: boolean) => void;

/** Furniture for a room (local frame box helper `L`; room rectangle in local metres). */
function furnish(kind: RoomKind, r: { u0: number; u1: number; v0: number; v1: number; side: number }, base: number, L: Place, at: (i: number, j: number) => number, id: number): void {
  const inRoom = (u: number, v: number) => at(Math.floor(u / CELL), Math.floor(v / CELL)) === id;
  const W = r.u1 - r.u0;
  const D = r.v1 - r.v0;
  // Keep a clear strip by the corridor wall for the door.
  const doorSide = r.side < 0 ? r.u1 : r.u0;
  const far = r.side < 0 ? r.u0 : r.u1;
  const inward = r.side < 0 ? 1 : -1;
  const clearU = (u: number) => Math.abs(u - doorSide) > 1.3;
  if (kind === 'classroom') {
    // Whiteboard on the front wall (v0), desks in rows facing it.
    L((r.u0 + r.u1) / 2, r.v0 + 0.03, base + 1.5, Math.min(3.6, W - 1), 1.2, 0.04, 'board', false);
    L((r.u0 + r.u1) / 2, r.v0 + 0.9, base + 0.4, 1.4, 0.8, 0.6, 'wood');
    for (let v = r.v0 + 2.3; v < r.v1 - 0.6; v += 1.1) {
      for (let u = r.u0 + 0.9; u < r.u1 - 0.6; u += 1.5) {
        if (!clearU(u) || !inRoom(u, v)) continue;
        L(u, v, base + 0.72, 1.2, 0.05, 0.42, 'wood');
        L(u, v + 0.42, base + 0.42, 1.2, 0.05, 0.3, 'wood');
        L(u, v + 0.15, base + 0.36, 1.15, 0.72, 0.06, 'metal');
        L(u, v + 0.1, base + 0.36, 1.2, 0.72, 0.75, 'none');
      }
    }
  } else if (kind === 'lab') {
    // Benches along the far wall and down the middle, with monitors.
    for (let v = r.v0 + 0.8; v < r.v1 - 0.8; v += 1.6) {
      if (!inRoom(far + inward * 0.5, v)) continue;
      L(far + inward * 0.45, v, base + 0.45, 0.8, 0.9, 1.5, 'wood');
      L(far + inward * 0.55, v, base + 1.15, 0.06, 0.4, 0.6, 'screen', false);
    }
    const mid = (r.u0 + r.u1) / 2;
    if (W > 4.5) {
      for (let v = r.v0 + 1.6; v < r.v1 - 1.4; v += 2.4) {
        if (!inRoom(mid, v)) continue;
        L(mid, v, base + 0.45, 1.6, 0.9, 1.8, 'wood');
        L(mid, v, base + 1.12, 0.5, 0.36, 0.06, 'screen', false);
      }
    }
  } else if (kind === 'hall') {
    L((r.u0 + r.u1) / 2, r.v0 + 0.03, base + 1.7, Math.min(4, W - 1), 1.8, 0.04, 'board', false);
    L((r.u0 + r.u1) / 2, r.v0 + 1.1, base + 0.55, 0.7, 1.1, 0.5, 'wood');
    for (let v = r.v0 + 2.6; v < r.v1 - 0.6; v += 0.95) {
      for (let u = r.u0 + 0.7; u < r.u1 - 0.5; u += 0.65) {
        if (!clearU(u) || !inRoom(u, v)) continue;
        L(u, v, base + 0.45, 0.5, 0.06, 0.45, 'chair', false);
        L(u, v + 0.22, base + 0.75, 0.5, 0.6, 0.05, 'chair', false);
      }
    }
  } else if (kind === 'store') {
    for (let v = r.v0 + 0.5; v < r.v1 - 0.5; v += 1.2) if (inRoom(far + inward * 0.3, v)) L(far + inward * 0.3, v, base + 1.0, 0.5, 2.0, 1.0, 'metal');
  } else {
    // Department office: desks with chairs, cabinets along the far wall, a meeting table.
    for (let v = r.v0 + 1.2; v < r.v1 - 0.8; v += 2.2) {
      const u = far + inward * 1.4;
      if (!inRoom(u, v)) continue;
      L(u, v, base + 0.37, 1.4, 0.74, 0.7, 'wood');
      L(u, v, base + 0.98, 0.5, 0.34, 0.05, 'screen', false);
      L(u + inward * 0.7, v, base + 0.45, 0.5, 0.9, 0.5, 'chair', false);
    }
    for (let v = r.v0 + 0.5; v < r.v1 - 0.5; v += 1.0) if (inRoom(far + inward * 0.25, v)) L(far + inward * 0.25, v, base + 0.95, 0.45, 1.9, 0.9, 'metal');
    if (W > 4 && D > 4) L((r.u0 + r.u1) / 2 + inward * 0.3, (r.v0 + r.v1) / 2, base + 0.38, 1.0, 0.76, 1.8, 'wood');
  }
  void L;
  void W;
}

function materials(): Record<string, THREE.Material> {
  const floorTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d')!;
    x.fillStyle = '#c9c2b4';
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) {
      x.fillStyle = (i + j) % 2 ? '#c4bdaf' : '#cec7ba';
      x.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  })();
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  return {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55 }),
    // Interiors sit in the roof's shadow: a soft glow stands in for the room lighting.
    ceiling: std('#f4f2ec', { roughness: 0.95, emissive: '#f4f2ec', emissiveIntensity: 0.32, side: THREE.DoubleSide }),
    wall: std('#ece4d2', { roughness: 0.92, emissive: '#ece4d2', emissiveIntensity: 0.14 }),
    stair: std('#b7b0a4', { roughness: 0.85, emissive: '#b7b0a4', emissiveIntensity: 0.18 }),
    rail: std('#3c3f42', { roughness: 0.4, metalness: 0.7 }),
    frame: std('#6a4a30', { roughness: 0.7 }),
    parapet: std('#e9e3d3', { roughness: 0.9 }),
    wood: std('#8a5e3b', { roughness: 0.65 }),
    metal: std('#7d8286', { roughness: 0.45, metalness: 0.6 }),
    chair: std('#2d4a6b', { roughness: 0.7 }),
    board: std('#f7f7f2', { roughness: 0.3 }),
    screen: std('#15181c', { roughness: 0.25, metalness: 0.2 }),
    light: new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 1.6 }),
    none: new THREE.MeshBasicMaterial({ visible: false }),
  };
}
