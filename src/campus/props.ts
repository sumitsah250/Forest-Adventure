// Story props for V2 cutscenes: the fest banner on the main gate, the tarp over Kalki, and the
// drones whose red eyes open over the RIC. Each is built once and reused; their per-frame
// updates only set numbers on existing objects.

import * as THREE from 'three';
import { Drone } from './actors.ts';

/** The main gate's position; `heading` points along the road into campus (forward is (sin, cos)). */
export interface GateSpot {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Half the distance between the pillars. */
  span: number;
  /** Swings the two gate leaves: 1 wide open (into campus), 0 shut. A barrier blocks the road while shut. */
  setOpen(open: number): void;
}

/** A cloth banner strung between the gate pillars, readable from both sides. */
export function festBanner(gate: GateSpot, title: string, sub: string): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1024, 0);
  grad.addColorStop(0, '#c8202e');
  grad.addColorStop(0.5, '#e25a1c');
  grad.addColorStop(1, '#c8202e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 160);
  g.fillStyle = '#f2d27a';
  g.fillRect(0, 0, 1024, 8);
  g.fillRect(0, 152, 1024, 8);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.font = '800 74px "Segoe UI", "Bahnschrift", sans-serif';
  g.fillText(title, 512, 66, 940);
  g.fillStyle = '#ffe9a8';
  g.font = '700 30px "Segoe UI", sans-serif';
  g.fillText(sub, 512, 124, 940);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 });
  const w = gate.span * 2 - 1.3;
  const geo = new THREE.PlaneGeometry(w, w * (160 / 1024));
  const group = new THREE.Group();
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.z = 0.03 * side;
    if (side < 0) m.rotation.y = Math.PI;
    group.add(m);
  }
  // Hung just under the lintel (4 m up), clear of Kalki and people.
  group.position.set(gate.x, gate.y + 3.25, gate.z);
  group.rotation.y = gate.heading;
  group.name = 'fest-banner';
  return group;
}

/** The tarp over Kalki: sits on the kart until pulled, then slides off sideways and fades. */
export class Tarp {
  readonly obj: THREE.Mesh;
  private mat: THREE.MeshStandardMaterial;
  /** Seconds since the pull started (-1: not pulled). */
  private t = -1;
  private bx = 0;
  private by = 0;
  private bz = 0;
  private rx = 0;
  private rz = 0;

  constructor() {
    const geo = new THREE.BoxGeometry(1.95, 1.3, 3.0, 8, 4, 10);
    // Lumps and sag, so it reads as cloth over a machine and not a crate.
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const top = Math.max(0, y) / 0.65;
      const bump = Math.sin(x * 4.1 + z * 2.3) * 0.05 + Math.sin(z * 5.2 - x * 1.7) * 0.04;
      // Lower in front and behind the seat, pinched in a little toward the ground.
      const sag = top * (0.12 * Math.cos(z * 1.4) - 0.1);
      const flare = 1 + (1 - (y + 0.65) / 1.3) * 0.08;
      pos.setXYZ(i, x * flare + bump * 0.5, y + sag + bump * top, z * flare);
    }
    geo.computeVertexNormals();
    this.mat = new THREE.MeshStandardMaterial({ color: '#8a8f6c', roughness: 1, transparent: true, opacity: 1 });
    this.obj = new THREE.Mesh(geo, this.mat);
    this.obj.castShadow = true;
    this.obj.visible = false;
    this.obj.name = 'kalki-tarp';
  }

  get on(): boolean {
    return this.obj.visible && this.t < 0;
  }

  /** Covers a kart standing at `p`, facing `heading`. */
  cover(p: THREE.Vector3, heading: number): void {
    this.t = -1;
    this.bx = p.x;
    // The box is 1.3 m tall; its bottom edge sits at the ground under the kart.
    this.by = p.y + 0.3;
    this.bz = p.z;
    // The kart's right, for the slide.
    this.rx = -Math.cos(heading);
    this.rz = Math.sin(heading);
    this.obj.position.set(this.bx, this.by, this.bz);
    this.obj.rotation.set(0, heading, 0);
    this.obj.scale.set(1, 1, 1);
    this.mat.opacity = 1;
    this.obj.visible = true;
  }

  pull(): void {
    if (this.obj.visible && this.t < 0) this.t = 0;
  }

  /** Removes it at once (no animation). */
  clear(): void {
    this.t = -1;
    this.obj.visible = false;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const f = Math.min(1, this.t / 1.1);
    const e = 1 - (1 - f) ** 3;
    this.obj.position.set(this.bx + this.rx * e * 2.8, this.by + Math.sin(f * Math.PI) * 0.35 - e * 0.35, this.bz + this.rz * e * 2.8);
    this.obj.rotation.z = -e * 0.9;
    this.obj.scale.set(1 - e * 0.25, 1 - e * 0.55, 1);
    this.mat.opacity = 1 - Math.max(0, f - 0.55) / 0.45;
    if (f >= 1) this.clear();
  }
}

/** MITRA drones for a cutscene: they hang in the dark, then their red eyes open one after another. */
export class DroneEyes {
  readonly group = new THREE.Group();
  private drones: Drone[] = [];
  private glows: THREE.Sprite[] = [];
  private x = 0;
  private y = 0;
  private z = 0;
  /** Seconds since they appeared (-1: hidden). */
  private t = -1;
  private count = 0;

  constructor() {
    this.group.visible = false;
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,60,70,0.9)');
    grad.addColorStop(1, 'rgba(255,30,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    for (let i = 0; i < 4; i += 1) {
      const d = new Drone(3, false);
      d.eyeScale = 0;
      const glow = new THREE.Sprite(mat);
      glow.position.set(0, -0.1, 0.25);
      glow.scale.setScalar(0.001);
      d.obj.add(glow);
      this.group.add(d.obj);
      this.drones.push(d);
      this.glows.push(glow);
    }
  }

  /** Shows `n` drones around a point (0 hides them). */
  show(n: number, at: THREE.Vector3 | null): void {
    this.count = Math.min(this.drones.length, Math.max(0, n));
    if (!this.count || !at) {
      this.group.visible = false;
      this.t = -1;
      return;
    }
    this.x = at.x;
    this.y = at.y;
    this.z = at.z;
    this.t = 0;
    this.group.visible = true;
    this.drones.forEach((d, i) => (d.obj.visible = i < this.count));
  }

  update(dt: number, time: number): void {
    if (this.t < 0) return;
    this.t += dt;
    for (let i = 0; i < this.count; i += 1) {
      const d = this.drones[i];
      const a = (i / this.count) * Math.PI * 2 + 0.9;
      const r = 7 + i * 2.5;
      // Each eye opens 0.45 s after the one before.
      const open = Math.min(1, Math.max(0, (this.t - i * 0.45) / 0.5));
      d.eyeScale = open;
      d.height = 7 + i * 1.3;
      d.place(this.x + Math.cos(a) * r, this.z + Math.sin(a) * r, this.y, a + Math.PI * 0.5, time);
      this.glows[i].scale.setScalar(0.001 + open * (1.5 + Math.sin(time * 5 + i) * 0.15));
    }
  }
}
