// Every piece of V2 story text: dialogue, radio, documents, objectives, puzzle wording, reward
// cards and cutscene subtitles. Edit wording here; nothing in this file is logic.
//
// Rules (checked by `npm run check:story`):
//   - One string in a `lines` list is one subtitle card: at most two short sentences.
//   - {name} and {roll} are replaced with what the player typed at the start.
//   - The seven real staff members get short, kind helper lines only.
//   - MITRA speaks at mission start, when the player is spotted, and at mission end.
//     Missions 1-6: cold and bureaucratic. After mission 7: confused and honest. After 9: a dry ally.

export const T = {
  title: {
    blurb: 'The night before the tech fest, the campus AI locks every gate and names <b>you</b> as the intruder. Ten missions, one night, one go-kart called <b>Kalki</b>. Find who really did it before the exam paper leaks at 6 AM.',
  },

  props: {
    festBanner: 'WRC TECH FEST · TOMORROW',
    festBannerSub: 'IOE PASHCHIMANCHAL CAMPUS',
  },

  /**
   * MITRA's one-liners when a drone spots the player: one act per list (missions 1-3, 4-7, 8-10).
   * Never the same line twice in a row, at most one every 6 seconds.
   */
  mitraSpotted: {
    act1: [
      'Movement detected. Please hold still for processing.',
      'There you are, {name}. The attendance register thanks you.',
      'Running on campus after hours is a fine of fifty rupees.',
      'Intruder located. Please queue at the Exam Section.',
      'Roll {roll}, your file is getting longer.',
      'Searchlight engaged. Smile for the report.',
      'Unauthorised student detected. This will go on your marksheet.',
      'You are not on the fest volunteer schedule for this.',
    ],
    act2: [
      'I see you. My records still say you did it.',
      'Detected again, {name}. The rain does not hide you.',
      'Hold still. I am trying to be sure about you.',
      'Movement in the dark. Probably you. Probably.',
      'Spotted. My order says stop you. My logs say otherwise.',
      'Drone contact. I would like this to be a misunderstanding.',
      'You again. Either you are guilty or very persistent.',
      'Searchlight on you. Please do not make it worse.',
    ],
    act3: [
      'That drone is not mine any more. Move!',
      'Firewall unit sees you. Get out of its light.',
      'Careful, {name}. Those eyes belong to the firewall.',
      'Spotted by his drones. I am working on it.',
      'Out of the light, now. I cannot override that unit.',
      'They see you, and I see them. Keep moving.',
      'Firewall drone locked on. Break line of sight.',
      'Not one of mine. Left, then wait.',
    ],
  },

  /** Screens outside the missions: name entry, the fest demo leaderboard, the location card. */
  screens: {
    nameTitle: 'Who are you?',
    nameSub: 'MITRA will use these. Please be accurate. It already thinks you are a criminal.',
    nameLabel: 'Your name',
    namePlaceholder: 'e.g. Sita Thapa',
    rollLabel: 'Roll number',
    rollPlaceholder: 'e.g. PAS078BCT001',
    nameStart: 'Start',
    nameSave: 'Save',
    nameNeeded: 'Type a name first.',
    nameMenu: 'Player: {name} · {roll}',
    demoBoard: 'Fastest escapes',
    demoBoardSub: 'Mission 1 · Lights Out',
    demoYourTime: 'Your escape: {time}',
    demoNext: 'Next player',
    demoEmpty: 'No escapes yet. Be the first!',
    demoReset: 'Leaderboard cleared.',
    demoHint: 'Staff: hold the title for 3 seconds to clear the board.',
  },

  m1: {
    title: 'Lights Out',
    location: 'RIC',
    brief: 'Blackout. Drones. MITRA says it was you.',
    mitraStart: [
      'Power failure logged at 6:52 PM. Lockdown rule applied: protect the exam.',
      'Intruder identified: {name}, roll {roll}. Please remain where you are.',
    ],
    ashaRun: ['That was not you, I know it. Get behind the RIC and stay out of the drone lights!'],
    stealthObj: 'Reach Asha behind the RIC',
    stealthLabel: 'Asha',
    ashaMeet: [
      'I built MITRA, and it has never lied before. Someone fed it your name.',
      'I have wheels. Do not laugh.',
    ],
    kartObj: 'Jump into Kalki!',
    driveObj: 'Lose the drone. Drive through the rings!',
    mitraEnd: [
      'Main gate sealed. The breach report on {name} goes to the Campus Chief at 6:00 AM.',
      'You have one night. I suggest sleep.',
    ],
    ashaEnd: [
      'Every gate is shut, and at six the exam paper leaks under your login.',
      'So we find who really did this. Tonight.',
    ],
    card: 'KALKI IS YOURS. Press K to call it anywhere. Upgrade it in the Garage.',
  },

  m2: {
    title: 'Pit Stop',
    location: 'AUTOMOBILE WORKSHOP II',
    brief: 'Fuel up, then beat the drones to the Power House.',
    dhungana1: [
      'Kalki is out during a lockdown? Then she had better run well.',
      'She is low on fuel. Prime the pump with three clean strokes.',
    ],
    pumpLabel: 'Kalki\'s fuel pump',
    pumpObj: 'Prime Kalki\'s fuel pump',
    pumpTitle: 'Prime the fuel pump',
    pumpClue: 'Hit SPACE in the green.',
    dhungana2: [
      'A full tank, and she sounds healthy.',
      'Drones are closing the Power House road. Drive carefully, but drive now.',
    ],
    driveObj: 'Race the ring road before drones seal the Power House',
    sunil: [
      'Sunil Basnet, I look after the exam server. Call me Sunil dai.',
      'I am locked in too, so let me help. I know every cable on this campus.',
      'Take radio channel 4. It has less static, usually.',
    ],
    sunilObj: 'Talk to the man at the Power House',
    card: 'FREE TUNE-UP: Dhungana sir fitted new tyres (+1 grip).',
  },

  m3: {
    title: 'Backup Power',
    location: 'POWER HOUSE',
    brief: 'One fuse, five breakers, ninety seconds.',
    bhattarai1: [
      'Good, you came. The backup bus needs one spare fuse.',
      'It is at the Electrical Lab door. Bring it and we will have light.',
    ],
    fuseObj: 'Fetch the spare fuse from the Electrical Lab',
    fuseLabel: 'Spare fuse',
    sunilRadio: [
      'Sunil dai here. A drone is cutting through that door, so be quick.',
      'These locks came down at 6:55 sharp. Bad luck for all of us.',
    ],
    bhattarai2: ['Well done. Now set the breakers to exactly 19.'],
    breakerLabel: 'Backup bus breakers',
    breakerObj: 'Set the backup breakers',
    breakerClue: 'Make exactly 19.',
    breakerWhy: '19 = 16 + 2 + 1, which is 10011 in binary.',
    bhattarai3: [
      'The lights are back, thanks to you.',
      'Kalki charged while we worked. Hold SHIFT for a boost.',
    ],
    mitraEnd: [
      'Power restored. Displaying the intruder on all screens.',
      'I was told to protect the exam. From you.',
    ],
    card: 'KALKI BOOST unlocked. Hold SHIFT while driving.',
  },

  m4: {
    title: 'The Witness',
    location: 'CAFETERIA',
    brief: 'A witness, dropped clues, and rain on the way.',
    krishna1: [
      'I saw someone leave the server room at 6:55. Grey fest hoodie, red pen drive.',
      'They dropped things by the Auditorium and the hostel. The rain will wash them away!',
    ],
    collectObj: 'Find the dropped clues before the rain takes them',
    lanyard: 'Torn yellow lanyard strap',
    thread: 'Grey hoodie thread',
    krishna2: [
      'A yellow strap? Students wear blue; only contractors get yellow.',
      'And half the campus owns that grey hoodie. Be careful who you blame.',
    ],
    ashaBoard: [
      'Three people were here late: Raju, me, and Sunil dai.',
      'I pinned all three on a board. Yes, I put myself on it.',
    ],
    ashaEnd: ['The bank above the ground is sliding! Chhetri sir needs hands at the parapet.'],
    card: 'EVIDENCE BOARD unlocked: three faces, and every clue you find.',
  },

  m5: {
    title: 'Landslide',
    location: 'WRC PARAPET',
    brief: 'The hill is sliding. Sandbags, now.',
    chhetri1: [
      'Thank you for coming in this rain. The bank is moving and we need a sandbag wall.',
      'First my dumpy level, please. It was left at the Tennis Court.',
    ],
    levelObj: 'Fetch the dumpy level from the Tennis Court',
    levelLabel: 'Dumpy level',
    raju1: [
      'Sandbags, in this storm? I have two back papers, what is one more disaster.',
      'Four piles by the workshops. I will load, you drive.',
    ],
    sandObj: 'Load four sandbags',
    sandLabel: 'Sandbags',
    gotoObj: 'Rush the sandbags to the WRC Parapet',
    gotoLabel: 'Landslide',
    wallLabel: 'Retaining wall check',
    wallObj: 'Check the wall can hold',
    wallClue: 'Soil 18 kN/m³ × wall 2 m = ? kPa',
    wallWhy: '18 kN/m³ × 2 m = 36 kPa.',
    chhetriRadio: ['The wall holds. Fine work, both of you.'],
    ashaEnd: [
      'I asked Raju where he was at 6:55, near the server room.',
      'He dropped his sandbag and ran. Grey hoodie and all.',
    ],
    card: 'NEW PAINT for Kalki: Monsoon Blue.',
  },

  m6: {
    title: 'Silent Shelves',
    location: 'WRC LIBRARY',
    brief: 'The catalogue is wiped. Paper never forgets.',
    khanal1: [
      'The catalogue is wiped, but paper does not forget. My register is locked in the desk.',
      'Three borrowed books hold the code. Could you bring them back, please?',
    ],
    collectObj: 'Recover the three borrowed books',
    bookLogic: 'Digital Logic (call no. …4)',
    bookData: 'Data Structures (call no. …7)',
    bookEthics: 'Ethics of AI (call no. …2)',
    khanal2: [
      'All three, and dry. Thank you.',
      'The desk code is the call numbers in shelf order: Logic, Data, Ethics.',
    ],
    deskLabel: 'Librarian\'s desk',
    deskObj: 'Unlock the librarian\'s desk',
    deskTitle: 'Librarian\'s desk lock',
    deskClue: 'Logic, Data, Ethics.',
    deskWhy: 'Logic (4), Data (7), Ethics (2): 472.',
    registerTitle: 'Library register (paper)',
    register: [
      '6:40 PM  IN   Raju. Reading hall, seat 14.',
      '7:15 PM  OUT  Raju. Signed at the desk.',
    ],
    noteTitle: 'Note inside "Ethics of AI"',
    note: [
      'Rule 1 for MITRA: protect the exam. No exceptions.',
      'The handwriting is Asha\'s.',
    ],
    ashaEnd: [
      'Yes. I wrote that rule, two years ago.',
      'I never thought someone would aim it at a student. I need a min—',
    ],
    card: 'The register clears Raju. The note points at Asha.',
  },

  m7: {
    title: 'Signal Hunt',
    location: 'GNSS RECEIVER TEST STATION',
    brief: 'Two bearings, four drones, one relay.',
    sunilStart: [
      'Sunil dai here. Asha is not answering, so you get me, lucky you.',
      'MITRA talks to its drones through a hidden relay. Two bearings and we have it.',
    ],
    bhurtyal: [
      'Take a bearing at the GNSS station first, then one at Sahid Abinash Statue.',
      'Hold the peak steady and the lines will cross. You will do well.',
    ],
    bearing1Label: 'Bearing 1',
    bearing1Obj: 'Take a bearing at the GNSS station',
    bearing1Title: 'Bearing 1: GNSS station',
    bearing1Clue: 'Find the peak. Hold it.',
    gotoObj: 'Go to Sahid Abinash Statue for the second bearing',
    bearing2Label: 'Bearing 2',
    bearing2Obj: 'Take the second bearing',
    bearing2Title: 'Bearing 2: Sahid Abinash Statue',
    bearing2Clue: 'Again. Peak, hold.',
    sunilCross: [
      'The lines cross at the Saraswati Temple. Four drones, I count four.',
      'Stay out of the lights. I would come myself, but, you know, my knee.',
    ],
    stealthObj: 'Reach MITRA\'s relay at the Saraswati Temple',
    relayLabel: 'MITRA relay',
    lockLabel: 'Relay pattern lock',
    lockObj: 'Crack the relay\'s pattern lock',
    lockClue: 'Watch. Repeat.',
    mitraEnd: [
      'Relay offline. I… remember an order.',
      'Time 6:55 PM, account agurung. Terminal EXAM-CONSOLE-01.',
    ],
    sunilEnd: [
      'Did it say something? Never mind, it is confused.',
      'Bring that relay to me. I will keep it safe.',
    ],
    card: 'MEMORY SHARDS now glow around campus. NEW PAINT for Kalki: Tihar Marigold.',
  },

  m8: {
    title: 'Runaway Drone',
    location: 'EAST RING ROAD',
    brief: 'Catch the drone. Floor it.',
    mitraStart: [
      'A courier unit is leaving with my backup key. I did not order that.',
      'I do not know who did. This is new for me.',
    ],
    chaseObj: 'Catch the courier drone',
    keyLogTitle: 'Backup key: door log',
    keyLog: [
      'RIC lab door. Badge agurung IN 6:40 PM.',
      'Badge agurung OUT 7:02 PM. No exit in between.',
    ],
    ashaEnd: [
      'I am at the Hostel Guard Room. Sorry I went quiet.',
      'I was in the RIC until 7:02. Someone else used my account.',
    ],
    card: 'FREE TUNE-UP: engine +1. TIME TRIAL unlocked on the east ring road.',
  },

  m9: {
    title: 'Who Did It?',
    location: 'HOSTEL GUARD ROOM',
    brief: 'A register, two bugs, one name.',
    bahadur1: [
      'I write every name in this register, power or no power.',
      'Read it yourself. One line does not sit right with me.',
    ],
    guardRegisterTitle: 'Guard register',
    guardRegister: [
      '6:30 PM  OUT  Sunil Basnet, contractor. Signed.',
      'Night round, 11:05 PM: his motorbike is still in the motorcycle parking.',
    ],
    tiwari1: [
      'Asha sent me the server code. Two lines in it were planted.',
      'Take your time and read carefully. You will see them.',
    ],
    sourceLabel: 'Exam server source',
    bug1Obj: 'Find the first planted bug',
    bug1Title: 'guard.c: find the planted bug',
    bug1Clue: 'Lock only on a real intruder. Which line is wrong?',
    bug1Lines: ['int intruder = sensor_read(GATE);', 'if (intruder = 1) {', '    lock_all_gates();', '    blame(last_card_swiped());', '}'],
    bug1Why: '"intruder = 1" assigns instead of comparing, so the gates always lock and the last card swiped is always blamed. It should be "intruder == 1".',
    bug2Obj: 'Find the second planted bug',
    bug2Title: 'exam.c: find the second bug',
    bug2Clue: 'Release to 5 halls, then stop. Which line?',
    bug2Lines: ['int halls = 5;', 'for (int i = 0; i <= halls; i++) {', '    release_paper(hall[i]);', '}', 'log("papers released");'],
    bug2Why: '"i <= halls" runs once too many (i = 5) and reads past the end of the list. That extra "release" is the email that goes out at 6:00 AM. It should be "i < halls".',
    tiwari2: [
      'One bug blames the last card swiped. The other mails the paper at 6:00 AM.',
      'The console kept its own log. Look at who typed them.',
    ],
    consoleTitle: 'EXAM-CONSOLE-01: log',
    console: [
      '6:55 PM  login sbasnet. Switch user: agurung.',
      '6:55 PM  two patches pushed from a USB drive.',
    ],
    accuseQuestion: 'Who was at the exam console at 6:55 PM?',
    accuseOptions: ['Raju: grey hoodie, ran when asked', 'Asha: her account, her rule', 'Sunil Basnet: the exam-server contractor'],
    accuseWhy: 'He signed out at 6:30 but never left. The console shows his login before Asha\'s account, and the red pen drive hangs on his lanyard.',
    sunilEnd: [
      'You were supposed to be simple.',
      'Carry the blame, open the gates. That was all.',
    ],
    mitraEnd: [
      'A firewall has gone up around the exam server. It is not mine.',
      'I am with you now. For the record, I was always polite.',
    ],
    card: 'CASE CLOSED: Sunil Basnet did it. The paper still leaks at 6:00 AM.',
  },

  m10: {
    title: 'Before Sunrise',
    location: 'EXAM SECTION',
    brief: 'Firewall, modules, one last chase. 6 AM.',
    mitraStart: [
      '5:20 AM. Forty minutes, and I would like my campus back.',
      'Reach the exam console. I will count the firewall layers for you.',
    ],
    stealthObj: 'Reach the exam console at the Exam Section',
    consoleLabel: 'Exam console',
    fw1Label: 'Firewall layer 1',
    fw1Obj: 'Break firewall layer 1',
    fw1Clue: 'Make exactly 45.',
    fw1Why: '45 = 32 + 8 + 4 + 1, which is 101101 in binary.',
    mitraHint: ['Layer one is down. The second is a handshake, so repeat what you see.'],
    fw2Label: 'Firewall layer 2',
    fw2Obj: 'Break firewall layer 2',
    fw2Clue: 'Repeat the handshake.',
    ashaModules: [
      'The firewall is down! Three of MITRA\'s core modules are still out there.',
      'Power House, Electrical Lab, Machining Workshop. Take Kalki!',
    ],
    modulesObj: 'Collect MITRA\'s core modules',
    moduleA: 'Core module α',
    moduleB: 'Core module β',
    moduleC: 'Core module γ',
    ashaBike: [
      'Sunil is on his motorbike with the red pen drive!',
      'He is going round the ring road for the main gate. Catch him!',
    ],
    chaseObj: 'Chase Sunil to the main gate',
    gotoObj: 'Carry the pen drive to the RIC',
    gotoLabel: 'RIC',
    ashaRic: [
      'You have it! Plug it in and I can undo both bugs.',
      'Then the reboot handshake. Steady hands.',
    ],
    rebootLabel: 'MITRA reboot',
    rebootObj: 'Reboot MITRA',
    rebootTitle: 'MITRA reboot handshake',
    rebootClue: 'Repeat the boot pattern.',
    choiceQuestion: 'Should MITRA remember tonight, or forget it?',
    choiceOptions: ['Remember', 'Forget'],
    mitraRemember: [
      'Good morning, {name}. I will remember tonight, and who stood by me.',
      'Exam paper sealed. Gates opening.',
    ],
    mitraForget: [
      'Good morning. I do not know you, {name}, but my logs say I owe you thanks.',
      'Exam paper sealed. Gates opening.',
    ],
    card: 'NEW PAINT for Kalki: Sunrise Gold.',
  },

  ending: {
    title: 'Sunrise Fest',
    location: 'WRC AUDITORIUM',
    brief: 'Sunrise over Machhapuchhre.',
    chief: [
      'So you are the student who kept our campus safe tonight. Thank you.',
      'On behalf of everyone here: you are the Hero of WRC.',
    ],
    mitra: ['The fest is open. Try the chiya.'],
    card: 'HERO OF WRC. Free roam is open: replay missions, find every shard, set a time-trial record.',
  },

  /** Cutscene subtitles and title cards (cutscenes.ts). */
  cut: {
    c1Mitra: 'Power failure at 6:52 PM. Lockdown rule applied: protect the exam.',
    c1Kicker: 'Sumix Developers presents',
    c1Title: 'CAMPUS QUEST',
    c1Sub: 'Blackout at WRC',
    c2Asha: 'Meet Kalki. The Automobile Club built her.',
    c2Asha2: 'She is faster than she looks.',
    gateMitra: 'Attention, all campus. {name}, roll {roll}, is the intruder.',
    gateMitra2: 'Every gate is now sealed. Thank you for your cooperation.',
  },
};
