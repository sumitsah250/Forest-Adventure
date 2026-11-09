// In-game HUD: crosshair, interaction prompt, objective, compass, toasts,
// subtitles, the vehicle panel and the combat elements (weapon and ammunition,
// hit markers, damage direction, health, scope, weapon inventory). Minimal and
// readable on bright and dark scenes; nothing covers the character.

import type { WeaponHudState } from '../weapons/weaponSystem.ts';

export interface CompassMarker {
  bearing: number;
  label: string;
}

export class Hud {
  readonly root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private prompt: HTMLDivElement;
  private promptKey: HTMLSpanElement;
  private promptText: HTMLSpanElement;
  private promptRing: SVGCircleElement;
  private objective: HTMLDivElement;
  private objectiveText: HTMLDivElement;
  private objectiveSub: HTMLDivElement;
  private objectiveHint: HTMLDivElement;
  private objectiveHintText: HTMLDivElement;
  private objectiveKeys: HTMLDivElement;
  private waypoint: HTMLDivElement;
  private waypointLabel: HTMLDivElement;
  private compass: HTMLDivElement;
  private compassStrip: HTMLDivElement;
  private compassMarker: HTMLDivElement;
  private toasts: HTMLDivElement;
  private subtitle: HTMLDivElement;
  private vehicle: HTMLDivElement;
  private speed: HTMLSpanElement;
  private gear: HTMLSpanElement;
  private vehicleHints: HTMLDivElement;
  private notice: HTMLDivElement;
  private fps: HTMLDivElement;
  private subtitleTimer = 0;
  private noticeTimer = 0;
  private xTicks: HTMLDivElement[] = [];
  private hitMark: HTMLDivElement;
  private hitTimer = 0;
  private dmgVignette: HTMLDivElement;
  private dmgArrow: HTMLDivElement;
  private dmgTimer = 0;
  private healthWrap: HTMLDivElement;
  private healthBar: HTMLDivElement;
  private weapon: HTMLDivElement;
  private wName: HTMLDivElement;
  private wMeta: HTMLDivElement;
  private wMag: HTMLSpanElement;
  private wReserve: HTMLSpanElement;
  private wReload: HTMLDivElement;
  private wSlots: HTMLDivElement;
  private scope: HTMLDivElement;
  private inventory: HTMLDivElement;
  private controls: HTMLDivElement;
  private mission: HTMLDivElement;
  private fade: HTMLDivElement;
  private lastSlotsKey = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud');
    parent.appendChild(this.root);
    this.crosshair = el('div', 'hud-crosshair');
    this.prompt = el('div', 'hud-prompt');
    this.promptKey = el('span', 'hud-key') as HTMLSpanElement;
    this.promptText = el('span', 'hud-prompt-text') as HTMLSpanElement;
    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    ring.setAttribute('viewBox', '0 0 36 36');
    ring.classList.add('hud-ring');
    this.promptRing = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.promptRing.setAttribute('cx', '18');
    this.promptRing.setAttribute('cy', '18');
    this.promptRing.setAttribute('r', '15');
    ring.appendChild(this.promptRing);
    const keyWrap = el('span', 'hud-key-wrap');
    keyWrap.append(ring, this.promptKey);
    this.prompt.append(keyWrap, this.promptText);
    this.objective = el('div', 'hud-objective');
    const label = el('div', 'hud-label');
    label.textContent = 'Objective';
    this.objectiveText = el('div', 'hud-objective-text');
    this.objectiveSub = el('div', 'hud-objective-sub');
    this.objectiveHint = el('div', 'hud-objective-hint');
    const hintLabel = el('div', 'hud-objective-hint-label');
    hintLabel.textContent = 'Hint';
    this.objectiveHintText = el('div', 'hud-objective-hint-text');
    this.objectiveHint.append(hintLabel, this.objectiveHintText);
    this.objectiveKeys = el('div', 'hud-objective-keys');
    this.objective.append(label, this.objectiveText, this.objectiveSub, this.objectiveHint, this.objectiveKeys);
    // Objective waypoint: a marker over the target with its distance; pinned to the
    // screen edge with an arrow when the target is off screen or behind the camera.
    this.waypoint = el('div', 'hud-waypoint');
    this.waypointLabel = el('div', 'hud-wp-label');
    this.waypoint.append(el('div', 'hud-wp-arrow'), el('div', 'hud-wp-diamond'), this.waypointLabel);
    this.compass = el('div', 'hud-compass');
    this.compassStrip = el('div', 'hud-compass-strip');
    this.compassMarker = el('div', 'hud-compass-marker');
    this.compass.append(this.compassStrip, this.compassMarker, el('div', 'hud-compass-tick'));
    this.buildCompassStrip();
    this.toasts = el('div', 'hud-toasts');
    this.subtitle = el('div', 'hud-subtitle');
    this.vehicle = el('div', 'hud-vehicle');
    this.speed = el('span', 'hud-speed') as HTMLSpanElement;
    this.gear = el('span', 'hud-gear') as HTMLSpanElement;
    const unit = el('span', 'hud-unit');
    unit.textContent = 'km/h';
    const speedRow = el('div', 'hud-speed-row');
    speedRow.append(this.speed, unit, this.gear);
    this.vehicleHints = el('div', 'hud-vehicle-hints');
    this.vehicle.append(speedRow, this.vehicleHints);
    this.notice = el('div', 'hud-notice');
    this.fps = el('div', 'hud-fps');
    // Crosshair: centre dot plus four ticks that open with the weapon's spread.
    for (const k of ['t', 'b', 'l', 'r']) {
      const t = el('div', `hud-xtick ${k}`);
      this.xTicks.push(t);
      this.crosshair.appendChild(t);
    }
    this.crosshair.appendChild(el('div', 'hud-xdot'));
    this.crosshair.appendChild(el('div', 'hud-xblock'));
    this.hitMark = el('div', 'hud-hitmark');
    this.dmgVignette = el('div', 'hud-damage');
    this.dmgArrow = el('div', 'hud-damage-arrow');
    this.healthWrap = el('div', 'hud-health');
    this.healthBar = el('div', 'hud-health-bar');
    const hl = el('div', 'hud-label');
    hl.textContent = 'Condition';
    const track = el('div', 'hud-health-track');
    track.appendChild(this.healthBar);
    this.healthWrap.append(hl, track);
    // Weapon panel (bottom right).
    this.weapon = el('div', 'hud-weapon');
    this.wName = el('div', 'hud-weapon-name');
    this.wMeta = el('div', 'hud-weapon-meta');
    const ammoRow = el('div', 'hud-ammo');
    this.wMag = el('span', 'hud-mag') as HTMLSpanElement;
    this.wReserve = el('span', 'hud-reserve') as HTMLSpanElement;
    ammoRow.append(this.wMag, this.wReserve);
    this.wReload = el('div', 'hud-reload');
    this.wReload.appendChild(el('div', 'hud-reload-fill'));
    this.wSlots = el('div', 'hud-slots');
    this.weapon.append(this.wName, ammoRow, this.wMeta, this.wReload, this.wSlots);
    this.scope = el('div', 'hud-scope');
    this.scope.innerHTML = `<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid meet">
      <line x1="-100" y1="0" x2="-6" y2="0"/><line x1="6" y1="0" x2="100" y2="0"/>
      <line x1="0" y1="-100" x2="0" y2="-6"/><line x1="0" y1="6" x2="0" y2="100"/>
      ${[-40, -30, -20, -10, 10, 20, 30, 40].map((v) => `<circle cx="${v}" cy="0" r="0.9"/><circle cx="0" cy="${v}" r="0.9"/>`).join('')}
      <line class="thick" x1="-100" y1="0" x2="-55" y2="0"/><line class="thick" x1="55" y1="0" x2="100" y2="0"/>
      <line class="thick" x1="0" y1="55" x2="0" y2="100"/></svg>`;
    this.inventory = el('div', 'hud-inventory');
    this.controls = el('div', 'hud-controls');
    this.mission = el('div', 'hud-mission');
    this.fade = el('div', 'hud-fade');
    this.root.append(this.scope, this.dmgVignette, this.dmgArrow, this.waypoint, this.compass, this.mission, this.objective, this.crosshair, this.hitMark, this.prompt, this.subtitle, this.toasts, this.vehicle, this.weapon, this.healthWrap, this.controls, this.inventory, this.notice, this.fps, this.fade);
    this.setPrompt(null);
    this.setVehicle(null);
    this.setWeapon(null);
    this.setHealth(100, false);
  }

  /** Black fade over the view (0 = clear, 1 = black). */
  setFade(v: number): void {
    this.fade.style.opacity = String(THREE_CLAMP(v));
  }

  /** Mission strip above the objective ("Mission 2 of 8 · The Silent Station"). */
  setMission(text: string | null): void {
    this.mission.textContent = text ?? '';
    this.mission.classList.toggle('visible', !!text);
  }

  /** Weapon panel, crosshair spread and scope overlay. */
  setWeapon(w: WeaponHudState | null): void {
    if (!w) {
      this.weapon.classList.remove('visible');
      this.scope.classList.remove('visible');
      return;
    }
    const drawn = w.phase !== 'holstered' && !!w.name;
    this.weapon.classList.add('visible');
    this.weapon.classList.toggle('holstered', !drawn);
    if (drawn) {
      this.wName.textContent = w.name;
      this.wMag.textContent = String(w.mag);
      this.wReserve.textContent = `/ ${w.reserve}`;
      this.wMeta.textContent = `${w.ammo} · ${w.fire}`;
      this.weapon.classList.toggle('low', w.mag <= Math.max(1, Math.floor(w.magSize * 0.25)));
      this.weapon.classList.toggle('empty', w.mag === 0);
    } else {
      this.wName.textContent = 'Holstered';
      this.wMag.textContent = '';
      this.wReserve.textContent = '';
      this.wMeta.textContent = 'H or 1-8 to draw';
    }
    const fill = this.wReload.firstChild as HTMLDivElement;
    this.wReload.classList.toggle('visible', w.reloading !== null);
    if (w.reloading !== null) fill.style.transform = `scaleX(${w.reloading.toFixed(3)})`;
    const key = w.slots.map((s) => `${s.owned ? 1 : 0}${s.current ? 1 : 0}`).join('');
    if (key !== this.lastSlotsKey) {
      this.lastSlotsKey = key;
      this.wSlots.innerHTML = w.slots.map((s) => `<span class="slot${s.owned ? ' owned' : ''}${s.current ? ' current' : ''}" title="${s.short}">${s.slot}</span>`).join('');
      this.renderInventory(w);
    }
    this.scope.classList.toggle('visible', w.scoped);
    this.crosshair.classList.toggle('scoped', w.scoped);
    // Spread ticks.
    const gap = Math.min(70, Math.max(5, w.spreadPx));
    const [t, b, l, r] = this.xTicks;
    t.style.transform = `translate(-50%, ${-gap - 9}px)`;
    b.style.transform = `translate(-50%, ${gap}px)`;
    l.style.transform = `translate(${-gap - 9}px, -50%)`;
    r.style.transform = `translate(${gap}px, -50%)`;
    this.crosshairMode = w.crosshair;
  }

  private crosshairMode: WeaponHudState['crosshair'] = 'none';

  private renderInventory(w: WeaponHudState): void {
    this.inventory.innerHTML = `<div class="hud-label">Weapons</div><div class="inv-row">${w.slots
      .map((s) => `<div class="inv-slot${s.owned ? ' owned' : ''}${s.current ? ' current' : ''}"><b>${s.slot}</b><span>${s.owned ? s.short : 'Not found'}</span></div>`)
      .join('')}</div><div class="inv-hint">Press 1-8 to equip · H to holster · mouse wheel to cycle</div>`;
  }

  setInventory(open: boolean): void {
    this.inventory.classList.toggle('visible', open);
  }

  /** Detailed inventory (ammunition per weapon), rebuilt when it opens. */
  setInventoryDetail(rows: { slot: number; name: string; category: string; owned: boolean; current: boolean; ammo: string; role: string }[]): void {
    this.inventory.innerHTML = `<div class="hud-label">Weapons</div><div class="inv-row">${rows
      .map((s) => `<div class="inv-slot${s.owned ? ' owned' : ''}${s.current ? ' current' : ''}"><b>${s.slot}</b><span>${s.owned ? s.name : 'Not found'}</span><i>${s.owned ? s.category : ''}</i><em>${s.owned ? s.ammo : ''}</em></div>`)
      .join('')}</div><div class="inv-hint">Press 1-8 to equip · H to holster · mouse wheel to cycle</div>`;
    this.lastSlotsKey = '';
  }

  /** Brief X at the crosshair when a shot connects (red when it takes a target down). */
  hitMarker(defeat: boolean): void {
    this.hitMark.className = `hud-hitmark visible${defeat ? ' defeat' : ''}`;
    this.hitTimer = defeat ? 0.35 : 0.16;
  }

  /** Damage taken: vignette and an arrow toward the source (bearing relative to view, degrees). */
  damage(amount: number, relBearing: number | null): void {
    this.dmgVignette.style.opacity = String(Math.min(0.85, 0.25 + amount / 60));
    this.dmgTimer = 0.9;
    if (relBearing !== null) {
      this.dmgArrow.style.transform = `translate(-50%, -50%) rotate(${relBearing}deg)`;
      this.dmgArrow.classList.add('visible');
    }
  }

  setHealth(v: number, show: boolean): void {
    this.healthBar.style.transform = `scaleX(${Math.max(0, v / 100).toFixed(3)})`;
    this.healthWrap.classList.toggle('visible', show);
    this.healthWrap.classList.toggle('critical', v < 30);
  }

  /** Context-sensitive control reminders (bottom left, faint). */
  setControls(html: string | null): void {
    if (!html) {
      this.controls.classList.remove('visible');
      return;
    }
    if (this.controls.innerHTML !== html) this.controls.innerHTML = html;
    this.controls.classList.add('visible');
  }

  private buildCompassStrip(): void {
    // Two full turns so the strip can scroll seamlessly.
    const labels: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    for (let turn = 0; turn < 3; turn += 1) {
      for (let d = 0; d < 360; d += 15) {
        const t = el('span', labels[d] ? 'cmp-major' : 'cmp-minor');
        t.textContent = labels[d] ?? '';
        t.style.left = `${(turn * 360 + d) * 4}px`;
        this.compassStrip.appendChild(t);
      }
    }
  }

  /** heading in degrees (0 = north, clockwise). */
  setCompass(heading: number, marker: CompassMarker | null): void {
    const px = 4;
    const offset = (360 + ((heading % 360) + 360) % 360) * px;
    this.compassStrip.style.transform = `translateX(${-offset + this.compass.clientWidth / 2}px)`;
    if (marker) {
      let rel = marker.bearing - heading;
      rel = ((rel + 540) % 360) - 180;
      const half = this.compass.clientWidth / 2;
      const x = Math.max(-half + 8, Math.min(half - 8, rel * px));
      this.compassMarker.style.display = 'block';
      this.compassMarker.style.transform = `translateX(${x + half}px)`;
      this.compassMarker.textContent = marker.label;
      this.compassMarker.classList.toggle('edge', Math.abs(rel * px) > half - 8);
    } else {
      this.compassMarker.style.display = 'none';
    }
  }

  setPrompt(p: { key: string; text: string; progress: number } | null): void {
    if (!p) {
      this.prompt.classList.remove('visible');
      return;
    }
    this.prompt.classList.add('visible');
    this.promptKey.textContent = p.key;
    this.promptText.textContent = p.text;
    const c = 2 * Math.PI * 15;
    this.promptRing.style.strokeDasharray = `${c}`;
    this.promptRing.style.strokeDashoffset = `${c * (1 - Math.min(1, p.progress))}`;
    this.promptRing.style.opacity = p.progress > 0 ? '1' : '0';
  }

  setCrosshair(mode: 'idle' | 'target' | 'hidden'): void {
    // A drawn weapon overrides the interaction dot with its own crosshair.
    const w = this.crosshairMode;
    const weaponMode = w === 'weapon' || w === 'target' || w === 'blocked';
    const scoped = this.crosshair.classList.contains('scoped');
    this.crosshair.className = `hud-crosshair ${mode === 'hidden' ? 'hidden' : weaponMode ? `gun ${w}` : mode}${scoped ? ' scoped' : ''}`;
  }

  /** Called when no weapon is drawn so the crosshair falls back to the interaction dot. */
  clearWeaponCrosshair(): void {
    this.crosshairMode = 'none';
  }

  /**
   * Objective panel. `hint` shows a hint box under the objective (null hides it);
   * `hintKey` is the key-chip line under it ("G  Hint"), null hides it.
   */
  setObjective(text: string | null, sub = '', help: { hint?: string | null; hintKey?: string | null } = {}): void {
    if (!text) {
      this.objective.classList.remove('visible');
      return;
    }
    if (this.objectiveText.textContent !== text) {
      this.objective.classList.remove('visible');
      void this.objective.offsetWidth;
    }
    this.objective.classList.add('visible');
    this.objectiveText.textContent = text;
    this.objectiveSub.textContent = sub;
    const hint = help.hint ?? '';
    if (this.objectiveHintText.textContent !== hint) {
      this.objectiveHintText.textContent = hint;
      // Replay the highlight whenever a new hint appears.
      this.objectiveHint.classList.remove('fresh');
      void this.objectiveHint.offsetWidth;
      if (hint) this.objectiveHint.classList.add('fresh');
    }
    this.objectiveHint.classList.toggle('visible', !!hint);
    const keys = help.hintKey ? `<b>G</b>${help.hintKey}` : '';
    if (this.objectiveKeys.innerHTML !== keys) this.objectiveKeys.innerHTML = keys;
  }

  /**
   * Objective waypoint from the target's normalised device coordinates (camera
   * projection). `behind` = the target is behind the camera. Null hides it.
   */
  setWaypoint(w: { ndcX: number; ndcY: number; behind: boolean; label: string; opacity: number } | null): void {
    if (!w || w.opacity <= 0.01) {
      this.waypoint.classList.remove('visible');
      return;
    }
    const W = this.root.clientWidth || window.innerWidth;
    const H = this.root.clientHeight || window.innerHeight;
    let x = w.behind ? -w.ndcX : w.ndcX;
    let y = w.behind ? -w.ndcY : w.ndcY;
    if (w.behind && Math.abs(x) < 1e-3 && Math.abs(y) < 1e-3) y = -1;
    // Keep clear of the screen edges (and the compass at the top).
    const mx = 1 - 60 / (W / 2);
    const my = y > 0 ? 1 - 84 / (H / 2) : 1 - 70 / (H / 2);
    const over = Math.max(Math.abs(x) / mx, Math.abs(y) / my);
    const off = w.behind || over > 1;
    if (off) {
      x /= over;
      y /= over;
    }
    const px = ((x + 1) / 2) * W;
    const py = ((1 - y) / 2) * H;
    this.waypoint.classList.add('visible');
    this.waypoint.classList.toggle('off', off);
    this.waypoint.style.opacity = String(w.opacity);
    this.waypoint.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    const ang = Math.atan2(py - H / 2, px - W / 2);
    this.waypoint.style.setProperty('--wp-angle', `${ang.toFixed(3)}rad`);
    if (this.waypointLabel.textContent !== w.label) this.waypointLabel.textContent = w.label;
  }

  toast(title: string, body = '', kind: 'clue' | 'info' | 'hint' | 'objective' = 'info'): void {
    const t = el('div', `hud-toast ${kind}`);
    const h = el('div', 'hud-toast-title');
    h.textContent = title;
    t.appendChild(h);
    if (body) {
      const b = el('div', 'hud-toast-body');
      b.textContent = body;
      t.appendChild(b);
    }
    this.toasts.appendChild(t);
    requestAnimationFrame(() => t.classList.add('in'));
    const life = kind === 'hint' ? 9000 : 5200;
    setTimeout(() => {
      t.classList.remove('in');
      setTimeout(() => t.remove(), 600);
    }, life);
    while (this.toasts.children.length > 4) this.toasts.firstChild?.remove();
  }

  /** Shows a subtitle line for `seconds`. */
  say(speaker: string, line: string, seconds = 5): void {
    this.subtitle.innerHTML = '';
    if (speaker) {
      const s = el('span', 'hud-speaker');
      s.textContent = speaker;
      this.subtitle.appendChild(s);
    }
    const l = el('span', 'hud-line');
    l.textContent = line;
    this.subtitle.appendChild(l);
    this.subtitle.classList.add('visible');
    this.subtitleTimer = seconds;
  }

  clearSubtitle(): void {
    this.subtitleTimer = 0;
    this.subtitle.classList.remove('visible');
  }

  /** Centre-screen short notice (e.g. "Hold R to recover"). */
  showNotice(text: string, seconds = 2.5): void {
    this.notice.textContent = text;
    this.notice.classList.add('visible');
    this.noticeTimer = seconds;
  }

  setVehicle(v: { speed: number; gear: string; lights: boolean; hints: string[] } | null): void {
    if (!v) {
      this.vehicle.classList.remove('visible');
      return;
    }
    this.vehicle.classList.add('visible');
    this.speed.textContent = String(Math.round(v.speed));
    this.gear.textContent = v.gear;
    const html = v.hints.map((h) => `<span>${h}</span>`).join('');
    if (this.vehicleHints.innerHTML !== html) this.vehicleHints.innerHTML = html;
    this.vehicle.classList.toggle('lights', v.lights);
  }

  setFps(text: string | null): void {
    this.fps.style.display = text ? 'block' : 'none';
    if (text) this.fps.textContent = text;
  }

  setVisible(on: boolean): void {
    this.root.style.display = on ? '' : 'none';
  }

  update(dt: number): void {
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.hitMark.classList.remove('visible');
    }
    if (this.dmgTimer > 0) {
      this.dmgTimer -= dt;
      const o = parseFloat(this.dmgVignette.style.opacity || '0');
      this.dmgVignette.style.opacity = String(Math.max(0, o - dt * 0.9));
      if (this.dmgTimer <= 0) this.dmgArrow.classList.remove('visible');
    }
    if (this.subtitleTimer > 0) {
      this.subtitleTimer -= dt;
      if (this.subtitleTimer <= 0) this.subtitle.classList.remove('visible');
    }
    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0) this.notice.classList.remove('visible');
    }
  }
}

function THREE_CLAMP(v: number): number {
  return Math.max(0, Math.min(1, v));
}

export function el(tag: string, className = ''): HTMLDivElement {
  const e = document.createElement(tag) as HTMLDivElement;
  if (className) e.className = className;
  return e;
}
