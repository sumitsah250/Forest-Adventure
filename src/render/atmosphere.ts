// Late-afternoon, post-rain atmosphere: low sun from the west-southwest, broken
// cloud, aerial perspective via exponential height fog with sun in-scattering,
// and image-based ambient light generated from the same sky.

import * as THREE from 'three';

/** Direction toward the sun (fixed for the whole game; colours change with time). */
export const SUN_DIR = new THREE.Vector3(-0.86, 0.3, 0.41).normalize();
const FOG_BASE = 2.0;

let fogPatched = false;

/** GLSL for the direction toward the sun: the scene's sun (directional light 0) where a lit shader has it, else SUN_DIR. */
const sunGlsl = (fallback: string) => /* glsl */ `
  #if defined( HC_SUN_LIGHT ) && NUM_DIR_LIGHTS > 0
    inverseTransformDirection( directionalLights[ 0 ].direction, viewMatrix )
  #else
    ${fallback}
  #endif`;

/**
 * Replaces three's distance fog with analytic exponential height fog for every
 * built-in material. scene.fog must be a THREE.Fog whose `near` holds the
 * density and `far` the height falloff (per metre).
 *
 * With `movingSun` (Campus Quest, whose sun sets, gives way to the moon and rises again), lit materials take the
 * sun's glow in the fog from the scene's sun light instead of the fixed SUN_DIR. The light-scattering shader
 * chunks then define HC_SUN_LIGHT, which foliage translucency follows too. The forest keeps its fixed sun.
 */
export function installHeightFog(movingSun = false): void {
  if (fogPatched) return;
  fogPatched = true;
  const s = SUN_DIR;
  const fixed = `vec3(${s.x.toFixed(4)}, ${s.y.toFixed(4)}, ${s.z.toFixed(4)})`;
  if (movingSun) THREE.ShaderChunk.lights_pars_begin = `#define HC_SUN_LIGHT\n${THREE.ShaderChunk.lights_pars_begin}`;
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vFogWorld;
  vec3 hcApplyFog(vec3 col, vec3 worldPos, vec3 sunDir) {
    vec3 ray = worldPos - cameraPosition;
    float dist = length(ray);
    vec3 dir = ray / max(dist, 1e-4);
    float density = fogNear;
    float falloff = fogFar;
    float h0 = max(cameraPosition.y - ${FOG_BASE.toFixed(1)}, -20.0);
    float k = dir.y * falloff;
    float amount = density * exp(-falloff * h0) * dist;
    if (abs(k) > 1e-4) amount = density * exp(-falloff * h0) * (1.0 - exp(-dist * k)) / k;
    // A little distance-only haze so far ridges always recede.
    amount += dist * density * 0.12;
    float f = 1.0 - exp(-max(amount, 0.0));
    float sunAmt = pow(max(dot(dir, sunDir), 0.0), 7.0);
    vec3 fc = mix(fogColor, fogColor * vec3(1.55, 1.28, 0.92), sunAmt * 0.75);
    return mix(col, fc, f);
  }
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = hcApplyFog(gl_FragColor.rgb, vFogWorld, normalize(${sunGlsl(fixed)}
  ));
#endif`;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uHorizonAway;
uniform vec3 uSunColor;
uniform vec3 uFogColor;
uniform float uTime;
uniform float uCover;
uniform float uSunVisible;
varying vec3 vDir;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float el = d.y;
  // The horizon is its sunset colour toward the sun and uHorizonAway opposite (the same colour unless a sky sets it).
  vec2 hs = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  vec2 hd = d.xz / max(length(d.xz), 1e-4);
  vec3 horizon = mix(uHorizonAway, uHorizon, smoothstep(-0.6, 0.9, dot(hd, hs)));
  vec3 col = mix(horizon, uZenith, pow(clamp(el, 0.0, 1.0), 0.5));
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 2.0) * 0.06 + pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.5) * uSunVisible;
  if (el > -0.02) {
    vec2 uv = d.xz / (el + 0.18) * 0.55 + vec2(uTime * 0.0016, uTime * 0.0006);
    float c = fbm(uv * 1.6);
    float c2 = fbm(uv * 4.1 + 3.0);
    float cover = smoothstep(0.42 - uCover * 0.25, 0.78 - uCover * 0.2, c * 0.8 + c2 * 0.25);
    float lit = 0.62 + 0.38 * pow(sd, 3.0) + (c2 - 0.5) * 0.25;
    vec3 cloudCol = mix(horizon * 0.78, horizon * 1.12 + uSunColor * 0.16, lit);
    // Bright silver lining where thin cloud edges face the sun.
    cloudCol += uSunColor * pow(sd, 6.0) * (1.0 - smoothstep(0.3, 0.8, c)) * 0.5;
    cloudCol = mix(cloudCol, horizon * 0.62, smoothstep(0.5, 1.0, c) * 0.6);
    cover *= smoothstep(-0.02, 0.2, el);
    col = mix(col, cloudCol, cover * 0.92);
    float disk = smoothstep(0.99955, 0.99975, sd) * (1.0 - cover * 0.95);
    // A sun low in the haze is a dimmer disc (full strength from about 16 degrees up).
    col += uSunColor * disk * mix(2.2, 6.0, smoothstep(0.06, 0.28, uSunDir.y)) * uSunVisible;
  }
  // Below the horizon blend into the fog colour (hidden by terrain anyway).
  col = mix(col, uFogColor, smoothstep(0.06, -0.08, el));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface AtmosphereState {
  zenith: THREE.Color;
  horizon: THREE.Color;
  fog: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  envIntensity: number;
  fogDensity: number;
  fogFalloff: number;
  cover: number;
  exposure: number;
  /** Horizon colour on the side of the sky away from the sun (default: `horizon` all round). */
  horizonAway?: THREE.Color;
  /** Direction toward the sun, or the moon (default SUN_DIR). Only for an Atmosphere made with movingSun. */
  sunDir?: THREE.Vector3;
  /**
   * Share of the horizon colour mixed into the zenith for the sky's fill light (default 0.55): the forest's
   * vivid blue zenith would turn its shaded floor grey-blue, but a dusk campus wants the blue in its shadows.
   */
  fill?: number;
}

