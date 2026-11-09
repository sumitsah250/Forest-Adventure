// The player's own character: a skinned glTF (public/assets/models/player/
// sumit_character.glb). Its own Idle / Walk / Run / Jump clips play while the
// player moves empty-handed; the game's procedural animator (the same one every
// other humanoid uses) takes over for what the clips don't cover: weapon grips and
// aiming, crouching, sitting in vehicles and kneeling.
//
// The model uses the game's bone names but its own proportions and a relaxed
// A-pose. The animator expects identity bind rotations with every arm and leg
// segment hanging straight down (-Y). So the rig is rebuilt in a "straightened"
// bind pose: each limb segment keeps its modelled length but points straight
// down, feet stay flat as modelled, and the mesh is re-bound so it appears in
// that pose. The animator then reads this rig's own joint table (real height)
// instead of the default 1.80 m one. Clip poses are retargeted onto this rig
// exactly: each bone's world rotation from the clip is multiplied by the inverse
// of its straightening correction (see PlayerClips).
//
// If the file is missing or fails to load, the built-in procedural character is
// used instead.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { assetUrl } from '../render/textures.ts';
import { BONE_NAMES, BONE_PARENT, createHumanoid, type BoneName, type Humanoid, type Outfit } from './humanoid.ts';

const MODEL_URL = 'models/player/sumit_character.glb';

/** Limb segments straightened to point down: bone -> the child joint it reaches. */
const LIMBS: Partial<Record<BoneName, BoneName>> = {
  'upperArm.L': 'foreArm.L', 'foreArm.L': 'hand.L',
  'upperArm.R': 'foreArm.R', 'foreArm.R': 'hand.R',
  'thigh.L': 'shin.L', 'shin.L': 'foot.L',
  'thigh.R': 'shin.R', 'shin.R': 'foot.R',
};
/** Bones that keep the orientation they were modelled with (feet flat on the ground). */
const KEEP = new Set<BoneName>(['foot.L', 'foot.R']);
const DOWN = new THREE.Vector3(0, -1, 0);

interface Template {
  geometry: THREE.BufferGeometry;
  materials: THREE.Material[];
  joints: Record<BoneName, [number, number, number]>;
  /** Skin bone names in the order the vertex joint indices refer to. */
  order: BoneName[];
  boneInverses: THREE.Matrix4[];
  /** The file's own skeleton (bones only) and animation clips. */
  armature: THREE.Object3D;
  clips: THREE.AnimationClip[];
  /** Per bone: inverse of (straightening correction * modelled rest rotation). */
  unbind: Record<BoneName, THREE.Quaternion>;
}

let template: Template | null = null;
let loading: Promise<boolean> | null = null;

/** Starts (once) loading the player's model. Resolves true when it is ready. */
export function loadPlayerModel(): Promise<boolean> {
  loading ??= new GLTFLoader()
    .loadAsync(assetUrl(MODEL_URL))
    .then((gltf) => {
      template = buildTemplate(gltf.scene, gltf.animations);
      return true;
    })
    .catch((err: unknown) => {
      console.warn('[player] Could not load the player model; using the built-in character.', err);
      return false;
    });
  return loading;
}

/**
 * The game's bone name for a loaded bone. GLTFLoader sanitises node names for
 * animation binding and drops the dots ("shoulder.L" arrives as "shoulderL").
 */
function boneName(loaded: string): BoneName {
  const key = loaded.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const n = BONE_NAMES.find((b) => b.replace(/[^A-Za-z0-9]/g, '').toLowerCase() === key);
  if (!n) throw new Error(`unknown bone "${loaded}" in player model`);
  return n;
}

