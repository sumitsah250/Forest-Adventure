// Hostile NPCs: the poachers. They share the player's humanoid rig, procedural
// animator and weapon-hold code, carry real weapon models, and shoot through the
// same combat trace, so trunks, rocks and vehicles are cover for both sides.
//
// Behaviour is a small state machine:
//   idle / patrol -> suspicious (glimpsed someone, heard a shot) -> investigate
//   -> combat: take cover, peek, aim with a visible wind-up, short bursts,
//      reload behind cover, re-position when flanked, hunt the last known spot
//   -> down: at zero health they surrender (kneel, hands on head, gun dropped).
// Perception: a vision cone (shorter at dusk and against a crouching player),
// line-of-sight rays, awareness that builds over time; gunshots and rounds
// striking nearby are heard. Allies alert each other.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData } from '../world/terrain.ts';
import { createHumanoid, type Humanoid, type Outfit } from '../character/humanoid.ts';
import { Animator } from '../character/animator.ts';
import { buildWeaponModel, type WeaponModel } from '../weapons/models.ts';
import { WEAPONS, type WeaponDef, type WeaponId } from '../weapons/defs.ts';
import { handOn, holdPoles, holdTransform } from '../weapons/hold.ts';
import { rayCapsule, raySphere, type Combat, type Hittable, type PartHit, type ShotHit, type Shooter } from '../weapons/combat.ts';
import type { Effects } from '../weapons/effects.ts';
import type { AudioEngine } from '../audio/audio.ts';

const HALF = 0.56;
const RAD = 0.3;
/** NPC rounds hurt less than the player's: one ranger against a whole crew. */
const NPC_DAMAGE = 0.36;

export type NpcState = 'idle' | 'patrol' | 'suspicious' | 'combat' | 'return' | 'down';
type Phase = 'move' | 'duck' | 'aim' | 'fire' | 'reload' | 'hunt';

export interface NpcSpec {
  id: string;
  name?: string;
  outfit: Outfit;
  weapon: WeaponId;
  /** Post (feet position; y is taken from the ground unless given, e.g. a tree stand). */
  x: number;
  z: number;
  y?: number;
  /** Heading: the body faces (sin f, 0, cos f). */
  facing: number;
  health?: number;
  /** 0 (wild) .. 1 (marksman). */
  accuracy?: number;
  patrol?: [number, number][];
  /** Vision range in metres (daylight, standing target). */
  sight?: number;
  /** Stays within this distance of the post. */
  leash?: number;
  boss?: boolean;
  /** Starts crouched at a lookout position. */
  crouched?: boolean;
}

export interface PlayerInfo {
  pos: THREE.Vector3;
  head: THREE.Vector3;
  chest: THREE.Vector3;
  vel: THREE.Vector3;
  crouch: number;
  /** On foot and in the world (not in a vehicle, not downed). */
  exposed: boolean;
}

export interface NpcWorld {
  physics: PhysicsWorld;
  terrain: TerrainData;
  combat: Combat;
  effects: Effects;
  audio: AudioEngine;
  camera: THREE.Camera;
  scene: THREE.Scene;
  player: PlayerInfo;
  dusk: number;
  damagePlayer(amount: number, from: THREE.Vector3): void;
  bark(npc: Npc, line: string): void;
}

const LINES = {
  spotted: ['Hey! Over there!', 'Someone\'s in the trees!', 'It\'s the ranger!', 'We\'ve got company!', 'There! By the trunk!'],
  suspicious: ['What was that?', 'You hear that?', 'Somebody out there?'],
  hit: ['Agh!', 'I\'m hit!', 'Damn it!'],
  reload: ['Reloading!', 'Cover me!'],
  lost: ['Where\'d the ranger go?', 'Anybody see where they went?'],
  surrender: ['Okay, okay! I\'m done!', 'Don\'t shoot! I give up!', 'Enough! I\'m out!', 'All right! Hands up, see?'],
};

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function randomInSphere(r: number): THREE.Vector3 {
  const v = new THREE.Vector3();
  do v.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
  while (v.lengthSq() > 1);
  return v.multiplyScalar(r);
}

export class NpcGroup {
  readonly id: string;
  readonly members: Npc[] = [];
  readonly cover: THREE.Vector3[];
  onDefeated: ((n: Npc) => void) | null = null;
  onAllDown: (() => void) | null = null;
  onEngage: (() => void) | null = null;
  engaged = false;
  readonly lastSeen = new THREE.Vector3();

  constructor(id: string, cover: THREE.Vector3[]) {
    this.id = id;
    this.cover = cover;
  }

  get alive(): number {
    return this.members.filter((m) => m.state !== 'down').length;
  }

  /** Bring every other member into the fight after a short reaction delay. */
  alertAll(from: Npc | null, pos: THREE.Vector3): void {
    this.lastSeen.copy(pos);
    if (!this.engaged) {
      this.engaged = true;
      this.onEngage?.();
    }
    for (const m of this.members) if (m !== from) m.alert(pos, 0.35 + Math.random() * 0.9);
  }

  coverTaken(p: THREE.Vector3, by: Npc): boolean {
    return this.members.some((m) => m !== by && m.state !== 'down' && m.cover && m.cover.distanceTo(p) < 1.4);
  }
}

