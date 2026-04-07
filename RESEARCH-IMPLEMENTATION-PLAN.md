# Garage Living 3D Designer — Research & Implementation Reference

## Current Codebase Issues

### 1. Monolithic Drag Handler
- GarageShell.tsx is ~3,300 lines with single `onMove` checking 13 drag ref types
- Race conditions between drag types
- No clear state machine — just `if (ref.current)` checks

### 2. Missing Grab Offset
- Several drag handlers set position directly to ray-plane intersection
- Causes "object jumps to cursor" bug
- Cabinet drag has offset, but items/shapes don't always

### 3. AABB Collision Ignores Rotation
- `cabinetOverlapsAny()` uses axis-aligned bounding boxes
- Wrong for rotated cabinets — false positives and missed collisions

### 4. Collision is Visual-Only
- Overlapping cabinets get red tint but placement isn't prevented
- Objects can clip through walls, stack inside each other

### 5. No Pointer Capture
- Fast mouse movement drops drag mid-operation
- No `setPointerCapture()` / `releasePointerCapture()`

### 6. Floor Raycasting at Y=0 Only
- `floorHit()` always intersects XZ plane at Y=0
- Fails for wall-mounted items at different heights

### 7. OrbitControls Conflict
- Single `isDraggingWall` boolean for all 13 drag types
- If any drag cleanup fails, orbit controls stay disabled

---

## Industry Best Practices (From Research)

### Cabinet Vision
- Hot-point snapping: endpoints, midpoints, center-points, intersections
- Visual cursor-lock feedback when near snap points
- Sizing handles with direction-specific resizing
- User-placeable snap marks as persistent reference points
- Context-aware placement: wall cabinets on walls, base cabinets on floors

### 2020 Design
- 3-inch snap threshold for edge-to-edge (proven professional value)
- Hatch pattern overlay on colliding objects
- Modifier keys: Shift = disable snap, Ctrl = disable collision
- Persistent toolbar toggles with momentary keyboard overrides

### SketchUp Inference Engine
- Color-coded snap indicators: green=endpoint, cyan=midpoint, red=on-edge, blue=on-face
- Axis-colored alignment lines (red/green/blue dotted lines)
- "Pause to register" — hover briefly, then alignment lines extend from that point
- Shift locks inference direction, arrow keys force specific axes

### IKEA Kitchen Planner
- Auto-orient to wall: dragging cabinet toward wall auto-rotates it
- Snap-to-adjacent: cabinets magnetically align with neighbors
- 2D panel to 3D scene drag pattern
- Popmotion for physics-based micro-animations

---

## Technical Solutions

### A. Drag State Machine (Replace monolithic handler)

States: `IDLE → HOVER → DRAG_START → DRAGGING → DRAG_END → IDLE`

Each object type gets own drag strategy:
- **FloorDragStrategy**: Raycast XZ plane, grid snap, floor boundary clamp
- **WallDragStrategy**: Raycast wall's local plane, constrain to wall bounds
- **CeilingDragStrategy**: Raycast ceiling plane, XZ movement only
- **SlatwallDragStrategy**: Raycast parent wall plane, snap to groove positions

Critical patterns:
1. Always calculate grab offset: `offset = object.position - hitPoint`
2. Always use pointer capture: `e.target.setPointerCapture(e.pointerId)`
3. Use refs for drag position (never setState during drag)
4. Separate orbit disable per drag type — use counter, not boolean

### B. Unified Snap Engine

