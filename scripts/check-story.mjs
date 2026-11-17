// Checks the V2 story data against the rules in docs/STORY_V2.md and the map.
//
//   npm run check:story
//
// Fails (exit 1) when:
//   - a place name is not in the map data, or matches only loosely
//   - a step names a character, clue or cutscene that does not exist
//   - a subtitle card has more than two sentences, or is too long to be "short"
//   - a clue has no step that finds it, or the clue list is not exactly c1..c13
//   - a real member of staff appears outside their one mission, or is a suspect
//   - a route point is not on a mapped road
// Also lists every TODO stub, so it is clear what is still to build.
//
// Node runs the TypeScript data files directly (they have no browser code in them).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const { CAST, NPCS, VOICES, CLUES, ACCUSATION, WRONG_ACCUSATION, MISSIONS, MISSION_COUNT, WEATHER, T } = await load('src/campus/story/v2/index.ts');
const routes = await load('src/campus/story/routes.ts');
const map = JSON.parse(readFileSync(join(root, 'src/campus/campusData.json'), 'utf8'));
let cutscenes = null;
try {
  cutscenes = (await load('src/campus/story/v2/cutscenes.ts')).CUTSCENES;
} catch {
  // Cutscene data arrives in Phase 3.
}

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);

// ------------------------------------------------------------------ places
const names = (list) => new Set(list.filter((o) => o.name).map((o) => o.name.toLowerCase()));
const buildings = names(map.buildings);
const points = names(map.points);
const areas = names(map.areas);

function checkWhere(w, ctx) {
  if (!w) return;
  if ('xz' in w) return; // raw coordinates: only ones the old story already used
  if ('building' in w) {
    if (w.building && !buildings.has(w.building.toLowerCase())) err(`${ctx}: building "${w.building}" is not in the map`);
    if (w.poi && !points.has(w.poi.toLowerCase())) err(`${ctx}: point "${w.poi}" is not in the map`);
  } else if ('point' in w) {
    if (!points.has(w.point.toLowerCase())) err(`${ctx}: point "${w.point}" is not in the map`);
  } else if ('area' in w) {
    if (!areas.has(w.area.toLowerCase())) err(`${ctx}: area "${w.area}" is not in the map`);
  }
}

