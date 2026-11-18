// Side activities that pay out between (and during) missions:
//  - Memory shards: 24 glowing pieces of MITRA's memory at landmarks around campus.
//  - Kalki Time Trial: a sprint along the ring road through a start gate, with medals,
//    against a see-through ghost of your best run.

import * as THREE from 'three';
import { DATA, pointInPoly, centroid, type Pt } from './geo.ts';
import type { CampusGround } from './ground.ts';
import { CheckRing, animateItem, shardModel } from './actors.ts';
import { TRIAL_MEDALS, TRIAL_ROUTE } from './story.ts';
import { resample } from './missions.ts';
import { has, saveProfile, type Profile } from './profile.ts';
import type { CampusUI } from './ui.ts';
import type { GoalEvent } from './meta.ts';

const GHOST_KEY = 'campus-trial-ghost-v1';
/** Seconds between recorded ghost samples (position + rotation). */
const GHOST_DT = 0.1;

interface GhostRun {
  time: number;
  /** x, y, z, qx, qy, qz, qw per sample. */
  f: number[];
}

function loadGhost(): GhostRun | null {
  try {
    const raw = localStorage.getItem(GHOST_KEY);
    return raw ? (JSON.parse(raw) as GhostRun) : null;
  } catch {
    return null;
  }
}

export const SHARD_COUNT = 24;
const SHARD_COINS = 25;
const ALL_SHARDS_BONUS = 500;

/** Shard spots: named landmarks inside the campus, at least 14 m apart, then park centres. */
export function shardSpots(): Pt[] {
  const out: Pt[] = [];
  const ok = (x: number, z: number) => pointInPoly(x, z, DATA.boundary) && !DATA.buildings.some((b) => pointInPoly(x, z, b.pts)) && out.every(([a, b]) => Math.hypot(a - x, b - z) > 14);
  for (const p of DATA.points) {
    if (!p.name || out.length >= SHARD_COUNT) continue;
    const x = p.x + 2.2;
    const z = p.z + 1.6;
    if (ok(x, z)) out.push([x, z]);
  }
  for (const a of DATA.areas) {
    if (!a.name || out.length >= SHARD_COUNT) continue;
    const [x, z] = centroid(a.pts);
    if (pointInPoly(x, z, a.pts) && ok(x, z)) out.push([x, z]);
  }
  return out.slice(0, SHARD_COUNT);
}

export interface ExtrasContext {
  scene: THREE.Scene;
  ground: CampusGround;
  ui: CampusUI;
  profile: Profile;
  sound: (name: string) => void;
  onCoins: () => void;
  /** Kalki's model (cloned once for the ghost) and its current pose. */
  kart?: THREE.Object3D;
  track?: (e: GoalEvent) => void;
  reward?: (at: THREE.Vector3, kind: 'small' | 'medium' | 'big', coins: number) => void;
  /** A memory shard was picked up (story 2 opens a bonus riddle). */
  onShard?: () => void;
}

export class Extras {
  private c: ExtrasContext;
  private shards: { i: number; x: number; z: number; obj: THREE.Group }[] = [];
  private group = new THREE.Group();
  private gate: CheckRing | null = null;
  private trialRings: CheckRing[] = [];
  private trialPts: Pt[] = [];
  /** Running time trial: next ring and elapsed time. */
  trial: { at: number; t: number } | null = null;
  readonly total: number;
  private ghost: THREE.Object3D | null = null;
  private ghostRun: GhostRun | null = loadGhost();
  private rec: number[] = [];
  private recT = 0;
  private q0 = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();

  constructor(c: ExtrasContext) {
    this.c = c;
    c.scene.add(this.group);
    const spots = shardSpots();
    this.total = spots.length;
    spots.forEach(([x, z], i) => {
      const obj = shardModel();
      obj.position.set(x, c.ground.standAt(x, z), z);
      obj.visible = false;
      this.group.add(obj);
      this.shards.push({ i, x, z, obj });
    });
    // Time trial: the start gate, then the rings along the route.
    const pts = resample(TRIAL_ROUTE, 32);
    const [sx, sz] = TRIAL_ROUTE[0];
    const [nx, nz] = TRIAL_ROUTE[1];
    this.gate = new CheckRing(sx, c.ground.heightAt(sx, sz), sz, Math.atan2(nx - sx, nz - sz), '#38e1ff');
    this.group.add(this.gate.obj);
    this.trialPts = pts;
    pts.forEach((p, i) => {
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      const r = new CheckRing(p[0], c.ground.heightAt(p[0], p[1]), p[1], Math.atan2(q[0] - o[0], q[1] - o[1]), '#38e1ff');
      r.obj.visible = false;
      this.group.add(r.obj);
      this.trialRings.push(r);
    });
    this.refresh();
  }

