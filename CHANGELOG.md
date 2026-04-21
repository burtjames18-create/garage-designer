# Changelog

All notable changes to Garage Living Designer are recorded here. The `Unreleased`
section accumulates changes since the last tagged release; when publishing,
move the contents into a new dated version heading and reset `Unreleased`.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/).

---

## Unreleased

_(No changes yet.)_

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
