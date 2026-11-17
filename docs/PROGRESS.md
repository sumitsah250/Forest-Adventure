# Progress

Building Story V2 to the plan in [BUILD_PLAN.md](BUILD_PLAN.md). Decisions are in [DECISIONS.md](DECISIONS.md).
Work is on the `story-v2` branch, one commit per phase.

## Done

### Phase 4: mission 1 complete, name entry, fest demo
- **Debug panel** (`?story=2&debug=1`, button at the bottom left): jump to any mission, all clues gold / silver / clear, minutes to spare, weather, time of day, skip cutscene, FPS and draw calls. `src/campus/debug.ts`.
- **`npm run test:smoke`**: opens every mission through the debug jump, 5 s each, fails on any console error. `scripts/smoke-test.mjs`.
- **Name and roll number** on first launch (story 2), saved, editable from the title menu ("Player: …"). The first tap starts the audio. `src/campus/screens.ts`.
- **Location card** at every mission start ("6:52 PM, RIC"), typed on, gone after 2.5 s.
- **Gate slam** at the end of M1: two iron gate leaves swing shut (they block the road while shut), the camera shakes, MITRA names the player over the campus speakers (cutscene `M1_GATE`).
- **MITRA's spotted lines**: 8 per act in `story/v2/text.ts`, never the same twice in a row, at most one every 6 s, plus an alarm stinger at most every 4 s.
- **Fest demo** (`?demo=1`): name entry, C1, M1, then the 10 best escape times. Hold the title for 3 s (or hold Delete) to clear the board. 30 s idle returns to the name screen. The demo never touches the player's save.

### Phase 5: missions 2 to 7, clues, evidence board, sunrise clock
- **Clues** (`src/campus/clues.ts`): gold or silver, a card slides in at the right, saved in the profile. c1 by tapping Sunil's lanyard in M2 ("Look closer", F key or tap), c2 by pinning Sunil's 6:55 line in the radio log (pause → Radio log → Pin). Missed clues come back silver from Asha at mission end (c1 and c2 quietly, at M9).
- **Evidence board** (`src/campus/evidence.ts`): pause → Evidence board, or automatically at the end of M4. Columns for Raju, Asha, Sunil and the hoodie, with portraits. The accuse mode (drag or tap cards onto three questions, red string, cold portrait = C7) is built and is wired into M9 in Phase 6.
- **Sunrise clock**: "N min to spare" at the top. Starts at 30; −3 per failed attempt, +1 for beating par. At 0 the M10 par times get tighter.
- **Third star** in clue missions = every clue of that mission gold.
- **M2**: Sunil's lanyard with the red pen-drive (c1).
- **M3**: 90 s puzzle timer with door-cut sparks at the Power House; C3 (power back, campus screens show your face as INTRUDER).
- **M4**: three clue objects (c4, c5, c14) fade as the rain grows (90 s); the board opens at the end. C4.
- **M5**: Bubble Level at the WRC parapet before the 36 keypad; C5 (static face); Raju runs to Table Tennis (c6).
- **M6**: three searchlight drones patrol the clue spots.
- **M7**: Bhurtyal sir at BP Park; hold E for 2.5 s to pull the relay; C6 (drones turn blue, c9).
- **Cutscenes**: C3, C4, C5, C6 with shot data.
- `node scripts/campus-test.mjs play low 2` plays story 2 from the name screen to the ending through the real UI (all 11 missions).

## Left
- Phase 6: M9 accusation on the board, motorbike chase, gate shut and Bahadur Dai (C9), M10 checkpoints and the final choice, C7 wiring, C8, C10, share card.
- Phases 7 to 9 (see BUILD_PLAN.md).

## How to test
- `npm run dev`, then `http://localhost:5173/campus.html?story=2`. A new browser profile (or a cleared save) shows the name screen first.
- Debug: `http://localhost:5173/campus.html?story=2&debug=1`, click DEBUG at the bottom left.
- Demo: `http://localhost:5173/campus.html?demo=1`.
- Checks: `npx tsc --noEmit`, `npm run build`, `npm run check:story`, `npm run test:smoke`.

## Next step
Phase 6: replace M9's `choose` step with an `accuse` step that opens `openBoard(..., { mode: 'accuse' })` (wrong suspect: −15 minutes and MITRA's clearing line), then the motorbike chase in M10.
