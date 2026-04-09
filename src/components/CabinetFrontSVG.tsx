/**
 * Shared SVG front-elevation rendering for cabinets.
 * Used by CabinetsPanel (sidebar thumbnails) and WallElevationView.
 * Closely matches the 3D CabinetMesh geometry from GarageShell.tsx.
 */
import type { CabinetPreset, CabinetLine } from '../store/garageStore'

// Body + door color palettes (matching GarageShell CAB_BODY / CAB_DOOR)
const CAB_BODY: Record<string, string> = {
  charcoal: '#3d3d3d', white: '#f0f0ee', driftwood: '#7a6a58',
  slate: '#5a6872', stone: '#7a7972',
}
const CAB_DOOR: Record<string, string> = {
  charcoal: '#8a8e96', white: '#e8e8e6', driftwood: '#b09880',
  slate: '#90a0a8', stone: '#aaa898',
}
const HANDLE_COLOR = '#c0c4c8'
const SIG_HANDLE_COLOR = '#1a1a1a'

interface CabinetFrontProps {
  w: number         // width in inches
  h: number         // height in inches
  doors: 0 | 1 | 2
  drawers?: number
  style: 'lower' | 'upper' | 'locker'
  line: CabinetLine
  color?: string    // cabinet color id (default charcoal)
  handleSide?: 'left' | 'right' // single-door handle position (default 'right')
}

/**
 * Renders a front-elevation SVG of a cabinet that matches the 3D mesh.
 * All coordinates are in inches (matching the real dimensions).
 * The caller wraps this in a <g> with appropriate transform/scale.
 */
export function cabinetFrontPaths({ w, h, doors, drawers: drawersProp, style, line, color, handleSide }: CabinetFrontProps) {
  const drawers = drawersProp ?? 0
  const isSignature = line === 'signature'
  const handleRight = (handleSide ?? 'right') === 'right'

  // Frame rail size — matches 3D: Signature 0.75", Technica 0.1"
  const fr = isSignature ? 0.75 : 0.1

  const bodyHex = CAB_BODY[color ?? 'charcoal'] ?? CAB_BODY.charcoal
  const doorHex = CAB_DOOR[color ?? 'charcoal'] ?? CAB_DOOR.charcoal

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

  // Door widths (matching 3D)
  const door1W = w - 2 * fr
  const door2W = (w - 3 * fr) / 2

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
    const lx = fr
    const rx = fr + door2W + fr
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
          fill={HANDLE_COLOR} rx={0.15} />
      )
    } else {
      // Technica: horizontal blade handle centered
      const bladeLen = Math.min(19, door1W - 2)
      const bladeH = Math.max(0.45, fH * 0.06)
      elements.push(
        <rect key={`drh${i}`} x={w / 2 - bladeLen / 2} y={h - y0 - fH / 2 - bladeH / 2}
          width={bladeLen} height={bladeH}
          fill={HANDLE_COLOR} rx={0.15} />
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
            fill={SIG_HANDLE_COLOR} rx={0.15} />
        )
      } else {
        // Inner edges of each door (touching center stile)
        elements.push(
          <rect key="sh0" x={fr + door2W - chW - 0.15} y={chY} width={chW} height={chH}
            fill={SIG_HANDLE_COLOR} rx={0.15} />,
          <rect key="sh1" x={fr + door2W + fr + 0.15} y={chY} width={chW} height={chH}
            fill={SIG_HANDLE_COLOR} rx={0.15} />
        )
      }
    } else {
      // Technica blade handles on inner edge, centered vertically
      const bladeH = style === 'locker' ? 19 : 8.5
      const actualBladeH = Math.min(bladeH, doorH - 3)
      const doorMidY = h - (doorY0 + doorY1) / 2
      const bladeY = doorMidY - actualBladeH / 2
      const bladeW = 0.45
      if (doors === 1) {
        const thX = handleRight ? (fr + door1W - 1.5 - bladeW / 2) : (fr + 1.5 - bladeW / 2)
        elements.push(
          <rect key="th0" x={thX} y={bladeY}
            width={bladeW} height={actualBladeH}
            fill={HANDLE_COLOR} rx={0.15} />
        )
      } else {
        // Inner edges
        elements.push(
          <rect key="th0" x={fr + door2W - 1.5 - bladeW / 2} y={bladeY}
            width={bladeW} height={actualBladeH}
            fill={HANDLE_COLOR} rx={0.15} />,
          <rect key="th1" x={fr + door2W + fr + 1.5 - bladeW / 2} y={bladeY}
            width={bladeW} height={actualBladeH}
            fill={HANDLE_COLOR} rx={0.15} />
        )
      }
    }
  }

  return elements
}

/** Sidebar thumbnail SVG — fixed pixel width, proportional height */
export default function CabinetFrontSVG({ preset }: { preset: CabinetPreset }) {
  const SVG_W = 56
  const scale = SVG_W / preset.w
  const SVG_H = Math.round(preset.h * scale)

  return (
    <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${preset.w} ${preset.h}`}
      style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      {cabinetFrontPaths({
        w: preset.w, h: preset.h,
        doors: preset.doors, drawers: preset.drawers,
        style: preset.style, line: preset.line,
      })}
    </svg>
  )
}