export class Npc implements Hittable {
  readonly id: string;
  readonly spec: NpcSpec;
  readonly def: WeaponDef;
  readonly human: Humanoid;
  readonly anim: Animator;
  readonly weapon: WeaponModel;
  readonly group: NpcGroup;
  private body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  readonly pos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  readonly renderPos = new THREE.Vector3();
  readonly post = new THREE.Vector3();
  private vel = new THREE.Vector3();
  private vVel = 0;
  private grounded = true;
  facing: number;
  state: NpcState = 'idle';
  private phase: Phase = 'duck';
  private phaseT = 0;
  health: number;
  readonly maxHealth: number;
  awareness = 0;
  active = true;
  readonly center = new THREE.Vector3();
  readonly radius = 1.15;
  cover: THREE.Vector3 | null = null;
  private moveTarget: THREE.Vector3 | null = null;
  private moveSpeed = 0;
  private crouch = 0;
  private wantCrouch = 0;
  private aimBlend = 0;
  private wantAim = 0;
  private kick = 0;
  private flinch = 0;
  private staggerT = 0;
  private suppressed = 0;
  private mag: number;
  private burst = 0;
  private shotT = 0;
  private cycles = 0;
  private thinkT = Math.random() * 0.2;
  private seeing = false;
  private seenFor = 0;
  readonly lastSeen = new THREE.Vector3();
  private lastSeenT = -99;
  private alertT = -1;
  private alertPos = new THREE.Vector3();
  private lastNoise = 0;
  private patrolIdx = 0;
  private waitT = 0;
  private progressT = 0;
  private lastGoalDist = 1e9;
  private detourSide = 1;
  private detourT = 0;
  private detourDir = new THREE.Vector3();
  private lookT = 0;
  private lookTarget: THREE.Vector3 | null = null;
  private time = 0;
  private spottedBark = false;
  private shotsThisFight = 0;
  private glint: THREE.Sprite | null = null;
  /** Gun on the ground after surrendering. */
  dropped: THREE.Object3D | null = null;
  private aimPoint = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  onDown: ((n: Npc) => void) | null = null;

