// Every man-made location in the valley: trailhead, ranger station, bridge,
// Ridge Gate, lookout tower, Miller cabin, the abandoned SUV, the Unit 4 wreck,
// the hidden camp and Hale's flagging-tape trail. Returns the anchors and
// movable parts the mystery needs.

import * as THREE from 'three';
import type { TerrainData } from './terrain.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { SITES, TAPE_TRAIL } from './layout.ts';
import { collideBox, mesh, pbrMaterial, signTexture, texBox, texCylinder, wallWithOpenings } from './build.ts';
import { placeModel } from '../render/models.ts';
import { CIVILIAN_SUV, FOREST_WAGON, buildVehicle } from '../vehicles/vehicleModel.ts';
import { Path } from './paths.ts';
import { mulberry32, range } from './rng.ts';
import { mergeStatic } from '../render/merge.ts';
import type RAPIER from '@dimforge/rapier3d-compat';

export interface Structures {
  group: THREE.Group;
  anchors: Record<string, THREE.Vector3>;
  station: {
    door: THREE.Object3D;
    doorCollider: RAPIER.Collider;
    lamp: THREE.PointLight;
    porchLamp: THREE.PointLight;
    lampMat: THREE.MeshStandardMaterial;
    radioLed: THREE.MeshStandardMaterial;
    footprint: (x: number, z: number) => boolean;
  };
  gate: { arm: THREE.Object3D; collider: RAPIER.Collider };
  cabin: { glow: THREE.PointLight; smoke: THREE.Points; footprint: (x: number, z: number) => boolean };
  tower: { footprint: (x: number, z: number, y: number) => boolean };
  /** Objects that can be hidden once picked up. */
  pickups: Record<string, THREE.Object3D>;
  bridgeFootprint: (x: number, z: number) => boolean;
  updateSmoke: (dt: number, time: number) => void;
}

interface Ctx {
  terrain: TerrainData;
  physics: PhysicsWorld;
  root: THREE.Group;
  anchors: Record<string, THREE.Vector3>;
}

function ground(ctx: Ctx, x: number, z: number): number {
  return ctx.terrain.heightAt(x, z);
}

/** Group placed at a site with heading (local +Z faces `heading`). */
function siteGroup(ctx: Ctx, x: number, z: number, heading: number, y?: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y ?? ground(ctx, x, z), z);
  g.rotation.y = heading;
  ctx.root.add(g);
  return g;
}

function local(g: THREE.Object3D, x: number, y: number, z: number): THREE.Vector3 {
  g.updateMatrixWorld(true);
  return new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld);
}

function roadHeading(ctx: Ctx, x: number, z: number): number {
  const road = ctx.terrain.roads[0];
  const n = road.nearest(x, z);
  return road.headingAt(n.s);
}

