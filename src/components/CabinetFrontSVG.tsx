/**
 * Shared SVG front-elevation rendering for cabinets.
 * Used by CabinetsPanel (sidebar thumbnails) and WallElevationView.
 * Closely matches the 3D CabinetMesh geometry from GarageShell.tsx.
 */
import type { CabinetPreset, CabinetLine } from '../store/garageStore'

// Color palettes matching GarageShell
const TEC_COLORS: Record<string, string> = {
  titanium: '#5a5650', 'ash-grey': '#d4cfc0', 'harbor-blue': '#283448',
  evergreen: '#4d5e4c', sandstone: '#b09475', mica: '#6e6e6e',
  graphite: '#3a3a3c', obsidian: '#1a1a1a', silver: '#b8bcc0',
  'metallic-grey': '#989a9a', 'argento-blu': '#9aa8b0', ruby: '#b02020',
}
const SIG_SHELL: Record<string, string> = {
  black: '#1a1a1c', granite: '#48484a',
}
const SIG_DOOR: Record<string, string> = {
  black: '#1a1a1c', granite: '#48484a', 'harbor-blue': '#283448',
  latte: '#b0a08a', 'midnight-blue': '#1e2d4d', red: '#b82020', silver: '#b0b4b8',
}
const HANDLE_HEX: Record<string, string> = {
  brushed: '#c0c4c8',
  black:   '#1a1a1c',
}

interface CabinetFrontProps {
  w: number         // width in inches
  h: number         // height in inches
  doors: 0 | 1 | 2
  drawers?: number
  style: 'lower' | 'upper' | 'locker' | 'corner-upper'
  line: CabinetLine
  color?: string    // cabinet color id
  shellColor?: string // Signature shell color: 'black' | 'granite'
  handleColor?: string // 'brushed' | 'black'
  handleSide?: 'left' | 'right' // single-door handle position (default 'right')
}

/**
 * Renders a front-elevation SVG of a cabinet that matches the 3D mesh.
 * All coordinates are in inches (matching the real dimensions).
 * The caller wraps this in a <g> with appropriate transform/scale.
 */
