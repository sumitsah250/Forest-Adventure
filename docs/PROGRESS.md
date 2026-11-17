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

## Left
Phases 5 to 9 (see BUILD_PLAN.md).

## How to test
- `npm run dev`, then `http://localhost:5173/campus.html?story=2`. A new browser profile (or a cleared save) shows the name screen first.
- Debug: `http://localhost:5173/campus.html?story=2&debug=1`, click DEBUG at the bottom left.
- Demo: `http://localhost:5173/campus.html?demo=1`.
- Checks: `npx tsc --noEmit`, `npm run build`, `npm run check:story`, `npm run test:smoke`.

## Next step
Phase 5: clue cards and tracking (`src/campus/clues.ts`), the evidence board viewer, the sunrise clock, then M2 to M7 in order.
