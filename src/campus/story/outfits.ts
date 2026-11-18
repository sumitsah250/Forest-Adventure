// Staff outfits shared by both story versions and the campus crowd. Pure data (no runtime
// imports), so scripts/check-story.mjs can load the story files in Node.

import type { Outfit } from '../../character/humanoid.ts';

export const base = { headwearColor: '#000', beard: false, uniform: false, vest: null } as const;

export const STAFF: Record<string, Outfit> = {
  suitGrey: { ...base, id: 'cq-p1', skin: '#a8724f', hair: '#2a2420', top: '#4a4d52', topPattern: 'twill', trousers: '#3a3c40', trouserPattern: 'twill', boots: '#121212', headwear: 'none', backpack: null, suit: true },
  suitBrown: { ...base, id: 'cq-p2', skin: '#b58262', hair: '#6a6660', top: '#5a4632', topPattern: 'twill', trousers: '#3f3326', trouserPattern: 'twill', boots: '#1a1410', headwear: 'none', backpack: null, suit: true, beard: true },
  suitNavy: { ...base, id: 'cq-p3', skin: '#9c6a4c', hair: '#141110', top: '#23324f', topPattern: 'twill', trousers: '#23324f', trouserPattern: 'twill', boots: '#101010', headwear: 'none', backpack: null, suit: true },
  coat: { ...base, id: 'cq-p4', skin: '#c08d6c', hair: '#1a1410', top: '#e9e9e4', topPattern: 'canvas', trousers: '#3a3c40', trouserPattern: 'twill', boots: '#1a1a1a', headwear: 'none', backpack: null },
  officer: { ...base, id: 'cq-p6', skin: '#b58262', hair: '#120e0c', top: '#7a2f3a', topPattern: 'knit', trousers: '#2f2a30', trouserPattern: 'twill', boots: '#1a1414', headwear: 'none', backpack: null, female: true, hairStyle: 'bun', hood: false },
  librarian: { ...base, id: 'cq-p7', skin: '#a8724f', hair: '#16110d', top: '#e6e3da', topPattern: 'canvas', trousers: '#3a3c48', trouserPattern: 'twill', boots: '#1a1a1a', headwear: 'none', backpack: null, female: true, hairStyle: 'ponytail' },
  sweater: { ...base, id: 'cq-p5', skin: '#a77352', hair: '#555049', top: '#6a2f3a', topPattern: 'knit', trousers: '#4a4a40', trouserPattern: 'twill', boots: '#2a2018', headwear: 'none', backpack: null, beard: true, hood: false },
};
