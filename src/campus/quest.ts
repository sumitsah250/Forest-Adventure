// Campus Quest progression: hosts at their posts, fetch items, the gold beacon, dialogue,
// quizzes with lives, scoring and the save game.

import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/physics.ts';
import { placeModel } from '../render/models.ts';
import { DATA, buildingAt, centroid, findArea, findBuilding, findPoint, pointInPoly } from './geo.ts';
import type { CampusGround } from './ground.ts';
import { LEVELS, type ItemDef, type LevelDef, type Where } from './levels.ts';
import { Person } from './people.ts';
import { QUESTIONS, shuffled, type Question } from './questions.ts';
import type { CampusUI, NavTarget } from './ui.ts';
import type { CampusWorld } from './world.ts';

const SAVE_KEY = 'campus-quest-save-v1';
const MAX_HEARTS = 3;
const REACH = 2.9;

type Stage = 'go' | 'fetch' | 'return';

interface Save {
  level: number;
  stage: Stage;
  got: number[];
  score: number;
  correct: number;
  answered: number;
  seconds: number;
}

interface Spot {
  x: number;
  z: number;
  facing: number;
}

interface ItemObj {
  def: ItemDef;
  index: number;
  spot: Spot;
  obj: THREE.Group;
  got: boolean;
}

export interface QuestContext {
  scene: THREE.Scene;
  world: CampusWorld;
  ground: CampusGround;
  physics: PhysicsWorld;
  ui: CampusUI;
  sound: (name: string) => void;
  /** Called when the last level is complete. */
  onFinished: (stats: { score: number; correct: number; answered: number; seconds: number }) => void;
}

export function loadSave(): Save | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Save;
    return typeof s.level === 'number' && s.level < LEVELS.length ? s : null;
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}

export class Quest {
  private c: QuestContext;
  private hosts: Person[] = [];
  private spots: Spot[] = [];
  private items: ItemObj[] = [];
  private beacon: Beacon;
  level = 0;
  stage: Stage = 'go';
  score = 0;
  correct = 0;
  answered = 0;
  seconds = 0;
  hearts = MAX_HEARTS;
  private streak = 0;
  private busy = false;
  private cooldown = 0;
  private near: { kind: 'host' } | { kind: 'item'; item: ItemObj } | null = null;

  constructor(c: QuestContext) {
    this.c = c;
    this.beacon = new Beacon();
    c.scene.add(this.beacon.group);
    // Every host waits at their post from the start, so the campus feels staffed.
    LEVELS.forEach((lv) => {
      const s = this.resolve(lv.where, lv.place);
      this.spots.push(s);
      const p = new Person(c.scene, lv.host.outfit, c.ground, c.physics, s.x, s.z, s.facing, lv.host.name);
      c.physics.addCylinder(s.x, c.ground.standAt(s.x, s.z), s.z, 0.85, 0.32);
      this.hosts.push(p);
    });
  }

  get def(): LevelDef {
    return LEVELS[Math.min(this.level, LEVELS.length - 1)];
  }

  get people(): Person[] {
    return this.hosts;
  }

  /** Starts a new game or resumes a save. */
  async begin(save: Save | null): Promise<void> {
    if (save) {
      this.level = save.level;
      this.stage = save.stage;
      this.score = save.score;
      this.correct = save.correct;
      this.answered = save.answered;
      this.seconds = save.seconds;
    } else {
      this.level = 0;
      this.stage = 'go';
      this.score = this.correct = this.answered = this.seconds = 0;
    }
    this.hearts = MAX_HEARTS;
    await this.setupLevel(save?.got ?? []);
  }

  private async setupLevel(got: number[]): Promise<void> {
    for (const it of this.items) this.c.scene.remove(it.obj);
    this.items = [];
    const lv = this.def;
    if (lv.fetch && this.stage !== 'go') {
      for (const [i, d] of lv.fetch.items.entries()) {
        const spot = this.resolve(d.where, d.label, true);
        const obj = await itemModel(d.model);
        obj.position.set(spot.x, this.c.ground.standAt(spot.x, spot.z), spot.z);
        obj.rotation.y = spot.facing;
        const already = got.includes(i);
        obj.visible = !already;
        this.c.scene.add(obj);
        this.items.push({ def: d, index: i, spot, obj, got: already });
      }
      if (this.stage === 'fetch' && this.items.every((it) => it.got)) this.stage = 'return';
    }
    this.refreshHud();
    this.save();
  }

