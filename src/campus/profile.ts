// The player's long-term progress in Campus Quest: story progress, stars and best times per
// mission, coins and XP (player level), Kalki's upgrades and paint jobs, memory shards,
// the time-trial record and the daily chiya streak. Kept in localStorage.

import type { KartUpgrades } from './kart.ts';
import { STORY_VERSION } from './story.ts';

const KEY = 'campus-blackout-profile-v1';

export interface Profile {
  version: 1;
  /** Missions completed in story order (the next one to play is this index). */
  story: number;
  /** Mission in progress (index) and its step, for Continue. */
  current: { mission: number; step: number } | null;
  stars: Record<string, number>;
  best: Record<string, number>;
  /** Time at the end of each step on the best run of each mission (for live splits). */
  splits: Record<string, number[]>;
  coins: number;
  xp: number;
  unlocks: string[];
  upgrades: KartUpgrades;
  paint: string;
  paints: string[];
  shards: number[];
  trialBest: number | null;
  daily: { last: string; streak: number };
  /** Lifetime stats for the title screen (and badges). */
  stats: { missions: number; seconds: number; answered: number; correct: number; turbos: number; jumps: number; coinsGrabbed: number; bestCombo: number; closeCalls: number };
  /** Bonus objectives completed per mission (ids from missions.ts). */
  bonus: Record<string, string[]>;
  /** Today's three daily goals and their progress. */
  goals: { day: string; list: { id: string; progress: number; done: boolean }[] };
  /** Badges earned (ids from meta.ts). */
  badges: string[];
  /**
   * Which story `story`, `current` and `unlocks` belong to (1: the sixteen missions, 2: the
   * ten-mission rewrite). The other story's progress waits in `parked` until it is played again.
   * Saves from before the rewrite have neither field and are story 1.
   */
  storyVersion: 1 | 2;
  parked: Record<string, { story: number; current: { mission: number; step: number } | null; unlocks: string[] }>;
  /** V2: what the player typed at the start (name entry is Phase 4; MITRA uses these). */
  name: string;
  roll: string;
  /** V2: clues found, gold (by the player) or silver (by Asha at mission end). */
  clues: Record<string, 'gold' | 'silver'>;
  /** V2: the sunrise clock's minutes to spare. */
  minutes: number;
  /** Lines heard over the radio or from MITRA, oldest first, to read again (the last 80). */
  radioLog: { m: string; who: string; text: string }[];
}

function fresh(): Profile {
  return {
    version: 1,
    story: 0,
    current: null,
    stars: {},
    best: {},
    splits: {},
    coins: 0,
    xp: 0,
    unlocks: [],
    upgrades: { engine: 0, grip: 0, boost: 0 },
    paint: 'crimson',
    paints: ['crimson'],
    shards: [],
    trialBest: null,
    daily: { last: '', streak: 0 },
    stats: { missions: 0, seconds: 0, answered: 0, correct: 0, turbos: 0, jumps: 0, coinsGrabbed: 0, bestCombo: 0, closeCalls: 0 },
    bonus: {},
    goals: { day: '', list: [] },
    badges: [],
    storyVersion: 1,
    parked: {},
    name: '',
    roll: '',
    clues: {},
    minutes: 30,
    radioLog: [],
  };
}

/** A new profile, already on the story being played. */
function started(): Profile {
  const p = fresh();
  p.storyVersion = STORY_VERSION;
  return p;
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return started();
    const p = { ...fresh(), ...(JSON.parse(raw) as Partial<Profile>) } as Profile;
    if (p.version !== 1) return started();
    p.upgrades = { ...fresh().upgrades, ...p.upgrades };
    p.stats = { ...fresh().stats, ...p.stats };
    activateStory(p, STORY_VERSION);
    return p;
  } catch {
    return started();
  }
}

/**
 * Makes `version` the story this profile is playing: the other story's progress is parked and
 * this one's is brought back (or starts fresh). Coins, XP, paints, upgrades, shards, records
 * and badges are shared by both stories.
 */
export function activateStory(p: Profile, version: 1 | 2): void {
  if (p.storyVersion === version) return;
  p.parked[String(p.storyVersion)] = { story: p.story, current: p.current, unlocks: p.unlocks };
  const back = p.parked[String(version)];
  p.story = back?.story ?? 0;
  p.current = back?.current ?? null;
  p.unlocks = back?.unlocks ?? [];
  delete p.parked[String(version)];
  p.storyVersion = version;
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lasts for this session only */
  }
}

export function resetStory(p: Profile): void {
  // A new story keeps what was earned (coins, upgrades, paints, shards, records).
  p.story = 0;
  p.current = null;
  p.clues = {};
  p.minutes = 30;
  p.radioLog = [];
}

export function has(p: Profile, unlock: string): boolean {
  return p.unlocks.includes(unlock);
}

// ------------------------------------------------------------------ levels

/** XP needed to go from level n to n + 1. */
export function xpForLevel(n: number): number {
  return 200 + (n - 1) * 120;
}

export function levelOf(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = xp;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level += 1;
  }
  return { level, into: rest, need: xpForLevel(level) };
}

export const TITLES = ['Fresher', 'First Semester', 'Lab Rat', 'Night Owl', 'Circuit Breaker', 'Debugger', 'Kart Racer', 'Senior', 'Campus Legend', 'Hero of WRC'];

export function titleFor(level: number): string {
  return TITLES[Math.min(TITLES.length - 1, Math.floor((level - 1) / 2))];
}

// ------------------------------------------------------------------ daily

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Claims today's chiya-streak reward once per calendar day; null if already claimed. */
export function claimDaily(p: Profile, now = new Date()): { streak: number; coins: number } | null {
  const today = dayKey(now);
  if (p.daily.last === today) return null;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  const streak = p.daily.last === dayKey(y) ? p.daily.streak + 1 : 1;
  const coins = 50 + Math.min(streak - 1, 6) * 25;
  p.daily = { last: today, streak };
  p.coins += coins;
  return { streak, coins };
}

// ------------------------------------------------------------------ stars

/** 1 star for finishing, +1 for no hearts lost, +1 for beating the par time. */
export function starsFor(heartsLost: number, seconds: number, par: number): number {
  return 1 + (heartsLost === 0 ? 1 : 0) + (seconds <= par ? 1 : 0);
}
