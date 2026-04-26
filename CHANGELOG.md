# Changelog

All notable changes to Garage Living Designer are recorded here. The `Unreleased`
section accumulates changes since the last tagged release; when publishing,
move the contents into a new dated version heading and reset `Unreleased`.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

---

## Unreleased

_(No changes yet.)_

---

## [1.2.17] — 2026-04-21

### Features

- **Selected wall opens in wall edit mode.** When you click a wall in 3D
  view and then switch to wall-edit (elevation) mode, that wall is now
  the one displayed instead of whatever wall was last viewed.

### Updates

- **Signature upper cabinet heights.** All four Signature uppers (36"
  2-Door, 28" 2-Door, 20" 1-Door, and 24" Corner) now ship at **28"H**
  instead of 30.5"H, matching the spec.

---

## [1.2.16] — 2026-04-21

### Features

- **Save-before-close.** When the user clicks the window X, the main
  process pauses the close, asks the renderer to flush a final autosave,
  then actually closes the window. A 4-second watchdog prevents a
  frozen renderer from blocking quit.

### Bug fixes

- **Autosave "Saved" pill no longer appears every 3 seconds.** The
  autosave status was living in the Zustand store, so writing
  `autosaveStatus: 'saved'` re-triggered the store subscribe listener
  that schedules the next save — creating an infinite save/indicator
  loop. Status moved out to a standalone event emitter consumed via
  `useSyncExternalStore`, so it no longer feeds back into the autosave
  timer.

---

## [1.2.15] — 2026-04-21

### Features

- **Built-in projects folder + autosave.** On first use, the app creates
  `Documents\Garage Living Projects\`. When a new project is started the
  app auto-creates a subfolder named `"<Customer Name> design"` and seeds
  it with `project.garage`. Every edit triggers a silent overwrite
  3 seconds later — no download, no dialog.
- **Autosave indicator.** A small pill in the bottom-right corner shows
  "Saving…" (pulsing blue dot) while the write is in flight and "Saved"
  (green dot) for ~2 seconds after completion, then fades out.
- **Open Project dialog lands in the projects folder** by default, so
  users see their auto-saved projects immediately.

---

## [1.2.14] — 2026-04-21

### Features

- **Signature Shallow cabinet line.** New sub-variant under the Signature
  tab with 18"-deep lowers and lockers (instead of 24"). Upper cabinets
  and corner uppers are shared between both variants. Signature now
  appears first in the tab row, with a sub-button row that switches
  between **Signature** and **Signature Shallow**. Each shallow SKU is
  suffixed `-S` and priced ~$20–40 less than its standard counterpart.
- **Baseboards & stem walls snap to garage door inside edges.** The 2D
  elevation snap loop was skipping `garage-door`; now included. The 3D
  opening-edge snap threshold was also widened from 2" to 8" so the
  moving end locks onto the door inside edge reliably.
- **Baseboards stay visible on walls with a garage door.** In wall edit
  mode, baseboards and stem walls now render after openings in SVG order
  so the opening's opaque fill doesn't cover them.

### Bug fixes

- **Resize snap to opening edges.** The resize path only snapped to
  wall endpoints, joint corners, pieces, and steps — door/window/garage
  edges were missing. Now snaps to any opening's inside edge on the
  wall the piece is running along.

---

## [1.2.13] — 2026-04-21

### Features

- **Baseboards & stem walls now render in the wall-elevation export.**
  Projected onto each wall and drawn as rectangles at the correct height.
  When a piece has `flake` enabled, an SVG pattern is built from the
  flooring texture so the elevation export matches the 3D view; stem
  walls use a dashed stroke to match the floor-plan convention.
- **Save silently overwrites the original file.** When a project is
  opened via the native Electron dialog (or saved for the first time),
  the file path is remembered and subsequent Saves write directly to
  that file — no download, no "(1)"/"(2)" suffixes, no dialog.
  Three new Electron IPC handlers: `project-open`, `project-save-as`,
  `project-save`.

---

## [1.2.12] — 2026-04-21

### Features

- **Double Closet Door style.** New "Double Closet" tile in the door settings
  renders two slabs meeting at the center with trim, outer hinges, and
  center-pull knobs. Size-adjustable and color-customizable like the Custom
  Plain door. Shows as a blueprint symbol in the 2D floor plan.
- **Baseboards & stem walls now snap to wall corners** using the same
  face-face intersection math as step-up corner snap. Snaps to visible
  joint corners (interior and exterior) at any wall angle — drag the piece
  or its resize handle near a corner and it locks to the exact point where
  the wall faces meet.

### Bug fixes

- **Door knob moves with the door.** When repositioning a procedural door
  vertically, the knob now rides with the slab (previously stayed at a
  fixed 36" world height).
- **Baseboards & stem walls can now reach visible corners** — the hard
  clamp at wall centerline endpoints was blocking the piece from
  extending to joint-corner positions that sit past the endpoint (obtuse
  corners and mitered face extensions). Clamps now span the joint-corner
  along range on each wall.
- **Baseboards & stem walls snap to doorframe edges** — the snap logic
  was hard-coded to `custom-plain` and missed the new `custom-double`
  plus any future procedural doors; now detects procedural doors via
  `getOpeningModelById` so the casing trim edge is a snap target.
- **Wider adjacent-wall detection** for corner snap — increased endpoint
  proximity threshold from 6" to 18" plus T-joint detection (where
  another wall's endpoint sits on this wall's line near an endpoint).

---

## [1.2.11] — 2026-04-21

### Features

- **Placed-item transform sliders.** Selecting any item in the Vehicles tab
  (imported GLB models or catalog models) shows a Transform panel with
  uniform scale (0.10×–5×) and Y-axis rotation (0–360°) sliders plus
  Reset buttons. Updates live in the 3D view.

### Bug fixes

- **Launcher / setup screen panels no longer get cut off on small laptop
  screens.** `.setup-overlay` scrolls, `.setup-modal` caps at
  `100vh - 40px` with internal scroll, `.setup-patchnotes` caps at
  `min(300px, 42vh)` with a 160px minimum, and the feedback textarea
  uses `clamp(60px, 14vh, 100px)` so the whole setup layout adapts down
  to roughly 800×500 viewports.
- **Scale slider now actually resizes the model.** `ItemMesh` was
  applying position and Y-rotation but ignoring `item.scale` —
  the `<group>` now passes `scale` through to Three.js.

---

## [1.2.10] — 2026-04-21

### Features

- **Door swing side** — new **Interior / Exterior** toggle in the door
  settings controls which side of the wall the swing arc is drawn on in the
  2D floor plan. Persists per door. Defaults to Interior.

### Bug fixes

- **Garage door Left/Right Wall inputs** no longer resize the wall. They
  now resize the door opening itself, pinning the opposite side in place
  (wall length stays unchanged, opposite wall-side dimension stays
  unchanged). 12" minimum opening width enforced.

---

## [1.2.9] — 2026-04-21

Patch release — no user-visible code changes. Adds a `1.2.8` entry to the
in-app launcher patch-notes panel (`src/data/patchNotes.ts`) which was
missed during the 1.2.8 publish, so existing 1.2.8 users see the real
1.2.8 highlights instead of the stale 1.2.7 notes.

WORKFLOW.md updated so future releases include `patchNotes.ts` in the
publish checklist.

---

## [1.2.8] — 2026-04-21

Patch release — no save-format change (reads 1.2.7 projects unchanged).

### Features

- **Wall editing**
  - Length changes now shorten from whichever end is NOT connected to another
    wall (preserves corners when resizing).
  - Locked walls: endpoint drag, body drag, length/height/thickness inputs all
    respect the lock in both 2D floor-plan view and 3D view.
  - Clicking a door/window on a wall now highlights ONLY the opening — the wall
    outline, endpoint handles, and face overlays are suppressed while an
    opening is selected.
  - Opening resize handles show only on the specifically-selected opening, not
    every opening on the selected wall.
- **Step-ups**
  - Added `locked` flag — locks drag, corner drag, add/remove corner.
  - Snap logic now works at *any* wall angle, not only axis-aligned walls.
    Step-ups snap to corners and any point along a wall's interior face.
  - Lock toggle in the step-up list row.
- **Shapes, racks, baseboards, stem walls** all gained lock buttons that
  freeze drag/resize and disable measurement inputs when locked.
  - Overhead rack lock + rotate buttons moved into the list-row header
    next to the name (matches cabinets, step-ups, shapes).
- **Baseboards / stem walls**
  - Stem wall default thickness is now `0.125"` (¼ of a baseboard).
  - Pieces snap end-to-end to each other, to wall corners, to wall interior
    faces at any angle, and to step-up corners during body-drag and resize.
  - A piece's bottom snaps to step-up top and cannot clip into the step.
  - In wall edit mode, pieces are now click-selectable, body-draggable, and
    edge-resizable, with full snapping to cabinets, countertops, openings,
    wall edges, other pieces, and step edges.
  - Clicking empty space in wall edit mode deselects pieces.
  - Each piece shows its label in wall edit mode.
- **Wall edit mode dimension tier** — left-side vertical dim column now
  labels `STEP`, `BB`, and `SW` height segments. Propagated to the exported
  PDF blueprint (dealer proposals).
- **3D drag handles** unified to a single light-blue sphere across all
  entities — matches the floor-plan blue-circle handles.
- **Exterior-face overlay** changed from red (`#ef4444`) to green (`#22c55e`)
  so the "you *can* put things on this side" affordance reads correctly.
- **F3 — Floor plan tracing reference image.** Upload a photo or blueprint
  of an existing garage as a background layer in the 2D floor plan view.
  Drag to position, corner-drag to resize (keeps aspect ratio), opacity
  slider, lock toggle, delete. Persists with the `.garage` save. Hidden in
  the exported PDF blueprint (tracing aid only). Controls live at the top
  of the Walls sidebar tab.
- **F2 — Fill wall with stock cabinets.** Three new buttons in the wall
  detail panel (*Fill Lowers / Uppers / Lockers*) auto-pack the wall's open
  stretches with stock cabinet widths using an integer-DP best-fit. Respects
  existing openings (doors, windows, garage doors split the fill into
  segments), centers any leftover gap, places cabinets flush to the
  interior face.
- **Floor plan openings now render as blueprint symbols.** Doors draw with
  a perpendicular leaf + dashed 90° swing arc; windows draw with three
  parallel mullion lines; garage doors draw with a bold dashed panel line.
  Each opening also shows an inline width label that rotates to stay
  readable on angled walls (`36"`, `W 48"`, `GD 108"`). The wall face lines
  are cleanly broken at each opening with perpendicular jambs.
- **Opening width labels in the dim tier** — windows and garage doors now
  get their own tier entries alongside doors (previously only doors were
  dimensioned). Color-coded: DOOR red, WINDOW teal, GD brown.
- **Clicking empty space in the 2D floor plan deselects the current wall.**
  Previously the selection stuck (required Escape).

### Bug fixes

- Fixed two selection cross-contamination bugs where `selectSlatwallAccessory`
  and `selectItem` left sibling selections active (a wall or cabinet could
  stay visually selected at the same time as an accessory or item).
  [store] (see M2 below for the structural fix that prevents recurrence.)
- Fixed `selectWall` not clearing baseboard / stem-wall / countertop selection
  — previously clicking a wall left a selected baseboard highlighted.
- Fixed ghost re-renders on every drag — two state variables
  (`_wallDragActive`, `_activeSnapPt`) were being set but never read.

### Refactors (no user-visible change, safer going forward)

- **M1 — geometry helpers consolidated.** New `src/utils/wallGeometry.ts`
  replaces ~230 lines of duplicated `wallLen` / `wallDir` / `wallNormal` /
  `projectCabinet` / `projectCountertop` / `isCabinetOnWall` /
  `isCountertopOnWall` / `getStepWallProjection` / `pointInPolygon` /
  `pointInPoly` across 5 files. All views now compute projections the same
  way; `ExportModal` also got the upgraded corner-upper-aware cabinet check.
- **M2 — selection actions unified.** Added a single `SELECTION_CLEAR`
  constant listing every `selected*Id` field; all 13 `select*` actions now
  spread it, eliminating ~110 hand-maintained sibling-clear assignments and
  making the two bugs above impossible to re-introduce.
- **M3 — save/load migration registry.** Added `CURRENT_VERSION`, `MIGRATORS`,
  `migrateProject()`, `normalizeLoadedProject()` in `garageStore.ts`. Load
  path now runs *parse → migrate → normalize → assign* as a 4-step pipeline.
  `CURRENT_VERSION` stays at **1** for this release — no save format change —
  but the framework is in place so future schema changes (e.g. adding a
  required cabinet field) can ship a migrator without breaking saved projects.
- **Q1 — dead code removed.** Deleted 4 unused util exports (`snap16`,
  `snapToWallEndpoints`, `ftInToInches`, `getModelDimensions`); dropped a
  legacy `bbH` variable from both elevation views; fixed two stale JSDoc
  comments (baseboard thickness, stem-wall inset math).

### Pipeline & developer notes

- **Save format stays at `_version: 1`.** Existing user projects load without
  migration. The migration registry is additive; saves produced by 1.2.8
  remain readable by 1.2.7 (same schema).
- **Adding a future required field**: bump `CURRENT_VERSION` in
  `garageStore.ts`, add a `MIGRATORS[prevVersion]` that returns new-shape data
  from old-shape data. Old saves auto-migrate on load.
- **New files to commit**: `src/utils/wallGeometry.ts`,
  `src/utils/cabinetFill.ts`, `src/components/TracingImageControls.tsx`,
  `CHANGELOG.md` (this file).
- **Artifact files** generated during the review session (not required for the
  build): `REVIEW.html`, `REVIEW.pdf`. Safe to commit or `.gitignore` at your
  discretion — neither is imported by the app.

---

## [1.2.7] — prior release

Garage door opening resize handles; wall-edit drag. See commit `95b3c61`.

## [1.2.6]

Custom plain door, drag/resize openings, wall-item snap to openings, measurement overhaul. Commit `e5fbcfe`.

## [1.2.5]

Corner upper cabinet, 14" upper depth, baseboard/stem-wall snap improvements. Commit `439b763`.

Older history — see `git log --oneline`.
