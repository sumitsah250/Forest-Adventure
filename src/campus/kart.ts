// Kalki: the Automobile club's dune buggy, built for the tech fest. A light, rear-drive
// two-seater on the shared ray-cast vehicle physics (src/vehicles), with its model from
// public/assets/models/kalki/kalki.glb (built by scripts/build-kalki-model.mjs), a seated
// driver (left seat, hands on the wheel), a boost, garage upgrades and paint jobs.
//
// Body space: +Z forward, +X left, +Y up; the origin is between the axles at wheel-centre
// height, about 0.34 m above the ground at rest.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../render/textures.ts';
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
  /** Colour for the buggy's black panels and for its yellow trim (null: as built). */
  body: string | null;
  trim: string | null;
  /** Garage price in coins (0: earned, not bought). */
  price: number;
}

export const PAINTS: Record<string, Paint> = {
  // The id is kept from the go-kart days: it is every save's default paint.
  crimson: { name: 'Dune Black', body: null, trim: null, price: 0 },
  redline: { name: 'Kalki Crimson', body: '#c8202e', trim: '#f2c84b', price: 250 },
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
    // Geometry from kalki.glb (wheel centres, radius); mass, torque and brakes scaled from
    // the old go-kart so the buggy accelerates, brakes and drifts the way Kalki always did.
    mass: 300,
    com: [0, 0.02, -0.12],
    boxes: [[0.72, 0.26, 1.3, 0, 0.18, -0.12]],
    wheelRadius: 0.34,
    frontZ: 1.0,
    rearZ: -0.975,
    halfTrack: 0.87,
    connectionY: 0.2,
    suspensionRest: 0.2,
    suspensionTravel: 0.14,
    stiffness: 55,
    compression: 3.2,
    relaxation: 4.2,
    frictionSlip: 2.3 + u.grip * 0.35,
    sideStiffness: 1.1 + u.grip * 0.12,
    maxSteer: 0.6,
    torque: 75 + u.engine * 15.5,
    gears: [8, 5.5, 4.2, 3.3],
    reverseGear: 7,
    finalDrive: 1,
    idleRpm: 900,
    redline: 4200,
    brakeForce: 8.5,
    topSpeed: 15 + u.engine * 1.6,
    antiRoll: 2900,
    dragCoef: 0.55,
    rearBias: 1,
  };
}

/** Seconds of boost per full meter. */
export function boostCapacity(u: KartUpgrades): number {
  return 2.2 + u.boost * 1.1;
}

/**
 * Driver layout, measured from the model when it is built (buildKartModel): the pelvis on
 * the left seat (body space), the wrists on the wheel and the feet on the pedals (the
 * driver's character space: +X left, +Z forward, origin 0.53 m below the pelvis).
 */
const SEAT = new THREE.Vector3(0.33, 0.24, -0.38);
const FEET = { y: 0.33, z: 0.82 };

