// Things the missions put into the world: the objective beacon, pick-up items and devices,
// Kalki's checkpoint rings, MITRA's searchlight drones and memory shards.

import * as THREE from 'three';
import { placeModel } from '../render/models.ts';
import type { ItemModel } from './story.ts';

/** Gold light column with a floating marker over the current objective. */
export class Beacon {
  readonly group = new THREE.Group();
  private column: THREE.Mesh;
  private gem: THREE.Mesh;
  private ring: THREE.Mesh;

  constructor() {
    const grad = document.createElement('canvas');
    grad.width = 4;
    grad.height = 128;
    const g = grad.getContext('2d')!;
    const lg = g.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    lg.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = lg;
    g.fillRect(0, 0, 4, 128);
    const alpha = new THREE.CanvasTexture(grad);
    const colMat = new THREE.MeshBasicMaterial({ color: '#ffcf4a', alphaMap: alpha, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0.5 });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 46, 16, 1, true), colMat);
    this.column.position.y = 23;
    this.column.renderOrder = 5;
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#b88a10', roughness: 0.3, metalness: 0.4 }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.group.add(this.column, this.gem, this.ring);
  }

  set(x: number, y: number, z: number, dist: number, t: number, gemHeight: number): void {
    this.group.position.set(x, y, z);
    // The column fades out as you arrive so it never blocks the conversation.
    const mat = this.column.material as THREE.MeshBasicMaterial;
    mat.opacity = THREE.MathUtils.clamp((dist - 4) / 20, 0, 1) * 0.55;
    this.column.scale.set(1 + Math.min(dist / 120, 2.5), 1, 1 + Math.min(dist / 120, 2.5));
    this.gem.position.y = gemHeight + 0.35 + Math.sin(t * 2.2) * 0.08;
    this.gem.rotation.y = t * 1.6;
    this.gem.visible = dist > 1.6;
    this.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
  }
}

const std = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...o });

/** A pick-up item or a device on a small stand, with a floating sparkle. */
export async function itemModel(kind: ItemModel): Promise<THREE.Group> {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 12), std('#a29c90', { roughness: 0.9 }));
  stand.position.y = 0.4;
  const top = 0.8;
  let model: THREE.Object3D | null = null;
  try {
    if (kind === 'book') model = await placeModel('binder_notebook', { size: 0.32 });
    else if (kind === 'toolbox') model = await placeModel('metal_toolbox', { size: 0.45 });
    else if (kind === 'breaker') model = await placeModel('power_box_01', { size: 0.6 });
    else if (kind === 'torch') model = await placeModel('signal_flashlight', { size: 0.3 });
    else if (kind === 'part') model = await placeModel('metal_jerrycan_green', { size: 0.4 });
  } catch {
    model = null;
  }
  const post = (h: number) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.16, h, 0.16), std('#4a4c4e', { metalness: 0.5 }));
    p.position.y = h / 2;
    g.add(p);
  };
  if (kind === 'breaker') {
    post(1.6);
    if (model) {
      model.position.set(0, 1.0, 0.12);
      g.add(model);
    }
  } else if (kind === 'panel') {
    // A keypad / terminal on a post: dark body, glowing screen.
    post(1.15);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.1), std('#22252b', { metalness: 0.4 }));
    body.position.set(0, 1.3, 0);
    body.rotation.x = -0.25;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.3), new THREE.MeshStandardMaterial({ color: '#0b2a33', emissive: '#2ad4ff', emissiveIntensity: 1.4 }));
    screen.position.set(0, 1.31, 0.056);
    screen.rotation.x = -0.25;
    g.add(body, screen);
  } else if (kind === 'relay') {
    // MITRA's relay: a mast with a red blinking head.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 2.2, 8), std('#9aa0a6', { metalness: 0.8, roughness: 0.3 }));
    mast.position.y = 1.1;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), std('#2a2d33', { metalness: 0.5 }));
    box.position.y = 0.6;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), new THREE.MeshStandardMaterial({ color: '#400', emissive: '#ff2030', emissiveIntensity: 2.5 }));
    head.position.y = 2.25;
    head.name = 'blink';
    g.add(mast, box, head);
  } else if (kind === 'gnss') {
    const leg = std('#c9a03a', { roughness: 0.5 });
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 6), leg);
      m.position.set(Math.cos(a) * 0.28, 0.75, Math.sin(a) * 0.28);
      m.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      g.add(m);
    }
    const rx = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16), std('#f0f0ea', { roughness: 0.4 }));
    rx.position.y = 1.58;
    g.add(rx);
  } else if (kind === 'sandbag') {
    const bag = std('#b49a6a', { roughness: 1 });
    for (let i = 0; i < 5; i += 1) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 6).scale(1.3, 0.45, 0.8), bag);
      b.position.set((i % 3) * 0.55 - 0.55 + (i > 2 ? 0.28 : 0), 0.14 + (i > 2 ? 0.26 : 0), 0);
      g.add(b);
    }
  } else {
    g.add(stand);
    if (kind === 'cube') {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), std('#9d9a93', { roughness: 1 }));
      cube.position.y = top + 0.075;
      g.add(cube);
    } else if (kind === 'usb') {
      const usb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.03), std('#c0302a', { roughness: 0.4 }));
      usb.position.y = top + 0.012;
      g.add(usb);
    } else if (kind === 'evidence') {
      // An evidence bag with a yellow tag.
      const bagM = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.32), new THREE.MeshStandardMaterial({ color: '#dfe6ea', roughness: 0.25, transparent: true, opacity: 0.85 }));
      bagM.position.y = top + 0.02;
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.045, 0.06), std('#f2c84b'));
      tag.position.set(0.08, top + 0.03, 0.12);
      g.add(bagM, tag);
    } else if (kind === 'module') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial({ color: '#0b2a33', emissive: '#2ad4ff', emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.5 }));
      m.position.y = top + 0.2;
      m.name = 'spin';
      g.add(m);
    } else if (model) {
      model.position.y = top;
      g.add(model);
    }
  }
  // Floating sparkle so items read from a distance.
  const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#c9961a', roughness: 0.3 }));
  glow.name = 'glow';
  glow.position.y = kind === 'breaker' || kind === 'relay' ? 2.6 : 1.6;
  g.add(glow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.9, 32), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}

