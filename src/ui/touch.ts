// Touch controls for tablets/phones. A floating joystick appears wherever the
// left thumb lands (push past the ring to sprint); the right side is a
// drag-to-look surface with a context-sensitive thumb cluster that changes
// between on foot, armed and driving. Interactions pop up as a labelled
// button only when something is in reach.

import type { Input, Action } from '../core/input.ts';
import { el } from './hud.ts';

export interface TouchContext {
  mode: 'foot' | 'vehicle';
  /** Interaction in reach (on foot), with hold progress 0..1. */
  prompt: { text: string; progress: number } | null;
  /** Scripted radio call available (vehicle). */
  radio: string | null;
  /** Owns at least one weapon (on foot). */
  armed: boolean;
  /** Weapon out of the holster. */
  drawn: boolean;
  needsRecovery: boolean;
  flashlight: boolean;
  lights: boolean;
}

type ButtonId =
  | 'jump' | 'crouch' | 'draw' | 'fire' | 'aim' | 'reload' | 'swap' | 'holster'
  | 'brake' | 'lights' | 'camera' | 'recover' | 'exit';

/** Button centre measured from the bottom-right anchor, and diameter (px). */
type Slot = [x: number, y: number, size: number];

const LAYOUTS: Record<string, Partial<Record<ButtonId, Slot>>> = {
  foot: { jump: [62, 64, 78], crouch: [174, 44, 58] },
  footArmed: { jump: [62, 64, 78], crouch: [174, 44, 58], draw: [154, 150, 56] },
  footDrawn: {
    fire: [66, 70, 88], aim: [176, 46, 60], reload: [160, 140, 52], jump: [62, 178, 54],
    crouch: [238, 34, 46], swap: [240, 108, 44], holster: [132, 222, 42],
  },
  vehicle: { brake: [64, 70, 86], lights: [180, 48, 56], camera: [164, 152, 52], exit: [64, 182, 52] },
  vehicleStuck: { brake: [64, 70, 86], lights: [180, 48, 56], camera: [164, 152, 52], exit: [250, 40, 48], recover: [64, 190, 64] },
};

const ICONS: Record<string, string> = {
  jump: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  crouch: '<path d="M12 4v10M7 10l5 5 5-5M5 20h14"/>',
  draw: '<path d="M3 7h17v4h-8l-1.4 7H6.4L7.6 11H3z"/>',
  holster: '<path d="M3 7h17v4h-8l-1.4 7H6.4L7.6 11H3z"/><path d="M3 21 21 3"/>',
  fire: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/>',
  aim: '<circle cx="12" cy="12" r="7"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  swap: '<path d="M4 8h15l-4-4M20 16H5l4 4"/>',
  brake: '<circle cx="12" cy="12" r="6"/><path d="M5 5.5a9.5 9.5 0 0 0 0 13M19 5.5a9.5 9.5 0 0 1 0 13M12 9v3.5M12 15v.01"/>',
  lights: '<path d="M11 5.5C6.5 5.5 4 8.5 4 12s2.5 6.5 7 6.5z"/><path d="M15 8h6M15 12h6M15 16h6"/>',
  camera: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  recover: '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>',
  hand: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5M11 10.5V4.5a1.5 1.5 0 0 1 3 0v6M14 10.5V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7c-2.2 0-3.8-1-5-2.8L2.6 13.4a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
  exit: '<path d="M14 4H5v16h9"/><path d="M10 12h11M17 8l4 4-4 4"/>',
  radio: '<rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="m7 9 10-5"/><circle cx="9" cy="14.5" r="2"/><path d="M14 13h3M14 16h3"/>',
  torch: '<path d="M7 3h10l-2 6v11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1V9z"/><path d="M7 7h10M12 13v2.5"/>',
  journal: '<path d="M5 4.5h11a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  hint: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.5M12 17v.01"/>',
};

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
}

function buzz(ms = 8): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

