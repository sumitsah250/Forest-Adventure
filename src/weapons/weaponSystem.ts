// The player's weapons: inventory and ammunition, drawing/holstering/switching,
// aiming, firing, reloading, pump and bolt actions, recoil, and the placement of
// the gun and hands on the character every frame.
//
// Aim: a ray from the camera through the screen centre finds the aim point
// (first thing hit, world or target). Shots leave the real muzzle toward that
// point, so what the crosshair covers is what gets hit, and anything between
// the muzzle and the target (a trunk beside you, a wall) takes the shot instead.

import * as THREE from 'three';
import { AMMO_MAX, AMMO_NAMES, WEAPONS, WEAPON_ORDER, type AmmoType, type WeaponDef, type WeaponId } from './defs.ts';
import { buildWeaponModel, type WeaponModel } from './models.ts';
import { UP, handOn, holdPoles, holdTransform, lookQuat, placeAnchor, smooth } from './hold.ts';
import type { Combat, Hittable, ShotHit } from './combat.ts';
import type { Effects } from './effects.ts';
import type { Animator, HandTargets } from '../character/animator.ts';
import type { Player } from '../player/player.ts';
import type { AudioEngine, GunMech } from '../audio/audio.ts';
import type { Input, Action } from '../core/input.ts';

const DEG = Math.PI / 180;

type Phase = 'holstered' | 'drawing' | 'ready' | 'holstering';

interface Owned {
  def: WeaponDef;
  model: WeaponModel;
  mag: number;
  /** Pump/bolt guns: a round is chambered and ready. */
  chambered: boolean;
  /** Bind-pose transforms of moving parts (for animation offsets). */
  rest: Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>;
}

interface Reload {
  t: number;
  dur: number;
  empty: boolean;
  /** Rounds still to insert (tube / internal). */
  rounds: number;
  /** Per-round timer for tube / internal. */
  roundT: number;
  stage: 'open' | 'rounds' | 'close' | 'single';
  cues: Set<string>;
}

export interface WeaponHudState {
  name: string;
  category: string;
  mag: number;
  magSize: number;
  reserve: number;
  ammo: string;
  fire: string;
  reloading: number | null;
  slots: { slot: number; id: WeaponId; owned: boolean; current: boolean; short: string }[];
  /** Crosshair spread in screen pixels and state. */
  spreadPx: number;
  crosshair: 'none' | 'dot' | 'weapon' | 'blocked' | 'target';
  scoped: boolean;
  phase: Phase;
}

export interface SaveWeapons {
  owned: [WeaponId, number][];
  reserve: Partial<Record<AmmoType, number>>;
  current: WeaponId | null;
}


/** Piecewise-linear keyframes: value at t from [t, value] pairs. */
function keys(t: number, k: [number, number][]): number {
  if (t <= k[0][0]) return k[0][1];
  for (let i = 0; i < k.length - 1; i += 1) {
    if (t <= k[i + 1][0]) return THREE.MathUtils.lerp(k[i][1], k[i + 1][1], smooth((t - k[i][0]) / (k[i + 1][0] - k[i][0])));
  }
  return k[k.length - 1][1];
}

export class WeaponSystem {
  readonly owned = new Map<WeaponId, Owned>();
  readonly reserve: Record<AmmoType, number> = { '9mm': 0, '.44': 0, '12ga': 0, '5.56': 0, '7.62': 0, '.30-06': 0 };
  current: WeaponId | null = null;
  phase: Phase = 'holstered';
  private drawT = 0;
  private pending: WeaponId | null = null;
  private lastSide: WeaponId | null = null;
  private lastLong: WeaponId | null = null;
  aimBlend = 0;
  private sprintBlend = 0;
  private reload: Reload | null = null;
  private cycleT = 0;
  /** Pump/bolt action animation 0..1 (1 = idle). */
  private actionT = 1;
  private actionDur = 1;
  private bloom = 0;
  private kick = 0;
  private kickVel = 0;
  private recoilDebt = 0;
  private semiLatch = false;
  private sinceShot = 10;
  private cylinderAngle = 0;
  private hammer = 0;
  private slideBack = 0;
  private swayT = 0;
  private steady = 0;
  private breath = 1;
  readonly aimPoint = new THREE.Vector3();
  /** Tests: fixed aim point (the camera may be elsewhere). */
  aimOverride: THREE.Vector3 | null = null;
  aimTarget: Hittable | null = null;
  muzzleBlocked = false;
  /** Statistics for the ending screen. */
  shotsFired = 0;
  shotsHit = 0;
  /** Busy (dialogue, menus): input ignored. */
  locked = false;
  private player: Player;
  private combat: Combat;
  private effects: Effects;
  private audio: AudioEngine;
  private camera: THREE.PerspectiveCamera;
  private shooter = { kind: 'player' as const, id: 'player', position: new THREE.Vector3() };
  onHit: ((hit: ShotHit, defeated: boolean) => void) | null = null;
  onNotice: ((text: string) => void) | null = null;
  onAcquire: ((def: WeaponDef) => void) | null = null;
  onShot: ((def: WeaponDef) => void) | null = null;
  onReloaded: ((def: WeaponDef) => void) | null = null;
  onEquip: ((id: WeaponId | null) => void) | null = null;

  constructor(player: Player, combat: Combat, effects: Effects, audio: AudioEngine, camera: THREE.PerspectiveCamera) {
    this.player = player;
    this.combat = combat;
    this.effects = effects;
    this.audio = audio;
    this.camera = camera;
    player.hands = (a) => this.pose(a);
  }

