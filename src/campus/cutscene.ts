// Cutscene player: runs a list of shots from data (story/v2/cutscenes.ts).
//
//   await cutscenes.play('C1');
//
// While one plays the letterbox is in, the HUD is hidden, input is locked (the game loop checks
// `playing`), and the camera belongs to the cutscene. When it ends, or is skipped by holding a
// key or a long press, the camera's position, rotation and field of view are put back exactly.
//
// Nothing here allocates per frame: every vector, the curve and the cue cursors are made once
// and reused. Camera points are resolved when a shot starts; a look-at target that is an
// entity is followed every frame through a resolver made at shot start.

import * as THREE from 'three';
import type { Anchor, CutEvent, CutsceneDef, Ease, ShotDef, Where } from './story.ts';

export interface CutsceneHost {
  /** Ground position of a named place. Returns its facing (radians; forward is (sin, cos)). */
  where(w: Where, out: THREE.Vector3): number;
  /**
   * A resolver for an entity ('player', 'kart', 'gate', 'npc:<id>'): called every frame it
   * writes the entity's position and returns its heading. null if there is no such entity.
   */
  entity(ref: string): ((out: THREE.Vector3) => number) | null;
  sound(name: string): void;
  /** A scripted event; `at` is the event's place when it has one. */
  event(e: CutEvent, at: THREE.Vector3 | null): void;
  subtitle(who: string | null, text: string): void;
  card(card: ShotDef['card'] | null): void;
  letterbox(on: boolean): void;
  /** Called once at the start and once at the end (HUD, touch controls, pointer lock). */
  begin(): void;
  end(): void;
  /** The player's field-of-view setting, for shots that do not set one. */
  baseFov(): number;
}

const EASE: Record<Ease, number> = { linear: 0, in: 1, out: 2, inOut: 3 };

/**
 * Easing by code. A plain switch, not a table of functions: a call through a table cannot be
 * inlined, and V8 then boxes the number it returns (a small allocation every frame).
 */
function ease(mode: number, t: number): number {
  switch (mode) {
    case 0: return t;
    case 1: return t * t * t;
    case 2: { const r = 1 - t; return 1 - r * r * r; }
    default: { if (t < 0.5) return 4 * t * t * t; const r = -2 * t + 2; return 1 - (r * r * r) / 2; }
  }
}

/** Seconds a key or finger must be held to skip. */
const HOLD = 0.8;
const SKIP_KEYS = ['KeyE', 'Space', 'Enter'];
const MAX_PATH = 5;
/** Arc-length samples per path, for even camera speed. */
const ARC = 96;

/**
 * A centripetal Catmull-Rom path through up to five points, evaluated by arc length.
 *
 * Not three's CatmullRomCurve3: that keeps its cubic coefficients in closure variables, and V8
 * boxes every number written to one, so each call allocates ~300 bytes (measured). Here all
 * coefficients and the arc-length table live in typed arrays filled once per shot; evaluating
 * a point reads numbers and allocates nothing.
 */
class CamPath {
  /** Per segment, per axis: c0..c3 (segment s, axis a at (s * 3 + a) * 4). */
  private c = new Float64Array((MAX_PATH - 1) * 3 * 4);
  /** Cumulative length at ARC + 1 evenly spaced parameter values. */
  private len = new Float64Array(ARC + 1);
  private segs = 0;
  private p0 = new THREE.Vector3();
  private p3 = new THREE.Vector3();

