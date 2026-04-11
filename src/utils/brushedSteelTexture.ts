import * as THREE from 'three'

/**
 * Procedural brushed stainless-steel textures — anisotropic value-noise
 * approach. Uses 2D value noise with very asymmetric X/Y scaling (wide in X,
 * narrow in Y) so the noise field stretches into flowing horizontal streaks
 * with natural breakups and subtle curvature — closer to real brushed metal
 * than a pure row-based heightfield, which reads as stripes.
 *
 * Two octaves are layered: a low-frequency octave for soft wide bands and a
 * higher-frequency octave for the fine brush detail on top. Output textures:
 *
 *   - color:     silver base with streaks carrying the value variation
 *   - normal:    Y-axis gradient of the heightfield → horizontal grooves
 *   - roughness: coupled to streak value (brighter = slightly less rough)
 */

const TEX_W = 2048
const TEX_H = 1024

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Deterministic 2D value noise helper.
// Builds a lattice of random values then does bilinear interp with a
// smoothstep-shaped fade, producing C1-continuous noise.
function makeValueNoise(latW: number, latH: number, rand: () => number) {
  const lattice = new Float32Array(latW * latH)
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand()
  const smooth = (t: number) => t * t * (3 - 2 * t)
  return (u: number, v: number) => {
    // u, v are in 0..1 (tiled via wrap)
    const x = u * latW
    const y = v * latH
    const x0 = Math.floor(x), x1 = (x0 + 1) % latW
    const y0 = Math.floor(y), y1 = (y0 + 1) % latH
    const fx = smooth(x - Math.floor(x))
    const fy = smooth(y - Math.floor(y))
    const v00 = lattice[((y0 + latH) % latH) * latW + ((x0 + latW) % latW)]
    const v10 = lattice[((y0 + latH) % latH) * latW + x1]
    const v01 = lattice[((y1 + latH) % latH) * latW + ((x0 + latW) % latW)]
    const v11 = lattice[((y1 + latH) % latH) * latW + x1]
    const a = v00 * (1 - fx) + v10 * fx
    const b = v01 * (1 - fx) + v11 * fx
    return a * (1 - fy) + b * fy
  }
}

export function createBrushedSteelTextures(): {
  map: THREE.CanvasTexture
  normalMap: THREE.CanvasTexture
  roughnessMap: THREE.CanvasTexture
} {
  const rand = mulberry32(23)

  // ── Build the anisotropic heightfield ───────────────────────────────────
  // Two octaves of value noise, each with stretched X resolution so the
  // noise field flows in the X direction as long horizontal streaks.
  //
  // Low-frequency octave: 8 x 256 lattice (very wide, narrow)
  //   → broad soft bands running horizontally.
  // High-frequency octave: 32 x 1024 (still wide, finer)
  //   → fine streak detail on top of the broad bands.
  // Both lattices wrap so the texture tiles seamlessly.
  const noiseLow  = makeValueNoise(8, 256, rand)
  const noiseHigh = makeValueNoise(32, 1024, rand)

  const heights = new Float32Array(TEX_W * TEX_H)
  for (let y = 0; y < TEX_H; y++) {
    const v = y / TEX_H
    for (let x = 0; x < TEX_W; x++) {
      const u = x / TEX_W
      // Combine octaves — 65% low, 35% high
      const n = 0.65 * noiseLow(u, v) + 0.35 * noiseHigh(u, v)
      heights[y * TEX_W + x] = n
    }
  }

  // Remap heights to fill the 0..1 range (noise sum naturally lives ~0.2..0.8)
  let hMin = Infinity, hMax = -Infinity
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < hMin) hMin = heights[i]
    if (heights[i] > hMax) hMax = heights[i]
  }
  const hRange = hMax - hMin || 1
  for (let i = 0; i < heights.length; i++) {
    heights[i] = (heights[i] - hMin) / hRange
  }

  // ── Color / diffuse map ──────────────────────────────────────────────────
  // Moderate silver range with slight blue cast — streaks carry most of the
  // visual variation, the base is a neutral brushed silver.
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = TEX_W
  colorCanvas.height = TEX_H
  const cctx = colorCanvas.getContext('2d')!
  const colorData = cctx.createImageData(TEX_W, TEX_H)
  for (let i = 0; i < TEX_W * TEX_H; i++) {
    const h = heights[i]
    const v = 110 + h * 110  // 110..220
    const idx = i * 4
    colorData.data[idx]     = Math.round(v - 3)
    colorData.data[idx + 1] = Math.round(v)
    colorData.data[idx + 2] = Math.round(v + 5)
    colorData.data[idx + 3] = 255
  }
  cctx.putImageData(colorData, 0, 0)

  // ── Normal map ───────────────────────────────────────────────────────────
  // Y-axis gradient dominates (the streaks run horizontally, so the height
  // changes most quickly along Y). X-axis gradient is tiny since the noise
  // is stretched along X and changes little there.
  const normalCanvas = document.createElement('canvas')
  normalCanvas.width = TEX_W
  normalCanvas.height = TEX_H
  const nctx = normalCanvas.getContext('2d')!
  const normalData = nctx.createImageData(TEX_W, TEX_H)
  const slope = 4
  for (let y = 0; y < TEX_H; y++) {
    const yU = (y - 1 + TEX_H) % TEX_H
    const yD = (y + 1) % TEX_H
    for (let x = 0; x < TEX_W; x++) {
      const xL = (x - 1 + TEX_W) % TEX_W
      const xR = (x + 1) % TEX_W
      const dx = (heights[y * TEX_W + xR] - heights[y * TEX_W + xL]) * slope * 0.15
      const dy = (heights[yD * TEX_W + x] - heights[yU * TEX_W + x]) * slope
      const idx = (y * TEX_W + x) * 4
      normalData.data[idx]     = Math.max(0, Math.min(255, 128 + dx * 128))
      normalData.data[idx + 1] = Math.max(0, Math.min(255, 128 + dy * 128))
      normalData.data[idx + 2] = 255
      normalData.data[idx + 3] = 255
    }
  }
  nctx.putImageData(normalData, 0, 0)

  // ── Roughness map ───────────────────────────────────────────────────────
  // Compressed range so specular varies subtly — bright streaks slightly
  // shinier, dark streaks slightly rougher. No big snaps.
  const roughCanvas = document.createElement('canvas')
  roughCanvas.width = TEX_W
  roughCanvas.height = TEX_H
  const rctx = roughCanvas.getContext('2d')!
  const roughData = rctx.createImageData(TEX_W, TEX_H)
  for (let i = 0; i < TEX_W * TEX_H; i++) {
    const h = heights[i]
    const v = 160 - h * 60  // ~100..160 (≈0.39..0.63)
    const idx = i * 4
    roughData.data[idx]     = v
    roughData.data[idx + 1] = v
    roughData.data[idx + 2] = v
    roughData.data[idx + 3] = 255
  }
  rctx.putImageData(roughData, 0, 0)

  const map = new THREE.CanvasTexture(colorCanvas)
  map.wrapS = map.wrapT = THREE.RepeatWrapping
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 16

  const normalMap = new THREE.CanvasTexture(normalCanvas)
  normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping
  normalMap.colorSpace = THREE.NoColorSpace
  normalMap.anisotropy = 16

  const roughnessMap = new THREE.CanvasTexture(roughCanvas)
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping
  roughnessMap.colorSpace = THREE.NoColorSpace
  roughnessMap.anisotropy = 16

  return { map, normalMap, roughnessMap }
}
