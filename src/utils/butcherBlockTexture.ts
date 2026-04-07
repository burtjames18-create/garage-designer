import * as THREE from 'three'

/**
 * Generates a procedural light maple butcher-block wood texture using Canvas.
 * Returns a Three.js CanvasTexture ready to apply to a mesh.
 *
 * The pattern simulates edge-grain butcher block: parallel strips of light
 * maple/birch wood with subtle grain variation, knot hints, and color shifts.
 */

const TEX_W = 512
const TEX_H = 512

// Seeded pseudo-random for deterministic results
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function createButcherBlockTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = TEX_W
  canvas.height = TEX_H
  const ctx = canvas.getContext('2d')!
  const rand = mulberry32(42)

  // ── Base fill: warm light maple ──
  ctx.fillStyle = '#dfc496'
  ctx.fillRect(0, 0, TEX_W, TEX_H)

  // ── Edge-grain strips (horizontal boards) ──
  const stripCount = 8 + Math.floor(rand() * 4) // 8-11 strips
  const stripH = TEX_H / stripCount

  for (let s = 0; s < stripCount; s++) {
    const y0 = s * stripH
    // Each strip has a slightly different base hue
    const hueShift = (rand() - 0.5) * 18
    const lightShift = (rand() - 0.5) * 12
    const r = Math.min(255, Math.max(0, 215 + hueShift))
    const g = Math.min(255, Math.max(0, 190 + hueShift - 5))
    const b = Math.min(255, Math.max(0, 140 + lightShift))

    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
    ctx.fillRect(0, y0 + 1, TEX_W, stripH - 2)

    // ── Grain lines within each strip ──
    const grainCount = 20 + Math.floor(rand() * 30)
    for (let g2 = 0; g2 < grainCount; g2++) {
      const gy = y0 + rand() * stripH
      const gx0 = rand() * TEX_W * 0.3
      const gLen = TEX_W * (0.3 + rand() * 0.7)
      const alpha = 0.03 + rand() * 0.08
      const dark = rand() > 0.3
      ctx.strokeStyle = dark
        ? `rgba(140, 110, 70, ${alpha})`
        : `rgba(235, 215, 175, ${alpha})`
      ctx.lineWidth = 0.5 + rand() * 1.5
      ctx.beginPath()
      // Slightly wavy grain line
      ctx.moveTo(gx0, gy)
      const steps = 6
      for (let i = 1; i <= steps; i++) {
        const px = gx0 + (gLen / steps) * i
        const py = gy + (rand() - 0.5) * 2
        ctx.lineTo(px, py)
      }
      ctx.stroke()
    }

    // ── Subtle annual-ring arcs (end-grain hints) ──
    if (rand() > 0.4) {
      const arcCount = 1 + Math.floor(rand() * 3)
      for (let a = 0; a < arcCount; a++) {
        const ax = rand() * TEX_W
        const ay = y0 + stripH * 0.5
        const ar = stripH * (0.3 + rand() * 0.4)
        ctx.strokeStyle = `rgba(160, 130, 85, ${0.04 + rand() * 0.06})`
        ctx.lineWidth = 0.8 + rand() * 1
        ctx.beginPath()
        ctx.arc(ax, ay, ar, 0, Math.PI * (0.4 + rand() * 0.6))
        ctx.stroke()
      }
    }

    // ── Strip separator line (glue joint) ──
    ctx.strokeStyle = `rgba(180, 155, 110, 0.3)`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, y0)
    ctx.lineTo(TEX_W, y0)
    ctx.stroke()
  }

  // ── Micro noise pass for organic feel ──
  const imgData = ctx.getImageData(0, 0, TEX_W, TEX_H)
  const px = imgData.data
  for (let i = 0; i < px.length; i += 4) {
    const noise = (rand() - 0.5) * 8
    px[i] = Math.min(255, Math.max(0, px[i] + noise))
    px[i + 1] = Math.min(255, Math.max(0, px[i + 1] + noise))
    px[i + 2] = Math.min(255, Math.max(0, px[i + 2] + noise))
  }
  ctx.putImageData(imgData, 0, 0)

  const tex = new THREE.CanvasTexture(canvas)
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
