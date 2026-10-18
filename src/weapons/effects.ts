// Firing feedback: muzzle flashes (with one shared flash light), faint tracer
// streaks, pooled impact particles per surface (dust, bark splinters, sparks,
// water, cloth puffs - no gore), bullet-hole decals and ejected brass that
// bounces on the ground. Everything is pooled; nothing allocates per shot.

import * as THREE from 'three';
import type { TerrainData } from '../world/terrain.ts';
import type { Surface } from './combat.ts';

function spriteTexture(draw: (ctx: CanvasRenderingContext2D, s: number) => void, size = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const FLASH_TEX = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,250,225,1)');
  g.addColorStop(0.18, 'rgba(255,214,140,0.95)');
  g.addColorStop(0.45, 'rgba(255,140,40,0.35)');
  g.addColorStop(1, 'rgba(255,90,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Spiky star petals.
  ctx.globalCompositeOperation = 'lighter';
  ctx.translate(s / 2, s / 2);
  for (let i = 0; i < 6; i += 1) {
    ctx.rotate(Math.PI / 3 + (i % 2) * 0.2);
    const lg = ctx.createLinearGradient(0, 0, s / 2, 0);
    lg.addColorStop(0, 'rgba(255,230,170,0.9)');
    lg.addColorStop(1, 'rgba(255,150,50,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.03);
    ctx.lineTo(s / 2, 0);
    ctx.lineTo(0, s * 0.03);
    ctx.fill();
  }
}, 128);

