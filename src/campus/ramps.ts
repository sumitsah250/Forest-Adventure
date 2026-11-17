// Stunt humps for Kalki: low symmetric wedges (drivable from either direction) on the
// campus ring road, painted in hazard stripes. Hit one fast for air time.

import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/physics.ts';
import type { CampusGround } from './ground.ts';
import type { Pt } from './geo.ts';

/** Centre and the road direction (a point further along) for each hump. */
export const HUMPS: [Pt, Pt][] = [
  [[231.2, 0], [232, 12]],
  [[146, 90.5], [129, 90]],
  [[-3, 96], [-17, 120]],
  [[143, -166.3], [128, -168]],
  [[38, 66], [27, 63]],
];

const LEN = 5.2;
const WIDTH = 2.6;
const HEIGHT = 0.75;

function stripes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2c84b';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1b1b';
  for (let i = -128; i < 256; i += 48) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i + 24, 0);
    g.lineTo(i + 24 + 128, 128);
    g.lineTo(i + 128, 128);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1);
  return t;
}

export function buildHumps(ground: CampusGround, physics: PhysicsWorld): THREE.Group {
  const group = new THREE.Group();
  group.name = 'humps';
  const top = new THREE.MeshStandardMaterial({ map: stripes(), roughness: 0.75, side: THREE.DoubleSide });
  const side = new THREE.MeshStandardMaterial({ color: '#3a3c40', roughness: 0.9, side: THREE.DoubleSide });
  for (const [[x, z], [nx, nz]] of HUMPS) {
    const a = Math.atan2(nx - x, nz - z);
    const fx = Math.sin(a);
    const fz = Math.cos(a);
    const rx = fz;
    const rz = -fx;
    const y = ground.heightAt(x, z) - 0.06;
    // Triangular prism: base rectangle on the ground, ridge across the middle.
    const P = (u: number, v: number, h: number) => new THREE.Vector3(rx * u + fx * v, h, rz * u + fz * v);
    const w = WIDTH / 2;
    const l = LEN / 2;
    const pts = [P(-w, -l, 0), P(w, -l, 0), P(-w, l, 0), P(w, l, 0), P(-w, 0, HEIGHT), P(w, 0, HEIGHT)];
    const flat = new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z]));
    physics.addConvex(flat, x, y, z);
    // Mesh: two sloped faces (striped) and two triangular ends.
    const g = new THREE.BufferGeometry();
    const [a0, a1, b0, b1, r0, r1] = pts;
    const tri = (p: THREE.Vector3[]) => p.flatMap((q) => [q.x, q.y, q.z]);
    const pos = [
      ...tri([a0, r0, a1]), ...tri([a1, r0, r1]),
      ...tri([b0, b1, r0]), ...tri([b1, r1, r0]),
      ...tri([a0, b0, r0]), ...tri([a1, r1, b1]),
    ];
    const uv = [0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.addGroup(0, 12, 0);
    g.addGroup(12, 6, 1);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, [top, side]);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}
