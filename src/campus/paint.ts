// Paints the campus plan onto canvases: the ground colour texture, a surface-class grid
// (footsteps, tree placement) and the clean top-down map used by the minimap.

import { DATA, WORLD_HALF, orientedRect, segDist, type AreaData, type LineData, type Pt } from './geo.ts';
import { CLS } from './ground.ts';
import { SURF, type ScanGround } from './scanGround.ts';
import { mulberry32 } from '../world/rng.ts';

type Style = 'ground' | 'map' | 'class';

const H = WORLD_HALF;

const GROUND: Record<string, string> = {
  outside: '#7b7a52', campus: '#6c8743', grass: '#688a3d', park: '#5c8638', ground: '#978462', orchard: '#5b7838', scrub: '#58703a',
  parking: '#8f8c84', water: '#3d5a66', plaza: '#a7a092', residential: '#86805f', basketball: '#9b9a93', tennis: '#4f6f6c', volleyball: '#9b8360',
  // The WRC ground is hard-packed earth, not turf.
  soccer: '#9a8662', table_tennis: '#9b9a93', pitch: '#7a8a55',
  road: '#4b4c4d', roadEdge: '#76746c', residentialRoad: '#77736a', service: '#626260', footway: '#b9b2a3', footEdge: '#58544c', path: '#8b7150', steps: '#9d978c',
  track: '#86735a', drain: '#4c524c', apron: '#a39e92', footprint: '#77746d',
};

const MAP: Record<string, string> = {
  outside: '#d9d4c4', campus: '#c9dcae', grass: '#b8d69a', park: '#a5cf86', ground: '#b9cf8e', orchard: '#a9c98f', scrub: '#a9c38f',
  parking: '#cfcac0', water: '#9cc3d4', plaza: '#e3dccd', residential: '#dcd5c3', basketball: '#d9c39e', tennis: '#9fc0b8', volleyball: '#dcc5a0',
  soccer: '#9fcf7a', table_tennis: '#d9c39e', pitch: '#b0cf8e',
  road: '#ffffff', roadEdge: '#b8b2a2', residentialRoad: '#fbf8ef', service: '#fbf8ef', footway: '#f1e7d2', footEdge: '#d6ccb8', path: '#d8c19a', steps: '#e6dccb',
  track: '#d8c19a', drain: '#9cc3d4', apron: '#e8e2d4', footprint: '#b4ab98',
};

const CLS_OF: Record<string, number> = {
  outside: CLS.soil, campus: CLS.grass, grass: CLS.grass, park: CLS.grass, ground: CLS.grass, orchard: CLS.grass, scrub: CLS.grass,
  parking: CLS.paved, water: CLS.water, plaza: CLS.paved, residential: CLS.soil, basketball: CLS.pitch, tennis: CLS.pitch, volleyball: CLS.pitch,
  soccer: CLS.pitch, table_tennis: CLS.pitch, pitch: CLS.pitch,
  road: CLS.road, roadEdge: CLS.road, residentialRoad: CLS.road, service: CLS.road, footway: CLS.paved, footEdge: CLS.paved, path: CLS.path, steps: CLS.path,
  track: CLS.path, drain: CLS.soil, apron: CLS.paved, footprint: CLS.building,
};

function fill(style: Style, key: string): string {
  if (style === 'class') {
    const c = CLS_OF[key] ?? CLS.soil;
    return `rgb(${c * 30},0,0)`;
  }
  return (style === 'map' ? MAP : GROUND)[key] ?? '#888';
}

function areaKey(a: AreaData): string {
  if (a.kind === 'pitch') {
    const s = (a.sport ?? '').split(';')[0];
    return s in GROUND ? s : 'pitch';
  }
  return a.kind;
}

const AREA_ORDER: AreaData['kind'][] = ['residential', 'grass', 'scrub', 'orchard', 'park', 'ground', 'plaza', 'parking', 'water', 'pitch'];

/** Paved width of a walking path (m): never narrower than two people side by side. */
function walkWidth(l: LineData): number {
  return Math.max(1.8, l.w);
}