async function addModel(parent: THREE.Object3D, slug: string, x: number, y: number, z: number, ry = 0, size?: number): Promise<THREE.Group> {
  const m = await placeModel(slug, size ? { size } : {});
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

// ------------------------------------------------------------------ station

async function buildStation(ctx: Ctx): Promise<Structures['station']> {
  const { physics } = ctx;
  const s = SITES.station;
  const y0 = ground(ctx, s.x, s.z);
  const FL = 0.45;
  const g = siteGroup(ctx, s.x, s.z, s.heading, y0);
  g.name = 'ranger-station';
  const [siding, concrete, planks, floor, roof, metal, door] = await Promise.all([
    pbrMaterial('weathered_plank_siding', { color: '#c9c2b2' }),
    pbrMaterial('concrete_floor_worn_001'),
    pbrMaterial('weathered_planks'),
    pbrMaterial('old_planks_02'),
    pbrMaterial('corrugated_iron_02', { metalness: 0.6, roughness: 0.9, color: '#a7a69e' }),
    pbrMaterial('rusty_metal_02', { metalness: 0.5 }),
    pbrMaterial('brown_planks_04', { color: '#8d7a62' }),
  ]);
  const W = 9;
  const D = 6.5;
  const H = 2.8;
  const T = 0.16;
  const statics: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh, collide = true) => {
    g.add(m);
    if (collide) statics.push(m);
    return m;
  };
  add(mesh(texBox(W + 0.4, FL + 0.6, D + 0.4, 2.2), concrete, 0, FL / 2 - 0.3, 0));
  add(mesh(texBox(W - 0.3, 0.04, D - 0.3, 2.0), floor, 0, FL + 0.02, 0), false);
  // Walls (front faces local +Z).
  const front = wallWithOpenings(W, H, T, [
    { x: -1.2, w: 1.0, y0: 0, y1: 2.1 },
    { x: -3.2, w: 1.2, y0: 0.95, y1: 2.05 },
    { x: 1.8, w: 1.7, y0: 0.95, y1: 2.05 },
  ], siding, 2.2);
  const back = wallWithOpenings(W, H, T, [{ x: 2.4, w: 1.2, y0: 1.0, y1: 2.0 }], siding, 2.2);
  const left = wallWithOpenings(D, H, T, [{ x: 0.6, w: 1.2, y0: 0.95, y1: 2.05 }], siding, 2.2);
  const right = wallWithOpenings(D, H, T, [{ x: -0.8, w: 1.0, y0: 0.95, y1: 2.05 }], siding, 2.2);
  const wallGroup = (parts: THREE.Mesh[], x: number, z: number, ry: number) => {
    const wg = new THREE.Group();
    wg.position.set(x, FL, z);
    wg.rotation.y = ry;
    for (const p of parts) wg.add(p);
    g.add(wg);
    statics.push(...parts);
  };
  wallGroup(front, 0, D / 2, 0);
  wallGroup(back, 0, -D / 2, Math.PI);
  wallGroup(left, -W / 2, 0, -Math.PI / 2);
  wallGroup(right, W / 2, 0, Math.PI / 2);
  // Window glass (dirty) and frames.
  const glass = new THREE.MeshStandardMaterial({ color: 0x2d3433, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c3, roughness: 0.8 });
  const windowAt = (x: number, z: number, ry: number, w: number, y0: number, y1: number) => {
    const wg = new THREE.Group();
    wg.position.set(x, FL, z);
    wg.rotation.y = ry;
    wg.add(mesh(new THREE.PlaneGeometry(w, y1 - y0), glass, 0, (y0 + y1) / 2, 0));
    for (const [fx, fy, fw, fh] of [[0, y0, w + 0.1, 0.08], [0, y1, w + 0.1, 0.08], [-w / 2, (y0 + y1) / 2, 0.08, y1 - y0], [w / 2, (y0 + y1) / 2, 0.08, y1 - y0], [0, (y0 + y1) / 2, 0.05, y1 - y0]] as const) {
      wg.add(mesh(new THREE.BoxGeometry(fw, fh, T + 0.04), frameMat, fx, fy, 0));
    }
    g.add(wg);
  };
  windowAt(-3.2, D / 2, 0, 1.2, 0.95, 2.05);
  windowAt(1.8, D / 2, 0, 1.7, 0.95, 2.05);
  windowAt(-2.4, -D / 2, Math.PI, 1.2, 1.0, 2.0);
  windowAt(-W / 2, -0.6, -Math.PI / 2, 1.2, 0.95, 2.05);
  windowAt(W / 2, -0.8, Math.PI / 2, 1.0, 0.95, 2.05);
  // Gable roof (ridge along X).
  const rise = 1.4;
  const run = D / 2 + 0.45;
  const slope = Math.atan2(rise, run);
  const len = Math.hypot(rise, run) + 0.05;
  for (const side of [1, -1]) {
    const plane = mesh(texBox(W + 0.9, 0.05, len, 1.1, true), roof, 0, FL + H + rise / 2 + 0.03, (side * run) / 2 - side * 0.0);
    plane.rotation.x = side * slope;
    plane.position.z = (side * (run - 0.45)) / 2 + side * 0.22;
    g.add(plane);
  }
  const ridge = mesh(new THREE.BoxGeometry(W + 0.95, 0.12, 0.3), metal, 0, FL + H + rise + 0.02, 0);
  g.add(ridge);
  // Gable triangles.
  const tri = new THREE.Shape();
  tri.moveTo(-D / 2, 0);
  tri.lineTo(D / 2, 0);
  tri.lineTo(0, rise);
  tri.lineTo(-D / 2, 0);
  const triGeo = new THREE.ExtrudeGeometry(tri, { depth: T, bevelEnabled: false });
  triGeo.scale(1 / 2.2, 1 / 2.2, 1);
  const uvA = triGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uvA.count; i += 1) uvA.setXY(i, uvA.getX(i), uvA.getY(i));
  triGeo.scale(2.2, 2.2, 1);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(triGeo, siding);
    m.position.set(side * (W / 2), FL + H, 0);
    m.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
    m.position.x += side > 0 ? -T / 2 : T / 2;
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  // Porch deck, steps, posts and porch roof.
  add(mesh(texBox(W, 0.14, 2.2, 2.0, true), planks, 0, FL - 0.07, D / 2 + 1.1));
  add(mesh(texBox(2.2, 0.16, 0.36, 1.5), planks, -1.2, FL - 0.24, D / 2 + 2.38));
  add(mesh(texBox(2.2, 0.16, 0.36, 1.5), planks, -1.2, FL - 0.4, D / 2 + 2.74));
  for (const px of [-4.3, -2.0, 2.0, 4.3]) g.add(mesh(texBox(0.14, H, 0.14, 1.5), planks, px, FL + H / 2, D / 2 + 2.1));
  const porchRoof = mesh(texBox(W + 0.4, 0.05, 2.5, 1.1, true), roof, 0, FL + H - 0.08, D / 2 + 1.2);
  porchRoof.rotation.x = 0.12;
  g.add(porchRoof);
  // Front door: hinged on its left edge, left ajar.
  const hinge = new THREE.Group();
  hinge.position.set(-1.7, FL, D / 2);
  const leaf = mesh(texBox(1.0, 2.08, 0.05, 1.2), door, 0.5, 1.04, 0);
  const knob = mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshStandardMaterial({ color: 0xa08a5a, metalness: 0.9, roughness: 0.35 }), 0.88, 1.0, 0.05);
  hinge.add(leaf, knob);
  hinge.rotation.y = -0.35;
  g.add(hinge);
  // Interior.
  const desk = await addModel(g, 'metal_office_desk', -1.5, FL, -D / 2 + 0.55, 0);
  const deskTop = new THREE.Box3().setFromObject(desk).max.y - g.position.y;
  const radio = await addModel(g, 'vintage_radio_transceiver', -1.05, deskTop, -D / 2 + 0.5, 0.15, 0.48);
  await addModel(g, 'binder_notebook', -1.95, deskTop, -D / 2 + 0.55, -0.4, 0.33);
  await addModel(g, 'painted_wooden_chair_01', -1.5, FL, -D / 2 + 1.35, Math.PI + 0.3);
  await addModel(g, 'worn_metal_rack', 3.4, FL, -D / 2 + 0.35, 0);
  await addModel(g, 'metal_toolbox', 3.4, FL + 0.02, -D / 2 + 1.2, 0.4, 0.5);
  await addModel(g, 'office_notepads', 0.6, FL + 0.03, -0.4, 0.8, 0.3);
  await addModel(g, 'clipboard', 0.2, FL + 0.03, 0.3, -0.5, 0.33).catch(() => null);
  const clock = await addModel(g, 'wall_clock', -1.5, FL + 2.1, -D / 2 + 0.12, 0, 0.32);
  clock.rotation.x = 0;
  const radioLed = new THREE.MeshStandardMaterial({ color: 0x220a06, emissive: new THREE.Color(1, 0.25, 0.1), emissiveIntensity: 0 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), radioLed);
  led.position.copy(new THREE.Vector3(-1.05 + 0.12, deskTop + 0.12, -D / 2 + 0.75));
  g.add(led);
  // Key cabinet on the left wall with one gate key still hanging.
  const cabinetMat = new THREE.MeshStandardMaterial({ color: 0x5b4a36, roughness: 0.8 });
  const cab = mesh(new THREE.BoxGeometry(0.12, 0.62, 0.5), cabinetMat, -W / 2 + T / 2 + 0.07, FL + 1.55, -1.6);
  g.add(cab);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0xb59a52, metalness: 0.9, roughness: 0.35 });
  const tagMat = new THREE.MeshStandardMaterial({ color: 0xc94f2a, roughness: 0.7 });
  const keyGroup = new THREE.Group();
  keyGroup.position.set(-W / 2 + T / 2 + 0.15, FL + 1.55, -1.48);
  keyGroup.add(mesh(new THREE.BoxGeometry(0.01, 0.06, 0.02), keyMat, 0, 0, 0));
  keyGroup.add(mesh(new THREE.BoxGeometry(0.01, 0.05, 0.035), tagMat, 0, -0.06, 0));
  g.add(keyGroup);
  // Wall map (texture filled in later by the mystery's map renderer).
  const mapBoard = mesh(new THREE.PlaneGeometry(1.3, 0.95), new THREE.MeshStandardMaterial({ color: 0xe8e1cc, roughness: 0.9 }), W / 2 - T / 2 - 0.02, FL + 1.6, 0.6);
  mapBoard.rotation.y = -Math.PI / 2;
  mapBoard.name = 'wall-map';
  g.add(mapBoard);
  // Ceiling lamp and porch lamp: dark until power is restored.
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c0, emissive: new THREE.Color(1, 0.86, 0.62), emissiveIntensity: 0 });
  await addModel(g, 'hanging_industrial_lamp', 0, FL + H - 0.65, -0.3, 0, 0.55);
  const bulb = mesh(new THREE.SphereGeometry(0.05, 10, 8), lampMat, 0, FL + H - 0.62, -0.3);
  g.add(bulb);
  const lamp = new THREE.PointLight(0xffd9a0, 0, 9, 1.6);
  lamp.position.set(0, FL + H - 0.7, -0.3);
  lamp.visible = false;
  g.add(lamp);
  await addModel(g, 'industrial_wall_lamp', -1.2, FL + 2.35, D / 2 + 0.12, 0, 0.3);
  const porchLamp = new THREE.PointLight(0xffd9a0, 0, 10, 1.6);
  porchLamp.position.set(-1.2, FL + 2.2, D / 2 + 0.5);
  porchLamp.visible = false;
  g.add(porchLamp);
  // Generator lean-to on the right (south) side, power box on the wall.
  const gx = W / 2 + 1.5;
  const gz = -1.2;
  add(mesh(texBox(2.2, 0.12, 2.0, 2.0), concrete, gx, 0.04, gz));
  for (const [px, pz] of [[-1.0, -0.9], [1.0, -0.9], [-1.0, 0.9], [1.0, 0.9]] as const) g.add(mesh(texBox(0.1, 2.2, 0.1, 1.5), planks, gx + px, 1.1, gz + pz));
  const lean = mesh(texBox(2.5, 0.04, 2.3, 1.1, true), roof, gx, 2.25, gz);
  lean.rotation.z = -0.12;
  g.add(lean);
  const generator = await addModel(g, 'portable_generator', gx, 0.1, gz, -Math.PI / 2, 0.75);
  await addModel(g, 'barrel_03', gx + 0.6, 0.1, gz + 1.7, 0.4, 0.9);
  await addModel(g, 'barrel_03', gx + 1.25, 0, gz + 2.1, 1.1, 0.9);
  await addModel(g, 'power_box_01', W / 2 + 0.06, FL + 1.1, 0.9, Math.PI / 2, 0.55);
  await addModel(g, 'propane_tank', -W / 2 - 0.9, 0, -2.2, 0, 1.1);
  await addModel(g, 'wooden_crate_02', 4.0, FL, D / 2 + 1.5, 0.3, 0.6);
  await addModel(g, 'painted_wooden_cabinet_02', 3.95, FL, D / 2 - 0.45, Math.PI, 1.0);
  await addModel(g, 'wooden_picnic_table', 2.6, 0, D / 2 + 6.2, 0.25, 2.0);
  ctx.anchors.stationDoor = local(g, -1.2, FL + 1.1, D / 2 + 0.3);
  ctx.anchors.logbook = local(g, -1.95, deskTop + 0.05, -D / 2 + 0.55);
  ctx.anchors.radio = local(g, -1.05, deskTop + 0.15, -D / 2 + 0.5);
  ctx.anchors.keyCabinet = local(g, -W / 2 + 0.3, FL + 1.55, -1.55);
  ctx.anchors.wallMap = local(g, W / 2 - 0.3, FL + 1.6, 0.6);
  ctx.anchors.generator = local(g, gx, 0.55, gz);
  ctx.anchors.powerBox = local(g, W / 2 + 0.25, FL + 1.25, 0.9);
  ctx.anchors.stationInside = local(g, 0, FL, 0);
  void generator;
  void radio;
  // Colliders for structural pieces (door handled separately).
  for (const m of statics) collideBox(physics, m);
  const deskCol = mesh(new THREE.BoxGeometry(1.0, 1.0, 0.9), frameMat, -1.5, FL + 0.5, -D / 2 + 0.55);
  deskCol.visible = false;
  g.add(deskCol);
  collideBox(physics, deskCol, 0);
  const doorCollider = physics.addBox({ ...worldBox(g, -1.2, FL + 1.04, D / 2, 0.5, 1.04, 0.05) });
  // Merge static visual parts (keep door and lamp bulbs separate).
  mergeStatic(g, [hinge, bulb, led, keyGroup, mapBoard]);
  ctx.anchors.keyObject = local(g, -W / 2 + T / 2 + 0.15, FL + 1.55, -1.48);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const footprint = (x: number, z: number) => {
    const p = new THREE.Vector3(x, 0, z).applyMatrix4(inv);
    return Math.abs(p.x) < W / 2 + 0.1 && p.z > -D / 2 - 0.1 && p.z < D / 2 + 2.3;
  };
  (keyGroup as THREE.Object3D).name = 'gate-key';
  ctx.anchors.mapBoard = mapBoard.getWorldPosition(new THREE.Vector3());
  stationKey = keyGroup;
  stationMap = mapBoard;
  return { door: hinge, doorCollider, lamp, porchLamp, lampMat, radioLed, footprint };
}

