// Hollow Creek's water: a ribbon along the creek at the carved water level, with
// flowing normals, sky reflections, and edges that fade into the shallows.

import * as THREE from 'three';
import type { TerrainData } from '../world/terrain.ts';

function flowNormalMap(size = 256): THREE.DataTexture {
  // Tileable height noise → normal map.
  const h = new Float32Array(size * size);
  const octave = (cells: number, amp: number, seed: number) => {
    const grid = new Float32Array(cells * cells);
    let s = seed;
    for (let i = 0; i < grid.length; i += 1) {
      s = (s * 16807) % 2147483647;
      grid[i] = s / 2147483647;
    }
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = fx - x0;
        const ty = fy - y0;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const g = (ix: number, iy: number) => grid[(iy % cells) * cells + (ix % cells)];
        const a = g(x0, y0) + (g(x0 + 1, y0) - g(x0, y0)) * sx;
        const b = g(x0, y0 + 1) + (g(x0 + 1, y0 + 1) - g(x0, y0 + 1)) * sx;
        h[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
  };
  octave(8, 1, 11);
  octave(16, 0.5, 23);
  octave(32, 0.25, 37);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const l = h[y * size + ((x - 1 + size) % size)];
      const r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x];
      const u = h[((y + 1) % size) * size + x];
      const nx = (l - r) * 2.2;
      const ny = (d - u) * 2.2;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const k = (y * size + x) * 4;
      data[k] = ((nx / len) * 0.5 + 0.5) * 255;
      data[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      data[k + 2] = ((nz / len) * 0.5 + 0.5) * 255;
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

export class Water {
  readonly mesh: THREE.Mesh;
  private normal: THREE.DataTexture;
  private normal2: THREE.DataTexture;
  private material: THREE.MeshStandardMaterial;

  constructor(terrain: TerrainData) {
    const path = terrain.creek;
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const across = 6;
    const step = 1.5;
    let rows = 0;
    for (let s = 0; s <= path.length; s += step) {
      const p = path.at(s);
      const c = terrain.creekAt(s);
      const w = c.channel + 0.9;
      const nx = -p.tz;
      const nz = p.tx;
      for (let k = 0; k <= across; k += 1) {
        const u = k / across - 0.5;
        const x = p.x + nx * u * 2 * w;
        const z = p.z + nz * u * 2 * w;
        pos.push(x, c.level + 0.015, z);
        uv.push(s / 5, u * 2 * w / 5);
        // Clearer at the edges where the water is shallow.
        const edge = 1 - Math.abs(u) * 2;
        const depth = c.depth;
        const a = Math.min(0.92, 0.35 + edge * 0.5 + depth * 0.25);
        col.push(1, 1, 1, a);
      }
      rows += 1;
    }
    for (let r = 0; r < rows - 1; r += 1) {
      for (let k = 0; k < across; k += 1) {
        const a = r * (across + 1) + k;
        const b = a + across + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    this.normal = flowNormalMap();
    this.normal2 = this.normal.clone();
    this.normal2.needsUpdate = true;
    this.material = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#1f2620'),
      roughness: 0.14,
      metalness: 0.0,
      normalMap: this.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      envMapIntensity: 0.55,
    });
    this.material.name = 'creek-water';
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'creek';
    this.mesh.receiveShadow = true;
    this.mesh.renderOrder = 2;
  }

  update(dt: number): void {
    // Flow downstream along the ribbon (u increases downstream).
    this.normal.offset.x -= dt * 0.12;
    this.normal.offset.y += dt * 0.01;
  }
}
