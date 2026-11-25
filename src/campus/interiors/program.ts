// What each campus building is, and so which rooms it has. Named buildings go by their
// name; unnamed ones by the points of interest mapped inside them, the area they stand in,
// their neighbours and their size. buildingOverrides.ts can set `use` by name.

import { DATA, centroid, pointInPoly, polyArea, type BuildingData } from '../geo.ts';

export interface RoomSpec {
  name: string;
  /** Furnisher kind (see furnish.ts). */
  kind: string;
  sub?: string;
  /** Wants two room slots merged into one (auditorium, cafeteria). */
  big?: boolean;
}

export type Layout = 'corridor' | 'hall' | 'single';

export interface Program {
  use: string;
  /** Name used on floor signs. */
  display: string;
  layout: Layout;
  /** Target room length along the corridor (m). */
  roomLen: number;
  corridor: number;
  /** Rooms in naming order (west side first, then east, along the building) on floor f. */
  rooms(f: number, count: number): RoomSpec[];
  /** The main space of a hall / single-room building. */
  hall?: RoomSpec;
  /** Small rooms partitioned off the far end of a hall. */
  endRooms?: RoomSpec[];
  /** Rooms fixed by a mapped point inside the building (ground floor). */
  pois: { x: number; z: number; spec: RoomSpec }[];
  signs: boolean;
  doorW: number;
  doorH: number;
  /** Extra door at the far end of a long corridor. */
  backDoor: boolean;
}

export type Use =
  | 'academic' | 'admin' | 'hostel' | 'quarters' | 'library' | 'workshop' | 'lab' | 'store' | 'power' | 'garage'
  | 'shop' | 'union' | 'farm' | 'toilet' | 'guard' | 'changing' | 'utility' | 'complex' | 'block';

const KIND_OF_POI: [RegExp, RoomSpec][] = [
  [/auditorium/i, { name: 'WRC Auditorium', kind: 'auditorium', big: true }],
  [/cafeteria|canteen/i, { name: 'Cafeteria', kind: 'canteen', big: true }],
  [/ness/i, { name: 'NESS WRC', kind: 'union' }],
  [/msc hostel/i, { name: 'MSC Hostel', kind: 'dorm' }],
  [/exam/i, { name: 'Exam Section', kind: 'counter' }],
  [/admission/i, { name: 'Admission Section', kind: 'counter' }],
  [/account/i, { name: 'Account Section', kind: 'counter' }],
  [/adminstration|administration section/i, { name: 'Administration Section', kind: 'counter' }],
  [/first aid/i, { name: 'First Aid', kind: 'firstaid' }],
  [/photocopy|stationery/i, { name: 'Photocopy & Stationery', kind: 'shop' }],
  [/internet zone/i, { name: 'Internet Zone', kind: 'computerLab' }],
];

/** The labs of each department (name, furnisher kind). */
const DEPT_LABS: [RegExp, [string, string][]][] = [
  [/civil/i, [['Surveying Lab', 'scienceLab'], ['Hydraulics Lab', 'scienceLab'], ['Soil Mechanics Lab', 'scienceLab'], ['Structures Lab', 'scienceLab'], ['Civil CAD Lab', 'computerLab'], ['Transportation Lab', 'scienceLab']]],
  [/electronics|computer/i, [['Computer Lab 1', 'computerLab'], ['Electronics Lab', 'electronicsLab'], ['Microprocessor Lab', 'electronicsLab'], ['Computer Lab 2', 'computerLab'], ['Communication Lab', 'electronicsLab']]],
  [/electrical/i, [['Electrical Machines Lab', 'electricalLab'], ['Power Systems Lab', 'electronicsLab'], ['Control Systems Lab', 'electronicsLab'], ['Instrumentation Lab', 'electronicsLab']]],
  [/mechanical|automobile/i, [['Mechanical CAD Lab', 'computerLab'], ['Thermodynamics Lab', 'scienceLab'], ['Fluid Mechanics Lab', 'scienceLab'], ['Metrology Lab', 'scienceLab'], ['IC Engines Lab', 'electricalLab']]],
  [/geomatics/i, [['GIS Lab', 'computerLab'], ['Photogrammetry Lab', 'computerLab'], ['Remote Sensing Lab', 'computerLab'], ['GNSS Lab', 'scienceLab'], ['Survey Instruments Store', 'store']]],
  [/applied science|humanities/i, [['Physics Lab', 'scienceLab'], ['Chemistry Lab', 'scienceLab'], ['Language Lab', 'computerLab']]],
];

