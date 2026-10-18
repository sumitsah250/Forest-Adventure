// Locations added for the eight missions, built into the existing valley:
//  - district training range east of the trailhead (Mission 1)
//  - gun locker inside the ranger station (Mission 2)
//  - Hale's revolver beside the Unit 4 wreck (Mission 3)
//  - the poachers' roadblock on Ridge Road (Mission 4)
//  - the hidden supply cache off the ATV trail (Mission 5)
//  - the felled-tree blockade at the ford (Mission 6)
//  - the poachers' base camp in the eastern forest (Mission 7)
//  - the buyer's meeting at the trailhead (Mission 8)
//  - the lookout's hunting rifle (optional exploration)
// Returns anchors, movable parts and cover points the missions use.

import * as THREE from 'three';
import type { TerrainData } from './terrain.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { SITES } from './layout.ts';
import { collideBox, mesh, pbrMaterial, signTexture, texBox, texCylinder } from './build.ts';
import { placeModel } from '../render/models.ts';
import { mergeStatic } from '../render/merge.ts';
import { CIVILIAN_SUV, buildVehicle } from '../vehicles/vehicleModel.ts';
import { buildWeaponModel } from '../weapons/models.ts';
import type { WeaponId } from '../weapons/defs.ts';
import { mulberry32, range } from './rng.ts';
import type { Structures } from './structures.ts';

export interface SteelPlate {
  pivot: THREE.Object3D;
  plate: THREE.Mesh;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  radius: number;
}

export interface PaperTarget {
  board: THREE.Mesh;
  center: THREE.Vector3;
  normal: THREE.Vector3;
  halfW: number;
  halfH: number;
  /** Bullet holes are drawn into this canvas. */
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
}

export interface MissionSites {
  group: THREE.Group;
  anchors: Record<string, THREE.Vector3>;
  plates: SteelPlate[];
  papers: PaperTarget[];
  /** Hinged/movable parts animated by missions. */
  parts: {
    lockboxLid: THREE.Object3D;
    lockerDoor: THREE.Object3D;
    hatch: THREE.Object3D;
    branches: THREE.Object3D;
    chain: THREE.Object3D;
    felledLog: THREE.Object3D;
  };
  /** Display models of weapons waiting to be picked up, by pickup id. */
  displays: Record<string, { object: THREE.Object3D; weapon: WeaponId }>;
  /** Colliders that missions can switch off (hatch cover, log). */
  colliders: { log: ReturnType<PhysicsWorld['addBox']>[] };
  /** Cover points for each encounter, as [x, z] pairs. */
  cover: Record<string, [number, number][]>;
  vehicles: Record<string, THREE.Object3D>;
}

interface Ctx {
  terrain: TerrainData;
  physics: PhysicsWorld;
  root: THREE.Group;
}

const ground = (ctx: Ctx, x: number, z: number) => ctx.terrain.heightAt(x, z);

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

async function addModel(parent: THREE.Object3D, slug: string, x: number, y: number, z: number, ry = 0, size?: number): Promise<THREE.Group> {
  const m = await placeModel(slug, size ? { size } : {});
  m.position.set(x, y, z);
  m.rotation.y = ry;
  parent.add(m);
  return m;
}

/** A display copy of a weapon (lying or standing) used as a pickup. */
function weaponDisplay(parent: THREE.Object3D, id: WeaponId, x: number, y: number, z: number, rot: THREE.Euler): THREE.Object3D {
  const m = buildWeaponModel(id);
  m.root.position.set(x, y, z);
  m.root.rotation.copy(rot);
  parent.add(m.root);
  return m.root;
}

/** Static box collider in a group's local frame. */
function boxCollider(ctx: Ctx, g: THREE.Object3D, x: number, y: number, z: number, w: number, h: number, d: number, surface = 'wood'): ReturnType<PhysicsWorld['addBox']> {
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d));
  proxy.position.set(x, y, z);
  proxy.visible = false;
  g.add(proxy);
  const c = collideBox(ctx.physics, proxy);
  ctx.physics.tag(c, surface);
  proxy.removeFromParent();
  return c;
}

function paperTargetTexture(): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 420;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#d9cfb3';
  ctx.fillRect(0, 0, 256, 420);
  // Silhouette with scoring rings, printed in dark ink.
  ctx.fillStyle = '#2b2a26';
  ctx.beginPath();
  ctx.ellipse(128, 78, 42, 50, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(40, 420);
  ctx.lineTo(48, 200);
  ctx.quadraticCurveTo(60, 140, 128, 132);
  ctx.quadraticCurveTo(196, 140, 208, 200);
  ctx.lineTo(216, 420);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#d9cfb3';
  ctx.lineWidth = 3;
  for (const r of [26, 52, 80]) {
    ctx.beginPath();
    ctx.ellipse(128, 262, r, r * 1.25, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(128, 80, 18, 22, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#8a2a1c';
  ctx.font = '600 18px Arial';
  ctx.fillText('HCRD QUAL', 82, 410);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

/** Spray-painted mark on a trunk or a sign (orange X, arrows). */
function paintDecal(text: string, color: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 14;
  ctx.globalAlpha = 0.9;
  if (text === 'X') {
    ctx.beginPath();
    ctx.moveTo(26, 22);
    ctx.lineTo(102, 106);
    ctx.moveTo(100, 20);
    ctx.lineTo(28, 104);
    ctx.stroke();
  } else {
    ctx.font = '700 64px Arial';
    ctx.fillStyle = color;
    ctx.fillText(text, 20, 90);
  }
  // Overspray speckle.
  for (let i = 0; i < 260; i += 1) {
    ctx.globalAlpha = Math.random() * 0.4;
    ctx.fillStyle = color;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function decalMaterial(map: THREE.Texture, opacity = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.9 });
}

/** Oval boot prints / drag marks on the ground. */
function groundMark(ctx: Ctx, x: number, z: number, w: number, l: number, rot: number, dark = 0.35): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g2 = c.getContext('2d')!;
  const grad = g2.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, `rgba(30,22,14,${dark})`);
  grad.addColorStop(1, 'rgba(30,22,14,0)');
  g2.fillStyle = grad;
  g2.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), decalMaterial(tex));
  m.rotation.set(-Math.PI / 2, 0, rot);
  m.position.set(x, ground(ctx, x, z) + 0.03, z);
  m.renderOrder = 2;
  ctx.root.add(m);
  return m;
}

