// Gameplay session: walking/driving modes, vehicles, interactions, structures,
// the mystery, audio, menus and saving.

import * as THREE from 'three';
import type { Game } from '../core/game.ts';
import { saveSettings, type Settings } from '../core/settings.ts';
import { SITES } from '../world/layout.ts';
import { Vehicle } from '../vehicles/vehicle.ts';
import { FOREST_4X4 } from '../vehicles/vehiclePhysics.ts';
import { FOREST_WAGON, buildVehicle } from '../vehicles/vehicleModel.ts';
import { placeModel } from '../render/models.ts';
import { Locals } from './locals.ts';
import { Interactions, type Interactable } from './interactions.ts';
import { Hud } from '../ui/hud.ts';
import { Screens } from '../ui/screens.ts';
import { buildStructures, type Structures } from '../world/structures.ts';
import { Mystery, type Flag } from './mystery.ts';
import { AudioEngine } from '../audio/audio.ts';
import { windUniforms } from '../render/foliageMaterial.ts';
import { TouchControls } from '../ui/touch.ts';
import { WheelSpray } from '../vehicles/spray.ts';
import { Combat } from '../weapons/combat.ts';
import { Effects } from '../weapons/effects.ts';
import { WeaponSystem, type SaveWeapons } from '../weapons/weaponSystem.ts';
import { AMMO_NAMES, WEAPONS, WEAPON_ORDER } from '../weapons/defs.ts';
import { rayCapsule, type Hittable, type PartHit } from '../weapons/combat.ts';
import { NpcManager, type Npc, type NpcWorld } from './npc.ts';
import { Missions, type MissionSave } from './missions.ts';
import { buildMissionSites } from '../world/missionSites.ts';

export type Mode = 'foot' | 'vehicle';

const SAVE_KEY = 'hollow-creek.save.v1';

interface SaveData {
  flags: Flag[];
  clues: string[];
  reveals: string[];
  player: [number, number, number, number];
  truck: [number, number, number, number];
  mode: Mode;
  playTime: number;
  km: number;
  weapons?: SaveWeapons;
  health?: number;
  missions?: unknown;
  /** Forest locals the ranger has already met. */
  locals?: string[];
}

export class Session {
  readonly game: Game;
  readonly hud: Hud;
  readonly screens: Screens;
  readonly interactions = new Interactions();
  readonly audio: AudioEngine;
  truck!: Vehicle;
  structures!: Structures;
  mystery!: Mystery;
  combat!: Combat;
  effects!: Effects;
  weapons!: WeaponSystem;
  npcs!: NpcManager;
  missions!: Missions;
  locals!: Locals;
  /** Player condition 0..100; regenerates after a few seconds without damage. */
  health = 100;
  /** Tests only: the player cannot be downed. */
  godMode = false;
  private barkT = 0;
  private downT = -1;
  /** Where the player wakes up after being downed (set by missions). */
  checkpoint: { pos: THREE.Vector3; yaw: number } | null = null;
  private sinceHurt = 99;
  onDowned: (() => void) | null = null;
  private invOpen = false;
  mode: Mode = 'foot';
  active: Vehicle | null = null;
  readonly listeners: { frame: ((dt: number) => void)[]; enter: ((v: Vehicle) => void)[]; exit: ((v: Vehicle) => void)[] } = { frame: [], enter: [], exit: [] };
  private fwd = new THREE.Vector3();
  private forcedPrompt: string | null = null;
  private playing = false;
  private saveTimer = 0;
  private playTime = 0;
  private km = 0;
  private lastTruckPos = new THREE.Vector3();
  private titleT = 0;
  private testMode: boolean;
  /** Tests: saving and loading enabled even under ?test. */
  private saveTest = false;
  compassHeading = 0;
  /** The one real point light, moved to the nearest active lamp each frame. */
  private touch: TouchControls | null = null;
  private spray = new WheelSpray();
  private poolLight = new THREE.PointLight(0xffd9a0, 0, 10, 1.6);
  /** Handheld flashlight: always in the scene, intensity 0 when off (constant light count). */
  private flashlight = new THREE.SpotLight(0xfff4e0, 0, 34, 0.42, 0.55, 1.5);
  private flashlightOn = false;
  private flashHintShown = false;
  private lamps: THREE.PointLight[] = [];