let stationKey: THREE.Object3D | null = null;
let stationMap: THREE.Mesh | null = null;

function worldBox(g: THREE.Object3D, x: number, y: number, z: number, hx: number, hy: number, hz: number) {
  const c = local(g, x, y, z);
  const q = new THREE.Quaternion();
  g.getWorldQuaternion(q);
  return { x: c.x, y: c.y, z: c.z, hx, hy, hz, quat: { x: q.x, y: q.y, z: q.z, w: q.w } };
}

// ------------------------------------------------------------------ signs

async function buildSigns(ctx: Ctx): Promise<void> {
  const planks = await pbrMaterial('weathered_planks');
  const post = (parent: THREE.Object3D, x: number, h: number) => parent.add(mesh(texBox(0.12, h, 0.12, 1.2), planks, x, h / 2, 0));
  // Trailhead information board.
  {
    const b = SITES.infoBoard;
    const g = siteGroup(ctx, b.x, b.z, roadHeading(ctx, b.x, b.z) + Math.PI / 2 + 0.4);
    post(g, -1.0, 2.6);
    post(g, 1.0, 2.6);
    const tex = signTexture(
      [
        { text: 'HOLLOW CREEK RANGER DISTRICT', size: 46, gap: 8 },
        { text: 'Hollow Creek Road — unmaintained beyond this point', size: 30, weight: 400, gap: 30 },
        { text: 'BRIDGE AT MILE 2 CLOSED FOR REPAIR', size: 34, color: '#e8b860', gap: 10 },
        { text: 'High-clearance vehicles use the posted ford', size: 28, weight: 400, gap: 34 },
        { text: 'Hunting with artificial light is illegal.', size: 30, weight: 400 },
        { text: 'Report spotlighting to the district office.', size: 30, weight: 400, gap: 30 },
        { text: 'Ranger station 1.2 mi  ·  Fire lookout 2.4 mi', size: 28, weight: 400, color: '#cfc8b1' },
      ],
      { w: 1024, h: 640, bg: '#3d3a2c', border: '#c9b98a', weathered: true },
    );
    const board = mesh(new THREE.BoxGeometry(1.9, 1.2, 0.05), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), 0, 1.65, 0.07);
    g.add(board);
    const roofM = mesh(texBox(2.3, 0.05, 0.7, 1.2), planks, 0, 2.62, 0.1);
    roofM.rotation.x = -0.25;
    g.add(roofM);
    ctx.anchors.infoBoard = local(g, 0, 1.6, 0.4);
    const boardCol = mesh(new THREE.BoxGeometry(2.1, 2.6, 0.3), planks, 0, 1.3, 0);
    boardCol.visible = false;
    g.add(boardCol);
    collideBox(ctx.physics, boardCol, 0);
  }
  // Road warning sign near the entrance.
  {
    const s = SITES.warningSign;
    const g = siteGroup(ctx, s.x, s.z, roadHeading(ctx, s.x, s.z) + Math.PI + 0.25);
    post(g, -0.5, 2.3);
    post(g, 0.5, 2.3);
    const tex = signTexture(
      [
        { text: 'ROAD UNMAINTAINED', size: 64, color: '#1d1a12', gap: 10 },
        { text: 'NO SERVICES · NO PHONE SIGNAL', size: 38, color: '#1d1a12', weight: 500 },
      ],
      { w: 1024, h: 420, bg: '#c9a532', border: '#1d1a12', weathered: true },
    );
    g.add(mesh(new THREE.BoxGeometry(1.5, 0.62, 0.04), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2 }), 0, 1.9, 0.07));
    ctx.anchors.warningSign = local(g, 0, 1.8, 0.5);
  }
  // Station sign at the spur junction.
  {
    const g = siteGroup(ctx, 37.5, 8.5, -Math.PI / 2 - 0.6);
    post(g, -0.9, 2.0);
    post(g, 0.9, 2.0);
    const tex = signTexture(
      [
        { text: 'HOLLOW CREEK', size: 70, gap: 4 },
        { text: 'RANGER STATION', size: 48, weight: 500 },
      ],
      { w: 1024, h: 360, bg: '#4a3f2c', border: '#d8c79a', weathered: true },
    );
    g.add(mesh(new THREE.BoxGeometry(2.0, 0.7, 0.07), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }), 0, 1.55, 0.08));
  }
  // Entrance gate swung open beside the road.
  {
    const s = SITES.entranceGate;
    const h = roadHeading(ctx, s.x, s.z);
    const g = siteGroup(ctx, s.x, s.z, h + Math.PI / 2);
    const metal = await pbrMaterial('rusty_metal_02', { metalness: 0.6, color: '#c8b46a' });
    g.add(mesh(texCylinder(0.08, 1.3, 0.8), metal, 3.4, 0.65, 0));
    const arm = mesh(texCylinder(0.05, 5.2, 0.8, 10, true), metal, 3.4, 1.05, 2.6);
    arm.rotation.x = Math.PI / 2;
    g.add(arm);
  }
}