function buildTemplate(scene: THREE.Object3D, clips: THREE.AnimationClip[]): Template {
  scene.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
  });
  if (!meshes.length) throw new Error('player model has no skinned mesh');
  const skeleton = meshes[0].skeleton;
  const order = skeleton.bones.map((b) => boneName(b.name));
  for (const m of meshes) {
    if (m.skeleton.bones.length !== order.length || m.skeleton.bones.some((b, i) => boneName(b.name) !== order[i])) {
      throw new Error('player model meshes must share one skin');
    }
  }

  // Modelled rest pose: world position and rotation of every joint.
  const restP = {} as Record<BoneName, THREE.Vector3>;
  const restQ = {} as Record<BoneName, THREE.Quaternion>;
  for (const name of BONE_NAMES) {
    restP[name] = new THREE.Vector3();
    restQ[name] = new THREE.Quaternion();
  }
  for (const b of skeleton.bones) {
    b.matrixWorld.decompose(restP[boneName(b.name)], restQ[boneName(b.name)], new THREE.Vector3());
  }
  for (const name of BONE_NAMES) {
    if (!order.includes(name) && name !== 'root') throw new Error(`player model is missing bone "${name}"`);
  }

  // Straightened pose: position s and correction rotation r per joint (parents first).
  const s = {} as Record<BoneName, THREE.Vector3>;
  const r = {} as Record<BoneName, THREE.Quaternion>;
  for (const name of BONE_NAMES) {
    const parent = BONE_PARENT[name];
    if (!parent) {
      s[name] = restP[name].clone();
      r[name] = new THREE.Quaternion();
      continue;
    }
    s[name] = restP[name].clone().sub(restP[parent]).applyQuaternion(r[parent]).add(s[parent]);
    const child = LIMBS[name];
    if (child) {
      const d = restP[child].clone().sub(restP[name]).applyQuaternion(r[parent]).normalize();
      r[name] = new THREE.Quaternion().setFromUnitVectors(d, DOWN).multiply(r[parent]);
    } else if (KEEP.has(name)) {
      r[name] = new THREE.Quaternion();
    } else {
      r[name] = r[parent].clone();
    }
  }
  // Straight legs reach a little lower than bent ones: lift so the soles stay on the ground.
  const lift = ((restP['foot.L'].y - s['foot.L'].y) + (restP['foot.R'].y - s['foot.R'].y)) / 2;
  const joints = {} as Record<BoneName, [number, number, number]>;
  for (const name of BONE_NAMES) {
    if (name !== 'root') s[name].y += lift;
    joints[name] = [s[name].x, s[name].y, s[name].z];
  }

  // Re-bind: at bind the rig's bone world matrix is translate(s), so the inverse
  // that shows the mesh straightened is rotate(r * restQ) * originalInverse.
  const boneInverses = order.map((name, i) =>
    new THREE.Matrix4()
      .makeRotationFromQuaternion(r[name].clone().multiply(restQ[name]))
      .multiply(skeleton.boneInverses[i]),
  );

  // One geometry with a group per original primitive, so the rig has a single mesh.
  const geos: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  for (const m of meshes) {
    const g = m.geometry.clone();
    if (!m.bindMatrix.equals(new THREE.Matrix4())) g.applyMatrix4(m.bindMatrix);
    geos.push(g);
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    materials.push(mat);
  }
  const geometry = mergeGeometries(geos, true);
  if (!geometry) throw new Error('player model primitives have mismatched attributes');
  for (const g of geos) g.dispose();
  // The armature (parent of the hips) is kept, bones only, to sample the clips on.
  const hips = skeleton.bones.find((b) => boneName(b.name) === 'hips')!;
  const armature = (hips.parent ?? hips).clone(false);
  armature.add(hips.clone(true));
  armature.position.set(0, 0, 0);
  armature.quaternion.identity();
  armature.scale.set(1, 1, 1);
  const unbind = {} as Record<BoneName, THREE.Quaternion>;
  for (const name of BONE_NAMES) unbind[name] = r[name].clone().multiply(restQ[name]).invert();
  for (const mat of materials) {
    const std = mat as THREE.MeshStandardMaterial;
    if (std.map) std.map.anisotropy = 8;
  }
  return { geometry, materials, joints, order, boneInverses, armature, clips, unbind };
}

/** The player's character: the loaded model if ready, otherwise the built-in one. */
export function createPlayerHumanoid(outfit: Outfit): Humanoid {
  const t = template;
  if (!t) return createHumanoid(outfit);
  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const name of BONE_NAMES) {
    const b = new THREE.Bone();
    b.name = name;
    bones[name] = b;
  }
  for (const name of BONE_NAMES) {
    const parent = BONE_PARENT[name];
    const j = t.joints[name];
    if (parent) {
      const pj = t.joints[parent];
      bones[name].position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
      bones[parent].add(bones[name]);
    } else {
      bones[name].position.set(...j);
    }
  }
  const skeleton = new THREE.Skeleton(
    t.order.map((n) => bones[n]),
    t.boneInverses.map((m) => m.clone()),
  );
  const mesh = new THREE.SkinnedMesh(t.geometry, t.materials);
  mesh.add(bones.root);
  mesh.bind(skeleton, new THREE.Matrix4());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.name = 'character-player-model';
  const root = new THREE.Group();
  root.add(mesh);
  return { root, mesh, bones, outfit, joints: t.joints };
}

// ------------------------------------------------------------------ clips

