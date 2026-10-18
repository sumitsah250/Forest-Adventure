// Vehicle dynamics on Rapier's ray-cast vehicle controller: sprung wheels, a
// simple 4-speed automatic with a torque curve, brakes and reverse, handbrake,
// speed-sensitive steering, anti-roll, aerodynamic/rolling resistance, surface
// grip and water drag. Renderer independent so it can be tuned in Node.

import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { SurfaceKind, TerrainData } from '../world/terrain.ts';

export interface VehicleSpec {
  mass: number;
  /** Centre of mass in chassis space (forward is +Z, left is +X, up is +Y). */
  com: [number, number, number];
  /** Chassis collider boxes: [hx, hy, hz, cx, cy, cz]. */
  boxes: [number, number, number, number, number, number][];
  wheelRadius: number;
  /** Axle positions (z) and half track (x), connection height (y). */
  frontZ: number;
  rearZ: number;
  halfTrack: number;
  connectionY: number;
  suspensionRest: number;
  suspensionTravel: number;
  stiffness: number;
  compression: number;
  relaxation: number;
  frictionSlip: number;
  sideStiffness: number;
  maxSteer: number;
  /** Peak engine torque (Nm) and gearing. */
  torque: number;
  gears: number[];
  reverseGear: number;
  finalDrive: number;
  idleRpm: number;
  redline: number;
  brakeForce: number;
  topSpeed: number;
  antiRoll: number;
}

export const FOREST_4X4: VehicleSpec = {
  mass: 2150,
  com: [0, 0.3, 0.05],
  boxes: [
    [0.92, 0.36, 2.25, 0, 0.78, 0.0],
    [0.86, 0.42, 1.05, 0, 1.52, -0.18],
    [0.9, 0.22, 0.95, 0, 1.16, 1.28],
  ],
  wheelRadius: 0.4,
  frontZ: 1.42,
  rearZ: -1.36,
  halfTrack: 0.8,
  connectionY: 0.62,
  suspensionRest: 0.42,
  suspensionTravel: 0.24,
  stiffness: 32,
  compression: 3.2,
  relaxation: 4.2,
  frictionSlip: 1.75,
  sideStiffness: 1.0,
  maxSteer: 0.6,
  torque: 380,
  gears: [3.6, 2.15, 1.42, 1.0],
  reverseGear: 3.3,
  finalDrive: 4.1,
  idleRpm: 780,
  redline: 4400,
  brakeForce: 58,
  topSpeed: 27,
  antiRoll: 16000,
};

export interface VehicleInput {
  /** -1..1: forward / brake-reverse. */
  throttle: number;
  /** -1..1: right is positive. */
  steer: number;
  handbrake: boolean;
}

const GRIP: Record<SurfaceKind | 'wood', number> = {
  gravel: 1.0,
  mud: 0.62,
  forest: 0.85,
  moss: 0.8,
  rock: 1.05,
  water: 0.55,
  grass: 0.85,
  wood: 0.95,
};

export class VehiclePhysics {
  readonly body: RAPIER.RigidBody;
  readonly controller: RAPIER.DynamicRayCastVehicleController;
  readonly spec: VehicleSpec;
  readonly colliders: RAPIER.Collider[] = [];

  private terrain: TerrainData;
  input: VehicleInput = { throttle: 0, steer: 0, handbrake: false };
  steerAngle = 0;
  gear = 1;
  rpm = 800;
  /** Signed forward speed (m/s). */
  speed = 0;
  reversing = false;
  braking = false;
  engineOn = false;
  /** Throttle actually applied (for audio). */
  load = 0;
  waterDepth = 0;
  private shiftTimer = 0;
  readonly wheelSurface: (SurfaceKind | 'wood')[] = ['gravel', 'gravel', 'gravel', 'gravel'];
  /** Suspension compression velocity per wheel (for thump sounds). */
  readonly compressionVel = [0, 0, 0, 0];
  private lastLen = [0, 0, 0, 0];

