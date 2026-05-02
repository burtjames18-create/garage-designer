import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useGarageStore, BREAKER_PANEL_DIMS, WALL_OUTLET_DIMS, WALL_WATER_HEATER_DIMS, WALL_FRIDGE_DIMS } from '../store/garageStore'
import { useScrollToSelected } from '../hooks/useScrollToSelected'
import type { GarageWall } from '../store/garageStore'
import MeasureInput from './MeasureInput'
import { wallLengthIn, inchesToDisplay } from '../utils/measurements'
import { slatwallColors } from '../data/slatwallColors'
import { wallTextures, texturePath } from '../data/textureCatalog'
import { flooringColors, flooringTexturePath } from '../data/flooringColors'
import type { ImportedAsset } from '../store/garageStore'
import { getModelsForType } from '../data/openingModels'
import { SLATWALL_ACCESSORIES } from '../data/slatwallAccessories'
import { IconDelete, IconDuplicate, IconLocked, IconUnlocked } from './Icons'
import TracingImageControls from './TracingImageControls'
// BaseboardStemWallList below uses IconLocked/IconUnlocked too, so we just reuse
// the imports already brought in for WallEditor.
import ConfirmDialog from './ConfirmDialog'
import { showToast } from './Toast'
import './WallPanel.css'


/** Collapsible section with a clickable header */
function Section({ title, defaultOpen = false, forceOpen = false, sectionRef, children }: {
  title: string; defaultOpen?: boolean; forceOpen?: boolean
  sectionRef?: React.Ref<HTMLDivElement>; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { if (forceOpen) setOpen(true) }, [forceOpen])
  return (
    <div className="wall-section" ref={sectionRef}>
      <button className="wall-section-header" onClick={() => setOpen(o => !o)}>
        <span className="wall-section-chevron" data-open={open}>&#9656;</span>
        <span>{title}</span>
      </button>
      {open && <div className="wall-section-body">{children}</div>}
    </div>
  )
}

const WALL_COLORS = [
  { name: 'Off-White',      hex: '#f0ede4' },
  { name: 'Bright White',   hex: '#f5f5f5' },
  { name: 'Cool White',     hex: '#e0dedd' },
  { name: 'Light Grey',     hex: '#d4d4d4' },
  { name: 'Medium Grey',    hex: '#aaaaaa' },
  { name: 'Beige',          hex: '#e8dcc8' },
  { name: 'Tan',            hex: '#d4b896' },
  { name: 'Light Blue',     hex: '#ccd8e8' },
  { name: 'Sage Green',     hex: '#c4d4c0' },
  { name: 'Charcoal',       hex: '#606060' },
]

const OPENING_LABELS: Record<string, string> = {
  'garage-door': 'Garage Door',
  'door': 'Door',
  'window': 'Window',
}

