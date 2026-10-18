// Builds one 2048² foliage atlas at load time:
//  - conifer sprays, pine tufts and dead twigs drawn stroke by stroke,
//  - broadleaf clusters assembled from photographed leaves (Poly Haven shrubs),
//  - fern fronds and grass clumps cut from their Poly Haven atlases.

import * as THREE from 'three';
import { loadImage } from './textures.ts';
import { mulberry32, range, type Rng } from '../world/rng.ts';

export const ATLAS_SIZE = 2048;

export interface AtlasRegion {
  /** UV rectangle: u0,v0 bottom-left; u1,v1 top-right (three's flipY convention). */
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface FoliageAtlas {
  texture: THREE.Texture;
  /** Source canvas (kept for debugging/inspection). */
  canvas: HTMLCanvasElement;
  regions: Record<string, AtlasRegion>;
  ferns: AtlasRegion[];
  grass: AtlasRegion[];
}

type Rect = [number, number, number, number];

function region([x, y, w, h]: Rect): AtlasRegion {
  const S = ATLAS_SIZE;
  return { u0: x / S, u1: (x + w) / S, v0: 1 - (y + h) / S, v1: 1 - y / S };
}

/** Diffuse + grayscale alpha mask → RGBA canvas. */
async function rgbaSource(slug: string, diff = 'diff'): Promise<HTMLCanvasElement> {
  const [d, a] = await Promise.all([loadImage(`foliage/${slug}/${diff}.jpg`), loadImage(`foliage/${slug}/alpha.jpg`)]);
  const size = d.width;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(a, 0, 0, size, size);
  const mask = ctx.getImageData(0, 0, size, size).data;
  ctx.drawImage(d, 0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i += 1) {
    const m = mask[i * 4];
    img.data[i * 4 + 3] = m < 40 ? 0 : Math.min(255, (m - 40) * 1.3);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

interface SprayStyle {
  colors: string[];
  tip: string;
  twig: string;
  needle: [number, number];
  density: number;
  laterals: number;
  spread: number;
  width: number;
}

function hexMix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

/** One axis of a spray: twig line plus paired needles along it, recursing into laterals. */
function drawAxis(
  ctx: CanvasRenderingContext2D, rng: Rng, style: SprayStyle,
  x: number, y: number, angle: number, length: number, depth: number, shade: number,
): void {
  const steps = Math.max(4, Math.floor(length / 1.7));
  const bend = range(rng, -0.25, 0.25) / length;
  let px = x;
  let py = y;
  let a = angle;
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    pts.push([px, py, a]);
    a += bend * (length / steps);
    px += Math.cos(a) * (length / steps);
    py += Math.sin(a) * (length / steps);
  }
  // Twig.
  ctx.strokeStyle = style.twig;
  ctx.lineCap = 'round';
  ctx.lineWidth = depth === 0 ? 2.6 : depth === 1 ? 1.6 : 1.0;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.stroke();

  // Laterals first so needles of the parent axis overlap them.
  if (depth < 2) {
    const count = depth === 0 ? style.laterals : Math.max(3, Math.floor(style.laterals * 0.5));
    for (let k = 0; k < count; k += 1) {
      const t = 0.06 + (k / count) * 0.86 + range(rng, -0.02, 0.02);
      const idx = Math.min(pts.length - 1, Math.floor(t * steps));
      const [lx, ly, la] = pts[idx];
      const side = k % 2 === 0 ? 1 : -1;
      const len = length * (depth === 0 ? 0.62 : 0.5) * (1 - t * 0.62) * range(rng, 0.82, 1.12) * style.spread;
      drawAxis(ctx, rng, style, lx, ly, la + side * range(rng, 0.78, 1.08), len, depth + 1, shade * 0.95);
    }
  }

  // Needles.
  const [nmin, nmax] = style.needle;
  ctx.lineWidth = style.width;
  for (let i = 0; i < pts.length; i += 1) {
    const t = i / (pts.length - 1);
    const [nx, ny, na] = pts[i];
    for (let s = -1; s <= 1; s += 2) {
      if (rng() > style.density) continue;
      const len = range(rng, nmin, nmax) * (1 - t * 0.35) * (depth === 2 ? 0.85 : 1);
      const ang = na + s * range(rng, 0.9, 1.35) - s * 0.25 * t;
      const tipT = t > 0.82 ? (t - 0.82) / 0.18 : 0;
      const base = style.colors[Math.floor(rng() * style.colors.length)];
      ctx.strokeStyle = base.startsWith('#') ? hexMix(base, style.tip, tipT * 0.8 * rng()) : base;
      ctx.globalAlpha = 0.85 + rng() * 0.15;
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(nx + Math.cos(ang) * len, ny + Math.sin(ang) * len);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  void shade;
}

function drawSpray(ctx: CanvasRenderingContext2D, rect: Rect, seed: number, style: SprayStyle): void {
  const [x, y, w, h] = rect;
  const rng = mulberry32(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, w - 4, h - 4);
  ctx.clip();
  // A darker back layer of shoots fills the gaps the way deeper twigs do on a real branch.
  const back: SprayStyle = {
    ...style,
    colors: style.colors.map((c) => hexMix(c, '#000000', 0.38)),
    tip: hexMix(style.tip, '#000000', 0.4),
    laterals: Math.round(style.laterals * 0.8),
  };
  for (let k = 0; k < 3; k += 1) {
    const ox = x + w / 2 + (k - 1) * w * 0.17;
    drawAxis(ctx, rng, back, ox, y + h - 30 - k * 12, -Math.PI / 2 + (k - 1) * 0.42, h * range(rng, 0.62, 0.74), 1, 0.7);
  }
  drawAxis(ctx, rng, style, x + w / 2, y + h - 6, -Math.PI / 2, h * 0.9, 0, 1);
  // Subtle darkening at the base where the spray is shaded by the tree.
  const grad = ctx.createLinearGradient(0, y + h, 0, y);
  grad.addColorStop(0, 'rgba(0,0,0,0.35)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0.08)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

function drawPineTufts(ctx: CanvasRenderingContext2D, rect: Rect, seed: number): void {
  const [x, y, w, h] = rect;
  const rng = mulberry32(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, w - 4, h - 4);
  ctx.clip();
  const colors = ['#3c4a26', '#4a5a2c', '#56662f', '#34411f', '#5f6e36'];
  ctx.lineCap = 'round';
  // Main branch with forks; each fork ends in a brush of long needles.
  const tips: [number, number, number][] = [];
  const branch = (bx: number, by: number, a: number, len: number, depth: number) => {
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    ctx.strokeStyle = '#4b3a2a';
    ctx.lineWidth = Math.max(1.2, 4.5 - depth * 1.1);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    if (depth > 0) tips.push([bx + (ex - bx) * 0.5, by + (ey - by) * 0.5, a]);
    if (depth < 3) {
      const forks = depth === 0 ? 4 : depth === 1 ? 3 : 2;
      for (let i = 0; i < forks; i += 1) {
        const spread = depth === 0 ? (i / (forks - 1) - 0.5) * 1.9 : range(rng, -0.7, 0.7);
        branch(ex, ey, a + spread + range(rng, -0.12, 0.12), len * range(rng, 0.62, 0.8), depth + 1);
      }
    } else {
      tips.push([ex, ey, a]);
    }
  };
  branch(x + w / 2, y + h - 4, -Math.PI / 2, h * 0.24, 0);
  for (const [tx, ty, ta] of tips) {
    const n = 56;
    for (let i = 0; i < n; i += 1) {
      const back = range(rng, 0, 26);
      const ox = tx - Math.cos(ta) * back;
      const oy = ty - Math.sin(ta) * back;
      const ang = ta + range(rng, -1.25, 1.25);
      const len = range(rng, 28, 52);
      ctx.strokeStyle = colors[Math.floor(rng() * colors.length)];
      ctx.lineWidth = range(rng, 1.1, 1.8);
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.quadraticCurveTo(ox + Math.cos(ang) * len * 0.5, oy + Math.sin(ang) * len * 0.5 - 3, ox + Math.cos(ang) * len, oy + Math.sin(ang) * len);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawDeadTwigs(ctx: CanvasRenderingContext2D, rect: Rect, seed: number): void {
  const [x, y, w, h] = rect;
  const rng = mulberry32(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, w - 4, h - 4);
  ctx.clip();
  ctx.lineCap = 'round';
  const twig = (bx: number, by: number, a: number, len: number, width: number, depth: number) => {
    let px = bx;
    let py = by;
    const segs = 6;
    ctx.strokeStyle = rng() > 0.5 ? '#5a5248' : '#4a4038';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(px, py);
    for (let i = 0; i < segs; i += 1) {
      a += range(rng, -0.22, 0.22);
      px += (Math.cos(a) * len) / segs;
      py += (Math.sin(a) * len) / segs;
      ctx.lineTo(px, py);
      if (depth < 3 && rng() < 0.45) twig(px, py, a + (rng() > 0.5 ? 1 : -1) * range(rng, 0.5, 1.1), len * 0.45, width * 0.6, depth + 1);
      // A few clinging brown needles and lichen flecks.
      if (rng() < 0.3) {
        ctx.save();
        ctx.fillStyle = rng() > 0.5 ? '#7e7a5d' : '#6b5a3f';
        ctx.fillRect(px + range(rng, -3, 3), py + range(rng, -3, 3), 2, 2);
        ctx.restore();
      }
    }
    ctx.stroke();
  };
  twig(x + w / 2, y + h - 4, -Math.PI / 2, h * 0.85, 7, 0);
  twig(x + w / 2 - 20, y + h - 60, -Math.PI / 2 - 0.5, h * 0.5, 4, 1);
  twig(x + w / 2 + 20, y + h - 90, -Math.PI / 2 + 0.55, h * 0.45, 4, 1);
  ctx.restore();
}

interface LeafSprite { src: HTMLCanvasElement; rect: Rect }

/**
 * `autumn` turns the photographed green leaves yellow-to-orange, leaf by leaf, so a
 * cluster mixes colours the way aspens and maples do in mid-October.
 */
function drawLeafCluster(ctx: CanvasRenderingContext2D, rect: Rect, seed: number, leaves: LeafSprite[], tint: string, leafScale: number, autumn = 0): void {
  const [x, y, w, h] = rect;
  const rng = mulberry32(seed);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 2, y + 2, w - 4, h - 4);
  ctx.clip();
  ctx.lineCap = 'round';
  const twigPts: [number, number, number][] = [];
  const twig = (bx: number, by: number, a: number, len: number, width: number, depth: number) => {
    const ex = bx + Math.cos(a) * len;
    const ey = by + Math.sin(a) * len;
    ctx.strokeStyle = '#4a3c30';
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.quadraticCurveTo((bx + ex) / 2 + range(rng, -8, 8), (by + ey) / 2, ex, ey);
    ctx.stroke();
    for (let i = 1; i <= 4; i += 1) {
      const t = i / 4;
      twigPts.push([bx + (ex - bx) * t, by + (ey - by) * t, a]);
    }
    if (depth < 2) {
      const n = depth === 0 ? 4 : 2;
      for (let i = 0; i < n; i += 1) {
        const t = 0.3 + (i / n) * 0.6;
        twig(bx + (ex - bx) * t, by + (ey - by) * t, a + (i % 2 ? 1 : -1) * range(rng, 0.5, 0.95), len * 0.5, width * 0.6, depth + 1);
      }
    }
  };
  twig(x + w / 2, y + h - 4, -Math.PI / 2, h * 0.62, 3.2, 0);
  // Leaves, back to front with slight colour variation.
  const count = 96;
  for (let i = 0; i < count; i += 1) {
    const [px, py, a] = twigPts[Math.floor(rng() * twigPts.length)];
    const leaf = leaves[Math.floor(rng() * leaves.length)];
    const [sx, sy, sw, sh] = leaf.rect;
    const s = range(rng, 0.75, 1.15) * leafScale;
    const lw = sw * s;
    const lh = sh * s;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(a + Math.PI / 2 + range(rng, -1.2, 1.2));
    const turn = autumn > 0 ? range(rng, 0.45, 1) * autumn : 0;
    // Sepia + saturation turns olive leaves golden; a small hue shift pushes the most
    // turned ones toward orange. Some leaves stay yellow-green.
    ctx.filter = turn > 0
      ? `sepia(${(0.35 + 0.45 * turn).toFixed(2)}) saturate(${(1.5 + 1.2 * turn).toFixed(2)}) hue-rotate(${(-4 - 16 * turn * autumn).toFixed(0)}deg) brightness(${range(rng, 1.0, 1.3).toFixed(2)})`
      : `brightness(${range(rng, 0.72, 1.02).toFixed(2)}) saturate(${range(rng, 0.75, 1.05).toFixed(2)})`;
    ctx.drawImage(leaf.src, sx, sy, sw, sh, -lw / 2, -lh, lw, lh);
    ctx.restore();
  }
  ctx.filter = 'none';
  // Unify the cluster colour with a soft multiply tint.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = tint;
  ctx.fillRect(x, y, w, h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/**
 * Canvas pixels with zero alpha lose their colour (premultiplied storage), which
 * makes alpha-tested foliage turn dark in distant mip levels. Copy the pixels into
 * a data texture and push neighbouring colours into transparent texels.
 */
function bleedToTexture(ctx: CanvasRenderingContext2D): THREE.DataTexture {
  const S = ATLAS_SIZE;
  const src = ctx.getImageData(0, 0, S, S).data;
  const data = new Uint8Array(S * S * 4);
  // Flip rows so canvas top maps to v = 1 like a regular image texture.
  for (let y = 0; y < S; y += 1) {
    data.set(src.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
  }
  const known = new Uint8Array(S * S);
  let mr = 0;
  let mg = 0;
  let mb = 0;
  let mn = 0;
  for (let i = 0; i < S * S; i += 1) {
    if (data[i * 4 + 3] > 24) {
      known[i] = 1;
      mr += data[i * 4];
      mg += data[i * 4 + 1];
      mb += data[i * 4 + 2];
      mn += 1;
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    const add: number[] = [];
    for (let y = 1; y < S - 1; y += 1) {
      for (let x = 1; x < S - 1; x += 1) {
        const i = y * S + x;
        if (known[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        const take = (j: number) => {
          if (known[j]) {
            r += data[j * 4];
            g += data[j * 4 + 1];
            b += data[j * 4 + 2];
            n += 1;
          }
        };
        take(i - 1);
        take(i + 1);
        take(i - S);
        take(i + S);
        if (n) {
          data[i * 4] = r / n;
          data[i * 4 + 1] = g / n;
          data[i * 4 + 2] = b / n;
          add.push(i);
        }
      }
    }
    for (const i of add) known[i] = 1;
  }
  if (mn) {
    for (let i = 0; i < S * S; i += 1) {
      if (!known[i]) {
        data[i * 4] = mr / mn;
        data[i * 4 + 1] = mg / mn;
        data[i * 4 + 2] = mb / mn;
      }
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export async function buildFoliageAtlas(maxAniso: number): Promise<FoliageAtlas> {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const ctx = canvas.getContext('2d')!;
  const [fern, grass, shrub2, shrub4] = await Promise.all([
    rgbaSource('fern_02'),
    rgbaSource('grass_medium_01'),
    rgbaSource('shrub_02'),
    rgbaSource('shrub_04'),
  ]);

  const fir: SprayStyle = {
    colors: ['#24321f', '#2c3b25', '#33432a', '#3a4a2f', '#2a3824'],
    tip: '#6d7d45',
    twig: '#4b3d2c',
    needle: [9, 14],
    density: 0.95,
    laterals: 18,
    spread: 1,
    width: 1.6,
  };
  const spruce: SprayStyle = { ...fir, colors: ['#26332a', '#2e3b30', '#344437', '#3b4a3a', '#29362b'], tip: '#617a52', needle: [8, 12], laterals: 20, spread: 0.95, width: 1.5 };
  const young: SprayStyle = { ...fir, colors: ['#31432a', '#3a4d2f', '#425634', '#4a5d37'], tip: '#7b8d4c', needle: [8, 13], laterals: 15 };

  const R: Record<string, Rect> = {
    fir: [0, 0, 512, 512],
    spruce: [512, 0, 512, 512],
    pine: [1024, 0, 512, 512],
    dead: [1536, 0, 512, 512],
    leafA: [0, 512, 512, 512],
    leafB: [512, 512, 512, 512],
    bush: [1024, 512, 512, 512],
    young: [1536, 512, 512, 512],
    leafAutumnA: [830, 1468, 512, 512],
    leafAutumnB: [1350, 1468, 512, 512],
  };
  drawSpray(ctx, R.fir, 11, fir);
  drawSpray(ctx, R.spruce, 23, spruce);
  drawPineTufts(ctx, R.pine, 37);
  drawDeadTwigs(ctx, R.dead, 41);
  drawSpray(ctx, R.young, 53, young);
  const willow: LeafSprite[] = [
    { src: shrub2, rect: [175, 295, 140, 560] },
    { src: shrub2, rect: [525, 325, 115, 540] },
    { src: shrub2, rect: [695, 415, 120, 430] },
    { src: shrub2, rect: [845, 395, 120, 450] },
  ];
  const round: LeafSprite[] = [
    { src: shrub4, rect: [130, 95, 105, 240] },
    { src: shrub4, rect: [535, 75, 95, 265] },
    { src: shrub4, rect: [615, 390, 100, 210] },
    { src: shrub4, rect: [235, 650, 105, 290] },
    { src: shrub4, rect: [380, 710, 115, 240] },
    { src: shrub4, rect: [560, 695, 95, 210] },
  ];
  drawLeafCluster(ctx, R.leafA, 61, willow, 'rgba(34, 46, 22, 0.22)', 0.24);
  drawLeafCluster(ctx, R.leafB, 67, round, 'rgba(30, 44, 20, 0.25)', 0.4);
  drawLeafCluster(ctx, R.bush, 71, [...round, ...willow.slice(0, 2)], 'rgba(28, 38, 18, 0.3)', 0.36);
  drawLeafCluster(ctx, R.leafAutumnA, 73, round, 'rgba(60, 50, 12, 0.12)', 0.4, 0.8);
  drawLeafCluster(ctx, R.leafAutumnB, 79, willow, 'rgba(64, 44, 10, 0.12)', 0.24, 1);

  // Fern fronds: five photographed fronds, each in a 160x640 slot.
  const frondSrc: Rect[] = [
    [92, 105, 150, 865],
    [322, 18, 146, 765],
    [552, 22, 120, 485],
    [525, 518, 122, 470],
    [728, 100, 140, 795],
  ];
  const ferns: AtlasRegion[] = [];
  frondSrc.forEach(([sx, sy, sw, sh], i) => {
    const dst: Rect = [i * 164 + 2, 1028, 160, 636];
    ctx.drawImage(fern, sx, sy, sw, sh, dst[0], dst[1], dst[2], dst[3]);
    ferns.push(region(dst));
  });
  // Grass clumps (bottom of each clump at the bottom of its slot).
  const grassSrc: Rect[] = [
    [198, 758, 305, 152],
    [598, 768, 225, 118],
    [22, 884, 186, 122],
    [248, 902, 262, 108],
    [588, 893, 224, 114],
  ];
  const grassRegions: AtlasRegion[] = [];
  grassSrc.forEach(([sx, sy, sw, sh], i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const dst: Rect = [830 + col * 406, 1030 + row * 214, 400, 200];
    ctx.drawImage(grass, sx, sy, sw, sh, dst[0], dst[1], dst[2], dst[3]);
    grassRegions.push(region(dst));
  });
  // Brighten the grass and thicken the blades' alpha so the clumps keep their
  // coverage in distant mip levels instead of eroding into dark specks.
  {
    const img = ctx.getImageData(830, 1030, 1218, 428);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = Math.min(255, d[i] * 1.45 + 6);
      d[i + 1] = Math.min(255, d[i + 1] * 1.5 + 8);
      d[i + 2] = Math.min(255, d[i + 2] * 1.25);
      d[i + 3] = Math.min(255, d[i + 3] * 1.7);
    }
    ctx.putImageData(img, 830, 1030);
  }

  const texture = bleedToTexture(ctx);
  texture.anisotropy = maxAniso;

  const regions: Record<string, AtlasRegion> = {};
  for (const [k, r] of Object.entries(R)) regions[k] = region(r);
  return { texture, canvas, regions, ferns, grass: grassRegions };
}