export class TouchControls {
  readonly root: HTMLDivElement;
  private input: Input;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private stickCenter = { x: 0, y: 0 };
  private lookId: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private sprinting = false;
  private buttons = new Map<ButtonId, HTMLButtonElement>();
  /** Actions currently held by a touch button, released on hide. */
  private held = new Set<string>();
  private toggles = { aim: false, crouch: false };
  private layoutKey = '';
  private ctx: TouchContext | null = null;
  private useBtn: HTMLButtonElement;
  private useText: HTMLSpanElement;
  private useIcon: HTMLSpanElement;
  private useRing: SVGCircleElement;
  private useKey = '';
  private useProgress = -1;
  private radioBtn: HTMLButtonElement;
  private radioText: HTMLSpanElement;
  private torchBtn: HTMLButtonElement;

  constructor(parent: HTMLElement, input: Input, onMenu: (which: 'pause' | 'journal' | 'map') => void) {
    this.input = input;
    this.root = el('div', 'touch');
    parent.appendChild(this.root);

    // Look surface under everything; the move zone sits over its lower left.
    const lookPad = el('div', 'touch-look');
    const moveZone = el('div', 'touch-move');
    this.stick = el('div', 'touch-stick');
    this.knob = el('div', 'touch-knob');
    const sprintTip = el('div', 'touch-sprint');
    sprintTip.innerHTML = icon('jump');
    this.stick.append(this.knob, sprintTip);
    this.root.append(lookPad, moveZone, this.stick);

    moveZone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault();
      this.stickId = e.pointerId;
      moveZone.setPointerCapture(e.pointerId);
      // Float the stick to the thumb, kept fully on screen.
      const r = this.stick.offsetWidth / 2;
      const restX = this.stick.offsetLeft + r;
      const restY = this.stick.offsetTop + r;
      const cx = Math.max(r + 6, Math.min(innerWidth * 0.5, e.clientX));
      const cy = Math.max(r + 6, Math.min(innerHeight - r - 6, e.clientY));
      this.stickCenter = { x: cx, y: cy };
      this.stick.classList.add('active');
      this.stick.style.transform = `translate(${cx - restX}px, ${cy - restY}px)`;
      this.moveStick(e.clientX, e.clientY);
    });
    moveZone.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.resetStick();
    };
    moveZone.addEventListener('pointerup', endStick);
    moveZone.addEventListener('pointercancel', endStick);
    moveZone.addEventListener('lostpointercapture', endStick);

    this.bindLook(lookPad);

    // Right-thumb cluster.
    const cluster = el('div', 'touch-cluster');
    const make = (id: ButtonId, label: string, action: Action, kind: 'hold' | 'toggle' = 'hold') => {
      const b = el('button', `tc-btn tc-${id}`) as unknown as HTMLButtonElement;
      b.innerHTML = `${icon(id)}<span>${label}</span>`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        buzz(id === 'fire' ? 12 : 8);
        if (kind === 'toggle') {
          const key = id as 'aim' | 'crouch';
          this.setToggle(key, !this.toggles[key]);
          return;
        }
        this.press(action);
      });
      const up = () => {
        b.classList.remove('down');
        if (kind === 'hold') this.release(action);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      cluster.appendChild(b);
      this.buttons.set(id, b);
      return b;
    };
    make('jump', 'Jump', 'jump');
    make('crouch', 'Crouch', 'crouch', 'toggle');
    make('draw', 'Draw', 'holster');
    const fire = make('fire', 'Fire', 'fire');
    make('aim', 'Aim', 'aim', 'toggle');
    make('reload', 'Reload', 'reload');
    make('swap', 'Swap', 'nextWeapon');
    make('holster', 'Holster', 'holster');
    make('brake', 'Brake', 'handbrake');
    make('lights', 'Lights', 'lights');
    make('camera', 'View', 'camera');
    make('recover', 'Recover', 'recover');
    make('exit', 'Exit', 'interact');
    // Dragging off the fire button keeps shooting and steers the aim.
    let fireLast: { x: number; y: number } | null = null;
    fire.addEventListener('pointerdown', (e) => (fireLast = { x: e.clientX, y: e.clientY }));
    fire.addEventListener('pointermove', (e) => {
      if (!fireLast) return;
      input.addTouchLook((e.clientX - fireLast.x) * 1.6, (e.clientY - fireLast.y) * 1.6);
      fireLast = { x: e.clientX, y: e.clientY };
    });
    const fireEnd = () => (fireLast = null);
    fire.addEventListener('pointerup', fireEnd);
    fire.addEventListener('lostpointercapture', fireEnd);

    // Context actions: appear only when available.
    const context = el('div', 'touch-context');
    const pill = (cls: string, action: Action): [HTMLButtonElement, HTMLSpanElement, HTMLSpanElement] => {
      const b = el('button', `tc-pill ${cls}`) as unknown as HTMLButtonElement;
      const ic = el('span', 'tc-pill-icon') as HTMLSpanElement;
      const tx = el('span', 'tc-pill-text') as HTMLSpanElement;
      b.append(ic, tx);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.setPointerCapture(e.pointerId);
        b.classList.add('down');
        buzz(10);
        this.press(action);
      });
      const up = () => {
        b.classList.remove('down');
        this.release(action);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      context.appendChild(b);
      return [b, ic, tx];
    };
    [this.radioBtn, , this.radioText] = pill('tc-radio', 'radio');
    this.radioBtn.querySelector('.tc-pill-icon')!.innerHTML = icon('radio');
    [this.useBtn, this.useIcon, this.useText] = pill('tc-use', 'interact');
    this.useIcon.innerHTML = icon('hand');
    const ns = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(ns, 'svg');
    ring.setAttribute('viewBox', '0 0 44 44');
    ring.classList.add('tc-ring');
    this.useRing = document.createElementNS(ns, 'circle');
    this.useRing.setAttribute('cx', '22');
    this.useRing.setAttribute('cy', '22');
    this.useRing.setAttribute('r', '20');
    ring.appendChild(this.useRing);
    this.useBtn.insertBefore(ring, this.useIcon);

    // Utility row, top right.
    const menus = el('div', 'touch-menus');
    const util = (name: string, label: string, onTap: () => void) => {
      const b = el('button', 'tc-util') as unknown as HTMLButtonElement;
      b.innerHTML = icon(name);
      b.setAttribute('aria-label', label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        buzz(6);
        onTap();
      });
      menus.appendChild(b);
      return b;
    };
    this.torchBtn = util('torch', 'Flashlight', () => {
      this.press('flashlight');
      this.release('flashlight');
    });
    util('hint', 'Hint', () => {
      this.press('hint');
      this.release('hint');
    });
    util('journal', 'Journal', () => onMenu('journal'));
    util('map', 'Map', () => onMenu('map'));
    util('pause', 'Pause', () => onMenu('pause'));

    const rotate = el('div', 'touch-rotate');
    rotate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M20.5 9a8 8 0 0 1 0 6M3.5 15a8 8 0 0 1 0-6"/></svg><div>Rotate your phone</div><small>Hollow Creek plays in landscape</small>';

    this.root.append(cluster, context, menus, rotate);
    this.update({ mode: 'foot', prompt: null, radio: null, armed: false, drawn: false, needsRecovery: false, flashlight: false, lights: false });
  }

  private bindLook(pad: HTMLElement): void {
    pad.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      pad.setPointerCapture(e.pointerId);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      this.input.addTouchLook((e.clientX - this.lookLast.x) * 1.6, (e.clientY - this.lookLast.y) * 1.6);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    pad.addEventListener('lostpointercapture', end);
  }

  private moveStick(x: number, y: number): void {
    const max = 56;
    let dx = x - this.stickCenter.x;
    let dy = y - this.stickCenter.y;
    const raw = Math.hypot(dx, dy);
    if (raw > max) {
      dx = (dx / raw) * max;
      dy = (dy / raw) * max;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    // Small radial dead zone, rescaled so motion starts smoothly.
    const n = Math.min(1, raw / max);
    const mag = n < 0.12 ? 0 : (n - 0.12) / 0.88;
    const len = Math.max(raw, 1e-6);
    this.input.touchMove.x = ((x - this.stickCenter.x) / len) * mag;
    this.input.touchMove.y = (-(y - this.stickCenter.y) / len) * mag;
    // Pushing the thumb past the ring sprints.
    const sprint = this.ctx?.mode !== 'vehicle' && raw > max * 1.2;
    if (sprint !== this.sprinting) {
      this.sprinting = sprint;
      this.stick.classList.toggle('sprint', sprint);
      if (sprint) {
        buzz(14);
        this.press('sprint');
      } else this.release('sprint');
    }
  }

  private resetStick(): void {
    this.stickId = null;
    this.input.touchMove.x = 0;
    this.input.touchMove.y = 0;
    this.knob.style.transform = 'translate(-50%, -50%)';
    this.stick.style.transform = '';
    this.stick.classList.remove('active', 'sprint');
    if (this.sprinting) this.release('sprint');
    this.sprinting = false;
  }

  private press(action: string): void {
    this.held.add(action);
    this.input.setTouchButton(action, true);
  }

  private release(action: string): void {
    this.held.delete(action);
    this.input.setTouchButton(action, false);
  }

  private setToggle(key: 'aim' | 'crouch', on: boolean): void {
    if (this.toggles[key] === on) return;
    this.toggles[key] = on;
    this.buttons.get(key)?.classList.toggle('on', on);
    if (on) this.press(key);
    else this.release(key);
  }

  /** Called every frame with the game state; only touches the DOM on change. */
  update(ctx: TouchContext): void {
    this.ctx = ctx;
    const onFoot = ctx.mode === 'foot';
    if (!ctx.drawn || !onFoot) this.setToggle('aim', false);
    if (!onFoot) this.setToggle('crouch', false);
    const key = !onFoot
      ? ctx.needsRecovery ? 'vehicleStuck' : 'vehicle'
      : ctx.drawn ? 'footDrawn' : ctx.armed ? 'footArmed' : 'foot';
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      const layout = LAYOUTS[key];
      for (const [id, b] of this.buttons) {
        const slot = layout[id];
        b.classList.toggle('shown', !!slot);
        if (!slot) continue;
        b.style.setProperty('--x', `${slot[0]}px`);
        b.style.setProperty('--y', `${slot[1]}px`);
        b.style.setProperty('--s', `${slot[2]}px`);
      }
      this.root.dataset.mode = key;
    }
    this.buttons.get('lights')!.classList.toggle('on', ctx.lights);
    this.torchBtn.classList.toggle('on', ctx.flashlight);
    this.torchBtn.classList.toggle('hidden', !onFoot);

    // Context button: pops up on foot when something is in reach.
    const use = onFoot ? ctx.prompt : null;
    const useKey = use ? use.text : '';
    if (useKey !== this.useKey) {
      this.useKey = useKey;
      this.useBtn.classList.toggle('shown', !!use);
      if (use) {
        this.useText.textContent = use.text;
      } else if (this.held.has('interact')) this.release('interact');
    }
    const p = use ? Math.min(1, use.progress) : 0;
    if (p !== this.useProgress) {
      this.useProgress = p;
      const c = 2 * Math.PI * 20;
      this.useRing.style.strokeDasharray = `${c}`;
      this.useRing.style.strokeDashoffset = `${c * (1 - p)}`;
      this.useRing.style.opacity = p > 0 ? '1' : '0';
    }
    const radio = !onFoot ? ctx.radio : null;
    this.radioBtn.classList.toggle('shown', !!radio);
    if (radio && this.radioText.textContent !== radio) this.radioText.textContent = radio;
  }

  /** Go fullscreen and landscape where the browser allows (Android Chrome). */
  enterImmersive(): void {
    const doc = document.documentElement;
    if (document.fullscreenElement || !doc.requestFullscreen) return;
    doc.requestFullscreen({ navigationUI: 'hide' })
      .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
      .catch(() => undefined);
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
    if (on) return;
    // Nothing stays pressed behind a menu.
    this.resetStick();
    this.lookId = null;
    this.setToggle('aim', false);
    this.setToggle('crouch', false);
    for (const a of [...this.held]) this.release(a);
    for (const b of this.buttons.values()) b.classList.remove('down');
  }
}
