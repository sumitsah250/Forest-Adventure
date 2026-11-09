// Campus Quest interface: HUD (level, objective, lives, score, compass, minimap), dialogue,
// the quiz card, title / pause / map screens and the convocation results.

import { DATA, WORLD_HALF, centroid } from './geo.ts';
import { shuffled, type Question } from './questions.ts';
import { installButton } from '../pwa.ts';
import { isEnabled } from '../games.ts';

const TEST = new URLSearchParams(location.search).has('test');

export interface NavTarget {
  x: number;
  z: number;
  label: string;
}

export interface EndStats {
  score: number;
  correct: number;
  answered: number;
  seconds: number;
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

export class CampusUI {
  readonly root: HTMLElement;
  private hud: HTMLDivElement;
  private levelEl: HTMLDivElement;
  private objEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private heartsEl: HTMLDivElement;
  private scoreEl: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private compass: HTMLDivElement;
  private compassStrip: HTMLDivElement;
  private compassMark: HTMLDivElement;
  private compassDist: HTMLDivElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private toastEl: HTMLDivElement;
  private overlay: HTMLDivElement | null = null;
  private mapCanvas: HTMLCanvasElement;
  /** Key handler for the current modal (dialogue, quiz, menus). */
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  /** True while any modal card or menu is open. */
  modal = false;
  onSound: ((name: string) => void) | null = null;

  constructor(root: HTMLElement, mapCanvas: HTMLCanvasElement) {
    this.root = root;
    this.mapCanvas = mapCanvas;
    this.hud = el('div', 'cq-hud');
    const card = el('div', 'cq-card');
    this.levelEl = el('div', 'cq-level');
    this.objEl = el('div', 'cq-obj');
    this.subEl = el('div', 'cq-sub');
    card.append(this.levelEl, this.objEl, this.subEl);
    const stats = el('div', 'cq-stats');
    this.heartsEl = el('div', 'cq-hearts');
    this.scoreEl = el('div', 'cq-score');
    stats.append(this.heartsEl, this.scoreEl);
    this.compass = el('div', 'cq-compass');
    this.compassStrip = el('div', 'cq-compass__strip');
    this.compassMark = el('div', 'cq-compass__mark');
    this.compassDist = el('div', 'cq-compass__dist');
    this.compass.append(this.compassStrip, this.compassMark, this.compassDist);
    this.buildCompass();
    const miniWrap = el('div', 'cq-mini');
    this.mini = el('canvas');
    this.mini.width = this.mini.height = 220;
    this.miniCtx = this.mini.getContext('2d')!;
    miniWrap.append(this.mini, el('div', 'cq-mini__hint', 'M · map'));
    this.promptEl = el('div', 'cq-prompt');
    this.toastEl = el('div', 'cq-toast');
    this.hud.append(card, stats, this.compass, miniWrap, this.promptEl, this.toastEl, el('div', 'cq-dot'));
    root.append(this.hud);
    this.hud.style.display = 'none';
    window.addEventListener('keydown', (e) => {
      if (this.keyHandler) this.keyHandler(e);
    });
  }

  showHud(on: boolean): void {
    this.hud.style.display = on ? '' : 'none';
  }