  /** Builds the path through pts[0..n-1] (n >= 2). */
  build(pts: THREE.Vector3[], n: number): void {
    this.segs = n - 1;
    for (let s = 0; s < this.segs; s += 1) {
      const p1 = pts[s];
      const p2 = pts[s + 1];
      // Ends: extrapolate a point past each end (as three does).
      const p0 = s > 0 ? pts[s - 1] : this.p0.subVectors(p1, p2).add(p1);
      const p3 = s + 2 < n ? pts[s + 2] : this.p3.subVectors(p2, p1).add(p2);
      let dt0 = Math.pow(p0.distanceToSquared(p1), 0.25);
      let dt1 = Math.pow(p1.distanceToSquared(p2), 0.25);
      let dt2 = Math.pow(p2.distanceToSquared(p3), 0.25);
      if (dt1 < 1e-4) dt1 = 1;
      if (dt0 < 1e-4) dt0 = dt1;
      if (dt2 < 1e-4) dt2 = dt1;
      this.axis(s, 0, p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
      this.axis(s, 1, p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
      this.axis(s, 2, p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
    }
    // Arc-length table.
    this.len[0] = 0;
    let px = this.x(0);
    let py = this.y(0);
    let pz = this.z(0);
    for (let i = 1; i <= ARC; i += 1) {
      const t = i / ARC;
      const x = this.x(t);
      const y = this.y(t);
      const z = this.z(t);
      this.len[i] = this.len[i - 1] + Math.hypot(x - px, y - py, z - pz);
      px = x;
      py = y;
      pz = z;
    }
  }

  /** Non-uniform Catmull-Rom as a cubic in [0, 1] (same maths as three's CubicPoly). */
  private axis(s: number, a: number, x0: number, x1: number, x2: number, x3: number, dt0: number, dt1: number, dt2: number): void {
    let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
    let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;
    t1 *= dt1;
    t2 *= dt1;
    const k = (s * 3 + a) * 4;
    this.c[k] = x1;
    this.c[k + 1] = t1;
    this.c[k + 2] = -3 * x1 + 3 * x2 - 2 * t1 - t2;
    this.c[k + 3] = 2 * x1 - 2 * x2 + t1 + t2;
  }

  private at(t: number, a: number): number {
    const f = Math.min(this.segs - 1e-9, Math.max(0, t * this.segs));
    const s = Math.floor(f);
    const w = f - s;
    const k = (s * 3 + a) * 4;
    const c = this.c;
    return c[k] + w * (c[k + 1] + w * (c[k + 2] + w * c[k + 3]));
  }

  private x(t: number): number {
    return this.at(t, 0);
  }

  private y(t: number): number {
    return this.at(t, 1);
  }

  private z(t: number): number {
    return this.at(t, 2);
  }

  /** The point a fraction `u` of the way along the path by distance. */
  pointAt(u: number, out: THREE.Vector3): THREE.Vector3 {
    const target = Math.min(1, Math.max(0, u)) * this.len[ARC];
    let lo = 0;
    let hi = ARC;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.len[mid] < target) lo = mid;
      else hi = mid;
    }
    const span = this.len[hi] - this.len[lo];
    const t = (lo + (span > 0 ? (target - this.len[lo]) / span : 0)) / ARC;
    // Evaluated here in one body (no helper calls): V8 boxes the numbers passed to and returned
    // from calls it does not inline, which would allocate every frame.
    const f = Math.min(this.segs - 1e-9, Math.max(0, t * this.segs));
    // `| 0`, not Math.floor: an integer index keeps the typed-array reads on V8's fast path.
    const seg = f | 0;
    const w = f - seg;
    const c = this.c;
    const k = seg * 12;
    out.x = c[k] + w * (c[k + 1] + w * (c[k + 2] + w * c[k + 3]));
    out.y = c[k + 4] + w * (c[k + 5] + w * (c[k + 6] + w * c[k + 7]));
    out.z = c[k + 8] + w * (c[k + 9] + w * (c[k + 10] + w * c[k + 11]));
    return out;
  }
}

export class Cutscenes {
  private defs: Partial<Record<string, CutsceneDef>>;
  private h: CutsceneHost;
  private def: CutsceneDef | null = null;
  private shot: ShotDef | null = null;
  private si = 0;
  private t = 0;
  private resolve: (() => void) | null = null;

  // Per-shot state, reused.
  private pts = Array.from({ length: MAX_PATH }, () => new THREE.Vector3());
  private curve = new CamPath();
  private lookA = new THREE.Vector3();
  private lookB = new THREE.Vector3();
  private look = new THREE.Vector3();
  private lookPan = false;
  private follow: ((out: THREE.Vector3) => number) | null = null;
  private followOff = new THREE.Vector3();
  private followLocal = false;
  private fov0 = 60;
  private fov1 = 60;
  private easeMode = EASE.inOut;
  private subI = 0;
  private sndI = 0;
  private evI = 0;
  private subEnd = -1;
  private evPos = new THREE.Vector3();

  // The gameplay camera, to put back.
  private savedPos = new THREE.Vector3();
  private savedQuat = new THREE.Quaternion();
  private savedFov = 60;
  private camera: THREE.PerspectiveCamera | null = null;

