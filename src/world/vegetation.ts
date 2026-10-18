// The forest: natural placement, distance-bucketed instancing, baked impostors for
// distant trees, ground cover near the player, trunk colliders and canopy shade.

import * as THREE from 'three';
import { Noise2D, clamp, smoothstep } from './noise.ts';
import { mulberry32, range } from './rng.ts';
import { CLEARINGS, EXCLUSIONS, GRAVEL_PADS, WORLD_HALF } from './layout.ts';
import type { TerrainData } from './terrain.ts';
import { buildTreeVariants, bush, fern, grassClump, smallSapling, type PlantModel } from './treeGen.ts';
import type { FoliageAtlas } from '../render/foliageAtlas.ts';
import { barkMaterial, foliageDepthMaterial, foliageMaterial } from '../render/foliageMaterial.ts';
import type { PbrSet } from '../render/textures.ts';
import type { GraphicsPreset } from '../core/settings.ts';
import type { PhysicsWorld } from '../physics/physics.ts';

interface Inst {
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  variant: number;
  /** Lean so trees on slopes are not perfectly vertical. */
  tilt: number;
  tiltDir: number;
  /** Height stretch relative to width, so instances of one variant differ in build. */
  stretch: number;
  /** Per-instance colour multiplier (foliage) packed as r, g, b. */
  tint: [number, number, number];
  /** Per-instance bark brightness. */
  barkTint: number;
}

const CELL = 40;

class SpatialIndex {
  private cells = new Map<number, number[]>();
  add(i: number, x: number, z: number): void {
    const k = this.key(x, z);
    let c = this.cells.get(k);
    if (!c) this.cells.set(k, (c = []));
    c.push(i);
  }
  private key(x: number, z: number): number {
    const cx = Math.floor((x + WORLD_HALF) / CELL);
    const cz = Math.floor((z + WORLD_HALF) / CELL);
    return cz * 1000 + cx;
  }
  query(x: number, z: number, r: number, out: (i: number) => void): void {
    const x0 = Math.floor((x - r + WORLD_HALF) / CELL);
    const x1 = Math.floor((x + r + WORLD_HALF) / CELL);
    const z0 = Math.floor((z - r + WORLD_HALF) / CELL);
    const z1 = Math.floor((z + r + WORLD_HALF) / CELL);
    for (let cz = z0; cz <= z1; cz += 1) {
      for (let cx = x0; cx <= x1; cx += 1) {
        const c = this.cells.get(cz * 1000 + cx);
        if (c) for (const i of c) out(i);
      }
    }
  }
}

interface Bucket {
  meshes: THREE.InstancedMesh[];
  /** Which meshes take the bark tint (the others take the foliage tint). */
  isBark: boolean[];
  capacity: number;
  count: number;
}

const IMPOSTOR_COLS = 8;
const IMPOSTOR_ROWS = 3;
const SLOT_W = 256;
const SLOT_H = 512;

export interface VegetationOptions {
  terrain: TerrainData;
  atlas: FoliageAtlas;
  barkPine: PbrSet;
  barkBroad: PbrSet;
  preset: GraphicsPreset;
  renderer: THREE.WebGLRenderer;
  physics: PhysicsWorld;
}

export class Vegetation {
  readonly group = new THREE.Group();
  readonly trees: Inst[] = [];
  readonly cover: Inst[] = [];
  private treeIndex = new SpatialIndex();
  private coverIndex = new SpatialIndex();
  private models: PlantModel[] = [];
  /** Close-up level of detail of the same variants (same order and silhouettes). */
  private heroModels: PlantModel[] = [];
  private coverModels: PlantModel[] = [];
  private treeBuckets: Bucket[] = [];
  private heroBuckets: Bucket[] = [];
  private coverBuckets: Bucket[] = [];
  private impostor!: THREE.InstancedMesh;
  private impostorSlot!: THREE.InstancedBufferAttribute;
  private impostorSize: { w: number; h: number }[] = [];
  private lastPos = new THREE.Vector3(1e9, 0, 0);
  private timer = 0;
  private opts: VegetationOptions;
  private noise = new Noise2D(4242);
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private e = new THREE.Euler();
  /** 512² canopy density over the map (0..255). */
  readonly canopy: Uint8Array;
  readonly canopySize = 512;

