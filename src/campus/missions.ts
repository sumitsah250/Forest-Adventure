// Runs the "Blackout at WRC" missions (story.ts): people at their posts, the step in play,
// its markers, items, drones and rings, the step timer, hearts, and the end-of-mission
// rewards (stars, coins, XP, unlocks) written to the player's profile.

import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/physics.ts';
import type RAPIER from '@dimforge/rapier3d-compat';
import { DATA, buildingAt, centroid, findArea, findBuilding, findPoint, pointInPoly, segDist, type Pt } from './geo.ts';
import type { CampusGround } from './ground.ts';
import { MISSIONS, MISSION_COUNT, NPCS, VOICES, type ItemDef, type MissionDef, type Sky, type Step, type Where } from './story.ts';
import { Person, postGroups, walkSurface } from './people.ts';
import { QUESTIONS, shuffled, type Question } from './questions.ts';
import type { CampusUI, NavTarget } from './ui.ts';
import type { CampusWorld } from './world.ts';
import { Beacon, CheckRing, Drone, animateItem, coinModel, itemModel } from './actors.ts';
import { choose, heartsLabel, runPuzzle } from './minigames.ts';
import { has, levelOf, saveProfile, starsFor, type Profile } from './profile.ts';
import type { GoalEvent } from './meta.ts';

const MAX_HEARTS = 3;
const REACH = 2.9;

/**
 * Optional bonus objectives: each mission gets two that fit its steps. "Keep" ones hold
 * unless something breaks them (a hint, a wrong answer); "reach" ones tick as they happen.
 */
export type BonusId = 'combo4' | 'allCoins' | 'noHints' | 'noMiss' | 'turbo2' | 'unseen';
const BONUS_LABEL: Record<BonusId, string> = {
  combo4: 'Reach a ×4 combo',
  allCoins: 'Grab every bonus coin',
  noHints: 'Crack riddles with no hints',
  noMiss: 'No wrong answers',
  turbo2: 'Fire 2 mini-turbos',
  unseen: 'Stay unseen by drones',
};
const BONUS_FIRST = 40;
const BONUS_AGAIN = 10;

export interface BonusState {
  id: BonusId;
  label: string;
  state: 'open' | 'done' | 'failed';
}

/** The two bonus objectives for a mission (specific to its steps first, then general ones). */
export function bonusFor(d: MissionDef, index: number): BonusId[] {
  const kinds = new Set(d.steps.map((s) => s.kind));
  const specific: BonusId[] = [];
  if (kinds.has('riddle')) specific.push('noHints');
  if (kinds.has('quiz') || kinds.has('puzzle') || kinds.has('choose')) specific.push('noMiss');
  if (kinds.has('stealth')) specific.push('unseen');
  if (kinds.has('drive') || kinds.has('chase')) specific.push('turbo2');
  const general: BonusId[] = index % 2 ? ['allCoins', 'combo4'] : ['combo4', 'allCoins'];
  const pick = [...specific.slice(index % Math.max(1, specific.length)), ...specific, ...general];
  return [...new Set(pick)].slice(0, 2);
}

interface Spot {
  x: number;
  z: number;
  facing: number;
}

interface ItemObj {
  def: ItemDef;
  index: number;
  spot: Spot;
  obj: THREE.Group;
  got: boolean;
}

interface Patrol {
  drone: Drone;
  cx: number;
  cz: number;
  r: number;
  w: number;
  phase: number;
}

export interface MissionResult {
  mission: MissionDef;
  index: number;
  stars: number;
  prevStars: number;
  seconds: number;
  heartsLeft: number;
  coins: number;
  xp: number;
  /** Player level before and after (for the level-up flash). */
  levelBefore: number;
  levelAfter: number;
  newUnlock: boolean;
  replay: boolean;
  bestTime: boolean;
  perfect: boolean;
  /** This run's bonus objectives (fresh: first time earned). */
  bonus: { label: string; done: boolean; fresh: boolean }[];
  bonusCoins: number;
}

export interface MissionContext {
  scene: THREE.Scene;
  world: CampusWorld;
  ground: CampusGround;
  physics: PhysicsWorld;
  ui: CampusUI;
  profile: Profile;
  sound: (name: string) => void;
  /** Player or kart position (whichever the player is controlling). */
  inKart: () => boolean;
  /** Puts the player (on foot or in the kart) back at a position, facing a point. */
  reposition: (x: number, z: number, lookX: number, lookZ: number) => void;
  onSky: (sky: Sky) => void;
  onUnlock: (id: string) => void;
  /** Mission-intro cinematic over the first objective (optional). */
  intro?: (d: MissionDef, index: number, at: { x: number; z: number } | null) => Promise<void>;
  /** Frame a conversation with this person (null: back to gameplay). */
  converse?: (p: Person | null) => void;
  /** A big moment (slow motion, camera punch). */
  moment?: (kind: 'caught' | 'found' | 'solved') => void;
  /** Park Kalki somewhere (unless the player is driving it). */
  placeKart?: (x: number, z: number, heading: number) => void;
  /** Mission complete screen closed: what next. */
  onComplete: (r: MissionResult) => Promise<void>;
  /** Something good happened at a place: effects, flying coins (kind sets how big). */
  reward?: (at: THREE.Vector3, kind: 'small' | 'medium' | 'big', coins: number) => void;
  /** The combo chime, rising with the chain. */
  chime?: (combo: number) => void;
  /** Counts toward the daily goals. */
  track?: (e: GoalEvent, n?: number) => void;
  /** Plays a scripted scene (cutscene.ts). Without it, `cutscene` steps are skipped. */
  cutscene?: (id: string) => Promise<void>;
}

export class Missions {
  private c: MissionContext;
  /** Current mission (index into MISSIONS), or -1 in free roam. */
  index = -1;
  step = 0;
  hearts = MAX_HEARTS;
  heartsLost = 0;
  /** Seconds of play in this mission (dialogues and puzzles pause it). */
  seconds = 0;
  /** Coins earned in play this mission (quiz streaks, pick-ups, rings). */
  earned = 0;
  /** Countdown for a timed step (null: untimed). */
  timer: number | null = null;
  replay = false;
  private busy = false;
  private cooldown = 0;
  private npcs = new Map<string, { p: Person; collider: RAPIER.Collider; home: Spot }>();
  private beacon = new Beacon();
  private items: ItemObj[] = [];
  private device: { obj: THREE.Group; spot: Spot } | null = null;
  private rings: CheckRing[] = [];
  private ringAt = 0;
  private patrols: Patrol[] = [];
  private chase: { drone: Drone; route: Pt[]; lens: number[]; s: number; dir: number; started: boolean } | null = null;
  private stepGroup = new THREE.Group();
  private focus = new THREE.Vector3();
  private near: { kind: 'npc'; npc: string } | { kind: 'item'; item: ItemObj } | { kind: 'device' } | null = null;
  private combo = 0;
  /** Seconds left before the combo chain breaks. */
  private comboT = 0;
  /** Bonus coins floating around the current objective. */
  private coins: { obj: THREE.Object3D; x: number; z: number }[] = [];
  /** Step end times of this run, and the last split against the best run (s, − is ahead). */
  private splits: number[] = [];
  private split: number | null = null;
  /** A drone hunting Kalki during a drive step. */
  private pursuer: { drone: Drone; x: number; z: number; alarm: number; wait: number } | null = null;
  /** Riddle in play: the hidden answer, seconds since it was asked, hints shown, found (revealed). */
  private riddle: { obj: THREE.Group; spot: Spot; t: number; hint: number; seen: boolean } | null = null;
  /** Bumped on every step change so stale async work can tell it is out of date. */
  private epoch = 0;
  alarm = 0;
  /** This mission's bonus objectives. */
  bonus: BonusState[] = [];
  private coinsSpawned = 0;
  private coinsGot = 0;
  private turbos = 0;
  /** A drone's alarm went high without catching the player (a close call when it drops). */
  private closeCall = false;
  private tmp = new THREE.Vector3();
  /** Floor height for people and items (steps, landings and terraces included). */
  private surface: { heightAt(x: number, z: number): number };
  /**
   * Frames until people and items re-measure the floor. Entrance steps for some buildings are
   * only built when the story first sends someone there, and the physics engine sees new
   * colliders after its next step: placements made before that land on the bare ground.
   */
  private resnapIn = 2;

