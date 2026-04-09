import { useMemo, useRef, useCallback, useEffect, useState, Suspense, Component, memo } from 'react'
import type { ReactNode, JSX } from 'react'
import { useTexture, Text, useGLTF, MeshReflectorMaterial } from '@react-three/drei'
import { useThree, useFrame } from '@react-three/fiber'
import type { ThreeEvent } from '@react-three/fiber'
import { useGarageStore, COUNTERTOP_DEPTH, COUNTERTOP_THICKNESS, CEILING_LIGHT_W, CEILING_LIGHT_L, CEILING_LIGHT_TH, RACK_DECK_THICKNESS, RACK_LEG_SIZE } from '../store/garageStore'
import type { GarageWall, GarageShape, FloorPoint, SlatwallPanel, SlatwallAccessory, PlacedCabinet, Countertop, CeilingLight, PlacedItem, FloorStep, OverheadRack, WallOpening } from '../store/garageStore'
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
import { createButcherBlockTexture } from '../utils/butcherBlockTexture'
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
  // Filter out openings that have a 3D model — those don't need a wall cutout
  const cutOpenings = wall.openings.filter(op => !op.modelId)
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

  const halfW = step.width / 2, halfD = step.depth / 2
  const corners: [number, number][] = [
    [step.x - halfW, step.z - halfD],
    [step.x + halfW, step.z - halfD],
    [step.x + halfW, step.z + halfD],
    [step.x - halfW, step.z + halfD],
  ]

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

// Splits a baseboard segment by step overlaps, returning sub-segments with elevation
function splitSegmentBySteps(
  seg: { x0: number; x1: number },
  overlaps: { u0: number; u1: number; stepHeight: number }[],
): { x0: number; x1: number; elevate: number }[] {
  const events: number[] = [seg.x0, seg.x1]
  for (const ov of overlaps) {
    if (ov.u0 > seg.x0 && ov.u0 < seg.x1) events.push(ov.u0)
    if (ov.u1 > seg.x0 && ov.u1 < seg.x1) events.push(ov.u1)
  }
  events.sort((a, b) => a - b)

  const result: { x0: number; x1: number; elevate: number }[] = []
  for (let i = 0; i < events.length - 1; i++) {
    const x0 = events[i], x1 = events[i + 1]
    if (x1 - x0 < 0.01) continue
    const mid = (x0 + x1) / 2
    let elevate = 0
    for (const ov of overlaps) {
      if (ov.u0 <= mid && ov.u1 >= mid) elevate = Math.max(elevate, ov.stepHeight)
    }
    result.push({ x0, x1, elevate })
  }
  return result
}

// ─── World-space seamless baseboard geometry ──────────────────────────────────
/** How far the baseboard protrudes from the interior wall face (inches). */
const BB_DEPTH = 0.5

/** Interior-facing unit normal for a wall (points toward garage centroid). */
function wallIntNorm(wall: GarageWall, cx: number, cz: number): [number, number] {
  const dx = wall.x2 - wall.x1, dz = wall.z2 - wall.z1
  const len = Math.hypot(dx, dz)
  if (len < 1) return [0, 1]
  const ux = dx / len, uz = dz / len
  const n1x = -uz, n1z = ux
  const mx = (wall.x1 + wall.x2) / 2, mz = (wall.z1 + wall.z2) / 2
  return (n1x * (cx - mx) + n1z * (cz - mz)) >= 0 ? [n1x, n1z] : [uz, -ux]
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

/**
 * Build a single world-space BufferGeometry for all baseboards in a wall chain.
 * Uses mitre-cut corners so the geometry is one continuous piece, and arc-length
 * UVs so the texture tiles seamlessly around every corner.
 */
function buildBaseboardChainGeo(
  chain: ChainEntry[],
  floorSteps: FloorStep[],
  cx: number, cz: number,
  side: 'interior' | 'exterior' = 'interior',
): THREE.BufferGeometry {
  const N = chain.length
  if (N === 0) return new THREE.BufferGeometry()

  // ── Per-wall derived data ──────────────────────────────────────────────────
  interface WD {
    entry: ChainEntry; wall: GarageWall
    nx: number; nz: number   // interior normal
    ux: number; uz: number   // along-chain unit vector
    len: number
    ffx1: number; ffz1: number  // front-face line start  (interior face + BB_DEPTH)
    bfx1: number; bfz1: number  // back-face line start   (interior face exactly)
  }
  const wd: WD[] = chain.map(e => {
    const dx = e.x2 - e.x1, dz = e.z2 - e.z1
    const len = Math.hypot(dx, dz)
    const ux = dx / len, uz = dz / len
    const [inx, inz] = wallIntNorm(e.wall, cx, cz)
    // Flip normal for exterior side
    const nx = side === 'exterior' ? -inx : inx
    const nz = side === 'exterior' ? -inz : inz
    const ffOff = e.wall.thickness / 2 + BB_DEPTH
    const bfOff = e.wall.thickness / 2
    return {
      entry: e, wall: e.wall, nx, nz, ux, uz, len,
      ffx1: e.x1 + nx * ffOff, ffz1: e.z1 + nz * ffOff,
      bfx1: e.x1 + nx * bfOff, bfz1: e.z1 + nz * bfOff,
    }
  })

  // ── Mitre corner vertices ──────────────────────────────────────────────────
  // ffPts[i] / bfPts[i] = front/back mitre point at junction BEFORE wall[i]
  // (ffPts[0] = start of chain, ffPts[N] = end of chain)
  const isClosed = Math.hypot(chain[N-1].x2 - chain[0].x1, chain[N-1].z2 - chain[0].z1) < 6
  const ffPts: { x: number; z: number }[] = new Array(N + 1)
  const bfPts: { x: number; z: number }[] = new Array(N + 1)

  for (let i = 0; i <= N; i++) {
    if ((i === 0 && !isClosed) || (i === N && !isClosed)) {
      const w = wd[i === 0 ? 0 : N - 1]
      if (i === 0) {
        ffPts[0] = { x: w.ffx1, z: w.ffz1 }
        bfPts[0] = { x: w.bfx1, z: w.bfz1 }
      } else {
        ffPts[N] = { x: w.ffx1 + w.len * w.ux, z: w.ffz1 + w.len * w.uz }
        bfPts[N] = { x: w.bfx1 + w.len * w.ux, z: w.bfz1 + w.len * w.uz }
      }
      continue
    }
    const pi = (i === 0) ? N - 1 : i - 1
    const ci = i % N
    const prev = wd[pi], curr = wd[ci]
    const tFF = lineIntersectT(prev.ffx1, prev.ffz1, prev.ux, prev.uz, curr.ffx1, curr.ffz1, curr.ux, curr.uz)
    ffPts[i] = isNaN(tFF)
      ? { x: curr.ffx1, z: curr.ffz1 }
      : { x: prev.ffx1 + tFF * prev.ux, z: prev.ffz1 + tFF * prev.uz }
    const tBF = lineIntersectT(prev.bfx1, prev.bfz1, prev.ux, prev.uz, curr.bfx1, curr.bfz1, curr.ux, curr.uz)
    bfPts[i] = isNaN(tBF)
      ? { x: curr.bfx1, z: curr.bfz1 }
      : { x: prev.bfx1 + tBF * prev.ux, z: prev.bfz1 + tBF * prev.uz }
  }
  if (isClosed) { ffPts[N] = ffPts[0]; bfPts[N] = bfPts[0] }

  // ── Cumulative arc lengths (inches, along front face) ─────────────────────
  const arcLens = new Array(N + 1).fill(0)
  for (let i = 0; i < N; i++) {
    arcLens[i + 1] = arcLens[i] + Math.hypot(
      ffPts[i + 1].x - ffPts[i].x,
      ffPts[i + 1].z - ffPts[i].z,
    )
  }

  // ── Geometry buffers ───────────────────────────────────────────────────────
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], idx: number[] = []
  let base = 0

  const pushQuad = (
    p0x: number, p0y: number, p0z: number, u0: number, v0: number,
    p1x: number, p1y: number, p1z: number, u1: number, v1: number,
    p2x: number, p2y: number, p2z: number, u2: number, v2: number,
    p3x: number, p3y: number, p3z: number, u3: number, v3: number,
    fnx: number, fny: number, fnz: number,
  ) => {
    pos.push(p0x, p0y, p0z, p1x, p1y, p1z, p2x, p2y, p2z, p3x, p3y, p3z)
    uv.push(u0, v0, u1, v1, u2, v2, u3, v3)
    nor.push(fnx, fny, fnz, fnx, fny, fnz, fnx, fny, fnz, fnx, fny, fnz)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
    base += 4
  }

  // ── Build geometry per wall ────────────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const w = wd[i]
    if (!w.wall.baseboard || w.wall.baseboardHeight <= 0) continue
    const bbH = w.wall.baseboardHeight

    // Parameters on this wall's front-face and back-face lines for the mitre corners
    const tS = (ffPts[i].x   - w.ffx1) * w.ux + (ffPts[i].z   - w.ffz1) * w.uz
    const tE = (ffPts[i+1].x - w.ffx1) * w.ux + (ffPts[i+1].z - w.ffz1) * w.uz
    const btS = (bfPts[i].x   - w.bfx1) * w.ux + (bfPts[i].z   - w.bfz1) * w.uz
    const btE = (bfPts[i+1].x - w.bfx1) * w.ux + (bfPts[i+1].z - w.bfz1) * w.uz

    // Step overlaps in chain-local u space (same as along-wall distance)
    const rawOverlaps = floorSteps.flatMap(step => getStepWallOverlaps(w.wall, step, w.len))
    // If wall is reversed in chain, flip the overlap u values
    const stepOverlaps = w.entry.reversed
      ? rawOverlaps.map(ov => ({ u0: w.len - ov.u1, u1: w.len - ov.u0, stepHeight: ov.stepHeight }))
      : rawOverlaps

    // Garage-door openings in chain-local u space
    const gdOpenings = w.wall.openings.filter(op => op.type === 'garage-door')
    const effOpenings = w.entry.reversed
      ? gdOpenings.map(op => ({ ...op, xOffset: w.len - op.xOffset - op.width }))
      : gdOpenings

    // Build continuous sub-ranges (skipping garage door gaps)
    const ranges: { u0: number; u1: number }[] = []
    if (effOpenings.length === 0) {
      ranges.push({ u0: tS, u1: tE })
    } else {
      const sorted = [...effOpenings].sort((a, b) => a.xOffset - b.xOffset)
      let cursor = tS
      for (const op of sorted) {
        const left  = Math.max(tS, op.xOffset)
        const right = Math.min(tE, op.xOffset + op.width)
        if (left > cursor + 0.01) ranges.push({ u0: cursor, u1: left })
        cursor = Math.max(cursor, right)
      }
      if (cursor < tE - 0.01) ranges.push({ u0: cursor, u1: tE })
    }

    for (let ri = 0; ri < ranges.length; ri++) {
      const rng = ranges[ri]
      // Determine if this range starts/ends at a garage door gap (needs end cap)
      // vs at a mitre corner (no end cap needed — adjacent wall continues)
      const isFirstRange = ri === 0
      const isLastRange  = ri === ranges.length - 1
      const hasGapAtStart = !isFirstRange || Math.abs(rng.u0 - tS) > 0.1
      const hasGapAtEnd   = !isLastRange  || Math.abs(rng.u1 - tE) > 0.1
      const subsegs = splitSegmentBySteps({ x0: rng.u0, x1: rng.u1 }, stepOverlaps)

      for (let k = 0; k < subsegs.length; k++) {
        const sub = subsegs[k]
        const u0 = sub.x0, u1 = sub.x1
        const elev = sub.elevate, h = bbH

        // Check neighbors for step transitions
        const prev = subsegs[k - 1]
        const next = subsegs[k + 1]

        // Determine if this segment is the HIGHER one at each end
        const higherAtStart = prev && (elev > prev.elevate + 0.1)
        const higherAtEnd   = next && (elev > next.elevate + 0.1)

        // If this is the higher segment, extend it over the lower one by the
        // step height so the dropped front face forms a square edge
        const stepAtStart = higherAtStart ? (elev - prev!.elevate) : 0
        const stepAtEnd   = higherAtEnd   ? (elev - next!.elevate) : 0
        const extU0 = higherAtStart ? u0 - stepAtStart : u0
        const extU1 = higherAtEnd   ? u1 + stepAtEnd   : u1

        // World positions on front-face and back-face lines (with extensions)
        const fx0 = w.ffx1 + extU0 * w.ux, fz0 = w.ffz1 + extU0 * w.uz
        const fx1 = w.ffx1 + extU1 * w.ux, fz1 = w.ffz1 + extU1 * w.uz
        // Back-face uses mitre-adjusted parameter at chain corners
        const bExtU0 = (isFirstRange && k === 0 && !higherAtStart && Math.abs(extU0 - tS) < 0.1) ? btS : extU0
        const bExtU1 = (isLastRange && k === subsegs.length - 1 && !higherAtEnd && Math.abs(extU1 - tE) < 0.1) ? btE : extU1
        const bx0 = w.bfx1 + bExtU0 * w.ux, bz0 = w.bfz1 + bExtU0 * w.uz
        const bx1 = w.bfx1 + bExtU1 * w.ux, bz1 = w.bfz1 + bExtU1 * w.uz

        // The front face drops down to the lower baseboard top at the extended ends
        const elev0 = higherAtStart ? (prev!.elevate + bbH) : elev
        const elev1 = higherAtEnd   ? (next!.elevate + bbH) : elev

        // Arc-length based UVs (in feet — texture.repeat handles tile scale)
        const uvX0 = (arcLens[i] + extU0 - tS) / 12
        const uvX1 = (arcLens[i] + extU1 - tS) / 12
        const uvY0L = elev0 / 12   // bottom-left (may be lower at step)
        const uvY0R = elev1 / 12   // bottom-right
        const uvY1 = (elev + h) / 12

        // Front face (facing garage interior)
        // At step transitions the bottom edge drops down on the extended side
        pushQuad(
          FT(fx0), FT(elev0),  FT(fz0), uvX0, uvY0L,
          FT(fx1), FT(elev1),  FT(fz1), uvX1, uvY0R,
          FT(fx1), FT(elev+h), FT(fz1), uvX1, uvY1,
          FT(fx0), FT(elev+h), FT(fz0), uvX0, uvY1,
          w.nx, 0, w.nz,
        )
        // Top face (facing up) — V spans the baseboard depth so texture isn't stretched
        const uvYback  = uvY1
        const uvYfront = uvY1 + BB_DEPTH / 12
        pushQuad(
          FT(bx0), FT(elev+h), FT(bz0), uvX0, uvYback,
          FT(bx1), FT(elev+h), FT(bz1), uvX1, uvYback,
          FT(fx1), FT(elev+h), FT(fz1), uvX1, uvYfront,
          FT(fx0), FT(elev+h), FT(fz0), uvX0, uvYfront,
          0, 1, 0,
        )
        // Back face against wall (same drop-down as front)
        pushQuad(
          FT(bx0), FT(elev0),  FT(bz0), uvX0, uvY0L,
          FT(bx1), FT(elev1),  FT(bz1), uvX1, uvY0R,
          FT(bx1), FT(elev+h), FT(bz1), uvX1, uvY1,
          FT(bx0), FT(elev+h), FT(bz0), uvX0, uvY1,
          -w.nx, 0, -w.nz,
        )
        // End-cap faces only at garage door gaps — NOT at mitre corners
        // Left end cap
        if (k === 0 && hasGapAtStart) {
          pushQuad(
            FT(fx0), FT(elev0), FT(fz0), 0,             elev0 / 12,
            FT(fx0), FT(elev+h), FT(fz0), 0,            uvY1,
            FT(bx0), FT(elev+h), FT(bz0), BB_DEPTH / 12, uvY1,
            FT(bx0), FT(elev0), FT(bz0), BB_DEPTH / 12, elev0 / 12,
            -w.ux, 0, -w.uz,
          )
        }
        // Right end cap
        if (k === subsegs.length - 1 && hasGapAtEnd) {
          pushQuad(
            FT(fx1), FT(elev1), FT(fz1), 0,             elev1 / 12,
            FT(bx1), FT(elev1), FT(bz1), BB_DEPTH / 12, elev1 / 12,
            FT(bx1), FT(elev+h), FT(bz1), BB_DEPTH / 12, uvY1,
            FT(fx1), FT(elev+h), FT(fz1), 0,            uvY1,
            w.ux, 0, w.uz,
          )
        }

        // Overhang faces: bottom + end cap at each step transition
        if (higherAtStart) {
          const underY = prev!.elevate + bbH
          const topY = elev + h
          // Front/back positions at the overhang edge
          const efx = w.ffx1 + extU0 * w.ux, efz = w.ffz1 + extU0 * w.uz
          const ebx = w.bfx1 + extU0 * w.ux, ebz = w.bfz1 + extU0 * w.uz
          // Front/back at the step edge
          const sfx = w.ffx1 + u0 * w.ux, sfz = w.ffz1 + u0 * w.uz
          const sbx = w.bfx1 + u0 * w.ux, sbz = w.bfz1 + u0 * w.uz
          const euvX = (arcLens[i] + extU0 - tS) / 12
          const suvX = (arcLens[i] + u0 - tS) / 12

          // Bottom face (underside of overhang)
          pushQuad(
            FT(efx), FT(underY), FT(efz), euvX, underY / 12,
            FT(sfx), FT(underY), FT(sfz), suvX, underY / 12,
            FT(sbx), FT(underY), FT(sbz), suvX, underY / 12 + BB_DEPTH / 12,
            FT(ebx), FT(underY), FT(ebz), euvX, underY / 12 + BB_DEPTH / 12,
            0, -1, 0,
          )
          // End cap (perpendicular to wall, closes the overhang edge)
          pushQuad(
            FT(efx), FT(underY), FT(efz), 0,             underY / 12,
            FT(ebx), FT(underY), FT(ebz), BB_DEPTH / 12, underY / 12,
            FT(ebx), FT(topY),   FT(ebz), BB_DEPTH / 12, topY / 12,
            FT(efx), FT(topY),   FT(efz), 0,             topY / 12,
            -w.ux, 0, -w.uz,
          )
        }
        if (higherAtEnd) {
          const underY = next!.elevate + bbH
          const topY = elev + h
          // Front/back positions at the overhang edge
          const efx = w.ffx1 + extU1 * w.ux, efz = w.ffz1 + extU1 * w.uz
          const ebx = w.bfx1 + extU1 * w.ux, ebz = w.bfz1 + extU1 * w.uz
          // Front/back at the step edge
          const sfx = w.ffx1 + u1 * w.ux, sfz = w.ffz1 + u1 * w.uz
          const sbx = w.bfx1 + u1 * w.ux, sbz = w.bfz1 + u1 * w.uz
          const euvX = (arcLens[i] + extU1 - tS) / 12
          const suvX = (arcLens[i] + u1 - tS) / 12

          // Bottom face (underside of overhang)
          pushQuad(
            FT(sfx), FT(underY), FT(sfz), suvX, underY / 12,
            FT(efx), FT(underY), FT(efz), euvX, underY / 12,
            FT(ebx), FT(underY), FT(ebz), euvX, underY / 12 + BB_DEPTH / 12,
            FT(sbx), FT(underY), FT(sbz), suvX, underY / 12 + BB_DEPTH / 12,
            0, -1, 0,
          )
          // End cap (perpendicular to wall, closes the overhang edge)
          pushQuad(
            FT(efx), FT(underY), FT(efz), 0,             underY / 12,
            FT(ebx), FT(underY), FT(ebz), BB_DEPTH / 12, underY / 12,
            FT(ebx), FT(topY),   FT(ebz), BB_DEPTH / 12, topY / 12,
            FT(efx), FT(topY),   FT(efz), 0,             topY / 12,
            w.ux, 0, w.uz,
          )
        }
      }
    }
  }

  if (pos.length === 0) return new THREE.BufferGeometry()
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uv,  2))
  geo.setAttribute('normal',   new THREE.Float32BufferAttribute(nor, 3))
  geo.setIndex(idx)
  return geo
}

