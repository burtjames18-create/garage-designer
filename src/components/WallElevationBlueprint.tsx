import type { GarageWall, SlatwallPanel, StainlessBacksplashPanel, PlacedCabinet, Countertop, FloorStep } from '../store/garageStore'
import { COUNTERTOP_THICKNESS } from '../store/garageStore'
import { slatwallColors } from '../data/slatwallColors'
import { inchesToDisplay } from '../utils/measurements'
import { cabinetFrontPaths } from './CabinetFrontSVG'

// ── Geometry helpers ──────────────────────────────────────────────────────────
function wallLen(w: GarageWall) { return Math.hypot(w.x2 - w.x1, w.z2 - w.z1) }
function wallDir(w: GarageWall): [number, number] {
  const l = wallLen(w); if (l < 0.01) return [1, 0]
  return [(w.x2 - w.x1) / l, (w.z2 - w.z1) / l]
}
function wallNormal(w: GarageWall): [number, number] {
  const [dx, dz] = wallDir(w)
  const n1: [number, number] = [-dz, dx]
  const mx = (w.x1 + w.x2) / 2, mz = (w.z1 + w.z2) / 2
  return (n1[0] * (-mx) + n1[1] * (-mz)) > 0 ? n1 : [dz, -dx]
}
function projectCabinet(cab: PlacedCabinet, w: GarageWall) {
  const len = wallLen(w); if (len < 0.01) return { along: 0, perp: 99999 }
  const [dx, dz] = wallDir(w)
  const vx = cab.x - w.x1, vz = cab.z - w.z1
  return { along: vx * dx + vz * dz, perp: Math.abs(vx * (-dz) + vz * dx) }
}
function isCabinetOnWall(cab: PlacedCabinet, w: GarageWall) {
  const len = wallLen(w)
  const { along, perp } = projectCabinet(cab, w)
  if (perp > cab.d / 2 + w.thickness / 2 + 10) return false
  if (along <= -cab.w / 2 || along >= len + cab.w / 2) return false
  // Cabinet must face this wall (within 45°) — prevents corner bleed
  const [dx, dz] = wallDir(w)
  const expectedRotY = Math.atan2(-dz, dx)
  let diff = Math.abs(cab.rotY - expectedRotY) % (Math.PI * 2)
  if (diff > Math.PI) diff = Math.PI * 2 - diff
  return diff < Math.PI / 4
}
function projectCountertop(ct: Countertop, w: GarageWall) {
  const len = wallLen(w); if (len < 0.01) return { along: 0, perp: 99999 }
  const [dx, dz] = wallDir(w)
  const vx = ct.x - w.x1, vz = ct.z - w.z1
  return { along: vx * dx + vz * dz, perp: Math.abs(vx * (-dz) + vz * dx) }
}
function isCountertopOnWall(ct: Countertop, w: GarageWall) {
  const len = wallLen(w)
  const { along, perp } = projectCountertop(ct, w)
  return perp <= 25 / 2 + w.thickness / 2 + 10 && along > -ct.width / 2 && along < len + ct.width / 2
}
function getWallStubs(wall: GarageWall, allWalls: GarageWall[]) {
  const wLen = wallLen(wall)
  const [dx, dz] = wallDir(wall)
  const stubs: Array<{ along: number; thickness: number; height: number }> = []
  for (const other of allWalls) {
    if (other.id === wall.id) continue
    for (const [ex, ez] of [[other.x1, other.z1], [other.x2, other.z2]]) {
      const vx = ex - wall.x1, vz = ez - wall.z1
      const along = vx * dx + vz * dz
      const perp = vx * (-dz) + vz * dx
      if (Math.abs(perp) < 1 && along >= -1 && along <= wLen + 1) {
        stubs.push({ along, thickness: other.thickness, height: other.height })
        break
      }
    }
  }
  return stubs
}

