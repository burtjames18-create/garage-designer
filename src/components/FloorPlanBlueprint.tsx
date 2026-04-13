import { useRef, useCallback, useState } from 'react'
import type { GarageWall, PlacedCabinet, Countertop, FloorPoint, FloorStep, SlatwallPanel, StainlessBacksplashPanel, OverheadRack } from '../store/garageStore'
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
}

const PAD = 80  // more space for two tiers of dimension lines
const SLATWALL_DEPTH = 3  // visual depth of slatwall on floor plan (inches)

export default function FloorPlanBlueprint({ walls, cabinets, countertops, floorPoints, floorSteps = [], slatwallPanels = [], stainlessBacksplashPanels = [], overheadRacks = [] }: Props) {
  const { selectRack, updateRack, selectedRackId } = useGarageStore()
  const svgRef = useRef<SVGSVGElement>(null)
  const rackDragRef = useRef<{ rackId: string; startX: number; startZ: number; startMouseX: number; startMouseZ: number } | null>(null)
  const [rackSnap, setRackSnap] = useState<RackSnapResult | null>(null)

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

  // Convert a mouse event to SVG coordinates (accounts for pan/zoom wrapper)
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
    ;(e.target as Element).setPointerCapture(e.pointerId)
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

  const onRackPointerUp = useCallback(() => {
    rackDragRef.current = null
    setRackSnap(null)
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
    const textOff = 5
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

      {/* Cabinet footprints */}
      {cabinets.map(cab => {
        const hw = (cab.w * scale) / 2
        const hd = (cab.d * scale) / 2
        const deg = -(cab.rotY * 180) / Math.PI
        return (
          <g key={cab.id} transform={`translate(${sx(cab.x)},${sz(cab.z)}) rotate(${deg})`}>
            <rect x={-hw} y={-hd} width={cab.w * scale} height={cab.d * scale}
              fill="#e8e8e5" stroke="#444" strokeWidth={0.4} />
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

      {/* ══════════════════════════════════════════════════════════════════════
          DIMENSION SYSTEM — Two tiers per wall, outward from garage center
          Tier 1 (inner):  Overall wall length
          Tier 2 (outer):  Cabinet breakdown — gaps + cab widths
         ══════════════════════════════════════════════════════════════════════ */}
      {(() => {
        const dims: JSX.Element[] = []
        const TIER1_OFF = 38  // px offset from wall for overall dim (outer)
        const TIER2_OFF = 20  // px offset from wall for breakdown dim (inner)

        for (const w of walls) {
          const len = wallLen(w)
          if (len < 6) continue

          const [outX, outZ] = outwardDir(w)
          const [wdx, wdz] = wallDir(w)

          // Interior face: trim at connected corners (angle-aware)
          const { trim1, trim2, interior, ifx1, ifz1, ifx2, ifz2 } = interiorLen(w)

          // SVG endpoints of the interior face
          const ix1s = sx(ifx1), iz1s = sz(ifz1)
          const ix2s = sx(ifx2), iz2s = sz(ifz2)

          // ── TIER 1: Overall interior wall length ──
          const t1x1 = ix1s + outX * TIER1_OFF, t1z1 = iz1s + outZ * TIER1_OFF
          const t1x2 = ix2s + outX * TIER1_OFF, t1z2 = iz2s + outZ * TIER1_OFF

          dims.push(
            <g key={`t1-${w.id}`}>
              <line x1={ix1s} y1={iz1s} x2={ix1s + outX * (TIER1_OFF + 4)} y2={iz1s + outZ * (TIER1_OFF + 4)}
                stroke={dimColor} strokeWidth={0.3} strokeDasharray="3 2" />
              <line x1={ix2s} y1={iz2s} x2={ix2s + outX * (TIER1_OFF + 4)} y2={iz2s + outZ * (TIER1_OFF + 4)}
                stroke={dimColor} strokeWidth={0.3} strokeDasharray="3 2" />
              <DimLine x1={t1x1} y1={t1z1} x2={t1x2} y2={t1z2}
                label={inchesToDisplay(interior)} outX={outX} outZ={outZ}
                color={textColor} fontSize={fs} fontWeight="700" />
            </g>
          )

          // ── TIER 2: Cabinet/gap breakdown (only for walls with cabinets) ──
          const wCabs = cabsByWall.get(w.id)
          if (!wCabs || wCabs.length === 0) continue

          // Sort cabinets along wall direction (from wall centerline start)
          const sorted = wCabs.map(cab => {
            const along = (cab.x - w.x1) * wdx + (cab.z - w.z1) * wdz
            return { cab, along }
          }).sort((a, b) => a.along - b.along)

          // Build segments using interior face range [trim1 .. len - trim2]
          type Seg = { start: number; end: number; isCab: boolean }
          const segments: Seg[] = []
          const iStart = trim1       // interior face start along wall
          const iEnd = len - trim2   // interior face end along wall

          const firstStart = sorted[0].along - sorted[0].cab.w / 2
          if (firstStart - iStart > 1) {
            segments.push({ start: iStart, end: firstStart, isCab: false })
          }

          for (let i = 0; i < sorted.length; i++) {
            const { cab, along } = sorted[i]
            segments.push({ start: along - cab.w / 2, end: along + cab.w / 2, isCab: true })

            if (i < sorted.length - 1) {
              const gapStart = along + cab.w / 2
              const gapEnd = sorted[i + 1].along - sorted[i + 1].cab.w / 2
              if (gapEnd - gapStart > 1) {
                segments.push({ start: gapStart, end: gapEnd, isCab: false })
              }
            }
          }

          const lastEnd = sorted[sorted.length - 1].along + sorted[sorted.length - 1].cab.w / 2
          if (iEnd - lastEnd > 1) {
            segments.push({ start: lastEnd, end: iEnd, isCab: false })
          }

          // Witness lines to tier 2
          const firstSeg = segments[0]
          const lastSeg = segments[segments.length - 1]
          const wlStartX = w.x1 + wdx * firstSeg.start, wlStartZ = w.z1 + wdz * firstSeg.start
          const wlEndX = w.x1 + wdx * lastSeg.end, wlEndZ = w.z1 + wdz * lastSeg.end

          dims.push(
            <g key={`t2wl-${w.id}`}>
              <line x1={sx(wlStartX)} y1={sz(wlStartZ)}
                x2={sx(wlStartX) + outX * (TIER2_OFF + 4)} y2={sz(wlStartZ) + outZ * (TIER2_OFF + 4)}
                stroke={dimColorLight} strokeWidth={0.25} strokeDasharray="2 1.5" />
              <line x1={sx(wlEndX)} y1={sz(wlEndZ)}
                x2={sx(wlEndX) + outX * (TIER2_OFF + 4)} y2={sz(wlEndZ) + outZ * (TIER2_OFF + 4)}
                stroke={dimColorLight} strokeWidth={0.25} strokeDasharray="2 1.5" />
            </g>
          )

          // Render each segment
          for (let i = 0; i < segments.length; i++) {
            const seg = segments[i]
            const segLen = seg.end - seg.start
            if (segLen < 0.5) continue

            const s1x = w.x1 + wdx * seg.start, s1z = w.z1 + wdz * seg.start
            const s2x = w.x1 + wdx * seg.end, s2z = w.z1 + wdz * seg.end
            const sx1 = sx(s1x) + outX * TIER2_OFF, sz1 = sz(s1z) + outZ * TIER2_OFF
            const sx2 = sx(s2x) + outX * TIER2_OFF, sz2 = sz(s2z) + outZ * TIER2_OFF

            // Witness lines for intermediate segment boundaries (from wall to inner tier)
            if (i > 0) {
              dims.push(
                <line key={`t2iw-${w.id}-${i}`}
                  x1={sx(s1x)} y1={sz(s1z)}
                  x2={sx(s1x) + outX * (TIER2_OFF + 4)} y2={sz(s1z) + outZ * (TIER2_OFF + 4)}
                  stroke={dimColorLight} strokeWidth={0.25} strokeDasharray="2 1.5" />
              )
            }

            dims.push(
              <g key={`t2seg-${w.id}-${i}`}>
                <DimLine x1={sx1} y1={sz1} x2={sx2} y2={sz2}
                  label={inchesToDisplay(segLen)} outX={outX} outZ={outZ}
                  color={seg.isCab ? '#444' : dimColorLight}
                  fontSize={fs - 0.5} fontWeight={seg.isCab ? '700' : '500'} />
              </g>
            )
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
