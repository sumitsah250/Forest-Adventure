Phases 2 and 3 are done and reviewed. Now build everything that is still stubbed, so that campus.html?story=2 is the complete game described in docs/STORY_V2.md, with no TODO_ stubs left.

FIRST: save this whole prompt, unchanged, as docs/BUILD_PLAN.md.

HOW TO WORK
- Work through Phases 4, 5, 6, 7, 8 and 9 below, in order. Do not stop to ask for approval between phases.
- At the end of every phase: run the type check, the build, npm run check:story and npm run test:smoke. Fix anything that fails. Commit with the message 'Phase N: <summary>'. Update docs/PROGRESS.md with what is done, what is left, how I test it, and the exact next step. Then start the next phase.
- Stop and ask me only if: (a) you need a package that is not pre-approved below, (b) a step cannot be undone, such as deleting the old story or changing saves without a migration, or (c) the spec contradicts itself and no option keeps section 2 (the hidden truth) consistent.
- For every other gap, including the open ones in docs/AUDIT.md, pick the simplest option that keeps the hidden truth consistent and the mystery fair. Write it in docs/DECISIONS.md and keep going.
- If you run low on context, finish the current step, commit, write the exact next step in docs/PROGRESS.md, and tell me to send the resume prompt.
- All the earlier rules still apply: geo.ts untouched and only its place names used, the old story behind STORY_VERSION, every string in data files, no per-frame allocations, touch and keyboard on every screen, old saves migrate cleanly, real staff only in short kind helper roles, at most two short sentences per subtitle card.

PRE-APPROVED
- Playwright as a dev dependency, for the smoke test only.
- Audio files you synthesise yourself or take from CC0 sources (see SOUND DIRECTION).

DECISIONS ALREADY MADE (update docs/STORY_V2.md to match)
1. Mission 4 has three clue objects: c4 (yellow lanyard strap by the Auditorium), c5 (grey hoodie thread on the MSC Hostel fence) and a new c14 (a red pen-drive cap by the NESS WRC steps, on the same path as the strap; it points to Sunil once linked to c1 and c3). c3 stays Krishna Dai's statement, collected by talking to him in the Cafeteria. In the accusation, question 2 also accepts c14.
2. c1 and c2 are never announced. c1 turns gold if the player taps Sunil's lanyard during the M2 meeting (the camera glances at the red pen drive). c2 turns gold if the player pins Sunil's '6:55' line from the radio log to the board. If missed, both appear on the board as silver cards with no dialogue. Asha announces every other missed clue at mission end.
3. c9 and c10 are always given gold, by cutscene C6 and at the end of M8, so they need no fallback.
4. Order: finish the story phases (4 to 8) first, then the graphics, mobile, Kalki and menu work as Phase 9.

DEBUG TOOLS (build these first, at the start of Phase 4)
- campus.html?story=2&debug=1 opens a small panel: jump to any mission or interlude, give all clues gold or silver, clear clues, set minutes to spare, set weather and time of day, skip the current cutscene, show FPS and draw calls. Without debug=1 the panel does not exist.
- npm run test:smoke: a Playwright test that opens each mission through the debug jump, waits 5 seconds, and fails on any console error.

PHASE 4: MISSION 1 COMPLETE, NAME ENTRY, FEST DEMO
- Name and roll number entry on first launch, saved and editable from the menu. MITRA uses them in every line with a {name} or {roll} slot. This first tap also unlocks audio.
- A location card at every mission start: time and place type on, for example '7:50 PM, CAFETERIA', for 2.5 seconds.
- The main gate slam at the end of M1: the gate swings shut, the camera shakes, and MITRA says the player's name on every speaker.
- MITRA's spotted lines: at least 8 per act, no repeat twice in a row, at most one every 6 seconds.
- Fest demo mode, ?demo=1: name entry, C1, M1 only, then a leaderboard of the 10 best escape times in localStorage. A 3-second long-press on the leaderboard title resets it, for stall staff. After 30 seconds idle it returns to the name screen.
- Done when: M1 plays from name entry to the gate slam with no TODO_, and demo=1 loops cleanly.