  private refreshHud(): void {
    const ui = this.c.ui;
    const lv = this.def;
    ui.setLevel(this.level + 1, LEVELS.length, lv.title);
    ui.setHearts(this.hearts, MAX_HEARTS);
    ui.setScore(this.score);
    if (this.stage === 'fetch') {
      const left = this.items.filter((i) => !i.got);
      const short = (l: string) => l.split(': ').pop()!;
      ui.setObjective(`Find: ${left.map((i) => short(i.def.label)).join(' · ')}`, `${this.items.length - left.length} / ${this.items.length} collected · then return to ${lv.host.name}`);
    } else if (this.stage === 'return') {
      ui.setObjective(`Return to ${lv.host.name}`, lv.place);
    } else {
      ui.setObjective(`Go to ${lv.place}`, `Talk to ${lv.host.name} · ${lv.host.role}`);
    }
  }

  /** The current navigation target and any secondary markers. */
  targets(): { main: NavTarget | null; extra: NavTarget[] } {
    if (this.stage === 'fetch') {
      const left = this.items.filter((i) => !i.got);
      const p = this.playerPos;
      left.sort((a, b) => Math.hypot(a.spot.x - p.x, a.spot.z - p.z) - Math.hypot(b.spot.x - p.x, b.spot.z - p.z));
      const nav = left.map((i) => ({ x: i.spot.x, z: i.spot.z, label: i.def.label.split(':')[0] }));
      return { main: nav[0] ?? null, extra: nav.slice(1) };
    }
    const s = this.spots[this.level];
    if (!s) return { main: null, extra: [] };
    return { main: { x: s.x, z: s.z, label: this.def.host.name }, extra: [] };
  }

  private playerPos = new THREE.Vector3();

  update(dt: number, playing: boolean, player: THREE.Vector3, interactPressed: boolean): void {
    this.playerPos.copy(player);
    if (playing) this.seconds += dt;
    if (this.c.ui.modal || this.busy) this.cooldown = 0.35;
    else this.cooldown = Math.max(0, this.cooldown - dt);
    const t = performance.now() / 1000;
    for (const it of this.items) {
      if (it.got) continue;
      const glow = it.obj.getObjectByName('glow');
      if (glow) {
        glow.position.y = 1.2 + Math.sin(t * 2.4 + it.index) * 0.12;
        glow.rotation.y = t * 1.5;
      }
    }
    const { main } = this.targets();
    const host = this.hosts[this.level];
    if (main) {
      const y = this.c.ground.standAt(main.x, main.z);
      this.beacon.set(main.x, y, main.z, Math.hypot(player.x - main.x, player.z - main.z), t, this.stage !== 'fetch' ? 2.15 : 1.4);
    }
    this.beacon.group.visible = !!main;

    // What is in reach?
    this.near = null;
    let prompt: string | null = null;
    if (!this.busy && playing) {
      if (this.stage === 'fetch') {
        for (const it of this.items) {
          if (!it.got && Math.hypot(player.x - it.spot.x, player.z - it.spot.z) < REACH) {
            this.near = { kind: 'item', item: it };
            prompt = `${it.def.verb}: ${it.def.label}`;
            break;
          }
        }
      }
      if (!this.near && host && host.pos.distanceTo(player) < REACH + 0.4) {
        this.near = { kind: 'host' };
        prompt = `Talk to ${this.def.host.name}`;
      }
    }
    this.c.ui.setPrompt(prompt);
    if (interactPressed && this.near && this.cooldown <= 0) {
      const n = this.near;
      if (n.kind === 'item') this.collect(n.item);
      else void this.talk();
    }
  }

  /** Prompt currently shown (touch controls mirror it). */
  get promptText(): string | null {
    if (!this.near) return null;
    return this.near.kind === 'host' ? `Talk to ${this.def.host.name}` : `${this.near.item.def.verb}`;
  }

  private collect(it: ItemObj): void {
    it.got = true;
    it.obj.visible = false;
    this.c.sound('pickup');
    this.score += 50;
    this.c.ui.toast(`${it.def.label} ✓  +50`, 'good');
    if (this.items.every((i) => i.got)) {
      this.stage = 'return';
      this.c.sound('objective');
    }
    this.refreshHud();
    this.save();
  }

