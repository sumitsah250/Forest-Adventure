// Campus Quest interface: HUD (mission, objective, hearts, coins, level, compass, minimap,
// timer, drone alarm, Kalki speedometer), dialogue, the quiz card, the mission banner and
// the mission-complete rewards, and the title / pause / missions / garage / map / ending screens.

import { DATA, WORLD_HALF, centroid } from './geo.ts';
import { shuffled, type Question } from './questions.ts';
import { installButton } from '../pwa.ts';
import { isEnabled } from '../games.ts';
import type { ModalHost } from './minigames.ts';
import { paintPlan } from './paint.ts';
import { scanGround } from './scanGround.ts';
import type { Quality } from '../core/settings.ts';
import { DEMO_MODE, STORY_BLURB, STORY_CHOICES, STORY_PICK, STORY_VERSION, chooseStory } from './story.ts';
import { openRadioLog, runDialogue, type DialogueDeps, type PinOptions, type RadioLogEntry } from './dialogue.ts';

const TEST = new URLSearchParams(location.search).has('test');
const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');

export interface NavTarget {
  x: number;
  z: number;
  label: string;
  /** A drone (the scout drone's markers): drawn red and small. */
  danger?: boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const CONFIRM = ['KeyE', 'Enter', 'Space'];

const THREE_CLAMP = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export interface CompleteInfo {
  title: string;
  number: number;
  stars: number;
  prevStars: number;
  seconds: number;
  par: number;
  heartsLeft: number;
  coins: number;
  xp: number;
  level: { before: number; after: number; frac: number; title: string };
  card: string;
  newUnlock: boolean;
  bestTime: boolean;
  nextLabel: string;
  garage: boolean;
  /** Bonus objectives of the run. */
  bonus: { label: string; done: boolean; fresh: boolean }[];
  /** What comes next, as a hook ("7:20 PM · Backup Power — …"). */
  teaser: string | null;
  /** Seconds before "next" is chosen on its own (0: wait for the player). */
  autoNext: number;
}

export interface ProgressView {
  goals: { text: string; progress: number; target: number; done: boolean }[];
  badges: { icon: string; name: string; how: string; earned: boolean }[];
  stats: { label: string; value: string }[];
}

export interface MissionCard {
  number: number;
  title: string;
  brief: string;
  clock: string;
  stars: number;
  best: number | null;
  state: 'done' | 'next' | 'locked';
}

export interface GarageState {
  coins: number;
  upgrades: { key: 'engine' | 'grip' | 'boost'; name: string; level: number; max: number; cost: number | null; locked: string | null }[];
  paints: { id: string; name: string; body: string; trim: string; owned: boolean; price: number; current: boolean; locked: string | null }[];
}

export class CampusUI implements ModalHost {
  readonly root: HTMLElement;
  private hud: HTMLDivElement;
  private levelEl: HTMLDivElement;
  private clockEl: HTMLSpanElement;
  private objEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private heartsEl: HTMLDivElement;
  private coinsEl: HTMLDivElement;
  private lvlEl: HTMLDivElement;
  private shardsEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private compass: HTMLDivElement;
  private compassW = 420;
  private compassStrip: HTMLDivElement;
  private compassMark: HTMLDivElement;
  private compassDist: HTMLDivElement;
  private timerEl: HTMLDivElement;
  private sunEl: HTMLDivElement;
  private spotEl: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private bannerEl: HTMLDivElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private toastEl: HTMLDivElement;
  private overlay: HTMLDivElement | null = null;
  private mapCanvas: HTMLCanvasElement;
  /** Key handler for the current modal (dialogue, quiz, menus). */
  keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** True while any modal card or menu is open. */
  modal = false;
  onSound: ((name: string, gain?: number) => void) | null = null;
  private shownCoins = -1;
  private callEl: HTMLButtonElement;
  /** The "Call Kalki" HUD button was pressed. */
  onCallKart: (() => void) | null = null;
  private flashEl: HTMLDivElement;
  private hitEl: HTMLDivElement;
  private linesEl: HTMLDivElement;
  private trickEl: HTMLDivElement;
  private parEl: HTMLDivElement;
  private comboEl: HTMLDivElement;
  private shownCombo = 0;
  private bonusEl: HTMLDivElement;
  private badgeEl: HTMLDivElement;
  private badgeQueue: { icon: string; title: string; sub: string }[] = [];
  private badgeBusy = false;
  /** Wallet count-up: the number on screen eases toward the real one. */
  private coinTarget = 0;
  private coinShown = 0;
  private coinRaf = 0;

  constructor(root: HTMLElement, mapCanvas: HTMLCanvasElement) {
    this.root = root;
    this.mapCanvas = mapCanvas;
    this.hud = el('div', 'cq-hud');
    const card = el('div', 'cq-card');
    this.levelEl = el('div', 'cq-level');
    this.clockEl = el('span', 'cq-clock');
    this.objEl = el('div', 'cq-obj');
    this.subEl = el('div', 'cq-sub');
    this.parEl = el('div', 'cq-par');
    this.bonusEl = el('div', 'cq-bonus');
    card.append(this.levelEl, this.objEl, this.subEl, this.parEl, this.bonusEl);
    const stats = el('div', 'cq-stats');
    this.heartsEl = el('div', 'cq-hearts');
    this.coinsEl = el('div', 'cq-coins');
    this.comboEl = el('div', 'cq-combo');
    this.lvlEl = el('div', 'cq-lvl');
    this.shardsEl = el('div', 'cq-shards');
    stats.append(this.heartsEl, this.coinsEl, this.comboEl, this.lvlEl, this.shardsEl);
    this.compass = el('div', 'cq-compass');
    this.compassStrip = el('div', 'cq-compass__strip');
    this.compassMark = el('div', 'cq-compass__mark');
    this.compassDist = el('div', 'cq-compass__dist');
    this.compass.append(this.compassStrip, this.compassMark, this.compassDist);
    this.buildCompass();
    // The compass width, kept current here: reading clientWidth every frame made the browser lay out the
    // page every frame (the HUD changes text each frame, so the layout was always stale).
    new ResizeObserver((e) => (this.compassW = e[0].contentRect.width || this.compassW)).observe(this.compass);
    this.timerEl = el('div', 'cq-timer');
    this.sunEl = el('div', 'cq-sunrise');
    this.sunEl.style.display = 'none';
    this.spotEl = el('div', 'cq-spot', '<b>◉</b><span><i></i></span>');
    this.speedEl = el('div', 'cq-speed', '<div class="cq-speed__n">0</div><div class="cq-speed__u">km/h</div><div class="cq-speed__boost"><i></i></div><div class="cq-speed__hint"></div>');
    this.bannerEl = el('div', 'cq-banner');
    const miniWrap = el('div', 'cq-mini');
    this.mini = el('canvas');
    this.mini.width = this.mini.height = 220;
    this.miniCtx = this.mini.getContext('2d')!;
    miniWrap.append(this.mini, el('div', 'cq-mini__hint', 'M · map'));
    this.promptEl = el('div', 'cq-prompt');
    this.toastEl = el('div', 'cq-toast');
    this.hud.append(card, stats, this.compass, this.sunEl, this.timerEl, this.spotEl, this.speedEl, miniWrap, this.promptEl, this.toastEl, el('div', 'cq-dot'));
    this.callEl = el('button', 'cq-callkart', '🏎 Call Kalki <kbd>K</kbd>');
    this.callEl.onclick = () => this.onCallKart?.();
    this.callEl.style.display = 'none';
    this.hud.append(this.callEl);
    this.flashEl = el('div', 'cq-flash');
    this.hitEl = el('div', 'cq-hit');
    this.linesEl = el('div', 'cq-speedlines');
    this.trickEl = el('div', 'cq-trick');
    this.badgeEl = el('div', 'cq-badgepop');
    (this.speedEl.querySelector('.cq-speed__boost') as HTMLElement).after(el('div', 'cq-speed__drift', '<i></i>'));
    root.append(el('div', 'cq-vignette'), this.linesEl, this.flashEl, this.hitEl, this.hud, this.trickEl, this.bannerEl, this.badgeEl);
    this.setBonus(null);
    this.hud.style.display = 'none';
    this.setTimer(null);
    this.setSpotted(0);
    this.setSpeed(null);
    this.setPar(null);
    window.addEventListener('keydown', (e) => {
      if (this.keyHandler) this.keyHandler(e);
    });
  }

