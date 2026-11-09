// Game orchestration: renderer, scene, fixed-step simulation and the frame loop.

import * as THREE from 'three';
import { Input } from './input.ts';
import { installGrade } from '../render/grade.ts';
import { PRESETS, loadSettings, qualityOverride, type GraphicsPreset, type Settings } from './settings.ts';
import { TerrainData } from '../world/terrain.ts';
import { SITES } from '../world/layout.ts';
import { PhysicsWorld, initRapier } from '../physics/physics.ts';
import { Atmosphere } from '../render/atmosphere.ts';
import { TerrainRenderer, makeCanopyTexture } from '../render/terrainMesh.ts';
import { loadPbr, setMaxAnisotropy } from '../render/textures.ts';
import { Player } from '../player/player.ts';
import { loadPlayerModel } from '../character/playerModel.ts';
import { buildFoliageAtlas } from '../render/foliageAtlas.ts';
import { Vegetation } from '../world/vegetation.ts';
import { windUniforms } from '../render/foliageMaterial.ts';
import { Water } from '../render/water.ts';
import { Debris } from '../world/debris.ts';

export type Progress = (fraction: number, label: string) => void;

const FIXED_DT = 1 / 60;

export interface System {
  /** Called once per fixed physics step before the world steps. */
  fixedUpdate?(dt: number): void;
  /** Called once per rendered frame. */
  update?(dt: number, alpha: number): void;
}

