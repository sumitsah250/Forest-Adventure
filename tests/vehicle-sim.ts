// Headless vehicle dynamics check on the real terrain (no trees).
//   node tests/vehicle-sim.ts
import { TerrainData } from '../src/world/terrain.ts';
import { PhysicsWorld, initRapier } from '../src/physics/physics.ts';
import { FOREST_4X4, VehiclePhysics } from '../src/vehicles/vehiclePhysics.ts';
import { SITES } from '../src/world/layout.ts';

const R = await initRapier();
const terrain = new TerrainData();
const physics = new PhysicsWorld(R, terrain);
physics.step();
const dt = 1 / 60;
const site = SITES.playerTruck;
const ground = terrain.heightAt(site.x, site.z);
const car = new VehiclePhysics(physics, terrain, FOREST_4X4, site.x, ground + 1.2, site.z, site.heading);
car.engineOn = true;

function step(seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i += 1) {
    car.fixedUpdate(dt);
    physics.step();
    each?.(i * dt);
  }
}
function report(label: string): void {
  const p = car.body.translation();
  const b = car.basis();
  const g = terrain.heightAt(p.x, p.z);
  const susp = [0, 1, 2, 3].map((i) => car.wheelVisual(i).suspension.toFixed(2)).join(',');
  const contact = [0, 1, 2, 3].map((i) => (car.wheelVisual(i).contact ? 1 : 0)).join('');
  console.log(
    `${label.padEnd(18)} pos=(${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)}) ride=${(p.y - g).toFixed(2)} speed=${car.speed.toFixed(2)} gear=${car.gear}${car.reversing ? 'R' : ''} rpm=${car.rpm.toFixed(0)} up=${b.uy.toFixed(3)} fwd=(${b.fx.toFixed(2)},${b.fz.toFixed(2)}) susp=[${susp}] contact=${contact}`,
  );
}

step(2.5);
report('settled');
car.input = { throttle: 1, steer: 0, handbrake: false };
for (let s = 1; s <= 6; s += 1) {
  step(1);
  report(`throttle ${s}s`);
}
// Braking distance.
const p0 = car.body.translation();
const v0 = car.speed;
car.input = { throttle: -1, steer: 0, handbrake: false };
let tStop = 0;
step(8, (t) => {
  if (tStop === 0 && Math.abs(car.speed) < 0.3) tStop = t;
});
const p1 = car.body.translation();
console.log(`braking from ${v0.toFixed(1)} m/s: stopped in ${tStop.toFixed(2)} s over ~${Math.hypot(p1.x - p0.x, p1.z - p0.z).toFixed(1)} m (includes reverse after stop)`);
report('after brake+rev');
car.input = { throttle: 0, steer: 0, handbrake: false };
step(2);
report('coast');

// Autopilot along the main road from the trailhead to the station.
const road = terrain.roads[0];
const site2 = road.nearest(car.body.translation().x, car.body.translation().z);
const start = road.at(Math.max(0, site2.s));
car.reset(start.x, terrain.heightAt(start.x, start.z) + 1.0, start.z, Math.atan2(start.tx, start.tz));
step(1.5);
let minUp = 1;
let maxLat = 0;
let flipped = false;
let dist = 0;
let last = car.body.translation();
const targetSpeed = 13;
let sNow = road.nearest(last.x, last.z).s;
const sEnd = 430; // just before the collapsed bridge
let time = 0;
while (sNow < sEnd && time < 120) {
  const p = car.body.translation();
  const near = road.nearest(p.x, p.z);
  sNow = near.s;
  maxLat = Math.max(maxLat, Math.abs(near.lateral));
  const look = road.at(near.s + 9 + Math.abs(car.speed) * 0.6);
  const b = car.basis();
  const dx = look.x - p.x;
  const dz = look.z - p.z;
  // Angle from forward to target (positive = target to the right).
  const cross = b.fx * dz - b.fz * dx;
  const dot = b.fx * dx + b.fz * dz;
  const ang = Math.atan2(cross, dot);
  const steer = Math.max(-1, Math.min(1, ang * 2.2));
  const throttle = car.speed < targetSpeed ? 0.85 : car.speed > targetSpeed + 2 ? -0.3 : 0.15;
  car.input = { throttle, steer, handbrake: false };
  step(dt);
  time += dt;
  const q = car.body.translation();
  dist += Math.hypot(q.x - last.x, q.z - last.z);
  last = q;
  minUp = Math.min(minUp, car.basis().uy);
  if (car.isUpset()) flipped = true;
}
report('autopilot end');
console.log(`autopilot: ${dist.toFixed(0)} m in ${time.toFixed(1)} s (avg ${(dist / time).toFixed(1)} m/s), reached s=${sNow.toFixed(0)}, max lateral ${maxLat.toFixed(2)} m, min up ${minUp.toFixed(3)}, flipped=${flipped}`);

// Tight turn at speed: does it roll over?
car.input = { throttle: 0.6, steer: 1, handbrake: false };
let minUp2 = 1;
step(4, () => { minUp2 = Math.min(minUp2, car.basis().uy); });
report('full lock 4s');
console.log(`full lock: min up ${minUp2.toFixed(3)} upset=${car.isUpset()}`);
