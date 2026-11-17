// Story version 2: ten missions and the ending (docs/STORY_V2.md, section 4).
//
// Structure only. Every word shown to the player is in text.ts. Places are names from the map
// data; the few raw coordinates are ones the old story already used.
//
// Steps use the mechanics that exist today. Where V2 needs something that is not built yet,
// there is a `stub` step (or an ignored field) carrying a TODO_… id from ../types.ts, which
// names the phase that builds it. The runner skips stubs, so every mission can be played
// end to end now.

import { ESCAPE, RING_EAST, RING_NORTH, RING_TO_GATE } from '../routes.ts';
import type { MissionDef } from '../types.ts';
import { T } from './text.ts';

const RIC = 'Research and Innovation Centre (RIC)';
const DOECE = 'Department of Electronics and Computer Engineering';
/** Behind the RIC, where Asha waits with Kalki (the old story's spot). */
const BEHIND_RIC: [number, number] = [17, -103];

export const MISSIONS: MissionDef[] = [
  // ------------------------------------------------------------------ M1 Lights Out
  {
    id: 'v2-lights-out', title: T.m1.title, clock: '6:52 PM', location: T.m1.location, sky: 'dusk', par: 120, brief: T.m1.brief,
    kartAt: { x: 20.8, z: -106.6, heading: 2.46 },
    steps: [
      { kind: 'cutscene', id: 'C1' },
      { kind: 'radio', from: 'mitra', lines: T.m1.mitraStart },
      { kind: 'radio', from: 'asha', lines: T.m1.ashaRun },
      { kind: 'stealth', obj: T.m1.stealthObj, at: { xz: BEHIND_RIC }, label: T.m1.stealthLabel, model: 'relay', drones: 3, auto: true },
      { kind: 'talk', npc: 'asha', at: { xz: BEHIND_RIC }, lines: T.m1.ashaMeet },
      { kind: 'cutscene', id: 'C2' },
      { kind: 'kart', obj: T.m1.kartObj },
      { kind: 'drive', obj: T.m1.driveObj, route: ESCAPE, time: 70, pursuer: true },
      { kind: 'stub', todo: 'TODO_P4_GATE_SLAM', note: 'The main gate slams shut.' },
      { kind: 'radio', from: 'mitra', lines: T.m1.mitraEnd },
      { kind: 'radio', from: 'asha', lines: T.m1.ashaEnd },
    ],
    reward: { coins: 150, xp: 150, unlock: 'kalki', card: T.m1.card },
  },
  // ------------------------------------------------------------------ M2 Pit Stop
  {
    id: 'v2-pit-stop', title: T.m2.title, clock: '7:10 PM', location: T.m2.location, sky: 'dusk', par: 150, brief: T.m2.brief,
    steps: [
      { kind: 'talk', npc: 'dhungana', lines: T.m2.dhungana1 },
      {
        kind: 'puzzle', at: { building: 'Automobile Workshop II' }, label: T.m2.pumpLabel, obj: T.m2.pumpObj, model: 'part',
        puzzle: { type: 'gauge', title: T.m2.pumpTitle, clue: T.m2.pumpClue, hits: 3, speed: 0.9 },
      },
      { kind: 'talk', npc: 'dhungana', lines: T.m2.dhungana2 },
      { kind: 'drive', obj: T.m2.driveObj, route: RING_EAST, time: 50 },
      // Clue c1 (the red pen drive, never mentioned) is found by an optional "look closer": TODO_P5_CLUE_TRACKING.
      { kind: 'talk', npc: 'sunil', at: { building: 'Power House', beside: 3.5 }, obj: T.m2.sunilObj, lines: T.m2.sunil, clue: 'c1' },
    ],
    reward: { coins: 150, xp: 150, unlock: 'grip', card: T.m2.card },
  },
  // ------------------------------------------------------------------ M3 Backup Power
  {
    id: 'v2-backup-power', title: T.m3.title, clock: '7:30 PM', location: T.m3.location, sky: 'dusk', par: 200, brief: T.m3.brief,
    steps: [
      { kind: 'talk', npc: 'bhattarai', lines: T.m3.bhattarai1 },
      { kind: 'collect', obj: T.m3.fuseObj, verb: 'Take', items: [{ label: T.m3.fuseLabel, model: 'part', at: { building: 'Electrical Lab' } }] },
      { kind: 'radio', from: 'sunil', lines: T.m3.sunilRadio, clue: 'c2' },
      { kind: 'talk', npc: 'bhattarai', lines: T.m3.bhattarai2 },
      {
        // time: the drone cutting through the door. Ignored until TODO_P5_PUZZLE_TIMER.
        kind: 'puzzle', at: { building: 'Power House' }, label: T.m3.breakerLabel, obj: T.m3.breakerObj, model: 'breaker', time: 90,
        puzzle: { type: 'switches', title: T.m3.breakerLabel, clue: T.m3.breakerClue, bits: 5, target: 19, why: T.m3.breakerWhy },
      },
      { kind: 'talk', npc: 'bhattarai', lines: T.m3.bhattarai3 },
      { kind: 'cutscene', id: 'C3' },
      { kind: 'stub', todo: 'TODO_P5_PLAYER_FACE_SCREENS', note: 'Every screen shows the player\'s face.' },
      { kind: 'radio', from: 'mitra', lines: T.m3.mitraEnd },
    ],
    reward: { coins: 160, xp: 160, unlock: 'boost', card: T.m3.card },
  },
  // ------------------------------------------------------------------ M4 The Witness
  {
    id: 'v2-witness', title: T.m4.title, clock: '7:50 PM', location: T.m4.location, sky: 'dusk', par: 210, brief: T.m4.brief,
    steps: [
      { kind: 'talk', npc: 'krishna', lines: T.m4.krishna1, clue: 'c3' },
      {
        // SPEC GAP: the spec says three clues here but lists two objects (c4, c5); c3 is the
        // statement above. NESS WRC has no clue assigned yet. fade: TODO_P5_RAIN_FADE.
        kind: 'collect', obj: T.m4.collectObj, verb: 'Pick up', time: 130, fade: 'rain', items: [
          { label: T.m4.lanyard, model: 'evidence', at: { point: 'WRC Auditorium', outside: 'wall' }, clue: 'c4' },
          { label: T.m4.thread, model: 'evidence', at: { point: 'MSC Hostel', outside: 'wall' }, clue: 'c5' },
        ],
      },
      { kind: 'talk', npc: 'krishna', lines: T.m4.krishna2 },
      { kind: 'radio', from: 'asha', lines: T.m4.ashaBoard },
      { kind: 'stub', todo: 'TODO_P5_EVIDENCE_BOARD_OPEN', note: 'The evidence board opens: Raju, Asha, Sunil.' },
      { kind: 'radio', from: 'asha', lines: T.m4.ashaEnd },
    ],
    reward: { coins: 150, xp: 150, unlock: 'board', card: T.m4.card },
  },
  // ------------------------------------------------------------------ M5 Landslide
  {
    id: 'v2-landslide', title: T.m5.title, clock: '8:20 PM', location: T.m5.location, sky: 'night', par: 260, brief: T.m5.brief,
    steps: [
      { kind: 'cutscene', id: 'C4' },
      { kind: 'talk', npc: 'chhetri', lines: T.m5.chhetri1 },
      { kind: 'collect', obj: T.m5.levelObj, verb: 'Take', items: [{ label: T.m5.levelLabel, model: 'gnss', at: { area: 'Tennis Court' } }] },
      { kind: 'talk', npc: 'raju', at: { building: 'Store', beside: -3.5 }, lines: T.m5.raju1 },
      {
        kind: 'collect', obj: T.m5.sandObj, verb: 'Load', time: 150, items: [
          { label: T.m5.sandLabel, model: 'sandbag', at: { building: 'Store' } },
          { label: T.m5.sandLabel, model: 'sandbag', at: { building: 'Carpentry Workshop' } },
          { label: T.m5.sandLabel, model: 'sandbag', at: { building: 'Welding/Fabrication Workshop' } },
          { label: T.m5.sandLabel, model: 'sandbag', at: { building: 'Sheet Metal Workshop' } },
        ],
      },
      { kind: 'goto', at: { area: 'WRC Parapet' }, label: T.m5.gotoLabel, obj: T.m5.gotoObj, time: 75 },
      { kind: 'stub', todo: 'TODO_P5_BUBBLE_LEVEL', note: 'Bubble-level mini-game: level the wall.' },
      {
        kind: 'puzzle', at: { area: 'WRC Parapet' }, label: T.m5.wallLabel, obj: T.m5.wallObj, model: 'panel',
        puzzle: { type: 'keypad', title: T.m5.wallLabel, clue: T.m5.wallClue, code: '36', why: T.m5.wallWhy },
      },
      { kind: 'radio', from: 'chhetri', lines: T.m5.chhetriRadio },
      { kind: 'stub', todo: 'TODO_P5_RAJU_RUNS', note: 'Raju runs when the server room is mentioned.', clue: 'c6' },
      { kind: 'radio', from: 'asha', lines: T.m5.ashaEnd },
    ],
    reward: { coins: 180, xp: 180, unlock: 'paint:monsoon', card: T.m5.card },
  },
  // ------------------------------------------------------------------ M6 Silent Shelves
  {
    id: 'v2-shelves', title: T.m6.title, clock: '8:50 PM', location: T.m6.location, sky: 'night', par: 240, brief: T.m6.brief,
    steps: [
      { kind: 'talk', npc: 'khanal', lines: T.m6.khanal1 },
      {
        // drones: searchlights sweeping the parks. Ignored until TODO_P5_COLLECT_DRONES.
        kind: 'collect', obj: T.m6.collectObj, verb: 'Pick up', time: 150, drones: 3, items: [
          { label: T.m6.bookData, model: 'book', at: { point: 'Internet Zone', dx: 2, dz: 2 } },
          { label: T.m6.bookEthics, model: 'book', at: { point: 'BP Koirala Statue', dx: 3, dz: -2 } },
          { label: T.m6.bookLogic, model: 'book', at: { point: 'IOE fountain', dz: 3.6 } },
        ],
      },
      { kind: 'talk', npc: 'khanal', lines: T.m6.khanal2 },
      {
        kind: 'puzzle', at: { building: 'WRC Library' }, label: T.m6.deskLabel, obj: T.m6.deskObj, model: 'panel',
        puzzle: { type: 'keypad', title: T.m6.deskTitle, clue: T.m6.deskClue, code: '472', why: T.m6.deskWhy },
      },
      { kind: 'read', title: T.m6.registerTitle, lines: T.m6.register, clue: 'c7' },
      { kind: 'read', title: T.m6.noteTitle, lines: T.m6.note, clue: 'c8' },
      { kind: 'radio', from: 'asha', lines: T.m6.ashaEnd },
      { kind: 'cutscene', id: 'C5' },
    ],
    reward: { coins: 170, xp: 170, card: T.m6.card },
  },
  // ------------------------------------------------------------------ M7 Signal Hunt
  {
    // SPEC GAP: BP Park is listed for this mission but nothing happens there.
    id: 'v2-signal', title: T.m7.title, clock: '9:20 PM', location: T.m7.location, sky: 'night', par: 330, brief: T.m7.brief,
    steps: [
      { kind: 'radio', from: 'sunil', lines: T.m7.sunilStart },
      { kind: 'talk', npc: 'bhurtyal', lines: T.m7.bhurtyal },
      {
        kind: 'puzzle', at: { point: 'GNSS Receiver Test Station' }, label: T.m7.bearing1Label, obj: T.m7.bearing1Obj, model: 'gnss',
        puzzle: { type: 'tuner', title: T.m7.bearing1Title, clue: T.m7.bearing1Clue },
      },
      { kind: 'goto', at: { point: 'Sahid Abinash Statue', dx: 3, dz: 3 }, label: T.m7.bearing2Label, obj: T.m7.gotoObj, time: 60 },
      {
        kind: 'puzzle', at: { point: 'Sahid Abinash Statue', dx: 3, dz: 3 }, label: T.m7.bearing2Label, obj: T.m7.bearing2Obj, model: 'gnss',
        puzzle: { type: 'tuner', title: T.m7.bearing2Title, clue: T.m7.bearing2Clue },
      },
      { kind: 'radio', from: 'sunil', lines: T.m7.sunilCross },
      { kind: 'stealth', obj: T.m7.stealthObj, at: { point: 'Saraswati Temple', dx: -6, dz: 5 }, label: T.m7.relayLabel, model: 'relay', drones: 4 },
      {
        kind: 'puzzle', at: { point: 'Saraswati Temple', dx: -6, dz: 5 }, label: T.m7.lockLabel, obj: T.m7.lockObj, model: 'relay',
        puzzle: { type: 'simon', title: T.m7.lockLabel, clue: T.m7.lockClue, length: 5 },
      },
      { kind: 'stub', todo: 'TODO_P5_PULL_RELAY', note: 'Pull the relay out of its mast.' },
      { kind: 'cutscene', id: 'C6' },
      { kind: 'stub', todo: 'TODO_P5_DRONES_FREEZE_BLUE', note: 'Every drone freezes and turns blue.' },
      { kind: 'radio', from: 'mitra', lines: T.m7.mitraEnd, clue: 'c9' },
      { kind: 'radio', from: 'sunil', lines: T.m7.sunilEnd },
    ],
    reward: { coins: 210, xp: 210, unlocks: ['shards', 'paint:marigold'], card: T.m7.card },
  },
  // ------------------------------------------------------------------ M8 Runaway Drone
  {
    id: 'v2-runaway', title: T.m8.title, clock: '10:10 PM', location: T.m8.location, sky: 'night', par: 130, brief: T.m8.brief,
    steps: [
      { kind: 'radio', from: 'mitra', lines: T.m8.mitraStart },
      { kind: 'chase', obj: T.m8.chaseObj, route: [[187, 85], ...RING_NORTH], time: 100, speed: 10.5 },
      { kind: 'read', title: T.m8.keyLogTitle, lines: T.m8.keyLog, clue: 'c10' },
      { kind: 'radio', from: 'asha', lines: T.m8.ashaEnd },
    ],
    reward: { coins: 230, xp: 230, unlocks: ['engine', 'trial'], card: T.m8.card },
  },
  // ------------------------------------------------------------------ M9 Who Did It?
  {
    id: 'v2-whodunit', title: T.m9.title, clock: '11:20 PM', location: T.m9.location, sky: 'night', par: 250, brief: T.m9.brief,
    steps: [
      { kind: 'talk', npc: 'bahadur', lines: T.m9.bahadur1 },
      { kind: 'read', title: T.m9.guardRegisterTitle, lines: T.m9.guardRegister, clue: 'c11' },
      { kind: 'talk', npc: 'tiwari', lines: T.m9.tiwari1 },
      {
        kind: 'puzzle', at: { building: DOECE }, label: T.m9.sourceLabel, obj: T.m9.bug1Obj, model: 'panel',
        puzzle: { type: 'debug', title: T.m9.bug1Title, clue: T.m9.bug1Clue, lines: T.m9.bug1Lines, bug: 1, why: T.m9.bug1Why },
      },
      {
        kind: 'puzzle', at: { building: DOECE }, label: T.m9.sourceLabel, obj: T.m9.bug2Obj, model: 'panel',
        puzzle: { type: 'debug', title: T.m9.bug2Title, clue: T.m9.bug2Clue, lines: T.m9.bug2Lines, bug: 1, why: T.m9.bug2Why },
      },
      { kind: 'talk', npc: 'tiwari', lines: T.m9.tiwari2 },
      { kind: 'read', title: T.m9.consoleTitle, lines: T.m9.console, clue: 'c12' },
      // Until TODO_P6_EVIDENCE_BOARD_ACCUSE the accusation is a plain three-way choice.
      { kind: 'choose', npc: 'tiwari', question: T.m9.accuseQuestion, options: T.m9.accuseOptions, answer: 2, why: T.m9.accuseWhy },
      { kind: 'cutscene', id: 'C7' },
      { kind: 'radio', from: 'sunil', lines: T.m9.sunilEnd },
      { kind: 'radio', from: 'mitra', lines: T.m9.mitraEnd },
    ],
    reward: { coins: 240, xp: 240, card: T.m9.card },
  },
  // ------------------------------------------------------------------ M10 Before Sunrise
  {
    // Four parts in one mission. TODO_P6_CHECKPOINTS: a failure restarts the whole mission today.
    id: 'v2-sunrise', title: T.m10.title, clock: '5:20 AM', location: T.m10.location, sky: 'predawn', par: 480, brief: T.m10.brief,
    steps: [
      { kind: 'cutscene', id: 'C8' },
      { kind: 'radio', from: 'mitra', lines: T.m10.mitraStart },
      // (a) the firewall
      { kind: 'stealth', obj: T.m10.stealthObj, at: { point: 'Exam Section' }, label: T.m10.consoleLabel, model: 'panel', drones: 4 },
      {
        kind: 'puzzle', at: { point: 'Exam Section' }, label: T.m10.fw1Label, obj: T.m10.fw1Obj, model: 'breaker',
        puzzle: { type: 'switches', title: T.m10.fw1Label, clue: T.m10.fw1Clue, bits: 6, target: 45, why: T.m10.fw1Why },
      },
      { kind: 'radio', from: 'mitra', lines: T.m10.mitraHint },
      {
        kind: 'puzzle', at: { point: 'Exam Section' }, label: T.m10.fw2Label, obj: T.m10.fw2Obj, model: 'panel',
        puzzle: { type: 'simon', title: T.m10.fw2Label, clue: T.m10.fw2Clue, length: 6 },
      },
      // (b) the core modules
      { kind: 'radio', from: 'asha', lines: T.m10.ashaModules },
      {
        kind: 'collect', obj: T.m10.modulesObj, verb: 'Take', time: 160, items: [
          { label: T.m10.moduleA, model: 'module', at: { building: 'Power House' } },
          { label: T.m10.moduleB, model: 'module', at: { building: 'Electrical Lab' } },
          { label: T.m10.moduleC, model: 'module', at: { building: 'Machining Workshop' } },
        ],
      },
      // (c) the chase. TODO_P6_MOTORBIKE: the target is a courier drone until Sunil's motorbike exists.
      { kind: 'radio', from: 'asha', lines: T.m10.ashaBike },
      { kind: 'chase', obj: T.m10.chaseObj, route: RING_TO_GATE, time: 120, speed: 11 },
      { kind: 'cutscene', id: 'C9' },
      { kind: 'stub', todo: 'TODO_P6_GATE_SHUT_BAHADUR', note: 'MITRA shuts the main gate on Sunil; Bahadur Dai catches him.' },
      // (d) the reboot
      { kind: 'goto', at: { building: RIC }, label: T.m10.gotoLabel, obj: T.m10.gotoObj, time: 90 },
      { kind: 'talk', npc: 'asha', lines: T.m10.ashaRic },
      {
        kind: 'puzzle', at: { building: RIC }, label: T.m10.rebootLabel, obj: T.m10.rebootObj, model: 'module',
        puzzle: { type: 'simon', title: T.m10.rebootTitle, clue: T.m10.rebootClue, length: 6 },
      },
      { kind: 'stub', todo: 'TODO_P6_FINAL_CHOICE', note: 'Should MITRA remember tonight or forget it? (Changes only its last line.)' },
      { kind: 'radio', from: 'mitra', lines: T.m10.mitraRemember },
    ],
    reward: { coins: 320, xp: 320, unlock: 'paint:gold', card: T.m10.card },
  },
  // ------------------------------------------------------------------ Ending: Sunrise Fest
  {
    id: 'v2-fest', title: T.ending.title, clock: '7:00 AM', location: T.ending.location, sky: 'dawn', par: 150, brief: T.ending.brief,
    steps: [
      { kind: 'cutscene', id: 'C10' },
      { kind: 'talk', npc: 'chief', lines: T.ending.chief },
      { kind: 'radio', from: 'mitra', lines: T.ending.mitra },
    ],
    reward: { coins: 500, xp: 500, unlock: 'hero', card: T.ending.card },
  },
];

/** The ten missions; the entry after them is the ending. */
export const MISSION_COUNT = 10;

/** Weather by mission id (docs/STORY_V2.md): dry at dusk, drizzle, the storm, drizzle again, clear before dawn. */
export const WEATHER: Record<string, 'clear' | 'drizzle' | 'storm'> = {
  'v2-witness': 'drizzle', 'v2-landslide': 'storm', 'v2-shelves': 'storm', 'v2-signal': 'storm',
  'v2-runaway': 'drizzle', 'v2-whodunit': 'drizzle',
};

export const STORY_BLURB = T.title.blurb;

/**
 * Share of campus with its power back after `story` finished missions. In V2 the power dies at
 * 6:52 PM and comes back all at once at the end of mission 3.
 */
export function powerLevel(story: number): number {
  return story >= 3 ? 1 : 0;
}
