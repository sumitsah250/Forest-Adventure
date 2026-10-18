# Autonomous development log: Hollow Creek

Times are local (NST), taken from `date` at checkpoints; headings marked ~ are approximate. Each entry records what was done, how it was verified, and what is still open.

## 09:30 Repository check and decision

- The open workspace (`Desktop/games`) is the LOWKEY pass-the-phone party game (Expo / React Native, 2D, no 3D engine).
  There was no temple-themed 3D exploration game there or in other Desktop project folders; `design/1.html` is a
  marketing page with a decorative three.js canvas, not a game.
- I reported the mismatch, as the brief required. The user chose option 2: build the forest mystery as a **new,
  separate project**. LOWKEY was not modified.
- No platform was specified, so I used the recommended default: a **browser game (three.js + Rapier physics)**
  that runs on an ordinary laptop. New project: `Desktop/hollow-creek` (its own git repo, no commits made).

## 09:35 Tooling baseline

- Node 24.18, npm 11.16, Chrome + Edge installed, network access to npm and Poly Haven.
- Dependencies: `three@0.186.1`, `@dimforge/rapier3d-compat@0.21.0`, `vite@8.3.4`, `typescript@7.0.2`,
  `playwright-core@1.64.0` (uses the installed Chrome, no browser download).
- Checked the installed APIs rather than relying on memory: three r186 removed `PCFSoftShadowMap` (PCF with a
  radius is used instead), `RGBELoader` → `HDRLoader`, shader chunk names, and the Rapier ray-cast vehicle and
  character controller signatures.
- Skills: no game-dev, 3D or vehicle skills are installed. The available `animate`/`ui-ux` skills target web UI and
  React Native, so they don't apply to the 3D work. I'll draw on `frontend-design`-style principles for the HUD only.

## 09:40 Assets (CC0, Poly Haven)

- `scripts/fetch-assets.mjs` + `assets.manifest.json` download everything reproducibly into `public/assets/`.
- 20 PBR texture sets (forest floor, leaf litter, moss, mud, gravel trail, rock, bark, planks, rusty metal,
  corrugated iron, concrete), 7 foliage maps (fern, grass, shrub leaves, masks), 31 prop models (generator,
  jerrycan, field radio, office desk, logbook, searchlight, ammo box, bolt cutters, binoculars, cabin furniture…).
- The Poly Haven tree models are 2–17 M triangles and the sapling "twig" maps are geometry UV atlases, not
  sprites, so neither can be used for an instanced forest. Trees are generated in code instead (see below).

## 09:50–10:15 World foundation

- `src/world/layout.ts`: the designed map (600 × 600 m). Hollow Creek Road from the highway, trailhead,
  abandoned SUV, ranger station spur, collapsed bridge, ford detour, Ridge Gate, Ridge Road climbing to the
  lookout, ravine, the Miller cabin, a hidden camp, and foot trails.
- `src/world/terrain.ts`: designed landform (valley → ravine → ridge) + noise; the creek is carved with a smooth
  minimum and its water level follows the land; clearings are flattened; roads are graded from smoothed,
  grade-limited profiles with crowns, ditches and cut/fill shoulders. Side tracks are blended into the main road
  at junctions.
  - Verified in Node (`tests/terrain-probe.ts`, `tests/grade-probe.ts`): builds in ~2.5 s; the main road's
    steepest sampled grade is 17%. A junction bug (track grading overwrote the main road, up to 69% steps) was
    found and fixed.
- `src/physics/physics.ts`: Rapier heightfield. Verified with `tests/physics-probe.ts`: matches terrain height to
  ≤ 4 mm. Rays cast exactly along heightfield grid lines can miss (a Rapier edge case); ground queries are
  nudged off the grid to avoid it.

## 10:15–10:35 Rendering and forest

- Terrain shader: six photographic layers in array textures (needles, leaf litter, moss, mud, gravel, rock),
  height-aware blending, roads and wheel ruts evaluated per pixel from a signed-distance field, puddles in ruts,
  canopy shade baked from tree placement, triplanar/biplanar rock on steep banks.
