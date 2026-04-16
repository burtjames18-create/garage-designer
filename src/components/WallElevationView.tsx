import { useRef, useState, useEffect } from 'react'
import { useGarageStore, CABINET_PRESETS, COUNTERTOP_THICKNESS, COUNTERTOP_DEPTH } from '../store/garageStore'
import type { GarageWall, PlacedCabinet, SlatwallPanel, StainlessBacksplashPanel, Countertop, FloorStep } from '../store/garageStore'
import { slatwallColors } from '../data/slatwallColors'
import { snapToGrid, inchesToDisplay } from '../utils/measurements'
import { cabinetFrontPaths } from './CabinetFrontSVG'
import './WallElevationView.css'
import './Viewer3D.css'

const PAD = 40  // SVG padding in wall-space inches — leaves room for dim tiers + corner stubs
const SNAP_DIST = 2  // inches

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function wallLen(w: GarageWall): number {
  return Math.hypot(w.x2 - w.x1, w.z2 - w.z1)
}

function wallDir(w: GarageWall): [number, number] {
  const len = wallLen(w)
  if (len < 0.01) return [1, 0]
  return [(w.x2 - w.x1) / len, (w.z2 - w.z1) / len]
}

function wallNormal(w: GarageWall): [number, number] {
  const [dx, dz] = wallDir(w)
  const n1: [number, number] = [-dz, dx]
  const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2
  return (n1[0] * (-mx) + n1[1] * (-mz)) > 0 ? n1 : [dz, -dx]
}

function projectCabinet(cab: PlacedCabinet, w: GarageWall): { along: number; perp: number } {
  const len = wallLen(w)
  if (len < 0.01) return { along: 0, perp: 99999 }
  const [dx, dz] = wallDir(w)
  const vx = cab.x - w.x1, vz = cab.z - w.z1
  return { along: vx * dx + vz * dz, perp: Math.abs(vx * (-dz) + vz * dx) }
}

function isCabinetOnWall(cab: PlacedCabinet, w: GarageWall, side?: 'interior' | 'exterior'): boolean {
  const len = wallLen(w)
  const { along, perp } = projectCabinet(cab, w)
  if (perp > cab.d / 2 + w.thickness / 2 + 10) return false
  if (along <= -cab.w / 2 || along >= len + cab.w / 2) return false
  // Cabinet must be facing roughly perpendicular to this wall (within 45° of
  // either face direction). Wall draw direction is arbitrary per-wall, so we
  // accept either +normal or -normal; the side filter below picks correct one.
  const [dx, dz] = wallDir(w)
  const rotA = Math.atan2(-dz, dx)
  const rotB = rotA + Math.PI
  const angDiff = (target: number) => {
    let d = Math.abs(cab.rotY - target) % (Math.PI * 2)
    if (d > Math.PI) d = Math.PI * 2 - d
    return d
  }
  const facesA = angDiff(rotA) < Math.PI / 4
  const facesB = angDiff(rotB) < Math.PI / 4
  if (!facesA && !facesB) return false
  if (side) {
    // Side filter: 'interior' = side facing into garage (use cabinetWallSide
    // which resolves it the same way for consistency).
    const cabSide = cabinetWallSide(cab, w)
    if (cabSide !== side) return false
  }
  return true
}

/** Which side of a wall a cabinet faces */
function cabinetWallSide(cab: PlacedCabinet, w: GarageWall): 'interior' | 'exterior' {
  const [dx, dz] = wallDir(w)
  const intRotY = Math.atan2(-dz, dx)
  let diff = Math.abs(cab.rotY - intRotY) % (Math.PI * 2)
  if (diff > Math.PI) diff = Math.PI * 2 - diff
  return diff < Math.PI / 4 ? 'interior' : 'exterior'
}

function projectCountertop(ct: Countertop, w: GarageWall): { along: number; perp: number } {
  const len = wallLen(w)
  if (len < 0.01) return { along: 0, perp: 99999 }
  const [dx, dz] = wallDir(w)
  const vx = ct.x - w.x1, vz = ct.z - w.z1
  return { along: vx * dx + vz * dz, perp: Math.abs(vx * (-dz) + vz * dx) }
}

function isCountertopOnWall(ct: Countertop, w: GarageWall): boolean {
  const len = wallLen(w)
  const { along, perp } = projectCountertop(ct, w)
  return perp <= COUNTERTOP_DEPTH / 2 + w.thickness / 2 + 10 &&
    along > -ct.width / 2 && along < len + ct.width / 2
}