export const AFTERNOON: AtmosphereState = {
  zenith: new THREE.Color('#3f74b0'),
  horizon: new THREE.Color('#c4d0d4'),
  fog: new THREE.Color('#9fb0b6'),
  sunColor: new THREE.Color('#ffd29a'),
  sunIntensity: 3.6,
  envIntensity: 0.7,
  fogDensity: 0.0036,
  fogFalloff: 0.045,
  cover: 0.4,
  exposure: 1.0,
};

export const DUSK: AtmosphereState = {
  zenith: new THREE.Color('#2f3f57'),
  horizon: new THREE.Color('#c28f6c'),
  fog: new THREE.Color('#6d6e6e'),
  sunColor: new THREE.Color('#ff9d5c'),
  sunIntensity: 1.5,
  envIntensity: 0.34,
  fogDensity: 0.0058,
  fogFalloff: 0.05,
  cover: 0.62,
  exposure: 1.05,
};

export class Atmosphere {
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;
  readonly fog: THREE.Fog;
  readonly skyUniforms: Record<string, THREE.IUniform>;
  readonly state: AtmosphereState;
  private shadowRange = 70;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private tmp = new THREE.Vector3();
  private lightRot = new THREE.Matrix4();
  private lightInv = new THREE.Matrix4();
  private origin = new THREE.Vector3();
  private down = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private warmFill = new THREE.Color(1.04, 1.0, 0.92);
  private zenithKeep = new THREE.Color();
  /** Direction toward the sun this frame (the same object as state.sunDir). */
  readonly sunDir: THREE.Vector3;
  private readonly movingSun: boolean;
  private handover = 1;