  constructor(game: Game, uiRoot: HTMLElement) {
    this.game = game;
    this.hud = new Hud(uiRoot);
    this.audio = new AudioEngine();
    this.testMode = new URLSearchParams(location.search).has('test');
    this.saveTest = new URLSearchParams(location.search).has('savetest');
    if (game.input.isTouch) {
      document.body.classList.add('is-touch');
      this.touch = new TouchControls(uiRoot, game.input, (w) => {
        if (this.playing && this.screens.current === 'none') this.openScreen(w);
      });
    }
    this.screens = new Screens(uiRoot, game.settings, {
      begin: () => this.begin(false),
      continueGame: null,
      resume: () => this.resume(),
      restart: () => {
        this.clearSave();
        location.reload();
      },
      quitToTitle: () => this.toTitle(),
      applySettings: (s, reload) => this.applySettings(s, reload),
      requestHint: () => this.mystery.requestHint(),
      journal: () => {
        const o = this.mystery.hudOverride?.() ?? this.mystery.currentObjective();
        const t = this.mystery.totalClues();
        return {
          objective: o.text, sub: o.sub, clues: this.mystery.clues,
          progress: `${t.found} of ${t.total} pieces of evidence found · ${this.missions?.completedCount ?? 0} of 8 missions complete`,
          missions: this.missions?.log(),
        };
      },
      onShow: (s) => this.missions?.screenOpened(s),
      mapState: () => {
        const p = this.focusPosition;
        const o = this.mystery.currentObjective();
        return {
          player: { x: p.x, z: p.z, heading: this.compassHeading },
          truck: { x: this.truck.position.x, z: this.truck.position.z },
          reveals: this.mystery.mapReveals,
          target: o.target ? { x: o.target.x, z: o.target.z } : null,
        };
      },
    });
  }

