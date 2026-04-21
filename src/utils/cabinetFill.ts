// Auto-fill a wall with stock-size cabinets. Given a wall and a target style
// (lower / upper / locker), computes the optimal packing of stock widths into
// each fillable stretch between openings, and returns world-space placements
// that WallPanel/consumers can feed straight into addCabinet().

import type { CabinetPreset, GarageWall } from '../store/garageStore'
import { CABINET_PRESETS } from '../store/garageStore'
import { wallDir, wallLen, wallNormal } from './wallGeometry'

export type FillStyle = 'lower' | 'upper' | 'locker'
export type FillLine = 'technica' | 'signature'
export type FillSide = 'interior' | 'exterior'

export interface FillPlacement {
  preset: CabinetPreset
  x: number
  z: number
  rotY: number
}

/** Best packing of stock widths into targetLen using integer-inch DP. Returns
 *  the list of widths (largest-first) whose sum is ≤ targetLen and as close to
 *  it as possible. If no combination fits, returns []. */
export function fitCabinetWidths(targetLen: number, stockWidths: number[]): number[] {
  const target = Math.floor(targetLen)
  if (target <= 0 || stockWidths.length === 0) return []
  // Iterate largest-first so pick[] biases toward fewer, bigger cabinets.
  const sorted = [...stockWidths].sort((a, b) => b - a)
  const dp = new Array(target + 1).fill(false)
  const pick = new Array(target + 1).fill(-1)
  dp[0] = true
  for (let len = 1; len <= target; len++) {
    for (const w of sorted) {
      if (w <= len && dp[len - w]) {
        dp[len] = true
        pick[len] = w
        break
      }
    }
  }
  // Largest reachable length ≤ target.
  let best = target
  while (best > 0 && !dp[best]) best--
  const result: number[] = []
  let cur = best
  while (cur > 0) {
    const w = pick[cur]
    if (w <= 0) break
    result.push(w)
    cur -= w
  }
  return result.sort((a, b) => b - a)
}

/** Walls are divided into stretches by doorway/window openings. This returns
 *  each unobstructed stretch in wall-local inches (0 = wall start). Skips
 *  stretches shorter than `minSegmentLen` since no cabinet would fit anyway. */
export function wallFillableSegments(wall: GarageWall, minSegmentLen = 12): { start: number; end: number }[] {
  const total = wallLen(wall)
  if (total <= 0) return []
  const sorted = [...wall.openings].sort((a, b) => a.xOffset - b.xOffset)
  const segs: { start: number; end: number }[] = []
  let cursor = 0
  for (const op of sorted) {
    const opStart = Math.max(0, op.xOffset)
    const opEnd = Math.min(total, op.xOffset + op.width)
    if (opStart - cursor >= minSegmentLen) segs.push({ start: cursor, end: opStart })
    cursor = Math.max(cursor, opEnd)
  }
  if (total - cursor >= minSegmentLen) segs.push({ start: cursor, end: total })
  return segs
}

export interface FillOptions {
  wall: GarageWall
  style: FillStyle
  line?: FillLine       // default 'technica'
  side?: FillSide       // default 'interior'
}

/** Plan cabinet placements to fill every open stretch of a wall with
 *  stock-size cabinets of the given style. Returns an array of placements
 *  ready to pass to addCabinet(). */
export function planWallFill({ wall, style, line = 'technica', side = 'interior' }: FillOptions): FillPlacement[] {
  // One preset per distinct width for this line + style. Prefer whichever
  // preset CABINET_PRESETS lists first — usually the simple door/drawer mix.
  const widthPresetMap = new Map<number, CabinetPreset>()
  for (const p of CABINET_PRESETS) {
    if (p.line !== line || p.style !== style) continue
    if (!widthPresetMap.has(p.w)) widthPresetMap.set(p.w, p)
  }
  const widths = [...widthPresetMap.keys()]
  if (widths.length === 0) return []

  const [ux, uz] = wallDir(wall)
  const [nx0, nz0] = wallNormal(wall)  // points toward garage interior
  const nxSide = side === 'interior' ? nx0 : -nx0
  const nzSide = side === 'interior' ? nz0 : -nz0
  // Cabinet rotY convention (see cabinetWallSide in wallGeometry): rotY =
  // atan2(-uz, ux) places the FRONT of the cabinet facing the interior side
  // of the wall. Flip by PI for exterior-facing fills.
  const faceRotY = side === 'interior'
    ? Math.atan2(-uz, ux)
    : Math.atan2(-uz, ux) + Math.PI

  const placements: FillPlacement[] = []
  for (const seg of wallFillableSegments(wall)) {
    const segLen = seg.end - seg.start
    const fitted = fitCabinetWidths(segLen, widths)
    // Center the cabinet row inside the segment when there's a small leftover,
    // so the gap splits equally on both ends rather than all ending up at the
    // far end. For an exact fit this is a no-op.
    const totalFitted = fitted.reduce((sum, w) => sum + w, 0)
    let along = seg.start + (segLen - totalFitted) / 2
    for (const w of fitted) {
      const preset = widthPresetMap.get(w)
      if (!preset) continue
      const alongCenter = along + w / 2
      const perpOffset = wall.thickness / 2 + preset.d / 2
      const x = wall.x1 + ux * alongCenter + nxSide * perpOffset
      const z = wall.z1 + uz * alongCenter + nzSide * perpOffset
      placements.push({ preset, x, z, rotY: faceRotY })
      along += w
    }
  }
  return placements
}
