/**
 * Optimizes imported 3D models to reduce file size and improve runtime performance.
 *
 * Strategies:
 * 1. Downscale large textures (biggest win — textures are often 80%+ of GLB size)
 * 2. Simplify high-poly meshes (reduce triangle count)
 * 3. Merge duplicate materials
 * 4. Re-export as optimized GLB
 */
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const MAX_TEXTURE_SIZE = 1024  // Downscale any texture larger than this
const MAX_TRIANGLES = 200_000  // Target triangle budget for the whole model

/** Downscale a texture to maxSize, returns a new texture from a canvas */
function downscaleTexture(texture: THREE.Texture, maxSize: number): THREE.Texture {
  const image = texture.image
  if (!image) return texture

  let w = image.width || image.naturalWidth || 0
  let h = image.height || image.naturalHeight || 0
  if (w <= maxSize && h <= maxSize) return texture

  // Calculate new dimensions maintaining aspect ratio
  const scale = maxSize / Math.max(w, h)
  const nw = Math.round(w * scale)
  const nh = Math.round(h * scale)

  const canvas = document.createElement('canvas')
  canvas.width = nw
  canvas.height = nh
  const ctx = canvas.getContext('2d')
  if (!ctx) return texture

  ctx.drawImage(image, 0, 0, nw, nh)

  const newTex = new THREE.CanvasTexture(canvas)
  newTex.wrapS = texture.wrapS
  newTex.wrapT = texture.wrapT
  newTex.repeat.copy(texture.repeat)
  newTex.offset.copy(texture.offset)
  newTex.encoding = texture.encoding
  newTex.colorSpace = texture.colorSpace
  newTex.flipY = texture.flipY
  newTex.needsUpdate = true

  return newTex
}

/** Simple mesh decimation: keep every Nth vertex to hit target triangle count */
function decimateGeometry(geo: THREE.BufferGeometry, targetTriangles: number): THREE.BufferGeometry {
  const index = geo.index
  const totalTriangles = index ? index.count / 3 : (geo.attributes.position?.count ?? 0) / 3
  if (totalTriangles <= targetTriangles) return geo

  // For indexed geometry, thin out triangles uniformly
  if (index) {
    const ratio = targetTriangles / totalTriangles
    const oldIndices = index.array
    const keepCount = Math.floor(oldIndices.length * ratio / 3) * 3
    const newIndices = new (oldIndices.constructor as any)(keepCount)

    // Keep evenly spaced triangles
    const step = totalTriangles / (keepCount / 3)
    let outIdx = 0
    for (let i = 0; i < keepCount / 3; i++) {
      const srcTri = Math.floor(i * step) * 3
      if (srcTri + 2 < oldIndices.length) {
        newIndices[outIdx++] = oldIndices[srcTri]
        newIndices[outIdx++] = oldIndices[srcTri + 1]
        newIndices[outIdx++] = oldIndices[srcTri + 2]
      }
    }

    const decimated = geo.clone()
    decimated.setIndex(new THREE.BufferAttribute(newIndices.slice(0, outIdx), 1))
    return decimated
  }

  return geo
}

/** Count total triangles in a scene */
function countTriangles(obj: THREE.Object3D): number {
  let total = 0
  obj.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh
      const geo = mesh.geometry
      if (geo.index) {
        total += geo.index.count / 3
      } else if (geo.attributes.position) {
        total += geo.attributes.position.count / 3
      }
    }
  })
  return total
}

/**
 * Optimize a Three.js scene in-place:
 * - Downscale textures
 * - Decimate high-poly meshes
 * - Merge vertices
 */
export function optimizeScene(scene: THREE.Object3D): { trianglesBefore: number; trianglesAfter: number; texturesDownscaled: number } {
  const trianglesBefore = countTriangles(scene)
  let texturesDownscaled = 0

  // Track processed textures to avoid duplicates
  const processedTextures = new Set<number>()

  scene.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh

      // 1. Downscale textures on materials
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of materials) {
        if (!mat) continue
        const texProps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const
        for (const prop of texProps) {
          const tex = (mat as any)[prop] as THREE.Texture | null
          if (tex && tex.image && !processedTextures.has(tex.id)) {
            processedTextures.add(tex.id)
            const w = tex.image.width || tex.image.naturalWidth || 0
            if (w > MAX_TEXTURE_SIZE) {
              ;(mat as any)[prop] = downscaleTexture(tex, MAX_TEXTURE_SIZE)
              texturesDownscaled++
            }
          }
        }
      }

      // 2. Decimate geometry if over budget
      const geo = mesh.geometry
      const meshTris = geo.index ? geo.index.count / 3 : (geo.attributes.position?.count ?? 0) / 3
      if (trianglesBefore > MAX_TRIANGLES && meshTris > 1000) {
        const meshBudget = Math.floor(meshTris * (MAX_TRIANGLES / trianglesBefore))
        mesh.geometry = decimateGeometry(geo, Math.max(meshBudget, 100))
      }

      // 3. Merge duplicate vertices
      try {
        if (mesh.geometry.index === null && mesh.geometry.attributes.position) {
          mesh.geometry = mergeVertices(mesh.geometry)
        }
      } catch (_) { /* some geometries can't be merged */ }
    }
  })

  const trianglesAfter = countTriangles(scene)
  return { trianglesBefore, trianglesAfter, texturesDownscaled }
}

/** Optimize and re-export a scene as a GLB ArrayBuffer */
export async function optimizeAndExportGLB(scene: THREE.Object3D): Promise<{ buffer: ArrayBuffer; stats: ReturnType<typeof optimizeScene> }> {
  const stats = optimizeScene(scene)

  const exporter = new GLTFExporter()
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(scene, (result) => {
      resolve(result as ArrayBuffer)
    }, reject, { binary: true })
  })

  return { buffer, stats }
}
