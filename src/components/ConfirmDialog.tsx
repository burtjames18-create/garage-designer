import { useEffect, useRef } from 'react'
import './ConfirmDialog.css'

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel',
  danger = true, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus the cancel button on mount, trap Escape
  useEffect(() => {
    cancelRef.current?.focus()
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  return (
    <div className="confirm-overlay" role="alertdialog" aria-modal="true"
      aria-labelledby="confirm-title" aria-describedby="confirm-msg"
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="confirm-dialog">
        <h3 id="confirm-title" className="confirm-title">{title}</h3>
        <p id="confirm-msg" className="confirm-msg">{message}</p>
        <div className="confirm-actions">
          <button ref={cancelRef} className="confirm-cancel-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={`confirm-action-btn ${danger ? 'danger' : ''}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
