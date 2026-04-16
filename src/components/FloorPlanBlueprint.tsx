import { useRef, useCallback, useState } from 'react'
import type { GarageWall, PlacedCabinet, Countertop, FloorPoint, FloorStep, SlatwallPanel, StainlessBacksplashPanel, OverheadRack, Baseboard, StemWall } from '../store/garageStore'
import { COUNTERTOP_DEPTH, useGarageStore } from '../store/garageStore'
import { inchesToDisplay, snapToGrid, snapRackToWalls, type RackSnapResult } from '../utils/measurements'

function wallLen(w: GarageWall) { return Math.hypot(w.x2 - w.x1, w.z2 - w.z1) }
function wallDir(w: GarageWall): [number, number] {
  const l = wallLen(w); if (l < 0.01) return [1, 0]
  return [(w.x2 - w.x1) / l, (w.z2 - w.z1) / l]
}

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
}

const PAD = 40  // compact padding to keep dim tiers close to wall edges
const SLATWALL_DEPTH = 3  // visual depth of slatwall on floor plan (inches)

export default function FloorPlanBlueprint({ walls, cabinets, countertops, floorPoints, floorSteps = [], slatwallPanels = [], stainlessBacksplashPanels = [], overheadRacks = [], baseboards = [], stemWalls = [] }: Props) {
  const { selectRack, updateRack, selectedRackId,
    selectCabinet, updateCabinet, selectedCabinetId, snappingEnabled } = useGarageStore()
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

  if (walls.length === 0) return null

  // Bounding box of all wall endpoints
  const allX = walls.flatMap(w => [w.x1, w.x2])
  const allZ = walls.flatMap(w => [w.z1, w.z2])
  const minX = Math.min(...allX), maxX = Math.max(...allX)
  const minZ = Math.min(...allZ), maxZ = Math.max(...allZ)
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
    // Place text on the outward side of the dim line
    const textOff = 2
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
      {/* Background */}
      <rect x={0} y={0} width={SVG_W} height={SVG_H} fill="#ffffff" />


      {/* Floor steps */}
      {floorSteps.map(step => (
        <rect
          key={step.id}
          x={sx(step.x - step.width / 2)}
          y={sz(step.z - step.depth / 2)}
          width={step.width * scale}
          height={step.depth * scale}
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
          side: number,                                                // +1 or -1 for face side
        ): { x: number; z: number } | null => {
          const cLen = wallLen(conn)
          if (cLen < 0.5) return null
          const [cdx, cdz] = wallDir(conn)
          const cpx = -cdz, cpz = cdx  // conn perpendicular
          const cHT = conn.thickness / 2
          // Connected wall's same-side face line
          const cFaceX = conn.x1 + cpx * cHT * side
          const cFaceZ = conn.z1 + cpz * cHT * side
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

          // At connected corners, compute mitered intersection points.
          // Only extend (use miter) on the face that goes outward; keep perpendicular
          // on the face that retracts inward, to avoid overlap with adjacent wall.
          if (conn1) {
            const mP = miterFace(p0.x, p0.z, dx, dz, conn1, w.x1, w.z1, +1)
            const mN = miterFace(n0.x, n0.z, dx, dz, conn1, w.x1, w.z1, -1)
            // Only use miter if it extends past the endpoint (along = negative for start end)
            if (mP) { const along = (mP.x - w.x1) * dx + (mP.z - w.z1) * dz; if (along < -0.1) p0 = mP }
            if (mN) { const along = (mN.x - w.x1) * dx + (mN.z - w.z1) * dz; if (along < -0.1) n0 = mN }
          }
          if (conn2) {
            const mP = miterFace(p1.x, p1.z, dx, dz, conn2, w.x2, w.z2, +1)
            const mN = miterFace(n1.x, n1.z, dx, dz, conn2, w.x2, w.z2, -1)
            if (mP) { const along = (mP.x - w.x2) * dx + (mP.z - w.z2) * dz; if (along > 0.1) p1 = mP }
            if (mN) { const along = (mN.x - w.x2) * dx + (mN.z - w.z2) * dz; if (along > 0.1) n1 = mN }
          }

          const points = [
            `${sx(p0.x)},${sz(p0.z)}`,
            `${sx(p1.x)},${sz(p1.z)}`,
            `${sx(n1.x)},${sz(n1.z)}`,
            `${sx(n0.x)},${sz(n0.z)}`,
          ].join(' ')

          return (
            <polygon key={w.id} points={points}
              fill="#222" stroke="#222" strokeWidth={0.5} strokeLinejoin="miter" />
          )
        })
      })()}

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
                fill="#4444ff" stroke="#fff" strokeWidth={1}
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

    </svg>
  )
}
