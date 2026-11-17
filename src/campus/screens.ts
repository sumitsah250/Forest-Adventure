// Story 2 screens outside the missions:
//   nameEntry    name and roll number (first launch, and from the title menu); the first tap unlocks audio
//   LocationCard "7:50 PM, CAFETERIA" typed on at a mission start, gone after 2.5 s
//   leaderboard  the fest demo's 10 best escape times (localStorage), with a staff reset
//
// Every word comes from story/v2/text.ts (T.screens). Touch and keyboard both work everywhere.

import type { DialogueHost } from './dialogue.ts';

type ScreenText = {
  nameTitle: string; nameSub: string; nameLabel: string; namePlaceholder: string; rollLabel: string; rollPlaceholder: string;
  nameStart: string; nameSave: string; nameNeeded: string;
  demoBoard: string; demoBoardSub: string; demoYourTime: string; demoNext: string; demoEmpty: string; demoReset: string; demoHint: string;
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export function clockText(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// ------------------------------------------------------------------ name entry

/**
 * Asks for the player's name and roll number. `first`: the very first screen of a new game
 * (no Cancel). `onTap` runs on the first press of the button (a user gesture: audio starts there).
 */
export function nameEntry(host: DialogueHost, t: ScreenText, o: { name: string; roll: string; first: boolean; onTap?: () => void }): Promise<{ name: string; roll: string } | null> {
  return new Promise((resolve) => {
    const ov = host.open('cq-overlay--name');
    const box = el('form', 'cq-name');
    box.noValidate = true;
    box.append(el('h2', '', t.nameTitle), el('p', 'cq-name__sub', t.nameSub));
    const field = (label: string, value: string, placeholder: string, max: number, cls: string) => {
      const wrap = el('label', `cq-name__field ${cls}`);
      wrap.append(el('span', '', label));
      const input = el('input');
      input.type = 'text';
      input.value = value;
      input.placeholder = placeholder;
      input.maxLength = max;
      input.autocomplete = 'off';
      input.spellcheck = false;
      wrap.append(input);
      box.append(wrap);
      return input;
    };
    const name = field(t.nameLabel, o.name, t.namePlaceholder, 24, '');
    const roll = field(t.rollLabel, o.roll, t.rollPlaceholder, 16, 'roll');
    roll.autocapitalize = 'characters';
    const err = el('div', 'cq-name__err');
    const go = el('button', 'cq-btn cq-btn--primary', o.first ? t.nameStart : t.nameSave);
    go.type = 'submit';
    box.append(err, go);
    ov.append(box);
    let tapped = false;
    const submit = () => {
      if (!tapped) {
        tapped = true;
        o.onTap?.();
      }
      const n = name.value.trim().replace(/\s+/g, ' ');
      if (!n) {
        err.textContent = t.nameNeeded;
        name.focus();
        return;
      }
      host.close();
      resolve({ name: n, roll: roll.value.trim().toUpperCase() });
    };
    box.onsubmit = (e) => {
      e.preventDefault();
      submit();
    };
    host.keyHandler = (e) => {
      if (e.code === 'Escape' && !o.first) {
        host.close();
        resolve(null);
      }
    };
    // Focus the empty field (no on-screen keyboard pops up on phones until it is tapped).
    if (!matchMedia('(pointer: coarse)').matches) window.setTimeout(() => (name.value ? roll : name).focus(), 60);
  });
}

// ------------------------------------------------------------------ location card

/** "7:50 PM, CAFETERIA", typed on letter by letter (a timer per letter, not per frame), held, then faded. */
export class LocationCard {
  private box: HTMLDivElement;
  private text: HTMLSpanElement;
  private timers: number[] = [];

  constructor(root: HTMLElement) {
    this.box = el('div', 'cq-loc');
    this.text = el('span');
    this.box.append(this.text, el('i', 'cq-loc__caret'));
    root.append(this.box);
  }

  show(clock: string, place: string): void {
    const text = `${clock}, ${place.toUpperCase()}`;
    for (const t of this.timers) clearTimeout(t);
    this.timers.length = 0;
    this.text.textContent = '';
    this.box.classList.remove('out');
    this.box.classList.add('on');
    const step = Math.min(45, 1100 / Math.max(1, text.length));
    for (let i = 1; i <= text.length; i += 1) this.timers.push(window.setTimeout(() => (this.text.textContent = text.slice(0, i)), i * step));
    // On screen for 2.5 s in all, then gone.
    this.timers.push(window.setTimeout(() => this.box.classList.add('out'), 2100));
    this.timers.push(window.setTimeout(() => this.box.classList.remove('on', 'out'), 2500));
  }
}

// ------------------------------------------------------------------ fest demo leaderboard

const BOARD_KEY = 'campus-demo-leaderboard-v1';

export interface BoardEntry {
  name: string;
  roll: string;
  /** Escape time in seconds (mission 1's play time). */
  time: number;
}

export function loadBoard(): BoardEntry[] {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    const list = raw ? (JSON.parse(raw) as BoardEntry[]) : [];
    return Array.isArray(list) ? list.filter((e) => typeof e.time === 'number').slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveBoard(list: BoardEntry[]): void {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(list));
  } catch {
    /* no storage: the board lasts for this session */
  }
}

/** Adds a time; returns its place in the top 10 (0-based), or -1 if it did not make it. */
export function addToBoard(e: BoardEntry): number {
  const list = loadBoard();
  list.push(e);
  list.sort((a, b) => a.time - b.time);
  const at = list.indexOf(e);
  saveBoard(list.slice(0, 10));
  return at < 10 ? at : -1;
}

/**
 * Shows the leaderboard. Resolves 'next' on the button (or Enter), 'idle' after `idleMs` with
 * no input. Holding the title for 3 seconds (or holding Delete) clears the board.
 */
export function leaderboard(host: DialogueHost, t: ScreenText, o: { highlight: number; yourTime: number | null; idleMs: number }): Promise<'next' | 'idle'> {
  return new Promise((resolve) => {
    const ov = host.open('cq-overlay--name');
    const box = el('div', 'cq-board-demo');
    const title = el('h2', 'cq-board-demo__title', t.demoBoard);
    const ring = el('i', 'cq-board-demo__hold');
    title.append(ring);
    box.append(title, el('p', 'cq-name__sub', t.demoBoardSub));
    if (o.yourTime !== null) box.append(el('div', 'cq-board-demo__you', t.demoYourTime.replace('{time}', clockText(o.yourTime))));
    const list = el('ol', 'cq-board-demo__list');
    const render = (highlight: number) => {
      list.textContent = '';
      const rows = loadBoard();
      if (!rows.length) list.append(el('li', 'empty', t.demoEmpty));
      rows.forEach((r, i) => {
        const li = el('li', i === highlight ? 'me' : '');
        li.append(el('b', '', String(i + 1)), el('span', '', r.name), el('small', '', r.roll), el('em', '', clockText(r.time)));
        list.append(li);
      });
    };
    render(o.highlight);
    const next = el('button', 'cq-btn cq-btn--primary', t.demoNext);
    box.append(list, next, el('p', 'cq-board-demo__hint', t.demoHint));
    ov.append(box);
    let done = false;
    let idle = 0;
    const finish = (v: 'next' | 'idle') => {
      if (done) return;
      done = true;
      clearTimeout(idle);
      clearTimeout(hold);
      host.close();
      resolve(v);
    };
    const poke = () => {
      clearTimeout(idle);
      idle = window.setTimeout(() => finish('idle'), o.idleMs);
    };
    // Staff reset: hold the title (or Delete) for 3 seconds.
    let hold = 0;
    const startHold = () => {
      clearTimeout(hold);
      title.classList.add('holding');
      hold = window.setTimeout(() => {
        title.classList.remove('holding');
        saveBoard([]);
        render(-1);
        box.querySelector('.cq-board-demo__you')?.remove();
        title.dataset.msg = t.demoReset;
      }, 3000);
    };
    const stopHold = () => {
      clearTimeout(hold);
      title.classList.remove('holding');
    };
    title.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      startHold();
    });
    title.addEventListener('pointerup', stopHold);
    title.addEventListener('pointerleave', stopHold);
    title.addEventListener('pointercancel', stopHold);
    ov.addEventListener('pointerdown', poke);
    ov.addEventListener('pointermove', poke);
    next.onclick = () => finish('next');
    host.keyHandler = (e) => {
      poke();
      if (e.code === 'Delete') {
        if (!e.repeat) startHold();
      } else if ((e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') && !e.repeat) {
        e.preventDefault();
        finish('next');
      }
    };
    window.addEventListener('keyup', function up(e) {
      if (e.code === 'Delete') stopHold();
      if (done) window.removeEventListener('keyup', up);
    });
    poke();
  });
}