/**
 * Slab paving as a canvas pattern: ~1.2 m concrete slabs in stretcher bond with darker joints and a
 * little tone variation slab to slab. `k` is canvas pixels per metre.
 */
function pavingPattern(ctx: CanvasRenderingContext2D, k: number): CanvasPattern | string {
  const base = '#b9b2a3';
  const t = Math.max(4, Math.round(k * 1.2));
  const c = document.createElement('canvas');
  c.width = c.height = t * 2;
  const g = c.getContext('2d');
  if (!g) return base;
  g.fillStyle = base;
  g.fillRect(0, 0, t * 2, t * 2);
  const rng = mulberry32(0x5a1b);
  for (let row = 0; row < 2; row += 1) {
    const off = row ? t / 2 : 0;
    for (let col = -1; col < 2; col += 1) {
      const v = Math.round((rng() - 0.5) * 18);
      g.fillStyle = `rgb(${185 + v},${178 + v},${163 + v})`;
      g.fillRect(col * t + off, row * t, t, t);
    }
  }
  // A 5 cm joint is far thinner than a texture pixel (about 20 cm on Medium, 40 cm on Low): drawn a
  // whole pixel wide at full strength, the joints made every path a heavy dark ladder. Draw them as
  // faint as their real width averaged over the pixel, enough to still read as slabs.
  const j = Math.max(1, Math.round(k * 0.05));
  const cover = Math.min(1, (k * 0.05) / j);
  g.fillStyle = `rgba(78,72,62,${Math.max(0.16, 0.5 * cover).toFixed(3)})`;
  for (let row = 0; row < 2; row += 1) {
    g.fillRect(0, row * t, t * 2, j);
    const off = row ? Math.round(t / 2) : 0;
    for (let x = off; x < t * 2; x += t) g.fillRect(x, row * t, j, t);
  }
  return ctx.createPattern(c, 'repeat') ?? base;
}

/** Nearest point on a mapped line of `kinds` to (x, z), at least `min` metres away. */
function nearestOn(x: number, z: number, kinds: RegExp, min = 0): { d: number; px: number; pz: number } | null {
  let best: { d: number; px: number; pz: number } | null = null;
  for (const l of DATA.lines) {
    if (l.area || l.pts.length < 2 || !kinds.test(l.kind)) continue;
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      const r = segDist(x, z, l.pts[i], l.pts[i + 1]);
      if (r.d >= min && (!best || r.d < best.d)) best = r;
    }
  }
  return best;
}

/**
 * Paved ways the map lacks, around the Saraswati temple: (1) the approach, from the temple to the
 * nearest path or road (world.ts turns the temple's door to face it), (2) a paved circumambulation
 * walk around the temple (the pradakshina path every Nepali temple has), and (3) a link from that
 * walk to the nearest footpath beyond it, so the temple is reached on paving from the campus paths.
 */
export function approaches(): LineData[] {
  const out: LineData[] = [];
  const paved = (pts: Pt[], w: number): LineData => ({ kind: 'footway', w, pts, surface: 'paving_stones' });
  for (const b of DATA.buildings) {
    if (b.kind !== 'temple') continue;
    const r = orientedRect(b.pts);
    const door = nearestOn(r.cx, r.cz, /^(footway|path|pedestrian|steps|service|residential|unclassified|tertiary|secondary|primary)$/);
    if (!door || door.d > 60) continue;
    out.push(paved([[r.cx, r.cz], [door.px, door.pz]], 2.2));
    // The walk around: 1.3 m out from the footprint, 2.4 m wide.
    const ca = Math.cos(r.angle), sa = Math.sin(r.angle);
    const at = (u: number, v: number): Pt => [r.cx + u * ca - v * sa, r.cz + u * sa + v * ca];
    const L = r.hl + 1.3, W = r.hw + 1.3;
    const ring = [at(L, W), at(-L, W), at(-L, -W), at(L, -W), at(L, W)];
    out.push(paved(ring, 2.4));
    // The link: from the nearest point of the walk to the nearest footpath clear of the temple.
    const walk = nearestOn(r.cx, r.cz, /^(footway|path|pedestrian|steps)$/, Math.hypot(L, W) + 1);
    if (walk && walk.d < 60) {
      let from = ring[0];
      let fd = Infinity;
      for (let i = 0; i < 4; i += 1) {
        const s = segDist(walk.px, walk.pz, ring[i], ring[i + 1]);
        if (s.d < fd) {
          fd = s.d;
          from = [s.px, s.pz];
        }
      }
      out.push(paved([from, [walk.px, walk.pz]], 2.2));
    }
  }
  return out;
}

