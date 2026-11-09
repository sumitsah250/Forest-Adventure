// Captures the campus overview picture used by the install page (public/images/campus-overview.jpg):
// Campus Quest's title-screen aerial view, with the menu and vignette hidden.
//
//   node scripts/capture-overview.mjs            # re-run after map or lighting changes
//
// Uses the local Chrome / Edge (playwright-core) and its own Vite server on port 5199.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5199;
const out = join(root, 'public/images/campus-overview.jpg');
await mkdir(dirname(out), { recursive: true });
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));

const server = await new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let done = false;
  proc.stdout.on('data', (d) => {
    if (!done && /Local:|ready in/i.test(d.toString())) { done = true; resolve(proc); }
  });
  proc.stderr.on('data', (d) => process.stderr.write(d));
  proc.on('exit', (code) => { if (!done) reject(new Error(`vite exited ${code}`)); });
});

const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto(`http://localhost:${port}/campus.html?test&quality=high`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);
  await page.addStyleTag({ content: '#ui, .vignette { display: none !important; }' });
  // Let textures settle and the title camera drift to a view of the whole campus.
  await page.waitForTimeout(4000);
  await page.screenshot({ path: out, type: 'jpeg', quality: 80 });
  console.log(`wrote ${out} (${Math.round((await stat(out)).size / 1024)} KB)`);
} finally {
  await browser.close();
  server.kill();
}
