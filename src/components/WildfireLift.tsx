/**
 * WildfireLift.tsx
 *
 * Procedural 3D mesh for Wildfire 4-post storage/parking lifts.
 * No GLB file required — geometry is built from spec dimensions.
 *
 * Rendered in "raised/storage" configuration: upper platform elevated,
 * lower bay open. All dimensions sourced from wildfirelifts.com specs.
 */


// ── Spec table ────────────────────────────────────────────────────────────────

interface LiftSpec {
  totalLength: number   // overall footprint depth in inches (runway + ramps)
  totalWidth: number    // overall footprint width in inches (outside of posts)
  postHeight: number    // column height in inches
  deckHeight: number    // raised platform height off floor in inches
  runwayWidth: number   // each runway platform width in inches
  rampLength: number    // approach ramp length in inches
  doubleWide?: boolean  // two cars side-by-side (4 runways, 6+ posts)
}

const LIFT_SPECS: Record<string, LiftSpec> = {
  'wildfire-standard':    { totalLength: 183, totalWidth: 114, postHeight:  92, deckHeight: 72, runwayWidth: 19, rampLength: 36 },
  'wildfire-xlt':         { totalLength: 204, totalWidth: 121, postHeight: 102, deckHeight: 82, runwayWidth: 19, rampLength: 36 },
  'wildfire-exotic':      { totalLength: 183, totalWidth: 121, postHeight:  92, deckHeight: 72, runwayWidth: 23, rampLength: 48 },
  'wildfire-exotic-tall': { totalLength: 183, totalWidth: 121, postHeight: 102, deckHeight: 81, runwayWidth: 23, rampLength: 48 },
  'wildfire-truck':       { totalLength: 226, totalWidth: 132, postHeight: 102, deckHeight: 81, runwayWidth: 19, rampLength: 48 },
  'wildfire-double-wide': { totalLength: 204, totalWidth: 213, postHeight: 100, deckHeight: 81, runwayWidth: 19, rampLength: 48, doubleWide: true },
  'wildfire-trailer':     { totalLength: 213, totalWidth: 107, postHeight:  96, deckHeight: 82, runwayWidth: 19, rampLength: 36 },
}

// ── Constants ─────────────────────────────────────────────────────────────────

const IN = (inches: number) => inches / 12   // inches → Three.js feet
const POST_W   = IN(5)     // 5"×5" structural steel columns
const DECK_TH  = IN(7)     // 7" runway platform thickness
const BEAM_TH  = IN(4)     // 4" horizontal cross-beam thickness
const RAIL_TH  = IN(2)     // 2" top safety rail

// Colors
const COL_STEEL   = '#7a7e84'   // column / post
const COL_DECK    = '#8a8e94'   // runway deck
const COL_BEAM    = '#6e7278'   // cross beams

// ── Helper components ─────────────────────────────────────────────────────────