  constructor(c: MissionContext) {
    this.c = c;
    this.surface = walkSurface(c.ground, c.physics);
    c.scene.add(this.beacon.group, this.stepGroup);
    for (const n of NPCS) {
      const s = this.resolve(n.at, n.name);
      const p = new Person(c.scene, n.outfit, this.surface, c.physics, s.x, s.z, s.facing, n.name);
      const collider = postGroups(c.physics.addCylinder(s.x, p.pos.y, s.z, 0.85, 0.32));
      this.npcs.set(n.id, { p, collider, home: s });
    }
  }

  /** Where a character stands and which way they face (for cutscene cameras); null if unknown. */
  npcSpot(id: string): { pos: THREE.Vector3; facing: () => number } | null {
    const n = this.npcs.get(id);
    return n ? { pos: n.p.pos, facing: () => n.p.facing } : null;
  }

  get people(): Person[] {
    return [...this.npcs.values()].map((n) => n.p);
  }

  get def(): MissionDef | null {
    return this.index >= 0 ? MISSIONS[this.index] ?? null : null;
  }

  get stepDef(): Step | null {
    return this.def?.steps[this.step] ?? null;
  }

  /** Kalki may be driven: unlocked in the story, or past the "get in" step of Meet Kalki. */
  kartAllowed(): boolean {
    if (has(this.c.profile, 'kalki')) return true;
    const d = this.def;
    if (!d) return false;
    const k = d.steps.findIndex((s) => s.kind === 'kart');
    return k >= 0 && this.step >= k;
  }

  /** The step needs Kalki and the player is on foot. */
  get needsKart(): boolean {
    const s = this.stepDef;
    return !!s && (s.kind === 'drive' || s.kind === 'chase' || s.kind === 'kart') && !this.c.inKart();
  }

  // ------------------------------------------------------------------ flow

  /** Starts a mission (at a step, when resuming). */
  async begin(index: number, step = 0, replay = false): Promise<void> {
    this.epoch += 1;
    this.index = index;
    this.replay = replay;
    this.hearts = MAX_HEARTS;
    this.heartsLost = 0;
    this.seconds = 0;
    this.earned = 0;
    this.combo = 0;
    this.comboT = 0;
    this.splits = [];
    this.split = null;
    this.step = step;
    this.coinsSpawned = 0;
    this.coinsGot = 0;
    this.turbos = 0;
    this.closeCall = false;
    const d = this.def;
    this.bonus = d ? bonusFor(d, index).map((id) => ({ id, label: BONUS_LABEL[id], state: 'open' as const })) : [];
    // Resuming part-way: coins already missed, so "every coin" cannot be judged fairly.
    if (step > 0) this.bonus = this.bonus.map((b) => (b.id === 'allCoins' ? { ...b, state: 'failed' as const } : b));
    this.c.ui.setBonus(this.bonus.length ? this.bonus : null);
    if (!d) {
      this.clearStep();
      this.refreshHud();
      return;
    }
    // People back to their posts, then any moves the earlier steps made (and anyone this
    // mission meets somewhere new is already waiting there).
    for (const [id, n] of this.npcs) this.placeNpc(id, n.home);
    const met = new Set<string>();
    d.steps.forEach((s, i) => {
      if (s.kind !== 'talk') return;
      if (s.at && (i <= step || !met.has(s.npc))) this.placeNpc(s.npc, this.resolve(s.at, s.npc));
      met.add(s.npc);
    });
    if (step === 0 && d.kartAt && !this.c.inKart()) this.c.placeKart?.(d.kartAt.x, d.kartAt.z, d.kartAt.heading);
    this.c.onSky(d.sky);
    const epoch = this.epoch;
    // A mission that opens on a cutscene has its own opening; the standard intro shot would double it.
    if (d.steps[step]?.kind === 'cutscene') {
      // (TODO Phase 4: the typed location card goes here.)
    } else if (this.c.intro) await this.c.intro(d, index, step === 0 ? this.firstSpot(d) : null);
    else {
      this.c.ui.banner(`Mission ${index + 1} · ${d.title}`, `${d.clock} — ${d.brief}`);
      this.c.sound('objective');
    }
    if (epoch !== this.epoch) return;
    await this.enterStep();
  }

  /** Where a mission first sends the player (for the intro shot). */
  private firstSpot(d: MissionDef): { x: number; z: number } | null {
    for (const s of d.steps) {
      switch (s.kind) {
        case 'talk':
        case 'choose': {
          const n = this.npcs.get(s.npc);
          if (s.kind === 'talk' && s.at) return this.resolve(s.at, s.npc);
          if (n) return { x: n.p.pos.x, z: n.p.pos.z };
          break;
        }
        case 'collect': return this.resolve(s.items[0].at, s.items[0].label);
        case 'goto':
        case 'puzzle':
        case 'stealth': return this.resolve(s.at, s.kind);
        case 'drive':
        case 'chase': return { x: s.route[0][0], z: s.route[0][1] };
        default: break;
      }
    }
    return null;
  }

  /** Free roam (story finished, nothing chosen). */
  stop(): void {
    this.epoch += 1;
    this.index = -1;
    this.bonus = [];
    this.c.ui.setBonus(null);
    this.clearStep();
    this.refreshHud();
  }

  // ------------------------------------------------------------------ bonus objectives

  private bonusDone(id: BonusId): void {
    const b = this.bonus.find((x) => x.id === id);
    if (!b || b.state !== 'open') return;
    b.state = 'done';
    this.c.ui.setBonus(this.bonus);
    this.c.ui.toast(`Bonus ✓ ${b.label}`, 'good');
    this.c.sound('combo');
  }

  private bonusFail(id: BonusId): void {
    const b = this.bonus.find((x) => x.id === id);
    if (!b || b.state !== 'open') return;
    b.state = 'failed';
    this.c.ui.setBonus(this.bonus);
  }

  /** Kalki fired a mini-turbo (main reports it). */
  noteTurbo(): void {
    if (!this.def) return;
    this.turbos += 1;
    if (this.turbos >= 2) this.bonusDone('turbo2');
  }

  private at(x: number, z: number, lift = 1): THREE.Vector3 {
    return this.tmp.set(x, this.surface.heightAt(x, z) + lift, z);
  }

  /** Close calls: the alarm went past half and dropped back to nothing. */
  private watchClose(alarm: number, x: number, z: number): void {
    if (alarm > 0.55 && alarm < 1) this.closeCall = true;
    else if (this.closeCall && alarm < 0.04) {
      this.closeCall = false;
      const bonus = this.chain(10);
      this.c.profile.stats.closeCalls += 1;
      this.c.track?.('closeCall');
      this.c.ui.trick('CLOSE CALL!', `+${bonus}◈`);
      this.c.reward?.(this.at(x, z, 1.2), 'small', bonus);
    }
  }

