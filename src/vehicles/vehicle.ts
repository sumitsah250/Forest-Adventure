// Drivable vehicle: binds the physics model to the visual model, handles
// entering/exiting, the chase and cockpit cameras, lights and recovery.

import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData } from '../world/terrain.ts';
import type { Input } from '../core/input.ts';
import type { Player } from '../player/player.ts';
import { VehiclePhysics, type VehicleSpec } from './vehiclePhysics.ts';
import type { VehicleParts } from './vehicleModel.ts';

export type CameraMode = 'chase' | 'cockpit';

export class Vehicle {
  readonly phys: VehiclePhysics;
  readonly parts: VehicleParts;
  readonly root: THREE.Group;
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  occupied = false;
  lightsOn = false;
  cameraMode: CameraMode = 'chase';
  recoverHold = 0;
  upsetTime = 0;
  stuckTime = 0;
  private prevPos = new THREE.Vector3();
  private prevQuat = new THREE.Quaternion();
  private curPos = new THREE.Vector3();
  private curQuat = new THREE.Quaternion();
  readonly renderPos = new THREE.Vector3();
  readonly renderQuat = new THREE.Quaternion();
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private orbitYaw = 0;
  private orbitPitch = 0.12;
  private orbitIdle = 0;
  private cockpitYaw = 0;
  private cockpitPitch = -0.05;
  private headlights: THREE.SpotLight[] = [];
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private ray: InstanceType<PhysicsWorld['R']['Ray']>;
  onImpact: ((strength: number) => void) | null = null;
  /** Camera shake from impacts (0..1), decays quickly. */
  shake = 0;

  constructor(physics: PhysicsWorld, terrain: TerrainData, spec: VehicleSpec, parts: VehicleParts, x: number, z: number, heading: number, headlightShadows: boolean) {
    this.physics = physics;
    this.terrain = terrain;
    this.parts = parts;
    this.root = parts.root;
    const y = terrain.heightAt(x, z) + 0.75;
    this.phys = new VehiclePhysics(physics, terrain, spec, x, y, z, heading);
    this.ray = new physics.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    {
      // A single centred spot stands in for both lamps: one light keeps shading cheap
      // and the light count constant (no shader recompiles when toggling).
      const c = parts.anchors.headlightL.clone().add(parts.anchors.headlightR).multiplyScalar(0.5);
      const light = new THREE.SpotLight(0xfff1d8, 0, 80, 0.62, 0.6, 1.3);
      light.position.copy(c);
      light.target.position.copy(c).add(new THREE.Vector3(0, -1.8, 24));
      light.castShadow = headlightShadows;
      light.shadow.mapSize.set(512, 512);
      light.shadow.bias = -0.0008;
      this.root.add(light, light.target);
      this.headlights.push(light);
    }
    this.syncTransforms(true);
    this.camPos.copy(this.curPos).add(new THREE.Vector3(0, 3, -7));
  }

  get position(): THREE.Vector3 {
    return this.renderPos;
  }

  get speedKmh(): number {
    return Math.abs(this.phys.speed) * 3.6;
  }

