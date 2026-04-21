import { create } from 'zustand'
import { getCachedModelBase64Async, cacheModelBase64 } from '../utils/importedModelCache'

export type ViewMode = 'perspective' | 'wireframe' | 'top' | 'elevation'
export type QualityPreset = 'high' | 'medium' | 'low'
export type SidebarTab = 'walls' | 'flooring' | 'shapes' | 'ceiling' | 'cabinets' | 'overhead' | 'lighting' | 'vehicles' | 'info' | 'guide'

export type LightType = 'point' | 'spot'

// 1ft × 4ft × 2" LED bar — mounts flush to ceiling
export const CEILING_LIGHT_W  = 1      // feet
export const CEILING_LIGHT_L  = 4      // feet
export const CEILING_LIGHT_TH = 2 / 12 // feet (2 inches)

export type CeilingLightKind = 'bar' | 'puck' | 'ledbar'
export interface CeilingLight {
  id: string
  label: string
  kind?: CeilingLightKind  // default 'bar' for backwards compatibility
  x: number     // feet from center
  z: number     // feet from center
  rotY: number  // bar: 0 = long axis along Z, Math.PI/2 = long axis along X (puck: ignored)
  color: string // emitted light color hex (warm white default)
  intensity: number // 0–3
  enabled: boolean
  // ledbar-only: mounted under an upper cabinet. length in inches (draggable),
  // y in feet = world height of fixture bottom face (set from cabinet bottom).
  lengthIn?: number
  y?: number
}

export interface SceneLight {
  id: string
  label: string
  type: LightType
  x: number     // feet from center
  y: number     // feet from floor
  z: number     // feet from center
  color: string // hex
  intensity: number
  enabled: boolean
  // spot-only
  angle: number    // radians (default π/4)
  penumbra: number // 0–1 (default 0.3)
}

export interface ExportShot {
  id: string
  label: string
  // Camera position in Three.js feet units
  camX: number
  camY: number
  camZ: number
  // Look-at target in Three.js feet units
  targetX: number
  targetY: number
  targetZ: number
  // Thumbnail data URL (small preview)
  thumbnail: string
  // View mode the shot was captured in. Optional for backward compat with
  // shots saved before this field existed (treated as 'perspective').
  viewMode?: 'perspective' | 'wireframe'
}

export type CabinetStyle = 'lower' | 'upper' | 'locker' | 'corner-upper'
export type CabinetLine = 'technica' | 'signature'

export interface CabinetPreset {
  key: string
  label: string
  line: CabinetLine
  style: CabinetStyle
  doors: 0 | 1 | 2
  drawers?: number
  w: number
  d: number
  h: number
  sku?: string
  price?: number
}

export const CABINET_PRESETS: CabinetPreset[] = [
  // ── Technica ──────────────────────────────────────────────────────────
  { key: 't-lower-20-1',    label: '20" 1-Door Lower',          line: 'technica', style: 'lower',  doors: 1, w: 20, d: 24, h: 30.5, sku: 'GL-TEC-BASE-20',      price: 249 },
  { key: 't-lower-28-2',    label: '28" 2-Door Lower',          line: 'technica', style: 'lower',  doors: 2, w: 28, d: 24, h: 30.5, sku: 'GL-TEC-BASE-28',      price: 319 },
  { key: 't-lower-36-2',    label: '36" 2-Door Lower',          line: 'technica', style: 'lower',  doors: 2, w: 36, d: 24, h: 30.5, sku: 'GL-TEC-BASE-36',      price: 429 },
  { key: 't-lower-28-1d2d', label: '28" 1-Drawer 2-Door Lower', line: 'technica', style: 'lower',  doors: 2, drawers: 1, w: 28, d: 24, h: 30.5, sku: 'GL-TEC-BASE-28-1D',  price: 389 },
  { key: 't-lower-36-1d2d', label: '36" 1-Drawer 2-Door Lower', line: 'technica', style: 'lower',  doors: 2, drawers: 1, w: 36, d: 24, h: 30.5, sku: 'GL-TEC-BASE-36-1D',  price: 469 },
  { key: 't-lower-36-5dr',  label: '36" 5-Drawer Lower',        line: 'technica', style: 'lower',  doors: 0, drawers: 5, w: 36, d: 24, h: 30.5, sku: 'GL-TEC-BASE-36-5DR', price: 549 },
  { key: 't-lower-28-5dr',  label: '28" 5-Drawer Lower',        line: 'technica', style: 'lower',  doors: 0, drawers: 5, w: 28, d: 24, h: 30.5, sku: 'GL-TEC-BASE-28-5DR', price: 499 },
  { key: 't-lower-20-5dr',  label: '20" 5-Drawer Lower',        line: 'technica', style: 'lower',  doors: 0, drawers: 5, w: 20, d: 24, h: 30.5, sku: 'GL-TEC-BASE-20-5DR', price: 449 },
  { key: 't-locker-36-2',   label: '36" 2-Door Locker',         line: 'technica', style: 'locker', doors: 2, w: 36, d: 24, h: 84, sku: 'GL-TEC-TALL-36', price: 699 },
  { key: 't-locker-28-2',   label: '28" 2-Door Locker',         line: 'technica', style: 'locker', doors: 2, w: 28, d: 24, h: 84, sku: 'GL-TEC-TALL-28', price: 649 },
  { key: 't-locker-20-1',   label: '20" 1-Door Locker',         line: 'technica', style: 'locker', doors: 1, w: 20, d: 24, h: 84, sku: 'GL-TEC-TALL-20', price: 599 },
  { key: 't-upper-36-2',    label: '36" 2-Door Upper',          line: 'technica', style: 'upper',  doors: 2, w: 36, d: 14, h: 30.5, sku: 'GL-TEC-WALL-36', price: 299 },
  { key: 't-upper-28-2',    label: '28" 2-Door Upper',          line: 'technica', style: 'upper',  doors: 2, w: 28, d: 14, h: 30.5, sku: 'GL-TEC-WALL-28', price: 259 },
  { key: 't-upper-20-1',    label: '20" 1-Door Upper',          line: 'technica', style: 'upper',  doors: 1, w: 20, d: 14, h: 30.5, sku: 'GL-TEC-WALL-20', price: 229 },
  { key: 't-corner-upper',  label: '24" Upper Corner',           line: 'technica', style: 'corner-upper', doors: 1, w: 24, d: 24, h: 30.5, sku: 'GL-TEC-WALL-CNR', price: 289 },
  // ── Signature ─────────────────────────────────────────────────────────
  { key: 's-lower-20-1',    label: '20" 1-Door Lower',          line: 'signature', style: 'lower',  doors: 1, w: 20, d: 24, h: 30.5, sku: 'GL-SIG-BASE-20',      price: 299 },
  { key: 's-lower-28-2',    label: '28" 2-Door Lower',          line: 'signature', style: 'lower',  doors: 2, w: 28, d: 24, h: 30.5, sku: 'GL-SIG-BASE-28',      price: 379 },
  { key: 's-lower-36-2',    label: '36" 2-Door Lower',          line: 'signature', style: 'lower',  doors: 2, w: 36, d: 24, h: 30.5, sku: 'GL-SIG-BASE-36',      price: 499 },
  { key: 's-lower-28-1d2d', label: '28" 1-Drawer 2-Door Lower', line: 'signature', style: 'lower',  doors: 2, drawers: 1, w: 28, d: 24, h: 30.5, sku: 'GL-SIG-BASE-28-1D',  price: 449 },
  { key: 's-lower-36-1d2d', label: '36" 1-Drawer 2-Door Lower', line: 'signature', style: 'lower',  doors: 2, drawers: 1, w: 36, d: 24, h: 30.5, sku: 'GL-SIG-BASE-36-1D',  price: 539 },
  { key: 's-lower-36-5dr',  label: '36" 5-Drawer Lower',        line: 'signature', style: 'lower',  doors: 0, drawers: 5, w: 36, d: 24, h: 30.5, sku: 'GL-SIG-BASE-36-5DR', price: 619 },
  { key: 's-lower-28-5dr',  label: '28" 5-Drawer Lower',        line: 'signature', style: 'lower',  doors: 0, drawers: 5, w: 28, d: 24, h: 30.5, sku: 'GL-SIG-BASE-28-5DR', price: 569 },
  { key: 's-lower-20-5dr',  label: '20" 5-Drawer Lower',        line: 'signature', style: 'lower',  doors: 0, drawers: 5, w: 20, d: 24, h: 30.5, sku: 'GL-SIG-BASE-20-5DR', price: 519 },
  { key: 's-locker-36-2',   label: '36" 2-Door Locker',         line: 'signature', style: 'locker', doors: 2, w: 36, d: 24, h: 80, sku: 'GL-SIG-TALL-36', price: 799 },
  { key: 's-locker-28-2',   label: '28" 2-Door Locker',         line: 'signature', style: 'locker', doors: 2, w: 28, d: 24, h: 80, sku: 'GL-SIG-TALL-28', price: 749 },
  { key: 's-locker-20-1',   label: '20" 1-Door Locker',         line: 'signature', style: 'locker', doors: 1, w: 20, d: 24, h: 80, sku: 'GL-SIG-TALL-20', price: 699 },
  { key: 's-upper-36-2',    label: '36" 2-Door Upper',          line: 'signature', style: 'upper',  doors: 2, w: 36, d: 14, h: 30.5, sku: 'GL-SIG-WALL-36', price: 359 },
  { key: 's-upper-28-2',    label: '28" 2-Door Upper',          line: 'signature', style: 'upper',  doors: 2, w: 28, d: 14, h: 30.5, sku: 'GL-SIG-WALL-28', price: 319 },
  { key: 's-upper-20-1',    label: '20" 1-Door Upper',          line: 'signature', style: 'upper',  doors: 1, w: 20, d: 14, h: 30.5, sku: 'GL-SIG-WALL-20', price: 279 },
  { key: 's-corner-upper',  label: '24" Upper Corner',           line: 'signature', style: 'corner-upper', doors: 1, w: 24, d: 24, h: 30.5, sku: 'GL-SIG-WALL-CNR', price: 349 },
]

