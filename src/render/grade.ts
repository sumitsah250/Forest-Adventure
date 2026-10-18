// Colour grade folded into the tone-mapping step of every material, so it costs a
// few ALU ops per pixel and no extra full-screen pass (the target laptops are
// fill-rate bound). Runs in linear HDR before ACES: a saturation lift, cool
// shadows / warm highlights, and a slightly greener foliage midtone.

import * as THREE from 'three';

let installed = false;

export function installGrade(renderer: THREE.WebGLRenderer): void {
  if (!installed) {
    installed = true;
    THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
      'vec3 CustomToneMapping( vec3 color ) { return color; }',
      /* glsl */ `
vec3 CustomToneMapping( vec3 color ) {
  float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
  // Saturation, strongest in the midtones so highlights don't go neon.
  float mid = 1.0 - abs( l / ( l + 0.35 ) * 2.0 - 1.0 );
  color = max( mix( vec3( l ), color, 1.08 + 0.14 * mid ), 0.0 );
  // Split tone: teal-ish shadows, golden highlights.
  float t = smoothstep( 0.02, 0.9, l );
  color *= mix( vec3( 0.97, 1.0, 1.03 ), vec3( 1.06, 1.0, 0.92 ), t );
  color = ACESFilmicToneMapping( color );
  // Gentle contrast around mid-grey (in display-referred space).
  vec3 g = pow( max( color, 0.0 ), vec3( 1.0 / 2.2 ) );
  g = mix( g, g * g * ( 3.0 - 2.0 * g ), 0.18 );
  return pow( g, vec3( 2.2 ) );
}`,
    );
  }
  renderer.toneMapping = THREE.CustomToneMapping;
}
