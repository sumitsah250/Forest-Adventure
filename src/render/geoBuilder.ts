// Small mesh builder used for procedural trees, rocks, structures and vehicles.

import * as THREE from 'three';
import type { AtlasRegion } from './foliageAtlas.ts';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _t = new THREE.Vector3();
const _b = new THREE.Vector3();

export class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  wind: number[] = [];
  idx: number[] = [];

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, ao = 1, wind = 0, tint?: THREE.Color): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    if (tint) this.col.push(tint.r * ao, tint.g * ao, tint.b * ao);
    else this.col.push(ao, ao, ao);
    this.wind.push(wind);
    return this.vertexCount - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  append(o: GeoBuilder): void {
    const base = this.vertexCount;
    this.pos.push(...o.pos);
    this.nor.push(...o.nor);
    this.uv.push(...o.uv);
    this.col.push(...o.col);
    this.wind.push(...o.wind);
    for (const i of o.idx) this.idx.push(i + base);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aWind', new THREE.Float32BufferAttribute(this.wind, 1));
    g.setIndex(this.vertexCount > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export interface TubeOptions {
  radial: number;
  /** Metres of circumference per texture repeat. */
  uMetres: number;
  /** Metres of length per texture repeat. */
  vMetres: number;
  ao?: (t: number) => number;
  wind?: (t: number) => number;
  /** Per-ring radial wobble (root flare lobes etc). */
  radiusFn?: (t: number, angle: number, r: number) => number;
  capEnd?: boolean;
  tint?: THREE.Color;
}

/** Tapered tube through points with given radii (parallel-transport frames). */
export function tube(b: GeoBuilder, pts: THREE.Vector3[], radii: number[], o: TubeOptions): void {
  const n = pts.length;
  const ring = o.radial + 1;
  const start = b.vertexCount;
  let len = 0;
  let prevNormal = new THREE.Vector3();
  const maxR = Math.max(...radii);
  const uRepeats = Math.max(1, Math.round((2 * Math.PI * maxR) / o.uMetres));
  for (let i = 0; i < n; i += 1) {
    const p = pts[i];
    if (i > 0) len += p.distanceTo(pts[i - 1]);
    const a = pts[Math.max(0, i - 1)];
    const c = pts[Math.min(n - 1, i + 1)];
    _t.subVectors(c, a).normalize();
    if (i === 0) {
      // Any vector perpendicular to the tangent.
      prevNormal.set(0, 0, 1);
      if (Math.abs(_t.z) > 0.9) prevNormal.set(1, 0, 0);
      prevNormal.sub(_t.clone().multiplyScalar(prevNormal.dot(_t))).normalize();
    } else {
      prevNormal = prevNormal.sub(_t.clone().multiplyScalar(prevNormal.dot(_t))).normalize();
    }
    const nrm = prevNormal.clone();
    _b.crossVectors(_t, nrm).normalize();
    const t = i / (n - 1);
    const ao = o.ao ? o.ao(t) : 1;
    const wind = o.wind ? o.wind(t) : 0;
    for (let k = 0; k < ring; k += 1) {
      const ang = (k / o.radial) * Math.PI * 2;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const r = o.radiusFn ? o.radiusFn(t, ang, radii[i]) : radii[i];
      _n.copy(nrm).multiplyScalar(cs).addScaledVector(_b, sn);
      _v.copy(p).addScaledVector(_n, r);
      b.vert(_v, _n, (k / o.radial) * uRepeats, len / o.vMetres, ao, wind, o.tint);
    }
  }
  for (let i = 0; i < n - 1; i += 1) {
    for (let k = 0; k < o.radial; k += 1) {
      const a = start + i * ring + k;
      const c = a + ring;
      b.quad(a, a + 1, c + 1, c);
    }
  }
  if (o.capEnd) {
    const last = pts[n - 1];
    _t.subVectors(last, pts[n - 2]).normalize();
    const centre = b.vert(last, _t, 0.5, len / o.vMetres, o.ao ? o.ao(1) : 1, o.wind ? o.wind(1) : 0, o.tint);
    const base = start + (n - 1) * ring;
    for (let k = 0; k < o.radial; k += 1) b.tri(base + k, base + k + 1, centre);
  }
}

export interface CardOptions {
  length: number;
  width: number;
  segments: number;
  /** Vertical sag at the tip as a fraction of length. */
  droop: number;
  /** Upward curl near the tip as a fraction of length. */
  curl: number;
  region: AtlasRegion;
  aoBase: number;
  aoTip: number;
  windBase: number;
  windTip: number;
  /** Shape of the width along the card (0 = base, 1 = tip). */
  widthFn?: (t: number) => number;
  /** Returns the shading normal for a vertex (spherical crown normals etc.). */
  normalFn?: (p: THREE.Vector3, cardNormal: THREE.Vector3) => THREE.Vector3;
  tint?: THREE.Color;
}

const _side = new THREE.Vector3();
const _cn = new THREE.Vector3();
const _c = new THREE.Vector3();
const _l = new THREE.Vector3();
const _r = new THREE.Vector3();

/** A foliage card: a quad strip from origin along dir, spanning `side`. */
export function card(b: GeoBuilder, origin: THREE.Vector3, dir: THREE.Vector3, side: THREE.Vector3, o: CardOptions): void {
  _side.copy(side).normalize();
  _cn.crossVectors(_side, dir).normalize();
  if (_cn.y < 0) _cn.negate();
  const start = b.vertexCount;
  const segs = o.segments;
  for (let j = 0; j <= segs; j += 1) {
    const t = j / segs;
    const w = o.width * (o.widthFn ? o.widthFn(t) : 0.4 + 0.6 * Math.min(1, t * 2.2));
    _c.copy(origin).addScaledVector(dir, o.length * t);
    _c.y += -o.droop * o.length * t * t + o.curl * o.length * Math.max(0, t - 0.55) ** 2 * 4;
    _l.copy(_c).addScaledVector(_side, -w / 2);
    _r.copy(_c).addScaledVector(_side, w / 2);
    const ao = o.aoBase + (o.aoTip - o.aoBase) * t;
    const wind = o.windBase + (o.windTip - o.windBase) * t;
    const v = o.region.v0 + (o.region.v1 - o.region.v0) * t;
    const nl = o.normalFn ? o.normalFn(_l, _cn) : _cn;
    b.vert(_l, nl, o.region.u0, v, ao, wind, o.tint);
    const nr = o.normalFn ? o.normalFn(_r, _cn) : _cn;
    b.vert(_r, nr, o.region.u1, v, ao, wind, o.tint);
  }
  for (let j = 0; j < segs; j += 1) {
    const a = start + j * 2;
    b.quad(a, a + 1, a + 3, a + 2);
  }
}
