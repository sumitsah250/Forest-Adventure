// The Hollow Creek mystery: story state, clues, objectives, hints, scripted
// conversations and the ending. Interactions are registered with the session.

import * as THREE from 'three';
import type { Session } from './session.ts';
import type { Structures } from '../world/structures.ts';
import { SITES } from '../world/layout.ts';
import { AFTERNOON, DUSK } from '../render/atmosphere.ts';

export type Flag =
  | 'readBoard' | 'suvSeen' | 'suvCab' | 'suvCargo' | 'suvBumper' | 'suvTire' | 'searchlight'
  | 'stationReached' | 'logbook' | 'wallMap' | 'radioTried' | 'generatorChecked' | 'hasFuel'
  | 'generatorFueled' | 'generatorRunning' | 'powerOn' | 'heardRecording' | 'hasKey'
  | 'bridgeSeen' | 'tracks' | 'crossedFord' | 'chain' | 'gateOpen' | 'skids' | 'wreckFound'
  | 'wreckSearched' | 'tape' | 'flashlight' | 'cabinFound' | 'metHale' | 'campFound' | 'cutters'
  | 'campFire' | 'binoculars' | 'connection' | 'calledMedevac';

export interface Clue {
  id: string;
  title: string;
  text: string;
  /** Main-path clues count towards completion; others are optional. */
  main: boolean;
}

export interface Line {
  who: string;
  text: string;
  /** Seconds this line stays up. */
  t: number;
}

export interface SfxApi {
  play(name: string, pos?: THREE.Vector3, gain?: number): void;
  setLoop(name: string, on: boolean, pos?: THREE.Vector3): void;
}

const CLUES: Record<string, Omit<Clue, 'id'>> = {
  board: { title: 'District notice board', text: 'The bridge at mile two is closed for repair; high-clearance vehicles are told to use the ford. A fresh notice warns that hunting with spotlights is illegal and asks visitors to report it.', main: false },
  suvCab: { title: 'Registration in the SUV', text: 'The SUV is registered to Dale Kessler of Ash Fork. In the door pocket: a receipt for two boxes of .243 cartridges, dated three days ago, and a hand-drawn map of the north ridge.', main: true },
  suvCargo: { title: 'SUV cargo area', text: 'A spotlight battery pack, an empty cartridge box and a tarp stiff with dried blood and deer hair. Somebody has been hunting at night.', main: false },
  suvBumper: { title: 'Scraped front bumper', text: 'The front bumper is crumpled and scraped. There is paint in the scrape: dark green, the same green as a forest-service truck.', main: true },
  suvTire: { title: 'Torn front tyre', text: 'The front tyre is ripped open on its sidewall. The SUV went into the ditch fast and nobody came back for it.', main: false },
  searchlight: { title: 'Handheld searchlight', text: 'A million-candlepower spotlight lying in the grass by the open door. Dead battery. Jacklighters use these to freeze deer at night.', main: false },
  logbook: { title: 'Station logbook', text: '"Oct 9 — Spotlights on the north ridge again, around 2 a.m. Jacklighters.\nOct 10 — Ridge Gate chain cut. Fitted a new padlock; spare key in the cabinet.\nOct 11 — Going up tonight to catch them in the act. If the radio is quiet, the generator has run dry again. — M. Hale"\nPencilled inside the back cover: "Gun locker 4-1-7."', main: true },
  wallMap: { title: 'District map', text: 'Hale\'s map shows the ford below the bridge, the Ridge Gate, the fire lookout on the ridge and the old Miller cabin in the creek bottom below the ravine. Your map has been updated.', main: false },
  recording: { title: 'Last transmission, Oct 11, 23:48', text: '"Base, Unit Four… I\'m on Ridge Road above the ravine. A maroon SUV, no lights, came round the bend and put me over the edge. My ankle is bad. I\'m heading down to the Miller cabin and I\'ll flag my way. The bridge is out: take the ford. The spare gate key is in the cabinet."', main: true },
  bridge: { title: 'Collapsed bridge', text: 'The centre span has dropped into Hollow Creek. Nothing is crossing here.', main: false },
  tracks: { title: 'Tyre tracks at the turn-off', text: 'Fresh tracks leave the road before the bridge and run downstream along the bank. The old ford.', main: true },
  chain: { title: 'The Ridge Gate', text: 'A new brass padlock on the gate. The old chain still hangs from the post, its link cut clean. Bolt cutters.', main: true },
  skids: { title: 'Skid marks at the bend', text: 'Two sets of tracks at the bend above the ravine. One swerves hard and leaves the road. The marker posts are snapped.', main: true },
  wreck: { title: 'Unit 4', text: 'Hale\'s truck lies on its side against a fir. The airbag has fired and the first-aid kit is gone. On the driver\'s door: a long scrape of maroon paint.', main: true },
  tape: { title: 'Orange flagging tape', text: 'Survey tape tied at head height, one piece every few metres. Hale marked her route down the creek.', main: true },
  flashlight: { title: 'Hale\'s flashlight', text: 'Engraved "M.H.". The battery is dead. She kept going in the dark.', main: false },
  camp: { title: 'Hidden camp', text: 'A tarp shelter and a cold fire pit with spent .243 casings in the ash. A camp for people who hunt at night.', main: false },
  cutters: { title: 'Bolt cutters', text: 'Left at the hidden camp, jaws still flecked with rust from a chain. This is what opened the Ridge Gate.', main: false },
  binoculars: { title: 'From the lookout', text: 'Through the binoculars: a thin line of wood smoke rising from the creek bottom to the south-east, where the Miller cabin should be.', main: false },
  connection: { title: 'Case note: the collision', text: 'Green paint on the SUV\'s bumper. Maroon paint on Unit 4\'s door. The SUV forced Hale off Ridge Road.', main: false },
  hale: { title: 'Ranger Mara Hale', text: 'Alive. Broken ankle, sheltering in the Miller cabin with the door wedged shut. She was run off the road by the poachers\' SUV.', main: true },
};

