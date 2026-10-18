// Procedural firearm models at real scale (metres). Each gun is built from
// extruded side profiles (frames, stocks, grips, magazines), lathed or bevelled
// round parts (barrels, tubes, scopes) and small details (sights, rails, ports,
// screws), with distinct materials: polymer, parkerized, blued or stainless steel,
// walnut, rosewood and tan polymer. Static parts are merged per material; moving
// parts (slide, cylinder, hammer, pump, bolt, magazine) stay separate.
//
// Model space: +Z toward the muzzle, +Y up, the gun's right side is -X.
// Anchors tell the animator where hands and shoulder go and where shots leave.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { WeaponId } from './defs.ts';

export interface HandAnchor {
  /** Palm centre. */
  pos: THREE.Vector3;
  /** Direction from wrist toward the knuckles. */
  dir: THREE.Vector3;
  /** Thumb side of the hand. */
  thumb: THREE.Vector3;
}

export interface WeaponModel {
  id: WeaponId;
  root: THREE.Group;
  grip: HandAnchor;
  fore: HandAnchor;
  muzzle: THREE.Vector3;
  /** Rear of the stock (long guns) where it meets the shoulder. */
  butt: THREE.Vector3 | null;
  ejection: THREE.Vector3;
  /** Magazine-well (where a magazine goes in). */
  magWell: THREE.Vector3;
  parts: {
    slide?: THREE.Object3D;
    cylinder?: THREE.Object3D;
    crane?: THREE.Object3D;
    hammer?: THREE.Object3D;
    pump?: THREE.Object3D;
    bolt?: THREE.Object3D;
    mag?: THREE.Object3D;
    lens?: THREE.Object3D;
  };
  /** Overall length (for holster/sling placement and pickups). */
  length: number;
}

// ------------------------------------------------------------------ materials

function grainTexture(base: string, dark: string, seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 128);
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  // Long wavy grain lines with occasional darker figure.
  for (let i = 0; i < 70; i += 1) {
    const y0 = rnd() * 128;
    const amp = 2 + rnd() * 6;
    const freq = 0.005 + rnd() * 0.02;
    ctx.strokeStyle = dark;
    ctx.globalAlpha = 0.12 + rnd() * 0.3;
    ctx.lineWidth = 0.6 + rnd() * 1.8;
    ctx.beginPath();
    for (let x = 0; x <= 512; x += 8) {
      const y = y0 + Math.sin(x * freq + i) * amp + Math.sin(x * 0.05 + i * 2) * 0.8;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  t.anisotropy = 4;
  return t;
}

/** Fine noise normal map for cast/stippled surfaces. */
function noiseNormal(): THREE.DataTexture {
  const S = 64;
  const data = new Uint8Array(S * S * 4);
  let s = 7;
  for (let i = 0; i < S * S; i += 1) {
    s = (s * 16807) % 2147483647;
    const a = (s / 2147483647 - 0.5) * 0.5;
    s = (s * 16807) % 2147483647;
    const b = (s / 2147483647 - 0.5) * 0.5;
    const n = new THREE.Vector3(a, b, 1).normalize();
    data[i * 4] = (n.x * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (n.y * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = (n.z * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(40, 40);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

type MatKey = 'polymer' | 'parkerized' | 'blued' | 'stainless' | 'walnut' | 'birch' | 'rosewood' | 'tan' | 'rubber' | 'brass' | 'glass' | 'dark' | 'red' | 'leather' | 'alloy';

let mats: Record<MatKey, THREE.MeshStandardMaterial> | null = null;

export function weaponMaterials(): Record<MatKey, THREE.MeshStandardMaterial> {
  if (mats) return mats;
  const stipple = noiseNormal();
  const m = (o: THREE.MeshStandardMaterialParameters, name: string) => {
    const x = new THREE.MeshStandardMaterial(o);
    x.name = `gun-${name}`;
    return x;
  };
  mats = {
    polymer: m({ color: '#1c1d1e', roughness: 0.62, metalness: 0.05, normalMap: stipple, normalScale: new THREE.Vector2(0.35, 0.35) }, 'polymer'),
    parkerized: m({ color: '#2f3231', roughness: 0.55, metalness: 0.6 }, 'parkerized'),
    blued: m({ color: '#1f2226', roughness: 0.32, metalness: 0.8 }, 'blued'),
    stainless: m({ color: '#b3b4b0', roughness: 0.28, metalness: 0.92 }, 'stainless'),
    walnut: m({ color: '#ffffff', map: grainTexture('#6e4126', '#2e170a', 11), roughness: 0.42, metalness: 0 }, 'walnut'),
    birch: m({ color: '#ffffff', map: grainTexture('#86603a', '#3e2614', 23), roughness: 0.5, metalness: 0 }, 'birch'),
    rosewood: m({ color: '#ffffff', map: grainTexture('#4b2216', '#1c0904', 37), roughness: 0.38, metalness: 0 }, 'rosewood'),
    tan: m({ color: '#8c7a58', roughness: 0.68, metalness: 0.02, normalMap: stipple, normalScale: new THREE.Vector2(0.3, 0.3) }, 'tan'),
    rubber: m({ color: '#121212', roughness: 0.92, metalness: 0 }, 'rubber'),
    brass: m({ color: '#b48e52', roughness: 0.3, metalness: 0.95 }, 'brass'),
    glass: m({ color: '#15212b', roughness: 0.06, metalness: 0.4, emissive: new THREE.Color('#0a1a26'), emissiveIntensity: 0.4 }, 'glass'),
    dark: m({ color: '#0b0b0c', roughness: 0.8, metalness: 0.2 }, 'dark'),
    red: m({ color: '#c8361f', roughness: 0.5, metalness: 0, emissive: new THREE.Color('#5a0b04'), emissiveIntensity: 0.5 }, 'red'),
    leather: m({ color: '#4a3020', roughness: 0.75, metalness: 0 }, 'leather'),
    alloy: m({ color: '#26282a', roughness: 0.48, metalness: 0.7 }, 'alloy'),
  };
  return mats;
}

// ------------------------------------------------------------------ builder

class GunBuilder {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();

  add(mat: MatKey, g: THREE.BufferGeometry): this {
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
    if (!ng.getAttribute('uv')) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.getAttribute('position').count * 2), 2));
    list.push(ng);
    return this;
  }

  /** Merge into one mesh per material under `into`. */
  build(into: THREE.Object3D): void {
    const all = weaponMaterials();
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, all[mat]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      into.add(mesh);
    }
    this.parts.clear();
  }
}

/** Side outline (z, y pairs) extruded across X, centred on x = cx. */
function profile(pts: [number, number][], thickness: number, bevel = 0.0015, cx = 0, holes: [number, number][][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y))));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.0005, thickness - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  // Shape x -> +Z, extrusion -> -X; then centre the thickness on cx.
  g.rotateY(-Math.PI / 2);
  g.translate(cx + (thickness - bevel * 2) / 2, 0, 0);
  // Scale the UVs (shape units are metres) so wood grain runs along the part.
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * 2.5);
  return g;
}

