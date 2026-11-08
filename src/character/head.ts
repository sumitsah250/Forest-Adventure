// Sculpted head for the procedural humanoid. One shape function turns a point on the
// unit sphere into the head surface (skull, brow ridge, eye sockets, cheekbones, nose,
// lips, jaw and chin). The skin, the hair cap and the beard are all generated from that
// function, so hair and stubble hug the face exactly. A painted face texture (brows,
// lash line, lips, cheek warmth, stubble shadow, hairline) is mapped with the sphere UVs.
//
// Head space: centre at HEAD_C (character space), +Z is the face, +X the head's left.

import * as THREE from 'three';

export const HEAD_C = new THREE.Vector3(0, 1.69, 0.0);

export interface HeadStyle {
  female: boolean;
  /** 0..1 personal variation (nose length, jaw width…) so faces differ. */
  seed: number;
}

const g = (d: number, s: number) => Math.exp(-(d * d) / (s * s));
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Surface point (head space, metres) for a unit-sphere direction. */
export function sculpt(xu: number, yu: number, zu: number, s: HeadStyle, out = new THREE.Vector3()): THREE.Vector3 {
  const v1 = s.seed;
  const v2 = (s.seed * 7.31) % 1;
  const sx = s.female ? 0.07 : 0.0735;
  const sy = s.female ? 0.112 : 0.116;
  const sz = s.female ? 0.094 : 0.097;
  let X = xu * sx;
  let Y = yu * sy;
  let Z = zu * sz;
  // Jaw: the lower face narrows to the chin; the back of the skull tucks in toward the neck.
  const low = smooth(0.1, -0.95, yu);
  const jawTaper = (s.female ? 0.4 : 0.32) + v2 * 0.06;
  X *= 1 - jawTaper * Math.pow(low, 1.25);
  if (zu < 0) Z *= 1 - 0.62 * smooth(-0.25, -0.95, yu);
  else Z *= 1 - 0.12 * low;
  // Cranium: a fuller back of the head above the ears.
  if (zu < 0.1 && yu > -0.25) Z *= 1 + 0.07 * smooth(0.1, -0.6, zu) * smooth(-0.25, 0.3, yu);
  // Flatter, broad face plane.
  if (zu > 0.55) Z -= (zu - 0.55) * 0.012;
  const front = smooth(0.35, 0.8, zu);
  const ax = Math.abs(xu);
  // Brow ridge.
  Z += front * (s.female ? 0.0015 : 0.0045) * g(yu - 0.22, 0.08) * g(ax, 0.75);
  // Eye sockets: a broad shallow hollow plus an almond-shaped opening for the eye.
  Z -= front * 0.005 * g(Math.hypot(ax - 0.4, (yu - 0.09) * 1.3), 0.24);
  Z -= front * 0.0045 * g(Math.hypot((ax - 0.4) * 0.85, (yu - 0.085) * 2.4), 0.13);
  // Cheekbones.
  const cheek = 0.004 * g(Math.hypot(ax - 0.58, yu + 0.05), 0.2);
  X += Math.sign(xu) * cheek * 0.6;
  Z += front * cheek;
  // Nose: bridge between the eyes to the tip, then tucked under to the philtrum.
  const nlen = 0.36 + v1 * 0.06;
  const top = 0.13;
  const tipY = top - nlen;
  const t = (top - yu) / nlen;
  let nh = 0;
  if (t > -0.15 && t <= 1) nh = (0.003 + (s.female ? 0.012 : 0.0145) * Math.pow(Math.max(0, t), 1.7)) * smooth(-0.15, 0.05, t);
  else if (t > 1) nh = (s.female ? 0.015 : 0.0175) * (1 - smooth(tipY, tipY - 0.09, yu));
  const nw = 0.09 + 0.12 * Math.max(0, Math.min(1, t));
  Z += front * nh * g(xu, nw);
  // Nostril wings.
  Z += front * 0.0055 * g(Math.hypot(ax - 0.16, (yu - (tipY + 0.02)) * 1.4), 0.08);
  // Lips: two soft rolls with a crease, slightly protruding.
  const lipC = tipY - 0.2;
  const lipW = s.female ? 0.32 : 0.3;
  const lipAmt = (s.female ? 0.0055 : 0.0042) * g(xu, lipW);
  Z += front * lipAmt * (g(yu - (lipC + 0.04), 0.045) + 1.1 * g(yu - (lipC - 0.055), 0.05));
  Z -= front * 0.0022 * g(yu - lipC, 0.016) * g(xu, lipW * 0.9);
  // Chin.
  Z += front * (s.female ? 0.004 : 0.0065) * g(Math.hypot(xu * 1.4, yu + 0.84), 0.16);
  return out.set(X, Y, Z);
}