export function cabinetFrontPaths({ w, h, doors, drawers: drawersProp, style: styleRaw, line, color, shellColor, handleColor, handleSide }: CabinetFrontProps) {
  const drawers = drawersProp ?? 0
  const isSignature = line === 'signature'
  // Normalize: corner-upper renders its front-elevation the same way as a
  // standard upper (handle near bottom of door).
  const style: 'lower' | 'upper' | 'locker' = styleRaw === 'corner-upper' ? 'upper' : styleRaw
  const handleRight = (handleSide ?? 'right') === 'right'
  const handleHex = HANDLE_HEX[handleColor ?? 'brushed'] ?? HANDLE_HEX.brushed

  // Frame rail size — matches 3D: Signature 0.75", Technica 0.1"
  const fr = isSignature ? 0.75 : 0.1

  const bodyHex = isSignature
    ? (SIG_SHELL[shellColor ?? 'granite'] ?? SIG_SHELL.granite)
    : (TEC_COLORS[color ?? 'mica'] ?? TEC_COLORS.mica)
  const doorHex = isSignature
    ? (SIG_DOOR[color ?? 'granite'] ?? SIG_DOOR.granite)
    : (TEC_COLORS[color ?? 'mica'] ?? TEC_COLORS.mica)

  // Door geometry (matching GarageShell CabinetMesh)
  const baseY0 = fr
  const fullY1 = h - fr
  const usableH = fullY1 - baseY0

  // Drawer heights — matching 3D ratios
  const comboDrawerH = isSignature ? usableH * (3 / 20) : usableH * (3.5 / 20)
  const drawerAreaY0 = doors === 0 ? baseY0 : fullY1 - drawers * comboDrawerH
  const drawerAreaH  = doors === 0 ? fullY1 - baseY0 : drawers * comboDrawerH

  // 5-drawer variable heights
  const sigRatios = [6, 4, 4, 3, 3]
  const tecRatios = [6, 3.5, 3.5, 3.5, 3.5]
  const drawerRatios = drawers === 5 ? (isSignature ? sigRatios : tecRatios) : Array(drawers).fill(1)
  const ratioSum = drawerRatios.reduce((a, b) => a + b, 0)
  const drawerHeights = drawerRatios.map(r => (r / ratioSum) * drawerAreaH)

  // Door area
  const doorY0 = baseY0
  const doorY1 = drawers > 0 && doors > 0 ? drawerAreaY0 - fr : (doors > 0 ? fullY1 : baseY0)
  const doorH = doorY1 - doorY0

  // Door widths (matching 3D) — Signature has no center stile
  const door1W = w - 2 * fr
  const doorGap = isSignature ? 0.15 : fr
  const door2W = isSignature ? (w - 2 * fr - doorGap) / 2 : (w - 3 * fr) / 2

  const gap = 0.1 // visual gap between drawer fronts

  const elements: JSX.Element[] = []

  // Body
  elements.push(
    <rect key="body" x={0} y={0} width={w} height={h}
      fill={bodyHex} stroke="rgba(0,0,0,0.3)" strokeWidth={0.3} />
  )

  // Door panels
  if (doors === 1 && doorH > 0) {
    elements.push(
      <rect key="d0" x={fr} y={h - doorY1} width={door1W} height={doorH}
        fill={doorHex} stroke="rgba(0,0,0,0.15)" strokeWidth={0.2} />
    )
  } else if (doors === 2 && doorH > 0) {
    const lx = isSignature ? fr : fr
    const rx = isSignature ? fr + door2W + doorGap : fr + door2W + fr
    elements.push(
      <rect key="d0" x={lx} y={h - doorY1} width={door2W} height={doorH}
        fill={doorHex} stroke="rgba(0,0,0,0.15)" strokeWidth={0.2} />,
      <rect key="d1" x={rx} y={h - doorY1} width={door2W} height={doorH}
        fill={doorHex} stroke="rgba(0,0,0,0.15)" strokeWidth={0.2} />
    )
  }

  // Drawer fronts
  let cumY = drawerAreaY0
  for (let i = 0; i < drawers; i++) {
    const y0 = cumY
    const fH = drawerHeights[i] - gap
    cumY += drawerHeights[i]
    elements.push(
      <rect key={`dr${i}`} x={fr} y={h - y0 - fH} width={door1W} height={fH}
        fill={doorHex} stroke="rgba(0,0,0,0.15)" strokeWidth={0.2} />
    )

    // Drawer handles
    if (isSignature) {
      // Wide bar at top edge of each drawer
      const pullW = door1W - 1
      const pullH = Math.max(0.5, fH * 0.08)
      elements.push(
        <rect key={`drh${i}`} x={w / 2 - pullW / 2} y={h - y0 - fH + 0.25}
          width={pullW} height={pullH}
          fill={handleHex} rx={0.15} />
      )
    } else {
      // Technica: horizontal blade handle centered
      const bladeLen = Math.min(19, door1W - 2)
      const bladeH = Math.max(0.45, fH * 0.06)
      elements.push(
        <rect key={`drh${i}`} x={w / 2 - bladeLen / 2} y={h - y0 - fH / 2 - bladeH / 2}
          width={bladeLen} height={bladeH}
          fill={handleHex} rx={0.15} />
      )
    }
  }

  // Door handles
  if (doors > 0 && doorH > 0) {
    if (isSignature) {
      // Full-length recessed channel on inner edge
      const chW = 0.6
      const chH = doorH - 0.5
      const chY = h - doorY1 + 0.25
      if (doors === 1) {
        const chX = handleRight ? (fr + door1W - chW - 0.15) : (fr + 0.15)
        elements.push(
          <rect key="sh0" x={chX} y={chY} width={chW} height={chH}
            fill={handleHex} rx={0.15} />
        )
      } else {
        // Inner edges of each door (touching center seam — Signature has no
        // center stile; doors are separated by doorGap, not fr).
        elements.push(
          <rect key="sh0" x={fr + door2W - chW - 0.15} y={chY} width={chW} height={chH}
            fill={handleHex} rx={0.15} />,
          <rect key="sh1" x={fr + door2W + doorGap + 0.15} y={chY} width={chW} height={chH}
            fill={handleHex} rx={0.15} />
        )
      }
    } else {
      // Technica blade handles on inner edge. Position per style:
      //   lower  → near TOP of door (reach down, lift up)
      //   upper  → near BOTTOM of door (reach up, pull down)
      //   locker → centered (long bar)
      const bladeH = style === 'locker' ? 19 : 8.5
      const actualBladeH = Math.min(bladeH, doorH - 3)
      const inset = 1.5  // distance from edge of door to nearest end of handle
      // Door runs from local Y = doorY0 (bottom) to doorY1 (top). SVG y is flipped.
      let bladeY: number
      if (style === 'locker') {
        const doorMidY = h - (doorY0 + doorY1) / 2
        bladeY = doorMidY - actualBladeH / 2
      } else if (style === 'upper') {
        // Handle near the bottom of the door → high local Y in SVG = h - doorY0 - inset - blade
        bladeY = h - doorY0 - inset - actualBladeH
      } else {
        // lower: handle near the top of the door → low local Y in SVG
        bladeY = h - doorY1 + inset
      }
      const bladeW = 0.45
      if (doors === 1) {
        const thX = handleRight ? (fr + door1W - 1.5 - bladeW / 2) : (fr + 1.5 - bladeW / 2)
        elements.push(
          <rect key="th0" x={thX} y={bladeY}
            width={bladeW} height={actualBladeH}
            fill={handleHex} rx={0.15} />
        )
      } else {
        // Inner edges
        elements.push(
          <rect key="th0" x={fr + door2W - 1.5 - bladeW / 2} y={bladeY}
            width={bladeW} height={actualBladeH}
            fill={handleHex} rx={0.15} />,
          <rect key="th1" x={fr + door2W + fr + 1.5 - bladeW / 2} y={bladeY}
            width={bladeW} height={actualBladeH}
            fill={handleHex} rx={0.15} />
        )
      }
    }
  }

  return elements
}