function lineStyle(l: LineData): { key: string; edge?: string; w: number } | null {
  switch (l.kind) {
    case 'primary': case 'secondary': case 'tertiary': case 'trunk':
      return { key: 'road', edge: 'roadEdge', w: l.w };
    case 'residential': case 'unclassified': case 'living_street':
      return { key: 'residentialRoad', edge: 'roadEdge', w: l.w };
    case 'service': return { key: l.surface === 'unpaved' || l.surface === 'gravel' ? 'track' : 'service', w: l.w };
    // Every walking path is paved (roads keep their own surfaces).
    case 'footway': case 'pedestrian': case 'cycleway': case 'path':
      return { key: 'footway', edge: 'footEdge', w: walkWidth(l) };
    case 'steps': return { key: 'steps', w: l.w };
    case 'track': return { key: 'track', w: l.w };
    case 'drain': return { key: 'drain', w: l.w };
    default: return null;
  }
}

/** Plan colours for the surveyed surface classes (scanGround.ts codes). */
const SURF_FILL: Record<Exclude<Style, 'ground'>, Record<number, [number, number, number]>> = {
  map: { [SURF.grass]: [184, 214, 154], [SURF.dirt]: [222, 210, 180], [SURF.paved]: [232, 226, 212], [SURF.road]: [246, 244, 238], [SURF.scrub]: [165, 199, 140] },
  class: { [SURF.grass]: [CLS.grass * 30, 0, 0], [SURF.dirt]: [CLS.soil * 30, 0, 0], [SURF.paved]: [CLS.paved * 30, 0, 0], [SURF.road]: [CLS.road * 30, 0, 0], [SURF.scrub]: [CLS.grass * 30, 0, 0] },
};

