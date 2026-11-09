// Shrinks textures to at most --max pixels a side (JPEG), in place: images embedded in a .glb, or .jpg files.
//
//   node scripts/shrink-textures.mjs public/assets/models/player/sumit_character.glb --max 1024
//   node scripts/shrink-textures.mjs public/assets/models/metal_toolbox/textures/*.jpg --max 512
//
// Why: the player character was exported with nine 2048² textures (~200 MB of GPU memory, ~2.8 MB of download) for a
// figure seen from behind, and the quest props (notebook, toolbox, power box) carry 1K PBR sets for items that are a
// few centimetres on screen. Re-run after re-exporting or adding such assets. Images are resized in the local
// Chrome / Edge (playwright-core), which filters well when scaling down. Files already small enough are left alone.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const maxArg = args.indexOf('--max');
const max = maxArg >= 0 ? Number(args[maxArg + 1]) : 1024;
const files = args.filter((a, i) => !a.startsWith('--') && (maxArg < 0 || i !== maxArg + 1));
const quality = 0.88;
if (!files.length || !Number.isFinite(max)) {
  console.error('usage: node scripts/shrink-textures.mjs <file.glb | image.jpg>... [--max 1024]');
  process.exit(1);
}

const executablePath = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();

/** Resized JPEG bytes, or null when the image is already within `max`. */
async function shrink(bytes, type) {
  const out = await page.evaluate(
    async ({ b64, type, max, quality }) => {
      const src = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([src], { type }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
      const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (s === 1) return null;
      const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
      const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, c.width, c.height);
      const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
      let str = '';
      for (let i = 0; i < buf.length; i += 0x8000) str += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { b64: btoa(str), size: `${bmp.width}x${bmp.height} -> ${c.width}x${c.height}` };
    },
    { b64: Buffer.from(bytes).toString('base64'), type, max, quality },
  );
  return out && { data: Buffer.from(out.b64, 'base64'), size: out.size };
}

const kb = (n) => `${(n / 1024) | 0} KB`;

async function shrinkGlb(file) {
  const glb = readFileSync(file);
  if (glb.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a .glb`);
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = glb.subarray(binStart, binStart + glb.readUInt32LE(20 + jsonLen));
  const viewBytes = (v) => bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  const replaced = new Map();
  for (const img of json.images ?? []) {
    if (img.bufferView === undefined) continue;
    const src = viewBytes(json.bufferViews[img.bufferView]);
    const r = await shrink(src, img.mimeType ?? 'image/jpeg');
    if (!r) continue;
    replaced.set(img.bufferView, r.data);
    img.mimeType = 'image/jpeg';
    console.log(`  ${img.name ?? img.bufferView}: ${r.size}, ${kb(src.length)} -> ${kb(r.data.length)}`);
  }
  if (!replaced.size) return console.log(`${file}: nothing to shrink`);

  // Repack the binary chunk: every buffer view in order, 4-byte aligned, with the new image bytes.
  const parts = [];
  let offset = 0;
  json.bufferViews.forEach((v, i) => {
    const data = replaced.get(i) ?? viewBytes(v);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) parts.push(Buffer.alloc(pad));
    offset += pad;
    v.byteOffset = offset;
    v.byteLength = data.length;
    parts.push(Buffer.from(data));
    offset += data.length;
  });
  const newBin = Buffer.concat([...parts, Buffer.alloc((4 - (offset % 4)) % 4)]);
  json.buffers[0].byteLength = offset;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const chunk = (len, type) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(len, 0);
    h.writeUInt32LE(type, 4);
    return h;
  };
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + newBin.length, 8);
  const result = Buffer.concat([header, chunk(jsonBuf.length, 0x4e4f534a), jsonBuf, chunk(newBin.length, 0x004e4942), newBin]);
  writeFileSync(file, result);
  console.log(`${file}: ${(glb.length / 1048576).toFixed(2)} MB -> ${(result.length / 1048576).toFixed(2)} MB`);
}

async function shrinkImage(file) {
  if (!/\.jpe?g$/i.test(file)) return console.log(`${file}: skipped (only .jpg is rewritten in place)`);
  const src = readFileSync(file);
  const r = await shrink(src, 'image/jpeg');
  if (!r) return console.log(`${file}: already within ${max}px`);
  writeFileSync(file, r.data);
  console.log(`${file}: ${r.size}, ${kb(src.length)} -> ${kb(r.data.length)}`);
}

try {
  for (const f of files) await (f.toLowerCase().endsWith('.glb') ? shrinkGlb(f) : shrinkImage(f));
} finally {
  await browser.close();
}
