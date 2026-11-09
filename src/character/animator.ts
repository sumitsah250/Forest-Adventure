// Procedural animation for the humanoid rig. No canned clips: every pose is
// computed from the character's motion each frame, which keeps feet planted at any
// speed or direction and lets hands hold any weapon model.
//
//  - Gait: a phase-driven cycle sets each foot's stance and swing. A stance foot
//    stays where it landed in the world (no sliding); a swing foot travels to a
//    predicted landing point on the ground (ray cast), so steps follow slopes and
//    stairs. Duty factor, stride, bob and lean blend from walk to run to sprint.
//  - Legs: two-bone IK with the knee toward the body's front; pelvis lowers when a
//    foot is far below (slopes) or the character crouches.
//  - Torso and head: lean with acceleration, pitch toward the aim, look at targets.
//  - Arms: counter-swing when empty-handed; otherwise two-bone IK to the held
//    weapon's grips (weapon placement comes from the weapon system).
//  - Poses for the air (jump/fall), sitting (vehicles) and surrender (kneeling).

import * as THREE from 'three';
import { BONE_PARENT, type BoneName, type Humanoid } from './humanoid.ts';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/** How the character holds a weapon this frame (character space, set by the weapon system). */
export interface HandTargets {
  /** Wrist target and the direction from wrist toward the fingers, plus thumb direction. */
  right: { pos: THREE.Vector3; dir: THREE.Vector3; thumb: THREE.Vector3 } | null;
  left: { pos: THREE.Vector3; dir: THREE.Vector3; thumb: THREE.Vector3 } | null;
  /** Elbow pole hints (character space). */
  rightPole?: THREE.Vector3;
  leftPole?: THREE.Vector3;
}

export interface AnimInput {
  /** Feet (capsule bottom) in world space. */
  pos: THREE.Vector3;
  /** World velocity. */
  vel: THREE.Vector3;
  /** Body yaw: the model's +Z faces (sin f, 0, cos f). */
  facing: number;
  grounded: boolean;
  crouch: number;
  sprint: boolean;
  /** Aim pitch (radians, + up) for the torso and head, and blend amount. */
  aimPitch: number;
  aimAmount: number;
  /** Optional world point to look at with the head. */
  lookAt: THREE.Vector3 | null;
  /**
   * Hands on a weapon (null = free arms). A function is called after the torso is
   * posed, so weapon placement can use the current shoulder positions.
   */
  hands: HandTargets | ((a: Animator) => HandTargets | null) | null;
  pose: 'normal' | 'sit' | 'surrender' | 'down';
  /** Upper-body flinch from being hit (0..1). */
  flinch: number;
}

export type GroundFn = (x: number, z: number, fromY: number) => number;

interface Joint {
  name: BoneName;
  bone: THREE.Bone;
  parent: Joint | null;
  /** Bind offset from the parent joint (character space, bind rotations are identity). */
  offset: THREE.Vector3;
  /** Current character-space rotation and position. */
  q: THREE.Quaternion;
  p: THREE.Vector3;
}

interface FootState {
  side: 1 | -1;
  plant: THREE.Vector3;
  from: THREE.Vector3;
  target: THREE.Vector3;
  swing: boolean;
  /** Current animated position (world). */
  cur: THREE.Vector3;
  normal: THREE.Vector3;
  lift: number;
  heel: number;
}

