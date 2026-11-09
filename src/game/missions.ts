// The mission layer: eight connected missions on top of the Hollow Creek mystery.
// Missions 2 and 3 reuse the original story beats (station, generator, recording,
// ford, gate, wreck, tape, Hale) and add new ones; Missions 1 and 4-8 are new.
// Objectives are evaluated in order every frame, so doing things out of order
// simply completes later objectives as soon as they come up.
//
//  1 Range Day                     learn the controls at the district range
//  2 The Silent Station            search the station, open the gun locker
//  3 The Lost Patrol               find Unit 4, survive the poachers, find Hale
//  4 Protect the Ranger Route      call it in, clear the Ridge Road roadblock
//  5 The Hidden Supply Cache       follow the GPS, find and open the cache
//  6 Clear the Blocked Route       choose a loadout, clear the ford, winch the tree
//  7 Track the Source              read the evidence, follow the ATV trail, take the camp
//  8 Final Forest Operation        stop Kessler's handover at the trailhead

import * as THREE from 'three';
import type { Session } from './session.ts';
import type { Line, ObjectiveView } from './mystery.ts';
import { SITES } from '../world/layout.ts';
import { meetingColliders, type MissionSites } from '../world/missionSites.ts';
import { POACHER_OUTFITS } from '../character/humanoid.ts';
import type { NpcGroup, NpcSpec, Npc } from './npc.ts';
import { Pickups } from './pickups.ts';
import { PaperTargetHit, PlateTarget } from './targets.ts';
import { WEAPONS, type AmmoType } from '../weapons/defs.ts';
import { MISSION_HINTS } from './missionHints.ts';

interface ObjectiveDef {
  id: string;
  text: string;
  sub?: string | (() => string);
  target?: () => THREE.Vector3 | null | undefined;
  done: () => boolean;
  onStart?: () => void;
  /** Computed hints (steps whose advice depends on progress); otherwise MISSION_HINTS[id]. */
  hints?: () => string[];
}

interface MissionDef {
  id: string;
  title: string;
  brief: string;
  checkpoint: () => { pos: THREE.Vector3; yaw: number };
  objectives: ObjectiveDef[];
  onStart?: () => void;
  onComplete?: () => void;
  reward?: string;
}

export interface MissionSave {
  index: number;
  step: number;
  flags: string[];
  pickups: string[];
  down: string[];
}

const LINE = (who: string, text: string, t = 4.5): Line => ({ who, text, t });

const DISPATCH_INTRO: Line[] = [
  LINE('Dispatch', 'Unit Two, Dispatch. You at Hollow Creek yet?', 3.5),
  LINE('You', 'At the trailhead lot. Heading up to the station.', 3.5),
  LINE('Dispatch', 'Hale\'s last reports mention armed jacklighters on the north ridge. Your sidearm\'s in the range lockbox past the lot.', 6),
  LINE('Dispatch', 'Qualify with it before you go up. That\'s not a suggestion.', 4),
  LINE('You', 'Copy. Range first.', 2.5),
];

const MEDEVAC_CALL: Line[] = [
  LINE('You', 'Dispatch, Unit Two. I\'ve found Ranger Hale at the Miller cabin. Alive, broken ankle.', 5),
  LINE('Dispatch', 'Copy, Unit Two. Rescue team\'s on the highway with a litter. They\'ll come up Ridge Road from the gate.', 5.5),
  LINE('Dispatch', 'Be advised: a hunter reports a dark SUV parked across Ridge Road below the bend. Armed men, spotlights.', 5.5),
  LINE('Dispatch', 'Rescue can\'t get past that. Can you clear the road?', 4),
  LINE('You', 'On my way. Unit Two out.', 2.5),
];

const RESCUE_LINES: Line[] = [
  LINE('Rescue', 'Unit Two, rescue team. We\'re through the Ridge Gate.', 4),
  LINE('Rescue', 'Road\'s clear past the bend. We can see the cabin smoke.', 4.5),
  LINE('Rescue', 'We\'ve got her. Litter\'s moving; medevac\'s waiting at the lookout clearing.', 5),
  LINE('Hale', 'Unit Two? Thank you. One more thing: there\'s a .30-06 in the lookout cab. Take it if you\'re staying up here.', 6),
  LINE('You', 'Copy. Get some rest.', 2.5),
];

const DISPATCH_M6: Line[] = [
  LINE('Dispatch', 'Unit Two, a fisherman on the creek reports chainsaws at the old ford.', 4.5),
  LINE('Dispatch', 'If they\'ve blocked that track, your truck can\'t get back out of the valley.', 4.5),
  LINE('You', 'Copy. I\'ll take a look.', 2.5),
];

const DISPATCH_M8: Line[] = [
  LINE('Dispatch', 'Unit Two, state patrol is twenty minutes out. Kessler won\'t wait that long.', 4.5),
  LINE('You', 'Then I\'ll hold him at the trailhead. Unit Two out.', 3.5),
];

const FINAL_LINES: Line[] = [
  LINE('You', 'Dispatch, Unit Two. Dale Kessler and his crew in custody at the Hollow Creek trailhead. Their buyer too.', 5.5),
  LINE('Dispatch', 'Copy, Unit Two. State patrol is two minutes out. Medevac reports Ranger Hale is stable at County General.', 5.5),
  LINE('Dispatch', 'She asked us to pass something on: "Tell Unit Two the coffee\'s on me."', 4.5),
  LINE('You', 'Copy that. Unit Two out.', 2.5),
];

export class Missions {
  private s: Session;
  readonly sites: MissionSites;
  readonly pickups: Pickups;
  private defs: MissionDef[];
  index = 0;
  step = 0;
  readonly flags = new Set<string>();
  private stepFlags = new Set<string>();
  private stepStart = 0;
  /** When the previous mission finished (screens opened since then count). */
  private missionDoneAt = 0;
  private time = 0;
  private aimT = 0;
  private plates: PlateTarget[] = [];
  private papers: PaperTargetHit[] = [];
  private plateHit = new Set<number>();
  private paperHits = 0;
  private paperSeen = new Set<number>();
  private lastReload = -1;
  private screensOpened = new Map<string, number>();
  private lastWeapon: string | null = null;
  private advanceT = -1;
  private anim = { lid: 0, locker: 0, hatch: 0, branches: 0, log: 0 };
  private downIds = new Set<string>();
  ended = false;
  /** Tests: run dialogue faster. */
  fast = false;

