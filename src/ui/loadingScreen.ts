// Animated loading screens. The forest game's is here; Campus Quest has its own
// (campusLoading.ts) behind the same interface.
//
// Everything that moves uses only transform and opacity, so the browser keeps animating
// it on the compositor while the main thread is busy building the world.

import './loading.css';
import { createCampusLoading } from './campusLoading.ts';

export type LoadingTheme = 'forest' | 'campus';

interface ThemeDef {
  words: [string, string];
  tagline: string;
  tipLabel: string;
  tips: string[];
  tapHint: string;
}

const THEMES: Record<'forest', ThemeDef> = {
  forest: {
    words: ['POACHER', 'PANIC'],
    tagline: 'A ranger has gone silent near Hollow Creek.',
    tipLabel: 'Field note',
    tapHint: 'Tap anywhere to set a firefly loose',
    tips: [
      'Press G for a hint on your current objective. Press it again for more.',
      'F switches the flashlight on. The woods get dark sooner than you expect.',
      'M opens the topographic map. Rangers trust maps over hunches.',
      'E gets you in and out of the truck. L for the headlights.',
      'Headphones help. Listen for the sound that doesn’t belong.',
      'Nothing out there is watching you. Probably.',
      'A missed radio check is boring paperwork. Two days of them is not.',
    ],
  },
};

const PRINTS = 26;

/** Small seeded generator so the silhouettes look the same every visit. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 1600;
const H = 300;

/** A rolling ground line built from a few sine waves. */
function hillY(x: number, base: number, amp: number, phase: number): number {
  return base + amp * (Math.sin(x * 0.004 + phase) * 0.6 + Math.sin(x * 0.011 + phase * 2.3) * 0.3 + Math.sin(x * 0.027 + phase * 0.7) * 0.1);
}

/** A tree line of tiered pines standing on rolling ground. */
function pineRidge(seed: number, base: number, minH: number, maxH: number, gap: [number, number]): string {
  const r = rng(seed);
  const phase = r() * 6;
  let d = `M0 ${H} L0 ${hillY(0, base, 14, phase).toFixed(1)}`;
  let x = -10;
  while (x < W + 30) {
    const h = minH + r() * (maxH - minH);
    const w = h * (0.2 + r() * 0.08);
    const y = hillY(x, base, 14, phase);
    const p = (dx: number, dy: number) => `L${(x + dx).toFixed(1)} ${(y - dy).toFixed(1)}`;
    d += p(-w, 0) + p(-w * 0.55, h * 0.34) + p(-w * 0.78, h * 0.34) + p(-w * 0.36, h * 0.66) + p(-w * 0.52, h * 0.66) + p(0, h);
    d += p(w * 0.52, h * 0.66) + p(w * 0.36, h * 0.66) + p(w * 0.78, h * 0.34) + p(w * 0.55, h * 0.34) + p(w, 0);
    x += gap[0] + r() * (gap[1] - gap[0]);
  }
  return `${d} L${W} ${H} Z`;
}

/** Smooth rolling hills, optionally with a few rooftops along the crest. */
function hills(seed: number, base: number, amp: number, roofs = 0): string {
  const r = rng(seed);
  const phase = r() * 6;
  let d = `M0 ${H}`;
  const roofAt = new Set<number>();
  for (let i = 0; i < roofs; i++) roofAt.add(Math.round((0.12 + r() * 0.76) * 80));
  for (let i = 0; i <= 80; i++) {
    const x = (i / 80) * W;
    const y = hillY(x, base, amp, phase);
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    if (roofAt.has(i)) {
      const bw = 30 + r() * 46;
      const bh = 18 + r() * 26;
      const pitched = r() > 0.5;
      d += ` L${(x + 2).toFixed(1)} ${(y - bh).toFixed(1)}`;
      if (pitched) d += ` L${(x + bw / 2).toFixed(1)} ${(y - bh - 12).toFixed(1)}`;
      d += ` L${(x + bw).toFixed(1)} ${(y - bh).toFixed(1)} L${(x + bw).toFixed(1)} ${hillY(x + bw, base, amp, phase).toFixed(1)}`;
    }
  }
  return `${d} L${W} ${H} Z`;
}

const BOOT = '<svg viewBox="0 0 10 24" aria-hidden="true"><ellipse cx="5" cy="7" rx="4.3" ry="6.6"/><ellipse cx="5" cy="19.2" rx="3.4" ry="4.1"/></svg>';

function svgLayer(cls: string, d: string, fill: string, extra = ''): string {
  return `<svg class="ls__ridge ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" aria-hidden="true">${extra}<path d="${d}" fill="${fill}"/></svg>`;
}

function stars(): string {
  const r = rng(7);
  const dots: string[] = [];
  for (let i = 0; i < 90; i++) {
    const a = (0.25 + r() * 0.75).toFixed(2);
    dots.push(`${(r() * 100).toFixed(2)}vw ${(r() * 62).toFixed(2)}vh 0 ${r() > 0.9 ? 1 : 0}px rgba(255,255,240,${a})`);
  }
  return dots.join(',');
}

export interface LoadingScreen {
  readonly root: HTMLDivElement;
  set(fraction: number, text: string): void;
  fail(message: string): void;
  /** Fills the trail, then fades the screen out and removes it. */
  done(): Promise<void>;
}

