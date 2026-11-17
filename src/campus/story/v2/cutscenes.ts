// V2 cutscenes as data (docs/STORY_V2.md, section 7). The player is cutscene.ts.
//
// HOW TO WRITE A SHOT
//
//   {
//     dur: 5,                                    // seconds
//     path: [                                    // camera path: 3 to 5 points, smoothed into a curve
//       { where: { building: RIC }, off: [28, 14, -28] },   // 28 m east, 14 m up, 28 m north of the RIC door
//       { where: { building: RIC }, off: [20, 9, -20] },
//       { where: { building: RIC }, off: [14, 6, -14] },
//     ],
//     look: { where: { building: RIC }, off: [0, 7, 0] },   // what the camera points at
//     ease: 'out',                               // 'linear' | 'in' | 'out' | 'inOut' (default)
//     fov: [55, 42],                             // optional zoom, degrees
//     timeScale: 0.3,                            // optional slow motion for the game world
//     card: { kicker: '…', title: '…', sub: '…' }, // optional big title
//     subtitles: [{ at: 1.2, who: 'mitra', text: T.cut.c1Mitra, dur: 3.5 }],
//     sounds: [{ at: 0.2, name: 'whoosh' }],
//     events: [{ at: 0.5, do: 'power', value: 0, over: 6 }],
//   }
//
// Points are always relative to something real: `where` is a place name from the map, `entity`
// is 'player', 'kart', 'gate' or 'npc:<id>'. The offset is [east, up, south] in metres; with
// `local: true` it is [right, up, ahead] of the thing (for a building, ahead is out from its
// door). `look` can be [from, to] to pan.
//
// Events (handled in main.ts, cutEvents):
//   power       value 0..1, over seconds   campus window lights (1 on, 0 blackout)
//   glow        value 0..1                 how strongly windows show while it is not fully dark (0 = normal)
//   drones      value count, place         MITRA drones appear there and their red eyes open (0 removes them)
//   tarp        arg 'on' | 'off'           the tarp over Kalki
//   headlights  value 1 | 0                Kalki's headlights
//   gate        value 0..1, over seconds   the main gate (1 open, 0 shut)
//   shake       value strength, over s     camera shake
//   screens     arg 'intruder' | 'reopened' | 'hero' | 'off'   the campus screens
//   lightning                              one lightning strike
//   mud         place                      mud slides off the bank there (C4)
//   radioStatic arg cast id, over seconds  that radio portrait breaks into static (C5)
//   silence     over seconds               nothing (a beat of quiet; music ducks in Phase 8)
//   dronesBlue                             every drone eye turns blue (C6)
//   bike        arg 'skid' | 'hide'        Sunil's motorbike skids and falls, or is removed
//   sky         arg 'dusk' | 'night' | 'predawn' | 'dawn', over seconds (0: at once)
//   clock       arg 'HH:MM|HH:MM', over s  a big clock spins from one time to the other (C8)
//   rain        value 0..1, over seconds   rain strength, until the cutscene ends
//   crowd       value count                students walk in through the main gate (C10)
//   credits     over seconds               the credits roll (text in text.ts, ending.credits)
// Entities: 'player', 'kart', 'gate', 'bike' (Sunil's motorbike) and 'npc:<id>'.
// A skipped cutscene still runs every event, so the world always ends in the same state.
//
// All text is in text.ts. Check your shots with `npm run check:story`.

import type { CutsceneDef, CutsceneId } from '../types.ts';
import { T } from './text.ts';

const RIC = 'Research and Innovation Centre (RIC)';

