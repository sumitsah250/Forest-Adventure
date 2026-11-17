// Campus Quest browser checks with the local Chrome / Edge (playwright-core).
//
//   node scripts/campus-test.mjs shots     # title + viewpoints around campus → test-results/campus-*.png
//   node scripts/campus-test.mjs play      # plays the whole story through the real UI to the ending
//   node scripts/campus-test.mjs play low 2   # the same for story version 2 (the ten-mission rewrite)
//
// Starts its own Vite server on port 5198. Add `low` / `medium` / `high` to pick a preset, then 1 or 2 for the story version.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'shots';
const quality = process.argv[3] ?? 'medium';
const story = process.argv[4] === '2' ? '2' : '1';
const port = 5198;
const outDir = join(root, 'test-results');
await mkdir(outDir, { recursive: true });
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    let done = false;
    proc.stdout.on('data', (d) => {
      if (!done && /Local:|ready in/i.test(d.toString())) { done = true; resolve(proc); }
    });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => { if (!done) reject(new Error(`vite exited ${code}`)); });
  });
}

const server = await startServer();
// Headless so no window pops up over the desktop (and nobody clicks into a test run).
const browser = await chromium.launch({ executablePath, headless: !process.argv.includes('--show'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,760'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}] ${m.text()}`); });
const t0 = Date.now();
await page.goto(`http://localhost:${port}/campus.html?test&quality=${quality}&story=${story}`);
await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
const err = await page.evaluate(() => window.__error);
if (err) throw new Error(err);
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name) => {
  await page.screenshot({ path: join(outDir, `campus-${name}.png`) });
  console.log(`  ${name}.png`);
};

try {
  await wait(2500);
  await shot('title');
  // Start a new story through the title menu (from a clean profile).
  await page.evaluate(() => localStorage.removeItem('campus-blackout-profile-v1'));
  // Story 2 asks for a name and roll number first (screens.ts).
  if (await page.$('form.cq-name')) {
    const inputs = await page.$$('form.cq-name input');
    await inputs[0].fill('Test Player');
    if (inputs[1]) await inputs[1].fill('PAS078BCT001');
    await page.click('form.cq-name button[type=submit], form.cq-name .cq-btn');
    await wait(1200);
  }
  await page.click('.cq-menu .cq-btn >> text=/Start the story|Restart story/');
  await wait(1500);
  for (let i = 0; i < 6 && (await page.$('.cq-dialog')); i += 1) {
    await page.keyboard.press('KeyE');
    await wait(150);
  }
  const ov = await page.$('.cq-overlay--click');
  if (ov) await ov.click();
  await wait(800);
  await shot('start');

  if (mode === 'shots') {
    const views = [
      ['admin', 112, -150, 2.6, -0.08],
      ['library', 25, 5, 0.9, -0.05],
      ['ground', -60, 60, -0.6, -0.04],
      ['workshops', 230, -20, 1.3, -0.05],
      ['north', -40, 10, -0.35, 0.12],
      ['hostels', -40, 140, -0.5, -0.05],
    ];
    for (const [name, x, z, yaw, pitch] of views) {
      await page.evaluate(([x, z, yaw, pitch]) => {
        const c = window.__campus;
        c.player.teleport(x, c.ground.heightAt(x, z), z, yaw);
        c.player.pitch = pitch;
      }, [x, z, yaw, pitch]);
      await wait(1800);
      await shot(name);
    }
    await page.keyboard.press('KeyM');
    await wait(600);
    await shot('map');
    await page.keyboard.press('KeyM');
  } else {
    // Play the whole story through the real UI: stand at each objective (teleport), press E,
    // read dialogue, answer quizzes and solve puzzles from the test answer keys, get into
    // Kalki and drive Mission 2's rings for real (autopilot), teleport Kalki for later runs.
    let lastKey = '';
    let same = 0;
    for (let guard = 0; guard < 6000; guard += 1) {
      const s = await page.evaluate(() => {
        const c = window.__campus;
        const m = c.missions;
        const q = (sel) => document.querySelector(sel);
        if (q('.cq-overlay--click')) return { ui: 'click' };
        if (c.cinema.playingShots) return { ui: 'cine' };
        // Story 2's data-driven cutscenes (cutscene.ts): skip them, as a player holding E would.
        if (c.cutscenes?.playing) {
          c.cutscenes.skip();
          return { ui: 'cutscene' };
        }
        if (q('.cq-complete')) return { ui: 'complete' };
        if (q('.cq-board')) return { ui: 'board' };
        if (q('.cq-ending')) return { ui: 'ending' };
        const card = q('.cq-quiz');
        if (card) {
          if (q('.cq-quiz__feedback.show')) return { ui: 'feedback' };
          if (card.classList.contains('mg')) return { ui: 'mg', sol: card.dataset.solution ?? null, ans: card.dataset.answer ?? null, sw: !!q('.mg-switches'), kp: !!q('.mg-keypad') };
          return { ui: 'quiz', ans: card.dataset.answer };
        }
        if (q('.cq-dialog, .cq-message')) return { ui: 'dialog' };
        const st = m.stepDef;
        return { ui: 'none', index: m.index, step: m.step, kind: st?.kind ?? null, target: m.riddle ? { x: m.riddle.spot.x, z: m.riddle.spot.z, label: 'riddle' } : m.targets(c.kart.position).main, mode: c.mode };
      });
      const key = JSON.stringify(s);
      same = key === lastKey ? same + 1 : 0;
      lastKey = key;
      if (same > 60) throw new Error(`stuck at ${key}`);
      if (s.ui === 'board') await page.click('.cq-board > .cq-btn');
      else if (s.ui === 'none' && s.kind === 'hold' && s.target) {
        // Hold-to-pull: stand at the device and hold E.
        await page.evaluate(([x, z]) => {
          const c = window.__campus;
          if (c.mode === 'kart') c.exitKart();
          c.player.teleport(x, c.ground.heightAt(x, z + 1.6), z + 1.6, 0);
        }, [s.target.x, s.target.z]);
        await wait(300);
        await page.keyboard.down('KeyE');
        await wait(3200);
        await page.keyboard.up('KeyE');
      } else if (s.ui === 'click') await page.click('.cq-overlay--click');
      else if (s.ui === 'cine') { await wait(300); await page.keyboard.press('KeyE'); }
      else if (s.ui === 'complete') {
        await wait(1500);
        await shot(`complete-${String(guard).padStart(4, '0')}`);
        console.log(`  mission complete (story ${await page.evaluate(() => window.__campus.profile.story)} / ${await page.evaluate(() => window.__campus.missionCount)}, version ${story})`);
        await page.keyboard.press('KeyE');
        await wait(600);
      } else if (s.ui === 'ending') {
        await wait(1200);
        await shot('ending');
        console.log('  reached the ending');
        break;
      } else if (s.ui === 'dialog' || s.ui === 'feedback') await page.keyboard.press('KeyE');
      else if (s.ui === 'quiz') await page.keyboard.press(`Digit${s.ans}`);
      else if (s.ui === 'mg') {
        if (s.sw && s.sol) {
          for (let i = 0; i < s.sol.length; i += 1) if (s.sol[i] === '1') await page.keyboard.press(`Digit${i + 1}`);
          await page.keyboard.press('Enter');
        } else if (s.kp && s.sol) {
          for (const ch of s.sol) await page.keyboard.press(`Digit${ch}`);
          await page.keyboard.press('Enter');
        } else if (s.ans) await page.keyboard.press(`Digit${s.ans}`);
        else await page.evaluate(() => window.__mgSolve?.());
        await wait(150);
      } else if (!s.kind) await wait(300);
      else if (s.kind === 'kart' || ((s.kind === 'drive' || s.kind === 'chase') && s.mode !== 'kart')) {
        await page.evaluate(() => {
          const c = window.__campus;
          const d = c.kart.vehicle.driverDoorWorld();
          c.player.teleport(d.x + 0.5, c.ground.heightAt(d.x, d.z), d.z);
        });
        await wait(250);
        await page.keyboard.press('KeyE');
        await wait(500);
      } else if (s.kind === 'drive' || s.kind === 'chase') {
        if (s.index === 1) {
          // Real driving: steer at the next ring.
          await page.evaluate(() => {
            const c = window.__campus;
            const t = c.missions.targets(c.kart.position).main;
            if (!t) return;
            const p = c.kart.position;
            let err = Math.atan2(t.x - p.x, t.z - p.z) - c.kart.heading;
            while (err > Math.PI) err -= 2 * Math.PI;
            while (err < -Math.PI) err += 2 * Math.PI;
            c.input.touchMove.x = Math.max(-1, Math.min(1, -err * 2.2));
            c.input.touchMove.y = Math.abs(err) > 1.2 ? 0.4 : 1;
          });
          await wait(100);
        } else {
          await page.evaluate(() => {
            const c = window.__campus;
            const t = c.missions.targets(c.kart.position).main;
            if (t) c.kart.place(t.x, t.z, c.kart.heading, c.ground);
          });
          await wait(120);
        }
      } else if (s.target) {
        await page.evaluate(() => {
          const c = window.__campus;
          c.input.touchMove.x = 0;
          c.input.touchMove.y = 0;
          if (c.mode === 'kart') c.exitKart();
        });
        await page.evaluate(([x, z]) => {
          const c = window.__campus;
          c.player.teleport(x, c.ground.heightAt(x, z + 1.6), z + 1.6, 0);
        }, [s.target.x, s.target.z]);
        await wait(250);
        await page.keyboard.press('KeyE');
        await wait(250);
      } else await wait(200);
      await wait(40);
    }
  }
  const fps = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const s = performance.now();
    const f = () => { n += 1; if (performance.now() - s < 2000) requestAnimationFrame(f); else res((n * 1000) / (performance.now() - s)); };
    requestAnimationFrame(f);
  }));
  console.log(`~${fps.toFixed(0)} fps`);
} finally {
  if (errors.length) console.log(`page errors:\n${errors.join('\n')}`);
  await browser.close();
  server.kill();
}
if (errors.length) process.exit(1);