/** The RIC: departments, classrooms and labs (its long-standing room list). */
const RIC_ROOMS: string[][] = [
  ['RIC Office', 'Department of Computer Engineering', 'Department of Electronics Engineering', 'Faculty Room', 'Store',
    'Classroom G-01', 'Classroom G-02', 'Computer Lab 1', 'Classroom G-03', 'Classroom G-04', 'Electronics Lab', 'Classroom G-05', 'Classroom G-06'],
  ['Research Lab 1', 'Research Lab 2', 'Seminar Hall', 'Department of Electrical Engineering', 'Faculty Room',
    'Classroom 101', 'Classroom 102', 'Computer Lab 2', 'Classroom 103', 'Classroom 104', 'Robotics Lab', 'Classroom 105', 'Classroom 106'],
  ['Innovation Lab', 'Incubation Centre', 'Conference Hall', 'Department of Architecture', 'Library Corner',
    'Classroom 201', 'Classroom 202', 'Computer Lab 3', 'Classroom 203', 'Classroom 204', 'Drawing Studio', 'Classroom 205', 'Classroom 206'],
];

/** Furnisher kind for a room name. */
export function kindOfName(name: string): string {
  if (/washroom|toilet/i.test(name)) return 'washroom';
  if (/drawing/i.test(name)) return 'drawing';
  if (/classroom/i.test(name)) return 'classroom';
  if (/computer|gis|cad|photogrammetry|remote sensing|internet|language lab/i.test(name)) return 'computerLab';
  if (/electronics lab|microprocessor|communication|power systems|control|instrumentation/i.test(name)) return 'electronicsLab';
  if (/machines lab|engines lab/i.test(name)) return 'electricalLab';
  if (/robotics|innovation|incubation|research lab/i.test(name)) return 'maker';
  if (/lab/i.test(name)) return 'scienceLab';
  if (/seminar/i.test(name)) return 'seminar';
  if (/conference|meeting/i.test(name)) return 'conference';
  if (/library|reading/i.test(name)) return 'reading';
  if (/chief|head of|hod/i.test(name)) return 'chief';
  if (/records/i.test(name)) return 'records';
  if (/store/i.test(name)) return 'store';
  if (/section/i.test(name)) return 'counter';
  return 'office';
}

const spec = (name: string, kind = kindOfName(name), sub?: string): RoomSpec => ({ name, kind, sub });

function deptLabs(name: string): [string, string][] {
  return DEPT_LABS.find(([re]) => re.test(name))?.[1] ?? [];
}

const WORKSHOP_SUB: [RegExp, string][] = [
  [/automobile/i, 'auto'], [/carpentry/i, 'carpentry'], [/welding|fabrication/i, 'welding'], [/sheet metal/i, 'sheetmetal'],
  [/fitting|maint/i, 'fitting'], [/machining/i, 'machining'], [/plumbing/i, 'plumbing'],
];

const area = (b: BuildingData): number => Math.abs(polyArea(b.pts));

/** Which use a building has (null: leave it solid). */
export function useOf(b: BuildingData, pois: { name: string }[]): Use | null {
  const n = b.name ?? '';
  const a = area(b);
  if (b.kind === 'temple' || a < 5) return null;
  if (/table tennis/i.test(n)) return null;
  if (/guard/i.test(n)) return 'guard';
  if (/hostel/i.test(n)) return 'hostel';
  if (/workshop/i.test(n)) return 'workshop';
  if (/^(electrical|civil) lab$/i.test(n)) return 'lab';
  if (/library/i.test(n) || b.kind === 'library') return 'library';
  if (/addministrative|administrat/i.test(n)) return 'admin';
  if (/store/i.test(n)) return 'store';
  if (/power house/i.test(n)) return 'power';
  if (/garage|car wash|parking|मोटरसाइकल/i.test(n)) return 'garage';
  if (/stationery/i.test(n)) return 'shop';
  if (/union/i.test(n)) return 'union';
  if (/farming/i.test(n)) return 'farm';
  if (/toilet/i.test(n) || b.kind === 'toilets') return 'toilet';
  if (/guard/i.test(n)) return 'guard';
  if (/changing/i.test(n)) return 'changing';
  if (/department|block|research|\(ric\)/i.test(n) || b.kind === 'college' || b.kind === 'school') return 'academic';
  if (n) return 'block';
  // Unnamed: by what is mapped in or around it.
  if (pois.some((p) => /department/i.test(p.name))) return 'academic';
  if (pois.length) return 'complex';
  if (a < 45) return 'utility';
  const [cx, cz] = centroid(b.pts);
  if (DATA.areas.some((ar) => ar.kind === 'residential' && /hostel/i.test(ar.name ?? '') && pointInPoly(cx, cz, ar.pts))) return 'hostel';
  // The staff quarters: the houses round the children's playground at the west end.
  if (cx < -130 && a < 420) return 'quarters';
  const nearWorkshop = DATA.buildings.some((o) => {
    if (o === b || !o.name || !/workshop/i.test(o.name)) return false;
    const [ox, oz] = centroid(o.pts);
    return Math.hypot(ox - cx, oz - cz) < 45;
  });
  if (nearWorkshop) return 'workshop';
  if (a >= 500) return 'academic';
  return 'block';
}