  // ------------------------------------------------------------ inventory

  has(id: WeaponId): boolean {
    return this.owned.has(id);
  }

  /** Adds a weapon (with its starting reserve) or, if owned, its ammunition. */
  give(id: WeaponId, opts: { reserve?: number; loaded?: boolean; silent?: boolean } = {}): void {
    const def = WEAPONS[id];
    const add = opts.reserve ?? def.startReserve;
    if (!this.owned.has(id)) {
      const model = buildWeaponModel(id);
      const rest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>();
      for (const part of Object.values(model.parts)) if (part) rest.set(part, { p: part.position.clone(), q: part.quaternion.clone() });
      const o: Owned = { def, model, mag: opts.loaded === false ? 0 : def.magSize, chambered: opts.loaded !== false, rest };
      this.owned.set(id, o);
      this.attachHolstered(o);
      if (def.hold === 'pistol') this.lastSide ??= id;
      else this.lastLong ??= id;
      if (!opts.silent) this.onAcquire?.(def);
    }
    this.addAmmo(def.ammo, add);
    this.refreshHolsters();
  }

  addAmmo(type: AmmoType, n: number): number {
    const before = this.reserve[type];
    this.reserve[type] = Math.min(AMMO_MAX[type], before + n);
    return this.reserve[type] - before;
  }

  get currentDef(): WeaponDef | null {
    return this.current ? WEAPONS[this.current] : null;
  }

  private get cur(): Owned | null {
    return this.current ? this.owned.get(this.current) ?? null : null;
  }

  /** Request a weapon in hand (switching through a holster if needed). */
  select(id: WeaponId): void {
    if (!this.owned.has(id)) return;
    if (this.current === id) {
      if (this.phase === 'holstering' || this.phase === 'holstered') this.beginDraw(id);
      return;
    }
    this.cancelReload();
    if (this.current && this.phase !== 'holstered') {
      this.pending = id;
      this.beginHolster();
    } else this.beginDraw(id);
  }

  holster(): void {
    if (!this.current || this.phase === 'holstered' || this.phase === 'holstering') return;
    this.cancelReload();
    this.pending = null;
    this.beginHolster();
  }

  /** Immediately put everything away (entering vehicles, cutscenes). */
  forceHolster(): void {
    this.cancelReload();
    this.pending = null;
    if (this.current) {
      this.phase = 'holstered';
      this.drawT = 0;
      const o = this.cur;
      if (o) this.attachHolstered(o);
    }
    this.aimBlend = 0;
    this.refreshHolsters();
  }

  private beginDraw(id: WeaponId): void {
    this.current = id;
    this.phase = 'drawing';
    const o = this.cur!;
    if (o.def.hold === 'pistol') this.lastSide = id;
    else this.lastLong = id;
    // In-hand guns live under the character root and are posed every frame.
    this.player.character?.root.add(o.model.root);
    this.audio.gunMech('draw', this.player.renderPos);
    this.refreshHolsters();
    this.onEquip?.(id);
  }

  private beginHolster(): void {
    this.phase = 'holstering';
    this.audio.gunMech('holster', this.player.renderPos);
  }

