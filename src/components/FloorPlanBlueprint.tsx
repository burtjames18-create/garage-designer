import { useRef, useCallback, useState, useEffect } from 'react'
import type { GarageWall, PlacedCabinet, Countertop, FloorPoint, FloorStep, SlatwallPanel, StainlessBacksplashPanel, OverheadRack, Baseboard, StemWall, PlacedItem, ImportedAsset } from '../store/garageStore'
import { COUNTERTOP_DEPTH, useGarageStore } from '../store/garageStore'
import { inchesToDisplay, snapToGrid, snapRackToWalls, type RackSnapResult } from '../utils/measurements'
import { wallLen, wallDir, wallNormal } from '../utils/wallGeometry'
import { MODEL_CATALOG, CATEGORY_COLORS } from '../data/modelCatalog'
import { getCachedHull, loadHull, subscribeHullCache } from '../utils/modelHullCache'
import { getCachedModelUrl, restoreModelFromDB } from '../utils/importedModelCache'

/** Normalize rotation so text is never upside-down (keeps it between -90° and +90°) */
function readableAngle(deg: number) {
  while (deg > 90) deg -= 180
  while (deg < -90) deg += 180
  return deg
}

interface Props {
  walls: GarageWall[]
  cabinets: PlacedCabinet[]
  countertops: Countertop[]
  floorPoints: FloorPoint[]
  floorSteps?: FloorStep[]
  slatwallPanels?: SlatwallPanel[]
  stainlessBacksplashPanels?: StainlessBacksplashPanel[]
  overheadRacks?: OverheadRack[]
  baseboards?: Baseboard[]
  stemWalls?: StemWall[]
  items?: PlacedItem[]
  importedAssets?: ImportedAsset[]
  /** When false, the tracing reference image is omitted (used by PDF export). */
  showTracing?: boolean
  /** When true, the floor-plan measurement tool (draggable tape line) is shown. */
  showMeasureTool?: boolean
}

const PAD = 40  // compact padding to keep dim tiers close to wall edges
const SLATWALL_DEPTH = 3  // visual depth of slatwall on floor plan (inches)

