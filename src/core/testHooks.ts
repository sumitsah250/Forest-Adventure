// Hooks used by scripts/browser-test.mjs. Only installed when the URL has ?test.

import * as THREE from 'three';
import type { Game } from './game.ts';
import type { Session } from '../game/session.ts';
import { AFTERNOON, DUSK } from '../render/atmosphere.ts';
import { PLAYER_SUIT, POACHER_OUTFITS, RANGER, createHumanoid } from '../character/humanoid.ts';
import type { WeaponId } from '../weapons/defs.ts';
import { runMissions } from './missionTest.ts';
import { Animator } from '../character/animator.ts';
import { buildWeaponModel } from '../weapons/models.ts';
import { WEAPON_ORDER } from '../weapons/defs.ts';

export interface TestView {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  y?: number;
}

export interface TestApi {
  view(v: TestView): void;
  stats(): Record<string, unknown>;
  [key: string]: unknown;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installTestHooks(game: Game, session: Session, extra: Record<string, unknown> = {}): TestApi {
  const api: TestApi = {
    view(v: TestView) {
      if (session.mode === 'vehicle') session.exitVehicle();
      const y = v.y ?? game.terrain.heightAt(v.x, v.z);
      game.player.teleport(v.x, y, v.z, v.yaw);
      game.player.pitch = v.pitch;
    },
    /**
     * Character showcase: the five outfits in a row on the trailhead gravel, either
     * standing or walking/running in a straight line (speed in m/s).
     */
    showcase(o: { speed: number; pose?: 'normal' | 'sit' | 'surrender' | 'down'; spacing?: number }) {
      const w = window as unknown as { __show?: { root: THREE.Group; anim: Animator; x0: number; z: number }[] };
      for (const c of w.__show ?? []) game.scene.remove(c.root);
      const outfits = [PLAYER_SUIT, RANGER, ...POACHER_OUTFITS];
      const ground = (x: number, z: number) => game.terrain.heightAt(x, z);
      w.__show = outfits.map((of, i) => {
        const h = createHumanoid(of);
        game.scene.add(h.root);
        const x0 = 58 + i * (o.spacing ?? 1.4);
        const z = 228;
        const anim = new Animator(h, ground);
        return { root: h.root, anim, x0, z };
      });
      let t = 0;
      const vel = new THREE.Vector3(0, 0, o.speed);
      const ws = window as unknown as { __showSys?: object };
      if (ws.__showSys) game.systems.splice(game.systems.indexOf(ws.__showSys as never), 1);
      ws.__showSys = {
        update: (dt: number) => {
          t += dt;
          for (const c of w.__show ?? []) {
            const z = o.speed > 0 ? c.z + ((t * o.speed) % 14) - 7 : c.z;
            const pos = new THREE.Vector3(c.x0, game.terrain.heightAt(c.x0, z), z);
            c.anim.update(dt || 1 / 60, {
              pos, vel, facing: 0, grounded: true, crouch: 0, sprint: o.speed > 4.5, aimPitch: 0, aimAmount: 0,
              lookAt: null, hands: null, pose: o.pose ?? 'normal', flinch: 0,
            });
          }
        },
      };
      game.systems.push(ws.__showSys as never);
      return outfits.length;
    },
    /** Lays the eight weapon models out in a column in front of a fixed camera. */
    gunShowcase(o: { x: number; y: number; z: number; spacing: number; side?: boolean }) {
      const g = new THREE.Group();
      g.name = 'gun-showcase';
      WEAPON_ORDER.forEach((id, i) => {
        const m = buildWeaponModel(id);
        // Profile view: muzzle to the right of the screen (camera looks along -Z... set by caller).
        m.root.rotation.y = o.side ? Math.PI / 2 : 0;
        m.root.position.set(0, -i * o.spacing, 0);
        g.add(m.root);
      });
      g.position.set(o.x, o.y, o.z);
      game.scene.add(g);
      return WEAPON_ORDER.length;
    },
    /**
     * Combat test: three armed poachers 20-30 m north of the player, with cover
     * points behind the real trunks between them.
     */
    combatSetup(o: { weapon?: string; god?: boolean } = {}) {
      game.cameraController = null;
      const px = 56;
      const pz = 238;
      game.player.teleport(px, game.terrain.heightAt(px, pz), pz, 0);
      session.health = 100;
      session.godMode = o.god ?? true;
      session.weapons.give((o.weapon ?? 'marten') as WeaponId, { silent: true });
      session.weapons.select((o.weapon ?? 'marten') as WeaponId);
      const cx = 52;
      const cz = 208;
      const cover: [number, number][] = [];
      for (const t of game.vegetation.treesNear(cx, cz, 26)) {
        if (t.radius < 0.18) continue;
        const away = new THREE.Vector2(t.x - px, t.z - pz).normalize();
        cover.push([t.x + away.x * (t.radius + 0.55), t.z + away.y * (t.radius + 0.55)]);
      }
      const weapons: WeaponId[] = ['ridgeline', 'vireo', 'ranger12'];
      const g = session.npcs.spawn('test', [0, 1, 2].map((i) => ({
        id: `t${i}`, outfit: POACHER_OUTFITS[(i + 1) % POACHER_OUTFITS.length], weapon: weapons[i],
        x: cx - 8 + i * 8, z: cz - 4 + (i % 2) * 6, facing: 0.15, sight: 45, leash: 40, accuracy: 0.5,
      })), cover);
      return { npcs: g.members.length, cover: cover.length };
    },
    npcState() {
      return {
        player: Number(session.health.toFixed(1)),
        npcShots: (session.npcs.all[0]?.constructor as unknown as { shots: number } | undefined)?.shots ?? 0,
        npcs: session.npcs.all.map((n) => {
          const x = n as unknown as { phase: string; seeing: boolean; lastSeenT: number; time: number; aimBlend: number; mag: number; cover: THREE.Vector3 | null; moveTarget: THREE.Vector3 | null; vel: THREE.Vector3; pos: THREE.Vector3 };
          return {
            id: n.id, state: n.state, hp: Math.round(n.health), d: Number(n.renderPos.distanceTo(game.player.renderPos).toFixed(1)),
            phase: x.phase, seeing: x.seeing, know: Number((x.time - x.lastSeenT).toFixed(1)), aim: Number(x.aimBlend.toFixed(2)), mag: x.mag, cover: !!x.cover,
            tgt: x.moveTarget ? Number(Math.hypot(x.moveTarget.x - x.pos.x, x.moveTarget.z - x.pos.z).toFixed(2)) : null, v: Number(Math.hypot(x.vel.x, x.vel.z).toFixed(2)),
          };
        }),
      };
    },
    /** Move the player to a flanking spot `dist` m from an NPC, rotated `ang` rad around it. */
    flankNpc(i: number, dist: number, ang: number) {
      const n = session.npcs.all[i];
      if (!n) return false;
      const from = game.player.renderPos.clone().sub(n.renderPos).setY(0).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      const p = n.renderPos.clone().addScaledVector(from, dist);
      game.player.teleport(p.x, game.terrain.heightAt(p.x, p.z), p.z);
      return true;
    },
    /** Point the player's gun at an NPC's chest (null releases). */
    aimAtNpc(i: number | null) {
      const n = i === null ? null : session.npcs.all[i];
      if (!n) {
        session.weapons.aimOverride = null;
        return null;
      }
      const target = n.renderPos.clone().add(new THREE.Vector3(0, 1.2 - (n.state === 'down' ? 0.4 : 0), 0));
      session.weapons.aimOverride = target;
      const p = game.player;
      const d = target.clone().sub(p.eyePosition);
      p.yaw = Math.atan2(-d.x, -d.z);
      p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      return n.state;
    },
    /** Weapon test: stand near a tree at the trailhead edge and own every weapon. */
    wpnSetup() {
      game.cameraController = null;
      const x = 74;
      const z = 226;
      game.player.teleport(x, game.terrain.heightAt(x, z), z, 0);
      const ws = session.weapons;
      for (const id of WEAPON_ORDER) ws.give(id, { silent: true });
      // Face the nearest sizeable trunk 6-14 m away.
      const trees = game.vegetation.treesNear(x, z, 16).filter((t) => t.radius > 0.2 && Math.hypot(t.x - x, t.z - z) > 6);
      trees.sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
      const t = trees[0];
      if (t) {
        game.player.yaw = Math.atan2(-(t.x - x), -(t.z - z));
        game.player.facing = game.player.yaw;
        game.player.pitch = 0.08;
      }
      return { tree: t ? [t.x, t.z, t.radius].map((n) => Number(n.toFixed(2))) : null, owned: ws.owned.size };
    },
    /** Full eight-mission playthrough (see missionTest.ts); `stopAfter` ends early. */
    async missions(stopAfter = 8) {
      const lines: string[] = [];
      const res = await runMissions(game, session, (l) => {
        lines.push(l);
        console.log(`[missions] ${l}`);
      }, stopAfter);
      return { ...res, lines };
    },
    /** State snapshot for the save round-trip test. */
    saveState() {
      const ms = session.missions;
      const ws = session.weapons;
      return {
        mission: ms.index, step: ms.step, title: ms.missionTitle,
        owned: [...ws.owned.keys()].sort(), mags: [...ws.owned.values()].map((o) => o.mag),
        reserve: { ...ws.reserve }, pickups: [...ms.pickups.taken].sort(),
        flags: [...session.mystery.flags].length, missionFlags: [...ms.flags].sort(),
        clues: session.mystery.clues.length,
        npcsDown: session.npcs.all.filter((n) => n.state === 'down').map((n) => n.id).sort(),
        npcAll: session.npcs.all.map((n) => `${n.id}:${n.state}:${Math.round(n.health)}`),
      };
    },
    saveNow() {
      session.save();
      return localStorage.getItem('hollow-creek.save.v1')?.length ?? 0;
    },
    /** Fix the aim point 20 m ahead of the character (for side-view pose shots). */
    wpnFreezeAim(on: boolean) {
      const p = game.player;
      session.weapons.aimOverride = on ? p.renderPos.clone().add(new THREE.Vector3(-Math.sin(p.yaw) * 20, 1.5, -Math.cos(p.yaw) * 20)) : null;
      // Side camera 2.4 m to the character's right, looking at the chest.
      const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      const c = p.renderPos.clone().addScaledVector(right, 2.3).addScaledVector(fwd, 0.6).add(new THREE.Vector3(0, 1.45, 0));
      const t = p.renderPos.clone().addScaledVector(fwd, 0.35).add(new THREE.Vector3(0, 1.25, 0));
      return { x: c.x, y: c.y, z: c.z, tx: t.x, ty: t.y, tz: t.z };
    },
    wpnSelect(id: string) {
      session.weapons.select(id as never);
      return session.weapons.current;
    },
    wpnState() {
      const ws = session.weapons;
      const o = ws.current ? ws.owned.get(ws.current) : null;
      return {
        current: ws.current, phase: ws.phase, mag: o?.mag ?? null, reserve: o ? ws.reserve[o.def.ammo] : null,
        aim: Number(ws.aimBlend.toFixed(2)), fired: ws.shotsFired, hit: ws.shotsHit, blocked: ws.muzzleBlocked,
        aimPoint: [ws.aimPoint.x, ws.aimPoint.y, ws.aimPoint.z].map((n) => Number(n.toFixed(2))),
        reloading: ws.reloadProgress,
      };
    },
    /** Hold or release a mouse button / key by input code. */
    hold(code: string, on: boolean) {
      if (on) game.input.simulatePress(code, true);
      else game.input.simulateRelease(code);
    },
    tap(code: string) {
      game.input.simulatePress(code);
    },
    /** Free camera for screenshots (`null` returns control to the player camera). */
    cam(c: { x: number; y: number; z: number; tx: number; ty: number; tz: number } | null) {
      if (!c) {
        game.cameraController = null;
        return;
      }
      game.cameraController = () => {
        game.camera.position.set(c.x, c.y, c.z);
        game.camera.lookAt(c.tx, c.ty, c.tz);
      };
      game.vegetation.update(1, new THREE.Vector3(c.x, c.y, c.z), true);
    },
    /** Walks the whole mystery through its interactions and reports each step. */
    async play() {
      const m = session.mystery;
      m.scriptSpeed = 12;
      const steps: string[] = [];
      const problems: string[] = [];
      const shots: { name: string; view: TestView }[] = [];
      const goTo = (p: THREE.Vector3, back = 1.3) => {
        const g = game.terrain.heightAt(p.x, p.z);
        // Stand a little away from the target, facing it.
        let best: { x: number; z: number } | null = null;
        for (let k = 0; k < 8 && !best; k += 1) {
          const a = (k / 8) * Math.PI * 2;
          const x = p.x + Math.cos(a) * back;
          const z = p.z + Math.sin(a) * back;
          if (Math.abs(game.terrain.heightAt(x, z) - g) < 1.2) best = { x, z };
        }
        best ??= { x: p.x + back, z: p.z };
        const fy = Math.max(game.terrain.heightAt(best.x, best.z), p.y - 1.4);
        const dx = p.x - best.x;
        const dz = p.z - best.z;
        const yaw = Math.atan2(-dx, -dz);
        game.player.teleport(best.x, fy, best.z, yaw);
        const eyeY = fy + 1.64;
        game.player.pitch = Math.atan2(p.y - eyeY, Math.hypot(dx, dz));
      };
      const use = async (id: string, expect?: () => boolean) => {
        const it = session.interactions.get(id);
        if (!it) {
          problems.push(`missing interactable ${id}`);
          return;
        }
        if (session.mode === 'vehicle') session.exitVehicle();
        goTo(it.position());
        await wait(350);
        const prompt = it.prompt();
        if (!prompt) {
          problems.push(`${id}: no prompt available`);
          return;
        }
        const targeted = session.interactions.current?.item.id === id;
        it.use();
        await wait(250);
        while (m.busy) await wait(200);
        const obj = m.currentObjective().text;
        steps.push(`${id} [${prompt}]${targeted ? '' : ' (not targeted by view)'} -> ${obj}`);
        if (expect && !expect()) problems.push(`${id}: expectation failed`);
      };
      steps.push(`start -> ${m.currentObjective().text}`);
      await use('board');
      await use('suv-cab');
      await use('suv-bumper');
      await use('suv-cargo');
      game.player.teleport(55, game.terrain.heightAt(55, 3), 3, 1.2);
      await wait(400);
      await use('station-door');
      await use('logbook', () => m.has('logbook'));
      await use('wall-map');
      await use('radio', () => m.has('radioTried'));
      await use('generator', () => m.has('generatorChecked'));
      await use('jerrycan', () => m.has('hasFuel'));
      await use('generator', () => m.has('generatorFueled'));
      await use('generator', () => m.has('generatorRunning'));
      await use('power-box', () => m.has('powerOn'));
      await use('radio', () => m.has('heardRecording'));
      await use('key', () => m.has('hasKey'));
      await use('bridge');
      await use('tracks');
      game.player.teleport(-2, game.terrain.heightAt(-2, -106), -106, 0);
      await wait(600);
      if (!m.has('crossedFord')) problems.push('crossing north of the creek was not detected');
      await use('gate', () => m.has('gateOpen'));
      await use('skids');
      await use('wreck', () => m.has('wreckSearched'));
      await use('tape');
      await use('flashlight');
      await use('camp-fire');
      await use('cutters');
      await use('binoculars');
      while (m.busy) await wait(200);
      await use('cabin-door');
      const knockStart = performance.now();
      while (!m.has('metHale') && performance.now() - knockStart < 30000) await wait(200);
      if (!m.has('metHale')) problems.push('Hale dialogue did not complete');
      const door = session.truck.driverDoorWorld();
      game.player.teleport(door.x + 0.6, game.terrain.heightAt(door.x, door.z), door.z, 0);
      await wait(300);
      session.enterVehicle(session.truck);
      await wait(400);
      game.input.simulatePress('KeyT');
      await wait(300);
      while (m.busy) await wait(200);
      await wait(1500);
      // The medevac call no longer ends the game: the missions continue the story
      // (the full sequence to the ending is covered by the 'missions' test).
      steps.push(`calledMedevac=${m.has('calledMedevac')} next=${session.missions.missionTitle}`);
      if (!m.has('calledMedevac')) problems.push('medevac call not completed');
      if (m.ended) problems.push('story ended at the medevac call');
      const clues = m.totalClues();
      return { ok: problems.length === 0, steps, problems, clues, flags: [...m.flags].length, shots };
    },
    /** Lighting/state setup for screenshots: dusk amount, station power, flashlight, headlights. */
    env(o: { dusk?: number; power?: boolean; flashlight?: boolean; headlights?: boolean }) {
      const m = session.mystery as unknown as { duskT: number; powerOn: () => void; flags: Set<string> };
      if (o.dusk !== undefined) {
        m.duskT = o.dusk;
        game.atmosphere.blend(AFTERNOON, DUSK, o.dusk, game.scene);
        game.renderer.toneMappingExposure = game.atmosphere.state.exposure;
        session.audio.dusk = o.dusk;
        // Keep the story-driven dusk from pulling it back.
        session.mystery.progress = () => o.dusk! / 0.95;
      }
      if (o.power) {
        m.flags.add('generatorRunning');
        m.flags.add('powerOn');
        m.powerOn();
      }
      if (o.flashlight !== undefined) (session as unknown as { flashlightOn: boolean }).flashlightOn = o.flashlight;
      if (o.headlights !== undefined) session.truck.setLights(o.headlights);
    },
    /** Walks with simulated keys: up the lookout stairs and through the station door. */
    async walk() {
      const inp = game.input;
      const out: Record<string, unknown> = {};
      const lookout = session.structures.group.getObjectByName('lookout-tower')!;
      lookout.updateMatrixWorld(true);
      // Foot of the first flight (tower-local (3.4, 0, 5.4)), facing up the stairs (local -Z).
      const base = new THREE.Vector3(3.4, 0, 5.6).applyMatrix4(lookout.matrixWorld);
      const up = new THREE.Vector3(3.4, 0, -1.8).applyMatrix4(lookout.matrixWorld);
      const yaw = Math.atan2(-(up.x - base.x), -(up.z - base.z));
      game.player.teleport(base.x, game.terrain.heightAt(base.x, base.z), base.z, yaw);
      game.player.pitch = 0;
      await wait(400);
      const R = game.physics.R;
      const probe = (from: THREE.Vector3, dir: THREE.Vector3, max: number) => {
        const ray = new R.Ray({ x: from.x, y: from.y, z: from.z }, { x: dir.x, y: dir.y, z: dir.z });
        const hit = game.physics.world.castRay(ray, max, true, undefined, undefined, game.player.collider);
        if (!hit) return null;
        const c = hit.collider;
        const t = c.translation();
        const he = (c.shape as unknown as { halfExtents?: { x: number; y: number; z: number } }).halfExtents;
        return { d: Number(hit.timeOfImpact.toFixed(2)), at: [t.x, t.y, t.z].map((n) => Number(n.toFixed(2))), half: he ? [he.x, he.y, he.z].map((n) => Number(n.toFixed(2))) : c.shapeType() };
      };
      const fwd = up.clone().sub(base).setY(0).normalize();
      const feet = game.player.position.clone();
      out.towerBaseY = Number(lookout.position.y.toFixed(2));
      out.groundAtFoot = Number(feet.y.toFixed(2));
      out.rayKnee = probe(feet.clone().add(new THREE.Vector3(0, 0.3, 0)), fwd, 4);
      out.rayChest = probe(feet.clone().add(new THREE.Vector3(0, 1.2, 0)), fwd, 4);
      const foot1 = base.clone().addScaledVector(fwd, 1.2);
      out.rampDown = probe(new THREE.Vector3(foot1.x, feet.y + 3, foot1.z), new THREE.Vector3(0, -1, 0), 6);
      const y0 = game.player.position.y;
      inp.simulatePress('KeyW', true);
      await wait(4200);
      inp.simulateRelease('KeyW');
      await wait(300);
      out.stairClimbM = Number((game.player.position.y - y0).toFixed(2));
      out.stairMovedM = Number(Math.hypot(game.player.position.x - base.x, game.player.position.z - base.z).toFixed(2));
      out.stairEnd = [game.player.position.x, game.player.position.y, game.player.position.z].map((n) => Number(n.toFixed(2)));
      out.stairBase = [base.x, base.z].map((n) => Number(n.toFixed(2)));
      // Station: stand on the porch in front of the door, open it, walk in.
      const door = session.interactions.get('station-door')!;
      const dp = door.position();
      const st = session.structures.group.getObjectByName('ranger-station')!;
      const outward = new THREE.Vector3(0, 0, 1).applyQuaternion(st.getWorldQuaternion(new THREE.Quaternion()));
      const stand = dp.clone().addScaledVector(outward, 1.6);
      game.player.teleport(stand.x, dp.y - 1.1, stand.z, Math.atan2(outward.x, outward.z));
      game.player.pitch = -0.1;
      await wait(400);
      if (door.prompt() === 'Open the door') door.use();
      await wait(800);
      const inward = outward.clone().negate();
      const pf = game.player.position.clone();
      out.doorKnee = probe(pf.clone().add(new THREE.Vector3(0, 0.3, 0)), inward, 5);
      out.doorChest = probe(pf.clone().add(new THREE.Vector3(0, 1.2, 0)), inward, 5);
      out.doorHead = probe(pf.clone().add(new THREE.Vector3(0, 1.75, 0)), inward, 5);
      inp.simulatePress('KeyW', true);
      await wait(1800);
      inp.simulateRelease('KeyW');
      await wait(300);
      const p = game.player.position;
      out.insideStation = session.structures.station.footprint(p.x, p.z) && p.distanceTo(stand) > 2.2;
      out.walkedM = Number(p.distanceTo(stand).toFixed(2));
      out.ok = (out.stairClimbM as number) > 1.5 && out.insideStation === true;
      return out;
    },
    /** UI walkthrough steps for screenshots. */
    async ui(step: string) {
      const s = session;
      if (step === 'begin') s.begin(false);
      if (step === 'journal' || step === 'map') {
        s.screens.show(step, 'pause');
        game.paused = true;
      }
      if (step === 'resume') s.resume();
      if (step === 'drive') {
        const door = s.truck.driverDoorWorld();
        game.player.teleport(door.x + 0.6, game.terrain.heightAt(door.x, door.z), door.z, 0);
        await wait(200);
        s.enterVehicle(s.truck);
        game.input.simulatePress('KeyW', true);
        await wait(3500);
        game.input.simulateRelease('KeyW');
        game.input.simulatePress('KeyL');
        await wait(600);
      }
      if (step === 'cockpit') {
        game.input.simulatePress('KeyC');
        await wait(500);
      }
      await wait(500);
      return s.screens.current;
    },
    /** Drives the truck with simulated keys and reports what happened. */
    async drive() {
      const truck = session.truck;
      const inp = game.input;
      const out: Record<string, unknown> = {};
      // Start on Hollow Creek Road, facing along it, so the test measures the truck, not the trees.
      const road = game.terrain.roads[0];
      const a = road.at(250);
      truck.phys.reset(a.x, game.terrain.heightAt(a.x, a.z) + 0.8, a.z, Math.atan2(a.tx, a.tz));
      await wait(800);
      const door = truck.driverDoorWorld();
      game.player.teleport(door.x + 0.6, game.terrain.heightAt(door.x, door.z), door.z, 0);
      await wait(300);
      session.enterVehicle(truck);
      out.mode = session.mode;
      const p0 = truck.position.clone();
      const trace: string[] = [];
      const snap = () => {
        const t = truck.phys.body.translation();
        const b = truck.phys.basis();
        trace.push(`(${t.x.toFixed(1)},${t.y.toFixed(1)},${t.z.toFixed(1)}) v=${truck.phys.speed.toFixed(1)} fwd=(${b.fx.toFixed(2)},${b.fz.toFixed(2)}) up=${b.uy.toFixed(2)} thr=${truck.phys.input.throttle} eng=${truck.phys.engineOn} occ=${truck.occupied}`);
      };
      snap();
      out.roadTangent = [a.tx, a.tz].map((n) => Number(n.toFixed(2)));
      // 2.5 s of throttle stays on the straight before the road bends.
      inp.simulatePress('KeyW', true);
      for (let k = 0; k < 5; k += 1) {
        await wait(500);
        snap();
      }
      out.trace = trace;
      out.kmhAfter2_5s = Number(truck.speedKmh.toFixed(1));
      out.gear = truck.phys.gear;
      out.movedM = Number(truck.position.distanceTo(p0).toFixed(1));
      inp.simulateRelease('KeyW');
      const vBrake = truck.speedKmh;
      const t0 = performance.now();
      inp.simulatePress('KeyS', true);
      while (truck.speedKmh > 1.5 && performance.now() - t0 < 8000) await wait(30);
      out.brakeFromKmh = Number(vBrake.toFixed(1));
      out.brakeSeconds = Number(((performance.now() - t0) / 1000).toFixed(2));
      await wait(1500);
      out.reverseKmh = Number(truck.speedKmh.toFixed(1));
      out.reversing = truck.phys.reversing;
      inp.simulateRelease('KeyS');
      await wait(1200);
      // Right turn from a rolling start.
      const b0 = truck.phys.basis();
      const h0 = Math.atan2(b0.fx, b0.fz);
      inp.simulatePress('KeyW', true);
      inp.simulatePress('KeyD', true);
      await wait(1500);
      inp.simulateRelease('KeyD');
      inp.simulateRelease('KeyW');
      const b1 = truck.phys.basis();
      let dh = Math.atan2(b1.fx, b1.fz) - h0;
      dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      out.headingChangeRightTurn = Number(dh.toFixed(2));
      inp.simulatePress('KeyS', true);
      await wait(1500);
      inp.simulateRelease('KeyS');
      await wait(500);
      out.upright = Number(truck.phys.basis().uy.toFixed(3));
      session.exitVehicle();
      out.modeAfterExit = session.mode;
      out.playerOnGround = Number((game.player.position.y - game.terrain.heightAt(game.player.position.x, game.player.position.z)).toFixed(2));
      out.ok = out.mode === 'vehicle' && out.modeAfterExit === 'foot' && (out.kmhAfter2_5s as number) > 25
        && (out.brakeSeconds as number) > 1 && (out.brakeSeconds as number) < 5
        && (out.headingChangeRightTurn as number) < -0.15 && out.reversing === true && (out.upright as number) > 0.9;
      return out;
    },
    stats() {
      const info = game.renderer.info;
      return {
        frameMs: Number(game.averageFrameMs().toFixed(1)),
        calls: info.render.calls,
        triangles: info.render.triangles,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        pos: [game.player.position.x, game.player.position.y, game.player.position.z].map((n) => Number(n.toFixed(1))),
        veg: game.vegetation?.stats(),
      };
    },
    atlas() {
      return game.vegetation.atlasDataUrl();
    },
    impostors() {
      return game.vegetation.impostorDataUrl();
    },
    /** GPU-synchronised render timing with subsystems toggled, at the current view. */
    bench() {
      const gl = game.renderer.getContext();
      const px = new Uint8Array(4);
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const time = (n = 12) => {
        for (let i = 0; i < 3; i += 1) game.renderOnce();
        sync();
        const t0 = performance.now();
        for (let i = 0; i < n; i += 1) game.renderOnce();
        sync();
        return Number(((performance.now() - t0) / n).toFixed(2));
      };
      const out: Record<string, number> = {};
      out.full = time();
      out.callsFull = game.renderer.info.render.calls;
      const structures = session.structures.group;
      structures.visible = false;
      out.noStructures = time();
      structures.visible = true;
      // Per-child breakdown: cost removed when each top-level structure is hidden.
      const groups = new Map<string, THREE.Object3D[]>();
      for (const c of structures.children) {
        const key = c.name || c.type;
        groups.set(key, [...(groups.get(key) ?? []), c]);
      }
      for (const [key, objs] of groups) {
        objs.forEach((o) => (o.visible = false));
        out[`-${key}`] = Number((out.full - time(6)).toFixed(1));
        objs.forEach((o) => (o.visible = true));
      }
      session.truck.root.visible = false;
      out.noTruck = time();
      session.truck.root.visible = true;
      const lights: THREE.Light[] = [];
      game.scene.traverse((o) => {
        const l = o as THREE.Light;
        if (l.isLight && !(l as THREE.DirectionalLight).isDirectionalLight && l.visible) lights.push(l);
      });
      out.extraLights = lights.length;
      const veg = game.vegetation.group;
      const terrain = game.terrainRenderer.group;
      game.renderer.shadowMap.autoUpdate = false;
      out.noShadowPass = time();
      game.renderer.shadowMap.autoUpdate = true;
      const kids = veg.children as THREE.Object3D[];
      const set = (pred: (o: THREE.Object3D) => boolean, v: boolean) => kids.forEach((o) => { if (pred(o)) o.visible = v; });
      const isCover = (o: THREE.Object3D) => (o as THREE.Mesh).material && ((o as THREE.Mesh).material as THREE.Material).name === 'cover';
      const isImp = (o: THREE.Object3D) => (o as THREE.InstancedMesh).geometry?.getAttribute('aSlot') !== undefined;
      set(isCover, false);
      out.noCover = time();
      set(isCover, true);
      set(isImp, false);
      out.noImpostors = time();
      set(isImp, true);
      set((o) => !isCover(o) && !isImp(o), false);
      out.noNearTrees = time();
      veg.visible = false;
      out.terrainOnly = time();
      terrain.visible = false;
      out.skyOnly = time();
      terrain.visible = true;
      veg.visible = true;
      set(() => true, true);
      return out;
    },
    ...extra,
  };
  (window as unknown as { __test: TestApi }).__test = api;
  return api;
}
