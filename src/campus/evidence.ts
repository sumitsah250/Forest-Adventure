// The evidence board (story 2). Three suspects (Raju, Asha, Sunil) with their portraits and every
// clue card found so far, gold or silver, plus a column for clues that point at no one yet.
//
//   openBoard(…, mode 'view')    read-only, from the end of mission 4 and the pause menu
//   openBoard(…, mode 'accuse')  mission 9: pick a suspect, then put one clue card on each of
//                                three questions (drag it, or tap the card then the question; Tab
//                                and Enter work too). Wrong suspect: the clearing cards light up
//                                and it costs 15 minutes. Right suspect, weak card: try again.
//                                Right: red string joins the cards, Sunil's portrait goes cold (C7).

import type { ClueDef, ClueId } from './story.ts';
import type { DialogueHost } from './dialogue.ts';

type Suspect = 'raju' | 'asha' | 'sunil';
const SUSPECTS: Suspect[] = ['raju', 'asha', 'sunil'];

export interface BoardText {
  boardTitle: string;
  boardSub: string;
  boardOther: string;
  boardEmpty: string;
  boardClose: string;
  accuseTitle: string;
  accuseSub: string;
  accusePick: string;
  accuseGo: string;
  accuseWeak: string;
  accuseWrong: string;
  accuseRight: string;
}

