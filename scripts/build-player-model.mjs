// Builds the player's character (public/assets/models/player/survivor.glb) from the
// Survival Character source in art-source/survival-character (FBX + texture folders,
// not committed: hundreds of MB of 4K textures).
//
//   node scripts/build-player-model.mjs
//
// What it does, in the local Chrome / Edge (playwright-core), with three.js:
// - loads the FBX (Unreal-style rig: 161 bones, centimetres, A-pose, no clips);
// - bakes every mesh in its rest pose to world space, in metres;
// - folds the 161 bones onto the game's 22 (src/character/humanoid.ts BONE_NAMES):
//   twist, corrective and finger bones give their skin weights to the nearest game bone;
// - splits the body by UDIM tile (Head 1001, Body 1002, Arms 1003) so each part has
//   ordinary 0..1 UVs and its own textures;
// - slims the heavy parts (hair, backpack, shoes, mouth) with meshoptimizer;
// - packs base colour + opacity into one RGBA image for hair, brows and lashes, and
//   shrinks every texture to what a third-person figure needs;
// - writes one .glb with a single 22-bone skin, one material per primitive.
// src/character/playerModel.ts straightens and re-binds it at load time.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'art-source', 'survival-character');
const FBX = join(SRC, 'Survival_Character.fbx');
const TEX = join(SRC, 'Textures', 'Textures', 'Textures');
const OUT = join(root, 'public', 'assets', 'models', 'player', 'survivor.glb');

if (!existsSync(FBX)) {
  console.error(`missing ${FBX}`);
  process.exit(1);
}

const TYPES = { '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.fbx': 'application/octet-stream', '.html': 'text/html' };
const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
page.on('console', (m) => {
  const t = m.text();
  if (!t.startsWith('THREE.FBXLoader')) console.log('[page]', t);
});
page.on('pageerror', (e) => console.error('[page error]', e));

const HTML = `<!doctype html><html><head>
<script type="importmap">{"imports":{"three":"/nm/three/build/three.module.js","three/addons/":"/nm/three/examples/jsm/"}}</script>

</head><body></body></html>`;

