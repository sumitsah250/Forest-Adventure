// Player character: Rapier kinematic capsule (slope limits, step-up, ground
// snapping, smooth acceleration) driving a visible procedural character, seen
// through a third-person orbit camera.
//
// Movement is relative to the camera. The body turns toward the direction of
// travel; while aiming it faces where the camera looks and strafes instead.

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData, SurfaceKind } from '../world/terrain.ts';
import type { Input } from '../core/input.ts';
import { PLAYER_SUIT, type Humanoid, type Outfit } from '../character/humanoid.ts';
import { PlayerClips, createPlayerHumanoid } from '../character/playerModel.ts';
import { Animator, type HandTargets } from '../character/animator.ts';
import { ThirdPersonCamera } from './thirdPersonCamera.ts';

const HALF_HEIGHT = 0.56;
const RADIUS = 0.3;
/** Default pace: a brisk walk (kept below the run blend so the gait stays a clean walk). */
const JOG = 2.5;
const SPRINT = 5.8;
/** Moving while aiming a weapon. */
const AIM_WALK = 2.0;
const CROUCH = 1.5;
const GRAVITY = 18;
const JUMP_SPEED = 5.4;

export interface StepEvent {
  surface: SurfaceKind | 'wood' | 'metal';
  intensity: number;
}