function rbox(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.002, rotX = 0, rotY = 0, rotZ = 0): THREE.BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  if (rotX || rotY || rotZ) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ)));
  g.translate(x, y, z);
  return g;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number, rotX = 0, rotY = 0, rotZ = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotX || rotY || rotZ) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, rotZ)));
  g.translate(x, y, z);
  return g;
}

/** Cylinder along Z from z0 to z1 (tapered r0 -> r1). */
function tubeZ(r0: number, r1: number, z0: number, z1: number, x = 0, y = 0, seg = 16): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, z1 - z0, seg, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, (z0 + z1) / 2);
  return g;
}

/** Cylinder along X (turrets, pins, knobs). */
function tubeX(r: number, len: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

function tubeY(r: number, len: number, x: number, y: number, z: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
  g.translate(x, y, z);
  return g;
}

/** Lathe around the Z axis from a (radius, z) profile. */
function latheZ(pts: [number, number][], x = 0, y = 0, seg = 20): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, 0);
  return g;
}

function sphere(r: number, x: number, y: number, z: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2));
  g.translate(x, y, z);
  return g;
}

/** Picatinny rail: a base strip with cross slots every 10 mm. */
function rail(b: GunBuilder, mat: MatKey, z0: number, z1: number, y: number, w = 0.021): void {
  b.add(mat, box(w, 0.005, z1 - z0, 0, y, (z0 + z1) / 2));
  for (let z = z0 + 0.004; z < z1 - 0.004; z += 0.01) b.add(mat, box(w * 1.06, 0.0035, 0.0052, 0, y + 0.004, z));
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Right hand on a pistol grip angled back by `rake` radians. */
function gripHand(z: number, y: number, rake: number): HandAnchor {
  return {
    pos: V(-0.004, y, z),
    dir: V(0, -Math.sin(0.25 + rake * 0.5), Math.cos(0.25 + rake * 0.5)).normalize(),
    thumb: V(0.15, 1, 0.2).normalize(),
  };
}

/** Support hand under a handguard/forend. */
function foreHand(z: number, y: number): HandAnchor {
  return {
    pos: V(0.004, y - 0.012, z),
    dir: V(-0.6, 0.15, 0.78).normalize(),
    thumb: V(0.35, 0.75, 0.55).normalize(),
  };
}

// ------------------------------------------------------------------ models

function pistolP9(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  // Polymer frame: dust cover, squared trigger guard, raked grip with beavertail.
  b.add('polymer', profile([
    [0.097, 0.007], [0.097, -0.006], [0.052, -0.006], [0.052, -0.026], [0.047, -0.032], [-0.006, -0.032],
    [-0.013, -0.027], [-0.017, -0.045], [-0.022, -0.06], [-0.024, -0.075], [-0.03, -0.09], [-0.034, -0.106],
    [-0.072, -0.106], [-0.078, -0.098], [-0.07, -0.04], [-0.067, -0.01], [-0.074, -0.004], [-0.07, 0.007],
  ], 0.026, 0.0025, 0, [[[-0.004, -0.009], [0.044, -0.009], [0.044, -0.024], [0.002, -0.024], [-0.004, -0.018]]]));
  // Grip texture panels (slightly raised, darker).
  for (const sx of [1, -1]) b.add('dark', profile([[-0.03, -0.035], [-0.066, -0.03], [-0.074, -0.095], [-0.036, -0.098]], 0.002, 0, sx * 0.0132));
  b.add('polymer', box(0.004, 0.012, 0.006, 0, -0.016, 0.014, 0.25)); // trigger
  // Slide (moving part) with serrations, port and sights.
  const slide = new THREE.Group();
  const sb = new GunBuilder();
  sb.add('parkerized', rbox(0.023, 0.03, 0.184, 0, 0.022, 0.03, 0.003));
  for (let i = 0; i < 7; i += 1) for (const sx of [1, -1]) sb.add('dark', box(0.001, 0.022, 0.0018, sx * 0.0117, 0.022, -0.052 + i * 0.0045));
  sb.add('dark', box(0.0015, 0.011, 0.032, -0.0115, 0.031, 0.04)); // ejection port (right side)
  sb.add('parkerized', box(0.019, 0.006, 0.007, 0, 0.04, -0.052)); // rear sight
  sb.add('dark', box(0.0035, 0.004, 0.0072, 0, 0.0415, -0.052)); // notch
  sb.add('parkerized', box(0.0038, 0.006, 0.006, 0, 0.0395, 0.112)); // front sight
  sb.add('dark', tubeZ(0.0052, 0.0052, 0.116, 0.1235, 0, 0.019, 12)); // barrel crown
  sb.build(slide);
  root.add(slide);
  // Magazine (base plate shows under the grip).
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.add('polymer', rbox(0.021, 0.1, 0.03, 0, -0.055, -0.051, 0.002, -0.32));
  mb.add('polymer', rbox(0.028, 0.008, 0.039, 0, -0.106, -0.052, 0.002));
  mb.build(mag);
  root.add(mag);
  b.build(root);
  return {
    id: 'p9', root, grip: gripHand(-0.045, -0.052, 0.33), fore: { pos: V(0.02, -0.065, -0.035), dir: V(-0.85, -0.3, 0.42).normalize(), thumb: V(0.2, 0.8, 0.6).normalize() },
    muzzle: V(0, 0.019, 0.124), butt: null, ejection: V(-0.014, 0.032, 0.04), magWell: V(0, -0.1, -0.052),
    parts: { slide, mag }, length: 0.19,
  };
}

function revolverBridger(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  // Stainless frame with topstrap, round trigger guard and grip frame.
  b.add('stainless', profile([
    [0.052, 0.042], [0.052, -0.014], [0.03, -0.016], [0.026, -0.032], [0.008, -0.044], [-0.012, -0.042],
    [-0.024, -0.03], [-0.03, -0.02], [-0.046, -0.026], [-0.058, -0.03], [-0.062, -0.018], [-0.058, 0.004],
    [-0.05, 0.028], [-0.04, 0.042],
  ], 0.026, 0.002, 0, [[[0.016, -0.019], [0.016, -0.03], [0.004, -0.036], [-0.012, -0.033], [-0.018, -0.022]]]));
  // 6" barrel with full underlug and ventilated top rib.
  b.add('stainless', tubeZ(0.0105, 0.0105, 0.052, 0.205, 0, 0.022, 18));
  b.add('stainless', rbox(0.017, 0.02, 0.152, 0, 0.006, 0.128, 0.004));
  b.add('stainless', box(0.009, 0.006, 0.15, 0, 0.034, 0.128));
  for (let i = 0; i < 5; i += 1) b.add('dark', box(0.0095, 0.003, 0.012, 0, 0.0335, 0.07 + i * 0.026));
  b.add('stainless', box(0.004, 0.012, 0.016, 0, 0.042, 0.195)); // front sight ramp
  b.add('red', box(0.0042, 0.004, 0.004, 0, 0.048, 0.199));
  b.add('dark', box(0.009, 0.006, 0.008, 0, 0.046, -0.026)); // rear sight
  b.add('dark', tubeZ(0.0062, 0.0062, 0.203, 0.207, 0, 0.022, 14)); // bore
  b.add('stainless', box(0.004, 0.013, 0.006, 0, -0.024, 0.0, 0.3)); // trigger
  // Rosewood grip.
  b.add('rosewood', profile([
    [-0.03, -0.022], [-0.04, -0.06], [-0.046, -0.095], [-0.05, -0.122], [-0.068, -0.13], [-0.09, -0.125],
    [-0.093, -0.1], [-0.082, -0.06], [-0.07, -0.03], [-0.062, -0.018],
  ], 0.036, 0.011));
  // Hammer (moving).
  const hammer = new THREE.Group();
  const hb = new GunBuilder();
  hb.add('stainless', profile([[0, 0], [-0.012, 0.016], [-0.022, 0.02], [-0.018, 0.008], [-0.008, -0.004]], 0.008, 0.001));
  hb.build(hammer);
  hammer.position.set(0, 0.03, -0.042);
  root.add(hammer);
  // Crane + six-shot fluted cylinder: swings out to the left for reloading.
  const crane = new THREE.Group();
  crane.position.set(0.0, -0.008, 0.03);
  const cylinder = new THREE.Group();
  cylinder.position.set(0, 0.03, -0.035);
  const cb = new GunBuilder();
  cb.add('stainless', latheZ([[0.0001, -0.024], [0.019, -0.024], [0.0225, -0.02], [0.0225, 0.018], [0.0205, 0.022], [0.0001, 0.022]], 0, 0, 24));
  for (let k = 0; k < 6; k += 1) {
    const a = (k / 6) * Math.PI * 2;
    // Chamber mouths on the front face and flutes between them.
    cb.add('dark', tubeZ(0.0058, 0.0058, 0.019, 0.0228, Math.cos(a) * 0.0135, Math.sin(a) * 0.0135, 10));
    cb.add('brass', tubeZ(0.0062, 0.0062, -0.0255, -0.0235, Math.cos(a) * 0.0135, Math.sin(a) * 0.0135, 10));
    const fa = a + Math.PI / 6;
    cb.add('dark', box(0.0048, 0.0048, 0.026, Math.cos(fa) * 0.0215, Math.sin(fa) * 0.0215, 0.0, 0, 0, fa));
  }
  cb.build(cylinder);
  crane.add(cylinder);
  // Crane arm and ejector rod under the barrel.
  const kb = new GunBuilder();
  kb.add('stainless', box(0.006, 0.014, 0.01, 0, 0.012, -0.004));
  kb.add('stainless', tubeZ(0.0028, 0.0028, -0.03, 0.04, 0, 0.022, 8));
  kb.build(crane);
  // Reposition the cylinder so it sits in the frame window when the crane is closed.
  cylinder.position.set(0, 0.03, -0.035 + 0.0);
  root.add(crane);
  b.build(root);
  return {
    id: 'bridger', root, grip: gripHand(-0.062, -0.07, 0.35), fore: { pos: V(0.022, -0.085, -0.05), dir: V(-0.85, -0.3, 0.42).normalize(), thumb: V(0.2, 0.8, 0.6).normalize() },
    muzzle: V(0, 0.022, 0.208), butt: null, ejection: V(0, 0.03, -0.06), magWell: V(0.02, 0.03, -0.035),
    parts: { cylinder, crane, hammer }, length: 0.3,
  };
}

function shotgunRanger(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  // Receiver with ejection port (right) and loading port (bottom).
  b.add('blued', rbox(0.032, 0.062, 0.2, 0, 0.002, 0.1, 0.004));
  b.add('dark', box(0.002, 0.024, 0.07, -0.0162, 0.012, 0.12));
  b.add('dark', box(0.02, 0.002, 0.08, 0, -0.03, 0.13));
  // Trigger guard with hole and trigger.
  b.add('alloy', profile([[0.09, -0.028], [0.088, -0.05], [0.07, -0.058], [0.02, -0.058], [0.008, -0.046], [0.0, -0.028]], 0.012, 0.0015, 0, [[[0.075, -0.034], [0.07, -0.05], [0.025, -0.05], [0.016, -0.04], [0.016, -0.034]]]));
  b.add('alloy', box(0.004, 0.016, 0.006, 0, -0.038, 0.05, 0.3));
  // 20" barrel with brass bead; magazine tube under it.
  b.add('blued', tubeZ(0.0118, 0.0112, 0.2, 0.71, 0, 0.014, 18));
  b.add('dark', tubeZ(0.0085, 0.0085, 0.708, 0.712, 0, 0.014, 14));
  b.add('brass', sphere(0.0028, 0, 0.0285, 0.698, 8));
  b.add('blued', tubeZ(0.0118, 0.0118, 0.2, 0.62, 0, -0.016, 16));
  b.add('blued', tubeZ(0.0128, 0.0128, 0.6, 0.632, 0, -0.016, 16)); // mag cap
  b.add('blued', box(0.012, 0.018, 0.014, 0, -0.001, 0.6)); // barrel ring
  // Walnut stock: straight comb, pistol-grip wrist, deep butt.
  b.add('walnut', profile([
    [0.002, 0.031], [-0.06, 0.026], [-0.36, 0.006], [-0.375, 0.004], [-0.375, -0.142], [-0.36, -0.142],
    [-0.15, -0.065], [-0.11, -0.072], [-0.085, -0.09], [-0.062, -0.088], [-0.05, -0.06], [-0.02, -0.035], [0.002, -0.029],
  ], 0.042, 0.013));
  b.add('rubber', rbox(0.042, 0.15, 0.02, 0, -0.068, -0.384, 0.005));
  b.add('alloy', tubeY(0.004, 0.012, 0, -0.143, -0.28, 8)); // sling swivel stud
  // Pump: ribbed walnut forend sliding on the magazine tube.
  const pump = new THREE.Group();
  const pb = new GunBuilder();
  pb.add('walnut', latheZ([[0.0125, 0], [0.021, 0.004], [0.0235, 0.02], [0.0235, 0.18], [0.021, 0.196], [0.0125, 0.2]], 0, -0.012, 20));
  for (let i = 0; i < 9; i += 1) pb.add('dark', latheZ([[0.0236, 0.03 + i * 0.016], [0.0236, 0.034 + i * 0.016]], 0, -0.012, 20));
  pb.build(pump);
  pump.position.set(0, 0, 0.27);
  root.add(pump);
  b.build(root);
  return {
    id: 'ranger12', root, grip: gripHand(-0.072, -0.058, 0.6), fore: { ...foreHand(0.37, -0.012), pos: V(0.004, -0.04, 0.37) },
    muzzle: V(0, 0.014, 0.712), butt: V(0, -0.045, -0.392), ejection: V(-0.018, 0.012, 0.12), magWell: V(0, -0.032, 0.14),
    parts: { pump }, length: 1.1,
  };
}

function smgVireo(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  // Stamped receiver with rounded top and cocking tube.
  b.add('parkerized', profile([[0.215, 0.034], [0.215, -0.016], [0.06, -0.018], [0.03, -0.03], [-0.07, -0.03], [-0.072, 0.034]], 0.032, 0.004));
  b.add('parkerized', tubeZ(0.012, 0.012, -0.01, 0.255, 0, 0.044, 14));
  b.add('parkerized', box(0.004, 0.012, 0.02, -0.014, 0.05, 0.215)); // cocking handle
  b.add('dark', box(0.002, 0.012, 0.03, -0.0162, 0.016, 0.03)); // ejection port
  // Thick polymer handguard and short barrel with three-lug nub.
  b.add('polymer', rbox(0.046, 0.044, 0.16, 0, 0.004, 0.2, 0.012));
  b.add('parkerized', tubeZ(0.0095, 0.0095, 0.27, 0.31, 0, 0.006, 14));
  b.add('parkerized', tubeZ(0.011, 0.011, 0.3, 0.318, 0, 0.006, 6));
  // Hooded front sight and drum rear sight.
  b.add('parkerized', box(0.006, 0.026, 0.01, 0, 0.066, 0.245));
  b.add('parkerized', new THREE.TorusGeometry(0.012, 0.0025, 8, 16).translate(0, 0.078, 0.245));
  b.add('parkerized', tubeX(0.012, 0.022, 0, 0.064, -0.03, 16));
  // Pistol grip and trigger housing.
  b.add('polymer', profile([[0.03, -0.028], [0.02, -0.06], [-0.002, -0.125], [-0.032, -0.128], [-0.035, -0.105], [-0.024, -0.06], [-0.03, -0.028]], 0.03, 0.004));
  b.add('polymer', profile([[0.06, -0.028], [0.058, -0.052], [0.04, -0.056], [0.03, -0.04]], 0.026, 0.002, 0, []));
  b.add('parkerized', box(0.004, 0.014, 0.006, 0, -0.042, 0.045, 0.3));
  // Retractable stock: two rods and a butt plate.
  for (const sx of [1, -1]) b.add('parkerized', tubeZ(0.0045, 0.0045, -0.27, -0.065, sx * 0.016, 0.012, 8));
  b.add('polymer', rbox(0.05, 0.11, 0.014, 0, -0.008, -0.272, 0.006));
  // Curved magazine.
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.add('parkerized', profile([[0.105, -0.02], [0.11, -0.08], [0.122, -0.14], [0.14, -0.2], [0.112, -0.206], [0.095, -0.145], [0.083, -0.08], [0.078, -0.02]], 0.02, 0.002));
  mb.build(mag);
  mag.position.set(0, 0, -0.02);
  root.add(mag);
  b.build(root);
  return {
    id: 'vireo', root, grip: gripHand(-0.018, -0.07, 0.4), fore: foreHand(0.19, -0.004),
    muzzle: V(0, 0.006, 0.32), butt: V(0, 0.0, -0.28), ejection: V(-0.018, 0.016, 0.03), magWell: V(0, -0.03, 0.075),
    parts: { mag }, length: 0.6,
  };
}

/** Shared AR-pattern lower/upper; `scale` lengthens it into a .308 rifle. */
function arPattern(b: GunBuilder, furniture: MatKey, metal: MatKey, s: number): void {
  // Lower receiver with magwell and trigger guard.
  b.add(metal, profile([[0.085 * s, 0.018], [0.085 * s, -0.012], [0.08 * s, -0.058], [0.02 * s, -0.058], [0.015 * s, -0.025], [-0.045 * s, -0.026], [-0.058 * s, 0.0], [-0.058 * s, 0.018]], 0.024, 0.002));
  b.add(metal, profile([[0.012, -0.024], [0.01, -0.044], [-0.03, -0.046], [-0.034, -0.026]], 0.012, 0.0015, 0, [[[0.006, -0.028], [0.004, -0.04], [-0.026, -0.04], [-0.028, -0.03]]]));
  b.add(metal, box(0.004, 0.014, 0.006, 0, -0.032, -0.006, 0.25));
  // Upper receiver, rail, ejection port cover, forward assist, charging handle.
  b.add(metal, rbox(0.027, 0.04, 0.2 * s, 0, 0.038, 0.045 * s, 0.003));
  rail(b, metal, -0.06 * s, 0.15 * s, 0.062);
  b.add('dark', box(0.002, 0.014, 0.05, -0.0137, 0.04, 0.03));
  b.add(metal, tubeZ(0.007, 0.007, -0.02, 0.02, -0.016, 0.046, 10));
  b.add(metal, box(0.03, 0.006, 0.016, 0, 0.056, -0.064 * s));
  // Pistol grip.
  b.add(furniture, profile([[-0.012, -0.022], [-0.022, -0.06], [-0.034, -0.11], [-0.062, -0.112], [-0.06, -0.096], [-0.046, -0.06], [-0.046, -0.022]], 0.03, 0.008));
  // Buffer tube.
  b.add(metal, tubeZ(0.0155, 0.0155, -0.26 * s, -0.058 * s, 0, 0.036, 16));
}

function rifleMarten(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  arPattern(b, 'polymer', 'parkerized', 1);
  // Octagonal M-LOK handguard with slots; top rail continues.
  b.add('alloy', tubeZ(0.023, 0.023, 0.15, 0.44, 0, 0.034, 8));
  rail(b, 'alloy', 0.15, 0.44, 0.06);
  for (let i = 0; i < 6; i += 1) for (const a of [Math.PI / 2, Math.PI, -Math.PI / 2 + Math.PI * 2]) {
    const x = Math.cos(a) * 0.023;
    const y = Math.sin(a) * 0.023 + 0.034;
    b.add('dark', box(Math.abs(x) > 0.01 ? 0.0015 : 0.012, Math.abs(x) > 0.01 ? 0.008 : 0.0015, 0.03, x, y, 0.18 + i * 0.043));
  }
  // Barrel and birdcage flash hider.
  b.add('parkerized', tubeZ(0.0085, 0.0085, 0.44, 0.535, 0, 0.034, 14));
  b.add('parkerized', tubeZ(0.0112, 0.0112, 0.53, 0.585, 0, 0.034, 14));
  for (let k = 0; k < 4; k += 1) b.add('dark', box(0.0024, 0.0115 * 2.05, 0.028, Math.cos(k) * 0.0, 0.034, 0.565, 0, 0, (k / 4) * Math.PI));
  // Collapsible stock with sling loop and butt pad.
  b.add('polymer', profile([[-0.17, 0.052], [-0.29, 0.058], [-0.296, 0.05], [-0.296, -0.075], [-0.27, -0.078], [-0.22, -0.02], [-0.17, -0.0]], 0.036, 0.01));
  b.add('rubber', rbox(0.038, 0.13, 0.012, 0, -0.01, -0.3, 0.004));
  // Red-dot sight on a riser.
  b.add('parkerized', box(0.02, 0.018, 0.04, 0, 0.074, 0.05));
  b.add('parkerized', tubeZ(0.0175, 0.0175, 0.025, 0.085, 0, 0.1, 18));
  b.add('parkerized', tubeY(0.006, 0.012, 0, 0.12, 0.055));
  b.add('parkerized', tubeX(0.006, 0.012, -0.018, 0.1, 0.055));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.014, 18), weaponMaterials().glass);
  lens.position.set(0, 0.1, 0.0855);
  root.add(lens);
  // Curved 30-round magazine.
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.add('polymer', profile([[0.078, -0.01], [0.08, -0.07], [0.09, -0.13], [0.105, -0.185], [0.044, -0.19], [0.032, -0.13], [0.024, -0.07], [0.022, -0.01]], 0.022, 0.0025));
  mb.add('polymer', rbox(0.026, 0.01, 0.066, 0, -0.19, 0.075, 0.003, -0.2));
  mb.build(mag);
  root.add(mag);
  b.build(root);
  return {
    id: 'marten', root, grip: gripHand(-0.036, -0.06, 0.45), fore: foreHand(0.3, 0.018),
    muzzle: V(0, 0.034, 0.586), butt: V(0, 0.0, -0.305), ejection: V(-0.016, 0.042, 0.03), magWell: V(0, -0.05, 0.05),
    parts: { mag, lens }, length: 0.89,
  };
}