  get shardsFound(): number {
    return this.c.profile.shards.length;
  }

  /** Shows what the profile has unlocked. */
  refresh(): void {
    const p = this.c.profile;
    const on = has(p, 'shards');
    for (const s of this.shards) s.obj.visible = on && !p.shards.includes(s.i);
    if (this.gate) this.gate.obj.visible = has(p, 'trial') && !this.trial;
    this.c.ui.setShards(on ? `${p.shards.length} / ${this.total}` : null);
  }

  /** Nearest uncollected shards within 70 m, for the minimap. */
  nearShards(x: number, z: number): { x: number; z: number }[] {
    if (!has(this.c.profile, 'shards')) return [];
    return this.shards.filter((s) => s.obj.visible && Math.hypot(s.x - x, s.z - z) < 70).map((s) => ({ x: s.x, z: s.z }));
  }

  /**
   * Per frame. `focus` is the player or kart; `inKart` whether driving; `blocked` when a
   * mission drive or chase is running (no trial then).
   */
  update(dt: number, playing: boolean, focus: THREE.Vector3, inKart: boolean, blocked: boolean): void {
    const t = performance.now() / 1000;
    const p = this.c.profile;
    for (const s of this.shards) {
      if (!s.obj.visible) continue;
      animateItem(s.obj, t, s.i);
      if (playing && Math.hypot(focus.x - s.x, focus.z - s.z) < (inKart ? 3 : 2) && Math.abs(focus.y - s.obj.position.y) < 3) {
        s.obj.visible = false;
        p.shards.push(s.i);
        p.coins += SHARD_COINS;
        p.xp += 10;
        this.c.sound('clue');
        this.c.track?.('shard');
        this.c.reward?.(s.obj.position.clone().setY(s.obj.position.y + 1.1), 'big', SHARD_COINS);
        if (p.shards.length >= this.total) {
          p.coins += ALL_SHARDS_BONUS;
          this.c.ui.toast(`ALL ${this.total} MEMORY SHARDS! +${ALL_SHARDS_BONUS}◈`, 'good');
        } else this.c.ui.toast(`Memory shard ${p.shards.length} / ${this.total}  +${SHARD_COINS}◈`, 'good');
        saveProfile(p);
        this.c.onCoins();
        this.refresh();
        this.c.onShard?.();
      }
    }

    // Time trial.
    if (!has(p, 'trial')) return;
    if (this.gate) {
      this.gate.obj.visible = !this.trial && !blocked;
      if (this.gate.obj.visible) this.gate.setState('next', t);
    }
    if (!this.trial) {
      if (playing && inKart && !blocked && this.gate && Math.hypot(focus.x - this.gate.x, focus.z - this.gate.z) < 4.4) {
        this.trial = { at: 0, t: 0 };
        this.rec = [];
        this.recT = 0;
        this.showGhost(!!this.ghostRun);
        this.c.sound('objective');
        this.c.ui.banner('Kalki Time Trial', `Gold ${TRIAL_MEDALS[0].time} s · Silver ${TRIAL_MEDALS[1].time} s · Bronze ${TRIAL_MEDALS[2].time} s${p.trialBest ? ` · Your best ${p.trialBest.toFixed(1)} s` : ''}`);
      }
      return;
    }
    const tr = this.trial;
    if (!inKart || blocked || tr.t > 180) {
      this.endTrial();
      this.c.ui.toast('Time trial abandoned', 'bad');
      return;
    }
    if (playing) tr.t += dt;
    this.c.ui.setTimer(tr.t, true);
    this.recordGhost(tr.t);
    this.playGhost(tr.t);
    const r = this.trialRings[tr.at];
    if (r && Math.hypot(focus.x - r.x, focus.z - r.z) < 4.6) {
      tr.at += 1;
      this.c.sound('switch');
      if (tr.at >= this.trialRings.length) {
        this.finishTrial(tr.t);
        return;
      }
    }
    this.trialRings.forEach((q, i) => q.setState(i < tr.at ? 'done' : i === tr.at ? 'next' : i < tr.at + 4 ? 'later' : 'done', t));
  }

