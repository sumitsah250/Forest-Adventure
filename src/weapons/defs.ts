// One table defines every weapon: the weapon system, HUD, audio, pickups and
// missions all read from it. Values are fictional game balance, not real-world
// ballistics. Hostile NPCs have 100 health.

export type WeaponId = 'p9' | 'bridger' | 'ranger12' | 'vireo' | 'marten' | 'ironwood' | 'ridgeline' | 'longwatch';
export type AmmoType = '9mm' | '.44' | '12ga' | '5.56' | '7.62' | '.30-06';
export type FireMode = 'semi' | 'auto' | 'pump' | 'bolt' | 'double-action';
export type ReloadStyle = 'magazine' | 'speedloader' | 'tube' | 'internal';
export type HoldStyle = 'pistol' | 'rifle';

export interface GunSound {
  /** Body thump centre frequency (Hz). */
  body: number;
  /** High-frequency crack level (0..1). */
  crack: number;
  /** Low boom level (0..1). */
  boom: number;
  /** Reverberant tail length (s). */
  tail: number;
  /** Overall loudness. */
  level: number;
  /** Mechanical action after the shot. */
  action: 'none' | 'slide' | 'pump' | 'bolt' | 'cylinder';
}

export interface WeaponDef {
  id: WeaponId;
  slot: number;
  name: string;
  category: string;
  /** One line shown on pickup and in the inventory. */
  role: string;
  hold: HoldStyle;
  ammo: AmmoType;
  magSize: number;
  /** Reserve ammunition granted with the weapon. */
  startReserve: number;
  fire: FireMode;
  /** Minimum seconds between shots (or pump/bolt cycle). */
  cycle: number;
  pellets: number;
  damage: number;
  headMultiplier: number;
  /** Distance (m) up to which full damage applies; falls to 55% at `maxRange`. */
  range: number;
  maxRange: number;
  /** Cone half-angle in degrees. */
  spreadHip: number;
  spreadAim: number;
  /** Extra spread per shot (degrees) and cap. */
  bloom: number;
  bloomMax: number;
  /** Camera kick per shot (degrees up, random +/- sideways). */
  recoilPitch: number;
  recoilYaw: number;
  /** Visual kick of the gun (metres back / radians up). */
  kick: number;
  kickRot: number;
  reload: ReloadStyle;
  /** Full reload time (s); per-round time for tube/internal. */
  reloadTime: number;
  /** Extra time when the gun was empty (slide release, bolt). */
  emptyExtra: number;
  /** Camera distance and FOV factor while aiming. */
  aimDistance: number;
  aimFov: number;
  /** Seconds to raise to full aim. */
  adsTime: number;
  /** Scope field of view (degrees), if the weapon has a scope. */
  scopeFov?: number;
  /** Chance a body hit staggers a target (interrupts aim). */
  stagger: number;
  sound: GunSound;
  /** Speed multiplier while carrying (heavy guns are slower). */
  moveScale: number;
}

export const AMMO_NAMES: Record<AmmoType, string> = {
  '9mm': '9 mm',
  '.44': '.44 Magnum',
  '12ga': '12 gauge',
  '5.56': '5.56 mm',
  '7.62': '7.62 mm',
  '.30-06': '.30-06',
};