export class Game {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly input: Input;
  settings: Settings;
  preset: GraphicsPreset;
  terrain!: TerrainData;
  physics!: PhysicsWorld;
  atmosphere!: Atmosphere;
  terrainRenderer!: TerrainRenderer;
  vegetation!: Vegetation;
  water!: Water;
  player!: Player;
  readonly systems: System[] = [];
  /** Hooks run after each frame's physics steps (transform sync etc.). */
  readonly afterPhysics: (() => void)[] = [];
  /** Per-frame gameplay hook, run before the camera is written. */
  onUpdate: ((dt: number, alpha: number) => void) | null = null;
  /** True while the player walks; false while driving (player physics paused). */
  onFoot = true;
  running = false;
  paused = true;
  /** Seconds of game time while unpaused. */
  time = 0;
  private acc = 0;
  private last = 0;
  readonly frameTimes: number[] = [];
  /** Camera override (vehicle camera etc). When null, the player's third-person view is used. */
  cameraController: ((dt: number) => void) | null = null;
  /** World point the player's head looks at this frame (set by gameplay). */
  lookTarget: THREE.Vector3 | null = null;
  /** Smooth hand-over between cameras (on foot <-> vehicle, title -> play). */
  private lastController: ((dt: number) => void) | null | undefined = undefined;
  private blendFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private blendTo = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
  private blendT = 1;
  focus = new THREE.Vector3();
  private renderFn: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = loadSettings();
    const forced = qualityOverride();
    if (forced) this.settings.quality = forced;
    this.preset = PRESETS[this.settings.quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: new URLSearchParams(location.search).has('test'),
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    if (this.preset.grading) installGrade(this.renderer);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.08, 1400);
    this.camera.rotation.order = 'YXZ';
    this.input = new Input(canvas);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Resolution scale applied on top of the preset (dynamic resolution). */
  private resScale = 1;
  private resTimer = 0;
  private emaMs = 16;
  /** Disabled in automated tests so measurements are comparable. */
  dynamicResolution = !new URLSearchParams(location.search).has('test');

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2) * this.preset.pixelRatio * this.resScale;
    // Above 1.5 the fill cost outweighs the sharpness on high-DPI laptops.
    this.renderer.setPixelRatio(Math.min(ratio, 1.5));
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.(w, h);
  }

  onResize: ((w: number, h: number) => void) | null = null;

  async init(progress: Progress): Promise<void> {
    const playerModel = loadPlayerModel();
    progress(0.02, 'Starting physics');
    const R = await initRapier();
    progress(0.08, 'Shaping the valley');
    await nextFrame();
    this.terrain = new TerrainData();
    progress(0.3, 'Settling the ground');
    await nextFrame();
    this.physics = new PhysicsWorld(R, this.terrain);
    this.atmosphere = new Atmosphere(this.scene);
    this.atmosphere.configureShadows(this.preset.shadowMapSize, this.preset.shadowRange, this.preset.shadows);
    progress(0.36, 'Loading ground textures');
    const canopy = makeCanopyTexture(4, new Uint8Array(16));
    this.terrainRenderer = await TerrainRenderer.create(this.terrain, canopy, {
      textureSize: this.preset.textureSize,
      lowQuality: this.preset.terrainLow,
      highQuality: this.settings.quality === 'high',
    });
    this.scene.add(this.terrainRenderer.group);
    this.water = new Water(this.terrain);
    this.scene.add(this.water.mesh);
    progress(0.5, 'Growing the forest');
    await nextFrame();
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const [atlas, barkPine, barkBroad] = await Promise.all([
      buildFoliageAtlas(aniso),
      loadPbr('pine_bark'),
      loadPbr('bark_brown_02'),
    ]);
    this.vegetation = new Vegetation({
      terrain: this.terrain,
      atlas,
      barkPine,
      barkBroad,
      preset: this.preset,
      renderer: this.renderer,
      physics: this.physics,
    });
    this.scene.add(this.vegetation.group);
    this.terrainRenderer.uniforms.tCanopy.value = makeCanopyTexture(this.vegetation.canopySize, this.vegetation.canopy);
    progress(0.82, 'Scattering rocks and fallen timber');
    const debris = await Debris.create(this.terrain, this.physics, this.preset.vegetationDensity);
    this.scene.add(debris.group);
    this.atmosphere.buildEnvironment(this.renderer, this.scene);
    this.atmosphere.apply(this.scene);
    const start = SITES.playerStart;
    this.player = new Player(this.physics, this.terrain, start.x, start.z, start.heading);
    this.player.sensitivity = this.settings.mouseSensitivity;
    this.player.invertY = this.settings.invertY;
    this.player.baseFov = this.settings.fov;
    await playerModel;
    this.player.attachCharacter(this.scene);
    this.physics.step();
    progress(1, 'Ready');
  }

  setRenderer(fn: (() => void) | null): void {
    this.renderFn = fn;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  frame(now: number): void {
    const raw = (now - this.last) / 1000;
    this.last = now;
    // rAF timestamps can precede the performance.now() taken at start: never step backwards.
    const dt = THREE.MathUtils.clamp(raw, 0, 0.1);
    this.frameTimes.push(raw * 1000);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    this.adaptResolution(raw * 1000);

    if (!this.paused) {
      this.time += dt;
      const look = this.input.consumeLook();
      if (!this.cameraController) this.player.look(look.x, look.y);
      else this.lookDelta = look;
      if (this.input.pressed('jump') && this.onFoot) this.player.requestJump();
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 6) {
        this.player.update(FIXED_DT, this.input);
        for (const s of this.systems) s.fixedUpdate?.(FIXED_DT);
        this.physics.step();
        this.acc -= FIXED_DT;
        steps += 1;
      }
      if (steps === 6) this.acc = 0;
      if (steps > 0) for (const f of this.afterPhysics) f();
    } else {
      this.input.consumeLook();
    }
    const alpha = this.acc / FIXED_DT;
    for (const s of this.systems) s.update?.(this.paused ? 0 : dt, alpha);
    this.onUpdate?.(this.paused ? 0 : dt, alpha);
    this.player.animate(this.paused ? 0 : dt, alpha, this.lookTarget);
    if (this.cameraController !== this.lastController) {
      if (this.lastController !== undefined) {
        this.blendFrom.pos.copy(this.camera.position);
        this.blendFrom.quat.copy(this.camera.quaternion);
        this.blendT = 0;
      }
      this.lastController = this.cameraController;
    }
    if (this.cameraController) this.cameraController(dt);
    else this.player.applyCamera(this.camera, dt);
    if (this.blendT < 1) {
      this.blendT = Math.min(1, this.blendT + dt / 0.55);
      const t = this.blendT * this.blendT * (3 - 2 * this.blendT);
      if (this.blendFrom.pos.distanceTo(this.camera.position) < 40) {
        // Copy the targets first: slerpQuaternions/lerpVectors must not alias their output.
        this.blendTo.pos.copy(this.camera.position);
        this.blendTo.quat.copy(this.camera.quaternion);
        this.camera.position.lerpVectors(this.blendFrom.pos, this.blendTo.pos, t);
        this.camera.quaternion.slerpQuaternions(this.blendFrom.quat, this.blendTo.quat, t);
      } else this.blendT = 1;
    }
    this.focus.copy(this.camera.position);
    this.atmosphere.update(this.paused ? 0 : dt, this.focus, this.camera);
    windUniforms.uTime.value = this.time;
    windUniforms.uGust.value = 0.45 + 0.35 * Math.sin(this.time * 0.21) * Math.sin(this.time * 0.077 + 1.3);
    windUniforms.uSunTrans.value.copy(this.atmosphere.sun.color).multiplyScalar(this.atmosphere.sun.intensity * 0.4);
    windUniforms.uSkyTrans.value.copy(this.atmosphere.state.horizon).multiplyScalar(this.atmosphere.state.envIntensity);
    this.vegetation.update(dt, this.camera.position);
    this.water.update(this.paused ? 0 : dt);
    if (this.renderFn) this.renderFn();
    else this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  /**
   * Keeps the game responsive on slower laptops: lowers the render resolution in
   * steps when frames are consistently slow, raises it again when there is headroom.
   */
  private adaptResolution(ms: number): void {
    if (!this.dynamicResolution || this.paused || ms > 250) return;
    this.emaMs += (ms - this.emaMs) * 0.05;
    this.resTimer += ms / 1000;
    if (this.resTimer < 1.5) return;
    this.resTimer = 0;
    const target = this.settings.quality === 'low' ? 24 : 18; // aim for ~60 fps
    let next = this.resScale;
    if (this.emaMs > target * 1.12) next = Math.max(0.5, this.resScale - 0.1);
    else if (this.emaMs < target * 0.7) next = Math.min(1, this.resScale + 0.05);
    if (next !== this.resScale) {
      this.resScale = next;
      this.resize();
    }
  }

  get resolutionScale(): number {
    return this.resScale;
  }

  /** Renders the current scene without advancing the simulation (benchmarks). */
  renderOnce(): void {
    if (this.renderFn) this.renderFn();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Look input captured for the active camera controller this frame. */
  lookDelta = { x: 0, y: 0 };

  averageFrameMs(): number {
    if (!this.frameTimes.length) return 0;
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }
}

export function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
