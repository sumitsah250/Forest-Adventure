// Forest-floor debris: mossy rocks and boulders, fallen logs, old stumps and
// scattered branches. Instanced (a few draw calls), with colliders for the big pieces.

import * as THREE from 'three';
import { Noise2D, smoothstep } from './noise.ts';
import { mulberry32, range, type Rng } from './rng.ts';
import { CLEARINGS, EXCLUSIONS, GRAVEL_PADS, WORLD_HALF } from './layout.ts';
import type { TerrainData } from './terrain.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { pbrMaterial, texCylinder } from './build.ts';

function rockGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const n = new Noise2D(seed);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const flat = range(rng, 0.45, 0.75);
  const squash = range(rng, 0.75, 1.15);
  for (let i = 0; i < pos.count; i += 1) {
    const v = new THREE.Vector3().fromBufferAttribute(pos, i);
    const d = 1 + 0.22 * n.fbm(v.x * 1.3 + v.y * 0.7, v.z * 1.3 - v.y * 0.5, 3) + 0.08 * Math.sin(v.x * 4 + v.z * 3);
    v.multiplyScalar(d);
    v.y *= flat;
    v.x *= squash;
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // Box-projected UVs (metres) so the rock texture doesn't smear.
  const nor = g.getAttribute('normal') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x * 0.45, z * 0.45);
    else if (ax >= az) uv.setXY(i, z * 0.45, y * 0.45);
    else uv.setXY(i, x * 0.45, y * 0.45);
    // Moss on upward faces, darker soil line at the base.
    const up = nor.getY(i);
    const moss = smoothstep(0.35, 0.85, up);
    const base = smoothstep(-0.15, 0.1, y);
    col.push((1 - moss * 0.22) * (0.6 + 0.4 * base) * 0.92, (1 - moss * 0.06) * (0.6 + 0.4 * base) * 0.92, (1 - moss * 0.3) * (0.6 + 0.4 * base) * 0.92);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function logGeometry(rng: Rng, length: number, radius: number): THREE.BufferGeometry {
  const g = texCylinder(radius, length, 1.4, 10, true);
  g.rotateZ(Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const col: number[] = [];
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const t = x / (length / 2);
    // Taper toward the top end and a slight bow.
    const taper = 1 - 0.25 * Math.max(0, t);
    pos.setY(i, pos.getY(i) * taper + Math.sin((t + 1) * 1.4) * 0.03 * length * 0.1);
    pos.setZ(i, pos.getZ(i) * taper);
    const y = pos.getY(i);
    const moss = smoothstep(radius * 0.2, radius * 0.9, y) * (0.6 + 0.4 * rng());
    col.push(1 - moss * 0.45, 1 - moss * 0.1, 1 - moss * 0.6);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function ringTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#7a5d40';
  x.fillRect(0, 0, 256, 256);
  for (let r = 120; r > 4; r -= 6 + Math.random() * 4) {
    x.strokeStyle = `rgba(${70 + Math.random() * 30}, ${50 + Math.random() * 20}, 30, 0.55)`;
    x.lineWidth = 1.5 + Math.random() * 2;
    x.beginPath();
    x.ellipse(128 + Math.random() * 3, 128 + Math.random() * 3, r, r * 0.96, 0, 0, Math.PI * 2);
    x.stroke();
  }
  // Weathering cracks and grey sun-bleaching.
  x.strokeStyle = 'rgba(40,30,20,0.6)';
  for (let i = 0; i < 6; i += 1) {
    const a = Math.random() * Math.PI * 2;
    x.beginPath();
    x.moveTo(128, 128);
    x.lineTo(128 + Math.cos(a) * 120, 128 + Math.sin(a) * 120);
    x.stroke();
  }
  x.fillStyle = 'rgba(150,145,135,0.35)';
  x.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Placed {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  tilt?: THREE.Quaternion;
}

export class Debris {
  readonly group = new THREE.Group();
  private terrain: TerrainData;
  private physics: PhysicsWorld;

  private constructor(terrain: TerrainData, physics: PhysicsWorld) {
    this.terrain = terrain;
    this.physics = physics;
    this.group.name = 'debris';
  }

  static async create(terrain: TerrainData, physics: PhysicsWorld, density: number): Promise<Debris> {
    const d = new Debris(terrain, physics);
    const [rock, bark] = await Promise.all([
      pbrMaterial('mossy_rock', { normalScale: 1.4 }),
      pbrMaterial('pine_bark', { color: '#9a8f82' }),
    ]);
    const rockMat = rock.clone();
    rockMat.vertexColors = true;
    const barkMat = bark.clone();
    barkMat.vertexColors = true;
    d.rocks(rockMat, density);
    d.logs(barkMat, density);
    d.stumps(bark, density);
    d.branches(barkMat, density);
    return d;
  }

  private free(x: number, z: number, roadMargin: number): boolean {
    const t = this.terrain;
    if (Math.abs(x) > WORLD_HALF - 8 || Math.abs(z) > WORLD_HALF - 8) return false;
    if (t.waterAt(x, z)) return false;
    const road = t.roadAt(x, z);
    if (road && Math.abs(road.signed) < road.path.halfWidth + roadMargin) return false;
    for (const e of EXCLUSIONS) if (Math.hypot(x - e.x, z - e.z) < e.r + 1.5) return false;
    for (const p of GRAVEL_PADS) if (Math.hypot(x - p.x, z - p.z) < p.r + 1) return false;
    return true;
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: Placed[], shadow = true): void {
    if (!items.length) return;
    const mesh = new THREE.InstancedMesh(geo, mat, items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromEuler(new THREE.Euler(0, it.rot, 0));
      if (it.tilt) q.premultiply(it.tilt);
      m.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(it.scale, it.scale, it.scale));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
  }

  private rocks(mat: THREE.Material, density: number): void {
    const rng = mulberry32(303);
    const t = this.terrain;
    const variants = [0, 1, 2, 3, 4].map((i) => rockGeometry(900 + i, 2));
    const lists: Placed[][] = variants.map(() => []);
    const add = (x: number, z: number, scale: number) => {
      const v = Math.floor(rng() * variants.length);
      const y = t.heightAt(x, z) + scale * 0.05;
      lists[v].push({ x, y, z, rot: rng() * Math.PI * 2, scale });
      if (scale > 0.55) this.physics.tag(this.physics.addBall(x, y + scale * 0.1, z, scale * 0.7), 'rock');
    };
    // Boulders along the creek banks and ravine walls, stones through the forest.
    const creek = t.creek;
    for (let s = 0; s < creek.length; s += 3.2 / density) {
      const p = creek.at(s);
      const c = t.creekAt(s);
      for (const side of [-1, 1]) {
        if (rng() > 0.45) continue;
        const off = c.channel + range(rng, 0.2, 5 + c.floor * 0.5);
        const x = p.x - p.tz * side * off;
        const z = p.z + p.tx * side * off;
        if (!this.free(x, z, 1.5)) continue;
        add(x, z, range(rng, 0.35, 1.5) * (c.wall > 0.6 ? 1.3 : 1));
      }
    }
    const n = Math.floor(900 * density);
    for (let i = 0; i < n; i += 1) {
      const x = range(rng, -WORLD_HALF, WORLD_HALF);
      const z = range(rng, -WORLD_HALF, WORLD_HALF);
      if (!this.free(x, z, 2.2)) continue;
      const slope = t.slopeAt(x, z);
      const big = rng() < 0.08 + slope * 0.4;
      add(x, z, big ? range(rng, 0.7, 1.8) : range(rng, 0.12, 0.45));
    }
    variants.forEach((g, i) => this.instanced(g, mat, lists[i]));
  }

  private logs(mat: THREE.Material, density: number): void {
    const rng = mulberry32(404);
    const t = this.terrain;
    const variants = [logGeometry(rng, 9, 0.32), logGeometry(rng, 6, 0.24), logGeometry(rng, 12, 0.4)];
    const lists: Placed[][] = variants.map(() => []);
    const lengths = [9, 6, 12];
    const n = Math.floor(260 * density);
    for (let i = 0; i < n; i += 1) {
      const x = range(rng, -WORLD_HALF, WORLD_HALF);
      const z = range(rng, -WORLD_HALF, WORLD_HALF);
      const v = Math.floor(rng() * variants.length);
      const half = (lengths[v] / 2) * 1.1;
      const rot = rng() * Math.PI * 2;
      const dx = Math.cos(rot) * half;
      const dz = -Math.sin(rot) * half;
      if (!this.free(x, z, 3) || !this.free(x + dx, z + dz, 3) || !this.free(x - dx, z - dz, 3)) continue;
      let clearing = false;
      for (const c of CLEARINGS) if (Math.hypot(x - c.x, z - c.z) < c.radius) clearing = true;
      if (clearing) continue;
      const h1 = t.heightAt(x + dx, z + dz);
      const h0 = t.heightAt(x - dx, z - dz);
      const scale = range(rng, 0.85, 1.15);
      const r = [0.32, 0.24, 0.4][v] * scale;
      const y = (h0 + h1) / 2 + r * 0.75;
      // Lie along the slope.
      const pitch = Math.atan2(h1 - h0, half * 2);
      const axis = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
      const tilt = new THREE.Quaternion().setFromAxisAngle(axis, pitch);
      lists[v].push({ x, y, z, rot, scale, tilt });
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, Math.PI / 2)).premultiply(tilt);
      this.physics.tag(this.physics.addCapsule(x, y, z, half * 0.85 * scale, r, { x: q.x, y: q.y, z: q.z, w: q.w }), 'wood');
    }
    variants.forEach((g, i) => this.instanced(g, mat, lists[i]));
  }

  private stumps(bark: THREE.MeshStandardMaterial, density: number): void {
    const rng = mulberry32(505);
    const t = this.terrain;
    const side = texCylinder(0.34, 0.6, 1.2, 12);
    side.translate(0, 0.3, 0);
    const top = new THREE.CircleGeometry(0.34, 16).rotateX(-Math.PI / 2).translate(0, 0.6, 0);
    const ringMat = new THREE.MeshStandardMaterial({ map: ringTexture(), roughness: 0.95 });
    const items: Placed[] = [];
    const n = Math.floor(220 * density);
    for (let i = 0; i < n; i += 1) {
      // More near the trailhead and station: old logging.
      const nearRoad = rng() < 0.6;
      let x: number;
      let z: number;
      if (nearRoad) {
        const road = t.roads[0];
        const p = road.at(rng() * road.length * 0.65);
        const off = (road.halfWidth + range(rng, 3, 14)) * (rng() < 0.5 ? -1 : 1);
        x = p.x - p.tz * off;
        z = p.z + p.tx * off;
      } else {
        x = range(rng, -WORLD_HALF, WORLD_HALF);
        z = range(rng, -WORLD_HALF, WORLD_HALF);
      }
      if (!this.free(x, z, 2.5)) continue;
      const scale = range(rng, 0.7, 1.4);
      const y = t.heightAt(x, z) - 0.08;
      items.push({ x, y, z, rot: rng() * Math.PI * 2, scale });
      this.physics.tag(this.physics.addCylinder(x, y, z, 0.3 * scale, 0.32 * scale), 'wood');
    }
    this.instanced(side, bark, items);
    this.instanced(top, ringMat, items, false);
  }

  private branches(mat: THREE.Material, density: number): void {
    const rng = mulberry32(606);
    const t = this.terrain;
    const make = (len: number) => {
      const a = texCylinder(0.035, len, 0.8, 5, true).rotateZ(Math.PI / 2);
      const b = texCylinder(0.022, len * 0.45, 0.8, 5, true).rotateZ(Math.PI / 2).rotateY(0.6).translate(len * 0.15, 0, len * 0.12);
      const merged = new THREE.BufferGeometry();
      const geos = [a, b].map((g) => g.toNonIndexed());
      const count = geos.reduce((s, g) => s + g.getAttribute('position').count, 0);
      for (const name of ['position', 'normal', 'uv']) {
        const size = geos[0].getAttribute(name).itemSize;
        const arr = new Float32Array(count * size);
        let o = 0;
        for (const g of geos) {
          arr.set(g.getAttribute(name).array as Float32Array, o);
          o += g.getAttribute(name).array.length;
        }
        merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
      }
      const col = new Float32Array(count * 3).fill(0.8);
      merged.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return merged;
    };
    const variants = [make(1.6), make(2.4)];
    const lists: Placed[][] = [[], []];
    const n = Math.floor(1800 * density);
    for (let i = 0; i < n; i += 1) {
      const x = range(rng, -WORLD_HALF, WORLD_HALF);
      const z = range(rng, -WORLD_HALF, WORLD_HALF);
      if (!this.free(x, z, 0.8)) continue;
      const v = rng() < 0.6 ? 0 : 1;
      lists[v].push({ x, y: t.heightAt(x, z) + 0.03, z, rot: rng() * Math.PI * 2, scale: range(rng, 0.7, 1.3) });
    }
    variants.forEach((g, i) => this.instanced(g, mat, lists[i], false));
  }
}
