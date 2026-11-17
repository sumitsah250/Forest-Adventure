// Types for the Campus Quest story data (both versions). Types only: nothing here runs.
//
// A mission is a list of steps. Step kinds the runner (missions.ts) plays today:
//   talk     walk to a person and talk (E)               radio    someone speaks over the radio
//   goto     reach a place (optionally timed)            collect  pick up items (on foot with E, or drive through them in Kalki)
//   quiz     answer questions (wrong answers cost hearts) puzzle   a hands-on minigame at a device
//   drive    Kalki through checkpoint rings, timed        chase    catch a fleeing target (Kalki)
//   stealth  reach a target past searchlight drones       choose   pick one answer
//   kart     get into Kalki                               riddle   work out a place from a riddle
//   read     a document shown as a card                   cutscene a scripted camera scene (cutscene.ts)
//   stub     a named piece of V2 that is not built yet: the runner logs it and moves on

import type { Outfit } from '../../character/humanoid.ts';
import type { Pool } from '../questions.ts';
import type { Pt } from '../geo.ts';

/**
 * A place, always by a name that exists in the map data (campusData.json).
 *   building  stands at that building's door. `beside` shifts along the wall (metres).
 *   point     a mapped point, plus an optional offset. A point inside a building goes to that
 *             building's door, or with `outside: 'wall'` to just outside the wall nearest the point
 *             (several mapped points share one building, and would otherwise share one door).
 *   area      the middle of a mapped area.
 *   xz        raw map coordinates. Only for values that already exist in the game.
 */
export type Where =
  | { building: string; poi?: string; label?: string; beside?: number }
  | { point: string; dx?: number; dz?: number; outside?: 'door' | 'wall'; beside?: number }
  | { area: string }
  | { xz: Pt };

export type ItemModel = 'book' | 'cube' | 'breaker' | 'usb' | 'toolbox' | 'gnss' | 'torch' | 'sandbag' | 'evidence' | 'module' | 'part' | 'panel' | 'relay';

export type ClueId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7' | 'c8' | 'c9' | 'c10' | 'c11' | 'c12' | 'c13';
export type CutsceneId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'C8' | 'C9' | 'C10';

/**
 * Pieces of V2 that are not built yet. Each name is searchable in the code and says which
 * phase builds it. A `stub` step with one of these is skipped by the runner with a log line.
 */
export type TodoId =
  | 'TODO_P4_GATE_SLAM' // M1 end: the main gate closes
  | 'TODO_P5_CLUE_TRACKING' // clue cards (gold / silver); `clue` fields on steps are ignored until then
  | 'TODO_P5_PUZZLE_TIMER' // M3: the 90 s countdown that keeps running during the breaker puzzle
  | 'TODO_P5_PLAYER_FACE_SCREENS' // M3 end: every screen shows the player's face
  | 'TODO_P5_RAIN_FADE' // M4: clues fade as the rain grows
  | 'TODO_P5_EVIDENCE_BOARD_OPEN' // M4 end: the read-only evidence board
  | 'TODO_P5_BUBBLE_LEVEL' // M5: bubble-level mini-game before the 36 kPa check
  | 'TODO_P5_RAJU_RUNS' // M5 end: Raju runs off
  | 'TODO_P5_COLLECT_DRONES' // M6: searchlight drones during a collect step
  | 'TODO_P5_PULL_RELAY' // M7: pull the relay out
  | 'TODO_P5_DRONES_FREEZE_BLUE' // M7 end: every drone freezes and turns blue
  | 'TODO_P6_EVIDENCE_BOARD_ACCUSE' // M9: the accusation on the board (a plain choice until then)
  | 'TODO_P6_MOTORBIKE' // M10: Sunil on his motorbike (the chase target is a drone until then)
  | 'TODO_P6_GATE_SHUT_BAHADUR' // M10: MITRA shuts the gate, Bahadur Dai catches Sunil
  | 'TODO_P6_FINAL_CHOICE' // M10: should MITRA remember or forget tonight
  | 'TODO_P6_CHECKPOINTS'; // M10: restart from the current part, not the whole mission

export interface ItemDef {
  label: string;
  model: ItemModel;
  at: Where;
  /** Picking this up finds a clue. Ignored until TODO_P5_CLUE_TRACKING. */
  clue?: ClueId;
}

export type PuzzleDef =
  | { type: 'switches'; title: string; clue: string; bits: number; target: number; why: string }
  | { type: 'keypad'; title: string; clue: string; code: string; why: string }
  | { type: 'gauge'; title: string; clue: string; hits: number; speed: number }
  | { type: 'tuner'; title: string; clue: string }
  | { type: 'debug'; title: string; clue: string; lines: string[]; bug: number; why: string }
  | { type: 'simon'; title: string; clue: string; length: number };