// ------------------------------------------------------------------ bridge

async function buildBridge(ctx: Ctx): Promise<(x: number, z: number) => boolean> {
  const gap = ctx.terrain.bridgeGap();
  if (!gap) return () => false;
  const road = ctx.terrain.roads[0];
  const mid = (gap.s0 + gap.s1) / 2;
  const p = road.at(mid);
  const heading = Math.atan2(p.tx, p.tz);
  const g = siteGroup(ctx, p.x, p.z, heading, gap.deck);
  g.name = 'bridge';
  const [bark, planks, beams] = await Promise.all([
    pbrMaterial('bark_brown_02', { color: '#8a7f73' }),
    pbrMaterial('weathered_planks'),
    pbrMaterial('beam_wall_01', { color: '#9a9184' }),
  ]);
  const half = (gap.s1 - gap.s0) / 2;
  const statics: THREE.Mesh[] = [];
  // Log-crib abutments either side.
  for (const side of [-1, 1]) {
    const z = side * (half + 1.2);
    const crib = mesh(texBox(4.8, 3.2, 2.6, 1.4), beams, 0, -1.55, z);
    g.add(crib);
    statics.push(crib);
  }
  // Two stringers per side; the span failed in the middle and both halves sagged into the creek.
  const halves: { pivot: number; dir: number; angle: number }[] = [
    { pivot: -half - 0.2, dir: 1, angle: 0.36 },
    { pivot: half + 0.2, dir: -1, angle: 0.22 },
  ];
  const rng = mulberry32(55);
  for (const hs of halves) {
    const span = new THREE.Group();
    span.position.set(0, -0.15, hs.pivot);
    span.rotation.x = hs.dir * hs.angle;
    const len = half + 0.4 - (hs.dir > 0 ? 0.6 : 1.4);
    for (const x of [-1.25, 1.25]) {
      const log = mesh(texCylinder(0.22, len, 1.4, 10, true), bark, x, 0, (hs.dir * len) / 2);
      log.rotation.x = Math.PI / 2;
      span.add(log);
    }
    for (let i = 0.3; i < len; i += 0.3) {
      if (rng() < 0.12 && i > len * 0.5) continue;
      const plank = mesh(texBox(3.6 + range(rng, -0.1, 0.1), 0.06, 0.26, 1.6), planks, range(rng, -0.05, 0.05), 0.25, hs.dir * i);
      plank.rotation.y = range(rng, -0.04, 0.04);
      span.add(plank);
    }
    g.add(span);
    const deck = mesh(new THREE.BoxGeometry(3.6, 0.3, len), planks, 0, 0.12, (hs.dir * len) / 2);
    span.add(deck);
    deck.visible = false;
    statics.push(deck);
  }
  // Loose planks in the creek.
  for (let i = 0; i < 7; i += 1) {
    const plank = mesh(texBox(2.4, 0.06, 0.26, 1.6), planks, range(rng, -3, 3), -2.55 + range(rng, 0, 0.2), range(rng, -3, 3));
    plank.rotation.set(range(rng, -0.3, 0.3), rng() * Math.PI, range(rng, -0.2, 0.2));
    g.add(plank);
  }
  // Rails on the abutments and a knocked-over barrier at the south end.
  for (const side of [-1, 1]) {
    for (const x of [-2.1, 2.1]) {
      g.add(mesh(texBox(0.12, 1.1, 0.12, 1.2), planks, x, 0.55, side * (half + 0.4)));
      g.add(mesh(texBox(0.1, 0.1, 2.0, 1.2), planks, x, 1.0, side * (half + 1.3)));
    }
  }
  const stripe = signTexture([{ text: 'BRIDGE CLOSED', size: 74, color: '#1a1a1a' }], { w: 1024, h: 180, bg: '#d9d4c6', weathered: true });
  const barrier = new THREE.Group();
  barrier.position.set(0.6, 0.1, -half - 3.2);
  barrier.rotation.set(-1.35, 0.4, 0);
  barrier.add(mesh(new THREE.BoxGeometry(2.4, 0.3, 0.04), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.7 }), 0, 0.9, 0));
  for (const x of [-1.0, 1.0]) barrier.add(mesh(texBox(0.08, 1.0, 0.08, 1.2), planks, x, 0.5, 0));
  g.add(barrier);
  for (const m of statics) collideBox(ctx.physics, m);
  ctx.anchors.bridge = local(g, 0, 0.6, -half - 0.6);
  ctx.anchors.bridgeTracks = new THREE.Vector3(14.5, ground(ctx, 14.5, -50.5) + 0.3, -50.5);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  mergeStatic(g, []);
  return (x: number, z: number) => {
    const q = new THREE.Vector3(x, 0, z).applyMatrix4(inv);
    return Math.abs(q.x) < 2.4 && Math.abs(q.z) < half + 2.5;
  };
}

// ------------------------------------------------------------------ gate

