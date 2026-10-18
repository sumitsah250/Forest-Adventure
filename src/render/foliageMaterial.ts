// Materials for alpha-tested foliage: gentle wind motion, volumetric crown normals
// (no back-face flipping), and a soft translucency term for backlit leaves.

import * as THREE from 'three';
import { SUN_DIR } from './atmosphere.ts';

export const windUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(0.55, 0, 0.25) },
  uGust: { value: 0.5 },
  /** Sun colour × intensity, used for leaf translucency. */
  uSunTrans: { value: new THREE.Color(1, 0.85, 0.65) },
  /** Sky colour × intensity: diffuse light transmitted through needles and leaves. */
  uSkyTrans: { value: new THREE.Color(0.55, 0.62, 0.66) },
};

const WIND_VERT = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  float hcPhase = dot(instanceMatrix[3].xz, vec2(0.071, 0.113));
#else
  float hcPhase = dot(modelMatrix[3].xz, vec2(0.071, 0.113));
#endif
float hcSway = sin(uTime * 1.15 + hcPhase) * 0.65 + sin(uTime * 2.3 + hcPhase * 1.7) * 0.3;
float hcFlutter = sin(uTime * 6.5 + position.y * 2.7 + position.x * 1.3 + hcPhase * 4.0) * 0.12;
transformed.xz += uWind.xz * (hcSway * (0.6 + uGust) + hcFlutter) * aWind * HC_WIND_SCALE;
transformed.y -= abs(hcSway) * aWind * HC_WIND_SCALE * 0.04;
`;

function patchVertex(shader: { vertexShader: string; uniforms: Record<string, THREE.IUniform> }, scale: number): void {
  shader.uniforms.uTime = windUniforms.uTime;
  shader.uniforms.uWind = windUniforms.uWind;
  shader.uniforms.uGust = windUniforms.uGust;
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>\nattribute float aWind;\nuniform float uTime;\nuniform vec3 uWind;\nuniform float uGust;\n#define HC_WIND_SCALE ${scale.toFixed(3)}`,
    )
    .replace('#include <begin_vertex>', WIND_VERT);
}

export interface FoliageOptions {
  map: THREE.Texture;
  alphaTest?: number;
  windScale?: number;
  alphaToCoverage?: boolean;
  roughness?: number;
  translucency?: number;
  name: string;
}

const SUN = `vec3(${SUN_DIR.x.toFixed(4)}, ${SUN_DIR.y.toFixed(4)}, ${SUN_DIR.z.toFixed(4)})`;