const SOFT_TEX = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const HOLE_TEX = () => spriteTexture((ctx, s) => {
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(8,6,5,1)');
  g.addColorStop(0.28, 'rgba(15,12,10,0.95)');
  g.addColorStop(0.5, 'rgba(40,32,26,0.45)');
  g.addColorStop(1, 'rgba(40,32,26,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
});

const PARTICLES = 600;

const PARTICLE_VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (420.0 / max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */ `
uniform sampler2D map;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(vColor, t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

class ParticlePool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private size0: Float32Array;
  private alpha: Float32Array;
  private color: Float32Array;
  private drag: Float32Array;
  private grav: Float32Array;
  private next = 0;
  private live = 0;

  constructor(additive: boolean, tex: THREE.Texture) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(PARTICLES * 3);
    this.vel = new Float32Array(PARTICLES * 3);
    this.life = new Float32Array(PARTICLES);
    this.maxLife = new Float32Array(PARTICLES);
    this.size = new Float32Array(PARTICLES);
    this.size0 = new Float32Array(PARTICLES);
    this.alpha = new Float32Array(PARTICLES);
    this.color = new Float32Array(PARTICLES * 3);
    this.drag = new Float32Array(PARTICLES);
    this.grav = new Float32Array(PARTICLES);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const m = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex } },
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, size: number, color: THREE.Color, alpha: number, drag: number, gravity: number): void {
    const i = this.next;
    this.next = (this.next + 1) % PARTICLES;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size[i] = size;
    this.alpha[i] = alpha;
    this.color.set([color.r, color.g, color.b], i * 3);
    this.drag[i] = drag;
    this.grav[i] = gravity;
    this.live = Math.max(this.live, 1);
  }

  update(dt: number): void {
    if (!this.live) return;
    let any = 0;
    for (let i = 0; i < PARTICLES; i += 1) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      any += 1;
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] *= t > 0 ? 1 : 0;
      // Dust grows as it fades; sparks shrink.
      this.size[i] = this.size0[i] * (this.grav[i] > 5 ? 0.4 + 0.6 * t : 1 + (1 - t) * 1.8);
      this.alpha[i] = Math.min(this.alpha[i], t * 1.4);
    }
    this.live = any;
    const g = this.points.geometry;
    (g.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aAlpha') as THREE.BufferAttribute).needsUpdate = true;
    (g.getAttribute('aColor') as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface Casing {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Euler;
  spin: THREE.Vector3;
  life: number;
  resting: boolean;
  scale: number;
}

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
}

export class Effects {
  readonly group = new THREE.Group();
  private terrain: TerrainData;
  private dust: ParticlePool;
  private sparks: ParticlePool;
  private flash: THREE.Mesh;
  private flashSide: THREE.Mesh;
  private flashT = 0;
  /** One light shared by every muzzle flash (constant light count). */
  readonly flashLight = new THREE.PointLight(0xffc27a, 0, 9, 2);
  private decals: THREE.Mesh[] = [];
  private decalNext = 0;
  private casings: Casing[] = [];
  private casingMesh: THREE.InstancedMesh;
  private casingNext = 0;
  private tracers: Tracer[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  onCasingLand: ((p: THREE.Vector3) => void) | null = null;

  constructor(terrain: TerrainData) {
    this.terrain = terrain;
    this.group.name = 'weapon-effects';
    const soft = SOFT_TEX();
    this.dust = new ParticlePool(false, soft);
    this.sparks = new ParticlePool(true, soft);
    this.group.add(this.dust.points, this.sparks.points);
    const flashMat = new THREE.MeshBasicMaterial({ map: FLASH_TEX(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
    this.flashSide = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.45), flashMat);
    this.flash.visible = false;
    this.flashSide.visible = false;
    this.flash.renderOrder = 6;
    this.flashSide.renderOrder = 6;
    this.group.add(this.flash, this.flashSide, this.flashLight);
    // Bullet-hole decals.
    const holeMat = new THREE.MeshBasicMaterial({ map: HOLE_TEX(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    for (let i = 0; i < 90; i += 1) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), holeMat);
      d.visible = false;
      d.renderOrder = 3;
      this.decals.push(d);
      this.group.add(d);
    }
    // Brass casings (instanced).
    const cg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.03, 8);
    cg.rotateX(Math.PI / 2);
    const brass = new THREE.MeshStandardMaterial({ color: '#b8904f', metalness: 0.95, roughness: 0.3 });
    this.casingMesh = new THREE.InstancedMesh(cg, brass, 40);
    this.casingMesh.count = 0;
    this.casingMesh.frustumCulled = false;
    this.casingMesh.castShadow = false;
    this.group.add(this.casingMesh);
    for (let i = 0; i < 40; i += 1) this.casings.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), life: 0, resting: false, scale: 1 });
    // Tracer streaks.
    const trMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    for (let i = 0; i < 12; i += 1) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), trMat);
      mesh.visible = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 0.05 });
    }
  }

  /** Muzzle flash at `pos` along `dir`; size scales with the cartridge. */
  muzzleFlash(pos: THREE.Vector3, dir: THREE.Vector3, size: number, camera: THREE.Camera): void {
    this.flashT = 0.045;
    const s = size * (0.8 + Math.random() * 0.45);
    this.flash.position.copy(pos).addScaledVector(dir, s * 0.12);
    this.flash.quaternion.copy(camera.quaternion);
    this.flash.rotateZ(Math.random() * Math.PI);
    this.flash.scale.setScalar(s * 0.55);
    // Side flame along the bore so the flash has length when seen from the side.
    this.flashSide.position.copy(pos).addScaledVector(dir, s * 0.32);
    this.q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    this.flashSide.quaternion.copy(this.q);
    this.flashSide.scale.set(s * 0.75, s * 0.3, 1);
    this.flash.visible = true;
    this.flashSide.visible = true;
    this.flashLight.position.copy(pos).addScaledVector(dir, 0.1);
    this.flashLight.intensity = 6 * size;
    // A breath of smoke from the muzzle.
    for (let i = 0; i < 3; i += 1) {
      const v = dir.clone().multiplyScalar(0.6 + Math.random()).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.3));
      this.dust.emit(pos, v, 0.7 + Math.random() * 0.5, 0.05 + size * 0.04, new THREE.Color(0.75, 0.74, 0.72), 0.22, 2.5, -0.15);
    }
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    const tr = this.tracers.find((t) => t.t >= 1) ?? this.tracers[0];
    tr.from.copy(from);
    tr.to.copy(to);
    tr.t = 0;
    tr.dur = Math.min(0.12, 0.03 + from.distanceTo(to) / 900);
    tr.mesh.visible = true;
  }

  impact(p: THREE.Vector3, n: THREE.Vector3, surface: Surface, strength = 1, decal = true): void {
    const up = n.clone();
    const rnd = () => new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    const puff = (count: number, color: THREE.Color, speed: number, size: number, life: number, alpha = 0.5) => {
      for (let i = 0; i < count; i += 1) {
        const v = up.clone().multiplyScalar(speed * (0.4 + Math.random())).add(rnd().multiplyScalar(speed * 0.8));
        this.dust.emit(p.clone().addScaledVector(n, 0.03), v, life * (0.6 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6), color, alpha, 3.5, 0.6);
      }
    };
    const chips = (count: number, color: THREE.Color, speed: number) => {
      for (let i = 0; i < count; i += 1) {
        const v = up.clone().multiplyScalar(speed * (0.6 + Math.random())).add(rnd().multiplyScalar(speed));
        this.dust.emit(p.clone().addScaledVector(n, 0.02), v, 0.6 + Math.random() * 0.5, 0.02 + Math.random() * 0.015, color, 0.95, 0.6, 9.8);
      }
    };
    const sparks = (count: number) => {
      for (let i = 0; i < count; i += 1) {
        const v = up.clone().multiplyScalar(2 + Math.random() * 3).add(rnd().multiplyScalar(4));
        this.sparks.emit(p.clone().addScaledVector(n, 0.02), v, 0.15 + Math.random() * 0.2, 0.025, new THREE.Color(1, 0.75, 0.4), 1, 1.5, 9.8);
      }
    };
    const k = strength;
    switch (surface) {
      case 'wood':
        puff(4 * k, new THREE.Color(0.55, 0.45, 0.33), 0.8, 0.12, 0.8);
        chips(6 * k, new THREE.Color(0.75, 0.6, 0.42), 2.2);
        break;
      case 'rock':
      case 'gravel':
        puff(5 * k, new THREE.Color(0.62, 0.6, 0.56), 1, 0.13, 0.9);
        chips(4 * k, new THREE.Color(0.5, 0.48, 0.45), 2.6);
        sparks(3);
        break;
      case 'metal':
      case 'steel':
        sparks(8 * k);
        puff(2, new THREE.Color(0.5, 0.5, 0.5), 0.6, 0.08, 0.5, 0.35);
        break;
      case 'water':
        for (let i = 0; i < 10 * k; i += 1) {
          const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.2 + Math.random() * 2.2, (Math.random() - 0.5) * 1.2);
          this.dust.emit(p, v, 0.6 + Math.random() * 0.3, 0.05 + Math.random() * 0.04, new THREE.Color(0.8, 0.85, 0.88), 0.6, 0.8, 9.8);
        }
        break;
      case 'cloth':
        puff(3, new THREE.Color(0.55, 0.52, 0.46), 0.6, 0.1, 0.5, 0.4);
        break;
      case 'paper':
        chips(5, new THREE.Color(0.9, 0.88, 0.8), 1.6);
        break;
      case 'mud':
        puff(3 * k, new THREE.Color(0.3, 0.24, 0.17), 0.8, 0.12, 0.8);
        chips(6 * k, new THREE.Color(0.25, 0.2, 0.14), 2.2);
        break;
      default:
        puff(6 * k, new THREE.Color(0.48, 0.4, 0.3), 1, 0.15, 1.1);
        chips(4 * k, new THREE.Color(0.35, 0.28, 0.2), 2);
    }
    if (decal && surface !== 'water' && surface !== 'cloth' && surface !== 'paper') this.decal(p, n, surface === 'steel' || surface === 'metal' ? 0.03 : 0.05);
  }

  decal(p: THREE.Vector3, n: THREE.Vector3, size: number): void {
    const d = this.decals[this.decalNext];
    this.decalNext = (this.decalNext + 1) % this.decals.length;
    d.position.copy(p).addScaledVector(n, 0.004);
    d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    d.rotateZ(Math.random() * Math.PI * 2);
    d.scale.setScalar(size * (0.8 + Math.random() * 0.4));
    d.visible = true;
  }

  /** Spent case thrown to the shooter's right and slightly back. */
  eject(pos: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, back: THREE.Vector3, scale = 1): void {
    const c = this.casings[this.casingNext];
    this.casingNext = (this.casingNext + 1) % this.casings.length;
    c.pos.copy(pos);
    c.vel.copy(right).multiplyScalar(2.2 + Math.random() * 1.2).addScaledVector(up, 1.4 + Math.random()).addScaledVector(back, 0.5 + Math.random() * 0.5);
    c.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    c.spin.set((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30);
    c.life = 9;
    c.resting = false;
    c.scale = scale;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.dust.update(dt);
    this.sparks.update(dt);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flash.visible = false;
        this.flashSide.visible = false;
      }
    }
    this.flashLight.intensity = Math.max(0, this.flashLight.intensity - dt * 160);
    for (const tr of this.tracers) {
      if (tr.t >= 1) continue;
      tr.t += dt / tr.dur;
      if (tr.t >= 1) {
        tr.mesh.visible = false;
        continue;
      }
      // A short streak travelling from muzzle to impact, facing the camera.
      const head = tr.from.clone().lerp(tr.to, Math.min(1, tr.t + 0.25));
      const tail = tr.from.clone().lerp(tr.to, Math.max(0, tr.t - 0.05));
      const mid = head.clone().add(tail).multiplyScalar(0.5);
      const axis = head.clone().sub(tail);
      const len = axis.length();
      tr.mesh.position.copy(mid);
      const toCam = camera.position.clone().sub(mid).normalize();
      const xAxis = axis.normalize();
      const yAxis = new THREE.Vector3().crossVectors(toCam, xAxis).normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, yAxis);
      tr.mesh.quaternion.setFromRotationMatrix(this.m.makeBasis(xAxis, yAxis, zAxis));
      tr.mesh.scale.set(len, 0.012, 1);
    }
    let n = 0;
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      if (!c.resting) {
        c.vel.y -= 9.8 * dt;
        c.pos.addScaledVector(c.vel, dt);
        c.rot.x += c.spin.x * dt;
        c.rot.y += c.spin.y * dt;
        c.rot.z += c.spin.z * dt;
        const g = this.terrain.heightAt(c.pos.x, c.pos.z) + 0.006;
        if (c.pos.y < g) {
          c.pos.y = g;
          if (Math.abs(c.vel.y) > 1.2) {
            this.onCasingLand?.(c.pos);
            c.vel.y *= -0.3;
            c.vel.x *= 0.4;
            c.vel.z *= 0.4;
            c.spin.multiplyScalar(0.5);
          } else {
            c.resting = true;
            c.rot.x = Math.PI / 2;
            c.rot.z = 0;
          }
        }
      }
      this.q.setFromEuler(c.rot);
      this.m.compose(c.pos, this.q, new THREE.Vector3(c.scale, c.scale, c.scale));
      this.casingMesh.setMatrixAt(n, this.m);
      n += 1;
    }
    this.casingMesh.count = n;
    this.casingMesh.instanceMatrix.needsUpdate = true;
  }
}
