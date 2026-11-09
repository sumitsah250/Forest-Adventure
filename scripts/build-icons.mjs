// Renders the app icons (PNG) for both games from inline SVG using the local Chrome/Edge.
//   node scripts/build-icons.mjs
// Writes public/icons/<game>-{192,512,maskable-512,apple-180}.png and <game>.svg.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/icons');
await mkdir(outDir, { recursive: true });

const executablePath = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find((p) => existsSync(p));

// Each game: a full-bleed background and a foreground drawn on a 512 grid.
const GAMES = {
  forest: {
    bg: `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1d22"/><stop offset="0.7" stop-color="#2a4636"/><stop offset="1" stop-color="#3b5a3b"/></linearGradient>
      <radialGradient id="moonglow"><stop offset="0" stop-color="#f3e6b8" stop-opacity="0.35"/><stop offset="1" stop-color="#f3e6b8" stop-opacity="0"/></radialGradient></defs>
      <rect width="512" height="512" fill="url(#sky)"/>`,
    fg: `<circle cx="352" cy="150" r="120" fill="url(#moonglow)"/>
      <circle cx="352" cy="150" r="54" fill="#f3e6b8"/>
      <path d="M96 400 L132 320 L120 320 L150 262 L140 262 L168 210 L196 262 L186 262 L216 320 L204 320 L240 400Z" fill="#132219"/>
      <path d="M300 400 L330 330 L320 330 L346 280 L338 280 L362 236 L386 280 L378 280 L404 330 L394 330 L424 400Z" fill="#132219"/>
      <path d="M256 84 L328 196 L298 196 L354 282 L322 282 L388 392 L124 392 L190 282 L158 282 L214 196 L184 196Z" fill="#08110c"/>
      <rect x="244" y="388" width="24" height="34" fill="#08110c"/>
      <path d="M0 404 Q256 370 512 404 V512 H0Z" fill="#08110c"/>
      <ellipse cx="240" cy="306" rx="8" ry="5" fill="#eef36f"/><ellipse cx="272" cy="306" rx="8" ry="5" fill="#eef36f"/>
      <circle cx="140" cy="200" r="4" fill="#e8f58a"/><circle cx="410" cy="250" r="3.5" fill="#e8f58a"/><circle cx="96" cy="300" r="3" fill="#e8f58a"/>`,
  },
  campus: {
    bg: `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#14305f"/><stop offset="0.6" stop-color="#2d5592"/><stop offset="1" stop-color="#e3a07c"/></linearGradient>
      <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.4" stop-color="#f2e2d8"/><stop offset="0.42" stop-color="#7f95b8"/><stop offset="1" stop-color="#5d7398"/></linearGradient></defs>
      <rect width="512" height="512" fill="url(#sky)"/>`,
    fg: `<path d="M0 512 V410 L80 372 L140 392 L210 330 L236 346 L256 288 L270 312 L288 296 L326 362 L404 340 L512 384 V512Z" fill="url(#snow)"/>
      <path d="M0 512 V448 Q128 420 256 446 T512 440 V512Z" fill="#1d3a31"/>
      <g transform="translate(0 -18)">
        <path d="M256 118 L408 182 L256 246 L104 182Z" fill="#f2d27a"/>
        <path d="M172 214 V282 C172 318 340 318 340 282 V214 L256 250Z" fill="#c9a24c"/>
        <path d="M256 182 L370 204 V286" fill="none" stroke="#f2d27a" stroke-width="8" stroke-linecap="round"/>
        <circle cx="370" cy="296" r="14" fill="#f2d27a"/>
      </g>`,
  },
};

const svg = (g, { size, maskable, rounded }) => {
  const s = maskable ? 0.8 : 1;
  const o = (512 - 512 * s) / 2;
  const clip = rounded ? '<clipPath id="r"><rect width="512" height="512" rx="112"/></clipPath>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">${clip}<g${rounded ? ' clip-path="url(#r)"' : ''}>${g.bg}<g transform="translate(${o} ${o}) scale(${s})">${g.fg}</g></g></svg>`;
};

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
for (const [name, g] of Object.entries(GAMES)) {
  await writeFile(join(outDir, `${name}.svg`), svg(g, { size: 512, maskable: false, rounded: true }));
  const variants = [
    [`${name}-192.png`, { size: 192, maskable: false, rounded: true }],
    [`${name}-512.png`, { size: 512, maskable: false, rounded: true }],
    [`${name}-maskable-512.png`, { size: 512, maskable: true, rounded: false }],
    [`${name}-apple-180.png`, { size: 180, maskable: false, rounded: false }],
  ];
  for (const [file, opt] of variants) {
    await page.setViewportSize({ width: opt.size, height: opt.size });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg(g, opt)}</body></html>`);
    await page.locator('svg').screenshot({ path: join(outDir, file), omitBackground: true });
    console.log('wrote', file);
  }
}
await browser.close();
