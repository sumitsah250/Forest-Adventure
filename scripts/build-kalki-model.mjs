// Builds Kalki, the story's buggy (public/assets/models/kalki/kalki.glb), from the
// Mini Dune Buggy source in art-source/buggy/Mini_Dune_Buggy.glb (not committed: 18 MB,
// 138 textures).
//
//   node scripts/build-kalki-model.mjs
//
// The source is a toy-scale model (0.7 units long) with anonymous nodes, one material
// and four textures per part, and spec-gloss materials three.js ignores. This script,
// in the local Chrome / Edge (playwright-core) with three.js:
// - scales it to a real buggy (WHEELBASE) in Kalki's body space (+Z forward, +X left,
//   +Y up), origin on the ground-plane centre between the axles at wheel-centre height;
// - splits out the four wheels (wheel_FL / FR / RL / RR: a node at the wheel centre,
//   meshes around it) and the steering wheel (steering: local Z along the column);
// - adds empty marker nodes the game reads: seat (driver's seat cushion, top centre),
//   lamp_L / lamp_R (headlight fronts), tail_L / tail_R, exhaust;
// - names the headlight lens mesh lamp_lenses, the seats seat_* and the tyres tyre_*;
// - keeps base colour (PNG only where its alpha is really used) and metal/roughness,
//   shrunk to what a chase-camera vehicle needs, and drops the spec-gloss textures.
// src/campus/kart.ts loads the result.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art-source', 'buggy', 'Mini_Dune_Buggy.glb');
const OUT = join(root, 'public', 'assets', 'models', 'kalki', 'kalki.glb');
if (!existsSync(SRC)) {
  console.error(`missing ${SRC}`);
  process.exit(1);
}

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.error('[page error]', e));
await page.route('http://conv.local/**', (route) => {
  const p = decodeURIComponent(new URL(route.request().url()).pathname);
  if (p === '/') {
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><script type="importmap">{"imports":{"three":"/nm/three/build/three.module.js","three/addons/":"/nm/three/examples/jsm/"}}</script><body></body>' });
  }
  const file = p === '/src.glb' ? SRC : p.startsWith('/nm/') ? join(root, 'node_modules', p.slice(4)) : null;
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: readFileSync(file), contentType: extname(file) === '.js' ? 'text/javascript' : 'application/octet-stream' });
});
await page.goto('http://conv.local/');

