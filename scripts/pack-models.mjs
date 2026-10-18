// Packs every downloaded glTF model into one JSON file with its geometry buffer
// embedded as a base64 data URI (textures stay external .jpg files). Static hosts
// that only serve common web types (no .bin/.gltf) can then serve the models.
//
//   node scripts/pack-models.mjs   -> public/assets/models/<slug>/<slug>.gltf.json

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'models');
let n = 0;
for (const slug of await readdir(root)) {
  const src = join(root, slug, `${slug}.gltf`);
  if (!existsSync(src)) continue;
  const gltf = JSON.parse(await readFile(src, 'utf8'));
  for (const buf of gltf.buffers ?? []) {
    if (!buf.uri || buf.uri.startsWith('data:')) continue;
    const bin = await readFile(join(root, slug, buf.uri));
    buf.uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  }
  await writeFile(join(root, slug, `${slug}.gltf.json`), JSON.stringify(gltf));
  n += 1;
}
console.log(`packed ${n} models`);