export function createLoadingScreen(parent: HTMLElement, theme: LoadingTheme): LoadingScreen {
  if (theme === 'campus') return createCampusLoading(parent);
  const t = THEMES[theme];
  const r = rng(11);
  const root = document.createElement('div');
  root.className = `ls ls--${theme}`;

  const word = (w: string, cls: string, offset: number) =>
    `<span class="ls__word ${cls}">${[...w].map((c, i) => `<span class="ls__ch" style="--i:${i + offset}">${c}</span>`).join('')}</span>`;

  let scenery = `<div class="ls__stars" style="box-shadow:${stars()}"></div><div class="ls__orb"></div>`;
  scenery += svgLayer('ls__ridge--far', hills(3, 120, 40), '#192b24');
  scenery += svgLayer('ls__ridge--mid', pineRidge(5, 205, 70, 130, [16, 34]), '#0d1813');
  let drifters = '';
  for (let i = 0; i < 22; i++) {
    const style = `left:${(r() * 100).toFixed(1)}%;bottom:${(4 + r() * 46).toFixed(1)}vh;--s:${(2.5 + r() * 2.5).toFixed(1)}px;--dx:${(18 + r() * 40).toFixed(0)}px;--dy:${(10 + r() * 26).toFixed(0)}px;--d:${(7 + r() * 8).toFixed(1)}s;--b:${(1.6 + r() * 2.6).toFixed(1)}s;--o:-${(r() * 10).toFixed(1)}s`;
    drifters += `<span class="ls__fly" style="${style}"></span>`;
  }
  drifters += '<div class="ls__eyes" style="left:7%;--d:9s;--o:-2s"><i></i><i></i></div>';
  drifters += '<div class="ls__eyes ls__eyes--far" style="right:9%;--d:13s;--o:-8s"><i></i><i></i></div>';
  const near = svgLayer('ls__ridge--near', pineRidge(9, 250, 110, 190, [40, 80]), '#060b08');

  const prints = Array.from({ length: PRINTS }, (_, i) => `<span class="ls__print" style="--i:${i}">${BOOT}</span>`).join('');

  root.innerHTML = `
    <div class="ls__sky"></div>
    ${scenery}
    <div class="ls__fog"></div>
    ${drifters}
    ${near}
    <div class="ls__grain"></div>
    <div class="ls__center">
      <div class="ls__studio"><span>Sumix Developers presents</span></div>
      <h1 class="ls__title" aria-label="${t.words.join(' ')}">${word(t.words[0], '', 0)}${word(t.words[1], 'ls__word--accent', t.words[0].length)}</h1>
      <p class="ls__tagline">${t.tagline}</p>
    </div>
    <div class="ls__foot">
      <div class="ls__meta"><span class="ls__status">Preparing</span><span class="ls__pct">0<small>%</small></span></div>
      <div class="ls__trail" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <div class="ls__prints">${prints}</div>
        <div class="ls__line"></div>
        <div class="ls__walker"></div>
      </div>
      <p class="ls__tip"><b>${t.tipLabel}</b><span></span></p>
    </div>
    <div class="ls__hint">${t.tapHint}</div>`;
  parent.appendChild(root);

  const status = root.querySelector('.ls__status') as HTMLSpanElement;
  const pct = root.querySelector('.ls__pct') as HTMLSpanElement;
  const trail = root.querySelector('.ls__trail') as HTMLDivElement;
  const printEls = [...root.querySelectorAll<HTMLSpanElement>('.ls__print')];
  const tip = root.querySelector('.ls__tip') as HTMLParagraphElement;
  const tipText = tip.querySelector('span') as HTMLSpanElement;

  // Rotating tips, starting at a random one so repeat visits feel fresh.
  let tipIndex = Math.floor(Math.random() * t.tips.length);
  tipText.textContent = t.tips[tipIndex];
  const tipTimer = window.setInterval(() => {
    tip.classList.add('out');
    window.setTimeout(() => {
      tipIndex = (tipIndex + 1) % t.tips.length;
      tipText.textContent = t.tips[tipIndex];
      tip.classList.remove('out');
    }, 380);
  }, 5200);

  // Tap to play: set fireflies loose.
  let live = 0;
  const onTap = (e: PointerEvent) => {
    root.classList.add('tapped');
    for (let i = 0; i < 4 && live < 40; i++) {
      const s = document.createElement('span');
      s.className = 'ls__spark';
      s.style.left = `${e.clientX}px`;
      s.style.top = `${e.clientY}px`;
      s.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 160)}px`);
      s.style.setProperty('--dy', `${Math.round(-90 - Math.random() * 140)}px`);
      s.style.setProperty('--delay', `${i * 70}ms`);
      live++;
      s.addEventListener('animationend', () => {
        s.remove();
        live--;
      });
      root.appendChild(s);
    }
  };
  root.addEventListener('pointerdown', onTap);

  let shown = 0;
  const set = (fraction: number, text: string) => {
    const f = Math.max(shown, Math.min(1, fraction));
    shown = f;
    const n = Math.round(f * 100);
    root.style.setProperty('--p', f.toFixed(3));
    pct.firstChild!.textContent = String(n);
    trail.setAttribute('aria-valuenow', String(n));
    status.textContent = text;
    const lit = Math.round(f * PRINTS);
    printEls.forEach((p, i) => p.classList.toggle('lit', i < lit));
  };

  return {
    root,
    set,
    fail(message: string) {
      window.clearInterval(tipTimer);
      root.classList.add('ls--error');
      status.textContent = message;
    },
    done() {
      set(1, 'Ready');
      window.clearInterval(tipTimer);
      root.removeEventListener('pointerdown', onTap);
      root.style.pointerEvents = 'none';
      return new Promise((resolve) => {
        window.setTimeout(() => root.classList.add('ls--done'), 280);
        window.setTimeout(() => {
          root.remove();
          resolve();
        }, 1250);
      });
    },
  };
}
