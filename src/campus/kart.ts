// Kalki: the Automobile club's go-kart, built for the tech fest. A light, low, rear-drive
// kart on the shared ray-cast vehicle physics (src/vehicles), with its own procedural model,
// a seated driver (hands on the wheel), a boost, garage upgrades and paint jobs.
//
// Body space: +Z forward, +X left, +Y up; the origin is the physics body origin, which rides
// about 0.14 m above the ground at rest.

import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData } from '../world/terrain.ts';
import type { Input } from '../core/input.ts';
import type { Player } from '../player/player.ts';
import type { HandTargets } from '../character/animator.ts';
import { Vehicle } from '../vehicles/vehicle.ts';
import type { VehicleSpec } from '../vehicles/vehiclePhysics.ts';
import type { VehicleParts } from '../vehicles/vehicleModel.ts';

export interface Paint {
  name: string;
  body: string;
  trim: string;
  /** Garage price in coins (0: earned, not bought). */
  price: number;
}

export const PAINTS: Record<string, Paint> = {
  crimson: { name: 'Kalki Crimson', body: '#c8202e', trim: '#f2c84b', price: 0 },
  monsoon: { name: 'Monsoon Blue', body: '#1f5fae', trim: '#e8eef5', price: 300 },
  marigold: { name: 'Tihar Marigold', body: '#f29a1c', trim: '#2a1a12', price: 400 },
  himal: { name: 'Himal White', body: '#e9ecef', trim: '#d0142c', price: 500 },
  midnight: { name: 'Midnight Circuit', body: '#1b1f2a', trim: '#38e1ff', price: 650 },
  gold: { name: 'Sunrise Gold', body: '#d9a520', trim: '#7a1020', price: 0 },
};

export interface KartUpgrades {
  engine: number;
  grip: number;
  boost: number;
}

export const MAX_UPGRADE = 3;
export const UPGRADE_COST = [250, 500, 900];

/** Physics for the current garage upgrades. */
export function kartSpec(u: KartUpgrades): VehicleSpec {
  return {
    mass: 230,
    com: [0, 0.1, -0.08],
    boxes: [[0.6, 0.14, 0.98, 0, 0.19, 0]],
    wheelRadius: 0.2,
    frontZ: 0.78,
    rearZ: -0.72,
    halfTrack: 0.62,
    connectionY: 0.22,
    suspensionRest: 0.16,
    suspensionTravel: 0.1,
    stiffness: 60,
    compression: 3.2,
    relaxation: 4.2,
    frictionSlip: 2.3 + u.grip * 0.35,
    sideStiffness: 1.1 + u.grip * 0.12,
    maxSteer: 0.55,
    torque: 34 + u.engine * 7,
    gears: [8, 5.5, 4.2, 3.3],
    reverseGear: 7,
    finalDrive: 1,
    idleRpm: 900,
    redline: 4200,
    brakeForce: 6.5,
    topSpeed: 15 + u.engine * 1.6,
    antiRoll: 2200,
    dragCoef: 0.55,
    rearBias: 1,
  };
}

/** Seconds of boost per full meter. */
export function boostCapacity(u: KartUpgrades): number {
  return 2.2 + u.boost * 1.1;
}

// Driver layout (body space).
const SEAT = new THREE.Vector3(0, 0.42, -0.32);
/** Ankle height and reach in the driver's character space (feet on the pedals). */
const FEET = { y: 0.27, z: 0.74 };

export class Kalki {
  readonly vehicle: Vehicle;
  readonly parts: VehicleParts;
  readonly spec: VehicleSpec;
  private bodyMat: THREE.MeshStandardMaterial;
  private trimMat: THREE.MeshStandardMaterial;
  private flame: THREE.Mesh;
  private upgrades: KartUpgrades = { engine: 0, grip: 0, boost: 0 };
  /** Boost needs unlocking in the story. */
  boostUnlocked = false;
  /** Boost meter 0..1 and whether it fired this step. */
  boost = 1;
  boosting = false;
  private boostHeld = false;
  /** Locked karts can't be driven (story). */
  locked = true;
  paintId = 'crimson';