  private async talk(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const ui = this.c.ui;
    const lv = this.def;
    const host = lv.host;
    try {
      if (lv.id === 'graduation') {
        await ui.dialog(host.name, host.role, lv.intro);
        this.score += 500;
        this.level = LEVELS.length; // finished
        clearSave();
        this.c.onFinished({ score: this.score, correct: this.correct, answered: this.answered, seconds: this.seconds });
        return;
      }
      if (this.stage === 'go') {
        await ui.dialog(host.name, host.role, lv.intro);
        if (lv.fetch) {
          await ui.dialog(host.name, host.role, lv.fetch.request);
          this.stage = 'fetch';
          await this.setupLevel([]);
          this.c.sound('objective');
          return;
        }
      } else if (this.stage === 'fetch') {
        const left = this.items.filter((i) => !i.got).map((i) => i.def.label);
        await ui.dialog(host.name, host.role, [`You still need to bring: ${left.join(', ')}.`, 'Check the map (M) if you are lost.']);
        return;
      } else if (this.stage === 'return' && lv.fetch) {
        await ui.dialog(host.name, host.role, lv.fetch.back);
      }
      const passed = await this.quiz(lv);
      if (passed) {
        const bonus = 150 + this.hearts * 50;
        this.score += bonus;
        this.c.sound('clue');
        await ui.dialog(host.name, host.role, lv.pass);
        ui.toast(`Level ${this.level + 1} cleared!  +${bonus}`, 'good');
        this.level += 1;
        this.stage = 'go';
        this.hearts = MAX_HEARTS;
        await this.setupLevel([]);
      } else {
        await ui.message('Back paper!', `You ran out of lives. Talk to ${host.name} again to retake the ${lv.id === 'final' ? 'exam' : 'test'} — the questions change each time.`, 'Try again', 'bad');
        this.hearts = MAX_HEARTS;
        if (lv.fetch) this.stage = 'return';
        this.refreshHud();
        this.save();
      }
    } finally {
      this.busy = false;
    }
  }

  private async quiz(lv: LevelDef): Promise<boolean> {
    const pool: Question[] = lv.pool === 'final'
      ? shuffled(Object.values(QUESTIONS).flat())
      : lv.pool ? shuffled(QUESTIONS[lv.pool]) : [];
    let got = 0;
    let i = 0;
    this.hearts = MAX_HEARTS;
    this.streak = 0;
    while (got < lv.need) {
      if (i >= pool.length) i = 0;
      const q = pool[i++];
      const ok = await this.c.ui.ask(q, {
        header: `${lv.place} · ${lv.host.name}`,
        progress: `${got} / ${lv.need} correct`,
        hearts: this.hearts,
        maxHearts: MAX_HEARTS,
        timer: lv.timer,
      });
      this.answered += 1;
      if (ok) {
        got += 1;
        this.correct += 1;
        this.streak += 1;
        this.score += 100 + Math.min(this.streak - 1, 4) * 25;
      } else {
        this.streak = 0;
        this.hearts -= 1;
      }
      this.c.ui.setHearts(this.hearts, MAX_HEARTS);
      this.c.ui.setScore(this.score);
      if (this.hearts <= 0) return false;
    }
    return true;
  }

  /** Resets the current level to its first step (pause menu). */
  async restartLevel(): Promise<void> {
    this.stage = 'go';
    this.hearts = MAX_HEARTS;
    await this.setupLevel([]);
  }

  save(): void {
    if (this.level >= LEVELS.length) return;
    const s: Save = {
      level: this.level, stage: this.stage, got: this.items.filter((i) => i.got).map((i) => i.index),
      score: this.score, correct: this.correct, answered: this.answered, seconds: Math.round(this.seconds),
    };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable: progress lasts for this session only */
    }
  }

  /** Turns a level's "where" into a standing spot in front of the place. */
  private resolve(w: Where, label: string, item = false): Spot {
    const world = this.c.world;
    const side = item ? 1.6 : 0;
    const fromEntrance = (b: ReturnType<typeof findBuilding>, signLabel?: string): Spot | null => {
      if (!b) return null;
      const e = world.entranceFor(b, signLabel);
      // Items sit beside the door, not in front of it.
      const sx = Math.cos(e.facing) * side;
      const sz = -Math.sin(e.facing) * side;
      return { x: e.x + sx, z: e.z + sz, facing: e.facing };
    };
    if ('building' in w) {
      let b = w.building ? findBuilding(w.building) : undefined;
      const p = w.poi ? findPoint(w.poi) : undefined;
      if (!b && p) b = buildingAt(p.x, p.z);
      const s = fromEntrance(b, w.label);
      if (s) return s;
      if (p) return { x: p.x, z: p.z + 3, facing: 0 };
    } else if ('point' in w) {
      const p = findPoint(w.point);
      if (p) {
        const x = p.x + (w.dx ?? 0);
        const z = p.z + (w.dz ?? 0);
        const inside = DATA.buildings.find((b) => pointInPoly(x, z, b.pts));
        if (inside) {
          const s = fromEntrance(inside);
          if (s) return s;
        }
        return { x, z, facing: Math.atan2(-x, -z) };
      }
    } else if ('area' in w) {
      const a = findArea(w.area);
      if (a) {
        let [x, z] = centroid(a.pts);
        if (!pointInPoly(x, z, a.pts)) [x, z] = a.pts[0];
        return { x, z, facing: 0 };
      }
    }
    console.warn(`Campus Quest: could not place "${label}"`);
    return { x: 100, z: -120, facing: 0 };
  }
}