// Canonical thumbnail dimensions per style — all cabinets of a style render at the same size
const THUMB_DIMS: Record<string, { w: number; h: number; svgW: number; svgH: number }> = {
  lower:  { w: 30, h: 30.5, svgW: 52, svgH: 44 },
  upper:  { w: 30, h: 28,    svgW: 52, svgH: 40 },
  locker: { w: 40, h: 80,    svgW: 52, svgH: 62 },
  // Corner-upper thumbnail = front-elevation of the angled door face only.
  // Width = diagonal of the chamfer = (back − side)·√2 ≈ 14.14" for 24/14.
  'corner-upper': { w: 14.14, h: 28, svgW: 32, svgH: 40 },
}

/** Sidebar thumbnail SVG — consistent size per cabinet style. Both Signature
 *  and Technica render as colored filled fronts matching their spawn defaults
 *  (Signature: granite/granite, Technica: mica). */
export default function CabinetFrontSVG({ preset }: { preset: CabinetPreset }) {
  const thumb = THUMB_DIMS[preset.style] ?? THUMB_DIMS.lower
  // Corner-upper thumbnail renders the diagonal door face, treated as a
  // 1-door upper-style elevation (handle near bottom).
  const renderStyle: 'lower' | 'upper' | 'locker' = preset.style === 'corner-upper' ? 'upper' : preset.style

  return (
    <svg width={thumb.svgW} height={thumb.svgH}
      viewBox={`0 0 ${thumb.w} ${thumb.h}`}
      style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      {cabinetFrontPaths({
        w: thumb.w, h: thumb.h,
        doors: preset.doors, drawers: preset.drawers,
        style: renderStyle, line: preset.line,
      })}
    </svg>
  )
}

