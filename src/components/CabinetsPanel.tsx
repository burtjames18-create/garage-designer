import { useState } from 'react'
import { useGarageStore } from '../store/garageStore'
import { useScrollToSelected } from '../hooks/useScrollToSelected'
import { CABINET_PRESETS } from '../store/garageStore'
import type { PlacedCabinet, Countertop, CabinetPreset, CabinetLine } from '../store/garageStore'
import { inchesToDisplay, cameraFloorPos } from '../utils/measurements'
import MeasureInput from './MeasureInput'
import { IconDelete, IconRotate, IconLocked, IconUnlocked } from './Icons'
import ConfirmDialog from './ConfirmDialog'
import { showToast } from './Toast'
import CabinetFrontSVG from './CabinetFrontSVG'
import './CabinetsPanel.css'

const TECHNICA_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'titanium',      name: 'Titanium',      hex: '#5a5650' },
  { id: 'ash-grey',      name: 'Ash Grey',      hex: '#d4cfc0' },
  { id: 'harbor-blue',   name: 'Harbor Blue',   hex: '#283448' },
  { id: 'evergreen',     name: 'Evergreen',     hex: '#4d5e4c' },
  { id: 'sandstone',     name: 'Sandstone',     hex: '#b09475' },
  { id: 'mica',          name: 'Mica',          hex: '#6e6e6e' },
  { id: 'graphite',      name: 'Graphite',      hex: '#3a3a3c' },
  { id: 'obsidian',      name: 'Obsidian',      hex: '#1a1a1a' },
  { id: 'silver',        name: 'Silver',        hex: '#b8bcc0' },
  { id: 'metallic-grey', name: 'Metallic Grey', hex: '#989a9a' },
  { id: 'argento-blu',   name: 'Argento Blu',   hex: '#9aa8b0' },
  { id: 'ruby',          name: 'Ruby',          hex: '#b02020' },
]

const HANDLE_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'brushed', name: 'Brushed Steel', hex: '#c0c4c8' },
  { id: 'black',   name: 'Black',         hex: '#1a1a1c' },
]

const SIG_SHELL_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'black',   name: 'Black',   hex: '#1a1a1c' },
  { id: 'granite', name: 'Granite', hex: '#48484a' },
]

const SIG_DOOR_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'black',         name: 'Black',         hex: '#1a1a1c' },
  { id: 'granite',       name: 'Granite',       hex: '#48484a' },
  { id: 'harbor-blue',   name: 'Harbor Blue',   hex: '#3a4e5c' },
  { id: 'latte',         name: 'Latte',         hex: '#b0a08a' },
  { id: 'midnight-blue', name: 'Midnight Blue', hex: '#1e2d4d' },
  { id: 'red',           name: 'Red',           hex: '#b82020' },
  { id: 'silver',        name: 'Silver',        hex: '#b0b4b8' },
]

const CT_COLORS: { id: string; name: string; hex: string }[] = [
  { id: 'butcher-block',   name: 'Butcher Block',   hex: '#c4a070' },
  { id: 'stainless-steel', name: 'Stainless Steel', hex: '#b0b4b8' },
  { id: 'black-stainless', name: 'Black Stainless', hex: '#484b50' },
]

const STYLE_GROUPS: { label: string; style: string }[] = [
  { label: 'Lockers',        style: 'locker' },
  { label: 'Lower Cabinets', style: 'lower' },
  { label: 'Upper Cabinets', style: 'upper' },
]