  constructor(opts: VegetationOptions) {
    this.opts = opts;
    this.group.name = 'vegetation';
    const detail = opts.preset.textureSize >= 1024;
    this.models = buildTreeVariants(opts.atlas, detail ? 'mid' : 'low');
    this.heroModels = buildTreeVariants(opts.atlas, 'hero');
    const r = opts.atlas.regions;
    this.coverModels = [
      fern(11, opts.atlas, 1.25),
      fern(12, opts.atlas, 0.95),
      fern(13, opts.atlas, 1.55),
      grassClump(21, opts.atlas, 0.6),
      grassClump(22, opts.atlas, 0.78),
      grassClump(23, opts.atlas, 0.5),
      bush(31, r.bush, 1.5),
      bush(32, r.leafB, 1.2),
      bush(33, r.young, 1.1),
      smallSapling(opts.atlas),
    ];
    this.placeTrees();
    this.placeCover();
    this.canopy = this.buildCanopy();
    this.buildMeshes();
    this.buildImpostors();
    this.addColliders();
  }

  // ------------------------------------------------------------ placement

  private openness(x: number, z: number, treeMargin: number): number {
    const t = this.opts.terrain;
    let f = 1;
    for (const c of CLEARINGS) {
      const d = Math.hypot(x - c.x, z - c.z);
      f = Math.min(f, smoothstep(c.radius + c.treeMargin * treeMargin, c.radius + c.treeMargin * treeMargin + 9, d));
    }
    for (const e of EXCLUSIONS) f = Math.min(f, smoothstep(e.r, e.r + 2.5, Math.hypot(x - e.x, z - e.z)));
    for (const p of GRAVEL_PADS) f = Math.min(f, smoothstep(p.r + 1, p.r + 5, Math.hypot(x - p.x, z - p.z)));
    const road = t.roadAt(x, z);
    if (road) {
      const ad = Math.abs(road.signed);
      const hw = road.path.halfWidth;
      if (road.path.kind === 'foot') f = Math.min(f, smoothstep(hw + 0.3, hw + 2.5, ad));
      else f = Math.min(f, smoothstep(hw + 1.6, hw + 6.5, ad));
    }
    return f;
  }

  private placeTrees(): void {
    const t = this.opts.terrain;
    const rng = mulberry32(777);
    const dens = this.opts.preset.vegetationDensity;
    const cell = 4.3 / Math.sqrt(dens);
    const n = Math.floor((WORLD_HALF * 2) / cell);
    const idsByKind: Record<string, number[]> = {};
    this.models.forEach((m, i) => (idsByKind[m.kind] ??= []).push(i));
    for (let zi = 0; zi < n; zi += 1) {
      for (let xi = 0; xi < n; xi += 1) {
        const x = -WORLD_HALF + (xi + 0.15 + rng() * 0.7) * cell;
        const z = -WORLD_HALF + (zi + 0.15 + rng() * 0.7) * cell;
        if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
        const open = this.openness(x, z, 1);
        if (open <= 0.01) continue;
        const water = t.waterAt(x, z);
        if (water) continue;
        const cd = Math.abs(t.creek.nearest(x, z).dist);
        const slope = t.slopeAt(x, z);
        const h = t.heightAt(x, z);
        let d = 0.6 + 0.3 * this.noise.fbm(x / 85, z / 85, 2) + 0.14 * this.noise.noise(x / 21, z / 21);
        d += 0.25 * smoothstep(235, 290, Math.max(Math.abs(x), Math.abs(z)));
        if (cd < 6) d *= smoothstep(3.2, 6, cd) * 0.7;
        if (slope > 0.4) d *= 0.45;
        d *= open;
        // Forest edges along roads and clearings get younger trees, not a wall.
        if (rng() > d) continue;
        const nearWater = 1 - smoothstep(6, 26, cd);
        const ridge = smoothstep(18, 30, h);
        const edge = 1 - open;
        let kind: string;
        const roll = rng();
        if (roll < 0.015 + 0.02 * ridge) kind = 'snag';
        else if (roll < 0.1 + 0.5 * nearWater + 0.08 * edge) kind = 'broadleaf';
        else if (roll < 0.2 + 0.5 * nearWater + 0.25 * edge + 0.1 * (1 - d)) kind = 'sapling';
        else if (roll < 0.27 + 0.4 * nearWater + 0.2 * edge + 0.16 * ridge) kind = 'pine';
        else kind = rng() < 0.5 ? 'fir' : 'spruce';
        const ids = idsByKind[kind];
        let variant = ids[Math.floor(rng() * ids.length)];
        // Broadleaf trees turn in mid-October; more of them in the open, fewer in deep shade.
        const m = this.models[variant];
        if (m.kind === 'broadleaf' && m.autumn && rng() > 0.35 + 0.4 * edge) variant = ids.find((id) => !this.models[id].autumn) ?? variant;
        const scale = kind === 'sapling' ? range(rng, 0.7, 1.3) : range(rng, 0.78, 1.18);
        const tilt = slope > 0.1 ? range(rng, 0, 0.05) : range(rng, 0, 0.025);
        // Colour: brightness and a small warm/cool shift per tree; the odd stressed,
        // yellowing conifer. Dense stands are a little darker than open edges.
        const bright = range(rng, 0.84, 1.1) * (0.94 + 0.08 * edge);
        const warm = range(rng, -0.07, 0.07);
        const stressed = (kind === 'fir' || kind === 'spruce' || kind === 'pine') && rng() < 0.04 ? range(rng, 0.08, 0.2) : 0;
        const tint: [number, number, number] = [bright * (1 + warm + stressed * 1.6), bright * (1 + stressed * 0.6), bright * (1 - warm - stressed)];
        this.trees.push({
          x, y: h - 0.15, z, rot: rng() * Math.PI * 2, scale, variant, tilt, tiltDir: rng() * Math.PI * 2,
          stretch: range(rng, 0.9, 1.12), tint, barkTint: range(rng, 0.82, 1.12),
        });
      }
    }
    this.trees.forEach((tr, i) => this.treeIndex.add(i, tr.x, tr.z));
  }