export interface PlacedCabinet {
  id: string
  presetKey: string
  label: string
  line: CabinetLine
  style: CabinetStyle
  doors: 0 | 1 | 2
  drawers?: number
  w: number   // inches
  d: number
  h: number
  x: number   // inches, floor center XZ
  y: number   // inches, bottom of cabinet from floor
  z: number
  rotY: number  // radians
  color: string // 'charcoal' | 'white' | 'driftwood' | 'slate' | 'stone'
  shellColor?: string // Signature shell: 'black' | 'granite' (Technica uses door color for body)
  handleColor?: string // 'brushed' | 'black' (default brushed)
  handleSide?: 'left' | 'right' // single-door handle position (default 'right')
  doorOpenState?: 0 | 1 | 2  // 0=closed, 1=45°, 2=90°
  locked?: boolean
  sku?: string
  price?: number
  // Under-cabinet puck spotlight (upper cabinets only). Points straight down
  // from the center of the bottom of the cabinet. underLightAngle is the
  // spotlight cone half-angle in radians.
  underLight?: boolean
  underLightAngle?: number
}

export const COUNTERTOP_DEPTH = 25      // inches, fixed
export const COUNTERTOP_THICKNESS = 1.75  // 1¾ inches

/** A standalone baseboard piece. Sits on the floor against a wall, but stored
 *  as free-floating world-space geometry (not per-wall) so users can place
 *  multiple short pieces, leave gaps, or have unique colors per piece. */
export interface Baseboard {
  id: string
  label: string
  x: number          // center X in inches (world space)
  z: number          // center Z in inches
  y: number          // bottom face height off floor (default 0)
  rotY: number       // radians; 0 = length along +X
  length: number     // inches (default 36)
  height: number     // inches (default 4)
  thickness: number  // inches (default 0.5)
  color: string      // hex (default '#cccccc')
  flake: boolean     // when true, contributes front face area to flooring sqft
  /** When flake=true, ID of a flooring texture to render on the front face.
   *  Empty / undefined = match current floor. */
  flakeTextureId?: string
  locked?: boolean
}

/** A standalone stem wall piece. Visually identical box geometry to a baseboard
 *  but offset 1" INTO the wall thickness so it appears recessed into the wall
 *  face. (Position is computed at drag time — center sits inside wall thickness,
 *  with only the front face visible.) */
export interface StemWall {
  id: string
  label: string
  x: number          // center X in inches (world space)
  z: number          // center Z in inches
  y: number          // bottom face height (default 0)
  rotY: number       // radians; 0 = length along +X
  length: number     // inches (default 36)
  height: number     // inches (default 4 — same as baseboard default)
  thickness: number  // inches (default 0.125 — 1/4 of baseboard thickness so it reads as a thin surface coat)
  color: string      // hex
  flake: boolean     // contributes front face to flooring sqft when true
  /** When flake=true, ID of a flooring texture to render on the front face.
   *  Empty / undefined = match current floor. */
  flakeTextureId?: string
  locked?: boolean
}

export interface Countertop {
  id: string
  label: string
  x: number       // center X (inches)
  z: number       // center Z (inches)
  rotY: number    // rotation
  width: number   // inches, adjustable by dragging
  y: number       // height off floor of bottom face
  color: string   // 'butcher-block' | 'white' | 'black' | 'concrete'
  locked?: boolean
}

export interface WallOpening {
  id: string
  type: 'garage-door' | 'door' | 'window'
  xOffset: number   // inches from wall start (left edge of opening)
  width: number     // inches
  height: number    // inches
  yOffset: number   // inches from floor (0 = ground level)
  textureId?: string // texture id from textureCatalog (for door/window appearance)
  modelId?: string   // GLB model id from openingModels catalog (overrides box geometry)
  // Procedural door colors (used when modelId points to a procedural entry like 'custom-plain').
  doorColor?: string   // hex — slab color
  frameColor?: string  // hex — jamb + casing color
  // Which side of the wall the door swings onto. Only meaningful for `door`
  // type; drives the swing-arc rendering in the 2D floor plan. Defaults to
  // 'interior' when unset.
  swingSide?: 'interior' | 'exterior'
}

export interface GarageWall {
  id: string
  label: string
  x1: number   // inches from center
  z1: number
  x2: number
  z2: number
  height: number   // inches
  yOffset: number  // inches from floor (0 = starts at floor, >0 = soffit)
  thickness: number // inches (default 3.5)
  locked: boolean
  openings: WallOpening[]
  wallColor: string       // hex color (default '#e0dedd')
  wallTextureId?: string  // texture id from textureCatalog (overrides wallColor when set)
  // Baseboards are now standalone Baseboard pieces (see Baseboard interface),
  // not per-wall flags. Removed: baseboard, baseboardHeight, baseboardColor,
  // baseboardTexture.
  // Stem walls are now standalone StemWall pieces (see interface). Removed:
  // stemWall, stemWallHeight, stemWallTexture.
  visible: boolean          // whether wall is rendered (default true)
}

export type ShapeType = 'box' | 'cylinder' | 'beam'

export interface GarageShape {
  id: string
  type: ShapeType
  label: string
  // center position in inches
  x: number
  y: number // center height from floor
  z: number
  // box / beam dims in inches
  w: number
  d: number
  h: number
  // cylinder
  r: number
  material: 'concrete' | 'steel' | 'wood' | 'drywall'
  // appearance (all optional — falls back to material-based default)
  color?: string       // hex color for solid fill
  textureId?: string   // wall texture id, or 'floor:<id>', or 'imported:<id>'
  textureScale?: number // multiplier for UV repeat (1 = default; <1 larger pattern; >1 tighter tiling)
  locked?: boolean      // when true, shape cannot be moved
}

export interface FloorPoint {
  x: number  // inches from center
  z: number
}

/** A physical slatwall panel — 1" thick, mounted on the interior face of a wall. */
export interface SlatwallPanel {
  id: string
  wallId: string
  side: 'interior' | 'exterior'  // which face of the wall
  alongStart: number  // inches from wall start (left edge of panel)
  alongEnd: number    // inches from wall start (right edge of panel)
  yBottom: number     // inches from floor (bottom edge)
  yTop: number        // inches from floor (top edge)
  color: string       // slatwall color id (see slatwallColors.ts)
}

/** Texture finish options for the metal backsplash panel. */
export type BacksplashTexture = 'stainless' | 'diamondplate'

/** A metal backsplash panel — 1/8" thick, mounted like slatwall. */
export interface StainlessBacksplashPanel {
  id: string
  wallId: string
  side: 'interior' | 'exterior'
  alongStart: number  // inches from wall start
  alongEnd: number    // inches from wall start
  yBottom: number     // inches from floor
  yTop: number        // inches from floor
  texture?: BacksplashTexture  // defaults to 'stainless' when omitted
}

/** A raised floor step/platform — arbitrary quadrilateral, sits on the floor surface.
 *  `corners` is an array of 4 [x, z] pairs (inches from garage center), ordered
 *  counter-clockwise when viewed from above: [NW, NE, SE, SW] by default.
 *  Legacy saves without `corners` are migrated from the old center+width+depth rect. */
export interface FloorStep {
  id: string
  label: string
  corners: [number, number][]  // 4 corner points [x, z] in inches
  height: number               // inches (step rise height, default 4)
  locked?: boolean             // when true, step cannot be moved or reshaped
  // Legacy fields — kept for backward compat during migration, not used at runtime:
  x?: number
  z?: number
  width?: number
  depth?: number
}

