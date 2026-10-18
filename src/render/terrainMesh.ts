// Terrain rendering: chunked meshes sharing one height-blended PBR material.
// Six photographic layers (needles, leaf litter, moss, mud, gravel, rock) are
// blended per pixel using splat data, slope, road distance and layer heights.

import * as THREE from 'three';
import { SURFACE_N, TerrainData } from '../world/terrain.ts';
import { GRAVEL_PADS, WORLD_SIZE } from '../world/layout.ts';
import { buildTerrainArrays, makeMacroNoise } from './textures.ts';

export const TERRAIN_LAYERS = [
  'forrest_ground_03', // 0 pine needle litter
  'forest_leaves_04', // 1 broadleaf litter
  'forest_leaves_02', // 2 moss
  'mud_forest', // 3 wet soil
  'rocky_trail', // 4 gravel
  'rock_face_03', // 5 rock
];

export interface TerrainRenderOptions {
  textureSize: number;
  lowQuality: boolean;
  highQuality: boolean;
}

function roadTexture(terrain: TerrainData): THREE.DataTexture {
  const n = SURFACE_N;
  const data = new Uint16Array(n * n * 4);
  const half = THREE.DataUtils.toHalfFloat;
  const kindCode = { road: 0, track: 0.5, foot: 1, creek: 1 } as const;
  const far = half(60);
  const one = half(1);
  const zero = half(0);
  for (let k = 0; k < n * n; k += 1) {
    const id = terrain.roadId[k];
    if (id === 255) {
      data[k * 4] = far;
      data[k * 4 + 1] = zero;
      data[k * 4 + 2] = one;
      data[k * 4 + 3] = zero;
      continue;
    }
    const path = terrain.roads[id];
    data[k * 4] = half(terrain.roadSigned[k]);
    data[k * 4 + 1] = half(path.halfWidth);
    data[k * 4 + 2] = half(kindCode[path.kind]);
    data[k * 4 + 3] = one;
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function splatTexture(terrain: TerrainData): THREE.DataTexture {
  const tex = new THREE.DataTexture(terrain.splat, SURFACE_N, SURFACE_N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

export function makeCanopyTexture(size: number, data: Uint8Array): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const VERT_PARS = /* glsl */ `
varying vec3 vTWorld;
varying vec3 vTNormal;
`;

const FRAG_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2DArray tAlbedo;
uniform sampler2DArray tNormal;
uniform sampler2D tSplat;
uniform sampler2D tRoad;
uniform sampler2D tMacro;
uniform sampler2D tCanopy;
uniform float uWorldSize;
uniform vec4 uPads[4];
varying vec3 vTWorld;
varying vec3 vTNormal;

const float SCALE[6] = float[6](3.2, 3.6, 3.0, 2.8, 2.6, 7.0);

struct TLayer { vec3 albedo; float height; vec3 n; float rough; };

// Beyond ~75 m fog hides fine relief: skip normal maps there.
bool hcFar = false;

TLayer tSample(vec2 xz, float layer) {
  vec3 uvw = vec3(xz / SCALE[int(layer)], layer);
  vec4 a = texture(tAlbedo, uvw);
  TLayer l;
  l.albedo = a.rgb;
  l.height = a.a;
  if (hcFar) {
    l.n = vec3(0.0, 0.0, 1.0);
    l.rough = 0.88;
  } else {
    vec4 b = texture(tNormal, uvw);
    l.n = b.xyz * 2.0 - 1.0;
    l.rough = b.a;
  }
  return l;
}

// Height-aware blend: the layer whose texture stands higher wins at transitions.
// Returns the weight given to the top layer.
float tBlend(inout TLayer base, TLayer top, float t) {
  if (t <= 0.001) return 0.0;
  float depth = 0.18;
  float a1 = base.height + (1.0 - t);
  float a2 = top.height + t;
  float ma = max(a1, a2) - depth;
  float b1 = max(a1 - ma, 0.0);
  float b2 = max(a2 - ma, 0.0);
  float w = b2 / max(b1 + b2, 1e-4);
  base.albedo = mix(base.albedo, top.albedo, w);
  base.n = mix(base.n, top.n, w);
  base.rough = mix(base.rough, top.rough, w);
  base.height = mix(base.height, top.height, w);
  return w;
}
`;

const FRAG_MAP = /* glsl */ `
vec3 nGeo = normalize(vTNormal);
hcFar = distance(vTWorld, cameraPosition) > 75.0;
vec2 wuv = vTWorld.xz / uWorldSize + 0.5;
vec4 splat = texture(tSplat, wuv);
vec4 road = texture(tRoad, wuv);
vec4 macro = texture(tMacro, vTWorld.xz / 113.0);
vec4 macro2 = texture(tMacro, vTWorld.xz / 23.0 + 0.37);
float canopy = texture(tCanopy, wuv).r;

// Base: pine needles, blended with a larger-scale sample to hide tiling.
TLayer L = tSample(vTWorld.xz, 0.0);
#ifdef TERRAIN_HIGH
  TLayer Lfar = tSample(vTWorld.xz * 0.31 + vec2(17.3, 5.1), 0.0);
  float farMix = smoothstep(0.35, 0.65, macro.g);
  L.albedo = mix(L.albedo, Lfar.albedo, farMix * 0.6);
  L.n = mix(L.n, Lfar.n, farMix * 0.5);
#endif

float leaves = splat.b;
float moss = splat.g;
float mud = splat.r;
float wet = splat.a;

// Roads and tracks evaluated per pixel from the signed distance field.
float rd = abs(road.r);
float hw = road.g;
float kind = road.b;
float edgeN = (macro2.b - 0.5) * 0.9 + (macro.r - 0.5) * 0.6;
float isRoad = road.a * (1.0 - step(0.25, kind));
float isTrack = road.a * step(0.25, kind) * (1.0 - step(0.75, kind));
float isFoot = road.a * step(0.75, kind);
float gravel = isRoad * (1.0 - smoothstep(hw - 0.5, hw + 0.35, rd + edgeN * 0.5));
float roadRut = isRoad * exp(-pow(rd - 0.86, 2.0) / 0.03) * gravel;
float trackRut = isTrack * exp(-pow(rd - 0.82, 2.0) / 0.045);
float trackCentre = isTrack * (1.0 - smoothstep(0.15, 0.5, rd));
float footPath = isFoot * (1.0 - smoothstep(hw * 0.35, hw + 0.25, rd + edgeN * 0.25));
for (int i = 0; i < 4; i++) {
  vec4 p = uPads[i];
  if (p.z <= 0.0) continue;
  float d = length(vTWorld.xz - p.xy);
  gravel = max(gravel, 1.0 - smoothstep(p.z - 1.2, p.z + 0.8, d + edgeN * 1.4));
}
mud = max(mud, max(trackRut * 0.95, footPath * 0.8));
mud = max(mud, roadRut * 0.25);
moss = max(moss * (1.0 - trackRut), trackCentre * 0.8);
leaves *= 1.0 - gravel;
moss *= 1.0 - gravel * 0.9;
// Occasional short puddles in the wheel ruts.
float puddleNoise = texture(tMacro, vTWorld.xz / 7.0 + 0.71).b;
wet = max(wet, roadRut * smoothstep(0.7, 0.8, macro2.g) * smoothstep(0.55, 0.7, puddleNoise));

float rockW = smoothstep(0.84, 0.70, nGeo.y);
rockW = max(rockW, smoothstep(0.62, 0.8, macro.r * 0.5 + macro2.r * 0.5) * smoothstep(0.93, 0.86, nGeo.y));
rockW *= 1.0 - gravel;

// Layers with no weight are skipped (weights are spatially coherent, so this branches well).
if (leaves > 0.004) tBlend(L, tSample(vTWorld.xz, 1.0), leaves);
if (moss > 0.004) tBlend(L, tSample(vTWorld.xz, 2.0), moss);
if (mud > 0.004) tBlend(L, tSample(vTWorld.xz, 3.0), mud);
if (gravel > 0.004) tBlend(L, tSample(vTWorld.xz, 4.0), gravel);

// Tangent-space normal (layers projected on XZ) to world space.
vec3 Tt = normalize(vec3(1.0, 0.0, 0.0) - nGeo * nGeo.x);
vec3 Bt = cross(nGeo, Tt);
vec3 nW = normalize(Tt * L.n.x + Bt * L.n.y + nGeo * max(L.n.z, 0.15));

#if defined(TERRAIN_HIGH)
if (rockW > 0.01 && !hcFar) {
  // Triplanar rock for steep banks and outcrops.
  vec3 tw = pow(abs(nGeo), vec3(4.0));
  tw /= dot(tw, vec3(1.0));
  float rs = SCALE[5];
  vec4 ax = texture(tAlbedo, vec3(vTWorld.zy / rs, 5.0));
  vec4 ay = texture(tAlbedo, vec3(vTWorld.xz / rs, 5.0));
  vec4 az = texture(tAlbedo, vec3(vTWorld.xy / rs, 5.0));
  vec4 bx = texture(tNormal, vec3(vTWorld.zy / rs, 5.0));
  vec4 by = texture(tNormal, vec3(vTWorld.xz / rs, 5.0));
  vec4 bz = texture(tNormal, vec3(vTWorld.xy / rs, 5.0));
  vec3 tnx = bx.xyz * 2.0 - 1.0;
  vec3 tny = by.xyz * 2.0 - 1.0;
  vec3 tnz = bz.xyz * 2.0 - 1.0;
  tnx = vec3(tnx.xy + nGeo.zy, abs(tnx.z) * nGeo.x);
  tny = vec3(tny.xy + nGeo.xz, abs(tny.z) * nGeo.y);
  tnz = vec3(tnz.xy + nGeo.xy, abs(tnz.z) * nGeo.z);
  vec3 rockN = normalize(tnx.zyx * tw.x + tny.xzy * tw.y + tnz.xyz * tw.z);
  TLayer R;
  R.albedo = ax.rgb * tw.x + ay.rgb * tw.y + az.rgb * tw.z;
  R.height = ax.a * tw.x + ay.a * tw.y + az.a * tw.z;
  R.rough = bx.a * tw.x + by.a * tw.y + bz.a * tw.z;
  R.n = L.n;
  float rw = tBlend(L, R, rockW);
  nW = normalize(mix(nW, rockN, rw));
}
#elif !defined(TERRAIN_LOW)
if (rockW > 0.01 && !hcFar) {
  // Biplanar rock: top projection blended with the dominant side projection.
  float rs = SCALE[5];
  bool xSide = abs(nGeo.x) > abs(nGeo.z);
  vec2 sideUV = xSide ? vTWorld.zy : vTWorld.xy;
  float topW = smoothstep(0.5, 0.85, nGeo.y);
  vec4 aS = texture(tAlbedo, vec3(sideUV / rs, 5.0));
  vec4 bS = texture(tNormal, vec3(sideUV / rs, 5.0));
  vec4 aT = texture(tAlbedo, vec3(vTWorld.xz / rs, 5.0));
  vec4 bT = texture(tNormal, vec3(vTWorld.xz / rs, 5.0));
  vec3 Ts = xSide ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tnS = bS.xyz * 2.0 - 1.0;
  vec3 tnT = bT.xyz * 2.0 - 1.0;
  vec3 nS = normalize(nGeo + (Ts * tnS.x - vec3(0.0, 1.0, 0.0) * tnS.y) * 0.85);
  vec3 nT = normalize(nGeo + (Tt * tnT.x + Bt * tnT.y) * 0.85);
  TLayer R;
  R.albedo = mix(aS.rgb, aT.rgb, topW);
  R.height = mix(aS.a, aT.a, topW);
  R.rough = mix(bS.a, bT.a, topW);
  R.n = L.n;
  float rw = tBlend(L, R, rockW);
  nW = normalize(mix(nW, normalize(mix(nS, nT, topW)), rw));
}
#endif
#if !defined(TERRAIN_HIGH) && !defined(TERRAIN_LOW)
else if (rockW > 0.01) {
  TLayer R = tSample(vTWorld.xz, 5.0);
  L.albedo = mix(L.albedo, R.albedo, rockW);
  L.rough = mix(L.rough, R.rough, rockW);
}
#endif
#if defined(TERRAIN_HIGH)
else if (rockW > 0.01) {
  TLayer R = tSample(vTWorld.xz, 5.0);
  L.albedo = mix(L.albedo, R.albedo, rockW);
  L.rough = mix(L.rough, R.rough, rockW);
}
#endif
#if defined(TERRAIN_LOW)
{
  TLayer R = tSample(vTWorld.xz, 5.0);
  L.albedo = mix(L.albedo, R.albedo, rockW);
  L.rough = mix(L.rough, R.rough, rockW);
}
#endif

// Large-scale tonal variation and canopy shade.
vec3 albedo = L.albedo;
albedo *= mix(0.8, 1.12, macro.r);
albedo = mix(albedo, albedo * vec3(0.9, 1.04, 0.86), smoothstep(0.4, 0.8, macro.g) * 0.5);
albedo *= mix(1.0, 0.72, canopy);
float rough = mix(L.rough, L.rough * 0.85, 0.5);

// Post-rain puddles: muddy water, glossy but not mirror-like, filling the low parts first.
float puddle = smoothstep(0.35, 0.6, wet - L.height * 0.45);
albedo = mix(albedo, albedo * vec3(0.62, 0.6, 0.55), puddle);
rough = mix(rough, 0.16, puddle);
nW = normalize(mix(nW, nGeo, puddle * 0.75));
// Damp mud is darker and slicker.
albedo *= mix(1.0, 0.82, mud * 0.6);

diffuseColor.rgb = albedo;
float tRough = clamp(rough, 0.04, 1.0);
vec3 tWorldN = nW;
float tAO = mix(1.0, 0.55, canopy) * mix(0.75, 1.0, L.height);
`;

export class TerrainRenderer {
  readonly group = new THREE.Group();
  readonly material: THREE.MeshStandardMaterial;
  readonly uniforms: Record<string, THREE.IUniform>;
  private chunks: THREE.Mesh[] = [];

  private constructor(material: THREE.MeshStandardMaterial, uniforms: Record<string, THREE.IUniform>) {
    this.material = material;
    this.uniforms = uniforms;
    this.group.name = 'terrain';
  }

  static async create(terrain: TerrainData, canopy: THREE.Texture, opts: TerrainRenderOptions): Promise<TerrainRenderer> {
    const arrays = await buildTerrainArrays(TERRAIN_LAYERS, opts.textureSize);
    const pads = GRAVEL_PADS.slice(0, 4).map((p) => new THREE.Vector4(p.x, p.z, p.r, 0));
    while (pads.length < 4) pads.push(new THREE.Vector4(0, 0, 0, 0));
    const uniforms: Record<string, THREE.IUniform> = {
      tAlbedo: { value: arrays.albedo },
      tNormal: { value: arrays.normal },
      tSplat: { value: splatTexture(terrain) },
      tRoad: { value: roadTexture(terrain) },
      tMacro: { value: makeMacroNoise() },
      tCanopy: { value: canopy },
      uWorldSize: { value: WORLD_SIZE },
      uPads: { value: pads },
    };
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      if (opts.lowQuality) shader.defines = { ...(shader.defines ?? {}), TERRAIN_LOW: '' };
      if (opts.highQuality) shader.defines = { ...(shader.defines ?? {}), TERRAIN_HIGH: '' };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>\nvTWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
        .replace('#include <map_fragment>', FRAG_MAP)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = tRough;')
        .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tWorldN, 0.0)).xyz);')
        .replace(
          '#include <aomap_fragment>',
          'reflectedLight.indirectDiffuse *= tAO;\nreflectedLight.indirectSpecular *= tAO;',
        );
    };
    material.customProgramCacheKey = () => (opts.lowQuality ? 'terrain-low' : opts.highQuality ? 'terrain-high' : 'terrain');
    const r = new TerrainRenderer(material, uniforms);
    r.buildChunks(terrain);
    return r;
  }

  private buildChunks(terrain: TerrainData): void {
    const n = terrain.n;
    const cells = n - 1;
    const per = 48;
    const chunksPerSide = Math.ceil(cells / per);
    const normals = new Float32Array(n * n * 3);
    const h = terrain.heights;
    const cell = terrain.cell;
    for (let zi = 0; zi < n; zi += 1) {
      for (let xi = 0; xi < n; xi += 1) {
        const l = h[zi * n + Math.max(0, xi - 1)];
        const r = h[zi * n + Math.min(n - 1, xi + 1)];
        const d = h[Math.max(0, zi - 1) * n + xi];
        const u = h[Math.min(n - 1, zi + 1) * n + xi];
        const nx = l - r;
        const nz = d - u;
        const ny = 2 * cell;
        const len = Math.hypot(nx, ny, nz);
        const k = (zi * n + xi) * 3;
        normals[k] = nx / len;
        normals[k + 1] = ny / len;
        normals[k + 2] = nz / len;
      }
    }
    for (let cz = 0; cz < chunksPerSide; cz += 1) {
      for (let cx = 0; cx < chunksPerSide; cx += 1) {
        const x0 = cx * per;
        const z0 = cz * per;
        const x1 = Math.min(cells, x0 + per);
        const z1 = Math.min(cells, z0 + per);
        const w = x1 - x0 + 1;
        const d = z1 - z0 + 1;
        const pos = new Float32Array(w * d * 3);
        const nor = new Float32Array(w * d * 3);
        for (let zi = 0; zi < d; zi += 1) {
          for (let xi = 0; xi < w; xi += 1) {
            const gx = x0 + xi;
            const gz = z0 + zi;
            const k = (zi * w + xi) * 3;
            const g = gz * n + gx;
            pos[k] = terrain.origin + gx * cell;
            pos[k + 1] = h[g];
            pos[k + 2] = terrain.origin + gz * cell;
            nor[k] = normals[g * 3];
            nor[k + 1] = normals[g * 3 + 1];
            nor[k + 2] = normals[g * 3 + 2];
          }
        }
        const idx: number[] = [];
        for (let zi = 0; zi < d - 1; zi += 1) {
          for (let xi = 0; xi < w - 1; xi += 1) {
            const a = zi * w + xi;
            const b = a + 1;
            const c = a + w + 1;
            const e = a + w;
            idx.push(a, c, b, a, e, c);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(idx);
        geo.computeBoundingBox();
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.matrixAutoUpdate = false;
        // Drawn after vegetation so pixels hidden behind trunks and foliage are rejected early.
        mesh.renderOrder = 1;
        mesh.name = `terrain-${cx}-${cz}`;
        this.group.add(mesh);
        this.chunks.push(mesh);
      }
    }
  }

  setCastShadow(on: boolean): void {
    for (const c of this.chunks) c.castShadow = on;
  }
}
