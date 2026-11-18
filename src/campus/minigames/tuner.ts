// Signal Tuner: match your wave to the caller's by turning the dial, and hold it there for
// 2 seconds. Jammed (after mission 6): the caller's wave drifts and the screen crackles.
// Drag on the scope (touch or mouse), or A / D or the arrow keys. 35 seconds.

import type { MiniContext, MiniGame, MiniResult } from './types.ts';

export interface TunerText {
  find: string;
  locked: string;
  ok: string;
  fail: string;
}

export function signalTuner(jammed: boolean, text: TunerText): MiniGame {
  const W = 520;
  const H = 150;
  const LIMIT = 35;
  const HOLD = 2;
  let g: CanvasRenderingContext2D;
  let status: HTMLElement;
  let c: MiniContext;
  let dial = 0.1; // 0..1
  let drag: number | null = null;
  let target = 0.55 + Math.random() * 0.3;
  let t = 0;
  let left = LIMIT;
  let held = 0;
  let done = false;
  let ok = false;
  let shownA = -1;
  let shownB = -1;
  const freq = (v: number) => 1 + v * 4;
  const wave = (f: number, colour: string, noise: number) => {
    g.strokeStyle = colour;
    g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= W; x += 6) {
      const y = H / 2 + Math.sin((x / W) * Math.PI * 2 * f + t * 3) * 42 + (noise ? (Math.random() - 0.5) * noise : 0);
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  };
  const game: MiniGame = {
    start(ctx) {
      c = ctx;
      const canvas = document.createElement('canvas');
      canvas.className = 'mg-scope mg-vial';
      canvas.width = W;
      canvas.height = H;
      g = canvas.getContext('2d')!;
      status = document.createElement('div');
      status.className = 'mg-status';
      const at = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      };
      canvas.addEventListener('pointerdown', (e) => {
        canvas.setPointerCapture(e.pointerId);
        drag = at(e);
      });
      canvas.addEventListener('pointermove', (e) => {
        if (drag !== null) drag = at(e);
      });
      const up = () => (drag = null);
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.style.touchAction = 'none';
      ctx.body.append(canvas, status);
    },
    update(dt) {
      if (done) return;
      t += dt;
      left -= dt;
      if (jammed) target = Math.min(0.95, Math.max(0.05, target + Math.sin(t * 0.7) * 0.05 * dt + Math.sin(t * 2.3) * 0.03 * dt));
      let v = 0;
      if (c.held.has('KeyA') || c.held.has('ArrowLeft')) v -= 0.35;
      if (c.held.has('KeyD') || c.held.has('ArrowRight')) v += 0.35;
      dial = Math.min(1, Math.max(0, dial + v * dt));
      if (drag !== null) dial += (drag - dial) * Math.min(1, dt * 10);
      const near = Math.abs(freq(dial) - freq(target));
      const locked = near < 0.14;
      held = locked ? held + dt : Math.max(0, held - dt * 1.5);
      // Draw: the caller's wave (cyan) and yours (gold); they merge when matched.
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#071a20';
      g.fillRect(0, 0, W, H);
      wave(freq(target), '#38e1ff', jammed ? 14 : 2);
      wave(freq(dial), locked ? '#6ef09a' : '#f2c84b', 0);
      // The dial position along the bottom.
      g.fillStyle = '#f2c84b';
      g.fillRect(dial * (W - 16), H - 8, 16, 6);
      const a = held > 0 ? Math.min(100, Math.round((held / HOLD) * 100)) : -1;
      const b = Math.ceil(left);
      if (a !== shownA || (a < 0 && b !== shownB)) {
        shownA = a;
        shownB = b;
        status.textContent = a >= 0 ? text.locked.replace('{p}', String(a)) : text.find.replace('{s}', String(b));
      }
      if (held >= HOLD) {
        done = true;
        ok = true;
        c.sound('radioBeep');
      } else if (left <= 0) done = true;
    },
    get done() {
      return done;
    },
    finish(): MiniResult {
      return { ok, note: ok ? text.ok : text.fail, score: ok ? Math.round(left) : 0 };
    },
  };
  return game;
}