// ------------------------------------------------------------------ range

async function buildRange(ctx: Ctx, out: MissionSites): Promise<void> {
  const [planks, beams, rusty] = await Promise.all([
    pbrMaterial('weathered_planks'),
    pbrMaterial('beam_wall_01', { color: '#8a7a66' }),
    pbrMaterial('rusty_metal_02', { metalness: 0.5 }),
  ]);
  const L = SITES.rangeLine;
  // Firing line, facing east (+X) down the range.
  const g = siteGroup(ctx, L.x, L.z, Math.PI / 2);
  g.name = 'training-range';
  // Shooting bench with a plank top.
  g.add(mesh(texBox(2.2, 0.08, 0.7, 1.4, true), planks, 0, 0.92, 0.0));
  for (const [x, z] of [[-1, -0.28], [1, -0.28], [-1, 0.28], [1, 0.28]] as const) g.add(mesh(texBox(0.09, 0.9, 0.09, 1), planks, x, 0.45, z));
  boxCollider(ctx, g, 0, 0.5, 0, 2.2, 1.0, 0.7);
  // Steel range lockbox with a hinged lid.
  const lockMat = new THREE.MeshStandardMaterial({ color: '#3f463d', metalness: 0.55, roughness: 0.55 });
  g.add(mesh(new THREE.BoxGeometry(0.56, 0.2, 0.34), lockMat, 0.6, 1.06, -0.05));
  const lid = new THREE.Group();
  lid.position.set(0.6, 1.16, -0.22);
  const lidMesh = mesh(new THREE.BoxGeometry(0.58, 0.04, 0.36), lockMat, 0, 0.02, 0.17);
  lid.add(lidMesh, mesh(new THREE.BoxGeometry(0.05, 0.05, 0.03), rusty, 0, -0.02, 0.36));
  g.add(lid);
  out.parts.lockboxLid = lid;
  out.anchors.lockbox = local(g, 0.6, 1.1, -0.05);
  // The service pistol and a box of 9 mm inside the lockbox.
  out.displays.rangeP9 = { object: weaponDisplay(g, 'p9', 0.55, 1.105, -0.05, new THREE.Euler(0, Math.PI / 2, Math.PI / 2)), weapon: 'p9' };
  await addModel(g, 'ammo_box', -0.55, 0.96, 0.05, 0.3, 0.32);
  await addModel(g, 'painted_wooden_chair_01', -0.4, 0, -0.75, Math.PI);
  // Range sign at the end of the trail.
  const signMat = new THREE.MeshStandardMaterial({
    map: signTexture([
      { text: 'HOLLOW CREEK RANGER DISTRICT', size: 34, color: '#e8e2cf' },
      { text: 'TRAINING RANGE', size: 56, weight: 700, color: '#f0d27a', gap: 10 },
      { text: 'Authorized personnel only', size: 28 },
      { text: 'Cease fire when anyone is downrange', size: 28 },
    ], { w: 760, h: 380, bg: '#3e4d37', border: '#d9d1b5', weathered: true }),
    roughness: 0.85,
  });
  const sign = siteGroup(ctx, L.x - 4, L.z + 4.5, -Math.PI / 2 - 0.4);
  sign.add(mesh(new THREE.PlaneGeometry(1.5, 0.75), signMat, 0, 1.5, 0.04));
  sign.add(mesh(texBox(1.6, 0.85, 0.05, 1), planks, 0, 1.5, 0));
  for (const x of [-0.65, 0.65]) sign.add(mesh(texBox(0.1, 1.9, 0.1, 1), planks, x, 0.95, -0.06));
  // Steel plates hanging on chains from crossbars: they swing when hit.
  const plateMat = new THREE.MeshStandardMaterial({ color: '#d8d6cc', metalness: 0.35, roughness: 0.55 });
  const platePos: [number, number][] = [[97, 219.5], [101.5, 223], [105.5, 219.8]];
  for (const [x, z] of platePos) {
    const pg = siteGroup(ctx, x, z, -Math.PI / 2);
    for (const px of [-0.45, 0.45]) pg.add(mesh(texBox(0.08, 1.6, 0.08, 1), planks, px, 0.8, 0));
    pg.add(mesh(texBox(1.0, 0.08, 0.08, 1, true), planks, 0, 1.6, 0));
    const pivot = new THREE.Group();
    pivot.position.set(0, 1.58, 0);
    pg.add(pivot);
    pivot.add(mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 4), rusty, 0, -0.13, 0));
    const plate = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.012, 24), plateMat, 0, -0.42, 0);
    plate.rotation.x = Math.PI / 2;
    pivot.add(plate);
    pg.updateMatrixWorld(true);
    const center = plate.getWorldPosition(new THREE.Vector3());
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(pg.quaternion);
    out.plates.push({ pivot, plate, center, normal, radius: 0.17 });
  }
  // Paper silhouettes on wooden frames.
  const paperPos: [number, number][] = [[99, 225.5], [108, 224.5]];
  for (const [x, z] of paperPos) {
    const fg = siteGroup(ctx, x, z, -Math.PI / 2);
    for (const px of [-0.32, 0.32]) fg.add(mesh(texBox(0.06, 1.9, 0.06, 1), planks, px, 0.95, -0.02));
    const { canvas, texture } = paperTargetTexture();
    const board = mesh(new THREE.PlaneGeometry(0.56, 0.92), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95 }), 0, 1.3, 0.02);
    fg.add(board);
    fg.updateMatrixWorld(true);
    out.papers.push({
      board, canvas, texture, halfW: 0.28, halfH: 0.46,
      center: board.getWorldPosition(new THREE.Vector3()),
      normal: new THREE.Vector3(0, 0, 1).applyQuaternion(fg.quaternion),
    });
  }
  // Timber backstop behind the targets.
  const back = siteGroup(ctx, 112, 222, -Math.PI / 2);
  for (let i = 0; i < 7; i += 1) back.add(mesh(texBox(16, 0.36, 0.36, 2, true), beams, 0, 0.18 + i * 0.4, 0));
  for (const x of [-7.5, -2.5, 2.5, 7.5]) back.add(mesh(texBox(0.3, 3.2, 0.3, 1), beams, x, 1.5, 0.35));
  boxCollider(ctx, back, 0, 1.4, 0, 16, 2.9, 0.4);
  out.anchors.rangeLine = local(g, 0, 0, -1.2);
  out.anchors.rangeCenter = new THREE.Vector3(SITES.range.x, ground(ctx, SITES.range.x, SITES.range.z), SITES.range.z);
}

