// Practice targets for the training range: steel plates that ring and swing when
// hit, and paper silhouettes that show every hole. Both are combat hittables, so
// they use exactly the same shot path as the rest of the game.

import * as THREE from 'three';
import type { Hittable, PartHit, ShotHit } from '../weapons/combat.ts';
import type { PaperTarget, SteelPlate } from '../world/missionSites.ts';

export class PlateTarget implements Hittable {
  readonly id: string;
  active = true;
  readonly center: THREE.Vector3;
  readonly radius: number;
  private plate: SteelPlate;
  private swing = 0;
  private swingVel = 0;
  hits = 0;
  onHit_: ((t: PlateTarget) => void) | null = null;

  constructor(id: string, plate: SteelPlate) {
    this.id = id;
    this.plate = plate;
    this.center = plate.center.clone();
    this.radius = plate.radius + 0.05;
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): PartHit | null {
    // Ray vs disc facing `normal`.
    const n = this.plate.normal;
    const denom = d.dot(n);
    if (Math.abs(denom) < 1e-4) return null;
    const t = this.center.clone().sub(o).dot(n) / denom;
    if (t < 0 || t > max) return null;
    const p = o.clone().addScaledVector(d, t);
    if (p.distanceTo(this.center) > this.plate.radius) return null;
    return { dist: t, part: 'plate', normal: denom < 0 ? n.clone() : n.clone().negate(), surface: 'steel' };
  }

  onHit(_h: ShotHit, damage: number): void {
    this.hits += 1;
    this.swingVel += 2.5 + damage * 0.05;
    this.onHit_?.(this);
  }

  update(dt: number): void {
    // Damped pendulum about the top bar.
    this.swingVel += (-this.swing * 40 - this.swingVel * 1.6) * dt;
    this.swing += this.swingVel * dt;
    this.plate.pivot.rotation.x = -this.swing * 0.35;
  }
}

export class PaperTargetHit implements Hittable {
  readonly id: string;
  active = true;
  readonly center: THREE.Vector3;
  readonly radius: number;
  private target: PaperTarget;
  hits = 0;
  onHit_: ((t: PaperTargetHit, zone: 'head' | 'body') => void) | null = null;

  constructor(id: string, target: PaperTarget) {
    this.id = id;
    this.target = target;
    this.center = target.center.clone();
    this.radius = Math.hypot(target.halfW, target.halfH) + 0.05;
  }

  private local(p: THREE.Vector3): { u: number; v: number } {
    // Board plane basis: normal and world up; u across, v up.
    const n = this.target.normal;
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, n).normalize();
    const rel = p.clone().sub(this.center);
    return { u: rel.dot(right) / (this.target.halfW * 2) + 0.5, v: rel.y / (this.target.halfH * 2) + 0.5 };
  }

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): PartHit | null {
    const n = this.target.normal;
    const denom = d.dot(n);
    if (Math.abs(denom) < 1e-4) return null;
    const t = this.center.clone().sub(o).dot(n) / denom;
    if (t < 0 || t > max) return null;
    const p = o.clone().addScaledVector(d, t);
    const { u, v } = this.local(p);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { dist: t, part: v > 0.76 ? 'head' : 'paper', normal: denom < 0 ? n.clone() : n.clone().negate(), surface: 'paper' };
  }

  onHit(h: ShotHit): void {
    this.hits += 1;
    const { u, v } = this.local(h.point);
    // Punch a hole into the printed target.
    const c = this.target.canvas;
    const ctx = c.getContext('2d')!;
    const x = u * c.width;
    const y = (1 - v) * c.height;
    ctx.fillStyle = 'rgba(20, 16, 12, 0.95)';
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120, 100, 70, 0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    this.target.texture.needsUpdate = true;
    // Head zone is the oval above the shoulders.
    this.onHit_?.(this, v > 0.76 ? 'head' : 'body');
  }
}