  private holsterMount(o: Owned): { bone: 'thigh.R' | 'chest'; p: THREE.Vector3; q: THREE.Quaternion } {
    if (o.def.hold === 'pistol') {
      // Right thigh holster, muzzle down, grip back and up.
      return { bone: 'thigh.R', p: new THREE.Vector3(-0.085, -0.17, -0.005), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + 0.15, 0, 0)) };
    }
    // Slung across the back: muzzle up over the left shoulder.
    const fwd = new THREE.Vector3(0.42, 0.9, -0.08).normalize();
    const up = new THREE.Vector3(0, 0, -1);
    return { bone: 'chest', p: new THREE.Vector3(0.0, 0.08, -0.215), q: lookQuat(fwd, up) };
  }

  private attachHolstered(o: Owned): void {
    const ch = this.player.character;
    if (!ch) return;
    const m = this.holsterMount(o);
    const bone = ch.bones[m.bone];
    bone.add(o.model.root);
    o.model.root.position.copy(m.p);
    o.model.root.quaternion.copy(m.q);
    this.resetParts(o);
  }

  /** Only the latest sidearm and long gun are visible on the body. */
  private refreshHolsters(): void {
    for (const [id, o] of this.owned) {
      const inHand = id === this.current && this.phase !== 'holstered';
      o.model.root.visible = inHand || id === this.lastSide || id === this.lastLong;
    }
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, input: Input, active: boolean): void {
    this.shooter.position.copy(this.player.renderPos);
    this.cycleT = Math.max(0, this.cycleT - dt);
    this.sinceShot += dt;
    const o = this.cur;
    const busyMenu = this.locked || !active;
    // Weapon selection.
    if (!busyMenu) {
      for (let i = 0; i < 8; i += 1) {
        if (input.pressed(`weapon${i + 1}` as Action)) {
          const id = WEAPON_ORDER[i];
          if (!this.owned.has(id)) this.onNotice?.(`Slot ${i + 1}: not found yet`);
          else if (this.current === id && this.phase === 'ready') this.holster();
          else this.select(id);
        }
      }
      if (input.pressed('holster')) {
        if (this.phase === 'holstered') {
          const back = this.current ?? this.lastSide ?? this.lastLong;
          if (back) this.select(back);
        } else this.holster();
      }
      const wheel = input.pressed('nextWeapon') ? 1 : input.pressed('prevWeapon') ? -1 : 0;
      if (wheel && this.owned.size) {
        const list = WEAPON_ORDER.filter((id) => this.owned.has(id));
        const idx = this.current ? list.indexOf(this.current) : -1;
        this.select(list[(idx + wheel + list.length) % list.length]);
      }
    }
    // Draw / holster progress.
    if (o) {
      const speed = o.def.hold === 'pistol' ? 1 / 0.35 : 1 / 0.55;
      if (this.phase === 'drawing') {
        this.drawT = Math.min(1, this.drawT + dt * speed);
        if (this.drawT >= 1) this.phase = 'ready';
      } else if (this.phase === 'holstering') {
        this.drawT = Math.max(0, this.drawT - dt * speed * 1.15);
        if (this.drawT <= 0) {
          this.phase = 'holstered';
          this.attachHolstered(o);
          const next = this.pending;
          this.pending = null;
          if (next) this.beginDraw(next);
          else this.onEquip?.(null);
          this.refreshHolsters();
        }
      }
    }
    const ready = this.phase === 'ready' && !!o;
    const drawn = this.phase !== 'holstered' && !!o;
    // Aim and sprint.
    const wantAim = drawn && !busyMenu && input.held('aim') && this.phase !== 'holstering';
    if (wantAim && this.player.sprinting) this.player.sprinting = false;
    const ads = o ? 1 / o.def.adsTime : 5;
    this.aimBlend = THREE.MathUtils.clamp(this.aimBlend + (wantAim ? dt * ads : -dt * 6), 0, 1);
    this.sprintBlend = THREE.MathUtils.damp(this.sprintBlend, this.player.sprinting && drawn && this.aimBlend < 0.1 && !this.reload ? 1 : 0, 8, dt);
    // Player integration: strafe while aiming or shooting; aim camera; no sprint while firing.
    this.player.strafe = drawn && (this.aimBlend > 0.05 || this.sinceShot < 0.8 || !!this.reload);
    this.player.aim = this.aimBlend;
    this.player.aimDistance = o?.def.aimDistance ?? 1.7;
    this.player.aimFovScale = o?.def.aimFov ?? 0.86;
    const scoped = !!o?.def.scopeFov && this.aimBlend > 0.85 && !this.reload && this.phase === 'ready';
    this.player.scope = THREE.MathUtils.damp(this.player.scope, scoped ? 1 : 0, scoped ? 12 : 18, dt);
    this.player.scopeFov = o?.def.scopeFov ?? 14;
    this.player.noSprint = this.sinceShot < 0.5 || this.aimBlend > 0.3;
    // Scope sway, steadied by holding breath (sprint key) for a few seconds.
    if (this.player.scope > 0.5) {
      this.swayT += dt;
      const holding = input.held('sprint') && this.breath > 0;
      this.breath = THREE.MathUtils.clamp(this.breath + (holding ? -dt / 4 : dt / 6), 0, 1);
      this.steady = THREE.MathUtils.damp(this.steady, holding ? 1 : 0, 6, dt);
      const amp = 0.0035 * (1 - this.steady * 0.85) * (1 + (1 - this.breath) * 0.8);
      this.player.yaw += Math.cos(this.swayT * 0.9) * amp * dt * 4;
      this.player.pitch += Math.sin(this.swayT * 1.3) * amp * dt * 3;
    }
    // Aim point: camera ray from the character's depth forward.
    this.updateAim();
    // Reload.
    if (o && !busyMenu && input.pressed('reload') && ready) this.startReload();
    if (this.reload && o) this.stepReload(dt, o);
    // Pump/bolt action.
    if (this.actionT < 1 && o) this.stepAction(dt, o);
    // Firing.
    if (!busyMenu && o) {
      const pull = o.def.fire === 'auto' ? input.held('fire') : input.pressed('fire');
      if (!input.held('fire')) this.semiLatch = false;
      if (pull && !this.semiLatch) {
        if (this.phase === 'holstered') {
          this.select(o.def.id);
          this.semiLatch = true;
        } else if (ready && this.sprintBlend < 0.5) this.tryFire(o);
      }
    } else if (!busyMenu && !o && input.pressed('fire') && (this.lastSide || this.lastLong)) {
      this.select((this.lastSide ?? this.lastLong)!);
      this.semiLatch = true;
    }
    // Recoil springs, bloom recovery, camera recovery.
    this.kickVel += (-this.kick * 260 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;
    if (o) this.bloom = Math.max(0, this.bloom - dt * (o.def.bloomMax > 0 ? o.def.bloomMax * 2.2 : 1));
    if (this.recoilDebt > 0 && this.sinceShot > 0.12) {
      const back = Math.min(this.recoilDebt, dt * 0.09);
      this.player.pitch -= back;
      this.recoilDebt -= back;
    }
    this.hammer = Math.max(0, this.hammer - dt * 8);
    if (o) this.animateParts(o, dt);
  }

  private updateAim(): void {
    if (this.aimOverride) {
      this.aimPoint.copy(this.aimOverride);
      this.aimTarget = null;
      this.muzzleBlocked = false;
      return;
    }
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const head = this.player.eyePosition;
    const start = Math.max(0, head.clone().sub(cam.position).dot(fwd) - 0.2);
    const origin = cam.position.clone().addScaledVector(fwd, start);
    const hit = this.combat.trace(origin, fwd, 600, this.combat.self);
    if (hit) {
      this.aimPoint.copy(hit.point);
      this.aimTarget = hit.target;
    } else {
      this.aimPoint.copy(origin).addScaledVector(fwd, 600);
      this.aimTarget = null;
    }
    // Is the muzzle obstructed short of the aim point?
    this.muzzleBlocked = false;
    const o = this.cur;
    if (o && this.phase === 'ready') {
      const muzzle = this.muzzleWorld(o);
      const dir = this.aimPoint.clone().sub(muzzle);
      const d = dir.length();
      if (d > 0.5) {
        dir.multiplyScalar(1 / d);
        const block = this.combat.traceWorld(muzzle, dir, d - 0.3);
        this.muzzleBlocked = !!block && block.dist < Math.min(3, d * 0.6);
      }
    }
  }

  private muzzleWorld(o: Owned): THREE.Vector3 {
    o.model.root.updateWorldMatrix(true, false);
    return o.model.muzzle.clone().applyMatrix4(o.model.root.matrixWorld);
  }

  // ------------------------------------------------------------ firing

  private tryFire(o: Owned): void {
    const def = o.def;
    if (this.reload) {
      // Shell-by-shell reloads can be interrupted to shoot.
      if ((def.reload === 'tube' || def.reload === 'internal') && o.mag > 0 && this.reload.stage !== 'close') {
        this.reload = null;
        this.semiLatch = true;
        if (def.reload === 'internal') {
          this.audio.gunMech('boltClose', this.player.renderPos);
          o.chambered = true;
        }
      } else return;
    }
    if (this.cycleT > 0 || this.actionT < 1) return;
    if (o.mag <= 0 || ((def.fire === 'pump' || def.fire === 'bolt') && !o.chambered)) {
      this.audio.gunMech('dry', this.player.renderPos);
      this.semiLatch = true;
      if (o.mag <= 0 && this.reserve[def.ammo] > 0) this.startReload();
      else if (o.mag <= 0) this.onNotice?.(`No ${AMMO_NAMES[def.ammo]} ammunition`);
      else if (!o.chambered) this.startAction(o);
      return;
    }
    if (def.fire !== 'auto') this.semiLatch = true;
    o.mag -= 1;
    this.cycleT = def.cycle;
    this.sinceShot = 0;
    this.shotsFired += 1;
    if (def.fire === 'pump' || def.fire === 'bolt') {
      o.chambered = false;
      if (o.mag > 0) this.startAction(o);
    }
    this.fireShot(o);
  }

  private fireShot(o: Owned): void {
    const def = o.def;
    const muzzle = this.muzzleWorld(o);
    const toAim = this.aimPoint.clone().sub(muzzle);
    const baseDir = toAim.lengthSq() > 1e-4 ? toAim.normalize() : this.player.viewForward();
    // A gun pushed into a wall or trunk: the shot stops there.
    const chest = this.player.eyePosition.add(new THREE.Vector3(0, -0.25, 0));
    const toMuzzle = muzzle.clone().sub(chest);
    const ml = toMuzzle.length();
    const blockedAt = ml > 0.05 ? this.combat.traceWorld(chest, toMuzzle.multiplyScalar(1 / ml), ml) : null;
    const moving = Math.min(1, this.player.speed / 4);
    const spreadDeg = THREE.MathUtils.lerp(def.spreadHip, def.spreadAim, this.aimBlend) + this.bloom + moving * THREE.MathUtils.lerp(1.6, 0.5, this.aimBlend) + (this.player.grounded ? 0 : 2);
    let anyHit = false;
    let defeated = false;
    const right = new THREE.Vector3().crossVectors(baseDir, UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, baseDir).normalize();
    for (let i = 0; i < def.pellets; i += 1) {
      // Uniform sample inside the spread cone.
      const r = Math.sqrt(Math.random()) * Math.tan(spreadDeg * DEG);
      const a = Math.random() * Math.PI * 2;
      const dir = baseDir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const hit = blockedAt ?? this.combat.trace(muzzle, dir, def.maxRange * 1.6, this.combat.self);
      if (i < 2 || def.pellets === 1) this.effects.tracer(muzzle, hit ? hit.point : muzzle.clone().addScaledVector(dir, 120));
      if (!hit) continue;
      const fall = hit.dist <= def.range ? 1 : THREE.MathUtils.lerp(1, 0.55, THREE.MathUtils.clamp((hit.dist - def.range) / (def.maxRange - def.range), 0, 1));
      const beyond = hit.dist > def.maxRange * 1.3 ? 0.35 : 1;
      if (hit.target) {
        const mult = hit.part === 'head' ? def.headMultiplier : hit.part === 'limb' ? 0.7 : 1;
        const dmg = def.damage * fall * beyond * mult;
        const wasActive = hit.target.active;
        hit.target.onHit(hit, dmg, def, this.shooter);
        anyHit = true;
        if (wasActive && !hit.target.active) defeated = true;
        this.effects.impact(hit.point, hit.normal, hit.surface, def.pellets > 1 ? 0.5 : 1, hit.surface === 'steel');
        if (i === 0 || defeated) this.onHit?.(hit, defeated);
      } else {
        this.effects.impact(hit.point, hit.normal, hit.surface, def.pellets > 1 ? 0.4 : 1, i % 3 === 0);
      }
      if (i < 3) this.audio.bulletImpact(hit.surface, hit.point);
      this.combat.noise(hit.point, 14, 'player', 'impact');
    }
    if (anyHit) {
      this.shotsHit += 1;
      this.audio.hitTick(defeated);
    }
    // Feedback: flash, sound, brass, recoil.
    const flashSize = def.hold === 'pistol' ? (def.id === 'bridger' ? 0.32 : 0.2) : def.pellets > 1 ? 0.42 : def.ammo === '5.56' || def.ammo === '9mm' ? 0.28 : 0.38;
    this.effects.muzzleFlash(muzzle, baseDir, flashSize, this.camera);
    this.audio.gunshot(def.sound, muzzle, true);
    this.combat.noise(muzzle, 150, 'player', 'gunshot');
    if (def.reload === 'magazine') this.ejectCase(o);
    if (def.id === 'bridger') this.hammer = 1;
    if (def.id === 'p9') this.slideBack = 1;
    const aimDamp = 1 - this.aimBlend * 0.35;
    const kickP = def.recoilPitch * DEG * aimDamp * (0.85 + Math.random() * 0.3);
    this.player.pitch += kickP;
    this.recoilDebt += kickP * (def.fire === 'auto' ? 0.35 : 0.6);
    this.player.yaw += (Math.random() - 0.5) * 2 * def.recoilYaw * DEG * aimDamp;
    this.kickVel += 9 + def.kick * 90;
    this.bloom = Math.min(def.bloomMax, this.bloom + def.bloom);
    this.player.tpc.shake = Math.max(this.player.tpc.shake, def.recoilPitch * 0.12);
    if (def.id === 'bridger') this.cylinderAngle += Math.PI / 3;
    this.onShot?.(def);
  }

  private ejectCase(o: Owned): void {
    o.model.root.updateWorldMatrix(true, false);
    const m = o.model.root.matrixWorld;
    const p = o.model.ejection.clone().applyMatrix4(m);
    const q = new THREE.Quaternion().setFromRotationMatrix(m);
    const right = new THREE.Vector3(-1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const def = o.def;
    this.effects.eject(p, right, up, back, def.ammo === '12ga' ? 1.6 : def.ammo === '9mm' ? 0.75 : def.ammo === '7.62' || def.ammo === '.30-06' ? 1.25 : 1);
  }

  private startAction(o: Owned): void {
    this.actionDur = o.def.cycle;
    this.actionT = 0;
    void o;
  }

  private stepAction(dt: number, o: Owned): void {
    const before = this.actionT;
    this.actionT = Math.min(1, this.actionT + dt / this.actionDur);
    const cross = (x: number) => before < x && this.actionT >= x;
    const pos = this.player.renderPos;
    if (o.def.fire === 'pump') {
      if (cross(0.2)) {
        this.audio.gunMech('pumpBack', pos);
        this.ejectCase(o);
      }
      if (cross(0.6)) this.audio.gunMech('pumpForward', pos);
    } else if (o.def.fire === 'bolt') {
      if (cross(0.25)) {
        this.audio.gunMech('boltOpen', pos);
        this.ejectCase(o);
      }
      if (cross(0.7)) this.audio.gunMech('boltClose', pos);
    }
    if (this.actionT >= 1 && o.mag > 0) o.chambered = true;
  }

  // ------------------------------------------------------------ reloading

  private startReload(): void {
    const o = this.cur;
    if (!o || this.reload || this.phase !== 'ready') return;
    const def = o.def;
    const reserve = this.reserve[def.ammo];
    const full = o.mag >= def.magSize && (o.chambered || (def.fire !== 'pump' && def.fire !== 'bolt'));
    if (full) return;
    if (reserve <= 0) {
      if (o.mag < def.magSize) this.onNotice?.(`No ${AMMO_NAMES[def.ammo]} ammunition`);
      return;
    }
    const empty = o.mag === 0;
    this.actionT = 1;
    if (def.reload === 'magazine') {
      this.reload = { t: 0, dur: def.reloadTime + (empty ? def.emptyExtra : 0), empty, rounds: 0, roundT: 0, stage: 'single', cues: new Set() };
    } else if (def.reload === 'speedloader') {
      this.reload = { t: 0, dur: def.reloadTime, empty, rounds: 0, roundT: 0, stage: 'single', cues: new Set() };
    } else {
      const rounds = Math.min(def.magSize - o.mag, reserve);
      this.reload = { t: 0, dur: 0.3, empty, rounds, roundT: 0, stage: 'open', cues: new Set() };
      if (def.reload === 'internal') this.audio.gunMech('boltOpen', this.player.renderPos);
    }
  }

  private cancelReload(): void {
    this.reload = null;
  }

  private cue(r: Reload, key: string, at: number, fn: () => void): void {
    if (!r.cues.has(key) && r.t >= at) {
      r.cues.add(key);
      fn();
    }
  }

  private stepReload(dt: number, o: Owned): void {
    const r = this.reload!;
    const def = o.def;
    const pos = this.player.renderPos;
    const mech = (m: GunMech) => this.audio.gunMech(m, pos);
    r.t += dt;
    if (def.reload === 'magazine') {
      const f = r.t / r.dur;
      this.cue(r, 'out', r.dur * 0.18, () => mech('magOut'));
      this.cue(r, 'in', r.dur * (r.empty ? 0.58 : 0.66), () => mech('magIn'));
      if (r.empty) this.cue(r, 'rack', r.dur * 0.82, () => mech(def.hold === 'pistol' ? 'slideRelease' : 'slideRack'));
      if (f >= 1) {
        const take = Math.min(def.magSize - o.mag, this.reserve[def.ammo]);
        o.mag += take;
        this.reserve[def.ammo] -= take;
        this.reload = null;
        this.slideBack = 0;
        this.onReloaded?.(def);
      }
      return;
    }
    if (def.reload === 'speedloader') {
      this.cue(r, 'open', r.dur * 0.08, () => mech('cylinderOpen'));
      this.cue(r, 'eject', r.dur * 0.28, () => {
        for (let i = 0; i < 6 - o.mag; i += 1) this.ejectCase(o);
      });
      this.cue(r, 'load', r.dur * 0.62, () => mech('speedloader'));
      this.cue(r, 'close', r.dur * 0.86, () => mech('cylinderClose'));
      if (r.t >= r.dur) {
        const take = Math.min(def.magSize - o.mag, this.reserve[def.ammo]);
        o.mag += take;
        this.reserve[def.ammo] -= take;
        this.reload = null;
        this.onReloaded?.(def);
      }
      return;
    }
    // Tube (shotgun) and internal magazine (bolt rifle): one round at a time.
    if (r.stage === 'open') {
      if (r.t >= r.dur) {
        r.stage = 'rounds';
        r.t = 0;
        r.roundT = 0;
      }
      return;
    }
    if (r.stage === 'rounds') {
      r.roundT += dt;
      if (r.roundT >= def.reloadTime) {
        r.roundT -= def.reloadTime;
        if (this.reserve[def.ammo] > 0 && o.mag < def.magSize) {
          o.mag += 1;
          this.reserve[def.ammo] -= 1;
          r.rounds -= 1;
          mech(def.reload === 'tube' ? 'shellIn' : 'roundIn');
        }
        if (r.rounds <= 0 || o.mag >= def.magSize || this.reserve[def.ammo] <= 0) {
          r.stage = 'close';
          r.t = 0;
          r.dur = def.reload === 'internal' ? 0.4 : r.empty || !o.chambered ? 0.55 : 0.15;
          r.cues.clear();
        }
      }
      return;
    }
    // Close: bolt forward, or rack the pump to chamber the first shell.
    if (def.reload === 'internal') this.cue(r, 'close', 0.15, () => mech('boltClose'));
    else if (!o.chambered) {
      this.cue(r, 'pb', 0.05, () => mech('pumpBack'));
      this.cue(r, 'pf', 0.32, () => mech('pumpForward'));
    }
    if (r.t >= r.dur) {
      o.chambered = o.mag > 0;
      this.reload = null;
      this.onReloaded?.(def);
    }
  }

  /** Normalised reload progress for the HUD (null when not reloading). */
  get reloadProgress(): number | null {
    const r = this.reload;
    const o = this.cur;
    if (!r || !o) return null;
    if (o.def.reload === 'magazine' || o.def.reload === 'speedloader') return Math.min(1, r.t / r.dur);
    const total = o.def.magSize;
    return Math.min(1, o.mag / total);
  }

  // ------------------------------------------------------------ moving parts

  private resetParts(o: Owned): void {
    for (const [part, rest] of o.rest) {
      part.position.copy(rest.p);
      part.quaternion.copy(rest.q);
    }
  }

  private animateParts(o: Owned, dt: number): void {
    const parts = o.model.parts;
    const rest = (p: THREE.Object3D) => o.rest.get(p)!;
    if (parts.slide) {
      // Slide cycles on each shot and locks back on an empty magazine.
      const locked = o.mag === 0 && (!this.reload || (this.reload.t / this.reload.dur) < 0.8);
      this.slideBack = Math.max(locked ? 1 : 0, this.slideBack - dt * 18);
      parts.slide.position.z = rest(parts.slide).p.z - 0.028 * this.slideBack;
    }
    if (parts.hammer) parts.hammer.rotation.x = -0.5 * (1 - this.hammer);
    if (parts.cylinder && parts.crane) {
      parts.cylinder.rotation.z = THREE.MathUtils.damp(parts.cylinder.rotation.z, this.cylinderAngle, 20, dt);
      const r = this.reload;
      const open = r && o.def.reload === 'speedloader' ? keys(r.t / r.dur, [[0, 0], [0.1, 1], [0.84, 1], [0.92, 0]]) : 0;
      parts.crane.rotation.z = open * 1.35;
      parts.crane.position.x = rest(parts.crane).p.x + open * 0.012;
    }
    if (parts.pump) {
      let back = 0;
      if (this.actionT < 1 && o.def.fire === 'pump') back = keys(this.actionT, [[0, 0], [0.18, 0], [0.4, 1], [0.6, 1], [0.8, 0]]);
      const r = this.reload;
      if (r && r.stage === 'close' && o.def.fire === 'pump' && r.dur > 0.3) back = keys(r.t / r.dur, [[0, 0], [0.2, 1], [0.55, 1], [0.8, 0]]);
      parts.pump.position.z = rest(parts.pump).p.z - 0.085 * back;
    }
    if (parts.bolt) {
      let lift = 0;
      let back = 0;
      if (this.actionT < 1 && o.def.fire === 'bolt') {
        lift = keys(this.actionT, [[0, 0], [0.12, 0], [0.25, 1], [0.7, 1], [0.82, 0]]);
        back = keys(this.actionT, [[0, 0], [0.25, 0], [0.4, 1], [0.58, 1], [0.7, 0]]);
      }
      const r = this.reload;
      if (r && o.def.reload === 'internal') {
        if (r.stage === 'open') {
          lift = smooth(r.t / r.dur * 2);
          back = smooth(r.t / r.dur * 2 - 0.5);
        } else if (r.stage === 'rounds') {
          lift = 1;
          back = 1;
        } else {
          back = 1 - smooth(r.t / r.dur * 2);
          lift = 1 - smooth(r.t / r.dur * 2 - 0.6);
        }
      }
      parts.bolt.rotation.z = -lift * 1.1;
      parts.bolt.position.z = rest(parts.bolt).p.z - back * 0.075;
    }
  }

  // ------------------------------------------------------------ posing

  /** Hands callback for the animator: places the gun and returns hand targets. */
  private pose(a: Animator): HandTargets | null {
    const o = this.cur;
    if (!o || this.phase === 'holstered') return null;
    const def = o.def;
    const m = o.model;
    const aimC = a.toChar(this.aimPoint);
    const pos = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const tmpP = new THREE.Vector3();
    const tmpQ = new THREE.Quaternion();
    const place = (anchor: THREE.Vector3, at: THREE.Vector3, rot: THREE.Quaternion, outP: THREE.Vector3) => placeAnchor(anchor, at, rot, outP);
    holdTransform(a, m, def, aimC, this.aimBlend, this.sprintBlend, pos, q);
    // Reload choreography: tilt and lower the gun, move the support hand.
    const r = this.reload;
    let leftOverride: THREE.Vector3 | null = null;
    let rightOverride: THREE.Vector3 | null = null;
    let magInHand = false;
    if (r) {
      const tilt = new THREE.Quaternion();
      let lower = 0;
      if (def.reload === 'magazine') {
        const f = r.t / r.dur;
        const roll = keys(f, [[0, 0], [0.12, 1], [0.8, 1], [0.95, 0]]);
        tilt.setFromEuler(new THREE.Euler(-0.18 * roll, 0, -0.45 * roll));
        lower = 0.06 * roll;
        // Hand: to the magazine, down to the belt pouch, back to the well.
        const well = m.magWell;
        const pouch = new THREE.Vector3(0.17, 0.95, 0.12);
        const handTo = keys(f, [[0, 0], [0.14, 1], [0.24, 1], [0.38, 2], [0.48, 2], [0.62, 1], [0.7, 1], [0.86, 0]]);
        magInHand = f > 0.16 && f < 0.64;
        const qq = q.clone().multiply(tilt);
        const wellC = place(new THREE.Vector3(), pos.clone().add(new THREE.Vector3(0, -lower, 0)), qq, new THREE.Vector3()).add(well.clone().applyQuaternion(qq));
        if (handTo <= 1) leftOverride = this.foreChar(o, pos, qq).lerp(wellC, handTo);
        else leftOverride = wellC.clone().lerp(pouch, handTo - 1);
        if (r.empty && def.hold === 'rifle' && f > 0.72 && f < 0.86) {
          // Charging handle / bolt release with the support hand.
          leftOverride = place(new THREE.Vector3(), pos, qq, new THREE.Vector3()).add(new THREE.Vector3(0, 0.07, -0.05).applyQuaternion(qq));
        }
      } else if (def.reload === 'speedloader') {
        const f = r.t / r.dur;
        const up = keys(f, [[0, 0], [0.12, 0], [0.24, 1], [0.34, 1], [0.44, 0]]);
        const roll = keys(f, [[0, 0], [0.1, 1], [0.86, 1], [0.95, 0]]);
        tilt.setFromEuler(new THREE.Euler(-1.2 * up, 0, 0.5 * roll));
        lower = 0.05 * roll;
        const pouch = new THREE.Vector3(0.16, 0.98, 0.14);
        const handTo = keys(f, [[0, 0], [0.42, 0], [0.52, 1], [0.6, 1], [0.7, 0], [0.92, 0]]);
        const qq = q.clone().multiply(tilt);
        const cyl = pos.clone().add(new THREE.Vector3(0, -lower, 0)).add(new THREE.Vector3(0.04, 0.03, -0.03).applyQuaternion(qq));
        leftOverride = cyl.clone().lerp(pouch, handTo);
      } else {
        // Shell by shell: gun canted, support hand from belt to the loading port.
        const roll = r.stage === 'close' ? 1 - smooth(r.t / Math.max(0.01, r.dur) * 1.4) : r.stage === 'open' ? smooth(r.t / r.dur) : 1;
        tilt.setFromEuler(new THREE.Euler(-0.15 * roll, 0, def.reload === 'tube' ? 0.6 * roll : -0.35 * roll));
        lower = 0.05 * roll;
        const qq = q.clone().multiply(tilt);
        const port = pos.clone().add(new THREE.Vector3(0, -lower, 0)).add(m.magWell.clone().applyQuaternion(qq));
        const pouch = new THREE.Vector3(0.16, 1.0, 0.16);
        if (r.stage === 'rounds') {
          const c = r.roundT / o.def.reloadTime;
          leftOverride = port.clone().lerp(pouch, keys(c, [[0, 0], [0.4, 1], [0.55, 1], [0.95, 0]]));
        } else if (r.stage === 'close' && def.reload === 'tube') {
          leftOverride = null;
        } else leftOverride = port;
        if (def.reload === 'internal' && (r.stage === 'open' || r.stage === 'close')) {
          // Right hand works the bolt.
          rightOverride = pos.clone().add(new THREE.Vector3(-0.05, 0.0, -0.05).applyQuaternion(qq));
        }
      }
      pos.y -= lower;
      q.multiply(tilt);
    }
    // Bolt cycling after a shot: right hand to the bolt handle and back.
    if (this.actionT < 1 && def.fire === 'bolt') {
      const k = keys(this.actionT, [[0, 0], [0.12, 1], [0.82, 1], [1, 0]]);
      const boltC = pos.clone().add(new THREE.Vector3(-0.05, 0.005, -0.05 - 0.06 * keys(this.actionT, [[0.25, 0], [0.4, 1], [0.58, 1], [0.7, 0]])).applyQuaternion(q));
      rightOverride = boltC.lerp(this.gripChar(o, pos, q), 1 - k);
    }
    // Recoil kick: back along the bore and muzzle up.
    const kick = this.kick;
    if (Math.abs(kick) > 1e-4) {
      const back = new THREE.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(kick * def.kick);
      pos.add(back);
      q.multiply(tmpQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -kick * def.kickRot));
    }
    // Draw / holster: blend from the holster mount.
    const d = smooth(this.drawT);
    if (d < 1) {
      const mount = this.holsterMount(o);
      a.attach(mount.bone, mount.p, mount.q, tmpP, tmpQ);
      pos.lerpVectors(tmpP, pos, d);
      q.slerpQuaternions(tmpQ, q, d);
    }
    m.root.position.copy(pos);
    m.root.quaternion.copy(q);
    // Magazine follows the support hand during a magazine change.
    if (m.parts.mag) {
      const rest = o.rest.get(m.parts.mag)!;
      if (magInHand && leftOverride) {
        const local = leftOverride.clone().sub(pos).applyQuaternion(q.clone().invert());
        m.parts.mag.position.copy(local).sub(m.magWell).add(rest.p).add(new THREE.Vector3(0, -0.02, 0));
      } else m.parts.mag.position.copy(rest.p);
    }
    // Hands.
    const right = handOn(m.grip, pos, q, rightOverride);
    // Support hand joins once the gun is mostly drawn; free while sprinting with a pistol.
    let left: HandTargets['left'] = null;
    const supportOn = d > 0.65 && !(def.hold === 'pistol' && this.sprintBlend > 0.5) && !(def.hold === 'pistol' && this.aimBlend < 0.15 && !r && this.player.speed > 3.5);
    if (supportOn) left = leftOverride ? { pos: leftOverride.clone(), dir: new THREE.Vector3(-0.5, -0.2, 0.8).normalize().applyQuaternion(q), thumb: new THREE.Vector3(0, 1, 0).applyQuaternion(q) } : handOn(m.fore, pos, q);
    return { right, left, ...holdPoles(this.aimBlend) };
  }

  private gripChar(o: Owned, pos: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
    return o.model.grip.pos.clone().applyQuaternion(q).add(pos);
  }

  private foreChar(o: Owned, pos: THREE.Vector3, q: THREE.Quaternion): THREE.Vector3 {
    return o.model.fore.pos.clone().applyQuaternion(q).add(pos);
  }

  // ------------------------------------------------------------ HUD & save

  hudState(): WeaponHudState | null {
    const o = this.cur;
    const slots = WEAPON_ORDER.map((id) => ({ slot: WEAPONS[id].slot, id, owned: this.owned.has(id), current: id === this.current && this.phase !== 'holstered', short: WEAPONS[id].name }));
    if (!o || this.phase === 'holstered') {
      if (!this.owned.size) return null;
      return { name: '', category: '', mag: 0, magSize: 0, reserve: 0, ammo: '', fire: '', reloading: null, slots, spreadPx: 0, crosshair: 'dot', scoped: false, phase: this.phase };
    }
    const def = o.def;
    const spreadDeg = THREE.MathUtils.lerp(def.spreadHip, def.spreadAim, this.aimBlend) + this.bloom + Math.min(1, this.player.speed / 4) * THREE.MathUtils.lerp(1.6, 0.5, this.aimBlend);
    const fovRad = this.camera.fov * DEG;
    const px = (Math.tan(spreadDeg * DEG) / Math.tan(fovRad / 2)) * (window.innerHeight / 2);
    const fireLabel = def.fire === 'auto' ? 'Automatic' : def.fire === 'pump' ? 'Pump action' : def.fire === 'bolt' ? 'Bolt action' : def.fire === 'double-action' ? 'Double action' : 'Semi-automatic';
    return {
      name: def.name, category: def.category, mag: o.mag, magSize: def.magSize, reserve: this.reserve[def.ammo], ammo: AMMO_NAMES[def.ammo],
      fire: fireLabel, reloading: this.reloadProgress, slots, spreadPx: px,
      crosshair: this.sprintBlend > 0.5 || this.phase !== 'ready' ? 'dot' : this.muzzleBlocked ? 'blocked' : this.aimTarget?.active ? 'target' : 'weapon',
      scoped: this.player.scope > 0.6, phase: this.phase,
    };
  }

  serialize(): SaveWeapons {
    return {
      owned: [...this.owned.values()].map((o) => [o.def.id, o.mag]),
      reserve: { ...this.reserve },
      current: this.phase === 'holstered' ? null : this.current,
    };
  }

  restore(s: SaveWeapons): void {
    for (const [id, mag] of s.owned) {
      if (!WEAPONS[id]) continue;
      this.give(id, { reserve: 0, silent: true });
      const o = this.owned.get(id)!;
      o.mag = Math.min(mag, o.def.magSize);
      o.chambered = o.mag > 0;
    }
    for (const [k, v] of Object.entries(s.reserve)) this.reserve[k as AmmoType] = Math.min(AMMO_MAX[k as AmmoType], v ?? 0);
    if (s.current && this.owned.has(s.current)) {
      this.beginDraw(s.current);
      this.drawT = 1;
      this.phase = 'ready';
    }
  }
}