  async init(progress: (f: number, t: string) => void): Promise<void> {
    const g = this.game;
    progress(0.93, 'Fuelling the truck');
    const jerrycan = await placeModel('metal_jerrycan_green', { size: 0.47 });
    const parts = buildVehicle(FOREST_WAGON, { seed: 12, jerrycan, lightBar: true });
    const site = SITES.playerTruck;
    this.truck = new Vehicle(g.physics, g.terrain, FOREST_4X4, parts, site.x, site.z, site.heading, g.preset.headlightShadows);
    g.scene.add(this.truck.root);
    g.afterPhysics.push(() => this.truck.postPhysics());
    g.systems.push({
      fixedUpdate: (dt) => this.truck.fixedUpdate(dt),
      update: (_dt, alpha) => this.truck.update(_dt, alpha),
    });
    progress(0.95, 'Opening the ranger station');
    this.structures = await buildStructures(g.terrain, g.physics);
    g.scene.add(this.structures.group);
    this.lamps = [this.structures.station.lamp, this.structures.station.porchLamp, this.structures.cabin.glow];
    g.scene.add(this.poolLight);
    g.scene.add(this.flashlight, this.flashlight.target);
    g.scene.add(this.spray.points);
    this.screens.setTerrain(g.terrain);
    // Weapons, hit detection and firing effects.
    this.combat = new Combat(g.physics, g.terrain);
    this.effects = new Effects(g.terrain);
    g.scene.add(this.effects.group);
    this.effects.onCasingLand = (p) => this.audio.footstep('metal', 0.08, p);
    this.weapons = new WeaponSystem(g.player, this.combat, this.effects, this.audio, g.camera);
    // Gunshots are synthesised once per gun here, during loading.
    this.audio.prepareGuns(Object.values(WEAPONS).map((w) => w.sound));
    this.weapons.onNotice = (t) => this.hud.showNotice(t, 2);
    this.weapons.onHit = (_h, defeated) => this.hud.hitMarker(defeated);
    this.weapons.onAcquire = (def) => {
      this.hud.toast(`Weapon: ${def.name}`, `${def.category}. ${def.role} Slot ${def.slot}.`, 'objective');
      this.audio.gunMech('pickup', g.player.renderPos);
    };
    this.weapons.onEquip = (id) => {
      g.player.speedScale = id ? WEAPONS[id].moveScale : 1;
    };
    // Hostile NPCs and the player's own body as a target for their shots.
    this.npcs = new NpcManager(g.physics, g.terrain, this.combat, g.scene);
    this.combat.self = this.playerHittable();
    this.combat.add(this.combat.self);
    const npcWorld = this.npcWorld();
    g.systems.push({
      fixedUpdate: (dt) => this.npcs.fixedUpdate(dt),
      update: (dt, alpha) => {
        if (!this.playing || g.paused) return;
        this.refreshNpcWorld(npcWorld);
        this.npcs.update(dt, alpha, npcWorld);
      },
    });
    // The station wall map is the same topographic map the player carries.
    const mapBoard = this.structures.pickups.wallMap as THREE.Mesh | undefined;
    if (mapBoard) {
      const tex = new THREE.CanvasTexture(this.screens.mapCanvas(1024));
      tex.colorSpace = THREE.SRGBColorSpace;
      mapBoard.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    }
    // Settle the truck on its suspension.
    for (let i = 0; i < 90; i += 1) {
      this.truck.fixedUpdate(1 / 60);
      g.physics.step();
    }
    this.truck.postPhysics();
    this.truck.update(0, 1);
    this.lastTruckPos.copy(this.truck.position);
    this.interactions.add({
      id: 'truck-enter',
      position: () => this.truck.driverDoorWorld(),
      range: 2.7,
      wide: true,
      prompt: () => (this.mode === 'foot' ? 'Get in' : null),
      use: () => this.enterVehicle(this.truck),
    });
    this.mystery = new Mystery(this, this.structures);
    this.mystery.setSfx(this.audio);
    this.mystery.onEnding = () => this.ending();
    this.mystery.onClue = () => this.save();
    // Mission locations and the eight-mission progression on top of the story.
    progress(0.97, 'Marking the missions');
    const sites = await buildMissionSites(g.terrain, g.physics, this.structures);
    g.scene.add(sites.group);
    this.missions = new Missions(this, sites);
    this.listeners.frame.push((dt) => this.missions.update(dt));
    // Friendly locals who introduce themselves and point the way.
    this.locals = new Locals(this);
    this.listeners.frame.push((dt) => this.locals.update(dt));
    this.onRespawn = () => this.missions.respawned();
    const light = this.structures.anchors.suvDoor;
    if (light) this.mystery.lightPos = light.clone().add(new THREE.Vector3(0.2, -0.95, 0.3));
    // Footsteps, landing thuds and structure floors.
    const st = this.structures;
    g.player.surfaceOverride = () => {
      const p = g.player.position;
      if (st.station.footprint(p.x, p.z) && p.y > g.terrain.heightAt(p.x, p.z) + 0.25) return 'wood';
      if (st.tower.footprint(p.x, p.z, p.y) && p.y > g.terrain.heightAt(p.x, p.z) + 0.4) return 'wood';
      if (st.cabin.footprint(p.x, p.z) && p.y > g.terrain.heightAt(p.x, p.z) + 0.1) return 'wood';
      if (st.bridgeFootprint(p.x, p.z) && p.y > g.terrain.heightAt(p.x, p.z) + 0.5) return 'wood';
      return null;
    };
    g.player.onStep = (e) => this.audio.footstep(e.surface, e.intensity, g.player.position);
    g.player.onLand = (e) => this.audio.footstep(e.surface, 1, g.player.position);
    g.onUpdate = (dt) => this.frame(dt);
    // Pause when the pointer is released during play.
    g.input.onPointerLockChange = (locked) => {
      if (!locked && this.playing && this.screens.current === 'none' && !this.testMode) this.openScreen('pause');
    };
    const saved = this.loadSave();
    if (saved) this.screens.setContinue(() => this.begin(true));
  }

  // ------------------------------------------------------------ flow

  showTitle(): void {
    this.playing = false;
    this.game.paused = true;
    this.hud.setVisible(false);
    this.touch?.setVisible(false);
    this.screens.show('title');
    // Slow cinematic drift over the trailhead while on the title screen.
    this.game.cameraController = (dt) => {
      this.titleT += dt || 1 / 60;
      const t = this.titleT * 0.04;
      const cx = 52 + Math.sin(t) * 10;
      const cz = 226 + Math.cos(t * 0.8) * 8;
      const cy = this.game.terrain.heightAt(cx, cz) + 3.2 + Math.sin(t * 1.3) * 0.6;
      this.game.camera.position.set(cx, cy, cz);
      this.game.camera.lookAt(this.truck.position.x, this.truck.position.y + 1.2, this.truck.position.z);
    };
  }

