// The ground as surveyed by drone (scripts/build-campus-scan.mjs writes both files):
//   assets/campus/ground.webp   top-down photo, 0.5 m per pixel over the playable square, buildings,
//                               tree crowns and shadows painted out; transparent where not surveyed
//   assets/campus/surface.png   surface class per metre (codes below), 0 where not surveyed
// Painted under the mapped roads by paint.ts. Either may be missing; the plan then paints as before.

import { WORLD_HALF } from './geo.ts';

/** Surface codes in surface.png. */
export const SURF = { none: 0, grass: 1, dirt: 2, paved: 3, road: 4, scrub: 6 } as const;

export interface ScanGround {
  /** The photo, covering [-WORLD_HALF, WORLD_HALF] on both axes. */
  photo: HTMLImageElement | null;
  /** Surface codes, `n`² cells over the same square (row 0 at the north edge). */
  surface: Uint8Array | null;
  n: number;
}

const BASE = `${import.meta.env.BASE_URL}assets/campus/`;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

let pending: Promise<ScanGround> | null = null;
let loaded: ScanGround | undefined;

/** The survey once loaded (the world build waits for it), for painters that run later. */
export function scanGround(): ScanGround | undefined {
  return loaded;
}

export function loadScanGround(): Promise<ScanGround> {
  pending ??= (async () => {
    const [photo, surf] = await Promise.all([loadImage(`${BASE}ground.webp`), loadImage(`${BASE}surface.png`)]);
    let surface: Uint8Array | null = null;
    let n = 0;
    if (surf) {
      n = surf.naturalWidth;
      const c = document.createElement('canvas');
      c.width = c.height = n;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(surf, 0, 0);
      const d = ctx.getImageData(0, 0, n, n).data;
      surface = new Uint8Array(n * n);
      for (let i = 0; i < n * n; i += 1) surface[i] = d[i * 4];
    }
    loaded = { photo, surface, n };
    return loaded;
  })();
  return pending;
}

/** World square the scan images cover (same as the painted plan). */
export const SCAN_HALF = WORLD_HALF;
