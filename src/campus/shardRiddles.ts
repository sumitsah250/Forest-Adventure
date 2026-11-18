// Story 2: the old story's riddles, now optional bonus riddles. Each memory shard picked up
// (while one is not already open) unlocks the next unsolved riddle. Its answer is a real place
// on campus; nothing marks it until the player is within 16 m. Solving one pays coins.

import * as THREE from 'three';
import type { ItemModel, Step, Where } from './story.ts';
import { animateItem, itemModel } from './actors.ts';
import { saveProfile, type Profile } from './profile.ts';

type Riddle = Extract<Step, { kind: 'riddle' }>;

export interface ShardRiddleText {
  who: string;
  role: string;
  intro: string;
  found: string;
  near: string;
}

export interface ShardRiddleContext {
  scene: THREE.Scene;
  profile: Profile;
  riddles: Riddle[];
  text: ShardRiddleText;
  resolve: (w: Where, label: string) => { x: number; z: number };
  heightAt: (x: number, z: number) => number;
  dialog: (who: string, role: string, lines: string[]) => Promise<void>;
  toast: (text: string, kind?: 'good' | 'bad') => void;
  sound: (name: string) => void;
  reward: (at: THREE.Vector3, coins: number) => void;
}

/** Coins for a solved shard riddle. */
export const RIDDLE_COINS = 60;

export class ShardRiddles {
  private c: ShardRiddleContext;
  private obj: THREE.Group | null = null;
  private spot = { x: 0, z: 0 };
  private seen = false;
  private loading = -1;
  private at = new THREE.Vector3();

  constructor(c: ShardRiddleContext) {
    this.c = c;
    if (c.profile.riddleActive !== null) void this.place(c.profile.riddleActive);
  }

  /** A shard was picked up: open the next unsolved riddle, unless one is already open. */
  async offer(): Promise<void> {
    const p = this.c.profile;
    if (p.riddleActive !== null) return;
    const next = this.c.riddles.findIndex((_, i) => !p.riddles.includes(i));
    if (next < 0) return;
    p.riddleActive = next;
    saveProfile(p);
    const r = this.c.riddles[next];
    this.c.sound('radioBeep');
    await this.c.dialog(this.c.text.who, this.c.text.role, [this.c.text.intro, `"${r.riddle}"`]);
    await this.place(next);
  }

  private async place(i: number): Promise<void> {
    const r = this.c.riddles[i];
    if (!r || this.loading === i) return;
    this.loading = i;
    const obj = await itemModel(r.model as ItemModel);
    if (this.c.profile.riddleActive !== i) return;
    this.clear();
    const s = this.c.resolve(r.answer, r.label);
    this.spot.x = s.x;
    this.spot.z = s.z;
    obj.position.set(s.x, this.c.heightAt(s.x, s.z), s.z);
    obj.visible = false;
    this.c.scene.add(obj);
    this.obj = obj;
    this.seen = false;
    this.loading = -1;
  }

  private clear(): void {
    if (this.obj) this.c.scene.remove(this.obj);
    this.obj = null;
  }

  /** Per frame (allocation free). `busy`: a mission is running, so the riddle waits. */
  update(playing: boolean, busy: boolean, focus: THREE.Vector3, inKart: boolean): void {
    const o = this.obj;
    const p = this.c.profile;
    if (!o || p.riddleActive === null) return;
    const d = Math.hypot(focus.x - this.spot.x, focus.z - this.spot.z);
    if (!this.seen && d < 16 && playing && !busy) {
      this.seen = true;
      o.visible = true;
      this.c.sound('clue');
      this.c.toast(this.c.text.near, 'good');
    }
    if (!this.seen) return;
    animateItem(o, performance.now() / 1000, 7);
    if (playing && d < (inKart ? 3.4 : 2.2)) {
      p.riddles.push(p.riddleActive);
      p.riddleActive = null;
      p.coins += RIDDLE_COINS;
      saveProfile(p);
      this.c.sound('pickup');
      this.at.copy(o.position).setY(o.position.y + 1.1);
      this.c.reward(this.at, RIDDLE_COINS);
      this.c.toast(this.c.text.found.replace('{n}', String(RIDDLE_COINS)), 'good');
      this.clear();
    }
  }
}