// ==================================================================== visuals

/** Gold light column with a floating marker over the current objective. */
class Beacon {
  readonly group = new THREE.Group();
  private column: THREE.Mesh;
  private gem: THREE.Mesh;
  private ring: THREE.Mesh;

  constructor() {
    const grad = document.createElement('canvas');
    grad.width = 4;
    grad.height = 128;
    const g = grad.getContext('2d')!;
    const lg = g.createLinearGradient(0, 0, 0, 128);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.7, 'rgba(255,255,255,0.55)');
    lg.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = lg;
    g.fillRect(0, 0, 4, 128);
    const alpha = new THREE.CanvasTexture(grad);
    const colMat = new THREE.MeshBasicMaterial({ color: '#ffcf4a', alphaMap: alpha, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, opacity: 0.5 });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 46, 16, 1, true), colMat);
    this.column.position.y = 23;
    this.column.renderOrder = 5;
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#b88a10', roughness: 0.3, metalness: 0.4 }));
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.group.add(this.column, this.gem, this.ring);
  }

  set(x: number, y: number, z: number, dist: number, t: number, gemHeight: number): void {
    this.group.position.set(x, y, z);
    // The column fades out as you arrive so it never blocks the conversation.
    const mat = this.column.material as THREE.MeshBasicMaterial;
    mat.opacity = THREE.MathUtils.clamp((dist - 4) / 20, 0, 1) * 0.55;
    this.column.scale.set(1 + Math.min(dist / 120, 2.5), 1, 1 + Math.min(dist / 120, 2.5));
    this.gem.position.y = gemHeight + 0.35 + Math.sin(t * 2.2) * 0.08;
    this.gem.rotation.y = t * 1.6;
    this.gem.visible = dist > 1.6;
    this.ring.scale.setScalar(1 + Math.sin(t * 3) * 0.06);
  }
}

async function itemModel(kind: ItemDef['model']): Promise<THREE.Group> {
  const g = new THREE.Group();
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.8, 12), new THREE.MeshStandardMaterial({ color: '#a29c90', roughness: 0.9 }));
  stand.position.y = 0.4;
  stand.castShadow = stand.receiveShadow = true;
  const top = 0.8;
  let model: THREE.Object3D | null = null;
  try {
    if (kind === 'book') model = await placeModel('binder_notebook', { size: 0.32 });
    else if (kind === 'toolbox') model = await placeModel('metal_toolbox', { size: 0.45 });
    else if (kind === 'breaker') model = await placeModel('power_box_01', { size: 0.6 });
  } catch {
    model = null;
  }
  if (kind === 'breaker') {
    // Wall-mounted breaker on a post.
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.6, 0.16), new THREE.MeshStandardMaterial({ color: '#4a4c4e', metalness: 0.5, roughness: 0.6 }));
    post.position.y = 0.8;
    g.add(post);
    if (model) {
      model.position.set(0, 1.0, 0.12);
      g.add(model);
    }
  } else if (kind === 'gnss') {
    const leg = new THREE.MeshStandardMaterial({ color: '#c9a03a', roughness: 0.5 });
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 6), leg);
      m.position.set(Math.cos(a) * 0.28, 0.75, Math.sin(a) * 0.28);
      m.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      g.add(m);
    }
    const rx = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16), new THREE.MeshStandardMaterial({ color: '#f0f0ea', roughness: 0.4 }));
    rx.position.y = 1.58;
    g.add(rx);
  } else {
    g.add(stand);
    if (kind === 'cube') {
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshStandardMaterial({ color: '#9d9a93', roughness: 1 }));
      cube.position.y = top + 0.075;
      g.add(cube);
    } else if (kind === 'usb') {
      const usb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.02), new THREE.MeshStandardMaterial({ color: '#c0302a', roughness: 0.4 }));
      usb.position.y = top + 0.01;
      g.add(usb);
    } else if (model) {
      model.position.y = top;
      g.add(model);
    }
  }
  // Floating sparkle so items read from a distance.
  const glow = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), new THREE.MeshStandardMaterial({ color: '#ffd24a', emissive: '#c9961a', roughness: 0.3 }));
  glow.name = 'glow';
  glow.position.y = 1.25;
  g.add(glow);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.75, 32), new THREE.MeshBasicMaterial({ color: '#ffd24a', transparent: true, opacity: 0.65, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  g.add(ring);
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.castShadow = true;
  });
  return g;
}