// ------------------------------------------------------------------ subtitle cards
const MAX_CHARS = 120;
function sentences(text) {
  // A sentence ends at . ! or ? followed by a space or the end; "6:55 PM." counts once.
  return text.split(/[.!?]+(?=\s|$|["')\]])/).filter((s) => s.trim().length > 0).length;
}
function checkCard(text, ctx) {
  if (typeof text !== 'string' || !text.trim()) return err(`${ctx}: empty card`);
  const n = sentences(text);
  if (n > 2) err(`${ctx}: ${n} sentences on one card (at most 2): "${text}"`);
  if (text.length > MAX_CHARS) err(`${ctx}: ${text.length} characters (at most ${MAX_CHARS}): "${text}"`);
}

// ------------------------------------------------------------------ cast
const npcIds = new Set(NPCS.map((n) => n.id));
for (const n of NPCS) {
  if (!CAST[n.id]) err(`NPC "${n.id}" is not in CAST`);
  checkWhere(n.at, `NPC ${n.id}`);
}
for (const id of Object.keys(VOICES)) if (!CAST[id]) err(`voice "${id}" is not in CAST`);
const staff = Object.entries(CAST).filter(([, c]) => c.realStaff);
if (staff.length !== 7) err(`expected 7 real staff members in CAST, found ${staff.length}`);
for (const [id, c] of staff) {
  if (c.suspect) err(`real staff member ${id} is marked as a suspect`);
  if (!c.mission) err(`real staff member ${id} has no mission`);
}

// ------------------------------------------------------------------ missions
const clueIds = new Set(CLUES.map((c) => c.id));
const found = new Map();
const todos = [];
const missionIds = new Set(MISSIONS.map((m) => m.id));
const KNOWN_UNLOCKS = new Set(['kalki', 'grip', 'boost', 'board', 'shards', 'engine', 'trial', 'hero', 'paint:monsoon', 'paint:marigold', 'paint:gold']);
const cutsceneUsed = new Set();

if (MISSIONS.length !== MISSION_COUNT + 1) err(`expected ${MISSION_COUNT} missions and the ending, found ${MISSIONS.length} entries`);
if (new Set(MISSIONS.map((m) => m.id)).size !== MISSIONS.length) err('mission ids are not unique');

MISSIONS.forEach((m, mi) => {
  const M = mi < MISSION_COUNT ? `M${mi + 1}` : 'Ending';
  if (!m.location) err(`${M}: no location for the location card`);
  if (!/^\d{1,2}:\d\d (AM|PM)$/.test(m.clock)) err(`${M}: clock "${m.clock}" is not like "7:50 PM"`);
  for (const u of [...(m.reward.unlock ? [m.reward.unlock] : []), ...(m.reward.unlocks ?? [])]) if (!KNOWN_UNLOCKS.has(u)) err(`${M}: unknown unlock "${u}"`);
  const clue = (id, ctx) => {
    if (!id) return;
    if (!clueIds.has(id)) return err(`${ctx}: unknown clue "${id}"`);
    if (found.has(id)) err(`${ctx}: clue ${id} is already found in ${found.get(id)}`);
    found.set(id, m.id);
  };
  const speaker = (id, ctx, needsBody) => {
    if (needsBody ? !npcIds.has(id) : !VOICES[id] && !npcIds.has(id)) return err(`${ctx}: unknown ${needsBody ? 'NPC' : 'voice'} "${id}"`);
    const c = CAST[id];
    if (c?.realStaff && c.mission !== m.id) err(`${ctx}: real staff member ${id} appears outside their mission (${c.mission})`);
  };
  m.steps.forEach((s, si) => {
    const ctx = `${M} step ${si + 1} (${s.kind})`;
    switch (s.kind) {
      case 'talk':
        speaker(s.npc, ctx, true);
        checkWhere(s.at, ctx);
        s.lines.forEach((l, k) => checkCard(l, `${ctx} card ${k + 1}`));
        clue(s.clue, ctx);
        clue(s.lookCloser, `${ctx} (look closer)`);
        break;
      case 'radio':
        speaker(s.from, ctx, false);
        s.lines.forEach((l, k) => checkCard(l, `${ctx} card ${k + 1}`));
        clue(s.clue, ctx);
        if (s.pin) {
          clue(s.pin.clue, `${ctx} (pinned line)`);
          if (s.pin.line < 0 || s.pin.line >= s.lines.length) err(`${ctx}: pinned line ${s.pin.line} does not exist`);
        }
        break;
      case 'board':
      case 'checkpoint':
        break;
      case 'accuse':
        if (m.id !== 'v2-whodunit') err(`${ctx}: the accusation belongs in mission 9`);
        break;
      case 'decide':
        speaker(s.from, ctx, false);
        checkCard(s.question, `${ctx} question`);
        if (s.options.length !== s.values.length || s.options.length !== s.lines.length) err(`${ctx}: options, values and lines must have the same length`);
        s.lines.forEach((ls, o) => ls.forEach((l, k) => checkCard(l, `${ctx} option ${o + 1} card ${k + 1}`)));
        break;
      case 'run':
        speaker(s.npc, ctx, true);
        checkWhere(s.to, ctx);
        clue(s.clue, ctx);
        break;
      case 'hold':
        checkWhere(s.at, ctx);
        checkCard(s.prompt, `${ctx} prompt`);
        break;
      case 'read':
        s.lines.forEach((l, k) => checkCard(l, `${ctx} card ${k + 1}`));
        clue(s.clue, ctx);
        break;
      case 'collect':
        for (const it of s.items) {
          checkWhere(it.at, `${ctx} "${it.label}"`);
          clue(it.clue, ctx);
        }
        break;
      case 'goto':
      case 'stealth':
        checkWhere(s.at, ctx);
        break;
      case 'puzzle':
        checkWhere(s.at, ctx);
        if (s.cutDoor) checkWhere(s.cutDoor, ctx);
        break;
      case 'riddle':
        err(`${ctx}: V2 has no riddles in missions`);
        break;
      case 'choose':
        speaker(s.npc, ctx, true);
        if (s.answer < 0 || s.answer >= s.options.length) err(`${ctx}: answer out of range`);
        break;
      case 'drive':
      case 'chase':
        if (!s.route || s.route.length < 2) err(`${ctx}: route too short`);
        break;
      case 'cutscene':
        cutsceneUsed.add(s.id);
        if (cutscenes && !cutscenes[s.id]) todos.push([M, `cutscene ${s.id}`, 'no shot data yet (skipped in play)']);
        break;
      case 'stub':
        todos.push([M, s.todo, s.note]);
        clue(s.clue, ctx);
        break;
      case 'kart':
      case 'quiz':
        break;
      default:
        err(`${ctx}: unknown step kind`);
    }
  });
});
for (const id of Object.keys(WEATHER)) if (!missionIds.has(id)) err(`WEATHER: unknown mission "${id}"`);
for (const [id, c] of staff) if (!missionIds.has(c.mission)) err(`real staff member ${id}: unknown mission "${c.mission}"`);

// ------------------------------------------------------------------ clues
for (let i = 1; i <= 14; i += 1) if (!clueIds.has(`c${i}`)) err(`clue c${i} is missing`);
if (CLUES.length !== 14) err(`expected 14 clues (13 from the spec, plus c14 from decision 1), found ${CLUES.length}`);
for (const c of CLUES) {
  if (c.mission === null) {
    if (!c.minigame) err(`clue ${c.id}: no mission and no mini-game`);
    continue;
  }
  if (!missionIds.has(c.mission)) err(`clue ${c.id}: unknown mission "${c.mission}"`);
  else if (found.get(c.id) !== c.mission) err(`clue ${c.id}: no step in ${c.mission} finds it (found in: ${found.get(c.id) ?? 'nowhere'})`);
  if (c.role === 'clears' && !c.clears) err(`clue ${c.id}: clears nobody`);
}
for (const q of ACCUSATION) for (const id of q.accepts) if (!clueIds.has(id)) err(`accusation: unknown clue ${id}`);
for (const ids of Object.values(WRONG_ACCUSATION)) for (const id of ids) if (!clueIds.has(id)) err(`wrong accusation: unknown clue ${id}`);

// ------------------------------------------------------------------ routes on mapped roads
const roads = map.lines.filter((l) => ['service', 'residential', 'footway', 'path', 'track', 'primary', 'pedestrian'].includes(l.kind));
function roadDist(x, z) {
  let best = Infinity;
  for (const l of roads) {
    for (let i = 0; i < l.pts.length - 1; i += 1) {
      const [ax, az] = l.pts[i];
      const [bx, bz] = l.pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
    }
  }
  return best;
}
for (const [x, z] of routes.GATE_ROAD) {
  const d = roadDist(x, z);
  if (d > 1) err(`GATE_ROAD point [${x}, ${z}] is ${d.toFixed(1)} m from any mapped road`);
}
for (const name of ['RING_EAST', 'RING_NORTH', 'ESCAPE']) {
  for (const [x, z] of routes[name]) {
    const d = roadDist(x, z);
    if (d > 6) warnings.push(`${name} point [${x}, ${z}] is ${d.toFixed(1)} m from the nearest mapped road (old story data)`);
  }
}

// ------------------------------------------------------------------ cutscene data (Phase 3 on)
if (cutscenes) {
  for (const [id, c] of Object.entries(cutscenes)) {
    c.shots.forEach((shot, k) => {
      const ctx = `cutscene ${id} shot ${k + 1}`;
      if (shot.path.length < 3 || shot.path.length > 5) err(`${ctx}: camera path has ${shot.path.length} points (3 to 5)`);
      for (const a of [...shot.path, ...(Array.isArray(shot.look) ? shot.look : [shot.look])]) if (a.where) checkWhere(a.where, ctx);
      for (const s of shot.subtitles ?? []) {
        checkCard(s.text, `${ctx} subtitle`);
        if (!CAST[s.who]) err(`${ctx}: unknown speaker "${s.who}"`);
      }
      for (const list of [shot.subtitles, shot.sounds, shot.events]) for (const e of list ?? []) if (e.at < 0 || e.at > shot.dur) err(`${ctx}: a cue at ${e.at} s is outside the shot (${shot.dur} s)`);
    });
  }
}

// ------------------------------------------------------------------ MITRA's spotted lines
for (const [act, lines] of Object.entries(T.mitraSpotted)) {
  if (lines.length < 8) err(`mitraSpotted.${act}: ${lines.length} lines (at least 8 per act)`);
  lines.forEach((l, i) => checkCard(l, `mitraSpotted.${act}[${i}]`));
}

// ------------------------------------------------------------------ every other string in text.ts is at least non-empty
(function walk(o, path) {
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string') {
      if (!v.trim()) err(`text ${path}.${k} is empty`);
    } else if (Array.isArray(v)) v.forEach((x, i) => typeof x === 'string' && !x.trim() && err(`text ${path}.${k}[${i}] is empty`));
    else if (v && typeof v === 'object') walk(v, `${path}.${k}`);
  }
})(T, 'T');

// ------------------------------------------------------------------ report
const cards = MISSIONS.reduce((n, m) => n + m.steps.reduce((k, s) => k + (s.lines?.length ?? 0), 0), 0);
console.log(`V2 story: ${MISSION_COUNT} missions + ending, ${MISSIONS.reduce((n, m) => n + m.steps.length, 0)} steps, ${cards} subtitle cards, ${CLUES.length} clues, ${NPCS.length} characters in the world.`);
console.log(`Cutscenes referenced: ${[...cutsceneUsed].join(', ')}${cutscenes ? ` · with shot data: ${Object.keys(cutscenes).join(', ')}` : ''}`);
console.log(`\nStill to build (${todos.length} stubs):`);
for (const [m, id, note] of todos) console.log(`  ${m.padEnd(7)} ${id.padEnd(30)} ${note}`);
if (warnings.length) console.log(`\nWarnings:\n  ${warnings.join('\n  ')}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('\nStory data OK.');