  showHud(on: boolean): void {
    this.hud.style.display = on ? '' : 'none';
    if (!on) this.bannerEl.className = 'cq-banner';
  }

  setMission(text: string, clockText: string): void {
    this.levelEl.textContent = text;
    this.clockEl.textContent = clockText;
    if (clockText) this.levelEl.append(this.clockEl);
  }

  setObjective(text: string, sub = ''): void {
    if (this.objEl.textContent !== text) {
      this.objEl.textContent = text;
      this.objEl.classList.remove('flash');
      void this.objEl.offsetWidth;
      this.objEl.classList.add('flash');
    }
    this.subEl.textContent = sub;
  }

  setHearts(n: number, max: number): void {
    this.heartsEl.innerHTML = Array.from({ length: max }, (_, i) => `<span class="${i < n ? 'on' : ''}">♥</span>`).join('');
  }

  setCoins(n: number): void {
    if (n === this.shownCoins) return;
    const first = this.shownCoins < 0;
    const up = !first && n > this.shownCoins;
    this.shownCoins = n;
    this.coinTarget = n;
    if (first || !up) {
      // Spending (or the first number): no count-up.
      this.coinShown = n;
      this.coinsEl.innerHTML = `<b>◈</b> <span>${n.toLocaleString()}</span>`;
      return;
    }
    if (!this.coinRaf) {
      const num = () => this.coinsEl.querySelector('span') as HTMLSpanElement;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        // Ease toward the target, always at least a few coins per frame.
        const gap = this.coinTarget - this.coinShown;
        this.coinShown = gap <= 0 ? this.coinTarget : Math.min(this.coinTarget, this.coinShown + Math.max(1, Math.ceil(gap * Math.min(1, dt * 9))));
        num().textContent = Math.round(this.coinShown).toLocaleString();
        if (this.coinShown < this.coinTarget) this.coinRaf = requestAnimationFrame(tick);
        else this.coinRaf = 0;
      };
      this.coinRaf = requestAnimationFrame(tick);
    }
    this.coinsEl.classList.remove('pop');
    void this.coinsEl.offsetWidth;
    this.coinsEl.classList.add('pop');
  }

