// Campus Quest browser checks with the local Chrome / Edge (playwright-core).
//
//   node scripts/campus-test.mjs shots     # title + viewpoints around campus → test-results/campus-*.png
//   node scripts/campus-test.mjs play      # plays all ten levels through the real UI to the ending
//
// Starts its own Vite server on port 5198. Add `low` / `medium` / `high` to pick a preset.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'shots';
const quality = process.argv[3] ?? 'medium';
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
await page.goto(`http://localhost:${port}/campus.html?test&quality=${quality}`);
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
  // Start a new game through the title menu.
  await page.click('.cq-menu .cq-btn >> text=/^(Start|New game)/');
  await wait(2500);
  const ov = await page.$('.cq-overlay--click');
  if (ov) await ov.click();
  await wait(800);
  await shot('gate');

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
    // Play every level: walk to each target (teleport next to it), press E, read dialogue,
    // answer quizzes from the test answer key. Collect fetch items on the way.
    const answerAll = async () => {
      for (let guard = 0; guard < 80; guard += 1) {
        await wait(150);
        const state = await page.evaluate(() => {
          if (document.querySelector('.cq-overlay--ending')) return 'ending';
          const quiz = document.querySelector('.cq-quiz');
          if (quiz) return quiz.querySelector('.cq-quiz__feedback.show') ? 'feedback' : `quiz:${quiz.dataset.answer}`;
          if (document.querySelector('.cq-dialog, .cq-message')) return 'dialog';
          if (document.querySelector('.cq-overlay--click')) return 'click';
          return 'none';
        });
        if (state === 'ending') return 'ending';
        if (state === 'none') return 'none';
        if (state === 'click') await page.click('.cq-overlay--click');
        else if (state.startsWith('quiz:')) await page.keyboard.press(`Digit${state.slice(5)}`);
        else await page.keyboard.press('KeyE');
      }
      return 'stuck';
    };
    const goTo = async (x, z) => {
      await page.evaluate(([x, z]) => {
        const c = window.__campus;
        // Stand 1.8 m south of the spot, facing it.
        c.player.teleport(x, c.ground.heightAt(x, z + 1.8), z + 1.8, 0);
      }, [x, z]);
      await wait(400);
    };
    for (let step = 0; step < 40; step += 1) {
      // Fetch items load asynchronously after a conversation; wait for the next target.
      await page.waitForFunction(() => window.__campus.quest.targets().main || document.querySelector('.cq-overlay--ending'), null, { timeout: 15000 }).catch(() => undefined);
      const info = await page.evaluate(() => {
        const q = window.__campus.quest;
        const t = q.targets().main;
        return { level: q.level, stage: q.stage, target: t, score: q.score };
      });
      if (!info.target) break;
      console.log(`  level ${info.level + 1} ${info.stage} → ${info.target.label} (${info.target.x.toFixed(0)}, ${info.target.z.toFixed(0)}) score ${info.score}`);
      await goTo(info.target.x, info.target.z);
      if (step < 3 || info.stage === 'fetch') await shot(`play-${String(step).padStart(2, '0')}`);
      await page.keyboard.press('KeyE');
      await wait(300);
      const r = await answerAll();
      if (r === 'ending') {
        await wait(1200);
        await shot('ending');
        console.log('  reached the convocation screen');
        break;
      }
      if (r === 'stuck') throw new Error('UI did not settle');
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
