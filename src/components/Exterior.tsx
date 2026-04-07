/**
 * Exterior.tsx
 *
 * Renders the outdoor environment around the garage:
 *   - Grass ground plane (entire world)
 *   - Sidewalk butted directly against the garage front
 *   - Road just beyond the sidewalk
 *   - Road markings (center yellow dashes, white edge lines, curb)
 *
 * Layout along Z (negative Z = "in front" of garage):
 *   +Z → garage back → garage → garage front → sidewalk → curb → road → far grass
 *
 * Only rendered in perspective mode.
 */

import { useGarageStore } from '../store/garageStore'

const FT = (inches: number) => inches / 12

// ── Exterior dimensions (feet) ────────────────────────────────────────────────
const GROUND_HALF  = 500    // half-side of the grass ground plane
const SIDEWALK_W   = 7      // sidewalk width (ft)
const CURB_H       = 0.42   // curb height (ft, ~5")
const CURB_W       = 0.5    // curb depth (ft)
const ROAD_W       = 28     // road width, 2 lanes × 14ft

// ── Materials / colors ────────────────────────────────────────────────────────
const C_GRASS      = '#4a7a3a'   // lawn green
const C_SIDEWALK   = '#c4bcac'   // light concrete
const C_CURB       = '#d4ccc0'   // slightly lighter curb
const C_ROAD       = '#2c2c2c'   // asphalt
const C_STRIPE_Y   = '#f0c800'   // yellow center dashes
const C_STRIPE_W   = '#e8e8e8'   // white edge lines

// ── Stripe parameters ─────────────────────────────────────────────────────────
const DASH_LEN     = 10     // ft per yellow dash
const DASH_GAP     = 30     // ft between dash starts (gap = 20ft)
const DASH_W       = 0.5    // ft wide
const EDGE_W       = 0.5    // ft white edge line width
const DASH_COUNT   = Math.ceil((GROUND_HALF * 2) / DASH_GAP) + 2

// ── polygonOffset values for each depth layer ─────────────────────────────────
// Prevents z-fighting between coplanar planes at large view distances.
// More negative factor/units = pushed closer to camera = rendered on top.
const PO_GROUND  = { polygonOffset: true, polygonOffsetFactor: 0,  polygonOffsetUnits: 0  }
const PO_SURFACE = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }
const PO_STRIPE  = { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }

export default function Exterior() {
  const { garageDepth, viewMode } = useGarageStore()
  if (viewMode !== 'perspective') return null

  const dFt = FT(garageDepth)

  // ── Z positions relative to garage front (garage front = +dFt/2) ──────────
  const garageFrontZ  = dFt / 2
  const sidewalkFarZ  = garageFrontZ + SIDEWALK_W        // far edge of sidewalk
  const curbCenterZ   = sidewalkFarZ + CURB_W / 2        // curb centerline
  const roadNearZ     = sidewalkFarZ + CURB_W            // near edge of road
  const roadFarZ      = roadNearZ + ROAD_W               // far edge of road
  const roadCenterZ   = (roadNearZ + roadFarZ) / 2
  const sidewalkCenterZ = (garageFrontZ + sidewalkFarZ) / 2

  // Stripe Z positions
  const edgeNearZ  = roadNearZ + EDGE_W / 2   // white line at road near edge
  const edgeFarZ   = roadFarZ  - EDGE_W / 2   // white line at road far edge

  // Dash X positions — spread across full ground width, starting left
  const dashOffset = -GROUND_HALF - DASH_GAP

  return (
    <group>
      {/* ── Grass: full world ground plane ──────────────────────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, 0]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_HALF * 2, GROUND_HALF * 2]} />
        <meshLambertMaterial color={C_GRASS} {...PO_GROUND} />
      </mesh>

      {/* ── Sidewalk: butted directly against garage front ──────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, sidewalkCenterZ]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_HALF * 2, SIDEWALK_W]} />
        <meshLambertMaterial color={C_SIDEWALK} {...PO_SURFACE} />
      </mesh>

      {/* ── Curb: raised edge between sidewalk and road ──────────────────────── */}
      <mesh position={[0, CURB_H / 2, curbCenterZ]} receiveShadow castShadow>
        <boxGeometry args={[GROUND_HALF * 2, CURB_H, CURB_W]} />
        <meshLambertMaterial color={C_CURB} />
      </mesh>

      {/* ── Road: asphalt surface ───────────────────────────────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, roadCenterZ]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_HALF * 2, ROAD_W]} />
        <meshLambertMaterial color={C_ROAD} {...PO_SURFACE} />
      </mesh>

      {/* ── White edge line — road near side ────────────────────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, edgeNearZ]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_HALF * 2, EDGE_W]} />
        <meshLambertMaterial color={C_STRIPE_W} {...PO_STRIPE} />
      </mesh>

      {/* ── White edge line — road far side ─────────────────────────────────── */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, edgeFarZ]}
        receiveShadow
      >
        <planeGeometry args={[GROUND_HALF * 2, EDGE_W]} />
        <meshLambertMaterial color={C_STRIPE_W} {...PO_STRIPE} />
      </mesh>

      {/* ── Yellow center dashes ─────────────────────────────────────────────── */}
      {Array.from({ length: DASH_COUNT }, (_, i) => {
        const x = dashOffset + i * DASH_GAP
        return (
          <mesh
            key={i}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[x, 0, roadCenterZ]}
            receiveShadow
          >
            <planeGeometry args={[DASH_LEN, DASH_W]} />
            <meshLambertMaterial color={C_STRIPE_Y} {...PO_STRIPE} />
          </mesh>
        )
      })}
    </group>
  )
}