  /** The next ring of a running trial (for the compass). */
  trialTarget(): { x: number; z: number; label: string } | null {
    if (!this.trial) return null;
    const r = this.trialRings[this.trial.at];
    return r ? { x: r.x, z: r.z, label: `Trial ring ${this.trial.at + 1} / ${this.trialRings.length}` } : null;
  }

  // ------------------------------------------------------------------ ghost

  /** A see-through copy of Kalki: one shared material, no lights, no shadows. */
  private showGhost(on: boolean): void {
    if (on && !this.ghost && this.c.kart) {
      const g = this.c.kart.clone(true);
      const mat = new THREE.MeshBasicMaterial({ color: '#7fe8ff', transparent: true, opacity: 0.32, depthWrite: false });
      const drop: THREE.Object3D[] = [];
      g.traverse((o) => {
        if ((o as THREE.Light).isLight) drop.push(o);
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.material = mat;
          m.castShadow = false;
          m.receiveShadow = false;
        }
      });
      for (const o of drop) o.removeFromParent();
      g.renderOrder = 5;
      this.ghost = g;
      this.group.add(g);
    }
    if (this.ghost) this.ghost.visible = on;
  }

  private recordGhost(t: number): void {
    const k = this.c.kart;
    if (!k || t < this.recT) return;
    this.recT += GHOST_DT;
    const p = k.getWorldPosition(new THREE.Vector3());
    const q = k.getWorldQuaternion(this.q0);
    const r = (v: number) => Math.round(v * 1000) / 1000;
    this.rec.push(r(p.x), r(p.y), r(p.z), r(q.x), r(q.y), r(q.z), r(q.w));
  }

  private playGhost(t: number): void {
    const run = this.ghostRun;
    const g = this.ghost;
    if (!run || !g || !g.visible) return;
    const n = run.f.length / 7;
    const u = Math.min(n - 1, t / GHOST_DT);
    const i = Math.min(n - 2, Math.floor(u));
    if (i < 0) return;
    const a = run.f;
    const f = THREE.MathUtils.clamp(u - i, 0, 1);
    const A = i * 7;
    const B = A + 7;
    g.position.set(THREE.MathUtils.lerp(a[A], a[B], f), THREE.MathUtils.lerp(a[A + 1], a[B + 1], f), THREE.MathUtils.lerp(a[A + 2], a[B + 2], f));
    this.q0.set(a[A + 3], a[A + 4], a[A + 5], a[A + 6]);
    this.q1.set(a[B + 3], a[B + 4], a[B + 5], a[B + 6]);
    g.quaternion.slerpQuaternions(this.q0, this.q1, f);
    // Past the end of the recording: it has finished; fade it out.
    g.visible = u < n - 1 || t < run.time + 1.5;
  }

  private endTrial(): void {
    this.trial = null;
    this.showGhost(false);
    for (const r of this.trialRings) r.obj.visible = false;
    this.c.ui.setTimer(null);
  }

  private finishTrial(time: number): void {
    const p = this.c.profile;
    this.endTrial();
    const medal = TRIAL_MEDALS.find((m) => time <= m.time);
    const record = p.trialBest === null || time < p.trialBest;
    if (record) p.trialBest = time;
    const ghostBeat = !!this.ghostRun && time < this.ghostRun.time;
    if (record || !this.ghostRun) {
      this.ghostRun = { time, f: this.rec };
      try {
        localStorage.setItem(GHOST_KEY, JSON.stringify(this.ghostRun));
      } catch {
        /* no storage: the ghost lasts for this session */
      }
    }
    const coins = (medal?.coins ?? 20) + (record ? 50 : 0);
    p.coins += coins;
    p.xp += medal ? 40 : 15;
    saveProfile(p);
    this.c.onCoins();
    this.c.sound('clue');
    this.c.ui.banner(`${medal ? `${medal.name} medal!` : 'Finished'} ${time.toFixed(1)} s`, `${record ? (ghostBeat ? 'You beat your ghost! NEW RECORD! ' : 'NEW RECORD! ') : ''}+${coins}◈ · drive through the gate again to race your ghost`);
  }

  /** Not counted as part of `trialPts`' use; kept for tests. */
  get trialLength(): number {
    return this.trialPts.length;
  }
}