  constructor(physics: PhysicsWorld, terrain: TerrainData, spec: VehicleSpec, x: number, y: number, z: number, heading: number) {

    this.terrain = terrain;
    this.spec = spec;
    const R = physics.R;
    const q = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation(q)
      .setLinearDamping(0.02)
      .setAngularDamping(0.55)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(desc);
    for (const [hx, hy, hz, cx, cy, cz] of spec.boxes) {
      const c = physics.world.createCollider(
        R.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(cx, cy, cz)
          .setDensity(0)
          .setFriction(0.45)
          .setRestitution(0.05)
          .setCollisionGroups(groups(GROUP.VEHICLE, GROUP.STATIC | GROUP.PLAYER | GROUP.VEHICLE | GROUP.DYNAMIC))
          .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
          .setContactForceEventThreshold(9000),
        this.body,
      );
      this.colliders.push(c);
    }
    // Explicit mass properties: heavy, with a low centre of mass.
    const [lx, ly, lz] = [spec.boxes[0][0] * 2, spec.boxes[0][1] * 2 + 0.8, spec.boxes[0][2] * 2];
    const m = spec.mass;
    this.body.setAdditionalMassProperties(
      m,
      { x: spec.com[0], y: spec.com[1], z: spec.com[2] },
      { x: (m / 12) * (ly * ly + lz * lz), y: (m / 12) * (lx * lx + lz * lz), z: (m / 12) * (lx * lx + ly * ly) },
      { x: 0, y: 0, z: 0, w: 1 },
      true,
    );

    this.controller = physics.world.createVehicleController(this.body);
    this.controller.indexUpAxis = 1;
    this.controller.setIndexForwardAxis = 2;
    const wheels: [number, number][] = [
      [spec.halfTrack, spec.frontZ],
      [-spec.halfTrack, spec.frontZ],
      [spec.halfTrack, spec.rearZ],
      [-spec.halfTrack, spec.rearZ],
    ];
    wheels.forEach(([wx, wz], i) => {
      this.controller.addWheel({ x: wx, y: spec.connectionY, z: wz }, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, spec.suspensionRest, spec.wheelRadius);
      this.controller.setWheelSuspensionStiffness(i, spec.stiffness);
      this.controller.setWheelSuspensionCompression(i, spec.compression);
      this.controller.setWheelSuspensionRelaxation(i, spec.relaxation);
      this.controller.setWheelMaxSuspensionTravel(i, spec.suspensionTravel);
      this.controller.setWheelMaxSuspensionForce(i, spec.mass * 40);
      this.controller.setWheelFrictionSlip(i, spec.frictionSlip);
      this.controller.setWheelSideFrictionStiffness(i, spec.sideStiffness);
    });
  }

  /** World-space forward (+Z local) and right (-X local) vectors. */
  basis(): { fx: number; fy: number; fz: number; rx: number; ry: number; rz: number; ux: number; uy: number; uz: number } {
    const q = this.body.rotation();
    const { x, y, z, w } = q;
    // Rotate local axes by quaternion.
    const fx = 2 * (x * z + w * y);
    const fy = 2 * (y * z - w * x);
    const fz = 1 - 2 * (x * x + y * y);
    const lx = 1 - 2 * (y * y + z * z);
    const ly = 2 * (x * y + w * z);
    const lz = 2 * (x * z - w * y);
    const ux = 2 * (x * y - w * z);
    const uy = 1 - 2 * (x * x + z * z);
    const uz = 2 * (y * z + w * x);
    return { fx, fy, fz, rx: -lx, ry: -ly, rz: -lz, ux, uy, uz };
  }

  private engineTorque(rpm: number): number {
    // Broad diesel-like curve peaking around 2,400 rpm.
    const t = rpm / 2400;
    return this.spec.torque * Math.max(0.35, 1 - 0.35 * (t - 1) * (t - 1));
  }

  fixedUpdate(dt: number): void {
    const s = this.spec;
    const c = this.controller;
    const v = this.body.linvel();
    const b = this.basis();
    this.speed = v.x * b.fx + v.y * b.fy + v.z * b.fz;
    const absSpeed = Math.abs(this.speed);
    const input = this.engineOn ? this.input : { throttle: 0, steer: this.input.steer, handbrake: true };

    // Steering: rate limited and reduced with speed.
    const maxSteer = s.maxSteer * (1 / (1 + absSpeed * 0.085));
    const target = -input.steer * maxSteer;
    const rate = 2.6 * dt;
    this.steerAngle += Math.max(-rate, Math.min(rate, target - this.steerAngle));
    c.setWheelSteering(0, this.steerAngle);
    c.setWheelSteering(1, this.steerAngle);

    // Drive direction: S brakes while moving forward, then engages reverse.
    let throttle = 0;
    let brake = 0;
    if (input.throttle > 0.05) {
      if (this.reversing && this.speed < -0.6) brake = 1;
      else {
        this.reversing = false;
        throttle = input.throttle;
      }
    } else if (input.throttle < -0.05) {
      if (!this.reversing && this.speed > 0.6) brake = -input.throttle;
      else {
        this.reversing = true;
        throttle = input.throttle;
      }
    }
    this.braking = brake > 0;

    // Automatic gearbox.
    const wheelRpm = (absSpeed / s.wheelRadius) * (60 / (2 * Math.PI));
    const ratio = this.reversing ? s.reverseGear : s.gears[this.gear - 1];
    let rpm = wheelRpm * ratio * s.finalDrive;
    this.shiftTimer -= dt;
    if (!this.reversing && this.shiftTimer <= 0) {
      if (rpm > 3250 && this.gear < s.gears.length) {
        this.gear += 1;
        this.shiftTimer = 0.55;
      } else if (rpm < 1350 && this.gear > 1) {
        this.gear -= 1;
        this.shiftTimer = 0.45;
      }
    }
    if (this.reversing) this.gear = 1;
    const shifting = this.shiftTimer > 0.3;
    rpm = Math.max(s.idleRpm + Math.abs(throttle) * 900 * (absSpeed < 2 ? 1 : 0), rpm);
    rpm = Math.min(s.redline, rpm);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 9);
    this.load += ((shifting ? 0.2 : Math.abs(throttle)) - this.load) * Math.min(1, dt * 6);

