// Shared pieces for building interiors: the material palette, a fast box/cylinder batcher
// (one mesh per material per building), and the furnishing API the room furnishers use.
//
// Furnishers (work.ts, study.ts, living.ts) only see the Room and Kit below. They work in
// the room's own frame: u and v are metres along the building's two wall directions,
// y is height above the room's floor. Nothing they do needs to know where the building is.

import * as THREE from 'three';

/** Material names. Colours and textures are in `palette()`. */
export type Mat =
  // building fabric
  | 'floor' | 'ceiling' | 'wall' | 'stair' | 'rail' | 'frame' | 'reveal' | 'sill' | 'parapet' | 'glass' | 'tile' | 'concrete' | 'brick'
  // furniture and fittings
  | 'wood' | 'darkwood' | 'plywood' | 'metal' | 'steel' | 'chrome' | 'machine' | 'machineDark' | 'yellow' | 'red' | 'orange' | 'blue'
  | 'green' | 'cream' | 'white' | 'black' | 'rubber' | 'fabric' | 'mattress' | 'pillow' | 'cushion' | 'chair' | 'paper' | 'books'
  | 'board' | 'greenboard' | 'screen' | 'light' | 'plant' | 'soil' | 'water' | 'sign'
  // invisible (colliders only)
  | 'none';

export type Side = 'u0' | 'u1' | 'v0' | 'v1';

export interface Room {
  name: string;
  /** What the room is for (picks the furnisher), e.g. 'classroom', 'workshop', 'dorm'. */
  kind: string;
  /** Extra detail for the furnisher, e.g. the workshop trade: 'auto', 'carpentry', 'welding'. */
  sub?: string;
  /** The building's display name (e.g. "Boys Hostel (B Block)"). */
  building: string;
  /** The largest clear rectangle of the room, in local metres, already 0.1 m in from the walls. */
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** Clear height from floor to ceiling (to the wall top where the roof is open). */
  height: number;
  /** True when there is no ceiling: the pitched roof and its trusses are overhead. */
  openRoof: boolean;
  /** 0 = ground floor. */
  floor: number;
  /** Door centres on the room's outline (keep about 1.2 m in front of each clear). */
  doors: { u: number; v: number; side: Side | null }[];
  /** Wall to treat as the front (board, stage, counter): the one farthest from the doors. */
  front: Side;
  /** True when the point is on this room's floor, clear of doorways and of solid things placed so far. */
  free(u: number, v: number, r?: number): boolean;
  /** True when a w (along u) × d (along v) footprint centred at (u, v) fits the same way. */
  fits(u: number, v: number, w: number, d: number): boolean;
  /** Seeded random in [0, 1), the same every load. */
  rand(): number;
}

export interface BoxOpts {
  /** Extra yaw in radians; π/2 swaps the box's w and d. */
  rot?: number;
  /** Adds a collider and reserves the footprint (later `free`/`fits` calls avoid it). */
  solid?: boolean;
}

export interface CylOpts {
  /** 'y' stands upright (y = bottom); 'u' / 'v' lies along that axis (y = centre height). */
  axis?: 'y' | 'u' | 'v';
  seg?: number;
  /** Top radius if different (cones, lamp shades). */
  r2?: number;
  solid?: boolean;
}

export interface Kit {
  /** A box w (along u) × h × d (along v), centred on (u, v), bottom `y` above the floor. */
  box(mat: Mat, u: number, v: number, y: number, w: number, h: number, d: number, o?: BoxOpts): void;
  /** A cylinder of radius r and length h (see CylOpts for axis and y). */
  cyl(mat: Mat, u: number, v: number, y: number, r: number, h: number, o?: CylOpts): void;
}

export type Furnisher = (room: Room, k: Kit) => void;

/** Seeded random (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ==================================================================== batcher

interface Lists { pos: number[]; nor: number[]; uv: number[]; idx: number[] }

/** World-space boxes and cylinders, grouped by material; `build` makes one mesh per material. */
export class Batch {
  private lists = new Map<Mat, Lists>();
  private get(m: Mat): Lists {
    let l = this.lists.get(m);
    if (!l) this.lists.set(m, (l = { pos: [], nor: [], uv: [], idx: [] }));
    return l;
  }

  get empty(): boolean {
    return this.lists.size === 0;
  }