/** Animates sparkles, spinning modules and blinking relays. */
export function animateItem(obj: THREE.Object3D, t: number, seed: number): void {
  const glow = obj.getObjectByName('glow');
  if (glow) {
    glow.position.y = (glow.userData.baseY ??= glow.position.y) + Math.sin(t * 2.4 + seed) * 0.12;
    glow.rotation.y = t * 1.5;
  }
  const spin = obj.getObjectByName('spin');
  if (spin) spin.rotation.set(t * 0.7, t * 1.1, 0);
  const blink = obj.getObjectByName('blink') as THREE.Mesh | undefined;
  if (blink) ((blink.material as THREE.MeshStandardMaterial).emissiveIntensity = Math.sin(t * 6) > 0 ? 3 : 0.3);
}

// ------------------------------------------------------------------ checkpoint rings

const ringGeo = new THREE.TorusGeometry(2.6, 0.16, 10, 40);

/** An upright checkpoint hoop Kalki drives through. */
export class CheckRing {
  readonly obj: THREE.Group;
  private mat: THREE.MeshStandardMaterial;
  readonly x: number;
  readonly z: number;

  constructor(x: number, y: number, z: number, heading: number, colour = '#ffcf4a') {
    this.x = x;
    this.z = z;
    this.obj = new THREE.Group();
    this.mat = new THREE.MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.8, roughness: 0.4, transparent: true, opacity: 0.9 });
    const ring = new THREE.Mesh(ringGeo, this.mat);
    ring.position.y = 2.4;
    this.obj.add(ring);
    for (const s of [1, -1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.6, 8), std('#2b2d31', { metalness: 0.6 }));
      leg.position.set(2.45 * s, 0.1, 0);
      this.obj.add(leg);
    }
    this.obj.position.set(x, y, z);
    this.obj.rotation.y = heading;
  }

  /** next: the one to drive through now; later rings are dimmer. */
  setState(state: 'next' | 'later' | 'done', t: number): void {
    this.obj.visible = state !== 'done';
    this.mat.emissiveIntensity = state === 'next' ? 1.2 + Math.sin(t * 6) * 0.4 : 0.25;
    this.mat.opacity = state === 'next' ? 0.95 : 0.35;
  }
}

// ------------------------------------------------------------------ drones