export default function FloorPlanBlueprint({ walls, cabinets, countertops, floorPoints, floorSteps = [], slatwallPanels = [], stainlessBacksplashPanels = [], overheadRacks = [], baseboards = [], stemWalls = [], items = [], importedAssets = [], showTracing = true, showMeasureTool = false }: Props) {
  const { selectRack, updateRack, selectedRackId,
    selectCabinet, updateCabinet, selectedCabinetId, snappingEnabled,
    tracingImage, updateTracingImage,
    updateWall, selectedWallId, selectWall,
    selectFloorStep, updateFloorStep, selectedFloorStepId,
    updateOpening,
    selectItem, updateItem, selectedItemId,
    wallAngleSnapEnabled, cornerAngleLabelsVisible } = useGarageStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const rackDragRef = useRef<{ rackId: string; startX: number; startZ: number; startMouseX: number; startMouseZ: number } | null>(null)
  const [rackSnap, setRackSnap] = useState<RackSnapResult | null>(null)
  // Placed-item drag (cars / equipment / etc.) — translate the item along
  // the floor plane via its `position` field (stored in feet).
  const itemDragRef = useRef<{ itemId: string; startMouseX: number; startMouseZ: number; initFx: number; initFz: number } | null>(null)

  // Cabinet drag — slide along the wall the cabinet is attached to.
  // Locks the perpendicular component; only the along-wall position changes.
  const cabinetDragRef = useRef<{
    cabId: string
    ux: number; uz: number            // along-wall unit vector (from cabinet rotY)
    perpX: number; perpZ: number      // fixed perpendicular position (cabinet's current offset from origin along wall normal)
    startAlong: number                // cabinet's current along-projection at drag start
    startMouseAlong: number           // cursor's along-projection at drag start
  } | null>(null)

  // Wall endpoint drag — reshape garage footprint in the floor plan view.
  // `end` = which end of the wall being dragged.
  const wallEndDragRef = useRef<{
    wallId: string
    end: 'start' | 'end'
    startMouseX: number; startMouseZ: number
    initX: number; initZ: number
  } | null>(null)
  // Whole-wall drag — translate both endpoints by the same delta.
  const wallBodyDragRef = useRef<{
    wallId: string
    startMouseX: number; startMouseZ: number
    initX1: number; initZ1: number
    initX2: number; initZ2: number
  } | null>(null)
  // Frozen bounds during a wall-endpoint drag so the view doesn't recenter
  // as the endpoint moves outside the current bounding box.
  const frozenBoundsRef = useRef<{ minX: number; maxX: number; minZ: number; maxZ: number } | null>(null)

  // Tracing-image drag (body move + corner resize keeping aspect ratio).
  const tracingDragRef = useRef<{
    mode: 'move' | 'resize'
    startMouseX: number; startMouseZ: number
    initX: number; initZ: number
    initW: number; initH: number
  } | null>(null)

  // Step-up drag refs — body translates all corners; corner drag updates
  // a single corner. Snap logic below mirrors the 3D view's snap math so
  // behavior is identical across views.
  const stepBodyDragRef = useRef<{
    stepId: string
    startMouseX: number; startMouseZ: number
    initCorners: [number, number][]
  } | null>(null)
  const stepCornerDragRef = useRef<{
    stepId: string
    cornerIdx: number
  } | null>(null)

  // Opening (door/window/garage-door) drag — slide along the wall only.
  // Captures the initial along-wall offset and the wall's along-axis so
  // the opening follows the cursor's projection onto the wall direction.
  const openingDragRef = useRef<{
    wallId: string
    openingId: string
    ux: number; uz: number         // wall along-direction unit vector
    wallX1: number; wallZ1: number // wall start in inches
    wallLen: number
    widthIn: number
    startAlongHit: number          // cursor's along-wall position at drag start
    startXOffset: number
  } | null>(null)

  // Which drag handle is currently being grabbed. Used to hide the handle's
  // own circle during a drag so it doesn't obscure the snap target.
  const [activeHandleId, setActiveHandleId] = useState<string | null>(null)

  // Force re-render when async model-hull loads finish (so item silhouettes
  // appear without needing a reselect or pan).
  const [, setHullTick] = useState(0)
  useEffect(() => subscribeHullCache(() => setHullTick(t => t + 1)), [])

  // Floor-plan measurement line — two draggable endpoints in inches. Starts
  // null until the wall bounds are known, then initialized to a horizontal
  // line spanning ~half the garage width near the top of the bbox.
  const [measureLine, setMeasureLine] = useState<{ ax: number; az: number; bx: number; bz: number } | null>(null)
  const measureDragRef = useRef<{ end: 'a' | 'b'; startMouseX: number; startMouseZ: number; initX: number; initZ: number } | null>(null)

  if (walls.length === 0) return null

  // Bounding box of all wall endpoints (or frozen bounds during drag). If a
  // tracing image is visible and extends past the walls, expand the view to
  // fit it — otherwise the image's overflow gets clipped at the SVG edges.
  const allX = walls.flatMap(w => [w.x1, w.x2])
  const allZ = walls.flatMap(w => [w.z1, w.z2])
  const fb = frozenBoundsRef.current
  let minX = fb ? fb.minX : Math.min(...allX)
  let maxX = fb ? fb.maxX : Math.max(...allX)
  let minZ = fb ? fb.minZ : Math.min(...allZ)
  let maxZ = fb ? fb.maxZ : Math.max(...allZ)
  if (!fb && showTracing && tracingImage) {
    const halfW = tracingImage.widthIn / 2
    const halfH = tracingImage.heightIn / 2
    minX = Math.min(minX, tracingImage.x - halfW)
    maxX = Math.max(maxX, tracingImage.x + halfW)
    minZ = Math.min(minZ, tracingImage.z - halfH)
    maxZ = Math.max(maxZ, tracingImage.z + halfH)
  }
  const rangeX = maxX - minX || 1
  const rangeZ = maxZ - minZ || 1

  // Fit into a fixed SVG canvas
  const SVG_W = 780
  const SVG_H = 540
  const drawW = SVG_W - 2 * PAD
  const drawH = SVG_H - 2 * PAD
  const scale = Math.min(drawW / rangeX, drawH / rangeZ)

  // Center the drawing within the padded area
  const offX = PAD + (drawW - rangeX * scale) / 2
  const offZ = PAD + (drawH - rangeZ * scale) / 2

  const sx = (x: number) => offX + (x - minX) * scale
  const sz = (z: number) => offZ + (z - minZ) * scale

  // Initialize the measurement line on first render once we know the bounds.
  // Spans half the garage width, sitting just inside the top edge.
  useEffect(() => {
    if (measureLine) return
    const cxIn = (minX + maxX) / 2
    const lenIn = (maxX - minX) * 0.4
    const zIn = minZ + (maxZ - minZ) * 0.5
    setMeasureLine({ ax: cxIn - lenIn / 2, az: zIn, bx: cxIn + lenIn / 2, bz: zIn })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Inverse: SVG coords → garage inches
  const ix = (svgX: number) => (svgX - offX) / scale + minX
  const iz = (svgZ: number) => (svgZ - offZ) / scale + minZ

  // Convert a mouse event to garage coords. Uses getScreenCTM so any CSS
  // transforms on ancestors (viewport pan/zoom in Viewer3D) are accounted for.
  const mouseToSvg = useCallback((e: React.PointerEvent | PointerEvent): { x: number; z: number } | null => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())
    return { x: ix(svgPt.x), z: iz(svgPt.y) }
  }, [offX, offZ, scale, minX, minZ])

  // Rack drag handlers
  const onRackPointerDown = useCallback((e: React.PointerEvent, rack: OverheadRack) => {
    e.stopPropagation()
    e.preventDefault()
    selectRack(rack.id)
    if (rack.locked) return
    const pos = mouseToSvg(e)
    if (!pos) return
    rackDragRef.current = { rackId: rack.id, startX: rack.x, startZ: rack.z, startMouseX: pos.x, startMouseZ: pos.z }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [selectRack, mouseToSvg])

  const onRackPointerMove = useCallback((e: React.PointerEvent) => {
    const rd = rackDragRef.current
    if (!rd) return
    const pos = mouseToSvg(e)
    if (!pos) return
    const dx = pos.x - rd.startMouseX
    const dz = pos.z - rd.startMouseZ
    const gridX = snapToGrid(rd.startX + dx)
    const gridZ = snapToGrid(rd.startZ + dz)

    // Find the rack to get its dimensions and rotation
    const rack = overheadRacks.find(r => r.id === rd.rackId)
    if (!rack) return

    // Snap to walls
    const snap = snapRackToWalls(gridX, gridZ, rack.rackWidth, rack.rackLength, rack.rotY, walls)
    setRackSnap(snap)
    updateRack(rd.rackId, { x: snap.x, z: snap.z })
  }, [updateRack, mouseToSvg, overheadRacks, walls])

  const onRackPointerUp = useCallback((e?: React.PointerEvent) => {
    rackDragRef.current = null
    setRackSnap(null)
    if (e) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
    }
  }, [])

  // ── Cabinet drag (floor plan) ──────────────────────────────────────────────
  const onCabPointerDown = useCallback((e: React.PointerEvent, cab: PlacedCabinet) => {
    e.stopPropagation()
    e.preventDefault()
    selectCabinet(cab.id)
    if (cab.locked) return
    const pos = mouseToSvg(e)
    if (!pos) return
    // Along-wall direction derived from cabinet rotY (same convention as 3D)
    const ux = Math.cos(cab.rotY), uz = -Math.sin(cab.rotY)
    const cabAlong = cab.x * ux + cab.z * uz
    const cabPerpX = cab.x - cabAlong * ux
    const cabPerpZ = cab.z - cabAlong * uz
    const mouseAlong = pos.x * ux + pos.z * uz
    cabinetDragRef.current = {
      cabId: cab.id,
      ux, uz,
      perpX: cabPerpX, perpZ: cabPerpZ,
      startAlong: cabAlong,
      startMouseAlong: mouseAlong,
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [mouseToSvg, selectCabinet])

  const onCabPointerMove = useCallback((e: React.PointerEvent) => {
    const cd = cabinetDragRef.current
    if (!cd) return
    const pos = mouseToSvg(e)
    if (!pos) return
    const mouseAlong = pos.x * cd.ux + pos.z * cd.uz
    let newAlong = cd.startAlong + (mouseAlong - cd.startMouseAlong)
    const cab = cabinets.find(c => c.id === cd.cabId)
    if (!cab) return

    if (snappingEnabled) {
      newAlong = snapToGrid(newAlong)
      // Cabinet-to-cabinet edge snap along this wall
      const halfW = cab.w / 2
      const SIDE_SNAP = 2
      for (const other of cabinets) {
        if (other.id === cab.id) continue
        // Only consider cabinets on the same along-wall axis (same rotY ±π)
        const da = Math.abs(((cab.rotY - other.rotY) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
        const aligned = da < 0.15 || da > Math.PI * 2 - 0.15 || Math.abs(da - Math.PI) < 0.15
        if (!aligned) continue
        const oAlong = other.x * cd.ux + other.z * cd.uz
        // Only snap to cabinets whose perpendicular position matches this wall
        const oPerpX = other.x - oAlong * cd.ux
        const oPerpZ = other.z - oAlong * cd.uz
        if (Math.hypot(oPerpX - cd.perpX, oPerpZ - cd.perpZ) > 8) continue
        const dLR = Math.abs((newAlong - halfW) - (oAlong + other.w / 2))
        if (dLR < SIDE_SNAP) newAlong = oAlong + other.w / 2 + halfW
        const dRL = Math.abs((newAlong + halfW) - (oAlong - other.w / 2))
        if (dRL < SIDE_SNAP) newAlong = oAlong - other.w / 2 - halfW
      }
      // Corner snap — inset by adjacent wall thickness/2 at each end of the
      // wall this cabinet is attached to (find nearest wall by rotY match).
      let bestWall: GarageWall | null = null
      let bestScore = Infinity
      for (const w of walls) {
        const wLen = wallLen(w)
        if (wLen < 1) continue
        const [wdx, wdz] = wallDir(w)
        // cabinet facing: its rotY maps to wall axis as (cos, -sin)
        const cross = Math.abs(cd.ux * wdz - cd.uz * wdx)
        if (cross > 0.1) continue  // not parallel to this wall
        // Distance from cabinet perp point to wall line
        const relX = cd.perpX - w.x1, relZ = cd.perpZ - w.z1
        const along = relX * wdx + relZ * wdz
        const perp = Math.abs(relX * (-wdz) + relZ * wdx)
        if (along < -12 || along > wLen + 12) continue
        const score = perp
        if (score < bestScore) { bestScore = score; bestWall = w }
      }
      if (bestWall) {
        const wLen = wallLen(bestWall)
        const [wdx, wdz] = wallDir(bestWall)
        // Which direction of the wall corresponds to +along for cabinet?
        const sign = (wdx * cd.ux + wdz * cd.uz) >= 0 ? 1 : -1
        // Inset by adjacent connecting wall thickness/2 at either wall end
        const CONNECT = 6
        let startInset = 0, endInset = 0
        for (const other of walls) {
          if (other.id === bestWall.id) continue
          const nearStart = Math.min(
            Math.hypot(other.x1 - bestWall.x1, other.z1 - bestWall.z1),
            Math.hypot(other.x2 - bestWall.x1, other.z2 - bestWall.z1),
          ) < CONNECT
          const nearEnd = Math.min(
            Math.hypot(other.x1 - bestWall.x2, other.z1 - bestWall.z2),
            Math.hypot(other.x2 - bestWall.x2, other.z2 - bestWall.z2),
          ) < CONNECT
          if (nearStart) startInset = Math.max(startInset, other.thickness / 2)
          if (nearEnd)   endInset   = Math.max(endInset,   other.thickness / 2)
        }
        // Wall-start corresponds to along = 0 on the wall; convert to cabinet's along-space.
        const wallStartAlong = bestWall.x1 * cd.ux + bestWall.z1 * cd.uz
        const wallEndAlong   = bestWall.x2 * cd.ux + bestWall.z2 * cd.uz
        const loAlong = Math.min(wallStartAlong, wallEndAlong)
        const hiAlong = Math.max(wallStartAlong, wallEndAlong)
        const startTarget = (sign > 0 ? loAlong + startInset : hiAlong - startInset) + (sign > 0 ? halfW : -halfW)
        const endTarget   = (sign > 0 ? hiAlong - endInset   : loAlong + endInset  ) - (sign > 0 ? halfW : -halfW)
        const CORNER_SNAP = 18
        if (Math.abs(newAlong - startTarget) < CORNER_SNAP) newAlong = startTarget
        else if (Math.abs(newAlong - endTarget) < CORNER_SNAP) newAlong = endTarget
        // Also clamp the cabinet so its edge stays within the wall's usable span
        void wLen
      }
    }

    const newX = cd.perpX + newAlong * cd.ux
    const newZ = cd.perpZ + newAlong * cd.uz
    updateCabinet(cd.cabId, { x: newX, z: newZ })
  }, [cabinets, walls, snappingEnabled, updateCabinet, mouseToSvg])

  const onCabPointerUp = useCallback((e?: React.PointerEvent) => {
    cabinetDragRef.current = null
    if (e) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
    }
  }, [])

  // ─── Wall endpoint drag ────────────────────────────────────────────────────
  const onWallEndPointerDown = useCallback((
    e: React.PointerEvent, wall: GarageWall, end: 'start' | 'end',
  ) => {
    if (wall.locked) return
    e.stopPropagation()
    e.preventDefault()
    selectWall(wall.id)
    const pos = mouseToSvg(e)
    if (!pos) return
    wallEndDragRef.current = {
      wallId: wall.id, end,
      startMouseX: pos.x, startMouseZ: pos.z,
      initX: end === 'start' ? wall.x1 : wall.x2,
      initZ: end === 'start' ? wall.z1 : wall.z2,
    }
    setActiveHandleId(`wall-${wall.id}-${end}`)
    // Freeze view bounds for the duration of the drag so the canvas doesn't
    // rescale/recenter as the endpoint moves around.
    const xs = walls.flatMap(w => [w.x1, w.x2])
    const zs = walls.flatMap(w => [w.z1, w.z2])
    frozenBoundsRef.current = {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [mouseToSvg, selectWall, walls])

  const onWallEndPointerMove = useCallback((e: React.PointerEvent) => {
    const wd = wallEndDragRef.current
    if (!wd) return
    const pos = mouseToSvg(e)
    if (!pos) return
    let nx = snapToGrid(wd.initX + (pos.x - wd.startMouseX))
    let nz = snapToGrid(wd.initZ + (pos.z - wd.startMouseZ))
    if (snappingEnabled) {
      const SNAP = 6
      const wall = walls.find(w => w.id === wd.wallId)
      const fixedX = wall ? (wd.end === 'start' ? wall.x2 : wall.x1) : wd.initX
      const fixedZ = wall ? (wd.end === 'start' ? wall.z2 : wall.z1) : wd.initZ

      // Step 1: angle-snap the direction from fixed end → cursor to nearest 45°.
      let dirX = nx - fixedX, dirZ = nz - fixedZ
      let len = Math.hypot(dirX, dirZ)
      let angleLocked = false
      if (len > 1) {
        if (wallAngleSnapEnabled) {
          const ang = Math.atan2(dirZ, dirX)
          const step = Math.PI / 4
          const snapped = Math.round(ang / step) * step
          const diff = Math.abs(((ang - snapped + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
          const ANGLE_TOL = 1 * Math.PI / 180
          if (diff < ANGLE_TOL) {
            dirX = Math.cos(snapped); dirZ = Math.sin(snapped)
            nx = snapToGrid(fixedX + dirX * len)
            nz = snapToGrid(fixedZ + dirZ * len)
            angleLocked = true
          } else {
            dirX /= len; dirZ /= len
          }
        } else {
          dirX /= len; dirZ /= len
        }
      }

      // Step 2: snap targets are the centerline endpoints of every other
      // wall. This matches how the default project's walls connect — corners
      // share centerline endpoints, with the outer mitered corner derived
      // from the wall thickness. Keeping a single canonical snap target
      // means every wall-to-wall corner snaps the same way.
      const targets: [number, number][] = []
      for (const w of walls) {
        if (w.id === wd.wallId) continue
        const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
        const wl = Math.hypot(wdx, wdz)
        if (wl < 0.1) continue
        targets.push([w.x1, w.z1])
        targets.push([w.x2, w.z2])
      }

      let bestDist = SNAP, bx = nx, bz = nz
      if (angleLocked) {
        // Slide the endpoint ALONG the locked ray to a nearby target. Require
        // both perpendicular closeness to the ray AND along-axis closeness to
        // the cursor, so distant targets on the ray don't grab the endpoint.
        const cursorAlong = (nx - fixedX) * dirX + (nz - fixedZ) * dirZ
        for (const [tx, tz] of targets) {
          const along = (tx - fixedX) * dirX + (tz - fixedZ) * dirZ
          if (along < 1) continue
          const perpX = (tx - fixedX) - dirX * along
          const perpZ = (tz - fixedZ) - dirZ * along
          const perp = Math.hypot(perpX, perpZ)
          if (perp >= SNAP) continue
          const alongDist = Math.abs(along - cursorAlong)
          if (alongDist >= SNAP) continue
          const total = Math.hypot(perp, alongDist)
          if (total < bestDist) {
            bestDist = total
            bx = snapToGrid(fixedX + dirX * along)
            bz = snapToGrid(fixedZ + dirZ * along)
          }
        }
      } else {
        // No angle lock — plain 2D closest-target snap to centerline endpoints.
        for (const [tx, tz] of targets) {
          const d = Math.hypot(nx - tx, nz - tz)
          if (d < bestDist) { bestDist = d; bx = tx; bz = tz }
        }
      }
      // Face-line slide snap (T-junction): project the cursor onto each other
      // wall's centerline (clamped to segment). If the perpendicular distance
      // is within SNAP, the endpoint slides along that face. Centerline-endpoint
      // matches above already won and short-circuit here, so this only fires
      // when you're hitting the body of another wall, not its corners.
      if (bestDist >= SNAP) {
        for (const w of walls) {
          if (w.id === wd.wallId) continue
          const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
          const wl = Math.hypot(wdx, wdz)
          if (wl < 0.1) continue
          const ux = wdx / wl, uz = wdz / wl
          const relX = nx - w.x1, relZ = nz - w.z1
          const along = relX * ux + relZ * uz
          if (along < 0 || along > wl) continue
          const fx = w.x1 + ux * along
          const fz = w.z1 + uz * along
          const d = Math.hypot(nx - fx, nz - fz)
          if (d < bestDist) { bestDist = d; bx = fx; bz = fz }
        }
      }
      nx = bx; nz = bz
    }
    const changes = wd.end === 'start' ? { x1: nx, z1: nz } : { x2: nx, z2: nz }
    updateWall(wd.wallId, changes)
  }, [mouseToSvg, snappingEnabled, updateWall, walls])

  const onWallEndPointerUp = useCallback((e?: React.PointerEvent) => {
    wallEndDragRef.current = null
    frozenBoundsRef.current = null
    setActiveHandleId(null)
    if (e) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
    }
  }, [])

  // Whole-wall body drag (click+drag the wall polygon to translate it).
  const onWallBodyPointerDown = useCallback((
    e: React.PointerEvent, wall: GarageWall,
  ) => {
    if (e.button !== 0) return
    if (wall.locked) {
      selectWall(wall.id)
      return
    }
    e.stopPropagation()
    e.preventDefault()
    selectWall(wall.id)
    const pos = mouseToSvg(e)
    if (!pos) return
    wallBodyDragRef.current = {
      wallId: wall.id,
      startMouseX: pos.x, startMouseZ: pos.z,
      initX1: wall.x1, initZ1: wall.z1,
      initX2: wall.x2, initZ2: wall.z2,
    }
    const xs = walls.flatMap(w => [w.x1, w.x2])
    const zs = walls.flatMap(w => [w.z1, w.z2])
    frozenBoundsRef.current = {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [mouseToSvg, selectWall, walls])

  const onWallBodyPointerMove = useCallback((e: React.PointerEvent) => {
    const wd = wallBodyDragRef.current
    if (!wd) return
    const pos = mouseToSvg(e)
    if (!pos) return
    const dx = pos.x - wd.startMouseX
    const dz = pos.z - wd.startMouseZ
    let nx1 = snapToGrid(wd.initX1 + dx), nz1 = snapToGrid(wd.initZ1 + dz)
    let nx2 = snapToGrid(wd.initX2 + dx), nz2 = snapToGrid(wd.initZ2 + dz)
    // Snap whichever endpoint lands closest to another wall's endpoint OR
    // to any point along another wall's edge; shift the whole wall by that
    // delta so both endpoints move in unison.
    if (snappingEnabled) {
      const SNAP = 3
      let bestDist = SNAP, snapDx = 0, snapDz = 0
      for (const w of walls) {
        if (w.id === wd.wallId) continue
        // Wall endpoints
        for (const [px, pz] of [[w.x1, w.z1], [w.x2, w.z2]] as [number, number][]) {
          const d1 = Math.hypot(nx1 - px, nz1 - pz)
          if (d1 < bestDist) { bestDist = d1; snapDx = px - nx1; snapDz = pz - nz1 }
          const d2 = Math.hypot(nx2 - px, nz2 - pz)
          if (d2 < bestDist) { bestDist = d2; snapDx = px - nx2; snapDz = pz - nz2 }
        }
        // Wall edge — closest point on segment for each endpoint
        const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
        const wl2 = wdx * wdx + wdz * wdz
        if (wl2 < 0.01) continue
        const proj = (px: number, pz: number) => {
          const t = Math.max(0, Math.min(1, ((px - w.x1) * wdx + (pz - w.z1) * wdz) / wl2))
          return [w.x1 + t * wdx, w.z1 + t * wdz] as [number, number]
        }
        const [cx1, cz1] = proj(nx1, nz1)
        const [cx2, cz2] = proj(nx2, nz2)
        const de1 = Math.hypot(nx1 - cx1, nz1 - cz1)
        if (de1 < bestDist) { bestDist = de1; snapDx = cx1 - nx1; snapDz = cz1 - nz1 }
        const de2 = Math.hypot(nx2 - cx2, nz2 - cz2)
        if (de2 < bestDist) { bestDist = de2; snapDx = cx2 - nx2; snapDz = cz2 - nz2 }
      }
      if (snapDx || snapDz) {
        nx1 += snapDx; nz1 += snapDz; nx2 += snapDx; nz2 += snapDz
      }
    }
    updateWall(wd.wallId, { x1: nx1, z1: nz1, x2: nx2, z2: nz2 })
  }, [mouseToSvg, snappingEnabled, updateWall, walls])

  const onWallBodyPointerUp = useCallback((e?: React.PointerEvent) => {
    wallBodyDragRef.current = null
    frozenBoundsRef.current = null
    if (e) {
      try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
    }
  }, [])

  // ─── Step-up snap helpers ────────────────────────────────────────────────
  // Snap a candidate point to (1) wall face corners, (2) other step
  // corners, (3) any point along a wall face line. Mirrors the 3D view's
  // snap math so dragging a step in either view locks onto the same
  // targets. Returns the snapped position or null if no target within SNAP.
  const snapStepPoint = useCallback((hx: number, hz: number, selfStepId: string): { x: number; z: number } | null => {
    const SNAP = 5
    const JOINT_SNAP = 5
    let bestX = hx, bestZ = hz
    // (1a) TOP-PRIORITY: true visible wall-joint corners. Wider pull range
    //      so the cursor snaps to the inside/outside corner instead of
    //      flipping between the two wall face lines near the corner.
    {
      let bestDist = JOINT_SNAP
      const TOL = 6
      for (let i = 0; i < walls.length; i++) {
        const wA = walls[i]
        const [uxA, uzA] = wallDir(wA)
        const [nxA, nzA] = wallNormal(wA)
        const hA = wA.thickness / 2
        for (let j = i + 1; j < walls.length; j++) {
          const wB = walls[j]
          const connected =
            Math.hypot(wA.x1 - wB.x1, wA.z1 - wB.z1) < TOL ||
            Math.hypot(wA.x1 - wB.x2, wA.z1 - wB.z2) < TOL ||
            Math.hypot(wA.x2 - wB.x1, wA.z2 - wB.z1) < TOL ||
            Math.hypot(wA.x2 - wB.x2, wA.z2 - wB.z2) < TOL
          if (!connected) continue
          const [uxB, uzB] = wallDir(wB)
          if (Math.abs(uxA * uzB - uzA * uxB) < 0.01) continue
          const [nxB, nzB] = wallNormal(wB)
          const hB = wB.thickness / 2
          const det = nxA * nzB - nzA * nxB
          if (Math.abs(det) < 0.001) continue
          for (const sign of [+1, -1]) {
            const sA = sign * hA, sB = sign * hB
            const cA = sA + wA.x1 * nxA + wA.z1 * nzA
            const cB = sB + wB.x1 * nxB + wB.z1 * nzB
            const px = (cA * nzB - cB * nzA) / det
            const pz = (nxA * cB - nxB * cA) / det
            const d = Math.hypot(hx - px, hz - pz)
            if (d < bestDist) { bestDist = d; bestX = px; bestZ = pz }
          }
        }
      }
      if (bestDist < JOINT_SNAP) return { x: bestX, z: bestZ }
    }
    // (1b) Per-wall face corners at unconnected wall ends.
    let bestDist = SNAP
    const TOL0 = 6
    const isEpConnected = (wallId: string, ex: number, ez: number) =>
      walls.some(o => o.id !== wallId && (
        Math.hypot(o.x1 - ex, o.z1 - ez) < TOL0 ||
        Math.hypot(o.x2 - ex, o.z2 - ez) < TOL0
      ))
    for (const wall of walls) {
      const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
      const L = Math.hypot(wdx, wdz)
      if (L < 0.1) continue
      const ux = wdx / L, uz = wdz / L
      const nx = -uz, nz = ux
      const halfT = wall.thickness / 2
      const pts: [number, number][] = []
      if (!isEpConnected(wall.id, wall.x1, wall.z1)) {
        pts.push([wall.x1 + nx * halfT, wall.z1 + nz * halfT])
        pts.push([wall.x1 - nx * halfT, wall.z1 - nz * halfT])
      }
      if (!isEpConnected(wall.id, wall.x2, wall.z2)) {
        pts.push([wall.x2 + nx * halfT, wall.z2 + nz * halfT])
        pts.push([wall.x2 - nx * halfT, wall.z2 - nz * halfT])
      }
      for (const [px, pz] of pts) {
        const d = Math.hypot(hx - px, hz - pz)
        if (d < bestDist) { bestDist = d; bestX = px; bestZ = pz }
      }
    }
    // (2) other step-up corners
    for (const other of floorSteps) {
      if (other.id === selfStepId) continue
      for (const [ox, oz] of other.corners) {
        const d = Math.hypot(hx - ox, hz - oz)
        if (d < bestDist) { bestDist = d; bestX = ox; bestZ = oz }
      }
    }
    // (3) face-segment snap (clamped along)
    for (const wall of walls) {
      const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
      const L = Math.hypot(wdx, wdz)
      if (L < 0.1) continue
      const ux = wdx / L, uz = wdz / L
      const nx = -uz, nz = ux
      const halfT = wall.thickness / 2
      const relX = hx - wall.x1, relZ = hz - wall.z1
      const along = relX * ux + relZ * uz
      if (along < -SNAP || along > L + SNAP) continue
      const alongClamped = Math.max(0, Math.min(L, along))
      for (const side of [halfT, -halfT]) {
        const snapX = wall.x1 + alongClamped * ux + side * nx
        const snapZ = wall.z1 + alongClamped * uz + side * nz
        const d = Math.hypot(hx - snapX, hz - snapZ)
        if (d < bestDist) { bestDist = d; bestX = snapX; bestZ = snapZ }
      }
    }
    return bestDist < SNAP ? { x: bestX, z: bestZ } : null
  }, [walls, floorSteps])

  // Clamp a candidate (x, z) so it stays on the garage-center side of every
  // wall's interior face line. Iterates a few passes because clamping
  // against one wall can push the point past another, and we want the
  // result to satisfy ALL wall constraints simultaneously.
  const clampToInteriorFaces = useCallback((px: number, pz: number): [number, number] => {
    let hx = px, hz = pz
    for (let pass = 0; pass < 4; pass++) {
      let moved = false
      for (const w of walls) {
        const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
        const L = Math.hypot(wdx, wdz)
        if (L < 0.1) continue
        const ux = wdx / L, uz = wdz / L
        const [nxIn, nzIn] = wallNormal(w)
        const halfT = w.thickness / 2
        const ifx = w.x1 + nxIn * halfT
        const ifz = w.z1 + nzIn * halfT
        const rel = (hx - ifx) * nxIn + (hz - ifz) * nzIn
        if (rel >= 0) continue
        // Only clamp if the projection lies within the wall's segment span,
        // so we don't fight against partition walls the step is past the
        // end of. Allow a small overshoot at each end so corners flush to
        // an end-of-wall still snap properly.
        const along = (hx - w.x1) * ux + (hz - w.z1) * uz
        if (along < -2 || along > L + 2) continue
        hx -= rel * nxIn
        hz -= rel * nzIn
        moved = true
      }
      if (!moved) break
    }
    return [hx, hz]
  }, [walls])

  // ─── Step-up body drag (translate all corners) ───────────────────────────
  const onStepBodyDown = useCallback((e: React.PointerEvent, step: FloorStep) => {
    if (step.locked) return
    e.stopPropagation()
    e.preventDefault()
    selectFloorStep(step.id)
    const pos = mouseToSvg(e)
    if (!pos) return
    stepBodyDragRef.current = {
      stepId: step.id,
      startMouseX: pos.x, startMouseZ: pos.z,
      initCorners: step.corners.map(c => [...c] as [number, number]),
    }
    setActiveHandleId(`step-body-${step.id}`)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [mouseToSvg, selectFloorStep])

  const onStepBodyMove = useCallback((e: React.PointerEvent) => {
    const sd = stepBodyDragRef.current
    if (!sd) return
    const pos = mouseToSvg(e)
    if (!pos) return
    const dx = pos.x - sd.startMouseX
    const dz = pos.z - sd.startMouseZ
    const moved: [number, number][] = sd.initCorners.map(([cx, cz]) => [cx + dx, cz + dz] as [number, number])
    // Pick the best snap across all corners: translate by whichever corner's
    // snap has the smallest magnitude offset.
    let snapDx = 0, snapDz = 0
    let bestMag = Infinity
    if (snappingEnabled) {
      for (const [cx, cz] of moved) {
        const s = snapStepPoint(cx, cz, sd.stepId)
        if (s) {
          const mag = Math.hypot(s.x - cx, s.z - cz)
          if (mag < bestMag) { bestMag = mag; snapDx = s.x - cx; snapDz = s.z - cz }
        }
      }
    }
    for (const c of moved) { c[0] += snapDx; c[1] += snapDz }
    // Wall-clamp: for each corner that lands past a wall's interior face,
    // compute how far we need to push back. Apply the LARGEST single-axis
    // correction to the whole shape so the step stays a rigid translation.
    let pushDx = 0, pushDz = 0
    for (const [cx, cz] of moved) {
      const [clampedX, clampedZ] = clampToInteriorFaces(cx, cz)
      const ddx = clampedX - cx, ddz = clampedZ - cz
      if (Math.abs(ddx) > Math.abs(pushDx)) pushDx = ddx
      if (Math.abs(ddz) > Math.abs(pushDz)) pushDz = ddz
    }
    if (pushDx || pushDz) {
      for (const c of moved) { c[0] += pushDx; c[1] += pushDz }
    }
    updateFloorStep(sd.stepId, { corners: moved })
  }, [mouseToSvg, snapStepPoint, updateFloorStep, snappingEnabled, clampToInteriorFaces])

  const onStepBodyUp = useCallback((e?: React.PointerEvent) => {
    stepBodyDragRef.current = null
    setActiveHandleId(null)
    if (e) { try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {} }
  }, [])

  // ─── Step-up corner drag (reshape single corner) ─────────────────────────
  const onStepCornerDown = useCallback((e: React.PointerEvent, step: FloorStep, cornerIdx: number) => {
    if (step.locked) return
    e.stopPropagation()
    e.preventDefault()
    selectFloorStep(step.id)
    stepCornerDragRef.current = { stepId: step.id, cornerIdx }
    setActiveHandleId(`step-corner-${step.id}-${cornerIdx}`)
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [selectFloorStep])

  const onStepCornerMove = useCallback((e: React.PointerEvent) => {
    const cd = stepCornerDragRef.current
    if (!cd) return
    const pos = mouseToSvg(e)
    if (!pos) return
    let hx = pos.x, hz = pos.z
    const step = floorSteps.find(s => s.id === cd.stepId)
    if (!step) return
    if (snappingEnabled) {
      // 90° edge lock — if the dragged corner sits near axis-aligned with a
      // neighbor, lock the matching coordinate so the adjacent edge stays
      // horizontal or vertical. Runs FIRST so wall-face snap below can still
      // refine the other coordinate onto a wall face.
      const n = step.corners.length
      const prev = step.corners[(cd.cornerIdx - 1 + n) % n]
      const next = step.corners[(cd.cornerIdx + 1) % n]
      const ANGLE_TOL_DEG = 3
      const snapEdge = (ax: number, az: number) => {
        const dx = hx - ax, dz = hz - az
        const L = Math.hypot(dx, dz)
        if (L < 1) return
        const ang = Math.atan2(dz, dx) * 180 / Math.PI
        const nearest = Math.round(ang / 90) * 90
        if (Math.abs(ang - nearest) >= ANGLE_TOL_DEG) return
        const norm = ((nearest % 360) + 360) % 360
        if (norm === 0 || norm === 180) hz = az   // horizontal edge
        else hx = ax                                // vertical edge
      }
      snapEdge(prev[0], prev[1])
      snapEdge(next[0], next[1])
      // Wall-face / corner snap — joint corners, face corners, and any point
      // along a wall face. May override the 90° lock if a face is in range.
      const s = snapStepPoint(hx, hz, cd.stepId)
      if (s) { hx = s.x; hz = s.z }
    }
    // Final clamp: keep the corner inside (or on) every wall's interior face.
    [hx, hz] = clampToInteriorFaces(hx, hz)
    const newCorners = step.corners.map((c, i) =>
      i === cd.cornerIdx ? [hx, hz] as [number, number] : [...c] as [number, number],
    )
    updateFloorStep(cd.stepId, { corners: newCorners })
  }, [mouseToSvg, snapStepPoint, floorSteps, updateFloorStep, snappingEnabled, clampToInteriorFaces])

  const onStepCornerUp = useCallback((e?: React.PointerEvent) => {
    stepCornerDragRef.current = null
    setActiveHandleId(null)
    if (e) { try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {} }
  }, [])

  // ─── Opening (door/window/garage-door) drag — slide along wall ───────────
  const onOpeningDown = useCallback((e: React.PointerEvent, wall: GarageWall, op: { id: string; xOffset: number; width: number }) => {
    if (wall.locked) return
    e.stopPropagation()
    e.preventDefault()
    selectWall(wall.id)
    const pos = mouseToSvg(e)
    if (!pos) return
    const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
    const len = Math.hypot(wdx, wdz)
    if (len < 0.1) return
    const ux = wdx / len, uz = wdz / len
    // Project the cursor onto the wall's along-axis (wall.x1 origin).
    const startAlong = (pos.x - wall.x1) * ux + (pos.z - wall.z1) * uz
    openingDragRef.current = {
      wallId: wall.id,
      openingId: op.id,
      ux, uz,
      wallX1: wall.x1, wallZ1: wall.z1,
      wallLen: len,
      widthIn: op.width,
      startAlongHit: startAlong,
      startXOffset: op.xOffset,
    }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }, [mouseToSvg, selectWall])

  const onOpeningMove = useCallback((e: React.PointerEvent) => {
    const od = openingDragRef.current
    if (!od) return
    const pos = mouseToSvg(e)
    if (!pos) return
    const curAlong = (pos.x - od.wallX1) * od.ux + (pos.z - od.wallZ1) * od.uz
    const dAlong = curAlong - od.startAlongHit
    let newX = od.startXOffset + dAlong
    // Clamp so the opening stays inside the wall.
    newX = Math.max(0, Math.min(od.wallLen - od.widthIn, Math.round(newX * 4) / 4))
    updateOpening(od.wallId, od.openingId, { xOffset: newX })
  }, [mouseToSvg, updateOpening])

  const onOpeningUp = useCallback((e?: React.PointerEvent) => {
    openingDragRef.current = null
    if (e) { try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {} }
  }, [])

  const dimColor = '#555'
  const dimColorLight = '#888'
  const textColor = '#333'
  // Reduced 30% (was 7) so the general dim-tier text stays proportional with fsDim / fsSeg.
  const fs = 4.9
  const tk = 3

  // Garage center fallback (used when floor polygon unavailable)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2

  // Point-in-polygon test (ray casting) for outward direction
  function pointInFloor(px: number, pz: number): boolean {
    if (floorPoints.length < 3) return false
    let inside = false
    for (let i = 0, j = floorPoints.length - 1; i < floorPoints.length; j = i++) {
      const xi = floorPoints[i].x, zi = floorPoints[i].z
      const xj = floorPoints[j].x, zj = floorPoints[j].z
      if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) {
        inside = !inside
      }
    }
    return inside
  }

  // ── Find which wall endpoints connect to other walls ──
  // Returns `{ wall, kind: 'corner' | 'tjunction' }` if our endpoint sits at
  // a connected wall's endpoint (L-corner) or on its centerline mid-span
  // (T-junction). Mitering and dimension trimming both depend on the kind.
  const SNAP = 2
  type ConnInfo = { wall: GarageWall; kind: 'corner' | 'tjunction' }
  function endpointConnected(wx: number, wz: number, skipId: string): ConnInfo | null {
    // Pass 1: corner connection (endpoint-to-endpoint).
    for (const other of walls) {
      if (other.id === skipId) continue
      if (Math.hypot(other.x1 - wx, other.z1 - wz) < SNAP) return { wall: other, kind: 'corner' }
      if (Math.hypot(other.x2 - wx, other.z2 - wz) < SNAP) return { wall: other, kind: 'corner' }
    }
    // Pass 2: T-junction (endpoint lies on another wall's centerline body,
    // not at its endpoints). Project (wx,wz) onto each wall's segment and
    // accept if perpendicular distance is within SNAP and the foot is
    // strictly between the endpoints.
    for (const other of walls) {
      if (other.id === skipId) continue
      const dx = other.x2 - other.x1, dz = other.z2 - other.z1
      const wl = Math.hypot(dx, dz)
      if (wl < 0.1) continue
      const ux = dx / wl, uz = dz / wl
      const along = (wx - other.x1) * ux + (wz - other.z1) * uz
      if (along <= SNAP || along >= wl - SNAP) continue
      const fx = other.x1 + ux * along
      const fz = other.z1 + uz * along
      if (Math.hypot(wx - fx, wz - fz) < SNAP) return { wall: other, kind: 'tjunction' }
    }
    return null
  }

  /** Interior face length of a wall — measures where the inside edges meet.
   *  At connected corners, computes the actual intersection of the interior
   *  face lines so the measurement is accurate at any angle. */
  function interiorLen(w: GarageWall) {
    const len = wallLen(w)
    if (len < 0.5) return { len, trim1: 0, trim2: 0, interior: len, ifx1: w.x1, ifz1: w.z1, ifx2: w.x2, ifz2: w.z2 }
    const [dx, dz] = wallDir(w)
    const px = -dz, pz = dx  // perpendicular
    const halfT = w.thickness / 2

    // Determine interior side (toward garage center)
    const wmx = (w.x1 + w.x2) / 2, wmz = (w.z1 + w.z2) / 2
    const dot = px * (cx - wmx) + pz * (cz - wmz)
    const inSign = dot >= 0 ? 1 : -1  // +1 if +side is interior, -1 if -side

    // Interior face line origin (at wall start)
    const ifOx = w.x1 + px * halfT * inSign
    const ifOz = w.z1 + pz * halfT * inSign

    // Default interior face start/end (along wall direction from face origin)
    let trim1 = 0, trim2 = 0

    const conn1 = endpointConnected(w.x1, w.z1, w.id)
    const conn2 = endpointConnected(w.x2, w.z2, w.id)

    // Compute trim at each connected end. For an L-corner the interior face
    // meets conn's interior face (the original logic). For a T-junction our
    // body terminates at conn's NEAR face line — pick whichever of conn's
    // two face lines gives the smaller positive trim (the one closer to our
    // centerline endpoint, on our body side).
    const trimAt = (conn: ConnInfo, isStart: boolean): number => {
      const c = conn.wall
      const cLen = wallLen(c)
      if (cLen <= 0.5) return 0
      const [cdx, cdz] = wallDir(c)
      const cpx = -cdz, cpz = cdx
      const cHT = c.thickness / 2
      const det = dx * (-cdz) - dz * (-cdx)
      if (Math.abs(det) < 1e-6) return 0
      if (conn.kind === 'corner') {
        // Interior↔interior face match (matches the L-corner outer-pivot rule
        // used by the wall renderer). Use inSign so our interior side picks
        // conn's interior side.
        const cIfOx = c.x1 + cpx * cHT * inSign
        const cIfOz = c.z1 + cpz * cHT * inSign
        const t = ((cIfOx - ifOx) * (-cdz) - (cIfOz - ifOz) * (-cdx)) / det
        if (t > 0 && t < len) return isStart ? t : len - t
        return 0
      }
      // T-junction: try both faces, take smaller positive trim.
      let bestTrim = Infinity
      for (const cSide of [+1, -1] as const) {
        const cIfOx = c.x1 + cpx * cHT * cSide
        const cIfOz = c.z1 + cpz * cHT * cSide
        const t = ((cIfOx - ifOx) * (-cdz) - (cIfOz - ifOz) * (-cdx)) / det
        const trim = isStart ? t : len - t
        if (trim > 0.1 && trim < bestTrim) bestTrim = trim
      }
      return bestTrim === Infinity ? 0 : bestTrim
    }
    if (conn1) trim1 = trimAt(conn1, true)
    if (conn2) trim2 = trimAt(conn2, false)
    if (conn1 && trim1 < 0.1) trim1 = conn1.wall.thickness / 2
    if (conn2 && trim2 < 0.1) trim2 = conn2.wall.thickness / 2

    const interior = len - trim1 - trim2
    const ifx1 = w.x1 + dx * trim1, ifz1 = w.z1 + dz * trim1
    const ifx2 = w.x2 - dx * trim2, ifz2 = w.z2 - dz * trim2
    return { len, trim1, trim2, interior, ifx1, ifz1, ifx2, ifz2 }
  }

  // ── Mitered wall outlines (4 polygon corners per wall) ──
  // Computed once and reused by the wall renderer AND the dimension witness
  // anchors so dim lines align exactly with the visible polygon edges.
  // Layout: { p0, p1 } = +side start/end (interior or exterior depending on
  // pIsInterior), { n0, n1 } = -side start/end, plus pIsInterior flag.
  type WallOutline = {
    p0: { x: number; z: number }; p1: { x: number; z: number }
    n0: { x: number; z: number }; n1: { x: number; z: number }
    pIsInterior: boolean
  }
  const intersectT = (ax: number, az: number, adx: number, adz: number,
                      bx: number, bz: number, bdx: number, bdz: number) => {
    const det = adx * (-bdz) - adz * (-bdx)
    if (Math.abs(det) < 1e-6) return NaN
    return ((bx - ax) * (-bdz) - (bz - az) * (-bdx)) / det
  }
  const wallOutlines = new Map<string, WallOutline>()
  for (const w of walls) {
    const len = wallLen(w)
    if (len < 0.5) continue
    const [dx, dz] = wallDir(w)
    const halfT = w.thickness / 2
    const px = -dz, pz = dx
    const conn1 = endpointConnected(w.x1, w.z1, w.id)
    const conn2 = endpointConnected(w.x2, w.z2, w.id)
    const [nxIn, nzIn] = wallNormal(w)
    const pIsInterior = (px * nxIn + pz * nzIn) >= 0

    let p0 = { x: w.x1 + px * halfT, z: w.z1 + pz * halfT }
    let n0 = { x: w.x1 - px * halfT, z: w.z1 - pz * halfT }
    let p1 = { x: w.x2 + px * halfT, z: w.z2 + pz * halfT }
    let n1 = { x: w.x2 - px * halfT, z: w.z2 - pz * halfT }

    // Cap miter extension so a near-zero corner angle doesn't shoot miter
    // points off into infinity, but allow plenty of room for legitimate
    // acute corners (e.g. 30° walls) where the miter naturally extends
    // many wall-thicknesses past the centerline endpoint.
    const maxExt = 30 * Math.max(halfT, conn1?.wall.thickness ?? 0, conn2?.wall.thickness ?? 0)
    const inRangeOf = (mx: number, mz: number, ex: number, ez: number) =>
      Math.hypot(mx - ex, mz - ez) < maxExt

    // L-corner miter — fully derived from the local corner geometry, no
    // global "interior" assumptions. Inputs:
    //   • faceX/Z: this wall's face line origin (perpendicular face point)
    //   • facePerpX/Z: the perpendicular offset direction for THIS face
    //     (which side of our centerline the face sits on)
    //   • endSign: +1 if mitering at our END, -1 if at START
    // The "inside of the L" is the side where both walls' bodies lie. Our
    // face is "inside" iff its perp offset has positive dot with the bisector
    // of the two bodies; otherwise it's "outside". The matching cFace on
    // the connected wall is on the same side (inside↔inside, outside↔outside).
    const lcornerMiter = (
      faceX: number, faceZ: number,
      facePerpX: number, facePerpZ: number,
      conn: GarageWall, epx: number, epz: number, endSign: number,
    ) => {
      const cLen = wallLen(conn)
      if (cLen < 0.5) return null
      const [cdx, cdz] = wallDir(conn)
      const cpx = -cdz, cpz = cdx
      const cHT = conn.thickness / 2
      const ourBodyX = -endSign * dx, ourBodyZ = -endSign * dz
      const connStartIsCorner = Math.hypot(conn.x1 - epx, conn.z1 - epz) < 2
      const connSign = connStartIsCorner ? +1 : -1
      const connBodyX = connSign * cdx, connBodyZ = connSign * cdz
      // Inside-of-L bisector (averaged body directions). Falls back to
      // perpendicular of our wall toward conn's body for near-straight runs.
      let biX = ourBodyX + connBodyX, biZ = ourBodyZ + connBodyZ
      const blen = Math.hypot(biX, biZ)
      if (blen < 0.01) {
        const px = -dz, pz = dx
        const sgn = (px * connBodyX + pz * connBodyZ) >= 0 ? 1 : -1
        biX = px * sgn; biZ = pz * sgn
      } else {
        biX /= blen; biZ /= blen
      }
      // Classify our face: positive dot with bisector → interior side of L.
      const faceOnInside = (facePerpX * biX + facePerpZ * biZ) >= 0
      const wantDirX = faceOnInside ? biX : -biX
      const wantDirZ = faceOnInside ? biZ : -biZ
      // Extension tiebreaker for perpendicular corners (sideScore ties at 0):
      // interior retracts back along wallDir; exterior extends past endpoint.
      const extSign = (faceOnInside ? -1 : +1) * endSign
      let best: { x: number; z: number } | null = null
      let bestScore = -Infinity
      for (const cSide of [+1, -1] as const) {
        const cFaceX = epx + cpx * cHT * cSide
        const cFaceZ = epz + cpz * cHT * cSide
        const t = intersectT(faceX, faceZ, dx, dz, cFaceX, cFaceZ, cdx, cdz)
        if (isNaN(t)) continue
        const ix = faceX + t * dx
        const iz = faceZ + t * dz
        const sideScore = (ix - epx) * wantDirX + (iz - epz) * wantDirZ
        const extScore  = ((ix - epx) * dx + (iz - epz) * dz) * extSign
        const score = sideScore + extScore
        if (score > bestScore) { bestScore = score; best = { x: ix, z: iz } }
      }
      return best
    }
    const tjunctionMiter = (faceX: number, faceZ: number, conn: GarageWall, epx: number, epz: number, bodyDirX: number, bodyDirZ: number) => {
      const [cdx, cdz] = wallDir(conn)
      const cpx = -cdz, cpz = cdx
      const cHT = conn.thickness / 2
      const cSide = (cpx * bodyDirX + cpz * bodyDirZ) >= 0 ? +1 : -1
      const fx = epx + cpx * cHT * cSide
      const fz = epz + cpz * cHT * cSide
      const t = intersectT(faceX, faceZ, dx, dz, fx, fz, cdx, cdz)
      if (isNaN(t)) return null
      return { x: faceX + t * dx, z: faceZ + t * dz }
    }

    if (conn1) {
      if (conn1.kind === 'corner') {
        const mP = lcornerMiter(p0.x, p0.z, +px, +pz, conn1.wall, w.x1, w.z1, -1)
        const mN = lcornerMiter(n0.x, n0.z, -px, -pz, conn1.wall, w.x1, w.z1, -1)
        if (mP && inRangeOf(mP.x, mP.z, w.x1, w.z1)) p0 = mP
        if (mN && inRangeOf(mN.x, mN.z, w.x1, w.z1)) n0 = mN
      } else {
        const mP = tjunctionMiter(p0.x, p0.z, conn1.wall, w.x1, w.z1, dx, dz)
        const mN = tjunctionMiter(n0.x, n0.z, conn1.wall, w.x1, w.z1, dx, dz)
        if (mP && inRangeOf(mP.x, mP.z, w.x1, w.z1)) p0 = mP
        if (mN && inRangeOf(mN.x, mN.z, w.x1, w.z1)) n0 = mN
      }
    }
    if (conn2) {
      if (conn2.kind === 'corner') {
        const mP = lcornerMiter(p1.x, p1.z, +px, +pz, conn2.wall, w.x2, w.z2, +1)
        const mN = lcornerMiter(n1.x, n1.z, -px, -pz, conn2.wall, w.x2, w.z2, +1)
        if (mP && inRangeOf(mP.x, mP.z, w.x2, w.z2)) p1 = mP
        if (mN && inRangeOf(mN.x, mN.z, w.x2, w.z2)) n1 = mN
      } else {
        const mP = tjunctionMiter(p1.x, p1.z, conn2.wall, w.x2, w.z2, -dx, -dz)
        const mN = tjunctionMiter(n1.x, n1.z, conn2.wall, w.x2, w.z2, -dx, -dz)
        if (mP && inRangeOf(mP.x, mP.z, w.x2, w.z2)) p1 = mP
        if (mN && inRangeOf(mN.x, mN.z, w.x2, w.z2)) n1 = mN
      }
    }
    wallOutlines.set(w.id, { p0, p1, n0, n1, pIsInterior })
  }

  // ── Group cabinets by nearest wall (must face the wall) ──
  const cabsByWall = new Map<string, PlacedCabinet[]>()
  for (const cab of cabinets) {
    let bestWall: GarageWall | null = null
    let bestDist = Infinity
    for (const w of walls) {
      const len = wallLen(w)
      if (len < 6) continue
      const [dx, dz] = wallDir(w)
      const vx = cab.x - w.x1, vz = cab.z - w.z1
      const along = vx * dx + vz * dz
      const perp = Math.abs(vx * (-dz) + vz * dx)
      if (along > -cab.w / 2 && along < len + cab.w / 2 && perp < bestDist) {
        // Check cabinet faces this wall (rotation within 45°)
        const expectedRotY = Math.atan2(-dz, dx)
        let diff = Math.abs(cab.rotY - expectedRotY) % (Math.PI * 2)
        if (diff > Math.PI) diff = Math.PI * 2 - diff
        if (diff < Math.PI / 4) {
          bestDist = perp
          bestWall = w
        }
      }
    }
    if (bestWall && bestDist < bestWall.thickness / 2 + cab.d + 20) {
      const arr = cabsByWall.get(bestWall.id) || []
      arr.push(cab)
      cabsByWall.set(bestWall.id, arr)
    }
  }

  // ── Helper: compute outward direction for a wall (exterior side) ──
  // Uses point-in-polygon test: step perpendicular from wall midpoint,
  // the side that lands OUTSIDE the floor polygon is the exterior.
  function outwardDir(w: GarageWall): [number, number] {
    const [wdx, wdz] = wallDir(w)
    const perpX = -wdz, perpZ = wdx
    const wallMx = (w.x1 + w.x2) / 2, wallMz = (w.z1 + w.z2) / 2
    const testDist = w.thickness / 2 + 4 // step just past the wall face

    if (floorPoints.length >= 3) {
      const p1In = pointInFloor(wallMx + perpX * testDist, wallMz + perpZ * testDist)
      const p2In = pointInFloor(wallMx - perpX * testDist, wallMz - perpZ * testDist)
      // Outward = the side NOT inside the floor polygon
      if (p1In && !p2In) return [-perpX, -perpZ]
      if (!p1In && p2In) return [perpX, perpZ]
      // Both inside (interior partition) or both outside: fall through to centroid
    }

    // Fallback: away from garage center
    const toCx = cx - wallMx, toCz = cz - wallMz
    const dot = perpX * toCx + perpZ * toCz
    return dot > 0 ? [-perpX, -perpZ] : [perpX, perpZ]
  }

  // ── Render a single dimension line with tick marks and label ──
  function DimLine({ x1, y1, x2, y2, label, outX, outZ, color, fontSize, fontWeight }:
    { x1: number; y1: number; x2: number; y2: number; label: string;
      outX: number; outZ: number; color: string; fontSize: number; fontWeight: string }) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    const angle = readableAngle(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI)
    // Place text on the outward side of the dim line, clear of the line itself.
    const textOff = fontSize * 0.9
    const tx = mx + outX * textOff, ty = my + outZ * textOff

    return (
      <>
        {/* Dim line */}
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={0.5} />
        {/* Tick marks */}
        <line x1={x1 - outX * tk} y1={y1 - outZ * tk} x2={x1 + outX * tk} y2={y1 + outZ * tk} stroke={color} strokeWidth={0.5} />
        <line x1={x2 - outX * tk} y1={y2 - outZ * tk} x2={x2 + outX * tk} y2={y2 + outZ * tk} stroke={color} strokeWidth={0.5} />
        {/* Label */}
        <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle"
          fill={color} fontSize={fontSize} fontWeight={fontWeight}
          transform={`rotate(${angle} ${tx} ${ty})`}>
          {label}
        </text>
      </>
    )
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SVG_W} ${SVG_H}`}
      xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      {/* Background — clicking empty space deselects the current wall.
          Clicks on walls, cabinets, racks, etc. bubble from the child element,
          not from this rect, so those selections are unaffected. */}
      <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#ffffff"
        onClick={() => selectWall(null)} />

      {/* Tracing reference image — rendered BEHIND everything so the user can
          draw walls on top. Hidden in PDF export (showTracing=false). */}
      {showTracing && tracingImage && (() => {
        const img = tracingImage
        const halfW = img.widthIn / 2
        const halfH = img.heightIn / 2
        const x0 = sx(img.x - halfW), y0 = sz(img.z - halfH)
        const x1 = sx(img.x + halfW), y1 = sz(img.z + halfH)
        const startDrag = (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
          if (img.locked) return
          e.stopPropagation(); e.preventDefault()
          const pos = mouseToSvg(e)
          if (!pos) return
          tracingDragRef.current = {
            mode,
            startMouseX: pos.x, startMouseZ: pos.z,
            initX: img.x, initZ: img.z,
            initW: img.widthIn, initH: img.heightIn,
          }
          // Freeze the view bounds for the duration of the drag so the walls
          // don't reshuffle as the image moves/resizes.
          frozenBoundsRef.current = { minX, maxX, minZ, maxZ }
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        }
        const onMove = (e: React.PointerEvent) => {
          const td = tracingDragRef.current
          if (!td) return
          const pos = mouseToSvg(e); if (!pos) return
          const dx = pos.x - td.startMouseX
          const dz = pos.z - td.startMouseZ
          if (td.mode === 'move') {
            updateTracingImage({ x: td.initX + dx, z: td.initZ + dz })
          } else {
            // Corner drag — grow/shrink uniformly, preserve aspect ratio.
            const aspect = td.initH / td.initW
            // Use the larger of the two axis deltas so diagonal motion feels natural.
            const newW = Math.max(12, td.initW + dx * 2)
            const newH = newW * aspect
            updateTracingImage({ widthIn: newW, heightIn: newH })
          }
        }
        const onUp = (e: React.PointerEvent) => {
          tracingDragRef.current = null
          frozenBoundsRef.current = null
          try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
        }
        const pxW = x1 - x0, pxH = y1 - y0
        return (
          <g>
            <image
              href={img.dataUrl}
              x={x0} y={y0} width={pxW} height={pxH}
              preserveAspectRatio="none"
              opacity={img.opacity}
              pointerEvents="all"
              style={{ cursor: img.locked ? 'default' : 'grab' }}
              onPointerDown={startDrag('move')}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            />
            {!img.locked && (
              <>
                <rect x={x0} y={y0} width={pxW} height={pxH}
                  fill="none" stroke="#44aaff" strokeWidth={0.8} strokeDasharray="4 3"
                  pointerEvents="none" />
                <circle cx={x1} cy={y1} r={6}
                  fill="#44aaff" stroke="#fff" strokeWidth={1.2}
                  style={{ cursor: 'nwse-resize' }}
                  pointerEvents="all"
                  onPointerDown={startDrag('resize')}
                  onPointerMove={onMove}
                  onPointerUp={onUp}
                  onPointerCancel={onUp}
                />
              </>
            )}
          </g>
        )
      })()}

      {/* Floor steps — body polygons. Corner drag handles are rendered later
          (after walls, dimensions, etc.) so they sit on top of every other
          element and remain grabbable when a step overlaps a wall. */}
      {floorSteps.map(step => {
        const isSel = selectedFloorStepId === step.id
        const locked = !!step.locked
        // Bounding-box dims (axis-aligned). Width = X extent, Depth = Z extent.
        let minXc = Infinity, maxXc = -Infinity, minZc = Infinity, maxZc = -Infinity
        for (const [cx, cz] of step.corners) {
          if (cx < minXc) minXc = cx; if (cx > maxXc) maxXc = cx
          if (cz < minZc) minZc = cz; if (cz > maxZc) maxZc = cz
        }
        const stepW = maxXc - minXc
        const stepD = maxZc - minZc
        const cxMid = (minXc + maxXc) / 2
        const czMid = (minZc + maxZc) / 2
        return (
          <g key={step.id}>
            <polygon
              points={step.corners.map(([cx, cz]) => `${sx(cx)},${sz(cz)}`).join(' ')}
              fill={isSel ? 'rgba(180, 160, 110, 0.28)' : '#e0ddd8'}
              stroke={isSel ? '#b48a3a' : '#999'}
              strokeWidth={isSel ? 1.1 : 0.6}
              strokeDasharray="3,1.5"
              style={{ cursor: locked ? 'default' : 'move' }}
              onPointerDown={e => onStepBodyDown(e, step)}
              onPointerMove={onStepBodyMove}
              onPointerUp={onStepBodyUp}
              onPointerCancel={onStepBodyUp}
            />
            {/* Width centered along the top edge of the bbox; depth centered
                along the left edge, rotated 90°. Placed inside the step so it
                reads against the lighter step fill. */}
            <text x={sx(cxMid)} y={sz(minZc) + 6} textAnchor="middle" dominantBaseline="hanging"
              fontSize={3.5} fontWeight={600} fill="#6a5530"
              pointerEvents="none" style={{ userSelect: 'none' }}>
              {inchesToDisplay(stepW)}
            </text>
            <text x={sx(minXc) + 6} y={sz(czMid)} textAnchor="middle" dominantBaseline="middle"
              fontSize={3.5} fontWeight={600} fill="#6a5530"
              transform={`rotate(-90 ${sx(minXc) + 6} ${sz(czMid)})`}
              pointerEvents="none" style={{ userSelect: 'none' }}>
              {inchesToDisplay(stepD)}
            </text>
          </g>
        )
      })}

      {/* Grid — every 12" */}
      {(() => {
        const lines: JSX.Element[] = []
        const stepPx = 12 * scale
        const startX = sx(Math.ceil(minX / 12) * 12)
        const startZ = sz(Math.ceil(minZ / 12) * 12)
        for (let px = startX; px <= sx(maxX); px += stepPx) {
          lines.push(<line key={`gx${px}`} x1={px} y1={sz(minZ)} x2={px} y2={sz(maxZ)} stroke="#ececea" strokeWidth={0.35} />)
        }
        for (let pz = startZ; pz <= sz(maxZ); pz += stepPx) {
          lines.push(<line key={`gz${pz}`} x1={sx(minX)} y1={pz} x2={sx(maxX)} y2={pz} stroke="#ececea" strokeWidth={0.35} />)
        }
        return lines
      })()}

      {/* Walls — drawn as filled rectangles with proper corner joints */}
      {walls.map(w => {
        const outline = wallOutlines.get(w.id)
        if (!outline) return null
        const { p0, p1, n0, n1 } = outline
        const isSel = selectedWallId === w.id
        const strokeColor = isSel ? '#66aaff' : '#222'
        const strokeW = isSel ? 1.2 : 0.8
        const wallPoints = [
          `${sx(p0.x)},${sz(p0.z)}`,
          `${sx(p1.x)},${sz(p1.z)}`,
          `${sx(n1.x)},${sz(n1.z)}`,
          `${sx(n0.x)},${sz(n0.z)}`,
        ].join(' ')
        return (
          <g key={w.id}>
            <polygon points={wallPoints}
              fill={isSel ? 'rgba(102,170,255,0.15)' : '#ffffff'}
              stroke={strokeColor} strokeWidth={strokeW}
              strokeLinejoin="miter"
              style={{ cursor: 'move' }}
              onPointerDown={e => onWallBodyPointerDown(e, w)}
              onPointerMove={onWallBodyPointerMove}
              onPointerUp={onWallBodyPointerUp}
              onPointerCancel={onWallBodyPointerUp} />
          </g>
        )
      })}

      {/* Openings (doors, windows, garage doors) — blueprint-style symbols
          overlaid on the walls. Each opening gets a white cover that erases
          the wall face lines across its span, perpendicular jamb lines at
          each edge, a type-specific symbol (door swing arc / window mullion /
          garage-door dashed line), and a width label above the exterior face.
          Opening width labels also appear in the dim tier below. */}
      {walls.flatMap(w => {
        const len = wallLen(w)
        if (len < 0.5) return []
        const [dx, dz] = wallDir(w)
        const halfT = w.thickness / 2
        const perpX = -dz, perpZ = dx
        // Interior-facing perpendicular (points toward garage center).
        const [nx, nz] = wallNormal(w)
        const intSign = (perpX * nx + perpZ * nz) > 0 ? 1 : -1

        return w.openings.map(op => {
          const a0 = op.xOffset
          const a1 = op.xOffset + op.width
          // Opening corners on the wall face lines (inches, world).
          const pA0 = { x: w.x1 + dx * a0 + perpX * halfT, z: w.z1 + dz * a0 + perpZ * halfT }
          const pA1 = { x: w.x1 + dx * a1 + perpX * halfT, z: w.z1 + dz * a1 + perpZ * halfT }
          const nA0 = { x: w.x1 + dx * a0 - perpX * halfT, z: w.z1 + dz * a0 - perpZ * halfT }
          const nA1 = { x: w.x1 + dx * a1 - perpX * halfT, z: w.z1 + dz * a1 - perpZ * halfT }
          // Interior/exterior corners (picked per-wall by intSign).
          const intStart = intSign > 0 ? pA0 : nA0
          const intEnd   = intSign > 0 ? pA1 : nA1
          const extStart = intSign > 0 ? nA0 : pA0
          const extEnd   = intSign > 0 ? nA1 : pA1
          // Unit interior-normal (direction into the garage).
          const nxIn = perpX * intSign, nzIn = perpZ * intSign

          // White cutout polygon — erases the wall face lines across this opening.
          const coverPts = [pA0, pA1, nA1, nA0]
            .map(p => `${sx(p.x)},${sz(p.z)}`).join(' ')

          // Blueprint symbol per opening type.
          let symbol: JSX.Element | null = null
          if (op.type === 'door') {
            // Door leaf perpendicular to the wall, swing arc back to the far
            // jamb on the same side. `swingSide` chooses interior (default)
            // or exterior of the wall.
            const side = op.swingSide ?? 'interior'
            const hinge = side === 'exterior' ? extStart : intStart
            const far   = side === 'exterior' ? extEnd   : intEnd
            const nxS = side === 'exterior' ? -nxIn : nxIn
            const nzS = side === 'exterior' ? -nzIn : nzIn
            const tipX = hinge.x + nxS * op.width
            const tipZ = hinge.z + nzS * op.width
            const startAng = Math.atan2(nzS, nxS)
            const endAng = Math.atan2(far.z - hinge.z, far.x - hinge.x)
            let delta = endAng - startAng
            while (delta > Math.PI) delta -= 2 * Math.PI
            while (delta < -Math.PI) delta += 2 * Math.PI
            const STEPS = 14
            const arcPts: string[] = []
            for (let i = 0; i <= STEPS; i++) {
              const t = i / STEPS
              const a = startAng + delta * t
              arcPts.push(`${sx(hinge.x + op.width * Math.cos(a))},${sz(hinge.z + op.width * Math.sin(a))}`)
            }
            symbol = (
              <>
                <line x1={sx(hinge.x)} y1={sz(hinge.z)} x2={sx(tipX)} y2={sz(tipZ)}
                  stroke="#222" strokeWidth={0.8} />
                <polyline points={arcPts.join(' ')}
                  fill="none" stroke="#222" strokeWidth={0.4} strokeDasharray="2 1.5" />
              </>
            )
          } else if (op.type === 'window') {
            // Three parallel lines across the opening: both wall faces + a
            // center line representing the glazing plane.
            const midStart = { x: (pA0.x + nA0.x) / 2, z: (pA0.z + nA0.z) / 2 }
            const midEnd   = { x: (pA1.x + nA1.x) / 2, z: (pA1.z + nA1.z) / 2 }
            symbol = (
              <>
                <line x1={sx(pA0.x)} y1={sz(pA0.z)} x2={sx(pA1.x)} y2={sz(pA1.z)}
                  stroke="#222" strokeWidth={0.5} />
                <line x1={sx(nA0.x)} y1={sz(nA0.z)} x2={sx(nA1.x)} y2={sz(nA1.z)}
                  stroke="#222" strokeWidth={0.5} />
                <line x1={sx(midStart.x)} y1={sz(midStart.z)} x2={sx(midEnd.x)} y2={sz(midEnd.z)}
                  stroke="#222" strokeWidth={0.5} />
              </>
            )
          } else if (op.type === 'garage-door') {
            // Bold dashed line on the exterior face represents the closed door
            // panel. A lighter dashed line on the interior face indicates the
            // track/header.
            symbol = (
              <>
                <line x1={sx(extStart.x)} y1={sz(extStart.z)} x2={sx(extEnd.x)} y2={sz(extEnd.z)}
                  stroke="#222" strokeWidth={1.2} strokeDasharray="4 2" />
                <line x1={sx(intStart.x)} y1={sz(intStart.z)} x2={sx(intEnd.x)} y2={sz(intEnd.z)}
                  stroke="#888" strokeWidth={0.4} strokeDasharray="1 1.5" />
              </>
            )
          }

          // Width is dimensioned in the outside dim tier below — no inline
          // label here (avoids the stacked/overlapping labels when the tier
          // label lands right next to the opening).

          return (
            <g key={`op-${op.id}`}>
              <polygon points={coverPts} fill="#ffffff" stroke="none" pointerEvents="none" />
              {/* Jambs at each edge */}
              <line x1={sx(pA0.x)} y1={sz(pA0.z)} x2={sx(nA0.x)} y2={sz(nA0.z)}
                stroke="#222" strokeWidth={0.8} pointerEvents="none" />
              <line x1={sx(pA1.x)} y1={sz(pA1.z)} x2={sx(nA1.x)} y2={sz(nA1.z)}
                stroke="#222" strokeWidth={0.8} pointerEvents="none" />
              <g pointerEvents="none">{symbol}</g>
              {/* Transparent hit rect over the opening — sliding a door
                  along its wall (xOffset). Skips the rest of the visual
                  so it doesn't block clicks on other entities. */}
              <polygon points={coverPts}
                fill="transparent"
                style={{ cursor: w.locked ? 'default' : 'move' }}
                onPointerDown={e => onOpeningDown(e, w, op)}
                onPointerMove={onOpeningMove}
                onPointerUp={onOpeningUp}
                onPointerCancel={onOpeningUp}
              />
            </g>
          )
        })
      })}

      {/* Slatwall panels — shown as thin strips along the wall interior */}
      {slatwallPanels.map(panel => {
        const w = walls.find(wl => wl.id === panel.wallId)
        if (!w) return null
        const [wdx, wdz] = wallDir(w)
        // Inward perpendicular (toward garage center)
        const perpX = -wdz, perpZ = wdx
        const wallMx = (w.x1 + w.x2) / 2, wallMz = (w.z1 + w.z2) / 2
        const toCx = cx - wallMx, toCz = cz - wallMz
        const dot = perpX * toCx + perpZ * toCz
        let inX = dot >= 0 ? perpX : -perpX
        let inZ = dot >= 0 ? perpZ : -perpZ
        // Flip for exterior panels
        if ((panel.side ?? 'interior') === 'exterior') { inX = -inX; inZ = -inZ }

        // Panel start/end along the wall, offset to face
        const halfT = w.thickness / 2
        const p1x = w.x1 + wdx * panel.alongStart + inX * halfT
        const p1z = w.z1 + wdz * panel.alongStart + inZ * halfT
        const p2x = w.x1 + wdx * panel.alongEnd + inX * halfT
        const p2z = w.z1 + wdz * panel.alongEnd + inZ * halfT
        // Extend outward from wall face by slatwall depth
        const d = SLATWALL_DEPTH
        const points = [
          `${sx(p1x)},${sz(p1z)}`,
          `${sx(p2x)},${sz(p2z)}`,
          `${sx(p2x + inX * d)},${sz(p2z + inZ * d)}`,
          `${sx(p1x + inX * d)},${sz(p1z + inZ * d)}`,
        ].join(' ')

        return (
          <polygon key={panel.id} points={points}
            fill="#c8d0d8" stroke="#889" strokeWidth={0.4} opacity={0.7} />
        )
      })}

      {/* Stainless steel backsplash panels — thin strip along wall interior */}
      {stainlessBacksplashPanels.map(panel => {
        const w = walls.find(wl => wl.id === panel.wallId)
        if (!w) return null
        const [wdx, wdz] = wallDir(w)
        const perpX = -wdz, perpZ = wdx
        const wallMx = (w.x1 + w.x2) / 2, wallMz = (w.z1 + w.z2) / 2
        const toCx = cx - wallMx, toCz = cz - wallMz
        const dot = perpX * toCx + perpZ * toCz
        let inX = dot >= 0 ? perpX : -perpX
        let inZ = dot >= 0 ? perpZ : -perpZ
        if ((panel.side ?? 'interior') === 'exterior') { inX = -inX; inZ = -inZ }

        const halfT = w.thickness / 2
        const p1x = w.x1 + wdx * panel.alongStart + inX * halfT
        const p1z = w.z1 + wdz * panel.alongStart + inZ * halfT
        const p2x = w.x1 + wdx * panel.alongEnd + inX * halfT
        const p2z = w.z1 + wdz * panel.alongEnd + inZ * halfT
        // Render at 1" visual depth (real thickness 1/8" is too thin to see on plan)
        const d = 1
        const points = [
          `${sx(p1x)},${sz(p1z)}`,
          `${sx(p2x)},${sz(p2z)}`,
          `${sx(p2x + inX * d)},${sz(p2z + inZ * d)}`,
          `${sx(p1x + inX * d)},${sz(p1z + inZ * d)}`,
        ].join(' ')

        return (
          <polygon key={panel.id} points={points}
            fill="#d8dce0" stroke="#667" strokeWidth={0.5} opacity={0.9} />
        )
      })}

      {/* Cabinet footprints — draggable along their wall */}
      {cabinets.map(cab => {
        const hw = (cab.w * scale) / 2
        const hd = (cab.d * scale) / 2
        const deg = -(cab.rotY * 180) / Math.PI
        const isSel = selectedCabinetId === cab.id
        return (
          <g key={cab.id} transform={`translate(${sx(cab.x)},${sz(cab.z)}) rotate(${deg})`}
             style={{ cursor: cab.locked ? 'default' : 'grab' }}
             onPointerDown={(e) => onCabPointerDown(e, cab)}
             onPointerMove={onCabPointerMove}
             onPointerUp={onCabPointerUp}
             onPointerCancel={onCabPointerUp}>
            <rect x={-hw} y={-hd} width={cab.w * scale} height={cab.d * scale}
              fill={isSel ? '#d0e8ff' : '#e8e8e5'}
              stroke={isSel ? '#2d7bea' : '#444'}
              strokeWidth={isSel ? 1.2 : 0.4} />
          </g>
        )
      })}

      {/* Countertop footprints */}
      {countertops.map(ct => {
        const hw = (ct.width * scale) / 2
        const hd = (COUNTERTOP_DEPTH * scale) / 2
        const deg = -(ct.rotY * 180) / Math.PI
        return (
          <g key={ct.id} transform={`translate(${sx(ct.x)},${sz(ct.z)}) rotate(${deg})`}>
            <rect x={-hw} y={-hd} width={ct.width * scale} height={COUNTERTOP_DEPTH * scale}
              fill="#ddd8cc" stroke="#666" strokeWidth={0.4} opacity={0.7} />
          </g>
        )
      })}

      {/* Baseboard footprints — thin rectangles along walls */}
      {baseboards.map(bb => {
        const hw = (bb.length * scale) / 2
        const hd = (bb.thickness * scale) / 2
        const deg = -(bb.rotY * 180) / Math.PI
        return (
          <g key={bb.id} transform={`translate(${sx(bb.x)},${sz(bb.z)}) rotate(${deg})`}>
            <rect x={-hw} y={-hd} width={bb.length * scale} height={bb.thickness * scale}
              fill={bb.color} stroke="#444" strokeWidth={0.3} opacity={0.85} />
          </g>
        )
      })}

      {/* Stem wall footprints — slightly inset into wall, dashed outline */}
      {stemWalls.map(sw => {
        const hw = (sw.length * scale) / 2
        const hd = (sw.thickness * scale) / 2
        const deg = -(sw.rotY * 180) / Math.PI
        return (
          <g key={sw.id} transform={`translate(${sx(sw.x)},${sz(sw.z)}) rotate(${deg})`}>
            <rect x={-hw} y={-hd} width={sw.length * scale} height={sw.thickness * scale}
              fill={sw.color} stroke="#444" strokeWidth={0.3}
              strokeDasharray="2 1" opacity={0.7} />
          </g>
        )
      })}

      {/* ══════════════════════════════════════════════════════════════════════
          DIMENSION SYSTEM — Two tiers per wall, outward from garage center
          Tier 1 (inner):  Overall wall length
          Tier 2 (outer):  Cabinet breakdown — gaps + cab widths
         ══════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const dims: JSX.Element[] = []
        // Tier offsets tightened to compact the drawing; label sits right on line.
        const TIER_STEP = 8
        const TIER_BASE = 6
        // Unified dim font — matches wall elevation view.
        // Reduced 30% (was 5) so the dim-tier labels sit tighter against the walls.
        const fsDim = 3.5
        const fsSeg = 3.5

        // Pack strips onto as few tiers as possible using greedy interval
        // scheduling. Each tier is a list of non-overlapping [start,end] strips.
        type Strip = { start: number; end: number; label: string; bold: boolean; color: string }
        const packIntoTiers = (strips: Strip[]): Strip[][] => {
          const sorted = [...strips].sort((a, b) => a.start - b.start)
          const tiers: Strip[][] = []
          for (const s of sorted) {
            let placed = false
            for (const tier of tiers) {
              const last = tier[tier.length - 1]
              if (last.end <= s.start + 0.1) {
                tier.push(s)
                placed = true
                break
              }
            }
            if (!placed) tiers.push([s])
          }
          return tiers
        }

        for (const w of walls) {
          const len = wallLen(w)
          if (len < 6) continue

          const [outX, outZ] = outwardDir(w)
          const [wdx, wdz] = wallDir(w)
          const { trim1, trim2, interior, ifx1, ifz1, ifx2, ifz2 } = interiorLen(w)
          const iStart = trim1
          const iEnd = len - trim2

          // Collect all dimension tiers for this wall in order (innermost first).
          const tierStrips: Strip[][] = []

          // ── Cabinets + gaps tier (breakdown along wall) ──
          const wCabs = cabsByWall.get(w.id) ?? []
          if (wCabs.length > 0) {
            const items = wCabs.map(c => ({
              start: (c.x - w.x1) * wdx + (c.z - w.z1) * wdz - c.w / 2,
              end:   (c.x - w.x1) * wdx + (c.z - w.z1) * wdz + c.w / 2,
            })).sort((a, b) => a.start - b.start)

            const segs: Strip[] = []
            if (items[0].start - iStart > 1) {
              segs.push({ start: iStart, end: items[0].start, label: inchesToDisplay(items[0].start - iStart), bold: false, color: dimColorLight })
            }
            for (let i = 0; i < items.length; i++) {
              const it = items[i]
              segs.push({ start: it.start, end: it.end, label: 'CAB ' + inchesToDisplay(it.end - it.start), bold: true, color: '#333' })
              if (i < items.length - 1) {
                const gs = items[i].end, ge = items[i + 1].start
                if (ge - gs > 1) {
                  segs.push({ start: gs, end: ge, label: inchesToDisplay(ge - gs), bold: false, color: dimColorLight })
                }
              }
            }
            const lastEnd = items[items.length - 1].end
            if (iEnd - lastEnd > 1) {
              segs.push({ start: lastEnd, end: iEnd, label: inchesToDisplay(iEnd - lastEnd), bold: false, color: dimColorLight })
            }
            tierStrips.push(segs)
          }


          // ── Slatwall strip: full wall span with SW segments + gaps where
          // there's no slatwall. Backsplash is intentionally not dimensioned.
          const wPanels = slatwallPanels.filter(p => p.wallId === w.id)
            .map(p => ({
              start: Math.max(iStart, p.alongStart),
              end:   Math.min(iEnd,   p.alongEnd),
            }))
            .filter(p => p.end - p.start > 0.5)
            .sort((a, b) => a.start - b.start)
          if (wPanels.length > 0) {
            const slatSegs: Strip[] = []
            if (wPanels[0].start - iStart > 1) {
              slatSegs.push({ start: iStart, end: wPanels[0].start, label: inchesToDisplay(wPanels[0].start - iStart), bold: false, color: dimColorLight })
            }
            for (let i = 0; i < wPanels.length; i++) {
              const p = wPanels[i]
              slatSegs.push({ start: p.start, end: p.end, label: 'SW ' + inchesToDisplay(p.end - p.start), bold: true, color: '#1d6f3d' })
              if (i < wPanels.length - 1) {
                const gs = p.end, ge = wPanels[i + 1].start
                if (ge - gs > 1) {
                  slatSegs.push({ start: gs, end: ge, label: inchesToDisplay(ge - gs), bold: false, color: dimColorLight })
                }
              }
            }
            const lastEnd = wPanels[wPanels.length - 1].end
            if (iEnd - lastEnd > 1) {
              slatSegs.push({ start: lastEnd, end: iEnd, label: inchesToDisplay(iEnd - lastEnd), bold: false, color: dimColorLight })
            }
            tierStrips.push(slatSegs)
          }

          // ── Openings tier: labeled segments for each door / window /
          // garage-door plus the gaps between them. All three opening types
          // land on the same tier, distinguished by prefix and color.
          const wOpenings = w.openings
          if (wOpenings.length > 0) {
            const OP_PREFIX: Record<string, { prefix: string; color: string }> = {
              'door':        { prefix: 'DOOR ',   color: '#b22' },
              'window':      { prefix: 'WINDOW ', color: '#247' },
              'garage-door': { prefix: 'GD ',     color: '#742' },
            }
            const items = wOpenings.map(op => {
              const ext = (op.modelId === 'custom-plain' || op.modelId === 'custom-double') ? 2.5 : 0
              const meta = OP_PREFIX[op.type] ?? { prefix: '', color: '#333' }
              return {
                start: Math.max(iStart, op.xOffset - ext),
                end:   Math.min(iEnd,   op.xOffset + op.width + ext),
                prefix: meta.prefix,
                color: meta.color,
              }
            }).filter(p => p.end - p.start > 0.5)
              .sort((a, b) => a.start - b.start)
            if (items.length > 0) {
              const opSegs: Strip[] = []
              if (items[0].start - iStart > 1) {
                opSegs.push({ start: iStart, end: items[0].start,
                  label: inchesToDisplay(items[0].start - iStart),
                  bold: false, color: dimColorLight })
              }
              for (let i = 0; i < items.length; i++) {
                const it = items[i]
                opSegs.push({ start: it.start, end: it.end,
                  label: it.prefix + inchesToDisplay(it.end - it.start),
                  bold: true, color: it.color })
                if (i < items.length - 1) {
                  const gs = items[i].end, ge = items[i + 1].start
                  if (ge - gs > 1) {
                    opSegs.push({ start: gs, end: ge,
                      label: inchesToDisplay(ge - gs),
                      bold: false, color: dimColorLight })
                  }
                }
              }
              const lastEnd = items[items.length - 1].end
              if (iEnd - lastEnd > 1) {
                opSegs.push({ start: lastEnd, end: iEnd,
                  label: inchesToDisplay(iEnd - lastEnd),
                  bold: false, color: dimColorLight })
              }
              tierStrips.push(opSegs)
            }
          }

          // Overall wall length is always the outermost tier. Add the wall
          // thickness so the dim line sits outside the wall body — the witness
          // is anchored at the INTERIOR face and has to traverse the wall.
          const tierCount = tierStrips.length + 1
          const overallOff = w.thickness + TIER_BASE + TIER_STEP * (tierCount - 1)
          // Witness lines start at the EXTERIOR wall face (with a small visible
          // gap), not at the interior face — otherwise they cut through the
          // wall body. Inner tier strips are anchored to the wall centerline,
          // so add the wall half-thickness + gap to push them past the
          // exterior face. `WIT_GAP` is the visible space between the wall
          // edge and the start of the witness/dim lines.
          const WIT_GAP = 4
          const halfT = w.thickness / 2

          // Overall wall dimension line — anchored to the INTERIOR mitered
          // polygon corners (from wallOutlines). The dimension reads the
          // inside-face length of the wall (corner to corner along the
          // interior surface), which is what cabinet/build planning needs.
          // The witness lines drop OUTWARD from those interior corners,
          // crossing the wall body to the dim tier outside.
          const ol = wallOutlines.get(w.id)
          const intStart = ol ? (ol.pIsInterior ? ol.p0 : ol.n0) : { x: w.x1, z: w.z1 }
          const intEnd   = ol ? (ol.pIsInterior ? ol.p1 : ol.n1) : { x: w.x2, z: w.z2 }
          const ix1s = sx(intStart.x) + outX * WIT_GAP, iz1s = sz(intStart.z) + outZ * WIT_GAP
          const ix2s = sx(intEnd.x)   + outX * WIT_GAP, iz2s = sz(intEnd.z)   + outZ * WIT_GAP
          dims.push(
            <g key={`tover-${w.id}`}>
              <line x1={ix1s} y1={iz1s} x2={ix1s + outX * (overallOff + 4)} y2={iz1s + outZ * (overallOff + 4)}
                stroke={dimColor} strokeWidth={0.3} strokeDasharray="3 2" />
              <line x1={ix2s} y1={iz2s} x2={ix2s + outX * (overallOff + 4)} y2={iz2s + outZ * (overallOff + 4)}
                stroke={dimColor} strokeWidth={0.3} strokeDasharray="3 2" />
              <DimLine x1={ix1s + outX * overallOff} y1={iz1s + outZ * overallOff}
                x2={ix2s + outX * overallOff} y2={iz2s + outZ * overallOff}
                label={'WALL ' + inchesToDisplay(interior)} outX={outX} outZ={outZ}
                color={textColor} fontSize={fsDim} fontWeight="700" />
            </g>
          )

          // Inner tiers: render each strip with witness lines at its endpoints.
          // Strip endpoints are wall-centerline positions; offset outward by
          // halfT + WIT_GAP so witness lines start clear of the wall.
          const stripBase = halfT + WIT_GAP
          for (let ti = 0; ti < tierStrips.length; ti++) {
            const off = stripBase + TIER_BASE + TIER_STEP * ti
            const strips = tierStrips[ti]
            for (let si = 0; si < strips.length; si++) {
              const s = strips[si]
              const segLen = s.end - s.start
              if (segLen < 0.5) continue
              const s1x = w.x1 + wdx * s.start, s1z = w.z1 + wdz * s.start
              const s2x = w.x1 + wdx * s.end,   s2z = w.z1 + wdz * s.end
              const witStart1X = sx(s1x) + outX * stripBase, witStart1Z = sz(s1z) + outZ * stripBase
              const witStart2X = sx(s2x) + outX * stripBase, witStart2Z = sz(s2z) + outZ * stripBase
              const sx1 = sx(s1x) + outX * off, sz1 = sz(s1z) + outZ * off
              const sx2 = sx(s2x) + outX * off, sz2 = sz(s2z) + outZ * off
              dims.push(
                <g key={`t${ti}-${w.id}-${si}`}>
                  <line x1={witStart1X} y1={witStart1Z} x2={sx(s1x) + outX * (off + 4)} y2={sz(s1z) + outZ * (off + 4)}
                    stroke={dimColorLight} strokeWidth={0.25} strokeDasharray="2 1.5" />
                  <line x1={witStart2X} y1={witStart2Z} x2={sx(s2x) + outX * (off + 4)} y2={sz(s2z) + outZ * (off + 4)}
                    stroke={dimColorLight} strokeWidth={0.25} strokeDasharray="2 1.5" />
                  <DimLine x1={sx1} y1={sz1} x2={sx2} y2={sz2}
                    label={s.label} outX={outX} outZ={outZ}
                    color={s.color} fontSize={fsSeg} fontWeight={s.bold ? '700' : '500'} />
                </g>
              )
            }
          }
        }

        return dims
      })()}

      {/* ── Rack snap indicator lines ── */}
      {rackSnap && rackDragRef.current && (
        <g pointerEvents="none">
          {rackSnap.snapAxis === 'x' && rackSnap.snapEdge != null && (
            <line x1={sx(rackSnap.snapEdge)} y1={sz(minZ)} x2={sx(rackSnap.snapEdge)} y2={sz(maxZ)}
              stroke="#4488ff" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} />
          )}
          {rackSnap.snapAxis === 'z' && rackSnap.snapEdge != null && (
            <line x1={sx(minX)} y1={sz(rackSnap.snapEdge)} x2={sx(maxX)} y2={sz(rackSnap.snapEdge)}
              stroke="#4488ff" strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} />
          )}
          {rackSnap.snapAxis === undefined && rackSnap.snappedWallId && (
            <>
              <circle cx={sx(rackSnap.x)} cy={sz(rackSnap.z)} r={3}
                fill="none" stroke="#4488ff" strokeWidth={1} opacity={0.8} />
            </>
          )}
        </g>
      )}

      {/* ── Placed 3D items (cars, equipment, etc.) — top-down silhouettes ──
          Each model's GLB is loaded once, projected to XZ, hulled, and the
          normalized polygon is rendered scaled to the item's dims. While the
          hull is loading we show a dashed rectangle as a fallback so the
          item is still visible. */}
      {items.map(item => {
        const isImported = item.type.startsWith('imported:')
        const importedAssetId = isImported ? item.type.replace('imported:', '') : null
        const def = !isImported ? MODEL_CATALOG.find(m => m.type === item.type) : null
        const asset = importedAssetId ? importedAssets.find(a => a.id === importedAssetId) : null
        const baseW = def?.w ?? asset?.w ?? 72
        const baseD = def?.d ?? asset?.d ?? 144
        const baseH = def?.h ?? asset?.h ?? 54
        let w = baseW * (item.scale?.[0] ?? 1)
        let d = baseD * (item.scale?.[2] ?? 1)
        let hIn = baseH * (item.scale?.[1] ?? 1)
        const cxIn = item.position[0] * 12
        const czIn = item.position[2] * 12
        const rotY = item.rotation?.[1] ?? 0
        const category = def?.category ?? asset?.modelCategory ?? 'car'
        const stroke = CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] ?? '#444'

        // Resolve the GLB url + cache key. Catalog models live at
        // /assets/models/{type}.glb; imported assets use the cached blob URL
        // (restored from IndexedDB on demand).
        const cacheKey = isImported ? `imported:${importedAssetId}` : `catalog:${item.type}`
        let url: string | undefined
        if (isImported && importedAssetId) {
          url = getCachedModelUrl(importedAssetId)
          if (!url) {
            // Kick off restore — when it lands the cache subscription fires
            // a re-render and we'll have the URL on the next pass.
            restoreModelFromDB(importedAssetId).catch(() => {})
          }
        } else if (!isImported) {
          url = `${import.meta.env.BASE_URL}assets/models/${item.type}.glb`
        }

        let hull = getCachedHull(cacheKey)
        if (hull === undefined && url) loadHull(cacheKey, url)

        // Build the silhouette points, or fall back to a rectangle.
        const cos = Math.cos(rotY), sin = Math.sin(rotY)
        const place = (lx: number, lz: number): [number, number] => [
          cxIn + lx * cos - lz * sin,
          czIn + lx * sin + lz * cos,
        ]
        const longest = Math.max(w, d)
        const isFallback = !hull
        const isSel = selectedItemId === item.id
        // Drag handlers — translate the item's position (stored in feet) by
        // the cursor's delta in inches converted to feet.
        const onItemDown = (e: React.PointerEvent) => {
          e.stopPropagation()
          e.preventDefault()
          selectItem(item.id)
          const pos = mouseToSvg(e)
          if (!pos) return
          itemDragRef.current = {
            itemId: item.id,
            startMouseX: pos.x, startMouseZ: pos.z,
            initFx: item.position[0], initFz: item.position[2],
          }
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        }
        const onItemMove = (e: React.PointerEvent) => {
          const id = itemDragRef.current
          if (!id || id.itemId !== item.id) return
          const pos = mouseToSvg(e)
          if (!pos) return
          const dxIn = pos.x - id.startMouseX
          const dzIn = pos.z - id.startMouseZ
          updateItem(item.id, {
            position: [id.initFx + dxIn / 12, item.position[1], id.initFz + dzIn / 12],
          })
        }
        const onItemUp = (e: React.PointerEvent) => {
          itemDragRef.current = null
          try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
        }
        // Render the cached PNG snapshot as a single SVG <image>. The
        // displayed footprint must match what the 3D view actually renders.
        if (hull?.snapshotDataUrl) {
          // Two scaling modes — the floor plan matches whichever the 3D
          // view uses for this item:
          //   • Imported assets: ImportedGLBModelInner scales the GLB so its
          //     longest 3D dim = CATEGORY_TARGET_FT[category]. We replicate
          //     that here so the floor plan footprint equals the actual 3D
          //     footprint, regardless of asset.w/d/h placeholders.
          //   • Catalog models: GLBModel scales so longest 3D dim = max(w,h,d)
          //     in feet, with native model proportions on the other axes.
          let footprintW: number
          let footprintD: number
          if (isImported) {
            const cat = asset?.modelCategory ?? 'car'
            const targetFt = ({ car: 15, motorcycle: 7, equipment: 4, furniture: 5 } as Record<string, number>)[cat] ?? 10
            const targetIn = targetFt * 12
            const modelLongest3D = Math.max(hull.modelW, hull.modelH, hull.modelD)
            const s = targetIn / modelLongest3D
            footprintW = hull.modelW * s
            footprintD = hull.modelD * s
          } else {
            const longest3D = Math.max(w, hIn, d)
            const modelLongest3D = Math.max(hull.modelW, hull.modelH, hull.modelD)
            const s = longest3D / modelLongest3D
            footprintW = hull.modelW * s
            footprintD = hull.modelD * s
          }
          // The bitmap is square with the silhouette at native proportions
          // inside (modelW/modelLongestXZ × modelD/modelLongestXZ of canvas).
          // Stretch it non-uniformly so the visible silhouette = footprintW × footprintD.
          const modelLongest = Math.max(hull.modelW, hull.modelD)
          const imgW = footprintW * (modelLongest / hull.modelW)
          const imgD = footprintD * (modelLongest / hull.modelD)
          const halfWPx = (imgW * scale) / 2
          const halfDPx = (imgD * scale) / 2
          const cxPx = sx(cxIn)
          const czPx = sz(czIn)
          // Apply the catalog's modelRotY (per-vehicle orientation fix) on
          // top of the user's rotation so the floor plan matches the 3D view.
          const totalRotDeg = ((rotY + (def?.modelRotY ?? 0)) * 180) / Math.PI
          const selW = footprintW * scale
          const selD = footprintD * scale
          return (
            <g key={`item-${item.id}`}
              transform={`translate(${cxPx} ${czPx}) rotate(${totalRotDeg})`}
              style={{ cursor: 'grab' }}
              onPointerDown={onItemDown}
              onPointerMove={onItemMove}
              onPointerUp={onItemUp}
              onPointerCancel={onItemUp}>
              <image href={hull.snapshotDataUrl}
                x={-halfWPx} y={-halfDPx} width={halfWPx * 2} height={halfDPx * 2}
                opacity={isSel ? 1 : 0.85}
                preserveAspectRatio="none" />
              {isSel && (
                <rect x={-selW / 2} y={-selD / 2} width={selW} height={selD}
                  fill="none" stroke="#0a84ff" strokeWidth={0.8}
                  strokeDasharray="3 2" pointerEvents="none" />
              )}
            </g>
          )
        }
        // Fallback rectangle while loading or for items without a cached hull.
        const hw = w / 2, hd = d / 2
        const polyPts = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => place(lx, lz))
        const pts = polyPts.map(([x, z]) => `${sx(x)},${sz(z)}`).join(' ')
        return (
          <g key={`item-${item.id}`}
            style={{ cursor: 'grab' }}
            onPointerDown={onItemDown}
            onPointerMove={onItemMove}
            onPointerUp={onItemUp}
            onPointerCancel={onItemUp}>
            <polygon points={pts}
              fill={isSel ? 'rgba(10,132,255,0.12)' : 'transparent'}
              stroke={stroke} strokeWidth={0.8}
              strokeDasharray={isFallback ? '4 2' : undefined}
              opacity={0.75} />
          </g>
        )
      })}

      {/* ── Overhead racks (interactive: drag + rotate) ── */}
      {overheadRacks.map(rack => {
        const hw = rack.rackWidth / 2
        const hl = rack.rackLength / 2
        const cos = Math.cos(rack.rotY), sin = Math.sin(rack.rotY)
        const corners = [
          [-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl],
        ].map(([lx, lz]) => ({
          x: rack.x + lx * cos - lz * sin,
          z: rack.z + lx * sin + lz * cos,
        }))
        const pts = corners.map(c => `${sx(c.x)},${sz(c.z)}`).join(' ')
        const isSel = selectedRackId === rack.id

        // Rotate handle position: midpoint of the "top" edge (first two corners)
        const rotHandleX = (sx(corners[0].x) + sx(corners[1].x)) / 2
        const rotHandleZ = (sz(corners[0].z) + sz(corners[1].z)) / 2

        return (
          <g key={rack.id} style={{ cursor: rack.locked ? 'default' : 'grab' }}>
            {/* Rack base — solid outline so it's clearly visible on the floor plan */}
            <polygon
              points={pts}
              fill={isSel ? 'rgba(100,100,255,0.22)' : 'rgba(100,100,255,0.14)'}
              stroke={isSel ? '#4444ff' : '#5555bb'}
              strokeWidth={isSel ? 1.4 : 1.0}
              onPointerDown={(e) => onRackPointerDown(e, rack)}
              onPointerMove={onRackPointerMove}
              onPointerUp={onRackPointerUp}
            />
            {/* Size label — centered on the rack, aligned with its rotation */}
            <text
              x={sx(rack.x)}
              y={sz(rack.z)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={3.5}
              fontWeight={600}
              fill="#2a2a66"
              transform={`rotate(${(rack.rotY * 180) / Math.PI} ${sx(rack.x)} ${sz(rack.z)})`}
              style={{ pointerEvents: 'none', userSelect: 'none' }}
            >
              {rack.rackWidth / 12}&#39; × {rack.rackLength / 12}&#39;
            </text>
            {/* Rotate handle — small circle at top edge */}
            {isSel && !rack.locked && (
              <circle
                cx={rotHandleX} cy={rotHandleZ} r={4}
                fill="none" stroke="#44aaff" strokeWidth={1.5}
                pointerEvents="all"
                style={{ cursor: 'pointer' }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  updateRack(rack.id, { rotY: rack.rotY + Math.PI / 2 })
                }}
              />
            )}
          </g>
        )
      })}

      {/* Corner angle labels — toggled by its own button */}
      {cornerAngleLabelsVisible && (() => {
        // Ray at each endpoint = direction pointing AWAY from the endpoint
        // along its wall. Each wall contributes two rays (one per endpoint).
        const endpoints: { x: number; z: number; ux: number; uz: number; wallId: string }[] = []
        for (const w of walls) {
          const [dx, dz] = wallDir(w)
          endpoints.push({ x: w.x1, z: w.z1, ux: dx,  uz: dz,  wallId: w.id })
          endpoints.push({ x: w.x2, z: w.z2, ux: -dx, uz: -dz, wallId: w.id })
        }
        // Also detect T-junctions: an endpoint of one wall landing on another
        // wall's body/edge (not just at its endpoints). Contributes TWO rays
        // for the host wall at the junction point (one each direction).
        const TOL = 2
        for (const w of walls) {
          const [dx, dz] = wallDir(w)
          const wl = wallLen(w)
          if (wl < 1) continue
          // Perpendicular tolerance scales with wall thickness so endpoints
          // landing on the wall's interior face still register as T-junctions.
          const perpTol = Math.max(TOL, w.thickness / 2 + TOL)
          const endTol = perpTol + 2  // along-wall gap to avoid double-counting corners
          for (const other of walls) {
            if (other.id === w.id) continue
            for (const [px, pz] of [[other.x1, other.z1], [other.x2, other.z2]] as [number, number][]) {
              // Projection of endpoint onto wall w (segment)
              const t = ((px - w.x1) * dx + (pz - w.z1) * dz)
              if (t < endTol || t > wl - endTol) continue   // skip true corners
              const cxw = w.x1 + t * dx, czw = w.z1 + t * dz
              if (Math.hypot(px - cxw, pz - czw) > perpTol) continue
              // T-junction — add two rays on w (both directions along w).
              endpoints.push({ x: cxw, z: czw, ux: dx,  uz: dz,  wallId: w.id })
              endpoints.push({ x: cxw, z: czw, ux: -dx, uz: -dz, wallId: w.id })
              // Also project the OTHER wall's endpoint onto its own direction
              // ray pointing INTO the host wall, so its angle shows up here.
              // (other's direction from its [px,pz] endpoint back toward its body.)
              const [odx, odz] = wallDir(other)
              const isStart = px === other.x1 && pz === other.z1
              endpoints.push({
                x: cxw, z: czw,
                ux: isStart ? odx : -odx,
                uz: isStart ? odz : -odz,
                wallId: other.id,
              })
            }
          }
        }
        // Group coincident endpoints (within 2").
        const groups: typeof endpoints[] = []
        for (const e of endpoints) {
          const g = groups.find(gg => Math.hypot(gg[0].x - e.x, gg[0].z - e.z) < TOL)
          if (g) g.push(e); else groups.push([e])
        }
        const labels: JSX.Element[] = []
        for (const g of groups) {
          if (g.length < 2) continue
          // Dedupe rays pointing the same direction (within ~1°).
          const unique: typeof g = []
          for (const r of g) {
            if (unique.some(u => u.ux * r.ux + u.uz * r.uz > 0.9998)) continue
            unique.push(r)
          }
          if (unique.length < 2) continue
          const sorted = [...unique].sort((a, b) => Math.atan2(a.uz, a.ux) - Math.atan2(b.uz, b.ux))
          for (let i = 0; i < sorted.length; i++) {
            if (sorted.length === 2 && i > 0) break
            const a = sorted[i]
            const b = sorted[(i + 1) % sorted.length]
            const dot = a.ux * b.ux + a.uz * b.uz
            let angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
            if (sorted.length > 2) {
              const cross = a.ux * b.uz - a.uz * b.ux
              const sweep = Math.atan2(cross, dot) * 180 / Math.PI
              angleDeg = sweep < 0 ? sweep + 360 : sweep
            }
            if (angleDeg < 1 || angleDeg > 359) continue
            // Place label in the sector between rays a and b (bisector),
            // pushed into the wedge so it sits visibly in the opening.
            let bx = a.ux + b.ux, bz = a.uz + b.uz
            // If rays are (nearly) antiparallel (180° sector), bisector
            // collapses — use the perpendicular of either ray instead.
            if (Math.hypot(bx, bz) < 0.01) { bx = -a.uz; bz = a.ux }
            const blen = Math.hypot(bx, bz) || 1
            bx /= blen; bz /= blen
            const OFF = 16
            const tx = sx(a.x) + bx * OFF
            const ty = sz(a.z) + bz * OFF
            labels.push(
              <g key={`ang-${a.x.toFixed(1)}-${a.z.toFixed(1)}-${i}`} pointerEvents="none">
                <rect x={tx - 12} y={ty - 5.5} width={24} height={11} rx={2}
                  fill="#ffffffcc" stroke="#888" strokeWidth={0.3} />
                <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central"
                  fontSize={4.55} fontWeight={600} fill="#333">
                  {angleDeg.toFixed(0)}°
                </text>
              </g>
            )
          }
        }
        return labels
      })()}

      {/* Wall endpoint drag handles — only shown on the selected wall. The
          active handle is made invisible during its drag (via opacity, not
          unmount) so the circle stops obscuring the snap target without
          losing the pointer-capture that dispatches the release event. */}
      {walls.filter(w => w.id === selectedWallId).map(w => {
        const startHidden = activeHandleId === `wall-${w.id}-start`
        const endHidden = activeHandleId === `wall-${w.id}-end`
        return (
          <g key={`wh-${w.id}`}>
            <circle
              cx={sx(w.x1)} cy={sz(w.z1)} r={6}
              fill="none" stroke="#44aaff" strokeWidth={1.5}
              pointerEvents="all"
              style={{ cursor: 'grab', opacity: startHidden ? 0 : 1 }}
              onPointerDown={e => onWallEndPointerDown(e, w, 'start')}
              onPointerMove={onWallEndPointerMove}
              onPointerUp={onWallEndPointerUp}
              onPointerCancel={onWallEndPointerUp}
            />
            <circle
              cx={sx(w.x2)} cy={sz(w.z2)} r={6}
              fill="none" stroke="#44aaff" strokeWidth={1.5}
              pointerEvents="all"
              style={{ cursor: 'grab', opacity: endHidden ? 0 : 1 }}
              onPointerDown={e => onWallEndPointerDown(e, w, 'end')}
              onPointerMove={onWallEndPointerMove}
              onPointerUp={onWallEndPointerUp}
              onPointerCancel={onWallEndPointerUp}
            />
          </g>
        )
      })}

      {/* Floor-step corner drag handles — rendered last so they sit above
          walls/dimensions and stay grabbable when a step overlaps a wall. */}
      {floorSteps.map(step => {
        const isSel = selectedFloorStepId === step.id
        const locked = !!step.locked
        if (!isSel || locked) return null
        return (
          <g key={`sch-${step.id}`}>
            {step.corners.map(([cx, cz], i) => {
              const handleId = `step-corner-${step.id}-${i}`
              const hidden = activeHandleId === handleId
              // Keep the circle mounted so pointer-capture survives; just hide
              // it visually during the drag so it doesn't cover the snap target.
              return (
                <circle
                  key={`sc-${step.id}-${i}`}
                  cx={sx(cx)} cy={sz(cz)} r={6}
                  fill="none" stroke="#44aaff" strokeWidth={1.5}
                  pointerEvents="all"
                  style={{ cursor: 'grab', opacity: hidden ? 0 : 1 }}
                  onPointerDown={e => onStepCornerDown(e, step, i)}
                  onPointerMove={onStepCornerMove}
                  onPointerUp={onStepCornerUp}
                  onPointerCancel={onStepCornerUp}
                />
              )
            })}
          </g>
        )
      })}

      {/* Measurement line — two draggable endpoints with the distance label
          rendered along the line. Toggled via the floor-plan toolbar. */}
      {showMeasureTool && measureLine && (() => {
        const { ax, az, bx, bz } = measureLine
        const A = { sx: sx(ax), sz: sz(az) }
        const B = { sx: sx(bx), sz: sz(bz) }
        const distIn = Math.hypot(bx - ax, bz - az)
        const midX = (A.sx + B.sx) / 2
        const midZ = (A.sz + B.sz) / 2
        const angDeg = readableAngle(Math.atan2(B.sz - A.sz, B.sx - A.sx) * 180 / Math.PI)
        const onMeasureDown = (end: 'a' | 'b') => (e: React.PointerEvent) => {
          e.stopPropagation()
          e.preventDefault()
          const pos = mouseToSvg(e)
          if (!pos) return
          const initX = end === 'a' ? ax : bx
          const initZ = end === 'a' ? az : bz
          measureDragRef.current = { end, startMouseX: pos.x, startMouseZ: pos.z, initX, initZ }
          setActiveHandleId(`measure-${end}`)
          ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
        }
        const onMeasureMove = (e: React.PointerEvent) => {
          const md = measureDragRef.current
          if (!md) return
          const pos = mouseToSvg(e)
          if (!pos) return
          const nx = md.initX + (pos.x - md.startMouseX)
          const nz = md.initZ + (pos.z - md.startMouseZ)
          setMeasureLine(ml => ml && (md.end === 'a'
            ? { ...ml, ax: nx, az: nz }
            : { ...ml, bx: nx, bz: nz }))
        }
        const onMeasureUp = (e: React.PointerEvent) => {
          measureDragRef.current = null
          setActiveHandleId(null)
          try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch (_) {}
        }
        return (
          <g key="measure-line">
            <line x1={A.sx} y1={A.sz} x2={B.sx} y2={B.sz}
              stroke="#0a84ff" strokeWidth={1} strokeDasharray="4 2" pointerEvents="none" />
            {/* Distance label centered on the line, rotated to follow it. */}
            <g transform={`translate(${midX} ${midZ}) rotate(${angDeg})`} pointerEvents="none">
              <rect x={-22} y={-6} width={44} height={11} rx={2}
                fill="#ffffffdd" stroke="#0a84ff" strokeWidth={0.4} />
              <text x={0} y={0} textAnchor="middle" dominantBaseline="central"
                fontSize={4.5} fontWeight={700} fill="#0a4a8a">
                {inchesToDisplay(distIn)}
              </text>
            </g>
            {/* Endpoint handles — transparent inside with a small crosshair
                so the user can see exactly what's beneath the cursor. The
                blue ring stays for grab affordance. */}
            {([['a', A], ['b', B]] as const).map(([key, P]) => (
              <g key={`mh-${key}`}
                style={{ cursor: 'grab', opacity: activeHandleId === `measure-${key}` ? 0 : 1 }}>
                {/* Crosshair lines */}
                <line x1={P.sx - 5} y1={P.sz} x2={P.sx + 5} y2={P.sz}
                  stroke="#0a84ff" strokeWidth={0.7} pointerEvents="none" />
                <line x1={P.sx} y1={P.sz - 5} x2={P.sx} y2={P.sz + 5}
                  stroke="#0a84ff" strokeWidth={0.7} pointerEvents="none" />
                {/* Outer ring — transparent fill so the underlying scene
                    stays visible; pointer-events still hit the disc area. */}
                <circle cx={P.sx} cy={P.sz} r={6}
                  fill="transparent" stroke="#0a84ff" strokeWidth={1.8}
                  onPointerDown={onMeasureDown(key)}
                  onPointerMove={onMeasureMove}
                  onPointerUp={onMeasureUp}
                  onPointerCancel={onMeasureUp} />
              </g>
            ))}
          </g>
        )
      })()}
    </svg>
  )
}