  // Hold to skip.
  private holdSince = -1;
  private skipEl: HTMLDivElement;

  constructor(defs: Partial<Record<string, CutsceneDef>>, host: CutsceneHost, root: HTMLElement) {
    this.defs = defs;
    this.h = host;
    // Cues are read with a cursor, so each list must be in time order.
    for (const d of Object.values(defs)) {
      for (const s of d?.shots ?? []) {
        s.subtitles?.sort((a, b) => a.at - b.at);
        s.sounds?.sort((a, b) => a.at - b.at);
        s.events?.sort((a, b) => a.at - b.at);
      }
    }
    this.skipEl = document.createElement('div');
    this.skipEl.className = 'cq-skip';
    this.skipEl.innerHTML = '<i></i><span>Hold <kbd>E</kbd> or press and hold to skip</span>';
    root.append(this.skipEl);
    const down = () => {
      if (this.def && this.holdSince < 0) {
        this.holdSince = performance.now();
        this.skipEl.classList.add('holding');
      }
    };
    const up = () => {
      this.holdSince = -1;
      this.skipEl.classList.remove('holding');
    };
    window.addEventListener('keydown', (e) => {
      if (!this.def || e.repeat || !SKIP_KEYS.includes(e.code)) return;
      e.preventDefault();
      down();
    });
    window.addEventListener('keyup', (e) => {
      if (SKIP_KEYS.includes(e.code)) up();
    });
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('blur', up);
  }

  get playing(): boolean {
    return this.def !== null;
  }

  /** Game speed while a shot asks for slow motion (1 otherwise). */
  get timeScale(): number {
    return this.shot?.timeScale ?? 1;
  }

  has(id: string): boolean {
    return !!this.defs[id];
  }

  /** Plays a cutscene. Resolves when it ends or is skipped; at once if there is no data for `id` yet. */
  play(id: string, camera: THREE.PerspectiveCamera): Promise<void> {
    const def = this.defs[id];
    if (!def || !def.shots.length) return Promise.resolve();
    if (this.def) this.finish();
    this.def = def;
    this.camera = camera;
    this.savedPos.copy(camera.position);
    this.savedQuat.copy(camera.quaternion);
    this.savedFov = camera.fov;
    this.holdSince = -1;
    this.h.begin();
    this.h.letterbox(true);
    this.skipEl.classList.add('on');
    this.startShot(0);
    return new Promise((r) => (this.resolve = r));
  }

  // ------------------------------------------------------------------ anchors

  /** Writes the world position of an anchor. */
  private place(a: Anchor, out: THREE.Vector3): void {
    const o = a.off;
    if ('where' in a) {
      const facing = this.h.where(a.where, out);
      if (o) this.offset(out, o[0], o[1], o[2], a.local ? facing : null);
      return;
    }
    const get = this.h.entity(a.entity);
    const heading = get ? get(out) : 0;
    if (!get) console.warn(`Campus Quest: cutscene entity "${a.entity}" not found`);
    if (o) this.offset(out, o[0], o[1], o[2], a.local ? heading : null);
  }

  /** Adds an offset: world axes (east, up, south), or with a heading (right, up, ahead). */
  private offset(out: THREE.Vector3, x: number, y: number, z: number, heading: number | null): void {
    if (heading === null) {
      out.set(out.x + x, out.y + y, out.z + z);
      return;
    }
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    // Ahead is (s, c); right of that is (-c, s).
    out.set(out.x - c * x + s * z, out.y + y, out.z + s * x + c * z);
  }

  // ------------------------------------------------------------------ shots