    let drive = 0;
    if (throttle !== 0 && !shifting) {
      const wheelForce = (this.engineTorque(this.rpm) * ratio * s.finalDrive * 0.86) / s.wheelRadius;
      const limit = this.reversing ? 4.5 : s.topSpeed;
      const governor = Math.max(0, Math.min(1, (limit - absSpeed) / 3));
      drive = throttle * wheelForce * governor;
    }
    // Water saps power and drags the truck.
    const pos = this.body.translation();
    const water = this.terrain.waterAt(pos.x, pos.z);
    this.waterDepth = water ? Math.max(0, water.level - (pos.y - 0.1)) : 0;
    if (this.waterDepth > 0.05) drive *= Math.max(0.25, 1 - this.waterDepth * 0.8);

    // Per-wheel ground and grip.
    for (let i = 0; i < 4; i += 1) {
      const p = c.wheelContactPoint(i);
      const surf = p ? this.terrain.surfaceAt(p.x, p.z) : 'forest';
      this.wheelSurface[i] = surf;
      const rear = i >= 2;
      const hb = input.handbrake && rear;
      c.setWheelFrictionSlip(i, s.frictionSlip * GRIP[surf] * (hb ? 0.55 : 1));
      // 4WD: torque split 40/60 front/rear.
      c.setWheelEngineForce(i, (drive / 4) * (rear ? 1.2 : 0.8));
      let wb = brake * s.brakeForce;
      if (hb) wb = Math.max(wb, s.brakeForce * 1.4);
      // Engine braking and rolling resistance when coasting.
      if (throttle === 0 && brake === 0) wb = Math.max(wb, absSpeed < 0.3 ? s.brakeForce * 0.6 : 2.2);
      c.setWheelBrake(i, wb);
      const len = c.wheelSuspensionLength(i) ?? s.suspensionRest;
      this.compressionVel[i] = (this.lastLen[i] - len) / dt;
      this.lastLen[i] = len;
    }

    c.updateVehicle(dt, undefined, groups(GROUP.VEHICLE, GROUP.STATIC | GROUP.DYNAMIC), (col) => !this.colliders.includes(col));

    // Anti-roll bars: when one side compresses more than the other, lift the
    // compressed side and pull the extended side down (a pure roll torque).
    const comp = [0, 0, 0, 0];
    for (let i = 0; i < 4; i += 1) {
      comp[i] = s.suspensionRest - (c.wheelSuspensionLength(i) ?? s.suspensionRest);
    }
    const roll = (a: number, bIdx: number) => {
      if (!c.wheelIsInContact(a) && !c.wheelIsInContact(bIdx)) return;
      const diff = comp[a] - comp[bIdx];
      const f = diff * s.antiRoll * dt;
      const pa = c.wheelHardPoint(a);
      const pb = c.wheelHardPoint(bIdx);
      if (!pa || !pb) return;
      this.body.applyImpulseAtPoint({ x: b.ux * f, y: b.uy * f, z: b.uz * f }, pa, true);
      this.body.applyImpulseAtPoint({ x: -b.ux * f, y: -b.uy * f, z: -b.uz * f }, pb, true);
    };
    roll(0, 1);
    roll(2, 3);

    // Aerodynamic drag and water drag.
    const drag = 0.9 * absSpeed * absSpeed + this.waterDepth * 2600 * absSpeed;
    if (absSpeed > 0.01) {
      const k = (drag * dt) / Math.max(absSpeed, 0.01);
      this.body.applyImpulse({ x: -v.x * k, y: 0, z: -v.z * k }, true);
    }
  }

  wheelVisual(i: number): { steer: number; rotation: number; suspension: number; contact: boolean } {
    const c = this.controller;
    return {
      steer: c.wheelSteering(i) ?? 0,
      rotation: c.wheelRotation(i) ?? 0,
      suspension: c.wheelSuspensionLength(i) ?? this.spec.suspensionRest,
      contact: c.wheelIsInContact(i),
    };
  }

  /** True when the truck is on its side or roof. */
  isUpset(): boolean {
    return this.basis().uy < 0.35;
  }

  /** Teleport upright at a position facing a heading. */
  reset(x: number, y: number, z: number, heading: number): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerAngle = 0;
    this.gear = 1;
  }
}