async function buildGate(ctx: Ctx): Promise<Structures['gate']> {
  const s = SITES.gate;
  const h = roadHeading(ctx, s.x, s.z);
  const g = siteGroup(ctx, s.x, s.z, h);
  g.name = 'ridge-gate';
  const metal = await pbrMaterial('rusty_metal_02', { metalness: 0.6, color: '#d0b860' });
  const rock = await pbrMaterial('mossy_rock');
  const postL = mesh(texCylinder(0.1, 1.5, 0.8), metal, 3.0, 0.75, 0);
  const postR = mesh(texCylinder(0.1, 1.5, 0.8), metal, -3.0, 0.75, 0);
  g.add(postL, postR);
  const arm = new THREE.Group();
  arm.position.set(3.0, 0, 0);
  const bar = mesh(texCylinder(0.055, 6.0, 0.8, 10, true), metal, -3.0, 1.05, 0);
  bar.rotation.z = Math.PI / 2;
  const lowBar = mesh(texCylinder(0.04, 5.8, 0.8, 10, true), metal, -2.9, 0.55, 0);
  lowBar.rotation.z = Math.PI / 2;
  const brace = mesh(texCylinder(0.035, 3.1, 0.8, 8, true), metal, -1.4, 0.8, 0);
  brace.rotation.z = Math.PI / 2 - 0.17;
  const signTex = signTexture([{ text: 'AUTHORIZED VEHICLES ONLY', size: 60, color: '#1b1810' }], { w: 1024, h: 160, bg: '#d6b43c', weathered: true });
  const sign = mesh(new THREE.BoxGeometry(1.5, 0.24, 0.02), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 }), -3.0, 0.8, 0.07);
  arm.add(bar, lowBar, brace, sign);
  // Chain and new padlock at the latch post.
  const chainMat = new THREE.MeshStandardMaterial({ color: 0x6d6a62, metalness: 0.9, roughness: 0.45 });
  for (let i = 0; i < 6; i += 1) {
    const link = mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 10), chainMat, -5.95 + Math.sin(i) * 0.02, 1.0 - i * 0.05, 0.05);
    link.rotation.y = i % 2 ? Math.PI / 2 : 0;
    arm.add(link);
  }
  const lock = mesh(new THREE.BoxGeometry(0.07, 0.08, 0.03), new THREE.MeshStandardMaterial({ color: 0xc2a24a, metalness: 0.95, roughness: 0.25 }), -5.95, 0.68, 0.06);
  arm.add(lock);
  lock.name = 'padlock';
  g.add(arm);
  // Boulders either side so vehicles cannot drive around.
  const rng = mulberry32(81);
  for (const side of [1, -1]) {
    for (let i = 0; i < 4; i += 1) {
      const r = range(rng, 0.65, 1.05);
      const x = side * (3.9 + i * 1.3 + range(rng, -0.2, 0.2));
      const z = range(rng, -0.7, 0.7);
      const geo = new THREE.IcosahedronGeometry(r, 2);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < pos.count; k += 1) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, k);
        v.multiplyScalar(1 + 0.18 * Math.sin(v.x * 3.1 + v.z * 2.3) * Math.cos(v.y * 2.7));
        v.y *= 0.72;
        pos.setXYZ(k, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const b = mesh(geo, rock, x, r * 0.35, z, rng() * 6);
      g.add(b);
      const wp = local(g, x, r * 0.35, z);
      ctx.physics.tag(ctx.physics.addBall(wp.x, wp.y, wp.z, r * 0.85), 'rock');
    }
  }
  const collider = ctx.physics.tag(ctx.physics.addBox(worldBox(g, 0, 0.8, 0, 3.0, 0.8, 0.1)), 'metal');
  for (const pst of [postL, postR]) collideBox(ctx.physics, pst);
  ctx.anchors.gateLock = local(g, -2.95, 0.8, 0.3);
  ctx.anchors.gate = local(g, 0, 1, 0);
  return { arm, collider };
}

// ------------------------------------------------------------------ tower

async function buildTower(ctx: Ctx): Promise<Structures['tower']> {
  const s = SITES.lookout;
  const g = siteGroup(ctx, s.x, s.z, 0.35);
  g.name = 'lookout-tower';
  const [beam, planks, roof] = await Promise.all([
    pbrMaterial('beam_wall_01', { color: '#a49a8a' }),
    pbrMaterial('weathered_planks'),
    pbrMaterial('rusty_corrugated_iron', { metalness: 0.5 }),
  ]);
  const TOP = 9;
  const statics: THREE.Mesh[] = [];
  // Splayed legs.
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]] as const) {
    const legGeo = texBox(0.24, Math.hypot(TOP, 0.8), 0.24, 1.6);
    const leg = mesh(legGeo, beam, sx * 2.2, TOP / 2, sz * 2.2);
    leg.rotation.set(sz * -0.09, 0, sx * 0.09);
    g.add(leg);
    const c = mesh(new THREE.BoxGeometry(0.4, TOP, 0.4), beam, sx * 2.2, TOP / 2, sz * 2.2);
    c.visible = false;
    g.add(c);
    statics.push(c);
  }
  // Cross bracing.
  for (const y of [1.2, 4.4, 7.4]) {
    const w = 4.9 - (y / TOP) * 0.9;
    for (const [rx, rz, ry] of [[0, w / 2, 0], [0, -w / 2, 0], [w / 2, 0, Math.PI / 2], [-w / 2, 0, Math.PI / 2]] as const) {
      const b = mesh(texBox(w, 0.14, 0.1, 1.6), beam, rx, y, rz, ry);
      g.add(b);
      const d = mesh(texBox(Math.hypot(w, 3.0), 0.1, 0.08, 1.6), beam, rx, y + 1.5, rz, ry);
      d.rotateZ(Math.atan2(3.0, w));
      g.add(d);
    }
  }
  // Stairs: flight 1 on the east side, landing, flight 2 along the north side.
  const flight = (x0: number, z0: number, y0: number, x1: number, z1: number, y1: number) => {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const run = Math.hypot(dx, dz);
    const rise = y1 - y0;
    const ang = Math.atan2(rise, run);
    const yaw = Math.atan2(dx, dz);
    const fg = new THREE.Group();
    fg.position.set(x0, y0, z0);
    fg.rotation.y = yaw;
    const steps = Math.round(rise / 0.2);
    for (let i = 0; i < steps; i += 1) {
      const t = (i + 0.5) / steps;
      fg.add(mesh(texBox(1.0, 0.05, run / steps + 0.04, 1.2), planks, 0, t * rise - 0.03, t * run));
    }
    for (const sx of [-0.55, 0.55]) {
      const stringer = mesh(texBox(0.06, 0.24, Math.hypot(run, rise) + 0.2, 1.6), beam, sx, rise / 2, run / 2);
      stringer.rotation.x = -ang;
      fg.add(stringer);
      const rail = mesh(texBox(0.05, 0.05, Math.hypot(run, rise), 1.6), beam, sx, rise / 2 + 0.95, run / 2);
      rail.rotation.x = -ang;
      fg.add(rail);
    }
    g.add(fg);
    // Ramp collider matching the step nosings. It runs 0.8 m past the bottom step
    // (below ground) and 0.3 m past the top so there is no edge for the character
    // controller to catch on, and it is thick so its top surface stays on the nosings.
    const thick = 0.3;
    const extDown = 0.8;
    const extUp = 0.3;
    const len = Math.hypot(run, rise) + extDown + extUp;
    const shift = (extUp - extDown) / 2;
    const ramp = mesh(new THREE.BoxGeometry(1.0, thick, len), planks,
      0,
      rise / 2 + shift * Math.sin(ang) - (thick / 2 - 0.02) * Math.cos(ang),
      run / 2 + shift * Math.cos(ang) + (thick / 2 - 0.02) * Math.sin(ang));
    ramp.rotation.x = -ang;
    fg.add(ramp);
    ramp.visible = false;
    statics.push(ramp);
    for (const sx of [-0.62, 0.62]) {
      const wallC = mesh(new THREE.BoxGeometry(0.08, 1.2, Math.hypot(run, rise)), planks, sx, rise / 2 + 0.6, run / 2);
      wallC.rotation.x = -ang;
      fg.add(wallC);
      wallC.visible = false;
      statics.push(wallC);
    }
  };
  const mid = 4.5;
  flight(3.4, 5.0, 0, 3.4, -1.8, mid);
  const landing = mesh(texBox(1.3, 0.1, 1.5, 1.4), planks, 3.4, mid - 0.05, -2.6);
  g.add(landing);
  statics.push(landing);
  flight(3.0, -3.5, mid, -3.2, -3.5, TOP);
  // Balcony and cab.
  const bal = mesh(texBox(6.8, 0.14, 6.8, 1.6), planks, 0, TOP - 0.07, 0);
  g.add(bal);
  statics.push(bal);
  for (const [rx, rz, ry, len] of [[0, 3.35, 0, 6.8], [0, -3.35, 0, 6.8], [3.35, 0, Math.PI / 2, 6.8], [-3.35, 0, Math.PI / 2, 6.8]] as const) {
    const rail = mesh(texBox(len, 0.06, 0.06, 1.6), beam, rx, TOP + 1.0, rz, ry);
    g.add(rail);
    const wallC = mesh(new THREE.BoxGeometry(len, 1.3, 0.1), beam, rx, TOP + 0.65, rz, ry);
    wallC.visible = false;
    g.add(wallC);
    statics.push(wallC);
    for (let i = -3; i <= 3; i += 1) g.add(mesh(texBox(0.06, 1.0, 0.06, 1.2), beam, rx + (ry ? 0 : i * 1.1), TOP + 0.5, rz + (ry ? i * 1.1 : 0)));
  }
  const cab = 4.2;
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x2c3438, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.35, depthWrite: false });
  for (const [rx, rz, ry] of [[0, cab / 2, 0], [0, -cab / 2, Math.PI], [cab / 2, 0, Math.PI / 2], [-cab / 2, 0, -Math.PI / 2]] as const) {
    const wg = new THREE.Group();
    wg.position.set(rx, TOP, rz);
    wg.rotation.y = ry;
    const openings = ry === Math.PI ? [{ x: 1.2, w: 0.9, y0: 0, y1: 2.0 }] : [];
    for (const p of wallWithOpenings(cab, 1.0, 0.1, openings.map((o) => ({ ...o, y1: 1.0 })), planks, 1.6)) {
      wg.add(p);
      statics.push(p);
    }
    wg.add(mesh(new THREE.PlaneGeometry(cab - 0.2, 1.1), glassMat, 0, 1.6, 0));
    for (let i = -2; i <= 2; i += 1) wg.add(mesh(new THREE.BoxGeometry(0.06, 1.2, 0.08), beam, i * (cab / 4), 1.6, 0));
    wg.add(mesh(texBox(cab, 0.1, 0.12, 1.6), beam, 0, 2.2, 0));
    g.add(wg);
  }
  const roofGeo = new THREE.ConeGeometry(3.6, 1.3, 4, 1);
  roofGeo.rotateY(Math.PI / 4);
  const roofM = mesh(roofGeo, roof, 0, TOP + 2.25 + 0.65, 0);
  g.add(roofM);
  g.add(mesh(texCylinder(0.015, 1.2, 1), new THREE.MeshStandardMaterial({ color: 0x55534d, metalness: 0.9, roughness: 0.4 }), 0, TOP + 3.4, 0));
  const binoculars = await addModel(g, 'binoculars', 1.2, TOP + 1.02, -1.6, 0.6, 0.22);
  const ledge = mesh(texBox(1.2, 0.05, 0.35, 1.2), planks, 1.2, TOP + 0.98, -1.75);
  g.add(ledge);
  void binoculars;
  for (const m of statics) collideBox(ctx.physics, m);
  ctx.anchors.binoculars = local(g, 1.2, TOP + 1.1, -1.6);
  ctx.anchors.towerTop = local(g, 0, TOP + 1.6, 0);
  ctx.anchors.towerBase = local(g, 3.4, 0.5, 5.6);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  mergeStatic(g, []);
  return {
    footprint: (x: number, z: number, y: number) => {
      const q = new THREE.Vector3(x, y, z).applyMatrix4(inv);
      return Math.abs(q.x) < 4.2 && Math.abs(q.z) < 5.6 && q.y > 0.3;
    },
  };
}

