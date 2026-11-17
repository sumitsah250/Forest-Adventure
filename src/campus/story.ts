// The Campus Quest story: which version is playing, and its data.
//
// There are two stories while V2 is being built:
//   1  the original sixteen missions            (story/v1.ts)
//   2  the ten-mission rewrite, docs/STORY_V2.md (story/v2/)
//
// Every other file imports the story from here, so switching version needs no other change.
// Pick one in the address bar with ?story=1 or ?story=2; otherwise DEFAULT_STORY_VERSION plays.

import * as v1 from './story/v1.ts';
import * as v2 from './story/v2/index.ts';
import { CUTSCENES as V2_CUTSCENES } from './story/v2/cutscenes.ts';
import type { ClueDef, CutsceneDef } from './story/types.ts';

export type { Anchor, ClueDef, ClueId, CutEvent, CutsceneDef, CutsceneId, Ease, ItemDef, ItemModel, MissionDef, NpcDef, PuzzleDef, ShotDef, Sky, Step, TodoId, Where } from './story/types.ts';
export { KART_HOME, TRIAL_MEDALS, TRIAL_ROUTE } from './story/routes.ts';

/** Flip to 2 when V2 is ready to be the game people get. */
export const DEFAULT_STORY_VERSION: 1 | 2 = 1;

const query = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

/** ?demo=1: the fest stall build. Name entry, C1 and mission 1 only, then a leaderboard. Never saves. */
export const DEMO_MODE = query.get('demo') === '1';
/** ?debug=1: the developer panel (debug.ts). */
export const DEBUG_MODE = query.get('debug') === '1';

function pickVersion(): 1 | 2 {
  if (DEMO_MODE) return 2;
  const q = query.get('story');
  return q === '1' ? 1 : q === '2' ? 2 : DEFAULT_STORY_VERSION;
}

export const STORY_VERSION: 1 | 2 = pickVersion();
/** Story 2's text (for screens and lines that only exist in story 2). */
export const V2_TEXT = v2.T;
/** The clues (story 2; story 1 has none). */
export const CLUES: ClueDef[] = STORY_VERSION === 2 ? v2.CLUES : [];

const story = STORY_VERSION === 2 ? v2 : v1;

export const MISSIONS = story.MISSIONS;
/** How many of MISSIONS are missions; anything after them is the epilogue (story 2's ending). */
export const MISSION_COUNT = STORY_VERSION === 2 ? v2.MISSION_COUNT : v1.MISSIONS.length;
export const NPCS = story.NPCS;
export const VOICES = story.VOICES;
export const WEATHER = story.WEATHER;
/** The pitch on the title screen (may contain <b>). */
export const STORY_BLURB = story.STORY_BLURB;
/** Share of campus (0..1) with its power back once `story` missions are finished. */
export const powerLevel = story.powerLevel;
/** Cutscene shot data by id (story 1 has none; its mission intros are built in main.ts). */
export const CUTSCENES: Partial<Record<string, CutsceneDef>> = STORY_VERSION === 2 ? V2_CUTSCENES : {};
/** Words on the fest banner over the main gate (story 2 only). */
export const FEST_BANNER: { title: string; sub: string } | null = STORY_VERSION === 2 ? { title: v2.T.props.festBanner, sub: v2.T.props.festBannerSub } : null;