  /**
   * Coins fly from a point on screen (where they were earned) into the wallet. Transform
   * and opacity only, through the Web Animations API, so it runs on the compositor.
   */
  coinFly(x: number, y: number, coins: number): void {
    if (this.hud.style.display === 'none' || REDUCED.matches) return;
    const n = Math.max(1, Math.min(7, Math.round(coins / 8) + 1));
    const r = this.coinsEl.getBoundingClientRect();
    const tx = r.left + 18;
    const ty = r.top + r.height / 2;
    for (let i = 0; i < n; i += 1) {
      const c = el('i', 'cq-flycoin', '◈');
      c.style.left = `${x}px`;
      c.style.top = `${y}px`;
      this.root.append(c);
      const sx = (Math.random() - 0.5) * 90;
      const sy = -30 - Math.random() * 60;
      const a = c.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
          { transform: `translate(calc(-50% + ${sx}px), calc(-50% + ${sy}px)) scale(1.15)`, opacity: 1, offset: 0.3 },
          { transform: `translate(calc(-50% + ${tx - x}px), calc(-50% + ${ty - y}px)) scale(0.6)`, opacity: 0.9 },
        ],
        { duration: 650 + i * 60, delay: i * 45, easing: 'cubic-bezier(0.45, 0, 0.7, 1)', fill: 'backwards' },
      );
      a.onfinish = () => c.remove();
    }
  }

  /** This mission's bonus objectives under the par clock (null hides them). */
  setBonus(list: { label: string; state: 'open' | 'done' | 'failed' }[] | null): void {
    if (!list || !list.length) {
      this.bonusEl.style.display = 'none';
      return;
    }
    this.bonusEl.style.display = '';
    const html = list.map((b) => `<span class="${b.state}">${b.state === 'done' ? '✓' : b.state === 'failed' ? '✗' : '◇'} ${esc(b.label)}</span>`).join('');
    if (this.bonusEl.innerHTML !== html) this.bonusEl.innerHTML = html;
  }

  /** A badge or goal slides in at the top (queued, never blocks play). */
  achievement(icon: string, title: string, sub: string): void {
    this.badgeQueue.push({ icon, title, sub });
    if (!this.badgeBusy) this.nextBadge();
  }

  private nextBadge(): void {
    const b = this.badgeQueue.shift();
    if (!b) {
      this.badgeBusy = false;
      return;
    }
    this.badgeBusy = true;
    this.badgeEl.innerHTML = `<b>${esc(b.icon)}</b><div><small>${esc(b.title)}</small>${esc(b.sub)}</div>`;
    this.badgeEl.classList.remove('show');
    // Over a full-screen card (mission complete, a message) the top centre is its title: use the corner.
    this.badgeEl.classList.toggle('side', !!this.overlay);
    void this.badgeEl.offsetWidth;
    this.badgeEl.classList.add('show');
    this.onSound?.('badge');
    window.setTimeout(() => {
      this.badgeEl.classList.remove('show');
      window.setTimeout(() => this.nextBadge(), 350);
    }, 3200);
  }

  setXp(level: number, frac: number): void {
    this.lvlEl.innerHTML = `Lv ${level}<span><i style="width:${Math.round(frac * 100)}%"></i></span>`;
  }

  /**
   * The three-star clock: time left to beat the mission's par, the hearts star, and the
   * live split against the player's best run. null hides it (free roam).
   */
  setPar(p: { left: number; hearts: boolean; vsBest: number | null } | null): void {
    if (!p) {
      this.parEl.style.display = 'none';
      return;
    }
    this.parEl.style.display = '';
    const time = p.left > 0 ? `<b class="ok">★ ${clock(Math.ceil(p.left))}</b>` : '<b>★ par missed</b>';
    const hearts = `<b class="${p.hearts ? 'ok' : ''}">★ no hits</b>`;
    const split = p.vsBest === null ? '' : `<span class="${p.vsBest <= 0 ? 'ahead' : 'behind'}">${p.vsBest <= 0 ? '−' : '+'}${Math.abs(p.vsBest).toFixed(0)} s vs best</span>`;
    const html = `${time}${hearts}${split}`;
    if (this.parEl.innerHTML !== html) this.parEl.innerHTML = html;
    this.parEl.classList.toggle('urgent', p.left > 0 && p.left < 20);
  }

  /** Combo chain (pick-ups, rings, answers in a row); 0 or 1 hides it. */
  setCombo(n: number): void {
    if (n === this.shownCombo) return;
    this.shownCombo = n;
    this.comboEl.style.display = n > 1 ? '' : 'none';
    this.comboEl.textContent = `COMBO ×${n}`;
    this.comboEl.classList.remove('pop');
    void this.comboEl.offsetWidth;
    if (n > 1) this.comboEl.classList.add('pop');
  }

  setShards(text: string | null): void {
    this.shardsEl.textContent = text ? `◆ ${text}` : '';
  }

  /** Countdown (or count-up for the time trial); null hides it. */
  setTimer(seconds: number | null, up = false): void {
    if (seconds === null) {
      this.timerEl.style.display = 'none';
      return;
    }
    this.timerEl.style.display = '';
    const s = Math.max(0, seconds);
    this.timerEl.textContent = up ? s.toFixed(1) : clock(Math.ceil(s));
    this.timerEl.className = `cq-timer ${up ? 'up' : s < 10 ? 'low' : ''}`;
  }

  setSpotted(f: number): void {
    this.spotEl.style.display = f > 0.01 ? '' : 'none';
    (this.spotEl.querySelector('i') as HTMLElement).style.width = `${Math.round(f * 100)}%`;
    this.spotEl.classList.toggle('hot', f > 0.6);
  }

  /** Shows the "Call Kalki" button (on foot, Kalki unlocked and far away). */
  setCallKart(show: boolean): void {
    const v = show ? '' : 'none';
    if (this.callEl.style.display !== v) this.callEl.style.display = v;
  }

  /** Lightning: a screen flash (0..1). */
  setFlash(f: number): void {
    this.flashEl.style.opacity = String(Math.min(0.75, f * 0.75));
  }

  /** A red pulse at the screen edges (hit, spotted). */
  hit(): void {
    this.hitEl.classList.add('on');
    window.setTimeout(() => this.hitEl.classList.remove('on'), 60);
  }

  /** Radial speed lines (boost, mini-turbo), 0..1. */
  setSpeedLines(f: number): void {
    this.linesEl.style.opacity = String(f);
  }

  /** A big stunt callout ("AIR 1.2 s", "MINI-TURBO"). */
  trick(text: string, sub = ''): void {
    this.trickEl.innerHTML = `${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}`;
    this.trickEl.classList.remove('show');
    void this.trickEl.offsetWidth;
    this.trickEl.classList.add('show');
  }

  /** Kalki speedometer (null hides it). */
  setSpeed(s: { kmh: number; boost: number; boostOn: boolean; boosting: boolean; hint: string; drift?: number; driftLevel?: number } | null): void {
    if (!s) {
      this.speedEl.style.display = 'none';
      return;
    }
    const dr = this.speedEl.querySelector('.cq-speed__drift') as HTMLElement;
    const lvl = s.driftLevel ?? 0;
    dr.className = `cq-speed__drift ${s.drift ? 'on' : ''} ${lvl >= 3 ? 'l3' : lvl >= 2 ? 'l2' : ''}`;
    (dr.firstChild as HTMLElement).style.width = `${Math.round(Math.min(1, (s.drift ?? 0) / 2.3) * 100)}%`;
    this.speedEl.style.display = '';
    (this.speedEl.querySelector('.cq-speed__n') as HTMLElement).textContent = String(Math.round(s.kmh));
    const b = this.speedEl.querySelector('.cq-speed__boost') as HTMLElement;
    b.style.display = s.boostOn ? '' : 'none';
    (b.firstChild as HTMLElement).style.width = `${Math.round(s.boost * 100)}%`;
    b.classList.toggle('on', s.boosting);
    const h = this.speedEl.querySelector('.cq-speed__hint') as HTMLElement;
    if (h.innerHTML !== s.hint) h.innerHTML = s.hint;
  }

  setPrompt(text: string | null): void {
    this.promptEl.style.opacity = text ? '1' : '0';
    if (text) this.promptEl.innerHTML = `<kbd>E</kbd> ${esc(text)}`;
  }

  toast(text: string, kind: 'good' | 'bad' | '' = ''): void {
    this.toastEl.textContent = text;
    this.toastEl.className = `cq-toast show ${kind}`;
    clearTimeout((this.toastEl as unknown as { _t: number })._t);
    (this.toastEl as unknown as { _t: number })._t = window.setTimeout(() => (this.toastEl.className = 'cq-toast'), 2600);
  }

  /** Big two-line banner (mission start, trial results); fades on its own. */
  banner(title: string, sub: string): void {
    this.bannerEl.innerHTML = `<div class="cq-banner__t">${esc(title)}</div><div class="cq-banner__s">${esc(sub)}</div>`;
    this.bannerEl.className = 'cq-banner';
    void this.bannerEl.offsetWidth;
    this.bannerEl.className = 'cq-banner show';
    clearTimeout((this.bannerEl as unknown as { _t: number })._t);
    (this.bannerEl as unknown as { _t: number })._t = window.setTimeout(() => (this.bannerEl.className = 'cq-banner'), 4200);
  }

  // ------------------------------------------------------------ navigation

  private buildCompass(): void {
    // Three copies of 360° so the strip can scroll seamlessly.
    const marks: string[] = [];
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let k = -1; k <= 1; k += 1) {
      for (let d = 0; d < 360; d += 15) {
        const label = names[d];
        marks.push(`<span style="left:${(d + k * 360) * 4}px" class="${label ? (label.length === 1 ? 'major' : 'minor') : 'tick'}">${label ?? '·'}</span>`);
      }
    }
    this.compassStrip.innerHTML = marks.join('');
  }

  /** Heading and target bearings in degrees clockwise from north. */
  updateNav(px: number, pz: number, heading: number, target: NavTarget | null, extra: NavTarget[] = [], shards: { x: number; z: number }[] = [], kart: { x: number; z: number } | null = null): void {
    const w = this.compassW;
    this.compassStrip.style.transform = `translateX(${w / 2 - heading * 4}px)`;
    if (target) {
      const dx = target.x - px;
      const dz = target.z - pz;
      const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      let rel = bearing - heading;
      rel = ((rel + 540) % 360) - 180;
      const x = Math.max(-w / 2 + 14, Math.min(w / 2 - 14, rel * 4));
      this.compassMark.style.transform = `translateX(${x}px)`;
      this.compassMark.style.opacity = '1';
      this.compassMark.classList.toggle('edge', Math.abs(rel * 4) > w / 2 - 14);
      const d = Math.hypot(dx, dz);
      this.compassDist.textContent = `${target.label} · ${d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}`;
    } else {
      this.compassMark.style.opacity = '0';
      this.compassDist.textContent = '';
    }
    // The minimap is a CPU canvas: redrawn every other frame (30 a second) it still turns smoothly.
    if ((this.miniFrame = (this.miniFrame + 1) & 1) === 0) this.drawMini(px, pz, heading, target, extra, shards, kart);
  }

  private miniFrame = 0;

  private miniChecks = 0;

  private drawMini(px: number, pz: number, heading: number, target: NavTarget | null, extra: NavTarget[], shards: { x: number; z: number }[], kart: { x: number; z: number } | null): void {
    // Every couple of seconds: the plan is painted opaque edge to edge, so a see-through pixel means the
    // browser threw it away (a GPU reset); paint it again rather than show a blank minimap all game.
    if ((this.miniChecks = (this.miniChecks + 1) % 120) === 0) {
      const m = this.mapCanvas;
      const mctx = m.getContext('2d');
      if (mctx && mctx.getImageData(m.width >> 1, m.height >> 1, 1, 1).data[3] === 0) {
        mctx.drawImage(paintPlan(m.width, 'map', scanGround()), 0, 0);
        this.hiMap = null;
      }
    }
    const c = this.miniCtx;
    const S = this.mini.width;
    const range = 120; // metres from centre to edge
    const k = this.mapCanvas.width / (WORLD_HALF * 2);
    c.save();
    c.clearRect(0, 0, S, S);
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#d9d4c4';
    c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate((-heading * Math.PI) / 180);
    const scale = S / 2 / range;
    c.scale(scale / k, scale / k);
    c.drawImage(this.mapCanvas, -(px + WORLD_HALF) * k, -(pz + WORLD_HALF) * k);
    c.restore();
    // Markers in screen space (heading-up).
    const toScreen = (x: number, z: number) => {
      const dx = (x - px) * scale;
      const dz = (z - pz) * scale;
      const a = (-heading * Math.PI) / 180;
      return [S / 2 + dx * Math.cos(a) - dz * Math.sin(a), S / 2 + dx * Math.sin(a) + dz * Math.cos(a)] as const;
    };
    const marker = (t: { x: number; z: number }, colour: string, r: number, clamp = true) => {
      let [x, y] = toScreen(t.x, t.z);
      const dx = x - S / 2;
      const dy = y - S / 2;
      const d = Math.hypot(dx, dy);
      const lim = S / 2 - 12;
      if (d > lim) {
        if (!clamp) return;
        x = S / 2 + (dx / d) * lim;
        y = S / 2 + (dy / d) * lim;
      }
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fillStyle = colour;
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = '#1b1d18';
      c.stroke();
    };
    for (const s of shards) marker(s, '#38e1ff', 4, false);
    if (kart) marker(kart, '#c8202e', 5);
    for (const e of extra) marker(e, e.danger ? '#ff3b3b' : '#e9a23b', e.danger ? 4 : 5);
    if (target) marker(target, '#f2c84b', 7);
    // Player arrow (always up).
    c.save();
    c.translate(S / 2, S / 2);
    c.beginPath();
    c.moveTo(0, -10);
    c.lineTo(7, 8);
    c.lineTo(0, 4);
    c.lineTo(-7, 8);
    c.closePath();
    c.fillStyle = '#d94a3a';
    c.fill();
    c.strokeStyle = '#fff';
    c.lineWidth = 2;
    c.stroke();
    c.restore();
    // North marker near the rim.
    const north = toScreen(px, pz - range * 0.92);
    c.font = '700 14px "Segoe UI", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#1b1d18';
    c.beginPath();
    c.arc(north[0], north[1], 10, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff';
    c.fillText('N', north[0], north[1] + 1);
    c.beginPath();
    c.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2);
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(20,22,18,0.8)';
    c.stroke();
  }

  // ------------------------------------------------------------ modals

  open(cls: string): HTMLDivElement {
    this.close();
    this.overlay = el('div', `cq-overlay ${cls}`);
    this.root.append(this.overlay);
    this.modal = true;
    return this.overlay;
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.keyHandler = null;
    this.onAbort = null;
    this.modal = false;
  }

  /**
   * A conversation, a radio call or a document, one subtitle card at a time (dialogue.ts).
   * `who` is the speaker's cast id: it picks the portrait and MITRA's style.
   */
  dialog(speaker: string, role: string, lines: string[], who?: string): Promise<void> {
    return runDialogue(this, this.dialogue, { id: who, name: speaker, role }, lines);
  }

  /** What the dialogue cards need from the game; main.ts fills in portraits, names and the radio log. */
  dialogue: DialogueDeps = {
    sound: (n, g) => this.onSound?.(n, g),
    portrait: () => null,
    fill: (t) => t,
    mitraWarm: () => false,
    log: () => undefined,
  };

  /** Every radio line so far, to read again. */
  radioLog(entries: RadioLogEntry[], onClose: () => void, pin?: PinOptions): void {
    openRadioLog(this, entries, onClose, pin);
  }

  /** The sunrise clock under the compass: story time and minutes to spare (null hides it). */
  setSunrise(text: string | null, low: boolean): void {
    if (text === null) {
      this.sunEl.style.display = 'none';
      return;
    }
    this.sunEl.style.display = '';
    if (this.sunEl.textContent !== text) this.sunEl.textContent = text;
    this.sunEl.classList.toggle('low', low);
  }

  /**
   * Ends whatever modal card is open as a failure (a timed puzzle running out). Each card
   * registers how to do that when it opens.
   */
  abortModal(): void {
    this.onAbort?.();
  }

  onAbort: (() => void) | null = null;

  /**
   * One quiz question with shuffled options. Resolves with whether it was answered
   * correctly, after the player has read the explanation.
   */
  ask(q: Question, o: { header: string; progress: string; hearts: number; maxHearts: number; timer?: number }): Promise<boolean> {
    return new Promise((resolve) => {
      const ov = this.open('cq-overlay--quiz');
      const card = el('div', 'cq-quiz');
      const head = el('div', 'cq-quiz__head', `<span>${esc(o.header)}</span><span class="cq-quiz__progress">${esc(o.progress)}</span>`);
      const hearts = el('div', 'cq-quiz__hearts', Array.from({ length: o.maxHearts }, (_, i) => `<span class="${i < o.hearts ? 'on' : ''}">♥</span>`).join(''));
      const timerBar = el('div', 'cq-quiz__timer', '<span></span>');
      const question = el('div', 'cq-quiz__q');
      question.textContent = q.q;
      const opts = el('div', 'cq-quiz__opts');
      const order = shuffled([0, 1, 2, 3] as const);
      const buttons: HTMLButtonElement[] = [];
      const feedback = el('div', 'cq-quiz__feedback');
      const next = el('button', 'cq-btn cq-btn--primary', 'Next <kbd>E</kbd>');
      next.style.display = 'none';
      let answered = false;
      let result = false;
      let timerId = 0;
      const finish = (picked: number | null) => {
        if (answered) return;
        answered = true;
        clearInterval(timerId);
        result = picked === q.a;
        buttons.forEach((b, i) => {
          b.disabled = true;
          if (order[i] === q.a) b.classList.add('right');
          else if (order[i] === picked) b.classList.add('wrong');
        });
        feedback.innerHTML = `<b>${result ? 'Correct!' : picked === null ? "Time's up!" : 'Not quite.'}</b> ${esc(q.why)}`;
        feedback.className = `cq-quiz__feedback show ${result ? 'good' : 'bad'}`;
        next.style.display = '';
        this.onSound?.(result ? 'clue' : 'knock');
        if (!result) card.classList.add('shake');
      };
      order.forEach((oi, i) => {
        const b = el('button', 'cq-quiz__opt', `<kbd>${i + 1}</kbd><span></span>`);
        (b.querySelector('span') as HTMLSpanElement).textContent = q.options[oi];
        b.onclick = () => finish(oi);
        buttons.push(b);
        opts.append(b);
      });
      const done = () => {
        if (!answered) return;
        this.onSound?.('click');
        this.close();
        resolve(result);
      };
      next.onclick = done;
      // Automated tests read the answer key from the card (test builds only).
      if (TEST) card.dataset.answer = String(order.indexOf(q.a) + 1);
      card.append(head, hearts);
      if (o.timer) card.append(timerBar);
      card.append(question, opts, feedback, next);
      ov.append(card);
      if (o.timer) {
        const start = performance.now();
        const span = timerBar.querySelector('span') as HTMLSpanElement;
        timerId = window.setInterval(() => {
          const f = 1 - (performance.now() - start) / (o.timer! * 1000);
          span.style.width = `${Math.max(0, f) * 100}%`;
          span.classList.toggle('low', f < 0.3);
          if (f <= 0) finish(null);
        }, 100);
      }
      this.keyHandler = (e) => {
        if (e.repeat) return;
        const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4'].indexOf(e.code) % 4;
        if (!answered && n >= 0 && e.code.match(/Digit|Numpad/)) {
          finish(order[n]);
          e.preventDefault();
        } else if (answered && CONFIRM.includes(e.code)) {
          e.preventDefault();
          done();
        }
      };
    });
  }

  /** Big centred message with one button. */
  message(title: string, body: string, button: string, kind: 'good' | 'bad' = 'good'): Promise<void> {
    return new Promise((resolve) => {
      const o = this.open('cq-overlay--message');
      const box = el('div', `cq-message ${kind}`, `<h2>${esc(title)}</h2><p>${esc(body)}</p>`);
      const b = el('button', 'cq-btn cq-btn--primary', `${esc(button)} <kbd>E</kbd>`);
      box.append(b);
      o.append(box);
      const go = () => {
        this.close();
        resolve();
      };
      b.onclick = go;
      this.keyHandler = (e) => {
        if (CONFIRM.includes(e.code)) {
          e.preventDefault();
          go();
        }
      };
    });
  }

  // ------------------------------------------------------------ mission complete

  /** Stars, time, coins and XP counting up, the unlock card. Resolves with the button chosen. */
  missionComplete(r: CompleteInfo): Promise<'next' | 'garage'> {
    return new Promise((resolve) => {
      const ov = this.open('cq-overlay--ending');
      const box = el('div', 'cq-title cq-complete');
      const starHtml = [0, 1, 2].map((i) => `<i class="${i < r.stars ? 'on' : ''} ${i >= r.prevStars && i < r.stars ? 'new' : ''}" style="animation-delay:${0.35 + i * 0.28}s">★</i>`).join('');
      box.innerHTML = `
        <div class="cq-title__studio">Mission ${r.number} complete</div>
        <div class="cq-title__name cq-complete__name">${esc(r.title)}</div>
        <div class="cq-stars">${starHtml}</div>
        <div class="cq-complete__why">
          <span class="${r.heartsLeft === 3 ? 'ok' : ''}">★ Finished</span>
          <span class="${r.heartsLeft === 3 ? 'ok' : ''}">★ No hearts lost</span>
          <span class="${r.seconds <= r.par ? 'ok' : ''}">★ Under ${clock(r.par)}</span>
        </div>
        <div class="cq-ending__grid">
          <div><span>${clock(r.seconds)}</span>time${r.bestTime ? ' · <b>best!</b>' : ''}</div>
          <div><span class="cq-count" data-to="${r.coins}">0</span>◈ coins</div>
          <div><span class="cq-count" data-to="${r.xp}">0</span>XP</div>
        </div>
        <div class="cq-xpbar"><div class="cq-xpbar__l">Lv ${r.level.after} · ${esc(r.level.title)}</div><div class="cq-xpbar__t"><i style="width:${Math.round(r.level.frac * 100)}%"></i></div></div>
        ${r.level.after > r.level.before ? `<div class="cq-levelup">LEVEL UP! Lv ${r.level.after}</div>` : ''}
        ${r.bonus.length ? `<div class="cq-complete__bonus">${r.bonus.map((b) => `<span class="${b.done ? 'ok' : ''}">${b.done ? '✓' : '✗'} ${esc(b.label)}${b.done ? ` <b>+${b.fresh ? 40 : 10}◈</b>` : ''}</span>`).join('')}</div>` : ''}
        <div class="cq-unlock ${r.newUnlock ? 'new' : ''}">${r.newUnlock ? '<b>UNLOCKED</b> ' : ''}${esc(r.card)}</div>
        ${r.teaser ? `<div class="cq-teaser"><small>Up next</small>${esc(r.teaser)}</div>` : ''}`;
      const menu = el('div', 'cq-menu');
      const next = el('button', 'cq-btn cq-btn--primary cq-btn--auto', `${esc(r.nextLabel)} <kbd>E</kbd>`);
      next.onclick = () => go('next');
      menu.append(next);
      // Auto-continue: a ring fills on the button; any other input stops it.
      let auto = 0;
      if (r.autoNext > 0) {
        next.style.setProperty('--auto', `${r.autoNext}s`);
        next.classList.add('counting');
        auto = window.setTimeout(() => {
          if (this.overlay === ov) go('next');
        }, r.autoNext * 1000);
        const stop = () => {
          clearTimeout(auto);
          next.classList.remove('counting');
        };
        ov.addEventListener('pointerdown', (e) => {
          if (!(e.target as HTMLElement).closest('.cq-btn--auto')) stop();
        });
        (ov as unknown as { _stop: () => void })._stop = stop;
      }
      if (r.garage) {
        const g = el('button', 'cq-btn', 'Garage — upgrade Kalki <kbd>G</kbd>');
        g.onclick = () => go('garage');
        menu.append(g);
      }
      box.append(menu);
      ov.append(box, confetti(r.stars >= 3 ? 110 : 50));
      // Count the rewards up.
      const counters = [...box.querySelectorAll<HTMLElement>('.cq-count')];
      const start = performance.now();
      const step = () => {
        const f = Math.min(1, (performance.now() - start) / 1100);
        const e = 1 - (1 - f) ** 3;
        for (const c of counters) c.textContent = Math.round(Number(c.dataset.to) * e).toLocaleString();
        if (f < 1 && this.overlay === ov) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      for (let i = 0; i < r.stars; i += 1) window.setTimeout(() => this.onSound?.('pickup'), 350 + i * 280);
      let gone = false;
      const go = (v: 'next' | 'garage') => {
        if (gone) return;
        gone = true;
        clearTimeout(auto);
        this.onSound?.('click');
        this.close();
        resolve(v);
      };
      this.keyHandler = (e) => {
        if (e.repeat) return;
        if (CONFIRM.includes(e.code)) {
          e.preventDefault();
          go('next');
        } else if (e.code === 'KeyG' && r.garage) go('garage');
        else (ov as unknown as { _stop?: () => void })._stop?.();
      };
    });
  }

  // ------------------------------------------------------------ screens

  title(o: {
    continueLabel: string | null;
    onContinue: () => void;
    onNew: () => void;
    onMissions: () => void;
    onGarage: (() => void) | null;
    onProgress: () => void;
    profileLine: string;
    daily: string | null;
    goals: { text: string; progress: number; target: number; done: boolean }[];
    badges: string;
    /** Story 2: who is playing, and a way to change it. */
    player?: { line: string; onEdit: () => void } | null;
    /** Extra menu entries (label, small text, action), shown after the main ones. */
    extra?: { label: string; small: string; run: () => void }[];
    graphics?: GraphicsPick;
  }): void {
    const ov = this.open('cq-overlay--title');
    const box = el('div', 'cq-title');
    box.innerHTML = `
      <div class="cq-title__studio">Sumix Developers presents</div>
      <div class="cq-title__name">CAMPUS QUEST</div>
      <div class="cq-title__sub">${esc((STORY_CHOICES.find((c) => c.v === STORY_VERSION)?.name ?? '').toUpperCase())}</div>
      <div class="cq-title__place">IOE Pashchimanchal Campus · Lamachaur, Pokhara</div>
      <p class="cq-title__blurb">${STORY_BLURB}</p>
      ${o.profileLine ? `<div class="cq-title__profile">${o.profileLine}</div>` : ''}
      ${o.daily ? `<div class="cq-daily">${o.daily}</div>` : ''}
      ${o.goals.length ? `<div class="cq-goals cq-goals--mini"><b>Today</b>${o.goals.map((g) => `<span class="${g.done ? 'done' : ''}">${g.done ? '✓' : `${g.progress}/${g.target}`} ${esc(g.text)}</span>`).join('')}</div>` : ''}`;
    // Story picker: both stories are playable; picking the other one reloads into it.
    if (!DEMO_MODE) {
      const pick = el('div', 'cq-story-pick');
      pick.setAttribute('role', 'radiogroup');
      pick.setAttribute('aria-label', STORY_PICK);
      pick.append(el('div', 'cq-story-pick__label', esc(STORY_PICK)));
      const row = el('div', 'cq-story-pick__row');
      for (const c of STORY_CHOICES) {
        const on = c.v === STORY_VERSION;
        const b = el('button', `cq-story-pick__opt${on ? ' on' : ''}`, `<b>${esc(c.name)}</b><small>${esc(c.tag)}</small>`);
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(on));
        if (!on) b.onclick = () => chooseStory(c.v);
        row.append(b);
      }
      pick.append(row);
      box.append(pick);
    }
    if (o.graphics) box.append(graphicsPicker(o.graphics));
    const menu = el('div', 'cq-menu');
    if (o.continueLabel) {
      const c = el('button', 'cq-btn cq-btn--primary', `Continue <small>${esc(o.continueLabel)}</small>`);
      c.onclick = o.onContinue;
      menu.append(c);
    }
    const s = el('button', `cq-btn ${o.continueLabel ? '' : 'cq-btn--primary'}`, o.continueLabel ? 'Restart story' : 'Start the story');
    s.onclick = o.onNew;
    menu.append(s);
    const m = el('button', 'cq-btn', 'Missions <small>replay for ★★★</small>');
    m.onclick = o.onMissions;
    menu.append(m);
    if (o.onGarage) {
      const g = el('button', 'cq-btn', 'Garage <small>Kalki</small>');
      g.onclick = o.onGarage;
      menu.append(g);
    }
    const pr = el('button', 'cq-btn', `Goals &amp; badges <small>${esc(o.badges)}</small>`);
    pr.onclick = o.onProgress;
    menu.append(pr);
    for (const x of o.extra ?? []) {
      const b = el('button', 'cq-btn', `${esc(x.label)} <small>${esc(x.small)}</small>`);
      b.onclick = x.run;
      menu.append(b);
    }
    if (o.player) {
      const p = el('button', 'cq-btn cq-btn--player');
      p.textContent = o.player.line;
      p.onclick = o.player.onEdit;
      menu.prepend(p);
    }
    const controls = el('button', 'cq-btn', 'Controls');
    controls.onclick = () => box.querySelector('.cq-controls')?.classList.toggle('show');
    menu.append(controls);
    const back = el('a', 'cq-btn', 'Play Poacher Panic (forest)');
    back.href = './forest.html';
    if (isEnabled('forest')) menu.append(back);
    menu.append(installButton('cq-btn'));
    box.append(menu, el('div', 'cq-controls', CONTROLS));
    box.append(el('div', 'cq-title__credit', 'Campus map © OpenStreetMap contributors (ODbL) · Footprints © Microsoft (ODbL) · Elevation: SRTM · The story is fictional; campus officials appear by name as a tribute, in friendly roles only, and the campus has not endorsed this fan game'));
    ov.append(box);
  }

  pause(o: { onResume: () => void; onMap: () => void; onRestart: (() => void) | null; onMissions: () => void; onGarage: (() => void) | null; onProgress: () => void; onRadioLog: () => void; onBoard?: (() => void) | null; boardLabel?: string; onMinis?: (() => void) | null; minisLabel?: string; onTitle: () => void; graphics?: GraphicsPick }): void {
    const ov = this.open('cq-overlay--pause');
    const box = el('div', 'cq-title cq-title--small', '<div class="cq-title__name">PAUSED</div>');
    const menu = el('div', 'cq-menu');
    const items: [string, (() => void) | null, string][] = [
      ['Resume', o.onResume, 'cq-btn--primary'],
      ['Campus map', o.onMap, ''],
      ['Garage', o.onGarage, ''],
      ['Missions', o.onMissions, ''],
      [o.boardLabel ?? '', o.onBoard ?? null, ''],
      [o.minisLabel ?? '', o.onMinis ?? null, ''],
      ['Goals & badges', o.onProgress, ''],
      ['Radio log', o.onRadioLog, ''],
      ['Restart this mission', o.onRestart, ''],
      ['Quit to title', o.onTitle, ''],
    ];
    for (const [label, fn, cls] of items) {
      if (!fn) continue;
      const b = el('button', `cq-btn ${cls}`, label);
      b.onclick = fn;
      menu.append(b);
    }
    box.append(menu);
    if (o.graphics) box.append(graphicsPicker(o.graphics));
    box.append(el('div', 'cq-controls show', CONTROLS));
    ov.append(box);
    this.keyHandler = (e) => {
      if (e.code === 'KeyM') o.onMap();
    };
  }

  /** All missions with stars and best times; done ones replay, the next one plays. */
  missions(list: MissionCard[], o: { onPick: (i: number) => void; onClose: () => void; totalStars: string }): void {
    const ov = this.open('cq-overlay--pause');
    const box = el('div', 'cq-panel');
    box.append(el('div', 'cq-panel__head', `<h2>Missions</h2><span>★ ${esc(o.totalStars)}</span>`));
    const grid = el('div', 'cq-missions');
    list.forEach((m, i) => {
      const b = el('button', `cq-mcard ${m.state}`);
      b.innerHTML = `
        <div class="cq-mcard__n">${m.number}</div>
        <div class="cq-mcard__t">${esc(m.title)}<small>${esc(m.clock)}</small></div>
        <div class="cq-mcard__s">${m.state === 'locked' ? '🔒' : [0, 1, 2].map((k) => `<i class="${k < m.stars ? 'on' : ''}">★</i>`).join('')}</div>
        <div class="cq-mcard__b">${m.state === 'locked' ? 'Finish the mission before to unlock' : esc(m.brief)}${m.best !== null ? ` · best ${clock(m.best)}` : ''}</div>`;
      b.disabled = m.state === 'locked';
      b.onclick = () => o.onPick(i);
      grid.append(b);
    });
    const close = el('button', 'cq-btn', 'Back <kbd>Esc</kbd>');
    close.onclick = o.onClose;
    box.append(grid, close);
    ov.append(box);
    this.keyHandler = (e) => {
      if (e.code === 'Escape' || e.code === 'KeyM') o.onClose();
    };
  }

  /** Today's goals, every badge (earned or not) and lifetime stats. */
  progress(v: ProgressView, onClose: () => void): void {
    const ov = this.open('cq-overlay--pause');
    const box = el('div', 'cq-panel cq-progress');
    const earned = v.badges.filter((b) => b.earned).length;
    box.innerHTML = `
      <div class="cq-panel__head"><h2>Goals &amp; badges</h2><span>${earned} / ${v.badges.length} badges</span></div>
      <h3>Today's goals <small>new ones every day · +75◈ each, +150◈ for all three</small></h3>
      <div class="cq-goals">${v.goals.map((g) => `
        <div class="cq-goal ${g.done ? 'done' : ''}"><span>${g.done ? '✓' : ''}</span><div>${esc(g.text)}<i><b style="width:${Math.round((g.progress / g.target) * 100)}%"></b></i></div><small>${g.progress} / ${g.target}</small></div>`).join('')}
      </div>
      <h3>Badges</h3>
      <div class="cq-badges">${v.badges.map((b) => `
        <div class="cq-badge ${b.earned ? 'on' : ''}" title="${esc(b.how)}"><b>${b.earned ? esc(b.icon) : '🔒'}</b><span>${esc(b.name)}</span><small>${esc(b.how)}</small></div>`).join('')}
      </div>
      <div class="cq-statline">${v.stats.map((s) => `<div><span>${esc(s.value)}</span>${esc(s.label)}</div>`).join('')}</div>`;
    const close = el('button', 'cq-btn cq-btn--primary', 'Back <kbd>Esc</kbd>');
    close.onclick = onClose;
    box.append(close);
    ov.append(box);
    this.keyHandler = (e) => {
      if (e.code === 'Escape') onClose();
    };
  }

  /** Kalki's garage: upgrades and paint jobs, re-rendered after every purchase. */
  garage(o: { state: () => GarageState; onUpgrade: (k: 'engine' | 'grip' | 'boost') => void; onPaint: (id: string) => void; onClose: () => void }): void {
    const ov = this.open('cq-overlay--pause');
    const box = el('div', 'cq-panel cq-garage');
    const render = () => {
      const s = o.state();
      box.innerHTML = '';
      box.append(el('div', 'cq-panel__head', `<h2>Kalki's Garage</h2><span class="cq-coins big"><b>◈</b> ${s.coins.toLocaleString()}</span>`));
      const ups = el('div', 'cq-upgrades');
      for (const u of s.upgrades) {
        const row = el('div', 'cq-up');
        const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < u.level ? 'on' : ''}"></i>`).join('');
        row.innerHTML = `<div class="cq-up__n">${esc(u.name)}</div><div class="cq-up__p">${pips}</div>`;
        const b = el('button', 'cq-btn', u.locked ? esc(u.locked) : u.cost === null ? 'MAX' : `Upgrade · ${u.cost}◈`);
        b.disabled = !!u.locked || u.cost === null || u.cost > s.coins;
        b.onclick = () => {
          o.onUpgrade(u.key);
          this.onSound?.('pickup');
          render();
        };
        row.append(b);
        ups.append(row);
      }
      box.append(el('h3', '', 'Upgrades'), ups, el('h3', '', 'Paint'));
      const paints = el('div', 'cq-paints');
      for (const p of s.paints) {
        const b = el('button', `cq-paint ${p.current ? 'current' : ''}`, `<i style="background:linear-gradient(135deg, ${p.body} 60%, ${p.trim} 60%)"></i><span>${esc(p.name)}</span><small>${p.current ? 'Fitted' : p.owned ? 'Fit' : p.locked ? esc(p.locked) : `${p.price}◈`}</small>`);
        b.disabled = !p.owned && (!!p.locked || p.price > s.coins);
        b.onclick = () => {
          o.onPaint(p.id);
          this.onSound?.('click');
          render();
        };
        paints.append(b);
      }
      const close = el('button', 'cq-btn cq-btn--primary', 'Done <kbd>Esc</kbd>');
      close.onclick = o.onClose;
      box.append(paints, close);
    };
    render();
    ov.append(box);
    this.keyHandler = (e) => {
      if (e.code === 'Escape' || e.code === 'KeyG') o.onClose();
    };
  }

  /** A sharper copy of the campus plan for zooming in on the big map (painted on first use). */
  private hiMap: HTMLCanvasElement | null = null;
  /** The big map remembers its view between openings. */
  private mapView: { cx: number; cz: number; span: number } | null = null;

  /**
   * Full campus map with labels, the player and the current target. Zoom with the mouse
   * wheel, pinch, the + / − buttons or keys; drag (or arrow keys) to pan; ⌖ centres on you.
   */
  bigMap(px: number, pz: number, target: NavTarget | null, extra: NavTarget[], onClose: () => void, kart: { x: number; z: number } | null = null): void {
    const ov = this.open('cq-overlay--map');
    const wrap = el('div', 'cq-bigmap');
    const stage = el('div', 'cq-bigmap__stage');
    const c = el('canvas');
    const S = 1024;
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    this.hiMap ??= paintPlan(window.matchMedia('(pointer: coarse)').matches ? 2048 : 3072, 'map', scanGround());
    const hi = this.hiMap;
    const src = hi.width / (WORLD_HALF * 2);
    const FULL = 700;
    const MIN = 50;
    const view = (this.mapView ??= { cx: 20, cz: -10, span: FULL });
    const clampView = () => {
      view.span = THREE_CLAMP(view.span, MIN, FULL + 60);
      const lim = WORLD_HALF - view.span / 2;
      view.cx = THREE_CLAMP(view.cx, -lim, lim);
      view.cz = THREE_CLAMP(view.cz, -lim, lim);
    };
    const named = (n: string | undefined) => !!n && !/[^\x20-\x7e]/.test(n);
    const render = () => {
      clampView();
      const { cx, cz, span } = view;
      const k = S / span;
      const P = (x: number, z: number) => [(x - cx + span / 2) * k, (z - cz + span / 2) * k] as const;
      ctx.imageSmoothingEnabled = true;
      ctx.fillStyle = '#c9c3b2';
      ctx.fillRect(0, 0, S, S);
      ctx.drawImage(hi, (cx - span / 2 + WORLD_HALF) * src, (cz - span / 2 + WORLD_HALF) * src, span * src, span * src, 0, 0, S, S);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const zoom = FULL / span;
      // Building names (all of them, a little larger as you zoom in).
      for (const b of DATA.buildings) {
        if (!b.inside || !named(b.name)) continue;
        const [x, y] = P(...centroid(b.pts));
        if (x < -80 || y < -20 || x > S + 80 || y > S + 20) continue;
        const name = b.name!.replace('Department of ', 'Dept. ').replace(' Engineering', ' Engg.').replace('Addministrative', 'Administration');
        ctx.font = `600 ${Math.round(Math.min(20, 13 + zoom * 0.9))}px "Segoe UI", sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeText(name, x, y);
        ctx.fillStyle = '#3b2f1c';
        ctx.fillText(name, x, y);
      }
      for (const a of DATA.areas) {
        if (!named(a.name) || !/Ground|Court|Park|Chautari|Parapet/.test(a.name!)) continue;
        if (zoom < 1.6 && !/Ground|Court/.test(a.name!)) continue;
        const [x, y] = P(...centroid(a.pts));
        ctx.font = `italic ${zoom > 2 ? 14 : 12}px "Segoe UI", sans-serif`;
        ctx.fillStyle = '#2f5a24';
        ctx.fillText(a.name!, x, y);
      }
      // Landmarks once you are zoomed in.
      if (zoom >= 2.2) {
        for (const p of DATA.points) {
          if (!named(p.name)) continue;
          const [x, y] = P(p.x, p.z);
          if (x < 0 || y < 0 || x > S || y > S) continue;
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fillStyle = '#5a4a2a';
          ctx.fill();
          ctx.font = '600 12px "Segoe UI", sans-serif';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.strokeText(p.name!, x, y + 13);
          ctx.fillStyle = '#5a4a2a';
          ctx.fillText(p.name!, x, y + 13);
        }
      }
      const dot = (x: number, z: number, colour: string, r: number, label?: string) => {
        let [sx, sy] = P(x, z);
        // Off-screen markers sit on the edge so you never lose them.
        const off = sx < 14 || sy < 14 || sx > S - 14 || sy > S - 14;
        sx = THREE_CLAMP(sx, 14, S - 14);
        sy = THREE_CLAMP(sy, 14, S - 14);
        ctx.globalAlpha = off ? 0.7 : 1;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#1b1d18';
        ctx.stroke();
        if (label && !off) {
          ctx.font = '700 15px "Segoe UI", sans-serif';
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#1b1d18';
          ctx.strokeText(label, sx, sy - r - 12);
          ctx.fillStyle = '#ffe9a8';
          ctx.fillText(label, sx, sy - r - 12);
        }
        ctx.globalAlpha = 1;
      };
      for (const e of extra) dot(e.x, e.z, '#e9a23b', 8, e.label || undefined);
      if (kart) dot(kart.x, kart.z, '#c8202e', 8, 'Kalki');
      if (target) dot(target.x, target.z, '#f2c84b', 11, target.label);
      dot(px, pz, '#d94a3a', 9, 'You');
      // Scale bar.
      const nice = [10, 20, 50, 100, 200][[10, 20, 50, 100, 200].findIndex((m) => m * k > 70)] ?? 200;
      const bar = nice * k;
      ctx.fillStyle = 'rgba(20,22,18,0.75)';
      ctx.fillRect(16, S - 40, bar + 20, 26);
      ctx.fillStyle = '#fff';
      ctx.fillRect(26, S - 24, bar, 4);
      ctx.font = '700 12px "Segoe UI", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${nice} m`, 28, S - 33);
      zoomLabel.textContent = `${zoom.toFixed(1)}×`;
    };
    /** Zoom by `f` (>1 = in) keeping the map point under (u, v) (0..1 across the canvas) in place. */
    const zoomAt = (f: number, u = 0.5, v = 0.5) => {
      const wx = view.cx + (u - 0.5) * view.span;
      const wz = view.cz + (v - 0.5) * view.span;
      view.span = THREE_CLAMP(view.span / f, MIN, FULL + 60);
      view.cx = wx - (u - 0.5) * view.span;
      view.cz = wz - (v - 0.5) * view.span;
      render();
    };
    const centre = () => {
      view.cx = px;
      view.cz = pz;
      view.span = Math.min(view.span, 220);
      render();
    };
    // Mouse wheel and pinch / drag (pointer events cover mouse and touch).
    const rel = (e: { clientX: number; clientY: number }) => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height] as const;
    };
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [u, v] = rel(e);
      zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, u, v);
    }, { passive: false });
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    c.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const r = c.getBoundingClientRect();
      if (pointers.size === 1) {
        view.cx -= ((e.clientX - prev.x) / r.width) * view.span;
        view.cz -= ((e.clientY - prev.y) / r.height) * view.span;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        render();
      } else if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0 && d > 0) {
          const [u, v] = rel({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
          zoomAt(d / pinch, u, v);
        }
        pinch = d;
      }
    });
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', (e) => {
      const [u, v] = rel(e);
      zoomAt(2, u, v);
    });
    // Zoom controls.
    const tools = el('div', 'cq-maptools');
    const zin = el('button', 'cq-maptool', '+');
    const zout = el('button', 'cq-maptool', '−');
    const me = el('button', 'cq-maptool', '⌖');
    const all = el('button', 'cq-maptool small', 'ALL');
    const zoomLabel = el('div', 'cq-maptool__z');
    zin.title = 'Zoom in (+)';
    zout.title = 'Zoom out (−)';
    me.title = 'Centre on me (C)';
    all.title = 'Whole campus (0)';
    zin.onclick = () => zoomAt(1.5);
    zout.onclick = () => zoomAt(1 / 1.5);
    me.onclick = centre;
    all.onclick = () => {
      Object.assign(view, { cx: 20, cz: -10, span: FULL });
      render();
    };
    tools.append(zin, zoomLabel, zout, me, all);
    stage.append(c, tools);
    wrap.append(stage);
    const close = el('button', 'cq-btn cq-btn--primary', 'Close <kbd>M</kbd>');
    close.onclick = onClose;
    wrap.append(el('div', 'cq-bigmap__legend', 'Scroll / pinch to zoom · drag to move · ⌖ centre on you · gold = objective · red = Kalki · © OpenStreetMap contributors'), close);
    ov.append(wrap);
    render();
    this.keyHandler = (e) => {
      const pan = view.span * 0.12;
      if (['KeyM', 'Escape', 'KeyE'].includes(e.code)) {
        e.preventDefault();
        onClose();
      } else if (['Equal', 'NumpadAdd', 'KeyZ'].includes(e.code)) zoomAt(1.4);
      else if (['Minus', 'NumpadSubtract', 'KeyX'].includes(e.code)) zoomAt(1 / 1.4);
      else if (e.code === 'KeyC') centre();
      else if (e.code === 'Digit0') all.click();
      else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { view.cx -= pan; render(); }
      else if (e.code === 'ArrowRight' || e.code === 'KeyD') { view.cx += pan; render(); }
      else if (e.code === 'ArrowUp' || e.code === 'KeyW') { view.cz -= pan; render(); }
      else if (e.code === 'ArrowDown' || e.code === 'KeyS') { view.cz += pan; render(); }
    };
  }

  /** The end of the story. */
  ending(
    s: { coins: number; stars: string; level: number; title: string; seconds: number; accuracy: number },
    onRoam: () => void, onMissions: () => void, onTitle: () => void,
    /** Story 2: minutes left on the sunrise clock, and the share card. */
    v2?: { minutes: string; minutesLabel: string; shareLabel: string; onShare: () => void },
  ): void {
    const ov = this.open('cq-overlay--ending');
    const box = el('div', 'cq-title cq-ending');
    box.innerHTML = `
      <div class="cq-title__studio">Blackout at WRC · the end</div>
      <div class="cq-title__name">HERO OF WRC</div>
      <div class="cq-title__place">The exam is safe, MITRA is free and the tech fest is on. Level ${s.level} · ${esc(s.title)}</div>
      <div class="cq-ending__grid">
        <div><span>★ ${esc(s.stars)}</span>stars</div>
        <div><span>${s.coins.toLocaleString()}</span>◈ coins</div>
        ${v2 ? `<div><span>${esc(v2.minutes)}</span>${esc(v2.minutesLabel)}</div>` : `<div><span>${s.accuracy}</span>riddles cracked</div>`}
      </div>
      <p class="cq-title__blurb">Every mission can be replayed for three stars. 24 memory shards are hidden around campus, and Kalki's time trial is waiting for a record.</p>`;
    const menu = el('div', 'cq-menu');
    const roam = el('button', 'cq-btn cq-btn--primary', 'Keep exploring');
    roam.onclick = onRoam;
    const m = el('button', 'cq-btn', 'Missions');
    m.onclick = onMissions;
    const t = el('button', 'cq-btn', 'Title screen');
    t.onclick = onTitle;
    if (v2) {
      const share = el('button', 'cq-btn cq-btn--primary', esc(v2.shareLabel));
      share.onclick = v2.onShare;
      menu.append(share);
      roam.classList.remove('cq-btn--primary');
    }
    menu.append(roam, m, t);
    box.append(menu);
    ov.append(box, confetti(120));
  }

  /** Overlay asking for a click to capture the mouse again. */
  clickToPlay(onClick: () => void): void {
    const ov = this.open('cq-overlay--click');
    ov.append(el('div', 'cq-clicktoplay', 'Click to continue'));
    ov.onclick = onClick;
  }
}