  begin(fromSave: boolean): void {
    void this.audio.start();
    if (!this.testMode) this.touch?.enterImmersive();
    this.audio.setVolume(this.game.settings.masterVolume);
    if (fromSave) this.applySave();
    else {
      this.clearSave();
      this.hud.toast('Hollow Creek Ranger District', 'Late afternoon, October 13. Hale\'s last check-in was two days ago.', 'objective');
      this.missions.begin();
      this.locals.restore(undefined);
    }
    this.playing = true;
    this.screens.show('none');
    this.hud.setVisible(true);
    this.touch?.setVisible(true);
    this.game.cameraController = this.mode === 'vehicle' && this.active ? this.vehicleCamera(this.active) : null;
    this.game.paused = false;
    this.game.input.requestPointerLock();
  }

  private openScreen(s: 'pause' | 'journal' | 'map'): void {
    this.touch?.setVisible(false);
    this.screens.show(s, 'pause');
    this.game.paused = true;
    this.audio.suspend(true);
    this.game.input.exitPointerLock();
  }

  resume(): void {
    this.touch?.setVisible(true);
    this.screens.show('none');
    this.game.paused = false;
    this.audio.suspend(false);
    this.game.input.requestPointerLock();
  }

  private toTitle(): void {
    this.save();
    location.reload();
  }

  private applySettings(s: Settings, reload: boolean): void {
    Object.assign(this.game.settings, s);
    saveSettings(this.game.settings);
    this.game.player.sensitivity = s.mouseSensitivity;
    this.game.player.invertY = s.invertY;
    this.game.player.baseFov = s.fov;
    this.game.camera.fov = s.fov;
    this.game.camera.updateProjectionMatrix();
    this.audio.setVolume(s.masterVolume);
    if (reload) {
      this.save();
      location.reload();
    }
  }

  ending(): void {
    this.save();
    const t = this.mystery.totalClues();
    setTimeout(() => {
      this.game.paused = true;
      this.game.input.exitPointerLock();
      this.hud.setVisible(false);
      this.touch?.setVisible(false);
      this.screens.showEnding(
        {
          minutes: Math.max(1, Math.round(this.playTime / 60)), clues: `${t.found}/${t.total}`, km: this.km / 1000,
          missions: `${this.missions.completedCount}/8`,
          accuracy: this.weapons.shotsFired ? `${Math.round((this.weapons.shotsHit / this.weapons.shotsFired) * 100)}%` : undefined,
        },
        () => {
          this.screens.show('none');
          this.hud.setVisible(true);
          this.touch?.setVisible(true);
          this.game.paused = false;
          this.game.input.requestPointerLock();
        },
        () => this.toTitle(),
      );
    }, 2500);
  }

  // ------------------------------------------------------------ vehicles

  addInteractable(i: Interactable): void {
    this.interactions.add(i);
  }

  private vehicleCamera(v: Vehicle): (dt: number) => void {
    return (dt) => v.updateCamera(this.game.camera, dt, this.game.lookDelta, this.game.settings.mouseSensitivity);
  }

  enterVehicle(v: Vehicle): void {
    if (this.mode !== 'foot') return;
    this.weapons.forceHolster();
    this.hud.setInventory(false);
    this.mode = 'vehicle';
    this.active = v;
    this.game.onFoot = false;
    v.enter(this.game.player);
    this.game.cameraController = this.vehicleCamera(v);
    this.audio.play('thunk', v.position);
    setTimeout(() => this.audio.engineStart(v.position), 350);
    this.listeners.enter.forEach((f) => f(v));
  }

  exitVehicle(): void {
    const v = this.active;
    if (!v) return;
    if (!v.exit(this.game.player)) {
      this.hud.showNotice('No room to get out here');
      return;
    }
    v.phys.engineOn = false;
    this.mode = 'foot';
    this.active = null;
    this.game.onFoot = true;
    this.game.cameraController = null;
    this.audio.play('thunk', v.position);
    this.listeners.exit.forEach((f) => f(v));
  }

