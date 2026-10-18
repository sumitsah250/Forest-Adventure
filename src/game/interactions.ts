// Look-at interaction targeting: the nearest enabled interactable within reach of
// the character and inside a small cone around the camera's view gets a prompt;
// E uses it (optionally hold-to-use). In third person the camera sits behind the
// character, so reach is measured from the character's head and aim from the view.

import * as THREE from 'three';

export interface Interactable {
  id: string;
  /** Current world position of the interaction point. */
  position: () => THREE.Vector3;
  /** Reach in metres. */
  range?: number;
  /** Prompt text, or null when not currently usable. */
  prompt: () => string | null;
  /** Seconds the key must be held (0 = press). */
  hold?: number;
  use: () => void;
  /** Interactables that remain usable even when not looked at directly (vehicles). */
  wide?: boolean;
}

export interface Target {
  item: Interactable;
  prompt: string;
  progress: number;
}

export class Interactions {
  private items: Interactable[] = [];
  private holdTime = 0;
  private holdId: string | null = null;
  current: Target | null = null;
  private v = new THREE.Vector3();

  add(item: Interactable): void {
    this.items.push(item);
  }

  remove(id: string): void {
    this.items = this.items.filter((i) => i.id !== id);
  }

  get(id: string): Interactable | undefined {
    return this.items.find((i) => i.id === id);
  }

  /**
   * Pick the target for this frame. `view` is the camera position and `forward` its
   * direction; `reach` (the character's head) limits the distance. Without `reach`
   * the view origin is used for both (first-person behaviour).
   */
  update(view: THREE.Vector3, forward: THREE.Vector3, use: boolean, holding: boolean, dt: number, reach?: THREE.Vector3): { used: Interactable | null } {
    let best: Interactable | null = null;
    let bestScore = -Infinity;
    let bestPrompt = '';
    const from = reach ?? view;
    for (const item of this.items) {
      const p = item.position();
      const d = p.distanceTo(from);
      const range = item.range ?? 2.4;
      if (d > range) continue;
      this.v.subVectors(p, view);
      const dv = this.v.length();
      const dot = this.v.dot(forward) / Math.max(dv, 1e-3);
      // Close to the character the cone is wider (objects at your feet or hands).
      const minDot = item.wide ? 0.35 : d < 1.2 ? 0.86 : 0.93;
      if (dot < minDot) continue;
      const prompt = item.prompt();
      if (!prompt) continue;
      const score = dot * 2 - d * 0.25;
      if (score > bestScore) {
        bestScore = score;
        best = item;
        bestPrompt = prompt;
      }
    }
    let used: Interactable | null = null;
    if (!best) {
      this.current = null;
      this.holdTime = 0;
      this.holdId = null;
      return { used };
    }
    const need = best.hold ?? 0;
    if (need > 0) {
      if (holding && (this.holdId === best.id || this.holdId === null)) {
        this.holdId = best.id;
        this.holdTime += dt;
        if (this.holdTime >= need) {
          used = best;
          this.holdTime = 0;
          this.holdId = null;
        }
      } else {
        this.holdTime = 0;
        this.holdId = null;
      }
    } else if (use) {
      used = best;
    }
    this.current = { item: best, prompt: bestPrompt, progress: need > 0 ? this.holdTime / need : 0 };
    if (used) used.use();
    return { used };
  }
}