// ------------------------------------------------------------------ station locker

function buildLocker(ctx: Ctx, out: MissionSites, structures: Structures): void {
  const station = structures.group.getObjectByName('ranger-station')!;
  station.updateMatrixWorld(true);
  const FL = 0.45;
  const W = 9;
  const steel = new THREE.MeshStandardMaterial({ color: '#4b5446', metalness: 0.45, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#16180f', roughness: 0.8 });
  // Against the inside of the left wall, near the front corner, facing the room.
  const g = new THREE.Group();
  g.position.set(-W / 2 + 0.33, FL, 2.25);
  g.rotation.y = Math.PI / 2;
  station.add(g);
  const Wd = 0.82;
  const H = 1.78;
  const Dp = 0.42;
  g.add(mesh(new THREE.BoxGeometry(Wd, H, 0.02), steel, 0, H / 2, -Dp / 2));
  g.add(mesh(new THREE.BoxGeometry(0.02, H, Dp), steel, -Wd / 2, H / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(0.02, H, Dp), steel, Wd / 2, H / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(Wd, 0.02, Dp), steel, 0, H, 0));
  g.add(mesh(new THREE.BoxGeometry(Wd, 0.06, Dp), steel, 0, 0.03, 0));
  g.add(mesh(new THREE.BoxGeometry(Wd - 0.04, H - 0.06, 0.01), dark, 0, H / 2, -Dp / 2 + 0.02));
  g.add(mesh(new THREE.BoxGeometry(Wd - 0.04, 0.02, Dp - 0.04), steel, 0, 1.38, 0));
  // Door hinged on the left edge, with a combination dial and handle.
  const door = new THREE.Group();
  door.position.set(-Wd / 2, 0, Dp / 2);
  const leaf = mesh(new THREE.BoxGeometry(Wd, H - 0.04, 0.025), steel, Wd / 2, H / 2, 0);
  door.add(leaf);
  door.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#b9b4a2', metalness: 0.8, roughness: 0.3 }), Wd - 0.14, 1.05, 0.02));
  door.add(mesh(new THREE.BoxGeometry(0.03, 0.14, 0.03), dark, Wd - 0.12, 0.88, 0.025));
  // Stencilled label.
  const label = new THREE.MeshStandardMaterial({ map: signTexture([{ text: 'FIREARMS', size: 54, weight: 700, color: '#d7d2c0' }, { text: 'Keep locked', size: 30, color: '#d7d2c0' }], { w: 320, h: 160, bg: '#4b5446' }), roughness: 0.7 });
  door.add(mesh(new THREE.PlaneGeometry(0.36, 0.18), label, Wd / 2, 1.42, 0.014));
  g.add(door);
  out.parts.lockerDoor = door;
  // Shotgun standing in the rack, a box of shells on the shelf.
  out.displays.lockerShotgun = { object: weaponDisplay(g, 'ranger12', 0.05, 0.62, -0.06, new THREE.Euler(-Math.PI / 2 + 0.06, 0, 0)), weapon: 'ranger12' };
  void addModel(g, 'ammo_box', 0.18, 1.4, -0.05, 0.4, 0.26);
  out.anchors.locker = local(g, 0, 1.1, Dp / 2 + 0.1);
  // Collider for the cabinet body.
  boxCollider(ctx, g, 0, H / 2, 0, Wd, H, Dp, 'metal');
}

// ------------------------------------------------------------------ wreck revolver

function buildWreckRevolver(out: MissionSites, structures: Structures, ctx: Ctx): void {
  const w = structures.anchors.wreck;
  if (!w) return;
  const x = w.x + 1.1;
  const z = w.z + 0.9;
  const y = ground(ctx, x, z) + 0.02;
  out.displays.wreckRevolver = { object: weaponDisplay(ctx.root, 'bridger', x, y, z, new THREE.Euler(Math.PI / 2, 0, 0.7)), weapon: 'bridger' };
  out.anchors.wreckRevolver = new THREE.Vector3(x, y + 0.1, z);
}

// ------------------------------------------------------------------ roadblock (M4)

async function buildRoadblock(ctx: Ctx, out: MissionSites): Promise<void> {
  const s = SITES.roadblock;
  const road = ctx.terrain.roads[0];
  const n = road.nearest(s.x, s.z);
  const heading = road.headingAt(n.s);
  // Dark SUV parked across the road, nose into the ditch.
  const truck = buildVehicle({ ...CIVILIAN_SUV, paint: '#3b3e3a' }, { seed: 71 });
  truck.root.position.set(s.x, ground(ctx, s.x, s.z) + 0.12, s.z);
  truck.root.rotation.set(0.02, heading + Math.PI / 2 + 0.25, 0.03, 'YXZ');
  ctx.root.add(truck.root);
  out.vehicles.roadblock = truck.root;
  boxCollider(ctx, truck.root, 0, 0.95, 0, 1.84, 1.3, 4.5, 'metal');
  const g = siteGroup(ctx, s.x, s.z, heading);
  // Cut logs dragged across the rest of the road.
  const bark = await pbrMaterial('pine_bark');
  for (const [x, z, len, rot] of [[3.2, 2.5, 5.5, 0.15], [3.6, 3.1, 4.6, -0.1]] as const) {
    const log = mesh(texCylinder(0.26, len, 1.2, 10, true), bark, x, 0.26, z);
    log.rotation.set(0, rot, Math.PI / 2);
    g.add(log);
  }
  boxCollider(ctx, g, 3.4, 0.3, 2.8, 5.2, 0.6, 1.0);
  await addModel(g, 'barrel_03', -3.4, 0, -2.2, 0.4, 0.9);
  await addModel(g, 'wooden_crate_02', -3.2, 0, 2.2, 0.3, 0.7);
  await addModel(g, 'wooden_crate_02', -3.9, 0, 3.0, 1.1, 0.6);
  await addModel(g, 'portable_searchlight', -3.2, 0.7, 2.2, -0.6, 0.45);
  boxCollider(ctx, g, -3.4, 0.45, -2.2, 0.6, 0.9, 0.6, 'metal');
  boxCollider(ctx, g, -3.5, 0.35, 2.6, 1.2, 0.7, 1.4);
  out.anchors.roadblockTruck = local(truck.root, -1.2, 1.0, 0.2);
  out.anchors.roadblock = new THREE.Vector3(s.x, ground(ctx, s.x, s.z), s.z);
  // Cover: behind the truck, the logs, crates and nearby trunks (filled at spawn too).
  out.cover.roadblock = [
    [s.x + Math.sin(heading) * -2.5, s.z + Math.cos(heading) * -2.5],
    [local(g, 3.4, 0, 4.0).x, local(g, 3.4, 0, 4.0).z],
    [local(g, -3.4, 0, 3.8).x, local(g, -3.4, 0, 3.8).z],
    [local(g, -4.6, 0, -2.2).x, local(g, -4.6, 0, -2.2).z],
    [local(g, 1.5, 0, -4.5).x, local(g, 1.5, 0, -4.5).z],
  ];
}

// ------------------------------------------------------------------ cache (M5)

async function buildCache(ctx: Ctx, out: MissionSites): Promise<void> {
  const s = SITES.cache;
  const y0 = ground(ctx, s.x, s.z);
  const g = siteGroup(ctx, s.x, s.z, 0.35, y0);
  g.name = 'supply-cache';
  const [planks, bark, rusty] = await Promise.all([pbrMaterial('old_planks_02', { color: '#9b8d78' }), pbrMaterial('pine_bark'), pbrMaterial('rusty_metal_02', { metalness: 0.6 })]);
  // Plank frame set into the ground and a hinged trapdoor.
  for (const [x, z, w, d] of [[0, -0.6, 1.5, 0.12], [0, 0.6, 1.5, 0.12], [-0.72, 0, 0.12, 1.3], [0.72, 0, 0.12, 1.3]] as const) g.add(mesh(texBox(w, 0.12, d, 1), planks, x, 0.0, z));
  const pit = mesh(new THREE.BoxGeometry(1.32, 0.02, 1.08), new THREE.MeshStandardMaterial({ color: '#0d0b08', roughness: 1 }), 0, -0.55, 0);
  g.add(pit);
  for (const [x, z] of [[-0.66, 0], [0.66, 0]] as const) g.add(mesh(new THREE.BoxGeometry(0.02, 0.56, 1.1), new THREE.MeshStandardMaterial({ color: '#2a2016', roughness: 1 }), x, -0.28, z));
  const hatch = new THREE.Group();
  hatch.position.set(0, 0.06, -0.55);
  for (let i = 0; i < 5; i += 1) hatch.add(mesh(texBox(1.32, 0.05, 0.215, 1), planks, 0, 0.0, 0.11 + i * 0.218));
  hatch.add(mesh(texBox(1.2, 0.05, 0.09, 1, true), planks, 0, 0.05, 0.3));
  hatch.add(mesh(texBox(1.2, 0.05, 0.09, 1, true), planks, 0, 0.05, 0.85));
  hatch.add(mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12), rusty, 0, 0.05, 1.0));
  g.add(hatch);
  out.parts.hatch = hatch;
  // Chain and padlock through the ring and a stake.
  const chain = new THREE.Group();
  for (let i = 0; i < 9; i += 1) {
    const link = mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 10), rusty, -0.05 + i * 0.045, 0.1, 0.48 + Math.sin(i) * 0.01);
    link.rotation.set(Math.PI / 2, 0, i % 2 ? Math.PI / 2 : 0);
    chain.add(link);
  }
  chain.add(mesh(new THREE.BoxGeometry(0.06, 0.07, 0.025), new THREE.MeshStandardMaterial({ color: '#b39553', metalness: 0.8, roughness: 0.35 }), 0.38, 0.06, 0.48));
  chain.add(mesh(texCylinder(0.035, 0.45, 0.5, 6), planks, 0.45, 0.1, 0.48));
  g.add(chain);
  out.parts.chain = chain;
  // Cut branches piled over the hatch to hide it.
  const branches = new THREE.Group();
  const rng = mulberry32(919);
  const twigMat = new THREE.MeshStandardMaterial({ color: '#4b4031', roughness: 0.95 });
  for (let i = 0; i < 14; i += 1) {
    const len = range(rng, 1.2, 2.4);
    const b = mesh(texCylinder(range(rng, 0.025, 0.06), len, 0.6, 5, true), i % 3 ? twigMat : bark, range(rng, -0.6, 0.6), 0.08 + i * 0.018, range(rng, -0.5, 0.5));
    b.rotation.set(0, range(rng, 0, Math.PI), Math.PI / 2 + range(rng, -0.15, 0.15));
    branches.add(b);
  }
  // Dead fir boughs (green-brown) on top.
  const bough = new THREE.MeshStandardMaterial({ color: '#3e4329', roughness: 0.95, side: THREE.DoubleSide });
  for (let i = 0; i < 6; i += 1) {
    const p = mesh(new THREE.PlaneGeometry(range(rng, 0.9, 1.4), range(rng, 0.5, 0.8)), bough, range(rng, -0.5, 0.5), 0.32 + i * 0.02, range(rng, -0.45, 0.45));
    p.rotation.set(-Math.PI / 2 + range(rng, -0.3, 0.3), 0, range(rng, 0, Math.PI));
    branches.add(p);
  }
  g.add(branches);
  out.parts.branches = branches;
  // Contents: a long crate with the rifle, ammo cans and the ledger.
  g.add(mesh(texBox(1.1, 0.22, 0.4, 1, true), planks, 0, -0.42, 0.15));
  out.displays.cacheRifle = { object: weaponDisplay(g, 'marten', 0.05, -0.28, 0.12, new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2)), weapon: 'marten' };
  await addModel(g, 'ammo_box', -0.4, -0.54, -0.28, 0.2, 0.3);
  await addModel(g, 'ammo_box', -0.05, -0.54, -0.3, -0.3, 0.3);
  const ledger = await addModel(g, 'binder_notebook', 0.42, -0.53, -0.25, 0.9, 0.3);
  ledger.name = 'cache-ledger';
  out.anchors.cacheHatch = local(g, 0, 0.3, 0);
  out.anchors.cacheLedger = local(g, 0.42, -0.4, -0.25);
  out.anchors.cacheRifle = local(g, 0.05, -0.2, 0.12);
  // Environmental evidence: boot prints from the ATV trail, drag marks, a blaze.
  const trailPt = new THREE.Vector3(88, 0, -177);
  for (let i = 0; i < 9; i += 1) {
    const t = i / 9;
    const x = THREE.MathUtils.lerp(trailPt.x, s.x, t) + (i % 2 ? 0.18 : -0.18);
    const z = THREE.MathUtils.lerp(trailPt.z, s.z, t);
    groundMark(ctx, x, z, 0.14, 0.3, Math.atan2(s.x - trailPt.x, s.z - trailPt.z), 0.55);
  }
  for (const dx of [-0.25, 0.25]) groundMark(ctx, (trailPt.x + s.x) / 2 + dx, (trailPt.z + s.z) / 2, 0.12, 6.5, Math.atan2(s.x - trailPt.x, s.z - trailPt.z), 0.4);
  out.anchors.cacheTracks = new THREE.Vector3(trailPt.x + 1, ground(ctx, trailPt.x + 1, trailPt.z - 1) + 0.3, trailPt.z - 1);
  // Orange X sprayed on a stake beside the cache (the poachers' own marker).
  const stake = siteGroup(ctx, s.x + 2.2, s.z - 1.6, 0.8);
  stake.add(mesh(texCylinder(0.08, 1.4, 0.6, 8), bark, 0, 0.7, 0));
  const blaze = mesh(new THREE.PlaneGeometry(0.22, 0.22), decalMaterial(paintDecal('X', '#ff7a1a')), 0, 1.05, 0.081);
  stake.add(blaze);
  out.anchors.cacheBlaze = local(stake, 0, 1.05, 0.2);
  out.anchors.cache = new THREE.Vector3(s.x, y0, s.z);
}

