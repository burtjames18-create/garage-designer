import type { ReactNode } from 'react'
import { useRef } from 'react'
import { useScrollToSelected } from '../hooks/useScrollToSelected'
import { useGarageStore } from '../store/garageStore'
import { flooringColors, flooringTexturePath } from '../data/flooringColors'
import { effectiveFloorPolygon } from '../utils/floorPolygon'
import WallPanel from './WallPanel'
import ShapePanel from './ShapePanel'
import CabinetsPanel from './CabinetsPanel'
import LightingPanel from './LightingPanel'
import ItemsPanel from './ItemsPanel'
import OverheadRacksPanel from './OverheadRacksPanel'
import GuidePanel from './GuidePanel'
import MeasureInput from './MeasureInput'
import './Sidebar.css'

import type { SidebarTab } from '../store/garageStore'

// ── SVG icons ──────────────────────────────────────────────────────────────
const IconWalls = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="16" height="14" rx="1.5"/>
    <line x1="2" y1="8" x2="18" y2="8"/>
    <line x1="2" y1="13" x2="18" y2="13"/>
    <line x1="9" y1="8" x2="9" y2="17"/>
  </svg>
)
const IconFloor = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 2L18 10L10 18L2 10Z"/>
    <line x1="10" y1="2" x2="10" y2="18"/>
    <line x1="2" y1="10" x2="18" y2="10"/>
  </svg>
)
const IconShapes = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="7" width="10" height="10" rx="1.5"/>
    <path d="M13 7L17 4H7L3 7"/>
    <line x1="17" y1="4" x2="17" y2="14"/>
    <line x1="13" y1="17" x2="17" y2="14"/>
  </svg>
)
const IconCabinets = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="7" height="14" rx="1.5"/>
    <rect x="11" y="3" width="7" height="14" rx="1.5"/>
    <line x1="9" y1="3" x2="11" y2="3"/>
    <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="10" r="1" fill="currentColor" stroke="none"/>
  </svg>
)
const IconCeiling = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="3" x2="18" y2="3"/>
    <line x1="10" y1="5" x2="10" y2="15"/>
    <path d="M7 12L10 15L13 12"/>
    <line x1="4" y1="3" x2="4" y2="6"/>
    <line x1="10" y1="3" x2="10" y2="5"/>
    <line x1="16" y1="3" x2="16" y2="6"/>
  </svg>
)
const IconOverhead = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="2" y1="2" x2="18" y2="2"/>
    <line x1="4" y1="2" x2="4" y2="8"/>
    <line x1="16" y1="2" x2="16" y2="8"/>
    <rect x="3" y="8" width="14" height="3" rx="0.5"/>
    <line x1="6" y1="8" x2="6" y2="11"/>
    <line x1="10" y1="8" x2="10" y2="11"/>
    <line x1="14" y1="8" x2="14" y2="11"/>
  </svg>
)
const IconLighting = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 3C7.2 3 5 5.2 5 8C5 10.1 6.3 11.9 8.1 12.7V14.5H11.9V12.7C13.7 11.9 15 10.1 15 8C15 5.2 12.8 3 10 3Z"/>
    <line x1="8" y1="16.5" x2="12" y2="16.5"/>
    <line x1="9" y1="18.5" x2="11" y2="18.5"/>
  </svg>
)
const IconVehicles = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 12L5.5 7H14.5L17 12"/>
    <rect x="2" y="12" width="16" height="4" rx="1"/>
    <circle cx="6" cy="16" r="1.5"/>
    <circle cx="14" cy="16" r="1.5"/>
    <line x1="9" y1="9" x2="11" y2="9"/>
  </svg>
)
const IconProject = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="3" width="12" height="15" rx="1.5"/>
    <path d="M8 3V5.5H12V3"/>
    <line x1="7" y1="9" x2="13" y2="9"/>
    <line x1="7" y1="12" x2="13" y2="12"/>
    <line x1="7" y1="15" x2="10.5" y2="15"/>
  </svg>
)
const IconGuide = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="10" cy="10" r="7"/>
    <path d="M8 7.5a2 2 0 1 1 3 1.7c-.6.4-1 .8-1 1.5v.3"/>
    <circle cx="10" cy="14" r="0.6" fill="currentColor"/>
  </svg>
)