  setLevel(n: number, total: number, title: string): void {
    this.levelEl.textContent = `Level ${n} / ${total} · ${title}`;
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

  setScore(n: number): void {
    this.scoreEl.textContent = `${n.toLocaleString()} pts`;
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
  updateNav(px: number, pz: number, heading: number, target: NavTarget | null, extra: NavTarget[] = []): void {
    const w = this.compass.clientWidth || 420;
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
    this.drawMini(px, pz, heading, target, extra);
  }

  private drawMini(px: number, pz: number, heading: number, target: NavTarget | null, extra: NavTarget[]): void {
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
    const marker = (t: NavTarget, colour: string, r: number) => {
      let [x, y] = toScreen(t.x, t.z);
      const dx = x - S / 2;
      const dy = y - S / 2;
      const d = Math.hypot(dx, dy);
      const lim = S / 2 - 12;
      if (d > lim) {
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
    for (const e of extra) marker(e, '#e9a23b', 5);
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

  private open(cls: string): HTMLDivElement {
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
    this.modal = false;
  }

  /** Lines of dialogue from a speaker; resolves when the player has read them all. */
  dialog(speaker: string, role: string, lines: string[]): Promise<void> {
    return new Promise((resolve) => {
      if (!lines.length) return resolve();
      const o = this.open('cq-overlay--dialog');
      const box = el('div', 'cq-dialog');
      const who = el('div', 'cq-dialog__who', `${esc(speaker)}<span>${esc(role)}</span>`);
      const text = el('div', 'cq-dialog__text');
      const next = el('button', 'cq-btn cq-btn--primary', 'Continue <kbd>E</kbd>');
      box.append(who, text, next);
      o.append(box);
      let i = 0;
      const show = () => {
        text.textContent = lines[i];
        next.innerHTML = i < lines.length - 1 ? 'Continue <kbd>E</kbd>' : 'OK <kbd>E</kbd>';
      };
      const advance = () => {
        this.onSound?.('click');
        i += 1;
        if (i >= lines.length) {
          this.close();
          resolve();
        } else show();
      };
      next.onclick = advance;
      this.keyHandler = (e) => {
        if (e.repeat) return;
        if (['KeyE', 'Enter', 'Space'].includes(e.code)) {
          e.preventDefault();
          advance();
        }
      };
      show();
    });
  }

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
        } else if (answered && ['KeyE', 'Enter', 'Space'].includes(e.code)) {
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
        if (['KeyE', 'Enter', 'Space'].includes(e.code)) {
          e.preventDefault();
          go();
        }
      };
    });
  }

  // ------------------------------------------------------------ screens

  title(o: { canContinue: boolean; level: number; onStart: () => void; onContinue: () => void }): void {
    const ov = this.open('cq-overlay--title');
    const box = el('div', 'cq-title');
    box.innerHTML = `
      <div class="cq-title__studio">Sumix Developers presents</div>
      <div class="cq-title__name">CAMPUS QUEST</div>
      <div class="cq-title__place">IOE Pashchimanchal Campus · Lamachaur, Pokhara</div>
      <p class="cq-title__blurb">Your first day as an engineering student. Explore the real campus, find each department, solve its challenge and earn your degree — ten levels from Admission Day to Convocation.</p>`;
    const menu = el('div', 'cq-menu');
    if (o.canContinue) {
      const c = el('button', 'cq-btn cq-btn--primary', `Continue <small>Level ${o.level}</small>`);
      c.onclick = o.onContinue;
      menu.append(c);
    }
    const s = el('button', `cq-btn ${o.canContinue ? '' : 'cq-btn--primary'}`, o.canContinue ? 'New game' : 'Start');
    s.onclick = o.onStart;
    menu.append(s);
    const controls = el('button', 'cq-btn', 'Controls');
    controls.onclick = () => box.querySelector('.cq-controls')?.classList.toggle('show');
    menu.append(controls);
    const back = el('a', 'cq-btn', 'Play Poacher Panic (forest)');
    back.href = './forest.html';
    if (isEnabled('forest')) menu.append(back);
    menu.append(installButton('cq-btn'));
    box.append(menu, el('div', 'cq-controls', CONTROLS));
    box.append(el('div', 'cq-title__credit', 'Campus map © OpenStreetMap contributors (ODbL) · Footprints © Microsoft (ODbL) · Elevation: SRTM · Characters are fictional'));
    ov.append(box);
  }

  pause(o: { onResume: () => void; onMap: () => void; onRestartLevel: () => void; onTitle: () => void }): void {
    const ov = this.open('cq-overlay--pause');
    const box = el('div', 'cq-title cq-title--small', '<div class="cq-title__name">PAUSED</div>');
    const menu = el('div', 'cq-menu');
    const items: [string, () => void, string][] = [
      ['Resume', o.onResume, 'cq-btn--primary'],
      ['Campus map', o.onMap, ''],
      ['Restart this level', o.onRestartLevel, ''],
      ['Quit to title', o.onTitle, ''],
    ];
    for (const [label, fn, cls] of items) {
      const b = el('button', `cq-btn ${cls}`, label);
      b.onclick = fn;
      menu.append(b);
    }
    box.append(menu, el('div', 'cq-controls show', CONTROLS));
    ov.append(box);
    this.keyHandler = (e) => {
      if (e.code === 'KeyM') o.onMap();
    };
  }

  /** Full campus map with labels, the player and the current target. */
  bigMap(px: number, pz: number, target: NavTarget | null, extra: NavTarget[], onClose: () => void): void {
    const ov = this.open('cq-overlay--map');
    const wrap = el('div', 'cq-bigmap');
    const c = el('canvas');
    const S = 1024;
    c.width = c.height = S;
    const ctx = c.getContext('2d')!;
    // Crop to the campus and its edge.
    const span = 700;
    const k = S / span;
    const cx = 20;
    const cz = -10;
    const src = this.mapCanvas.width / (WORLD_HALF * 2);
    ctx.drawImage(this.mapCanvas, (cx - span / 2 + WORLD_HALF) * src, (cz - span / 2 + WORLD_HALF) * src, span * src, span * src, 0, 0, S, S);
    const P = (x: number, z: number) => [(x - cx + span / 2) * k, (z - cz + span / 2) * k] as const;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const b of DATA.buildings) {
      if (!b.inside || !b.name || /[^\x20-\x7e]/.test(b.name)) continue;
      const [x, y] = P(...centroid(b.pts));
      const name = b.name.replace('Department of ', 'Dept. ').replace(' Engineering', ' Engg.').replace('Addministrative', 'Administration');
      ctx.font = '600 13px "Segoe UI", sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.strokeText(name, x, y);
      ctx.fillStyle = '#3b2f1c';
      ctx.fillText(name, x, y);
    }
    for (const a of DATA.areas) {
      if (!a.name || !/Ground|Court|Park/.test(a.name) || /[^\x20-\x7e]/.test(a.name)) continue;
      const [x, y] = P(...centroid(a.pts));
      ctx.font = 'italic 12px "Segoe UI", sans-serif';
      ctx.fillStyle = '#2f5a24';
      ctx.fillText(a.name, x, y);
    }
    const dot = (x: number, z: number, colour: string, r: number, label?: string) => {
      const [sx, sy] = P(x, z);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#1b1d18';
      ctx.stroke();
      if (label) {
        ctx.font = '700 15px "Segoe UI", sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#1b1d18';
        ctx.strokeText(label, sx, sy - r - 12);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(label, sx, sy - r - 12);
      }
    };
    for (const e of extra) dot(e.x, e.z, '#e9a23b', 8, e.label);
    if (target) dot(target.x, target.z, '#f2c84b', 11, target.label);
    dot(px, pz, '#d94a3a', 9, 'You');
    wrap.append(c);
    const close = el('button', 'cq-btn cq-btn--primary', 'Close <kbd>M</kbd>');
    close.onclick = onClose;
    wrap.append(el('div', 'cq-bigmap__legend', 'North is up · gold = objective · © OpenStreetMap contributors'), close);
    ov.append(wrap);
    this.keyHandler = (e) => {
      if (['KeyM', 'Escape', 'KeyE'].includes(e.code)) {
        e.preventDefault();
        onClose();
      }
    };
  }

