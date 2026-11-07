// Campus people: professors waiting at their department doors, students chatting on the
// lawns, and students walking the footpaths. They use the same procedural characters and
// IK gait as the forest game.

import * as THREE from 'three';
import { createHumanoid, type Humanoid, type Outfit } from '../character/humanoid.ts';
import { Animator } from '../character/animator.ts';
import type { PhysicsWorld } from '../physics/physics.ts';
import { DATA, pointInPoly, type Pt } from './geo.ts';
import type { CampusGround } from './ground.ts';
import { mulberry32, pick, range } from '../world/rng.ts';

const base = { headwearColor: '#000', beard: false, uniform: false, vest: null } as const;

export const STUDENT: Outfit = {
  ...base, id: 'cq-player', skin: '#a8724f', hair: '#16110d', top: '#2f4f6f', topPattern: 'knit', trousers: '#2c3646', trouserPattern: 'denim',
  boots: '#e8e6e0', headwear: 'none', backpack: '#2a2a2e',
};

const STUDENTS: Outfit[] = [
  { ...base, id: 'cq-s1', skin: '#b07a58', hair: '#1a1410', top: '#7a2e2e', topPattern: 'plaid', trousers: '#30394a', trouserPattern: 'denim', boots: '#2a2622', headwear: 'none', backpack: '#3a4a5a' },
  { ...base, id: 'cq-s2', skin: '#9c6a4c', hair: '#120e0b', top: '#d8d4c8', topPattern: 'knit', trousers: '#22262e', trouserPattern: 'twill', boots: '#e4e2dc', headwear: 'none', backpack: null },
  { ...base, id: 'cq-s3', skin: '#c08d6c', hair: '#211812', top: '#3f6a4a', topPattern: 'knit', trousers: '#3a3f4a', trouserPattern: 'denim', boots: '#3a2c22', headwear: 'cap', headwearColor: '#1d2b44', backpack: '#6b3a2a' },
  { ...base, id: 'cq-s4', skin: '#a77352', hair: '#0f0c0a', top: '#4a4f8a', topPattern: 'canvas', trousers: '#5a5246', trouserPattern: 'canvas', boots: '#1e1e1e', headwear: 'none', backpack: '#1f3a2c' },
  { ...base, id: 'cq-s5', skin: '#b98468', hair: '#1c1510', top: '#e0b040', topPattern: 'knit', trousers: '#2c3240', trouserPattern: 'denim', boots: '#f0eee8', headwear: 'none', backpack: null },
  { ...base, id: 'cq-s6', skin: '#94664a', hair: '#15110e', top: '#26282c', topPattern: 'knit', trousers: '#2c3646', trouserPattern: 'denim', boots: '#c43c3c', headwear: 'beanie', headwearColor: '#8a2a2a', backpack: '#22252a' },
];

export const STAFF: Record<string, Outfit> = {
  suitGrey: { ...base, id: 'cq-p1', skin: '#a8724f', hair: '#2a2420', top: '#4a4d52', topPattern: 'twill', trousers: '#3a3c40', trouserPattern: 'twill', boots: '#121212', headwear: 'none', backpack: null, suit: true },
  suitBrown: { ...base, id: 'cq-p2', skin: '#b58262', hair: '#6a6660', top: '#5a4632', topPattern: 'twill', trousers: '#3f3326', trouserPattern: 'twill', boots: '#1a1410', headwear: 'none', backpack: null, suit: true, beard: true },
  suitNavy: { ...base, id: 'cq-p3', skin: '#9c6a4c', hair: '#141110', top: '#23324f', topPattern: 'twill', trousers: '#23324f', trouserPattern: 'twill', boots: '#101010', headwear: 'none', backpack: null, suit: true },
  coat: { ...base, id: 'cq-p4', skin: '#c08d6c', hair: '#1a1410', top: '#e9e9e4', topPattern: 'canvas', trousers: '#3a3c40', trouserPattern: 'twill', boots: '#1a1a1a', headwear: 'none', backpack: null },
  sweater: { ...base, id: 'cq-p5', skin: '#a77352', hair: '#555049', top: '#6a2f3a', topPattern: 'knit', trousers: '#4a4a40', trouserPattern: 'twill', boots: '#2a2018', headwear: 'none', backpack: null, beard: true },
};