Priority order:
1. Wall snap (4" threshold) — object flush against wall face
2. Edge-to-edge snap (3" threshold) — align with adjacent objects
3. Endpoint/midpoint snap (2" threshold) — lock to corners and centers
4. Grid snap (1" increments) — fallback

Visual feedback:
- Dotted alignment lines from snap point to aligned object
- Small circles at available connection points
- Blue outline = valid, Red outline = collision

Modifier keys:
- Shift during drag = disable snapping
- Ctrl during drag = disable collision
- R = rotate 90°
- Delete = remove selected

### C. OBB Collision Detection

Replace AABB with Oriented Bounding Box:
- Use object's actual rotation for bounding box corners
- Three.js `OBB` from `three/examples/jsm/math/OBB`
- Prevent placement (snap back to last valid position) for cabinets
- Visual warning only for items like cars

### D. Ghost Preview

During catalog drag:
1. Semi-transparent clone follows constrained position
2. Green = valid placement, Red = collision/invalid
3. On release, place or snap back

### E. Camera Upgrade

Switch OrbitControls to `camera-controls` via Drei `<CameraControls>`:
- smoothTime for damping
- setLookAt() for animated preset transitions
- Boundary constraints (no below-floor, no inside-walls)
- Better polar angle limits

Presets with smooth transitions:
- FL, FR, BL, BR perspective (existing)
- Top-down orthographic
- Per-wall elevation views
- Isometric overview

### F. Selection & Outline

Use `@react-three/postprocessing` with Selection/Select/Outline:
- Blue outline for selected
- Green outline for valid drag
- Red outline for collision
- Multi-select with Shift+Click

### G. Undo/Redo

Add `zundo` temporal middleware for Zustand:
- Push snapshots on drag-end, add, delete, rotate (not during drag)
- `partialize` to exclude transient state
- Ctrl+Z / Ctrl+Shift+Z
- Cap at ~50 states

---

## Photorealistic Rendering Upgrades

### Reflective Epoxy Floors
- `MeshReflectorMaterial` from Drei
- Floortex floors have high-gloss mirror-like finish
- Single biggest visual upgrade

### HDR Environment Lighting
- `<Environment preset="warehouse" />` or custom garage HDRI
- Replaces hemisphere + ambient with image-based lighting
- Realistic reflections on steel cabinets

### PBR Materials
- Powder-coated cabinets: metalness 0.0-0.1, roughness 0.35-0.5, orange-peel normal map
- Stainless steel countertops: metalness 1.0, roughness 0.15-0.3, brushed-metal normal
- Slatwall PVC: metalness 0.0, roughness 0.4-0.6, groove normal map
- Floor: clearcoat 1.0, clearcoatRoughness 0.05, chip flake diffuse

### Post-Processing
- SSAO: soft shadows in crevices
- Bloom: subtle glow on LEDs and chrome
- ACES Filmic tone mapping: cinematic contrast
- SMAA anti-aliasing: smooth edges

### Target Aesthetic (Match GL Marketing)
- Bright, even lighting — automotive showroom (4000-5000K)
- Grey/charcoal cabinets, dark flooring
- Clean, modern, luxurious
- Hero shots: wide-angle from garage door looking in

---

## Garage Living Product Reference

### 6 Cabinet Lines
| Line | Gauge | Colors | Drawer Rating |
|------|-------|--------|---------------|
| Vantage | 20ga | Metallic Grey | 88 lb |
| Signature | 18ga | Latte, Granite, Black + special order | 100 lb |
| NEOS Elite | 16ga | Fame Grey, Blue, Red, Yellow, Black, Pebble Grey | 250 lb |
| Rally | 16ga | 9 colors (Orange, Blue, Red, Yellow, Black, White, Green, Copper Vein, Silver Vein) | 125 lb |
| Tecnica | 18ga | 12 colors (Graphite, Harbor Blue, Obsidian, Cloud White, Mica, Ash Grey, Sandstone, Evergreen, Argento Blu, Silver, Ruby, Titanium) | 200 lb |
| Custom Steel | 18ga | 14 colors (Black, Brown, Granite, Cream, Stainless, Beige, Tan, Forest, White, Flint, Gunmetal, Blue, Red, Silver) | 150 lb |

### Countertop Options
- 1.5" stainless steel
- Galvanized steel
- Maple butcher block

### Flooring — FLOORTEX Polyaspartic (NOT Epoxy)
**Classic (18 colors, 1/4" flakes):** Glacier, Smokey, Quicksilver, Charcoal, Basalt, Slate, Blue Nightfall, Nightfall, Carbonite, Harbor Blue, Orbit, Tudor, Sedona, Khaki, Pebble Beach, Cappuccino, Creek Bed, Obsidian
**Stone Series (6 colors, fine flakes):** Limestone, Terrazzo, Natura, Dolomite, Armor, Shale

### Slatwall
- 7 colors: White, Mist, Grey, Gunmetal, Taupe, Harbor Blue, Black
- 96"W x 12"H x 5/8"D per panel
- 40 lbs/sq in, 300 lbs/panel capacity

### 40+ LINEA Slatwall Accessories
Hooks (2", 4", 8" single/double, utility, J-hook, coat, picture, recycling, triple, vertical bike), Holders (ski, fishing rod, paper towel, fire extinguisher, helmet), Shelves (solid 23-46", versatile rail, heavy duty, wire 72", angled shoe), Baskets/Trays (deep mesh, metal floating S/M/L), Bike (universal rack, vertical bracket, Steadyrack), Specialty (tire rack 46"/52", golf caddy, folding vertical rack, magnetic tool rack, brackets, hose reel, dog feeder)

### Overhead Storage
- Heavy gauge steel, powder-coated
- Up to 600 lbs capacity
- 45" adjustable from ceiling
- Sizes: 2x8', 3x6', 3x8', 4x4', 4x6', 4x8'

### Brand
- Primary color: Navy blue #0C263F
- Secondary: #183C5C
- Logo: Clean professional typeface
- Tagline: "Garages Made for Living"

---

## Feature Roadmap (Prioritized)

### Phase 1: Make It Reliable
1. [ ] Refactor drag into state machine with grab offsets + pointer capture
2. [ ] Add OBB collision detection with placement prevention
3. [ ] Unified snap engine (wall → edge → endpoint → grid)
4. [ ] Visual snap indicators (alignment lines, snap dots)
5. [ ] Modifier keys (Shift=no snap, R=rotate, Delete=remove)
6. [ ] Upgrade to CameraControls with smooth transitions

### Phase 2: Make It Beautiful
7. [ ] MeshReflectorMaterial on floors
8. [ ] HDR environment lighting
9. [ ] PBR materials for cabinets/slatwall/floor
10. [ ] Post-processing (SSAO, bloom, tone mapping)
11. [ ] Live color/material swatching

### Phase 3: Make It Professional
12. [ ] Undo/Redo with zundo
13. [ ] Auto-dimensioning on blueprints/elevations
14. [ ] Multi-page branded PDF export
15. [ ] Car placement with clearance zones
16. [ ] Template gallery (5-8 layouts)
17. [ ] BOM/pricing calculation

### Phase 4: Make It Elite
18. [ ] Interactive measurement tool
19. [ ] Design versioning
20. [ ] Shareable viewer links
21. [ ] 4K render export
22. [ ] AR visualization (WebXR)

---

## Key Code Patterns Reference

### Plane-Constrained Dragging
```typescript
// Create constraint plane for a wall
const wallPlane = new THREE.Plane(wallNormal, -wallDistance);
const intersection = new THREE.Vector3();

// On drag start — calculate grab offset
e.ray.intersectPlane(wallPlane, intersection);
grabOffset.copy(mesh.position).sub(intersection);

// On drag move — apply offset to prevent jumping
e.ray.intersectPlane(wallPlane, intersection);
mesh.position.copy(intersection).add(grabOffset);
```

### Pointer Capture (Fix dropped drags)
```typescript
onPointerDown: (e) => {
  (e.target as Element).setPointerCapture(e.pointerId);
}
onPointerUp: (e) => {
  (e.target as Element).releasePointerCapture(e.pointerId);
}
```

### Snap-to-Grid
```typescript
function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}
```

### Edge-to-Edge Snap
```typescript
function findEdgeSnap(draggedBBox, targetBBox, threshold = 3) {
  // Check all 4 edges of dragged against all 4 edges of target
  // Return offset to align nearest matching edges
  const edges = [
    { drag: draggedBBox.max.x, target: targetBBox.min.x }, // right→left
    { drag: draggedBBox.min.x, target: targetBBox.max.x }, // left→right
    // ... vertical edges too
  ];
  // Find closest pair within threshold, return offset
}
```

### OBB Collision
```typescript
import { OBB } from 'three/examples/jsm/math/OBB';
const obb1 = new OBB(center1, halfSize1, rotation1);
const obb2 = new OBB(center2, halfSize2, rotation2);
if (obb1.intersectsOBB(obb2)) { /* collision */ }
```

### Selection Outline
```tsx
<Selection>
  <EffectComposer>
    <Outline blur visibleEdgeColor={0x00aaff} edgeStrength={3} width={1024} />
  </EffectComposer>
  <Select enabled={isSelected}>
    <CabinetMesh />
  </Select>
</Selection>
```

### Undo/Redo with Zundo
```typescript
import { temporal } from 'zundo';
const useStore = create(temporal((set) => ({
  // ... existing store
}), {
  partialize: (state) => {
    const { isDragging, hoveredId, ...rest } = state;
    return rest; // exclude transient state
  },
  limit: 50,
}));
// Usage: useStore.temporal.getState().undo()
```
