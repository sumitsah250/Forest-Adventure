// Table Tennis with Raju: pong, first to five. You are on the left. Drag on the table (touch or
// mouse), or W / S or the arrow keys. Raju is quick but turns late and leaves the corners.
// Tuned to be won (it is an interlude, not a test): your paddle is longer than his, the ball is
// slow and speeds up gently, and Raju misreads your shots, most of all a steep one off the edge
// of your paddle, so aiming for the corners wins points.

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
  const PH = 92; // your paddle's height
  const RH = 64; // Raju's
  const PW = 10;
  const MAX = 400; // top ball speed (px/s)
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
  /** Where Raju thinks the ball will be, off by this much (set each time you hit it). */
  let misread = 0;
  const serve = (toYou: boolean) => {
    bx = W / 2;
    by = H / 2;
    vx = toYou ? -175 : 175;
    vy = (Math.random() - 0.5) * 160;
    wait = 0.9;
    misread = (Math.random() - 0.5) * 50;
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
      if (c.held.has('KeyW') || c.held.has('ArrowUp')) v -= 460;
      if (c.held.has('KeyS') || c.held.has('ArrowDown')) v += 460;
      you += v * dt;
      if (drag !== null) you += (drag - you) * Math.min(1, dt * 22);
      you = Math.min(H - PH / 2, Math.max(PH / 2, you));
      // Raju follows the ball (once it is past the net), slower than the ball can go, aiming where
      // he misreads it to be.
      const aim = vx > 0 && bx > W * 0.45 ? by + misread : H / 2;
      const rs = 150 + (a + b) * 3;
      raju += Math.max(-rs * dt, Math.min(rs * dt, aim - raju));
      raju = Math.min(H - RH / 2, Math.max(RH / 2, raju));
      // Ball.
      if (wait > 0) wait -= dt;
      else {
        bx += vx * dt;
        by += vy * dt;
        if (by < R) { by = R; vy = Math.abs(vy); c.sound('click'); }
        if (by > H - R) { by = H - R; vy = -Math.abs(vy); c.sound('click'); }
        // Paddles: the further from the middle you hit it, the steeper it goes.
        // Your paddle forgives a few pixels; the steeper your shot, the worse Raju reads it.
        if (vx < 0 && bx - R < 24 + PW && bx > 14 && Math.abs(by - you) < PH / 2 + R + 4) {
          vx = Math.min(MAX, Math.abs(vx) * 1.03);
          vy = Math.max(-1, Math.min(1, (by - you) / (PH / 2))) * 300;
          misread = (Math.random() - 0.5) * (50 + Math.abs(vy) * 0.45);
          c.sound('switch');
        }
        if (vx > 0 && bx + R > W - 24 - PW && bx < W - 18 && Math.abs(by - raju) < RH / 2 + R) {
          vx = -Math.min(MAX, Math.abs(vx) * 1.02);
          vy = ((by - raju) / (RH / 2)) * 190;
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
      g.fillRect(W - 24 - PW, raju - RH / 2, PW, RH);
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