const TAB_ICONS: Record<SidebarTab, ReactNode> = {
  walls:      <IconWalls />,
  flooring:   <IconFloor />,
  shapes:     <IconShapes />,
  ceiling:    <IconCeiling />,
  cabinets:   <IconCabinets />,
  overhead:   <IconOverhead />,
  lighting:   <IconLighting />,
  vehicles:   <IconVehicles />,
  info:       <IconProject />,
  guide:      <IconGuide />,
}

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'walls',    label: 'Walls'    },
  { id: 'flooring', label: 'Flooring' },
  { id: 'shapes',   label: 'Shapes'   },
  { id: 'cabinets', label: 'Cabinets' },
  { id: 'overhead', label: 'Overhead' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'info',     label: 'Project'  },
  { id: 'guide',    label: 'Guide'    },
]

function FloorStepItem({ step, isSel, onSelect, onDelete }: {
  step: { id: string; label: string }; isSel: boolean
  onSelect: () => void; onDelete: () => void
}) {
  const scrollRef = useScrollToSelected<HTMLDivElement>(isSel)
  return (
    <div
      ref={scrollRef}
      className={`list-item${isSel ? ' selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() }}}
      aria-selected={isSel}
    >
      <span className="list-item-label">{step.label}</span>
      <button
        className="delete-btn"
        onClick={e => { e.stopPropagation(); onDelete() }}
        aria-label={`Delete ${step.label}`}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
    </div>
  )
}

export default function Sidebar() {
  const {
    activeTab: tab, setActiveTab: setTab,
    flooringColor, setFlooringColor, floorTextureScale, setFloorTextureScale,
    customerName, siteAddress, consultantName, setCustomerInfo,
    floorSteps, selectedFloorStepId, addFloorStep, updateFloorStep, deleteFloorStep, selectFloorStep,
    importedAssets,
    walls, floorPoints, baseboards, stemWalls,
  } = useGarageStore()

  // Total flooring square footage = every surface that flake coating will
  // actually be applied to:
  //   floor polygon (step-up top is same footprint — not double-counted)
  //   + stem wall footprint (only walls with stemWall=true)
  //   + baseboard front face (only walls with baseboardTexture=true, length × height)
  //   + step-up exposed vertical faces (edges not touching a wall × step height)
  const flooringSqFt = (() => {
    // Use the LIVE polygon derived from walls — stored floorPoints can be
    // stale after resizing the room. The polygon vertices are wall CENTERLINE
    // intersections, so the raw shoelace would over-count by half the wall
    // thickness on every edge. Inset each polygon edge inward by half the
    // wall's thickness and recompute area to get the true INTERIOR floor.
    const livePts = effectiveFloorPolygon(walls, floorPoints)
    let shoelaceSqIn = 0
    const n = livePts.length
    if (n >= 3) {
      // Centerline shoelace (signed — sign tells us winding order).
      let signed = 0
      for (let i = 0; i < n; i++) {
        const a = livePts[i]
        const b = livePts[(i + 1) % n]
        signed += a.x * b.z - b.x * a.z
      }
      const ccw = signed > 0  // counter-clockwise winding?
      // For each edge, inward normal is the perpendicular pointing INTO the
      // polygon. Approximate per-edge inset using perimeter * avg thickness/2.
      // (Exact inset would require offsetting each edge and re-intersecting,
      // which gets messy at non-90° corners — perimeter approximation is
      // accurate to ~0.1% for typical rooms.)
      let perimeter = 0
      for (let i = 0; i < n; i++) {
        const a = livePts[i]
        const b = livePts[(i + 1) % n]
        perimeter += Math.hypot(b.x - a.x, b.z - a.z)
      }
      // Average wall thickness (use 3.5" if no walls — won't happen here).
      const avgT = walls.length > 0
        ? walls.reduce((s, w) => s + w.thickness, 0) / walls.length
        : 3.5
      const halfT = avgT / 2
      const centerlineArea = Math.abs(signed) / 2
      // Subtract a thin band of (halfT × perimeter) — area lost when insetting.
      shoelaceSqIn = Math.max(0, centerlineArea - halfT * perimeter)
      void ccw
    }
    // Stem wall front face — only when the piece has flake enabled.
    // (Footprint isn't double-counted because a stem wall is recessed INTO the
    // wall; the floor under it is already part of the polygon.)
    let stemSqIn = 0
    for (const sw of stemWalls) {
      if (!sw.flake) continue
      stemSqIn += sw.length * sw.height
    }
    // Baseboard front face — only when the piece has flake enabled.
    // Length × height of the front (interior-facing) face only.
    let bbFaceSqIn = 0
    for (const bb of baseboards) {
      if (!bb.flake) continue
      bbFaceSqIn += bb.length * bb.height
    }
    // Step-up exposed vertical faces. Each step-up is a rectangle (width × depth
    // × height). For each of the four edges, if it is NOT touching a wall face
    // (within a small tolerance), count it as exposed. Exposed face area =
    // edge length × step height.
    let stepFaceSqIn = 0
    const TOUCH_TOL = 2  // inches: edge is "against wall" if within this
    for (const step of floorSteps) {
      const c = step.corners
      for (let i = 0; i < c.length; i++) {
        const [x1, z1] = c[i], [x2, z2] = c[(i + 1) % c.length]
        const edgeLen = Math.hypot(x2 - x1, z2 - z1)
        if (edgeLen < 0.1) continue
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2
        let touching = false
        for (const w of walls) {
          const wdx = w.x2 - w.x1, wdz = w.z2 - w.z1
          const wlen = Math.hypot(wdx, wdz)
          if (wlen < 1) continue
          const ux = wdx / wlen, uz = wdz / wlen
          const vx = mx - w.x1, vz = mz - w.z1
          const along = vx * ux + vz * uz
          const perp = Math.abs(vx * (-uz) + vz * ux)
          if (along < -1 || along > wlen + 1) continue
          if (perp <= w.thickness / 2 + TOUCH_TOL) { touching = true; break }
        }
        if (!touching) stepFaceSqIn += edgeLen * step.height
      }
    }
    return (shoelaceSqIn + stemSqIn + bbFaceSqIn + stepFaceSqIn) / 144
  })()

  // All imported textures are available for flooring too (wall/floor/generic
  // are all equivalent once imported).
  const importedFloorTextures = importedAssets.filter(a =>
    a.assetType === 'wall-texture' || a.assetType === 'floor-texture' || a.assetType === 'texture')

  const classic  = flooringColors.filter(c => c.series === 'classic')
  const stone    = flooringColors.filter(c => c.series === 'stone')
  const concrete = flooringColors.filter(c => c.series === 'concrete')

  const currentTab = TABS.find(t => t.id === tab)

  // Guard against spurious clicks fired by pointer-capture release (canvas drag end).
  const railDownId = useRef<string | null>(null)

  return (
    <div className="sidebar" role="complementary" aria-label="Design tools">

      {/* ── Vertical icon rail ── */}
      <nav className="sidebar-rail" role="tablist" aria-label="Panel tabs" aria-orientation="vertical">
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            id={`tab-${t.id}`}
            className={`rail-btn ${tab === t.id ? 'active' : ''}`}
            onPointerDown={() => { railDownId.current = t.id }}
            onClick={() => {
              if (railDownId.current === t.id) setTab(t.id)
              railDownId.current = null
            }}
            aria-label={t.label}
          >
            {TAB_ICONS[t.id]}
          </button>
        ))}
      </nav>

      {/* ── Content pane ── */}
      <div className="sidebar-pane"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        <div className="pane-header">
          <span className="pane-title">{currentTab?.label}</span>
        </div>

        <div className="pane-scroll">
          <div className="tab-content">

          {tab === 'walls' && <WallPanel />}

          {tab === 'flooring' && (
            <div>
              {/* ── Total flooring area ── */}
              <div className="field-group" style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', marginBottom: 10,
                background: 'rgba(255,255,255,0.05)', borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.1)',
              }}>
                <span style={{ fontSize: 11, color: '#aaa' }}>Total floor area</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: '#eee' }}>
                  {flooringSqFt.toFixed(2)} sq ft
                </span>
              </div>

              {/* ── Step-Ups ── */}
              <div className="section-label">Step-Ups</div>
              <button className="add-btn" style={{ marginBottom: 8 }} onClick={addFloorStep}>
                + Add Step-Up
              </button>

              {floorSteps.map(step => (
                <FloorStepItem key={step.id} step={step}
                  isSel={selectedFloorStepId === step.id}
                  onSelect={() => selectFloorStep(selectedFloorStepId === step.id ? null : step.id)}
                  onDelete={() => deleteFloorStep(step.id)} />
              ))}

              {selectedFloorStepId && (() => {
                const step = floorSteps.find(s => s.id === selectedFloorStepId)
                if (!step) return null
                return (
                  <div className="field-group" style={{ marginTop: 8 }}>
                    <MeasureInput label="Height" inches={step.height} onChange={v => updateFloorStep(step.id, { height: Math.max(0.5, v) })} min={0.5} max={48} />
                    <p className="field-hint">Drag corners in the 3D view to reshape</p>
                  </div>
                )
              })()}

              <div className="section-label" style={{ marginTop: 18 }}>Chip Scale</div>
              <div className="field-group">
                <div className="scale-row">
                  <input
                    type="range" min={1} max={24} step={0.5}
                    value={floorTextureScale}
                    onChange={e => setFloorTextureScale(+e.target.value)}
                    className="scale-slider"
                    aria-label="Floor chip texture scale"
                  />
                  <span className="scale-val">{floorTextureScale}"</span>
                </div>
                <p className="field-hint">Lower value = smaller chips</p>
              </div>

              <div className="section-label">Classic FLOORTEX®</div>
              <div className="color-grid" role="radiogroup" aria-label="Classic flooring color">
                {classic.map(c => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={flooringColor === c.id}
                    className={`color-swatch ${flooringColor === c.id ? 'selected' : ''}`}
                    onClick={() => setFlooringColor(c.id)}
                    aria-label={c.name}
                  >
                    <div className="swatch-img" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}${flooringTexturePath(c)})` }} />
                    <span className="swatch-name">{c.name}</span>
                  </button>
                ))}
              </div>

              <div className="section-label" style={{ marginTop: 18 }}>Stone Series</div>
              <div className="color-grid" role="radiogroup" aria-label="Stone flooring color">
                {stone.map(c => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={flooringColor === c.id}
                    className={`color-swatch ${flooringColor === c.id ? 'selected' : ''}`}
                    onClick={() => setFlooringColor(c.id)}
                    aria-label={c.name}
                  >
                    <div className="swatch-img" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}${flooringTexturePath(c)})` }} />
                    <span className="swatch-name">{c.name}</span>
                  </button>
                ))}
              </div>

              <div className="section-label" style={{ marginTop: 18 }}>Concrete</div>
              <div className="color-grid" role="radiogroup" aria-label="Concrete flooring">
                {concrete.map(c => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={flooringColor === c.id}
                    className={`color-swatch ${flooringColor === c.id ? 'selected' : ''}`}
                    onClick={() => setFlooringColor(c.id)}
                    aria-label={c.name}
                  >
                    <div className="swatch-img" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}${flooringTexturePath(c)})` }} />
                    <span className="swatch-name">{c.name}</span>
                  </button>
                ))}
              </div>

              {importedFloorTextures.length > 0 && (
                <>
                  <div className="section-label" style={{ marginTop: 18 }}>Imported Textures</div>
                  <div className="color-grid" role="radiogroup" aria-label="Imported floor textures">
                    {importedFloorTextures.map(t => (
                      <button
                        key={t.id}
                        role="radio"
                        aria-checked={flooringColor === `imported:${t.id}`}
                        className={`color-swatch ${flooringColor === `imported:${t.id}` ? 'selected' : ''}`}
                        onClick={() => setFlooringColor(`imported:${t.id}`)}
                        aria-label={t.name}
                      >
                        <div className="swatch-img" style={{ backgroundImage: `url(${t.data})` }} />
                        <span className="swatch-name">{t.name.replace(/\.[^.]+$/, '')}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

            </div>
          )}

          {tab === 'shapes' && <ShapePanel />}

          {tab === 'cabinets' && <CabinetsPanel />}

          {tab === 'overhead' && <OverheadRacksPanel />}

          {tab === 'lighting' && <LightingPanel />}

          {tab === 'vehicles' && <ItemsPanel />}


          {tab === 'info' && (
            <div>
              <div className="field-group">
                <div className="info-field">
                  <label className="info-label" htmlFor="info-customer">Customer Name</label>
                  <input
                    id="info-customer"
                    className="info-input"
                    value={customerName}
                    onChange={e => setCustomerInfo(e.target.value, siteAddress, consultantName)}
                    placeholder="Enter customer name"
                  />
                </div>
                <div className="info-field">
                  <label className="info-label" htmlFor="info-address">Site Address</label>
                  <input
                    id="info-address"
                    className="info-input"
                    value={siteAddress}
                    onChange={e => setCustomerInfo(customerName, e.target.value, consultantName)}
                    placeholder="Enter site address"
                  />
                </div>
                <div className="info-field">
                  <label className="info-label" htmlFor="info-consultant">Design Consultant</label>
                  <input
                    id="info-consultant"
                    className="info-input"
                    value={consultantName}
                    onChange={e => setCustomerInfo(customerName, siteAddress, e.target.value)}
                    placeholder="Consultant name"
                  />
                </div>
              </div>
            </div>
          )}

          {tab === 'guide' && <GuidePanel />}

          </div>
        </div>
      </div>
    </div>
  )
}
