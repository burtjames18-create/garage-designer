/** Tiny standalone event emitter for the autosave status indicator.
 *  Kept OUT of the Zustand store on purpose: if the status lived in the
 *  store, setting it would trigger the store subscribe listener that
 *  schedules the next save — creating an infinite save ↔ status loop. */
export type AutosaveStatus = 'idle' | 'saving' | 'saved'

let current: AutosaveStatus = 'idle'
const listeners = new Set<(s: AutosaveStatus) => void>()

export function getAutosaveStatus(): AutosaveStatus {
  return current
}

export function setAutosaveStatus(s: AutosaveStatus): void {
  if (s === current) return
  current = s
  for (const fn of listeners) fn(s)
}

export function subscribeAutosaveStatus(fn: (s: AutosaveStatus) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