  private placeCover(): void {
    const t = this.opts.terrain;
    const rng = mulberry32(991);
    const dens = this.opts.preset.vegetationDensity;
    const cell = 2.1 / Math.sqrt(dens);
    const n = Math.floor((WORLD_HALF * 2) / cell);
    for (let zi = 0; zi < n; zi += 1) {
      for (let xi = 0; xi < n; xi += 1) {
        const x = -WORLD_HALF + (xi + rng()) * cell;
        const z = -WORLD_HALF + (zi + rng()) * cell;
        if (Math.abs(x) > WORLD_HALF - 2 || Math.abs(z) > WORLD_HALF - 2) continue;
        if (t.waterAt(x, z)) continue;
        const road = t.roadAt(x, z);
        let roadEdge = 0;
        if (road) {
          const ad = Math.abs(road.signed);
          const hw = road.path.halfWidth;
          if (road.path.kind === 'track') {
            // Grass grows in the centre strip of the two-track.
            if (ad < 0.35 && rng() < 0.5) {
              this.pushCover(x, z, 3 + Math.floor(rng() * 3), rng, 0.55);
              continue;
            }
            if (ad < hw + 0.4) continue;
          } else if (ad < hw + 0.6) continue;
          roadEdge = 1 - smoothstep(hw + 0.6, hw + 4, ad);
        }
        let excluded = false;
        for (const e of EXCLUSIONS) if (Math.hypot(x - e.x, z - e.z) < e.r * 0.8) excluded = true;
        for (const p of GRAVEL_PADS) if (Math.hypot(x - p.x, z - p.z) < p.r) excluded = true;
        if (excluded) continue;
        let clearing = 0;
        for (const c of CLEARINGS) clearing = Math.max(clearing, 1 - smoothstep(c.radius - 2, c.radius + 6, Math.hypot(x - c.x, z - c.z)));
        const slope = t.slopeAt(x, z);
        if (slope > 0.5) continue;
        const cd = t.creek.nearest(x, z).dist;
        const bank = 1 - smoothstep(3, 9, cd);
        const shade = this.noise.fbm(x / 30 + 7, z / 30, 2);
        // Ferns in shaded damp forest, grass in light (clearings, road edges, banks), bushes scattered.
        const fernP = clamp(0.2 + shade * 0.35, 0, 0.6) * (1 - clearing) * (1 - roadEdge * 0.6) + bank * 0.25;
        const grassP = clamp(0.06 + clearing * 0.75 + roadEdge * 0.55 + bank * 0.35, 0, 0.95);
        const bushP = 0.05 + 0.08 * (1 - clearing) * smoothstep(0, 0.6, -shade);
        const roll = rng();
        if (roll < grassP * 0.55) this.pushCover(x, z, 3 + Math.floor(rng() * 3), rng, 1);
        else if (roll < grassP * 0.55 + fernP * 0.95) this.pushCover(x, z, Math.floor(rng() * 3), rng, 1);
        else if (roll < grassP * 0.55 + fernP * 0.95 + bushP * 0.9) this.pushCover(x, z, 6 + Math.floor(rng() * 3), rng, 1);
        else if (roll < grassP * 0.55 + fernP * 0.95 + bushP * 0.9 + 0.025 * (1 - clearing) * (0.5 + roadEdge)) this.pushCover(x, z, 9, rng, 1);
      }
    }
    this.cover.forEach((c, i) => this.coverIndex.add(i, c.x, c.z));
  }

