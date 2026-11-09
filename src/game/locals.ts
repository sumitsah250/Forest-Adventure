// Friendly locals in the forest: people who live or work in the valley. Each stands
// at a landmark, turns to watch the ranger walk up, calls out a greeting the first
// time and, when you talk to them (E), introduces themselves and then tells you
// plainly what to do next for the current objective (the same detailed hint the
// objective panel shows). Asking again repeats the advice with some local colour.

import * as THREE from 'three';
import { Person } from '../character/person.ts';
import type { Outfit } from '../character/humanoid.ts';
import { GROUP, groups, type PhysicsWorld } from '../physics/physics.ts';
import type { TerrainData } from '../world/terrain.ts';
import { SITES } from '../world/layout.ts';
import type { Session } from './session.ts';

const base = { headwearColor: '#000', beard: false, uniform: false, vest: null, backpack: null } as const;

interface LocalSpec {
  id: string;
  name: string;
  /** Who they are, shown before you know their name ("Talk to the hiker"). */
  role: string;
  outfit: Outfit;
  /** Preferred spot; the nearest clear, dry, level ground off the road is used. */
  near: [number, number];
  /** Point they face while idle. */
  faceToward: [number, number];
  greet: string;
  intro: string[];
  /** Lead-in before the advice for the current objective. */
  advice: string[];
  /** Local colour, one line per conversation after the first. */
  lore: string[];
  /** Mission indices (0-based) during which they are away (firefights nearby). */
  awayDuring?: number[];
}

const LOCALS: LocalSpec[] = [
  {
    id: 'okafor', name: 'Tom Okafor', role: 'range officer',
    outfit: { ...base, id: 'local-okafor', skin: '#6e4a36', hair: '#141110', top: '#5e6248', topPattern: 'twill', trousers: '#3f4536', trouserPattern: 'twill', boots: '#3a2a20', headwear: 'cap', headwearColor: '#3d4935', uniform: true, beard: true },
    near: [SITES.infoBoard.x + 5, SITES.infoBoard.z - 4],
    faceToward: [SITES.playerStart.x, SITES.playerStart.z],
    greet: 'Afternoon, Unit Two! Over here a second.',
    intro: [
      'Tom Okafor. I run the range and keep an eye on the trailhead for the district.',
      'Hale\'s a friend of mine. If you get stuck out there, come find me or any of the locals. We know this valley.',
    ],
    advice: ['Here\'s what you do next.', 'Right. Next thing on your list:', 'Listen, ranger.'],
    lore: [
      'Hale\'s run this district eleven years. She has never once missed a check-in.',
      'Poachers have been jacklighting deer on the north ridge since spring. Hale was getting close to them.',
      'Your truck has a full jerrycan on the roof rack. Don\'t forget it\'s there.',
    ],
    awayDuring: [7],
  },
  {
    id: 'maya', name: 'Maya Lindqvist', role: 'hiker',
    outfit: { ...base, id: 'local-maya', skin: '#d2a689', hair: '#6b4a2e', top: '#3d6b8a', topPattern: 'knit', trousers: '#4a4f40', trouserPattern: 'canvas', boots: '#5a3c28', headwear: 'beanie', headwearColor: '#b0475a', backpack: '#a0522d', female: true, hairStyle: 'ponytail' },
    near: [SITES.suv.x + 7, SITES.suv.z - 8],
    faceToward: [SITES.suv.x, SITES.suv.z],
    greet: 'Hey! Are you with the rangers?',
    intro: [
      'I\'m Maya. I\'ve been walking the valley loop since Tuesday.',
      'That maroon SUV in the ditch was here when I came down this morning. Door open, nobody around. Gave me the creeps.',
    ],
    advice: ['If I were you, I\'d do this:', 'Okay, so:', 'From what I\'ve seen around here:'],
    lore: [
      'I heard an engine up on the ridge last night. No headlights at all.',
      'The ranger station is up the spur road on the right. I knocked yesterday. Nobody answered.',
      'Check the SUV\'s cab and cargo. Whoever left it was in a hurry.',
    ],
  },
  {
    id: 'sam', name: 'Sam Reyes', role: 'road worker',
    outfit: { ...base, id: 'local-sam', skin: '#a8724f', hair: '#1a1410', top: '#c8661e', topPattern: 'canvas', trousers: '#33405a', trouserPattern: 'denim', boots: '#3b2b1f', headwear: 'cap', headwearColor: '#d9a520', vest: '#d8e04a', beard: true },
    near: [SITES.bridge.x + 6, SITES.bridge.z + 11],
    faceToward: [SITES.bridge.x, SITES.bridge.z],
    greet: 'Careful, ranger! The bridge is out.',
    intro: [
      'Sam Reyes, county roads. They sent me to look at the bridge.',
      'Whole span dropped into the creek. If you need to get across, there\'s a shallow ford downstream. You can see Hale\'s tyre tracks going down to it.',
    ],
    advice: ['Here\'s my advice:', 'What you want to do is this:', 'Okay, listen:'],
    lore: [
      'Somebody\'s been driving that ford a lot lately. Big tyres. Not a ranger truck.',
      'Take the ford slow. The far bank is steeper than it looks.',
      'Ridge Road past the gate runs right along the ravine. One bad corner up there.',
    ],
    awayDuring: [5],
  },
  {
    id: 'june', name: 'June Park', role: 'fire lookout',
    outfit: { ...base, id: 'local-june', skin: '#c9a07e', hair: '#1c1510', top: '#7a2f28', topPattern: 'plaid', trousers: '#4b4d38', trouserPattern: 'canvas', boots: '#2b231d', headwear: 'none', backpack: '#55513f', female: true, hairStyle: 'bun' },
    near: [SITES.lookout.x + 7, SITES.lookout.z + 7],
    faceToward: [SITES.lookout.x, SITES.lookout.z],
    greet: 'Hello down there! You must be the ranger.',
    intro: [
      'June Park. I volunteer on the fire lookout during the season.',
      'From the deck you can see the whole creek bottom. There\'s a pair of binoculars bolted to the rail up there. Use them.',
    ],
    advice: ['From up here, this is what I\'d tell you:', 'Here\'s the plan, ranger:', 'Okay. Next:'],
    lore: [
      'There was smoke from the old Miller cabin this morning. Nobody has lived there in years.',
      'Orange flagging tape down by the creek. Hale used to mark her routes that way.',
      'You can see the ATV trail from the deck. It runs east, toward the old log landing.',
    ],
  },
];

