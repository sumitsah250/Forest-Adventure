// Checks Campus Quest against the drone survey (after build-campus-scan.mjs):
//   1. every surveyed roof: the game's wall top (as built) against the survey's, in metres above sea level
//   2. the game's ground against the survey's bare ground at open points
//   3. the same camera views rendered from the game and from a 2.5D replica of the survey (its surface
//      model coloured by the mesh), side by side → test-results/scan-<view>.png
//
//   node scripts/scan-check.mjs            (needs "actual models/.cache" from build-campus-scan.mjs)
//
// Starts its own Vite server on port 5197 and drives the local Chrome / Edge (playwright-core).

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, 'actual models/.cache');
const outDir = join(root, 'test-results');
const port = 5197;
await mkdir(outDir, { recursive: true });
const check = JSON.parse(await readFile(join(cache, 'check.json'), 'utf8'));

// The replica: surface model at 1 m over ±400 m, heights in survey datum, with mesh colours.
const N = 1761, HALF = 440, RES = 0.5;
const dsmBuf = await readFile(join(cache, 'dsm.f32'));
const dsm = new Float32Array(dsmBuf.buffer, dsmBuf.byteOffset, dsmBuf.byteLength / 4);
const rgb = await readFile(join(cache, 'rgb.u8'));
const RN = 801;
const rh = new Float32Array(RN * RN);
const rc = new Uint8Array(RN * RN * 3);
for (let j = 0; j < RN; j += 1) {
  for (let i = 0; i < RN; i += 1) {
    const k = Math.round((j - 400 + HALF) / RES) * N + Math.round((i - 400 + HALF) / RES);
    rh[j * RN + i] = dsm[k];
    rc.set(rgb.subarray(k * 3, k * 3 + 3), (j * RN + i) * 3);
  }
}
await writeFile(join(cache, 'replica-h.f32'), Buffer.from(rh.buffer));
await writeFile(join(cache, 'replica-c.u8'), Buffer.from(rc.buffer));

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const server = await new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let done = false;
  proc.stdout.on('data', (d) => { if (!done && /Local:|ready in/i.test(d.toString())) { done = true; resolve(proc); } });
  proc.on('exit', (c) => { if (!done) reject(new Error(`vite exited ${c}`)); });
});
const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });

/** Camera views: [name, position x, y (above ground there), z, target x, y offset, z]. Top views look straight down. */
const VIEWS = process.env.SCAN_VIEWS ? JSON.parse(process.env.SCAN_VIEWS) : [
  ['top-core', 100, 520, -60, 100, 0, -60],
  ['top-south', 0, 520, 120, 0, 0, 120],
  ['oblique-core', -40, 90, 60, 110, 0, -90],
  ['oblique-workshops', 330, 60, -10, 200, 0, -60],
  ['eye-admin', 60, 1.7, -60, 110, 4, -130],
  ['eye-ground', -40, 1.7, 40, 40, 2, -20],
];

