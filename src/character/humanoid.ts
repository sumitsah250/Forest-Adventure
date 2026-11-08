// Procedural humanoid: one skinned mesh lofted from anatomical cross-sections
// around a 22-bone skeleton, dressed per outfit (ranger uniform, poachers' work
// clothes). Built once per outfit; every character instance gets its own skeleton
// and shares the geometry and materials.
//
// Character space: metres, Y up, the body faces +Z, its left side is +X.
// In the bind pose every limb hangs straight down, so each limb bone's length
// axis is -Y and its +Z axis is the front of the limb. The animator relies on that.

import * as THREE from 'three';
import { HEAD_C, beardTexture, faceTexture, hairCardTexture, hairNormal, headSurface, sculpt, tuft, type HeadStyle } from './head.ts';

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head',
  'shoulder.L', 'upperArm.L', 'foreArm.L', 'hand.L',
  'shoulder.R', 'upperArm.R', 'foreArm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L', 'toe.L',
  'thigh.R', 'shin.R', 'foot.R', 'toe.R',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
  'shoulder.L': 'chest', 'upperArm.L': 'shoulder.L', 'foreArm.L': 'upperArm.L', 'hand.L': 'foreArm.L',
  'shoulder.R': 'chest', 'upperArm.R': 'shoulder.R', 'foreArm.R': 'upperArm.R', 'hand.R': 'foreArm.R',
  'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'toe.L': 'foot.L',
  'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R', 'toe.R': 'foot.R',
};

/** Joint positions in the bind pose (character space) for a 1.80 m adult. */
const JOINTS: Record<BoneName, [number, number, number]> = {
  root: [0, 0, 0],
  hips: [0, 0.97, 0],
  spine: [0, 1.08, -0.01],
  chest: [0, 1.27, -0.01],
  neck: [0, 1.5, -0.005],
  head: [0, 1.6, 0.015],
  'shoulder.L': [0.05, 1.45, -0.02],
  'upperArm.L': [0.195, 1.445, -0.02],
  'foreArm.L': [0.205, 1.165, -0.02],
  'hand.L': [0.21, 0.915, -0.012],
  'shoulder.R': [-0.05, 1.45, -0.02],
  'upperArm.R': [-0.195, 1.445, -0.02],
  'foreArm.R': [-0.205, 1.165, -0.02],
  'hand.R': [-0.21, 0.915, -0.012],
  'thigh.L': [0.09, 0.935, 0],
  'shin.L': [0.092, 0.505, 0.004],
  'foot.L': [0.094, 0.085, -0.012],
  'toe.L': [0.094, 0.025, 0.13],
  'thigh.R': [-0.09, 0.935, 0],
  'shin.R': [-0.092, 0.505, 0.004],
  'foot.R': [-0.094, 0.085, -0.012],
  'toe.R': [-0.094, 0.025, 0.13],
};

export const BIND_JOINTS = JOINTS;
export const BONE_PARENT = PARENT;
const BI: Record<BoneName, number> = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

export interface Outfit {
  id: string;
  skin: string;
  hair: string;
  top: string;
  topPattern: 'twill' | 'camo' | 'plaid' | 'knit' | 'canvas' | 'check';
  trousers: string;
  trouserPattern: 'twill' | 'denim' | 'canvas' | 'check';
  boots: string;
  headwear: 'cap' | 'beanie' | 'none';
  headwearColor: string;
  headwearPattern?: 'camo';
  beard: boolean;
  /** Ranger extras: badge, shoulder patch, chest pockets, radio. */
  uniform: boolean;
  backpack: string | null;
  vest: string | null;
  /** Business suit: lapels, white shirt, buttons, polished shoes, styled hair. */
  suit?: boolean;
  /** Female build: narrower shoulders and waist, softer jaw, no beard. */
  female?: boolean;
  /** Default: 'swept' with a suit, otherwise 'short'. */
  hairStyle?: 'short' | 'swept' | 'textured' | 'long' | 'ponytail' | 'bun' | 'bald';
}

export const RANGER: Outfit = {
  id: 'ranger', skin: '#b98a70', hair: '#3a2a1e',
  top: '#5e6248', topPattern: 'twill', trousers: '#3f4536', trouserPattern: 'twill', boots: '#4a3326',
  headwear: 'cap', headwearColor: '#3d4935', beard: false, uniform: true, backpack: '#55513f', vest: null,
};

/**
 * The player: navy two-button check suit, white open-collar shirt, black cap-toe oxfords,
 * textured wavy hair swept to one side, full short beard.
 */
export const PLAYER_SUIT: Outfit = {
  id: 'player-suit', skin: '#a97b63', hair: '#261c16',
  top: '#2a3550', topPattern: 'check', trousers: '#2a3550', trouserPattern: 'check', boots: '#0e0e0f',
  headwear: 'none', headwearColor: '#000', beard: true, uniform: false, backpack: null, vest: null, suit: true,
  hairStyle: 'textured',
};

export const POACHER_OUTFITS: Outfit[] = [
  {
    id: 'kessler', skin: '#b98468', hair: '#4a3a2c',
    top: '#4d3d2b', topPattern: 'canvas', trousers: '#33405a', trouserPattern: 'denim', boots: '#2f241c',
    headwear: 'cap', headwearColor: '#59563c', headwearPattern: 'camo', beard: true, uniform: false, backpack: null, vest: null,
  },
  {
    id: 'camo', skin: '#c99a7c', hair: '#2a211b',
    top: '#59573e', topPattern: 'camo', trousers: '#4a3f31', trouserPattern: 'canvas', boots: '#3a2c20',
    headwear: 'beanie', headwearColor: '#1f2020', beard: false, uniform: false, backpack: null, vest: null,
  },
  {
    id: 'hoodie', skin: '#a8765a', hair: '#1d1712',
    top: '#555a5e', topPattern: 'knit', trousers: '#4b4d38', trouserPattern: 'canvas', boots: '#2b231d',
    headwear: 'cap', headwearColor: '#1e1f20', beard: true, uniform: false, backpack: null, vest: '#2d3226',
  },
  {
    id: 'flannel', skin: '#d0a083', hair: '#5a4632',
    top: '#7a2f28', topPattern: 'plaid', trousers: '#2e3a4f', trouserPattern: 'denim', boots: '#3b2b1f',
    headwear: 'beanie', headwearColor: '#3c3a2c', beard: true, uniform: false, backpack: null, vest: null,
  },
];

// ------------------------------------------------------------------ textures

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return [c, c.getContext('2d', { willReadFrequently: true })!];
}

