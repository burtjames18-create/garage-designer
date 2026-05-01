/**
 * Geometry decimation cache for wireframe mode.
 *
 * GLB models often ship with hundreds of thousands of triangles, which
 * looks visually noisy as a wireframe. We run Three.js's SimplifyModifier
 * once per geometry to drop ~60% of the faces, then cache the simplified
 * BufferGeometry so the next render reuses it. The simplifier is slow (can
 * take seconds for huge meshes), so the cache is essential — without it
 * every prop change would re-decimate.
 */
import * as THREE from 'three'
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js'

const TARGET_REMOVE_RATIO = 0.6  // remove 60% of triangles
const cache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()

/** Get a decimated copy of a geometry (cached). Falls back to the original
 *  geometry if simplification fails or yields nothing usable. */
export function getDecimatedGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = cache.get(src)
  if (cached) return cached

  // SimplifyModifier requires non-indexed, position-only geometry without
  // morph attributes. Strip everything but `position` to keep it happy.
  const stripped = new THREE.BufferGeometry()
  const pos = src.attributes.position
  if (!pos) {
    cache.set(src, src)
    return src
  }

  // If indexed, expand to non-indexed first (SimplifyModifier handles
  // either, but non-indexed is the safer path across versions).
  const working = src.index ? src.toNonIndexed() : src.clone()
  stripped.setAttribute('position', working.attributes.position)

  const triCount = stripped.attributes.position.count / 3
  const removeCount = Math.floor(triCount * TARGET_REMOVE_RATIO)
  if (removeCount < 10) {
    cache.set(src, src)
    return src
  }

  try {
    const modifier = new SimplifyModifier()
    const simplified = modifier.modify(stripped, removeCount) as THREE.BufferGeometry
    if (!simplified || !simplified.attributes.position || simplified.attributes.position.count < 9) {
      cache.set(src, src)
      return src
    }
    cache.set(src, simplified)
    return simplified
  } catch {
    cache.set(src, src)
    return src
  }
}