- Atmosphere: exponential height fog with sun in-scattering (patched into every built-in material), a cloud sky
  dome, a PCF-soft sun shadow volume that follows the player (texel snapped), and image-based light from the sky.
- Forest: ~10,000 trees (fir, spruce, pine, broadleaf, snags, saplings; 15 generated variants) and ~19,500
  ferns, grass clumps and bushes. The foliage atlas is generated at load time (needle sprays drawn stroke by
  stroke; leaf clusters assembled from photographed leaves; fern and grass sprites cut from Poly Haven
  atlases) with colour bleeding so mipmaps don't darken. Trees use distance-bucketed instancing, impostors
  baked at load for distant trees, wind sway and trunk colliders.
- First-person player: Rapier kinematic capsule, slope limits, step-up, ground snapping, smooth acceleration,
  restrained head bob, landing dip, wading in water.

## 10:20–10:37 Performance pass (Intel Iris Xe, 1280×720, Medium)

GPU-synchronised timings from `node scripts/browser-test.mjs bench medium` (real numbers, headless Chrome on the
laptop's GPU):

| Stage | Forest view | Trailhead view |
|---|---|---|
| First full forest | 78 ms | 88 ms |
| + terrain after trees, sky last, fewer terrain samples, foliage depth pre-pass, proxy shadows | 33 ms | 37 ms |
| + impostor pre-pass, terrain far-LOD | 25 ms | 35 ms |

After the impostor range was trimmed, the live loop reports 16.8 ms frames at the test views.

Open issues at this point: grass/undergrowth reads too dark and small; broadleaf crowns are a bit stylised; no
water surface yet; no structures, vehicles, gameplay, audio or UI yet.

## ~10:40–11:00 Vehicles

- `src/vehicles/vehiclePhysics.ts` (renderer-independent): Rapier ray-cast vehicle with sprung wheels, 4WD with a
  torque curve and a 4-speed automatic, brake-then-reverse on S, handbrake that loosens rear grip, speed-sensitive
  rate-limited steering, anti-roll bars, aero and rolling drag, per-surface grip (gravel/mud/forest/moss/rock/water)
  and water drag.
- Tuned headlessly with `tests/vehicle-sim.ts` on the real terrain. Bugs found and fixed:
  - Suspension force is mass-scaled in Rapier (confirmed by a 7–8 cm static sag).
  - The autopilot steering sign in my test was wrong, which sent the truck off the map edge. Added invisible
    boundary walls at the map edge (a real gap).
  - The anti-roll bar sign was inverted (it rolled the truck over on a straight launch). After the fix, off-road
    launches stay within ~11° and full lock at speed no longer upsets the truck.
- `src/vehicles/vehicleModel.ts`: procedural forest-service 4x4 and a civilian SUV. Side-profile extrusions with
  real wheel arches, a separate narrower cabin, glass, bull bar and winch, snorkel, roof rack with a Poly Haven
  jerrycan, amber light bar, mirrors, lathe-turned tyres with tread bump maps, steel rims and lug nuts, spare
  wheel, tail/reverse/brake lights, interior silhouette (dash, seats, steering wheel). Side artwork per flank:
  door seams, handles, a fictional "Hollow Creek Ranger District" emblem, unit number, scratches, rust, mud spray.
  Static parts are merged per material (~10 draw calls).
- `src/vehicles/vehicle.ts`: enter/exit with a free-space check, interpolation between fixed steps, a chase camera
  (mouse orbit that eases back, collision pull-in, ground clamp), cockpit camera, headlight spot, upset/stuck
  recovery (hold R).
- In-browser `drive` test passed: enters; 36 km/h after 4 s; right turn; brakes from 43 km/h in 2.0 s; reverses;
  stays upright; exits onto the ground.

## ~11:00–11:20 Structures, mystery, UI, audio

- `src/world/structures.ts`: ranger station (foundation, siding walls with real openings, windows, gable roof,
  porch, hinged door, furnished interior from Poly Haven props, key cabinet, wall map, generator lean-to, power
  box, drums), trailhead notice board and warning sign, collapsed bridge (log-crib abutments, two sagging spans,
  loose planks in the creek, knocked-over barrier), Ridge Gate (rusty pipe gate, cut chain and new padlock,
  boulders), a fire lookout tower with walkable stairs, balcony and cab, the Miller cabin (stacked logs, chimney
  smoke, lantern glow, woodpile), the abandoned maroon SUV (open door, flat tyre, green paint scrape, dropped
  searchlight), the Unit 4 wreck on its side (crumpled body, cracked windshield, maroon scrape, glass on the
  slope, snapped posts), the poachers' camp and Hale's flagging-tape trail with her flashlight.
- `src/game/mystery.ts`: 21 clues, adaptive objectives, a station power puzzle (logbook → dead radio → empty
  generator → jerrycan from your own truck → refuel (hold) → pull-start (hold) → transfer switch → recorded
  transmission), key → ford → gate → bend → wreck → tape → cabin → truck radio → ending. Hints after 3 and
  5.5 minutes without progress; on-demand hints in the journal. Light moves toward dusk as the story progresses.
- `src/ui/hud.ts`, `src/ui/screens.ts`: objective, compass with a distance marker, prompts with hold rings,
  toasts, subtitles, vehicle panel; title (with Continue), pause, settings (quality/sensitivity/FOV/volume/invert
  Y/frame time), controls, credits, journal, a topographic map generated from the real heightfield (also used
  as the station's wall map), and the ending with stats. Autosave every 20 s and on each clue.
- `src/audio/audio.ts`: all sound synthesised with WebAudio. Wind and rustle that follow gusts, three positional
  creek emitters, birds (four call types; fewer at dusk), woodpecker, owl at dusk, surface-specific footsteps
  (gravel, needles, moss/grass, mud, water, wood, rock), an RPM/load-driven engine with tyre noise per surface,
  impacts from contact-force events, generator and radio-static loops, and interaction sounds.

## ~11:20–11:45 Performance and fixes

- Four Poly Haven props (two lamps, generator, wall clock) used `KHR_materials_transmission`, which makes three.js
  re-render the scene into a transmission buffer every frame: the station view cost 53–72 ms. Transmission is now
  replaced with plain transparency at load → **28 ms**. Prop textures are capped at 512 px (GPU memory).
- Point lights: a single pooled point light follows the nearest lit lamp; one headlight spot and one flashlight
  spot always exist (intensity 0 when off), so the light count is constant and toggling never recompiles shaders.
- Creek water ribbon added (first version was back-face culled; fixed winding).
- Grass clumps brightened and their alpha thickened (distant clumps had eroded to dark specks); fewer, fuller
  pines; puddles less black; HUD text gets a soft backdrop over bright sky; flashlight (F).
- Automated tests now passing:
  - `npm run test:sim`: 26/26 checks (terrain, grades, ford depth, heightfield accuracy, settle, autopilot,
    braking, reverse).
  - `node scripts/browser-test.mjs play medium`: full playthrough from trailhead to ending screen, no problems,
    19/21 clues (all 10 main clues).
  - `npm run build`: typecheck + Vite production build succeed (JS 5.2 MB / 1.9 MB gzip).

## 11:45–14:40 Polish, new systems, and bugs found by testing (session paused ~12:10–14:20)

- **Forest floor debris** (`src/world/debris.ts`): mossy rocks and creek-side boulders (5 procedural shapes,
  box-projected UVs, moss on upward faces), fallen logs lying along the slope (capsule colliders), old stumps
  with ring-textured tops (more near the road), and scattered branches. Rock subdivision reduced after the first
  version added ~1.3 M triangles.
- **Broadleaf trees** rebuilt: 4–6 limbs leaving the trunk at different heights, forked secondary branches, and
  96 leaf clusters (half around branch tips). They no longer read as a bare "Y".
- **Touch controls** (`src/ui/touch.ts`): joystick, drag-to-look, Use, Jump/brake, Torch, Lights, Radio,
  Journal/Map/Pause; hidden while menus are open. Verified in a phone-sized emulated touch viewport.
- **Dynamic resolution**: render scale drops in 10% steps (to 60%) when frames are slow and recovers with
  headroom. Disabled under `?test` so benchmarks stay comparable.
- **First-run quality default** from the GPU name (integrated/mobile → Low, otherwise Medium).
- **Wheel spray** (dust, mud clods, water) from the rear tyres, plus camera shake on hard impacts.
- **Fixed by inspecting screenshots:**
  - door lettering was mirrored on the truck's left flank;
  - the creek water was back-face culled;
  - grass clumps eroded into black specks at distance;
  - the cabin's lantern light leaked through its walls onto the porch;
  - the title paragraph was hard to read.
- **Bugs found by new automated tests:**
  - The **lookout stairs could not be climbed.** A minimal Rapier reproduction (`tests/ramp-probe.ts`) showed
    the cause was my own "zero velocity into walls" rule in the player controller: it fired on the first frame
    of a slope climb. It now skips frames where the controller lifts the player. The stair ramp colliders were
    also extended below ground and past the landing. `walk` test: +2.2 m climbed in 4 s, and the player walks
    through the station door.
  - The browser drive test drove off the pad into the (now debris-filled) forest, which produced a meaningless
    "0.19 s brake". It now starts on the road: 41 km/h after 2.5 s, 41 → 0 km/h in 1.78 s (~0.65 g).

### Final verification (14:40)

| Command | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run test:sim` | 31/31 checks pass (terrain, grades, ford depth 0.21 m, heightfield ≤ 0.22 m error, settle, autopilot to the bridge, braking 54 → 0 km/h in 2.2 s, reverse, ford crossing, Ridge Road climb, lookout) |
| `node scripts/browser-test.mjs play medium` | ok: trailhead → ending screen, 19/21 evidence (10/10 main), 0 console errors |
| `node scripts/browser-test.mjs walk medium` | ok: stairs +2.21 m, entered station |
| `node scripts/browser-test.mjs drive medium` | ok (numbers above) |
| `node scripts/browser-test.mjs touch low` | ok: controls visible, joystick moved player 3.34 m |
| `npm run build` | pass (JS 5.2 MB / 1.9 MB gzip; assets ~100 MB) |

LOWKEY (`Desktop/games`) was not modified: its git status is identical to the session start.

---

# Session 2 (Oct 13, from 16:13 NST): realistic trees, third-person play, weapons and missions

## 16:13 Stage A: audit and baseline

**Safety checkpoint.** The repository had no commits. Committed the whole project as `d1d967f` ("Baseline
checkpoint") on `master` and moved all new work to branch `feature/third-person-weapons-missions`.

**Instructions read.** There is no `AGENTS.md` or project `CLAUDE.md`. The global `~/.claude/CLAUDE.md` only
registers the graphify skill. None of the installed skills cover 3D games, character animation or weapons
(they are web-UI, motion-graphics and document skills), so none apply directly.

**What exists and works (preserved):**

| System | State |
|---|---|
| Engine | three.js r186 (WebGL 2) + Rapier 0.21, Vite, TypeScript. Browser game; keyboard/mouse and touch. |
| World | 600 × 600 m valley, graded roads, creek, ford, ~10 k procedural trees, ~19 k ground-cover plants, rocks, logs. |
| Vehicles | Rapier ray-cast 4x4 with chase/cockpit cameras, enter/exit, recovery. |
| Structures | Ranger station (door, generator puzzle), bridge, gate, lookout tower, Miller cabin, SUV, Unit 4 wreck, hidden camp. |
| Story | `mystery.ts`: 21 clues, flag-driven objectives with hints, scripted dialogue, ending after the medevac call. |
| Player | First-person kinematic capsule. `player.ts` already had an unfinished `cameraView: 'third'` stub (camera only, no body) and `input.ts` already declared `aim/fire/reload/weapon1-8` bindings that nothing used. |
| Not present | No character model, no animation, no weapons, no enemies, no player health, no mission layer. |

**Baseline checks (all pass before any change):**

- `npm run typecheck`: pass.
- `npm run test:sim`: 31/31.
- `node scripts/browser-test.mjs play medium`: ok, trailhead to ending, 19/21 clues (10/10 main), 0 console errors.

**Plan.** I'll extend the existing systems rather than replace them. The forest generator keeps its instancing and
impostors, with better tree models and materials. The first-person controller becomes the third-person
controller: same capsule physics, plus a visible character and an orbit camera. The weapons are a new module
driven by one shared definition table. The missions layer sits on top of the existing mystery flags, so the
current story becomes Missions 2 and 3, and new content fills Missions 1 and 4 to 8. The story already has armed
poachers ("jacklighters") who ran Ranger Hale off the road, so they become the hostile NPCs. When defeated they
surrender (non-graphic).

## 16:25–21:20 Stage B: more realistic trees (session paused part of this time while the usage limit renewed)

**Diagnosis (screenshots `treesNear`, `treesUp`, `trunkBase`, `lookoutView`):** trunks were smooth reddish
cylinders that stopped dead at the ground; the bark photo was mapped 0.75 × 1.5 m, so its plates were
stretched to twice their height; crown undersides rendered almost black; a close fir branch was one huge flat
card; pines had a limb every ~0.7 m (a "ladder"); every tree of a variant had the same colour.

**Changes (`treeGen.ts`, `vegetation.ts`, `foliageMaterial.ts`, `foliageAtlas.ts`):**

- **Two tree LODs from one seed**, plus impostors. *Hero* models (within 14/20/34 m on low/medium/high) have
  12-sided trunks, buttress roots, dead lower branches as real wood, and conifer branches built as a drooping
  woody limb that carries 3–4 layered needle sprays. *Mid/low* models keep one card per branch. The main random
  stream is shared, so the silhouette stays the same when a tree changes LOD.
- **Trunks:** dense rings near the base give a smooth flare with sharp buttress lobes; surface roots continue
  those lobes and dive into the soil; shallow furrows and an S-bend break the perfect cylinder; bark UVs at true
  scale (0.62 × 0.78 m); normal strength 1.2 → 1.7.
- **Bark weathering in the shader** (no repetition): moss on the flare, roots and north faces of the lower
  trunk, growing in crevices first; faint lichen higher up; damp dark bark at the soil line.
- **Foliage lighting:** skylight transmitted through the canopy (stronger on inner, downward faces). Crown
  undersides are now dark green, not black. Inner AO floor raised.
- **Species and shapes:** 21 variants (was 15). Firs now include a narrow subalpine spire and a broad old fir.
  There's a fourth spruce. Pines are rebuilt with sparse irregular whorls (2–4 limbs, gaps), limbs that sag
  then turn up, forks, and needle clumps along the outer half. There's also a flat-topped old pine. Broadleaf
  crowns branch three levels deep. Two **autumn** broadleaf variants (golden and orange, coloured leaf by leaf
  in the atlas), more common at forest edges, fit the mid-October story. Snags come as stub, broken-top and
  leaning.
- **Per-instance variation:** each tree has its own brightness, a warm/cool shift, a height stretch, and a 4%
  chance of a stressed, yellowing conifer. Impostors use the same tints.
- Small saplings moved into ground cover. Empty instance buckets are skipped (no draw call).

**Performance** (GPU-synchronised, Iris Xe, 1280×720, medium; this laptop's thermals add ±2–4 ms noise):
trailhead 35.5 → 34.7 ms, forest 34.4 → 32.2 ms, dense near-forest 27.2 → ~31 ms (hero LOD ≈ +3–4 ms there).
To pay for it, I reduced the hero radius on medium from 24 m to 20 m. This GPU defaults to the Low preset.

**Remaining limitations:** from the lookout tower, crossed-quad impostors still look like thin spires from
steep angles. Pine limbs seen side-on can still read as rather regular. Broadleaf cards are visible as flat
clusters at close range.

## 21:20–(see below) Stage C: third-person character and camera

- **Character** (`src/character/humanoid.ts`): a single skinned mesh lofted from anatomical cross-sections
  (torso, limbs, head, hands, boots) over a 22-bone skeleton. There are no character assets in the project and
  no CC0 realistic rigged human was available offline, so the character is procedural, like the rest of the
  world. Outfits share the generator: the **ranger** (field jacket with chest pockets, badge, shoulder patch,
  duty belt with radio, daypack, cap) and **four poacher outfits** (canvas work jacket and jeans, woodland
  camo, hoodie with vest, flannel), with procedural twill, camo, plaid and denim textures.
- **Animation** (`src/character/animator.ts`): procedural, no clips.
  - **Gait:** phase-driven, with planted feet. A stance foot stays where it landed (no sliding). A swing foot
    flies to a predicted landing point found by a ground ray cast, so steps follow slopes, stairs and floors.
    Walk to sprint blends duty factor, stride, bounce and lean.
  - **Legs and torso:** two-bone leg IK. The pelvis height comes from what the planted feet can reach, which
    gives a natural compass-gait dip. The torso leans with acceleration and pitches with the aim. The head
    looks at targets.
  - **Arms and poses:** arms counter-swing, or use IK to the held weapon's grips. Sitting and kneeling
    (surrender) poses.
  - **Bugs found with a numeric gait trace and fixed:** the swing fraction was 0 instead of 1 on the
    phase-wrap frame, which made 2.5 m strides; the hip-reach clamp used the wrong joint offsets, which bent
    the knees.
- **Camera** (`src/player/thirdPersonCamera.ts`): behind and above, over the right shoulder (V swaps
  shoulders). It looks exactly along the mouse yaw/pitch, so the screen centre is the true aim. Pitch is
  limited to −1.2/+1.1 rad. A Rapier sphere cast from head to shoulder to camera snaps it in front of trunks,
  rocks and walls and eases it back out. Aiming moves it to a tight 1.45–1.8 m over-the-shoulder view; the
  scope moves it to the eye. A 0.55 s camera blend smooths on-foot ↔ vehicle ↔ title transitions.
- **Movement** (`player.ts`): camera-relative. The body turns toward travel, or faces the aim and strafes
  while aiming or firing. Brisk walk 3.0 m/s, sprint 5.8, aim-walk 2.0, crouch 1.5. Rendering is
  interpolated between physics steps. Footstep sounds now come from actual foot plants. Interactions measure
  reach from the character's head and aim from the camera ray. The binoculars switch to a temporary eye-level
  view.
- **Regression tests after the switch:** `walk` ok (stairs +2.77 m, into the station); `play` ok (trailhead to
  ending, 19/21 clues); `drive` ok (41 km/h, brake 1.8 s, exits on foot).
- **Limitations:** the face is simple (eyes, brows, nose, ears) and has no expressions. There are no
  per-finger bones; the hands are posed mittens curled for gripping. Entering a vehicle hides the character
  rather than animating a climb-in.

## Stage D: weapon system

- **`src/weapons/defs.ts`:** one table for all 8 weapons, with slot, role text, hold style, ammo type, magazine,
  fire mode, cycle time, pellets, damage, head multiplier, effective and maximum range (falloff), hip and aim
  spread, bloom, recoil, visual kick, reload style and times, aim distance and FOV, scope, stagger, sound
  profile and carry weight. There are six ammo types; 9 mm and 7.62 mm are shared between two guns each.
- **`src/weapons/models.ts`:** eight procedural guns at real scale, built from extruded side profiles, lathed
  barrels and bevelled parts in polymer, parkerized, blued or stainless steel, walnut, birch, rosewood and tan
  polymer. Moving parts are separate: slide, revolver crane/cylinder/hammer, shotgun pump, bolt, magazines.
  Each gun has anchors for the grip, support hand, butt, muzzle, ejection port and magazine well.
- **`weaponSystem.ts`:**
  - Inventory and a draw/holster/switch state machine. Holstered guns stay visible on the body (sidearm on the
    right thigh, last long gun slung on the back).
  - **Aim point:** the camera ray through the screen centre. **Shots** leave the real muzzle toward it. A gun
    pushed into a trunk or wall hits that obstacle, and the crosshair shows an X when the muzzle is blocked.
  - Firing: spread cone, pellets, range falloff, head/limb multipliers, bloom, camera recoil with partial
    recovery, and a visual kick.
  - Reloads by mechanism: magazine (support hand to the well, magazine carried to the belt and back, slide or
    charging handle when empty); speedloader (crane swings out, muzzle up to dump brass); shell by shell
    (interruptible to shoot); single rounds through an open bolt. Pump and bolt cycling are animated.
  - The scope sways; holding Shift steadies it for a few seconds.
- **`effects.ts`:** muzzle flash with one shared flash light, faint tracers, pooled impact particles per
  surface (dust, splinters, sparks, splash, cloth puffs; no gore), 90 bullet-hole decals, and bouncing brass.
  **`combat.ts`:** one trace for player and NPC shots (Rapier world plus analytic hittables), collider surface
  tags (trunks wood, rocks rock, gate/SUV/wreck/vehicles metal), and gunshot noise events for NPC hearing.
- **Audio:** each gun has its own synthesised shot: crack, body thump at its own frequency, boom and tail into
  reverb and a valley echo; distant shots are delayed and low-passed. Handling sounds for magazines, slides,
  pumps, bolts, cylinders and shells; dry fire; impacts per surface; whizz; hit tick.
- **HUD:** weapon panel (name, magazine/reserve, ammo, fire mode, reload bar, 8 slots), a spread crosshair that
  turns red on a target and shows an X when blocked, hit markers, a damage vignette with direction arrow, a
  condition bar, the scope overlay, the Tab inventory and contextual controls. Prompts and subtitles moved off
  the character.
- **Controls:** W/A/S/D, mouse, Shift sprint/steady, Space jump, LMB fire, RMB aim, R reload, E interact,
  1–8 select, H holster, mouse wheel cycle, Tab weapons (the journal moved to J only), V swap shoulder.
- **Test (`node scripts/browser-test.mjs weapons`):** all 8 weapons drew, aimed, fired 3 rounds and reloaded.
  The magazine went back to full and the reserve dropped by exactly the refill (for example P9 15→12→15,
  reserve 135→132; Ridgeline 5→2→5 one round at a time; Ranger 12 6→3→6 shell by shell). Side-view pose
  screenshots (`poses` mode) confirm the shouldered rifle, isosceles pistol, shotgun on the pump, and the
  magazine and bolt-rifle reloads.

## Oct 14, 07:28–13:32 Stage E: enemies and missions; Stage F: polish (session paused ~09:45–12:25 for the usage limit)

**Hostile NPCs** (`src/game/npc.ts`). The poachers use the player's rig, animator and weapon-hold code
(`weapons/hold.ts`), carry real weapon models, and shoot through the same combat trace, so trees, rocks and
vehicles are cover for both sides.
- **States:** idle/patrol → suspicious (glimpse, distant shot) → combat → down. They return to their posts if
  they lose contact.
- **Perception:** vision cone and range, reduced at dusk and against a crouching player; line-of-sight rays;
  awareness builds over time. They hear gunshots and nearby impacts, and alert each other.
- **Combat:** they pick cover that blocks the line to the player, crouch, stand and aim with a visible wind-up,
  fire short bursts, reload behind cover, re-position after three cycles or when flanked, and hunt the last
  known position.
- **Shooting:** error grows with range, player movement, crouching and suppression. The first shots go wide.
  Damage is ×0.36 of the player's. A scope glint warns before Kessler's long shots.
- **Defeat (non-graphic):** at zero health they surrender, kneeling with hands on head, and drop their guns.
  You can take ammunition from the dropped guns.
- **Player:** a hit capsule, condition that regenerates after 6 s, a damage vignette with a direction arrow, and
  being downed fades to black and returns you to the mission checkpoint, where the surviving NPCs reset.
- **Bugs found with a per-NPC phase trace and fixed:**
  - NPCs never fired. They never "arrived" at cover because the arrival test included height, and cover points
    could lie inside rocks.
  - Cover points are now validated with a capsule test.
  - Movement uses arrive steering and progress-based stuck detection, replacing a speed-based check that
    misfired when they braked.

**Missions** (`src/game/missions.ts`, `missionSites.ts`, `pickups.ts`, `targets.ts`). Eight connected missions
extend the existing story: the mystery's flags still drive Missions 2–3, and the medevac call now continues the
story instead of ending it. They are listed in README.
- **New sites:** district training range (bench, lockbox, swinging steel plates, paper silhouettes that show
  every hole, backstop); a gun locker in the station (combination in the logbook); Hale's revolver at the wreck;
  the Ridge Road roadblock; the hidden supply cache (boot prints, drag marks, branch pile, chained trapdoor, ledger);
  the felled-tree blockade at the ford (stump, sawdust, truck, winchable log); the poachers' base camp (trailer,
  gun rack, tents, ATV, tree stand); the trailhead meeting.
- **Mission features:** each mission has a checkpoint, its own hints and a reward. There's a mission log in the
  journal, mission and objective toasts, and radio dialogue that doesn't block movement.
- **Player choices:**
  - The blockade can be approached along the open track or through the creek-bank brush. The loadout objective
    lets the player pick any gun.
  - The lookout rifle is optional.
  - The truck restocks ammunition once per mission.
- **Saving:** missions, weapons (magazines and reserves), pickups and surrendered NPCs are saved.

**Bugs found while testing and fixed:**
- **Inverted or fisheye view on start** (camera FOV 288°): the first frame's `dt` was negative (rAF timestamps
  precede `performance.now()`), and the third-person camera's `damp` extrapolated. `dt` is now clamped at 0 and
  the FOV at 5–120°.
- **Camera blend:** it passed the camera's own quaternion as the slerp target (aliasing), freezing orientation
  during blends. Fixed.
- **"Check your map":** opening the map during the gap between missions didn't count. It does now.
- **Surrendered crew after Continue:** they came back un-surrendered. They now restore straight to that state.
- **Stale ending text:** it described Kessler being arrested at a motel. Updated, with mission and accuracy
  statistics added.

**Performance:** the new sites are merged per material and, like the story's structures, hidden beyond the fog
(240–420 m). Draw calls at the trailhead are 439, against 467 originally. GPU frame cost on the Low preset (this
laptop's default) is 13–18 ms, unchanged from before the missions; on Medium it is 28–38 ms.

**Touch:** Fire, Aim (toggle), Reload, Weapon and Holster buttons appear once a gun is carried. The gun
crosshair shows on touch.

### Final verification (Oct 14, 13:30)

| Check | Result |
|---|---|
| `npm run build` (typecheck + Vite) | pass |
| `npm run test:sim` | all checks pass |
| `browser-test missions` | **ok: all 8 missions completed through real gameplay to the ending screen**. 5 encounters, every poacher surrendered to real shots (26–57 trigger pulls each), 0 console errors |
| `browser-test play` | ok: story interactions to the medevac call |
| `browser-test walk` / `drive` | ok: stairs +2.74 m, station entered / 40.9 km/h, brake 1.8 s |
| `browser-test weapons` | ok: all 8 weapons fire 3 and reload; ammunition exact |
| `browser-test combat` | ok: detection, cover, return fire (player hit), surrender |
| `browser-test touch` (low, phone viewport) | ok: joystick moved player 3.70 m |
| `browser-test savegame` | ok: state identical after save → reload → Continue |

The tests use teleports to move between locations and a test-only aim helper in fights. They prove the systems
work and the sequence can be completed. They don't prove the difficulty feels right for a human, which needs
hands-on play.

### Known limitations and next priorities

1. **Characters are procedural.** The faces are simple and have no expressions. There are no finger bones (the
   hands are curled mittens). Getting into a vehicle hides the character instead of animating the climb-in.
   Rigged CC0 human assets with mocap clips would be the biggest visual upgrade.
2. **Gun models are procedural** (extrusions and lathes). They read clearly as different weapons, but at close
   range they are not as detailed as sculpted assets.
3. **Difficulty is untuned by humans.** In particular, the blockade (4 poachers, one with 130 HP) and the final
   meeting (Kessler, 220 HP) may need tuning after playtesting.
4. **NPC navigation** is steering with detours, not a navmesh. On steep ravine slopes an NPC can stall briefly
   before re-routing.
5. **Trees:** impostors still look like thin spires from the lookout tower's steep angle. Octahedral impostors
   would fix that.
6. **No music.** The ambience and gun audio are synthesised.
7. The "keep exploring" mode after the ending has no new objectives.
