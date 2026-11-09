// A friendly standing or walking character (campus students and staff, forest
// locals). Uses the shared procedural humanoid and IK gait. Standing people turn
// to face the player and look at them when they come close; otherwise they glance
// around now and then.

import * as THREE from 'three';
import { createHumanoid, type Humanoid, type Outfit } from './humanoid.ts';
import { Animator } from './animator.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { range } from '../world/rng.ts';

/** Anything with a ground height (campus ground, forest terrain). */
export interface Ground {
  heightAt(x: number, z: number): number;
}

/** Walking route: a polyline of [x, z] points. */
export type RoutePt = [number, number];

export class Person {
  readonly rig: Humanoid;
  readonly anim: Animator;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  facing: number;
  private homeFacing: number;
  /** Optional walking route (polyline) and progress. */
  route: RoutePt[] | null = null;
  private seg = 0;
  private t = 0;
  private dir = 1;
  private speed = range(Math.random, 1.1, 1.45);
  private pause = 0;
  /** Idle glance target (around the group) and time until the next glance. */
  private glance = new THREE.Vector3();
  private glanceT = Math.random() * 3;
  private hasGlance = false;
  readonly name: string;

  constructor(scene: THREE.Scene, outfit: Outfit, ground: Ground, physics: PhysicsWorld, x: number, z: number, facing: number, name = '') {
    this.rig = createHumanoid(outfit);
    scene.add(this.rig.root);
    // Feet follow the terrain only: a physics ray would hit the person's own collision
    // cylinder (hosts have one) and plant the feet on top of it.
    void physics;
    this.anim = new Animator(this.rig, (gx: number, gz: number) => ground.heightAt(gx, gz));
    this.pos.set(x, ground.heightAt(x, z), z);
    this.facing = facing;
    this.homeFacing = facing;
    this.name = name;
    this.anim.reset(this.pos, facing);
    this.ground = ground;
  }

  private ground: Ground;

  place(x: number, z: number, facing: number): void {
    this.pos.set(x, this.ground.heightAt(x, z), z);
    this.facing = facing;
    this.homeFacing = facing;
    this.anim.reset(this.pos, facing);
  }

  update(dt: number, camera: THREE.Vector3, player: THREE.Vector3 | null): void {
    const far = this.pos.distanceToSquared(camera) > 75 * 75;
    this.rig.root.visible = !far;
    if (this.route) this.walk(dt);
    if (far || dt <= 0) return;
    let lookAt: THREE.Vector3 | null = null;
    if (!this.route && player && player.distanceToSquared(this.pos) < 7 * 7) {
      // Turn to face the player when they come close.
      lookAt = new THREE.Vector3(player.x, player.y + 1.55, player.z);
      const want = Math.atan2(player.x - this.pos.x, player.z - this.pos.z);
      this.facing += angleDiff(this.facing, want) * (1 - Math.exp(-3 * dt));
    } else if (!this.route) {
      this.facing += angleDiff(this.facing, this.homeFacing) * (1 - Math.exp(-1.5 * dt));
      // People standing around glance at each other and around them now and then.
      this.glanceT -= dt;
      if (this.glanceT <= 0) {
        this.glanceT = 1.5 + Math.random() * 4;
        this.hasGlance = Math.random() > 0.25;
        const a = this.homeFacing + (Math.random() - 0.5) * 2.2;
        this.glance.set(this.pos.x + Math.sin(a) * 2.5, this.pos.y + 1.4 + Math.random() * 0.4, this.pos.z + Math.cos(a) * 2.5);
      }
      if (this.hasGlance) lookAt = this.glance;
    }
    this.anim.update(dt, {
      pos: this.pos, vel: this.vel, facing: this.facing, grounded: true, crouch: 0, sprint: false,
      aimPitch: 0, aimAmount: 0, lookAt, hands: null, pose: 'normal', flinch: 0,
    });
  }

  private walk(dt: number): void {
    const r = this.route!;
    if (this.pause > 0) {
      this.pause -= dt;
      this.vel.set(0, 0, 0);
      return;
    }
    const a = r[this.seg];
    const b = r[this.seg + 1];
    const len = Math.max(0.01, Math.hypot(b[0] - a[0], b[1] - a[1]));
    this.t += (this.speed * dt * this.dir) / len;
    if (this.t > 1 || this.t < 0) {
      const next = this.seg + this.dir;
      if (next < 0 || next >= r.length - 1) {
        this.dir = -this.dir;
        this.t = THREE.MathUtils.clamp(this.t, 0, 1);
        this.pause = range(Math.random, 1, 4);
      } else {
        this.seg = next;
        this.t = this.dir > 0 ? 0 : 1;
      }
      return;
    }
    const x = a[0] + (b[0] - a[0]) * this.t;
    const z = a[1] + (b[1] - a[1]) * this.t;
    const y = this.ground.heightAt(x, z);
    if (dt > 0) this.vel.set((x - this.pos.x) / dt, (y - this.pos.y) / dt, (z - this.pos.z) / dt);
    this.pos.set(x, y, z);
    const want = Math.atan2(this.vel.x, this.vel.z);
    this.facing += angleDiff(this.facing, want) * (1 - Math.exp(-8 * dt));
  }
}

function angleDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