function rifleIronwood(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  // One-piece birch stock: slim forend, sloped wrist, deep butt.
  b.add('birch', profile([
    [0.42, 0.006], [0.42, -0.022], [0.14, -0.034], [0.09, -0.05], [-0.02, -0.05], [-0.06, -0.066], [-0.1, -0.09],
    [-0.42, -0.135], [-0.432, -0.13], [-0.432, 0.014], [-0.4, 0.016], [-0.12, 0.002], [-0.06, 0.006], [0.0, 0.004], [0.12, 0.006],
  ], 0.046, 0.014));
  b.add('birch', rbox(0.034, 0.016, 0.24, 0, 0.032, 0.265, 0.006)); // upper handguard
  b.add('alloy', rbox(0.046, 0.15, 0.012, 0, -0.06, -0.438, 0.004)); // steel butt plate
  // Receiver with operating rod and peep sight.
  b.add('parkerized', rbox(0.03, 0.036, 0.2, 0, 0.022, 0.04, 0.004));
  b.add('parkerized', tubeZ(0.004, 0.004, -0.03, 0.36, -0.019, 0.02, 8));
  b.add('parkerized', box(0.012, 0.02, 0.012, -0.019, 0.026, 0.0)); // op-rod handle
  b.add('parkerized', box(0.014, 0.022, 0.01, 0, 0.05, -0.05));
  b.add('parkerized', new THREE.TorusGeometry(0.0065, 0.0022, 6, 14).translate(0, 0.064, -0.05));
  // Barrel, gas cylinder, front sight with ears and slotted flash suppressor.
  b.add('parkerized', tubeZ(0.0095, 0.0085, 0.38, 0.62, 0, 0.022, 14));
  b.add('parkerized', tubeZ(0.007, 0.007, 0.36, 0.5, 0, 0.001, 10));
  b.add('parkerized', tubeZ(0.012, 0.0115, 0.6, 0.68, 0, 0.022, 14));
  for (let k = 0; k < 5; k += 1) b.add('dark', box(0.0024, 0.0035, 0.035, Math.cos((k / 5) * 6.28) * 0.011, 0.022 + Math.sin((k / 5) * 6.28) * 0.011, 0.655));
  b.add('parkerized', box(0.003, 0.03, 0.006, 0, 0.042, 0.598));
  for (const sx of [1, -1]) b.add('parkerized', box(0.0025, 0.022, 0.012, sx * 0.007, 0.038, 0.598));
  // Trigger guard and swivels.
  b.add('parkerized', profile([[0.0, -0.05], [-0.004, -0.07], [-0.03, -0.076], [-0.064, -0.07], [-0.07, -0.05]], 0.012, 0.0015, 0, [[[-0.01, -0.054], [-0.014, -0.066], [-0.03, -0.069], [-0.058, -0.064], [-0.06, -0.054]]]));
  b.add('parkerized', box(0.004, 0.014, 0.006, 0, -0.058, -0.03, 0.3));
  // 20-round straight box magazine.
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.add('parkerized', rbox(0.026, 0.11, 0.07, 0, -0.095, 0.05, 0.003, -0.08));
  for (let i = 0; i < 4; i += 1) mb.add('dark', box(0.027, 0.002, 0.05, 0, -0.07 - i * 0.02, 0.05, -0.08));
  mb.build(mag);
  root.add(mag);
  b.build(root);
  return {
    id: 'ironwood', root, grip: gripHand(-0.085, -0.06, 0.55), fore: { ...foreHand(0.24, -0.008), pos: V(0.004, -0.034, 0.24) },
    muzzle: V(0, 0.022, 0.682), butt: V(0, -0.045, -0.44), ejection: V(-0.018, 0.035, 0.05), magWell: V(0, -0.04, 0.05),
    parts: { mag }, length: 1.12,
  };
}