interface Line {
  who: string;
  text: string;
  t: number;
}

class Local {
  readonly spec: LocalSpec;
  readonly person: Person;
  readonly head = new THREE.Vector3();
  met = false;
  greeted = false;
  private loreI = 0;
  private adviceI = 0;
  private body: ReturnType<PhysicsWorld['world']['createRigidBody']>;
  private collider: ReturnType<PhysicsWorld['world']['createCollider']>;
  away = false;

  constructor(spec: LocalSpec, scene: THREE.Scene, terrain: TerrainData, physics: PhysicsWorld) {
    this.spec = spec;
    const [x, z] = findSpot(terrain, physics, spec.near[0], spec.near[1]);
    const facing = Math.atan2(spec.faceToward[0] - x, spec.faceToward[1] - z);
    this.person = new Person(scene, spec.outfit, terrain, physics, x, z, facing, spec.name);
    this.person.rig.root.name = `local-${spec.id}`;
    const y = terrain.heightAt(x, z);
    this.head.set(x, y + 1.55, z);
    const R = physics.R;
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y + 0.88, z));
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(0.56, 0.3).setCollisionGroups(groups(GROUP.NPC, GROUP.STATIC | GROUP.VEHICLE | GROUP.PLAYER | GROUP.NPC)),
      this.body,
    );
  }

  setAway(away: boolean): void {
    if (away === this.away) return;
    this.away = away;
    this.person.rig.root.visible = !away;
    this.collider.setEnabled(!away);
  }

  nextLore(): string {
    const l = this.spec.lore[this.loreI % this.spec.lore.length];
    this.loreI += 1;
    return l;
  }

  nextAdvice(): string {
    const l = this.spec.advice[this.adviceI % this.spec.advice.length];
    this.adviceI += 1;
    return l;
  }
}