function CabinetEditor({ cab }: { cab: PlacedCabinet }) {
  const { selectedCabinetId, selectCabinet, updateCabinet, deleteCabinet, ceilingLights, addCeilingLight, deleteCeilingLight } = useGarageStore()
  const selected = selectedCabinetId === cab.id
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scrollRef = useScrollToSelected<HTMLDivElement>(selected)

  const handleDelete = () => {
    deleteCabinet(cab.id)
    showToast(`Deleted ${cab.label}`, 'info')
    setConfirmDelete(false)
  }

  return (
    <div
      ref={scrollRef}
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
          {cab.line === 'signature' && (
            <>
              <span className="cab-color-label">Shell</span>
              <div className="cab-color-row" role="radiogroup" aria-label="Shell color" style={{ marginTop: 4 }}>
                {SIG_SHELL_COLORS.map(c => (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={(cab.shellColor ?? 'granite') === c.id}
                    className={`cab-color-swatch${(cab.shellColor ?? 'granite') === c.id ? ' active' : ''}`}
                    style={{ background: c.hex }}
                    aria-label={c.name}
                    title={c.name}
                    onClick={() => updateCabinet(cab.id, { shellColor: c.id })}
                  />
                ))}
              </div>
            </>
          )}
          <span className="cab-color-label">{cab.line === 'signature' ? 'Door' : 'Color'}</span>
          <div className="cab-color-row" role="radiogroup" aria-label="Cabinet color" style={{ marginTop: 4 }}>
            {(cab.line === 'signature' ? SIG_DOOR_COLORS : TECHNICA_COLORS).map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={cab.color === c.id}
                className={`cab-color-swatch${cab.color === c.id ? ' active' : ''}`}
                style={{ background: c.hex }}
                aria-label={c.name}
                title={c.name}
                onClick={() => updateCabinet(cab.id, { color: c.id })}
              />
            ))}
          </div>
          <span className="cab-color-label">Handle</span>
          <div className="cab-color-row" role="radiogroup" aria-label="Handle color" style={{ marginTop: 4 }}>
            {HANDLE_COLORS.map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={(cab.handleColor ?? 'brushed') === c.id}
                className={`cab-color-swatch${(cab.handleColor ?? 'brushed') === c.id ? ' active' : ''}`}
                style={{ background: c.hex }}
                aria-label={c.name}
                title={c.name}
                onClick={() => updateCabinet(cab.id, { handleColor: c.id })}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {cab.doors === 1 && (
              <button
                className="cab-handle-toggle"
                onClick={() => updateCabinet(cab.id, { handleSide: (cab.handleSide ?? 'right') === 'right' ? 'left' : 'right' })}
                style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 4, color: '#ccc' }}
              >
                Handle: {(cab.handleSide ?? 'right') === 'right' ? 'Right' : 'Left'}
              </button>
            )}
            {cab.doors > 0 && (() => {
              const s = cab.doorOpenState ?? 0
              const next = ((s + 1) % 3) as 0 | 1 | 2
              const label = s === 0 ? 'Closed' : s === 1 ? '45°' : '90°'
              return (
                <button
                  onClick={() => updateCabinet(cab.id, { doorOpenState: next })}
                  style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                    background: s > 0 ? 'rgba(100,160,255,0.15)' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${s > 0 ? 'rgba(100,160,255,0.35)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: 4, color: s > 0 ? '#8cb4ff' : '#ccc' }}
                >
                  Doors: {label}
                </button>
              )
            })()}
            {cab.style === 'upper' && (() => {
              const on = !!cab.underLight
              return (
                <button
                  onClick={() => updateCabinet(cab.id, {
                    underLight: !on,
                    // Start at max cone angle (75°) when the light is first enabled
                    ...(on ? {} : { underLightAngle: (75 * Math.PI) / 180 }),
                  })}
                  style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                    background: on ? 'rgba(255,200,100,0.18)' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${on ? 'rgba(255,200,100,0.4)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: 4, color: on ? '#ffd28a' : '#ccc' }}
                >
                  Puck light: {on ? 'On' : 'Off'}
                </button>
              )
            })()}
            {cab.style === 'upper' && (() => {
              // A ledbar is "under this cabinet" if its position matches the
              // cabinet center within ~6" and y roughly equals the cabinet bottom.
              const cabXFt = cab.x / 12, cabZFt = cab.z / 12
              const bar = ceilingLights.find(l =>
                l.kind === 'ledbar' &&
                Math.abs(l.x - cabXFt) < 0.5 &&
                Math.abs(l.z - cabZFt) < 0.5
              )
              const on = !!bar
              return (
                <button
                  onClick={() => {
                    if (on && bar) deleteCeilingLight(bar.id)
                    else {
                      selectCabinet(cab.id)
                      addCeilingLight('ledbar')
                    }
                  }}
                  style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer',
                    background: on ? 'rgba(100,200,255,0.18)' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${on ? 'rgba(100,200,255,0.4)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: 4, color: on ? '#8ad4ff' : '#ccc' }}
                >
                  LED bar: {on ? 'On' : 'Off'}
                </button>
              )
            })()}
          </div>
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <label style={{ fontSize: 11, color: '#aaa' }}>Price</label>
            <span style={{ fontSize: 11, color: '#aaa' }}>$</span>
            <input
              type="number"
              min={0}
              step={1}
              value={cab.price ?? ''}
              placeholder="0"
              onChange={e => {
                const v = e.target.value.trim()
                updateCabinet(cab.id, { price: v === '' ? undefined : Math.max(0, parseFloat(v) || 0) })
              }}
              onClick={e => e.stopPropagation()}
              style={{ flex: 1, fontSize: 11, padding: '2px 6px', background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)', borderRadius: 3, color: '#eee' }}
              aria-label="Cabinet price"
            />
          </div>
          {cab.style === 'upper' && cab.underLight && (() => {
            const angle = cab.underLightAngle ?? (75 * Math.PI) / 180
            const deg = Math.round((angle * 180) / Math.PI)
            return (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#aaa' }}>
                  <span>Cone angle</span>
                  <span>{deg}°</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={75}
                  step={1}
                  value={deg}
                  onChange={e => updateCabinet(cab.id, { underLightAngle: (parseInt(e.target.value, 10) * Math.PI) / 180 })}
                  style={{ width: '100%' }}
                  aria-label="Puck light cone angle"
                />
              </div>
            )
          })()}
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
  const scrollRef = useScrollToSelected<HTMLDivElement>(selected)

  return (
    <div
      ref={scrollRef}
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
  const { cabinets, addCabinet, updateCabinet, countertops, addCountertop, getQuote, viewMode, walls, elevationWallIndex, elevationSide } = useGarageStore()
  const [activeLine, setActiveLine] = useState<CabinetLine>('technica')
  const quote = cabinets.length > 0 ? getQuote() : null

  const isWallEdit = viewMode === 'elevation'
  const wall = isWallEdit ? walls[elevationWallIndex] : null

  const handleAddCabinet = (preset: CabinetPreset) => {
    if (wall) {
      const wLen = Math.hypot(wall.x2 - wall.x1, wall.z2 - wall.z1)
      const dx = wLen > 0.01 ? (wall.x2 - wall.x1) / wLen : 1
      const dz = wLen > 0.01 ? (wall.z2 - wall.z1) / wLen : 0
      const along = wLen / 2
      const offset = wall.thickness / 2 + preset.d / 2
      // Interior normal is left perpendicular; exterior is opposite
      const sideSign = elevationSide === 'exterior' ? -1 : 1
      const faceNx = -dz * sideSign, faceNz = dx * sideSign
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
      {/* Cabinet line tabs */}
      <div className="cab-line-tabs" role="tablist" aria-label="Cabinet line">
        <button
          role="tab"
          aria-selected={activeLine === 'technica'}
          className={`cab-line-tab${activeLine === 'technica' ? ' active' : ''}`}
          onClick={() => setActiveLine('technica')}
        >Technica</button>
        <button
          role="tab"
          aria-selected={activeLine === 'signature'}
          className={`cab-line-tab${activeLine === 'signature' ? ' active' : ''}`}
          onClick={() => setActiveLine('signature')}
        >Signature</button>
      </div>

      {STYLE_GROUPS.map(group => {
        const presets = CABINET_PRESETS.filter(p => p.style === group.style && p.line === activeLine)
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
                  <div className={`cab-preset-icon cab-preset-icon--${preset.style}`}>
                    <CabinetFrontSVG preset={preset} />
                  </div>
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
