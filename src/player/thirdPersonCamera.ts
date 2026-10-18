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

import * as THREE from 'three';
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

export class ThirdPersonCamera {
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  private pivot = new THREE.Vector3();
  private dist = 3.3;
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
  readonly forward = new THREE.Vector3();
  readonly right = new THREE.Vector3();

  constructor(physics: PhysicsWorld, terrain: TerrainData) {
    this.physics = physics;
    this.terrain = terrain;
    this.ball = new physics.R.Ball(0.2);
  }

  /** Snap (no smoothing) on the next update, e.g. after a teleport. */
  reset(): void {
    this.ready = false;
  }

  private cast(from: THREE.Vector3, to: THREE.Vector3): number {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-4) return len;
    dir.multiplyScalar(1 / len);
    const hit = this.physics.world.castShape(
      { x: from.x, y: from.y, z: from.z }, { x: 0, y: 0, z: 0, w: 1 }, { x: dir.x, y: dir.y, z: dir.z },
      this.ball, 0, len, true, undefined, groups(0xffff, GROUP.STATIC | GROUP.VEHICLE),
    );
    return hit ? Math.max(0, hit.time_of_impact - 0.04) : len;
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
    }
    this.pivot.x = THREE.MathUtils.damp(this.pivot.x, s.pos.x, 30, dt);
    this.pivot.z = THREE.MathUtils.damp(this.pivot.z, s.pos.z, 30, dt);
    this.pivot.y = THREE.MathUtils.damp(this.pivot.y, pivotY, pivotY < this.pivot.y - 0.8 ? 30 : 11, dt);
    this.sideBlend = THREE.MathUtils.damp(this.sideBlend, this.side, 8, dt);
    const scope = s.scope;
    const wantDist = THREE.MathUtils.lerp(THREE.MathUtils.lerp(s.sprint ? 3.8 : 3.3, s.aimDistance, s.aim), 0.0, scope);
    const wantShoulder = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.55, 0.62, s.aim), 0.1, scope);
    const wantLift = THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.2, 0.06, s.aim), 0.12, scope);
    // Looking down raises the camera over the shoulder; looking up brings it closer.
    const pitchDist = 1 - Math.max(0, s.pitch) * 0.35;
    this.shoulder = THREE.MathUtils.damp(this.shoulder, wantShoulder, 10, dt);
    this.lift = THREE.MathUtils.damp(this.lift, wantLift, 10, dt);
    const head = new THREE.Vector3(this.pivot.x, this.pivot.y + 0.05, this.pivot.z);
    const shoulderPt = head.clone().addScaledVector(this.right, this.shoulder * this.sideBlend).add(new THREE.Vector3(0, this.lift, 0));
    // Don't put the shoulder point inside a wall or trunk beside the character.
    const sideFree = this.cast(head, shoulderPt);
    const shoulderLen = head.distanceTo(shoulderPt);
    if (sideFree < shoulderLen) shoulderPt.copy(head).lerp(shoulderPt, sideFree / Math.max(shoulderLen, 1e-4));
    const desired = shoulderPt.clone().addScaledVector(this.forward, -wantDist * pitchDist);
    const free = this.cast(shoulderPt, desired);
    const target = Math.min(wantDist * pitchDist, free);
    // Snap in immediately (never see through a trunk), ease back out.
    if (!this.ready || target < this.dist) this.dist = target;
    else this.dist = THREE.MathUtils.damp(this.dist, target, 5, dt);
    const camPos = shoulderPt.clone().addScaledVector(this.forward, -this.dist);
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
