// How a character holds a gun: shared by the player's weapon system and the
// hostile NPCs. Computes the gun's character-space transform for a blend of low
// ready, aimed and sprint-carry poses, and the hand targets that put the right
// hand on the grip and the left hand on the handguard (or wrapped on a pistol).

import * as THREE from 'three';
import type { Animator, HandTargets } from '../character/animator.ts';
import type { HandAnchor, WeaponModel } from './models.ts';
import type { WeaponDef } from './defs.ts';

export const UP = new THREE.Vector3(0, 1, 0);

/** Rotation mapping model +Z to `forward` and +Y as close to `up` as possible. */
export function lookQuat(forward: THREE.Vector3, up: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  const z = forward.clone().normalize();
  const x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function smooth(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Position the model so that `anchor` lands on `at` with rotation `q`. */
export function placeAnchor(anchor: THREE.Vector3, at: THREE.Vector3, q: THREE.Quaternion, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(at).sub(anchor.clone().applyQuaternion(q));
}

/**
 * Character-space gun transform. `aimChar` is the aim point in character space,
 * `aim` blends low ready -> shouldered/extended, `sprint` blends to a carry pose.
 */
export function holdTransform(a: Animator, m: WeaponModel, def: WeaponDef, aimChar: THREE.Vector3, aim: number, sprint: number, outPos: THREE.Vector3, outQ: THREE.Quaternion): void {
  const chestQ = a.jointQuat('chest');
  const shR = a.shoulderPoint(-1);
  const shL = a.shoulderPoint(1);
  const t = smooth(aim);
  if (def.hold === 'rifle') {
    // Stock in the right shoulder pocket, bore toward the aim point.
    const pocket = shR.clone().add(new THREE.Vector3(0.075, -0.04, 0.06).applyQuaternion(chestQ));
    const aimDir = aimChar.clone().sub(pocket).normalize();
    if (aimDir.z < 0.2) aimDir.z = 0.2;
    aimDir.normalize();
    const qAim = lookQuat(aimDir, UP);
    // Low ready: muzzle down and a little left, stock still in the shoulder.
    const flat = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
    const readyDir = flat.clone().multiplyScalar(Math.cos(0.5)).add(new THREE.Vector3(0, -Math.sin(0.5), 0)).applyAxisAngle(UP, 0.28).normalize();
    const qReady = lookQuat(readyDir, UP);
    outQ.slerpQuaternions(qReady, qAim, t);
    const pocketReady = pocket.clone().add(new THREE.Vector3(0.02, -0.06, 0.03));
    placeAnchor(m.butt ?? new THREE.Vector3(), pocketReady.lerp(pocket, t), outQ, outPos);
    if (sprint > 0.01) {
      // Port arms across the chest.
      const sDir = new THREE.Vector3(0.55, 0.55, 0.62).normalize().applyQuaternion(chestQ);
      const sQ = lookQuat(sDir, new THREE.Vector3(0, 0, -1).applyQuaternion(chestQ));
      const sGrip = a.joint('chest').add(new THREE.Vector3(-0.1, -0.12, 0.22).applyQuaternion(chestQ));
      outPos.lerp(placeAnchor(m.grip.pos, sGrip, sQ), sprint);
      outQ.slerp(sQ, sprint);
    }
    return;
  }
  // Pistol: isosceles stance when aimed, two-handed low ready otherwise.
  const mid = shR.clone().lerp(shL, 0.5);
  const eye = mid.clone().add(new THREE.Vector3(0, 0.14, 0.04));
  const aimDir = aimChar.clone().sub(eye).normalize();
  if (aimDir.z < 0.25) aimDir.z = 0.25;
  aimDir.normalize();
  const gripAim = mid.clone().addScaledVector(aimDir, 0.47).add(new THREE.Vector3(-0.015, -0.04, 0));
  const qAim = lookQuat(aimChar.clone().sub(gripAim).normalize(), UP);
  const flat = new THREE.Vector3(aimDir.x, 0, aimDir.z).normalize();
  const gripReady = mid.clone().add(new THREE.Vector3(-0.03, -0.28, 0.28).applyQuaternion(chestQ));
  const readyDir = flat.clone().multiplyScalar(Math.cos(0.75)).add(new THREE.Vector3(0, -Math.sin(0.75), 0)).normalize();
  const qReady = lookQuat(readyDir, UP);
  outQ.slerpQuaternions(qReady, qAim, t);
  placeAnchor(m.grip.pos, gripReady.lerp(gripAim, t), outQ, outPos);
  if (sprint > 0.01) {
    const sGrip = mid.clone().add(new THREE.Vector3(-0.08, -0.36, 0.18).applyQuaternion(chestQ));
    const sQ = lookQuat(new THREE.Vector3(0, -0.9, 0.35).normalize(), new THREE.Vector3(0, 0, 1));
    outPos.lerp(placeAnchor(m.grip.pos, sGrip, sQ), sprint);
    outQ.slerp(sQ, sprint);
  }
}

/** Wrist target for a hand anchor on a gun at (pos, q), or at an override palm position. */
export function handOn(anchor: HandAnchor, pos: THREE.Vector3, q: THREE.Quaternion, override: THREE.Vector3 | null = null): NonNullable<HandTargets['right']> {
  const dir = anchor.dir.clone().applyQuaternion(q);
  const thumb = anchor.thumb.clone().applyQuaternion(q);
  const palm = override ?? anchor.pos.clone().applyQuaternion(q).add(pos);
  return { pos: palm.clone().addScaledVector(dir, -0.07), dir, thumb };
}

/** Elbow pole hints for a two-handed hold. */
export function holdPoles(aim: number): { rightPole: THREE.Vector3; leftPole: THREE.Vector3 } {
  return { rightPole: new THREE.Vector3(-0.9, -0.5 + aim * 0.35, -0.2), leftPole: new THREE.Vector3(0.35, -0.9, -0.1) };
}
