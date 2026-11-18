// Chiya Rush: Krishna Dai calls out orders; serve each one's items in the order asked.
// Tap the item buttons or press 1 to 4. A wrong item starts that order again. Four orders in
// 50 seconds.

import type { MiniContext, MiniGame, MiniResult } from './types.ts';

export interface ChiyaText {
  items: string[];
  order: string;
  status: string;
  wrong: string;
  ok: string;
  fail: string;
}

export function chiyaRush(text: ChiyaText): MiniGame {
  const LIMIT = 50;
  const NEED = 4;
  let c: MiniContext;
  let ticket: HTMLElement;
  let status: HTMLElement;
  let order: number[] = [];
  let at = 0;
  let served = 0;
  let left = LIMIT;
  let done = false;
  let ok = false;
  let shown = -1;
  const chips: HTMLElement[] = [];
  const newOrder = () => {
    const n = served < 2 ? 3 : 4;
    order = Array.from({ length: n }, () => Math.floor(Math.random() * text.items.length));
    at = 0;
    ticket.replaceChildren();
    chips.length = 0;
    const head = document.createElement('b');
    head.textContent = text.order.replace('{n}', String(served + 1));
    ticket.append(head);
    for (const i of order) {
      const s = document.createElement('span');
      s.textContent = text.items[i];
      chips.push(s);
      ticket.append(s);
    }
  };
  const serve = (i: number) => {
    if (done) return;
    if (order[at] === i) {
      chips[at].classList.add('done');
      at += 1;
      c.sound('pour');
      if (at >= order.length) {
        served += 1;
        c.sound('combo');
        if (served >= NEED) {
          done = true;
          ok = true;
        } else newOrder();
        shown = -1;
      }
    } else {
      c.sound('knock');
      at = 0;
      for (const ch of chips) ch.classList.remove('done');
      ticket.classList.remove('shake');
      void ticket.offsetWidth;
      ticket.classList.add('shake');
    }
  };
  const game: MiniGame = {
    start(ctx) {
      c = ctx;
      ticket = document.createElement('div');
      ticket.className = 'mg-ticket';
      const row = document.createElement('div');
      row.className = 'mg-chiya';
      text.items.forEach((name, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'mg-chiya__item';
        b.innerHTML = `<kbd>${i + 1}</kbd><span></span>`;
        (b.querySelector('span') as HTMLElement).textContent = name;
        b.onclick = () => serve(i);
        row.append(b);
      });
      status = document.createElement('div');
      status.className = 'mg-status';
      ctx.body.append(ticket, row, status);
      newOrder();
    },
    update(dt) {
      if (done) return;
      left -= dt;
      const s = Math.ceil(left);
      if (s !== shown) {
        shown = s;
        status.textContent = text.status.replace('{n}', String(served)).replace('{need}', String(NEED)).replace('{s}', String(Math.max(0, s)));
      }
      if (left <= 0) done = true;
    },
    key(e) {
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (n >= 0) {
        e.preventDefault();
        serve(n);
      }
    },
    get done() {
      return done;
    },
    finish(): MiniResult {
      return { ok, note: ok ? text.ok : text.fail, score: served };
    },
  };
  return game;
}
