// Table Tennis with Raju: pong, first to five. You are on the left. Drag on the table (touch or
// mouse), or W / S or the arrow keys. Raju is quick but turns late and leaves the corners.

import type { MiniContext, MiniGame, MiniResult } from './types.ts';

export interface PongText {
  score: string;
  serve: string;
  ok: string;
  fail: string;
}

export function tableTennis(text: PongText): MiniGame {
  const W = 520;
  const H = 300;
  const PH = 64; // paddle height
  const PW = 10;
  const R = 7;
  const WIN = 5;
  let g: CanvasRenderingContext2D;
  let status: HTMLElement;
  let c: MiniContext;
  let you = H / 2;
  let raju = H / 2;
  let bx = W / 2;
  let by = H / 2;
  let vx = -220;
  let vy = 90;
  let a = 0;
  let b = 0;
  let wait = 1;
  let drag: number | null = null;
  let done = false;
  let shownA = -1;
  let shownB = -1;
  const serve = (toYou: boolean) => {
    bx = W / 2;
    by = H / 2;
    vx = toYou ? -230 : 230;
    vy = (Math.random() - 0.5) * 260;
    wait = 0.8;
  };
  const game: MiniGame = {
    start(ctx) {
      c = ctx;
      const canvas = document.createElement('canvas');
      canvas.className = 'mg-scope mg-vial mg-table';
      canvas.width = W;
      canvas.height = H;
      g = canvas.getContext('2d')!;
      status = document.createElement('div');
      status.className = 'mg-status';
      const at = (e: PointerEvent) => {
        const r = canvas.getBoundingClientRect();
        return ((e.clientY - r.top) / r.height) * H;
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
      const hint = document.createElement('div');
      hint.className = 'mg-status';
      hint.textContent = text.serve;
      ctx.body.append(canvas, status, hint);
    },
    update(dt) {
      if (done) return;
      // Your paddle.
      let v = 0;
      if (c.held.has('KeyW') || c.held.has('ArrowUp')) v -= 340;
      if (c.held.has('KeyS') || c.held.has('ArrowDown')) v += 340;
      you += v * dt;
      if (drag !== null) you += (drag - you) * Math.min(1, dt * 14);
      you = Math.min(H - PH / 2, Math.max(PH / 2, you));
      // Raju follows the ball, with a top speed and a late turn.
      const aim = vx > 0 ? by : H / 2;
      const rs = 215 + (a + b) * 6;
      raju += Math.max(-rs * dt, Math.min(rs * dt, aim - raju));
      raju = Math.min(H - PH / 2, Math.max(PH / 2, raju));
      // Ball.
      if (wait > 0) wait -= dt;
      else {
        bx += vx * dt;
        by += vy * dt;
        if (by < R) { by = R; vy = Math.abs(vy); c.sound('click'); }
        if (by > H - R) { by = H - R; vy = -Math.abs(vy); c.sound('click'); }
        // Paddles: the further from the middle you hit it, the steeper it goes.
        if (vx < 0 && bx - R < 24 + PW && bx > 18 && Math.abs(by - you) < PH / 2 + R) {
          vx = Math.min(560, Math.abs(vx) * 1.07);
          vy = ((by - you) / (PH / 2)) * 300;
          c.sound('switch');
        }
        if (vx > 0 && bx + R > W - 24 - PW && bx < W - 18 && Math.abs(by - raju) < PH / 2 + R) {
          vx = -Math.min(560, Math.abs(vx) * 1.05);
          vy = ((by - raju) / (PH / 2)) * 280;
          c.sound('switch');
        }
        if (bx < -R) { b += 1; c.sound('knock'); serve(true); }
        if (bx > W + R) { a += 1; c.sound('pickup'); serve(false); }
      }
      // Draw.
      g.fillStyle = '#12457a';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      g.lineWidth = 3;
      g.strokeRect(2, 2, W - 4, H - 4);
      g.beginPath();
      g.moveTo(W / 2, 0);
      g.lineTo(W / 2, H);
      g.stroke();
      g.fillStyle = '#f2c84b';
      g.fillRect(24, you - PH / 2, PW, PH);
      g.fillStyle = '#c9ced6';
      g.fillRect(W - 24 - PW, raju - PH / 2, PW, PH);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(bx, by, R, 0, Math.PI * 2);
      g.fill();
      if (a !== shownA || b !== shownB) {
        shownA = a;
        shownB = b;
        status.textContent = text.score.replace('{a}', String(a)).replace('{b}', String(b));
      }
      if (a >= WIN || b >= WIN) done = true;
    },
    get done() {
      return done;
    },
    finish(): MiniResult {
      const ok = a >= WIN;
      const s = (ok ? text.ok : text.fail).replace('{a}', String(a)).replace('{b}', String(b));
      return { ok, note: s, score: a };
    },
  };
  return game;
}