  /** Box centred at (x, y, z), w × h × d, turned by ry about y (three.js rotation.y). */
  box(m: Mat, w: number, h: number, d: number, x: number, y: number, z: number, ry: number): void {
    if (m === 'none') return;
    const L = this.get(m);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const hw = w / 2;
    const hh = h / 2;
    const hd = d / 2;
    const metric = METRIC[m] ?? 0;
    // Faces: normal (local), two in-plane axes (local) and their half sizes.
    const faces: [number, number, number, number, number, number, number, number, number, number, number][] = [
      [1, 0, 0, 0, 0, -1, 0, 1, 0, hd, hh],
      [-1, 0, 0, 0, 0, 1, 0, 1, 0, hd, hh],
      [0, 1, 0, 1, 0, 0, 0, 0, -1, hw, hd],
      [0, -1, 0, 1, 0, 0, 0, 0, 1, hw, hd],
      [0, 0, 1, 1, 0, 0, 0, 1, 0, hw, hh],
      [0, 0, -1, -1, 0, 0, 0, 1, 0, hw, hh],
    ];
    for (const [nx, ny, nz, ax, ay, az, bx, by, bz, ha, hb] of faces) {
      const cxl = nx * hw;
      const cyl = ny * hh;
      const czl = nz * hd;
      const base = L.pos.length / 3;
      const wnx = nx * c + nz * s;
      const wnz = -nx * s + nz * c;
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const lx = cxl + ax * ha * sa + bx * hb * sb;
        const ly = cyl + ay * ha * sa + by * hb * sb;
        const lz = czl + az * ha * sa + bz * hb * sb;
        L.pos.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
        L.nor.push(wnx, ny, wnz);
        if (metric) L.uv.push(((sa + 1) * ha) / metric, ((sb + 1) * hb) / metric);
        else L.uv.push((sa + 1) / 2, (sb + 1) / 2);
      }
      L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** Cylinder centred at (x, y, z) along local axis ('y' upright, 'x' or 'z' lying), turned by ry. */
  cyl(m: Mat, r: number, r2: number, h: number, x: number, y: number, z: number, ry: number, axis: 'x' | 'y' | 'z', seg: number): void {
    if (m === 'none') return;
    const L = this.get(m);
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    // Local point (a along the axis, p, q round it) to world.
    const put = (a: number, p: number, q: number, na: number, np: number, nq: number) => {
      let lx: number, ly: number, lz: number, nx: number, ny: number, nz: number;
      if (axis === 'y') [lx, ly, lz, nx, ny, nz] = [p, a, q, np, na, nq];
      else if (axis === 'x') [lx, ly, lz, nx, ny, nz] = [a, p, q, na, np, nq];
      else [lx, ly, lz, nx, ny, nz] = [p, q, a, np, nq, na];
      L.pos.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
      L.nor.push(nx * c + nz * s, ny, -nx * s + nz * c);
    };
    const base = L.pos.length / 3;
    const slope = (r - r2) / h;
    for (let k = 0; k <= seg; k += 1) {
      const t = (k / seg) * Math.PI * 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      const nl = Math.hypot(1, slope);
      put(-h / 2, r * ct, r * st, slope / nl, ct / nl, st / nl);
      L.uv.push(k / seg, 0);
      put(h / 2, r2 * ct, r2 * st, slope / nl, ct / nl, st / nl);
      L.uv.push(k / seg, 1);
    }
    for (let k = 0; k < seg; k += 1) {
      const a = base + k * 2;
      L.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    // Caps.
    for (const [end, rr, dir] of [[h / 2, r2, 1], [-h / 2, r, -1]] as [number, number, number][]) {
      if (rr <= 0) continue;
      const cb = L.pos.length / 3;
      put(end, 0, 0, dir, 0, 0);
      L.uv.push(0.5, 0.5);
      for (let k = 0; k <= seg; k += 1) {
        const t = (k / seg) * Math.PI * 2;
        put(end, rr * Math.cos(t), rr * Math.sin(t), dir, 0, 0);
        L.uv.push(0.5 + Math.cos(t) / 2, 0.5 + Math.sin(t) / 2);
      }
      for (let k = 0; k < seg; k += 1) {
        if (dir > 0) L.idx.push(cb, cb + k + 2, cb + k + 1);
        else L.idx.push(cb, cb + k + 1, cb + k + 2);
      }
    }
    // Winding depends on the axis mapping: flip any triangle that faces against its normals.
    for (let t = L.idx.length - 3; t >= 0; t -= 3) {
      const [i0, i1, i2] = [L.idx[t], L.idx[t + 1], L.idx[t + 2]];
      if (i0 < base) break;
      const P = (i: number) => [L.pos[i * 3], L.pos[i * 3 + 1], L.pos[i * 3 + 2]];
      const [a, b, cc] = [P(i0), P(i1), P(i2)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
      const fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const vn = [0, 1, 2].map((k) => L.nor[i0 * 3 + k] + L.nor[i1 * 3 + k] + L.nor[i2 * 3 + k]);
      if (fn[0] * vn[0] + fn[1] * vn[1] + fn[2] * vn[2] < 0) {
        L.idx[t + 1] = i2;
        L.idx[t + 2] = i1;
      }
    }
  }

  /** A beam of cross-section w × h from world point a to b (its h side kept as upright as it can be). */
  beam(m: Mat, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number): void {
    const L = this.get(m);
    const ax = new THREE.Vector3().subVectors(b, a);
    const len = ax.length();
    if (len < 1e-4) return;
    ax.divideScalar(len);
    const up = Math.abs(ax.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(ax, up).normalize();
    const vert = new THREE.Vector3().crossVectors(side, ax).normalize();
    const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    // Faces: normal, and the two in-plane half extents.
    const faces: [THREE.Vector3, THREE.Vector3, number, THREE.Vector3, number, number][] = [
      [side, ax, len / 2, vert, h / 2, w / 2],
      [side.clone().negate(), vert, h / 2, ax, len / 2, w / 2],
      [vert, side, w / 2, ax, len / 2, h / 2],
      [vert.clone().negate(), ax, len / 2, side, w / 2, h / 2],
      [ax, vert, h / 2, side, w / 2, len / 2],
      [ax.clone().negate(), side, w / 2, vert, h / 2, len / 2],
    ];
    for (const [n, A, ha, Bv, hb, off] of faces) {
      const base = L.pos.length / 3;
      const c = mid.clone().addScaledVector(n, off);
      for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = c.clone().addScaledVector(A, ha * sa).addScaledVector(Bv, hb * sb);
        L.pos.push(p.x, p.y, p.z);
        L.nor.push(n.x, n.y, n.z);
        L.uv.push((sa + 1) / 2, (sb + 1) / 2);
      }
      // Wind so the face points along n.
      const e1 = A.clone().multiplyScalar(ha * 2);
      const e2 = A.clone().multiplyScalar(ha * 2).addScaledVector(Bv, hb * 2);
      if (new THREE.Vector3().crossVectors(e1, e2).dot(n) >= 0) L.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else L.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }

  /** Raw triangles (world space, with normals and uvs), e.g. slabs or sign quads. */
  raw(m: Mat, pos: number[], nor: number[], uv: number[], idx?: number[]): void {
    const L = this.get(m);
    const base = L.pos.length / 3;
    L.pos.push(...pos);
    L.nor.push(...nor);
    L.uv.push(...uv);
    if (idx) for (const i of idx) L.idx.push(base + i);
    else for (let i = 0; i < pos.length / 3; i += 1) L.idx.push(base + i);
  }

  build(group: THREE.Group, mats: Record<string, THREE.Material>, prefix: string): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    const it = this.buildSteps(group, mats, prefix, out);
    while (!it.next().done) {
      // All at once (the world's shells, built during loading).
    }
    return out;
  }

  /**
   * build(), a material list at a time with a yield after each: an interior streamed in over several
   * frames (interior.ts) otherwise merged the whole building in its last slice, 30-50 ms for a hostel block.
   */
  *buildSteps(group: THREE.Group, mats: Record<string, THREE.Material>, prefix: string, out: THREE.Mesh[]): Generator<void, void, void> {
    // Plain colours (no texture, no glow, opaque) share two vertex-coloured materials, matte and
    // metal, so a furnished building is a handful of draw calls instead of one per colour.
    const merged = new Map<'matte' | 'metal', { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] }>();
    const emit = (k: string, l: { pos: number[]; nor: number[]; uv: number[]; idx: number[] }, mat: THREE.Material, col?: number[]) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(l.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(l.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(l.uv, 2));
      if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const n = l.pos.length / 3;
      g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(l.idx, 1) : new THREE.Uint16BufferAttribute(l.idx, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = k !== 'light' && k !== 'glass' && k !== 'sign';
      m.receiveShadow = true;
      m.name = `${prefix}-${k}`;
      group.add(m);
      out.push(m);
    };
    for (const [k, l] of this.lists) {
      if (!l.idx.length) continue;
      const mat = mats[k];
      const std = mat as THREE.MeshStandardMaterial;
      const plain = std.isMeshStandardMaterial && !std.map && !std.transparent && !std.vertexColors && !POWERED.some((x) => x.m === std) && std.visible;
      if (!plain) {
        emit(k, l, mat);
        yield;
        continue;
      }
      const key = std.metalness > 0.3 ? 'metal' : 'matte';
      let t = merged.get(key);
      if (!t) merged.set(key, (t = { pos: [], nor: [], uv: [], col: [], idx: [] }));
      const base = t.pos.length / 3;
      for (let i = 0; i < l.pos.length; i += 1) t.pos.push(l.pos[i]);
      for (let i = 0; i < l.nor.length; i += 1) t.nor.push(l.nor[i]);
      for (let i = 0; i < l.uv.length; i += 1) t.uv.push(l.uv[i]);
      const c = std.color;
      for (let i = 0; i < l.pos.length / 3; i += 1) t.col.push(c.r, c.g, c.b);
      for (let i = 0; i < l.idx.length; i += 1) t.idx.push(l.idx[i] + base);
      yield;
    }
    for (const [key, t] of merged) {
      emit(key, t, sharedMat(key), t.col);
      yield;
    }
    this.lists.clear();
  }
}

const SHARED: Partial<Record<'matte' | 'metal', THREE.MeshStandardMaterial>> = {};
function sharedMat(k: 'matte' | 'metal'): THREE.MeshStandardMaterial {
  return (SHARED[k] ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: k === 'metal' ? 0.4 : 0.78, metalness: k === 'metal' ? 0.65 : 0 }));
}

/** The shared materials too (for the shader warm-up). */
export function allInteriorMaterials(): THREE.Material[] {
  return [...Object.values(palette()), sharedMat('matte'), sharedMat('metal')];
}

/** Materials whose texture repeats every N metres (others map 0..1 on each face). */
const METRIC: Partial<Record<Mat, number>> = { floor: 2, tile: 0.9, wood: 1.2, darkwood: 1.2, plywood: 1.2, concrete: 2, brick: 1.2, wall: 3 };

// ==================================================================== materials

let PALETTE: Record<Mat, THREE.Material> | null = null;
/** Materials whose glow follows the campus power (see `setInteriorPower`). */
const POWERED: { m: THREE.MeshStandardMaterial; on: number; off: number }[] = [];

export function palette(): Record<Mat, THREE.Material> {
  if (PALETTE) return PALETTE;
  const std = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
  const glow = (m: THREE.MeshStandardMaterial, on: number, off: number) => {
    m.emissive = m.emissive.getHex() ? m.emissive : m.color.clone();
    m.emissiveIntensity = on;
    POWERED.push({ m, on, off });
    return m;
  };
  PALETTE = {
    floor: std('#ffffff', { map: floorTexture(), roughness: 0.55 }),
    // Interiors sit in the roof's shadow: a soft glow stands in for the room lighting.
    ceiling: glow(std('#f4f2ec', { roughness: 0.95, side: THREE.DoubleSide }), 0.32, 0.06),
    wall: glow(std('#ece4d2', { roughness: 0.92 }), 0.14, 0.03),
    stair: glow(std('#b7b0a4', { roughness: 0.85 }), 0.18, 0.04),
    rail: std('#3c3f42', { roughness: 0.4, metalness: 0.7 }),
    frame: std('#6a4a30', { roughness: 0.7 }),
    reveal: std('#e6dfcf', { roughness: 0.9 }),
    sill: std('#a7a196', { roughness: 0.75 }),
    parapet: std('#e9e3d3', { roughness: 0.9 }),
    // Clear window glass: a faint blue-grey tint, see-through both ways.
    glass: new THREE.MeshStandardMaterial({ color: '#6c838b', roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.3, depthWrite: false }),
    tile: std('#ffffff', { map: tileTexture(), roughness: 0.3 }),
    concrete: std('#a9a59c', { roughness: 0.95 }),
    brick: std('#a4553d', { roughness: 0.9 }),
    wood: std('#8a5e3b', { roughness: 0.65 }),
    darkwood: std('#5a3b24', { roughness: 0.6 }),
    plywood: std('#c49a6c', { roughness: 0.7 }),
    metal: std('#7d8286', { roughness: 0.45, metalness: 0.6 }),
    steel: std('#9aa0a6', { roughness: 0.3, metalness: 0.85 }),
    chrome: std('#d8dde2', { roughness: 0.15, metalness: 1 }),
    machine: std('#4f6f5e', { roughness: 0.5, metalness: 0.3 }),
    machineDark: std('#2f3a36', { roughness: 0.55, metalness: 0.4 }),
    yellow: std('#e0b21f', { roughness: 0.55 }),
    red: std('#b3271e', { roughness: 0.5 }),
    orange: std('#d96b1c', { roughness: 0.55 }),
    blue: std('#2c5d9c', { roughness: 0.6 }),
    green: std('#3f7a3a', { roughness: 0.7 }),
    cream: std('#efe6cf', { roughness: 0.85 }),
    white: std('#f5f5f2', { roughness: 0.5 }),
    black: std('#1c1d1f', { roughness: 0.5 }),
    rubber: std('#151515', { roughness: 0.9 }),
    fabric: std('#7b8fa6', { roughness: 0.95 }),
    mattress: std('#e8e2d2', { roughness: 0.95 }),
    pillow: std('#f6f3ea', { roughness: 0.95 }),
    cushion: std('#8c2f2f', { roughness: 0.9 }),
    chair: std('#2d4a6b', { roughness: 0.7 }),
    paper: std('#f4f1e8', { roughness: 0.9 }),
    books: std('#ffffff', { map: booksTexture(), roughness: 0.8 }),
    board: std('#f7f7f2', { roughness: 0.3 }),
    greenboard: std('#ffffff', { map: chalkTexture(), roughness: 0.85 }),
    screen: glow(std('#15181c', { roughness: 0.25, metalness: 0.2, emissive: '#29486b' }), 0.55, 0),
    light: glow(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc' }), 1.6, 0.05),
    plant: std('#3d7a2c', { roughness: 0.85 }),
    soil: std('#4a3626', { roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: '#3b6f8a', roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.7 }),
    sign: std('#7a1f1f'),
    none: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return PALETTE;
}

/** 0 = blackout, 1 = power on: dims room lights, screens and the fill glow. */
export function setInteriorPower(p: number): void {
  for (const { m, on, off } of POWERED) m.emissiveIntensity = off + (on - off) * p;
}

function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d', { willReadFrequently: true })!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function floorTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (x) => {
    x.fillStyle = '#c9c2b4';
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2; i += 1) for (let j = 0; j < 2; j += 1) {
      x.fillStyle = (i + j) % 2 ? '#c4bdaf' : '#cec7ba';
      x.fillRect(i * 64 + 1, j * 64 + 1, 62, 62);
    }
  });
}

