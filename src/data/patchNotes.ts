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
    version: '1.2.18',
    date: '2026-04-21',
    items: [
      'Bottom drag handles on windows and doors in 3D — adjust the sill height by dragging the bottom corners',
      'Floor Offset measurement in opening details — type the sill height directly in inches',
      'Elevation dim line in wall edit mode shows how high a window sits off the floor',
      'Switching window 3D styles now loads the new model without blanking the scene',
      'Section renamed from "Openings" to "Window / Door / GD"',
    ],
  },
  {
    version: '1.2.17',
    date: '2026-04-21',
    items: [
      'Selecting a wall in 3D and switching to wall-edit mode now opens that wall',
      'Signature upper cabinet heights changed to 28" (was 30.5")',
    ],
  },
  {
    version: '1.2.16',
    date: '2026-04-21',
    items: [
      'Autosave now runs one final save when you close the app via the X button',
      'Fixed autosave "Saved" pill appearing every 3 seconds even when no edits were made',
    ],
  },
  {
    version: '1.2.15',
    date: '2026-04-21',
    items: [
      'Built-in projects folder at Documents\\Garage Living Projects — new projects auto-create a "<Customer Name> design" subfolder and seed it with the initial save',
      'Autosave — every edit silently overwrites the project file 3 seconds after the last change (no download, no dialog)',
      'Autosave indicator in the bottom-right corner shows "Saving…" / "Saved" status',
      'Open Project dialog now defaults to the projects folder',
    ],
  },
  {
    version: '1.2.14',
    date: '2026-04-21',
    items: [
      'New Signature Shallow cabinet line — 18" deep lowers and lockers (shared uppers); sub-button row under the Signature tab switches between Signature and Signature Shallow',
      'Signature tab now shows first, before Technica',
      'Baseboards & stem walls snap to garage door inside edges and stay visible on walls with a garage door in wall edit mode',
    ],
  },
  {
    version: '1.2.13',
    date: '2026-04-21',
    items: [
      'Baseboards & stem walls now show in the wall-elevation pages of the export PDF (with flake texture when enabled)',
      'Save now silently overwrites the original file after opening a project — no new download each time',
    ],
  },
  {
    version: '1.2.12',
    date: '2026-04-21',
    items: [
      'Double Closet door style — new tile in the door settings renders two slabs with trim, outer hinges, and center-pull knobs',
      'Baseboards & stem walls now snap to wall corners at any angle, using the same face-face intersection logic as step-up corner snap',
      'Door knob rides with the door when repositioning vertically (previously stayed at a fixed 36" world height)',
      'Baseboards & stem walls snap to the outer casing edge of any procedural door (including the new Double Closet)',
    ],
  },
  {
    version: '1.2.11',
    date: '2026-04-21',
    items: [
      'Scale + rotation sliders for any placed item (imported models and catalog models) — select an item in the Vehicles tab and drag to resize or spin in place',
      'Setup screen + launcher panels now scale with the window — patch notes and feedback panels no longer get cut off on small laptop screens',
    ],
  },
  {
    version: '1.2.10',
    date: '2026-04-21',
    items: [
      'Door swing side — new Interior / Exterior toggle in the door settings controls which side of the wall the swing arc shows on the 2D floor plan',
      'Garage door Left Wall and Right Wall inputs now resize the door opening (opposite side stays put, wall length never changes)',
    ],
  },
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
