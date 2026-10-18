// Rapier physics world: terrain heightfield, static scenery colliders and helpers.

import RAPIER from '@dimforge/rapier3d-compat';
import type { TerrainData } from '../world/terrain.ts';

export type Rapier = typeof RAPIER;

let initPromise: Promise<Rapier> | null = null;

export function initRapier(): Promise<Rapier> {
  if (!initPromise) initPromise = RAPIER.init().then(() => RAPIER);
  return initPromise;
}

/** Collision groups: membership in the high 16 bits, filter in the low 16 bits. */
export const GROUP = {
  STATIC: 0x0001,
  PLAYER: 0x0002,
  VEHICLE: 0x0004,
  DYNAMIC: 0x0008,
  INTERACT: 0x0010,
  /** Hostile NPC capsules (block movement, never bullets: hits use body-part tests). */
  NPC: 0x0020,
} as const;

export function groups(member: number, filter: number): number {
  return ((member & 0xffff) << 16) | (filter & 0xffff);
}

export interface StaticBox {
  x: number;
  y: number;
  z: number;
  hx: number;
  hy: number;
  hz: number;
  /** Rotation about Y in radians. */
  rotY?: number;
  /** Full rotation as quaternion (overrides rotY). */
  quat?: { x: number; y: number; z: number; w: number };
}

export class PhysicsWorld {
  readonly R: Rapier;
  readonly world: RAPIER.World;
  readonly eventQueue: RAPIER.EventQueue;
  readonly terrainCollider: RAPIER.Collider;
  private staticBody: RAPIER.RigidBody;
  /** Material of a collider for bullet impacts (by handle); untagged scenery is wood. */
  readonly surfaces = new Map<number, string>();

  /** Tag a collider's surface material (wood, rock, metal...). */
  tag<T extends RAPIER.Collider | null>(c: T, surface: string): T {
    if (c) this.surfaces.set(c.handle, surface);
    return c;
  }

  constructor(R: Rapier, terrain: TerrainData) {
    this.R = R;
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = 1 / 60;
    this.eventQueue = new R.EventQueue(true);
    this.staticBody = this.world.createRigidBody(R.RigidBodyDesc.fixed());

    // Rapier heightfields are column-major with rows along Z and columns along X.
    const n = terrain.n;
    const heights = new Float32Array(n * n);
    for (let zi = 0; zi < n; zi += 1) {
      for (let xi = 0; xi < n; xi += 1) heights[xi * n + zi] = terrain.heights[zi * n + xi];
    }
    const size = terrain.cell * (n - 1);
    const desc = R.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: size, y: 1, z: size })
      .setFriction(0.9)
      .setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    this.terrainCollider = this.world.createCollider(desc, this.staticBody);
    // Invisible walls at the map edge (the rim hills hide them visually).
    const half = size / 2 - 6;
    for (const [x, z, hx, hz] of [[half, 0, 1, half], [-half, 0, 1, half], [0, half, half, 1], [0, -half, half, 1]] as const) {
      this.world.createCollider(
        R.ColliderDesc.cuboid(hx, 80, hz).setTranslation(x, 40, z).setCollisionGroups(groups(GROUP.STATIC, 0xffff)),
        this.staticBody,
      );
    }
  }

  addBox(b: StaticBox, friction = 0.7): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
      .setTranslation(b.x, b.y, b.z)
      .setFriction(friction)
      .setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    if (b.quat) desc.setRotation(b.quat);
    else if (b.rotY) desc.setRotation(yQuat(b.rotY));
    return this.world.createCollider(desc, this.staticBody);
  }

  addCylinder(x: number, y: number, z: number, halfHeight: number, radius: number): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.cylinder(halfHeight, radius)
      .setTranslation(x, y + halfHeight, z)
      .setFriction(0.8)
      .setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  addBall(x: number, y: number, z: number, radius: number): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.ball(radius)
      .setTranslation(x, y, z)
      .setFriction(0.8)
      .setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  addCapsule(
    x: number, y: number, z: number, halfHeight: number, radius: number,
    quat: { x: number; y: number; z: number; w: number },
  ): RAPIER.Collider {
    const R = this.R;
    const desc = R.ColliderDesc.capsule(halfHeight, radius)
      .setTranslation(x, y, z)
      .setRotation(quat)
      .setFriction(0.8)
      .setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  addConvex(points: Float32Array, x: number, y: number, z: number): RAPIER.Collider | null {
    const R = this.R;
    const desc = R.ColliderDesc.convexHull(points);
    if (!desc) return null;
    desc.setTranslation(x, y, z).setFriction(0.8).setCollisionGroups(groups(GROUP.STATIC, 0xffff));
    return this.world.createCollider(desc, this.staticBody);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.world.removeCollider(c, false);
  }

  /** Downward ray against static geometry; returns hit height or null. */
  groundHeight(x: number, z: number, fromY = 200, filter = groups(0xffff, GROUP.STATIC)): number | null {
    const R = this.R;
    // Nudge off exact grid lines: Rapier's heightfield ray test can miss along cell edges.
    const ray = new R.Ray({ x: x + 1.3e-4, y: fromY, z: z + 1.7e-4 }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, fromY + 200, true, undefined, filter);
    return hit ? fromY - hit.timeOfImpact : null;
  }

  step(): void {
    this.world.step(this.eventQueue);
  }
}

export function yQuat(angle: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) };
}
