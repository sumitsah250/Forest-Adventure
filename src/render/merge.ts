// Merges many small static meshes into one mesh per material to cut draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Normalises a geometry to non-indexed position/normal/uv so it can be merged with any other. */
function normalise(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g.clone();
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  if (!out.getAttribute('uv')) {
    out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(out.getAttribute('position').count * 2), 2));
  }
  for (const name of Object.keys(out.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') out.deleteAttribute(name);
  }
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

/** Split a multi-material mesh geometry into per-group geometries. */
function splitGroups(g: THREE.BufferGeometry): { geo: THREE.BufferGeometry; index: number }[] {
  if (!g.groups.length) return [{ geo: g, index: 0 }];
  const src = g.index ? g.toNonIndexed() : g;
  const out: { geo: THREE.BufferGeometry; index: number }[] = [];
  for (const grp of g.groups) {
    const part = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      const a = attr as THREE.BufferAttribute;
      const start = grp.start;
      const count = Math.min(grp.count, a.count - start);
      part.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
    }
    out.push({ geo: part, index: grp.materialIndex ?? 0 });
  }
  return out;
}

/**
 * Merge every mesh under `root` (except inside `keep` subtrees) into one mesh per
 * material. Transforms are baked relative to `root`.
 */
export function mergeStatic(root: THREE.Object3D, keep: THREE.Object3D[]): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const victims: THREE.Mesh[] = [];
  const kept = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => kept.add(o));
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || kept.has(m) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    for (const { geo, index } of splitGroups(m.geometry)) {
      const mat = mats[index] ?? mats[0];
      const g = normalise(geo);
      g.applyMatrix4(rel);
      let list = buckets.get(mat);
      if (!list) buckets.set(mat, (list = []));
      list.push(g);
    }
    victims.push(m);
  });
  for (const v of victims) v.removeFromParent();
  for (const [mat, list] of buckets) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `merged-${mat.name || mat.type}`;
    root.add(mesh);
  }
}
