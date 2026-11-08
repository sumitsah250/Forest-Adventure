// The ten levels of Campus Quest: one per stop on a first-year's tour of IOE Pashchimanchal
// Campus. Hosts are fictional characters; places are the real campus buildings from the map.

import type { Outfit } from '../character/humanoid.ts';
import { STAFF } from './people.ts';
import type { Pool } from './questions.ts';

export type Where =
  | { building: string; poi?: string; label?: string }
  | { point: string; dx?: number; dz?: number }
  | { area: string };

export interface ItemDef {
  label: string;
  /** Verb shown on the prompt, e.g. "Pick up". */
  verb: string;
  model: 'book' | 'cube' | 'breaker' | 'usb' | 'toolbox' | 'gnss';
  where: Where;
}

export interface LevelDef {
  id: string;
  title: string;
  place: string;
  host: { name: string; role: string; outfit: Outfit };
  where: Where;
  intro: string[];
  fetch?: { items: ItemDef[]; request: string[]; back: string[] };
  pool: Pool | 'final' | null;
  need: number;
  /** Seconds per question (final exam). */
  timer?: number;
  pass: string[];
}

export const LEVELS: LevelDef[] = [
  {
    id: 'admission',
    title: 'Admission Day',
    place: 'Administration Block',
    host: { name: 'Mrs. Gurung', role: 'Admission Section', outfit: STAFF.officer },
    where: { building: 'Addministrative', poi: 'Admission Section', label: 'Administration Block' },
    intro: [
      'Namaste, and welcome to IOE Pashchimanchal Campus!',
      'Before I print your student ID, a quick entrance check. Three right answers and you are enrolled.',
    ],
    pool: 'admission',
    need: 3,
    pass: ['Perfect. Here is your ID card — you are officially a student of WRC.', 'Your first class is at the Department of Applied Science and Humanities. Follow the gold beacon.'],
  },
  {
    id: 'science',
    title: 'First Semester',
    place: 'Dept. of Applied Science & Humanities',
    host: { name: 'Dr. Poudel', role: 'Applied Science & Humanities', outfit: STAFF.suitBrown },
    where: { building: '', poi: 'Department of Applied Science and Humanities', label: 'Dept. of Applied Science & Humanities' },
    intro: ['Ah, the new batch. Every engineer starts with mathematics and physics.', 'Show me you remember your +2 — three correct answers.'],
    pool: 'science',
    need: 3,
    pass: ['Good fundamentals. The librarian has been asking for help — go and see her at the WRC Library.'],
  },
  {
    id: 'library',
    title: 'The Missing Books',
    place: 'WRC Library',
    host: { name: 'Ms. Baral', role: 'Librarian', outfit: STAFF.librarian },
    where: { building: 'WRC Library' },
    intro: ['Shh — this is a library. But I am glad you are here.'],
    fetch: {
      request: [
        'Three reference books were never returned. Students left them around campus.',
        'One is near the Saraswati Temple, one at the Cafeteria, and one on the WRC Ground parapet. Bring all three back.',
      ],
      items: [
        { label: 'Reference book: Engineering Mathematics', verb: 'Pick up', model: 'book', where: { point: 'Saraswati Temple', dx: 4, dz: 3 } },
        { label: 'Reference book: Engineering Drawing', verb: 'Pick up', model: 'book', where: { point: 'Cafeteria' } },
        { label: 'Reference book: Basic Electrical', verb: 'Pick up', model: 'book', where: { area: 'WRC Parapet' } },
      ],
      back: ['All three! Wonderful. Before I stamp your library card, a few questions.'],
    },
    pool: 'library',
    need: 3,
    pass: ['Library card stamped. The Department of Civil Engineering is waiting for you.'],
  },
  {
    id: 'civil',
    title: 'Concrete Facts',
    place: 'Dept. of Civil Engineering',
    host: { name: 'Er. Shrestha', role: 'Civil Engineering', outfit: STAFF.suitGrey },
    where: { building: 'Department of Civil Engineering' },
    intro: ['Civil engineers build the country — roads, bridges, hydropower.'],
    fetch: {
      request: ['Your lab group cast concrete cubes last week. Bring me your 28-day test cube from the Civil Lab.'],
      items: [{ label: '28-day concrete cube', verb: 'Collect', model: 'cube', where: { building: 'Civil Lab' } }],
      back: ['Nicely cured. Now, theory.'],
    },
    pool: 'civil',
    need: 3,
    pass: ['You will make a fine civil engineer. Electrical is next — go and find Dr. Karki.'],
  },
  {
    id: 'electrical',
    title: 'Power Up',
    place: 'Dept. of Electrical Engineering',
    host: { name: 'Dr. Karki', role: 'Electrical Engineering', outfit: STAFF.suitNavy },
    where: { building: 'Department of Electrical Engineering' },
    intro: ['Load-shedding again! The lab breaker has tripped.'],
    fetch: {
      request: ['Go to the Power House and reset the main breaker, then come back.'],
      items: [{ label: 'Main breaker', verb: 'Reset', model: 'breaker', where: { building: 'Power House' } }],
      back: ['Lights are back on. Let us see what you know about circuits.'],
    },
    pool: 'electrical',
    need: 3,
    pass: ['Well done. Er. Thapa at Electronics and Computer has a problem only a student can solve.'],
  },
  {
    id: 'computer',
    title: 'Lost Pen Drive',
    place: 'Dept. of Electronics & Computer Engineering',
    host: { name: 'Er. Thapa', role: 'Electronics & Computer', outfit: STAFF.suitGrey },
    where: { building: 'Department of Electronics and Computer Engineering' },
    intro: ['My pen drive with the whole C programming lab is missing!'],
    fetch: {
      request: ['I think I dropped it at the WRC Basketball Court during the staff match. Please find it.'],
      items: [{ label: 'Pen drive (C lab files)', verb: 'Pick up', model: 'usb', where: { area: 'WRC Basketball Court' } }],
      back: ['You found it! As a reward… a quiz.'],
    },
    pool: 'computer',
    need: 3,
    pass: ['Compiled without errors. Head to Mechanical and Automobile — Prof. Adhikari needs tools.'],
  },
  {
    id: 'mechanical',
    title: 'Workshop Practice',
    place: 'Dept. of Mechanical & Automobile Engineering',
    host: { name: 'Prof. Adhikari', role: 'Mechanical & Automobile', outfit: STAFF.sweater },
    where: { building: 'Department of Mechanical and Automobile Engineering' },
    intro: ['Workshop practice starts in ten minutes and I have no tools!'],
    fetch: {
      request: ['Fetch the micrometer from the Machining Workshop and the spanner set from Automobile Workshop II.'],
      items: [
        { label: 'Micrometer', verb: 'Take', model: 'toolbox', where: { building: 'Machining Workshop' } },
        { label: 'Spanner set', verb: 'Take', model: 'toolbox', where: { building: 'Automobile Workshop II' } },
      ],
      back: ['Just in time. Before you touch the lathe, answer these.'],
    },
    pool: 'mechanical',
    need: 3,
    pass: ['Safety first, and you know your basics. Geomatics is next — Dr. Rai is out surveying.'],
  },
  {
    id: 'geomatics',
    title: 'Find Your Bearings',
    place: 'Dept. of Geomatics Engineering',
    host: { name: 'Dr. Rai', role: 'Geomatics Engineering', outfit: STAFF.coat },
    where: { building: 'Department of Geomatics Engineering' },
    intro: ['Surveyors map the land — and this whole campus has been mapped, building by building.'],
    fetch: {
      request: ['Record a position fix at the GNSS Receiver Test Station and bring the reading back.'],
      items: [{ label: 'GNSS position fix', verb: 'Record', model: 'gnss', where: { point: 'GNSS Receiver Test Station' } }],
      back: ['28.25° N, 83.98° E — that is us. Now the theory.'],
    },
    pool: 'geomatics',
    need: 3,
    pass: ['You have passed every department. Only the final exam remains — go to the Exam Section notice board.'],
  },
  {
    id: 'final',
    title: 'Final Exam',
    place: 'Exam Section notice board',
    host: { name: 'Mr. Pandey', role: 'Exam Controller', outfit: STAFF.suitNavy },
    where: { point: 'WRC Information Board', dx: 2.5, dz: 2 },
    intro: [
      'The board exam. Questions from every department, 30 seconds each.',
      'Get five right before you lose all three lives. No phones, no calculators. Begin!',
    ],
    pool: 'final',
    need: 5,
    timer: 30,
    pass: ['Results are out… you passed! Congratulations. The convocation is at the WRC Auditorium.'],
  },
  {
    id: 'graduation',
    title: 'Convocation',
    place: 'WRC Auditorium',
    host: { name: 'Campus Chief', role: 'IOE Pashchimanchal Campus', outfit: STAFF.suitBrown },
    where: { building: '', poi: 'WRC Auditorium', label: 'WRC Auditorium' },
    intro: [
      'On behalf of the Institute of Engineering, Tribhuvan University —',
      'congratulations, Engineer! You have completed Campus Quest.',
    ],
    pool: null,
    need: 0,
    pass: [],
  },
];