/** Derive center + bounding dims from corners (for snapping, sidebar display, etc.) */
export function stepBounds(step: FloorStep) {
  const xs = step.corners.map(c => c[0])
  const zs = step.corners.map(c => c[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minZ = Math.min(...zs), maxZ = Math.max(...zs)
  return {
    x: (minX + maxX) / 2, z: (minZ + maxZ) / 2,
    width: maxX - minX, depth: maxZ - minZ,
    minX, maxX, minZ, maxZ,
  }
}

/** Migrate a legacy rect FloorStep to the new corners format. */
export function migrateFloorStep(step: any): FloorStep {
  if (step.corners) return { ...step, locked: step.locked ?? false } as FloorStep
  const x = step.x ?? 0, z = step.z ?? 0
  const hw = (step.width ?? 48) / 2, hd = (step.depth ?? 24) / 2
  return {
    id: step.id, label: step.label, height: step.height ?? 4,
    locked: step.locked ?? false,
    corners: [[x - hw, z - hd], [x + hw, z - hd], [x + hw, z + hd], [x - hw, z + hd]],
  }
}

/** A slatwall-mounted accessory — positioned relative to its parent panel. */
export interface SlatwallAccessory {
  id: string
  panelId: string       // parent slatwall panel
  type: string          // matches SlatwallAccessoryDef.type
  label: string
  sku: string
  price: number
  along: number         // inches from panel left edge (center of accessory)
  yOffset: number       // inches from panel bottom (center of accessory)
  w: number; h: number; d: number  // inches
  color: string         // hex
}

export interface PlacedItem {
  id: string
  type: string
  label: string
  position: [number, number, number] // feet in Three.js space
  rotation: [number, number, number]
  scale: [number, number, number]
}

/** Overhead storage rack — hangs from ceiling on 4 legs */
export interface OverheadRack {
  id: string
  label: string
  x: number       // center X in inches from garage center
  z: number       // center Z in inches from garage center
  rackWidth: number   // inches (48, 36, 24)
  rackLength: number  // inches (96, 72, 48)
  drop: number        // inches from ceiling to top of deck (1–48, adjustable)
  rotY: number        // 0 or π/2
  color: string       // hex
  locked?: boolean
  sku?: string
  price?: number
}

export const RACK_DECK_THICKNESS = 3  // inches — the wire-deck platform
export const RACK_LEG_SIZE = 1.5      // inches — square tube legs

export interface OverheadRackPreset {
  key: string
  label: string
  rackWidth: number   // inches
  rackLength: number  // inches
  sku?: string
  price?: number
}

export const OVERHEAD_RACK_PRESETS: OverheadRackPreset[] = [
  { key: 'rack-4x8', label: "4' × 8'", rackWidth: 48, rackLength: 96, sku: 'GL-RACK-4X8', price: 399 },
  { key: 'rack-4x6', label: "4' × 6'", rackWidth: 48, rackLength: 72, sku: 'GL-RACK-4X6', price: 349 },
  { key: 'rack-4x4', label: "4' × 4'", rackWidth: 48, rackLength: 48, sku: 'GL-RACK-4X4', price: 299 },
  { key: 'rack-3x8', label: "3' × 8'", rackWidth: 36, rackLength: 96, sku: 'GL-RACK-3X8', price: 349 },
  { key: 'rack-3x6', label: "3' × 6'", rackWidth: 36, rackLength: 72, sku: 'GL-RACK-3X6', price: 299 },
  { key: 'rack-2x8', label: "2' × 8'", rackWidth: 24, rackLength: 96, sku: 'GL-RACK-2X8', price: 279 },
  { key: 'rack-2x6', label: "2' × 6'", rackWidth: 24, rackLength: 72, sku: 'GL-RACK-2X6', price: 249 },
]

export type ImportAssetType = '3d-model' | 'wall-texture' | 'floor-texture' | 'texture'

/** An imported custom asset (model or texture) stored as a data blob */
export interface ImportedAsset {
  id: string
  name: string         // original filename
  assetType: ImportAssetType
  /** For 3D models: base64-encoded GLB; for textures: diffuse/color data URL */
  data: string
  /** PBR sidecar maps — populated when a zip contains multiple maps.
   *  `data` holds the color/diffuse map; these are the extras. Any map may be
   *  undefined. Shape/wall/floor renderers use the full set when present. */
  normalMap?: string
  roughnessMap?: string
  metalnessMap?: string
  aoMap?: string
  displacementMap?: string
  /** For 3D models: vehicle category */
  modelCategory?: 'car' | 'motorcycle' | 'equipment' | 'furniture'
  /** For 3D models: display label */
  modelLabel?: string
  /** For 3D models: dimensions in inches */
  w?: number
  h?: number
  d?: number
}

/** A background reference image (photo or blueprint) for tracing walls over.
 *  Renders beneath the floor plan in the 2D view only — never shown in the 3D
 *  view or the exported PDF. Position and size are in inches, in world space,
 *  matching the wall coordinate system. */
export interface TracingImage {
  id: string
  dataUrl: string      // base64-encoded image data
  x: number            // center X in inches
  z: number            // center Z in inches
  widthIn: number      // displayed width in inches
  heightIn: number     // displayed height in inches (respects aspect ratio)
  opacity: number      // 0.1 - 1.0, default 0.5
  locked?: boolean
}

function uid(): string {
  return crypto.randomUUID()
}

/** Every selectable entity's id field. Spreading this into a select action's
 *  set() call clears ALL sibling selections, so picking one entity
 *  deterministically deselects all others. New selectable entities MUST be
 *  added here — forgetting is how the old inline clears drifted and caused
 *  selection cross-contamination bugs (see pre-M2 selectItem / accessory). */
const SELECTION_CLEAR = {
  selectedWallId: null,
  selectedShapeId: null,
  selectedSlatwallPanelId: null,
  selectedStainlessBacksplashPanelId: null,
  selectedAccessoryId: null,
  selectedCabinetId: null,
  selectedCountertopId: null,
  selectedBaseboardId: null,
  selectedStemWallId: null,
  selectedFloorStepId: null,
  selectedCeilingLightId: null,
  selectedItemId: null,
  selectedRackId: null,
} as const

// ─── Project save/load migration registry ─────────────────────────────────────
// The save format is versioned by `_version`. On load, migrateProject() chains
// MIGRATORS[n] → MIGRATORS[n+1] → … until the save reaches CURRENT_VERSION, at
// which point normalizeLoadedProject() fills in any missing fields with
// defaults. To introduce a breaking schema change: bump CURRENT_VERSION and
// register a MIGRATORS[prev] that transforms old-shape data to new-shape.

const CURRENT_VERSION = 1

type Migrator = (data: Record<string, unknown>) => Record<string, unknown>

/** Version-to-version migrators. Each key N produces v(N+1)-shaped data from
 *  v(N)-shaped data. Empty today — slot reserved for future schema changes. */
const MIGRATORS: Record<number, Migrator> = {
  // Example for future: 1: (d) => ({ ...d, walls: (d.walls as any[]).map(w => ({ ...w, newField: defaultFor(w) })) })
}

function migrateProject(data: Record<string, unknown>): Record<string, unknown> {
  let version = typeof data._version === 'number' ? data._version : 1
  while (version < CURRENT_VERSION) {
    const migrator = MIGRATORS[version]
    if (!migrator) throw new Error(`Missing migrator for project version ${version}`)
    data = migrator(data)
    version++
  }
  if (version > CURRENT_VERSION) {
    throw new Error(`Project file is from a newer app version (v${version}, this build supports up to v${CURRENT_VERSION}). Update the app to open it.`)
  }
  return { ...data, _version: CURRENT_VERSION }
}

/** Fill in defaults + run entity-level normalizations that don't rise to the
 *  level of a schema migration. This is where optional-field fallbacks live
 *  (e.g. walls.visible, cabinet.line). Runs AFTER migrateProject(). */
function normalizeLoadedProject(d: Record<string, unknown>) {
  const assets = (d.importedAssets as ImportedAsset[]) ?? []
  // Re-hydrate 3D model base64 payloads into the blob cache and strip the
  // heavy `data` strings off state — the cache is the source of truth at runtime.
  for (const a of assets) {
    if (a.assetType === '3d-model' && a.data) cacheModelBase64(a.id, a.data)
  }
  const importedAssets = assets.map(a => a.assetType === '3d-model' ? { ...a, data: '' } : a)

  return {
    customerName:     (d.customerName as string)     ?? '',
    siteAddress:      (d.siteAddress as string)       ?? '',
    consultantName:   (d.consultantName as string)    ?? 'Garage Living',
    setupDone:        (d.setupDone as boolean)        ?? true,
    garageWidth:      (d.garageWidth as number)       ?? 240,
    garageDepth:      (d.garageDepth as number)       ?? 264,
    ceilingHeight:    (d.ceilingHeight as number)     ?? 108,
    floorPoints:      (d.floorPoints as FloorPoint[]) ?? [],
    // Per-entity normalizations: ensure optional fields have their runtime
    // defaults so the renderer doesn't have to branch on undefined.
    walls:            ((d.walls as GarageWall[]) ?? []).map(w => ({ ...w, visible: w.visible ?? true })),
    slatwallPanels:   (d.slatwallPanels as SlatwallPanel[]) ?? [],
    stainlessBacksplashPanels: (d.stainlessBacksplashPanels as StainlessBacksplashPanel[]) ?? [],
    floorSteps:       ((d.floorSteps as unknown[]) ?? []).map(migrateFloorStep),
    shapes:           (d.shapes as GarageShape[])     ?? [],
    cabinets:         ((d.cabinets as PlacedCabinet[]) ?? []).map(c => ({ ...c, line: c.line ?? 'technica' as const })),
    countertops:      (d.countertops as Countertop[]) ?? [],
    baseboards:       (d.baseboards as Baseboard[])   ?? [],
    stemWalls:        (d.stemWalls as StemWall[])     ?? [],
    items:            (d.items as PlacedItem[])       ?? [],
    overheadRacks:    (d.overheadRacks as OverheadRack[]) ?? [],
    importedAssets,
    slatwallAccessories: (d.slatwallAccessories as SlatwallAccessory[]) ?? [],
    flooringColor:    (d.flooringColor as string)     ?? 'quicksilver',
    floorTextureScale:(d.floorTextureScale as number) ?? 6,
    ceilingLights:    (d.ceilingLights as CeilingLight[]) ?? [],
    ambientIntensity: (d.ambientIntensity as number)  ?? 0.02,
    bounceIntensity:  (d.bounceIntensity as number)   ?? 4,
    bounceDistance:   (d.bounceDistance as number)    ?? 30,
    floorReflection:  (d.floorReflection as number)   ?? 0.1,
    envReflection:    (d.envReflection as number)     ?? 0.05,
    lightMultiplier:  (d.lightMultiplier as number)   ?? 15,
    exposure:         (d.exposure as number)          ?? 1.0,
    // Pre-exposure saves had scene-light intensity multiplied by 80 in the
    // renderer; new path renders intensity as-is, so scale legacy values up.
    sceneLights:      (d.exposure === undefined
                        ? ((d.sceneLights as SceneLight[]) ?? []).map(l => ({ ...l, intensity: (l.intensity ?? 1) * 80 }))
                        : ((d.sceneLights as SceneLight[]) ?? [])),
    exportShots:      (d.exportShots as ExportShot[]) ?? [],
    tracingImage:     (d.tracingImage as TracingImage) ?? null,
  }
}

function makeDefaultWalls(widthIn: number, depthIn: number, heightIn: number): GarageWall[] {
  const hw = widthIn / 2
  const hd = depthIn / 2
  const base: Omit<GarageWall, 'id' | 'label' | 'x1' | 'z1' | 'x2' | 'z2'> = {
    height: heightIn, yOffset: 0, thickness: 3.5, locked: false,
    wallColor: '#f0ede4', openings: [],
    visible: true,
  }
  return [
    { id: uid(), label: 'Back Wall',  x1: -hw, z1: -hd, x2:  hw, z2: -hd, ...base },
    { id: uid(), label: 'Right Wall', x1:  hw, z1: -hd, x2:  hw, z2:  hd, ...base },
    { id: uid(), label: 'Front Wall', x1:  hw, z1:  hd, x2: -hw, z2:  hd, ...base },
    { id: uid(), label: 'Left Wall',  x1: -hw, z1:  hd, x2: -hw, z2: -hd, ...base },
  ]
}

interface GarageStore {
  // Customer
  customerName: string
  siteAddress: string
  consultantName: string

  // Setup
  setupDone: boolean

  // Fixed floor/ceiling size — set at init, derived from floorPoints bounding box
  garageWidth: number   // inches
  garageDepth: number   // inches

  // Floor polygon — defines the shape of the floor (and ceiling)
  floorPoints: FloorPoint[]

  // Walls (all dims in inches)
  walls: GarageWall[]
  selectedWallId: string | null

  // Slatwall panels
  slatwallPanels: SlatwallPanel[]
  selectedSlatwallPanelId: string | null
  stainlessBacksplashPanels: StainlessBacksplashPanel[]
  selectedStainlessBacksplashPanelId: string | null

  // Floor steps
  floorSteps: FloorStep[]
  selectedFloorStepId: string | null

  // Shapes
  shapes: GarageShape[]
  selectedShapeId: string | null

  // Cabinets
  cabinets: PlacedCabinet[]
  selectedCabinetId: string | null

  // Overhead racks
  overheadRacks: OverheadRack[]
  selectedRackId: string | null

  // Imported custom assets
  importedAssets: ImportedAsset[]

  // Products placed in scene
  items: PlacedItem[]
  selectedItemId: string | null

  // Ceiling height in inches
  ceilingHeight: number

  // Floor
  flooringColor: string
  floorTextureScale: number

  // View
  viewMode: ViewMode
  cameraAngle: number
  elevationWallIndex: number
  setElevationWallIndex: (i: number) => void
  elevationSide: 'interior' | 'exterior'
  setElevationSide: (side: 'interior' | 'exterior') => void

  // Performance quality preset (only affects live viewport — exports always use high)
  qualityPreset: QualityPreset
  setQualityPreset: (preset: QualityPreset) => void

  // When true, all components render at max quality regardless of qualityPreset
  isExporting: boolean
  setIsExporting: (v: boolean) => void

  // Global snapping toggle — disables all position/corner/stack snapping when false
  snappingEnabled: boolean
  setSnappingEnabled: (v: boolean) => void

  // Wall-angle snap (0/45/90°) in floor plan view
  wallAngleSnapEnabled: boolean
  setWallAngleSnapEnabled: (v: boolean) => void

  // Corner angle labels visibility in floor plan view
  cornerAngleLabelsVisible: boolean
  setCornerAngleLabelsVisible: (v: boolean) => void

  // Floor selection
  floorSelected: boolean

  // Drag state — counter-based: >0 disables OrbitControls
  isDraggingWall: boolean
  dragCount: number

  // Active sidebar tab
  activeTab: SidebarTab
  setActiveTab: (tab: SidebarTab) => void

  // Actions
  setCustomerInfo: (name: string, address: string, consultant: string) => void
  initializeGarage: (widthFt: number, depthFt: number, heightFt: number) => void
  completeSetup: () => void

  addWall: (wall?: Partial<GarageWall>) => void
  updateWall: (id: string, changes: Partial<GarageWall>) => void
  deleteWall: (id: string) => void
  selectWall: (id: string | null) => void
  duplicateWall: (id: string) => void

  addOpening: (wallId: string, type: WallOpening['type']) => void
  updateOpening: (wallId: string, openingId: string, changes: Partial<WallOpening>) => void
  removeOpening: (wallId: string, openingId: string) => void

  addSlatwallPanel: (wallId: string, side?: 'interior' | 'exterior') => void
  updateSlatwallPanel: (id: string, changes: Partial<SlatwallPanel>) => void
  deleteSlatwallPanel: (id: string) => void
  selectSlatwallPanel: (id: string | null) => void

  addStainlessBacksplashPanel: (wallId: string, side?: 'interior' | 'exterior') => void
  updateStainlessBacksplashPanel: (id: string, changes: Partial<StainlessBacksplashPanel>) => void
  deleteStainlessBacksplashPanel: (id: string) => void
  selectStainlessBacksplashPanel: (id: string | null) => void

  addFloorStep: () => void
  updateFloorStep: (id: string, changes: Partial<FloorStep>) => void
  deleteFloorStep: (id: string) => void
  selectFloorStep: (id: string | null) => void

  addShape: (type: ShapeType) => void
  updateShape: (id: string, changes: Partial<GarageShape>) => void
  deleteShape: (id: string) => void
  selectShape: (id: string | null) => void

  setGarageSize: (widthIn: number, depthIn: number) => void
  updateFloorPoint: (idx: number, x: number, z: number) => void
  setCeilingHeight: (inches: number) => void
  setFlooringColor: (color: string) => void
  setFloorTextureScale: (scale: number) => void

  setFloorSelected: (v: boolean) => void
  setViewMode: (mode: ViewMode) => void
  setCameraAngle: (angle: number) => void
  setIsDraggingWall: (v: boolean) => void
  beginDrag: () => void
  endDrag: () => void

  addCabinet: (preset: CabinetPreset, spawnX?: number, spawnZ?: number, spawnRotY?: number) => void
  updateCabinet: (id: string, changes: Partial<PlacedCabinet>) => void
  deleteCabinet: (id: string) => void
  selectCabinet: (id: string | null) => void

  // Countertops
  countertops: Countertop[]
  selectedCountertopId: string | null
  addCountertop: () => void
  updateCountertop: (id: string, changes: Partial<Countertop>) => void
  deleteCountertop: (id: string) => void
  selectCountertop: (id: string | null) => void

  // Baseboards (standalone pieces)
  baseboards: Baseboard[]
  selectedBaseboardId: string | null
  addBaseboard: (overrides?: Partial<Baseboard>) => void
  updateBaseboard: (id: string, changes: Partial<Baseboard>) => void
  deleteBaseboard: (id: string) => void
  selectBaseboard: (id: string | null) => void

  // Stem walls (standalone pieces, recessed into wall)
  stemWalls: StemWall[]
  selectedStemWallId: string | null
  addStemWall: (overrides?: Partial<StemWall>) => void
  updateStemWall: (id: string, changes: Partial<StemWall>) => void
  deleteStemWall: (id: string) => void
  selectStemWall: (id: string | null) => void

  // Slatwall accessories
  slatwallAccessories: SlatwallAccessory[]
  selectedAccessoryId: string | null
  addSlatwallAccessory: (panelId: string, def: { type: string; label: string; sku: string; price: number; w: number; h: number; d: number; color: string }) => void
  updateSlatwallAccessory: (id: string, changes: Partial<SlatwallAccessory>) => void
  deleteSlatwallAccessory: (id: string) => void
  selectSlatwallAccessory: (id: string | null) => void

  // Imported assets
  addImportedAsset: (asset: ImportedAsset) => void
  deleteImportedAsset: (id: string) => void

  // Overhead racks
  addRack: (preset: OverheadRackPreset) => void
  updateRack: (id: string, changes: Partial<OverheadRack>) => void
  deleteRack: (id: string) => void
  selectRack: (id: string | null) => void

  addItem: (item: PlacedItem) => void
  removeItem: (id: string) => void
  updateItem: (id: string, changes: Partial<PlacedItem>) => void
  selectItem: (id: string | null) => void

  // Ceiling light fixtures
  ceilingLights: CeilingLight[]
  selectedCeilingLightId: string | null
  addCeilingLight: (kind?: CeilingLightKind) => void
  updateCeilingLight: (id: string, changes: Partial<CeilingLight>) => void
  deleteCeilingLight: (id: string) => void
  selectCeilingLight: (id: string | null) => void
  autoLighting: () => void

  // Lighting
  ambientIntensity: number
  setAmbientIntensity: (v: number) => void
  bounceIntensity: number
  setBounceIntensity: (v: number) => void
  bounceDistance: number
  setBounceDistance: (v: number) => void
  floorReflection: number
  setFloorReflection: (v: number) => void
  envReflection: number
  setEnvReflection: (v: number) => void
  lightMultiplier: number
  setLightMultiplier: (v: number) => void
  exposure: number
  setExposure: (v: number) => void
  sceneLights: SceneLight[]
  addSceneLight: (type: LightType) => void
  updateSceneLight: (id: string, changes: Partial<SceneLight>) => void
  deleteSceneLight: (id: string) => void

  // Export shots (user-saved camera angles for PDF export)
  exportShots: ExportShot[]
  addExportShot: (shot: ExportShot) => void
  updateExportShot: (id: string, changes: Partial<ExportShot>) => void
  deleteExportShot: (id: string) => void
  reorderExportShots: (ids: string[]) => void

  // Floor-plan tracing reference image (2D view only, not exported)
  tracingImage: TracingImage | null
  setTracingImage: (img: TracingImage | null) => void
  updateTracingImage: (changes: Partial<TracingImage>) => void

  // Quote / Pricing
  getQuote: () => { subtotal: number; labor: number; total: number; lineItems: { label: string; sku: string; price: number }[] }

  // Save / Load
  projectName: string | null  // current project filename (without .garage extension)
  /** Absolute path to the file the project was opened from (Electron only).
   *  When set, subsequent saves overwrite this file directly — no dialog. */
  projectFilePath: string | null
  setProjectName: (v: string | null) => void
  saveProject: (overrideName?: string) => Promise<void>
  loadProject: (data: unknown, filename?: string, filePath?: string) => void
  newProject: () => void
}

/** Generate a sensible grid of recessed puck lights for a given room size. */
function buildPuckGrid(wFt: number, dFt: number): CeilingLight[] {
  const max = Math.max(wFt, dFt)
  let cols: number, rows: number
  if (max >= 28) {           // large garage
    cols = wFt > dFt ? 4 : 3
    rows = wFt > dFt ? 3 : 4
  } else if (max >= 18) {    // medium garage (default 2-car)
    cols = wFt > dFt ? 3 : 2
    rows = wFt > dFt ? 2 : 3
  } else {                   // small / single-car
    cols = 2
    rows = 2
  }
  const lights: CeilingLight[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - (cols - 1) / 2) * (wFt / cols)
      const z = (r - (rows - 1) / 2) * (dFt / rows)
      lights.push({
        id: uid(),
        label: `Puck ${lights.length + 1}`,
        kind: 'puck',
        x, z, rotY: 0,
        color: '#ffffff', intensity: 5.0, enabled: true,
      })
    }
  }
  return lights
}