const RECORDING: Line[] = [
  { who: 'Radio', text: '[static] …recorded transmission. October eleventh, twenty-three forty-eight.', t: 4 },
  { who: 'Hale', text: 'Base, Unit Four. Anyone. I\'m on Ridge Road above the ravine.', t: 4.5 },
  { who: 'Hale', text: 'A maroon SUV, no lights — came round the bend straight at me. Put me over the edge.', t: 5.5 },
  { who: 'Hale', text: 'Truck\'s on its side. My ankle\'s… it\'s bad. Handheld\'s getting weak.', t: 5 },
  { who: 'Hale', text: 'I\'m going down to the old Miller cabin by the creek. I\'ll flag my way.', t: 5 },
  { who: 'Hale', text: 'The bridge is out — take the ford. Spare gate key\'s in the cabinet. Hale out.', t: 5.5 },
  { who: 'Radio', text: '[static]', t: 2 },
];

const HALE: Line[] = [
  { who: 'Hale', text: '…Who\'s there?', t: 2.8 },
  { who: 'You', text: 'District office. Ranger Hale? We\'ve been calling you for two days.', t: 4.2 },
  { who: 'Hale', text: 'Thank God. I can\'t open the door — I wedged it, and I can\'t stand on this ankle.', t: 5 },
  { who: 'Hale', text: 'They ran me off the road. Same people who\'ve been spotlighting deer up on the ridge.', t: 5 },
  { who: 'Hale', text: 'My handheld\'s dead. Your truck radio will reach dispatch from here. Call it in — tell them I need the helicopter.', t: 6 },
  { who: 'You', text: 'Hang on. I\'ll be right back.', t: 3 },
];

const MEDEVAC: Line[] = [
  { who: 'You', text: 'Dispatch, Unit Two at Hollow Creek. I\'ve found Ranger Hale. Alive, injured, at the Miller cabin.', t: 5 },
  { who: 'Dispatch', text: 'Copy, Unit Two. Good news. Medevac is launching now, ETA two-zero minutes.', t: 5 },
  { who: 'Dispatch', text: 'State patrol will want that maroon SUV. Don\'t touch it. Stay with her.', t: 4.5 },
  { who: 'You', text: 'Copy. Unit Two out.', t: 2.5 },
];

const HINTS: Record<string, string[]> = {
  station: ['Follow Hollow Creek Road north. The ranger station is on the right, past the abandoned SUV.', 'The station spur leaves the road about two kilometres in. The compass marker points to it.'],
  search: ['Look around the ranger station. Hale kept a logbook on her desk.', 'The logbook is on the metal desk against the back wall, inside the door.'],
  generator: ['The station radio has no power. Check the generator under the lean-to outside.', 'The generator is dry. Your truck carries a jerrycan on its roof rack: take it, refuel the generator, start it, then throw the switch on the power box.'],
  radio: ['Power is back. The radio on the desk may have recorded something.', 'Use the radio on Hale\'s desk to play the last transmission.'],
  key: ['Hale said the spare key for the Ridge Gate is in the station\'s key cabinet.', 'The key cabinet is on the inside wall to the left of the desk.'],
  ford: ['The bridge is out. Look for tyre tracks leaving the road just before it.', 'The tracks lead downstream to a shallow ford. Cross there in the truck and follow the tracks back to the road.'],
  gate: ['Ridge Road is closed by a gate north of the creek.', 'Unlock the Ridge Gate with the spare key from the station.'],
  bend: ['Hale went off Ridge Road "above the ravine". Drive up Ridge Road and watch the edge.', 'Stop at the sharp bend where the road runs along the ravine and look over the edge.'],
  wreck: ['Unit 4 is down the slope below the bend. Search it.', 'Climb down from the bend: the truck is lying on its side against a tree.'],
  tape: ['Hale said she would flag her route. Look for orange tape near the wreck.', 'The tape runs west along the creek bottom toward the Miller cabin.'],
  cabin: ['The Miller cabin is in the creek bottom below the ravine.', 'Knock on the cabin door.'],
  medevac: ['Hale needs a medevac. Your truck radio can reach dispatch.', 'Get into your truck and press T to radio dispatch.'],
};