/** Reserve ammunition caps per type. */
export const AMMO_MAX: Record<AmmoType, number> = {
  '9mm': 180,
  '.44': 48,
  '12ga': 40,
  '5.56': 240,
  '7.62': 100,
  '.30-06': 40,
};

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  p9: {
    id: 'p9', slot: 1, name: 'Warden P9', category: 'Compact pistol',
    role: 'Light, quick and accurate up close. The ranger\'s service sidearm.',
    hold: 'pistol', ammo: '9mm', magSize: 15, startReserve: 45, fire: 'semi', cycle: 0.15, pellets: 1,
    damage: 24, headMultiplier: 2.0, range: 25, maxRange: 60,
    spreadHip: 1.8, spreadAim: 0.45, bloom: 0.35, bloomMax: 2.0, recoilPitch: 1.1, recoilYaw: 0.35,
    kick: 0.03, kickRot: 0.22, reload: 'magazine', reloadTime: 1.45, emptyExtra: 0.35,
    aimDistance: 1.8, aimFov: 0.88, adsTime: 0.16, stagger: 0.1,
    sound: { body: 900, crack: 0.65, boom: 0.25, tail: 0.9, level: 0.75, action: 'slide' }, moveScale: 1,
  },
  bridger: {
    id: 'bridger', slot: 2, name: 'Bridger .44', category: 'Heavy revolver',
    role: 'Six rounds that hit hard. Slow to fire and reload; rewards a steady aim.',
    hold: 'pistol', ammo: '.44', magSize: 6, startReserve: 18, fire: 'double-action', cycle: 0.42, pellets: 1,
    damage: 58, headMultiplier: 2.0, range: 35, maxRange: 80,
    spreadHip: 2.4, spreadAim: 0.32, bloom: 0.9, bloomMax: 3.0, recoilPitch: 4.6, recoilYaw: 0.9,
    kick: 0.05, kickRot: 0.55, reload: 'speedloader', reloadTime: 2.5, emptyExtra: 0,
    aimDistance: 1.75, aimFov: 0.85, adsTime: 0.2, stagger: 0.6,
    sound: { body: 520, crack: 0.9, boom: 0.75, tail: 1.6, level: 1.0, action: 'cylinder' }, moveScale: 1,
  },
  ranger12: {
    id: 'ranger12', slot: 3, name: 'Ranger 12', category: 'Pump-action shotgun',
    role: 'Nine pellets per shell: decisive inside 15 m, nearly useless beyond 30.',
    hold: 'rifle', ammo: '12ga', magSize: 6, startReserve: 18, fire: 'pump', cycle: 0.85, pellets: 9,
    damage: 13, headMultiplier: 1.5, range: 10, maxRange: 32,
    spreadHip: 3.6, spreadAim: 2.6, bloom: 0, bloomMax: 0, recoilPitch: 6.5, recoilYaw: 1.4,
    kick: 0.07, kickRot: 0.32, reload: 'tube', reloadTime: 0.52, emptyExtra: 0.5,
    aimDistance: 1.55, aimFov: 0.9, adsTime: 0.28, stagger: 0.8,
    sound: { body: 300, crack: 0.55, boom: 1.0, tail: 1.8, level: 1.0, action: 'pump' }, moveScale: 0.97,
  },
  vireo: {
    id: 'vireo', slot: 4, name: 'Vireo SMG', category: 'Submachine gun',
    role: 'Fast, controllable automatic fire for close and medium range.',
    hold: 'rifle', ammo: '9mm', magSize: 30, startReserve: 90, fire: 'auto', cycle: 0.075, pellets: 1,
    damage: 17, headMultiplier: 1.8, range: 22, maxRange: 55,
    spreadHip: 2.4, spreadAim: 0.95, bloom: 0.22, bloomMax: 2.6, recoilPitch: 0.75, recoilYaw: 0.45,
    kick: 0.018, kickRot: 0.05, reload: 'magazine', reloadTime: 2.1, emptyExtra: 0.45,
    aimDistance: 1.6, aimFov: 0.88, adsTime: 0.2, stagger: 0.12,
    sound: { body: 820, crack: 0.5, boom: 0.25, tail: 0.8, level: 0.65, action: 'none' }, moveScale: 1,
  },
  marten: {
    id: 'marten', slot: 5, name: 'Marten AR', category: 'Assault rifle',
    role: 'The all-rounder: accurate red-dot optic and steady automatic fire at medium range.',
    hold: 'rifle', ammo: '5.56', magSize: 30, startReserve: 90, fire: 'auto', cycle: 0.088, pellets: 1,
    damage: 26, headMultiplier: 2.0, range: 60, maxRange: 140,
    spreadHip: 2.2, spreadAim: 0.28, bloom: 0.16, bloomMax: 1.8, recoilPitch: 0.95, recoilYaw: 0.4,
    kick: 0.022, kickRot: 0.06, reload: 'magazine', reloadTime: 2.3, emptyExtra: 0.45,
    aimDistance: 1.5, aimFov: 0.78, adsTime: 0.24, stagger: 0.2,
    sound: { body: 700, crack: 0.85, boom: 0.45, tail: 1.4, level: 0.85, action: 'none' }, moveScale: 0.98,
  },
  ironwood: {
    id: 'ironwood', slot: 6, name: 'Ironwood BR', category: 'Battle rifle',
    role: 'Semi-automatic 7.62: heavy hits that stagger targets out of their aim. Slow to raise.',
    hold: 'rifle', ammo: '7.62', magSize: 20, startReserve: 40, fire: 'semi', cycle: 0.2, pellets: 1,
    damage: 47, headMultiplier: 2.2, range: 90, maxRange: 200,
    spreadHip: 2.8, spreadAim: 0.22, bloom: 0.6, bloomMax: 2.4, recoilPitch: 2.7, recoilYaw: 0.7,
    kick: 0.035, kickRot: 0.12, reload: 'magazine', reloadTime: 2.6, emptyExtra: 0.5,
    aimDistance: 1.5, aimFov: 0.74, adsTime: 0.36, stagger: 0.95,
    sound: { body: 480, crack: 1.0, boom: 0.8, tail: 2.0, level: 1.0, action: 'none' }, moveScale: 0.93,
  },
  ridgeline: {
    id: 'ridgeline', slot: 7, name: 'Ridgeline .30-06', category: 'Hunting rifle',
    role: 'A walnut bolt-action: one deliberate, precise shot at a time out to long range.',
    hold: 'rifle', ammo: '.30-06', magSize: 5, startReserve: 15, fire: 'bolt', cycle: 1.05, pellets: 1,
    damage: 92, headMultiplier: 2.5, range: 150, maxRange: 300,
    spreadHip: 3.4, spreadAim: 0.07, bloom: 0, bloomMax: 0, recoilPitch: 5.0, recoilYaw: 0.8,
    kick: 0.05, kickRot: 0.16, reload: 'internal', reloadTime: 0.55, emptyExtra: 0.4,
    aimDistance: 1.45, aimFov: 0.62, adsTime: 0.34, stagger: 1,
    sound: { body: 420, crack: 1.0, boom: 0.9, tail: 2.4, level: 1.0, action: 'bolt' }, moveScale: 0.95,
  },
  longwatch: {
    id: 'longwatch', slot: 8, name: 'Longwatch DMR', category: 'Scoped marksman rifle',
    role: 'Semi-automatic precision rifle with a 6x scope. Hold Shift to steady your breath.',
    hold: 'rifle', ammo: '7.62', magSize: 10, startReserve: 30, fire: 'semi', cycle: 0.32, pellets: 1,
    damage: 70, headMultiplier: 2.4, range: 220, maxRange: 400,
    spreadHip: 3.2, spreadAim: 0.05, bloom: 0.35, bloomMax: 1.2, recoilPitch: 2.9, recoilYaw: 0.5,
    kick: 0.035, kickRot: 0.1, reload: 'magazine', reloadTime: 2.7, emptyExtra: 0.45,
    aimDistance: 1.45, aimFov: 0.7, adsTime: 0.4, scopeFov: 11, stagger: 0.9,
    sound: { body: 470, crack: 1.0, boom: 0.8, tail: 2.2, level: 0.95, action: 'none' }, moveScale: 0.92,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['p9', 'bridger', 'ranger12', 'vireo', 'marten', 'ironwood', 'ridgeline', 'longwatch'];
