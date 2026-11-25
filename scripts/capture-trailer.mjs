// Films the install page's campus trailer from the real game, into public/assets/trailer/ (under assets/, so the
// service worker caches each file when the page first shows it instead of precaching them for every visitor):
//   campus-trailer.webm   a ~30 s looping fly-through, 1280x720 VP9, no sound
//   poster.webp           a frame from just after the opening fade, shown until the video plays
//   still-*.webp          stills taken during the film, for the page's "night" timeline
// and src/launcher/trailer.json, each shot's name and start time, which the page's story clock follows.
//
//   npm run trailer                                       # film everything (re-run after map or lighting changes)
//   node scripts/capture-trailer.mjs preview D [a,b]      # each shot's start, middle and end as stills in folder D
//   node scripts/capture-trailer.mjs scout views.json D   # render single views from a JSON list into folder D
//
// Each frame is rendered on demand: the page's requestAnimationFrame runs on a virtual clock this script advances
// 1/60 s at a time, so the film is smooth however slow the machine is. Frames are piped as JPEG into the VP9
// ffmpeg that ships with Playwright (`npx playwright-core install ffmpeg` if it is missing).
// Uses the local Chrome / Edge and its own Vite server on port 5198 (file watching off, so editing src mid-run
// does not reload the game).

import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5198;
const OUT = join(root, 'public/assets/trailer');
/** Where the poster frame is taken (s): the page starts the video here too, so poster and film line up. */
const POSTER_AT = 1.2;
const FPS = 30;
/** Rendered above 720p and scaled down, which doubles as antialiasing (1080p was too much for laptop GPUs). */
const RENDER = { width: 1600, height: 900 };
const VIDEO = { width: 1280, height: 720 };
const STILL = { width: 1600, height: 900 };

// ------------------------------------------------------------------ the film
// Story order, so the sky only ever moves forward: an afternoon on campus, the sun going down, the blackout
// storm, Kalki out in it, and sunrise over Machhapuchhre. Camera keys are [x, height above ground, z];
// `look` is where the camera aims, the same way. Keys are spaced evenly over the shot and eased in and out.
// `stills` are times (s, within the shot) to save for the gallery.
const SHOTS = [
  {
    name: 'arrival', dur: 5, sky: 'day',
    cam: [[260, 120, 300], [190, 80, 170], [130, 46, 60]],
    look: [[60, 0, -140], [60, 0, -150], [60, 6, -160]],
    fov: 50, stills: [{ at: 3.9, name: 'campus' }],
  },
  {
    name: 'gate', dur: 4.5, sky: 'day',
    cam: [[184, 1.7, -283], [179, 2.2, -272], [175.5, 3.4, -264]],
    look: [[166, 3.6, -246], [164, 4.2, -244], [161, 4.6, -238]],
    fov: 54, stills: [{ at: 3.2, name: 'gate' }],
  },
  {
    name: 'kalki', dur: 4.5, sky: 'dusk', kalki: { x: -40, z: 50, heading: 2, lights: true },
    // On the WRC football ground, facing away from the low sun: it sets behind Kalki.
    orbit: { x: -40, z: 50, r: [6.8, 5.2], h: [0.7, 1.05], a: [2.7, 1.5], lookH: 0.95 },
    fov: 40, stills: [{ at: 2.6, name: 'kalki' }],
  },
  {
    name: 'dusk', dur: 4, sky: 'dusk',
    cam: [[40, 34, 150], [110, 30, 140], [180, 36, 110]],
    look: [[120, 4, 40], [140, 4, 30], [150, 4, 10]],
    fov: 52, stills: [{ at: 2.2, name: 'dusk' }],
  },
  {
    name: 'storm', dur: 4, sky: 'night', weather: 'storm', power: 0, flashes: [0.7, 2.6],
    cam: [[150, 22, 40], [130, 20, -10], [115, 19, -50]],
    look: [[90, 10, -120], [85, 9, -140], [80, 9, -160]],
    fov: 54, stills: [{ at: 0.75, name: 'storm' }],
  },
  {
    name: 'chase', dur: 4.5, sky: 'night', weather: 'storm', power: 0, flashes: [3.2],
    kalki: { x: 126, z: -216, heading: 2.3, lights: true },
    orbit: { x: 126, z: -216, r: [7, 5.2], h: [1.6, 1.15], a: [4.75, 5.55], lookH: 1, ahead: 6 },
    fov: 46, stills: [{ at: 3.25, name: 'chase' }],
  },
  {
    name: 'sunrise', dur: 5.5, sky: 'dawn', fadeOut: 1.1,
    cam: [[150, 20, 160], [120, 60, 190], [90, 110, 230]],
    look: [[90, 10, 0], [70, 40, -150], [60, 80, -400]],
    fov: 50, stills: [{ at: 4.4, name: 'sunrise' }],
  },
];
/** Seconds of black dip between shots (half out, half in). */
const DIP = 0.36;
/** Frames rendered (not filmed) before each shot so sky, shadows and textures settle. */
const SETTLE = 24;

