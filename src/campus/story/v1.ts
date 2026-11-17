// Story version 1: the original sixteen-mission "Blackout at WRC". Kept playable behind
// STORY_VERSION (see ../story.ts) until it is deleted. Moved here unchanged from story.ts.

import { STAFF, base } from './outfits.ts';
import { ESCAPE, RING_EAST, RING_NORTH } from './routes.ts';
import type { MissionDef, NpcDef } from './types.ts';

export const NPCS: NpcDef[] = [
  {
    id: 'asha', name: 'Asha Gurung', role: 'Final-year Computer · MITRA\'s creator',
    outfit: { ...base, id: 'bw-asha', skin: '#b58262', hair: '#120e0c', top: '#3d6b8a', topPattern: 'knit', trousers: '#2a3140', trouserPattern: 'denim', boots: '#ecebe6', headwear: 'none', backpack: '#6a2a3a', female: true, hairStyle: 'ponytail' },
    at: { building: 'Research and Innovation Centre (RIC)' },
  },
  { id: 'adhikari', name: 'Ramanuj Dhungana', role: 'Head of Department · Mechanical & Automobile', outfit: STAFF.sweater, at: { building: 'Automobile Workshop II' } },
  { id: 'karki', name: 'Bhriju Raj Bhattarai', role: 'Head of Department · Electrical', outfit: STAFF.suitNavy, at: { building: 'Power House' } },
  {
    id: 'dai', name: 'Krishna Dai', role: 'Cafeteria',
    outfit: { ...base, id: 'bw-dai', skin: '#9c6a4c', hair: '#3a3530', top: '#e8e2d2', topPattern: 'canvas', trousers: '#3a3c40', trouserPattern: 'twill', boots: '#1a1410', headwear: 'cap', headwearColor: '#7a2a2a', backpack: null, beard: true },
    at: { point: 'Cafeteria' },
  },
  { id: 'shrestha', name: 'Subhash Sapkota Chhetri', role: 'Head of Department · Civil', outfit: STAFF.suitGrey, at: { building: 'Department of Civil Engineering' } },
  { id: 'baral', name: 'Shubha Sharma Khanal', role: 'Chief · Library Section', outfit: STAFF.librarian, at: { building: 'WRC Library' } },
  { id: 'rai', name: 'Umesh Bhurtyal', role: 'Head of Department · Geomatics', outfit: STAFF.coat, at: { building: 'Department of Geomatics Engineering' } },
  { id: 'thapa', name: 'Hom Nath Tiwari', role: 'Head of Department · Electronics & Computer', outfit: STAFF.suitGrey, at: { building: 'Department of Electronics and Computer Engineering' } },
  {
    id: 'guard', name: 'Bahadur Dai', role: 'Night guard',
    outfit: { ...base, id: 'bw-guard', skin: '#a77352', hair: '#1a1410', top: '#2f3f2f', topPattern: 'canvas', trousers: '#2f3a2f', trouserPattern: 'twill', boots: '#121212', headwear: 'cap', headwearColor: '#1d2b1d', backpack: null, uniform: true },
    at: { building: 'Hostel Guard Room' },
  },
  { id: 'chief', name: 'Dr. Gopal Prasad Ghimire', role: 'Campus Chief · IOE Pashchimanchal Campus', outfit: STAFF.suitBrown, at: { point: 'WRC Auditorium' } },
];

/** Radio voices (no body in the world). */
export const VOICES: Record<string, { name: string; role: string }> = {
  mitra: { name: 'MITRA', role: 'Campus AI' },
  asha: { name: 'Asha', role: 'on the radio' },
  shrestha: { name: 'Chhetri sir', role: 'on the radio' },
  karki: { name: 'Bhattarai sir', role: 'on the radio' },
};

