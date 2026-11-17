// Campus Quest loading screen: "restoring power". The campus sits blacked out under
// Machhapuchhre at night; as the game loads, windows across the skyline switch on one by
// one and the power meter fills. When it is ready the whole campus lights up and the
// screen fades into the game.
//
// Everything that moves animates transform or opacity only, so the browser keeps it running
// on the compositor while the main thread is busy building the world. Window switching
// happens only when progress changes (a handful of class toggles).

import './campusLoading.css';
import type { LoadingScreen } from './loadingScreen.ts';

/** Small seeded generator so the skyline is the same on every visit. */
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

/** The Annapurna range with Machhapuchhre's twin "fishtail" summit near the middle. */
const PEAKS =
  'M0 300 L0 196 L60 178 L118 190 L190 146 L236 160 L300 118 L352 140 L410 112 L470 132 L540 96 L600 120 L660 104 L716 66 ' +
  'L742 86 L768 34 L786 22 L800 52 L816 30 L838 74 L872 98 L930 84 L990 118 L1052 92 L1110 116 L1180 80 L1236 106 ' +
  'L1300 94 L1372 128 L1440 104 L1520 136 L1600 122 L1600 300 Z';

const TIPS = [
  'Every mission you finish restores power to more of campus. Watch the windows at night.',
  'Kalki drifts: hold Space while turning, let go for a mini-turbo.',
  'Riddles have no marker. Crack one before the first hint for bonus coins.',
  'Chain pick-ups, rings and right answers into a combo. Listen to the chime climb.',
  'Each mission hides two bonus objectives. Replays count.',
  'Fresh daily goals every day, and the chiya streak pays more each morning.',
  'Race your own ghost in the Kalki Time Trial on the ring road.',
  'A drone filled its alarm and missed you? That is a close call, and it pays.',
  'Press K to call Kalki to you. Press M when every corridor looks the same.',
];

const SEGMENTS = 24;

function stars(r: () => number): string {
  const dots: string[] = [];
  for (let i = 0; i < 110; i++) {
    const a = (0.2 + r() * 0.8).toFixed(2);
    dots.push(`${(r() * 100).toFixed(2)}vw ${(r() * 48).toFixed(2)}vh 0 ${r() > 0.92 ? 1 : 0}px rgba(235,240,255,${a})`);
  }
  return dots.join(',');
}

interface Win {
  el: HTMLElement;
  at: number;
}