export interface BoardOptions {
  clues: ClueDef[];
  state: (id: string) => 'gold' | 'silver' | null;
  name: (id: Suspect) => string;
  portrait: (id: string) => string | null;
  text: BoardText;
  sound: (name: string) => void;
  mode: 'view' | 'accuse';
  /** Accusation data (mode 'accuse'). */
  questions?: { question: string; accepts: ClueId[] }[];
  culprit?: Suspect;
  clearing?: Partial<Record<Suspect, ClueId[]>>;
  /** A wrong suspect was named (main takes the 15 minutes). */
  onWrong?: (s: Suspect) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** Opens the board. Resolves when it is closed (view) or the right accusation is made (accuse). */
export function openBoard(host: DialogueHost, o: BoardOptions): Promise<void> {
  return new Promise((resolve) => {
    const t = o.text;
    const accuse = o.mode === 'accuse';
    const ov = host.open('cq-overlay--board');
    const box = el('div', `cq-board ${accuse ? 'accuse' : ''}`);
    const head = el('div', 'cq-board__head');
    head.append(el('h2', '', accuse ? t.accuseTitle : t.boardTitle), el('p', '', accuse ? t.accuseSub : t.boardSub));
    box.append(head);
    const cols = el('div', 'cq-board__cols');
    const cardEls = new Map<string, HTMLButtonElement>();
    const portraitEls = new Map<Suspect, HTMLElement>();
    let picked: Suspect | null = null;
    let held: string | null = null;
    const found = o.clues.filter((c) => o.state(c.id));
    const column = (key: Suspect | 'other') => {
      const col = el('div', `cq-board__col ${key}`);
      if (key === 'other') col.append(el('div', 'cq-board__who other', t.boardOther));
      else {
        const who = el('button', 'cq-board__who');
        who.type = 'button';
        const url = o.portrait(key);
        if (url) {
          const img = el('img');
          img.src = url;
          img.alt = '';
          who.append(img);
        }
        who.append(el('span', '', o.name(key)));
        who.disabled = !accuse;
        who.onclick = () => pick(key);
        portraitEls.set(key, who);
        col.append(who);
      }
      const list = found.filter((c) => (key === 'other' ? c.pointsTo === 'hoodie' : c.pointsTo === key));
      for (const c of list) {
        const card = el('button', `cq-board__card ${o.state(c.id)}`);
        card.type = 'button';
        card.dataset.id = c.id;
        card.append(el('b', '', c.title), el('span', '', c.text));
        card.onclick = () => grab(c.id);
        card.addEventListener('pointerdown', (e) => startDrag(e, c.id));
        cardEls.set(c.id, card);
        col.append(card);
      }
      if (!list.length) col.append(el('div', 'cq-board__empty', t.boardEmpty));
      cols.append(col);
    };
    for (const s of SUSPECTS) column(s);
    column('other');
    box.append(cols);

    // ------------------------------------------------------------------ accusation
    const slots: (string | null)[] = [null, null, null];
    const slotEls: HTMLButtonElement[] = [];
    const msg = el('div', 'cq-board__msg');
    const go = el('button', 'cq-btn cq-btn--primary', t.accuseGo);
    if (accuse) {
      const qs = el('div', 'cq-board__qs');
      (o.questions ?? []).forEach((q, i) => {
        const slot = el('button', 'cq-board__slot');
        slot.type = 'button';
        slot.append(el('small', '', `${i + 1}. ${q.question}`), el('span', 'cq-board__slotcard', '—'));
        slot.onclick = () => place(i);
        slot.dataset.slot = String(i);
        slotEls.push(slot);
        qs.append(slot);
      });
      msg.textContent = t.accusePick;
      go.disabled = true;
      go.onclick = () => check();
      box.append(qs, msg, go);
    } else {
      const close = el('button', 'cq-btn cq-btn--primary', t.boardClose);
      close.onclick = () => done();
      box.append(close);
    }
    ov.append(box);

    const refresh = () => {
      for (const [id, c] of cardEls) c.classList.toggle('held', id === held);
      slotEls.forEach((s, i) => {
        const id = slots[i];
        (s.querySelector('.cq-board__slotcard') as HTMLElement).textContent = id ? o.clues.find((c) => c.id === id)!.title : '—';
        s.classList.toggle('filled', !!id);
      });
      for (const [s, e] of portraitEls) e.classList.toggle('picked', s === picked);
      go.disabled = !picked || slots.some((x) => !x);
    };
    const pick = (s: Suspect) => {
      if (!accuse) return;
      picked = s;
      o.sound('pin');
      msg.textContent = '';
      for (const c of cardEls.values()) c.classList.remove('clearing');
      refresh();
    };
    const grab = (id: string) => {
      if (!accuse) return;
      held = held === id ? null : id;
      refresh();
    };
    const place = (i: number, id: string | null = held) => {
      if (!accuse || !id) return;
      // A card goes on one question only.
      for (let k = 0; k < slots.length; k += 1) if (slots[k] === id) slots[k] = null;
      slots[i] = id;
      held = null;
      o.sound('pin');
      refresh();
    };
    // Drag a card onto a question (mouse and touch).
    let ghost: HTMLElement | null = null;
    const startDrag = (e: PointerEvent, id: string) => {
      if (!accuse) return;
      const from = e.currentTarget as HTMLElement;
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      const move = (m: PointerEvent) => {
        if (!moved && Math.hypot(m.clientX - sx, m.clientY - sy) < 8) return;
        if (!moved) {
          moved = true;
          ghost = from.cloneNode(true) as HTMLElement;
          ghost.classList.add('ghost');
          ov.append(ghost);
          o.sound('string');
        }
        ghost!.style.transform = `translate(${m.clientX - 60}px, ${m.clientY - 24}px)`;
      };
      const up = (u: PointerEvent) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!moved) return;
        ghost?.remove();
        ghost = null;
        const under = document.elementFromPoint(u.clientX, u.clientY)?.closest('[data-slot]') as HTMLElement | null;
        if (under) place(Number(under.dataset.slot), id);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    const check = () => {
      if (!picked || slots.some((x) => !x)) return;
      for (const c of cardEls.values()) c.classList.remove('clearing');
      if (picked !== o.culprit) {
        // Wrong person: the cards that clear them light up.
        for (const id of o.clearing?.[picked] ?? []) cardEls.get(id)?.classList.add('clearing');
        msg.textContent = t.accuseWrong.replace('{name}', o.name(picked));
        o.sound('tickBack');
        o.onWrong?.(picked);
        picked = null;
        refresh();
        return;
      }
      const ok = (o.questions ?? []).every((q, i) => q.accepts.includes(slots[i] as ClueId));
      if (!ok) {
        msg.textContent = t.accuseWeak;
        o.sound('knock');
        return;
      }
      // Right: red string from Sunil to the three cards, then his portrait goes cold (C7).
      msg.textContent = t.accuseRight;
      o.sound('chord');
      box.classList.add('solved');
      go.disabled = true;
      host.keyHandler = null;
      drawString();
      window.setTimeout(() => portraitEls.get(o.culprit!)?.classList.add('cold'), 1600);
      window.setTimeout(done, 5200);
    };
    const drawString = () => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'cq-board__string');
      const r0 = box.getBoundingClientRect();
      svg.setAttribute('viewBox', `0 0 ${r0.width} ${r0.height}`);
      const from = portraitEls.get(o.culprit!)!.getBoundingClientRect();
      const fx = from.left + from.width / 2 - r0.left;
      const fy = from.top + from.height / 2 - r0.top;
      slotEls.forEach((s, i) => {
        const r = s.getBoundingClientRect();
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const tx = r.left + r.width / 2 - r0.left;
        const ty = r.top + 10 - r0.top;
        line.setAttribute('d', `M${fx} ${fy} Q ${(fx + tx) / 2} ${Math.max(fy, ty) + 40} ${tx} ${ty}`);
        line.style.animationDelay = `${i * 0.35}s`;
        svg.append(line);
      });
      box.append(svg);
    };
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      host.close();
      resolve();
    };
    host.keyHandler = (e) => {
      if (!accuse && (e.code === 'Escape' || e.code === 'KeyB')) done();
      // Accuse: Tab moves between suspects, cards and questions; Enter or Space presses (buttons do that already).
    };
    refresh();
  });
}