function tileTexture(): THREE.CanvasTexture {
  return canvasTex(128, 128, (x) => {
    x.fillStyle = '#b9bdbd';
    x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 4; i += 1) for (let j = 0; j < 4; j += 1) {
      x.fillStyle = (i * 7 + j * 3) % 5 ? '#eef0ee' : '#e6eae8';
      x.fillRect(i * 32 + 1, j * 32 + 1, 30, 30);
    }
  });
}

function booksTexture(): THREE.CanvasTexture {
  // Five shelves of spines, top to bottom.
  const r = seeded(77);
  const cols = ['#7a1f1f', '#1f3f7a', '#2f5d2a', '#7a5a1f', '#3a2a5a', '#b8a27a', '#1c1c1c', '#8a3a12', '#2a6a6a', '#d8cfb8'];
  return canvasTex(256, 256, (x) => {
    x.fillStyle = '#3e2a1a';
    x.fillRect(0, 0, 256, 256);
    for (let s = 0; s < 5; s += 1) {
      const top = s * 51 + 4;
      let px = 2;
      while (px < 252) {
        const w = 4 + Math.floor(r() * 7);
        const h = 34 + Math.floor(r() * 12);
        x.fillStyle = cols[Math.floor(r() * cols.length)];
        x.fillRect(px, top + 45 - h, Math.min(w, 254 - px), h);
        x.fillStyle = 'rgba(255,255,255,0.18)';
        x.fillRect(px + 1, top + 45 - h + 6, Math.max(1, w - 3), 2);
        px += w + (r() < 0.08 ? 6 : 1);
      }
      x.fillStyle = '#5a3b24';
      x.fillRect(0, top + 45, 256, 6);
    }
  });
}

function chalkTexture(): THREE.CanvasTexture {
  const r = seeded(11);
  return canvasTex(256, 128, (x) => {
    x.fillStyle = '#2c4636';
    x.fillRect(0, 0, 256, 128);
    x.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 40; i += 1) x.fillRect(r() * 256, r() * 128, 30 + r() * 60, 6 + r() * 14);
    x.strokeStyle = 'rgba(240,240,230,0.75)';
    x.lineWidth = 2;
    x.font = '16px "Segoe UI", Arial, sans-serif';
    x.fillStyle = 'rgba(240,240,230,0.8)';
    x.fillText('V = I × R', 20, 34);
    x.fillText('∫ f(x) dx', 20, 62);
    x.beginPath();
    x.moveTo(150, 90);
    x.lineTo(190, 30);
    x.lineTo(230, 90);
    x.closePath();
    x.stroke();
    x.strokeStyle = '#8a6a4a';
    x.lineWidth = 6;
    x.strokeRect(0, 0, 256, 128);
  });
}