  constructor(scene: THREE.Scene, opts: { movingSun?: boolean } = {}) {
    this.movingSun = !!opts.movingSun;
    installHeightFog(this.movingSun);
    this.state = cloneState(AFTERNOON);
    this.state.horizonAway = this.state.horizon.clone();
    this.sunDir = this.state.sunDir = SUN_DIR.clone();
    this.skyUniforms = {
      uSunDir: { value: this.sunDir },
      uZenith: { value: this.state.zenith },
      uHorizon: { value: this.state.horizon },
      uHorizonAway: { value: this.state.horizonAway },
      uSunColor: { value: this.state.sunColor },
      uFogColor: { value: this.state.fog },
      uTime: { value: 0 },
      uCover: { value: this.state.cover },
      uSunVisible: { value: 1 },
    };
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.skyUniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      depthFunc: THREE.LessEqualDepth,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
    this.sky.frustumCulled = false;
    // Drawn last at the far plane so only uncovered pixels run the cloud shader.
    this.sky.renderOrder = 1000;
    this.sky.name = 'sky';
    scene.add(this.sky);

    this.fog = new THREE.Fog(this.state.fog, this.state.fogDensity, this.state.fogFalloff);
    scene.fog = this.fog;
    scene.background = null;

    this.sun = new THREE.DirectionalLight(this.state.sunColor, this.state.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 2.2;
    scene.add(this.sun);
    scene.add(this.sun.target);
  }

  configureShadows(mapSize: number, range: number, enabled: boolean): void {
    this.shadowRange = range;
    this.sun.castShadow = enabled;
    const cam = this.sun.shadow.camera;
    cam.left = -range;
    cam.right = range;
    cam.top = range;
    cam.bottom = -range;
    cam.near = 1;
    cam.far = 420;
    cam.updateProjectionMatrix();
    if (this.sun.shadow.mapSize.x !== mapSize) {
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
  }

  /** Builds the image-based light from the sky plus a dark forest horizon. */
  /** Kept for the session: a new generator recompiles its blur shaders every time (a long stall). */
  private pmrem: THREE.PMREMGenerator | null = null;
  private envScene: THREE.Scene | null = null;

  buildEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    if (!this.envScene) {
      const envScene = new THREE.Scene();
      // The sky clone shares its material (and uniforms) with the real sky, so it follows every change.
      envScene.add(this.sky.clone());
      // Surrounding forest: dark band around the horizon and dim ground below.
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(500, 500, 220, 32, 1, true),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a3220'), side: THREE.BackSide, fog: false }),
      );
      ring.position.y = -60;
      envScene.add(ring);
      const ground = new THREE.Mesh(
        new THREE.CircleGeometry(520, 32),
        new THREE.MeshBasicMaterial({ color: new THREE.Color('#3d3222'), fog: false }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -40;
      envScene.add(ground);
      this.envScene = envScene;
    }
    // Ambient light comes from a softened sky: the vivid blue zenith is for the eye,
    // but as fill light it would turn shaded forest floor grey-blue.
    const zenith = this.zenithKeep.copy(this.state.zenith);
    this.state.zenith.lerp(this.state.horizon, this.state.fill ?? 0.55).multiply(this.warmFill);
    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    const old = this.envTarget;
    this.envTarget = this.pmrem.fromScene(this.envScene, 0.02);
    old?.dispose();
    this.state.zenith.copy(zenith);
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = this.state.envIntensity;
  }

  /**
   * After a lost WebGL context is restored: the image-based light was rendered on the GPU and is
   * gone (characters and buildings turned dark), and the old generator's targets are stale handles.
   */
  rebuildAfterContextLoss(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    this.pmrem = null;
    this.envTarget = null;
    this.buildEnvironment(renderer, scene);
  }

  /** Blend towards another state (t in 0..1) — used as the story moves towards dusk. */
  blend(from: AtmosphereState, to: AtmosphereState, t: number, scene: THREE.Scene): void {
    const s = this.state;
    s.zenith.copy(from.zenith).lerp(to.zenith, t);
    s.horizon.copy(from.horizon).lerp(to.horizon, t);
    s.fog.copy(from.fog).lerp(to.fog, t);
    s.sunColor.copy(from.sunColor).lerp(to.sunColor, t);
    s.sunIntensity = THREE.MathUtils.lerp(from.sunIntensity, to.sunIntensity, t);
    s.envIntensity = THREE.MathUtils.lerp(from.envIntensity, to.envIntensity, t);
    s.fogDensity = THREE.MathUtils.lerp(from.fogDensity, to.fogDensity, t);
    s.fogFalloff = THREE.MathUtils.lerp(from.fogFalloff, to.fogFalloff, t);
    s.cover = THREE.MathUtils.lerp(from.cover, to.cover, t);
    s.exposure = THREE.MathUtils.lerp(from.exposure, to.exposure, t);
    s.horizonAway?.copy(from.horizonAway ?? from.horizon).lerp(to.horizonAway ?? to.horizon, t);
    s.fill = THREE.MathUtils.lerp(from.fill ?? 0.55, to.fill ?? 0.55, t);
    if (this.movingSun) {
      const a = from.sunDir ?? SUN_DIR;
      const b = to.sunDir ?? SUN_DIR;
      if (a.dot(b) < 0.7) {
        // A big move (the sun setting and the moon taking over, ~150 degrees): sliding the light across the
        // sky in a 2.5 s change swept every shadow round the ground. Fade it out, move it while it's dark,
        // and fade it back in from its new place.
        this.sunDir.copy(t < 0.5 ? a : b);
        this.handover = Math.min(1, Math.abs(t - 0.5) * 4);
      } else {
        this.sunDir.copy(a).lerp(b, t).normalize();
        this.handover = 1;
      }
    }
    this.apply(scene);
  }

  /** 0..1: how much of the sun is up mid-handover (see blend); 1 outside one. The sky's disc should follow it. */
  get sunHandover(): number {
    return this.handover;
  }

  apply(scene: THREE.Scene): void {
    const s = this.state;
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = s.sunIntensity * this.handover;
    this.fog.color.copy(s.fog);
    this.fog.near = s.fogDensity;
    this.fog.far = s.fogFalloff;
    this.skyUniforms.uCover.value = s.cover;
    scene.environmentIntensity = s.envIntensity;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera): void {
    this.skyUniforms.uTime.value += dt;
    this.sky.position.copy(camera.position);
    // Keep the shadow frustum centred on the player, snapped to texels to avoid shimmer.
    const range = this.shadowRange;
    const texel = (range * 2) / this.sun.shadow.mapSize.x;
    const center = this.tmp.copy(focus);
    const dir = this.sunDir;
    // (Cached matrices: this ran every frame and made five new objects each time.)
    const lightRot = this.lightRot.lookAt(this.origin, this.down.copy(dir).negate(), this.up);
    const inv = this.lightInv.copy(lightRot).invert();
    center.applyMatrix4(inv);
    center.x = Math.round(center.x / texel) * texel;
    center.y = Math.round(center.y / texel) * texel;
    center.applyMatrix4(lightRot);
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(dir, 200);
    this.sun.target.updateMatrixWorld();
    // A low sun meets the ground at a grazing angle, where one shadow-map texel spans more depth: push the lookup
    // further off the surface (unchanged from about 17 degrees up, where the forest's fixed sun stands).
    if (this.movingSun) this.sun.shadow.normalBias = 0.035 * THREE.MathUtils.clamp(0.3 / Math.max(dir.y, 0.05), 1, 2.6);
  }
}

function cloneState(s: AtmosphereState): AtmosphereState {
  return {
    ...s,
    zenith: s.zenith.clone(),
    horizon: s.horizon.clone(),
    fog: s.fog.clone(),
    sunColor: s.sunColor.clone(),
    horizonAway: s.horizonAway?.clone(),
    sunDir: s.sunDir?.clone(),
  };
}
