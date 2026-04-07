import type { GarageWall, SlatwallPanel, PlacedCabinet, Countertop, FloorStep } from '../store/garageStore'
import { COUNTERTOP_THICKNESS } from '../store/garageStore'
import { slatwallColors } from '../data/slatwallColors'
import { inchesToDisplay } from '../utils/measurements'

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

const CABINET_HEX: Record<string, string> = {
  charcoal: '#3d3d3d', white: '#f2f2f0', driftwood: '#7a6a58', slate: '#5a6872', stone: '#7a7972',
}
const COUNTERTOP_HEX: Record<string, string> = {
  'butcher-block': '#b5813a', white: '#e8e8e4', black: '#2a2a2a', concrete: '#8a8a80',
}

/** Project a floor step onto a wall and return the along-wall range if adjacent */
function getStepWallProjection(
  step: FloorStep, w: GarageWall, tolerance = 6,
): { alongStart: number; alongEnd: number; height: number } | null {
  const len = wallLen(w)
  if (len < 0.01) return null
  const [ux, uz] = wallDir(w)
  const nx = -uz, nz = ux
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
  cabinets: PlacedCabinet[]
  countertops: Countertop[]
  allWalls: GarageWall[]
  floorSteps?: FloorStep[]
}

const PAD = 44

export default function WallElevationBlueprint({ wall, slatwallPanels, cabinets, countertops, allWalls, floorSteps = [] }: Props) {
  const wLen = wallLen(wall)
  const wH = wall.height
  const bbH = wall.baseboard ? wall.baseboardHeight : 0
  const svgW = wLen + 2 * PAD

  const toX = (a: number) => PAD + a
  const toY = (h: number) => PAD + wH - h

  const wallPanels = slatwallPanels.filter(p => p.wallId === wall.id && (p.side ?? 'interior') === 'interior')
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
  const fs = 6.5
  const tk = 4

  const hasItems = wallCabinets.length > 0 || wallPanels.length > 0
  const hBreaks = new Set<number>()
  hBreaks.add(hasItems ? leftEdge : 0)
  hBreaks.add(hasItems ? rightEdge : wLen)
  wallCabinets.forEach(cab => {
    const { along } = projectCabinet(cab, wall)
    hBreaks.add(Math.max(leftEdge, along - cab.w / 2))
    hBreaks.add(Math.min(rightEdge, along + cab.w / 2))
  })
  wallPanels.forEach(p => {
    hBreaks.add(Math.max(leftEdge, p.alongStart))
    hBreaks.add(Math.min(rightEdge, p.alongEnd))
  })
  const hSorted = [...hBreaks].sort((a, b) => a - b)
  const hasHSegs = hSorted.length > 2

  // Slatwall section breaks — every panel gets dimensioned, with dividers at 96" (8') intervals
  const slatSectionBreaks: Array<{ start: number; end: number; sections: number[] }> = []
  wallPanels.forEach(p => {
    const panelW = p.alongEnd - p.alongStart
    if (panelW < 1) return
    const sections: number[] = [p.alongStart]
    for (let offset = 96; offset < panelW; offset += 96) {
      sections.push(p.alongStart + offset)
    }
    sections.push(p.alongEnd)
    slatSectionBreaks.push({ start: p.alongStart, end: p.alongEnd, sections })
  })
  const hasSlatSections = slatSectionBreaks.length > 0

  // Horizontal dimension tiers (inside → outside):
  //   dimY1  = item segments (cabinets, slatwall edges)
  //   dimYSlat = slatwall 8' section widths (only when panels > 8')
  //   dimYTotal = full wall width (always outermost, bold)
  let nextDimY = toY(0) + 14
  const dimY1 = nextDimY                                               // item segments
  if (hasHSegs) nextDimY += 14
  const dimYSlat = nextDimY                                            // slatwall sections
  if (hasSlatSections) nextDimY += 14
  const dimYTotal = nextDimY                                           // wall total (outermost)

  const svgH = dimYTotal + tk + 8  // accommodate all dimension rows

  const vBreaks = new Set<number>()
  vBreaks.add(0); vBreaks.add(wH)
  wallCabinets.forEach(cab => {
    vBreaks.add(Math.max(0, cab.y))
    vBreaks.add(Math.min(wH, cab.y + cab.h))
  })
  const vSorted = [...vBreaks].sort((a, b) => a - b)
  const hasVSegs = vSorted.length > 2
  const dimX1 = PAD - 14
  const dimX2 = PAD - (hasVSegs ? 26 : 14)

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

      {/* Baseboard — elevated on top of floor steps */}
      {wall.baseboard && bbH > 0 && (() => {
        const stepOverlaps: { u0: number; u1: number; stepHeight: number }[] = []
        for (const step of floorSteps) {
          const proj = getStepWallProjection(step, wall)
          if (proj) stepOverlaps.push({ u0: proj.alongStart, u1: proj.alongEnd, stepHeight: proj.height })
        }
        if (stepOverlaps.length === 0) {
          return <rect x={PAD} y={toY(bbH)} width={wLen} height={bbH} fill={wall.baseboardColor ?? '#cccccc'} opacity={0.3} />
        }
        const events: number[] = [0, wLen]
        for (const ov of stepOverlaps) {
          if (ov.u0 > 0 && ov.u0 < wLen) events.push(ov.u0)
          if (ov.u1 > 0 && ov.u1 < wLen) events.push(ov.u1)
        }
        events.sort((a, b) => a - b)
        const segs: { x0: number; x1: number; elevate: number }[] = []
        for (let i = 0; i < events.length - 1; i++) {
          const x0 = events[i], x1 = events[i + 1]
          if (x1 - x0 < 0.01) continue
          const mid = (x0 + x1) / 2
          let elevate = 0
          for (const ov of stepOverlaps) {
            if (ov.u0 <= mid && ov.u1 >= mid) elevate = Math.max(elevate, ov.stepHeight)
          }
          segs.push({ x0, x1, elevate })
        }
        return segs.map((seg, i) => (
          <rect key={`bb${i}`}
            x={toX(seg.x0)} y={toY(seg.elevate + bbH)}
            width={seg.x1 - seg.x0} height={bbH}
            fill={wall.baseboardColor ?? '#cccccc'} opacity={0.3} />
        ))
      })()}

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

        {/* Cabinets — detailed elevation view */}
        {wallCabinets.map(cab => {
          const { along } = projectCabinet(cab, wall)
          const cx = toX(along - cab.w / 2)
          const cy = toY(cab.y + cab.h)
          const bodyHex = CABINET_HEX[cab.color] ?? '#3d3d3d'
          const isLight = ['white', 'driftwood', 'stone'].includes(cab.color)
          const lineColor = isLight ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)'
          const handleColor = isLight ? '#999' : '#aab'
          const hasToeKick = cab.style === 'lower' || cab.style === 'locker'
          const tkH = hasToeKick ? 4 : 0
          const fr = 1.5  // frame rail width (inches)
          const drawerCount = cab.drawers ?? 0

          // Door area: above toe kick and below drawers
          const doorY0 = cab.y + tkH + fr
          const fullTop = cab.y + cab.h - fr
          const drawerH6 = 6
          const doorY1 = drawerCount > 0 && cab.doors > 0
            ? fullTop - drawerCount * drawerH6
            : fullTop
          const doorH = Math.max(0, doorY1 - doorY0)

          // Drawer area
          const drawerAreaY0 = cab.doors === 0 ? doorY0 : fullTop - drawerCount * drawerH6
          const drawerAreaH = cab.doors === 0 ? fullTop - doorY0 : drawerCount * drawerH6

          // Door width
          const doorW1 = cab.w - 2 * fr         // single door width
          const doorW2 = (cab.w - 2 * fr - 1) / 2  // double door width (1" center gap)

          return (
            <g key={cab.id}>
              {/* Body fill */}
              <rect x={cx} y={cy} width={cab.w} height={cab.h} fill={bodyHex} stroke="#222" strokeWidth={0.5} />

              {/* Toe kick recess */}
              {hasToeKick && (
                <rect x={cx + 3} y={toY(cab.y + tkH)} width={cab.w - 6} height={tkH}
                  fill="rgba(0,0,0,0.3)" stroke="none" />
              )}

              {/* Door panels */}
              {cab.doors === 1 && doorH > 0 && (
                <g>
                  <rect x={cx + fr} y={toY(doorY1)} width={doorW1} height={doorH}
                    fill="none" stroke={lineColor} strokeWidth={0.5} />
                  {/* Handle — vertical bar, right side */}
                  <rect x={cx + cab.w - fr - 3} y={toY((doorY0 + doorY1) / 2 + 4)}
                    width={0.8} height={8} fill={handleColor} rx={0.3} />
                </g>
              )}
              {cab.doors === 2 && doorH > 0 && (
                <g>
                  {/* Left door */}
                  <rect x={cx + fr} y={toY(doorY1)} width={doorW2} height={doorH}
                    fill="none" stroke={lineColor} strokeWidth={0.5} />
                  {/* Left handle — inner edge */}
                  <rect x={cx + fr + doorW2 - 3} y={toY((doorY0 + doorY1) / 2 + 4)}
                    width={0.8} height={8} fill={handleColor} rx={0.3} />
                  {/* Right door */}
                  <rect x={cx + fr + doorW2 + 1} y={toY(doorY1)} width={doorW2} height={doorH}
                    fill="none" stroke={lineColor} strokeWidth={0.5} />
                  {/* Right handle — inner edge */}
                  <rect x={cx + fr + doorW2 + 1 + 2.2} y={toY((doorY0 + doorY1) / 2 + 4)}
                    width={0.8} height={8} fill={handleColor} rx={0.3} />
                </g>
              )}

              {/* Drawer fronts */}
              {drawerCount > 0 && (() => {
                const elems: JSX.Element[] = []
                const singleH = drawerAreaH / drawerCount
                const gap = 0.5
                const drawerW = cab.w - 2 * fr
                const pullW = cab.doors === 0 ? 3.5 : 5
                for (let i = 0; i < drawerCount; i++) {
                  const dy0 = drawerAreaY0 + i * singleH
                  const fH = singleH - gap
                  const fY = toY(dy0 + fH)
                  elems.push(
                    <g key={`dr${i}`}>
                      {/* Drawer front panel */}
                      <rect x={cx + fr} y={fY} width={drawerW} height={fH}
                        fill="none" stroke={lineColor} strokeWidth={0.5} />
                      {/* Horizontal pull handle — centered */}
                      <rect x={cx + cab.w / 2 - pullW / 2} y={fY + fH / 2 - 0.4}
                        width={pullW} height={0.8} fill={handleColor} rx={0.3} />
                    </g>
                  )
                }
                return elems
              })()}
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
            <g key={ct.id}>
              <rect x={ctX} y={ctY} width={ct.width} height={COUNTERTOP_THICKNESS}
                fill={ctHex} stroke="#444" strokeWidth={0.4} />
            </g>
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

      {/* Vertical segments */}
      {hasVSegs && vSorted.slice(0, -1).map((bot, i) => {
        const top = vSorted[i + 1]
        const y1 = toY(top), y2 = toY(bot), mid = (y1 + y2) / 2
        return (
          <g key={`vs${i}`}>
            <line x1={dimX1} y1={y1} x2={dimX1} y2={y2} stroke={dimColor} strokeWidth={0.45} />
            <line x1={dimX1 - tk} y1={y1} x2={dimX1 + tk} y2={y1} stroke={dimColor} strokeWidth={0.45} />
            <line x1={dimX1 - tk} y1={y2} x2={dimX1 + tk} y2={y2} stroke={dimColor} strokeWidth={0.45} />
            {(y2 - y1) > 14 && (
              <text x={dimX1 - 4} y={mid} textAnchor="middle" fill={textColor} fontSize={fs}
                transform={`rotate(-90 ${dimX1 - 4} ${mid})`}>{inchesToDisplay(top - bot)}</text>
            )}
          </g>
        )
      })}

      {/* Vertical total */}
      {(() => {
        const y1 = toY(wH), y2 = toY(0), mid = (y1 + y2) / 2
        return (
          <g>
            <line x1={dimX2} y1={y1} x2={dimX2} y2={y2} stroke={dimColor} strokeWidth={0.6} />
            <line x1={dimX2 - tk} y1={y1} x2={dimX2 + tk} y2={y1} stroke={dimColor} strokeWidth={0.45} />
            <line x1={dimX2 - tk} y1={y2} x2={dimX2 + tk} y2={y2} stroke={dimColor} strokeWidth={0.45} />
            <text x={dimX2 - 4} y={mid} textAnchor="middle" fill={textColor} fontSize={fs} fontWeight="600"
              transform={`rotate(-90 ${dimX2 - 4} ${mid})`}>{inchesToDisplay(wH)}</text>
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

      {/* Horizontal segments (tier 1 — closest to wall) */}
      {hasHSegs && hSorted.slice(0, -1).map((start, i) => {
        const end = hSorted[i + 1]
        const x1 = toX(start), x2 = toX(end), mid = (x1 + x2) / 2
        return (
          <g key={`hs${i}`}>
            <line x1={x1} y1={dimY1} x2={x2} y2={dimY1} stroke={dimColor} strokeWidth={0.45} />
            <line x1={x1} y1={dimY1 - tk} x2={x1} y2={dimY1 + tk} stroke={dimColor} strokeWidth={0.45} />
            <line x1={x2} y1={dimY1 - tk} x2={x2} y2={dimY1 + tk} stroke={dimColor} strokeWidth={0.45} />
            {(x2 - x1) > 14 && (
              <text x={mid} y={dimY1 - 3} textAnchor="middle" fill={textColor} fontSize={fs}>
                {inchesToDisplay(end - start)}
              </text>
            )}
          </g>
        )
      })}

      {/* Slatwall 8' section dimensions (tier 2 — middle) */}
      {hasSlatSections && slatSectionBreaks.map((sb, pi) =>
        sb.sections.slice(0, -1).map((secStart, i) => {
          const secEnd = sb.sections[i + 1]
          const x1 = toX(secStart), x2 = toX(secEnd), mid = (x1 + x2) / 2
          return (
            <g key={`ss${pi}-${i}`}>
              {/* Witness lines from section breaks down to slatwall dim row */}
              <line x1={x1} y1={toY(0)} x2={x1} y2={dimYSlat + tk}
                stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              {i === sb.sections.length - 2 && (
                <line x1={x2} y1={toY(0)} x2={x2} y2={dimYSlat + tk}
                  stroke={dimColor} strokeWidth={0.35} strokeDasharray="3 2" />
              )}
              {/* Dimension line */}
              <line x1={x1} y1={dimYSlat} x2={x2} y2={dimYSlat} stroke={dimColor} strokeWidth={0.45} />
              <line x1={x1} y1={dimYSlat - tk} x2={x1} y2={dimYSlat + tk} stroke={dimColor} strokeWidth={0.45} />
              <line x1={x2} y1={dimYSlat - tk} x2={x2} y2={dimYSlat + tk} stroke={dimColor} strokeWidth={0.45} />
              {(x2 - x1) > 14 ? (
                <text x={mid} y={dimYSlat - 3} textAnchor="middle" fill={textColor} fontSize={fs}>
                  {inchesToDisplay(secEnd - secStart)}
                </text>
              ) : (
                <text x={mid} y={dimYSlat - 3} textAnchor="middle" fill={textColor} fontSize={3.5}
                  transform={`rotate(-90 ${mid} ${dimYSlat - 3})`}>
                  {inchesToDisplay(secEnd - secStart)}
                </text>
              )}
            </g>
          )
        })
      )}

      {/* Horizontal total — full wall width (outermost tier, bold) */}
      {(hSorted.length > 3 || !hasHSegs) && (() => {
        const x1 = toX(leftEdge), x2 = toX(rightEdge), mid = (x1 + x2) / 2
        return (
          <g>
            <line x1={x1} y1={dimYTotal} x2={x2} y2={dimYTotal} stroke={dimColor} strokeWidth={0.6} />
            <line x1={x1} y1={dimYTotal - tk} x2={x1} y2={dimYTotal + tk} stroke={dimColor} strokeWidth={0.45} />
            <line x1={x2} y1={dimYTotal - tk} x2={x2} y2={dimYTotal + tk} stroke={dimColor} strokeWidth={0.45} />
            <text x={mid} y={dimYTotal - 3} textAnchor="middle" fill={textColor} fontSize={fs} fontWeight="600">
              {inchesToDisplay(rightEdge - leftEdge)}
            </text>
          </g>
        )
      })()}
    </svg>
  )
}