  constructor(session: Session, sites: MissionSites) {
    this.s = session;
    this.sites = sites;
    const m = session.mystery;
    // Missions continue the story past the medevac call.
    m.endOnMedevac = false;
    m.medevacLines = MEDEVAC_CALL;
    m.hudOverride = () => this.view();
    m.progressOverride = () => Math.min(0.95, (this.index + this.step / Math.max(1, this.defs[this.index]?.objectives.length ?? 1)) / 8 * 1.05);
    this.registerClues();
    this.pickups = new Pickups({
      addInteractable: (i) => session.addInteractable(i),
      weapons: session.weapons,
      toast: (t, b) => session.hud.toast(t, b, 'info'),
      sound: (k, p) => session.audio.gunMech(k, p),
    }, session.game.scene);
    this.setupTargets();
    this.setupPickups();
    this.setupInteractions();
    session.weapons.onReloaded = () => {
      this.lastReload = this.time;
    };
    this.defs = this.buildDefs();
  }

  // ------------------------------------------------------------ helpers

  private get m() {
    return this.s.mystery;
  }

  private get w() {
    return this.s.weapons;
  }

  private get you(): THREE.Vector3 {
    return this.s.focusPosition;
  }

  private near(p: THREE.Vector3 | { x: number; z: number } | undefined, r: number): boolean {
    if (!p) return false;
    return Math.hypot(this.you.x - p.x, this.you.z - p.z) < r;
  }