export class Person {
  readonly rig: Humanoid;
  readonly anim: Animator;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  facing: number;
  private homeFacing: number;
  /** Optional walking route (polyline) and progress. */
  route: Pt[] | null = null;
  private seg = 0;
  private t = 0;
  private dir = 1;
  private speed = range(Math.random, 1.1, 1.45);
  private pause = 0;
  readonly name: string;

  constructor(scene: THREE.Scene, outfit: Outfit, ground: CampusGround, physics: PhysicsWorld, x: number, z: number, facing: number, name = '') {
    this.rig = createHumanoid(outfit);
    scene.add(this.rig.root);
    const groundFn = (gx: number, gz: number, fromY: number) => physics.groundHeight(gx, gz, fromY) ?? ground.heightAt(gx, gz);
    this.anim = new Animator(this.rig, groundFn);
    this.pos.set(x, ground.heightAt(x, z), z);
    this.facing = facing;
    this.homeFacing = facing;
    this.name = name;
    this.anim.reset(this.pos, facing);
    this.ground = ground;
  }

  private ground: CampusGround;

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

/** Students standing in small groups on lawns and walking campus footpaths. */
export function populate(scene: THREE.Scene, ground: CampusGround, physics: PhysicsWorld, density: number): Person[] {
  const rng = mulberry32(2025);
  const people: Person[] = [];
  const spots = DATA.areas.filter((a) => (a.kind === 'park' || a.kind === 'plaza') && a.name && pointInPoly(a.pts[0][0], a.pts[0][1], DATA.boundary));
  const groups = Math.round(7 * density);
  for (let g = 0; g < groups && spots.length; g += 1) {
    const a = spots[(g * 5) % spots.length];
    let cx = 0, cz = 0;
    for (const p of a.pts) { cx += p[0]; cz += p[1]; }
    cx /= a.pts.length;
    cz /= a.pts.length;
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i += 1) {
      const ang = (i / n) * Math.PI * 2 + rng();
      const x = cx + Math.cos(ang) * 0.9;
      const z = cz + Math.sin(ang) * 0.9;
      // Face the middle of the group.
      people.push(new Person(scene, pick(rng, STUDENTS), ground, physics, x, z, Math.atan2(cx - x, cz - z)));
    }
  }
  const walks = DATA.lines.filter((l) => l.kind === 'footway' && l.pts.length >= 3 && pointInPoly(l.pts[0][0], l.pts[0][1], DATA.boundary) && lineLength(l.pts) > 35);
  const walkers = Math.round(10 * density);
  for (let i = 0; i < walkers && walks.length; i += 1) {
    const l = walks[Math.floor(rng() * walks.length)];
    const p = new Person(scene, pick(rng, STUDENTS), ground, physics, l.pts[0][0], l.pts[0][1], 0);
    // Offset sideways a little so two walkers on one path do not overlap.
    const off = (rng() - 0.5) * 1.2;
    p.route = l.pts.map(([x, z], k) => {
      const q = l.pts[Math.min(l.pts.length - 1, k + 1)];
      const o = l.pts[Math.max(0, k - 1)];
      const dx = q[0] - o[0];
      const dz = q[1] - o[1];
      const d = Math.hypot(dx, dz) || 1;
      return [x - (dz / d) * off, z + (dx / d) * off] as Pt;
    });
    people.push(p);
  }
  return people;
}

function lineLength(p: Pt[]): number {
  let s = 0;
  for (let i = 0; i < p.length - 1; i += 1) s += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
  return s;
}
