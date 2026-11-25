// Campus Quest's camera director: letterbox bars and a title card over scripted shots
// (mission intros), an over-the-shoulder conversation camera, and a slow orbit for the
// mission-complete screen. While active it owns the camera; gameplay cameras resume after.

import * as THREE from 'three';

export interface Shot {
  /** Camera travels from -> to while looking from look -> lookTo. */
  from: THREE.Vector3;
  to: THREE.Vector3;
  look: THREE.Vector3;
  lookTo?: THREE.Vector3;
  dur: number;
  fov?: number;
}

export interface TitleCard {
  kicker: string;
  title: string;
  sub: string;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class Cinema {
  private bars: HTMLDivElement;
  private card: HTMLDivElement;
  private hint: HTMLDivElement;
  private mode: 'none' | 'shots' | 'talk' | 'orbit' = 'none';
  private shots: Shot[] = [];
  private i = 0;
  private t = 0;
  private resolve: (() => void) | null = null;
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private wantPos = new THREE.Vector3();
  private wantLook = new THREE.Vector3();
  private orbitC = new THREE.Vector3();
  private orbitA = 0;
  private orbitR = 6;
  private orbitH = 2.4;
  private fov = 60;
  private baseFov = 60;
  private snap = false;

  constructor(root: HTMLElement) {
    this.bars = document.createElement('div');
    this.bars.className = 'cq-bars';
    this.bars.innerHTML = '<i></i><i></i>';
    this.card = document.createElement('div');
    this.card.className = 'cq-cine';
    this.hint = document.createElement('div');
    this.hint.className = 'cq-cine-skip';
    // Phones skipped with the Jump button, which is hidden while a shot plays: the hint itself is the button.
    this.hint.innerHTML = window.matchMedia('(pointer: coarse)').matches ? 'Tap to skip' : '<kbd>E</kbd> skip';
    this.hint.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.skip();
    });
    root.append(this.bars, this.card, this.hint);
  }

  get active(): boolean {
    return this.mode !== 'none';
  }

  get playingShots(): boolean {
    return this.mode === 'shots';
  }

  private letterbox(on: boolean): void {
    this.bars.classList.toggle('on', on);
  }

  /** The letterbox bars, for the cutscene player (cutscene.ts). */
  setBars(on: boolean): void {
    this.letterbox(on);
  }

  /** The big title card, for the cutscene player (null takes it away). */
  setCard(card: TitleCard | null): void {
    if (!card) {
      if (this.card.classList.contains('on')) this.card.classList.add('out');
      return;
    }
    this.card.innerHTML = `<div class="cq-cine__k">${card.kicker}</div><div class="cq-cine__t">${card.title}</div><div class="cq-cine__s">${card.sub}</div>`;
    this.card.className = 'cq-cine';
    void this.card.offsetWidth;
    this.card.className = 'cq-cine on';
  }

  /** Scripted shots with an optional title card. Resolves when they end or are skipped. */
  play(shots: Shot[], card: TitleCard | null, baseFov: number): Promise<void> {
    this.finishShots();
    this.mode = 'shots';
    this.shots = shots;
    this.i = 0;
    this.t = 0;
    this.baseFov = baseFov;
    this.letterbox(true);
    this.hint.classList.add('on');
    if (card) {
      this.card.innerHTML = `<div class="cq-cine__k">${card.kicker}</div><div class="cq-cine__t">${card.title}</div><div class="cq-cine__s">${card.sub}</div>`;
      this.card.className = 'cq-cine';
      void this.card.offsetWidth;
      this.card.className = 'cq-cine on';
    }
    return new Promise((r) => (this.resolve = r));
  }

  skip(): void {
    if (this.mode === 'shots') this.finishShots();
  }

  private finishShots(): void {
    if (this.mode !== 'shots') return;
    this.mode = 'none';
    this.letterbox(false);
    this.hint.classList.remove('on');
    this.card.className = 'cq-cine';
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }

  /** Over-the-shoulder framing for a conversation (eases in from the current view). */
  talk(camPos: THREE.Vector3, lookAt: THREE.Vector3, from: THREE.Camera): void {
    if (this.mode === 'shots') return;
    if (this.mode === 'none') this.grab(from);
    this.mode = 'talk';
    this.wantPos.copy(camPos);
    this.wantLook.copy(lookAt);
    this.letterbox(true);
  }

  /** Slow orbit around a point (mission complete). */
  orbit(center: THREE.Vector3, from: THREE.Camera, radius = 6, height = 2.4): void {
    if (this.mode === 'shots') return;
    if (this.mode === 'none') this.grab(from);
    this.mode = 'orbit';
    this.orbitC.copy(center);
    this.orbitR = radius;
    this.orbitH = height;
    this.orbitA = Math.atan2(from.position.x - center.x, from.position.z - center.z);
    this.letterbox(true);
  }

  /** Back to gameplay cameras (a cut). */
  release(): void {
    if (this.mode === 'talk' || this.mode === 'orbit') {
      this.mode = 'none';
      this.letterbox(false);
    }
  }

  private grab(cam: THREE.Camera): void {
    this.pos.copy(cam.position);
    const d = new THREE.Vector3();
    cam.getWorldDirection(d);
    this.look.copy(cam.position).addScaledVector(d, 5);
    this.snap = false;
  }

  /** Writes the camera; returns false when gameplay owns it. */
  update(dt: number, camera: THREE.PerspectiveCamera): boolean {
    if (this.mode === 'none') return false;
    if (this.mode === 'shots') {
      const s = this.shots[this.i];
      if (!s) {
        this.finishShots();
        return false;
      }
      this.t += dt;
      const f = ease(Math.min(1, this.t / s.dur));
      camera.position.lerpVectors(s.from, s.to, f);
      const l = s.lookTo ? this.look.lerpVectors(s.look, s.lookTo, f) : this.look.copy(s.look);
      camera.lookAt(l);
      this.fov = s.fov ?? this.baseFov;
      if (camera.fov !== this.fov) {
        camera.fov = this.fov;
        camera.updateProjectionMatrix();
      }
      if (this.t >= s.dur) {
        this.i += 1;
        this.t = 0;
        // Title card leaves before the last shot ends.
        if (this.i >= this.shots.length - 1) this.card.classList.add('out');
      }
      return true;
    }
    if (this.mode === 'orbit') {
      this.orbitA += dt * 0.22;
      this.wantPos.set(this.orbitC.x + Math.sin(this.orbitA) * this.orbitR, this.orbitC.y + this.orbitH, this.orbitC.z + Math.cos(this.orbitA) * this.orbitR);
      this.wantLook.copy(this.orbitC);
    }
    const k = this.snap ? 1 : 1 - Math.exp(-4 * dt);
    this.pos.lerp(this.wantPos, k);
    this.look.lerp(this.wantLook, k);
    camera.position.copy(this.pos);
    camera.lookAt(this.look);
    return true;
  }
}
