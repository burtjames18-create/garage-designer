// Shared wall-relative geometry helpers. Previously these were duplicated
// across FloorPlanBlueprint / WallElevationView / WallElevationBlueprint /
// ExportModal / GarageShell — canonicalized here so every view computes
// projections and "on-wall" checks the same way.

import type {
  GarageWall,
  PlacedCabinet,
  Countertop,
  FloorPoint,
  FloorStep,
} from '../store/garageStore'
import { COUNTERTOP_DEPTH } from '../store/garageStore'

/** Wall length (inches). Returns 0 for zero-length (degenerate) walls. */
export function wallLen(w: GarageWall): number {
  return Math.hypot(w.x2 - w.x1, w.z2 - w.z1)
}

/** Along-wall unit vector [ux, uz]. Falls back to [1, 0] for degenerate walls. */
export function wallDir(w: GarageWall): [number, number] {
  const len = wallLen(w)
  if (len < 0.01) return [1, 0]
  return [(w.x2 - w.x1) / len, (w.z2 - w.z1) / len]
}

/** Wall normal pointing INTO the garage (toward origin). */
export function wallNormal(w: GarageWall): [number, number] {
  const [dx, dz] = wallDir(w)
  const n1: [number, number] = [-dz, dx]
  const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2
  return (n1[0] * (-mx) + n1[1] * (-mz)) > 0 ? n1 : [dz, -dx]
}

/** Project a cabinet onto a wall's axis. `along` = distance from w.x1/z1 along
 *  the wall; `perp` = absolute perpendicular distance to the wall centerline. */
export function projectCabinet(cab: PlacedCabinet, w: GarageWall): { along: number; perp: number } {
  if (wallLen(w) < 0.01) return { along: 0, perp: 99999 }
  const [dx, dz] = wallDir(w)
  const vx = cab.x - w.x1, vz = cab.z - w.z1
  return { along: vx * dx + vz * dz, perp: Math.abs(vx * (-dz) + vz * dx) }
}

/** Which side ('interior' / 'exterior') of a wall a cabinet is on. Corner
 *  cabinets are always classified as 'interior' since they sit inside the
 *  garage corner. */
export function cabinetWallSide(cab: PlacedCabinet, w: GarageWall): 'interior' | 'exterior' {
  if (cab.style === 'corner-upper') return 'interior'
  const [dx, dz] = wallDir(w)
  const intRotY = Math.atan2(-dz, dx)
  let diff = Math.abs(cab.rotY - intRotY) % (Math.PI * 2)
  if (diff > Math.PI) diff = Math.PI * 2 - diff
  return diff < Math.PI / 4 ? 'interior' : 'exterior'
}

/** Is a cabinet attached to this wall? Optional `side` narrows further. */
export function isCabinetOnWall(cab: PlacedCabinet, w: GarageWall, side?: 'interior' | 'exterior'): boolean {
  const len = wallLen(w)
  const { along, perp } = projectCabinet(cab, w)
  if (perp > cab.d / 2 + w.thickness / 2 + 10) return false
  if (along <= -cab.w / 2 || along >= len + cab.w / 2) return false
  // Accept either wall-facing direction — the side filter below narrows it.
  // Corner cabinets have two 24" back walls 90° apart, so they may also be
  // flush to a wall at ±90° from the nominal rotation.
  const [dx, dz] = wallDir(w)
  const rotA = Math.atan2(-dz, dx)
  const rotB = rotA + Math.PI
  const angDiff = (target: number): number => {
    let d = Math.abs(cab.rotY - target) % (Math.PI * 2)
    if (d > Math.PI) d = Math.PI * 2 - d
    return d
  }
  const facesA = angDiff(rotA) < Math.PI / 4
  const facesB = angDiff(rotB) < Math.PI / 4
  let faces = facesA || facesB
  if (!faces && cab.style === 'corner-upper') {
    const facesA90p = angDiff(rotA + Math.PI / 2) < Math.PI / 4
    const facesA90n = angDiff(rotA - Math.PI / 2) < Math.PI / 4
    faces = facesA90p || facesA90n
  }
  if (!faces) return false
  if (side && cabinetWallSide(cab, w) !== side) return false
  return true
}

/** Project a countertop onto a wall's axis. */
export function projectCountertop(ct: Countertop, w: GarageWall): { along: number; perp: number } {
  if (wallLen(w) < 0.01) return { along: 0, perp: 99999 }
  const [dx, dz] = wallDir(w)
  const vx = ct.x - w.x1, vz = ct.z - w.z1
  return { along: vx * dx + vz * dz, perp: Math.abs(vx * (-dz) + vz * dx) }
}

/** Is a countertop attached to this wall? */
export function isCountertopOnWall(ct: Countertop, w: GarageWall): boolean {
  const len = wallLen(w)
  const { along, perp } = projectCountertop(ct, w)
  return perp <= COUNTERTOP_DEPTH / 2 + w.thickness / 2 + 10 &&
    along > -ct.width / 2 && along < len + ct.width / 2
}

/** Project a floor step onto a wall. Returns the along-wall range where the
 *  step touches (or is within `tolerance`") of the wall, or null if the step
 *  isn't adjacent to this wall at all. */
export function getStepWallProjection(
  step: FloorStep,
  w: GarageWall,
  tolerance = 6,
): { alongStart: number; alongEnd: number; height: number } | null {
  const len = wallLen(w)
  if (len < 0.01) return null
  const [ux, uz] = wallDir(w)
  const nx = -uz, nz = ux
  let minU = Infinity, maxU = -Infinity
  let minV = Infinity, maxV = -Infinity
  for (const [px, pz] of step.corners) {
    const u = (px - w.x1) * ux + (pz - w.z1) * uz
    const v = (px - w.x1) * nx + (pz - w.z1) * nz
    minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    minV = Math.min(minV, v); maxV = Math.max(maxV, v)
  }
  const halfThick = w.thickness / 2
  if (maxV < -(halfThick + tolerance) || minV > halfThick + tolerance) return null
  const u0 = Math.max(0, minU), u1 = Math.min(len, maxU)
  if (u1 <= u0) return null
  return { alongStart: u0, alongEnd: u1, height: step.height }
}

/** Ray-casting point-in-polygon for `FloorPoint[]` (objects with x/z). */
export function pointInPolygon(x: number, z: number, pts: FloorPoint[]): boolean {
  if (pts.length < 3) return true
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, zi = pts[i].z
    const xj = pts[j].x, zj = pts[j].z
    const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

/** Ray-casting point-in-polygon for `[x, z]` tuples (used by floor steps). */
export function pointInPoly(x: number, z: number, corners: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    const [xi, zi] = corners[i]
    const [xj, zj] = corners[j]
    const intersect = ((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
