/**
 * Top-down silhouette cache for placed 3D items.
 *
 * Loads a GLB once per `key` (catalog `type` or `imported:<assetId>`), walks
 * its triangle vertices, projects onto the XZ plane, and runs Andrew's
 * monotone chain to produce a convex hull polygon. The polygon is
 * NORMALIZED — centered on origin and scaled so its longest side equals 1
 * inch — so callers can multiply by their item's display width/depth.
 *
 * Used by the floor plan to draw a top-down outline that matches the actual
 * model shape (e.g. cars look car-shaped, not just rectangles).
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export interface NormalizedHull {
  /** Convex hull points in 2D, normalized so longest extent = 1. Y axis = world Z. */
  points: [number, number][]
  /** The model's own (unscaled) width along X in world units. */
  modelW: number
  /** The model's own (unscaled) depth along Z in world units. */
  modelD: number
  /** The model's own (unscaled) height along Y in world units. Needed so
   *  the floor plan can compute the same scale factor the 3D view uses
   *  (which scales by max(X, Y, Z) of the model). */
  modelH: number
  /** Feature line segments (sharp creases / silhouette lines from each mesh's
   *  EdgesGeometry), projected to XZ and normalized to the same coordinate
   *  space as `points`. Each segment is `[x1, z1, x2, z2]`. */
  featureLines: [number, number, number, number][]
  /** Pre-rendered top-down line drawing as a data URL (PNG). Coordinates
   *  span [-0.5, 0.5] mapped onto the canvas's longer axis, with the
   *  shorter axis centered. Render in SVG as a single <image> for speed. */
  snapshotDataUrl: string
}

const hullCache = new Map<string, NormalizedHull | null>()
const inflight  = new Map<string, Promise<NormalizedHull | null>>()
const listeners = new Set<() => void>()