export const CUTSCENES: Partial<Record<CutsceneId, CutsceneDef>> = {
  // C1, game start, 20 s: down from the Annapurna range, over the main gate and the fest banner,
  // to the RIC. Lights die block by block. Red drone eyes open. Title card.
  C1: {
    shots: [
      {
        // The peaks, then down to the gate and its banner (the camera is outside, on Lamachaur Marg).
        dur: 6,
        path: [
          { entity: 'gate', off: [0, 120, -150], local: true },
          { entity: 'gate', off: [0, 55, -80], local: true },
          { entity: 'gate', off: [0, 10, -26], local: true },
        ],
        look: [{ entity: 'gate', off: [-300, 420, -2400] }, { entity: 'gate', off: [0, 4, 0] }],
        fov: [50, 46],
        sounds: [{ at: 0.1, name: 'whoosh' }],
        events: [
          { at: 0, do: 'tarp', arg: 'on' },
          { at: 0, do: 'power', value: 1, over: 0 },
          { at: 0, do: 'glow', value: 0.85 },
        ],
      },
      {
        // Over the gate and across campus to the RIC, as the lights go out behind us.
        dur: 7,
        path: [
          { entity: 'gate', off: [0, 10, -26], local: true },
          { entity: 'gate', off: [0, 9, 14], local: true },
          { where: { point: 'IOE fountain' }, off: [10, 26, -10] },
          { where: { building: RIC }, off: [10, 16, 46], local: true },
        ],
        look: [{ entity: 'gate', off: [0, 5, 60], local: true }, { where: { building: RIC }, off: [0, 6, 0] }],
        ease: 'inOut',
        sounds: [{ at: 1.2, name: 'switch' }, { at: 2.6, name: 'switch' }, { at: 4.0, name: 'switch' }, { at: 5.2, name: 'thunk' }],
        events: [{ at: 1, do: 'power', value: 0, over: 5 }],
      },
      {
        // The RIC in the dark, from the lawn in front of its door. Red eyes open above it.
        dur: 4.5,
        path: [
          { where: { building: RIC }, off: [10, 16, 46], local: true },
          { where: { building: RIC }, off: [7, 9, 34], local: true },
          { where: { building: RIC }, off: [4, 5, 25], local: true },
        ],
        look: { where: { building: RIC }, off: [0, 7, 0] },
        ease: 'out',
        sounds: [{ at: 0.8, name: 'sting' }],
        subtitles: [{ at: 1.0, who: 'mitra', text: T.cut.c1Mitra, dur: 3.3 }],
        events: [{ at: 0.6, do: 'drones', value: 3, place: { where: { building: RIC }, off: [0, 0, 6], local: true } }],
      },
      {
        // Title card.
        dur: 2.5,
        path: [
          { where: { building: RIC }, off: [4, 5, 25], local: true },
          { where: { building: RIC }, off: [3.6, 5.6, 24.6], local: true },
          { where: { building: RIC }, off: [3.2, 6.6, 24.4], local: true },
        ],
        look: { where: { building: RIC }, off: [0, 8, 0] },
        ease: 'linear',
        card: { kicker: T.cut.c1Kicker, title: T.cut.c1Title, sub: T.cut.c1Sub },
        events: [
          { at: 2.4, do: 'drones', value: 0 },
          { at: 2.4, do: 'glow', value: 0 },
        ],
      },
    ],
  },

  // M1_GATE, end of mission 1, 6 s: the main gate swings shut, the camera shakes, and MITRA names
  // the player on every speaker on campus.
  M1_GATE: {
    shots: [
      {
        // Inside the gate, looking out along the road as the leaves swing shut.
        dur: 3.2,
        path: [
          { entity: 'gate', off: [5, 3.6, 16], local: true },
          { entity: 'gate', off: [3, 2.8, 11], local: true },
          { entity: 'gate', off: [1.5, 2.2, 8], local: true },
        ],
        look: { entity: 'gate', off: [0, 2, -2], local: true },
        ease: 'out',
        fov: [52, 46],
        sounds: [{ at: 0.3, name: 'gateCreak' }, { at: 1.55, name: 'gateSlam' }],
        events: [
          { at: 0, do: 'gate', value: 1, over: 0 },
          { at: 0.35, do: 'gate', value: 0, over: 1.2 },
          { at: 1.55, do: 'shake', value: 0.6, over: 0.7 },
        ],
      },
      {
        // Up over the campus: every speaker carries MITRA's voice.
        dur: 4.2,
        path: [
          { entity: 'gate', off: [1.5, 2.2, 8], local: true },
          { entity: 'gate', off: [0, 14, 30], local: true },
          { entity: 'gate', off: [-8, 30, 60], local: true },
        ],
        look: [{ entity: 'gate', off: [0, 2, 0] }, { entity: 'gate', off: [0, 0, 180], local: true }],
        ease: 'inOut',
        sounds: [{ at: 0.1, name: 'speakers' }],
        subtitles: [
          { at: 0.2, who: 'mitra', text: T.cut.gateMitra, dur: 2.3 },
          { at: 2.5, who: 'mitra', text: T.cut.gateMitra2, dur: 1.7 },
        ],
      },
    ],
  },

  // C3, end of mission 3, 10 s: rise above the Power House as the lights come back block by
  // block, then push in on a campus screen showing the player's face.
  C3: {
    shots: [
      {
        dur: 4.5,
        path: [
          { where: { building: 'Power House' }, off: [-8, 3, 16], local: true },
          { where: { building: 'Power House' }, off: [-5, 13, 26], local: true },
          { where: { building: 'Power House' }, off: [0, 30, 44], local: true },
        ],
        look: [{ where: { building: 'Power House' }, off: [0, 3, 0] }, { where: { building: 'Power House' }, off: [0, 0, -40], local: true }],
        ease: 'inOut',
        sounds: [{ at: 0.3, name: 'power' }],
        events: [
          { at: 0.2, do: 'power', value: 1, over: 5 },
          { at: 2.2, do: 'screens', arg: 'intruder' },
        ],
      },
      {
        dur: 2,
        path: [
          { where: { building: 'Power House' }, off: [0, 30, 44], local: true },
          { where: { building: 'Power House' }, off: [-3, 14, 22], local: true },
          { where: { building: 'Power House', beside: -5 }, off: [0, 4, 12], local: true },
        ],
        look: { where: { building: 'Power House', beside: -5 }, off: [0, 2.6, 0] },
        ease: 'inOut',
      },
      {
        dur: 3.5,
        path: [
          { where: { building: 'Power House', beside: -5 }, off: [0, 4, 12], local: true },
          { where: { building: 'Power House', beside: -5 }, off: [0, 3, 6], local: true },
          { where: { building: 'Power House', beside: -5 }, off: [0, 2.7, 3.4], local: true },
        ],
        look: { where: { building: 'Power House', beside: -5 }, off: [0, 2.6, 0] },
        ease: 'out',
        fov: [50, 40],
        sounds: [{ at: 0.4, name: 'speakers' }],
      },
    ],
  },

  // C4, start of mission 5, 8 s: lightning silhouettes the WRC Parapet; mud slides off the bank.
  C4: {
    shots: [
      {
        dur: 3,
        path: [
          { where: { area: 'WRC Parapet' }, off: [-16, 6, 28] },
          { where: { area: 'WRC Parapet' }, off: [-14, 5, 24] },
          { where: { area: 'WRC Parapet' }, off: [-12, 4.5, 21] },
        ],
        look: { where: { area: 'WRC Parapet' }, off: [0, 3, 0] },
        ease: 'linear',
        events: [{ at: 0.6, do: 'lightning' }],
        sounds: [{ at: 1.6, name: 'thunder' }],
      },
      {
        dur: 5,
        path: [
          { where: { area: 'WRC Parapet' }, off: [-12, 4.5, 21] },
          { where: { area: 'WRC Parapet' }, off: [-9, 3.4, 17] },
          { where: { area: 'WRC Parapet' }, off: [-7, 2.8, 14] },
        ],
        look: { where: { area: 'WRC Parapet' }, off: [3, 2, -3] },
        ease: 'out',
        events: [
          { at: 0.4, do: 'lightning' },
          { at: 0.8, do: 'mud', place: { where: { area: 'WRC Parapet' }, off: [5, 4, -6] } },
        ],
        sounds: [{ at: 0.9, name: 'thunk' }, { at: 1.4, name: 'thunder' }],
      },
    ],
  },

  // C5, end of mission 6, 5 s: Asha's radio portrait breaks into static. Then only rain.
  C5: {
    shots: [
      {
        dur: 5,
        path: [
          { where: { building: 'WRC Library' }, off: [-6, 9, 24], local: true },
          { where: { building: 'WRC Library' }, off: [-3, 7, 18], local: true },
          { where: { building: 'WRC Library' }, off: [0, 5.5, 13], local: true },
        ],
        look: { where: { building: 'WRC Library' }, off: [0, 3, 0] },
        ease: 'linear',
        sounds: [{ at: 0.5, name: 'glitch' }, { at: 1.2, name: 'glitch' }],
        events: [
          { at: 0.3, do: 'radioStatic', arg: 'asha', over: 3 },
          { at: 2.0, do: 'silence', over: 3 },
        ],
      },
    ],
  },

  // C6, end of mission 7, 12 s: the relay comes out; every drone drops a metre, hangs, and lights
  // up blue. MITRA's memory types on screen.
  C6: {
    shots: [
      {
        dur: 3,
        path: [
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [3.5, 1.8, 4] },
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [3, 1.5, 3.2] },
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [2.4, 1.3, 2.6] },
        ],
        look: { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [0, 1.2, 0] },
        ease: 'out',
        sounds: [{ at: 0.4, name: 'unlock' }],
        events: [{ at: 0, do: 'drones', value: 4, place: { where: { point: 'Saraswati Temple', dx: -6, dz: 5 } } }],
      },
      {
        dur: 4,
        path: [
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [11, 5, 15] },
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [13, 6, 16] },
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [15, 7, 17] },
        ],
        look: { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [0, 7, 0] },
        ease: 'linear',
        sounds: [{ at: 0.5, name: 'powerDown' }, { at: 1.9, name: 'chirp' }],
        events: [{ at: 0.5, do: 'dronesBlue' }],
      },
      {
        dur: 5,
        path: [
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [15, 7, 17] },
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [12, 8, 13] },
          { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [9, 9, 10] },
        ],
        look: { where: { point: 'Saraswati Temple', dx: -6, dz: 5 }, off: [0, 7, 0] },
        ease: 'inOut',
        subtitles: [
          { at: 0.3, who: 'mitra', text: T.m7.c6Mitra, dur: 2.3 },
          { at: 2.7, who: 'mitra', text: T.m7.c6Mitra2, dur: 2.2 },
        ],
        events: [{ at: 4.9, do: 'drones', value: 0 }],
      },
    ],
  },

  // C8, before mission 10, 8 s: timelapse from night to pre-dawn over the campus, the clock
  // spinning from 11:40 PM to 5:20 AM, the rain dying away. Then the mission's title card.
  C8: {
    shots: [
      {
        dur: 7,
        path: [
          { where: { building: RIC }, off: [-50, 46, 60] },
          { where: { building: RIC }, off: [-40, 50, 45] },
          { where: { building: RIC }, off: [-30, 54, 30] },
        ],
        look: [{ where: { building: RIC }, off: [-60, 120, -700] }, { where: { building: RIC }, off: [-160, 260, -1400] }],
        ease: 'linear',
        fov: [52, 48],
        events: [
          { at: 0, do: 'sky', arg: 'night' },
          { at: 0, do: 'rain', value: 0.6 },
          { at: 0.4, do: 'clock', arg: '23:40|05:20', over: 5.8 },
          { at: 0.6, do: 'sky', arg: 'predawn', over: 5.8 },
          { at: 0.8, do: 'rain', value: 0, over: 4.5 },
        ],
      },
      {
        dur: 2.2,
        path: [
          { where: { building: RIC }, off: [-30, 54, 30] },
          { where: { building: RIC }, off: [-27, 55, 27] },
          { where: { building: RIC }, off: [-24, 56, 24] },
        ],
        look: { where: { building: RIC }, off: [-160, 260, -1400] },
        ease: 'out',
        card: { kicker: T.m10.c8Kicker, title: T.m10.title, sub: T.m10.brief },
      },
    ],
  },

  // C9, mission 10 climax, 10 s: slow motion as Sunil's motorbike skids at the gate road, MITRA
  // swings the main gate shut in front of him, and Bahadur Dai steps out.
  C9: {
    shots: [
      {
        dur: 4,
        path: [
          { entity: 'gate', off: [7, 1.4, 4], local: true },
          { entity: 'gate', off: [6.5, 1.2, 5.5], local: true },
          { entity: 'gate', off: [6, 1.1, 7], local: true },
        ],
        look: [{ entity: 'bike', off: [0, 0.8, 0] }, { entity: 'gate', off: [0, 1.5, 0] }],
        ease: 'inOut',
        fov: [44, 50],
        timeScale: 0.3,
        sounds: [{ at: 0.6, name: 'gateCreak' }, { at: 2.1, name: 'gateSlam' }],
        subtitles: [{ at: 0.5, who: 'mitra', text: T.m10.c9Mitra, dur: 2 }],
        events: [
          { at: 0, do: 'gate', value: 1, over: 0 },
          { at: 0.3, do: 'bike', arg: 'skid' },
          { at: 0.6, do: 'gate', value: 0, over: 1.5 },
          { at: 2.1, do: 'shake', value: 0.5, over: 0.6 },
        ],
      },
      {
        dur: 3,
        path: [
          { entity: 'gate', off: [-9, 4.5, 26], local: true },
          { entity: 'gate', off: [-7, 3.6, 22], local: true },
          { entity: 'gate', off: [-5, 3, 18], local: true },
        ],
        look: { entity: 'gate', off: [0, 1.4, 6], local: true },
        ease: 'out',
        subtitles: [{ at: 0.2, who: 'mitra', text: T.m10.c9Mitra2, dur: 2.7 }],
      },
      {
        dur: 3,
        path: [
          { entity: 'npc:bahadur', off: [-4, 2.2, 4] },
          { entity: 'npc:bahadur', off: [-3, 1.9, 3.2] },
          { entity: 'npc:bahadur', off: [-2.2, 1.7, 2.6] },
        ],
        look: { entity: 'npc:bahadur', off: [0, 1.5, 0] },
        ease: 'out',
        fov: [48, 42],
        sounds: [{ at: 0.3, name: 'thunk' }],
      },
    ],
  },

  // C10, the ending, 25 s: sunrise over the Annapurna range, the gates open, students pour in.
  // Credits.
  C10: {
    shots: [
      {
        dur: 7,
        path: [
          { entity: 'gate', off: [0, 6, 34], local: true },
          { entity: 'gate', off: [0, 10, 46], local: true },
          { entity: 'gate', off: [0, 16, 60], local: true },
        ],
        look: [{ entity: 'gate', off: [0, 3, 0] }, { entity: 'gate', off: [-300, 420, -2400] }],
        ease: 'inOut',
        fov: [50, 46],
        sounds: [{ at: 1, name: 'gateCreak' }, { at: 1.2, name: 'speakers' }],
        subtitles: [{ at: 1.4, who: 'mitra', text: T.ending.c10Mitra, dur: 3 }],
        events: [
          { at: 0, do: 'gate', value: 0, over: 0 },
          { at: 1, do: 'gate', value: 1, over: 3 },
          { at: 1.6, do: 'crowd', value: 18 },
        ],
      },
      {
        dur: 8,
        path: [
          { entity: 'gate', off: [7, 1.8, 16], local: true },
          { entity: 'gate', off: [6, 1.9, 13], local: true },
          { entity: 'gate', off: [5, 2, 10], local: true },
        ],
        look: { entity: 'gate', off: [0, 1.6, -3], local: true },
        ease: 'linear',
        card: { kicker: T.ending.c10Kicker, title: T.ending.c10Title, sub: T.ending.brief },
      },
      {
        dur: 10,
        path: [
          { entity: 'gate', off: [0, 8, 24], local: true },
          { entity: 'gate', off: [0, 26, 70], local: true },
          { where: { point: 'WRC Auditorium' }, off: [30, 40, 50] },
        ],
        look: [{ entity: 'gate', off: [0, 2, 30], local: true }, { where: { point: 'WRC Auditorium' }, off: [0, 6, 0] }],
        ease: 'inOut',
        events: [{ at: 0, do: 'credits', over: 10 }],
      },
    ],
  },

  // C2, middle of mission 1, 6 s: Asha pulls the tarp off Kalki. Headlight on. Low orbit.
  C2: {
    shots: [
      {
        dur: 2.2,
        path: [
          { entity: 'kart', off: [6.0, 2.4, 7.0], local: true },
          { entity: 'kart', off: [6.4, 1.9, 4.2], local: true },
          { entity: 'kart', off: [5.6, 1.4, 2.0], local: true },
        ],
        look: { entity: 'kart', off: [0, 0.6, 0] },
        ease: 'out',
        fov: 46,
        sounds: [{ at: 0.6, name: 'rummage' }, { at: 0.9, name: 'whoosh' }],
        subtitles: [{ at: 0.2, who: 'asha', text: T.cut.c2Asha, dur: 2.6 }],
        events: [{ at: 0.7, do: 'tarp', arg: 'off' }],
      },
      {
        dur: 3.8,
        path: [
          { entity: 'kart', off: [5.6, 1.4, 2.0], local: true },
          { entity: 'kart', off: [3.2, 0.8, 3.6], local: true },
          { entity: 'kart', off: [-0.4, 0.6, 4.3], local: true },
          { entity: 'kart', off: [-3.0, 0.8, 3.0], local: true },
          { entity: 'kart', off: [-3.8, 1.1, 0.6], local: true },
        ],
        look: { entity: 'kart', off: [0, 0.5, 0] },
        ease: 'inOut',
        fov: [46, 52],
        sounds: [{ at: 0.9, name: 'click' }, { at: 1.0, name: 'keys' }],
        subtitles: [{ at: 1.3, who: 'asha', text: T.cut.c2Asha2, dur: 2.2 }],
        events: [{ at: 0.9, do: 'headlights', value: 1 }],
      },
    ],
  },
};
