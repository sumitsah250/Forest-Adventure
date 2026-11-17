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