const b64 = await page.evaluate(async () => {
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');

  const WHEELBASE = 1.95;
  // Source nodes (Mini_Dune_Buggy.glb): wheel groups, steering wheel, seats, lamps.
  const WHEELS = { node_id48: 'RR', node_id55: 'FR', node_id62: 'RL', node_id69: 'FL' };
  const STEERING = 'node_id36';
  const SEATS = ['node_id32', 'node_id34'];
  const LENSES = 'node_id43';
  // Big, close-to-camera parts get more texture.
  const BIG = new Set(['node_id103', 'node_id99', 'node_id101', 'node_id77', 'node_id88', 'node_id41', 'node_id96', 'node_id83']);

  const gltf = await new GLTFLoader().loadAsync('/src.glb');
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const byName = (n) => {
    const o = src.getObjectByName(n);
    if (!o) throw new Error('missing source node ' + n);
    return o;
  };
  const worldBox = (o) => new THREE.Box3().setFromObject(o);

  // Normalising transform: wheel centres -> y 0, axle midpoint -> z 0, scaled to WHEELBASE.
  const wc = {};
  for (const [n, id] of Object.entries(WHEELS)) wc[id] = worldBox(byName(n)).getCenter(new THREE.Vector3());
  const front = (wc.FL.z + wc.FR.z) / 2;
  const rear = (wc.RL.z + wc.RR.z) / 2;
  const S = WHEELBASE / (front - rear);
  const N = new THREE.Matrix4().makeScale(S, S, S).multiply(new THREE.Matrix4().makeTranslation(-(wc.FL.x + wc.FR.x) / 2, -(wc.FL.y + wc.RL.y) / 2, -(front + rear) / 2));
  const norm = (v) => v.clone().applyMatrix4(N);

  // ---------------------------------------------------------------- textures
  const cache = new Map();
  /** Canvas copy of a texture at most `max` px; JPEG unless `keepAlpha` and the alpha is used. */
  function shrink(tex, max, keepAlpha) {
    if (!tex) return null;
    const key = tex.uuid + '|' + max;
    if (cache.has(key)) return cache.get(key);
    const img = tex.image;
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    let alpha = false;
    if (keepAlpha) {
      const d = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < 200) { alpha = true; break; }
    }
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.colorSpace = tex.colorSpace;
    t.wrapS = tex.wrapS;
    t.wrapT = tex.wrapT;
    t.userData.mimeType = alpha ? 'image/png' : 'image/jpeg';
    const r = { t, alpha };
    cache.set(key, r);
    return r;
  }
  function material(m, big) {
    const base = shrink(m.map, big ? 512 : 256, true);
    const mr = shrink(m.roughnessMap ?? m.metalnessMap, big ? 256 : 128, false);
    const out = new THREE.MeshStandardMaterial({
      name: m.name,
      color: m.color,
      map: base?.t ?? null,
      roughness: m.roughness,
      metalness: m.metalness,
      roughnessMap: mr?.t ?? null,
      metalnessMap: mr?.t ?? null,
      side: THREE.DoubleSide,
      alphaTest: base?.alpha ? 0.5 : 0,
    });
    return out;
  }

  // ---------------------------------------------------------------- rebuild
  const out = new THREE.Group();
  out.name = 'kalki';
  const tmp = new THREE.Matrix4();
  /** Mesh copy with its world transform (normalised) baked into the geometry, then `then` applied. */
  function bake(mesh, then = null, name = mesh.name) {
    const g = mesh.geometry.clone();
    tmp.multiplyMatrices(N, mesh.matrixWorld);
    if (then) tmp.premultiply(then);
    g.applyMatrix4(tmp);
    if (tmp.determinant() < 0) {
      // Mirrored parts: flip the winding back.
      const idx = g.index;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i + 1);
        idx.setX(i + 1, idx.getX(i + 2));
        idx.setX(i + 2, a);
      }
    }
    const m = new THREE.Mesh(g, material(mesh.material, BIG.has(mesh.name) || BIG.has(mesh.parent?.name)));
    m.name = name;
    return m;
  }
  const placed = new Set();

  // Wheels: node at the wheel centre, meshes around it.
  for (const [n, id] of Object.entries(WHEELS)) {
    const c = norm(wc[id]);
    const node = new THREE.Group();
    node.name = 'wheel_' + id;
    node.position.copy(c);
    const back = new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z);
    let k = 0;
    byName(n).traverse((o) => {
      if (!o.isMesh) return;
      node.add(bake(o, back, `tyre_${id}_${k++}`));
      placed.add(o);
    });
    out.add(node);
  }

  // Steering wheel: local Z along its axis (the direction of least spread), origin at its centre.
  {
    const sw = byName(STEERING);
    const mesh = sw.isMesh ? sw : sw.children.find((o) => o.isMesh);
    const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(N, mesh.matrixWorld));
    const p = g.attributes.position;
    const c = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 1) c.add(new THREE.Vector3().fromBufferAttribute(p, i));
    c.divideScalar(p.count);
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    const d = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 1) {
      d.fromBufferAttribute(p, i).sub(c);
      const a = [d.x, d.y, d.z];
      for (let r = 0; r < 3; r += 1) for (let q = 0; q < 3; q += 1) cov[r * 3 + q] += a[r] * a[q];
    }
    // Smallest-variance axis by inverse power iteration on (cov + eps).
    const M3 = new THREE.Matrix3().fromArray(cov).transpose();
    const eps = 1e-9 * (cov[0] + cov[4] + cov[8]);
    M3.elements[0] += eps;
    M3.elements[4] += eps;
    M3.elements[8] += eps;
    const inv = M3.clone().invert();
    let axis = new THREE.Vector3(0, 0.5, 1).normalize();
    for (let i = 0; i < 60; i += 1) axis = axis.applyMatrix3(inv).normalize();
    // Point the column up and back toward the driver (+Y, -Z).
    if (axis.y - axis.z < 0) axis.negate();
    const pivot = new THREE.Group();
    pivot.name = 'steering';
    pivot.position.copy(c);
    pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
    pivot.updateMatrix();
    const toPivot = pivot.matrix.clone().invert();
    const m = bake(mesh, toPivot, 'steering_wheel');
    placed.add(mesh);
    pivot.add(m);
    out.add(pivot);
    console.log('steering centre', c.toArray().map((x) => x.toFixed(3)).join(','), 'axis', axis.toArray().map((x) => x.toFixed(2)).join(','));
  }

  // Everything else, baked in place.
  src.traverse((o) => {
    if (!o.isMesh || placed.has(o)) return;
    let name = o.name;
    if (SEATS.includes(o.name)) name = 'seat_' + o.name;
    if (o.name === LENSES) name = 'lamp_lenses';
    out.add(bake(o, null, name));
  });

  // ---------------------------------------------------------------- markers
  const marker = (name, v) => {
    const e = new THREE.Object3D();
    e.name = name;
    e.position.copy(v);
    out.add(e);
    console.log(name, v.toArray().map((x) => x.toFixed(3)).join(','));
  };
  const steer = out.getObjectByName('steering').position;
  const seatBox = new THREE.Box3();
  for (const n of SEATS) seatBox.union(worldBox(byName(n)).applyMatrix4(N));
  // The driver's seat: under the steering wheel, cushion top a third of the way up the seat.
  marker('seat', new THREE.Vector3(steer.x, seatBox.min.y + (seatBox.max.y - seatBox.min.y) * 0.3, seatBox.getCenter(new THREE.Vector3()).z));
  const lens = worldBox(byName(LENSES)).applyMatrix4(N);
  marker('lamp_L', new THREE.Vector3(lens.max.x * 0.6, (lens.min.y + lens.max.y) / 2, lens.max.z));
  marker('lamp_R', new THREE.Vector3(lens.min.x * 0.6, (lens.min.y + lens.max.y) / 2, lens.max.z));
  const all = new THREE.Box3().setFromObject(out);
  // The rear frame ends about 0.4 m behind the rear axle (the cage reaches further back, up high).
  const rearFrame = norm(wc.RL).z - 0.4;
  marker('tail_L', new THREE.Vector3(0.5, 0.12, rearFrame));
  marker('tail_R', new THREE.Vector3(-0.5, 0.12, rearFrame));
  marker('exhaust', new THREE.Vector3(-0.2, 0.05, rearFrame));
  console.log('bounds', all.min.toArray().map((x) => x.toFixed(2)).join(','), '->', all.max.toArray().map((x) => x.toFixed(2)).join(','));
  console.log('wheel radius', ((worldBox(byName(Object.keys(WHEELS)[0])).getSize(new THREE.Vector3()).y * S) / 2).toFixed(3));
  console.log('half track', (norm(wc.FL).x).toFixed(3), 'front z', norm(wc.FL).z.toFixed(3), 'rear z', norm(wc.RL).z.toFixed(3));

  const glb = await new GLTFExporter().parseAsync(out, { binary: true });
  const bytes = new Uint8Array(glb);
  let str = '';
  for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(str);
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, Buffer.from(b64, 'base64'));
console.log(`wrote ${OUT} (${(Buffer.byteLength(b64, 'base64') / 1048576).toFixed(2)} MB)`);
await browser.close();
