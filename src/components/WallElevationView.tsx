import { useRef, useState, useEffect } from 'react'
import { useGarageStore, CABINET_PRESETS, COUNTERTOP_THICKNESS, COUNTERTOP_DEPTH } from '../store/garageStore'
import type { GarageWall, PlacedCabinet, SlatwallPanel, StainlessBacksplashPanel, Countertop, FloorStep, Baseboard, StemWall } from '../store/garageStore'
import { slatwallColors } from '../data/slatwallColors'
import { snapToGrid, inchesToDisplay } from '../utils/measurements'
import {
  wallLen, wallDir, wallNormal,
  projectCabinet, isCabinetOnWall, cabinetWallSide,
  projectCountertop, isCountertopOnWall,
  getStepWallProjection,
} from '../utils/wallGeometry'
import { cabinetFrontPaths } from './CabinetFrontSVG'
import { getOpeningModelById } from '../data/openingModels'
import './WallElevationView.css'
import './Viewer3D.css'

const PAD = 40  // SVG padding in wall-space inches — leaves room for dim tiers + corner stubs
const SNAP_DIST = 2  // inches

// ─── Drag state ───────────────────────────────────────────────────────────────

interface SvgDrag {
  type: 'panel-body' | 'panel-corner' | 'backsplash-body' | 'backsplash-corner' | 'cabinet' | 'countertop' | 'opening-body' | 'opening-corner' | 'bb-body' | 'bb-edge' | 'sw-body' | 'sw-edge'
  id: string
  corner?: 0 | 1 | 2 | 3
  moved: boolean  // becomes true once pointer moves past click threshold
  startSvgX: number
  startSvgY: number
  startAlongStart?: number
  startAlongEnd?: number
  startYBottom?: number
  startYTop?: number
  startCabAlong?: number
  startCabX?: number
  startCabZ?: number
  startCabY?: number
  startCtAlong?: number
  startCtX?: number
  startCtZ?: number
  startCtY?: number
  startCtWidth?: number
  ctEdge?: 'left' | 'right'
  // Opening drag fields
  startXOffset?: number
  startWidth?: number
  startOpYOffset?: number
  startOpHeight?: number
  // Baseboard / stem-wall drag fields
  startBbAlong?: number   // along-wall center at drag start
  startBbX?: number
  startBbZ?: number
  startBbY?: number       // bottom Y
  startBbLength?: number
  bbEdge?: 'left' | 'right'
}