export type Step =
  | { kind: 'talk'; npc: string; lines: string[]; at?: Where; obj?: string; clue?: ClueId }
  | { kind: 'radio'; from: string; lines: string[]; clue?: ClueId }
  | { kind: 'goto'; at: Where; label: string; obj: string; time?: number }
  /** drones: TODO_P5_COLLECT_DRONES. fade: TODO_P5_RAIN_FADE. Both are ignored until built. */
  | { kind: 'collect'; obj: string; verb: string; items: ItemDef[]; time?: number; drones?: number; fade?: 'rain' }
  | { kind: 'quiz'; npc: string; title: string; pool: Pool | 'final'; need: number; timer?: number; at?: Where; obj?: string }
  /**
   * A riddle about a real place on campus. No marker: work it out and go there. A hint
   * after a while, the beacon after longer; solving it before the hints pays a bonus.
   */
  | { kind: 'riddle'; from: string; title: string; riddle: string; answer: Where; label: string; model: ItemModel; hints: [string, string]; time?: number }
  /** time: TODO_P5_PUZZLE_TIMER (ignored until built). */
  | { kind: 'puzzle'; at: Where; label: string; obj: string; model: ItemModel; puzzle: PuzzleDef; time?: number }
  /** pursuer: a MITRA drone hunts Kalki; let it sit on you and you lose a heart. */
  | { kind: 'drive'; obj: string; route: Pt[]; time: number; pursuer?: boolean }
  | { kind: 'chase'; obj: string; route: Pt[]; time: number; speed: number }
  /** auto: reaching the target completes it (no pick-up). */
  | { kind: 'stealth'; obj: string; at: Where; label: string; model: ItemModel; drones: number; auto?: boolean }
  | { kind: 'choose'; npc: string; question: string; options: string[]; answer: number; why: string }
  | { kind: 'kart'; obj: string }
  /** A document (register, log, note) shown as a card. */
  | { kind: 'read'; title: string; lines: string[]; clue?: ClueId }
  | { kind: 'cutscene'; id: CutsceneId }
  | { kind: 'stub'; todo: TodoId; note: string; clue?: ClueId };

export type Sky = 'dusk' | 'night' | 'predawn' | 'dawn';

export interface MissionDef {
  id: string;
  title: string;
  /** Story clock shown in the HUD. */
  clock: string;
  /** Place for the location card at mission start ("7:50 PM, CAFETERIA"). */
  location?: string;
  sky: Sky;
  /** One line for the mission banner and the missions menu. */
  brief: string;
  /** Seconds of play for the time star. */
  par: number;
  /** Where Kalki waits when this mission starts from its first step (if not already driven there). */
  kartAt?: { x: number; z: number; heading: number };
  steps: Step[];
  /** unlock: one flag. unlocks: several (both are applied). */
  reward: { coins: number; xp: number; unlock?: string; unlocks?: string[]; card: string };
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  outfit: Outfit;
  at: Where;
}

// ------------------------------------------------------------------ V2 cast and clues

export type Suspect = 'raju' | 'asha' | 'sunil';

export interface CastDef {
  /** Full name and the short form used on the radio. */
  name: string;
  short: string;
  role: string;
  /** A real member of staff: short, kind helper lines only; never a suspect or the target of a joke. */
  realStaff?: boolean;
  /** The one mission a real member of staff appears in ('ending' for the Campus Chief). */
  mission?: string;
  suspect?: boolean;
  /** One line on how the character talks, for whoever edits their lines. */
  voice: string;
}

export interface ClueDef {
  id: ClueId;
  /** Mission id where it is found, or null for a mini-game clue. */
  mission: string | null;
  minigame?: string;
  /** Card title and text for the evidence board. */
  title: string;
  text: string;
  pointsTo: Suspect | 'hoodie';
  /** evidence: against the culprit. false-lead: looks bad for someone innocent. clears: proves someone innocent. */
  role: 'evidence' | 'false-lead' | 'clears';
  /** Who a `clears` clue clears. */
  clears?: Suspect;
}

// ------------------------------------------------------------------ cutscenes (played by cutscene.ts)

/** Metres. For a place: [east, up, south]. For an entity with `local`: [to its right, up, ahead of it]. */
export type Vec3 = [number, number, number];

/** Things a camera can be placed around or pointed at. `npc:<id>` is a character from the cast. */
export type EntityRef = 'player' | 'kart' | 'gate' | `npc:${string}`;

/**
 * A point in the world for the camera, always relative to something that already exists:
 *   where   a named place from the map (same names as mission steps), plus an offset
 *   entity  the player, Kalki, the main gate or a character, plus an offset
 * With `local: true` the offset turns with the thing: [to its right, up, ahead of it]. For a
 * building, "ahead" is out from its door, so [0, 6, 20] is 20 m in front of the door, 6 m up.
 * No raw map coordinates: offsets are camera framing, in metres.
 */
export type Anchor =
  | { where: Where; off?: Vec3; local?: boolean }
  | { entity: EntityRef; off?: Vec3; local?: boolean };

export type Ease = 'linear' | 'in' | 'out' | 'inOut';

/** Something that happens at a moment in a shot. All times are seconds from the start of the shot. */
export interface CutEvent {
  at: number;
  /** A scripted event by name; the list is in main.ts (cutEvents). */
  do: string;
  value?: number;
  /** Seconds the change takes (for events that fade something). */
  over?: number;
  arg?: string;
  /** Where it happens, for events that need a place. */
  place?: Anchor;
}

export interface ShotDef {
  /** Length in seconds. */
  dur: number;
  /** The camera's path: 3 to 5 points, joined by a smooth curve. Entity points are fixed when the shot starts. */
  path: Anchor[];
  /** What the camera looks at. One target (an entity target is followed as it moves), or [from, to] to pan between two. */
  look: Anchor | [Anchor, Anchor];
  /** How the camera moves along the path. Default 'inOut'. */
  ease?: Ease;
  /** Field of view in degrees, or [from, to] to zoom. Default: the player's setting. */
  fov?: number | [number, number];
  /** Game speed during the shot: 1 normal, 0.3 slow motion. The shot's own length stays in real seconds. */
  timeScale?: number;
  /** A big title card over the shot. */
  card?: { kicker: string; title: string; sub: string };
  /** Subtitle cards: who speaks (a cast id), the text (two short sentences at most) and how long it stays. */
  subtitles?: { at: number; who: string; text: string; dur?: number }[];
  /** Sounds by name (the names audio.play() knows). */
  sounds?: { at: number; name: string }[];
  events?: CutEvent[];
}

export interface CutsceneDef {
  shots: ShotDef[];
}
