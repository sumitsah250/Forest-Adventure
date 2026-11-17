// Cheap cinematic effects for Campus Quest:
//  - Rain: streaks in a box that travels with the camera (one draw call).
//  - Sparks: an additive particle pool for Kalki's drift sparks, boost embers and fireworks.
//  - Lightning: timed flashes with thunder, during the monsoon storm.

import * as THREE from 'three';

// ------------------------------------------------------------------ rain

export class Rain {
  readonly lines: THREE.LineSegments;
  private pos: Float32Array;
  private n: number;
  private mat: THREE.LineBasicMaterial;
  private readonly box = 36;
  private readonly top = 22;
  /** 0 = dry, 1 = downpour. */
  level = 0;
  private shown = 0;

  constructor(count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 6);
    for (let i = 0; i < count; i += 1) this.respawn(i, new THREE.Vector3(), Math.random() * this.top);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: '#b9c9e6', transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
    this.lines.name = 'rain';
  }

  private respawn(i: number, c: THREE.Vector3, y: number): void {
    const x = c.x + (Math.random() - 0.5) * this.box * 2;
    const z = c.z + (Math.random() - 0.5) * this.box * 2;
    const h = c.y + y;
    this.pos.set([x, h, z, x + 0.06, h + 0.7, z + 0.03], i * 6);
  }

  update(dt: number, cam: THREE.Vector3): void {
    this.shown = THREE.MathUtils.damp(this.shown, this.level, 1.2, dt);
    this.mat.opacity = 0.38 * this.shown;
    this.lines.visible = this.shown > 0.02;
    if (!this.lines.visible) return;
    // Only part of the pool falls in a drizzle.
    const active = Math.floor(this.n * Math.min(1, this.shown));
    const fall = 26 * dt;
    for (let i = 0; i < this.n; i += 1) {
      const k = i * 6;
      if (i >= active) {
        this.pos[k + 1] = this.pos[k + 4] = -9999;
        continue;
      }
      this.pos[k + 1] -= fall;
      this.pos[k + 4] -= fall;
      this.pos[k] += fall * 0.05;
      this.pos[k + 3] += fall * 0.05;
      const dx = this.pos[k] - cam.x;
      const dz = this.pos[k + 2] - cam.z;
      if (this.pos[k + 1] < cam.y - 8 || Math.abs(dx) > this.box || Math.abs(dz) > this.box) this.respawn(i, cam, 4 + Math.random() * this.top);
    }
    (this.lines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ sparks

function dot(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

/** Additive glowing particles with gravity and drag. */
export class Sparks {
  readonly points: THREE.Points;
  private n: number;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private grav: Float32Array;
  private base: Float32Array;
  private next = 0;
  private live = 0;

  constructor(n: number, size = 0.35) {
    this.n = n;
    this.pos = new Float32Array(n * 3).fill(-9999);
    this.col = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.max = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.base = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({ size, map: dot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, life: number, gravity = 9): void {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.base.set([color.r, color.g, color.b], i * 3);
    this.life[i] = life;
    this.max[i] = life;
    this.grav[i] = gravity;
    this.live = 1.5;
  }

  /** A firework: a ring burst of one colour at a point in the sky. */
  burst(p: THREE.Vector3, color: THREE.Color, count = 70, speed = 11): void {
    const v = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.75 + Math.random() * 0.3));
      this.emit(p, v, color, 1.4 + Math.random() * 0.8, 3.5);
    }
  }

  update(dt: number): void {
    if (this.live <= 0) return;
    let any = false;
    for (let i = 0; i < this.n; i += 1) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const k = i * 3;
      this.vel[k + 1] -= this.grav[i] * dt;
      const drag = Math.exp(-1.6 * dt);
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const f = Math.max(0, this.life[i] / this.max[i]);
      this.col[k] = this.base[k] * f;
      this.col[k + 1] = this.base[k + 1] * f;
      this.col[k + 2] = this.base[k + 2] * f;
      if (this.life[i] <= 0) this.pos[k + 1] = -9999;
    }
    if (!any) this.live -= dt;
    (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ------------------------------------------------------------------ fireflies

/**
 * Fireflies over the grass on dark nights: a box of glowing points that wraps around the
 * player. All motion is in the vertex shader (one draw call, no per-frame buffer upload);
 * the CPU only writes three uniforms.
 */
export class Fireflies {
  readonly points: THREE.Points;
  private u = { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uAmount: { value: 0 }, uScale: { value: 1 } };
  /** 0..1 how many are out (fades them in and out). */
  amount = 0;
  private shown = 0;

  constructor(n: number, range = 18) {
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    const g = new THREE.BufferGeometry();
    // Position is unused (the shader places them); it only sizes the draw.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    const m = new THREE.ShaderMaterial({
      uniforms: { ...this.u, uRange: { value: range } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime, uRange, uAmount, uScale;
        uniform vec3 uCenter;
        varying float vA;
        void main() {
          vec3 p = vec3( seed.x, 0.0, seed.y ) * uRange * 2.0;
          p.x += sin( uTime * ( 0.25 + seed.z * 0.3 ) + seed.w * 6.28 ) * 2.5;
          p.z += cos( uTime * ( 0.2 + seed.w * 0.3 ) + seed.z * 6.28 ) * 2.5;
          // Wrap into a box centred on the player.
          p.xz = mod( p.xz - uCenter.xz + uRange, uRange * 2.0 ) + uCenter.xz - uRange;
          p.y = uCenter.y + 0.3 + seed.z * 2.6 + sin( uTime * ( 0.6 + seed.x ) + seed.y * 9.0 ) * 0.35;
          vec4 mv = modelViewMatrix * vec4( p, 1.0 );
          gl_Position = projectionMatrix * mv;
          float blink = 0.15 + 0.85 * smoothstep( -0.3, 1.0, sin( uTime * ( 1.1 + seed.w * 1.7 ) + seed.x * 30.0 ) );
          // Fewer as amount falls (each one has its own threshold), fading out at the box edge.
          float edge = 1.0 - smoothstep( uRange * 0.7, uRange, length( p.xz - uCenter.xz ) );
          vA = blink * edge * step( seed.y, uAmount );
          gl_PointSize = min( 26.0, ( 9.0 + seed.z * 6.0 ) * uScale * 9.0 / max( 1.0, -mv.z ) ) * vA;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = length( d );
          float a = smoothstep( 0.5, 0.0, r );
          gl_FragColor = vec4( vec3( 0.78, 1.0, 0.42 ) * ( a * a + smoothstep( 0.12, 0.0, r ) ) * vA, 1.0 );
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
  }

  update(dt: number, t: number, center: THREE.Vector3, pixelScale: number): void {
    this.shown += (this.amount - this.shown) * Math.min(1, dt * 0.8);
    this.points.visible = this.shown > 0.02;
    if (!this.points.visible) return;
    this.u.uTime.value = t;
    this.u.uCenter.value.copy(center);
    this.u.uAmount.value = this.shown;
    this.u.uScale.value = pixelScale;
  }
}

// ------------------------------------------------------------------ lightning

/** Lightning during a storm: returns a flash brightness (0..1) each frame and fires thunder after a delay. */
export class Lightning {
  private next = 6 + Math.random() * 8;
  private flash = 0;
  private flicker = 0;
  private thunderAt = -1;
  enabled = false;
  onThunder: (() => void) | null = null;
  onStrike: (() => void) | null = null;

  update(dt: number): number {
    if (this.thunderAt >= 0) {
      this.thunderAt -= dt;
      if (this.thunderAt < 0) this.onThunder?.();
    }
    if (this.enabled) {
      this.next -= dt;
      if (this.next <= 0) this.strike();
    }
    this.flicker -= dt;
    // Two or three quick pulses.
    if (this.flicker > 0) this.flash = Math.max(this.flash, Math.sin(this.flicker * 40) > 0.2 ? 1 : 0.35);
    this.flash = Math.max(0, this.flash - dt * 5);
    return this.flash;
  }

  strike(): void {
    this.next = 9 + Math.random() * 14;
    this.flicker = 0.32;
    this.flash = 1;
    this.thunderAt = 0.4 + Math.random() * 1.6;
    this.onStrike?.();
  }
}