export interface ClipState {
  /** Horizontal speed (m/s). */
  speed: number;
  grounded: boolean;
  /** Vertical speed (m/s, + up). */
  vy: number;
  /** Clips drive the body (false: the procedural animator does, e.g. weapons out). */
  active: boolean;
}

/** Fastest playback of the walk/run cycles, relative to their own pace. */
const MAX_TEMPO = 2;

const smoothstep = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Plays the model's own clips on a player rig. Runs after the procedural animator
 * each frame and blends over its pose (fading in and out as `active` changes).
 * Walk and run are in-place cycles: their playback rate follows the real speed
 * (measured from the planted foot in each clip), so the feet don't slide.
 */
export class PlayerClips {
  private rig: Humanoid;
  private armature: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private src = {} as Record<BoneName, THREE.Object3D>;
  private unbind: Record<BoneName, THREE.Quaternion>;
  private idle: THREE.AnimationAction | null;
  private walk: THREE.AnimationAction | null;
  private run: THREE.AnimationAction | null;
  private jump: THREE.AnimationAction | null;
  /** Natural ground speed of the walk and run cycles (m/s). */
  readonly walkSpeed: number;
  readonly runSpeed: number;
  private phase = 0;
  private idleT = 0;
  private jumpT = 0;
  private jumpW = 0;
  private airborne = false;
  private airT = 0;
  /** Overall blend over the procedural pose (0..1). */
  weight = 0;

  private constructor(rig: Humanoid, t: Template) {
    this.rig = rig;
    this.armature = t.armature.clone(true);
    this.unbind = t.unbind;
    this.armature.traverse((o) => {
      try {
        this.src[boneName(o.name)] = o;
      } catch {
        // The armature node itself is not a bone.
      }
    });
    this.mixer = new THREE.AnimationMixer(this.armature);
    const find = (re: RegExp) => {
      const c = t.clips.find((k) => re.test(k.name));
      if (!c) return null;
      const a = this.mixer.clipAction(c);
      a.play();
      a.setEffectiveWeight(0);
      return a;
    };
    this.idle = find(/idle/i);
    this.walk = find(/walk/i);
    this.run = find(/run|sprint|jog/i);
    this.jump = find(/jump/i);
    this.walkSpeed = this.walk ? this.measureSpeed(this.walk, 1.4) : 1.4;
    this.runSpeed = this.run ? Math.max(this.walkSpeed + 0.5, this.measureSpeed(this.run, 3.8)) : 3.8;
  }

  /** Clip player for a rig made by createPlayerHumanoid (null when it has no clips). */
  static create(rig: Humanoid): PlayerClips | null {
    const t = template;
    if (!t || !t.clips.length || rig.mesh.name !== 'character-player-model') return null;
    return new PlayerClips(rig, t);
  }

  /** Ground speed of an in-place cycle: how fast the lower (planted) foot moves back. */
  private measureSpeed(action: THREE.AnimationAction, fallback: number): number {
    const clip = action.getClip();
    const n = 90;
    const dt = clip.duration / n;
    const footL = this.src['foot.L'];
    const footR = this.src['foot.R'];
    if (!footL || !footR) return fallback;
    const pl = new THREE.Vector3();
    const pr = new THREE.Vector3();
    const prev = { l: 0, r: 0, low: '' };
    const rates: number[] = [];
    for (const a of [this.idle, this.walk, this.run, this.jump]) a?.setEffectiveWeight(a === action ? 1 : 0);
    for (let i = 0; i <= n; i += 1) {
      action.time = i * dt;
      this.mixer.update(0);
      this.armature.updateMatrixWorld(true);
      footL.getWorldPosition(pl);
      footR.getWorldPosition(pr);
      const low = pl.y < pr.y ? 'l' : 'r';
      if (i > 0 && low === prev.low) rates.push(-((low === 'l' ? pl.z : pr.z) - (low === 'l' ? prev.l : prev.r)) / dt);
      prev.l = pl.z;
      prev.r = pr.z;
      prev.low = low;
    }
    action.setEffectiveWeight(0);
    rates.sort((a, b) => a - b);
    const v = rates[Math.floor(rates.length / 2)] ?? 0;
    return v > 0.3 && v < 12 ? v : fallback;
  }