  private v(x: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, this.s.game.terrain.heightAt(x, z), z);
  }

  private group(id: string): NpcGroup | undefined {
    return this.s.npcs.groups.get(id);
  }

  private cleared(id: string): boolean {
    const g = this.group(id);
    return !!g && g.alive === 0;
  }

  /** Accumulated seconds the player has aimed at a member of `groupId`. */
  private aimedAt(groupId: string, npcId?: string): boolean {
    return this.stepFlags.has(`aimed:${groupId}:${npcId ?? '*'}`);
  }

  private say(lines: Line[], done?: () => void): void {
    this.m.say(lines, done);
  }

  // ------------------------------------------------------------ clues

  private registerClues(): void {
    const m = this.m;
    m.registerClue('gps', { title: 'The poachers\' GPS', text: 'A handheld GPS from the roadblock truck. One saved waypoint, labelled "CACHE", in the woods east of the hidden camp. Your map is marked.', main: true });
    m.registerClue('ledger', { title: 'The cache ledger', text: '"Racks 14 · hides 9 · bear gall 2 — R. pays on pickup at the landing. Move the rest before the rangers come back. — D.K."\nEvery delivery is to "the landing", east along the ATV trail.', main: true });
    m.registerClue('atv', { title: 'ATV tracks', text: 'Fresh knobbly tyre tracks leave the hidden camp heading east, deeper than a hiker\'s path. Somebody hauls heavy loads this way.', main: false });
    m.registerClue('kesslerNotes', { title: 'Kessler\'s notes', text: '"R. wants the lot tonight. Trailhead lot at last light, his white van. The ranger\'s truck is still up at the bend; don\'t go near it." Signed D.K.: Dale Kessler, owner of the maroon SUV.', main: true });
    m.registerClue('arrest', { title: 'Dale Kessler in custody', text: 'Kessler ran Hale off Ridge Road to protect the night poaching and the trade with his buyer. He is cuffed at the trailhead with his crew.', main: true });
  }

  // ------------------------------------------------------------ setup

  private setupTargets(): void {
    const c = this.s.combat;
    this.sites.plates.forEach((p, i) => {
      const t = new PlateTarget(`plate${i}`, p);
      t.onHit_ = () => {
        this.plateHit.add(i);
        this.s.hud.hitMarker(false);
      };
      this.plates.push(t);
      c.add(t);
    });
    this.sites.papers.forEach((p, i) => {
      const t = new PaperTargetHit(`paper${i}`, p);
      t.onHit_ = () => {
        this.paperHits += 1;
        this.paperSeen.add(i);
      };
      this.papers.push(t);
      c.add(t);
    });
  }

  private setupPickups(): void {
    const d = this.sites.displays;
    const a = this.sites.anchors;
    const P = this.pickups;
    P.weapon('rangeP9', 'p9', d.rangeP9.object, a.lockbox, { prompt: 'Take the Warden P9 and a box of 9 mm', available: () => this.flags.has('lockboxOpen'), extraAmmo: 15 });
    P.weapon('lockerShotgun', 'ranger12', d.lockerShotgun.object, a.locker, { prompt: 'Take the Ranger 12 and the shells', available: () => this.flags.has('lockerOpen'), extraAmmo: 6 });
    P.weapon('wreckRevolver', 'bridger', d.wreckRevolver.object, a.wreckRevolver, { prompt: 'Take Hale\'s revolver (Bridger .44)', extraAmmo: 6 });
    P.weapon('cacheRifle', 'marten', d.cacheRifle.object, a.cacheRifle, { prompt: 'Take the Marten AR and the 5.56', available: () => this.flags.has('hatchOpen'), extraAmmo: 30, range: 2.4 });
    P.weapon('campDmr', 'longwatch', d.campDmr.object, a.campRack, { prompt: 'Take Kessler\'s scoped rifle (Longwatch DMR)' });
    P.weapon('lookoutRifle', 'ridgeline', d.lookoutRifle.object, a.lookoutRifle, { prompt: 'Take the lookout\'s Ridgeline .30-06', extraAmmo: 10 });
    // Ammunition caches near the encounters.
    const box = (id: string, type: AmmoType, n: number, x: number, z: number) => void P.ammo(id, type, n, this.v(x, z));
    const rb = SITES.roadblock;
    box('ammoRoadblock', '9mm', 30, rb.x + 2.4, rb.z - 3.2);
    box('ammoBlockade', '12ga', 10, SITES.blockade.x - 3.5, SITES.blockade.z + 4.5);
    const bc = SITES.baseCamp;
    box('ammoCamp1', '9mm', 30, bc.x - 2.4, bc.z + 1.2);
    box('ammoCamp2', '.30-06', 10, bc.x + 2.8, bc.z - 6.5);
    box('ammoCamp3', '12ga', 8, bc.x - 7.2, bc.z + 1.9);
    box('ammoStation', '.44', 12, 66.2, 6.4);
  }

  private setupInteractions(): void {
    const s = this.s;
    const a = this.sites.anchors;
    const add = (i: Parameters<Session['addInteractable']>[0]) => s.addInteractable(i);
    add({
      id: 'range-lockbox', position: () => a.lockbox, range: 2.2, hold: 0.8,
      prompt: () => (this.flags.has('lockboxOpen') ? null : 'Unlock the range lockbox (hold)'),
      use: () => {
        this.flags.add('lockboxOpen');
        s.audio.play('unlock', a.lockbox);
      },
    });
    add({
      id: 'station-locker', position: () => a.locker, range: 2.2,
      hold: 0,
      prompt: () => {
        if (this.flags.has('lockerOpen')) return null;
        return this.m.has('logbook') ? 'Dial the combination 4-1-7 (hold)' : 'Examine the gun locker';
      },
      use: () => {
        if (!this.m.has('logbook')) {
          s.hud.say('', 'Steel gun locker with a three-number dial. Hale would have written the combination down somewhere.', 5);
          s.audio.play('click', a.locker);
          return;
        }
        this.flags.add('lockerOpen');
        s.audio.play('unlock', a.locker);
        setTimeout(() => s.audio.play('doorOpen', a.locker), 300);
      },
    });
    const locker = s.interactions.get('station-locker');
    if (locker) Object.defineProperty(locker, 'hold', { get: () => (this.m.has('logbook') && !this.flags.has('lockerOpen') ? 1.2 : 0) });
    add({
      id: 'roadblock-truck', position: () => a.roadblockTruck, range: 2.8,
      prompt: () => (this.flags.has('gps') ? null : this.cleared('roadblock') || this.index > 3 ? 'Search the poachers\' truck' : null),
      use: () => {
        this.flags.add('gps');
        this.m.clue('gps');
        this.m.mapReveals.add('cache');
        this.w.give('vireo', { reserve: WEAPONS.vireo.startReserve });
        s.audio.play('rummage', a.roadblockTruck);
      },
    });
    add({
      id: 'cache-tracks', position: () => a.cacheTracks, range: 3,
      prompt: () => (this.flags.has('cacheTracks') || this.index < 4 ? null : 'Examine the boot prints'),
      use: () => {
        this.flags.add('cacheTracks');
        s.hud.say('', 'Boot prints and two drag marks lead off the trail toward a pile of cut branches.', 5);
      },
    });
    add({
      id: 'cache-branches', position: () => a.cacheHatch, range: 2.6, hold: 1.0,
      prompt: () => (this.flags.has('branches') || this.index < 4 ? null : 'Pull the cut branches aside (hold)'),
      use: () => {
        this.flags.add('branches');
        s.audio.play('rummage', a.cacheHatch);
        s.hud.say('', 'Under the branches: a plank trapdoor in the ground, chained and padlocked.', 5);
      },
    });
    add({
      id: 'cache-chain', position: () => a.cacheHatch, range: 2.6,
      prompt: () => {
        if (!this.flags.has('branches') || this.flags.has('chainCut')) return null;
        return this.flags.has('cutters') ? 'Cut the chain with the bolt cutters (hold)' : 'Examine the padlocked chain';
      },
      use: () => {
        if (!this.flags.has('cutters')) {
          s.hud.say('', 'A heavy chain through the hatch ring, padlocked to a stake. You\'d need bolt cutters. The hidden camp had a pair.', 6);
          return;
        }
        this.flags.add('chainCut');
        s.audio.play('unlock', a.cacheHatch);
      },
    });
    const chain = s.interactions.get('cache-chain');
    if (chain) Object.defineProperty(chain, 'hold', { get: () => (this.flags.has('cutters') ? 1.0 : 0) });
    add({
      id: 'cache-hatch', position: () => a.cacheHatch, range: 2.6, hold: 0.8,
      prompt: () => (this.flags.has('chainCut') && !this.flags.has('hatchOpen') ? 'Lift the hatch (hold)' : null),
      use: () => {
        this.flags.add('hatchOpen');
        s.audio.play('doorOpen', a.cacheHatch);
      },
    });
    add({
      id: 'cache-ledger', position: () => a.cacheLedger, range: 2.4,
      prompt: () => (this.flags.has('hatchOpen') && !this.m.hasClue('ledger') ? 'Read the ledger' : null),
      use: () => {
        this.m.clue('ledger');
        this.m.mapReveals.add('basecamp');
        s.audio.play('paper', a.cacheLedger);
      },
    });
    // The bolt cutters at the hidden camp can be taken once you need them.
    const cutters = this.s.structures.anchors.boltCutters;
    add({
      id: 'take-cutters', position: () => cutters ?? new THREE.Vector3(1e6, 0, 0), range: 2.2,
      prompt: () => (this.flags.has('cutters') || this.index < 4 || !this.flags.has('branches') ? null : 'Take the bolt cutters'),
      use: () => {
        this.flags.add('cutters');
        const obj = this.s.structures.pickups.boltCutters;
        if (obj) obj.visible = false;
        s.hud.toast('Taken', 'Bolt cutters', 'info');
        s.audio.play('keys', cutters);
      },
    });
    add({
      id: 'blockade-truck', position: () => a.blockadeTruck, range: 2.8,
      prompt: () => (this.w.has('ironwood') || !this.cleared('blockade') ? null : 'Search the poachers\' truck'),
      use: () => {
        this.w.give('ironwood', { reserve: WEAPONS.ironwood.startReserve });
        s.audio.play('rummage', a.blockadeTruck);
      },
    });
    add({
      id: 'blockade-log', position: () => a.blockadeLog, range: 3.2, hold: 2.2,
      prompt: () => {
        if (this.flags.has('logCleared') || this.index < 5) return null;
        if (!this.cleared('blockade')) return null;
        return s.truck.position.distanceTo(a.blockadeLog) < 25 ? 'Hook the winch and drag the tree clear (hold)' : 'Felled tree across the track';
      },
      use: () => {
        if (s.truck.position.distanceTo(a.blockadeLog) >= 25) {
          s.hud.say('', 'Too heavy to move by hand. Bring your truck within 25 metres and use its winch.', 5);
          return;
        }
        this.flags.add('logCleared');
        s.audio.play('gate', a.blockadeLog);
      },
    });
    const logI = s.interactions.get('blockade-log');
    if (logI) Object.defineProperty(logI, 'hold', { get: () => (s.truck.position.distanceTo(a.blockadeLog) < 25 ? 2.2 : 0) });
    const camp = this.s.structures.anchors.campFire;
    add({
      id: 'atv-tracks', position: () => (camp ? camp.clone().add(new THREE.Vector3(4.5, 0, -1.5)) : new THREE.Vector3(1e6, 0, 0)), range: 3.5,
      prompt: () => (this.flags.has('atvTracks') || this.index < 6 ? null : 'Examine the ATV tracks'),
      use: () => {
        this.flags.add('atvTracks');
        this.m.clue('atv');
        this.m.mapReveals.add('basecamp');
      },
    });
    add({
      id: 'camp-notes', position: () => a.campNotes, range: 2.4,
      prompt: () => (this.m.hasClue('kesslerNotes') ? null : 'Read the notes on the table'),
      use: () => {
        this.m.clue('kesslerNotes');
        s.audio.play('paper', a.campNotes);
      },
    });
    add({
      id: 'kessler-cuff', position: () => this.kessler()?.renderPos.clone().add(new THREE.Vector3(0, 1, 0)) ?? new THREE.Vector3(1e6, 0, 0), range: 2.6, hold: 1.0,
      prompt: () => (this.kessler()?.state === 'down' && !this.flags.has('arrested') ? 'Cuff Dale Kessler (hold)' : null),
      use: () => {
        this.flags.add('arrested');
        this.m.clue('arrest');
        s.audio.play('keys', this.kessler()!.renderPos);
        s.hud.say('Kessler', 'You\'ve got nothing. That ranger drove herself off the road.', 4);
      },
    });
    // Resupply from the truck once per mission.
    add({
      id: 'truck-resupply', position: () => s.truck.localToWorld(new THREE.Vector3(0, 1.0, -2.4)), range: 2.4,
      prompt: () => (s.mode !== 'foot' || this.flags.has(`resupply${this.index}`) || this.w.owned.size === 0 ? null : 'Restock ammunition from the truck'),
      use: () => {
        this.flags.add(`resupply${this.index}`);
        const got: string[] = [];
        for (const o of this.w.owned.values()) {
          const n = this.w.addAmmo(o.def.ammo, o.def.magSize);
          if (n > 0) got.push(`${o.def.ammo} +${n}`);
        }
        s.hud.toast('Truck lockbox', got.length ? got.join(' · ') : 'Everything is already full.', 'info');
        s.audio.gunMech('ammo', s.game.player.renderPos);
      },
    });
  }

  private kessler(): Npc | undefined {
    return this.group('meeting')?.members.find((n) => n.spec.boss);
  }

  // ------------------------------------------------------------ encounters

  private spawn(id: string): NpcGroup | null {
    if (this.group(id)) return this.group(id)!;
    const specs = this.encounter(id);
    if (!specs) return null;
    const cover = this.sites.cover[id] ?? [];
    // Add cover behind nearby trunks (the side away from the likely approach).
    const c = this.centerOf(id);
    const from = this.approachOf(id);
    for (const t of this.s.game.vegetation.treesNear(c.x, c.z, 30)) {
      if (t.radius < 0.2) continue;
      const away = new THREE.Vector2(t.x - from.x, t.z - from.z).normalize();
      cover.push([t.x + away.x * (t.radius + 0.6), t.z + away.y * (t.radius + 0.6)]);
    }
    const g = this.s.npcs.spawn(id, specs, cover);
    g.onDefeated = (n) => {
      this.downIds.add(n.id);
      if (n.dropped) this.pickups.dropped(`drop-${n.id}`, n.spec.weapon, n.dropped);
    };
    // Restore surrendered crew from a save.
    for (const n of g.members) if (this.downIds.has(n.id)) this.forceDown(n);
    return g;
  }

  private forceDown(n: Npc): void {
    n.restoreSurrendered(this.s.game.scene);
    if (n.dropped) this.pickups.dropped(`drop-${n.id}`, n.spec.weapon, n.dropped);
  }

  private centerOf(id: string): THREE.Vector3 {
    const s = SITES;
    const map: Record<string, { x: number; z: number }> = {
      wreck: s.wreck, roadblock: s.roadblock, blockade: s.blockade, camp: s.baseCamp, meeting: { x: 72, z: 252 },
    };
    const p = map[id] ?? { x: 0, z: 0 };
    return new THREE.Vector3(p.x, 0, p.z);
  }

  private approachOf(id: string): THREE.Vector3 {
    const map: Record<string, [number, number]> = {
      wreck: [-80, -120], roadblock: [-60, -158], blockade: [0, -106], camp: [120, -200], meeting: [40, 215],
    };
    const [x, z] = map[id] ?? [0, 0];
    return new THREE.Vector3(x, 0, z);
  }

  private encounter(id: string): NpcSpec[] | null {
    const O = POACHER_OUTFITS;
    const rb = SITES.roadblock;
    const bl = SITES.blockade;
    const bc = SITES.baseCamp;
    switch (id) {
      case 'wreck':
        // Two of the crew come down from the bend to strip the wreck.
        return [
          { id: 'w1', outfit: O[1], weapon: 'ridgeline', x: -70, z: -158, facing: -2.5, patrol: [[-70, -158], [-77, -147], [-79, -141]], sight: 40, leash: 45, accuracy: 0.45 },
          { id: 'w2', outfit: O[2], weapon: 'ranger12', x: -67, z: -160, facing: -2.5, patrol: [[-67, -160], [-74, -150], [-76, -143]], sight: 35, leash: 45, accuracy: 0.4 },
        ];
      case 'roadblock':
        return [
          { id: 'r1', outfit: O[1], weapon: 'ranger12', x: rb.x + 1.5, z: rb.z + 3.5, facing: 0.8, sight: 40, leash: 30, accuracy: 0.4 },
          { id: 'r2', outfit: O[2], weapon: 'vireo', x: rb.x - 3, z: rb.z - 1.5, facing: -2.2, patrol: [[rb.x - 3, rb.z - 1.5], [rb.x - 10, rb.z - 6]], sight: 42, leash: 30, accuracy: 0.45 },
          { id: 'r3', outfit: O[3], weapon: 'ridgeline', x: rb.x - 5.5, z: rb.z + 5, facing: 2.0, sight: 50, leash: 30, accuracy: 0.55 },
        ];
      case 'blockade':
        return [
          { id: 'b1', name: 'Wade', outfit: O[0], weapon: 'ironwood', x: bl.x + 1.5, z: bl.z + 1.5, facing: -1.6, sight: 55, leash: 30, accuracy: 0.5, health: 130 },
          { id: 'b2', outfit: O[1], weapon: 'marten', x: bl.x - 2, z: bl.z + 4, facing: -1.4, sight: 48, leash: 30, accuracy: 0.45 },
          { id: 'b3', outfit: O[3], weapon: 'ranger12', x: bl.x + 3.5, z: bl.z - 3, facing: -1.8, patrol: [[bl.x + 3.5, bl.z - 3], [bl.x - 6, bl.z - 8]], sight: 36, leash: 30, accuracy: 0.4 },
          { id: 'b4', outfit: O[2], weapon: 'vireo', x: bl.x + 6, z: bl.z + 6, facing: -1.2, sight: 42, leash: 30, accuracy: 0.45 },
        ];
      case 'camp': {
        const stand = this.sites.anchors.campStand;
        return [
          { id: 'c1', outfit: O[1], weapon: 'ridgeline', x: stand.x, z: stand.z, y: stand.y + 0.05, facing: -1.4, sight: 70, leash: 1.5, accuracy: 0.6, crouched: true },
          { id: 'c2', outfit: O[2], weapon: 'marten', x: bc.x - 3, z: bc.z + 2, facing: -1.6, sight: 45, leash: 25, accuracy: 0.45 },
          { id: 'c3', outfit: O[3], weapon: 'ranger12', x: bc.x + 2, z: bc.z - 3, facing: -1.2, patrol: [[bc.x + 2, bc.z - 3], [bc.x - 8, bc.z - 9], [bc.x + 6, bc.z + 4]], sight: 38, leash: 25, accuracy: 0.4 },
          { id: 'c4', outfit: O[0], weapon: 'vireo', x: bc.x - 7, z: bc.z - 3, facing: 1.4, sight: 42, leash: 25, accuracy: 0.45 },
          { id: 'c5', outfit: O[1], weapon: 'p9', x: bc.x + 5, z: bc.z + 6, facing: -2.4, sight: 40, leash: 25, accuracy: 0.4 },
        ];
      }
      case 'meeting':
        return [
          { id: 'k1', name: 'Dale Kessler', outfit: O[0], weapon: 'ridgeline', x: 73, z: 251, facing: -2.6, sight: 60, leash: 30, accuracy: 0.7, health: 220, boss: true },
          { id: 'k2', outfit: O[1], weapon: 'marten', x: 69, z: 248, facing: -2.9, sight: 48, leash: 30, accuracy: 0.45 },
          { id: 'k3', outfit: O[2], weapon: 'ironwood', x: 78, z: 254, facing: -2.2, sight: 52, leash: 30, accuracy: 0.5 },
          { id: 'k4', outfit: O[3], weapon: 'vireo', x: 66, z: 257, facing: 2.8, patrol: [[66, 257], [60, 248], [66, 240]], sight: 42, leash: 30, accuracy: 0.45 },
          { id: 'k5', name: 'Buyer', outfit: O[2], weapon: 'p9', x: 70, z: 256, facing: -2.4, sight: 35, leash: 20, accuracy: 0.3, health: 60 },
        ];
      default:
        return null;
    }
  }

  // ------------------------------------------------------------ missions

  private buildDefs(): MissionDef[] {
    const s = this.s;
    const m = this.m;
    const w = this.w;
    const a = this.sites.anchors;
    const st = s.structures.anchors;
    const story = () => m.currentObjective();
    const station = new THREE.Vector3(SITES.station.x, 0, SITES.station.z);
    const cp = (x: number, z: number, yaw: number) => () => ({ pos: this.v(x, z), yaw });
    return [
      {
        id: 'range', title: 'Range Day',
        brief: 'Dispatch wants you qualified with your sidearm before you go up the valley.',
        checkpoint: cp(SITES.playerStart.x, SITES.playerStart.z, SITES.playerStart.heading),
        onStart: () => {
          setTimeout(() => this.say(DISPATCH_INTRO), 1800);
        },
        objectives: [
          { id: 'm1-take', text: 'Collect your sidearm from the range lockbox', sub: 'Follow the footpath east from the trailhead lot.', target: () => a.lockbox, done: () => w.has('p9') },
          { id: 'm1-draw', text: 'Draw your pistol', sub: 'Press 1 or H.', done: () => w.current === 'p9' && w.phase === 'ready' },
          { id: 'm1-holster', text: 'Holster it, then draw it again', sub: 'H puts it away; press H again to draw.', done: () => this.stepFlags.has('holstered') && w.phase === 'ready' },
          { id: 'm1-aim', text: 'Aim at a steel plate', sub: 'Hold the right mouse button. The crosshair turns red on a target.', target: () => this.sites.plates[0]?.center, done: () => this.stepFlags.has('aimedPlate') },
          { id: 'm1-plates', text: 'Ring all three steel plates', sub: () => `Left mouse button fires. Squeeze, don't snatch. ${this.plateHit.size}/3`, done: () => this.plateHit.size >= 3 },
          { id: 'm1-reload', text: 'Reload', sub: 'Press R. A reload with a round still chambered is quicker.', done: () => this.lastReload > this.stepStart },
          { id: 'm1-qualify', text: 'Qualify: four hits on the silhouettes', sub: () => `Both targets, 13 m and 22 m. Hits ${Math.min(4, this.paperHits)}/4${this.paperSeen.size < 2 ? ', both targets needed' : ''}.`, done: () => this.paperHits >= 4 && this.paperSeen.size >= 2,
            onStart: () => {
              this.paperHits = 0;
              this.paperSeen.clear();
            } },
        ],
        onComplete: () => {
          this.w.addAmmo('9mm', 30);
        },
        reward: 'Qualified. +30 rounds of 9 mm. Head up the valley to the station.',
      },
      {
        id: 'station', title: 'The Silent Station',
        brief: 'Hale\'s station has been dark for two days. Find out why.',
        checkpoint: cp(50, 4, -1.3),
        objectives: [
          { id: 'm2-reach', text: 'Drive to Hollow Creek Ranger Station', sub: 'Your truck is in the trailhead lot. Follow the road north.', target: () => st.stationDoor, done: () => m.has('stationReached') },
          { id: 'm2-logbook', text: 'Search the station: find Hale\'s logbook', target: () => st.logbook, done: () => m.has('logbook') },
          { id: 'm2-locker', text: 'Open the station gun locker', sub: 'Combination 4-1-7, from the back of Hale\'s logbook.', target: () => a.locker, done: () => w.has('ranger12') },
          { id: 'm2-power', text: 'Get the station radio working', sub: () => (story().key === 'generator' ? story().sub : 'Restore power to the station.'), target: () => (story().key === 'generator' ? story().target : st.generator), done: () => m.has('powerOn'),
            hints: () => {
              if (!m.has('generatorChecked')) return ['The radio needs power. The generator is under the lean-to outside the station.', 'Walk round to the lean-to, look at the generator and press E.'];
              if (!m.has('generatorFueled') && !m.has('hasFuel')) return ['The generator is dry. Your truck carries a green jerrycan on its roof rack.', 'Walk to your truck, look up at the roof rack and press E to take the jerrycan, then carry it to the generator.'];
              if (!m.has('generatorFueled')) return ['Take the jerrycan to the generator under the lean-to.', 'Look at the generator and press E to pour in the fuel.'];
              if (!m.has('generatorRunning')) return ['The generator has fuel now. Start it.', 'Look at the generator and press E to pull the starter.'];
              return ['The generator is running. Send its power to the station.', 'The power box is on the station wall near the generator. Look at it and press E to throw the transfer switch.'];
            } },
          { id: 'm2-radio', text: 'Play Hale\'s last transmission', target: () => st.radio, done: () => m.has('heardRecording') },
          { id: 'm2-key', text: 'Take the spare Ridge Gate key', target: () => st.keyCabinet, done: () => m.has('hasKey') },
          { id: 'm2-leave', text: 'Head for the ford', sub: 'The bridge is out. Hale said: take the ford.', target: () => st.bridgeTracks, done: () => this.you.distanceTo(new THREE.Vector3(station.x, this.you.y, station.z)) > 70 },
        ],
        reward: 'Hale was run off Ridge Road. Find Unit 4.',
      },
      {
        id: 'patrol', title: 'The Lost Patrol',
        brief: 'Unit 4 went off Ridge Road above the ravine. Find the truck, then find Hale.',
        checkpoint: cp(-3, -104, 0.3),
        objectives: [
          { id: 'm3-ford', text: 'Cross Hollow Creek at the ford', sub: 'Look for Hale\'s tyre tracks before the broken bridge.', target: () => story().key === 'ford' ? story().target : st.bridgeTracks, done: () => m.has('crossedFord') },
          { id: 'm3-gate', text: 'Unlock the Ridge Gate', target: () => st.gate, done: () => m.has('gateOpen') },
          { id: 'm3-bend', text: 'Find where Unit 4 left Ridge Road', sub: '"Above the ravine," Hale said.', target: () => (m.has('heardRecording') ? st.wreckBend : null), done: () => m.has('skids') || m.has('wreckFound') },
          { id: 'm3-wreck', text: 'Search Unit 4', target: () => st.wreck, done: () => m.has('wreckSearched') },
          { id: 'm3-revolver', text: 'Take Hale\'s revolver', sub: 'It was thrown clear: look in the mud beside the cab.', target: () => a.wreckRevolver, done: () => w.has('bridger') },
          { id: 'm3-ambush', text: 'Stop the poachers at the wreck', sub: 'Two of them, coming down from the road. Use the slope and the trees.',
            onStart: () => {
              this.spawn('wreck');
              s.hud.say('', 'Voices up on the road. Somebody is coming down to the wreck.', 4.5);
            },
            done: () => this.cleared('wreck') },
          { id: 'm3-tape', text: 'Follow Hale\'s flagging tape', sub: 'She said she was heading for the Miller cabin.', target: () => st.firstTape, done: () => m.has('tape') || m.has('cabinFound') },
          { id: 'm3-hale', text: 'Find Ranger Hale', target: () => st.cabinDoor, done: () => m.has('metHale') },
        ],
        reward: 'Hale is alive. Get her out.',
      },
      {
        id: 'route', title: 'Protect the Ranger Route',
        brief: 'The rescue team needs Ridge Road clear to reach Hale.',
        checkpoint: cp(-64, -158, 2.5),
        onStart: () => {
          this.spawn('roadblock');
        },
        objectives: [
          { id: 'm4-call', text: 'Call dispatch from your truck', sub: 'In the truck, press T.', target: () => s.truck.position, done: () => m.has('calledMedevac') },
          { id: 'm4-reach', text: 'Reach the roadblock on Ridge Road', sub: 'Below the bend, toward the gate. Approach carefully.', target: () => a.roadblock, done: () => this.near(a.roadblock, 55) || !!this.group('roadblock')?.engaged },
          { id: 'm4-identify', text: 'Identify the threat', sub: 'From cover, aim at one of them (hold the right mouse button).', target: () => a.roadblock, done: () => this.aimedAt('roadblock') || !!this.group('roadblock')?.engaged },
          { id: 'm4-clear', text: 'Clear the roadblock', sub: () => `Armed poachers: ${this.group('roadblock')?.alive ?? 3} still fighting. Trees and their truck are cover.`, target: () => a.roadblock, done: () => this.cleared('roadblock') },
          { id: 'm4-search', text: 'Search the poachers\' truck', target: () => a.roadblockTruck, done: () => this.flags.has('gps') },
          { id: 'm4-rescue', text: 'Hold the road for the rescue team', sub: 'Stay by the roadblock.',
            onStart: () => {
              setTimeout(() => this.say(RESCUE_LINES, () => this.flags.add('rescued')), 1200);
            },
            done: () => this.flags.has('rescued') },
        ],
        reward: 'Hale is on her way out. The poachers\' GPS has one waypoint: CACHE.',
      },
      {
        id: 'cache', title: 'The Hidden Supply Cache',
        brief: 'The poachers stash their gear somewhere east of the hidden camp. Find it.',
        checkpoint: cp(34, -146, -1.9),
        objectives: [
          { id: 'm5-map', text: 'Check the GPS waypoint on your map', sub: 'Press M.', done: () => (this.screensOpened.get('map') ?? -1) >= this.missionDoneAt },
          { id: 'm5-search', text: 'Search the woods around the waypoint', sub: 'East of the hidden camp, off the ATV trail.', target: () => a.cache, done: () => this.near(a.cache, 24) },
          { id: 'm5-entrance', text: 'Find the cache entrance', sub: 'Look for boot prints, drag marks, anything cut or piled up.', target: () => (this.near(a.cache, 12) ? a.cacheHatch : null), done: () => this.flags.has('branches') },
          { id: 'm5-chain', text: 'Get past the padlocked chain', sub: () => (this.flags.has('cutters') ? 'Cut it with the bolt cutters.' : 'Bolt cutters would do it. The hidden camp by the gate had a pair.'), target: () => (this.flags.has('cutters') ? a.cacheHatch : st.boltCutters), done: () => this.flags.has('chainCut'),
            hints: () => (this.flags.has('cutters')
              ? ['You have the bolt cutters. Go back to the hatch.', 'Look at the padlocked chain on the hatch and hold E to cut it.']
              : ['You need bolt cutters. The hidden camp near Ridge Gate had a pair.', 'Follow the marker to the hidden camp, press E to take the bolt cutters, then come back to the hatch.']) },
          { id: 'm5-open', text: 'Open the hatch', target: () => a.cacheHatch, done: () => this.flags.has('hatchOpen') },
          { id: 'm5-take', text: 'Take the rifle and read the ledger', target: () => a.cacheRifle, done: () => w.has('marten') && m.hasClue('ledger') },
        ],
        reward: 'Marten AR recovered. The ledger points east, to "the landing".',
      },
      {
        id: 'blockade', title: 'Clear the Blocked Route',
        brief: 'Someone has cut the only track your truck can use to leave the valley.',
        checkpoint: cp(-2, -104, -1.6),
        onStart: () => {
          this.spawn('blockade');
          setTimeout(() => this.say(DISPATCH_M6), 1500);
        },
        objectives: [
          { id: 'm6-reach', text: 'Return to the ford crossing', sub: 'Your truck\'s only way out of the valley.', target: () => a.blockade, done: () => this.near(a.blockade, 75) || !!this.group('blockade')?.engaged },
          { id: 'm6-scout', text: 'Look over the blockade', sub: 'Find a vantage point and watch before you go in.', target: () => a.blockade, done: () => this.near(a.blockade, 42) || this.aimedAt('blockade') || !!this.group('blockade')?.engaged },
          { id: 'm6-loadout', text: 'Choose your loadout', sub: 'The track is long and open; the creek bank is thick brush. Pick a weapon for your approach (Tab, then 1-8).', done: () => (this.stepFlags.has('inventory') || this.stepFlags.has('switched')) && w.phase === 'ready' },
          { id: 'm6-clear', text: 'Clear the crossing', sub: () => `${this.group('blockade')?.alive ?? 4} still holding the crossing.`, target: () => a.blockade, done: () => this.cleared('blockade') },
          { id: 'm6-search', text: 'Search their truck', target: () => a.blockadeTruck, done: () => w.has('ironwood') },
          { id: 'm6-winch', text: 'Winch the felled tree off the track', sub: 'Bring your truck within 25 m, then hold E at the log.', target: () => a.blockadeLog, done: () => this.flags.has('logCleared') },
        ],
        reward: 'The ford is open. Ironwood BR recovered.',
      },
      {
        id: 'source', title: 'Track the Source',
        brief: 'Everything points east along the ATV trail. Find where it all comes from.',
        checkpoint: cp(34, -146, -1.9),
        onStart: () => {
          this.spawn('camp');
        },
        objectives: [
          { id: 'm7-review', text: 'Review the evidence', sub: 'Open your journal (J): the ledger and the GPS.', done: () => (this.screensOpened.get('journal') ?? -1) >= this.missionDoneAt },
          { id: 'm7-atv', text: 'Find where the ATV trail leaves the hidden camp', target: () => st.campFire, done: () => this.flags.has('atvTracks') },
          { id: 'm7-follow', text: 'Follow the ATV trail east', sub: '"The landing", the ledger says.', target: () => a.baseCamp, done: () => this.near(a.baseCamp, 80) || !!this.group('camp')?.engaged },
          { id: 'm7-take', text: 'Take the poachers\' base camp', sub: () => `${this.group('camp')?.alive ?? 5} armed. Watch the tree stand.`, target: () => a.baseCamp, done: () => this.cleared('camp') },
          { id: 'm7-search', text: 'Search Kessler\'s camp', sub: 'The gun rack under the trailer awning, and the notes on the table.', target: () => (w.has('longwatch') ? a.campNotes : a.campRack), done: () => w.has('longwatch') && m.hasClue('kesslerNotes') },
        ],
        reward: 'Longwatch DMR recovered. Kessler meets his buyer at the trailhead at last light.',
      },
      {
        id: 'final', title: 'Final Forest Operation',
        brief: 'Stop Kessler\'s handover at the trailhead before state patrol arrives.',
        checkpoint: cp(36, 205, 2.6),
        onStart: () => {
          this.sites.vehicles.meetTruck.visible = true;
          this.sites.vehicles.meetVan.visible = true;
          meetingColliders(s.game.physics, this.sites);
          this.spawn('meeting');
          setTimeout(() => this.say(DISPATCH_M8), 1500);
        },
        objectives: [
          { id: 'm8-reach', text: 'Get to the trailhead before the buyer leaves', sub: 'Drive back down Hollow Creek Road. Stop short and go in on foot.', target: () => a.meeting, done: () => this.near(a.meeting, 130) || !!this.group('meeting')?.engaged },
          { id: 'm8-confirm', text: 'Get eyes on Kessler', sub: 'From cover, aim at him (hold the right mouse button) to confirm it\'s him.', target: () => a.meeting, done: () => this.aimedAt('meeting', 'k1') || !!this.group('meeting')?.engaged },
          { id: 'm8-stop', text: 'Stop Kessler\'s crew', sub: () => `${this.group('meeting')?.alive ?? 5} still armed, Kessler among them.`, target: () => a.meeting, done: () => this.cleared('meeting') },
          { id: 'm8-arrest', text: 'Arrest Dale Kessler', target: () => this.kessler()?.renderPos ?? a.meeting, done: () => this.flags.has('arrested') },
          { id: 'm8-report', text: 'Radio dispatch from your truck', sub: 'In the truck, press T.', target: () => s.truck.position, done: () => this.flags.has('reported') },
        ],
        reward: 'Case closed.',
      },
    ];
  }

  // ------------------------------------------------------------ flow

  /** New game: start Mission 1. */
  begin(): void {
    this.index = 0;
    this.step = 0;
    this.startMission(true);
  }

  private startMission(announce: boolean): void {
    const def = this.defs[this.index];
    if (!def) return;
    this.s.checkpoint = def.checkpoint();
    if (announce) {
      this.s.hud.toast(`Mission ${this.index + 1} of 8`, `${def.title}. ${def.brief}`, 'objective');
      this.s.audio.play('objective');
    }
    def.onStart?.();
    this.beginStep();
  }

  private beginStep(): void {
    this.stepStart = this.time;
    this.stepFlags.clear();
    this.aimT = 0;
    this.lastWeapon = this.w.current;
    this.m.progressed();
    this.defs[this.index]?.objectives[this.step]?.onStart?.();
  }

  private completeStep(): void {
    const def = this.defs[this.index];
    const o = def.objectives[this.step];
    this.step += 1;
    if (this.step >= def.objectives.length) {
      this.completeMission();
      return;
    }
    this.s.hud.toast('Objective complete', o.text, 'objective');
    this.s.audio.play('objective');
    this.beginStep();
  }

  private completeMission(): void {
    this.missionDoneAt = this.time;
    const def = this.defs[this.index];
    def.onComplete?.();
    this.s.hud.toast(`Mission complete: ${def.title}`, def.reward ?? '', 'clue');
    this.s.audio.play('clue');
    if (this.index >= this.defs.length - 1) {
      this.ended = true;
      this.s.save();
      setTimeout(() => this.s.ending(), 2200);
      return;
    }
    this.index += 1;
    this.step = 0;
    this.advanceT = this.fast ? 0.2 : 2.6;
    this.s.save();
  }

  // ------------------------------------------------------------ per frame

  private cullT = 0;
  private cullCenters = new Map<THREE.Object3D, THREE.Vector3>();

  /** Hide whole sites beyond the fog (they are invisible there anyway). */
  private cull(): void {
    const cam = this.s.game.camera.position;
    const consider = (o: THREE.Object3D, r: number) => {
      let c = this.cullCenters.get(o);
      if (!c) {
        const box = new THREE.Box3().setFromObject(o);
        c = box.isEmpty() ? o.getWorldPosition(new THREE.Vector3()) : box.getCenter(new THREE.Vector3());
        this.cullCenters.set(o, c);
      }
      const far = c.distanceTo(cam) > r;
      if (far) o.userData.culled = true;
      if (far && o.visible) o.visible = false;
      else if (!far && o.userData.culled) {
        o.userData.culled = false;
        o.visible = true;
      }
    };
    for (const child of this.sites.group.children) {
      // Hidden-by-story vehicles (meeting) are left alone until they appear.
      if (!child.visible && !child.userData.culled) continue;
      consider(child, 240);
    }
    for (const o of this.pickups.objects()) if (!this.pickups.taken.has(o[0])) consider(o[1], 120);
    // The story's structures too (station, bridge, gate, tower, cabin...), with a
    // longer reach because some are tall.
    for (const child of this.s.structures.group.children) {
      if (!child.visible && !child.userData.culled) continue;
      consider(child, child.name === 'lookout-tower' ? 420 : 300);
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.cullT -= dt;
    if (this.cullT <= 0) {
      this.cullT = 0.5;
      this.cull();
    }
    const s = this.s;
    this.animateParts(dt);
    for (const p of this.plates) p.update(dt);
    if (this.ended) return;
    if (this.advanceT > 0) {
      this.advanceT -= dt;
      if (this.advanceT <= 0) this.startMission(true);
      return;
    }
    const def = this.defs[this.index];
    const o = def?.objectives[this.step];
    if (!o) return;
    // Input-driven objective evidence.
    const w = this.w;
    if (w.phase === 'holstered') this.stepFlags.add('holstered');
    if (s.game.input.held('inventory')) this.stepFlags.add('inventory');
    if (w.current !== this.lastWeapon) {
      this.stepFlags.add('switched');
      this.lastWeapon = w.current;
    }
    const tgt = w.aimTarget as unknown as { group?: NpcGroup; id?: string } | null;
    if (w.aimBlend > 0.8 && tgt) {
      this.aimT += dt;
      if (this.aimT > 0.5) {
        if (this.plates.some((p) => p === (tgt as unknown))) this.stepFlags.add('aimedPlate');
        if (tgt.group) {
          this.stepFlags.add(`aimed:${tgt.group.id}:*`);
          this.stepFlags.add(`aimed:${tgt.group.id}:${tgt.id}`);
        }
      }
    } else this.aimT = 0;
    // The final radio call from the truck.
    if (o.id === 'm8-report' && s.mode === 'vehicle' && !this.flags.has('reporting')) {
      s.setForcedPrompt('Radio dispatch');
      if (s.game.input.pressed('radio')) {
        this.flags.add('reporting');
        s.setForcedPrompt(null);
        s.audio.play('radioBeep');
        this.say(FINAL_LINES, () => this.flags.add('reported'));
      }
    } else if (o.id === 'm8-report' && s.mode !== 'vehicle') s.setForcedPrompt(null);
    // Evaluate (a short chain may complete in one frame when steps were done early).
    let guard = 0;
    while (guard < 4 && !this.m.busy && this.advanceT <= 0 && !this.ended) {
      const cur = this.defs[this.index]?.objectives[this.step];
      if (!cur || !cur.done()) break;
      this.completeStep();
      guard += 1;
    }
    const d = this.defs[this.index];
    s.hud.setMission(d ? `Mission ${this.index + 1} of 8 · ${d.title}` : null);
  }

  /** Objective shown on the HUD (through the mystery's HUD driver). */
  private view(): ObjectiveView | null {
    if (this.ended) return { key: 'done', text: 'Case closed', sub: '', target: null };
    if (this.advanceT > 0) return { key: 'between', text: this.defs[this.index - 1]?.reward ?? '', sub: '', target: null };
    const o = this.defs[this.index]?.objectives[this.step];
    if (!o) return null;
    const sub = typeof o.sub === 'function' ? o.sub() : o.sub ?? '';
    return { key: o.id, text: o.text, sub, target: o.target?.() ?? null, hints: o.hints?.() ?? MISSION_HINTS[o.id] };
  }

  private animateParts(dt: number): void {
    const p = this.sites.parts;
    const k = (cur: number, want: number) => THREE.MathUtils.damp(cur, want, 4, dt);
    this.anim.lid = k(this.anim.lid, this.flags.has('lockboxOpen') ? 1 : 0);
    p.lockboxLid.rotation.x = -this.anim.lid * 1.7;
    this.anim.locker = k(this.anim.locker, this.flags.has('lockerOpen') ? 1 : 0);
    p.lockerDoor.rotation.y = -this.anim.locker * 1.9;
    this.anim.branches = k(this.anim.branches, this.flags.has('branches') ? 1 : 0);
    p.branches.position.x = this.anim.branches * 1.6;
    p.branches.visible = this.anim.branches < 0.98;
    p.chain.visible = !this.flags.has('chainCut');
    this.anim.hatch = k(this.anim.hatch, this.flags.has('hatchOpen') ? 1 : 0);
    p.hatch.rotation.x = -this.anim.hatch * 1.95;
    const logWant = this.flags.has('logCleared') ? 1 : 0;
    if (logWant !== this.anim.log) {
      this.anim.log = Math.min(1, this.anim.log + dt * 0.35);
      p.felledLog.position.z = -this.anim.log * 7;
      p.felledLog.rotation.y = Math.PI / 2 + 0.2 + this.anim.log * 0.9;
      if (this.anim.log >= 1) {
        for (const c of this.sites.colliders.log) c.setEnabled(false);
        p.felledLog.visible = false;
      }
    }
  }

  // ------------------------------------------------------------ hooks

  /** Screens report which one opened (journal, map). */
  screenOpened(name: string): void {
    this.screensOpened.set(name, this.time);
  }

  /** After the player respawns: surviving NPCs return to their posts. */
  respawned(): void {
    this.s.npcs.resetAll();
  }

  /** Journal: the mission log. */
  log(): { title: string; status: 'done' | 'current' | 'locked'; objectives: { text: string; done: boolean }[] }[] {
    return this.defs.map((d, i) => ({
      title: d.title,
      status: i < this.index || (i === this.index && this.ended) ? 'done' : i === this.index ? 'current' : 'locked',
      objectives: d.objectives.map((o, j) => ({ text: o.text, done: i < this.index || j < this.step })),
    }));
  }

  get completedCount(): number {
    return this.ended ? this.defs.length : this.index;
  }

  get missionTitle(): string {
    return this.defs[this.index]?.title ?? '';
  }

  // ------------------------------------------------------------ save

  serialize(): MissionSave {
    return { index: this.index, step: this.step, flags: [...this.flags], pickups: [...this.pickups.taken], down: [...this.downIds] };
  }

  restore(d: MissionSave): void {
    this.index = Math.min(d.index, this.defs.length - 1);
    this.step = d.step;
    for (const f of d.flags) this.flags.add(f);
    for (const id of d.down) this.downIds.add(id);
    this.pickups.restore(d.pickups);
    if (this.flags.has('cutters') && this.s.structures.pickups.boltCutters) this.s.structures.pickups.boltCutters.visible = false;
    // Hide display weapons the player already owns.
    for (const [id, disp] of Object.entries(this.sites.displays)) if (this.w.has(disp.weapon)) this.pickups.take(id, false);
    // World state of finished work.
    if (this.flags.has('logCleared')) {
      this.anim.log = 1;
      for (const c of this.sites.colliders.log) c.setEnabled(false);
      this.sites.parts.felledLog.visible = false;
    }
    // Encounters of the current and earlier missions (survivors fight on).
    const encounterAt: [number, string][] = [[2, 'wreck'], [3, 'roadblock'], [5, 'blockade'], [6, 'camp'], [7, 'meeting']];
    for (const [mi, id] of encounterAt) {
      if (mi < this.index || (mi === this.index && (id !== 'wreck' || this.step >= 5))) this.spawn(id);
    }
    if (this.index >= 7) {
      this.sites.vehicles.meetTruck.visible = true;
      this.sites.vehicles.meetVan.visible = true;
      meetingColliders(this.s.game.physics, this.sites);
    }
    this.s.checkpoint = this.defs[this.index].checkpoint();
    this.beginStep();
  }
}
