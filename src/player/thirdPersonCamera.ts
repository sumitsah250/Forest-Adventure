// Third-person orbit camera: behind and above the character, offset over the
// right shoulder so the crosshair is never hidden by the body. Mouse yaw/pitch
// are the player's view angles; the camera always looks exactly along them, so
// the screen centre is the true aim direction.
//
//  - Explore: 3.3 m behind, wide shoulder offset; a little further back when sprinting.
//  - Aim: a tight over-the-shoulder view (1.5-1.8 m) with a narrower FOV.
//  - Scope: the camera moves to the eye for the marksman rifle's sight picture.
//  - Collision: a sphere cast from the head to the shoulder point, then from there
//    back to the camera; the camera snaps in front of trees, rocks and walls and
//    eases back out when the way is clear.
//  - `smoothFollow` (Campus Quest): the pivot follows the character's interpolated
//    position exactly in the horizontal, thin obstacles (trunks, posts, people) pull
//    the camera in over a few frames instead of in one, and it eases back out on a
//    spring instead of starting back out at full speed.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData } from '../world/terrain.ts';

export interface CameraState {
  /** Character feet (render-interpolated). */
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  /** 0..1 aim blend (right mouse). */
  aim: number;
  /** Distance while aiming (shorter for long guns). */
  aimDistance: number;
  /** FOV factor at full aim. */
  aimFovScale: number;
  /** 0..1 scope sight picture. */
  scope: number;
  sprint: boolean;
  crouch: number;
  baseFov: number;
  /** Scope field of view in degrees. */
  scopeFov: number;
}

/** Round colliders up to this radius count as thin (tree trunks, posts, lamp poles, people). */
const THIN = 0.5;

/** Critically damped spring toward `target` (Unity's SmoothDamp); `v` holds the velocity. */
function smoothDamp(cur: number, target: number, v: { v: number }, time: number, dt: number): number {
  const omega = 2 / Math.max(1e-4, time);
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - target;
  const temp = (v.v + omega * change) * dt;
  v.v = (v.v - omega * temp) * e;
  return target + (change + temp) * e;
}

export class ThirdPersonCamera {
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  private pivot = new THREE.Vector3();
  private dist = 3.3;
  private distV = { v: 0 };
  private shoulder = 0.55;
  private lift = 0.15;
  private fov = 68;
  private ready = false;
  private ball: InstanceType<PhysicsWorld['R']['Ball']>;
  /** Which shoulder (+1 right, -1 left). */
  side = 1;
  private sideBlend = 1;
  /** Distance from the camera to the character pivot last frame (for fading the body). */
  closeness = 3;
  /** Small additive shake (recoil, impacts). */
  shake = 0;
  /** See the header: exact horizontal follow, soft pull-in for thin obstacles, spring ease-out. */
  smoothFollow = false;
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();
  /** Whether the last cast stopped on a thin collider. */
  private hitThin = false;
  private sprintBlend = 0;
  private head = new THREE.Vector3();
  private shoulderPt = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private camPos = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(physics: PhysicsWorld, terrain: TerrainData) {
    this.physics = physics;
    this.terrain = terrain;
    this.ball = new physics.R.Ball(0.2);
  }

  /** Snap (no smoothing) on the next update, e.g. after a teleport. */
  reset(): void {
    this.ready = false;
  }

  private isThin(c: RAPIER.Collider): boolean {
    const t = c.shapeType();
    const S = this.physics.R.ShapeType;
    if (t === S.Cylinder || t === S.Capsule || t === S.Ball || t === S.RoundCylinder) return c.radius() <= THIN;
    return false;
  }

  private cast(from: THREE.Vector3, to: THREE.Vector3): number {
    const dir = this.dir.copy(to).sub(from);
    const len = dir.length();
    this.hitThin = false;
    if (len < 1e-4) return len;
    dir.multiplyScalar(1 / len);
    const hit = this.physics.world.castShape(
      { x: from.x, y: from.y, z: from.z }, { x: 0, y: 0, z: 0, w: 1 }, { x: dir.x, y: dir.y, z: dir.z },
      this.ball, 0, len, true, undefined, groups(0xffff, GROUP.STATIC | GROUP.VEHICLE),
    );
    if (!hit) return len;
    if (this.smoothFollow) this.hitThin = this.isThin(hit.collider);
    return Math.max(0, hit.time_of_impact - 0.04);
  }