/** UV of a sphere direction, matching THREE.SphereGeometry. */
export function sphereUv(xu: number, yu: number, zu: number): [number, number] {
  const theta = Math.acos(Math.max(-1, Math.min(1, yu)));
  let phi = Math.atan2(zu, -xu);
  if (phi < 0) phi += Math.PI * 2;
  return [phi / (Math.PI * 2), 1 - theta / Math.PI];
}

export interface ShellOptions {
  segW: number;
  segH: number;
  /** Which unit-sphere directions belong to this surface. */
  mask?: (xu: number, yu: number, zu: number) => boolean;
  /** Outward offset in metres. */
  inflate?: (xu: number, yu: number, zu: number) => number;
  /** Vertex shade (ambient occlusion / colour variation). */
  shade?: (xu: number, yu: number, zu: number) => number;
}

/** Head-shaped surface in character space (indexed, with uv and a `color` shade attribute). */
export function headSurface(s: HeadStyle, o: ShellOptions): THREE.BufferGeometry {
  const sphere = new THREE.SphereGeometry(1, o.segW, o.segH);
  const pos = sphere.getAttribute('position') as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const keep = new Uint8Array(pos.count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    const xu = pos.getX(i);
    const yu = pos.getY(i);
    const zu = pos.getZ(i);
    sculpt(xu, yu, zu, s, p);
    const inf = o.inflate?.(xu, yu, zu) ?? 0;
    if (inf) {
      n.set(xu / 0.073, yu / 0.115, zu / 0.096).normalize();
      p.addScaledVector(n, inf);
    }
    p.add(HEAD_C);
    pos.setXYZ(i, p.x, p.y, p.z);
    const sh = o.shade?.(xu, yu, zu) ?? 1;
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = sh;
    keep[i] = !o.mask || o.mask(xu, yu, zu) ? 1 : 0;
  }
  sphere.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (o.mask) {
    // Drop only triangles entirely outside the mask. Edge triangles stay, and their outside
    // vertices sink just under the skin (the caller's inflate goes negative there), so hair
    // and beard edges taper smoothly into the skin instead of stepping along triangles.
    const idx = sphere.index!;
    const kept: number[] = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
      if (keep[a] || keep[b] || keep[c]) kept.push(a, b, c);
    }
    sphere.setIndex(kept);
  }
  return sphere;
}

/** Small deterministic noise for hair clumping. */
export function tuft(xu: number, yu: number, zu: number, k: number): number {
  return Math.sin(xu * 23.1 + zu * 7.7 + k) * Math.sin(yu * 19.3 + xu * 5.1 + k * 2.3) * 0.5 + 0.5;
}

// ---------------------------------------------------------------- face texture

export interface FacePaint {
  skin: string;
  hair: string;
  female: boolean;
  beard: boolean;
  stubble: boolean;
  seed: number;
}

const faceCache = new Map<string, THREE.Texture>();

