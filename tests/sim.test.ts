// Headless checks of the world and vehicle physics (no browser needed).
//   npm run test:sim
import { TerrainData } from '../src/world/terrain.ts';
import { PhysicsWorld, initRapier } from '../src/physics/physics.ts';
import { FOREST_4X4, VehiclePhysics } from '../src/vehicles/vehiclePhysics.ts';
import { SITES } from '../src/world/layout.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

const t0 = performance.now();
const terrain = new TerrainData();
check('terrain builds in under 6 s', performance.now() - t0 < 6000, `${(performance.now() - t0).toFixed(0)} ms`);

// Every story site sits on dry, walkable ground.
for (const [name, site] of Object.entries(SITES)) {
  const water = terrain.waterAt(site.x, site.z);
  const slope = terrain.slopeAt(site.x, site.z);
  if (name === 'bridge') continue;
  check(`site ${name} is dry and walkable`, !water && slope < 0.3, `slope ${slope.toFixed(2)}`);
}

// Roads are drivable: no steps steeper than ~20% along any vehicle route.
const gap = terrain.bridgeGap();
for (const road of terrain.roads) {
  if (road.kind === 'foot') continue;
  let worst = 0;
  for (let s = 0; s < road.length - 2; s += 2) {
    if (road.id === 'main' && gap && s > gap.s0 - 2 && s < gap.s1 + 2) continue;
    const a = road.at(s);
    const b = road.at(s + 2);
    worst = Math.max(worst, Math.abs(terrain.heightAt(b.x, b.z) - terrain.heightAt(a.x, a.z)) / 2);
  }
  const limit = road.kind === 'track' ? 0.34 : 0.2;
  check(`${road.id} steepest grade under ${limit * 100}%`, worst < limit, `${(worst * 100).toFixed(1)}%`);
}

// The ford is shallow enough to drive through; the bridge site is not.
const ford = terrain.roads.find((r) => r.id === 'ford')!;
let deepest = 0;
for (let s = 0; s < ford.length; s += 1) {
  const p = ford.at(s);
  deepest = Math.max(deepest, terrain.waterAt(p.x, p.z)?.depth ?? 0);
}
check('ford water is shallow (< 0.5 m)', deepest < 0.5, `${deepest.toFixed(2)} m`);
check('bridge gap exists over the creek', !!gap && gap.s1 - gap.s0 > 10);

// Physics heightfield matches the rendered terrain.
const R = await initRapier();
const physics = new PhysicsWorld(R, terrain);
physics.step();
let worstErr = 0;
for (let i = 0; i < 40; i += 1) {
  const x = -270 + ((i * 97) % 540) + 0.37;
  const z = -270 + ((i * 61) % 540) + 0.61;
  const g = physics.groundHeight(x, z);
  worstErr = Math.max(worstErr, g === null ? 99 : Math.abs(g - terrain.heightAt(x, z)));
}
check('heightfield collider matches terrain (< 0.25 m)', worstErr < 0.25, `${worstErr.toFixed(3)} m`);

