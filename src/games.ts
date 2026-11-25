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
  /** Install page: the story's name, where it is set and a longer intro. */
  story?: string;
  place?: string;
  intro?: string;
  /** Install page: the in-game trailer filmed by `npm run trailer` (files under public/). */
  trailer?: Trailer;
  /** Install page: moments of the story on a timeline, each with a still from the trailer. */
  beats?: StoryBeat[];
  /** Files (or folders, ending in "/") under public/ that the game loads, including ones loaded mid-game. */
  assets: string[];
}

export interface Trailer {
  video: string;
  poster: string;
  /** One per shot of scripts/capture-trailer.mjs, in film order: the story clock and caption shown while it plays,
   *  and a still of it for browsers that can't play the video. Shot start times come from src/launcher/trailer.json. */
  scenes: { shot: string; clock: string; line: string; still: string }[];
}

export interface StoryBeat {
  clock: string;
  /** Which sky the moment is under; tints its clock. */
  sky: 'dusk' | 'night' | 'dawn';
  title: string;
  place: string;
  text: string;
  still: string;
  alt: string;
}

const TRAILER = 'assets/trailer/';

export const GAMES: GameEntry[] = [
  {
    id: 'campus',
    enabled: true,
    href: 'campus.html?source=app',
    name: 'Campus Quest',
    icon: 'icons/campus-512.png',
    tag: 'Story · Dune buggy · Puzzles',
    blurb: 'Blackout at WRC: the campus AI has locked IOE Pashchimanchal. One night, sixteen missions and a dune buggy called Kalki.',
    story: 'Blackout at WRC',
    place: 'IOE Pashchimanchal Campus, Lamachaur, Pokhara',
    intro: 'The night before the tech fest, the campus AI locks every gate and seizes the exam server. Drive Kalki, crack puzzles, dodge drones and find who did it before the paper leaks at 9 AM.',
    // Filmed in the game itself; re-film with `npm run trailer` after map or lighting changes.
    trailer: {
      video: `${TRAILER}campus-trailer.webm`,
      poster: `${TRAILER}poster.webp`,
      scenes: [
        { shot: 'arrival', clock: '5:40 PM', line: 'Pokhara, the evening before the tech fest.', still: `${TRAILER}still-campus.webp` },
        { shot: 'gate', clock: '6:20 PM', line: 'IOE Pashchimanchal Campus, Lamachaur.', still: `${TRAILER}still-gate.webp` },
        { shot: 'kalki', clock: '6:45 PM', line: 'Meet Kalki, the campus dune buggy.', still: `${TRAILER}still-kalki.webp` },
        { shot: 'dusk', clock: '6:52 PM', line: 'MITRA, the campus AI, cuts the power and locks every gate.', still: `${TRAILER}still-dusk.webp` },
        { shot: 'storm', clock: '8:20 PM', line: 'Then the monsoon breaks.', still: `${TRAILER}still-storm.webp` },
        { shot: 'chase', clock: '10:10 PM', line: 'And MITRA says it was you.', still: `${TRAILER}still-chase.webp` },
        { shot: 'sunrise', clock: '5:20 AM', line: 'Find who did it before the exam paper leaks at 9 AM.', still: `${TRAILER}still-sunrise.webp` },
      ],
    },
    // Missions from Story 2 (src/campus/story/v2): their clock, title, location and brief.
    beats: [
      { clock: '6:52 PM', sky: 'dusk', title: 'Lights Out', place: 'Research and Innovation Centre', text: 'Blackout across campus. Drones in the corridors, and MITRA says it was you.', still: `${TRAILER}still-dusk.webp`, alt: 'The campus from the air as the sun goes down, the hills behind it' },
      { clock: '7:10 PM', sky: 'dusk', title: 'Pit Stop', place: 'Automobile Workshop II', text: 'Fuel up Kalki, then beat the drones to the Power House.', still: `${TRAILER}still-kalki.webp`, alt: 'Kalki, a black dune buggy with four round lamps, on the football ground at sunset' },
      { clock: '8:20 PM', sky: 'night', title: 'Landslide', place: 'WRC Parapet', text: 'The monsoon breaks and the hill starts sliding. Sandbags, now.', still: `${TRAILER}still-storm.webp`, alt: 'Rain over the dark campus at night, the mountains behind' },
      { clock: '10:10 PM', sky: 'night', title: 'Runaway Drone', place: 'East Ring Road', text: 'Catch the drone. Floor it.', still: `${TRAILER}still-chase.webp`, alt: 'Kalki’s headlights on a wet campus road at night, the main gate ahead' },
      { clock: '5:20 AM', sky: 'dawn', title: 'Before Sunrise', place: 'Exam Section', text: 'Firewall, modules, one last chase. Then sunrise over Machhapuchhre.', still: `${TRAILER}still-sunrise.webp`, alt: 'Sunrise over the campus and the Annapurna range' },
    ],
    assets: [
      'assets/models/player/survivor.glb',
      // Sumit, the story's villain (src/campus/story).
      'assets/models/player/sumit_character.glb',
      // Kalki, the dune buggy (src/campus/kart.ts).
      'assets/models/kalki/kalki.glb',
      // The drone survey's ground photo and surface classes (src/campus/scanGround.ts). Without them
      // the installed app, offline, fell back to the unsurveyed ground and randomly planted trees.
      'assets/campus/',
      // Mission props (src/campus/actors.ts).
      'assets/models/binder_notebook/',
      'assets/models/metal_toolbox/',
      'assets/models/power_box_01/',
      'assets/models/signal_flashlight/',
      'assets/models/metal_jerrycan_green/',
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