/** Nearest clear spot: dry, fairly level, off the road and free of trunks, rocks and buildings. */
function findSpot(terrain: TerrainData, physics: PhysicsWorld, x0: number, z0: number): [number, number] {
  const clear = (x: number, z: number) => {
    if (terrain.waterAt(x, z) || terrain.slopeAt(x, z) > 0.2) return false;
    const road = terrain.roadAt(x, z);
    if (road && Math.abs(road.signed) < 5.5) return false;
    for (const [dx, dz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
      const h = terrain.heightAt(x + dx, z + dz);
      const top = physics.groundHeight(x + dx, z + dz, h + 4);
      if (top !== null && top > h + 0.25) return false;
    }
    return true;
  };
  for (let r = 0; r <= 14; r += 1.25) {
    const n = r === 0 ? 1 : Math.ceil(r * 3);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const x = x0 + Math.cos(a) * r;
      const z = z0 + Math.sin(a) * r;
      if (clear(x, z)) return [x, z];
    }
  }
  return [x0, z0];
}

export class Locals {
  readonly list: Local[] = [];
  private s: Session;
  private queue: Line[] = [];
  private lineT = 0;
  private speaking: Local | null = null;

  constructor(s: Session) {
    this.s = s;
    const g = s.game;
    for (const spec of LOCALS) {
      const l = new Local(spec, g.scene, g.terrain, g.physics);
      this.list.push(l);
      s.addInteractable({
        id: `local-${spec.id}`,
        position: () => l.head,
        range: 2.8,
        prompt: () => (l.away || this.speaking ? null : `Talk to ${l.met ? spec.name.split(' ')[0] : `the ${spec.role}`}`),
        use: () => this.talk(l),
      });
    }
  }

  /** Saved progress: who the ranger has already met. */
  serialize(): string[] {
    return this.list.filter((l) => l.met).map((l) => l.spec.id);
  }

  restore(ids: string[] | undefined): void {
    for (const l of this.list) {
      l.met = !!ids?.includes(l.spec.id);
      l.greeted = l.met;
    }
  }

  private talk(l: Local): void {
    const who = l.spec.name;
    const lines: Line[] = [];
    if (!l.met) {
      l.met = true;
      l.greeted = true;
      for (const t of l.spec.intro) lines.push({ who, text: t, t: readTime(t) });
    } else {
      const lore = l.nextLore();
      lines.push({ who, text: lore, t: readTime(lore) });
    }
    // Their advice is the full hint for whatever the ranger is doing now; it also
    // appears in the objective panel so it stays on screen after they finish.
    const hint = this.s.mystery.fullHint();
    const lead = l.nextAdvice();
    lines.push({ who, text: `${lead} ${hint}`, t: readTime(hint) + 1 });
    this.queue = lines;
    this.lineT = 0;
    this.speaking = l;
  }

  update(dt: number): void {
    const g = this.s.game;
    const player = g.player.renderPos;
    const cam = g.camera.position;
    const mission = this.s.missions.index;
    for (const l of this.list) {
      l.setAway(!!l.spec.awayDuring?.includes(mission) && !this.s.missions.ended);
      if (l.away) continue;
      const onFoot = this.s.mode === 'foot';
      l.person.update(dt, cam, onFoot ? player : null);
      // First time the ranger walks up: they call out, and the HUD says who they are.
      if (!l.greeted && onFoot && player.distanceToSquared(l.person.pos) < 9 * 9 && !this.s.mystery.talking && !this.speaking) {
        l.greeted = true;
        this.s.hud.say(l.spec.name, l.spec.greet, 3.5);
        this.s.hud.toast(`Local: ${l.spec.name}`, `${cap(l.spec.role)}. Press E to talk: locals can tell you what to do next.`, 'info');
      }
    }
    // Conversation playback (subtitles); walking away ends it.
    if (this.speaking) {
      const sp = this.speaking;
      if (player.distanceToSquared(sp.person.pos) > 12 * 12 || this.s.mode !== 'foot') {
        this.queue = [];
        this.speaking = null;
        this.s.hud.clearSubtitle();
        return;
      }
      this.lineT -= dt;
      if (this.lineT <= 0) {
        const line = this.queue.shift();
        if (!line) {
          this.speaking = null;
          return;
        }
        this.s.hud.say(line.who, line.text, line.t + 0.3);
        this.lineT = line.t;
      }
    }
  }
}

function readTime(text: string): number {
  return THREE.MathUtils.clamp(1.6 + text.split(/\s+/).length * 0.3, 3, 9);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