const COUNTERTOP_HEX: Record<string, string> = {
  'butcher-block': '#b5813a', 'stainless-steel': '#b0b4b8', 'black-stainless': '#484b50',
  white: '#e8e8e4', black: '#2a2a2a', concrete: '#8a8a80',
}

/** Project a floor step onto a wall and return the along-wall range if adjacent */
function getStepWallProjection(
  step: FloorStep, w: GarageWall, tolerance = 6,
): { alongStart: number; alongEnd: number; height: number } | null {
  const len = wallLen(w)
  if (len < 0.01) return null
  const [ux, uz] = wallDir(w)
  const nx = -uz, nz = ux
  const corners = step.corners
  let minU = Infinity, maxU = -Infinity
  let minV = Infinity, maxV = -Infinity
  for (const [px, pz] of corners) {
    const u = (px - w.x1) * ux + (pz - w.z1) * uz
    const v = (px - w.x1) * nx + (pz - w.z1) * nz
    minU = Math.min(minU, u); maxU = Math.max(maxU, u)
    minV = Math.min(minV, v); maxV = Math.max(maxV, v)
  }
  const halfThick = w.thickness / 2
  if (maxV < -(halfThick + tolerance) || minV > halfThick + tolerance) return null
  const u0 = Math.max(0, minU), u1 = Math.min(len, maxU)
  if (u1 <= u0) return null
  return { alongStart: u0, alongEnd: u1, height: step.height }
}

interface Props {
  wall: GarageWall
  slatwallPanels: SlatwallPanel[]
  stainlessBacksplashPanels?: StainlessBacksplashPanel[]
  cabinets: PlacedCabinet[]
  countertops: Countertop[]
  allWalls: GarageWall[]
  floorSteps?: FloorStep[]
}

const PAD = 40  // padding for stacked dim tiers + corner stubs

