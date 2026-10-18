// Automated browser checks using the locally installed Chrome (or Edge).
//
//   node scripts/browser-test.mjs shots [quality] [names]  - screenshots from scripted viewpoints
//   node scripts/browser-test.mjs play [quality]           - scripted gameplay walkthrough
//   node scripts/browser-test.mjs perf [quality]           - frame-time sample along the road
//
// Starts its own Vite dev server, writes PNGs to test-results/ and exits non-zero
// on page errors or failed checks.

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'shots';
const quality = process.argv[3] ?? 'medium';
const only = process.argv[4] ? process.argv[4].split(',') : null;
const port = 5199;
const outDir = join(root, 'test-results');
await mkdir(outDir, { recursive: true });

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const executablePath = CHROME_PATHS.find((p) => existsSync(p));

function startServer() {
  return new Promise((resolve, reject) => {
    const vite = join(root, 'node_modules/vite/bin/vite.js');
    const proc = spawn(process.execPath, [vite, '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false;
    const onData = (d) => {
      const s = d.toString();
      if (!done && /Local:|ready in/i.test(s)) { done = true; resolve(proc); }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => { if (!done) reject(new Error(`vite exited ${code}`)); });
    setTimeout(() => { if (!done) { done = true; resolve(proc); } }, 15000);
  });
}

const VIEWS = {
  trailhead: { x: 58.5, z: 238.5, yaw: 0.35, pitch: -0.05 },
  truck: { x: 56, z: 236, yaw: -0.9, pitch: -0.12 },
  road_south: { x: 30, z: 190, yaw: 0.55, pitch: -0.04 },
  forest: { x: 90, z: 150, yaw: 2.2, pitch: 0.02 },
  suv: { x: -20, z: 120, yaw: -2.6, pitch: -0.1 },
  station: { x: 40, z: 12, yaw: -1.25, pitch: -0.05 },
  bridge: { x: 5, z: -60, yaw: 0.2, pitch: -0.18 },
  ford: { x: 62, z: -60, yaw: 0.1, pitch: -0.15 },
  gate: { x: -2, z: -104, yaw: 0.25, pitch: -0.05 },
  ravine: { x: -66, z: -160, yaw: 0.9, pitch: -0.3 },
  cabin: { x: -114, z: -150, yaw: 0.75, pitch: -0.05 },
  lookout: { x: -95, z: -232, yaw: 0.8, pitch: 0.1 },
  creek: { x: -40, z: -84, yaw: 1.6, pitch: -0.12 },
  creekBank: { x: 30, z: -66, yaw: 1.2, pitch: 0.05 },
  roadclose: { x: 34, z: 196, yaw: 0.55, pitch: -0.95 },
  truck2: { x: 57.5, z: 226.2, yaw: -2.21, pitch: -0.1 },
  stationFront: { x: 52, z: 6, yaw: -1.75, pitch: 0.02 },
  stationInside: { x: 66.5, z: -0.5, yaw: 1.2, pitch: -0.15, y: 7.2 },
  generator: { x: 66, z: 11, yaw: -0.4, pitch: -0.15 },
  bridgeClose: { x: 4, z: -66, yaw: 0.05, pitch: -0.25 },
  gateView: { x: -3.5, z: -101, yaw: 0.3, pitch: -0.05 },
  towerView: { x: -96, z: -236, yaw: 0.75, pitch: 0.18 },
  cabinView: { x: -122, z: -158, yaw: 0.6, pitch: -0.02 },
  suvView: { x: -21, z: 117, yaw: -0.81, pitch: -0.12 },
  wreckView: { x: -73, z: -150, yaw: 2.6, pitch: -0.35 },
  campView: { x: 36, z: -146, yaw: -0.8, pitch: -0.2 },
  truck3: { x: 68.5, z: 236.5, yaw: 0.75, pitch: -0.12 },
  // Forest close-ups and distant stands, used to judge tree realism.
  treesNear: { x: 104, z: 128, yaw: 2.6, pitch: 0.12 },
  treesUp: { x: 104, z: 128, yaw: 1.2, pitch: 0.55 },
  treesCreek: { x: -60, z: -100, yaw: -1.9, pitch: 0.05 },
  treesFar: { x: -103, z: -242, yaw: 0.6, pitch: -0.06, y: 34 },
  treesEdge: { x: 20, z: 160, yaw: -2.2, pitch: 0.04 },
};

const server = await startServer();
let failed = false;
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = mode === 'touch'
    ? await (await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })).newPage()
    : await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (msg) => {
    if (msg.text().startsWith('[missions]')) console.log(msg.text());
    if (msg.type() === 'error' || msg.type() === 'warning') {
      const text = msg.text();
      if (msg.type() === 'error') errors.push(text);
      console.log(`[browser ${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (err) => { errors.push(String(err)); console.log(`[pageerror] ${err}`); });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/?test&quality=${quality}&mode=${mode}${mode === 'ui' ? '&title' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(`Game failed to start: ${err}`);
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log(`GPU: ${gpu}`);

  if (mode === 'dusk') {
    const views = { duskRoad: { x: 30, z: 190, yaw: 0.55, pitch: -0.04 }, duskStation: { x: 52, z: 6, yaw: -1.75, pitch: 0.02 }, duskInside: { x: 66.5, z: -0.5, yaw: 1.2, pitch: -0.15, y: 7.2 }, duskCabin: { x: -122, z: -158, yaw: 0.6, pitch: -0.02 }, duskTruck: { x: 56, z: 236, yaw: -0.9, pitch: -0.12 } };
    await page.evaluate(() => window.__test.env({ dusk: 0.88, power: true, flashlight: true, headlights: true }));
    for (const [name, v] of Object.entries(views)) {
      await page.evaluate((view) => window.__test.view(view), v);
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
      console.log(`shot ${name}`);
    }
  } else if (mode === 'bench') {
    for (const [name, v] of Object.entries(VIEWS)) {
      if (only && !only.includes(name)) continue;
      await page.evaluate((view) => window.__test.view(view), v);
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => window.__test.bench());
      console.log(`bench ${name}: ${JSON.stringify(r)}`);
    }
  } else if (mode === 'cams') {
    // Free-camera shots (aerial and long views); names filter with the 4th argument.
    const CAMS = {
      aerialValley: { x: -40, y: 70, z: -40, tx: 40, ty: 10, tz: 60 },
      aerialRidge: { x: -150, y: 60, z: -260, tx: -60, ty: 10, tz: -150 },
      lookoutView: { x: -104, y: 44, z: -246, tx: -20, ty: 20, tz: -120 },
      roadside: { x: 28, y: 15.5, z: 186, tx: 60, ty: 14, tz: 170 },
      trunkBase: { x: 101.5, y: 12, z: 129, tx: 106, ty: 10.5, tz: 124 },
      // Mission locations.
      siteRange: { x: 83.5, y: 18.2, z: 226, tx: 100, ty: 16.6, tz: 221 },
      siteRangeBench: { x: 84.8, y: 17.6, z: 219.6, tx: 87, ty: 16.9, tz: 222.4 },
      siteRoadblock: { x: -44, y: 16.5, z: -132, tx: -31, ty: 11.2, tz: -141 },
      siteCache: { x: 86.5, y: 21.6, z: -178.5, tx: 92, ty: 19.6, tz: -183 },
      siteBlockade: { x: 30, y: 6.5, z: -104, tx: 52, ty: 3.6, tz: -99 },
      siteCamp: { x: 128, y: 22, z: -196, tx: 150, ty: 17.5, tz: -207 },
      siteMeeting: { x: 58, y: 20.8, z: 236, tx: 72, ty: 20.5, tz: 252 },
    };
    for (const [name, c] of Object.entries(CAMS)) {
      if (only && !only.includes(name)) continue;
      await page.evaluate((cc) => window.__test.cam(cc), c);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(outDir, `${name}-${quality}.png`) });
      const stats = await page.evaluate(() => window.__test.stats());
      const camInfo = await page.evaluate(() => {
        const c = window.__game.camera;
        const up = new c.up.constructor(0, 1, 0).applyQuaternion(c.quaternion);
        return { fov: c.fov, aspect: c.aspect, up: [up.x, up.y, up.z].map((n) => Number(n.toFixed(2))), camUp: [c.up.x, c.up.y, c.up.z], parent: c.parent ? c.parent.type : null, ctrl: !!window.__game.cameraController };
      });
      console.log(`cam ${name}: ${JSON.stringify(stats)} ${JSON.stringify(camInfo)}`);
    }
  } else if (mode === 'chars') {
    // Character showcase: front, side and back, standing and moving.
    const setups = [
      ['idle', { speed: 0 }],
      ['walk', { speed: 1.6 }],
      ['run', { speed: 4.2 }],
      ['sprint', { speed: 5.8 }],
      ['kneel', { speed: 0, pose: 'surrender' }],
      ['down', { speed: 0, pose: 'down' }],
      ['sit', { speed: 0, pose: 'sit' }],
    ];
    const cams = {
      front: { x: 60.8, y: 0, z: 233.2, tx: 60.8, ty: 0, tz: 228 },
      side: { x: 53.5, y: 0, z: 228.6, tx: 58, ty: 0, tz: 228 },
      back: { x: 60.8, y: 0, z: 222.8, tx: 60.8, ty: 0, tz: 228 },
      close: { x: 58.9, y: 0, z: 229.9, tx: 58, ty: 0, tz: 228 },
    };
    for (const [name, setup] of setups) {
      if (only && !only.includes(name)) continue;
      await page.evaluate((st) => window.__test.showcase(st), setup);
      for (const [cn, c] of Object.entries(cams)) {
        if (setup.speed > 0 && cn === 'close') continue;
        const gy = await page.evaluate((cc) => window.__game.terrain.heightAt(cc.x, cc.z), c);
        await page.evaluate((cc) => window.__test.cam(cc), { ...c, y: gy + (cn === 'close' ? 1.65 : 1.15), ty: gy + (cn === 'close' ? 1.55 : 0.95) });
        await page.waitForTimeout(setup.speed > 0 ? 450 : 700);
        await page.screenshot({ path: join(outDir, `char-${name}-${cn}.png`) });
      }
      console.log(`chars ${name} done`);
    }
  } else if (mode === 'gait') {
    // Numeric gait trace: root vs feet over time (debugging foot planting).
    await page.evaluate(() => window.__test.showcase({ speed: 1.6 }));
    await page.waitForTimeout(500);
    for (let i = 0; i < 16; i += 1) {
      const row = await page.evaluate(() => {
        const c = window.__show[0];
        const a = c.anim;
        const r = c.root.position;
        const f = a.feet;
        return { t: performance.now() | 0, root: r.z.toFixed(2), phase: a.phase.toFixed(2), hipsY: a.hipsY.toFixed(3),
          L: [f[0].cur.z.toFixed(2), f[0].swing], R: [f[1].cur.z.toFixed(2), f[1].swing], paused: window.__game.paused };
      });
      console.log(JSON.stringify(row));
      await page.waitForTimeout(100);
    }
  } else if (mode === 'guns') {
    // Weapon model sheet: two columns (pistols and long guns), side profile.
    const gy = await page.evaluate(() => window.__game.terrain.heightAt(60, 228));
    await page.evaluate((y) => window.__test.gunShowcase({ x: 60, y: y + 2.6, z: 228, spacing: 0.27, side: true }), gy);
    const views = {
      gunsAll: { x: 60.35, y: gy + 1.65, z: 230.3, tx: 60.35, ty: gy + 1.65, tz: 228 },
      gunsTop: { x: 60.2, y: gy + 2.2, z: 229.0, tx: 60.2, ty: gy + 2.2, tz: 228 },
      gunsLow: { x: 60.35, y: gy + 1.0, z: 229.25, tx: 60.35, ty: gy + 1.0, tz: 228 },
    };
    for (const [name, c] of Object.entries(views)) {
      await page.evaluate((cc) => window.__test.cam(cc), c);
      await page.waitForTimeout(900);
      await page.screenshot({ path: join(outDir, `${name}.png`) });
      console.log(`guns ${name}`);
    }
  } else if (mode === 'combat') {
    // Poachers detect, take cover and fire; the player defeats them with real shots.
    const setup = await page.evaluate(() => window.__test.combatSetup({ weapon: 'marten', god: true }));
    console.log(`setup ${JSON.stringify(setup)}`);
    // Draw the rifle and wait while the crew notices (standing in the open, 25 m away).
    await page.waitForTimeout(1200);
    const log = [];
    for (let k = 0; k < 14; k += 1) {
      await page.waitForTimeout(700);
      const s = await page.evaluate(() => window.__test.npcState());
      log.push(s);
      if (k === 8) await page.screenshot({ path: join(outDir, 'combat-engaged.png') });
    }
    for (const s of log) console.log(`  t: ${s.npcs.map((n) => `${n.id}:${n.state}/${n.phase} see=${n.seeing} aim=${n.aim} mag=${n.mag} cover=${n.cover} tgt=${n.tgt} v=${n.v} d=${n.d}`).join(' | ')}`);
    console.log(`npc shots=${log[log.length - 1].npcShots} lowest player condition=${Math.min(...log.map((s) => s.player))}`);
    const engaged = log.some((s) => s.npcs.some((n) => n.state === 'combat'));
    const damaged = log.some((s) => s.player < 100);
    console.log(`engaged=${engaged} playerDamaged=${damaged} ${JSON.stringify(log[log.length - 1])}`);
    // Defeat each NPC with aimed fire.
    await page.evaluate(() => window.__test.hold('MouseRight', true));
    for (let i = 0; i < 3; i += 1) {
      const t0 = Date.now();
      let lastHp = 1e9;
      let lastProgress = Date.now();
      let flank = 0;
      while (Date.now() - t0 < 25000) {
        const st = await page.evaluate((n) => window.__test.aimAtNpc(n), i);
        if (st === 'down') break;
        // No damage for 4 s (target behind cover): flank to a new angle.
        const hp = (await page.evaluate(() => window.__test.npcState())).npcs[i].hp;
        if (hp < lastHp) {
          lastHp = hp;
          lastProgress = Date.now();
        } else if (Date.now() - lastProgress > 4000) {
          flank += 1;
          await page.evaluate(([n, f]) => window.__test.flankNpc(n, 14, f % 2 ? 1.1 : -1.1), [i, flank]);
          lastProgress = Date.now();
          await page.waitForTimeout(400);
        }
        await page.evaluate(() => window.__test.hold('MouseLeft', true));
        await page.waitForTimeout(220);
        await page.evaluate(() => window.__test.hold('MouseLeft', false));
        await page.waitForTimeout(120);
        const ws = await page.evaluate(() => window.__test.wpnState());
        if (ws.mag === 0) {
          await page.evaluate(() => window.__test.tap('KeyR'));
          await page.waitForTimeout(3000);
        }
      }
      if (i === 1) await page.screenshot({ path: join(outDir, 'combat-firefight.png') });
    }
    await page.evaluate(() => window.__test.aimAtNpc(null));
    await page.evaluate(() => window.__test.hold('MouseRight', false));
    await page.waitForTimeout(1500);
    const end = await page.evaluate(() => window.__test.npcState());
    const ws = await page.evaluate(() => window.__test.wpnState());
    await page.screenshot({ path: join(outDir, 'combat-surrendered.png') });
    const allDown = end.npcs.every((n) => n.state === 'down');
    console.log(`end ${JSON.stringify(end)} fired=${ws.fired} hit=${ws.hit}`);
    console.log(`combat ok=${engaged && allDown}`);
    if (!engaged || !allDown) failed = true;
  } else if (mode === 'poses') {
    // Side views of the weapon holds: ready, aimed, mid-reload.
    await page.evaluate(() => window.__test.wpnSetup());
    const ids = ['p9', 'bridger', 'ranger12', 'vireo', 'marten', 'ironwood', 'ridgeline', 'longwatch'];
    for (const id of ids) {
      if (only && !only.includes(id)) continue;
      await page.evaluate((w) => window.__test.wpnSelect(w), id);
      await page.waitForTimeout(900);
      const cam = await page.evaluate(() => window.__test.wpnFreezeAim(true));
      await page.evaluate((c) => window.__test.cam(c), cam);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(outDir, `pose-${id}-ready.png`) });
      await page.evaluate(() => window.__test.hold('MouseRight', true));
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(outDir, `pose-${id}-aim.png`) });
      await page.evaluate(() => window.__test.tap('MouseLeft'));
      await page.waitForTimeout(60);
      await page.screenshot({ path: join(outDir, `pose-${id}-shot.png`) });
      await page.evaluate(() => window.__test.hold('MouseLeft', false));
      await page.evaluate(() => window.__test.hold('MouseRight', false));
      await page.waitForTimeout(1300);
      await page.evaluate(() => window.__test.tap('KeyR'));
      await page.waitForTimeout(id === 'ranger12' || id === 'ridgeline' ? 700 : 650);
      await page.screenshot({ path: join(outDir, `pose-${id}-reload.png`) });
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.__test.cam(null));
      await page.evaluate(() => window.__test.wpnFreezeAim(false));
      console.log(`poses ${id}`);
    }
  } else if (mode === 'weapons') {
    // Every weapon: draw, aim, fire at a tree, reload; checks ammo bookkeeping.
    const setup = await page.evaluate(() => window.__test.wpnSetup());
    console.log(`setup ${JSON.stringify(setup)}`);
    const ids = ['p9', 'bridger', 'ranger12', 'vireo', 'marten', 'ironwood', 'ridgeline', 'longwatch'];
    const report = [];
    for (const id of ids) {
      if (only && !only.includes(id)) continue;
      await page.evaluate((w) => window.__test.wpnSelect(w), id);
      await page.waitForTimeout(1300);
      await page.screenshot({ path: join(outDir, `wpn-${id}-ready.png`) });
      const s0 = await page.evaluate(() => window.__test.wpnState());
      await page.evaluate(() => window.__test.hold('MouseRight', true));
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(outDir, `wpn-${id}-aim.png`) });
      // Fire three shots (holding for automatics).
      const auto = id === 'vireo' || id === 'marten';
      if (auto) {
        await page.evaluate(() => window.__test.hold('MouseLeft', true));
        await page.waitForTimeout(260);
        await page.evaluate(() => window.__test.hold('MouseLeft', false));
      } else {
        for (let k = 0; k < 3; k += 1) {
          await page.evaluate(() => window.__test.tap('MouseLeft'));
          await page.waitForTimeout(80);
          if (k === 0) await page.screenshot({ path: join(outDir, `wpn-${id}-fire.png`) });
          await page.evaluate(() => window.__test.hold('MouseLeft', false));
          await page.waitForTimeout(id === 'ridgeline' ? 1200 : id === 'ranger12' ? 950 : id === 'bridger' ? 500 : 420);
        }
      }
      await page.waitForTimeout(300);
      const s1 = await page.evaluate(() => window.__test.wpnState());
      await page.evaluate(() => window.__test.hold('MouseRight', false));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__test.tap('KeyR'));
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `wpn-${id}-reload.png`) });
      await page.waitForTimeout(id === 'ranger12' || id === 'ridgeline' ? 2600 : 2600);
      const s2 = await page.evaluate(() => window.__test.wpnState());
      const shots = s0.mag - s1.mag;
      const refilled = s2.mag - s1.mag;
      const ok = shots >= 1 && s1.fired > s0.fired && refilled > 0 && s2.reserve === s1.reserve - refilled && s2.mag <= (s0.mag);
      report.push({ id, ok, magBefore: s0.mag, afterFire: s1.mag, afterReload: s2.mag, reserve: [s0.reserve, s1.reserve, s2.reserve], hits: s1.hit - s0.hit, blocked: s1.blocked });
      console.log(JSON.stringify(report[report.length - 1]));
      if (!ok) failed = true;
    }
    // Scope view with the marksman rifle.
    if (!only || only.includes('scope')) {
      await page.evaluate(() => window.__test.wpnSelect('longwatch'));
      await page.waitForTimeout(1200);
      await page.evaluate(() => window.__test.hold('MouseRight', true));
      await page.waitForTimeout(1200);
      await page.screenshot({ path: join(outDir, 'wpn-longwatch-scope.png') });
      await page.evaluate(() => window.__test.hold('MouseRight', false));
    }
    await writeFile(join(outDir, 'weapons-report.json'), JSON.stringify(report, null, 2));
  } else if (mode === 'calls') {
    const v = { x: 58.5, z: 238.5, yaw: 0.35, pitch: -0.05 };
    await page.evaluate((view) => window.__test.view(view), v);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => {
      const g = window.__game;
      const calls = () => { g.renderOnce(); return g.renderer.info.render.calls; };
      const full = calls();
      const out = { full };
      for (const c of g.scene.children) {
        if (!c.visible) continue;
        c.visible = false;
        const d = full - calls();
        c.visible = true;
        if (d > 4) out[`${c.name || c.type}`] = (out[`${c.name || c.type}`] ?? 0) + d;
      }
      return out;
    });
    console.log(JSON.stringify(r));
  } else if (mode === 'savegame') {
    // Play to the end of Mission 3, save, reload with Continue, compare state.
    await page.goto(`http://localhost:${port}/?test&savetest&quality=${quality}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
    const run = await page.evaluate(() => window.__test.missions(3));
    console.log(`played: ok=${run.ok} reached=${run.reached} ${run.problems.join('; ')}`);
    const before = await page.evaluate(() => window.__test.saveState());
    const bytes = await page.evaluate(() => window.__test.saveNow());
    await page.goto(`http://localhost:${port}/?test&savetest&continue&quality=${quality}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__test.saveState());
    const npcClock = await page.evaluate(async () => {
      const n = window.__session.npcs.all.find((x) => x.id === 'r2');
      const t0 = n.time;
      await new Promise((r) => setTimeout(r, 1000));
      return { t0, t1: n.time, playing: window.__session.playing, paused: window.__game.paused };
    });
    console.log(`npc clock after continue ${JSON.stringify(npcClock)}`);
    console.log(`save ${bytes} bytes`);
    console.log(`before ${JSON.stringify(before)}`);
    console.log(`after  ${JSON.stringify(after)}`);
    const same = JSON.stringify(before) === JSON.stringify(after);
    console.log(`savegame ok=${same}`);
    await page.screenshot({ path: join(outDir, 'savegame-continue.png') });
    await page.evaluate(() => localStorage.clear());
    if (!same || !run.ok) failed = true;
  } else if (mode === 'missions') {
    const result = await page.evaluate(() => window.__test.missions());
    console.log(JSON.stringify({ ok: result.ok, problems: result.problems, reached: result.reached }, null, 2));
    await page.screenshot({ path: join(outDir, 'missions-end.png') });
    if (!result.ok) failed = true;
  } else if (mode === 'camdebug') {
    await page.evaluate(() => window.__test.cam({ x: 84.8, y: 17.6, z: 219.6, tx: 87, ty: 16.9, tz: 222.4 }));
    const samples = await page.evaluate(() => new Promise((resolve) => {
      const out = [];
      const g = window.__game;
      let n = 0;
      const tick = () => {
        const c = g.camera;
        const up = new c.up.constructor(0, 1, 0).applyQuaternion(c.quaternion);
        out.push(`${up.y.toFixed(2)} p=${g.player.pitch.toFixed(2)} bt=${g.blendT.toFixed(2)} paused=${g.paused}`);
        n += 1;
        if (n < 60) requestAnimationFrame(tick);
        else resolve(out);
      };
      requestAnimationFrame(tick);
    }));
    console.log(samples.join(' | '));
  } else if (mode === 'shots') {
    for (const [name, v] of Object.entries(VIEWS)) {
      if (only && !only.includes(name)) continue;
      await page.evaluate((view) => window.__test.view(view), v);
      await page.waitForTimeout(900);
      const file = join(outDir, `${name}-${quality}.png`);
      await page.screenshot({ path: file });
      const stats = await page.evaluate(() => window.__test.stats());
      console.log(`shot ${name}: ${JSON.stringify(stats)}`);
    }
  } else if (mode === 'play') {
    const result = await page.evaluate(() => window.__test.play());
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) failed = true;
    for (const shot of result.shots ?? []) {
      await page.evaluate((s) => window.__test.view(s.view), shot);
      await page.waitForTimeout(600);
      await page.screenshot({ path: join(outDir, `play-${shot.name}.png`) });
    }
  } else if (mode === 'touch') {
    await page.waitForTimeout(1500);
    const vis = await page.evaluate(() => getComputedStyle(document.querySelector('.touch')).display);
    console.log(`touch controls display: ${vis}`);
    await page.screenshot({ path: join(outDir, 'touch-phone.png') });
    // Push the stick forward for a second and check the player moved.
    const box = await page.evaluate(() => { const r = document.querySelector('.touch-stick').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    const before = await page.evaluate(() => window.__game.player.position.toArray());
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x, y: box.y - 50 }] });
    await page.waitForTimeout(1200);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await page.evaluate(() => window.__game.player.position.toArray());
    const moved = Math.hypot(after[0] - before[0], after[2] - before[2]);
    console.log(`touch joystick moved player ${moved.toFixed(2)} m`);
    if (vis === 'none' || moved < 0.5) failed = true;
  } else if (mode === 'ui') {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(outDir, 'ui-title.png') });
    for (const step of ['begin', 'journal', 'map', 'resume', 'drive', 'cockpit']) {
      const screen = await page.evaluate((s) => window.__test.ui(s), step);
      await page.screenshot({ path: join(outDir, `ui-${step}.png`) });
      console.log(`ui ${step}: screen=${screen}`);
    }
  } else if (mode === 'atlas') {
    const url = await page.evaluate(() => window.__test.atlas());
    await writeFile(join(outDir, 'atlas.png'), Buffer.from(url.split(',')[1], 'base64'));
    const imp = await page.evaluate(() => window.__test.impostors());
    await writeFile(join(outDir, 'impostors.png'), Buffer.from(imp.split(',')[1], 'base64'));
    console.log('wrote atlas.png, impostors.png');
  } else if (mode === 'perf') {
    const result = await page.evaluate(() => window.__test.perf());
    console.log(JSON.stringify(result, null, 2));
    await writeFile(join(outDir, `perf-${quality}.json`), JSON.stringify({ gpu, ...result }, null, 2));
  } else if (mode === 'walk') {
    const result = await page.evaluate(() => window.__test.walk());
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) failed = true;
    await page.screenshot({ path: join(outDir, 'walk-station.png') });
  } else if (mode === 'drive') {
    const result = await page.evaluate(() => window.__test.drive());
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) failed = true;
    await page.screenshot({ path: join(outDir, `drive-${quality}.png`) });
  }
  if (errors.length) {
    console.log(`\n${errors.length} console error(s)`);
    failed = true;
  }
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  await browser.close();
  server.kill();
}
process.exit(failed ? 1 : 0);
