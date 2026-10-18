// Touch controls for tablets/phones: a left-thumb joystick for walking and
// driving, drag-to-look on the right, and context buttons.

import type { Input, Action } from '../core/input.ts';
import { el } from './hud.ts';

export class TouchControls {
  readonly root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickOrigin = { x: 0, y: 0 };
  private lookLast = { x: 0, y: 0 };
  private input: Input;

  constructor(parent: HTMLElement, input: Input, onMenu: (which: 'pause' | 'journal' | 'map') => void) {
    this.input = input;
    this.root = el('div', 'touch');
    parent.appendChild(this.root);
    const lookPad = el('div', 'touch-look');
    this.stick = el('div', 'touch-stick');
    this.knob = el('div', 'touch-knob');
    this.stick.appendChild(this.knob);
    this.root.append(lookPad, this.stick);
    const buttons = el('div', 'touch-buttons');
    const btn = (label: string, action: Action | null, cls: string, onTap?: () => void) => {
      const b = el('button', `touch-btn ${cls}`) as unknown as HTMLButtonElement;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (action) input.setTouchButton(action, true);
        onTap?.();
      });
      const up = (e: PointerEvent) => {
        e.preventDefault();
        if (action) input.setTouchButton(action, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      buttons.appendChild(b);
      return b;
    };
    btn('Use', 'interact', 'big');
    btn('Jump / brake', 'jump', '');
    btn('Torch', 'flashlight', 'small');
    btn('Lights', 'lights', 'small');
    btn('Radio', 'radio', 'small');
    // Weapons: fire and aim are held; aim toggles with a tap for comfort.
    const combat = el('div', 'touch-combat');
    const cbtn = (label: string, action: Action, cls: string) => {
      const b = el('button', `touch-btn ${cls}`) as unknown as HTMLButtonElement;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.setTouchButton(action, true);
      });
      const up = (e: PointerEvent) => {
        e.preventDefault();
        input.setTouchButton(action, false);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('pointerleave', up);
      combat.appendChild(b);
      return b;
    };
    const aim = el('button', 'touch-btn') as unknown as HTMLButtonElement;
    aim.textContent = 'Aim';
    let aiming = false;
    aim.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      aiming = !aiming;
      input.setTouchButton('aim', aiming);
      aim.classList.toggle('on', aiming);
    });
    combat.appendChild(aim);
    cbtn('Fire', 'fire', 'big fire');
    cbtn('Reload', 'reload', 'small');
    cbtn('Weapon', 'nextWeapon', 'small');
    cbtn('Holster', 'holster', 'small');
    this.root.appendChild(combat);
    this.combat = combat;
    combat.style.display = 'none';
    const menus = el('div', 'touch-menus');
    const menuBtn = (label: string, which: 'pause' | 'journal' | 'map') => {
      const b = el('button', 'touch-btn small') as unknown as HTMLButtonElement;
      b.textContent = label;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onMenu(which);
      });
      menus.appendChild(b);
    };
    menuBtn('Journal', 'journal');
    menuBtn('Map', 'map');
    menuBtn('Pause', 'pause');
    this.root.append(buttons, menus);

    this.stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.stickId = e.pointerId;
      const r = this.stick.getBoundingClientRect();
      this.stickOrigin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      this.stick.setPointerCapture(e.pointerId);
      this.moveStick(e.clientX, e.clientY);
    });
    this.stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stickId) this.moveStick(e.clientX, e.clientY);
    });
    const endStick = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      input.touchMove.x = 0;
      input.touchMove.y = 0;
      this.knob.style.transform = 'translate(-50%, -50%)';
    };
    this.stick.addEventListener('pointerup', endStick);
    this.stick.addEventListener('pointercancel', endStick);

    lookPad.addEventListener('pointerdown', (e) => {
      this.lookId = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      lookPad.setPointerCapture(e.pointerId);
    });
    lookPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      input.addTouchLook((e.clientX - this.lookLast.x) * 1.6, (e.clientY - this.lookLast.y) * 1.6);
      this.lookLast = { x: e.clientX, y: e.clientY };
    });
    const endLook = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) this.lookId = null;
    };
    lookPad.addEventListener('pointerup', endLook);
    lookPad.addEventListener('pointercancel', endLook);
  }

  private moveStick(x: number, y: number): void {
    const max = 52;
    let dx = x - this.stickOrigin.x;
    let dy = y - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    this.input.touchMove.x = dx / max;
    this.input.touchMove.y = -dy / max;
  }

  private combat: HTMLDivElement | null = null;

  /** Weapon buttons only when the player has a gun and is on foot. */
  setCombat(on: boolean): void {
    if (this.combat) this.combat.style.display = on ? '' : 'none';
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }
}
