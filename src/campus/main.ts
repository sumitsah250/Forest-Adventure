// Campus Quest entry point: renderer, physics, the campus world, the player and Kalki the
// go-kart, people, the "Blackout at WRC" missions and side activities, the interface, the
// sky through the night, and the frame loop.

import '../style.css';
import './campus.css';
import * as THREE from 'three';
import { Input } from '../core/input.ts';
import { PRESETS, loadSettings, qualityOverride } from '../core/settings.ts';
import { installGrade } from '../render/grade.ts';
import { GROUP, PhysicsWorld, groups, initRapier } from '../physics/physics.ts';
import { Atmosphere, type AtmosphereState } from '../render/atmosphere.ts';
import { loadPbr, setMaxAnisotropy, setTextureCap } from '../render/textures.ts';
import { buildFoliageAtlas } from '../render/foliageAtlas.ts';
import { windUniforms } from '../render/foliageMaterial.ts';
import { Player } from '../player/player.ts';
import { AudioEngine } from '../audio/audio.ts';
import { TouchControls } from '../ui/touch.ts';
import type { TerrainData } from '../world/terrain.ts';
import { DATA, GATE, WORLD_HALF, centroid, pointInPoly } from './geo.ts';
import { CampusGround } from './ground.ts';
import { buildCampus } from './world.ts';
import { crowd, populate, type Person } from './people.ts';
import { GATE_ROAD } from './story/routes.ts';
import { openShareCard } from './share.ts';
import { decide, offerSkip, runMini, runPuzzle } from './minigames.ts';
import type { MiniGame } from './minigames/types.ts';
import { signalTuner } from './minigames/tuner.ts';
import { chiyaRush } from './minigames/chiya.ts';
import { tableTennis } from './minigames/pong.ts';
import { bubbleLevel } from './minigames/bubble.ts';
import { generatorPull } from './minigames/generator.ts';
import { bugHunt } from './minigames/bughunt.ts';
import { ShardRiddles } from './shardRiddles.ts';
import { PLAYER_SUIT, setCharacterDetail } from '../character/humanoid.ts';
import { loadPlayerModel } from '../character/playerModel.ts';
import { CampusUI, type GarageState, type MissionCard } from './ui.ts';
import { Missions, type MissionResult } from './missions.ts';
import { Extras } from './extras.ts';
import { ACCUSATION, BUG_SNIPPETS, INTERLUDES, SHARD_RIDDLES, WRONG_ACCUSATION, type InterludeDef, CLUES, CUTSCENES, DEBUG_MODE, DEMO_MODE, FEST_BANNER, KART_HOME, MISSIONS, MISSION_COUNT, NPCS, STORY_VERSION, V2_TEXT, VOICES, WEATHER, powerLevel, type CutEvent, type ItemModel, type MissionDef, type Sky, type Where } from './story.ts';
import { LocationCard, addToBoard, leaderboard, nameEntry } from './screens.ts';
import { DebugPanel } from './debug.ts';
import { Cutscenes } from './cutscene.ts';
import { Subtitles } from './dialogue.ts';
import { Portraits } from './portraits.ts';
import { CampusScreens, DoorCut, DroneEyes, Motorbike, MudSlide, Tarp, festBanner } from './props.ts';
import { ClueBook } from './clues.ts';
import { openBoard } from './evidence.ts';
import { createPlayerHumanoid } from '../character/playerModel.ts';
import { CheckRing, Drone, coinModel, itemModel, shardModel } from './actors.ts';
import { Cinema, type Shot } from './cinema.ts';
import { Fireflies, Lightning, Rain, Sparks } from './fx.ts';
import { CampusSound } from './soundscape.ts';
import { buildHumps } from './ramps.ts';
import { WheelSpray } from '../vehicles/spray.ts';
import { Kalki, MAX_UPGRADE, PAINTS, UPGRADE_COST } from './kart.ts';
import { claimDaily, has, levelOf, loadProfile, resetForDemo, resetStory, saveProfile, titleFor } from './profile.ts';
import { badgeViews, checkBadges, goalViews, refreshGoals, starsTotal, trackGoal, type GoalEvent } from './meta.ts';
import { createLoadingScreen } from '../ui/loadingScreen.ts';
import { initPwa } from '../pwa.ts';

initPwa();

const FIXED_DT = 1 / 60;
const params = new URLSearchParams(location.search);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLDivElement;
const loading = createLoadingScreen(uiRoot, 'campus');
const progress = (f: number, text: string) => loading.set(f, text);
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

const C = (h: string) => new THREE.Color(h);
/** The title screen: a clear Pokhara afternoon (less haze than the forest, so the Himalaya shows). */
const AFTERNOON: AtmosphereState = { zenith: C('#3c78c2'), horizon: C('#c9d6de'), fog: C('#b4c3cc'), sunColor: C('#ffd29a'), sunIntensity: 3.8, envIntensity: 0.8, fogDensity: 0.0011, fogFalloff: 0.02, cover: 0.28, exposure: 1 };
/** The story's skies: the sun going down at 7 PM, a moonlit monsoon night, sunrise over Machhapuchhre. */
const SKIES: Record<Sky, AtmosphereState> = {
  dusk: { zenith: C('#33507e'), horizon: C('#e2a274'), fog: C('#a08c84'), sunColor: C('#ffa862'), sunIntensity: 2.5, envIntensity: 0.6, fogDensity: 0.0013, fogFalloff: 0.02, cover: 0.42, exposure: 1.05 },
  night: { zenith: C('#0d1733'), horizon: C('#34466c'), fog: C('#243049'), sunColor: C('#a9c2ff'), sunIntensity: 1.15, envIntensity: 0.42, fogDensity: 0.0016, fogFalloff: 0.02, cover: 0.5, exposure: 1.25 },
  // Clear and still dark, with first light low in the east (V2 mission 10, 5:20 AM).
  predawn: { zenith: C('#101c40'), horizon: C('#5a6490'), fog: C('#2c3654'), sunColor: C('#b4c4ff'), sunIntensity: 1.35, envIntensity: 0.5, fogDensity: 0.0012, fogFalloff: 0.02, cover: 0.14, exposure: 1.22 },
  dawn: { zenith: C('#4a6fae'), horizon: C('#f6c08e'), fog: C('#c9b4a6'), sunColor: C('#ffc28a'), sunIntensity: 3.1, envIntensity: 0.72, fogDensity: 0.0012, fogFalloff: 0.02, cover: 0.3, exposure: 1.05 },
};