/** Project a floor step onto a wall and return the along-wall range if adjacent */
function getStepWallProjection(
  step: FloorStep, w: GarageWall, tolerance = 6,
): { alongStart: number; alongEnd: number; height: number } | null {
  const len = wallLen(w)
  if (len < 0.01) return null
  const [ux, uz] = wallDir(w)
  const nx = -uz, nz = ux

  const corners = step.corners

  let minU = Infinity, maxU = -Infinity
  let minV = Infinity, maxV = -Infinity
  for (const [px, pz] of corners) {
    const u = (px - w.x1) * ux + (pz - w.z1) * uz
    const v = (px - w.x1) * nx + (pz - w.z1) * nz
    minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    minV = Math.min(minV, v); maxV = Math.max(maxV, v)
  }

  const halfThick = w.thickness / 2
  if (maxV < -(halfThick + tolerance) || minV > halfThick + tolerance) return null

  const u0 = Math.max(0, minU)
  const u1 = Math.min(len, maxU)
  if (u1 <= u0) return null

  return { alongStart: u0, alongEnd: u1, height: step.height }
}

// ─── Drag state ───────────────────────────────────────────────────────────────

interface SvgDrag {
  type: 'panel-body' | 'panel-corner' | 'backsplash-body' | 'backsplash-corner' | 'cabinet' | 'countertop'
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
}

