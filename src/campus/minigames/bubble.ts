// Bubble Level: a dumpy level's vial. The bubble drifts in the storm; centre it and hold it in
// the marks for `hold` seconds. Drag on the vial (touch or mouse) or use A / D or the arrow keys.
// 40 seconds to do it. Used in mission 5 and as an interlude after it.

import type { MiniContext, MiniGame, MiniResult } from './types.ts';

export interface BubbleText {
  holdOk: string;
  holdFail: string;
  holding: string;
  find: string;
}

export function bubbleLevel(hold: number, text: BubbleText): MiniGame {
  const W = 520;
  const H = 120;
  const LIMIT = 40;
  let ctx2: CanvasRenderingContext2D;
  let status: HTMLElement;
  let c: MiniContext;
  let x = 0.8; // bubble position, -1..1
  let v = 0;
  let drag: number | null = null;
  let held = 0;
  let left = LIMIT;
  let t = 0;
  let done = false;
  let ok = false;
  let shown = '';
  const ZONE = 0.12;
  const game: MiniGame = {
    start(ctx) {
      c = ctx;
      const canvas = document.createElement('canvas');
      canvas.className = 'mg-scope mg-vial';
      canvas.width = W;
      canvas.height = H;
      ctx2 = canvas.getContext('2d')!;
      status = document.createElement('div');
      status.className = 'mg-status';
      const at = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return ((e.clientX - r.left) / r.width) * 2 - 1;
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
      // The storm pushes the bubble about; the player pushes back.
      const gust = Math.sin(t * 1.3) * 0.9 + Math.sin(t * 3.7 + 1) * 0.5;
      let push = gust * 0.9;
      if (c.held.has('KeyA') || c.held.has('ArrowLeft')) push -= 3.2;
      if (c.held.has('KeyD') || c.held.has('ArrowRight')) push += 3.2;
      if (drag !== null) push += (drag - x) * 9;
      v += push * dt;
      v *= Math.exp(-2.6 * dt);
      x += v * dt;
      if (x < -1) { x = -1; v = 0; }
      if (x > 1) { x = 1; v = 0; }
      const inside = Math.abs(x) < ZONE;
      held = inside ? held + dt : Math.max(0, held - dt * 2);
      // Draw: the vial, the marks, the bubble.
      const g = ctx2;
      g.clearRect(0, 0, W, H);
      g.fillStyle = '#1d3a2a';
      g.beginPath();
      g.roundRect(20, 36, W - 40, 48, 24);
      g.fill();
      g.strokeStyle = inside ? '#6ef09a' : '#c8e8ff';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(W / 2 - ZONE * (W / 2 - 40) - 14, 30);
      g.lineTo(W / 2 - ZONE * (W / 2 - 40) - 14, 90);
      g.moveTo(W / 2 + ZONE * (W / 2 - 40) + 14, 30);
      g.lineTo(W / 2 + ZONE * (W / 2 - 40) + 14, 90);
      g.stroke();
      const bx = W / 2 + x * (W / 2 - 50);
      g.fillStyle = 'rgba(230, 255, 230, 0.85)';
      g.beginPath();
      g.ellipse(bx, 60, 22, 14, 0, 0, Math.PI * 2);
      g.fill();
      const s = held > 0 ? text.holding.replace('{p}', String(Math.min(100, Math.round((held / hold) * 100)))) : text.find.replace('{s}', String(Math.ceil(left)));
      if (s !== shown) {
        status.textContent = s;
        shown = s;
      }
      if (held >= hold) {
        done = true;
        ok = true;
        c.sound('clue');
      } else if (left <= 0) done = true;
    },
    get done() {
      return done;
    },
    finish(): MiniResult {
      return { ok, note: ok ? text.holdOk : text.holdFail };
    },
  };
  return game;
}