try {
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  page.on('pageerror', (e) => console.log('pageerror', String(e)));
  await page.goto(`http://localhost:${port}/campus.html?test&quality=high&story=2`);
  await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 240000 });
  await page.waitForTimeout(2500);

  // 1 + 2: numbers.
  const res = await page.evaluate((ref) => {
    const c = window.__campus;
    const datum = c.ground.datum;
    const fps = c.world.footprints.map((f) => {
      let x = 0, z = 0;
      for (const p of f.b.pts) { x += p[0] / f.b.pts.length; z += p[1] / f.b.pts.length; }
      return { f, x, z };
    });
    const roofs = [];
    for (const r of ref.roofs) {
      let best = null, bd = 1.5;
      for (const q of fps) {
        const d = Math.hypot(q.x - r.cx, q.z - r.cz);
        if (d < bd) { bd = d; best = q; }
      }
      if (!best) continue;
      roofs.push({ name: r.name, inside: r.inside, area: r.area, err: best.f.top + datum - r.roof, enterable: !!best.f.b.enterable });
    }
    const ground = ref.ground.map(([x, z, h]) => c.ground.heightAt(x, z) + datum - h);
    return { datum, roofs, ground, built: fps.length };
  }, check);
  const stats = (a) => {
    const s = a.map(Math.abs).sort((p, q) => p - q);
    const q = (f) => s[Math.min(s.length - 1, Math.round(f * (s.length - 1)))];
    const mean = a.reduce((p, v) => p + v, 0) / a.length;
    return `n ${a.length}, mean ${mean.toFixed(2)} m, |err| median ${q(0.5).toFixed(2)} m, 90% ${q(0.9).toFixed(2)} m, max ${q(1).toFixed(2)} m`;
  };
  console.log(`game datum ${res.datum.toFixed(1)} m, ${res.built} buildings built`);
  console.log(`roofs (all matched):     ${stats(res.roofs.map((r) => r.err))}`);
  console.log(`roofs (campus):          ${stats(res.roofs.filter((r) => r.inside).map((r) => r.err))}`);
  console.log(`ground (open points):    ${stats(res.ground)}`);
  const worst = res.roofs.filter((r) => r.inside).sort((a, b) => Math.abs(b.err) - Math.abs(a.err)).slice(0, 10);
  console.log('worst campus roofs:', worst.map((r) => `${r.name ?? '(unnamed)'} ${r.area}m² ${r.err > 0 ? '+' : ''}${r.err.toFixed(1)}${r.enterable ? ' (interior)' : ''}`).join('; '));
  await writeFile(join(outDir, 'scan-check.json'), JSON.stringify(res, null, 1));

  // 3: views from the game.
  const shoot = async (target, v) => target.evaluate(([name, x, y, z, tx, ty, tz]) => {
    const g = window.__scanView;
    return g(name, x, y, z, tx, ty, tz);
  }, v);
  await page.evaluate(() => {
    const c = window.__campus;
    window.__scanView = (name, x, y, z, tx, ty, tz) => {
      const cam = c.camera.clone();
      const top = name.startsWith('top');
      const gy = c.ground.heightAt(x, z);
      cam.position.set(x, gy + y, z);
      cam.fov = top ? 2 * Math.atan(130 / y) * 180 / Math.PI : 60;
      cam.aspect = c.renderer.domElement.width / c.renderer.domElement.height;
      cam.near = 0.2;
      cam.far = 2000;
      if (top) cam.up.set(0, 0, -1);
      cam.updateProjectionMatrix();
      cam.lookAt(tx, (top ? 0 : c.ground.heightAt(tx, tz)) + ty, tz);
      c.world.update(performance.now() / 1000, cam);
      c.renderer.render(c.scene, cam);
      return c.renderer.domElement.toDataURL('image/png');
    };
  });
  const gameShots = {};
  for (const v of VIEWS) gameShots[v[0]] = await shoot(page, v);

  // The replica in a bare page on the same origin, with three.js from node_modules.
  const rp = await browser.newPage({ viewport: { width: 960, height: 640 } });
  rp.on('pageerror', (e) => console.log('replica pageerror', String(e)));
  await rp.goto(`http://localhost:${port}/node_modules/three/package.json`);
  await rp.setContent('<html><body style="margin:0;background:#000"></body></html>');
  await rp.evaluate(async ({ port, datum, RN, off }) => {
    const THREE = await import(`http://localhost:${port}/node_modules/three/build/three.module.js`);
    const [hb, cb] = await Promise.all([
      fetch(`http://localhost:${port}/actual%20models/.cache/replica-h.f32`).then((r) => r.arrayBuffer()),
      fetch(`http://localhost:${port}/actual%20models/.cache/replica-c.u8`).then((r) => r.arrayBuffer()),
    ]);
    const h = new Float32Array(hb);
    const col = new Uint8Array(cb);
    // World y as the game has it: survey elevation back on sea level (+ the datum offset), minus the game datum.
    const offset = off;
    const pos = new Float32Array(RN * RN * 3);
    const colors = new Float32Array(RN * RN * 3);
    for (let j = 0; j < RN; j += 1) for (let i = 0; i < RN; i += 1) {
      const k = j * RN + i;
      const y = h[k] === h[k] ? h[k] - offset - datum : -50;
      pos.set([i - 400, y, j - 400], k * 3);
      colors.set([(col[k * 3] / 255) ** 2.2, (col[k * 3 + 1] / 255) ** 2.2, (col[k * 3 + 2] / 255) ** 2.2], k * 3);
    }
    const idx = new Uint32Array((RN - 1) * (RN - 1) * 6);
    let p = 0;
    for (let j = 0; j < RN - 1; j += 1) for (let i = 0; i < RN - 1; i += 1) {
      const a = j * RN + i;
      idx.set([a, a + RN, a + 1, a + 1, a + RN, a + RN + 1], p);
      p += 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#9fb6cc');
    scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true })));
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(960, 640);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.append(renderer.domElement);
    const groundAt = (x, z) => {
      const i = Math.round(x + 400), j = Math.round(z + 400);
      // Lowest surface nearby stands in for the ground under the camera.
      let m = Infinity;
      for (let dj = -6; dj <= 6; dj += 2) for (let di = -6; di <= 6; di += 2) {
        const v = h[(j + dj) * RN + i + di];
        if (v === v) m = Math.min(m, v);
      }
      return m - offset - datum;
    };
    window.__scanView = (name, x, y, z, tx, ty, tz) => {
      const top = name.startsWith('top');
      const cam = new THREE.PerspectiveCamera(top ? 2 * Math.atan(130 / y) * 180 / Math.PI : 60, 960 / 640, 0.2, 2000);
      cam.position.set(x, groundAt(x, z) + y, z);
      if (top) cam.up.set(0, 0, -1);
      cam.lookAt(tx, (top ? 0 : groundAt(tx, tz)) + ty, tz);
      renderer.render(scene, cam);
      return renderer.domElement.toDataURL('image/png');
    };
  }, { port, datum: res.datum, RN, off: check.offset });
  for (const v of VIEWS) {
    const scanShot = await shoot(rp, v);
    // Side by side: game left, survey right.
    const both = await rp.evaluate(async ([a, b]) => {
      const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = document.createElement('canvas');
      c.width = ib.width * 2 + 6;
      c.height = ib.height;
      const x = c.getContext('2d');
      x.fillStyle = '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(ia, 0, 0, ib.width, ib.height);
      x.drawImage(ib, ib.width + 6, 0, ib.width, ib.height);
      x.font = '16px sans-serif';
      x.fillStyle = '#fff';
      x.fillText('GAME', 10, 22);
      x.fillText("SURVEY", ib.width + 16, 22);
      return c.toDataURL('image/png');
    }, [gameShots[v[0]], scanShot]);
    await writeFile(join(outDir, `scan-${v[0]}.png`), Buffer.from(both.split(',')[1], 'base64'));
    console.log(`  test-results/scan-${v[0]}.png`);
    if (v[0].startsWith('top')) {
      // Roof colour: the game's rendered roof against the survey's, at each roof centre in view.
      const [, x0, y, z0] = v;
      const ppm = 320 / 130;
      const pts = [...check.roofs.map((r) => ({ shape: r.shape, px: 480 + (r.cx - x0) * ppm, py: 320 + (r.cz - z0) * ppm })), ...check.ground.map(([gx, gz]) => ({ shape: 'ground', px: 480 + (gx - x0) * ppm, py: 320 + (gz - z0) * ppm }))]
        .filter((p) => p.px > 6 && p.py > 6 && p.px < 954 && p.py < 634);
      const ratios = await rp.evaluate(async ([a, b, pts]) => {
        const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
        const px = async (src) => {
          const im = await load(src);
          const c = document.createElement('canvas');
          c.width = 960;
          c.height = 640;
          const x = c.getContext('2d');
          x.drawImage(im, 0, 0, 960, 640);
          return x.getImageData(0, 0, 960, 640).data;
        };
        const [ga, sb] = await Promise.all([px(a), px(b)]);
        const avg = (d, p) => {
          const s = [0, 0, 0];
          for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
            const o = ((Math.round(p.py) + dy) * 960 + Math.round(p.px) + dx) * 4;
            for (let c = 0; c < 3; c += 1) s[c] += d[o + c] / 25;
          }
          return s;
        };
        return pts.map((p) => ({ shape: p.shape, g: avg(ga, p), s: avg(sb, p) }));
      }, [gameShots[v[0]], scanShot, pts]);
      for (const shape of ['flat', 'pitched', 'ground']) {
        const l = ratios.filter((r) => r.shape === shape);
        if (!l.length) continue;
        const ch = [0, 1, 2].map((c) => {
          const q = l.map((r) => r.g[c] / Math.max(8, r.s[c])).sort((a, b) => a - b);
          return q[Math.floor(q.length / 2)].toFixed(2);
        });
        console.log(`    ${shape} roofs (${l.length}): game/survey colour ratio r ${ch[0]} g ${ch[1]} b ${ch[2]}`);
      }
    }
  }
} finally {
  await browser.close();
  server.kill();
}