// ------------------------------------------------------------------ ford blockade (M6)

async function buildBlockade(ctx: Ctx, out: MissionSites): Promise<void> {
  const s = SITES.blockade;
  const track = ctx.terrain.roads.find((r) => r.id === 'ford')!;
  const n = track.nearest(s.x, s.z);
  const heading = track.headingAt(n.s);
  const g = siteGroup(ctx, s.x, s.z, heading);
  g.name = 'ford-blockade';
  const bark = await pbrMaterial('pine_bark');
  // Felled fir lying across the track, with branch stubs and the root end chainsawed.
  const log = new THREE.Group();
  const trunk = mesh(texCylinder(0.34, 11, 1.4, 12, true), bark, 0, 0.36, 0);
  trunk.rotation.z = Math.PI / 2;
  log.add(trunk);
  const cut = mesh(new THREE.CircleGeometry(0.34, 16), new THREE.MeshStandardMaterial({ color: '#c9a77a', roughness: 0.8 }), 5.501, 0.36, 0);
  cut.rotation.y = Math.PI / 2;
  log.add(cut);
  const rng = mulberry32(431);
  for (let i = 0; i < 9; i += 1) {
    const x = range(rng, -5, 4.5);
    const stub = mesh(texCylinder(0.05, range(rng, 0.4, 1.1), 0.5, 5), bark, x, 0.36 + range(rng, 0.1, 0.4), range(rng, -0.3, 0.3));
    stub.rotation.set(range(rng, -1.2, 1.2), 0, range(rng, -0.6, 0.6));
    log.add(stub);
  }
  log.position.set(0, 0, 0);
  log.rotation.y = Math.PI / 2 + 0.2;
  g.add(log);
  out.parts.felledLog = log;
  out.colliders.log = [boxCollider(ctx, g, 0, 0.4, 0, 0.75, 0.8, 10.5)];
  // The fresh stump it was cut from, beside the track.
  const stumpPos = local(g, -5.4, 0, -1.2);
  const stump = siteGroup(ctx, stumpPos.x, stumpPos.z, 0);
  stump.add(mesh(texCylinder(0.37, 0.5, 1.4, 12), bark, 0, 0.25, 0));
  stump.add(mesh(new THREE.CircleGeometry(0.37, 16).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cfae80', roughness: 0.8 }), 0, 0.501, 0));
  ctx.physics.tag(ctx.physics.addCylinder(stumpPos.x, stumpPos.y, stumpPos.z, 0.25, 0.37), 'wood');
  // Sawdust around the cut.
  groundMark(ctx, stumpPos.x + 0.5, stumpPos.z, 1.4, 1.1, 0.4, 0.25);
  // The poachers' truck behind the log, crates and a fuel drum.
  const truckPos = local(g, 0.5, 0, 7.5);
  const truck = buildVehicle({ ...CIVILIAN_SUV, paint: '#4a4334' }, { seed: 83 });
  truck.root.position.set(truckPos.x, ground(ctx, truckPos.x, truckPos.z) + 0.12, truckPos.z);
  truck.root.rotation.set(0, heading + 0.9, 0, 'YXZ');
  ctx.root.add(truck.root);
  out.vehicles.blockade = truck.root;
  boxCollider(ctx, truck.root, 0, 0.95, 0, 1.84, 1.3, 4.5, 'metal');
  await addModel(g, 'wooden_crate_02', -2.4, 0, 4.2, 0.2, 0.75);
  await addModel(g, 'barrel_03', 2.6, 0, 3.6, 0.8, 0.9);
  await addModel(g, 'metal_jerrycan_green', 2.1, 0, 4.4, 1.4, 0.45);
  boxCollider(ctx, g, -2.4, 0.38, 4.2, 0.8, 0.75, 0.8);
  boxCollider(ctx, g, 2.6, 0.45, 3.6, 0.65, 0.9, 0.65, 'metal');
  out.anchors.blockadeLog = local(g, 0, 0.8, -0.8);
  out.anchors.blockadeTruck = local(truck.root, -1.2, 1.0, 0);
  out.anchors.blockade = new THREE.Vector3(s.x, ground(ctx, s.x, s.z), s.z);
  out.cover.blockade = [
    [local(g, 1.5, 0, 0.9).x, local(g, 1.5, 0, 0.9).z],
    [local(g, -2.0, 0, 0.9).x, local(g, -2.0, 0, 0.9).z],
    [local(g, -2.4, 0, 5.2).x, local(g, -2.4, 0, 5.2).z],
    [local(g, 2.6, 0, 4.6).x, local(g, 2.6, 0, 4.6).z],
    [truckPos.x + 2.2, truckPos.z + 1.5],
    [truckPos.x - 2.2, truckPos.z + 1.5],
  ];
}

// ------------------------------------------------------------------ base camp (M7)

async function buildBaseCamp(ctx: Ctx, out: MissionSites): Promise<void> {
  const s = SITES.baseCamp;
  const y0 = ground(ctx, s.x, s.z);
  const g = siteGroup(ctx, s.x, s.z, 0.2, y0);
  g.name = 'base-camp';
  const [siding, roof, planks, rusty, tarpTex] = await Promise.all([
    pbrMaterial('weathered_plank_siding', { color: '#c8c2b0' }),
    pbrMaterial('rusty_corrugated_iron', { metalness: 0.4 }),
    pbrMaterial('weathered_planks'),
    pbrMaterial('rusty_metal_02', { metalness: 0.5 }),
    pbrMaterial('corrugated_iron_02', { color: '#5f6a4c', metalness: 0.1, roughness: 0.95 }),
  ]);
  // Old work trailer on blocks, with a door, windows and an awning.
  const tr = new THREE.Group();
  tr.position.set(-6, 0, -5);
  g.add(tr);
  tr.add(mesh(texBox(7, 2.4, 2.6, 2.2), siding, 0, 1.75, 0));
  tr.add(mesh(texBox(7.3, 0.08, 2.9, 1.1, true), roof, 0, 2.99, 0));
  const glass = new THREE.MeshStandardMaterial({ color: '#1a2024', roughness: 0.15, metalness: 0.3 });
  for (const x of [-2.2, 1.8]) tr.add(mesh(new THREE.BoxGeometry(1.0, 0.7, 0.04), glass, x, 2.1, 1.31));
  tr.add(mesh(new THREE.BoxGeometry(0.85, 1.9, 0.05), new THREE.MeshStandardMaterial({ color: '#7a7466', roughness: 0.8 }), 0, 1.5, 1.31));
  for (const x of [-3, -1, 1, 3]) tr.add(mesh(new THREE.BoxGeometry(0.4, 0.55, 0.4), new THREE.MeshStandardMaterial({ color: '#6d6a63', roughness: 0.95 }), x, 0.28, 0));
  tr.add(mesh(texBox(1.1, 0.12, 0.7, 1), planks, 0, 0.45, 1.75));
  // Awning over the rack.
  const awning = mesh(texBox(3.2, 0.05, 1.6, 1.1, true), tarpTex, 2.0, 2.6, 2.1);
  awning.rotation.x = 0.18;
  tr.add(awning);
  for (const x of [0.5, 3.5]) tr.add(mesh(texBox(0.08, 2.5, 0.08, 1), planks, x, 1.25, 2.85));
  boxCollider(ctx, tr, 0, 1.6, 0, 7, 3.2, 2.6, 'metal');
  // Gun rack on the trailer wall under the awning: Kessler's scoped rifle.
  tr.add(mesh(texBox(1.4, 0.12, 0.12, 1, true), planks, 2.4, 1.0, 1.4));
  tr.add(mesh(texBox(1.4, 0.12, 0.12, 1, true), planks, 2.4, 1.7, 1.4));
  out.displays.campDmr = { object: weaponDisplay(tr, 'longwatch', 2.4, 1.35, 1.52, new THREE.Euler(0, Math.PI / 2, 0.08)), weapon: 'longwatch' };
  out.anchors.campRack = local(tr, 2.4, 1.3, 2.0);
  // Folding table with notes, a radio and a bundle of antlers (the trade).
  const table = new THREE.Group();
  table.position.set(-1.2, 0, -1.6);
  g.add(table);
  table.add(mesh(texBox(1.8, 0.05, 0.8, 1, true), planks, 0, 0.78, 0));
  for (const [x, z] of [[-0.8, -0.32], [0.8, -0.32], [-0.8, 0.32], [0.8, 0.32]] as const) table.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.78, 6), rusty, x, 0.39, z));
  await addModel(table, 'binder_notebook', -0.5, 0.8, 0.0, 0.3, 0.3);
  await addModel(table, 'vintage_radio_transceiver', 0.35, 0.8, -0.1, -0.4, 0.4);
  const antler = new THREE.MeshStandardMaterial({ color: '#c9b79a', roughness: 0.7 });
  for (let i = 0; i < 3; i += 1) {
    const a = new THREE.Group();
    a.position.set(-0.1 + i * 0.25, 0.83, 0.22);
    a.rotation.set(0, i * 0.7, Math.PI / 2 - 0.2);
    for (let k = 0; k < 4; k += 1) {
      const tine = mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.2 + k * 0.04, 5), antler, 0, 0.1 + k * 0.06, (k % 2 ? 1 : -1) * 0.03);
      tine.rotation.x = (k % 2 ? 1 : -1) * 0.5;
      a.add(tine);
    }
    a.add(mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.42, 6), antler, 0, 0.18, 0));
    table.add(a);
  }
  boxCollider(ctx, g, -1.2, 0.4, -1.6, 1.8, 0.8, 0.8);
  out.anchors.campNotes = local(table, -0.5, 0.95, 0.0);
  // Two A-frame tarp tents.
  const tarp = new THREE.MeshStandardMaterial({ color: '#4f5a3c', roughness: 0.9, side: THREE.DoubleSide });
  for (const [x, z, r] of [[6, -6, 0.4], [8.5, 1.5, -0.3]] as const) {
    const t = new THREE.Group();
    t.position.set(x, 0, z);
    t.rotation.y = r;
    g.add(t);
    for (const side of [-1, 1]) {
      const p = mesh(new THREE.PlaneGeometry(3.2, 1.75), tarp, side * 0.62, 0.72, 0);
      p.rotation.set(0, Math.PI / 2, side * 0.78);
      t.add(p);
    }
    t.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.4, 6).rotateX(Math.PI / 2), rusty, 0, 1.35, 0));
    boxCollider(ctx, t, 0, 0.6, 0, 2.2, 1.2, 3.2);
  }
  // Generator, lights, fuel, crates, coolers, fire.
  await addModel(g, 'portable_generator', -9.5, 0, 1.0, 0.6, 0.75);
  await addModel(g, 'portable_searchlight', 3.5, 0.95, -9, 2.6, 0.5);
  await addModel(g, 'wooden_crate_02', 3.5, 0, -9, 0.2, 0.9);
  await addModel(g, 'wooden_crate_02', 2.2, 0, 4.5, 0.6, 0.8);
  await addModel(g, 'wooden_crate_02', 2.9, 0, 5.4, 1.2, 0.7);
  await addModel(g, 'barrel_03', -8.2, 0, 2.6, 0.5, 0.9);
  await addModel(g, 'barrel_03', -7.6, 0, 3.4, 1.4, 0.9);
  await addModel(g, 'propane_tank', -3.0, 0, -7.8, 0.2, 1.0);
  await addModel(g, 'stone_fire_pit', 1.8, 0, -2.6, 0, 1.3);
  await addModel(g, 'painted_wooden_chair_01', 0.6, 0, -3.6, 0.6);
  await addModel(g, 'trashbag', -4.6, 0, 3.0, 0.3, 0.7);
  for (const [x, z, w, d, h] of [[-9.5, 1.0, 0.9, 0.6, 0.7], [3.5, -9, 1.0, 1.0, 0.9], [2.5, 5.0, 1.6, 1.6, 0.8], [-7.9, 3.0, 1.2, 1.4, 0.9]] as const) boxCollider(ctx, g, x, h / 2, z, w, h, d);
  // ATV parked at the trail end.
  const atv = new THREE.Group();
  atv.position.set(-12, 0, -9);
  atv.rotation.y = 0.9;
  g.add(atv);
  const atvBody = new THREE.MeshStandardMaterial({ color: '#3e4a30', roughness: 0.6, metalness: 0.2 });
  const tire = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
  atv.add(mesh(new THREE.BoxGeometry(1.0, 0.35, 1.8), atvBody, 0, 0.75, 0));
  atv.add(mesh(new THREE.BoxGeometry(0.5, 0.18, 0.7), new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.8 }), 0, 0.98, -0.2));
  atv.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 6).rotateZ(Math.PI / 2), rusty, 0, 1.15, 0.55));
  for (const [x, z] of [[-0.55, 0.65], [0.55, 0.65], [-0.55, -0.62], [0.55, -0.62]] as const) atv.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.26, 16).rotateZ(Math.PI / 2), tire, x, 0.3, z));
  boxCollider(ctx, atv, 0, 0.6, 0, 1.3, 1.2, 1.9, 'metal');
  // Tree stand (lookout platform) at the camp edge.
  const stand = new THREE.Group();
  stand.position.set(9.5, 0, -10);
  stand.rotation.y = -0.6;
  g.add(stand);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) stand.add(mesh(texBox(0.12, 3.2, 0.12, 1), planks, x, 1.6, z));
  stand.add(mesh(texBox(1.7, 0.1, 1.7, 1), planks, 0, 3.0, 0));
  for (const [x, z, w, d] of [[0, 0.82, 1.7, 0.06], [0, -0.82, 1.7, 0.06], [0.82, 0, 0.06, 1.7]] as const) stand.add(mesh(texBox(w, 0.5, d, 1), planks, x, 3.35, z));
  for (let i = 0; i < 9; i += 1) stand.add(mesh(texBox(0.5, 0.05, 0.06, 1), planks, -0.85, 0.3 + i * 0.32, 0));
  boxCollider(ctx, stand, 0, 2.95, 0, 1.7, 0.12, 1.7);
  for (const [x, z] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]] as const) boxCollider(ctx, stand, x, 1.5, z, 0.14, 3.0, 0.14);
  out.anchors.campStand = local(stand, 0, 3.06, 0);
  out.anchors.baseCamp = new THREE.Vector3(s.x, y0, s.z);
  out.anchors.campTrailer = local(tr, 0, 1, 1.8);
  const pts: [number, number, number][] = [[-6, 0, -1.7], [-2.6, 0, -6.6], [-9.5, 0, 2.1], [3.5, 0, -7.9], [2.5, 0, 6.3], [-7.9, 0, 4.2], [6.5, 0, -3.8], [8.5, 0, 3.6], [-12, 0, -7.6], [1.8, 0, -1.4]];
  out.cover.camp = pts.map(([x, , z]) => {
    const p = local(g, x, 0, z);
    return [p.x, p.z];
  });
}

