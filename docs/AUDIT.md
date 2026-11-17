# Campus Quest V2: code audit and plan

Audit of the current game against [STORY_V2.md](STORY_V2.md). No game code was changed for this audit.

Sizes used below: **S** = a few hours, under about 150 lines. **M** = one to two days, a few hundred lines. **L** = several days, a new subsystem.

## Summary

- The mission runner already covers most of what the ten missions need. Seven of the eight puzzle types the spec asks for exist today.
- The largest new pieces are the cutscene engine, the evidence board, the motorbike chase in M10, and the framework for mini-games between missions.
- Every place in the spec exists in the map except three that have no name there (the east ring road, the gate road and the main gate). All three already have coordinates in the code, so nothing needs inventing.
- The spec has four gaps or conflicts that need your decision before Phase 5. They are listed under [Conflicts and gaps in the spec](#conflicts-and-gaps-in-the-spec).

## 1. How a mission is defined and run

**Definition.** A mission is a `MissionDef` in [story.ts](../src/campus/story.ts): `id`, `title`, `clock` (a display string), `sky`, `brief`, `par` (seconds), an optional `kartAt`, a list of `steps`, and a `reward` (`coins`, `xp`, one optional `unlock`, and a `card` text). Types, cast, road routes and all dialogue sit together in that one file.

**Steps.** There are twelve step kinds: `talk`, `radio`, `goto`, `collect`, `quiz`, `riddle`, `puzzle`, `drive`, `chase`, `stealth`, `choose`, `kart`. A place is a `Where`: a building name, a point name (with an optional offset), an area name, or raw coordinates.

**Runner.** The `Missions` class in [missions.ts](../src/campus/missions.ts) is the state machine. Its state is the mission index and the step index.

| Method | What it does |
|---|---|
| `begin(index, step, replay)` | Resets hearts, time, coins and bonus objectives. Puts people at their posts, sets the sky, plays the intro shot, then enters the step. |
| `enterStep()` | Builds what the step needs in the world: items, a device, drones, rings, the chase drone or a riddle object. `radio` steps run their dialogue and advance on their own. |
| `update()` | Runs every frame: step logic, timers, prompts, the beacon. |
| `advance()` | Records the split time and moves to the next step. |
| `complete()` | Runs when the steps run out. Pays rewards, saves, and shows the completion screen. |
| `failed()` | Runs at zero hearts. Shows "Mission failed" and restarts the same mission from step 0. |

An `epoch` counter guards against stale async work when the step changes mid-dialogue.

**Hearts.** Three per mission. A heart is lost for a wrong answer, a failed puzzle, a wrong accusation, a full drone alarm, or a step timer running out. After a drone catch the player is moved 26 m back; after a timer loss the step restarts.

**Timers.** `goto`, `collect`, `riddle`, `drive` and `chase` steps can carry a `time`. Timers stop while any dialogue or puzzle is open. Drive timers only count while in Kalki, and chase timers only once the chase has started.

**Stars.** `starsFor()` in [profile.ts](../src/campus/profile.ts): one for finishing, one for losing no hearts, one for finishing within `par`. Mission time only counts live play, not dialogue or puzzles.

**Rewards.** Full coins and XP the first time; 40% coins and 30% XP on replays. Extra for each newly earned star, for a perfect run, for combo chains, and for the two bonus objectives each mission gets from `bonusFor()`.

**Resume.** The current mission and step are saved at every step, so Continue returns to the same step.

## 2. Mechanics that already exist

| Spec mechanic | Exists as | Files |
|---|---|---|
| Drone stealth | `stealth` step: N drones circle the target, an alarm fills while you stand in a light pool | [missions.ts](../src/campus/missions.ts) `updateDrones`, [actors.ts](../src/campus/actors.ts) `Drone` |
| Pursuit drone | `drive` step with `pursuer: true` | [missions.ts](../src/campus/missions.ts) `updatePursuer` |
| Kart driving | `Kalki`: drift, three mini-turbo levels, boost meter, upgrades, paints, call with K | [kart.ts](../src/campus/kart.ts), [vehicle.ts](../src/vehicles/vehicle.ts), [main.ts](../src/campus/main.ts) |
| Race | `drive` step: a ring every 30 m along a route, timed | [missions.ts](../src/campus/missions.ts), [actors.ts](../src/campus/actors.ts) `CheckRing` |
| Chase | `chase` step: a drone follows a route with rubber-banding; catch it within 4.2 m | [missions.ts](../src/campus/missions.ts) `updateChase` |
| Fetch objectives | `collect` step: press E on foot or drive through in Kalki, optional timer | [missions.ts](../src/campus/missions.ts), 13 item models in [actors.ts](../src/campus/actors.ts) |
| Breaker puzzle | `switches`: binary place values that must add up to a target | [minigames.ts](../src/campus/minigames.ts) |
| Pattern lock | `simon`: watch a light pattern and repeat it | [minigames.ts](../src/campus/minigames.ts) |
| Bearings | `tuner`: slide to the signal peak and hold it for 1.2 s | [minigames.ts](../src/campus/minigames.ts) |
| Pull-start, fuel pump | `gauge`: press when the needle is in the green, N hits, three misses fail | [minigames.ts](../src/campus/minigames.ts) |
| C bug finder | `debug`: pick the buggy line; the two snippets live in the story data | [minigames.ts](../src/campus/minigames.ts) |
| Firewall | No mechanic of its own. Old mission 14 is a stealth step, then `switches` (45 in six bits), then `simon` (six long) | [story.ts](../src/campus/story.ts) |
| Riddles | `riddle` step: no marker, two timed hints, a bonus for solving early | [missions.ts](../src/campus/missions.ts) |
| Keypad | `keypad`: used for the 36 kPa check and the desk code 472 | [minigames.ts](../src/campus/minigames.ts) |
| Accusation | `choose`: four options, one right answer, a wrong pick costs a heart | [minigames.ts](../src/campus/minigames.ts) |

Also present but unused: a `quiz` step and a question bank of eight subject pools in [questions.ts](../src/campus/questions.ts). No mission uses it today.

All existing puzzles are built from buttons and a slider, so they should work with touch as well as number keys. I confirmed this by reading the code, not by testing on a phone.

## 3. How the other systems work

**Dialogue and radio.** `dialog()` in [ui.ts](../src/campus/ui.ts) shows a card at the bottom with a name plate, a role line, typewriter text, voice blips pitched per speaker, progress pips, and tap or E to advance. The "portrait" is a coloured circle with the speaker's initials; there is no face art. MITRA has its own style today: red, glitchy, with an eye. A `radio` step is the same card with a radio badge and a beep. Lines are plain string arrays on the step. There is no radio log.

**HUD.** `CampusUI` in [ui.ts](../src/campus/ui.ts): mission card (title, clock string, objective, par clock, bonus objectives), hearts, coins, combo, level bar, shards, compass, minimap, step timer, drone alarm bar, speedometer, prompt, toasts, banner. Touch controls are in [touch.ts](../src/ui/touch.ts). The mission clock is a fixed string per mission; nothing counts down across the night.

**Camera.** Third-person on foot, chase camera in Kalki. [cinema.ts](../src/campus/cinema.ts) adds letterbox bars, a title card, scripted shots, an over-the-shoulder talk camera and a victory orbit. A shot today is a straight line from one point to another with one easing curve. Skipping is a single press of E or Space. The main loop also has slow motion and a short freeze for big moments.

**Sky and weather.** [atmosphere.ts](../src/render/atmosphere.ts) draws the sky, sun, fog and ambient light. [main.ts](../src/campus/main.ts) has four sky states (afternoon for the title, dusk, night, dawn) and blends between them over 2.5 seconds. Weather is a table of mission id to clear, drizzle or storm; it drives rain, lightning, wet ground and fireflies. Building windows glow at night according to a "campus power" level from 0 to 1.

**Audio.** Everything is synthesised at runtime. [audio.ts](../src/audio/audio.ts) has named one-shot sounds, footsteps, wind and birds. [soundscape.ts](../src/campus/soundscape.ts) has rain, Kalki's engine and night ambience. There is no music and no recorded voice.

**Saves.** [profile.ts](../src/campus/profile.ts) keeps one profile in localStorage under `campus-blackout-profile-v1`. Missing fields are filled from defaults, but a profile whose `version` is not 1 is thrown away and replaced with a fresh one. Story progress is a single index from 0 to 16. Stars, best times and bonus objectives are keyed by mission id.

**Coins, garage, shards, time trial.** Coins and XP feed player levels and titles. The garage (G key, also offered on the completion screen) sells three upgrade tracks and six paints. Memory shards (24, at landmarks) and the time trial with a ghost of your best lap are in [extras.ts](../src/campus/extras.ts). Daily goals and badges are in [meta.ts](../src/campus/meta.ts).

## 4. The ten missions

| Mission | Reused as is | Needs changes | New | Size |
|---|---|---|---|---|
| **M1 Lights Out** | All of old mission 1: stealth past 3 drones, talk to Asha, get in Kalki, pursuit drive along the existing escape route | Text (6 AM deadline, the player named as intruder). A MITRA line when spotted. Hook for C2 mid-mission | A main gate that closes. Today the gate is an arch with no leaves | M |
| **M2 Pit Stop** | Talk to Dhungana sir, fuel-pump `gauge`, ring-road race, grip unlock | Clock to 7:10. End beat with Sunil at the Power House | Sunil as a character, with the red pen drive on a yellow lanyard. Clue c1 | S to M |
| **M3 Backup Power** | Talk to Bhattarai sir, `switches` to 19, boost unlock | Riddle becomes a plain fetch at the Electrical Lab. Sunil on the radio | A 90-second countdown that keeps running during the puzzle. Screens showing the player's face. Clue c2 and the radio log | M |
| **M4 The Witness** | Talk to Krishna Dai, timed `collect` at the Auditorium, MSC Hostel and NESS WRC, drizzle | Item texts | Clues that fade as rain grows. Clue cards (gold or silver). The evidence board opens at the end | M |
| **M5 Landslide** | Talk to Chhetri sir, four sandbags by Kalki, timed run to the parapet, storm | Riddle becomes a plain fetch at the Tennis Court | Bubble-level mini-game. Raju as a character who helps and then runs. Clue c6 | M |
| **M6 Silent Shelves** | Talk to Khanal ma'am, timed `collect` of three books, desk code 472 | One book moves from the Saraswati Temple to the IOE fountain. Final riddle removed | Drones sweeping during a `collect` step. A "return the books" step. A readable register (c7) and book note (c8). Asha's radio going dead | M |
| **M7 Signal Hunt** | Two `tuner` bearings, stealth past 4 drones, `simon` lock, both unlocks | Radio partner becomes Sunil. Old mission 7 and the BP Park riddle are dropped. A mission needs two unlocks | Pulling the relay. Drones that freeze and turn blue. MITRA's memory (c9) | M |
| **M8 Runaway Drone** | Old mission 11 chase, unchanged | Text for the door log (c10). Two unlocks | Nothing | S |
| **M9 Who Did It?** | Talk to Bahadur Dai, the two `debug` snippets with Tiwari sir | The old item hunt and four-option accusation are removed | Readable guard register (c11) and console log (c12). The evidence-board accusation and wrong-answer flow | L |
| **M10 Before Sunrise** | Stealth past 4 drones, `switches` to 45, `simon`, collect three modules, timed run to the RIC, reboot `simon` | Tap riddle removed. Tighter par times when minutes to spare are 0 | Sunil on a motorbike, the chase to the gate, the gate closing, carrying the pen drive, the final choice, a pre-dawn sky, checkpoints between the four parts | L |
| **Ending** | The Campus Chief at the Auditorium, the hero unlock, the existing ending screen | Becomes cutscene only | Share card, minutes to spare on the ending | M |

## 5. The eight mini-games

| Mini-game | Reused | New | Size |
|---|---|---|---|
| Signal Tuner | The `tuner` puzzle | A dial look and a "jammed" variant | S |
| Chiya Rush | Nothing | Order queue and serving sequence. Pays coins and clue c13 | M |
| Table Tennis with Raju | Nothing | Pong on a canvas with a simple opponent | M |
| Bubble Level | Nothing | Centre the bubble and hold 3 seconds. Also needed inside M5 | S to M |
| Drone Hack | The `simon` puzzle | The "scout drone" reward, which the spec does not define | S plus M |
| Generator Pull-Start | The `gauge` puzzle | A rhythm variant. The "boost charge" reward, which the spec does not define | S |
| Bug Hunt | The `debug` puzzle | A 30-second timer, a bank of six-line snippets, a daily-challenge hook | S to M |
| Garage | Exists, and is already offered on the completion screen once Kalki is unlocked | Nothing | none |

Shared work that the list above depends on:

- **Interlude framework (M).** Today the next mission starts as soon as the completion screen closes. Mini-games "after M3" at a place need a step between missions, a played flag in the save, and skip-after-first-play.
- **The long wait (S to M).** Free roam after M9 with a trigger at the Exam Section.
- **Bonus riddles on shards (M).** Seven old riddles are available to reuse.

## 6. Cutscenes and new systems

| Item | What exists | What is new | Size |
|---|---|---|---|
| Cutscene engine | Letterbox, title card, straight-line shots, single-press skip | Curved camera paths, look-at targets that follow an entity, easing choices, time scale, subtitles, sound cues, scripted events, hold or long-press to skip, exact camera restore | M to L |
| C1 game start | Mountains, gate, RIC, window power level, drones | Fest banner on the gate, lights dying block by block (the power level run backwards) | M |
| C2 Kalki reveal | Kalki, headlights, orbit | A tarp that comes off | S |
| C3 lights return | Window power level | A screen with the player's face | M |
| C4 landslide | Lightning, rain | Mud slide effect | S to M |
| C5 radio static | Dialogue card | Static effect on the portrait | S |
| C6 drones turn blue | Drones | Drop, hang and re-light blue; typed memory text | M |
| C7 red string | Nothing | Lines between clue cards on the board | M |
| C8 timelapse | Sky blending | An 8-second blend, a spinning clock, a pre-dawn sky | M |
| C9 gate climax | Slow motion, Kalki | Kalki and the motorbike moved along scripted paths, gate closing, Bahadur Dai | L |
| C10 ending | Ending screen, fireworks, walking students | Sunrise shot, gates opening, a crowd, credits | M |
| Evidence board | Nothing | Full-screen board, three faces, gold and silver cards, drag a clue onto each of three questions, wrong-accusation flow | L |
| Clue tracking | Nothing | Thirteen clues, found or given, gold or silver, saved | M |
| Dialogue and radio | Card, typewriter, MITRA style, radio style | Portraits, MITRA in cyan monospace then warm white, a chirp before each line, a radio log | M |
| Sunrise clock | A fixed clock string per mission | Minutes to spare, gains and losses, effect on M10 | S to M |
| Name entry | Nothing | Name and roll number, saved | S |
| Fest demo mode | Nothing | `demo=1`, M1 only, local leaderboard | S to M |
| Stars rule | Three stars | Third star needs all clues gold in clue missions | S |
| Share card | Nothing | An image drawn at the ending | S to M |
| Location card | A title card on mission intros | Typed time and place | S |

## 7. Place names

Every name below was checked against the map data. The map data is in `campusData.json`, which [geo.ts](../src/campus/geo.ts) loads; I will treat both as read-only.

| Spec name | In the map as | Note |
|---|---|---|
| RIC | Building "Research and Innovation Centre (RIC)" | Must be written in full. A search for "RIC" alone matches "Electrical Lab" first |
| IOE fountain | Point | The key sits on the rim; the basin is solid |
| Automobile Workshop II, Power House, Electrical Lab, Machining Workshop, WRC Library, Hostel Guard Room | Buildings | Exact matches |
| Dept. of Electronics and Computer | Building "Department of Electronics and Computer Engineering" | |
| Dept. of Civil Engineering | Building "Department of Civil Engineering" | |
| Table Tennis hall | Building "Table Tennis" | |
| Cafeteria, WRC Auditorium, MSC Hostel, NESS WRC, Internet Zone, Exam Section, Administration Block | Points | All but the Administration Block sit inside a building; objects placed there go beside that building's door |
| BP Koirala Statue, Sahid Abinash Statue, GNSS Receiver Test Station, Saraswati Temple | Points | The GNSS station is inside a 3 m fence; it is reachable from outside |
| Tennis Court, WRC Parapet, BP Park | Areas | |
| hostels | Buildings "Boys Hostel (B Block)", "Boys Hostel (C Block)", "Girls Hostel" | |
| motorcycle parking | Building named only in Nepali: "मोटरसाइकल पार्किङ्" | Usable by that exact name. It will not show a label on the map screen, which hides non-English names |
| **east ring road** | **No name in the map** | Coordinates exist as `RING_EAST` and `RING_NORTH` in [story.ts](../src/campus/story.ts). The map's "WRC Quarter Ring Road" is a different road on the far west side |
| **gate road** | **No name in the map** | Coordinates exist as `ESCAPE` in [story.ts](../src/campus/story.ts), and the road from the gate to the fountain is an unnamed line in the map |
| **main gate** | **No name in the map** | The `GATE` constant in [geo.ts](../src/campus/geo.ts) |

Nothing needs invented coordinates. The M10 chase route to the gate can be built from the existing constants and the mapped road.

## Conflicts and gaps in the spec

These need your decision. The first four block Phase 5.

1. **M4 has two physical clues, not three.** The mission says "find 3 clues" at the Auditorium, MSC Hostel and NESS WRC. The clue list gives M4 only c4 (Auditorium) and c5 (MSC Hostel); c3 is Krishna Dai's statement. Either c3 counts as one of the three, or NESS WRC needs a clue.
2. **The evidence board is needed before its phase.** M4 (Phase 5) ends with the board opening, but the board is in Phase 6. I suggest a read-only board in Phase 5 and the accusation in Phase 6.
3. **How does the player "find" a clue that is not an object?** This decides who gets the third star. c1 is a pen drive nobody mentions, c2 is a radio line, c6 is Raju's behaviour. My suggestion:
   - c1: an optional "look closer" prompt while Sunil talks.
   - c2: gold if the player opens the radio log during M3.
   - c6: an optional prompt on Raju before he runs.
   - c7 to c12: given by the story, always gold.
4. **Power returns in M3, not gradually.** The current game lights more windows after every mission. V2 says the lights die at 6:52 and return at the end of M3. I will make V2 follow the spec and leave the old story as it is.
5. **BP Park is listed for M7 but nothing happens there.** It was the answer to a riddle that the spec removes.
6. **Two rewards are undefined:** the "scout drone" from Drone Hack and the "boost charge" from Pull-Start. My suggestion: the scout drone shows drone positions on the minimap for the next mission, and the boost charge is one instant refill of the boost meter.
7. **M10 is four parts with no checkpoint.** A failed mission restarts from the beginning today. Losing the motorbike chase would repeat about five minutes. I suggest a checkpoint at the start of each part.
8. **Bubble Level says "tilt".** Phone tilt needs a permission prompt on iPhones. I suggest drag and keys as the standard control, with tilt as an optional extra on phones.

## Risks

- **Portraits.** The dialogue, the evidence board, C3, C5 and C7 all need faces, and there is no face art. Rendering portraits once from the in-game 3D characters needs no new files and keeps the look consistent. The alternative is art you supply.
- **Reachability.** The fountain bug happened because an objective was fenced in and the automated playthrough teleports, so it could not notice. Every V2 objective needs a walk-to check, not only a teleport test.
- **Saves.** A profile with an unknown version is wiped today. V2 progress must be added without changing the version, or with a real migration. Unlocks (Kalki, boost, paints) would be shared between the two stories while both exist.
- **Hard-coded counts.** Badges, the window power level, the title blurb, the install-page blurb, the loading tips and the README all assume sixteen missions and a 9 AM leak.
- **Text in logic.** Mission dialogue is already data, but many other strings are inside logic files: about 60 toasts, prompts and banners, plus HUD labels and puzzle feedback. They need moving for your "one file of strings" in Phase 8.
- **Staff tone.** Some existing lines would break the new rule if carried over, for example Asha's "Dhungana sir will kill us". V2 text will be written fresh and checked.
- **Phone performance.** The existing frame loop allocates objects every frame in several places (navigation targets, the compass direction, audio listener vectors). New cutscene and mini-game code will not, as the rules require; the existing spots are a Phase 8 item. Each sky change also rebuilds the ambient light map, which costs a visible pause on a phone and matters for the C8 timelapse.
- **C9 and C10.** Moving a physics-driven kart along a scripted path, and a crowd of students, are the two cutscene items most likely to cost more than their size suggests.
- **Automated test.** [campus-test.mjs](../scripts/campus-test.mjs) plays the old story through the real UI. It needs a V1 switch to keep working, and a V2 version as missions land.
- **Uncommitted work.** The working tree has a large amount of uncommitted change. A commit before Phase 2 would give a clean baseline to compare against.

## Plan for Phases 2 to 8

Each phase ends with a type check, a build, a list of changes, and browser test steps.

### Phase 2: story data behind the flag

| File | Change |
|---|---|
| `src/campus/story/types.ts` | New. The step, mission, cast and clue types, moved out of story.ts, plus the new step kinds as types |
| `src/campus/story/routes.ts` | New. The road constants and time-trial data, moved unchanged |
| `src/campus/story/v1.ts` | New. The sixteen old missions, moved unchanged |
| `src/campus/story/v2/cast.ts`, `missions.ts`, `clues.ts`, `text.ts` | New. All V2 data; every line of dialogue in `text.ts` |
| [story.ts](../src/campus/story.ts) | Becomes the switch: `STORY_VERSION`, with a `?story=1` or `?story=2` override, re-exporting the chosen story so no other file's imports change |
| [profile.ts](../src/campus/profile.ts) | V2 progress, name, roll number, clues and minutes to spare, added without wiping old saves |
| [missions.ts](../src/campus/missions.ts) | Unknown step kinds are skipped with a warning, so V2 can be walked end to end as a skeleton |
| [meta.ts](../src/campus/meta.ts), [main.ts](../src/campus/main.ts) | Replace the sixteen-mission assumptions |
| `scripts/check-story.mjs` | New. Fails if a place name is not in the map, a character id is unknown, a clue id is unknown, or a card has more than two sentences |
| [campus-test.mjs](../scripts/campus-test.mjs) | Runs the old story with `?story=1` |

### Phase 3: cutscenes and dialogue, with C1 and C2

| File | Change |
|---|---|
| `src/campus/cutscene.ts` | New. `playCutscene(id)`, built on [cinema.ts](../src/campus/cinema.ts) |
| `src/campus/story/v2/cutscenes.ts` | New. Shot data for C1 and C2 |
| `src/campus/dialogue.ts` | New. The dialogue card moved out of ui.ts, with portraits, MITRA styles and the radio log |
| `src/campus/portraits.ts` | New, if you choose generated portraits |
| `src/campus/props.ts` | New. Fest banner and Kalki's tarp |
| [cinema.ts](../src/campus/cinema.ts), [ui.ts](../src/campus/ui.ts), [main.ts](../src/campus/main.ts), [campus.css](../src/campus/campus.css), [audio.ts](../src/audio/audio.ts) | Hold to skip, input lock, camera restore, styles, the MITRA chirp |

### Phase 4: M1, name entry, demo mode (your playtest)

| File | Change |
|---|---|
| `src/campus/screens.ts` | New. Name entry and the leaderboard screen |
| `src/campus/leaderboard.ts` | New. Local escape times |
| [world.ts](../src/campus/world.ts) | Gate leaves that open and close |
| [missions.ts](../src/campus/missions.ts), [main.ts](../src/campus/main.ts) | M1 wiring, MITRA's spotted line, the location card, the `demo=1` flow |

### Phase 5: M2 to M7, sunrise clock, C3 to C6

| File | Change |
|---|---|
| `src/campus/clues.ts` | New. Clue state, gold and silver, the radio log entries |
| `src/campus/clock.ts` | New. Minutes to spare |
| `src/campus/minigames/level.ts` | New. Bubble level, needed by M5 |
| [missions.ts](../src/campus/missions.ts) | Timers that run during a puzzle, drones on `collect` steps, fading clue items, several unlocks per mission, readable documents |
| [actors.ts](../src/campus/actors.ts), [people.ts](../src/campus/people.ts) | Sunil's lanyard, Raju, drones that freeze and turn blue |
| `src/campus/evidence.ts` | New. Read-only board for the end of M4 |
| `story/v2/cutscenes.ts` | C3 to C6 |

### Phase 6: evidence board, M8 to M10, C7 to C10, ending

| File | Change |
|---|---|
| `src/campus/evidence.ts` | The accusation: drag, keyboard alternative, wrong-answer flow |
| [actors.ts](../src/campus/actors.ts) | The motorbike and rider |
| [missions.ts](../src/campus/missions.ts) | A chase target that is not a drone, the route to the gate, checkpoints, the final choice |
| [main.ts](../src/campus/main.ts), [atmosphere.ts](../src/render/atmosphere.ts) | Pre-dawn sky and the timelapse |
| `src/campus/sharecard.ts` | New |
| `story/v2/cutscenes.ts` | C7 to C10 |

### Phase 7: mini-games and the long wait

| File | Change |
|---|---|
| `src/campus/minigames/chiya.ts`, `pong.ts`, `bugHunt.ts` | New |
| [minigames.ts](../src/campus/minigames.ts) | Variants of `tuner`, `simon` and `gauge` |
| `src/campus/interludes.ts` | New. When and where each mini-game is offered, skip after first play, rewards |
| [extras.ts](../src/campus/extras.ts), [meta.ts](../src/campus/meta.ts) | Bonus riddles on shards, the long-wait trigger, the Bug Hunt daily challenge |

### Phase 8: polish

| File | Change |
|---|---|
| [audio.ts](../src/audio/audio.ts), [soundscape.ts](../src/campus/soundscape.ts) | Sound pass and MITRA's voice |
| `story/v2/missions.ts` | Par times from playtest numbers |
| [main.ts](../src/campus/main.ts), [ui.ts](../src/campus/ui.ts), [missions.ts](../src/campus/missions.ts) | Remove the per-frame allocations; phone test |
| `src/campus/strings.ts`, `scripts/dump-strings.mjs`, `docs/STRINGS.md` | Remaining UI text moved to data, and the one file of every string for your review |

## Questions for you

1. **Portraits:** generated from the 3D characters, or art you supply?
2. **Conflicts 1 to 3 and 5 to 8 above:** are my suggestions acceptable, or do you want something different?
3. **Default story while I build:** I suggest the old story stays the default until your Phase 4 playtest, with `?story=2` to preview. Then the default flips to V2.
4. **Baseline commit:** do you want me to commit the current working tree before Phase 2?