/** Subscribe to cache updates so React components can re-render. */
export function subscribeHullCache(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function notify() { for (const cb of listeners) cb() }

/** Look up a cached hull synchronously. Returns undefined if not yet loaded. */
export function getCachedHull(key: string): NormalizedHull | null | undefined {
  return hullCache.get(key)
}

/** Kick off a load if not already cached/in-flight. Resolves to the hull. */
export function loadHull(key: string, url: string): Promise<NormalizedHull | null> {
  if (hullCache.has(key)) return Promise.resolve(hullCache.get(key) ?? null)
  const existing = inflight.get(key)
  if (existing) return existing

  const p = new Promise<NormalizedHull | null>((resolve) => {
    const loader = new GLTFLoader()
    loader.load(url, (gltf) => {
      try {
        const hull = computeHull(gltf.scene)
        hullCache.set(key, hull)
        resolve(hull)
      } catch {
        hullCache.set(key, null)
        resolve(null)
      }
      inflight.delete(key)
      notify()
    }, undefined, () => {
      hullCache.set(key, null)
      inflight.delete(key)
      notify()
      resolve(null)
    })
  })
  inflight.set(key, p)
  return p
}

/** Walk the scene, collect XZ projections for the hull AND extract sharp
 *  feature edges from each mesh's geometry projected onto XZ. */
function computeHull(scene: THREE.Object3D): NormalizedHull | null {
  const pts: [number, number][] = []
  let minY = Infinity, maxY = -Infinity
  // Raw edge segments in world coords before normalization.
  const rawEdges: [number, number, number, number][] = []
  const m = new THREE.Matrix4()
  const v = new THREE.Vector3()
  const v2 = new THREE.Vector3()
  scene.updateWorldMatrix(true, true)
  scene.traverse((obj: any) => {
    if (!obj.isMesh || !obj.geometry) return
    const geom = obj.geometry as THREE.BufferGeometry
    const pos = geom.attributes.position
    if (!pos) return
    m.copy(obj.matrixWorld)
    // Hull point cloud — strided to keep work bounded for huge models.
    const stride = Math.max(1, Math.floor(pos.count / 1500))
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m)
      pts.push([v.x, v.z])
      if (v.y < minY) minY = v.y
      if (v.y > maxY) maxY = v.y
    }
    // Feature edges — Three.js's EdgesGeometry keeps edges where adjacent
    // face normals differ by more than thresholdAngle (default 1°). 30° gives
    // a clean technical-illustration look: silhouette + body creases without
    // every triangle edge. Each edge is two consecutive vertices in `position`.
    try {
      const edges = new THREE.EdgesGeometry(geom, 30)
      const ep = edges.attributes.position
      if (!ep) return
      // Skip ridiculous edge counts (some imported models have millions).
      const maxEdges = 4000
      const eStride = Math.max(2, Math.floor((ep.count / 2) / maxEdges) * 2)
      for (let i = 0; i + 1 < ep.count; i += eStride) {
        v.fromBufferAttribute(ep, i).applyMatrix4(m)
        v2.fromBufferAttribute(ep, i + 1).applyMatrix4(m)
        rawEdges.push([v.x, v.z, v2.x, v2.z])
      }
      edges.dispose()
    } catch { /* skip non-triangle geometries */ }
  })
  if (pts.length < 3) return null

  const hull = convexHull(pts)
  if (hull.length < 3) return null

  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z
  }
  const modelW = Math.max(0.0001, maxX - minX)
  const modelD = Math.max(0.0001, maxZ - minZ)
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const longest = Math.max(modelW, modelD)
  const inv = 1 / longest

  const norm: [number, number][] = hull.map(([x, z]) => [(x - cx) * inv, (z - cz) * inv])
  // Drop degenerate edges (zero or near-zero length after projection — these
  // are vertical edges that collapse to a point on the XZ plane).
  const minLen2 = 1e-6
  const featureLines: [number, number, number, number][] = []
  for (const [x1, z1, x2, z2] of rawEdges) {
    const dx = x2 - x1, dz = z2 - z1
    if (dx * dx + dz * dz < minLen2) continue
    featureLines.push([
      (x1 - cx) * inv, (z1 - cz) * inv,
      (x2 - cx) * inv, (z2 - cz) * inv,
    ])
  }
  const modelH = Math.max(0.0001, maxY - minY)
  const snapshotDataUrl = renderSnapshot(norm, featureLines, modelW / longest, modelD / longest)
  return { points: norm, modelW, modelD, modelH, featureLines, snapshotDataUrl }
}

/** Rasterize the hull + feature lines once to a PNG so the floor plan can
 *  draw a single <image> per item instead of hundreds of <line>s. */
function renderSnapshot(
  hull: [number, number][],
  edges: [number, number, number, number][],
  normW: number,
  normD: number,
): string {
  // High resolution so the bitmap stays crisp when the user zooms the floor
  // plan. 1024² is ~4 MB raw but compresses to <100 KB as PNG and renders
  // as a single image — far faster than thousands of SVG line elements.
  const SIZE = 1024
  const PAD = 12
  const usable = SIZE - 2 * PAD
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // Coordinates are in [-0.5, 0.5] for both axes (the longest = 1 axis spans
  // -0.5..0.5; the shorter axis spans a smaller range but uses the same
  // scale). Map to canvas pixels with a small padding.
  const toX = (x: number) => SIZE / 2 + x * usable
  const toY = (z: number) => SIZE / 2 + z * usable
  void normW; void normD

  ctx.imageSmoothingEnabled = true

  // Feature lines underneath — black, semi-transparent for readability.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const [x1, z1, x2, z2] of edges) {
    ctx.moveTo(toX(x1), toY(z1))
    ctx.lineTo(toX(x2), toY(z2))
  }
  ctx.stroke()

  // Outline on top — bold black.
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)'
  ctx.lineWidth = 4
  ctx.beginPath()
  hull.forEach(([x, z], i) => {
    const px = toX(x), py = toY(z)
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py)
  })
  ctx.closePath()
  ctx.stroke()

  return canvas.toDataURL('image/png')
}

/** Andrew's monotone chain convex hull. Returns CCW outline. */
function convexHull(points: [number, number][]): [number, number][] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop(); upper.pop()
  return lower.concat(upper)
}
