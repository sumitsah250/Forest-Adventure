// Hands-on puzzles for the missions, each a modal card that resolves true (solved) or
// false (failed: the mission takes a heart and the player can try again):
//
//   switches  breakers / firewall nodes with place values; engage the ones that add up to a target
//   keypad    enter a code worked out from a clue
//   gauge     press when the sweeping needle is in the green zone, N times
//   tuner     tune an analyser until the signal peaks, then hold it
//   debug     pick the buggy line of C
//   simon     watch a light pattern, repeat it
//   choose    pick one answer (the accusation)
//
// Test builds expose window.__mgSolve() so automated play-throughs can finish any of them.

import { V2_TEXT, type PuzzleDef } from './story.ts';
import type { MiniGame } from './minigames/types.ts';
import { bubbleLevel } from './minigames/bubble.ts';

const TEST = new URLSearchParams(location.search).has('test');

export interface ModalHost {
  open(cls: string): HTMLDivElement;
  close(): void;
  keyHandler: ((e: KeyboardEvent) => void) | null;
  onSound: ((name: string) => void) | null;
  /** Set by an open card: ends it as a failure (a countdown ran out). */
  onAbort?: (() => void) | null;
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

const CONFIRM = ['KeyE', 'Enter', 'Space', 'NumpadEnter'];

/**
 * Shared card frame: header, clue, body slot and a result panel. `finish(ok, text)` shows
 * the result, then Continue (E) resolves the promise.
 */
/** A Skip button for the next puzzle card opened (null: none). Read and cleared by frame(). */
let skipOffer: string | null = null;

/**
 * Offers a Skip button on the next puzzle or mini-game card (after repeated failures, and on
 * every interlude). A skipped puzzle counts as passed; a skipped mini-game as not won.
 */
export function offerSkip(label: string | null): void {
  skipOffer = label;
}

function frame(host: ModalHost, title: string, clue: string, hearts: string) {
  const ov = host.open('cq-overlay--quiz');
  const card = el('div', 'cq-quiz mg');
  card.append(
    el('div', 'cq-quiz__head', `<span>${esc(title)}</span><span class="cq-quiz__progress">${hearts}</span>`),
    el('div', 'mg-clue', esc(clue)),
  );
  const body = el('div', 'mg-body');
  const feedback = el('div', 'cq-quiz__feedback');
  const next = el('button', 'cq-btn cq-btn--primary', 'Continue <kbd>E</kbd>');
  next.style.display = 'none';
  card.append(body, feedback, next);
  ov.append(card);
  let done = false;
  let skipped = false;
  const offer = skipOffer;
  skipOffer = null;
  if (offer) {
    const skip = el('button', 'cq-btn mg-skip');
    skip.textContent = offer;
    skip.onclick = () => {
      if (done) return;
      skipped = true;
      skip.remove();
      finish(true, V2_TEXT.easy.skipped, V2_TEXT.easy.skippedHead);
    };
    card.append(skip);
  }
  let resolveFn: (ok: boolean) => void = () => undefined;
  let result = false;
  const cleanups: (() => void)[] = [];
  const promise = new Promise<boolean>((r) => (resolveFn = r));
  const close = () => {
    for (const c of cleanups) c();
    if (TEST) delete (window as unknown as { __mgSolve?: () => void }).__mgSolve;
    host.onSound?.('click');
    host.close();
    resolveFn(result);
  };
  const finish = (ok: boolean, text: string, head?: string) => {
    if (done) return;
    done = true;
    result = ok;
    feedback.innerHTML = `<b>${esc(head ?? (ok ? 'Solved!' : 'Failed.'))}</b> ${esc(text)}`;
    feedback.className = `cq-quiz__feedback show ${ok ? 'good' : 'bad'}`;
    next.style.display = '';
    host.onSound?.(ok ? 'clue' : 'knock');
    if (!ok) card.classList.add('shake');
    body.classList.add('mg-done');
    for (const c of cleanups.splice(0)) c();
  };
  next.onclick = close;
  host.onAbort = () => {
    if (!done) {
      done = true;
      result = false;
    }
    close();
  };
  if (TEST) (window as unknown as { __mgSolve?: () => void }).__mgSolve = () => finish(true, '(test)');
  /** Key handler wrapper: the puzzle's keys until done, then Continue. */
  const keys = (fn: (e: KeyboardEvent) => void) => {
    host.keyHandler = (e) => {
      if (done) {
        if (CONFIRM.includes(e.code) && !e.repeat) {
          e.preventDefault();
          close();
        }
        return;
      }
      fn(e);
    };
  };
  return { card, body, finish, promise, keys, cleanups, isDone: () => done, skipped: () => skipped };
}

export function heartsLabel(hearts: number, max: number): string {
  return Array.from({ length: max }, (_, i) => `<span class="mg-heart ${i < hearts ? 'on' : ''}">♥</span>`).join('');
}

export function runPuzzle(host: ModalHost, p: PuzzleDef, hearts: string): Promise<boolean> {
  switch (p.type) {
    case 'switches': return switches(host, p, hearts);
    case 'keypad': return keypad(host, p, hearts);
    case 'gauge': return gauge(host, p, hearts);
    case 'tuner': return tuner(host, p, hearts);
    case 'debug': return debug(host, p, hearts);
    case 'simon': return simon(host, p, hearts);
    case 'bubble': return runMini(host, p.title, p.clue, hearts, bubbleLevel(p.hold, V2_TEXT.mini.bubble)).then((r) => r.ok || !!r.skipped);
  }
}

// ------------------------------------------------------------------ mini-games

/**
 * Runs a mini-game (minigames/types.ts) inside the standard card: its own body, a frame loop,
 * held keys, and the shared result panel. Resolves with its result once Continue is pressed.
 */
export function runMini(host: ModalHost, title: string, clue: string, hearts: string, game: MiniGame, opts: Record<string, unknown> = {}): Promise<{ ok: boolean; score?: number; skipped?: boolean }> {
  const f = frame(host, title, clue, hearts);
  const held = new Set<string>();
  const down = (e: KeyboardEvent) => held.add(e.code);
  const up = (e: KeyboardEvent) => held.delete(e.code);
  window.addEventListener('keydown', down);
  window.addEventListener('keyup', up);
  game.start({ body: f.body, sound: (n) => host.onSound?.(n), held, opts });
  let last = performance.now();
  let raf = 0;
  let score: number | undefined;
  let ok = false;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    if (game.done) {
      const r = game.finish();
      ok = r.ok;
      score = r.score;
      f.finish(r.ok, r.note);
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  f.cleanups.push(() => {
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', down);
    window.removeEventListener('keyup', up);
    game.dispose?.();
  });
  f.keys((e) => game.key?.(e));
  if (TEST) (window as unknown as { __mgSolve?: () => void }).__mgSolve = () => {
    ok = true;
    f.finish(true, '(test)');
  };
  return f.promise.then((r) => ({ ok: r && ok && !f.skipped(), score, skipped: f.skipped() }));
}

// ------------------------------------------------------------------ switches

function switches(host: ModalHost, p: Extract<PuzzleDef, { type: 'switches' }>, hearts: string): Promise<boolean> {
  const f = frame(host, p.title, p.clue, hearts);
  const on = Array.from({ length: p.bits }, () => false);
  const row = el('div', 'mg-switches');
  const btns: HTMLButtonElement[] = [];
  for (let i = 0; i < p.bits; i += 1) {
    const value = 2 ** (p.bits - 1 - i);
    const b = el('button', 'mg-switch', `<span class="mg-switch__lever"></span><b>${value}</b><kbd>${i + 1}</kbd>`);
    b.onclick = () => toggle(i);
    btns.push(b);
    row.append(b);
  }
  const engage = el('button', 'cq-btn cq-btn--primary mg-engage', 'Engage <kbd>E</kbd>');
  const toggle = (i: number) => {
    if (f.isDone()) return;
    on[i] = !on[i];
    btns[i].classList.toggle('on', on[i]);
    host.onSound?.('switch');
  };
  const check = () => {
    const sum = on.reduce((s, v, i) => s + (v ? 2 ** (p.bits - 1 - i) : 0), 0);
    f.finish(sum === p.target, sum === p.target ? p.why : `Those add up to ${sum}, not ${p.target}. ${p.why}`);
  };
  engage.onclick = check;
  f.body.append(row, engage);
  if (TEST) f.card.dataset.solution = p.target.toString(2).padStart(p.bits, '0');
  f.keys((e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(e.code);
    if (n >= 0 && n < p.bits) {
      e.preventDefault();
      toggle(n);
    } else if (CONFIRM.includes(e.code) && !e.repeat) {
      e.preventDefault();
      check();
    }
  });
  return f.promise;
}

// ------------------------------------------------------------------ keypad

function keypad(host: ModalHost, p: Extract<PuzzleDef, { type: 'keypad' }>, hearts: string): Promise<boolean> {
  const f = frame(host, p.title, p.clue, hearts);
  let entry = '';
  const screen = el('div', 'mg-screen', '&nbsp;');
  const pad = el('div', 'mg-keypad');
  const show = () => (screen.innerHTML = entry ? esc(entry) : '&nbsp;');
  const press = (k: string) => {
    if (f.isDone()) return;
    host.onSound?.('click');
    if (k === '⌫') entry = entry.slice(0, -1);
    else if (k === 'OK') return check();
    else if (entry.length < Math.max(6, p.code.length + 2)) entry += k;
    show();
  };
  const check = () => {
    if (!entry) return;
    f.finish(entry === p.code, entry === p.code ? p.why : `"${entry}" is not it. ${p.why}`);
  };
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK']) {
    const b = el('button', `mg-key ${k === 'OK' ? 'ok' : ''}`, k);
    b.onclick = () => press(k);
    pad.append(b);
  }
  f.body.append(screen, pad);
  if (TEST) f.card.dataset.solution = p.code;
  f.keys((e) => {
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (m) {
      e.preventDefault();
      press(m[1]);
    } else if (e.code === 'Backspace') {
      e.preventDefault();
      press('⌫');
    } else if (CONFIRM.includes(e.code) && !e.repeat) {
      e.preventDefault();
      check();
    }
  });
  return f.promise;
}

// ------------------------------------------------------------------ gauge

function gauge(host: ModalHost, p: Extract<PuzzleDef, { type: 'gauge' }>, hearts: string): Promise<boolean> {
  const f = frame(host, p.title, p.clue, hearts);
  const track = el('div', 'mg-gauge');
  const zone = el('div', 'mg-gauge__zone');
  const needle = el('div', 'mg-gauge__needle');
  track.append(zone, needle);
  const pips = el('div', 'mg-pips');
  const status = el('div', 'mg-status', `0 / ${p.hits}`);
  const go = el('button', 'cq-btn cq-btn--primary mg-engage', 'NOW! <kbd>Space</kbd>');
  f.body.append(track, pips, status, go);
  let hits = 0;
  let misses = 0;
  let width = 0.26;
  let centre = 0.5 + (Math.random() - 0.5) * 0.4;
  let speed = p.speed;
  let pos = 0;
  let dir = 1;
  const draw = () => {
    zone.style.left = `${(centre - width / 2) * 100}%`;
    zone.style.width = `${width * 100}%`;
    pips.innerHTML = Array.from({ length: p.hits }, (_, i) => `<i class="${i < hits ? 'on' : ''}"></i>`).join('') + Array.from({ length: 3 }, (_, i) => `<i class="miss ${i < misses ? 'on' : ''}"></i>`).join('');
  };
  draw();
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    pos += dir * speed * dt;
    if (pos > 1) { pos = 1; dir = -1; }
    if (pos < 0) { pos = 0; dir = 1; }
    needle.style.left = `${pos * 100}%`;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  f.cleanups.push(() => cancelAnimationFrame(raf));
  const press = () => {
    if (f.isDone()) return;
    if (Math.abs(pos - centre) <= width / 2) {
      hits += 1;
      host.onSound?.('switch');
      width = Math.max(0.1, width * 0.82);
      centre = 0.15 + Math.random() * 0.7;
      speed *= 1.12;
      track.classList.remove('hit');
      void track.offsetWidth;
      track.classList.add('hit');
    } else {
      misses += 1;
      host.onSound?.('knock');
      track.classList.remove('miss');
      void track.offsetWidth;
      track.classList.add('miss');
    }
    status.textContent = `${hits} / ${p.hits}`;
    draw();
    if (hits >= p.hits) f.finish(true, 'Perfect timing.');
    else if (misses >= 3) f.finish(false, 'Three misses — it flooded. Let it settle and try again.');
  };
  go.onclick = press;
  track.onclick = press;
  f.keys((e) => {
    if (['Space', 'KeyE', 'Enter'].includes(e.code) && !e.repeat) {
      e.preventDefault();
      press();
    }
  });
  return f.promise;
}

// ------------------------------------------------------------------ tuner

function tuner(host: ModalHost, p: Extract<PuzzleDef, { type: 'tuner' }>, hearts: string): Promise<boolean> {
  const f = frame(host, p.title, p.clue, hearts);
  const target = 12 + Math.random() * 76;
  const scope = el('canvas', 'mg-scope');
  scope.width = 520;
  scope.height = 120;
  const ctx = scope.getContext('2d')!;
  const slider = el('input', 'mg-slider');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.step = '0.1';
  slider.value = String(target > 50 ? 5 : 95);
  const meter = el('div', 'mg-meter', '<span></span>');
  const status = el('div', 'mg-status', 'Find the peak…');
  f.body.append(scope, slider, meter, status);
  const LIMIT = 35;
  let hold = 0;
  let left = LIMIT;
  const held = { a: false, d: false };
  let last = performance.now();
  let raf = 0;
  let t = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    t += dt;
    let v = Number(slider.value);
    if (held.a) v -= dt * 22;
    if (held.d) v += dt * 22;
    v = Math.max(0, Math.min(100, v));
    slider.value = String(v);
    const d = Math.abs(v - target);
    const strength = Math.max(0, 1 - d / 40) ** 2;
    const noise = (Math.random() - 0.5) * 0.08 * (1 - strength);
    const s = Math.max(0, Math.min(1, strength + noise));
    (meter.firstChild as HTMLSpanElement).style.width = `${s * 100}%`;
    meter.classList.toggle('lock', strength > 0.9);
    // Oscilloscope: a clean sine when tuned, noise when not.
    ctx.clearRect(0, 0, 520, 120);
    ctx.strokeStyle = strength > 0.9 ? '#5cf2a0' : '#2ad4ff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = 0; x <= 520; x += 4) {
      const y = 60 + Math.sin(x * 0.05 + t * 8) * 40 * strength + (Math.random() - 0.5) * 50 * (1 - strength);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    hold = strength > 0.9 ? hold + dt : Math.max(0, hold - dt * 2);
    left -= dt;
    status.textContent = hold > 0 ? `Locking… ${Math.min(100, Math.round((hold / 1.2) * 100))}%` : `Find the peak… ${Math.ceil(left)} s`;
    if (hold >= 1.2) f.finish(true, 'Signal locked. Bearing recorded.');
    else if (left <= 0) f.finish(false, 'The signal faded before you locked it.');
    else raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  f.cleanups.push(() => cancelAnimationFrame(raf));
  const up = (e: KeyboardEvent) => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') held.a = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') held.d = false;
  };
  window.addEventListener('keyup', up);
  f.cleanups.push(() => window.removeEventListener('keyup', up));
  f.keys((e) => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') { held.a = true; e.preventDefault(); }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') { held.d = true; e.preventDefault(); }
  });
  return f.promise;
}

