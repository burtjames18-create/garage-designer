import { useEffect, useState, useCallback } from 'react'
import './Toast.css'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'info'
}

let nextId = 0
const listeners = new Set<(t: ToastItem) => void>()

/** Imperative API — call from anywhere (no hook needed) */
export function showToast(message: string, type: ToastItem['type'] = 'info') {
  const item: ToastItem = { id: nextId++, message, type }
  listeners.forEach(fn => fn(item))
}

/** Drop this once at the app root. It renders all active toasts. */
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((t: ToastItem) => {
    setToasts(prev => [...prev, t])
    setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== t.id))
    }, 3500)
  }, [])

  useEffect(() => {
    listeners.add(push)
    return () => { listeners.delete(push) }
  }, [push])

  if (toasts.length === 0) return null

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '!'}
            {t.type === 'info' && 'i'}
          </span>
          <span className="toast-msg">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