/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class Player {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private controller: RAPIER.KinematicCharacterController;
  private physics: PhysicsWorld;
  private terrain: TerrainData;
  /** Feet position (physics, updated per fixed step). */
  readonly position = new THREE.Vector3();
  /** Feet position interpolated for rendering. */
  readonly renderPos = new THREE.Vector3();
  private prevPos = new THREE.Vector3();
  /** Camera (view) angles. Forward is (-sin yaw, 0, -cos yaw). */
  yaw = 0;
  pitch = 0;
  /** Body heading in the same convention as yaw. */
  facing = 0;
  /** Body heading as drawn: blended between physics steps like the position (see animate()). */
  renderFacing = 0;
  /** Heading at the start of the last physics step, and at its end. */
  private prevFacing = 0;
  private stepFacing = 0;
  /**
   * Smooth the drawn body over step-ups and step-downs (stairs, kerbs): the capsule climbs a
   * riser in one physics step, which jerked the whole body up 15-20 cm in one frame. Off by
   * default (the forest game keeps its own feel); Campus Quest turns it on.
   */
  smoothSteps = false;
  /** Feet position as drawn: renderPos plus the easing step offset. */
  readonly drawPos = new THREE.Vector3();
  private stepOff = 0;
  private lastRenderY = 0;
  /** `grounded` as of the last drawn frame (step smoothing ignores the frame a jump lands). */
  private drawnGrounded = false;
  private hVel = new THREE.Vector2();
  private vVel = 0;
  readonly velocity = new THREE.Vector3();
  grounded = false;
  private wasGrounded = true;
  private airTime = 0;
  private crouchT = 0;
  speed = 0;
  sensitivity = 1;
  invertY = false;
  enabled = true;
  sprinting = false;
  /** Set by the weapon system: aim blend, aim distance, scope blend. */
  aim = 0;
  aimDistance = 1.7;
  /** Field-of-view factor at full aim (per weapon). */
  aimFovScale = 0.86;
  scope = 0;
  scopeFov = 14;
  /** Set by the weapon system while firing or aiming. */
  noSprint = false;
  /** Carry weight factor of the weapon in hand. */
  speedScale = 1;
  /** Face the camera direction (aiming or firing). */
  strafe = false;
  /** Scripted views (binoculars): camera at the eyes along yaw/pitch. */
  firstPerson = false;
  /** Upper-body flinch when hit (0..1, decays). */
  flinch = 0;
  /** Weapon hold provider (null = free arms). */
  hands: ((a: Animator) => HandTargets | null) | null = null;
  /** Surface override when standing on structures (decks, floors). */
  surfaceOverride: (() => StepEvent['surface'] | null) | null = null;
  onStep: ((e: StepEvent) => void) | null = null;
  onLand: ((e: StepEvent) => void) | null = null;
  inWater = 0;
  character: Humanoid | null = null;
  animator: Animator | null = null;
  /** The player model's own Idle/Walk/Run/Jump clips (null for the built-in character). */
  clips: PlayerClips | null = null;
  tpc: ThirdPersonCamera;
  baseFov = 68;
  /** Half-size of the square the player may walk in (metres from the map centre). */
  bounds = 286;
  /** Default pace and Shift pace (m/s). Games can retune them (Campus Quest walks and runs at natural human speeds). */
  walkSpeed = JOG;
  runSpeed = SPRINT;
  /** Acceleration toward the wanted speed (1/s) when moving and when stopping, and the body's turn rate. */
  accelMove = 8.5;
  accelStop = 10;
  turnWalk = 10;
  turnRun = 7;
  private eyeY = 0;

  constructor(physics: PhysicsWorld, terrain: TerrainData, x: number, z: number, yaw: number) {
    this.physics = physics;
    this.terrain = terrain;
    const R = physics.R;
    const y = terrain.heightAt(x, z) + 0.05;
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + HALF_HEIGHT + RADIUS, z),
    );
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(HALF_HEIGHT, RADIUS)
        .setCollisionGroups(groups(GROUP.PLAYER, GROUP.STATIC | GROUP.VEHICLE | GROUP.DYNAMIC | GROUP.NPC))
        .setFriction(0),
      this.body,
    );
    this.controller = physics.world.createCharacterController(0.03);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.controller.enableAutostep(0.38, 0.18, false);
    this.controller.enableSnapToGround(0.45);
    this.controller.setSlideEnabled(true);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.position.set(x, y, z);
    this.prevPos.copy(this.position);
    this.renderPos.copy(this.position);
    this.yaw = yaw;
    this.facing = yaw;
    this.renderFacing = this.prevFacing = this.stepFacing = yaw;
    this.drawPos.copy(this.position);
    this.lastRenderY = this.position.y;
    this.eyeY = y + 1.64;
    this.tpc = new ThirdPersonCamera(physics, terrain);
  }

  /**
   * Creates the visible character (after the scene exists): the player's own model
   * when `loadPlayerModel()` has finished, otherwise the built-in one.
   */
  attachCharacter(scene: THREE.Scene, outfit: Outfit = PLAYER_SUIT): void {
    this.character = createPlayerHumanoid(outfit);
    scene.add(this.character.root);
    const ground = (x: number, z: number, fromY: number) => this.physics.groundHeight(x, z, fromY) ?? this.terrain.heightAt(x, z);
    this.animator = new Animator(this.character, ground);
    this.clips = PlayerClips.create(this.character);
    this.animator.onFootPlant = (_side, _pos, strength) => {
      if (this.enabled) this.onStep?.({ surface: this.surface(), intensity: strength });
    };
  }

  teleport(x: number, y: number, z: number, yaw?: number): void {
    this.body.setTranslation({ x, y: y + HALF_HEIGHT + RADIUS + 0.02, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + HALF_HEIGHT + RADIUS + 0.02, z });
    this.position.set(x, y, z);
    this.prevPos.copy(this.position);
    this.renderPos.copy(this.position);
    this.eyeY = y + 1.64;
    this.hVel.set(0, 0);
    this.vVel = 0;
    // Teleports set the player down on the ground. Say so: a story or mission start teleports and then
    // pauses physics (the intro, the opening radio lines), and until the next physics step the pose
    // thought the player was falling and held them tucked up, crouched, the whole time.
    this.grounded = true;
    this.wasGrounded = true;
    this.airTime = 0;
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.facing = yaw;
    }
    this.renderFacing = this.prevFacing = this.stepFacing = this.facing;
    this.drawPos.copy(this.position);
    this.stepOff = 0;
    this.lastRenderY = this.position.y;
    this.animator?.reset(this.position, this.facing + Math.PI);
    this.tpc.reset();
  }

  setActive(on: boolean): void {
    this.enabled = on;
    this.collider.setEnabled(on);
    this.hVel.set(0, 0);
    this.vVel = 0;
    if (this.character) this.character.root.visible = on;
    if (on) this.tpc.reset();
  }

  /** Mouse look; called every frame while playing on foot. */
  look(dx: number, dy: number): void {
    const k = 0.0021 * this.sensitivity * (1 - this.scope * 0.7) * (1 - this.aim * 0.25);
    this.yaw -= dx * k;
    this.pitch -= dy * k * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, this.firstPerson ? -1.45 : -1.2, this.firstPerson ? 1.45 : 1.1);
  }

  private jumpQueued = false;

  /**
   * The simulation is paused around the player (a dialogue, a quiz, a cutscene) but the
   * pose still animates: drop the walking speed so the body settles to idle instead of
   * running in place with the last frame's velocity.
   */
  halt(): void {
    this.hVel.set(0, 0);
    this.velocity.x = 0;
    this.velocity.z = 0;
    this.speed = 0;
    this.sprinting = false;
    this.jumpQueued = false;
  }

  /** Queue a jump from per-frame input; consumed by the next fixed step. */
  requestJump(): void {
    this.jumpQueued = true;
  }

  update(dt: number, input: Input): void {
    this.prevPos.copy(this.position);
    // From the heading as it is now (a script may have set it since the last step: no blend across that).
    this.prevFacing = this.facing;
    if (!this.enabled) {
      this.stepFacing = this.facing;
      this.jumpQueued = false;
      return;
    }
    const axes = input.moveAxes();
    const crouching = input.held('crouch');
    this.crouchT = THREE.MathUtils.damp(this.crouchT, crouching ? 1 : 0, 10, dt);
    const len = Math.hypot(axes.x, axes.y);
    this.sprinting = input.held('sprint') && !crouching && len > 0.3 && this.aim < 0.3 && !this.noSprint;

    // Water slows wading and stops sprinting.
    const water = this.terrain.waterAt(this.position.x, this.position.z);
    this.inWater = water ? Math.max(0, water.level - this.position.y) : 0;
    const wade = this.inWater > 0.05 ? THREE.MathUtils.clamp(1 - this.inWater * 0.65, 0.35, 1) : 1;

    let target = crouching ? CROUCH : this.aim > 0.3 ? AIM_WALK : this.sprinting ? this.runSpeed : this.walkSpeed;
    target *= wade * this.speedScale;
    const ax = len > 1 ? axes.x / len : axes.x;
    const ay = len > 1 ? axes.y / len : axes.y;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // Camera-relative: forward is -Z rotated by the view yaw.
    const wishX = (-sin * ay + cos * ax) * target;
    const wishZ = (-cos * ay - sin * ax) * target;
    const accel = this.grounded ? (len > 0.01 ? this.accelMove : this.accelStop) : 1.6;
    this.hVel.x = THREE.MathUtils.damp(this.hVel.x, wishX, accel, dt);
    this.hVel.y = THREE.MathUtils.damp(this.hVel.y, wishZ, accel, dt);

    // Body heading: toward the direction of travel, or the view when aiming.
    let want = this.facing;
    if (this.strafe) want = this.yaw;
    else if (len > 0.1) want = Math.atan2(-wishX, -wishZ);
    const turnRate = this.strafe ? 18 : this.sprinting ? this.turnRun : this.turnWalk;
    const d = angleDelta(this.facing, want);
    this.facing += d * (1 - Math.exp(-turnRate * dt));
    this.stepFacing = this.facing;

    if (this.grounded) {
      this.airTime = 0;
      if (this.vVel < 0) this.vVel = -2;
      if (this.jumpQueued && this.inWater < 0.6 && this.crouchT < 0.5) {
        this.vVel = JUMP_SPEED;
        this.grounded = false;
      }
    } else {
      this.airTime += dt;
    }
    this.jumpQueued = false;
    this.vVel -= GRAVITY * dt;
    this.vVel = Math.max(this.vVel, -40);

    // On the ground the move has no downward part: snap-to-ground keeps the feet on slopes and down
    // steps, and Rapier only steps up (autostep) a move without one. With it, the player could not climb
    // a single stair anywhere (the RIC's steps, the temple's), only walk into the first riser.
    const desired = { x: this.hVel.x * dt, y: this.grounded && this.vVel <= 0 ? 0 : this.vVel * dt, z: this.hVel.y * dt };
    this.controller.computeColliderMovement(this.collider, desired, undefined, groups(GROUP.PLAYER, GROUP.STATIC | GROUP.VEHICLE | GROUP.DYNAMIC | GROUP.NPC));
    const mv = this.controller.computedMovement();
    const t = this.body.translation();
    const next = { x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z };
    // Stay inside the playable area.
    const lim = this.bounds;
    next.x = THREE.MathUtils.clamp(next.x, -lim, lim);
    next.z = THREE.MathUtils.clamp(next.z, -lim, lim);
    // Safety net: never fall through the terrain.
    const ground = this.terrain.heightAt(next.x, next.z);
    if (next.y - HALF_HEIGHT - RADIUS < ground - 0.5) next.y = ground + HALF_HEIGHT + RADIUS;
    this.body.setNextKinematicTranslation(next);

    const actualVx = mv.x / Math.max(dt, 1e-4);
    const actualVz = mv.z / Math.max(dt, 1e-4);
    // Kill velocity into walls so it doesn't accumulate, but not while the controller
    // is lifting us up a slope, stair ramp or step (that also shortens the move).
    const climbing = mv.y > desired.y + 0.002;
    if (!climbing) {
      if (Math.abs(actualVx) < Math.abs(this.hVel.x) * 0.5) this.hVel.x = actualVx;
      if (Math.abs(actualVz) < Math.abs(this.hVel.y) * 0.5) this.hVel.y = actualVz;
    }
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && mv.y > desired.y + 0.001 && this.vVel > 0) this.vVel = 0;
    if (!this.grounded && mv.y > desired.y + 1e-4 && this.vVel > 0) this.vVel = 0; // bumped head

    this.position.set(next.x, next.y - HALF_HEIGHT - RADIUS, next.z);
    this.speed = Math.hypot(actualVx, actualVz);
    this.velocity.set(actualVx, mv.y / Math.max(dt, 1e-4), actualVz);

    // Landing feedback.
    if (this.grounded && !this.wasGrounded && this.airTime > 0.25) {
      const impact = THREE.MathUtils.clamp(this.airTime * 1.6, 0.2, 1);
      this.onLand?.({ surface: this.surface(), intensity: impact });
    }
    this.wasGrounded = this.grounded;
    this.flinch = Math.max(0, this.flinch - dt * 3);
  }

  surface(): StepEvent['surface'] {
    const o = this.surfaceOverride?.();
    if (o) return o;
    if (this.inWater > 0.05) return 'water';
    return this.terrain.surfaceAt(this.position.x, this.position.z);
  }

  get crouch(): number {
    return this.crouchT;
  }

  /** Per rendered frame: interpolate the body and pose the character. */
  animate(dt: number, alpha: number, lookAt: THREE.Vector3 | null): void {
    const a = THREE.MathUtils.clamp(alpha, 0, 1);
    this.renderPos.lerpVectors(this.prevPos, this.position, a);
    if (this.facing !== this.stepFacing) {
      // The heading was set from outside while the simulation is paused (a conversation turns the
      // player to the person): turn there at a natural pace instead of snapping round in one frame.
      this.renderFacing += angleDelta(this.renderFacing, this.facing) * (1 - Math.exp(-7 * Math.max(dt, 0)));
    } else {
      // Blended between physics steps like the position, so turns are smooth at any frame rate
      // (at 144 Hz the body otherwise turned in steps on two frames out of three).
      this.renderFacing = this.prevFacing + angleDelta(this.prevFacing, this.facing) * a;
    }
    this.drawPos.copy(this.renderPos);
    if (this.smoothSteps) {
      // A step-up or step-down moves the capsule faster than any walkable slope: hold the drawn body
      // where it was and ease it over the step (the feet IK keeps them on the treads meanwhile).
      // (Over 3.5 m/s vertical counts as a step; what a steep ramp explains is left in, so running up a
      // stair ramp doesn't sink the body.)
      // Only while on the ground on the frame before too: the frame a jump or fall lands is grounded and
      // drops fast, and counting it as a step held the body up in the air while the feet planted.
      const dy = this.renderPos.y - this.lastRenderY;
      if (this.grounded && this.drawnGrounded && dt > 0 && Math.abs(dy) > Math.max(0.035, 3.5 * dt) && Math.abs(dy) < 0.6) this.stepOff -= dy - Math.sign(dy) * 1.6 * dt;
      if (!this.grounded) this.stepOff *= Math.exp(-25 * Math.max(dt, 0));
      this.stepOff = THREE.MathUtils.clamp(this.stepOff, -0.45, 0.45) * Math.exp(-14 * Math.max(dt, 0));
      this.drawPos.y += this.stepOff;
    }
    this.lastRenderY = this.renderPos.y;
    this.drawnGrounded = this.grounded;
    if (!this.animator || !this.enabled || dt <= 0) return;
    this.animator.update(dt, {
      pos: this.drawPos,
      vel: this.velocity,
      facing: this.renderFacing + Math.PI,
      grounded: this.grounded,
      crouch: this.crouchT,
      sprint: this.sprinting,
      aimPitch: this.pitch,
      aimAmount: Math.max(this.aim, this.hands ? 0.35 : 0),
      lookAt,
      hands: this.hands,
      pose: 'normal',
      flinch: this.flinch,
    });
    // The model's own clips while moving empty-handed; weapons, crouching and
    // scripted views stay with the procedural animator (it handles grips and IK).
    this.clips?.update(dt, {
      speed: Math.hypot(this.velocity.x, this.velocity.z),
      grounded: this.grounded,
      vy: this.vVel,
      active: !this.animator.handsActive && this.crouchT < 0.15 && !this.firstPerson,
    });
  }

  /**
   * Seated in an open vehicle (Kalki, the dune buggy): the character stays visible, sits with the
   * pelvis on `seat` (world) and follows the vehicle's full orientation `quat` (+Z forward).
   * `hands` are wrist targets in character space (null: hands rest in the lap).
   */
  private seatFwd = new THREE.Vector3();
  private seatOrigin = new THREE.Vector3();
  private seatVel = new THREE.Vector3();

  animateSeated(dt: number, seat: THREE.Vector3, quat: THREE.Quaternion, hands: HandTargets | null, sitFeet?: { y: number; z: number }): void {
    if (!this.character || !this.animator) return;
    const fwd = this.seatFwd.set(0, 0, 1).applyQuaternion(quat);
    const facing = Math.atan2(fwd.x, fwd.z);
    // The sit pose puts the pelvis 0.53 m above the character origin.
    const origin = this.seatOrigin.set(0, -0.53, 0).applyQuaternion(quat).add(seat);
    this.animator.update(Math.max(dt, 1e-3), {
      pos: origin, vel: this.seatVel.set(0, 0, 0), facing, grounded: true, crouch: 0, sprint: false,
      aimPitch: 0, aimAmount: 0, lookAt: null, hands, pose: 'sit', flinch: 0, sitFeet,
    });
    this.clips?.update(dt, { speed: 0, grounded: true, vy: 0, active: false });
    const root = this.character.root;
    root.position.copy(origin);
    root.quaternion.copy(quat);
    root.visible = true;
    root.updateMatrixWorld(true);
  }

  /** Writes the camera transform for the active player view. */
  applyCamera(camera: THREE.PerspectiveCamera, dt: number): void {
    const p = this.renderPos;
    if (this.firstPerson) {
      // Scripted close view from the eyes (binoculars).
      const targetY = p.y + 1.64 - this.crouchT * 0.5;
      this.eyeY = THREE.MathUtils.damp(this.eyeY, targetY, 16, dt);
      camera.position.set(p.x, this.eyeY, p.z);
      camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      if (this.character) this.character.root.visible = false;
      return;
    }
    this.tpc.update(dt, camera, {
      pos: p, yaw: this.yaw, pitch: this.pitch, aim: this.aim, aimDistance: this.aimDistance, aimFovScale: this.aimFovScale,
      scope: this.scope, sprint: this.sprinting, crouch: this.crouchT, baseFov: this.baseFov, scopeFov: this.scopeFov,
    });
    if (this.character) this.character.root.visible = this.enabled && this.tpc.closeness > 0.45 && this.scope < 0.6;
  }

  /** Head position (world), for reach checks and audio. */
  get eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.renderPos.x, this.renderPos.y + 1.62 - this.crouchT * 0.45, this.renderPos.z);
  }

  /** World-space forward of the camera view. */
  viewForward(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }
}
