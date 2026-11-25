// Dialogue and radio (docs/STORY_V2.md, section 6): subtitle cards with the speaker's name and
// portrait, a typewriter effect, and tap (or E / Space / Enter) to advance.
//
//   talk      a person in front of you: portrait, name plate, role
//   radio     someone on the radio: the same card with a radio badge; every line goes in the radio log
//   mitra     the campus AI: monospace, cyan before the reboot and warm white after, a chirp before each line
//   document  a register, a log, a note: a paper card titled with the document's name
//
// Also here: the timed subtitle strip that cutscenes use, and the radio log screen.
//
// The typewriter does not build strings per frame: a line's characters are laid out once, hidden,
// and switched on one by one, which also stops the text from re-wrapping as it appears.

export interface DialogueHost {
  open(cls: string): HTMLDivElement;
  close(): void;
  keyHandler: ((e: KeyboardEvent) => void) | null;
}

export interface DialogueDeps {
  sound(name: string, gain?: number): void;
  /** A portrait image (data URL) for a cast id, or null to show initials. */
  portrait(id: string): string | null;
  /** Fills {name} and {roll} with what the player typed. */
  fill(text: string): string;
  /** True once MITRA has been rebooted (warm white instead of cyan). */
  mitraWarm(): boolean;
  /** A line heard over the radio or a speaker, for the radio log. */
  log(who: string, text: string): void;
}

export interface Speaker {
  /** Cast id (for the portrait and MITRA's style). Documents have none. */
  id?: string;
  name: string;
  /** Shown beside the name. 'on the radio' and 'document' pick those card styles. */
  role: string;
}

const CONFIRM = ['KeyE', 'Enter', 'Space', 'NumpadEnter'];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};

function kindOf(s: Speaker): 'mitra' | 'radio' | 'document' | 'talk' {
  if (s.id === 'mitra' || s.name === 'MITRA') return 'mitra';
  if (s.role === 'document') return 'document';
  if (s.role === 'on the radio') return 'radio';
  return 'talk';
}