  ending(s: EndStats, onAgain: () => void, onTitle: () => void): void {
    const ov = this.open('cq-overlay--ending');
    const pct = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
    const division = pct >= 80 ? 'Distinction' : pct >= 65 ? 'First Division' : pct >= 50 ? 'Second Division' : 'Pass';
    const mins = Math.floor(s.seconds / 60);
    const secs = Math.round(s.seconds % 60);
    const box = el('div', 'cq-title cq-ending');
    box.innerHTML = `
      <div class="cq-title__studio">Institute of Engineering · Tribhuvan University</div>
      <div class="cq-title__name">CONGRATULATIONS, ENGINEER!</div>
      <div class="cq-title__place">You have graduated from Pashchimanchal Campus with <b>${division}</b></div>
      <div class="cq-ending__grid">
        <div><span>${s.score.toLocaleString()}</span>points</div>
        <div><span>${pct}%</span>accuracy (${s.correct}/${s.answered})</div>
        <div><span>${mins}:${String(secs).padStart(2, '0')}</span>time on campus</div>
      </div>`;
    const menu = el('div', 'cq-menu');
    const again = el('button', 'cq-btn cq-btn--primary', 'Play again');
    again.onclick = onAgain;
    const t = el('button', 'cq-btn', 'Title screen');
    t.onclick = onTitle;
    menu.append(again, t);
    box.append(menu);
    ov.append(box, confetti());
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
    <tr><td><kbd>W A S D</kbd></td><td>Walk (relative to the camera)</td></tr>
    <tr><td><kbd>Mouse</kbd></td><td>Look around</td></tr>
    <tr><td><kbd>Shift</kbd></td><td>Run</td></tr>
    <tr><td><kbd>Space</kbd></td><td>Jump</td></tr>
    <tr><td><kbd>E</kbd></td><td>Talk / pick up / continue</td></tr>
    <tr><td><kbd>1</kbd>–<kbd>4</kbd></td><td>Answer a question (or click)</td></tr>
    <tr><td><kbd>M</kbd></td><td>Campus map</td></tr>
    <tr><td><kbd>Esc</kbd></td><td>Pause</td></tr>
  </table>`;

function confetti(): HTMLDivElement {
  const c = el('div', 'cq-confetti');
  const colours = ['#dc143c', '#003893', '#f2c84b', '#ffffff', '#3fa34d'];
  for (let i = 0; i < 90; i += 1) {
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
