/** Release notes shown on the setup screen. Add a new entry at the top for
 *  each published version. Keep entries tight — this panel is glanceable,
 *  not a changelog archive. */
export interface PatchNote {
  version: string
  date: string        // YYYY-MM-DD
  items: string[]
}

export const PATCH_NOTES: PatchNote[] = [
  {
    version: '1.2.8',
    date: '2026-04-21',
    items: [
      'Floor plan: doors, windows, and garage doors now render as blueprint symbols (door swing arcs, window mullions, garage-door dashed lines) with width labels',
      'Window and garage-door widths now shown in the left-side dim tier (previously only people doors)',
      'Reference image: upload a photo or blueprint of an existing garage, trace walls over it in the 2D floor plan (hidden in export PDF)',
      'Fill Lowers / Uppers / Lockers buttons on each wall — auto-packs stock-size cabinets around existing doors/windows',
      'Baseboards & stem walls now adjustable in wall edit mode (drag to move, edge handles to resize, snap to everything)',
      'Step-ups snap to walls at any angle (not just axis-aligned); new lock toggle',
      'Lock buttons added to shapes, step-ups, racks, baseboards, and stem walls',
      'Stem wall default thickness reduced to 1/8" (reads as a wall surface coat)',
      'Clicking empty space in the 2D floor plan deselects the wall',
      'Clicking a door/window in 3D highlights only the opening, not the wall',
      'Exterior wall face overlay changed from red to green (you can put things on that side)',
      'STEP / BB / SW segments now labeled in the wall-edit dim tier (and the exported PDF)',
      'Fixed: two selection bugs where an item and a wall could both stay selected',
      'Fixed: clicking a wall now properly deselects any previously selected baseboard/stem wall',
    ],
  },
  {
    version: '1.2.7',
    date: '2026-04-19',
    items: [
      'Garage door openings resize via top-left / top-right handles (3D + wall edit mode)',
      'Garage doors draggable along the wall in wall edit mode',
    ],
  },
  {
    version: '1.2.6',
    date: '2026-04-19',
    items: [
      'New Custom Plain door — procedural slab + frame + handle, resizable to any width/height',
      'Separate door & frame color pickers (uses wall palette)',
      'Click + drag doors and windows in 3D and wall elevation view',
      'Top-corner resize handles on doors/windows when selected',
      'Wall items snap to door/window edges (procedural doors: outer casing)',
      'Door width shown in outside dimension tiers (floor plan + elevations + PDF)',
      '24" Upper Corner cabinet (renamed from Corner Upper)',
      'Window frames render flush with the wall',
      'Wall info dropdown persists when clicking off the wall',
      'Shots save in wireframe mode when taken from wireframe view',
      'Fixed: baseboards sit flush on the wall (no more 1/2" gap after drag or + Baseboard)',
    ],
  },
  {
    version: '1.2.5',
    date: '2026-04-19',
    items: [
      'New corner upper cabinet (Technica + Signature) — snaps to inside wall corners',
      'All upper cabinets changed from 18" to 14" deep',
      'New 28" 1-Drawer 2-Door Lower preset (both lines)',
      'Baseboards & stem walls hard-clamp at interior corners — no more clipping through walls',
      'Floor plan walls now render as clean outlines with right-angle corners',
      'Corner angle labels default to hidden',
      'Fixed: spawning baseboard/stem wall no longer keeps the wall selected',
    ],
  },
  {
    version: '1.2.4',
    date: '2026-04-18',
    items: [
      'Floor plan wall editing',
      'Corner angles & persistent textures',
      'Guide panel added',
    ],
  },
  {
    version: '1.2.3',
    date: '2026-04-10',
    items: [
      'Freeform step-up polygons',
      'Signature handle fixes',
      'Drag handle improvements',
    ],
  },
  {
    version: '1.2.2',
    date: '2026-04-05',
    items: [
      'Signature door handles',
      'Step-up snapping',
      'Baseboard fixes',
      'Model catalog cleanup',
    ],
  },
  {
    version: '1.2.1',
    date: '2026-03-28',
    items: [
      'Wall selection face highlights',
      'Gap labels on all walls',
    ],
  },
  {
    version: '1.2.0',
    date: '2026-03-22',
    items: [
      'Dimension system polish',
      'New project + save flow',
      'Export quality fix',
    ],
  },
  {
    version: '1.1.9',
    date: '2026-03-15',
    items: [
      'Lighting overhaul — LED bars',
      'Dim system rework',
      'Save-as-new',
      'Reflection + cabinet snap fixes',
    ],
  },
]