// ─── Snap: wall endpoints + shape centers + floor edges ──────────────────────
function snapToTargets(
  x: number, z: number,
  walls: GarageWall[],
  shapes: GarageShape[],
  floorPts: FloorPoint[],
  excludeWallId?: string,
  excludeShapeId?: string,
  threshold = 6,
): [number, number, boolean] {
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

  // Wall endpoints get a generous threshold so corners feel magnetic
  const wallThresh = Math.max(threshold, 18)
  let bestDist = wallThresh
  let bx = x, bz = z
  let snappedToWall = false

  for (const [wx, wz] of wallPts) {
    const d = Math.hypot(x - wx, z - wz)
    if (d < bestDist) { bestDist = d; bx = wx; bz = wz; snappedToWall = true }
  }

  // Only check shapes and floor edges when not already snapped to a wall corner
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

  return [bx, bz, snappedToWall]
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

      // Corner snap: align shape edge flush with wall endpoint
      let snappedAlong = along
      const edgeToStart = along - halfAlong
      const edgeToEnd   = (len - along) - halfAlong
      if (Math.abs(edgeToStart) < cornerThresh) snappedAlong = halfAlong
      else if (Math.abs(edgeToEnd) < cornerThresh) snappedAlong = len - halfAlong

      const snapX = wall.x1 + snappedAlong * ux + targetPerp * nx
      const snapZ = wall.z1 + snappedAlong * uz + targetPerp * nz
      const baseY = wall.baseboard && wall.baseboardHeight > 0 ? wall.baseboardHeight : 0
      best = { x: snapX, z: snapZ, baseY }
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
    // If our start/end touches the middle of other wall (not at other's endpoints),
    // trim this wall so it stops at the other wall's face instead of clipping through.
    const oux = ox / olen, ouz = oz / olen
    for (const [epx, epz, isStart] of [
      [wall.x1, wall.z1, true],
      [wall.x2, wall.z2, false],
    ] as [number, number, boolean][]) {
      // Already handled as L-corner?
      if (isStart && nearStart) continue
      if (!isStart && nearEnd) continue
      // Project our endpoint onto other wall's centerline
      const vx = epx - other.x1, vz = epz - other.z1
      const along = vx * oux + vz * ouz
      const perp = Math.abs(vx * (-ouz) + vz * oux)
      // Endpoint must be ON the other wall's body (not near its endpoints)
      if (along < threshold && along > -threshold) continue       // near other's start → L-corner
      if (along > olen - threshold && along < olen + threshold) continue  // near other's end → L-corner
      if (along < -threshold || along > olen + threshold) continue // too far off
      if (perp > other.thickness / 2 + threshold) continue // too far perpendicular
      // T-junction: trim our wall at this end by other wall's half-thickness
      if (isStart) startTrim = Math.max(startTrim, other.thickness / 2)
      else         endTrim   = Math.max(endTrim,   other.thickness / 2)
    }
  }

  return { startExt, endExt, startTrim, endTrim }
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

