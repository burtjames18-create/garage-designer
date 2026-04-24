import { useGarageStore } from '../store/garageStore'

export default function AutosaveIndicator() {
  const status = useGarageStore(s => s.autosaveStatus)
  if (status === 'idle') return null
  const saving = status === 'saving'
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        right: 14,
        bottom: 14,
        padding: '6px 10px',
        fontFamily: 'Plus Jakarta Sans, sans-serif',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.4,
        color: saving ? '#d0e4f4' : '#9dd89d',
        background: 'rgba(16, 20, 28, 0.78)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 8,
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.35)',
        backdropFilter: 'blur(4px)',
        pointerEvents: 'none',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        animation: 'autosave-fade-in 0.18s ease-out',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6, height: 6,
          borderRadius: '50%',
          background: saving ? '#4aa3e0' : '#4ade80',
          boxShadow: saving ? '0 0 6px #4aa3e0' : '0 0 6px #4ade80',
          animation: saving ? 'autosave-pulse 1s ease-in-out infinite' : undefined,
        }}
      />
      {saving ? 'Saving…' : 'Saved'}
      <style>{`
        @keyframes autosave-fade-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes autosave-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}
