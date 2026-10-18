// Shared hit detection for player and NPC shots. One trace combines the Rapier
// world (terrain, trunks, rocks, logs, buildings, vehicles) with analytic tests
// against registered hittables (practice targets, NPC body parts), so a shot can
// never pass through a tree or wall to reach a target behind it.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData } from '../world/terrain.ts';
import type { WeaponDef } from './defs.ts';

export type Surface = 'dirt' | 'gravel' | 'mud' | 'rock' | 'wood' | 'metal' | 'steel' | 'paper' | 'water' | 'cloth' | 'foliage';

export interface PartHit {
  dist: number;
  part: 'head' | 'body' | 'limb' | 'plate' | 'paper';
  normal: THREE.Vector3;
  surface: Surface;
}

export interface Shooter {
  kind: 'player' | 'npc';
  id: string;
  position: THREE.Vector3;
}

export interface Hittable {
  id: string;
  /** Ignored by traces while false (defeated NPCs, fallen plates). */
  active: boolean;
  /** Cheap bounding sphere for culling. */
  center: THREE.Vector3;
  radius: number;
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, max: number): PartHit | null;
  onHit(h: ShotHit, damage: number, weapon: WeaponDef | null, shooter: Shooter): void;
}

export interface ShotHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  dist: number;
  surface: Surface;
  target: Hittable | null;
  part: PartHit['part'] | null;
  collider: RAPIER.Collider | null;
}

export interface NoiseEvent {
  pos: THREE.Vector3;
  radius: number;
  time: number;
  source: 'player' | 'npc';
  kind: 'gunshot' | 'impact' | 'footstep';
}

const _ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 1 } };

export class Combat {
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  readonly hittables = new Set<Hittable>();
  readonly noises: NoiseEvent[] = [];
  /** The player's own body (hit by NPC shots, ignored by the player's traces). */
  self: Hittable | null = null;
  time = 0;
  private ray: RAPIER.Ray;

  constructor(physics: PhysicsWorld, terrain: TerrainData) {
    this.physics = physics;
    this.terrain = terrain;
    this.ray = new physics.R.Ray(_ray.origin, _ray.dir);
  }

  add(h: Hittable): void {
    this.hittables.add(h);
  }

  remove(h: Hittable): void {
    this.hittables.delete(h);
  }

  update(dt: number): void {
    this.time += dt;
    while (this.noises.length && this.time - this.noises[0].time > 3) this.noises.shift();
  }

  /** Announce a sound NPCs can hear (gunshots carry far). */
  noise(pos: THREE.Vector3, radius: number, source: NoiseEvent['source'], kind: NoiseEvent['kind']): void {
    this.noises.push({ pos: pos.clone(), radius, time: this.time, source, kind });
  }

  private surfaceOf(c: RAPIER.Collider, p: THREE.Vector3): Surface {
    if (c.handle === this.physics.terrainCollider.handle) {
      if (this.terrain.waterAt(p.x, p.z) && p.y < (this.terrain.waterAt(p.x, p.z)?.level ?? -1e9) + 0.05) return 'water';
      const s = this.terrain.surfaceAt(p.x, p.z);
      if (s === 'gravel') return 'gravel';
      if (s === 'mud') return 'mud';
      if (s === 'rock') return 'rock';
      return 'dirt';
    }
    // Vehicles are metal; tagged scenery uses its tag; other buildings are timber.
    if (c.parent()?.isDynamic()) return 'metal';
    return (this.physics.surfaces.get(c.handle) as Surface | undefined) ?? 'wood';
  }

  /** World geometry only (static scenery, terrain, vehicles). */
  traceWorld(origin: THREE.Vector3, dir: THREE.Vector3, max: number, exclude?: RAPIER.Collider): ShotHit | null {
    this.ray.origin = { x: origin.x, y: origin.y, z: origin.z };
    this.ray.dir = { x: dir.x, y: dir.y, z: dir.z };
    const hit = this.physics.world.castRayAndGetNormal(this.ray, max, true, undefined, groups(0xffff, GROUP.STATIC | GROUP.VEHICLE | GROUP.DYNAMIC), exclude);
    if (!hit) return null;
    const point = origin.clone().addScaledVector(dir, hit.timeOfImpact);
    const normal = new THREE.Vector3(hit.normal.x, hit.normal.y, hit.normal.z);
    if (normal.dot(dir) > 0) normal.negate();
    return { point, normal, dist: hit.timeOfImpact, surface: this.surfaceOf(hit.collider, point), target: null, part: null, collider: hit.collider };
  }

  /** Nearest hit along a ray: world geometry or any active hittable (except `ignore`). */
  trace(origin: THREE.Vector3, dir: THREE.Vector3, max: number, ignore?: Hittable | null, exclude?: RAPIER.Collider): ShotHit | null {
    let best = this.traceWorld(origin, dir, max, exclude);
    let bestDist = best ? best.dist : max;
    const oc = new THREE.Vector3();
    for (const h of this.hittables) {
      if (!h.active || h === ignore) continue;
      // Bounding-sphere reject.
      oc.subVectors(h.center, origin);
      const t = oc.dot(dir);
      if (t < -h.radius || t - h.radius > bestDist) continue;
      const d2 = oc.lengthSq() - t * t;
      if (d2 > h.radius * h.radius) continue;
      const r = h.raycast(origin, dir, bestDist);
      if (r && r.dist < bestDist) {
        bestDist = r.dist;
        best = {
          point: origin.clone().addScaledVector(dir, r.dist), normal: r.normal, dist: r.dist,
          surface: r.surface, target: h, part: r.part, collider: null,
        };
      }
    }
    return best;
  }

  /** True when nothing solid lies between two points (line of sight). */
  clear(a: THREE.Vector3, b: THREE.Vector3, exclude?: RAPIER.Collider): boolean {
    const dir = b.clone().sub(a);
    const len = dir.length();
    if (len < 1e-3) return true;
    dir.multiplyScalar(1 / len);
    return !this.traceWorld(a, dir, len - 0.05, exclude);
  }
}

// ------------------------------------------------------------------ shape tests

/** Ray vs sphere: distance or null. */
export function raySphere(o: THREE.Vector3, d: THREE.Vector3, c: THREE.Vector3, r: number): number | null {
  const ocx = o.x - c.x;
  const ocy = o.y - c.y;
  const ocz = o.z - c.z;
  const b = ocx * d.x + ocy * d.y + ocz * d.z;
  const cc = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 >= 0 ? 0 : null;
}

/** Ray vs capsule (segment a-b, radius r): distance or null. */
export function rayCapsule(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, r: number): number | null {
  // Closest approach between the ray and the segment, then a sphere test there.
  const ab = new THREE.Vector3().subVectors(b, a);
  const ao = new THREE.Vector3().subVectors(o, a);
  const abab = ab.dot(ab);
  const abd = ab.dot(d);
  const abao = ab.dot(ao);
  const dao = d.dot(ao);
  const denom = abab - abd * abd;
  let s = denom > 1e-8 ? (abao - abd * dao) / denom : 0;
  s = THREE.MathUtils.clamp(s / 1, 0, 1);
  // Refine: the sphere centred at the closest segment point.
  let best: number | null = null;
  for (const f of [s, Math.max(0, s - 0.15), Math.min(1, s + 0.15)]) {
    const c = a.clone().addScaledVector(ab, f);
    const t = raySphere(o, d, c, r);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}
