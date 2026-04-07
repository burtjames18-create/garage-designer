import { useEffect } from 'react'
import './KeyboardHelp.css'

interface KeyboardHelpProps {
  onClose: () => void
}

const SHORTCUTS = [
  { section: '3D Navigation', keys: [
    { key: 'W A S D', desc: 'Walk forward / left / back / right' },
    { key: 'Space', desc: 'Move camera up' },
    { key: 'Ctrl', desc: 'Move camera down' },
    { key: 'Left Click + Drag', desc: 'Pan view' },
    { key: 'Right Click + Drag', desc: 'Rotate view' },
    { key: 'Scroll', desc: 'Zoom in / out' },
  ]},
  { section: 'General', keys: [
    { key: '?', desc: 'Toggle this help panel' },
    { key: 'Esc', desc: 'Close modal / deselect' },
    { key: 'Click object', desc: 'Select in 3D scene' },
    { key: 'Click empty space', desc: 'Deselect all' },
  ]},
]

export default function KeyboardHelp({ onClose }: KeyboardHelpProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="kb-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="kb-dialog">
        <div className="kb-header">
          <h3 className="kb-title">Keyboard Shortcuts</h3>
          <button className="kb-close" onClick={onClose} aria-label="Close shortcuts help">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>
          </button>
        </div>
        <div className="kb-body">
          {SHORTCUTS.map(section => (
            <div key={section.section} className="kb-section">
              <h4 className="kb-section-label">{section.section}</h4>
              <div className="kb-list">
                {section.keys.map(k => (
                  <div key={k.key} className="kb-row">
                    <kbd className="kb-key">{k.key}</kbd>
                    <span className="kb-desc">{k.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="kb-footer">
          Press <kbd className="kb-key-inline">?</kbd> or <kbd className="kb-key-inline">Esc</kbd> to close
        </div>
      </div>
    </div>
  )
}
