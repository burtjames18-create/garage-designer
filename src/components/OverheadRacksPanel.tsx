import { useGarageStore, OVERHEAD_RACK_PRESETS } from '../store/garageStore'
import { useScrollToSelected } from '../hooks/useScrollToSelected'
import MeasureInput from './MeasureInput'
import { IconLocked, IconUnlocked, IconRotate } from './Icons'
import './OverheadRacksPanel.css'

/** Tiny top-down SVG thumbnail showing the rack proportions */
function RackThumb({ width, length }: { width: number; length: number }) {
  // Map inches to a fixed thumbnail box, preserving aspect ratio
  const maxDim = Math.max(width, length)
  const w = (width / maxDim) * 80
  const l = (length / maxDim) * 80
  const cx = 50, cy = 20
  return (
    <svg className="rack-preset-thumb" viewBox="0 0 100 40" preserveAspectRatio="xMidYMid meet">
      <rect x={cx - l / 2} y={cy - w / 2} width={l} height={w} rx="1.5" />
      {/* Cross-wire grid */}
      {Array.from({ length: 4 }).map((_, i) => {
        const x = cx - l / 2 + (l / 5) * (i + 1)
        return <line key={`v${i}`} x1={x} y1={cy - w / 2} x2={x} y2={cy + w / 2} />
      })}
      {Array.from({ length: 2 }).map((_, i) => {
        const y = cy - w / 2 + (w / 3) * (i + 1)
        return <line key={`h${i}`} x1={cx - l / 2} y1={y} x2={cx + l / 2} y2={y} />
      })}
    </svg>
  )
}

function RackItem({ rack, isSel, onSelect, onDelete, onToggleLock, onRotate }: {
  rack: { id: string; label: string; locked?: boolean }; isSel: boolean
  onSelect: () => void; onDelete: () => void; onToggleLock: () => void; onRotate: () => void
}) {
  const scrollRef = useScrollToSelected<HTMLDivElement>(isSel)
  return (
    <div
      ref={scrollRef}
      key={rack.id}
      className={`list-item${isSel ? ' selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      aria-selected={isSel}
    >
      <span className="list-item-label">{rack.label}</span>
      <button
        className={`step-lock-btn${rack.locked ? ' locked' : ''}`}
        onClick={e => { e.stopPropagation(); onToggleLock() }}
        aria-label={rack.locked ? 'Unlock position' : 'Lock position'}
      >
        {rack.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}
      </button>
      <button
        className="step-lock-btn"
        onClick={e => { e.stopPropagation(); onRotate() }}
        aria-label="Rotate 90 degrees"
      >
        <IconRotate size={12} />
      </button>
      <button
        className="delete-btn"
        onClick={e => { e.stopPropagation(); onDelete() }}
        aria-label={`Delete ${rack.label}`}
      >
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
      </button>
    </div>
  )
}

export default function OverheadRacksPanel() {
  const {
    overheadRacks, selectedRackId, addRack, updateRack, deleteRack, selectRack,
  } = useGarageStore()

  const sel = overheadRacks.find(r => r.id === selectedRackId)

  return (
    <div>
      <div className="section-label">Add Overhead Rack</div>
      <div className="rack-preset-grid">
        {OVERHEAD_RACK_PRESETS.map(p => (
          <button key={p.key} className="rack-preset-btn" onClick={() => addRack(p)} title={`${p.label} (${p.sku})`}>
            <RackThumb width={p.rackWidth} length={p.rackLength} />
            <div className="rack-preset-row">
              <span className="rack-preset-name">{p.label}</span>
              {p.price != null && <span className="rack-preset-price">${p.price}</span>}
            </div>
          </button>
        ))}
      </div>

      {overheadRacks.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 14 }}>Placed Racks</div>
          {overheadRacks.map(rack => (
            <RackItem key={rack.id} rack={rack} isSel={selectedRackId === rack.id}
              onSelect={() => selectRack(selectedRackId === rack.id ? null : rack.id)}
              onDelete={() => deleteRack(rack.id)}
              onToggleLock={() => updateRack(rack.id, { locked: !rack.locked })}
              onRotate={() => updateRack(rack.id, { rotY: rack.rotY + Math.PI / 2 })} />
          ))}
        </>
      )}

      {sel && (
        <div className="field-group" style={{ marginTop: 10 }}>
          <MeasureInput label="Ceiling Drop" inches={sel.drop} onChange={v => updateRack(sel.id, { drop: Math.max(1, Math.min(48, v)) })} min={1} max={48} disabled={sel.locked} />
          <p className="field-hint">Distance from ceiling to top of rack (1"–48")</p>
          <MeasureInput label="Position X" inches={sel.x} onChange={v => updateRack(sel.id, { x: v })} min={-600} max={600} disabled={sel.locked} />
          <MeasureInput label="Position Z" inches={sel.z} onChange={v => updateRack(sel.id, { z: v })} min={-600} max={600} disabled={sel.locked} />
        </div>
      )}
    </div>
  )
}
