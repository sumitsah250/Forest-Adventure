// Procedural vehicle models: a weathered forest-service 4x4 wagon and a civilian
// SUV. Bodies are extruded from side profiles with real wheel arches, then
// detailed with glass, lights, bumpers, mirrors, rack, decals, dirt and rust.
// Model space: forward +Z, left +X, up +Y, origin at the physics chassis origin.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mulberry32, range } from '../world/rng.ts';
import { mergeStatic } from '../render/merge.ts';

export interface BodyStyle {
  kind: 'wagon' | 'suv';
  paint: string;
  roof: string | null;
  /** Lower body outline points (z, y), counter-clockwise, arches inserted automatically. */
  length: number;
  width: number;
  sillY: number;
  beltY: number;
  roofY: number;
  bonnetY: number;
  /** Z of the windshield base and top. */
  windshieldBaseZ: number;
  windshieldTopZ: number;
  rearZ: number;
  frontZ: number;
  wheelFrontZ: number;
  wheelRearZ: number;
  wheelY: number;
  wheelRadius: number;
  archRadius: number;
  halfTrack: number;
  bevel: number;
  livery: 'forest' | 'civilian';
  unit: string;
  mud: number;
  rust: number;
  /** Rear hatch slope for SUVs. */
  rearSlope: number;
}

export const FOREST_WAGON: BodyStyle = {
  kind: 'wagon',
  paint: '#4d5c45',
  roof: '#c4c1b6',
  length: 4.62,
  width: 1.84,
  sillY: 0.42,
  beltY: 1.12,
  roofY: 1.86,
  bonnetY: 1.08,
  windshieldBaseZ: 0.98,
  windshieldTopZ: 0.5,
  rearZ: -2.28,
  frontZ: 2.32,
  wheelFrontZ: 1.42,
  wheelRearZ: -1.36,
  wheelY: 0.27,
  wheelRadius: 0.4,
  archRadius: 0.5,
  halfTrack: 0.8,
  bevel: 0.045,
  livery: 'forest',
  unit: '2',
  mud: 0.55,
  rust: 0.25,
  rearSlope: 0.04,
};

export const CIVILIAN_SUV: BodyStyle = {
  kind: 'suv',
  paint: '#6b2a2e',
  roof: null,
  length: 4.5,
  width: 1.82,
  sillY: 0.36,
  beltY: 1.0,
  roofY: 1.68,
  bonnetY: 0.98,
  windshieldBaseZ: 0.88,
  windshieldTopZ: 0.2,
  rearZ: -2.22,
  frontZ: 2.26,
  wheelFrontZ: 1.38,
  wheelRearZ: -1.32,
  wheelY: 0.2,
  wheelRadius: 0.36,
  archRadius: 0.46,
  halfTrack: 0.78,
  bevel: 0.08,
  livery: 'civilian',
  unit: '',
  mud: 0.35,
  rust: 0.08,
  rearSlope: 0.22,
};

// ------------------------------------------------------------------ textures

