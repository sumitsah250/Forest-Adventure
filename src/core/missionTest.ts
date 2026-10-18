// Automated playthrough of the eight missions (test builds only, ?test).
// Movement between locations uses teleports; everything else goes through the
// real game: interactions, weapon inputs (simulated mouse and keys), the shared
// hit detection, NPC encounters, objective evaluation and the ending screen.

import * as THREE from 'three';
import type { Game } from './game.ts';
import type { Session } from '../game/session.ts';
import type { WeaponId } from '../weapons/defs.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runMissions(game: Game, session: Session, log: (s: string) => void, stopAfter = 8): Promise<{ ok: boolean; problems: string[]; reached: string }> {
  const ms = session.missions;
  const m = session.mystery;
  const ws = session.weapons;
  const inp = game.input;
  const problems: string[] = [];
  m.scriptSpeed = 14;
  ms.fast = true;
  session.godMode = true;

  const where = () => `M${ms.index + 1}.${ms.step + 1} ${(m.hudOverride?.() ?? m.currentObjective()).text}`;
  const until = async (pred: () => boolean, ms_: number, label: string) => {
    const t0 = performance.now();
    while (!pred()) {
      if (performance.now() - t0 > ms_) {
        problems.push(`timeout: ${label} (at ${where()})`);
        return false;
      }
      await wait(100);
    }
    return true;
  };
  const step = () => `${ms.index}.${ms.step}`;
  const started = async (i: number) => until(() => ms.index === i && (m.hudOverride?.()?.key ?? '') !== 'between', 10000, `mission ${i + 1} start`);
  /** Wait until the mission state moves past `s` (objective completed). */
  const advanced = async (s: string, label: string, t = 8000) => until(() => step() !== s || ms.ended, t, label);

  const stand = (p: THREE.Vector3, back = 1.3) => {
    if (session.mode === 'vehicle') session.exitVehicle();
    const g = game.terrain.heightAt(p.x, p.z);
    let best: { x: number; z: number } | null = null;
    for (let k = 0; k < 12 && !best; k += 1) {
      const a = (k / 12) * Math.PI * 2;
      const x = p.x + Math.cos(a) * back;
      const z = p.z + Math.sin(a) * back;
      if (Math.abs(game.terrain.heightAt(x, z) - g) < 1.2) best = { x, z };
    }
    best ??= { x: p.x + back, z: p.z };
    const fy = Math.max(game.terrain.heightAt(best.x, best.z), p.y - 1.4);
    game.player.teleport(best.x, fy, best.z, Math.atan2(-(p.x - best.x), -(p.z - best.z)));
  };
  const use = async (id: string) => {
    const it = session.interactions.get(id);
    if (!it) {
      problems.push(`missing interactable ${id}`);
      return false;
    }
    stand(it.position());
    await wait(300);
    const prompt = it.prompt();
    if (!prompt) {
      problems.push(`${id}: no prompt (at ${where()})`);
      return false;
    }
    it.use();
    await wait(250);
    while (m.busy) await wait(150);
    log(`  use ${id} [${prompt}] -> ${where()}`);
    return true;
  };
  const tap = async (code: string, ms_ = 120) => {
    inp.simulatePress(code, true);
    await wait(ms_);
    inp.simulateRelease(code);
    await wait(60);
  };
  /** Point the real camera ray at a world point (converges in a few frames). */
  const aimCam = async (target: THREE.Vector3) => {
    for (let i = 0; i < 4; i += 1) {
      const d = target.clone().sub(game.camera.position);
      game.player.yaw = Math.atan2(-d.x, -d.z);
      game.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      await wait(70);
    }
  };
  const best = (): WeaponId => (['marten', 'ironwood', 'vireo', 'ranger12', 'bridger', 'p9'] as WeaponId[]).find((id) => ws.has(id)) ?? 'p9';
  const ready = async (id: WeaponId) => {
    ws.select(id);
    await until(() => ws.current === id && ws.phase === 'ready', 4000, `draw ${id}`);
  };
  const fireOnce = async () => {
    inp.simulatePress('MouseLeft', true);
    await wait(90);
    inp.simulateRelease('MouseLeft');
    await wait(60);
  };
  const keepAmmo = () => {
    const o = ws.current ? ws.owned.get(ws.current) : null;
    if (!o) return;
    if (ws.reserve[o.def.ammo] < o.def.magSize * 2) {
      ws.addAmmo(o.def.ammo, o.def.magSize * 3);
      log(`  (test top-up: ${o.def.ammo})`);
    }
  };

  /** Fight an encounter with real shots until every member has surrendered. */
  const fight = async (groupId: string, approach: THREE.Vector3) => {
    const g = session.npcs.groups.get(groupId);
    if (!g) {
      problems.push(`encounter ${groupId} not spawned (at ${where()})`);
      return false;
    }
    const center = g.members.reduce((a, n) => a.add(n.renderPos), new THREE.Vector3()).multiplyScalar(1 / g.members.length);
    const dir = approach.clone().sub(center).setY(0).normalize();
    const p0 = center.clone().addScaledVector(dir, 20);
    game.player.teleport(p0.x, game.terrain.heightAt(p0.x, p0.z), p0.z);
    await ready(best());
    inp.simulatePress('MouseRight', true);
    const t0 = performance.now();
    let flank = 0;
    let shots = 0;
    const chestOf = (n: (typeof g.members)[number]) => n.renderPos.clone().add(new THREE.Vector3(0, 1.15, 0));
    const clearFrom = (eye: THREE.Vector3, n: (typeof g.members)[number]) => {
      const c = chestOf(n);
      const hit = session.combat.trace(eye, c.clone().sub(eye).normalize(), 200, session.combat.self);
      return !!hit && hit.target === n;
    };
    let lastProgress = performance.now();
    let hpSum = g.members.reduce((t, n) => t + Math.max(0, n.health), 0);
    while (g.alive > 0 && performance.now() - t0 < 150000) {
      const alive = g.members.filter((n) => n.state !== 'down');
      const eye = game.player.eyePosition;
      const n = alive.find((x) => clearFrom(eye, x)) ?? alive[0];
      const target = chestOf(n);
      ws.aimOverride = target;
      const d = target.clone().sub(eye);
      game.player.yaw = Math.atan2(-d.x, -d.z);
      game.player.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
      await fireOnce();
      shots += 1;
      const o = ws.current ? ws.owned.get(ws.current) : null;
      if (o && o.mag === 0) {
        keepAmmo();
        await tap('KeyR');
        await until(() => ws.reloadProgress === null, 6000, 'reload');
      }
      const now = g.members.reduce((t, x) => t + Math.max(0, x.health), 0);
      if (now < hpSum - 0.1) {
        hpSum = now;
        lastProgress = performance.now();
      } else if (performance.now() - lastProgress > 3000) {
        // Nobody hittable from here: move to a spot with a clear line to someone.
        flank += 1;
        let moved = false;
        for (const x of alive) {
          for (let k = 0; k < 12 && !moved; k += 1) {
            const ang = (k / 12) * Math.PI * 2 + flank;
            const p = x.renderPos.clone().add(new THREE.Vector3(Math.cos(ang) * 9, 0, Math.sin(ang) * 9));
            p.y = game.terrain.heightAt(p.x, p.z);
            if (game.terrain.waterAt(p.x, p.z)) continue;
            if (clearFrom(p.clone().add(new THREE.Vector3(0, 1.6, 0)), x)) {
              game.player.teleport(p.x, p.y, p.z);
              moved = true;
            }
          }
          if (moved) break;
        }
        lastProgress = performance.now();
        await wait(250);
      }
    }
    for (const n of g.members) {
      if (n.state === 'down') continue;
      const eye = game.player.eyePosition;
      const chest = n.renderPos.clone().add(new THREE.Vector3(0, 1.15, 0));
      const dir = chest.clone().sub(eye).normalize();
      const hit = session.combat.trace(eye, dir, 200, session.combat.self);
      const gy = game.terrain.heightAt(n.renderPos.x, n.renderPos.z);
      log(`  left: ${n.id} at (${n.renderPos.x.toFixed(1)}, ${n.renderPos.y.toFixed(2)}, ${n.renderPos.z.toFixed(1)}) ground ${gy.toFixed(2)} hp ${n.health.toFixed(0)} ${n.state}; trace -> ${hit ? `${hit.target ? hit.target.id : hit.surface} @${hit.dist.toFixed(1)} of ${eye.distanceTo(chest).toFixed(1)}` : 'nothing'}`);
    }
    ws.aimOverride = null;
    inp.simulateRelease('MouseRight');
    log(`  fight ${groupId}: ${g.alive === 0 ? 'all surrendered' : `${g.alive} left`} (${shots} trigger pulls, ${flank} flanks, condition ${session.health.toFixed(0)})`);
    return g.alive === 0;
  };

  const a = ms.sites.anchors;
  const st = session.structures.anchors;
  log(`start -> ${where()}`);

  // ---------------- Mission 1: Range Day
  let s = step();
  await use('range-lockbox');
  await use('pickup-rangeP9');
  await advanced(s, 'take pistol');
  s = step();
  await ready('p9');
  await advanced(s, 'draw');
  s = step();
  await tap('KeyH');
  await until(() => ws.phase === 'holstered', 3000, 'holster');
  await tap('KeyH');
  await advanced(s, 'redraw');
  // Firing line, facing down range.
  const line = new THREE.Vector3(SITES_RANGE_LINE.x, 0, SITES_RANGE_LINE.z);
  game.player.teleport(line.x, game.terrain.heightAt(line.x, line.z), line.z, -Math.PI / 2);
  await wait(400);
  s = step();
  inp.simulatePress('MouseRight', true);
  await aimCam(ms.sites.plates[0].center);
  await advanced(s, 'aim at plate', 4000);
  s = step();
  for (let pass = 0; pass < 3 && step() === s; pass += 1) {
    for (const p of ms.sites.plates) {
      await aimCam(p.center);
      await wait(250);
      await fireOnce();
      await wait(250);
    }
  }
  await advanced(s, 'ring plates');
  s = step();
  inp.simulateRelease('MouseRight');
  keepAmmo();
  await tap('KeyR');
  await advanced(s, 'reload', 5000);
  s = step();
  inp.simulatePress('MouseRight', true);
  for (let pass = 0; pass < 4 && step() === s; pass += 1) {
    for (const p of ms.sites.papers) {
      await aimCam(p.center.clone().add(new THREE.Vector3(0, -0.1, 0)));
      await wait(300);
      await fireOnce();
      await wait(250);
      const o = ws.owned.get('p9')!;
      if (o.mag < 2) {
        keepAmmo();
        await tap('KeyR');
        await wait(2000);
      }
    }
  }
  inp.simulateRelease('MouseRight');
  await advanced(s, 'qualify');
  await started(1);
  log(`M1 done -> ${where()}`);
  if (stopAfter === 1) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 2: The Silent Station
  await use('station-door');
  await use('logbook');
  await use('station-locker');
  await use('pickup-lockerShotgun');
  await use('wall-map');
  await use('radio');
  await use('generator');
  await use('jerrycan');
  await use('generator');
  await use('generator');
  await use('power-box');
  await use('radio');
  await use('key');
  if (st.bridgeTracks) stand(st.bridgeTracks);
  await started(2);
  log(`M2 done -> ${where()}`);
  if (stopAfter === 2) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 3: The Lost Patrol
  await use('tracks');
  game.player.teleport(-2, game.terrain.heightAt(-2, -106), -106, 0);
  await wait(500);
  await use('gate');
  await use('skids');
  await use('wreck');
  await use('pickup-wreckRevolver');
  await until(() => !!session.npcs.groups.get('wreck'), 5000, 'wreck ambush spawn');
  await fight('wreck', new THREE.Vector3(-90, 0, -128));
  await use('tape');
  await use('cabin-door');
  await until(() => m.has('metHale'), 30000, 'meet Hale');
  await started(3);
  log(`M3 done -> ${where()}`);
  if (stopAfter === 3) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 4: Protect the Ranger Route
  const door = session.truck.driverDoorWorld();
  game.player.teleport(door.x + 0.6, game.terrain.heightAt(door.x, door.z), door.z, 0);
  await wait(300);
  session.enterVehicle(session.truck);
  await wait(500);
  await tap('KeyT');
  await until(() => m.has('calledMedevac'), 30000, 'medevac call');
  session.exitVehicle();
  await fight('roadblock', new THREE.Vector3(-60, 0, -158));
  await use('roadblock-truck');
  await until(() => ms.flags.has('rescued'), 40000, 'rescue');
  await started(4);
  log(`M4 done -> ${where()}`);
  if (stopAfter === 4) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 5: The Hidden Supply Cache
  session.screens.show('map', 'pause');
  await wait(300);
  session.resume();
  stand(a.cache, 6);
  await wait(500);
  await use('cache-tracks');
  await use('cache-branches');
  await use('take-cutters');
  await use('cache-chain');
  await use('cache-hatch');
  await use('pickup-cacheRifle');
  await use('cache-ledger');
  await started(5);
  log(`M5 done -> ${where()}`);
  if (stopAfter === 5) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 6: Clear the Blocked Route
  game.player.teleport(15, game.terrain.heightAt(15, -106), -106, -1.5);
  await wait(600);
  inp.simulatePress('Tab', true);
  await wait(400);
  inp.simulateRelease('Tab');
  await ready('marten');
  await fight('blockade', new THREE.Vector3(0, 0, -106));
  await use('blockade-truck');
  const log6 = a.blockadeLog;
  session.truck.phys.reset(log6.x - 12, game.terrain.heightAt(log6.x - 12, log6.z - 4) + 0.8, log6.z - 4, 1.5);
  await wait(800);
  await use('blockade-log');
  await started(6);
  log(`M6 done -> ${where()}`);
  if (stopAfter === 6) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 7: Track the Source
  session.screens.show('journal', 'pause');
  await wait(300);
  session.resume();
  await use('atv-tracks');
  await fight('camp', new THREE.Vector3(120, 0, -200));
  await use('pickup-campDmr');
  await use('camp-notes');
  await started(7);
  log(`M7 done -> ${where()}`);
  if (stopAfter === 7) return { ok: problems.length === 0, problems, reached: where() };

  // ---------------- Mission 8: Final Forest Operation
  await ready('longwatch');
  await fight('meeting', new THREE.Vector3(40, 0, 215));
  await use('kessler-cuff');
  const d2 = session.truck.driverDoorWorld();
  game.player.teleport(d2.x + 0.6, game.terrain.heightAt(d2.x, d2.z), d2.z, 0);
  await wait(300);
  session.enterVehicle(session.truck);
  await wait(600);
  await tap('KeyT');
  await until(() => ms.ended, 40000, 'final report');
  await until(() => session.screens.current === 'ending', 9000, 'ending screen');
  const screen = session.screens.current;
  log(`end: ended=${ms.ended} screen=${screen} -> ${where()}`);
  if (screen !== 'ending') problems.push('ending screen not shown');
  return { ok: problems.length === 0 && ms.ended, problems, reached: where() };
}

const SITES_RANGE_LINE = { x: 86, z: 222 };
