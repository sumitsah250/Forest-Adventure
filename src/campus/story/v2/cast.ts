// V2 cast: who they are, how they talk, and where the ones with a body stand.
// Names of places must exist in the map data (checked by `npm run check:story`).

import { STAFF, base } from '../outfits.ts';
import type { CastDef, NpcDef } from '../types.ts';

/** Everyone in the story, including the voices with no body (MITRA) and the silent player. */
export const CAST: Record<string, CastDef> = {
  player: { name: 'You', short: 'You', role: 'Fest volunteer', voice: 'Silent. Name and roll number are typed at the start; MITRA uses them.' },
  mitra: { name: 'MITRA', short: 'MITRA', role: 'Campus AI', voice: 'Missions 1-6 cold and bureaucratic with campus jokes; after 7 confused and honest; after 9 a dry, loyal ally.' },
  asha: { name: 'Asha Gurung', short: 'Asha', role: 'Final-year Computer · built MITRA', suspect: true, voice: 'Fast and sarcastic. Radio partner in missions 1-6 and 8-10.' },
  sunil: { name: 'Sunil Basnet', short: 'Sunil dai', role: 'Exam-server contractor', suspect: true, voice: 'Warm, helpful, over-explains. Likeable until mission 9. Radio partner in mission 7.' },
  raju: { name: 'Raju', short: 'Raju', role: 'Batchmate · two back papers', suspect: true, voice: 'Jokes when nervous. Grey fest hoodie.' },
  krishna: { name: 'Krishna Dai', short: 'Krishna Dai', role: 'Cafeteria', voice: 'The witness. Plain and observant.' },
  bahadur: { name: 'Bahadur Dai', short: 'Bahadur Dai', role: 'Night guard', voice: 'Steady. Trusts his register.' },
  dhungana: { name: 'Ramanuj Dhungana', short: 'Dhungana sir', role: 'Head of Department · Mechanical & Automobile', realStaff: true, mission: 'v2-pit-stop', voice: 'Kind helper, two or three lines.' },
  bhattarai: { name: 'Bhriju Raj Bhattarai', short: 'Bhattarai sir', role: 'Head of Department · Electrical', realStaff: true, mission: 'v2-backup-power', voice: 'Kind helper, two or three lines.' },
  chhetri: { name: 'Subhash Sapkota Chhetri', short: 'Chhetri sir', role: 'Head of Department · Civil', realStaff: true, mission: 'v2-landslide', voice: 'Kind helper, two or three lines.' },
  khanal: { name: 'Shubha Sharma Khanal', short: 'Khanal ma\'am', role: 'Chief · Library Section', realStaff: true, mission: 'v2-shelves', voice: 'Kind helper, two or three lines.' },
  bhurtyal: { name: 'Umesh Bhurtyal', short: 'Bhurtyal sir', role: 'Head of Department · Geomatics', realStaff: true, mission: 'v2-signal', voice: 'Kind helper, two or three lines.' },
  tiwari: { name: 'Hom Nath Tiwari', short: 'Tiwari sir', role: 'Head of Department · Electronics & Computer', realStaff: true, mission: 'v2-whodunit', voice: 'Kind helper, two or three lines.' },
  chief: { name: 'Dr. Gopal Prasad Ghimire', short: 'Campus Chief', role: 'Campus Chief · IOE Pashchimanchal Campus', realStaff: true, mission: 'v2-fest', voice: 'Kind, formal. Ending only.' },
};

const npc = (id: string, outfit: NpcDef['outfit'], at: NpcDef['at']): NpcDef => ({ id, name: CAST[id].name, role: CAST[id].role, outfit, at });

/** The people who stand in the world, at their usual posts. A `talk` step with `at` moves one for a mission. */
export const NPCS: NpcDef[] = [
  npc('asha', { ...base, id: 'bw-asha', skin: '#b58262', hair: '#120e0c', top: '#3d6b8a', topPattern: 'knit', trousers: '#2a3140', trouserPattern: 'denim', boots: '#ecebe6', headwear: 'none', backpack: '#6a2a3a', female: true, hairStyle: 'ponytail' }, { building: 'Research and Innovation Centre (RIC)' }),
  // TODO_P5: the red pen drive on a yellow lanyard (clue c1) is a prop still to be modelled.
  npc('sunil', { ...base, id: 'v2-sunil', skin: '#a8724f', hair: '#1a1410', top: '#3a4654', topPattern: 'canvas', trousers: '#33373d', trouserPattern: 'twill', boots: '#1a1410', headwear: 'none', backpack: null, hairStyle: 'short' }, { point: 'Administration Block' }),
  npc('raju', { ...base, id: 'v2-raju', skin: '#b07a58', hair: '#16110d', top: '#8d9299', topPattern: 'knit', trousers: '#2c3646', trouserPattern: 'denim', boots: '#e4e2dc', headwear: 'none', backpack: null, hairStyle: 'textured' }, { building: 'Table Tennis' }),
  npc('krishna', { ...base, id: 'bw-dai', skin: '#9c6a4c', hair: '#3a3530', top: '#e8e2d2', topPattern: 'canvas', trousers: '#3a3c40', trouserPattern: 'twill', boots: '#1a1410', headwear: 'cap', headwearColor: '#7a2a2a', backpack: null, beard: true }, { point: 'Cafeteria', outside: 'wall' }),
  npc('bahadur', { ...base, id: 'bw-guard', skin: '#a77352', hair: '#1a1410', top: '#2f3f2f', topPattern: 'canvas', trousers: '#2f3a2f', trouserPattern: 'twill', boots: '#121212', headwear: 'cap', headwearColor: '#1d2b1d', backpack: null, uniform: true }, { building: 'Hostel Guard Room' }),
  npc('dhungana', STAFF.sweater, { building: 'Automobile Workshop II' }),
  npc('bhattarai', STAFF.suitNavy, { building: 'Power House' }),
  npc('chhetri', STAFF.suitGrey, { building: 'Department of Civil Engineering' }),
  npc('khanal', STAFF.librarian, { building: 'WRC Library' }),
  npc('bhurtyal', STAFF.coat, { building: 'Department of Geomatics Engineering' }),
  npc('tiwari', STAFF.suitGrey, { building: 'Department of Electronics and Computer Engineering' }),
  npc('chief', STAFF.suitBrown, { point: 'WRC Auditorium', outside: 'wall', beside: 6 }),
];

/** How a character is named when heard over the radio or a speaker. */
export const VOICES: Record<string, { name: string; role: string }> = {
  mitra: { name: 'MITRA', role: 'Campus AI' },
  asha: { name: 'Asha', role: 'on the radio' },
  sunil: { name: 'Sunil dai', role: 'on the radio' },
  chhetri: { name: 'Chhetri sir', role: 'on the radio' },
};
