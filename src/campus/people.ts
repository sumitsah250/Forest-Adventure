// Campus people: professors waiting at their department doors, students chatting on the
// lawns, and students walking the footpaths. They use the same procedural characters and
// IK gait as the forest game.

import * as THREE from 'three';
import type { Outfit } from '../character/humanoid.ts';
import { Person } from '../character/person.ts';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type RAPIER from '@dimforge/rapier3d-compat';

/**
 * Collision bit carried by the floor probe. People's collision posts leave it out of their
 * filter, so the probe passes through them (Rapier tests membership against filter both ways),
 * while players and Kalki still bump into them.
 */
const PROBE = 0x0080;

/** Makes a person's collision post invisible to the floor probe. */
export function postGroups(c: RAPIER.Collider): RAPIER.Collider {
  c.setCollisionGroups(groups(GROUP.STATIC, 0xffff & ~PROBE));
  return c;
}
import { DATA, pointInPoly, type Pt } from './geo.ts';
import type { CampusGround } from './ground.ts';
import { mulberry32, pick } from '../world/rng.ts';

import { STAFF, base } from './story/outfits.ts';

export { Person, STAFF };


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
  { ...base, id: 'cq-s7', skin: '#b58262', hair: '#120e0c', top: '#b0475a', topPattern: 'knit', trousers: '#2a3140', trouserPattern: 'denim', boots: '#ecebe6', headwear: 'none', backpack: '#2e2f3a', female: true, hairStyle: 'long' },
  { ...base, id: 'cq-s8', skin: '#a8724f', hair: '#16110d', top: '#e8e2d2', topPattern: 'knit', trousers: '#3b3f52', trouserPattern: 'twill', boots: '#2a2a2a', headwear: 'none', backpack: null, female: true, hairStyle: 'ponytail' },
  { ...base, id: 'cq-s9', skin: '#c08d6c', hair: '#1b1410', top: '#3d6b8a', topPattern: 'knit', trousers: '#2c3646', trouserPattern: 'denim', boots: '#f0eee8', headwear: 'none', backpack: '#6a5a3a', female: true, hairStyle: 'bun' },
  { ...base, id: 'cq-s10', skin: '#9c6a4c', hair: '#120e0b', top: '#2f4f3f', topPattern: 'plaid', trousers: '#2c3646', trouserPattern: 'denim', boots: '#1e1e1e', headwear: 'none', backpack: '#2a2a2e', hairStyle: 'textured', beard: true },
];


/**
 * Where a person's feet go: the terrain, or anything built on it within reach (entrance
 * steps and landings, stand terraces, the podium). A short ray down against static scenery,
 * skipping people's own posts (by collision group: no per-collider callback, so it stays
 * cheap with every person's feet asking every frame). Only floor-like hits count, so a ray
 * that starts inside a wall or a tree trunk falls back to the ground.
 */
export function walkSurface(ground: CampusGround, physics: PhysicsWorld): { heightAt(x: number, z: number): number } {
  const R = physics.R;
  const ray = new R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const filter = groups(PROBE, GROUP.STATIC);
  const REACH = 2.6;
  return {
    heightAt(x: number, z: number): number {
      const base = ground.standAt(x, z);
      ray.origin = { x, y: base + REACH, z };
      const hit = physics.world.castRayAndGetNormal(ray, REACH + 0.6, true, undefined, filter);
      if (!hit || hit.timeOfImpact < 1e-3 || hit.normal.y < 0.7) return base;
      return Math.max(base, base + REACH - hit.timeOfImpact);
    },
  };
}

/** Students standing in small groups on lawns and walking campus footpaths. */
export function populate(scene: THREE.Scene, ground: CampusGround, physics: PhysicsWorld, density: number): Person[] {
  const rng = mulberry32(2025);
  const surface = walkSurface(ground, physics);
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
      people.push(new Person(scene, pick(rng, STUDENTS), surface, physics, x, z, Math.atan2(cx - x, cz - z)));
    }
  }
  const walks = DATA.lines.filter((l) => l.kind === 'footway' && l.pts.length >= 3 && pointInPoly(l.pts[0][0], l.pts[0][1], DATA.boundary) && lineLength(l.pts) > 35);
  const walkers = Math.round(10 * density);
  for (let i = 0; i < walkers && walks.length; i += 1) {
    const l = walks[Math.floor(rng() * walks.length)];
    const p = new Person(scene, pick(rng, STUDENTS), surface, physics, l.pts[0][0], l.pts[0][1], 0);
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