// ─── Display colors ───────────────────────────────────────────────────────────
const COUNTERTOP_HEX: Record<string, string> = {
  'butcher-block': '#b5813a', 'stainless-steel': '#b0b4b8', 'black-stainless': '#484b50',
  white: '#e8e8e4', black: '#2a2a2a', concrete: '#8a8a80',
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WallElevationView() {
  const {
    walls, slatwallPanels, stainlessBacksplashPanels, cabinets, countertops, floorSteps, baseboards, stemWalls,
    elevationWallIndex, setElevationWallIndex,
    updateSlatwallPanel, selectSlatwallPanel, selectedSlatwallPanelId, addSlatwallPanel, deleteSlatwallPanel,
    updateStainlessBacksplashPanel, selectStainlessBacksplashPanel, selectedStainlessBacksplashPanelId,
    addStainlessBacksplashPanel, deleteStainlessBacksplashPanel,
    updateCabinet, selectCabinet, selectedCabinetId, addCabinet, deleteCabinet,
    updateCountertop, selectCountertop, selectedCountertopId, addCountertop, deleteCountertop,
    updateBaseboard, selectBaseboard, selectedBaseboardId,
    updateStemWall, selectStemWall, selectedStemWallId,
    updateOpening, selectWall,
    elevationSide, setElevationSide,
    snappingEnabled, setSnappingEnabled,
  } = useGarageStore()

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<SvgDrag | null>(null)
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null)
  const wallSide = elevationSide
  const setWallSide = setElevationSide

  // ── Pan/zoom state (refs for atomic updates) ──
  const weZoomRef = useRef(1)
  const wePanRef = useRef<[number, number]>([0, 0])
  const [, weForce] = useState(0)
  const wePanning = useRef(false)
  const weLastMouse = useRef<[number, number]>([0, 0])

  const wallIdx = Math.max(0, Math.min(elevationWallIndex, walls.length - 1))
  const wall = walls[wallIdx]

  // Reset zoom/pan when switching walls
  useEffect(() => {
    weZoomRef.current = 1; wePanRef.current = [0, 0]; weForce(n => n + 1)
  }, [wallIdx])

  if (!wall) return <div className="wall-elev-empty">No walls defined yet.</div>

  const wLen = wallLen(wall)
  const wH = wall.height
  // Compute baseboard projections onto this wall (for snap + dim breakpoints)
  const wallBaseboards: { id: string; alongStart: number; alongEnd: number; y: number; height: number }[] = []
  // Separate per-kind Y ranges for the vertical dim tier classifier.
  const wallBbRanges: { bottom: number; top: number }[] = []
  const wallSwRanges: { bottom: number; top: number }[] = []
  const wallStepRanges: { bottom: number; top: number }[] = []
  for (const bb of baseboards) {
    const bux = Math.cos(bb.rotY), buz = -Math.sin(bb.rotY)
    const halfL = bb.length / 2
    const ends: [number, number][] = [
      [bb.x - bux * halfL, bb.z - buz * halfL],
      [bb.x + bux * halfL, bb.z + buz * halfL],
    ]
    const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
    const wl = Math.hypot(wdx, wdz)
    if (wl < 0.1) continue
    const wux = wdx / wl, wuz = wdz / wl
    const wnx = -wuz, wnz = wux
    const perpDist = Math.abs((bb.x - wall.x1) * wnx + (bb.z - wall.z1) * wnz)
    if (perpDist > wall.thickness / 2 + bb.thickness + 6) continue
    let minU = Infinity, maxU = -Infinity
    for (const [px, pz] of ends) {
      const u = (px - wall.x1) * wux + (pz - wall.z1) * wuz
      minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    }
    const u0 = Math.max(0, minU), u1 = Math.min(wLen, maxU)
    if (u1 - u0 < 0.5) continue
    wallBaseboards.push({ id: bb.id, alongStart: u0, alongEnd: u1, y: bb.y, height: bb.height })
    wallBbRanges.push({ bottom: bb.y, top: bb.y + bb.height })
  }
  for (const sw of stemWalls) {
    const bux = Math.cos(sw.rotY), buz = -Math.sin(sw.rotY)
    const halfL = sw.length / 2
    const ends: [number, number][] = [
      [sw.x - bux * halfL, sw.z - buz * halfL],
      [sw.x + bux * halfL, sw.z + buz * halfL],
    ]
    const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
    const wl = Math.hypot(wdx, wdz)
    if (wl < 0.1) continue
    const wux = wdx / wl, wuz = wdz / wl
    const wnx = -wuz, wnz = wux
    const perpDist = Math.abs((sw.x - wall.x1) * wnx + (sw.z - wall.z1) * wnz)
    if (perpDist > wall.thickness / 2 + sw.thickness + 6) continue
    let minU = Infinity, maxU = -Infinity
    for (const [px, pz] of ends) {
      const u = (px - wall.x1) * wux + (pz - wall.z1) * wuz
      minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    }
    const u0 = Math.max(0, minU), u1 = Math.min(wLen, maxU)
    if (u1 - u0 < 0.5) continue
    wallBaseboards.push({ id: sw.id, alongStart: u0, alongEnd: u1, y: sw.y, height: sw.height })
    wallSwRanges.push({ bottom: sw.y, top: sw.y + sw.height })
  }
  // Step-ups attached to this wall contribute height ranges (0 → step height).
  for (const step of floorSteps) {
    const proj = getStepWallProjection(step, wall)
    if (!proj) continue
    wallStepRanges.push({ bottom: 0, top: proj.height })
  }
  const svgW = wLen + 2 * PAD
  const hasAnySlatwall = slatwallPanels.some(p => p.wallId === wall.id && (p.alongEnd - p.alongStart) >= 1)
  const svgH = wH + 2 * PAD + (hasAnySlatwall ? 20 : 0)

  const toX = (along: number) => PAD + along
  const toY = (h: number) => PAD + wH - h
  const fromX = (svgX: number) => svgX - PAD
  const fromY = (svgY: number) => wH - (svgY - PAD)

  const wallPanels = slatwallPanels.filter(p => p.wallId === wall.id && (p.side ?? 'interior') === wallSide)
  const wallBacksplashes = stainlessBacksplashPanels.filter(p => p.wallId === wall.id && (p.side ?? 'interior') === wallSide)
  const wallCabinets = cabinets.filter(c => isCabinetOnWall(c, wall, wallSide))
  const wallCountertops = countertops.filter(ct => isCountertopOnWall(ct, wall))
  const [dx, dz] = wallDir(wall)
  const [nx, nz] = wallNormal(wall)

  // ─── Connecting wall stubs ─────────────────────────────────────────────────
  interface WallStub { along: number; thickness: number; height: number }
  const wallStubs: WallStub[] = []
  for (const other of walls) {
    if (other.id === wall.id) continue
    for (const [px, pz] of [[other.x1, other.z1], [other.x2, other.z2]] as [number, number][]) {
      const relX = px - wall.x1, relZ = pz - wall.z1
      const along = relX * dx + relZ * dz
      const perp = Math.abs(relX * (-dz) + relZ * dx)
      if (perp > wall.thickness / 2 + 8) continue
      if (along < -8 || along > wLen + 8) continue
      const clamped = Math.max(0, Math.min(along, wLen))
      if (!wallStubs.some(s => Math.abs(s.along - clamped) < 3)) {
        wallStubs.push({ along: clamped, thickness: other.thickness, height: other.height })
      }
    }
  }

  // ─── Shared snap helpers ───────────────────────────────────────────────────

  /** Effective left/right edges of the wall face, accounting for corner stubs */
  const getWallEdges = () => {
    let leftEdge = 0, rightEdge = wLen
    for (const stub of wallStubs) {
      if (stub.along <= 2) leftEdge = Math.max(leftEdge, stub.thickness / 2)
      else if (stub.along >= wLen - 2) rightEdge = Math.min(rightEdge, wLen - stub.thickness / 2)
    }
    return { leftEdge, rightEdge }
  }

  const getMidStubs = () => wallStubs.filter(s => s.along > 2 && s.along < wLen - 2)

  /**
   * Build horizontal snap targets for an element with a given half-width.
   * Each target specifies which edge of the dragged element aligns to it.
   */
  const buildAlongSnaps = (halfW: number, selfId: string) => {
    const { leftEdge, rightEdge } = getWallEdges()
    const snaps: { target: number; forEdge: 'left' | 'right' }[] = []

    // Wall edges
    snaps.push({ target: leftEdge + halfW, forEdge: 'left' })
    snaps.push({ target: rightEdge - halfW, forEdge: 'right' })

    // Mid-wall stubs
    for (const stub of getMidStubs()) {
      const sL = stub.along - stub.thickness / 2
      const sR = stub.along + stub.thickness / 2
      snaps.push({ target: sL - halfW, forEdge: 'right' })  // right edge → stub left face
      snaps.push({ target: sR + halfW, forEdge: 'left' })   // left edge → stub right face
    }

    // Other slatwall panels
    for (const p of wallPanels) {
      if (p.id === selfId) continue
      snaps.push({ target: p.alongEnd + halfW,   forEdge: 'left' })   // left → panel right
      snaps.push({ target: p.alongStart - halfW, forEdge: 'right' })  // right → panel left
      snaps.push({ target: p.alongStart + halfW, forEdge: 'left' })   // align left edges
      snaps.push({ target: p.alongEnd - halfW,   forEdge: 'right' })  // align right edges
    }

    // Stainless backsplash panels — cross-snap with slatwall
    for (const p of wallBacksplashes) {
      if (p.id === selfId) continue
      snaps.push({ target: p.alongEnd + halfW,   forEdge: 'left' })
      snaps.push({ target: p.alongStart - halfW, forEdge: 'right' })
      snaps.push({ target: p.alongStart + halfW, forEdge: 'left' })
      snaps.push({ target: p.alongEnd - halfW,   forEdge: 'right' })
    }

    // Cabinets
    for (const cab of wallCabinets) {
      if (cab.id === selfId) continue
      const { along: oA } = projectCabinet(cab, wall)
      snaps.push({ target: oA + cab.w / 2 + halfW, forEdge: 'left' })
      snaps.push({ target: oA - cab.w / 2 - halfW, forEdge: 'right' })
      snaps.push({ target: oA - cab.w / 2 + halfW, forEdge: 'left' })
      snaps.push({ target: oA + cab.w / 2 - halfW, forEdge: 'right' })
    }

    // Countertops
    for (const ct of wallCountertops) {
      if (ct.id === selfId) continue
      const { along: oA } = projectCountertop(ct, wall)
      snaps.push({ target: oA + ct.width / 2 + halfW, forEdge: 'left' })
      snaps.push({ target: oA - ct.width / 2 - halfW, forEdge: 'right' })
      snaps.push({ target: oA - ct.width / 2 + halfW, forEdge: 'left' })
      snaps.push({ target: oA + ct.width / 2 - halfW, forEdge: 'right' })
    }

    // Doors, windows, and garage doors — snap to the outer edges of the
    // opening (casing outside for procedural doors; rough-opening edges
    // otherwise, which for garage doors IS the inside edge of the opening).
    for (const op of wall.openings) {
      if (op.type !== 'door' && op.type !== 'window' && op.type !== 'garage-door') continue
      if (op.id === selfId) continue
      const entry = op.modelId ? getOpeningModelById(op.modelId) : undefined
      // Windows render with a 3" casing in the elevation view (matching 3D);
      // cabinets butting up against a window land at the outer trim edge.
      // Procedural doors use their own 2.5" casing.
      const ext = op.type === 'window' ? 3
        : entry?.kind === 'procedural' ? 2.5 : 0
      const leftSide  = op.xOffset - ext
      const rightSide = op.xOffset + op.width + ext
      snaps.push({ target: rightSide + halfW, forEdge: 'left' })   // left edge → opening right
      snaps.push({ target: leftSide  - halfW, forEdge: 'right' })  // right edge → opening left
      snaps.push({ target: leftSide  + halfW, forEdge: 'left' })   // align left edges
      snaps.push({ target: rightSide - halfW, forEdge: 'right' })  // align right edges
    }

    // Baseboards & stem walls on this wall — butt-up and edge-align.
    for (const wb of wallBaseboards) {
      if (wb.id === selfId) continue
      snaps.push({ target: wb.alongEnd + halfW,   forEdge: 'left' })   // our left → their right (butt)
      snaps.push({ target: wb.alongStart - halfW, forEdge: 'right' })  // our right → their left
      snaps.push({ target: wb.alongStart + halfW, forEdge: 'left' })   // align left edges
      snaps.push({ target: wb.alongEnd - halfW,   forEdge: 'right' })  // align right edges
    }

    // Step-up along-wall edges — piece ends align with step left/right.
    for (const step of floorSteps) {
      const proj = getStepWallProjection(step, wall)
      if (!proj) continue
      snaps.push({ target: proj.alongEnd + halfW,   forEdge: 'left' })
      snaps.push({ target: proj.alongStart - halfW, forEdge: 'right' })
      snaps.push({ target: proj.alongStart + halfW, forEdge: 'left' })
      snaps.push({ target: proj.alongEnd - halfW,   forEdge: 'right' })
    }

    return { snaps, leftEdge, rightEdge }
  }

  /** Build vertical snap targets (expressed as bottom-edge positions).
   *  When `along` and `halfW` are provided, adds position-aware snaps for
   *  floor steps — the baseboard-on-step snap only fires if the object
   *  horizontally overlaps the step. */
  const buildYSnaps = (selfId: string, along?: number, halfW?: number) => {
    const snaps: { target: number; forEdge: 'bottom' | 'top' }[] = []
    snaps.push({ target: 0, forEdge: 'bottom' })     // floor
    snaps.push({ target: wH, forEdge: 'top' })       // ceiling
    // Baseboard/stem wall tops as snap targets (position-aware)
    for (const wb of wallBaseboards) {
      const objOverlaps = along !== undefined && halfW !== undefined
        ? (along + halfW > wb.alongStart && along - halfW < wb.alongEnd)
        : true
      if (objOverlaps) {
        const top = wb.y + wb.height
        snaps.push({ target: top, forEdge: 'bottom' })
        snaps.push({ target: top, forEdge: 'top' })
      }
    }
    for (const p of wallPanels) {
      if (p.id === selfId) continue
      snaps.push({ target: p.yTop,    forEdge: 'bottom' })
      snaps.push({ target: p.yBottom, forEdge: 'top' })
      snaps.push({ target: p.yBottom, forEdge: 'bottom' })
      snaps.push({ target: p.yTop,    forEdge: 'top' })
    }
    for (const p of wallBacksplashes) {
      if (p.id === selfId) continue
      snaps.push({ target: p.yTop,    forEdge: 'bottom' })
      snaps.push({ target: p.yBottom, forEdge: 'top' })
      snaps.push({ target: p.yBottom, forEdge: 'bottom' })
      snaps.push({ target: p.yTop,    forEdge: 'top' })
    }
    for (const cab of wallCabinets) {
      if (cab.id === selfId) continue
      snaps.push({ target: cab.y + cab.h, forEdge: 'bottom' })
      snaps.push({ target: cab.y,         forEdge: 'top' })
      snaps.push({ target: cab.y,         forEdge: 'bottom' })
      snaps.push({ target: cab.y + cab.h, forEdge: 'top' })
    }
    for (const ct of wallCountertops) {
      if (ct.id === selfId) continue
      snaps.push({ target: ct.y + COUNTERTOP_THICKNESS, forEdge: 'bottom' })
      snaps.push({ target: ct.y,                        forEdge: 'top' })
      snaps.push({ target: ct.y,                        forEdge: 'bottom' })
      snaps.push({ target: ct.y + COUNTERTOP_THICKNESS, forEdge: 'top' })
    }
    // Door & window tops/bottoms — position-aware so items only snap when
    // they horizontally overlap the opening.
    for (const op of wall.openings) {
      if (op.type !== 'door' && op.type !== 'window') continue
      if (op.id === selfId) continue
      const opLeft  = op.xOffset
      const opRight = op.xOffset + op.width
      const overlaps = along !== undefined && halfW !== undefined
        ? (along + halfW > opLeft && along - halfW < opRight)
        : true
      if (!overlaps) continue
      const opBot = op.yOffset
      const opTop = op.yOffset + op.height
      snaps.push({ target: opTop, forEdge: 'bottom' })   // our bottom = opening top
      snaps.push({ target: opTop, forEdge: 'top' })      // align tops
      snaps.push({ target: opBot, forEdge: 'bottom' })   // align bottoms
      snaps.push({ target: opBot, forEdge: 'top' })      // our top = opening bottom
    }
    // Floor step snaps — step top, and baseboard-on-step top (position-aware)
    for (const step of floorSteps) {
      const proj = getStepWallProjection(step, wall)
      if (!proj) continue
      // Only snap to this step's height if the object overlaps it horizontally
      const objOverlapsStep = along !== undefined && halfW !== undefined
        ? (along + halfW > proj.alongStart && along - halfW < proj.alongEnd)
        : true
      if (objOverlapsStep) {
        snaps.push({ target: proj.height, forEdge: 'bottom' })
        snaps.push({ target: proj.height, forEdge: 'top' })
        // Baseboard on top of step
        for (const wb of wallBaseboards) {
          if (Math.abs(wb.y - proj.height) < 1) {
            const top = proj.height + wb.height
            snaps.push({ target: top, forEdge: 'bottom' })
            snaps.push({ target: top, forEdge: 'top' })
          }
        }
      }
    }
    return snaps
  }

  /** Best snapped center position for a body-drag (checks both edges).
   *  `clampToWall=true` uses wall endpoints as the clamp (for baseboards/stem
   *  walls which should reach perpendicular wall faces to close visible
   *  gaps); default uses stub-inset edges so cabinets/panels can't clip into
   *  perpendicular walls. */
  const findBestAlong = (rawCenter: number, halfW: number, selfId: string, clampToWall = false) => {
    const { snaps, leftEdge, rightEdge } = buildAlongSnaps(halfW, selfId)
    let best = snapToGrid(rawCenter), bestDist = SNAP_DIST + 1
    for (const { target } of snaps) {
      const d = Math.abs(rawCenter - target)
      if (d < SNAP_DIST && d < bestDist) { bestDist = d; best = target }
    }
    const lo = clampToWall ? halfW : leftEdge + halfW
    const hi = clampToWall ? wLen - halfW : rightEdge - halfW
    return Math.max(lo, Math.min(best, hi))
  }

  /** Best snapped position for a specific edge being dragged. */
  const findBestEdge = (rawEdge: number, selfId: string, edge: 'left' | 'right', clampToWall = false) => {
    const { snaps, leftEdge, rightEdge } = buildAlongSnaps(0, selfId)
    const candidates = snaps.filter(s => s.forEdge === edge)
    let best = snapToGrid(rawEdge), bestDist = SNAP_DIST + 1
    for (const { target } of candidates) {
      const d = Math.abs(rawEdge - target)
      if (d < SNAP_DIST && d < bestDist) { bestDist = d; best = target }
    }
    const lo = clampToWall ? 0 : leftEdge
    const hi = clampToWall ? wLen : rightEdge
    return edge === 'left' ? Math.max(lo, best) : Math.min(hi, best)
  }

  /** Best snapped bottom position, checking both bottom and top edges.
   *  Pass `along`/`halfW` for position-aware step snapping. */
  const findBestY = (rawBottom: number, objH: number, selfId: string, along?: number, halfW?: number) => {
    const ySnaps = buildYSnaps(selfId, along, halfW)
    let bestBottom = snapToGrid(rawBottom), bestDist = SNAP_DIST + 1
    for (const { target, forEdge } of ySnaps) {
      const edgePos = forEdge === 'bottom' ? rawBottom : rawBottom + objH
      const snapBot = forEdge === 'bottom' ? target : target - objH
      const d = Math.abs(edgePos - target)
      if (d < SNAP_DIST && d < bestDist) { bestDist = d; bestBottom = snapBot }
    }
    return bestBottom
  }

  /** Best snapped position for a specific Y edge (top or bottom). */
  const findBestYEdge = (rawEdge: number, selfId: string, edge: 'bottom' | 'top', along?: number, halfW?: number) => {
    const ySnaps = buildYSnaps(selfId, along, halfW)
    let best = snapToGrid(rawEdge), bestDist = SNAP_DIST + 1
    for (const { target, forEdge } of ySnaps) {
      if (forEdge !== edge) continue
      const d = Math.abs(rawEdge - target)
      if (d < SNAP_DIST && d < bestDist) { bestDist = d; best = target }
    }
    return best
  }

  // ── SVG coordinate helper ──────────────────────────────────────────────────

  const getSvgPt = (e: React.MouseEvent | MouseEvent) => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX; pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    return pt.matrixTransform(ctm.inverse())
  }

  // ── Pointer down handlers ──────────────────────────────────────────────────

  const onPanelDown = (e: React.MouseEvent, panel: SlatwallPanel) => {
    e.stopPropagation()

    // Ctrl+click = duplicate the slatwall panel
    if (e.ctrlKey || e.metaKey) {
      addSlatwallPanel(wall.id, wallSide)
      const panels = useGarageStore.getState().slatwallPanels
      const newPanel = panels[panels.length - 1]
      if (newPanel) {
        updateSlatwallPanel(newPanel.id, {
          alongStart: panel.alongStart, alongEnd: panel.alongEnd,
          yBottom: panel.yBottom + (panel.yTop - panel.yBottom) + 2,
          yTop: panel.yTop + (panel.yTop - panel.yBottom) + 2,
          color: panel.color,
        })
        selectSlatwallPanel(newPanel.id)
      }
      return
    }

    const pt = getSvgPt(e)
    if (!pt) return
    dragRef.current = {
      type: 'panel-body', id: panel.id, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startAlongStart: panel.alongStart, startAlongEnd: panel.alongEnd,
      startYBottom: panel.yBottom, startYTop: panel.yTop,
    }
  }

  const onCornerDown = (e: React.MouseEvent, panel: SlatwallPanel, corner: 0 | 1 | 2 | 3) => {
    e.stopPropagation()
    // Corner drag is always a resize — select the panel immediately so its handles stay active
    selectSlatwallPanel(panel.id)
    const pt = getSvgPt(e)
    if (!pt) return
    dragRef.current = {
      type: 'panel-corner', id: panel.id, corner, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startAlongStart: panel.alongStart, startAlongEnd: panel.alongEnd,
      startYBottom: panel.yBottom, startYTop: panel.yTop,
    }
  }

  const onBacksplashDown = (e: React.MouseEvent, panel: StainlessBacksplashPanel) => {
    e.stopPropagation()

    // Ctrl+click = duplicate the backsplash panel
    if (e.ctrlKey || e.metaKey) {
      addStainlessBacksplashPanel(wall.id, wallSide)
      const panels = useGarageStore.getState().stainlessBacksplashPanels
      const newPanel = panels[panels.length - 1]
      if (newPanel) {
        updateStainlessBacksplashPanel(newPanel.id, {
          alongStart: panel.alongStart, alongEnd: panel.alongEnd,
          yBottom: panel.yBottom + (panel.yTop - panel.yBottom) + 2,
          yTop: panel.yTop + (panel.yTop - panel.yBottom) + 2,
        })
        selectStainlessBacksplashPanel(newPanel.id)
      }
      return
    }

    const pt = getSvgPt(e)
    if (!pt) return
    dragRef.current = {
      type: 'backsplash-body', id: panel.id, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startAlongStart: panel.alongStart, startAlongEnd: panel.alongEnd,
      startYBottom: panel.yBottom, startYTop: panel.yTop,
    }
  }

  const onBacksplashCornerDown = (e: React.MouseEvent, panel: StainlessBacksplashPanel, corner: 0 | 1 | 2 | 3) => {
    e.stopPropagation()
    selectStainlessBacksplashPanel(panel.id)
    const pt = getSvgPt(e)
    if (!pt) return
    dragRef.current = {
      type: 'backsplash-corner', id: panel.id, corner, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startAlongStart: panel.alongStart, startAlongEnd: panel.alongEnd,
      startYBottom: panel.yBottom, startYTop: panel.yTop,
    }
  }

  const onCabDown = (e: React.MouseEvent, cab: PlacedCabinet) => {
    e.stopPropagation()

    // Ctrl+click = duplicate the cabinet with a small offset
    if (e.ctrlKey || e.metaKey) {
      const preset = CABINET_PRESETS.find(p => p.key === cab.presetKey)
      if (preset) {
        addCabinet(preset, cab.x + 6, cab.z, cab.rotY)
        const newCab = useGarageStore.getState().cabinets[useGarageStore.getState().cabinets.length - 1]
        if (newCab) {
          updateCabinet(newCab.id, { y: cab.y, color: cab.color })
          selectCabinet(newCab.id)
        }
      }
      return
    }

    const pt = getSvgPt(e)
    if (!pt) return
    const { along } = projectCabinet(cab, wall)
    dragRef.current = {
      type: 'cabinet', id: cab.id, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startCabAlong: along, startCabX: cab.x, startCabZ: cab.z, startCabY: cab.y,
    }
  }

  const onOpeningDown = (e: React.MouseEvent, op: { id: string; xOffset: number; width: number; yOffset: number; height: number }) => {
    e.stopPropagation()
    selectWall(wall.id)
    setSelectedOpeningId(op.id)
    const pt = getSvgPt(e)
    if (!pt) return
    dragRef.current = {
      type: 'opening-body', id: op.id, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startXOffset: op.xOffset, startWidth: op.width,
      startOpYOffset: op.yOffset, startOpHeight: op.height,
    }
  }

  const onOpeningCornerDown = (
    e: React.MouseEvent,
    op: { id: string; xOffset: number; width: number; yOffset: number; height: number },
    corner: 0 | 1 | 2 | 3,
  ) => {
    e.stopPropagation()
    selectWall(wall.id)
    setSelectedOpeningId(op.id)
    const pt = getSvgPt(e)
    if (!pt) return
    dragRef.current = {
      type: 'opening-corner', id: op.id, corner, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startXOffset: op.xOffset, startWidth: op.width,
      startOpYOffset: op.yOffset, startOpHeight: op.height,
    }
  }

  const onCtDown = (e: React.MouseEvent, ct: Countertop, edge?: 'left' | 'right') => {
    e.stopPropagation()

    // Ctrl+click = duplicate the countertop
    if (e.ctrlKey || e.metaKey) {
      addCountertop()
      const newId = useGarageStore.getState().selectedCountertopId
      if (newId) {
        updateCountertop(newId, { x: ct.x + 6, z: ct.z, y: ct.y, rotY: ct.rotY, width: ct.width, color: ct.color })
      }
      return
    }

    if (ct.locked) {
      // Locked items can't be dragged, so treat a press as a pure click selection
      selectCountertop(ct.id)
      return
    }
    const pt = getSvgPt(e)
    if (!pt) return
    const { along } = projectCountertop(ct, wall)
    dragRef.current = {
      type: 'countertop', id: ct.id, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startCtAlong: along, startCtX: ct.x, startCtZ: ct.z, startCtY: ct.y,
      startCtWidth: ct.width, ctEdge: edge,
    }
  }

  // Shared pointerdown for baseboard OR stem wall (body or edge).
  const onPieceDown = (
    e: React.MouseEvent,
    piece: { id: string; x: number; z: number; rotY: number; length: number; y: number; locked?: boolean },
    kind: 'bb' | 'sw',
    edge?: 'left' | 'right',
  ) => {
    e.stopPropagation()
    // Select immediately so the blue resize handles become visible even before
    // the user lets go of the mouse.
    if (kind === 'bb') selectBaseboard(piece.id)
    else selectStemWall(piece.id)
    if (piece.locked) return
    const pt = getSvgPt(e)
    if (!pt) return
    // Project the piece's center onto the wall's along-axis.
    const vx = piece.x - wall.x1, vz = piece.z - wall.z1
    const along = vx * dx + vz * dz
    dragRef.current = {
      type: edge ? (kind === 'bb' ? 'bb-edge' : 'sw-edge') : (kind === 'bb' ? 'bb-body' : 'sw-body'),
      id: piece.id, moved: false,
      startSvgX: pt.x, startSvgY: pt.y,
      startBbAlong: along,
      startBbX: piece.x, startBbZ: piece.z, startBbY: piece.y,
      startBbLength: piece.length,
      bbEdge: edge,
    }
  }

  // ── Mouse move ─────────────────────────────────────────────────────────────

  const onMouseMove = (e: React.MouseEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const pt = getSvgPt(e)
    if (!pt) return

    const dAlong = pt.x - drag.startSvgX
    const dHeight = -(pt.y - drag.startSvgY)

    // Mark as a drag once the pointer moves more than ~1 inch in any direction.
    // Below this threshold we treat the press as a click (selection happens on mouseup).
    if (!drag.moved && Math.hypot(dAlong, dHeight) > 1) {
      drag.moved = true
    }

    // ── Slatwall panel body drag ───────────────────────────────────────────
    if (drag.type === 'panel-body') {
      const panel = slatwallPanels.find(p => p.id === drag.id)
      if (!panel) return
      const panelW = drag.startAlongEnd! - drag.startAlongStart!
      const panelH = drag.startYTop! - drag.startYBottom!
      const rawCenter = drag.startAlongStart! + panelW / 2 + dAlong
      const rawBottom = drag.startYBottom! + dHeight

      const newCenter = findBestAlong(rawCenter, panelW / 2, panel.id)
      const newStart = newCenter - panelW / 2
      const newBottom = Math.max(0, Math.min(findBestY(rawBottom, panelH, panel.id), wH - panelH))

      updateSlatwallPanel(drag.id, {
        alongStart: newStart, alongEnd: newStart + panelW,
        yBottom: newBottom, yTop: newBottom + panelH,
      })
    }

    // ── Slatwall panel corner drag (resize) ────────────────────────────────
    if (drag.type === 'panel-corner') {
      const panel = slatwallPanels.find(p => p.id === drag.id)
      if (!panel) return
      let newStart = drag.startAlongStart!
      let newEnd = drag.startAlongEnd!
      let newBottom = drag.startYBottom!
      let newTop = drag.startYTop!
      const c = drag.corner!
      const { leftEdge, rightEdge } = getWallEdges()

      if (c === 0 || c === 3) { // left edge
        newStart = findBestEdge(drag.startAlongStart! + dAlong, panel.id, 'left')
        newStart = Math.max(leftEdge, Math.min(newStart, newEnd - 1))
      }
      if (c === 1 || c === 2) { // right edge
        newEnd = findBestEdge(drag.startAlongEnd! + dAlong, panel.id, 'right')
        newEnd = Math.max(newStart + 1, Math.min(newEnd, rightEdge))
      }
      if (c === 0 || c === 1) { // top edge
        newTop = findBestYEdge(drag.startYTop! + dHeight, panel.id, 'top')
        newTop = Math.min(wH, Math.max(newTop, newBottom + 1))
      }
      if (c === 2 || c === 3) { // bottom edge
        newBottom = findBestYEdge(drag.startYBottom! + dHeight, panel.id, 'bottom')
        newBottom = Math.max(0, Math.min(newBottom, newTop - 1))
      }
      updateSlatwallPanel(drag.id, { alongStart: newStart, alongEnd: newEnd, yBottom: newBottom, yTop: newTop })
    }

    // ── Backsplash panel body drag ─────────────────────────────────────────
    if (drag.type === 'backsplash-body') {
      const panel = stainlessBacksplashPanels.find(p => p.id === drag.id)
      if (!panel) return
      const panelW = drag.startAlongEnd! - drag.startAlongStart!
      const panelH = drag.startYTop! - drag.startYBottom!
      const rawCenter = drag.startAlongStart! + panelW / 2 + dAlong
      const rawBottom = drag.startYBottom! + dHeight

      const newCenter = findBestAlong(rawCenter, panelW / 2, panel.id)
      const newStart = newCenter - panelW / 2
      const newBottom = Math.max(0, Math.min(findBestY(rawBottom, panelH, panel.id), wH - panelH))

      updateStainlessBacksplashPanel(drag.id, {
        alongStart: newStart, alongEnd: newStart + panelW,
        yBottom: newBottom, yTop: newBottom + panelH,
      })
    }

    // ── Backsplash panel corner drag (resize) ──────────────────────────────
    if (drag.type === 'backsplash-corner') {
      const panel = stainlessBacksplashPanels.find(p => p.id === drag.id)
      if (!panel) return
      let newStart = drag.startAlongStart!
      let newEnd = drag.startAlongEnd!
      let newBottom = drag.startYBottom!
      let newTop = drag.startYTop!
      const c = drag.corner!
      const { leftEdge, rightEdge } = getWallEdges()

      if (c === 0 || c === 3) {
        newStart = findBestEdge(drag.startAlongStart! + dAlong, panel.id, 'left')
        newStart = Math.max(leftEdge, Math.min(newStart, newEnd - 1))
      }
      if (c === 1 || c === 2) {
        newEnd = findBestEdge(drag.startAlongEnd! + dAlong, panel.id, 'right')
        newEnd = Math.max(newStart + 1, Math.min(newEnd, rightEdge))
      }
      if (c === 0 || c === 1) {
        newTop = findBestYEdge(drag.startYTop! + dHeight, panel.id, 'top')
        newTop = Math.min(wH, Math.max(newTop, newBottom + 1))
      }
      if (c === 2 || c === 3) {
        newBottom = findBestYEdge(drag.startYBottom! + dHeight, panel.id, 'bottom')
        newBottom = Math.max(0, Math.min(newBottom, newTop - 1))
      }
      updateStainlessBacksplashPanel(drag.id, { alongStart: newStart, alongEnd: newEnd, yBottom: newBottom, yTop: newTop })
    }

    // ── Cabinet body drag ──────────────────────────────────────────────────
    if (drag.type === 'cabinet') {
      const cab = cabinets.find(c => c.id === drag.id)
      if (!cab) return
      const rawAlong = drag.startCabAlong! + dAlong
      const rawY = drag.startCabY! + dHeight

      const newCenter = findBestAlong(rawAlong, cab.w / 2, cab.id)
      const delta = newCenter - drag.startCabAlong!
      // Pass along position so Y-snap is aware of which floor step the cabinet is over
      const clampedY = Math.max(0, Math.min(findBestY(rawY, cab.h, cab.id, newCenter, cab.w / 2), wH - cab.h))

      updateCabinet(drag.id, {
        x: drag.startCabX! + dx * delta,
        z: drag.startCabZ! + dz * delta,
        y: clampedY,
      })
    }

    // ── Opening (door/window) body drag ───────────────────────────────────
    if (drag.type === 'opening-body') {
      const op = wall.openings.find(o => o.id === drag.id)
      if (!op) return
      const rawX = drag.startXOffset! + dAlong
      const newX = Math.max(0, Math.min(wLen - drag.startWidth!, Math.round(rawX * 4) / 4))
      // Vertical move too, so a door can be lifted up onto a baseboard,
      // stem wall, or step-up. findBestY handles snapping to baseboard/
      // stem-wall tops, cabinet bottoms, wall floor/ceiling, and step tops.
      const rawY = drag.startOpYOffset! + dHeight
      const halfW = drag.startWidth! / 2
      const centerAlong = newX + halfW
      const snappedY = findBestY(rawY, drag.startOpHeight!, op.id, centerAlong, halfW)
      const newY = Math.max(0, Math.min(wH - drag.startOpHeight!, snappedY))
      updateOpening(wall.id, drag.id, { xOffset: newX, yOffset: newY })
    }

    // ── Opening corner drag (resize) ──────────────────────────────────────
    if (drag.type === 'opening-corner') {
      const op = wall.openings.find(o => o.id === drag.id)
      if (!op) return
      const MIN = 12
      const startLeft = drag.startXOffset!
      const startRight = drag.startXOffset! + drag.startWidth!
      const startBot = drag.startOpYOffset!
      const startTop = drag.startOpYOffset! + drag.startOpHeight!
      let newLeft = startLeft, newRight = startRight
      let newBot = startBot, newTop = startTop
      const c = drag.corner!
      if (c === 0 || c === 3) {
        // left edge
        newLeft = Math.max(0, Math.min(startRight - MIN, Math.round((startLeft + dAlong) * 4) / 4))
      }
      if (c === 1 || c === 2) {
        // right edge
        newRight = Math.max(startLeft + MIN, Math.min(wLen, Math.round((startRight + dAlong) * 4) / 4))
      }
      if (c === 0 || c === 1) {
        // top edge
        newTop = Math.max(newBot + MIN, Math.min(wH, Math.round((startTop + dHeight) * 4) / 4))
      }
      if (c === 2 || c === 3) {
        // bottom edge
        newBot = Math.max(0, Math.min(newTop - MIN, Math.round((startBot + dHeight) * 4) / 4))
      }
      updateOpening(wall.id, drag.id, {
        xOffset: newLeft,
        width: newRight - newLeft,
        yOffset: newBot,
        height: newTop - newBot,
      })
    }

    // ── Countertop drag (body or edge resize) ──────────────────────────────
    if (drag.type === 'countertop') {
      const ct = countertops.find(c => c.id === drag.id)
      if (!ct) return
      const initW = drag.startCtWidth!

      if (drag.ctEdge === 'left') {
        const fixedRight = drag.startCtAlong! + initW / 2
        const rawLeft = drag.startCtAlong! - initW / 2 + dAlong
        const snappedLeft = findBestEdge(rawLeft, ct.id, 'left')
        const newWidth = Math.max(6, fixedRight - snappedLeft)
        const newCenter = fixedRight - newWidth / 2
        const delta = newCenter - drag.startCtAlong!
        updateCountertop(drag.id, {
          x: drag.startCtX! + dx * delta,
          z: drag.startCtZ! + dz * delta,
          width: newWidth,
        })
      } else if (drag.ctEdge === 'right') {
        const fixedLeft = drag.startCtAlong! - initW / 2
        const rawRight = drag.startCtAlong! + initW / 2 + dAlong
        const snappedRight = findBestEdge(rawRight, ct.id, 'right')
        const newWidth = Math.max(6, snappedRight - fixedLeft)
        const newCenter = fixedLeft + newWidth / 2
        const delta = newCenter - drag.startCtAlong!
        updateCountertop(drag.id, {
          x: drag.startCtX! + dx * delta,
          z: drag.startCtZ! + dz * delta,
          width: newWidth,
        })
      } else {
        // Body move
        const rawAlong = drag.startCtAlong! + dAlong
        const rawY = drag.startCtY! + dHeight
        const newCenter = findBestAlong(rawAlong, ct.width / 2, ct.id)
        const delta = newCenter - drag.startCtAlong!
        const clampedY = Math.max(0, Math.min(findBestY(rawY, COUNTERTOP_THICKNESS, ct.id), wH - COUNTERTOP_THICKNESS))
        updateCountertop(drag.id, {
          x: drag.startCtX! + dx * delta,
          z: drag.startCtZ! + dz * delta,
          y: clampedY,
        })
      }
    }

    // ── Baseboard / stem-wall body drag (slide along wall + vertical Y) ────
    if (drag.type === 'bb-body' || drag.type === 'sw-body') {
      const isBb = drag.type === 'bb-body'
      const piece = isBb
        ? baseboards.find(b => b.id === drag.id)
        : stemWalls.find(s => s.id === drag.id)
      if (!piece) return
      const halfL = drag.startBbLength! / 2
      const rawAlong = drag.startBbAlong! + dAlong
      // Snap to wall edges, other pieces, openings, cabinets, steps, etc.
      // Baseboards/stem walls clamp to wall endpoints so they can reach the
      // full wall length at corners.
      const snappedAlong = findBestAlong(rawAlong, halfL, drag.id, true)
      const newCenter = Math.max(halfL, Math.min(wLen - halfL, snappedAlong))
      const delta = newCenter - drag.startBbAlong!
      const rawY = drag.startBbY! + dHeight
      const snappedY = findBestY(rawY, piece.height, drag.id, newCenter, halfL)
      const newY = Math.max(0, Math.min(wH - piece.height, snappedY))
      const update = { x: drag.startBbX! + dx * delta, z: drag.startBbZ! + dz * delta, y: newY }
      if (isBb) updateBaseboard(drag.id, update)
      else updateStemWall(drag.id, update)
    }

    // ── Baseboard / stem-wall edge resize ──────────────────────────────────
    if (drag.type === 'bb-edge' || drag.type === 'sw-edge') {
      const isBb = drag.type === 'bb-edge'
      const piece = isBb
        ? baseboards.find(b => b.id === drag.id)
        : stemWalls.find(s => s.id === drag.id)
      if (!piece) return
      const side = drag.bbEdge!
      // Fixed end stays put; opposite end tracks the cursor.
      const startCenter = drag.startBbAlong!
      const startLen = drag.startBbLength!
      const fixedEnd = side === 'left' ? startCenter + startLen / 2 : startCenter - startLen / 2
      const movingEndRaw = (side === 'left' ? startCenter - startLen / 2 : startCenter + startLen / 2) + dAlong
      // Snap the moving edge to other pieces, wall edges, step edges, etc.
      // Baseboards/stem walls clamp to wall endpoints so they can reach the
      // full wall length at corners.
      const snappedMoving = findBestEdge(movingEndRaw, drag.id, side, true)
      // Clamp moving end to the wall span and enforce a 3" minimum length.
      const clampedMoving = Math.max(0, Math.min(wLen, snappedMoving))
      const newLen = Math.max(3, Math.abs(fixedEnd - clampedMoving))
      const newCenter = side === 'left' ? fixedEnd - newLen / 2 : fixedEnd + newLen / 2
      const delta = newCenter - startCenter
      const update = {
        length: Math.round(newLen * 4) / 4,
        x: drag.startBbX! + dx * delta,
        z: drag.startBbZ! + dz * delta,
      }
      if (isBb) updateBaseboard(drag.id, update)
      else updateStemWall(drag.id, update)
    }
  }

  const onMouseUp = () => {
    const drag = dragRef.current
    if (drag && !drag.moved) {
      // Pure click (no drag) — open the item's settings by selecting it
      if (drag.type === 'panel-body' || drag.type === 'panel-corner') selectSlatwallPanel(drag.id)
      else if (drag.type === 'backsplash-body' || drag.type === 'backsplash-corner') selectStainlessBacksplashPanel(drag.id)
      else if (drag.type === 'cabinet') selectCabinet(drag.id)
      else if (drag.type === 'countertop') selectCountertop(drag.id)
      else if (drag.type === 'bb-body' || drag.type === 'bb-edge') selectBaseboard(drag.id)
      else if (drag.type === 'sw-body' || drag.type === 'sw-edge') selectStemWall(drag.id)
      else if (drag.type === 'opening-body' || drag.type === 'opening-corner') selectWall(wall.id)
    }
    dragRef.current = null
  }

  // Escape key deselects
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectSlatwallPanel(null); selectStainlessBacksplashPanel(null); selectCabinet(null); selectCountertop(null)
        selectBaseboard(null); selectStemWall(null)
        setSelectedOpeningId(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectSlatwallPanel, selectStainlessBacksplashPanel, selectCabinet, selectCountertop, selectBaseboard, selectStemWall])

  // Clear opening selection when switching walls
  useEffect(() => { setSelectedOpeningId(null) }, [wallIdx])

  // ── Add cabinet to this wall ───────────────────────────────────────────────

  // ── Add countertop to this wall ────────────────────────────────────────────

  const addCountertopToWall = () => {
    addCountertop()
    const newId = useGarageStore.getState().selectedCountertopId
    if (newId) {
      const along = wLen / 2
      const offset = wall.thickness / 2 + COUNTERTOP_DEPTH / 2
      const sSign = wallSide === 'exterior' ? -1 : 1
      const faceNx = sSign * -dz, faceNz = sSign * dx
      updateCountertop(newId, {
        x: wall.x1 + dx * along + faceNx * offset,
        z: wall.z1 + dz * along + faceNz * offset,
        rotY: Math.atan2(faceNx, faceNz),
      })
    }
  }

  // ── Groove lines for a slatwall panel ─────────────────────────────────────

  const grooveLines = (panel: SlatwallPanel) => {
    const lines: JSX.Element[] = []
    for (let g = panel.yBottom + 3; g < panel.yTop; g += 3) {
      lines.push(
        <line key={g}
          x1={toX(panel.alongStart)} y1={toY(g)}
          x2={toX(panel.alongEnd)} y2={toY(g)}
          stroke="rgba(0,0,0,0.18)" strokeWidth={0.4} pointerEvents="none"
        />
      )
    }
    return lines
  }

  const colorHex = (colorId: string) => slatwallColors.find(c => c.id === colorId)?.hex ?? '#939490'
  const HANDLE_R = Math.max(3, Math.min(8, wLen * 0.006))

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="wall-elev-wrap">

      <div className="view-label view-label--blueprint">Wall Edit</div>

      {/* Controls bar */}
      <div className="wall-elev-controls">
        <div className="wall-elev-actions">
          <button className="wall-elev-btn" onClick={() => addSlatwallPanel(wall.id, wallSide)}>+ Slatwall</button>
          <button className="wall-elev-btn" onClick={() => addStainlessBacksplashPanel(wall.id, wallSide)}>+ Backsplash</button>
          <button className="wall-elev-btn" onClick={addCountertopToWall}>+ Countertop</button>
          {selectedSlatwallPanelId && wallPanels.some(p => p.id === selectedSlatwallPanelId) && (
            <button className="wall-elev-del" onClick={() => deleteSlatwallPanel(selectedSlatwallPanelId)}>✕ Panel</button>
          )}
          {selectedStainlessBacksplashPanelId && wallBacksplashes.some(p => p.id === selectedStainlessBacksplashPanelId) && (
            <button className="wall-elev-del" onClick={() => deleteStainlessBacksplashPanel(selectedStainlessBacksplashPanelId)}>✕ Backsplash</button>
          )}
          {selectedCabinetId && wallCabinets.some(c => c.id === selectedCabinetId) && (
            <button className="wall-elev-del" onClick={() => deleteCabinet(selectedCabinetId)}>✕ Cabinet</button>
          )}
          {selectedCountertopId && wallCountertops.some(ct => ct.id === selectedCountertopId) && (
            <button className="wall-elev-del" onClick={() => deleteCountertop(selectedCountertopId)}>✕ Countertop</button>
          )}
        </div>

        <div className="wall-elev-nav-group">
          <button className="wall-elev-nav" title="Previous wall"
            onClick={() => setElevationWallIndex((wallIdx - 1 + walls.length) % walls.length)}>◀</button>
          <div className="wall-elev-title-group">
            <span className="wall-elev-title">{wall.label}</span>
            <span className="wall-elev-sub">
              {inchesToDisplay(wLen)} wide · {inchesToDisplay(wH)} tall · {wallIdx + 1}/{walls.length}
            </span>
          </div>
          <button className="wall-elev-nav" title="Next wall"
            onClick={() => setElevationWallIndex((wallIdx + 1) % walls.length)}>▶</button>
          <button
            className="wall-elev-btn"
            style={{ marginLeft: 8, fontSize: 11 }}
            onClick={() => setWallSide(wallSide === 'interior' ? 'exterior' : 'interior')}
            title="Toggle interior / exterior side"
          >
            {wallSide === 'interior' ? 'Interior' : 'Exterior'}
          </button>
        </div>
      </div>

      {/* SVG elevation with pan/zoom */}
      <div
        className="wall-elev-svg-wrap"
        onWheel={e => {
          e.preventDefault()
          const factor = e.deltaY > 0 ? 0.9 : 1.1
          const oldZ = weZoomRef.current
          const newZ = Math.min(Math.max(oldZ * factor, 0.5), 10)
          const r = newZ / oldZ
          const rect = e.currentTarget.getBoundingClientRect()
          const mx = e.clientX - rect.left - rect.width / 2
          const my = e.clientY - rect.top - rect.height / 2
          const [px, py] = wePanRef.current
          weZoomRef.current = newZ
          wePanRef.current = [mx * (1 - r) + px * r, my * (1 - r) + py * r]
          weForce(n => n + 1)
        }}
        onPointerDown={e => {
          // Only start viewport pan on middle-click or right-click, left-click is for element drag
          if (e.button === 1 || e.button === 2) {
            e.preventDefault()
            wePanning.current = true
            weLastMouse.current = [e.clientX, e.clientY]
            ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          }
        }}
        onPointerMove={e => {
          if (!wePanning.current) return
          const dx = e.clientX - weLastMouse.current[0]
          const dy = e.clientY - weLastMouse.current[1]
          weLastMouse.current = [e.clientX, e.clientY]
          wePanRef.current = [wePanRef.current[0] + dx, wePanRef.current[1] + dy]
          weForce(n => n + 1)
        }}
        onPointerUp={() => { wePanning.current = false }}
        onContextMenu={e => e.preventDefault()}
      >
        <div style={{
          transform: `translate(${wePanRef.current[0]}px, ${wePanRef.current[1]}px) scale(${weZoomRef.current})`,
          transformOrigin: 'center center',
          width: '100%',
          height: '100%',
        }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="xMidYMid meet"
          className="wall-elev-svg"
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClick={() => { selectSlatwallPanel(null); selectCabinet(null); selectCountertop(null); selectBaseboard(null); selectStemWall(null); setSelectedOpeningId(null) }}
        >
          <defs>
            <clipPath id="wall-face-clip">
              {(() => {
                let cl = PAD, cr = PAD + wLen
                for (const stub of wallStubs) {
                  if (stub.along <= 2) cl = PAD - stub.thickness
                  else if (stub.along >= wLen - 2) cr = PAD + wLen + stub.thickness
                }
                return <rect x={cl} y={PAD} width={cr - cl} height={wH} />
              })()}
            </clipPath>
            <pattern id="backsplash-diamondplate" patternUnits="userSpaceOnUse" width={12} height={12}>
              <image
                href={`${import.meta.env.BASE_URL}assets/textures/metal/diamondplate/color.jpg`}
                x={0} y={0} width={12} height={12}
                preserveAspectRatio="xMidYMid slice"
              />
            </pattern>
          </defs>

          {/* Outer background */}
          <rect x={0} y={0} width={svgW} height={svgH} fill="#f4f4f2" />

          {/* Wall face — extended behind corner stubs so there's no gap */}
          {(() => {
            let faceLeft = PAD, faceRight = PAD + wLen
            for (const stub of wallStubs) {
              if (stub.along <= 2) faceLeft = PAD - stub.thickness
              else if (stub.along >= wLen - 2) faceRight = PAD + wLen + stub.thickness
            }
            return <rect x={faceLeft} y={PAD} width={faceRight - faceLeft} height={wH} fill="#ffffff" />
          })()}

          {/* Middle wall cross-sections */}
          {wallStubs.filter(s => s.along >= 2 && s.along <= wLen - 2).map((stub, i) => (
            <g key={i} pointerEvents="none">
              <rect
                x={toX(stub.along - stub.thickness / 2)} y={PAD}
                width={stub.thickness} height={Math.min(stub.height, wH)}
                fill="#d8d8d4" stroke="#aaa" strokeWidth={0.5} opacity={0.9} />
              <line
                x1={toX(stub.along)} y1={PAD}
                x2={toX(stub.along)} y2={PAD + wH}
                stroke="#bbb" strokeWidth={0.6} strokeDasharray="5 4" />
            </g>
          ))}

          {/* Grid lines — every 12" */}
          {Array.from({ length: Math.floor(wH / 12) + 1 }, (_, i) => i * 12).map(h =>
            h > 0 && h < wH && (
              <line key={`hg${h}`}
                x1={PAD} y1={toY(h)} x2={PAD + wLen} y2={toY(h)}
                stroke="#ebebea" strokeWidth={0.4} strokeDasharray="4 4" />
            )
          )}
          {Array.from({ length: Math.floor(wLen / 12) + 1 }, (_, i) => i * 12).map(a =>
            a > 0 && a < wLen && (
              <line key={`vg${a}`}
                x1={toX(a)} y1={PAD} x2={toX(a)} y2={PAD + wH}
                stroke="#ebebea" strokeWidth={0.4} strokeDasharray="4 4" />
            )
          )}

          {/* Floor steps — rendered as raised floor sections along the wall */}
          {floorSteps.map(step => {
            const proj = getStepWallProjection(step, wall)
            if (!proj) return null
            return (
              <g key={step.id} pointerEvents="none">
                <rect
                  x={toX(proj.alongStart)} y={toY(proj.height)}
                  width={proj.alongEnd - proj.alongStart} height={proj.height}
                  fill="#c8bfa0" stroke="#a09880" strokeWidth={0.5} opacity={0.6}
                />
                <text
                  x={toX((proj.alongStart + proj.alongEnd) / 2)}
                  y={toY(proj.height / 2)}
                  textAnchor="middle" dominantBaseline="central"
                  fontSize={Math.min(8, proj.height * 0.6)} fill="#665" pointerEvents="none"
                >
                  {step.label} ({step.height}")
                </text>
              </g>
            )
          })}

          {/* Openings */}
          {wall.openings.map(op => {
            const draggable = op.type === 'door' || op.type === 'window' || op.type === 'garage-door'
            const hitRect = draggable ? (
              <rect
                x={toX(op.xOffset)} y={toY(op.yOffset + op.height)}
                width={op.width} height={op.height}
                fill="transparent"
                style={{ cursor: 'move', pointerEvents: 'all' }}
                onMouseDown={e => onOpeningDown(e, op)}
                onClick={e => e.stopPropagation()}
              />
            ) : null
            if (op.type === 'door' && (op.modelId === 'custom-plain' || op.modelId === 'custom-double')) {
              const casW = 2.5
              const jambT = 0.75, gap = 0.125, bottomGap = 0.75
              const slabX = op.xOffset + jambT + gap
              const slabW = op.width - 2 * (jambT + gap)
              const slabTopY = op.yOffset + op.height - jambT - gap
              const slabBotY = op.yOffset + bottomGap
              return (
                <g key={op.id}>
                  {/* Casing / frame */}
                  <rect
                    x={toX(op.xOffset - casW)}
                    y={toY(op.yOffset + op.height + casW)}
                    width={op.width + 2 * casW}
                    height={op.height + casW}
                    fill={op.frameColor ?? '#f0ede4'}
                    stroke="#666" strokeWidth={0.5}
                  />
                  {/* Slab */}
                  <rect
                    x={toX(slabX)} y={toY(slabTopY)}
                    width={slabW} height={slabTopY - slabBotY}
                    fill={op.doorColor ?? '#e0dedd'}
                    stroke="#444" strokeWidth={0.5}
                  />
                  {/* Handle at 36" from floor */}
                  <circle
                    cx={toX(slabX + slabW - 2.75)} cy={toY(36)} r={1.1}
                    fill="#B8B8B0" stroke="#222" strokeWidth={0.3}
                  />
                  {hitRect}
                </g>
              )
            }
            // Windows render with a visible casing trim around the rough
            // opening (~2.5" outer casing, 1" sash frame, glass interior with
            // a single horizontal muntin). Doors and garage-doors keep the
            // plain rect render below.
            if (op.type === 'window') {
              const x0 = toX(op.xOffset), y0 = toY(op.yOffset + op.height)
              const w = op.width, h = op.height
              const casW = 3       // outer casing trim — matches 3D casing & snap target
              const sash = 0.5     // inner sash frame
              const innerX = x0 + casW
              const innerY = y0 + casW
              const innerW = Math.max(0, w - 2 * casW)
              const innerH = Math.max(0, h - 2 * casW)
              return (
                <g key={op.id}
                  style={draggable ? { cursor: 'move' } : undefined}
                  onMouseDown={draggable ? (e => onOpeningDown(e, op)) : undefined}
                  onClick={draggable ? (e => e.stopPropagation()) : undefined}>
                  {/* Outer casing — wider rect surrounding the opening */}
                  <rect x={x0 - casW} y={y0 - casW}
                    width={w + 2 * casW} height={h + 2 * casW}
                    fill="#ffffff" stroke="#888" strokeWidth={0.5} />
                  {/* Glass pane */}
                  <rect x={innerX} y={innerY} width={innerW} height={innerH}
                    fill="#cfe6f0" stroke="#888" strokeWidth={0.4} />
                  {/* Sash frame (inner border around glass) */}
                  <rect x={innerX + sash} y={innerY + sash}
                    width={Math.max(0, innerW - 2 * sash)} height={Math.max(0, innerH - 2 * sash)}
                    fill="none" stroke="#aaa" strokeWidth={0.3} />
                </g>
              )
            }
            return (
              <g key={op.id}>
                <rect
                  x={toX(op.xOffset)} y={toY(op.yOffset + op.height)}
                  width={op.width} height={op.height}
                  fill="#f4f4f2" stroke="#aaa" strokeWidth={0.5}
                  style={draggable ? { cursor: 'move' } : undefined}
                  onMouseDown={draggable ? (e => onOpeningDown(e, op)) : undefined}
                  onClick={draggable ? (e => e.stopPropagation()) : undefined}
                />
              </g>
            )
          })}

          {/* Opening resize handles — all four corners on the selected
              opening. Bottom handles let users adjust the sill height
              (especially useful for windows). Corner indices match the
              drag handler: 0=top-left, 1=top-right, 2=bottom-right,
              3=bottom-left. Also draws an elevation dim line from the
              floor up to the opening's bottom so you can read its sill
              height at a glance. */}
          {wall.openings
            .filter(op => (op.type === 'door' || op.type === 'window' || op.type === 'garage-door') && op.id === selectedOpeningId)
            .map(op => {
              const left  = toX(op.xOffset)
              const right = toX(op.xOffset + op.width)
              const top   = toY(op.yOffset + op.height)
              const bot   = toY(op.yOffset)
              const corners: [0 | 1 | 2 | 3, number, number][] = [
                [0, left, top],
                [1, right, top],
                [2, right, bot],
                [3, left, bot],
              ]
              const cursorFor = (c: 0 | 1 | 2 | 3) =>
                c === 0 || c === 2 ? 'nwse-resize' : 'nesw-resize'
              // Elevation dim — vertical line from floor to opening bottom
              // sitting just left of the window, with the height labelled.
              // Skip when yOffset is 0 (no elevation to label).
              const dimX = left - 6
              const floorY = toY(0)
              const elevLabelY = (floorY + bot) / 2
              return (
                <g key={`dh-${op.id}`}>
                  {op.yOffset > 0.1 && (
                    <g pointerEvents="none">
                      <line x1={dimX} y1={floorY} x2={dimX} y2={bot}
                        stroke="#44aaff" strokeWidth={0.5} />
                      <line x1={dimX - 1.4} y1={floorY} x2={dimX + 1.4} y2={floorY}
                        stroke="#44aaff" strokeWidth={0.5} />
                      <line x1={dimX - 1.4} y1={bot} x2={dimX + 1.4} y2={bot}
                        stroke="#44aaff" strokeWidth={0.5} />
                      <text x={dimX - 1.5} y={elevLabelY}
                        textAnchor="end" dominantBaseline="middle"
                        fontSize={3.5} fontWeight={600}
                        fill="#1a6db0">
                        {inchesToDisplay(op.yOffset)}
                      </text>
                    </g>
                  )}
                  {corners.map(([c, cx, cy]) => (
                    <circle key={c} cx={cx} cy={cy} r={2.4}
                      fill="#fff" stroke="#44aaff" strokeWidth={0.8}
                      style={{ cursor: cursorFor(c) }}
                      onMouseDown={e => onOpeningCornerDown(e, op, c)}
                      onClick={e => e.stopPropagation()}
                    />
                  ))}
                </g>
              )
            })}

          {/* Baseboards — rendered AFTER openings so they stay visible on walls
              with a garage door/opening (the opening's opaque fill used to
              cover them when they rendered first). */}
          {baseboards.map(bb => {
            const ux = Math.cos(bb.rotY), uz = -Math.sin(bb.rotY)
            const halfL = bb.length / 2
            const ends: [number, number][] = [
              [bb.x - ux * halfL, bb.z - uz * halfL],
              [bb.x + ux * halfL, bb.z + uz * halfL],
            ]
            const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
            const wLen2 = Math.hypot(wdx, wdz)
            if (wLen2 < 0.1) return null
            const wux = wdx / wLen2, wuz = wdz / wLen2
            const wnx = -wuz, wnz = wux
            let minU = Infinity, maxU = -Infinity
            for (const [px, pz] of ends) {
              const u = (px - wall.x1) * wux + (pz - wall.z1) * wuz
              minU = Math.min(minU, u); maxU = Math.max(maxU, u)
            }
            const perpDist = Math.abs((bb.x - wall.x1) * wnx + (bb.z - wall.z1) * wnz)
            if (perpDist > wall.thickness / 2 + bb.thickness + 6) return null
            const u0 = Math.max(0, minU), u1 = Math.min(wLen, maxU)
            if (u1 - u0 < 0.5) return null
            const segW = u1 - u0
            const cx = toX(u0) + segW / 2
            const cy = toY(bb.y + bb.height) + bb.height / 2
            const fs = Math.max(2.5, Math.min(5, Math.min(segW * 0.12, bb.height * 0.55)))
            const isSel = selectedBaseboardId === bb.id
            const EDGE_W = 3
            return (
              <g key={bb.id}>
                <rect
                  x={toX(u0)} y={toY(bb.y + bb.height)}
                  width={segW} height={bb.height}
                  fill={bb.color}
                  stroke={isSel ? '#0090cc' : '#888'}
                  strokeWidth={isSel ? 0.8 : 0.4}
                  opacity={0.8}
                  style={{ cursor: bb.locked ? 'not-allowed' : 'move' }}
                  onMouseDown={e => onPieceDown(e, bb, 'bb')}
                  onClick={e => e.stopPropagation()}
                />
                <text x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="#222" fontSize={fs} fontWeight={600}
                  pointerEvents="none">
                  {bb.label}
                </text>
                {isSel && !bb.locked && (<>
                  <rect
                    x={toX(u0) - EDGE_W / 2} y={toY(bb.y + bb.height)}
                    width={EDGE_W} height={bb.height}
                    fill="#0090cc" opacity={0.85} rx={0.8}
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={e => onPieceDown(e, bb, 'bb', 'left')}
                    onClick={e => e.stopPropagation()}
                  />
                  <rect
                    x={toX(u1) - EDGE_W / 2} y={toY(bb.y + bb.height)}
                    width={EDGE_W} height={bb.height}
                    fill="#0090cc" opacity={0.85} rx={0.8}
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={e => onPieceDown(e, bb, 'bb', 'right')}
                    onClick={e => e.stopPropagation()}
                  />
                </>)}
              </g>
            )
          })}
          {/* Stem walls — same projection as baseboards */}
          {stemWalls.map(sw => {
            const ux = Math.cos(sw.rotY), uz = -Math.sin(sw.rotY)
            const halfL = sw.length / 2
            const ends: [number, number][] = [
              [sw.x - ux * halfL, sw.z - uz * halfL],
              [sw.x + ux * halfL, sw.z + uz * halfL],
            ]
            const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
            const wLen2 = Math.hypot(wdx, wdz)
            if (wLen2 < 0.1) return null
            const wux = wdx / wLen2, wuz = wdz / wLen2
            const wnx = -wuz, wnz = wux
            let minU = Infinity, maxU = -Infinity
            for (const [px, pz] of ends) {
              const u = (px - wall.x1) * wux + (pz - wall.z1) * wuz
              minU = Math.min(minU, u); maxU = Math.max(maxU, u)
            }
            const perpDist = Math.abs((sw.x - wall.x1) * wnx + (sw.z - wall.z1) * wnz)
            if (perpDist > wall.thickness / 2 + sw.thickness + 6) return null
            const u0 = Math.max(0, minU), u1 = Math.min(wLen, maxU)
            if (u1 - u0 < 0.5) return null
            const segW = u1 - u0
            const cx = toX(u0) + segW / 2
            const cy = toY(sw.y + sw.height) + sw.height / 2
            const fs = Math.max(2.5, Math.min(5, Math.min(segW * 0.12, sw.height * 0.55)))
            const isSel = selectedStemWallId === sw.id
            const EDGE_W = 3
            return (
              <g key={sw.id}>
                <rect
                  x={toX(u0)} y={toY(sw.y + sw.height)}
                  width={segW} height={sw.height}
                  fill={sw.color}
                  stroke={isSel ? '#0090cc' : '#888'}
                  strokeWidth={isSel ? 0.8 : 0.4}
                  opacity={0.8}
                  style={{ cursor: sw.locked ? 'not-allowed' : 'move' }}
                  onMouseDown={e => onPieceDown(e, sw, 'sw')}
                  onClick={e => e.stopPropagation()}
                />
                <text x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fill="#222" fontSize={fs} fontWeight={600}
                  pointerEvents="none">
                  {sw.label}
                </text>
                {isSel && !sw.locked && (<>
                  <rect
                    x={toX(u0) - EDGE_W / 2} y={toY(sw.y + sw.height)}
                    width={EDGE_W} height={sw.height}
                    fill="#0090cc" opacity={0.85} rx={0.8}
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={e => onPieceDown(e, sw, 'sw', 'left')}
                    onClick={e => e.stopPropagation()}
                  />
                  <rect
                    x={toX(u1) - EDGE_W / 2} y={toY(sw.y + sw.height)}
                    width={EDGE_W} height={sw.height}
                    fill="#0090cc" opacity={0.85} rx={0.8}
                    style={{ cursor: 'ew-resize' }}
                    onMouseDown={e => onPieceDown(e, sw, 'sw', 'right')}
                    onClick={e => e.stopPropagation()}
                  />
                </>)}
              </g>
            )
          })}

          {/* All wall elements clipped to wall face */}
          <g clipPath="url(#wall-face-clip)">

            {/* Slatwall panels */}
            {wallPanels.map(panel => {
              const hex = colorHex(panel.color)
              const isSel = panel.id === selectedSlatwallPanelId
              // Extend slatwall visually to wall edges when near a corner stub
              // so the panel goes behind the stub with no gap
              const { leftEdge, rightEdge } = getWallEdges()
              const vizStart = Math.abs(panel.alongStart - leftEdge) < 2 ? 0 : panel.alongStart
              const vizEnd = Math.abs(panel.alongEnd - rightEdge) < 2 ? wLen : panel.alongEnd
              const px = toX(vizStart), py = toY(panel.yTop)
              const pw = vizEnd - vizStart
              const ph = panel.yTop - panel.yBottom
              // Division trim positions every 96" (8') within the panel
              const panelW = panel.alongEnd - panel.alongStart
              const dividers: number[] = []
              for (let offset = 96; offset < panelW; offset += 96) {
                dividers.push(panel.alongStart + offset)
              }
              return (
                <g key={panel.id}>
                  <rect x={px} y={py} width={pw} height={ph}
                    fill={hex} stroke="rgba(0,0,0,0.45)"
                    strokeWidth={0.4}
                    style={{ cursor: 'move' }}
                    onMouseDown={e => onPanelDown(e, panel)}
                    onClick={e => e.stopPropagation()} />
                  {grooveLines(panel)}
                  {/* Division trim pieces at 8' intervals */}
                  {dividers.map((pos, di) => (
                    <rect key={`div${di}`}
                      x={toX(pos) - 0.75} y={toY(panel.yTop)}
                      width={1.5} height={panel.yTop - panel.yBottom}
                      fill={hex} stroke="rgba(0,0,0,0.5)" strokeWidth={0.3} />
                  ))}
                  {isSel && (<>
                    {([
                      [panel.alongStart, panel.yTop,    0],
                      [panel.alongEnd,   panel.yTop,    1],
                      [panel.alongEnd,   panel.yBottom, 2],
                      [panel.alongStart, panel.yBottom, 3],
                    ] as [number, number, 0 | 1 | 2 | 3][]).map(([a, h, c]) => (
                      <circle key={c}
                        cx={toX(a)} cy={toY(h)} r={HANDLE_R}
                        fill="#cc22aa" stroke="#fff" strokeWidth={0.5}
                        style={{ cursor: 'crosshair' }}
                        onMouseDown={e => onCornerDown(e, panel, c)}
                        onClick={e => e.stopPropagation()} />
                    ))}
                  </>)}
                </g>
              )
            })}

            {/* Stainless steel backsplash panels */}
            {wallBacksplashes.map(panel => {
              const isSel = panel.id === selectedStainlessBacksplashPanelId
              const { leftEdge, rightEdge } = getWallEdges()
              const vizStart = Math.abs(panel.alongStart - leftEdge) < 2 ? 0 : panel.alongStart
              const vizEnd = Math.abs(panel.alongEnd - rightEdge) < 2 ? wLen : panel.alongEnd
              const px = toX(vizStart), py = toY(panel.yTop)
              const pw = vizEnd - vizStart
              const ph = panel.yTop - panel.yBottom
              return (
                <g key={panel.id}>
                  <rect x={px} y={py} width={pw} height={ph}
                    fill={(panel.texture ?? 'stainless') === 'diamondplate' ? 'url(#backsplash-diamondplate)' : '#b8bcc0'}
                    stroke="rgba(0,0,0,0.5)"
                    strokeWidth={0.4}
                    style={{ cursor: 'move' }}
                    onMouseDown={e => onBacksplashDown(e, panel)}
                    onClick={e => e.stopPropagation()} />
                  {isSel && (<>
                    {([
                      [panel.alongStart, panel.yTop,    0],
                      [panel.alongEnd,   panel.yTop,    1],
                      [panel.alongEnd,   panel.yBottom, 2],
                      [panel.alongStart, panel.yBottom, 3],
                    ] as [number, number, 0 | 1 | 2 | 3][]).map(([a, h, c]) => (
                      <circle key={c}
                        cx={toX(a)} cy={toY(h)} r={HANDLE_R}
                        fill="#22aaee" stroke="#fff" strokeWidth={0.5}
                        style={{ cursor: 'crosshair' }}
                        onMouseDown={e => onBacksplashCornerDown(e, panel, c)}
                        onClick={e => e.stopPropagation()} />
                    ))}
                  </>)}
                </g>
              )
            })}

            {/* Cabinets */}
            {wallCabinets.map(cab => {
              const { along } = projectCabinet(cab, wall)
              const cx = toX(along - cab.w / 2)
              const cy = toY(cab.y + cab.h)

              return (
                <g key={cab.id} style={{ cursor: 'move' }}
                  onMouseDown={e => onCabDown(e, cab)}
                  onClick={e => e.stopPropagation()}>
                  <g transform={`translate(${cx}, ${cy})`}>
                    {cabinetFrontPaths({
                      w: cab.w, h: cab.h,
                      doors: cab.doors, drawers: cab.drawers,
                      style: cab.style, line: cab.line ?? 'technica',
                      color: cab.color, shellColor: cab.shellColor, handleColor: cab.handleColor, handleSide: cab.handleSide,
                    })}
                  </g>
                </g>
              )
            })}

            {/* Countertops */}
            {wallCountertops.map(ct => {
              const { along } = projectCountertop(ct, wall)
              const isSel = ct.id === selectedCountertopId
              const ctX = toX(along - ct.width / 2)
              const ctY = toY(ct.y + COUNTERTOP_THICKNESS)
              const ctHex = COUNTERTOP_HEX[ct.color] ?? '#b5813a'
              const thPx = COUNTERTOP_THICKNESS
              return (
                <g key={ct.id}>
                  {/* Body */}
                  <rect x={ctX} y={ctY} width={ct.width} height={thPx}
                    fill={ctHex} stroke="#555"
                    strokeWidth={0.4}
                    style={{ cursor: 'move' }}
                    onMouseDown={e => onCtDown(e, ct)}
                    onClick={e => e.stopPropagation()} />
                  {/* Front edge shadow */}
                  <line x1={ctX} y1={ctY + thPx} x2={ctX + ct.width} y2={ctY + thPx}
                    stroke="rgba(0,0,0,0.15)" strokeWidth={0.5}
                    pointerEvents="none" />
                  {/* Label when selected */}
                  {isSel && (
                    <text x={ctX + ct.width / 2} y={ctY + thPx / 2}
                      textAnchor="middle" dominantBaseline="middle"
                      fill="#fff" fontSize={Math.max(4, Math.min(8, ct.width * 0.07))}
                      pointerEvents="none">
                      {ct.label} {ct.width}"
                    </text>
                  )}
                  {/* Left / right edge resize handles */}
                  {isSel && (<>
                    <rect x={ctX - 4} y={ctY} width={8} height={thPx}
                      fill="#0090cc" opacity={0.8} rx={2}
                      style={{ cursor: 'ew-resize' }}
                      onMouseDown={e => onCtDown(e, ct, 'left')}
                      onClick={e => e.stopPropagation()} />
                    <rect x={ctX + ct.width - 4} y={ctY} width={8} height={thPx}
                      fill="#0090cc" opacity={0.8} rx={2}
                      style={{ cursor: 'ew-resize' }}
                      onMouseDown={e => onCtDown(e, ct, 'right')}
                      onClick={e => e.stopPropagation()} />
                  </>)}
                </g>
              )
            })}

          </g>{/* end clip group */}

          {/* Corner wall cross-sections — rendered on top so they cover slatwall edges */}
          {wallStubs.map((stub, i) => {
            const isLeft = stub.along < 2
            const isRight = stub.along > wLen - 2
            if (!isLeft && !isRight) return null
            const sh = Math.min(stub.height, wH)
            // The stub covers from the outside edge to the interior face (half thickness into wall)
            if (isLeft) {
              const stubRight = PAD + stub.thickness / 2
              return (
                <g key={`cs${i}`} pointerEvents="none">
                  <rect x={PAD - stub.thickness} y={PAD} width={stubRight - (PAD - stub.thickness)} height={sh}
                    fill="#e0e0dc" stroke="none" />
                  <line x1={stubRight} y1={PAD} x2={stubRight} y2={PAD + sh}
                    stroke="#999" strokeWidth={0.5} />
                </g>
              )
            }
            const stubLeft = PAD + wLen - stub.thickness / 2
            return (
              <g key={`cs${i}`} pointerEvents="none">
                <rect x={stubLeft} y={PAD} width={(PAD + wLen + stub.thickness) - stubLeft} height={sh}
                  fill="#e0e0dc" stroke="none" />
                <line x1={stubLeft} y1={PAD} x2={stubLeft} y2={PAD + sh}
                  stroke="#999" strokeWidth={0.5} />
              </g>
            )
          })}

          {/* Floor line */}
          <line x1={0} y1={toY(0)} x2={svgW} y2={toY(0)} stroke="#444" strokeWidth={0.75} />
          {/* Ceiling line */}
          {(() => {
            let outLeft = PAD, outRight = PAD + wLen
            for (const stub of wallStubs) {
              if (stub.along <= 2) outLeft = PAD - stub.thickness
              else if (stub.along >= wLen - 2) outRight = PAD + wLen + stub.thickness
            }
            return <>
              <line x1={outLeft} y1={toY(wH)} x2={outRight} y2={toY(wH)} stroke="#bbb" strokeWidth={0.4} strokeDasharray="5 3" />
              {/* Wall outline — extends to outer edge of corner walls */}
              <rect x={outLeft} y={PAD} width={outRight - outLeft} height={wH} fill="none" stroke="#333" strokeWidth={0.75} />
            </>
          })()}

          {/* ── Dimension annotations ── */}
          {(() => {
            const dimColor = '#666'
            const textColor = '#333'
            const fontSize = 2.5
            const tickSz = 2

            // ── Horizontal breakpoints (along wall) ─────────────────────────
            // Use interior face edges so corner stubs don't create phantom gaps
            const { leftEdge, rightEdge } = getWallEdges()
            const wallDoors = wall.openings.filter(op => op.type === 'door')
            const wallWindows = wall.openings.filter(op => op.type === 'window')
            const wallGDs = wall.openings.filter(op => op.type === 'garage-door')
            const hasItems = wallCabinets.length > 0 || wallPanels.length > 0
              || wallDoors.length > 0 || wallWindows.length > 0 || wallGDs.length > 0
            const hBreaks = new Set<number>()
            // Only use interior face edges when there are items to dimension
            hBreaks.add(hasItems ? leftEdge : 0)
            hBreaks.add(hasItems ? rightEdge : wLen)
            // Cabinet + door tier breakpoints. Each segment is classified by
            // what spans it: cab / door / gap.
            type Range = { start: number; end: number }
            const cabRanges: Range[] = []
            wallCabinets.forEach(cab => {
              const { along } = projectCabinet(cab, wall)
              const s = Math.max(leftEdge, along - cab.w / 2)
              const e = Math.min(rightEdge, along + cab.w / 2)
              hBreaks.add(s); hBreaks.add(e)
              cabRanges.push({ start: s, end: e })
            })
            const doorRanges: Range[] = []
            wallDoors.forEach(op => {
              const ext = (op.modelId === 'custom-plain' || op.modelId === 'custom-double') ? 2.5 : 0
              const s = Math.max(leftEdge, op.xOffset - ext)
              const e = Math.min(rightEdge, op.xOffset + op.width + ext)
              if (e - s > 0.5) {
                hBreaks.add(s); hBreaks.add(e)
                doorRanges.push({ start: s, end: e })
              }
            })
            const hSorted = [...hBreaks].sort((a, b) => a - b)
            const hasHSegs = hSorted.length > 2
            const classifySeg = (start: number, end: number): 'cab' | 'door' | 'gap' => {
              const mid = (start + end) / 2
              for (const r of doorRanges) if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'door'
              for (const r of cabRanges)  if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'cab'
              return 'gap'
            }

            // ── Window / garage-door tier (separate horizontal tier) ─────────
            // Windows and garage-doors get their own dim row so they don't
            // compete for space with the cabinet/door tier.
            const hWinBreaks = new Set<number>()
            hWinBreaks.add(leftEdge); hWinBreaks.add(rightEdge)
            const windowRanges: Range[] = []
            // Windows render with a 3" casing trim, so the dim segment
            // covers the full visible footprint (rough opening + casing).
            const WIN_CASING = 3
            wallWindows.forEach(op => {
              const s = Math.max(leftEdge, op.xOffset - WIN_CASING)
              const e = Math.min(rightEdge, op.xOffset + op.width + WIN_CASING)
              if (e - s > 0.5) {
                hWinBreaks.add(s); hWinBreaks.add(e)
                windowRanges.push({ start: s, end: e })
              }
            })
            const gdRanges: Range[] = []
            wallGDs.forEach(op => {
              const s = Math.max(leftEdge, op.xOffset)
              const e = Math.min(rightEdge, op.xOffset + op.width)
              if (e - s > 0.5) {
                hWinBreaks.add(s); hWinBreaks.add(e)
                gdRanges.push({ start: s, end: e })
              }
            })
            const hWinSorted = [...hWinBreaks].sort((a, b) => a - b)
            const hasWinTier = windowRanges.length > 0 || gdRanges.length > 0
            const classifyWinSeg = (start: number, end: number): 'window' | 'gd' | 'gap' => {
              const mid = (start + end) / 2
              for (const r of windowRanges) if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'window'
              for (const r of gdRanges)     if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'gd'
              return 'gap'
            }

            // Slatwall tier: breakpoints from slatwall panels. Each segment is
            // either a slatwall span or a gap where there's no slatwall.
            const slatBreaks = new Set<number>()
            slatBreaks.add(leftEdge); slatBreaks.add(rightEdge)
            const slatRanges: Range[] = []
            wallPanels.forEach(p => {
              const s = Math.max(leftEdge, p.alongStart)
              const e = Math.min(rightEdge, p.alongEnd)
              slatBreaks.add(s); slatBreaks.add(e)
              slatRanges.push({ start: s, end: e })
            })
            const slatSorted = [...slatBreaks].sort((a, b) => a - b)
            const hasSlatTier = slatRanges.length > 0
            const classifySlatSeg = (start: number, end: number): 'slat' | 'gap' => {
              const mid = (start + end) / 2
              for (const r of slatRanges) if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'slat'
              return 'gap'
            }
            const TIER_COLOR = {
              overall: '#333',
              cab:     '#333',
              door:    '#b22',
              window:  '#1a6db0',
              gd:      '#742',
              slat:    '#1d6f3d',
              ct:      '#8a6a3a',
              bb:      '#555',
              sw:      '#2d5a8a',
              step:    '#7a6a3a',
              gap:     '#888',
            }

            // Slatwall section tier — only shown when a panel exceeds 96" (8')
            // so we can annotate the 8' section divisions. Panels ≤ 96" are
            // already dimensioned in the main strip above with "SW" prefix.
            // Slatwall tier segments: full wall strip, split into SW spans
            // (broken at 8' intervals for long panels) and gap segments.
            type SlatSeg = { start: number; end: number; kind: 'slat' | 'gap' }
            const slatTierSegs: SlatSeg[] = []
            {
              // Add 8' break points INSIDE each panel (for panels > 96").
              const pts = new Set<number>(slatSorted)
              wallPanels.forEach(p => {
                const panelW = p.alongEnd - p.alongStart
                for (let offset = 96; offset < panelW; offset += 96) {
                  pts.add(p.alongStart + offset)
                }
              })
              const sorted = [...pts].sort((a, b) => a - b)
              for (let i = 0; i < sorted.length - 1; i++) {
                const s = sorted[i], e = sorted[i + 1]
                if (e - s < 0.5) continue
                slatTierSegs.push({ start: s, end: e, kind: classifySlatSeg(s, e) })
              }
            }

            // Horizontal dimension tiers (inside → outside):
            //   dimY1      = cabinet/door/gap strip
            //   dimYWin    = window/garage-door/gap strip
            //   dimYSlat   = slatwall/gap strip (with 8' breaks for long panels)
            //   dimYTotal  = full wall width (outermost, bold)
            let nextDimY = toY(0) + 4
            const dimY1 = nextDimY
            if (hasHSegs) nextDimY += 6
            const dimYWin = nextDimY
            if (hasWinTier) nextDimY += 6
            const dimYSlat = nextDimY
            if (hasSlatTier) nextDimY += 6
            const dimYTotal = nextDimY

            // ── Vertical breakpoints (height) ────────────────────────────────
            // Cabinet vertical tier: cabinets + gaps, plus a countertop "slab"
            // segment directly above any cabinet that has a countertop on top,
            // and a baseboard segment at floor level if the wall has a baseboard.
            const vBreaks = new Set<number>()
            vBreaks.add(0); vBreaks.add(wH)
            const cabVRanges: Array<{ bottom: number; top: number }> = []
            wallCabinets.forEach(cab => {
              const b = Math.max(0, cab.y)
              const t = Math.min(wH, cab.y + cab.h)
              vBreaks.add(b); vBreaks.add(t)
              cabVRanges.push({ bottom: b, top: t })
            })
            // Countertop slab ranges — drawn as a 'ct' segment in the cabinet tier.
            // Use ct.y (slab bottom from floor) + COUNTERTOP_THICKNESS as the top.
            const ctVRanges: Array<{ bottom: number; top: number }> = []
            wallCountertops.forEach(ct => {
              const b = Math.max(0, ct.y)
              const t = Math.min(wH, ct.y + COUNTERTOP_THICKNESS)
              if (t - b < 0.1) return
              vBreaks.add(b); vBreaks.add(t)
              ctVRanges.push({ bottom: b, top: t })
            })
            // Baseboard / stem-wall / step-up vertical ranges on this wall.
            wallBbRanges.forEach(r => { vBreaks.add(Math.max(0, r.bottom)); vBreaks.add(Math.min(wH, r.top)) })
            wallSwRanges.forEach(r => { vBreaks.add(Math.max(0, r.bottom)); vBreaks.add(Math.min(wH, r.top)) })
            wallStepRanges.forEach(r => { vBreaks.add(Math.max(0, r.bottom)); vBreaks.add(Math.min(wH, r.top)) })
            // Opening vertical ranges — windows, doors, and garage doors all
            // contribute their height to the vertical dim tier so the user
            // can read each opening's height inline alongside cabinets.
            const windowVRanges: Array<{ bottom: number; top: number }> = []
            wallWindows.forEach(op => {
              const b = Math.max(0, op.yOffset)
              const t = Math.min(wH, op.yOffset + op.height)
              if (t - b < 0.1) return
              vBreaks.add(b); vBreaks.add(t)
              windowVRanges.push({ bottom: b, top: t })
            })
            const doorVRanges: Array<{ bottom: number; top: number }> = []
            wallDoors.forEach(op => {
              const b = Math.max(0, op.yOffset)
              const t = Math.min(wH, op.yOffset + op.height)
              if (t - b < 0.1) return
              vBreaks.add(b); vBreaks.add(t)
              doorVRanges.push({ bottom: b, top: t })
            })
            const gdVRanges: Array<{ bottom: number; top: number }> = []
            wallGDs.forEach(op => {
              const b = Math.max(0, op.yOffset)
              const t = Math.min(wH, op.yOffset + op.height)
              if (t - b < 0.1) return
              vBreaks.add(b); vBreaks.add(t)
              gdVRanges.push({ bottom: b, top: t })
            })
            const vSorted = [...vBreaks].sort((a, b) => a - b)
            const hasVSegs = vSorted.length > 2
            // Classify in priority: cab > ct > step > window > door > gd > bb > sw > gap.
            const classifyVSeg = (bot: number, top: number): 'cab' | 'ct' | 'step' | 'window' | 'door' | 'gd' | 'bb' | 'sw' | 'gap' => {
              const match = (r: { bottom: number; top: number }) =>
                Math.abs(bot - r.bottom) < 0.1 && Math.abs(top - r.top) < 0.1
              for (const r of cabVRanges)  if (match(r)) return 'cab'
              for (const r of ctVRanges)   if (match(r)) return 'ct'
              for (const r of wallStepRanges) if (match(r)) return 'step'
              for (const r of windowVRanges) if (match(r)) return 'window'
              for (const r of doorVRanges)   if (match(r)) return 'door'
              for (const r of gdVRanges)     if (match(r)) return 'gd'
              for (const r of wallBbRanges) if (match(r)) return 'bb'
              for (const r of wallSwRanges) if (match(r)) return 'sw'
              return 'gap'
            }

            // Slatwall vertical tier: one combined SW span + gaps above/below.
            const slatVRange: { bottom: number; top: number } | null = (() => {
              if (wallPanels.length === 0) return null
              const lo = Math.max(0, Math.min(...wallPanels.map(p => p.yBottom)))
              const hi = Math.min(wH, Math.max(...wallPanels.map(p => p.yTop)))
              return hi - lo > 1 ? { bottom: lo, top: hi } : null
            })()
            type VSlatSeg = { bottom: number; top: number; kind: 'slat' | 'gap' }
            const slatVSegs: VSlatSeg[] = []
            if (slatVRange) {
              if (slatVRange.bottom > 0.5)    slatVSegs.push({ bottom: 0, top: slatVRange.bottom, kind: 'gap' })
              slatVSegs.push({ bottom: slatVRange.bottom, top: slatVRange.top, kind: 'slat' })
              if (slatVRange.top < wH - 0.5) slatVSegs.push({ bottom: slatVRange.top, top: wH, kind: 'gap' })
            }
            const hasSlatVTier = slatVSegs.length > 0

            // Offset all vertical dim tiers past any left-side corner stub so
            // they don't land inside the extended wall face.
            const leftStubT = Math.max(0, ...wallStubs.filter(s => s.along <= 2).map(s => s.thickness))
            const dimStart = PAD - leftStubT - 4
            const dimX1 = dimStart
            const dimXSlat = dimStart - (hasVSegs ? 6 : 0)
            const dimX2 = dimXSlat - (hasSlatVTier ? 6 : 0)

            // Witness lines must start at the OUTER edge of the wall face,
            // which extends left past toX(0) when a left corner stub exists.
            const witnessStartX = PAD - leftStubT
            return <>
              {/* Vertical witness lines (horizontal, going left from wall face) */}
              <line x1={witnessStartX} y1={toY(0)} x2={dimX2 - tickSz} y2={toY(0)}
                stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              <line x1={witnessStartX} y1={toY(wH)} x2={dimX2 - tickSz} y2={toY(wH)}
                stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              {hasVSegs && vSorted.slice(1, -1).map((bp, i) => (
                <line key={`vw${i}`} x1={witnessStartX} y1={toY(bp)} x2={dimX1 - tickSz} y2={toY(bp)}
                  stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              ))}

              {/* Vertical segment dims — color + prefix by kind. Tiny
                 segments (e.g. 1.75" countertop slab) get their label moved
                 OUTSIDE the segment with a leader so it doesn't collide
                 with the tick marks. */}
              {hasVSegs && vSorted.slice(0, -1).map((bot, i) => {
                const top = vSorted[i + 1]
                const y1 = toY(top), y2 = toY(bot)
                const mid = (y1 + y2) / 2
                const segPx = y2 - y1
                const kind = classifyVSeg(bot, top)
                const color = TIER_COLOR[kind]
                const prefix = kind === 'cab' ? 'CAB '
                  : kind === 'door' ? 'DOOR '
                  : kind === 'window' ? 'WINDOW '
                  : kind === 'gd' ? 'GD '
                  : kind === 'ct' ? 'CT '
                  : kind === 'bb' ? 'BB '
                  : kind === 'sw' ? 'SW '
                  : kind === 'step' ? 'STEP '
                  : ''
                const labelText = `${prefix}${inchesToDisplay(top - bot)}`
                // Show labels on all vertical segments including gaps, so empty
                // space above/below/between cabinets is clearly dimensioned.
                const showLabel = true
                const needed = labelText.length * fontSize * 0.55
                const inline = segPx > needed + 2
                const fitSize = inline ? Math.min(fontSize, segPx * 0.55) : fontSize
                return (
                  <g key={`vs${i}`}>
                    <line x1={dimX1} y1={y1} x2={dimX1} y2={y2} stroke={color} strokeWidth={0.5} />
                    <line x1={dimX1 - tickSz} y1={y1} x2={dimX1 + tickSz} y2={y1} stroke={color} strokeWidth={0.5} />
                    <line x1={dimX1 - tickSz} y1={y2} x2={dimX1 + tickSz} y2={y2} stroke={color} strokeWidth={0.5} />
                    {showLabel && inline && (
                      <text x={dimX1 - 1.5} y={mid} textAnchor="middle" dominantBaseline="text-after-edge"
                        fill={color} fontSize={fitSize}
                        transform={`rotate(-90 ${dimX1 - 1.5} ${mid})`}>
                        {labelText}
                      </text>
                    )}
                    {showLabel && !inline && (
                      <>
                        {/* Leader line + label set well outside the dim line so
                           tick marks and adjacent segments don't obscure it. */}
                        <line x1={dimX1 - tickSz - 1} y1={mid} x2={dimX1 - 14} y2={mid}
                          stroke={color} strokeWidth={0.4} />
                        <text x={dimX1 - 15} y={mid} textAnchor="end" dominantBaseline="middle"
                          fill={color} fontSize={fitSize}>
                          {labelText}
                        </text>
                      </>
                    )}
                  </g>
                )
              })}

              {/* Slatwall vertical tier — SW span + gaps above/below */}
              {hasSlatVTier && slatVSegs.map((seg, i) => {
                const y1 = toY(seg.top), y2 = toY(seg.bottom), mid = (y1 + y2) / 2
                const segPx = y2 - y1
                const fitSize = Math.max(2, Math.min(fontSize, segPx * 0.55))
                const color = TIER_COLOR[seg.kind]
                const prefix = seg.kind === 'slat' ? 'SW ' : ''
                const showLabel = seg.kind !== 'gap'
                return (
                  <g key={`svt${i}`}>
                    <line x1={dimXSlat} y1={y1} x2={dimXSlat} y2={y2} stroke={color} strokeWidth={0.5} />
                    <line x1={dimXSlat - tickSz} y1={y1} x2={dimXSlat + tickSz} y2={y1} stroke={color} strokeWidth={0.5} />
                    <line x1={dimXSlat - tickSz} y1={y2} x2={dimXSlat + tickSz} y2={y2} stroke={color} strokeWidth={0.5} />
                    {showLabel && (
                      <text x={dimXSlat - 1.5} y={mid} textAnchor="middle" dominantBaseline="text-after-edge"
                        fill={color} fontSize={fitSize}
                        transform={`rotate(-90 ${dimXSlat - 1.5} ${mid})`}>
                        {prefix}{inchesToDisplay(seg.top - seg.bottom)}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Vertical total */}
              {(() => {
                const y1 = toY(wH), y2 = toY(0), mid = (y1 + y2) / 2
                return (
                  <g>
                    <line x1={dimX2} y1={y1} x2={dimX2} y2={y2} stroke={TIER_COLOR.overall} strokeWidth={0.6} />
                    <line x1={dimX2 - tickSz} y1={y1} x2={dimX2 + tickSz} y2={y1} stroke={TIER_COLOR.overall} strokeWidth={0.5} />
                    <line x1={dimX2 - tickSz} y1={y2} x2={dimX2 + tickSz} y2={y2} stroke={TIER_COLOR.overall} strokeWidth={0.5} />
                    <text x={dimX2 - 1.5} y={mid} textAnchor="middle" dominantBaseline="text-after-edge"
                      fill={TIER_COLOR.overall} fontSize={fontSize} fontWeight="600"
                      transform={`rotate(-90 ${dimX2 - 1.5} ${mid})`}>
                      WALL {inchesToDisplay(wH)}
                    </text>
                  </g>
                )
              })()}

              {/* Horizontal witness lines — extend to outermost tier */}
              <line x1={toX(leftEdge)} y1={toY(0)} x2={toX(leftEdge)} y2={dimYTotal + tickSz}
                stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              <line x1={toX(rightEdge)} y1={toY(0)} x2={toX(rightEdge)} y2={dimYTotal + tickSz}
                stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              {hasHSegs && hSorted.slice(1, -1).map((bp, i) => (
                <line key={`hw${i}`} x1={toX(bp)} y1={toY(0)} x2={toX(bp)} y2={dimY1 + tickSz}
                  stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              ))}

              {/* Horizontal segment dims — tier 1, closest to wall. Color-coded
                 and prefixed by segment type. */}
              {hasHSegs && hSorted.slice(0, -1).map((start, i) => {
                const end = hSorted[i + 1]
                const x1 = toX(start), x2 = toX(end)
                const mid = (x1 + x2) / 2
                const segPx = x2 - x1
                const fitSize = Math.max(2, Math.min(fontSize, segPx * 0.55))
                const kind = classifySeg(start, end)
                const color = TIER_COLOR[kind]
                const prefix = kind === 'cab' ? 'CAB '
                  : kind === 'door' ? 'DOOR '
                  : ''
                const showLabel = true
                return (
                  <g key={`hs${i}`}>
                    <line x1={x1} y1={dimY1} x2={x2} y2={dimY1} stroke={color} strokeWidth={0.5} />
                    <line x1={x1} y1={dimY1 - tickSz} x2={x1} y2={dimY1 + tickSz} stroke={color} strokeWidth={0.5} />
                    <line x1={x2} y1={dimY1 - tickSz} x2={x2} y2={dimY1 + tickSz} stroke={color} strokeWidth={0.5} />
                    {showLabel && (
                      <text x={mid} y={dimY1 - 0.5} textAnchor="middle" dominantBaseline="text-after-edge"
                        fill={color} fontSize={fitSize}>
                        {prefix}{inchesToDisplay(end - start)}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Window / garage-door tier — own row so windows don't share a
                 tier with the cabinets/doors above. Witness lines drop from
                 each opening edge down to the tick marks. */}
              {hasWinTier && hWinSorted.slice(1, -1).map((bp, i) => (
                <line key={`hww${i}`} x1={toX(bp)} y1={toY(0)} x2={toX(bp)} y2={dimYWin + tickSz}
                  stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              ))}
              {hasWinTier && hWinSorted.slice(0, -1).map((start, i) => {
                const end = hWinSorted[i + 1]
                const x1 = toX(start), x2 = toX(end)
                const mid = (x1 + x2) / 2
                const segPx = x2 - x1
                const fitSize = Math.max(2, Math.min(fontSize, segPx * 0.55))
                const kind = classifyWinSeg(start, end)
                if (kind === 'gap') return null
                const color = TIER_COLOR[kind]
                const prefix = kind === 'window' ? 'WINDOW ' : 'GD '
                return (
                  <g key={`hsw${i}`}>
                    <line x1={x1} y1={dimYWin} x2={x2} y2={dimYWin} stroke={color} strokeWidth={0.5} />
                    <line x1={x1} y1={dimYWin - tickSz} x2={x1} y2={dimYWin + tickSz} stroke={color} strokeWidth={0.5} />
                    <line x1={x2} y1={dimYWin - tickSz} x2={x2} y2={dimYWin + tickSz} stroke={color} strokeWidth={0.5} />
                    <text x={mid} y={dimYWin - 0.5} textAnchor="middle" dominantBaseline="text-after-edge"
                      fill={color} fontSize={fitSize}>
                      {prefix}{inchesToDisplay(end - start)}
                    </text>
                  </g>
                )
              })}

              {/* Slatwall tier — full strip, SW spans + gaps, 8' breaks on long panels */}
              {hasSlatTier && slatTierSegs.map((seg, i) => {
                const x1 = toX(seg.start), x2 = toX(seg.end), mid = (x1 + x2) / 2
                const segPx = x2 - x1
                const fitSize = Math.max(2, Math.min(fontSize, segPx * 0.55))
                const color = TIER_COLOR[seg.kind]
                const prefix = seg.kind === 'slat' ? 'SW ' : ''
                return (
                  <g key={`slt${i}`}>
                    <line x1={x1} y1={dimYSlat} x2={x2} y2={dimYSlat} stroke={color} strokeWidth={0.5} />
                    <line x1={x1} y1={dimYSlat - tickSz} x2={x1} y2={dimYSlat + tickSz} stroke={color} strokeWidth={0.5} />
                    <line x1={x2} y1={dimYSlat - tickSz} x2={x2} y2={dimYSlat + tickSz} stroke={color} strokeWidth={0.5} />
                    {segPx > 14 ? (
                      <text x={mid} y={dimYSlat - 0.5} textAnchor="middle" dominantBaseline="text-after-edge"
                        fill={color} fontSize={fitSize}>
                        {prefix}{inchesToDisplay(seg.end - seg.start)}
                      </text>
                    ) : (
                      <text x={mid} y={dimYSlat - 0.5} textAnchor="middle" dominantBaseline="text-after-edge"
                        fill={color} fontSize={2}
                        transform={`rotate(-90 ${mid} ${dimYSlat - 0.5})`}>
                        {prefix}{inchesToDisplay(seg.end - seg.start)}
                      </text>
                    )}
                  </g>
                )
              })}

              {/* Horizontal total — full wall width, outermost tier, bold */}
              {(hSorted.length > 3 || !hasHSegs) && (() => {
                const { leftEdge: le, rightEdge: re } = getWallEdges()
                const x1 = toX(le), x2 = toX(re), mid = (x1 + x2) / 2
                return (
                  <g>
                    <line x1={x1} y1={dimYTotal} x2={x2} y2={dimYTotal} stroke={TIER_COLOR.overall} strokeWidth={0.6} />
                    <line x1={x1} y1={dimYTotal - tickSz} x2={x1} y2={dimYTotal + tickSz} stroke={TIER_COLOR.overall} strokeWidth={0.5} />
                    <line x1={x2} y1={dimYTotal - tickSz} x2={x2} y2={dimYTotal + tickSz} stroke={TIER_COLOR.overall} strokeWidth={0.5} />
                    <text x={mid} y={dimYTotal - 0.5} textAnchor="middle" dominantBaseline="text-after-edge"
                      fill={TIER_COLOR.overall} fontSize={fontSize} fontWeight="600">
                      WALL {inchesToDisplay(re - le)}
                    </text>
                  </g>
                )
              })()}

            </>
          })()}
        </svg>
        </div>
      </div>

      {/* Snap toggle */}
      <div className="shot-panel">
        <div className="shot-btn-row">
          <button
            className={`shot-save-btn snap-toggle-btn${snappingEnabled ? '' : ' off'}`}
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            title={snappingEnabled ? 'Snapping ON — click to disable' : 'Snapping OFF — click to enable'}
            aria-pressed={!snappingEnabled}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
            </svg>
            Snap: {snappingEnabled ? 'On' : 'Off'}
          </button>
        </div>
      </div>
    </div>
  )
}
