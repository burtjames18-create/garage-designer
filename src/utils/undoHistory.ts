/**
 * Lightweight undo for the garage store.
 *
 * Subscribes to the store and snapshots the project-relevant fields after
 * the user finishes a burst of changes (debounced). The user clicks the
 * Undo button (or presses Ctrl+Z) to roll back to the previous snapshot.
 *
 * Why debounced: a single drag emits hundreds of `set()` calls and we don't
 * want each one to be a separate undo step. We wait for ~250ms of quiet
 * before committing a snapshot, so each drag becomes one undoable unit.
 *
 * The history stack lives in module scope (NOT in Zustand state) so it
 * doesn't get serialized into save files or trigger re-renders.
 */
import { useGarageStore } from '../store/garageStore'

interface Snapshot {
  walls: unknown
  slatwallPanels: unknown
  stainlessBacksplashPanels: unknown
  floorSteps: unknown
  shapes: unknown
  cabinets: unknown
  countertops: unknown
  baseboards: unknown
  stemWalls: unknown
  slatwallAccessories: unknown
  overheadRacks: unknown
  items: unknown
  ceilingLights: unknown
  floorPoints: unknown
  garageWidth: number
  garageDepth: number
  ceilingHeight: number
  flooringColor: string
  floorTextureScale: number
}

const HISTORY_LIMIT = 50
const DEBOUNCE_MS = 250

const past: Snapshot[] = []
const future: Snapshot[] = []
let lastSerialized = ''
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let suppressNextSnapshot = false
const listeners = new Set<() => void>()

function snapshot(): Snapshot {
  const s = useGarageStore.getState()
  return {
    walls: s.walls,
    slatwallPanels: s.slatwallPanels,
    stainlessBacksplashPanels: s.stainlessBacksplashPanels,
    floorSteps: s.floorSteps,
    shapes: s.shapes,
    cabinets: s.cabinets,
    countertops: s.countertops,
    baseboards: s.baseboards,
    stemWalls: s.stemWalls,
    slatwallAccessories: s.slatwallAccessories,
    overheadRacks: s.overheadRacks,
    items: s.items,
    ceilingLights: s.ceilingLights,
    floorPoints: s.floorPoints,
    garageWidth: s.garageWidth,
    garageDepth: s.garageDepth,
    ceilingHeight: s.ceilingHeight,
    flooringColor: s.flooringColor,
    floorTextureScale: s.floorTextureScale,
  }
}

function commitSnapshot() {
  const next = snapshot()
  const serialized = JSON.stringify(next)
  if (serialized === lastSerialized) return
  if (lastSerialized) {
    past.push(JSON.parse(lastSerialized))
    if (past.length > HISTORY_LIMIT) past.shift()
  }
  // A new edit invalidates the redo stack — can't redo past it.
  future.length = 0
  lastSerialized = serialized
  for (const cb of listeners) cb()
}

/** Initialize the history watcher. Call once on app start. */
export function initUndoHistory() {
  // Seed lastSerialized with the current state so we don't push a redundant
  // initial entry.
  lastSerialized = JSON.stringify(snapshot())
  useGarageStore.subscribe(() => {
    if (suppressNextSnapshot) {
      // The change came from undo() restoring state — refresh the baseline
      // without pushing a new history entry.
      suppressNextSnapshot = false
      lastSerialized = JSON.stringify(snapshot())
      for (const cb of listeners) cb()
      return
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(commitSnapshot, DEBOUNCE_MS)
    // Notify listeners now (not just on commit) so the Undo arrow lights up
    // immediately — canUndo() reports the pending edit too.
    for (const cb of listeners) cb()
  })
}

/** Flush any pending debounced snapshot immediately. */
function flushPending() {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
    // Don't go through commitSnapshot here — that clears `future`. Inline
    // a non-clearing version: push current head to past, swap in the new.
    const next = snapshot()
    const serialized = JSON.stringify(next)
    if (serialized !== lastSerialized) {
      if (lastSerialized) {
        past.push(JSON.parse(lastSerialized))
        if (past.length > HISTORY_LIMIT) past.shift()
      }
      lastSerialized = serialized
    }
  }
}

/** Pop the previous snapshot and restore it. The current head is pushed onto
 *  the redo stack so it can be re-applied with `redo()`. */
export function undo() {
  flushPending()
  const prev = past.pop()
  if (!prev) return
  // Save current head onto redo stack before stepping back.
  if (lastSerialized) future.push(JSON.parse(lastSerialized))
  suppressNextSnapshot = true
  useGarageStore.setState(prev)
  for (const cb of listeners) cb()
}

/** Re-apply a previously undone snapshot. */
export function redo() {
  flushPending()
  const next = future.pop()
  if (!next) return
  if (lastSerialized) past.push(JSON.parse(lastSerialized))
  suppressNextSnapshot = true
  useGarageStore.setState(next)
  for (const cb of listeners) cb()
}

/** True if there's at least one snapshot to roll back to. Includes pending
 *  (debounced) edits that haven't been committed yet — the user can still
 *  undo them, since `undo()` flushes pending state first. */
export function canUndo(): boolean { return past.length > 0 || debounceTimer !== null }
/** True if there's at least one undone snapshot to re-apply. */
export function canRedo(): boolean { return future.length > 0 }

/** Subscribe to history changes (e.g. to update an Undo button's enabled state). */
export function subscribeUndoHistory(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