// ------------------------------------------------------------------ cabin

async function buildCabin(ctx: Ctx): Promise<Structures['cabin']> {
  const s = SITES.cabin;
  const g = siteGroup(ctx, s.x, s.z, s.heading);
  g.name = 'miller-cabin';
  const [bark, logEnd, roofPlanks, stone, planks] = await Promise.all([
    pbrMaterial('bark_brown_02', { color: '#b3a48f' }),
    pbrMaterial('brown_planks_04', { color: '#9c8a70' }),
    pbrMaterial('brown_planks_04', { color: '#958672' }),
    pbrMaterial('mossy_rock'),
    pbrMaterial('weathered_planks'),
  ]);
  void logEnd;
  const W = 5.0;
  const D = 4.0;
  const R = 0.14;
  const rows = 10;
  const statics: THREE.Mesh[] = [];
  // Stacked log walls with overhanging corners; door and window openings.
  for (let r = 0; r < rows; r += 1) {
    const y = 0.25 + R + r * R * 1.85;
    const alt = r % 2 ? 0.07 : 0;
    // Front (local +Z) wall with door from x -0.5..0.5 for the lower 7 rows.
    const doorRows = 7;
    const winRows = r >= 3 && r <= 6;
    const segs: [number, number][] = r < doorRows ? [[-W / 2 - 0.3, -0.55], [0.55, W / 2 + 0.3]] : [[-W / 2 - 0.3, W / 2 + 0.3]];
    for (const [a, b] of segs) {
      const log = mesh(texCylinder(R, b - a, 1.4, 9, true), bark, (a + b) / 2, y + alt * 0, D / 2);
      log.rotation.z = Math.PI / 2;
      g.add(log);
    }
    const back = mesh(texCylinder(R, W + 0.6, 1.4, 9, true), bark, 0, y, -D / 2);
    back.rotation.z = Math.PI / 2;
    g.add(back);
    // Side walls run along Z; the right side has a window.
    const sideSegs = (x: number, win: boolean) => {
      const parts: [number, number][] = win ? [[-D / 2 - 0.3, -0.4], [0.45, D / 2 + 0.3]] : [[-D / 2 - 0.3, D / 2 + 0.3]];
      for (const [a, b] of parts) {
        const log = mesh(texCylinder(R, b - a, 1.4, 9, true), bark, x, y + R * 0.9, (a + b) / 2);
        log.rotation.x = Math.PI / 2;
        g.add(log);
      }
    };
    sideSegs(-W / 2, false);
    sideSegs(W / 2, winRows);
  }
  const wallH = 0.25 + rows * R * 1.85 + R;
  for (const [x, z, w, d] of [[0, D / 2, W, 0.3], [0, -D / 2, W, 0.3], [-W / 2, 0, 0.3, D], [W / 2, 0, 0.3, D]] as const) {
    const hidden = (m2: THREE.Mesh) => {
      m2.visible = false;
      g.add(m2);
      statics.push(m2);
    };
    if (z === D / 2) {
      hidden(mesh(new THREE.BoxGeometry(W / 2 - 0.55, wallH, d), bark, -W / 4 - 0.27, wallH / 2, z));
      hidden(mesh(new THREE.BoxGeometry(W / 2 - 0.55, wallH, d), bark, W / 4 + 0.27, wallH / 2, z));
    } else hidden(mesh(new THREE.BoxGeometry(w, wallH, d), bark, x, wallH / 2, z));
  }
  // Barricaded plank door.
  const doorMesh = mesh(texBox(1.1, 2.0, 0.06, 1.2), planks, 0, 1.25, D / 2 + 0.02);
  g.add(doorMesh);
  const doorCol = mesh(new THREE.BoxGeometry(1.1, 2.0, 0.2), planks, 0, 1.25, D / 2);
  doorCol.visible = false;
  g.add(doorCol);
  statics.push(doorCol);
  for (const yb of [0.7, 1.75]) g.add(mesh(texBox(1.25, 0.1, 0.05, 1.2), planks, 0, yb, D / 2 + 0.06));
  // Window with warm lantern glow.
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: new THREE.Color(1, 0.62, 0.3), emissiveIntensity: 0.6, roughness: 0.4 });
  const win = mesh(new THREE.PlaneGeometry(0.8, 0.62), glowMat, W / 2 + 0.02, 1.38, 0.02);
  win.rotation.y = Math.PI / 2;
  g.add(win);
  const glow = new THREE.PointLight(0xffa860, 1.3, 3.4, 1.8);
  glow.position.set(W / 2 - 0.5, 1.35, 0.05);
  glow.visible = false;
  g.add(glow);
  // Roof.
  const rise = 1.3;
  const run = D / 2 + 0.55;
  const ang = Math.atan2(rise, run);
  for (const side of [1, -1]) {
    const roofM = mesh(texBox(W + 1.0, 0.07, Math.hypot(rise, run) + 0.1, 1.4, true), roofPlanks, 0, wallH + rise / 2, (side * run) / 2);
    roofM.rotation.x = side * ang;
    g.add(roofM);
  }
  // Gable logs.
  for (const side of [1, -1]) {
    for (let r = 0; r < 4; r += 1) {
      const w = D * (1 - r / 4.2);
      const log = mesh(texCylinder(R, w, 1.4, 8, true), bark, side * (W / 2), wallH + R + r * R * 1.85, 0);
      log.rotation.x = Math.PI / 2;
      g.add(log);
    }
  }
  // Stone chimney with smoke.
  const chim = mesh(texBox(0.9, wallH + rise + 1.0, 0.9, 1.2), stone, -W / 2 - 0.45, (wallH + rise + 1.0) / 2, -0.6);
  g.add(chim);
  statics.push(chim);
  const smokeTop = local(g, -W / 2 - 0.45, wallH + rise + 1.1, -0.6);
  // Porch and woodpile.
  const porch = mesh(texBox(W, 0.12, 1.6, 1.6, true), planks, 0, 0.18, D / 2 + 0.85);
  g.add(porch);
  statics.push(porch);
  for (let i = 0; i < 18; i += 1) {
    const row = Math.floor(i / 6);
    const log = mesh(texCylinder(0.1, 0.55, 0.6, 7, true), bark, W / 2 + 0.5, 0.12 + row * 0.19, -1.2 + (i % 6) * 0.21);
    log.rotation.z = Math.PI / 2;
    g.add(log);
  }
  const pileCol = mesh(new THREE.BoxGeometry(0.6, 0.6, 1.3), bark, W / 2 + 0.5, 0.3, -0.7);
  pileCol.visible = false;
  g.add(pileCol);
  statics.push(pileCol);
  await addModel(g, 'wooden_axe_02', W / 2 + 0.2, 0.25, 1.2, 0.5, 0.75).catch(() => null);
  const porchChair = await addModel(g, 'painted_wooden_chair_01', -1.6, 0.24, D / 2 + 0.8, 0.4).catch(() => null);
  // Weather the white paint so the chair sits in the scene.
  porchChair?.traverse((o) => {
    const mm = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mm && mm.color && !mm.userData.aged) {
      mm.color.multiplyScalar(0.55);
      mm.userData.aged = true;
    }
  });
  for (const m of statics) collideBox(ctx.physics, m);
  ctx.anchors.cabinDoor = local(g, 0, 1.3, D / 2 + 0.5);
  ctx.anchors.cabin = local(g, 0, 1, 0);
  mergeStatic(g, [win]);
  // Smoke particles drifting from the chimney.
  const N = 90;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const life = new Float32Array(N);
  for (let i = 0; i < N; i += 1) life[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const smokeTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const x = c.getContext('2d')!;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(200,200,195,0.55)');
    gr.addColorStop(1, 'rgba(200,200,195,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    return t;
  })();
  const smoke = new THREE.Points(geo, new THREE.PointsMaterial({ map: smokeTex, size: 2.6, transparent: true, depthWrite: false, opacity: 0.5, color: 0xb8b6ae, sizeAttenuation: true }));
  smoke.frustumCulled = false;
  ctx.root.add(smoke);
  cabinSmoke = { geo, life, top: smokeTop };
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  return {
    glow,
    smoke,
    footprint: (x: number, z: number) => {
      const q = new THREE.Vector3(x, 0, z).applyMatrix4(inv);
      return Math.abs(q.x) < W / 2 + 0.2 && q.z > -D / 2 && q.z < D / 2 + 1.7;
    },
  };
}