  constructor(spec: NpcSpec, group: NpcGroup, physics: PhysicsWorld, terrain: TerrainData, scene: THREE.Scene) {
    this.id = spec.id;
    this.spec = spec;
    this.group = group;
    this.def = WEAPONS[spec.weapon];
    this.physics = physics;
    this.terrain = terrain;
    this.maxHealth = spec.health ?? 100;
    this.health = this.maxHealth;
    this.mag = this.def.magSize;
    this.facing = spec.facing;
    this.human = createHumanoid(spec.outfit);
    this.human.root.name = `npc-${spec.id}`;
    scene.add(this.human.root);
    const ground = (x: number, z: number, fromY: number) => physics.groundHeight(x, z, fromY) ?? terrain.heightAt(x, z);
    this.anim = new Animator(this.human, ground);
    this.weapon = buildWeaponModel(spec.weapon);
    this.human.root.add(this.weapon.root);
    const y = spec.y ?? terrain.heightAt(spec.x, spec.z);
    this.pos.set(spec.x, y, spec.z);
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    this.post.copy(this.pos);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(spec.x, y + HALF + RAD + 0.02, spec.z));
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(HALF, RAD).setCollisionGroups(groups(GROUP.NPC, GROUP.STATIC | GROUP.VEHICLE | GROUP.PLAYER | GROUP.NPC)).setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.03);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((48 * Math.PI) / 180);
    this.controller.enableAutostep(0.4, 0.18, false);
    this.controller.enableSnapToGround(0.5);
    this.controller.setSlideEnabled(true);
    this.state = spec.patrol?.length ? 'patrol' : 'idle';
    this.wantCrouch = spec.crouched ? 0.8 : 0;
    this.crouch = this.wantCrouch;
    if (spec.boss && this.def.scopeFov) {
      // A sliver of light off the scope lens warns the player before a long shot.
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,240,1)');
      g.addColorStop(0.25, 'rgba(255,240,200,0.6)');
      g.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      this.glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      this.glint.scale.setScalar(0.45);
      this.glint.position.set(0, 0.112, 0.31);
      this.glint.visible = false;
      this.weapon.root.add(this.glint);
    }
    this.updateBounds();
  }

  get name(): string {
    return this.spec.name ?? 'Poacher';
  }

  private eye(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.renderPos.x, this.renderPos.y + 1.62 - this.crouch * 0.5, this.renderPos.z);
  }

  private forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  private updateBounds(): void {
    this.center.set(this.renderPos.x, this.renderPos.y + 0.95, this.renderPos.z);
  }

  /** An ally saw the player: join in after `delay` seconds. */
  alert(pos: THREE.Vector3, delay: number): void {
    if (this.state === 'down' || this.state === 'combat') return;
    this.alertPos.copy(pos);
    this.alertT = delay;
  }

  // ------------------------------------------------------------ hits

  raycast(o: THREE.Vector3, d: THREE.Vector3, max: number): PartHit | null {
    if (!this.active) return null;
    const a = this.anim;
    const J = (n: Parameters<Animator['joint']>[0]) => a.toWorld(a.joint(n));
    let best: PartHit | null = null;
    const test = (t: number | null, part: PartHit['part'], axisA: THREE.Vector3, axisB: THREE.Vector3 | null) => {
      if (t === null || t > max || (best && t >= best.dist)) return;
      const p = o.clone().addScaledVector(d, t);
      let n: THREE.Vector3;
      if (axisB) {
        const ab = axisB.clone().sub(axisA);
        const f = THREE.MathUtils.clamp(p.clone().sub(axisA).dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
        n = p.clone().sub(axisA.clone().addScaledVector(ab, f)).normalize();
      } else n = p.clone().sub(axisA).normalize();
      best = { dist: t, part, normal: n, surface: 'cloth' };
    };
    const head = J('head').add(new THREE.Vector3(0, 0.09, 0));
    test(raySphere(o, d, head, 0.12), 'head', head, null);
    const hips = J('hips');
    const neck = J('neck');
    test(rayCapsule(o, d, hips, neck, 0.17), 'body', hips, neck);
    for (const s of ['L', 'R'] as const) {
      const ua = J(`upperArm.${s}`);
      const fa = J(`foreArm.${s}`);
      const hd = J(`hand.${s}`);
      test(rayCapsule(o, d, ua, fa, 0.06), 'limb', ua, fa);
      test(rayCapsule(o, d, fa, hd, 0.05), 'limb', fa, hd);
      const th = J(`thigh.${s}`);
      const sh = J(`shin.${s}`);
      const ft = J(`foot.${s}`);
      test(rayCapsule(o, d, th, sh, 0.08), 'limb', th, sh);
      test(rayCapsule(o, d, sh, ft, 0.06), 'limb', sh, ft);
    }
    return best;
  }

  onHit(_h: ShotHit, damage: number, weapon: WeaponDef | null, shooter: Shooter): void {
    if (!this.active) return;
    this.health -= damage;
    this.flinch = Math.min(1, this.flinch + damage / 35);
    if (weapon && Math.random() < weapon.stagger) this.staggerT = 0.6;
    this.suppressed = 2;
    if (shooter.kind === 'player') {
      this.lastSeen.copy(shooter.position);
      this.lastSeenT = this.time;
      this.awareness = 1;
    }
    this.pendingHit = true;
  }

  private pendingHit = false;

  // ------------------------------------------------------------ physics step

  fixedUpdate(dt: number): void {
    this.prevPos.copy(this.pos);
    let wish = new THREE.Vector3();
    if (this.state !== 'down' && this.moveTarget) {
      const to = this.tmp.copy(this.moveTarget).sub(this.pos).setY(0);
      const d = to.length();
      if (d > 0.3) {
        // Arrive: slow down on the approach instead of overshooting.
        const speed = Math.min(this.moveSpeed, 0.5 + d * 2.2);
        wish = to.multiplyScalar(speed / d);
        if (this.detourT > 0) {
          wish.copy(this.detourDir).multiplyScalar(speed);
          this.detourT -= dt;
        }
      }
      // Stuck: judged by progress toward the goal over ~1 s, not by speed, so
      // braking or turning around never triggers a detour.
      this.progressT += dt;
      if (this.progressT > 0.9) {
        if (d > 1.2 && this.lastGoalDist - d < 0.3 && this.detourT <= 0) {
          this.detourSide = -this.detourSide;
          this.detourDir.set(to.x, 0, to.z).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.detourSide * 1.2);
          this.detourT = 0.8;
        }
        this.lastGoalDist = d;
        this.progressT = 0;
      }
    } else {
      this.progressT = 0;
      this.lastGoalDist = 1e9;
    }
    this.vel.x = THREE.MathUtils.damp(this.vel.x, wish.x, 7, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, wish.z, 7, dt);
    if (this.grounded && this.vVel < 0) this.vVel = -2;
    this.vVel = Math.max(-30, this.vVel - 18 * dt);
    const desired = { x: this.vel.x * dt, y: this.vVel * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, groups(GROUP.NPC, GROUP.STATIC | GROUP.VEHICLE | GROUP.PLAYER | GROUP.NPC));
    const mv = this.controller.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    const g = this.terrain.heightAt(next.x, next.z);
    if (next.y - HALF - RAD < g - 0.5) next.y = g + HALF + RAD;
    this.body.setNextKinematicTranslation(next);
    this.grounded = this.controller.computedGrounded();
    this.vel.x = mv.x / Math.max(dt, 1e-4);
    this.vel.z = mv.z / Math.max(dt, 1e-4);
    this.pos.set(next.x, next.y - HALF - RAD, next.z);
  }

  // ------------------------------------------------------------ per frame

  update(dt: number, alpha: number, w: NpcWorld): void {
    this.time += dt;
    this.renderPos.lerpVectors(this.prevPos, this.pos, THREE.MathUtils.clamp(alpha, 0, 1));
    this.updateBounds();
    this.flinch = Math.max(0, this.flinch - dt * 2.5);
    this.staggerT = Math.max(0, this.staggerT - dt);
    this.suppressed = Math.max(0, this.suppressed - dt);
    this.kick = Math.max(0, this.kick - dt * 9);
    if (this.pendingHit) {
      this.pendingHit = false;
      if (this.health <= 0) this.defeat(w);
      else {
        if (Math.random() < 0.45) w.bark(this, pick(LINES.hit));
        if (this.state !== 'combat') this.enterCombat(w, this.lastSeen);
        // Badly hurt: fall back to cover further from the player.
        if (this.health < this.maxHealth * 0.35 && !this.spec.boss && this.phase !== 'move') this.pickCover(w, true);
      }
    }
    if (this.state !== 'down') {
      this.thinkT -= dt;
      if (this.thinkT <= 0) {
        const step = 0.15 + Math.random() * 0.06;
        this.thinkT = step;
        this.perceive(w, step);
      }
      if (this.alertT > 0) {
        this.alertT -= dt;
        if (this.alertT <= 0 && this.state !== 'combat') this.enterCombat(w, this.alertPos);
      }
      switch (this.state) {
        case 'idle':
          this.idle(dt);
          break;
        case 'patrol':
          this.patrol(dt);
          break;
        case 'suspicious':
          this.investigate(dt);
          break;
        case 'combat':
          this.fight(dt, w);
          break;
        case 'return':
          this.goHome();
          break;
        default:
          break;
      }
    }
    // Facing: toward the threat while fighting, otherwise along the path.
    let want = this.facing;
    const fighting = this.state === 'combat' && (this.phase === 'aim' || this.phase === 'fire' || this.seeing || this.phase === 'duck');
    if (this.state === 'down') want = this.facing;
    else if (fighting || (this.state === 'suspicious' && this.lookTarget)) {
      const t = this.state === 'combat' ? this.lastSeen : this.lookTarget!;
      want = Math.atan2(t.x - this.renderPos.x, t.z - this.renderPos.z);
    } else if (this.vel.lengthSq() > 0.3) want = Math.atan2(this.vel.x, this.vel.z);
    let dA = (want - this.facing) % (Math.PI * 2);
    if (dA > Math.PI) dA -= Math.PI * 2;
    if (dA < -Math.PI) dA += Math.PI * 2;
    this.facing += dA * (1 - Math.exp(-(fighting ? 9 : 5) * dt));
    this.crouch = THREE.MathUtils.damp(this.crouch, this.wantCrouch, 6, dt);
    this.aimBlend = THREE.MathUtils.damp(this.aimBlend, this.staggerT > 0 ? 0 : this.wantAim, 7, dt);
    // Aim point: the player's chest when fighting, otherwise ahead at chest height.
    if (this.state === 'combat') this.aimPoint.copy(this.lastSeen).add(new THREE.Vector3(0, 1.25, 0));
    else this.aimPoint.copy(this.renderPos).addScaledVector(this.forward(), 10).add(new THREE.Vector3(0, 1.2, 0));
    if (this.glint) this.glint.visible = this.aimBlend > 0.7 && this.seeing;
    this.anim.update(dt, {
      pos: this.renderPos,
      vel: this.vel,
      facing: this.facing,
      grounded: this.grounded,
      crouch: this.crouch,
      sprint: this.vel.length() > 4.5,
      aimPitch: Math.atan2(this.aimPoint.y - (this.renderPos.y + 1.4), Math.max(1, Math.hypot(this.aimPoint.x - this.renderPos.x, this.aimPoint.z - this.renderPos.z))),
      aimAmount: this.aimBlend,
      lookAt: this.state === 'down' ? null : this.lookTarget ?? (this.state === 'combat' ? this.lastSeen.clone().add(new THREE.Vector3(0, 1.5, 0)) : null),
      hands: this.dropped ? null : (a) => {
        const pos = new THREE.Vector3();
        const q = new THREE.Quaternion();
        holdTransform(a, this.weapon, this.def, a.toChar(this.aimPoint), this.aimBlend, this.vel.length() > 4.5 ? 0.6 : 0, pos, q);
        if (this.kick > 0) {
          pos.add(new THREE.Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(this.kick * this.def.kick));
          q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.kick * this.def.kickRot));
        }
        this.weapon.root.position.copy(pos);
        this.weapon.root.quaternion.copy(q);
        return { right: handOn(this.weapon.grip, pos, q), left: handOn(this.weapon.fore, pos, q), ...holdPoles(this.aimBlend) };
      },
      pose: this.state === 'down' ? 'surrender' : 'normal',
      flinch: this.flinch,
    });
  }

  // ------------------------------------------------------------ perception

  private perceive(w: NpcWorld, step: number): void {
    const p = w.player;
    const eye = this.eye();
    this.seeing = false;
    if (p.exposed) {
      const to = p.chest.clone().sub(eye);
      const dist = to.length();
      const flat = new THREE.Vector3(to.x, 0, to.z).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(flat.dot(this.forward()), -1, 1));
      const combat = this.state === 'combat';
      const range = (this.spec.sight ?? 42) * (1 - 0.35 * w.dusk) * (1 - 0.35 * p.crouch) * (combat ? 1.7 : 1);
      const cone = combat ? Math.PI : this.state === 'suspicious' ? 1.6 : 1.2;
      if (dist < range && (ang < cone || dist < 4)) {
        this.seeing = w.combat.clear(eye, p.head) || w.combat.clear(eye, p.chest);
      }
      if (this.seeing) {
        this.lastSeen.copy(p.pos);
        this.lastSeenT = this.time;
        this.seenFor += step;
        const moving = p.vel.length() > 3.5 ? 1.5 : p.vel.length() < 0.5 ? 0.7 : 1;
        this.awareness += step * (0.3 + 2.4 * (1 - dist / range)) * moving * (this.state === 'suspicious' ? 1.6 : 1);
      } else {
        this.seenFor = 0;
        if (this.state !== 'combat') this.awareness = Math.max(0, this.awareness - step * 0.1);
      }
    }
    // Hearing: shots and rounds landing close by.
    for (const n of w.combat.noises) {
      if (n.time <= this.lastNoise) continue;
      const d = n.pos.distanceTo(this.renderPos);
      if (d > n.radius) continue;
      if (n.source === 'player' && n.kind === 'gunshot') {
        const guess = n.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 12, 0, (Math.random() - 0.5) * 12));
        if (d < 75 || this.state === 'suspicious') this.enterCombat(w, guess);
        else this.becomeSuspicious(w, guess);
      } else if (n.source === 'player' && n.kind === 'impact' && d < 4) {
        this.suppressed = 2.5;
        if (this.state !== 'combat') this.enterCombat(w, p.pos);
      }
    }
    this.lastNoise = w.combat.time;
    if (this.state === 'combat') return;
    if (this.awareness >= 1) this.enterCombat(w, this.lastSeen);
    else if (this.awareness > 0.3 && (this.state === 'idle' || this.state === 'patrol')) this.becomeSuspicious(w, this.lastSeen.clone());
  }

  private becomeSuspicious(w: NpcWorld, at: THREE.Vector3): void {
    if (this.state === 'combat' || this.state === 'down') return;
    if (this.state !== 'suspicious') w.bark(this, pick(LINES.suspicious));
    this.state = 'suspicious';
    this.lookTarget = at.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.waitT = 1.2;
    this.moveTarget = null;
    this.wantAim = 0.45;
  }

  private enterCombat(w: NpcWorld, at: THREE.Vector3): void {
    if (this.state === 'down') return;
    const first = this.state !== 'combat';
    this.state = 'combat';
    this.awareness = 1;
    this.lookTarget = null;
    if (this.lastSeenT < this.time - 0.5) {
      this.lastSeen.copy(at);
      this.lastSeenT = this.time - 1;
    }
    if (first) {
      if (!this.spottedBark) {
        this.spottedBark = true;
        w.bark(this, pick(LINES.spotted));
      }
      this.cycles = 0;
      this.pickCover(w, false);
      this.group.alertAll(this, this.lastSeen);
    }
  }

  // ------------------------------------------------------------ calm states

  private idle(dt: number): void {
    this.moveTarget = null;
    this.wantAim = 0;
    this.lookT -= dt;
    if (this.lookT <= 0) {
      // Glance around now and then.
      this.lookT = 2.5 + Math.random() * 4;
      const a = this.facing + (Math.random() - 0.5) * 2.2;
      this.lookTarget = Math.random() < 0.4 ? null : this.renderPos.clone().add(new THREE.Vector3(Math.sin(a) * 8, 1.5, Math.cos(a) * 8));
    }
  }

  private patrol(dt: number): void {
    const pts = this.spec.patrol!;
    this.wantAim = 0;
    this.wantCrouch = 0;
    const [px, pz] = pts[this.patrolIdx % pts.length];
    const target = new THREE.Vector3(px, this.terrain.heightAt(px, pz), pz);
    if (target.distanceTo(this.pos) < 0.8) {
      this.moveTarget = null;
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this.patrolIdx += 1;
        this.waitT = 2 + Math.random() * 2.5;
      }
    } else {
      this.moveTarget = target;
      this.moveSpeed = 1.45;
    }
  }

  private investigate(dt: number): void {
    this.waitT -= dt;
    const t = this.lookTarget;
    if (!t) {
      this.state = 'return';
      return;
    }
    if (this.waitT > 0) {
      this.moveTarget = null;
      return;
    }
    const goal = new THREE.Vector3(t.x, t.y - 1.4, t.z);
    if (goal.distanceTo(this.pos) > 3 && goal.distanceTo(this.post) < (this.spec.leash ?? 45)) {
      this.moveTarget = goal;
      this.moveSpeed = 1.8;
    } else {
      this.moveTarget = null;
      this.awareness = Math.max(0, this.awareness - dt * 0.12);
      if (this.awareness < 0.1) this.state = 'return';
    }
  }

  private goHome(): void {
    this.wantAim = 0;
    this.lookTarget = null;
    if (this.post.distanceTo(this.pos) > 1) {
      this.moveTarget = this.post;
      this.moveSpeed = 1.6;
    } else {
      this.moveTarget = null;
      this.state = this.spec.patrol?.length ? 'patrol' : 'idle';
      this.facing = this.spec.facing;
    }
  }

  // ------------------------------------------------------------ combat

  /** Choose cover that blocks the line to the player, near me and inside my leash. */
  private pickCover(w: NpcWorld, retreat: boolean): void {
    const threat = this.lastSeen.clone().add(new THREE.Vector3(0, 1.3, 0));
    const leash = this.spec.leash ?? 45;
    let best: THREE.Vector3 | null = null;
    let bestScore = Infinity;
    for (const c of this.group.cover) {
      if (this.group.coverTaken(c, this)) continue;
      if (c.distanceTo(this.post) > leash) continue;
      const dMe = c.distanceTo(this.pos);
      if (dMe > (retreat ? 40 : 26)) continue;
      const dThreat = c.distanceTo(threat);
      if (dThreat < 5) continue;
      // Protected: a ray from a crouched head at the cover point toward the threat
      // hits something solid within a couple of metres.
      const from = c.clone().add(new THREE.Vector3(0, 0.95, 0));
      const dir = threat.clone().sub(from).normalize();
      const hit = w.combat.traceWorld(from, dir, 3);
      const protectedScore = hit ? -18 : 0;
      const ideal = retreat ? 30 : this.def.range < 20 ? 10 : this.def.range > 80 ? 30 : 18;
      const score = dMe * 0.9 + Math.abs(dThreat - ideal) * 0.5 + protectedScore + (retreat ? -dThreat * 0.4 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }
    this.cover = best;
    if (best) {
      this.phase = 'move';
      this.phaseT = 2 + best.distanceTo(this.pos) / 3;
      this.moveTarget = best.clone();
    } else {
      // No cover: hold position or close in to a useful range, side-stepping.
      const to = this.lastSeen.clone().sub(this.pos).setY(0);
      const d = to.length();
      const ideal = this.def.range < 20 ? 9 : 20;
      const side = new THREE.Vector3(-to.z, 0, to.x).normalize().multiplyScalar((Math.random() - 0.5) * 6);
      const goal = this.pos.clone().addScaledVector(to.normalize(), Math.max(-6, Math.min(10, d - ideal))).add(side);
      if (goal.distanceTo(this.post) > leash) goal.copy(this.post);
      goal.y = this.terrain.heightAt(goal.x, goal.z);
      this.phase = 'move';
      this.phaseT = 2 + goal.distanceTo(this.pos) / 3;
      this.moveTarget = goal;
    }
  }

  private fight(dt: number, w: NpcWorld): void {
    const p = w.player;
    const knowAge = this.time - this.lastSeenT;
    this.phaseT -= dt;
    const close = p.exposed && p.pos.distanceTo(this.pos) < 6;
    switch (this.phase) {
      case 'move': {
        this.wantCrouch = 0.25;
        this.wantAim = 0.3;
        this.moveSpeed = 4.0;
        const flatD = this.moveTarget ? Math.hypot(this.moveTarget.x - this.pos.x, this.moveTarget.z - this.pos.z) : 0;
        if (!this.moveTarget || flatD < 0.75 || this.phaseT <= 0) {
          // Arrived, or the spot is unreachable: fight from here.
          if (this.moveTarget && flatD >= 1.5) this.cover = null;
          this.moveTarget = null;
          this.phase = 'duck';
          this.phaseT = 0.4 + Math.random() * 0.6;
        }
        // Fire on the move only at point-blank range.
        if (close && this.seeing) {
          this.moveTarget = null;
          this.phase = 'aim';
          this.phaseT = 0.25;
        }
        break;
      }
      case 'duck': {
        this.moveTarget = null;
        this.wantCrouch = this.cover ? 1 : 0.55;
        this.wantAim = 0.2;
        if (this.phaseT > 0) break;
        if (this.mag <= 0) {
          this.phase = 'reload';
          this.phaseT = this.def.reloadTime * (this.def.reload === 'tube' || this.def.reload === 'internal' ? 3 : 1.3);
          if (Math.random() < 0.6) w.bark(this, pick(LINES.reload));
          break;
        }
        // Flanked: the cover no longer protects me from where the player is.
        if (this.cover && p.exposed && this.seeing && this.crouch > 0.8 && Math.random() < 0.5) {
          this.pickCover(w, false);
          break;
        }
        if (this.seeing || knowAge < 1.5) {
          this.phase = 'aim';
          this.phaseT = (close ? 0.25 : 0.55 + Math.random() * 0.45) * (this.spec.boss ? 1.4 : 1);
        } else if (knowAge > 7) {
          this.phase = 'hunt';
          if (Math.random() < 0.5) w.bark(this, pick(LINES.lost));
        } else {
          this.phaseT = 0.7;
        }
        break;
      }
      case 'aim': {
        // Stand (or lean out) and bring the gun up: the visible wind-up before shots.
        this.moveTarget = null;
        this.wantCrouch = 0;
        this.wantAim = 1;
        if (!this.seeing && knowAge > 0.8) {
          this.phase = 'duck';
          this.phaseT = 0.6;
          break;
        }
        if (this.phaseT <= 0 && this.aimBlend > 0.8 && this.staggerT <= 0) {
          this.phase = 'fire';
          this.burst = this.def.fire === 'auto' ? 3 + Math.floor(Math.random() * 3) : this.def.pellets > 1 || this.def.fire === 'bolt' ? 1 : 2 + Math.floor(Math.random() * 2);
          this.shotT = 0;
        }
        break;
      }
      case 'fire': {
        this.wantAim = 1;
        this.shotT -= dt;
        if (this.staggerT > 0) {
          this.phase = 'duck';
          this.phaseT = 0.8;
          break;
        }
        if (this.shotT <= 0 && this.burst > 0 && this.mag > 0) {
          if (this.seeing || knowAge < 0.6) this.fire(w);
          this.burst -= 1;
          this.shotT = Math.max(this.def.cycle, 0.1) * (this.def.fire === 'auto' ? 1.1 : 1.3 + Math.random() * 0.6);
        }
        if (this.burst <= 0 || this.mag <= 0) {
          this.cycles += 1;
          if (this.cycles >= 3 && Math.random() < 0.5) {
            this.cycles = 0;
            this.pickCover(w, false);
          } else {
            this.phase = 'duck';
            this.phaseT = (0.9 + Math.random() * 1.4) * (1 + this.suppressed * 0.4);
          }
        }
        break;
      }
      case 'reload': {
        this.wantCrouch = this.cover ? 1 : 0.6;
        this.wantAim = 0;
        this.moveTarget = null;
        if (this.phaseT <= 0) {
          this.mag = this.def.magSize;
          this.phase = 'duck';
          this.phaseT = 0.3;
        }
        break;
      }
      case 'hunt': {
        // Lost contact: move to where the player was last seen, carefully.
        this.wantCrouch = 0.3;
        this.wantAim = 0.6;
        const goal = this.lastSeen.clone();
        if (goal.distanceTo(this.post) > (this.spec.leash ?? 45) + 10 || knowAge > 25) {
          this.state = 'return';
          this.awareness = 0.2;
          break;
        }
        if (Math.hypot(goal.x - this.pos.x, goal.z - this.pos.z) > 3) {
          this.moveTarget = goal;
          this.moveSpeed = 2.4;
        } else this.moveTarget = null;
        if (this.seeing) {
          this.moveTarget = null;
          this.phase = 'aim';
          this.phaseT = 0.4;
        }
        break;
      }
      default:
        break;
    }
  }

  /** Rounds fired by all NPCs (statistics, tests). */
  static shots = 0;

  private fire(w: NpcWorld): void {
    Npc.shots += 1;
    const def = this.def;
    const p = w.player;
    this.weapon.root.updateWorldMatrix(true, false);
    const muzzle = this.weapon.muzzle.clone().applyMatrix4(this.weapon.root.matrixWorld);
    const target = Math.random() < 0.12 ? p.head : p.chest;
    const dist = muzzle.distanceTo(target);
    const acc = this.spec.accuracy ?? 0.45;
    // Error radius at the target: grows with range, player movement, crouching,
    // being suppressed or staggered.
    // The first shots of an engagement go wide while they settle their aim.
    const settle = this.shotsThisFight < 2 ? 0.5 : 0;
    this.shotsThisFight += 1;
    const err = 0.16 + settle + dist * 0.034 * (1.25 - acc) + p.vel.length() * 0.09 + p.crouch * 0.12 + this.suppressed * 0.35;
    const pellets = def.pellets > 1 ? 6 : 1;
    let dir0 = new THREE.Vector3();
    for (let i = 0; i < pellets; i += 1) {
      const aimAt = target.clone().add(randomInSphere(err * (pellets > 1 ? 1.4 : 1)));
      const dir = aimAt.sub(muzzle).normalize();
      if (i === 0) dir0 = dir.clone();
      const hit = w.combat.trace(muzzle, dir, def.maxRange * 1.3, this);
      const end = hit ? hit.point : muzzle.clone().addScaledVector(dir, 150);
      if (hit && hit.target === w.combat.self) {
        const fall = hit.dist <= def.range ? 1 : THREE.MathUtils.lerp(1, 0.5, THREE.MathUtils.clamp((hit.dist - def.range) / Math.max(1, def.maxRange - def.range), 0, 1));
        w.damagePlayer(def.damage * NPC_DAMAGE * fall * (hit.part === 'head' ? 1.4 : 1), muzzle);
      } else if (hit && i < 2) {
        w.effects.impact(hit.point, hit.normal, hit.surface, pellets > 1 ? 0.5 : 1, i === 0);
        w.audio.bulletImpact(hit.surface, hit.point);
      }
      // Near miss: the round passed close to the player's head.
      if (i === 0 && p.exposed && !(hit && hit.target === w.combat.self)) {
        const seg = end.clone().sub(muzzle);
        const f = THREE.MathUtils.clamp(p.head.clone().sub(muzzle).dot(seg) / Math.max(seg.lengthSq(), 1e-6), 0, 1);
        const closest = muzzle.clone().addScaledVector(seg, f);
        if (closest.distanceTo(p.head) < 2) w.audio.whizz(closest);
      }
      if (i === 0 && Math.random() < 0.6) w.effects.tracer(muzzle, end);
    }
    const size = def.hold === 'pistol' ? 0.22 : def.pellets > 1 ? 0.42 : 0.32;
    w.effects.muzzleFlash(muzzle, dir0, size, w.camera);
    w.audio.gunshot(def.sound, muzzle, false);
    w.combat.noise(muzzle, 150, 'npc', 'gunshot');
    if (def.reload === 'magazine') {
      const q = new THREE.Quaternion().setFromRotationMatrix(this.weapon.root.matrixWorld);
      w.effects.eject(this.weapon.ejection.clone().applyMatrix4(this.weapon.root.matrixWorld), new THREE.Vector3(-1, 0, 0).applyQuaternion(q), new THREE.Vector3(0, 1, 0).applyQuaternion(q), new THREE.Vector3(0, 0, -1).applyQuaternion(q), def.ammo === '9mm' ? 0.75 : 1.1);
    }
    this.kick = 1;
    this.mag -= 1;
  }

  // ------------------------------------------------------------ defeat

  private defeat(w: NpcWorld): void {
    this.state = 'down';
    this.active = false;
    this.health = 0;
    this.moveTarget = null;
    this.wantAim = 0;
    this.lookTarget = null;
    this.burst = 0;
    w.bark(this, pick(LINES.surrender));
    // Drop the gun on the ground in front.
    const fwd = this.forward();
    const at = this.renderPos.clone().addScaledVector(fwd, 0.9).add(new THREE.Vector3(fwd.z * 0.3, 0, -fwd.x * 0.3));
    at.y = (this.physics.groundHeight(at.x, at.z, at.y + 1.5) ?? this.terrain.heightAt(at.x, at.z)) + 0.03;
    this.weapon.root.removeFromParent();
    w.scene.add(this.weapon.root);
    this.weapon.root.position.copy(at);
    this.weapon.root.rotation.set(0, this.facing + 1.2, Math.PI / 2);
    this.dropped = this.weapon.root;
    if (this.glint) this.glint.visible = false;
    this.onDown?.(this);
    this.group.onDefeated?.(this);
    if (this.group.alive === 0) this.group.onAllDown?.();
  }

  /** Loading a save: already surrendered, kneeling at the post, gun on the ground. */
  restoreSurrendered(scene: THREE.Scene): void {
    this.state = 'down';
    this.active = false;
    this.health = 0;
    this.pendingHit = false;
    this.moveTarget = null;
    this.wantAim = 0;
    const fwd = this.forward();
    const at = this.pos.clone().addScaledVector(fwd, 0.9);
    at.y = (this.physics.groundHeight(at.x, at.z, at.y + 1.5) ?? this.terrain.heightAt(at.x, at.z)) + 0.03;
    this.weapon.root.removeFromParent();
    scene.add(this.weapon.root);
    this.weapon.root.position.copy(at);
    this.weapon.root.rotation.set(0, this.facing + 1.2, Math.PI / 2);
    this.dropped = this.weapon.root;
  }

  /** After the player is downed: survivors go back to their posts, healed and calm. */
  resetForRetry(): void {
    if (this.state === 'down') return;
    this.health = this.maxHealth;
    this.mag = this.def.magSize;
    this.state = this.spec.patrol?.length ? 'patrol' : 'idle';
    this.awareness = 0;
    this.cover = null;
    this.moveTarget = null;
    this.lookTarget = null;
    this.alertT = -1;
    this.spottedBark = false;
    this.shotsThisFight = 0;
    this.facing = this.spec.facing;
    this.wantAim = 0;
    this.wantCrouch = this.spec.crouched ? 0.8 : 0;
    this.body.setTranslation({ x: this.post.x, y: this.post.y + HALF + RAD + 0.02, z: this.post.z }, true);
    this.body.setNextKinematicTranslation({ x: this.post.x, y: this.post.y + HALF + RAD + 0.02, z: this.post.z });
    this.pos.copy(this.post);
    this.prevPos.copy(this.post);
    this.renderPos.copy(this.post);
    this.anim.reset(this.post, this.facing);
  }

  /** Remove from the world (mission reset or cleanup). */
  dispose(w: { physics: PhysicsWorld; combat: Combat }): void {
    w.combat.remove(this);
    this.human.root.removeFromParent();
    this.weapon.root.removeFromParent();
    w.physics.world.removeCharacterController(this.controller);
    w.physics.world.removeRigidBody(this.body);
  }
}

