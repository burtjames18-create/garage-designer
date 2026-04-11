import { useState } from 'react'
import { useGarageStore } from '../store/garageStore'
import { useScrollToSelected } from '../hooks/useScrollToSelected'
import type { GarageShape, ShapeType } from '../store/garageStore'
import MeasureInput from './MeasureInput'
import { IconDelete } from './Icons'
import ConfirmDialog from './ConfirmDialog'
import './ShapePanel.css'

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
  const { updateShape, deleteShape, selectShape, selectedShapeId } = useGarageStore()
  const selected = selectedShapeId === shape.id
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scrollRef = useScrollToSelected<HTMLDivElement>(selected)

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
                <MeasureInput label="Width"  inches={shape.w} onChange={v => updateShape(shape.id, { w: v })} min={0.5} />
                <MeasureInput label="Height" inches={shape.h} onChange={v => updateShape(shape.id, { h: v })} min={0.5} />
                <MeasureInput label="Depth"  inches={shape.d} onChange={v => updateShape(shape.id, { d: v })} min={0.5} />
              </>
            ) : (
              <>
                <MeasureInput label="Diameter" inches={shape.r * 2} onChange={v => updateShape(shape.id, { r: v / 2 })} min={1} />
                <MeasureInput label="Height"   inches={shape.h}     onChange={v => updateShape(shape.id, { h: v })}     min={0.5} />
              </>
            )}
            <MeasureInput
              label="Bottom height"
              inches={shape.y - shape.h / 2}
              onChange={v => updateShape(shape.id, { y: v + shape.h / 2 })}
              min={0}
            />
          </div>
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
