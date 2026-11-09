// Corrections to the mapped buildings, by name (as in OpenStreetMap). The map
// data has accurate footprints but floor counts for only a few buildings; set
// the real number here and the game builds it that tall.
//
//   levels:    floors above ground
//   height:    total height in metres (optional; default 3.2-3.5 m per floor)
//   enterable: build a full interior you can walk into (see interior.ts)

export interface BuildingOverride {
  levels?: number;
  height?: number;
  enterable?: boolean;
}

export const BUILDING_OVERRIDES: Record<string, BuildingOverride> = {
  // Three storeys with departments, classrooms and labs inside.
  'Research and Innovation Centre (RIC)': { levels: 3, height: 10.8, enterable: true },
};