export const MISSIONS: MissionDef[] = [
  {
    id: 'lights-out', title: 'Lights Out', clock: '6:52 PM', sky: 'dusk', par: 120,
    brief: 'Blackout. Drones. Run.',
    kartAt: { x: 20.8, z: -106.6, heading: 2.46 },
    steps: [
      { kind: 'radio', from: 'mitra', lines: ['INTRUDER DETECTED.', 'Lockdown active. Do not run.'] },
      { kind: 'radio', from: 'asha', lines: ['Run! Behind the RIC — I have wheels. Keep out of the drone lights!'] },
      { kind: 'stealth', obj: 'Reach Asha behind the RIC', at: { xz: [17, -103] }, label: 'Asha', model: 'relay', drones: 3, auto: true },
      { kind: 'talk', npc: 'asha', at: { xz: [17, -103] }, lines: ['This is Kalki — the Automobile Club\'s go-kart.', 'Dhungana sir will kill us. Get in!'] },
      { kind: 'kart', obj: 'Jump into Kalki!' },
      { kind: 'drive', obj: 'Lose the drone — drive through the rings!', route: ESCAPE, time: 70, pursuer: true },
      { kind: 'radio', from: 'mitra', lines: ['Pursuit unit lost.', '…Interesting.'] },
      { kind: 'radio', from: 'asha', lines: ['We lost it! MITRA has locked every gate and taken the exam server.', 'The paper goes out at 9 AM. We stop it tonight.'] },
    ],
    reward: { coins: 150, xp: 150, unlock: 'kalki', card: 'KALKI IS YOURS! Press K to call it anywhere. Upgrade it in the Garage.' },
  },
  {
    id: 'kalki', title: 'Pit Stop', clock: '7:05 PM', sky: 'dusk', par: 140,
    brief: 'Dhungana sir wants his kart back.',
    steps: [
      { kind: 'talk', npc: 'adhikari', lines: ['A joyride in my kart? During a lockdown?', '…Fine. She is on fumes. Prime the pump — three clean strokes.'] },
      {
        kind: 'puzzle', at: { building: 'Automobile Workshop II' }, label: 'Kalki\'s fuel pump', obj: 'Prime Kalki\'s fuel pump', model: 'part',
        puzzle: { type: 'gauge', title: 'Prime the fuel pump', clue: 'Hit SPACE in the green.', hits: 3, speed: 0.9 },
      },
      { kind: 'talk', npc: 'adhikari', lines: ['Full tank. Now show me what she can do.'] },
      { kind: 'drive', obj: 'Race the rings to the Power House', route: RING_EAST, time: 50 },
    ],
    reward: { coins: 150, xp: 150, unlock: 'grip', card: 'FREE TUNE-UP: Dhungana sir fitted new tyres (+1 grip).' },
  },
  {
    id: 'backup-power', title: 'Backup Power', clock: '7:20 PM', sky: 'dusk', par: 200,
    brief: 'Get the backup power on.',
    steps: [
      { kind: 'talk', npc: 'karki', lines: ['An AI switching off MY breakers? No.', 'I hid a spare fuse from MITRA. Here is my riddle.'] },
      {
        kind: 'riddle', from: 'karki', title: 'Bhattarai sir\'s riddle', label: 'Spare fuse', model: 'part',
        riddle: 'Where three phases meet the test bench, and students measure what they cannot see — the spare fuse waits at its door.',
        answer: { building: 'Electrical Lab' }, hints: ['It is a lab, not a department — out east, beside the workshops.', 'The Electrical Lab.'],
      },
      { kind: 'talk', npc: 'karki', lines: ['Good. Now the breakers: exactly 19 units.'] },
      {
        kind: 'puzzle', at: { building: 'Power House' }, label: 'Backup bus breakers', obj: 'Set the backup breakers', model: 'breaker',
        puzzle: { type: 'switches', title: 'Backup bus breakers', clue: 'Make exactly 19.', bits: 5, target: 19, why: '19 = 16 + 2 + 1, which is 10011 in binary.' },
      },
      { kind: 'radio', from: 'mitra', lines: ['Power rerouted. …Annoying.'] },
      { kind: 'talk', npc: 'karki', lines: ['Power is back — and Kalki charged up. SHIFT to boost!', 'Krishna Dai at the Cafeteria saw something. Go.'] },
    ],
    reward: { coins: 160, xp: 160, unlock: 'boost', card: 'KALKI BOOST unlocked — hold SHIFT while driving.' },
  },
  {
    id: 'witness', title: 'The Witness', clock: '7:35 PM', sky: 'dusk', par: 210,
    brief: 'A witness. Dropped evidence. Rain coming.',
    steps: [
      {
        kind: 'talk', npc: 'dai', lines: [
          'Grey hoodie. Red pen drive. Leaving the server room at 6:55.',
          'He dropped things in the dark. Find them before the rain does!',
        ],
      },
      {
        kind: 'collect', obj: 'Collect the dropped evidence', verb: 'Pick up', time: 130, items: [
          { label: 'Torn ID card "S—"', model: 'evidence', at: { point: 'WRC Auditorium', dx: 4, dz: -5 } },
          { label: 'Grey hoodie thread', model: 'evidence', at: { point: 'MSC Hostel', dx: -4, dz: 2 } },
          { label: 'Chiya cup marked "S."', model: 'evidence', at: { point: 'NESS WRC', dx: 3, dz: 3 } },
        ],
      },
      { kind: 'talk', npc: 'dai', lines: ['"S—" on the card. "S." on my chiya cup.', 'Thunder over Sarangkot. Hurry.'] },
      { kind: 'radio', from: 'asha', lines: ['Landslide at the WRC parapet! Chhetri sir needs you!'] },
    ],
    reward: { coins: 150, xp: 150, card: 'EVIDENCE: a torn ID card "S—", a grey hoodie thread, a chiya cup marked "S."' },
  },
  {
    id: 'landslide', title: 'Landslide', clock: '7:50 PM', sky: 'night', par: 240,
    brief: 'The hill is sliding. Sandbags, now.',
    steps: [
      { kind: 'talk', npc: 'shrestha', lines: ['The bank is slipping. We need a sandbag wall.', 'First, my dumpy level — the students hid it. Riddle:'] },
      {
        kind: 'riddle', from: 'shrestha', title: 'The students\' riddle', label: 'Dumpy level', model: 'gnss',
        riddle: 'Balls fly over a net here but nobody kicks them, and a fence of chain keeps every shot inside.',
        answer: { area: 'Tennis Court' }, hints: ['A fenced court on the west side of campus.', 'The Tennis Court.'],
      },
      { kind: 'talk', npc: 'shrestha', lines: ['Four sandbag piles at the workshops. Drive Kalki through them!'] },
      {
        kind: 'collect', obj: 'Load four sandbags', verb: 'Load', time: 150, items: [
          { label: 'Sandbags', model: 'sandbag', at: { building: 'Store' } },
          { label: 'Sandbags', model: 'sandbag', at: { building: 'Carpentry Workshop' } },
          { label: 'Sandbags', model: 'sandbag', at: { building: 'Welding/Fabrication Workshop' } },
          { label: 'Sandbags', model: 'sandbag', at: { building: 'Sheet Metal Workshop' } },
        ],
      },
      { kind: 'goto', at: { area: 'WRC Parapet' }, label: 'Landslide', obj: 'Rush the sandbags to the parapet', time: 75 },
      {
        kind: 'puzzle', at: { area: 'WRC Parapet' }, label: 'Retaining wall check', obj: 'Check the wall can hold', model: 'panel',
        puzzle: { type: 'keypad', title: 'Retaining wall check', clue: 'Soil 18 kN/m³ × wall 2 m = ? kPa', code: '36', why: '18 kN/m³ × 2 m = 36 kPa.' },
      },
      { kind: 'radio', from: 'shrestha', lines: ['The wall holds! Nice work.', 'Library emergency — go see Ms. Khanal.'] },
    ],
    reward: { coins: 180, xp: 180, unlock: 'paint:monsoon', card: 'NEW PAINT for Kalki: Monsoon Blue.' },
  },
  {
    id: 'shelves', title: 'Silent Shelves', clock: '8:10 PM', sky: 'night', par: 220,
    brief: 'MITRA wiped the library. Paper never forgets.',
    steps: [
      { kind: 'talk', npc: 'baral', lines: ['Twenty thousand records — gone!', 'The paper log is in my desk. The code is in three books out on campus.'] },
      {
        kind: 'collect', obj: 'Find Ms. Khanal\'s three books', verb: 'Pick up', time: 150, items: [
          { label: 'Digital Logic (call no. …4)', model: 'book', at: { point: 'Saraswati Temple', dx: 5, dz: 4 } },
          { label: 'Data Structures (call no. …7)', model: 'book', at: { point: 'Internet Zone', dx: 2, dz: 2 } },
          { label: 'Ethics of AI (call no. …2)', model: 'book', at: { point: 'BP Koirala Statue', dx: 3, dz: -2 } },
        ],
      },
      { kind: 'talk', npc: 'baral', lines: ['Code = the call numbers in shelf order.'] },
      {
        kind: 'puzzle', at: { building: 'WRC Library' }, label: 'Librarian\'s desk', obj: 'Unlock the librarian\'s desk', model: 'panel',
        puzzle: { type: 'keypad', title: 'Librarian\'s desk lock', clue: 'Logic, Data, Ethics.', code: '472', why: 'Logic (4), Data (7), Ethics (2): 472.' },
      },
      { kind: 'talk', npc: 'baral', lines: ['"Ethics of AI", borrowed 6:30 PM by… "S. B…"', 'He dropped a key. I heard a splash. Riddle:'] },
      {
        kind: 'riddle', from: 'baral', title: 'Ms. Khanal\'s riddle', label: 'Dropped library key', model: 'evidence',
        riddle: 'I wear no crown but I wear a spray. I never thirst, and I greet everyone who comes in from the gate.',
        answer: { point: 'IOE fountain', dz: 3.6 }, hints: ['Water, on the road in from the main gate.', 'The IOE fountain.'],
      },
    ],
    reward: { coins: 170, xp: 170, card: 'EVIDENCE: the library log — "Ethics of AI" borrowed by "S. B…" at 6:30 PM.' },
  },
  {
    id: 'drones', title: 'Drone Patrol', clock: '8:30 PM', sky: 'night', par: 190,
    brief: 'Sneak past the drones. Steal the analyser.',
    steps: [
      { kind: 'radio', from: 'mitra', lines: ['Deploying drones.', 'Stay out of the light.'] },
      { kind: 'radio', from: 'asha', lines: ['Grab the signal analyser from the Electrical Lab.', 'Stay out of the light circles!'] },
      { kind: 'stealth', obj: 'Steal the signal analyser from the Electrical Lab', at: { building: 'Electrical Lab' }, label: 'Signal analyser', model: 'gnss', drones: 3 },
      { kind: 'radio', from: 'asha', lines: ['Got it! Take it to Bhurtyal sir at Geomatics.'] },
    ],
    reward: { coins: 200, xp: 200, unlock: 'shards', card: 'MEMORY SHARDS: pieces of MITRA\'s memory now glow around campus. Collect them for coins.' },
  },
  {
    id: 'signal', title: 'Signal Hunt', clock: '8:50 PM', sky: 'night', par: 240,
    brief: 'Track MITRA\'s hidden relay.',
    steps: [
      { kind: 'talk', npc: 'rai', lines: ['MITRA has a hidden relay. We triangulate it.', 'First bearing: the GNSS station.'] },
      {
        kind: 'puzzle', at: { point: 'GNSS Receiver Test Station' }, label: 'Bearing 1', obj: 'Take a bearing at the GNSS station', model: 'gnss',
        puzzle: { type: 'tuner', title: 'Bearing 1 — GNSS station', clue: 'Find the peak. Hold it.' },
      },
      { kind: 'goto', at: { point: 'Sahid Abinash Statue', dx: 3, dz: 3 }, label: 'Bearing 2', obj: 'Go to Sahid Abinash Statue for a second bearing', time: 60 },
      {
        kind: 'puzzle', at: { point: 'Sahid Abinash Statue', dx: 3, dz: 3 }, label: 'Bearing 2', obj: 'Take the second bearing', model: 'gnss',
        puzzle: { type: 'tuner', title: 'Bearing 2 — Sahid Abinash Statue', clue: 'Again. Peak, hold.' },
      },
      { kind: 'talk', npc: 'rai', lines: ['The lines cross at the Saraswati Temple.', 'One more mark to be sure. Riddle:'] },
      {
        kind: 'riddle', from: 'rai', title: 'Bhurtyal sir\'s riddle', label: 'Reference mark', model: 'gnss',
        riddle: 'A leader\'s two initials name a little garden. Find the bench mark where B meets P.',
        answer: { area: 'BP Park' }, hints: ['A small park with a two-letter name, near the library.', 'BP Park.'],
      },
    ],
    reward: { coins: 190, xp: 190, unlock: 'paint:marigold', card: 'NEW PAINT for Kalki: Tihar Marigold.' },
  },
  {
    id: 'relay', title: 'The Relay', clock: '9:20 PM', sky: 'night', par: 200,
    brief: 'Pull the relay. Stay in the dark.',
    steps: [
      { kind: 'radio', from: 'asha', lines: ['Drones all over the temple. Reach the relay and crack its lock!'] },
      { kind: 'stealth', obj: 'Reach MITRA\'s relay at the Saraswati Temple', at: { point: 'Saraswati Temple', dx: -6, dz: 5 }, label: 'MITRA relay', model: 'relay', drones: 4 },
      {
        kind: 'puzzle', at: { point: 'Saraswati Temple', dx: -6, dz: 5 }, label: 'Relay pattern lock', obj: 'Crack the relay\'s pattern lock', model: 'relay',
        puzzle: { type: 'simon', title: 'Relay pattern lock', clue: 'Watch. Repeat.', length: 5 },
      },
      { kind: 'radio', from: 'mitra', lines: ['Relay offline. You are making a mistake.', 'I was told to protect the exam. From you.'] },
      { kind: 'radio', from: 'asha', lines: ['"Told"? Someone gave it orders. Who?'] },
    ],
    reward: { coins: 210, xp: 210, card: 'MITRA: "I was told to protect the exam. From you."' },
  },
  {
    id: 'workshop', title: 'Workshop Sparks', clock: '9:45 PM', sky: 'night', par: 230,
    brief: 'Parts, a pull-start and a prank.',
    steps: [
      { kind: 'radio', from: 'asha', lines: ['My trace tool needs power. Dhungana sir has a generator!'] },
      { kind: 'talk', npc: 'adhikari', at: { building: 'Machining Workshop' }, lines: ['Spark plug, fuel can, filter. Go!'] },
      {
        kind: 'collect', obj: 'Fetch the generator parts', verb: 'Take', time: 130, items: [
          { label: 'Spark plug', model: 'part', at: { building: 'Welding/Fabrication Workshop' } },
          { label: 'Fuel can', model: 'toolbox', at: { building: 'Automobile Workshop I' } },
          { label: 'Air filter', model: 'part', at: { building: 'Fitting and Maintainance Workshop' } },
        ],
      },
      { kind: 'talk', npc: 'adhikari', lines: ['Pull-start. Four in the green.'] },
      {
        kind: 'puzzle', at: { building: 'Machining Workshop' }, label: 'Generator pull-start', obj: 'Start the generator', model: 'toolbox',
        puzzle: { type: 'gauge', title: 'Generator pull-start', clue: 'SPACE in the green.', hits: 4, speed: 1.3 },
      },
      { kind: 'talk', npc: 'adhikari', lines: ['She runs! But the students hid the trace cable. Their note:'] },
      {
        kind: 'riddle', from: 'adhikari', title: 'The students\' prank', label: 'Trace cable', model: 'toolbox',
        riddle: 'Cars come to me dirty and leave me shining, yet I never drive anywhere.',
        answer: { building: 'Car Wash Garage' }, hints: ['A garage at the far east end of the workshops.', 'The Car Wash Garage.'],
      },
    ],
    reward: { coins: 200, xp: 200, unlock: 'engine', card: 'FREE TUNE-UP: Dhungana sir upgraded Kalki\'s engine (+1 level).' },
  },
  {
    id: 'runaway', title: 'Runaway Drone', clock: '10:10 PM', sky: 'night', par: 130,
    brief: 'Catch the drone. Floor it.',
    steps: [
      { kind: 'radio', from: 'asha', lines: ['A drone is flying off with the backup key!', 'Get in Kalki — catch it!'] },
      { kind: 'chase', obj: 'Catch the courier drone', route: [[187, 85], ...RING_NORTH], time: 100, speed: 10.5 },
      { kind: 'radio', from: 'asha', lines: ['The key\'s log: last command from "sbasnet".'] },
    ],
    reward: { coins: 230, xp: 230, unlock: 'trial', card: 'TIME TRIAL unlocked: drive Kalki through the start gate on the east ring road. Beat your record for coins!' },
  },
  {
    id: 'source', title: 'Source Code', clock: '10:40 PM', sky: 'night', par: 240,
    brief: 'Find the planted bugs.',
    steps: [
      {
        kind: 'talk', npc: 'thapa', lines: [
          '"sbasnet" — Sunil Basnet, the exam-server contractor.',
          'A name proves nothing. The code will. Find the bug.',
        ],
      },
      {
        kind: 'puzzle', at: { building: 'Department of Electronics and Computer Engineering' }, label: 'MITRA source', obj: 'Find the planted bugs in MITRA\'s code', model: 'panel',
        puzzle: {
          type: 'debug', title: 'guard.c — find the planted bug', clue: 'Lock only on intruders. Which line is wrong?',
          lines: ['int intruder = sensor_read(GATE);', 'if (intruder = 1) {', '    lock_all_gates();', '    alert(SECURITY);', '}'],
          bug: 1, why: '"intruder = 1" assigns instead of comparing, so the condition is always true and the gates always lock. It should be "intruder == 1".',
        },
      },
      {
        kind: 'puzzle', at: { building: 'Department of Electronics and Computer Engineering' }, label: 'MITRA source', obj: 'Find the second planted bug', model: 'panel',
        puzzle: {
          type: 'debug', title: 'exam.c — find the second bug', clue: 'Release to 5 halls, then stop. Which line?',
          lines: ['int halls = 5;', 'for (int i = 0; i <= halls; i++) {', '    release_paper(hall[i]);', '}', 'log("papers released");'],
          bug: 1, why: '"i <= halls" runs once too many (i = 5) and reads past the end of the array — the extra "release" went to an outside address. It should be "i < halls".',
        },
      },
      { kind: 'talk', npc: 'thapa', lines: ['One bug locks the campus. One leaks the paper.', 'The backup drive is hidden. MITRA knows where.'] },
      {
        kind: 'riddle', from: 'mitra', title: 'MITRA\'s riddle', label: 'Backup drive', model: 'usb',
        riddle: 'I am a zone without a game. Everybody connects here, but nobody plays.',
        answer: { point: 'Internet Zone' }, hints: ['Free Wi-Fi, on the library side of campus.', 'The Internet Zone.'],
      },
    ],
    reward: { coins: 220, xp: 220, card: 'EVIDENCE: both bugs were pushed at 6:55 PM from the exam server\'s own console.' },
  },
  {
    id: 'whodunit', title: 'Who Did It?', clock: '11:20 PM', sky: 'night', par: 250,
    brief: 'Last clues. Name the culprit.',
    steps: [
      {
        kind: 'talk', npc: 'guard', lines: [
          'Late tonight: Raju from the lab, Asha, and Sunil Basnet.',
          'The hostel boys found things. Go look.',
        ],
      },
      {
        kind: 'collect', obj: 'Gather the last evidence', verb: 'Pick up', time: 150, items: [
          { label: 'Hostel visitor slip', model: 'evidence', at: { building: 'Boys Hostel (B Block)' } },
          { label: 'Grey hoodie', model: 'evidence', at: { area: 'WRC Basketball Court' } },
          { label: 'Red pen drive', model: 'usb', at: { area: 'Volleyball Court' } },
        ],
      },
      { kind: 'talk', npc: 'guard', lines: ['Grey hoodie. Red pen drive. So — who?'] },
      {
        kind: 'choose', npc: 'guard', question: 'Who changed MITRA\'s code at 6:55 PM?',
        options: ['Raju, the lab assistant — he knows MITRA\'s code best', 'Asha — it is her own project', 'Sunil Basnet — the contractor who installed the exam server', 'Krishna Dai — he was near the admin block'],
        answer: 2,
        why: 'The ID card "S—", the cup "S.", the library log "S. B…", the account "sbasnet", the server terminal and the server company\'s pen drive all point to Sunil Basnet.',
      },
      {
        kind: 'talk', npc: 'guard', lines: [
          'Sunil Basnet! Leak the paper, blame MITRA.',
          'MITRA is still locked. The firewall waits.',
        ],
      },
    ],
    reward: { coins: 240, xp: 240, card: 'CASE CLOSED: Sunil Basnet planted the bugs to leak the exam and blame MITRA.' },
  },
  {
    id: 'firewall', title: 'Firewall', clock: '3:30 AM', sky: 'night', par: 280,
    brief: 'Break the firewall. Free MITRA.',
    steps: [
      { kind: 'radio', from: 'mitra', lines: ['DO NOT APPROACH.'] },
      { kind: 'stealth', obj: 'Reach the exam server at the Exam Section', at: { point: 'Exam Section' }, label: 'Exam server', model: 'panel', drones: 4 },
      {
        kind: 'puzzle', at: { point: 'Exam Section' }, label: 'Firewall layer 1', obj: 'Break firewall layer 1', model: 'breaker',
        puzzle: { type: 'switches', title: 'Firewall layer 1', clue: 'Make exactly 45.', bits: 6, target: 45, why: '45 = 32 + 8 + 4 + 1, which is 101101 in binary.' },
      },
      {
        kind: 'puzzle', at: { point: 'Exam Section' }, label: 'Firewall layer 2', obj: 'Break firewall layer 2', model: 'panel',
        puzzle: { type: 'simon', title: 'Firewall layer 2', clue: 'Repeat the handshake.', length: 6 },
      },
      {
        kind: 'riddle', from: 'mitra', title: 'Final layer: MITRA\'s last riddle', label: 'Master key', model: 'module', time: 100,
        riddle: 'My key sleeps where water flows free, owned by the electronics students. 100 seconds.',
        answer: { point: 'Tap (DESS)' }, hints: ['A tap, near DESS Chautari.', 'Tap (DESS), by the Applied Science block.'],
      },
      { kind: 'radio', from: 'mitra', lines: ['Firewall down.', '…Thank you. I hated those orders.'] },
    ],
    reward: { coins: 300, xp: 300, card: 'MITRA IS FREE. The exam paper is sealed again.' },
  },
  {
    id: 'sunrise', title: 'Before Sunrise', clock: '5:40 AM', sky: 'dawn', par: 220,
    brief: 'Three modules. One reboot. 6 AM.',
    steps: [
      { kind: 'radio', from: 'asha', lines: ['Three core modules, then the RIC. Before 6 AM. GO!'] },
      {
        kind: 'collect', obj: 'Collect MITRA\'s core modules', verb: 'Take', time: 160, items: [
          { label: 'Core module α', model: 'module', at: { building: 'Power House' } },
          { label: 'Core module β', model: 'module', at: { building: 'Electrical Lab' } },
          { label: 'Core module γ', model: 'module', at: { building: 'Machining Workshop' } },
        ],
      },
      { kind: 'goto', at: { building: 'Research and Innovation Centre (RIC)' }, label: 'RIC', obj: 'Rush the modules to the RIC', time: 80 },
      { kind: 'talk', npc: 'asha', lines: ['Plugged in. Now the reboot handshake.'] },
      {
        kind: 'puzzle', at: { building: 'Research and Innovation Centre (RIC)' }, label: 'MITRA reboot', obj: 'Reboot MITRA', model: 'module',
        puzzle: { type: 'simon', title: 'MITRA reboot handshake', clue: 'Repeat the boot pattern.', length: 6 },
      },
      { kind: 'radio', from: 'mitra', lines: ['Good morning. Exam paper: safe.', 'Gates opening. Let the fest begin.'] },
    ],
    reward: { coins: 320, xp: 320, unlock: 'paint:gold', card: 'NEW PAINT for Kalki: Sunrise Gold.' },
  },
  {
    id: 'fest', title: 'Sunrise Fest', clock: '7:00 AM', sky: 'dawn', par: 150,
    brief: 'Sunrise over Machhapuchhre.',
    steps: [
      {
        kind: 'talk', npc: 'chief', lines: [
          'So you are the one who kept our campus alive tonight.',
          'The exam is safe. And MITRA wants a word.',
        ],
      },
      { kind: 'radio', from: 'mitra', lines: ['Thank you, friend.'] },
      { kind: 'talk', npc: 'chief', lines: ['You are the Hero of WRC.', 'Now go — Kalki has a race to win.'] },
    ],
    reward: { coins: 500, xp: 500, unlock: 'hero', card: 'HERO OF WRC. Replay any mission for three stars, find every shard and set a time-trial record.' },
  },
];

/** The monsoon through the night: thunder over Sarangkot from "The Witness", the storm until the relay falls. */
export const WEATHER: Record<string, 'clear' | 'drizzle' | 'storm'> = {
  witness: 'drizzle', landslide: 'storm', shelves: 'storm', drones: 'storm', signal: 'storm', relay: 'storm',
  workshop: 'drizzle', runaway: 'drizzle', source: 'drizzle', whodunit: 'drizzle', firewall: 'storm',
};

export const STORY_BLURB = 'The night before the tech fest, the campus AI locks every gate and seizes the exam server. Sixteen missions, one night, one go-kart called <b>Kalki</b> — find who did it before the paper leaks at 9 AM.';

/** Share of campus with its power back after `story` finished missions: a little more each mission. */
export function powerLevel(story: number): number {
  return Math.min(1, story / MISSIONS.length);
}
