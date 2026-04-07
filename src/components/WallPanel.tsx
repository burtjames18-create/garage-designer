import { useState } from 'react'
import { useGarageStore } from '../store/garageStore'
import type { GarageWall } from '../store/garageStore'
import MeasureInput from './MeasureInput'
import { wallLengthIn, inchesToDisplay } from '../utils/measurements'
import { slatwallColors } from '../data/slatwallColors'
import { wallTextures, doorTextures, texturePath } from '../data/textureCatalog'
import type { ImportedAsset } from '../store/garageStore'
import { getModelsForType } from '../data/openingModels'
import type { OpeningModelType } from '../data/openingModels'
import { SLATWALL_ACCESSORIES } from '../data/slatwallAccessories'
import { IconDelete, IconDuplicate } from './Icons'
import ConfirmDialog from './ConfirmDialog'
import { showToast } from './Toast'
import './WallPanel.css'



const WALL_COLORS = [
  { name: 'Default White',  hex: '#e0dedd' },
  { name: 'Bright White',   hex: '#f5f5f5' },
  { name: 'Warm White',     hex: '#f0ede8' },
  { name: 'Light Grey',     hex: '#d4d4d4' },
  { name: 'Medium Grey',    hex: '#aaaaaa' },
  { name: 'Beige',          hex: '#e8dcc8' },
  { name: 'Tan',            hex: '#d4b896' },
  { name: 'Light Blue',     hex: '#ccd8e8' },
  { name: 'Sage Green',     hex: '#c4d4c0' },
  { name: 'Charcoal',       hex: '#606060' },
]

const BASEBOARD_COLORS = [
  { name: 'White',          hex: '#f5f5f5' },
  { name: 'Light Grey',     hex: '#cccccc' },
  { name: 'Medium Grey',    hex: '#999999' },
  { name: 'Charcoal',       hex: '#555555' },
  { name: 'Black',          hex: '#2a2a2a' },
  { name: 'Cream',          hex: '#e8dcc8' },
  { name: 'Tan',            hex: '#c8aa88' },
  { name: 'Warm Brown',     hex: '#8a6040' },
  { name: 'Concrete',       hex: '#a8a098' },
  { name: 'Slate Blue',     hex: '#6a7a8a' },
]

const OPENING_LABELS: Record<string, string> = {
  'garage-door': 'Garage Door',
  'door': 'Door',
  'window': 'Window',
}