  private placeNpc(id: string, s: Spot): void {
    const n = this.npcs.get(id);
    if (!n) return;
    // Remove the old post first, or the surface ray could land on it.
    this.c.physics.removeCollider(n.collider);
    n.p.place(s.x, s.z, s.facing);
    n.collider = postGroups(this.c.physics.addCylinder(s.x, n.p.pos.y, s.z, 0.85, 0.32));
    this.resnapIn = 2;
  }

  /** Puts people and this step's objects back on the real floor (see resnapIn). */
  private resnap(): void {
    for (const n of this.npcs.values()) {
      const y = this.surface.heightAt(n.p.pos.x, n.p.pos.z);
      if (Math.abs(y - n.p.pos.y) < 0.03) continue;
      this.c.physics.removeCollider(n.collider);
      n.p.place(n.p.pos.x, n.p.pos.z, n.p.facing);
      n.collider = postGroups(this.c.physics.addCylinder(n.p.pos.x, n.p.pos.y, n.p.pos.z, 0.85, 0.32));
    }
    const lift = (o: THREE.Object3D, extra = 0) => (o.position.y = this.surface.heightAt(o.position.x, o.position.z) + extra);
    for (const it of this.items) lift(it.obj);
    if (this.device) lift(this.device.obj);
    if (this.riddle) lift(this.riddle.obj);
    for (const k of this.coins) lift(k.obj, 0.9);
  }

  private clearStep(): void {
    for (const o of [...this.stepGroup.children]) this.stepGroup.remove(o);
    this.items = [];
    this.coins = [];
    this.device = null;
    this.rings = [];
    this.ringAt = 0;
    this.patrols = [];
    this.chase = null;
    this.pursuer = null;
    this.riddle = null;
    this.timer = null;
    this.alarm = 0;
    this.c.ui.setTimer(null);
    this.c.ui.setSpotted(0);
  }

  private async enterStep(): Promise<void> {
    const epoch = ++this.epoch;
    this.clearStep();
    const d = this.def;
    const st = this.stepDef;
    if (!d) return;
    if (!st) {
      await this.complete();
      return;
    }
    this.saveCurrent();
    this.refreshHud();
    switch (st.kind) {
      case 'radio': {
        this.busy = true;
        const v = VOICES[st.from] ?? { name: st.from, role: '' };
        this.c.sound('radioBeep');
        await this.c.ui.dialog(v.name, v.role, st.lines, st.from);
        this.busy = false;
        if (epoch === this.epoch) await this.advance();
        return;
      }
      case 'read': {
        // A document: shown as cards titled with the document's name.
        this.busy = true;
        this.c.sound('paper');
        await this.c.ui.dialog(st.title, 'document', st.lines);
        this.busy = false;
        if (epoch === this.epoch) await this.advance();
        return;
      }
      case 'cutscene': {
        this.busy = true;
        if (this.c.cutscene) await this.c.cutscene(st.id);
        else console.info(`Campus Quest: cutscene ${st.id} skipped (no cutscene player)`);
        this.busy = false;
        if (epoch === this.epoch) await this.advance();
        return;
      }
      case 'stub': {
        // A piece of V2 that is not built yet (see TodoId in story/types.ts): say so and move on.
        console.info(`Campus Quest: ${st.todo} — ${st.note}`);
        if (import.meta.env.DEV) this.c.ui.toast(`[${st.todo}] ${st.note}`);
        if (epoch === this.epoch) await this.advance();
        return;
      }
      case 'talk':
        if (st.at) this.placeNpc(st.npc, this.resolve(st.at, st.npc));
        break;
      case 'collect': {
        this.timer = st.time ?? null;
        const objs = await Promise.all(st.items.map((it) => itemModel(it.model)));
        if (epoch !== this.epoch) return;
        st.items.forEach((def, i) => {
          const spot = this.resolve(def.at, def.label, true);
          const obj = objs[i];
          obj.position.set(spot.x, this.surface.heightAt(spot.x, spot.z), spot.z);
          obj.rotation.y = spot.facing;
          this.stepGroup.add(obj);
          this.items.push({ def, index: i, spot, obj, got: false });
        });
        break;
      }
      case 'goto':
        this.timer = st.time ?? null;
        break;
      case 'quiz':
        if (!st.npc && st.at) await this.spawnDevice(st.at, st.title, 'panel', epoch);
        break;
      case 'puzzle':
        await this.spawnDevice(st.at, st.label, st.model, epoch);
        break;
      case 'stealth': {
        await this.spawnDevice(st.at, st.label, st.model, epoch);
        if (epoch !== this.epoch || !this.device) return;
        // A meeting point (a person waits there), not a thing to pick up.
        if (st.auto) this.device.obj.visible = false;
        const t = this.device.spot;
        for (let i = 0; i < st.drones; i += 1) {
          const a = (i / st.drones) * Math.PI * 2 + 0.6;
          const dist = 5 + i * 2.6;
          const drone = new Drone(3.3);
          this.stepGroup.add(drone.obj, drone.light);
          this.patrols.push({ drone, cx: t.x + Math.cos(a) * dist, cz: t.z + Math.sin(a) * dist, r: 4 + (i % 3) * 1.4, w: (i % 2 ? -1 : 1) * (0.55 + i * 0.07), phase: i * 1.7 });
        }
        break;
      }
      case 'drive': {
        this.timer = st.time;
        const pts = resample(st.route, 30);
        pts.forEach((p, i) => {
          const q = pts[Math.min(pts.length - 1, i + 1)];
          const o = pts[Math.max(0, i - 1)];
          const ring = new CheckRing(p[0], this.c.ground.heightAt(p[0], p[1]), p[1], Math.atan2(q[0] - o[0], q[1] - o[1]));
          this.stepGroup.add(ring.obj);
          this.rings.push(ring);
        });
        if (st.pursuer) {
          // It starts a little behind the first stretch of road.
          const [ax, az] = st.route[0];
          const [bx, bz] = st.route[1];
          const l = Math.hypot(bx - ax, bz - az) || 1;
          const drone = new Drone(2.8);
          drone.height = 4.5;
          this.stepGroup.add(drone.obj, drone.light);
          this.pursuer = { drone, x: ax - ((bx - ax) / l) * 35, z: az - ((bz - az) / l) * 35, alarm: 0, wait: 2.5 };
        }
        break;
      }
      case 'chase': {
        this.timer = st.time;
        const drone = new Drone(2, false);
        drone.height = 3.2;
        this.stepGroup.add(drone.obj);
        const lens = [0];
        for (let i = 1; i < st.route.length; i += 1) lens.push(lens[i - 1] + Math.hypot(st.route[i][0] - st.route[i - 1][0], st.route[i][1] - st.route[i - 1][1]));
        this.chase = { drone, route: st.route, lens, s: 0, dir: 1, started: false };
        break;
      }
      case 'riddle': {
        const n = NPCS.find((x) => x.id === st.from);
        const v = n ? { name: n.name, role: n.role } : VOICES[st.from] ?? { name: st.from, role: '' };
        const person = this.npcs.get(st.from)?.p;
        const close = person && person.pos.distanceTo(this.focus) < 8;
        this.busy = true;
        if (close) this.c.converse?.(person);
        else this.c.sound('radioBeep');
        await this.c.ui.dialog(v.name, close ? v.role : 'on the radio', [`Riddle: "${st.riddle}"`, 'Work it out and go there. No marker this time — a hint comes if you need one.'], st.from);
        if (close) this.c.converse?.(null);
        this.busy = false;
        if (epoch !== this.epoch) return;
        const spot = this.resolve(st.answer, st.label, true);
        const obj = await itemModel(st.model);
        if (epoch !== this.epoch) return;
        obj.position.set(spot.x, this.surface.heightAt(spot.x, spot.z), spot.z);
        obj.visible = false;
        this.stepGroup.add(obj);
        this.riddle = { obj, spot, t: 0, hint: 0, seen: false };
        this.timer = st.time ?? null;
        break;
      }
      case 'kart':
      case 'choose':
        break;
    }
    if (epoch === this.epoch) this.scatterCoins();
    this.resnapIn = 2;
    this.refreshHud();
  }