export function createCampusLoading(parent: HTMLElement): LoadingScreen {
  const r = rng(2044);
  const root = document.createElement('div');
  root.className = 'lc';

  // Skyline: blocks across the width, tallest near the middle, each with a grid of windows.
  let skyline = '';
  let x = -2;
  let k = 0;
  let mast = false;
  while (x < 100) {
    const w = 6 + r() * 9;
    const mid = 1 - Math.abs(x + w / 2 - 50) / 60;
    const h = 9 + r() * 10 + mid * 12;
    const cols = Math.max(2, Math.round(w / 2.1));
    const rows = Math.max(2, Math.round(h / 4.6));
    let wins = '';
    for (let i = 0; i < cols * rows; i++) wins += `<i class="${r() > 0.7 ? 'c' : ''}"></i>`;
    const tall = !mast && h > 24;
    if (tall) mast = true;
    const sign = k === 3 ? '<b class="lc__sign">WRC</b>' : '';
    skyline += `<div class="lc__b" style="left:${x.toFixed(1)}%;width:${w.toFixed(1)}%;height:${h.toFixed(1)}vh;--z:${(r() * 0.1).toFixed(2)}">${tall ? '<span class="lc__mast"><i></i></span>' : ''}${sign}<div class="lc__w" style="grid-template-columns:repeat(${cols},1fr)">${wins}</div></div>`;
    x += w + 0.4 + r() * 1.6;
    k += 1;
  }
  // Lights of the town beyond the wall (it never lost power).
  let town = '';
  for (let i = 0; i < 46; i++) town += `<i style="left:${(r() * 100).toFixed(1)}%;bottom:${(r() * 5).toFixed(1)}vh;--o:-${(r() * 6).toFixed(1)}s"></i>`;

  const word = (w: string, cls: string, offset: number) =>
    `<span class="lc__word ${cls}">${[...w].map((c, i) => `<span style="--i:${i + offset}">${c}</span>`).join('')}</span>`;

  root.innerHTML = `
    <div class="lc__sky"></div>
    <div class="lc__stars" style="box-shadow:${stars(r)}"></div>
    <div class="lc__moon"></div>
    <svg class="lc__peaks" viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs><linearGradient id="lc-snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d6f0"/><stop offset="0.28" stop-color="#7d8fb6"/><stop offset="0.6" stop-color="#2e3d63"/><stop offset="1" stop-color="#1a2544"/></linearGradient></defs>
      <path d="${PEAKS}" fill="url(#lc-snow)"/>
    </svg>
    <div class="lc__haze"></div>
    <div class="lc__town">${town}</div>
    <div class="lc__skyline">${skyline}</div>
    <div class="lc__ground"></div>
    <div class="lc__center">
      <div class="lc__studio">Sumix Developers presents</div>
      <h1 class="lc__title" aria-label="Campus Quest">${word('CAMPUS', '', 0)}${word('QUEST', 'lc__word--accent', 6)}</h1>
      <div class="lc__neon">Blackout at WRC</div>
      <p class="lc__place">IOE Pashchimanchal Campus · Lamachaur, Pokhara</p>
    </div>
    <div class="lc__foot">
      <div class="lc__meta">
        <span class="lc__bolt" aria-hidden="true">⚡</span>
        <span class="lc__status">Restoring power</span>
        <span class="lc__pct">0<small>%</small></span>
      </div>
      <div class="lc__meter" role="progressbar" aria-label="Loading" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">${'<span></span>'.repeat(SEGMENTS)}</div>
      <p class="lc__tip"><b>Senior's advice</b><span></span></p>
    </div>
    <div class="lc__hint">Tap a building to flip its breaker</div>`;
  parent.appendChild(root);

  const status = root.querySelector('.lc__status') as HTMLSpanElement;
  const pct = root.querySelector('.lc__pct') as HTMLSpanElement;
  const meter = root.querySelector('.lc__meter') as HTMLDivElement;
  const segs = [...meter.children] as HTMLElement[];
  const tip = root.querySelector('.lc__tip') as HTMLParagraphElement;
  const tipText = tip.querySelector('span') as HTMLSpanElement;

  // Windows switch on in a fixed random order as loading progresses (a few stay dark until the end).
  const wins: Win[] = [...root.querySelectorAll<HTMLElement>('.lc__w i')].map((el) => ({ el, at: r() }));
  wins.sort((a, b) => a.at - b.at);
  let lit = 0;

  let tipIndex = Math.floor(Math.random() * TIPS.length);
  tipText.textContent = TIPS[tipIndex];
  const tipTimer = window.setInterval(() => {
    tip.classList.add('out');
    window.setTimeout(() => {
      tipIndex = (tipIndex + 1) % TIPS.length;
      tipText.textContent = TIPS[tipIndex];
      tip.classList.remove('out');
    }, 380);
  }, 5200);

  // Tap toy: flip a building's breaker (all its windows flash on for a moment).
  const onTap = (e: PointerEvent) => {
    root.classList.add('tapped');
    const b = (e.target as HTMLElement).closest('.lc__b');
    if (!b) return;
    b.classList.remove('flip');
    void (b as HTMLElement).offsetWidth;
    b.classList.add('flip');
  };
  root.addEventListener('pointerdown', onTap);

  let shown = 0;
  const set = (fraction: number, text: string) => {
    const f = Math.max(shown, Math.min(1, fraction));
    shown = f;
    const n = Math.round(f * 100);
    pct.firstChild!.textContent = String(n);
    meter.setAttribute('aria-valuenow', String(n));
    status.textContent = text;
    const on = Math.round(f * SEGMENTS);
    segs.forEach((s, i) => {
      s.classList.toggle('on', i < on);
      s.classList.toggle('next', i === on && on < SEGMENTS);
    });
    // 85% of the windows come on while loading; the rest wait for "ready".
    const want = Math.floor(f * 0.85 * wins.length);
    for (; lit < want; lit++) wins[lit].el.classList.add('on');
  };

  return {
    root,
    set,
    fail(message: string) {
      window.clearInterval(tipTimer);
      root.classList.add('lc--error');
      status.textContent = message;
    },
    done() {
      set(1, 'Power restored');
      window.clearInterval(tipTimer);
      root.removeEventListener('pointerdown', onTap);
      root.style.pointerEvents = 'none';
      return new Promise((resolve) => {
        // Every light on at once, a beat to enjoy it, then fade into the game.
        root.classList.add('lc--live');
        window.setTimeout(() => root.classList.add('lc--done'), 650);
        window.setTimeout(() => {
          root.remove();
          resolve();
        }, 1600);
      });
    },
  };
}