/** What the HUD shows as the current objective (missions supply their own). */
export interface ObjectiveView {
  key: string;
  text: string;
  sub: string;
  target: THREE.Vector3 | null;
  hints?: string[];
}

export class Mystery {
  readonly flags = new Set<Flag>();
  /** When set, drives the objective HUD, compass and hints instead of the story flags. */
  hudOverride: (() => ObjectiveView | null) | null = null;
  /** When set, replaces the story's own progress (light and audio go toward dusk with it). */
  progressOverride: (() => number) | null = null;
  /** The medevac call ends the game unless missions continue the story. */
  endOnMedevac = true;
  /** Dialogue played when calling dispatch from the truck. */
  medevacLines: Line[] = MEDEVAC;
  /** Called after the medevac call (missions). */
  onMedevac: (() => void) | null = null;
  readonly clues: Clue[] = [];
  private s: Session;
  private st: Structures;
  private sfx: SfxApi | null = null;
  private lastProgress = 0;
  private hintLevel = 0;
  private hintObjective = '';
  private script: { lines: Line[]; i: number; t: number; done: () => void; blocking: boolean } | null = null;
  private duskT = 0;
  private doorOpen = false;
  private doorAngle = -0.35;
  private gateAngle = 0;
  private zoom: { t: number; target: THREE.Vector3 } | null = null;
  private savedFov = 68;
  startedAt = 0;
  /** Test-only: speeds up scripted dialogue. */
  scriptSpeed = 1;
  ended = false;
  onEnding: (() => void) | null = null;
  onClue: ((c: Clue) => void) | null = null;
  readonly mapReveals = new Set<string>(['trailhead', 'station']);

  constructor(session: Session, structures: Structures) {
    this.s = session;
    this.st = structures;
    this.registerInteractions();
    session.listeners.frame.push((dt) => this.update(dt));
  }

  setSfx(sfx: SfxApi): void {
    this.sfx = sfx;
  }

  has(f: Flag): boolean {
    return this.flags.has(f);
  }

  /** Sets a story flag (missions use this for shared beats). */
  setFlag(f: Flag): boolean {
    return this.set(f);
  }

  private set(f: Flag): boolean {
    if (this.flags.has(f)) return false;
    this.flags.add(f);
    this.lastProgress = this.s.game.time;
    this.hintLevel = 0;
    return true;
  }

  /** Adds a clue definition (missions add their own evidence). */
  registerClue(id: string, def: Omit<Clue, 'id'>): void {
    CLUES[id] = def;
  }

  hasClue(id: string): boolean {
    return this.clues.some((c) => c.id === id);
  }

  /**
   * Plays a scripted conversation (subtitles), then calls `done`. Radio chatter is
   * not blocking: the player can keep moving and interacting while it plays.
   */
  say(lines: Line[], done: () => void = () => undefined, blocking = false): void {
    if (this.script) {
      // Queue after the current conversation.
      const prev = this.script.done;
      this.script.done = () => {
        prev();
        this.say(lines, done, blocking);
      };
      return;
    }
    this.script = { lines, i: -1, t: 0, done, blocking };
  }

  clue(id: string): void {
    if (this.clues.some((c) => c.id === id)) return;
    const c = { id, ...CLUES[id] };
    this.clues.push(c);
    this.lastProgress = this.s.game.time;
    this.hintLevel = 0;
    this.s.hud.toast('Clue added', c.title, 'clue');
    this.sfx?.play('clue');
    this.onClue?.(c);
    if (!this.has('connection') && this.clues.some((k) => k.id === 'suvBumper') && this.clues.some((k) => k.id === 'wreck')) {
      this.set('connection');
      setTimeout(() => this.clue('connection'), 2500);
    }
  }

  private note(text: string, seconds = 4.5): void {
    this.s.hud.say('', text, seconds);
  }

  private run(lines: Line[], done: () => void = () => undefined): void {
    this.script = { lines, i: -1, t: 0, done, blocking: true };
  }

  get busy(): boolean {
    return (this.script !== null && this.script.blocking) || this.zoom !== null;
  }

  /** Any conversation playing (blocking or radio chatter). */
  get talking(): boolean {
    return this.script !== null;
  }

  // ------------------------------------------------------------ interactions