// ------------------------------------------------------------------ final meeting (M8)

function buildMeeting(ctx: Ctx, out: MissionSites): void {
  // Kessler's truck and the buyer's van, nose to tail by the entrance gate.
  const a = new THREE.Vector3(76, 0, 249);
  const b = new THREE.Vector3(68, 0, 255);
  const truck = buildVehicle({ ...CIVILIAN_SUV, paint: '#2f3a31' }, { seed: 97 });
  truck.root.position.set(a.x, ground(ctx, a.x, a.z) + 0.12, a.z);
  truck.root.rotation.y = 2.4;
  const van = buildVehicle({ ...CIVILIAN_SUV, paint: '#cfcbc0' }, { seed: 101 });
  van.root.position.set(b.x, ground(ctx, b.x, b.z) + 0.12, b.z);
  van.root.rotation.y = 0.9;
  truck.root.visible = false;
  van.root.visible = false;
  ctx.root.add(truck.root, van.root);
  out.vehicles.meetTruck = truck.root;
  out.vehicles.meetVan = van.root;
  out.anchors.meeting = new THREE.Vector3(72, ground(ctx, 72, 252), 252);
  out.cover.meeting = [
    [a.x - 2.4, a.z - 1.2], [a.x + 1.8, a.z + 2.2], [b.x + 2.2, b.z - 1.6], [b.x - 2.6, b.z + 0.8],
    [62, 246], [80, 243], [72, 262], [58, 252],
  ];
}

