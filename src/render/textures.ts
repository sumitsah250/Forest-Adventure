// Texture loading helpers: plain PBR sets, layered array textures for the terrain,
// and small procedural textures generated on canvases.

import * as THREE from 'three';

const BASE = `${import.meta.env.BASE_URL}assets/`;

export function assetUrl(rel: string): string {
  return BASE + rel;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(rel: string): Promise<HTMLImageElement> {
  let p = imageCache.get(rel);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${rel}`));
      img.src = assetUrl(rel);
    });
    imageCache.set(rel, p);
  }
  return p;
}

export interface PbrSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

let maxAniso = 4;
export function setMaxAnisotropy(value: number): void {
  maxAniso = value;
}

function imageTexture(img: HTMLImageElement, srgb: boolean, repeat: number): THREE.Texture {
  const tex = new THREE.Texture(img);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  tex.anisotropy = maxAniso;
  tex.needsUpdate = true;
  return tex;
}

const pbrCache = new Map<string, Promise<PbrSet>>();

/** Loads public/assets/textures/<slug>/{diff,nor_gl,rough}.jpg. */
export function loadPbr(slug: string): Promise<PbrSet> {
  let p = pbrCache.get(slug);
  if (!p) {
    p = Promise.all([
      loadImage(`textures/${slug}/diff.jpg`),
      loadImage(`textures/${slug}/nor_gl.jpg`),
      loadImage(`textures/${slug}/rough.jpg`),
    ]).then(([d, n, r]) => ({
      map: imageTexture(d, true, 1),
      normalMap: imageTexture(n, false, 1),
      roughnessMap: imageTexture(r, false, 1),
    }));
    pbrCache.set(slug, p);
  }
  return p;
}

/** Clones a PBR set with its own repeat (textures share the same image). */
export function pbrWithRepeat(set: PbrSet, rx: number, ry = rx): PbrSet {
  const c = (t: THREE.Texture) => {
    const k = t.clone();
    k.repeat.set(rx, ry);
    k.needsUpdate = true;
    return k;
  };
  return { map: c(set.map), normalMap: c(set.normalMap), roughnessMap: c(set.roughnessMap) };
}

function pixels(img: HTMLImageElement | HTMLCanvasElement, size: number): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

export interface TerrainArrays {
  /** RGB albedo (sRGB) + A height. */
  albedo: THREE.DataArrayTexture;
  /** RGB tangent-space normal (GL) + A roughness. */
  normal: THREE.DataArrayTexture;
}

/** Packs several PBR layers into two array textures sampled by the terrain shader. */
export async function buildTerrainArrays(slugs: string[], size: number): Promise<TerrainArrays> {
  const layers = slugs.length;
  const albedo = new Uint8Array(size * size * 4 * layers);
  const normal = new Uint8Array(size * size * 4 * layers);
  const loaded = await Promise.all(
    slugs.map((slug) =>
      Promise.all([
        loadImage(`textures/${slug}/diff.jpg`),
        loadImage(`textures/${slug}/disp.jpg`),
        loadImage(`textures/${slug}/nor_gl.jpg`),
        loadImage(`textures/${slug}/rough.jpg`),
      ]),
    ),
  );
  loaded.forEach(([d, h, n, r], layer) => {
    const dp = pixels(d, size);
    const hp = pixels(h, size);
    const np = pixels(n, size);
    const rp = pixels(r, size);
    const off = layer * size * size * 4;
    for (let i = 0; i < size * size; i += 1) {
      const o = off + i * 4;
      albedo[o] = dp[i * 4];
      albedo[o + 1] = dp[i * 4 + 1];
      albedo[o + 2] = dp[i * 4 + 2];
      albedo[o + 3] = hp[i * 4];
      normal[o] = np[i * 4];
      normal[o + 1] = np[i * 4 + 1];
      normal[o + 2] = np[i * 4 + 2];
      normal[o + 3] = rp[i * 4];
    }
  });
  const make = (data: Uint8Array, srgb: boolean) => {
    const tex = new THREE.DataArrayTexture(data, size, size, layers);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = maxAniso;
    tex.needsUpdate = true;
    return tex;
  };
  return { albedo: make(albedo, true), normal: make(normal, false) };
}

/** Tiling multi-octave value noise (R large, G medium, B fine), used to break up repetition. */
export function makeMacroNoise(size = 256, seed = 9): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const octave = (cells: number) => {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
    return (x: number, y: number) => {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx);
      const sy = ty * ty * (3 - 2 * ty);
      const g = (ix: number, iy: number) => grid[((iy + cells) % cells) * cells + ((ix + cells) % cells)];
      const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
      const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const o = [octave(4), octave(8), octave(16), octave(32), octave(64)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const k = (y * size + x) * 4;
      data[k] = (o[0](x, y) * 0.6 + o[1](x, y) * 0.4) * 255;
      data[k + 1] = (o[1](x, y) * 0.5 + o[2](x, y) * 0.5) * 255;
      data[k + 2] = (o[3](x, y) * 0.55 + o[4](x, y) * 0.45) * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/** Canvas helper returning a texture; draw callback receives a 2D context. */
export function canvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = maxAniso;
  return tex;
}