/** Painted skin for the sculpted head (sphere UVs: u = 0.25 is the middle of the face). */
export function faceTexture(f: FacePaint): THREE.Texture {
  const key = JSON.stringify(f);
  const hit = faceCache.get(key);
  if (hit) return hit;
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const skin = new THREE.Color(f.skin);
  const css = (col: THREE.Color, a = 1) => `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
  ctx.fillStyle = f.skin;
  ctx.fillRect(0, 0, W, H);
  // Mapping from a unit-sphere front point to canvas pixels.
  const P = (xu: number, yu: number): [number, number] => {
    const zu = Math.sqrt(Math.max(0, 1 - xu * xu - yu * yu));
    const [u, v] = sphereUv(xu, yu, zu);
    return [u * W, (1 - v) * H];
  };
  const blob = (xu: number, yu: number, rx: number, ry: number, col: string) => {
    const [x, y] = P(xu, yu);
    const [x2] = P(Math.min(0.98, xu + rx), yu);
    const [, y2] = P(xu, Math.max(-0.98, yu - ry));
    const r = Math.max(4, Math.abs(x2 - x));
    const sy = Math.max(2, Math.abs(y2 - y)) / r;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, sy);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.restore();
  };
  // Skin variation: faint mottling and pores.
  let s = Math.floor(f.seed * 1e6) + 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i += 1) {
    const v = rnd();
    ctx.fillStyle = v > 0.5 ? 'rgba(255,230,210,0.05)' : 'rgba(90,40,30,0.05)';
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  // Warmth: cheeks, nose, ears side, lips.
  const warm = skin.clone().lerp(new THREE.Color('#b8443a'), 0.35);
  for (const sx of [-1, 1]) blob(0.5 * sx, -0.18, 0.2, 0.16, css(warm, f.female ? 0.14 : 0.08));
  blob(0, -0.12, 0.1, 0.16, css(warm, 0.08));
  // Eye socket shading and lash line.
  const shadow = skin.clone().multiplyScalar(0.62);
  for (const sx of [-1, 1]) {
    blob(0.4 * sx, 0.1, 0.2, 0.09, css(shadow, 0.55));
    const [x0, y0] = P(0.27 * sx, 0.13);
    const [x1, y1] = P(0.55 * sx, 0.12);
    ctx.strokeStyle = `rgba(20,14,10,${f.female ? 0.9 : 0.6})`;
    ctx.lineWidth = f.female ? 4 : 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, y0 - 6, x1, y1);
    ctx.stroke();
  }
  // Eyebrows: short strokes along an arch.
  const brow = new THREE.Color(f.hair);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 70; i += 1) {
      const t = i / 70;
      const xu = (0.18 + t * 0.44) * sx;
      const yu = 0.235 + Math.sin(t * Math.PI) * 0.035 - t * 0.02 + (rnd() - 0.5) * 0.02;
      const [x, y] = P(xu, yu);
      const thick = (f.female ? 3.2 : 7) * (1 - t * 0.5);
      ctx.strokeStyle = css(brow, f.female ? 0.55 : 0.7);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y + thick * 0.5);
      ctx.lineTo(x + 6 * sx * (0.5 + t), y - thick * 0.5);
      ctx.stroke();
    }
  }
  // Lips.
  const lip = skin.clone().lerp(new THREE.Color(f.female ? '#9c3b40' : '#8a4a42'), f.female ? 0.5 : 0.35).multiplyScalar(0.92);
  const lipY = 0.13 - (0.36 + f.seed * 0.06) - 0.2;
  blob(0, lipY + 0.035, f.female ? 0.26 : 0.24, 0.035, css(lip, 0.95));
  blob(0, lipY - 0.055, f.female ? 0.25 : 0.22, 0.05, css(lip, 0.95));
  {
    const [x0, y0] = P(-0.24, lipY);
    const [x1, y1] = P(0.24, lipY);
    ctx.strokeStyle = 'rgba(40,18,14,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2, y0 + 3, x1, y1);
    ctx.stroke();
  }
  // Nostrils.
  for (const sx of [-1, 1]) blob(0.1 * sx, 0.13 - (0.36 + f.seed * 0.06) - 0.03, 0.05, 0.02, 'rgba(40,20,14,0.6)');
  // Stubble / beard shadow on the lower face.
  if (f.beard || f.stubble) {
    const st = new THREE.Color(f.hair);
    for (let i = 0; i < (f.beard ? 22000 : 9000); i += 1) {
      const xu = (rnd() * 2 - 1) * 0.95;
      const yu = -0.25 - rnd() * 0.75;
      if (Math.abs(xu) < 0.26 && yu < lipY + 0.07 && yu > lipY - 0.1) continue;
      const [x, y] = P(xu, yu);
      ctx.fillStyle = css(st, f.beard ? 0.25 : 0.12);
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  // Hairline: hair colour on the scalp so the hair cap never shows skin through gaps.
  ctx.fillStyle = css(new THREE.Color(f.hair).multiplyScalar(0.8), 1);
  ctx.fillRect(0, 0, W, H * 0.14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  faceCache.set(key, t);
  return t;
}

/**
 * Hair-card texture: a clump of fine wavy strands on transparency, roots at v = 0 and
 * tapering to a point at v = 1. Drawn in light greys; the material colour tints it.
 */
let hairCardTex: THREE.Texture | null = null;
export function hairCardTexture(): THREE.Texture {
  if (hairCardTex) return hairCardTex;
  const W = 128;
  const H = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  let s = 99;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i += 1) {
    // Roots spread across the card base; tips converge toward the clump's point.
    const x0 = 8 + rnd() * (W - 16);
    const tipX = W / 2 + (x0 - W / 2) * (0.15 + rnd() * 0.3);
    const len = 0.65 + rnd() * 0.35;
    const wave = (rnd() - 0.5) * 18;
    const v = Math.round(150 + rnd() * 105);
    const steps = 14;
    for (let k = 0; k < steps; k += 1) {
      const t0 = (k / steps) * len;
      const t1 = ((k + 1) / steps) * len;
      const px = (t: number) => x0 + (tipX - x0) * (t / len) + Math.sin(t * 7 + i) * wave * t;
      // Canvas y: H at the root (v = 0) to 0 at the tip.
      ctx.strokeStyle = `rgba(${v},${v},${v},${1 - Math.pow(t0 / len, 3) * 0.7})`;
      ctx.lineWidth = (2.6 - 1.8 * (t0 / len)) * (0.7 + rnd() * 0.6);
      ctx.beginPath();
      ctx.moveTo(px(t0), H - t0 * H);
      ctx.lineTo(px(t1), H - t1 * H);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  hairCardTex = t;
  return t;
}

/** Short beard hair: dense fine dark strokes on transparency, tiled over the beard shell. */
let beardTex: THREE.Texture | null = null;
export function beardTexture(): THREE.Texture {
  if (beardTex) return beardTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  ctx.lineCap = 'round';
  for (let i = 0; i < 2600; i += 1) {
    const x = rnd() * S;
    const y = rnd() * S;
    const a = Math.PI / 2 + (rnd() - 0.5) * 1.2;
    const l = 4 + rnd() * 9;
    const v = Math.round(150 + rnd() * 100);
    ctx.strokeStyle = `rgba(${v},${v},${v},${0.75 + rnd() * 0.25})`;
    ctx.lineWidth = 1 + rnd() * 1.4;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      ctx.beginPath();
      ctx.moveTo(x + ox, y + oy);
      ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(26, 13);
  t.anisotropy = 8;
  beardTex = t;
  return t;
}

/** Fine strand relief for hair (normal map, tiles). */
let hairNormalTex: THREE.Texture | null = null;
export function hairNormal(): THREE.Texture {
  if (hairNormalTex) return hairNormalTex;
  const S = 128;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const wob = Math.sin((y / S) * Math.PI * 4 + x * 0.3) * 2;
      h[y * S + x] = Math.sin(((x + wob) / S) * Math.PI * 2 * 26) * 0.5 + Math.sin(((x * 1.7 + wob) / S) * Math.PI * 2 * 11) * 0.3;
    }
  }
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      const l = h[y * S + ((x - 1 + S) % S)];
      const r = h[y * S + ((x + 1) % S)];
      const d = h[((y - 1 + S) % S) * S + x];
      const u = h[((y + 1) % S) * S + x];
      const n = new THREE.Vector3((l - r) * 1.4, (d - u) * 0.4, 1).normalize();
      const i = (y * S + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(22, 7);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  hairNormalTex = t;
  return t;
}