  /** A handful of bonus coins in a loose ring around the objective: grab them for the combo. */
  private scatterCoins(): void {
    const st = this.stepDef;
    if (!st || st.kind === 'radio' || st.kind === 'kart' || st.kind === 'chase') return;
    const { main } = this.targets(null);
    if (!main) return;
    const n = st.kind === 'drive' ? 0 : 4;
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i += 1) {
      const a = a0 + (i / n) * Math.PI * 2;
      const r = 6 + Math.random() * 7;
      const x = main.x + Math.cos(a) * r;
      const z = main.z + Math.sin(a) * r;
      if (DATA.buildings.some((b) => pointInPoly(x, z, b.pts))) continue;
      const obj = coinModel();
      obj.position.set(x, this.surface.heightAt(x, z) + 0.9, z);
      this.stepGroup.add(obj);
      this.coins.push({ obj, x, z });
      this.coinsSpawned += 1;
    }
  }

  /** Something good in a row: pick-up, ring, right answer, solved puzzle. Returns the coin bonus. */
  private chain(base: number): number {
    this.combo += 1;
    this.comboT = 9;
    this.c.ui.setCombo(this.combo);
    this.c.chime?.(this.combo);
    const stats = this.c.profile.stats;
    if (this.combo > stats.bestCombo) stats.bestCombo = this.combo;
    if (this.combo >= 4) this.bonusDone('combo4');
    const bonus = base + 5 * Math.min(this.combo - 1, 6);
    this.earned += bonus;
    return bonus;
  }

  /** Kalki stunts (air, mini-turbo): part of the mission's combo, or straight to the wallet in free roam. */
  stunt(base: number): number {
    if (this.def) return this.chain(base);
    this.c.profile.coins += base;
    this.c.ui.setCoins(this.c.profile.coins);
    return base;
  }

  private breakChain(): void {
    this.combo = 0;
    this.comboT = 0;
    this.c.ui.setCombo(0);
  }

  private async spawnDevice(at: Where, label: string, model: Parameters<typeof itemModel>[0], epoch: number): Promise<void> {
    const spot = this.resolve(at, label, true);
    const obj = await itemModel(model);
    if (epoch !== this.epoch) return;
    obj.position.set(spot.x, this.surface.heightAt(spot.x, spot.z), spot.z);
    obj.rotation.y = spot.facing;
    this.stepGroup.add(obj);
    this.device = { obj, spot };
  }

  private async advance(): Promise<void> {
    const d = this.def;
    if (d) {
      // Split against the best run at this step.
      this.splits[this.step] = this.seconds;
      const best = this.c.profile.splits[d.id]?.[this.step];
      this.split = best === undefined ? null : this.seconds - best;
      if (this.split !== null && Math.abs(this.split) >= 1) this.c.ui.toast(`Split ${this.split <= 0 ? '−' : '+'}${Math.abs(this.split).toFixed(1)} s vs your best`, this.split <= 0 ? 'good' : '');
    }
    this.step += 1;
    this.c.sound('objective');
    await this.enterStep();
  }

  private loseHeart(reason: string): boolean {
    this.closeCall = false;
    this.hearts -= 1;
    this.heartsLost += 1;
    this.breakChain();
    this.c.ui.setHearts(this.hearts, MAX_HEARTS);
    this.c.ui.toast(`${reason}  −♥`, 'bad');
    this.c.ui.hit();
    this.c.sound('knock');
    if (this.hearts <= 0) {
      void this.failed();
      return true;
    }
    return false;
  }

  private async failed(): Promise<void> {
    this.busy = true;
    this.clearStep();
    await this.c.ui.message('Mission failed', 'You ran out of hearts. Every mission can be retried — the puzzles and questions change each time.', 'Retry mission', 'bad');
    this.busy = false;
    await this.begin(this.index, 0, this.replay);
  }

  private async complete(): Promise<void> {
    const d = this.def!;
    const p = this.c.profile;
    const index = this.index;
    const seconds = Math.round(this.seconds);
    const stars = starsFor(this.heartsLost, seconds, d.par);
    const prevStars = p.stars[d.id] ?? 0;
    const first = index >= p.story && !this.replay;
    const levelBefore = levelOf(p.xp).level;
    const starBonus = Math.max(0, stars - prevStars) * 40;
    const perfect = stars === 3 ? 100 : 0;
    // Bonus objectives: the "keep" ones that held to the end count now.
    if (this.coinsSpawned > 0 && this.coinsGot >= this.coinsSpawned) this.bonusDone('allCoins');
    for (const b of this.bonus) if (b.state === 'open' && (b.id === 'noHints' || b.id === 'noMiss' || b.id === 'unseen')) b.state = 'done';
    const had = new Set(p.bonus[d.id] ?? []);
    const bonus = this.bonus.map((b) => ({ label: b.label, done: b.state === 'done', fresh: b.state === 'done' && !had.has(b.id) }));
    const bonusCoins = bonus.reduce((a, b) => a + (b.done ? (b.fresh ? BONUS_FIRST : BONUS_AGAIN) : 0), 0);
    const doneIds = this.bonus.filter((b) => b.state === 'done').map((b) => b.id);
    p.bonus[d.id] = [...new Set([...had, ...doneIds])];
    if (doneIds.length) this.c.track?.('bonus', doneIds.length);
    this.c.track?.('mission');
    if (stars >= 3) this.c.track?.('threeStar');
    this.c.ui.setBonus(null);
    const coins = Math.round((first ? d.reward.coins : d.reward.coins * 0.4) + this.earned + starBonus + perfect + bonusCoins);
    const xp = Math.round(first ? d.reward.xp : d.reward.xp * 0.3) + Math.max(0, stars - prevStars) * 25;
    p.coins += coins;
    p.xp += xp;
    p.stars[d.id] = Math.max(prevStars, stars);
    const bestTime = p.best[d.id] === undefined || seconds < p.best[d.id];
    if (bestTime) {
      p.best[d.id] = seconds;
      p.splits[d.id] = [...this.splits];
    }
    this.breakChain();
    this.c.ui.setPar(null);
    p.stats.missions += 1;
    p.stats.seconds += seconds;
    let newUnlock = false;
    for (const u of [...(d.reward.unlock ? [d.reward.unlock] : []), ...(d.reward.unlocks ?? [])]) {
      if (p.unlocks.includes(u)) continue;
      p.unlocks.push(u);
      newUnlock = true;
      this.c.onUnlock(u);
    }
    if (first) p.story = index + 1;
    p.current = null;
    saveProfile(p);
    this.clearStep();
    this.index = -1;
    this.refreshHud();
    this.c.sound('clue');
    await this.c.onComplete({
      mission: d, index, stars, prevStars, seconds, heartsLeft: this.hearts, coins, xp, levelBefore,
      levelAfter: levelOf(p.xp).level, newUnlock, replay: !first, bestTime, perfect: perfect > 0, bonus, bonusCoins,
    });
  }

  private saveCurrent(): void {
    if (this.index < 0 || this.replay) return;
    this.c.profile.current = { mission: this.index, step: this.step };
    saveProfile(this.c.profile);
  }

  /** Restart the current mission from its first step (pause menu). */
  async restart(): Promise<void> {
    if (this.index >= 0) await this.begin(this.index, 0, this.replay);
  }

  // ------------------------------------------------------------------ HUD

  refreshHud(): void {
    const ui = this.c.ui;
    const d = this.def;
    ui.setHearts(d ? this.hearts : MAX_HEARTS, MAX_HEARTS);
    // In a mission the wallet shows what this run has earned so far (paid out at the end).
    ui.setCoins(this.c.profile.coins + (d ? this.earned : 0));
    const lv = levelOf(this.c.profile.xp);
    ui.setXp(lv.level, lv.into / lv.need);
    if (!d) {
      ui.setMission('Free roam', '');
      ui.setObjective('Explore the campus', 'Replay missions for stars (pause menu) · find memory shards · drive the time trial');
      return;
    }
    ui.setMission(this.index < MISSION_COUNT ? `Mission ${this.index + 1} / ${MISSION_COUNT} · ${d.title}` : `Ending · ${d.title}`, d.clock);
    const st = this.stepDef;
    if (!st) return;
    const kart = this.needsKart ? ' — get in Kalki (K to call it)' : '';
    switch (st.kind) {
      case 'talk':
      case 'choose': {
        const n = NPCS.find((x) => x.id === st.npc);
        ui.setObjective(st.kind === 'talk' && st.obj ? st.obj : `Talk to ${n?.name ?? st.npc}`, n?.role ?? '');
        break;
      }
      case 'quiz': {
        const n = NPCS.find((x) => x.id === st.npc);
        ui.setObjective(st.obj ?? `Talk to ${n?.name ?? ''}`, st.title);
        break;
      }
      case 'collect': {
        const left = this.items.filter((i) => !i.got).length;
        ui.setObjective(st.obj, `${this.items.length - left} / ${st.items.length} · on foot press E, in Kalki drive through them`);
        break;
      }
      case 'goto':
      case 'puzzle':
      case 'stealth':
        ui.setObjective(st.obj, st.kind === 'stealth' ? 'Stay out of the searchlights' : '');
        break;
      case 'drive':
        ui.setObjective(st.obj + kart, `Rings ${this.ringAt} / ${this.rings.length}`);
        break;
      case 'chase':
        ui.setObjective(st.obj + kart, this.chase?.started ? 'Get right up to it!' : 'It is waiting — get close in Kalki');
        break;
      case 'kart':
        ui.setObjective(st.obj, 'Walk up to Kalki and press E');
        break;
      case 'riddle': {
        const r = this.riddle;
        const t1 = this.hintTimes(st)[0];
        const sub = !r ? '' : r.hint >= 2 ? `Hint: ${st.hints[1]} (marked)` : r.hint === 1 ? `Hint: ${st.hints[0]}` : `Crack it before the hint (${Math.max(0, Math.ceil(t1 - r.t))} s) for a bonus`;
        ui.setObjective(`“${st.riddle}”`, sub);
        break;
      }
      case 'radio':
      case 'read':
      case 'cutscene':
      case 'stub':
        break;
    }
  }

  /** Seconds until the first and second riddle hints. */
  private hintTimes(st: Extract<Step, { kind: 'riddle' }>): [number, number] {
    return st.time ? [st.time * 0.35, st.time * 0.65] : [40, 80];
  }

  /** The current navigation target and any secondary markers. */
  targets(kart: THREE.Vector3 | null): { main: NavTarget | null; extra: NavTarget[] } {
    const st = this.stepDef;
    if (!st) return { main: null, extra: [] };
    const p = this.focus;
    switch (st.kind) {
      case 'talk':
      case 'choose':
      case 'quiz': {
        if (st.kind === 'quiz' && !st.npc && this.device) return { main: { x: this.device.spot.x, z: this.device.spot.z, label: st.title }, extra: [] };
        const n = this.npcs.get(st.npc);
        return n ? { main: { x: n.p.pos.x, z: n.p.pos.z, label: n.p.name }, extra: [] } : { main: null, extra: [] };
      }
      case 'collect': {
        const left = this.items.filter((i) => !i.got);
        left.sort((a, b) => Math.hypot(a.spot.x - p.x, a.spot.z - p.z) - Math.hypot(b.spot.x - p.x, b.spot.z - p.z));
        const nav = left.map((i) => ({ x: i.spot.x, z: i.spot.z, label: i.def.label }));
        return { main: nav[0] ?? null, extra: nav.slice(1) };
      }
      case 'goto': {
        const s = this.resolve(st.at, st.label);
        return { main: { x: s.x, z: s.z, label: st.label }, extra: [] };
      }
      case 'puzzle':
      case 'stealth':
        return this.device ? { main: { x: this.device.spot.x, z: this.device.spot.z, label: st.label }, extra: [] } : { main: null, extra: [] };
      case 'drive':
      case 'chase':
      case 'kart': {
        if (this.needsKart && kart) return { main: { x: kart.x, z: kart.z, label: 'Kalki' }, extra: [] };
        if (st.kind === 'drive') {
          const r = this.rings[this.ringAt];
          return r ? { main: { x: r.x, z: r.z, label: `Ring ${this.ringAt + 1}` }, extra: this.rings.slice(this.ringAt + 1, this.ringAt + 3).map((q) => ({ x: q.x, z: q.z, label: '' })) } : { main: null, extra: [] };
        }
        if (st.kind === 'chase' && this.chase) {
          const d = this.chase.drone.obj.position;
          return { main: { x: d.x, z: d.z, label: 'Courier drone' }, extra: [] };
        }
        return { main: null, extra: [] };
      }
      case 'riddle': {
        const r = this.riddle;
        return r && r.hint >= 2 ? { main: { x: r.spot.x, z: r.spot.z, label: st.label }, extra: [] } : { main: null, extra: [] };
      }
      case 'radio':
      case 'read':
      case 'cutscene':
      case 'stub':
        return { main: null, extra: [] };
    }
  }

  /** Prompt currently shown (touch controls mirror it). */
  promptText: string | null = null;

  // ------------------------------------------------------------------ per frame

  update(dt: number, playing: boolean, focus: THREE.Vector3, interactPressed: boolean, kartPos: THREE.Vector3 | null): void {
    this.focus.copy(focus);
    const t = performance.now() / 1000;
    if (playing && this.resnapIn > 0 && --this.resnapIn === 0) this.resnap();
    if (this.c.ui.modal || this.busy) this.cooldown = 0.35;
    else this.cooldown = Math.max(0, this.cooldown - dt);
    const st = this.stepDef;
    const live = playing && !this.busy && !!st;
    if (live) this.seconds += dt;
    const inKart = this.c.inKart();

    for (const it of this.items) if (!it.got) animateItem(it.obj, t, it.index);
    if (this.device) animateItem(this.device.obj, t, 0);

    // Combo chain decays; bonus coins spin and get picked up; the three-star clock.
    if (live) {
      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.breakChain();
      }
      for (let i = this.coins.length - 1; i >= 0; i -= 1) {
        const k = this.coins[i];
        k.obj.rotation.y = t * 3 + i;
        if (Math.hypot(focus.x - k.x, focus.z - k.z) < (inKart ? 3 : 1.8)) {
          this.stepGroup.remove(k.obj);
          this.coins.splice(i, 1);
          this.coinsGot += 1;
          this.c.profile.stats.coinsGrabbed += 1;
          this.c.track?.('coin');
          const bonus = this.chain(5);
          this.c.sound('pickup');
          this.c.reward?.(this.tmp.copy(k.obj.position), 'small', bonus);
          this.c.ui.toast(`+${bonus}◈${this.combo > 1 ? `  combo ×${this.combo}` : ''}`, 'good');
        }
      }
    }
    const d = this.def;
    if (d) this.c.ui.setCoins(this.c.profile.coins + this.earned);
    if (d) this.c.ui.setPar({ left: d.par - this.seconds, hearts: this.heartsLost === 0, vsBest: this.split });
    else this.c.ui.setPar(null);

    // Beacon over the objective.
    const { main } = this.targets(kartPos);
    const showBeacon = !!main && st?.kind !== 'drive' && st?.kind !== 'chase';
    if (main && showBeacon) {
      const y = this.surface.heightAt(main.x, main.z);
      const tall = st?.kind === 'talk' || st?.kind === 'quiz' || st?.kind === 'choose' ? 2.15 : 1.9;
      this.beacon.set(main.x, y, main.z, Math.hypot(focus.x - main.x, focus.z - main.z), t, tall);
    }
    this.beacon.group.visible = showBeacon;

    // Step logic.
    this.near = null;
    let prompt: string | null = null;
    if (live && st) {
      const reachK = inKart ? 3.4 : REACH;
      const d2 = (x: number, z: number) => Math.hypot(focus.x - x, focus.z - z);
      switch (st.kind) {
        case 'talk':
        case 'choose':
        case 'quiz': {
          if (st.kind === 'quiz' && !st.npc) {
            if (this.device && d2(this.device.spot.x, this.device.spot.z) < REACH + 0.6 && !inKart) {
              this.near = { kind: 'device' };
              prompt = `Begin: ${st.title}`;
            }
            break;
          }
          const n = this.npcs.get(st.npc);
          if (n && n.p.pos.distanceTo(focus) < REACH + 0.6 && !inKart) {
            this.near = { kind: 'npc', npc: st.npc };
            prompt = `Talk to ${n.p.name}`;
          } else if (n && inKart && n.p.pos.distanceTo(focus) < 7) prompt = 'Get out of Kalki to talk (E)';
          break;
        }
        case 'collect': {
          for (const it of this.items) {
            if (it.got) continue;
            const d = d2(it.spot.x, it.spot.z);
            if (inKart && d < reachK) {
              this.collect(it, st);
              break;
            }
            if (!inKart && d < REACH) {
              this.near = { kind: 'item', item: it };
              prompt = `${st.verb}: ${it.def.label}`;
              break;
            }
          }
          break;
        }
        case 'goto': {
          const s = this.resolve(st.at, st.label);
          if (d2(s.x, s.z) < (inKart ? 7 : 4)) {
            this.c.ui.toast(`${st.label} ✓`, 'good');
            void this.advance();
            return;
          }
          break;
        }
        case 'puzzle':
          if (this.device && d2(this.device.spot.x, this.device.spot.z) < REACH + 0.4) {
            if (inKart) prompt = 'Get out of Kalki to use it (E)';
            else {
              this.near = { kind: 'device' };
              prompt = `Use: ${st.label}`;
            }
          }
          break;
        case 'stealth':
          this.updateDrones(dt, t, focus, inKart);
          if (st.auto && this.device && d2(this.device.spot.x, this.device.spot.z) < 3.6) {
            this.c.ui.toast(`${st.label} ✓`, 'good');
            this.c.moment?.('found');
            this.c.reward?.(this.at(this.device.spot.x, this.device.spot.z), 'big', 0);
            void this.advance();
            return;
          }
          if (!st.auto && this.device && d2(this.device.spot.x, this.device.spot.z) < REACH + 0.4) {
            if (inKart) prompt = 'Get out of Kalki to take it (E)';
            else {
              this.near = { kind: 'device' };
              prompt = `Take: ${st.label}`;
            }
          }
          break;
        case 'drive': {
          const r = this.rings[this.ringAt];
          if (r && inKart && d2(r.x, r.z) < 4.4) {
            this.ringAt += 1;
            const got = this.chain(3);
            this.c.track?.('ring');
            this.c.sound('switch');
            this.c.reward?.(this.at(r.x, r.z, 1.6), 'small', got);
            if (this.ringAt >= this.rings.length) {
              this.c.ui.toast('All rings! ✓', 'good');
              void this.advance();
              return;
            }
            this.refreshHud();
          }
          this.rings.forEach((q, i) => q.setState(i < this.ringAt ? 'done' : i === this.ringAt ? 'next' : 'later', t));
          if (this.pursuer && this.updatePursuer(dt, t, focus, inKart)) return;
          break;
        }
        case 'chase':
          if (this.updateChase(dt, t, focus, inKart)) return;
          break;
        case 'kart':
          if (inKart) {
            this.c.ui.toast('Kalki is running! ✓', 'good');
            void this.advance();
            return;
          }
          break;
        case 'riddle': {
          const r = this.riddle;
          if (!r) break;
          r.t += dt;
          const [t1, t2] = this.hintTimes(st);
          if (r.hint < 1 && r.t >= t1) {
            r.hint = 1;
            this.bonusFail('noHints');
            this.c.sound('radioBeep');
            this.c.ui.toast(`Hint: ${st.hints[0]}`);
          }
          if (r.hint < 2 && r.t >= t2) {
            r.hint = 2;
            this.c.sound('radioBeep');
            this.c.ui.toast(`Hint: ${st.hints[1]} — marked on your map`);
          }
          if (Math.floor(r.t) !== Math.floor(r.t - dt)) this.refreshHud();
          const d = d2(r.spot.x, r.spot.z);
          // The answer only shows itself when you are there.
          if (!r.seen && d < 16) {
            r.seen = true;
            r.obj.visible = true;
            this.c.sound('clue');
            this.c.ui.toast('This is the place! Find it…', 'good');
          }
          if (r.seen) animateItem(r.obj, t, 3);
          if (r.seen && ((inKart && d < reachK) || (!inKart && d < REACH && interactPressed && this.cooldown <= 0))) {
            const bonus = this.chain(r.hint === 0 ? 60 : r.hint === 1 ? 30 : 10);
            this.c.profile.stats.correct += 1;
            this.c.track?.('correct');
            this.c.sound('pickup');
            this.c.reward?.(this.at(r.spot.x, r.spot.z), 'big', bonus);
            this.c.ui.toast(`${r.hint === 0 ? 'Riddle cracked — no hints!' : 'Riddle solved!'}  ${st.label} ✓  +${bonus}◈`, 'good');
            this.c.moment?.('solved');
            void this.advance();
            return;
          }
          if (r.seen && !inKart && d < REACH) prompt = `Take: ${st.label}`;
          break;
        }
        case 'radio':
        case 'read':
        case 'cutscene':
        case 'stub':
          break;
      }
      // Step timer (drive and chase only count while in Kalki; the chase once it has started).
      if (this.timer !== null) {
        const counting = st.kind === 'drive' ? inKart : st.kind === 'chase' ? !!this.chase?.started : true;
        if (counting) this.timer -= dt;
        this.c.ui.setTimer(this.timer);
        if (this.timer <= 0) {
          if (!this.loseHeart('Out of time!')) void this.enterStep();
          return;
        }
      }
    } else if (st?.kind === 'stealth') {
      // Keep the drones drawn while a dialogue is open.
      for (const pt of this.patrols) pt.drone.place(pt.drone.ground.x, pt.drone.ground.y, this.c.ground.heightAt(pt.drone.ground.x, pt.drone.ground.y), pt.drone.obj.rotation.y, t);
    }
    this.promptText = prompt;
    this.c.ui.setPrompt(prompt);
    if (interactPressed && this.near && this.cooldown <= 0 && st) {
      const n = this.near;
      if (n.kind === 'item' && st.kind === 'collect') this.collect(n.item, st);
      else if (n.kind === 'npc') void this.talk(st);
      else if (n.kind === 'device') void this.useDevice(st);
    }
  }

  private updateDrones(dt: number, t: number, focus: THREE.Vector3, inKart: boolean): void {
    let alarm = 0;
    for (const pt of this.patrols) {
      const a = pt.phase + pt.w * t;
      const x = pt.cx + Math.cos(a) * pt.r;
      const z = pt.cz + Math.sin(a) * pt.r;
      const heading = Math.atan2(-Math.sin(a) * Math.sign(pt.w), Math.cos(a) * Math.sign(pt.w));
      const inside = Math.hypot(focus.x - x, focus.z - z) < pt.drone.radius + (inKart ? 0.6 : 0);
      pt.drone.alarm = THREE.MathUtils.clamp(pt.drone.alarm + (inside ? dt * 1.5 : -dt * 0.9), 0, 1);
      pt.drone.place(x, z, this.c.ground.heightAt(x, z), heading, t);
      alarm = Math.max(alarm, pt.drone.alarm);
    }
    this.alarm = alarm;
    this.c.ui.setSpotted(alarm);
    if (alarm > 0.5) this.bonusFail('unseen');
    this.watchClose(alarm, focus.x, focus.z);
    if (alarm >= 1 && this.device) {
      for (const pt of this.patrols) pt.drone.alarm = 0;
      if (this.loseHeart('Spotted by a drone!')) return;
      // Back to the edge of the patrol zone, on the side the player came from.
      const s = this.device.spot;
      let dx = focus.x - s.x;
      let dz = focus.z - s.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      this.c.reposition(s.x + dx * 26, s.z + dz * 26, s.x, s.z);
    }
  }

  /**
   * The hunter drone: closes in fast from far away, hangs on your tail at a little under
   * Kalki's top speed (outrun it on the straights, it gains on corners and crashes). Sitting
   * in its light fills the alarm; a full alarm costs a heart and knocks it back.
   */
  private updatePursuer(dt: number, t: number, focus: THREE.Vector3, inKart: boolean): boolean {
    const p = this.pursuer!;
    const dx = focus.x - p.x;
    const dz = focus.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    // A head start: it lifts off a couple of seconds after you get going.
    if (inKart && p.wait > 0) {
      p.wait -= dt;
      if (p.wait <= 0) {
        this.c.ui.toast('A drone is on your tail — GO!', 'bad');
        this.c.sound('whoosh');
      }
    }
    if (inKart && p.wait <= 0) {
      const speed = d > 40 ? 19 : d > 10 ? 13.2 : 10.5;
      const step = Math.min(d - 1.5, speed * dt);
      if (step > 0) {
        p.x += (dx / d) * step;
        p.z += (dz / d) * step;
      }
      p.alarm = THREE.MathUtils.clamp(p.alarm + (d < 6 ? dt * 0.8 : -dt * 0.45), 0, 1);
    }
    p.drone.alarm = p.alarm;
    p.drone.place(p.x, p.z, this.c.ground.heightAt(p.x, p.z), Math.atan2(dx, dz), t);
    this.alarm = p.alarm;
    this.c.ui.setSpotted(p.alarm);
    this.watchClose(p.alarm, focus.x, focus.z);
    if (p.alarm >= 1) {
      p.alarm = 0;
      if (this.loseHeart('The drone caught you!')) return true;
      // Knocked back behind you.
      p.x = focus.x - (dx / d) * 40;
      p.z = focus.z - (dz / d) * 40;
    }
    return false;
  }

  /** True when the step finished this frame. */
  private updateChase(dt: number, t: number, focus: THREE.Vector3, inKart: boolean): boolean {
    const ch = this.chase;
    const st = this.stepDef;
    if (!ch || !st || st.kind !== 'chase') return false;
    const pos = this.routeAt(ch.route, ch.lens, ch.s);
    const d = Math.hypot(focus.x - pos.x, focus.z - pos.z);
    if (!ch.started && inKart && d < 45) {
      ch.started = true;
      this.c.ui.toast('It is getting away — chase it!', 'bad');
      this.refreshHud();
    }
    if (ch.started) {
      // Rubber band: hangs back when far ahead, darts away when you get close.
      const k = d > 45 ? 0.45 : d < 14 ? 1.2 : 1;
      ch.s += ch.dir * st.speed * k * dt;
      const total = ch.lens[ch.lens.length - 1];
      if (ch.s >= total) { ch.s = total; ch.dir = -1; }
      if (ch.s <= 0) { ch.s = 0; ch.dir = 1; }
    }
    const ahead = this.routeAt(ch.route, ch.lens, ch.s + ch.dir * 2);
    const gy = this.c.ground.heightAt(pos.x, pos.z);
    ch.drone.place(pos.x, pos.z, gy, Math.atan2(ahead.x - pos.x, ahead.z - pos.z), t);
    if (ch.started && d < 4.2) {
      this.c.ui.toast('Caught it! ✓', 'good');
      this.c.moment?.('caught');
      this.earned += 40;
      this.c.reward?.(this.at(pos.x, pos.z, 2.5), 'big', 40);
      void this.advance();
      return true;
    }
    return false;
  }

  private routeAt(route: Pt[], lens: number[], s: number): { x: number; z: number } {
    const total = lens[lens.length - 1];
    const u = THREE.MathUtils.clamp(s, 0, total);
    let i = 1;
    while (i < lens.length - 1 && lens[i] < u) i += 1;
    const f = (u - lens[i - 1]) / Math.max(1e-6, lens[i] - lens[i - 1]);
    return { x: THREE.MathUtils.lerp(route[i - 1][0], route[i][0], f), z: THREE.MathUtils.lerp(route[i - 1][1], route[i][1], f) };
  }

  private collect(it: ItemObj, st: Extract<Step, { kind: 'collect' }>): void {
    it.got = true;
    it.obj.visible = false;
    this.c.sound('pickup');
    const bonus = this.chain(5);
    this.c.reward?.(this.at(it.spot.x, it.spot.z), 'medium', bonus);
    this.c.ui.toast(`${it.def.label} ✓  +${bonus}◈`, 'good');
    if (this.items.every((i) => i.got)) {
      this.c.ui.toast(`${st.obj} ✓`, 'good');
      void this.advance();
      return;
    }
    this.refreshHud();
  }

  private async talk(st: Step): Promise<void> {
    if (this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      if (st.kind === 'talk') {
        const n = NPCS.find((x) => x.id === st.npc)!;
        this.c.converse?.(this.npcs.get(st.npc)?.p ?? null);
        await this.c.ui.dialog(n.name, n.role, st.lines, st.npc);
        this.c.converse?.(null);
        if (epoch === this.epoch) await this.advance();
      } else if (st.kind === 'quiz') {
        await this.quiz(st);
      } else if (st.kind === 'choose') {
        const n = NPCS.find((x) => x.id === st.npc)!;
        this.c.converse?.(this.npcs.get(st.npc)?.p ?? null);
        const ok = await choose(this.c.ui, { title: `${n.name} · The accusation`, question: st.question, options: st.options, answer: st.answer, why: st.why, hearts: heartsLabel(this.hearts, MAX_HEARTS) });
        this.c.converse?.(null);
        if (ok) {
          this.earned += 60;
          this.c.moment?.('found');
          const np = this.npcs.get(st.npc)?.p.pos;
          if (np) this.c.reward?.(this.tmp.set(np.x, np.y + 1.8, np.z), 'big', 60);
          if (epoch === this.epoch) await this.advance();
        } else {
          this.bonusFail('noMiss');
          this.loseHeart('Wrong suspect!');
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async useDevice(st: Step): Promise<void> {
    if (this.busy) return;
    const epoch = this.epoch;
    this.busy = true;
    try {
      if (st.kind === 'puzzle') {
        const ok = await runPuzzle(this.c.ui, st.puzzle, heartsLabel(this.hearts, MAX_HEARTS));
        if (ok) {
          const got = this.chain(30);
          if (this.device) this.c.reward?.(this.at(this.device.spot.x, this.device.spot.z), 'big', got);
          if (epoch === this.epoch) await this.advance();
        } else {
          this.bonusFail('noMiss');
          this.loseHeart('Puzzle failed');
        }
      } else if (st.kind === 'stealth') {
        this.c.sound('pickup');
        this.c.ui.toast(`${st.label} ✓`, 'good');
        this.c.moment?.('found');
        this.earned += 30;
        if (this.device) this.c.reward?.(this.at(this.device.spot.x, this.device.spot.z), 'big', 30);
        if (epoch === this.epoch) await this.advance();
      } else if (st.kind === 'quiz') {
        await this.quiz(st);
      }
    } finally {
      this.busy = false;
    }
  }

  private async quiz(st: Extract<Step, { kind: 'quiz' }>): Promise<void> {
    const epoch = this.epoch;
    const pool: Question[] = st.pool === 'final' ? shuffled(Object.values(QUESTIONS).flat()) : shuffled(QUESTIONS[st.pool]);
    let got = 0;
    let i = 0;
    const n = NPCS.find((x) => x.id === st.npc);
    while (got < st.need) {
      if (i >= pool.length) i = 0;
      const q = pool[i++];
      const ok = await this.c.ui.ask(q, {
        header: n ? `${st.title} · ${n.name}` : st.title,
        progress: `${got} / ${st.need} correct${this.combo > 1 ? ` · combo ×${this.combo}` : ''}`,
        hearts: this.hearts,
        maxHearts: MAX_HEARTS,
        timer: st.timer,
      });
      if (epoch !== this.epoch) return;
      this.c.profile.stats.answered += 1;
      if (ok) {
        got += 1;
        this.c.profile.stats.correct += 1;
        this.c.track?.('correct');
        this.chain(10);
      } else {
        this.bonusFail('noMiss');
        if (this.loseHeart('Wrong answer')) return;
      }
      this.c.ui.setHearts(this.hearts, MAX_HEARTS);
    }
    if (epoch === this.epoch) await this.advance();
  }

  // ------------------------------------------------------------------ places

  /** Turns a "where" into a standing spot in front of the place. */
  resolve(w: Where, label: string, item = false): Spot {
    const world = this.c.world;
    // Items sit beside the door, not in front of it; `beside` shifts further along the wall.
    const side = (item ? 1.8 : 0) + ('beside' in w ? w.beside ?? 0 : 0);
    const fromEntrance = (b: ReturnType<typeof findBuilding>, signLabel?: string): Spot | null => {
      if (!b) return null;
      const e = world.entranceFor(b, signLabel);
      const sx = Math.cos(e.facing) * side;
      const sz = -Math.sin(e.facing) * side;
      return { x: e.x + sx, z: e.z + sz, facing: e.facing };
    };
    /** Just outside the wall of `pts` nearest to (x, z), facing away from the building. */
    const outsideWall = (x: number, z: number, pts: Pt[]): Spot => {
      let best = segDist(x, z, pts[0], pts[1]);
      let bi = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const r = segDist(x, z, pts[i], pts[(i + 1) % pts.length]);
        if (r.d < best.d) {
          best = r;
          bi = i;
        }
      }
      const a = pts[bi];
      const b = pts[(bi + 1) % pts.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      let nx = (b[1] - a[1]) / len;
      let nz = -(b[0] - a[0]) / len;
      if (pointInPoly(best.px + nx * 0.5, best.pz + nz * 0.5, pts)) {
        nx = -nx;
        nz = -nz;
      }
      const out = 1.6;
      return { x: best.px + nx * out - nz * side, z: best.pz + nz * out + nx * side, facing: Math.atan2(nx, nz) };
    };
    if ('xz' in w) return { x: w.xz[0], z: w.xz[1], facing: 0 };
    if ('building' in w) {
      let b = w.building ? findBuilding(w.building) : undefined;
      const p = w.poi ? findPoint(w.poi) : undefined;
      if (!b && p) b = buildingAt(p.x, p.z);
      const s = fromEntrance(b, w.label);
      if (s) return s;
      if (p) return { x: p.x, z: p.z + 3, facing: 0 };
    } else if ('point' in w) {
      const p = findPoint(w.point);
      if (p) {
        const x = p.x + (w.dx ?? 0);
        const z = p.z + (w.dz ?? 0);
        const inside = DATA.buildings.find((b) => pointInPoly(x, z, b.pts));
        if (inside) {
          if (w.outside === 'wall') return outsideWall(x, z, inside.pts);
          const s = fromEntrance(inside);
          if (s) return s;
        }
        return { x, z, facing: Math.atan2(-x, -z) };
      }
    } else if ('area' in w) {
      const a = findArea(w.area);
      if (a) {
        let [x, z] = centroid(a.pts);
        if (!pointInPoly(x, z, a.pts)) [x, z] = a.pts[0];
        return { x, z, facing: 0 };
      }
    }
    console.warn(`Campus Quest: could not place "${label}"`);
    return { x: 100, z: -120, facing: 0 };
  }
}

/** Points every `spacing` metres along a polyline (from the second point on: the first ring is ahead of the start). */
export function resample(route: Pt[], spacing: number): Pt[] {
  const out: Pt[] = [];
  let carry = spacing * 0.6;
  for (let i = 1; i < route.length; i += 1) {
    const [ax, az] = route[i - 1];
    const [bx, bz] = route[i];
    const len = Math.hypot(bx - ax, bz - az);
    let s = carry;
    while (s <= len) {
      out.push([ax + ((bx - ax) * s) / len, az + ((bz - az) * s) / len]);
      s += spacing;
    }
    carry = s - len;
  }
  const last = route[route.length - 1];
  const tail = out[out.length - 1];
  if (!tail || Math.hypot(tail[0] - last[0], tail[1] - last[1]) > spacing * 0.4) out.push([last[0], last[1]]);
  return out;
}