  setForcedPrompt(text: string | null): void {
    this.forcedPrompt = text;
  }

  get focusPosition(): THREE.Vector3 {
    return this.mode === 'vehicle' && this.active ? this.active.position : this.game.player.position;
  }

  // ------------------------------------------------------------ frame

  private frame(dt: number): void {
    const g = this.game;
    const input = g.input;
    this.hud.update(dt);
    this.structures.updateSmoke(dt, g.time);
    if (!this.playing) return;
    // Menus.
    if (this.screens.current === 'none') {
      if (input.pressed('journal')) this.openScreen('journal');
      else if (input.pressed('map')) this.openScreen('map');
      else if (input.pressed('pause') && this.testMode) this.openScreen('pause');
    } else if (this.screens.current === 'journal' || this.screens.current === 'map' || this.screens.current === 'pause') {
      if (input.pressed('journal') && this.screens.current === 'journal') this.resume();
      else if (input.pressed('map') && this.screens.current === 'map') this.resume();
    }
    if (g.paused) return;
    this.playTime += dt;
    this.updateCombat(dt);
    if (this.mode === 'vehicle' && this.active) {
      const v = this.active;
      const { exitRequested } = v.handleInput(input, dt);
      if (exitRequested && Math.abs(v.phys.speed) < 3) this.exitVehicle();
      else if (exitRequested) this.hud.showNotice('Slow down to get out');
      if (this.mode === 'vehicle') {
        const hints = ['<b>W S</b> drive / brake', '<b>A D</b> steer', '<b>Space</b> handbrake', `<b>L</b> lights ${v.lightsOn ? 'on' : 'off'}`, '<b>C</b> camera', '<b>E</b> get out'];
        if (v.needsRecovery) hints.unshift('<b>Hold R</b> recover');
        this.hud.setVehicle({
          speed: v.speedKmh,
          gear: v.phys.reversing ? 'R' : Math.abs(v.phys.speed) < 0.3 && v.phys.input.throttle === 0 ? 'N' : String(v.phys.gear),
          lights: v.lightsOn,
          hints,
        });
        if (v.needsRecovery && v.recoverHold === 0) this.hud.showNotice('Hold R to recover the truck', 0.5);
        this.hud.setPrompt(this.forcedPrompt ? { key: 'T', text: this.forcedPrompt, progress: 0 } : null);
        this.hud.setCrosshair('hidden');
      }
    } else {
      this.hud.setVehicle(null);
      g.camera.getWorldDirection(this.fwd);
      const busy = this.mystery.busy;
      const reach = g.player.firstPerson ? undefined : g.player.eyePosition;
      this.interactions.update(g.camera.position, this.fwd, !busy && input.pressed('interact'), !busy && input.held('interact'), dt, reach);
      const t = busy ? null : this.interactions.current;
      this.hud.setPrompt(t ? { key: 'E', text: t.prompt, progress: t.progress } : null);
      this.hud.setCrosshair(t ? 'target' : 'idle');
    }
    if (this.touch) {
      const onFoot = this.mode === 'foot';
      const t = onFoot && !this.mystery.busy ? this.interactions.current : null;
      this.touch.update({
        mode: onFoot ? 'foot' : 'vehicle',
        prompt: t ? { text: t.prompt, progress: t.progress } : null,
        radio: this.forcedPrompt,
        armed: onFoot && this.weapons.owned.size > 0,
        drawn: onFoot && this.weapons.owned.size > 0 && this.weapons.phase !== 'holstered',
        needsRecovery: !onFoot && !!this.active?.needsRecovery,
        flashlight: this.flashlightOn,
        lights: !!this.active?.lightsOn,
      });
    }
    g.camera.getWorldDirection(this.fwd);
    this.compassHeading = (Math.atan2(this.fwd.x, -this.fwd.z) * 180) / Math.PI;
    this.listeners.frame.forEach((f) => f(dt));
    // Distance driven.
    const tp = this.truck.position;
    if (this.truck.phys.engineOn) this.km += Math.min(5, tp.distanceTo(this.lastTruckPos));
    this.lastTruckPos.copy(tp);
    // Audio: listener, ambience, engine, impacts.
    const cam = g.camera.position;
    const creek = g.terrain.creek;
    const near = creek.nearest(cam.x, cam.z);
    const pts = [-18, 0, 18].map((o) => {
      const p = creek.at(near.s + o);
      return new THREE.Vector3(p.x, g.terrain.heightAt(p.x, p.z) + 0.4, p.z);
    });
    const canopyHere = 1;
    this.audio.dusk = this.mystery.progress();
    this.audio.update(dt, g.camera, windUniforms.uGust.value, canopyHere, pts);
    const ph = this.truck.phys;
    const surf = ph.wheelSurface[2];
    this.audio.updateEngine(ph.engineOn, ph.rpm, ph.load, ph.speed, surf, this.truck.position, this.mode === 'vehicle' && this.truck.cameraMode === 'cockpit');
    g.physics.eventQueue.drainContactForceEvents((e) => {
      const f = e.totalForceMagnitude();
      if (f > 20000) {
        const k = Math.min(1, f / 120000);
        this.audio.impact(k, this.truck.position);
        this.truck.shake = Math.max(this.truck.shake, k);
      }
    });
    // Spray from the rear tyres.
    const b = ph.basis();
    const back = new THREE.Vector3(-b.fx, 0, -b.fz);
    for (const i of [2, 3]) {
      const c = ph.controller.wheelContactPoint(i);
      if (c && ph.controller.wheelIsInContact(i)) this.spray.emit(dt, new THREE.Vector3(c.x, c.y, c.z), back, ph.speed, ph.wheelSurface[i]);
    }
    this.spray.update(dt);
    this.updateLights();
    if (this.mode === 'foot' && input.pressed('flashlight')) {
      this.flashlightOn = !this.flashlightOn;
      this.audio.play('click');
    }
    const fl = this.flashlight;
    fl.intensity = this.flashlightOn && this.mode === 'foot' ? 55 : 0;
    if (fl.intensity > 0) {
      // Chest-mounted light on the character, pointing where the camera looks.
      g.camera.getWorldDirection(this.fwd);
      const chest = g.player.eyePosition.add(new THREE.Vector3(0, -0.3, 0));
      fl.position.copy(chest).addScaledVector(this.fwd, 0.35);
      fl.target.position.copy(g.camera.position).addScaledVector(this.fwd, 14);
      fl.target.updateMatrixWorld();
    }
    if (!this.flashHintShown && this.mystery.progress() > 0.45 && this.mode === 'foot') {
      this.flashHintShown = true;
      this.hud.toast('Getting dark', 'Press F for your flashlight.', 'info');
    }
    if (g.settings.showFps) this.hud.setFps(`${g.averageFrameMs().toFixed(1)} ms · ${Math.round(g.resolutionScale * 100)}% res`);
    else this.hud.setFps(null);
    // Autosave.
    this.saveTimer += dt;
    if (this.saveTimer > 20) {
      this.saveTimer = 0;
      this.save();
    }
  }

