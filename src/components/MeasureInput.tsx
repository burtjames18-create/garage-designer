import { useState, useEffect, useRef } from 'react'
import { inchesToDisplay } from '../utils/measurements'
import './MeasureInput.css'

interface Props {
  label?: string
  inches: number
  onChange: (inches: number) => void
  min?: number
  max?: number
  compact?: boolean
  disabled?: boolean
}

export default function MeasureInput({ label, inches, onChange, min = 0, max = 99999, compact, disabled }: Props) {
  const [raw, setRaw] = useState(String(Math.round(inches)))
  const focused = useRef(false)

  // Sync external changes only when the user isn't actively typing
  useEffect(() => {
    if (!focused.current) setRaw(String(Math.round(inches)))
  }, [inches])

  const commit = () => {
    focused.current = false
    const parsed = parseFloat(raw)
    const clamped = isNaN(parsed) ? inches : Math.max(min, Math.min(max, parsed))
    onChange(clamped)
    setRaw(String(Math.round(clamped)))
  }

  return (
    <div className={`measure-input ${compact ? 'compact' : ''}${disabled ? ' disabled' : ''}`}>
      {label && <span className="measure-label">{label}</span>}
      <div className="measure-fields">
        <input
          type="number"
          className="measure-in"
          value={raw}
          min={min}
          max={max}
          step={1}
          disabled={disabled}
          onFocus={e => { focused.current = true; e.target.select() }}
          onChange={e => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
        <span className="measure-unit">in</span>
        <span className="measure-display">{inchesToDisplay(inches)}</span>
      </div>
    </div>
  )
}