  private registerInteractions(): void {
    const a = this.st.anchors;
    const add = this.s.addInteractable.bind(this.s);
    const at = (v: THREE.Vector3 | undefined) => () => v ?? new THREE.Vector3(1e6, 0, 0);
    add({
      id: 'board', position: at(a.infoBoard), range: 2.6,
      prompt: () => 'Read the notice board',
      use: () => {
        this.set('readBoard');
        this.clue('board');
        this.sfx?.play('paper', a.infoBoard);
      },
    });
    // Truck jerrycan.
    add({
      id: 'jerrycan',
      position: () => this.s.truck.localToWorld(new THREE.Vector3(0.3, 1.6, -1.6)),
      range: 2.8,
      prompt: () => (this.has('hasFuel') || this.s.mode !== 'foot' ? null : 'Take the jerrycan from the roof rack'),
      use: () => {
        this.set('hasFuel');
        if (this.s.truck.parts.jerrycan) this.s.truck.parts.jerrycan.visible = false;
        this.s.hud.toast('Taken', 'Jerrycan of fuel (20 L)', 'info');
        this.sfx?.play('slosh');
      },
    });
    // SUV.
    add({
      id: 'suv-cab', position: at(a.suvDoor), range: 2.4,
      prompt: () => (this.has('suvCab') ? null : 'Search the cab'),
      use: () => {
        this.set('suvCab');
        this.clue('suvCab');
        this.sfx?.play('rummage', a.suvDoor);
      },
    });
    add({
      id: 'suv-cargo', position: at(a.suvRear), range: 2.4,
      prompt: () => (this.has('suvCargo') ? null : 'Look in the cargo area'),
      use: () => {
        this.set('suvCargo');
        this.clue('suvCargo');
        this.sfx?.play('rummage', a.suvRear);
      },
    });
    add({
      id: 'suv-bumper', position: at(a.suvBumper), range: 2.2,
      prompt: () => (this.has('suvBumper') ? null : 'Examine the front bumper'),
      use: () => {
        this.set('suvBumper');
        this.clue('suvBumper');
      },
    });
    add({
      id: 'suv-tire', position: at(a.suvTire), range: 2.0,
      prompt: () => (this.has('suvTire') ? null : 'Examine the flat tyre'),
      use: () => {
        this.set('suvTire');
        this.clue('suvTire');
      },
    });
    const spot = a.suvDoor ? a.suvDoor.clone().add(new THREE.Vector3(0, -0.9, 0)) : undefined;
    add({
      id: 'searchlight', position: () => (spot ? this.lightPos ?? spot : new THREE.Vector3(1e6, 0, 0)), range: 2.0,
      prompt: () => (this.has('searchlight') ? null : 'Examine the searchlight'),
      use: () => {
        this.set('searchlight');
        this.clue('searchlight');
      },
    });
    // Station.
    add({
      id: 'station-door', position: at(a.stationDoor), range: 2.4,
      prompt: () => (this.doorOpen ? 'Close the door' : 'Open the door'),
      use: () => {
        this.doorOpen = !this.doorOpen;
        this.st.station.doorCollider.setEnabled(!this.doorOpen);
        this.sfx?.play(this.doorOpen ? 'doorOpen' : 'doorClose', a.stationDoor);
      },
    });
    add({
      id: 'logbook', position: at(a.logbook), range: 2.0,
      prompt: () => (this.has('logbook') ? 'Read the logbook again' : 'Read the logbook'),
      use: () => {
        const first = this.set('logbook');
        this.clue('logbook');
        this.sfx?.play('paper', a.logbook);
        if (!first) this.s.hud.say('Logbook', 'Oct 11 — Going up tonight to catch them in the act. If the radio is quiet, the generator has run dry again.', 6);
      },
    });
    add({
      id: 'wall-map', position: at(a.wallMap), range: 2.4,
      prompt: () => (this.has('wallMap') ? null : 'Study the wall map'),
      use: () => {
        this.set('wallMap');
        for (const k of ['ford', 'gate', 'lookout', 'cabin']) this.mapReveals.add(k);
        this.clue('wallMap');
        this.sfx?.play('paper', a.wallMap);
      },
    });
    add({
      id: 'radio', position: at(a.radio), range: 2.0,
      prompt: () => {
        if (!this.has('powerOn')) return 'Try the radio';
        if (!this.has('heardRecording')) return 'Play the last recorded transmission';
        return 'Listen to the transmission again';
      },
      use: () => {
        if (!this.has('powerOn')) {
          this.set('radioTried');
          this.note('Dead. No power: the station runs off the generator outside.');
          this.sfx?.play('click', a.radio);
          return;
        }
        if (this.busy) return;
        this.sfx?.setLoop('static', true, a.radio);
        this.run(RECORDING, () => {
          this.sfx?.setLoop('static', false);
          if (this.set('heardRecording')) {
            this.clue('recording');
            for (const k of ['ford', 'gate', 'cabin']) this.mapReveals.add(k);
          }
        });
      },
    });
    add({
      id: 'key', position: at(a.keyCabinet), range: 2.0,
      prompt: () => (this.has('hasKey') ? null : 'Take the Ridge Gate key'),
      use: () => {
        this.set('hasKey');
        if (this.st.pickups.gateKey) this.st.pickups.gateKey.visible = false;
        this.s.hud.toast('Taken', 'Spare key: "RIDGE GATE"', 'info');
        this.sfx?.play('keys', a.keyCabinet);
      },
    });
    add({
      id: 'generator', position: at(a.generator), range: 2.4,
      hold: 0,
      prompt: () => {
        if (!this.has('generatorChecked')) return 'Check the generator';
        if (!this.has('generatorFueled')) return this.has('hasFuel') ? 'Refuel the generator (hold)' : 'Generator: empty tank';
        if (!this.has('generatorRunning')) return 'Pull the starter cord (hold)';
        return null;
      },
      use: () => {
        if (!this.has('generatorChecked')) {
          this.set('generatorChecked');
          this.note('The fuel gauge reads empty. The tank is bone dry.');
          this.sfx?.play('click', a.generator);
          return;
        }
        if (!this.has('generatorFueled')) {
          if (!this.has('hasFuel')) {
            this.note('You need fuel. There is a jerrycan on your truck\'s roof rack.');
            return;
          }
          this.set('generatorFueled');
          this.sfx?.play('pour', a.generator);
          this.s.hud.toast('Done', 'Generator refuelled', 'info');
          return;
        }
        if (!this.has('generatorRunning')) {
          this.set('generatorRunning');
          this.sfx?.play('generatorStart', a.generator);
          setTimeout(() => this.sfx?.setLoop('generator', true, a.generator), 1800);
          this.note('It coughs twice, then settles into a steady rattle.');
        }
      },
    });
    const gen = this.s.interactions.get('generator');
    if (gen) {
      // Refuelling and pull-starting are held actions.
      Object.defineProperty(gen, 'hold', {
        get: () => (this.has('generatorChecked') && ((!this.has('generatorFueled') && this.has('hasFuel')) || (this.has('generatorFueled') && !this.has('generatorRunning'))) ? (this.has('generatorFueled') ? 1.0 : 2.2) : 0),
      });
    }
    add({
      id: 'power-box', position: at(a.powerBox), range: 2.2,
      prompt: () => (this.has('powerOn') ? null : 'Throw the transfer switch'),
      use: () => {
        if (!this.has('generatorRunning')) {
          this.note('The switch moves, but nothing happens. No power from the generator.');
          this.sfx?.play('switch', a.powerBox);
          return;
        }
        this.set('powerOn');
        this.sfx?.play('switch', a.powerBox);
        this.powerOn();
      },
    });
    // Bridge, tracks, ford.
    add({
      id: 'bridge', position: at(a.bridge), range: 4,
      prompt: () => (this.has('bridgeSeen') && this.clues.some((c) => c.id === 'bridge') ? null : 'Examine the collapsed bridge'),
      use: () => {
        this.set('bridgeSeen');
        this.clue('bridge');
      },
    });
    add({
      id: 'tracks', position: at(a.bridgeTracks), range: 4,
      prompt: () => (this.has('tracks') ? null : 'Examine the tyre tracks'),
      use: () => {
        this.set('tracks');
        this.clue('tracks');
        this.mapReveals.add('ford');
      },
    });
    // Gate.
    add({
      id: 'gate', position: at(a.gateLock), range: 2.4,
      hold: 0.9,
      prompt: () => {
        if (this.has('gateOpen')) return null;
        return this.has('hasKey') ? 'Unlock the gate (hold)' : 'Examine the padlock';
      },
      use: () => {
        if (!this.has('hasKey')) {
          this.set('chain');
          this.clue('chain');
          this.note('Locked. A new padlock, and the old chain cut clean beside it.');
          return;
        }
        this.set('chain');
        this.clue('chain');
        this.set('gateOpen');
        this.st.gate.collider.setEnabled(false);
        this.sfx?.play('unlock', a.gateLock);
        setTimeout(() => this.sfx?.play('gate', a.gateLock), 500);
      },
    });
    // Ridge Road bend, wreck, tape, flashlight.
    add({
      id: 'skids', position: at(a.wreckBend), range: 6,
      prompt: () => (this.has('skids') ? null : 'Look at the skid marks'),
      use: () => {
        this.set('skids');
        this.clue('skids');
      },
    });
    add({
      id: 'wreck', position: at(a.wreck), range: 3.0,
      prompt: () => (this.has('wreckSearched') ? null : 'Search Unit 4'),
      use: () => {
        this.set('wreckFound');
        this.set('wreckSearched');
        this.clue('wreck');
        this.sfx?.play('rummage', a.wreck);
        setTimeout(() => this.note('An orange strip of flagging tape flutters on a sapling below the wreck.'), 1800);
      },
    });
    add({
      id: 'tape', position: at(a.firstTape), range: 3.0,
      prompt: () => (this.has('tape') ? null : 'Examine the flagging tape'),
      use: () => {
        this.set('tape');
        this.clue('tape');
      },
    });
    add({
      id: 'flashlight', position: at(a.flashlight), range: 2.0,
      prompt: () => (this.has('flashlight') ? null : 'Pick up the flashlight'),
      use: () => {
        this.set('flashlight');
        this.clue('flashlight');
      },
    });
    // Cabin door.
    add({
      id: 'cabin-door', position: at(a.cabinDoor), range: 2.4,
      prompt: () => (this.has('metHale') ? 'Talk to Hale' : 'Knock on the door'),
      use: () => {
        if (this.busy) return;
        if (this.has('metHale')) {
          this.s.hud.say('Hale', this.has('calledMedevac') ? 'I heard the helicopter call on your radio. Thank you.' : 'Your truck radio. Please hurry.', 4);
          return;
        }
        this.sfx?.play('knock', a.cabinDoor);
        this.set('cabinFound');
        setTimeout(() => {
          this.run(HALE, () => {
            this.set('metHale');
            this.clue('hale');
          });
        }, 1400);
      },
    });
    // Camp and lookout.
    add({
      id: 'camp-fire', position: at(a.campFire), range: 2.6,
      prompt: () => (this.has('campFire') ? null : 'Examine the fire pit'),
      use: () => {
        this.set('campFire');
        this.set('campFound');
        this.clue('camp');
      },
    });
    add({
      id: 'cutters', position: at(a.boltCutters), range: 2.0,
      prompt: () => (this.has('cutters') ? null : 'Examine the bolt cutters'),
      use: () => {
        this.set('cutters');
        this.clue('cutters');
      },
    });
    add({
      id: 'binoculars', position: at(a.binoculars), range: 2.2,
      prompt: () => (this.zoom ? null : 'Look through the binoculars'),
      use: () => {
        const target = a.cabin ? a.cabin.clone().add(new THREE.Vector3(0, 8, 0)) : new THREE.Vector3();
        this.zoom = { t: 0, target };
        this.savedFov = this.s.game.camera.fov;
        this.s.game.input.enabled = false;
        // Binoculars are an eye-level view; the third-person camera returns after.
        this.s.game.player.firstPerson = true;
      },
    });
  }