function rifleRidgeline(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  // Walnut sporter stock with Monte Carlo cheekpiece and pistol grip.
  b.add('walnut', profile([
    [0.34, 0.004], [0.34, -0.022], [0.16, -0.036], [0.06, -0.044], [-0.02, -0.046], [-0.05, -0.056], [-0.075, -0.1],
    [-0.105, -0.1], [-0.11, -0.072], [-0.16, -0.075], [-0.43, -0.13], [-0.442, -0.125], [-0.442, 0.028], [-0.36, 0.034],
    [-0.2, 0.03], [-0.13, 0.012], [-0.06, 0.008], [0.0, 0.006],
  ], 0.044, 0.014));
  b.add('rubber', rbox(0.044, 0.16, 0.024, 0, -0.05, -0.454, 0.006));
  // Round receiver, tapered barrel, iron sights.
  b.add('blued', tubeZ(0.0165, 0.0165, -0.09, 0.15, 0, 0.022, 20));
  b.add('blued', tubeZ(0.0135, 0.0085, 0.15, 0.66, 0, 0.022, 18));
  b.add('dark', tubeZ(0.005, 0.005, 0.659, 0.662, 0, 0.022, 10));
  b.add('blued', box(0.005, 0.012, 0.022, 0, 0.035, 0.64));
  b.add('brass', sphere(0.0022, 0, 0.042, 0.648, 8));
  b.add('blued', box(0.014, 0.012, 0.012, 0, 0.034, 0.32));
  b.add('dark', box(0.004, 0.005, 0.0125, 0, 0.0395, 0.32));
  // Trigger guard and floorplate.
  b.add('blued', profile([[0.04, -0.044], [0.04, -0.052], [-0.01, -0.052], [-0.02, -0.07], [-0.045, -0.072], [-0.055, -0.05]], 0.012, 0.0015, 0, [[[-0.014, -0.054], [-0.02, -0.066], [-0.04, -0.066], [-0.046, -0.054]]]));
  b.add('blued', box(0.004, 0.014, 0.006, 0, -0.058, -0.028, 0.3));
  // Leather sling between the swivels.
  b.add('alloy', tubeY(0.0035, 0.012, 0, -0.04, 0.26, 8));
  b.add('alloy', tubeY(0.0035, 0.012, 0, -0.118, -0.3, 8));
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    pts.push(V(-0.004, THREE.MathUtils.lerp(-0.045, -0.125, t) - Math.sin(t * Math.PI) * 0.07, THREE.MathUtils.lerp(0.26, -0.3, t)));
  }
  for (let i = 0; i < 10; i += 1) {
    const a = pts[i];
    const c = pts[i + 1];
    const mid = a.clone().add(c).multiplyScalar(0.5);
    const len = a.distanceTo(c);
    const ang = Math.atan2(c.y - a.y, c.z - a.z);
    b.add('leather', box(0.003, 0.002, len + 0.002, mid.x, mid.y, mid.z, -ang));
  }
  // Bolt (moving): body, handle arm and knob on the right.
  const bolt = new THREE.Group();
  const bb = new GunBuilder();
  bb.add('stainless', tubeZ(0.0085, 0.0085, -0.07, 0.03, 0, 0, 14));
  bb.add('blued', tubeZ(0.0095, 0.0095, -0.095, -0.07, 0, 0, 14));
  const arm = new THREE.CylinderGeometry(0.0035, 0.0035, 0.045, 8);
  arm.rotateZ(Math.PI / 2 - 0.35);
  arm.translate(-0.026, -0.008, -0.05);
  bb.add('blued', arm);
  bb.add('blued', sphere(0.0085, -0.048, -0.016, -0.05, 12));
  bb.build(bolt);
  bolt.position.set(0, 0.022, 0);
  root.add(bolt);
  b.build(root);
  return {
    id: 'ridgeline', root, grip: gripHand(-0.088, -0.07, 0.55), fore: { ...foreHand(0.22, -0.01), pos: V(0.004, -0.04, 0.22) },
    muzzle: V(0, 0.022, 0.662), butt: V(0, -0.045, -0.465), ejection: V(-0.02, 0.03, 0.06), magWell: V(0, 0.04, 0.03),
    parts: { bolt }, length: 1.12,
  };
}