  /** Weapons, effects, condition and the combat HUD. */
  private updateCombat(dt: number): void {
    const g = this.game;
    const input = g.input;
    const onFoot = this.mode === 'foot';
    const free = onFoot && this.screens.current === 'none' && !this.mystery.busy && !g.player.firstPerson;
    this.weapons.update(dt, input, free && this.downT < 0);
    this.combat.update(dt);
    this.barkT = Math.max(0, this.barkT - dt);
    this.updateDowned(dt);
    this.effects.update(dt, g.camera);
    // Condition regenerates after 6 s without damage.
    this.sinceHurt += dt;
    if (this.sinceHurt > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 9);
    this.hud.setHealth(this.health, this.health < 99.5 || this.npcs.inCombat);
    // Weapon panel and crosshair.
    const w = onFoot ? this.weapons.hudState() : null;
    if (!w || w.phase === 'holstered') this.hud.clearWeaponCrosshair();
    this.hud.setWeapon(w);
    // Weapon inventory while Tab is held.
    const wantInv = onFoot && input.held('inventory') && this.weapons.owned.size > 0;
    if (wantInv && !this.invOpen) {
      this.hud.setInventoryDetail(WEAPON_ORDER.map((id) => {
        const def = WEAPONS[id];
        const o = this.weapons.owned.get(id);
        return {
          slot: def.slot, name: def.name, category: def.category, owned: !!o, current: this.weapons.current === id && this.weapons.phase !== 'holstered',
          ammo: o ? `${o.mag} + ${this.weapons.reserve[def.ammo]} ${AMMO_NAMES[def.ammo]}` : '', role: def.role,
        };
      }));
    }
    this.invOpen = wantInv;
    this.hud.setInventory(wantInv);
    if (onFoot && input.pressed('shoulder')) g.player.tpc.side *= -1;
    // Contextual control reminders.
    if (onFoot && this.weapons.owned.size) {
      const drawn = this.weapons.phase !== 'holstered';
      this.hud.setControls(drawn
        ? '<b>LMB</b> fire · <b>RMB</b> aim · <b>R</b> reload<br><b>H</b> holster · <b>1-8</b> switch · <b>Tab</b> weapons · <b>V</b> shoulder'
        : '<b>H</b> draw · <b>1-8</b> select · <b>Tab</b> weapons');
    } else this.hud.setControls(null);
  }