  constructor(physics: PhysicsWorld, terrain: TerrainData, x: number, z: number, heading: number, headlightShadows: boolean) {
    this.spec = kartSpec(this.upgrades);
    const built = buildKartModel();
    this.parts = built.parts;
    this.bodyMat = built.body;
    this.trimMat = built.trim;
    this.flame = built.flame;
    this.vehicle = new Vehicle(physics, terrain, this.spec, this.parts, x, z, heading, headlightShadows);
    this.vehicle.chaseDistance = 4.4;
    this.vehicle.chaseHeight = 1.05;
    this.vehicle.chaseStretch = 0.09;
    // Campus recovery: back on its wheels where it is (slightly lifted), facing the same way.
    this.vehicle.recover = () => this.place(this.vehicle.position.x, this.vehicle.position.z, this.heading, terrain);
    this.setPaint('crimson');
  }

  get root(): THREE.Group {
    return this.parts.root;
  }

  get position(): THREE.Vector3 {
    return this.vehicle.position;
  }

  get occupied(): boolean {
    return this.vehicle.occupied;
  }

  get heading(): number {
    const b = this.vehicle.phys.basis();
    return Math.atan2(b.fx, b.fz);
  }

  get speedKmh(): number {
    return this.vehicle.speedKmh;
  }

  setUpgrades(u: KartUpgrades): void {
    this.upgrades = { ...u };
    Object.assign(this.spec, kartSpec(u));
  }

  setPaint(id: string): void {
    const p = PAINTS[id] ?? PAINTS.crimson;
    this.paintId = id in PAINTS ? id : 'crimson';
    this.bodyMat.color.set(p.body);
    this.trimMat.color.set(p.trim);
  }

  /** Puts the kart upright at (x, z) facing `heading`, at rest. */
  place(x: number, z: number, heading: number, terrain: TerrainData): void {
    const y = terrain.heightAt(x, z) + 0.45;
    this.vehicle.phys.reset(x, y, z, heading);
    (this.vehicle as unknown as { syncTransforms(snap: boolean): void }).syncTransforms(true);
    this.vehicle.upsetTime = 0;
    this.vehicle.stuckTime = 0;
  }

  // ------------------------------------------------------------ drift, mini-turbo, air
  /** Drifting: direction (+1 right, -1 left, 0 = not drifting) and charge time. */
  driftDir = 0;
  driftT = 0;
  /** Mini-turbo seconds left after a drift (free boost). */
  turbo = 0;
  /** Seconds with all four wheels off the ground. */
  airT = 0;
  onTurbo: ((level: number) => void) | null = null;
  onLand: ((air: number) => void) | null = null;
  onDriftStart: (() => void) | null = null;

  /** Drift charge level: 0 none, 1 blue, 2 orange, 3 purple. */
  get driftLevel(): number {
    if (!this.driftDir) return 0;
    return this.driftT > 2.3 ? 3 : this.driftT > 1.3 ? 2 : this.driftT > 0.6 ? 1 : 0;
  }

  get airborne(): boolean {
    return this.airT > 0.12;
  }