function rifleLongwatch(): WeaponModel {
  const root = new THREE.Group();
  const b = new GunBuilder();
  arPattern(b, 'tan', 'alloy', 1.12);
  // Long free-float handguard (round, slotted) and fluted barrel with brake.
  b.add('tan', tubeZ(0.025, 0.025, 0.17, 0.55, 0, 0.036, 20));
  rail(b, 'alloy', 0.17, 0.55, 0.063);
  for (let i = 0; i < 8; i += 1) for (const sx of [1, -1]) b.add('dark', box(0.0015, 0.008, 0.026, sx * 0.0253, 0.036, 0.2 + i * 0.043));
  b.add('alloy', tubeZ(0.0095, 0.0095, 0.55, 0.7, 0, 0.036, 16));
  b.add('alloy', rbox(0.026, 0.026, 0.06, 0, 0.036, 0.73, 0.006));
  for (let i = 0; i < 3; i += 1) for (const sx of [1, -1]) b.add('dark', box(0.0015, 0.016, 0.006, sx * 0.0132, 0.036, 0.714 + i * 0.014));
  // Precision stock with cheek riser.
  b.add('tan', profile([[-0.18, 0.06], [-0.37, 0.07], [-0.378, 0.06], [-0.378, -0.085], [-0.35, -0.09], [-0.24, -0.025], [-0.18, 0.0]], 0.042, 0.012));
  b.add('tan', rbox(0.03, 0.02, 0.13, 0, 0.083, -0.28, 0.006));
  b.add('rubber', rbox(0.04, 0.15, 0.014, 0, -0.01, -0.386, 0.004));
  // Folded bipod under the handguard tip.
  b.add('alloy', box(0.03, 0.014, 0.03, 0, 0.004, 0.52));
  for (const sx of [1, -1]) b.add('alloy', tubeZ(0.0045, 0.0045, 0.33, 0.52, sx * 0.012, -0.004, 8));
  // Scope: tube, bells, turrets, rings, lenses.
  const scopeY = 0.112;
  b.add('dark', latheZ([[0.0001, -0.11], [0.019, -0.11], [0.0195, -0.07], [0.015, -0.055], [0.015, 0.21], [0.0245, 0.25], [0.0245, 0.3], [0.0001, 0.3]], 0, scopeY, 24));
  b.add('dark', tubeY(0.011, 0.024, 0, scopeY + 0.022, 0.085, 16));
  b.add('dark', tubeX(0.011, 0.024, -0.022, scopeY, 0.085, 16));
  b.add('dark', tubeX(0.008, 0.016, 0.018, scopeY, 0.085, 12));
  for (const z of [-0.02, 0.17]) {
    b.add('alloy', box(0.024, 0.028, 0.018, 0, 0.083, z));
    b.add('alloy', latheZ([[0.0158, z - 0.009], [0.0168, z - 0.009], [0.0168, z + 0.009], [0.0158, z + 0.009]], 0, scopeY, 20));
  }
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.022, 24), weaponMaterials().glass);
  lens.position.set(0, scopeY, 0.3005);
  root.add(lens);
  const back = new THREE.Mesh(new THREE.CircleGeometry(0.017, 20), weaponMaterials().glass);
  back.position.set(0, scopeY, -0.1105);
  back.rotation.y = Math.PI;
  root.add(back);
  // 20-round magazine (slight curve).
  const mag = new THREE.Group();
  const mb = new GunBuilder();
  mb.add('tan', profile([[0.095, -0.012], [0.098, -0.07], [0.104, -0.125], [0.03, -0.128], [0.025, -0.07], [0.024, -0.012]], 0.025, 0.003));
  mb.build(mag);
  root.add(mag);
  b.build(root);
  return {
    id: 'longwatch', root, grip: gripHand(-0.04, -0.065, 0.45), fore: foreHand(0.36, 0.02),
    muzzle: V(0, 0.036, 0.762), butt: V(0, 0.0, -0.392), ejection: V(-0.016, 0.042, 0.035), magWell: V(0, -0.05, 0.06),
    parts: { mag, lens }, length: 1.15,
  };
}

const BUILDERS: Record<WeaponId, () => WeaponModel> = {
  p9: pistolP9,
  bridger: revolverBridger,
  ranger12: shotgunRanger,
  vireo: smgVireo,
  marten: rifleMarten,
  ironwood: rifleIronwood,
  ridgeline: rifleRidgeline,
  longwatch: rifleLongwatch,
};

/** A fresh instance of a weapon model (geometry is rebuilt; cheap at this size). */
export function buildWeaponModel(id: WeaponId): WeaponModel {
  const m = BUILDERS[id]();
  m.root.name = `weapon-${id}`;
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return m;
}
