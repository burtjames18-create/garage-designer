import { useMemo, useRef, useCallback, useEffect, useState, Suspense, Component, memo } from 'react'
import type { ReactNode, JSX } from 'react'
import { useTexture, Text, useGLTF, MeshReflectorMaterial, RoundedBox, Edges } from '@react-three/drei'
import { useThree, useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useGarageStore, COUNTERTOP_DEPTH, COUNTERTOP_THICKNESS, CEILING_LIGHT_W, CEILING_LIGHT_L, CEILING_LIGHT_TH, RACK_DECK_THICKNESS, RACK_LEG_SIZE } from '../store/garageStore'
import type { GarageWall, GarageShape, FloorPoint, SlatwallPanel, StainlessBacksplashPanel, SlatwallAccessory, PlacedCabinet, Countertop, CeilingLight, PlacedItem, FloorStep, OverheadRack, WallOpening } from '../store/garageStore'
import { stepBounds } from '../store/garageStore'
import { slatwallColors } from '../data/slatwallColors'
import { getTextureById, texturePath } from '../data/textureCatalog'
import { flooringTexturePathById } from '../data/flooringColors'
import { getOpeningModelById } from '../data/openingModels'
import { MODEL_CATALOG, CATEGORY_COLORS } from '../data/modelCatalog'
import WildfireLift from './WildfireLift'
import { getCachedModelUrl, restoreModelFromDB } from '../utils/importedModelCache'
import { getLibraryModels } from '../utils/modelLibrary'
import {
  wallLengthIn, inchesToDisplay, snapToGrid,
  snapToFloorEdge, snapAngle, snapRackToWalls,
  cameraFloorPos,
} from '../utils/measurements'
import { pointInPolygon, pointInPoly, wallDir, wallNormal } from '../utils/wallGeometry'
import { createButcherBlockTexture } from '../utils/butcherBlockTexture'
import { effectiveFloorPolygon } from '../utils/floorPolygon'
import * as THREE from 'three'

const FT = (inches: number) => inches / 12

// Pre-allocated Three.js objects for drag handler — avoids GC pressure during drag
const _tmpNdc    = new THREE.Vector2()
const _tmpVec3   = new THREE.Vector3()
const _tmpVec3b  = new THREE.Vector3()
const _tmpNormal = new THREE.Vector3()
const _tmpPlane  = new THREE.Plane()

function getFloorBounds(walls: GarageWall[]) {
  if (walls.length === 0) return { minX: -120, maxX: 120, minZ: -120, maxZ: 120 }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  walls.forEach(w => {
    minX = Math.min(minX, w.x1, w.x2); maxX = Math.max(maxX, w.x1, w.x2)
    minZ = Math.min(minZ, w.z1, w.z2); maxZ = Math.max(maxZ, w.z1, w.z2)
  })
  return { minX, maxX, minZ, maxZ }
}

// ─── Build wall segments around openings ─────────────────────────────────────
interface WallSeg { x0: number; x1: number; y0: number; y1: number }

function buildWallSegments(wall: GarageWall, lengthIn: number): WallSeg[] {
  const wallY0 = wall.yOffset
  const wallY1 = wall.yOffset + wall.height
  // Filter out openings that have a GLB 3D model — those don't need a wall cutout.
  // Procedural doors (e.g. 'custom-plain') DO need a cutout because the slab sits
  // inside the opening rather than replacing the wall panel wholesale.
  const cutOpenings = wall.openings.filter(op => {
    if (!op.modelId) return true
    const entry = getOpeningModelById(op.modelId)
    return !entry || entry.kind === 'procedural'
  })
  if (cutOpenings.length === 0) {
    return [{ x0: 0, x1: lengthIn, y0: wallY0, y1: wallY1 }]
  }
  const sorted = [...cutOpenings].sort((a, b) => a.xOffset - b.xOffset)
  const segs: WallSeg[] = []
  let cursor = 0
  for (const op of sorted) {
    const opLeft  = Math.max(0, op.xOffset)
    const opRight = Math.min(lengthIn, op.xOffset + op.width)
    const opBot   = Math.max(wallY0, op.yOffset)
    const opTop   = Math.min(wallY1, op.yOffset + op.height)
    if (opLeft > cursor) segs.push({ x0: cursor, x1: opLeft, y0: wallY0, y1: wallY1 })
    if (opBot > wallY0)  segs.push({ x0: opLeft, x1: opRight, y0: wallY0, y1: opBot })
    if (opTop < wallY1)  segs.push({ x0: opLeft, x1: opRight, y0: opTop,  y1: wallY1 })
    cursor = opRight
  }
  if (cursor < lengthIn) segs.push({ x0: cursor, x1: lengthIn, y0: wallY0, y1: wallY1 })
  return segs
}

// ─── Step-up baseboard elevation helpers ────────────────────────────────────
// Returns the along-wall range (in wall-local 0..lengthIn space) where a step-up
// is adjacent to this wall, so the baseboard can be rendered elevated.
function getStepWallOverlaps(
  wall: GarageWall,
  step: FloorStep,
  lengthIn: number,
  tolerance = 6,
): { u0: number; u1: number; stepHeight: number }[] {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const len = Math.hypot(dx, dz)
  if (len < 1) return []
  const ux = dx / len, uz = dz / len
  const nx = -uz, nz = ux   // wall normal

  const corners = step.corners

  let minU = Infinity, maxU = -Infinity
  let minV = Infinity, maxV = -Infinity
  for (const [px, pz] of corners) {
    const u = (px - wall.x1) * ux + (pz - wall.z1) * uz
    const v = (px - wall.x1) * nx + (pz - wall.z1) * nz
    minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    minV = Math.min(minV, v); maxV = Math.max(maxV, v)
  }

  // Step must be within (halfThick + tolerance) of the wall centerline
  const halfThick = wall.thickness / 2
  if (maxV < -(halfThick + tolerance) || minV > halfThick + tolerance) return []

  const u0 = Math.max(0, minU)
  const u1 = Math.min(lengthIn, maxU)
  if (u1 <= u0) return []

  return [{ u0, u1, stepHeight: step.height }]
}

/** Intersect 2D ray (ax,az)+(t*dx,t*dz) with (bx,bz)+(s*ex,s*ez). Returns t. */
function lineIntersectT(
  ax: number, az: number, dx: number, dz: number,
  bx: number, bz: number, ex: number, ez: number,
): number {
  const det = dx * (-ez) - dz * (-ex)
  if (Math.abs(det) < 1e-6) return NaN
  return ((bx - ax) * (-ez) - (bz - az) * (-ex)) / det
}

/** Project baseboards/stemwalls onto a wall and return along-axis overlaps.
 *  Used to add baseboard heights as Y-snap targets during cabinet placement. */
function getBaseboardWallOverlaps(
  wall: GarageWall,
  pieces: { x: number; z: number; rotY: number; length: number; height: number; y: number; thickness: number }[],
  wallLen: number,
): { u0: number; u1: number; bbTop: number }[] {
  const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
  const wl = Math.hypot(wdx, wdz)
  if (wl < 0.1) return []
  const wux = wdx / wl, wuz = wdz / wl
  const wnx = -wuz, wnz = wux
  const results: { u0: number; u1: number; bbTop: number }[] = []
  for (const bb of pieces) {
    const bux = Math.cos(bb.rotY), buz = -Math.sin(bb.rotY)
    const halfL = bb.length / 2
    const ends: [number, number][] = [
      [bb.x - bux * halfL, bb.z - buz * halfL],
      [bb.x + bux * halfL, bb.z + buz * halfL],
    ]
    const perpDist = Math.abs((bb.x - wall.x1) * wnx + (bb.z - wall.z1) * wnz)
    if (perpDist > wall.thickness / 2 + bb.thickness + 6) continue
    let minU = Infinity, maxU = -Infinity
    for (const [px, pz] of ends) {
      const u = (px - wall.x1) * wux + (pz - wall.z1) * wuz
      minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    }
    const u0 = Math.max(0, minU), u1 = Math.min(wallLen, maxU)
    if (u1 - u0 < 0.5) continue
    results.push({ u0, u1, bbTop: bb.y + bb.height })
  }
  return results
}

/** Outer casing extension (inches) along the wall for a given opening.
 *  Procedural doors render casing trim `CASING_W` past the cut-out; items on
 *  the wall should snap to the visible outside of the trim, not the rough
 *  opening. Returns 0 for openings without trim (GLB / flat-panel / windows). */
function openingCasingExt(op: WallOpening): number {
  if (!op.modelId) return 0
  const entry = getOpeningModelById(op.modelId)
  if (entry?.kind !== 'procedural') return 0
  return PDOOR.CASING_W
}

/** Snap an along-wall span [start, end] so either edge lands on a doorway or
 *  window opening edge, whichever is closest and within `threshold` inches.
 *  Length is preserved — the entire span slides, it does not resize.
 *  Works for any WallOpening type (door, window, garage-door). For procedural
 *  doors the snap target is the OUTER edge of the casing trim. */
function snapSpanToOpeningEdges(
  startIn: number,
  endIn: number,
  openings: WallOpening[],
  threshold = 2,
): { start: number; end: number } {
  const len = endIn - startIn
  let best = { start: startIn, end: endIn, dist: threshold }
  for (const op of openings) {
    const ext = openingCasingExt(op)
    const edges = [op.xOffset - ext, op.xOffset + op.width + ext]
    for (const edge of edges) {
      const dL = Math.abs(startIn - edge)
      if (dL < best.dist) best = { start: edge, end: edge + len, dist: dL }
      const dR = Math.abs(endIn - edge)
      if (dR < best.dist) best = { start: edge - len, end: edge, dist: dR }
    }
  }
  return { start: best.start, end: best.end }
}

/** An entry in a wall chain, with start/end in chain traversal order. */
interface ChainEntry {
  wall: GarageWall
  x1: number; z1: number
  x2: number; z2: number
  reversed: boolean  // wall was traversed x2→x1 to fit the chain order
}

/** Find connected wall chains (ordered start→end). */
function findWallChains(walls: GarageWall[], thresh = 6): ChainEntry[][] {
  const used = new Set<string>()
  const chains: ChainEntry[][] = []
  for (const seed of walls) {
    if (used.has(seed.id)) continue
    const chain: ChainEntry[] = [{ wall: seed, x1: seed.x1, z1: seed.z1, x2: seed.x2, z2: seed.z2, reversed: false }]
    used.add(seed.id)
    // extend forward
    let ex = seed.x2, ez = seed.z2
    fwd: for (;;) {
      for (const w of walls) {
        if (used.has(w.id)) continue
        if (Math.hypot(w.x1 - ex, w.z1 - ez) < thresh) {
          chain.push({ wall: w, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, reversed: false })
          used.add(w.id); ex = w.x2; ez = w.z2; continue fwd
        }
        if (Math.hypot(w.x2 - ex, w.z2 - ez) < thresh) {
          chain.push({ wall: w, x1: w.x2, z1: w.z2, x2: w.x1, z2: w.z1, reversed: true })
          used.add(w.id); ex = w.x1; ez = w.z1; continue fwd
        }
      }
      break
    }
    // extend backward
    let sx = chain[0].x1, sz = chain[0].z1
    bwd: for (;;) {
      for (const w of walls) {
        if (used.has(w.id)) continue
        if (Math.hypot(w.x2 - sx, w.z2 - sz) < thresh) {
          chain.unshift({ wall: w, x1: w.x1, z1: w.z1, x2: w.x2, z2: w.z2, reversed: false })
          used.add(w.id); sx = w.x1; sz = w.z1; continue bwd
        }
        if (Math.hypot(w.x1 - sx, w.z1 - sz) < thresh) {
          chain.unshift({ wall: w, x1: w.x2, z1: w.z2, x2: w.x1, z2: w.z1, reversed: true })
          used.add(w.id); sx = w.x2; sz = w.z2; continue bwd
        }
      }
      break
    }
    chains.push(chain)
  }
  return chains
}


// ─── Snap: wall endpoints + shape centers + floor edges ──────────────────────
/** Return value: [snappedX, snappedZ, snappedToWall, lockDirection]. When
 *  `lockDirection` is true the snapped point is a DISCRETE fixed target
 *  (centerline endpoint or face corner) and callers should use the snap
 *  as-is. When false the snap is a face-line projection; callers should
 *  apply the 45° angle constraint first and then re-project onto the face. */
function snapToTargets(
  x: number, z: number,
  walls: GarageWall[],
  shapes: GarageShape[],
  floorPts: FloorPoint[],
  excludeWallId?: string,
  excludeShapeId?: string,
  threshold = 6,
): [number, number, boolean, boolean] {
  // Deduplicate wall endpoints — merge any that are within 2" of each other
  // so a shared corner counts as ONE snap target, not two
  const wallPts: [number, number][] = []
  for (const w of walls) {
    if (w.id === excludeWallId) continue
    for (const [wx, wz] of [[w.x1, w.z1], [w.x2, w.z2]] as [number, number][]) {
      if (!wallPts.some(([px, pz]) => Math.hypot(px - wx, pz - wz) < 2)) {
        wallPts.push([wx, wz])
      }
    }
  }

  // Wall endpoints get a slightly generous threshold so corners feel magnetic
  const wallThresh = Math.max(threshold, 8)
  let bestDist = wallThresh
  let bx = x, bz = z
  let snappedToWall = false
  let lockDirection = false  // true = discrete corner; false = face-line slide

  // (1) Centerline endpoints — end-to-end wall corner connection
  for (const [wx, wz] of wallPts) {
    const d = Math.hypot(x - wx, z - wz)
    if (d < bestDist) { bestDist = d; bx = wx; bz = wz; snappedToWall = true; lockDirection = true }
  }

  // (2) Face corners — each wall endpoint offset ±halfT along the normal.
  //     These catch T-junctions where one wall abuts another wall's face
  //     at the far wall's end. Same magnetic threshold as centerline corners.
  for (const w of walls) {
    if (w.id === excludeWallId) continue
    const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
    const len = Math.hypot(wdx, wdz)
    if (len < 0.1) continue
    const ux = wdx / len, uz = wdz / len
    const nx = -uz, nz = ux
    const halfT = w.thickness / 2
    const fc: [number, number][] = [
      [w.x1 + nx * halfT, w.z1 + nz * halfT],
      [w.x1 - nx * halfT, w.z1 - nz * halfT],
      [w.x2 + nx * halfT, w.z2 + nz * halfT],
      [w.x2 - nx * halfT, w.z2 - nz * halfT],
    ]
    for (const [fx, fz] of fc) {
      const d = Math.hypot(x - fx, z - fz)
      if (d < bestDist) { bestDist = d; bx = fx; bz = fz; snappedToWall = true; lockDirection = true }
    }
  }

  // (3) Face-line projection — dragged endpoint lands on another wall's
  //     interior/exterior face at the cursor's perpendicular foot (clamped
  //     to segment). Runs after centerline/face-corner checks so the
  //     discrete fixed points win when you're near them; face snap kicks
  //     in only when you're clearly along the middle of a wall face.
  //     `lockDirection` stays FALSE for these so callers can apply a 45°
  //     angle snap on top (then re-project onto the face).
  for (const w of walls) {
    if (w.id === excludeWallId) continue
    const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
    const len = Math.hypot(wdx, wdz)
    if (len < 0.1) continue
    const ux = wdx / len, uz = wdz / len
    const nx = -uz, nz = ux
    const halfT = w.thickness / 2
    const relX = x - w.x1, relZ = z - w.z1
    const along = relX * ux + relZ * uz
    if (along < -threshold || along > len + threshold) continue
    const alongClamped = Math.max(0, Math.min(len, along))
    for (const side of [halfT, -halfT]) {
      const fx = w.x1 + ux * alongClamped + nx * side
      const fz = w.z1 + uz * alongClamped + nz * side
      const d = Math.hypot(x - fx, z - fz)
      if (d < bestDist) { bestDist = d; bx = fx; bz = fz; snappedToWall = true; lockDirection = false }
    }
  }

  // (4) Shapes + floor edges — only when no wall target is in range
  if (!snappedToWall) {
    for (const sh of shapes) {
      if (sh.id === excludeShapeId) continue
      const d = Math.hypot(x - sh.x, z - sh.z)
      if (d < threshold && d < bestDist) { bestDist = d; bx = sh.x; bz = sh.z }
    }
    const [fx, fz] = snapToFloorEdge(x, z, floorPts, threshold)
    const fd = Math.hypot(x - fx, z - fz)
    if (fd < bestDist) { bx = fx; bz = fz }
  }

  return [bx, bz, snappedToWall, lockDirection]
}

// ─── Snap shape edge to nearest wall face (with corner alignment) ─────────────
function snapShapeToWalls(
  cx: number, cz: number,
  shapeW: number, shapeD: number,
  walls: GarageWall[],
  threshold = 12,
): { x: number; z: number; baseY: number } | null {
  let bestDist = threshold
  let best: { x: number; z: number; baseY: number } | null = null
  const cornerThresh = 10  // inches — snap edge flush to wall endpoint within this distance

  for (const wall of walls) {
    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 1) continue

    const ux = dx / len, uz = dz / len   // unit vector along wall
    const nx = -uz, nz = ux              // wall normal (one side)

    // Shape half-extents projected onto wall axes
    const halfAlong = Math.abs(ux) * shapeW / 2 + Math.abs(uz) * shapeD / 2

    // Project shape center onto wall coordinate system
    const relX = cx - wall.x1, relZ = cz - wall.z1
    const along = relX * ux + relZ * uz
    const perp  = relX * nx + relZ * nz

    // Skip if shape is entirely outside wall span
    if (along < -halfAlong - cornerThresh || along > len + halfAlong + cornerThresh) continue

    // Desired perp: shape edge flush with wall face
    const side = perp >= 0 ? 1 : -1
    const targetPerp = side * (wall.thickness / 2)
    const dist = Math.abs(perp - targetPerp)

    if (dist < bestDist) {
      bestDist = dist

      // Corner snap: align shape side with adjacent wall's interior face
      // (inset by adjacent wall's thickness/2 so the shape doesn't overlap it).
      const { startInset, endInset } = wallEndInset(wall, walls)
      let snappedAlong = along
      const startTarget = startInset + halfAlong
      const endTarget   = len - endInset - halfAlong
      if (Math.abs(along - startTarget) < cornerThresh) snappedAlong = startTarget
      else if (Math.abs(along - endTarget) < cornerThresh) snappedAlong = endTarget

      const snapX = wall.x1 + snappedAlong * ux + targetPerp * nx
      const snapZ = wall.z1 + snappedAlong * uz + targetPerp * nz
      best = { x: snapX, z: snapZ, baseY: 0 }
    }
  }

  return best
}

// ─── Corner adjustments for walls ────────────────────────────────────────────
/**
 * At each endpoint of a wall, check if another wall connects there.
 * If so, return how far this wall should extend into the corner (inches)
 * so the two walls fill the corner gap with no notch or overlap.
 * Rule: both walls extend by the other's thickness/2 so the corner is solid.
 */
function computeCornerAdj(wall: GarageWall, allWalls: GarageWall[], threshold = 6): {
  startExt: number; endExt: number     // extend past endpoint (claim the corner)
  startTrim: number; endTrim: number   // trim wall body back (yield to adjacent wall)
} {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const len = Math.hypot(dx, dz)
  if (len < 1) return { startExt: 0, endExt: 0, startTrim: 0, endTrim: 0 }
  const ux = dx / len, uz = dz / len

  const myIdx = allWalls.findIndex(w => w.id === wall.id)
  let startExt = 0, endExt = 0, startTrim = 0, endTrim = 0

  for (const other of allWalls) {
    if (other.id === wall.id) continue
    const ox = other.x2 - other.x1, oz = other.z2 - other.z1
    const olen = Math.hypot(ox, oz)
    if (olen < 1) continue
    const cross = Math.abs(ux * (oz / olen) - uz * (ox / olen))
    if (cross < 0.26) continue   // skip near-parallel

    const otherIdx = allWalls.findIndex(w => w.id === other.id)
    // At a shared corner: lower-index wall claims it (extends), other trims
    const weWin = myIdx < otherIdx

    // ── L-corner: other wall's endpoint meets our endpoint ──
    const nearStart =
      Math.hypot(other.x1 - wall.x1, other.z1 - wall.z1) < threshold ||
      Math.hypot(other.x2 - wall.x1, other.z2 - wall.z1) < threshold
    if (nearStart) {
      if (weWin) startExt  = Math.max(startExt,  other.thickness / 2)
      else       startTrim = Math.max(startTrim, other.thickness / 2)
    }

    const nearEnd =
      Math.hypot(other.x1 - wall.x2, other.z1 - wall.z2) < threshold ||
      Math.hypot(other.x2 - wall.x2, other.z2 - wall.z2) < threshold
    if (nearEnd) {
      if (weWin) endExt  = Math.max(endExt,  other.thickness / 2)
      else       endTrim = Math.max(endTrim, other.thickness / 2)
    }

    // ── T-junction: our endpoint meets the BODY of another wall ──
    const oux = ox / olen, ouz = oz / olen
    for (const [epx, epz, isStart] of [
      [wall.x1, wall.z1, true],
      [wall.x2, wall.z2, false],
    ] as [number, number, boolean][]) {
      if (isStart && nearStart) continue
      if (!isStart && nearEnd) continue
      const vx = epx - other.x1, vz = epz - other.z1
      const along = vx * oux + vz * ouz
      const perp = Math.abs(vx * (-ouz) + vz * oux)
      if (along < threshold && along > -threshold) continue
      if (along > olen - threshold && along < olen + threshold) continue
      if (along < -threshold || along > olen + threshold) continue
      if (perp > other.thickness / 2 + threshold) continue
      if (isStart) startTrim = Math.max(startTrim, other.thickness / 2)
      else         endTrim   = Math.max(endTrim,   other.thickness / 2)
    }
  }

  return { startExt, endExt, startTrim, endTrim }
}

/**
 * For a given wall, find how much an object's edge should be inset from each
 * endpoint so its side butts up against the INTERIOR face of any adjacent
 * connecting wall (L-corner or T-junction). Used for corner-snapping any
 * object that mounts flush to a wall face (cabinets, shapes, etc.).
 */
function wallEndInset(wall: GarageWall, allWalls: GarageWall[], connectDist = 6): {
  startInset: number; endInset: number
} {
  let startInset = 0, endInset = 0
  for (const other of allWalls) {
    if (other.id === wall.id) continue
    const nearStart = Math.min(
      Math.hypot(other.x1 - wall.x1, other.z1 - wall.z1),
      Math.hypot(other.x2 - wall.x1, other.z2 - wall.z1),
    ) < connectDist
    const nearEnd = Math.min(
      Math.hypot(other.x1 - wall.x2, other.z1 - wall.z2),
      Math.hypot(other.x2 - wall.x2, other.z2 - wall.z2),
    ) < connectDist
    if (nearStart) startInset = Math.max(startInset, other.thickness / 2)
    if (nearEnd)   endInset   = Math.max(endInset,   other.thickness / 2)
  }
  return { startInset, endInset }
}

// ─── Shape-to-shape snapping ─────────────────────────────────────────────────
// Edge-to-edge snap in X, Z, and Y. Works for box/beam (w × d × h). For a
// cylinder, treat footprint as a (2r × 2r) bounding box.
function shapeHalfExtents(sh: GarageShape): { hx: number; hz: number; hy: number } {
  if (sh.type === 'cylinder') return { hx: sh.r, hz: sh.r, hy: sh.h / 2 }
  return { hx: sh.w / 2, hz: sh.d / 2, hy: sh.h / 2 }
}

function snapShapeToOthers(
  shapeId: string,
  x: number, y: number, z: number,
  hx: number, hy: number, hz: number,
  others: GarageShape[],
  threshold = 6,
): { x: number; y: number; z: number } {
  let bx = x, by = y, bz = z
  let bestX = threshold, bestZ = threshold, bestY = threshold
  // Track the shape that won the Y-stack snap so we can corner-align XZ to it.
  let stackWinner: { sh: GarageShape; ohx: number; ohz: number } | null = null
  let stackWinnerScore = threshold

  for (const sh of others) {
    if (sh.id === shapeId) continue
    const { hx: ohx, hy: ohy, hz: ohz } = shapeHalfExtents(sh)

    const zOverlap = Math.abs(z - sh.z) < hz + ohz + threshold
    const xOverlap = Math.abs(x - sh.x) < hx + ohx + threshold

    // X-axis edge snap — requires Z overlap
    if (zOverlap) {
      const dLR = Math.abs((x - hx) - (sh.x + ohx))
      if (dLR < bestX) { bestX = dLR; bx = sh.x + ohx + hx }
      const dRL = Math.abs((x + hx) - (sh.x - ohx))
      if (dRL < bestX) { bestX = dRL; bx = sh.x - ohx - hx }
      // Same-edge align (top-view X edges flush)
      const dSameL = Math.abs((x - hx) - (sh.x - ohx))
      if (dSameL < bestX) { bestX = dSameL; bx = sh.x - ohx + hx }
      const dSameR = Math.abs((x + hx) - (sh.x + ohx))
      if (dSameR < bestX) { bestX = dSameR; bx = sh.x + ohx - hx }
    }
    // Z-axis edge snap — requires X overlap
    if (xOverlap) {
      const dFB = Math.abs((z - hz) - (sh.z + ohz))
      if (dFB < bestZ) { bestZ = dFB; bz = sh.z + ohz + hz }
      const dBF = Math.abs((z + hz) - (sh.z - ohz))
      if (dBF < bestZ) { bestZ = dBF; bz = sh.z - ohz - hz }
      const dSameF = Math.abs((z - hz) - (sh.z - ohz))
      if (dSameF < bestZ) { bestZ = dSameF; bz = sh.z - ohz + hz }
      const dSameB = Math.abs((z + hz) - (sh.z + ohz))
      if (dSameB < bestZ) { bestZ = dSameB; bz = sh.z + ohz - hz }
    }
    // Y-axis stack snap — requires X AND Z overlap
    if (zOverlap && xOverlap) {
      const dStackOn = Math.abs((y - hy) - (sh.y + ohy))
      if (dStackOn < bestY) {
        bestY = dStackOn; by = sh.y + ohy + hy
        if (dStackOn < stackWinnerScore) { stackWinnerScore = dStackOn; stackWinner = { sh, ohx, ohz } }
      }
      const dHangBelow = Math.abs((y + hy) - (sh.y - ohy))
      if (dHangBelow < bestY) {
        bestY = dHangBelow; by = sh.y - ohy - hy
        if (dHangBelow < stackWinnerScore) { stackWinnerScore = dHangBelow; stackWinner = { sh, ohx, ohz } }
      }
    }
  }

  // If a Y-stack snap won, also align horizontal corners to the supporter so
  // the stacked shape's footprint lines up with an edge of the shape below.
  // Pick whichever X-edge pairing (same-side or opposite-side) is closer, same
  // for Z. Within a slightly more generous window so corners click into place.
  if (stackWinner) {
    const { sh: s, ohx, ohz } = stackWinner
    const CORNER_WIN = Math.max(threshold, 10)
    const xCandidates = [
      s.x + ohx - hx,   // our +X edge flush with their +X edge
      s.x + ohx + hx,   // our -X edge flush with their +X edge (side-by-side)
      s.x - ohx + hx,   // our -X edge flush with their -X edge
      s.x - ohx - hx,   // our +X edge flush with their -X edge (side-by-side)
    ]
    let bxBest = Math.abs(bx - x) < CORNER_WIN ? Math.abs(bx - x) : CORNER_WIN
    for (const cand of xCandidates) {
      const d = Math.abs(cand - x)
      if (d < bxBest) { bxBest = d; bx = cand }
    }
    const zCandidates = [
      s.z + ohz - hz,
      s.z + ohz + hz,
      s.z - ohz + hz,
      s.z - ohz - hz,
    ]
    let bzBest = Math.abs(bz - z) < CORNER_WIN ? Math.abs(bz - z) : CORNER_WIN
    for (const cand of zCandidates) {
      const d = Math.abs(cand - z)
      if (d < bzBest) { bzBest = d; bz = cand }
    }
  }

  return { x: bx, y: by, z: bz }
}

// ─── Cabinet-to-cabinet snapping ─────────────────────────────────────────────
// Side snap: align cabinet edges flush with neighbours on the same wall (same rotY).
// Y snap: stack cabinet bottoms/tops with any nearby cabinet.
function snapCabinetToOthers(
  cabId: string,
  cx: number, cy: number, cz: number,
  rotY: number,
  w: number, h: number,
  cabinets: PlacedCabinet[],
  sideThreshold = 8,
  yThreshold = 8,
): { cx: number; cy: number; cz: number } {
  const ux = Math.cos(rotY), uz = -Math.sin(rotY)      // along-wall direction
  const along     = cx * ux + cz * uz                  // projected position along wall
  const perpComp  = cx * (-uz) + cz * ux               // perpendicular component (keeps cab on wall)

  let bestSide = sideThreshold, sideSnap: number | null = null
  let bestY    = yThreshold,    ySnap:   number | null = null

  for (const other of cabinets) {
    if (other.id === cabId) continue

    // Side snap — only when cabinet faces the same wall direction
    const da = Math.abs(((rotY - other.rotY) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)
    if (da < 0.15 || da > Math.PI * 2 - 0.15) {
      const oAlong = other.x * ux + other.z * uz
      const dLR = Math.abs((along - w / 2) - (oAlong + other.w / 2))   // our left ↔ their right
      if (dLR < bestSide) { bestSide = dLR; sideSnap = oAlong + other.w / 2 + w / 2 }
      const dRL = Math.abs((along + w / 2) - (oAlong - other.w / 2))   // our right ↔ their left
      if (dRL < bestSide) { bestSide = dRL; sideSnap = oAlong - other.w / 2 - w / 2 }
    }

    // Top/bottom stack snap — works across any cabinet pair
    const dBot = Math.abs(cy - (other.y + other.h))
    if (dBot < bestY) { bestY = dBot; ySnap = other.y + other.h }
    const dTop = Math.abs((cy + h) - other.y)
    if (dTop < bestY) { bestY = dTop; ySnap = other.y - h }
  }

  return {
    cx: sideSnap !== null ? sideSnap * ux + perpComp * (-uz) : cx,
    cz: sideSnap !== null ? sideSnap * uz + perpComp * ux    : cz,
    cy: ySnap    !== null ? Math.max(0, ySnap)               : cy,
  }
}

// ─── AABB overlap check for cabinets ─────────────────────────────────────────
function cabinetOverlapsAny(
  cab: PlacedCabinet,
  others: PlacedCabinet[],
  tolerance = 1, // inches of allowed overlap before flagging
): boolean {
  for (const other of others) {
    if (other.id === cab.id) continue
    // Axis-aligned bounding box overlap in X/Z (ignoring rotation for speed)
    const overlapX = Math.abs(cab.x - other.x) < (cab.w + other.w) / 2 - tolerance
    const overlapZ = Math.abs(cab.z - other.z) < (cab.d + other.d) / 2 - tolerance
    const overlapY = cab.y < other.y + other.h && cab.y + cab.h > other.y
    if (overlapX && overlapZ && overlapY) return true
  }
  return false
}

// pointInPolygon / pointInPoly live in src/utils/wallGeometry.ts — imported
// above. Keeping this comment as a breadcrumb for greps.

// ─── Build floor/ceiling ShapeGeometry from polygon points ───────────────────
// Shape coords: (FT(x), -FT(z)) because Rx(-π/2) maps shape-Y → world-(-Z)
// ─── Derive floor polygon from wall footprint ────────────────────────────────
// Traces walls as a connected chain to produce a stable polygon — vertex order
// follows wall topology so dragging a wall never scrambles the polygon.
// Build floor ShapeGeometry in NORMALIZED object-space coordinates, plus the
// uniform scale factor needed to restore world size. The normalized vertices
// keep drei's MeshReflectorMaterial shader math well-conditioned on large
// floors — its vertex shader uses raw object-space `position` to project
// into the reflection FBO, which goes degenerate once position values exceed
// ~14. By keeping position in a small range and putting the real size on
// mesh.scale, reflections work at any garage size.
function buildFloorGeometry(pts: FloorPoint[]): { geometry: THREE.ShapeGeometry; scale: number } {
  // Default box for the <3 points fallback
  if (pts.length < 3) {
    const g = new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(-10, -11), new THREE.Vector2(10, -11),
      new THREE.Vector2(10, 11),   new THREE.Vector2(-10, 11),
    ]))
    return { geometry: g, scale: 1 }
  }
  // Find the max absolute extent (in feet) so we can normalize to ~unit range
  let maxAbs = 0
  for (const p of pts) {
    const xFt = FT(p.x), zFt = FT(p.z)
    if (Math.abs(xFt) > maxAbs) maxAbs = Math.abs(xFt)
    if (Math.abs(zFt) > maxAbs) maxAbs = Math.abs(zFt)
  }
  // Fallback for degenerate input
  if (maxAbs < 0.001) maxAbs = 1
  // Build the Shape in normalized coordinates (~[-1, 1])
  const shape = new THREE.Shape()
  shape.moveTo(FT(pts[0].x) / maxAbs, -FT(pts[0].z) / maxAbs)
  for (let i = 1; i < pts.length; i++) shape.lineTo(FT(pts[i].x) / maxAbs, -FT(pts[i].z) / maxAbs)
  shape.closePath()
  const geometry = new THREE.ShapeGeometry(shape)
  // ShapeGeometry sets UV = position. Rewrite the UVs to be in feet (pre-normalization)
  // so the floor texture still tiles at the correct chips-per-foot density.
  const posAttr = geometry.getAttribute('position') as THREE.BufferAttribute
  const uvAttr  = geometry.getAttribute('uv')       as THREE.BufferAttribute
  for (let i = 0; i < posAttr.count; i++) {
    uvAttr.setXY(i, posAttr.getX(i) * maxAbs, posAttr.getY(i) * maxAbs)
  }
  uvAttr.needsUpdate = true
  return { geometry, scale: maxAbs }
}

// ─── Cabinet mesh (procedural Tecnica-style) ──────────────────────────────────
const TEC_COLORS: Record<string, string> = {
  // Technica: cabinet body and doors share the same color
  titanium:        '#5a5650',
  'ash-grey':      '#d4cfc0',
  'harbor-blue':   '#283448',
  evergreen:       '#4d5e4c',
  sandstone:       '#b09475',
  mica:            '#6e6e6e',
  graphite:        '#3a3a3c',
  obsidian:        '#1a1a1a',
  silver:          '#b8bcc0',
  'metallic-grey': '#989a9a',
  'argento-blu':   '#9aa8b0',
  ruby:            '#b02020',
}
const SIG_SHELL: Record<string, string> = {
  black:   '#1a1a1c',
  granite: '#48484a',
}
const SIG_DOOR: Record<string, string> = {
  black:           '#1a1a1c',
  granite:         '#48484a',
  'harbor-blue':   '#283448',
  latte:           '#b0a08a',
  'midnight-blue': '#1e2d4d',
  red:             '#b82020',
  silver:          '#b0b4b8',
}
const HANDLE_HEX: Record<string, string> = {
  brushed: '#c0c4c8',
  black:   '#1a1a1c',
}
const CT_COLORS: Record<string, string> = {
  'butcher-block':   '#c4a070',
  'stainless-steel': '#b0b4b8',
  'black-stainless': '#484b50',
}

// ─── Procedural powder-coat texture (used by Technica cabinets) ───────────────
// Generates a white-noise height field, then derives a normal map (from gradients)
// and a roughness map (from the heightfield directly). One shared texture pair
// is created lazily and reused across every Technica cabinet for efficiency.
let _powderNormal: THREE.Texture | null = null
let _powderRough: THREE.Texture | null = null
function getPowderCoatTextures(): { normalMap: THREE.Texture; roughnessMap: THREE.Texture } {
  if (_powderNormal && _powderRough) return { normalMap: _powderNormal, roughnessMap: _powderRough }

  const SIZE = 512
  // 1) White noise heightfield
  const heights = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < heights.length; i++) heights[i] = Math.random()
  // 2) Light 3×3 box blur for slight clumping (cluster the speckles)
  const blurred = new Float32Array(SIZE * SIZE)
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = (x + dx + SIZE) % SIZE
          const ny = (y + dy + SIZE) % SIZE
          sum += heights[ny * SIZE + nx]
        }
      }
      blurred[y * SIZE + x] = sum / 9
    }
  }
  // 3) Build the roughness map (grayscale, varied around mid-roughness)
  const roughCanvas = document.createElement('canvas')
  roughCanvas.width = SIZE; roughCanvas.height = SIZE
  const rctx = roughCanvas.getContext('2d')!
  const roughData = rctx.createImageData(SIZE, SIZE)
  for (let i = 0; i < SIZE * SIZE; i++) {
    const v = Math.max(0, Math.min(255, 170 + (blurred[i] - 0.5) * 90))
    const idx = i * 4
    roughData.data[idx] = v
    roughData.data[idx + 1] = v
    roughData.data[idx + 2] = v
    roughData.data[idx + 3] = 255
  }
  rctx.putImageData(roughData, 0, 0)
  // 4) Build the normal map from height gradients
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = SIZE; normalCanvas.height = SIZE
  const nctx = normalCanvas.getContext('2d')!
  const normalData = nctx.createImageData(SIZE, SIZE)
  const slope = 6  // gradient strength → controls how steep the bumps look
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const xL = (x - 1 + SIZE) % SIZE
      const xR = (x + 1) % SIZE
      const yU = (y - 1 + SIZE) % SIZE
      const yD = (y + 1) % SIZE
      const dx = (blurred[y * SIZE + xR] - blurred[y * SIZE + xL]) * slope
      const dy = (blurred[yD * SIZE + x] - blurred[yU * SIZE + x]) * slope
      const idx = (y * SIZE + x) * 4
      normalData.data[idx]     = Math.max(0, Math.min(255, 128 + dx * 128))
      normalData.data[idx + 1] = Math.max(0, Math.min(255, 128 + dy * 128))
      normalData.data[idx + 2] = 255
      normalData.data[idx + 3] = 255
    }
  }
  nctx.putImageData(normalData, 0, 0)

  // Lower repeat = larger speckle features = more visible from a distance.
  // At 4×4 repeat on a 3ft cabinet, each speckle is ~0.14" (vs ~0.07" at 8×8),
  // which survives mipmapping when the camera pulls back.
  const normalTex = new THREE.CanvasTexture(normalCanvas)
  normalTex.wrapS = normalTex.wrapT = THREE.RepeatWrapping
  normalTex.repeat.set(4, 4)
  normalTex.colorSpace = THREE.NoColorSpace
  normalTex.anisotropy = 8

  const roughTex = new THREE.CanvasTexture(roughCanvas)
  roughTex.wrapS = roughTex.wrapT = THREE.RepeatWrapping
  roughTex.repeat.set(4, 4)
  roughTex.colorSpace = THREE.NoColorSpace
  roughTex.anisotropy = 8

  _powderNormal = normalTex
  _powderRough = roughTex
  return { normalMap: _powderNormal, roughnessMap: _powderRough }
}

/** Signature door panel — extruded geometry with a chamfered inner edge and
 *  an integrated aluminum finger-pull lip sitting on the chamfer face.
 *
 *  The cross-section is defined in the door's local X-Z plane (X = width
 *  axis, Z = thickness axis with +Z pointing out of the cabinet). Extrusion
 *  runs along local Y (door height). The door is modeled with its center
 *  at local origin (spans X∈[-W/2, W/2], Y∈[-H/2, H/2], Z∈[-t/2, t/2]).
 *
 *  `handleOnPlusX`: which side the chamfer/lip is on. true → inner edge at
 *  +X, false → -X.
 */
const SIG_BEVEL    = 0.6 / 12   // 0.6" chamfer (in feet) — front-inner corner of door
// U-channel sits INSIDE the chamfer gap. Its opening faces the chamfer face
// (back of the chamfer), and its closed back wraps around where the chamfer
// would have ended (the outer corner), with each leg sitting flush to the
// door's front face extension and the door's inner-side face extension.
const SIG_U_SPAN   = 0.55 / 12  // span between the two legs (along chamfer slope)
const SIG_U_DEPTH  = 0.18 / 12  // how deep the U reaches from chamfer face outward
const SIG_U_LEGWL  = 0.09 / 12  // thickness of each leg (seen as a line on front/side face)
const SIG_U_BACKWL = 0.06 / 12  // back wall thickness (thinner — less visible)

function SignatureDoorPanel({
  width, height, thickness, handleOnPlusX, doorMat, lipMat,
}: {
  width: number
  height: number
  thickness: number
  handleOnPlusX: boolean
  doorMat: JSX.Element
  lipMat: JSX.Element
}) {
  const W = width, H = height, t = thickness
  const b = Math.min(SIG_BEVEL, t * 0.9, W * 0.3)

  // Build door cross-section in shape-local X-Z. We'll build it with the
  // chamfer on +X; flip via scale for -X. Shape uses 2D coords (x, y) where
  // shape-x = door-X and shape-y = door-Z.
  // Cross-section: shape-x → world X (door width), shape-y → world Y (door
  // height, via rotation below). Extrusion axis +Z → world Z (door thickness).
  // We build the cross-section as a front-view silhouette of the door's
  // chamfered corner — but since a door seen from the front is a plain
  // rectangle, we instead build the cross-section as the PROFILE (side view)
  // and extrude along the door height direction.
  //
  // Approach: build the profile (X = width, Y = thickness, looking along
  // door height), extrude by door height H. Then no rotation needed — the
  // shape's X maps to world X, Y maps to world Z (after +π/2 X-rotation),
  // extrusion maps to world Y.
  const doorGeom = useMemo(() => {
    const s = new THREE.Shape()
    // Profile in (X=width, Y=thickness). Back at -Y, front at +Y.
    s.moveTo(-W / 2, -t / 2)        // back-hinge
    s.lineTo( W / 2, -t / 2)        // back-inner
    s.lineTo( W / 2,  t / 2 - b)    // up inner side to chamfer base
    s.lineTo( W / 2 - b,  t / 2)    // 45° chamfer
    s.lineTo(-W / 2,  t / 2)        // front-hinge
    s.lineTo(-W / 2, -t / 2)        // close
    const g = new THREE.ExtrudeGeometry(s, {
      depth: H, bevelEnabled: false, steps: 1, curveSegments: 1,
    })
    // Center extrusion along Y: default extrudes from 0 to H along +Z.
    // Translate so extrusion is centered at 0.
    g.translate(0, 0, -H / 2)
    return g
  }, [W, H, t, b])
  useEffect(() => () => doorGeom.dispose(), [doorGeom])

  // Aluminum lip: extruded U-channel that sits on the chamfer face with its
  // open side facing the door (so the two walls and the back of the U are
  // what's visible). Cross-section is in (U, V) where U = along the chamfer
  // slope (outer span = SIG_LIP_W), V = outward from the chamfer (depth =
  // SIG_LIP_D). Open side of the U is at V = 0 (touching the chamfer).
  // U-channel mounted to the door's INNER SIDE face (X = W/2). The two legs
  // of the U stick outward in +X (away from the door), and the open side of
  // the U faces +Z (toward the door front / chamfer). The back of the U sits
  // against the door's inner side face.
  //
  // Cross-section in (U, V) where:
  //   U (shape-x) = outward from door inner face (depth of the U's legs)
  //   V (shape-y) = along door thickness axis (span across the U opening)
  // Open side at U = 0 would mean opening faces the door body. We want the
  // opening to face +Z (front). So: place the open side at V = +span/2 side.
  // Easier: build the U as a span-vs-depth shape and rotate the whole thing.
  //
  // Simplest: build the shape so that the "open" side of the U is at
  //   V = 0  (span runs from V=0 to V=span)
  // and the two walls are at U=0..depth (wall near door) and extending out.
  // Actually cleanest: just build an open-top rectangle and pick axes later.
  const lipGeom = useMemo(() => {
    const span  = SIG_U_SPAN     // distance along chamfer slope between the two legs
    const depth = SIG_U_DEPTH    // how far out from chamfer face to the back wall
    const lwl   = SIG_U_LEGWL    // leg thickness
    const bwl   = SIG_U_BACKWL   // back wall thickness

    // Cross-section in (u, v): u = along chamfer slope, v = outward from
    // chamfer face. U opens toward v=0 (the chamfer face).
    //   Outer rect: (0, 0) → (span, 0) → (span, depth) → (0, depth)
    //   Inner pocket cut from v=0: (lwl, 0) → (lwl, depth - bwl) →
    //                              (span - lwl, depth - bwl) → (span - lwl, 0)
    // Build the U outline directly as a single CCW simply-connected polygon.
    // Traversal zig-zags into the pocket so it stays non-self-intersecting.
    const s = new THREE.Shape()
    s.moveTo(0, 0)                     // outer-bottom of front leg (at chamfer face)
    s.lineTo(lwl, 0)                   // step in along chamfer face
    s.lineTo(lwl, depth - bwl)         // up the inner face of the front leg
    s.lineTo(span - lwl, depth - bwl)  // across the back wall (inner face)
    s.lineTo(span - lwl, 0)            // down the inner face of the back leg
    s.lineTo(span, 0)                  // step out along chamfer face
    s.lineTo(span, depth)              // up outer face of back leg
    s.lineTo(0, depth)                 // across outer face of back wall
    s.lineTo(0, 0)                     // down outer face of front leg → close

    const len = H
    const g = new THREE.ExtrudeGeometry(s, {
      depth: len, bevelEnabled: false, steps: 1, curveSegments: 1,
    })
    // Center span around origin, and extrusion around origin.
    g.translate(-span / 2, 0, -len / 2)
    // Bake the axis mapping so the 2D cross-section lies in the door's X-Z
    // plane rotated 45° (aligned to the chamfer), and extrusion runs along
    // world Y (door height).
    //   local u (shape-X) should map to chamfer-slope direction:
    //     chamfer slope on +X side runs from (W/2 - b, t/2) → (W/2, t/2 - b),
    //     direction (+X, -Z)/√2.
    //   local v (shape-Y) should map to outward-from-chamfer direction:
    //     chamfer normal (+X, +Z)/√2.
    //   local extrusion (shape-Z) should map to world +Y (door height).
    //
    // We apply rotations in geometry-local order so that the resulting
    // basis is a proper rotation (det = +1), avoiding normal inversion.
    // Start: X=(1,0,0), Y=(0,1,0), Z=(0,0,1).
    // Step 1 — rotateX(-π/2): X stays, Y→Z, Z→-Y. New basis:
    //   X=(1,0,0), Y=(0,0,1), Z=(0,-1,0).  (det = +1 ✓)
    // Step 2 — rotateY(-π/4): spins X and Z in XZ plane.
    //   Previous X=(1,0,0) → (cos(-π/4), 0, -sin(-π/4))=(√2/2, 0, √2/2)?
    //   Actually rotateY(θ) sends (x,y,z) → (x cosθ + z sinθ, y, -x sinθ + z cosθ).
    //   At θ=-π/4: (1,0,0) → (√2/2, 0, √2/2). That's (+X,+Z)/√2 — the chamfer NORMAL.
    //   We want u (shape-X after step 1 is still world-X basis vector) to map
    //   to the slope (+X,-Z)/√2 instead. So use θ = +π/4:
    //   (1,0,0) → (√2/2, 0, -√2/2) = (+X, 0, -Z)/√2 ✓ slope
    //   (0,0,1) → (sin(π/4), 0, cos(π/4)) = (√2/2, 0, √2/2) = chamfer normal ✓
    //   (0,1,0) → (0,1,0) unchanged.
    //
    // So: rotateX(+π/2), then rotateY(+π/4). (+π/2 about X puts shape-Y on
    // world +Z; rotateY(+π/4) tilts the X-Z pair into the chamfer frame.)
    g.rotateX(Math.PI / 2)
    g.rotateY(Math.PI / 4)
    return g
  }, [H])
  useEffect(() => () => lipGeom.dispose(), [lipGeom])

  // Mount the U so its opening (shape-v=0) lies ON the chamfer face, with the
  // back of the U sitting at the outer corner of the chamfer gap.
  // Chamfer face midpoint in door-local X-Z:
  const chamferMidX = W / 2 - b / 2
  const chamferMidZ = t / 2 - b / 2

  // If handleOnPlusX is false, mirror the entire group along X to flip both
  // the chamfer and the U-channel to the -X side.
  const sx = handleOnPlusX ? 1 : -1

  return (
    <group scale={[sx, 1, 1]}>
      {/* Door panel — extruded profile. Profile is (width, thickness) with
          front at +local-Y. Extrusion is along local +Z. Rotate +π/2 about X
          so local Z (extrusion) → world Y (door height) and local Y (front)
          → world Z (out of cabinet). */}
      <mesh
        geometry={doorGeom}
        rotation={[Math.PI / 2, 0, 0]}
        castShadow
      >
        {doorMat}
      </mesh>
      {/* Aluminum lip on the chamfer face */}
      <mesh
        geometry={lipGeom}
        position={[chamferMidX, 0, chamferMidZ]}
        castShadow
      >
        {lipMat}
      </mesh>
    </group>
  )
}

/** Technica blade-style door handle: single extruded shape with feet at ends and elevated middle. */
function technicaBladeHandle(
  prefix: string, hx: number, cy: number, doorFaceZ: number, totalH: number,
  mat: JSX.Element
): JSX.Element[] {
  // Shape coords: shape X = handle length axis, shape Y = depth from door surface
  // Extrude direction (shape Z) = handle width axis
  const barW   = FT(0.4)   // handle width along door
  const maxZ   = FT(0.85)  // max depth from door (back of handle)
  const gapZ   = FT(0.55)  // depth of finger gap (door to inner face of elevated middle)
  const halfH  = totalH / 2
  const footL  = Math.max(FT(0.6), totalH * 0.12)  // length of each foot touching door
  const transL = Math.max(FT(0.6), totalH * 0.10)  // length of smooth transition curve

  const r = FT(0.4)  // corner radius for the outside (back) corners only

  const shape = new THREE.Shape()
  // Start at bottom-front corner (sharp, touching cabinet)
  shape.moveTo(-halfH, 0)
  // Bottom foot (right along door)
  shape.lineTo(-halfH + footL, 0)
  // Bottom transition: smooth ramp with horizontal tangents at both ends
  shape.bezierCurveTo(
    -halfH + footL + transL / 2, 0,
    -halfH + footL + transL / 2, gapZ,
    -halfH + footL + transL, gapZ
  )
  // Across the elevated middle (inner face of the bar)
  shape.lineTo(halfH - footL - transL, gapZ)
  // Top transition: smooth ramp back down to door
  shape.bezierCurveTo(
    halfH - footL - transL / 2, gapZ,
    halfH - footL - transL / 2, 0,
    halfH - footL, 0
  )
  // Top foot
  shape.lineTo(halfH, 0)
  // Top end face (sharp corner at door, going up to back)
  shape.lineTo(halfH, maxZ - r)
  // Top-back rounded corner (outside corner)
  shape.quadraticCurveTo(halfH, maxZ, halfH - r, maxZ)
  // Back of handle (top to bottom)
  shape.lineTo(-halfH + r, maxZ)
  // Bottom-back rounded corner (outside corner)
  shape.quadraticCurveTo(-halfH, maxZ, -halfH, maxZ - r)
  // Bottom end face (closes back to start, sharp corner at door)
  shape.lineTo(-halfH, 0)

  const extrudeOpts = { depth: barW, bevelEnabled: false, steps: 1, curveSegments: 16 }

  return [
    <mesh key={`${prefix}h`}
      position={[hx - barW / 2, cy, doorFaceZ]}
      rotation={[0, Math.PI / 2, Math.PI / 2]}
      castShadow>
      {mat}
      <extrudeGeometry args={[shape, extrudeOpts]} />
    </mesh>
  ]
}

const CabinetMesh = memo(function CabinetMesh({ cabinet, selected, wireframe, blueprint, onClick, onPointerDown, overlapping, groupRef }: {
  cabinet: PlacedCabinet; selected: boolean; wireframe: boolean; blueprint?: boolean; overlapping?: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  groupRef?: (id: string, group: THREE.Group | null) => void
}) {
  const _sig        = cabinet.line === 'signature'
  const shellHex    = _sig
    ? (SIG_SHELL[cabinet.shellColor ?? 'granite'] ?? SIG_SHELL.granite)
    : (TEC_COLORS[cabinet.color] ?? TEC_COLORS.titanium)
  const doorRawHex  = _sig
    ? (SIG_DOOR[cabinet.color] ?? SIG_DOOR.black)
    : (TEC_COLORS[cabinet.color] ?? TEC_COLORS.titanium)
  const bodyHex     = blueprint ? (selected ? '#555555' : '#444444') : wireframe ? (selected ? '#ffcc00' : '#ff9944') : shellHex
  const doorHex     = blueprint ? bodyHex : wireframe ? bodyHex : doorRawHex
  const selEmissive = blueprint ? '#000000' : overlapping ? '#662222' : selected ? '#334466' : '#000000'

  const wFt = FT(cabinet.w), hFt = FT(cabinet.h), dFt = FT(cabinet.d)

  // Signature: 3/4" frame rail/stile visible; Technica: full overlay (no visible frame)
  const handleRight = (cabinet.handleSide ?? 'right') === 'right'
  const isSignature = cabinet.line === 'signature'
  const fr  = isSignature ? FT(0.75) : FT(0.1)  // tiny gap for Technica, visible frame for Signature
  // Flat base for both lines (no toe-kick recess)
  const isLocker = cabinet.style === 'locker'
  const hasToeKick = false
  const tkH = 0
  const tkD = FT(2)

  const drawerCount = cabinet.drawers ?? 0
  // Combo drawer height matches the top drawer of the 5-drawer layout
  // Technica 5-drawer top = 3.5/20 of usable height; Signature = 3/20
  const usableH     = hFt - fr - fr  // top + bottom frame rails
  const comboDrawerH = isSignature ? usableH * (3 / 20) : usableH * (3.5 / 20)
  const drawerH6    = comboDrawerH

  // Door vertical extents
  // For 1-drawer + 2-door: doors occupy area below the drawer
  // For drawer-only: no door area
  const baseY0  = hasToeKick ? tkH : (isSignature ? fr : 0)
  const fullY1  = isSignature ? hFt - fr : hFt
  // If there's a top drawer row, shrink door area down
  const doorY0  = baseY0
  const doorY1  = drawerCount > 0 && cabinet.doors > 0
    ? fullY1 - drawerCount * drawerH6 - fr  // gap between drawer and doors
    : (cabinet.doors > 0 ? fullY1 : baseY0)
  const reveal  = isSignature ? FT(0.25) : 0 // Signature: inset gap; Technica: full overlay
  const doorH   = doorY1 - doorY0 - 2 * reveal
  const doorMY  = (doorY0 + doorY1) / 2
  // Signature doors sit flush (inset) with the cabinet frame front face;
  // Technica doors sit on top of the frame, proud of the body
  const doorThick = FT(0.5)
  const doorZ   = isSignature ? dFt / 2 - doorThick / 2 : dFt / 2 + doorThick / 2
  const doorFrontZ = doorZ + doorThick / 2  // front face of the door panel

  // Door widths — Signature has no center stile (doors meet with a small gap);
  // Technica has full overlay doors covering the frame.
  // Signature U-channel handles protrude ~SIG_U_DEPTH / √2 past each door's
  // inner edge; widen the gap so the two handles don't collide, and shorten
  // the single-door width so the handle clears the side frame rail.
  const sigHandleOut = SIG_U_DEPTH / Math.SQRT2
  const doorGap = isSignature ? FT(0.15) + 2 * sigHandleOut : FT(0.1)
  const door1W = isSignature ? wFt - 2 * fr - 2 * reveal - sigHandleOut : wFt - FT(0.1)
  const door2W = isSignature
    ? (wFt - 2 * fr - doorGap) / 2 - reveal
    : (wFt - doorGap) / 2                            // Technica: each door covers half, split by seam
  const lDX    = isSignature ? (-doorGap / 2 - door2W / 2) : (-doorGap / 2 - door2W / 2)
  const rDX    = isSignature ? ( doorGap / 2 + door2W / 2) : ( doorGap / 2 + door2W / 2)

  const handleHex = HANDLE_HEX[cabinet.handleColor ?? 'brushed'] ?? HANDLE_HEX.brushed
  const handleIsBlack = (cabinet.handleColor ?? 'brushed') === 'black'
  // Powder-coat texture — used by Technica, Signature, and overhead racks.
  const powder = (!blueprint && !wireframe) ? getPowderCoatTextures() : null

  // Brushed stainless PBR set — reused for the "brushed" handle variant.
  // useTexture is a drei hook; must run unconditionally.
  const brushedHandleSrc = useTexture({
    map:          `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/color.jpg`,
    normalMap:    `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/normal.jpg`,
    roughnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/roughness.jpg`,
  })
  // Clone + tile for handle-scale geometry. Handles are small (an inch or two
  // wide, several inches tall) — modest repeats keep the streak scale visible
  // without it looking zoomed-in.
  const brushedHandleMaps = useMemo(() => {
    if (blueprint || wireframe || handleIsBlack) return null
    const map          = brushedHandleSrc.map.clone()
    const normalMap    = brushedHandleSrc.normalMap.clone()
    const roughnessMap = brushedHandleSrc.roughnessMap.clone()
    for (const t of [map, normalMap, roughnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(1, 3)
      t.needsUpdate = true
    }
    map.colorSpace = THREE.SRGBColorSpace
    normalMap.colorSpace = THREE.NoColorSpace
    roughnessMap.colorSpace = THREE.NoColorSpace
    return { map, normalMap, roughnessMap }
  }, [blueprint, wireframe, handleIsBlack, brushedHandleSrc])

  const handleMat = blueprint
    ? <meshBasicMaterial color="#666666" />
    : handleIsBlack
    ? <meshStandardMaterial color={handleHex} metalness={0.05} roughness={0.55} />
    : (
      <meshPhysicalMaterial
        map={brushedHandleMaps?.map}
        normalMap={brushedHandleMaps?.normalMap}
        normalScale={[0.6, 0.6] as unknown as THREE.Vector2}
        roughnessMap={brushedHandleMaps?.roughnessMap}
        color="#ffffff"
        metalness={0}
        roughness={0.55}
        envMapIntensity={0}
      />
    )
  const bodyMat   = blueprint
    ? <meshBasicMaterial color={bodyHex} />
    : wireframe
    ? <meshLambertMaterial wireframe color={bodyHex} emissive={selEmissive} emissiveIntensity={selected ? 0.3 : 0} />
    : isSignature
    ? <meshPhysicalMaterial
        color={bodyHex}
        metalness={0.0}
        roughness={0.75}
        normalMap={powder?.normalMap}
        normalScale={[0.45, 0.45] as unknown as THREE.Vector2}
        roughnessMap={powder?.roughnessMap}
        clearcoat={0.08}
        clearcoatRoughness={0.6}
        reflectivity={0.15}
        specularIntensity={0.3}
        emissive={selEmissive}
        emissiveIntensity={selected ? 0.3 : overlapping ? 0.4 : 0}
        envMapIntensity={0.15}
      />
    : <meshPhysicalMaterial
        color={bodyHex}
        metalness={0.08}
        roughness={0.62}
        normalMap={powder?.normalMap}
        normalScale={[0.55, 0.55] as unknown as THREE.Vector2}
        roughnessMap={powder?.roughnessMap}
        clearcoat={0.15}
        clearcoatRoughness={0.55}
        reflectivity={0.3}
        specularIntensity={0.6}
        emissive={selEmissive}
        emissiveIntensity={selected ? 0.3 : overlapping ? 0.4 : 0}
        envMapIntensity={0.4}
      />
  const doorMat   = blueprint
    ? <meshBasicMaterial color={doorHex} />
    : wireframe
    ? <meshLambertMaterial color={doorHex} />
    : isSignature
    ? <meshPhysicalMaterial
        color={doorHex}
        metalness={0.0}
        roughness={0.70}
        normalMap={powder?.normalMap}
        normalScale={[0.5, 0.5] as unknown as THREE.Vector2}
        roughnessMap={powder?.roughnessMap}
        clearcoat={0.10}
        clearcoatRoughness={0.5}
        reflectivity={0.15}
        specularIntensity={0.3}
        envMapIntensity={0.18}
      />
    : <meshPhysicalMaterial
        color={doorHex}
        metalness={0.08}
        roughness={0.6}
        normalMap={powder?.normalMap}
        normalScale={[0.6, 0.6] as unknown as THREE.Vector2}
        roughnessMap={powder?.roughnessMap}
        clearcoat={0.18}
        clearcoatRoughness={0.5}
        reflectivity={0.3}
        specularIntensity={0.6}
        envMapIntensity={0.4}
      />

  // Vertical bar handle dimensions (used for all doors)
  const vW = FT(0.45)   // bar width
  const vD = FT(1.1)    // bar depth (protrusion from door face)

  // ── Build per-door handle meshes (positioned relative to door center) ──
  let handle1: JSX.Element[] = []   // single-door handles
  let handleL: JSX.Element[] = []   // left door handles (2-door)
  let handleR: JSX.Element[] = []   // right door handles (2-door)

  // Signature aluminum-lip material for the chamfered door edge. Reused
  // regardless of door count; the SignatureDoorPanel renders the lip.
  const sigLipMat = blueprint
    ? <meshBasicMaterial color="#666666" />
    : handleIsBlack
    ? <meshStandardMaterial color={handleHex} metalness={0.05} roughness={0.55} />
    : (
      <meshPhysicalMaterial
        map={brushedHandleMaps?.map}
        normalMap={brushedHandleMaps?.normalMap}
        normalScale={[0.6, 0.6] as unknown as THREE.Vector2}
        roughnessMap={brushedHandleMaps?.roughnessMap}
        color="#ffffff"
        metalness={0}
        roughness={0.55}
        envMapIntensity={0}
      />
    )

  if (isSignature && cabinet.doors > 0) {
    // Handle (chamfer + lip) lives inside SignatureDoorPanel — no separate
    // handle mesh needed. Leave handle1/handleL/handleR empty for Signature.
  } else if (cabinet.doors > 0) {
    // Technica blade handles — compute relative to door center
    const bladeH = cabinet.style === 'locker' ? FT(19) : FT(8.5)
    const bladeY = cabinet.style === 'locker' ? 0
      : cabinet.style === 'upper' ? (doorY0 + bladeH / 2 + FT(1.5) - doorMY)
      : (doorY1 - bladeH / 2 - FT(1.5) - doorMY)
    if (cabinet.doors === 1) {
      const iEdge = handleRight ? (door1W / 2 - FT(1.5)) : (-door1W / 2 + FT(1.5))
      handle1.push(...technicaBladeHandle('h1', iEdge, bladeY, doorFrontZ - doorZ, bladeH, handleMat))
    } else {
      handleL.push(...technicaBladeHandle('hL', door2W / 2 - FT(1.5), bladeY, doorFrontZ - doorZ, bladeH, handleMat))
      handleR.push(...technicaBladeHandle('hR', -door2W / 2 + FT(1.5), bladeY, doorFrontZ - doorZ, bladeH, handleMat))
    }
  }

  // ── Door swing (open/close) ──
  const doorState = cabinet.doorOpenState ?? 0
  const openAngle = doorState === 2 ? Math.PI / 2 : doorState === 1 ? Math.PI / 4 : 0
  const doorRadius = FT(0.15)  // rounded edge radius on door panels

  const setGroupRef = useCallback((g: THREE.Group | null) => {
    if (groupRef) groupRef(cabinet.id, g)
  }, [groupRef, cabinet.id])

  // ── Corner-upper cabinet — pentagonal footprint ─────────────────────────
  // Two back walls (length w) sit against the wall corner; two side walls
  // (length d) stick into the room; a 45° hypotenuse holds the single door.
  // Local origin is the inside wall corner; pentagon extends in +X/+Z quadrant.
  if (cabinet.style === 'corner-upper') {
    const pt = FT(0.75)
    const wIn = wFt  // cabinet bounding box width = 24" (= w = d)
    const chamferIn = FT(14)  // the two 14" chamfer/side faces
    // Pentagon inscribed in a 24×24 bounding box centered on (0, 0). Back-A
    // runs along local z = -w/2 (the "back" face, conventional), and back-B
    // runs along local x = -w/2 (the "left side" face). The inside corner
    // (where back-A and back-B meet) is at (-w/2, -w/2). The opposite corner
    // is chamfered — a 14" diagonal cut connecting the two adjacent sides.
    const half = wIn / 2
    const chamf = chamferIn
    const verts: [number, number][] = [
      [-half, -half],              // v0: inside corner (back-A × back-B)
      [ half, -half],              // v1: end of back-A (back-A × side-A)
      [ half, -half + chamf],      // v2: end of side-A (start of hypotenuse)
      [-half + chamf,  half],      // v3: end of hypotenuse (start of side-B)
      [-half,  half],              // v4: end of side-B (back-B × side-B)
    ]
    // Cabinet shell = 4 non-hypotenuse side walls + top cap + bottom cap.
    // The hypotenuse side is OPEN (no front panel) — matches standard
    // Signature cabinets. The smaller door sits across the opening; the
    // reveal gap around the door shows the hollow interior as the visible
    // "frame" effect (dark shadow behind the door).
    const wallEdges: { a: [number, number]; b: [number, number] }[] = [
      { a: verts[0], b: verts[1] },  // back-A: local z = -w/2 (back face)
      { a: verts[1], b: verts[2] },  // side-A: local x = +w/2
      { a: verts[3], b: verts[4] },  // side-B: local z = +w/2
      { a: verts[4], b: verts[0] },  // back-B: local x = -w/2 (left side)
    ]
    const shellCentroid = {
      x: (verts[0][0] + verts[1][0] + verts[2][0] + verts[3][0] + verts[4][0]) / 5,
      z: (verts[0][1] + verts[1][1] + verts[2][1] + verts[3][1] + verts[4][1]) / 5,
    }
    // Solid pentagon caps (top + bottom). Use ExtrudeGeometry for a 3D
    // slab of thickness pt; visible from both sides.
    const capShape = new THREE.Shape()
    capShape.moveTo(verts[0][0], verts[0][1])
    for (let i = 1; i < verts.length; i++) capShape.lineTo(verts[i][0], verts[i][1])
    capShape.lineTo(verts[0][0], verts[0][1])
    const capSlabGeo = new THREE.ExtrudeGeometry(capShape, { depth: pt, bevelEnabled: false })
    capSlabGeo.rotateX(Math.PI / 2)
    capSlabGeo.computeVertexNormals()
    // Door hypotenuse edge (verts[2] → verts[3])
    const hxA = verts[2][0], hzA = verts[2][1]
    const hxB = verts[3][0], hzB = verts[3][1]
    const hLen = Math.hypot(hxB - hxA, hzB - hzA)
    // Hypotenuse midpoint
    const hMidX = (hxA + hxB) / 2
    const hMidZ = (hzA + hzB) / 2
    // Edge direction (A → B) and outward normal (pointing away from pentagon
    // interior centroid)
    const eDx = (hxB - hxA) / hLen
    const eDz = (hzB - hzA) / hLen
    const cX = (verts[0][0] + verts[1][0] + verts[2][0] + verts[3][0] + verts[4][0]) / 5
    const cZ = (verts[0][1] + verts[1][1] + verts[2][1] + verts[3][1] + verts[4][1]) / 5
    let oNx = -eDz, oNz = eDx
    if ((hMidX - cX) * oNx + (hMidZ - cZ) * oNz < 0) { oNx = -oNx; oNz = -oNz }
    // Door-face angle around +Y. We want the door's local +Z (the face normal)
    // to align with the outward normal (oNx, 0, oNz). Under Y-rotation by θ,
    // (0,0,1) → (sin θ, 0, cos θ). So θ = atan2(oNx, oNz).
    // This maps local +X to (oNz, 0, -oNx), which is parallel to the edge
    // direction but may point A→B or B→A — we pick handle/hinge ends relative
    // to that. No reflection needed, so door normals stay consistent.
    const faceAng = Math.atan2(oNx, oNz)
    // After rotation, local +X points in direction (oNz, 0, -oNx). Compare to
    // edge direction (eDx, eDz): if they match, local +X runs A→B; if opposite,
    // local +X runs B→A.
    const localXAlongAtoB = (oNz * eDx + (-oNx) * eDz) > 0
    const doorThickC = FT(0.5)
    // Corner cabinet front face is FRAMED (locker-style): visible cabinet-body
    // rails around the door. Match standard Signature cabinets: 0.75" frame
    // rails + 0.25" reveal between door and frame opening.
    const frameC = FT(0.75)
    const revealGap = FT(0.25)  // 1/4" reveal — matches standard Signature cabinet reveal
    // Door sizing differs by line:
    //   Signature: door is inset inside the frame with a reveal gap.
    //   Technica: door is a full-overlay that COVERS the frame (like other
    //             Technica cabinets) — sized to nearly the full hypotenuse.
    const doorY0c = isSignature ? frameC + revealGap : 0
    const doorY1c = isSignature ? hFt - frameC - revealGap : hFt
    const doorHc = isSignature ? (doorY1c - doorY0c) : (hFt - FT(0.1))
    const doorMYc = (doorY0c + doorY1c) / 2
    const doorWc = isSignature
      ? hLen - 2 * frameC - 2 * revealGap
      : hLen - FT(1.1)
    // Door positioning matches standard cabinets:
    //   Signature: door is RECESSED — front face flush with hypotenuse plane,
    //              body extends into the hollow cavity.
    //   Technica: door is OVERLAY — back face flush with hypotenuse plane,
    //              body extends outward (proud of the cabinet).
    const doorOutwardOffset = isSignature ? -doorThickC / 2 : doorThickC / 2
    const doorCX = hMidX + oNx * doorOutwardOffset
    const doorCZ = hMidZ + oNz * doorOutwardOffset
    // Hinge side: 'right' handle means the HANDLE is on the right when viewed
    // from outside the cabinet → the hinge is on the OPPOSITE side (left).
    // In our hypotenuse convention, vertex A (verts[2]) ends up on the right
    // side of the door from the viewer, so a 'right' handle means hinge at
    // vertex B (not A).
    const hingeEndIsA = (cabinet.handleSide ?? 'right') === 'left'
    // Handle near bottom of door (corner-upper follows upper convention)
    const bladeH = FT(8.5)
    const bladeY = doorY0c + bladeH / 2 + FT(1.5) - doorMYc
    return (
      <group
        ref={setGroupRef}
        position={[FT(cabinet.x), FT(cabinet.y), FT(cabinet.z)]}
        rotation={[0, cabinet.rotY, 0]}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerDown={onPointerDown}
      >
        <>
          {/* 4 solid side walls (hypotenuse is OPEN — no front panel). */}
          {wallEdges.map((e, i) => {
            const ax = e.a[0], az = e.a[1], bx = e.b[0], bz = e.b[1]
            const len = Math.hypot(bx - ax, bz - az)
            const mx = (ax + bx) / 2, mz = (az + bz) / 2
            const dx = (bx - ax) / len, dz = (bz - az) / len
            let inX = -dz, inZ = dx
            if ((shellCentroid.x - mx) * inX + (shellCentroid.z - mz) * inZ < 0) {
              inX = -inX; inZ = -inZ
            }
            const cx2 = mx + inX * pt / 2
            const cz2 = mz + inZ * pt / 2
            const ang = Math.atan2(-dz, dx)
            return (
              <mesh key={`cw-${i}`} position={[cx2, hFt / 2, cz2]} rotation={[0, ang, 0]} castShadow receiveShadow>
                {bodyMat}
                <boxGeometry args={[len, hFt, pt]} />
              </mesh>
            )
          })}
          {/* Bottom cap (pentagon slab) — occupies y ∈ [0, pt]. */}
          <mesh geometry={capSlabGeo} position={[0, pt, 0]} castShadow receiveShadow>
            {bodyMat}
          </mesh>
          {/* Top cap — occupies y ∈ [hFt-pt, hFt]. */}
          <mesh geometry={capSlabGeo} position={[0, hFt, 0]} castShadow receiveShadow>
            {bodyMat}
          </mesh>
          {/* Front-face frame on the hypotenuse — 4 thin rail/stile boxes
              forming a rectangular frame with a door-sized opening in the
              middle. The door sits in the opening; hollow shell shows
              through the 1/4" reveal gap between door and frame edges. */}
          {(() => {
            const frameGroupAng = Math.atan2(oNx, oNz)
            // Frame opening dimensions (what the door sits in):
            const openW = hLen - 2 * frameC
            const openH = hFt - 2 * frameC
            // Rail positions in frame-local coords (origin = hypotenuse center)
            const rails: Array<{ w: number; h: number; x: number; y: number }> = [
              // Top rail
              { w: hLen, h: frameC, x: 0, y: openH / 2 + frameC / 2 },
              // Bottom rail
              { w: hLen, h: frameC, x: 0, y: -openH / 2 - frameC / 2 },
              // Left stile (between rails)
              { w: frameC, h: openH, x: -openW / 2 - frameC / 2, y: 0 },
              // Right stile
              { w: frameC, h: openH, x:  openW / 2 + frameC / 2, y: 0 },
            ]
            return (
              <group position={[hMidX, hFt / 2, hMidZ]} rotation={[0, frameGroupAng, 0]}>
                {rails.map((r, i) => (
                  <mesh key={`rail-${i}`} position={[r.x, r.y, -pt / 2]} castShadow receiveShadow>
                    {bodyMat}
                    <boxGeometry args={[r.w, r.h, pt]} />
                  </mesh>
                ))}
              </group>
            )
          })()}

          {!wireframe && cabinet.doors > 0 && doorHc > 0 && (() => {
            // In the door-local frame (after faceAng rotation): +X runs along
            // the hypotenuse edge (direction A→B or B→A depending on geometry),
            // +Z is the outward normal. Pick hinge end's sign along local +X.
            const hingeSign = (hingeEndIsA === localXAlongAtoB) ? -1 : +1
            const freeSign = -hingeSign
            const hingeLocalX = hingeSign * (doorWc / 2)
            // Swing outward (toward +Z = outward normal): free-end local-X must
            // move to +Z under rotation. A Y-rotation by -θ sends (r,0,0) to
            // (r·cosθ, 0, r·sinθ). So for freeSign > 0, use -θ; for < 0, use +θ.
            const swing = -freeSign * openAngle
            return (
              <group position={[doorCX, doorMYc, doorCZ]} rotation={[0, faceAng, 0]}>
                <group position={[hingeLocalX, 0, 0]} rotation={[0, swing, 0]}>
                  <group position={[-hingeLocalX, 0, 0]}>
                    {isSignature ? (
                      <SignatureDoorPanel
                        width={doorWc} height={doorHc} thickness={doorThickC}
                        handleOnPlusX={freeSign > 0}
                        doorMat={doorMat} lipMat={sigLipMat}
                      />
                    ) : (
                      <>
                        <RoundedBox args={[doorWc, doorHc, doorThickC]} radius={doorRadius} smoothness={4} castShadow>
                          {doorMat}
                        </RoundedBox>
                        <group position={[freeSign * (doorWc / 2 - FT(1.5)), bladeY, doorThickC / 2]}>
                          {technicaBladeHandle('cnr-h', 0, 0, 0, bladeH, handleMat)}
                        </group>
                      </>
                    )}
                  </group>
                </group>
              </group>
            )
          })()}
          {/* Under-cabinet puck (treat corner-upper like upper) */}
          {cabinet.underLight && !blueprint && !wireframe && (() => {
            const coneAngle = cabinet.underLightAngle ?? (75 * Math.PI) / 180
            const fovDeg = Math.min(170, (coneAngle * 2 * 180) / Math.PI + 10)
            return <UnderCabinetPuck coneAngle={coneAngle} fovDeg={fovDeg} />
          })()}
        </>
      </group>
    )
  }

  return (
    <group
      ref={setGroupRef}
      position={[FT(cabinet.x), FT(cabinet.y), FT(cabinet.z)]}
      rotation={[0, cabinet.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      <>
        {/* Hollow cabinet shell — individual panels with visible thickness */}
        {(() => {
          const pt = FT(0.75)  // panel thickness (3/4" steel/MDF)
          const innerW = wFt - 2 * pt
          const innerD = dFt - pt  // no front panel (open front)
          const panels: JSX.Element[] = []
          // Back panel
          panels.push(
            <mesh key="back" position={[0, hFt / 2, -dFt / 2 + pt / 2]} castShadow receiveShadow>{bodyMat}
              <boxGeometry args={[wFt, hFt, pt]} />
            </mesh>
          )
          // Left side panel
          panels.push(
            <mesh key="left" position={[-wFt / 2 + pt / 2, hFt / 2, pt / 2]} castShadow receiveShadow>{bodyMat}
              <boxGeometry args={[pt, hFt, innerD]} />
            </mesh>
          )
          // Right side panel
          panels.push(
            <mesh key="right" position={[wFt / 2 - pt / 2, hFt / 2, pt / 2]} castShadow receiveShadow>{bodyMat}
              <boxGeometry args={[pt, hFt, innerD]} />
            </mesh>
          )
          // Top panel
          panels.push(
            <mesh key="top" position={[0, hFt - pt / 2, pt / 2]} castShadow receiveShadow>{bodyMat}
              <boxGeometry args={[innerW, pt, innerD]} />
            </mesh>
          )
          // Bottom panel
          panels.push(
            <mesh key="bot" position={[0, pt / 2, pt / 2]} castShadow receiveShadow>{bodyMat}
              <boxGeometry args={[innerW, pt, innerD]} />
            </mesh>
          )
          return panels
        })()}

        {!wireframe && (<>
          {/* Doors — each wrapped in a hinge-pivot group for open/close */}
          {cabinet.doors === 1 && doorH > 0 && (() => {
            // Single door: hinge on opposite side of handle
            const hingeX = handleRight ? -door1W / 2 : door1W / 2
            const hingeSign = handleRight ? -1 : 1  // swing outward from hinge
            return (
              <group position={[hingeX, doorMY, doorZ]} rotation={[0, hingeSign * openAngle, 0]}>
                {isSignature ? (
                  <group position={[-hingeX, 0, 0]}>
                    <SignatureDoorPanel
                      width={door1W} height={doorH} thickness={doorThick}
                      handleOnPlusX={handleRight}
                      doorMat={doorMat} lipMat={sigLipMat}
                    />
                  </group>
                ) : (
                  <RoundedBox args={[door1W, doorH, doorThick]} radius={doorRadius} smoothness={4} position={[-hingeX, 0, 0]} castShadow>
                    {doorMat}
                  </RoundedBox>
                )}
                {handle1.map((h, i) => <group key={`h1-${i}`} position={[-hingeX, 0, 0]}>{h}</group>)}
              </group>
            )
          })()}
          {cabinet.doors === 2 && doorH > 0 && (<>
            {/* Left door — hinges on left edge, swings outward; seam at +X (inner edge) */}
            <group position={[lDX - door2W / 2, doorMY, doorZ]} rotation={[0, -openAngle, 0]}>
              {isSignature ? (
                <group position={[door2W / 2, 0, 0]}>
                  <SignatureDoorPanel
                    width={door2W} height={doorH} thickness={doorThick}
                    handleOnPlusX={true}
                    doorMat={doorMat} lipMat={sigLipMat}
                  />
                </group>
              ) : (
                <RoundedBox args={[door2W, doorH, doorThick]} radius={doorRadius} smoothness={4} position={[door2W / 2, 0, 0]} castShadow>
                  {doorMat}
                </RoundedBox>
              )}
              {handleL.map((h, i) => <group key={`hL-${i}`} position={[door2W / 2, 0, 0]}>{h}</group>)}
            </group>
            {/* Right door — hinges on right edge, swings outward; seam at -X (inner edge) */}
            <group position={[rDX + door2W / 2, doorMY, doorZ]} rotation={[0, openAngle, 0]}>
              {isSignature ? (
                <group position={[-door2W / 2, 0, 0]}>
                  <SignatureDoorPanel
                    width={door2W} height={doorH} thickness={doorThick}
                    handleOnPlusX={false}
                    doorMat={doorMat} lipMat={sigLipMat}
                  />
                </group>
              ) : (
                <RoundedBox args={[door2W, doorH, doorThick]} radius={doorRadius} smoothness={4} position={[-door2W / 2, 0, 0]} castShadow>
                  {doorMat}
                </RoundedBox>
              )}
              {handleR.map((h, i) => <group key={`hR-${i}`} position={[-door2W / 2, 0, 0]}>{h}</group>)}
            </group>
          </>)}
          {/* Drawers — stacked above door area (or filling full height for drawer-only) */}
          {drawerCount > 0 && (() => {
            const meshes: JSX.Element[] = []
            const gap    = reveal || FT(0.1)  // Signature: reveal gap; Technica: small visual seam
            const drawerFW = door1W  // full width - side stiles (already has reveal)
            // For drawer-only (doors===0): fill exactly available space top-to-bottom
            // For combo (1-drawer + 2-door): sit at top, 6" per drawer
            const drawerAreaY0 = (cabinet.doors === 0 ? baseY0 : fullY1 - drawerCount * drawerH6) + reveal
            const drawerAreaH  = (cabinet.doors === 0 ? fullY1 - baseY0 : drawerCount * drawerH6) - 2 * reveal
            // 5-drawer layout (bottom to top):
            //   Signature: 1 large, 2 medium, 2 small (6:4:4:3:3)
            //   Technica:  1 large, 4 medium (6:3.5:3.5:3.5:3.5)
            const sigRatios = [6, 4, 4, 3, 3]
            const tecRatios = [6, 3.5, 3.5, 3.5, 3.5]
            const drawerRatios = drawerCount === 5 ? (isSignature ? sigRatios : tecRatios) : Array(drawerCount).fill(1)
            const ratioSum = drawerRatios.reduce((a, b) => a + b, 0)
            const drawerHeights = drawerRatios.map(r => (r / ratioSum) * drawerAreaH)
            const isDrawerOnly = cabinet.doors === 0
            // Signature: wide silver bar recessed into top edge of each drawer
            // Technica: same blade handle as doors, rotated horizontal (19" or capped to fit)
            const sigPullW = drawerFW - FT(1)
            const sigPullH = FT(0.5)
            const sigPullD = FT(0.55)
            const tecBladeLen = Math.min(FT(19), drawerFW - FT(2)) // cap to drawer width
            let cumY = drawerAreaY0
            for (let i = 0; i < drawerCount; i++) {
              const y0  = cumY
              const fH  = drawerHeights[i] - gap
              cumY += drawerHeights[i]
              const fMY = y0 + fH / 2
              meshes.push(
                <RoundedBox key={`dr${i}`} args={[drawerFW, fH, doorThick]} radius={doorRadius} smoothness={4} position={[0, fMY, doorZ]} castShadow>
                  {doorMat}
                </RoundedBox>
              )
              if (isSignature) {
                // Signature: recessed bar at top edge
                const drPullY = y0 + fH - sigPullH / 2
                const drPullZ = doorZ - doorThick / 2 + sigPullD / 2
                meshes.push(
                  <mesh key={`drh${i}`} position={[0, drPullY, drPullZ]}>{handleMat}
                    <boxGeometry args={[sigPullW, sigPullH, sigPullD]} />
                  </mesh>
                )
              } else {
                // Technica: horizontal blade handle (same design as door handles, rotated 90°)
                meshes.push(
                  <group key={`drh${i}`} position={[0, fMY, 0]} rotation={[0, 0, -Math.PI / 2]}>
                    {technicaBladeHandle(`dh${i}`, 0, 0, doorFrontZ, tecBladeLen, handleMat)}
                  </group>
                )
              }
            }
            return meshes
          })()}
        </>)}
      </>
      {/* Under-cabinet puck spotlight (upper cabinets only). The cabinet group
          origin is at the bottom-center of the cabinet, so this spotlight aims
          straight down at a local target just below. Shadow frustum FOV tracks
          the cone angle so edge artifacts don't appear when the beam widens. */}
      {cabinet.style === 'upper' && cabinet.underLight && !blueprint && !wireframe && (() => {
        const coneAngle = cabinet.underLightAngle ?? (75 * Math.PI) / 180
        const fovDeg = Math.min(170, (coneAngle * 2 * 180) / Math.PI + 10)
        return (
          <UnderCabinetPuck coneAngle={coneAngle} fovDeg={fovDeg} />
        )
      })()}
    </group>
  )
})

/** Under-cabinet puck spotlight. Rendered as a child of the cabinet group so
 *  its target (also a local child) moves with the cabinet — prevents the
 *  spotlight from aiming at world origin when the cabinet is repositioned. */
function UnderCabinetPuck({ coneAngle, fovDeg }: { coneAngle: number; fovDeg: number }) {
  const targetRef = useRef<THREE.Object3D>(null!)
  const spotRef = useRef<THREE.SpotLight>(null!)
  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current
    }
  }, [])
  // Matches the ceiling puck visual: 4" trim ring + bright white diffuser disc,
  // both hanging just below the cabinet bottom panel (which is 0.75" thick).
  // Local y=0 is the underside of the cabinet; the puck hangs below it so the
  // diffuser isn't z-fought by the panel.
  const PUCK_R    = 2 / 12             // 2" radius = 4" diameter, matches ceiling
  const PUCK_TRIM = 2.3 / 12           // slightly larger bezel
  const PUCK_H    = (1 / 16) / 12      // 1/16" trim thickness
  const DROP      = 0.2 / 12           // 0.2" below the cabinet underside
  return (
    <>
      {/* Trim ring — matches ceiling puck material */}
      <mesh position={[0, -DROP - PUCK_H / 2, 0]}>
        <cylinderGeometry args={[PUCK_TRIM, PUCK_TRIM, PUCK_H, 24]} />
        <meshLambertMaterial color="#d0d0cc" />
      </mesh>
      {/* Bright white diffuser disc — MeshBasicMaterial with toneMapped off so
          it renders flat white regardless of scene exposure, exactly like the
          ceiling pucks. */}
      <mesh position={[0, -DROP - PUCK_H - 0.005, 0]}>
        <cylinderGeometry args={[PUCK_R, PUCK_R, 0.01, 24]} />
        <meshBasicMaterial color="#ffffff" toneMapped={false} />
      </mesh>
      {/* Target sits directly below the puck — spotlight aims straight down */}
      <object3D ref={targetRef} position={[0, -5, 0]} />
      <spotLight
        ref={spotRef}
        position={[0, -DROP - PUCK_H - 0.02, 0]}
        angle={coneAngle}
        penumbra={0.6}
        intensity={8}
        color="#fff5e0"
        decay={1.5}
        distance={18}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0008}
        shadow-normalBias={0.04}
        shadow-camera-near={0.1}
        shadow-camera-far={20}
        shadow-camera-fov={fovDeg}
      />
    </>
  )
}

// ─── Countertop mesh ─────────────────────────────────────────────────────────
// Singleton butcher-block texture — created once and reused across all countertops
let _bbTex: THREE.CanvasTexture | null = null
function getButcherBlockTex(): THREE.CanvasTexture {
  if (!_bbTex) _bbTex = createButcherBlockTexture()
  return _bbTex
}

function CountertopMesh({ ct, selected, wireframe, blueprint, onClick, onPointerDown }: {
  ct: Countertop; selected: boolean; wireframe: boolean; blueprint?: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const wFt = FT(ct.width), dFt = FT(COUNTERTOP_DEPTH), tFt = FT(COUNTERTOP_THICKNESS)
  const col = blueprint ? (selected ? '#555555' : '#444444') : wireframe ? (selected ? '#ffcc00' : '#ff9944') : (CT_COLORS[ct.color] ?? CT_COLORS['butcher-block'])
  const isButcherBlock = ct.color === 'butcher-block'
  const isStainless = ct.color === 'stainless-steel' || ct.color === 'black-stainless'
  const isBlackStainless = ct.color === 'black-stainless'

  // Butcher-block: tile the wood texture proportionally to countertop size
  const bbTex = useMemo(() => {
    if (!isButcherBlock || blueprint || wireframe) return null
    const tex = getButcherBlockTex().clone()
    // Repeat so grain scale stays consistent regardless of countertop width
    tex.repeat.set(wFt / 2.5, dFt / 2.5)
    tex.needsUpdate = true
    return tex
  }, [isButcherBlock, blueprint, wireframe, wFt, dFt])

  // Brushed stainless PBR texture set (AmbientCG Metal009). useTexture is a
  // drei hook so it must run unconditionally; the cloned tiled instances
  // below are only actually applied to the material when isStainless is true.
  const stainlessSrc = useTexture({
    map:          `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/color.jpg`,
    normalMap:    `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/normal.jpg`,
    roughnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/roughness.jpg`,
    metalnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/metalness.jpg`,
  })

  // Clone the shared textures per-countertop and set repeat so the brush
  // streaks run along the long (X) axis and stay visually consistent across
  // widths. The source texture has horizontal strokes, so U maps to width
  // (brush direction) and V maps to depth.
  const stainlessMaps = useMemo(() => {
    if (!isStainless || blueprint || wireframe) return null
    const map          = stainlessSrc.map.clone()
    const normalMap    = stainlessSrc.normalMap.clone()
    const roughnessMap = stainlessSrc.roughnessMap.clone()
    const metalnessMap = stainlessSrc.metalnessMap.clone()
    const repX = Math.max(1, wFt / 2)
    const repY = Math.max(1, dFt / 1.5)
    for (const t of [map, normalMap, roughnessMap, metalnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repX, repY)
      t.needsUpdate = true
    }
    map.colorSpace = THREE.SRGBColorSpace
    normalMap.colorSpace = THREE.NoColorSpace
    roughnessMap.colorSpace = THREE.NoColorSpace
    metalnessMap.colorSpace = THREE.NoColorSpace
    return { map, normalMap, roughnessMap, metalnessMap }
  }, [isStainless, blueprint, wireframe, wFt, dFt, stainlessSrc])

  return (
    <group
      position={[FT(ct.x), FT(ct.y), FT(ct.z)]}
      rotation={[0, ct.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      <RoundedBox
        args={[wFt, tFt, dFt]}
        radius={FT(0.075)}
        smoothness={16}
        creaseAngle={1.5}
        position={[0, tFt / 2, 0]}
        castShadow
        receiveShadow
      >
        {blueprint ? (
          <meshBasicMaterial color={col} />
        ) : wireframe ? (
          <meshLambertMaterial wireframe color={col}
            emissive={selected ? '#445566' : '#000000'} emissiveIntensity={selected ? 0.25 : 0} />
        ) : isButcherBlock ? (
          <meshStandardMaterial
            map={bbTex}
            color="#ffffff"
            roughness={0.5}
            metalness={0.0}
            emissive={selected ? '#445566' : '#000000'}
            emissiveIntensity={selected ? 0.25 : 0}
            envMapIntensity={0.3}
          />
        ) : isStainless ? (
          /* Pure texture lookup — no env-map reflections. metalness forced
             to 0 (dielectric) and envMapIntensity 0 so the surface only
             shows the diffuse color map + normal relief + direct scene
             lighting. */
          <meshPhysicalMaterial
            map={stainlessMaps?.map}
            normalMap={stainlessMaps?.normalMap}
            normalScale={[0.8, 0.8] as unknown as THREE.Vector2}
            roughnessMap={stainlessMaps?.roughnessMap}
            color={isBlackStainless ? '#3d4045' : '#ffffff'}
            metalness={0}
            roughness={0.65}
            clearcoat={0}
            emissive={selected ? '#445566' : '#000000'}
            emissiveIntensity={selected ? 0.25 : 0}
            envMapIntensity={0}
          />
        ) : (
          <meshStandardMaterial color={col}
            roughness={0.45} metalness={0.05}
            emissive={selected ? '#445566' : '#000000'} emissiveIntensity={selected ? 0.25 : 0} />
        )}
      </RoundedBox>

    </group>
  )
}

// ─── Overhead storage rack ─────────────────────────────────────────────────────
// Wire-deck platform with 4 square-tube legs hanging from the ceiling.
function OverheadRackMesh({ rack, chFt, selected, wireframe, onClick, onPointerDown }: {
  rack: OverheadRack; chFt: number; selected: boolean; wireframe: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const wFt = FT(rack.rackWidth)
  const lFt = FT(rack.rackLength)
  const deckTh = FT(RACK_DECK_THICKNESS)
  const legSz = FT(RACK_LEG_SIZE)
  const dropFt = FT(rack.drop)

  // Drop measures from ceiling to the absolute bottom of the deck base
  const deckBottomY = chFt - dropFt
  const deckTopY = deckBottomY + deckTh
  const deckCenterY = deckBottomY + deckTh / 2

  // Legs run from ceiling down to deck top
  const legLen = dropFt
  const legCenterY = chFt - legLen / 2

  // Leg positions at 4 corners (inset by half leg size)
  const hw = wFt / 2 - legSz / 2
  const hl = lFt / 2 - legSz / 2
  const legPositions: [number, number, number][] = [
    [-hw, legCenterY, -hl],
    [ hw, legCenterY, -hl],
    [-hw, legCenterY,  hl],
    [ hw, legCenterY,  hl],
  ]

  const frameColor = wireframe ? (selected ? '#ffcc00' : '#ff6644') : rack.color
  const deckColor = wireframe ? frameColor : '#555555'
  const highlight = selected ? 0.3 : 0

  // Dark brushed-stainless PBR texture set — same AmbientCG Metal009 source
  // the black-stainless countertop uses. Rendered with color='#3d4045' so
  // the brushed streaks stay visible but the surface reads as dark metal.
  // useTexture is a drei hook and must run unconditionally.
  const stainlessSrc = useTexture({
    map:          `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/color.jpg`,
    normalMap:    `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/normal.jpg`,
    roughnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/roughness.jpg`,
    metalnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/metalness.jpg`,
  })
  const stainlessMaps = useMemo(() => {
    if (wireframe) return null
    const map          = stainlessSrc.map.clone()
    const normalMap    = stainlessSrc.normalMap.clone()
    const roughnessMap = stainlessSrc.roughnessMap.clone()
    const metalnessMap = stainlessSrc.metalnessMap.clone()
    // Tile along both axes so brushed streaks stay at realistic scale
    // regardless of rack dimensions.
    const repX = Math.max(1, wFt / 2)
    const repY = Math.max(1, lFt / 2)
    for (const t of [map, normalMap, roughnessMap, metalnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repX, repY)
      t.needsUpdate = true
    }
    map.colorSpace = THREE.SRGBColorSpace
    normalMap.colorSpace = THREE.NoColorSpace
    roughnessMap.colorSpace = THREE.NoColorSpace
    metalnessMap.colorSpace = THREE.NoColorSpace
    return { map, normalMap, roughnessMap, metalnessMap }
  }, [wireframe, wFt, lFt, stainlessSrc])

  return (
    <group
      position={[FT(rack.x), 0, FT(rack.z)]}
      rotation={[0, rack.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      {/* Wire mesh deck — outer frame + cross wire grid (see-through like real racks) */}
      {(() => {
        const barTh = 0.02  // wire bar thickness in feet (~1/4")
        const frameBarW = 0.04 // frame rail width (~1/2")
        // Dark brushed-stainless — matches the black-stainless countertop.
        // metalness=0 + envMapIntensity=0 keeps the finish lookup driven by
        // the texture maps rather than env reflections.
        const matProps = {
          color: wireframe ? frameColor : '#3d4045',
          map: stainlessMaps?.map ?? null,
          normalMap: stainlessMaps?.normalMap ?? null,
          normalScale: [0.8, 0.8] as unknown as THREE.Vector2,
          roughnessMap: stainlessMaps?.roughnessMap ?? null,
          metalness: 0 as number,
          roughness: 0.65 as number,
          envMapIntensity: 0,
          emissive: selected ? '#ffcc00' : '#000000',
          emissiveIntensity: highlight,
        }
        const wireMat = {
          color: wireframe ? frameColor : '#888888',
          metalness: 0.45 as number,
          roughness: 0.40 as number,
          emissive: selected ? '#ffcc00' : '#000000',
          emissiveIntensity: highlight,
        }
        return (
          <group position={[0, deckCenterY, 0]}>
            {/* Outer frame — 4 rails */}
            <mesh position={[0, 0, -lFt/2 + frameBarW/2]} castShadow>
              <boxGeometry args={[wFt, deckTh, frameBarW]} />
              <meshPhysicalMaterial wireframe={wireframe} {...matProps} />
            </mesh>
            <mesh position={[0, 0, lFt/2 - frameBarW/2]} castShadow>
              <boxGeometry args={[wFt, deckTh, frameBarW]} />
              <meshPhysicalMaterial wireframe={wireframe} {...matProps} />
            </mesh>
            <mesh position={[-wFt/2 + frameBarW/2, 0, 0]} castShadow>
              <boxGeometry args={[frameBarW, deckTh, lFt - frameBarW*2]} />
              <meshPhysicalMaterial wireframe={wireframe} {...matProps} />
            </mesh>
            <mesh position={[wFt/2 - frameBarW/2, 0, 0]} castShadow>
              <boxGeometry args={[frameBarW, deckTh, lFt - frameBarW*2]} />
              <meshPhysicalMaterial wireframe={wireframe} {...matProps} />
            </mesh>

            {/* Cross wires — along width (every ~3") */}
            {!wireframe && Array.from({ length: Math.max(0, Math.floor(lFt / 0.25) - 1) }, (_, i) => {
              const z = -lFt / 2 + frameBarW + (i + 1) * ((lFt - frameBarW*2) / (Math.floor(lFt / 0.25)))
              if (z > lFt / 2 - frameBarW) return null
              return (
                <mesh key={`w${i}`} position={[0, 0, z]}>
                  <boxGeometry args={[wFt - frameBarW*2, barTh, barTh]} />
                  <meshStandardMaterial {...wireMat} />
                </mesh>
              )
            })}
            {/* Cross wires — along length (every ~6") */}
            {!wireframe && Array.from({ length: Math.max(0, Math.floor(wFt / 0.5) - 1) }, (_, i) => {
              const x = -wFt / 2 + frameBarW + (i + 1) * ((wFt - frameBarW*2) / (Math.floor(wFt / 0.5)))
              if (x > wFt / 2 - frameBarW) return null
              return (
                <mesh key={`l${i}`} position={[x, 0, 0]}>
                  <boxGeometry args={[barTh, barTh, lFt - frameBarW*2]} />
                  <meshStandardMaterial {...wireMat} />
                </mesh>
              )
            })}
          </group>
        )
      })()}

      {/* 4 legs + ceiling brackets */}
      {legPositions.map((pos, i) => {
        const bTh = 0.008          // plate thickness ~1/8"
        const bFlange = 2           // 2 feet bracket bar on ceiling
        // Dark brushed-stainless material shared by legs + brackets.
        const bMat = {
          color: wireframe ? frameColor : '#3d4045',
          map: stainlessMaps?.map ?? null,
          normalMap: stainlessMaps?.normalMap ?? null,
          normalScale: [0.8, 0.8] as unknown as THREE.Vector2,
          roughnessMap: stainlessMaps?.roughnessMap ?? null,
          metalness: 0 as number,
          roughness: 0.65 as number,
          envMapIntensity: 0,
          emissive: selected ? '#ffcc00' : '#000000',
          emissiveIntensity: highlight,
        }

        return (
          <group key={i}>
            {/* Leg tube */}
            <mesh position={pos} castShadow>
              <boxGeometry args={[legSz, legLen, legSz]} />
              <meshPhysicalMaterial wireframe={wireframe} {...bMat} />
            </mesh>

            {/* Single straight bar bracket per leg — runs along the rack's length direction, flush to ceiling */}
            {!wireframe && (
              <mesh position={[pos[0], chFt - bTh/2, pos[2]]}>
                <boxGeometry args={[legSz, bTh, bFlange]} />
                <meshPhysicalMaterial {...bMat} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

// ─── Ceiling LED bar fixture (1ft × 4ft × 2") ────────────────────────────────
// 1" aluminum frame border around all edges, inner rectangle is the light panel.
// Light emits downward only — opaque housing blocks upward leakage.
const FRAME_BORDER = 1 / 12 // 1 inch in feet

// Puck light dimensions (4" diameter, 1" thick recessed can)
const PUCK_RADIUS  = 4 / 12 / 2     // 2 inches in feet
const PUCK_TH      = (1 / 16) / 12  // 1/16" — only the trim protrudes from ceiling
const PUCK_TRIM_R  = 4.6 / 12 / 2   // slightly larger trim ring

/** Spotlight + bounce fill for a puck light. The target object3D is a child of
 *  the parent group so its world matrix updates with the group transform —
 *  this prevents the spotlight from aiming at world origin (which causes the
 *  visible inward streak from corner pucks). */
function LedBarSpot({ bottomY, lenFt, depthFt, light, lightMultiplier, exposure }: {
  bottomY: number; lenFt: number; depthFt: number; light: CeilingLight
  lightMultiplier: number; exposure: number; bounceIntensity: number; bounceDistance: number
}) {
  // Pure elongated emission: rectAreaLight matches the bar footprint and emits
  // downward. No spotlight — the area light is the light, shape and all.
  return (
    <rectAreaLight
      position={[0, bottomY - 0.01, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      width={lenFt}
      height={depthFt}
      intensity={light.intensity * lightMultiplier * exposure}
      color={light.color}
    />
  )
}

function PuckSpotlight({ bottomY, light, lightMultiplier, bounceDistance, effectiveQuality }: {
  bottomY: number; light: CeilingLight; lightMultiplier: number;
  bounceDistance: number; effectiveQuality: 'high' | 'medium' | 'low'
}) {
  const targetRef = useRef<THREE.Object3D>(null!)
  const spotRef = useRef<THREE.SpotLight>(null!)
  useEffect(() => {
    if (spotRef.current && targetRef.current) {
      spotRef.current.target = targetRef.current
    }
  }, [])
  return (
    <>
      <object3D ref={targetRef} position={[0, bottomY - 5, 0]} />
      {/* Wide spotlight with full penumbra — produces soft, area-filling light below.
         Shadow camera FOV must match (or exceed) the spot angle, otherwise the
         shadow map's frustum is narrower than the lit cone and you get visible
         band/stripe artifacts where shadows abruptly cut off on the walls. */}
      {/* Puck lights are fill illumination — no shadows. Each shadow-casting
         spotlight eats one fragment texture unit (MAX_TEXTURE_IMAGE_UNITS=16
         on many GPUs), and with 12+ pucks in large garages the shader fails
         to link (FRAGMENT shader texture image units count exceeds MAX), so
         materials that hit the limit render fully transparent — the floor
         and cabinet handles would disappear. Ambient/fill shadows from 12
         overlapping pucks cancel out visually anyway. */}
      <spotLight
        ref={spotRef}
        position={[0, bottomY - 0.01, 0]}
        angle={Math.PI / 2.2}
        penumbra={1}
        intensity={light.intensity * lightMultiplier * 0.5}
        color={light.color}
        decay={1.5}
        distance={Math.max(bounceDistance, 25)}
        castShadow={false}
      />
    </>
  )
}

function CeilingLightMesh({ light, chFt, selected, wireframe, castsShadow, onClick, onPointerDown }: {
  light: CeilingLight; chFt: number; selected: boolean; wireframe: boolean
  castsShadow: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { bounceIntensity, bounceDistance, lightMultiplier, qualityPreset, isExporting, exposure } = useGarageStore()
  const effectiveQuality = isExporting ? 'high' : qualityPreset
  const kind = light.kind ?? 'bar'
  const frameColor  = wireframe ? (selected ? '#ffcc00' : '#ff9944') : '#d0d0cc'

  if (kind === 'puck') {
    // Recessed puck light: trim ring + flush diffuser, illuminates downward
    const yCenter = chFt - PUCK_TH / 2 - 0.02
    const bottomY = -PUCK_TH / 2
    return (
      <group
        position={[light.x, yCenter, light.z]}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerDown={onPointerDown}
      >
        {/* Trim ring */}
        <mesh position={[0, 0, 0]}>
          <cylinderGeometry args={[PUCK_TRIM_R, PUCK_TRIM_R, PUCK_TH, 24]} />
          <meshLambertMaterial wireframe={wireframe} color={frameColor}
            emissive={selected ? '#334466' : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
        </mesh>
        {/* Bright white disc — uses MeshBasicMaterial so it always renders flat
           white regardless of scene lighting, with no emissive bloom halo */}
        {!wireframe && (
          <mesh position={[0, bottomY - 0.005, 0]}>
            <cylinderGeometry args={[PUCK_RADIUS, PUCK_RADIUS, 0.01, 24]} />
            <meshBasicMaterial color={light.enabled ? '#ffffff' : '#555555'} toneMapped={false} />
          </mesh>
        )}
        {/* Spot light pointing straight down — narrower beam than bar fixtures.
           The target must be a real Object3D in the scene graph so its matrixWorld
           updates with the parent group; otherwise SpotLight aims at world origin. */}
        {light.enabled && !wireframe && <PuckSpotlight bottomY={bottomY}
          light={light} lightMultiplier={lightMultiplier}
          bounceDistance={bounceDistance} effectiveQuality={effectiveQuality} />}
      </group>
    )
  }

  if (kind === 'ledbar') {
    // Under-cabinet LED bar: 1/4" thick (Y), 1" deep (across cabinet depth),
    // length adjustable. Mounted at light.y (cabinet bottom) — not ceiling.
    const lengthIn = light.lengthIn ?? 18
    const mountYFt = light.y ?? (chFt - 1)
    const thickFt = FT(0.25)
    const depthFt = FT(1)
    const lenFt   = FT(lengthIn)
    const bottomY = -thickFt / 2
    const yCenter = mountYFt - thickFt / 2 - 0.005
    return (
      <group
        position={[light.x, yCenter, light.z]}
        rotation={[0, light.rotY, 0]}
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerDown={onPointerDown}
      >
        {/* Fixture body — thin aluminum strip under cabinet */}
        <mesh>
          <boxGeometry args={[lenFt, thickFt, depthFt]} />
          <meshLambertMaterial wireframe={wireframe} color={frameColor}
            emissive={selected ? '#334466' : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
        </mesh>
        {/* Emissive diffuser strip — flat white, not affected by scene lighting */}
        {!wireframe && (
          <mesh position={[0, bottomY - 0.002, 0]}>
            <boxGeometry args={[lenFt * 0.98, 0.004, depthFt * 0.8]} />
            <meshBasicMaterial color={light.enabled ? '#ffffff' : '#555555'} toneMapped={false} />
          </mesh>
        )}
        {/* Downward rectAreaLight + narrow spot (target must be a real Object3D
           in the scene graph or the spotLight aims at world origin). */}
        {light.enabled && !wireframe && (
          <LedBarSpot bottomY={bottomY} lenFt={lenFt} depthFt={depthFt} light={light}
            lightMultiplier={lightMultiplier} exposure={exposure}
            bounceIntensity={bounceIntensity} bounceDistance={bounceDistance} />
        )}
      </group>
    )
  }

  // ── Bar fixture (default) ──
  // Fixture hangs just below ceiling — small gap avoids z-fighting
  const yCenter = chFt - CEILING_LIGHT_TH / 2 - 0.02
  // Inner diffuser dimensions (1" frame inset on each side)
  const innerW = CEILING_LIGHT_W - FRAME_BORDER * 2
  const innerL = CEILING_LIGHT_L - FRAME_BORDER * 2
  const bottomY = -CEILING_LIGHT_TH / 2

  return (
    <group
      position={[light.x, yCenter, light.z]}
      rotation={[0, light.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      {/* Single frame box — no top plate needed, ceiling covers above */}
      <mesh>
        <boxGeometry args={[CEILING_LIGHT_W, CEILING_LIGHT_TH, CEILING_LIGHT_L]} />
        <meshLambertMaterial wireframe={wireframe} color={frameColor}
          emissive={selected ? '#334466' : '#000000'} emissiveIntensity={selected ? 0.3 : 0} />
      </mesh>

      {/* Bright white diffuser panel — uses MeshBasicMaterial for a flat appearance
         with no emissive bloom halo around the fixture */}
      {!wireframe && (
        <mesh position={[0, bottomY - 0.005, 0]}>
          <boxGeometry args={[innerW, 0.01, innerL]} />
          <meshBasicMaterial color={light.enabled ? '#ffffff' : '#555555'} toneMapped={false} />
        </mesh>
      )}

      {/* Rect area light — matches inner diffuser dimensions, faces straight down.
         rectAreaLight only emits from its front face so no upward light leakage. */}
      {light.enabled && !wireframe && (
        <>
          <rectAreaLight
            position={[0, bottomY - 0.01, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            width={innerL}
            height={innerW}
            intensity={light.intensity * lightMultiplier * exposure}
            color={light.color}
          />
          {/* Downward spotlight as shadow caster — cheaper than pointLight
             (1 shadow map vs 6 cubemap faces) and casts realistic downward
             shadows from cabinets/racks. Wide angle covers full floor area. */}
          <spotLight
            position={[0, bottomY - 0.5, 0]}
            target-position={[0, bottomY - 10, 0]}
            intensity={light.intensity * bounceIntensity * exposure}
            color={light.color}
            angle={Math.PI / 2.5}
            penumbra={0.6}
            decay={2}
            distance={bounceDistance}
            castShadow={castsShadow}
            shadow-mapSize-width={effectiveQuality === 'high' ? 2048 : 1024}
            shadow-mapSize-height={effectiveQuality === 'high' ? 2048 : 1024}
            shadow-bias={-0.0008}
            shadow-normalBias={0.04}
            shadow-radius={effectiveQuality === 'high' ? 8 : 4}
          />
        </>
      )}
    </group>
  )
}

// ─── Slatwall groove geometry constants ──────────────────────────────────────
// Standard slatwall: 3" on-center spacing, 3/8" groove, 1/4" groove depth
const SLAT_PERIOD     = 3       // inches center-to-center
const SLAT_BOARD_H    = 2.625   // board face height (3" - 3/8" groove)
const SLAT_GROOVE_H   = 0.375   // groove opening width
const SLAT_GROOVE_D   = 0.25    // groove depth (1/4")

function darkenHex(hex: string, factor: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const d = (v: number) => Math.round(v * (1 - factor)).toString(16).padStart(2, '0')
  return `#${d(r)}${d(g)}${d(b)}`
}

// Returns roughness 0.35 (light/white) → 0.75 (black) based on perceived brightness
function slatRoughness(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return 0.75 - luminance * 0.40   // white→0.35, black→0.75
}

// ─── Garage-door threshold ────────────────────────────────────────────────────
// Two pieces:
//  1. Floor patch  — thin textured box fills the floor gap under the wall opening
//  2. Threshold bump — small raised strip along the interior edge covers the floor cut-off
const THRESH_H     = 0.5   // floor-patch height in inches (thin, almost flush with floor)

function GarageDoorThreshold({ doorW, wallThickness, localX, baseTex, wireframe }: {
  doorW: number; wallThickness: number; localX: number
  baseTex: THREE.Texture; wireframe: boolean
}) {
  const floorTex = useMemo(() => { const t = baseTex.clone(); t.needsUpdate = true; return t }, [baseTex])
  floorTex.repeat.set(FT(doorW) * baseTex.repeat.x, FT(wallThickness) * baseTex.repeat.y)

  const patchY  = FT(THRESH_H / 2)

  const wfColor = wireframe ? '#1a2a3a' : '#ffffff'

  return (
    <group position={[localX, 0, 0]}>
      {/* Floor patch — textured box that fills the floor gap across the wall thickness */}
      <mesh position={[0, patchY, 0]}>
        <boxGeometry args={[FT(doorW), FT(THRESH_H), FT(wallThickness)]} />
        <meshStandardMaterial
          map={wireframe ? null : floorTex} color={wfColor}
          wireframe={wireframe} roughness={0.55} metalness={0.0}
          polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-2}
        />
      </mesh>
    </group>
  )
}

// ─── Clone a texture so we don't mutate the shared cached copy ───────────────
function useClonedTexture(src: THREE.Texture | undefined): THREE.Texture | undefined {
  return useMemo(() => {
    if (!src) return undefined
    const c = src.clone()
    c.needsUpdate = true
    return c
  }, [src])
}

// ─── Textured wall material (loads texture only when textureId is set) ────────
function TexturedWallMaterial({ textureId, widthFt, heightFt, selected }: {
  textureId: string; widthFt: number; heightFt: number; selected: boolean
}) {
  const entry = getTextureById(textureId)
  const basePath = `${import.meta.env.BASE_URL}${texturePath(entry!.category, entry!.file)}`
  const normalPath = entry?.normalFile
    ? `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.normalFile)}`
    : undefined
  const roughPath = entry?.roughFile
    ? `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.roughFile)}`
    : undefined

  const paths = [basePath, normalPath, roughPath].filter(Boolean) as string[]
  const textures = useTexture(paths)

  const srcDiffuse = Array.isArray(textures) ? textures[0] : textures
  const srcNormal = Array.isArray(textures) && normalPath ? textures[1] : undefined
  const srcRough = Array.isArray(textures) && roughPath ? textures[normalPath ? 2 : 1] : undefined

  // Clone so we don't mutate the shared cached texture
  const diffuse = useClonedTexture(srcDiffuse)
  const normal = useClonedTexture(srcNormal)
  const rough = useClonedTexture(srcRough)

  useMemo(() => {
    [diffuse, normal, rough].forEach(t => {
      if (!t) return
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      // Scale: ~4ft per texture repeat
      t.repeat.set(widthFt / 4, heightFt / 4)
    })
  }, [diffuse, normal, rough, widthFt, heightFt])

  return (
    <meshStandardMaterial
      map={diffuse || null}
      normalMap={normal || null}
      roughnessMap={rough || null}
      roughness={rough ? 1.0 : 0.7}
      color={selected ? '#d0e8ff' : '#ffffff'}
    />
  )
}

/** Wrapper that looks up the imported asset data URL from the store */
function ImportedWallTexture({ assetId, widthFt, heightFt, selected }: {
  assetId: string; widthFt: number; heightFt: number; selected: boolean
}) {
  const asset = useGarageStore(s => s.importedAssets.find(a => a.id === assetId))
  if (!asset) return <meshLambertMaterial color="#e0dedd" />
  return <ImportedTextureMaterial
    dataUrl={asset.data}
    normalUrl={asset.normalMap} roughnessUrl={asset.roughnessMap}
    metalnessUrl={asset.metalnessMap} aoUrl={asset.aoMap}
    widthFt={widthFt} heightFt={heightFt} selected={selected}
  />
}

/** Generic material for a shape — accepts a wall textureId, 'floor:<id>',
 *  'imported:<id>', or neither (solid color fallback).
 *
 *  Tiling: uses the two largest dimensions of the shape so the texture doesn't
 *  stretch when the shape is resized. `uFt` spans the wrapping axis (e.g. the
 *  larger of width/depth for a box), `vFt` spans the vertical/other axis.
 */
function TexturedShapeMaterial({ textureId, color, uFt, vFt, scale = 1, wireframe, selected }: {
  textureId?: string; color: string; uFt: number; vFt: number; scale?: number; wireframe: boolean; selected: boolean
}) {
  // Route: no textureId → solid color
  if (!textureId) {
    return (
      <meshStandardMaterial
        wireframe={wireframe}
        color={selected ? '#d0e8ff' : color}
        roughness={0.7}
        emissive={selected ? '#4488bb' : '#000000'}
        emissiveIntensity={selected ? 0.25 : 0}
      />
    )
  }
  if (textureId.startsWith('floor:')) {
    const floorId = textureId.slice('floor:'.length)
    return <FloorIdTextureMaterial id={floorId} uFt={uFt} vFt={vFt} scale={scale} selected={selected} wireframe={wireframe} />
  }
  if (textureId.startsWith('imported:')) {
    const assetId = textureId.slice('imported:'.length)
    return <ImportedShapeTexture assetId={assetId} uFt={uFt} vFt={vFt} scale={scale} selected={selected} />
  }
  // Wall catalog
  const entry = getTextureById(textureId)
  if (!entry) {
    return (
      <meshStandardMaterial color={selected ? '#d0e8ff' : color} roughness={0.7} wireframe={wireframe} />
    )
  }
  return <WallIdTextureMaterial textureId={textureId} uFt={uFt} vFt={vFt} scale={scale} selected={selected} wireframe={wireframe} />
}

/** Wall-catalog texture sized for a shape (normal + roughness when available).
 *  UV repeat scales independently per axis (uFt×vFt in feet) so the pattern
 *  doesn't stretch when the shape is resized along one dimension.
 */
function WallIdTextureMaterial({ textureId, uFt, vFt, scale = 1, selected, wireframe }: {
  textureId: string; uFt: number; vFt: number; scale?: number; selected: boolean; wireframe: boolean
}) {
  const entry = getTextureById(textureId)!
  const basePath = `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.file)}`
  const normalPath = entry.normalFile
    ? `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.normalFile)}`
    : undefined
  const roughPath = entry.roughFile
    ? `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.roughFile)}`
    : undefined
  const paths = [basePath, normalPath, roughPath].filter(Boolean) as string[]
  const textures = useTexture(paths)
  const srcDiffuse = Array.isArray(textures) ? textures[0] : textures
  const srcNormal = Array.isArray(textures) && normalPath ? textures[1] : undefined
  const srcRough = Array.isArray(textures) && roughPath ? textures[normalPath ? 2 : 1] : undefined
  const diffuse = useClonedTexture(srcDiffuse)
  const normal = useClonedTexture(srcNormal)
  const rough = useClonedTexture(srcRough)
  useMemo(() => {
    const repU = Math.max(0.05, (uFt / 4) * scale)
    const repV = Math.max(0.05, (vFt / 4) * scale)
    for (const t of [diffuse, normal, rough]) {
      if (!t) continue
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repU, repV)
      t.needsUpdate = true
    }
  }, [diffuse, normal, rough, uFt, vFt, scale])
  return (
    <meshStandardMaterial
      wireframe={wireframe}
      map={diffuse || null}
      normalMap={normal || null}
      roughnessMap={rough || null}
      roughness={rough ? 1.0 : 0.7}
      color={selected ? '#d0e8ff' : '#ffffff'}
    />
  )
}

/** Floor-catalog texture sized for a shape. */
function FloorIdTextureMaterial({ id, uFt, vFt, scale = 1, selected, wireframe }: {
  id: string; uFt: number; vFt: number; scale?: number; selected: boolean; wireframe: boolean
}) {
  const path = `${import.meta.env.BASE_URL}${flooringTexturePathById(id)}`
  const src = useTexture(path)
  const tex = useClonedTexture(src as THREE.Texture)
  useMemo(() => {
    if (!tex) return
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    const repU = Math.max(0.05, (uFt / 2) * scale)
    const repV = Math.max(0.05, (vFt / 2) * scale)
    tex.repeat.set(repU, repV)
    tex.needsUpdate = true
  }, [tex, uFt, vFt, scale])
  return (
    <meshStandardMaterial
      wireframe={wireframe}
      map={tex || null}
      roughness={0.8}
      color={selected ? '#d0e8ff' : '#ffffff'}
    />
  )
}

/** Imported asset texture applied to a shape. */
function ImportedShapeTexture({ assetId, uFt, vFt, scale = 1, selected }: {
  assetId: string; uFt: number; vFt: number; scale?: number; selected: boolean
}) {
  const asset = useGarageStore(s => s.importedAssets.find(a => a.id === assetId))
  if (!asset) return <meshLambertMaterial color="#e0dedd" />
  return <ImportedTextureMaterial
    dataUrl={asset.data}
    normalUrl={asset.normalMap} roughnessUrl={asset.roughnessMap}
    metalnessUrl={asset.metalnessMap} aoUrl={asset.aoMap}
    widthFt={uFt * scale} heightFt={vFt * scale} selected={selected}
  />
}

/** Imported floor material — loads sidecar PBR maps (normal/roughness/metal/AO)
 *  only when the asset actually has them, avoiding unconditional useTexture
 *  hooks on data URLs that don't exist. Sub-component boundary keeps the
 *  Suspense fallout local to the floor mesh, not the whole scene. */
function ImportedFloorMaterial({ asset, colorTex, floorTextureScale, maxAnisotropy, effectiveQuality, floorReflection }: {
  asset: { data: string; normalMap?: string; roughnessMap?: string; metalnessMap?: string; aoMap?: string }
  colorTex: THREE.Texture
  floorTextureScale: number
  maxAnisotropy: number
  effectiveQuality: 'low' | 'medium' | 'high'
  floorReflection: number
}) {
  // useTexture must run unconditionally. Use a 1x1 transparent PNG as a
  // fallback for any missing map so hook shape stays stable, then gate the
  // resulting texture on whether the asset actually has that map.
  const EMPTY_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const normalSrcRaw    = useTexture(asset.normalMap    || EMPTY_PIXEL)
  const roughnessSrcRaw = useTexture(asset.roughnessMap || EMPTY_PIXEL)
  const metalnessSrcRaw = useTexture(asset.metalnessMap || EMPTY_PIXEL)
  const aoSrcRaw        = useTexture(asset.aoMap        || EMPTY_PIXEL)
  const normalSrc    = asset.normalMap    ? normalSrcRaw    : undefined
  const roughnessSrc = asset.roughnessMap ? roughnessSrcRaw : undefined
  const aoSrc        = asset.aoMap        ? aoSrcRaw        : undefined
  void metalnessSrcRaw  // metalness map intentionally ignored; reflections come from MeshReflectorMaterial

  const normal    = useClonedTexture(normalSrc)
  const roughness = useClonedTexture(roughnessSrc)
  const ao        = useClonedTexture(aoSrc)

  useMemo(() => {
    const ftPerRepeat = Math.max(0.25, floorTextureScale / 2)
    const rep = 1 / ftPerRepeat
    for (const t of [normal, roughness, ao]) {
      if (!t) continue
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.colorSpace = THREE.NoColorSpace
      t.anisotropy = maxAnisotropy
      t.minFilter = THREE.LinearMipmapLinearFilter
      t.magFilter = THREE.LinearFilter
      t.generateMipmaps = true
      t.repeat.set(rep, rep)
      t.needsUpdate = true
    }
  }, [normal, roughness, ao, floorTextureScale, maxAnisotropy])

  // Low quality: plain PBR, no live reflections.
  if (effectiveQuality === 'low') {
    return (
      <meshStandardMaterial
        side={THREE.DoubleSide}
        map={colorTex}
        normalMap={normal || null}
        roughnessMap={roughness || null}
        aoMap={ao || null}
        roughness={roughness ? 1.0 : 0.55}
        metalness={0.0}
        envMapIntensity={0}
        color='#ffffff'
      />
    )
  }
  // Medium/high: route through MeshReflectorMaterial so imported PBR floors
  // get true live reflections (like the catalog marble). We intentionally
  // drop metalnessMap, normalMap, AND roughnessMap so the only reflection is
  // the real planar one — no per-pixel highlights/streaks from the texture's
  // baked-in ridges or polished/matte variation.
  return (
    <MeshReflectorMaterial
      side={THREE.DoubleSide}
      map={colorTex}
      aoMap={ao || null}
      color='#ffffff'
      roughness={0.55}
      metalness={0.0}
      blur={effectiveQuality === 'high' ? [400, 200] : [200, 100]}
      resolution={effectiveQuality === 'high' ? 2048 : 512}
      mixBlur={0.5}
      mixStrength={floorReflection * 2.5}
      mixContrast={1.0}
      depthScale={0.8}
      minDepthThreshold={0.6}
      maxDepthThreshold={1.0}
      mirror={1}
      envMapIntensity={0}
    />
  )
}

/** Material for an imported texture (data URL) applied to a wall or floor */
function ImportedTextureMaterial({
  dataUrl, widthFt, heightFt, selected,
  normalUrl, roughnessUrl, metalnessUrl, aoUrl,
}: {
  dataUrl: string; widthFt: number; heightFt: number; selected: boolean
  normalUrl?: string; roughnessUrl?: string; metalnessUrl?: string; aoUrl?: string
}) {
  // Load color + sidecar PBR maps (normal/rough/metal/AO). useTexture must run
  // unconditionally so we supply a 1x1 transparent PNG for missing maps, then
  // gate the resulting texture on whether the asset actually has that map.
  const EMPTY_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const colorTex     = useTexture(dataUrl)
  const normalRaw    = useTexture(normalUrl    || EMPTY_PIXEL)
  const roughnessRaw = useTexture(roughnessUrl || EMPTY_PIXEL)
  const metalnessRaw = useTexture(metalnessUrl || EMPTY_PIXEL)
  const aoRaw        = useTexture(aoUrl        || EMPTY_PIXEL)

  const color     = useClonedTexture(colorTex)
  const normal    = useClonedTexture(normalUrl    ? normalRaw    : undefined)
  const roughness = useClonedTexture(roughnessUrl ? roughnessRaw : undefined)
  const metalness = useClonedTexture(metalnessUrl ? metalnessRaw : undefined)
  const ao        = useClonedTexture(aoUrl        ? aoRaw        : undefined)

  useMemo(() => {
    const ftPerRepeat = 4
    const repX = widthFt / ftPerRepeat
    const repY = heightFt / ftPerRepeat
    if (color) {
      color.wrapS = color.wrapT = THREE.RepeatWrapping
      color.repeat.set(repX, repY)
      color.colorSpace = THREE.SRGBColorSpace
      color.needsUpdate = true
    }
    for (const t of [normal, roughness, metalness, ao]) {
      if (!t) continue
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.colorSpace = THREE.NoColorSpace
      t.repeat.set(repX, repY)
      t.needsUpdate = true
    }
  }, [color, normal, roughness, metalness, ao, widthFt, heightFt])

  return (
    <meshStandardMaterial
      map={color || null}
      normalMap={normal || null}
      roughnessMap={roughness || null}
      metalnessMap={metalness || null}
      aoMap={ao || null}
      roughness={roughness ? 1.0 : 0.7}
      metalness={metalness ? 1.0 : 0.0}
      color={selected ? '#d0e8ff' : '#ffffff'}
    />
  )
}

// ─── Textured door material ──────────────────────────────────────────────────
function TexturedDoorMaterial({ textureId, widthFt, heightFt }: {
  textureId: string; widthFt: number; heightFt: number
}) {
  const entry = getTextureById(textureId)
  if (!entry) return <meshLambertMaterial color="#b8b4a8" />
  const basePath = `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.file)}`
  const normalPath = entry.normalFile
    ? `${import.meta.env.BASE_URL}${texturePath(entry.category, entry.normalFile)}`
    : undefined

  const paths = [basePath, normalPath].filter(Boolean) as string[]
  const textures = useTexture(paths)
  const srcDiffuse = Array.isArray(textures) ? textures[0] : textures
  const srcNormal = Array.isArray(textures) && normalPath ? textures[1] : undefined

  // Clone so we don't mutate the shared cached texture
  const diffuse = useClonedTexture(srcDiffuse)
  const normal = useClonedTexture(srcNormal)

  useMemo(() => {
    [diffuse, normal].forEach(t => {
      if (!t) return
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping
      t.repeat.set(1, 1)
    })
  }, [diffuse, normal, widthFt, heightFt])

  return (
    <meshStandardMaterial
      map={diffuse}
      normalMap={normal || undefined}
      roughness={0.6}
    />
  )
}

// ─── GLB model for door/window openings ──────────────────────────────────────
// Kenney models have width along Z, height along Y, thickness along X.
// We rotate the group 90° on Y so model Z (width) → wall X (along wall).
// Position offsets are in group-local space (BEFORE rotation), so they use
// model-native axes: X = thickness, Y = height, Z = width.
// ── Procedural "Custom Plain" door ───────────────────────────────────────────
// Flush slab + U-jamb + mirrored casing on both wall faces + satin nickel lever
// and 3 hinges. All trim dimensions are absolute (inches) so they don't stretch
// with the opening; only the slab and jamb frame scale to match op.width/height.
const PDOOR = {
  JAMB_T: 0.75,
  CASING_W: 2.5,
  CASING_T: 0.5,
  SLAB_T: 1.75,
  SIDE_GAP: 0.125,
  BOTTOM_GAP: 0.75,
  KNOB_FROM_FLOOR: 36,
  KNOB_FROM_SLAB_EDGE: 2.75,
  HINGE_FROM_TOP: 7,
  HINGE_FROM_BOTTOM: 11,
  HINGE_LEAF: 3.5,
} as const

function ProceduralPlainDoor({ widthIn, heightIn, wallThickIn, doorColor, frameColor, wireframe }: {
  widthIn: number; heightIn: number; yOffsetIn: number; wallThickIn: number
  doorColor: string; frameColor: string; wireframe: boolean
}) {
  const W = FT(widthIn), H = FT(heightIn)
  const wallT = FT(wallThickIn)
  const jambT  = FT(PDOOR.JAMB_T)
  const casW   = FT(PDOOR.CASING_W)
  const casT   = FT(PDOOR.CASING_T)
  const slabT  = FT(PDOOR.SLAB_T)
  const sideGap = FT(PDOOR.SIDE_GAP)
  const botGap  = FT(PDOOR.BOTTOM_GAP)

  // Slab fits inside jamb with gaps. Bottom gap lifts slab off floor.
  const slabW = W - 2 * jambT - 2 * sideGap
  const slabTop = H / 2 - jambT - sideGap
  const slabBot = -H / 2 + botGap
  const slabH = slabTop - slabBot
  const slabYc = (slabTop + slabBot) / 2

  // Knob sits 36" up from the door's own base, so it moves with the door
  // when repositioned vertically.
  const handleY = FT(PDOOR.KNOB_FROM_FLOOR) - H / 2
  const handleSide = 1 // +x = handle side, -x = hinge side
  const handleX = handleSide * (slabW / 2 - FT(PDOOR.KNOB_FROM_SLAB_EDGE))

  // Hinge sits in the 1/8" gap between slab and jamb on the hinge-side edge.
  const hingeEdgeX = -handleSide * (slabW / 2 + sideGap / 2)
  const hingeTopY = slabTop - FT(PDOOR.HINGE_FROM_TOP)
  const hingeBotY = slabBot + FT(PDOOR.HINGE_FROM_BOTTOM)
  const hingeMidY = (hingeTopY + hingeBotY) / 2

  const frameMat = (
    wireframe
      ? <meshBasicMaterial color="#4ab4ff" wireframe />
      : <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0} />
  )
  const slabMat = (
    wireframe
      ? <meshBasicMaterial color="#4ab4ff" wireframe />
      : <meshStandardMaterial color={doorColor} roughness={0.55} metalness={0} />
  )
  const metalMat = (
    wireframe
      ? <meshBasicMaterial color="#ffcc00" wireframe />
      : <meshStandardMaterial color="#B8B8B0" roughness={0.35} metalness={1} />
  )

  return (
    <group>
      {/* ── Jamb (inside the wall thickness) ── */}
      {/* Left jamb */}
      <mesh position={[-(W / 2 - jambT / 2), 0, 0]}>
        <boxGeometry args={[jambT, H, wallT]} />
        {frameMat}
      </mesh>
      {/* Right jamb */}
      <mesh position={[W / 2 - jambT / 2, 0, 0]}>
        <boxGeometry args={[jambT, H, wallT]} />
        {frameMat}
      </mesh>
      {/* Head jamb */}
      <mesh position={[0, H / 2 - jambT / 2, 0]}>
        <boxGeometry args={[W - 2 * jambT, jambT, wallT]} />
        {frameMat}
      </mesh>

      {/* ── Casing (mirrored on both wall faces) ── */}
      {[1, -1].map(sign => (
        <group key={`cas-${sign}`} position={[0, 0, sign * (wallT / 2 + casT / 2)]}>
          {/* Top casing */}
          <mesh position={[0, H / 2 + casW / 2, 0]}>
            <boxGeometry args={[W + 2 * casW, casW, casT]} />
            {frameMat}
          </mesh>
          {/* Left casing */}
          <mesh position={[-(W / 2 + casW / 2), 0, 0]}>
            <boxGeometry args={[casW, H, casT]} />
            {frameMat}
          </mesh>
          {/* Right casing */}
          <mesh position={[W / 2 + casW / 2, 0, 0]}>
            <boxGeometry args={[casW, H, casT]} />
            {frameMat}
          </mesh>
        </group>
      ))}

      {/* ── Sill: frame-colored floor plate spanning the opening between the
           jambs, filling the cut-out under the slab so the floor texture
           doesn't show through. Extends the full wall thickness. ── */}
      <mesh position={[0, -H / 2 + FT(0.5) / 2, 0]}>
        <boxGeometry args={[W - 2 * jambT, FT(0.5), wallT]} />
        {frameMat}
      </mesh>

      {/* ── Slab (flush / solid) ── */}
      <mesh position={[0, slabYc, 0]}>
        <boxGeometry args={[slabW, slabH, slabT]} />
        {slabMat}
      </mesh>

      {/* ── Hardware: lever handle on both faces ── */}
      {[1, -1].map(sign => (
        <group key={`hw-${sign}`} position={[handleX, handleY, sign * (slabT / 2 + FT(0.1))]}>
          {/* Rose (backing plate) */}
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[FT(1.3), FT(1.3), FT(0.25), 24]} />
            {metalMat}
          </mesh>
          {/* Lever arm — extends inward toward hinge side */}
          <mesh position={[-handleSide * FT(2.0), 0, FT(0.25)]}>
            <boxGeometry args={[FT(4.0), FT(0.6), FT(0.5)]} />
            {metalMat}
          </mesh>
        </group>
      ))}

      {/* ── Hinges: thin strips in the gap between slab and jamb ── */}
      {[hingeTopY, hingeMidY, hingeBotY].map((hy, i) => (
        <mesh key={`hinge-${i}`} position={[hingeEdgeX, hy, 0]}>
          <boxGeometry args={[sideGap, FT(PDOOR.HINGE_LEAF), slabT]} />
          {metalMat}
        </mesh>
      ))}
    </group>
  )
}

/** Procedural double-door closet — same trim/jamb/casing style as the plain
 *  door, but two slabs meeting at the center, each with its own handle and
 *  hinges. Size-adjustable like other procedural doors. */
function ProceduralClosetDouble({ widthIn, heightIn, wallThickIn, doorColor, frameColor, wireframe }: {
  widthIn: number; heightIn: number; yOffsetIn: number; wallThickIn: number
  doorColor: string; frameColor: string; wireframe: boolean
}) {
  const W = FT(widthIn), H = FT(heightIn)
  const wallT = FT(wallThickIn)
  const jambT  = FT(PDOOR.JAMB_T)
  const casW   = FT(PDOOR.CASING_W)
  const casT   = FT(PDOOR.CASING_T)
  const slabT  = FT(PDOOR.SLAB_T)
  const sideGap = FT(PDOOR.SIDE_GAP)
  const botGap  = FT(PDOOR.BOTTOM_GAP)
  const centerGap = FT(0.1875) // 3/16" between the two slabs

  // Vertical extent identical to plain door.
  const slabTop = H / 2 - jambT - sideGap
  const slabBot = -H / 2 + botGap
  const slabH = slabTop - slabBot
  const slabYc = (slabTop + slabBot) / 2

  // Each slab is half of the usable opening width (less the side gaps and
  // the center gap between the two slabs).
  const innerW = W - 2 * jambT - 2 * sideGap - centerGap
  const slabW = innerW / 2
  // Slab centers: left sits in (-, 0), right sits in (+, 0).
  const leftXc  = -(centerGap / 2 + slabW / 2)
  const rightXc = +(centerGap / 2 + slabW / 2)

  // Knob sits 36" up from the door's own base so it moves with the door
  // when repositioned vertically.
  const handleY = FT(PDOOR.KNOB_FROM_FLOOR) - H / 2

  // Hinges live in the side gap against each outer jamb.
  const leftHingeX  = -(W / 2 - jambT - sideGap / 2)
  const rightHingeX =  (W / 2 - jambT - sideGap / 2)
  const hingeTopY = slabTop - FT(PDOOR.HINGE_FROM_TOP)
  const hingeBotY = slabBot + FT(PDOOR.HINGE_FROM_BOTTOM)
  const hingeMidY = (hingeTopY + hingeBotY) / 2

  const frameMat = (
    wireframe
      ? <meshBasicMaterial color="#4ab4ff" wireframe />
      : <meshStandardMaterial color={frameColor} roughness={0.7} metalness={0} />
  )
  const slabMat = (
    wireframe
      ? <meshBasicMaterial color="#4ab4ff" wireframe />
      : <meshStandardMaterial color={doorColor} roughness={0.55} metalness={0} />
  )
  const metalMat = (
    wireframe
      ? <meshBasicMaterial color="#ffcc00" wireframe />
      : <meshStandardMaterial color="#B8B8B0" roughness={0.35} metalness={1} />
  )

  // Handles point INWARD (toward the center gap) on each slab — typical
  // closet pull location. Handle X is an absolute position (not relative).
  const leftHandleX  = -centerGap / 2 - FT(PDOOR.KNOB_FROM_SLAB_EDGE)
  const rightHandleX =  centerGap / 2 + FT(PDOOR.KNOB_FROM_SLAB_EDGE)

  return (
    <group>
      {/* Jamb (inside the wall thickness) */}
      <mesh position={[-(W / 2 - jambT / 2), 0, 0]}>
        <boxGeometry args={[jambT, H, wallT]} />
        {frameMat}
      </mesh>
      <mesh position={[W / 2 - jambT / 2, 0, 0]}>
        <boxGeometry args={[jambT, H, wallT]} />
        {frameMat}
      </mesh>
      <mesh position={[0, H / 2 - jambT / 2, 0]}>
        <boxGeometry args={[W - 2 * jambT, jambT, wallT]} />
        {frameMat}
      </mesh>

      {/* Casing on both wall faces */}
      {[1, -1].map(sign => (
        <group key={`cas-${sign}`} position={[0, 0, sign * (wallT / 2 + casT / 2)]}>
          <mesh position={[0, H / 2 + casW / 2, 0]}>
            <boxGeometry args={[W + 2 * casW, casW, casT]} />
            {frameMat}
          </mesh>
          <mesh position={[-(W / 2 + casW / 2), 0, 0]}>
            <boxGeometry args={[casW, H, casT]} />
            {frameMat}
          </mesh>
          <mesh position={[W / 2 + casW / 2, 0, 0]}>
            <boxGeometry args={[casW, H, casT]} />
            {frameMat}
          </mesh>
        </group>
      ))}

      {/* Sill / floor plate under the opening */}
      <mesh position={[0, -H / 2 + FT(0.5) / 2, 0]}>
        <boxGeometry args={[W - 2 * jambT, FT(0.5), wallT]} />
        {frameMat}
      </mesh>

      {/* Two slabs meeting at the center */}
      <mesh position={[leftXc, slabYc, 0]}>
        <boxGeometry args={[slabW, slabH, slabT]} />
        {slabMat}
      </mesh>
      <mesh position={[rightXc, slabYc, 0]}>
        <boxGeometry args={[slabW, slabH, slabT]} />
        {slabMat}
      </mesh>

      {/* Two handles at the center — pulls on the inner edge of each slab */}
      {[1, -1].map(sign => (
        <group key={`hw-L-${sign}`} position={[leftHandleX, handleY, sign * (slabT / 2 + FT(0.1))]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[FT(1.1), FT(1.1), FT(0.2), 20]} />
            {metalMat}
          </mesh>
        </group>
      ))}
      {[1, -1].map(sign => (
        <group key={`hw-R-${sign}`} position={[rightHandleX, handleY, sign * (slabT / 2 + FT(0.1))]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[FT(1.1), FT(1.1), FT(0.2), 20]} />
            {metalMat}
          </mesh>
        </group>
      ))}

      {/* Hinges on each outer jamb */}
      {[hingeTopY, hingeMidY, hingeBotY].map((hy, i) => (
        <mesh key={`hingeL-${i}`} position={[leftHingeX, hy, 0]}>
          <boxGeometry args={[sideGap, FT(PDOOR.HINGE_LEAF), slabT]} />
          {metalMat}
        </mesh>
      ))}
      {[hingeTopY, hingeMidY, hingeBotY].map((hy, i) => (
        <mesh key={`hingeR-${i}`} position={[rightHingeX, hy, 0]}>
          <boxGeometry args={[sideGap, FT(PDOOR.HINGE_LEAF), slabT]} />
          {metalMat}
        </mesh>
      ))}
    </group>
  )
}

function OpeningGLBModel({ modelId, widthIn, heightIn }: {
  modelId: string; widthIn: number; heightIn: number
}) {
  const entry = getOpeningModelById(modelId)
  if (!entry) return null
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}assets/models/${entry.file}`)

  const tw = FT(widthIn), th = FT(heightIn)

  const { s, ox, oy, oz } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    if (size.lengthSq() < 0.0001) return { s: 1, ox: 0, oy: 0, oz: 0 }

    // model Z = door/window width, model Y = height
    const modelWidth  = size.z
    const modelHeight = size.y

    // Scale to match opening dimensions (width & height only, depth stays natural)
    const scale = Math.min(tw / modelWidth, th / modelHeight)

    // Offsets in group-local (model) axes to center the model at origin:
    return {
      s: scale,
      ox: -center.x * scale,               // center thickness (model X) at group-local 0
      oy: -box.min.y * scale - th / 2,     // bottom of model at opening bottom
      oz: -center.z * scale,               // center width (model Z) at group-local 0
    }
  }, [scene, tw, th])

  const cloned = useMemo(() => scene.clone(true), [scene])
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <primitive object={cloned} scale={s} position={[ox, oy, oz]} />
    </group>
  )
}
function computeMiteredOutlines(walls: GarageWall[]): Map<string, {
  p0x: number; p0z: number; p1x: number; p1z: number   // +side start/end
  n0x: number; n0z: number; n1x: number; n1z: number   // −side start/end
}> {
  const result = new Map<string, { p0x: number; p0z: number; p1x: number; p1z: number; n0x: number; n0z: number; n1x: number; n1z: number }>()
  const chains = findWallChains(walls)

  for (const chain of chains) {
    const N = chain.length
    if (N === 0) continue
    const isClosed = N > 1 && Math.hypot(
      chain[N - 1].x2 - chain[0].x1, chain[N - 1].z2 - chain[0].z1) < 6

    const wd = chain.map(e => {
      const dx = e.x2 - e.x1, dz = e.z2 - e.z1
      const len = Math.hypot(dx, dz)
      const ux = len > 0 ? dx / len : 1, uz = len > 0 ? dz / len : 0
      const nx = -uz, nz = ux
      const hT = e.wall.thickness / 2
      return { ux, uz, len, psx: e.x1 + nx * hT, psz: e.z1 + nz * hT, nsx: e.x1 - nx * hT, nsz: e.z1 - nz * hT }
    })

    const pPts: { x: number; z: number }[] = new Array(N + 1)
    const nPts: { x: number; z: number }[] = new Array(N + 1)

    for (let i = 0; i <= N; i++) {
      if ((i === 0 && !isClosed) || (i === N && !isClosed)) {
        const w = wd[i === 0 ? 0 : N - 1]
        if (i === 0) {
          pPts[0] = { x: w.psx, z: w.psz }
          nPts[0] = { x: w.nsx, z: w.nsz }
        } else {
          pPts[N] = { x: w.psx + w.len * w.ux, z: w.psz + w.len * w.uz }
          nPts[N] = { x: w.nsx + w.len * w.ux, z: w.nsz + w.len * w.uz }
        }
        continue
      }
      const pi = (i === 0) ? N - 1 : i - 1
      const ci = i % N
      const prev = wd[pi], curr = wd[ci]
      const tP = lineIntersectT(prev.psx, prev.psz, prev.ux, prev.uz, curr.psx, curr.psz, curr.ux, curr.uz)
      pPts[i] = isNaN(tP) ? { x: curr.psx, z: curr.psz } : { x: prev.psx + tP * prev.ux, z: prev.psz + tP * prev.uz }
      const tN = lineIntersectT(prev.nsx, prev.nsz, prev.ux, prev.uz, curr.nsx, curr.nsz, curr.ux, curr.uz)
      nPts[i] = isNaN(tN) ? { x: curr.nsx, z: curr.nsz } : { x: prev.nsx + tN * prev.ux, z: prev.nsz + tN * prev.uz }
    }
    if (isClosed) { pPts[N] = pPts[0]; nPts[N] = nPts[0] }

    for (let i = 0; i < N; i++) {
      const w = wd[i]
      const hT = chain[i].wall.thickness / 2
      // Perpendicular (un-mitered) face endpoints for this wall
      const perpP0 = { x: w.psx, z: w.psz }
      const perpP1 = { x: w.psx + w.len * w.ux, z: w.psz + w.len * w.uz }
      const perpN0 = { x: w.nsx, z: w.nsz }
      const perpN1 = { x: w.nsx + w.len * w.ux, z: w.nsz + w.len * w.uz }

      // For each mitered point, only use it if it EXTENDS past the perpendicular
      // endpoint (along the wall direction). If it retracts, clamp to perpendicular.
      const extendOnly = (miter: {x:number,z:number}, perp: {x:number,z:number}, epx: number, epz: number, sign: number) => {
        const miterAlong = ((miter.x - epx) * w.ux + (miter.z - epz) * w.uz) * sign
        return miterAlong > 0.1 ? miter : perp
      }

      const p0 = extendOnly(pPts[i], perpP0, chain[i].x1, chain[i].z1, -1)
      const n0 = extendOnly(nPts[i], perpN0, chain[i].x1, chain[i].z1, -1)
      const p1 = extendOnly(pPts[i+1], perpP1, chain[i].x2, chain[i].z2, 1)
      const n1 = extendOnly(nPts[i+1], perpN1, chain[i].x2, chain[i].z2, 1)

      result.set(chain[i].wall.id, {
        p0x: p0.x, p0z: p0.z, p1x: p1.x, p1z: p1.z,
        n0x: n0.x, n0z: n0.z, n1x: n1.x, n1z: n1.z,
      })
    }
  }
  return result
}

// ─── Individual wall mesh ─────────────────────────────────────────────────────
const WallMesh = memo(function WallMesh({ wall, wireframe, blueprint, selected, onClick, onPointerDown, onOpeningPointerDown, startTrim, endTrim, outline, baseTex, interiorNormal }: {
  wall: GarageWall; wireframe: boolean; blueprint?: boolean; selected: boolean; onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  /** Called when a door/window mesh on this wall is pressed — starts opening drag. */
  onOpeningPointerDown?: (openingId: string, e: ThreeEvent<PointerEvent>) => void
  startTrim: number; endTrim: number
  outline: { p0x: number; p0z: number; p1x: number; p1z: number; n0x: number; n0z: number; n1x: number; n1z: number } | null
  baseTex: THREE.Texture | null
  /** Unit normal pointing INTO the garage (resolved via floor polygon) */
  interiorNormal: { nx: number; nz: number }
}) {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const lengthIn = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
  const thickFt = FT(wall.thickness)
  const rotY    = -Math.atan2(dz, dx)
  const midX    = FT((wall.x1 + wall.x2) / 2)
  const midZ    = FT((wall.z1 + wall.z2) / 2)

  const isImportedWallTex = wall.wallTextureId?.startsWith('imported:') ?? false
  const hasWallTexture = !blueprint && !wireframe && !!wall.wallTextureId && (isImportedWallTex || !!getTextureById(wall.wallTextureId!))
  const color = blueprint ? (selected ? '#555555' : '#333333') : wireframe ? (selected ? '#ffcc00' : '#4ab4ff') : selected ? '#d0e8ff' : (wall.wallColor ?? '#e0dedd')

  // Build segments around openings
  const segs = useMemo(() => {
    return buildWallSegments(wall, lengthIn)
  }, [wall, lengthIn])
  const hFt         = FT(wall.height)

  // Render 3D meshes for 'door' and 'window' openings. Doors without a GLB
  // model are rendered as a pure cut-out (no door panel) so you can see
  // through them like the garage door — a floor threshold is drawn below
  // the opening via <GarageDoorThreshold> elsewhere in the render tree.
  const openingMeshes = wall.openings?.filter(op => op.type === 'door' || op.type === 'window').map((op, i) => {
    const opW = FT(op.width)
    const opH = FT(op.height)
    const opT = FT(2)
    const opD = thickFt + FT(2)
    const along = op.xOffset + op.width / 2 - lengthIn / 2
    const y = op.yOffset + op.height / 2

    const onOpDown = onOpeningPointerDown
      ? (e: ThreeEvent<PointerEvent>) => onOpeningPointerDown(op.id, e)
      : undefined

    // Use model (GLB or procedural) if selected
    if (op.modelId) {
      const entry = getOpeningModelById(op.modelId)
      if (entry?.kind === 'procedural' && op.type === 'door') {
        const DoorComp = op.modelId === 'custom-double' ? ProceduralClosetDouble : ProceduralPlainDoor
        return (
          <group key={op.id || i} position={[FT(along), FT(y), 0]} onPointerDown={onOpDown}>
            <DoorComp
              widthIn={op.width}
              heightIn={op.height}
              yOffsetIn={op.yOffset}
              wallThickIn={wall.thickness}
              doorColor={op.doorColor ?? '#e0dedd'}
              frameColor={op.frameColor ?? '#f0ede4'}
              wireframe={wireframe}
            />
          </group>
        )
      }
      if (entry) {
        return (
          <group key={op.id || i} position={[FT(along), FT(y), 0]} onPointerDown={onOpDown}>
            <OpeningGLBModel modelId={op.modelId} widthIn={op.width} heightIn={op.height} />
          </group>
        )
      }
    }

    // Doors with no model: still render an invisible hit mesh filling the
    // cut-out so the user can click/drag the opening in 3D. Without this
    // the opening is a pure hole and gets no pointer events.
    if (op.type === 'door') {
      return (
        <group key={op.id || i} position={[FT(along), FT(y), 0]} onPointerDown={onOpDown}>
          <mesh>
            <boxGeometry args={[opW, opH, thickFt]} />
            <meshBasicMaterial transparent opacity={0} />
          </mesh>
        </group>
      )
    }

    // Windows: translucent pane + frame, centered in the wall thickness so
    // the frame sits flush on both the interior and exterior faces.
    const defaultColor = '#87CEEB'
    return (
      <group key={op.id || i} onPointerDown={onOpDown}>
        <mesh position={[FT(along), FT(y), 0]}>
          <boxGeometry args={[opW, opH, opT]} />
          {!wireframe && op.textureId && getTextureById(op.textureId)
            ? <TexturedDoorMaterial textureId={op.textureId} widthFt={opW} heightFt={opH} />
            : <meshLambertMaterial color={wireframe ? '#ffcc00' : defaultColor}
                transparent={true} opacity={0.4} />
          }
        </mesh>
        {/* Window frame — depth matches wall so it's flush on both faces */}
        {op.type === 'window' && !wireframe && (
          <group position={[FT(along), FT(y), 0]}>
            {/* Top bar */}
            <mesh position={[0, opH / 2 - FT(1), 0]}>
              <boxGeometry args={[opW, FT(2), thickFt]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
            {/* Bottom bar */}
            <mesh position={[0, -opH / 2 + FT(1), 0]}>
              <boxGeometry args={[opW, FT(2), thickFt]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
            {/* Left bar */}
            <mesh position={[-opW / 2 + FT(1), 0, 0]}>
              <boxGeometry args={[FT(2), opH, thickFt]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
            {/* Right bar */}
            <mesh position={[opW / 2 - FT(1), 0, 0]}>
              <boxGeometry args={[FT(2), opH, thickFt]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
          </group>
        )}
      </group>
    )
  }) || [];

  // Build per-segment mitered extrusions. Each segment uses the mitered outline
  // points interpolated to its local X range, so corners are clean and openings
  // are preserved (each segment is its own extruded shape).
  const segGeos = useMemo(() => {
    if (!outline) return null
    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 1) return null
    const ux = dx / len, uz = dz / len
    const nx = -uz, nz = ux
    const hT = wall.thickness / 2

    // Compute face points for a segment by position along the wall.
    // Only the wall's very start (x0=0) and very end (x1=lengthIn) use mitered
    // points; all other edges use the standard perpendicular face.
    const faceAt = (along: number, side: 'p' | 'n') => {
      const hT = wall.thickness / 2
      const sn = side === 'p' ? 1 : -1
      // Standard perpendicular point at this along-wall position
      const std = {
        x: wall.x1 + ux * along + nx * hT * sn,
        z: wall.z1 + uz * along + nz * hT * sn,
      }
      // Use mitered point only at the very start/end of the wall
      if (along <= 0.01) {
        return side === 'p'
          ? { x: outline.p0x, z: outline.p0z }
          : { x: outline.n0x, z: outline.n0z }
      }
      if (along >= lengthIn - 0.01) {
        return side === 'p'
          ? { x: outline.p1x, z: outline.p1z }
          : { x: outline.n1x, z: outline.n1z }
      }
      return std
    }

    return segs.map(seg => {
      const p0 = faceAt(seg.x0, 'p'), p1 = faceAt(seg.x1, 'p')
      const n0 = faceAt(seg.x0, 'n'), n1 = faceAt(seg.x1, 'n')
      const segH = FT(seg.y1 - seg.y0)
      const segY = FT(seg.y0)
      const segWFt = FT(seg.x1 - seg.x0)
      const segHFt = segH

      // Shape is in XY plane, extruded along +Z.
      // After rotateX(-PI/2): shapeY becomes -worldZ.
      // So negate Z in the shape coordinates.
      const shape = new THREE.Shape()
      shape.moveTo(FT(p0.x), -FT(p0.z))
      shape.lineTo(FT(p1.x), -FT(p1.z))
      shape.lineTo(FT(n1.x), -FT(n1.z))
      shape.lineTo(FT(n0.x), -FT(n0.z))
      shape.closePath()

      const geo = new THREE.ExtrudeGeometry(shape, { depth: segH, bevelEnabled: false })

      // Rewrite UVs BEFORE rotation. Map UVs so U = along-wall fraction (0..1
      // across segment width), V = height fraction (0..1 across segment height).
      // The material multiplies by widthFt/heightFt in `texture.repeat` to get
      // ftPerRepeat tiling — same scaling the box fallback relied on.
      const pos = geo.attributes.position as THREE.BufferAttribute
      const uvs = new Float32Array(pos.count * 2)
      const aux = wall.x2 - wall.x1, auz = wall.z2 - wall.z1
      const alen = Math.hypot(aux, auz) || 1
      const uxn = aux / alen, uzn = auz / alen
      const startXIn = wall.x1 + uxn * seg.x0
      const segLenIn = seg.x1 - seg.x0
      const segHIn = seg.y1 - seg.y0
      for (let i = 0; i < pos.count; i++) {
        // Pre-rotation: shape.x = FT(worldX_in), shape.y = -FT(worldZ_in), z = heightFt
        const sx = pos.getX(i), sy = pos.getY(i), sz = pos.getZ(i)
        const worldXIn = sx / FT(1)
        const worldZIn = -sy / FT(1)
        const alongIn = (worldXIn - startXIn) * uxn + (worldZIn - (wall.z1 + uzn * seg.x0)) * uzn
        const heightIn = sz / FT(1)
        uvs[i * 2]     = segLenIn > 0 ? alongIn / segLenIn : 0
        uvs[i * 2 + 1] = segHIn > 0 ? heightIn / segHIn : 0
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))
      geo.rotateX(-Math.PI / 2)
      geo.translate(0, segY, 0)

      return { geo, segWFt, segHFt }
    })
  }, [outline, blueprint, segs, lengthIn, wall.x1, wall.z1, wall.x2, wall.z2, wall.thickness])

  return (
    <>
    {/* Mitered segment bodies — world-space extruded shapes (no transform group) */}
    {segGeos && segGeos.map(({ geo, segWFt, segHFt }, i) => (
      <mesh key={`ms-${i}`} geometry={geo} receiveShadow
        onClick={(e) => { e.stopPropagation(); onClick() }}
        onPointerDown={onPointerDown}
      >
        {blueprint
          ? <meshBasicMaterial color={color} />
          : wireframe
            ? <>
                {/* Transparent fill so the shape still occludes correctly,
                    with crisp hard edges for the actual geometry. */}
                <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                <Edges threshold={15} color={color} />
              </>
            : hasWallTexture
              ? <Suspense fallback={<meshLambertMaterial color={color} />}>
                  {isImportedWallTex
                    ? <ImportedWallTexture assetId={wall.wallTextureId!.replace('imported:', '')} widthFt={segWFt} heightFt={segHFt} selected={selected} />
                    : <TexturedWallMaterial textureId={wall.wallTextureId!} widthFt={segWFt} heightFt={segHFt} selected={selected} />}
                </Suspense>
              : <meshLambertMaterial color={color} />
        }
      </mesh>
    ))}
    <group position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
      {/* Fallback box segments when no mitered outline */}
      {!segGeos && segs.map((seg, i) => {
        const segW   = FT(seg.x1 - seg.x0)
        const segH   = FT(seg.y1 - seg.y0)
        const localX = FT(-lengthIn / 2 + seg.x0 + (seg.x1 - seg.x0) / 2)
        const localY = FT((seg.y0 + seg.y1) / 2)
        return (
          <mesh key={i} position={[localX, localY, 0]}
            receiveShadow
            onClick={(e) => { e.stopPropagation(); onClick() }}
            onPointerDown={onPointerDown}
          >
            <boxGeometry args={[segW, segH, thickFt]} />
            {wireframe
              ? <>
                  <meshBasicMaterial color="#ffffff" transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
                  <Edges threshold={15} color={color} />
                </>
              : hasWallTexture ? (
                <Suspense fallback={<meshLambertMaterial color={color} />}>
                  {isImportedWallTex
                    ? <ImportedWallTexture assetId={wall.wallTextureId!.replace('imported:', '')} widthFt={segW} heightFt={segH} selected={selected} />
                    : <TexturedWallMaterial textureId={wall.wallTextureId!} widthFt={segW} heightFt={segH} selected={selected} />}
                </Suspense>
              ) : blueprint
                  ? <meshBasicMaterial color={color} />
                  : <meshLambertMaterial color={color} />
            }
          </mesh>
        )
      })}

      {/* Stem walls now standalone pieces (rendered globally below) */}

      {/* 3D Door & window meshes */}
      {!blueprint && openingMeshes}


      {/* Thresholds — floor-textured patch across the wall thickness. Drawn
         for garage doors AND for regular doors (cut-outs) that reach the
         floor, so the gap underneath shows floor material, not void. */}
      {baseTex && wall.openings.filter(op => {
        if (op.type === 'garage-door') return true
        if (op.type !== 'door' || op.yOffset > 0.5) return false
        // Floor-textured threshold only for bare cut-outs (flat-panel doors).
        // Procedural doors draw their own frame-colored sill inside the jamb.
        if (!op.modelId) return true
        const entry = getOpeningModelById(op.modelId)
        return !entry
      }).map(op => (
        <GarageDoorThreshold
          key={op.id}
          doorW={op.width}
          wallThickness={wall.thickness}
          localX={FT(op.xOffset + op.width / 2 - lengthIn / 2)}
          baseTex={baseTex}
          wireframe={wireframe}
        />
      ))}
    </group>

    {/* Selection face overlays — interior face = blue, exterior = green, so the
       user can tell which side of the wall they're working on. */}
    {selected && !blueprint && !wireframe && (() => {
      const lenFt = FT(lengthIn)
      const hFt = FT(wall.height)
      const halfT = thickFt / 2
      const cxFt = FT((wall.x1 + wall.x2) / 2)
      const czFt = FT((wall.z1 + wall.z2) / 2)
      const ux = (wall.x2 - wall.x1) / Math.max(0.0001, lengthIn)
      const uz = (wall.z2 - wall.z1) / Math.max(0.0001, lengthIn)
      const inX = interiorNormal.nx, inZ = interiorNormal.nz
      // Push overlays slightly past the wall face so they don't z-fight.
      const off = halfT + 0.005
      const intCenter: [number, number, number] = [cxFt + inX * off, hFt / 2, czFt + inZ * off]
      const extCenter: [number, number, number] = [cxFt - inX * off, hFt / 2, czFt - inZ * off]
      const rotInt = Math.atan2(inX, inZ)
      const rotExt = Math.atan2(-inX, -inZ)
      void ux; void uz
      return (
        <>
          <mesh position={intCenter} rotation={[0, rotInt, 0]}>
            <planeGeometry args={[lenFt, hFt]} />
            <meshBasicMaterial color="#3b82f6" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh position={extCenter} rotation={[0, rotExt, 0]}>
            <planeGeometry args={[lenFt, hFt]} />
            <meshBasicMaterial color="#22c55e" transparent opacity={0.35} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </>
      )
    })()}
    </>
  )
})

// ─── Flaked box mesh — used by baseboards & stem walls ────────────────────────
// Renders a box. When flake=true, the FRONT face (+Z local) gets a flooring
// texture sized to width × height. The texture is either loaded from a
// specific flooring catalog ID (per-piece override) or falls back to the
// current floor's texture.
function FlakedBoxMesh({ lenFt, hFt, tFt, color, wireframe, flake, floorTex, widthIn, heightIn, flakeTextureId, floorTextureScale }: {
  lenFt: number; hFt: number; tFt: number
  color: string; wireframe: boolean
  flake: boolean
  floorTex: THREE.Texture | null
  widthIn: number; heightIn: number
  flakeTextureId?: string
  floorTextureScale: number
}) {
  // Load the override texture (if a per-piece flake texture ID is set).
  // useTexture must run unconditionally so we always load *something* —
  // a 1x1 transparent PNG data URL placeholder when no override is set.
  // (Using a real flooring path as placeholder caused stale-cache bugs:
  //  switching from "match floor" → that same texture as override produced
  //  no visible change because useTexture returned the same instance.)
  const PLACEHOLDER_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  const overridePath = flakeTextureId
    ? `${import.meta.env.BASE_URL}${flooringTexturePathById(flakeTextureId)}`
    : PLACEHOLDER_1PX
  const overrideTex = useTexture(overridePath) as THREE.Texture

  // Repeats-per-foot for the texture. Same value used on every face so all 6
  // sides show the flake at identical density — UVs below span each face's
  // real-world feet, so .repeat must NOT be pre-scaled by piece size.
  const frontTex = useMemo(() => {
    if (!flake) return null
    if (!flakeTextureId) {
      if (!floorTex) return null
      const t = floorTex.clone()
      t.needsUpdate = true
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      // floorTex.repeat is already repeats-per-foot — copy as-is.
      t.repeat.set(floorTex.repeat.x, floorTex.repeat.y)
      return t
    }
    const t = overrideTex.clone()
    t.needsUpdate = true
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    const tilesPerFoot = 12 / floorTextureScale
    t.repeat.set(tilesPerFoot, tilesPerFoot)
    return t
  }, [flake, flakeTextureId, floorTex, overrideTex, floorTextureScale])

  // Build a box geometry with per-face UVs sized to each face's feet
  // dimensions. Box face order from BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
  // Face dims (width, height in feet):
  //   +X / -X (sides):      tFt × hFt
  //   +Y / -Y (top/bottom): lenFt × tFt
  //   +Z / -Z (front/back): lenFt × hFt
  const geom = useMemo(() => {
    const g = new THREE.BoxGeometry(lenFt, hFt, tFt)
    const uv = g.attributes.uv as THREE.BufferAttribute
    const setFace = (faceIdx: number, w: number, h: number) => {
      const base = faceIdx * 4
      // BoxGeometry UVs per face: (0,1), (1,1), (0,0), (1,0)
      uv.setXY(base + 0, 0, h)
      uv.setXY(base + 1, w, h)
      uv.setXY(base + 2, 0, 0)
      uv.setXY(base + 3, w, 0)
    }
    setFace(0, tFt,   hFt)   // +X
    setFace(1, tFt,   hFt)   // -X
    setFace(2, lenFt, tFt)   // +Y
    setFace(3, lenFt, tFt)   // -Y
    setFace(4, lenFt, hFt)   // +Z
    setFace(5, lenFt, hFt)   // -Z
    uv.needsUpdate = true
    return g
  }, [lenFt, hFt, tFt])
  useEffect(() => () => geom.dispose(), [geom])

  if (!flake || !frontTex) {
    return (
      <mesh castShadow receiveShadow geometry={geom}>
        <meshLambertMaterial key="plain" map={null} color={color} wireframe={wireframe} />
      </mesh>
    )
  }
  return (
    <mesh castShadow receiveShadow geometry={geom}>
      <meshLambertMaterial key="flaked" map={frontTex} color="#ffffff" />
    </mesh>
  )
}

// ─── Drag handle sphere ───────────────────────────────────────────────────────
// All drag handles share one look: a light-blue sphere matching the floor-plan
// view's blue circle handles. The `color` prop is accepted for back-compat but
// intentionally ignored so every handle in the scene renders identically.
function DragHandle({ position, size = 0.2, onPointerDown }: {
  position: [number, number, number]; color?: string; size?: number
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  return (
    <group position={position} onPointerDown={onPointerDown}
      onClick={e => { e.stopPropagation() }}>
      <mesh renderOrder={100} frustumCulled={false}>
        <sphereGeometry args={[size * 1.5, 18, 14]} />
        <meshBasicMaterial color={'#44aaff'} depthTest={false} />
      </mesh>
    </group>
  )
}

// ─── Slatwall panel mesh (1" thick, on interior face of wall) ─────────────────
const SlatwallPanelMesh = memo(function SlatwallPanelMesh({ panel, wall, wireframe, selected, onClick, onPointerDown }: {
  panel: SlatwallPanel; wall: GarageWall; wireframe: boolean; selected: boolean
  onClick: () => void
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const lengthIn = Math.hypot(dx, dz)
  const rotY  = -Math.atan2(dz, dx)
  const midX  = FT((wall.x1 + wall.x2) / 2)
  const midZ  = FT((wall.z1 + wall.z2) / 2)

  const panelW = panel.alongEnd - panel.alongStart
  const panelH = panel.yTop - panel.yBottom
  const localX = FT(-lengthIn / 2 + panel.alongStart + panelW / 2)
  const localY = FT((panel.yBottom + panel.yTop) / 2)
  // Slatwall total thickness = 1.25". Sits flush against the wall face.
  // Exterior panels go on the opposite side of the wall.
  const sideSign = panel.side === 'exterior' ? -1 : 1
  const PANEL_THICK = 1.25  // total slatwall thickness in inches
  const localZ = sideSign * FT(wall.thickness / 2 + PANEL_THICK / 2)

  const hex       = slatwallColors.find(c => c.id === panel.color)?.hex ?? '#f2f2f0'
  const grooveHex = darkenHex(hex, 0.28)
  const roughness = slatRoughness(hex)   // dark colors get frosted/matte finish

  // Geometry layout (panel total = 1.25" thick):
  //   back plate:  1" thick, back face flush with wall
  //   board strips: 1/4" thick, front face = panel face (1.25" from wall)
  const backPlateThick = 1.0
  const boardThick = 0.25
  const backPlateZ = localZ - sideSign * FT((PANEL_THICK - backPlateThick) / 2)
  const boardFaceZ = localZ + sideSign * FT((PANEL_THICK - boardThick) / 2)

  // Trim: 1.5" wide, covers full panel depth
  const trimW     = FT(1.5)
  const trimThick = FT(PANEL_THICK)
  const trimZ     = localZ

  const wFt = FT(panelW), hFt = FT(panelH)
  const halfW = wFt / 2, halfH = hFt / 2

  // Board strip positions (precomputed, memoized)
  const boardData = useMemo(() => {
    const boards: { y: number; h: number }[] = []
    const count = Math.ceil(panelH / SLAT_PERIOD)
    for (let i = 0; i < count; i++) {
      const bBot = panel.yBottom + i * SLAT_PERIOD
      const bTop = Math.min(bBot + SLAT_BOARD_H, panel.yTop)
      if (bTop <= bBot) continue
      boards.push({ y: FT((bBot + bTop) / 2), h: FT(bTop - bBot) })
    }
    return boards
  }, [panel.yBottom, panel.yTop, panelH])

  // Vertical dividers every 8ft
  const dividers: number[] = []
  for (let offset = 96; offset < panelW; offset += 96) {
    dividers.push(FT(-panelW / 2 + offset))
  }

  const trimMat = <meshLambertMaterial color={hex} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />

  return (
    <group position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
      {/* Interaction group — stops propagation for all child meshes */}
      <group onClick={(e) => { e.stopPropagation(); onClick() }} onPointerDown={onPointerDown}>
      {/* Back plate — visible inside grooves, slightly darker */}
      <mesh position={[localX, localY, backPlateZ]}>
        <boxGeometry args={[wFt, hFt, FT(backPlateThick)]} />
        <meshStandardMaterial wireframe={wireframe}
          color={grooveHex}
          emissive={selected ? '#4488bb' : '#000000'}
          emissiveIntensity={selected ? 0.25 : 0}
          roughness={Math.min(roughness + 0.1, 1.0)}
          metalness={0.02} />
      </mesh>

      {/* Board strips — instanced for performance (1/4" proud of back plate) */}
      {!wireframe && boardData.length > 0 && (
        <instancedMesh
          ref={(mesh: THREE.InstancedMesh | null) => {
            if (!mesh) return
            const dummy = new THREE.Object3D()
            boardData.forEach((b, i) => {
              dummy.position.set(localX, b.y, boardFaceZ)
              dummy.scale.set(wFt, b.h, FT(SLAT_GROOVE_D))
              dummy.updateMatrix()
              mesh.setMatrixAt(i, dummy.matrix)
            })
            mesh.instanceMatrix.needsUpdate = true
          }}
          args={[undefined!, undefined!, boardData.length]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={hex} roughness={roughness} metalness={0.04} />
        </instancedMesh>
      )}

      {!wireframe && (<>
        {/* Left border */}
        <mesh position={[localX - halfW + trimW / 2, localY, trimZ]}>
          <boxGeometry args={[trimW, hFt, trimThick]} />{trimMat}
        </mesh>
        {/* Right border */}
        <mesh position={[localX + halfW - trimW / 2, localY, trimZ]}>
          <boxGeometry args={[trimW, hFt, trimThick]} />{trimMat}
        </mesh>
        {/* Top border */}
        <mesh position={[localX, localY + halfH - trimW / 2, trimZ]}>
          <boxGeometry args={[wFt, trimW, trimThick]} />{trimMat}
        </mesh>
        {/* Bottom border */}
        <mesh position={[localX, localY - halfH + trimW / 2, trimZ]}>
          <boxGeometry args={[wFt, trimW, trimThick]} />{trimMat}
        </mesh>
        {/* Vertical dividers every 8ft */}
        {dividers.map((lx, i) => (
          <mesh key={i} position={[localX + lx, localY, trimZ]}>
            <boxGeometry args={[trimW, hFt, trimThick]} />{trimMat}
          </mesh>
        ))}
      </>)}
      </group>
    </group>
  )
})

// ─── Stainless steel backsplash panel mesh (1/8" thick, mounted like slatwall) ──
const StainlessBacksplashPanelMesh = memo(function StainlessBacksplashPanelMesh({ panel, wall, wireframe, selected, onClick, onPointerDown }: {
  panel: StainlessBacksplashPanel; wall: GarageWall; wireframe: boolean; selected: boolean
  onClick: () => void
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void
}) {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const lengthIn = Math.hypot(dx, dz)
  const rotY  = -Math.atan2(dz, dx)
  const midX  = FT((wall.x1 + wall.x2) / 2)
  const midZ  = FT((wall.z1 + wall.z2) / 2)

  const panelW = panel.alongEnd - panel.alongStart
  const panelH = panel.yTop - panel.yBottom
  const localX = FT(-lengthIn / 2 + panel.alongStart + panelW / 2)
  const localY = FT((panel.yBottom + panel.yTop) / 2)
  const sideSign = panel.side === 'exterior' ? -1 : 1
  const thickFt = FT(0.125)   // 1/8" total thickness
  // Center of plate sits just proud of the wall face (half-thickness + a hair
  // for z-fight safety), same pattern as slatwall's 0.6ft offset but scaled to
  // match the much thinner plate.
  const localZ = sideSign * (FT(wall.thickness / 2) + thickFt / 2 + FT(0.02))

  const wFt = FT(panelW), hFt = FT(panelH)
  const textureKind = panel.texture ?? 'stainless'

  // Load both PBR texture sets so switching finishes is instant.
  const stainlessSrc = useTexture({
    map:          `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/color.jpg`,
    normalMap:    `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/normal.jpg`,
    roughnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/roughness.jpg`,
    metalnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/brushed-stainless/metalness.jpg`,
  })
  const diamondSrc = useTexture({
    map:          `${import.meta.env.BASE_URL}assets/textures/metal/diamondplate/color.jpg`,
    normalMap:    `${import.meta.env.BASE_URL}assets/textures/metal/diamondplate/normal.jpg`,
    roughnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/diamondplate/roughness.jpg`,
    metalnessMap: `${import.meta.env.BASE_URL}assets/textures/metal/diamondplate/metalness.jpg`,
  })
  const src = textureKind === 'diamondplate' ? diamondSrc : stainlessSrc

  const maps = useMemo(() => {
    if (wireframe) return null
    const map          = src.map.clone()
    const normalMap    = src.normalMap.clone()
    const roughnessMap = src.roughnessMap.clone()
    const metalnessMap = src.metalnessMap.clone()
    // Diamondplate tile is a repeating pattern — tile tighter so the diamonds
    // stay visually crisp on wider panels; stainless uses the original ratio.
    const repX = textureKind === 'diamondplate'
      ? Math.max(1, wFt / 1)
      : Math.max(1, wFt / 2)
    const repY = textureKind === 'diamondplate'
      ? Math.max(1, hFt / 1)
      : Math.max(1, hFt / 1.5)
    for (const t of [map, normalMap, roughnessMap, metalnessMap]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.repeat.set(repX, repY)
      t.needsUpdate = true
    }
    map.colorSpace = THREE.SRGBColorSpace
    normalMap.colorSpace = THREE.NoColorSpace
    roughnessMap.colorSpace = THREE.NoColorSpace
    metalnessMap.colorSpace = THREE.NoColorSpace
    return { map, normalMap, roughnessMap, metalnessMap }
  }, [wireframe, wFt, hFt, src, textureKind])

  return (
    <group position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
      <group onClick={(e) => { e.stopPropagation(); onClick() }} onPointerDown={onPointerDown}>
        <mesh position={[localX, localY, localZ]} castShadow receiveShadow>
          <boxGeometry args={[wFt, hFt, thickFt]} />
          {wireframe ? (
            <meshLambertMaterial wireframe color={selected ? '#ffcc00' : '#c0c4c8'} />
          ) : (
            <meshPhysicalMaterial
              map={maps?.map}
              normalMap={maps?.normalMap}
              normalScale={[0.8, 0.8] as unknown as THREE.Vector2}
              roughnessMap={maps?.roughnessMap}
              color="#ffffff"
              metalness={0}
              roughness={0.65}
              emissive={selected ? '#4488bb' : '#000000'}
              emissiveIntensity={selected ? 0.25 : 0}
              envMapIntensity={0}
            />
          )}
        </mesh>
      </group>
    </group>
  )
})

// ─── Slatwall accessory mesh — positioned on parent panel's wall ─────────────
const SlatwallAccessoryMesh = memo(function SlatwallAccessoryMesh({ acc, panel, wall, wireframe, selected, onClick }: {
  acc: SlatwallAccessory; panel: SlatwallPanel; wall: GarageWall
  wireframe: boolean; selected: boolean; onClick: () => void
}) {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const lengthIn = Math.hypot(dx, dz)
  const rotY  = -Math.atan2(dz, dx)
  const midX  = FT((wall.x1 + wall.x2) / 2)
  const midZ  = FT((wall.z1 + wall.z2) / 2)

  // Position accessory on the panel surface
  const sideSign = (panel.side ?? 'interior') === 'exterior' ? -1 : 1
  const localX = FT(-lengthIn / 2 + panel.alongStart + acc.along)
  const localY = FT(panel.yBottom + acc.yOffset)
  const localZ = sideSign * FT(wall.thickness / 2 + 1.0 + acc.d / 2)  // proud of slatwall face

  const color = wireframe ? (selected ? '#ffcc00' : '#ff9944') : acc.color

  return (
    <group position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
      <mesh
        position={[localX, localY, localZ]}
        onClick={(e) => { e.stopPropagation(); onClick() }}
      >
        <boxGeometry args={[FT(acc.w), FT(acc.h), FT(acc.d)]} />
        <meshLambertMaterial
          wireframe={wireframe}
          color={color}
          emissive={selected ? '#334466' : '#000000'}
          emissiveIntensity={selected ? 0.3 : 0}
        />
      </mesh>
    </group>
  )
})

// ─── Floor step mesh — textured top face, solid concrete sides, sphere corner handles ──
const FloorStepMesh = memo(function FloorStepMesh({ step, baseTex, wireframe, selected, onClick, onPointerDown, onCornerDown, onAddCorner, onRemoveCorner }: {
  step: FloorStep
  baseTex: THREE.Texture
  wireframe: boolean
  selected: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onCornerDown: (corner: number, e: ThreeEvent<PointerEvent>) => void
  onAddCorner: (afterIdx: number) => void
  onRemoveCorner: (idx: number) => void
}) {
  const h = FT(step.height)
  const { width: bw, depth: bd } = stepBounds(step)
  const w = FT(bw), d = FT(bd)

  // Build extruded geometry from polygon corners. Shape is in X-Z plane
  // (using shape-x → world X, shape-y → world Z), extruded along +Y by h.
  const cornersKey = step.corners.map(c => `${c[0]},${c[1]}`).join('|')
  const geom = useMemo(() => {
    const s = new THREE.Shape()
    const c = step.corners
    // Shape coords: shape-x → world X, shape-y → world Z (after rotation
    // we negate shape-y, so feed -Z here to cancel the flip).
    s.moveTo(FT(c[0][0]), -FT(c[0][1]))
    for (let i = 1; i < c.length; i++) s.lineTo(FT(c[i][0]), -FT(c[i][1]))
    s.lineTo(FT(c[0][0]), -FT(c[0][1]))
    const g = new THREE.ExtrudeGeometry(s, {
      depth: h, bevelEnabled: false, steps: 1, curveSegments: 1,
    })
    // rotateX(-π/2): world-x = shape-x, world-y = z_extrude (0..h),
    // world-z = -shape-y. Since shape-y = -FT(cornerZ), world-z = FT(cornerZ).
    g.rotateX(-Math.PI / 2)
    return g
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cornersKey, h])
  useEffect(() => () => geom.dispose(), [geom])

  // Use the same repeat as the floor so the step texture matches seamlessly.
  // ExtrudeGeometry default UVs map shape coords (in feet) to UV space; with
  // repeat = baseTex.repeat (repeats-per-foot), the density matches the floor.
  const stepTex = useMemo(() => { const t = baseTex.clone(); t.needsUpdate = true; return t }, [baseTex])
  stepTex.repeat.set(baseTex.repeat.x, baseTex.repeat.y)

  const wfColor = selected ? '#00e5ff' : '#1a2a3a'
  const SINK = FT(0.025)
  const HANDLE_Y = h + 0.08  // just above step surface, same as wall handles

  return (
    <group position={[0, -SINK, 0]}>
      <mesh
        geometry={geom}
        receiveShadow castShadow
        onClick={onClick}
        onPointerDown={onPointerDown}
      >
        <meshStandardMaterial
          map={wireframe ? null : stepTex}
          color={wireframe ? wfColor : '#ffffff'}
          wireframe={wireframe}
          roughness={wireframe ? 1 : 0.45}
          metalness={wireframe ? 0 : 0.05}
          emissive={selected && !wireframe ? '#004466' : '#000000'}
          emissiveIntensity={selected && !wireframe ? 0.08 : 0}
        />
      </mesh>

      {/* Corner handles — same style as wall corners (orange, size 0.18) */}
      {selected && !wireframe && step.corners.map(([cx, cz], i) => (
        <group key={`c${i}`}
          onPointerDown={e => {
            e.stopPropagation()
            if (e.nativeEvent.button === 2 && step.corners.length > 3) {
              onRemoveCorner(i)
            } else {
              onCornerDown(i, e)
            }
          }}
          onClick={e => e.stopPropagation()}
          onContextMenu={(e: any) => e.nativeEvent?.preventDefault?.()}
        >
          <DragHandle
            position={[FT(cx), HANDLE_Y, FT(cz)]}
            color="#ff8800"
            size={0.18}
            onPointerDown={e => {
              e.stopPropagation()
              if (e.nativeEvent.button === 2 && step.corners.length > 3) {
                onRemoveCorner(i)
              } else {
                onCornerDown(i, e)
              }
            }}
          />
        </group>
      ))}
      {/* Midpoint handles — smaller green, click to add a new corner */}
      {selected && !wireframe && step.corners.map(([cx, cz], i) => {
        const [nx, nz] = step.corners[(i + 1) % step.corners.length]
        const mx = (cx + nx) / 2, mz = (cz + nz) / 2
        return (
          <DragHandle
            key={`m${i}`}
            position={[FT(mx), HANDLE_Y, FT(mz)]}
            color="#44ff88"
            size={0.12}
            onPointerDown={e => { e.stopPropagation(); onAddCorner(i) }}
          />
        )
      })}
    </group>
  )
})

// ─── Dimension lines (plan view) ──────────────────────────────────────────────

/** Solid thin line between two 3D points. */
function Seg({ a, b, color }: {
  a: [number,number,number]; b: [number,number,number]; color: string
}) {
  const arr = useMemo(() => new Float32Array([...a, ...b]), [a, b])
  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[arr, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} />
    </line>
  )
}

/** Dashed line between two 3D points (witness / extension lines). */
function DashedSeg({ a, b, color, dashSize = 0.08, gapSize = 0.06 }: {
  a: [number,number,number]; b: [number,number,number]; color: string
  dashSize?: number; gapSize?: number
}) {
  const ref = useRef<THREE.Line>(null!)
  const arr = useMemo(() => new Float32Array([...a, ...b]), [a, b])
  useEffect(() => { if (ref.current) ref.current.computeLineDistances() }, [a, b])
  return (
    <line ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[arr, 3]} />
      </bufferGeometry>
      <lineDashedMaterial color={color} dashSize={dashSize} gapSize={gapSize} />
    </line>
  )
}

/**
 * Blueprint-style dimension annotation lying flat in the XZ plane.
 * Matches the wall edit aesthetic: dashed witness lines, solid dim line,
 * perpendicular tick marks, text offset above the line.
 * White-on-dark color scheme for the floor plan dark background.
 */
function DimAnnot({ x1, z1, x2, z2, nx, nz, dist, label, y = 0.04 }: {
  x1: number; z1: number; x2: number; z2: number
  nx: number; nz: number   // outward unit normal (XZ plane)
  dist: number             // offset distance for the dim line (ft)
  label: string; y?: number
}) {
  // Dim line endpoints (offset outward)
  const dx1 = x1 + nx * dist, dz1 = z1 + nz * dist
  const dx2 = x2 + nx * dist, dz2 = z2 + nz * dist
  const mx = (dx1 + dx2) / 2, mz = (dz1 + dz2) / 2

  // Perpendicular to dim line for tick marks
  const ddx = dx2 - dx1, ddz = dz2 - dz1
  const dlen = Math.sqrt(ddx * ddx + ddz * ddz)
  const tpx = dlen > 0.01 ? -ddz / dlen * 0.11 : 0.11
  const tpz = dlen > 0.01 ?  ddx / dlen * 0.11 : 0

  // Text offset above the dim line (outward)
  const textOff = 0.12
  const tmx = mx + nx * textOff, tmz = mz + nz * textOff

  // Text rotation: flat on floor, aligned with dimension line
  const angle = Math.atan2(ddz, ddx)
  let ry = -angle
  if (ry > Math.PI / 2)  ry -= Math.PI
  if (ry < -Math.PI / 2) ry += Math.PI
  const euler = new THREE.Euler(-Math.PI / 2, ry, 0, 'YXZ')

  // Dark color scheme matching wall edit blueprint style
  const WITNESS = '#888888'  // dashed witness lines
  const DIM_LINE = '#333333' // solid dim line + ticks
  const TXT = '#333333'      // label text

  return (
    <group>
      {/* Dashed witness/extension lines */}
      <DashedSeg a={[x1, y, z1]} b={[dx1, y, dz1]} color={WITNESS} />
      <DashedSeg a={[x2, y, z2]} b={[dx2, y, dz2]} color={WITNESS} />
      {/* Solid dim line */}
      <Seg a={[dx1, y, dz1]} b={[dx2, y, dz2]} color={DIM_LINE} />
      {/* Tick marks at endpoints */}
      <Seg a={[dx1-tpx, y, dz1-tpz]} b={[dx1+tpx, y, dz1+tpz]} color={DIM_LINE} />
      <Seg a={[dx2-tpx, y, dz2-tpz]} b={[dx2+tpx, y, dz2+tpz]} color={DIM_LINE} />
      {/* Label — offset above the dim line */}
      <Text
        position={[tmx, y + 0.01, tmz]}
        rotation={euler}
        fontSize={0.22}
        color={TXT}
        anchorX="center"
        anchorY="middle"
        renderOrder={999}
      >
        {label}
      </Text>
    </group>
  )
}

function DimensionLines({ walls, cabinets }: { walls: GarageWall[]; cabinets: PlacedCabinet[] }) {
  const b = getFloorBounds(walls)
  const cx = (b.minX + b.maxX) / 2
  const cz = (b.minZ + b.maxZ) / 2
  const CAB   = 0.75   // cabinet/product chain offset (ft)
  const TOTAL = 1.55   // total wall width dim offset (ft)
  const y = 0.04

  // Collect per-wall data with interior adjustments
  type WallDimData = {
    wall: GarageWall; nx: number; nz: number; ux: number; uz: number
    ix1: number; iz1: number; ix2: number; iz2: number
    interiorLen: number; startAdj: number; endAdj: number
  }
  const wallData: WallDimData[] = []
  for (const wall of walls) {
    const lenIn = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
    if (lenIn < 6) continue
    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.sqrt(dx * dx + dz * dz)
    const ux = dx / len, uz = dz / len

    // Outward normal: perpendicular pointing away from garage center
    const n1x = -dz / len, n1z = dx / len
    const wmx = (wall.x1 + wall.x2) / 2, wmz = (wall.z1 + wall.z2) / 2
    const dot = n1x * (cx - wmx) + n1z * (cz - wmz)
    const nx = dot < 0 ? n1x : -n1x
    const nz = dot < 0 ? n1z : -n1z

    // Interior face endpoints: shift inward along wall direction by corner adj
    const cadj = computeCornerAdj(wall, walls)
    const startAdj = cadj.startExt
    const endAdj = cadj.endExt
    const ix1 = FT(wall.x1) + FT(startAdj) * ux
    const iz1 = FT(wall.z1) + FT(startAdj) * uz
    const ix2 = FT(wall.x2) - FT(endAdj) * ux
    const iz2 = FT(wall.z2) - FT(endAdj) * uz
    const interiorLen = lenIn - startAdj - endAdj

    wallData.push({ wall, nx, nz, ux, uz, ix1, iz1, ix2, iz2, interiorLen, startAdj, endAdj })
  }

  // Project cabinets onto a wall and return sorted along-positions
  function getCabsOnWall(wd: WallDimData) {
    const { wall, ux, uz, startAdj, endAdj } = wd
    const lenIn = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
    const result: { along: number; width: number }[] = []
    for (const cab of cabinets) {
      const relX = cab.x - wall.x1, relZ = cab.z - wall.z1
      const along = relX * ux + relZ * uz
      const perp = Math.abs(relX * (-uz) + relZ * ux)
      if (perp > cab.d / 2 + wall.thickness / 2 + 12) continue
      if (along + cab.w / 2 < startAdj - 6 || along - cab.w / 2 > lenIn - endAdj + 6) continue
      result.push({ along, width: cab.w })
    }
    return result.sort((a, b) => a.along - b.along)
  }

  // Build cabinet dimension chain segments for a wall
  function makeCabChain(wd: WallDimData) {
    const { startAdj, endAdj, wall } = wd
    const lenIn = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
    const cabs = getCabsOnWall(wd)
    if (cabs.length === 0) return []

    const wStart = startAdj
    const wEnd = lenIn - endAdj
    const segs: { start: number; end: number; label: string }[] = []
    let cursor = wStart

    for (const cab of cabs) {
      const cabStart = Math.max(wStart, cab.along - cab.width / 2)
      const cabEnd = Math.min(wEnd, cab.along + cab.width / 2)
      if (cabEnd <= cabStart) continue
      if (cabStart > cursor + 0.25) {
        segs.push({ start: cursor, end: cabStart, label: inchesToDisplay(cabStart - cursor) })
      }
      segs.push({ start: cabStart, end: cabEnd, label: inchesToDisplay(cabEnd - cabStart) })
      cursor = cabEnd
    }
    if (wEnd > cursor + 0.25) {
      segs.push({ start: cursor, end: wEnd, label: inchesToDisplay(wEnd - cursor) })
    }
    return segs
  }

  return (
    <group>
      {/* ── Product dimension chains — only on walls with cabinets/products ── */}
      {wallData.map(wd => {
        const segs = makeCabChain(wd)
        if (segs.length === 0) return null
        const { nx, nz, ux, uz, wall, ix1, iz1, ix2, iz2, interiorLen } = wd
        return (
          <group key={wd.wall.id}>
            {/* Segment breakdown (gaps + products) */}
            {segs.map((seg, i) => {
              const sx1 = FT(wall.x1) + FT(seg.start) * ux
              const sz1 = FT(wall.z1) + FT(seg.start) * uz
              const sx2 = FT(wall.x1) + FT(seg.end) * ux
              const sz2 = FT(wall.z1) + FT(seg.end) * uz
              return (
                <DimAnnot key={`${wall.id}-cab-${i}`}
                  x1={sx1} z1={sz1} x2={sx2} z2={sz2}
                  nx={nx} nz={nz} dist={CAB}
                  label={seg.label} y={y}
                />
              )
            })}
            {/* Total wall interior length */}
            <DimAnnot
              x1={ix1} z1={iz1} x2={ix2} z2={iz2}
              nx={nx} nz={nz} dist={TOTAL}
              label={inchesToDisplay(interiorLen)} y={y}
            />
          </group>
        )
      })}
    </group>
  )
}

// ─── Elevation dimension lines ────────────────────────────────────────────────
// Drawn in the XY or ZY plane; visible only in front/side elevation views.

function ElevationDimLines({ viewMode, walls, garageWidth, garageDepth, ceilingHeight }:
  { viewMode: string; walls: GarageWall[]; garageWidth: number; garageDepth: number; ceilingHeight: number }) {

  const wFt  = FT(garageWidth)
  const dFt  = FT(garageDepth)
  const chFt = FT(ceilingHeight)
  const EXT = '#3d5f8a', DIM = '#7aafd4', TXT = '#cce4ff'
  const TICK = 0.1

  if (viewMode === 'front') {
    // Front Wall sits at z = +dFt/2. Annotations slightly beyond it (visible to camera at −Z side).
    const az     = dFt / 2 + 0.08
    const yBot   = -0.42          // dim line below floor
    const xLeft  = -(wFt / 2 + 0.55)  // dim line left of left wall

    const wLabel = inchesToDisplay(garageWidth)
    const hLabel = inchesToDisplay(ceilingHeight)

    // Additional per-wall segment dims: collect walls whose face is roughly at z = +dFt/2
    const frontWalls = walls.filter(w => {
      const midZ = (w.z1 + w.z2) / 2
      return Math.abs(midZ - garageDepth / 2) < garageDepth * 0.12 &&
             Math.abs(w.x2 - w.x1) > Math.abs(w.z2 - w.z1)  // predominantly horizontal
    })

    return (
      <group>
        {/* ── Bottom horizontal total-width dim ──────────────────────────── */}
        <Seg a={[-wFt/2, 0, az]} b={[-wFt/2, yBot, az]} color={EXT} />
        <Seg a={[ wFt/2, 0, az]} b={[ wFt/2, yBot, az]} color={EXT} />
        <Seg a={[-wFt/2, yBot, az]} b={[wFt/2, yBot, az]} color={DIM} />
        <Seg a={[-wFt/2, yBot-TICK, az]} b={[-wFt/2, yBot+TICK, az]} color={DIM} />
        <Seg a={[ wFt/2, yBot-TICK, az]} b={[ wFt/2, yBot+TICK, az]} color={DIM} />
        <Text position={[0, yBot - 0.22, az]} rotation={[0, Math.PI, 0]}
          fontSize={0.20} color={TXT} anchorX="center" anchorY="middle" renderOrder={999}>
          {wLabel}
        </Text>

        {/* ── Left vertical total-height dim ─────────────────────────────── */}
        <Seg a={[-wFt/2, 0,     az]} b={[xLeft, 0,     az]} color={EXT} />
        <Seg a={[-wFt/2, chFt,  az]} b={[xLeft, chFt,  az]} color={EXT} />
        <Seg a={[xLeft,  0,     az]} b={[xLeft, chFt,   az]} color={DIM} />
        <Seg a={[xLeft-TICK, 0,    az]} b={[xLeft+TICK, 0,    az]} color={DIM} />
        <Seg a={[xLeft-TICK, chFt, az]} b={[xLeft+TICK, chFt, az]} color={DIM} />
        <Text position={[xLeft - 0.22, chFt / 2, az]} rotation={[0, Math.PI, 0]}
          fontSize={0.20} color={TXT} anchorX="center" anchorY="middle" renderOrder={999}>
          {hLabel}
        </Text>

        {/* ── Per-opening segment dims (if a front wall found) ───────────── */}
        {frontWalls.map(wall => {
          const lenIn = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
          const sorted = [...wall.openings].sort((a, b) => a.xOffset - b.xOffset)
          if (sorted.length === 0) return null
          const wallX = FT((wall.x1 + wall.x2) / 2) - FT(lenIn / 2)
          const segY   = yBot - 0.52
          const items: { left: number; right: number }[] = []
          let cur = 0
          for (const op of sorted) {
            if (op.xOffset > cur) items.push({ left: cur, right: op.xOffset })
            items.push({ left: op.xOffset, right: op.xOffset + op.width })
            cur = op.xOffset + op.width
          }
          if (cur < lenIn) items.push({ left: cur, right: lenIn })
          return (
            <group key={wall.id}>
              {items.map((seg, idx) => {
                const sx = wallX + FT(seg.left)
                const ex = wallX + FT(seg.right)
                const mx = (sx + ex) / 2
                return (
                  <group key={idx}>
                    <Seg a={[sx, 0, az]} b={[sx, segY, az]} color={EXT} />
                    <Seg a={[ex, 0, az]} b={[ex, segY, az]} color={EXT} />
                    <Seg a={[sx, segY, az]} b={[ex, segY, az]} color={DIM} />
                    <Seg a={[sx, segY-TICK*0.8, az]} b={[sx, segY+TICK*0.8, az]} color={DIM} />
                    <Seg a={[ex, segY-TICK*0.8, az]} b={[ex, segY+TICK*0.8, az]} color={DIM} />
                    <Text position={[mx, segY-0.18, az]} rotation={[0, Math.PI, 0]}
                      fontSize={0.14} color={TXT} anchorX="center" anchorY="middle" renderOrder={999}>
                      {inchesToDisplay(seg.right - seg.left)}
                    </Text>
                  </group>
                )
              })}
            </group>
          )
        })}
      </group>
    )
  }

  if (viewMode === 'side') {
    // Left Wall sits at x = −wFt/2. Camera is at +wFt/2 − 0.5, looking in −X direction.
    // Annotations at x = −wFt/2 + 0.08 (in front of wall, toward camera).
    // Camera local-X = world −Z, so image-left = world +Z, image-right = world −Z.
    const ax    = -wFt / 2 + 0.08
    const yBot  = -0.42
    const zSide =  dFt / 2 + 0.55   // dim line to image-left (world +Z side)

    const dLabel = inchesToDisplay(garageDepth)
    const hLabel = inchesToDisplay(ceilingHeight)

    return (
      <group>
        {/* ── Bottom horizontal total-depth dim ──────────────────────────── */}
        <Seg a={[ax, 0,    -dFt/2]} b={[ax, yBot,  -dFt/2]} color={EXT} />
        <Seg a={[ax, 0,     dFt/2]} b={[ax, yBot,   dFt/2]} color={EXT} />
        <Seg a={[ax, yBot, -dFt/2]} b={[ax, yBot,   dFt/2]} color={DIM} />
        <Seg a={[ax, yBot-TICK, -dFt/2]} b={[ax, yBot+TICK, -dFt/2]} color={DIM} />
        <Seg a={[ax, yBot-TICK,  dFt/2]} b={[ax, yBot+TICK,  dFt/2]} color={DIM} />
        <Text position={[ax, yBot - 0.22, 0]} rotation={[0, Math.PI/2, 0]}
          fontSize={0.20} color={TXT} anchorX="center" anchorY="middle" renderOrder={999}>
          {dLabel}
        </Text>

        {/* ── Left (image-left = +Z) vertical total-height dim ───────────── */}
        <Seg a={[ax, 0,    dFt/2]} b={[ax, 0,    zSide]} color={EXT} />
        <Seg a={[ax, chFt, dFt/2]} b={[ax, chFt, zSide]} color={EXT} />
        <Seg a={[ax, 0,    zSide]} b={[ax, chFt, zSide]} color={DIM} />
        <Seg a={[ax, 0,    zSide-TICK]} b={[ax, 0,    zSide+TICK]} color={DIM} />
        <Seg a={[ax, chFt, zSide-TICK]} b={[ax, chFt, zSide+TICK]} color={DIM} />
        <Text position={[ax, chFt / 2, zSide + 0.22]} rotation={[0, Math.PI/2, 0]}
          fontSize={0.20} color={TXT} anchorX="center" anchorY="middle" renderOrder={999}>
          {hLabel}
        </Text>
      </group>
    )
  }

  return null
}

// ─── Drag state types ─────────────────────────────────────────────────────────
interface WallDragState {
  wallId: string
  endpoint: 'start' | 'end' | 'body'
  hitX: number; hitZ: number              // floor-plane mouse position at drag start (inches)
  initX1: number; initZ1: number          // wall positions at drag start (inches)
  initX2: number; initZ2: number
}
interface ShapeDragState {
  shapeId: string
  startXIn: number; startZIn: number
  rawX: number; rawZ: number
}
interface FloorPointDragState {
  pointIdx: number
  hitX: number; hitZ: number   // mouse floor-hit at drag start (inches)
  initX: number; initZ: number // floor point position at drag start (inches)
}
interface VertDragState {
  shapeId: string
  plane: THREE.Plane
  startHitY: number   // feet at drag start
  startShapeY: number // shape.y in inches at drag start
}
interface CabinetDragState {
  cabinetId: string
  yOffset?: number
  startXIn: number
  startZIn: number
  startHitXIn: number
  startHitZIn: number
}
interface LightDragState {
  lightId: string
  startXFt: number; startZFt: number
  startHitX: number; startHitZ: number
}

interface CeilingLightDragState {
  lightId: string
  startXFt: number; startZFt: number
  startHitX: number; startHitZ: number
}

/** Dragging a left or right edge handle on a countertop to resize width */
interface CountertopDragState {
  ctId: string
  side?: 'left' | 'right' // which handle is being dragged (undefined when moving)
  ux: number; uz: number  // unit vector along countertop (cos rotY, -sin rotY)
  fixedAlong: number      // along-wall position of the FIXED opposite edge (inches)
  perpComp: number        // perpendicular component of center (frozen during drag)
  moving?: boolean        // true when dragging the whole countertop, not resizing
  startY?: number         // Y at drag start, used when moving
  startX?: number         // X at drag start (inches)
  startZ?: number         // Z at drag start (inches)
  startHitX?: number      // initial mouse floor hit X (inches)
  startHitZ?: number      // initial mouse floor hit Z (inches)
}

/** Dragging a floor step along the floor plane */
interface FloorStepDragState {
  stepId: string
  hitX: number; hitZ: number              // floor hit at drag start (feet)
  initCorners: [number, number][]         // corners at drag start (inches)
}

/** Dragging one corner of a floor step to reshape it on the floor plane */
interface FloorStepCornerDragState {
  stepId: string
  cornerIdx: number  // index into corners[]
}

/** Dragging the body of a slatwall panel to slide it along and up/down the wall */
/** Dragging a TOP corner handle of an opening — resizes width (via the moving
 *  side) and height (from bottom), keeping the opposite side and the bottom
 *  anchored. */
interface OpeningCornerDragState {
  wallId: string
  openingId: string
  corner: 'tl' | 'tr'
  plane: THREE.Plane
  wallMidX: number; wallMidZ: number
  wallUx: number; wallUz: number
  wallLenIn: number
  fixedSideIn: number    // along-wall position of the corner OPPOSITE the drag
  bottomIn: number       // yOffset (bottom stays anchored)
}

/** Dragging a wall opening (door/window) along the wall to reposition xOffset. */
interface OpeningDragState {
  wallId: string
  openingId: string
  plane: THREE.Plane
  wallMidX: number; wallMidZ: number   // ft
  wallUx: number; wallUz: number        // unit along wall
  wallLenIn: number
  startXOffsetIn: number
  widthIn: number
  hitAlongIn: number
  // Vertical drag fields — needed so a door can be lifted up onto a
  // baseboard, stem wall, step-up, or raised to any Y on the wall.
  startYOffsetIn: number
  heightIn: number
  hitYIn: number          // cursor Y at drag start, in inches
  wallHeightIn: number
}

interface SlatwallBodyDragState {
  panelId: string
  plane: THREE.Plane
  wallMidX: number; wallMidZ: number
  wallUx: number; wallUz: number
  wallLenIn: number
  startTrimIn: number; endTrimIn: number
  startAlongIn: number   // alongStart at drag start
  endAlongIn: number     // alongEnd at drag start
  startYBottom: number   // yBottom at drag start
  startYTop: number      // yTop at drag start
  hitAlongIn: number     // along-component of initial mouse hit
  hitHeightIn: number    // height component of initial mouse hit
  wallId: string          // to look up wall height / baseboard during drag
}

/** Dragging one corner of a slatwall panel in wall-face-plane space */
interface SlatwallCornerDragState {
  panelId: string
  corner: 0 | 1 | 2 | 3   // 0=TL, 1=TR, 2=BR, 3=BL
  plane: THREE.Plane       // wall interior face plane in world space
  wallMidX: number         // wall midpoint (ft)
  wallMidZ: number
  wallUx: number           // wall unit direction (world XZ)
  wallUz: number
  wallLenIn: number        // wall length (inches), for clamping
  startTrimIn: number      // inches to trim from wall start (adjacent wall corner)
  endTrimIn: number        // inches to trim from wall end (adjacent wall corner)
  wallId: string
}

// ─── GLTF model rendering with fallback placeholder ───────────────────────────
class ModelErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  render() { return this.state.hasError ? this.props.fallback : this.props.children }
}

function GLBModel({ type, tw, th, td, modelRotY }: { type: string; tw: number; th: number; td: number; modelRotY?: number }) {
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}assets/models/${type}.glb`)
  const { scale, ox, oy, oz } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    if (size.lengthSq() < 0.0001) return { scale: 1, ox: 0, oy: 0, oz: 0 }
    // Scale so the model's longest dimension matches the target's longest dimension.
    const maxModel = Math.max(size.x, size.y, size.z)
    const maxTarget = Math.max(tw, th, td)
    const s = maxTarget / maxModel
    const center = box.getCenter(new THREE.Vector3())
    return { scale: s, ox: -center.x * s, oy: -box.min.y * s, oz: -center.z * s }
  }, [scene, tw, th, td])
  const cloned = useMemo(() => {
    const c = scene.clone(true)
    c.traverse((obj: any) => {
      if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true }
    })
    return c
  }, [scene])
  // Wrap in a group so the per-model rotation offset doesn't fight with positioning
  return (
    <group rotation={[0, modelRotY ?? 0, 0]}>
      <primitive object={cloned} scale={scale} position={[ox, oy, oz]} />
    </group>
  )
}

/** Renders an imported GLB model — checks memory cache first, then IndexedDB */
function ImportedGLBModel({ assetId }: { assetId: string }) {
  const [url, setUrl] = useState<string | null>(() => getCachedModelUrl(assetId) ?? null)
  const [failed, setFailed] = useState(false)

  // Get category from the permanent library (not project state)
  const category = useMemo(() => {
    const lib = getLibraryModels()
    return lib.find(m => m.id === assetId)?.category
  }, [assetId])

  useEffect(() => {
    if (url) return
    let cancelled = false
    restoreModelFromDB(assetId).then(restored => {
      if (cancelled) return
      if (restored) setUrl(restored)
      else setFailed(true)
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [assetId, url])

  if (failed) return null
  if (!url) return null

  return <ImportedGLBModelInner url={url} category={category} />
}

// Target real-world longest dimension (in feet) by category
const CATEGORY_TARGET_FT: Record<string, number> = {
  car: 15,          // ~15ft long (typical sedan/sports car)
  motorcycle: 7,    // ~7ft long
  equipment: 4,     // ~4ft (toolbox, jack, etc.)
  furniture: 5,     // ~5ft (workbench, fridge, etc.)
}

function ImportedGLBModelInner({ url, category }: { url: string; category?: string }) {
  const { scene: gltfScene } = useGLTF(url)

  const { obj, scale } = useMemo(() => {
    const c = gltfScene.clone(true)
    c.traverse((o: any) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true }
    })

    const box = new THREE.Box3().setFromObject(c)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())

    if (size.lengthSq() < 0.0001) return { obj: c, scale: 1 }

    const maxDim = Math.max(size.x, size.y, size.z)
    const targetFt = CATEGORY_TARGET_FT[category ?? ''] ?? 10

    // Scale so the longest dimension matches the real-world target
    const s = targetFt / maxDim

    // Center XZ, sit on floor (bottom at Y=0)
    c.position.set(-center.x * s, -box.min.y * s, -center.z * s)

    return { obj: c, scale: s }
  }, [gltfScene, category])

  return <primitive object={obj} scale={scale} />
}

const ItemMesh = memo(function ItemMesh({ item, selected, wireframe, onClick, onPointerDown }: {
  item: PlacedItem; selected: boolean; wireframe: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const isImported = item.type.startsWith('imported:')
  const importedAssetId = isImported ? item.type.replace('imported:', '') : null

  const def = !isImported ? MODEL_CATALOG.find(m => m.type === item.type) : null
  const [px, , pz] = item.position
  const rotY = item.rotation[1]
  const tw = FT(def?.w ?? 72)
  const th = FT(def?.h ?? 54)
  const td = FT(def?.d ?? 144)
  const color = CATEGORY_COLORS[def?.category ?? 'car']

  const placeholder = (
    <mesh position={[0, th / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[tw, th, td]} />
      <meshLambertMaterial
        wireframe={wireframe} color={isImported ? '#8866cc' : color}
        emissive={selected ? '#4488bb' : '#000000'} emissiveIntensity={selected ? 0.3 : 0}
        transparent opacity={0.8}
      />
    </mesh>
  )

  const isLift = def?.category === 'car-lift'

  const [sx, sy, sz] = item.scale
  return (
    <group
      position={[px, 0, pz]}
      rotation={[0, rotY, 0]}
      scale={[sx, sy, sz]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      {isLift ? (
        <WildfireLift type={item.type} wireframe={wireframe} selected={selected} />
      ) : isImported && importedAssetId ? (
        <>
          <ModelErrorBoundary fallback={placeholder}>
            <Suspense fallback={placeholder}>
              <ImportedGLBModel assetId={importedAssetId} />
            </Suspense>
          </ModelErrorBoundary>
          {selected && (
            <mesh position={[0, th / 2, 0]}>
              <boxGeometry args={[tw + 0.08, th + 0.08, td + 0.08]} />
              <meshBasicMaterial color="#4af" wireframe transparent opacity={0.25} />
            </mesh>
          )}
        </>
      ) : (
        <>
          <ModelErrorBoundary fallback={placeholder}>
            <Suspense fallback={placeholder}>
              <GLBModel type={item.type} tw={tw} th={th} td={td} modelRotY={def?.modelRotY} />
            </Suspense>
          </ModelErrorBoundary>
          {selected && (
            <mesh position={[0, th / 2, 0]}>
              <boxGeometry args={[tw + 0.08, th + 0.08, td + 0.08]} />
              <meshBasicMaterial color="#4af" wireframe transparent opacity={0.25} />
            </mesh>
          )}
        </>
      )}
    </group>
  )
})

// ─── Main shell ───────────────────────────────────────────────────────────────
export default function GarageShell() {

  const {
    walls, shapes, floorPoints, ceilingHeight, garageWidth, garageDepth, flooringColor, floorTextureScale, floorReflection,
    slatwallPanels, selectedSlatwallPanelId,
    stainlessBacksplashPanels, selectedStainlessBacksplashPanelId, selectStainlessBacksplashPanel, updateStainlessBacksplashPanel,
    floorSteps, selectedFloorStepId, selectFloorStep, updateFloorStep: updateFloorStepAction,
    deleteFloorStep,
    cabinets, selectedCabinetId, selectCabinet, updateCabinet,
    countertops, selectedCountertopId, selectCountertop, updateCountertop,
    baseboards, selectedBaseboardId, selectBaseboard, updateBaseboard,
    stemWalls, selectedStemWallId, selectStemWall, updateStemWall,
    sceneLights, updateSceneLight,
    ceilingLights, selectedCeilingLightId, selectCeilingLight, updateCeilingLight,
    viewMode, selectedWallId, selectWall, selectShape, selectedShapeId,
    updateWall, updateShape, updateOpening, setFloorSelected, setIsDraggingWall, beginDrag, endDrag,
    updateSlatwallPanel, selectSlatwallPanel,
    items, selectedItemId, selectItem, updateItem,
    overheadRacks, selectedRackId, selectRack, updateRack,
    slatwallAccessories, selectedAccessoryId, selectSlatwallAccessory,
    qualityPreset, isExporting,
    cornerAngleLabelsVisible,
  } = useGarageStore()

  // Effective quality: always high during export
  const effectiveQuality = isExporting ? 'high' : qualityPreset

  const { camera, gl } = useThree()
  const wireframe = viewMode === 'wireframe'
  const topView   = viewMode === 'top'
  // In top (blueprint) view, use flat dark outlines on white background
  const blueprint = topView

  // Track the floor point directly below the camera each frame (spawn target for new items).
  // Using camera.position XZ is simpler and never explodes at oblique angles.
  useFrame(() => {
    const dir = new THREE.Vector3()
    camera.getWorldDirection(dir)
    if (dir.y < -0.05) {
      // Camera is looking downward — intersect floor plane
      const t = -camera.position.y / dir.y
      cameraFloorPos.x = (camera.position.x + dir.x * t) * 12
      cameraFloorPos.z = (camera.position.z + dir.z * t) * 12
    } else {
      // Camera looking horizontal/up — use camera XZ as fallback
      cameraFloorPos.x = camera.position.x * 12
      cameraFloorPos.z = camera.position.z * 12
    }
  })
  const showDims  = viewMode === 'top' || viewMode === 'wireframe'

  // Keyboard shortcuts: Esc=deselect, R=rotate selected 90°, Delete=remove selected
  const { deleteWall, deleteShape, deleteCabinet, deleteCountertop, deleteSlatwallPanel: deleteSlatPanel, deleteFloorStep: delFloorStep, deleteCeilingLight, removeItem, deleteRack } = useGarageStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') {
        selectWall(null); selectShape(null); selectSlatwallPanel(null); selectCabinet(null); selectCountertop(null); selectFloorStep(null); setFloorSelected(false); selectItem(null); selectCeilingLight(null); selectRack(null)
      }
      // R = rotate selected cabinet or item 90°
      if (e.key === 'r' || e.key === 'R') {
        const cabId = useGarageStore.getState().selectedCabinetId
        if (cabId) {
          const cab = useGarageStore.getState().cabinets.find(c => c.id === cabId)
          if (cab && !cab.locked) updateCabinet(cabId, { rotY: cab.rotY + Math.PI / 2 })
          return
        }
        const itemId = useGarageStore.getState().selectedItemId
        if (itemId) {
          const item = useGarageStore.getState().items.find(i => i.id === itemId)
          if (item) updateItem(itemId, { rotation: [item.rotation[0], item.rotation[1] + Math.PI / 2, item.rotation[2]] })
          return
        }
        const ctId = useGarageStore.getState().selectedCountertopId
        if (ctId) {
          const ct = useGarageStore.getState().countertops.find(c => c.id === ctId)
          if (ct && !ct.locked) updateCountertop(ctId, { rotY: ct.rotY + Math.PI / 2 })
          return
        }
        const lightId = useGarageStore.getState().selectedCeilingLightId
        if (lightId) {
          const light = useGarageStore.getState().ceilingLights.find(l => l.id === lightId)
          if (light) updateCeilingLight(lightId, { rotY: light.rotY + Math.PI / 2 })
          return
        }
        const rackId = useGarageStore.getState().selectedRackId
        if (rackId) {
          const rack = useGarageStore.getState().overheadRacks.find(r => r.id === rackId)
          if (rack && !rack.locked) updateRack(rackId, { rotY: rack.rotY + Math.PI / 2 })
        }
      }
      // Delete/Backspace = remove selected object
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const state = useGarageStore.getState()
        if (state.selectedCabinetId) { const c = state.cabinets.find(c => c.id === state.selectedCabinetId); if (c && !c.locked) deleteCabinet(state.selectedCabinetId) }
        else if (state.selectedItemId) removeItem(state.selectedItemId)
        else if (state.selectedShapeId) deleteShape(state.selectedShapeId)
        else if (state.selectedCountertopId) { const c = state.countertops.find(c => c.id === state.selectedCountertopId); if (c && !c.locked) deleteCountertop(state.selectedCountertopId) }
        else if (state.selectedSlatwallPanelId) deleteSlatPanel(state.selectedSlatwallPanelId)
        else if (state.selectedFloorStepId) delFloorStep(state.selectedFloorStepId)
        else if (state.selectedCeilingLightId) deleteCeilingLight(state.selectedCeilingLightId)
        else if (state.selectedRackId) { const r = state.overheadRacks.find(r => r.id === state.selectedRackId); if (r && !r.locked) deleteRack(state.selectedRackId) }
        else if (state.selectedWallId) deleteWall(state.selectedWallId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectWall, selectShape, selectSlatwallPanel, selectCabinet, setFloorSelected, selectItem, selectCountertop, selectFloorStep, selectCeilingLight, selectRack, updateCabinet, updateItem, updateCountertop, updateCeilingLight, updateRack, deleteWall, deleteCabinet, removeItem, deleteShape, deleteCountertop, deleteSlatPanel, delFloorStep, deleteCeilingLight, deleteRack])

  // Derive floor polygon from wall footprint — falls back to convex hull, then stored floorPoints
  const effectiveFloorPts = useMemo(
    () => effectiveFloorPolygon(walls, floorPoints),
    [walls, floorPoints],
  )

  // Always-fresh refs
  const wallsRef        = useRef(walls);                    useEffect(() => { wallsRef.current = walls }, [walls])
  const racksRef        = useRef(overheadRacks);              useEffect(() => { racksRef.current = overheadRacks }, [overheadRacks])
  const shapesRef       = useRef(shapes);                   useEffect(() => { shapesRef.current = shapes }, [shapes])
  const floorPtsRef     = useRef(effectiveFloorPts);        useEffect(() => { floorPtsRef.current = effectiveFloorPts }, [effectiveFloorPts])
  const slatsRef        = useRef(slatwallPanels);  useEffect(() => { slatsRef.current = slatwallPanels }, [slatwallPanels])
  const backsplashesRef = useRef(stainlessBacksplashPanels); useEffect(() => { backsplashesRef.current = stainlessBacksplashPanels }, [stainlessBacksplashPanels])
  const cabinetsRef     = useRef(cabinets);         useEffect(() => { cabinetsRef.current = cabinets }, [cabinets])
  const updateWallRef   = useRef(updateWall);      useEffect(() => { updateWallRef.current = updateWall }, [updateWall])
  const updateShapeRef  = useRef(updateShape);     useEffect(() => { updateShapeRef.current = updateShape }, [updateShape])
  const updateOpeningRef = useRef(updateOpening);  useEffect(() => { updateOpeningRef.current = updateOpening }, [updateOpening])
  const updateSlatRef       = useRef(updateSlatwallPanel); useEffect(() => { updateSlatRef.current = updateSlatwallPanel }, [updateSlatwallPanel])
  const updateBacksplashRef = useRef(updateStainlessBacksplashPanel); useEffect(() => { updateBacksplashRef.current = updateStainlessBacksplashPanel }, [updateStainlessBacksplashPanel])
  const slatwallPanelsRef   = useRef(slatwallPanels);      useEffect(() => { slatwallPanelsRef.current = slatwallPanels }, [slatwallPanels])
  const updateCabRef    = useRef(updateCabinet);    useEffect(() => { updateCabRef.current = updateCabinet }, [updateCabinet])
  const countertopsRef  = useRef(countertops);       useEffect(() => { countertopsRef.current = countertops }, [countertops])
  const updateCtRef     = useRef(updateCountertop);  useEffect(() => { updateCtRef.current = updateCountertop }, [updateCountertop])
  const baseboardsRef   = useRef(baseboards);        useEffect(() => { baseboardsRef.current = baseboards }, [baseboards])
  const updateBbRef     = useRef(updateBaseboard);   useEffect(() => { updateBbRef.current = updateBaseboard }, [updateBaseboard])
  const stemWallsRef    = useRef(stemWalls);         useEffect(() => { stemWallsRef.current = stemWalls }, [stemWalls])
  const updateSwRef     = useRef(updateStemWall);    useEffect(() => { updateSwRef.current = updateStemWall }, [updateStemWall])
  const updateLightRef    = useRef(updateSceneLight);    useEffect(() => { updateLightRef.current = updateSceneLight }, [updateSceneLight])
  const ceilingLightsRef  = useRef(ceilingLights);       useEffect(() => { ceilingLightsRef.current = ceilingLights }, [ceilingLights])
  const updateCeilLtRef   = useRef(updateCeilingLight);  useEffect(() => { updateCeilLtRef.current = updateCeilingLight }, [updateCeilingLight])
  const itemsRef          = useRef(items);               useEffect(() => { itemsRef.current = items }, [items])
  const updateItemRef     = useRef(updateItem);          useEffect(() => { updateItemRef.current = updateItem }, [updateItem])
  const floorStepsRef     = useRef(floorSteps);         useEffect(() => { floorStepsRef.current = floorSteps }, [floorSteps])
  const updateFloorStepRef = useRef(updateFloorStepAction); useEffect(() => { updateFloorStepRef.current = updateFloorStepAction }, [updateFloorStepAction])

  // Keep camera ref fresh (changes when switching view modes)
  const cameraRef = useRef(camera)
  useEffect(() => { cameraRef.current = camera }, [camera])

  // Drag refs
  const wallDragRef       = useRef<WallDragState | null>(null)
  const shapeDragRef      = useRef<ShapeDragState | null>(null)
  const floorPointDragRef = useRef<FloorPointDragState | null>(null)
  const vertDragRef       = useRef<VertDragState | null>(null)
  const openingDragRef      = useRef<OpeningDragState | null>(null)
  const openingCornerDragRef = useRef<OpeningCornerDragState | null>(null)
  const slatBodyDragRef     = useRef<SlatwallBodyDragState | null>(null)
  const slatCornerDragRef   = useRef<SlatwallCornerDragState | null>(null)
  const backsplashBodyDragRef   = useRef<SlatwallBodyDragState | null>(null)
  const backsplashCornerDragRef = useRef<SlatwallCornerDragState | null>(null)
  const cabinetDragRef      = useRef<CabinetDragState | null>(null)
  // Direct mesh mutation: registry of cabinet Three.js groups + transient drag position
  const cabinetGroupRefs    = useRef<Record<string, THREE.Group>>({})
  const cabinetDragPosRef   = useRef<{ x: number; z: number; y: number; rotY: number } | null>(null)
  const registerCabinetGroup = useCallback((id: string, group: THREE.Group | null) => {
    if (group) cabinetGroupRefs.current[id] = group
    else delete cabinetGroupRefs.current[id]
  }, [])
  const countertopDragRef   = useRef<CountertopDragState | null>(null)
  // Baseboard / stem-wall drag: body move OR end-handle resize. Same shape
  // because both are length-along-wall pieces with the same drag mechanics —
  // the only difference is the snap target (interior face vs inset past it).
  const baseboardDragRef    = useRef<{
    bbId: string
    kind: 'baseboard' | 'stemwall'
    mode: 'move' | 'resize'
    side?: 'left' | 'right'   // resize only
    ux: number; uz: number    // along-axis unit vector (length axis)
    // Move: original center + initial floor hit point (inches)
    startX?: number; startZ?: number
    startHitX?: number; startHitZ?: number
    // Resize: fixed end (inches) opposite the dragging end
    fixedX?: number; fixedZ?: number
  } | null>(null)
  const lightDragRef        = useRef<LightDragState | null>(null)
  const ceilingLightDragRef = useRef<CeilingLightDragState | null>(null)
  const ledbarResizeRef     = useRef<{ lightId: string; side: 'left' | 'right'; ux: number; uz: number; fixedX: number; fixedZ: number } | null>(null)
  const itemDragRef         = useRef<{ itemId: string; startXFt: number; startZFt: number; startHitX: number; startHitZ: number } | null>(null)
  const rackDragRef         = useRef<{ rackId: string; startXIn: number; startZIn: number; startHitX: number; startHitZ: number } | null>(null)
  const floorStepDragRef    = useRef<FloorStepDragState | null>(null)
  const floorStepCornerDragRef = useRef<FloorStepCornerDragState | null>(null)
  const suppressNextClick   = useRef(false)

  // Opening (door/window) currently being edited in the 3D view. When non-null,
  // the parent wall's highlight (color tint, face overlays, endpoint handles)
  // is suppressed so only the opening appears "selected". Cleared when the
  // user clicks elsewhere or the selected wall/opening goes away.
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null)

  // Wall-endpoint snap target in world inches, set whenever the current
  // wall drag is locked onto a discrete snap point (centerline endpoint or
  // face corner). Rendered as a bright ring so the snap is unmistakably
  // visible — and so users can confirm the endpoint landed on the target
  // they wanted (the drag handle itself sits on the wall endpoint).
  const [wallSnapTarget, setWallSnapTarget] = useState<[number, number] | null>(null)
  // Sync: drop the selected opening if its parent wall is no longer selected or
  // the opening itself was deleted.
  useEffect(() => {
    if (!selectedOpeningId) return
    const wall = walls.find(w => w.id === selectedWallId)
    if (!wall || !wall.openings.some(o => o.id === selectedOpeningId)) {
      setSelectedOpeningId(null)
    }
  }, [selectedWallId, selectedOpeningId, walls])

  // Snap indicator lines for visual feedback during drag
  const [snapLines, setSnapLines] = useState<{ from: [number, number, number]; to: [number, number, number]; color: string }[]>([])

  // Modifier key tracking — Shift disables snap, held state tracked via refs for perf
  const modKeysRef = useRef({ shift: false, ctrl: false })
  // Global snapping toggle (from store) mirrored into a ref for cheap reads
  // inside pointer-move handlers without triggering re-renders.
  const snappingDisabledRef = useRef(false)
  const snappingEnabled = useGarageStore(s => s.snappingEnabled)
  useEffect(() => { snappingDisabledRef.current = !snappingEnabled }, [snappingEnabled])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') modKeysRef.current.shift = true
      if (e.key === 'Control') modKeysRef.current.ctrl = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') modKeysRef.current.shift = false
      if (e.key === 'Control') modKeysRef.current.ctrl = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // Always-current ref for selected wall — used in pointer handlers to avoid stale closures
  const selectedWallIdRef = useRef<string | null>(selectedWallId)
  useEffect(() => { selectedWallIdRef.current = selectedWallId }, [selectedWallId])

  const floorPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), [])
  const ray = useMemo(() => new THREE.Raycaster(), [])

  const floorHit = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width)  *  2 - 1,
      ((clientY - rect.top)  / rect.height) * -2 + 1,
    )
    ray.setFromCamera(ndc, camera)
    const target = new THREE.Vector3()
    return ray.ray.intersectPlane(floorPlane, target) ? target : null
  }, [camera, gl, ray, floorPlane])

  const ceilingHit = useCallback((clientX: number, clientY: number, chFt: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width)  *  2 - 1,
      ((clientY - rect.top)  / rect.height) * -2 + 1,
    )
    ray.setFromCamera(ndc, camera)
    const ceilPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), chFt)
    const target = new THREE.Vector3()
    return ray.ray.intersectPlane(ceilPlane, target) ? target : null
  }, [camera, gl, ray])

  // Raycast against all wall face planes (both sides of each wall), bounded by
  // wall segment length + wall height range. Returns world-space hit in FEET
  // plus wall reference, which face side was hit, and along-axis param (inches).
  const wallFaceHit = useCallback((
    clientX: number, clientY: number, walls: GarageWall[],
  ): {
    point: THREE.Vector3    // world feet
    wall: GarageWall
    side: 1 | -1             // which face normal direction was hit
    along: number            // inches from wall.x1/z1 along wall axis
    yIn: number              // height in inches (world Y)
    dist: number             // ray distance from camera (feet) — for surface-closer-than-floor test
  } | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width)  *  2 - 1,
      ((clientY - rect.top)  / rect.height) * -2 + 1,
    )
    ray.setFromCamera(ndc, camera)

    let best: { point: THREE.Vector3; wall: GarageWall; side: 1 | -1; along: number; yIn: number; dist: number } | null = null
    const tmpPlane = new THREE.Plane()
    const tmpPt = new THREE.Vector3()
    const tmpNormal = new THREE.Vector3()

    for (const wall of walls) {
      const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
      const lenIn = Math.hypot(dx, dz)
      if (lenIn < 1) continue
      const ux = dx / lenIn, uz = dz / lenIn           // unit along wall
      const nxs = -uz, nzs = ux                        // wall normal (store/world XZ share sign)
      // Each wall has two faces (one per side). Test both.
      for (const side of [1, -1] as const) {
        const faceX = (wall.x1 + wall.x2) / 2 + side * (wall.thickness / 2) * nxs
        const faceZ = (wall.z1 + wall.z2) / 2 + side * (wall.thickness / 2) * nzs
        tmpNormal.set(side * nxs, 0, side * nzs).normalize()
        tmpPlane.setFromNormalAndCoplanarPoint(tmpNormal, new THREE.Vector3(FT(faceX), 0, FT(faceZ)))
        if (!ray.ray.intersectPlane(tmpPlane, tmpPt)) continue

        const hitXIn = tmpPt.x * 12
        const hitZIn = tmpPt.z * 12
        const along = (hitXIn - wall.x1) * ux + (hitZIn - wall.z1) * uz
        if (along < -2 || along > lenIn + 2) continue  // outside segment

        const yIn = tmpPt.y * 12
        const wallBottomIn = wall.yOffset
        const wallTopIn = wall.yOffset + wall.height
        if (yIn < wallBottomIn - 2 || yIn > wallTopIn + 2) continue  // outside height range

        const dist = tmpPt.distanceTo(ray.ray.origin)
        if (!best || dist < best.dist) {
          best = { point: tmpPt.clone(), wall, side, along, yIn, dist }
        }
      }
    }
    return best
  }, [camera, gl, ray])

  // ── Start wall drag ──────────────────────────────────────────────────────
  const startWallDrag = useCallback((
    wallId: string, endpoint: 'start' | 'end' | 'body',
    e: ThreeEvent<PointerEvent>,
  ) => {
    if (e.nativeEvent.button !== 0) return
    const wall = wallsRef.current.find(w => w.id === wallId)
    if (!wall || wall.locked) return
    e.stopPropagation()
    // Prevent OrbitControls from seeing this pointer event
    e.nativeEvent.stopImmediatePropagation()

    const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
    const hitX = hit ? hit.x * 12 : (endpoint === 'start' ? wall.x1 : endpoint === 'end' ? wall.x2 : (wall.x1 + wall.x2) / 2)
    const hitZ = hit ? hit.z * 12 : (endpoint === 'start' ? wall.z1 : endpoint === 'end' ? wall.z2 : (wall.z1 + wall.z2) / 2)
    wallDragRef.current = {
      wallId, endpoint,
      hitX, hitZ,
      initX1: wall.x1, initZ1: wall.z1,
      initX2: wall.x2, initZ2: wall.z2,
    }
    beginDrag()
  }, [beginDrag, floorHit])


  // ── Start item drag ──────────────────────────────────────────────────────
  const startItemDrag = useCallback((itemId: string, e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    const item = itemsRef.current.find(i => i.id === itemId)
    if (!item) return
    const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
    itemDragRef.current = {
      itemId,
      startXFt: item.position[0], startZFt: item.position[2],
      startHitX: hit ? hit.x : item.position[0],
      startHitZ: hit ? hit.z : item.position[2],
    }
    beginDrag()
  }, [beginDrag, floorHit])

  // ── Start floor step drag ────────────────────────────────────────────────
  const startFloorStepDrag = useCallback((stepId: string, e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    selectFloorStep(stepId)   // select immediately on pointerdown (same pattern as walls/cabinets)
    const step = floorStepsRef.current.find(s => s.id === stepId)
    if (!step) return
    if (step.locked) return
    const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
    if (!hit) return
    floorStepDragRef.current = {
      stepId,
      hitX: hit.x, hitZ: hit.z,
      initCorners: step.corners.map(c => [...c] as [number, number]),
    }
    beginDrag()
  }, [floorHit, beginDrag, selectFloorStep])

  // ── Start floor step corner drag ────────────────────��───────────────────
  const startFloorStepCornerDrag = useCallback((
    stepId: string, corner: number,
    e: ThreeEvent<PointerEvent>,
  ) => {
    if (e.nativeEvent.button !== 0) return
    const step = floorStepsRef.current.find(s => s.id === stepId)
    if (step?.locked) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    floorStepCornerDragRef.current = { stepId, cornerIdx: corner }
    selectFloorStep(stepId)
    beginDrag()
  }, [selectFloorStep, beginDrag])

  const addFloorStepCorner = useCallback((stepId: string, afterIdx: number) => {
    const step = floorStepsRef.current.find(s => s.id === stepId)
    if (!step) return
    if (step.locked) return
    const [ax, az] = step.corners[afterIdx]
    const [bx, bz] = step.corners[(afterIdx + 1) % step.corners.length]
    const newCorners = [...step.corners]
    newCorners.splice(afterIdx + 1, 0, [(ax + bx) / 2, (az + bz) / 2])
    updateFloorStepRef.current(stepId, { corners: newCorners })
  }, [])

  const removeFloorStepCorner = useCallback((stepId: string, idx: number) => {
    const step = floorStepsRef.current.find(s => s.id === stepId)
    if (!step || step.corners.length <= 3) return
    if (step.locked) return
    const newCorners = step.corners.filter((_, i) => i !== idx)
    updateFloorStepRef.current(stepId, { corners: newCorners })
  }, [])

  // ── Start opening (door/window) drag — slide along the wall ──────────────
  const startOpeningDrag = useCallback((wallId: string, openingId: string, e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    const wall = wallsRef.current.find(w => w.id === wallId)
    if (!wall || wall.locked) return
    const op = wall.openings.find(o => o.id === openingId)
    if (!op) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    selectWall(wallId)
    setSelectedOpeningId(openingId)

    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 1) return
    const ux = dx / len, uz = dz / len
    const nx = -uz, nz = ux
    const midXFt = FT((wall.x1 + wall.x2) / 2)
    const midZFt = FT((wall.z1 + wall.z2) / 2)
    // Drag plane is the wall centerline (vertical plane through the wall axis).
    // Using the centerline keeps the along-wall mapping independent of which
    // side of the wall the user clicked, so the door follows the cursor cleanly.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(nx, 0, nz),
      new THREE.Vector3(midXFt, 0, midZFt),
    )

    const relHitX = e.point.x - midXFt, relHitZ = e.point.z - midZFt
    const hitAlongIn = (relHitX * ux + relHitZ * uz) * 12 + len / 2

    openingDragRef.current = {
      wallId, openingId, plane,
      wallMidX: midXFt, wallMidZ: midZFt,
      wallUx: ux, wallUz: uz,
      wallLenIn: len,
      startXOffsetIn: op.xOffset,
      widthIn: op.width,
      hitAlongIn,
      startYOffsetIn: op.yOffset,
      heightIn: op.height,
      hitYIn: e.point.y * 12,
      wallHeightIn: wall.height,
    }
    beginDrag()
  }, [selectWall, beginDrag])

  // ── Start opening corner drag (resize) — top-left or top-right handle ────
  const startOpeningCornerDrag = useCallback((
    wallId: string, openingId: string, corner: 'tl' | 'tr',
    e: ThreeEvent<PointerEvent>,
  ) => {
    if (e.nativeEvent.button !== 0) return
    const wall = wallsRef.current.find(w => w.id === wallId)
    if (!wall || wall.locked) return
    const op = wall.openings.find(o => o.id === openingId)
    if (!op) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    selectWall(wallId)
    setSelectedOpeningId(openingId)

    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    if (len < 1) return
    const ux = dx / len, uz = dz / len
    const nx = -uz, nz = ux
    const midXFt = FT((wall.x1 + wall.x2) / 2)
    const midZFt = FT((wall.z1 + wall.z2) / 2)
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(nx, 0, nz),
      new THREE.Vector3(midXFt, 0, midZFt),
    )

    openingCornerDragRef.current = {
      wallId, openingId, corner, plane,
      wallMidX: midXFt, wallMidZ: midZFt,
      wallUx: ux, wallUz: uz,
      wallLenIn: len,
      // The OPPOSITE side stays anchored during the drag.
      fixedSideIn: corner === 'tl' ? op.xOffset + op.width : op.xOffset,
      bottomIn: op.yOffset,
    }
    beginDrag()
  }, [selectWall, beginDrag])

  // ── Start slatwall body drag ─────────────────────────────────────────────
  const startSlatwallBodyDrag = useCallback((panelId: string, e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    const panel = slatsRef.current.find(p => p.id === panelId)
    if (!panel) return
    const wall = wallsRef.current.find(w => w.id === panel.wallId)
    if (!wall) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    selectSlatwallPanel(panelId)

    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    const nx = -dz / len, nz = dx / len
    const midXFt = FT((wall.x1 + wall.x2) / 2)
    const midZFt = FT((wall.z1 + wall.z2) / 2)
    const planePt = new THREE.Vector3(
      midXFt + nx * FT(wall.thickness / 2 + 1),
      FT((panel.yBottom + panel.yTop) / 2),
      midZFt + nz * FT(wall.thickness / 2 + 1),
    )
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(nx, 0, nz), planePt)

    // Use the actual mouse hit point (e.point is reliable on the mesh surface)
    const relHitX = e.point.x - midXFt, relHitZ = e.point.z - midZFt
    const hitAlong  = (relHitX * (dx / len) + relHitZ * (dz / len)) * 12 + len / 2
    const hitHeight = e.point.y * 12

    const { startTrim, endTrim } = computeCornerAdj(wall, wallsRef.current)
    slatBodyDragRef.current = {
      panelId, plane,
      wallMidX: midXFt, wallMidZ: midZFt,
      wallUx: dx / len, wallUz: dz / len,
      wallLenIn: len,
      startTrimIn: startTrim, endTrimIn: endTrim,
      startAlongIn: panel.alongStart, endAlongIn: panel.alongEnd,
      startYBottom: panel.yBottom, startYTop: panel.yTop,
      hitAlongIn: hitAlong, hitHeightIn: hitHeight,
      wallId: wall.id,
    }
    beginDrag()
  }, [selectSlatwallPanel, beginDrag])

  // ── Start slatwall corner drag ───────────────────────────────────────────
  const startSlatwallCornerDrag = useCallback((
    panelId: string, corner: 0 | 1 | 2 | 3,
    e: ThreeEvent<PointerEvent>,
  ) => {
    if (e.nativeEvent.button !== 0) return
    const panel = slatsRef.current.find(p => p.id === panelId)
    if (!panel) return
    const wall = wallsRef.current.find(w => w.id === panel.wallId)
    if (!wall) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    const nx = -dz / len, nz = dx / len  // interior face normal
    const midXFt = FT((wall.x1 + wall.x2) / 2)
    const midZFt = FT((wall.z1 + wall.z2) / 2)
    const planePt = new THREE.Vector3(
      midXFt + nx * FT(wall.thickness / 2 + 1),
      FT((panel.yBottom + panel.yTop) / 2),
      midZFt + nz * FT(wall.thickness / 2 + 1),
    )
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(nx, 0, nz), planePt
    )
    const { startTrim: cST, endTrim: cET } = computeCornerAdj(wall, wallsRef.current)
    slatCornerDragRef.current = {
      panelId, corner, plane,
      wallMidX: midXFt, wallMidZ: midZFt,
      wallUx: dx / len, wallUz: dz / len,
      wallLenIn: len,
      startTrimIn: cST,
      endTrimIn: cET,
      wallId: wall.id,
    }
    selectSlatwallPanel(panelId)
    beginDrag()
  }, [beginDrag, selectSlatwallPanel])

  // ── Start backsplash body drag ───────────────────────────────────────────
  const startBacksplashBodyDrag = useCallback((panelId: string, e: ThreeEvent<PointerEvent>) => {
    if (e.nativeEvent.button !== 0) return
    const panel = backsplashesRef.current.find(p => p.id === panelId)
    if (!panel) return
    const wall = wallsRef.current.find(w => w.id === panel.wallId)
    if (!wall) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    selectStainlessBacksplashPanel(panelId)

    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    const sideSign = (panel.side ?? 'interior') === 'exterior' ? -1 : 1
    const nx = sideSign * (-dz / len), nz = sideSign * (dx / len)
    const midXFt = FT((wall.x1 + wall.x2) / 2)
    const midZFt = FT((wall.z1 + wall.z2) / 2)
    const planePt = new THREE.Vector3(
      midXFt + nx * FT(wall.thickness / 2 + 0.5),
      FT((panel.yBottom + panel.yTop) / 2),
      midZFt + nz * FT(wall.thickness / 2 + 0.5),
    )
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(nx, 0, nz), planePt)

    const relHitX = e.point.x - midXFt, relHitZ = e.point.z - midZFt
    const hitAlong  = (relHitX * (dx / len) + relHitZ * (dz / len)) * 12 + len / 2
    const hitHeight = e.point.y * 12

    const { startTrim, endTrim } = computeCornerAdj(wall, wallsRef.current)
    backsplashBodyDragRef.current = {
      panelId, plane,
      wallMidX: midXFt, wallMidZ: midZFt,
      wallUx: dx / len, wallUz: dz / len,
      wallLenIn: len,
      startTrimIn: startTrim, endTrimIn: endTrim,
      startAlongIn: panel.alongStart, endAlongIn: panel.alongEnd,
      startYBottom: panel.yBottom, startYTop: panel.yTop,
      hitAlongIn: hitAlong, hitHeightIn: hitHeight,
      wallId: wall.id,
    }
    beginDrag()
  }, [selectStainlessBacksplashPanel, beginDrag])

  // ── Start backsplash corner drag ─────────────────────────────────────────
  const startBacksplashCornerDrag = useCallback((
    panelId: string, corner: 0 | 1 | 2 | 3,
    e: ThreeEvent<PointerEvent>,
  ) => {
    if (e.nativeEvent.button !== 0) return
    const panel = backsplashesRef.current.find(p => p.id === panelId)
    if (!panel) return
    const wall = wallsRef.current.find(w => w.id === panel.wallId)
    if (!wall) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()

    const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
    const len = Math.hypot(dx, dz)
    const sideSign = (panel.side ?? 'interior') === 'exterior' ? -1 : 1
    const nx = sideSign * (-dz / len), nz = sideSign * (dx / len)
    const midXFt = FT((wall.x1 + wall.x2) / 2)
    const midZFt = FT((wall.z1 + wall.z2) / 2)
    const planePt = new THREE.Vector3(
      midXFt + nx * FT(wall.thickness / 2 + 0.5),
      FT((panel.yBottom + panel.yTop) / 2),
      midZFt + nz * FT(wall.thickness / 2 + 0.5),
    )
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      new THREE.Vector3(nx, 0, nz), planePt
    )
    const { startTrim: cST, endTrim: cET } = computeCornerAdj(wall, wallsRef.current)
    backsplashCornerDragRef.current = {
      panelId, corner, plane,
      wallMidX: midXFt, wallMidZ: midZFt,
      wallUx: dx / len, wallUz: dz / len,
      wallLenIn: len,
      startTrimIn: cST,
      endTrimIn: cET,
      wallId: wall.id,
    }
    selectStainlessBacksplashPanel(panelId)
    beginDrag()
  }, [beginDrag, selectStainlessBacksplashPanel])

  // ── Raw DOM move/up handlers ─────────────────────────────────────────────
  useEffect(() => {
    const canvas = gl.domElement

    // Track pointer capture state to ensure we capture on first drag move
    let hasCaptured = false

    // RAF-throttle: only process the latest pointer position once per animation frame
    let rafId = 0
    let latestMoveEvent: PointerEvent | null = null

    const processMove = () => {
      rafId = 0
      const e = latestMoveEvent
      if (!e) return
      latestMoveEvent = null
      onMoveInner(e)
    }

    const onMove = (e: PointerEvent) => {
      // Capture pointer on first drag move to prevent dropped drags during fast mouse movement
      const isDragging = wallDragRef.current || shapeDragRef.current || floorPointDragRef.current ||
        vertDragRef.current || slatBodyDragRef.current || slatCornerDragRef.current ||
        backsplashBodyDragRef.current || backsplashCornerDragRef.current ||
        cabinetDragRef.current || countertopDragRef.current || baseboardDragRef.current || lightDragRef.current ||
        ceilingLightDragRef.current || itemDragRef.current || rackDragRef.current || floorStepDragRef.current || floorStepCornerDragRef.current ||
        openingDragRef.current || openingCornerDragRef.current
      if (isDragging && !hasCaptured) {
        try { canvas.setPointerCapture(e.pointerId); hasCaptured = true } catch (_) {}
      }
      // Queue for next animation frame — drop intermediate events
      latestMoveEvent = e
      if (!rafId) rafId = requestAnimationFrame(processMove)
    }

    const onMoveInner = (e: PointerEvent) => {

      // Vertical shape drag — handled before floor intersection (doesn't need floor hit)
      const vd = vertDragRef.current
      if (vd) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(vd.plane, hitPt)) {
          const deltaYIn = (hitPt.y - vd.startHitY) * 12
          const shape = shapesRef.current.find(s => s.id === vd.shapeId)
          const minY = shape ? shape.h / 2 : 0
          const newY = Math.max(minY, snapToGrid(vd.startShapeY + deltaYIn))
          updateShapeRef.current(vd.shapeId, { y: newY })
        }
        return
      }

      // Opening corner drag — resize via top-left or top-right handle.
      const oc = openingCornerDragRef.current
      if (oc) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(oc.plane, hitPt)) {
          const relX = hitPt.x - oc.wallMidX, relZ = hitPt.z - oc.wallMidZ
          const curAlong = (relX * oc.wallUx + relZ * oc.wallUz) * 12 + oc.wallLenIn / 2
          const curY = hitPt.y * 12
          const MIN = 12
          const wall = wallsRef.current.find(w => w.id === oc.wallId)
          const wallTopIn = wall ? wall.yOffset + wall.height : oc.wallLenIn
          let newLeft: number, newRight: number
          if (oc.corner === 'tl') {
            newLeft  = snapToGrid(Math.max(0, Math.min(oc.fixedSideIn - MIN, curAlong)))
            newRight = oc.fixedSideIn
          } else {
            newLeft  = oc.fixedSideIn
            newRight = snapToGrid(Math.min(oc.wallLenIn, Math.max(oc.fixedSideIn + MIN, curAlong)))
          }
          const newTop = snapToGrid(
            Math.max(oc.bottomIn + MIN, Math.min(wallTopIn, curY)),
          )
          const newXOffset = newLeft
          const newWidth = newRight - newLeft
          const newHeight = newTop - oc.bottomIn
          updateOpeningRef.current(oc.wallId, oc.openingId, {
            xOffset: newXOffset, width: newWidth, height: newHeight,
          })
        }
        return
      }

      // Opening (door/window) drag — slide along the wall, preserve width.
      const od = openingDragRef.current
      if (od) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(od.plane, hitPt)) {
          const relX = hitPt.x - od.wallMidX, relZ = hitPt.z - od.wallMidZ
          const curAlong = (relX * od.wallUx + relZ * od.wallUz) * 12 + od.wallLenIn / 2
          const dAlong = curAlong - od.hitAlongIn
          let newX = snapToGrid(od.startXOffsetIn + dAlong)
          // ── Vertical drag ──
          const curYIn = hitPt.y * 12
          const dY = curYIn - od.hitYIn
          let newY = snapToGrid(od.startYOffsetIn + dY)
          const wall = wallsRef.current.find(w => w.id === od.wallId)
          if (!snappingDisabledRef.current && wall) {
            // ── Along-wall snap ──
            const others = wall.openings.filter(o => o.id !== od.openingId)
            const leftSnap = snapSpanToOpeningEdges(newX, newX + od.widthIn, others)
            newX = leftSnap.start
            const SNAP = 4
            const adjHT = (ex: number, ez: number): number => {
              let best = 0
              for (const o of wallsRef.current) {
                if (o.id === wall.id) continue
                if (
                  Math.hypot(o.x1 - ex, o.z1 - ez) < 6 ||
                  Math.hypot(o.x2 - ex, o.z2 - ez) < 6
                ) {
                  best = Math.max(best, o.thickness / 2)
                }
              }
              return best
            }
            const startInset = adjHT(wall.x1, wall.z1)
            const endInset = adjHT(wall.x2, wall.z2)
            const xCandidates: number[] = [
              0,
              startInset,
              od.wallLenIn - od.widthIn,
              od.wallLenIn - endInset - od.widthIn,
            ]
            for (const c of xCandidates) {
              if (Math.abs(newX - c) < SNAP) { newX = c; break }
            }

            // ── Vertical snap targets ──
            //   • Floor (0) or step-up top when a step covers this along-wall
            //     position (door must sit on top of the step).
            //   • Wall top minus door height (ceiling-flush).
            //   • Baseboard / stem-wall tops that span the door along-region.
            const opLeft = newX
            const opRight = newX + od.widthIn
            // Step coverage — use max height of steps whose projection on
            // this wall overlaps the door.
            let stepFloor = 0
            for (const step of floorStepsRef.current) {
              const bos = getStepWallOverlaps(wall, step, od.wallLenIn)
              for (const b of bos) {
                if (b.u1 > opLeft && b.u0 < opRight) {
                  stepFloor = Math.max(stepFloor, b.stepHeight)
                }
              }
            }
            // Baseboard / stem-wall tops — snap only if their along-wall
            // extent overlaps the door.
            const yCandidates: number[] = [stepFloor, od.wallHeightIn - od.heightIn]
            const pieces = [
              ...baseboardsRef.current.map(p => ({ ...p })),
              ...stemWallsRef.current.map(p => ({ ...p })),
            ]
            for (const bb of pieces) {
              const bos = getBaseboardWallOverlaps(wall, [{
                x: bb.x, z: bb.z, rotY: bb.rotY, length: bb.length,
                height: bb.height, y: bb.y, thickness: bb.thickness,
              }], od.wallLenIn)
              for (const b of bos) {
                if (b.u1 > opLeft && b.u0 < opRight) yCandidates.push(b.bbTop)
              }
            }
            const SNAP_Y = 4
            for (const c of yCandidates) {
              if (Math.abs(newY - c) < SNAP_Y) { newY = c; break }
            }
            // Floor constraint — door can't sit BELOW any step that overlaps it.
            if (newY < stepFloor) newY = stepFloor
          }
          // Clamp so opening stays fully inside the wall.
          newX = Math.max(0, Math.min(od.wallLenIn - od.widthIn, newX))
          newY = Math.max(0, Math.min(od.wallHeightIn - od.heightIn, newY))
          updateOpeningRef.current(od.wallId, od.openingId, { xOffset: newX, yOffset: newY })
        }
        return
      }

      // Slatwall body drag — slide panel along and up/down the wall
      const sbd = slatBodyDragRef.current
      if (sbd) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(sbd.plane, hitPt)) {
          const relX = hitPt.x - sbd.wallMidX, relZ = hitPt.z - sbd.wallMidZ
          const curAlong = (relX * sbd.wallUx + relZ * sbd.wallUz) * 12 + sbd.wallLenIn / 2
          const curHeight = hitPt.y * 12
          const dAlong = curAlong - sbd.hitAlongIn
          const dHeight = curHeight - sbd.hitHeightIn

          const panelW = sbd.endAlongIn - sbd.startAlongIn
          const panelH = sbd.startYTop - sbd.startYBottom
          const minA = sbd.startTrimIn, maxA = sbd.wallLenIn - sbd.endTrimIn

          let newStart = snapToGrid(sbd.startAlongIn + dAlong)
          let newEnd   = snapToGrid(sbd.endAlongIn   + dAlong)
          if (newStart < minA) { newStart = minA; newEnd = minA + panelW }
          if (newEnd   > maxA) { newEnd = maxA; newStart = maxA - panelW }

          // Look up wall live for ceiling + baseboard values
          const dragWall = wallsRef.current.find(w => w.id === sbd.wallId)
          const wallH    = dragWall?.height ?? 9999

          // Snap panel edges to door/window opening edges.
          if (dragWall && !snappingDisabledRef.current) {
            const snapped = snapSpanToOpeningEdges(newStart, newEnd, dragWall.openings)
            if (snapped.start >= minA && snapped.end <= maxA) {
              newStart = snapped.start; newEnd = snapped.end
            }
          }

          let newBottom = snapToGrid(sbd.startYBottom + dHeight)
          // Snap to baseboard/stemwall tops within 3"
          if (dragWall) {
            const wl = Math.hypot(dragWall.x2 - dragWall.x1, dragWall.z2 - dragWall.z1)
            const bos = getBaseboardWallOverlaps(dragWall, [...baseboardsRef.current, ...stemWallsRef.current], wl)
            for (const bo of bos) { if (Math.abs(newBottom - bo.bbTop) <= 3) { newBottom = bo.bbTop; break } }
          }
          // Clamp between floor (or baseboard) and ceiling
          newBottom = Math.max(0, Math.min(newBottom, wallH - panelH))
          const newTop = newBottom + panelH

          updateSlatRef.current(sbd.panelId, {
            alongStart: newStart, alongEnd: newEnd,
            yBottom: newBottom, yTop: newTop,
          })
        }
        return
      }

      // Backsplash body drag — slide panel along and up/down the wall
      const bbd = backsplashBodyDragRef.current
      if (bbd) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(bbd.plane, hitPt)) {
          const relX = hitPt.x - bbd.wallMidX, relZ = hitPt.z - bbd.wallMidZ
          const curAlong = (relX * bbd.wallUx + relZ * bbd.wallUz) * 12 + bbd.wallLenIn / 2
          const curHeight = hitPt.y * 12
          const dAlong = curAlong - bbd.hitAlongIn
          const dHeight = curHeight - bbd.hitHeightIn

          const panelW = bbd.endAlongIn - bbd.startAlongIn
          const panelH = bbd.startYTop - bbd.startYBottom
          const minA = bbd.startTrimIn, maxA = bbd.wallLenIn - bbd.endTrimIn

          let newStart = snapToGrid(bbd.startAlongIn + dAlong)
          let newEnd   = snapToGrid(bbd.endAlongIn   + dAlong)
          if (newStart < minA) { newStart = minA; newEnd = minA + panelW }
          if (newEnd   > maxA) { newEnd = maxA; newStart = maxA - panelW }

          const dragWall = wallsRef.current.find(w => w.id === bbd.wallId)
          const wallH    = dragWall?.height ?? 9999

          if (dragWall && !snappingDisabledRef.current) {
            const snapped = snapSpanToOpeningEdges(newStart, newEnd, dragWall.openings)
            if (snapped.start >= minA && snapped.end <= maxA) {
              newStart = snapped.start; newEnd = snapped.end
            }
          }

          let newBottom = snapToGrid(bbd.startYBottom + dHeight)
          if (dragWall) {
            const wl = Math.hypot(dragWall.x2 - dragWall.x1, dragWall.z2 - dragWall.z1)
            const bos = getBaseboardWallOverlaps(dragWall, [...baseboardsRef.current, ...stemWallsRef.current], wl)
            for (const bo of bos) { if (Math.abs(newBottom - bo.bbTop) <= 3) { newBottom = bo.bbTop; break } }
          }
          newBottom = Math.max(0, Math.min(newBottom, wallH - panelH))
          const newTop = newBottom + panelH

          updateBacksplashRef.current(bbd.panelId, {
            alongStart: newStart, alongEnd: newEnd,
            yBottom: newBottom, yTop: newTop,
          })
        }
        return
      }

      // Backsplash corner drag — uses wall-face plane, no floor hit needed
      const bsc = backsplashCornerDragRef.current
      if (bsc) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(bsc.plane, hitPt)) {
          const relX = hitPt.x - bsc.wallMidX
          const relZ = hitPt.z - bsc.wallMidZ
          const along   = snapToGrid((relX * bsc.wallUx + relZ * bsc.wallUz) * 12 + bsc.wallLenIn / 2)
          const heightIn = snapToGrid(hitPt.y * 12)
          const panel = backsplashesRef.current.find(p => p.id === bsc.panelId)
          const cWall = wallsRef.current.find(w => w.id === bsc.wallId)
          if (panel && cWall) {
            const wallH = cWall.height
            const changes: Partial<StainlessBacksplashPanel> = {}
            const minAlong = bsc.startTrimIn
            const maxAlong = bsc.wallLenIn - bsc.endTrimIn
            if (bsc.corner === 0 || bsc.corner === 3) {
              changes.alongStart = Math.max(minAlong, Math.min(along, panel.alongEnd - 6))
            } else {
              changes.alongEnd = Math.max(panel.alongStart + 6, Math.min(along, maxAlong))
            }
            if (bsc.corner === 0 || bsc.corner === 1) {
              changes.yTop = Math.max(panel.yBottom + 6, Math.min(heightIn, wallH))
            } else {
              changes.yBottom = Math.max(0, Math.min(heightIn, panel.yTop - 6))
            }
            updateBacksplashRef.current(bsc.panelId, changes)
          }
        }
        return
      }

      // Slatwall corner drag — uses wall-face plane, no floor hit needed
      const sc = slatCornerDragRef.current
      if (sc) {
        const rect = gl.domElement.getBoundingClientRect()
        const ndc = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          ((e.clientY - rect.top)  / rect.height) * -2 + 1,
        )
        ray.setFromCamera(ndc, cameraRef.current)
        const hitPt = new THREE.Vector3()
        if (ray.ray.intersectPlane(sc.plane, hitPt)) {
          const relX = hitPt.x - sc.wallMidX
          const relZ = hitPt.z - sc.wallMidZ
          const along   = snapToGrid((relX * sc.wallUx + relZ * sc.wallUz) * 12 + sc.wallLenIn / 2)
          const heightIn = snapToGrid(hitPt.y * 12)
          const panel = slatsRef.current.find(p => p.id === sc.panelId)
          const cWall = wallsRef.current.find(w => w.id === sc.wallId)
          if (panel && cWall) {
            const wallH = cWall.height
            const changes: Partial<SlatwallPanel> = {}
            const minAlong = sc.startTrimIn
            const maxAlong = sc.wallLenIn - sc.endTrimIn
            if (sc.corner === 0 || sc.corner === 3) {
              changes.alongStart = Math.max(minAlong, Math.min(along, panel.alongEnd - 6))
            } else {
              changes.alongEnd = Math.max(panel.alongStart + 6, Math.min(along, maxAlong))
            }
            if (sc.corner === 0 || sc.corner === 1) {
              // top handle — clamp to wall ceiling
              changes.yTop = Math.max(panel.yBottom + 6, Math.min(heightIn, wallH))
            } else {
              // bottom handle — clamp to floor
              changes.yBottom = Math.max(0, Math.min(heightIn, panel.yTop - 6))
            }
            updateSlatRef.current(sc.panelId, changes)
          }
        }
        return
      }

      // LED bar resize drag — drag an end handle to change length.
      // Opposite end stays fixed. Works in feet throughout. lengthIn stored
      // in inches (so the light store stays consistent with other inch fields).
      // Snaps moving endpoint to nearby upper-cabinet edges within 3".
      const lbr = ledbarResizeRef.current
      if (lbr) {
        const lgt = ceilingLightsRef.current.find(l => l.id === lbr.lightId)
        const mountY = lgt?.y ?? 0
        const hitLb = ceilingHit(e.clientX, e.clientY, mountY)
        if (hitLb) {
          // All in feet. fixedX/fixedZ were captured in feet at drag start.
          const alongFixed  = lbr.fixedX * lbr.ux + lbr.fixedZ * lbr.uz
          const alongCursor = hitLb.x * lbr.ux + hitLb.z * lbr.uz
          let newLenFt = Math.abs(alongCursor - alongFixed)
          // Snap moving endpoint to upper-cabinet edges within 3 inches.
          const SNAP_FT = 3 / 12
          for (const cab of cabinetsRef.current) {
            if (cab.style !== 'upper') continue
            const cux = Math.cos(cab.rotY), cuz = -Math.sin(cab.rotY)
            if (Math.abs(cux * lbr.ux + cuz * lbr.uz) < 0.95) continue
            // Cabinet coords are inches; convert to feet and project.
            const cabAlongFt = (cab.x * lbr.ux + cab.z * lbr.uz) / 12
            const halfCabFt = cab.w / 24
            for (const edgeFt of [cabAlongFt - halfCabFt, cabAlongFt + halfCabFt]) {
              const candLen = Math.abs(edgeFt - alongFixed)
              if (Math.abs(candLen - newLenFt) < SNAP_FT) { newLenFt = candLen; break }
            }
          }
          newLenFt = Math.max(3 / 12, newLenFt) // 3" minimum
          const dir = Math.sign(alongCursor - alongFixed) || 1
          const movingAlong = alongFixed + dir * newLenFt
          const centerAlong = (alongFixed + movingAlong) / 2
          const perpX = lbr.fixedX - alongFixed * lbr.ux
          const perpZ = lbr.fixedZ - alongFixed * lbr.uz
          const newX = perpX + centerAlong * lbr.ux
          const newZ = perpZ + centerAlong * lbr.uz
          updateCeilLtRef.current(lbr.lightId, {
            lengthIn: Math.round(newLenFt * 12 * 4) / 4,  // quarter-inch precision
            x: newX,
            z: newZ,
          } as any)
        }
        return
      }

      // Ceiling light drag — ceiling plane, XZ only. For ledbar fixtures
      // mounted under cabinets, drag on the mount plane (light.y) instead.
      const cld = ceilingLightDragRef.current
      if (cld) {
        const chFt = FT(wallsRef.current.reduce((h, w) => Math.max(h, w.height), 108))
        const lgt = ceilingLightsRef.current.find(l => l.id === cld.lightId)
        const mountY = lgt?.kind === 'ledbar' && lgt.y !== undefined ? lgt.y : chFt
        const hitCl = ceilingHit(e.clientX, e.clientY, mountY)
        if (hitCl) {
          const dx = hitCl.x - cld.startHitX, dz = hitCl.z - cld.startHitZ
          updateCeilLtRef.current(cld.lightId, {
            x: Math.round((cld.startXFt + dx) * 4) / 4,
            z: Math.round((cld.startZFt + dz) * 4) / 4,
          })
        }
        return
      }

      // Overhead rack drag — ceiling plane, XZ only (stored in inches).
      // Guard: if the cursor ray hits a wall closer than the ceiling, clamp
      // the rack's XZ to the wall line so it can't tunnel through.
      const rd = rackDragRef.current
      if (rd) {
        const chFt = FT(wallsRef.current.reduce((h, w) => Math.max(h, w.height), 108))
        const hitR = ceilingHit(e.clientX, e.clientY, chFt)
        if (hitR) {
          const wh = wallFaceHit(e.clientX, e.clientY, wallsRef.current)
          const ceilDist = ray.ray.origin.distanceTo(new THREE.Vector3(hitR.x, hitR.y, hitR.z))
          let baseX: number, baseZ: number
          if (wh && wh.dist + 0.01 < ceilDist) {
            // Use wall-face hit's XZ in inches — clamps rack against the wall line
            baseX = wh.point.x * 12
            baseZ = wh.point.z * 12
          } else {
            const dxIn = (hitR.x - rd.startHitX) * 12
            const dzIn = (hitR.z - rd.startHitZ) * 12
            baseX = rd.startXIn + dxIn
            baseZ = rd.startZIn + dzIn
          }
          const gridX = snapToGrid(baseX)
          const gridZ = snapToGrid(baseZ)
          const rack = racksRef.current.find(r => r.id === rd.rackId)
          if (rack) {
            const snap = snapRackToWalls(gridX, gridZ, rack.rackWidth, rack.rackLength, rack.rotY, wallsRef.current)
            updateRack(rd.rackId, { x: snap.x, z: snap.z })
          } else {
            updateRack(rd.rackId, { x: gridX, z: gridZ })
          }
        }
        return
      }

      // Light drag — floor plane, XZ only (Y stays fixed)
      const ld = lightDragRef.current
      if (ld) {
        const hitLt = floorHit(e.clientX, e.clientY)
        if (hitLt) {
          const dx = hitLt.x - ld.startHitX, dz = hitLt.z - ld.startHitZ
          updateLightRef.current(ld.lightId, {
            x: Math.round((ld.startXFt + dx) * 4) / 4,
            z: Math.round((ld.startZFt + dz) * 4) / 4,
          })
        }
        return
      }

      // Baseboard / Stem-wall drag (body move OR end-resize).
      const bbDrag = baseboardDragRef.current
      if (bbDrag) {
        const piece = bbDrag.kind === 'stemwall'
          ? stemWallsRef.current.find(p => p.id === bbDrag.bbId)
          : baseboardsRef.current.find(p => p.id === bbDrag.bbId)
        if (!piece) return
        const updateRef = bbDrag.kind === 'stemwall' ? updateSwRef : updateBbRef

        if (bbDrag.mode === 'move') {
          // Try wall-face hit first — lets the piece slide UP the wall when the
          // cursor is on a wall above the floor. Falls back to floor hit when
          // the cursor is over open floor.
          const wh = wallFaceHit(e.clientX, e.clientY, wallsRef.current)
          const hitFloor = floorHit(e.clientX, e.clientY)
          const floorDist = hitFloor
            ? ray.ray.origin.distanceTo(new THREE.Vector3(hitFloor.x, 0, hitFloor.z))
            : Infinity
          const useWall = wh && wh.dist + 0.01 < floorDist

          if (useWall) {
            const wall = wh.wall
            const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
            const wlen = Math.hypot(dx, dz) || 1
            const ux = dx / wlen, uz = dz / wlen
            const nx = -uz * wh.side, nz = ux * wh.side
            // Sit flush against the wall face — matches addBaseboard's initial
            // placement exactly (inner face coplanar with wall surface).
            const targetPerp = wall.thickness / 2 + piece.thickness / 2
            // Snap piece's end to visible wall-joint corners (face-face
            // intersections) — same logic as step-up's corner snap. Works for
            // any wall angle (not just 90°) and handles both interior and
            // exterior corners.
            let snappedAlong = wh.along
            let snappedLen = piece.length
            if (piece.length > wlen + 0.01) {
              snappedLen = Math.max(3, wlen)
            }
            const halfSnap = snappedLen / 2
            const CORNER_SNAP = 10
            // Collect joint-corner along-positions for this wall — uses the
            // same face-face intersection math as step-up's corner snap, with
            // interior-pointing normals so sign=+1 consistently means both
            // interior sides.
            const [nxA, nzA] = wallNormal(wall)
            const hA = wall.thickness / 2
            const TOL = 12
            const jointAlong: number[] = []
            for (const wB of wallsRef.current) {
              if (wB.id === wall.id) continue
              const [nxB, nzB] = wallNormal(wB)
              const hB = wB.thickness / 2
              const connected =
                Math.hypot(wall.x1 - wB.x1, wall.z1 - wB.z1) < TOL ||
                Math.hypot(wall.x1 - wB.x2, wall.z1 - wB.z2) < TOL ||
                Math.hypot(wall.x2 - wB.x1, wall.z2 - wB.z1) < TOL ||
                Math.hypot(wall.x2 - wB.x2, wall.z2 - wB.z2) < TOL
              if (!connected) continue
              const det = nxA * nzB - nzA * nxB
              if (Math.abs(det) < 0.001) continue
              for (const sign of [+1, -1]) {
                const sA = sign * hA, sB = sign * hB
                const cA = sA + wall.x1 * nxA + wall.z1 * nzA
                const cB = sB + wB.x1 * nxB + wB.z1 * nzB
                const px = (cA * nzB - cB * nzA) / det
                const pz = (nxA * cB - nxB * cA) / det
                jointAlong.push((px - wall.x1) * ux + (pz - wall.z1) * uz)
              }
            }
            // Piece's near or far end snaps to any joint-corner along-position.
            let bestSnapDist = CORNER_SNAP
            let bestSnap: number | null = null
            for (const jAlong of jointAlong) {
              const nearEndCenter = jAlong + halfSnap  // piece's LEFT end at jAlong
              const farEndCenter  = jAlong - halfSnap  // piece's RIGHT end at jAlong
              const dn = Math.abs(snappedAlong - nearEndCenter)
              const df = Math.abs(snappedAlong - farEndCenter)
              if (dn < bestSnapDist) { bestSnapDist = dn; bestSnap = nearEndCenter }
              if (df < bestSnapDist) { bestSnapDist = df; bestSnap = farEndCenter }
            }
            if (bestSnap !== null) snappedAlong = bestSnap
            // Snap either end of the piece to a doorway/window/garage-door
            // opening edge — wider threshold so the baseboard lands flush
            // against the opening's inside edge without requiring pixel-perfect
            // pointer aim.
            if (!snappingDisabledRef.current) {
              const s = snapSpanToOpeningEdges(
                snappedAlong - halfSnap, snappedAlong + halfSnap, wall.openings, 8,
              )
              snappedAlong = (s.start + s.end) / 2
            }
            // Snap either end of the piece to another baseboard/stem-wall's
            // end on the same wall face so they sit flush edge-to-edge.
            if (!snappingDisabledRef.current) {
              const SNAP_PIECE = 4
              const sameFace = [
                ...baseboardsRef.current,
                ...stemWallsRef.current,
              ]
              for (const other of sameFace) {
                if (other.id === piece.id) continue
                const oVx = other.x - wall.x1, oVz = other.z - wall.z1
                const oPerp = oVx * nx + oVz * nz
                const otherTargetPerp = wall.thickness / 2 + other.thickness / 2
                if (Math.abs(oPerp - otherTargetPerp) > 2) continue
                const oUx = Math.cos(other.rotY), oUz = -Math.sin(other.rotY)
                if (Math.abs(oUx * ux + oUz * uz) < 0.95) continue
                const oAlong = oVx * ux + oVz * uz
                const oHalf = other.length / 2
                const candidates = [oAlong + oHalf + halfSnap, oAlong - oHalf - halfSnap]
                for (const c of candidates) {
                  if (Math.abs(snappedAlong - c) < SNAP_PIECE) snappedAlong = c
                }
              }
            }
            // Snap either end of the piece to a step-up corner along this wall.
            // We project each step corner onto the wall axis and keep only those
            // whose perpendicular distance puts them near the wall face line.
            if (!snappingDisabledRef.current) {
              const SNAP_STEP = 4
              for (const step of floorStepsRef.current) {
                for (const [scx, scz] of step.corners) {
                  const sVx = scx - wall.x1, sVz = scz - wall.z1
                  const sPerp = sVx * nx + sVz * nz
                  // Only consider step corners close to this wall's interior face.
                  if (Math.abs(sPerp - wall.thickness / 2) > 12) continue
                  const sAlong = sVx * ux + sVz * uz
                  const candidates = [sAlong - halfSnap, sAlong + halfSnap]
                  for (const c of candidates) {
                    if (Math.abs(snappedAlong - c) < SNAP_STEP) snappedAlong = c
                  }
                }
              }
            }
            // Soft clamp: allow the piece's end to extend out to any visible
            // joint corner (which can sit past the wall's centerline endpoint
            // at obtuse corners), plus some slack so user-drag isn't blocked.
            const loEnd = jointAlong.length ? Math.min(0, ...jointAlong) : 0
            const hiEnd = jointAlong.length ? Math.max(wlen, ...jointAlong) : wlen
            snappedAlong = Math.max(loEnd + halfSnap, Math.min(hiEnd - halfSnap, snappedAlong))
            const newX = wall.x1 + snappedAlong * ux + nx * targetPerp
            const newZ = wall.z1 + snappedAlong * uz + nz * targetPerp
            // Snap Y to floor when within 4" of floor — common case for stem
            // walls and baseboards.
            let newY = Math.max(0, snapToGrid(wh.yIn - piece.height / 2))
            if (newY < 4) newY = 0
            // If the piece's footprint sits over a step-up, its bottom must
            // sit ON TOP of the step — not clip into it. Snap to step height
            // when within 4", hard-clamp otherwise.
            {
              let stepH = 0
              for (const step of floorStepsRef.current) {
                if (pointInPoly(newX, newZ, step.corners)) {
                  stepH = Math.max(stepH, step.height)
                }
              }
              if (stepH > 0) {
                if (newY < stepH) newY = stepH
                else if (newY - stepH < 4) newY = stepH
              }
            }
            const newRotY = -Math.atan2(uz, ux) + (wh.side === -1 ? Math.PI : 0)
            const lenUpdate = snappedLen !== piece.length ? { length: snappedLen } : {}
            updateRef.current(piece.id, { x: newX, z: newZ, y: newY, rotY: newRotY, ...lenUpdate })
          } else if (hitFloor) {
            // Floor-plane drag: offset-based, find nearest wall to snap to.
            const hxIn = hitFloor.x * 12, hzIn = hitFloor.z * 12
            const dx = hxIn - (bbDrag.startHitX ?? hxIn)
            const dz = hzIn - (bbDrag.startHitZ ?? hzIn)
            let newX = (bbDrag.startX ?? piece.x) + dx
            let newZ = (bbDrag.startZ ?? piece.z) + dz
            const CORNER_SNAP = 8
            let snappedRotY: number | undefined
            // Always snap to the NEAREST wall (no distance threshold) so the
            // baseboard can never be dragged through a wall or off the floor.
            let bestPerp = Infinity
            for (const w of wallsRef.current) {
              const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
              const wlen = Math.hypot(wdx, wdz) || 1
              const ux = wdx / wlen, uz = wdz / wlen
              let nx = -uz, nz = ux
              if (!pointInPolygon((w.x1 + w.x2) / 2 + nx * 6, (w.z1 + w.z2) / 2 + nz * 6, floorPtsRef.current)) {
                nx = -nx; nz = -nz
              }
              const vx = newX - w.x1, vz = newZ - w.z1
              const along = vx * ux + vz * uz
              const perp = vx * nx + vz * nz
              if (along < -piece.length / 2 || along > wlen + piece.length / 2) continue
              const targetPerp = w.thickness / 2 + piece.thickness / 2
              if (Math.abs(perp - targetPerp) <= bestPerp) {
                bestPerp = Math.abs(perp - targetPerp)
                // Corner snap — snap piece end to visible wall-joint corners
                // (face-face intersections) exactly like step-up does. Works
                // for any wall angle, interior and exterior corners.
                let snappedLen = piece.length
                if (piece.length > wlen + 0.01) {
                  snappedLen = Math.max(3, wlen)
                }
                const halfSnap = snappedLen / 2
                let snappedAlong = along
                // Collect joint-corner along-positions — same face-face
                // intersection math as step-up's corner snap.
                const [nxA, nzA] = wallNormal(w)
                const hA = w.thickness / 2
                const TOL = 12
                const jointAlong: number[] = []
                for (const wB of wallsRef.current) {
                  if (wB.id === w.id) continue
                  const [nxB, nzB] = wallNormal(wB)
                  const hB = wB.thickness / 2
                  const connected =
                    Math.hypot(w.x1 - wB.x1, w.z1 - wB.z1) < TOL ||
                    Math.hypot(w.x1 - wB.x2, w.z1 - wB.z2) < TOL ||
                    Math.hypot(w.x2 - wB.x1, w.z2 - wB.z1) < TOL ||
                    Math.hypot(w.x2 - wB.x2, w.z2 - wB.z2) < TOL
                  if (!connected) continue
                  const det = nxA * nzB - nzA * nxB
                  if (Math.abs(det) < 0.001) continue
                  for (const sign of [+1, -1]) {
                    const sA = sign * hA, sB = sign * hB
                    const cA = sA + w.x1 * nxA + w.z1 * nzA
                    const cB = sB + wB.x1 * nxB + wB.z1 * nzB
                    const px = (cA * nzB - cB * nzA) / det
                    const pz = (nxA * cB - nxB * cA) / det
                    jointAlong.push((px - w.x1) * ux + (pz - w.z1) * uz)
                  }
                }
                const JOINT_SNAP = 10
                let bestSnapDist = JOINT_SNAP
                let bestSnap: number | null = null
                for (const jAlong of jointAlong) {
                  const nearEndCenter = jAlong + halfSnap
                  const farEndCenter  = jAlong - halfSnap
                  const dn = Math.abs(snappedAlong - nearEndCenter)
                  const df = Math.abs(snappedAlong - farEndCenter)
                  if (dn < bestSnapDist) { bestSnapDist = dn; bestSnap = nearEndCenter }
                  if (df < bestSnapDist) { bestSnapDist = df; bestSnap = farEndCenter }
                }
                if (bestSnap !== null) snappedAlong = bestSnap
                if (!snappingDisabledRef.current) {
                  const s = snapSpanToOpeningEdges(
                    snappedAlong - halfSnap, snappedAlong + halfSnap, w.openings, 8,
                  )
                  snappedAlong = (s.start + s.end) / 2
                }
                // Piece-end snap — align flush against another baseboard/stem-wall
                // end that sits along this same wall face.
                if (!snappingDisabledRef.current) {
                  const SNAP_PIECE = 4
                  const sameFace = [
                    ...baseboardsRef.current,
                    ...stemWallsRef.current,
                  ]
                  for (const other of sameFace) {
                    if (other.id === piece.id) continue
                    const oVx = other.x - w.x1, oVz = other.z - w.z1
                    const oPerp = oVx * nx + oVz * nz
                    const otherTargetPerp = w.thickness / 2 + other.thickness / 2
                    if (Math.abs(oPerp - otherTargetPerp) > 2) continue
                    const oUx = Math.cos(other.rotY), oUz = -Math.sin(other.rotY)
                    if (Math.abs(oUx * ux + oUz * uz) < 0.95) continue
                    const oAlong = oVx * ux + oVz * uz
                    const oHalf = other.length / 2
                    const candidates = [oAlong + oHalf + halfSnap, oAlong - oHalf - halfSnap]
                    for (const c of candidates) {
                      if (Math.abs(snappedAlong - c) < SNAP_PIECE) snappedAlong = c
                    }
                  }
                }
                // Step-up corner snap — piece end aligns with a step corner sitting
                // along this wall face.
                if (!snappingDisabledRef.current) {
                  const SNAP_STEP = 4
                  for (const step of floorStepsRef.current) {
                    for (const [scx, scz] of step.corners) {
                      const sVx = scx - w.x1, sVz = scz - w.z1
                      const sPerp = sVx * nx + sVz * nz
                      if (Math.abs(sPerp - w.thickness / 2) > 12) continue
                      const sAlong = sVx * ux + sVz * uz
                      const candidates = [sAlong - halfSnap, sAlong + halfSnap]
                      for (const c of candidates) {
                        if (Math.abs(snappedAlong - c) < SNAP_STEP) snappedAlong = c
                      }
                    }
                  }
                }
                // Soft clamp: allow reach out to visible joint corners (which
                // can sit past the wall's centerline endpoint at obtuse corners).
                const loEnd = jointAlong.length ? Math.min(0, ...jointAlong) : 0
                const hiEnd = jointAlong.length ? Math.max(wlen, ...jointAlong) : wlen
                snappedAlong = Math.max(loEnd + halfSnap, Math.min(hiEnd - halfSnap, snappedAlong))
                newX = w.x1 + snappedAlong * ux + nx * targetPerp
                newZ = w.z1 + snappedAlong * uz + nz * targetPerp
                snappedRotY = -Math.atan2(uz, ux)
                ;(bbDrag as { _pendingLen?: number })._pendingLen = snappedLen
              }
            }
            // Y sits on the floor by default, or on top of any step-up whose
            // footprint the piece is over (so it doesn't clip into the step).
            let newY = 0
            for (const step of floorStepsRef.current) {
              if (pointInPoly(newX, newZ, step.corners)) {
                newY = Math.max(newY, step.height)
              }
            }
            const pendingLen = (bbDrag as { _pendingLen?: number })._pendingLen
            const lenUpdate = pendingLen !== undefined && pendingLen !== piece.length ? { length: pendingLen } : {}
            updateRef.current(piece.id, { x: newX, z: newZ, y: newY, ...(snappedRotY !== undefined ? { rotY: snappedRotY } : {}), ...lenUpdate })
          }
        } else {
          // Resize end — floor-plane only (length axis is horizontal).
          const hitBb = floorHit(e.clientX, e.clientY)
          if (!hitBb) return
          const hxIn = hitBb.x * 12, hzIn = hitBb.z * 12
          const fx = bbDrag.fixedX!, fz = bbDrag.fixedZ!
          const ux = bbDrag.ux, uz = bbDrag.uz
          const alongFromFixed = (hxIn - fx) * ux + (hzIn - fz) * uz
          const newLen = Math.max(3, Math.abs(alongFromFixed))
          const dir = Math.sign(alongFromFixed) || 1
          // Quarter-inch base snap.
          let snapLen = Math.round(newLen * 4) / 4
          // Corner snap: moving end lands at the wall's centerline endpoint
          // so the piece visibly touches the perpendicular wall's face at a
          // mitered corner (no gap).
          const CORNER_SNAP = 8
          let bestDist = CORNER_SNAP
          // HARD CAP and joint-corner snap: the moving end snaps to visible
          // wall-joint corners (face-face intersections) on the wall this
          // piece sits along — same math as step-up's corner snap.
          let maxAllowedLen = Infinity
          for (const w of wallsRef.current) {
            const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
            const wlen = Math.hypot(wdx, wdz)
            if (wlen < 1) continue
            const wux = wdx / wlen, wuz = wdz / wlen
            const parallel = Math.abs(wux * ux + wuz * uz) > 0.95
            if (!parallel) continue
            const wnx = -wuz, wnz = wux
            const perpDist = Math.abs((fx - w.x1) * wnx + (fz - w.z1) * wnz)
            if (perpDist > w.thickness / 2 + piece.thickness + 6) continue
            // Collect candidate along-distances from fixed end: wall centerline
            // endpoints AND visible joint corners (face-face intersections).
            // The largest of these establishes maxAllowedLen — whichever allows
            // the piece to reach the farthest visible corner on this wall.
            const candAlongs: number[] = []
            const wallEndpoints: [number, number][] = [
              [w.x1, w.z1],
              [w.x2, w.z2],
            ]
            for (const endpt of wallEndpoints) {
              const candAlong = (endpt[0] - fx) * ux + (endpt[1] - fz) * uz
              if (Math.sign(candAlong) !== dir && candAlong !== 0) continue
              const candLen = Math.abs(candAlong)
              if (candLen < 3) continue
              candAlongs.push(candLen)
            }
            const [nxA, nzA] = wallNormal(w)
            const hA = w.thickness / 2
            const TOL = 12
            for (const wB of wallsRef.current) {
              if (wB.id === w.id) continue
              const [nxB, nzB] = wallNormal(wB)
              const hB = wB.thickness / 2
              const connected =
                Math.hypot(w.x1 - wB.x1, w.z1 - wB.z1) < TOL ||
                Math.hypot(w.x1 - wB.x2, w.z1 - wB.z2) < TOL ||
                Math.hypot(w.x2 - wB.x1, w.z2 - wB.z1) < TOL ||
                Math.hypot(w.x2 - wB.x2, w.z2 - wB.z2) < TOL
              if (!connected) continue
              const det = nxA * nzB - nzA * nxB
              if (Math.abs(det) < 0.001) continue
              for (const sign of [+1, -1]) {
                const sA = sign * hA, sB = sign * hB
                const cA = sA + w.x1 * nxA + w.z1 * nzA
                const cB = sB + wB.x1 * nxB + wB.z1 * nzB
                const px = (cA * nzB - cB * nzA) / det
                const pz = (nxA * cB - nxB * cA) / det
                const candAlong = (px - fx) * ux + (pz - fz) * uz
                if (Math.sign(candAlong) !== dir && candAlong !== 0) continue
                const candLen = Math.abs(candAlong)
                if (candLen < 3) continue
                candAlongs.push(candLen)
                if (candLen - newLen < bestDist && Math.abs(candLen - newLen) < CORNER_SNAP) {
                  bestDist = Math.abs(candLen - newLen)
                  snapLen = candLen
                }
              }
            }
            // Cap = the farthest visible corner/endpoint reachable on this wall.
            if (candAlongs.length) {
              maxAllowedLen = Math.min(maxAllowedLen, Math.max(...candAlongs))
            }
          }
          // Piece-end snap — lock moving end onto another baseboard/stem-wall's
          // end when they sit along the same axis, so adjacent pieces butt up.
          if (!snappingDisabledRef.current) {
            const SNAP_PIECE = 4
            const sameAxis = [
              ...baseboardsRef.current,
              ...stemWallsRef.current,
            ]
            for (const other of sameAxis) {
              if (other.id === piece.id) continue
              const oUx = Math.cos(other.rotY), oUz = -Math.sin(other.rotY)
              if (Math.abs(oUx * ux + oUz * uz) < 0.95) continue
              const oHalf = other.length / 2
              // Two endpoints of other piece in world space:
              const ends: [number, number][] = [
                [other.x + oUx * oHalf, other.z + oUz * oHalf],
                [other.x - oUx * oHalf, other.z - oUz * oHalf],
              ]
              for (const [ex, ez] of ends) {
                const candAlong = (ex - fx) * ux + (ez - fz) * uz
                if (Math.sign(candAlong) !== dir && candAlong !== 0) continue
                const candLen = Math.abs(candAlong)
                if (candLen < 3) continue
                // Perpendicular distance from piece axis line — skip if the
                // other piece's end isn't near the dragged piece's axis.
                const perpDist = Math.hypot(
                  (ex - fx) - ux * candAlong,
                  (ez - fz) - uz * candAlong,
                )
                if (perpDist > 2) continue
                if (Math.abs(candLen - snapLen) < SNAP_PIECE) snapLen = candLen
              }
            }
          }
          // Step-up corner snap — moving end latches onto a step-up corner
          // that lies (nearly) on the dragged piece's axis.
          if (!snappingDisabledRef.current) {
            const SNAP_STEP = 4
            for (const step of floorStepsRef.current) {
              for (const [scx, scz] of step.corners) {
                const candAlong = (scx - fx) * ux + (scz - fz) * uz
                if (Math.sign(candAlong) !== dir && candAlong !== 0) continue
                const candLen = Math.abs(candAlong)
                if (candLen < 3) continue
                const perpDist = Math.hypot(
                  (scx - fx) - ux * candAlong,
                  (scz - fz) - uz * candAlong,
                )
                if (perpDist > 2) continue
                if (Math.abs(candLen - snapLen) < SNAP_STEP) snapLen = candLen
              }
            }
          }
          // Opening-edge snap — moving end latches onto the inside edge of a
          // door, window, or garage-door opening on any wall the piece is
          // running along. Each opening edge is projected onto the piece axis
          // from the fixed end; the closest within SNAP_OPENING wins.
          if (!snappingDisabledRef.current) {
            const SNAP_OPENING = 8
            for (const w of wallsRef.current) {
              const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
              const wlen = Math.hypot(wdx, wdz)
              if (wlen < 1) continue
              const wux = wdx / wlen, wuz = wdz / wlen
              if (Math.abs(wux * ux + wuz * uz) < 0.95) continue
              const wnx = -wuz, wnz = wux
              const perpDist = Math.abs((fx - w.x1) * wnx + (fz - w.z1) * wnz)
              if (perpDist > w.thickness / 2 + piece.thickness + 6) continue
              for (const op of w.openings) {
                const ext = openingCasingExt(op)
                const leftAlong  = op.xOffset - ext
                const rightAlong = op.xOffset + op.width + ext
                for (const alongOnWall of [leftAlong, rightAlong]) {
                  // World position of this opening edge at wall A's centerline.
                  const ex = w.x1 + wux * alongOnWall
                  const ez = w.z1 + wuz * alongOnWall
                  const candAlong = (ex - fx) * ux + (ez - fz) * uz
                  if (Math.sign(candAlong) !== dir && candAlong !== 0) continue
                  const candLen = Math.abs(candAlong)
                  if (candLen < 3) continue
                  if (Math.abs(candLen - snapLen) < SNAP_OPENING) snapLen = candLen
                }
              }
            }
          }
          // Apply the hard cap: baseboard length cannot exceed the distance
          // from the fixed end to the nearest interior corner in the drag direction.
          if (isFinite(maxAllowedLen)) snapLen = Math.min(snapLen, maxAllowedLen)
          const cx = fx + ux * (dir * snapLen / 2)
          const cz = fz + uz * (dir * snapLen / 2)
          updateRef.current(piece.id, { length: snapLen, x: cx, z: cz })
        }
        return
      }

      // Countertop drag (move or resize)
      const ctd = countertopDragRef.current
      if (ctd) {
        const hitCt = floorHit(e.clientX, e.clientY)
        if (hitCt) {
          if (ctd.moving) {
            // Offset-based movement — countertop stays under grab point
            const hitXIn = hitCt.x * 12, hitZIn = hitCt.z * 12
            const dx = hitXIn - (ctd.startHitX ?? hitXIn)
            const dz = hitZIn - (ctd.startHitZ ?? hitZIn)
            let newX = snapToGrid((ctd.startX ?? hitXIn) + dx)
            let newZ = snapToGrid((ctd.startZ ?? hitZIn) + dz)
            // Prevent going through walls: clamp to inside floor polygon
            if (!pointInPolygon(newX, newZ, floorPtsRef.current)) {
              // Snap to nearest floor edge
              [newX, newZ] = snapToFloorEdge(newX, newZ, floorPtsRef.current, 2)
            }
            // Snap to nearest cabinet — Y to top, rotY to match, edges aligned
            const ct = countertopsRef.current.find(c => c.id === ctd.ctId)
            const cabs = cabinetsRef.current
            let bestSnapDist = 48, snapCab = null
            for (const cab of cabs) {
              const dx = newX - cab.x, dz = newZ - cab.z
              const dist = Math.sqrt(dx*dx + dz*dz)
              if (dist < bestSnapDist) { bestSnapDist = dist; snapCab = cab }
            }
            let newY = ctd.startY ?? 0
            let newRotY: number | undefined
            if (snapCab && ct) {
              newY = snapCab.y + snapCab.h
              newRotY = snapCab.rotY
              // Align countertop edges with cabinet edges along the wall direction
              const cux = Math.cos(snapCab.rotY), cuz = -Math.sin(snapCab.rotY)
              const cabCenterAlong = snapCab.x * cux + snapCab.z * cuz
              const ctCenterAlong  = newX * cux + newZ * cuz
              const cabLeftEdge  = cabCenterAlong - snapCab.w / 2
              const cabRightEdge = cabCenterAlong + snapCab.w / 2
              const ctHalfW = ct.width / 2
              // Snap whichever countertop edge is closest to a cabinet edge
              const dLL = Math.abs((ctCenterAlong - ctHalfW) - cabLeftEdge)
              const dRR = Math.abs((ctCenterAlong + ctHalfW) - cabRightEdge)
              const dLR = Math.abs((ctCenterAlong - ctHalfW) - cabRightEdge)
              const dRL = Math.abs((ctCenterAlong + ctHalfW) - cabLeftEdge)
              const bestEdgeDist = Math.min(dLL, dRR, dLR, dRL)
              if (bestEdgeDist < 2) {
                let snappedAlong = ctCenterAlong
                if (bestEdgeDist === dLL) snappedAlong = cabLeftEdge  + ctHalfW
                else if (bestEdgeDist === dRR) snappedAlong = cabRightEdge - ctHalfW
                else if (bestEdgeDist === dLR) snappedAlong = cabRightEdge + ctHalfW
                else                           snappedAlong = cabLeftEdge  - ctHalfW
                const perpComp = newX * (-cuz) + newZ * cux
                newX = snappedAlong * cux + perpComp * (-cuz)
                newZ = snappedAlong * cuz + perpComp * cux
              }
            }
            updateCtRef.current(ctd.ctId, { x: newX, z: newZ, y: newY, ...(newRotY !== undefined ? { rotY: newRotY } : {}) })
          } else if (ctd.side) {
            // Resize width (existing logic)
            const curX = hitCt.x * 12, curZ = hitCt.z * 12
            const curAlong = curX * ctd.ux + curZ * ctd.uz
            const newWidth = Math.max(6, Math.abs(curAlong - ctd.fixedAlong))
            const newAlong = (ctd.fixedAlong + (ctd.side === 'left'
              ? ctd.fixedAlong - newWidth
              : ctd.fixedAlong + newWidth)) / 2
            const newCx = newAlong * ctd.ux + ctd.perpComp * (-ctd.uz)
            const newCz = newAlong * ctd.uz + ctd.perpComp * ctd.ux
            updateCtRef.current(ctd.ctId, { width: newWidth, x: newCx, z: newCz })
          }
        }
        return
      }

      // Shape drag (wall-face path) — runs BEFORE the floor-hit gate so that
      // a near-horizontal or upward-tilted cursor ray (which misses the floor)
      // can still drop onto a wall. Without this, dragging a soffit up near the
      // top of a wall would stall as soon as the ray went above the floor plane.
      {
        const sd = shapeDragRef.current
        if (sd) {
          const shape = shapesRef.current.find(s => s.id === sd.shapeId)
          if (!shape) return
          const wh = wallFaceHit(e.clientX, e.clientY, wallsRef.current)
          if (wh) {
            const floorHitMaybe = floorHit(e.clientX, e.clientY)
            const floorDist = floorHitMaybe
              ? ray.ray.origin.distanceTo(new THREE.Vector3(floorHitMaybe.x, 0, floorHitMaybe.z))
              : Infinity
            if (wh.dist + 0.01 < floorDist) {
              const wall = wh.wall
              const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
              const lenIn = Math.hypot(dx, dz)
              const ux = dx / lenIn, uz = dz / lenIn
              const nxs = -uz, nzs = ux

              const halfAlong = Math.abs(ux) * shape.w / 2 + Math.abs(uz) * shape.d / 2
              const halfDepth = Math.abs(nxs) * shape.w / 2 + Math.abs(nzs) * shape.d / 2
              let snappedAlong = snapToGrid(wh.along)
              const { startInset, endInset } = wallEndInset(wall, wallsRef.current)
              const startTarget = startInset + halfAlong
              const endTarget   = lenIn - endInset - halfAlong
              const CORNER_SNAP = 18
              if (Math.abs(snappedAlong - startTarget) < CORNER_SNAP) snappedAlong = startTarget
              else if (Math.abs(snappedAlong - endTarget) < CORNER_SNAP) snappedAlong = endTarget
              const perp = wall.thickness / 2 + halfDepth
              const nx_ = wall.x1 + snappedAlong * ux + wh.side * perp * nxs
              const nz_ = wall.z1 + snappedAlong * uz + wh.side * perp * nzs

              const halfH = shape.h / 2
              const topY = wall.yOffset + wall.height
              const candidates = [halfH, topY - halfH]
              let newY = wh.yIn
              let bestDy = 8
              for (const c of candidates) {
                const d = Math.abs(wh.yIn - c)
                if (d < bestDy) { bestDy = d; newY = c }
              }
              newY = Math.max(halfH, newY)
              // Shape-to-shape edge snap: pulls this shape flush against any
              // neighbouring shape's edges in X/Z and stacks vertically.
              const snapDisabled = modKeysRef.current.shift || snappingDisabledRef.current
              let finalX = nx_, finalY = newY, finalZ = nz_
              if (!snapDisabled) {
                const { hx, hy, hz } = shapeHalfExtents(shape)
                const snapped = snapShapeToOthers(sd.shapeId, finalX, finalY, finalZ, hx, hy, hz, shapesRef.current)
                finalX = snapped.x; finalY = Math.max(hy, snapped.y); finalZ = snapped.z
              }
              updateShapeRef.current(sd.shapeId, { x: finalX, z: finalZ, y: finalY })
              return
            }
          }
          // Wall path didn't take — fall through to floor-hit path below.
        }
      }

      // Cabinet drag — wall-face path (same hoisting trick as shapes). Lets the
      // cabinet mount flush onto a wall at the actual cursor Y, even when the
      // ray angle skips the floor. Floor-based movement still runs below if the
      // cursor ray favors the floor over any wall.
      {
        const cd = cabinetDragRef.current
        if (cd) {
          const cab = cabinetsRef.current.find(c => c.id === cd.cabinetId)
          if (cab) {
            const wh = wallFaceHit(e.clientX, e.clientY, wallsRef.current)
            if (wh) {
              const floorHitMaybe = floorHit(e.clientX, e.clientY)
              const floorDist = floorHitMaybe
                ? ray.ray.origin.distanceTo(new THREE.Vector3(floorHitMaybe.x, 0, floorHitMaybe.z))
                : Infinity
              if (wh.dist + 0.01 < floorDist) {
                const skipSnap = modKeysRef.current.shift || snappingDisabledRef.current
                const wall = wh.wall
                const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
                const lenIn = Math.hypot(dx, dz)
                const ux = dx / lenIn, uz = dz / lenIn
                const nxs = -uz, nzs = ux

                // Orient cabinet so back is against wall — interior face by default,
                // exterior side when hit from outside.
                const baseRotY = -Math.atan2(dz, dx)
                const isExterior = wh.side < 0
                const rotY = isExterior ? baseRotY + Math.PI : baseRotY

                // Flush XZ: cabinet center sits (thickness/2 + d/2) away from wall
                // centerline on the hit side. Add 1" offset if slatwall is mounted
                // on this wall's interior face (matches existing logic).
                const slatwallOnWall = slatwallPanelsRef.current.some(p => p.wallId === wall.id)
                const slatwallExtra = (!isExterior && slatwallOnWall) ? 1 : 0
                const perp = wall.thickness / 2 + cab.d / 2 + slatwallExtra

                let snappedAlong = skipSnap ? wh.along : snapToGrid(wh.along)
                const halfW = cab.w / 2
                // Corner snap — align cabinet's side edge flush with the
                // INTERIOR face of any adjacent wall at this endpoint. Works
                // regardless of which wall wins the mitered corner, because we
                // always inset by the adjacent wall's thickness/2.
                if (!skipSnap) {
                  const CORNER_SNAP = 18
                  const { startInset, endInset } = wallEndInset(wall, wallsRef.current)
                  const startTarget = startInset + halfW
                  const endTarget   = lenIn - endInset - halfW
                  if (Math.abs(snappedAlong - startTarget) < CORNER_SNAP) snappedAlong = startTarget
                  else if (Math.abs(snappedAlong - endTarget) < CORNER_SNAP) snappedAlong = endTarget
                  // Snap a cabinet side edge to any door/window opening edge.
                  const snapped = snapSpanToOpeningEdges(
                    snappedAlong - halfW, snappedAlong + halfW, wall.openings,
                  )
                  snappedAlong = (snapped.start + snapped.end) / 2
                }
                const cabCx = wall.x1 + snappedAlong * ux + wh.side * perp * nxs
                const cabCz = wall.z1 + snappedAlong * uz + wh.side * perp * nzs

                // Vertical: cursor Y is the middle of the cabinet; then snap
                // bottom to floor/baseboard/step/wall-top AND neighboring
                // cabinet tops (stacking) / bottoms (hanging under).
                let cabY = Math.max(0, wh.yIn - cab.h / 2)
                if (!skipSnap) {
                  const yTargets: number[] = [0]
                  const bbOverlaps = getBaseboardWallOverlaps(wall, [...baseboardsRef.current, ...stemWallsRef.current], lenIn)
                  for (const bo of bbOverlaps) {
                    if (snappedAlong + halfW > bo.u0 && snappedAlong - halfW < bo.u1) {
                      yTargets.push(bo.bbTop)
                    }
                  }
                  for (const step of floorStepsRef.current) {
                    const overlaps = getStepWallOverlaps(wall, step, lenIn)
                    for (const ov of overlaps) {
                      if (snappedAlong + halfW > ov.u0 && snappedAlong - halfW < ov.u1) {
                        yTargets.push(ov.stepHeight)
                        for (const bo of bbOverlaps) {
                          if (Math.abs(bo.bbTop - ov.stepHeight) > 0.5 && snappedAlong + halfW > bo.u0 && snappedAlong - halfW < bo.u1) {
                            yTargets.push(ov.stepHeight + (bo.bbTop - (bo.bbTop > ov.stepHeight ? ov.stepHeight : 0)))
                          }
                        }
                      }
                    }
                  }
                  const wallTop = wall.yOffset + wall.height
                  yTargets.push(wallTop - cab.h)
                  // Neighboring cabinet tops/bottoms (only those that overlap
                  // this cabinet's X/Z footprint, so we don't snap to unrelated
                  // cabinets across the garage).
                  for (const other of cabinetsRef.current) {
                    if (other.id === cab.id) continue
                    const overlapX = Math.abs(cabCx - other.x) < (cab.w + other.w) / 2 + 6
                    const overlapZ = Math.abs(cabCz - other.z) < (cab.d + other.d) / 2 + 6
                    if (overlapX && overlapZ) {
                      yTargets.push(other.y + other.h)       // our bottom on their top
                      yTargets.push(other.y - cab.h)         // our top at their bottom
                    }
                  }
                  const Y_SNAP = 8
                  let bestDy = Y_SNAP
                  let bestY = cabY
                  for (const yt of yTargets) {
                    const d = Math.abs(cabY - yt)
                    if (d < bestDy) { bestDy = d; bestY = yt }
                  }
                  cabY = Math.max(0, bestY)
                  cabY = snapToGrid(cabY)
                }

                // Apply cabinet-vs-cabinet edge snapping at this wall-mounted spot too
                let finalX = cabCx, finalY = cabY, finalZ = cabCz
                if (!skipSnap) {
                  const snapped = snapCabinetToOthers(
                    cab.id, cabCx, cabY, cabCz, rotY, cab.w, cab.h, cabinetsRef.current,
                  )
                  finalX = snapped.cx; finalY = snapped.cy; finalZ = snapped.cz
                }

                cabinetDragPosRef.current = { x: finalX, z: finalZ, y: finalY, rotY }
                const group = cabinetGroupRefs.current[cd.cabinetId]
                if (group) {
                  group.position.set(FT(finalX), FT(finalY), FT(finalZ))
                  group.rotation.y = rotY
                }
                return
              }
            }
            // Wall path didn't take — fall through to floor-hit path below.
          }
        }
      }

      const hit = floorHit(e.clientX, e.clientY)
      if (!hit) return
      if (Math.abs(hit.x) > 200 || Math.abs(hit.z) > 200) return

      const curXIn = hit.x * 12, curZIn = hit.z * 12
      const CAP = 36
      const clamp = (v: number) => Math.max(-CAP, Math.min(CAP, v))
      const S = snapToGrid

      // Wall drag — absolute offset: endpoint = initial_pos + (current_mouse - drag_start_mouse)
      const wd = wallDragRef.current
      if (wd) {
        const skipSnap = modKeysRef.current.shift || snappingDisabledRef.current
        const dx = curXIn - wd.hitX, dz = curZIn - wd.hitZ
        if (wd.endpoint === 'start') {
          const rawX = S(wd.initX1 + dx), rawZ = S(wd.initZ1 + dz)
          if (skipSnap) {
            updateWallRef.current(wd.wallId, { x1: rawX, z1: rawZ })
            setWallSnapTarget(null)
          } else {
            const [sx, sz, cornerSnap, lockDir] = snapToTargets(rawX, rawZ, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            let nx: number, nz: number
            if (cornerSnap && lockDir) {
              [nx, nz] = [sx, sz]
            } else if (cornerSnap && !lockDir) {
              const [ax, az] = snapAngle(wd.initX2, wd.initZ2, rawX, rawZ)
              const [fx, fz] = snapToTargets(ax, az, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
              nx = fx; nz = fz
            } else {
              [nx, nz] = snapAngle(wd.initX2, wd.initZ2, sx, sz)
            }
            // After the dragged endpoint lands on its snap target, angle-snap
            // the wall's direction by rotating the OTHER endpoint around the
            // snapped point. Keeps the corner exactly 90°/45° instead of
            // 91°/44° when the target's coords were slightly fractional.
            let otherX = wd.initX2, otherZ = wd.initZ2
            if (cornerSnap && lockDir) {
              const [adjX, adjZ] = snapAngle(nx, nz, otherX, otherZ)
              otherX = adjX; otherZ = adjZ
            }
            const changes: Partial<GarageWall> = { x1: nx, z1: nz }
            if (otherX !== wd.initX2 || otherZ !== wd.initZ2) {
              changes.x2 = otherX; changes.z2 = otherZ
            }
            updateWallRef.current(wd.wallId, changes)
            setWallSnapTarget(cornerSnap ? [nx, nz] : null)
          }
        } else if (wd.endpoint === 'end') {
          const rawX = S(wd.initX2 + dx), rawZ = S(wd.initZ2 + dz)
          if (skipSnap) {
            updateWallRef.current(wd.wallId, { x2: rawX, z2: rawZ })
            setWallSnapTarget(null)
          } else {
            const [sx, sz, cornerSnap, lockDir] = snapToTargets(rawX, rawZ, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            let nx: number, nz: number
            if (cornerSnap && lockDir) {
              [nx, nz] = [sx, sz]
            } else if (cornerSnap && !lockDir) {
              const [ax, az] = snapAngle(wd.initX1, wd.initZ1, rawX, rawZ)
              const [fx, fz] = snapToTargets(ax, az, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
              nx = fx; nz = fz
            } else {
              [nx, nz] = snapAngle(wd.initX1, wd.initZ1, sx, sz)
            }
            let otherX = wd.initX1, otherZ = wd.initZ1
            if (cornerSnap && lockDir) {
              const [adjX, adjZ] = snapAngle(nx, nz, otherX, otherZ)
              otherX = adjX; otherZ = adjZ
            }
            const changes: Partial<GarageWall> = { x2: nx, z2: nz }
            if (otherX !== wd.initX1 || otherZ !== wd.initZ1) {
              changes.x1 = otherX; changes.z1 = otherZ
            }
            updateWallRef.current(wd.wallId, changes)
            setWallSnapTarget(cornerSnap ? [nx, nz] : null)
          }
        } else {
          const rawX1 = S(wd.initX1 + dx), rawZ1 = S(wd.initZ1 + dz)
          const rawX2 = S(wd.initX2 + dx), rawZ2 = S(wd.initZ2 + dz)
          if (skipSnap) {
            updateWallRef.current(wd.wallId, { x1: rawX1, z1: rawZ1, x2: rawX2, z2: rawZ2 })
          } else {
            // Try snapping both endpoints; use whichever snapped closer to a target
            const [sx1, sz1] = snapToTargets(rawX1, rawZ1, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            const [sx2, sz2] = snapToTargets(rawX2, rawZ2, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            const d1 = Math.hypot(sx1 - rawX1, sz1 - rawZ1)
            const d2 = Math.hypot(sx2 - rawX2, sz2 - rawZ2)
            if (d1 < 0.1 && d2 < 0.1) {
              // Neither endpoint snapped — just use grid-snapped positions
              updateWallRef.current(wd.wallId, { x1: rawX1, z1: rawZ1, x2: rawX2, z2: rawZ2 })
            } else if (d2 < d1) {
              const sdx = sx2 - rawX2, sdz = sz2 - rawZ2
              updateWallRef.current(wd.wallId, { x1: rawX1 + sdx, z1: rawZ1 + sdz, x2: sx2, z2: sz2 })
            } else {
              const sdx = sx1 - rawX1, sdz = sz1 - rawZ1
              updateWallRef.current(wd.wallId, { x1: sx1, z1: sz1, x2: rawX2 + sdx, z2: rawZ2 + sdz })
            }
          }
        }
        return
      }

      // Shape drag (floor-hit fallback) — wall-face path already handled above
      const sd = shapeDragRef.current
      if (sd) {
        const shape = shapesRef.current.find(s => s.id === sd.shapeId)
        if (!shape) return
        const snapDisabled = modKeysRef.current.shift || snappingDisabledRef.current
        const dx_ = clamp(curXIn - sd.startXIn), dz_ = clamp(curZIn - sd.startZIn)
        const rawX = S(sd.rawX + dx_), rawZ = S(sd.rawZ + dz_)
        const wallSnap = snapShapeToWalls(rawX, rawZ, shape.w, shape.d, wallsRef.current)
        let newX: number, newZ: number, newY: number
        if (wallSnap) {
          const isFloorLevel = shape.type === 'cylinder' || (shape.y - shape.h / 2) <= 6
          newY = isFloorLevel ? wallSnap.baseY + shape.h / 2 : shape.y
          newX = wallSnap.x; newZ = wallSnap.z
        } else {
          const [nx, nz] = snapToTargets(rawX, rawZ, wallsRef.current, shapesRef.current, floorPtsRef.current, undefined, sd.shapeId)
          newX = nx; newZ = nz; newY = shape.y
        }
        // Shape-to-shape edge snap: aligns with neighbours' edges in X/Z and
        // stacks vertically when footprints overlap. Runs after wall/floor
        // snapping so walls/corners win when in range.
        if (!snapDisabled) {
          const { hx, hy, hz } = shapeHalfExtents(shape)
          const snapped = snapShapeToOthers(sd.shapeId, newX, newY, newZ, hx, hy, hz, shapesRef.current)
          newX = snapped.x; newZ = snapped.z; newY = Math.max(hy, snapped.y)
        }
        updateShapeRef.current(sd.shapeId, { x: newX, z: newZ, y: newY })
        sd.rawX = rawX; sd.rawZ = rawZ
        sd.startXIn = curXIn; sd.startZIn = curZIn
        return
      }

      // Cabinet drag — floor primary with optional wall snap when within threshold
      // Uses direct Three.js group mutation for smooth dragging (no Zustand re-renders)
      const cd = cabinetDragRef.current
      if (cd) {
        const cab = cabinetsRef.current.find(c => c.id === cd.cabinetId)
        if (cab) {
          const hit = floorHit(e.clientX, e.clientY)
          let bestPos: { x?: number; z?: number; y?: number; rotY?: number } | null = null

          if (hit) {
            const skipSnap = modKeysRef.current.shift || snappingDisabledRef.current
            // Offset-based floor movement (cabinet stays under grab point).
            // Snap the DELTA instead of the absolute position — this preserves
            // the cabinet's original sub-1/4" precision (e.g. from wall-flush
            // positions saved before grid rounding existed), while still
            // quantizing movement to 1/4" steps during a real drag.
            const dx = hit.x * 12 - cd.startHitXIn
            const dz = hit.z * 12 - cd.startHitZIn
            const sdx = skipSnap ? dx : snapToGrid(dx)
            const sdz = skipSnap ? dz : snapToGrid(dz)
            if (Math.abs(sdx) < 0.01 && Math.abs(sdz) < 0.01) return
            const rawX = cd.startXIn + sdx
            const rawZ = cd.startZIn + sdz

            // Set up ray for wall-face Y tracking (reuse pre-allocated objects)
            const rect = gl.domElement.getBoundingClientRect()
            _tmpNdc.set(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              ((e.clientY - rect.top)  / rect.height) * -2 + 1,
            )
            ray.setFromCamera(_tmpNdc, cameraRef.current)

            // Corner-upper cabinets: snap to the nearest free inside wall
            // corner (pairs of perpendicular walls meeting at ~90°). The
            // cabinet's pentagon inside-corner vertex lands at the wall
            // corner; its two 24" back walls sit flush along both walls.
            let cornerSnap: { x: number; z: number; y: number; rotY: number; dist: number } | null = null
            if (!skipSnap && cab.style === 'corner-upper') {
              const CORNER_SNAP_DIST = 24 // inches — generous threshold
              const SNAP = 6
              type EndRef = { wall: GarageWall; end: 0 | 1 }
              const clusters: { x: number; z: number; refs: EndRef[] }[] = []
              for (const w of wallsRef.current) {
                for (const end of [0, 1] as const) {
                  const ex = end === 0 ? w.x1 : w.x2
                  const ez = end === 0 ? w.z1 : w.z2
                  let cl = clusters.find(c => Math.hypot(c.x - ex, c.z - ez) < SNAP)
                  if (!cl) { cl = { x: ex, z: ez, refs: [] }; clusters.push(cl) }
                  cl.refs.push({ wall: w, end })
                }
              }
              for (const cl of clusters) {
                if (cl.refs.length !== 2) continue
                const [r1, r2] = cl.refs
                const dirOf = (r: EndRef) => {
                  const ox = r.end === 0 ? r.wall.x2 : r.wall.x1
                  const oz = r.end === 0 ? r.wall.z2 : r.wall.z1
                  const cx = r.end === 0 ? r.wall.x1 : r.wall.x2
                  const cz = r.end === 0 ? r.wall.z1 : r.wall.z2
                  const ddx = ox - cx, ddz = oz - cz
                  const L = Math.hypot(ddx, ddz) || 1
                  return { dx: ddx / L, dz: ddz / L, thick: r.wall.thickness }
                }
                let aDir = dirOf(r1)
                let bDir = dirOf(r2)
                const dot = aDir.dx * bDir.dx + aDir.dz * bDir.dz
                if (Math.abs(dot) > 0.2) continue
                const cross = aDir.dx * bDir.dz - aDir.dz * bDir.dx
                if (cross > 0) { const tmp = aDir; aDir = bDir; bDir = tmp }
                const pickInward = (dir: { dx: number; dz: number }, other: { dx: number; dz: number }) => {
                  const n1x = -dir.dz, n1z = dir.dx
                  return (n1x * other.dx + n1z * other.dz) > 0
                    ? { nx: n1x, nz: n1z } : { nx: -n1x, nz: -n1z }
                }
                const nAv = pickInward(aDir, bDir)
                const nBv = pickInward(bDir, aDir)
                const wallCornerX = cl.x + nAv.nx * (aDir.thick / 2) + nBv.nx * (bDir.thick / 2)
                const wallCornerZ = cl.z + nAv.nz * (aDir.thick / 2) + nBv.nz * (bDir.thick / 2)
                // Validate: probe inward along bisector; must be inside floor polygon
                const bisX = aDir.dx + bDir.dx, bisZ = aDir.dz + bDir.dz
                const bisL = Math.hypot(bisX, bisZ) || 1
                if (!pointInPolygon(wallCornerX + (bisX / bisL) * 12, wallCornerZ + (bisZ / bisL) * 12, floorPtsRef.current)) continue
                const rotY = Math.atan2(-aDir.dz, aDir.dx)
                // Pentagon is centered on the cabinet's 24×24 bounding box.
                // Inside-corner vertex is at local (-w/2, -w/2). To place it
                // at the wall corner: cabinet.position = wall_corner + rotated(w/2, w/2).
                const halfW = cab.w / 2
                const cs = Math.cos(rotY), sn = Math.sin(rotY)
                const cornerX = wallCornerX + halfW * cs + halfW * sn
                const cornerZ = wallCornerZ - halfW * sn + halfW * cs
                // Skip if another corner cabinet occupies this spot
                const occupied = cabinetsRef.current.some(cb =>
                  cb.id !== cab.id && cb.style === 'corner-upper' &&
                  Math.hypot(cb.x - cornerX, cb.z - cornerZ) < SNAP
                )
                if (occupied) continue
                const dist = Math.hypot(rawX - cornerX, rawZ - cornerZ)
                if (dist > CORNER_SNAP_DIST) continue
                if (!cornerSnap || dist < cornerSnap.dist) {
                  cornerSnap = { x: cornerX, z: cornerZ, y: cab.y, rotY, dist }
                }
              }
              if (cornerSnap) {
                bestPos = { x: cornerSnap.x, z: cornerSnap.z, y: cornerSnap.y, rotY: cornerSnap.rotY }
              }
            }

            // Check for wall snap — only snap when cabinet center is within 20" of wall face
            // Shift key disables wall/cabinet snapping
            const WALL_SNAP_DIST = skipSnap ? 0 : 2
            let wallSnap: { x: number; z: number; y: number; rotY: number; dist: number } | null = null
            for (const wall of wallsRef.current) {
              const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
              const len = Math.hypot(wdx, wdz)
              if (len < 1) continue
              const ux = wdx / len, uz = wdz / len
              // Determine the true interior-facing normal by testing a probe
              // point against the floor polygon. Wall draw order is arbitrary
              // (back wall may be drawn reversed), so (-uz, ux) isn't always
              // interior. Use pointInPolygon to pick the side that faces in.
              let nx = -uz, nz = ux
              const midX = (wall.x1 + wall.x2) / 2
              const midZ = (wall.z1 + wall.z2) / 2
              const probeDist = 6 // inches into either side
              if (!pointInPolygon(midX + nx * probeDist, midZ + nz * probeDist, floorPtsRef.current)) {
                nx = -nx; nz = -nz
              }

              // Project cabinet position onto wall coordinate system
              const relX = rawX - wall.x1, relZ = rawZ - wall.z1
              const along = relX * ux + relZ * uz
              const perp  = relX * nx + relZ * nz

              // Must be within wall span (with half-width margin)
              if (along < -cab.w / 2 || along > len + cab.w / 2) continue

              // Distance from cabinet center to wall face position (interior or exterior).
              // Only add the 1" slatwall thickness when the cabinet actually sits
              // IN FRONT of a slatwall panel on this wall — not just any cabinet
              // on a wall that has some slatwall somewhere.
              const overlapsSlatwall = slatwallPanelsRef.current.some(p =>
                p.wallId === wall.id &&
                along + cab.w / 2 > p.alongStart + 0.1 &&
                along - cab.w / 2 < p.alongEnd - 0.1
              )
              const slatwallExtra = overlapsSlatwall ? 1 : 0
              const intTargetPerp = wall.thickness / 2 + cab.d / 2 + slatwallExtra
              const extTargetPerp = -(wall.thickness / 2 + cab.d / 2)
              const intDist = Math.abs(perp - intTargetPerp)
              const extDist = Math.abs(perp - extTargetPerp)

              // Snap to whichever face (interior or exterior) is closer
              let targetPerp: number
              if (intDist <= extDist && intDist <= WALL_SNAP_DIST) {
                targetPerp = intTargetPerp
              } else if (extDist <= WALL_SNAP_DIST) {
                targetPerp = extTargetPerp
              } else {
                continue
              }
              const perpDist = Math.abs(perp - targetPerp)

              let snappedAlong = snapToGrid(Math.max(0, Math.min(along, len)))
              // Corner snap: lock cabinet edge flush with adjacent wall interior face
              const { startTrim: cAdj0, endTrim: cAdj1 } = computeCornerAdj(wall, wallsRef.current)
              if (cAdj0 > 0 && Math.abs(snappedAlong - cab.w / 2 - cAdj0) < 2) snappedAlong = cAdj0 + cab.w / 2
              if (cAdj1 > 0 && Math.abs(snappedAlong + cab.w / 2 - (len - cAdj1)) < 2) snappedAlong = len - cAdj1 - cab.w / 2
              const cabCx = wall.x1 + snappedAlong * ux + nx * targetPerp
              const cabCz = wall.z1 + snappedAlong * uz + nz * targetPerp

              // Get Y from wall-face plane intersection so cabinet slides up/down the wall
              _tmpVec3.set(FT(cabCx), 0, FT(cabCz))
              _tmpPlane.setFromNormalAndCoplanarPoint(
                _tmpNormal.set(nx, 0, nz), _tmpVec3
              )
              let cabY = cab.y
              if (ray.ray.intersectPlane(_tmpPlane, _tmpVec3b)) {
                cabY = Math.max(0, snapToGrid(_tmpVec3b.y * 12))
              }

              // Snap cabinet Y to step-up heights
              const Y_SNAP = 8  // inches threshold
              const yTargets: number[] = [0]
              const bbOvs = getBaseboardWallOverlaps(wall, [...baseboardsRef.current, ...stemWallsRef.current], len)
              for (const bo of bbOvs) {
                if (snappedAlong + cab.w / 2 > bo.u0 && snappedAlong - cab.w / 2 < bo.u1) {
                  yTargets.push(bo.bbTop)
                }
              }
              for (const step of floorStepsRef.current) {
                const overlaps = getStepWallOverlaps(wall, step, len)
                for (const ov of overlaps) {
                  if (snappedAlong + cab.w / 2 > ov.u0 && snappedAlong - cab.w / 2 < ov.u1) {
                    yTargets.push(ov.stepHeight)
                  }
                }
              }
              // Find closest Y snap target
              for (const yt of yTargets) {
                if (Math.abs(cabY - yt) < Y_SNAP) { cabY = yt; break }
              }

              if (!wallSnap || perpDist < wallSnap.dist) {
                // Cabinet rotation: face the interior (or exterior) using the
                // pointInPolygon-resolved normal, not the wall draw direction.
                // Cabinet back is at local -Z, open front at +Z. For the front
                // to face the room, local +Z must point along the interior
                // normal. rotation.y = θ rotates local +Z to world (sinθ, cosθ),
                // so θ = atan2(nx, nz).
                const isExterior = targetPerp < 0
                const faceX = isExterior ? -nx : nx
                const faceZ = isExterior ? -nz : nz
                const rotY = Math.atan2(faceX, faceZ)
                wallSnap = { x: cabCx, z: cabCz, y: cabY, rotY, dist: perpDist }
              }
            }

            if (wallSnap && !cornerSnap) {
              bestPos = { x: wallSnap.x, z: wallSnap.z, y: wallSnap.y, rotY: wallSnap.rotY }
            } else if (!cornerSnap && pointInPolygon(rawX, rawZ, floorPtsRef.current)) {
              // When on the floor, sit on top of any step the cabinet is over
              let floorY = 0
              for (const step of floorStepsRef.current) {
                if (pointInPoly(rawX, rawZ, step.corners)) {
                  floorY = Math.max(floorY, step.height)
                }
              }
              bestPos = { x: rawX, z: rawZ, y: floorY, rotY: cab.rotY }
            }
          }

          if (bestPos) {
            const skipSnap = modKeysRef.current.shift || snappingDisabledRef.current
            if (!skipSnap) {
              const snapRot = bestPos.rotY ?? cab.rotY
              const snapped = snapCabinetToOthers(
                cab.id,
                bestPos.x ?? cab.x, bestPos.y ?? cab.y, bestPos.z ?? cab.z,
                snapRot, cab.w, cab.h,
                cabinetsRef.current,
              )
              bestPos = { ...bestPos, x: snapped.cx, y: snapped.cy, z: snapped.cz }
            }
            // Store transient position and directly mutate the Three.js group (no React re-render)
            const finalX = bestPos.x ?? cab.x
            const finalZ = bestPos.z ?? cab.z
            const finalY = bestPos.y ?? cab.y
            const finalRotY = bestPos.rotY ?? cab.rotY
            cabinetDragPosRef.current = { x: finalX, z: finalZ, y: finalY, rotY: finalRotY }
            const group = cabinetGroupRefs.current[cd.cabinetId]
            if (group) {
              group.position.set(FT(finalX), FT(finalY), FT(finalZ))
              group.rotation.y = finalRotY
            }
          }
        }
        return
      }

      // Item drag (floor plane)
      const itd = itemDragRef.current
      if (itd) {
        const item = itemsRef.current.find(i => i.id === itd.itemId)
        if (item) {
          const hit = floorHit(e.clientX, e.clientY)
          if (hit) {
            const dx = hit.x - itd.startHitX, dz = hit.z - itd.startHitZ
            let newX = snapToGrid((itd.startXFt + dx) * 12) / 12
            let newZ = snapToGrid((itd.startZFt + dz) * 12) / 12
            // Clamp item within garage floor bounds
            const bounds = getFloorBounds(wallsRef.current)
            const margin = 0.5 // feet
            newX = Math.max(FT(bounds.minX) + margin, Math.min(FT(bounds.maxX) - margin, newX))
            newZ = Math.max(FT(bounds.minZ) + margin, Math.min(FT(bounds.maxZ) - margin, newZ))
            updateItemRef.current(itd.itemId, { position: [newX, item.position[1], newZ] })
          }
        }
        return
      }

      // Floor step corner drag — move single corner independently
      const fscd = floorStepCornerDragRef.current
      if (fscd) {
        const hit = floorHit(e.clientX, e.clientY)
        if (hit) {
          let hx = snapToGrid(hit.x * 12), hz = snapToGrid(hit.z * 12)
          const SNAP = 4
          let snapped = false
          // 1a. TOP-PRIORITY: true visible wall-joint corners (inside/outside
          //     corner of the garage). Larger pull range (JOINT_SNAP) than
          //     face lines so the cursor locks onto the corner instead of
          //     flipping between the two walls' face-line snaps when it's
          //     in the corner neighborhood.
          if (!snapped) {
            const JOINT_SNAP = 10
            let bestDist = JOINT_SNAP, bestX = hx, bestZ = hz
            const TOL = 6
            const ws = wallsRef.current
            for (let i = 0; i < ws.length; i++) {
              const wA = ws[i]
              const [uxA, uzA] = wallDir(wA)
              const [nxA, nzA] = wallNormal(wA)
              const hA = wA.thickness / 2
              if (Math.hypot(uxA, uzA) < 0.01) continue
              for (let j = i + 1; j < ws.length; j++) {
                const wB = ws[j]
                const [uxB, uzB] = wallDir(wB)
                const [nxB, nzB] = wallNormal(wB)
                const hB = wB.thickness / 2
                const connected =
                  Math.hypot(wA.x1 - wB.x1, wA.z1 - wB.z1) < TOL ||
                  Math.hypot(wA.x1 - wB.x2, wA.z1 - wB.z2) < TOL ||
                  Math.hypot(wA.x2 - wB.x1, wA.z2 - wB.z1) < TOL ||
                  Math.hypot(wA.x2 - wB.x2, wA.z2 - wB.z2) < TOL
                if (!connected) continue
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
            if (bestDist < JOINT_SNAP) { hx = bestX; hz = bestZ; snapped = true }
          }
          // 1b. Per-wall face corners at FREE (unconnected) endpoints.
          if (!snapped) {
            let bestDist = Infinity, bestX = hx, bestZ = hz
            const TOL0 = 6
            const isEpConnected = (wallId: string, ex: number, ez: number) =>
              wallsRef.current.some(o => o.id !== wallId && (
                Math.hypot(o.x1 - ex, o.z1 - ez) < TOL0 ||
                Math.hypot(o.x2 - ex, o.z2 - ez) < TOL0
              ))
            for (const wall of wallsRef.current) {
              const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
              const len = Math.hypot(dx, dz)
              if (len < 0.1) continue
              const nx = -dz / len * wall.thickness / 2
              const nz =  dx / len * wall.thickness / 2
              const candidates: [number, number][] = []
              if (!isEpConnected(wall.id, wall.x1, wall.z1)) {
                candidates.push([wall.x1 + nx, wall.z1 + nz], [wall.x1 - nx, wall.z1 - nz])
              }
              if (!isEpConnected(wall.id, wall.x2, wall.z2)) {
                candidates.push([wall.x2 + nx, wall.z2 + nz], [wall.x2 - nx, wall.z2 - nz])
              }
              for (const [px, pz] of candidates) {
                const d = Math.hypot(hx - px, hz - pz)
                if (d < SNAP && d < bestDist) { bestDist = d; bestX = px; bestZ = pz }
              }
            }
            if (bestDist < SNAP) { hx = bestX; hz = bestZ; snapped = true }
          }
          // 2. Snap to other step-up corners (both axes together)
          if (!snapped) {
            let bestDist = Infinity, bestX = hx, bestZ = hz
            for (const other of floorStepsRef.current) {
              if (other.id === fscd.stepId) continue
              for (const [ox, oz] of other.corners) {
                const d = Math.hypot(hx - ox, hz - oz)
                if (d < SNAP && d < bestDist) { bestDist = d; bestX = ox; bestZ = oz }
              }
            }
            if (bestDist < SNAP) { hx = bestX; hz = bestZ; snapped = true }
          }
          // 3. Snap to any point along a wall's face — projection works for
          //    walls at any angle. Clamp `along` to [0, L] so when the
          //    cursor overshoots the wall end, the snap anchors on the face
          //    corner instead of the infinite-line extension.
          if (!snapped) {
            let bestDist = SNAP, bestX = hx, bestZ = hz
            for (const wall of wallsRef.current) {
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
              const perp = relX * nx + relZ * nz
              for (const side of [halfT, -halfT]) {
                // Use segment distance (not infinite-line) so face-corners
                // attract when the cursor is past the wall end.
                const snapX = wall.x1 + alongClamped * ux + side * nx
                const snapZ = wall.z1 + alongClamped * uz + side * nz
                const d = Math.hypot(hx - snapX, hz - snapZ)
                if (d < bestDist) {
                  bestDist = d
                  bestX = snapX
                  bestZ = snapZ
                }
              }
            }
            if (bestDist < SNAP) { hx = bestX; hz = bestZ; snapped = true }
          }
          const step = floorStepsRef.current.find(s => s.id === fscd.stepId)
          if (step) {
            // 90° edge snap — when no wall / step-corner snap fired, lock
            // the dragged corner to make its adjacent edges horizontal or
            // vertical against the neighboring corners.
            if (!snapped) {
              const n = step.corners.length
              const prev = step.corners[(fscd.cornerIdx - 1 + n) % n]
              const next = step.corners[(fscd.cornerIdx + 1) % n]
              const ANGLE_TOL_DEG = 6
              const snapEdge = (ax: number, az: number) => {
                const dx = hx - ax, dz = hz - az
                if (Math.hypot(dx, dz) < 1) return
                const ang = Math.atan2(dz, dx) * 180 / Math.PI
                const nearest = Math.round(ang / 90) * 90
                if (Math.abs(ang - nearest) >= ANGLE_TOL_DEG) return
                const norm = ((nearest % 360) + 360) % 360
                if (norm === 0 || norm === 180) hz = az
                else hx = ax
              }
              snapEdge(prev[0], prev[1])
              snapEdge(next[0], next[1])
            }
            const newCorners = step.corners.map((c, i) =>
              i === fscd.cornerIdx ? [hx, hz] as [number, number] : [...c] as [number, number]
            )
            updateFloorStepRef.current(fscd.stepId, { corners: newCorners })
          }
        }
        return
      }

      // Floor step body drag — translate ALL corners by the drag delta
      const fsd = floorStepDragRef.current
      if (fsd) {
        const hit = floorHit(e.clientX, e.clientY)
        if (hit) {
          const dxIn = snapToGrid((hit.x - fsd.hitX) * 12)
          const dzIn = snapToGrid((hit.z - fsd.hitZ) * 12)
          const newCorners = fsd.initCorners.map(([cx, cz]) =>
            [cx + dxIn, cz + dzIn] as [number, number]
          )
          // Snap bounding box edges to walls and other steps
          const SNAP = 2
          const xs = newCorners.map(c => c[0]), zs = newCorners.map(c => c[1])
          const minX = Math.min(...xs), maxX = Math.max(...xs)
          const minZ = Math.min(...zs), maxZ = Math.max(...zs)
          let snapDx = 0, snapDz = 0
          // Wall snap — works at ANY wall angle. For each step corner and each
          // wall, find the closest of:
          //   • a wall endpoint (corner)
          //   • an interior-face corner (endpoint offset by ±halfT along normal)
          //   • anywhere along the interior-face line (perpendicular projection)
          // Pick the single smallest snap across all corner/wall pairs.
          let bestWallDist = SNAP
          for (const wall of wallsRef.current) {
            const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
            const L = Math.hypot(wdx, wdz)
            if (L < 0.1) continue
            const ux = wdx / L, uz = wdz / L
            const nx = -uz, nz = ux
            const halfT = wall.thickness / 2
            for (const [cx, cz] of newCorners) {
              const relX = cx - wall.x1, relZ = cz - wall.z1
              const along = relX * ux + relZ * uz
              const perp = relX * nx + relZ * nz
              // (a) face-segment snap — clamp `along` to [0, L] so when the
              //     step corner overshoots the wall end the snap bottoms out
              //     at the face corner instead of the infinite-line extension.
              if (along >= -SNAP && along <= L + SNAP) {
                const alongClamped = Math.max(0, Math.min(L, along))
                for (const side of [halfT, -halfT]) {
                  const snapX = wall.x1 + alongClamped * ux + side * nx
                  const snapZ = wall.z1 + alongClamped * uz + side * nz
                  const d = Math.hypot(cx - snapX, cz - snapZ)
                  if (d < bestWallDist) {
                    bestWallDist = d
                    snapDx = snapX - cx
                    snapDz = snapZ - cz
                  }
                }
              }
              // (b) per-wall face-corner snap — each wall endpoint offset by
              //     ±halfT along the normal. Skipped at endpoints that are
              //     connected to another wall (joint corner below handles
              //     those; otherwise the face corner wins over the joint
              //     corner by a tiny margin and the inside corner feels
              //     "sticky" in the wrong spot).
              const TOL_BB = 6
              const epConnected = (ex: number, ez: number) =>
                wallsRef.current.some(o => o.id !== wall.id && (
                  Math.hypot(o.x1 - ex, o.z1 - ez) < TOL_BB ||
                  Math.hypot(o.x2 - ex, o.z2 - ez) < TOL_BB
                ))
              for (const [wx, wz] of [[wall.x1, wall.z1], [wall.x2, wall.z2]]) {
                if (epConnected(wx, wz)) continue
                for (const side of [halfT, -halfT]) {
                  const px = wx + side * nx
                  const pz = wz + side * nz
                  const d = Math.hypot(cx - px, cz - pz)
                  if (d < bestWallDist) {
                    bestWallDist = d
                    snapDx = px - cx
                    snapDz = pz - cz
                  }
                }
              }
              // (c) true visible joint corners — face-face intersection
              //     between this wall and any other connected wall, keeping
              //     only interior-interior and exterior-exterior corners.
              const [uxA, uzA] = [ux, uz]
              const [nxA, nzA] = wallNormal(wall)
              for (const wB of wallsRef.current) {
                if (wB.id === wall.id) continue
                const TOL = 6
                const connected =
                  Math.hypot(wall.x1 - wB.x1, wall.z1 - wB.z1) < TOL ||
                  Math.hypot(wall.x1 - wB.x2, wall.z1 - wB.z2) < TOL ||
                  Math.hypot(wall.x2 - wB.x1, wall.z2 - wB.z1) < TOL ||
                  Math.hypot(wall.x2 - wB.x2, wall.z2 - wB.z2) < TOL
                if (!connected) continue
                const [uxB, uzB] = wallDir(wB)
                if (Math.abs(uxA * uzB - uzA * uxB) < 0.01) continue
                const [nxB, nzB] = wallNormal(wB)
                const hB = wB.thickness / 2
                const det = nxA * nzB - nzA * nxB
                if (Math.abs(det) < 0.001) continue
                for (const sign of [+1, -1]) {
                  const sA = sign * halfT, sB = sign * hB
                  const cA = sA + wall.x1 * nxA + wall.z1 * nzA
                  const cB = sB + wB.x1 * nxB + wB.z1 * nzB
                  const px = (cA * nzB - cB * nzA) / det
                  const pz = (nxA * cB - nxB * cA) / det
                  const d = Math.hypot(cx - px, cz - pz)
                  if (d < bestWallDist) {
                    bestWallDist = d
                    snapDx = px - cx
                    snapDz = pz - cz
                  }
                }
              }
            }
          }
          const xLocked = Math.abs(snapDx) > 0.0001
          const zLocked = Math.abs(snapDz) > 0.0001
          // Snap to other steps' bounding edges — per-axis, fills in whichever
          // axis the wall snap didn't already lock.
          for (const other of floorStepsRef.current) {
            if (other.id === fsd.stepId) continue
            const ob = stepBounds(other)
            if (!xLocked && !snapDx && Math.abs(minX - ob.maxX) < SNAP) snapDx = ob.maxX - minX
            if (!xLocked && !snapDx && Math.abs(maxX - ob.minX) < SNAP) snapDx = ob.minX - maxX
            if (!xLocked && !snapDx && Math.abs(minX - ob.minX) < SNAP) snapDx = ob.minX - minX
            if (!xLocked && !snapDx && Math.abs(maxX - ob.maxX) < SNAP) snapDx = ob.maxX - maxX
            if (!zLocked && !snapDz && Math.abs(minZ - ob.maxZ) < SNAP) snapDz = ob.maxZ - minZ
            if (!zLocked && !snapDz && Math.abs(maxZ - ob.minZ) < SNAP) snapDz = ob.minZ - maxZ
            if (!zLocked && !snapDz && Math.abs(minZ - ob.minZ) < SNAP) snapDz = ob.minZ - minZ
            if (!zLocked && !snapDz && Math.abs(maxZ - ob.maxZ) < SNAP) snapDz = ob.maxZ - maxZ
          }
          if (snapDx || snapDz) {
            for (const c of newCorners) { c[0] += snapDx; c[1] += snapDz }
          }
          updateFloorStepRef.current(fsd.stepId, { corners: newCorners })
        }
        return
      }

    }

    const onUp = (e: PointerEvent) => {
      // Release pointer capture
      if (hasCaptured) {
        try { canvas.releasePointerCapture(e.pointerId) } catch (_) {}
        hasCaptured = false
      }
      // Commit transient cabinet drag position to Zustand store on release
      const cd = cabinetDragRef.current
      const dragPos = cabinetDragPosRef.current
      if (cd && dragPos) {
        updateCabRef.current(cd.cabinetId, { x: dragPos.x, z: dragPos.z, y: dragPos.y, rotY: dragPos.rotY })
        cabinetDragPosRef.current = null
      }
      const wasDragging = wallDragRef.current || shapeDragRef.current || floorPointDragRef.current || vertDragRef.current || slatBodyDragRef.current || slatCornerDragRef.current || backsplashBodyDragRef.current || backsplashCornerDragRef.current || cabinetDragRef.current || countertopDragRef.current || baseboardDragRef.current || lightDragRef.current || ceilingLightDragRef.current || ledbarResizeRef.current || itemDragRef.current || rackDragRef.current || floorStepDragRef.current || floorStepCornerDragRef.current || openingDragRef.current || openingCornerDragRef.current
      openingDragRef.current = null
      openingCornerDragRef.current = null
      wallDragRef.current = null
      shapeDragRef.current = null
      floorPointDragRef.current = null
      vertDragRef.current = null
      slatBodyDragRef.current = null
      slatCornerDragRef.current = null
      backsplashBodyDragRef.current = null
      backsplashCornerDragRef.current = null
      cabinetDragRef.current = null
      countertopDragRef.current = null
      baseboardDragRef.current = null
      lightDragRef.current = null
      ceilingLightDragRef.current = null
      ledbarResizeRef.current = null
      rackDragRef.current = null
      itemDragRef.current = null
      floorStepDragRef.current = null
      floorStepCornerDragRef.current = null
      if (wasDragging) { endDrag(); suppressNextClick.current = true; setSnapLines([]) }
      setWallSnapTarget(null)
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup',   onUp)
    return () => {
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup',   onUp)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [gl, floorHit, endDrag])

  // ── Floor / ceiling geometry from polygon ────────────────────────────────
  // Resolve the floor texture path. Supports catalog IDs, plus the
  // 'imported:<id>' scheme for user-uploaded flooring textures (including
  // bundled PBR packs — for the floor we just use the color/diffuse map).
  const importedFloorAsset = useGarageStore(s =>
    flooringColor.startsWith('imported:')
      ? s.importedAssets.find(a => a.id === flooringColor.slice('imported:'.length))
      : undefined
  )
  const floorTexUrl = flooringColor.startsWith('imported:')
    ? (importedFloorAsset?.data ?? `${import.meta.env.BASE_URL}assets/textures/flooring/quicksilver.jpg`)
    : `${import.meta.env.BASE_URL}${flooringTexturePathById(flooringColor)}`
  const floorTex = useTexture(floorTexUrl)
  const maxAnisotropy = useMemo(() => gl.capabilities.getMaxAnisotropy?.() ?? 1, [gl])

  // Imported textures are usually physically-scaled PBR packs (e.g. AmbientCG
  // 2K/4K), not seamless flake chips. They need sensible feet-per-tile sizing,
  // NOT the chip-per-inch math used by stock floor textures, and the de-tile
  // rotation hurts uniform materials like metal/wood. Skip de-tiling for them.
  const isImportedFloor = flooringColor.startsWith('imported:')

  const detileFloorTex = useMemo(() => {
    if (isImportedFloor) {
      // Straight tileable texture. Scale with the existing slider where
      // floorTextureScale now means inches-per-repeat (1 chip = 1 inch by
      // default; slider 6 ≈ 6" repeat = 0.5 ft). For imported textures the
      // user usually wants much larger repeats; map 1..24 slider → 0.5..12 ft.
      const ftPerRepeat = Math.max(0.25, floorTextureScale / 2)
      const tex = floorTex.clone()
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = maxAnisotropy
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = true
      // Floor UVs are in feet; set repeats so 1 tile spans ftPerRepeat feet
      tex.repeat.set(1 / ftPerRepeat, 1 / ftPerRepeat)
      tex.needsUpdate = true
      return tex
    }
    // Stock flake-chip flooring — de-tile via rotated cell composite.
    const img = floorTex.image as (HTMLImageElement & { width: number; height: number }) | null
    if (!img) return floorTex  // fallback: texture not yet decoded
    const tileW = (img as any).naturalWidth ?? img.width
    const tileH = (img as any).naturalHeight ?? img.height
    if (!tileW || !tileH) return floorTex
    const SIZE = 2048
    const canvas = document.createElement('canvas')
    canvas.width = SIZE; canvas.height = SIZE
    const ctx = canvas.getContext('2d')!
    const cols = Math.ceil(SIZE / tileW) + 1
    const rows = Math.ceil(SIZE / tileH) + 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const rot = ((r * 3 + c * 7) % 4) * (Math.PI / 2)
        ctx.save()
        ctx.translate(c * tileW + tileW / 2, r * tileH + tileH / 2)
        ctx.rotate(rot)
        ctx.drawImage(img, -tileW / 2, -tileH / 2, tileW, tileH)
        ctx.restore()
      }
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = maxAnisotropy
    tex.minFilter = THREE.LinearMipmapLinearFilter
    tex.magFilter = THREE.LinearFilter
    tex.generateMipmaps = true
    const tilesPerFoot = 12 / floorTextureScale
    tex.repeat.set(tilesPerFoot * tileW / SIZE, tilesPerFoot * tileH / SIZE)
    tex.needsUpdate = true
    return tex
  }, [floorTex, floorTextureScale, maxAnisotropy, isImportedFloor])

  const { geometry: floorGeo, scale: floorScale } = useMemo(() => buildFloorGeometry(effectiveFloorPts), [effectiveFloorPts])
  const chFt = FT(ceilingHeight)

  // Precompute corner adjustments for all walls — avoids O(n²) per frame
  const cornerAdjMap = useMemo(() => {
    const map = new Map<string, { startExt: number; endExt: number; startTrim: number; endTrim: number }>()
    for (const wall of walls) {
      map.set(wall.id, computeCornerAdj(wall, walls))
    }
    return map
  }, [walls])

  // Precompute mitered outlines for all walls in chains
  const outlineMap = useMemo(() => computeMiteredOutlines(walls), [walls])

  // Deselect everything when clicking empty space (floor, walls, ceiling).
  // Wall selection is intentionally preserved so the wall info tab stays open
  // when you click into the scene — dismiss it via Escape or by picking a wall.
  const handleDeselect = () => {
    selectShape(null); selectSlatwallPanel(null); selectCabinet(null); selectCountertop(null); selectFloorStep(null); setFloorSelected(false); selectItem(null); selectCeilingLight(null); selectRack(null)
  }

  return (
    <group>
      {/* Floor — polygon shape, fills entire interior area. Geometry is in
          normalized object-space (~[-1,1]) with mesh.scale restoring world
          size; this keeps drei's MeshReflectorMaterial shader stable on any
          garage size (it samples the reflection FBO using object-space
          position, which breaks on large raw-feet vertex values). */}
      <mesh geometry={floorGeo} scale={[floorScale, floorScale, 1]} rotation={[-Math.PI/2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        {wireframe ? (
          <meshStandardMaterial side={THREE.DoubleSide}
            color='#1a2a3a' wireframe
          />
        ) : blueprint ? (
          <meshBasicMaterial side={THREE.DoubleSide} color='#ffffff' />
        ) : isImportedFloor && importedFloorAsset ? (
          /* Imported PBR floor — sub-component loads all sidecar maps. */
          <ImportedFloorMaterial
            asset={importedFloorAsset}
            colorTex={detileFloorTex}
            floorTextureScale={floorTextureScale}
            maxAnisotropy={maxAnisotropy}
            effectiveQuality={effectiveQuality}
            floorReflection={floorReflection}
          />
        ) : effectiveQuality === 'low' ? (
          /* Low quality: standard material, no reflections — huge GPU savings */
          <meshStandardMaterial
            side={THREE.DoubleSide}
            map={detileFloorTex}
            color='#ffffff'
            roughness={0.55}
            metalness={0.0}
          />
        ) : (
          <MeshReflectorMaterial
            side={THREE.DoubleSide}
            map={detileFloorTex}
            color='#ffffff'
            roughness={0.55}
            metalness={0.0}
            blur={effectiveQuality === 'high' ? [400, 200] : [200, 100]}
            resolution={effectiveQuality === 'high' ? 2048 : 512}
            mixBlur={0.85}
            mixStrength={floorReflection * 1.2}
            mixContrast={0.75}
            depthScale={0.8}
            minDepthThreshold={0.6}
            maxDepthThreshold={1.0}
            mirror={floorReflection}
            envMapIntensity={0.0}
          />
        )}
      </mesh>

      {/* Floor Steps — raised platforms using same floor texture */}
      {floorSteps.map(step => (
        <FloorStepMesh
          key={step.id}
          step={step}
          baseTex={detileFloorTex}
          wireframe={wireframe}
          selected={selectedFloorStepId === step.id}
          onClick={e => { e.stopPropagation(); if (suppressNextClick.current) { suppressNextClick.current = false; return }; selectFloorStep(step.id) }}
          onPointerDown={e => { e.stopPropagation(); startFloorStepDrag(step.id, e) }}
          onCornerDown={(corner, e) => startFloorStepCornerDrag(step.id, corner, e)}
          onAddCorner={afterIdx => addFloorStepCorner(step.id, afterIdx)}
          onRemoveCorner={idx => removeFloorStepCorner(step.id, idx)}
        />
      ))}

      {/* Ceiling — hidden in blueprint top-down view */}
      {!blueprint && (
        <mesh geometry={floorGeo} scale={[floorScale, floorScale, 1]} rotation={[-Math.PI/2, 0, 0]} position={[0, chFt, 0]}>
          <meshLambertMaterial side={THREE.BackSide}
            color={wireframe ? '#1a2a3a' : '#f0ede4'} wireframe={wireframe} />
        </mesh>
      )}

      {/* Walls */}
      {walls.map(wall => {
        const { startTrim, endTrim } = cornerAdjMap.get(wall.id) ?? { startExt: 0, endExt: 0, startTrim: 0, endTrim: 0 }
        const isSel = selectedWallId === wall.id
        const wallLen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
        // Always allow selection and drag in one click
        const handleWallDown = (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return  // ignore right-click (orbit) and middle-click
          selectWall(wall.id);
          setSelectedOpeningId(null);
          const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
          if (hit) {
            const hx = hit.x * 12, hz = hit.z * 12
            const dStart = Math.hypot(hx - wall.x1, hz - wall.z1)
            const dEnd   = Math.hypot(hx - wall.x2, hz - wall.z2)
            const snap   = Math.min(30, wallLen * 0.25)  // within 30" or 25% of wall
            if (dStart < snap && dStart <= dEnd) { startWallDrag(wall.id, 'start', e); return }
            if (dEnd   < snap)                   { startWallDrag(wall.id, 'end',   e); return }
          }
          startWallDrag(wall.id, 'body', e)
        }
        return (
          <group key={wall.id} visible={wall.visible !== false}>
            <WallMesh wall={wall} wireframe={wireframe} blueprint={blueprint}
              selected={isSel && !selectedSlatwallPanelId && !selectedStainlessBacksplashPanelId && !selectedOpeningId}
              onClick={() => { if (suppressNextClick.current) { suppressNextClick.current = false; return } selectWall(wall.id); setSelectedOpeningId(null) }}
              onPointerDown={handleWallDown}
              onOpeningPointerDown={(openingId, e) => startOpeningDrag(wall.id, openingId, e)}
              startTrim={startTrim} endTrim={endTrim}
              outline={outlineMap.get(wall.id) ?? null}
              baseTex={detileFloorTex}
              interiorNormal={(() => {
                const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
                const wlen = Math.hypot(wdx, wdz) || 1
                const ux = wdx / wlen, uz = wdz / wlen
                let nx = -uz, nz = ux
                const midX = (wall.x1 + wall.x2) / 2
                const midZ = (wall.z1 + wall.z2) / 2
                if (!pointInPolygon(midX + nx * 6, midZ + nz * 6, effectiveFloorPts)) {
                  nx = -nx; nz = -nz
                }
                return { nx, nz }
              })()} />
            {isSel && !selectedSlatwallPanelId && !selectedStainlessBacksplashPanelId && !selectedOpeningId && <>
              <DragHandle
                position={[FT(wall.x1), 0.08, FT(wall.z1)]}
                color='#ff8800'
                size={0.18}
                onPointerDown={(e) => { selectWall(wall.id); startWallDrag(wall.id, 'start', e); }} />
              <DragHandle
                position={[FT(wall.x2), 0.08, FT(wall.z2)]}
                color='#ff8800'
                size={0.18}
                onPointerDown={(e) => { selectWall(wall.id); startWallDrag(wall.id, 'end', e); }} />
            </>}
          </group>
        )
      })}

      {/* Corner angle labels — same logic as floor plan view (wireframe only) */}
      {wireframe && cornerAngleLabelsVisible && (() => {
        // Ray at each endpoint = direction pointing AWAY from the endpoint.
        const rays: { x: number; z: number; ux: number; uz: number }[] = []
        for (const w of walls) {
          const dx = w.x2 - w.x1, dz = w.z2 - w.z1
          const len = Math.hypot(dx, dz)
          if (len < 1) continue
          const ux = dx / len, uz = dz / len
          rays.push({ x: w.x1, z: w.z1, ux,  uz  })
          rays.push({ x: w.x2, z: w.z2, ux: -ux, uz: -uz })
        }
        // T-junctions: other wall's endpoint landing on wall body.
        const TOL = 2
        for (const w of walls) {
          const dx = w.x2 - w.x1, dz = w.z2 - w.z1
          const wl = Math.hypot(dx, dz)
          if (wl < 1) continue
          const ux = dx / wl, uz = dz / wl
          const perpTol = Math.max(TOL, w.thickness / 2 + TOL)
          const endTol = perpTol + 2
          for (const o of walls) {
            if (o.id === w.id) continue
            for (const [px, pz, isStart] of [
              [o.x1, o.z1, true],
              [o.x2, o.z2, false],
            ] as [number, number, boolean][]) {
              const t = ((px - w.x1) * ux + (pz - w.z1) * uz)
              if (t < endTol || t > wl - endTol) continue
              const cxw = w.x1 + t * ux, czw = w.z1 + t * uz
              if (Math.hypot(px - cxw, pz - czw) > perpTol) continue
              rays.push({ x: cxw, z: czw, ux,  uz  })
              rays.push({ x: cxw, z: czw, ux: -ux, uz: -uz })
              const odx = o.x2 - o.x1, odz = o.z2 - o.z1
              const olen = Math.hypot(odx, odz)
              if (olen < 1) continue
              const oux = odx / olen, ouz = odz / olen
              rays.push({
                x: cxw, z: czw,
                ux: isStart ? oux : -oux,
                uz: isStart ? ouz : -ouz,
              })
            }
          }
        }
        // Group rays at coincident points. Use a generous tolerance so a
        // T-junction ray (at the projection on the host wall centerline) and
        // the attacher's own endpoint ray (offset by half wall thickness) end
        // up in the same group.
        const GROUP_TOL = 8
        const groups: typeof rays[] = []
        for (const r of rays) {
          const g = groups.find(gg => Math.hypot(gg[0].x - r.x, gg[0].z - r.z) < GROUP_TOL)
          if (g) g.push(r); else groups.push([r])
        }
        const labels: JSX.Element[] = []
        let lk = 0
        for (const g of groups) {
          if (g.length < 2) continue
          // Dedupe rays that point the same direction (within ~1°) — happens
          // when a true corner is also detected as a T-junction endpoint.
          const unique: typeof g = []
          for (const r of g) {
            if (unique.some(u => u.ux * r.ux + u.uz * r.uz > 0.9998)) continue
            unique.push(r)
          }
          if (unique.length < 2) continue
          const sorted = [...unique].sort((a, b) => Math.atan2(a.uz, a.ux) - Math.atan2(b.uz, b.ux))
          for (let i = 0; i < sorted.length; i++) {
            if (sorted.length === 2 && i > 0) break
            const a = sorted[i], b = sorted[(i + 1) % sorted.length]
            const dot = a.ux * b.ux + a.uz * b.uz
            let angleDeg = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI
            if (sorted.length > 2) {
              const cross = a.ux * b.uz - a.uz * b.ux
              const sweep = Math.atan2(cross, dot) * 180 / Math.PI
              angleDeg = sweep < 0 ? sweep + 360 : sweep
            }
            // Skip degenerate sectors.
            if (angleDeg < 1 || angleDeg > 359) continue
            let bx = a.ux + b.ux, bz = a.uz + b.uz
            if (Math.hypot(bx, bz) < 0.01) { bx = -a.uz; bz = a.ux }
            const blen = Math.hypot(bx, bz) || 1
            bx /= blen; bz /= blen
            const OFF_IN = 12
            const tx = a.x + bx * OFF_IN
            const tz = a.z + bz * OFF_IN
            labels.push(
              <Text
                key={`cang-${lk++}`}
                position={[FT(tx), 0.5, FT(tz)]}
                rotation={[-Math.PI / 2, 0, 0]}
                fontSize={0.5}
                color="#d48b00"
                anchorX="center" anchorY="middle"
                outlineColor="#ffffff" outlineWidth={0.015}
              >
                {`${angleDeg.toFixed(0)}°`}
              </Text>
            )
          }
        }
        return <group>{labels}</group>
      })()}

      {/* Blueprint corner fills — single polygon per junction, no overlap */}
      {blueprint && walls.length > 1 && (() => {
        const chains = findWallChains(walls)
        const meshes: React.ReactNode[] = []
        for (const chain of chains) {
          const N = chain.length
          if (N < 2) continue
          for (let i = 0; i < N - 1; i++) {
            const curr = chain[i], next = chain[i + 1]
            const cDx = curr.x2 - curr.x1, cDz = curr.z2 - curr.z1
            const cLen = Math.hypot(cDx, cDz)
            if (cLen < 1) continue
            const cUx = cDx / cLen, cUz = cDz / cLen
            const cNx = -cUz, cNz = cUx, cHT = curr.wall.thickness / 2
            const nDx = next.x2 - next.x1, nDz = next.z2 - next.z1
            const nLen = Math.hypot(nDx, nDz)
            if (nLen < 1) continue
            const nUx = nDx / nLen, nUz = nDz / nLen
            const nNx = -nUz, nNz = nUx, nHT = next.wall.thickness / 2
            const cross = Math.abs(cUx * nUz - cUz * nUx)
            if (cross < 0.17) continue
            const cpx = curr.x2, cpz = curr.z2
            // 4 face endpoints at the corner from both walls
            const cP = { x: cpx + cNx * cHT, z: cpz + cNz * cHT }
            const cN = { x: cpx - cNx * cHT, z: cpz - cNz * cHT }
            const nP = { x: cpx + nNx * nHT, z: cpz + nNz * nHT }
            const nN = { x: cpx - nNx * nHT, z: cpz - nNz * nHT }
            // Build convex hull of these 4 points + corner point as a filled shape
            const pts = [cP, nP, cN, nN]
            // Sort by angle around the corner point for convex polygon
            pts.sort((a, b) => Math.atan2(a.z - cpz, a.x - cpx) - Math.atan2(b.z - cpz, b.x - cpx))
            const shape = new THREE.Shape()
            shape.moveTo(FT(pts[0].x), -FT(pts[0].z))
            for (let j = 1; j < pts.length; j++) shape.lineTo(FT(pts[j].x), -FT(pts[j].z))
            shape.closePath()
            const h = FT(Math.min(curr.wall.height, next.wall.height))
            const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false })
            geo.rotateX(-Math.PI / 2)
            meshes.push(
              <mesh key={`bp-corner-${i}-${curr.wall.id}`} geometry={geo}>
                <meshBasicMaterial color='#333333' />
              </mesh>
            )
          }
        }
        return meshes
      })()}

      {/* Baseboards now render as standalone BaseboardMesh pieces below */}

      {/* Slatwall panels — hidden in blueprint view */}
      {!blueprint && slatwallPanels.map(panel => {
        const wall = walls.find(w => w.id === panel.wallId)
        if (!wall) return null
        return (
          <SlatwallPanelMesh key={panel.id}
            panel={panel} wall={wall} wireframe={wireframe}
            selected={selectedSlatwallPanelId === panel.id}
            onClick={() => selectSlatwallPanel(panel.id)}
            onPointerDown={(e) => startSlatwallBodyDrag(panel.id, e)} />
        )
      })}

      {/* Opening (door/window) top-corner resize handles — only for the
          currently-selected opening, so picking a door shows its handles
          without also showing every other door's on the same wall. */}
      {!blueprint && selectedOpeningId && walls.filter(w => w.id === selectedWallId).flatMap(wall => {
        const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
        const wLen = Math.hypot(wdx, wdz)
        if (wLen < 1) return []
        const rotY = -Math.atan2(wdz, wdx)
        const midX = FT((wall.x1 + wall.x2) / 2)
        const midZ = FT((wall.z1 + wall.z2) / 2)
        // Push handles just past the wall face on each side so they're clickable
        // from both interior and exterior views.
        return wall.openings
          .filter(op => op.id === selectedOpeningId && (op.type === 'door' || op.type === 'window' || op.type === 'garage-door'))
          .map(op => {
            const topY = FT(op.yOffset + op.height)
            const leftX  = FT(-wLen / 2 + op.xOffset)
            const rightX = FT(-wLen / 2 + op.xOffset + op.width)
            return (
              <group key={`${wall.id}-${op.id}-handles`} position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
                <DragHandle
                  position={[leftX, topY, 0]}
                  color="#44ccff"
                  size={0.16}
                  onPointerDown={(e) => startOpeningCornerDrag(wall.id, op.id, 'tl', e)}
                />
                <DragHandle
                  position={[rightX, topY, 0]}
                  color="#44ccff"
                  size={0.16}
                  onPointerDown={(e) => startOpeningCornerDrag(wall.id, op.id, 'tr', e)}
                />
              </group>
            )
          })
      })}

      {/* Stainless steel backsplash panels — hidden in blueprint view */}
      {!blueprint && stainlessBacksplashPanels.map(panel => {
        const wall = walls.find(w => w.id === panel.wallId)
        if (!wall) return null
        return (
          <StainlessBacksplashPanelMesh key={panel.id}
            panel={panel} wall={wall} wireframe={wireframe}
            selected={selectedStainlessBacksplashPanelId === panel.id}
            onClick={() => selectStainlessBacksplashPanel(panel.id)}
            onPointerDown={(e) => startBacksplashBodyDrag(panel.id, e)} />
        )
      })}

      {/* Stainless backsplash corner handles — hidden in blueprint view */}
      {!blueprint && stainlessBacksplashPanels.filter(p => p.id === selectedStainlessBacksplashPanelId).map(panel => {
        const wall = walls.find(w => w.id === panel.wallId)
        if (!wall) return null
        const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
        const wLen = Math.hypot(wdx, wdz)
        const rotY = -Math.atan2(wdz, wdx)
        const midX = FT((wall.x1 + wall.x2) / 2)
        const midZ = FT((wall.z1 + wall.z2) / 2)
        // Position handles a hair proud of the 1/8" plate surface
        const localZ = FT(wall.thickness / 2 + 0.3)
        const corners: [0|1|2|3, number, number][] = [
          [0, FT(-wLen / 2 + panel.alongStart), FT(panel.yTop)],
          [1, FT(-wLen / 2 + panel.alongEnd),   FT(panel.yTop)],
          [2, FT(-wLen / 2 + panel.alongEnd),   FT(panel.yBottom)],
          [3, FT(-wLen / 2 + panel.alongStart), FT(panel.yBottom)],
        ]
        return (
          <group key={panel.id + '-bs-handles'} position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
            {corners.map(([c, lx, ly]) => (
              <DragHandle key={c}
                position={[lx, ly, localZ]}
                color="#22bbee"
                size={0.14}
                onPointerDown={(e) => startBacksplashCornerDrag(panel.id, c, e)} />
            ))}
          </group>
        )
      })}

      {/* Slatwall accessories — hidden in blueprint view */}
      {!blueprint && slatwallAccessories.map(acc => {
        const panel = slatwallPanels.find(p => p.id === acc.panelId)
        if (!panel) return null
        const wall = walls.find(w => w.id === panel.wallId)
        if (!wall) return null
        return (
          <SlatwallAccessoryMesh key={acc.id}
            acc={acc} panel={panel} wall={wall} wireframe={wireframe}
            selected={selectedAccessoryId === acc.id}
            onClick={() => selectSlatwallAccessory(acc.id)} />
        )
      })}

      {/* Slatwall panel corner handles — hidden in blueprint view */}
      {!blueprint && slatwallPanels.filter(p => p.id === selectedSlatwallPanelId).map(panel => {
        const wall = walls.find(w => w.id === panel.wallId)
        if (!wall) return null
        const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
        const wLen = Math.hypot(wdx, wdz)
        const rotY = -Math.atan2(wdz, wdx)
        const midX = FT((wall.x1 + wall.x2) / 2)
        const midZ = FT((wall.z1 + wall.z2) / 2)
        const localZ = FT(wall.thickness / 2 + 1.1)
        const corners: [0|1|2|3, number, number][] = [
          [0, FT(-wLen / 2 + panel.alongStart), FT(panel.yTop)],
          [1, FT(-wLen / 2 + panel.alongEnd),   FT(panel.yTop)],
          [2, FT(-wLen / 2 + panel.alongEnd),   FT(panel.yBottom)],
          [3, FT(-wLen / 2 + panel.alongStart), FT(panel.yBottom)],
        ]
        return (
          <group key={panel.id + '-handles'} position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
            {corners.map(([c, lx, ly]) => (
              <DragHandle key={c}
                position={[lx, ly, localZ]}
                color="#ff44cc"
                size={0.14}
                onPointerDown={(e) => startSlatwallCornerDrag(panel.id, c, e)} />
            ))}
          </group>
        )
      })}

      {/* Cabinets */}
      {cabinets.map(cab => {
        const isSel = selectedCabinetId === cab.id
        const startDrag = (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          selectCabinet(cab.id)
          if (cab.locked) return
          // Record Y offset between mouse hit and cabinet center
          const rect = gl.domElement.getBoundingClientRect()
          const ndc = new THREE.Vector2(
            ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1,
            ((e.nativeEvent.clientY - rect.top)  / rect.height) * -2 + 1,
          )
          ray.setFromCamera(ndc, camera)
          const hitPt = new THREE.Vector3()
          let yOffset = 0
          if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitPt)) {
            yOffset = cab.y - hitPt.y * 12
          }
          // Floor-plane hit for start — must match the floor-plane hits used during move
          const floorHitStart = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
          cabinetDragRef.current = {
            cabinetId: cab.id,
            yOffset,
            startXIn: cab.x,
            startZIn: cab.z,
            startHitXIn: floorHitStart ? floorHitStart.x * 12 : e.point.x * 12,
            startHitZIn: floorHitStart ? floorHitStart.z * 12 : e.point.z * 12,
          }
          // Initialize transient drag position from current cabinet state
          cabinetDragPosRef.current = { x: cab.x, z: cab.z, y: cab.y, rotY: cab.rotY }
          beginDrag()
        }
        return (
          // Per-cabinet Suspense keeps texture loads from blanking the whole
          // Canvas — only this one cabinet delays its first frame while PBR
          // maps decode. Placeholder is a transparent no-op so it's invisible.
          <Suspense key={cab.id} fallback={null}>
            <CabinetMesh cabinet={cab} wireframe={wireframe} blueprint={blueprint} selected={isSel}
              overlapping={cabinetOverlapsAny(cab, cabinets)}
              onClick={() => selectCabinet(cab.id)}
              onPointerDown={startDrag}
              groupRef={registerCabinetGroup}
            />
          </Suspense>
        )
      })}

      {/* Countertops */}
      {countertops.map(ct => {
        const isSel = selectedCountertopId === ct.id
        const startDrag = (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          selectCountertop(ct.id)
          if (ct.locked) return
          // Start drag for moving countertop
          const ctHit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
          ;(countertopDragRef as any).current = { ctId: ct.id, side: undefined, ux: Math.cos(ct.rotY), uz: -Math.sin(ct.rotY), fixedAlong: 0, perpComp: 0, moving: true, startX: ct.x, startZ: ct.z, startY: ct.y, startHitX: ctHit ? ctHit.x * 12 : ct.x, startHitZ: ctHit ? ctHit.z * 12 : ct.z }
          beginDrag()
        }
        return (
          <CountertopMesh
            key={ct.id}
            ct={ct}
            selected={isSel}
            wireframe={wireframe}
            blueprint={blueprint}
            onClick={() => selectCountertop(ct.id)}
            onPointerDown={startDrag}
          />
        )
      })}

      {/* Countertop resize handles — left/right ends, only for selected */}
      {countertops.filter(ct => ct.id === selectedCountertopId).map(ct => {
        const ux = Math.cos(ct.rotY), uz = -Math.sin(ct.rotY)
        const halfW = FT(ct.width / 2)
        const handleY = FT(ct.y + COUNTERTOP_THICKNESS)
        const leftPos:  [number, number, number] = [FT(ct.x) - halfW * ux, handleY, FT(ct.z) + halfW * uz]
        const rightPos: [number, number, number] = [FT(ct.x) + halfW * ux, handleY, FT(ct.z) - halfW * uz]

        const startResizeDrag = (side: 'left' | 'right', e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          if (ct.locked) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          const centerAlong = ct.x * ux + ct.z * uz
          const fixedAlong = side === 'left'
            ? centerAlong + ct.width / 2   // dragging left → right edge is fixed
            : centerAlong - ct.width / 2   // dragging right → left edge is fixed
          const perpComp = ct.x * (-uz) + ct.z * ux
          countertopDragRef.current = {
            ctId: ct.id, side,
            ux, uz,
            fixedAlong, perpComp,
            moving: false,
            startY: ct.y,
          }
          beginDrag()
        }

        return (
          <group key={ct.id + '-handles'}>
            <DragHandle position={leftPos}  color="#44aaff" size={0.14}
              onPointerDown={(e) => startResizeDrag('left',  e)} />
            <DragHandle position={rightPos} color="#44aaff" size={0.14}
              onPointerDown={(e) => startResizeDrag('right', e)} />
          </group>
        )
      })}

      {/* Baseboards — standalone box pieces attached to a wall */}
      {baseboards.map(bb => {
        const isSel = selectedBaseboardId === bb.id
        const lenFt = FT(bb.length), hFt = FT(bb.height), tFt = FT(bb.thickness)
        const cxFt = FT(bb.x), czFt = FT(bb.z)
        const startBodyDrag = (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          selectBaseboard(bb.id)
          if (bb.locked) return
          const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
          baseboardDragRef.current = {
            bbId: bb.id, kind: 'baseboard', mode: 'move',
            ux: Math.cos(bb.rotY), uz: -Math.sin(bb.rotY),
            startX: bb.x, startZ: bb.z,
            startHitX: hit ? hit.x * 12 : bb.x,
            startHitZ: hit ? hit.z * 12 : bb.z,
          }
          beginDrag()
        }
        return (
          <group key={bb.id}
            position={[cxFt, FT(bb.y) + hFt / 2, czFt]}
            rotation={[0, bb.rotY, 0]}
            onClick={(e) => { e.stopPropagation(); selectBaseboard(bb.id) }}
            onPointerDown={startBodyDrag}
          >
            <FlakedBoxMesh lenFt={lenFt} hFt={hFt} tFt={tFt}
              flake={!!bb.flake && !blueprint && !wireframe}
              floorTex={detileFloorTex}
              color={blueprint ? (isSel ? '#555' : '#444') : wireframe ? (isSel ? '#ffcc00' : '#88cc88') : (isSel ? '#d0e8ff' : bb.color)}
              wireframe={wireframe}
              widthIn={bb.length} heightIn={bb.height}
              flakeTextureId={bb.flakeTextureId}
              floorTextureScale={floorTextureScale} />
          </group>
        )
      })}

      {/* Baseboard end resize handles */}
      {baseboards.filter(bb => bb.id === selectedBaseboardId).map(bb => {
        const ux = Math.cos(bb.rotY), uz = -Math.sin(bb.rotY)
        const halfL = bb.length / 2
        const handleY = FT(bb.y) + FT(bb.height) / 2
        const leftPos:  [number, number, number] = [FT(bb.x - ux * halfL), handleY, FT(bb.z - uz * halfL)]
        const rightPos: [number, number, number] = [FT(bb.x + ux * halfL), handleY, FT(bb.z + uz * halfL)]
        const startResize = (side: 'left' | 'right', e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          if (bb.locked) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          // Fixed end is OPPOSITE the dragged side.
          const fixedX = side === 'left' ? bb.x + ux * halfL : bb.x - ux * halfL
          const fixedZ = side === 'left' ? bb.z + uz * halfL : bb.z - uz * halfL
          // Direction from fixed → moving end (so along projection is positive
          // when cursor is on the dragged side).
          const dirX = side === 'left' ? -ux : ux
          const dirZ = side === 'left' ? -uz : uz
          baseboardDragRef.current = {
            bbId: bb.id, kind: 'baseboard', mode: 'resize', side,
            ux: dirX, uz: dirZ,
            fixedX, fixedZ,
          }
          beginDrag()
        }
        return (
          <group key={bb.id + '-handles'}>
            <DragHandle position={leftPos}  color="#44aaff" size={0.10}
              onPointerDown={(e) => startResize('left', e)} />
            <DragHandle position={rightPos} color="#44aaff" size={0.10}
              onPointerDown={(e) => startResize('right', e)} />
          </group>
        )
      })}

      {/* Stem walls — same box as baseboards, but recessed 1" into wall.
         When flake is enabled, the front face uses the floor flake texture;
         all other faces stay solid color. */}
      {stemWalls.map(sw => {
        const isSel = selectedStemWallId === sw.id
        const lenFt = FT(sw.length), hFt = FT(sw.height), tFt = FT(sw.thickness)
        const cxFt = FT(sw.x), czFt = FT(sw.z)
        const startBodyDrag = (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          selectStemWall(sw.id)
          if (sw.locked) return
          const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
          baseboardDragRef.current = {
            bbId: sw.id, kind: 'stemwall', mode: 'move',
            ux: Math.cos(sw.rotY), uz: -Math.sin(sw.rotY),
            startX: sw.x, startZ: sw.z,
            startHitX: hit ? hit.x * 12 : sw.x,
            startHitZ: hit ? hit.z * 12 : sw.z,
          }
          beginDrag()
        }
        const baseColor = blueprint ? (isSel ? '#555' : '#444') : wireframe ? (isSel ? '#ffcc00' : '#88aacc') : (isSel ? '#d0e8ff' : sw.color)
        return (
          <group key={sw.id}
            position={[cxFt, FT(sw.y) + hFt / 2, czFt]}
            rotation={[0, sw.rotY, 0]}
            onClick={(e) => { e.stopPropagation(); selectStemWall(sw.id) }}
            onPointerDown={startBodyDrag}
          >
            <FlakedBoxMesh lenFt={lenFt} hFt={hFt} tFt={tFt}
              flake={!!sw.flake && !blueprint && !wireframe}
              floorTex={detileFloorTex}
              color={baseColor} wireframe={wireframe}
              widthIn={sw.length} heightIn={sw.height}
              flakeTextureId={sw.flakeTextureId}
              floorTextureScale={floorTextureScale} />
          </group>
        )
      })}

      {/* Stem wall end resize handles */}
      {stemWalls.filter(sw => sw.id === selectedStemWallId).map(sw => {
        const ux = Math.cos(sw.rotY), uz = -Math.sin(sw.rotY)
        const halfL = sw.length / 2
        const handleY = FT(sw.y) + FT(sw.height) / 2
        const leftPos:  [number, number, number] = [FT(sw.x - ux * halfL), handleY, FT(sw.z - uz * halfL)]
        const rightPos: [number, number, number] = [FT(sw.x + ux * halfL), handleY, FT(sw.z + uz * halfL)]
        const startResize = (side: 'left' | 'right', e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          if (sw.locked) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          const fixedX = side === 'left' ? sw.x + ux * halfL : sw.x - ux * halfL
          const fixedZ = side === 'left' ? sw.z + uz * halfL : sw.z - uz * halfL
          const dirX = side === 'left' ? -ux : ux
          const dirZ = side === 'left' ? -uz : uz
          baseboardDragRef.current = {
            bbId: sw.id, kind: 'stemwall', mode: 'resize', side,
            ux: dirX, uz: dirZ,
            fixedX, fixedZ,
          }
          beginDrag()
        }
        return (
          <group key={sw.id + '-handles'}>
            <DragHandle position={leftPos}  color="#44aaff" size={0.10}
              onPointerDown={(e) => startResize('left', e)} />
            <DragHandle position={rightPos} color="#44aaff" size={0.10}
              onPointerDown={(e) => startResize('right', e)} />
          </group>
        )
      })}

      {/* User-added shapes: box/beam/cylinder soffits, columns, beams */}
      {shapes.map(shape => {
        const isSel = selectedShapeId === shape.id
        const fallbackColor = shape.material === 'steel' ? '#8a8f96' : '#e8e4dc'
        const color = shape.color ?? fallbackColor
        const pos: [number, number, number] = [FT(shape.x), FT(shape.y), FT(shape.z)]
        // Per-axis UV tiling so resizing one dimension doesn't stretch the
        // texture. Box/beam: use the largest horizontal (width or depth) as U
        // and height as V — this keeps the front/back AND side faces reading
        // at roughly the same scale. Cylinder: U = circumference (wrap), V = h.
        const uFt = shape.type === 'cylinder'
          ? FT(2 * Math.PI * shape.r)
          : FT(Math.max(shape.w, shape.d))
        const vFt = FT(shape.h)
        const startDrag = (e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          selectShape(shape.id)
          if (shape.locked) return
          const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
          const curXIn = hit ? hit.x * 12 : shape.x
          const curZIn = hit ? hit.z * 12 : shape.z
          shapeDragRef.current = {
            shapeId: shape.id,
            startXIn: curXIn, startZIn: curZIn,
            rawX: shape.x, rawZ: shape.z,
          }
          beginDrag()
        }
        // Cylinders: single mesh (natural UV unwrap = circumference × height).
        // Boxes/beams: render 6 face planes so each face's UV tiling matches
        // its own dimensions — top/bottom get (w × d), sides get (d × h) etc.
        // This prevents the top face from stretching when w ≠ d or h is large.
        if (shape.type === 'cylinder') {
          return (
            <mesh
              key={shape.id}
              position={pos}
              castShadow receiveShadow
              onClick={(e) => { e.stopPropagation(); selectShape(shape.id) }}
              onPointerDown={startDrag}
            >
              <cylinderGeometry args={[FT(shape.r), FT(shape.r), FT(shape.h), 32]} />
              <Suspense fallback={<meshLambertMaterial color={color} />}>
                <TexturedShapeMaterial
                  textureId={shape.textureId}
                  color={color}
                  uFt={uFt}
                  vFt={vFt}
                  scale={shape.textureScale ?? 1}
                  wireframe={wireframe}
                  selected={isSel}
                />
              </Suspense>
            </mesh>
          )
        }
        // Box/beam — 6 faces, each with its own plane and correctly-tiled texture.
        const wFt = FT(shape.w), hFt = FT(shape.h), dFt = FT(shape.d)
        const hw = wFt / 2, hh = hFt / 2, hd = dFt / 2
        const commonHandlers = {
          onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); selectShape(shape.id) },
          onPointerDown: startDrag,
        }
        const texScale = shape.textureScale ?? 1
        const faceMat = (u: number, v: number) => (
          <Suspense fallback={<meshLambertMaterial color={color} />}>
            <TexturedShapeMaterial
              textureId={shape.textureId}
              color={color}
              uFt={u}
              vFt={v}
              scale={texScale}
              wireframe={wireframe}
              selected={isSel}
            />
          </Suspense>
        )
        return (
          <group key={shape.id} position={pos}>
            {/* +Z front */}
            <mesh position={[0, 0, hd]} {...commonHandlers} castShadow receiveShadow>
              <planeGeometry args={[wFt, hFt]} />
              {faceMat(FT(shape.w), FT(shape.h))}
            </mesh>
            {/* -Z back */}
            <mesh position={[0, 0, -hd]} rotation={[0, Math.PI, 0]} {...commonHandlers} castShadow receiveShadow>
              <planeGeometry args={[wFt, hFt]} />
              {faceMat(FT(shape.w), FT(shape.h))}
            </mesh>
            {/* +X right */}
            <mesh position={[hw, 0, 0]} rotation={[0, Math.PI / 2, 0]} {...commonHandlers} castShadow receiveShadow>
              <planeGeometry args={[dFt, hFt]} />
              {faceMat(FT(shape.d), FT(shape.h))}
            </mesh>
            {/* -X left */}
            <mesh position={[-hw, 0, 0]} rotation={[0, -Math.PI / 2, 0]} {...commonHandlers} castShadow receiveShadow>
              <planeGeometry args={[dFt, hFt]} />
              {faceMat(FT(shape.d), FT(shape.h))}
            </mesh>
            {/* +Y top */}
            <mesh position={[0, hh, 0]} rotation={[-Math.PI / 2, 0, 0]} {...commonHandlers} castShadow receiveShadow>
              <planeGeometry args={[wFt, dFt]} />
              {faceMat(FT(shape.w), FT(shape.d))}
            </mesh>
            {/* -Y bottom */}
            <mesh position={[0, -hh, 0]} rotation={[Math.PI / 2, 0, 0]} {...commonHandlers} castShadow receiveShadow>
              <planeGeometry args={[wFt, dFt]} />
              {faceMat(FT(shape.w), FT(shape.d))}
            </mesh>
          </group>
        )
      })}

      {/* Overhead storage racks */}
      {overheadRacks.map(rack => {
        const isSel = selectedRackId === rack.id
        return (
          <OverheadRackMesh
            key={rack.id}
            rack={rack}
            chFt={chFt}
            selected={isSel}
            wireframe={wireframe}
            onClick={() => selectRack(rack.id)}
            onPointerDown={(e) => {
              if (e.nativeEvent.button !== 0) return
              e.stopPropagation()
              e.nativeEvent.stopImmediatePropagation()
              selectRack(rack.id)
              if (rack.locked) return
              const hit = ceilingHit(e.nativeEvent.clientX, e.nativeEvent.clientY, chFt)
              rackDragRef.current = {
                rackId: rack.id,
                startXIn: rack.x, startZIn: rack.z,
                startHitX: hit ? hit.x : FT(rack.x),
                startHitZ: hit ? hit.z : FT(rack.z),
              }
              beginDrag()
            }}
          />
        )
      })}

      <group onClick={handleDeselect}>
      {(() => {
        // Cap total shadow-casting ceiling fixtures: 4 on high, 2 on medium,
        // 0 on low. Pick the brightest enabled lights so shadows land where
        // they matter. Rest still emit light, just without shadow maps.
        const maxCasters = qualityPreset === 'high' ? 4 : qualityPreset === 'medium' ? 2 : 0
        const shadowCasterIds = new Set(
          [...ceilingLights]
            .filter(l => l.enabled)
            .sort((a, b) => (b.intensity ?? 0) - (a.intensity ?? 0))
            .slice(0, maxCasters)
            .map(l => l.id)
        )
        return ceilingLights.map(light => {
          const isSel = selectedCeilingLightId === light.id
          return (
            <CeilingLightMesh
              key={light.id}
              light={light}
              chFt={chFt}
              selected={isSel}
              wireframe={wireframe}
              castsShadow={shadowCasterIds.has(light.id)}
              onClick={() => selectCeilingLight(light.id)}
              onPointerDown={(e) => {
                if (e.nativeEvent.button !== 0) return
                e.stopPropagation()
                e.nativeEvent.stopImmediatePropagation()
                selectCeilingLight(light.id)
                const mountY = light.kind === 'ledbar' && light.y !== undefined ? light.y : chFt
                const hit = ceilingHit(e.nativeEvent.clientX, e.nativeEvent.clientY, mountY)
                ceilingLightDragRef.current = {
                  lightId: light.id,
                  startXFt: light.x, startZFt: light.z,
                  startHitX: hit ? hit.x : light.x,
                  startHitZ: hit ? hit.z : light.z,
                }
                beginDrag()
              }}
            />
          )
        })
      })()}

      {/* LED bar resize handles — end spheres on the selected ledbar */}
      {(() => {
        const sel = ceilingLights.find(l => l.id === selectedCeilingLightId)
        if (!sel || sel.kind !== 'ledbar') return null
        const lenIn = sel.lengthIn ?? 18
        const halfL = FT(lenIn / 2)
        const ux = Math.cos(sel.rotY), uz = -Math.sin(sel.rotY)
        const y = (sel.y ?? 0) - 0.02
        const leftPos: [number, number, number]  = [sel.x - ux * halfL, y, sel.z - uz * halfL]
        const rightPos: [number, number, number] = [sel.x + ux * halfL, y, sel.z + uz * halfL]
        const startResize = (side: 'left' | 'right', e: ThreeEvent<PointerEvent>) => {
          if (e.nativeEvent.button !== 0) return
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          // fixedX/fixedZ = endpoint opposite the one being dragged, in feet.
          ledbarResizeRef.current = {
            lightId: sel.id,
            side,
            ux, uz,
            fixedX: sel.x + (side === 'left' ? halfL : -halfL) * ux,
            fixedZ: sel.z + (side === 'left' ? halfL : -halfL) * uz,
          }
          beginDrag()
        }
        return (
          <group key={sel.id + '-ledbar-handles'}>
            <DragHandle position={leftPos}  color="#44aaff" size={0.12}
              onPointerDown={(e) => startResize('left', e)} />
            <DragHandle position={rightPos} color="#44aaff" size={0.12}
              onPointerDown={(e) => startResize('right', e)} />
          </group>
        )
      })()}

      {/* Scene light bulb indicators — hidden in blueprint/wireframe */}
      {!wireframe && !blueprint && sceneLights.map(l => (
        <mesh key={l.id} position={[l.x, l.y, l.z]}
          onPointerDown={(e) => {
            if (e.nativeEvent.button !== 0) return
            e.stopPropagation()
            e.nativeEvent.stopImmediatePropagation()
            const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
            lightDragRef.current = {
              lightId: l.id,
              startXFt: l.x, startZFt: l.z,
              startHitX: hit ? hit.x : l.x,
              startHitZ: hit ? hit.z : l.z,
            }
            beginDrag()
          }}
        >
          <sphereGeometry args={[0.18, 14, 10]} />
          <meshBasicMaterial color={l.enabled ? l.color : '#444'} depthTest={false} />
        </mesh>
      ))}

      {/* Placed items (cars, motorcycles, equipment) */}
      {items.map(item => (
        <ItemMesh
          key={item.id}
          item={item}
          selected={selectedItemId === item.id}
          wireframe={wireframe}
          onClick={() => selectItem(item.id)}
          onPointerDown={(e) => startItemDrag(item.id, e)}
        />
      ))}

    </group>

    {/* Plan-view dimension lines */}
    {showDims && <DimensionLines walls={walls} cabinets={cabinets} />}

    {/* Wall-snap target ring — bright torus at the discrete snap point so
        it's unmistakably visible during a wall-endpoint drag. */}
    {wallSnapTarget && (
      <mesh
        position={[FT(wallSnapTarget[0]), 0.1, FT(wallSnapTarget[1])]}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={200}
        frustumCulled={false}
      >
        <torusGeometry args={[0.35, 0.06, 12, 24]} />
        <meshBasicMaterial color={'#22c55e'} depthTest={false} />
      </mesh>
    )}

    {/* Snap indicator lines — visual feedback during drag */}
    {snapLines.map((line, i) => (
      <line key={`snap-${i}`}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            array={new Float32Array([...line.from, ...line.to])}
            count={2}
            itemSize={3}
          />
        </bufferGeometry>
        <lineDashedMaterial color={line.color} dashSize={0.1} gapSize={0.05} linewidth={1} />
      </line>
    ))}

  </group>
  )
}