function smooth(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Quaternion that maps the bone's bind axes onto `down` (bone length axis) and `front`. */
function limbQuat(down: THREE.Vector3, front: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const y = _v1.copy(down).negate().normalize();
  const z = _v2.copy(front).addScaledVector(y, -front.dot(y));
  if (z.lengthSq() < 1e-8) z.set(0, 0, 1).addScaledVector(y, -y.z);
  z.normalize();
  const x = _v3.crossVectors(y, z).normalize();
  _m.makeBasis(x, y, z);
  return out.setFromRotationMatrix(_m);
}

export class Animator {
  readonly rig: Humanoid;
  private joints = new Map<BoneName, Joint>();
  private order: Joint[] = [];
  private feet: [FootState, FootState];
  private phase = 0;
  private ground: GroundFn;
  private hipsY = 0.97;
  private bob = 0;
  private lean = new THREE.Vector2();
  private prevVel = new THREE.Vector3();
  private speedS = 0;
  private air = 0;
  private landDip = 0;
  private landVel = 0;
  private breathe = Math.random() * 10;
  private headYaw = 0;
  private headPitch = 0;
  private poseBlend = { sit: 0, surrender: 0, down: 0 };
  private initialised = false;
  /** Hands were on a weapon in the last update (arm IK active). */
  handsActive = false;
  /** Called when a foot lands (side, world position, strength 0..1). */
  onFootPlant: ((side: 1 | -1, pos: THREE.Vector3, strength: number) => void) | null = null;
  readonly legLen: number;
  private readonly hipJointDrop: number;
  /** World transform of the character root for this frame. */
  private rootPos = new THREE.Vector3();
  private rootYaw = 0;
  private invYaw = new THREE.Quaternion();

  constructor(rig: Humanoid, ground: GroundFn) {
    this.rig = rig;
    this.ground = ground;
    const BIND_JOINTS = rig.joints;
    this.hipsY = BIND_JOINTS.hips[1];
    for (const [name, bone] of Object.entries(rig.bones) as [BoneName, THREE.Bone][]) {
      const parentName = BONE_PARENT[name];
      const j = BIND_JOINTS[name];
      const pj = parentName ? BIND_JOINTS[parentName] : [0, 0, 0];
      this.joints.set(name, {
        name, bone, parent: null,
        offset: new THREE.Vector3(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]),
        q: new THREE.Quaternion(), p: new THREE.Vector3(...j),
      });
    }
    for (const j of this.joints.values()) {
      const pn = BONE_PARENT[j.name];
      j.parent = pn ? this.joints.get(pn)! : null;
    }
    const visit = (n: BoneName) => {
      this.order.push(this.joints.get(n)!);
      for (const [c, p] of Object.entries(BONE_PARENT)) if (p === n) visit(c as BoneName);
    };
    visit('root');
    const mk = (side: 1 | -1): FootState => ({
      side, plant: new THREE.Vector3(), from: new THREE.Vector3(), target: new THREE.Vector3(), swing: false,
      cur: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), lift: 0, heel: 0,
    });
    this.feet = [mk(1), mk(-1)];
    // Hip joint to ankle with the leg straight (thigh + shin).
    this.legLen = BIND_JOINTS['thigh.L'][1] - BIND_JOINTS['foot.L'][1];
    this.hipJointDrop = BIND_JOINTS.hips[1] - BIND_JOINTS['thigh.L'][1];
  }

  private J(n: BoneName): Joint {
    return this.joints.get(n)!;
  }

  /** Set a joint's character-space rotation (parents must already be posed). */
  private setRot(n: BoneName, q: THREE.Quaternion): void {
    const j = this.J(n);
    j.q.copy(q);
    if (j.parent) {
      j.p.copy(j.offset).applyQuaternion(j.parent.q).add(j.parent.p);
      j.bone.quaternion.copy(_q1.copy(j.parent.q).invert().multiply(q));
    } else {
      j.bone.quaternion.copy(q);
    }
  }

  /** Position update for a joint whose parent moved (rotation unchanged). */
  private place(n: BoneName): void {
    const j = this.J(n);
    if (j.parent) j.p.copy(j.offset).applyQuaternion(j.parent.q).add(j.parent.p);
  }

  /** World → character space. */
  toChar(world: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(world).sub(this.rootPos).applyQuaternion(this.invYaw);
  }

  /** Character → world space. */
  toWorld(local: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(local).applyAxisAngle(UP, this.rootYaw).add(this.rootPos);
  }

  /** Character-space joint position (after the last update). */
  joint(n: BoneName, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.J(n).p);
  }

  jointQuat(n: BoneName, out = new THREE.Quaternion()): THREE.Quaternion {
    return out.copy(this.J(n).q);
  }

  /**
   * Character-space shoulder joint (upper-arm root) for side +1 (left) or -1
   * (right), valid once the chest is posed (inside a hands callback).
   */
  shoulderPoint(side: 1 | -1, out = new THREE.Vector3()): THREE.Vector3 {
    const sh = this.J(side > 0 ? 'shoulder.L' : 'shoulder.R');
    const up = this.J(side > 0 ? 'upperArm.L' : 'upperArm.R');
    return out.copy(up.offset).applyQuaternion(sh.q).add(sh.p);
  }

  /** Character-space position and rotation of a point attached to a bone. */
  attach(n: BoneName, local: THREE.Vector3, localQ: THREE.Quaternion, outP: THREE.Vector3, outQ: THREE.Quaternion): void {
    const j = this.J(n);
    outP.copy(local).applyQuaternion(j.q).add(j.p);
    outQ.copy(j.q).multiply(localQ);
  }

  /** Puts both feet under the hips (after teleports). */
  reset(pos: THREE.Vector3, facing: number): void {
    this.rootPos.copy(pos);
    this.rootYaw = facing;
    for (const f of this.feet) {
      const p = this.idealFoot(f.side, pos, facing, new THREE.Vector3());
      f.plant.copy(p);
      f.cur.copy(p);
      f.target.copy(p);
      f.swing = false;
    }
    this.phase = 0.1;
    this.initialised = true;
  }

  private idealFoot(side: 1 | -1, pos: THREE.Vector3, facing: number, out: THREE.Vector3): THREE.Vector3 {
    const sx = 0.11 * side;
    out.set(sx, 0, 0.02).applyAxisAngle(UP, facing).add(pos);
    out.y = this.ground(out.x, out.z, pos.y + 0.9);
    return out;
  }

  update(dt: number, s: AnimInput): void {
    if (!this.initialised) this.reset(s.pos, s.facing);
    dt = Math.min(dt, 0.05);
    this.rootPos.copy(s.pos);
    this.rootYaw = s.facing;
    this.invYaw.setFromAxisAngle(UP, -s.facing);
    this.rig.root.position.copy(s.pos);
    this.rig.root.rotation.set(0, s.facing, 0);
    this.breathe += dt;
    for (const k of ['sit', 'surrender', 'down'] as const) this.poseBlend[k] = THREE.MathUtils.damp(this.poseBlend[k], s.pose === k ? 1 : 0, 5, dt);

    const hv = _v1.set(s.vel.x, 0, s.vel.z);
    const speed = hv.length();
    this.speedS = THREE.MathUtils.damp(this.speedS, speed, 8, dt);
    // Acceleration in character space drives the torso lean.
    const acc = _v2.copy(s.vel).sub(this.prevVel).multiplyScalar(1 / Math.max(dt, 1e-3));
    this.prevVel.copy(s.vel);
    acc.applyQuaternion(this.invYaw);
    const localVel = _v3.copy(hv).applyQuaternion(this.invYaw);
    const leanF = THREE.MathUtils.clamp(localVel.z * 0.024 + acc.z * 0.012, -0.12, 0.3) * (1 - s.aimAmount * 0.6);
    const leanS = THREE.MathUtils.clamp(-acc.x * 0.01, -0.08, 0.08);
    this.lean.x = THREE.MathUtils.damp(this.lean.x, leanF, 6, dt);
    this.lean.y = THREE.MathUtils.damp(this.lean.y, leanS, 6, dt);

    // ------------------------------------------------ gait
    // Gait from the smoothed speed so cadence doesn't flicker with input noise;
    // walking speeds stay a pure walk, the run blend starts above them.
    const gs = this.speedS;
    const run = smooth((gs - 2.9) / 1.5);
    const duty = THREE.MathUtils.lerp(0.62, 0.36, run);
    // Walk steps grow more slowly with speed than run strides (no lunging).
    const stride = Math.min(3.1, THREE.MathUtils.lerp(0.9 + 0.36 * gs, 0.75 + 0.45 * gs, run));
    if (!s.grounded) this.air += dt;
    else {
      if (this.air > 0.3) this.landVel -= Math.min(1, this.air * 1.4) * 1.6;
      this.air = 0;
    }
    const airborne = this.air > 0.08;
    const unsettled = this.feet.some((f) => f.swing || f.plant.distanceTo(this.idealFoot(f.side, s.pos, s.facing, _v2)) > (speed < 0.2 ? 0.16 : 0.05));
    let cadence = 0;
    if (speed > 0.15) cadence = Math.max(gs, 0.3) / stride;
    else if (unsettled) cadence = 1.5; // settle or turn in place with short steps
    if (!airborne && this.poseBlend.sit < 0.5 && this.poseBlend.surrender < 0.5) this.phase += cadence * dt;
    const swingTime = (1 - duty) / Math.max(cadence, 0.5);
    for (const f of this.feet) {
      const local = (((this.phase + (f.side > 0 ? 0 : 0.5)) % 1) + 1) % 1;
      const inSwing = !airborne && cadence > 0 && local >= duty;
      if (inSwing && !f.swing) {
        f.swing = true;
        f.from.copy(f.plant);
      }
      if (f.swing) {
        // On the frame the cycle wraps into stance the swing is complete (sw = 1).
        const sw = inSwing ? THREE.MathUtils.clamp((local - duty) / (1 - duty), 0, 1) : 1;
        // Land ahead so that mid-stance falls under the hip.
        const remaining = (1 - sw) * swingTime;
        const lead = remaining + (duty / Math.max(cadence, 0.5)) * 0.5;
        this.idealFoot(f.side, _v2.copy(s.pos).addScaledVector(hv, speed > 0.15 ? lead : 0), s.facing, f.target);
        if (!inSwing || sw >= 0.999) {
          f.swing = false;
          f.plant.copy(f.target);
          f.cur.copy(f.target);
          this.onFootPlant?.(f.side, f.plant, THREE.MathUtils.clamp(speed / 5, 0.25, 1));
        } else {
          const e = smooth(sw);
          f.cur.lerpVectors(f.from, f.target, e);
          const arc = (0.07 + 0.12 * run) * Math.sin(sw * Math.PI) + Math.max(0, f.target.y - f.from.y) * Math.sin(sw * Math.PI * 0.5) * 0.4;
          f.cur.y += arc;
          f.lift = Math.sin(sw * Math.PI);
          f.heel = sw < 0.5 ? -0.45 * (1 - sw * 2) : 0.25 * Math.sin((sw - 0.5) * Math.PI * 2);
        }
      }
      if (!f.swing) {
        f.cur.copy(f.plant);
        f.lift = 0;
        // Heel rises at the end of stance before toe-off.
        const late = cadence > 0 ? smooth((local - duty * 0.65) / (duty * 0.35)) : 0;
        f.heel = THREE.MathUtils.damp(f.heel, late * (0.35 + 0.25 * run), 18, dt);
      }
      if (airborne) {
        // Legs tuck in the air; feet follow the body.
        const tuck = Math.min(1, this.air * 3);
        this.idealFoot(f.side, s.pos, s.facing, _v2);
        _v2.y = s.pos.y + 0.12 + 0.18 * tuck + (f.side > 0 ? 0.1 : 0);
        f.cur.lerp(_v2, Math.min(1, dt * 14));
        f.plant.copy(f.cur);
        f.swing = false;
        f.heel = 0.25 * tuck;
      }
    }

    // ------------------------------------------------ pelvis
    // Walking height comes from leg reach (compass gait, below); running adds a
    // bounce that peaks in the flight phase.
    const runBob = -Math.cos(this.phase * Math.PI * 4) * 0.035 * run;
    this.bob = THREE.MathUtils.damp(this.bob, speed > 0.15 ? runBob : 0, 12, dt);
    this.landVel += (-this.landDip * 110 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;
    const footL = this.toChar(this.feet[0].cur, new THREE.Vector3());
    const footR = this.toChar(this.feet[1].cur, new THREE.Vector3());
    const crouch = s.crouch;
    // Standing height keeps a soft knee; running sinks a little lower.
    let hipY = 0.955 - crouch * 0.36 - 0.05 * run * Math.min(1, speed / 3) + this.bob + this.landDip * 0.18;
    // Every planted foot must stay within reach: the hip joint may be at most a
    // (nearly straight) leg length from the ankle, which also lowers the pelvis
    // when the feet are spread in a stride or one foot is downhill.
    const reach = this.legLen * (0.975 - 0.02 * run);
    for (const [fc, st] of [[footL, this.feet[0]], [footR, this.feet[1]]] as const) {
      if (st.swing && !airborne) continue;
      const dx = fc.x - 0.09 * st.side;
      const dz = fc.z + this.lean.x * 0.15;
      const h2 = reach * reach - dx * dx - dz * dz;
      const maxHip = fc.y + 0.085 + this.hipJointDrop + Math.sqrt(Math.max(0.04, h2));
      hipY = Math.min(hipY, maxHip);
    }
    // Sitting lowers the pelvis onto the seat; kneeling lowers it further.
    hipY = THREE.MathUtils.lerp(hipY, 0.53, this.poseBlend.sit);
    hipY = THREE.MathUtils.lerp(hipY, 0.62, this.poseBlend.surrender);
    hipY = THREE.MathUtils.lerp(hipY, 0.2, this.poseBlend.down);
    this.hipsY = THREE.MathUtils.damp(this.hipsY, hipY, 20, dt);
    const sway = Math.sin(this.phase * Math.PI * 2) * 0.025 * (1 - run) * Math.min(1, speed / 1.5);
    const hips = this.J('hips');
    hips.bone.position.set(sway, this.hipsY, -this.lean.x * 0.15 - this.poseBlend.sit * 0.05);
    hips.offset.copy(hips.bone.position);
    const hipYaw = Math.sin(this.phase * Math.PI * 2) * (0.07 + 0.05 * run) * Math.min(1, speed / 2);
    const hipQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.lean.x * 0.25 - crouch * 0.15, hipYaw, this.lean.y - sway * 1.2, 'YXZ'));
    this.setRot('root', new THREE.Quaternion());
    this.J('root').p.set(0, 0, 0);
    this.setRot('hips', hipQ);

    // ------------------------------------------------ spine, chest, head
    const breath = Math.sin(this.breathe * 1.6) * 0.012;
    const aimP = THREE.MathUtils.clamp(s.aimPitch, -1.1, 1.0) * s.aimAmount;
    const flinch = s.flinch;
    const spinePitch = this.lean.x * 0.55 + crouch * 0.18 - aimP * 0.3 + flinch * 0.12;
    const chestPitch = this.lean.x * 0.3 + breath - aimP * 0.35 + flinch * 0.1;
    const counter = -hipYaw * 1.6;
    const kneel = this.poseBlend.surrender;
    this.setRot('spine', new THREE.Quaternion().setFromEuler(new THREE.Euler(spinePitch + kneel * 0.1, counter * 0.5, this.lean.y * 0.5, 'YXZ')).premultiply(hipQ));
    this.setRot('chest', new THREE.Quaternion().setFromEuler(new THREE.Euler(chestPitch, counter * 0.5 - s.aimAmount * 0.12, this.lean.y * 0.3, 'YXZ')).premultiply(this.J('spine').q));
    // Head: look at target (limited), otherwise level the gaze.
    let wantYaw = 0;
    let wantPitch = -aimP * 0.35;
    if (s.lookAt) {
      const head = _v2.copy(this.J('neck').p).add(new THREE.Vector3(0, 0.12, 0));
      const t = this.toChar(s.lookAt, _v3).sub(head);
      wantYaw = THREE.MathUtils.clamp(Math.atan2(t.x, t.z), -1.1, 1.1);
      wantPitch = THREE.MathUtils.clamp(Math.atan2(t.y, Math.hypot(t.x, t.z)), -0.7, 0.6);
    }
    this.headYaw = THREE.MathUtils.damp(this.headYaw, wantYaw, 8, dt);
    this.headPitch = THREE.MathUtils.damp(this.headPitch, wantPitch, 8, dt);
    const chestQ = this.J('chest').q;
    // Remove the chest's own pitch so the head pitch is relative to level.
    const levelHead = new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.headPitch * 0.5 - chestPitch * 0.4 - spinePitch * 0.4 - this.lean.x * 0.2, this.headYaw * 0.4 - counter * 0.3, 0, 'YXZ'));
    this.setRot('neck', levelHead.clone().premultiply(chestQ));
    this.setRot('head', new THREE.Quaternion().setFromEuler(new THREE.Euler(-this.headPitch * 0.5 + kneel * 0.15, this.headYaw * 0.6, 0, 'YXZ')).premultiply(this.J('neck').q));

    // ------------------------------------------------ legs
    for (const f of this.feet) this.solveLeg(f, dt);

    // ------------------------------------------------ arms
    this.setRot('shoulder.L', chestQ);
    this.setRot('shoulder.R', chestQ);
    const hands = typeof s.hands === 'function' ? s.hands(this) : s.hands;
    this.handsActive = !!hands;
    if (this.poseBlend.surrender > 0.5) this.surrenderArms();
    else if (hands) this.solveArms(hands);
    else this.swingArms(speed, run, s);
    this.rig.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ legs

  private solveLeg(f: FootState, dt: number): void {
    const L = f.side > 0 ? '.L' : '.R';
    const thigh = `thigh${L}` as BoneName;
    const shin = `shin${L}` as BoneName;
    const foot = `foot${L}` as BoneName;
    const toe = `toe${L}` as BoneName;
    this.place(thigh);
    const hip = this.J(thigh).p;
    const l1 = this.J(shin).offset.length();
    const l2 = this.J(foot).offset.length();
    // Ankle target: foot contact point raised by the ankle height.
    const ankle = this.toChar(f.cur, new THREE.Vector3());
    // The ankle sits above the sole; it rises as the heel peels off the ground.
    ankle.y += 0.085 + Math.max(0, f.heel) * 0.09;
    const front = new THREE.Vector3(0.12 * f.side, 0, 1).normalize();
    // Pose overrides: sitting (thighs forward) and kneeling.
    if (this.poseBlend.sit > 0.01) {
      const seatKnee = new THREE.Vector3(0.11 * f.side, 0.55, 0.45);
      const seatAnkle = new THREE.Vector3(0.12 * f.side, 0.12, 0.52);
      ankle.lerp(seatAnkle, this.poseBlend.sit);
      void seatKnee;
    }
    if (this.poseBlend.surrender > 0.01) {
      // Kneeling: knees on the ground under the hips, shins back.
      const kneelAnkle = new THREE.Vector3(0.12 * f.side, 0.08, -0.42);
      ankle.lerp(kneelAnkle, this.poseBlend.surrender);
    }
    if (this.poseBlend.down > 0.01) {
      const lie = new THREE.Vector3(0.13 * f.side, 0.08, 0.7);
      ankle.lerp(lie, this.poseBlend.down);
    }
    const knee = this.twoBone(hip, ankle, l1, l2, front, new THREE.Vector3());
    const thighDown = knee.clone().sub(hip);
    const shinDown = ankle.clone().sub(knee);
    // Thigh front: opposite of the shin's bend, falling back to the body front.
    const thighFront = shinDown.clone().negate();
    if (thighFront.clone().addScaledVector(thighDown.clone().normalize(), -thighFront.dot(thighDown.clone().normalize())).lengthSq() < 1e-4) thighFront.copy(front);
    else thighFront.addScaledVector(thighDown.clone().normalize(), -thighFront.dot(thighDown.clone().normalize())).normalize();
    if (thighFront.dot(front) < 0) thighFront.negate();
    this.setRot(thigh, limbQuat(thighDown, thighFront, new THREE.Quaternion()));
    this.setRot(shin, limbQuat(shinDown, thighFront, new THREE.Quaternion()));
    // Foot: flat on the ground (terrain normal), toe along the facing, heel roll.
    const n = f.swing ? UP : this.groundNormal(f.cur, f.normal, dt);
    const fwd = new THREE.Vector3(0.08 * f.side, 0, 1).normalize();
    fwd.addScaledVector(n, -fwd.dot(n)).normalize();
    // Bind foot: length axis -Y points down from the ankle; build a frame whose
    // "down" is -n and "front" is the toe direction, then roll by the heel angle.
    const footQ = limbQuat(n.clone().negate(), fwd, new THREE.Quaternion());
    const side = new THREE.Vector3().crossVectors(n, fwd).normalize();
    footQ.premultiply(new THREE.Quaternion().setFromAxisAngle(side, f.heel * 0.9));
    if (this.poseBlend.surrender > 0.01) footQ.slerp(this.J(shin).q, this.poseBlend.surrender * 0.8);
    this.setRot(foot, footQ);
    // Toes bend back when the heel lifts.
    const toeQ = footQ.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(side, -Math.max(0, f.heel) * 0.8));
    this.setRot(toe, toeQ);
  }

  private normalCache = new THREE.Vector3(0, 1, 0);
  private groundNormal(p: THREE.Vector3, prev: THREE.Vector3, dt: number): THREE.Vector3 {
    const e = 0.18;
    const y = p.y;
    const hx = this.ground(p.x + e, p.z, y + 0.6) - this.ground(p.x - e, p.z, y + 0.6);
    const hz = this.ground(p.x, p.z + e, y + 0.6) - this.ground(p.x, p.z - e, y + 0.6);
    const n = this.normalCache.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
    // Limit the tilt (steps and kerbs return huge gradients).
    if (n.y < 0.8) n.set(n.x, 0.8 / Math.max(0.2, n.y) * n.y, n.z).normalize();
    prev.lerp(n, Math.min(1, dt * 10)).normalize();
    // Character space.
    return prev.clone().applyQuaternion(this.invYaw);
  }

  /** Two-bone IK: returns the middle joint position; `pole` is where it should point. */
  private twoBone(a: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const toT = target.clone().sub(a);
    let d = toT.length();
    const dir = d > 1e-5 ? toT.multiplyScalar(1 / d) : new THREE.Vector3(0, -1, 0);
    d = THREE.MathUtils.clamp(d, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
    // Pull an out-of-reach target in (straight limb) so the end bone lands on it.
    target.copy(a).addScaledVector(dir, d);
    const cosA = THREE.MathUtils.clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const u = pole.clone().addScaledVector(dir, -pole.dot(dir));
    if (u.lengthSq() < 1e-6) u.set(0, 0, 1).addScaledVector(dir, -dir.z);
    u.normalize();
    return out.copy(a).addScaledVector(dir, l1 * cosA).addScaledVector(u, l1 * sinA);
  }

  // ------------------------------------------------------------ arms

  private swingArms(speed: number, run: number, s: AnimInput): void {
    const amp = Math.min(1, speed / 1.6) * (0.35 + 0.45 * run) * (1 - s.crouch * 0.5);
    for (const side of [1, -1] as const) {
      const L = side > 0 ? '.L' : '.R';
      const upper = `upperArm${L}` as BoneName;
      const fore = `foreArm${L}` as BoneName;
      const hand = `hand${L}` as BoneName;
      // Arm swings opposite to the same-side leg: furthest back as that foot lands.
      const swing = -Math.cos((this.phase + (side > 0 ? 0 : 0.5)) * Math.PI * 2) * amp;
      const chestQ = this.J('chest').q;
      const abduct = 0.1 + 0.06 * run;
      const upperQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-swing - 0.05 * run, 0, abduct * side, 'XYZ')).premultiply(chestQ);
      this.setRot(upper, upperQ);
      const elbow = 0.18 + 0.9 * run + Math.max(0, swing) * 0.4 + s.crouch * 0.3;
      this.setRot(fore, new THREE.Quaternion().setFromEuler(new THREE.Euler(-elbow, 0, 0)).premultiply(upperQ));
      this.setRot(hand, new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0.15 * side, 0)).premultiply(this.J(fore).q));
    }
  }

  private surrenderArms(): void {
    // Hands on the head, elbows out.
    const head = this.J('head').p;
    this.solveArms({
      right: { pos: head.clone().add(new THREE.Vector3(-0.06, 0.16, -0.04)), dir: new THREE.Vector3(0.7, 0.2, 0.1).normalize(), thumb: new THREE.Vector3(0, 0, 1) },
      left: { pos: head.clone().add(new THREE.Vector3(0.06, 0.16, -0.04)), dir: new THREE.Vector3(-0.7, 0.2, 0.1).normalize(), thumb: new THREE.Vector3(0, 0, 1) },
      rightPole: new THREE.Vector3(-1, 0.2, -0.3),
      leftPole: new THREE.Vector3(1, 0.2, -0.3),
    });
  }

  private solveArms(h: HandTargets): void {
    for (const side of [1, -1] as const) {
      const L = side > 0 ? '.L' : '.R';
      const t = side > 0 ? h.left : h.right;
      const upper = `upperArm${L}` as BoneName;
      const fore = `foreArm${L}` as BoneName;
      const hand = `hand${L}` as BoneName;
      if (!t) {
        // Free hand hangs relaxed.
        const chestQ = this.J('chest').q;
        const upperQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0, 0.12 * side)).premultiply(chestQ);
        this.setRot(upper, upperQ);
        this.setRot(fore, new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0, 0)).premultiply(upperQ));
        this.setRot(hand, this.J(fore).q.clone());
        continue;
      }
      this.place(upper);
      const sh = this.J(upper).p;
      const l1 = this.J(fore).offset.length();
      const l2 = this.J(hand).offset.length();
      const pole = (side > 0 ? h.leftPole : h.rightPole) ?? new THREE.Vector3(0.6 * side, -0.8, -0.3);
      const wrist = t.pos.clone();
      const elbow = this.twoBone(sh, wrist, l1, l2, pole, new THREE.Vector3());
      const upperDown = elbow.clone().sub(sh);
      const foreDown = wrist.clone().sub(elbow);
      // Upper arm front: the direction the forearm folds toward.
      const ud = upperDown.clone().normalize();
      const upperFront = foreDown.clone().addScaledVector(ud, -foreDown.dot(ud));
      if (upperFront.lengthSq() < 1e-5) upperFront.copy(t.thumb);
      const upperQ = limbQuat(upperDown, upperFront.normalize(), new THREE.Quaternion());
      this.setRot(upper, upperQ);
      // Forearm front: toward the shoulder (thumb side up when the elbow bends).
      const fd = foreDown.clone().normalize();
      const foreFront = t.thumb.clone().addScaledVector(fd, -t.thumb.dot(fd));
      if (foreFront.lengthSq() < 1e-5) foreFront.copy(upperFront);
      this.setRot(fore, limbQuat(foreDown, foreFront.normalize(), new THREE.Quaternion()));
      this.setRot(hand, limbQuat(t.dir, t.thumb, new THREE.Quaternion()));
    }
  }
}