async function boot(): Promise<void> {
  const settings = loadSettings();
  const forced = qualityOverride();
  if (forced) settings.quality = forced;
  const preset = PRESETS[settings.quality];
  setCharacterDetail(settings.quality !== 'low');

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: preset.antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('test') });
  // Reading each shader's error log makes the browser wait for every compile in turn (seconds on phones).
  renderer.debug.checkShaderErrors = import.meta.env.DEV;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (preset.grading) installGrade(renderer);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  // Low (phones start there): textures at most textureSize, so the tab stays inside a phone's memory.
  setTextureCap(settings.quality === 'low' ? preset.textureSize : 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 1600);
  camera.rotation.order = 'YXZ';
  // Phones and tablets: their screens have 2-3x more pixels than their GPUs can fill at 60 fps, and on a small screen
  // CSS-pixel resolution looks fine. The adaptive scale below lowers it further if frames still run slow.
  const touchDevice = window.matchMedia('(pointer: coarse)').matches;
  const maxRatio = touchDevice ? 1 : 1.5;
  let resScale = 1;
  const resize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(Math.min(window.devicePixelRatio || 1, 2) * preset.pixelRatio, maxRatio) * resScale);
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  const input = new Input(canvas);

  const playerModel = loadPlayerModel();
  progress(0.02, 'Starting physics');
  const R = await initRapier();
  progress(0.04, 'Reading the slope of Lamachaur');
  await frame();
  const ground = new CampusGround();
  const physics = new PhysicsWorld(R, ground as unknown as TerrainData);

  const atmosphere = new Atmosphere(scene);
  const copySky = (s: AtmosphereState) => {
    const a = atmosphere.state;
    a.zenith.copy(s.zenith);
    a.horizon.copy(s.horizon);
    a.fog.copy(s.fog);
    a.sunColor.copy(s.sunColor);
    Object.assign(a, { sunIntensity: s.sunIntensity, envIntensity: s.envIntensity, fogDensity: s.fogDensity, fogFalloff: s.fogFalloff, cover: s.cover, exposure: s.exposure });
  };
  copySky(AFTERNOON);
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

  // The player starts outside the main gate on Lamachaur Marg, facing into campus (title camera aside).
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
  // Natural human pace: a brisk walk, and a real run on Shift (Kalki covers the long distances).
  player.walkSpeed = 1.9;
  player.runSpeed = 5.8;
  player.accelMove = 6.5;
  player.accelStop = 9;
  player.turnWalk = 8.5;
  player.turnRun = 6.5;
  // The player's own model (public/assets/models/player/sumit_character.glb); the built-in suit is the fallback.
  await playerModel;
  player.attachCharacter(scene, PLAYER_SUIT);
  physics.step();

  progress(0.9, 'Fuelling Kalki');
  const profile = loadProfile();
  const kart = new Kalki(physics, ground as unknown as TerrainData, KART_HOME.x, KART_HOME.z, KART_HOME.heading, preset.headlightShadows);
  scene.add(kart.root);
  kart.setUpgrades(profile.upgrades);
  kart.setPaint(profile.paint);
  kart.boostUnlocked = has(profile, 'boost');
  for (let i = 0; i < 40; i += 1) {
    kart.fixedUpdate(FIXED_DT);
    physics.step();
  }
  kart.postPhysics();
  kart.update(0, 1, 0);

  progress(0.93, 'Students arriving for class');
  await frame();
  // Each passer-by is a dozen draw calls; phones get a smaller crowd.
  const people: Person[] = populate(scene, ground, physics, preset.vegetationDensity * (touchDevice ? 0.6 : 1));
  const audio = new AudioEngine();
  audio.setVolume(settings.masterVolume);
  player.onStep = (e) => audio.footstep(e.surface, e.intensity, player.renderPos);
  player.onLand = (e) => audio.footstep(e.surface, e.intensity, player.renderPos);
  const ui = new CampusUI(uiRoot, world.mapCanvas);
  const sound = new CampusSound(audio);
  ui.onSound = (n, g) => audio.play(n, undefined, g ?? 1);

  // ------------------------------------------------------------------ cinematics and effects
  const cinema = new Cinema(uiRoot);
  // Dialogue cards: portraits from the 3D characters, the player's name, MITRA's mood, the radio log.
  const portraits = new Portraits(renderer);
  ui.dialogue.portrait = (id) => portraits.get(id);
  ui.dialogue.fill = (t) => t.replaceAll('{name}', profile.name || 'Student').replaceAll('{roll}', profile.roll || 'not on file');
  ui.dialogue.mitraWarm = () => STORY_VERSION === 2 && profile.story >= 10;
  ui.dialogue.log = (who, text) => {
    profile.radioLog.push({ m: missions.def?.title ?? '', who, text });
    if (profile.radioLog.length > 80) profile.radioLog.splice(0, profile.radioLog.length - 80);
  };
  const subs = new Subtitles(uiRoot, ui.dialogue, (id) => VOICES[id]?.name ?? NPCS.find((n) => n.id === id)?.name ?? id);
  // Cutscene props (story 2): the fest banner on the gate, Kalki's tarp, the drones over the RIC.
  const locCard = new LocationCard(uiRoot);
  // The main gate (story 2): open, or shut by MITRA. `gateTo` is where the leaves are heading.
  let gateOpen = 1;
  let gateTo = 1;
  let gateRate = Infinity;
  /** Camera shake for big impacts: seconds left and strength. Applied for the render only. */
  let shakeT = 0;
  let shakeLen = 1;
  let shakeAmp = 0;
  const shakeOff = new THREE.Vector3();
  /**
   * Whether the gate stands open at the start of a mission (story 2): open until MITRA slams it
   * at the end of mission 1, shut from then on. Mission 10 and the ending open and shut it in
   * their cutscenes. Story 1 has no reason to shut it.
   */
  const gateFor = (index: number) => (STORY_VERSION !== 2 || index <= 0 || index >= MISSIONS.length ? 1 : 0);
  // MITRA's spotted lines: never the same twice in a row, at most one every 6 seconds.
  let spottedLast = -1;
  let spottedAt = -1e9;
  let stingerAt = -1e9;
  const spotted = () => {
    const now = performance.now();
    if (now - stingerAt > 4000) {
      stingerAt = now;
      audio.play('alarm');
    }
    if (STORY_VERSION !== 2 || now - spottedAt < 6000 || cutscenes.playing || ui.modal) return;
    const i = missions.index;
    const lines = i < 3 ? V2_TEXT.mitraSpotted.act1 : i < 7 ? V2_TEXT.mitraSpotted.act2 : V2_TEXT.mitraSpotted.act3;
    let k = Math.floor(Math.random() * lines.length);
    if (k === spottedLast) k = (k + 1) % lines.length;
    spottedLast = k;
    spottedAt = now;
    subs.show('mitra', lines[k]);
    window.setTimeout(() => {
      if (!cutscenes.playing && performance.now() - spottedAt >= 3000) subs.show(null, '');
    }, 3200);
  };
  const tarp = new Tarp();
  const droneEyes = new DroneEyes();
  const doorCut = new DoorCut();
  const mud = new MudSlide();
  const bike = new Motorbike();
  scene.add(tarp.obj, droneEyes.group, doorCut.obj, mud.obj, bike.obj);
  // C8: the clock spinning through the night (digits from tables, so nothing is allocated per frame).
  const clockEl = document.createElement('div');
  clockEl.className = 'cq-clockspin';
  clockEl.innerHTML = '<span></span>:<span></span> <small></small>';
  uiRoot.append(clockEl);
  const [clockH, clockM, clockAp] = Array.from(clockEl.children) as HTMLElement[];
  const HOURS = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
  const MINS = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  let clockFrom = 0;
  let clockTo = 0;
  let clockT = -1;
  let clockOver = 1;
  let clockShown = -1;
  const parseClock = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };
  // C8: the rain dying away; -1 means the weather decides.
  let rainCut = -1;
  let rainCutTo = 0;
  let rainCutRate = 1;
  // C10: the credits roll.
  const creditsEl = document.createElement('div');
  creditsEl.className = 'cq-credits';
  uiRoot.append(creditsEl);
  let crowdSpawned = false;
  // Clues (story 2): gold and silver cards.
  const clueBook = STORY_VERSION === 2 ? new ClueBook(uiRoot, CLUES, profile, V2_TEXT.clueUi, (n) => audio.play(n), () => saveProfile(profile)) : null;
  // C5: Asha's radio portrait breaking into static.
  const staticEl = document.createElement('div');
  staticEl.className = 'cq-static';
  uiRoot.append(staticEl);
  // M2: "look closer" at a person during a conversation (clue c1). A hotspot over their chest.
  const lookEl = document.createElement('button');
  lookEl.className = 'cq-look';
  lookEl.type = 'button';
  lookEl.setAttribute('aria-label', V2_TEXT.clueUi.lookCloser);
  lookEl.innerHTML = `<span>${V2_TEXT.clueUi.lookCloser} <kbd>F</kbd></span>`;
  uiRoot.append(lookEl);
  let lookAt: { pos: THREE.Vector3; found: () => void } | null = null;
  const lookV = new THREE.Vector3();
  const lookFound = () => {
    if (!lookAt) return;
    const l = lookAt;
    lookAt = null;
    lookEl.classList.remove('on');
    // The camera glances down at the lanyard for a moment.
    cinema.talk(camera.position.clone(), new THREE.Vector3(l.pos.x, l.pos.y + 1.25, l.pos.z), camera);
    audio.play('click');
    window.setTimeout(() => l.found(), 500);
  };
  lookEl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    lookFound();
  });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && lookAt) lookFound();
  });
  if (FEST_BANNER) scene.add(festBanner(world.gate, FEST_BANNER.title, FEST_BANNER.sub));
  const rain = new Rain(touchDevice ? 700 : 1600);
  const sparks = new Sparks(600);
  const dust = new WheelSpray();
  const lightning = new Lightning();
  const fireflies = new Fireflies(touchDevice ? 60 : 110);
  scene.add(rain.lines, sparks.points, dust.points, fireflies.points, buildHumps(ground, physics));
  lightning.onThunder = () => audio.play('thunder');
  /** Real seconds of slow motion left (big moments). */
  let slow = 0;
  const slowmo = (s: number) => (slow = Math.max(slow, s));
  let fireworks = 0;
  const fireworkAt = new THREE.Vector3();
  const FIRE = ['#ff4a5a', '#ffd24a', '#38e1ff', '#7cff8a', '#ff7ae0', '#ffffff'].map((c) => new THREE.Color(c));
  const startFireworks = (at: THREE.Vector3, seconds: number) => {
    fireworkAt.copy(at);
    fireworks = seconds;
  };

  // ------------------------------------------------------------------ reward moments
  /** Real seconds of frozen time left (a hit-stop on big moments) and the camera punch (0..1). */
  let freeze = 0;
  let punch = 0;
  const GOLD = new THREE.Color('#ffd24a');
  const CYAN = new THREE.Color('#38e1ff');
  const WHITE = new THREE.Color('#fff6dc');
  const sv = new THREE.Vector3();
  const sp = new THREE.Vector3();
  /**
   * Something good happened at `at`: sparks there, coins flying from it into the wallet,
   * and for big moments a 70 ms freeze and a little camera punch.
   */
  const reward = (at: THREE.Vector3, kind: 'small' | 'medium' | 'big', coins: number) => {
    const n = kind === 'big' ? 46 : kind === 'medium' ? 26 : 12;
    for (let i = 0; i < n; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const s = (kind === 'big' ? 3.5 : 2.2) * (0.5 + Math.random());
      sv.set(Math.cos(a) * s, 2 + Math.random() * (kind === 'big' ? 5 : 3), Math.sin(a) * s);
      sparks.emit(at, sv, i % 3 === 0 ? CYAN : i % 3 === 1 ? GOLD : WHITE, 0.45 + Math.random() * 0.4, 6);
    }
    if (kind === 'big') {
      freeze = Math.max(freeze, 0.07);
      punch = 1;
    } else if (kind === 'medium') punch = Math.max(punch, 0.5);
    if (coins > 0) {
      sp.copy(at).project(camera);
      const onScreen = sp.z < 1 && Math.abs(sp.x) < 1.1 && Math.abs(sp.y) < 1.1;
      const x = onScreen ? ((sp.x + 1) / 2) * window.innerWidth : window.innerWidth / 2;
      const y = onScreen ? ((1 - sp.y) / 2) * window.innerHeight : window.innerHeight * 0.55;
      ui.coinFly(x, y, coins);
    }
  };

  /** Daily goals and badges: count the event, announce what it completed, save. */
  const announceBadges = () => {
    for (const b of checkBadges(profile)) ui.achievement(b.icon, 'Badge unlocked', b.name);
  };
  const track = (e: GoalEvent, n = 1) => {
    for (const msg of trackGoal(profile, e, n)) ui.achievement('🎯', 'Daily goal', msg.replace(/^Daily goal: /, ''));
    announceBadges();
    saveProfile(profile);
  };

  // ------------------------------------------------------------------ campus power
  /** Share of campus with its power back: grows with the story, lights windows at night. */
  // The sunrise clock: story clock strings ("7:30 PM") as minutes, ordered through midnight.
  const clockMinutes = (c: string) => {
    const m = /(\d+):(\d+)\s*(AM|PM)/.exec(c);
    if (!m) return 0;
    let h = Number(m[1]) % 12;
    if (m[3] === 'PM') h += 12;
    else h += 24;
    return h * 60 + Number(m[2]);
  };
  const clockString = (min: number) => {
    const h24 = Math.floor(min / 60) % 24;
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}:${String(min % 60).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
  };
  let shownStoryMin = -2;
  let shownMinutes = -1;
  /** A cutscene may switch the power on mid-mission (C3); it holds until the next mission starts. */
  let powerHold: number | null = null;
  const powerFor = () => powerHold ?? powerLevel(profile.story);
  let powerShown = powerFor();
  let powerTo = powerShown;
  /** How fast the power level moves to its target (per second), and a floor for window glow before full dark (cutscenes set both). */
  let powerRate = 0.05;
  let glowMin = 0;
  let wet = 0;

  /** Mission intro: a high establishing shot pushing in on the first objective, then a low sweep. */
  const intro = async (d: MissionDef, index: number, at: { x: number; z: number } | null): Promise<void> => {
    if (!at) {
      ui.banner(`Mission ${index + 1} · ${d.title}`, `${d.clock} — ${d.brief}`);
      audio.play('objective');
      return;
    }
    const gy = ground.heightAt(at.x, at.z);
    const p = focus();
    let dx = p.x - at.x;
    let dz = p.z - at.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const target = new THREE.Vector3(at.x, gy + 1.6, at.z);
    const V = (u: number, h: number, side = 0) => new THREE.Vector3(at.x + dx * u + dz * side, gy + h, at.z + dz * u - dx * side);
    const replay = (profile.stars[d.id] ?? 0) > 0;
    const shots: Shot[] = [];
    if (!replay) shots.push({ from: V(110, 60, -30), to: V(55, 30, -12), look: target.clone().setY(gy - 4), lookTo: target, dur: 3.6, fov: 55 });
    shots.push({ from: V(12, 3.2, 9), to: V(8, 2.2, -7), look: target, dur: replay ? 2.2 : 2.8, fov: 48 });
    audio.play('sting');
    window.setTimeout(() => audio.play('whoosh'), 250);
    document.body.classList.add('cq-cinematic');
    await cinema.play(shots, { kicker: `Mission ${index + 1} · ${d.clock}`, title: d.title, sub: d.brief }, settings.fov);
    document.body.classList.remove('cq-cinematic');
  };

  /** Over-the-shoulder framing on the person the player is talking to. */
  const converse = (p: Person | null) => {
    if (!p) {
      cinema.release();
      return;
    }
    if (mode === 'kart') return;
    const me = player.renderPos;
    let dx = p.pos.x - me.x;
    let dz = p.pos.z - me.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    player.facing = Math.atan2(-dx, -dz);
    const head = me.y + 1.55;
    const cam = new THREE.Vector3(me.x - dx * 1.35 + dz * 0.55, head + 0.12, me.z - dz * 1.35 - dx * 0.55);
    cinema.talk(cam, new THREE.Vector3(p.pos.x, p.pos.y + 1.5, p.pos.z), camera);
  };

  type State = 'title' | 'play' | 'pause' | 'map' | 'menu';
  let state: State = 'title';
  let mode: 'foot' | 'kart' = 'foot';
  let started = false;

  // ------------------------------------------------------------------ sky
  let skyFrom: AtmosphereState = AFTERNOON;
  let skyTo: AtmosphereState = AFTERNOON;
  let skyT = 1;
  let skyDur = 2.5;
  let night = false;
  const setSky = (to: AtmosphereState, instant = false, dur = 2.5) => {
    if (to === skyTo && skyT >= 1) return;
    skyDur = dur;
    skyFrom = {
      ...atmosphere.state, zenith: atmosphere.state.zenith.clone(), horizon: atmosphere.state.horizon.clone(),
      fog: atmosphere.state.fog.clone(), sunColor: atmosphere.state.sunColor.clone(),
    };
    skyTo = to;
    skyT = instant ? 0.999 : 0;
    night = to === SKIES.night || to === SKIES.predawn;
  };

  // ------------------------------------------------------------------ kart helpers
  const inKart = () => mode === 'kart';
  const focus = () => (mode === 'kart' ? kart.position : player.renderPos);
  const enterKart = () => {
    if (mode !== 'foot') return;
    mode = 'kart';
    kart.vehicle.enter(player);
    kart.vehicle.setLights(night || skyTo === SKIES.dusk);
    audio.play('thunk', kart.position);
    window.setTimeout(() => audio.engineStart(kart.position, true), 300);
  };
  const exitKart = (): boolean => {
    if (mode !== 'kart') return false;
    if (!kart.vehicle.exit(player)) {
      ui.toast('No room to get out here', 'bad');
      return false;
    }
    kart.vehicle.phys.engineOn = false;
    mode = 'foot';
    audio.play('thunk', kart.position);
    return true;
  };
  let summonCooldown = 0;
  /**
   * The nearest free spot for Kalki around the player: rings outward from 3.5 m to 18 m,
   * trying the direction the player looks first. A spot must be outside buildings, near the
   * player's level, not steep, and clear of anything solid (benches, fences, trees, walls,
   * people) for the whole kart. Paved ground is preferred if it is about as close.
   */
  const kartShape = new physics.R.Cuboid(0.8, 0.42, 1.2);
  const findKartSpot = (p: { x: number; y: number; z: number } = player.position, lineOfSight = true): { x: number; z: number; heading: number } | null => {
    const look = player.yaw; // view forward is (-sin yaw, -cos yaw)
    const heading = look + Math.PI; // kart forward (sin h, cos h) = view forward
    const rot = { x: 0, y: Math.sin(heading / 2), z: 0, w: Math.cos(heading / 2) };
    const order = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8];
    let fallback: { x: number; z: number; heading: number; d: number } | null = null;
    for (const r of [3.5, 5, 7, 9.5, 12.5, 15.5, 18]) {
      for (const k of order) {
        const a = look + Math.PI + (k * Math.PI) / 8;
        const x = p.x - Math.sin(a + Math.PI) * r;
        const z = p.z - Math.cos(a + Math.PI) * r;
        if (Math.abs(x) > WORLD_HALF - 16 || Math.abs(z) > WORLD_HALF - 16) continue;
        const gy = ground.heightAt(x, z);
        if (Math.abs(gy - p.y) > 1.6 || ground.slopeAt(x, z) > 0.3) continue;
        if (DATA.buildings.some((b) => pointInPoly(x, z, b.pts))) continue;
        let blocked = false;
        physics.world.intersectionsWithShape(
          { x, y: gy + 0.75, z }, rot, kartShape,
          () => {
            blocked = true;
            return false;
          },
          undefined, groups(GROUP.VEHICLE, GROUP.STATIC | GROUP.DYNAMIC | GROUP.NPC), undefined, kart.vehicle.phys.body,
        );
        if (blocked) continue;
        // Also a clear line from the player to the spot (not behind a wall or fence).
        const dx = x - p.x;
        const dz = z - p.z;
        const len = Math.hypot(dx, dz);
        const ray = new physics.R.Ray({ x: p.x, y: p.y + 0.8, z: p.z }, { x: dx / len, y: 0, z: dz / len });
        if (lineOfSight && physics.world.castRay(ray, len, true, undefined, groups(0xffff, GROUP.STATIC))) continue;
        const paved = ground.surfaceAt(x, z) === 'rock' || ground.surfaceAt(x, z) === 'gravel';
        if (paved) return { x, z, heading };
        if (!fallback) fallback = { x, z, heading, d: r };
      }
      // Grass close by beats a road far away.
      if (fallback && r >= fallback.d + 4) break;
    }
    return fallback;
  };
  const summonKart = () => {
    if (mode !== 'foot' || !missions.kartAllowed()) return;
    if (summonCooldown > 0) {
      ui.toast(`Kalki is still on the way… (${Math.ceil(summonCooldown)} s)`);
      return;
    }
    if (kart.position.distanceTo(player.renderPos) < 6) {
      ui.toast('Kalki is right here — press E to get in');
      return;
    }
    let spot = findKartSpot();
    let outside = false;
    if (!spot) {
      // Inside a building: Kalki waits outside its door.
      const b = DATA.buildings.find((q) => pointInPoly(player.position.x, player.position.z, q.pts));
      if (b) {
        const e = world.entranceFor(b);
        spot = findKartSpot({ x: e.x, y: ground.heightAt(e.x, e.z), z: e.z }, false);
        outside = !!spot;
      }
    }
    if (!spot) {
      ui.toast('No free space for Kalki here — step somewhere more open', 'bad');
      return;
    }
    kart.place(spot.x, spot.z, spot.heading, ground as unknown as TerrainData);
    summonCooldown = 3;
    // Arrival: a burst of sparks, a whoosh and the engine note.
    const at = new THREE.Vector3(spot.x, ground.heightAt(spot.x, spot.z) + 0.4, spot.z);
    for (let i = 0; i < 40; i += 1) sparks.emit(at, new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6), new THREE.Color(i % 2 ? '#38e1ff' : '#ffd24a'), 0.5 + Math.random() * 0.4);
    audio.play('whoosh', at);
    audio.play('keys', player.renderPos);
    ui.toast(outside ? 'Kalki is waiting outside the door' : 'Kalki is here! Press E to get in', 'good');
  };

  ui.onCallKart = () => summonKart();

  // ------------------------------------------------------------------ missions
  const missions: Missions = new Missions({
    scene, world, ground, physics, ui, profile,
    sound: (n) => audio.play(n),
    inKart,
    reposition: (x, z, lx, lz) => {
      const yaw = Math.atan2(x - lx, z - lz);
      if (mode === 'kart') kart.place(x, z, yaw + Math.PI, ground as unknown as TerrainData);
      else player.teleport(x, ground.heightAt(x, z), z, yaw);
    },
    onSky: (sky) => setSky(SKIES[sky]),
    onUnlock: (id) => {
      if (id === 'boost') kart.boostUnlocked = true;
      if (id.startsWith('paint:') && !profile.paints.includes(id.slice(6))) profile.paints.push(id.slice(6));
      if (id === 'engine' || id === 'grip') {
        profile.upgrades[id] = Math.min(MAX_UPGRADE, profile.upgrades[id] + 1);
        kart.setUpgrades(profile.upgrades);
      }
      saveProfile(profile);
      extras.refresh();
    },
    onComplete: (r) => afterMission(r),
    clues: clueBook ?? undefined,
    board: () => openBoardView(),
    doorCut: (door, p) => {
      if (!door) {
        doorCut.set(0, 0, 0, 0, null);
        return;
      }
      doorCut.set(door.x, ground.heightAt(door.x, door.z), door.z, door.facing, p);
    },
    lookCloser: (p, onFound) => {
      lookAt = { pos: p.pos, found: onFound };
      lookEl.classList.add('on');
      return () => {
        lookAt = null;
        lookEl.classList.remove('on');
      };
    },
    accuse: () => openBoard(ui, {
      clues: CLUES,
      state: (id) => profile.clues[id] ?? null,
      name: (id) => NPCS.find((n) => n.id === id)?.name ?? id,
      portrait: (id) => portraits.get(id),
      text: V2_TEXT.clueUi,
      sound: (n) => audio.play(n),
      mode: 'accuse',
      questions: ACCUSATION,
      culprit: 'sunil',
      clearing: WRONG_ACCUSATION,
      // A wrong accusation costs 15 minutes on the sunrise clock.
      onWrong: () => {
        profile.minutes = Math.max(0, profile.minutes - 15);
        saveProfile(profile);
      },
    }),
    bike,
    onStep: (st) => {
      // Mission 10: Sunil opens the main gate from his phone as the chase starts (decision 9).
      if (st.kind === 'chase' && st.bike) {
        gateTo = 1;
        gateRate = 1 / 1.6;
        audio.play('gateCreak');
      }
    },
    onBegin: (index) => {
      powerHold = null;
      updateScreens();
      gateTo = gateOpen = gateFor(index);
      world.gate.setOpen(gateOpen);
    },
    locationCard: (clock, place) => locCard.show(clock, place),
    spotted,
    cutscene: (id) => cutscenes.play(id, camera),
    reward,
    chime: (n) => audio.chime(n),
    track,
    intro,
    converse,
    placeKart: (x, z, heading) => kart.place(x, z, heading, ground as unknown as TerrainData),
    moment: (kind) => {
      slowmo(kind === 'caught' ? 1.1 : 0.7);
      audio.play('whoosh');
      if (kind === 'caught') ui.trick('GOTCHA!', 'drone caught');
    },
  });

  // Kalki stunts.
  let lastDrift = 0;
  kart.onDriftStart = () => audio.play('driftCharge');
  kart.onTurbo = (level) => {
    audio.play('boost');
    missions.noteTurbo();
    profile.stats.turbos += 1;
    track('turbo');
    const coins = missions.stunt(level * 5);
    ui.trick(['', 'MINI-TURBO', 'SUPER TURBO', 'ULTRA TURBO'][level], `+${coins}◈`);
    kart.vehicle.shake = Math.max(kart.vehicle.shake, 0.25);
  };
  kart.onLand = (air) => {
    audio.play('air');
    if (air > 0.35) {
      profile.stats.jumps += 1;
      track('jump');
    }
    const coins = missions.stunt(Math.round(air * 12));
    ui.trick(`AIR ${air.toFixed(1)} s`, `+${coins}◈`);
    kart.vehicle.shake = Math.max(kart.vehicle.shake, Math.min(0.8, air * 0.6));
    if (air > 1) slowmo(0.4);
  };
  people.push(...missions.people);
  const extras = new Extras({ scene, ground, ui, profile, sound: (n) => audio.play(n), onCoins: () => missions.refreshHud(), kart: kart.root, track, reward, onShard: () => void riddles?.offer() });
  // Story 2: the old story's riddles as bonus riddles, one opened by each shard.
  const riddles = STORY_VERSION === 2
    ? new ShardRiddles({
        scene, profile, riddles: SHARD_RIDDLES, text: V2_TEXT.shardRiddle,
        resolve: (w, label) => missions.resolve(w, label, true),
        heightAt: (x, z) => ground.heightAt(x, z),
        dialog: (who, role, lines) => ui.dialog(who, role, lines, 'mitra'),
        toast: (s, k) => ui.toast(s, k),
        sound: (n) => audio.play(n),
        reward: (at, coins) => reward(at, 'big', coins),
      })
    : null;

  // ------------------------------------------------------------------ cutscenes
  /** Scripted events a cutscene shot can fire by name (story/v2/cutscenes.ts lists them). */
  const cutEvents: Record<string, (e: CutEvent, at: THREE.Vector3 | null) => void> = {
    power: (e) => {
      const v = e.value ?? 0;
      powerRate = e.over ? Math.abs(v - powerShown) / e.over : Infinity;
      powerTo = v;
    },
    glow: (e) => (glowMin = e.value ?? 0),
    screens: (e) => {
      screensForced = (e.arg as 'intruder' | 'reopened' | 'hero' | 'off') ?? null;
      updateScreens();
    },
    lightning: () => lightning.strike(),
    mud: (_e, at) => {
      if (at) mud.start(at, -0.53, 0.85);
    },
    radioStatic: (e) => {
      const url = portraits.get(e.arg ?? 'asha');
      staticEl.innerHTML = url ? `<img src="${url}" alt="">` : '';
      staticEl.classList.remove('on');
      void staticEl.offsetWidth;
      staticEl.classList.add('on');
      window.setTimeout(() => staticEl.classList.remove('on'), (e.over ?? 3) * 1000);
    },
    silence: () => undefined,
    dronesBlue: () => droneEyes.turnBlue(),
    bike: (e) => {
      if (e.arg === 'skid') {
        bike.skid(1);
        audio.play('skid', bike.obj.position);
      } else if (e.arg === 'hide') bike.hide();
    },
    sky: (e) => {
      const s = SKIES[e.arg as Sky];
      if (s) setSky(s, !e.over, e.over || 2.5);
    },
    clock: (e) => {
      const [a, b] = (e.arg ?? '').split('|');
      clockFrom = parseClock(a);
      clockTo = parseClock(b);
      if (clockTo < clockFrom) clockTo += 24 * 60;
      clockT = 0;
      clockOver = e.over ?? 4;
      clockShown = -1;
      clockEl.classList.add('on');
    },
    rain: (e) => {
      if (rainCut < 0) rainCut = rain.level;
      rainCutTo = e.value ?? 0;
      rainCutRate = e.over ? Math.max(0.01, Math.abs(rainCutTo - rainCut) / e.over) : Infinity;
    },
    crowd: (e) => {
      if (crowdSpawned) return;
      crowdSpawned = true;
      const inward = [...GATE_ROAD].reverse().slice(1);
      people.push(...crowd(scene, ground, physics, GATE, inward, e.value ?? 16));
      audio.play('crowd');
    },
    credits: (e) => {
      creditsEl.replaceChildren(...V2_TEXT.ending.credits.map((line, i) => {
        const p = document.createElement(i === 0 ? 'h3' : 'p');
        p.textContent = line;
        return p;
      }));
      creditsEl.style.setProperty('--roll', `${e.over ?? 8}s`);
      creditsEl.classList.remove('on');
      void creditsEl.offsetWidth;
      creditsEl.classList.add('on');
    },
    drones: (e, at) => droneEyes.show(e.value ?? 0, at),
    tarp: (e) => (e.arg === 'on' ? tarp.cover(kart.position, kart.heading) : tarp.pull()),
    headlights: (e) => kart.vehicle.setLights(!!e.value),
    gate: (e) => {
      gateTo = e.value ?? 0;
      gateRate = e.over ? Math.abs(gateTo - gateOpen) / e.over : Infinity;
    },
    shake: (e) => {
      shakeAmp = e.value ?? 0.5;
      shakeLen = shakeT = e.over ?? 0.6;
    },
  };
  const cutscenes = new Cutscenes(CUTSCENES, {
    where: (w, out) => {
      const s = missions.resolve(w, 'cutscene');
      out.set(s.x, ground.heightAt(s.x, s.z), s.z);
      return s.facing;
    },
    // Each resolver is made once per shot; calling it writes into `out` and allocates nothing.
    entity: (ref) => {
      if (ref === 'player') return (out) => (out.copy(player.renderPos), player.facing + Math.PI);
      if (ref === 'kart') return (out) => (out.copy(kart.position), kart.heading);
      if (ref === 'gate') return (out) => (out.set(world.gate.x, world.gate.y, world.gate.z), world.gate.heading);
      if (ref === 'bike') return (out) => (out.copy(bike.obj.position), bike.obj.rotation.y);
      if (ref.startsWith('npc:')) {
        const n = missions.npcSpot(ref.slice(4));
        return n ? (out) => (out.copy(n.pos), n.facing()) : null;
      }
      return null;
    },
    sound: (n) => audio.play(n),
    event: (e, at) => {
      const run = cutEvents[e.do];
      if (run) run(e, at);
      else console.warn(`Campus Quest: unknown cutscene event "${e.do}"`);
    },
    subtitle: (who, text) => subs.show(who, text),
    card: (c) => cinema.setCard(c ?? null),
    letterbox: (on) => cinema.setBars(on),
    begin: () => touch?.setVisible(false),
    end: () => {
      touch?.setVisible(state === 'play');
      // Back to what the story says the lights should be.
      if (powerTo > 0.5 && STORY_VERSION === 2 && missions.def?.id === 'v2-backup-power') powerHold = 1;
      powerTo = powerFor();
      powerRate = 0.05;
      glowMin = 0;
      clockT = -1;
      clockEl.classList.remove('on');
      creditsEl.classList.remove('on');
      rainCut = -1;
      if (state === 'play' && !ui.modal) lockOrPrompt();
    },
    baseFov: () => settings.fov,
  }, uiRoot);

  const totalStars = () => `${starsTotal(profile)} / ${MISSIONS.length * 3}`;

  const afterMission = async (r: MissionResult) => {
    if (DEMO_MODE) {
      await demoFinish(r.seconds);
      return;
    }
    const lv = levelOf(profile.xp);
    const last = r.index === MISSIONS.length - 1 && !r.replay;
    const nextIndex = profile.story < MISSIONS.length ? profile.story : -1;
    // Victory: slow orbit around the player, fireworks for three stars.
    const f0 = focus();
    cinema.orbit(new THREE.Vector3(f0.x, f0.y + 1.2, f0.z), camera, mode === 'kart' ? 5.5 : 4.2, 1.6);
    if (r.stars >= 3 || last) startFireworks(new THREE.Vector3(f0.x, f0.y + 24, f0.z), last ? 30 : 6);
    // Power back to another part of campus: the windows come on during the victory orbit.
    const powerBefore = powerTo;
    powerTo = powerFor();
    if (powerTo > powerBefore + 1e-3) window.setTimeout(() => audio.play('power'), 500);
    announceBadges();
    saveProfile(profile);
    const next = nextIndex >= 0 && !last ? MISSIONS[nextIndex] : null;
    const choice = await ui.missionComplete({
      title: r.mission.title, number: r.index + 1, stars: r.stars, prevStars: r.prevStars, seconds: r.seconds, par: r.mission.par,
      heartsLeft: r.heartsLeft, coins: r.coins, xp: r.xp,
      level: { before: r.levelBefore, after: r.levelAfter, frac: lv.into / lv.need, title: titleFor(lv.level) },
      card: `${powerTo > powerBefore + 1e-3 ? `⚡ Campus power ${Math.round(powerTo * 100)}% · ` : ''}${r.perfect ? `PERFECT RUN +100◈ · ${r.mission.reward.card}` : r.mission.reward.card}`,
      newUnlock: r.newUnlock, bestTime: r.bestTime,
      nextLabel: last ? 'Finish the story' : nextIndex >= 0 ? `Next: ${MISSIONS[nextIndex].title}` : 'Keep exploring',
      garage: missions.kartAllowed(),
      bonus: r.bonus,
      teaser: next ? `Mission ${nextIndex + 1} · ${next.clock} — ${next.title}: ${next.brief}` : null,
      autoNext: next ? 10 : 0,
    });
    missions.refreshHud();
    if (!last) cinema.release();
    if (choice === 'garage') await new Promise<void>((res) => openGarage(res));
    // Story 2: the mini-game after this mission (first completion only; decision 17).
    const inter = STORY_VERSION === 2 && !r.replay && !last ? INTERLUDES.find((x) => x.after === r.mission.id) : undefined;
    if (inter) await playInterlude(inter, false);
    if (last) {
      // Story 2: the share card, then back to the ending screen.
      const share = () => void openShareCard(ui, {
        text: V2_TEXT.share, name: profile.name, roll: profile.roll, minutes: profile.minutes,
        stars: starsTotal(profile), maxStars: MISSIONS.length * 3, choice: profile.choices.mitraMemory,
        face: portraits.canvas('player'), sound: (n) => audio.play(n),
      }).then(showEnding);
      const showEnding = () => ui.ending(
        { coins: profile.coins, stars: totalStars(), level: lv.level, title: titleFor(lv.level), seconds: profile.stats.seconds, accuracy: profile.stats.correct },
        () => {
          cinema.release();
          missions.stop();
          ui.close();
          play();
        },
        () => {
          cinema.release();
          openMissions(() => toTitle());
        },
        () => {
          cinema.release();
          toTitle();
        },
        STORY_VERSION === 2
          ? { minutes: String(profile.minutes), minutesLabel: V2_TEXT.share.minutesLabel, shareLabel: V2_TEXT.share.button, onShare: share }
          : undefined,
      );
      showEnding();
      return;
    }
    if (nextIndex >= 0 && nextIndex === SUNRISE) startLongWait();
    else if (nextIndex >= 0) await missions.begin(nextIndex);
    else missions.stop();
  };

  // ------------------------------------------------------------------ the long wait (story 2)
  /** Mission 10 in story 2: after mission 9 the player roams until they walk to the Exam Section. */
  const SUNRISE = STORY_VERSION === 2 ? MISSIONS.findIndex((m) => m.id === 'v2-sunrise') : -1;
  const exam = { x: 0, z: 0 };
  let longWait = false;
  let gossiping = false;
  const startLongWait = () => {
    const t = V2_TEXT.longWait;
    const s = missions.resolve({ point: 'Exam Section' }, t.label);
    exam.x = s.x;
    exam.z = s.z;
    longWait = true;
    missions.stop();
    missions.roamGoal = { obj: t.obj, sub: t.sub, target: { x: s.x, z: s.z, label: t.label } };
    missions.refreshHud();
  };

  // style.css only shows the touch layer (joystick, buttons, map) under body.is-touch.
  if (input.isTouch) document.body.classList.add('is-touch');
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

  /** Stand the player near (x, z), facing it. */
  const placeNear = (x: number, z: number, dist = 9) => {
    const a = Math.random() * Math.PI * 2;
    for (let k = 0; k < 8; k += 1) {
      const px = x + Math.cos(a + k) * dist;
      const pz = z + Math.sin(a + k) * dist;
      if (DATA.buildings.some((b) => pointInPoly(px, pz, b.pts))) continue;
      if (mode === 'kart') exitKart();
      player.teleport(px, ground.heightAt(px, pz), pz, Math.atan2(px - x, pz - z));
      return;
    }
  };

  const startMission = async (index: number, step = 0, replay = false) => {
    void audio.start();
    touch?.enterImmersive();
    play();
    await missions.begin(index, step, replay);
    const t = missions.targets(kart.position).main;
    // Stealth steps: start outside the drones' patrol, not in it.
    if (t) placeNear(t.x, t.z, missions.stepDef?.kind === 'stealth' ? 30 : 9);
  };

  const newStory = async () => {
    resetStory(profile);
    saveProfile(profile);
    powerShown = powerTo = powerFor();
    tarp.clear();
    // A story that opens on a cutscene starts under its own sky (no blend, and no light-map rebuild mid-shot).
    if (MISSIONS[0].steps[0]?.kind === 'cutscene') setSky(SKIES[MISSIONS[0].sky], true);
    // Wake up outside the RIC, where Asha is waiting.
    const s = missions.resolve({ building: 'Research and Innovation Centre (RIC)' }, 'RIC');
    const px = s.x + Math.sin(s.facing) * 7;
    const pz = s.z + Math.cos(s.facing) * 7;
    if (mode === 'kart') exitKart();
    player.teleport(px, ground.heightAt(px, pz), pz, s.facing);
    void audio.start();
    touch?.enterImmersive();
    play();
    await missions.begin(0);
  };

  const continueStory = async () => {
    if (!profile.current && profile.story === SUNRISE) {
      // Saved during the long wait: roam again until the Exam Section.
      void audio.start();
      touch?.enterImmersive();
      play();
      setSky(SKIES.night);
      startLongWait();
    } else if (profile.current) await startMission(profile.current.mission, profile.current.step);
    else if (profile.story < MISSIONS.length) await startMission(profile.story);
    else {
      missions.stop();
      setSky(SKIES.dawn);
      void audio.start();
      play();
    }
  };

  const continueLabel = (): string | null => {
    if (profile.current) return `Mission ${profile.current.mission + 1} · ${MISSIONS[profile.current.mission].title}`;
    if (profile.story > 0 && profile.story < MISSIONS.length) return `Mission ${profile.story + 1} · ${MISSIONS[profile.story].title}`;
    if (profile.story >= MISSIONS.length) return 'Free roam';
    return null;
  };

  let dailyText: string | null = null;
  const daily = claimDaily(profile);
  refreshGoals(profile);
  announceBadges();
  if (daily) {
    saveProfile(profile);
    dailyText = `☕ Chiya streak: day ${daily.streak} — +${daily.coins}◈${daily.streak < 7 ? ` (day ${daily.streak + 1}: +${50 + Math.min(daily.streak, 6) * 25}◈)` : ''}`;
  }

  const toTitle = () => {
    if (started && missions.def) saveProfile(profile);
    state = 'title';
    ui.showHud(false);
    touch?.setVisible(false);
    input.exitPointerLock();
    setSky(AFTERNOON);
    const lv = levelOf(profile.xp);
    const fresh = profile.story === 0 && !profile.current && profile.coins === 0;
    ui.title({
      continueLabel: continueLabel(),
      onContinue: () => void continueStory(),
      onNew: () => void newStory(),
      onMissions: () => openMissions(() => toTitle()),
      onGarage: missions.kartAllowed() ? () => openGarage(() => toTitle()) : null,
      onProgress: () => openProgress(() => toTitle()),
      profileLine: fresh ? '' : `Lv ${lv.level} · ${titleFor(lv.level)} · ◈ ${profile.coins.toLocaleString()} · ★ ${totalStars()}`,
      daily: dailyText,
      goals: goalViews(profile),
      badges: `${profile.badges.length} / ${badgeViews(profile).length}`,
      player: STORY_VERSION === 2
        ? { line: ui.dialogue.fill(V2_TEXT.screens.nameMenu), onEdit: () => void askName(false).then(toTitle) }
        : null,
    });
    dailyText = null;
  };

  const openProgress = (onClose: () => void) => {
    const prev = state;
    state = 'menu';
    const clockText = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m` : `${Math.floor(s / 60)} m`);
    const st = profile.stats;
    ui.progress({
      goals: goalViews(profile),
      badges: badgeViews(profile),
      stats: [
        { label: 'missions run', value: String(st.missions) },
        { label: 'played', value: clockText(st.seconds) },
        { label: 'answers right', value: `${st.correct} / ${st.answered}` },
        { label: 'mini-turbos', value: String(st.turbos) },
        { label: 'best combo', value: `×${st.bestCombo}` },
        { label: 'close calls', value: String(st.closeCalls) },
        { label: 'time trial', value: profile.trialBest ? `${profile.trialBest.toFixed(1)} s` : '—' },
        { label: 'memory shards', value: `${profile.shards.length} / ${extras.total}` },
      ],
    }, () => {
      state = prev === 'menu' ? 'title' : prev;
      onClose();
    });
  };

  const openMissions = (onClose: () => void) => {
    const prev = state;
    state = 'menu';
    const list: MissionCard[] = MISSIONS.map((m, i) => ({
      number: i + 1, title: m.title, brief: m.brief, clock: m.clock, stars: profile.stars[m.id] ?? 0, best: profile.best[m.id] ?? null,
      state: i < profile.story ? 'done' : i === profile.story ? 'next' : 'locked',
    }));
    ui.missions(list, {
      totalStars: totalStars(),
      onPick: (i) => void startMission(i, 0, i < profile.story),
      onClose: () => {
        state = prev === 'menu' ? 'title' : prev;
        onClose();
      },
    });
  };

  const garageState = (): GarageState => ({
    coins: profile.coins,
    upgrades: (['engine', 'grip', 'boost'] as const).map((key) => {
      const level = profile.upgrades[key];
      return {
        key, level, max: MAX_UPGRADE,
        name: key === 'engine' ? 'Engine — top speed and pull' : key === 'grip' ? 'Tyres — grip in corners' : 'Boost — longer boost',
        cost: level >= MAX_UPGRADE ? null : UPGRADE_COST[level],
        locked: key === 'boost' && !has(profile, 'boost') ? 'Unlocks in Mission 3' : null,
      };
    }),
    paints: Object.entries(PAINTS).map(([id, p]) => ({
      id, name: p.name, body: p.body, trim: p.trim, price: p.price, owned: profile.paints.includes(id), current: profile.paint === id,
      locked: p.price === 0 && !profile.paints.includes(id) ? 'Story reward' : null,
    })),
  });

  const openGarage = (onClose: () => void) => {
    const prev = state;
    state = 'menu';
    ui.garage({
      state: garageState,
      onUpgrade: (k) => {
        const lvl = profile.upgrades[k];
        const cost = UPGRADE_COST[lvl];
        if (lvl >= MAX_UPGRADE || cost > profile.coins) return;
        profile.coins -= cost;
        profile.upgrades[k] = lvl + 1;
        kart.setUpgrades(profile.upgrades);
        saveProfile(profile);
      },
      onPaint: (id) => {
        const p = PAINTS[id];
        if (!profile.paints.includes(id)) {
          if (p.price === 0 || p.price > profile.coins) return;
          profile.coins -= p.price;
          profile.paints.push(id);
        }
        profile.paint = id;
        kart.setPaint(id);
        saveProfile(profile);
      },
      onClose: () => {
        state = prev === 'menu' ? 'title' : prev;
        missions.refreshHud();
        onClose();
      },
    });
  };

  const openRadioLog = (onClose: () => void) => {
    const prev = state;
    state = 'menu';
    const t = V2_TEXT.clueUi;
    ui.radioLog(profile.radioLog, () => {
      state = prev === 'menu' ? 'title' : prev;
      onClose();
    }, STORY_VERSION === 2 ? {
      label: t.pin,
      done: t.pinned,
      // Pinning a line to the board: only a line that proves something becomes a clue (c2).
      onPin: (e) => {
        if (!has(profile, 'board')) return t.pinLocked;
        if (!e.clue) return t.pinNothing;
        e.pinned = true;
        clueBook?.find(e.clue as 'c2', 'gold');
        saveProfile(profile);
        return clueBook?.def(e.clue)?.title ?? '';
      },
    } : undefined);
  };

  /** The evidence board, read-only. */
  const openBoardView = () => openBoard(ui, {
    clues: CLUES,
    state: (id) => profile.clues[id] ?? null,
    name: (id) => NPCS.find((n) => n.id === id)?.name ?? id,
    portrait: (id) => portraits.get(id),
    text: V2_TEXT.clueUi,
    sound: (n) => audio.play(n),
    mode: 'view',
  });
  const openBoardMenu = (onClose: () => void) => {
    const prev = state;
    state = 'menu';
    void openBoardView().then(() => {
      state = prev === 'menu' ? 'title' : prev;
      onClose();
    });
  };

  // ------------------------------------------------------------------ interludes and mini-games (story 2)
  const voiceOf = (id: string) => VOICES[id] ?? NPCS.find((n) => n.id === id) ?? { name: id, role: '' };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  /** Today's Bug Hunt snippet: the same for everyone on the same day. */
  const dailySnippet = () => {
    const d = new Date();
    return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000) % BUG_SNIPPETS.length;
  };
  const miniFor = (d: InterludeDef): MiniGame | null => {
    const m = V2_TEXT.mini;
    switch (d.game) {
      case 'tuner': return signalTuner(false, m.tuner);
      case 'tunerJammed': return signalTuner(true, m.tuner);
      case 'chiya': return chiyaRush(m.chiya);
      case 'pong': return tableTennis(m.pong);
      case 'bubble': return bubbleLevel(3, m.bubble);
      case 'generator': return generatorPull(m.generator);
      case 'bughunt': {
        const daily = profile.bugDay !== today();
        return bugHunt(BUG_SNIPPETS[daily ? dailySnippet() : Math.floor(Math.random() * BUG_SNIPPETS.length)], m.bug);
      }
      default: return null;
    }
  };
  /**
   * An interlude: location card, a few lines, the game, the outcome (decision 17). `menu`: a
   * replay from the pause menu (no location card, no skip question, no scout drone).
   */
  const playInterlude = async (d: InterludeDef, menu: boolean): Promise<void> => {
    const t = V2_TEXT.interlude;
    const v = voiceOf(d.from);
    if (!menu) {
      locCard.show(d.clock, d.place);
      if (profile.played[d.id] && (await decide(ui, { title: d.title, question: t.again, options: [t.play, t.skip] })) === 1) return;
    }
    audio.play('radioBeep');
    await ui.dialog(v.name, v.role, d.intro, d.from);
    const daily = d.game === 'bughunt' && profile.bugDay !== today();
    if (d.game === 'bughunt') ui.toast(daily ? t.dailyNew.replace('{n}', String(d.reward.coins)) : t.dailyDone);
    let ok = true;
    // Mini-games are optional: every one can be skipped (decision 44).
    if (d.game !== 'garage') offerSkip(V2_TEXT.easy.skipMini);
    if (d.game === 'garage') await new Promise<void>((res) => openGarage(res));
    else if (d.game === 'hack') ok = await runPuzzle(ui, { type: 'simon', title: d.title, clue: d.clue, length: 5 }, '');
    else {
      const game = miniFor(d);
      if (game) ok = (await runMini(ui, d.title, d.clue, '', game)).ok;
    }
    // Coins for the first win of each game, and for each day's Bug Hunt.
    const firstWin = ok && (profile.played[d.id] ?? 0) < 2 && d.game !== 'bughunt';
    profile.played[d.id] = Math.max(profile.played[d.id] ?? 0, ok ? 2 : 1);
    if (ok) {
      if ((firstWin || daily) && d.reward.coins) {
        profile.coins += d.reward.coins;
        ui.toast(`${d.title} ${t.reward.replace('{n}', String(d.reward.coins))}`, 'good');
      }
      if (daily) profile.bugDay = today();
      if (d.reward.clue && profile.clues[d.reward.clue] !== 'gold') clueBook?.find(d.reward.clue, 'gold');
      if (d.reward.scout && !menu) profile.scout = profile.story;
      if (d.reward.boostCharge) {
        profile.boostCharges = 1;
        ui.toast(t.boost, 'good');
      }
    }
    saveProfile(profile);
    missions.refreshHud();
    await ui.dialog(v.name, v.role, ok ? d.win : d.lose, d.from);
  };
  /** Pause → Mini-games: every game played so far, plus Bug Hunt. */
  const openMinisMenu = async (onClose: () => void) => {
    const prev = state;
    state = 'menu';
    audio.suspend(false);
    const t = V2_TEXT.interlude;
    const list = INTERLUDES.filter((d) => d.game !== 'garage' && (d.after === null || profile.played[d.id]));
    const i = await decide(ui, { title: t.menuTitle, question: t.menuSub, options: [...list.map((d) => d.title), t.back] });
    if (i < list.length) await playInterlude(list[i], true);
    state = prev === 'menu' ? 'title' : prev;
    onClose();
  };

  // ------------------------------------------------------------------ campus screens (story 2)
  /** A cutscene can switch the screens before the story does (C3). */
  let screensForced: 'intruder' | 'reopened' | 'hero' | 'off' | null = null;
  const screens = STORY_VERSION === 2
    ? new CampusScreens(([
        { building: 'Research and Innovation Centre (RIC)', beside: -6 },
        { point: 'Administration Block' },
        { point: 'Cafeteria', outside: 'wall', beside: -4 },
        { building: 'Power House', beside: -5 },
      ] as Where[]).map((w) => {
        const s = missions.resolve(w, 'screen');
        return { x: s.x, y: ground.heightAt(s.x, s.z), z: s.z, facing: s.facing };
      }))
    : null;
  if (screens) scene.add(screens.group);
  const updateScreens = () => {
    if (!screens) return;
    const s = profile.story;
    const mode = screensForced ?? (s >= 10 ? 'hero' : s >= 9 ? 'reopened' : s >= 3 ? 'intruder' : 'off');
    const t = V2_TEXT.clueUi;
    const label = mode === 'hero' ? t.screenHero : mode === 'reopened' ? t.screenReopened : t.screenIntruder;
    screens.show(mode, portraits.canvas('player'), profile.name || 'Student', profile.roll, label);
  };

  const openPause = () => {
    if (state !== 'play' || ui.modal || cutscenes.playing) return;
    state = 'pause';
    touch?.setVisible(false);
    audio.suspend(true);
    const back = () => {
      state = 'play';
      openPause2();
    };
    ui.pause({
      onResume: play,
      onMap: () => openMap(),
      onGarage: missions.kartAllowed() ? () => openGarage(back) : null,
      onMissions: () => openMissions(back),
      onProgress: () => openProgress(back),
      onRadioLog: () => openRadioLog(back),
      onBoard: STORY_VERSION === 2 && has(profile, 'board') ? () => openBoardMenu(back) : null,
      boardLabel: V2_TEXT.clueUi.boardTitle,
      onMinis: STORY_VERSION === 2 ? () => void openMinisMenu(back) : null,
      minisLabel: V2_TEXT.interlude.menu,
      onRestart: missions.def ? () => void missions.restart().then(play) : null,
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
    const f = focus();
    const tg = missions.targets(kart.position);
    ui.bigMap(f.x, f.z, extras.trialTarget() ?? tg.main, tg.extra, () => (from === 'pause' ? openPause2() : play()), mode === 'foot' && missions.kartAllowed() ? { x: kart.position.x, z: kart.position.z } : null);
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

  // Shader warm-up: everything that only shows up later (rain, sparks, fireflies, mission
  // props, drones, rings, hidden interiors) is compiled now, behind the loading screen, so
  // nothing stalls the first time it appears in play.
  progress(0.97, 'Warming up the shaders');
  portraits.makeAll([...NPCS, { id: 'player', make: () => createPlayerHumanoid(PLAYER_SUIT), keep: true }]);
  updateScreens();
  {
    const warm = new THREE.Group();
    const kinds: ItemModel[] = ['book', 'cube', 'breaker', 'usb', 'toolbox', 'gnss', 'torch', 'sandbag', 'evidence', 'module', 'part', 'panel', 'relay'];
    warm.add(...(await Promise.all(kinds.map((k) => itemModel(k)))), coinModel(), shardModel());
    const drone = new Drone(3);
    warm.add(drone.obj, drone.light, new CheckRing(0, 0, 0, 0).obj);
    warm.position.copy(camera.position);
    scene.add(warm);
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      await renderer.compileAsync(scene, camera);
    } catch {
      renderer.compile(scene, camera);
    }
    for (const o of hidden) o.visible = false;
    scene.remove(warm);
  }
  // ------------------------------------------------------------------ name entry and the fest demo
  const askName = async (first: boolean) => {
    const r = await nameEntry(ui, V2_TEXT.screens, { name: profile.name, roll: profile.roll, first, onTap: () => void audio.start() });
    if (r) {
      profile.name = r.name;
      profile.roll = r.roll;
      saveProfile(profile);
    }
  };
  /** Demo: a new player. Name entry, then C1 and mission 1. */
  const demoLoop = async () => {
    state = 'title';
    missions.stop();
    if (mode === 'kart') exitKart();
    ui.showHud(false);
    touch?.setVisible(false);
    input.exitPointerLock();
    resetForDemo(profile);
    setSky(AFTERNOON, true);
    await askName(true);
    await newStory();
  };
  /** Demo: mission 1 is done. Its time goes on the board; after 30 s idle the next player gets the name screen. */
  const demoFinish = async (seconds: number) => {
    cinema.release();
    missions.stop();
    state = 'menu';
    ui.showHud(false);
    touch?.setVisible(false);
    input.exitPointerLock();
    const at = addToBoard({ name: profile.name, roll: profile.roll, time: seconds });
    await leaderboard(ui, V2_TEXT.screens, { highlight: at, yourTime: seconds, idleMs: 30000 });
    void demoLoop();
  };

  void loading.done();
  if (DEMO_MODE) void demoLoop();
  else if (STORY_VERSION === 2 && !profile.name) void askName(true).then(toTitle);
  else toTitle();

  // ------------------------------------------------------------------ debug panel (?debug=1 only)
  let debugWeather: 'clear' | 'drizzle' | 'storm' | null = null;
  const debug = DEBUG_MODE
    ? new DebugPanel(uiRoot, {
        missions: MISSIONS.map((m) => m.title),
        interludes: INTERLUDES.map((d) => d.title),
        jump: (i) => {
          ui.close();
          if (cutscenes.playing) cutscenes.skip();
          // Everything before the mission counts as played, so its unlocks and the story state match.
          if (profile.story < i) profile.story = i;
          for (let k = 0; k < i; k += 1) {
            const rw = MISSIONS[k].reward;
            for (const u of [...(rw.unlock ? [rw.unlock] : []), ...(rw.unlocks ?? [])]) if (!profile.unlocks.includes(u)) profile.unlocks.push(u);
          }
          kart.boostUnlocked = has(profile, 'boost');
          powerShown = powerTo = powerFor();
          tarp.clear();
          void startMission(i, 0, false);
        },
        interlude: (i) => {
          ui.close();
          if (cutscenes.playing) cutscenes.skip();
          void playInterlude(INTERLUDES[i], true);
        },
        clues: (kind) => {
          for (const c of CLUES) {
            if (kind === 'clear') delete profile.clues[c.id];
            else profile.clues[c.id] = kind;
          }
          saveProfile(profile);
        },
        minutes: (n) => {
          profile.minutes = Math.max(0, Math.round(n));
          saveProfile(profile);
        },
        weather: (w) => (debugWeather = w === 'auto' ? null : w),
        sky: (s) => setSky(s === 'auto' ? SKIES[missions.def?.sky ?? 'dusk'] : SKIES[s], true),
        skipCutscene: () => cutscenes.skip(),
        stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, mission: missions.def ? `${missions.index + 1}/${MISSION_COUNT} step ${missions.step + 1}` : 'free roam' }),
      })
    : null;
  (window as unknown as { __campus: unknown }).__campus = { storyVersion: STORY_VERSION, missionCount: MISSIONS.length, clues: clueBook, board: () => openBoardView(), cutscenes, tarp, cinema, missions, extras, fireflies, sound, audio, profile, player, kart, input, ui, world, ground, scene, camera, renderer, enterKart, exitKart, get mode() { return mode; } };

  let last = performance.now();
  let acc = 0;
  let time = 0;
  let titleT = 0;
  // Adaptive resolution: every 1.5 s, drop the render scale if frames averaged slower than ~38 fps; raise it again
  // after three windows near 60 fps. Long gaps (tab hidden, a dialog) are not counted.
  let winT = 0;
  let winN = 0;
  let good = 0;
  const adapt = (ms: number) => {
    if (ms > 250) return;
    winT += ms;
    winN += 1;
    if (winT < 1500) return;
    const avg = winT / winN;
    winT = 0;
    winN = 0;
    if (avg > 26 && resScale > 0.55) {
      resScale = Math.max(0.55, resScale * 0.85);
      good = 0;
      resize();
    } else if (avg < 18.5 && resScale < 1 && ++good >= 3) {
      resScale = Math.min(1, resScale * 1.1);
      good = 0;
      resize();
    } else if (avg >= 18.5) good = 0;
  };
  const kartHint = () => `${kart.boostUnlocked ? '<kbd>Shift</kbd> boost · ' : ''}<kbd>Space</kbd>+turn drift · <kbd>E</kbd> out${kart.vehicle.needsRecovery ? ' · <kbd>Hold R</kbd> flip' : ''}`;

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    adapt(now - last);
    const rdt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.1);
    last = now;
    // Slow motion for big moments (eases back in over its last part); a hit-stop freezes time briefly.
    slow = Math.max(0, slow - rdt);
    freeze = Math.max(0, freeze - rdt);
    const dt = freeze > 0 ? 0 : rdt * (slow > 0 ? THREE.MathUtils.lerp(1, 0.3, Math.min(1, slow / 0.25)) : 1) * cutscenes.timeScale;
    if (cinema.playingShots && state === 'play' && (input.pressed('interact') || input.pressed('jump'))) cinema.skip();
    // A cutscene locks input: nothing below reads the controls while one plays.
    const playing = state === 'play' && !ui.modal && !cinema.playingShots && !cutscenes.playing;
    if (ui.modal && !wasModal && state === 'play') input.exitPointerLock();
    if (!ui.modal && wasModal && state === 'play') lockOrPrompt();
    wasModal = ui.modal;
    summonCooldown = Math.max(0, summonCooldown - dt);
    kart.locked = !missions.kartAllowed();

    // Sky blend (missions change the time of day), then the image-based light once settled.
    if (skyT < 1) {
      skyT = Math.min(1, skyT + rdt / skyDur);
      atmosphere.blend(skyFrom, skyTo, THREE.MathUtils.smoothstep(skyT, 0, 1), scene);
      const dark = (s: AtmosphereState) => s === SKIES.night || s === SKIES.predawn;
      atmosphere.skyUniforms.uSunVisible.value = dark(skyTo) ? (dark(skyFrom) ? 0 : 1 - skyT) : dark(skyFrom) ? skyT : 1;
      renderer.toneMappingExposure = atmosphere.state.exposure;
      if (skyT >= 1) {
        atmosphere.buildEnvironment(renderer, scene);
        atmosphere.apply(scene);
        if (mode === 'kart') kart.vehicle.setLights(night || skyTo === SKIES.dusk);
      }
    }

    let exitPressed = false;
    let look = { x: 0, y: 0 };
    if (playing) {
      time += dt;
      look = input.consumeLook();
      if (mode === 'foot') {
        player.look(look.x, look.y);
        if (input.pressed('jump')) player.requestJump();
        if (input.pressed('KeyK')) summonKart();
      } else {
        const { exitRequested } = kart.handleInput(input, dt);
        exitPressed = exitRequested;
      }
      if (input.pressed('map')) openMap();
      if (input.pressed('KeyG') && missions.kartAllowed() && (mode === 'foot' || Math.abs(kart.vehicle.phys.speed) < 1)) {
        state = 'menu';
        input.exitPointerLock();
        openGarage(play);
      }
      // Esc is handled through the pointer-lock release; P pauses directly.
      if (input.pressed('KeyP')) openPause();
      acc += dt;
      let steps = 0;
      while (acc >= FIXED_DT && steps < 6) {
        player.update(FIXED_DT, input);
        kart.fixedUpdate(FIXED_DT);
        physics.step();
        acc -= FIXED_DT;
        steps += 1;
      }
      if (steps === 6) acc = 0;
      kart.postPhysics();
      physics.eventQueue.drainContactForceEvents((e) => {
        const f = e.totalForceMagnitude();
        if (f > 2500) {
          const k = Math.min(1, f / 15000);
          audio.impact(k, kart.position);
          kart.vehicle.shake = Math.max(kart.vehicle.shake, k);
        }
      });
    } else {
      input.consumeLook();
      if (!kart.occupied) kart.vehicle.phys.input = { throttle: 0, steer: 0, handbrake: true };
    }
    const alpha = acc / FIXED_DT;
    const adt = state === 'play' ? dt : 0;
    kart.update(adt, alpha, time);
    if (mode === 'kart') kart.seatDriver(player, adt || 1e-3);
    else player.animate(adt, alpha, null);

    if (state === 'title') {
      // Slow drift over the campus with the Annapurnas behind.
      titleT += dt;
      const t = titleT * 0.03;
      const cx = 60 + Math.sin(t) * 150;
      const cz = 160 + Math.cos(t) * 60;
      camera.position.set(cx, ground.heightAt(cx, cz) + 42, cz);
      camera.lookAt(60, 10, -120);
    } else if (mode === 'kart') {
      if (playing) {
        kart.vehicle.updateCamera(camera, dt, look, settings.mouseSensitivity);
        // A little speed: wider view as Kalki goes faster, more when boosting.
        const want = settings.fov + Math.min(10, kart.speedKmh * 0.12) + (kart.boosting || kart.turbo > 0 ? 9 : 0);
        camera.fov = THREE.MathUtils.damp(camera.fov, want, 4, dt);
        camera.updateProjectionMatrix();
      }
    } else {
      player.applyCamera(camera, dt);
    }
    // Cinematic cameras (intros, conversations, victory orbit) take over when running.
    cinema.update(rdt, camera);
    cutscenes.update(rdt, camera);
    // The main gate's leaves swing toward where a cutscene (or the story) wants them.
    if (gateOpen !== gateTo) {
      const step = rdt * gateRate;
      gateOpen += THREE.MathUtils.clamp(gateTo - gateOpen, -step, step);
      world.gate.setOpen(gateOpen);
    }
    debug?.frame(now);
    document.body.classList.toggle('cq-cinematic', cinema.active || cutscenes.playing);
    tarp.update(rdt);
    mud.update(rdt);
    bike.update(dt);
    // C8: the clock spinning through the night.
    if (clockT >= 0) {
      clockT += rdt;
      const f = Math.min(1, clockT / clockOver);
      const m = Math.round(clockFrom + (clockTo - clockFrom) * f * f * (3 - 2 * f)) % (24 * 60);
      if (m !== clockShown) {
        clockShown = m;
        const h = Math.floor(m / 60);
        clockH.textContent = HOURS[h % 12];
        clockM.textContent = MINS[m % 60];
        clockAp.textContent = h < 12 ? 'AM' : 'PM';
      }
      if (clockT > clockOver + 1.5) {
        clockT = -1;
        clockEl.classList.remove('on');
      }
    }
    // The drone cutting the Power House door: sparks from the tip of the cut.
    if (doorCut.obj.visible && Math.random() < 0.7) {
      sv.set((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3);
      sparks.emit(doorCut.tip, sv, GOLD, 0.35 + Math.random() * 0.3, 9);
      if (Math.random() < 0.08) audio.play('cutting', doorCut.tip);
    }
    // "Look closer": keep the hotspot over the person's chest.
    if (lookAt) {
      lookV.set(lookAt.pos.x, lookAt.pos.y + 1.25, lookAt.pos.z).project(camera);
      lookEl.style.transform = `translate(${((lookV.x + 1) / 2) * window.innerWidth}px, ${((1 - lookV.y) / 2) * window.innerHeight}px)`;
    }
    // The sunrise clock (story 2): story time and minutes to spare, redrawn when either changes.
    if (STORY_VERSION === 2 && state === 'play') {
      const d = missions.def;
      const storyMin = d ? clockMinutes(d.clock) + Math.floor(missions.seconds / 6) : -1;
      if (storyMin !== shownStoryMin || profile.minutes !== shownMinutes) {
        shownStoryMin = storyMin;
        shownMinutes = profile.minutes;
        ui.setSunrise(d ? `${clockString(storyMin)} · ${V2_TEXT.clueUi.clock.replace('{min}', String(profile.minutes))}` : null, profile.minutes < 10);
      }
    }
    droneEyes.update(rdt, now / 1000);

    // ---------------------------------------------------------------- effects
    if (mode === 'kart' && playing) {
      const sp = Math.abs(kart.vehicle.phys.speed);
      const back = kart.backward();
      const contacts = kart.rearContacts();
      const lvl = kart.driftLevel;
      if (lvl > lastDrift) audio.play('driftCharge');
      lastDrift = lvl;
      if (kart.driftDir) {
        const colour = new THREE.Color(lvl >= 3 ? '#ff4ad8' : lvl >= 2 ? '#ff9a3c' : lvl >= 1 ? '#38c8ff' : '#fff2c0');
        for (const c of contacts) {
          if (Math.random() < (lvl ? 0.9 : 0.35)) sparks.emit(c, new THREE.Vector3(back.x * 3 + (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, back.z * 3 + (Math.random() - 0.5) * 3), colour, 0.35 + Math.random() * 0.25);
        }
      }
      for (const c of contacts) if (!kart.airborne) dust.emit(dt, c, back, sp * (kart.driftDir ? 1.6 : 1), kart.driftDir ? 'gravel' : kart.vehicle.phys.wheelSurface[2]);
      if (kart.boosting || kart.turbo > 0) {
        const ex = kart.vehicle.localToWorld(kart.parts.anchors.exhaust);
        sparks.emit(ex, back.clone().multiplyScalar(4).setY(0.6), new THREE.Color(kart.turbo > 0 ? '#9fe7ff' : '#ffb44a'), 0.3, 1);
      }
      ui.setSpeedLines(kart.boosting || kart.turbo > 0 ? 0.9 : THREE.MathUtils.clamp((kart.speedKmh - 48) / 40, 0, 0.35));
    } else {
      lastDrift = 0;
      ui.setSpeedLines(0);
    }
    sparks.update(dt);
    dust.update(dt);
    // Weather: the monsoon storm through the middle of the night, lightning and thunder with it.
    const weather = debugWeather ?? (state === 'title' ? 'clear' : missions.def ? WEATHER[missions.def.id] ?? 'clear' : 'clear');
    rain.level = weather === 'storm' ? 1 : weather === 'drizzle' ? 0.35 : 0;
    // A fading-clue step turns the drizzle into a downpour as it runs.
    if (missions.rainBoost > 0) rain.level = Math.max(rain.level, 0.35 + 0.65 * missions.rainBoost);
    // A cutscene easing the rain away (C8).
    if (rainCut >= 0) {
      rainCut += THREE.MathUtils.clamp(rainCutTo - rainCut, -rdt * rainCutRate, rdt * rainCutRate);
      rain.level = rainCut;
    }
    lightning.enabled = weather === 'storm' && !cinema.playingShots;
    rain.update(rdt, camera.position);
    sound.setRain(rain.level, rdt);
    const flash = lightning.update(rdt);
    ui.setFlash(flash);
    // Wet ground follows the rain slowly (it takes a while to dry).
    wet += (rain.level - wet) * Math.min(1, rdt * (rain.level > wet ? 0.35 : 0.08));
    world.setWet(wet);
    // Night lighting: how dark it is, and campus power easing up to the story's level.
    const dark = THREE.MathUtils.clamp((3.05 - atmosphere.state.sunIntensity) / 1.7, 0, 1);
    const powerStep = rdt * powerRate;
    powerShown += THREE.MathUtils.clamp(powerTo - powerShown, -powerStep, powerStep);
    world.setLights(state === 'title' ? 0 : powerShown, Math.max(dark, glowMin));
    // Sound follows the same night: birds by day, crickets, frogs and dogs after dark.
    audio.dusk = dark;
    audio.wet = wet;
    sound.updateAmbience(rdt, state === 'title' ? 0 : dark, rain.level, wet, state === 'play');
    fireflies.amount = state === 'play' && weather !== 'storm' ? THREE.MathUtils.clamp((dark - 0.6) * 2.5, 0, 1) * (weather === 'drizzle' ? 0.4 : 1) : 0;
    fireflies.update(rdt, time, focus(), renderer.getPixelRatio());
    if (skyT >= 1) renderer.toneMappingExposure = atmosphere.state.exposure + flash * 1.2;
    if (fireworks > 0) {
      fireworks -= rdt;
      if (Math.random() < rdt * 2.8) {
        const p = fireworkAt.clone().add(new THREE.Vector3((Math.random() - 0.5) * 40, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 40));
        sparks.burst(p, FIRE[Math.floor(Math.random() * FIRE.length)]);
        audio.impact(0.2, p);
      }
    }

    for (const p of people) p.update(state === 'title' ? dt : adt, camera.position, state === 'play' ? focus() : null);

    // Missions take E first; otherwise E gets in / out of Kalki.
    const f = focus();
    const interact = playing && input.pressed('interact');
    missions.update(adt, playing, f, interact && mode === 'foot', mode === 'foot' ? kart.position : null, playing && mode === 'foot' && input.held('interact'));
    // Story 2: the long wait after mission 9, the shard riddles, and the stored boost charge.
    if (longWait && playing && missions.index < 0) {
      if (Math.hypot(f.x - exam.x, f.z - exam.z) < 8) {
        longWait = false;
        missions.roamGoal = null;
        void startMission(SUNRISE);
      } else if (!profile.clues.c13 && mode === 'foot' && !missions.promptText && !ui.modal && !gossiping) {
        // Decision 18: Krishna Dai repeats the gossip if the player never won Chiya Rush.
        const k = missions.npcSpot('krishna');
        if (k && Math.hypot(f.x - k.pos.x, f.z - k.pos.z) < 3) {
          ui.setPrompt(V2_TEXT.longWait.krishnaPrompt);
          if (interact) {
            gossiping = true;
            const v = voiceOf('krishna');
            void ui.dialog(v.name, v.role, V2_TEXT.longWait.krishna, 'krishna').then(() => {
              clueBook?.find('c13', 'gold');
              gossiping = false;
            });
          }
        }
      }
    }
    riddles?.update(playing, !!missions.def, f, mode === 'kart');
    if (mode === 'kart' && profile.boostCharges > 0 && kart.boostUnlocked && kart.boost <= 0.02) {
      kart.boost = 1;
      profile.boostCharges -= 1;
      saveProfile(profile);
      ui.toast(V2_TEXT.interlude.boostUsed, 'good');
      audio.play('boost');
    }
    const busyTrial = !!missions.stepDef && (missions.stepDef.kind === 'drive' || missions.stepDef.kind === 'chase');
    extras.update(adt, playing, f, mode === 'kart', busyTrial);
    if (playing && mode === 'foot' && !missions.promptText) {
      const door = kart.vehicle.driverDoorWorld();
      const near = Math.hypot(door.x - player.renderPos.x, door.z - player.renderPos.z) < 2.4 || kart.position.distanceTo(player.renderPos) < 2.2;
      if (near) {
        if (kart.locked) ui.setPrompt('Kalki is locked — Dhungana sir has the key');
        else {
          ui.setPrompt('Get in Kalki');
          if (interact) enterKart();
        }
      }
    }
    if (mode === 'kart') {
      ui.setPrompt(null);
      if (exitPressed) {
        if (Math.abs(kart.vehicle.phys.speed) < 3) exitKart();
        else ui.toast('Slow down to get out');
      }
    }

    if (state === 'play') {
      // Compass heading, degrees clockwise from north (-Z).
      const dir = camera.getWorldDirection(new THREE.Vector3());
      const heading = mode === 'kart' ? ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360 : (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
      const tg = missions.targets(kart.position);
      const trial = extras.trialTarget();
      ui.updateNav(f.x, f.z, heading, trial ?? tg.main, trial ? [] : tg.extra, extras.nearShards(f.x, f.z), mode === 'foot' && missions.kartAllowed() ? { x: kart.position.x, z: kart.position.z } : null);
      ui.setCallKart(playing && mode === 'foot' && missions.kartAllowed() && kart.position.distanceTo(player.renderPos) > 15);
      ui.setSpeed(mode === 'kart' ? { kmh: kart.speedKmh, boost: kart.boost, boostOn: kart.boostUnlocked, boosting: kart.boosting || kart.turbo > 0, hint: kartHint(), drift: kart.driftDir ? kart.driftT : 0, driftLevel: kart.driftLevel } : null);
      touch?.update({
        mode: mode === 'kart' ? 'vehicle' : 'foot',
        prompt: missions.promptText ? { text: missions.promptText, progress: 0 } : null,
        radio: null, armed: false, drawn: false, needsRecovery: mode === 'kart' && kart.vehicle.needsRecovery, flashlight: false, lights: kart.vehicle.lightsOn,
        boost: kart.boostUnlocked,
      });
    }
    const ph = kart.vehicle.phys;
    // Messages, puzzles and cutscenes: the engine and the background noise step back.
    audio.duck(!!ui.modal || cutscenes.playing);
    sound.updateKart({
      on: ph.engineOn && mode === 'kart', speed: ph.speed, throttle: state === 'play' ? Math.abs(ph.input.throttle) : 0,
      drift: kart.driftDir ? 1 : 0, airborne: kart.airborne, boosting: kart.boosting || kart.turbo > 0,
      surface: ph.wheelSurface[2], pos: kart.position,
    }, rdt);
    world.update(time, camera);
    atmosphere.update(dt, focus(), camera);
    windUniforms.uTime.value = time + titleT;
    windUniforms.uGust.value = 0.45 + 0.35 * Math.sin(time * 0.21) * Math.sin(time * 0.077 + 1.3);
    windUniforms.uSunTrans.value.copy(atmosphere.sun.color).multiplyScalar(atmosphere.sun.intensity * 0.4);
    windUniforms.uSkyTrans.value.copy(atmosphere.state.horizon).multiplyScalar(atmosphere.state.envIntensity);
    audio.update(dt, camera, windUniforms.uGust.value, 0.25, []);
    // Camera punch on big moments: applied for this render only, so no camera rig sees it.
    punch = Math.max(0, punch - rdt * 4);
    const fov0 = camera.fov;
    if (punch > 0) {
      camera.fov = fov0 - punch * punch * 4;
      camera.updateProjectionMatrix();
    }
    // Camera shake, also for this render only.
    if (shakeT > 0) {
      shakeT = Math.max(0, shakeT - rdt);
      const k = shakeAmp * (shakeT / shakeLen) * 0.25;
      shakeOff.set(Math.sin(now * 0.071) * k, Math.sin(now * 0.093 + 1.3) * k, Math.sin(now * 0.057 + 2.1) * k);
      camera.position.add(shakeOff);
    }
    renderer.render(scene, camera);
    if (shakeT > 0 || shakeOff.x !== 0) {
      camera.position.sub(shakeOff);
      if (shakeT === 0) shakeOff.set(0, 0, 0);
    }
    if (punch > 0) {
      camera.fov = fov0;
      camera.updateProjectionMatrix();
    }
    input.endFrame();
  };
  requestAnimationFrame(loop);
  (window as unknown as { __ready: boolean }).__ready = true;
}

boot().catch((err: unknown) => {
  console.error(err);
  loading.fail(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
  (window as unknown as { __error: string }).__error = String(err);
});
