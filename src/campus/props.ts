// Story props for V2 cutscenes: the fest banner on the main gate, the tarp over Kalki, and the
// drones whose red eyes open over the RIC. Each is built once and reused; their per-frame
// updates only set numbers on existing objects.

import * as THREE from 'three';
import { Drone } from './actors.ts';
import type { Humanoid } from '../character/humanoid.ts';

/**
 * Props worn over an outfit, hung on the skeleton so they move with the body:
 *   lanyard  a yellow contractor's lanyard with a small red pen drive (Sunil; clue c1)
 *   hood     the hood of a grey fest hoodie, down on the shoulders (Raju)
 */
export function dressExtras(rig: Humanoid, extras: ('lanyard' | 'hood')[]): void {
  const neck = rig.bones.neck;
  const chest = rig.bones.chest;
  // Bone-local offsets from the bind-pose joints (character space: +z is forward).
  const nj = rig.joints.neck;
  const cj = rig.joints.chest;
  const toChest = (x: number, y: number, z: number) => new THREE.Vector3(x - cj[0], y - cj[1], z - cj[2]);
  if (extras.includes('lanyard')) {
    const yellow = new THREE.MeshStandardMaterial({ color: '#f2c21b', roughness: 0.7 });
    const red = new THREE.MeshStandardMaterial({ color: '#d4141e', roughness: 0.35, metalness: 0.2 });
    // Two straps from the sides of the neck down to a point on the chest.
    const top = nj[1] - 0.02;
    const tip = new THREE.Vector3(0, top - 0.3, 0.14);
    for (const s of [-1, 1]) {
      const from = new THREE.Vector3(0.07 * s, top, 0.07);
      const len = from.distanceTo(tip);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.018, len, 0.004), yellow);
      strap.position.copy(from).lerp(tip, 0.5).sub(new THREE.Vector3(cj[0], cj[1], cj[2]));
      strap.lookAt(strap.position.clone().add(tip.clone().sub(from)));
      strap.rotateX(Math.PI / 2);
      chest.add(strap);
    }
    const drive = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.06, 0.012), red);
    drive.position.copy(toChest(0, tip.y - 0.035, tip.z + 0.004));
    drive.name = 'pen-drive';
    chest.add(drive);
  }
  if (extras.includes('hood')) {
    const grey = new THREE.MeshStandardMaterial({ color: '#8d9299', roughness: 0.95 });
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1.05, 0.7, 1), grey);
    hood.rotation.x = Math.PI * 0.62;
    hood.position.set(0, 0.0, -0.08);
    neck.add(hood);
  }
}

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
  /** Seconds since they were told to turn (-1: still MITRA's red). */
  private blueT = -1;
  private glowMat: THREE.SpriteMaterial | null = null;

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
    this.glowMat = mat;
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
    this.blueT = -1;
    this.glowMat!.color.set('#ffffff');
    for (const d of this.drones) d.setEyeColor('#ff2a3a');
    this.group.visible = true;
    this.drones.forEach((d, i) => (d.obj.visible = i < this.count));
  }

  /** C6: every drone drops a metre, hangs there a moment, then lights up blue. */
  turnBlue(): void {
    if (this.t >= 0) this.blueT = 0;
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
      if (this.blueT >= 0) {
        // Drop 1 m in a quarter second, hang, then the new colour.
        d.height -= Math.min(1, this.blueT / 0.25);
        if (this.blueT > 1.3 && i === 0) {
          this.glowMat!.color.set('#58b8ff');
          for (const dd of this.drones) dd.setEyeColor('#3aa0ff');
        }
      }
      d.place(this.x + Math.cos(a) * r, this.z + Math.sin(a) * r, this.y, a + Math.PI * 0.5, time);
      this.glows[i].scale.setScalar(0.001 + open * (1.5 + Math.sin(time * 5 + i) * 0.15));
    }
    if (this.blueT >= 0) this.blueT += dt;
  }
}

/**
 * The campus screens (story 2): glowing panels by the RIC, the Administration Block, the
 * Cafeteria and the Power House. One canvas texture shared by all of them, redrawn only when
 * what they show changes.
 */
export class CampusScreens {
  readonly group = new THREE.Group();
  private canvas = document.createElement('canvas');
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshStandardMaterial;
  private shown = '';