// ─── Display colors ───────────────────────────────────────────────────────────
const COUNTERTOP_HEX: Record<string, string> = {
  'butcher-block': '#b5813a', 'stainless-steel': '#b0b4b8', 'black-stainless': '#484b50',
  white: '#e8e8e4', black: '#2a2a2a', concrete: '#8a8a80',
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WallElevationView() {
  const {
    walls, slatwallPanels, stainlessBacksplashPanels, cabinets, countertops, floorSteps,
    elevationWallIndex, setElevationWallIndex,
    updateSlatwallPanel, selectSlatwallPanel, selectedSlatwallPanelId, addSlatwallPanel, deleteSlatwallPanel,
    updateStainlessBacksplashPanel, selectStainlessBacksplashPanel, selectedStainlessBacksplashPanelId,
    addStainlessBacksplashPanel, deleteStainlessBacksplashPanel,
    updateCabinet, selectCabinet, selectedCabinetId, addCabinet, deleteCabinet,
    updateCountertop, selectCountertop, selectedCountertopId, addCountertop, deleteCountertop,
    elevationSide, setElevationSide,
    snappingEnabled, setSnappingEnabled,
  } = useGarageStore()

  const svgRef = useRef<SVGSVGElement>(null)
  const dragRef = useRef<SvgDrag | null>(null)
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
  const bbH = 0  // baseboards are now standalone pieces, not per-wall
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
    if (bbH > 0) {
      snaps.push({ target: bbH, forEdge: 'bottom' }) // baseboard top
      snaps.push({ target: bbH, forEdge: 'top' })
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
        if (bbH > 0) {
          snaps.push({ target: proj.height + bbH, forEdge: 'bottom' })
          snaps.push({ target: proj.height + bbH, forEdge: 'top' })
        }
      }
    }
    return snaps
  }

  /** Best snapped center position for a body-drag (checks both edges). */
  const findBestAlong = (rawCenter: number, halfW: number, selfId: string) => {
    const { snaps, leftEdge, rightEdge } = buildAlongSnaps(halfW, selfId)
    let best = snapToGrid(rawCenter), bestDist = SNAP_DIST + 1
    for (const { target } of snaps) {
      const d = Math.abs(rawCenter - target)
      if (d < SNAP_DIST && d < bestDist) { bestDist = d; best = target }
    }
    return Math.max(leftEdge + halfW, Math.min(best, rightEdge - halfW))
  }

  /** Best snapped position for a specific edge being dragged. */
  const findBestEdge = (rawEdge: number, selfId: string, edge: 'left' | 'right') => {
    const { snaps, leftEdge, rightEdge } = buildAlongSnaps(0, selfId)
    const candidates = snaps.filter(s => s.forEdge === edge)
    let best = snapToGrid(rawEdge), bestDist = SNAP_DIST + 1
    for (const { target } of candidates) {
      const d = Math.abs(rawEdge - target)
      if (d < SNAP_DIST && d < bestDist) { bestDist = d; best = target }
    }
    return edge === 'left' ? Math.max(leftEdge, best) : Math.min(rightEdge, best)
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
  }

  const onMouseUp = () => {
    const drag = dragRef.current
    if (drag && !drag.moved) {
      // Pure click (no drag) — open the item's settings by selecting it
      if (drag.type === 'panel-body' || drag.type === 'panel-corner') selectSlatwallPanel(drag.id)
      else if (drag.type === 'backsplash-body' || drag.type === 'backsplash-corner') selectStainlessBacksplashPanel(drag.id)
      else if (drag.type === 'cabinet') selectCabinet(drag.id)
      else if (drag.type === 'countertop') selectCountertop(drag.id)
    }
    dragRef.current = null
  }

  // Escape key deselects
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        selectSlatwallPanel(null); selectStainlessBacksplashPanel(null); selectCabinet(null); selectCountertop(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectSlatwallPanel, selectStainlessBacksplashPanel, selectCabinet, selectCountertop])

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
          onClick={() => { selectSlatwallPanel(null); selectCabinet(null); selectCountertop(null) }}
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

          {/* Baseboards now render as standalone Baseboard pieces (3D side
             only). The wall elevation no longer shows them since they can be
             placed anywhere along the wall and would clutter the dim tiers. */}

          {/* Openings */}
          {wall.openings.map(op => (
            <rect key={op.id}
              x={toX(op.xOffset)} y={toY(op.yOffset + op.height)}
              width={op.width} height={op.height}
              fill="#f4f4f2" stroke="#aaa" strokeWidth={0.5} />
          ))}

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
            const hasItems = wallCabinets.length > 0 || wallPanels.length > 0
            const hBreaks = new Set<number>()
            // Only use interior face edges when there are items to dimension
            hBreaks.add(hasItems ? leftEdge : 0)
            hBreaks.add(hasItems ? rightEdge : wLen)
            // Cabinet tier: breakpoints from cabinets only. Each segment is
            // either a cabinet span or a gap between them.
            type Range = { start: number; end: number }
            const cabRanges: Range[] = []
            wallCabinets.forEach(cab => {
              const { along } = projectCabinet(cab, wall)
              const s = Math.max(leftEdge, along - cab.w / 2)
              const e = Math.min(rightEdge, along + cab.w / 2)
              hBreaks.add(s); hBreaks.add(e)
              cabRanges.push({ start: s, end: e })
            })
            const hSorted = [...hBreaks].sort((a, b) => a - b)
            const hasHSegs = hSorted.length > 2
            const classifySeg = (start: number, end: number): 'cab' | 'gap' => {
              const mid = (start + end) / 2
              for (const r of cabRanges) if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'cab'
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
              slat:    '#1d6f3d',
              ct:      '#8a6a3a',
              bb:      '#555',
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
            //   dimY1     = cabinet/gap strip
            //   dimYSlat  = slatwall/gap strip (with 8' breaks for long panels)
            //   dimYTotal = full wall width (outermost, bold)
            let nextDimY = toY(0) + 4
            const dimY1 = nextDimY
            if (hasHSegs) nextDimY += 6
            const dimYSlat = nextDimY
            if (hasSlatTier) nextDimY += 6
            const dimYTotal = nextDimY

            // ── Vertical breakpoints (height) ────────────────────────────────
            // Cabinet vertical tier: cabinets + gaps, plus a countertop "slab"
            // segment directly above any cabinet that has a countertop on top,
            // and a baseboard segment at floor level if the wall has a baseboard.
            const vBreaks = new Set<number>()
            vBreaks.add(0); vBreaks.add(wH)
            // Add baseboard top as a breakpoint so it gets its own labeled segment.
            if (bbH > 0) vBreaks.add(bbH)
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
            const vSorted = [...vBreaks].sort((a, b) => a - b)
            const hasVSegs = vSorted.length > 2
            // Classify in priority: cab > ct > bb > gap.
            const classifyVSeg = (bot: number, top: number): 'cab' | 'ct' | 'bb' | 'gap' => {
              for (const r of cabVRanges) {
                if (Math.abs(bot - r.bottom) < 0.1 && Math.abs(top - r.top) < 0.1) return 'cab'
              }
              for (const r of ctVRanges) {
                if (Math.abs(bot - r.bottom) < 0.1 && Math.abs(top - r.top) < 0.1) return 'ct'
              }
              if (bbH > 0 && Math.abs(bot) < 0.1 && Math.abs(top - bbH) < 0.1) return 'bb'
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
                const prefix = kind === 'cab' ? 'CAB ' : kind === 'ct' ? 'CT ' : kind === 'bb' ? 'BB ' : ''
                const labelText = `${prefix}${inchesToDisplay(top - bot)}`
                // Skip labels on plain gap segments — baseboards and other
                // recognized parts (cab/ct/bb) still get labels.
                const showLabel = kind !== 'gap'
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
                const prefix = kind === 'cab' ? 'CAB ' : ''
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

      <div className="wall-elev-hint">
        Drag panels, cabinets &amp; countertops to reposition · Drag corners to resize · Changes sync to 3D view
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