  /** Per fixed step: drift, boost and turbo, then the vehicle. */
  fixedUpdate(dt: number): void {
    const cap = boostCapacity(this.upgrades);
    const base = kartSpec(this.upgrades);
    const ph = this.vehicle.phys;
    const throttle = ph.input.throttle;
    this.boosting = this.boostUnlocked && this.vehicle.occupied && this.boostHeld && this.boost > 0.02 && throttle > 0.3;
    if (this.boosting) this.boost = Math.max(0, this.boost - dt / cap);
    else this.boost = Math.min(1, this.boost + dt * 0.12);
    this.turbo = Math.max(0, this.turbo - dt);
    const fast = this.boosting || this.turbo > 0;
    this.spec.torque = base.torque * (fast ? 1.9 : 1);
    this.spec.topSpeed = base.topSpeed + (fast ? 6 : 0);
    // Drift (arcade style): the rear steps out a little, the kart yaws at a steady rate
    // (steering with the drift tightens it, against it widens it) and the speed is carried
    // round into the new direction instead of scrubbing away or spinning out.
    this.spec.rearGripScale = this.driftDir ? 0.7 : 1;
    if (this.driftDir && this.airT < 0.1) {
      const body = ph.body;
      const steer = ph.input.steer;
      const rate = -this.driftDir * (1.2 + steer * this.driftDir * 0.6);
      const av = body.angvel();
      body.setAngvel({ x: av.x, y: av.y + (rate - av.y) * Math.min(1, dt * 6), z: av.z }, true);
      const v = body.linvel();
      const b = ph.basis();
      const sp = Math.hypot(v.x, v.z);
      const k = Math.min(1, dt * 2.4);
      body.setLinvel({ x: v.x + (b.fx * sp - v.x) * k, y: v.y, z: v.z + (b.fz * sp - v.z) * k }, true);
      if (ph.speed > 5) this.driftT += dt;
    }
    this.vehicle.fixedUpdate(dt);
    // Air time: every wheel off the ground.
    let contact = false;
    for (let i = 0; i < 4; i += 1) if (ph.controller.wheelIsInContact(i)) contact = true;
    if (!contact) this.airT += dt;
    else {
      if (this.airT > 0.45) this.onLand?.(this.airT);
      this.airT = 0;
    }
  }

  postPhysics(): void {
    this.vehicle.postPhysics();
  }

  /** Driver input (per frame while seated). SPACE + steer at speed drifts; let go for a mini-turbo. */
  handleInput(input: Input, dt: number): { exitRequested: boolean } {
    this.boostHeld = input.held('sprint');
    const r = this.vehicle.handleInput(input, dt);
    const ph = this.vehicle.phys;
    const hb = input.held('handbrake');
    const steer = ph.input.steer;
    if (!this.driftDir && hb && Math.abs(steer) > 0.3 && ph.speed > 6 && this.airT < 0.1) {
      this.driftDir = Math.sign(steer);
      this.driftT = 0;
      this.onDriftStart?.();
    }
    if (this.driftDir && (!hb || ph.speed < 3.5)) {
      const level = this.driftLevel;
      this.driftDir = 0;
      if (level > 0 && ph.speed > 3.5) {
        this.turbo = [0, 0.55, 1.0, 1.6][level];
        this.onTurbo?.(level);
      }
      this.driftT = 0;
    }
    // While drifting SPACE means "slide", not "handbrake".
    if (this.driftDir) ph.input.handbrake = false;
    return r;
  }

  update(dt: number, alpha: number, time: number): void {
    this.vehicle.update(dt, alpha);
    const f = this.boosting || this.turbo > 0 ? 0.75 + Math.sin(time * 60) * 0.25 : 0;
    this.flame.visible = f > 0;
    this.flame.scale.set(1, 1, Math.max(0.01, f));
  }

  /** World positions where the rear tyres touch the ground (for sparks and dust). */
  rearContacts(): THREE.Vector3[] {
    return [new THREE.Vector3(0.62, -0.13, -0.72), new THREE.Vector3(-0.62, -0.13, -0.72)].map((v) => this.vehicle.localToWorld(v));
  }

  /** World direction pointing out of the back of the kart. */
  backward(out = new THREE.Vector3()): THREE.Vector3 {
    const b = this.vehicle.phys.basis();
    return out.set(-b.fx, 0, -b.fz).normalize();
  }

  /** World position of the driver's pelvis on the seat. */
  seatWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return this.vehicle.localToWorld(SEAT, out);
  }

  /** Poses the player in the seat (call after update). */
  seatDriver(player: Player, dt: number): void {
    player.animateSeated(dt, this.seatWorld(), this.vehicle.renderQuat, HANDS, FEET);
  }
}

