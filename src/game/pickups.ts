// Weapon and ammunition pickups placed in the world. Each one is an interactable
// that hands its contents to the weapon system and remembers that it was taken
// (saved with the game), so nothing respawns or duplicates.

import * as THREE from 'three';
import { AMMO_MAX, AMMO_NAMES, WEAPONS, type AmmoType, type WeaponId } from '../weapons/defs.ts';
import type { WeaponSystem } from '../weapons/weaponSystem.ts';
import type { Interactable } from './interactions.ts';
import { placeModel } from '../render/models.ts';

export interface PickupHost {
  addInteractable(i: Interactable): void;
  weapons: WeaponSystem;
  toast(title: string, body: string): void;
  sound(kind: 'pickup' | 'ammo', pos: THREE.Vector3): void;
}

export class Pickups {
  readonly taken = new Set<string>();
  private objects_ = new Map<string, THREE.Object3D>();
  private host: PickupHost;
  private scene: THREE.Object3D;
  onTaken: ((id: string) => void) | null = null;

  constructor(host: PickupHost, scene: THREE.Object3D) {
    this.host = host;
    this.scene = scene;
  }

  /**
   * A weapon lying or racked in the world. `available` gates the prompt (for
   * example, a locked cabinet); `extraAmmo` comes with it.
   */
  weapon(id: string, weapon: WeaponId, object: THREE.Object3D, at: THREE.Vector3, opts: { extraAmmo?: number; prompt?: string; available?: () => boolean; range?: number } = {}): void {
    this.objects_.set(id, object);
    const def = WEAPONS[weapon];
    this.host.addInteractable({
      id: `pickup-${id}`,
      position: () => at,
      range: opts.range ?? 2.2,
      prompt: () => {
        if (this.taken.has(id) || (opts.available && !opts.available())) return null;
        return opts.prompt ?? `Take the ${def.name}`;
      },
      use: () => {
        this.take(id);
        this.host.weapons.give(weapon, { reserve: def.startReserve + (opts.extraAmmo ?? 0) });
      },
    });
  }

  /** A box of cartridges (Poly Haven ammo box) at a position. */
  async ammo(id: string, type: AmmoType, count: number, at: THREE.Vector3, rotY = 0): Promise<void> {
    const box = await placeModel('ammo_box', { size: 0.34 });
    box.position.copy(at);
    box.rotation.y = rotY;
    this.scene.add(box);
    this.objects_.set(id, box);
    this.host.addInteractable({
      id: `pickup-${id}`,
      position: () => at.clone().add(new THREE.Vector3(0, 0.15, 0)),
      range: 2.0,
      prompt: () => (this.taken.has(id) ? null : `Take ammunition (${AMMO_NAMES[type]} ×${count})`),
      use: () => {
        const got = this.host.weapons.addAmmo(type, count);
        this.take(id, false);
        this.host.toast('Ammunition', got > 0 ? `${AMMO_NAMES[type]}: +${got}` : `${AMMO_NAMES[type]} pouch already full (${AMMO_MAX[type]})`);
        this.host.sound('ammo', at);
      },
    });
  }

  /** Cartridges recovered from a gun dropped by a surrendered poacher. */
  dropped(id: string, weapon: WeaponId, object: THREE.Object3D): void {
    const def = WEAPONS[weapon];
    const count = Math.max(4, Math.round(def.magSize * (def.reload === 'magazine' ? 1 : 1.5)));
    this.objects_.set(id, object);
    this.host.addInteractable({
      id: `pickup-${id}`,
      position: () => object.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.2, 0)),
      range: 2.0,
      prompt: () => (this.taken.has(id) ? null : `Take ammunition from the ${def.category.toLowerCase()} (${AMMO_NAMES[def.ammo]})`),
      use: () => {
        const got = this.host.weapons.addAmmo(def.ammo, count);
        this.taken.add(id);
        this.host.toast('Ammunition', got > 0 ? `${AMMO_NAMES[def.ammo]}: +${got}` : `${AMMO_NAMES[def.ammo]} already full`);
        this.host.sound('ammo', object.getWorldPosition(new THREE.Vector3()));
      },
    });
  }

  /** Ammunition boxes owned by this module (for distance culling). */
  objects(): [string, THREE.Object3D][] {
    return [...this.objects_.entries()].filter(([id]) => id.startsWith('ammo'));
  }

  take(id: string, sound = true): void {
    if (this.taken.has(id)) return;
    this.taken.add(id);
    const o = this.objects_.get(id);
    if (o) o.visible = false;
    if (sound && o) this.host.sound('pickup', o.getWorldPosition(new THREE.Vector3()));
    this.onTaken?.(id);
  }

  /** Re-apply taken state after loading a save. */
  restore(ids: string[]): void {
    for (const id of ids) {
      this.taken.add(id);
      const o = this.objects_.get(id);
      if (o) o.visible = false;
    }
  }
}
