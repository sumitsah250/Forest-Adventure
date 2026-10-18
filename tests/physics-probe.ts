// Verifies the Rapier heightfield lines up with TerrainData.heightAt.
import { TerrainData } from '../src/world/terrain.ts';
import { PhysicsWorld, initRapier } from '../src/physics/physics.ts';

const R = await initRapier();
const terrain = new TerrainData();
const physics = new PhysicsWorld(R, terrain);
physics.step();
let worst = 0;
const pts: [number, number][] = [[0, 0], [55, 236], [-128, -167], [120, -200], [-250, 200], [13.3, -49.7], [-80, -138], [200, 150]];
for (const [x, z] of pts) {
  const g = physics.groundHeight(x, z);
  const h = terrain.heightAt(x, z);
  const err = g === null ? Infinity : Math.abs(g - h);
  worst = Math.max(worst, err);
  console.log(`(${x}, ${z}) terrain=${h.toFixed(3)} physics=${g?.toFixed(3)} err=${err.toFixed(3)}`);
}
console.log(worst < 0.25 ? 'HEIGHTFIELD OK' : 'HEIGHTFIELD MISMATCH');
