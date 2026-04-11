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
  style: 'lower' | 'upper' | 'locker'
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
export function cabinetFrontPaths({ w, h, doors, drawers: drawersProp, style, line, color, shellColor, handleColor, handleSide }: CabinetFrontProps) {
  const drawers = drawersProp ?? 0
  const isSignature = line === 'signature'
  const handleRight = (handleSide ?? 'right') === 'right'
  const handleHex = HANDLE_HEX[handleColor ?? 'brushed'] ?? HANDLE_HEX.brushed

  // Frame rail size — matches 3D: Signature 0.75", Technica 0.1"
  const fr = isSignature ? 0.75 : 0.1

  const bodyHex = isSignature
    ? (SIG_SHELL[shellColor ?? 'black'] ?? SIG_SHELL.black)
    : (TEC_COLORS[color ?? 'titanium'] ?? TEC_COLORS.titanium)
  const doorHex = isSignature
    ? (SIG_DOOR[color ?? 'black'] ?? SIG_DOOR.black)
    : (TEC_COLORS[color ?? 'titanium'] ?? TEC_COLORS.titanium)

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
        // Inner edges of each door (touching center stile)
        elements.push(
          <rect key="sh0" x={fr + door2W - chW - 0.15} y={chY} width={chW} height={chH}
            fill={handleHex} rx={0.15} />,
          <rect key="sh1" x={fr + door2W + fr + 0.15} y={chY} width={chW} height={chH}
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
}

/** Sidebar thumbnail SVG — consistent size per cabinet style, outline mode for Technica */
export default function CabinetFrontSVG({ preset }: { preset: CabinetPreset }) {
  const thumb = THUMB_DIMS[preset.style] ?? THUMB_DIMS.lower
  const isTechnica = preset.line === 'technica'

  // For Technica we draw a flat outline schematic instead of a filled colour render
  if (isTechnica) {
    return (
      <svg width={thumb.svgW} height={thumb.svgH}
        viewBox={`0 0 ${thumb.w} ${thumb.h}`}
        style={{ display: 'block', flexShrink: 0, overflow: 'visible' }}
        aria-hidden="true">
        <TechnicaOutline w={preset.w} h={preset.h}
          thumbW={thumb.w} thumbH={thumb.h}
          doors={preset.doors} drawers={preset.drawers ?? 0}
          style={preset.style} />
      </svg>
    )
  }

  return (
    <svg width={thumb.svgW} height={thumb.svgH}
      viewBox={`0 0 ${thumb.w} ${thumb.h}`}
      style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      {cabinetFrontPaths({
        w: thumb.w, h: thumb.h,
        doors: preset.doors, drawers: preset.drawers,
        style: preset.style, line: preset.line,
      })}
    </svg>
  )
}

/** Outline-only schematic for Technica cabinet selector tiles */
function TechnicaOutline({ w: realW, h: realH, thumbW, thumbH, doors, drawers, style }:
  { w: number; h: number; thumbW: number; thumbH: number;
    doors: number; drawers: number; style: string }) {

  // Always scale by height so all cabinets of the same style fill the same vertical space
  const sc = thumbH / realH

  // Rendered dimensions (centred in thumb box)
  const rW = realW * sc
  const rH = realH * sc
  const ox = (thumbW - rW) / 2  // x offset to centre
  const oy = (thumbH - rH) / 2  // y offset to centre

  const stroke = 'rgba(180,200,230,0.75)'
  const strokeW = 0.6
  const handleStroke = 'rgba(180,200,230,0.95)'
  const fr = 0.6 * sc  // frame rail in scaled units

  const elements: JSX.Element[] = []

  // Outer body rectangle
  elements.push(
    <rect key="body" x={ox} y={oy} width={rW} height={rH}
      fill="none" stroke={stroke} strokeWidth={strokeW} rx={0.3} />
  )

  // Work in real-inch space offset by ox/oy, scaled by sc
  const X = (x: number) => ox + x * sc
  const Y = (y: number) => oy + y * sc  // y=0 is top of cabinet

  const fr_in = 0.6  // frame rail in inches

  // Y-down: drawers sit at the TOP of the cabinet, doors fill the rest below them
  const usableH_in = realH - 2 * fr_in
  const comboDrawerH_in = usableH_in * (3.5 / 20)
  const drawerAreaY0_in = fr_in
  const drawerAreaH_in  = doors === 0 ? usableH_in : drawers * comboDrawerH_in

  const tecRatios = drawers === 5 ? [6, 3.5, 3.5, 3.5, 3.5] : Array(drawers).fill(1)
  const ratioSum = tecRatios.reduce((a: number, b: number) => a + b, 0)
  const drawerHeights_in = tecRatios.map((r: number) => (r / ratioSum) * drawerAreaH_in)

  // Doors start below the drawer area (or at the top if no drawers)
  const doorY0_in = drawers > 0 ? drawerAreaY0_in + drawerAreaH_in + fr_in : fr_in
  const doorY1_in = realH - fr_in
  const doorH_in = doors > 0 ? doorY1_in - doorY0_in : 0

  // Door outlines
  if (doors === 1 && doorH_in > 0) {
    const dW = realW - 2 * fr_in
    elements.push(
      <rect key="d0"
        x={X(fr_in)} y={Y(doorY0_in)} width={dW * sc} height={doorH_in * sc}
        fill="none" stroke={stroke} strokeWidth={strokeW} />
    )
    // Blade handle positioned per style (Y-down: doorY0 is top, doorY0+doorH is bottom)
    const bladeLen_in = style === 'locker' ? 15 : 7
    const actualBlade_in = Math.min(bladeLen_in, doorH_in - 2)
    const handleInset_in = 1
    const bladeTopY_in =
      style === 'locker' ? doorY0_in + doorH_in / 2 - actualBlade_in / 2 :
      style === 'upper'  ? doorY0_in + doorH_in - handleInset_in - actualBlade_in :
      /* lower */          doorY0_in + handleInset_in
    const hX_in = fr_in + dW - 2
    elements.push(
      <rect key="h0"
        x={X(hX_in)} y={Y(bladeTopY_in)}
        width={0.4 * sc} height={actualBlade_in * sc}
        fill={handleStroke} stroke="none" rx={0.2} />
    )
  } else if (doors === 2 && doorH_in > 0) {
    const d2W_in = (realW - 3 * fr_in) / 2
    const lx_in = fr_in
    const rx_in = fr_in + d2W_in + fr_in
    elements.push(
      <rect key="d0" x={X(lx_in)} y={Y(doorY0_in)} width={d2W_in * sc} height={doorH_in * sc}
        fill="none" stroke={stroke} strokeWidth={strokeW} />,
      <rect key="d1" x={X(rx_in)} y={Y(doorY0_in)} width={d2W_in * sc} height={doorH_in * sc}
        fill="none" stroke={stroke} strokeWidth={strokeW} />
    )
    // Blade handles on inner edges — positioned per style
    const bladeLen_in = style === 'locker' ? 15 : 7
    const actualBlade_in = Math.min(bladeLen_in, doorH_in - 2)
    const handleInset_in = 1
    const bladeTopY_in =
      style === 'locker' ? doorY0_in + doorH_in / 2 - actualBlade_in / 2 :
      style === 'upper'  ? doorY0_in + doorH_in - handleInset_in - actualBlade_in :
      /* lower */          doorY0_in + handleInset_in
    const handleOffset_in = 1.2
    elements.push(
      <rect key="h0"
        x={X(lx_in + d2W_in - handleOffset_in)} y={Y(bladeTopY_in)}
        width={0.4 * sc} height={actualBlade_in * sc}
        fill={handleStroke} stroke="none" rx={0.2} />,
      <rect key="h1"
        x={X(rx_in + handleOffset_in)} y={Y(bladeTopY_in)}
        width={0.4 * sc} height={actualBlade_in * sc}
        fill={handleStroke} stroke="none" rx={0.2} />
    )
  }

  // Drawer outlines
  let cumY_in = drawerAreaY0_in
  const dFW_in = realW - 2 * fr_in
  for (let i = 0; i < drawers; i++) {
    const fH_in = drawerHeights_in[i] - 0.1
    elements.push(
      <rect key={`dr${i}`}
        x={X(fr_in)} y={Y(cumY_in)} width={dFW_in * sc} height={fH_in * sc}
        fill="none" stroke={stroke} strokeWidth={strokeW} />
    )
    // Horizontal blade handle
    const bladeLen_in = Math.min(realW * 0.55, dFW_in - 1)
    const bladeH_in = Math.max(0.35, fH_in * 0.12)
    const drMidY_in = cumY_in + fH_in / 2
    elements.push(
      <rect key={`drh${i}`}
        x={X(realW / 2 - bladeLen_in / 2)} y={Y(drMidY_in - bladeH_in / 2)}
        width={bladeLen_in * sc} height={bladeH_in * sc}
        fill={handleStroke} stroke="none" rx={0.15} />
    )
    cumY_in += drawerHeights_in[i]
  }

  return <>{elements}</>
}