  private pushCover(x: number, z: number, variant: number, rng: () => number, scaleMul: number): void {
    const t = this.opts.terrain;
    const b = range(rng, 0.85, 1.12);
    this.cover.push({ x, y: t.heightAt(x, z), z, rot: rng() * Math.PI * 2, scale: range(rng, 0.75, 1.25) * scaleMul, variant, tilt: 0, tiltDir: 0, stretch: 1, tint: [b, b, b], barkTint: 1 });
  }

  private buildCanopy(): Uint8Array {
    const S = this.canopySize;
    const acc = new Float32Array(S * S);
    const cellM = (WORLD_HALF * 2) / S;
    for (const tr of this.trees) {
      const m = this.models[tr.variant];
      if (m.kind === 'snag') continue;
      const r = m.crownRadius * tr.scale * 1.15;
      const strength = m.kind === 'sapling' ? 0.15 : m.kind === 'pine' ? 0.32 : 0.42;
      const cx = (tr.x + WORLD_HALF) / cellM;
      const cz = (tr.z + WORLD_HALF) / cellM;
      const rr = r / cellM;
      const x0 = Math.max(0, Math.floor(cx - rr));
      const x1 = Math.min(S - 1, Math.ceil(cx + rr));
      const z0 = Math.max(0, Math.floor(cz - rr));
      const z1 = Math.min(S - 1, Math.ceil(cz + rr));
      for (let z = z0; z <= z1; z += 1) {
        for (let x = x0; x <= x1; x += 1) {
          const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / rr;
          if (d < 1) acc[z * S + x] += strength * (1 - d * d);
        }
      }
    }
    const out = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i += 1) out[i] = Math.min(255, Math.round((1 - Math.exp(-acc[i] * 1.4)) * 255));
    return out;
  }

  // ------------------------------------------------------------ rendering

  private buildMeshes(): void {
    const { atlas, barkPine, barkBroad, preset } = this.opts;
    const a2c = preset.antialias;
    const conFoliage = foliageMaterial({ map: atlas.texture, name: 'conifer-foliage', windScale: 0.22, alphaToCoverage: a2c, translucency: 0.3 });
    const leafFoliage = foliageMaterial({ map: atlas.texture, name: 'leaf-foliage', windScale: 0.3, alphaToCoverage: a2c, translucency: 0.5, roughness: 0.7 });
    const coverMat = foliageMaterial({ map: atlas.texture, name: 'cover', windScale: 0.35, alphaToCoverage: a2c, alphaTest: 0.38, translucency: 0.4 });
    const pineBark = barkMaterial(barkPine.map, barkPine.normalMap, barkPine.roughnessMap, 0.22, 'bark-pine');
    const broadBark = barkMaterial(barkBroad.map, barkBroad.normalMap, barkBroad.roughnessMap, 0.3, 'bark-broad', 0.8);
    const counts = new Array(this.models.length).fill(0);
    for (const t of this.trees) counts[t.variant] += 1;
    const make = (models: PlantModel[], capOf: (i: number) => number): Bucket[] => models.map((m, i) => {
      const cap = capOf(i);
      const meshes: THREE.InstancedMesh[] = [];
      const isBark: boolean[] = [];
      if (m.bark) {
        const mat = m.kind === 'broadleaf' ? broadBark : pineBark;
        meshes.push(this.instanced(m.bark.build(), mat, cap, true, null));
        isBark.push(true);
      }
      if (m.foliage) {
        const mat = m.kind === 'broadleaf' ? leafFoliage : conFoliage;
        const geo = m.foliage.build();
        if (m.kind === 'snag') {
          meshes.push(this.instanced(geo, mat, cap, true, null));
          isBark.push(false);
        } else {
          const pair = this.prepassFoliage(geo, mat, cap);
          meshes.push(...pair);
          isBark.push(false, false);
        }
      }
      return { meshes, isBark, capacity: cap, count: 0 };
    });
    this.treeBuckets = make(this.models, (i) => Math.max(1, Math.min(counts[i], 2600)));
    // Hero trees are only those within a few tens of metres.
    this.heroBuckets = make(this.heroModels, (i) => Math.max(1, Math.min(counts[i], 260)));
    void foliageDepthMaterial;
    const ccounts = new Array(this.coverModels.length).fill(0);
    for (const c of this.cover) ccounts[c.variant] += 1;
    this.coverModels.forEach((m, i) => {
      const cap = Math.max(1, Math.min(ccounts[i], 9000));
      const meshes: THREE.InstancedMesh[] = [];
      const isBark: boolean[] = [];
      if (m.bark) {
        meshes.push(this.instanced(m.bark.build(), pineBark, cap, false, null));
        isBark.push(true);
      }
      const mesh = this.instanced(m.foliage!.build(), coverMat, cap, false, null);
      mesh.receiveShadow = true;
      meshes.push(mesh);
      isBark.push(false);
      this.coverBuckets.push({ meshes, isBark, capacity: cap, count: 0 });
    });
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadows: boolean, depth: THREE.Material | null): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Per-instance colour (brightness/hue variation between trees of one variant).
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.castShadow = shadows && this.opts.preset.shadows;
    mesh.receiveShadow = true;
    if (depth) mesh.customDepthMaterial = depth;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Foliage with a depth pre-pass: the first draw writes alpha-tested depth only, the
   * second shades with an equal depth test, so each pixel of a dense crown is lit once.
   * Both materials share one shader program, so their depths match exactly.
   */
  private prepassFoliage(geo: THREE.BufferGeometry, colorMat: THREE.MeshStandardMaterial, cap: number): THREE.InstancedMesh[] {
    const pre = colorMat.clone();
    pre.onBeforeCompile = colorMat.onBeforeCompile;
    pre.customProgramCacheKey = colorMat.customProgramCacheKey;
    pre.colorWrite = false;
    pre.name = `${colorMat.name}-prepass`;
    const shade = colorMat.clone();
    shade.onBeforeCompile = colorMat.onBeforeCompile;
    shade.customProgramCacheKey = colorMat.customProgramCacheKey;
    shade.depthFunc = THREE.EqualDepth;
    shade.depthWrite = false;
    shade.name = colorMat.name;
    const a = this.instanced(geo, pre, cap, false, null);
    a.renderOrder = -2;
    const b = this.instanced(geo, shade, cap, false, null);
    b.instanceMatrix = a.instanceMatrix;
    // Same attribute set on both passes keeps their programs (and depths) identical.
    b.instanceColor = a.instanceColor;
    b.renderOrder = -1;
    return [a, b];
  }

  /** Renders every tree variant once into an atlas used by distant billboards. */
  private buildImpostors(): void {
    const { renderer, atlas, barkPine, barkBroad } = this.opts;
    const W = SLOT_W * IMPOSTOR_COLS;
    const H = SLOT_H * IMPOSTOR_ROWS;
    const rt = new THREE.WebGLRenderTarget(W, H, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      colorSpace: THREE.SRGBColorSpace,
    });
    const bakeScene = new THREE.Scene();
    const leafBake = new THREE.MeshBasicMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.4, side: THREE.DoubleSide });
    const barkBakeP = new THREE.MeshBasicMaterial({ map: barkPine.map, vertexColors: true });
    const barkBakeB = new THREE.MeshBasicMaterial({ map: barkBroad.map, vertexColors: true });
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(rt);
    renderer.setClearColor(new THREE.Color(0.1, 0.12, 0.08), 0);
    renderer.clear(true, true, true);
    this.models.forEach((m, i) => {
      const col = i % IMPOSTOR_COLS;
      const row = Math.floor(i / IMPOSTOR_COLS);
      if (row >= IMPOSTOR_ROWS) return;
      const group = new THREE.Group();
      if (m.bark) group.add(new THREE.Mesh(m.bark.build(), m.kind === 'broadleaf' ? barkBakeB : barkBakeP));
      if (m.foliage) group.add(new THREE.Mesh(m.foliage.build(), leafBake));
      const box = new THREE.Box3().setFromObject(group);
      const halfW = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z)) * 1.04;
      const top = box.max.y * 1.02;
      // Slot aspect is 1:2; fit the tree inside it.
      const w = Math.max(halfW, top / 4);
      const h = w * 4;
      cam.left = -w;
      cam.right = w;
      cam.top = h;
      cam.bottom = 0;
      cam.position.set(0, 0, 100);
      cam.lookAt(0, 0, 0);
      cam.updateProjectionMatrix();
      this.impostorSize.push({ w: w * 2, h });
      rt.viewport.set(col * SLOT_W, row * SLOT_H, SLOT_W, SLOT_H);
      rt.scissor.set(col * SLOT_W, row * SLOT_H, SLOT_W, SLOT_H);
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      bakeScene.add(group);
      renderer.render(bakeScene, cam);
      bakeScene.remove(group);
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    });
    rt.scissorTest = false;
    this.impostorRT = rt;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);

    // Two crossed quads, unit size, base at y = 0.
    const g = new THREE.BufferGeometry();
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let k = 0; k < 2; k += 1) {
      const ax = k === 0 ? [1, 0] : [0, 1];
      const base = pos.length / 3;
      const corners = [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]];
      for (const [cx, cy] of corners) {
        pos.push(ax[0] * cx, cy, ax[1] * cx);
        const n = new THREE.Vector3(ax[0] * cx * 1.6, 0.55 + cy * 0.4, ax[1] * cx * 1.6).normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(cx + 0.5, cy);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const cap = this.trees.length;
    this.impostorSlot = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.impostorSlot.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSlot', this.impostorSlot);
    const mat = new THREE.MeshStandardMaterial({ map: rt.texture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSlot;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\n vMapUv = (vec2(mod(aSlot, ${IMPOSTOR_COLS}.0), floor(aSlot / ${IMPOSTOR_COLS}.0)) + vec2(uv.x * 0.985 + 0.0075, uv.y * 0.99 + 0.002)) * vec2(${(1 / IMPOSTOR_COLS).toFixed(6)}, ${(1 / IMPOSTOR_ROWS).toFixed(6)});`,
        );
      shader.fragmentShader = shader.fragmentShader.replace('normal *= faceDirection;', '');
    };
    mat.customProgramCacheKey = () => 'impostor';
    // Depth pre-pass + equal-depth shading, as for near foliage: distant stands overlap a lot.
    const pre = mat.clone();
    pre.onBeforeCompile = mat.onBeforeCompile;
    pre.customProgramCacheKey = mat.customProgramCacheKey;
    pre.colorWrite = false;
    const shade = mat.clone();
    shade.onBeforeCompile = mat.onBeforeCompile;
    shade.customProgramCacheKey = mat.customProgramCacheKey;
    shade.depthFunc = THREE.EqualDepth;
    shade.depthWrite = false;
    this.impostorPre = new THREE.InstancedMesh(g, pre, cap);
    this.impostorPre.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.impostorPre.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    this.impostorPre.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.impostorPre.count = 0;
    this.impostorPre.frustumCulled = false;
    this.impostorPre.renderOrder = -2;
    this.group.add(this.impostorPre);
    this.impostor = new THREE.InstancedMesh(g, shade, cap);
    this.impostor.instanceMatrix = this.impostorPre.instanceMatrix;
    this.impostor.instanceColor = this.impostorPre.instanceColor;
    this.impostor.count = 0;
    this.impostor.frustumCulled = false;
    this.impostor.receiveShadow = false;
    this.impostor.renderOrder = -1;
    this.group.add(this.impostor);

    // Shadow proxies: crossed impostor quads for near trees, drawn only into the
    // shadow map. Far cheaper than rendering every needle card twice, and the baked
    // silhouette still produces dappled light.
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', g.getAttribute('position'));
    pg.setAttribute('normal', g.getAttribute('normal'));
    pg.setAttribute('uv', g.getAttribute('uv'));
    pg.setIndex(g.getIndex());
    const proxyCap = 4000;
    this.proxySlot = new THREE.InstancedBufferAttribute(new Float32Array(proxyCap), 1);
    this.proxySlot.setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('aSlot', this.proxySlot);
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: rt.texture, alphaTest: 0.45, side: THREE.DoubleSide });
    depthMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSlot;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>\n vMapUv = (vec2(mod(aSlot, ${IMPOSTOR_COLS}.0), floor(aSlot / ${IMPOSTOR_COLS}.0)) + vec2(uv.x * 0.985 + 0.0075, uv.y * 0.99 + 0.002)) * vec2(${(1 / IMPOSTOR_COLS).toFixed(6)}, ${(1 / IMPOSTOR_ROWS).toFixed(6)});`,
        );
    };
    depthMat.customProgramCacheKey = () => 'impostor-depth';
    this.proxy = new THREE.InstancedMesh(pg, mat, proxyCap);
    this.proxy.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.proxy.count = 0;
    this.proxy.frustumCulled = false;
    this.proxy.castShadow = this.opts.preset.shadows;
    this.proxy.receiveShadow = false;
    this.proxy.customDepthMaterial = depthMat;
    this.proxy.onBeforeRender = () => pg.setDrawRange(0, 0);
    this.proxy.onBeforeShadow = () => pg.setDrawRange(0, Infinity);
    this.proxy.name = 'tree-shadow-proxy';
    this.group.add(this.proxy);
  }

  private proxy!: THREE.InstancedMesh;
  private impostorPre!: THREE.InstancedMesh;
  private proxySlot!: THREE.InstancedBufferAttribute;

  private addColliders(): void {
    const { physics } = this.opts;
    for (const t of this.trees) {
      const m = this.models[t.variant];
      const r = m.trunkRadius * t.scale;
      if (r < 0.07) continue;
      physics.tag(physics.addCylinder(t.x, t.y, t.z, 2.2, r), 'wood');
    }
  }

  private compose(inst: Inst, out: Float32Array, offset: number, extraScale = 1, impostor?: { w: number; h: number }): void {
    this.e.set(Math.cos(inst.tiltDir) * inst.tilt, inst.rot, Math.sin(inst.tiltDir) * inst.tilt, 'YXZ');
    this.q.setFromEuler(this.e);
    const s = inst.scale * extraScale;
    const sy = s * inst.stretch;
    if (impostor) this.s.set(impostor.w * s, impostor.h * sy, impostor.w * s);
    else this.s.set(s, sy, s);
    this.p.set(inst.x, inst.y, inst.z);
    this.m.compose(this.p, this.q, this.s);
    this.m.toArray(out, offset);
  }

  /** Writes one instance (matrix + colours) into every mesh of a bucket. */
  private put(b: Bucket, inst: Inst, extraScale = 1): void {
    const k = b.count;
    for (let j = 0; j < b.meshes.length; j += 1) {
      const mesh = b.meshes[j];
      this.compose(inst, mesh.instanceMatrix.array as Float32Array, k * 16, extraScale);
      const c = mesh.instanceColor!.array as Float32Array;
      if (b.isBark[j]) {
        c[k * 3] = inst.barkTint;
        c[k * 3 + 1] = inst.barkTint;
        c[k * 3 + 2] = inst.barkTint;
      } else {
        c[k * 3] = inst.tint[0];
        c[k * 3 + 1] = inst.tint[1];
        c[k * 3 + 2] = inst.tint[2];
      }
    }
    b.count += 1;
  }

  private flush(buckets: Bucket[]): void {
    for (const b of buckets) {
      for (const mesh of b.meshes) {
        mesh.count = b.count;
        // Skip empty buckets entirely (no draw call, no state changes).
        mesh.visible = b.count > 0;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Rebuild instance buckets around the viewer. Cheap enough to run several times a second. */
  update(dt: number, viewer: THREE.Vector3, force = false): void {
    this.timer -= dt;
    const moved = viewer.distanceToSquared(this.lastPos);
    if (!force && this.timer > 0 && moved < 9) return;
    this.timer = 0.3;
    this.lastPos.copy(viewer);
    const preset = this.opts.preset;
    const near = preset.treeNear;
    const far = preset.treeFar;
    const near2 = near * near;
    const far2 = far * far;
    const hero2 = preset.treeHero * preset.treeHero;
    for (const b of this.treeBuckets) b.count = 0;
    for (const b of this.heroBuckets) b.count = 0;
    let imp = 0;
    let prox = 0;
    const impArr = this.impostor.instanceMatrix.array as Float32Array;
    const impCol = this.impostor.instanceColor!.array as Float32Array;
    const slotArr = this.impostorSlot.array as Float32Array;
    const proxArr = this.proxy.instanceMatrix.array as Float32Array;
    const proxSlot = this.proxySlot.array as Float32Array;
    const shadowR2 = (preset.shadowRange * 1.25) ** 2;
    this.treeIndex.query(viewer.x, viewer.z, far, (i) => {
      const t = this.trees[i];
      const dx = t.x - viewer.x;
      const dz = t.z - viewer.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) return;
      const m = this.models[t.variant];
      if (d2 < near2) {
        let b = d2 < hero2 ? this.heroBuckets[t.variant] : this.treeBuckets[t.variant];
        if (b.count >= b.capacity) b = this.treeBuckets[t.variant];
        if (b.count >= b.capacity) return;
        this.put(b, t);
        if (d2 < shadowR2 && m.foliage && m.kind !== 'snag' && prox < 4000) {
          this.compose(t, proxArr, prox * 16, 1, this.impostorSize[t.variant]);
          proxSlot[prox] = t.variant;
          prox += 1;
        }
      } else {
        if (m.kind === 'sapling' && (m.height < 5 || d2 > 120 * 120)) return;
        this.compose(t, impArr, imp * 16, 1, this.impostorSize[t.variant]);
        impCol[imp * 3] = t.tint[0];
        impCol[imp * 3 + 1] = t.tint[1];
        impCol[imp * 3 + 2] = t.tint[2];
        slotArr[imp] = t.variant;
        imp += 1;
      }
    });
    this.flush(this.treeBuckets);
    this.flush(this.heroBuckets);
    this.impostor.count = imp;
    this.impostorPre.count = imp;
    this.impostor.instanceMatrix.needsUpdate = true;
    this.impostor.instanceColor!.needsUpdate = true;
    this.impostorSlot.needsUpdate = true;
    this.proxy.count = prox;
    this.proxy.instanceMatrix.needsUpdate = true;
    this.proxySlot.needsUpdate = true;

    const cr = preset.groundCoverRange;
    const cr2 = cr * cr;
    for (const b of this.coverBuckets) b.count = 0;
    this.coverIndex.query(viewer.x, viewer.z, cr, (i) => {
      const c = this.cover[i];
      const dx = c.x - viewer.x;
      const dz = c.z - viewer.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > cr2) return;
      const b = this.coverBuckets[c.variant];
      if (b.count >= b.capacity) return;
      // Shrink plants near the edge of the range so they do not pop.
      const fade = 1 - smoothstep(cr * 0.75, cr, Math.sqrt(d2));
      this.put(b, c, Math.max(0.01, fade));
    });
    this.flush(this.coverBuckets);
  }

  /** Trees whose trunks could block a vehicle or the player (for nav hints). */
  treesNear(x: number, z: number, r: number): { x: number; z: number; radius: number }[] {
    const out: { x: number; z: number; radius: number }[] = [];
    this.treeIndex.query(x, z, r, (i) => {
      const t = this.trees[i];
      if (Math.hypot(t.x - x, t.z - z) < r) out.push({ x: t.x, z: t.z, radius: this.models[t.variant].trunkRadius * t.scale });
    });
    return out;
  }

  private impostorRT: THREE.WebGLRenderTarget | null = null;

  /** Debug: the baked impostor atlas as a data URL (alpha shown over grey). */
  impostorDataUrl(): string {
    const rt = this.impostorRT!;
    const { width: w, height: h } = rt;
    const px = new Uint8Array(w * h * 4);
    this.opts.renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = ((h - 1 - y) * w + x) * 4;
        const o = (y * w + x) * 4;
        const a = px[i + 3] / 255;
        img.data[o] = px[i] * a + 128 * (1 - a);
        img.data[o + 1] = px[i + 1] * a + 128 * (1 - a);
        img.data[o + 2] = px[i + 2] * a + 128 * (1 - a);
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }

  /** Debug: the foliage atlas as a data URL. */
  atlasDataUrl(): string {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 1024;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, 1024, 1024);
    ctx.drawImage(this.opts.atlas.canvas, 0, 0, 1024, 1024);
    return c.toDataURL('image/png');
  }

  stats(): { trees: number; cover: number; nearTrees: number; impostors: number } {
    return {
      trees: this.trees.length,
      cover: this.cover.length,
      nearTrees: this.treeBuckets.reduce((s, b) => s + b.count, 0),
      impostors: this.impostor.count,
    };
  }
}
