// Procedural humanoid: one skinned mesh lofted from anatomical cross-sections
// around a 22-bone skeleton, dressed per outfit (ranger uniform, poachers' work
// clothes). Built once per outfit; every character instance gets its own skeleton
// and shares the geometry and materials.
//
// Character space: metres, Y up, the body faces +Z, its left side is +X.
// In the bind pose every limb hangs straight down, so each limb bone's length
// axis is -Y and its +Z axis is the front of the limb. The animator relies on that.

import * as THREE from 'three';

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
  topPattern: 'twill' | 'camo' | 'plaid' | 'knit' | 'canvas';
  trousers: string;
  trouserPattern: 'twill' | 'denim' | 'canvas';
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
}

export const RANGER: Outfit = {
  id: 'ranger', skin: '#b98a70', hair: '#3a2a1e',
  top: '#5e6248', topPattern: 'twill', trousers: '#3f4536', trouserPattern: 'twill', boots: '#4a3326',
  headwear: 'cap', headwearColor: '#3d4935', beard: false, uniform: true, backpack: '#55513f', vest: null,
};

/** The player: navy two-button suit, white open-collar shirt, black shoes, beard. */
export const PLAYER_SUIT: Outfit = {
  id: 'player-suit', skin: '#a8724f', hair: '#1a1411',
  top: '#2b3a5c', topPattern: 'twill', trousers: '#2b3a5c', trouserPattern: 'twill', boots: '#121212',
  headwear: 'none', headwearColor: '#000', beard: true, uniform: false, backpack: null, vest: null, suit: true,
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

const MATS = ['skin', 'top', 'trousers', 'boots', 'hair', 'headwear', 'leather', 'dark', 'gear', 'eyes', 'badge', 'shirt'] as const;
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

  addGeometry(mat: MatName, g: THREE.BufferGeometry, w: Weights, shade = 1): void {
    const gi = g.index ? g : g;
    const pos = gi.getAttribute('position') as THREE.BufferAttribute;
    const uv = gi.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const base = this.pos.length / 3;
    for (let i = 0; i < pos.count; i += 1) {
      this.vert(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, w, shade);
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
    [1.455, 0.186, 0.104, -0.012],
    [1.5, 0.115, 0.082, -0.014],
    [1.535, 0.06, 0.062, -0.01],
  ];
  const torsoW = (y: number): Weights => {
    if (y < 1.0) return [['hips', 1]];
    if (y < 1.16) return blend(y, 1.0, 1.16, 'hips', 'spine');
    if (y < 1.3) return blend(y, 1.16, 1.3, 'spine', 'chest');
    if (y < 1.49) return [['chest', 1]];
    return blend(y, 1.49, 1.54, 'chest', 'neck');
  };
  sb.loft('top', torso.map(([y, a, b, z]) => ({ c: [0, y, z], a, b, w: torsoW(y), shade: y < 0.9 ? 0.8 : 1 })), { axis: 'y', radial: 18, p: 2.4, capStart: true, tile: 0.2 });
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
    sb.loft('boots', [
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
      [1.505, 0.172, 0.05, 0.052, -0.02],
      [1.455, 0.198, 0.058, 0.06, -0.02],
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
    sb.loft('top', arm.map(([y, x, a, b, z]) => ({ c: [x * side, y, z], a, b, w: armW(y) })), { axis: 'y', radial: 12, tile: 0.2 });
    // Hand: palm and curled fingers (a mitten shape) plus a thumb.
    const palm: [number, number, number, number, number][] = [
      // y, x inward offset, half-width (x), half-depth (z), z
      [0.95, 0, 0.026, 0.03, -0.012],
      [0.915, 0, 0.022, 0.034, -0.01],
      [0.885, 0.002, 0.02, 0.043, -0.008],
      [0.855, 0.006, 0.018, 0.046, -0.006],
      [0.82, 0.014, 0.016, 0.042, -0.006],
      [0.795, 0.022, 0.013, 0.035, -0.008],
      [0.782, 0.028, 0.008, 0.024, -0.01],
    ];
    sb.loft('skin', palm.map(([y, dx, a, b, z]) => ({ c: [(0.212 - dx) * side, y, z], a, b, w: [[hand, 1]] })), { axis: 'y', radial: 10, capEnd: true, tile: 0.1 });
    sb.loft('skin', [
      { c: [0.205 * side, 0.9, 0.03], a: 0.012, b: 0.013, w: [[hand, 1]] },
      { c: [0.198 * side, 0.872, 0.05], a: 0.011, b: 0.011, w: [[hand, 1]] },
      { c: [0.193 * side, 0.852, 0.058], a: 0.008, b: 0.008, w: [[hand, 1]] },
    ], { axis: 'y', radial: 8, capEnd: true, tile: 0.1 });
    // Ears.
    sb.sphere('skin', [0.077 * side, 1.672, -0.004], [0.012, 0.028, 0.02], 'head', 8);
  }
  // Neck and head.
  sb.loft('skin', [
    { c: [0, 1.48, -0.005], a: 0.054, b: 0.058, w: [['neck', 0.6], ['chest', 0.4]] },
    { c: [0, 1.56, 0.0], a: 0.052, b: 0.056, w: [['neck', 1]] },
    { c: [0, 1.61, 0.005], a: 0.052, b: 0.058, w: [['head', 1]] },
  ], { axis: 'y', radial: 12, tile: 0.1 });
  const head: [number, number, number, number, number][] = [
    // y, half-width, half-depth, z, shade
    [1.572, 0.03, 0.026, 0.045, 1],
    [1.595, 0.056, 0.062, 0.03, 1],
    [1.625, 0.068, 0.082, 0.016, 1],
    [1.66, 0.074, 0.094, 0.009, 1],
    [1.7, 0.077, 0.099, 0.004, 1],
    [1.74, 0.076, 0.097, -0.002, 1],
    [1.772, 0.067, 0.087, -0.007, 1],
    [1.797, 0.046, 0.059, -0.012, 1],
    [1.81, 0.016, 0.02, -0.014, 1],
  ];
  const beardShade = (y: number) => (o.beard && y < 1.65 ? 0.55 : 1);
  sb.loft('skin', head.map(([y, a, b, z]) => ({ c: [0, y, z], a, b, w: [['head', 1]], shade: beardShade(y) })), { axis: 'y', radial: 18, capStart: true, capEnd: true, tile: 0.1 });
  // Face: nose, brows, eyes, mouth shadow.
  sb.loft('skin', [
    { c: [0, 1.692, 0.098], a: 0.009, b: 0.006, w: [['head', 1]] },
    { c: [0, 1.668, 0.112], a: 0.012, b: 0.012, w: [['head', 1]] },
    { c: [0, 1.652, 0.11], a: 0.016, b: 0.012, w: [['head', 1]] },
  ], { axis: 'y', radial: 8, capEnd: true, capStart: true, tile: 0.1 });
  for (const side of [1, -1]) {
    sb.sphere('eyes', [0.032 * side, 1.69, 0.085], [0.011, 0.008, 0.007], 'head', 8);
    sb.box('hair', [0.033 * side, 1.705, 0.092], [0.03, 0.006, 0.01], 'head', -0.12 * side);
  }
  sb.box('dark', [0, 1.628, 0.093], [0.032, 0.005, 0.006], 'head', 0, 0.7);
  if (o.beard) {
    sb.loft('hair', [
      { c: [0, 1.57, 0.045], a: 0.034, b: 0.03, w: [['head', 1]] },
      { c: [0, 1.6, 0.032], a: 0.06, b: 0.066, w: [['head', 1]] },
      { c: [0, 1.632, 0.016], a: 0.071, b: 0.084, w: [['head', 1]] },
    ], { axis: 'y', radial: 16, arc: [0.05 * Math.PI, 0.95 * Math.PI], tile: 0.1 });
  }
  if (o.suit) {
    // Moustache joining the beard.
    sb.box('hair', [0, 1.643, 0.1], [0.046, 0.009, 0.01], 'head');
    // Fuller top with a swept fringe.
    sb.loft('hair', [
      { c: [0, 1.748, 0.0], a: 0.082, b: 0.105, w: [['head', 1]] },
      { c: [0, 1.785, 0.004], a: 0.079, b: 0.1, w: [['head', 1]] },
      { c: [0, 1.815, 0.0], a: 0.064, b: 0.084, w: [['head', 1]] },
      { c: [0, 1.838, -0.006], a: 0.032, b: 0.045, w: [['head', 1]] },
    ], { axis: 'y', radial: 18, capEnd: true, tile: 0.1 });
    sb.sphere('hair', [0.028, 1.79, 0.07], [0.062, 0.03, 0.042], 'head', 10);
  }
  // Hair: back and sides of the head (under any headwear).
  sb.loft('hair', [
    { c: [0, 1.64, -0.004], a: 0.078, b: 0.094, w: [['head', 1]] },
    { c: [0, 1.7, -0.002], a: 0.081, b: 0.102, w: [['head', 1]] },
    { c: [0, 1.745, -0.004], a: 0.08, b: 0.1, w: [['head', 1]] },
    { c: [0, 1.778, -0.009], a: 0.07, b: 0.09, w: [['head', 1]] },
    { c: [0, 1.803, -0.014], a: 0.047, b: 0.061, w: [['head', 1]] },
    { c: [0, 1.818, -0.016], a: 0.012, b: 0.016, w: [['head', 1]] },
  ], { axis: 'y', radial: 16, arc: [Math.PI * 0.9, Math.PI * 2.1], tile: 0.1 });
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
    // Shirt front in the jacket's V, lapels over it, buttons and pocket flaps.
    const panel = (mat: 'shirt' | 'top' | 'dark', size: [number, number, number], c: [number, number, number], rx: number, rz: number, shade: number) => {
      const g = new THREE.BoxGeometry(...size);
      g.rotateX(rx);
      g.rotateZ(rz);
      g.translate(...c);
      sb.addGeometry(mat, g, [['chest', 1]], shade);
    };
    panel('shirt', [0.11, 0.18, 0.01], [0, 1.4, 0.124], -0.2, 0, 1);
    for (const side of [1, -1]) panel('top', [0.04, 0.23, 0.012], [0.058 * side, 1.38, 0.13], -0.2, -0.2 * side, 0.9);
    sb.sphere('dark', [0, 1.2, 0.131], [0.009, 0.009, 0.005], 'chest', 6);
    sb.sphere('dark', [0, 1.11, 0.117], [0.009, 0.009, 0.005], 'spine', 6);
    sb.box('top', [-0.09, 1.33, 0.135], [0.06, 0.012, 0.008], 'chest', 0, 0.75);
    for (const side of [1, -1]) sb.box('top', [0.1 * side, 1.0, 0.113], [0.08, 0.016, 0.012], 'hips', 0, 0.75);
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
    normalMap: fabricNormal(pattern),
    normalScale: new THREE.Vector2(0.35, 0.35),
    roughness,
    metalness: 0,
    vertexColors: true,
  });
}

function buildOutfit(o: Outfit): BuiltOutfit {
  const hit = outfitCache.get(o.id);
  if (hit) return hit;
  const geometry = buildGeometry(o);
  const mats: Record<MatName, THREE.Material> = {
    skin: new THREE.MeshStandardMaterial({ color: o.skin, roughness: 0.6, metalness: 0, vertexColors: true }),
    top: cloth(o.top, o.topPattern),
    trousers: cloth(o.trousers, o.trouserPattern),
    boots: new THREE.MeshStandardMaterial({ color: o.boots, roughness: o.suit ? 0.28 : 0.62, metalness: 0, vertexColors: true }),
    hair: new THREE.MeshStandardMaterial({ color: o.hair, roughness: 0.85, metalness: 0, vertexColors: true }),
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
