import { Component, type ReactNode, useState, useEffect } from 'react'
import { useGarageStore } from './store/garageStore'
import GarageSetup from './components/GarageSetup'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Viewer3D from './components/Viewer3D'
import WallElevationView from './components/WallElevationView'
import { ToastContainer } from './components/Toast'
import KeyboardHelp from './components/KeyboardHelp'
import AutosaveIndicator from './components/AutosaveIndicator'
import { setAutosaveStatus } from './utils/autosaveStatus'
import { initUndoHistory, undo as undoOnce, redo as redoOnce } from './utils/undoHistory'
import './App.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 40, color: '#ff6b6b', fontFamily: 'monospace', background: '#16181d', height: '100%' }}>
          <h2 style={{ color: '#ff6b6b' }}>Render Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#aaa' }}>{String(this.state.error)}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  const setupDone = useGarageStore(s => s.setupDone)
  const viewMode = useGarageStore(s => s.viewMode)
  const [showKeyboard, setShowKeyboard] = useState(false)

  // Wire up the undo history watcher once. Snapshots after a debounced quiet
  // window so each drag becomes a single undoable step. Ctrl+Z undoes,
  // Ctrl+Shift+Z (or Ctrl+Y) redoes.
  useEffect(() => {
    initUndoHistory()
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redoOnce(); else undoOnce()
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        redoOnce()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Rehydrate imported textures from IndexedDB on boot — they persist across
  // app sessions regardless of whether a project has been saved.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { loadAllTexturesFromDB } = await import('./utils/textureLibrary')
        const stored = await loadAllTexturesFromDB()
        if (cancelled || stored.length === 0) return
        const state = useGarageStore.getState()
        const existingIds = new Set(state.importedAssets.map(a => a.id))
        const toAdd = stored.filter(a => !existingIds.has(a.id))
        for (const a of toAdd) state.addImportedAsset(a)
      } catch (err) {
        console.warn('Texture library load failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Autosave — in Electron, silently overwrite the project's .garage file
  // a few seconds after the last edit. Only fires when a projectFilePath
  // has been set (via Open, explicit Save As, or auto-created folder on
  // setup completion). Browser sessions skip — window.launcher is absent.
  useEffect(() => {
    const launcher = (window as unknown as { launcher?: {
      saveProject?: (path: string, content: string) => Promise<boolean>
    } }).launcher
    if (!launcher?.saveProject) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let savedTimer: ReturnType<typeof setTimeout> | null = null
    let inFlight = false
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        const state = useGarageStore.getState()
        if (!state.projectFilePath || !state.setupDone || inFlight) return
        inFlight = true
        setAutosaveStatus('saving')
        try {
          const { buildProjectJson } = await import('./store/garageStore')
          const json = await buildProjectJson(useGarageStore.getState)
          await launcher.saveProject!(state.projectFilePath, json)
          setAutosaveStatus('saved')
          // Keep "Saved" on screen briefly, then fade back to idle.
          if (savedTimer) clearTimeout(savedTimer)
          savedTimer = setTimeout(() => {
            setAutosaveStatus('idle')
          }, 1800)
        } catch {
          setAutosaveStatus('idle')
        } finally {
          inFlight = false
        }
      }, 3000)
    }
    const unsubscribe = useGarageStore.subscribe(schedule)
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
      if (savedTimer) clearTimeout(savedTimer)
    }
  }, [])

  // Save-before-close: when the user clicks the window X, the main process
  // fires 'app-save-before-close' and waits for confirmClose(). We flush a
  // final write of the current project (if any), then confirm.
  useEffect(() => {
    const launcher = (window as unknown as { launcher?: {
      saveProject?: (path: string, content: string) => Promise<boolean>
      onSaveBeforeClose?: (cb: () => void) => (() => void)
      confirmClose?: () => void
    } }).launcher
    if (!launcher?.onSaveBeforeClose || !launcher.confirmClose) return
    const unsubscribe = launcher.onSaveBeforeClose(async () => {
      try {
        const state = useGarageStore.getState()
        if (state.projectFilePath && state.setupDone && launcher.saveProject) {
          setAutosaveStatus('saving')
          const { buildProjectJson } = await import('./store/garageStore')
          const json = await buildProjectJson(useGarageStore.getState)
          await launcher.saveProject(state.projectFilePath, json)
        }
      } catch {
        // If the save fails, still let the app close — don't trap the user.
      } finally {
        launcher.confirmClose!()
      }
    })
    return unsubscribe
  }, [])

  // Global "?" shortcut to toggle keyboard help
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setShowKeyboard(prev => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!setupDone) return (
    <>
      <GarageSetup />
      <ToastContainer />
    </>
  )

  return (
    <ErrorBoundary>
      <div className="app-layout">
        <Topbar />
        <div className="app-body">
          <Sidebar />
          {viewMode === 'elevation' ? <WallElevationView /> : <Viewer3D />}
        </div>
      </div>
      <ToastContainer />
      <AutosaveIndicator />
      {showKeyboard && <KeyboardHelp onClose={() => setShowKeyboard(false)} />}
    </ErrorBoundary>
  )
}