export const useGarageStore = create<GarageStore>((set, get) => ({
  customerName: '',
  siteAddress: '',
  consultantName: 'Garage Living',

  setupDone: false,

  garageWidth: 240,   // 20ft default
  garageDepth: 264,   // 22ft default
  floorPoints: [],    // populated by initializeGarage

  walls: [],
  selectedWallId: null,

  slatwallPanels: [],
  selectedSlatwallPanelId: null,
  stainlessBacksplashPanels: [],
  selectedStainlessBacksplashPanelId: null,

  floorSteps: [],
  selectedFloorStepId: null,

  shapes: [],
  selectedShapeId: null,

  cabinets: [],
  selectedCabinetId: null,

  countertops: [],
  selectedCountertopId: null,

  baseboards: [],
  selectedBaseboardId: null,

  stemWalls: [],
  selectedStemWallId: null,

  importedAssets: [],

  overheadRacks: [],
  selectedRackId: null,

  items: [],
  selectedItemId: null,

  ceilingHeight: 108,

  flooringColor: 'quicksilver',
  floorTextureScale: 6,

  floorSelected: false,
  viewMode: 'perspective',
  cameraAngle: 0,
  elevationWallIndex: 0,
  elevationSide: 'interior' as 'interior' | 'exterior',
  qualityPreset: 'low' as QualityPreset,
  isExporting: false,
  snappingEnabled: true,
  wallAngleSnapEnabled: true,
  cornerAngleLabelsVisible: false,

  isDraggingWall: false,
  dragCount: 0,

  activeTab: 'walls' as SidebarTab,

  setCustomerInfo: (name, address, consultant) =>
    set({ customerName: name, siteAddress: address, consultantName: consultant }),

  initializeGarage: (widthFt, depthFt, heightFt) => {
    const widthIn = widthFt * 12, depthIn = depthFt * 12
    const hw = widthIn / 2, hd = depthIn / 2
    const walls = makeDefaultWalls(widthIn, depthIn, heightFt * 12)

    // Add a centered garage door to the Front Wall (index 2)
    const frontWall = walls[2]
    const frontLen = Math.hypot(frontWall.x2 - frontWall.x1, frontWall.z2 - frontWall.z1)
    const gdW = Math.min(192, frontLen * 0.8)   // 16' or 80% of wall, whichever is smaller
    const gdH = Math.min(96, heightFt * 12 * 0.85) // 8' or 85% of wall height
    frontWall.openings = [{
      id: uid(),
      type: 'garage-door',
      xOffset: (frontLen - gdW) / 2,
      width: gdW,
      height: gdH,
      yOffset: 0,
    }]

    // Recessed puck lights in a grid sized to the room
    const defaultLights = buildPuckGrid(widthFt, depthFt)

    set({
      garageWidth: widthIn,
      garageDepth: depthIn,
      floorPoints: [
        { x: -hw, z: -hd },
        { x:  hw, z: -hd },
        { x:  hw, z:  hd },
        { x: -hw, z:  hd },
      ],
      walls,
      ceilingHeight: heightFt * 12,
      ceilingLights: defaultLights,
    })
  },

  setGarageSize: (widthIn, depthIn) => {
    const hw = widthIn / 2, hd = depthIn / 2
    set({
      garageWidth: widthIn,
      garageDepth: depthIn,
      floorPoints: [
        { x: -hw, z: -hd },
        { x:  hw, z: -hd },
        { x:  hw, z:  hd },
        { x: -hw, z:  hd },
      ],
    })
  },

  updateFloorPoint: (idx, x, z) =>
    set(s => {
      const pts = s.floorPoints.map((p, i) => i === idx ? { x, z } : p)
      const xs = pts.map(p => p.x), zs = pts.map(p => p.z)
      return {
        floorPoints: pts,
        garageWidth: Math.max(...xs) - Math.min(...xs),
        garageDepth: Math.max(...zs) - Math.min(...zs),
      }
    }),

  completeSetup: () => set({ setupDone: true }),

  addWall: (overrides = {}) => {
    const ch = get().ceilingHeight
    const wall: GarageWall = {
      id: uid(),
      label: `Wall ${get().walls.length + 1}`,
      x1: 0, z1: 0, x2: 60, z2: 0,
      height: ch, yOffset: 0, thickness: 3.5,
      locked: false,
      wallColor: '#f0ede4', openings: [],
      visible: true,
      ...overrides,
    }
    set(s => ({ walls: [...s.walls, wall], selectedWallId: wall.id }))
  },

  updateWall: (id, changes) =>
    set(s => ({ walls: s.walls.map(w => w.id === id ? { ...w, ...changes } : w) })),

  deleteWall: (id) =>
    set(s => ({
      walls: s.walls.filter(w => w.id !== id),
      selectedWallId: s.selectedWallId === id ? null : s.selectedWallId,
    })),

  selectWall: (id) => set({ ...SELECTION_CLEAR, selectedWallId: id, ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}) }),

  duplicateWall: (id) => {
    const wall = get().walls.find(w => w.id === id)
    if (!wall) return
    const newWall: GarageWall = {
      ...wall, id: uid(),
      label: wall.label + ' Copy',
      x1: wall.x1 + 12, z1: wall.z1 + 12,
      x2: wall.x2 + 12, z2: wall.z2 + 12,
      openings: wall.openings.map(o => ({ ...o, id: uid() })),
    }
    set(s => ({ walls: [...s.walls, newWall], selectedWallId: newWall.id }))
  },

  addOpening: (wallId, type) => {
    const wall = get().walls.find(w => w.id === wallId)
    if (!wall) return
    const wallLen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
    const defaultWidth  = type === 'garage-door' ? 112 : 36
    const defaultHeight = type === 'garage-door' ? 84  : 80
    const opening: WallOpening = {
      id: uid(), type,
      xOffset: Math.max(0, (wallLen - defaultWidth) / 2),
      width: defaultWidth,
      height: defaultHeight,
      yOffset: 0,
    }
    set(s => ({
      walls: s.walls.map(w => w.id === wallId
        ? { ...w, openings: [...w.openings, opening] }
        : w),
    }))
  },

  updateOpening: (wallId, openingId, changes) =>
    set(s => ({
      walls: s.walls.map(w => w.id === wallId ? {
        ...w,
        openings: w.openings.map(o => o.id === openingId ? { ...o, ...changes } : o),
      } : w),
    })),

  removeOpening: (wallId, openingId) =>
    set(s => ({
      walls: s.walls.map(w => w.id === wallId ? {
        ...w,
        openings: w.openings.filter(o => o.id !== openingId),
      } : w),
    })),

  addSlatwallPanel: (wallId, side = 'interior') => {
    const wall = get().walls.find(w => w.id === wallId)
    if (!wall) return
    const lenIn = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
    // Trim corners by half-thickness so panel doesn't clip into perpendicular walls
    const trim = wall.thickness / 2
    const yBottom = 0
    const panel: SlatwallPanel = {
      id: uid(), wallId,
      side,
      alongStart: trim,
      alongEnd: trim + 12,                          // 1ft wide
      yBottom,
      yTop: yBottom + 12,                           // 1ft tall
      color: 'grey',
    }
    set(s => ({ slatwallPanels: [...s.slatwallPanels, panel], selectedSlatwallPanelId: panel.id }))
  },

  updateSlatwallPanel: (id, changes) =>
    set(s => ({ slatwallPanels: s.slatwallPanels.map(p => p.id === id ? { ...p, ...changes } : p) })),

  deleteSlatwallPanel: (id) =>
    set(s => ({
      slatwallPanels: s.slatwallPanels.filter(p => p.id !== id),
      selectedSlatwallPanelId: s.selectedSlatwallPanelId === id ? null : s.selectedSlatwallPanelId,
    })),

  selectSlatwallPanel: (id) => set(s => {
    const panel = id ? s.slatwallPanels.find(p => p.id === id) : null
    return {
      ...SELECTION_CLEAR,
      selectedSlatwallPanelId: id,
      // Preserve the parent wall context so the sidebar stays on the right wall.
      selectedWallId: panel?.wallId ?? s.selectedWallId,
      ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}),
    }
  }),

  addStainlessBacksplashPanel: (wallId, side = 'interior') => {
    const wall = get().walls.find(w => w.id === wallId)
    if (!wall) return
    const trim = wall.thickness / 2
    const yBottom = 0
    const panel: StainlessBacksplashPanel = {
      id: uid(), wallId,
      side,
      alongStart: trim,
      alongEnd: trim + 12,    // 1ft wide default
      yBottom,
      yTop: yBottom + 12,     // 1ft tall default
      texture: 'stainless',
    }
    set(s => ({
      stainlessBacksplashPanels: [...s.stainlessBacksplashPanels, panel],
      selectedStainlessBacksplashPanelId: panel.id,
      selectedSlatwallPanelId: null,
    }))
  },

  updateStainlessBacksplashPanel: (id, changes) =>
    set(s => ({ stainlessBacksplashPanels: s.stainlessBacksplashPanels.map(p => p.id === id ? { ...p, ...changes } : p) })),

  deleteStainlessBacksplashPanel: (id) =>
    set(s => ({
      stainlessBacksplashPanels: s.stainlessBacksplashPanels.filter(p => p.id !== id),
      selectedStainlessBacksplashPanelId: s.selectedStainlessBacksplashPanelId === id ? null : s.selectedStainlessBacksplashPanelId,
    })),

  selectStainlessBacksplashPanel: (id) => set(s => {
    const panel = id ? s.stainlessBacksplashPanels.find(p => p.id === id) : null
    return {
      ...SELECTION_CLEAR,
      selectedStainlessBacksplashPanelId: id,
      selectedWallId: panel?.wallId ?? s.selectedWallId,
      ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}),
    }
  }),

  addFloorStep: () => {
    const { garageWidth, garageDepth } = get()
    const hw = garageWidth / 2, hd = 24
    const cz = -(garageDepth / 2 - 24) // near back wall
    const step: FloorStep = {
      id: uid(),
      label: `Step ${get().floorSteps.length + 1}`,
      corners: [[-hw, cz - hd], [hw, cz - hd], [hw, cz + hd], [-hw, cz + hd]],
      height: 4,
      locked: false,
    }
    set(s => ({ floorSteps: [...s.floorSteps, step], selectedFloorStepId: step.id }))
  },

  updateFloorStep: (id, changes) =>
    set(s => ({ floorSteps: s.floorSteps.map(st => st.id === id ? { ...st, ...changes } : st) })),

  deleteFloorStep: (id) =>
    set(s => ({
      floorSteps: s.floorSteps.filter(st => st.id !== id),
      selectedFloorStepId: s.selectedFloorStepId === id ? null : s.selectedFloorStepId,
    })),

  selectFloorStep: (id) => set({
    ...SELECTION_CLEAR,
    selectedFloorStepId: id,
    ...(id !== null ? { activeTab: 'flooring' as SidebarTab } : {}),
  }),

  addShape: (type) => {
    const h = 12
    const shape: GarageShape = {
      id: uid(), type,
      label: type === 'box' ? 'Soffit' : type === 'cylinder' ? 'Column' : 'Beam',
      x: 0,
      y: h / 2,  // center of garage, sitting on the floor
      z: 0,
      w: 24, d: 24, h,
      r: 3,
      material: type === 'cylinder' ? 'steel' : 'drywall',
      locked: false,
    }
    set(s => ({ shapes: [...s.shapes, shape], selectedShapeId: shape.id }))
  },

  updateShape: (id, changes) =>
    set(s => ({ shapes: s.shapes.map(sh => sh.id === id ? { ...sh, ...changes } : sh) })),

  deleteShape: (id) =>
    set(s => ({
      shapes: s.shapes.filter(sh => sh.id !== id),
      selectedShapeId: s.selectedShapeId === id ? null : s.selectedShapeId,
    })),

  selectShape: (id) => set({ ...SELECTION_CLEAR, selectedShapeId: id, ...(id !== null ? { floorSelected: false, activeTab: 'shapes' as SidebarTab } : {}) }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setCeilingHeight:      (inches) => set({ ceilingHeight: inches }),
  setFlooringColor: (color) => set({ flooringColor: color }),
  setFloorTextureScale: (scale) => set({ floorTextureScale: scale }),

  setFloorSelected: (v) => set(v ? { floorSelected: true, activeTab: 'flooring' as SidebarTab } : { floorSelected: false }),
  setViewMode: (mode) => set(
    mode === 'elevation' ? { viewMode: mode, activeTab: 'cabinets' as SidebarTab } :
    mode === 'top'       ? { viewMode: mode, activeTab: 'overhead' as SidebarTab } :
    { viewMode: mode }
  ),
  setCameraAngle: (angle) => set({ cameraAngle: angle }),
  setElevationWallIndex: (i) => set({ elevationWallIndex: i }),
  setElevationSide: (side) => set({ elevationSide: side }),
  setQualityPreset: (preset) => set(
    preset === 'high'   ? { qualityPreset: preset, floorReflection: 0.9, envReflection: 0.15, bounceDistance: 48 } :
    preset === 'medium' ? { qualityPreset: preset, floorReflection: 0.4, envReflection: 0.12, bounceDistance: 36 } :
                          { qualityPreset: preset, floorReflection: 0.1, envReflection: 0.05, bounceDistance: 30 }
  ),
  setIsExporting: (v) => set({ isExporting: v }),
  setSnappingEnabled: (v) => set({ snappingEnabled: v }),
  setWallAngleSnapEnabled: (v) => set({ wallAngleSnapEnabled: v }),
  setCornerAngleLabelsVisible: (v) => set({ cornerAngleLabelsVisible: v }),
  setIsDraggingWall: (v) => set({ isDraggingWall: v }),
  beginDrag: () => set(s => { const n = s.dragCount + 1; return { dragCount: n, isDraggingWall: n > 0 } }),
  endDrag: () => set(s => { const n = Math.max(0, s.dragCount - 1); return { dragCount: n, isDraggingWall: n > 0 } }),

  addCabinet: (preset, spawnX = 0, spawnZ = 0, spawnRotY = 0) => {
    const defaultY = (preset.style === 'upper' || preset.style === 'corner-upper') ? 30.5 : 0
    const cabinet: PlacedCabinet = {
      id: uid(),
      presetKey: preset.key,
      label: preset.label,
      line: preset.line,
      style: preset.style,
      doors: preset.doors,
      drawers: preset.drawers,
      w: preset.w, d: preset.d, h: preset.h,
      x: spawnX, y: defaultY, z: spawnZ,
      rotY: spawnRotY,
      color: preset.line === 'signature' ? 'granite' : 'mica',
      shellColor: preset.line === 'signature' ? 'granite' : undefined,
      sku: preset.sku,
      price: preset.price,
    }
    set(s => ({ cabinets: [...s.cabinets, cabinet] }))
  },

  updateCabinet: (id, changes) =>
    set(s => ({ cabinets: s.cabinets.map(c => c.id === id ? { ...c, ...changes } : c) })),

  deleteCabinet: (id) =>
    set(s => ({
      cabinets: s.cabinets.filter(c => c.id !== id),
      selectedCabinetId: s.selectedCabinetId === id ? null : s.selectedCabinetId,
    })),

  selectCabinet: (id) => set({ ...SELECTION_CLEAR, selectedCabinetId: id, ...(id !== null ? { floorSelected: false, activeTab: 'cabinets' as SidebarTab } : {}) }),

  addCountertop: () => {
    const { garageDepth, walls } = get()
    // Place flush against the back wall interior face (wall at z = -garageDepth/2)
    const wallThickness = walls[0]?.thickness ?? 3.5
    const hd = garageDepth / 2
    const defaultZ = -(hd - wallThickness / 2 - COUNTERTOP_DEPTH / 2)
    const ct: Countertop = {
      id: uid(), label: 'Countertop',
      x: 0, z: defaultZ, rotY: 0,
      width: 36, y: 30.5, color: 'butcher-block',
    }
    set(s => ({ countertops: [...s.countertops, ct], selectedCountertopId: ct.id }))
  },
  updateCountertop: (id, changes) =>
    set(s => ({ countertops: s.countertops.map(c => c.id === id ? { ...c, ...changes } : c) })),
  deleteCountertop: (id) =>
    set(s => ({
      countertops: s.countertops.filter(c => c.id !== id),
      selectedCountertopId: s.selectedCountertopId === id ? null : s.selectedCountertopId,
    })),
  selectCountertop: (id) => set({ ...SELECTION_CLEAR, selectedCountertopId: id, ...(id !== null ? { floorSelected: false, activeTab: 'cabinets' as SidebarTab } : {}) }),

  addBaseboard: (overrides = {}) => {
    const { walls, baseboards } = get()
    // Default placement: against the back-most wall, centered along it.
    // Pick the wall whose midpoint has the most negative Z (closest to back).
    let target = walls[0]
    let bestZ = Infinity
    for (const w of walls) {
      const mz = (w.z1 + w.z2) / 2
      if (mz < bestZ) { bestZ = mz; target = w }
    }
    let x = 0, z = 0, rotY = 0
    if (target) {
      const dx = target.x2 - target.x1, dz = target.z2 - target.z1
      const len = Math.hypot(dx, dz) || 1
      const ux = dx / len, uz = dz / len
      // Interior normal (towards garage center). Use (-uz, ux) and flip if needed.
      const cx = (target.x1 + target.x2) / 2
      const cz = (target.z1 + target.z2) / 2
      let nx = -uz, nz = ux
      // Flip toward origin (assumes garage straddles 0,0)
      if (cx * nx + cz * nz > 0) { nx = -nx; nz = -nz }
      // Sit flush against the wall's interior face: offset by half the wall
      // thickness + half the baseboard thickness (0.25" for a 0.5" board).
      const inset = target.thickness / 2 + 0.25
      x = cx + nx * inset
      z = cz + nz * inset
      // Rotation: baseboard length axis = wall along axis.
      rotY = Math.atan2(uz, ux) * -1
    }
    const bb: Baseboard = {
      id: uid(),
      label: `Baseboard ${baseboards.length + 1}`,
      x, z, y: 0, rotY,
      length: 36, height: 4, thickness: 0.5,
      color: '#cccccc',
      flake: false,
      ...overrides,
    }
    set(s => ({
      baseboards: [...s.baseboards, bb],
      selectedBaseboardId: bb.id,
      // Deselect all other entity types so only the new baseboard is selected.
      selectedWallId: null,
      selectedShapeId: null,
      selectedSlatwallPanelId: null,
      selectedStainlessBacksplashPanelId: null,
      selectedCabinetId: null,
      selectedCountertopId: null,
      selectedStemWallId: null,
      selectedFloorStepId: null,
      selectedCeilingLightId: null,
      selectedItemId: null,
      selectedRackId: null,
      floorSelected: false,
    }))
  },
  updateBaseboard: (id, changes) =>
    set(s => ({ baseboards: s.baseboards.map(b => b.id === id ? { ...b, ...changes } : b) })),
  deleteBaseboard: (id) =>
    set(s => ({
      baseboards: s.baseboards.filter(b => b.id !== id),
      selectedBaseboardId: s.selectedBaseboardId === id ? null : s.selectedBaseboardId,
    })),
  selectBaseboard: (id) => set({ ...SELECTION_CLEAR, selectedBaseboardId: id, ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}) }),

  addStemWall: (overrides = {}) => {
    const { walls, stemWalls } = get()
    // Default placement: against the back-most wall, recessed 1" into wall.
    let target = walls[0]
    let bestZ = Infinity
    for (const w of walls) {
      const mz = (w.z1 + w.z2) / 2
      if (mz < bestZ) { bestZ = mz; target = w }
    }
    let x = 0, z = 0, rotY = 0
    if (target) {
      const dx = target.x2 - target.x1, dz = target.z2 - target.z1
      const len = Math.hypot(dx, dz) || 1
      const ux = dx / len, uz = dz / len
      const cx = (target.x1 + target.x2) / 2
      const cz = (target.z1 + target.z2) / 2
      let nx = -uz, nz = ux
      if (cx * nx + cz * nz > 0) { nx = -nx; nz = -nz }
      // Stem wall sits FLUSH on the interior wall face, with a tiny 1/16"
      // forward bump to prevent z-fighting with the wall surface. Reads as a
      // thin surface coat (default thickness 0.125" = 1/4 of a baseboard).
      const inset = target.thickness / 2 + 0.0625
      x = cx + nx * inset
      z = cz + nz * inset
      rotY = -Math.atan2(uz, ux)
    }
    const sw: StemWall = {
      id: uid(),
      label: `Stem Wall ${stemWalls.length + 1}`,
      x, z, y: 0, rotY,
      length: 36, height: 4, thickness: 0.125,
      color: '#a8a098',
      flake: false,
      ...overrides,
    }
    set(s => ({
      stemWalls: [...s.stemWalls, sw],
      selectedStemWallId: sw.id,
      // Deselect all other entity types so only the new stem wall is selected.
      selectedWallId: null,
      selectedShapeId: null,
      selectedSlatwallPanelId: null,
      selectedStainlessBacksplashPanelId: null,
      selectedCabinetId: null,
      selectedCountertopId: null,
      selectedBaseboardId: null,
      selectedFloorStepId: null,
      selectedCeilingLightId: null,
      selectedItemId: null,
      selectedRackId: null,
      floorSelected: false,
    }))
  },
  updateStemWall: (id, changes) =>
    set(s => ({ stemWalls: s.stemWalls.map(w => w.id === id ? { ...w, ...changes } : w) })),
  deleteStemWall: (id) =>
    set(s => ({
      stemWalls: s.stemWalls.filter(w => w.id !== id),
      selectedStemWallId: s.selectedStemWallId === id ? null : s.selectedStemWallId,
    })),
  selectStemWall: (id) => set({ ...SELECTION_CLEAR, selectedStemWallId: id, ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}) }),

  slatwallAccessories: [],
  selectedAccessoryId: null,
  addSlatwallAccessory: (panelId, def) => {
    const panel = get().slatwallPanels.find(p => p.id === panelId)
    if (!panel) return
    const panelW = panel.alongEnd - panel.alongStart
    const panelH = panel.yTop - panel.yBottom
    const acc: SlatwallAccessory = {
      id: uid(), panelId,
      type: def.type, label: def.label, sku: def.sku, price: def.price,
      along: panelW / 2,           // center of panel
      yOffset: panelH / 2,         // center of panel
      w: def.w, h: def.h, d: def.d,
      color: def.color,
    }
    set(s => ({ slatwallAccessories: [...s.slatwallAccessories, acc], selectedAccessoryId: acc.id }))
  },
  updateSlatwallAccessory: (id, changes) =>
    set(s => ({ slatwallAccessories: s.slatwallAccessories.map(a => a.id === id ? { ...a, ...changes } : a) })),
  deleteSlatwallAccessory: (id) =>
    set(s => ({
      slatwallAccessories: s.slatwallAccessories.filter(a => a.id !== id),
      selectedAccessoryId: s.selectedAccessoryId === id ? null : s.selectedAccessoryId,
    })),
  selectSlatwallAccessory: (id) => set({ ...SELECTION_CLEAR, selectedAccessoryId: id, ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}) }),

  addImportedAsset: (asset) => set(s => ({ importedAssets: [...s.importedAssets, asset] })),
  deleteImportedAsset: (id) => set(s => ({ importedAssets: s.importedAssets.filter(a => a.id !== id) })),

  addRack: (preset) => {
    const rack: OverheadRack = {
      id: uid(),
      label: preset.label + ' Rack',
      x: 0, z: 0,
      rackWidth: preset.rackWidth,
      rackLength: preset.rackLength,
      drop: 24,    // default 24" drop from ceiling
      rotY: 0,
      color: '#333333',
      sku: preset.sku,
      price: preset.price,
    }
    set(s => ({ overheadRacks: [...s.overheadRacks, rack], selectedRackId: rack.id }))
  },
  updateRack: (id, changes) =>
    set(s => ({ overheadRacks: s.overheadRacks.map(r => r.id === id ? { ...r, ...changes } : r) })),
  deleteRack: (id) =>
    set(s => ({
      overheadRacks: s.overheadRacks.filter(r => r.id !== id),
      selectedRackId: s.selectedRackId === id ? null : s.selectedRackId,
    })),
  selectRack: (id) => set({ ...SELECTION_CLEAR, selectedRackId: id, ...(id !== null ? { floorSelected: false, activeTab: 'overhead' as SidebarTab } : {}) }),

  addItem: (item) => set(s => ({ items: [...s.items, item] })),
  removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
  updateItem: (id, changes) => set(s => ({ items: s.items.map(i => i.id === id ? { ...i, ...changes } : i) })),
  selectItem: (id) => set({ ...SELECTION_CLEAR, selectedItemId: id, ...(id !== null ? { floorSelected: false, activeTab: 'vehicles' as SidebarTab } : {}) }),

  ceilingLights: buildPuckGrid(240 / 12, 264 / 12),  // matches default 20×22 ft garage
  selectedCeilingLightId: null,
  addCeilingLight: (kind = 'bar') => {
    const state = get()
    // ledbar: mount under the currently selected upper cabinet, centered,
    // default length = cabinet width, rotated to match the cabinet face.
    if (kind === 'ledbar') {
      const selId = state.selectedCabinetId
      const cab = selId ? state.cabinets.find(c => c.id === selId) : null
      if (!cab || cab.style !== 'upper') {
        return // silently ignore — UI should disable button when not applicable
      }
      const light: CeilingLight = {
        id: uid(),
        label: 'LED Light Bar',
        kind: 'ledbar',
        x: cab.x / 12, z: cab.z / 12,
        rotY: cab.rotY,
        color: '#ffffff',
        intensity: 2.0,
        enabled: true,
        lengthIn: cab.w,
        y: cab.y / 12, // cabinet bottom face height in feet
      }
      set(s => ({ ceilingLights: [...s.ceilingLights, light], selectedCeilingLightId: light.id }))
      return
    }
    const light: CeilingLight = {
      id: uid(),
      label: kind === 'puck' ? 'Puck Light' : 'LED Bar',
      kind,
      x: 0, z: 0, rotY: 0,
      color: '#ffffff',   // Day color (matches LightingPanel's DAYLIGHT preset)
      intensity: kind === 'puck' ? 5.0 : 1.5,
      enabled: true,
    }
    set(s => ({ ceilingLights: [...s.ceilingLights, light], selectedCeilingLightId: light.id }))
  },
  updateCeilingLight: (id, changes) =>
    set(s => ({ ceilingLights: s.ceilingLights.map(l => l.id === id ? { ...l, ...changes } : l) })),
  deleteCeilingLight: (id) =>
    set(s => ({
      ceilingLights: s.ceilingLights.filter(l => l.id !== id),
      selectedCeilingLightId: s.selectedCeilingLightId === id ? null : s.selectedCeilingLightId,
    })),
  selectCeilingLight: (id) => set({ ...SELECTION_CLEAR, selectedCeilingLightId: id, ...(id !== null ? { floorSelected: false, activeTab: 'lighting' as SidebarTab } : {}) }),

  autoLighting: () => {
    const { garageWidth, garageDepth, ceilingHeight } = get()
    const wFt = garageWidth / 12
    const dFt = garageDepth / 12
    const area = wFt * dFt
    const lights = buildPuckGrid(wFt, dFt)
    // Scale ambient and bounce based on room size
    const ambient = area > 600 ? 0.08 : area > 300 ? 0.06 : 0.05
    const bounce = area > 600 ? 5.0 : area > 300 ? 4.0 : 3.5
    const bounceD = Math.max(20, Math.min(45, Math.max(wFt, dFt) * 1.5))
    const chFt = ceilingHeight / 12
    const lightPower = chFt > 10 ? 18 : chFt > 9 ? 15 : 12
    set({
      ceilingLights: lights,
      sceneLights: [],
      selectedCeilingLightId: null,
      ambientIntensity: ambient,
      bounceIntensity: bounce,
      bounceDistance: bounceD,
      lightMultiplier: lightPower,
      envReflection: 0.08,
      floorReflection: 0.12,
    })
  },

  ambientIntensity: 0.05,
  setAmbientIntensity: (v) => set({ ambientIntensity: v }),
  bounceIntensity: 4,
  setBounceIntensity: (v) => set({ bounceIntensity: v }),
  bounceDistance: 30,
  setBounceDistance: (v) => set({ bounceDistance: v }),
  exposure: 1.0,
  setExposure: (v) => set({ exposure: v }),
  floorReflection: 0.1,
  setFloorReflection: (v) => set({ floorReflection: v }),
  envReflection: 0.05,
  setEnvReflection: (v) => set({ envReflection: v }),
  lightMultiplier: 15,
  setLightMultiplier: (v) => set({ lightMultiplier: v }),
  sceneLights: [],
  addSceneLight: (type) => {
    const light: SceneLight = {
      id: uid(), label: type === 'spot' ? 'Spotlight' : 'Point Light',
      type, x: 0, y: 8, z: 0, color: '#fff8f0',
      intensity: type === 'spot' ? 120 : 80,
      enabled: true, angle: Math.PI / 6, penumbra: 0.3,
    }
    set(s => ({ sceneLights: [...s.sceneLights, light] }))
  },
  updateSceneLight: (id, changes) =>
    set(s => ({ sceneLights: s.sceneLights.map(l => l.id === id ? { ...l, ...changes } : l) })),
  deleteSceneLight: (id) =>
    set(s => ({ sceneLights: s.sceneLights.filter(l => l.id !== id) })),

  // Export shots
  exportShots: [],
  tracingImage: null,
  setTracingImage: (img) => set({ tracingImage: img }),
  updateTracingImage: (changes) => set(s => ({
    tracingImage: s.tracingImage ? { ...s.tracingImage, ...changes } : null,
  })),
  addExportShot: (shot) => set(s => ({ exportShots: [...s.exportShots, shot] })),
  updateExportShot: (id, changes) =>
    set(s => ({ exportShots: s.exportShots.map(sh => sh.id === id ? { ...sh, ...changes } : sh) })),
  deleteExportShot: (id) =>
    set(s => ({ exportShots: s.exportShots.filter(sh => sh.id !== id) })),
  reorderExportShots: (ids) =>
    set(s => {
      const map = new Map(s.exportShots.map(sh => [sh.id, sh]))
      return { exportShots: ids.map(id => map.get(id)!).filter(Boolean) }
    }),

  getQuote: () => {
    const cabs = get().cabinets
    const accs = get().slatwallAccessories
    const cabItems = cabs
      .filter(c => c.sku && c.price)
      .map(c => ({ label: c.label, sku: c.sku!, price: c.price! }))
    const accItems = accs
      .filter(a => a.sku && a.price)
      .map(a => ({ label: a.label, sku: a.sku, price: a.price }))
    const racks = get().overheadRacks
    const rackItems = racks
      .filter(r => r.sku && r.price)
      .map(r => ({ label: r.label, sku: r.sku!, price: r.price! }))
    const lineItems = [...cabItems, ...accItems, ...rackItems]
    const subtotal = lineItems.reduce((sum, item) => sum + item.price, 0)
    const labor = Math.round(subtotal * 0.35)
    return { subtotal, labor, total: subtotal + labor, lineItems }
  },

  projectName: null,
  projectFilePath: null,
  setProjectName: (v) => set({ projectName: v }),
  newProject: () => {
    // Return to the setup screen with a clean slate. Clears the project name
    // so the next save prompts for one. The user re-enters customer/dimensions
    // through GarageSetup, which calls completeSetup() to re-enter the app.
    set({
      setupDone: false,
      projectName: null,
      projectFilePath: null,
      // Selection state — clear so nothing references about-to-be-stale ids.
      ...SELECTION_CLEAR,
    })
  },
  saveProject: async (overrideName?: string) => {
    const s = get()

    // Encode 3D model buffers to base64 asynchronously (handles large files)
    const encodedAssets = await Promise.all(
      s.importedAssets.map(async (a) => {
        if (a.assetType === '3d-model') {
          const base64 = await getCachedModelBase64Async(a.id)
          return { ...a, data: base64 ?? '' }
        }
        return a
      })
    )

    const data = {
      _version: CURRENT_VERSION,
      customerName: s.customerName,
      siteAddress: s.siteAddress,
      consultantName: s.consultantName,
      setupDone: s.setupDone,
      garageWidth: s.garageWidth,
      garageDepth: s.garageDepth,
      ceilingHeight: s.ceilingHeight,
      floorPoints: s.floorPoints,
      walls: s.walls,
      slatwallPanels: s.slatwallPanels,
      stainlessBacksplashPanels: s.stainlessBacksplashPanels,
      floorSteps: s.floorSteps,
      shapes: s.shapes,
      cabinets: s.cabinets,
      countertops: s.countertops,
      baseboards: s.baseboards,
      stemWalls: s.stemWalls,
      items: s.items,
      overheadRacks: s.overheadRacks,
      importedAssets: encodedAssets,
      slatwallAccessories: s.slatwallAccessories,
      flooringColor: s.flooringColor,
      floorTextureScale: s.floorTextureScale,
      ceilingLights: s.ceilingLights,
      ambientIntensity: s.ambientIntensity,
      bounceIntensity: s.bounceIntensity,
      bounceDistance: s.bounceDistance,
      floorReflection: s.floorReflection,
      envReflection: s.envReflection,
      lightMultiplier: s.lightMultiplier,
      exposure: s.exposure,
      sceneLights: s.sceneLights,
      exportShots: s.exportShots,
      tracingImage: s.tracingImage,
    }
    const json = JSON.stringify(data, null, 2)
    // Priority: explicit override → existing projectName → customerName → default.
    const baseName = overrideName
      ?? s.projectName
      ?? (s.customerName ? s.customerName.replace(/[^a-z0-9]/gi, '_') : 'garage-design')

    // Electron path — write directly to disk. If we have a known file path
    // and the user didn't pass an override, silently overwrite that file.
    // Otherwise show a Save As dialog.
    const launcher = (globalThis as unknown as { launcher?: {
      saveProject?: (path: string, content: string) => Promise<boolean>
      saveProjectAs?: (suggestedName: string, content: string) => Promise<string | null | { error: string }>
    } }).launcher
    if (launcher && launcher.saveProject && launcher.saveProjectAs) {
      if (!overrideName && s.projectFilePath) {
        // Silent overwrite of the originally opened/saved file.
        const ok = await launcher.saveProject(s.projectFilePath, json)
        if (ok) return
        // If the write failed (file moved, perms), fall through to Save As.
      }
      const result = await launcher.saveProjectAs(baseName, json)
      const newPath = typeof result === 'string' ? result : null
      if (newPath) {
        const fileName = newPath.split(/[\\/]/).pop() ?? baseName
        const name = fileName.replace(/\.garage$/i, '')
        set({ projectFilePath: newPath, projectName: name })
      }
      return
    }

    // Browser fallback — trigger a download with the computed base name.
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = baseName + '.garage'
    a.click()
    URL.revokeObjectURL(url)
    // Remember this name so subsequent saves reuse it as the suggested filename.
    if (overrideName || !s.projectName) set({ projectName: baseName })
  },

  loadProject: (data: unknown, filename?: string, filePath?: string) => {
    const raw = data as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') {
      alert('Invalid project file.')
      return
    }
    let normalized: ReturnType<typeof normalizeLoadedProject>
    try {
      const migrated = migrateProject(raw)
      normalized = normalizeLoadedProject(migrated)
    } catch (err) {
      alert(`Cannot load project: ${(err as Error).message}`)
      return
    }
    // Derive project name from the loaded filename so subsequent saves
    // overwrite the same file instead of prompting.
    const projectName = filename ? filename.replace(/\.garage$/i, '') : null
    set({
      projectName,
      // File path is only available when opened via Electron's dialog IPC.
      // The browser/file-input flow passes only the filename, so saves fall
      // back to a download with the remembered base name.
      projectFilePath: filePath ?? null,
      ...normalized,
      ...SELECTION_CLEAR,
    })
  },
}))