const CONTROLS = `
  <table>
    <tr><td><kbd>W A S D</kbd></td><td>Walk / drive (relative to the camera)</td></tr>
    <tr><td><kbd>Mouse</kbd></td><td>Look around</td></tr>
    <tr><td><kbd>Shift</kbd></td><td>Run · Kalki boost</td></tr>
    <tr><td><kbd>Space</kbd></td><td>Jump · Kalki: hold while turning to drift, let go for a mini-turbo</td></tr>
    <tr><td><kbd>E</kbd></td><td>Talk / use / pick up / get in and out of Kalki</td></tr>
    <tr><td><kbd>K</kbd></td><td>Call Kalki to you</td></tr>
    <tr><td><kbd>1</kbd>–<kbd>6</kbd></td><td>Answer / pick in puzzles (or click)</td></tr>
    <tr><td><kbd>M</kbd> · <kbd>G</kbd></td><td>Campus map · Garage</td></tr>
    <tr><td><kbd>Hold R</kbd></td><td>Flip Kalki back onto its wheels</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Pause</td></tr>
  </table>`;

function confetti(n = 90): HTMLDivElement {
  const c = el('div', 'cq-confetti');
  const colours = ['#dc143c', '#003893', '#f2c84b', '#ffffff', '#3fa34d', '#38e1ff'];
  for (let i = 0; i < n; i += 1) {
    const p = el('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colours[i % colours.length];
    p.style.animationDelay = `${Math.random() * 3}s`;
    p.style.animationDuration = `${3 + Math.random() * 3}s`;
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    c.append(p);
  }
  return c;
}

/** The graphics level and what picking another one does (main.ts saves it and reloads). */
export interface GraphicsPick {
  current: Quality;
  onPick: (q: Quality) => void;
}

const GRAPHICS: { q: Quality; name: string; tag: string }[] = [
  { q: 'low', name: 'Low', tag: 'Smoothest' },
  { q: 'medium', name: 'Medium', tag: 'Balanced' },
  { q: 'high', name: 'High', tag: 'Best looking' },
];

/** Low / Medium / High, in the story picker's style. Picking another level reloads the game. */
function graphicsPicker(g: GraphicsPick): HTMLElement {
  const pick = el('div', 'cq-story-pick cq-gfx-pick');
  pick.setAttribute('role', 'radiogroup');
  pick.setAttribute('aria-label', 'Graphics');
  pick.append(el('div', 'cq-story-pick__label', 'Graphics · lower it if the game lags'));
  const row = el('div', 'cq-story-pick__row');
  for (const o of GRAPHICS) {
    const on = o.q === g.current;
    const b = el('button', `cq-story-pick__opt${on ? ' on' : ''}`, `<b>${o.name}</b><small>${o.tag}</small>`);
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(on));
    if (!on) b.onclick = () => g.onPick(o.q);
    row.append(b);
  }
  pick.append(row);
  return pick;
}
