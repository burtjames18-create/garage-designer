import { create } from 'zustand'
import { getCachedModelBase64Async, cacheModelBase64 } from '../utils/importedModelCache'

export type ViewMode = 'perspective' | 'wireframe' | 'top' | 'elevation'
export type QualityPreset = 'high' | 'medium' | 'low'
export type SidebarTab = 'walls' | 'flooring' | 'shapes' | 'ceiling' | 'cabinets' | 'overhead' | 'lighting' | 'vehicles' | 'info'

export type LightType = 'point' | 'spot'

// 1ft × 4ft × 2" LED bar — mounts flush to ceiling
export const CEILING_LIGHT_W  = 1      // feet
export const CEILING_LIGHT_L  = 4      // feet
export const CEILING_LIGHT_TH = 2 / 12 // feet (2 inches)

export type CeilingLightKind = 'bar' | 'puck'
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
}

export type CabinetStyle = 'lower' | 'upper' | 'locker'
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
  { key: 't-lower-36-1d2d', label: '36" 1-Drawer 2-Door Lower', line: 'technica', style: 'lower',  doors: 2, drawers: 1, w: 36, d: 24, h: 30.5, sku: 'GL-TEC-BASE-36-1D',  price: 469 },
  { key: 't-lower-36-5dr',  label: '36" 5-Drawer Lower',        line: 'technica', style: 'lower',  doors: 0, drawers: 5, w: 36, d: 24, h: 30.5, sku: 'GL-TEC-BASE-36-5DR', price: 549 },
  { key: 't-lower-28-5dr',  label: '28" 5-Drawer Lower',        line: 'technica', style: 'lower',  doors: 0, drawers: 5, w: 28, d: 24, h: 30.5, sku: 'GL-TEC-BASE-28-5DR', price: 499 },
  { key: 't-lower-20-5dr',  label: '20" 5-Drawer Lower',        line: 'technica', style: 'lower',  doors: 0, drawers: 5, w: 20, d: 24, h: 30.5, sku: 'GL-TEC-BASE-20-5DR', price: 449 },
  { key: 't-locker-36-2',   label: '36" 2-Door Locker',         line: 'technica', style: 'locker', doors: 2, w: 36, d: 24, h: 84, sku: 'GL-TEC-TALL-36', price: 699 },
  { key: 't-locker-28-2',   label: '28" 2-Door Locker',         line: 'technica', style: 'locker', doors: 2, w: 28, d: 24, h: 84, sku: 'GL-TEC-TALL-28', price: 649 },
  { key: 't-locker-20-1',   label: '20" 1-Door Locker',         line: 'technica', style: 'locker', doors: 1, w: 20, d: 24, h: 84, sku: 'GL-TEC-TALL-20', price: 599 },
  { key: 't-upper-36-2',    label: '36" 2-Door Upper',          line: 'technica', style: 'upper',  doors: 2, w: 36, d: 18, h: 30.5, sku: 'GL-TEC-WALL-36', price: 299 },
  { key: 't-upper-28-2',    label: '28" 2-Door Upper',          line: 'technica', style: 'upper',  doors: 2, w: 28, d: 18, h: 30.5, sku: 'GL-TEC-WALL-28', price: 259 },
  { key: 't-upper-20-1',    label: '20" 1-Door Upper',          line: 'technica', style: 'upper',  doors: 1, w: 20, d: 18, h: 30.5, sku: 'GL-TEC-WALL-20', price: 229 },
  // ── Signature ─────────────────────────────────────────────────────────
  { key: 's-lower-20-1',    label: '20" 1-Door Lower',          line: 'signature', style: 'lower',  doors: 1, w: 20, d: 24, h: 30.5, sku: 'GL-SIG-BASE-20',      price: 299 },
  { key: 's-lower-28-2',    label: '28" 2-Door Lower',          line: 'signature', style: 'lower',  doors: 2, w: 28, d: 24, h: 30.5, sku: 'GL-SIG-BASE-28',      price: 379 },
  { key: 's-lower-36-2',    label: '36" 2-Door Lower',          line: 'signature', style: 'lower',  doors: 2, w: 36, d: 24, h: 30.5, sku: 'GL-SIG-BASE-36',      price: 499 },
  { key: 's-lower-36-1d2d', label: '36" 1-Drawer 2-Door Lower', line: 'signature', style: 'lower',  doors: 2, drawers: 1, w: 36, d: 24, h: 30.5, sku: 'GL-SIG-BASE-36-1D',  price: 539 },
  { key: 's-lower-36-5dr',  label: '36" 5-Drawer Lower',        line: 'signature', style: 'lower',  doors: 0, drawers: 5, w: 36, d: 24, h: 30.5, sku: 'GL-SIG-BASE-36-5DR', price: 619 },
  { key: 's-lower-28-5dr',  label: '28" 5-Drawer Lower',        line: 'signature', style: 'lower',  doors: 0, drawers: 5, w: 28, d: 24, h: 30.5, sku: 'GL-SIG-BASE-28-5DR', price: 569 },
  { key: 's-lower-20-5dr',  label: '20" 5-Drawer Lower',        line: 'signature', style: 'lower',  doors: 0, drawers: 5, w: 20, d: 24, h: 30.5, sku: 'GL-SIG-BASE-20-5DR', price: 519 },
  { key: 's-locker-36-2',   label: '36" 2-Door Locker',         line: 'signature', style: 'locker', doors: 2, w: 36, d: 24, h: 84, sku: 'GL-SIG-TALL-36', price: 799 },
  { key: 's-locker-28-2',   label: '28" 2-Door Locker',         line: 'signature', style: 'locker', doors: 2, w: 28, d: 24, h: 84, sku: 'GL-SIG-TALL-28', price: 749 },
  { key: 's-locker-20-1',   label: '20" 1-Door Locker',         line: 'signature', style: 'locker', doors: 1, w: 20, d: 24, h: 84, sku: 'GL-SIG-TALL-20', price: 699 },
  { key: 's-upper-36-2',    label: '36" 2-Door Upper',          line: 'signature', style: 'upper',  doors: 2, w: 36, d: 18, h: 30.5, sku: 'GL-SIG-WALL-36', price: 359 },
  { key: 's-upper-28-2',    label: '28" 2-Door Upper',          line: 'signature', style: 'upper',  doors: 2, w: 28, d: 18, h: 30.5, sku: 'GL-SIG-WALL-28', price: 319 },
  { key: 's-upper-20-1',    label: '20" 1-Door Upper',          line: 'signature', style: 'upper',  doors: 1, w: 20, d: 18, h: 30.5, sku: 'GL-SIG-WALL-20', price: 279 },
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
}