function grunge(seed: number, size: number, draw: (ctx: CanvasRenderingContext2D, rng: () => number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size / 4;
  const ctx = c.getContext('2d')!;
  const rng = mulberry32(seed);
  draw(ctx, rng);
  return c;
}

/**
 * Side artwork for both flanks: bottom half is the right side, top half is the left
 * side drawn mirrored so text reads correctly and features stay in place.
 */
function sideTexture(style: BodyStyle, seed: number): THREE.CanvasTexture {
  const W = 2048;
  const H = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const zMin = -2.45;
  const zMax = 2.45;
  const yMin = 0.25;
  const yMax = 1.95;
  const toX = (z: number) => ((z - zMin) / (zMax - zMin)) * W;
  const toY = (y: number) => (1 - (y - yMin) / (yMax - yMin)) * (H / 2);
  const drawSide = (mirror: boolean) => {
    const rng = mulberry32(seed + (mirror ? 7 : 0));
    ctx.save();
    if (mirror) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    // Text keeps reading left-to-right on the mirrored flank (layout mirrors, glyphs don't).
    const label = (text: string, x: number, y: number) => {
      if (!mirror) {
        ctx.textAlign = 'left';
        ctx.fillText(text, x, y);
        return;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(-1, 1);
      ctx.textAlign = 'right';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    ctx.fillStyle = style.paint;
    ctx.fillRect(0, 0, W, H / 2);
    // Subtle panel variation and sun fade.
    const fade = ctx.createLinearGradient(0, toY(1.9), 0, toY(0.3));
    fade.addColorStop(0, 'rgba(255,255,240,0.10)');
    fade.addColorStop(0.5, 'rgba(255,255,255,0.0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H / 2);
    if (style.roof) {
      ctx.fillStyle = style.roof;
      ctx.fillRect(0, 0, W, toY(1.16));
    }
    // Door seams and handles.
    ctx.strokeStyle = 'rgba(10,12,10,0.85)';
    ctx.lineWidth = 3;
    const seam = (z: number, y0: number, y1: number) => {
      ctx.beginPath();
      ctx.moveTo(toX(z), toY(y1));
      ctx.lineTo(toX(z), toY(y0));
      ctx.stroke();
    };
    const doors = style.kind === 'wagon' ? [0.92, -0.42, -1.5] : [0.82, -0.36, -1.42];
    seam(doors[0], style.sillY + 0.05, style.beltY + 0.02);
    seam(doors[1], style.sillY + 0.05, style.beltY + 0.02);
    seam(doors[2], style.sillY + 0.12, style.beltY + 0.02);
    ctx.beginPath();
    ctx.moveTo(toX(doors[0]), toY(style.sillY + 0.06));
    ctx.lineTo(toX(doors[2]), toY(style.sillY + 0.06));
    ctx.stroke();
    ctx.fillStyle = 'rgba(25,25,25,0.95)';
    for (const z of [doors[1] + 0.22, doors[2] + 0.22]) ctx.fillRect(toX(z) - 26, toY(style.beltY - 0.08), 52, 12);
    // Fuel filler.
    ctx.strokeStyle = 'rgba(10,10,10,0.8)';
    ctx.beginPath();
    ctx.arc(toX(-1.9), toY(style.beltY - 0.16), 18, 0, Math.PI * 2);
    ctx.stroke();
    if (style.livery === 'forest') {
      // Pinstripe and door emblem for the (fictional) Hollow Creek Ranger District.
      ctx.fillStyle = 'rgba(214, 196, 132, 0.85)';
      ctx.fillRect(toX(-2.3), toY(style.beltY - 0.25), toX(2.3) - toX(-2.3), 7);
      const ex = toX(0.25);
      const ey = toY(0.82);
      ctx.save();
      ctx.translate(ex, ey);
      ctx.fillStyle = 'rgba(214, 196, 132, 0.9)';
      ctx.beginPath();
      ctx.moveTo(0, -48);
      ctx.lineTo(28, -6);
      ctx.lineTo(14, -6);
      ctx.lineTo(34, 26);
      ctx.lineTo(4, 26);
      ctx.lineTo(4, 40);
      ctx.lineTo(-4, 40);
      ctx.lineTo(-4, 26);
      ctx.lineTo(-34, 26);
      ctx.lineTo(-14, -6);
      ctx.lineTo(-28, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(224, 210, 160, 0.92)';
      ctx.font = '600 34px "Segoe UI", Arial, sans-serif';
      label('HOLLOW CREEK', ex + 48, ey - 10);
      ctx.font = '500 25px "Segoe UI", Arial, sans-serif';
      label('RANGER DISTRICT', ex + 48, ey + 22);
      ctx.font = '700 30px "Segoe UI", Arial, sans-serif';
      label(`UNIT ${style.unit}`, toX(-1.25), toY(0.86));
    }
    // Scratches.
    ctx.strokeStyle = 'rgba(200,200,190,0.18)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 70; i += 1) {
      const x = rng() * W;
      const y = toY(range(rng, style.sillY, style.beltY));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + range(rng, -60, 60), y + range(rng, -6, 6));
      ctx.stroke();
    }
    // Rust blooms around the arches and sills.
    for (let i = 0; i < 70 * style.rust; i += 1) {
      const nearRear = rng() < 0.5;
      const z = (nearRear ? style.wheelRearZ : style.wheelFrontZ) + range(rng, -0.6, 0.6);
      const y = range(rng, style.sillY, style.sillY + 0.35);
      const r = range(rng, 3, 14);
      const g = ctx.createRadialGradient(toX(z), toY(y), 0, toX(z), toY(y), r);
      g.addColorStop(0, 'rgba(110, 52, 20, 0.85)');
      g.addColorStop(1, 'rgba(110, 52, 20, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(toX(z) - r, toY(y) - r, r * 2, r * 2);
    }
    // Mud: dense near the sills and behind the wheels, thrown up in streaks.
    const mudTop = toY(style.sillY + 0.55 * style.mud + 0.12);
    const grad = ctx.createLinearGradient(0, mudTop, 0, toY(style.sillY - 0.1));
    grad.addColorStop(0, 'rgba(78, 62, 42, 0)');
    grad.addColorStop(0.55, `rgba(78, 62, 42, ${0.55 * style.mud})`);
    grad.addColorStop(1, `rgba(66, 52, 36, ${0.95 * style.mud + 0.05})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, mudTop, W, H / 2 - mudTop);
    for (let i = 0; i < 900 * style.mud; i += 1) {
      const behind = rng() < 0.5 ? style.wheelRearZ - 0.55 : style.wheelFrontZ - 0.55;
      const z = rng() < 0.6 ? behind + range(rng, -0.35, 0.25) : range(rng, -2.4, 2.4);
      const y = style.sillY + Math.pow(rng(), 2.2) * 0.75;
      ctx.fillStyle = `rgba(${70 + rng() * 20}, ${56 + rng() * 15}, ${38 + rng() * 10}, ${range(rng, 0.3, 0.8)})`;
      ctx.beginPath();
      ctx.ellipse(toX(z), toY(y), range(rng, 1.5, 6), range(rng, 1.5, 5), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  };
  // Right side → bottom half (v 0..0.5), left side → top half, mirrored.
  ctx.save();
  ctx.translate(0, H / 2);
  drawSide(false);
  ctx.restore();
  drawSide(true);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function dirtTexture(seed: number, base: string, mud: number): THREE.CanvasTexture {
  const c = grunge(seed, 512, (ctx, rng) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 512, 128);
    for (let i = 0; i < 400; i += 1) {
      ctx.fillStyle = `rgba(70,58,40,${range(rng, 0.03, 0.12) * (0.5 + mud)})`;
      ctx.fillRect(rng() * 512, rng() * 128, range(rng, 2, 40), range(rng, 1, 6));
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function treadTextures(): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const W = 1024;
  const H = 256;
  const make = (bump: boolean) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bump ? '#202020' : '#1b1b1a';
    ctx.fillRect(0, 0, W, H);
    // Sidewall ribs top and bottom, tread blocks in the middle band.
    const blocks = 28;
    for (let i = 0; i < blocks; i += 1) {
      const x = (i / blocks) * W;
      const bw = W / blocks;
      const off = i % 2 ? bw * 0.25 : 0;
      ctx.fillStyle = bump ? '#d8d8d8' : '#262524';
      ctx.fillRect(x + 4, 78 + (i % 2) * 6, bw * 0.42, 44);
      ctx.fillRect(x + 4 + off, 132, bw * 0.42, 44);
      ctx.fillRect(x + bw * 0.55, 100, bw * 0.38, 54);
    }
    if (!bump) {
      // Dried mud on the tread and lower sidewall.
      for (let i = 0; i < 900; i += 1) {
        ctx.fillStyle = `rgba(92, 76, 52, ${Math.random() * 0.35})`;
        ctx.fillRect(Math.random() * W, 60 + Math.random() * 140, 3 + Math.random() * 10, 2 + Math.random() * 6);
      }
      ctx.fillStyle = 'rgba(150,150,140,0.55)';
      ctx.font = '700 22px Arial';
      for (let i = 0; i < 3; i += 1) ctx.fillText('ALL TERRAIN  LT265/75R16', 40 + i * 340, 40);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = bump ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    return t;
  };
  return { map: make(false), bump: make(true) };
}

// ------------------------------------------------------------------ geometry

function sideShape(style: BodyStyle): THREE.Shape {
  const s = new THREE.Shape();
  const { rearZ, frontZ, sillY, beltY, bonnetY, archRadius: ar, wheelY } = style;
  const arch = (cz: number, fromRear: boolean) => {
    // Semicircular arch above the wheel centre, traversed rear → front along the bottom.
    const steps = 14;
    for (let i = 0; i <= steps; i += 1) {
      const a = Math.PI - (i / steps) * Math.PI;
      const z = cz + Math.cos(a) * ar;
      const y = Math.max(sillY, wheelY + Math.sin(a) * ar + 0.04);
      s.lineTo(z, y);
    }
    void fromRear;
  };
  s.moveTo(rearZ + 0.06, sillY + 0.04);
  s.lineTo(style.wheelRearZ - ar, sillY);
  arch(style.wheelRearZ, true);
  s.lineTo(style.wheelFrontZ - ar, sillY);
  arch(style.wheelFrontZ, false);
  s.lineTo(frontZ - 0.12, sillY + 0.06);
  s.quadraticCurveTo(frontZ, sillY + 0.08, frontZ, sillY + 0.22);
  s.lineTo(frontZ + 0.01, bonnetY - 0.12);
  s.quadraticCurveTo(frontZ, bonnetY, frontZ - 0.14, bonnetY + 0.01);
  s.lineTo(style.windshieldBaseZ + 0.02, beltY + 0.0);
  s.lineTo(rearZ + 0.04, beltY);
  s.lineTo(rearZ, beltY - 0.1);
  s.lineTo(rearZ, sillY + 0.16);
  s.quadraticCurveTo(rearZ, sillY + 0.04, rearZ + 0.06, sillY + 0.04);
  return s;
}

function cabinShape(style: BodyStyle): THREE.Shape {
  const s = new THREE.Shape();
  const { beltY, roofY, rearZ } = style;
  s.moveTo(style.windshieldBaseZ, beltY - 0.02);
  s.lineTo(style.windshieldTopZ + 0.05, roofY - 0.04);
  s.quadraticCurveTo(style.windshieldTopZ - 0.02, roofY, style.windshieldTopZ - 0.12, roofY);
  s.lineTo(rearZ + 0.12 + style.rearSlope * 0.6, roofY);
  s.quadraticCurveTo(rearZ + 0.02 + style.rearSlope * 0.5, roofY, rearZ + 0.02 + style.rearSlope * 0.45, roofY - 0.08);
  s.lineTo(rearZ + 0.03, beltY - 0.02);
  s.lineTo(style.windshieldBaseZ, beltY - 0.02);
  return s;
}

/**
 * Cap faces (the two flanks) get the side artwork (z → u, y → v, one half per
 * flank); the extruded walls (roof, bonnet, front, rear) get planar top-down UVs.
 */
function mapSideUVs(geo: THREE.BufferGeometry, halfWidth: number): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const zMin = -2.45;
  const zMax = 2.45;
  const yMin = 0.25;
  const yMax = 1.95;
  const caps = geo.groups.find((g) => g.materialIndex === 0);
  const capStart = caps ? caps.start : 0;
  const capEnd = caps ? caps.start + caps.count : pos.count;
  for (let i = 0; i < pos.count; i += 1) {
    if (i < capStart || i >= capEnd) {
      uv.setXY(i, pos.getZ(i) * 0.5 + pos.getY(i) * 0.25, pos.getX(i) * 0.5);
      continue;
    }
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let u = (z - zMin) / (zMax - zMin);
    let v = ((y - yMin) / (yMax - yMin)) * 0.5;
    if (x > halfWidth * 0.5) {
      u = 1 - u;
      v += 0.5;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function extrudeSide(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 10,
    steps: 1,
  });
  // Shape lies in XY (z→x, y→y); rotate so shape-x becomes +Z and extrusion runs along X.
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - bevel * 2) / 2, 0, 0);
  // After rotation shape-x maps to +Z.
  geo.computeVertexNormals();
  return geo;
}

function glassPanel(points: [number, number, number][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  for (const p of points) pos.push(...p);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const idx: number[] = [];
  for (let i = 1; i < points.length - 1; i += 1) idx.push(0, i, i + 1);
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface VehicleParts {
  root: THREE.Group;
  /** Wheel pivots in order FL, FR, RL, RR; child 0 spins. */
  wheels: THREE.Group[];
  steeringWheel: THREE.Object3D | null;
  headlightLenses: THREE.Mesh[];
  tailLenses: THREE.Mesh[];
  beaconLenses: THREE.Mesh[];
  materials: {
    head: THREE.MeshStandardMaterial;
    tail: THREE.MeshStandardMaterial;
    beacon: THREE.MeshStandardMaterial;
    reverse: THREE.MeshStandardMaterial;
  };
  /** Local anchor points. */
  anchors: { driverDoor: THREE.Vector3; driverEye: THREE.Vector3; rear: THREE.Vector3; headlightL: THREE.Vector3; headlightR: THREE.Vector3; exhaust: THREE.Vector3 };
  /** Door that can be shown open (SUV). */
  door: THREE.Object3D | null;
  /** Roof-rack jerrycan (hidden when taken). */
  jerrycan: THREE.Object3D | null;
}

export interface BuildOptions {
  seed: number;
  jerrycan?: THREE.Object3D | null;
  flatTire?: number;
  openDoor?: boolean;
  damaged?: boolean;
  lightBar?: boolean;
}

export function buildVehicle(style: BodyStyle, o: BuildOptions): VehicleParts {
  const root = new THREE.Group();
  root.name = `vehicle-${style.kind}`;
  const side = sideTexture(style, o.seed);
  const dirt = dirtTexture(o.seed + 3, style.paint, style.mud);
  const paintSide = new THREE.MeshPhysicalMaterial({ map: side, roughness: 0.62, metalness: 0.15, clearcoat: 0.25, clearcoatRoughness: 0.55 });
  const paint = new THREE.MeshPhysicalMaterial({ map: dirt, color: 0xffffff, roughness: 0.6, metalness: 0.15, clearcoat: 0.22, clearcoatRoughness: 0.55 });
  const roofMat = style.roof
    ? new THREE.MeshPhysicalMaterial({ map: dirtTexture(o.seed + 5, style.roof, style.mud * 0.4), roughness: 0.55, metalness: 0.1, clearcoat: 0.2, clearcoatRoughness: 0.6 })
    : paint;
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x151615, roughness: 0.82, metalness: 0 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x5a5c58, roughness: 0.48, metalness: 0.85 });
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x2b2c2a, roughness: 0.7, metalness: 0.6 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xcfd2d0, roughness: 0.18, metalness: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x101416, roughness: 0.06, metalness: 0.2, envMapIntensity: 1.6 });
  const head = new THREE.MeshStandardMaterial({ color: 0xd9ddd6, roughness: 0.15, metalness: 0.1, emissive: new THREE.Color(1, 0.95, 0.82), emissiveIntensity: 0 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0d0b, roughness: 0.3, metalness: 0.05, emissive: new THREE.Color(1, 0.08, 0.04), emissiveIntensity: 0.0 });
  const reverse = new THREE.MeshStandardMaterial({ color: 0xbfc1bd, roughness: 0.3, emissive: new THREE.Color(1, 1, 0.95), emissiveIntensity: 0 });
  const beacon = new THREE.MeshStandardMaterial({ color: 0x9a5a0c, roughness: 0.3, transparent: false, emissive: new THREE.Color(1, 0.55, 0.05), emissiveIntensity: 0 });
  const interior = new THREE.MeshStandardMaterial({ color: 0x2a2a27, roughness: 0.9 });

  const halfW = style.width / 2;
  // ---- body shells
  const lower = extrudeSide(sideShape(style), style.width, style.bevel);
  mapSideUVs(lower, halfW);
  const lowerMesh = new THREE.Mesh(lower, [paintSide, paint]);
  root.add(lowerMesh);
  const cabW = style.width - 0.12;
  const cab = extrudeSide(cabinShape(style), cabW, style.bevel * 1.3);
  mapSideUVs(cab, cabW / 2);
  const cabMesh = new THREE.Mesh(splitByNormal(cab), [paintSide, roofMat, paint]);
  root.add(cabMesh);
  if (o.damaged) {
    // Crumple the front end and roof edge.
    for (const g of [lower, cab]) {
      const p = g.getAttribute('position') as THREE.BufferAttribute;
      const rng = mulberry32(o.seed + 99);
      for (let i = 0; i < p.count; i += 1) {
        const z = p.getZ(i);
        const y = p.getY(i);
        const x = p.getX(i);
        const front = Math.max(0, z - 1.4) / 0.9;
        const roof = Math.max(0, y - style.roofY + 0.2) * (x > 0 ? 1 : 0.3);
        p.setX(i, x - Math.sign(x) * (front * 0.08 + roof * 0.6) * rng());
        p.setY(i, y - front * 0.12 * rng() - roof * 0.5);
        p.setZ(i, z - front * 0.18);
      }
      p.needsUpdate = true;
      g.computeVertexNormals();
    }
  }

  // ---- glass (slightly proud of the cabin surfaces)
  const gx = cabW / 2 + 0.008;
  const bz = style.windshieldBaseZ;
  const tz = style.windshieldTopZ;
  const by = style.beltY + 0.05;
  const ty = style.roofY - 0.07;
  const rake = (y: number) => bz + ((y - by) / (ty - by)) * (tz - bz);
  const windows: [number, number][] =
    style.kind === 'wagon'
      ? [[0.86, -0.38], [-0.48, -1.42], [-1.54, -2.12]]
      : [[0.74, -0.32], [-0.42, -1.36], [-1.46, -1.96]];
  for (const sideSign of [1, -1]) {
    windows.forEach(([z0, z1], wi) => {
      const zf = wi === 0 ? Math.min(z0, rake(by) - 0.1) : z0;
      const zft = wi === 0 ? rake(ty) - 0.12 : z0;
      const zr = z1;
      const zrt = wi === 2 ? z1 + style.rearSlope * 0.6 : z1;
      const x = gx * sideSign;
      const pts: [number, number, number][] = sideSign < 0
        ? [[x, by, zf], [x, ty, zft], [x, ty, zrt], [x, by, zr]]
        : [[x, by, zf], [x, by, zr], [x, ty, zrt], [x, ty, zft]];
      root.add(new THREE.Mesh(glassPanel(pts), glass));
    });
  }
  // Windshield and rear glass.
  const wsx = cabW / 2 - 0.08;
  const ws = glassPanel([
    [-wsx, by + 0.02, bz + 0.035],
    [wsx, by + 0.02, bz + 0.035],
    [wsx - 0.03, ty, tz + 0.06],
    [-wsx + 0.03, ty, tz + 0.06],
  ]);
  const windshieldMat = o.damaged
    ? new THREE.MeshStandardMaterial({ color: 0x2a2f31, roughness: 0.35, metalness: 0.1, map: crackTexture(o.seed) })
    : glass;
  root.add(new THREE.Mesh(ws, windshieldMat));
  const rz = style.rearZ - 0.035;
  root.add(new THREE.Mesh(glassPanel([
    [wsx, by + 0.04, rz + style.rearSlope * 0.1],
    [-wsx, by + 0.04, rz + style.rearSlope * 0.1],
    [-wsx + 0.03, ty - 0.02, rz + style.rearSlope * 0.6],
    [wsx - 0.03, ty - 0.02, rz + style.rearSlope * 0.6],
  ]), glass));

  // ---- interior silhouette (visible through glass and from the cockpit camera)
  const dash = new THREE.Mesh(new RoundedBoxGeometry(cabW - 0.16, 0.22, 0.42, 3, 0.04), interior);
  dash.position.set(0, style.beltY - 0.02, style.windshieldBaseZ - 0.28);
  root.add(dash);
  for (const sx of [0.42, -0.42]) {
    const seat = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.12, 0.5, 2, 0.04), interior);
    seat.position.set(sx, style.sillY + 0.38, -0.25);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.62, 0.12, 2, 0.04), interior);
    back.position.set(sx, style.sillY + 0.72, -0.55);
    back.rotation.x = -0.18;
    root.add(seat, back);
  }
  let steeringWheel: THREE.Object3D | null = null;
  {
    const pivot = new THREE.Group();
    pivot.position.set(0.42, style.beltY + 0.06, style.windshieldBaseZ - 0.55);
    pivot.rotation.x = -1.05;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 8, 28), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 }));
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.02), interior);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 12).rotateX(Math.PI / 2), interior);
    pivot.add(rim, spoke, hub);
    root.add(pivot);
    steeringWheel = pivot;
  }

  // ---- chassis underside, axles, tank
  const under = new THREE.Mesh(new THREE.BoxGeometry(style.width - 0.5, 0.18, style.length - 0.6), darkSteel);
  under.position.set(0, style.sillY - 0.06, 0);
  root.add(under);
  for (const z of [style.wheelFrontZ, style.wheelRearZ]) {
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, style.halfTrack * 2 - 0.2, 10).rotateZ(Math.PI / 2), darkSteel);
    axle.position.set(0, style.wheelY + 0.02, z);
    const diff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), darkSteel);
    diff.position.set(0.1, style.wheelY + 0.03, z);
    diff.scale.set(1, 0.9, 0.8);
    root.add(axle, diff);
  }

  // ---- front: grille, headlights, bumper / bull bar
  const fz = style.frontZ + 0.01;
  const grilleMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1b, roughness: 0.7, metalness: 0.3 });
  const grille = new THREE.Mesh(new THREE.BoxGeometry(style.width * 0.5, 0.3, 0.04), grilleMat);
  grille.position.set(0, style.bonnetY - 0.28, fz);
  root.add(grille);
  for (let i = 0; i < 8; i += 1) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.26, 0.05), style.kind === 'wagon' ? steel : chrome);
    slat.position.set(-style.width * 0.22 + (i / 7) * style.width * 0.44, style.bonnetY - 0.28, fz + 0.015);
    root.add(slat);
  }
  const headlightLenses: THREE.Mesh[] = [];
  const hlY = style.bonnetY - 0.27;
  const hlX = style.width * 0.36;
  for (const sx of [1, -1]) {
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.018, 8, 24), chrome);
    bezel.position.set(sx * hlX, hlY, fz + 0.02);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), head);
    lens.position.set(sx * hlX, hlY, fz + 0.025);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0xb46a12, roughness: 0.3, emissive: 0x000000 }));
    ind.position.set(sx * (hlX + 0.02), hlY - 0.16, fz + 0.01);
    root.add(bezel, lens, ind);
    headlightLenses.push(lens);
  }
  const bumper = new THREE.Mesh(new RoundedBoxGeometry(style.width + 0.06, 0.2, 0.22, 2, 0.04), style.kind === 'wagon' ? darkSteel : blackPlastic);
  bumper.position.set(0, style.sillY + 0.06, style.frontZ + 0.06);
  root.add(bumper);
  if (style.kind === 'wagon') {
    // Tubular bull bar with a winch.
    const bar = (pts: THREE.Vector3[], r: number) => {
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      root.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, r, 8, false), darkSteel));
    };
    const z0 = style.frontZ + 0.16;
    bar([new THREE.Vector3(-0.62, style.sillY + 0.1, z0), new THREE.Vector3(-0.6, style.bonnetY - 0.02, z0 + 0.06), new THREE.Vector3(0, style.bonnetY + 0.02, z0 + 0.1), new THREE.Vector3(0.6, style.bonnetY - 0.02, z0 + 0.06), new THREE.Vector3(0.62, style.sillY + 0.1, z0)], 0.032);
    bar([new THREE.Vector3(-0.3, style.sillY + 0.12, z0 + 0.04), new THREE.Vector3(-0.28, style.bonnetY - 0.06, z0 + 0.1)], 0.026);
    bar([new THREE.Vector3(0.3, style.sillY + 0.12, z0 + 0.04), new THREE.Vector3(0.28, style.bonnetY - 0.06, z0 + 0.1)], 0.026);
    const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.5, 14).rotateZ(Math.PI / 2), darkSteel);
    winch.position.set(0, style.sillY + 0.2, z0 + 0.02);
    root.add(winch);
    // Snorkel up the right A-pillar.
    bar([new THREE.Vector3(-halfW + 0.02, style.sillY + 0.5, style.windshieldBaseZ + 0.35), new THREE.Vector3(-halfW - 0.04, style.beltY, style.windshieldBaseZ + 0.08), new THREE.Vector3(-halfW + 0.06, style.roofY + 0.04, style.windshieldTopZ - 0.05)], 0.045);
  }

  // ---- rear: tail lights, bumper, spare wheel
  const tailLenses: THREE.Mesh[] = [];
  for (const sx of [1, -1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.26, 0.03), tail);
    tl.position.set(sx * (halfW - 0.09), style.beltY - 0.22, style.rearZ - 0.025);
    const rl = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.03), reverse);
    rl.position.set(sx * (halfW - 0.09), style.beltY - 0.42, style.rearZ - 0.025);
    root.add(tl, rl);
    tailLenses.push(tl);
  }
  const rbumper = new THREE.Mesh(new RoundedBoxGeometry(style.width + 0.02, 0.18, 0.2, 2, 0.04), style.kind === 'wagon' ? darkSteel : blackPlastic);
  rbumper.position.set(0, style.sillY + 0.04, style.rearZ - 0.04);
  root.add(rbumper);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.16), new THREE.MeshStandardMaterial({ map: plateTexture(style.livery === 'forest' ? 'HCD 2417' : 'KRV-4482'), roughness: 0.5 }));
  plate.position.set(0, style.sillY + 0.3, style.rearZ - 0.03);
  plate.rotation.y = Math.PI;
  root.add(plate);

  // ---- mirrors
  for (const sx of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), blackPlastic);
    arm.position.set(sx * (halfW + 0.06), style.beltY + 0.06, style.windshieldBaseZ - 0.08);
    const housing = new THREE.Mesh(new RoundedBoxGeometry(0.06, 0.2, 0.15, 2, 0.02), blackPlastic);
    housing.position.set(sx * (halfW + 0.15), style.beltY + 0.1, style.windshieldBaseZ - 0.1);
    root.add(arm, housing);
  }

  // ---- roof rack, light bar, antenna
  const beaconLenses: THREE.Mesh[] = [];
  let jerrycanObj: THREE.Object3D | null = null;
  if (style.kind === 'wagon') {
    for (const x of [0.62, -0.62]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.8, 8).rotateX(Math.PI / 2), darkSteel);
      rail.position.set(x, style.roofY + 0.09, -0.95);
      root.add(rail);
      for (const z of [-0.2, -0.95, -1.7]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 0.05), darkSteel);
        leg.position.set(x, style.roofY + 0.045, z);
        root.add(leg);
      }
    }
    for (const z of [-0.2, -0.95, -1.7]) {
      const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1.24, 8).rotateZ(Math.PI / 2), darkSteel);
      cross.position.set(0, style.roofY + 0.1, z);
      root.add(cross);
    }
    if (o.lightBar !== false) {
      const barBase = new THREE.Mesh(new RoundedBoxGeometry(1.1, 0.07, 0.24, 2, 0.02), blackPlastic);
      barBase.position.set(0, style.roofY + 0.05, style.windshieldTopZ - 0.25);
      root.add(barBase);
      for (const x of [-0.38, -0.13, 0.13, 0.38]) {
        const lensB = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.09, 0.2, 2, 0.03), beacon);
        lensB.position.set(x, style.roofY + 0.12, style.windshieldTopZ - 0.25);
        root.add(lensB);
        beaconLenses.push(lensB);
      }
    }
    if (o.jerrycan) {
      const can = o.jerrycan.clone(true);
      jerrycanObj = can;
      can.position.set(0.32, style.roofY + 0.12, -1.35);
      can.rotation.set(0, Math.PI / 2, -Math.PI / 2);
      can.name = 'roof-jerrycan';
      root.add(can);
    }
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.008, 1.3, 5), blackPlastic);
    ant.position.set(halfW - 0.08, style.bonnetY + 0.65, style.windshieldBaseZ + 0.2);
    ant.name = 'antenna';
    root.add(ant);
  }

  // ---- mud flaps
  for (const z of [style.wheelFrontZ - style.archRadius - 0.04, style.wheelRearZ - style.archRadius - 0.04]) {
    for (const sx of [1, -1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.3, 0.012), blackPlastic);
      flap.position.set(sx * (style.halfTrack + 0.02), style.sillY - 0.1, z);
      root.add(flap);
    }
  }

  // ---- wheels
  const tread = treadTextures();
  const rubber = new THREE.MeshStandardMaterial({ map: tread.map, bumpMap: tread.bump, bumpScale: 2.5, roughness: 0.92, metalness: 0 });
  const rimMat = style.kind === 'wagon'
    ? new THREE.MeshStandardMaterial({ color: 0xc8c7bf, roughness: 0.55, metalness: 0.5, map: dirtTexture(o.seed + 11, '#c8c7bf', 0.8) })
    : new THREE.MeshStandardMaterial({ color: 0x9fa3a6, roughness: 0.3, metalness: 0.9 });
  const wheels: THREE.Group[] = [];
  const positions: [number, number][] = [
    [style.halfTrack, style.wheelFrontZ],
    [-style.halfTrack, style.wheelFrontZ],
    [style.halfTrack, style.wheelRearZ],
    [-style.halfTrack, style.wheelRearZ],
  ];
  positions.forEach(([x, z], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, style.wheelY, z);
    const spin = buildWheel(style.wheelRadius, rubber, rimMat, steel, x > 0 ? 1 : -1, style.kind);
    if (o.flatTire === i) {
      spin.scale.set(1, 0.84, 0.95);
      pivot.position.y -= style.wheelRadius * 0.15;
    }
    pivot.add(spin);
    root.add(pivot);
    wheels.push(pivot);
  });
  if (style.kind === 'wagon') {
    const spare = buildWheel(style.wheelRadius, rubber, rimMat, steel, -1, style.kind);
    spare.rotation.y = Math.PI / 2;
    spare.position.set(0.25, style.beltY - 0.05, style.rearZ - 0.2);
    root.add(spare);
  }

  // ---- open door (SUV): dark opening + hinged door panel
  let door: THREE.Object3D | null = null;
  if (o.openDoor) {
    const open = new THREE.Mesh(new THREE.PlaneGeometry(0.95, style.beltY - style.sillY + 0.5), interior);
    open.position.set(halfW + 0.01, (style.beltY + style.sillY) / 2 + 0.2, 0.25);
    open.rotation.y = Math.PI / 2;
    root.add(open);
    const hinge = new THREE.Group();
    hinge.position.set(halfW + 0.02, 0, 0.78);
    const panel = new THREE.Mesh(new RoundedBoxGeometry(0.06, style.beltY - style.sillY + 0.05, 1.0, 2, 0.03), paint);
    panel.position.set(0, (style.beltY + style.sillY) / 2, -0.5);
    const win = new THREE.Mesh(new THREE.BoxGeometry(0.03, style.roofY - style.beltY - 0.12, 0.9), glass);
    win.position.set(0, (style.roofY + style.beltY) / 2, -0.52);
    hinge.add(panel, win);
    hinge.rotation.y = 1.05;
    root.add(hinge);
    door = hinge;
  }

  // Rear door: seams, handle and a step on the bumper.
  {
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x0d0e0d, roughness: 0.8 });
    const rz2 = style.rearZ - 0.012;
    for (const x of [halfW - 0.07, -halfW + 0.07]) {
      const seamV = new THREE.Mesh(new THREE.BoxGeometry(0.012, style.beltY - style.sillY - 0.1, 0.01), seamMat);
      seamV.position.set(x, (style.beltY + style.sillY) / 2 + 0.02, rz2);
      root.add(seamV);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), steel);
    handle.position.set(-0.45, style.beltY - 0.12, rz2 - 0.01);
    root.add(handle);
    if (style.kind === 'wagon') {
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.03), darkSteel);
      for (const y of [style.sillY + 0.25, style.beltY - 0.15, style.beltY + 0.35]) {
        const h2 = hinge.clone();
        h2.position.set(halfW - 0.12, y, rz2 - 0.01);
        root.add(h2);
      }
    }
  }
  root.traverse((obj) => {
    const m = obj as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
  });
  // Bake every static part into one mesh per material (wheels, steering and door stay separate).
  const dynamicParts: THREE.Object3D[] = [...wheels];
  if (steeringWheel) dynamicParts.push(steeringWheel);
  if (door) dynamicParts.push(door);
  if (jerrycanObj) dynamicParts.push(jerrycanObj);
  mergeStatic(root, dynamicParts);
  for (const w of wheels) mergeStatic(w.children[0], []);
  return {
    root,
    wheels,
    steeringWheel,
    headlightLenses,
    tailLenses,
    beaconLenses,
    materials: { head, tail, beacon, reverse },
    anchors: {
      driverDoor: new THREE.Vector3(halfW + 0.55, 0.2, 0.15),
      driverEye: new THREE.Vector3(0.4, style.beltY + 0.52, -0.2),
      rear: new THREE.Vector3(0, 0.6, style.rearZ - 0.7),
      headlightL: new THREE.Vector3(hlX, hlY, fz + 0.1),
      headlightR: new THREE.Vector3(-hlX, hlY, fz + 0.1),
      exhaust: new THREE.Vector3(-0.6, style.sillY - 0.05, style.rearZ),
    },
    door,
    jerrycan: jerrycanObj,
  };
}

/** Splits ExtrudeGeometry walls so upward faces (roof) use material 1 and the rest material 2. */
function splitByNormal(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const pos = src.getAttribute('position') as THREE.BufferAttribute;
  const caps = src.groups.find((g) => g.materialIndex === 0);
  const capEnd = caps ? caps.start + caps.count : 0;
  const order: number[] = [];
  const roof: number[] = [];
  const rest: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let t = 0; t < pos.count; t += 3) {
    if (t < capEnd) {
      order.push(t);
      continue;
    }
    a.fromBufferAttribute(pos, t);
    b.fromBufferAttribute(pos, t + 1);
    c.fromBufferAttribute(pos, t + 2);
    const n = b.sub(a).cross(c.sub(a)).normalize();
    (n.y > 0.6 ? roof : rest).push(t);
  }
  const tris = [...order, ...roof, ...rest];
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const at = attr as THREE.BufferAttribute;
    const arr = new Float32Array(tris.length * 3 * at.itemSize);
    tris.forEach((t, i) => {
      for (let k = 0; k < 3; k += 1) {
        for (let j = 0; j < at.itemSize; j += 1) arr[(i * 3 + k) * at.itemSize + j] = (at.array as Float32Array)[(t + k) * at.itemSize + j];
      }
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize));
  }
  out.addGroup(0, order.length * 3, 0);
  out.addGroup(order.length * 3, roof.length * 3, 1);
  out.addGroup((order.length + roof.length) * 3, rest.length * 3, 2);
  return out;
}

function buildWheel(r: number, rubber: THREE.Material, rim: THREE.Material, steel: THREE.Material, side: number, kind: string): THREE.Group {
  const g = new THREE.Group();
  const w = 0.27;
  // Tyre cross-section revolved around the axle.
  const prof: THREE.Vector2[] = [];
  const inner = r * 0.62;
  prof.push(new THREE.Vector2(inner, -w / 2 + 0.02));
  prof.push(new THREE.Vector2(r * 0.86, -w / 2));
  prof.push(new THREE.Vector2(r * 0.97, -w / 2 + 0.025));
  prof.push(new THREE.Vector2(r, -w / 2 + 0.07));
  prof.push(new THREE.Vector2(r, w / 2 - 0.07));
  prof.push(new THREE.Vector2(r * 0.97, w / 2 - 0.025));
  prof.push(new THREE.Vector2(r * 0.86, w / 2));
  prof.push(new THREE.Vector2(inner, w / 2 - 0.02));
  const tyreGeo = new THREE.LatheGeometry(prof, 36);
  // Lathe revolves around Y; turn so the axle is X.
  tyreGeo.rotateZ(Math.PI / 2);
  const uv = tyreGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i += 1) uv.setX(i, uv.getX(i) * 3);
  const tyre = new THREE.Mesh(tyreGeo, rubber);
  g.add(tyre);
  // Rim: dished disc with a hub and lug nuts.
  const rimProf = [
    new THREE.Vector2(0.001, 0.07),
    new THREE.Vector2(inner * 0.32, 0.075),
    new THREE.Vector2(inner * 0.45, 0.05),
    new THREE.Vector2(inner * 0.9, 0.035),
    new THREE.Vector2(inner * 1.02, 0.09),
    new THREE.Vector2(inner * 1.02, -0.1),
  ];
  const rimGeo = new THREE.LatheGeometry(rimProf, 28);
  rimGeo.rotateZ(-Math.PI / 2 * side);
  const rimMesh = new THREE.Mesh(rimGeo, rim);
  g.add(rimMesh);
  const nuts = kind === 'wagon' ? 6 : 5;
  for (let i = 0; i < nuts; i += 1) {
    const a = (i / nuts) * Math.PI * 2;
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.03, 6).rotateZ(Math.PI / 2), steel);
    nut.position.set(side * 0.085, Math.cos(a) * inner * 0.22, Math.sin(a) * inner * 0.22);
    g.add(nut);
  }
  return g;
}

function plateTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 120;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9d6c8';
  ctx.fillRect(0, 0, 256, 120);
  ctx.strokeStyle = '#2b3a4a';
  ctx.lineWidth = 6;
  ctx.strokeRect(5, 5, 246, 110);
  ctx.fillStyle = '#26364a';
  ctx.font = '700 52px "Segoe UI", Arial';
  ctx.textAlign = 'center';
  ctx.fillText(text, 128, 82);
  ctx.fillStyle = 'rgba(80,64,40,0.35)';
  ctx.fillRect(0, 80, 256, 40);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crackTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1c2124';
  ctx.fillRect(0, 0, 512, 256);
  const rng = mulberry32(seed);
  ctx.strokeStyle = 'rgba(220,225,225,0.7)';
  ctx.lineWidth = 1.2;
  const cx = 330;
  const cy = 110;
  for (let i = 0; i < 26; i += 1) {
    let x = cx;
    let y = cy;
    const a = rng() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 8; k += 1) {
      x += Math.cos(a + range(rng, -0.4, 0.4)) * range(rng, 10, 40);
      y += Math.sin(a + range(rng, -0.4, 0.4)) * range(rng, 10, 40);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let r = 14; r < 90; r += 18) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + range(rng, -4, 4), 0, Math.PI * 2);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
