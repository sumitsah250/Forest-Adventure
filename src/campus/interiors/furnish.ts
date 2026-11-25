// Picks the furnisher for a room kind (work.ts, study.ts, living.ts), with a plain fallback.
import type { Furnisher, Kit, Room } from './kit.ts';
import { FURNISH as WORK } from './work.ts';
import { FURNISH as STUDY } from './study.ts';
import { FURNISH as LIVING } from './living.ts';

const ALL: Record<string, Furnisher> = { ...WORK, ...STUDY, ...LIVING };

/** Kinds whose furnisher hangs its own lights (the workshop halls). */
export function selfLit(kind: string): boolean {
  return kind in WORK;
}

export function furnishRoom(room: Room, k: Kit): void {
  const f = ALL[room.kind] ?? fallback;
  try {
    f(room, k);
  } catch (e) {
    console.warn(`furnishing ${room.building} / ${room.name} (${room.kind}) failed`, e);
  }
}

/** A desk and a cupboard: until a furnisher exists for the kind. */
const fallback: Furnisher = (r, k) => {
  const um = (r.u0 + r.u1) / 2;
  const vm = (r.v0 + r.v1) / 2;
  if (r.fits(um, vm, 1.4, 0.7)) {
    k.box('wood', um, vm, 0.72, 1.4, 0.04, 0.7, { solid: true });
    for (const du of [-0.62, 0.62]) for (const dv of [-0.28, 0.28]) k.box('metal', um + du, vm + dv, 0, 0.04, 0.72, 0.04);
  }
};