/** One of MITRA's quad drones: hovering body, spinning rotors, a searchlight cone and its pool of light. */
export class Drone {
  readonly obj = new THREE.Group();
  private rotors: THREE.Object3D[] = [];
  private cone: THREE.Mesh;
  private pool: THREE.Mesh;
  private poolMat: THREE.MeshBasicMaterial;
  private coneMat: THREE.MeshBasicMaterial;
  private eye: THREE.MeshStandardMaterial;
  /** Ground position of the light pool (x, z). */
  readonly ground = new THREE.Vector2();
  /** Detection radius on the ground. */
  readonly radius: number;
  height = 6;
  alarm = 0;
  /** Brightness of the red eye, 0..1 (cutscenes open it; 1 in play). */
  eyeScale = 1;

  constructor(radius = 3.4, searchlight = true) {
    this.radius = radius;
    const shell = std('#e8eaee', { metalness: 0.3, roughness: 0.35 });
    const dark = std('#24272c', { metalness: 0.5, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.6), shell);
    this.obj.add(body);
    for (let i = 0; i < 4; i += 1) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.07), dark);
      arm.position.set(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36);
      arm.rotation.y = -a;
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.01, 0.05), dark);
      rotor.position.set(Math.cos(a) * 0.62, 0.09, Math.sin(a) * 0.62);
      this.obj.add(arm, rotor);
      this.rotors.push(rotor);
    }
    this.eye = new THREE.MeshStandardMaterial({ color: '#300', emissive: '#ff2a3a', emissiveIntensity: 2 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), this.eye);
    eye.position.set(0, -0.1, 0.25);
    this.obj.add(eye);
    this.coneMat = new THREE.MeshBasicMaterial({ color: '#cfe8ff', transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    this.cone = new THREE.Mesh(new THREE.ConeGeometry(radius, 1, 24, 1, true).translate(0, -0.5, 0), this.coneMat);
    this.cone.visible = searchlight;
    this.obj.add(this.cone);
    this.poolMat = new THREE.MeshBasicMaterial({ color: '#dff0ff', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(radius, 32).rotateX(-Math.PI / 2), this.poolMat);
    this.pool.renderOrder = 4;
    this.pool.visible = searchlight;
  }

  /** The pool of light lives in world space (added to the same parent as the drone). */
  get light(): THREE.Mesh {
    return this.pool;
  }

  /** Places the drone over (x, z) with ground height gy; the beam reaches the ground. */
  place(x: number, z: number, gy: number, heading: number, t: number): void {
    const bob = Math.sin(t * 2.1 + x * 0.1) * 0.15;
    this.obj.position.set(x, gy + this.height + bob, z);
    this.obj.rotation.set(Math.sin(t * 1.3) * 0.05, heading, Math.cos(t * 1.1) * 0.05);
    // Indexed loop: a for…of here would make an iterator object every frame for every drone.
    for (let i = 0; i < this.rotors.length; i += 1) this.rotors[i].rotation.y = t * 40;
    this.cone.scale.set(1, this.height + bob, 1);
    this.pool.position.set(x, gy + 0.08, z);
    this.ground.set(x, z);
    const a = this.alarm;
    this.poolMat.color.setRGB(0.87 + 0.13 * a, 0.94 - 0.6 * a, 1 - 0.75 * a);
    this.poolMat.opacity = 0.3 + a * 0.25;
    this.coneMat.opacity = 0.08 + a * 0.12;
    this.eye.emissiveIntensity = (1.5 + a * 3) * this.eyeScale;
  }
}

// ------------------------------------------------------------------ bonus coins

const coinGeo = new THREE.CylinderGeometry(0.28, 0.28, 0.06, 20).rotateX(Math.PI / 2);
const coinMat = new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#c98a10', emissiveIntensity: 0.8, roughness: 0.25, metalness: 0.8 });

/** A spinning gold coin (bonus pick-up around objectives). */
export function coinModel(): THREE.Mesh {
  const m = new THREE.Mesh(coinGeo, coinMat);
  m.castShadow = true;
  return m;
}

// ------------------------------------------------------------------ memory shards

const shardGeo = new THREE.OctahedronGeometry(0.32, 0).scale(0.7, 1.3, 0.7);
const shardMat = new THREE.MeshStandardMaterial({ color: '#7fe8ff', emissive: '#29c6ff', emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92 });

export function shardModel(): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(shardGeo, shardMat);
  m.position.y = 1.1;
  m.name = 'spin';
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.55, 24), new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(m, ring);
  return g;
}
