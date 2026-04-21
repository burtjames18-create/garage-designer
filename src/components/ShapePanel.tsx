import { useState } from 'react'
import { useGarageStore } from '../store/garageStore'
import { useScrollToSelected } from '../hooks/useScrollToSelected'
import type { GarageShape, ShapeType } from '../store/garageStore'
import type { ImportedAsset } from '../store/garageStore'
import MeasureInput from './MeasureInput'
import { IconDelete, IconLocked, IconUnlocked } from './Icons'
import ConfirmDialog from './ConfirmDialog'
import { wallTextures, texturePath } from '../data/textureCatalog'
import { flooringColors, flooringTexturePath } from '../data/flooringColors'
import './ShapePanel.css'

// Shared palette with WallPanel for consistency
const SHAPE_COLORS = [
  { name: 'Off-White',      hex: '#f0ede4' },
  { name: 'Bright White',   hex: '#f5f5f5' },
  { name: 'Cool White',     hex: '#e0dedd' },
  { name: 'Light Grey',     hex: '#d4d4d4' },
  { name: 'Medium Grey',    hex: '#aaaaaa' },
  { name: 'Charcoal',       hex: '#606060' },
  { name: 'Black',          hex: '#2a2a2a' },
  { name: 'Beige',          hex: '#e8dcc8' },
  { name: 'Tan',            hex: '#d4b896' },
  { name: 'Warm Brown',     hex: '#8a6040' },
  { name: 'Light Blue',     hex: '#ccd8e8' },
  { name: 'Sage Green',     hex: '#c4d4c0' },
  { name: 'Steel',          hex: '#8a8f96' },
  { name: 'Slate Blue',     hex: '#6a7a8a' },
]

const SHAPE_TYPES: { type: ShapeType; label: string; desc: string }[] = [
  { type: 'box',      label: 'Box / Soffit',  desc: 'Rectangular solid' },
  { type: 'cylinder', label: 'Column / Pole',  desc: 'Cylindrical shape' },
  { type: 'beam',     label: 'Beam',           desc: 'Horizontal beam' },
]

const SHAPE_ICONS: Record<ShapeType, JSX.Element> = {
  box: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="2" y="4" width="9" height="9" rx="1"/>
      <path d="M11 4L14 2V11L11 13"/>
      <path d="M2 4L5 2H14"/>
    </svg>
  ),
  cylinder: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <ellipse cx="8" cy="4" rx="5" ry="2"/>
      <line x1="3" y1="4" x2="3" y2="12"/>
      <line x1="13" y1="4" x2="13" y2="12"/>
      <path d="M3 12C3 13.1 5.24 14 8 14C10.76 14 13 13.1 13 12"/>
    </svg>
  ),
  beam: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <rect x="1" y="5" width="14" height="6" rx="1"/>
      <line x1="5" y1="5" x2="5" y2="11"/>
      <line x1="11" y1="5" x2="11" y2="11"/>
    </svg>
  ),
}