// ─── Point-in-polygon test (floor boundary) ───────────────────────────────────
function pointInPolygon(x: number, z: number, pts: FloorPoint[]): boolean {
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

// ─── Build floor/ceiling ShapeGeometry from polygon points ───────────────────
// Shape coords: (FT(x), -FT(z)) because Rx(-π/2) maps shape-Y → world-(-Z)
// ─── Derive floor polygon from wall footprint ────────────────────────────────
// Traces walls as a connected chain to produce a stable polygon — vertex order
// follows wall topology so dragging a wall never scrambles the polygon.
function wallsToFloorPolygon(walls: GarageWall[]): FloorPoint[] | null {
  if (walls.length < 3) return null

  // Build unique nodes by merging endpoints within 6" of each other
  const nodes: { x: number; z: number }[] = []
  function nodeIdx(x: number, z: number): number {
    const i = nodes.findIndex(n => Math.hypot(n.x - x, n.z - z) < 6)
    if (i >= 0) return i
    nodes.push({ x, z })
    return nodes.length - 1
  }

  // Build adjacency graph
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

  // All nodes must have exactly 2 connections — a simple closed loop
  for (const neighbors of adj.values()) {
    if (neighbors.length !== 2) return null
  }

  // Walk the chain starting from node 0
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

// Convex hull fallback — always produces a valid polygon from any set of wall endpoints
function convexHullFromWalls(walls: GarageWall[]): FloorPoint[] {
  const pts: { x: number; z: number }[] = []
  for (const w of walls) {
    pts.push({ x: w.x1, z: w.z1 }, { x: w.x2, z: w.z2 })
  }
  if (pts.length < 3) return pts
  // Sort by x then z
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

function buildFloorGeometry(pts: FloorPoint[]): THREE.ShapeGeometry {
  if (pts.length < 3) {
    return new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(-10, -11), new THREE.Vector2(10, -11),
      new THREE.Vector2(10, 11),   new THREE.Vector2(-10, 11),
    ]))
  }
  const shape = new THREE.Shape()
  shape.moveTo(FT(pts[0].x), -FT(pts[0].z))
  for (let i = 1; i < pts.length; i++) shape.lineTo(FT(pts[i].x), -FT(pts[i].z))
  shape.closePath()
  return new THREE.ShapeGeometry(shape)
}

// ─── Cabinet mesh (procedural Tecnica-style) ──────────────────────────────────
const CAB_BODY: Record<string, string> = {
  charcoal:  '#3d3d3d',
  white:     '#f0f0ee',
  driftwood: '#7a6a58',
  slate:     '#5a6872',
  stone:     '#7a7972',
}
const CAB_DOOR: Record<string, string> = {
  charcoal:  '#8a8e96',
  white:     '#e8e8e6',
  driftwood: '#b09880',
  slate:     '#90a0a8',
  stone:     '#aaa898',
}
const CT_COLORS: Record<string, string> = {
  'butcher-block':   '#c4a070',
  'stainless-steel': '#b0b4b8',
}

/** Technica blade-style door handle: tapered bar with mounting pads at top & bottom, 1.25" protrusion. */
function technicaBladeHandle(
  prefix: string, hx: number, cy: number, doorFaceZ: number, totalH: number,
  mat: JSX.Element
): JSX.Element[] {
  const m: JSX.Element[] = []
  const top = cy + totalH / 2
  const bot = cy - totalH / 2

  // Mounting pad heights (used for bridge/bar layout, pads themselves are invisible)
  const tpH = Math.max(FT(0.8), totalH * 0.09)
  const bpH = Math.max(FT(0.6), totalH * 0.07)

  // ── Main blade bar (standing off from door, tapered) ──
  const barD = FT(0.28)
  const standoff = FT(1.0) - barD
  const barZ = doorFaceZ + standoff + barD / 2
  const barTopW = FT(0.55)
  const barBotW = FT(0.28)

  // Bridge connectors (transition from pad to bar)
  const bridgeD = standoff + barD
  const bridgeZ = doorFaceZ + bridgeD / 2
  const brH = Math.max(FT(0.2), totalH * 0.025)

  m.push(<mesh key={`${prefix}tb`} position={[hx, top - tpH - brH / 2, bridgeZ]}>{mat}<boxGeometry args={[FT(0.45), brH, bridgeD]}/></mesh>)
  m.push(<mesh key={`${prefix}bb`} position={[hx, bot + bpH + brH / 2, bridgeZ]}>{mat}<boxGeometry args={[FT(0.25), brH, bridgeD]}/></mesh>)

  // Tapered bar segments (wider at top, narrower at bottom)
  const barStart = bot + bpH + brH
  const barEnd = top - tpH - brH
  const barH = barEnd - barStart
  const segs = 8
  const segH = barH / segs
  for (let i = 0; i < segs; i++) {
    const t = segs > 1 ? i / (segs - 1) : 0.5
    const w = barBotW + (barTopW - barBotW) * t
    const y = barStart + segH * i + segH / 2
    m.push(<mesh key={`${prefix}s${i}`} position={[hx, y, barZ]}>{mat}<boxGeometry args={[w, segH + FT(0.01), barD]}/></mesh>)
  }
  return m
}