function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Height map → tangent-space normal map. */
function heightToNormal(h: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      const n = new THREE.Vector3((l - r) * strength, (d - u) * strength, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const texCache = new Map<string, THREE.Texture>();

/** Woven fabric relief: twill diagonals, plain-weave knit rows or coarse canvas. */
function fabricNormal(kind: string): THREE.Texture {
  const key = `n-${kind}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 128;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      let v = 0;
      if (kind === 'twill' || kind === 'denim') v = Math.sin(((x + y) / S) * Math.PI * 2 * 12) * 0.5 + 0.5;
      else if (kind === 'knit') v = Math.abs(Math.sin((x / S) * Math.PI * 22)) * (0.6 + 0.4 * Math.sin((y / S) * Math.PI * 2 * 18));
      else v = (Math.sin((x / S) * Math.PI * 2 * 20) + Math.sin((y / S) * Math.PI * 2 * 20)) * 0.25 + 0.5;
      v += (hash(x, y, 7) - 0.5) * 0.35;
      h[y * S + x] = v;
    }
  }
  const t = heightToNormal(h, S, kind === 'knit' ? 1.6 : 0.9);
  texCache.set(key, t);
  return t;
}

/** Colour patterns: woodland camo, red-black plaid, faded denim, mottled canvas. */
function patternMap(kind: string, base: string): THREE.Texture | null {
  if (kind === 'twill' || kind === 'knit') return null;
  const key = `c-${kind}-${base}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const S = 256;
  const [c, ctx] = canvas(S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  if (kind === 'camo') {
    const cols = ['#3d3a28', '#6b6445', '#2a2a22', '#55603c'];
    for (let i = 0; i < 70; i += 1) {
      ctx.fillStyle = cols[i % cols.length];
      const x = hash(i, 1, 3) * S;
      const y = hash(i, 2, 3) * S;
      ctx.beginPath();
      for (let k = 0; k < 9; k += 1) {
        const a = (k / 9) * Math.PI * 2;
        const r = 8 + hash(i, k, 5) * 22;
        const px = x + Math.cos(a) * r * 1.4;
        const py = y + Math.sin(a) * r * 0.8;
        // Wrap blobs so the tile is seamless.
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      for (const [ox, oy] of [[S, 0], [-S, 0], [0, S], [0, -S]]) {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.fill();
        ctx.restore();
      }
    }
  } else if (kind === 'plaid') {
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#1a1414';
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(i * 64 + 6, 0, 26, S);
      ctx.fillRect(0, i * 64 + 6, S, 26);
    }
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#c9b48a';
    for (let i = 0; i < 4; i += 1) {
      ctx.fillRect(i * 64 + 44, 0, 3, S);
      ctx.fillRect(0, i * 64 + 44, S, 3);
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'check') {
    // Suiting cloth: a fine heathered weave with a faint lighter check.
    const img = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < S * S; i += 1) {
      const x = i % S;
      const y = Math.floor(i / S);
      const n = 0.9 + 0.2 * hash(x, y, 23) + 0.05 * Math.sin((x - y) * 1.6);
      const line = x % 32 < 1 || y % 32 < 1 ? 1.035 : 1;
      img.data[i * 4] = Math.min(255, img.data[i * 4] * n * line);
      img.data[i * 4 + 1] = Math.min(255, img.data[i * 4 + 1] * n * line);
      img.data[i * 4 + 2] = Math.min(255, img.data[i * 4 + 2] * n * line * 1.03);
    }
    ctx.putImageData(img, 0, 0);
  } else if (kind === 'denim') {
    const img = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < S * S; i += 1) {
      const x = i % S;
      const y = Math.floor(i / S);
      const n = 0.85 + 0.3 * hash(x, y >> 1, 11) + 0.1 * Math.sin((x + y) * 0.8);
      img.data[i * 4] *= n;
      img.data[i * 4 + 1] *= n;
      img.data[i * 4 + 2] *= n * 1.05;
    }
    ctx.putImageData(img, 0, 0);
  } else {
    // Canvas / work-wear: worn, mottled.
    const img = ctx.getImageData(0, 0, S, S);
    for (let i = 0; i < S * S; i += 1) {
      const x = i % S;
      const y = Math.floor(i / S);
      const n = 0.88 + 0.18 * hash(x >> 3, y >> 3, 13) + 0.08 * hash(x, y, 17);
      img.data[i * 4] *= n;
      img.data[i * 4 + 1] *= n;
      img.data[i * 4 + 2] *= n;
    }
    ctx.putImageData(img, 0, 0);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  texCache.set(key, t);
  return t;
}

// ------------------------------------------------------------------ geometry

type Weights = [BoneName, number][];

interface Ring {
  c: [number, number, number];
  a: number;
  b: number;
  w: Weights;
  /** Vertex colour multiplier for this ring. */
  shade?: number;
}

interface LoftOptions {
  axis: 'y' | 'z' | 'x';
  radial: number;
  /** Superellipse exponent (2 = ellipse, larger = boxier). */
  p?: number;
  capStart?: boolean;
  capEnd?: boolean;
  /** Metres per texture repeat. */
  tile?: number;
  /** Optional angular range (open surface), radians. */
  arc?: [number, number];
}

const MATS = ['skin', 'top', 'trousers', 'boots', 'hair', 'headwear', 'leather', 'dark', 'gear', 'eyes', 'badge', 'shirt', 'face', 'sclera', 'hairCard', 'beard'] as const;
type MatName = (typeof MATS)[number];

class SkinBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  idx: Record<MatName, number[]> = Object.fromEntries(MATS.map((m) => [m, []])) as unknown as Record<MatName, number[]>;
  private seams: [number, number][] = [];

  private vert(p: THREE.Vector3, u: number, v: number, w: Weights, shade: number): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(0, 1, 0);
    this.uv.push(u, v);
    this.col.push(shade, shade, shade);
    const ws = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = ws.reduce((s, e) => s + e[1], 0) || 1;
    for (let k = 0; k < 4; k += 1) {
      this.si.push(ws[k] ? BI[ws[k][0]] : 0);
      this.sw.push(ws[k] ? ws[k][1] / total : 0);
    }
    return this.pos.length / 3 - 1;
  }

  loft(mat: MatName, rings: Ring[], o: LoftOptions): void {
    const n = o.radial;
    const p = o.p ?? 2;
    const tile = o.tile ?? 0.22;
    const [t0, t1] = o.arc ?? [0, Math.PI * 2];
    const closed = !o.arc;
    const ringPts: THREE.Vector3[][] = [];
    for (const r of rings) {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= n; k += 1) {
        const th = t0 + ((t1 - t0) * k) / n;
        const cs = Math.cos(th);
        const sn = Math.sin(th);
        const x = r.a * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / p);
        const y = r.b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / p);
        const v = new THREE.Vector3(...r.c);
        if (o.axis === 'y') v.add(new THREE.Vector3(x, 0, y));
        else if (o.axis === 'z') v.add(new THREE.Vector3(x, y, 0));
        else v.add(new THREE.Vector3(0, y, x));
        pts.push(v);
      }
      ringPts.push(pts);
    }
    // Arc length along the loft for v coordinates.
    const vlen: number[] = [0];
    for (let i = 1; i < rings.length; i += 1) vlen.push(vlen[i - 1] + new THREE.Vector3(...rings[i].c).distanceTo(new THREE.Vector3(...rings[i - 1].c)));
    const circ = Math.PI * (rings.reduce((s, r) => s + r.a + r.b, 0) / rings.length);
    const uRep = Math.max(1, Math.round(circ / tile));
    const base = this.pos.length / 3;
    rings.forEach((r, i) => {
      for (let k = 0; k <= n; k += 1) this.vert(ringPts[i][k], (k / n) * uRep, vlen[i] / tile, r.w, r.shade ?? 1);
    });
    if (closed) for (let i = 0; i < rings.length; i += 1) this.seams.push([base + i * (n + 1), base + i * (n + 1) + n]);
    // Winding: pick the orientation whose first face points away from the ring centre.
    const list = this.idx[mat];
    const a0 = ringPts[0][0];
    const b0 = ringPts[0][1];
    const c0 = ringPts[1][0];
    const fn = new THREE.Vector3().crossVectors(b0.clone().sub(a0), c0.clone().sub(a0));
    const out = a0.clone().sub(new THREE.Vector3(...rings[0].c));
    const flip = fn.dot(out) < 0;
    for (let i = 0; i < rings.length - 1; i += 1) {
      for (let k = 0; k < n; k += 1) {
        const a = base + i * (n + 1) + k;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        if (flip) list.push(a, c, b, b, c, d);
        else list.push(a, b, c, b, d, c);
      }
    }
    // Caps with their own vertices (flat shading at the rim).
    const cap = (ri: number, end: boolean) => {
      const r = rings[ri];
      const centre = new THREE.Vector3(...r.c);
      const ci = this.vert(centre, 0.5, 0.5, r.w, r.shade ?? 1);
      const start = this.pos.length / 3;
      for (let k = 0; k <= n; k += 1) this.vert(ringPts[ri][k], 0.5 + Math.cos((k / n) * 6.28) * 0.5, 0.5 + Math.sin((k / n) * 6.28) * 0.5, r.w, r.shade ?? 1);
      for (let k = 0; k < n; k += 1) {
        const x = start + k;
        const y = start + k + 1;
        const forward = end !== flip;
        if (forward) list.push(ci, x, y);
        else list.push(ci, y, x);
      }
    };
    if (o.capStart) cap(0, false);
    if (o.capEnd) cap(rings.length - 1, true);
  }

  /** Small rigid box (pockets, buckles, radio) weighted to one bone. */
  box(mat: MatName, c: [number, number, number], size: [number, number, number], bone: BoneName, rotY = 0, shade = 1): void {
    const g = new THREE.BoxGeometry(...size);
    g.rotateY(rotY);
    g.translate(...c);
    this.addGeometry(mat, g, [[bone, 1]], shade);
  }

  sphere(mat: MatName, c: [number, number, number], r: [number, number, number], bone: BoneName, seg = 10, shade = 1): void {
    const g = new THREE.SphereGeometry(1, seg, Math.max(6, seg - 2));
    g.scale(...r);
    g.translate(...c);
    this.addGeometry(mat, g, [[bone, 1]], shade);
  }

  addGeometry(mat: MatName, g: THREE.BufferGeometry, w: Weights | ((p: THREE.Vector3) => Weights), shade = 1): void {
    const gi = g.index ? g : g;
    const pos = gi.getAttribute('position') as THREE.BufferAttribute;
    const uv = gi.getAttribute('uv') as THREE.BufferAttribute | undefined;
    // An optional per-vertex shade (ambient occlusion) rides in the geometry's colour attribute.
    const col = gi.getAttribute('color') as THREE.BufferAttribute | undefined;
    const base = this.pos.length / 3;
    for (let i = 0; i < pos.count; i += 1) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      this.vert(p, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, typeof w === 'function' ? w(p) : w, shade * (col ? col.getX(i) : 1));
    }
    const list = this.idx[mat];
    if (gi.index) for (let i = 0; i < gi.index.count; i += 1) list.push(base + gi.index.getX(i));
    else for (let i = 0; i < pos.count; i += 1) list.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    const all: number[] = [];
    let start = 0;
    MATS.forEach((m, i) => {
      const list = this.idx[m];
      if (!list.length) return;
      all.push(...list);
      g.addGroup(start, list.length, i);
      start += list.length;
    });
    g.setIndex(all);
    g.computeVertexNormals();
    // Average normals across the duplicated seam vertices of closed lofts.
    const nor = g.getAttribute('normal') as THREE.BufferAttribute;
    for (const [a, b] of this.seams) {
      const x = (nor.getX(a) + nor.getX(b)) / 2;
      const y = (nor.getY(a) + nor.getY(b)) / 2;
      const z = (nor.getZ(a) + nor.getZ(b)) / 2;
      const l = Math.hypot(x, y, z) || 1;
      nor.setXYZ(a, x / l, y / l, z / l);
      nor.setXYZ(b, x / l, y / l, z / l);
    }
    g.computeBoundingSphere();
    return g;
  }
}