function initials(name: string): string {
  return name.replace(/^(Dr|Er|Ms|Mr|Prof)\.\s*/, '').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

function hashOf(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** The portrait box: a face if there is one, MITRA's eye, a page for documents, initials otherwise. */
function faceInto(face: HTMLElement, s: Speaker, kind: string, deps: DialogueDeps): void {
  face.textContent = '';
  if (kind === 'mitra') {
    face.append(el('i', 'cq-eye'));
    return;
  }
  if (kind === 'document') {
    const page = el('span');
    page.textContent = '📄';
    face.append(page);
    return;
  }
  const url = s.id ? deps.portrait(s.id) : null;
  if (url) {
    const img = el('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    face.append(img);
  } else {
    const span = el('span');
    span.textContent = initials(s.name);
    face.append(span);
  }
  if (kind === 'radio') {
    const badge = el('b', 'cq-talk__radio');
    badge.textContent = '📻';
    face.append(badge);
  }
}

/** Shows `lines` one card at a time. Resolves when the last card is dismissed. */
export function runDialogue(host: DialogueHost, deps: DialogueDeps, speaker: Speaker, lines: string[]): Promise<void> {
  return new Promise((resolve) => {
    if (!lines.length) return resolve();
    const o = host.open('cq-overlay--dialog');
    const kind = kindOf(speaker);
    const h = hashOf(speaker.name);
    const pitch = 0.25 + ((h >> 8) % 70) / 100;
    const speed = kind === 'mitra' ? 44 : kind === 'document' ? 80 : 58;
    const box = el('div', `cq-dialog cq-talk ${kind === 'talk' ? '' : kind}${kind === 'mitra' && deps.mitraWarm() ? ' warm' : ''}`);
    box.style.setProperty('--hue', String(h % 360));
    const face = el('div', 'cq-talk__face');
    faceInto(face, speaker, kind, deps);
    const body = el('div', 'cq-talk__body');
    const plate = el('div', 'cq-talk__name');
    plate.textContent = speaker.name;
    if (speaker.role && kind !== 'document') {
      const small = el('small');
      small.textContent = speaker.role;
      plate.append(small);
    }
    const text = el('div', 'cq-talk__text');
    const foot = el('div', 'cq-talk__foot');
    const pips = el('span', 'cq-talk__pips');
    const next = el('span', 'cq-talk__next');
    next.textContent = '▼';
    foot.append(pips, next);
    body.append(plate, text, foot);
    box.append(face, body);
    o.append(box);
    const pipEls: HTMLElement[] = [];
    if (lines.length > 1) {
      for (let k = 0; k < lines.length; k += 1) {
        const p = el('i');
        pips.append(p);
        pipEls.push(p);
      }
    }
    const filled = lines.map((l) => deps.fill(l));
    let chars: HTMLSpanElement[] = [];
    let i = 0;
    let shown = 0;
    let on = 0;
    let raf = 0;
    let last = 0;
    const full = () => on >= chars.length;
    const voiced = kind === 'talk' || kind === 'radio';
    const reveal = (n: number, typing = false) => {
      const to = Math.min(chars.length, n);
      for (; on < to; on += 1) {
        chars[on].className = 'on';
        // Voice blips while typing only (not when a tap shows the rest of the line at once).
        if (typing && voiced && on % 4 === 0 && chars[on].textContent !== ' ') deps.sound('blip', pitch);
      }
      if (full()) box.classList.remove('typing');
    };
    const type = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      shown += dt * speed;
      reveal(Math.floor(shown), true);
      if (!full() && o.isConnected) raf = requestAnimationFrame(type);
    };
    const show = () => {
      // Lay the whole line out hidden, one element per character (once per card, not per frame).
      text.textContent = '';
      chars = [];
      const frag = document.createDocumentFragment();
      for (const ch of filled[i]) {
        const sp = document.createElement('span');
        sp.textContent = ch;
        frag.append(sp);
        chars.push(sp);
      }
      text.append(frag);
      shown = 0;
      on = 0;
      last = performance.now();
      pipEls.forEach((p, k) => p.classList.toggle('on', k <= i));
      box.classList.remove('pop');
      void box.offsetWidth;
      box.classList.add('pop', 'typing');
      if (kind === 'mitra') deps.sound('chirp');
      if (kind === 'mitra' || kind === 'radio') deps.log(speaker.name, filled[i]);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(type);
    };
    const advance = () => {
      if (!full()) {
        reveal(chars.length);
        return;
      }
      deps.sound('click');
      i += 1;
      if (i >= lines.length) {
        cancelAnimationFrame(raf);
        host.close();
        resolve();
      } else show();
    };
    box.onclick = advance;
    host.keyHandler = (e) => {
      if (e.repeat) return;
      if (CONFIRM.includes(e.code)) {
        e.preventDefault();
        advance();
      }
    };
    show();
  });
}

/** The strip of text cutscenes use: a speaker and a line, shown until told otherwise. */
export class Subtitles {
  private box: HTMLDivElement;
  private who: HTMLElement;
  private text: HTMLElement;

  private deps: DialogueDeps;
  private nameOf: (id: string) => string;

  constructor(root: HTMLElement, deps: DialogueDeps, nameOf: (id: string) => string) {
    this.deps = deps;
    this.nameOf = nameOf;
    this.box = el('div', 'cq-subtitle');
    this.who = el('b');
    this.text = el('span');
    this.box.append(this.who, this.text);
    root.append(this.box);
  }

  /** Shows a line (null hides the strip). */
  show(who: string | null, text: string): void {
    if (!who) {
      this.box.classList.remove('on');
      return;
    }
    const mitra = who === 'mitra';
    this.who.textContent = this.nameOf(who);
    this.text.textContent = this.deps.fill(text);
    this.box.className = `cq-subtitle on${mitra ? ' mitra' : ''}${mitra && this.deps.mitraWarm() ? ' warm' : ''}`;
    if (mitra) this.deps.sound('chirp');
  }
}

export interface RadioLogEntry {
  /** Mission title it was heard in. */
  m: string;
  who: string;
  text: string;
  /** A clue this line can prove when pinned to the board (Sumit's "6:55": c2). */
  clue?: string;
  /** Pinned to the board already. */
  pinned?: boolean;
}

/** Pin buttons on each line (story 2): `onPin` answers with a message to show. */
export interface PinOptions {
  label: string;
  done: string;
  onPin: (e: RadioLogEntry) => string;
}

/** Every line heard over the radio so far, newest mission first, to read again. */
export function openRadioLog(host: DialogueHost, entries: RadioLogEntry[], onClose: () => void, pin?: PinOptions): void {
  const ov = host.open('cq-overlay--pause');
  const box = el('div', 'cq-panel cq-radiolog');
  const head = el('div', 'cq-panel__head');
  const h2 = el('h2');
  h2.textContent = 'Radio log';
  const count = el('span');
  count.textContent = `${entries.length} lines`;
  head.append(h2, count);
  box.append(head);
  const list = el('div', 'cq-radiolog__list');
  if (!entries.length) {
    const empty = el('p', 'cq-radiolog__empty');
    empty.textContent = 'Nothing yet. Everything said over the radio is kept here.';
    list.append(empty);
  }
  let mission = '';
  for (let k = entries.length - 1; k >= 0; k -= 1) {
    const e = entries[k];
    // Entries are stored oldest first; show whole missions newest first, lines in order.
    let start = k;
    while (start > 0 && entries[start - 1].m === e.m) start -= 1;
    if (e.m !== mission) {
      mission = e.m;
      const h3 = el('h3');
      h3.textContent = e.m || 'Free roam';
      list.append(h3);
    }
    for (let j = start; j <= k; j += 1) {
      const row = el('div', `cq-radiolog__row${entries[j].who === 'MITRA' ? ' mitra' : ''}`);
      const who = el('b');
      who.textContent = entries[j].who;
      const text = el('span');
      text.textContent = entries[j].text;
      row.append(who, text);
      if (pin) {
        const entry = entries[j];
        const b = el('button', 'cq-radiolog__pin');
        b.type = 'button';
        b.textContent = entry.pinned ? pin.done : pin.label;
        b.disabled = !!entry.pinned;
        const note = el('small', 'cq-radiolog__note');
        b.onclick = () => {
          note.textContent = pin.onPin(entry);
          if (entry.pinned) {
            b.textContent = pin.done;
            b.disabled = true;
          }
        };
        row.append(b, note);
      }
      list.append(row);
    }
    k = start;
  }
  const close = el('button', 'cq-btn cq-btn--primary');
  close.innerHTML = 'Back <kbd>Esc</kbd>';
  close.onclick = onClose;
  box.append(list, close);
  ov.append(box);
  host.keyHandler = (e) => {
    if (e.code === 'Escape' || e.code === 'KeyL') onClose();
  };
}
