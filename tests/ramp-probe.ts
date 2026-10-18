// Minimal reproduction: can the character controller climb a 33.5° stair ramp?
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

function trial(label: string, opts: { autostep: boolean; snap: boolean; killWallVel: boolean; offset: number }) {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  const fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0), fixed);
  const ang = Math.atan2(4.5, 6.8);
  const q = { x: Math.sin(-ang / 2), y: 0, z: 0, w: Math.cos(-ang / 2) };
  // Ramp rising toward +z from z=0.
  const len = Math.hypot(6.8, 4.5) + 1.1;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.5, 0.15, len / 2)
      .setTranslation(0, 2.25 - 0.25 * Math.sin(ang) - 0.13 * Math.cos(ang), 3.4 - 0.25 * Math.cos(ang) + 0.13 * Math.sin(ang))
      .setRotation(q),
    fixed,
  );
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0.86 + 0.02, -1));
  const col = world.createCollider(RAPIER.ColliderDesc.capsule(0.56, 0.3), body);
  const cc = world.createCharacterController(opts.offset);
  cc.setUp({ x: 0, y: 1, z: 0 });
  cc.setMaxSlopeClimbAngle((46 * Math.PI) / 180);
  cc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
  if (opts.autostep) cc.enableAutostep(0.38, 0.18, false);
  if (opts.snap) cc.enableSnapToGround(0.45);
  cc.setSlideEnabled(true);
  world.step();
  const dt = 1 / 60;
  let vz = 0;
  let vy = 0;
  let grounded = false;
  for (let i = 0; i < 240; i += 1) {
    vz += (2.7 - vz) * Math.min(1, dt * 9);
    if (grounded && vy < 0) vy = -2;
    vy -= 18 * dt;
    const desired = { x: 0, y: vy * dt, z: vz * dt };
    cc.computeColliderMovement(col, desired);
    const mv = cc.computedMovement();
    const t = body.translation();
    body.setNextKinematicTranslation({ x: t.x + mv.x, y: t.y + mv.y, z: t.z + mv.z });
    grounded = cc.computedGrounded();
    const climbing = mv.y > desired.y + 0.002;
    if (opts.killWallVel && !climbing && Math.abs(mv.z / dt) < Math.abs(vz) * 0.5) vz = mv.z / dt;
    if (grounded && mv.y > desired.y + 0.001 && vy > 0) vy = 0;
    world.step();
  }
  const t = body.translation();
  console.log(`${label.padEnd(34)} z=${t.z.toFixed(2)} y=${(t.y - 0.88).toFixed(2)} grounded=${grounded}`);
}

trial('as in game (autostep+snap+kill)', { autostep: true, snap: true, killWallVel: true, offset: 0.03 });
trial('no wall-velocity kill', { autostep: true, snap: true, killWallVel: false, offset: 0.03 });
trial('no autostep', { autostep: false, snap: true, killWallVel: true, offset: 0.03 });
trial('no snap', { autostep: true, snap: false, killWallVel: true, offset: 0.03 });
trial('no autostep, no kill', { autostep: false, snap: true, killWallVel: false, offset: 0.03 });
trial('FIX: kill only when not climbing', { autostep: true, snap: true, killWallVel: true, offset: 0.03 });
// trial('offset 0.01', { autostep: true, snap: true, killWallVel: true, offset: 0.01 });