/** Linear blend between two bones as y moves from y0 (all `a`) to y1 (all `b`). */
function blend(y: number, y0: number, y1: number, a: BoneName, b: BoneName): Weights {
  const t = THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
  const s = t * t * (3 - 2 * t);
  if (s <= 0.001) return [[a, 1]];
  if (s >= 0.999) return [[b, 1]];
  return [[a, 1 - s], [b, s]];
}

function buildGeometry(o: Outfit): THREE.BufferGeometry {
  const sb = new SkinBuilder();
  // Torso (shirt or jacket), crotch to neck base.
  const torso: [number, number, number, number][] = [
    // y, half-width, half-depth, z centre
    [0.86, 0.105, 0.085, 0],
    [0.9, 0.158, 0.108, -0.004],
    [0.97, 0.17, 0.116, -0.008],
    [1.04, 0.16, 0.11, -0.006],
    [1.12, 0.164, 0.114, -0.002],
    [1.22, 0.177, 0.123, 0.004],
    [1.32, 0.19, 0.128, 0.006],
    [1.4, 0.198, 0.12, -0.002],
    [1.435, 0.199, 0.108, -0.01],
    [1.46, 0.178, 0.098, -0.012],
    [1.485, 0.14, 0.09, -0.013],
    [1.508, 0.098, 0.079, -0.014],
    [1.535, 0.062, 0.064, -0.01],
  ];
  const torsoW = (y: number): Weights => {
    if (y < 1.0) return [['hips', 1]];
    if (y < 1.16) return blend(y, 1.0, 1.16, 'hips', 'spine');
    if (y < 1.3) return blend(y, 1.16, 1.3, 'spine', 'chest');
    if (y < 1.49) return [['chest', 1]];
    return blend(y, 1.49, 1.54, 'chest', 'neck');
  };
  if (o.female) {
    // Same skeleton, different silhouette: fuller hips, a defined waist, a softer chest
    // and slightly narrower shoulders.
    const shape: Record<string, [number, number]> = {
      '1.04': [0.95, 0.96], '1.12': [0.9, 0.94],
      '1.22': [0.9, 1.04], '1.32': [0.92, 1.12], '1.4': [0.93, 1.06], '1.435': [0.93, 1.0], '1.46': [0.94, 1.0],
    };
    for (const r of torso) {
      const k = shape[String(r[0])];
      if (k) {
        r[1] *= k[0];
        r[2] *= k[1];
      }
    }
  }
  sb.loft('top', torso.map(([y, a, b, z]) => ({ c: [0, y, z], a, b, w: torsoW(y), shade: y < 0.9 ? 0.8 : 1 })), { axis: 'y', radial: 24, p: 2.4, capStart: true, tile: 0.2 });
  // Hood (hoodie) or collar.
  if (o.topPattern === 'knit') {
    sb.loft('top', [
      { c: [0, 1.47, -0.07], a: 0.15, b: 0.07, w: [['chest', 1]] },
      { c: [0, 1.53, -0.09], a: 0.13, b: 0.06, w: [['chest', 0.6], ['neck', 0.4]] },
      { c: [0, 1.56, -0.1], a: 0.09, b: 0.035, w: [['neck', 1]] },
    ], { axis: 'y', radial: 12, arc: [Math.PI * 0.95, Math.PI * 2.05], tile: 0.2 });
  } else {
    sb.loft(o.suit ? 'shirt' : 'top', [
      { c: [0, 1.5, -0.012], a: 0.085, b: 0.075, w: [['chest', 0.5], ['neck', 0.5]] },
      { c: [0, 1.555, -0.014], a: 0.07, b: 0.068, w: [['neck', 1]] },
    ], { axis: 'y', radial: 14, tile: 0.2 });
  }
  if (o.vest) {
    sb.loft('gear', torso.slice(2, 9).map(([y, a, b, z]) => ({ c: [0, y, z], a: a + 0.012, b: b + 0.012, w: torsoW(y) })), { axis: 'y', radial: 18, p: 2.6, tile: 0.2 });
  }
  // Trouser seat over the pelvis, so the top never shows between the legs below the belt.
  sb.loft('trousers', [0, 1, 2, 2].map((i, k) => {
    const [y0, a, b, z] = torso[i];
    const y = k === 3 ? 0.995 : y0; // waistband, under the belt
    return { c: [0, y, z] as [number, number, number], a: a + 0.005, b: b + 0.005, w: torsoW(y), shade: i === 0 ? 0.85 : 1 };
  }), { axis: 'y', radial: 24, p: 2.4, capStart: true, tile: 0.2 });
  // Legs (trousers) and boots, both sides.
  for (const side of [1, -1] as const) {
    const L = side > 0 ? '.L' : '.R';
    const thigh = `thigh${L}` as BoneName;
    const shin = `shin${L}` as BoneName;
    const foot = `foot${L}` as BoneName;
    const toe = `toe${L}` as BoneName;
    const leg: [number, number, number, number, number][] = [
      // y, x, half-width, half-depth, z
      [0.97, 0.082, 0.086, 0.1, -0.004],
      [0.88, 0.088, 0.084, 0.092, 0],
      [0.76, 0.09, 0.075, 0.081, 0.004],
      [0.63, 0.091, 0.064, 0.069, 0.006],
      [0.53, 0.092, 0.057, 0.06, 0.008],
      [0.45, 0.092, 0.058, 0.064, -0.004],
      [0.33, 0.093, 0.053, 0.057, -0.006],
      [0.21, 0.094, 0.047, 0.049, -0.008],
      [0.13, 0.094, 0.051, 0.055, -0.008],
    ];
    const legW = (y: number): Weights => {
      if (y > 0.93) return [['hips', 0.35], [thigh, 0.65]];
      if (y > 0.6) return [[thigh, 1]];
      if (y > 0.45) return blend(y, 0.6, 0.45, thigh, shin);
      return [[shin, 1]];
    };
    sb.loft('trousers', leg.map(([y, x, a, b, z]) => ({ c: [x * side, y, z], a, b, w: legW(y) })), { axis: 'y', radial: 14, tile: 0.2 });
    // Boot shaft.
    sb.loft(o.suit ? 'dark' : 'boots', [
      { c: [0.094 * side, 0.035, -0.008], a: 0.055, b: 0.064, w: [[foot, 1]] },
      { c: [0.094 * side, 0.1, -0.008], a: 0.053, b: 0.058, w: [[foot, 0.6], [shin, 0.4]] },
      { c: [0.094 * side, 0.175, -0.008], a: 0.052, b: 0.056, w: [[shin, 1]] },
    ], { axis: 'y', radial: 12, capEnd: false, tile: 0.15 });
    // Boot foot (lofted heel to toe), with a darker sole line.
    const footRings: [number, number, number, number][] = [
      // z, y centre, half-width, half-height
      [-0.082, 0.05, 0.04, 0.046],
      [-0.05, 0.056, 0.048, 0.056],
      [0.01, 0.054, 0.053, 0.054],
      [0.08, 0.044, 0.055, 0.044],
      [0.14, 0.037, 0.051, 0.037],
      [0.185, 0.031, 0.04, 0.03],
      [0.205, 0.028, 0.022, 0.02],
    ];
    const footW = (z: number): Weights => (z < 0.06 ? [[foot, 1]] : z < 0.12 ? blend(z, 0.06, 0.12, foot, toe) : [[toe, 1]]);
    sb.loft('boots', footRings.map(([z, y, a, b]) => ({ c: [0.094 * side, y, z], a, b, w: footW(z) })), { axis: 'z', radial: 14, p: 2.6, capStart: true, capEnd: true, tile: 0.12 });
    sb.box('dark', [0.094 * side, 0.008, 0.06], [0.104, 0.016, 0.29], foot, 0, 0.9);
    // Arms: sleeves.
    const upper = `upperArm${L}` as BoneName;
    const fore = `foreArm${L}` as BoneName;
    const hand = `hand${L}` as BoneName;
    const shoulder = `shoulder${L}` as BoneName;
    const arm: [number, number, number, number, number][] = [
      // y, x, half-width (x), half-depth (z), z
      // Rounded shoulder: ring centres move outward as they drop, so the sleeve's outer
      // edge follows the curve of the deltoid instead of making a flat shelf.
      [1.46, 0.184, 0.012, 0.02, -0.02],
      [1.453, 0.189, 0.027, 0.036, -0.02],
      [1.443, 0.193, 0.04, 0.048, -0.02],
      [1.426, 0.197, 0.05, 0.055, -0.02],
      [1.39, 0.203, 0.054, 0.056, -0.02],
      [1.3, 0.205, 0.048, 0.05, -0.02],
      [1.21, 0.206, 0.044, 0.046, -0.02],
      [1.165, 0.206, 0.042, 0.043, -0.02],
      [1.1, 0.208, 0.044, 0.042, -0.018],
      [1.02, 0.209, 0.038, 0.035, -0.015],
      [0.945, 0.21, 0.035, 0.032, -0.013],
    ];
    const armW = (y: number): Weights => {
      if (y > 1.48) return [[shoulder, 0.4], [upper, 0.6]];
      if (y > 1.2) return [[upper, 1]];
      if (y > 1.13) return blend(y, 1.2, 1.13, upper, fore);
      return [[fore, 1]];
    };
    sb.loft('top', arm.map(([y, x, a, b, z]) => ({ c: [x * side, y, z], a, b, w: armW(y) })), { axis: 'y', radial: 16, tile: 0.2 });
    // Sleeve cuff: a ribbed band on casual tops; under a jacket, the white shirt cuff
    // shows a centimetre below the sleeve.
    if (o.suit) {
      sb.loft('shirt', [
        { c: [0.21 * side, 0.958, -0.013], a: 0.032, b: 0.03, w: [[fore, 1]] },
        { c: [0.21 * side, 0.928, -0.012], a: 0.031, b: 0.029, w: [[fore, 1]] },
      ], { axis: 'y', radial: 14, capEnd: true, tile: 0.2 });
    } else {
      sb.loft('top', [
        { c: [0.21 * side, 0.962, -0.013], a: 0.037, b: 0.034, w: [[fore, 1]], shade: 0.8 },
        { c: [0.21 * side, 0.942, -0.013], a: 0.036, b: 0.033, w: [[fore, 1]], shade: 0.8 },
      ], { axis: 'y', radial: 14, tile: 0.2 });
    }
    // Hand: a palm, four separate fingers with knuckle bends, and a thumb.
    const palm: [number, number, number, number, number][] = [
      // y, x inward offset, half-width (x), half-depth (z), z
      [0.95, 0, 0.025, 0.029, -0.012],
      [0.915, 0, 0.021, 0.034, -0.01],
      [0.885, 0.002, 0.019, 0.042, -0.008],
      [0.86, 0.005, 0.017, 0.044, -0.007],
      [0.848, 0.007, 0.015, 0.042, -0.007],
    ];
    sb.loft('skin', palm.map(([y, dx, a, b, z]) => ({ c: [(0.212 - dx) * side, y, z], a, b, w: [[hand, 1]] })), { axis: 'y', radial: 12, capEnd: true, tile: 0.1 });
    const fingers: [number, number][] = [[0.026, 0.86], [0.009, 1], [-0.008, 0.95], [-0.024, 0.78]]; // z offset, length
    for (const [fz, len] of fingers) {
      const L0 = 0.046 * len;
      const r0 = 0.0082 * (0.85 + len * 0.15);
      // Gently curled: each segment bends a little more toward the palm.
      const seg: [number, number, number][] = [[0, 0, 1], [0.38, 0.004, 0.95], [0.7, 0.011, 0.86], [1, 0.02, 0.72]];
      sb.loft('skin', seg.map(([t, inward, rs]) => ({
        c: [(0.205 - inward - t * 0.004) * side, 0.856 - t * L0, -0.007 + fz] as [number, number, number],
        a: r0 * rs * 0.92, b: r0 * rs, w: [[hand, 1]] as Weights, shade: t > 0.9 ? 0.92 : 1,
      })), { axis: 'y', radial: 8, capEnd: true, tile: 0.1 });
    }
    sb.loft('skin', [
      { c: [0.206 * side, 0.912, 0.022], a: 0.0125, b: 0.013, w: [[hand, 1]] },
      { c: [0.201 * side, 0.89, 0.04], a: 0.011, b: 0.011, w: [[hand, 1]] },
      { c: [0.196 * side, 0.869, 0.052], a: 0.0095, b: 0.0095, w: [[hand, 1]] },
      { c: [0.192 * side, 0.852, 0.057], a: 0.0075, b: 0.0075, w: [[hand, 1]] },
    ], { axis: 'y', radial: 8, capEnd: true, tile: 0.1 });
    // Ears: an outer rim, flattened against the head, with a darker hollow.
    const earX = (o.female ? 0.07 : 0.0735) + 0.004;
    const earC = new THREE.Vector3(earX * side, HEAD_C.y - 0.01, -0.012);
    const earPart = (g: THREE.BufferGeometry, shade: number) => {
      g.rotateY(0.42 * side);
      g.translate(earC.x, earC.y, earC.z);
      sb.addGeometry('skin', g, [['head', 1]], shade);
    };
    // Rim: a torus squashed into the ear's outline, lying against the head.
    const rim = new THREE.TorusGeometry(1, 0.2, 7, 18);
    rim.scale(0.0125, 0.024, 0.0125);
    rim.rotateY(Math.PI / 2);
    earPart(rim, 1);
    // Inner ear (concha) and lobe.
    const concha = new THREE.SphereGeometry(1, 10, 8);
    concha.scale(0.004, 0.017, 0.009);
    concha.translate(-0.002 * side, -0.002, 0);
    earPart(concha, 0.6);
    const lobe = new THREE.SphereGeometry(1, 8, 6);
    lobe.scale(0.0045, 0.008, 0.007);
    lobe.translate(0, -0.024, 0.002);
    earPart(lobe, 0.95);
  }
  // Neck and head.
  sb.loft('skin', [
    { c: [0, 1.48, -0.005], a: 0.062, b: 0.064, w: [['neck', 0.6], ['chest', 0.4]] },
    { c: [0, 1.56, 0.0], a: o.female ? 0.055 : 0.064, b: o.female ? 0.058 : 0.066, w: [['neck', 1]] },
    { c: [0, 1.6, 0.0], a: o.female ? 0.053 : 0.062, b: o.female ? 0.056 : 0.064, w: [['neck', 0.4], ['head', 0.6]] },
    { c: [0, 1.625, -0.005], a: o.female ? 0.05 : 0.058, b: o.female ? 0.054 : 0.06, w: [['head', 1]] },
  ], { axis: 'y', radial: 16, tile: 0.1 });
  const style: HeadStyle = { female: !!o.female, seed: seedOf(o.id) };
  const hairStyle = o.hairStyle ?? (o.suit ? 'swept' : 'short');
  // Skin of the head: sculpted, with soft occlusion in the eye sockets, under the nose and jaw.
  sb.addGeometry('face', headSurface(style, {
    segW: 64,
    segH: 44,
    shade: (xu, yu, zu) => {
      const front = Math.max(0, zu);
      const socket = Math.exp(-((Math.abs(xu) - 0.4) ** 2 + ((yu - 0.08) * 1.3) ** 2) / 0.02) * front;
      const under = yu < -0.6 ? (yu + 0.6) * 0.5 : 0;
      return 1 - socket * 0.18 + under * 0.3;
    },
  }), [['head', 1]]);
  // Eyes: eyeballs set deep in almond-shaped openings, with upper and lower lids and a
  // lash line, so only a sliver of white shows either side of the iris.
  const eyeP = new THREE.Vector3();
  for (const side of [1, -1]) {
    const xu = 0.4 * side;
    const yu = 0.085;
    sculpt(xu, yu, Math.sqrt(1 - xu * xu - yu * yu), style, eyeP).add(HEAD_C);
    const r = o.female ? 0.0118 : 0.0114;
    const cx = eyeP.x - side * 0.001;
    const cz = eyeP.z - r * 0.78;
    sb.sphere('sclera', [cx, eyeP.y, cz], [r, r, r], 'head', 14, 0.88);
    sb.sphere('eyes', [cx - side * 0.0008, eyeP.y - 0.0003, cz + r * 0.93], [r * 0.52, r * 0.52, r * 0.14], 'head', 12);
    // Upper lid (covers the top of the eyeball) and a thin lower lid.
    sb.sphere('face', [cx, eyeP.y + r * 0.62, cz + r * 0.08], [r * 1.12, r * 0.62, r * 1.08], 'head', 12, 0.93);
    sb.sphere('face', [cx, eyeP.y - r * 0.86, cz + r * 0.05], [r * 1.06, r * 0.42, r * 1.02], 'head', 10, 0.97);
    // Lash line along the lid edge.
    sb.sphere('hair', [cx, eyeP.y + r * 0.2, cz + r * 0.62], [r * 1.0, r * 0.1, r * 0.55], 'head', 10, 0.6);
  }
  // Hair: a layer over the scalp whose thickness falls to zero (and just under the skin)
  // across a soft hairline, so edges never step along the mesh.
  const covered = o.headwear !== 'none';
  const sm = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const hairCov = (xu: number, yu: number, zu: number) => {
    const s2 = sm(-0.3, 0.75, zu);
    const front = (o.female ? 0.43 : 0.47) - 0.22 * Math.abs(xu) ** 1.6;
    const nape = hairStyle === 'long' ? -0.75 : hairStyle === 'textured' ? -0.52 : -0.45;
    const thr = nape + (front - nape) * s2;
    // Sides and back fade out gradually (a taper); the front hairline is crisper.
    const fade = 0.1 + 0.22 * (1 - s2);
    let c = sm(thr - 0.03, thr + fade, yu);
    if (hairStyle === 'textured') {
      // Fringe: a few locks falling onto the forehead, mostly to the wearer's right.
      const fr = sm(0.55, 0.8, zu) * sm(0.2, -0.15, xu) * sm(-0.62, -0.2, xu) * sm(front - 0.2, front - 0.02, yu);
      c = Math.max(c, fr * 0.85);
    }
    // Around the ears.
    c *= 1 - sm(0.62, 0.86, Math.abs(xu)) * sm(0.34, 0.14, yu) * sm(-0.55, -0.35, yu) * sm(0.52, 0.32, Math.abs(zu));
    if (covered) c *= sm(0.56, 0.46, yu);
    return c;
  };
  const textured = hairStyle === 'textured';
  /** Thickness of the hair layer over the scalp (metres) where fully covered. */
  const hairDepth = (xu: number, yu: number, zu: number) => {
    if (covered) return 0.003;
    const clump = tuft(xu, yu, zu, 1) * 0.6 + tuft(xu * 1.9, yu * 1.7, zu * 1.8, 5) * 0.4;
    if (textured) {
      // Full on top, tapered short at the sides and back, a fringe falling to the wearer's right.
      const top = 0.015 * sm(0.0, 0.75, yu) * (1 - 0.8 * sm(0.35, 0.9, Math.abs(xu)));
      const back = zu < -0.2 ? 0.35 + 0.65 * sm(-0.2, 0.55, yu) : 1;
      const fringe = 0.005 * sm(0.3, 0.75, zu) * sm(0.3, 0.6, yu) * (1 + 0.6 * sm(0.1, -0.6, xu));
      // Combed waves: ridges running front to back, wobbling as they go, strongest on top.
      const wave = Math.sin(xu * 26 + Math.sin(zu * 7 + yu * 3) * 1.6 + tuft(xu, yu, zu, 9) * 2.5) * 0.5 + 0.5;
      const sides = 1 - 0.65 * sm(0.55, 0.85, Math.abs(xu)) * sm(0.45, 0.1, yu);
      return (0.0025 + top * back + fringe + (clump * 0.5 + wave * 0.5) * 0.006 * sm(0.05, 0.6, yu)) * sides;
    }
    const crown = Math.max(0, yu) * (hairStyle === 'short' ? 0.007 : 0.01);
    const sweep = hairStyle === 'swept' ? 0.014 * Math.max(0, zu - 0.2) * Math.max(0, yu - 0.25) * 3 : 0;
    return 0.0045 + crown + sweep + (o.female ? 0.004 : 0) + clump * 0.004;
  };
  const hairInflate = (xu: number, yu: number, zu: number) => {
    const c = hairCov(xu, yu, zu);
    return -0.0025 + (hairDepth(xu, yu, zu) + 0.0025) * c;
  };
  if (hairStyle !== 'bald') {
    sb.addGeometry('hair', headSurface(style, {
      segW: 80,
      segH: 56,
      mask: (xu, yu, zu) => hairCov(xu, yu, zu) > 0.01,
      inflate: hairInflate,
      shade: (xu, yu, zu) => (0.74 + tuft(xu * 2.3, yu * 2.3, zu * 2.3, 2) * 0.26) * (0.85 + 0.15 * hairCov(xu, yu, zu)),
    }), [['head', 1]]);
  }
  if (!covered && hairStyle !== 'bald') {
    // Hair cards: strips carrying a clump-of-strands texture, laid along the hair flow
    // (forward and to the wearer's right on top, a fringe falling onto the forehead, short
    // and downward at the sides and back). They lift a little in the middle for volume.
    let rs = Math.floor(style.seed * 1e5) + 31;
    const rnd = () => ((rs = (rs * 48271) % 2147483647) / 2147483647);
    const p0 = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const t = new THREE.Vector3();
    const sv = new THREE.Vector3();
    const down = new THREE.Vector3();
    const P = new THREE.Vector3();
    let placed = 0;
    const target = textured ? 190 : 140;
    for (let i = 0; i < 900 && placed < target; i += 1) {
      const yu = Math.min(0.97, -0.5 + Math.pow(rnd(), 0.75) * 1.5);
      const az = rnd() * Math.PI * 2;
      const rr = Math.sqrt(1 - yu * yu);
      const xu = Math.cos(az) * rr;
      const zu = Math.sin(az) * rr;
      const cov = hairCov(xu, yu, zu);
      if (cov < 0.7) continue;
      const topZone = sm(0.2, 0.6, yu);
      if (topZone < 0.3 && rnd() > 0.5) continue; // fewer, shorter cards low on the sides and back
      sculpt(xu, yu, zu, style, p0);
      nrm.set(xu / 0.073, yu / 0.115, zu / 0.096).normalize();
      p0.addScaledVector(nrm, hairInflate(xu, yu, zu) - 0.0012).add(HEAD_C);
      const combedBack = hairStyle === 'bun' || hairStyle === 'ponytail' || hairStyle === 'long';
      const fringe = textured && zu > 0.5 && yu < 0.62 && xu > -0.6 && xu < 0.25;
      if (fringe) t.set(-0.9, -0.38, 0.25);
      else if (combedBack) t.set(0, hairStyle === 'long' ? -0.4 : 0.1, -1);
      else if (hairStyle === 'swept') t.set(0.6, 0.1, -0.6);
      else if (zu > -0.2) t.set(textured ? -0.45 : -0.15, 0.05, 1);
      else t.set(Math.sign(xu) * 0.2, -0.25, -1);
      down.set(Math.sign(xu) * 0.12, -1, zu < 0 ? -0.35 : 0.15);
      if (!fringe && !combedBack) t.lerp(down, 1 - topZone);
      else if (combedBack) t.lerp(down, (1 - topZone) * 0.5);
      t.x += (rnd() - 0.5) * 0.7;
      t.z += (rnd() - 0.5) * 0.4;
      t.addScaledVector(nrm, -t.dot(nrm)).normalize();
      sv.crossVectors(nrm, t).normalize();
      const reach = textured ? 0.04 : hairStyle === 'short' ? 0.018 : hairStyle === 'long' ? 0.06 : 0.03;
      const len = (fringe ? 0.045 : 0.022 + reach * topZone) * (0.75 + rnd() * 0.45);
      const w = (0.011 + 0.01 * topZone) * (0.8 + rnd() * 0.4);
      const lift = (0.0015 + (textured ? 0.0055 : 0.002) * topZone) * (0.5 + rnd() * 0.8) * (fringe ? 0.4 : 1);
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      const segs = 4;
      for (let k = 0; k <= segs; k += 1) {
        const f = k / segs;
        // Along the flow, lifting off the hair, then curling back down at the tip.
        P.copy(p0).addScaledVector(t, len * f).addScaledVector(nrm, lift * Math.sin(f * Math.PI) - len * (textured ? 0.12 : 0.3) * f * f);
        const hw = (w * (1 - 0.45 * f)) / 2;
        pos.push(P.x - sv.x * hw, P.y - sv.y * hw, P.z - sv.z * hw, P.x + sv.x * hw, P.y + sv.y * hw, P.z + sv.z * hw);
        uv.push(0, f, 1, f);
        if (k < segs) {
          const a = k * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      sb.addGeometry('hairCard', g, [['head', 1]], 0.75 + rnd() * 0.35);
      placed += 1;
    }
  }
  if (!covered && (hairStyle === 'long' || hairStyle === 'ponytail' || hairStyle === 'bun')) {
    if (hairStyle === 'long') {
      // Hair falling behind the shoulders.
      sb.loft('hair', [
        { c: [0, 1.7, -0.02], a: 0.083, b: 0.09, w: [['head', 1]] },
        { c: [0, 1.6, -0.045], a: 0.088, b: 0.075, w: [['head', 0.7], ['neck', 0.3]] },
        { c: [0, 1.52, -0.075], a: 0.1, b: 0.05, w: [['neck', 0.5], ['chest', 0.5]] },
        { c: [0, 1.42, -0.11], a: 0.105, b: 0.035, w: [['chest', 1]] },
        { c: [0, 1.36, -0.12], a: 0.085, b: 0.02, w: [['chest', 1]] },
      ], { axis: 'y', radial: 18, arc: [Math.PI * 1.02, Math.PI * 1.98], capEnd: false, tile: 0.08 });
    } else if (hairStyle === 'ponytail') {
      sb.sphere('hair', [0, 1.745, -0.1], [0.022, 0.022, 0.02], 'head', 8, 0.7);
      sb.loft('hair', [
        { c: [0, 1.74, -0.115], a: 0.02, b: 0.02, w: [['head', 1]] },
        { c: [0, 1.68, -0.14], a: 0.026, b: 0.022, w: [['head', 1]] },
        { c: [0, 1.6, -0.135], a: 0.022, b: 0.018, w: [['head', 0.5], ['neck', 0.5]] },
        { c: [0, 1.53, -0.12], a: 0.01, b: 0.009, w: [['neck', 1]] },
      ], { axis: 'y', radial: 10, capEnd: true, tile: 0.06 });
    } else {
      sb.sphere('hair', [0, 1.75, -0.1], [0.045, 0.04, 0.038], 'head', 12, 0.85);
    }
  }
  // Beard and moustache: a short full beard over the jaw, chin and lower cheeks joining the
  // sideburns; denser and a little longer under the chin. Soft edges, stubble painted below.
  if (o.beard && !o.female) {
    const lipC = 0.13 - (0.36 + style.seed * 0.06) - 0.2;
    const bsm = (e0: number, e1: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
      return t * t * (3 - 2 * t);
    };
    const beardTop = (ax: number) => -0.21 + bsm(0.5, 0.93, ax) * 0.47;
    const beardCov = (xu: number, yu: number, zu: number) => {
      const ax = Math.abs(xu);
      let c = bsm(beardTop(ax) + 0.03, beardTop(ax) - 0.07, yu);
      const zb = -0.24 + 0.3 * bsm(-0.55, 0.25, yu);
      c *= bsm(zb - 0.07, zb + 0.05, zu);
      c *= 1 - bsm(1.05, 0.85, Math.hypot(ax / 0.29, (yu - (lipC - 0.012)) / 0.075));
      c *= 1 - bsm(0.52, 0.44, ax) * bsm(lipC + 0.17, lipC + 0.21, yu);
      return c;
    };
    sb.addGeometry('beard', headSurface(style, {
      segW: 80,
      segH: 56,
      mask: (xu, yu, zu) => beardCov(xu, yu, zu) > 0.01,
      inflate: (xu, yu, zu) => {
        const depth = 0.0028 + tuft(xu * 2, yu * 2, zu * 2, 3) * 0.002 + Math.max(0, -yu - 0.55) * 0.008;
        return -0.002 + (depth + 0.002) * beardCov(xu, yu, zu);
      },
      shade: (xu, yu, zu) => 0.66 + tuft(xu * 2.5, yu * 2.5, zu * 2.5, 4) * 0.34,
    }), [['head', 1]]);
    sb.addGeometry('hair', headSurface(style, {
      segW: 80,
      segH: 56,
      mask: (xu, yu, zu) => beardCov(xu, yu, zu) > 0.5,
      inflate: (xu, yu, zu) => -0.0025 + 0.0035 * Math.max(0, (beardCov(xu, yu, zu) - 0.5) * 2),
      shade: (xu, yu, zu) => 0.5 + tuft(xu * 3, yu * 3, zu * 3, 6) * 0.25,
    }), [['head', 1]]);
  }
  // Headwear.
  if (o.headwear === 'cap') {
    sb.loft('headwear', [
      { c: [0, 1.728, -0.004], a: 0.085, b: 0.106, w: [['head', 1]] },
      { c: [0, 1.775, -0.008], a: 0.079, b: 0.098, w: [['head', 1]] },
      { c: [0, 1.81, -0.012], a: 0.058, b: 0.072, w: [['head', 1]] },
      { c: [0, 1.828, -0.014], a: 0.02, b: 0.025, w: [['head', 1]] },
    ], { axis: 'y', radial: 18, capEnd: true, tile: 0.12 });
    // Curved brim.
    sb.loft('headwear', [
      { c: [0, 1.736, 0.08], a: 0.08, b: 0.005, w: [['head', 1]] },
      { c: [0, 1.73, 0.13], a: 0.072, b: 0.005, w: [['head', 1]] },
      { c: [0, 1.718, 0.17], a: 0.055, b: 0.005, w: [['head', 1]] },
    ], { axis: 'z', radial: 12, p: 4, capEnd: true, tile: 0.12 });
  } else if (o.headwear === 'beanie') {
    sb.loft('headwear', [
      { c: [0, 1.705, -0.004], a: 0.086, b: 0.106, w: [['head', 1]] },
      { c: [0, 1.74, -0.004], a: 0.087, b: 0.107, w: [['head', 1]] },
      { c: [0, 1.785, -0.01], a: 0.077, b: 0.095, w: [['head', 1]] },
      { c: [0, 1.818, -0.016], a: 0.052, b: 0.064, w: [['head', 1]] },
      { c: [0, 1.835, -0.018], a: 0.015, b: 0.018, w: [['head', 1]] },
    ], { axis: 'y', radial: 18, capEnd: true, tile: 0.08 });
  }
  if (o.suit) {
    // Two-button jacket. The shirt front, lapels, collar points and welt pocket are strips
    // built on the torso surface itself, so they lie flat on the chest from every angle.
    const torsoAt = (y: number) => {
      for (let i = 0; i < torso.length - 1; i += 1) {
        const [y0, a0, b0, z0] = torso[i];
        const [y1, a1, b1, z1] = torso[i + 1];
        if (y >= y0 && y <= y1) {
          const t = (y - y0) / (y1 - y0);
          return { a: a0 + (a1 - a0) * t, b: b0 + (b1 - b0) * t, z: z0 + (z1 - z0) * t };
        }
      }
      const last = torso[torso.length - 1];
      return { a: last[1], b: last[2], z: last[3] };
    };
    const frontZ = (x: number, y: number) => {
      const r = torsoAt(y);
      const t = Math.min(0.995, Math.abs(x) / r.a);
      return r.z + r.b * Math.pow(1 - Math.pow(t, 2.4), 1 / 2.4);
    };
    /** Strip between x0(y)..x1(y) for y0..y1, `off` metres off the torso surface. */
    const strip = (mat: MatName, y0: number, y1: number, xs: (y: number) => [number, number], off: number, shade = 1, rows = 10, cols = 4) => {
      const pos: number[] = [];
      const idx: number[] = [];
      for (let j = 0; j <= rows; j += 1) {
        const y = y0 + ((y1 - y0) * j) / rows;
        const [xa, xb] = xs(y);
        for (let i = 0; i <= cols; i += 1) {
          const x = xa + ((xb - xa) * i) / cols;
          pos.push(x, y, frontZ(x, y) + off);
        }
      }
      for (let j = 0; j < rows; j += 1) {
        for (let i = 0; i < cols; i += 1) {
          const a = j * (cols + 1) + i;
          const b = a + cols + 1;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      sb.addGeometry(mat, g, (p) => torsoW(p.y), shade);
    };
    const yB = 1.2; // top button: where the lapels meet
    const inner = (y: number) => 0.004 + Math.max(0, y - yB) * 0.2; // edge of the jacket opening
    const lapelW = (y: number) => {
      const t = (y - yB) / (1.49 - yB);
      return t < 0.75 ? 0.012 + t * 0.07 : 0.0645 - (t - 0.75) * 0.13; // widest at the notch
    };
    // Shirt in the V, with the open neck showing skin at the top.
    strip('shirt', yB - 0.02, 1.5, (y) => [-inner(y), inner(y)], 0.002, 1, 12, 6);
    strip('skin', 1.42, 1.5, (y) => [-(y - 1.42) * 0.42, (y - 1.42) * 0.42], 0.0035, 0.9, 4, 2);
    for (const y of [1.39, 1.34, 1.29]) sb.sphere('badge', [0.004, y, frontZ(0.004, y) + 0.004], [0.004, 0.004, 0.002], 'chest', 6, 0.8);
    for (const side of [1, -1]) {
      // Lapel, rolling from the button up to the notch, slightly raised.
      strip('top', yB, 1.475, (y) => {
        const a = inner(y);
        const b = inner(y) + lapelW(y);
        return side > 0 ? [a, b] : [-b, -a];
      }, 0.005, 0.86, 14, 4);
      // Collar points spread over the lapels.
      strip('shirt', 1.43, 1.51, (y) => {
        const a = inner(y) - 0.006;
        const b = a + 0.012 + (1.51 - y) * 0.45;
        return side > 0 ? [a, b] : [-b, -a];
      }, 0.0075, 1, 5, 3);
    }
    // Jacket collar standing behind the neck, and the shirt collar inside it.
    sb.loft('top', [
      { c: [0, 1.465, -0.016], a: 0.094, b: 0.09, w: [['chest', 1]], shade: 0.9 },
      { c: [0, 1.535, -0.02], a: 0.074, b: 0.074, w: [['chest', 0.5], ['neck', 0.5]] },
    ], { axis: 'y', radial: 20, arc: [Math.PI / 2 + 0.75, Math.PI * 2.5 - 0.75], tile: 0.2 });
    sb.loft('shirt', [
      { c: [0, 1.51, -0.012], a: 0.071, b: 0.072, w: [['chest', 0.5], ['neck', 0.5]] },
      { c: [0, 1.575, -0.012], a: 0.066, b: 0.068, w: [['neck', 1]] },
    ], { axis: 'y', radial: 20, arc: [Math.PI / 2 + 0.5, Math.PI * 2.5 - 0.5], tile: 0.2 });
    // Buttons.
    sb.sphere('dark', [0.004, yB, frontZ(0.004, yB) + 0.005], [0.009, 0.009, 0.005], 'chest', 8);
    sb.sphere('dark', [0.004, 1.105, frontZ(0.004, 1.105) + 0.004], [0.009, 0.009, 0.005], 'spine', 8);
    // Chest welt pocket on the wearer's left.
    strip('top', 1.33, 1.345, () => [0.068, 0.128], 0.003, 0.66, 1, 3);
    // Jacket skirt: two halves that follow the thighs a little, meeting at a back vent.
    for (const side of [1, -1] as const) {
      const thigh = (side > 0 ? 'thigh.L' : 'thigh.R') as BoneName;
      const arc: [number, number] = side > 0 ? [-Math.PI / 2 + 0.035, Math.PI / 2 - 0.09] : [Math.PI / 2 + 0.09, Math.PI * 1.5 - 0.035];
      sb.loft('top', [
        { c: [0, 1.03, -0.006], a: 0.166, b: 0.118, w: [['hips', 1]] },
        { c: [0, 0.95, -0.006], a: 0.173, b: 0.123, w: [['hips', 0.85], [thigh, 0.15]] },
        { c: [0, 0.87, -0.006], a: 0.176, b: 0.127, w: [['hips', 0.65], [thigh, 0.35]] },
        { c: [0, 0.8, -0.006], a: 0.176, b: 0.128, w: [['hips', 0.55], [thigh, 0.45]], shade: 0.84 },
      ], { axis: 'y', radial: 14, p: 2.3, arc, tile: 0.2 });
      // Flap pocket.
      const g = new THREE.BoxGeometry(0.07, 0.02, 0.006);
      g.rotateY(0.55 * side);
      g.translate(0.11 * side, 0.955, 0.1);
      sb.addGeometry('top', g, [['hips', 1]], 0.72);
      // Sleeve buttons on the outer back of each cuff.
      const fore = (side > 0 ? 'foreArm.L' : 'foreArm.R') as BoneName;
      for (const y of [0.968, 0.984, 1.0]) sb.sphere('dark', [(0.21 + 0.029) * side, y, -0.032], [0.0035, 0.0035, 0.0025], fore, 6);
      // Oxfords: cap-toe seam and laces.
      const foot = (side > 0 ? 'foot.L' : 'foot.R') as BoneName;
      const toe = (side > 0 ? 'toe.L' : 'toe.R') as BoneName;
      sb.box('dark', [0.094 * side, 0.037, 0.138], [0.1, 0.068, 0.003], toe, 0, 0.5);
      for (const [z, y] of [[0.015, 0.107], [0.04, 0.101], [0.065, 0.094]] as const) sb.box('dark', [0.094 * side, y, z], [0.032, 0.004, 0.006], foot, 0, 0.6);
    }
  } else {
  // Belt with buckle.
  sb.loft('leather', [
    { c: [0, 0.955, -0.007], a: 0.174, b: 0.12, w: [['hips', 1]] },
    { c: [0, 0.995, -0.007], a: 0.17, b: 0.117, w: [['hips', 1]] },
  ], { axis: 'y', radial: 18, p: 2.4, tile: 0.1 });
  sb.box('badge', [0, 0.975, 0.115], [0.05, 0.036, 0.012], 'hips');
  }
  if (o.suit) {
    // Nothing on the belt line: the jacket covers it.
  } else if (o.uniform) {
    // Chest pockets with flaps, badge (wearer's left), shoulder patch, radio and pouch.
    for (const side of [1, -1]) {
      sb.box('top', [0.085 * side, 1.31, 0.13], [0.075, 0.085, 0.014], 'chest', 0, 0.92);
      sb.box('top', [0.085 * side, 1.358, 0.136], [0.078, 0.022, 0.012], 'chest', 0, 0.85);
    }
    sb.box('badge', [0.092, 1.385, 0.128], [0.034, 0.04, 0.008], 'chest');
    sb.box('gear', [0.248, 1.36, -0.02], [0.012, 0.06, 0.05], 'upperArm.L');
    sb.box('dark', [0.178, 0.94, 0.04], [0.035, 0.1, 0.055], 'hips');
    sb.box('dark', [0.172, 1.0, 0.045], [0.008, 0.06, 0.008], 'hips');
    sb.box('leather', [-0.15, 0.95, 0.075], [0.06, 0.07, 0.035], 'hips', 0.5);
    sb.box('leather', [0.12, 0.95, -0.1], [0.07, 0.06, 0.035], 'hips', -0.4);
  } else {
    // Work clothes: a knife sheath and a pocket bulge.
    sb.box('leather', [-0.17, 0.92, 0.0], [0.03, 0.14, 0.04], 'hips');
    sb.box('trousers', [0.11, 0.8, 0.07], [0.06, 0.08, 0.02], 'thigh.L', 0, 0.9);
  }
  if (o.backpack) {
    sb.loft('gear', [
      { c: [0, 1.1, -0.172], a: 0.105, b: 0.05, w: [['spine', 0.6], ['chest', 0.4]] },
      { c: [0, 1.19, -0.185], a: 0.12, b: 0.062, w: [['chest', 1]] },
      { c: [0, 1.31, -0.183], a: 0.12, b: 0.06, w: [['chest', 1]] },
      { c: [0, 1.39, -0.17], a: 0.1, b: 0.045, w: [['chest', 1]] },
    ], { axis: 'y', radial: 16, p: 3, capStart: true, capEnd: true, tile: 0.15 });
    // Shoulder straps.
    for (const side of [1, -1]) {
      sb.loft('gear', [
        { c: [0.11 * side, 1.08, 0.06], a: 0.022, b: 0.008, w: [['spine', 0.5], ['chest', 0.5]] },
        { c: [0.12 * side, 1.3, 0.13], a: 0.024, b: 0.008, w: [['chest', 1]] },
        { c: [0.115 * side, 1.47, 0.03], a: 0.024, b: 0.01, w: [['chest', 1]] },
      ], { axis: 'y', radial: 6, p: 4, tile: 0.15 });
    }
  }
  return sb.build();
}

// ------------------------------------------------------------------ assembly

interface BuiltOutfit {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
}

const outfitCache = new Map<string, BuiltOutfit>();

function cloth(color: string, pattern: string, roughness = 0.9): THREE.MeshStandardMaterial {
  const map = patternMap(pattern, color);
  return new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : color,
    map,
    normalMap: fabricNormal(pattern === 'check' ? 'twill' : pattern),
    // Suiting cloth is finer and flatter than work wear.
    normalScale: pattern === 'check' ? new THREE.Vector2(0.12, 0.12) : new THREE.Vector2(0.35, 0.35),
    roughness,
    metalness: 0,
    vertexColors: true,
  });
}

/** Stable 0..1 number per outfit, so each face is a little different. */
function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

function buildOutfit(o: Outfit): BuiltOutfit {
  const hit = outfitCache.get(o.id);
  if (hit) return hit;
  const geometry = buildGeometry(o);
  const hairMat = new THREE.MeshStandardMaterial({
    color: o.hair, roughness: 0.5, metalness: 0, vertexColors: true,
    normalMap: hairNormal(), normalScale: new THREE.Vector2(0.4, 0.4),
  });
  const mats: Record<MatName, THREE.Material> = {
    skin: new THREE.MeshStandardMaterial({ color: o.skin, roughness: 0.58, metalness: 0, vertexColors: true }),
    face: new THREE.MeshStandardMaterial({
      map: faceTexture({ skin: o.skin, hair: o.hair, female: !!o.female, beard: o.beard && !o.female, stubble: !o.female, seed: seedOf(o.id) }),
      roughness: 0.55, metalness: 0, vertexColors: true,
    }),
    sclera: new THREE.MeshStandardMaterial({ color: '#e9e4dc', roughness: 0.25, metalness: 0 }),
    hairCard: new THREE.MeshStandardMaterial({
      color: new THREE.Color(o.hair).multiplyScalar(1.35), map: hairCardTexture(), alphaTest: 0.38,
      side: THREE.DoubleSide, roughness: 0.48, metalness: 0, vertexColors: true,
    }),
    beard: new THREE.MeshStandardMaterial({
      color: new THREE.Color(o.hair).multiplyScalar(1.3), map: beardTexture(), alphaTest: 0.32,
      roughness: 0.6, metalness: 0, vertexColors: true,
    }),
    top: cloth(o.top, o.topPattern),
    trousers: cloth(o.trousers, o.trouserPattern),
    boots: new THREE.MeshStandardMaterial({ color: o.boots, roughness: o.suit ? 0.22 : 0.62, metalness: 0, vertexColors: true }),
    hair: hairMat,
    headwear: o.headwearPattern === 'camo' ? cloth(o.headwearColor, 'camo') : cloth(o.headwearColor, o.headwear === 'beanie' ? 'knit' : 'twill'),
    leather: new THREE.MeshStandardMaterial({ color: '#2b2017', roughness: 0.55, metalness: 0, vertexColors: true }),
    dark: new THREE.MeshStandardMaterial({ color: '#1c1d1b', roughness: 0.7, metalness: 0.1, vertexColors: true }),
    gear: cloth(o.vest ?? o.backpack ?? '#555', 'canvas'),
    eyes: new THREE.MeshStandardMaterial({ color: '#1d1611', roughness: 0.3, metalness: 0 }),
    badge: new THREE.MeshStandardMaterial({ color: '#b39553', roughness: 0.35, metalness: 0.85 }),
    shirt: cloth('#eceae4', 'twill', 0.8),
  };
  for (const [k, m] of Object.entries(mats)) m.name = `${o.id}-${k}`;
  const built = { geometry, materials: MATS.map((m) => mats[m]) };
  outfitCache.set(o.id, built);
  return built;
}

export interface Humanoid {
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  outfit: Outfit;
}

/** Creates one character instance (own skeleton, shared geometry/materials). */
export function createHumanoid(outfit: Outfit): Humanoid {
  const { geometry, materials } = buildOutfit(outfit);
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    const parent = PARENT[name];
    const j = JOINTS[name];
    if (parent) {
      const pj = JOINTS[parent];
      bones[name].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
      bones[parent].add(bones[name]);
    } else {
      bones[name].position.set(...j);
    }
  }
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n]));
  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.add(bones.root);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Skinned bounds change with the pose; the character is always near the camera.
  mesh.frustumCulled = false;
  mesh.name = `character-${outfit.id}`;
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, bones, outfit };
}