export const COUNTERTOP_DEPTH = 25      // inches, fixed
export const COUNTERTOP_THICKNESS = 1.75  // 1¾ inches

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
  baseboard: boolean
  baseboardHeight: number // inches (default 3.5)
  baseboardColor: string  // hex color (default '#cccccc')
  baseboardTexture: boolean // apply floor flake texture to baseboard (default false)
  stemWall: boolean          // stem wall at bottom of wall, flush with wall face (default false)
  stemWallHeight: number     // inches (default 4)
  stemWallTexture: 'concrete' | 'flake' | 'none' // texture style (default 'concrete')
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

/** A raised floor step/platform — sits on the floor surface, uses floor texture. */
export interface FloorStep {
  id: string
  label: string
  x: number      // center X in inches from garage center
  z: number      // center Z in inches from garage center
  width: number  // inches (X dimension, typically spans full garage width)
  depth: number  // inches (Z dimension)
  height: number // inches (step rise height, default 4)
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

export type ImportAssetType = '3d-model' | 'wall-texture' | 'floor-texture'

/** An imported custom asset (model or texture) stored as a data blob */
export interface ImportedAsset {
  id: string
  name: string         // original filename
  assetType: ImportAssetType
  /** For 3D models: base64-encoded GLB; for textures: data URL */
  data: string
  /** For 3D models: vehicle category */
  modelCategory?: 'car' | 'motorcycle' | 'equipment' | 'furniture'
  /** For 3D models: display label */
  modelLabel?: string
  /** For 3D models: dimensions in inches */
  w?: number
  h?: number
  d?: number
}

function uid(): string {
  return crypto.randomUUID()
}

function makeDefaultWalls(widthIn: number, depthIn: number, heightIn: number): GarageWall[] {
  const hw = widthIn / 2
  const hd = depthIn / 2
  const base: Omit<GarageWall, 'id' | 'label' | 'x1' | 'z1' | 'x2' | 'z2'> = {
    height: heightIn, yOffset: 0, thickness: 3.5, locked: false,
    wallColor: '#f0ede4', openings: [], baseboard: true, baseboardHeight: 4, baseboardColor: '#cccccc', baseboardTexture: false,
    stemWall: false, stemWallHeight: 4, stemWallTexture: 'concrete' as const, visible: true,
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

  // Performance quality preset (only affects live viewport — exports always use high)
  qualityPreset: QualityPreset
  setQualityPreset: (preset: QualityPreset) => void

  // When true, all components render at max quality regardless of qualityPreset
  isExporting: boolean
  setIsExporting: (v: boolean) => void

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

  // Quote / Pricing
  getQuote: () => { subtotal: number; labor: number; total: number; lineItems: { label: string; sku: string; price: number }[] }

  // Save / Load
  saveProject: () => Promise<void>
  loadProject: (data: unknown) => void
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
        color: '#f0f4ff', intensity: 5.0, enabled: true,
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

  floorSteps: [],
  selectedFloorStepId: null,

  shapes: [],
  selectedShapeId: null,

  cabinets: [],
  selectedCabinetId: null,

  countertops: [],
  selectedCountertopId: null,

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
  qualityPreset: 'low' as QualityPreset,
  isExporting: false,

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
      wallColor: '#f0ede4', openings: [], baseboard: true, baseboardHeight: 4, baseboardColor: '#cccccc', baseboardTexture: false,
      stemWall: false, stemWallHeight: 4, stemWallTexture: 'concrete' as const, visible: true,
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

  selectWall: (id) => set({ selectedWallId: id, selectedShapeId: null, selectedSlatwallPanelId: null, selectedCabinetId: null, selectedFloorStepId: null, selectedCeilingLightId: null, selectedItemId: null, selectedRackId: null, ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}) }),

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
    const yBottom = wall.baseboard ? wall.baseboardHeight : 0
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
    return { selectedSlatwallPanelId: id, selectedWallId: panel?.wallId ?? s.selectedWallId, selectedShapeId: null, selectedCabinetId: null, selectedFloorStepId: null, selectedCeilingLightId: null, selectedItemId: null, selectedRackId: null, ...(id !== null ? { floorSelected: false, activeTab: 'walls' as SidebarTab } : {}) }
  }),

  addFloorStep: () => {
    const { garageWidth, garageDepth } = get()
    const step: FloorStep = {
      id: uid(),
      label: `Step ${get().floorSteps.length + 1}`,
      x: 0,
      z: -(garageDepth / 2 - 24),   // near back wall, 24" from back
      width: garageWidth,
      depth: 48,
      height: 4,
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
    selectedFloorStepId: id,
    selectedWallId: null,
    selectedSlatwallPanelId: null,
    selectedShapeId: null,
    selectedCabinetId: null,
    selectedCeilingLightId: null,
    selectedItemId: null,
    selectedRackId: null,
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

  selectShape: (id) => set({ selectedShapeId: id, selectedWallId: null, selectedSlatwallPanelId: null, selectedCabinetId: null, selectedFloorStepId: null, selectedCeilingLightId: null, selectedItemId: null, selectedRackId: null, ...(id !== null ? { floorSelected: false, activeTab: 'shapes' as SidebarTab } : {}) }),

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
  setQualityPreset: (preset) => set(preset === 'high'
    ? { qualityPreset: preset, floorReflection: 0.9, envReflection: 0.25, bounceDistance: 48 }
    : { qualityPreset: preset }),
  setIsExporting: (v) => set({ isExporting: v }),
  setIsDraggingWall: (v) => set({ isDraggingWall: v }),
  beginDrag: () => set(s => { const n = s.dragCount + 1; return { dragCount: n, isDraggingWall: n > 0 } }),
  endDrag: () => set(s => { const n = Math.max(0, s.dragCount - 1); return { dragCount: n, isDraggingWall: n > 0 } }),

  addCabinet: (preset, spawnX = 0, spawnZ = 0, spawnRotY = 0) => {
    const defaultY = preset.style === 'upper' ? 30.5 : 0
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
      color: preset.line === 'signature' ? 'black' : 'mica',
      shellColor: preset.line === 'signature' ? 'black' : undefined,
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

  selectCabinet: (id) => set({ selectedCabinetId: id, selectedWallId: null, selectedShapeId: null, selectedSlatwallPanelId: null, selectedCountertopId: null, selectedFloorStepId: null, selectedCeilingLightId: null, selectedItemId: null, selectedRackId: null, ...(id !== null ? { floorSelected: false, activeTab: 'cabinets' as SidebarTab } : {}) }),

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
  selectCountertop: (id) => set({ selectedCountertopId: id, selectedWallId: null, selectedShapeId: null, selectedSlatwallPanelId: null, selectedCabinetId: null, selectedFloorStepId: null, selectedCeilingLightId: null, selectedItemId: null, selectedRackId: null, ...(id !== null ? { floorSelected: false, activeTab: 'cabinets' as SidebarTab } : {}) }),

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
  selectSlatwallAccessory: (id) => set({ selectedAccessoryId: id, selectedCeilingLightId: null, selectedItemId: null, ...(id !== null ? { activeTab: 'walls' as SidebarTab } : {}) }),

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
  selectRack: (id) => set({ selectedRackId: id, selectedWallId: null, selectedShapeId: null, selectedSlatwallPanelId: null, selectedCabinetId: null, selectedCountertopId: null, selectedFloorStepId: null, selectedCeilingLightId: null, selectedItemId: null, ...(id !== null ? { floorSelected: false, activeTab: 'overhead' as SidebarTab } : {}) }),

  addItem: (item) => set(s => ({ items: [...s.items, item] })),
  removeItem: (id) => set(s => ({ items: s.items.filter(i => i.id !== id) })),
  updateItem: (id, changes) => set(s => ({ items: s.items.map(i => i.id === id ? { ...i, ...changes } : i) })),
  selectItem: (id) => set({ selectedItemId: id, selectedRackId: null, selectedCeilingLightId: null, selectedWallId: null, selectedShapeId: null, selectedCabinetId: null, selectedCountertopId: null, selectedFloorStepId: null, ...(id !== null ? { floorSelected: false, activeTab: 'vehicles' as SidebarTab } : {}) }),

  ceilingLights: buildPuckGrid(240 / 12, 264 / 12),  // matches default 20×22 ft garage
  selectedCeilingLightId: null,
  addCeilingLight: (kind = 'bar') => {
    const light: CeilingLight = {
      id: uid(),
      label: kind === 'puck' ? 'Puck Light' : 'LED Bar',
      kind,
      x: 0, z: 0, rotY: 0,
      color: kind === 'puck' ? '#f0f4ff' : '#fff8f0',
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
  selectCeilingLight: (id) => set({ selectedCeilingLightId: id, selectedWallId: null, selectedShapeId: null, selectedSlatwallPanelId: null, selectedCabinetId: null, selectedCountertopId: null, selectedFloorStepId: null, selectedItemId: null, selectedRackId: null, ...(id !== null ? { floorSelected: false, activeTab: 'lighting' as SidebarTab } : {}) }),

  autoLighting: () => {
    const { garageWidth, garageDepth, ceilingHeight } = get()
    const wFt = garageWidth / 12
    const dFt = garageDepth / 12
    const area = wFt * dFt
    const lights = buildPuckGrid(wFt, dFt)
    // Scale ambient and bounce based on room size
    const ambient = area > 600 ? 0.20 : area > 300 ? 0.18 : 0.15
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

  ambientIntensity: 0.15,
  setAmbientIntensity: (v) => set({ ambientIntensity: v }),
  bounceIntensity: 4,
  setBounceIntensity: (v) => set({ bounceIntensity: v }),
  bounceDistance: 30,
  setBounceDistance: (v) => set({ bounceDistance: v }),
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
      intensity: type === 'spot' ? 1.5 : 1.0,
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

  saveProject: async () => {
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
      _version: 1,
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
      floorSteps: s.floorSteps,
      shapes: s.shapes,
      cabinets: s.cabinets,
      countertops: s.countertops,
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
      sceneLights: s.sceneLights,
      exportShots: s.exportShots,
    }
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const name = s.customerName
      ? s.customerName.replace(/[^a-z0-9]/gi, '_') + '.garage'
      : 'garage-design.garage'
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
  },

  loadProject: (data: unknown) => {
    const d = data as Record<string, unknown>
    if (!d || typeof d !== 'object' || d._version !== 1) {
      alert('Invalid or unsupported project file.')
      return
    }
    set({
      customerName:     (d.customerName as string)     ?? '',
      siteAddress:      (d.siteAddress as string)       ?? '',
      consultantName:   (d.consultantName as string)    ?? 'Garage Living',
      setupDone:        (d.setupDone as boolean)        ?? true,
      garageWidth:      (d.garageWidth as number)       ?? 240,
      garageDepth:      (d.garageDepth as number)       ?? 264,
      ceilingHeight:    (d.ceilingHeight as number)     ?? 108,
      floorPoints:      (d.floorPoints as FloorPoint[]) ?? [],
      walls:            ((d.walls as GarageWall[]) ?? []).map(w => ({ ...w, visible: w.visible ?? true, stemWall: w.stemWall ?? false, stemWallHeight: w.stemWallHeight ?? 6, stemWallTexture: w.stemWallTexture ?? 'concrete' as const })),
      slatwallPanels:   (d.slatwallPanels as SlatwallPanel[]) ?? [],
      floorSteps:       (d.floorSteps as FloorStep[])   ?? [],
      shapes:           (d.shapes as GarageShape[])     ?? [],
      cabinets:         ((d.cabinets as PlacedCabinet[]) ?? []).map(c => ({ ...c, line: c.line ?? 'technica' as const })),
      countertops:      (d.countertops as Countertop[]) ?? [],
      items:            (d.items as PlacedItem[])       ?? [],
      overheadRacks:    (d.overheadRacks as OverheadRack[]) ?? [],
      importedAssets:   (() => {
        const assets = (d.importedAssets as ImportedAsset[]) ?? []
        // Restore 3D model data from save file into the blob cache
        for (const a of assets) {
          if (a.assetType === '3d-model' && a.data) {
            cacheModelBase64(a.id, a.data)
          }
        }
        // Clear the heavy data from state — it's now in the cache
        return assets.map(a => a.assetType === '3d-model' ? { ...a, data: '' } : a)
      })(),
      slatwallAccessories: (d.slatwallAccessories as SlatwallAccessory[]) ?? [],
      flooringColor:    (d.flooringColor as string)     ?? 'quicksilver',
      floorTextureScale:(d.floorTextureScale as number) ?? 6,
      ceilingLights:    (d.ceilingLights as CeilingLight[]) ?? [],
      ambientIntensity: (d.ambientIntensity as number)  ?? 0.02,
      bounceIntensity:  (d.bounceIntensity as number)  ?? 4,
      bounceDistance:   (d.bounceDistance as number)    ?? 30,
      floorReflection:  (d.floorReflection as number)  ?? 0.1,
      envReflection:    (d.envReflection as number)    ?? 0.05,
      lightMultiplier:  (d.lightMultiplier as number)  ?? 15,
      sceneLights:      (d.sceneLights as SceneLight[]) ?? [],
      exportShots:      (d.exportShots as ExportShot[]) ?? [],
      // reset selection state
      selectedWallId: null,
      selectedSlatwallPanelId: null,
      selectedFloorStepId: null,
      selectedShapeId: null,
      selectedCabinetId: null,
      selectedCountertopId: null,
      selectedItemId: null,
      selectedCeilingLightId: null,
      selectedRackId: null,
    })
  },
}))