function Box({
  w, h, d,
  x = 0, y = 0, z = 0,
  rotX = 0,
  color,
  wireframe = false,
}: {
  w: number; h: number; d: number
  x?: number; y?: number; z?: number
  rotX?: number
  color: string
  wireframe?: boolean
}) {
  return (
    <mesh position={[x, y, z]} rotation={[rotX, 0, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        metalness={0.65}
        wireframe={wireframe}
      />
    </mesh>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface WildfireLiftProps {
  type: string
  wireframe?: boolean
  selected?: boolean
}

export default function WildfireLift({ type, wireframe = false, selected = false }: WildfireLiftProps) {
  const spec = LIFT_SPECS[type]
  if (!spec) return null

  const {
    totalLength, totalWidth, postHeight, deckHeight,
    runwayWidth, rampLength, doubleWide,
  } = spec

  // All in feet
  const L   = IN(totalLength)
  const W   = IN(totalWidth)
  const PH  = IN(postHeight)
  const DH  = IN(deckHeight)
  const RW  = IN(runwayWidth)
  const RL  = IN(rampLength)

  // Runways span the full footprint length — no ramps, lowered to ground
  const runL = L
  const runwayFrontZ = -L / 2
  const runwayBackZ  =  L / 2
  const runwayCenterZ = 0

  // Post positions (X)
  const postOuterX = W / 2 - POST_W / 2

  // Runway positions (X) — flush with outer posts
  const runwayLeftCX  = -(W / 2 - RW / 2)
  const runwayRightCX =  (W / 2 - RW / 2)

  // Runways sit on the floor
  const deckCY = DECK_TH / 2

  // Cross-beam at top of posts
  const beamY = PH - BEAM_TH / 2

  // ── Double-wide specific ───────────────────────────────────────────────────
  const DW_GAP    = IN(38)   // gap between inner runways (center, between cars)
  const dw_rCX_FL = -(DW_GAP / 2 + RW * 1.5)
  const dw_rCX_CL = -(DW_GAP / 2 + RW * 0.5)
  const dw_rCX_CR =  (DW_GAP / 2 + RW * 0.5)
  const dw_rCX_FR =  (DW_GAP / 2 + RW * 1.5)
  const dw_postX_outer = W / 2 - POST_W / 2
  const dw_postX_inner = DW_GAP / 2 + RW + POST_W / 2

  return (
    <group>
      {/* ── Posts ─────────────────────────────────────────────────────────── */}
      {doubleWide ? (
        // 6 posts: 3 front, 3 back (left-outer, center, right-outer)
        <>
          {[runwayFrontZ + POST_W / 2, runwayBackZ - POST_W / 2].map(pz =>
            [
              [-dw_postX_outer, pz],
              [-dw_postX_inner, pz],
              [ dw_postX_inner, pz],
              [ dw_postX_outer, pz],
            ].map(([px], i) => (
              <Box key={`post-dw-${pz.toFixed(2)}-${i}`}
                w={POST_W} h={PH} d={POST_W}
                x={px as number} y={PH / 2} z={pz}
                color={COL_STEEL} wireframe={wireframe}
              />
            ))
          )}
        </>
      ) : (
        // 4 corner posts
        <>
          {[runwayFrontZ + POST_W / 2, runwayBackZ - POST_W / 2].map(pz =>
            [-postOuterX, postOuterX].map(px => (
              <Box key={`post-${pz.toFixed(2)}-${px.toFixed(2)}`}
                w={POST_W} h={PH} d={POST_W}
                x={px} y={PH / 2} z={pz}
                color={COL_STEEL} wireframe={wireframe}
              />
            ))
          )}
        </>
      )}

      {/* ── Runways (raised platform) ──────────────────────────────────────── */}
      {doubleWide ? (
        // 4 runways
        [dw_rCX_FL, dw_rCX_CL, dw_rCX_CR, dw_rCX_FR].map((rx, i) => (
          <Box key={`rw-${i}`}
            w={RW} h={DECK_TH} d={runL}
            x={rx} y={deckCY} z={runwayCenterZ}
            color={COL_DECK} wireframe={wireframe}
          />
        ))
      ) : (
        // 2 runways
        [runwayLeftCX, runwayRightCX].map((rx, i) => (
          <Box key={`rw-${i}`}
            w={RW} h={DECK_TH} d={runL}
            x={rx} y={deckCY} z={runwayCenterZ}
            color={COL_DECK} wireframe={wireframe}
          />
        ))
      )}

      {/* ── Cross-beams at top of posts ───────────────────────────────────── */}
      {[runwayFrontZ + POST_W / 2, runwayBackZ - POST_W / 2].map((pz, i) => (
        <Box key={`beam-${i}`}
          w={W} h={BEAM_TH} d={POST_W}
          x={0} y={beamY} z={pz}
          color={COL_BEAM} wireframe={wireframe}
        />
      ))}

      {/* ── Top safety rails connecting cross-beams ───────────────────────── */}
      {/* Side rails along the length of the lift at top of posts */}
      {[-postOuterX, postOuterX].map((rx, i) => (
        <Box key={`rail-${i}`}
          w={RAIL_TH} h={RAIL_TH} d={runL}
          x={rx} y={PH + RAIL_TH / 2} z={runwayCenterZ}
          color={COL_STEEL} wireframe={wireframe}
        />
      ))}

      {/* ── Selection highlight box ───────────────────────────────────────── */}
      {selected && (
        <mesh position={[0, PH / 2, 0]}>
          <boxGeometry args={[W + 0.08, PH + 0.08, L + 0.08]} />
          <meshBasicMaterial color="#4af" wireframe transparent opacity={0.18} />
        </mesh>
      )}
    </group>
  )
}