  /** Position of the dropped searchlight (set by the session after building). */
  lightPos: THREE.Vector3 | null = null;

  private powerOn(): void {
    const st = this.st.station;
    st.lamp.intensity = 7;
    st.porchLamp.intensity = 5;
    st.lampMat.emissiveIntensity = 2.5;
    st.radioLed.emissiveIntensity = 3;
    this.s.hud.toast('Power restored', 'The station lights flicker on. The radio\'s standby light glows.', 'info');
  }

  // ------------------------------------------------------------ objectives

  currentObjective(): { key: string; text: string; sub: string; target: THREE.Vector3 | null } {
    const a = this.st.anchors;
    const f = (k: Flag) => this.has(k);
    if (f('calledMedevac')) return { key: 'done', text: 'Wait for the medevac with Hale', sub: '', target: null };
    if (f('metHale')) return { key: 'medevac', text: 'Return to your truck and radio for a medevac', sub: 'In the truck, press T to call dispatch.', target: this.s.truck.position.clone() };
    if (f('cabinFound')) return { key: 'cabin', text: 'Check the Miller cabin', sub: '', target: a.cabinDoor ?? null };
    if (f('wreckSearched') || f('tape')) return { key: 'tape', text: 'Follow Hale\'s flagging tape', sub: 'She said she was heading for the Miller cabin.', target: this.hintLevel >= 2 || f('binoculars') ? a.cabin ?? null : null };
    if (f('wreckFound') || f('skids')) return { key: 'wreck', text: 'Search the wreck below the bend', sub: '', target: a.wreck ?? null };
    if (f('gateOpen')) return { key: 'bend', text: 'Find where Unit 4 left Ridge Road', sub: 'Hale said: "above the ravine".', target: f('heardRecording') ? a.wreckBend ?? null : null };
    if (f('crossedFord')) {
      if (f('hasKey')) return { key: 'gate', text: 'Unlock the Ridge Gate', sub: '', target: a.gate ?? null };
      return { key: 'key', text: 'Find a key for the Ridge Gate', sub: 'Hale mentioned a spare at the station.', target: a.stationDoor ?? null };
    }
    if (f('heardRecording')) {
      if (!f('hasKey')) return { key: 'key', text: 'Take the spare Ridge Gate key', sub: 'The key cabinet is inside the station.', target: a.keyCabinet ?? null };
      return { key: 'ford', text: 'Cross Hollow Creek at the ford', sub: 'The bridge is out. Look for the tracks Hale left.', target: f('tracks') || this.mapReveals.has('ford') ? new THREE.Vector3(69, 0, -72) : a.bridgeTracks ?? null };
    }
    if (f('logbook')) {
      if (!f('powerOn')) {
        if (!f('generatorChecked')) return { key: 'generator', text: 'Get the station radio working', sub: 'Check the generator outside.', target: a.generator ?? null };
        if (!f('generatorFueled')) return { key: 'generator', text: 'Get the station radio working', sub: f('hasFuel') ? 'Refuel the generator.' : 'Find fuel: there is a jerrycan on your truck.', target: f('hasFuel') ? a.generator ?? null : this.s.truck.position.clone() };
        if (!f('generatorRunning')) return { key: 'generator', text: 'Get the station radio working', sub: 'Start the generator.', target: a.generator ?? null };
        return { key: 'generator', text: 'Get the station radio working', sub: 'Throw the transfer switch on the power box.', target: a.powerBox ?? null };
      }
      return { key: 'radio', text: 'Check the radio for messages', sub: '', target: a.radio ?? null };
    }
    if (f('stationReached')) return { key: 'search', text: 'Search the ranger station', sub: 'Ranger Hale stopped answering the radio two days ago.', target: a.stationDoor ?? null };
    return { key: 'station', text: 'Drive to Hollow Creek Ranger Station', sub: 'Ranger Hale stopped answering the radio two days ago.', target: a.stationDoor ?? null };
  }