export function foliageMaterial(o: FoliageOptions): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: o.map,
    vertexColors: true,
    side: THREE.DoubleSide,
    alphaTest: o.alphaTest ?? 0.42,
    alphaToCoverage: o.alphaToCoverage ?? false,
    roughness: o.roughness ?? 0.82,
    metalness: 0,
  });
  m.name = o.name;
  const wind = o.windScale ?? 0.25;
  const trans = o.translucency ?? 0.35;
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, wind);
    shader.uniforms.uSunTrans = windUniforms.uSunTrans;
    shader.uniforms.uSkyTrans = windUniforms.uSkyTrans;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunTrans;\nuniform vec3 uSkyTrans;')
      // Keep volumetric crown normals on both faces.
      .replace('normal *= faceDirection;', '')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        {
          // Thin needles and leaves glow faintly when the sun is behind them.
          vec3 Ldir = normalize((viewMatrix * vec4(${SUN}, 0.0)).xyz);
          float back = pow(max(dot(-normalize(vViewPosition), Ldir), 0.0), 4.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunTrans * back * ${trans.toFixed(2)};
          // Skylight scattered through the canopy: the shaded underside of a crown is
          // dark green, not black. Stronger on downward-facing (inner) parts.
          vec3 wN = inverseTransformDirection(normal, viewMatrix);
          float under = 0.55 + 0.45 * clamp(-wN.y * 0.5 + 0.5, 0.0, 1.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uSkyTrans * under * ${(trans * 0.55).toFixed(3)};
        }`,
      );
  };
  m.customProgramCacheKey = () => `foliage-${wind}-${trans}-${o.alphaTest ?? 0.42}`;
  return m;
}

/** Depth material for shadows that moves with the same wind. */
export function foliageDepthMaterial(map: THREE.Texture, alphaTest: number, windScale: number): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => patchVertex(shader, windScale);
  m.customProgramCacheKey = () => `foliage-depth-${windScale}-${alphaTest}`;
  return m;
}

/**
 * Bark: standard PBR with the same (smaller) wind sway so trunks and crowns move
 * together, plus weathering computed in the shader so it never repeats per tree:
 *  - moss on the root flare, buttress roots and the north (-Z) face of the lower
 *    trunk, growing in the bark's crevices first;
 *  - pale lichen blotches higher up;
 *  - darker, damp bark just above the soil.
 */
export function barkMaterial(map: THREE.Texture, normalMap: THREE.Texture, roughnessMap: THREE.Texture, windScale: number, name: string, moss = 1): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    normalScale: new THREE.Vector2(1.7, 1.7),
  });
  m.name = name;
  m.onBeforeCompile = (shader) => {
    patchVertex(shader, windScale);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vBarkY;\nvarying vec3 vBarkW;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vBarkY = position.y;
        #ifdef USE_INSTANCING
          vBarkW = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
        #else
          vBarkW = (modelMatrix * vec4(position, 1.0)).xyz;
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vBarkY;
        varying vec3 vBarkW;
        float hcHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float hcNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hcHash(i), hcHash(i + vec3(1,0,0)), f.x), mix(hcHash(i + vec3(0,1,0)), hcHash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hcHash(i + vec3(0,0,1)), hcHash(i + vec3(1,0,1)), f.x), mix(hcHash(i + vec3(0,1,1)), hcHash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 wN = inverseTransformDirection(vNormal, viewMatrix);
          float lum = dot(diffuseColor.rgb, vec3(0.333));
          float n1 = hcNoise(vBarkW * 1.7);
          float n2 = hcNoise(vBarkW * 6.0 + 3.1);
          float north = clamp(-wN.z * 0.7 + 0.3, 0.0, 1.0);
          float upward = smoothstep(0.25, 0.8, wN.y);
          float low = 1.0 - smoothstep(0.2, 2.4 + n1 * 1.2, vBarkY);
          // Crevices (dark bark) take moss first; noise breaks it into patches.
          float crevice = 1.0 - smoothstep(0.08, 0.32, lum);
          float mossAmt = clamp((low * (0.3 + 0.7 * north) + upward * 0.35 * low) * (0.4 + 0.9 * n1) + crevice * low * 0.3 - 0.3, 0.0, 0.85) * ${moss.toFixed(2)};
          vec3 mossCol = mix(vec3(0.2, 0.24, 0.09), vec3(0.34, 0.38, 0.14), n2);
          diffuseColor.rgb = mix(diffuseColor.rgb, mossCol * (0.9 + lum * 0.5), mossAmt);
          // Faint grey-green lichen, broken up by two octaves so it never forms dots.
          float ln = hcNoise(vBarkW * 1.1 + 7.0) * 0.65 + hcNoise(vBarkW * 4.7) * 0.35;
          float lichen = smoothstep(0.62, 0.8, ln) * smoothstep(1.5, 4.0, vBarkY) * (1.0 - smoothstep(9.0, 16.0, vBarkY));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.25, 1.35, 1.2) + vec3(0.03, 0.04, 0.03), lichen * 0.6 * ${moss.toFixed(2)});
          diffuseColor.rgb *= 0.78 + 0.22 * smoothstep(0.0, 0.6, vBarkY);
        }`,
      );
  };
  m.customProgramCacheKey = () => `bark-${windScale}-${moss}`;
  return m;
}
