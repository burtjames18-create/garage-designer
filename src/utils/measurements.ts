/** Updated every frame by GarageShell — camera's floor intersection in inches */
export const cameraFloorPos = { x: 0, z: 0 }

export function inchesToDisplay(inches: number): string {
  if (!isFinite(inches)) return '—'
  const abs = Math.abs(inches)
  const sign = inches < 0 ? '-' : ''
  const wholeIn = Math.floor(abs)
  const frac = abs - wholeIn
  const sixteenths = Math.round(frac * 16)

  let inPart = ''
  if (wholeIn > 0 || sixteenths === 0) inPart += `${wholeIn}`
  if (sixteenths > 0) {
    const [n, d] = reduceFrac(sixteenths, 16)
    inPart += (wholeIn > 0 ? ' ' : '') + `${n}/${d}`
  }
  return sign + inPart + '"'
}

function reduceFrac(n: number, d: number): [number, number] {
  const g = gcd(n, d)
  return [n / g, d / g]
}
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function wallLengthIn(x1: number, z1: number, x2: number, z2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2)
}

// Convert feet + inches decimal to total inches
export function ftInToInches(ft: number, inVal: number): number {
  return ft * 12 + inVal
}

// Snap to nearest 1/16"
export function snap16(inches: number): number {
  return Math.round(inches * 16) / 16
}

// Snap to nearest 1/4" grid
export function snapToGrid(inches: number, gridInches = 0.25): number {
  return Math.round(inches / gridInches) * gridInches
}

// Snap a point to the nearest wall endpoint or midpoint, returns snapped [x, z] or original if none close enough
export function snapToWallEndpoints(
  x: number, z: number,
  walls: { id: string; x1: number; z1: number; x2: number; z2: number }[],
  threshold = 2,
  excludeWallId?: string,
): [number, number] {
  let best = threshold
  let sx = x, sz = z
  for (const w of walls) {
    if (w.id === excludeWallId) continue
    const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2
    for (const [ex, ez] of [[w.x1, w.z1], [w.x2, w.z2], [mx, mz]] as [number, number][]) {
      const d = Math.hypot(ex - x, ez - z)
      if (d < best) { best = d; sx = ex; sz = ez }
    }
  }
  return [sx, sz]
}

// Snap a point to the nearest floor polygon edge (corners + edge midpoints)
export function snapToFloorEdge(
  x: number, z: number,
  floorPoints: { x: number; z: number }[],
  threshold = 2,
): [number, number] {
  if (floorPoints.length < 2) return [x, z]
  let best = threshold
  let sx = x, sz = z

  for (let i = 0; i < floorPoints.length; i++) {
    const a = floorPoints[i]
    const b = floorPoints[(i + 1) % floorPoints.length]

    // Snap to corner
    const dc = Math.hypot(x - a.x, z - a.z)
    if (dc < best) { best = dc; sx = a.x; sz = a.z }

    // Snap to nearest point on edge (not at endpoints)
    const ex = b.x - a.x, ez = b.z - a.z
    const lenSq = ex * ex + ez * ez
    if (lenSq < 1) continue
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / lenSq))
    if (t > 0.01 && t < 0.99) {
      const nx = a.x + t * ex, nz = a.z + t * ez
      const d = Math.hypot(x - nx, z - nz)
      if (d < best) { best = d; sx = nx; sz = nz }
    }
  }
  return [sx, sz]
}

// ---------------------------------------------------------------------------
// Snap overhead rack edge to nearest wall inner face or corner
// Returns snapped { x, z } and optional snap info for visual indicators
// ---------------------------------------------------------------------------
export interface RackSnapResult {
  x: number
  z: number
  snappedWallId?: string
  snapAxis?: 'x' | 'z'  // which axis was snapped
  snapEdge?: number      // the wall edge coordinate that was snapped to
}