await page.route('http://conv.local/**', async (route) => {
  const url = new URL(route.request().url());
  const p = decodeURIComponent(url.pathname);
  if (p === '/') return route.fulfill({ body: HTML, contentType: 'text/html' });
  let file = null;
  if (p.startsWith('/nm/')) file = join(root, 'node_modules', p.slice(4));
  else if (p === '/fbx') file = FBX;
  else if (p.startsWith('/tex/')) file = join(TEX, p.slice(5));
  if (!file || !existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
  return route.fulfill({ body: readFileSync(file), contentType: TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' });
});
await page.goto('http://conv.local/');

const result = await page.evaluate(async () => {
  const THREE = await import('three');
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
  const { mergeVertices } = await import('three/addons/utils/BufferGeometryUtils.js');
  const { MeshoptSimplifier: MS } = await import("/nm/meshoptimizer/meshopt_simplifier.js");
  await MS.ready;

  // ---------------------------------------------------------------- game rig
  const PARENT = {
    root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck',
    'shoulder.L': 'chest', 'upperArm.L': 'shoulder.L', 'foreArm.L': 'upperArm.L', 'hand.L': 'foreArm.L',
    'shoulder.R': 'chest', 'upperArm.R': 'shoulder.R', 'foreArm.R': 'upperArm.R', 'hand.R': 'foreArm.R',
    'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L', 'toe.L': 'foot.L',
    'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R', 'toe.R': 'foot.R',
  };
  const NAMES = Object.keys(PARENT);
  // Game bone -> the source bone whose joint it sits on.
  const JOINT = {
    root: 'root', hips: 'pelvis', spine: 'spine_02', chest: 'spine_04', neck: 'neck_01', head: 'head',
    'shoulder.L': 'clavicle_l', 'upperArm.L': 'upperarm_l', 'foreArm.L': 'lowerarm_l', 'hand.L': 'hand_l',
    'shoulder.R': 'clavicle_r', 'upperArm.R': 'upperarm_r', 'foreArm.R': 'lowerarm_r', 'hand.R': 'hand_r',
    'thigh.L': 'thigh_l', 'shin.L': 'calf_l', 'foot.L': 'foot_l', 'toe.L': 'ball_l',
    'thigh.R': 'thigh_r', 'shin.R': 'calf_r', 'foot.R': 'foot_r', 'toe.R': 'ball_r',
  };
  // Source bones whose weights go somewhere other than "their own joint or nearest mapped ancestor".
  const EXTRA = { spine_01: 'hips', spine_03: 'spine', spine_05: 'chest', neck_02: 'neck' };
  const BY_SRC = {};
  for (const [g, s] of Object.entries(JOINT)) BY_SRC[s] = g;
  Object.assign(BY_SRC, EXTRA);
  /** Game bone for a source bone: its own mapping, or the nearest mapped ancestor's. */
  const gameBone = (b) => {
    for (let q = b; q; q = q.parent) if (q.isBone && BY_SRC[q.name]) return BY_SRC[q.name];
    return 'root';
  };

  // ---------------------------------------------------------------- load
  const buf = await (await fetch('/fbx')).arrayBuffer();
  const mgr = new THREE.LoadingManager();
  mgr.setURLModifier(() => 'data:,'); // textures are wired up below, from the texture folders
  const fbx = new FBXLoader(mgr).parse(buf, '');
  fbx.updateMatrixWorld(true);
  const srcMeshes = [];
  fbx.traverse((o) => o.isSkinnedMesh && srcMeshes.push(o));

  // Joint positions (metres) from the first mesh's skeleton.
  const SCALE = 0.01;
  const jointPos = { root: new THREE.Vector3() };
  for (const b of srcMeshes[0].skeleton.bones) {
    const g = BY_SRC[b.name];
    if (g && JOINT[g] === b.name && !jointPos[g]) jointPos[g] = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld).multiplyScalar(SCALE);
  }
  for (const n of NAMES) if (!jointPos[n]) throw new Error('no joint for ' + n);

  // ---------------------------------------------------------------- bake + remap
  const BI = Object.fromEntries(NAMES.map((n, i) => [n, i]));
  /** World-space (metres) position/normal/uv + game skin for every triangle corner of a mesh. */
  function bake(mesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const n = pos.count;
    const bones = mesh.skeleton.bones;
    const boneMat = bones.map((b, i) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, mesh.skeleton.boneInverses[i]));
    const map = bones.map((b) => BI[gameBone(b)]);
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    const J = new Uint16Array(n * 4), W = new Float32Array(n * 4);
    const m = new THREE.Matrix4(), acc = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    const v = new THREE.Vector3(), nn = new THREE.Vector3();
    const toWorld = new THREE.Matrix4().makeScale(SCALE, SCALE, SCALE).multiply(mesh.matrixWorld);
    for (let i = 0; i < n; i += 1) {
      acc.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
      const w = {};
      for (let k = 0; k < 4; k += 1) {
        const wt = sw.getComponent(i, k);
        if (wt <= 0) continue;
        const bi = si.getComponent(i, k);
        tmp.copy(boneMat[bi]);
        for (let e = 0; e < 16; e += 1) acc.elements[e] += tmp.elements[e] * wt;
        w[map[bi]] = (w[map[bi]] ?? 0) + wt;
      }
      m.copy(mesh.bindMatrixInverse).multiply(acc).multiply(mesh.bindMatrix).premultiply(toWorld);
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      P.set([v.x, v.y, v.z], i * 3);
      nn.fromBufferAttribute(nor, i).transformDirection(m);
      N.set([nn.x, nn.y, nn.z], i * 3);
      if (uv) U.set([uv.getX(i), uv.getY(i)], i * 2);
      const top = Object.entries(w).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
      top.forEach(([j, x], k) => {
        J[i * 4 + k] = Number(j);
        W[i * 4 + k] = x / sum;
      });
      if (!top.length) W[i * 4] = 1;
    }
    return { P, N, U, J, W, n };
  }

  /** Geometry from baked corners [start, start+count), with UVs shifted by -uShift (UDIM tile). */
  function geometryOf(b, start, count, uShift = 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(b.P.slice(start * 3, (start + count) * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(b.N.slice(start * 3, (start + count) * 3), 3));
    const U = b.U.slice(start * 2, (start + count) * 2);
    for (let i = 0; i < U.length; i += 2) U[i] -= uShift;
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(b.J.slice(start * 4, (start + count) * 4), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(b.W.slice(start * 4, (start + count) * 4), 4));
    return g;
  }

  /** Indexed, optionally simplified, compacted geometry. */
  function finish(g, ratio, label) {
    let ig = mergeVertices(g, 1e-5);
    const before = ig.index.count / 3;
    if (ratio < 1) {
      const idx = new Uint32Array(ig.index.array);
      const pos = new Float32Array(ig.attributes.position.array);
      const uv = new Float32Array(ig.attributes.uv.array);
      const target = Math.floor((idx.length / 3) * ratio) * 3;
      const [out] = MS.simplifyWithAttributes(idx, pos, 3, uv, 2, [0.5, 0.5], null, target, 0.02, []);
      // Compact: keep only the vertices the simplified triangles use.
      const remap = new Map();
      const order = [];
      const ni = new Uint32Array(out.length);
      for (let i = 0; i < out.length; i += 1) {
        let r = remap.get(out[i]);
        if (r === undefined) {
          r = order.length;
          remap.set(out[i], r);
          order.push(out[i]);
        }
        ni[i] = r;
      }
      const c = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(ig.attributes)) {
        const Arr = a.array.constructor;
        const arr = new Arr(order.length * a.itemSize);
        order.forEach((o, i) => arr.set(a.array.subarray(o * a.itemSize, (o + 1) * a.itemSize), i * a.itemSize));
        c.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
      }
      c.setIndex(new THREE.BufferAttribute(ni, 1));
      ig = c;
    }
    console.log(`${label}: ${before} -> ${ig.index.count / 3} tris`);
    return ig;
  }

  // ---------------------------------------------------------------- textures
  const texCache = new Map();
  async function bitmap(path) {
    const r = await fetch('/tex/' + path);
    if (!r.ok) throw new Error('missing texture ' + path);
    return createImageBitmap(await r.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  }
  /** Canvas texture of `path` at most `max` px, optionally with `alphaPath`'s red channel as alpha. */
  async function tex(path, max, { color = false, alphaPath = null } = {}) {
    const key = path + '|' + max + '|' + alphaPath;
    if (texCache.has(key)) return texCache.get(key);
    const bmp = await bitmap(path);
    const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * s);
    c.height = Math.round(bmp.height * s);
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    if (alphaPath) {
      const ab = await bitmap(alphaPath);
      const ac = document.createElement('canvas');
      ac.width = c.width;
      ac.height = c.height;
      const ag = ac.getContext('2d');
      ag.imageSmoothingQuality = 'high';
      ag.drawImage(ab, 0, 0, c.width, c.height);
      const img = g.getImageData(0, 0, c.width, c.height);
      const a = ag.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = a[i];
      g.putImageData(img, 0, 0);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    t.userData.mimeType = alphaPath ? 'image/png' : 'image/jpeg';
    texCache.set(key, t);
    return t;
  }

  /** Standard PBR material from a base colour / normal / ORM set. */
  async function pbr(name, { base, normal, orm, size, nsize = size, alpha = null, roughness = 0.8, side = THREE.FrontSide }) {
    const m = new THREE.MeshStandardMaterial({ name, color: 0xffffff, roughness, metalness: 0, side });
    m.map = await tex(base, size, { color: true, alphaPath: alpha });
    if (normal) m.normalMap = await tex(normal, nsize);
    if (orm) {
      const t = await tex(orm, nsize);
      m.roughnessMap = m.metalnessMap = m.aoMap = t;
      m.roughness = 1;
      m.metalness = 1;
    }
    if (alpha) {
      m.alphaTest = 0.5;
      m.side = THREE.DoubleSide;
    }
    return m;
  }

  const set = (dir, stem, ext = 'jpg') => ({ base: `${dir}/${stem}_BaseColor.${ext}`, normal: `${dir}/${stem}_Normal.${ext}`, orm: `${dir}/${stem}_OcclusionRoughnessMetallic.${ext}` });
  const udim = (tile) => ({ base: `Body/Body_BaseColor.${tile}.png`, normal: `Body/Body_Normal.${tile}.png`, orm: `Body/Body_OcclusionRoughnessMetallic.${tile}.png` });

  // Per source mesh: how much to keep, and its material(s).
  const PLAN = {
    Eye: { ratio: 1, mat: () => pbr('Eye', { base: 'Eye/Eye_BaseColor.png', size: 256, roughness: 0.15 }) },
    Gloves: { ratio: 1, mat: () => pbr('Gloves', { ...set('Gloves', 'Gloves'), size: 512, nsize: 256 }) },
    Eyeleash: { ratio: 1, mat: () => pbr('Lashes', { base: 'Eyebrow_EyeLeashes/Eyebrows_BaseColor.jpg', alpha: 'Eyebrow_EyeLeashes/Eyebrows_Opacity.jpg', size: 256, roughness: 0.7 }) },
    Jeans: { ratio: 1, mat: () => pbr('Jeans', { ...set('Jeans', 'Jeans'), size: 512, nsize: 256 }) },
    Shoes: { ratio: 0.4, mat: () => pbr('Shoes', { ...set('Shoes', 'Shoes'), size: 512, nsize: 256 }) },
    Jacket: { ratio: 1, mat: () => pbr('Jacket', { ...set('Jacket', 'Jacket'), size: 1024, nsize: 512 }) },
    Hair: { ratio: 0.45, mat: () => pbr('Hair', { base: 'HairStyle/HairBrown_Diffuse_2.jpg', normal: 'HairStyle/HairBrown_Normal.jpg', alpha: 'HairStyle/HairBrown_Alpha.jpg', size: 1024, nsize: 512, roughness: 0.6 }) },
    Eyebrows: { ratio: 1, mat: () => pbr('Brows', { base: 'Eyebrow_EyeLeashes/Eyebrows_BaseColor.jpg', alpha: 'Eyebrow_EyeLeashes/Eyebrows_Opacity.jpg', size: 256, roughness: 0.7 }) },
    Backpack: { ratio: 0.25, mat: () => pbr('Backpack', { ...set('Backpack', 'Backpack'), size: 512, nsize: 256 }) },
    Mouth1: { ratio: 0.2, mat: () => pbr('Mouth', { base: 'Mouth/TeethBaseColor.png', size: 256, roughness: 0.4 }) },
  };
  // The body mesh: one material per UDIM tile.
  const BODY = {
    // Only the face is seen up close; the torso and arms are mostly under the jacket.
    Head: { tile: 1001, shift: 0, size: 1024, nsize: 512 },
    Body2: { tile: 1002, shift: 1, size: 512, nsize: 256 },
    Arms: { tile: 1003, shift: 2, size: 512, nsize: 256 },
  };

  // ---------------------------------------------------------------- build
  const out = new THREE.Group();
  out.name = 'Survivor';
  const bones = {};
  for (const n of NAMES) {
    bones[n] = new THREE.Bone();
    bones[n].name = n;
  }
  for (const n of NAMES) {
    const p = PARENT[n];
    if (p) {
      bones[n].position.copy(jointPos[n]).sub(jointPos[p]);
      bones[p].add(bones[n]);
    } else bones[n].position.copy(jointPos[n]);
  }
  out.add(bones.root);
  out.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(NAMES.map((n) => bones[n]));

  const parts = [];
  let total = 0;
  for (const mesh of srcMeshes) {
    const b = bake(mesh);
    if (mesh.name === 'Body3') {
      const mats = mesh.material;
      for (const [mname, info] of Object.entries(BODY)) {
        // Gather this material's triangles from all its groups.
        const ranges = mesh.geometry.groups.filter((gr) => mats[gr.materialIndex].name === mname);
        const count = ranges.reduce((s, r) => s + r.count, 0);
        const sub = { P: new Float32Array(count * 3), N: new Float32Array(count * 3), U: new Float32Array(count * 2), J: new Uint16Array(count * 4), W: new Float32Array(count * 4) };
        let o = 0;
        for (const r of ranges) {
          sub.P.set(b.P.subarray(r.start * 3, (r.start + r.count) * 3), o * 3);
          sub.N.set(b.N.subarray(r.start * 3, (r.start + r.count) * 3), o * 3);
          sub.U.set(b.U.subarray(r.start * 2, (r.start + r.count) * 2), o * 2);
          sub.J.set(b.J.subarray(r.start * 4, (r.start + r.count) * 4), o * 4);
          sub.W.set(b.W.subarray(r.start * 4, (r.start + r.count) * 4), o * 4);
          o += r.count;
        }
        const g = finish(geometryOf(sub, 0, count, info.shift), 1, 'Body/' + mname);
        const mat = await pbr(mname === 'Body2' ? 'Skin_Body' : mname === 'Arms' ? 'Skin_Arms' : 'Skin_Head', { ...udim(info.tile), size: info.size, nsize: info.nsize, roughness: 0.6 });
        parts.push([g, mat]);
        total += g.index.count / 3;
      }
      continue;
    }
    const plan = PLAN[mesh.name];
    if (!plan) throw new Error('no plan for mesh ' + mesh.name);
    const g = finish(geometryOf(b, 0, b.n), plan.ratio, mesh.name);
    parts.push([g, await plan.mat()]);
    total += g.index.count / 3;
  }
  for (const [g, mat] of parts) {
    const sm = new THREE.SkinnedMesh(g, mat);
    sm.name = mat.name;
    sm.bind(skeleton, new THREE.Matrix4());
    out.add(sm);
  }
  console.log('total tris', total);
  const box = new THREE.Box3();
  for (const [g] of parts) {
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  console.log('bounds', box.min.toArray().map((x) => x.toFixed(2)).join(','), '->', box.max.toArray().map((x) => x.toFixed(2)).join(','));

  const glb = await new GLTFExporter().parseAsync(out, { binary: true });
  const bytes = new Uint8Array(glb);
  let str = '';
  for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(str);
});

writeFileSync(OUT, Buffer.from(result, 'base64'));
console.log(`wrote ${OUT} (${(Buffer.byteLength(result, 'base64') / 1048576).toFixed(2)} MB)`);
await browser.close();
