// Reasons to come back: three daily goals (new ones every calendar day, the same for
// everyone on that day) and badges for lifetime milestones. Both live in the profile.

import { MISSIONS } from './story.ts';
import { dayKey, levelOf, type Profile } from './profile.ts';

/** Things the game reports as they happen; daily goals count them. */
export type GoalEvent = 'coin' | 'turbo' | 'jump' | 'correct' | 'shard' | 'mission' | 'threeStar' | 'ring' | 'closeCall' | 'bonus';

interface GoalDef {
  id: string;
  event: GoalEvent;
  target: number;
  text: string;
}

const GOALS: GoalDef[] = [
  { id: 'coins12', event: 'coin', target: 12, text: 'Grab 12 bonus coins' },
  { id: 'turbo5', event: 'turbo', target: 5, text: 'Fire 5 drift mini-turbos in Kalki' },
  { id: 'jump3', event: 'jump', target: 3, text: 'Land 3 jumps in Kalki' },
  { id: 'correct8', event: 'correct', target: 8, text: 'Answer 8 questions or riddles right' },
  { id: 'shard2', event: 'shard', target: 2, text: 'Find 2 memory shards' },
  { id: 'mission2', event: 'mission', target: 2, text: 'Finish 2 missions (replays count)' },
  { id: 'star1', event: 'threeStar', target: 1, text: 'Earn ★★★ on any mission' },
  { id: 'ring20', event: 'ring', target: 20, text: 'Drive through 20 rings' },
  { id: 'close2', event: 'closeCall', target: 2, text: 'Have 2 close calls with a drone' },
  { id: 'bonus2', event: 'bonus', target: 2, text: 'Complete 2 bonus objectives' },
];

const GOAL_COINS = 75;
const GOAL_XP = 30;
const ALL_GOALS_COINS = 150;

export interface GoalView {
  text: string;
  progress: number;
  target: number;
  done: boolean;
}

/** Seeded pick of three different goals for a day. */
function goalsFor(day: string): GoalDef[] {
  let h = 2166136261;
  for (const ch of day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pool = GOALS.slice();
  const out: GoalDef[] = [];
  while (out.length < 3) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0]);
  }
  return out;
}

/** Makes sure the profile holds today's goals (a new day replaces yesterday's). */
export function refreshGoals(p: Profile, now = new Date()): void {
  const day = dayKey(now);
  if (p.goals.day === day && p.goals.list.length === 3) return;
  p.goals = { day, list: goalsFor(day).map((g) => ({ id: g.id, progress: 0, done: false })) };
}

export function goalViews(p: Profile): GoalView[] {
  refreshGoals(p);
  return p.goals.list.map((g) => {
    const d = GOALS.find((x) => x.id === g.id)!;
    return { text: d.text, progress: Math.min(g.progress, d.target), target: d.target, done: g.done };
  });
}

/**
 * Counts an event toward today's goals. Pays out goals that complete and returns their
 * announcements (the caller saves the profile).
 */