  /** The player's body for NPC shots: a capsule from shins to head. */
  private playerHittable(): Hittable {
    const g = this.game;
    const center = new THREE.Vector3();
    const self: Hittable = {
      id: 'player',
      get active() {
        return true;
      },
      center,
      radius: 1.1,
      raycast: (o, d, max): PartHit | null => {
        if (this.mode !== 'foot' || this.health <= 0) return null;
        const p = g.player.renderPos;
        const top = 1.62 - g.player.crouch * 0.5;
        const a = new THREE.Vector3(p.x, p.y + 0.3, p.z);
        const b = new THREE.Vector3(p.x, p.y + top - 0.12, p.z);
        const t = rayCapsule(o, d, a, b, 0.29);
        if (t === null || t > max) return null;
        const hp = o.clone().addScaledVector(d, t);
        return { dist: t, part: hp.y > p.y + top - 0.25 ? 'head' : 'body', normal: d.clone().negate(), surface: 'cloth' };
      },
      onHit: () => undefined,
    };
    // Keep the culling sphere on the player.
    g.afterPhysics.push(() => center.set(g.player.position.x, g.player.position.y + 0.95, g.player.position.z));
    return self;
  }

  private npcWorld(): NpcWorld {
    const g = this.game;
    return {
      physics: g.physics, terrain: g.terrain, combat: this.combat, effects: this.effects, audio: this.audio,
      camera: g.camera, scene: g.scene, dusk: 0,
      player: { pos: new THREE.Vector3(), head: new THREE.Vector3(), chest: new THREE.Vector3(), vel: new THREE.Vector3(), crouch: 0, exposed: false },
      damagePlayer: (amount, from) => {
        if (!this.godMode) this.damagePlayer(amount, from);
        else this.damagePlayer(Math.min(amount, Math.max(0, this.health - 1)), from);
      },
      bark: (npc: Npc, line: string) => this.bark(npc, line),
    };
  }

  private refreshNpcWorld(w: NpcWorld): void {
    const p = this.game.player;
    w.player.pos.copy(p.renderPos);
    w.player.head.copy(p.eyePosition);
    w.player.chest.copy(p.renderPos).add(new THREE.Vector3(0, 1.25 - p.crouch * 0.4, 0));
    w.player.vel.copy(p.velocity).setY(0);
    w.player.crouch = p.crouch;
    w.player.exposed = this.mode === 'foot' && this.health > 0 && this.downT < 0;
    w.dusk = this.mystery.progress() * 0.9;
  }

  /** NPC callouts as short subtitles: only nearby, never stacked. */
  private bark(npc: Npc, line: string): void {
    const d = npc.renderPos.distanceTo(this.game.player.renderPos);
    const surrender = npc.state === 'down';
    if (d > 45 || (!surrender && this.barkT > 0) || this.mystery.busy) return;
    this.barkT = 2.4;
    this.hud.say(npc.name, line, 2.2);
  }

