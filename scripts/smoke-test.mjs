// Smoke test for story 2: opens every mission (and interlude) through the debug jump, waits
// 5 seconds in each, and fails on any console error or uncaught exception.
//
//   npm run test:smoke            (add --show to watch it)
//
// Starts its own Vite server on port 5199 and uses the local Chrome or Edge (playwright-core).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5199;
const WAIT = 5000;
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find((p) => existsSync(p));

const server = await new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let done = false;
  proc.stdout.on('data', (d) => {
    if (!done && /Local:|ready in/i.test(d.toString())) {
      done = true;
      resolve(proc);
    }
  });
  proc.on('exit', (code) => {
    if (!done) reject(new Error(`vite exited ${code}`));
  });
});

const browser = await chromium.launch({ executablePath, headless: !process.argv.includes('--show'), args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
let where = 'loading';
page.on('pageerror', (e) => errors.push(`[${where}] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[${where}] ${m.text()}`);
});
const wait = (ms) => page.waitForTimeout(ms);
let failed = false;
try {
  // A saved player name, so the first-launch name screen does not block the jumps.
  await page.addInitScript(() => {
    if (!localStorage.getItem('campus-blackout-profile-v1')) localStorage.setItem('campus-blackout-profile-v1', JSON.stringify({ version: 1, storyVersion: 2, name: 'Smoke Test', roll: 'PAS000TST000' }));
  });
  const t0 = Date.now();
  await page.goto(`http://localhost:${port}/campus.html?story=2&debug=1&test&quality=low`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const { missions, interludes } = await page.evaluate(() => ({ missions: window.__debug.missions, interludes: window.__debug.interludes }));
  for (let i = 0; i < missions.length; i += 1) {
    where = `M${i + 1} ${missions[i]}`;
    const before = errors.length;
    await page.evaluate((i) => window.__debug.jump(i), i);
    await wait(WAIT);
    console.log(`  ${errors.length > before ? 'FAIL' : 'ok  '} ${where}`);
  }
  for (let i = 0; i < interludes.length; i += 1) {
    where = `interlude ${interludes[i]}`;
    const before = errors.length;
    await page.evaluate((i) => window.__debug.interlude(i), i);
    await wait(WAIT);
    await page.evaluate(() => window.__campus.ui.close());
    console.log(`  ${errors.length > before ? 'FAIL' : 'ok  '} ${where}`);
  }
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error(`\n${errors.length} console error(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
if (failed) process.exit(1);
console.log('\nSmoke test passed.');
process.exit(0);
