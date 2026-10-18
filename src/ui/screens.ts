// Full-screen UI: title menu, pause, settings, controls, journal, topographic map
// and the ending. Plain DOM; every visible control is functional.

import type { Settings, Quality } from '../core/settings.ts';
import type { TerrainData } from '../world/terrain.ts';
import { CREEK, SITES, WORLD_HALF } from '../world/layout.ts';
import { el } from './hud.ts';

export type Screen = 'none' | 'title' | 'pause' | 'settings' | 'controls' | 'journal' | 'map' | 'ending' | 'credits';

export interface ScreenHooks {
  begin: () => void;
  continueGame: (() => void) | null;
  resume: () => void;
  restart: () => void;
  quitToTitle: () => void;
  applySettings: (s: Settings, needsReload: boolean) => void;
  requestHint: () => string;
  journal: () => {
    objective: string;
    sub: string;
    clues: { title: string; text: string }[];
    progress: string;
    missions?: { title: string; status: 'done' | 'current' | 'locked'; objectives: { text: string; done: boolean }[] }[];
  };
  /** Called when a screen opens (missions react to the journal and map). */
  onShow?: (s: Screen) => void;
  mapState: () => { player: { x: number; z: number; heading: number }; truck: { x: number; z: number }; reveals: Set<string>; target: { x: number; z: number } | null };
}

const LANDMARKS: Record<string, { x: number; z: number; label: string }> = {
  trailhead: { x: 55, z: 236, label: 'Trailhead' },
  range: { x: 96, z: 222, label: 'Training range' },
  cache: { x: 92, z: -183, label: 'GPS waypoint "CACHE"' },
  basecamp: { x: 150, z: -207, label: 'Poachers\' camp' },
  roadblock: { x: -31, z: -141, label: 'Roadblock' },
  station: { x: SITES.station.x, z: SITES.station.z, label: 'Ranger station' },
  ford: { x: 69, z: -72, label: 'Ford' },
  gate: { x: SITES.gate.x, z: SITES.gate.z, label: 'Ridge Gate' },
  lookout: { x: SITES.lookout.x, z: SITES.lookout.z, label: 'Fire lookout' },
  cabin: { x: SITES.cabin.x, z: SITES.cabin.z, label: 'Miller cabin' },
};

export class Screens {
  readonly root: HTMLDivElement;
  current: Screen = 'none';
  private hooks: ScreenHooks;
  private settings: Settings;
  private mapBase: HTMLCanvasElement | null = null;
  private terrain: TerrainData | null = null;
  private returnTo: Screen = 'pause';

  constructor(parent: HTMLElement, settings: Settings, hooks: ScreenHooks) {
    this.root = el('div', 'screens');
    parent.appendChild(this.root);
    this.settings = settings;
    this.hooks = hooks;
  }

  setContinue(fn: (() => void) | null): void {
    this.hooks.continueGame = fn;
  }

  setTerrain(t: TerrainData): void {
    this.terrain = t;
  }