  /** World position of the driver's door (for the enter prompt). */
  driverDoorWorld(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.parts.anchors.driverDoor).applyQuaternion(this.renderQuat).add(this.renderPos);
  }

  localToWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyQuaternion(this.renderQuat).add(this.renderPos);
  }

  private syncTransforms(snap: boolean): void {
    const t = this.phys.body.translation();
    const r = this.phys.body.rotation();
    if (snap) {
      this.prevPos.set(t.x, t.y, t.z);
      this.prevQuat.set(r.x, r.y, r.z, r.w);
    }
    this.curPos.set(t.x, t.y, t.z);
    this.curQuat.set(r.x, r.y, r.z, r.w);
  }

  setLights(on: boolean): void {
    this.lightsOn = on;
    for (const l of this.headlights) l.intensity = on ? 150 : 0;
    this.parts.materials.head.emissiveIntensity = on ? 2.4 : 0;
  }

  enter(player: Player): void {
    this.occupied = true;
    this.phys.engineOn = true;
    player.setActive(false);
    this.cockpitYaw = 0;
    this.cockpitPitch = -0.05;
    this.orbitYaw = 0;
    // Start the chase camera behind the truck.
    const b = this.phys.basis();
    this.camPos.copy(this.curPos).add(new THREE.Vector3(-b.fx * 7, 2.8, -b.fz * 7));
  }

  /** Finds a free spot beside the truck and puts the player there. Returns false if blocked. */
  exit(player: Player): boolean {
    const halfW = 1.15;
    const candidates = [
      new THREE.Vector3(halfW + 0.35, 0, 0.1),
      new THREE.Vector3(-(halfW + 0.35), 0, 0.1),
      new THREE.Vector3(0, 0, -3.3),
      new THREE.Vector3(0, 0, 3.4),
      new THREE.Vector3(halfW + 1.2, 0, -1.2),
    ];
    const R = this.physics.R;
    const shape = new R.Capsule(0.5, 0.32);
    for (const c of candidates) {
      const w = this.localToWorld(c);
      const ground = this.terrain.heightAt(w.x, w.z);
      if (Math.abs(ground - this.renderPos.y) > 3.5) continue;
      if ((this.terrain.waterAt(w.x, w.z)?.depth ?? 0) > 0.6) continue;
      let blocked = false;
      this.physics.world.intersectionsWithShape(
        { x: w.x, y: ground + 0.95, z: w.z },
        { x: 0, y: 0, z: 0, w: 1 },
        shape,
        () => {
          blocked = true;
          return false;
        },
        undefined,
        groups(GROUP.PLAYER, GROUP.STATIC | GROUP.VEHICLE),
      );
      if (blocked) continue;
      this.occupied = false;
      this.phys.input = { throttle: 0, steer: 0, handbrake: true };
      const b = this.phys.basis();
      player.setActive(true);
      player.teleport(w.x, ground + 0.05, w.z, Math.atan2(-b.fx, -b.fz));
      player.pitch = -0.05;
      return true;
    }
    return false;
  }

  /** Reset upright onto the nearest road point. */
  recover(): void {
    const p = this.curPos;
    let best: { x: number; z: number; heading: number } | null = null;
    let bestD = Infinity;
    for (const road of this.terrain.roads) {
      if (road.kind === 'foot') continue;
      const n = road.nearest(p.x, p.z);
      if (n.dist < bestD) {
        bestD = n.dist;
        const a = road.at(n.s);
        const b = this.phys.basis();
        // Keep the current direction of travel along the road.
        const dir = a.tx * b.fx + a.tz * b.fz >= 0 ? 1 : -1;
        best = { x: a.x, z: a.z, heading: Math.atan2(a.tx * dir, a.tz * dir) };
      }
    }
    if (!best || bestD > 60) best = { x: p.x, z: p.z, heading: Math.atan2(this.phys.basis().fx, this.phys.basis().fz) };
    const y = this.terrain.heightAt(best.x, best.z) + 0.9;
    this.phys.reset(best.x, y, best.z, best.heading);
    this.syncTransforms(true);
    this.upsetTime = 0;
    this.stuckTime = 0;
  }

  /** Per fixed step. Input is sampled once per frame and stored on phys.input. */
  fixedUpdate(dt: number): void {
    this.prevPos.copy(this.curPos);
    this.prevQuat.copy(this.curQuat);
    this.phys.fixedUpdate(dt);
  }

  /** Called after the physics step(s) of a frame. */
  postPhysics(): void {
    this.syncTransforms(false);
  }

  handleInput(input: Input, dt: number): { exitRequested: boolean } {
    let exitRequested = false;
    if (!this.occupied) return { exitRequested };
    const axes = input.moveAxes();
    this.phys.input = { throttle: axes.y, steer: axes.x, handbrake: input.held('handbrake') };
    if (input.pressed('lights')) this.setLights(!this.lightsOn);
    if (input.pressed('camera')) this.cameraMode = this.cameraMode === 'chase' ? 'cockpit' : 'chase';
    if (input.pressed('interact')) exitRequested = true;
    // Recovery when upset or stuck.
    if (this.phys.isUpset()) this.upsetTime += dt;
    else this.upsetTime = 0;
    const tryingToMove = Math.abs(axes.y) > 0.5 && Math.abs(this.phys.speed) < 0.4;
    this.stuckTime = tryingToMove ? this.stuckTime + dt : Math.max(0, this.stuckTime - dt * 2);
    if (this.needsRecovery && input.held('recover')) {
      this.recoverHold += dt;
      if (this.recoverHold > 1.1) {
        this.recover();
        this.recoverHold = 0;
      }
    } else {
      this.recoverHold = 0;
    }
    return { exitRequested };
  }

  get needsRecovery(): boolean {
    return this.upsetTime > 1.2 || this.stuckTime > 4;
  }

  update(dt: number, alpha: number): void {
    this.renderPos.lerpVectors(this.prevPos, this.curPos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha);
    this.root.position.copy(this.renderPos);
    this.root.quaternion.copy(this.renderQuat);
    // Wheels: suspension travel, steering and spin.
    for (let i = 0; i < 4; i += 1) {
      const w = this.phys.wheelVisual(i);
      const pivot = this.parts.wheels[i];
      pivot.position.y = this.phys.spec.connectionY - w.suspension;
      pivot.rotation.y = w.steer;
      const spin = pivot.children[0];
      spin.rotation.x = w.rotation;
    }
    if (this.parts.steeringWheel) this.parts.steeringWheel.rotation.z = this.phys.steerAngle * 7;
    const tail = this.parts.materials.tail;
    tail.emissiveIntensity = this.phys.braking ? 3.2 : this.lightsOn ? 0.9 : 0;
    this.parts.materials.reverse.emissiveIntensity = this.phys.reversing && Math.abs(this.phys.speed) > 0.1 ? 2 : 0;
    void dt;
  }

  /** Writes the active vehicle camera. `look` is the mouse delta this frame. */
  updateCamera(camera: THREE.PerspectiveCamera, dt: number, look: { x: number; y: number }, sensitivity: number): void {
    const b = this.phys.basis();
    const k = 0.0022 * sensitivity;
    if (this.cameraMode === 'cockpit') {
      this.cockpitYaw = THREE.MathUtils.clamp(this.cockpitYaw - look.x * k, -1.9, 1.9);
      this.cockpitPitch = THREE.MathUtils.clamp(this.cockpitPitch - look.y * k, -0.9, 0.6);
      const eye = this.localToWorld(this.parts.anchors.driverEye, this.tmp);
      camera.position.copy(eye);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.cockpitPitch, Math.PI + this.cockpitYaw, 0, 'YXZ'));
      camera.quaternion.copy(this.renderQuat).multiply(q);
      return;
    }
    // Chase camera with mouse orbit that eases back behind the truck.
    if (Math.abs(look.x) + Math.abs(look.y) > 0.5) {
      this.orbitYaw -= look.x * k;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + look.y * k * 0.7, -0.15, 0.85);
      this.orbitIdle = 0;
    } else {
      this.orbitIdle += dt;
      if (this.orbitIdle > 1.6 && Math.abs(this.phys.speed) > 2) {
        this.orbitYaw = THREE.MathUtils.damp(this.orbitYaw, 0, 2.2, dt);
        this.orbitPitch = THREE.MathUtils.damp(this.orbitPitch, 0.12, 2, dt);
      }
    }
    const heading = Math.atan2(b.fx, b.fz) + this.orbitYaw + (this.phys.speed < -1 ? 0 : 0);
    const dist = 6.6 + Math.min(1.6, Math.abs(this.phys.speed) * 0.05);
    const pivot = this.tmp2.copy(this.renderPos).add(new THREE.Vector3(0, 1.45, 0));
    const desired = this.tmp.set(
      pivot.x - Math.sin(heading) * Math.cos(this.orbitPitch) * dist,
      pivot.y + Math.sin(this.orbitPitch) * dist + 0.6,
      pivot.z - Math.cos(heading) * Math.cos(this.orbitPitch) * dist,
    );
    // Pull in when terrain, trunks or buildings are in the way.
    const dir = desired.clone().sub(pivot);
    const len = dir.length();
    dir.multiplyScalar(1 / len);
    this.ray.origin = { x: pivot.x, y: pivot.y, z: pivot.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.physics.world.castRay(this.ray, len, true, undefined, groups(0xffff, GROUP.STATIC));
    if (hit) desired.copy(pivot).addScaledVector(dir, Math.max(1.4, hit.timeOfImpact - 0.35));
    const ground = this.terrain.heightAt(desired.x, desired.z) + 0.45;
    if (desired.y < ground) desired.y = ground;
    const follow = hit ? 18 : 6.5;
    this.camPos.x = THREE.MathUtils.damp(this.camPos.x, desired.x, follow, dt);
    this.camPos.y = THREE.MathUtils.damp(this.camPos.y, desired.y, follow, dt);
    this.camPos.z = THREE.MathUtils.damp(this.camPos.z, desired.z, follow, dt);
    if (this.camPos.distanceTo(desired) > 25) this.camPos.copy(desired);
    const lookTarget = this.tmp2.copy(this.renderPos).add(new THREE.Vector3(b.fx * 2.2, 1.2, b.fz * 2.2));
    this.camLook.lerp(lookTarget, Math.min(1, dt * 12));
    if (this.camLook.distanceTo(lookTarget) > 10) this.camLook.copy(lookTarget);
    camera.position.copy(this.camPos);
    camera.lookAt(this.camLook);
    // Short shake after hard knocks, plus a faint rumble on rough ground at speed.
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const rough = this.phys.wheelSurface[0] === 'gravel' || this.phys.wheelSurface[0] === 'mud' ? Math.min(1, Math.abs(this.phys.speed) / 25) * 0.012 : 0;
    const s = this.shake * 0.18 + rough;
    if (s > 0.001) {
      camera.position.x += (Math.random() - 0.5) * s;
      camera.position.y += (Math.random() - 0.5) * s;
      camera.position.z += (Math.random() - 0.5) * s;
    }
  }

  /** Called from the game with contact force events for impact sounds/shake. */
  impact(force: number): void {
    this.onImpact?.(force);
  }
}