/** Box colliders for the meeting vehicles once they arrive (Mission 8). */
export function meetingColliders(physics: PhysicsWorld, sites: MissionSites): void {
  for (const v of [sites.vehicles.meetTruck, sites.vehicles.meetVan]) {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(1.84, 1.3, 4.5));
    proxy.position.set(0, 0.95, 0);
    v.add(proxy);
    physics.tag(collideBox(physics, proxy), 'metal');
    proxy.removeFromParent();
  }
}

// ------------------------------------------------------------------ lookout rifle

function buildLookoutRifle(out: MissionSites, structures: Structures, ctx: Ctx): void {
  const b = structures.anchors.binoculars;
  if (!b) return;
  // Leaning in the corner of the lookout cab.
  const p = b.clone().add(new THREE.Vector3(-1.4, -0.55, 0.9));
  out.displays.lookoutRifle = { object: weaponDisplay(ctx.root, 'ridgeline', p.x, p.y, p.z, new THREE.Euler(-Math.PI / 2 + 0.25, 0.6, 0)), weapon: 'ridgeline' };
  out.anchors.lookoutRifle = p.clone().add(new THREE.Vector3(0, 0.3, 0));
}

export async function buildMissionSites(terrain: TerrainData, physics: PhysicsWorld, structures: Structures): Promise<MissionSites> {
  const root = new THREE.Group();
  root.name = 'mission-sites';
  const ctx: Ctx = { terrain, physics, root };
  const placeholder = new THREE.Group();
  const out: MissionSites = {
    group: root, anchors: {}, plates: [], papers: [],
    parts: { lockboxLid: placeholder, lockerDoor: placeholder, hatch: placeholder, branches: placeholder, chain: placeholder, felledLog: placeholder },
    displays: {}, colliders: { log: [] }, cover: {}, vehicles: {},
  };
  await buildRange(ctx, out);
  buildLocker(ctx, out, structures);
  buildWreckRevolver(out, structures, ctx);
  await buildRoadblock(ctx, out);
  await buildCache(ctx, out);
  await buildBlockade(ctx, out);
  await buildBaseCamp(ctx, out);
  buildMeeting(ctx, out);
  buildLookoutRifle(out, structures, ctx);
  // Merge each site's static meshes per material (fewer draw calls); moving parts,
  // targets, pickups and vehicles stay separate.
  const keep: THREE.Object3D[] = [
    ...Object.values(out.parts), ...Object.values(out.displays).map((d) => d.object),
    ...out.plates.map((p) => p.pivot), ...out.papers.map((p) => p.board), ...Object.values(out.vehicles),
  ];
  const keepSet = new Set<THREE.Object3D>();
  for (const k of keep) k.traverse((o) => keepSet.add(o));
  const merge = (g: THREE.Object3D) => {
    let n = 0;
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && !keepSet.has(o)) n += 1;
    });
    if (n > 3) mergeStatic(g, keep.filter((k) => isInside(k, g)));
  };
  for (const child of [...root.children]) if (!Object.values(out.vehicles).includes(child)) merge(child);
  return out;
}

function isInside(o: THREE.Object3D, g: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === g) return true;
  return false;
}