  /** Static topographic map (also used for the station's wall map). */
  mapCanvas(size = 1024): HTMLCanvasElement {
    if (this.mapBase && this.mapBase.width === size) return this.mapBase;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#e9e2cd';
    ctx.fillRect(0, 0, size, size);
    const t = this.terrain;
    const toPx = (v: number) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * size;
    if (t) {
      // Forest tint by elevation, then contour lines via marching squares.
      const N = 160;
      const step = (WORLD_HALF * 2) / N;
      const hs: number[] = [];
      for (let j = 0; j <= N; j += 1) for (let i = 0; i <= N; i += 1) hs.push(t.heightAt(-WORLD_HALF + i * step, -WORLD_HALF + j * step));
      const H = (i: number, j: number) => hs[j * (N + 1) + i];
      for (let j = 0; j < N; j += 1) {
        for (let i = 0; i < N; i += 1) {
          const h = H(i, j);
          const g = Math.max(0, Math.min(1, (h + 5) / 50));
          ctx.fillStyle = `rgba(${150 - g * 30}, ${170 - g * 25}, ${120 - g * 20}, 0.35)`;
          ctx.fillRect((i / N) * size, (j / N) * size, size / N + 1, size / N + 1);
        }
      }
      const interval = 2.5;
      ctx.lineWidth = 1;
      for (let level = -5; level < 60; level += interval) {
        const major = Math.round(level / interval) % 4 === 0;
        ctx.strokeStyle = major ? 'rgba(120, 82, 48, 0.75)' : 'rgba(140, 100, 62, 0.38)';
        ctx.lineWidth = major ? 1.4 : 0.8;
        ctx.beginPath();
        for (let j = 0; j < N; j += 1) {
          for (let i = 0; i < N; i += 1) {
            const a = H(i, j) - level;
            const b = H(i + 1, j) - level;
            const cc = H(i + 1, j + 1) - level;
            const d = H(i, j + 1) - level;
            const pts: [number, number][] = [];
            const edge = (x0: number, y0: number, v0: number, x1: number, y1: number, v1: number) => {
              if ((v0 < 0) !== (v1 < 0)) {
                const f = v0 / (v0 - v1);
                pts.push([((x0 + (x1 - x0) * f) / N) * size, ((y0 + (y1 - y0) * f) / N) * size]);
              }
            };
            edge(i, j, a, i + 1, j, b);
            edge(i + 1, j, b, i + 1, j + 1, cc);
            edge(i + 1, j + 1, cc, i, j + 1, d);
            edge(i, j + 1, d, i, j, a);
            if (pts.length >= 2) {
              ctx.moveTo(pts[0][0], pts[0][1]);
              ctx.lineTo(pts[1][0], pts[1][1]);
              if (pts.length === 4) {
                ctx.moveTo(pts[2][0], pts[2][1]);
                ctx.lineTo(pts[3][0], pts[3][1]);
              }
            }
          }
        }
        ctx.stroke();
      }
      // Creek.
      ctx.strokeStyle = '#4c7894';
      ctx.lineWidth = 3;
      ctx.beginPath();
      CREEK.forEach((p, i) => (i ? ctx.lineTo(toPx(p.x), toPx(p.z)) : ctx.moveTo(toPx(p.x), toPx(p.z))));
      ctx.stroke();
      // Roads and tracks.
      for (const road of t.roads) {
        ctx.beginPath();
        ctx.strokeStyle = road.kind === 'road' ? '#5b3f2a' : road.kind === 'track' ? 'rgba(91,63,42,0.85)' : 'rgba(91,63,42,0.55)';
        ctx.lineWidth = road.kind === 'road' ? 3 : 1.6;
        ctx.setLineDash(road.kind === 'road' ? [] : road.kind === 'track' ? [7, 4] : [2, 4]);
        for (let i = 0; i < road.count; i += 4) {
          const x = toPx(road.xz[i * 2]);
          const y = toPx(road.xz[i * 2 + 1]);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(60, 48, 30, 0.85)';
    ctx.font = `600 ${Math.round(size / 34)}px "Segoe UI", Arial`;
    ctx.fillText('HOLLOW CREEK RANGER DISTRICT', size * 0.04, size * 0.06);
    ctx.font = `400 ${Math.round(size / 60)}px "Segoe UI", Arial`;
    ctx.fillText('Contour interval 2.5 m  ·  grid 100 m', size * 0.04, size * 0.09);
    ctx.strokeStyle = 'rgba(60,48,30,0.15)';
    ctx.lineWidth = 1;
    for (let v = -300; v <= 300; v += 100) {
      ctx.beginPath();
      ctx.moveTo(toPx(v), 0);
      ctx.lineTo(toPx(v), size);
      ctx.moveTo(0, toPx(v));
      ctx.lineTo(size, toPx(v));
      ctx.stroke();
    }
    // North arrow.
    ctx.fillStyle = 'rgba(60,48,30,0.8)';
    ctx.beginPath();
    ctx.moveTo(size * 0.93, size * 0.05);
    ctx.lineTo(size * 0.945, size * 0.1);
    ctx.lineTo(size * 0.915, size * 0.1);
    ctx.fill();
    ctx.fillText('N', size * 0.924, size * 0.125);
    this.mapBase = c;
    return c;
  }

  show(screen: Screen, from?: Screen): void {
    this.hooks.onShow?.(screen);
    if (from) this.returnTo = from;
    this.current = screen;
    this.root.innerHTML = '';
    this.root.className = `screens ${screen === 'none' ? '' : 'open'} screen-${screen}`;
    if (screen === 'none') return;
    const panel = el('div', 'screen-panel');
    this.root.appendChild(panel);
    switch (screen) {
      case 'title':
        this.titleScreen(panel);
        break;
      case 'pause':
        this.pauseScreen(panel);
        break;
      case 'settings':
        this.settingsScreen(panel);
        break;
      case 'controls':
        this.controlsScreen(panel);
        break;
      case 'credits':
        this.creditsScreen(panel);
        break;
      case 'journal':
        this.journalScreen(panel);
        break;
      case 'map':
        this.mapScreen(panel);
        break;
      default:
        break;
    }
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, cls = ''): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = `ui-btn ${cls}`;
    b.textContent = label;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    parent.appendChild(b);
    return b;
  }

  private titleScreen(p: HTMLElement): void {
    p.classList.add('title');
    const studio = el('div', 'studio-tag');
    studio.textContent = 'Sumix Developers presents';
    p.appendChild(studio);
    const t = el('h1', 'title-name');
    t.textContent = 'POACHER PANIC';
    const sub = el('p', 'title-sub');
    sub.textContent = 'Ranger Mara Hale stopped answering her radio two days ago. You are the district\'s on-call ranger. Drive in, find out what happened, and bring her home.';
    const menu = el('div', 'title-menu');
    p.append(t, sub, menu);
    if (this.hooks.continueGame) this.button(menu, 'Continue', this.hooks.continueGame, 'primary');
    this.button(menu, this.hooks.continueGame ? 'New investigation' : 'Begin', this.hooks.begin, this.hooks.continueGame ? '' : 'primary');
    this.button(menu, 'Settings', () => this.show('settings', 'title'));
    this.button(menu, 'Controls', () => this.show('controls', 'title'));
    this.button(menu, 'Credits', () => this.show('credits', 'title'));
    const foot = el('div', 'title-foot');
    foot.textContent = 'Headphones recommended · Click to capture the mouse, Esc to pause · © Sumix Developers';
    p.appendChild(foot);
  }

  private pauseScreen(p: HTMLElement): void {
    const h = el('h2', 'screen-title');
    h.textContent = 'Paused';
    p.appendChild(h);
    const menu = el('div', 'title-menu');
    p.appendChild(menu);
    this.button(menu, 'Resume', this.hooks.resume, 'primary');
    this.button(menu, 'Journal', () => this.show('journal', 'pause'));
    this.button(menu, 'Map', () => this.show('map', 'pause'));
    this.button(menu, 'Settings', () => this.show('settings', 'pause'));
    this.button(menu, 'Controls', () => this.show('controls', 'pause'));
    this.button(menu, 'Restart investigation', () => {
      if (confirm('Restart from the trailhead? Your progress will be lost.')) this.hooks.restart();
    });
    this.button(menu, 'Quit to title', this.hooks.quitToTitle);
    const foot = el('div', 'title-foot');
    foot.textContent = 'Poacher Panic · a Sumix Developers game';
    p.appendChild(foot);
  }

  private settingsScreen(p: HTMLElement): void {
    const s = { ...this.settings };
    const startQuality = s.quality;
    const h = el('h2', 'screen-title');
    h.textContent = 'Settings';
    p.appendChild(h);
    const form = el('div', 'settings');
    p.appendChild(form);
    const row = (label: string, control: HTMLElement, note = '') => {
      const r = el('label', 'set-row');
      const l = el('span', 'set-label');
      l.textContent = label;
      r.append(l, control);
      if (note) {
        const n = el('span', 'set-note');
        n.textContent = note;
        r.appendChild(n);
      }
      form.appendChild(r);
    };
    const quality = document.createElement('div');
    quality.className = 'seg';
    (['low', 'medium', 'high'] as Quality[]).forEach((q) => {
      const b = document.createElement('button');
      b.textContent = q[0].toUpperCase() + q.slice(1);
      b.className = s.quality === q ? 'on' : '';
      b.addEventListener('click', (e) => {
        e.preventDefault();
        s.quality = q;
        quality.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
      });
      quality.appendChild(b);
    });
    row('Graphics quality', quality, 'Low suits integrated graphics; changing it reloads the game.');
    const slider = (min: number, max: number, step: number, value: number, onInput: (v: number) => void, fmt: (v: number) => string) => {
      const wrap = el('span', 'set-slider');
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(value);
      const out = el('span', 'set-value');
      out.textContent = fmt(value);
      input.addEventListener('input', () => {
        onInput(Number(input.value));
        out.textContent = fmt(Number(input.value));
      });
      wrap.append(input, out);
      return wrap;
    };
    row('Mouse sensitivity', slider(0.3, 2.5, 0.05, s.mouseSensitivity, (v) => (s.mouseSensitivity = v), (v) => v.toFixed(2)));
    row('Field of view', slider(55, 90, 1, s.fov, (v) => (s.fov = v), (v) => `${v}°`));
    row('Volume', slider(0, 1, 0.05, s.masterVolume, (v) => (s.masterVolume = v), (v) => `${Math.round(v * 100)}%`));
    const check = (value: boolean, onChange: (v: boolean) => void) => {
      const c = document.createElement('input');
      c.type = 'checkbox';
      c.checked = value;
      c.addEventListener('change', () => onChange(c.checked));
      return c;
    };
    row('Invert mouse Y', check(s.invertY, (v) => (s.invertY = v)));
    row('Show frame time', check(s.showFps, (v) => (s.showFps = v)));
    const actions = el('div', 'title-menu row');
    p.appendChild(actions);
    this.button(actions, 'Apply', () => {
      this.settings = s;
      this.hooks.applySettings(s, s.quality !== startQuality);
      this.show(this.returnTo);
    }, 'primary');
    this.button(actions, 'Back', () => this.show(this.returnTo));
  }

  private controlsScreen(p: HTMLElement): void {
    const h = el('h2', 'screen-title');
    h.textContent = 'Controls';
    p.appendChild(h);
    const grid = el('div', 'controls-grid');
    const rows: [string, string][] = [
      ['W A S D', 'Walk / drive and steer'],
      ['Mouse', 'Look (orbit camera while driving)'],
      ['Shift', 'Run'],
      ['Space', 'Jump · handbrake while driving'],
      ['Ctrl / Q', 'Crouch'],
      ['E', 'Interact · get in and out of the truck'],
      ['F', 'Flashlight'],
      ['L', 'Headlights'],
      ['C', 'Chase / cockpit camera'],
      ['Hold R', 'Recover the truck if it is stuck or upset'],
      ['T', 'Truck radio (when available)'],
      ['J / Tab', 'Journal and clues'],
      ['M', 'Map'],
      ['Esc', 'Pause'],
    ];
    for (const [k, v] of rows) {
      const key = el('span', 'ctl-key');
      key.textContent = k;
      const val = el('span', 'ctl-val');
      val.textContent = v;
      grid.append(key, val);
    }
    p.appendChild(grid);
    const actions = el('div', 'title-menu row');
    p.appendChild(actions);
    this.button(actions, 'Back', () => this.show(this.returnTo), 'primary');
  }

  private creditsScreen(p: HTMLElement): void {
    const h = el('h2', 'screen-title');
    h.textContent = 'Credits';
    p.appendChild(h);
    const txt = el('div', 'credits');
    txt.innerHTML = `
      <p class="credits-studio">A <b>Sumix Developers</b> game</p>
      <p>Developed by <b>Sumix Developers</b>: design, code, procedural trees, vehicles, structures and sound.</p>
      <p>Photographic textures and props (ground, bark, planks, metal, fern, grass, leaves, generator, radio, desk, logbook, searchlight, ammo box, bolt cutters, binoculars and more) from <b>Poly Haven</b> (polyhaven.com), released under <b>CC0</b>.</p>
      <p>Built with three.js (MIT) and Rapier physics (Apache-2.0).</p>
      <p>All people, places and agencies are fictional.</p>`;
    p.appendChild(txt);
    const actions = el('div', 'title-menu row');
    p.appendChild(actions);
    this.button(actions, 'Back', () => this.show(this.returnTo), 'primary');
  }

  private journalScreen(p: HTMLElement): void {
    p.classList.add('wide');
    const j = this.hooks.journal();
    const h = el('h2', 'screen-title');
    h.textContent = 'Journal';
    p.appendChild(h);
    const cols = el('div', 'journal');
    const left = el('div', 'journal-left');
    const lab = el('div', 'hud-label');
    lab.textContent = 'Current objective';
    const obj = el('div', 'journal-objective');
    obj.textContent = j.objective;
    const sub = el('div', 'journal-sub');
    sub.textContent = j.sub;
    const prog = el('div', 'journal-progress');
    prog.textContent = j.progress;
    const hintBox = el('div', 'journal-hint');
    left.append(lab, obj, sub, prog);
    if (j.missions?.length) {
      // Mission log: completed, current (with objectives) and locked missions.
      const ml = el('div', 'hud-label');
      ml.textContent = 'Missions';
      ml.style.marginTop = '14px';
      const list = el('div', 'mission-log');
      j.missions.forEach((m, i) => {
        const row = el('div', `mission-row ${m.status}`);
        const t = el('div', 'mission-title');
        t.textContent = `${i + 1}. ${m.status === 'locked' ? 'Locked' : m.title}`;
        row.appendChild(t);
        if (m.status === 'current') {
          for (const o of m.objectives) {
            const r = el('div', `mission-obj${o.done ? ' done' : ''}`);
            r.textContent = o.text;
            row.appendChild(r);
          }
        }
        list.appendChild(row);
      });
      left.append(ml, list);
    }
    this.button(left, 'Need a hint?', () => {
      hintBox.textContent = this.hooks.requestHint();
      hintBox.classList.add('visible');
    });
    left.appendChild(hintBox);
    const right = el('div', 'journal-right');
    const lab2 = el('div', 'hud-label');
    lab2.textContent = `Evidence (${j.clues.length})`;
    right.appendChild(lab2);
    if (!j.clues.length) {
      const empty = el('div', 'journal-empty');
      empty.textContent = 'Nothing yet. Look around for anything out of place.';
      right.appendChild(empty);
    }
    for (const c of [...j.clues].reverse()) {
      const item = el('div', 'clue');
      const ct = el('div', 'clue-title');
      ct.textContent = c.title;
      const cb = el('div', 'clue-text');
      cb.textContent = c.text;
      item.append(ct, cb);
      right.appendChild(item);
    }
    cols.append(left, right);
    p.appendChild(cols);
    const actions = el('div', 'title-menu row');
    p.appendChild(actions);
    this.button(actions, 'Close', this.hooks.resume, 'primary');
    this.button(actions, 'Map', () => this.show('map', this.returnTo));
  }

  private mapScreen(p: HTMLElement): void {
    p.classList.add('wide', 'map-panel');
    const st = this.hooks.mapState();
    const size = 1024;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    c.className = 'map-canvas';
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.mapCanvas(size), 0, 0);
    const toPx = (v: number) => ((v + WORLD_HALF) / (WORLD_HALF * 2)) * size;
    ctx.font = '600 20px "Segoe UI", Arial';
    for (const [k, l] of Object.entries(LANDMARKS)) {
      if (!st.reveals.has(k)) continue;
      ctx.fillStyle = '#2f2418';
      ctx.beginPath();
      ctx.arc(toPx(l.x), toPx(l.z), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(l.label, toPx(l.x) + 10, toPx(l.z) + 6);
    }
    if (st.target) {
      ctx.strokeStyle = '#a5552a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(toPx(st.target.x), toPx(st.target.z), 14, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Truck and player.
    ctx.fillStyle = '#3d4a35';
    ctx.fillRect(toPx(st.truck.x) - 7, toPx(st.truck.z) - 7, 14, 14);
    ctx.save();
    ctx.translate(toPx(st.player.x), toPx(st.player.z));
    ctx.rotate((st.player.heading * Math.PI) / 180);
    ctx.fillStyle = '#b4401f';
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.lineTo(9, 10);
    ctx.lineTo(0, 5);
    ctx.lineTo(-9, 10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    p.appendChild(c);
    const legend = el('div', 'map-legend');
    legend.innerHTML = '<span><i class="lg-you"></i>You</span><span><i class="lg-truck"></i>Truck</span><span><i class="lg-target"></i>Objective</span>';
    p.appendChild(legend);
    const actions = el('div', 'title-menu row');
    p.appendChild(actions);
    this.button(actions, 'Close', this.hooks.resume, 'primary');
    this.button(actions, 'Journal', () => this.show('journal', this.returnTo));
  }

  showEnding(stats: { minutes: number; clues: string; km: number; missions?: string; accuracy?: string }, onContinue: () => void, onTitle: () => void): void {
    this.current = 'ending';
    this.root.innerHTML = '';
    this.root.className = 'screens open screen-ending';
    const panel = el('div', 'screen-panel ending');
    this.root.appendChild(panel);
    const t = el('h1', 'title-name');
    t.textContent = 'POACHER PANIC';
    const body = el('div', 'ending-text');
    body.innerHTML = `
      <p>The helicopter came down over the lookout clearing at dusk. Ranger Mara Hale was flown out with a broken ankle, two cracked ribs and a temper that, the flight medic said, was a good sign.</p>
      <p>Dale Kessler, his crew and his buyer were handed to state patrol at the Hollow Creek trailhead at last light, with the van, the ledger from the cache and fourteen sets of antlers. They were charged with poaching, trafficking wildlife, assaulting officers and running a ranger off Ridge Road.</p>
      <p>The ford track is open again. The Ridge Gate has a new chain.</p>`;
    const st = el('div', 'ending-stats');
    st.innerHTML = `<span><b>${stats.minutes}</b> minutes</span><span><b>${stats.clues}</b> evidence found</span><span><b>${stats.km.toFixed(1)}</b> km driven</span>${stats.missions ? `<span><b>${stats.missions}</b> missions</span>` : ''}${stats.accuracy ? `<span><b>${stats.accuracy}</b> accuracy</span>` : ''}`;
    const thanks = el('div', 'title-foot');
    thanks.textContent = 'Thanks for playing · Made by Sumix Developers';
    const menu = el('div', 'title-menu row');
    panel.append(t, body, st, thanks, menu);
    this.button(menu, 'Keep exploring', onContinue, 'primary');
    this.button(menu, 'Return to title', onTitle);
  }
}