function WallEditor({ wall }: { wall: GarageWall }) {
  const {
    updateWall, deleteWall, selectWall, duplicateWall, selectedWallId,
    addOpening, updateOpening, removeOpening,
    slatwallPanels, addSlatwallPanel, updateSlatwallPanel, deleteSlatwallPanel, selectSlatwallPanel, selectedSlatwallPanelId,
    slatwallAccessories, addSlatwallAccessory, deleteSlatwallAccessory,
    importedAssets,
  } = useGarageStore()
  const importedWallTextures = importedAssets.filter((a: ImportedAsset) => a.assetType === 'wall-texture')
  const wallPanels = slatwallPanels.filter(p => p.wallId === wall.id)
  const selected = selectedWallId === wall.id
  const len = wallLengthIn(wall.x1, wall.z1, wall.x2, wall.z2)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleLengthChange = (newLen: number) => {
    if (newLen <= 0) return
    const dx = wall.x2 - wall.x1
    const dz = wall.z2 - wall.z1
    const curLen = Math.hypot(dx, dz)
    if (curLen === 0) return
    const ux = dx / curLen, uz = dz / curLen
    updateWall(wall.id, { x2: wall.x1 + ux * newLen, z2: wall.z1 + uz * newLen })
  }

  const handleDeleteConfirm = () => {
    deleteWall(wall.id)
    showToast(`Deleted ${wall.label}`, 'info')
    setConfirmDelete(false)
  }

  return (
    <div
      className={`wall-item ${selected ? 'selected' : ''}`}
      onClick={() => selectWall(wall.id)}
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
          <button aria-label={`Duplicate ${wall.label}`} onClick={e => { e.stopPropagation(); duplicateWall(wall.id) }}>
            <IconDuplicate size={12} />
          </button>
          <button aria-label={`Delete ${wall.label}`} className="delete-btn" onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}>
            <IconDelete size={12} />
          </button>
        </div>
      </div>

      {selected && (
        <div className="wall-detail" onClick={e => e.stopPropagation()}>

          {/* Core dimensions */}
          <div className="dim-grid">
            <MeasureInput label="Length" inches={len} onChange={handleLengthChange} min={1} max={9999} />
            <MeasureInput label="Height" inches={wall.height} onChange={v => updateWall(wall.id, { height: v })} min={12} max={360} />
            <MeasureInput label="Thickness" inches={wall.thickness} onChange={v => updateWall(wall.id, { thickness: v })} min={1} max={24} />
          </div>

          {/* Wall color */}
          <div style={{ marginBottom: 8 }}>
            <span className="coord-label">Wall Color</span>
            <div className="slat-color-row" role="radiogroup" aria-label="Wall color">
              {WALL_COLORS.map(c => (
                <button
                  key={c.hex}
                  role="radio"
                  aria-checked={!wall.wallTextureId && (wall.wallColor ?? '#e0dedd') === c.hex}
                  className={`slat-color-swatch${!wall.wallTextureId && (wall.wallColor ?? '#e0dedd') === c.hex ? ' active' : ''}`}
                  style={{ background: c.hex }}
                  aria-label={c.name}
                  onClick={() => updateWall(wall.id, { wallColor: c.hex, wallTextureId: undefined })}
                />
              ))}
            </div>
          </div>

          {/* Wall texture */}
          <div style={{ marginBottom: 8 }}>
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

          {/* Toggles */}
          <div className="wall-toggles">
            <label className="toggle-row">
              <span>Baseboard / Stem Wall</span>
              <input type="checkbox" checked={wall.baseboard} onChange={e => updateWall(wall.id, { baseboard: e.target.checked })} />
            </label>
            {wall.baseboard && (<>
              <MeasureInput label="Baseboard Height" inches={wall.baseboardHeight}
                onChange={v => updateWall(wall.id, { baseboardHeight: v })} min={1} max={48} />
              <div style={{ marginTop: 6 }}>
                <span className="coord-label">Baseboard Color</span>
                <div className="slat-color-row" role="radiogroup" aria-label="Baseboard color">
                  {BASEBOARD_COLORS.map(c => (
                    <button
                      key={c.hex}
                      role="radio"
                      aria-checked={wall.baseboardColor === c.hex}
                      className={`slat-color-swatch${wall.baseboardColor === c.hex ? ' active' : ''}`}
                      style={{ background: c.hex }}
                      aria-label={c.name}
                      onClick={() => updateWall(wall.id, { baseboardColor: c.hex })}
                    />
                  ))}
                </div>
              </div>
              <label className="toggle-row" style={{ marginTop: 6 }}>
                <span>Flake Texture on Baseboard</span>
                <input type="checkbox" checked={wall.baseboardTexture ?? false}
                  onChange={e => updateWall(wall.id, { baseboardTexture: e.target.checked })} />
              </label>
            </>)}
            <label className="toggle-row">
              <span>Lock position</span>
              <input type="checkbox" checked={wall.locked} onChange={e => updateWall(wall.id, { locked: e.target.checked })} />
            </label>
          </div>

          {/* Openings */}
          <div className="openings-section">
            <div className="openings-header">
              <span className="opening-section-label">Openings</span>
              <div className="opening-add-row">
                <button className="opening-add-btn" onClick={() => addOpening(wall.id, 'garage-door')}>+ Garage Door</button>
                <button className="opening-add-btn" onClick={() => addOpening(wall.id, 'door')}>+ Door</button>
                <button className="opening-add-btn" onClick={() => addOpening(wall.id, 'window')}>+ Window</button>
              </div>
            </div>

            {wall.openings.map(op => {
              const rightWall = Math.max(0, len - op.xOffset - op.width)
              const handleRightWall = (v: number) => handleLengthChange(op.xOffset + op.width + v)
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
                      <MeasureInput label="Left Wall"  inches={op.xOffset} onChange={v => updateOpening(wall.id, op.id, { xOffset: Math.max(0, v) })} min={0} />
                      <MeasureInput label="Right Wall" inches={rightWall}  onChange={handleRightWall} min={0} />
                    </>) : (
                      <MeasureInput label="Offset" inches={op.xOffset} onChange={v => updateOpening(wall.id, op.id, { xOffset: v })} min={0} />
                    )}
                  </div>
                  {/* Door / garage-door texture picker */}
                  {(op.type === 'door' || op.type === 'garage-door') && (
                    <div style={{ marginTop: 6 }}>
                      <span className="coord-label">Texture</span>
                      <div className="slat-color-row" role="radiogroup" aria-label="Door texture" style={{ flexWrap: 'wrap', gap: 4 }}>
                        <button
                          role="radio"
                          aria-checked={!op.textureId}
                          className={`slat-color-swatch${!op.textureId ? ' active' : ''}`}
                          style={{ background: '#b8b4a8', fontSize: 8, color: '#666', lineHeight: 1 }}
                          aria-label="Default (no texture)"
                          title="Default"
                          onClick={() => updateOpening(wall.id, op.id, { textureId: undefined })}
                        >
                          —
                        </button>
                        {doorTextures.map(t => (
                          <button
                            key={t.id}
                            role="radio"
                            aria-checked={op.textureId === t.id}
                            className={`slat-color-swatch${op.textureId === t.id ? ' active' : ''}`}
                            style={{
                              backgroundImage: `url(${import.meta.env.BASE_URL}${texturePath(t.category, t.file)})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }}
                            aria-label={t.name}
                            title={t.name}
                            onClick={() => updateOpening(wall.id, op.id, { textureId: t.id })}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3D Model picker for doors and windows */}
                  {(op.type === 'door' || op.type === 'window') && (
                    <div style={{ marginTop: 6 }}>
                      <span className="coord-label">3D Style</span>
                      <div className="slat-color-row" role="radiogroup" aria-label="Opening 3D model" style={{ flexWrap: 'wrap', gap: 4 }}>
                        <button
                          role="radio"
                          aria-checked={!op.modelId}
                          className={`slat-color-swatch${!op.modelId ? ' active' : ''}`}
                          style={{
                            background: op.type === 'door' ? '#b8b4a8' : '#87CEEB',
                            fontSize: 8, color: '#444', lineHeight: 1,
                          }}
                          aria-label="Default (flat panel)"
                          title="Flat Panel"
                          onClick={() => updateOpening(wall.id, op.id, { modelId: undefined })}
                        >
                          —
                        </button>
                        {getModelsForType(op.type as OpeningModelType).map(m => (
                          <button
                            key={m.id}
                            role="radio"
                            aria-checked={op.modelId === m.id}
                            className={`slat-color-swatch${op.modelId === m.id ? ' active' : ''}`}
                            style={{ background: m.preview }}
                            aria-label={m.name}
                            title={m.name}
                            onClick={() => updateOpening(wall.id, op.id, { modelId: m.id })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Slatwall panels */}
          <div className="openings-section">
            <div className="openings-header">
              <span className="opening-section-label">Slatwall Panels</span>
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
                          style={{ background: c.hex }}
                          aria-label={c.name}
                          onClick={() => updateSlatwallPanel(panel.id, { color: c.id })}
                        />
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
          </div>

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
            style={{ background: c.hex }}
            aria-label={c.name}
            onClick={() => updateSlatwallPanel(panel.id, { color: c.id })}
          />
        ))}
      </div>
    </div>
  )
}

export default function WallPanel() {
  const { walls, addWall, selectedSlatwallPanelId, ceilingHeight, setCeilingHeight } = useGarageStore()
  return (
    <div className="wall-panel">
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
        {walls.map(w => <WallEditor key={w.id} wall={w} />)}
      </div>
    </div>
  )
}
