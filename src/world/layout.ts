// The designed world: every road, clearing and story location lives here so the
// terrain, vegetation, structures and mystery all agree on where things are.
// Coordinates: metres, +X east, -Z north, Y up. The map spans [-300, 300].

import type { PathDef } from './paths.ts';

export const WORLD_HALF = 300;
export const WORLD_SIZE = WORLD_HALF * 2;

/** Hollow Creek Road from the highway, past the station and bridge, then up Ridge Road to the lookout. */
export const MAIN_ROAD: PathDef = {
  id: 'main',
  kind: 'road',
  halfWidth: 2.5,
  points: [
    [96, 306], [80, 272], [62, 246], [46, 214], [24, 182], [2, 152], [-16, 124], [-22, 98],
    [-12, 72], [8, 48], [28, 28], [36, 10], [32, -12], [20, -36], [8, -60], [1, -82],
    [-4, -100], [-8, -116], [-20, -134], [-44, -149], [-68, -163], [-90, -176], [-104, -192],
    [-94, -207], [-82, -220], [-90, -233], [-102, -240],
  ],
};

/** Short gravel spur into the ranger station yard. */
export const STATION_SPUR: PathDef = {
  id: 'spur',
  kind: 'road',
  halfWidth: 2.3,
  points: [[34, 4], [44, 2.5], [54, 2]],
};

/** Muddy two-track detour Hale used to cross the creek after the bridge failed. */
export const FORD_TRACK: PathDef = {
  id: 'ford',
  kind: 'track',
  halfWidth: 1.6,
  points: [
    [13, -49], [30, -55], [49, -58], [63, -62], [69, -71], [70.5, -82], [61, -94], [39, -102],
    [17, -106], [-5, -107],
  ],
};

/** Faint foot trail toward the hidden camp east of the gate. */
export const CAMP_TRAIL: PathDef = {
  id: 'camp',
  kind: 'foot',
  halfWidth: 0.55,
  points: [[-6, -118], [6, -125], [20, -136], [32, -145], [40, -150]],
};

/** Route Hale took on foot from the wreck down to the Miller cabin, marked with flagging tape. */
export const TAPE_TRAIL: PathDef = {
  id: 'tape',
  kind: 'foot',
  halfWidth: 0.5,
  points: [[-80, -138], [-88, -141], [-100, -143], [-112, -151], [-121, -158], [-127, -164]],
};

export const TOWER_TRAIL: PathDef = {
  id: 'tower',
  kind: 'foot',
  halfWidth: 0.6,
  points: [[-101, -239], [-105, -243], [-108, -246]],
};

/** Path from the trailhead lot to the district training range. */
export const RANGE_TRAIL: PathDef = {
  id: 'range',
  kind: 'foot',
  halfWidth: 0.7,
  points: [[68, 233], [75, 229], [82, 224]],
};

/** The poachers' ATV trail from the hidden camp east to their base camp. */
export const ATV_TRAIL: PathDef = {
  id: 'atv',
  kind: 'foot',
  halfWidth: 0.85,
  points: [[45, -153], [62, -164], [80, -176], [100, -194], [118, -203], [134, -205]],
};

export const ROAD_DEFS: PathDef[] = [MAIN_ROAD, STATION_SPUR, FORD_TRACK, CAMP_TRAIL, TAPE_TRAIL, TOWER_TRAIL, RANGE_TRAIL, ATV_TRAIL];

/** Creek centreline with cross-section parameters per control point. */
export interface CreekPoint {
  x: number;
  z: number;
  /** Half width of the wetted channel. */
  channel: number;
  /** Half width of the flat valley floor beyond the channel. */
  floor: number;
  /** Rise of the valley walls per metre beyond the floor. */
  wall: number;
  /** Water depth at the centreline. */
  depth: number;
  /** Designed maximum water surface height. */
  level: number;
}

export const CREEK: CreekPoint[] = [
  { x: -306, z: -216, channel: 2.0, floor: 5, wall: 1.15, depth: 0.45, level: 19 },
  { x: -250, z: -200, channel: 2.2, floor: 6, wall: 1.15, depth: 0.55, level: 16.5 },
  { x: -205, z: -188, channel: 2.4, floor: 8, wall: 1.05, depth: 0.6, level: 13.5 },
  { x: -165, z: -170, channel: 2.6, floor: 12, wall: 0.95, depth: 0.65, level: 11 },
  { x: -130, z: -152, channel: 2.8, floor: 16, wall: 0.8, depth: 0.65, level: 9.2 },
  { x: -100, z: -132, channel: 2.8, floor: 13, wall: 0.6, depth: 0.6, level: 7.6 },
  { x: -72, z: -110, channel: 3.0, floor: 10, wall: 0.5, depth: 0.6, level: 6.2 },
  { x: -40, z: -92, channel: 3.0, floor: 9, wall: 0.4, depth: 0.7, level: 4.6 },
  { x: -12, z: -84, channel: 3.2, floor: 7, wall: 0.36, depth: 0.95, level: 3.4 },
  { x: 12, z: -80, channel: 3.2, floor: 7, wall: 0.36, depth: 0.95, level: 2.9 },
  { x: 40, z: -75, channel: 3.4, floor: 9, wall: 0.26, depth: 0.6, level: 2.1 },
  { x: 70, z: -72, channel: 6.8, floor: 11, wall: 0.18, depth: 0.24, level: 1.5 },
  { x: 100, z: -64, channel: 3.4, floor: 9, wall: 0.22, depth: 0.6, level: 0.8 },
  { x: 140, z: -50, channel: 3.2, floor: 8, wall: 0.24, depth: 0.7, level: -0.4 },
  { x: 185, z: -40, channel: 3.0, floor: 8, wall: 0.26, depth: 0.7, level: -1.6 },
  { x: 240, z: -34, channel: 3.0, floor: 8, wall: 0.3, depth: 0.7, level: -3.0 },
  { x: 306, z: -30, channel: 3.0, floor: 8, wall: 0.3, depth: 0.7, level: -4.4 },
];