PHASE 5: MISSIONS 2 TO 7 COMPLETE
- Clue cards: gold when the player finds them, silver when given by a fallback. A short card pops up with the clue text when found. Clue objects sparkle softly within 6 m.
- Evidence board viewer: opens at the end of M4 with three faces (Raju, Asha, Sunil) and the clues collected so far. After that it is in the pause menu. The accusation comes in Phase 6.
- Sunrise clock on the HUD, top centre: story time plus 'N min to spare'. It starts at 30. A failed mission costs 3, beating par adds 1, a wrong accusation costs 15. At 0 the M10 par times tighten by 20%. There is no game over.
- M3: a 90-second timer while a drone cuts through the Power House door, shown as sparks and a glowing line growing on the door.
- The player's face on the screens at the end of M3: render the player character's head to a 256x256 texture once at load with a portrait camera, and show it with the name and roll number on every campus screen. If there are no screen meshes, add simple glowing panels at the RIC, the Administration Block and the Cafeteria.
- M4: the three clue objects fade out over 90 seconds as the rain grows. Asha gives any faded clue as silver at the end.
- M5: the bubble level, built as the shared Bubble Level module from Phase 7 and used here first. Raju runs off along a scripted path when the server room comes up.
- M6: drone searchlights sweep the parks while the player fetches the books. Detection happens inside the light cone.
- M7: pulling the relay is a hold-to-pull action. All drones then drop 1 m, hang, and switch their lights to blue.
- Characters: if Sunil, Raju or Bahadur Dai have no model, reuse the base NPC model with different clothes. Sunil wears a yellow lanyard with a small red pen drive. Raju wears a grey hoodie.
- Cutscenes C3 to C6.
- Done when: M2 to M7 play through with no TODO_, and every clue in M2 to M7 can be found gold.

PHASE 6: EVIDENCE BOARD, MISSIONS 8 TO 10, ENDING
- The accusation in M9: tap a suspect, then drag one clue card onto each of three questions. Accepted clues: Q1 (who could reach the exam console at 6:55) c4 or c11. Q2 (whose hands were on the keyboard) c1, c12 or c14. Q3 (who knew too much or had a reason) c2 or c13. Wrong suspect: minus 15 minutes, MITRA shows the clearing clue (c7 for Raju, c9 and c10 for Asha), and the player tries again. Right suspect but a wrong clue: 'That does not prove it', try again, no penalty.
- Sunil's motorbike in M10: a simple low-poly motorbike (not the Vintage Motorbike landmark). It follows a path along the ring road to the main gate with rubber-banding: never more than 60 m ahead, never caught before the gate.
- The gate shuts on Sunil, his bike skids, and Bahadur Dai steps out of the dark and catches him (cutscene C9).
- M10 checkpoints after each part (firewall, modules, chase), so a failure restarts that part, not the whole mission.
- The remember-or-forget choice after the reboot. It changes only MITRA's last line in the ending.
- Cutscenes C7 to C10.
- Share card at the ending: a 1080x1350 image with the player's name, minutes to spare, total stars and the Hero of WRC title. A download button, plus the Web Share API where the browser supports it.
- Done when: the game plays from name entry to the share card with no TODO_.

PHASE 7: MINI-GAMES AND THE LONG WAIT
- One module per mini-game, all with the same interface: start(context), update(dt), finish() returning a result. Each lasts 30 to 60 seconds and can be skipped after its first play.
- Build: Signal Tuner (with the jammed version after M6), Chiya Rush (gives c13), Table Tennis with Raju, Bubble Level, Drone Hack (gives a scout drone that marks enemies in the next mission), Generator Pull-Start (gives one boost charge), Bug Hunt (also a daily challenge, with at least 10 C snippets), and the Garage after M2.
- The long wait after M9: free roam until the player walks into the Exam Section, which plays C8 and starts M10. If c13 is still missing, Krishna Dai repeats the gossip at the Cafeteria.
- Move the old story riddles onto memory shards as optional bonus riddles paid in coins.
- Done when: npm run check:story reports zero TODO_.

PHASE 8: SOUND, VOICE, PAR TIMES, PERFORMANCE, STRINGS
- Sound: save the SOUND DIRECTION section below as docs/SOUND.md, then build it.
- MITRA's voice: the browser's speech synthesis as version one (pitch 0.7 and rate 0.95 before the reboot, pitch 1.0 after), with an on/off setting. Keep it data-driven so any line can later be replaced by an audio file with the same id.
- Par times: play each mission cleanly with the debug tools, set par to your clean time x 1.4 rounded up to the next 5 seconds, and list them in docs/DECISIONS.md.
- Performance: with Chrome's mid-tier mobile CPU throttling, aim for 30 fps or better in the storm missions. Add Low, Medium and High quality presets (shadows, rain particles, draw distance, pixel ratio), chosen automatically on first launch and changeable in settings. Fix the three worst frame-time problems you find and list them.
- Strings: export every player-facing string, with its id and where it appears, to docs/STRINGS.md for my review.

PHASE 9: GRAPHICS, MOBILE, KALKI AND MENU
- Do the graphics, mobile, Kalki and menu work I asked for earlier in this project. Before starting, write what you understand that work to be into docs/PROGRESS.md. If you no longer have my original request, stop and ask me for it instead of guessing.