  private startShot(i: number): void {
    const s = this.def!.shots[i];
    this.si = i;
    this.shot = s;
    this.t = 0;
    this.subI = 0;
    this.sndI = 0;
    this.evI = 0;
    const n = Math.min(MAX_PATH, s.path.length);
    for (let k = 0; k < n; k += 1) this.place(s.path[k], this.pts[k]);
    // Curve and arc-length table, so the camera moves at an even speed (built once per shot).
    this.curve.build(this.pts, n);
    // Look-at: a pan between two points, a fixed point, or an entity that is followed.
    this.follow = null;
    this.lookPan = Array.isArray(s.look);
    if (Array.isArray(s.look)) {
      this.place(s.look[0], this.lookA);
      this.place(s.look[1], this.lookB);
    } else {
      this.place(s.look, this.lookA);
      if ('entity' in s.look) {
        this.follow = this.h.entity(s.look.entity);
        const o = s.look.off;
        this.followOff.set(o?.[0] ?? 0, o?.[1] ?? 0, o?.[2] ?? 0);
        this.followLocal = !!s.look.local;
      }
    }
    const base = this.h.baseFov();
    this.fov0 = Array.isArray(s.fov) ? s.fov[0] : s.fov ?? base;
    this.fov1 = Array.isArray(s.fov) ? s.fov[1] : s.fov ?? base;
    this.easeMode = EASE[s.ease ?? 'inOut'];
    this.h.card(s.card ?? null);
  }

  /** Fires the cues of the current shot up to time `t` (events only, when skipping). */
  private cues(t: number, eventsOnly: boolean): void {
    const s = this.shot!;
    if (s.events) {
      while (this.evI < s.events.length && s.events[this.evI].at <= t) {
        const e = s.events[this.evI++];
        if (e.place) this.place(e.place, this.evPos);
        this.h.event(e, e.place ? this.evPos : null);
      }
    }
    if (eventsOnly) return;
    if (s.sounds) while (this.sndI < s.sounds.length && s.sounds[this.sndI].at <= t) this.h.sound(s.sounds[this.sndI++].name);
    if (s.subtitles) {
      while (this.subI < s.subtitles.length && s.subtitles[this.subI].at <= t) {
        const sub = s.subtitles[this.subI++];
        this.h.subtitle(sub.who, sub.text);
        this.subEnd = sub.at + (sub.dur ?? 3);
      }
    }
    if (this.subEnd >= 0 && t >= this.subEnd) {
      this.h.subtitle(null, '');
      this.subEnd = -1;
    }
  }

  /** Every frame, with real (unscaled) seconds. Returns true while it owns the camera. */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (!this.def || !this.shot) return false;
    if (this.holdSince >= 0 && performance.now() - this.holdSince >= HOLD * 1000) {
      this.skip();
      return false;
    }
    this.t += dt;
    let s = this.shot;
    while (this.t >= s.dur) {
      // Shot over: fire what is left of it, then the next shot or the end.
      this.cues(s.dur, false);
      if (this.si + 1 >= this.def.shots.length) {
        this.finish();
        return false;
      }
      const carry = this.t - s.dur;
      // A subtitle still on screen stays for its remaining time in the next shot.
      const subLeft = this.subEnd >= 0 ? this.subEnd - s.dur : -1;
      this.startShot(this.si + 1);
      this.t = carry;
      this.subEnd = subLeft;
      s = this.shot!;
    }
    this.cues(this.t, false);
    const u = ease(this.easeMode, this.t / s.dur);
    this.curve.pointAt(u, camera.position);
    if (this.follow) {
      const heading = this.follow(this.look);
      this.offset(this.look, this.followOff.x, this.followOff.y, this.followOff.z, this.followLocal ? heading : null);
    } else if (this.lookPan) this.look.lerpVectors(this.lookA, this.lookB, u);
    else this.look.copy(this.lookA);
    camera.lookAt(this.look);
    const fov = this.fov0 + (this.fov1 - this.fov0) * u;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    return true;
  }

  /** Ends now. Every event that has not happened yet still runs, so the world ends in the same state. */
  skip(): void {
    if (!this.def) return;
    for (;;) {
      this.cues(Infinity, true);
      if (this.si + 1 >= this.def.shots.length) break;
      this.si += 1;
      this.shot = this.def.shots[this.si];
      this.evI = 0;
    }
    this.finish();
  }

  private finish(): void {
    if (!this.def) return;
    const cam = this.camera;
    if (cam) {
      cam.position.copy(this.savedPos);
      cam.quaternion.copy(this.savedQuat);
      cam.fov = this.savedFov;
      cam.updateProjectionMatrix();
    }
    this.def = null;
    this.shot = null;
    this.follow = null;
    this.subEnd = -1;
    this.holdSince = -1;
    this.skipEl.classList.remove('on', 'holding');
    this.h.subtitle(null, '');
    this.h.card(null);
    this.h.letterbox(false);
    this.h.end();
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}