// Vehicle: settles, accelerates, brakes, and follows the road without upsetting.
const dt = 1 / 60;
const road = terrain.roads[0];
const start = road.at(95);
const car = new VehiclePhysics(physics, terrain, FOREST_4X4, start.x, terrain.heightAt(start.x, start.z) + 1, start.z, Math.atan2(start.tx, start.tz));
car.engineOn = true;
const run = (sec: number, each?: () => void) => {
  for (let i = 0; i < Math.round(sec / dt); i += 1) {
    car.fixedUpdate(dt);
    physics.step();
    each?.();
  }
};
run(2);
const settle = car.body.translation().y - terrain.heightAt(car.body.translation().x, car.body.translation().z);
check('truck settles on its suspension', settle > 0.02 && settle < 0.4 && [0, 1, 2, 3].every((i) => car.wheelVisual(i).contact), `ride ${settle.toFixed(2)} m`);
let minUp = 1;
let maxLat = 0;
let time = 0;
let sNow = road.nearest(car.body.translation().x, car.body.translation().z).s;
while (sNow < 430 && time < 90) {
  const p = car.body.translation();
  const near = road.nearest(p.x, p.z);
  sNow = near.s;
  maxLat = Math.max(maxLat, Math.abs(near.lateral));
  const look = road.at(near.s + 9 + Math.abs(car.speed) * 0.6);
  const b = car.basis();
  const dx = look.x - p.x;
  const dz = look.z - p.z;
  const ang = Math.atan2(b.fx * dz - b.fz * dx, b.fx * dx + b.fz * dz);
  car.input = { throttle: car.speed < 13 ? 0.85 : car.speed > 15 ? -0.3 : 0.15, steer: Math.max(-1, Math.min(1, ang * 2.2)), handbrake: false };
  run(dt);
  time += dt;
  minUp = Math.min(minUp, car.basis().uy);
}
check('autopilot reaches the bridge along Hollow Creek Road', sNow >= 430, `s=${sNow.toFixed(0)} in ${time.toFixed(0)} s`);
check('truck stays upright on the road', minUp > 0.9, `min up ${minUp.toFixed(3)}`);
check('truck stays on the road', maxLat < 3.5, `max lateral ${maxLat.toFixed(2)} m`);
const v0 = car.speed;
car.input = { throttle: -1, steer: 0, handbrake: false };
let tStop = 0;
let t = 0;
run(6, () => {
  t += dt;
  if (!tStop && car.speed < 0.5) tStop = t;
});
check('brakes stop the truck from ~50 km/h in under 4 s', tStop > 0 && tStop < 4, `${(v0 * 3.6).toFixed(0)} km/h in ${tStop.toFixed(2)} s`);
check('holding brake at rest engages reverse', car.reversing && car.speed < -1, `${(car.speed * 3.6).toFixed(1)} km/h`);

// Follow a path with a simple pure-pursuit driver; returns progress and stability.
function drivePath(pathIndex: number, sFrom: number, sTo: number, speed: number, limitSec: number) {
  const p = terrain.roads[pathIndex];
  const a = p.at(sFrom);
  car.reset(a.x, terrain.heightAt(a.x, a.z) + 0.9, a.z, Math.atan2(a.tx, a.tz));
  car.reversing = false;
  run(1.2);
  let s = sFrom;
  let tt = 0;
  let up = 1;
  let lat = 0;
  let deepest = 0;
  while (s < sTo && tt < limitSec) {
    const pos = car.body.translation();
    const n = p.nearest(pos.x, pos.z);
    s = Math.max(s, n.s);
    lat = Math.max(lat, Math.abs(n.lateral));
    const look = p.at(n.s + 6 + Math.abs(car.speed) * 0.5);
    const b = car.basis();
    const dx = look.x - pos.x;
    const dz = look.z - pos.z;
    const ang = Math.atan2(b.fx * dz - b.fz * dx, b.fx * dx + b.fz * dz);
    car.input = { throttle: car.speed < speed ? 0.9 : car.speed > speed + 1.5 ? -0.25 : 0.2, steer: Math.max(-1, Math.min(1, ang * 2.4)), handbrake: false };
    run(dt);
    tt += dt;
    up = Math.min(up, car.basis().uy);
    deepest = Math.max(deepest, car.waterDepth);
  }
  return { s, tt, up, lat, deepest };
}
const fordIdx = terrain.roads.findIndex((r) => r.id === 'ford');
const fordRun = drivePath(fordIdx, 2, terrain.roads[fordIdx].length - 4, 6, 80);
check('truck drives the ford track through the creek and up the far bank', fordRun.s >= terrain.roads[fordIdx].length - 6, `s=${fordRun.s.toFixed(0)}/${terrain.roads[fordIdx].length.toFixed(0)} in ${fordRun.tt.toFixed(0)} s, water ${fordRun.deepest.toFixed(2)} m`);
check('truck stays upright through the ford', fordRun.up > 0.8, `min up ${fordRun.up.toFixed(3)}`);
const ridge = drivePath(0, 486, 560, 8, 80);
check('truck climbs Ridge Road from the gate to the ravine bend', ridge.s >= 558, `s=${ridge.s.toFixed(0)} in ${ridge.tt.toFixed(0)} s`);
check('truck stays upright on Ridge Road', ridge.up > 0.85, `min up ${ridge.up.toFixed(3)}`);
const lookout = drivePath(0, 560, terrain.roads[0].length - 5, 7, 80);
check('truck reaches the lookout clearing', lookout.s >= terrain.roads[0].length - 8, `s=${lookout.s.toFixed(0)} in ${lookout.tt.toFixed(0)} s`);

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
(globalThis as unknown as { process: { exit(code: number): void } }).process.exit(failures ? 1 : 0);