FINAL REPORT
When Phase 9 is done, reply with: what to open to test, two lines per phase on what was built, every decision from docs/DECISIONS.md, known issues, and what you would build next.

SOUND DIRECTION
Goal: sound tells the player where danger is, carries the mood of each act, and makes the campus feel like WRC at night.

System
- One AudioManager on the Three.js AudioListener, with five buses and a volume slider for each: music, ambience, sfx, voice, ui. Plus a master mute.
- Start the audio context on the first tap (name entry). Pause all audio when the tab is hidden.
- Positional audio for drones, Kalki, Sunil's motorbike, the temple bell and the generator. A drone is faintly audible from 40 m and loud within 10 m, so a player with headphones can hear which way it is.
- At most 16 sounds at once on Low quality. Preload each mission's sounds when it starts. MP3 files, under 6 MB of audio in total.
- Sources: synthesise UI sounds, MITRA's chirps and radio static with the Web Audio API. Take everything else from CC0 sources (for example Kenney's audio packs, or Freesound with the CC0 filter), or synthesise it. Record every file's source and licence in docs/AUDIO_CREDITS.md. No copyrighted music.

Music (adaptive layers, 1.5-second crossfades)
- Layers in every act: explore, stealth (a drone within 15 m), spotted (an alarm stinger plus percussion), chase (any Kalki or motorbike chase).
- Title and C1: a low drone, distant thunder, and MITRA's four-note motif on a bansuri-like flute.
- Act 1, missions 1 to 3, dusk: a tense synth pulse around 115 BPM over a madal-style hand-drum loop.
- Act 2, missions 4 to 7, storm: the music thins and the rain carries the scene. Slow pads around 90 BPM, plucked notes while investigating.
- Act 3, missions 8 to 10: build back up. The M10 chase is the fullest mix in the game, and MITRA's motif plays in full when the gate shuts.
- Ending: bright and warm, MITRA's motif in a major key, with birds and the fest crowd.
- Interludes: light and playful. Chiya Rush gets the most cheerful track.
- Silence is a tool: after C5 (Asha's radio dies) play only rain for 3 seconds. In C7 the music cuts out on Sunil's line 'You were supposed to be simple.'

Voices (no voice acting)
- MITRA: a three-tone chirp before every line. Act 1 cold and falling, Act 2 glitchy, after the reboot warm and rising.
- Everyone else: a radio blip, then a soft babble while the subtitle types, one pitch per character. Asha high and fast, Sunil warm and mid, Krishna Dai low and slow, Raju quick and wobbly, Bahadur Dai short and gruff. Sunil's pitch drops after the reveal.

Sound effects
- Drones: a hum that rises with speed, a scanning ping while searching, a two-tone alarm when they spot you, a cutting screech in M3, a power-down whine in M7, a friendly chirp once they turn blue.
- Kalki: an engine loop with pitch following speed, a boost whoosh, tyre skid on drifts, a thump on stunt humps, splashes through puddles in the storm.
- Sunil's motorbike: a higher, rattly engine whose pitch shifts as it passes.
- Gates: a heavy metal slam that echoes across campus (M1 and M10).
- Power: a deep clunk per block as the lights come back on, then a transformer hum.
- Weather: three rain layers (drizzle, heavy, storm). Rain sounds harder on tin roofs near the workshops and hostels and softer on leaves in the parks. Thunder follows each flash after 1 to 3 seconds. Wind gusts. A low rumble for the landslide.
- Night campus: frogs and crickets near the ground and parks, campus dogs barking far away now and then, a bus horn on Lamachaur Marg before 8 PM, one temple bell when the player first reaches Saraswati Temple, the generator hum near the Machining Workshop.
- Clues: a soft sparkle loop when near. A bright chime for gold, a duller one for silver.
- Evidence board: a pin pressed in, string stretching, a deep chord for the right answer, a clock ticking backwards for a wrong one.
- Sunrise clock: a quiet tick only when fewer than 10 minutes are left, plus a heartbeat under 5.
- Mini-games: cups clinking (Chiya Rush), ball pops (Table Tennis), the cord pull and cough-start (Generator), static that clears as the wave matches (Signal Tuner).
- Ending: dawn birds, a crowd cheer, and applause when the Campus Chief names the player.

Mixing
- Priority: voice and subtitles, then alarms, then music, then ambience.
- Music drops to 40% while a line is on screen and during cutscenes.
- Ambience drops during cutscenes, except the rain.
- The spotted stinger plays at most once every 4 seconds.
- Every important sound also has a visual cue: a spotted indicator, and an edge-of-screen arrow for a drone that is close but off screen. Subtitles are on by default.