export function snapRackToWalls(
  rackX: number,
  rackZ: number,
  rackWidth: number,
  rackLength: number,
  rotY: number,
  walls: { id: string; x1: number; z1: number; x2: number; z2: number; thickness: number }[],
  threshold = 2,
): RackSnapResult {
  // Compute rack's 4 corner positions
  const hw = rackWidth / 2
  const hl = rackLength / 2
  const cos = Math.cos(rotY), sin = Math.sin(rotY)
  const localCorners = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]]
  const corners = localCorners.map(([lx, lz]) => ({
    x: rackX + lx * cos - lz * sin,
    z: rackZ + lx * sin + lz * cos,
  }))

  // Rack bounding edges (min/max of corners)
  const rMinX = Math.min(...corners.map(c => c.x))
  const rMaxX = Math.max(...corners.map(c => c.x))
  const rMinZ = Math.min(...corners.map(c => c.z))
  const rMaxZ = Math.max(...corners.map(c => c.z))

  let bestDx = threshold + 1
  let bestDz = threshold + 1
  let snapX = rackX
  let snapZ = rackZ
  let snappedWallId: string | undefined
  let snapAxis: 'x' | 'z' | undefined
  let snapEdge: number | undefined

  for (const w of walls) {
    const ht = w.thickness / 2

    // Determine if this wall is primarily horizontal (along X) or vertical (along Z)
    const dx = Math.abs(w.x2 - w.x1)
    const dz = Math.abs(w.z2 - w.z1)

    if (dz > dx) {
      // Vertical wall (runs along Z axis) — snaps on X
      const wallCenterX = (w.x1 + w.x2) / 2
      const innerLeft = wallCenterX + ht   // inner face (right side)
      const innerRight = wallCenterX - ht  // inner face (left side)

      // Check rack's left edge against wall's right inner face
      const dLeft = Math.abs(rMinX - innerLeft)
      if (dLeft < bestDx) {
        bestDx = dLeft
        snapX = rackX + (innerLeft - rMinX)
        snappedWallId = w.id
        snapAxis = 'x'
        snapEdge = innerLeft
      }
      // Check rack's right edge against wall's left inner face
      const dRight = Math.abs(rMaxX - innerRight)
      if (dRight < bestDx) {
        bestDx = dRight
        snapX = rackX + (innerRight - rMaxX)
        snappedWallId = w.id
        snapAxis = 'x'
        snapEdge = innerRight
      }
    } else {
      // Horizontal wall (runs along X axis) — snaps on Z
      const wallCenterZ = (w.z1 + w.z2) / 2
      const innerTop = wallCenterZ + ht    // inner face (bottom side)
      const innerBottom = wallCenterZ - ht  // inner face (top side)

      // Check rack's top edge against wall's bottom inner face
      const dTop = Math.abs(rMinZ - innerTop)
      if (dTop < bestDz) {
        bestDz = dTop
        snapZ = rackZ + (innerTop - rMinZ)
        snappedWallId = w.id
        snapAxis = 'z'
        snapEdge = innerTop
      }
      // Check rack's bottom edge against wall's top inner face
      const dBottom = Math.abs(rMaxZ - innerBottom)
      if (dBottom < bestDz) {
        bestDz = dBottom
        snapZ = rackZ + (innerBottom - rMaxZ)
        snappedWallId = w.id
        snapAxis = 'z'
        snapEdge = innerBottom
      }
    }
  }

  // Apply snapping — allow both axes to snap independently (for corner snapping)
  const result: RackSnapResult = { x: rackX, z: rackZ }
  if (bestDx <= threshold) {
    result.x = snapX
    result.snappedWallId = snappedWallId
    result.snapAxis = 'x'
    result.snapEdge = snapEdge
  }
  if (bestDz <= threshold) {
    result.z = snapZ
    if (!result.snappedWallId) result.snappedWallId = snappedWallId
    result.snapAxis = bestDz < bestDx ? 'z' : result.snapAxis
    if (bestDz < bestDx) result.snapEdge = snapEdge
  }
  // If both snapped, it's a corner snap
  if (bestDx <= threshold && bestDz <= threshold) {
    result.x = snapX
    result.z = snapZ
    result.snapAxis = undefined // both axes = corner
  }
  return result
}

// Snap wall endpoint to nearest 45° angle while keeping wall length the same
export function snapAngle(
  x1: number, z1: number,
  x2: number, z2: number,
  thresholdDeg = 5,
): [number, number] {
  const dx = x2 - x1, dz = z2 - z1
  const length = Math.hypot(dx, dz)
  if (length < 1) return [x2, z2]

  const angleDeg = Math.atan2(dz, dx) * (180 / Math.PI)
  const snappedDeg = Math.round(angleDeg / 45) * 45
  // Normalize diff to [-180, 180]
  const diff = ((angleDeg - snappedDeg + 540) % 360) - 180

  if (Math.abs(diff) < thresholdDeg) {
    const rad = snappedDeg * (Math.PI / 180)
    return [x1 + length * Math.cos(rad), z1 + length * Math.sin(rad)]
  }
  return [x2, z2]
}
