// Helpers for building structures from PBR-textured primitives with world-scale UVs.

import * as THREE from 'three';
import { loadPbr } from '../render/textures.ts';
import type { PhysicsWorld } from '../physics/physics.ts';

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export interface MatOptions {
  color?: string;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
}

/** PBR material from a Poly Haven texture set (UVs are expected in metres / tile size). */
export async function pbrMaterial(slug: string, o: MatOptions = {}): Promise<THREE.MeshStandardMaterial> {
  const key = `${slug}|${JSON.stringify(o)}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const set = await loadPbr(slug);
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.roughnessMap,
    color: new THREE.Color(o.color ?? '#ffffff'),
    roughness: o.roughness ?? 1,
    metalness: o.metalness ?? 0,
    normalScale: new THREE.Vector2(o.normalScale ?? 1, o.normalScale ?? 1),
  });
  m.name = slug;
  matCache.set(key, m);
  return m;
}

/** Box with UVs in world units divided by `tile` (metres per texture repeat). */
export function texBox(w: number, h: number, d: number, tile: number, rotateUv = false): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z (4 verts each).
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f += 1) {
    const [a, b] = dims[f];
    for (let k = 0; k < 4; k += 1) {
      const i = f * 4 + k;
      let u = uv.getX(i) * (a / tile);
      let v = uv.getY(i) * (b / tile);
      if (rotateUv) [u, v] = [v, u];
      uv.setXY(i, u, v);
    }
  }
  return g;
}

export function texCylinder(r: number, h: number, tile: number, radial = 10, along = false): THREE.CylinderGeometry {
  const g = new THREE.CylinderGeometry(r, r, h, radial, 1);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const circ = 2 * Math.PI * r;
  for (let i = 0; i < uv.count; i += 1) {
    if (along) uv.setXY(i, uv.getY(i) * (h / tile), uv.getX(i) * (circ / tile));
    else uv.setXY(i, uv.getX(i) * (circ / tile), uv.getY(i) * (h / tile));
  }
  return g;
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Registers box colliders for meshes in a group (world transforms; axis-aligned boxes in local space). */
export function collideBox(physics: PhysicsWorld, obj: THREE.Mesh, pad = 0): ReturnType<PhysicsWorld['addBox']> {
  obj.updateWorldMatrix(true, false);
  const geo = obj.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = bb.getSize(new THREE.Vector3());
  const centre = bb.getCenter(new THREE.Vector3());
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  obj.matrixWorld.decompose(pos, quat, scl);
  const c = centre.clone().multiply(scl).applyQuaternion(quat).add(pos);
  return physics.addBox({
    x: c.x,
    y: c.y,
    z: c.z,
    hx: (size.x * scl.x) / 2 + pad,
    hy: (size.y * scl.y) / 2 + pad,
    hz: (size.z * scl.z) / 2 + pad,
    quat: { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
  });
}

/** A wall along X of given length with rectangular openings (x centre, width, bottom, top). */
export function wallWithOpenings(
  length: number,
  height: number,
  thick: number,
  openings: { x: number; w: number; y0: number; y1: number }[],
  mat: THREE.Material,
  tile: number,
): THREE.Mesh[] {
  const parts: THREE.Mesh[] = [];
  const sorted = [...openings].sort((a, b) => a.x - b.x);
  let cursor = -length / 2;
  for (const o of sorted) {
    const left = o.x - o.w / 2;
    if (left > cursor + 0.01) {
      const w = left - cursor;
      parts.push(mesh(texBox(w, height, thick, tile), mat, cursor + w / 2, height / 2, 0));
    }
    if (o.y0 > 0.01) parts.push(mesh(texBox(o.w, o.y0, thick, tile), mat, o.x, o.y0 / 2, 0));
    if (o.y1 < height - 0.01) parts.push(mesh(texBox(o.w, height - o.y1, thick, tile), mat, o.x, (height + o.y1) / 2, 0));
    cursor = o.x + o.w / 2;
  }
  if (cursor < length / 2 - 0.01) {
    const w = length / 2 - cursor;
    parts.push(mesh(texBox(w, height, thick, tile), mat, cursor + w / 2, height / 2, 0));
  }
  return parts;
}

/** Canvas-texture sign board. */
export function signTexture(lines: { text: string; size: number; weight?: number; color?: string; gap?: number }[], opts: { w: number; h: number; bg: string; border?: string; weathered?: boolean }): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = opts.w;
  c.height = opts.h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = opts.bg;
  ctx.fillRect(0, 0, opts.w, opts.h);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 10;
    ctx.strokeRect(14, 14, opts.w - 28, opts.h - 28);
  }
  const total = lines.reduce((s, l) => s + l.size * 1.25 + (l.gap ?? 0), 0);
  let y = (opts.h - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const l of lines) {
    ctx.fillStyle = l.color ?? '#e8e2cf';
    ctx.font = `${l.weight ?? 600} ${l.size}px "Segoe UI", Arial, sans-serif`;
    ctx.fillText(l.text, opts.w / 2, y);
    y += l.size * 1.25 + (l.gap ?? 0);
  }
  if (opts.weathered) {
    for (let i = 0; i < 2600; i += 1) {
      ctx.fillStyle = `rgba(${40 + Math.random() * 40}, ${35 + Math.random() * 30}, 25, ${Math.random() * 0.18})`;
      ctx.fillRect(Math.random() * opts.w, Math.random() * opts.h, 1 + Math.random() * 6, 1 + Math.random() * 3);
    }
    const g = ctx.createLinearGradient(0, 0, 0, opts.h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(40,30,15,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, opts.w, opts.h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
