import { useRef, useCallback, useState } from 'react'
import type { GarageWall, PlacedCabinet, Countertop, FloorPoint, FloorStep, SlatwallPanel, StainlessBacksplashPanel, OverheadRack, Baseboard, StemWall } from '../store/garageStore'
import { COUNTERTOP_DEPTH, useGarageStore } from '../store/garageStore'
import { inchesToDisplay, snapToGrid, snapRackToWalls, type RackSnapResult } from '../utils/measurements'
import { wallLen, wallDir, wallNormal } from '../utils/wallGeometry'

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
  /** When false, the tracing reference image is omitted (used by PDF export). */
  showTracing?: boolean
}

const PAD = 40  // compact padding to keep dim tiers close to wall edges
const SLATWALL_DEPTH = 3  // visual depth of slatwall on floor plan (inches)

export default function FloorPlanBlueprint({ walls, cabinets, countertops, floorPoints, floorSteps = [], slatwallPanels = [], stainlessBacksplashPanels = [], overheadRacks = [], baseboards = [], stemWalls = [], showTracing = true }: Props) {
  const { selectRack, updateRack, selectedRackId,
    selectCabinet, updateCabinet, selectedCabinetId, snappingEnabled,
    tracingImage, updateTracingImage,
    updateWall, selectedWallId, selectWall,
    wallAngleSnapEnabled, cornerAngleLabelsVisible } = useGarageStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const rackDragRef = useRef<{ rackId: string; startX: number; startZ: number; startMouseX: number; startMouseZ: number } | null>(null)
  const [rackSnap, setRackSnap] = useState<RackSnapResult | null>(null)

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
      const SNAP = 3
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

      // Step 2: collect wall-snap targets (endpoints + edge projections of the
      // CURRENT cursor position). When the angle is locked, project each target
      // ONTO the locked ray and snap only if it's close to that ray (so the wall
      // attaches end-to-end or end-to-edge without breaking the angle lock).
      const targets: [number, number][] = []
      for (const w of walls) {
        for (const [px, pz, isSelf] of [
          [w.x1, w.z1, w.id === wd.wallId && wd.end === 'start'],
          [w.x2, w.z2, w.id === wd.wallId && wd.end === 'end'],
        ] as [number, number, boolean][]) {
          if (!isSelf) targets.push([px, pz])
        }
      }
      // Edge projections are evaluated relative to the current nx/nz (which
      // is already on the locked ray if angleLocked).
      for (const w of walls) {
        if (w.id === wd.wallId) continue
        const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
        const wl2 = wdx * wdx + wdz * wdz
        if (wl2 < 0.01) continue
        const t = Math.max(0, Math.min(1, ((nx - w.x1) * wdx + (nz - w.z1) * wdz) / wl2))
        targets.push([w.x1 + t * wdx, w.z1 + t * wdz])
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
        // No angle lock — plain 2D closest-target snap.
        for (const [tx, tz] of targets) {
          const d = Math.hypot(nx - tx, nz - tz)
          if (d < bestDist) { bestDist = d; bx = tx; bz = tz }
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

  const dimColor = '#555'
  const dimColorLight = '#888'
  const textColor = '#333'
  const fs = 7
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
  const SNAP = 2
  function endpointConnected(wx: number, wz: number, skipId: string): GarageWall | null {
    for (const other of walls) {
      if (other.id === skipId) continue
      if (Math.hypot(other.x1 - wx, other.z1 - wz) < SNAP) return other
      if (Math.hypot(other.x2 - wx, other.z2 - wz) < SNAP) return other
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

    if (conn1) {
      const cLen = wallLen(conn1)
      if (cLen > 0.5) {
        const [cdx, cdz] = wallDir(conn1)
        const cpx = -cdz, cpz = cdx
        const cHT = conn1.thickness / 2
        // Connected wall's interior face line (same interior side)
        const cIfOx = conn1.x1 + cpx * cHT * inSign
        const cIfOz = conn1.z1 + cpz * cHT * inSign
        const det = dx * (-cdz) - dz * (-cdx)
        if (Math.abs(det) > 1e-6) {
          const t = ((cIfOx - ifOx) * (-cdz) - (cIfOz - ifOz) * (-cdx)) / det
          if (t > 0 && t < len) trim1 = t
        }
        // Fallback for near-perpendicular
        if (trim1 < 0.1) trim1 = conn1.thickness / 2
      }
    }

    if (conn2) {
      const cLen = wallLen(conn2)
      if (cLen > 0.5) {
        const [cdx, cdz] = wallDir(conn2)
        const cpx = -cdz, cpz = cdx
        const cHT = conn2.thickness / 2
        const cIfOx = conn2.x1 + cpx * cHT * inSign
        const cIfOz = conn2.z1 + cpz * cHT * inSign
        const det = dx * (-cdz) - dz * (-cdx)
        if (Math.abs(det) > 1e-6) {
          const t = ((cIfOx - ifOx) * (-cdz) - (cIfOz - ifOz) * (-cdx)) / det
          if (t > 0 && t < len) trim2 = len - t
        }
        if (trim2 < 0.1) trim2 = conn2.thickness / 2
      }
    }

    const interior = len - trim1 - trim2
    const ifx1 = w.x1 + dx * trim1, ifz1 = w.z1 + dz * trim1
    const ifx2 = w.x2 - dx * trim2, ifz2 = w.z2 - dz * trim2
    return { len, trim1, trim2, interior, ifx1, ifz1, ifx2, ifz2 }
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

      {/* Floor steps */}
      {floorSteps.map(step => (
        <polygon
          key={step.id}
          points={step.corners.map(([cx, cz]) => `${sx(cx)},${sz(cz)}`).join(' ')}
          fill="#e0ddd8"
          stroke="#999"
          strokeWidth={0.6}
          strokeDasharray="3,1.5"
        />
      ))}

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
      {(() => {
        // 2D line intersection: ray from (ax,az) dir (adx,adz) with ray from (bx,bz) dir (bdx,bdz).
        // Returns t along the first ray, or NaN if parallel.
        const intersectT = (ax: number, az: number, adx: number, adz: number,
                            bx: number, bz: number, bdx: number, bdz: number) => {
          const det = adx * (-bdz) - adz * (-bdx)
          if (Math.abs(det) < 1e-6) return NaN
          return ((bx - ax) * (-bdz) - (bz - az) * (-bdx)) / det
        }

        // Compute mitered face point at a connected corner.
        // Given this wall's face line and the connected wall, find where they intersect.
        const miterFace = (
          faceX: number, faceZ: number, dirX: number, dirZ: number,  // this wall's face line
          conn: GarageWall, epx: number, epz: number,                // connected wall + corner point
          sidePx: number, sidePz: number,                             // this wall's face offset direction
        ): { x: number; z: number } | null => {
          const cLen = wallLen(conn)
          if (cLen < 0.5) return null
          const [cdx, cdz] = wallDir(conn)
          const cpx = -cdz, cpz = cdx  // conn perpendicular
          const cHT = conn.thickness / 2
          // Pick the connected wall's face that lies on the SAME side of the
          // corner as our current face. If our face is offset in (sidePx, sidePz)
          // direction from the centerline endpoint, pick conn's face on the
          // side that has positive dot product with (sidePx, sidePz).
          const cSide = (sidePx * cpx + sidePz * cpz) >= 0 ? +1 : -1
          // Use the endpoint shared with this wall as the anchor; the conn
          // line passes through (epx, epz) parallel to (cdx, cdz). Shift it
          // perpendicular by cHT*cSide to get the face line.
          const cFaceX = epx + cpx * cHT * cSide
          const cFaceZ = epz + cpz * cHT * cSide
          const t = intersectT(faceX, faceZ, dirX, dirZ, cFaceX, cFaceZ, cdx, cdz)
          if (isNaN(t)) return null
          return { x: faceX + t * dirX, z: faceZ + t * dirZ }
        }

        return walls.map(w => {
          const len = wallLen(w)
          if (len < 0.5) return null
          const [dx, dz] = wallDir(w)
          const halfT = w.thickness / 2
          const px = -dz, pz = dx  // perpendicular

          const conn1 = endpointConnected(w.x1, w.z1, w.id)
          const conn2 = endpointConnected(w.x2, w.z2, w.id)

          // Default perpendicular face corners
          let p0 = { x: w.x1 + px * halfT, z: w.z1 + pz * halfT }  // +side start
          let n0 = { x: w.x1 - px * halfT, z: w.z1 - pz * halfT }  // -side start
          let p1 = { x: w.x2 + px * halfT, z: w.z2 + pz * halfT }  // +side end
          let n1 = { x: w.x2 - px * halfT, z: w.z2 - pz * halfT }  // -side end

          // At connected corners, miter BOTH faces to their intersections
          // so adjacent wall polygons meet cleanly (a single diagonal line
          // across the corner) without overlapping. Cap the miter extension
          // at ~2× wall thickness to avoid long spikes at very acute angles.
          const maxExt = 2 * Math.max(halfT, conn1?.thickness ?? 0, conn2?.thickness ?? 0)
          const inRange = (px: number, pz: number, ex: number, ez: number) =>
            Math.hypot(px - ex, pz - ez) < maxExt
          if (conn1) {
            const mP = miterFace(p0.x, p0.z, dx, dz, conn1, w.x1, w.z1, +1)
            const mN = miterFace(n0.x, n0.z, dx, dz, conn1, w.x1, w.z1, -1)
            if (mP && inRange(mP.x, mP.z, w.x1, w.z1)) p0 = mP
            if (mN && inRange(mN.x, mN.z, w.x1, w.z1)) n0 = mN
          }
          if (conn2) {
            const mP = miterFace(p1.x, p1.z, dx, dz, conn2, w.x2, w.z2, +1)
            const mN = miterFace(n1.x, n1.z, dx, dz, conn2, w.x2, w.z2, -1)
            if (mP && inRange(mP.x, mP.z, w.x2, w.z2)) p1 = mP
            if (mN && inRange(mN.x, mN.z, w.x2, w.z2)) n1 = mN
          }

          const isSel = selectedWallId === w.id
          const strokeColor = isSel ? '#66aaff' : '#222'
          const strokeW = isSel ? 1.2 : 0.8
          // Render each wall as two parallel polylines (interior face + exterior
          // face) rather than a filled polygon, so corners appear as clean
          // right-angles where adjacent walls' faces meet, without any diagonal
          // end-cap lines crossing through the corner.
          // Invisible polygon for hit detection on the wall body.
          const hitPoints = [
            `${sx(p0.x)},${sz(p0.z)}`,
            `${sx(p1.x)},${sz(p1.z)}`,
            `${sx(n1.x)},${sz(n1.z)}`,
            `${sx(n0.x)},${sz(n0.z)}`,
          ].join(' ')
          return (
            <g key={w.id}>
              <polygon points={hitPoints}
                fill={isSel ? 'rgba(102,170,255,0.15)' : 'transparent'}
                stroke="none"
                style={{ cursor: 'move' }}
                onPointerDown={e => onWallBodyPointerDown(e, w)}
                onPointerMove={onWallBodyPointerMove}
                onPointerUp={onWallBodyPointerUp}
                onPointerCancel={onWallBodyPointerUp} />
              {/* Interior face */}
              <line x1={sx(p0.x)} y1={sz(p0.z)} x2={sx(p1.x)} y2={sz(p1.z)}
                stroke={strokeColor} strokeWidth={strokeW} pointerEvents="none" />
              {/* Exterior face */}
              <line x1={sx(n0.x)} y1={sz(n0.z)} x2={sx(n1.x)} y2={sz(n1.z)}
                stroke={strokeColor} strokeWidth={strokeW} pointerEvents="none" />
            </g>
          )
        })
      })()}

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

          // Width label — positioned on the exterior side of the wall, aligned
          // with wall direction so it reads left-to-right.
          const centerX = (pA0.x + pA1.x + nA0.x + nA1.x) / 4
          const centerZ = (pA0.z + pA1.z + nA0.z + nA1.z) / 4
          const labelOffset = halfT + 7   // inches outside the exterior face
          const labelX = centerX - nxIn * labelOffset
          const labelZ = centerZ - nzIn * labelOffset
          const wallDeg = Math.atan2(dz, dx) * 180 / Math.PI
          const readableDeg = (wallDeg > 90 || wallDeg < -90) ? wallDeg + 180 : wallDeg
          const prefix = op.type === 'garage-door' ? 'GD ' : op.type === 'window' ? 'W ' : ''

          return (
            <g key={`op-${op.id}`} pointerEvents="none">
              <polygon points={coverPts} fill="#ffffff" stroke="none" />
              {/* Jambs at each edge */}
              <line x1={sx(pA0.x)} y1={sz(pA0.z)} x2={sx(nA0.x)} y2={sz(nA0.z)}
                stroke="#222" strokeWidth={0.8} />
              <line x1={sx(pA1.x)} y1={sz(pA1.z)} x2={sx(nA1.x)} y2={sz(nA1.z)}
                stroke="#222" strokeWidth={0.8} />
              {symbol}
              <text x={sx(labelX)} y={sz(labelZ)}
                textAnchor="middle" dominantBaseline="central"
                fontSize={4.5} fontWeight={600} fill="#444"
                transform={`rotate(${readableDeg} ${sx(labelX)} ${sz(labelZ)})`}>
                {prefix}{inchesToDisplay(op.width)}
              </text>
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
        const fsDim = 5
        const fsSeg = 5

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
              const ext = op.modelId === 'custom-plain' ? 2.5 : 0
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

          // Overall wall length is always the outermost tier.
          const tierCount = tierStrips.length + 1
          const overallOff = TIER_BASE + TIER_STEP * (tierCount - 1)

          // Overall wall dimension line
          const ix1s = sx(ifx1), iz1s = sz(ifz1)
          const ix2s = sx(ifx2), iz2s = sz(ifz2)
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
          for (let ti = 0; ti < tierStrips.length; ti++) {
            const off = TIER_BASE + TIER_STEP * ti
            const strips = tierStrips[ti]
            for (let si = 0; si < strips.length; si++) {
              const s = strips[si]
              const segLen = s.end - s.start
              if (segLen < 0.5) continue
              const s1x = w.x1 + wdx * s.start, s1z = w.z1 + wdz * s.start
              const s2x = w.x1 + wdx * s.end,   s2z = w.z1 + wdz * s.end
              const sx1 = sx(s1x) + outX * off, sz1 = sz(s1z) + outZ * off
              const sx2 = sx(s2x) + outX * off, sz2 = sz(s2z) + outZ * off
              dims.push(
                <g key={`t${ti}-${w.id}-${si}`}>
                  <line x1={sx(s1x)} y1={sz(s1z)} x2={sx(s1x) + outX * (off + 4)} y2={sz(s1z) + outZ * (off + 4)}
                    stroke={dimColorLight} strokeWidth={0.25} strokeDasharray="2 1.5" />
                  <line x1={sx(s2x)} y1={sz(s2z)} x2={sx(s2x) + outX * (off + 4)} y2={sz(s2z) + outZ * (off + 4)}
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
              fontSize={5}
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
                  fontSize={6.5} fontWeight={600} fill="#333">
                  {angleDeg.toFixed(0)}°
                </text>
              </g>
            )
          }
        }
        return labels
      })()}

      {/* Wall endpoint drag handles — only shown on the selected wall */}
      {walls.filter(w => w.id === selectedWallId).map(w => (
        <g key={`wh-${w.id}`}>
          <circle
            cx={sx(w.x1)} cy={sz(w.z1)} r={6}
            fill="none" stroke="#44aaff" strokeWidth={1.5}
            pointerEvents="all"
            style={{ cursor: 'grab' }}
            onPointerDown={e => onWallEndPointerDown(e, w, 'start')}
            onPointerMove={onWallEndPointerMove}
            onPointerUp={onWallEndPointerUp}
            onPointerCancel={onWallEndPointerUp}
          />
          <circle
            cx={sx(w.x2)} cy={sz(w.z2)} r={6}
            fill="none" stroke="#44aaff" strokeWidth={1.5}
            pointerEvents="all"
            style={{ cursor: 'grab' }}
            onPointerDown={e => onWallEndPointerDown(e, w, 'end')}
            onPointerMove={onWallEndPointerMove}
            onPointerUp={onWallEndPointerUp}
            onPointerCancel={onWallEndPointerUp}
          />
        </g>
      ))}
    </svg>
  )
}
