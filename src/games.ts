// Which games the install page offers and the installed app downloads.
// To bring a game back, set `enabled: true` (and update public/app.webmanifest's name,
// icons and shortcuts to match).

export interface GameEntry {
  id: 'campus' | 'forest';
  enabled: boolean;
  href: string;
  name: string;
  icon: string;
  tag: string;
  blurb: string;
  /** Files (or folders, ending in "/") under public/ that the game loads, including ones loaded mid-game. */
  assets: string[];
}

export const GAMES: GameEntry[] = [
  {
    id: 'campus',
    enabled: true,
    href: 'campus.html?source=app',
    name: 'Campus Quest',
    icon: 'icons/campus-512.png',
    tag: 'Adventure · Quiz',
    blurb: 'Explore IOE Pashchimanchal Campus, Pokhara. Solve each department’s challenge and graduate.',
    assets: [
      'assets/models/player/sumit_character.glb',
      // Quest props placed during levels (src/campus/quest.ts).
      'assets/models/binder_notebook/',
      'assets/models/metal_toolbox/',
      'assets/models/power_box_01/',
      'assets/foliage/',
      'assets/textures/pine_bark/',
      'assets/textures/bark_brown_02/',
      'assets/textures/concrete_floor_worn_001/',
      'assets/textures/corrugated_iron_02/',
    ],
  },
  {
    id: 'forest',
    enabled: false,
    href: 'forest.html?source=app',
    name: 'Poacher Panic',
    icon: 'icons/forest-512.png',
    tag: 'Mystery · Open world',
    blurb: 'A ranger has gone silent near Hollow Creek. Drive in, follow the clues, bring her home.',
    assets: ['assets/'],
  },
];

export const ENABLED_GAMES = GAMES.filter((g) => g.enabled);

export function isEnabled(id: GameEntry['id']): boolean {
  return GAMES.some((g) => g.id === id && g.enabled);
}
