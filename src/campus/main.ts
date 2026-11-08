// Campus Quest entry point: renderer, physics, the campus world, the player, people,
// quest and interface, and the frame loop.

import '../style.css';
import './campus.css';
import * as THREE from 'three';
import { Input } from '../core/input.ts';
import { PRESETS, loadSettings, qualityOverride } from '../core/settings.ts';
import { installGrade } from '../render/grade.ts';
import { PhysicsWorld, initRapier } from '../physics/physics.ts';
import { Atmosphere } from '../render/atmosphere.ts';
import { loadPbr, setMaxAnisotropy } from '../render/textures.ts';
import { buildFoliageAtlas } from '../render/foliageAtlas.ts';
import { windUniforms } from '../render/foliageMaterial.ts';
import { Player } from '../player/player.ts';
import { AudioEngine } from '../audio/audio.ts';
import { TouchControls } from '../ui/touch.ts';
import type { TerrainData } from '../world/terrain.ts';
import { DATA, GATE, WORLD_HALF, centroid } from './geo.ts';
import { CampusGround } from './ground.ts';
import { buildCampus } from './world.ts';
import { populate, type Person } from './people.ts';
import { PLAYER_SUIT } from '../character/humanoid.ts';
import { CampusUI } from './ui.ts';
import { Quest, clearSave, loadSave } from './quest.ts';

const FIXED_DT = 1 / 60;
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = `
  <div class="studio-tag">Sumix Developers presents</div>
  <div class="loading__title">CAMPUS QUEST</div>
  <div class="loading__bar"><span></span></div>
  <div class="loading__label">Preparing</div>`;
