// Wheel spray: dust on dry gravel, clods on mud, splashes in water. A small pool
// of soft particles thrown up behind the tyres, coloured by surface.

import * as THREE from 'three';

const N = 220;

function softDot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class WheelSpray {
  readonly points: THREE.Points;
  private pos = new Float32Array(N * 3);
  private col = new Float32Array(N * 4);
  private maxLife = new Float32Array(N);
  private alpha = new Float32Array(N);
  private vel = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private next = 0;
  private acc = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    // Unlit particles: colours are pre-darkened to sit in shaded forest light.
    const m = new THREE.PointsMaterial({ size: 0.85, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, opacity: 1, sizeAttenuation: true });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.name = 'wheel-spray';
    for (let i = 0; i < N; i += 1) this.pos[i * 3 + 1] = -1000;
  }

  /** Emit from a contact point; rate scales with speed. */
  emit(dt: number, at: THREE.Vector3, back: THREE.Vector3, speed: number, surface: string): void {
    const sp = Math.abs(speed);
    if (sp < 3 || surface === 'rock') return;
    const water = surface === 'water';
    const mud = surface === 'mud';
    const rate = Math.min(60, sp * (water ? 7 : mud ? 3.5 : 2.2));
    this.acc += rate * dt;
    while (this.acc > 1) {
      this.acc -= 1;
      const i = this.next;
      this.next = (this.next + 1) % N;
      this.pos[i * 3] = at.x + (Math.random() - 0.5) * 0.3;
      this.pos[i * 3 + 1] = at.y + 0.1;
      this.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.3;
      const up = water ? 2.5 + Math.random() * 2 : mud ? 1.5 + Math.random() * 1.5 : 0.4 + Math.random() * 0.8;
      const k = Math.min(1, sp / 15) * (water ? 0.35 : 0.5);
      this.vel[i * 3] = back.x * sp * k + (Math.random() - 0.5) * 1.5;
      this.vel[i * 3 + 1] = up;
      this.vel[i * 3 + 2] = back.z * sp * k + (Math.random() - 0.5) * 1.5;
      this.life[i] = water ? 0.7 : mud ? 0.9 : 1.6;
      this.maxLife[i] = this.life[i];
      const c = water ? [0.55, 0.6, 0.6] : mud ? [0.13, 0.1, 0.07] : surface === 'gravel' ? [0.3, 0.27, 0.22] : [0.22, 0.18, 0.13];
      this.alpha[i] = water ? 0.55 : mud ? 0.8 : 0.28;
      this.col.set([c[0], c[1], c[2], this.alpha[i]], i * 4);
    }
  }

  update(dt: number): void {
    for (let i = 0; i < N; i += 1) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const heavy = this.alpha[i] > 0.5;
      // Fade out over the particle's life.
      this.col[i * 4 + 3] = this.alpha[i] * Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6);
      this.vel[i * 3 + 1] -= (heavy ? 9 : 0.6) * dt;
      const drag = heavy ? 0.98 : 0.94;
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -1000;
    }
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}
