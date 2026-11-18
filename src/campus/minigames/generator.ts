// Generator Pull-Start: a marker swings along the cord gauge; pull (tap, click, Space or E)
// while it is in the green. Three good pulls in a row start the engine; a miss starts the
// rhythm again. 30 seconds.

import type { MiniContext, MiniGame, MiniResult } from './types.ts';

export interface GeneratorText {
  status: string;
  hint: string;
  miss: string;
  ok: string;
  fail: string;
}

export function generatorPull(text: GeneratorText): MiniGame {
  const W = 520;
  const H = 90;
  const LIMIT = 30;
  const ZONE_A = 0.62;
  const ZONE_B = 0.8;
  let g: CanvasRenderingContext2D;
  let status: HTMLElement;
  let note: HTMLElement;
  let c: MiniContext;
  let phase = 0;
  let speed = 1.6;
  let pulls = 0;
  let left = LIMIT;
  let flash = 0;
  let done = false;
  let ok = false;
  let shown = -1;
  let shownPulls = -1;
  const pos = () => 0.5 - 0.5 * Math.cos(phase);
  const pull = () => {
    if (done) return;
    const p = pos();
    if (p >= ZONE_A && p <= ZONE_B) {
      pulls += 1;
      speed += 0.35;
      flash = 0.25;
      c.sound('thunk');
      if (pulls >= 3) {
        done = true;
        ok = true;
        c.sound('generatorStart');
      }
    } else {
      pulls = 0;
      speed = 1.6;
      c.sound('knock');
      note.textContent = text.miss;
    }
  };
  const game: MiniGame = {
    start(ctx) {
      c = ctx;
      const canvas = document.createElement('canvas');
      canvas.className = 'mg-scope mg-vial';
      canvas.width = W;
      canvas.height = H;
      g = canvas.getContext('2d')!;
      canvas.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        pull();
      });
      canvas.style.touchAction = 'none';
      status = document.createElement('div');
      status.className = 'mg-status';
      note = document.createElement('div');
      note.className = 'mg-status';
      note.textContent = text.hint;
      ctx.body.append(canvas, status, note);
    },
    update(dt) {
      if (done) return;
      left -= dt;
      phase += dt * speed * Math.PI;
      if (flash > 0) flash -= dt;
      g.fillStyle = flash > 0 ? '#21402a' : '#1a1d22';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#2e7d4a';
      g.fillRect(20 + ZONE_A * (W - 40), 20, (ZONE_B - ZONE_A) * (W - 40), H - 40);
      g.strokeStyle = '#c8e8ff';
      g.lineWidth = 2;
      g.strokeRect(20, 20, W - 40, H - 40);
      g.fillStyle = '#f2c84b';
      g.fillRect(20 + pos() * (W - 40) - 4, 12, 8, H - 24);
      const s = Math.ceil(left);
      if (s !== shown || pulls !== shownPulls) {
        shown = s;
        shownPulls = pulls;
        status.textContent = text.status.replace('{n}', String(pulls)).replace('{s}', String(Math.max(0, s)));
      }
      if (left <= 0) done = true;
    },
    key(e) {
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
        e.preventDefault();
        if (!e.repeat) pull();
      }
    },
    get done() {
      return done;
    },
    finish(): MiniResult {
      return { ok, note: ok ? text.ok : text.fail, score: pulls };
    },
  };
  return game;
}