const CabinetMesh = memo(function CabinetMesh({ cabinet, selected, wireframe, blueprint, onClick, onPointerDown, overlapping, groupRef }: {
  cabinet: PlacedCabinet; selected: boolean; wireframe: boolean; blueprint?: boolean; overlapping?: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  groupRef?: (id: string, group: THREE.Group | null) => void
}) {
  const bodyHex     = blueprint ? (selected ? '#555555' : '#444444') : wireframe ? (selected ? '#ffcc00' : '#ff9944') : (CAB_BODY[cabinet.color] ?? CAB_BODY.charcoal)
  const doorHex     = blueprint ? bodyHex : wireframe ? bodyHex : (CAB_DOOR[cabinet.color] ?? CAB_DOOR.charcoal)
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
  const baseY0  = hasToeKick ? tkH : fr
  const fullY1  = hFt - fr
  // If there's a top drawer row, shrink door area down
  const doorY0  = baseY0
  const doorY1  = drawerCount > 0 && cabinet.doors > 0
    ? fullY1 - drawerCount * drawerH6 - fr  // gap between drawer and doors
    : (cabinet.doors > 0 ? fullY1 : baseY0)
  const doorH   = doorY1 - doorY0
  const doorMY  = (doorY0 + doorY1) / 2
  const doorZ   = dFt / 2 + FT(0.2)
  const doorFrontZ = doorZ + FT(0.25)  // front face of the 0.5" door panel

  // Door widths (3/4" stiles on sides, 3/4" center stile for 2-door)
  const door1W = wFt - 2 * fr
  const door2W = (wFt - 3 * fr) / 2
  const lDX    = -wFt / 2 + fr + door2W / 2
  const rDX    =  wFt / 2 - fr - door2W / 2

  const handleMat = blueprint
    ? <meshBasicMaterial color="#666666" />
    : <meshStandardMaterial color="#c0c4c8" metalness={0.55} roughness={0.35} />
  const bodyMat   = blueprint
    ? <meshBasicMaterial color={bodyHex} />
    : wireframe
    ? <meshLambertMaterial wireframe color={bodyHex} emissive={selEmissive} emissiveIntensity={selected ? 0.3 : 0} />
    : <meshPhysicalMaterial color={bodyHex} metalness={0.05} roughness={0.45} clearcoat={0.15} clearcoatRoughness={0.4} emissive={selEmissive} emissiveIntensity={selected ? 0.3 : overlapping ? 0.4 : 0} envMapIntensity={0.5} />
  const doorMat   = blueprint
    ? <meshBasicMaterial color={doorHex} />
    : wireframe
    ? <meshLambertMaterial color={doorHex} />
    : <meshPhysicalMaterial color={doorHex} metalness={0.05} roughness={0.4} clearcoat={0.2} clearcoatRoughness={0.35} envMapIntensity={0.5} />

  // Vertical bar handle dimensions (used for all doors)
  const vW = FT(0.45)   // bar width
  const vD = FT(1.1)    // bar depth (protrusion from door face)

  let handleMeshes: JSX.Element[] = []

  if (isSignature && cabinet.doors > 0) {
    // ── Signature: full-length recessed channel (indentation) flush with door face ──
    // The handle is a dark groove cut into the door at the inner edge
    const sigW  = FT(0.6)    // channel width
    const sigD  = FT(0.55)   // depth of indentation (matches door thickness so it looks carved in)
    const sigH  = doorH - FT(0.5)   // nearly full door height
    const sigY  = doorMY
    // Position flush with door front face (Z = door face, recessed inward)
    const sigZ  = doorZ - FT(0.25) + sigD / 2
    const sigMat = blueprint
      ? <meshBasicMaterial color="#222222" />
      : <meshPhysicalMaterial color="#1a1a1a" metalness={0.3} roughness={0.6} envMapIntensity={0.3} />
    if (cabinet.doors === 1) {
      // Channel at the handle side edge of single door
      const chX = handleRight ? (door1W / 2 - sigW / 2) : (-door1W / 2 + sigW / 2)
      handleMeshes.push(
        <mesh key="sig1" position={[chX, sigY, sigZ]}>{sigMat}
          <boxGeometry args={[sigW, sigH, sigD]} />
        </mesh>
      )
    } else {
      // Channel at inner edge of each door (touching the center stile)
      const chL = lDX + door2W / 2 - sigW / 2
      const chR = rDX - door2W / 2 + sigW / 2
      handleMeshes.push(
        <mesh key="sigL" position={[chL, sigY, sigZ]}>{sigMat}
          <boxGeometry args={[sigW, sigH, sigD]} />
        </mesh>,
        <mesh key="sigR" position={[chR, sigY, sigZ]}>{sigMat}
          <boxGeometry args={[sigW, sigH, sigD]} />
        </mesh>
      )
    }
  } else if (cabinet.style === 'locker') {
    // Technica Locker: 19" blade handle, inner edge of each door, centered vertically
    const vH   = FT(19)
    const vY   = (doorY0 + doorY1) / 2
    const iEdgeL =  lDX + door2W / 2 - FT(1.5)
    const iEdgeR =  rDX - door2W / 2 + FT(1.5)
    const iEdge1 = handleRight ? (-door1W / 2 + FT(1.5)) : (door1W / 2 - FT(1.5))
    if (cabinet.doors === 1) {
      handleMeshes.push(...technicaBladeHandle('lk1', iEdge1, vY, doorFrontZ, vH, handleMat))
    } else {
      handleMeshes.push(
        ...technicaBladeHandle('lkL', iEdgeL, vY, doorFrontZ, vH, handleMat),
        ...technicaBladeHandle('lkR', iEdgeR, vY, doorFrontZ, vH, handleMat)
      )
    }
  } else if (cabinet.style === 'lower' && cabinet.doors > 0) {
    // Technica Lower: 8.5" blade handle, inner edge, upper portion of door
    const vH    = FT(8.5)
    const vY    = doorY1 - vH / 2 - FT(1.5)
    const iEdgeL =  lDX + door2W / 2 - FT(1.5)
    const iEdgeR =  rDX - door2W / 2 + FT(1.5)
    const iEdge1 = handleRight ? (door1W / 2 - FT(1.5)) : (-door1W / 2 + FT(1.5))
    if (cabinet.doors === 1) {
      handleMeshes.push(...technicaBladeHandle('lw1', iEdge1, vY, doorFrontZ, vH, handleMat))
    } else {
      handleMeshes.push(
        ...technicaBladeHandle('lwL', iEdgeL, vY, doorFrontZ, vH, handleMat),
        ...technicaBladeHandle('lwR', iEdgeR, vY, doorFrontZ, vH, handleMat)
      )
    }
  } else if (cabinet.style === 'upper') {
    // Technica Upper: 8.5" blade handle, inner edge, lower portion of door
    const vH    = FT(8.5)
    const vY    = doorY0 + vH / 2 + FT(1.5)
    const iEdgeL =  lDX + door2W / 2 - FT(1.5)
    const iEdgeR =  rDX - door2W / 2 + FT(1.5)
    const iEdge1 = handleRight ? (door1W / 2 - FT(1.5)) : (-door1W / 2 + FT(1.5))
    if (cabinet.doors === 1) {
      handleMeshes.push(...technicaBladeHandle('up1', iEdge1, vY, doorFrontZ, vH, handleMat))
    } else {
      handleMeshes.push(
        ...technicaBladeHandle('upL', iEdgeL, vY, doorFrontZ, vH, handleMat),
        ...technicaBladeHandle('upR', iEdgeR, vY, doorFrontZ, vH, handleMat)
      )
    }
  }

  const setGroupRef = useCallback((g: THREE.Group | null) => {
    if (groupRef) groupRef(cabinet.id, g)
  }, [groupRef, cabinet.id])

  return (
    <group
      ref={setGroupRef}
      position={[FT(cabinet.x), FT(cabinet.y), FT(cabinet.z)]}
      rotation={[0, cabinet.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      <>
        {/* Body — Technica lower/locker: split into top section + toe-kick recess; Signature: full flat box */}
        {hasToeKick ? (<>
          <mesh position={[0, (tkH + hFt) / 2, 0]} castShadow receiveShadow>{bodyMat}
            <boxGeometry args={[wFt, hFt - tkH, dFt]} />
          </mesh>
          <mesh position={[0, tkH / 2, -tkD / 2]} castShadow>{bodyMat}
            <boxGeometry args={[wFt, tkH, dFt - tkD]} />
          </mesh>
        </>) : (
          <mesh position={[0, hFt / 2, 0]} castShadow receiveShadow>{bodyMat}
            <boxGeometry args={[wFt, hFt, dFt]} />
          </mesh>
        )}

        {!wireframe && (<>
          {/* Doors */}
          {cabinet.doors === 1 && doorH > 0 && (
            <mesh position={[0, doorMY, doorZ]} castShadow>{doorMat}
              <boxGeometry args={[door1W, doorH, FT(0.5)]} />
            </mesh>
          )}
          {cabinet.doors === 2 && doorH > 0 && (<>
            <mesh position={[lDX, doorMY, doorZ]} castShadow>{doorMat}
              <boxGeometry args={[door2W, doorH, FT(0.5)]} />
            </mesh>
            <mesh position={[rDX, doorMY, doorZ]} castShadow>{doorMat}
              <boxGeometry args={[door2W, doorH, FT(0.5)]} />
            </mesh>
          </>)}
          {/* Drawers — stacked above door area (or filling full height for drawer-only) */}
          {drawerCount > 0 && (() => {
            const meshes: JSX.Element[] = []
            const gap    = FT(0.1)   // visual gap between drawer fronts
            const drawerFW = door1W  // full width - side stiles
            // For drawer-only (doors===0): fill exactly available space top-to-bottom
            // For combo (1-drawer + 2-door): sit at top, 6" per drawer
            const drawerAreaY0 = cabinet.doors === 0 ? baseY0 : fullY1 - drawerCount * drawerH6
            const drawerAreaH  = cabinet.doors === 0 ? fullY1 - baseY0 : drawerCount * drawerH6
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
                <mesh key={`dr${i}`} position={[0, fMY, doorZ]} castShadow>{doorMat}
                  <boxGeometry args={[drawerFW, fH, FT(0.5)]} />
                </mesh>
              )
              if (isSignature) {
                // Signature: recessed bar at top edge
                const drPullY = y0 + fH - sigPullH / 2
                const drPullZ = doorZ - FT(0.25) + sigPullD / 2
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
          {/* Handles by style */}
          {handleMeshes}
        </>)}
      </>
    </group>
  )
})

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
  const isStainless = ct.color === 'stainless-steel'

  // Butcher-block: tile the wood texture proportionally to countertop size
  const bbTex = useMemo(() => {
    if (!isButcherBlock || blueprint || wireframe) return null
    const tex = getButcherBlockTex().clone()
    // Repeat so grain scale stays consistent regardless of countertop width
    tex.repeat.set(wFt / 2.5, dFt / 2.5)
    tex.needsUpdate = true
    return tex
  }, [isButcherBlock, blueprint, wireframe, wFt, dFt])

  return (
    <group
      position={[FT(ct.x), FT(ct.y), FT(ct.z)]}
      rotation={[0, ct.rotY, 0]}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      onPointerDown={onPointerDown}
    >
      <mesh position={[0, tFt / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[wFt, tFt, dFt]} />
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
          <meshStandardMaterial
            color={col}
            roughness={0.25}
            metalness={0.7}
            emissive={selected ? '#445566' : '#000000'}
            emissiveIntensity={selected ? 0.25 : 0}
            envMapIntensity={0.8}
          />
        ) : (
          <meshStandardMaterial color={col}
            roughness={0.45} metalness={0.05}
            emissive={selected ? '#445566' : '#000000'} emissiveIntensity={selected ? 0.25 : 0} />
        )}
      </mesh>
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

  // Deck top sits at ceiling - drop
  const deckTopY = chFt - dropFt
  const deckCenterY = deckTopY - deckTh / 2

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
        const matProps = {
          color: frameColor,
          metalness: 0.6 as number,
          roughness: 0.35 as number,
          emissive: selected ? '#ffcc00' : '#000000',
          emissiveIntensity: highlight,
        }
        const wireMat = {
          color: wireframe ? frameColor : '#888888',
          metalness: 0.7 as number,
          roughness: 0.3 as number,
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
        const bMat = {
          color: frameColor, metalness: 0.6 as number, roughness: 0.3 as number,
          emissive: selected ? '#ffcc00' : '#000000', emissiveIntensity: highlight,
        }

        return (
          <group key={i}>
            {/* Leg tube */}
            <mesh position={pos} castShadow>
              <boxGeometry args={[legSz, legLen, legSz]} />
              <meshPhysicalMaterial
                wireframe={wireframe}
                color={frameColor}
                metalness={0.5}
                roughness={0.35}
                emissive={selected ? '#ffcc00' : '#000000'}
                emissiveIntensity={highlight}
              />
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

function CeilingLightMesh({ light, chFt, selected, wireframe, onClick, onPointerDown }: {
  light: CeilingLight; chFt: number; selected: boolean; wireframe: boolean
  onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const { bounceIntensity, bounceDistance, lightMultiplier, qualityPreset, isExporting } = useGarageStore()
  const effectiveQuality = isExporting ? 'high' : qualityPreset
  // Fixture hangs just below ceiling — small gap avoids z-fighting
  const yCenter = chFt - CEILING_LIGHT_TH / 2 - 0.02
  const frameColor  = wireframe ? (selected ? '#ffcc00' : '#ff9944') : '#d0d0cc'
  const diffuseColor = light.enabled
    ? (wireframe ? frameColor : light.color)
    : '#555555'

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

      {/* Inner diffuser panel — sits just below frame bottom so it's visible */}
      {!wireframe && (
        <mesh position={[0, bottomY - 0.005, 0]}>
          <boxGeometry args={[innerW, 0.01, innerL]} />
          <meshStandardMaterial
            color="#e8e8e8"
            emissive={diffuseColor}
            emissiveIntensity={light.enabled ? Math.min(light.intensity * 1.2, 10) : 0}
            toneMapped={true}
            roughness={0.3}
          />
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
            intensity={light.intensity * lightMultiplier}
            color={light.color}
          />
          {/* Omni-directional bounce fill — simulates light scattering off the floor
             back onto walls. Positioned well below the fixture so it doesn't
             illuminate the ceiling, and uses low intensity relative to the main
             rect area light. */}
          <pointLight
            position={[0, bottomY - 1.5, 0]}
            intensity={light.intensity * bounceIntensity}
            color={light.color}
            decay={2}
            distance={bounceDistance}
            castShadow={effectiveQuality !== 'low'}
            shadow-mapSize-width={effectiveQuality === 'high' ? 512 : 256}
            shadow-mapSize-height={effectiveQuality === 'high' ? 512 : 256}
            shadow-bias={-0.002}
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

// ─── Per-chain baseboard mesh (world-space, seamless) ────────────────────────
function BaseboardChain({ chain, floorSteps, cx, cz, baseTex, wireframe, side = 'interior' }: {
  chain: ChainEntry[]
  floorSteps: FloorStep[]
  cx: number; cz: number
  baseTex: THREE.Texture | null
  wireframe: boolean
  side?: 'interior' | 'exterior'
}) {
  const geo = useMemo(
    () => buildBaseboardChainGeo(chain, floorSteps, cx, cz, side),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chain, floorSteps, cx, cz, side],
  )
  const bbWall = chain.find(e => e.wall.baseboard && e.wall.baseboardHeight > 0)?.wall
  const bbColor  = wireframe ? '#2a6a9a' : (bbWall?.baseboardColor ?? '#cccccc')
  // Only use flake texture if baseTex is loaded and valid (support multiple image types)
  function isTextureLoaded(tex: any) {
    if (!tex || !tex.image) return false;
    const img = tex.image;
    if (typeof window !== 'undefined' && window.Image && img instanceof window.Image) {
      return img.naturalWidth > 0;
    }
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      return img.width > 0;
    }
    if (img instanceof HTMLCanvasElement) {
      return img.width > 0;
    }
    if (typeof img.width === 'number') {
      return img.width > 0;
    }
    return false;
  }
  const isBaseTexValid = isTextureLoaded(baseTex);
  const useFlake = !wireframe && chain.some(e => e.wall.baseboardTexture) && isBaseTexValid;
  // Fallback color if both color and texture are missing
  const fallbackColor = '#ff00ff' // bright magenta for debug
  return (
    <mesh geometry={geo} frustumCulled={false}>
      <meshStandardMaterial
        key={`bb-mat-${useFlake}-${bbColor}-${wireframe}`}
        color={useFlake ? '#ffffff' : (bbColor || fallbackColor)}
        map={useFlake ? baseTex : null}
        wireframe={wireframe}
        roughness={0.85}
        side={THREE.DoubleSide}
        depthWrite
        polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1}
      />
    </mesh>
  )
}

// ─── Scene-level seamless baseboard renderer ──────────────────────────────────
function GarageBaseboards({ walls, floorSteps, baseTex, wireframe }: {
  walls: GarageWall[]; floorSteps: FloorStep[]
  baseTex: THREE.Texture | null; wireframe: boolean
}) {
  const cx = useMemo(() => walls.length > 0 ? walls.reduce((s, w) => s + (w.x1 + w.x2) / 2, 0) / walls.length : 0, [walls])
  const cz = useMemo(() => walls.length > 0 ? walls.reduce((s, w) => s + (w.z1 + w.z2) / 2, 0) / walls.length : 0, [walls])
  const chains = useMemo(() => findWallChains(walls), [walls])
  if (!walls.some(w => w.baseboard && w.baseboardHeight > 0)) return null
  return <>
    {chains.flatMap((chain, ci) =>
      chain.some(e => e.wall.baseboard && e.wall.baseboardHeight > 0)
        ? [
            <BaseboardChain key={`int-${ci}`} chain={chain} floorSteps={floorSteps}
              cx={cx} cz={cz} baseTex={baseTex} wireframe={wireframe} side="interior" />,
            <BaseboardChain key={`ext-${ci}`} chain={chain} floorSteps={floorSteps}
              cx={cx} cz={cz} baseTex={baseTex} wireframe={wireframe} side="exterior" />,
          ]
        : []
    )}
  </>
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
  return <ImportedTextureMaterial dataUrl={asset.data} widthFt={widthFt} heightFt={heightFt} selected={selected} />
}

/** Material for an imported texture (data URL) applied to a wall or floor */
function ImportedTextureMaterial({ dataUrl, widthFt, heightFt, selected }: {
  dataUrl: string; widthFt: number; heightFt: number; selected: boolean
}) {
  const tex = useTexture(dataUrl)
  const cloned = useClonedTexture(tex)
  useMemo(() => {
    if (!cloned) return
    cloned.wrapS = cloned.wrapT = THREE.RepeatWrapping
    cloned.repeat.set(widthFt / 4, heightFt / 4)
  }, [cloned, widthFt, heightFt])

  return (
    <meshStandardMaterial
      map={cloned || null}
      roughness={0.7}
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

// ─── Stem wall mesh (flush with wall, floor-matched flake texture) ────────────
// Splits into horizontal segments that skip garage-door openings that reach the floor.
function StemWallMesh({ lengthIn, heightIn, thickFt, texture, wallColor, baseTex, wireframe, blueprint, openings, onClick, onPointerDown }: {
  lengthIn: number; heightIn: number; thickFt: number
  texture: 'concrete' | 'flake' | 'none'; wallColor: string
  baseTex: THREE.Texture | null; wireframe: boolean; blueprint: boolean
  openings: WallOpening[]
  onClick: () => void; onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  const swH = FT(heightIn)
  const concreteColor = '#a8a098'
  const stemColor = wireframe ? '#6a8a6a' : (texture === 'none' ? wallColor : concreteColor)

  // Build horizontal segments that skip openings whose bottom edge is at or below stem wall height
  const segments = useMemo(() => {
    const cuts = openings
      .filter(op => op.yOffset < heightIn) // opening bottom is within stem wall range
      .sort((a, b) => a.xOffset - b.xOffset)
    if (cuts.length === 0) return [{ x0: 0, x1: lengthIn }]
    const segs: { x0: number; x1: number }[] = []
    let cursor = 0
    for (const op of cuts) {
      const left = Math.max(0, op.xOffset)
      const right = Math.min(lengthIn, op.xOffset + op.width)
      if (left > cursor) segs.push({ x0: cursor, x1: left })
      cursor = Math.max(cursor, right)
    }
    if (cursor < lengthIn) segs.push({ x0: cursor, x1: lengthIn })
    return segs
  }, [openings, lengthIn, heightIn])

  // Validate baseTex is loaded (support HTMLImageElement, ImageBitmap, HTMLCanvasElement)
  function isTextureLoaded(tex: any) {
    if (!tex || !tex.image) return false
    const img = tex.image
    if (typeof window !== 'undefined' && window.Image && img instanceof window.Image) return img.naturalWidth > 0
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) return img.width > 0
    if (img instanceof HTMLCanvasElement) return img.width > 0
    if (typeof img.width === 'number') return img.width > 0
    return false
  }

  const useFlake = texture === 'flake' && !wireframe && isTextureLoaded(baseTex)
  const rptPerFoot = baseTex?.repeat.x ?? 1

  return (
    <>
      {segments.map((seg, i) => {
        const segW = seg.x1 - seg.x0
        const localX = FT(-lengthIn / 2 + seg.x0 + segW / 2)
        const segWFt = FT(segW)
        return (
          <mesh key={i} position={[localX, swH / 2, 0]}
            onClick={(e) => { e.stopPropagation(); onClick() }}
            onPointerDown={onPointerDown}
            receiveShadow castShadow
          >
            <boxGeometry args={[segWFt, swH, thickFt + FT(0.05)]} />
            {blueprint ? (
              <meshBasicMaterial key={`sw-${texture}-bp`} color={stemColor} />
            ) : (
              <StemWallMaterial
                useFlake={useFlake} baseTex={baseTex}
                segWidthIn={segW} heightIn={heightIn} rptPerFoot={rptPerFoot}
                stemColor={stemColor} texture={texture} wireframe={wireframe}
              />
            )}
          </mesh>
        )
      })}
    </>
  )
}

// Extracted material so each segment gets its own cloned texture with correct repeat
function StemWallMaterial({ useFlake, baseTex, segWidthIn, heightIn, rptPerFoot, stemColor, texture, wireframe }: {
  useFlake: boolean; baseTex: THREE.Texture | null
  segWidthIn: number; heightIn: number; rptPerFoot: number
  stemColor: string; texture: string; wireframe: boolean
}) {
  const stemTex = useMemo(() => {
    if (!useFlake || !baseTex) return null
    const t = baseTex.clone()
    t.repeat.set(FT(segWidthIn) * rptPerFoot, FT(heightIn) * rptPerFoot)
    t.needsUpdate = true
    return t
  }, [baseTex, useFlake, segWidthIn, heightIn, rptPerFoot])

  return (
    <meshStandardMaterial
      key={`sw-${texture}-${useFlake}-${wireframe}`}
      color={useFlake ? '#ffffff' : stemColor}
      map={useFlake ? stemTex : null}
      roughness={useFlake ? 0.7 : (texture === 'concrete' ? 0.95 : 0.7)}
      wireframe={wireframe}
    />
  )
}

// ─── Individual wall mesh ─────────────────────────────────────────────────────
const WallMesh = memo(function WallMesh({ wall, wireframe, blueprint, selected, onClick, onPointerDown, startExt, endExt, startTrim, endTrim, baseTex }: {
  wall: GarageWall; wireframe: boolean; blueprint?: boolean; selected: boolean; onClick: () => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  startExt: number; endExt: number; startTrim: number; endTrim: number
  baseTex: THREE.Texture | null
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

  // Build segments then clip at trimmed ends so they don't overlap adjacent walls
  const segs = useMemo(() => {
    let s = buildWallSegments(wall, lengthIn)
    if (startTrim > 0 && s.length > 0) {
      s[0] = { ...s[0], x0: Math.max(s[0].x0, startTrim) }
      s = s.filter(seg => seg.x1 > seg.x0)
    }
    if (endTrim > 0 && s.length > 0) {
      const last = s.length - 1
      s[last] = { ...s[last], x1: Math.min(s[last].x1, lengthIn - endTrim) }
      s = s.filter(seg => seg.x1 > seg.x0)
    }
    return s
  }, [wall, lengthIn, startTrim, endTrim])
  const hFt         = FT(wall.height)

  // Render 3D meshes for 'door' and 'window' openings
  const openingMeshes = wall.openings?.filter(op => op.type === 'door' || op.type === 'window').map((op, i) => {
    const opW = FT(op.width)
    const opH = FT(op.height)
    const opT = FT(2)
    const opD = thickFt + FT(2)
    const along = op.xOffset + op.width / 2 - lengthIn / 2
    const y = op.yOffset + op.height / 2

    // Use GLB model if selected
    if (op.modelId && getOpeningModelById(op.modelId)) {
      return (
        <group key={op.id || i} position={[FT(along), FT(y), 0]}>
          <OpeningGLBModel modelId={op.modelId} widthIn={op.width} heightIn={op.height} />
        </group>
      )
    }

    // Fallback: box geometry with optional texture
    const isDoor = op.type === 'door'
    const defaultColor = isDoor ? '#b8b4a8' : '#87CEEB'
    return (
      <group key={op.id || i}>
        <mesh position={[FT(along), FT(y), opD / 2]}>
          <boxGeometry args={[opW, opH, opT]} />
          {!wireframe && op.textureId && getTextureById(op.textureId)
            ? <TexturedDoorMaterial textureId={op.textureId} widthFt={opW} heightFt={opH} />
            : <meshLambertMaterial color={wireframe ? '#ffcc00' : defaultColor}
                transparent={op.type === 'window'} opacity={op.type === 'window' ? 0.4 : 1} />
          }
        </mesh>
        {/* Window frame */}
        {op.type === 'window' && !wireframe && (
          <group position={[FT(along), FT(y), opD / 2]}>
            {/* Top bar */}
            <mesh position={[0, opH / 2 - FT(1), 0]}>
              <boxGeometry args={[opW, FT(2), opT + FT(1)]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
            {/* Bottom bar */}
            <mesh position={[0, -opH / 2 + FT(1), 0]}>
              <boxGeometry args={[opW, FT(2), opT + FT(1)]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
            {/* Left bar */}
            <mesh position={[-opW / 2 + FT(1), 0, 0]}>
              <boxGeometry args={[FT(2), opH, opT + FT(1)]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
            {/* Right bar */}
            <mesh position={[opW / 2 - FT(1), 0, 0]}>
              <boxGeometry args={[FT(2), opH, opT + FT(1)]} />
              <meshStandardMaterial color="#e0e0e0" roughness={0.4} />
            </mesh>
          </group>
        )}
      </group>
    )
  }) || [];

  return (
    <group position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
      {segs.map((seg, i) => {
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
            {hasWallTexture
              ? isImportedWallTex
                ? <ImportedWallTexture assetId={wall.wallTextureId!.replace('imported:', '')} widthFt={segW} heightFt={segH} selected={selected} />
                : <TexturedWallMaterial textureId={wall.wallTextureId!} widthFt={segW} heightFt={segH} selected={selected} />
              : blueprint
                ? <meshBasicMaterial color={color} />
                : <meshLambertMaterial wireframe={wireframe} color={color} />
            }
          </mesh>
        )
      })}

      {/* Stem wall — flush with wall face at the bottom, split around openings */}
      {wall.stemWall && (wall.stemWallHeight ?? 0) > 0 && (
        <StemWallMesh
          lengthIn={lengthIn} heightIn={wall.stemWallHeight ?? 6} thickFt={thickFt}
          texture={wall.stemWallTexture ?? 'concrete'} wallColor={wall.wallColor ?? '#e0dedd'}
          baseTex={baseTex} wireframe={wireframe} blueprint={!!blueprint}
          openings={wall.openings ?? []}
          onClick={onClick} onPointerDown={onPointerDown}
        />
      )}

      {/* 3D Door & window meshes */}
      {!blueprint && openingMeshes}

      {/* Corner fill boxes */}
      {startExt > 0 && (
        <mesh position={[FT(-lengthIn / 2 - startTrim - startExt / 2), hFt / 2, 0]}
          onClick={(e) => { e.stopPropagation(); onClick() }} onPointerDown={onPointerDown}>
          <boxGeometry args={[FT(startExt), hFt, thickFt]} />
          {blueprint
            ? <meshBasicMaterial color={color} />
            : <meshLambertMaterial wireframe={wireframe} color={color} />
          }
        </mesh>
      )}
      {endExt > 0 && (
        <mesh position={[FT(lengthIn / 2 - endTrim + endExt / 2), hFt / 2, 0]}
          onClick={(e) => { e.stopPropagation(); onClick() }} onPointerDown={onPointerDown}>
          <boxGeometry args={[FT(endExt), hFt, thickFt]} />
          {blueprint
            ? <meshBasicMaterial color={color} />
            : <meshLambertMaterial wireframe={wireframe} color={color} />
          }
        </mesh>
      )}

      {/* Garage-door thresholds — floor-textured patch across the wall thickness */}
      {baseTex && wall.openings.filter(op => op.type === 'garage-door').map(op => (
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
  )
})

// ─── Drag handle sphere ───────────────────────────────────────────────────────
function DragHandle({ position, color, size = 0.2, onPointerDown }: {
  position: [number, number, number]; color: string; size?: number
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
}) {
  return (
    <group position={position} onPointerDown={onPointerDown}>
      {/* Solid fill — one mesh, one material */}
      <mesh renderOrder={100} frustumCulled={false}>
        <sphereGeometry args={[size * 1.5, 18, 14]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
      {/* Wireframe overlay — separate mesh so each has exactly one material */}
      <mesh renderOrder={101} frustumCulled={false}>
        <sphereGeometry args={[size * 1.8, 12, 8]} />
        <meshBasicMaterial color={'#ffea00'} depthTest={false} wireframe={true} />
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
  // Offset slatwall center past wall face to prevent Z-fighting
  // Exterior panels go on the opposite side of the wall
  const sideSign = panel.side === 'exterior' ? -1 : 1
  const localZ = sideSign * FT(wall.thickness / 2 + 0.6)

  const hex       = slatwallColors.find(c => c.id === panel.color)?.hex ?? '#f2f2f0'
  const grooveHex = darkenHex(hex, 0.28)
  const roughness = slatRoughness(hex)   // dark colors get frosted/matte finish

  // Geometry layout (panel total = 1" thick):
  //   back plate:  3/4" thick, center at localZ - 1/8"  (front face = groove bottom)
  //   board strips: 1/4" thick, center at localZ + 3/8" (front face = panel face)
  // sideSign flips depth offsets so exterior panels face outward
  const backPlateZ = localZ - sideSign * FT(0.125)
  const boardFaceZ = localZ + sideSign * FT(0.375)

  // Trim: 1.5" wide, 0.5" proud of panel front face
  const trimW     = FT(1.5)
  const trimThick = FT(0.5)
  const trimZ     = localZ + sideSign * (FT(0.5) + trimThick / 2)

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

  const trimMat = <meshLambertMaterial color={hex} />

  return (
    <group position={[midX, 0, midZ]} rotation={[0, rotY, 0]}>
      {/* Interaction group — stops propagation for all child meshes */}
      <group onClick={(e) => { e.stopPropagation(); onClick() }} onPointerDown={onPointerDown}>
      {/* Back plate — visible inside grooves, slightly darker */}
      <mesh position={[localX, localY, backPlateZ]}>
        <boxGeometry args={[wFt, hFt, FT(0.75)]} />
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
const FloorStepMesh = memo(function FloorStepMesh({ step, baseTex, wireframe, selected, onClick, onPointerDown, onCornerDown }: {
  step: FloorStep
  baseTex: THREE.Texture
  wireframe: boolean
  selected: boolean
  onClick: (e: ThreeEvent<MouseEvent>) => void
  onPointerDown: (e: ThreeEvent<PointerEvent>) => void
  onCornerDown: (corner: 0 | 1 | 2 | 3, e: ThreeEvent<PointerEvent>) => void
}) {
  const w = FT(step.width), d = FT(step.depth), h = FT(step.height)

  // Clone each texture once (only when baseTex changes) — avoids re-creating WebGL textures
  // every drag frame. Repeat is a plain Vector2; mutating it here during render is safe because
  // Three.js reads it when building material uniforms, which happens after React renders.
  // BoxGeometry material order: +X(0), -X(1), +Y/top(2), -Y/bottom(3), +Z(4), -Z(5)
  const stepTex  = useMemo(() => { const t = baseTex.clone(); t.needsUpdate = true; return t }, [baseTex])
  const sideXTex = useMemo(() => { const t = baseTex.clone(); t.needsUpdate = true; return t }, [baseTex])
  const sideZTex = useMemo(() => { const t = baseTex.clone(); t.needsUpdate = true; return t }, [baseTex])

  // Synchronously update repeat during render — no useEffect lag
  stepTex.repeat.set(w * baseTex.repeat.x,  d * baseTex.repeat.y)   // top: width × depth
  sideXTex.repeat.set(d * baseTex.repeat.x, h * baseTex.repeat.y)   // ±X sides: depth × height
  sideZTex.repeat.set(w * baseTex.repeat.x, h * baseTex.repeat.y)   // ±Z sides: width × height

  const HANDLE_R = FT(5)
  const corners: [number, number, number, 0 | 1 | 2 | 3][] = [
    [-w / 2, h + HANDLE_R, -d / 2, 0],
    [ w / 2, h + HANDLE_R, -d / 2, 1],
    [ w / 2, h + HANDLE_R,  d / 2, 2],
    [-w / 2, h + HANDLE_R,  d / 2, 3],
  ]

  const wfColor = selected ? '#00e5ff' : '#1a2a3a'

  // Sink the step group 0.025" below y=0 so the bottom face is hidden under the floor
  // surface — eliminates floor/step z-fighting without any visual difference on top.
  const SINK = FT(0.025)

  return (
    <group position={[FT(step.x), -SINK, FT(step.z)]}>
      <mesh
        position={[0, h / 2, 0]}
        receiveShadow castShadow
        onClick={onClick}
        onPointerDown={onPointerDown}
      >
        <boxGeometry args={[w, h, d]} />
        {/* +X/-X sides (depth×height), +Y top (width×depth), -Y bottom, +Z/-Z sides (width×height) */}
        {/* Side faces get a slight positive polygonOffset so baseboard risers (with negative offset) always render in front */}
        <meshStandardMaterial attach="material-0" map={wireframe ? null : sideXTex} color={wireframe ? wfColor : '#ffffff'} wireframe={wireframe} roughness={0.85} polygonOffset polygonOffsetFactor={3} polygonOffsetUnits={6} />
        <meshStandardMaterial attach="material-1" map={wireframe ? null : sideXTex} color={wireframe ? wfColor : '#ffffff'} wireframe={wireframe} roughness={0.85} polygonOffset polygonOffsetFactor={3} polygonOffsetUnits={6} />
        <meshStandardMaterial attach="material-2"
          map={wireframe ? null : stepTex}
          color={wireframe ? wfColor : '#ffffff'}
          wireframe={wireframe}
          roughness={wireframe ? 1 : 0.15}
          metalness={wireframe ? 0 : 0.05}
          emissive={selected && !wireframe ? '#004466' : '#000000'}
          emissiveIntensity={selected && !wireframe ? 0.08 : 0}
        />
        {/* Bottom face: pushed further from camera so the floor always wins */}
        <meshStandardMaterial attach="material-3" color={wireframe ? wfColor : '#888'} wireframe={wireframe} roughness={0.9} polygonOffset polygonOffsetFactor={6} polygonOffsetUnits={12} />
        <meshStandardMaterial attach="material-4" map={wireframe ? null : sideZTex} color={wireframe ? wfColor : '#ffffff'} wireframe={wireframe} roughness={0.85} polygonOffset polygonOffsetFactor={3} polygonOffsetUnits={6} />
        <meshStandardMaterial attach="material-5" map={wireframe ? null : sideZTex} color={wireframe ? wfColor : '#ffffff'} wireframe={wireframe} roughness={0.85} polygonOffset polygonOffsetFactor={3} polygonOffsetUnits={6} />
      </mesh>

      {/* Sphere corner handles — elevated above the step so they're always clickable
          from any camera angle. depthTest=false ensures visibility through the step. */}
      {selected && !wireframe && corners.map(([cx, cy, cz, corner]) => (
        <mesh
          key={corner}
          position={[cx, cy, cz]}
          onPointerDown={e => { e.stopPropagation(); onCornerDown(corner, e) }}
          onClick={e => e.stopPropagation()}
        >
          <sphereGeometry args={[HANDLE_R, 10, 7]} />
          <meshBasicMaterial color="#00aaff" depthTest={false} />
        </mesh>
      ))}
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
    const { startExt: startAdj, endExt: endAdj } = computeCornerAdj(wall, walls)
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
  hitX: number; hitZ: number   // floor hit at drag start (feet)
  initX: number; initZ: number // step center at drag start (inches)
}

/** Dragging one corner of a floor step to resize it on the floor plane */
interface FloorStepCornerDragState {
  stepId: string
  corner: 0 | 1 | 2 | 3  // 0=NW(-X,-Z), 1=NE(+X,-Z), 2=SE(+X,+Z), 3=SW(-X,+Z)
  fixedX: number           // inches — opposite corner X (stays anchored)
  fixedZ: number           // inches — opposite corner Z (stays anchored)
}

/** Dragging the body of a slatwall panel to slide it along and up/down the wall */
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

function GLBModel({ type, tw, th, td }: { type: string; tw: number; th: number; td: number }) {
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}assets/models/${type}.glb`)
  const { scale, ox, oy, oz } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = box.getSize(new THREE.Vector3())
    if (size.lengthSq() < 0.0001) return { scale: 1, ox: 0, oy: 0, oz: 0 }
    const s = Math.min(tw / size.x, th / size.y, td / size.z)
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
  return <primitive object={cloned} scale={scale} position={[ox, oy, oz]} />
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

  return (
    <group
      position={[px, 0, pz]}
      rotation={[0, rotY, 0]}
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
              <GLBModel type={item.type} tw={tw} th={th} td={td} />
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
    floorSteps, selectedFloorStepId, selectFloorStep, updateFloorStep: updateFloorStepAction,
    deleteFloorStep,
    cabinets, selectedCabinetId, selectCabinet, updateCabinet,
    countertops, selectedCountertopId, selectCountertop, updateCountertop,
    sceneLights, updateSceneLight,
    ceilingLights, selectedCeilingLightId, selectCeilingLight, updateCeilingLight,
    viewMode, selectedWallId, selectWall, selectShape,
    updateWall, updateShape, setFloorSelected, setIsDraggingWall, beginDrag, endDrag,
    updateSlatwallPanel, selectSlatwallPanel,
    items, selectedItemId, selectItem, updateItem,
    overheadRacks, selectedRackId, selectRack, updateRack,
    slatwallAccessories, selectedAccessoryId, selectSlatwallAccessory,
    qualityPreset, isExporting,
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
    () => wallsToFloorPolygon(walls) ?? (walls.length >= 3 ? convexHullFromWalls(walls) : floorPoints),
    [walls, floorPoints],
  )

  // Always-fresh refs
  const wallsRef        = useRef(walls);                    useEffect(() => { wallsRef.current = walls }, [walls])
  const racksRef        = useRef(overheadRacks);              useEffect(() => { racksRef.current = overheadRacks }, [overheadRacks])
  const shapesRef       = useRef(shapes);                   useEffect(() => { shapesRef.current = shapes }, [shapes])
  const floorPtsRef     = useRef(effectiveFloorPts);        useEffect(() => { floorPtsRef.current = effectiveFloorPts }, [effectiveFloorPts])
  const slatsRef        = useRef(slatwallPanels);  useEffect(() => { slatsRef.current = slatwallPanels }, [slatwallPanels])
  const cabinetsRef     = useRef(cabinets);         useEffect(() => { cabinetsRef.current = cabinets }, [cabinets])
  const updateWallRef   = useRef(updateWall);      useEffect(() => { updateWallRef.current = updateWall }, [updateWall])
  const updateShapeRef  = useRef(updateShape);     useEffect(() => { updateShapeRef.current = updateShape }, [updateShape])
  const updateSlatRef       = useRef(updateSlatwallPanel); useEffect(() => { updateSlatRef.current = updateSlatwallPanel }, [updateSlatwallPanel])
  const slatwallPanelsRef   = useRef(slatwallPanels);      useEffect(() => { slatwallPanelsRef.current = slatwallPanels }, [slatwallPanels])
  const updateCabRef    = useRef(updateCabinet);    useEffect(() => { updateCabRef.current = updateCabinet }, [updateCabinet])
  const countertopsRef  = useRef(countertops);       useEffect(() => { countertopsRef.current = countertops }, [countertops])
  const updateCtRef     = useRef(updateCountertop);  useEffect(() => { updateCtRef.current = updateCountertop }, [updateCountertop])
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
  const slatBodyDragRef     = useRef<SlatwallBodyDragState | null>(null)
  const slatCornerDragRef   = useRef<SlatwallCornerDragState | null>(null)
  const cabinetDragRef      = useRef<CabinetDragState | null>(null)
  // Direct mesh mutation: registry of cabinet Three.js groups + transient drag position
  const cabinetGroupRefs    = useRef<Record<string, THREE.Group>>({})
  const cabinetDragPosRef   = useRef<{ x: number; z: number; y: number; rotY: number } | null>(null)
  const registerCabinetGroup = useCallback((id: string, group: THREE.Group | null) => {
    if (group) cabinetGroupRefs.current[id] = group
    else delete cabinetGroupRefs.current[id]
  }, [])
  const countertopDragRef   = useRef<CountertopDragState | null>(null)
  const lightDragRef        = useRef<LightDragState | null>(null)
  const ceilingLightDragRef = useRef<CeilingLightDragState | null>(null)
  const itemDragRef         = useRef<{ itemId: string; startXFt: number; startZFt: number; startHitX: number; startHitZ: number } | null>(null)
  const rackDragRef         = useRef<{ rackId: string; startXIn: number; startZIn: number; startHitX: number; startHitZ: number } | null>(null)
  const floorStepDragRef    = useRef<FloorStepDragState | null>(null)
  const floorStepCornerDragRef = useRef<FloorStepCornerDragState | null>(null)
  const suppressNextClick   = useRef(false)

  const [_wallDragActive, setWallDragActive] = useState(false)
  const [_activeSnapPt, setActiveSnapPt]     = useState<{x: number, z: number} | null>(null)

  // Snap indicator lines for visual feedback during drag
  const [snapLines, setSnapLines] = useState<{ from: [number, number, number]; to: [number, number, number]; color: string }[]>([])

  // Modifier key tracking — Shift disables snap, held state tracked via refs for perf
  const modKeysRef = useRef({ shift: false, ctrl: false })
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
    setWallDragActive(true)
  }, [beginDrag, setWallDragActive, floorHit])


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
    const hit = floorHit(e.nativeEvent.clientX, e.nativeEvent.clientY)
    if (!hit) return
    floorStepDragRef.current = {
      stepId,
      hitX: hit.x, hitZ: hit.z,
      initX: step.x, initZ: step.z,
    }
    beginDrag()
  }, [floorHit, beginDrag, selectFloorStep])

  // ── Start floor step corner drag ────────────────────��───────────────────
  const startFloorStepCornerDrag = useCallback((
    stepId: string, corner: 0 | 1 | 2 | 3,
    e: ThreeEvent<PointerEvent>,
  ) => {
    if (e.nativeEvent.button !== 0) return
    e.stopPropagation()
    e.nativeEvent.stopImmediatePropagation()
    const step = floorStepsRef.current.find(s => s.id === stepId)
    if (!step) return
    const halfW = step.width / 2, halfD = step.depth / 2
    // Corner positions: 0=NW, 1=NE, 2=SE, 3=SW
    const cxs = [step.x - halfW, step.x + halfW, step.x + halfW, step.x - halfW]
    const czs = [step.z - halfD, step.z - halfD, step.z + halfD, step.z + halfD]
    const opp = ((corner + 2) % 4) as 0 | 1 | 2 | 3
    floorStepCornerDragRef.current = { stepId, corner, fixedX: cxs[opp], fixedZ: czs[opp] }
    selectFloorStep(stepId)
    beginDrag()
  }, [selectFloorStep, beginDrag])

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
        cabinetDragRef.current || countertopDragRef.current || lightDragRef.current ||
        ceilingLightDragRef.current || itemDragRef.current || rackDragRef.current || floorStepDragRef.current || floorStepCornerDragRef.current
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
          const bbH      = (dragWall?.baseboard && dragWall.baseboardHeight > 0) ? dragWall.baseboardHeight : 0

          let newBottom = snapToGrid(sbd.startYBottom + dHeight)
          // Snap to baseboard top within 3"
          if (bbH > 0 && Math.abs(newBottom - bbH) <= 3) newBottom = bbH
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
            const bbH   = cWall.baseboard ? cWall.baseboardHeight : 0
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
              // bottom handle — clamp to baseboard top (or floor)
              changes.yBottom = Math.max(bbH, Math.min(heightIn, panel.yTop - 6))
            }
            updateSlatRef.current(sc.panelId, changes)
          }
        }
        return
      }

      // Ceiling light drag — ceiling plane, XZ only
      const cld = ceilingLightDragRef.current
      if (cld) {
        const chFt = FT(wallsRef.current.reduce((h, w) => Math.max(h, w.height), 108))
        const hitCl = ceilingHit(e.clientX, e.clientY, chFt)
        if (hitCl) {
          const dx = hitCl.x - cld.startHitX, dz = hitCl.z - cld.startHitZ
          updateCeilLtRef.current(cld.lightId, {
            x: Math.round((cld.startXFt + dx) * 4) / 4,
            z: Math.round((cld.startZFt + dz) * 4) / 4,
          })
        }
        return
      }

      // Overhead rack drag — ceiling plane, XZ only (stored in inches)
      const rd = rackDragRef.current
      if (rd) {
        const chFt = FT(wallsRef.current.reduce((h, w) => Math.max(h, w.height), 108))
        const hitR = ceilingHit(e.clientX, e.clientY, chFt)
        if (hitR) {
          const dxIn = (hitR.x - rd.startHitX) * 12
          const dzIn = (hitR.z - rd.startHitZ) * 12
          const gridX = snapToGrid(rd.startXIn + dxIn)
          const gridZ = snapToGrid(rd.startZIn + dzIn)
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
              if (bestEdgeDist < 12) {
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
        const skipSnap = modKeysRef.current.shift
        const dx = curXIn - wd.hitX, dz = curZIn - wd.hitZ
        if (wd.endpoint === 'start') {
          const rawX = S(wd.initX1 + dx), rawZ = S(wd.initZ1 + dz)
          if (skipSnap) {
            updateWallRef.current(wd.wallId, { x1: rawX, z1: rawZ })
          } else {
            const [sx, sz, cornerSnap] = snapToTargets(rawX, rawZ, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            const [nx, nz] = cornerSnap ? [sx, sz] : snapAngle(wd.initX2, wd.initZ2, sx, sz)
            updateWallRef.current(wd.wallId, { x1: nx, z1: nz })
          }
        } else if (wd.endpoint === 'end') {
          const rawX = S(wd.initX2 + dx), rawZ = S(wd.initZ2 + dz)
          if (skipSnap) {
            updateWallRef.current(wd.wallId, { x2: rawX, z2: rawZ })
          } else {
            const [sx, sz, cornerSnap] = snapToTargets(rawX, rawZ, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            const [nx, nz] = cornerSnap ? [sx, sz] : snapAngle(wd.initX1, wd.initZ1, sx, sz)
            updateWallRef.current(wd.wallId, { x2: nx, z2: nz })
          }
        } else {
          const rawX1 = S(wd.initX1 + dx), rawZ1 = S(wd.initZ1 + dz)
          const rawX2 = S(wd.initX2 + dx), rawZ2 = S(wd.initZ2 + dz)
          if (skipSnap) {
            updateWallRef.current(wd.wallId, { x1: rawX1, z1: rawZ1, x2: rawX2, z2: rawZ2 })
          } else {
            const [sx1, sz1] = snapToTargets(rawX1, rawZ1, wallsRef.current, shapesRef.current, floorPtsRef.current, wd.wallId)
            const sdx = sx1 - rawX1, sdz = sz1 - rawZ1
            updateWallRef.current(wd.wallId, { x1: sx1, z1: sz1, x2: rawX2 + sdx, z2: rawZ2 + sdz })
          }
        }
        return
      }

      // Shape drag
      const sd = shapeDragRef.current
      if (sd) {
        const shape = shapesRef.current.find(s => s.id === sd.shapeId)
        if (!shape) return
        const dx = clamp(curXIn - sd.startXIn), dz = clamp(curZIn - sd.startZIn)
        const rawX = S(sd.rawX + dx), rawZ = S(sd.rawZ + dz)

        // Wall-face snap (edge alignment + corner snap + baseboard height)
        const wallSnap = snapShapeToWalls(rawX, rawZ, shape.w, shape.d, wallsRef.current)
        if (wallSnap) {
          // Auto-set y: always for cylinders (columns), or if shape bottom is at/near floor
          const isFloorLevel = shape.type === 'cylinder' || (shape.y - shape.h / 2) <= 6
          const newY = isFloorLevel ? wallSnap.baseY + shape.h / 2 : shape.y
          updateShapeRef.current(sd.shapeId, { x: wallSnap.x, z: wallSnap.z, y: newY })
        } else {
          // Fallback: snap to wall endpoints / shape centers / floor edges
          const [nx, nz] = snapToTargets(rawX, rawZ, wallsRef.current, shapesRef.current, floorPtsRef.current, undefined, sd.shapeId)
          updateShapeRef.current(sd.shapeId, { x: nx, z: nz })
        }
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
            const skipSnap = modKeysRef.current.shift
            // Offset-based floor movement (cabinet stays under grab point)
            const dx = hit.x * 12 - cd.startHitXIn
            const dz = hit.z * 12 - cd.startHitZIn
            const rawX = skipSnap ? (cd.startXIn + dx) : snapToGrid(cd.startXIn + dx)
            const rawZ = skipSnap ? (cd.startZIn + dz) : snapToGrid(cd.startZIn + dz)

            // Set up ray for wall-face Y tracking (reuse pre-allocated objects)
            const rect = gl.domElement.getBoundingClientRect()
            _tmpNdc.set(
              ((e.clientX - rect.left) / rect.width) * 2 - 1,
              ((e.clientY - rect.top)  / rect.height) * -2 + 1,
            )
            ray.setFromCamera(_tmpNdc, cameraRef.current)

            // Check for wall snap — only snap when cabinet center is within 20" of wall face
            // Shift key disables wall/cabinet snapping
            const WALL_SNAP_DIST = skipSnap ? 0 : 20
            let wallSnap: { x: number; z: number; y: number; rotY: number; dist: number } | null = null
            for (const wall of wallsRef.current) {
              const wdx = wall.x2 - wall.x1, wdz = wall.z2 - wall.z1
              const len = Math.hypot(wdx, wdz)
              if (len < 1) continue
              const ux = wdx / len, uz = wdz / len
              const nx = -uz, nz = ux  // interior face normal

              // Project cabinet position onto wall coordinate system
              const relX = rawX - wall.x1, relZ = rawZ - wall.z1
              const along = relX * ux + relZ * uz
              const perp  = relX * nx + relZ * nz

              // Must be within wall span (with half-width margin)
              if (along < -cab.w / 2 || along > len + cab.w / 2) continue

              // Distance from cabinet center to wall interior face position
              const slatwallOnWall = slatwallPanelsRef.current.some(p => p.wallId === wall.id)
              const slatwallExtra = slatwallOnWall ? 1 : 0
              const targetPerp = wall.thickness / 2 + cab.d / 2 + slatwallExtra
              const perpDist = Math.abs(perp - targetPerp)

              // Only snap if on interior side and close enough
              if (perp <= 0 || perpDist > WALL_SNAP_DIST) continue

              let snappedAlong = snapToGrid(Math.max(0, Math.min(along, len)))
              // Corner snap: lock cabinet edge flush with adjacent wall interior face
              const { startTrim: cAdj0, endTrim: cAdj1 } = computeCornerAdj(wall, wallsRef.current)
              if (cAdj0 > 0 && Math.abs(snappedAlong - cab.w / 2 - cAdj0) < 2) snappedAlong = cAdj0 + cab.w / 2
              if (cAdj1 > 0 && Math.abs(snappedAlong + cab.w / 2 - (len - cAdj1)) < 2) snappedAlong = len - cAdj1 - cab.w / 2
              const cabCx = wall.x1 + snappedAlong * ux + nx * targetPerp
              const cabCz = wall.z1 + snappedAlong * uz + nz * targetPerp
              if (!pointInPolygon(cabCx, cabCz, floorPtsRef.current)) continue

              // Get Y from wall-face plane intersection so cabinet slides up/down the wall
              _tmpVec3.set(FT(cabCx), 0, FT(cabCz))
              _tmpPlane.setFromNormalAndCoplanarPoint(
                _tmpNormal.set(nx, 0, nz), _tmpVec3
              )
              let cabY = cab.y
              if (ray.ray.intersectPlane(_tmpPlane, _tmpVec3b)) {
                cabY = Math.max(0, snapToGrid(_tmpVec3b.y * 12))
              }

              // Snap cabinet Y to step-up + baseboard heights
              const Y_SNAP = 8  // inches threshold
              const bbH = wall.baseboard ? wall.baseboardHeight : 0
              // Build Y snap targets: floor, baseboard, step tops, baseboard-on-step
              const yTargets: number[] = [0]
              if (bbH > 0) yTargets.push(bbH)
              for (const step of floorStepsRef.current) {
                const overlaps = getStepWallOverlaps(wall, step, len)
                for (const ov of overlaps) {
                  // Only snap if cabinet overlaps this step horizontally
                  if (snappedAlong + cab.w / 2 > ov.u0 && snappedAlong - cab.w / 2 < ov.u1) {
                    yTargets.push(ov.stepHeight)
                    if (bbH > 0) yTargets.push(ov.stepHeight + bbH)
                  }
                }
              }
              // Find closest Y snap target
              for (const yt of yTargets) {
                if (Math.abs(cabY - yt) < Y_SNAP) { cabY = yt; break }
              }

              if (!wallSnap || perpDist < wallSnap.dist) {
                wallSnap = { x: cabCx, z: cabCz, y: cabY, rotY: -Math.atan2(wdz, wdx), dist: perpDist }
              }
            }

            if (wallSnap) {
              bestPos = { x: wallSnap.x, z: wallSnap.z, y: wallSnap.y, rotY: wallSnap.rotY }
            } else if (pointInPolygon(rawX, rawZ, floorPtsRef.current)) {
              // When on the floor, sit on top of any step the cabinet is over
              let floorY = 0
              for (const step of floorStepsRef.current) {
                const halfW = step.width / 2, halfD = step.depth / 2
                if (rawX > step.x - halfW && rawX < step.x + halfW &&
                    rawZ > step.z - halfD && rawZ < step.z + halfD) {
                  floorY = Math.max(floorY, step.height)
                }
              }
              bestPos = { x: rawX, z: rawZ, y: floorY, rotY: cab.rotY }
            }
          }

          if (bestPos) {
            const skipSnap = modKeysRef.current.shift
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

      // Floor step corner drag — resize by dragging corners on the floor plane
      const fscd = floorStepCornerDragRef.current
      if (fscd) {
        const hit = floorHit(e.clientX, e.clientY)
        if (hit) {
          let hx = hit.x * 12, hz = hit.z * 12
          // Snap dragged corner to wall interior faces (axis-aligned walls only)
          const SNAP = 5  // inches
          for (const wall of wallsRef.current) {
            if (Math.abs(wall.z1 - wall.z2) < 2) {
              // Horizontal wall — snap Z
              const wz = (wall.z1 + wall.z2) / 2
              const faceZ = wz + (wz < 0 ? 1 : -1) * wall.thickness / 2
              if (Math.abs(hz - faceZ) < SNAP) hz = faceZ
            }
            if (Math.abs(wall.x1 - wall.x2) < 2) {
              // Vertical wall — snap X
              const wx = (wall.x1 + wall.x2) / 2
              const faceX = wx + (wx < 0 ? 1 : -1) * wall.thickness / 2
              if (Math.abs(hx - faceX) < SNAP) hx = faceX
            }
          }
          const newX = (hx + fscd.fixedX) / 2
          const newZ = (hz + fscd.fixedZ) / 2
          const newW = Math.max(12, Math.abs(hx - fscd.fixedX))
          const newD = Math.max(6,  Math.abs(hz - fscd.fixedZ))
          updateFloorStepRef.current(fscd.stepId, { x: newX, z: newZ, width: newW, depth: newD })
        }
        return
      }

      // Floor step body drag (floor plane) — snap step edges to wall interior faces
      const fsd = floorStepDragRef.current
      if (fsd) {
        const hit = floorHit(e.clientX, e.clientY)
        if (hit) {
          const step = floorStepsRef.current.find(s => s.id === fsd.stepId)
          const dx = hit.x - fsd.hitX, dz = hit.z - fsd.hitZ
          let newX = snapToGrid(fsd.initX + dx * 12)
          let newZ = snapToGrid(fsd.initZ + dz * 12)
          if (step) {
            const SNAP = 5
            const halfW = step.width / 2, halfD = step.depth / 2
            for (const wall of wallsRef.current) {
              if (Math.abs(wall.z1 - wall.z2) < 2) {
                const wz = (wall.z1 + wall.z2) / 2
                const faceZ = wz + (wz < 0 ? 1 : -1) * wall.thickness / 2
                if (Math.abs(newZ - halfD - faceZ) < SNAP) newZ = faceZ + halfD
                if (Math.abs(newZ + halfD - faceZ) < SNAP) newZ = faceZ - halfD
              }
              if (Math.abs(wall.x1 - wall.x2) < 2) {
                const wx = (wall.x1 + wall.x2) / 2
                const faceX = wx + (wx < 0 ? 1 : -1) * wall.thickness / 2
                if (Math.abs(newX - halfW - faceX) < SNAP) newX = faceX + halfW
                if (Math.abs(newX + halfW - faceX) < SNAP) newX = faceX - halfW
              }
            }
          }
          updateFloorStepRef.current(fsd.stepId, { x: newX, z: newZ })
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
      const wasDragging = wallDragRef.current || shapeDragRef.current || floorPointDragRef.current || vertDragRef.current || slatBodyDragRef.current || slatCornerDragRef.current || cabinetDragRef.current || countertopDragRef.current || lightDragRef.current || ceilingLightDragRef.current || itemDragRef.current || rackDragRef.current || floorStepDragRef.current || floorStepCornerDragRef.current
      wallDragRef.current = null
      shapeDragRef.current = null
      floorPointDragRef.current = null
      vertDragRef.current = null
      slatBodyDragRef.current = null
      slatCornerDragRef.current = null
      cabinetDragRef.current = null
      countertopDragRef.current = null
      lightDragRef.current = null
      ceilingLightDragRef.current = null
      rackDragRef.current = null
      itemDragRef.current = null
      floorStepDragRef.current = null
      floorStepCornerDragRef.current = null
      if (wasDragging) { endDrag(); suppressNextClick.current = true; setSnapLines([]) }
      setWallDragActive(false)
      setActiveSnapPt(null)
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
  const floorTex = useTexture(`${import.meta.env.BASE_URL}${flooringTexturePathById(flooringColor)}`)

  // Build a de-tiled composite canvas to break the obvious repeating grid pattern.
  // Each cell of the composite is rotated 0/90/180/270° using a deterministic pattern
  // so the epoxy chip flakes never align across cells, but individual chip size is preserved.
  const detileFloorTex = useMemo(() => {
    const img = floorTex.image as (HTMLImageElement & { width: number; height: number }) | null
    if (!img) return floorTex  // fallback: texture not yet decoded
    // Support both HTMLImageElement (.naturalWidth) and ImageBitmap (.width)
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
        // Deterministic 90° rotation per cell — no two adjacent cells share the same rotation
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
    // Set color space for correct color rendering
    tex.colorSpace = THREE.SRGBColorSpace
    // ShapeGeometry UVs are in feet; scale so the composite canvas maps at same chip density
    const tilesPerFoot = 12 / floorTextureScale
    tex.repeat.set(tilesPerFoot * tileW / SIZE, tilesPerFoot * tileH / SIZE)
    tex.needsUpdate = true
    return tex
  }, [floorTex, floorTextureScale])

  const floorGeo = useMemo(() => buildFloorGeometry(effectiveFloorPts), [effectiveFloorPts])
  const chFt = FT(ceilingHeight)

  // Precompute corner adjustments for all walls — avoids O(n²) per frame
  const cornerAdjMap = useMemo(() => {
    const map = new Map<string, { startExt: number; endExt: number; startTrim: number; endTrim: number }>()
    for (const wall of walls) {
      map.set(wall.id, computeCornerAdj(wall, walls))
    }
    return map
  }, [walls])

  // Deselect everything when clicking empty space (floor, walls, ceiling)
  const handleDeselect = () => {
    selectWall(null); selectShape(null); selectSlatwallPanel(null); selectCabinet(null); selectCountertop(null); selectFloorStep(null); setFloorSelected(false); selectItem(null); selectCeilingLight(null); selectRack(null)
  }

  return (
    <group>
      {/* Floor — polygon shape, fills entire interior area */}
      <mesh geometry={floorGeo} rotation={[-Math.PI/2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        {wireframe ? (
          <meshStandardMaterial side={THREE.DoubleSide}
            color='#1a2a3a' wireframe
          />
        ) : blueprint ? (
          <meshBasicMaterial side={THREE.DoubleSide} color='#ffffff' />
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
            resolution={effectiveQuality === 'high' ? 512 : 256}
            mixBlur={0.95}
            mixStrength={floorReflection * 0.8}
            mixContrast={0.6}
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
        />
      ))}

      {/* Ceiling — hidden in blueprint top-down view */}
      {!blueprint && (
        <mesh geometry={floorGeo} rotation={[-Math.PI/2, 0, 0]} position={[0, chFt, 0]}>
          <meshLambertMaterial side={THREE.BackSide}
            color={wireframe ? '#1a2a3a' : '#e8e8e8'} wireframe={wireframe} />
        </mesh>
      )}

      {/* Walls */}
      {walls.map(wall => {
        const { startExt, endExt, startTrim, endTrim } = cornerAdjMap.get(wall.id) ?? { startExt: 0, endExt: 0, startTrim: 0, endTrim: 0 }
        const isSel = selectedWallId === wall.id
        const wallLen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
        // Always allow selection and drag in one click
        const handleWallDown = (e: ThreeEvent<PointerEvent>) => {
          selectWall(wall.id);
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
              selected={isSel}
              onClick={() => { if (suppressNextClick.current) { suppressNextClick.current = false; return } selectWall(wall.id) }}
              onPointerDown={handleWallDown}
              startExt={startExt} endExt={endExt} startTrim={startTrim} endTrim={endTrim}
              baseTex={detileFloorTex} />
            {isSel && !selectedSlatwallPanelId && <>
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

      {/* Seamless baseboards — hidden in blueprint view */}
      {!blueprint && <GarageBaseboards walls={walls} floorSteps={floorSteps}
        baseTex={detileFloorTex} wireframe={wireframe} />}

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
          <CabinetMesh key={cab.id} cabinet={cab} wireframe={wireframe} blueprint={blueprint} selected={isSel}
            overlapping={cabinetOverlapsAny(cab, cabinets)}
            onClick={() => selectCabinet(cab.id)}
            onPointerDown={startDrag}
            groupRef={registerCabinetGroup}
          />
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
      {ceilingLights.map(light => {
        const isSel = selectedCeilingLightId === light.id
        return (
          <CeilingLightMesh
            key={light.id}
            light={light}
            chFt={chFt}
            selected={isSel}
            wireframe={wireframe}
            onClick={() => selectCeilingLight(light.id)}
            onPointerDown={(e) => {
              if (e.nativeEvent.button !== 0) return
              e.stopPropagation()
              e.nativeEvent.stopImmediatePropagation()
              selectCeilingLight(light.id)
              const hit = ceilingHit(e.nativeEvent.clientX, e.nativeEvent.clientY, chFt)
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
      })}

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