// ------------------------------------------------------------------ debug

function debug(host: ModalHost, p: Extract<PuzzleDef, { type: 'debug' }>, hearts: string): Promise<boolean> {
  const f = frame(host, p.title, p.clue, hearts);
  const code = el('div', 'mg-code');
  const rows: HTMLButtonElement[] = [];
  p.lines.forEach((line, i) => {
    const b = el('button', 'mg-line', `<kbd>${i + 1}</kbd><code></code>`);
    (b.querySelector('code') as HTMLElement).textContent = line;
    b.onclick = () => pick(i);
    rows.push(b);
    code.append(b);
  });
  const pick = (i: number) => {
    if (f.isDone()) return;
    rows[p.bug].classList.add('right');
    if (i !== p.bug) rows[i].classList.add('wrong');
    f.finish(i === p.bug, p.why);
  };
  f.body.append(code);
  if (TEST) f.card.dataset.answer = String(p.bug + 1);
  f.keys((e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'].indexOf(e.code);
    if (n >= 0 && n < p.lines.length) {
      e.preventDefault();
      pick(n);
    }
  });
  return f.promise;
}

// ------------------------------------------------------------------ simon

function simon(host: ModalHost, p: Extract<PuzzleDef, { type: 'simon' }>, hearts: string): Promise<boolean> {
  const f = frame(host, p.title, p.clue, hearts);
  const grid = el('div', 'mg-simon');
  const status = el('div', 'mg-status', 'Watch…');
  const pads: HTMLButtonElement[] = [];
  for (let i = 0; i < 4; i += 1) {
    const b = el('button', `mg-pad mg-pad--${i}`, `<kbd>${i + 1}</kbd>`);
    b.onclick = () => input(i);
    pads.push(b);
    grid.append(b);
  }
  f.body.append(grid, status);
  const seq = Array.from({ length: p.length }, () => Math.floor(Math.random() * 4));
  let at = 0;
  let accepting = false;
  const timers: number[] = [];
  f.cleanups.push(() => timers.forEach((t) => clearTimeout(t)));
  const flash = (i: number, ms = 380) => {
    pads[i].classList.add('lit');
    host.onSound?.('click');
    timers.push(window.setTimeout(() => pads[i].classList.remove('lit'), ms));
  };
  // Play the pattern once, then the player repeats it.
  seq.forEach((i, k) => timers.push(window.setTimeout(() => flash(i), 700 + k * 560)));
  timers.push(window.setTimeout(() => {
    accepting = true;
    status.textContent = `Your turn: 0 / ${p.length}`;
  }, 700 + seq.length * 560));
  const input = (i: number) => {
    if (!accepting || f.isDone()) return;
    flash(i, 200);
    if (i !== seq[at]) {
      pads[seq[at]].classList.add('hint');
      f.finish(false, 'Wrong pad — the pattern reset.');
      return;
    }
    at += 1;
    status.textContent = `Your turn: ${at} / ${p.length}`;
    if (at >= seq.length) f.finish(true, 'Pattern accepted.');
  };
  if (TEST) f.card.dataset.solution = seq.map((i) => i + 1).join('');
  f.keys((e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && !e.repeat) {
      e.preventDefault();
      input(n);
    }
  });
  return f.promise;
}

