import { useState } from 'react'

interface Section {
  title: string
  body: string[]
}

const SECTIONS: Section[] = [
  {
    title: 'Getting started',
    body: [
      'When you open a new project, enter the customer name, site address, and garage dimensions in the setup screen.',
      'The 3D view loads showing a blank garage. Use the left sidebar to add walls, flooring, cabinets, lights, and accessories.',
      'Save often from the top bar (Save / Project menu). Projects save as .garage files including imported models and textures.',
    ],
  },
  {
    title: 'View modes',
    body: [
      '3D — perspective view for walking the space. WASD to move, right-click drag to rotate, scroll to zoom. Click objects to select, click empty space to deselect.',
      'Wireframe — same controls, simplified geometry and no lighting. Useful when the scene feels heavy.',
      'Floor Plan — top-down 2D view. Scroll to zoom, middle/right-click drag to pan. Click walls to edit, drag endpoint handles to reshape.',
      'Wall Edit — 2D blueprint of one wall. Switch walls with the arrows in the header, toggle interior/exterior side. Drag panels, cabinets, baseboards to reposition and resize.',
    ],
  },
  {
    title: 'Walls',
    body: [
      'Add walls, set length/height/thickness, assign wall color or texture.',
      'Add wall openings (garage door, entry door, window) on any wall.',
      'Floor Plan view: click a wall to select — blue endpoint circles appear. Drag endpoints to reshape, drag wall body to translate. Hold near 0°/45°/90° to lock the angle.',
      'Use the Angle Snap and Angle Labels toggle buttons at the bottom-right of the Floor Plan to control magnetic 45° snapping and corner-angle readouts.',
    ],
  },
  {
    title: 'Flooring & step-ups',
    body: [
      'Pick a flooring color (Flake, Stone, Concrete, or imported texture). The Chip Scale slider controls pattern size.',
      'Click "Add Step Up" to place a raised platform. It appears as a rectangle by default.',
      'In 3D or Floor Plan view, drag the blue corner handles to reshape into any polygon. Click green midpoint handles to add a new corner. Right-click a corner to remove it (minimum 3).',
      'Step-up corners snap to walls, wall corners, and other step-ups.',
    ],
  },
  {
    title: 'Baseboards & stem walls',
    body: [
      'Baseboard — decorative strip along a wall, sits flush. Stem wall — recessed 1" into the wall, used for structural bases/curbs.',
      'Both are added from the Walls tab. Drag to reposition along a wall or drag end handles to resize length.',
      'Enable the Flake toggle to apply the floor texture to the front face — adds that face to the total flooring area.',
      'Cabinets will snap to the top of baseboards and stem walls on the same wall.',
    ],
  },
  {
    title: 'Cabinets',
    body: [
      'Open the Cabinets tab and switch between Technica or Signature lines. Click any preset thumbnail to add it.',
      'Drag in 3D or wall-edit view to reposition. Cabinets slide along their wall and snap to walls, corners, each other, and baseboard tops.',
      'Rotate, lock position, choose cabinet/door/handle color, or add a countertop (width and material configurable).',
      'Signature doors have a chamfered inner edge with a brushed aluminum finger-pull channel. Handle side (left/right) is togglable on single-door units.',
    ],
  },
  {
    title: 'Overhead racks',
    body: [
      'Pick from the Overhead tab — 7 preset sizes. Drag in 3D or floor plan. Rotate 90° with the rotate handle in floor plan view.',
      'Set ceiling drop (distance from ceiling down to rack top). Racks snap to walls and corners.',
    ],
  },
  {
    title: 'Lighting',
    body: [
      'Ceiling lights — bar, puck, or LED-bar fixtures. Choose warm/cool/daylight color temperature and intensity.',
      'Scene lights — point or spotlight fixtures with custom color, decay, and cone angle for spots.',
      'Toggle any light on/off without deleting. All lights render in real time.',
    ],
  },
  {
    title: 'Shapes & vehicles',
    body: [
      'Shapes tab — add boxes, columns, or beams (configurable width/depth/height or diameter). Assign color or texture.',
      'Vehicles tab — browse the model catalog or import your own .glb/.gltf/.obj file via the Import Model button in the top bar.',
      'Imported models persist across app sessions automatically.',
    ],
  },
  {
    title: 'Import & export',
    body: [
      'Import Model — .glb/.gltf/.obj vehicles or furniture. Models are cached locally and survive app restarts.',
      'Textures button — upload custom .jpg/.png or PBR-zip textures for walls, floors, and shapes. Available to every project.',
      'Export PDF — generates a multi-page PDF with 3D renders, floor plan, wall elevations, and pricing.',
    ],
  },
  {
    title: 'Snapping',
    body: [
      'Snap toggle (floor plan and wall edit) — turn off all magnetic snapping when you need precise free placement.',
      'Angle Snap — locks wall endpoint drags to 0°/45°/90° directions.',
      'Angle Labels — shows the degree reading at every wall corner and T-junction.',
      'Hold Shift while dragging in 3D to temporarily disable snapping.',
    ],
  },
  {
    title: 'Keyboard shortcuts',
    body: [
      '? — open this help.',
      'Esc — deselect / close modals.',
      'Delete or Backspace — remove the selected object.',
      'WASD — walk the 3D camera. Space/Ctrl — up/down.',
      'Ctrl+click — duplicate the selected cabinet, panel, or countertop in wall edit mode.',
    ],
  },
]

export default function GuidePanel() {
  const [openIdx, setOpenIdx] = useState<number | null>(0)

  return (
    <div style={{ padding: '4px 2px 12px', fontSize: 12.5, lineHeight: 1.45, color: '#d0d5dd' }}>
      <div style={{ fontSize: 11, color: '#8a93a0', marginBottom: 10, lineHeight: 1.5 }}>
        Quick reference for every feature. Tap a section to expand.
      </div>
      {SECTIONS.map((s, i) => {
        const open = openIdx === i
        return (
          <div key={s.title} style={{
            borderTop: i === 0 ? '1px solid #2a313a' : undefined,
            borderBottom: '1px solid #2a313a',
          }}>
            <button
              onClick={() => setOpenIdx(open ? null : i)}
              style={{
                width: '100%', textAlign: 'left', background: 'transparent',
                border: 0, color: '#e9ecf1', padding: '9px 4px',
                cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <span>{s.title}</span>
              <span style={{ color: '#8a93a0', fontSize: 10, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'none' }}>▸</span>
            </button>
            {open && (
              <div style={{ padding: '0 4px 10px' }}>
                {s.body.map((p, pi) => (
                  <p key={pi} style={{ margin: '0 0 7px', color: '#c6ccd6' }}>{p}</p>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
