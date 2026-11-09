// Keyboard, mouse (pointer lock) and touch input mapped to game actions.

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'interact'
  | 'journal' | 'map' | 'hint' | 'pause' | 'lights' | 'camera' | 'recover' | 'radio' | 'handbrake' | 'crouch' | 'flashlight'
  | 'aim' | 'fire' | 'reload' | 'holster' | 'inventory' | 'shoulder' | 'nextWeapon' | 'prevWeapon'
  | 'weapon1' | 'weapon2' | 'weapon3' | 'weapon4' | 'weapon5' | 'weapon6' | 'weapon7' | 'weapon8';

const BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  handbrake: ['Space'],
  interact: ['KeyE'],
  journal: ['KeyJ'],
  map: ['KeyM'],
  hint: ['KeyG'],
  pause: ['Escape', 'KeyP'],
  lights: ['KeyL'],
  camera: ['KeyC'],
  recover: ['KeyR'],
  radio: ['KeyT'],
  crouch: ['ControlLeft', 'KeyQ'],
  flashlight: ['KeyF'],
  aim: ['MouseRight'],
  fire: ['MouseLeft'],
  reload: ['KeyR'],
  holster: ['KeyH'],
  inventory: ['Tab'],
  shoulder: ['KeyV'],
  nextWeapon: ['WheelDown'],
  prevWeapon: ['WheelUp'],
  weapon1: ['Digit1'],
  weapon2: ['Digit2'],
  weapon3: ['Digit3'],
  weapon4: ['Digit4'],
  weapon5: ['Digit5'],
  weapon6: ['Digit6'],
  weapon7: ['Digit7'],
  weapon8: ['Digit8'],
};

export class Input {
  private down = new Set<string>();
  private pressedNow = new Set<string>();
  private releasedNow = new Set<string>();
  private mdx = 0;
  private mdy = 0;
  /** Touch-driven analog values in [-1, 1]. */
  touchMove = { x: 0, y: 0 };
  private touchLook = { x: 0, y: 0 };
  private touchButtons = new Set<string>();
  private touchPressed = new Set<string>();
  private touchReleased = new Set<string>();
  readonly isTouch: boolean;
  enabled = true;
  private canvas: HTMLElement;
  onPointerLockChange: ((locked: boolean) => void) | null = null;

  constructor(canvas: HTMLElement) {
    this.canvas = canvas;
    this.isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressedNow.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.releasedNow.add(e.code);
    });
    window.addEventListener('mousedown', (e) => {
      const code = e.button === 0 ? 'MouseLeft' : e.button === 2 ? 'MouseRight' : null;
      if (!code) return;
      if (e.button === 2) e.preventDefault();
      this.down.add(code);
      this.pressedNow.add(code);
    });
    window.addEventListener('mouseup', (e) => {
      const code = e.button === 0 ? 'MouseLeft' : e.button === 2 ? 'MouseRight' : null;
      if (!code) return;
      this.down.delete(code);
      this.releasedNow.add(code);
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    // Mouse wheel cycles weapons (only while the pointer is captured).
    window.addEventListener('wheel', (e) => {
      if (document.pointerLockElement !== this.canvas || Math.abs(e.deltaY) < 1) return;
      this.pressedNow.add(e.deltaY > 0 ? 'WheelDown' : 'WheelUp');
    }, { passive: true });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.pressedNow.clear();
      this.releasedNow.clear();
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.mdx += e.movementX;
        this.mdy += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.onPointerLockChange?.(document.pointerLockElement === this.canvas);
    });
  }

  private actionCodes(action: Action | string): string[] {
    if (Object.prototype.hasOwnProperty.call(BINDINGS, action)) {
      return BINDINGS[action as Action];
    }
    return [String(action)];
  }

  requestPointerLock(): void {
    if (this.isTouch) return;
    if (document.pointerLockElement !== this.canvas) {
      const p = this.canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
      p?.catch?.(() => undefined);
    }
  }

  exitPointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  held(action: Action | string): boolean {
    if (!this.enabled) return false;
    const key = String(action);
    if (this.touchButtons.has(key)) return true;
    return this.actionCodes(action).some((c) => this.down.has(c));
  }

  pressed(action: Action | string): boolean {
    const key = String(action);
    if (this.touchPressed.has(key)) return true;
    if (!this.enabled && action !== 'pause' && action !== 'journal' && action !== 'map') return false;
    return this.actionCodes(action).some((c) => this.pressedNow.has(c));
  }

  released(action: Action | string): boolean {
    const key = String(action);
    if (this.touchReleased.has(key)) return true;
    return this.actionCodes(action).some((c) => this.releasedNow.has(c));
  }

  /** Movement axes: x = strafe/steer (right +), y = forward (+). */
  moveAxes(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.held('right')) x += 1;
    if (this.held('left')) x -= 1;
    if (this.held('forward')) y += 1;
    if (this.held('back')) y -= 1;
    if (this.enabled) {
      x += this.touchMove.x;
      y += this.touchMove.y;
    }
    return { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
  }

  /** Mouse/touch look delta in pixels since last frame. */
  consumeLook(): { x: number; y: number } {
    const out = { x: this.mdx + this.touchLook.x, y: this.mdy + this.touchLook.y };
    this.mdx = 0;
    this.mdy = 0;
    this.touchLook.x = 0;
    this.touchLook.y = 0;
    if (!this.enabled) return { x: 0, y: 0 };
    return out;
  }

  addTouchLook(dx: number, dy: number): void {
    this.touchLook.x += dx;
    this.touchLook.y += dy;
  }

  setTouchButton(action: Action | string, on: boolean): void {
    const key = String(action);
    if (on) {
      if (!this.touchButtons.has(key)) this.touchPressed.add(key);
      this.touchButtons.add(key);
    } else {
      // A press stays visible until endFrame, so taps shorter than a frame still register.
      this.touchButtons.delete(key);
      this.touchReleased.add(key);
    }
  }

  /** Simulated press used by automated tests. */
  simulatePress(code: string, hold = false): void {
    this.pressedNow.add(code);
    if (hold) this.down.add(code);
  }

  simulateRelease(code: string): void {
    this.down.delete(code);
    this.releasedNow.add(code);
  }

  endFrame(): void {
    this.pressedNow.clear();
    this.releasedNow.clear();
    this.touchPressed.clear();
    this.touchReleased.clear();
  }
}
