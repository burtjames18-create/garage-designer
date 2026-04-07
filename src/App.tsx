import { Component, type ReactNode, useState, useEffect } from 'react'
import { useGarageStore } from './store/garageStore'
import GarageSetup from './components/GarageSetup'
import Sidebar from './components/Sidebar'
import Topbar from './components/Topbar'
import Viewer3D from './components/Viewer3D'
import WallElevationView from './components/WallElevationView'
import { ToastContainer } from './components/Toast'
import KeyboardHelp from './components/KeyboardHelp'
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
      {showKeyboard && <KeyboardHelp onClose={() => setShowKeyboard(false)} />}
    </ErrorBoundary>
  )
}
