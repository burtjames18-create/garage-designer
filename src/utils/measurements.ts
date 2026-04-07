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
  threshold = 6,
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
  threshold = 10,
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