// ------------------------------------------------------------------ server and browser
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const ffmpegPath = (() => {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), process.platform === 'win32' ? 'AppData/Local/ms-playwright' : process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  for (const dir of existsSync(base) ? readdirSync(base).filter((d) => d.startsWith('ffmpeg')).sort().reverse() : []) {
    for (const exe of ['ffmpeg-win64.exe', 'ffmpeg-mac', 'ffmpeg-linux']) if (existsSync(join(base, dir, exe))) return join(base, dir, exe);
  }
  return 'ffmpeg';
})();

const server = await createServer({ root, configFile: join(root, 'vite.config.ts'), logLevel: 'warn', server: { port, strictPort: true, hmr: false, watch: null } });
await server.listen();
/** A browser per shot: a GPU process that has lost a context once tends to keep losing them. */
const launch = () => chromium.launch({ executablePath, headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-domain-blocking-for-3d-apis'] });

/** Loads the game in a new tab, ready to film: UI hidden, the film camera installed, the clock under our control. */
async function openGame() {
  const browser = await launch();
  const page = await browser.newPage({ viewport: RENDER, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.addInitScript(() => {
    // A seeded Math.random (the same trees, flicker and walkers every run) and a requestAnimationFrame that,
    // once `__cap.manual` is on, waits for this script to call `__cap.step`.
    let s = 0x2f6e2b1;
    Math.random = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const raf = window.requestAnimationFrame.bind(window);
    const queue = [];
    const cap = { manual: false, now: 0, lost: false };
    window.requestAnimationFrame = (cb) => (cap.manual ? queue.push(cb) : raf(cb));
    cap.start = () => {
      cap.now = performance.now();
      cap.manual = true;
    };
    cap.step = (ms) => {
      cap.now += ms;
      for (const cb of queue.splice(0)) cb(cap.now);
    };
    // A lost graphics context comes back without some textures (black frames): the shot is filmed again.
    document.addEventListener('webglcontextlost', () => (cap.lost = true), true);
    window.__cap = cap;
  });
  try {
    await page.goto(`http://localhost:${port}/campus.html?test&quality=high&debug=1`);
    await page.waitForFunction(() => window.__ready || window.__error, null, { timeout: 300000 });
    const err = await page.evaluate(() => window.__error);
    if (err) throw new Error(err);
  } catch (e) {
    await browser.close();
    throw e;
  }
  await page.addStyleTag({ content: '#ui, .vignette, .cq-debug { display: none !important; }' });
  await page.waitForTimeout(2500);
  await page.evaluate(installFilm);
  await page.evaluate(() => window.__cap.start());
  await page.waitForTimeout(300);
  // One frame at a time, each finished on the GPU before the next: dozens of frames queued in one go tripped the
  // driver's watchdog and lost the graphics context.
  const step = (frames) => page.evaluate(async (n) => {
    const gl = window.__campus.renderer.getContext();
    for (let i = 0; i < n; i += 1) {
      window.__cap.step(1000 / 60);
      gl.finish();
      await new Promise((r) => setTimeout(r, 0));
    }
  }, frames);
  return { browser, page, step };
}

/** One shot's frames (JPEG, dipped to black at the cuts) and stills, filmed in its own tab. Null if the GPU dropped out. */
async function filmShot(shot, i) {
  let game;
  try {
    game = await openGame();
  } catch (e) {
    console.warn(`shot ${shot.name}: the game didn't start (${e.message})`);
    return null;
  }
  const { browser, page, step } = game;
  try {
    await page.evaluate((s) => window.__film.setup(s), shot);
    await page.evaluate((s) => window.__film.at(s, 0), shot);
    await step(SETTLE + (shot.weather === 'storm' ? 150 : 0));
    const frames = [];
    const stills = [];
    const want = [...(shot.stills ?? []), ...(i === 0 ? [{ at: POSTER_AT, file: 'poster.webp', size: VIDEO }] : [])].sort((x, y) => x.at - y.at);
    const count = Math.round(shot.dur * FPS);
    for (let f = 0; f < count; f += 1) {
      const t = f / FPS;
      await page.evaluate(([s, t]) => window.__film.at(s, t), [shot, t]);
      await step(2);
      // Dip to black between shots; the film starts from black and fades out at the end, so it loops cleanly.
      const tail = shot.fadeOut ?? DIP / 2;
      const head = i === 0 ? 0.8 : DIP / 2;
      const black = Math.min(1, Math.max(0, 1 - t / head, 1 - (shot.dur - t) / tail));
      const b64 = await page.evaluate(([w, h, b]) => window.__film.grab(w, h, 'image/jpeg', 0.93, b), [VIDEO.width, VIDEO.height, black]);
      frames.push(Buffer.from(b64, 'base64'));
      while (want.length && t >= want[0].at) {
        const st = want.shift();
        const size = st.size ?? STILL;
        const p = await page.evaluate(([w, h]) => window.__film.grab(w, h, 'image/webp', 0.84, 0), [size.width, size.height]);
        stills.push([st.file ?? `still-${st.name}.webp`, Buffer.from(p, 'base64')]);
      }
    }
    // A near-empty middle frame means the picture went black without a lost event.
    const lost = (await page.evaluate(() => window.__cap.lost)) || frames[count >> 1].length < 8000;
    return lost ? null : { frames, stills };
  } finally {
    await browser.close();
  }
}

let open = null;
try {
  if (process.argv[2] === 'preview') {
    // Each shot's start, middle and end as small stills, to check the camera paths before filming.
    const { browser, page, step } = await openGame();
    open = browser;
    const dir = process.argv[3];
    const only = process.argv[4]?.split(',');
    await mkdir(dir, { recursive: true });
    for (const shot of SHOTS) {
      if (only && !only.includes(shot.name)) continue;
      await page.evaluate((s) => window.__film.setup(s), shot);
      for (const k of [0, 0.5, 1]) {
        await page.evaluate(([s, t]) => window.__film.at(s, t), [shot, k * shot.dur]);
        await step(k === 0 ? SETTLE + (shot.weather === 'storm' ? 150 : 0) : 6);
        const b64 = await page.evaluate(() => window.__film.grab(800, 450, 'image/jpeg', 0.85, 0));
        await writeFile(join(dir, `${shot.name}-${k * 2}.jpg`), Buffer.from(b64, 'base64'));
      }
      console.log('previewed', shot.name);
    }
  } else if (process.argv[2] === 'scout') {
    const { browser, page, step } = await openGame();
    open = browser;
    const views = JSON.parse(await readFile(process.argv[3], 'utf8'));
    const dir = process.argv[4];
    await mkdir(dir, { recursive: true });
    for (const v of views) {
      await page.evaluate((v) => window.__film.setup(v), v);
      await step(SETTLE);
      await page.evaluate((v) => window.__film.pose(v.cam, v.look, v.fov ?? 52), v);
      await step(4);
      const b64 = await page.evaluate(() => window.__film.grab(960, 540, 'image/jpeg', 0.88, 0));
      await writeFile(join(dir, `${v.name}.jpg`), Buffer.from(b64, 'base64'));
      console.log('scouted', v.name);
    }
  } else {
    await mkdir(OUT, { recursive: true });
    const webm = join(OUT, 'campus-trailer.webm');
    // Every shot first, so a failure leaves the published film alone.
    const takes = [];
    for (const [i, shot] of SHOTS.entries()) {
      let take = null;
      for (let attempt = 1; !take; attempt += 1) {
        if (attempt > 3) throw new Error(`shot ${shot.name}: the graphics context kept dropping out`);
        take = await filmShot(shot, i);
        if (!take) console.warn(`shot ${shot.name}: graphics context lost, filming it again`);
      }
      takes.push(take);
      console.log(`shot ${i + 1}/${SHOTS.length} ${shot.name}: ${take.frames.length} frames`);
    }

    const ff = spawn(ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error',
      // pipe:0, not "-": Playwright's ffmpeg build has the pipe protocol but not fd.
      '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0',
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-b:v', '1400k', '-maxrate', '2200k', '-crf', '34',
      '-deadline', 'good', '-cpu-used', '2', '-row-mt', '1', '-g', String(FPS * 2), '-an', webm,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });
    const ffDone = new Promise((res, rej) => ff.on('exit', (c) => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
    const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));
    let total = 0;
    for (const take of takes) {
      for (const frame of take.frames) await write(frame);
      for (const [file, data] of take.stills) await writeFile(join(OUT, file), data);
      total += take.frames.length;
    }
    ff.stdin.end();
    await ffDone;

    // Shot start times for the page's story clock and captions (each shot is a whole number of frames).
    let at = 0;
    const shots = SHOTS.map((s) => {
      const shot = { name: s.name, start: Number(at.toFixed(3)) };
      at += Math.round(s.dur * FPS) / FPS;
      return shot;
    });
    const timing = { duration: Number((total / FPS).toFixed(3)), posterAt: POSTER_AT, shots };
    await writeFile(join(root, 'src/launcher/trailer.json'), `${JSON.stringify(timing, null, 2)}\n`);
    console.log(`wrote ${webm} (${(total / FPS).toFixed(1)} s, ${Math.round((await stat(webm)).size / 1024)} KB)`);
  }
} finally {
  await open?.close();
  await server.close();
}

// ------------------------------------------------------------------ in the page
function installFilm() {
  const C = window.__campus;
  const D = window.__debug;
  const cam = C.camera;
  const V3 = cam.position.constructor;
  const ground = C.ground;
  const hAt = (x, z) => ground.heightAt(x, z);
  let sun = null;
  C.scene.traverse((o) => {
    if (o.isDirectionalLight && o.castShadow) sun = o;
  });

  const film = { pos: null, look: null, fov: 52, power: null, flash: 0, shadowAt: null };
  // The title screen places the camera with lookAt each frame, before the world, sky and shadows update:
  // taking over there means everything follows the film's camera.
  const lookAt = cam.lookAt.bind(cam);
  cam.lookAt = (...a) => {
    if (!film.pos) return lookAt(...a);
    cam.position.copy(film.pos);
    cam.up.set(0, 1, 0);
    lookAt(film.look);
    if (cam.fov !== film.fov) {
      cam.fov = film.fov;
      cam.updateProjectionMatrix();
    }
  };
  const setLights = C.world.setLights.bind(C.world);
  C.world.setLights = (p, n) => setLights(film.power ?? p, n);
  const r = C.renderer;
  const render = r.render.bind(r);
  r.render = (s, c) => {
    // Shadows centred on what the film looks at, not on the player waiting at the gate.
    if (sun && film.shadowAt) {
      const dir = new V3().subVectors(sun.position, sun.target.position).normalize();
      sun.target.position.copy(film.shadowAt);
      sun.position.copy(film.shadowAt).addScaledVector(dir, 200);
      sun.target.updateMatrixWorld();
    }
    const exp = r.toneMappingExposure;
    r.toneMappingExposure = exp + film.flash * 1.6;
    render(s, c);
    r.toneMappingExposure = exp;
  };

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const ease = (t) => t * t * (3 - 2 * t);
  // Catmull-Rom through the keys, eased over the shot.
  const path = (keys, t) => {
    if (keys.length === 1) return keys[0];
    const u = smooth(Math.min(1, Math.max(0, t))) * (keys.length - 1);
    const i = Math.min(keys.length - 2, Math.floor(u));
    const f = u - i;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)];
    return p1.map((_, k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f));
  };
  const world = ([x, h, z]) => new V3(x, hAt(x, z) + h, z);
  const lerp = (a, b, t) => a + (b - a) * t;

  window.__film = {
    /** Sky, weather, Kalki and power for a shot. */
    setup(s) {
      const sky = s.sky === 'day' ? null : s.sky;
      if (sky) D.sky(sky);
      D.weather(s.weather ?? 'clear');
      film.power = typeof s.power === 'number' ? s.power : null;
      if (s.kalki) {
        C.kart.place(s.kalki.x, s.kalki.z, s.kalki.heading, ground);
        // The title screen doesn't run physics, so Kalki would hang where it was put, wheels in the air:
        // settle it onto its suspension first (handbrake on).
        const v = C.kart.vehicle;
        v.phys.input = { throttle: 0, steer: 0, handbrake: true };
        for (let i = 0; i < 150; i += 1) {
          C.kart.fixedUpdate(1 / 60);
          v.physics.step();
          C.kart.postPhysics();
        }
        v.syncTransforms(true);
        v.setLights(!!s.kalki.lights);
      }
    },
    pose(p, l, fov) {
      film.pos = world(p);
      film.look = world(l);
      film.fov = fov;
      film.shadowAt = film.look.clone().lerp(film.pos, 0.35);
    },
    /** The camera, power and lightning at time t (s) into a shot. */
    at(s, t) {
      const k = t / s.dur;
      if (s.orbit) {
        const o = s.orbit;
        const e = smooth(k);
        const a = lerp(o.a[0], o.a[1], e);
        const rr = lerp(o.r[0], o.r[1], e);
        const x = o.x + Math.sin(a) * rr;
        const z = o.z + Math.cos(a) * rr;
        film.pos = new V3(x, hAt(x, z) + lerp(o.h[0], o.h[1], e), z);
        // `ahead`: aim past the car along its heading (down the road it faces).
        const lx = o.x + Math.sin(s.kalki?.heading ?? 0) * (o.ahead ?? 0);
        const lz = o.z + Math.cos(s.kalki?.heading ?? 0) * (o.ahead ?? 0);
        film.look = new V3(lx, hAt(lx, lz) + o.lookH, lz);
      } else {
        film.pos = world(path(s.cam, k));
        film.look = world(path(s.look, k));
      }
      film.fov = s.fov ?? 52;
      film.shadowAt = film.look.clone().lerp(film.pos, 0.35);
      // Power: a number holds; [from, to, start s, end s] ramps (the windows coming back on).
      if (Array.isArray(s.power)) film.power = lerp(s.power[0], s.power[1], ease(Math.min(1, Math.max(0, (t - s.power[2]) / (s.power[3] - s.power[2])))));
      // Lightning: two or three quick pulses at each flash time.
      film.flash = 0;
      for (const f of s.flashes ?? []) {
        const d = t - f;
        if (d >= 0 && d < 0.5) film.flash = Math.max(film.flash, (Math.sin(d * 40) > 0.2 ? 1 : 0.35) * (1 - d / 0.5));
      }
    },
    /** The last rendered frame, scaled, lightly graded and dipped toward black. */
    grab(w, h, type, q, black) {
      out.width = w;
      out.height = h;
      ctx.imageSmoothingQuality = 'high';
      ctx.filter = 'contrast(1.06) saturate(1.1)';
      ctx.drawImage(r.domElement, 0, 0, w, h);
      ctx.filter = 'none';
      if (black > 0) {
        ctx.fillStyle = `rgba(0,0,0,${black})`;
        ctx.fillRect(0, 0, w, h);
      }
      return out.toDataURL(type, q).split(',')[1];
    },
  };
}