export class Kalki {
  readonly vehicle: Vehicle;
  readonly parts: VehicleParts;
  readonly spec: VehicleSpec;
  private paint: PaintUniforms;
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
    this.paint = built.paint;
    this.flame = built.flame;
    this.vehicle = new Vehicle(physics, terrain, this.spec, this.parts, x, z, heading, headlightShadows);
    this.vehicle.chaseDistance = 5.6;
    this.vehicle.chaseHeight = 1.45;
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
    this.paint.kalkiBodyOn.value = p.body ? 1 : 0;
    this.paint.kalkiTrimOn.value = p.trim ? 1 : 0;
    if (p.body) this.paint.kalkiBody.value.set(p.body);
    if (p.trim) this.paint.kalkiTrim.value.set(p.trim);
  }

  /** Puts the kart upright at (x, z) facing `heading`, at rest. */
  place(x: number, z: number, heading: number, terrain: TerrainData): void {
    const y = terrain.heightAt(x, z) + 0.62;
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
    const s = this.spec;
    const y = s.connectionY - s.suspensionRest - s.wheelRadius;
    return [new THREE.Vector3(s.halfTrack, y, s.rearZ), new THREE.Vector3(-s.halfTrack, y, s.rearZ)].map((v) => this.vehicle.localToWorld(v));
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

/** Wrists on the wheel (character space: +X left, +Z forward, origin 0.53 m below the pelvis); set from the model. */
const HANDS: HandTargets = {
  left: { pos: new THREE.Vector3(0.15, 0.74, 0.3), dir: new THREE.Vector3(-0.35, 0.35, 0.87).normalize(), thumb: new THREE.Vector3(0, 0.9, -0.4).normalize() },
  right: { pos: new THREE.Vector3(-0.15, 0.74, 0.3), dir: new THREE.Vector3(0.35, 0.35, 0.87).normalize(), thumb: new THREE.Vector3(0, 0.9, -0.4).normalize() },
  leftPole: new THREE.Vector3(1, -0.6, -0.2),
  rightPole: new THREE.Vector3(-1, -0.6, -0.2),
};

// ==================================================================== model

const MODEL_URL = 'models/kalki/kalki.glb';
let template: THREE.Group | null = null;
let loading: Promise<void> | null = null;

/** Starts (once) loading Kalki's model; `new Kalki` needs it loaded. */
export function loadKalkiModel(): Promise<void> {
  loading ??= new GLTFLoader().loadAsync(assetUrl(MODEL_URL)).then((gltf) => {
    template = gltf.scene;
  });
  return loading;
}

/** Paint-job uniforms shared by the buggy's painted materials. */
interface PaintUniforms {
  kalkiBody: { value: THREE.Color };
  kalkiTrim: { value: THREE.Color };
  kalkiBodyOn: { value: number };
  kalkiTrimOn: { value: number };
}

/**
 * A paint job without repainting textures: the buggy's glossy black (non-metal) panels
 * take the body colour and its yellow trim takes the trim colour, keeping the texture's
 * shading. Metal, tyres, seats and lamps keep their own colours.
 */
function paintable(mat: THREE.MeshStandardMaterial, u: PaintUniforms): void {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 kalkiBody;\nuniform vec3 kalkiTrim;\nuniform float kalkiBodyOn;\nuniform float kalkiTrimOn;')
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float hi = max(max(c.r, c.g), c.b);
          float lo = min(min(c.r, c.g), c.b);
          float nonMetal = 1.0 - smoothstep(0.3, 0.7, metalnessFactor);
          float black = (1.0 - smoothstep(0.012, 0.05, hi)) * nonMetal * kalkiBodyOn;
          float yellow = smoothstep(0.55, 0.8, (hi - lo) / max(hi, 1e-4)) * step(c.b * 2.0, c.g) * smoothstep(0.08, 0.2, hi) * kalkiTrimOn;
          diffuseColor.rgb = mix(c, kalkiBody * (0.7 + hi * 6.0), black);
          diffuseColor.rgb = mix(diffuseColor.rgb, kalkiTrim * min(1.2, hi * 1.4), yellow);
          metalnessFactor = mix(metalnessFactor, 0.15, black);
        }`,
      );
  };
  mat.customProgramCacheKey = () => 'kalki-paint';
}

/** "KALKI" in white italic capitals with a dark outline, on a transparent canvas. */
function nameTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
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

/**
 * The buggy's name on both side panels and across the hood. The panels are curved and not
 * where a box model would put them, so each decal is placed where a ray from outside first
 * meets the bodywork, lying flat on the surface it hits.
 */
function addNameDecals(root: THREE.Group, body: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const targets: THREE.Mesh[] = [];
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !/^(tyre_|seat_|steering_wheel|lamp_lenses)/.test(m.name)) targets.push(m);
  });
  const mat = new THREE.MeshStandardMaterial({ map: nameTexture(), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const ray = new THREE.Raycaster();
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const place = (from: THREE.Vector3, dir: THREE.Vector3, width: number, up: THREE.Vector3) => {
    ray.set(from.clone().applyMatrix4(root.matrixWorld), dir.clone().transformDirection(root.matrixWorld));
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit?.face) return;
    const p = hit.point.clone().applyMatrix4(toRoot);
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(toRoot);
    // Face the way the ray came from, whatever the winding.
    if (n.dot(dir) > 0) n.negate();
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
    decal.position.copy(p).addScaledVector(n, 0.012);
    decal.up.copy(up);
    decal.lookAt(decal.position.clone().add(n));
    decal.name = 'kalki-name';
    decal.renderOrder = 2;
    root.add(decal);
  };
  // Sides: low on the body between the wheels, reading front to back on each side.
  place(new THREE.Vector3(2.5, 0.08, -0.05), new THREE.Vector3(-1, 0, 0), 0.8, new THREE.Vector3(0, 1, 0));
  place(new THREE.Vector3(-2.5, 0.08, -0.05), new THREE.Vector3(1, 0, 0), 0.8, new THREE.Vector3(0, 1, 0));
  // Hood: from above, in front of the driver, reading from the driver's seat.
  place(new THREE.Vector3(0, 3, 0.62), new THREE.Vector3(0, -1, 0), 0.7, new THREE.Vector3(0, 0, 1));
}

function buildKartModel(): { parts: VehicleParts; paint: PaintUniforms; flame: THREE.Mesh } {
  if (!template) throw new Error('Kalki model not loaded (call loadKalkiModel first)');
  const src = template.clone(true);
  const root = new THREE.Group();
  root.name = 'kalki';
  const get = (name: string): THREE.Object3D => {
    const o = src.getObjectByName(name);
    if (!o) throw new Error(`kalki.glb is missing "${name}"`);
    return o;
  };
  const at = (name: string) => get(name).position.clone();

  const paint: PaintUniforms = {
    kalkiBody: { value: new THREE.Color('#151515') },
    kalkiTrim: { value: new THREE.Color('#f2c84b') },
    kalkiBodyOn: { value: 0 },
    kalkiTrimOn: { value: 0 },
  };
  const head = new THREE.MeshStandardMaterial({ color: '#fff6d8', emissive: '#fff1c4', emissiveIntensity: 0, roughness: 0.2 });
  const tail = new THREE.MeshStandardMaterial({ color: '#7a0d12', emissive: '#ff1a24', emissiveIntensity: 0, roughness: 0.3 });
  const reverse = new THREE.MeshStandardMaterial({ color: '#dddddd', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.3 });
  const beacon = new THREE.MeshStandardMaterial({ color: '#f2a020', emissive: '#f2a020', emissiveIntensity: 0, roughness: 0.3 });

  // Materials: lamp lenses glow (keeping their texture), the bodywork takes the paint.
  const headlightLenses: THREE.Mesh[] = [];
  src.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    const mat = m.material as THREE.MeshStandardMaterial;
    if (m.name === 'lamp_lenses') {
      const lens = head.clone();
      lens.map = mat.map;
      lens.emissiveMap = mat.map;
      m.material = lens;
      headlightLenses.push(m);
    } else if (!/^(tyre_|seat_|steering_wheel)/.test(m.name)) {
      paintable(mat, paint);
    }
  });
  // One emissive material drives every lens.
  const lensMat = headlightLenses[0]?.material as THREE.MeshStandardMaterial | undefined;
  for (const l of headlightLenses) l.material = lensMat!;
  const headMat = lensMat ?? head;

  // Wheels: pivot (steer, suspension) -> spin group -> the model's tyre and rim.
  const wheels: THREE.Group[] = [];
  for (const id of ['FL', 'FR', 'RL', 'RR']) {
    const node = get(`wheel_${id}`);
    const pivot = new THREE.Group();
    pivot.position.set(node.position.x, 0, node.position.z);
    const spin = new THREE.Group();
    for (const c of [...node.children]) spin.add(c);
    node.removeFromParent();
    pivot.add(spin);
    root.add(pivot);
    wheels.push(pivot);
  }

  // Steering wheel: the model's pivot (local Z = column), turning an inner group about it.
  const column = get('steering');
  const steering = new THREE.Group();
  for (const c of [...column.children]) steering.add(c);
  column.add(steering);

  // Tail lamps (the model has none) and the boost flame.
  const tailLenses: THREE.Mesh[] = [];
  for (const side of ['L', 'R']) {
    const p = at(`tail_${side}`);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.03), tail);
    lamp.position.copy(p);
    root.add(lamp);
    tailLenses.push(lamp);
  }
  const exhaust = at('exhaust');
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.09, 0.55, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.27),
    new THREE.MeshBasicMaterial({ color: '#7fd6ff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  flame.position.copy(exhaust);
  flame.visible = false;
  root.add(flame);
  root.add(src);
  addNameDecals(root, src);

  // Driver layout from the seat and the wheel.
  SEAT.copy(at('seat')).add(new THREE.Vector3(0, 0.1, 0.06));
  const wheel = column.position;
  const toWheel = wheel.clone().sub(SEAT);
  const wristY = toWheel.y + 0.53 + 0.02;
  HANDS.left!.pos.set(toWheel.x + 0.14, wristY, toWheel.z - 0.03);
  HANDS.right!.pos.set(toWheel.x - 0.14, wristY, toWheel.z - 0.03);
  FEET.y = 0.53 - 0.1 - (SEAT.y - at('seat').y) - 0.12;
  FEET.z = Math.max(0.7, toWheel.z + 0.55);

  const lampL = at('lamp_L');
  const lampR = at('lamp_R');
  const parts: VehicleParts = {
    root,
    wheels,
    steeringWheel: steering,
    headlightLenses,
    tailLenses,
    beaconLenses: [],
    materials: { head: headMat, tail, beacon, reverse },
    anchors: {
      driverDoor: new THREE.Vector3(SEAT.x + 0.95, SEAT.y - 0.1, SEAT.z),
      driverEye: new THREE.Vector3(SEAT.x, SEAT.y + 0.72, SEAT.z),
      rear: new THREE.Vector3(0, exhaust.y + 0.2, exhaust.z - 0.05),
      headlightL: lampL,
      headlightR: lampR,
      exhaust,
    },
    door: null,
    jerrycan: null,
  };
  return { parts, paint, flame };
}
