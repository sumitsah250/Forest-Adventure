// The thirteen clues. Every one must agree with the hidden truth in docs/STORY_V2.md:
// Sumit signed out at 6:30 but stayed, cut the power at 6:52, and at 6:55 logged in at the exam
// console as sumit.dev, switched to agurung and pushed two bugs from a red pen drive.
//
// A clue found by the player is a gold card; one Asha "finds" at mission end is silver.
// Finding and saving clues: src/campus/clues.ts.

import type { ClueDef, ClueId } from '../types.ts';

export const CLUES: ClueDef[] = [
  { id: 'c1', mission: 'v2-pit-stop', title: 'Red pen drive', text: 'Sumit dai wears a red pen drive on his lanyard.', pointsTo: 'sumit', role: 'evidence' },
  { id: 'c2', mission: 'v2-backup-power', title: '"6:55 sharp"', text: 'Sumit dai said the locks came down at 6:55, before anyone had told him.', pointsTo: 'sumit', role: 'evidence' },
  { id: 'c3', mission: 'v2-witness', title: 'Krishna Dai\'s statement', text: 'A grey fest hoodie with a red pen drive left the server room at 6:55.', pointsTo: 'hoodie', role: 'evidence' },
  { id: 'c4', mission: 'v2-witness', title: 'Yellow lanyard strap', text: 'A torn yellow strap by the Auditorium. Students wear blue; visitors wear yellow.', pointsTo: 'sumit', role: 'evidence' },
  { id: 'c5', mission: 'v2-witness', title: 'Hoodie thread', text: 'A grey hoodie thread caught on the MSC Hostel fence.', pointsTo: 'hoodie', role: 'false-lead' },
  { id: 'c6', mission: 'v2-landslide', title: 'Raju ran', text: 'Raju wears the grey hoodie, and ran when the server room was mentioned.', pointsTo: 'raju', role: 'false-lead' },
  { id: 'c7', mission: 'v2-shelves', title: 'Library register', text: 'The paper register has Raju in the library from 6:40 to 7:15.', pointsTo: 'raju', role: 'clears', clears: 'raju' },
  { id: 'c8', mission: 'v2-shelves', title: 'Note in "Ethics of AI"', text: 'In Asha\'s handwriting: the rule "protect the exam".', pointsTo: 'asha', role: 'false-lead' },
  { id: 'c9', mission: 'v2-signal', title: 'MITRA\'s memory', text: 'The order came at 6:55 from account agurung, on terminal EXAM-CONSOLE-01. Asha\'s account, but whose hands?', pointsTo: 'asha', role: 'false-lead' },
  { id: 'c10', mission: 'v2-runaway', title: 'Backup key door log', text: 'Asha was badged inside the RIC from 6:40 to 7:02.', pointsTo: 'asha', role: 'clears', clears: 'asha' },
  { id: 'c11', mission: 'v2-whodunit', title: 'Guard register', text: 'Sumit signed out at 6:30, but his motorbike is still in the motorcycle parking.', pointsTo: 'sumit', role: 'evidence' },
  { id: 'c12', mission: 'v2-whodunit', title: 'Console log', text: 'Login sumit.dev, switch to agurung, both bugs pushed at 6:55.', pointsTo: 'sumit', role: 'evidence' },
  { id: 'c13', mission: null, minigame: 'krishna-gossip', title: 'Cafeteria gossip', text: 'Krishna Dai heard that Sumit built MITRA alone and warned it was dangerous in the wrong hands. The committee shelved his report.', pointsTo: 'sumit', role: 'evidence' },
  { id: 'c14', mission: 'v2-witness', title: 'Red pen-drive cap', text: 'A red pen-drive cap by the NESS WRC steps, on the same path as the yellow strap.', pointsTo: 'sumit', role: 'evidence' },
];

/** Clues that are never announced: no dialogue gives them; if missed they turn up silver at the start of mission 9. */
export const QUIET_CLUES: ClueId[] = ['c1', 'c2'];

/**
 * The accusation in mission 9 (TODO_P6_EVIDENCE_BOARD_ACCUSE): three questions, and the clues
 * each one accepts. Accusing Raju shows c7; accusing Asha shows c9 and c10.
 */
export const ACCUSATION: { question: string; accepts: ClueId[] }[] = [
  { question: 'Who could reach the exam console at 6:55?', accepts: ['c4', 'c11'] },
  { question: 'Whose hands were on the keyboard?', accepts: ['c1', 'c12', 'c14'] },
  { question: 'Who knew too much, or had a reason?', accepts: ['c2', 'c13'] },
];

export const WRONG_ACCUSATION: Record<'raju' | 'asha', ClueId[]> = { raju: ['c7'], asha: ['c9', 'c10'] };