function ShapeEditor({ shape }: { shape: GarageShape }) {
  const { updateShape, deleteShape, selectShape, selectedShapeId, importedAssets } = useGarageStore()
  const selected = selectedShapeId === shape.id
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scrollRef = useScrollToSelected<HTMLDivElement>(selected)

  // All imported textures show up in both the wall and floor sections; the
  // assetType distinction is only for legacy compatibility. Newly-imported
  // textures via the Texture Library use type 'texture' and appear in both.
  const importedTextures = importedAssets.filter((a: ImportedAsset) =>
    a.assetType === 'wall-texture' || a.assetType === 'floor-texture' || a.assetType === 'texture')
  const importedWallTex = importedTextures
  const importedFloorTex = importedTextures
  const hasTex = !!shape.textureId
  const currentColor = shape.color ?? (shape.material === 'steel' ? '#8a8f96' : '#e8e4dc')

  return (
    <div
      ref={scrollRef}
      className={`shape-item ${selected ? 'selected' : ''}`}
      onClick={() => selectShape(shape.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectShape(shape.id) }}}
    >
      <div className="shape-header">
        <span className="shape-type-icon" aria-hidden="true">
          {SHAPE_ICONS[shape.type]}
        </span>
        <input
          className="shape-name-input"
          value={shape.label}
          onChange={e => updateShape(shape.id, { label: e.target.value })}
          onClick={e => e.stopPropagation()}
          aria-label="Shape name"
        />
        <button
          className={`step-lock-btn${shape.locked ? ' locked' : ''}`}
          onClick={e => { e.stopPropagation(); updateShape(shape.id, { locked: !shape.locked }) }}
          aria-label={shape.locked ? 'Unlock position' : 'Lock position'}
        >
          {shape.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}
        </button>
        <button className="delete-btn"
          onClick={e => { e.stopPropagation(); setConfirmDelete(true) }}
          aria-label={`Delete ${shape.label}`}>
          <IconDelete size={10} />
        </button>
      </div>

      {selected && (
        <div className="shape-detail" onClick={e => e.stopPropagation()}>
          <div className="dim-grid">
            {(shape.type === 'box' || shape.type === 'beam') ? (
              <>
                <MeasureInput label="Width"  inches={shape.w} onChange={v => updateShape(shape.id, { w: v })} min={0.5} disabled={shape.locked} />
                <MeasureInput label="Height" inches={shape.h} onChange={v => updateShape(shape.id, { h: v })} min={0.5} disabled={shape.locked} />
                <MeasureInput label="Depth"  inches={shape.d} onChange={v => updateShape(shape.id, { d: v })} min={0.5} disabled={shape.locked} />
              </>
            ) : (
              <>
                <MeasureInput label="Diameter" inches={shape.r * 2} onChange={v => updateShape(shape.id, { r: v / 2 })} min={1}   disabled={shape.locked} />
                <MeasureInput label="Height"   inches={shape.h}     onChange={v => updateShape(shape.id, { h: v })}     min={0.5} disabled={shape.locked} />
              </>
            )}
            <MeasureInput
              label="Bottom height"
              inches={shape.y - shape.h / 2}
              onChange={v => updateShape(shape.id, { y: v + shape.h / 2 })}
              min={0}
              disabled={shape.locked}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            <span className="coord-label">Color</span>
            <div className="slat-color-row" role="radiogroup" aria-label="Shape color">
              {SHAPE_COLORS.map(c => (
                <button
                  key={c.hex}
                  role="radio"
                  aria-checked={!hasTex && currentColor === c.hex}
                  className={`slat-color-swatch${!hasTex && currentColor === c.hex ? ' active' : ''}`}
                  style={{ background: c.hex }}
                  aria-label={c.name}
                  title={c.name}
                  onClick={() => updateShape(shape.id, { color: c.hex, textureId: undefined })}
                />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <span className="coord-label">Wall Textures</span>
            <div className="slat-color-row" role="radiogroup" aria-label="Wall textures" style={{ flexWrap: 'wrap', gap: 4 }}>
              <button
                role="radio"
                aria-checked={!hasTex}
                className={`slat-color-swatch${!hasTex ? ' active' : ''}`}
                style={{ background: currentColor, fontSize: 8, color: '#666', lineHeight: 1 }}
                aria-label="No texture (solid color)"
                title="Solid color"
                onClick={() => updateShape(shape.id, { textureId: undefined })}
              >—</button>
              {wallTextures.map(t => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={shape.textureId === t.id}
                  className={`slat-color-swatch${shape.textureId === t.id ? ' active' : ''}`}
                  style={{
                    backgroundImage: `url(${import.meta.env.BASE_URL}${texturePath(t.category, t.file)})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-label={t.name}
                  title={t.name}
                  onClick={() => updateShape(shape.id, { textureId: t.id })}
                />
              ))}
              {importedWallTex.map(t => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={shape.textureId === `imported:${t.id}`}
                  className={`slat-color-swatch${shape.textureId === `imported:${t.id}` ? ' active' : ''}`}
                  style={{
                    backgroundImage: `url(${t.data})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-label={t.name}
                  title={`Imported: ${t.name}`}
                  onClick={() => updateShape(shape.id, { textureId: `imported:${t.id}` })}
                />
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <span className="coord-label">Floor Textures</span>
            <div className="slat-color-row" role="radiogroup" aria-label="Floor textures" style={{ flexWrap: 'wrap', gap: 4 }}>
              {flooringColors.map(c => {
                const id = `floor:${c.id}`
                return (
                  <button
                    key={c.id}
                    role="radio"
                    aria-checked={shape.textureId === id}
                    className={`slat-color-swatch${shape.textureId === id ? ' active' : ''}`}
                    style={{
                      backgroundImage: `url(${import.meta.env.BASE_URL}${flooringTexturePath(c)})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    aria-label={c.name}
                    title={`${c.name} (${c.series})`}
                    onClick={() => updateShape(shape.id, { textureId: id })}
                  />
                )
              })}
              {importedFloorTex.map(t => (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={shape.textureId === `imported:${t.id}`}
                  className={`slat-color-swatch${shape.textureId === `imported:${t.id}` ? ' active' : ''}`}
                  style={{
                    backgroundImage: `url(${t.data})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                  aria-label={t.name}
                  title={`Imported: ${t.name}`}
                  onClick={() => updateShape(shape.id, { textureId: `imported:${t.id}` })}
                />
              ))}
            </div>
          </div>

          {hasTex && (
            <div style={{ marginTop: 10 }}>
              <span className="coord-label">Texture Scale</span>
              <div className="scale-row">
                <input
                  type="range"
                  min={0.25} max={6} step={0.05}
                  value={shape.textureScale ?? 1}
                  onChange={e => updateShape(shape.id, { textureScale: +e.target.value })}
                  className="scale-slider"
                  aria-label="Shape texture scale"
                />
                <span className="scale-val">{(shape.textureScale ?? 1).toFixed(2)}×</span>
              </div>
              <p className="field-hint" style={{ margin: '2px 0 0', fontSize: 10, color: '#888' }}>
                Higher = tighter tiling (more repeats)
              </p>
            </div>
          )}
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${shape.label}?`}
          message="This shape will be removed from the scene."
          onConfirm={() => { deleteShape(shape.id); setConfirmDelete(false) }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </div>
  )
}

export default function ShapePanel() {
  const { shapes, addShape } = useGarageStore()
  return (
    <div className="shape-panel">
      <div className="section-label" style={{ marginBottom: 10 }}>Add Shape</div>
      <div className="shape-type-grid">
        {SHAPE_TYPES.map(st => (
          <button key={st.type} className="shape-type-btn" onClick={() => addShape(st.type)}
            aria-label={`Add ${st.label}`}>
            <span className="shape-type-icon" aria-hidden="true">{SHAPE_ICONS[st.type]}</span>
            <span>{st.label}</span>
          </button>
        ))}
      </div>

      {shapes.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 20, marginBottom: 8 }}>
            Shapes ({shapes.length})
          </div>
          <div className="shape-list">
            {shapes.map(s => <ShapeEditor key={s.id} shape={s} />)}
          </div>
        </>
      )}

      {shapes.length === 0 && (
        <p className="empty-msg">Add shapes to model soffits, columns, beams, and other garage features.</p>
      )}
    </div>
  )
}
