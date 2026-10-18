// Downloads the CC0 assets listed in assets.manifest.json from Poly Haven
// (https://polyhaven.com, all assets CC0) into public/assets/.
// Each asset is written into its own directory. Existing files are skipped,
// so the script can be re-run safely.
//
//   node scripts/fetch-assets.mjs            # fetch everything
//   node scripts/fetch-assets.mjs fern_02    # fetch only matching slugs

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'assets.manifest.json'), 'utf8'));
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const API = 'https://api.polyhaven.com';
const MAP_KEYS = { diff: 'Diffuse', nor_gl: 'nor_gl', rough: 'Rough', disp: 'Displacement', ao: 'AO', arm: 'arm' };

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function download(url, dest) {
  if (await exists(dest)) return 'skip';
  await mkdir(dirname(dest), { recursive: true });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return 'ok';
    } catch (error) {
      if (attempt === 3) throw new Error(`${url}: ${error.message}`);
    }
  }
  return 'ok';
}

async function filesFor(slug) {
  const res = await fetch(`${API}/files/${slug}`);
  if (!res.ok) throw new Error(`files/${slug}: HTTP ${res.status}`);
  return res.json();
}

let fetched = 0;
let skipped = 0;
const note = (result) => (result === 'skip' ? (skipped += 1) : (fetched += 1));

// Tiling PBR texture sets.
for (const [slug, spec] of Object.entries(manifest.textures ?? {})) {
  if (only && !only.test(slug)) continue;
  const files = await filesFor(slug);
  const res = spec.res ?? '1k';
  for (const map of spec.maps) {
    const entry = files[MAP_KEYS[map]]?.[res]?.jpg;
    if (!entry) { console.warn(`! ${slug}: no ${map} at ${res}`); continue; }
    note(await download(entry.url, join(root, 'public/assets/textures', slug, `${map}.jpg`)));
  }
  console.log(`texture ${slug}`);
}

// Whole glTF models with their 1k textures (EXR variants skipped).
for (const slug of manifest.models ?? []) {
  if (only && !only.test(slug)) continue;
  const files = await filesFor(slug);
  const gltf = files.gltf?.['1k']?.gltf;
  if (!gltf) { console.warn(`! ${slug}: no 1k glTF`); continue; }
  const dir = join(root, 'public/assets/models', slug);
  note(await download(gltf.url, join(dir, `${slug}.gltf`)));
  for (const [rel, inc] of Object.entries(gltf.include ?? {})) {
    if (rel.endsWith('.exr')) continue;
    note(await download(inc.url, join(dir, rel)));
  }
  console.log(`model ${slug}`);
}

// Individual maps of a model (used for foliage cards whose geometry is built in code).
// Spec: { "<api map key>": "<local name>" }, e.g. { "twig_alpha": "alpha" }.
for (const [slug, maps] of Object.entries(manifest.foliage ?? {})) {
  if (only && !only.test(slug)) continue;
  const files = await filesFor(slug);
  for (const [key, local] of Object.entries(maps)) {
    const entry = files[key]?.['1k']?.jpg;
    if (!entry) { console.warn(`! ${slug}: no ${key}`); continue; }
    note(await download(entry.url, join(root, 'public/assets/foliage', slug, `${local}.jpg`)));
  }
  console.log(`foliage ${slug}`);
}

console.log(`done: ${fetched} downloaded, ${skipped} already present`);

// Embed geometry buffers so the models are served as plain JSON (see pack-models.mjs).
await import('./pack-models.mjs');