  /** Damage to the player from `from` (world position, for the direction indicator). */
  damagePlayer(amount: number, from: THREE.Vector3 | null): void {
    if (this.mode !== 'foot' || this.health <= 0 || this.downT >= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.sinceHurt = 0;
    this.game.player.flinch = Math.min(1, this.game.player.flinch + amount / 25);
    let rel: number | null = null;
    if (from) {
      const p = this.game.player.renderPos;
      const bearing = (Math.atan2(from.x - p.x, -(from.z - p.z)) * 180) / Math.PI;
      rel = ((bearing - this.compassHeading + 540) % 360) - 180;
    }
    this.hud.damage(amount, rel);
    this.audio.playerHurt();
    if (this.health <= 0) this.downed();
  }

  /** Incapacitated: fade out, then wake at the last checkpoint with full condition. */
  private downed(): void {
    this.downT = 0;
    this.weapons.forceHolster();
    this.hud.toast('You were hit badly', 'Back at the last checkpoint. Use cover and take your time.', 'hint');
    this.onDowned?.();
  }

  private updateDowned(dt: number): void {
    if (this.downT < 0) return;
    this.downT += dt;
    this.hud.setFade(Math.min(1, this.downT / 0.8));
    if (this.downT > 2.2) {
      const cp = this.checkpoint;
      const p = cp ? cp.pos : this.game.player.renderPos;
      this.game.player.teleport(p.x, this.game.terrain.heightAt(p.x, p.z), p.z, cp?.yaw ?? this.game.player.yaw);
      this.health = 100;
      this.sinceHurt = 99;
      this.downT = -1;
      this.hud.setFade(0);
      this.onRespawn?.();
    }
  }

  onRespawn: (() => void) | null = null;

  private lampPos = new THREE.Vector3();
  private updateLights(): void {
    const cam = this.game.camera.position;
    let best: THREE.PointLight | null = null;
    let bestD = 45;
    for (const l of this.lamps) {
      if (l.intensity <= 0) continue;
      l.getWorldPosition(this.lampPos);
      const d = this.lampPos.distanceTo(cam);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    const p = this.poolLight;
    if (!best) {
      p.intensity = 0;
      return;
    }
    best.getWorldPosition(p.position);
    p.color.copy(best.color);
    p.distance = best.distance;
    p.decay = best.decay;
    const flicker = best === this.structures.cabin.glow ? 0.88 + 0.12 * Math.sin(this.game.time * 13.1) * Math.sin(this.game.time * 7.3) : 1;
    p.intensity = best.intensity * flicker * (1 - THREE.MathUtils.smoothstep(bestD, 30, 45));
  }

  // ------------------------------------------------------------ save

  save(): void {
    if ((this.testMode && !this.saveTest) || !this.mystery) return;
    const p = this.game.player;
    const t = this.truck;
    const b = t.phys.basis();
    const data: SaveData = {
      ...this.mystery.serialize(),
      player: [p.position.x, p.position.y, p.position.z, p.yaw],
      truck: [t.position.x, t.position.y, t.position.z, Math.atan2(b.fx, b.fz)],
      mode: this.mode,
      playTime: this.playTime,
      km: this.km,
      weapons: this.weapons.serialize(),
      health: this.health,
      missions: this.missions.serialize(),
      locals: this.locals.serialize(),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      // Storage unavailable: progress is kept for this session only.
    }
  }

  /** Mission progress hooks (set by the mission system). */
  saveExtra: (() => unknown) | null = null;
  loadExtra: ((data: unknown) => void) | null = null;

  private loadSave(): SaveData | null {
    if (this.testMode && !this.saveTest) return null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? (JSON.parse(raw) as SaveData) : null;
    } catch {
      return null;
    }
  }

  private clearSave(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Nothing to clear.
    }
  }

  private applySave(): void {
    const d = this.loadSave();
    if (!d) return;
    this.mystery.restore(d);
    this.playTime = d.playTime;
    this.km = d.km;
    this.truck.phys.reset(d.truck[0], d.truck[1] + 0.6, d.truck[2], d.truck[3]);
    this.game.player.teleport(d.player[0], d.player[1], d.player[2], d.player[3]);
    if (d.weapons) this.weapons.restore(d.weapons);
    if (d.health !== undefined) this.health = Math.max(40, d.health);
    if (d.missions !== undefined) this.missions.restore(d.missions as MissionSave);
    this.locals.restore(d.locals);
    if (d.mode === 'vehicle') this.enterVehicle(this.truck);
  }
}