  /** Main-path completion 0..1 (drives the light towards dusk). */
  progress(): number {
    if (this.progressOverride) return this.progressOverride();
    const steps: Flag[] = ['stationReached', 'logbook', 'powerOn', 'heardRecording', 'crossedFord', 'gateOpen', 'wreckSearched', 'metHale', 'calledMedevac'];
    return steps.filter((s) => this.has(s)).length / steps.length;
  }

  private hintSource: ObjectiveView | null = null;

  /** Restart the idle-hint timer (new mission objective). */
  progressed(): void {
    this.lastProgress = this.s.game.time;
    this.hintLevel = 0;
  }

  hint(): string {
    const o: ObjectiveView = this.hintSource ?? this.currentObjective();
    const list = o.hints?.length ? o.hints : HINTS[o.key];
    if (!list) return 'Explore and look for anything Hale left behind.';
    return list[Math.min(list.length - 1, this.hintLevel > 0 ? this.hintLevel - 1 : 0)];
  }

  /** Called when the player asks for a hint from the journal. */
  requestHint(): string {
    this.hintLevel = Math.min(2, this.hintLevel + 1);
    return this.hint();
  }

  // ------------------------------------------------------------ per frame

  private update(dt: number): void {
    const g = this.s.game;
    if (this.ended) return;
    const pos = this.s.focusPosition;
    const near = (v: THREE.Vector3 | undefined | { x: number; z: number }, r: number) => !!v && Math.hypot(pos.x - v.x, pos.z - v.z) < r;
    const a = this.st.anchors;
    if (near(a.suvDoor, 22) && this.set('suvSeen')) this.s.hud.toast('Abandoned SUV', 'A maroon SUV is nose-down in the ditch, driver\'s door open.', 'info');
    if (near(SITES.station, 32) && this.set('stationReached')) this.s.hud.toast('Hollow Creek Ranger Station', 'No lights. Hale\'s truck is not here.', 'objective');
    if (near(a.bridge, 24)) this.set('bridgeSeen');
    if (!this.has('crossedFord') && pos.z < -94 && pos.x > -30 && pos.x < 90 && this.s.game.terrain.creek.nearest(pos.x, pos.z).dist > 8) {
      // North of the creek near the road or ford.
      const c = this.s.game.terrain.creek.nearest(pos.x, pos.z);
      if (c.lateral < 0 || pos.z < -100) {
        this.set('crossedFord');
        this.s.hud.toast('Across Hollow Creek', '', 'objective');
      }
    }
    if (near(a.wreck, 14)) this.set('wreckFound');
    if (near(a.cabin, 18) && !this.has('cabinFound')) {
      this.set('cabinFound');
      this.s.hud.toast('The Miller cabin', 'A thin thread of smoke from the chimney.', 'objective');
    }
    if (near(SITES.camp, 10)) this.set('campFound');

    // Gate swing and station door animation.
    if (this.has('gateOpen') && this.gateAngle < 1.65) {
      this.gateAngle = Math.min(1.65, this.gateAngle + dt * 0.9);
      this.st.gate.arm.rotation.y = -this.gateAngle;
    }
    const doorTarget = this.doorOpen ? -1.6 : -0.02;
    this.doorAngle = THREE.MathUtils.damp(this.doorAngle, doorTarget, 4, dt);
    this.st.station.door.rotation.y = this.doorAngle;

    // Scripted dialogue.
    if (this.script) {
      const sc = this.script;
      sc.t -= dt * this.scriptSpeed;
      if (sc.t <= 0) {
        sc.i += 1;
        if (sc.i >= sc.lines.length) {
          this.script = null;
          this.s.hud.clearSubtitle();
          sc.done();
        } else {
          const line = sc.lines[sc.i];
          sc.t = line.t;
          this.s.hud.say(line.who, line.text, line.t + 0.3);
          if (line.who === 'Radio' || line.who === 'Dispatch') this.sfx?.play('radioBeep');
        }
      }
    }

    // Binocular view toward the creek bottom.
    if (this.zoom) {
      const z = this.zoom;
      z.t += dt;
      const cam = g.camera;
      cam.fov = THREE.MathUtils.damp(cam.fov, 14, 5, dt);
      const dir = z.target.clone().sub(cam.position).normalize();
      const yaw = Math.atan2(-dir.x, -dir.z);
      const pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      g.player.yaw = yaw;
      g.player.pitch = pitch;
      cam.updateProjectionMatrix();
      if (z.t > 1.5 && !this.has('binoculars')) {
        this.set('binoculars');
        this.clue('binoculars');
        this.mapReveals.add('cabin');
      }
      if (z.t > 6.5) {
        cam.fov = this.savedFov;
        cam.updateProjectionMatrix();
        this.zoom = null;
        g.input.enabled = true;
        g.player.firstPerson = false;
        g.player.pitch = THREE.MathUtils.clamp(g.player.pitch, -0.6, 0.6);
      }
    }

    // Truck radio call for the medevac.
    if (this.has('metHale') && !this.has('calledMedevac') && this.s.mode === 'vehicle') {
      this.s.setForcedPrompt(this.script ? null : 'Radio dispatch');
      if (!this.script && g.input.pressed('radio')) {
        this.sfx?.play('radioBeep');
        this.run(this.medevacLines, () => {
          this.set('calledMedevac');
          this.s.setForcedPrompt(null);
          this.onMedevac?.();
          if (this.endOnMedevac) setTimeout(() => this.finish(), 1500);
        });
      }
    } else if (!this.has('calledMedevac') && !this.hudOverride) {
      this.s.setForcedPrompt(null);
    }

    // Objective HUD, compass marker and hints.
    const o: ObjectiveView = this.hudOverride?.() ?? this.currentObjective();
    this.s.hud.setObjective(o.text, o.sub);
    if (o.target) {
      const dx = o.target.x - pos.x;
      const dz = o.target.z - pos.z;
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const dist = Math.hypot(dx, dz);
      this.s.hud.setCompass(this.s.compassHeading, { bearing, label: dist > 1000 ? `${(dist / 1000).toFixed(1)} km` : `${Math.round(dist)} m` });
    } else {
      this.s.hud.setCompass(this.s.compassHeading, null);
    }
    if (o.key !== this.hintObjective) {
      this.hintObjective = o.key;
      this.lastProgress = g.time;
      this.hintLevel = 0;
    }
    this.hintSource = o;
    const idle = g.time - this.lastProgress;
    if (!this.busy && idle > 180 && this.hintLevel === 0) {
      this.hintLevel = 1;
      this.s.hud.toast('Hint', this.hint(), 'hint');
    } else if (!this.busy && idle > 330 && this.hintLevel === 1) {
      this.hintLevel = 2;
      this.s.hud.toast('Hint', this.hint(), 'hint');
    }

    // Light moves toward dusk as the story advances.
    const targetDusk = Math.min(0.9, this.progress() * 0.95);
    if (Math.abs(this.duskT - targetDusk) > 0.001) {
      this.duskT = THREE.MathUtils.damp(this.duskT, targetDusk, 0.05, dt);
      g.atmosphere.blend(AFTERNOON, DUSK, this.duskT, g.scene);
      g.renderer.toneMappingExposure = g.atmosphere.state.exposure;
    }
  }

