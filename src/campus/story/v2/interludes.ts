// V2 interludes: the mini-games between missions (docs/STORY_V2.md section 8, decision 17).
// Each starts straight after its mission's complete screen, with a location card and a few
// lines, then the game. The first play is part of the story; later plays offer Skip. All are
// replayable from the pause menu (Mini-games). Bug Hunt is free roam only, with a daily snippet.
//
// Text for the games' own UI is in text.ts (T.mini); everything an interlude says is here.

import type { ClueId } from '../types.ts';

export type InterludeGame = 'tuner' | 'tunerJammed' | 'pong' | 'bubble' | 'hack' | 'generator' | 'bughunt' | 'garage';

export interface InterludeDef {
  id: string;
  /** The mission it follows (null: free roam only). */
  after: string | null;
  title: string;
  /** Location card: clock and place. */
  clock: string;
  place: string;
  game: InterludeGame;
  /** The instruction line under the title on the game card. */
  clue: string;
  /** Who speaks before and after (a cast id), and what they say. */
  from: string;
  intro: string[];
  win: string[];
  lose: string[];
  reward: { coins: number; clue?: ClueId; scout?: boolean; boostCharge?: boolean };
}

export const INTERLUDES: InterludeDef[] = [
  {
    id: 'tuner', after: 'v2-lights-out', title: 'Signal Tuner', clock: '7:02 PM', place: 'RIC LAWN', game: 'tuner',
    clue: 'Match the wave with the dial to pick up the next call.',
    from: 'asha',
    intro: ['MITRA scrambled the campus channel. Tune the handset to my wave.', 'Turn the dial until the two lines sit on top of each other.'],
    win: ['Got you, loud and clear. Head for the Automobile Club.'],
    lose: ['Static on my end too. We will manage, head for the Automobile Club.'],
    reward: { coins: 40 },
  },
  {
    id: 'garage', after: 'v2-pit-stop', title: 'Garage', clock: '7:25 PM', place: 'AUTOMOBILE CLUB', game: 'garage',
    clue: 'Upgrades and paint for Kalki.',
    from: 'asha',
    intro: ['Kalki earns her keep. Spend your coins on her before the next job.'],
    win: ['She looks good. Now, the Power House.'],
    lose: ['She looks good. Now, the Power House.'],
    reward: { coins: 0 },
  },
  {
    id: 'pong', after: 'v2-witness', title: 'Table Tennis with Raju', clock: '8:10 PM', place: 'TABLE TENNIS HALL', game: 'pong',
    clue: 'First to five. Raju plays fast but leaves the corners open.',
    from: 'raju',
    intro: ['Everyone is chasing ghosts tonight. One game before the storm?', 'First to five. Loser buys chiya.'],
    win: ['Okay, okay, I owe you a chiya. Good luck out there.'],
    lose: ['Ha, chiya is on you! Good luck out there.'],
    reward: { coins: 50 },
  },
  {
    id: 'bubble', after: 'v2-landslide', title: 'Bubble Level', clock: '8:40 PM', place: 'DEPT. OF CIVIL ENGINEERING', game: 'bubble',
    clue: 'Tilt the vial to centre the bubble and hold it for 3 seconds.',
    from: 'asha',
    intro: ['Civil wants the dumpy level back, calibrated. One more steady hand, please.'],
    win: ['Perfect. They will never know it went out in the storm.'],
    lose: ['Close enough for tonight. On to the library.'],
    reward: { coins: 50 },
  },
  {
    id: 'tunerJammed', after: 'v2-shelves', title: 'Signal Tuner: jammed', clock: '9:10 PM', place: 'WRC LIBRARY', game: 'tunerJammed',
    clue: 'The wave drifts. Keep the dial on it.',
    from: 'sumit',
    intro: ['Asha has gone quiet. MITRA is jamming every channel but one.', 'Find my wave and hold it. I will talk you to the relay.'],
    win: ['There you are. Stay on this channel and listen closely.'],
    lose: ['I can barely hear you. Head for the GNSS station anyway.'],
    reward: { coins: 50 },
  },
  {
    id: 'hack', after: 'v2-signal', title: 'Drone Hack', clock: '10:00 PM', place: 'SARASWATI TEMPLE', game: 'hack',
    clue: 'Repeat the drone\'s light pattern to take it over.',
    from: 'mitra',
    intro: ['This unit is frozen and listening. Repeat its pattern and it is yours for a while.'],
    win: ['Scout drone online. It will mark my other units on your map.'],
    lose: ['Pattern rejected. The unit powers down.'],
    reward: { coins: 40, scout: true },
  },
  {
    id: 'generator', after: 'v2-runaway', title: 'Generator Pull-Start', clock: '11:05 PM', place: 'MACHINING WORKSHOP', game: 'generator',
    clue: 'Pull the cord in rhythm, three times in a row.',
    from: 'asha',
    intro: ['The workshop generator can charge Kalki\'s boost cell.', 'Pull the cord when the marker hits green. Three good pulls.'],
    win: ['It caught! One full boost charge is stored in Kalki.'],
    lose: ['It is a stubborn old thing. We will do without.'],
    reward: { coins: 40, boostCharge: true },
  },
  {
    id: 'bughunt', after: null, title: 'Bug Hunt', clock: 'TODAY', place: 'DEPT. OF ELECTRONICS AND COMPUTER', game: 'bughunt',
    clue: 'Find the bug in six lines of C, in 30 seconds.',
    // Not Tiwari sir: real staff appear only in their own mission.
    from: 'asha',
    intro: ['The department posts a new snippet every day. Find the bug before the bell.'],
    win: ['Sharp eyes. Same time tomorrow?'],
    lose: ['Read it again slowly, then try tomorrow\'s.'],
    reward: { coins: 80 },
  },
];