  constructor(spots: { x: number; y: number; z: number; facing: number }[]) {
    this.canvas.width = 512;
    this.canvas.height = 288;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: this.tex, emissiveIntensity: 1.1, roughness: 0.4 });
    const frame = new THREE.MeshStandardMaterial({ color: '#1b1d22', roughness: 0.6, metalness: 0.5 });
    const panel = new THREE.PlaneGeometry(2.4, 1.35);
    const back = new THREE.BoxGeometry(2.56, 1.5, 0.1);
    const post = new THREE.BoxGeometry(0.12, 2.0, 0.12);
    for (const s of spots) {
      const g = new THREE.Group();
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.facing;
      const b = new THREE.Mesh(back, frame);
      b.position.y = 2.6;
      const p = new THREE.Mesh(panel, this.mat);
      p.position.set(0, 2.6, 0.056);
      for (const x of [-0.9, 0.9]) {
        const pp = new THREE.Mesh(post, frame);
        pp.position.set(x, 1.0, 0);
        g.add(pp);
      }
      g.add(b, p);
      this.group.add(g);
    }
    this.show('off', null, '', '', '');
  }

  /** What every screen shows. Redraws once per change. */
  show(mode: 'off' | 'intruder' | 'reopened' | 'hero', face: HTMLCanvasElement | null, name: string, roll: string, label: string): void {
    const key = `${mode}|${name}|${roll}|${label}|${face ? 1 : 0}`;
    if (key === this.shown) return;
    this.shown = key;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (mode === 'off') {
      g.fillStyle = '#020305';
      g.fillRect(0, 0, W, H);
      this.mat.emissiveIntensity = 0.05;
      this.tex.needsUpdate = true;
      return;
    }
    const accent = mode === 'intruder' ? '#ff2a3a' : mode === 'reopened' ? '#f2c84b' : '#6ef09a';
    g.fillStyle = mode === 'intruder' ? '#1a0306' : '#071420';
    g.fillRect(0, 0, W, H);
    // Scan lines.
    g.fillStyle = 'rgba(255,255,255,0.04)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    if (face) {
      g.fillStyle = accent;
      g.fillRect(22, 22, 244, 244);
      g.drawImage(face, 28, 28, 232, 232);
    }
    g.fillStyle = accent;
    g.font = '900 40px "Segoe UI", sans-serif';
    g.fillText(label, 284, 78, W - 300);
    g.fillStyle = '#ffffff';
    g.font = '700 30px "Segoe UI", sans-serif';
    g.fillText(name, 284, 150, W - 300);
    g.font = '600 24px Consolas, monospace';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(roll, 284, 192, W - 300);
    g.font = '600 18px Consolas, monospace';
    g.fillStyle = accent;
    g.fillText('MITRA · CAMPUS AI', 284, 250, W - 300);
    this.mat.emissiveIntensity = 1.1;
    this.tex.needsUpdate = true;
  }
}

/** C4: a tongue of mud sliding off the bank above the WRC Parapet. */
export class MudSlide {
  readonly obj: THREE.Mesh;
  private t = -1;
  private from = new THREE.Vector3();
  private dx = 0;
  private dz = 0;

  constructor() {
    const geo = new THREE.SphereGeometry(1, 14, 8).scale(3.4, 0.7, 2.2);
    this.obj = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.55, metalness: 0.05 }));
    this.obj.visible = false;
    this.obj.castShadow = true;
  }

  /** Starts at `at`, sliding along (dx, dz) and down. */
  start(at: THREE.Vector3, dx: number, dz: number): void {
    this.from.copy(at);
    this.dx = dx;
    this.dz = dz;
    this.t = 0;
    this.obj.visible = true;
  }

  update(dt: number): void {
    if (this.t < 0) return;
    this.t += dt;
    const f = Math.min(1, this.t / 2.6);
    const e = 1 - (1 - f) * (1 - f);
    this.obj.position.set(this.from.x + this.dx * 7 * e, this.from.y - 2.6 * e, this.from.z + this.dz * 7 * e);
    this.obj.scale.set(1 + e * 0.5, 1 - e * 0.35, 1 + e * 0.3);
    if (this.t > 9) {
      this.t = -1;
      this.obj.visible = false;
    }
  }
}

/**
 * A drone cutting through a door (mission 3): a glowing line that grows up the door as the
 * countdown runs, with sparks from the tip (main emits them from `tip`).
 */
export class DoorCut {
  readonly obj: THREE.Mesh;
  readonly tip = new THREE.Vector3();
  constructor() {
    this.obj = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffb44a', fog: false }));
    this.obj.visible = false;
  }

  /** Places the cut on the door at (x, y, z) facing `facing`, `p` of the way up (null hides it). */
  set(x: number, y: number, z: number, facing: number, p: number | null): void {
    if (p === null) {
      this.obj.visible = false;
      return;
    }
    const h = 0.1 + p * 2.1;
    this.obj.visible = true;
    // On the door's face, just right of centre.
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    this.obj.position.set(x + fx * 0.08 + fz * 0.35, y, z + fz * 0.08 - fx * 0.35);
    this.obj.rotation.y = facing;
    this.obj.scale.y = h;
    this.tip.set(this.obj.position.x, y + h, this.obj.position.z);
  }
}
