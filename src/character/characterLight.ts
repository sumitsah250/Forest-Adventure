// Character lighting: what keeps people readable after dark without making them glow.
//
// The world's ambient light is the sky's image-based light, which goes nearly black at
// night, and the player's outfit (black jacket, black jeans) has an albedo around 0.03.
// So from dusk on the player was a flat black cut-out: no folds, no face, no form.
// (main.ts tried raising envMapIntensity, but with scene.environment three.js uses the
// scene's environmentIntensity and ignores the material's.)
//
// Every character material gets three terms, all off until a game sets them:
//  - fill: a soft hemispheric light (more from above than below), scaled by albedo and
//    the material's ambient occlusion, like a dim sky would give;
//  - sheen: a grazing-angle highlight (cloth fuzz, skin, hair catching the sky at the
//    silhouette), mostly albedo-independent, so dark clothes still show their outline;
//  - lift: near-black cloth materials are raised toward charcoal (a texture-level albedo
//    correction: real black cloth is about 0.04-0.06, the survivor's is 0.03).
// A few ALU ops per character pixel; no extra lights, passes or programs per character.

import * as THREE from 'three';

const U = {
  charFill: { value: new THREE.Color(0, 0, 0) },
  charRim: { value: new THREE.Color(0, 0, 0) },
  charLift: { value: 1 },
};

/** Patches a character material (idempotent). `darkCloth`: take the albedo lift too. */
export function characterLit(mat: THREE.Material, darkCloth = false): void {
  const m = mat as THREE.MeshStandardMaterial;
  if (!m.isMeshStandardMaterial || m.userData.charLit) return;
  m.userData.charLit = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 charFill;\nuniform vec3 charRim;\nuniform float charLift;')
      .replace(
        '#include <lights_fragment_end>',
        /* glsl */ `#include <lights_fragment_end>
        {
          vec3 charUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
          float charHemi = 0.5 + 0.5 * dot( normal, charUp );
          reflectedLight.indirectDiffuse += charFill * mix( 0.3, 1.0, charHemi ) * BRDF_Lambert( material.diffuseColor );
          float charF = 1.0 - saturate( dot( normal, geometryViewDir ) );
          reflectedLight.indirectSpecular += charRim * ( charF * charF * charF ) * ( 0.5 + 0.5 * charHemi );
        }`,
      );
    if (darkCloth) fs = fs.replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= charLift;');
    shader.fragmentShader = fs;
  };
  // One program per variant (the default key is the callback's source, the same for both).
  m.customProgramCacheKey = () => (darkCloth ? 'char-lit-dark' : 'char-lit');
  m.needsUpdate = true;
}

/** Sets the character light directly (linear colours; zero / 1 turns each term off). */
export function setCharacterLight(fill: THREE.Color, rim: THREE.Color, lift: number): void {
  U.charFill.value.copy(fill);
  U.charRim.value.copy(rim);
  U.charLift.value = lift;
}

const tmpFill = new THREE.Color();
const tmpRim = new THREE.Color();

/**
 * Campus Quest's character light for the current sky: `dark` 0 (day) .. 1 (night), `light` the
 * sun's or moon's colour. Fill and sheen are tinted by that light, a little by day (the sky light
 * already does most of it) and more as it gets dark; the dark cloth lift is constant.
 */
export function characterLightForSky(dark: number, light: THREE.Color): void {
  const d = THREE.MathUtils.clamp(dark, 0, 1);
  // The d² terms bring full night to 2.5x the dusk-tuned strength: standing in a building's moon shadow,
  // the near-black outfit still read as a black cut-out (player area 4/255 bright; 10 with this, no glow).
  tmpFill.copy(light).multiplyScalar(0.1 + 0.45 * d + 0.825 * d * d);
  tmpRim.copy(light).multiplyScalar(0.012 + 0.05 * d + 0.093 * d * d);
  setCharacterLight(tmpFill, tmpRim, 1.75);
}