export default function WallElevationBlueprint({ wall, slatwallPanels, stainlessBacksplashPanels = [], cabinets, countertops, allWalls, floorSteps = [] }: Props) {
  const wLen = wallLen(wall)
  const wH = wall.height
  const bbH = 0  // baseboards now standalone
  const svgW = wLen + 2 * PAD

  const toX = (a: number) => PAD + a
  const toY = (h: number) => PAD + wH - h

  const wallPanels = slatwallPanels.filter(p => p.wallId === wall.id && (p.side ?? 'interior') === 'interior')
  const wallBacksplashes = stainlessBacksplashPanels.filter(p => p.wallId === wall.id && (p.side ?? 'interior') === 'interior')
  const wallCabinets = cabinets.filter(c => isCabinetOnWall(c, wall))
  const wallCountertops = countertops.filter(ct => isCountertopOnWall(ct, wall))
  const wallStubs = getWallStubs(wall, allWalls)

  const colorHex = (id: string) => slatwallColors.find(c => c.id === id)?.hex ?? '#939490'

  // Interior face edges accounting for corner stubs
  let leftEdge = 0, rightEdge = wLen
  for (const stub of wallStubs) {
    if (stub.along <= 2) leftEdge = Math.max(leftEdge, stub.thickness / 2)
    else if (stub.along >= wLen - 2) rightEdge = Math.min(rightEdge, wLen - stub.thickness / 2)
  }

  const grooveLines = (panel: SlatwallPanel) => {
    const lines: JSX.Element[] = []
    for (let g = panel.yBottom + 3; g < panel.yTop; g += 3) {
      lines.push(<line key={g}
        x1={toX(panel.alongStart)} y1={toY(g)}
        x2={toX(panel.alongEnd)} y2={toY(g)}
        stroke="rgba(0,0,0,0.15)" strokeWidth={0.35} />)
    }
    return lines
  }

  // ── Dimension calculations ──────────────────────────────────────────────────
  const dimColor = '#444'
  const textColor = '#222'
  const fs = 2.5
  const tk = 2

  const hasItems = wallCabinets.length > 0 || wallPanels.length > 0
  const hBreaks = new Set<number>()
  hBreaks.add(hasItems ? leftEdge : 0)
  hBreaks.add(hasItems ? rightEdge : wLen)
  // Cabinet tier breakpoints — cabinets only. Slatwall lives on its own tier
  // below (see slatTierSegs) so SW segments don't fragment the cabinet/gap
  // breakdown.
  type Range = { start: number; end: number }
  const cabRanges: Range[] = []
  wallCabinets.forEach(cab => {
    const { along } = projectCabinet(cab, wall)
    const s = Math.max(leftEdge, along - cab.w / 2)
    const e = Math.min(rightEdge, along + cab.w / 2)
    hBreaks.add(s); hBreaks.add(e)
    cabRanges.push({ start: s, end: e })
  })
  const hSorted = [...hBreaks].sort((a, b) => a - b)
  const hasHSegs = hSorted.length > 2
  const classifySeg = (start: number, end: number): 'cab' | 'gap' => {
    const mid = (start + end) / 2
    for (const r of cabRanges) if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'cab'
    return 'gap'
  }

  // Slatwall tier — full-strip SW + gaps + 8' breaks for long panels.
  const slatBreaks = new Set<number>()
  slatBreaks.add(leftEdge); slatBreaks.add(rightEdge)
  const slatRanges: Range[] = []
  wallPanels.forEach(p => {
    const s = Math.max(leftEdge, p.alongStart)
    const e = Math.min(rightEdge, p.alongEnd)
    slatBreaks.add(s); slatBreaks.add(e)
    slatRanges.push({ start: s, end: e })
    const panelW = e - s
    for (let offset = 96; offset < panelW; offset += 96) slatBreaks.add(s + offset)
  })
  const slatSorted = [...slatBreaks].sort((a, b) => a - b)
  const hasSlatTier = slatRanges.length > 0
  const classifySlatSeg = (start: number, end: number): 'slat' | 'gap' => {
    const mid = (start + end) / 2
    for (const r of slatRanges) if (mid >= r.start - 0.1 && mid <= r.end + 0.1) return 'slat'
    return 'gap'
  }
  type SlatSeg = { start: number; end: number; kind: 'slat' | 'gap' }
  const slatTierSegs: SlatSeg[] = []
  for (let i = 0; i < slatSorted.length - 1; i++) {
    const s = slatSorted[i], e = slatSorted[i + 1]
    if (e - s < 0.5) continue
    slatTierSegs.push({ start: s, end: e, kind: classifySlatSeg(s, e) })
  }
  const TIER_COLOR = {
    overall: '#333',
    cab:     '#333',
    slat:    '#1d6f3d',
    ct:      '#8a6a3a',
    bb:      '#555',
    gap:     '#888',
  }

  // Horizontal dimension tiers (inside → outside):
  //   dimY1  = cabinet/gap strip
  //   dimYSlat = slatwall + gaps (with 8' breaks for long panels)
  //   dimYTotal = full wall width (outermost, bold)
  let nextDimY = toY(0) + 8
  const dimY1 = nextDimY
  if (hasHSegs) nextDimY += 8
  const dimYSlat = nextDimY
  if (hasSlatTier) nextDimY += 8
  const dimYTotal = nextDimY

  const svgH = dimYTotal + tk + 8  // accommodate all dimension rows

  const vBreaks = new Set<number>()
  const cabVRanges: Array<{ bottom: number; top: number }> = []
  vBreaks.add(0); vBreaks.add(wH)
  if (bbH > 0) vBreaks.add(bbH)
  wallCabinets.forEach(cab => {
    const b = Math.max(0, cab.y)
    const t = Math.min(wH, cab.y + cab.h)
    vBreaks.add(b); vBreaks.add(t)
    cabVRanges.push({ bottom: b, top: t })
  })
  // Countertop slab segments — show CT thickness inline above each cabinet's
  // CAB segment in the same vertical dim tier.
  const ctVRanges: Array<{ bottom: number; top: number }> = []
  wallCountertops.forEach(ct => {
    const b = Math.max(0, ct.y)
    const t = Math.min(wH, ct.y + COUNTERTOP_THICKNESS)
    if (t - b < 0.1) return
    vBreaks.add(b); vBreaks.add(t)
    ctVRanges.push({ bottom: b, top: t })
  })
  // Combined slatwall vertical span (lowest bottom → highest top).
  const slatVRange: { bottom: number; top: number } | null = (() => {
    if (wallPanels.length === 0) return null
    const lo = Math.max(0, Math.min(...wallPanels.map(p => p.yBottom)))
    const hi = Math.min(wH, Math.max(...wallPanels.map(p => p.yTop)))
    return hi - lo > 1 ? { bottom: lo, top: hi } : null
  })()
  if (slatVRange) { vBreaks.add(slatVRange.bottom); vBreaks.add(slatVRange.top) }
  const vSorted = [...vBreaks].sort((a, b) => a - b)
  const hasVSegs = vSorted.length > 2
  const classifyVSeg = (bot: number, top: number): 'cab' | 'ct' | 'slat' | 'bb' | 'gap' => {
    for (const r of cabVRanges) {
      if (Math.abs(bot - r.bottom) < 0.1 && Math.abs(top - r.top) < 0.1) return 'cab'
    }
    for (const r of ctVRanges) {
      if (Math.abs(bot - r.bottom) < 0.1 && Math.abs(top - r.top) < 0.1) return 'ct'
    }
    if (slatVRange && Math.abs(bot - slatVRange.bottom) < 0.1 && Math.abs(top - slatVRange.top) < 0.1) return 'slat'
    if (bbH > 0 && Math.abs(bot) < 0.1 && Math.abs(top - bbH) < 0.1) return 'bb'
    return 'gap'
  }

  // Vertical dimension tiers (inside → outside):
  //   dimX1  = unified cabinet/slatwall/gap strip
  //   dimX2  = wall full height (outermost, bold)
  let nextDimX = PAD - 8
  const dimX1 = nextDimX
  if (hasVSegs) nextDimX -= 8
  const dimX2 = nextDimX

  const clipId = `bp-clip-${wall.id.replace(/-/g, '')}`

  return (
    <svg
      viewBox={`0 0 ${svgW} ${svgH}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ width: '100%', height: '100%', display: 'block' }}
    >
      <defs>
        <clipPath id={clipId}>
          <rect x={PAD} y={PAD} width={wLen} height={wH} />
        </clipPath>
      </defs>

      {/* Background */}
      <rect x={0} y={0} width={svgW} height={svgH} fill="#ffffff" />

      {/* Wall face — extended behind corner stubs so there's no gap */}
      {(() => {
        let faceLeft = PAD, faceRight = PAD + wLen
        for (const stub of wallStubs) {
          if (stub.along <= 2) faceLeft = PAD - stub.thickness
          else if (stub.along >= wLen - 2) faceRight = PAD + wLen + stub.thickness
        }
        return <rect x={faceLeft} y={PAD} width={faceRight - faceLeft} height={wH} fill="#fafafa" />
      })()}

      {/* Mid stubs */}
      {wallStubs.filter(s => s.along >= 2 && s.along <= wLen - 2).map((stub, i) => (
        <g key={i}>
          <rect x={toX(stub.along - stub.thickness / 2)} y={PAD}
            width={stub.thickness} height={Math.min(stub.height, wH)}
            fill="#e0e0dc" stroke="#aaa" strokeWidth={0.5} opacity={0.9} />
          <line x1={toX(stub.along)} y1={PAD} x2={toX(stub.along)} y2={PAD + wH}
            stroke="#ccc" strokeWidth={0.4} strokeDasharray="4 3" />
        </g>
      ))}

      {/* Grid */}
      {Array.from({ length: Math.floor(wH / 12) + 1 }, (_, i) => i * 12).map(h =>
        h > 0 && h < wH && <line key={`hg${h}`} x1={PAD} y1={toY(h)} x2={PAD + wLen} y2={toY(h)} stroke="#eee" strokeWidth={0.35} strokeDasharray="4 4" />
      )}
      {Array.from({ length: Math.floor(wLen / 12) + 1 }, (_, i) => i * 12).map(a =>
        a > 0 && a < wLen && <line key={`vg${a}`} x1={toX(a)} y1={PAD} x2={toX(a)} y2={PAD + wH} stroke="#eee" strokeWidth={0.35} strokeDasharray="4 4" />
      )}

      {/* Floor steps */}
      {floorSteps.map(step => {
        const proj = getStepWallProjection(step, wall)
        if (!proj) return null
        return (
          <g key={step.id}>
            <rect
              x={toX(proj.alongStart)} y={toY(proj.height)}
              width={proj.alongEnd - proj.alongStart} height={proj.height}
              fill="#d8d0b8" stroke="#a09880" strokeWidth={0.4} opacity={0.5}
            />
            <text
              x={toX((proj.alongStart + proj.alongEnd) / 2)}
              y={toY(proj.height / 2)}
              textAnchor="middle" dominantBaseline="central"
              fontSize={Math.min(7, proj.height * 0.55)} fill="#776"
            >
              {step.label} ({step.height}")
            </text>
          </g>
        )
      })}

      {/* Baseboards now standalone — not rendered in wall elevation. */}

      {/* Openings */}
      {wall.openings.map(op => (
        <rect key={op.id}
          x={toX(op.xOffset)} y={toY(op.yOffset + op.height)}
          width={op.width} height={op.height}
          fill="#ffffff" stroke="#bbb" strokeWidth={0.5} />
      ))}

      {/* Clipped elements */}
      <g clipPath={`url(#${clipId})`}>
        {/* Slatwall — extended to wall edges when snapped near corner stubs */}
        {wallPanels.map(panel => {
          const vizStart = Math.abs(panel.alongStart - leftEdge) < 2 ? 0 : panel.alongStart
          const vizEnd = Math.abs(panel.alongEnd - rightEdge) < 2 ? wLen : panel.alongEnd
          const panelW = panel.alongEnd - panel.alongStart
          // Division trim positions every 96" (8') within the panel
          const dividers: number[] = []
          for (let offset = 96; offset < panelW; offset += 96) {
            dividers.push(panel.alongStart + offset)
          }
          return (
            <g key={panel.id}>
              <rect
                x={toX(vizStart)} y={toY(panel.yTop)}
                width={vizEnd - vizStart} height={panel.yTop - panel.yBottom}
                fill={colorHex(panel.color)} stroke="rgba(0,0,0,0.4)" strokeWidth={0.4} />
              {grooveLines(panel)}
              {/* Division trim pieces at 8' intervals */}
              {dividers.map((pos, i) => (
                <g key={`div${i}`}>
                  <rect
                    x={toX(pos) - 0.75} y={toY(panel.yTop)}
                    width={1.5} height={panel.yTop - panel.yBottom}
                    fill={colorHex(panel.color)} stroke="rgba(0,0,0,0.5)" strokeWidth={0.3} />
                </g>
              ))}
            </g>
          )
        })}

        {/* Stainless steel backsplash panels — thin plate, brushed silver */}
        {wallBacksplashes.map(panel => {
          const vizStart = Math.abs(panel.alongStart - leftEdge) < 2 ? 0 : panel.alongStart
          const vizEnd = Math.abs(panel.alongEnd - rightEdge) < 2 ? wLen : panel.alongEnd
          return (
            <rect key={panel.id}
              x={toX(vizStart)} y={toY(panel.yTop)}
              width={vizEnd - vizStart} height={panel.yTop - panel.yBottom}
              fill="#b8bcc0" stroke="rgba(0,0,0,0.4)" strokeWidth={0.4} />
          )
        })}

        {/* Cabinets — rendered via the shared cabinetFrontPaths function so
            the blueprint matches the 3D render and the left-panel thumbnails
            exactly (same door/drawer/handle geometry and colors). */}
        {wallCabinets.map(cab => {
          const { along } = projectCabinet(cab, wall)
          const cx = toX(along - cab.w / 2)
          const cy = toY(cab.y + cab.h)
          return (
            <g key={cab.id} transform={`translate(${cx}, ${cy})`}>
              {cabinetFrontPaths({
                w: cab.w, h: cab.h,
                doors: cab.doors, drawers: cab.drawers,
                style: cab.style, line: cab.line ?? 'technica',
                color: cab.color, shellColor: cab.shellColor,
                handleColor: cab.handleColor, handleSide: cab.handleSide,
              })}
            </g>
          )
        })}

        {/* Countertops */}
        {wallCountertops.map(ct => {
          const { along } = projectCountertop(ct, wall)
          const ctX = toX(along - ct.width / 2)
          const ctY = toY(ct.y + COUNTERTOP_THICKNESS)
          const ctHex = COUNTERTOP_HEX[ct.color] ?? '#b5813a'
          return (
            <rect key={ct.id} x={ctX} y={ctY} width={ct.width} height={COUNTERTOP_THICKNESS}
              fill={ctHex} stroke="#444" strokeWidth={0.4} />
          )
        })}
      </g>

      {/* Corner wall stubs — rendered on top so they cover slatwall edges */}
      {wallStubs.map((stub, i) => {
        const isLeft = stub.along < 2, isRight = stub.along > wLen - 2
        if (!isLeft && !isRight) return null
        const sh = Math.min(stub.height, wH)
        if (isLeft) {
          const stubRight = PAD + stub.thickness / 2
          return (
            <g key={`cs${i}`}>
              <rect x={PAD - stub.thickness} y={PAD} width={stubRight - (PAD - stub.thickness)} height={sh}
                fill="#e0e0dc" stroke="none" />
              <line x1={stubRight} y1={PAD} x2={stubRight} y2={PAD + sh} stroke="#aaa" strokeWidth={0.5} />
            </g>
          )
        }
        const stubLeft = PAD + wLen - stub.thickness / 2
        return (
          <g key={`cs${i}`}>
            <rect x={stubLeft} y={PAD} width={(PAD + wLen + stub.thickness) - stubLeft} height={sh}
              fill="#e0e0dc" stroke="none" />
            <line x1={stubLeft} y1={PAD} x2={stubLeft} y2={PAD + sh} stroke="#aaa" strokeWidth={0.5} />
          </g>
        )
      })}

      {/* Floor / ceiling / outline — extends to outer edge of corner walls */}
      {(() => {
        let outLeft = PAD, outRight = PAD + wLen
        for (const stub of wallStubs) {
          if (stub.along <= 2) outLeft = PAD - stub.thickness
          else if (stub.along >= wLen - 2) outRight = PAD + wLen + stub.thickness
        }
        return <>
          <line x1={0} y1={toY(0)} x2={svgW} y2={toY(0)} stroke="#444" strokeWidth={0.6} />
          <line x1={outLeft} y1={toY(wH)} x2={outRight} y2={toY(wH)} stroke="#bbb" strokeWidth={0.35} strokeDasharray="5 3" />
          <rect x={outLeft} y={PAD} width={outRight - outLeft} height={wH} fill="none" stroke="#222" strokeWidth={0.6} />
        </>
      })()}

      {/* ── Dimension annotations ── */}

      {/* Vertical witness lines */}
      <line x1={toX(0)} y1={toY(0)} x2={dimX2 - tk} y2={toY(0)} stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
      <line x1={toX(0)} y1={toY(wH)} x2={dimX2 - tk} y2={toY(wH)} stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
      {hasVSegs && vSorted.slice(1, -1).map((bp, i) => (
        <line key={`vw${i}`} x1={toX(0)} y1={toY(bp)} x2={dimX1 - tk} y2={toY(bp)}
          stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
      ))}

      {/* Vertical segments — tiny segments get their label moved outside on
         a leader so the tick marks don't obscure the text. */}
      {hasVSegs && vSorted.slice(0, -1).map((bot, i) => {
        const top = vSorted[i + 1]
        const y1 = toY(top), y2 = toY(bot), mid = (y1 + y2) / 2
        const segPx = y2 - y1
        const kind = classifyVSeg(bot, top)
        const color = TIER_COLOR[kind]
        const prefix = kind === 'cab' ? 'CAB ' : kind === 'slat' ? 'SW ' : kind === 'ct' ? 'CT ' : kind === 'bb' ? 'BB ' : ''
        const labelText = `${prefix}${inchesToDisplay(top - bot)}`
        const needed = labelText.length * fs * 0.55
        const inline = segPx > needed + 2
        // Skip labels on plain gap segments — matches wall edit view.
        const showLabel = kind !== 'gap'
        return (
          <g key={`vs${i}`}>
            <line x1={dimX1} y1={y1} x2={dimX1} y2={y2} stroke={color} strokeWidth={0.45} />
            <line x1={dimX1 - tk} y1={y1} x2={dimX1 + tk} y2={y1} stroke={color} strokeWidth={0.45} />
            <line x1={dimX1 - tk} y1={y2} x2={dimX1 + tk} y2={y2} stroke={color} strokeWidth={0.45} />
            {showLabel && inline && (
              // Rotate the label and anchor by its baseline so the text sits
              // entirely LEFT of the dim line (no overlap with the line).
              <text x={dimX1 - 1.5} y={mid} textAnchor="middle" dominantBaseline="text-after-edge"
                fill={color} fontSize={fs}
                transform={`rotate(-90 ${dimX1 - 1.5} ${mid})`}>{labelText}</text>
            )}
            {showLabel && !inline && (
              <>
                <line x1={dimX1 - tk - 1} y1={mid} x2={dimX1 - 14} y2={mid} stroke={color} strokeWidth={0.4} />
                <text x={dimX1 - 15} y={mid} textAnchor="end" dominantBaseline="middle"
                  fill={color} fontSize={fs}>{labelText}</text>
              </>
            )}
          </g>
        )
      })}

      {/* Vertical total */}
      {(() => {
        const y1 = toY(wH), y2 = toY(0), mid = (y1 + y2) / 2
        return (
          <g>
            <line x1={dimX2} y1={y1} x2={dimX2} y2={y2} stroke={TIER_COLOR.overall} strokeWidth={0.6} />
            <line x1={dimX2 - tk} y1={y1} x2={dimX2 + tk} y2={y1} stroke={TIER_COLOR.overall} strokeWidth={0.45} />
            <line x1={dimX2 - tk} y1={y2} x2={dimX2 + tk} y2={y2} stroke={TIER_COLOR.overall} strokeWidth={0.45} />
            <text x={dimX2 - 1.5} y={mid} textAnchor="middle" dominantBaseline="text-after-edge"
              fill={TIER_COLOR.overall} fontSize={fs} fontWeight="600"
              transform={`rotate(-90 ${dimX2 - 1.5} ${mid})`}>WALL {inchesToDisplay(wH)}</text>
          </g>
        )
      })()}

      {/* Horizontal witness lines — from interior face edges (extend to outermost tier) */}
      <line x1={toX(leftEdge)} y1={toY(0)} x2={toX(leftEdge)} y2={dimYTotal + tk} stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
      <line x1={toX(rightEdge)} y1={toY(0)} x2={toX(rightEdge)} y2={dimYTotal + tk} stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
      {hasHSegs && hSorted.slice(1, -1).map((bp, i) => (
        <line key={`hw${i}`} x1={toX(bp)} y1={toY(0)} x2={toX(bp)} y2={dimY1 + tk}
          stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
      ))}

      {/* Horizontal segments (tier 1 — closest to wall). Cabinets only get
         labels; gap segments are unlabeled to avoid confusion with baseboard
         spans that visually run through them. */}
      {hasHSegs && hSorted.slice(0, -1).map((start, i) => {
        const end = hSorted[i + 1]
        const x1 = toX(start), x2 = toX(end), mid = (x1 + x2) / 2
        const kind = classifySeg(start, end)
        const color = TIER_COLOR[kind]
        const prefix = kind === 'cab' ? 'CAB ' : ''
        const showLabel = (x2 - x1) > 14
        return (
          <g key={`hs${i}`}>
            <line x1={x1} y1={dimY1} x2={x2} y2={dimY1} stroke={color} strokeWidth={0.45} />
            <line x1={x1} y1={dimY1 - tk} x2={x1} y2={dimY1 + tk} stroke={color} strokeWidth={0.45} />
            <line x1={x2} y1={dimY1 - tk} x2={x2} y2={dimY1 + tk} stroke={color} strokeWidth={0.45} />
            {showLabel && (
              <text x={mid} y={dimY1 - 3} textAnchor="middle" fill={color} fontSize={fs}>
                {prefix}{inchesToDisplay(end - start)}
              </text>
            )}
          </g>
        )
      })}

      {/* Slatwall tier — full strip (SW spans + gaps + 8' breaks) */}
      {hasSlatTier && slatTierSegs.map((seg, i) => {
        const x1 = toX(seg.start), x2 = toX(seg.end), mid = (x1 + x2) / 2
        const segPx = x2 - x1
        const color = TIER_COLOR[seg.kind]
        const prefix = seg.kind === 'slat' ? 'SW ' : ''
        return (
          <g key={`slt${i}`}>
            <line x1={x1} y1={dimYSlat} x2={x2} y2={dimYSlat} stroke={color} strokeWidth={0.45} />
            <line x1={x1} y1={dimYSlat - tk} x2={x1} y2={dimYSlat + tk} stroke={color} strokeWidth={0.45} />
            <line x1={x2} y1={dimYSlat - tk} x2={x2} y2={dimYSlat + tk} stroke={color} strokeWidth={0.45} />
            {segPx > 14 ? (
              <text x={mid} y={dimYSlat - 1} textAnchor="middle" fill={color} fontSize={fs}>
                {prefix}{inchesToDisplay(seg.end - seg.start)}
              </text>
            ) : (
              <text x={mid} y={dimYSlat - 1} textAnchor="middle" fill={color} fontSize={2}
                transform={`rotate(-90 ${mid} ${dimYSlat - 1})`}>
                {prefix}{inchesToDisplay(seg.end - seg.start)}
              </text>
            )}
          </g>
        )
      })}

      {/* Horizontal total — full wall width (outermost tier, bold) */}
      {(hSorted.length > 3 || !hasHSegs) && (() => {
        const x1 = toX(leftEdge), x2 = toX(rightEdge), mid = (x1 + x2) / 2
        return (
          <g>
            <line x1={x1} y1={dimYTotal} x2={x2} y2={dimYTotal} stroke={TIER_COLOR.overall} strokeWidth={0.6} />
            <line x1={x1} y1={dimYTotal - tk} x2={x1} y2={dimYTotal + tk} stroke={TIER_COLOR.overall} strokeWidth={0.45} />
            <line x1={x2} y1={dimYTotal - tk} x2={x2} y2={dimYTotal + tk} stroke={TIER_COLOR.overall} strokeWidth={0.45} />
            <text x={mid} y={dimYTotal - 3} textAnchor="middle" fill={TIER_COLOR.overall} fontSize={fs} fontWeight="600">
              WALL {inchesToDisplay(rightEdge - leftEdge)}
            </text>
          </g>
        )
      })()}
    </svg>
  )
}