export interface Clearing {
  id: string;
  x: number;
  z: number;
  /** Radius of the flattened area. */
  radius: number;
  /** Width of the blend back to natural terrain. */
  blend: number;
  /** Fraction of natural relief kept inside (0 = perfectly flat). */
  keep: number;
  /** Height offset applied to the sampled centre height. */
  offset?: number;
  /** No trees inside radius + this margin. */
  treeMargin: number;
}

export const CLEARINGS: Clearing[] = [
  { id: 'trailhead', x: 55, z: 236, radius: 21, blend: 14, keep: 0.12, treeMargin: 4 },
  { id: 'station', x: 60, z: 2, radius: 25, blend: 16, keep: 0.1, treeMargin: 3 },
  { id: 'lookout', x: -103, z: -242, radius: 15, blend: 12, keep: 0.15, treeMargin: 2 },
  { id: 'cabin', x: -127, z: -166, radius: 9, blend: 7, keep: 0.2, treeMargin: 1 },
  { id: 'camp', x: 40, z: -151, radius: 7, blend: 6, keep: 0.25, treeMargin: 0 },
  { id: 'gate', x: -8, z: -116, radius: 6, blend: 6, keep: 0.4, treeMargin: 1 },
  // Mission locations.
  { id: 'range', x: 96, z: 222, radius: 14, blend: 9, keep: 0.18, treeMargin: 1 },
  { id: 'cache', x: 92, z: -183, radius: 5, blend: 5, keep: 0.4, treeMargin: 0 },
  { id: 'basecamp', x: 150, z: -207, radius: 19, blend: 12, keep: 0.15, treeMargin: 1 },
];

/** Gravelled parking/yard areas (circle centre and radius). */
export const GRAVEL_PADS: { x: number; z: number; r: number }[] = [
  { x: 62.5, z: 231.5, r: 10 },
  { x: 50, z: 3, r: 11.5 },
  { x: -101, z: -239.5, r: 6.5 },
];

/** Areas kept free of trees and undergrowth (structures, vehicles, sightlines). */
export const EXCLUSIONS: { x: number; z: number; r: number }[] = [
  { x: 68.5, z: -1.5, r: 9.5 }, // ranger station
  { x: 77, z: 7, r: 4 }, // generator shed
  { x: 76, z: -12, r: 4 }, // radio mast
  { x: -15.2, z: 111.5, r: 5.5 }, // abandoned SUV
  { x: -80.5, z: -137.5, r: 4.5 }, // Unit 4 wreck
  { x: -128.5, z: -167.5, r: 6.5 }, // Miller cabin
  { x: -7.6, z: -115.2, r: 5 }, // ridge gate
  { x: 1.2, z: -82, r: 11 }, // bridge
  { x: -109.5, z: -248.5, r: 6.5 }, // lookout tower
  { x: 45.5, z: 241, r: 3 }, // info board
  { x: 40, z: -151, r: 6 }, // hidden camp
  { x: 69, z: -72, r: 9 }, // ford
  { x: 96, z: 222, r: 13 }, // training range
  { x: 92, z: -183, r: 4.5 }, // supply cache
  { x: 150, z: -207, r: 17 }, // poachers' base camp
  { x: -31, z: -141, r: 7 }, // Ridge Road roadblock
  { x: 55, z: -97, r: 8 }, // ford blockade
];

/** Story locations (positions are XZ; heights come from the terrain). */
export const SITES = {
  playerStart: { x: 58.5, z: 238.5, heading: 0.2 },
  /** Vehicle headings: forward = (sin h, cos h). */
  playerTruck: { x: 63.5, z: 231, heading: -2.36 },
  suv: { x: -15.2, z: 111.5, heading: Math.PI - 0.28 },
  station: { x: 68.5, z: -1.5, heading: -Math.PI / 2 },
  bridge: { x: 1.2, z: -82 },
  gate: { x: -7.6, z: -115.2 },
  wreck: { x: -80.5, z: -137.5, heading: 2.35 },
  wreckBend: { x: -68, z: -163 },
  cabin: { x: -128.5, z: -167.5, heading: 0.45 },
  camp: { x: 40, z: -151 },
  lookout: { x: -109.5, z: -248.5 },
  infoBoard: { x: 45.5, z: 241 },
  warningSign: { x: 70, z: 254 },
  entranceGate: { x: 74, z: 260 },
  /** Mission locations. Firing line at the west end of the range, targets east. */
  range: { x: 96, z: 222 },
  rangeLine: { x: 86, z: 222 },
  roadblock: { x: -31, z: -141 },
  cache: { x: 92, z: -183 },
  blockade: { x: 52, z: -99 },
  baseCamp: { x: 150, z: -207 },
} as const;