  private finish(): void {
    this.ended = true;
    this.onEnding?.();
  }

  // ------------------------------------------------------------ save/load

  serialize(): { flags: Flag[]; clues: string[]; reveals: string[] } {
    return { flags: [...this.flags], clues: this.clues.map((c) => c.id), reveals: [...this.mapReveals] };
  }

  restore(data: { flags: Flag[]; clues: string[]; reveals: string[] }): void {
    for (const f of data.flags) this.flags.add(f);
    for (const id of data.clues) if (CLUES[id] && !this.clues.some((c) => c.id === id)) this.clues.push({ id, ...CLUES[id] });
    for (const r of data.reveals) this.mapReveals.add(r);
    if (this.has('hasFuel') && this.s.truck.parts.jerrycan) this.s.truck.parts.jerrycan.visible = false;
    if (this.has('hasKey') && this.st.pickups.gateKey) this.st.pickups.gateKey.visible = false;
    if (this.has('powerOn')) this.powerOn();
    if (this.has('generatorRunning')) this.sfx?.setLoop('generator', true, this.st.anchors.generator);
    if (this.has('gateOpen')) {
      this.gateAngle = 1.65;
      this.st.gate.arm.rotation.y = -1.65;
      this.st.gate.collider.setEnabled(false);
    }
    this.duskT = Math.min(0.9, this.progress() * 0.95);
    this.s.game.atmosphere.blend(AFTERNOON, DUSK, this.duskT, this.s.game.scene);
    this.lastProgress = this.s.game.time;
  }

  totalClues(): { found: number; total: number; mainFound: number; mainTotal: number } {
    const all = Object.values(CLUES);
    return {
      found: this.clues.length,
      total: all.length,
      mainFound: this.clues.filter((c) => c.main).length,
      mainTotal: all.filter((c) => c.main).length,
    };
  }
}