/** POIs mapped inside a building. */
export function poisIn(b: BuildingData): { name: string; x: number; z: number }[] {
  return DATA.points.filter((p) => p.name && p.kind === 'poi' && pointInPoly(p.x, p.z, b.pts)).map((p) => ({ name: p.name!, x: p.x, z: p.z }));
}

export function programFor(b: BuildingData, forced?: Use): Program | null {
  const pois = poisIn(b);
  const use = forced ?? useOf(b, pois);
  if (!use) return null;
  const n = b.name ?? '';
  const poiSpecs = pois.flatMap((p) => {
    const hit = KIND_OF_POI.find(([re]) => re.test(p.name));
    return hit ? [{ x: p.x, z: p.z, spec: { ...hit[1] } }] : [];
  });
  const base: Program = {
    use, display: n || 'Campus Building', layout: 'corridor', roomLen: 7, corridor: 2.4,
    rooms: (_f, count) => Array.from({ length: count }, (_, k) => spec(`Room ${k + 1}`)),
    pois: poiSpecs, signs: true, doorW: 2.2, doorH: 2.7, backDoor: true,
  };
  const numbered = (prefix: string, f: number, k: number) => `${prefix}${f}${String(k + 1).padStart(2, '0')}`;

  switch (use) {
    case 'academic': {
      if (/\(ric\)/i.test(n)) {
        return { ...base, display: 'Research and Innovation Centre', roomLen: 8, rooms: (f, count) => fill(RIC_ROOMS[f] ?? [], count, (k) => `Room ${f}${String(k + 1).padStart(2, '0')}`).map((x) => spec(x)) };
      }
      const deptName = n || pois.find((p) => /department/i.test(p.name))?.name || '';
      const labs = deptLabs(deptName);
      const block = /^([A-Z])[ -]?block$/i.exec(n.trim())?.[1]?.toUpperCase();
      const dept = /department/i.test(deptName);
      return {
        ...base,
        display: deptName || 'Academic Block',
        roomLen: 7.5,
        rooms: (f, count) => {
          const out: RoomSpec[] = [];
          let lab = f === 0 ? 0 : Math.ceil(labs.length / 2);
          let cls = 0;
          const fixed = f === 0 && dept ? [spec('Head of Department', 'chief'), spec('Department Office', 'office')] : f === 0 ? [spec(block ? `${block} Block Office` : 'Office', 'office')] : [spec('Faculty Room', 'office')];
          out.push(...fixed);
          while (out.length < count - 1) {
            // Labs and classrooms in turn (departments), classrooms only in the lettered blocks.
            if (dept && lab < labs.length && out.length % 2 === 0) {
              const [ln, lk] = labs[lab++];
              out.push(spec(ln, lk));
            } else out.push(spec(block ? `Classroom ${block}-${f}${String(++cls).padStart(2, '0')}` : `Classroom ${numbered('', f, cls++)}`, 'classroom'));
          }
          out.push(spec('Washroom', 'washroom'));
          return out.slice(0, count);
        },
      };
    }
    case 'admin':
      return {
        ...base, display: 'Administration Block', roomLen: 5.5,
        rooms: (f, count) => fill(f === 0
          ? ["Campus Chief's Office", "Assistant Campus Chief's Office", 'Meeting Room', 'Records Room', 'Planning Section', 'Store', 'Washroom']
          : ['Meeting Room', 'Records Room', 'Store', 'Washroom'], count, (k) => `Office ${f}${String(k + 1).padStart(2, '0')}`).map((x) => spec(x)),
      };
    case 'complex':
      return {
        ...base, display: 'Campus Building', roomLen: 6.5,
        rooms: (_f, count) => fill(['Green Room', 'Store', 'Office', 'Washroom'], count, (k) => `Classroom ${k + 1}`).map((x) => spec(x)),
      };
    case 'hostel': {
      const girls = /girls/i.test(n);
      return {
        ...base, display: n || 'Boys Hostel', roomLen: 3.7, corridor: 2.0,
        rooms: (f, count) => {
          const out: RoomSpec[] = f === 0
            ? [spec('Warden Room', 'warden'), spec('Common Room', 'common'), spec('Mess Hall', 'mess'), spec('Kitchen', 'kitchen')]
            : [];
          let k = 0;
          while (out.length < count - 1) out.push(spec(`Room ${f}${String(++k).padStart(2, '0')}`, 'dorm'));
          out.push(spec(girls ? 'Washroom (Girls)' : 'Washroom', 'washroom'));
          return out.slice(0, count);
        },
      };
    }
    case 'quarters':
      return {
        ...base, display: 'Staff Quarters', roomLen: 4, corridor: 1.6, signs: false, doorW: 1.2, doorH: 2.2, backDoor: false,
        rooms: (_f, count) => Array.from({ length: count }, (_, k) => {
          const cycle: RoomSpec[] = [spec('Living Room', 'living'), spec('Bedroom', 'bedroom'), spec('Kitchen', 'kitchen'), spec('Bathroom', 'washroom'), spec('Bedroom', 'bedroom')];
          return { ...cycle[k % cycle.length] };
        }),
      };
    case 'workshop': {
      const sub = WORKSHOP_SUB.find(([re]) => re.test(n))?.[1] ?? 'generic';
      return {
        ...base, layout: 'hall', display: n || 'Workshop', doorW: 3.6, doorH: 3.2,
        hall: { name: n || 'Workshop', kind: 'workshop', sub },
        endRooms: [spec('Instructor Room', 'office'), spec('Tool Store', 'store')],
      };
    }
    case 'lab': {
      const civil = /civil/i.test(n);
      return {
        ...base, layout: 'hall', doorW: 2.4,
        hall: { name: n, kind: civil ? 'civilLab' : 'electricalLab' },
        endRooms: [spec('Lab Office', 'office'), spec(civil ? 'Sample Store' : 'Equipment Store', 'store')],
      };
    }
    case 'library':
      return { ...base, layout: 'hall', display: n || 'Library', hall: { name: n || 'Library', kind: 'library' }, endRooms: [spec("Librarian's Office", 'office'), spec('Periodicals', 'reading')] };
    case 'store':
      return { ...base, layout: 'hall', doorW: 3.0, hall: { name: n || 'Store', kind: 'store' }, endRooms: [spec('Store Office', 'office')] };
    case 'power':
      return { ...base, layout: 'hall', doorW: 3.0, doorH: 3.0, hall: { name: n || 'Power House', kind: 'power' }, endRooms: [spec('Control Room', 'office')] };
    case 'garage':
      return { ...base, layout: 'hall', doorW: 3.6, doorH: 2.8, hall: { name: n, kind: 'garage', sub: /car wash/i.test(n) ? 'carwash' : 'bikes' } };
    case 'shop':
      return { ...base, layout: 'single', doorW: 1.6, hall: { name: 'Photocopy & Stationery', kind: 'shop' } };
    case 'union':
      return { ...base, layout: 'hall', doorW: 1.6, hall: { name: n, kind: 'union' }, endRooms: [spec('Store', 'store')] };
    case 'farm':
      return { ...base, layout: 'hall', doorW: 2.0, hall: { name: n, kind: 'farm' } };
    case 'toilet':
      return { ...base, layout: 'single', doorW: 1.2, doorH: 2.2, hall: { name: 'Toilet', kind: 'washroom' } };
    case 'guard':
      return { ...base, layout: 'single', doorW: 1.0, doorH: 2.1, hall: { name: n, kind: 'guard' } };
    case 'changing':
      return { ...base, layout: 'single', doorW: 1.2, doorH: 2.2, hall: { name: n, kind: 'changing' } };
    case 'utility':
      return { ...base, layout: 'single', doorW: 1.2, doorH: 2.2, signs: false, hall: { name: 'Store Room', kind: 'utility' } };
    case 'block':
    default:
      return {
        ...base, display: n || 'Campus Building', roomLen: 5.5,
        rooms: (_f, count) => fill(['Office', 'Staff Room', 'Store', 'Washroom'], count, (k) => `Room ${k + 1}`).map((x) => spec(x)),
      };
  }
}

/** The first `count` names: the list, then generated ones. */
function fill(list: string[], count: number, gen: (k: number) => string): string[] {
  const out = list.slice(0, count);
  let k = 0;
  while (out.length < count) out.push(gen(k++));
  return out;
}