/** Owns every NPC group, steps them and registers them as hit targets. */
export class NpcManager {
  readonly groups = new Map<string, NpcGroup>();
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  private combat: Combat;
  private scene: THREE.Scene;

  constructor(physics: PhysicsWorld, terrain: TerrainData, combat: Combat, scene: THREE.Scene) {
    this.physics = physics;
    this.terrain = terrain;
    this.combat = combat;
    this.scene = scene;
  }

  /** A cover spot is usable only if a crouching body fits there. */
  private fits(x: number, z: number): THREE.Vector3 | null {
    const R = this.physics.R;
    const shape = new R.Capsule(0.35, 0.3);
    const tries: [number, number][] = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]];
    for (const [dx, dz] of tries) {
      const px = x + dx;
      const pz = z + dz;
      const y = this.physics.groundHeight(px, pz, this.terrain.heightAt(px, pz) + 3) ?? this.terrain.heightAt(px, pz);
      let blocked = false;
      this.physics.world.intersectionsWithShape({ x: px, y: y + 0.7, z: pz }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => {
        blocked = true;
        return false;
      }, undefined, groups(GROUP.NPC, GROUP.STATIC | GROUP.VEHICLE));
      if (!blocked) return new THREE.Vector3(px, y, pz);
    }
    return null;
  }

  spawn(id: string, specs: NpcSpec[], cover: [number, number][]): NpcGroup {
    this.despawn(id);
    const points = cover.map(([x, z]) => this.fits(x, z)).filter((p): p is THREE.Vector3 => !!p);
    const g = new NpcGroup(id, points);
    for (const s of specs) {
      const n = new Npc(s, g, this.physics, this.terrain, this.scene);
      g.members.push(n);
      this.combat.add(n);
    }
    this.groups.set(id, g);
    return g;
  }

  despawn(id: string): void {
    const g = this.groups.get(id);
    if (!g) return;
    for (const n of g.members) n.dispose({ physics: this.physics, combat: this.combat });
    this.groups.delete(id);
  }

  get all(): Npc[] {
    return [...this.groups.values()].flatMap((g) => g.members);
  }

  fixedUpdate(dt: number): void {
    for (const g of this.groups.values()) for (const n of g.members) n.fixedUpdate(dt);
  }

  update(dt: number, alpha: number, w: NpcWorld): void {
    if (dt <= 0) return;
    for (const g of this.groups.values()) for (const n of g.members) n.update(dt, alpha, w);
  }

  /** Survivors of every group return to their posts (player respawned). */
  resetAll(): void {
    for (const g of this.groups.values()) {
      g.engaged = false;
      for (const n of g.members) n.resetForRetry();
    }
  }

  /** Any NPC currently fighting (music, HUD condition bar). */
  get inCombat(): boolean {
    return this.all.some((n) => n.state === 'combat');
  }
}