let cabinSmoke: { geo: THREE.BufferGeometry; life: Float32Array; top: THREE.Vector3 } | null = null;

function updateSmoke(dt: number, time: number): void {
  if (!cabinSmoke) return;
  const { geo, life, top } = cabinSmoke;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < life.length; i += 1) {
    life[i] += dt * 0.055;
    if (life[i] > 1) life[i] -= 1;
    const t = life[i];
    const sway = Math.sin(time * 0.3 + i) * t * 2.5;
    pos.setXYZ(i, top.x + t * 7 + sway * 0.6 + Math.sin(i * 1.7) * t * 1.5, top.y + t * 14 + Math.sin(i) * 0.3, top.z + t * 3 + Math.cos(i * 2.3) * t * 1.5);
  }
  pos.needsUpdate = true;
}

// ------------------------------------------------------------------ vehicles

async function buildVehicles(ctx: Ctx): Promise<void> {
  // Abandoned SUV in the ditch: flat front tyre, driver door open.
  {
    const s = SITES.suv;
    const parts = buildVehicle(CIVILIAN_SUV, { seed: 33, openDoor: true, flatTire: 1 });
    const g = parts.root;
    const y = ground(ctx, s.x, s.z) + 0.15;
    g.position.set(s.x, y, s.z);
    g.rotation.set(0.03, s.heading, -0.07, 'YXZ');
    ctx.root.add(g);
    // Green paint transferred onto the front bumper from Unit 4.
    const scrape = mesh(new THREE.PlaneGeometry(0.42, 0.14), new THREE.MeshStandardMaterial({ color: 0x4d5c45, roughness: 0.7 }), -0.62, 0.42, 2.38);
    g.add(scrape);
    ctx.physics.tag(ctx.physics.addBox(worldBox(g, 0, 0.95, 0, 0.92, 0.65, 2.25)), 'metal');
    ctx.anchors.suvDoor = local(g, 1.35, 1.1, 0.4);
    ctx.anchors.suvRear = local(g, 0, 1.0, -2.6);
    ctx.anchors.suvBumper = local(g, -0.55, 0.6, 2.6);
    ctx.anchors.suvTire = local(g, -1.1, 0.4, 1.38);
    const light = await placeModel('portable_searchlight', { size: 0.42 });
    const lp = local(g, 1.6, 0, -0.4);
    light.position.set(lp.x, ground(ctx, lp.x, lp.z), lp.z);
    light.rotation.set(0, 1.3, 1.45);
    ctx.root.add(light);
  }
  // Unit 4 on its side below the bend, against a tree.
  {
    const s = SITES.wreck;
    const style = { ...FOREST_WAGON, unit: '4', mud: 0.9, rust: 0.3 };
    const parts = buildVehicle(style, { seed: 44, damaged: true, lightBar: true });
    const g = parts.root;
    const y = ground(ctx, s.x, s.z) + 0.92;
    g.position.set(s.x, y, s.z);
    g.rotation.set(0.12, s.heading, Math.PI / 2 - 0.08, 'YXZ');
    ctx.root.add(g);
    const scrape = mesh(new THREE.PlaneGeometry(0.7, 0.22), new THREE.MeshStandardMaterial({ color: 0x6b2a2e, roughness: 0.7 }), 0.94, 0.75, 0.3);
    scrape.rotation.y = Math.PI / 2;
    g.add(scrape);
    ctx.physics.tag(ctx.physics.addBox(worldBox(g, 0, 1.0, 0, 0.95, 0.9, 2.3)), 'metal');
    ctx.anchors.wreck = local(g, 0.9, 1.0, 0.2);
    ctx.anchors.wreckRadio = local(g, 0.2, 1.3, 0.6);
    // Debris trail up the slope to the bend.
    const bend = SITES.wreckBend;
    const rng = mulberry32(14);
    const shardMat = new THREE.MeshStandardMaterial({ color: 0x9fb3b5, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.7 });
    for (let i = 0; i < 26; i += 1) {
      const t = rng();
      const x = s.x + (bend.x - s.x) * t + range(rng, -1.5, 1.5);
      const z = s.z + (bend.z - s.z) * t + range(rng, -1.5, 1.5);
      const shard = mesh(new THREE.PlaneGeometry(range(rng, 0.05, 0.14), range(rng, 0.04, 0.1)), shardMat, x, ground(ctx, x, z) + 0.02, z);
      shard.rotation.set(-Math.PI / 2 + range(rng, -0.3, 0.3), 0, rng() * 6);
      ctx.root.add(shard);
    }
    // Snapped marker posts at the edge of the road.
    const planks = await pbrMaterial('weathered_planks');
    for (const [dx, dz, lean] of [[1.5, 3.2, 1.2], [-1.2, 4.0, 0.9]] as const) {
      const x = bend.x - 5 + dx;
      const z = bend.z + 6 + dz;
      const p = mesh(texBox(0.12, 0.9, 0.12, 1), planks, x, ground(ctx, x, z) + 0.2, z);
      p.rotation.set(lean, 0.3, 0.2);
      ctx.root.add(p);
    }
    ctx.anchors.wreckBend = new THREE.Vector3(bend.x - 4, ground(ctx, bend.x - 4, bend.z + 9) + 1, bend.z + 9);
  }
}