/** The surveyed surface classes as an image in `style`'s colours (transparent where not surveyed). */
function surfaceLayer(scan: ScanGround, style: Exclude<Style, 'ground'>): HTMLCanvasElement | null {
  if (!scan.surface) return null;
  const n = scan.n;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  const pal = SURF_FILL[style];
  for (let i = 0; i < n * n; i += 1) {
    const col = pal[scan.surface[i]];
    if (!col) continue;
    img.data.set(col, i * 4);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/**
 * Paints the plan at `size` pixels over the playable square. With the drone survey (`scan`), the
 * ground is the surveyed photo (ground style) or surface classes (map, class) under the mapped roads;
 * footpaths and paved yards then sit exactly where they are on the campus.
 */
export function paintPlan(size: number, style: Style, scan?: ScanGround): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  // Every plan is kept in ordinary memory (willReadFrequently): Chrome may throw away a GPU-backed 2D
  // canvas when graphics memory runs short, and these are painted only once, so the minimap went
  // blank, and after the GPU reset the ground texture was re-uploaded from an empty canvas (the roads
  // and paths vanished).
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const k = size / (H * 2);
  const P = (v: number) => (v + H) * k;
  const trace = (pts: Pt[], close: boolean) => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(P(p[0]), P(p[1])) : ctx.moveTo(P(p[0]), P(p[1]))));
    if (close) ctx.closePath();
  };
  ctx.imageSmoothingEnabled = style !== 'class';
  ctx.fillStyle = fill(style, 'outside');
  ctx.fillRect(0, 0, size, size);
  if (style === 'ground') mottle(ctx, size, k, 0x51);

  trace(DATA.boundary, true);
  ctx.fillStyle = fill(style, 'campus');
  ctx.fill();

  const areas = [...DATA.areas].sort((a, b) => AREA_ORDER.indexOf(a.kind) - AREA_ORDER.indexOf(b.kind));
  for (const a of areas) {
    trace(a.pts, true);
    ctx.fillStyle = fill(style, areaKey(a));
    ctx.fill();
    if (a.kind === 'pitch' && style !== 'class') courtLines(ctx, a, k, P, style);
  }
  if (style === 'ground') mottle(ctx, size, k, 0x77, true);

  // The surveyed ground over the mapped areas (pixel centres sit on the survey grid).
  const photo = style === 'ground' ? scan?.photo ?? null : null;
  if (photo) {
    const px = (H * 2) / photo.naturalWidth;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(photo, P(-H - px / 2), P(-H - px / 2), photo.naturalWidth * px * k, photo.naturalWidth * px * k);
    // Court markings stay crisp on top of the photo's courts.
    for (const a of areas) if (a.kind === 'pitch') courtLines(ctx, a, k, P, style);
    // Footpaths (fitted to the trails in the photo by the survey script), every one paved: a
    // concrete kerb edge, then slab paving with its joints, so each path reads clearly where it runs.
    // Roads keep their own surface (drawn below).
    const walks = [...DATA.lines.filter((l) => /^(footway|path|pedestrian|steps)$/.test(l.kind) && !l.area && l.pts.length > 1), ...approaches()];
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const l of walks) {
      trace(l.pts, false);
      ctx.strokeStyle = 'rgba(88,84,76,0.92)';
      ctx.lineWidth = (walkWidth(l) + 0.4) * k;
      ctx.stroke();
    }
    const paving = pavingPattern(ctx, k);
    for (const l of walks) {
      trace(l.pts, false);
      ctx.strokeStyle = paving;
      ctx.lineWidth = walkWidth(l) * k;
      ctx.stroke();
    }
  } else if (scan && style !== 'ground') {
    const layer = surfaceLayer(scan, style);
    if (layer) {
      ctx.imageSmoothingEnabled = style === 'map';
      ctx.drawImage(layer, P(-H - 0.5), P(-H - 0.5), scan.n * k, scan.n * k);
      if (style === 'map') for (const a of areas) if (a.kind === 'pitch') { trace(a.pts, true); ctx.fillStyle = fill(style, areaKey(a)); ctx.fill(); courtLines(ctx, a, k, P, style); }
    }
  }

  // Lines: narrow paths first, roads on top; roads get a kerb edge. Over the surveyed photo only the
  // roads are drawn (crisp kerbs); footpaths, steps and tracks are already in the photo where they really are.
  const SURVEYED = new Set(['footway', 'path', 'steps', 'track', 'drain']);
  const lines = [...DATA.lines, ...approaches()].map((l) => ({ l, s: lineStyle(l) })).filter((x) => x.s && !(photo && SURVEYED.has(x.s.key))) as { l: LineData; s: NonNullable<ReturnType<typeof lineStyle>> }[];
  lines.sort((a, b) => a.s.w - b.s.w);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const { l, s } of lines) {
    if (s.edge) {
      trace(l.pts, false);
      ctx.strokeStyle = fill(style, s.edge);
      ctx.lineWidth = (s.w + (s.edge === 'footEdge' ? 0.4 : 1.2)) * k;
      ctx.stroke();
    }
  }
  for (const { l, s } of lines) {
    trace(l.pts, !!l.area);
    ctx.strokeStyle = fill(style, s.key);
    ctx.lineWidth = Math.max(style === 'map' ? 1.2 : 1, s.w * k);
    ctx.stroke();
    if (l.area) {
      ctx.fillStyle = fill(style, s.key);
      ctx.fill();
    }
    if (style === 'ground' && s.key === 'road') centreLine(ctx, l, k, P);
  }

  // Paved aprons around campus buildings (the photo has the real ones), then the footprints.
  for (const b of DATA.buildings) {
    if (!b.inside || photo) continue;
    trace(b.pts, true);
    ctx.strokeStyle = fill(style, 'apron');
    ctx.lineWidth = 2.6 * k;
    ctx.stroke();
  }
  for (const b of DATA.buildings) {
    trace(b.pts, true);
    ctx.fillStyle = style === 'map' ? (b.inside ? '#c8b48f' : '#cfc7b6') : fill(style, 'footprint');
    ctx.fill();
    if (style === 'map') {
      ctx.strokeStyle = b.inside ? '#8c7650' : '#aaa08c';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  if (style === 'map') {
    trace(DATA.boundary, true);
    ctx.strokeStyle = '#7d6b4a';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (style === 'ground') grain(ctx, size);
  return c;
}

/** Large soft blotches (worn lawn, damp soil). */
function mottle(ctx: CanvasRenderingContext2D, size: number, k: number, seed: number, fine = false): void {
  const rng = mulberry32(seed);
  const n = fine ? 2600 : 1400;
  for (let i = 0; i < n; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (fine ? 1.5 + rng() * 6 : 6 + rng() * 26) * k;
    const light = rng() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = fine ? 0.06 : 0.1;
    g.addColorStop(0, light ? `rgba(196,182,120,${a})` : `rgba(40,52,22,${a})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Pixel-level noise so the texture never looks flat up close. */
function grain(ctx: CanvasRenderingContext2D, size: number): void {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  let s = 1234567;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 8) & 255) / 255 - 0.5;
    const v = n * 18;
    d[i] = Math.max(0, Math.min(255, d[i] + v));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + v));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + v * 0.8));
  }
  ctx.putImageData(img, 0, 0);
}

function centreLine(ctx: CanvasRenderingContext2D, l: LineData, k: number, P: (v: number) => number): void {
  ctx.save();
  ctx.setLineDash([3 * k, 4 * k]);
  ctx.strokeStyle = 'rgba(225,220,200,0.55)';
  ctx.lineWidth = 0.15 * k;
  ctx.beginPath();
  l.pts.forEach((p, i) => (i ? ctx.lineTo(P(p[0]), P(p[1])) : ctx.moveTo(P(p[0]), P(p[1]))));
  ctx.stroke();
  ctx.restore();
}

function courtLines(ctx: CanvasRenderingContext2D, a: AreaData, k: number, P: (v: number) => number, style: Style): void {
  const r = orientedRect(a.pts);
  const sport = (a.sport ?? '').split(';')[0];
  ctx.save();
  ctx.translate(P(r.cx), P(r.cz));
  ctx.rotate(r.angle);
  ctx.strokeStyle = style === 'map' ? 'rgba(255,255,255,0.8)' : 'rgba(236,234,222,0.85)';
  ctx.lineWidth = Math.max(1, 0.1 * k);
  const L = (r.hl - 0.8) * k;
  const W = (r.hw - 0.8) * k;
  ctx.strokeRect(-L, -W, L * 2, W * 2);
  ctx.beginPath();
  ctx.moveTo(0, -W);
  ctx.lineTo(0, W);
  ctx.stroke();
  if (sport === 'basketball' || sport === 'soccer') {
    ctx.beginPath();
    ctx.arc(0, 0, (sport === 'soccer' ? 9.15 : 1.8) * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (sport === 'basketball') {
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * L, 0, 6.75 * k, s > 0 ? Math.PI / 2 : -Math.PI / 2, s > 0 ? (Math.PI * 3) / 2 : Math.PI / 2);
      ctx.stroke();
    }
  }
  if (sport === 'soccer') {
    for (const s of [-1, 1]) ctx.strokeRect(s > 0 ? L - 16.5 * k : -L, -20 * k, 16.5 * k, 40 * k);
  }
  ctx.restore();
}

/** Reads the class canvas back into a code grid. */
export function classGrid(c: HTMLCanvasElement): Uint8Array {
  const n = c.width;
  const d = c.getContext('2d')!.getImageData(0, 0, n, n).data;
  const out = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i += 1) out[i] = Math.min(7, Math.round(d[i * 4] / 30));
  return out;
}
