import { useGarageStore, OVERHEAD_RACK_PRESETS } from '../store/garageStore'
import MeasureInput from './MeasureInput'

export default function OverheadRacksPanel() {
  const {
    overheadRacks, selectedRackId, addRack, updateRack, deleteRack, selectRack,
  } = useGarageStore()

  const sel = overheadRacks.find(r => r.id === selectedRackId)

  return (
    <div>
      <div className="section-label">Add Overhead Rack</div>
      <div className="preset-grid">
        {OVERHEAD_RACK_PRESETS.map(p => (
          <button key={p.key} className="preset-btn" onClick={() => addRack(p)}>
            <span className="preset-label">{p.label}</span>
            {p.price && <span className="preset-price">${p.price}</span>}
          </button>
        ))}
      </div>

      {overheadRacks.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 14 }}>Placed Racks</div>
          {overheadRacks.map(rack => {
            const isSel = selectedRackId === rack.id
            return (
              <div
                key={rack.id}
                className={`list-item${isSel ? ' selected' : ''}`}
                onClick={() => selectRack(isSel ? null : rack.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRack(isSel ? null : rack.id) } }}
                aria-selected={isSel}
              >
                <span className="list-item-label">{rack.label}</span>
                <button
                  className="delete-btn"
                  onClick={e => { e.stopPropagation(); deleteRack(rack.id) }}
                  aria-label={`Delete ${rack.label}`}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
                </button>
              </div>
            )
          })}
        </>
      )}

      {sel && (
        <div className="field-group" style={{ marginTop: 10 }}>
          <MeasureInput label="Ceiling Drop" inches={sel.drop} onChange={v => updateRack(sel.id, { drop: Math.max(1, Math.min(48, v)) })} min={1} max={48} />
          <p className="field-hint">Distance from ceiling to top of rack (1"–48")</p>
          <MeasureInput label="Position X" inches={sel.x} onChange={v => updateRack(sel.id, { x: v })} min={-600} max={600} />
          <MeasureInput label="Position Z" inches={sel.z} onChange={v => updateRack(sel.id, { z: v })} min={-600} max={600} />

          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="action-btn" onClick={() => updateRack(sel.id, { rotY: sel.rotY + Math.PI / 2 })}>
              Rotate 90°
            </button>
            <button className="action-btn" onClick={() => updateRack(sel.id, { locked: !sel.locked })}>
              {sel.locked ? '🔒 Unlock' : '🔓 Lock'}
            </button>
          </div>

          <div className="section-label" style={{ marginTop: 10 }}>Rack Color</div>
          <div className="color-grid" role="radiogroup" aria-label="Rack color">
            {[
              { id: '#333333', name: 'Black' },
              { id: '#e0e0e0', name: 'White' },
              { id: '#808080', name: 'Grey' },
            ].map(c => (
              <button
                key={c.id}
                role="radio"
                aria-checked={sel.color === c.id}
                className={`color-swatch ${sel.color === c.id ? 'selected' : ''}`}
                onClick={() => updateRack(sel.id, { color: c.id })}
                aria-label={c.name}
              >
                <div className="swatch-color" style={{ background: c.id }} />
                <span className="swatch-name">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