export function trackGoal(p: Profile, e: GoalEvent, n = 1): string[] {
  refreshGoals(p);
  const out: string[] = [];
  for (const g of p.goals.list) {
    const d = GOALS.find((x) => x.id === g.id);
    if (!d || g.done || d.event !== e) continue;
    g.progress += n;
    if (g.progress >= d.target) {
      g.done = true;
      p.coins += GOAL_COINS;
      p.xp += GOAL_XP;
      out.push(`Daily goal: ${d.text}  +${GOAL_COINS}◈`);
      if (p.goals.list.every((x) => x.done)) {
        p.coins += ALL_GOALS_COINS;
        out.push(`All 3 daily goals!  +${ALL_GOALS_COINS}◈`);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ badges

interface BadgeDef {
  id: string;
  icon: string;
  name: string;
  how: string;
  test: (p: Profile) => boolean;
}

/** Stars in the story being played (the other story's stars stay in the save but do not count). */
export const starsTotal = (p: Profile) => MISSIONS.reduce((a, m) => a + (p.stars[m.id] ?? 0), 0);
const HALF = Math.ceil(MISSIONS.length / 2);
const bonusTotal = (p: Profile) => Object.values(p.bonus).reduce((a, b) => a + b.length, 0);

export const BADGES: BadgeDef[] = [
  { id: 'first', icon: '🔦', name: 'Lights Out', how: 'Finish Mission 1', test: (p) => p.story >= 1 },
  { id: 'half', icon: '⚡', name: 'Half the Grid', how: `Finish ${HALF} missions`, test: (p) => p.story >= HALF },
  { id: 'hero', icon: '🏆', name: 'Hero of WRC', how: 'Finish the story', test: (p) => p.story >= MISSIONS.length },
  { id: 'star10', icon: '★', name: 'Rising Star', how: 'Collect 10 stars', test: (p) => starsTotal(p) >= 10 },
  { id: 'star30', icon: '✦', name: 'Constellation', how: 'Collect 30 stars', test: (p) => starsTotal(p) >= 30 },
  { id: 'starAll', icon: '🌟', name: 'Topper', how: `All ${MISSIONS.length * 3} stars`, test: (p) => starsTotal(p) >= MISSIONS.length * 3 },
  { id: 'perfect', icon: '💯', name: 'Flawless', how: 'Earn ★★★ on a mission', test: (p) => MISSIONS.some((m) => (p.stars[m.id] ?? 0) >= 3) },
  { id: 'bonus10', icon: '◇', name: 'Overachiever', how: 'Complete 10 bonus objectives', test: (p) => bonusTotal(p) >= 10 },
  { id: 'shard12', icon: '◆', name: 'Memory Lane', how: 'Find 12 memory shards', test: (p) => p.shards.length >= 12 },
  { id: 'shardAll', icon: '💎', name: 'Total Recall', how: 'Find all 24 memory shards', test: (p) => p.shards.length >= 24 },
  { id: 'lv5', icon: '🎓', name: 'Senior Moment', how: 'Reach level 5', test: (p) => levelOf(p.xp).level >= 5 },
  { id: 'lv10', icon: '👑', name: 'Campus Legend', how: 'Reach level 10', test: (p) => levelOf(p.xp).level >= 10 },
  { id: 'gold', icon: '🥇', name: 'Ring Road Rocket', how: 'Gold in the time trial', test: (p) => p.trialBest !== null && p.trialBest <= 52 },
  { id: 'turbo50', icon: '🔥', name: 'Drift King', how: 'Fire 50 mini-turbos', test: (p) => p.stats.turbos >= 50 },
  { id: 'combo8', icon: '⛓', name: 'Chain Reaction', how: 'Reach a ×8 combo', test: (p) => p.stats.bestCombo >= 8 },
  { id: 'brain50', icon: '🧠', name: 'Gold Medallist', how: 'Answer 50 questions right', test: (p) => p.stats.correct >= 50 },
  { id: 'ghost', icon: '👻', name: 'Ghost Protocol', how: 'Have 10 close calls with drones', test: (p) => p.stats.closeCalls >= 10 },
  { id: 'chiya', icon: '☕', name: 'Chiya Regular', how: 'A 7-day chiya streak', test: (p) => p.daily.streak >= 7 },
];

/** Newly earned badges (added to the profile; the caller saves it). */
export function checkBadges(p: Profile): BadgeDef[] {
  const out: BadgeDef[] = [];
  for (const b of BADGES) {
    if (p.badges.includes(b.id) || !b.test(p)) continue;
    p.badges.push(b.id);
    out.push(b);
  }
  return out;
}

export interface BadgeView {
  icon: string;
  name: string;
  how: string;
  earned: boolean;
}

export function badgeViews(p: Profile): BadgeView[] {
  return BADGES.map((b) => ({ icon: b.icon, name: b.name, how: b.how, earned: p.badges.includes(b.id) }));
}