/** Large 2D preview tile for picking a door style. */
function DoorStyleTile({ active, label, onClick, kind, doorColor, frameColor }: {
  active: boolean
  label: string
  onClick: () => void
  kind: 'flat' | 'plain' | 'double'
  doorColor?: string
  frameColor?: string
}) {
  return (
    <button
      role="radio"
      aria-checked={active}
      aria-label={label}
      title={label}
      className={`door-style-tile${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <svg viewBox="0 0 40 56" className="door-style-svg" aria-hidden="true">
        {/* Wall surround */}
        <rect x="0" y="0" width="40" height="56" fill="#2a2e35" />
        {kind === 'flat' ? (
          <>
            {/* Bare cut-out — dark void, no frame, no slab */}
            <rect x="8" y="10" width="24" height="46" fill="#0a0d12" />
            <rect x="8" y="10" width="24" height="46" fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth="0.4" />
          </>
        ) : kind === 'double' ? (
          <>
            {/* Casing / frame — inverted "U" hugging three sides of the opening */}
            <path
              d="M3 5 L37 5 L37 56 L33 56 L33 9 L7 9 L7 56 L3 56 Z"
              fill={frameColor ?? '#f0ede4'}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth="0.5"
              strokeLinejoin="miter"
            />
            {/* Head-casing shadow */}
            <rect x="7.5" y="9" width="25" height="1.5" fill="rgba(0,0,0,0.15)" />
            {/* Two slabs meeting at center */}
            <rect x="8"  y="10" width="11.6" height="46" fill={doorColor ?? '#e0dedd'} />
            <rect x="20.4" y="10" width="11.6" height="46" fill={doorColor ?? '#e0dedd'} />
            {/* Center gap */}
            <rect x="19.6" y="10" width="0.8" height="46" fill="rgba(0,0,0,0.35)" />
            {/* Slab edge shading */}
            <rect x="8"  y="10" width="11.6" height="46" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.4" />
            <rect x="20.4" y="10" width="11.6" height="46" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.4" />
            {/* Hinges on outer edges */}
            <rect x="7.7" y="14.5" width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="7.7" y="32"   width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="7.7" y="49.5" width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="31.1" y="14.5" width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="31.1" y="32"   width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="31.1" y="49.5" width="1.2" height="2.8" fill="#555" opacity="0.75" />
            {/* Center-pull knobs */}
            <circle cx="17.6" cy="34.75" r="1.1" fill="#B8B8B0" stroke="rgba(0,0,0,0.35)" strokeWidth="0.25" />
            <circle cx="22.4" cy="34.75" r="1.1" fill="#B8B8B0" stroke="rgba(0,0,0,0.35)" strokeWidth="0.25" />
          </>
        ) : (
          <>
            {/* Casing / frame — inverted "U" hugging three sides of the opening */}
            <path
              d="M3 5 L37 5 L37 56 L33 56 L33 9 L7 9 L7 56 L3 56 Z"
              fill={frameColor ?? '#f0ede4'}
              stroke="rgba(0,0,0,0.35)"
              strokeWidth="0.5"
              strokeLinejoin="miter"
            />
            {/* Soft shadow where the head casing meets the slab */}
            <rect x="7.5" y="9" width="25" height="1.5" fill="rgba(0,0,0,0.15)" />
            {/* Slab */}
            <rect x="8" y="10" width="24" height="46" fill={doorColor ?? '#e0dedd'} />
            {/* Slab edge shading for depth */}
            <rect x="8" y="10" width="24" height="46" fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="0.4" />
            <rect x="8.8" y="10.8" width="22.4" height="44.4" fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth="0.3" />
            {/* Hinges on the left slab edge */}
            <rect x="7.7" y="14.5" width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="7.7" y="32"   width="1.2" height="2.8" fill="#555" opacity="0.75" />
            <rect x="7.7" y="49.5" width="1.2" height="2.8" fill="#555" opacity="0.75" />
            {/* Handle: rose + lever in satin nickel */}
            <rect x="24" y="34.1" width="4.2" height="1.3" rx="0.4" fill="#B8B8B0" />
            <circle cx="28.6" cy="34.75" r="1.6" fill="#B8B8B0" stroke="rgba(0,0,0,0.35)" strokeWidth="0.25" />
            <circle cx="28.6" cy="34.75" r="0.6" fill="rgba(0,0,0,0.25)" />
          </>
        )}
        {/* Floor line at bottom of tile for grounding */}
        <line x1="0" y1="55.7" x2="40" y2="55.7" stroke="rgba(0,0,0,0.5)" strokeWidth="0.6" />
      </svg>
      <span className="door-style-label">{label}</span>
    </button>
  )
}

function WallEditor({ wall, expandedWallId, setExpandedWallId }: {
  wall: GarageWall
  expandedWallId: string | null
  setExpandedWallId: (id: string | null) => void
}) {
  const {
    updateWall, deleteWall, selectWall, duplicateWall, selectedWallId,
    addOpening, updateOpening, removeOpening,
    slatwallPanels, addSlatwallPanel, updateSlatwallPanel, deleteSlatwallPanel, selectSlatwallPanel, selectedSlatwallPanelId,
    slatwallAccessories, addSlatwallAccessory, deleteSlatwallAccessory,
    stainlessBacksplashPanels, addStainlessBacksplashPanel, updateStainlessBacksplashPanel, deleteStainlessBacksplashPanel, selectStainlessBacksplashPanel, selectedStainlessBacksplashPanelId,
    breakerPanels, addBreakerPanel, updateBreakerPanel, deleteBreakerPanel, selectBreakerPanel, selectedBreakerPanelId,
    wallOutlets, addWallOutlet, updateWallOutlet, deleteWallOutlet, selectWallOutlet, selectedWallOutletId,
    wallWaterHeaters, addWallWaterHeater, updateWallWaterHeater, deleteWallWaterHeater, selectWallWaterHeater, selectedWallWaterHeaterId,
    fridges, addFridge, deleteFridge, selectFridge, selectedFridgeId,
    importedAssets,
    addBaseboard, addStemWall, walls,
  } = useGarageStore()
  // Compute the interior span of a wall — trims each end by the connected
  // wall's thickness/2 so baseboard / stem-wall pieces sit between adjacent
  // walls without clipping into them.
  const interiorSpan = (w: typeof walls[number]) => {
    const len = Math.hypot(w.x2 - w.x1, w.z2 - w.z1) || 1
    const CONNECT = 6
    let trim1 = 0, trim2 = 0
    for (const o of walls) {
      if (o.id === w.id) continue
      const halfO = o.thickness / 2
      if (Math.hypot(o.x1 - w.x1, o.z1 - w.z1) < CONNECT ||
          Math.hypot(o.x2 - w.x1, o.z2 - w.z1) < CONNECT) trim1 = Math.max(trim1, halfO)
      if (Math.hypot(o.x1 - w.x2, o.z1 - w.z2) < CONNECT ||
          Math.hypot(o.x2 - w.x2, o.z2 - w.z2) < CONNECT) trim2 = Math.max(trim2, halfO)
    }
    return { len, trim1, trim2, interior: Math.max(1, len - trim1 - trim2) }
  }
  // Spawn a baseboard sized edge-to-edge along the wall's interior span,
  // centered on that span and flush against the wall's interior face.
  const addBaseboardForWall = (wallId: string) => {
    const w = walls.find(ww => ww.id === wallId)
    if (!w) return addBaseboard()
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len, uz = dz / len
    const { trim1, trim2, interior } = interiorSpan(w)
    // Center of the interior span (along the wall axis).
    const midAlong = (trim1 + len - trim2) / 2
    const cx = w.x1 + ux * midAlong, cz = w.z1 + uz * midAlong
    let nx = -uz, nz = ux
    const wmx = (w.x1 + w.x2) / 2, wmz = (w.z1 + w.z2) / 2
    if (wmx * nx + wmz * nz > 0) { nx = -nx; nz = -nz }
    const inset = w.thickness / 2 + 0.25
    addBaseboard({
      x: cx + nx * inset,
      z: cz + nz * inset,
      rotY: -Math.atan2(uz, ux),
      length: interior,
    })
  }
  // Spawn a stem wall sized edge-to-edge along the wall's interior span,
  // centered on that span. Inset to sit flush with the wall's interior face.
  const addStemWallForWall = (wallId: string) => {
    const w = walls.find(ww => ww.id === wallId)
    if (!w) return addStemWall()
    const dx = w.x2 - w.x1, dz = w.z2 - w.z1
    const len = Math.hypot(dx, dz) || 1
    const ux = dx / len, uz = dz / len
    const { trim1, trim2, interior } = interiorSpan(w)
    const midAlong = (trim1 + len - trim2) / 2
    const cx = w.x1 + ux * midAlong, cz = w.z1 + uz * midAlong
    let nx = -uz, nz = ux
    const wmx = (w.x1 + w.x2) / 2, wmz = (w.z1 + w.z2) / 2
    if (wmx * nx + wmz * nz > 0) { nx = -nx; nz = -nz }
    const inset = w.thickness / 2 + 0.0625
    addStemWall({
      x: cx + nx * inset,
      z: cz + nz * inset,
      rotY: -Math.atan2(uz, ux),
      length: interior,
    })
  }
  // All imported textures are available across every surface; the legacy
  // wall-texture / floor-texture / texture types are all treated as equivalent.
  const importedWallTextures = importedAssets.filter((a: ImportedAsset) =>
    a.assetType === 'wall-texture' || a.assetType === 'floor-texture' || a.assetType === 'texture')
  const wallPanels = slatwallPanels.filter(p => p.wallId === wall.id)
  const wallBacksplashes = stainlessBacksplashPanels.filter(p => p.wallId === wall.id)
  const wallBreakers = breakerPanels.filter(p => p.wallId === wall.id)
  const wallOutletsList = wallOutlets.filter(o => o.wallId === wall.id)
  const wallHeatersList = wallWaterHeaters.filter(h => h.wallId === wall.id)
  // Fridges are free-standing (not wall-attached); show the global list in the
  // sidebar regardless of which wall is open.
  const wallFridgesList = fridges
  const selected = selectedWallId === wall.id
  // Detail section stays open even after the wall is deselected in the scene;
  // it only closes when another wall is expanded or the user toggles it off.
  const expanded = expandedWallId === wall.id
  const len = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const wallScrollRef = useScrollToSelected<HTMLDivElement>(expanded)
  const slatwallRef = useRef<HTMLDivElement>(null)
  const backsplashRef = useRef<HTMLDivElement>(null)
  const hasSlatwallSelected = wallPanels.some(p => p.id === selectedSlatwallPanelId)
  const hasBacksplashSelected = wallBacksplashes.some(p => p.id === selectedStainlessBacksplashPanelId)
  const hasBreakerSelected = wallBreakers.some(p => p.id === selectedBreakerPanelId)
  const hasOutletSelected = wallOutletsList.some(o => o.id === selectedWallOutletId)
  const hasHeaterSelected = wallHeatersList.some(h => h.id === selectedWallWaterHeaterId)
  const hasFridgeSelected = wallFridgesList.some(f => f.id === selectedFridgeId)
  const breakerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (hasSlatwallSelected && slatwallRef.current) {
      slatwallRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hasSlatwallSelected, selectedSlatwallPanelId])

  useEffect(() => {
    if (hasBacksplashSelected && backsplashRef.current) {
      backsplashRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hasBacksplashSelected, selectedStainlessBacksplashPanelId])

  useEffect(() => {
    if ((hasBreakerSelected || hasOutletSelected || hasHeaterSelected || hasFridgeSelected) && breakerRef.current) {
      breakerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [hasBreakerSelected, hasOutletSelected, hasHeaterSelected, hasFridgeSelected, selectedBreakerPanelId, selectedWallOutletId, selectedWallWaterHeaterId, selectedFridgeId])

  const handleLengthChange = (newLen: number) => {
    if (newLen <= 0) return
    if (wall.locked) return
    const dx = wall.x2 - wall.x1
    const dz = wall.z2 - wall.z1
    const curLen = Math.hypot(dx, dz)
    if (curLen === 0) return
    const ux = dx / curLen, uz = dz / curLen
    // Pick the anchor end (stays fixed) and the moving end. If exactly one
    // end is connected to another wall, anchor that end. Otherwise anchor
    // (x1, z1). Then any OTHER walls whose endpoint sits at the moving end's
    // OLD position get translated by the same delta — so welded corners stay
    // welded when the length changes.
    const CONNECT = 2
    const connectedAt = (x: number, z: number) =>
      walls.some(o => o.id !== wall.id && (
        Math.hypot(o.x1 - x, o.z1 - z) < CONNECT ||
        Math.hypot(o.x2 - x, o.z2 - z) < CONNECT
      ))
    const end2Connected = connectedAt(wall.x2, wall.z2)
    const end1Connected = connectedAt(wall.x1, wall.z1)
    const anchorIs2 = end2Connected && !end1Connected
    const oldMoveX = anchorIs2 ? wall.x1 : wall.x2
    const oldMoveZ = anchorIs2 ? wall.z1 : wall.z2
    const anchorX  = anchorIs2 ? wall.x2 : wall.x1
    const anchorZ  = anchorIs2 ? wall.z2 : wall.z1
    const newMoveX = anchorIs2 ? anchorX - ux * newLen : anchorX + ux * newLen
    const newMoveZ = anchorIs2 ? anchorZ - uz * newLen : anchorZ + uz * newLen
    const dX = newMoveX - oldMoveX
    const dZ = newMoveZ - oldMoveZ

    // Translate connected walls' matching endpoints by the same delta so the
    // shared corner moves as one. Locked walls are skipped — they stay put
    // and the corner detaches.
    for (const o of walls) {
      if (o.id === wall.id || o.locked) continue
      const changes: Partial<GarageWall> = {}
      if (Math.hypot(o.x1 - oldMoveX, o.z1 - oldMoveZ) < CONNECT) {
        changes.x1 = o.x1 + dX; changes.z1 = o.z1 + dZ
      }
      if (Math.hypot(o.x2 - oldMoveX, o.z2 - oldMoveZ) < CONNECT) {
        changes.x2 = o.x2 + dX; changes.z2 = o.z2 + dZ
      }
      if (Object.keys(changes).length > 0) updateWall(o.id, changes)
    }

    if (anchorIs2) updateWall(wall.id, { x1: newMoveX, z1: newMoveZ })
    else           updateWall(wall.id, { x2: newMoveX, z2: newMoveZ })
  }

  const handleDeleteConfirm = () => {
    deleteWall(wall.id)
    showToast(`Deleted ${wall.label}`, 'info')
    setConfirmDelete(false)
  }

  return (
    <div
      ref={wallScrollRef}
      className={`wall-item ${selected ? 'selected' : ''}${expanded ? ' expanded' : ''}`}
      onClick={() => {
        // Toggle detail when tapping an already-expanded card; otherwise
        // expand this one and make it the scene selection.
        if (expanded) setExpandedWallId(null)
        else { setExpandedWallId(wall.id); selectWall(wall.id) }
      }}
    >
      <div className="wall-header">
        <input
          className="wall-name-input"
          value={wall.label}
          onChange={e => updateWall(wall.id, { label: e.target.value })}
          onClick={e => e.stopPropagation()}
          aria-label="Wall name"
        />
        <span className="wall-length">{inchesToDisplay(len)}</span>
        <div className="wall-actions">
          <button
            className={`wall-lock-btn${wall.locked ? ' locked' : ''}`}
            aria-label={wall.locked ? 'Unlock position' : 'Lock position'}
            onClick={e => { e.stopPropagation(); updateWall(wall.id, { locked: !wall.locked }) }}
          >{wall.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}</button>
          <button aria-label={`Duplicate ${wall.label}`} onClick={e => { e.stopPropagation(); duplicateWall(wall.id) }}>
            <IconDuplicate size={12} />
          </button>
          <button aria-label={`Delete ${wall.label}`} className="delete-btn" onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}>
            <IconDelete size={12} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="wall-detail" onClick={e => e.stopPropagation()}>

          {/* Dimensions — always visible at the top of the wall card. */}
          <div className="dim-grid" style={{ marginBottom: 10 }}>
            <MeasureInput label="Length" inches={len} onChange={handleLengthChange} min={1} max={9999} disabled={wall.locked} />
            <MeasureInput label="Height" inches={wall.height} onChange={v => updateWall(wall.id, { height: v })} min={12} max={360} disabled={wall.locked} />
            <MeasureInput label="Thickness" inches={wall.thickness} onChange={v => updateWall(wall.id, { thickness: v })} min={1} max={24} disabled={wall.locked} />
          </div>

          {/* Quick-access buttons — visibility toggle plus piece quick-adds. */}
          <div className="stem-wall-texture-row" style={{ marginBottom: 6, gap: 6, flexWrap: 'wrap' }}>
            <button
              className="stem-wall-tex-btn"
              aria-pressed={(wall.visible ?? true) === false}
              onClick={e => { e.stopPropagation(); updateWall(wall.id, { visible: !(wall.visible ?? true) }) }}
            >{(wall.visible ?? true) ? 'Hide' : 'Show'}</button>
            <button
              className="stem-wall-tex-btn"
              onClick={e => { e.stopPropagation(); addBaseboardForWall(wall.id) }}
            >+ Baseboard</button>
            <button
              className="stem-wall-tex-btn"
              onClick={e => { e.stopPropagation(); addStemWallForWall(wall.id) }}
            >+ Stem Wall</button>
          </div>

          {/* Appearance */}
          <Section title="Color / Texture">
            <div style={{ marginBottom: 8 }}>
              <span className="coord-label">Wall Color</span>
              <div className="slat-color-row" role="radiogroup" aria-label="Wall color">
                {WALL_COLORS.map(c => {
                  const isActive = !wall.wallTextureId && (wall.wallColor ?? '#e0dedd') === c.hex
                  return (
                    <button
                      key={c.hex}
                      role="radio"
                      aria-checked={isActive}
                      className={`slat-color-swatch${isActive ? ' active' : ''}`}
                      style={{ background: c.hex, position: 'relative' }}
                      aria-label={c.name}
                      onClick={() => updateWall(wall.id, { wallColor: c.hex, wallTextureId: undefined })}
                    >
                      {isActive && (
                        <span aria-hidden style={{
                          position: 'absolute', top: '50%', right: 8, transform: 'translateY(-50%)',
                          width: 16, height: 16, borderRadius: '50%',
                          background: 'var(--accent)', color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <span className="coord-label">Wall Texture</span>
              <div className="slat-color-row" role="radiogroup" aria-label="Wall texture" style={{ flexWrap: 'wrap', gap: 4 }}>
                <button
                  role="radio"
                  aria-checked={!wall.wallTextureId}
                  className={`slat-color-swatch${!wall.wallTextureId ? ' active' : ''}`}
                  style={{ background: wall.wallColor ?? '#e0dedd', fontSize: 8, color: '#666', lineHeight: 1 }}
                  aria-label="No texture (solid color)"
                  title="Solid Color"
                  onClick={() => updateWall(wall.id, { wallTextureId: undefined })}
                >
                  —
                </button>
                {wallTextures.map(t => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={wall.wallTextureId === t.id}
                    className={`slat-color-swatch${wall.wallTextureId === t.id ? ' active' : ''}`}
                    style={{
                      backgroundImage: `url(${import.meta.env.BASE_URL}${texturePath(t.category, t.file)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    aria-label={t.name}
                    title={t.name}
                    onClick={() => updateWall(wall.id, { wallTextureId: t.id })}
                  />
                ))}
                {importedWallTextures.map(t => (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={wall.wallTextureId === `imported:${t.id}`}
                    className={`slat-color-swatch${wall.wallTextureId === `imported:${t.id}` ? ' active' : ''}`}
                    style={{
                      backgroundImage: `url(${t.data})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    aria-label={t.name}
                    title={`Imported: ${t.name}`}
                    onClick={() => updateWall(wall.id, { wallTextureId: `imported:${t.id}` })}
                  />
                ))}
              </div>
            </div>
          </Section>


          {/* Openings — renamed in the UI to call out the three opening types
              the user can add (Window / Door / GD = garage door). */}
          <Section title={`Window / Door / GD (${wall.openings.length})`}>
            <div className="openings-header">
              <div className="opening-add-row">
                <button className="opening-add-btn" onClick={() => addOpening(wall.id, 'garage-door')}>+ Garage Door</button>
                <button className="opening-add-btn" onClick={() => addOpening(wall.id, 'door')}>+ Door</button>
                <button className="opening-add-btn" onClick={() => addOpening(wall.id, 'window')}>+ Window</button>
              </div>
            </div>

            {wall.openings.map(op => {
              const rightWall = Math.max(0, len - op.xOffset - op.width)
              // Editing Left Wall or Right Wall resizes the opening; the
              // opposite side stays put and the total wall length is
              // unchanged. (Use the Length field on the wall itself to
              // resize the wall.) Enforce a 12" minimum opening width.
              const MIN_OP = 12
              const rightEdge = op.xOffset + op.width
              const handleLeftWall = (v: number) => {
                const newLeft = Math.max(0, Math.min(rightEdge - MIN_OP, v))
                const newWidth = rightEdge - newLeft
                updateOpening(wall.id, op.id, { xOffset: newLeft, width: newWidth })
              }
              const handleRightWall = (v: number) => {
                const newRightWall = Math.max(0, Math.min(len - op.xOffset - MIN_OP, v))
                const newWidth = len - op.xOffset - newRightWall
                updateOpening(wall.id, op.id, { width: newWidth })
              }
              return (
                <div key={op.id} className="opening-item">
                  <div className="opening-item-header">
                    <span className="opening-type-label">{OPENING_LABELS[op.type] ?? op.type}</span>
                    <button className="delete-btn" onClick={() => removeOpening(wall.id, op.id)} aria-label={`Remove ${OPENING_LABELS[op.type] ?? op.type}`}>
                      <IconDelete size={10} />
                    </button>
                  </div>
                  <div className="dim-grid">
                    <MeasureInput label="Width"  inches={op.width}   onChange={v => updateOpening(wall.id, op.id, { width: v })}   min={12} />
                    <MeasureInput label="Height" inches={op.height}  onChange={v => updateOpening(wall.id, op.id, { height: v })}  min={12} />
                    {op.type === 'garage-door' ? (<>
                      <MeasureInput label="Left Wall"  inches={op.xOffset} onChange={handleLeftWall}  min={0} />
                      <MeasureInput label="Right Wall" inches={rightWall}  onChange={handleRightWall} min={0} />
                    </>) : (
                      <MeasureInput label="Offset" inches={op.xOffset} onChange={v => updateOpening(wall.id, op.id, { xOffset: v })} min={0} />
                    )}
                    {/* Sill height — distance from floor to bottom of opening.
                        Most relevant for windows; doors usually sit on floor
                        but we expose it for all opening types. */}
                    {op.type !== 'garage-door' && (
                      <MeasureInput
                        label="Floor Offset"
                        inches={op.yOffset}
                        onChange={v => updateOpening(wall.id, op.id, { yOffset: Math.max(0, v) })}
                        min={0}
                      />
                    )}
                  </div>
                  {op.type === 'door' && (
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="coord-label" style={{ flex: 1 }}>Swing side</span>
                      <button
                        type="button"
                        className={`stem-wall-tex-btn${(op.swingSide ?? 'interior') === 'interior' ? ' active' : ''}`}
                        onClick={() => updateOpening(wall.id, op.id, { swingSide: 'interior' })}
                      >Interior</button>
                      <button
                        type="button"
                        className={`stem-wall-tex-btn${op.swingSide === 'exterior' ? ' active' : ''}`}
                        onClick={() => updateOpening(wall.id, op.id, { swingSide: 'exterior' })}
                      >Exterior</button>
                    </div>
                  )}

                  {/* Style picker for doors — 2D preview tiles showing door shape */}
                  {op.type === 'door' && (
                    <div style={{ marginTop: 6 }}>
                      <span className="coord-label">Style</span>
                      <div className="door-style-row" role="radiogroup" aria-label="Door style">
                        <DoorStyleTile
                          active={!op.modelId}
                          label="Open Doorway"
                          onClick={() => updateOpening(wall.id, op.id, { modelId: undefined })}
                          kind="flat"
                        />
                        <DoorStyleTile
                          active={op.modelId === 'custom-plain'}
                          label="Custom Plain"
                          onClick={() => updateOpening(wall.id, op.id, { modelId: 'custom-plain' })}
                          kind="plain"
                          doorColor={op.doorColor ?? '#e0dedd'}
                          frameColor={op.frameColor ?? '#f0ede4'}
                        />
                        <DoorStyleTile
                          active={op.modelId === 'custom-double'}
                          label="Double Closet"
                          onClick={() => updateOpening(wall.id, op.id, { modelId: 'custom-double' })}
                          kind="double"
                          doorColor={op.doorColor ?? '#e0dedd'}
                          frameColor={op.frameColor ?? '#f0ede4'}
                        />
                      </div>
                    </div>
                  )}


                  {/* Procedural door colors — door slab + frame (separate swatches) */}
                  {op.type === 'door' && (op.modelId === 'custom-plain' || op.modelId === 'custom-double') && (
                    <>
                      <div style={{ marginTop: 6 }}>
                        <span className="coord-label">Door Color</span>
                        <div className="slat-color-row" role="radiogroup" aria-label="Door color">
                          {WALL_COLORS.map(c => (
                            <button
                              key={c.hex}
                              role="radio"
                              aria-checked={(op.doorColor ?? '#e0dedd') === c.hex}
                              className={`slat-color-swatch${(op.doorColor ?? '#e0dedd') === c.hex ? ' active' : ''}`}
                              style={{ background: c.hex }}
                              aria-label={c.name}
                              title={c.name}
                              onClick={() => updateOpening(wall.id, op.id, { doorColor: c.hex })}
                            />
                          ))}
                        </div>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <span className="coord-label">Frame Color</span>
                        <div className="slat-color-row" role="radiogroup" aria-label="Frame color">
                          {WALL_COLORS.map(c => (
                            <button
                              key={c.hex}
                              role="radio"
                              aria-checked={(op.frameColor ?? '#f0ede4') === c.hex}
                              className={`slat-color-swatch${(op.frameColor ?? '#f0ede4') === c.hex ? ' active' : ''}`}
                              style={{ background: c.hex }}
                              aria-label={c.name}
                              title={c.name}
                              onClick={() => updateOpening(wall.id, op.id, { frameColor: c.hex })}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </Section>

          {/* Slatwall */}
          <Section title={`Slatwall (${wallPanels.length})`} forceOpen={hasSlatwallSelected} sectionRef={slatwallRef}>
            <div className="openings-header">
              <button className="opening-add-btn" onClick={() => addSlatwallPanel(wall.id)}>+ Add Panel</button>
            </div>
            {wallPanels.map(panel => {
              const panelW = panel.alongEnd - panel.alongStart
              const panelH = panel.yTop - panel.yBottom
              return (
                <div key={panel.id}
                  className={`opening-item${selectedSlatwallPanelId === panel.id ? ' selected' : ''}`}
                  onClick={() => selectSlatwallPanel(panel.id)}
                >
                  <div className="opening-item-header">
                    <span className="opening-type-label">
                      Panel — {inchesToDisplay(panelW)} × {inchesToDisplay(panelH)}
                    </span>
                    <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteSlatwallPanel(panel.id) }}
                      aria-label="Delete slatwall panel">
                      <IconDelete size={10} />
                    </button>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <div className="dim-grid">
                      <MeasureInput label="Width" inches={panelW}
                        onChange={v => updateSlatwallPanel(panel.id, { alongEnd: panel.alongStart + Math.max(1, Math.min(v, len - panel.alongStart)) })}
                        min={1} max={len} compact />
                      <MeasureInput label="Height" inches={panelH}
                        onChange={v => updateSlatwallPanel(panel.id, { yTop: panel.yBottom + Math.max(1, v) })}
                        min={1} max={wall.height} compact />
                      <MeasureInput label="Left Offset" inches={panel.alongStart}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, len - panelW))
                          updateSlatwallPanel(panel.id, { alongStart: clamped, alongEnd: clamped + panelW })
                        }}
                        min={0} max={len} compact />
                      <MeasureInput label="Bottom" inches={panel.yBottom}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, wall.height - panelH))
                          updateSlatwallPanel(panel.id, { yBottom: clamped, yTop: clamped + panelH })
                        }}
                        min={0} max={wall.height} compact />
                    </div>
                    <div className="slat-color-row" role="radiogroup" aria-label="Slatwall panel color">
                      {slatwallColors.map(c => (
                        <button
                          key={c.id}
                          role="radio"
                          aria-checked={panel.color === c.id}
                          className={`slat-color-swatch${panel.color === c.id ? ' active' : ''}`}
                          style={{ ['--swatch' as string]: c.hex }}
                          aria-label={c.name}
                          onClick={() => updateSlatwallPanel(panel.id, { color: c.id })}
                        >{c.name}</button>
                      ))}
                    </div>
                    {/* Accessories for this panel */}
                    {selectedSlatwallPanelId === panel.id && (
                      <div className="slat-acc-section">
                        <span className="slat-acc-label">Add Accessories</span>
                        <div className="slat-acc-grid">
                          {SLATWALL_ACCESSORIES.map(def => (
                            <button key={def.type} className="slat-acc-btn"
                              onClick={() => addSlatwallAccessory(panel.id, def)}
                              aria-label={`Add ${def.label} — $${def.price}`}
                            >
                              <span className="slat-acc-name">{def.label}</span>
                              <span className="slat-acc-price">${def.price}</span>
                            </button>
                          ))}
                        </div>
                        {slatwallAccessories.filter(a => a.panelId === panel.id).map(acc => (
                          <div key={acc.id} className="slat-acc-item">
                            <span>{acc.label}</span>
                            <span className="slat-acc-price">${acc.price}</span>
                            <button className="delete-btn" onClick={() => deleteSlatwallAccessory(acc.id)} aria-label={`Remove ${acc.label}`}>
                              <IconDelete size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </Section>

          {/* Stainless steel backsplash — mounts and moves like slatwall but
              it's a thin (1/8") brushed stainless plate with no color options */}
          <Section title={`Stainless Backsplash (${wallBacksplashes.length})`} forceOpen={hasBacksplashSelected} sectionRef={backsplashRef}>
            <div className="openings-header">
              <button className="opening-add-btn" onClick={() => addStainlessBacksplashPanel(wall.id)}>+ Add Backsplash</button>
            </div>
            {wallBacksplashes.map(panel => {
              const panelW = panel.alongEnd - panel.alongStart
              const panelH = panel.yTop - panel.yBottom
              return (
                <div key={panel.id}
                  className={`opening-item${selectedStainlessBacksplashPanelId === panel.id ? ' selected' : ''}`}
                  onClick={() => selectStainlessBacksplashPanel(panel.id)}
                >
                  <div className="opening-item-header">
                    <span className="opening-type-label">
                      Backsplash — {inchesToDisplay(panelW)} × {inchesToDisplay(panelH)}
                    </span>
                    <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteStainlessBacksplashPanel(panel.id) }}
                      aria-label="Delete stainless backsplash">
                      <IconDelete size={10} />
                    </button>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <div className="dim-grid">
                      <MeasureInput label="Width" inches={panelW}
                        onChange={v => updateStainlessBacksplashPanel(panel.id, { alongEnd: panel.alongStart + Math.max(1, Math.min(v, len - panel.alongStart)) })}
                        min={1} max={len} compact />
                      <MeasureInput label="Height" inches={panelH}
                        onChange={v => updateStainlessBacksplashPanel(panel.id, { yTop: panel.yBottom + Math.max(1, v) })}
                        min={1} max={wall.height} compact />
                      <MeasureInput label="Left Offset" inches={panel.alongStart}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, len - panelW))
                          updateStainlessBacksplashPanel(panel.id, { alongStart: clamped, alongEnd: clamped + panelW })
                        }}
                        min={0} max={len} compact />
                      <MeasureInput label="Bottom" inches={panel.yBottom}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, wall.height - panelH))
                          updateStainlessBacksplashPanel(panel.id, { yBottom: clamped, yTop: clamped + panelH })
                        }}
                        min={0} max={wall.height} compact />
                    </div>
                    {(() => {
                      const current = panel.texture ?? 'stainless'
                      const options: { id: 'stainless' | 'diamondplate'; label: string }[] = [
                        { id: 'stainless', label: 'Brushed Stainless' },
                        { id: 'diamondplate', label: 'Diamond Plate' },
                      ]
                      return (
                        <div role="radiogroup" aria-label="Backsplash finish" style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                          {options.map(o => {
                            const active = current === o.id
                            return (
                              <button
                                key={o.id}
                                role="radio"
                                aria-checked={active}
                                onClick={() => updateStainlessBacksplashPanel(panel.id, { texture: o.id })}
                                style={{
                                  flex: 1,
                                  padding: '6px 8px',
                                  fontSize: 11,
                                  fontWeight: active ? 600 : 400,
                                  color: active ? '#0b62c4' : '#333',
                                  background: active ? '#eaf3fc' : '#fafafa',
                                  border: active ? '2px solid #2a8cf0' : '1px solid #ccc',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                  outline: 'none',
                                }}
                              >
                                {o.label}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </Section>

          {/* Wall fixtures — breaker panels, outlets, water heaters, fridges */}
          <Section title={`Wall Fixtures (${wallBreakers.length + wallOutletsList.length + wallHeatersList.length + wallFridgesList.length})`} forceOpen={hasBreakerSelected || hasOutletSelected || hasHeaterSelected || hasFridgeSelected} sectionRef={breakerRef}>
            <div className="openings-header" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="opening-add-btn" onClick={() => addBreakerPanel(wall.id, 'single')}>+ Single</button>
              <button className="opening-add-btn" onClick={() => addBreakerPanel(wall.id, 'double')}>+ Double</button>
              <button className="opening-add-btn" onClick={() => addWallOutlet(wall.id)}>+ Outlet</button>
              <button className="opening-add-btn" onClick={() => addWallWaterHeater(wall.id)}>+ Water Heater</button>
              <button className="opening-add-btn" onClick={() => addFridge(wall.id)}>+ Generic Fridge</button>
            </div>
            {wallBreakers.map(panel => {
              const dims = BREAKER_PANEL_DIMS[panel.kind]
              return (
                <div key={panel.id}
                  className={`opening-item${selectedBreakerPanelId === panel.id ? ' selected' : ''}`}
                  onClick={() => selectBreakerPanel(panel.id)}
                >
                  <div className="opening-item-header">
                    <span className="opening-type-label">
                      Breaker ({panel.kind}) — {inchesToDisplay(dims.w)} × {inchesToDisplay(dims.h)}
                    </span>
                    <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteBreakerPanel(panel.id) }}
                      aria-label="Delete breaker panel">
                      <IconDelete size={10} />
                    </button>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <div className="dim-grid">
                      <MeasureInput label="Left Offset" inches={panel.alongStart}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, len - dims.w))
                          updateBreakerPanel(panel.id, { alongStart: clamped })
                        }}
                        min={0} max={len} compact />
                      <MeasureInput label="Bottom" inches={panel.yBottom}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, wall.height - dims.h))
                          updateBreakerPanel(panel.id, { yBottom: clamped })
                        }}
                        min={0} max={wall.height} compact />
                    </div>
                  </div>
                </div>
              )
            })}
            {wallOutletsList.map(outlet => {
              const dims = WALL_OUTLET_DIMS
              return (
                <div key={outlet.id}
                  className={`opening-item${selectedWallOutletId === outlet.id ? ' selected' : ''}`}
                  onClick={() => selectWallOutlet(outlet.id)}
                >
                  <div className="opening-item-header">
                    <span className="opening-type-label">
                      Outlet — {inchesToDisplay(dims.w)} × {inchesToDisplay(dims.h)}
                    </span>
                    <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteWallOutlet(outlet.id) }}
                      aria-label="Delete wall outlet">
                      <IconDelete size={10} />
                    </button>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <div className="dim-grid">
                      <MeasureInput label="Left Offset" inches={outlet.alongStart}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, len - dims.w))
                          updateWallOutlet(outlet.id, { alongStart: clamped })
                        }}
                        min={0} max={len} compact />
                      <MeasureInput label="Bottom" inches={outlet.yBottom}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, wall.height - dims.h))
                          updateWallOutlet(outlet.id, { yBottom: clamped })
                        }}
                        min={0} max={wall.height} compact />
                    </div>
                  </div>
                </div>
              )
            })}
            {wallHeatersList.map(heater => {
              const dims = WALL_WATER_HEATER_DIMS
              return (
                <div key={heater.id}
                  className={`opening-item${selectedWallWaterHeaterId === heater.id ? ' selected' : ''}`}
                  onClick={() => selectWallWaterHeater(heater.id)}
                >
                  <div className="opening-item-header">
                    <span className="opening-type-label">
                      Water Heater — {inchesToDisplay(dims.w)} × {inchesToDisplay(dims.h)}
                    </span>
                    <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteWallWaterHeater(heater.id) }}
                      aria-label="Delete water heater">
                      <IconDelete size={10} />
                    </button>
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <div className="dim-grid">
                      <MeasureInput label="Left Offset" inches={heater.alongStart}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, len - dims.w))
                          updateWallWaterHeater(heater.id, { alongStart: clamped })
                        }}
                        min={0} max={len} compact />
                      <MeasureInput label="Bottom" inches={heater.yBottom}
                        onChange={v => {
                          const clamped = Math.max(0, Math.min(v, wall.height - dims.h))
                          updateWallWaterHeater(heater.id, { yBottom: clamped })
                        }}
                        min={0} max={wall.height} compact />
                    </div>
                  </div>
                </div>
              )
            })}
            {wallFridgesList.map(fridge => {
              const dims = WALL_FRIDGE_DIMS
              return (
                <div key={fridge.id}
                  className={`opening-item${selectedFridgeId === fridge.id ? ' selected' : ''}`}
                  onClick={() => selectFridge(fridge.id)}
                >
                  <div className="opening-item-header">
                    <span className="opening-type-label">
                      Generic Fridge — {inchesToDisplay(dims.w)} × {inchesToDisplay(dims.h)}
                    </span>
                    <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteFridge(fridge.id) }}
                      aria-label="Delete fridge">
                      <IconDelete size={10} />
                    </button>
                  </div>
                </div>
              )
            })}
          </Section>

        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${wall.label}?`}
          message="This wall and all its openings, slatwall panels, and accessories will be removed. This cannot be undone."
          onConfirm={handleDeleteConfirm}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function SelectedPanelColorPicker() {
  const { slatwallPanels, selectedSlatwallPanelId, updateSlatwallPanel, walls } = useGarageStore()
  const panel = slatwallPanels.find(p => p.id === selectedSlatwallPanelId)
  if (!panel) return null
  const wall = walls.find(w => w.id === panel.wallId)
  return (
    <div className="selected-panel-picker">
      <span className="opening-section-label">Slatwall Color — {wall?.label ?? 'Panel'}</span>
      <div className="slat-color-row" role="radiogroup" aria-label="Slatwall color">
        {slatwallColors.map(c => (
          <button
            key={c.id}
            role="radio"
            aria-checked={panel.color === c.id}
            className={`slat-color-swatch${panel.color === c.id ? ' active' : ''}`}
            style={{ ['--swatch' as string]: c.hex }}
            aria-label={c.name}
            onClick={() => updateSlatwallPanel(panel.id, { color: c.id })}
          >{c.name}</button>
        ))}
      </div>
    </div>
  )
}

// Inline list + per-piece editor for baseboards and stem walls. Lives inside
// the Wall details panel; selecting a row reveals fields for that piece.
function BaseboardStemWallList() {
  const { baseboards, stemWalls, selectedBaseboardId, selectedStemWallId,
    selectBaseboard, selectStemWall, updateBaseboard, updateStemWall,
    deleteBaseboard, deleteStemWall, flooringColor } = useGarageStore()
  const items = [
    ...baseboards.map(b => ({ ...b, kind: 'bb' as const })),
    ...stemWalls.map(s => ({ ...s, kind: 'sw' as const })),
  ]
  if (items.length === 0) {
    return (
      <p style={{ fontSize: 11, color: '#888', margin: '6px 0 0' }}>
        No pieces yet. Click + above to add one.
      </p>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
      {items.map(item => {
        const isSel = item.kind === 'bb'
          ? selectedBaseboardId === item.id
          : selectedStemWallId === item.id
        const onClick = () => {
          if (item.kind === 'bb') selectBaseboard(isSel ? null : item.id)
          else selectStemWall(isSel ? null : item.id)
        }
        const onDelete = () => {
          if (item.kind === 'bb') deleteBaseboard(item.id)
          else deleteStemWall(item.id)
        }
        const update = (changes: Partial<typeof item>) => {
          if (item.kind === 'bb') updateBaseboard(item.id, changes)
          else updateStemWall(item.id, changes)
        }
        const labelPrefix = item.kind === 'sw' ? 'Stem' : 'BB'
        return (
          <BBSWRow key={item.kind + item.id}
            isSel={isSel} onClick={onClick}>
            <div className="cab-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4 }}>
              <span className="cab-label" style={{ fontSize: 11, flex: 1, minWidth: 0 }}>
                <span style={{ color: item.kind === 'sw' ? '#88aacc' : '#88cc88', fontWeight: 600 }}>{labelPrefix}</span>
                {' '}{item.label}
              </span>
              <button
                className={`step-lock-btn${item.locked ? ' locked' : ''}`}
                aria-label={item.locked ? 'Unlock position' : 'Lock position'}
                onClick={e => { e.stopPropagation(); update({ locked: !item.locked }) }}
              >{item.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}</button>
              <button className="cab-del-btn" onClick={e => { e.stopPropagation(); onDelete() }}
                style={{ fontSize: 12, padding: '0 6px' }}>×</button>
            </div>
            {isSel && (
              <div onClick={e => e.stopPropagation()} style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 10, color: '#aaa' }}>Length (in)
                  <input type="number" min={1} step={0.25} value={item.length}
                    disabled={item.locked}
                    onChange={e => update({ length: Math.max(1, parseFloat(e.target.value) || 0) })}
                    style={{ width: '100%', marginTop: 2, fontSize: 11, padding: '2px 6px',
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 3, color: '#eee', opacity: item.locked ? 0.5 : 1 }} />
                </label>
                <label style={{ fontSize: 10, color: '#aaa' }}>Height (in)
                  <input type="number" min={0.5} step={0.25} value={item.height}
                    disabled={item.locked}
                    onChange={e => update({ height: Math.max(0.5, parseFloat(e.target.value) || 0) })}
                    style={{ width: '100%', marginTop: 2, fontSize: 11, padding: '2px 6px',
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 3, color: '#eee', opacity: item.locked ? 0.5 : 1 }} />
                </label>
                <label style={{ fontSize: 10, color: '#aaa' }}>Thickness (in)
                  <input type="number" min={0.25} step={0.125} value={item.thickness}
                    disabled={item.locked}
                    onChange={e => update({ thickness: Math.max(0.25, parseFloat(e.target.value) || 0) })}
                    style={{ width: '100%', marginTop: 2, fontSize: 11, padding: '2px 6px',
                      background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                      borderRadius: 3, color: '#eee', opacity: item.locked ? 0.5 : 1 }} />
                </label>
                <div>
                  <span className="coord-label">Color</span>
                  <div className="slat-color-row" role="radiogroup" aria-label="Piece color">
                    {WALL_COLORS.map(c => (
                      <button
                        key={c.hex}
                        role="radio"
                        aria-checked={item.color === c.hex}
                        className={`slat-color-swatch${item.color === c.hex ? ' active' : ''}`}
                        style={{ background: c.hex }}
                        aria-label={c.name}
                        title={c.name}
                        onClick={() => update({ color: c.hex })}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className={`stem-wall-tex-btn${item.flake ? ' active' : ''}`}
                  onClick={() => {
                    const on = !item.flake
                    update({
                      flake: on,
                      ...(on && !item.flakeTextureId ? { flakeTextureId: flooringColor } : {}),
                    })
                  }}
                >
                  Floor texture: {item.flake ? 'On' : 'Off'}
                </button>
                {item.flake && (
                  <div style={{ marginTop: 6 }}>
                    <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>Flake texture</div>
                    <FlakeTexturePicker
                      selectedId={item.flakeTextureId}
                      onChange={id => update({ flakeTextureId: id })}
                    />
                  </div>
                )}
              </div>
            )}
          </BBSWRow>
        )
      })}
    </div>
  )
}

// Texture picker for baseboard / stem wall flake — mirrors the swatch grid
// layout used in the Flooring sidebar tab. "Match floor" is the default
// (no override stored) and renders the current floor texture on the piece.
function FlakeTexturePicker({ selectedId, onChange }: {
  selectedId: string | undefined; onChange: (id: string | undefined) => void
}) {
  const classic  = flooringColors.filter(c => c.series === 'classic')
  const stone    = flooringColors.filter(c => c.series === 'stone')
  const concrete = flooringColors.filter(c => c.series === 'concrete')
  const Group = ({ title, items }: { title: string; items: typeof flooringColors }) => (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 9, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{title}</div>
      <div className="color-grid" role="radiogroup" aria-label={title}>
        {items.map(c => {
          const isActive = selectedId === c.id
          return (
            <button key={c.id} type="button"
              role="radio"
              aria-checked={isActive}
              className={`color-swatch ${isActive ? 'selected' : ''}`}
              onClick={() => onChange(c.id)}
              aria-label={c.name}
              style={{ position: 'relative' }}>
              <div className="swatch-img" style={{ backgroundImage: `url(${import.meta.env.BASE_URL}${flooringTexturePath(c)})` }} />
              <span className="swatch-name">{c.name}</span>
              {isActive && (
                <span aria-hidden style={{
                  position: 'absolute', top: 4, right: 4,
                  width: 16, height: 16, borderRadius: '50%',
                  background: 'var(--accent)', color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
                }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
  return (
    <>
      <button type="button"
        onClick={() => onChange(undefined)}
        style={{
          fontSize: 11, padding: '4px 8px', cursor: 'pointer',
          background: !selectedId ? 'rgba(100,160,255,0.18)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${!selectedId ? 'rgba(100,160,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
          borderRadius: 4, color: !selectedId ? '#9ec6ff' : '#ccc', width: '100%',
        }}
      >
        Match floor
      </button>
      <Group title="Classic FLOORTEX®" items={classic} />
      <Group title="Stone Series" items={stone} />
      <Group title="Concrete" items={concrete} />
    </>
  )
}

// Single row with auto-scroll into view when selected.
function BBSWRow({ isSel, onClick, children }: {
  isSel: boolean; onClick: () => void; children: ReactNode
}) {
  const ref = useScrollToSelected<HTMLDivElement>(isSel)
  return (
    <div ref={ref}
      className={`cab-item${isSel ? ' selected' : ''}`}
      onClick={onClick}
      style={{ padding: '4px 8px' }}>
      {children}
    </div>
  )
}

export default function WallPanel() {
  const { walls, addWall, selectedSlatwallPanelId, selectedWallId, ceilingHeight, setCeilingHeight, activeTab, viewMode, elevationWallIndex } = useGarageStore()
  // Track which wall's detail section is expanded in the side panel. Starts
  // in sync with the scene's selection, then persists even when the scene
  // deselects (so clicking off a wall doesn't collapse the info dropdown).
  const [expandedWallId, setExpandedWallId] = useState<string | null>(selectedWallId)
  useEffect(() => {
    if (selectedWallId) setExpandedWallId(selectedWallId)
  }, [selectedWallId])
  // When the Walls tab is opened, expand the wall the user is currently
  // editing — in wall-elevation mode that's the elevation wall, otherwise
  // it's the scene-selected wall.
  useEffect(() => {
    if (activeTab !== 'walls') return
    const elevId = walls[elevationWallIndex]?.id
    const target = viewMode === 'elevation' && elevId
      ? elevId
      : (selectedWallId ?? null)
    if (target) setExpandedWallId(target)
  }, [activeTab, viewMode, elevationWallIndex, selectedWallId, walls])
  return (
    <div className="wall-panel">
      <TracingImageControls />
      <div className="ceiling-height-row">
        <MeasureInput label="Ceiling Height" inches={ceilingHeight} onChange={v => setCeilingHeight(Math.max(60, v))} min={60} max={360} />
      </div>
      <div className="panel-top">
        <span className="section-label">Walls ({walls.length})</span>
        <button className="add-btn" onClick={() => addWall()}>+ Add Wall</button>
      </div>
      {walls.length === 0 && (
        <p className="empty-msg">No walls yet. Click "Add Wall" or set up dimensions.</p>
      )}
      <div className="wall-list">
        {walls.map(w => (
          <WallEditor key={w.id} wall={w}
            expandedWallId={expandedWallId}
            setExpandedWallId={setExpandedWallId} />
        ))}
      </div>

      {/* Always-visible baseboards & stem walls section, so selecting a piece
         in 3D shows its editor here even if no wall is selected. */}
      <div className="panel-top" style={{ marginTop: 16 }}>
        <span className="section-label">Baseboards & Stem Walls</span>
      </div>
      <BaseboardStemWallList />
    </div>
  )
}