// ------------------------------------------------------------------ camp, tape trail

async function buildCamp(ctx: Ctx): Promise<Record<string, THREE.Object3D>> {
  const s = SITES.camp;
  const g = siteGroup(ctx, s.x, s.z, 0.6);
  g.name = 'camp';
  const pickups: Record<string, THREE.Object3D> = {};
  await addModel(g, 'stone_fire_pit', 0, 0, 0, 0, 1.1);
  const bark = await pbrMaterial('bark_brown_02', { color: '#8b7f70' });
  for (const [x, z, r] of [[1.6, 0.4, 0.4], [-1.4, 0.9, 1.9]] as const) {
    const log = mesh(texCylinder(0.17, 1.8, 1.4, 9, true), bark, x, 0.17, z, r);
    log.rotation.z = Math.PI / 2;
    g.add(log);
  }
  await addModel(g, 'ammo_box', 1.6, 0.34, 0.6, 0.4, 0.32);
  pickups.boltCutters = await addModel(g, 'bolt_cutters_01', -1.3, 0.34, 0.8, 1.2, 0.62);
  await addModel(g, 'trashbag', 2.2, 0, -1.2, 0.3, 0.6);
  for (let i = 0; i < 3; i += 1) await addModel(g, 'can_rusted', -0.6 + i * 0.45, 0, 1.6 + (i % 2) * 0.3, i, 0.13);
  // Tarp shelter between two poles.
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.9 });
  for (const x of [-2.2, 2.2]) g.add(mesh(texCylinder(0.04, 1.9, 1), poleMat, x, 0.95, -2.5));
  const tarpGeo = new THREE.PlaneGeometry(4.8, 3.0, 12, 8);
  const tp = tarpGeo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i += 1) {
    const x = tp.getX(i);
    const y = tp.getY(i);
    tp.setZ(i, -0.25 * Math.cos((x / 4.8) * Math.PI) * Math.cos((y / 3) * Math.PI * 0.5) - 0.1 * Math.sin(x * 2));
  }
  tarpGeo.computeVertexNormals();
  const tarp = mesh(tarpGeo, new THREE.MeshStandardMaterial({ color: 0x3f4e45, roughness: 0.85, side: THREE.DoubleSide }), 0, 1.25, -1.4);
  tarp.rotation.x = -1.05;
  g.add(tarp);
  ctx.anchors.campFire = local(g, 0, 0.5, 0);
  ctx.anchors.boltCutters = local(g, -1.3, 0.5, 0.8);
  ctx.anchors.ammoBox = local(g, 1.6, 0.5, 0.6);
  const fireCol = mesh(new THREE.BoxGeometry(1.3, 0.5, 1.3), bark, 0, 0.25, 0);
  fireCol.visible = false;
  g.add(fireCol);
  collideBox(ctx.physics, fireCol);
  return pickups;
}

async function buildTapeTrail(ctx: Ctx): Promise<THREE.Object3D> {
  const path = new Path(TAPE_TRAIL, 0.5);
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: new THREE.Color(0.6, 0.15, 0.02), emissiveIntensity: 0.35, roughness: 0.6, side: THREE.DoubleSide });
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x5b4a39, roughness: 0.95 });
  const group = new THREE.Group();
  group.name = 'flagging-tape';
  const rng = mulberry32(5);
  let k = 0;
  for (let s = 2; s < path.length - 1; s += 8.5) {
    const p = path.at(s);
    const side = k % 2 ? 1 : -1;
    const x = p.x - p.tz * side * 1.3;
    const z = p.z + p.tx * side * 1.3;
    const y = ground(ctx, x, z);
    group.add(mesh(texCylinder(0.02, 1.6, 1, 5), stickMat, x, y + 0.8, z));
    const ribbon = mesh(new THREE.PlaneGeometry(0.05, 0.42), tapeMat, x, y + 1.35, z);
    ribbon.rotation.set(range(rng, -0.3, 0.3), rng() * 6, range(rng, -0.2, 0.2));
    ribbon.name = 'tape-ribbon';
    group.add(ribbon);
    k += 1;
  }
  ctx.root.add(group);
  const fl = path.at(path.length * 0.55);
  const torch = await placeModel('signal_flashlight', { size: 0.28 });
  torch.position.set(fl.x + 0.6, ground(ctx, fl.x + 0.6, fl.z) + 0.02, fl.z);
  torch.rotation.set(0, 0.8, Math.PI / 2);
  ctx.root.add(torch);
  ctx.anchors.flashlight = new THREE.Vector3(fl.x + 0.6, ground(ctx, fl.x + 0.6, fl.z) + 0.2, fl.z);
  ctx.anchors.firstTape = new THREE.Vector3(path.at(2).x, ground(ctx, path.at(2).x, path.at(2).z) + 1.2, path.at(2).z);
  return group;
}

// ------------------------------------------------------------------ entry

export async function buildStructures(terrain: TerrainData, physics: PhysicsWorld): Promise<Structures> {
  const root = new THREE.Group();
  root.name = 'structures';
  const ctx: Ctx = { terrain, physics, root, anchors: {} };
  const station = await buildStation(ctx);
  await buildSigns(ctx);
  const bridgeFootprint = await buildBridge(ctx);
  const gate = await buildGate(ctx);
  const tower = await buildTower(ctx);
  const cabin = await buildCabin(ctx);
  await buildVehicles(ctx);
  const campPickups = await buildCamp(ctx);
  const tape = await buildTapeTrail(ctx);
  const pickups: Record<string, THREE.Object3D> = { ...campPickups, tape };
  if (stationKey) pickups.gateKey = stationKey;
  if (stationMap) pickups.wallMap = stationMap;
  return { group: root, anchors: ctx.anchors, station, gate, cabin, tower, pickups, bridgeFootprint, updateSmoke };
}