/** Wrists on the wheel (character space: +X left, +Z forward, origin 0.53 m below the pelvis). */
const HANDS: HandTargets = {
  left: { pos: new THREE.Vector3(0.17, 0.83, 0.42), dir: new THREE.Vector3(-0.35, 0.35, 0.87).normalize(), thumb: new THREE.Vector3(0, 0.9, -0.4).normalize() },
  right: { pos: new THREE.Vector3(-0.17, 0.83, 0.42), dir: new THREE.Vector3(0.35, 0.35, 0.87).normalize(), thumb: new THREE.Vector3(0, 0.9, -0.4).normalize() },
  leftPole: new THREE.Vector3(1, -0.6, -0.2),
  rightPole: new THREE.Vector3(-1, -0.6, -0.2),
};

// ==================================================================== model

function nameTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  g.font = 'italic 900 92px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#111';
  g.strokeText('KALKI', 256, 66);
  g.fillStyle = '#fff';
  g.fillText('KALKI', 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function numberTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f1e8';
  g.beginPath();
  g.arc(64, 64, 60, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#111';
  g.font = '900 70px "Segoe UI", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('01', 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildKartModel(): { parts: VehicleParts; body: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; flame: THREE.Mesh } {
  const root = new THREE.Group();
  root.name = 'kalki';
  const body = new THREE.MeshStandardMaterial({ color: '#c8202e', roughness: 0.32, metalness: 0.25 });
  const trim = new THREE.MeshStandardMaterial({ color: '#f2c84b', roughness: 0.4, metalness: 0.3 });
  const frame = new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.45, metalness: 0.7 });
  const black = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.85 });
  const tyre = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3, metalness: 0.85 });
  const seatMat = new THREE.MeshStandardMaterial({ color: '#202226', roughness: 0.7 });
  const head = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#fff1c4', emissiveIntensity: 0, roughness: 0.2 });
  const tail = new THREE.MeshStandardMaterial({ color: '#7a0d12', emissive: '#ff1a24', emissiveIntensity: 0, roughness: 0.3 });
  const reverse = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.3 });
  const beacon = new THREE.MeshStandardMaterial({ color: '#f2a020', emissive: '#f2a020', emissiveIntensity: 0, roughness: 0.3 });
  const decal = new THREE.MeshStandardMaterial({ map: nameTexture(), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const num = new THREE.MeshStandardMaterial({ map: numberTexture(), roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
  const tube = (len: number, r = 0.022) => new THREE.CylinderGeometry(r, r, len, 8);

  // Floor tray and tube frame.
  add(box(0.86, 0.04, 1.86), frame, 0, 0.07, 0.02);
  for (const s of [1, -1]) {
    add(tube(1.9), frame, 0.44 * s, 0.11, 0.02, Math.PI / 2);
    // Side pods in body colour, with the name.
    const pod = add(box(0.2, 0.2, 0.86), body, 0.52 * s, 0.2, -0.12);
    pod.scale.set(1, 1, 1);
    const label = add(new THREE.PlaneGeometry(0.72, 0.18), decal, 0.625 * s, 0.21, -0.12, 0, (Math.PI / 2) * s);
    label.castShadow = false;
    // Side bumper bars between the wheels.
    add(tube(0.9, 0.018), frame, 0.66 * s, 0.17, 0.03, Math.PI / 2);
  }
  // Nose cowl (covers the driver's feet) and front bumper.
  const nose = add(box(0.62, 0.2, 0.52), body, 0, 0.21, 0.66);
  nose.rotation.x = -0.12;
  add(box(0.5, 0.06, 0.2), trim, 0, 0.33, 0.62, -0.12);
  add(box(1.0, 0.08, 0.1), body, 0, 0.16, 1.02);
  add(new THREE.CircleGeometry(0.11, 24), num, 0, 0.27, 1.08, -0.15);
  // Steering column and wheel.
  add(tube(0.55, 0.018), frame, 0, 0.47, 0.28, -0.95);
  const steering = new THREE.Group();
  steering.position.set(0, 0.67, 0.1);
  steering.rotation.x = -0.95 + Math.PI / 2;
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 8, 24), black);
  const spoke = new THREE.Mesh(box(0.28, 0.03, 0.02), frame);
  const spoke2 = new THREE.Mesh(box(0.03, 0.15, 0.02), frame);
  spoke2.position.y = -0.07;
  steering.add(wheelRing, spoke, spoke2);
  const steerPivot = new THREE.Group();
  steerPivot.add(steering);
  root.add(steerPivot);
  // Seat (a moulded bucket).
  add(box(0.42, 0.08, 0.42), seatMat, 0, 0.3, -0.3);
  const back = add(box(0.42, 0.5, 0.07), seatMat, 0, 0.55, -0.53);
  back.rotation.x = -0.3;
  for (const s of [1, -1]) add(box(0.06, 0.36, 0.4), seatMat, 0.21 * s, 0.42, -0.35);
  // Roll hoop behind the seat.
  for (const s of [1, -1]) add(tube(0.82), frame, 0.27 * s, 0.5, -0.62, -0.2);
  add(tube(0.56), frame, 0, 0.9, -0.7, 0, 0, Math.PI / 2);
  // Engine on the left rear, exhaust to the right.
  add(box(0.26, 0.24, 0.28), new THREE.MeshStandardMaterial({ color: '#55585e', roughness: 0.5, metalness: 0.6 }), 0.28, 0.27, -0.72);
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), black, 0.28, 0.45, -0.72);
  add(tube(0.5, 0.03), new THREE.MeshStandardMaterial({ color: '#8a8d92', roughness: 0.35, metalness: 0.9 }), -0.22, 0.26, -0.78, Math.PI / 2, 0, 0.3);
  // Rear bumper and wing in trim colour.
  add(box(1.1, 0.07, 0.1), body, 0, 0.17, -1.0);
  add(box(0.9, 0.04, 0.22), trim, 0, 0.98, -0.82, 0.12);
  // Lamps.
  const headlightLenses: THREE.Mesh[] = [];
  const tailLenses: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    headlightLenses.push(add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14), head, 0.24 * s, 0.25, 1.08, Math.PI / 2));
    tailLenses.push(add(box(0.1, 0.05, 0.02), tail, 0.4 * s, 0.2, -1.06));
  }
  // Boost flame from the exhaust (scaled along Z while boosting).
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.07, 0.45, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.22),
    new THREE.MeshBasicMaterial({ color: '#7fd6ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.position.set(-0.3, 0.27, -1.02);
  flame.visible = false;
  root.add(flame);

  // Wheels: pivot (steer, suspension) -> spin group -> tyre + rim.
  const wheels: THREE.Group[] = [];
  const positions: [number, number, boolean][] = [[0.62, 0.78, true], [-0.62, 0.78, true], [0.62, -0.72, false], [-0.62, -0.72, false]];
  for (const [x, z, front] of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.06, z);
    const spin = new THREE.Group();
    const w = front ? 0.13 : 0.18;
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, w, 22).rotateZ(Math.PI / 2), tyre);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, w + 0.01, 14).rotateZ(Math.PI / 2), rim);
    t.castShadow = true;
    spin.add(t, r);
    pivot.add(spin);
    root.add(pivot);
    wheels.push(pivot);
  }

  const parts: VehicleParts = {
    root,
    wheels,
    steeringWheel: steering,
    headlightLenses,
    tailLenses,
    beaconLenses: [],
    materials: { head, tail, beacon, reverse },
    anchors: {
      driverDoor: new THREE.Vector3(0.75, 0.3, -0.3),
      driverEye: new THREE.Vector3(0, 1.12, -0.3),
      rear: new THREE.Vector3(0, 0.3, -1.05),
      headlightL: new THREE.Vector3(0.24, 0.25, 1.08),
      headlightR: new THREE.Vector3(-0.24, 0.25, 1.08),
      exhaust: new THREE.Vector3(-0.3, 0.27, -1.02),
    },
    door: null,
    jerrycan: null,
  };
  return { parts, body, trim, flame };
}
