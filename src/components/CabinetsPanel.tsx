import { useState } from 'react'
import { useGarageStore } from '../store/garageStore'
import { CABINET_PRESETS } from '../store/garageStore'
import type { PlacedCabinet, Countertop, CabinetPreset } from '../store/garageStore'
import { inchesToDisplay, cameraFloorPos } from '../utils/measurements'
import MeasureInput from './MeasureInput'
import { IconDelete, IconRotate, IconLocked, IconUnlocked } from './Icons'
import ConfirmDialog from './ConfirmDialog'
import { showToast } from './Toast'
import './CabinetsPanel.css'

/** SVG front-elevation thumbnail for a cabinet preset */
function CabinetSVG({ preset }: { preset: CabinetPreset }) {
  const { style, doors, w, h } = preset
  const drawers = preset.drawers ?? 0
  const SVG_W = 56
  const SVG_H = Math.round(SVG_W * h / 36)

  const hasToeKick = style === 'lower' || style === 'locker'
  const toeKickH   = hasToeKick ? Math.max(6, Math.round(SVG_H * 0.10)) : 0
  const bodyH      = SVG_H - toeKickH

  const drawerRowH  = drawers > 0 ? Math.round((6 / h) * bodyH) : 0
  const drawerAreaH = drawerRowH * drawers

  const drawerAreaY = 2
  const doorAreaY   = 2 + drawerAreaH
  const doorAreaH2  = bodyH - 4 - drawerAreaH
  const doorW       = doors > 0 ? (SVG_W - 4) / doors : 0

  const doorHandleY = style === 'upper' ? doorAreaY + doorAreaH2 - 9 : doorAreaY + 4

  return (
    <svg width={SVG_W} height={SVG_H} viewBox={`0 0 ${SVG_W} ${SVG_H}`}
         style={{ display: 'block', flexShrink: 0 }} aria-hidden="true">
      <rect x={1} y={1} width={SVG_W - 2} height={bodyH - 1} rx={2}
            fill="#3a3a3a" stroke="#5a5a5a" strokeWidth={1} />
      {hasToeKick && (
        <rect x={5} y={bodyH} width={SVG_W - 10} height={toeKickH}
              fill="#252525" rx={1} />
      )}
      {doors > 0 && doorAreaH2 > 0 && Array.from({ length: doors }).map((_, i) => (
        <rect key={`d${i}`}
              x={2 + i * doorW + 1} y={doorAreaY}
              width={doorW - 2} height={doorAreaH2}
              rx={1} fill="#464646" stroke="#5c5c5c" strokeWidth={0.75} />
      ))}
      {doors > 0 && Array.from({ length: doors }).map((_, i) => {
        const cx = 2 + i * doorW + doorW / 2
        return (
          <rect key={`dh${i}`}
                x={cx - 1} y={doorHandleY}
                width={2} height={7}
                rx={1} fill="#888" />
        )
      })}
      {drawers > 0 && Array.from({ length: drawers }).map((_, i) => {
        const drawerY = drawerAreaY + i * drawerRowH
        const dH = drawerRowH - 1
        const cx = SVG_W / 2
        return (
          <g key={`dr${i}`}>
            <rect x={3} y={drawerY} width={SVG_W - 6} height={dH}
                  rx={1} fill="#464646" stroke="#5c5c5c" strokeWidth={0.75} />
            <rect x={cx - 6} y={drawerY + dH / 2 - 1} width={12} height={2}
                  rx={1} fill="#888" />
          </g>
        )
      })}
    </svg>
  )
}

const CABINET_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'charcoal',  name: 'Charcoal',  hex: '#3d3d3d' },
  { id: 'white',     name: 'White',     hex: '#f2f2f0' },
  { id: 'driftwood', name: 'Driftwood', hex: '#7a6a58' },
  { id: 'slate',     name: 'Slate',     hex: '#5a6872' },
  { id: 'stone',     name: 'Stone',     hex: '#7a7972' },
]

const CT_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'butcher-block',   name: 'Butcher Block',   hex: '#c4a070' },
  { id: 'stainless-steel', name: 'Stainless Steel', hex: '#b0b4b8' },
]

