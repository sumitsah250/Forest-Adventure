// Bug Hunt: six lines of C with one bug; tap the line (or press 1 to 6) within 30 seconds.

import type { MiniContext, MiniGame, MiniResult } from './types.ts';

export interface BugText {
  status: string;
  ok: string;
  fail: string;
  wrong: string;
}

export function bugHunt(snippet: { lines: string[]; bug: number; why: string }, text: BugText): MiniGame {
  const LIMIT = 30;
  let c: MiniContext;
  let status: HTMLElement;
  let left = LIMIT;
  let done = false;
  let ok = false;
  let picked = -1;
  let shown = -1;
  const rows: HTMLButtonElement[] = [];
  const pick = (i: number) => {
    if (done || i < 0 || i >= rows.length) return;
    picked = i;
    done = true;
    ok = i === snippet.bug;
    rows[snippet.bug].classList.add('right');
    if (!ok) rows[i].classList.add('wrong');
    c.sound(ok ? 'clue' : 'knock');
  };
  const game: MiniGame = {
    start(ctx) {
      c = ctx;
      const code = document.createElement('div');
      code.className = 'mg-code';
      snippet.lines.forEach((line, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mg-line';
        b.innerHTML = `<kbd>${i + 1}</kbd><code></code>`;
        (b.querySelector('code') as HTMLElement).textContent = line;
        b.onclick = () => pick(i);
        rows.push(b);
        code.append(b);
      });
      status = document.createElement('div');
      status.className = 'mg-status';
      ctx.body.append(code, status);
    },
    update(dt) {
      if (done) return;
      left -= dt;
      const s = Math.ceil(left);
      if (s !== shown) {
        shown = s;
        status.textContent = text.status.replace('{s}', String(Math.max(0, s)));
      }
      if (left <= 0) {
        done = true;
        rows[snippet.bug].classList.add('right');
      }
    },
    key(e) {
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
      if (n >= 0) {
        e.preventDefault();
        pick(n);
      }
    },
    get done() {
      return done;
    },
    finish(): MiniResult {
      const line = String(snippet.bug + 1);
      if (ok) return { ok, note: `${text.ok.replace('{s}', String(Math.round(LIMIT - left)))} ${snippet.why}`, score: Math.round(left) };
      return { ok, note: `${(picked >= 0 ? text.wrong : text.fail).replace('{n}', line)} ${snippet.why}`, score: 0 };
    },
  };
  return game;
}