  update(dt: number, camera: THREE.PerspectiveCamera, s: CameraState): void {
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    const cp = Math.cos(s.pitch);
    this.forward.set(-sinY * cp, Math.sin(s.pitch), -cosY * cp);
    this.right.set(cosY, 0, -sinY);
    // Pivot at shoulder height, lower when crouching; vertical motion is smoothed
    // more than horizontal so steps and stairs don't jolt the view.
    const pivotY = s.pos.y + 1.55 - s.crouch * 0.42;
    if (!this.ready) {
      this.pivot.set(s.pos.x, pivotY, s.pos.z);
      this.fov = s.baseFov;
      this.distV.v = 0;
    }
    if (this.smoothFollow) {
      // The position is already interpolated between physics steps: following it exactly keeps the
      // character still on screen and the world scrolling evenly. An exponential follow lags by an
      // amount that depends on the frame time, so with uneven frames the view shook by a few pixels.
      this.pivot.x = s.pos.x;
      this.pivot.z = s.pos.z;
    } else {
      this.pivot.x = THREE.MathUtils.damp(this.pivot.x, s.pos.x, 30, dt);
      this.pivot.z = THREE.MathUtils.damp(this.pivot.z, s.pos.z, 30, dt);
    }
    this.pivot.y = THREE.MathUtils.damp(this.pivot.y, pivotY, pivotY < this.pivot.y - 0.8 ? 30 : 11, dt);
    this.sideBlend = THREE.MathUtils.damp(this.sideBlend, this.side, 8, dt);
    const scope = s.scope;
    // Sprint pulls the camera back half a metre; blended, since the camera snaps in to any shorter
    // distance (letting go of Shift jumped the view 0.5 m forward in one frame).
    this.sprintBlend = this.smoothFollow && this.ready ? THREE.MathUtils.damp(this.sprintBlend, s.sprint ? 1 : 0, 3, dt) : s.sprint ? 1 : 0;
    const wantDist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(3.3 + 0.5 * this.sprintBlend, s.aimDistance, s.aim), 0.0, scope);
    const wantShoulder = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.55, 0.62, s.aim), 0.1, scope);
    const wantLift = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.2, 0.06, s.aim), 0.12, scope);
    // Looking down raises the camera over the shoulder; looking up brings it closer.
    const pitchDist = 1 - Math.max(0, s.pitch) * 0.35;
    this.shoulder = THREE.MathUtils.damp(this.shoulder, wantShoulder, 10, dt);
    this.lift = THREE.MathUtils.damp(this.lift, wantLift, 10, dt);
    const head = this.head.set(this.pivot.x, this.pivot.y + 0.05, this.pivot.z);
    const shoulderPt = this.shoulderPt.copy(head).addScaledVector(this.right, this.shoulder * this.sideBlend);
    shoulderPt.y += this.lift;
    // Don't put the shoulder point inside a wall or trunk beside the character.
    const sideFree = this.cast(head, shoulderPt);
    const shoulderLen = head.distanceTo(shoulderPt);
    if (sideFree < shoulderLen) shoulderPt.copy(head).lerp(shoulderPt, sideFree / Math.max(shoulderLen, 1e-4));
    const desired = this.desired.copy(shoulderPt).addScaledVector(this.forward, -wantDist * pitchDist);
    const free = this.cast(shoulderPt, desired);
    const target = Math.min(wantDist * pitchDist, free);
    if (!this.ready) {
      this.dist = target;
      this.distV.v = 0;
    } else if (target < this.dist) {
      if (this.smoothFollow && this.hitThin) {
        // A trunk, post or person sweeping past behind the character: come in fast but over a few
        // frames (snapping in for one of them read as the camera popping in and out while running).
        if (this.distV.v > 0) this.distV.v = 0;
        this.dist = Math.max(target, smoothDamp(this.dist, target, this.distV, 0.07, dt));
      } else {
        // Snap in immediately (never see through a wall).
        this.dist = target;
        this.distV.v = 0;
      }
    } else if (this.smoothFollow) {
      // Ease back out on a spring: starts gently instead of at full speed the frame the way clears.
      if (this.distV.v < 0) this.distV.v = 0;
      this.dist = Math.min(target, smoothDamp(this.dist, target, this.distV, 0.32, dt));
    } else {
      this.dist = THREE.MathUtils.damp(this.dist, target, 5, dt);
    }
    const camPos = this.camPos.copy(shoulderPt).addScaledVector(this.forward, -this.dist);
    // Stay above the ground when looking up from low positions.
    const g = this.terrain.heightAt(camPos.x, camPos.z) + 0.25;
    if (camPos.y < g) camPos.y = g;
    if (this.shake > 0) {
      camPos.x += (Math.random() - 0.5) * this.shake * 0.05;
      camPos.y += (Math.random() - 0.5) * this.shake * 0.05;
      this.shake = Math.max(0, this.shake - dt * 6);
    }
    camera.position.copy(camPos);
    camera.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    const wantFov = THREE.MathUtils.lerp(s.baseFov * (s.sprint && s.aim < 0.1 ? 1.06 : 1) * THREE.MathUtils.lerp(1, s.aimFovScale, s.aim), s.scopeFov, scope);
    this.fov = THREE.MathUtils.clamp(THREE.MathUtils.damp(this.fov, wantFov, scope > 0.5 ? 14 : 9, Math.max(0, dt)), 5, 120);
    if (Math.abs(camera.fov - this.fov) > 0.01) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
    this.closeness = camPos.distanceTo(head);
    this.ready = true;
  }
}