const STYLE_GROUPS: { label: string; style: string }[] = [
  { label: 'Lower Cabinets', style: 'lower' },
  { label: 'Lockers',        style: 'locker' },
  { label: 'Upper Cabinets', style: 'upper' },
]

function CabinetEditor({ cab }: { cab: PlacedCabinet }) {
  const { selectedCabinetId, selectCabinet, updateCabinet, deleteCabinet } = useGarageStore()
  const selected = selectedCabinetId === cab.id
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleDelete = () => {
    deleteCabinet(cab.id)
    showToast(`Deleted ${cab.label}`, 'info')
    setConfirmDelete(false)
  }

  return (
    <div
      className={`cab-item${selected ? ' selected' : ''}`}
      onClick={() => selectCabinet(cab.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCabinet(cab.id) }}}
      aria-selected={selected}
    >
      <div className="cab-header">
        <span className="cab-label">
          {cab.label}
          {cab.price != null && <span className="cab-price"> ${cab.price}</span>}
        </span>
        <div className="cab-actions">
          <button
            className={`cab-lock-btn${cab.locked ? ' locked' : ''}`}
            aria-label={cab.locked ? 'Unlock position' : 'Lock position'}
            onClick={e => { e.stopPropagation(); updateCabinet(cab.id, { locked: !cab.locked }) }}
          >{cab.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}</button>
          <button
            className="cab-rot-btn"
            aria-label="Rotate 90 degrees"
            onClick={e => { e.stopPropagation(); updateCabinet(cab.id, { rotY: cab.rotY + Math.PI / 2 }) }}
          ><IconRotate size={12} /></button>
          <button
            className="cab-del-btn"
            aria-label={`Delete ${cab.label}`}
            onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
          ><IconDelete size={12} /></button>
        </div>
      </div>

      {selected && (
        <div className="cab-detail" onClick={e => e.stopPropagation()}>
          <span className="cab-dims">
            {inchesToDisplay(cab.w)} W × {inchesToDisplay(cab.d)} D × {inchesToDisplay(cab.h)} H
            {cab.sku && <span className="cab-sku"> · {cab.sku}</span>}
          </span>
          <MeasureInput
            label="Height off floor"
            inches={cab.y}
            onChange={v => updateCabinet(cab.id, { y: v })}
            min={0}
            max={120}
          />
          <div className="cab-color-row" role="radiogroup" aria-label="Cabinet color" style={{ marginTop: 8 }}>
            {CABINET_COLORS.map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={cab.color === c.id}
                className={`cab-color-swatch${cab.color === c.id ? ' active' : ''}`}
                style={{ background: c.hex }}
                aria-label={c.name}
                onClick={() => updateCabinet(cab.id, { color: c.id })}
              />
            ))}
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${cab.label}?`}
          message="This cabinet will be removed from the scene. This action cannot be undone."
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

function CountertopEditor({ ct }: { ct: Countertop }) {
  const { selectedCountertopId, selectCountertop, updateCountertop, deleteCountertop } = useGarageStore()
  const selected = selectedCountertopId === ct.id
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      className={`cab-item${selected ? ' selected' : ''}`}
      onClick={() => selectCountertop(ct.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectCountertop(ct.id) }}}
      aria-selected={selected}
    >
      <div className="cab-header">
        <span className="cab-label">{ct.label}</span>
        <div className="cab-actions">
          <button
            className={`cab-lock-btn${ct.locked ? ' locked' : ''}`}
            aria-label={ct.locked ? 'Unlock position' : 'Lock position'}
            onClick={e => { e.stopPropagation(); updateCountertop(ct.id, { locked: !ct.locked }) }}
          >{ct.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}</button>
          <button
            className="cab-del-btn"
            aria-label={`Delete ${ct.label}`}
            onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
          ><IconDelete size={12} /></button>
        </div>
      </div>

      {selected && (
        <div className="cab-detail" onClick={e => e.stopPropagation()}>
          <MeasureInput
            label="Width"
            inches={ct.width}
            onChange={v => updateCountertop(ct.id, { width: Math.max(6, v) })}
            min={6}
            max={480}
          />
          <div className="cab-color-row" role="radiogroup" aria-label="Countertop material" style={{ marginTop: 8 }}>
            {CT_COLORS.map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={ct.color === c.id}
                className={`cab-color-swatch${ct.color === c.id ? ' active' : ''}`}
                style={{ background: c.hex }}
                aria-label={c.name}
                onClick={() => updateCountertop(ct.id, { color: c.id })}
              />
            ))}
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${ct.label}?`}
          message="This countertop will be removed from the scene."
          onConfirm={() => { deleteCountertop(ct.id); setConfirmDelete(false) }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

export default function CabinetsPanel() {
  const { cabinets, addCabinet, updateCabinet, countertops, addCountertop, getQuote, viewMode, walls, elevationWallIndex } = useGarageStore()
  const quote = cabinets.length > 0 ? getQuote() : null

  const isWallEdit = viewMode === 'elevation'
  const wall = isWallEdit ? walls[elevationWallIndex] : null

  const handleAddCabinet = (preset: CabinetPreset) => {
    if (wall) {
      // Wall edit mode: place cabinet centered on the current wall, facing interior
      const wLen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
      const dx = wLen > 0.01 ? (wall.x2 - wall.x1) / wLen : 1
      const dz = wLen > 0.01 ? (wall.z2 - wall.z1) / wLen : 0
      const along = wLen / 2
      const offset = wall.thickness / 2 + preset.d / 2
      // Interior normal
      const faceNx = -dz, faceNz = dx
      const spawnX = wall.x1 + dx * along + faceNx * offset
      const spawnZ = wall.z1 + dz * along + faceNz * offset
      const rotY = Math.atan2(faceNx, faceNz)
      addCabinet(preset, spawnX, spawnZ, rotY)
    } else {
      addCabinet(preset, 0, 0)
    }
  }

  return (
    <div className="cabinets-panel">
      {STYLE_GROUPS.map(group => {
        const presets = CABINET_PRESETS.filter(p => p.style === group.style)
        return (
          <div key={group.style} className="cab-group">
            <span className="cab-group-label">{group.label}</span>
            <div className="cab-preset-grid">
              {presets.map(preset => (
                <button
                  key={preset.key}
                  className="cab-preset-btn"
                  onClick={() => handleAddCabinet(preset)}
                  aria-label={`Add ${preset.label}${preset.price ? ` — $${preset.price}` : ''}`}
                  title={`${preset.label}\n${inchesToDisplay(preset.w)}W × ${inchesToDisplay(preset.d)}D × ${inchesToDisplay(preset.h)}H`}
                >
                  <CabinetSVG preset={preset} />
                  <span className="cab-preset-name">{preset.label}</span>
                  {preset.price != null && <span className="cab-preset-price">${preset.price}</span>}
                </button>
              ))}
            </div>
          </div>
        )
      })}

      {/* Placed cabinets list */}
      {cabinets.length > 0 && (
        <div className="cab-list-section">
          <span className="cab-group-label">Placed Cabinets ({cabinets.length})</span>
          <div className="cab-list">
            {cabinets.map(c => <CabinetEditor key={c.id} cab={c} />)}
          </div>
        </div>
      )}

      {/* Countertops */}
      <div className="cab-list-section">
        <div className="cab-group-header">
          <span className="cab-group-label">Countertops{countertops.length > 0 ? ` (${countertops.length})` : ''}</span>
          <button className="cab-add-ct-btn" onClick={() => addCountertop()}>+ Add</button>
        </div>
        {countertops.map(ct => <CountertopEditor key={ct.id} ct={ct} />)}
      </div>

      {/* Quote summary */}
      {quote && quote.subtotal > 0 && (
        <div className="cab-quote-summary">
          <span className="cab-group-label">Estimate</span>
          <div className="cab-quote-lines">
            <div className="cab-quote-line"><span>Cabinets</span><span>${quote.subtotal.toLocaleString()}</span></div>
            <div className="cab-quote-line"><span>Install (~35%)</span><span>${quote.labor.toLocaleString()}</span></div>
            <div className="cab-quote-line cab-quote-total"><span>Total</span><span>${quote.total.toLocaleString()}</span></div>
          </div>
        </div>
      )}

      {cabinets.length === 0 && countertops.length === 0 && (
        <p className="cab-empty">Click a cabinet above to place it in the scene.</p>
      )}
    </div>
  )
}