uiRoot.appendChild(loading);
const bar = loading.querySelector('.loading__bar span') as HTMLSpanElement;
const label = loading.querySelector('.loading__label') as HTMLDivElement;
const progress = (f: number, text: string) => {
  bar.style.width = `${Math.round(f * 100)}%`;
  label.textContent = text;
};
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function boot(): Promise<void> {
  const settings = loadSettings();
  const forced = qualityOverride();
  if (forced) settings.quality = forced;
  const preset = PRESETS[settings.quality];

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: preset.antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('test') });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (preset.grading) installGrade(renderer);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 1600);
  camera.rotation.order = 'YXZ';
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(Math.min(window.devicePixelRatio || 1, 2) * preset.pixelRatio, 1.5));
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  const input = new Input(canvas);

  progress(0.02, 'Starting physics');
  const R = await initRapier();
  progress(0.04, 'Reading the slope of Lamachaur');
  await frame();
  const ground = new CampusGround();
  const physics = new PhysicsWorld(R, ground as unknown as TerrainData);

  // A clear Pokhara afternoon: less haze than the forest valley, so the Himalaya shows.
  const atmosphere = new Atmosphere(scene);
  const s = atmosphere.state;
  s.zenith.set('#3c78c2');
  s.horizon.set('#c9d6de');
  s.fog.set('#b4c3cc');
  s.fogDensity = 0.0011;
  s.fogFalloff = 0.02;
  s.cover = 0.28;
  s.sunIntensity = 3.8;
  s.envIntensity = 0.8;
  atmosphere.apply(scene);
  atmosphere.configureShadows(preset.shadowMapSize, preset.shadowRange, preset.shadows);

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  progress(0.06, 'Loading leaves and bark');
  const [atlas, barkPine, barkBroad] = await Promise.all([buildFoliageAtlas(aniso), loadPbr('pine_bark'), loadPbr('bark_brown_02')]);
  const world = await buildCampus({
    ground, physics, preset, atlas, barkBroad, barkPine,
    progress: (f, t) => progress(0.08 + f * 0.8, t),
  });
  scene.add(world.group);
  scene.add(world.backdrop);
  atmosphere.buildEnvironment(renderer, scene);
  atmosphere.apply(scene);

  // The player starts outside the main gate on Lamachaur Marg, facing into campus.
  const [ccx, ccz] = centroid(DATA.boundary);
  const ox = GATE[0] - ccx;
  const oz = GATE[1] - ccz;
  const ol = Math.hypot(ox, oz);
  const startX = GATE[0] + (ox / ol) * 9;
  const startZ = GATE[1] + (oz / ol) * 9;
  const startYaw = Math.atan2(ox / ol, oz / ol);
  const player = new Player(physics, ground as unknown as TerrainData, startX, startZ, startYaw);
  player.bounds = WORLD_HALF - 12;
  player.sensitivity = settings.mouseSensitivity;
  player.invertY = settings.invertY;
  player.baseFov = settings.fov;
  // The player is modelled on the developer's reference photos (navy suit, textured hair, beard).
  player.attachCharacter(scene, PLAYER_SUIT);
  physics.step();

  progress(0.92, 'Students arriving for class');
  await frame();
  const people: Person[] = populate(scene, ground, physics, preset.vegetationDensity);
  const audio = new AudioEngine();
  audio.setVolume(settings.masterVolume);
  player.onStep = (e) => audio.footstep(e.surface, e.intensity, player.renderPos);
  player.onLand = (e) => audio.footstep(e.surface, e.intensity, player.renderPos);
  const ui = new CampusUI(uiRoot, world.mapCanvas);
  ui.onSound = (n) => audio.play(n);

  type State = 'title' | 'play' | 'pause' | 'map' | 'ending';
  let state: State = 'title';
  /** A game has been started this session (the title screen must not save an empty game). */
  let started = false;
  const quest = new Quest({
    scene, world, ground, physics, ui,
    sound: (n) => audio.play(n),
    onFinished: (stats) => {
      state = 'ending';
      input.exitPointerLock();
      ui.showHud(false);
      ui.ending(stats, () => void newGame(), () => toTitle());
    },
  });
  people.push(...quest.people);

  const touch = input.isTouch ? new TouchControls(uiRoot, input, (which) => (which === 'map' ? openMap() : openPause())) : null;
  touch?.setVisible(false);

  const lockOrPrompt = () => {
    if (input.isTouch) return;
    input.requestPointerLock();
    // If the browser refuses the lock (no recent gesture), ask for a click.
    window.setTimeout(() => {
      if (state === 'play' && !ui.modal && !input.pointerLocked) ui.clickToPlay(() => {
        ui.close();
        input.requestPointerLock();
      });
    }, 400);
  };

  const play = () => {
    state = 'play';
    started = true;
    ui.close();
    ui.showHud(true);
    touch?.setVisible(true);
    audio.suspend(false);
    lockOrPrompt();
  };

  const newGame = async () => {
    clearSave();
    await quest.begin(null);
    player.teleport(startX, ground.heightAt(startX, startZ), startZ, startYaw);
    void audio.start();
    touch?.enterImmersive();
    play();
    ui.toast('Welcome to IOE Pashchimanchal Campus', 'good');
  };
  const continueGame = async () => {
    const save = loadSave();
    await quest.begin(save);
    // Resume next to the current objective.
    const t = quest.targets().main;
    if (t) {
      const x = t.x + 6;
      const z = t.z + 6;
      player.teleport(x, ground.heightAt(x, z), z, Math.atan2(x - t.x, z - t.z));
    }
    void audio.start();
    touch?.enterImmersive();
    play();
  };
  const toTitle = () => {
    if (started) quest.save();
    state = 'title';
    ui.showHud(false);
    touch?.setVisible(false);
    input.exitPointerLock();
    const save = loadSave();
    ui.title({ canContinue: !!save, level: (save?.level ?? 0) + 1, onStart: () => void newGame(), onContinue: () => void continueGame() });
  };
  const openPause = () => {
    if (state !== 'play' || ui.modal) return;
    state = 'pause';
    touch?.setVisible(false);
    audio.suspend(true);
    ui.pause({
      onResume: play,
      onMap: () => openMap(),
      onRestartLevel: () => {
        void quest.restartLevel().then(play);
      },
      onTitle: toTitle,
    });
  };
  const openMap = () => {
    if (state !== 'play' && state !== 'pause') return;
    if (state === 'play' && ui.modal) return;
    const from = state;
    state = 'map';
    input.exitPointerLock();
    touch?.setVisible(false);
    const tg = quest.targets();
    ui.bigMap(player.position.x, player.position.z, tg.main, tg.extra, () => (from === 'pause' ? openPause2() : play()));
  };
  const openPause2 = () => {
    state = 'play';
    ui.close();
    openPause();
  };
  input.onPointerLockChange = (locked) => {
    // Esc releases the mouse: treat it as pause (unless a dialogue or quiz took the mouse).
    if (!locked && state === 'play' && !ui.modal) openPause();
  };
  canvas.addEventListener('click', () => {
    if (state === 'play' && !ui.modal) input.requestPointerLock();
  });
  // Dialogues and quizzes need the mouse; give it back when they close.
  let wasModal = false;

  loading.remove();
  toTitle();
  (window as unknown as { __campus: unknown }).__campus = { quest, player, ui, world, ground, scene, camera, renderer };

  let last = performance.now();
  let acc = 0;
  let time = 0;
  let titleT = 0;
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.1);
    last = now;
    const playing = state === 'play' && !ui.modal;
    if (ui.modal && !wasModal && state === 'play') input.exitPointerLock();
    if (!ui.modal && wasModal && state === 'play') lockOrPrompt();
    wasModal = ui.modal;

    if (playing) {
      time += dt;
      const look = input.consumeLook();
      player.look(look.x, look.y);
      if (input.pressed('jump')) player.requestJump();
      if (input.pressed('map')) openMap();
      // Esc is handled through the pointer-lock release; P pauses directly.
      if (input.pressed('KeyP')) openPause();
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 6) {
        player.update(FIXED_DT, input);
        physics.step();
        acc -= FIXED_DT;
        steps += 1;
      }
      if (steps === 6) acc = 0;
    } else input.consumeLook();
    const alpha = acc / FIXED_DT;
    const adt = state === 'play' ? dt : 0;
    player.animate(adt, alpha, null);

    if (state === 'title') {
      // Slow drift over the campus with the Annapurnas behind.
      titleT += dt;
      const t = titleT * 0.03;
      const cx = 60 + Math.sin(t) * 150;
      const cz = 160 + Math.cos(t) * 60;
      camera.position.set(cx, ground.heightAt(cx, cz) + 42, cz);
      camera.lookAt(60, 10, -120);
    } else player.applyCamera(camera, dt);

    for (const p of people) p.update(state === 'title' ? dt : adt, camera.position, state === 'play' ? player.renderPos : null);
    quest.update(adt, playing, player.renderPos, playing && input.pressed('interact'));
    if (state === 'play') {
      const heading = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
      const tg = quest.targets();
      ui.updateNav(player.renderPos.x, player.renderPos.z, heading, tg.main, tg.extra);
      touch?.update({ mode: 'foot', prompt: quest.promptText ? { text: quest.promptText, progress: 0 } : null, radio: null, armed: false, drawn: false, needsRecovery: false, flashlight: false, lights: false });
    }
    world.update(time, camera);
    atmosphere.update(dt, camera.position, camera);
    windUniforms.uTime.value = time + titleT;
    windUniforms.uGust.value = 0.45 + 0.35 * Math.sin(time * 0.21) * Math.sin(time * 0.077 + 1.3);
    windUniforms.uSunTrans.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.4);
    windUniforms.uSkyTrans.value.copy(atmosphere.state.horizon).multiplyScalar(atmosphere.state.envIntensity);
    audio.update(dt, camera, windUniforms.uGust.value, 0.25, []);
    renderer.render(scene, camera);
    input.endFrame();
  };
  requestAnimationFrame(loop);
  (window as unknown as { __ready: boolean }).__ready = true;
}

boot().catch((err: unknown) => {
  console.error(err);
  label.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
  (window as unknown as { __error: string }).__error = String(err);
});