/**
 * Bug Hunt snippets: six lines of C each, one wrong line (`bug`, 0-based), and why. The daily
 * challenge picks one by date; replays pick at random.
 */
export const BUG_SNIPPETS: { lines: string[]; bug: number; why: string }[] = [
  { lines: ['int sum = 0;', 'for (int i = 0; i < 10; i++)', '    sum += i;', 'float avg = sum / 10;', 'printf("%f", avg);', 'return 0;'], bug: 3, why: 'sum / 10 is integer division; write sum / 10.0f.' },
  { lines: ['char name[5];', 'strcpy(name, "Pokhara");', 'printf("%s", name);', 'int n = strlen(name);', 'printf("%d", n);', 'return 0;'], bug: 1, why: '"Pokhara" needs 8 bytes; name only has 5.' },
  { lines: ['int *p = malloc(sizeof(int) * 4);', 'for (int i = 0; i < 4; i++)', '    p[i] = i * i;', 'free(p);', 'printf("%d", p[2]);', 'return 0;'], bug: 4, why: 'p is used after free(p).' },
  { lines: ['int x = 7;', 'if (x = 5)', '    puts("five");', 'else', '    puts("not five");', 'return 0;'], bug: 1, why: 'x = 5 assigns; compare with x == 5.' },
  { lines: ['int a[3] = {1, 2, 3};', 'int total = 0;', 'for (int i = 1; i <= 3; i++)', '    total += a[i];', 'printf("%d", total);', 'return 0;'], bug: 2, why: 'Arrays start at 0: loop i = 0; i < 3.' },
  { lines: ['FILE *f = fopen("marks.txt", "r");', 'int m;', 'fscanf(f, "%d", m);', 'printf("%d", m);', 'fclose(f);', 'return 0;'], bug: 2, why: 'fscanf needs the address: &m.' },
  { lines: ['int fact(int n) {', '    if (n == 0) return 1;', '    return n * fact(n);', '}', 'printf("%d", fact(5));', 'return 0;'], bug: 2, why: 'fact(n) never gets smaller; it should be fact(n - 1).' },
  { lines: ['char c = getchar();', 'switch (c) {', '    case \'y\': puts("yes");', '    case \'n\': puts("no"); break;', '}', 'return 0;'], bug: 2, why: 'case \'y\' falls through to "no"; it needs a break.' },
  { lines: ['unsigned int n = 0;', 'n = n - 1;', 'if (n < 0)', '    puts("negative");', 'printf("%u", n);', 'return 0;'], bug: 2, why: 'An unsigned int is never below 0; n wraps to a huge number.' },
  { lines: ['int i = 0;', 'while (i < 5);', '{', '    printf("%d", i);', '    i++;', '}'], bug: 1, why: 'The ; after while makes an empty loop that never ends.' },
  { lines: ['double r = 2.5;', 'double area = 3.14159 * r ^ 2;', 'printf("%.2f", area);', 'int k = (int) area;', 'printf("%d", k);', 'return 0;'], bug: 1, why: '^ is XOR in C, not a power; use r * r.' },
  { lines: ['char s[] = "exam";', 'char *t = s;', 'if (s == "exam")', '    puts("same");', 'printf("%s", t);', 'return 0;'], bug: 2, why: '== compares addresses; use strcmp(s, "exam") == 0.' },
];