// ------------------------------------------------------------------ choose

export function choose(host: ModalHost, o: { title: string; question: string; options: string[]; answer: number; why: string; hearts: string }): Promise<boolean> {
  const f = frame(host, o.title, o.question, o.hearts);
  const list = el('div', 'cq-quiz__opts mg-choose');
  const btns: HTMLButtonElement[] = [];
  o.options.forEach((opt, i) => {
    const b = el('button', 'cq-quiz__opt', `<kbd>${i + 1}</kbd><span></span>`);
    (b.querySelector('span') as HTMLSpanElement).textContent = opt;
    b.onclick = () => pick(i);
    btns.push(b);
    list.append(b);
  });
  const pick = (i: number) => {
    if (f.isDone()) return;
    btns.forEach((b) => (b.disabled = true));
    btns[o.answer].classList.add('right');
    if (i !== o.answer) btns[i].classList.add('wrong');
    f.finish(i === o.answer, i === o.answer ? o.why : 'That does not fit the evidence. Think again.');
  };
  f.body.append(list);
  if (TEST) f.card.dataset.answer = String(o.answer + 1);
  f.keys((e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0 && n < o.options.length) {
      e.preventDefault();
      pick(n);
    }
  });
  return f.promise;
}

const DIGITS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];

/** A choice with no wrong answer (mission 10's last question). Resolves with the option's index. */
export function decide(host: ModalHost, o: { title: string; question: string; options: string[] }): Promise<number> {
  return new Promise((resolve) => {
    const ov = host.open('cq-overlay--quiz');
    const card = el('div', 'cq-quiz decide');
    card.append(el('div', 'cq-quiz__head', `<span>${esc(o.title)}</span>`), el('div', 'cq-quiz__q', esc(o.question)));
    const list = el('div', 'cq-quiz__opts');
    const pick = (i: number) => {
      host.onSound?.('click');
      host.close();
      resolve(i);
    };
    o.options.forEach((opt, i) => {
      const b = el('button', 'cq-quiz__opt', `<kbd>${i + 1}</kbd><span></span>`);
      (b.querySelector('span') as HTMLSpanElement).textContent = opt;
      b.onclick = () => pick(i);
      list.append(b);
    });
    card.append(list);
    if (TEST) card.dataset.answer = '1';
    ov.append(card);
    host.keyHandler = (e) => {
      const n = DIGITS.indexOf(e.code);
      if (n >= 0 && n < o.options.length) {
        e.preventDefault();
        pick(n);
      }
    };
  });
}
