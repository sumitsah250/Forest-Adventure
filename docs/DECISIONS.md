# Decisions

Choices made while building Story V2 where the spec ([STORY_V2.md](STORY_V2.md)) left a gap. Each keeps the hidden truth (section 2) consistent and the mystery fair. Your four decisions from [BUILD_PLAN.md](BUILD_PLAN.md) come first.

## Made by you

1. **M4 has three clue objects**: c4 (yellow lanyard strap, Auditorium), c5 (grey hoodie thread, MSC Hostel fence) and the new c14 (red pen-drive cap, NESS WRC steps). c3 stays Krishna Dai's statement. Question 2 of the accusation also accepts c14.
2. **c1 and c2 are never announced.** c1 turns gold by tapping Sunil's lanyard during the M2 meeting; c2 by pinning Sunil's "6:55" line from the radio log to the board. If missed, both appear on the board as silver cards with no dialogue. Asha announces every other missed clue at mission end.
3. **c9 and c10 are always gold**, given by C6 and at the end of M8.
4. **Order**: story phases 4 to 8 first, then graphics, mobile, Kalki and menu as Phase 9.

## Made while building

| # | Gap | Decision |
|---|---|---|
| 5 | Which story plays without `?story=` | Story 1 stays the default until you say otherwise (deleting or replacing it cannot be undone). `?story=2` plays V2, and `?demo=1` always plays V2. |
| 6 | Portraits | Rendered once at load from each character's in-game 3D model. No art files. |
| 7 | BP Park has no job in M7 (AUDIT conflict 5) | Bhurtyal sir waits for the player at BP Park instead of at his department. |
| 8 | Power in V2 | Dies at 6:52 PM (C1), comes back all at once at the end of M3 (C3), and stays on. |
| 9 | Where the main gate stands open or shut | Open until the slam at the end of M1. Shut from M2 to M9. In M10 Sunil opens it from his phone as he flees (decision 30), so it stands open during the chase until MITRA shuts it (C9). It opens for good in the ending (C10). |
| 10 | When c1 and c2 become silver if missed | Quietly, when M9 starts, so they are on the board before the accusation. |
| 11 | Third star in clue missions | Every clue of that mission gold replaces the par-time condition (no hearts lost is still needed). Beating par still earns +1 minute to spare. Clue missions are M2, M3, M4, M5, M6 and M9. M7 and M8 give their clues gold automatically, so they use the normal rule. |
| 12 | The campus screens | Show the player's face, name, roll number and "INTRUDER" from the end of M3 until the culprit is named in M9, then "CASE REOPENED" until the reboot, then "HERO OF WRC". |
| 13 | Scout drone (Drone Hack reward) | In the next mission, every enemy drone is marked on the minimap and gets an edge-of-screen arrow. |
| 14 | Boost charge (Generator reward) | One free refill of Kalki's boost meter, used automatically the first time the meter runs empty. |
| 15 | M10 has four parts | Checkpoints at the start of the firewall, modules and chase parts (and the reboot). A failure restarts the current part, not the mission. |
| 16 | Bubble level controls | Drag on touch, arrow keys or A/D on keyboard. Phone tilt is not used (it needs a permission prompt on iPhones). |
| 17 | Interludes (mini-games between missions) | They start straight after the mission-complete screen, with a short location card, and do not need a walk. The first play is part of the story; after that each has a Skip button. All are replayable from the pause menu. |
| 18 | The long-wait gossip | If c13 is still missing after M9, Krishna Dai at the Cafeteria tells it when the player talks to him, as a gold clue. |
| 19 | Story time on the sunrise clock | Starts at the mission's clock and moves one story minute for every 6 seconds of play, never past the next mission's start. |
| 20 | Sunil's motorbike rider | Built from simple shapes in Sunil's colours with a helmet. The walking characters have no riding pose. |
| 21 | When MITRA's "spotted" lines play | When a drone's alarm first passes 60% (searchlights, the M1 pursuer, sweeping drones). Never more than one every 6 seconds, and never the same line twice in a row. |
| 22 | Fest demo saves | Demo mode never writes the player's save. Each player starts fresh; only the leaderboard is kept. |
| 23 | C7 (the red string) | Played on the evidence board itself, not as a 3D cutscene: the string draws from the culprit's portrait through the three cards, then the portrait goes cold. |
| 24 | M3 puzzle timer runs out | The puzzle closes, the player loses a heart and tries again; the door-cut sparks keep going while the timer runs. |
| 25 | M4 rain fade | Each uncollected clue object fades over 90 s once the rain starts. A clue that fades is picked up later as silver by Asha at mission end, so the story always moves on. |
| 26 | Minutes to spare | Start at 30. A failed attempt costs 3, beating par gives 1 back, a wrong accusation costs 15. At 0 or below, M10's par times are 20% tighter. |
| 27 | The campus screens in V2 | Four wall screens (RIC, Administration Block, Cafeteria, Power House) share one canvas texture, redrawn only when the text or mode changes. They are dark until the power returns in C3. |
| 28 | C7 length | About 5 s on the board (string, then the cold portrait) instead of the spec's 12 s: it is a UI moment, and the board has no camera to move. Sunil's cold line follows straight after on the radio. |
| 29 | Sunil's motorbike chase | It waits on the east ring road until Kalki is within 45 m. It never gets more than 60 m ahead (it stops and waits), speeds up when Kalki is within 12 m, and cannot be caught; the chase ends when it reaches the gate road, then C9. The 120 s timer still applies. |
| 30 | Who opens the gate in M10 | Sunil, from his phone, as the chase starts (the gate swings open over 1.6 s). MITRA shuts it in C9. |
| 31 | Bahadur Dai at the gate | He waits just inside the main gate for all of M10 (the guard's place at dawn). After C9 the player talks to him; he takes the pen drive off Sunil and hands it over, which leads into the reboot part. |
| 32 | Checkpoints | A `checkpoint` step marks the start of each M10 part. A failure restarts at the last checkpoint ("Retry this part") and still costs 3 minutes. Restarting from the pause menu still restarts the whole mission. |
| 33 | The final choice | Stored in the save (`choices.mitraMemory`). It picks MITRA's last line in M10 and the line under the stars on the share card; nothing else changes. |
| 34 | Credits | Rolled during the last shot of C10, from `ending.credits` in text.ts. They name the campus as the setting and say the story is fiction, so nobody reads it as an official campus production. |
| 35 | Share card | 1080 × 1350 PNG drawn on a canvas: name, roll number, portrait, minutes to spare, total stars and the MITRA line. Download always; Share only where the browser can share files. |
| 36 | Interlude rewards | Coins only for the first win of each mini-game (replays are for fun), plus Bug Hunt's daily snippet once a day. Chiya Rush gives c13 on a win. The scout drone is only earned in the story, not from menu replays. The boost charge is capped at one. |
| 37 | Garage after M2 | An interlude like the others: Asha's line, the existing garage screen, her outro. |
| 38 | Where Bug Hunt is played | From the pause menu (Mini-games), with no walk to the department, like every replay. The daily snippet is picked by date, so everyone gets the same one on the same day. 12 snippets. |
| 39 | Drone Hack | The existing Simon light-pattern puzzle, five lights. |
| 40 | The long wait | After M9 the HUD says to walk to the Exam Section, with a map marker. Coming within 8 m starts M10 (C8 first). A save made during the long wait resumes it. |
| 41 | Shard riddles | Each memory shard opens the next unsolved old-story riddle (7 in all) if none is open; MITRA reads it out. Its answer is a real place, hidden until the player is within 16 m. Solving one pays 60 coins. |
| 42 | Losing Chiya Rush | No c13 then; Krishna Dai repeats the gossip during the long wait (decision 18), and Q3 of the accusation also accepts c2, which is always on the board by M9. |
| 43 | Scout drone display | Drones show as red dots on the minimap in Phase 7; the edge-of-screen arrows come with the visual sound cues in Phase 8. |
| 44 | Help when stuck (asked for by you) | The accusation: after 2 failed tries a hint points at the culprit's column, after 3 the fitting cards glow, after 4 a 'Solve it for me' button appears. Each failure on a mission step gives 50% more time on that step next try (up to double). After 2 failures on a puzzle, its card has a Skip button (a skipped puzzle counts as passed). If a mission fails on a step that has failed twice, 'Skip this part' is offered next to Retry. Every mini-game between missions can be skipped (a skip is not a win, so no reward). |
| 45 | More realistic characters (asked for by you) | NPCs (procedural humanoid): head 6% larger, slimmer neck shaded under the jaw, squarer jaw with a broad chin, a defined nose; eyeballs with a brown iris, pupil and catch-light; softer brows, lips and stubble; hairline raised to a natural forehead, strand-textured hair, no spike cards on the hairline, swept-back styles close to the head; finer cloth weave; casual tops hang over the waistband (no belt), a real hood on hoodies (`hood: false` for plain sweaters), shaped shoe soles, straps that follow the chest. Skin, hair and eyes use the physical material except on the low preset. The player's own scanned model is unchanged. |
| 46 | RIC entrance and windows (asked for by you) | The two mapped stairways at the RIC door and the small door steps between them become one wide staircase: a stone porch at floor level, 15 cm steps with dark nosings, plastered cheek walls with a stone coping and a steel handrail each side (any walk-in building whose door meets mapped stairways gets the same). People wait on the porch. The RIC's windows are real: the glass panes of the wall texture are cut out (frames and bars stay), with tinted glass, reveals through the wall and stone sills, so you can see in from outside and out from inside. Other buildings keep painted windows (they have no interiors). |
| 47 | Both stories live (asked for by you) | The title screen has a "Choose your story" switch: Lockdown Night (the original, 16 missions) and Blackout at WRC (the new story, 10 missions). Picking one reloads into it and is remembered in the browser; `?story=1` / `?story=2` in the address still win. Each story keeps its own progress (profile.ts parks the other). Story 1 stays the default for first-time players. |