  update(dt: number, s: ClipState): void {
    this.weight = THREE.MathUtils.damp(this.weight, s.active ? 1 : 0, s.active ? 7 : 10, dt);
    if (this.weight < 0.002) return;
    // Locomotion weights: idle -> walk -> run by speed.
    const v = s.speed;
    const move = smoothstep(v / 0.6);
    const runF = this.run ? smoothstep((v - this.walkSpeed) / Math.max(0.1, this.runSpeed - this.walkSpeed)) : 0;
    // One shared cycle phase for walk and run, advanced at the rate that matches the speed.
    if (move > 0.01) {
      const wDur = this.walk?.getClip().duration ?? 1;
      const rDur = this.run?.getClip().duration ?? wDur;
      // Tempo follows the speed so planted feet stay put, but never more than
      // MAX_TEMPO x the clip's own pace (past that the legs look frantic and a
      // little foot slide reads better).
      const rateW = Math.min(v / this.walkSpeed, MAX_TEMPO) / wDur;
      const rateR = Math.min(v / this.runSpeed, MAX_TEMPO) / rDur;
      this.phase = (this.phase + dt * THREE.MathUtils.lerp(rateW, rateR, runF)) % 1;
    }
    this.idleT += dt;
    // Jump: skip the wind-up (the jump is instant in game), hold the airborne part,
    // then let the landing play out while blending back to the ground cycle.
    // Real jumps (rising) start at once; a step off a kerb has to last a moment.
    this.airT = s.grounded ? 0 : this.airT + dt;
    if (!s.grounded && !this.airborne && (s.vy > 0.8 || this.airT > 0.2)) {
      this.airborne = true;
      this.jumpT = (this.jump?.getClip().duration ?? 1) * 0.3;
    }
    if (s.grounded) this.airborne = false;
    const jDur = this.jump?.getClip().duration ?? 1;
    this.jumpT = Math.min(this.jumpT + dt, this.airborne ? jDur * 0.62 : jDur);
    this.jumpW = THREE.MathUtils.damp(this.jumpW, this.airborne && this.jump ? 1 : 0, this.airborne ? 14 : 7, dt);
    const ground = 1 - this.jumpW;
    let wIdle = ground * (1 - move);
    let wWalk = ground * move * (1 - runF);
    let wRun = ground * move * runF;
    if (!this.walk) {
      wRun += wWalk;
      wWalk = 0;
    }
    if (!this.run) {
      wWalk += wRun;
      wRun = 0;
    }
    if (!this.idle) {
      wWalk += wIdle;
      wIdle = 0;
    }
    if (this.idle) {
      this.idle.time = this.idleT % this.idle.getClip().duration;
      this.idle.setEffectiveWeight(wIdle);
    }
    if (this.walk) {
      this.walk.time = this.phase * this.walk.getClip().duration;
      this.walk.setEffectiveWeight(wWalk);
    }
    if (this.run) {
      this.run.time = this.phase * this.run.getClip().duration;
      this.run.setEffectiveWeight(wRun);
    }
    if (this.jump) {
      this.jump.time = this.jumpT;
      this.jump.setEffectiveWeight(this.jumpW);
    }
    this.mixer.update(0);
    this.armature.updateMatrixWorld(true);
    this.apply();
  }

  private qProc = new THREE.Quaternion();
  private qClip = new THREE.Quaternion();
  private world = {} as Record<BoneName, THREE.Quaternion>;
  private procWorld = {} as Record<BoneName, THREE.Quaternion>;
  private tmpP = new THREE.Vector3();
  private tmpS = new THREE.Vector3();

  /** Retargets the sampled clip pose onto the rig, blended over the procedural pose. */
  private apply(): void {
    const w = this.weight;
    const bones = this.rig.bones;
    for (const name of BONE_NAMES) {
      const parent = BONE_PARENT[name];
      const bone = bones[name];
      const pw = (this.procWorld[name] ??= new THREE.Quaternion());
      const bw = (this.world[name] ??= new THREE.Quaternion());
      // Procedural world rotation (character space) before this pass.
      pw.copy(bone.quaternion);
      if (parent) pw.premultiply(this.procWorld[parent]);
      const src = this.src[name];
      if (!src || name === 'root') {
        bw.copy(pw);
      } else {
        src.matrixWorld.decompose(this.tmpP, this.qClip, this.tmpS);
        // Clip world rotation, undoing the straightening the rig was bound with.
        this.qClip.multiply(this.unbind[name]);
        bw.copy(this.qProc.copy(pw).slerp(this.qClip, w));
        if (name === 'hips') bone.position.lerp(this.tmpP, w);
      }
      bone.quaternion.copy(bw);
      if (parent) bone.quaternion.premultiply(this.qProc.copy(this.world[parent]).invert());
    }
    this.rig.root.updateMatrixWorld(true);
  }
}
