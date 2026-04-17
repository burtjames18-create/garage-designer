import type { GarageWall, FloorPoint } from '../store/garageStore'

/** Walk the wall graph to produce the interior floor polygon in-order.
 *  Returns null if the walls don't form a simple closed loop. */
export function wallsToFloorPolygon(walls: GarageWall[]): FloorPoint[] | null {
  if (walls.length < 3) return null

  const nodes: { x: number; z: number }[] = []
  function nodeIdx(x: number, z: number): number {
    const i = nodes.findIndex(n => Math.hypot(n.x - x, n.z - z) < 6)
    if (i >= 0) return i
    nodes.push({ x, z })
    return nodes.length - 1
  }

  const adj = new Map<number, number[]>()
  for (const w of walls) {
    const a = nodeIdx(w.x1, w.z1)
    const b = nodeIdx(w.x2, w.z2)
    if (a === b) continue
    if (!adj.has(a)) adj.set(a, [])
    if (!adj.has(b)) adj.set(b, [])
    adj.get(a)!.push(b)
    adj.get(b)!.push(a)
  }

  if (nodes.length < 3) return null
  for (const neighbors of adj.values()) {
    if (neighbors.length !== 2) return null
  }

  const polygon: FloorPoint[] = []
  let prev = -1, cur = 0
  for (let i = 0; i < nodes.length; i++) {
    polygon.push({ x: nodes[cur].x, z: nodes[cur].z })
    const next = (adj.get(cur) ?? []).find(n => n !== prev)
    if (next === undefined || next === 0) break
    prev = cur
    cur = next
  }

  return polygon.length >= 3 ? polygon : null
}

/** Convex hull fallback — always produces a valid polygon from any set of
 *  wall endpoints. Used when the wall graph isn't a simple closed loop. */
export function convexHullFromWalls(walls: GarageWall[]): FloorPoint[] {
  const pts: { x: number; z: number }[] = []
  for (const w of walls) {
    pts.push({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 })
  }
  if (pts.length < 3) return pts
  pts.sort((a, b) => a.x !== b.x ? a.x - b.x : a.z - b.z)
  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) =>
    (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x)
  const lower: typeof pts = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: typeof pts = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return [...lower, ...upper]
}

/** Match GarageShell's `effectiveFloorPts` logic — the live floor polygon
 *  used by the 3D renderer. Derived from walls (not from the stored
 *  floorPoints, which may be stale after resizing). */
export function effectiveFloorPolygon(walls: GarageWall[], fallback: FloorPoint[]): FloorPoint[] {
  return wallsToFloorPolygon(walls)
    ?? (walls.length >= 3 ? convexHullFromWalls(walls) : fallback)
}
