// Road polylines for Kalki and the time trial. The points were copied from mapped roads
// (OpenStreetMap service roads in campusData.json); nothing here is invented.
// Shared by both story versions. No imports with side effects: scripts/check-story.mjs loads this in Node.

import type { Pt } from '../geo.ts';

export const RING_EAST: Pt[] = [[229, -56], [230, -35], [231, -18], [232, 12], [233, 40], [227, 48], [217, 57], [187, 85], [174, 91]];
export const RING_NORTH: Pt[] = [[163, 91], [129, 90], [106, 97], [82, 107], [66, 99], [49, 79], [34, 65], [16, 66], [11, 72], [-17, 120], [-37, 145]];
/** Mission 1's getaway: from behind the RIC past the fountain and the gate road, then up to the workshops. */
export const ESCAPE: Pt[] = [[20.8, -106.6], [40, -130], [65, -161], [82, -174], [95, -173], [103, -170], [128, -168], [155, -165], [165, -160], [228, -92], [229, -73], [229, -56]];
/**
 * The road from the gate-road junction round the east side of the fountain loop and out to the
 * main gate (two mapped service roads, joined end to end).
 */
export const GATE_ROAD: Pt[] = [[100.1, -170.8], [94.8, -172.6], [96.3, -174.7], [96.8, -177], [96.3, -179.5], [95.6, -183.7], [94.8, -189.4], [98.7, -192.3], [153.8, -241.1], [155.6, -242.6], [162.2, -248.7], [172.6, -257.3]];
/** V2 mission 10: from the east ring road down to the main gate (ESCAPE driven backwards, then GATE_ROAD). */
export const RING_TO_GATE: Pt[] = [[229, -56], [229, -73], [228, -92], [165, -160], [155, -165], [128, -168], [103, -170], ...GATE_ROAD];
/** The time-trial sprint: the east ring road north, then west to the hostels. */
export const TRIAL_ROUTE: Pt[] = [[229, -73], ...RING_EAST, ...RING_NORTH];
/** Where Kalki waits when the story starts (the asphalt ring road by the workshops). */
export const KART_HOME = { x: 229, z: -45, heading: 0 };


/** Time-trial medals (seconds). */
export const TRIAL_MEDALS = [
  { name: 'Gold', time: 52, coins: 200 },
  { name: 'Silver', time: 62, coins: 110 },
  { name: 'Bronze', time: 78, coins: 60 },
];
