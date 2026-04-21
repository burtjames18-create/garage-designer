import { useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useGarageStore } from '../store/garageStore'
import type { ViewMode, QualityPreset } from '../store/garageStore'
import ExportModal from './ExportModal'
import ImportModelModal from './ImportModelModal'
import TextureLibraryModal from './TextureLibraryModal'
import { IconSave, IconOpen } from './Icons'
import { showToast } from './Toast'
import './Topbar.css'

const VIEW_MODES: { mode: ViewMode; label: string; icon: string }[] = [
  { mode: 'perspective', label: '3D View',    icon: '◻' },
  { mode: 'wireframe',   label: 'Wireframe',  icon: '⬡' },
  { mode: 'top',         label: 'Floor Plan', icon: '⊟' },
  { mode: 'elevation',   label: 'Wall Edit',  icon: '▦' },
]

const QUALITY_LEVELS: { key: QualityPreset; label: string; title: string }[] = [
  { key: 'low',    label: 'L', title: 'Low quality — best performance' },
  { key: 'medium', label: 'M', title: 'Medium quality — balanced' },
  { key: 'high',   label: 'H', title: 'High quality — best visuals' },
]

export default function Topbar() {
  const { customerName, siteAddress, viewMode, setViewMode, saveProject, loadProject,
    qualityPreset, setQualityPreset, projectName, newProject } = useGarageStore()
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showTextures, setShowTextures] = useState(false)
  const [showSaveMenu, setShowSaveMenu] = useState(false)
  const [showOpenMenu, setShowOpenMenu] = useState(false)
  const [showNamePrompt, setShowNamePrompt] = useState<null | 'save' | 'saveAs'>(null)
  const [promptName, setPromptName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preExportQuality = useRef<typeof qualityPreset | null>(null)

  async function handleLoadClick() {
    // In Electron, use the native Open dialog so we capture the real file path
    // (lets subsequent saves overwrite the same file silently). In the browser,
    // fall back to the hidden file input.
    const launcher = (window as unknown as { launcher?: {
      openProject?: () => Promise<{ path: string; content: string } | { error: string } | null>
    } }).launcher
    if (launcher?.openProject) {
      const result = await launcher.openProject()
      if (!result) return
      if ('error' in result) {
        showToast('Could not read project file.', 'error')
        return
      }
      try {
        const parsed = JSON.parse(result.content)
        const filename = result.path.split(/[\\/]/).pop() ?? ''
        loadProject(parsed, filename, result.path)
        showToast('Project loaded', 'success')
      } catch {
        showToast('Could not read project file. Make sure it is a valid .garage file.', 'error')
      }
      return
    }
    fileInputRef.current?.click()
  }

  async function doSave(nameOverride?: string) {
    showToast('Saving project...', 'success')
    await saveProject(nameOverride)
    showToast('Project saved', 'success')
  }

  function handleSaveClick() {
    setShowSaveMenu(s => !s)
  }

  function handleSaveOption(mode: 'save' | 'saveAs') {
    setShowSaveMenu(false)
    const isElectron = !!(window as unknown as { launcher?: { saveProject?: unknown } }).launcher?.saveProject
    if (isElectron) {
      // Electron: native Save As dialog handles naming. Save does a silent
      // overwrite when a file path is already known (from Open or prior save).
      if (mode === 'saveAs') {
        const suggested = projectName
          ?? (customerName ? customerName.replace(/[^a-z0-9]/gi, '_') : '')
        doSave(suggested || undefined)
      } else {
        doSave()
      }
      return
    }
    // Browser fallback: keep the in-app name prompt.
    if (mode === 'save' && projectName) {
      doSave()
      return
    }
    const suggested = projectName
      ?? (customerName ? customerName.replace(/[^a-z0-9]/gi, '_') : '')
    setPromptName(suggested)
    setShowNamePrompt(mode)
  }

  // Stable callbacks for ExportModal — using useCallback with empty deps
  // prevents the modal's capture useEffect from re-firing when Topbar
  // re-renders (which would re-capture screenshots at the new — lower —
  // quality preset right after we drop it back).
  const handleExportClose = useCallback(() => {
    setShowExport(false)
    if (preExportQuality.current && preExportQuality.current !== 'high') {
      setQualityPreset(preExportQuality.current)
    }
    preExportQuality.current = null
  }, [setQualityPreset])
  const handleCapturesReady = useCallback(() => {
    if (preExportQuality.current && preExportQuality.current !== 'high') {
      setQualityPreset(preExportQuality.current)
      preExportQuality.current = null
    }
  }, [setQualityPreset])

  function handleNamePromptConfirm() {
    const clean = promptName.trim().replace(/\.garage$/i, '').replace(/[^a-z0-9_\- ]/gi, '_').trim()
    if (!clean) return
    setShowNamePrompt(null)
    doSave(clean)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        loadProject(data, file.name)
        showToast('Project loaded', 'success')
      } catch {
        showToast('Could not read project file. Make sure it is a valid .garage file.', 'error')
      }
    }
    reader.readAsText(file)
    // Reset so the same file can be re-loaded
    e.target.value = ''
  }

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit'
  })

  return (
    <div className="topbar" role="banner">
      {/* Logo */}
      <div className="topbar-logo">
        <img src={`${import.meta.env.BASE_URL}assets/gl-logo.png.webp`} alt="Garage Living" className="topbar-logo-img"
          onError={e => {
            const img = e.target as HTMLImageElement
            img.style.display = 'none'
            const fallback = img.nextElementSibling as HTMLElement
            if (fallback) fallback.style.display = 'flex'
          }}
        />
        <div className="topbar-logo-fallback" style={{ display: 'none' }}>
          <span className="logo-box-sm">GARAGE</span>
          <span className="logo-living-sm">LIVING</span>
        </div>
      </div>

      {/* Project info */}
      <div className="topbar-info">
        <div className="topbar-field">
          <span className="topbar-label">Customer</span>
          <span className="topbar-value">{customerName || '—'}</span>
        </div>
        <div className="topbar-sep" aria-hidden="true" />
        <div className="topbar-field">
          <span className="topbar-label">Address</span>
          <span className="topbar-value">{siteAddress || '—'}</span>
        </div>
        <div className="topbar-sep" aria-hidden="true" />
        <div className="topbar-field">
          <span className="topbar-label">Date</span>
          <span className="topbar-value">{today}</span>
        </div>
      </div>

      {/* View mode switcher — center */}
      <div className="view-modes" role="tablist" aria-label="View mode">
        {VIEW_MODES.map(v => (
          <button
            key={v.mode}
            role="tab"
            aria-selected={viewMode === v.mode}
            className={`view-btn ${viewMode === v.mode ? 'active' : ''}`}
            onClick={() => setViewMode(v.mode)}
            aria-label={v.label}
          >
            <span className="view-icon" aria-hidden="true">{v.icon}</span>
          </button>
        ))}
      </div>

      {/* Import button */}
      <button className="import-btn" onClick={() => setShowImport(true)} aria-label="Import 3D model or texture">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
        Import Model
      </button>

      {/* Textures library button */}
      <button className="import-btn" onClick={() => setShowTextures(true)} aria-label="Manage imported textures">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
        Textures
      </button>

      {/* Quality preset */}
      <div className="quality-toggle" role="radiogroup" aria-label="Render quality">
        <span className="quality-label">Quality</span>
        {QUALITY_LEVELS.map(q => (
          <button
            key={q.key}
            role="radio"
            aria-checked={qualityPreset === q.key}
            className={`quality-btn ${qualityPreset === q.key ? 'active' : ''}`}
            onClick={() => setQualityPreset(q.key)}
            title={q.title}
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Actions */}
      <div className="topbar-actions">
        <div className="save-btn-wrap" style={{ position: 'relative' }}>
          <button className="save-btn" onClick={handleSaveClick} aria-label="Save project">
            <IconSave size={14} /> Save {projectName ? `(${projectName})` : ''} ▾
          </button>
          {showSaveMenu && (
            <div className="save-menu" style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 100,
              background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', minWidth: 140,
            }}>
              <button
                onClick={() => handleSaveOption('save')}
                style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'transparent', border: 'none', color: '#eee', cursor: 'pointer', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Save
              </button>
              <button
                onClick={() => handleSaveOption('saveAs')}
                style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'transparent', border: 'none', color: '#eee', cursor: 'pointer', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Save As New…
              </button>
            </div>
          )}
        </div>
        {showSaveMenu && (
          <div onClick={() => setShowSaveMenu(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
        )}
        {showNamePrompt && createPortal(
          <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.5)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setShowNamePrompt(null)}>
            <div onClick={e => e.stopPropagation()} style={{
              background: '#2a2a2a', padding: 20, borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.15)', minWidth: 320,
            }}>
              <div style={{ fontSize: 14, color: '#eee', marginBottom: 10, fontWeight: 600 }}>
                {showNamePrompt === 'saveAs' ? 'Save As New Project' : 'Save Project'}
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginBottom: 6 }}>Project name:</div>
              <input
                type="text" autoFocus value={promptName}
                onChange={e => setPromptName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleNamePromptConfirm()
                  if (e.key === 'Escape') setShowNamePrompt(null)
                }}
                placeholder="my-garage"
                style={{ width: '100%', padding: '6px 8px', fontSize: 13,
                  background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: 4, color: '#eee' }}
              />
              <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Saved as {promptName.trim() || 'my-garage'}.garage</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
                <button onClick={() => setShowNamePrompt(null)}
                  style={{ padding: '6px 12px', fontSize: 12, background: 'transparent',
                    border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, color: '#ccc', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={handleNamePromptConfirm} disabled={!promptName.trim()}
                  style={{ padding: '6px 12px', fontSize: 12, background: '#3a6eb5',
                    border: '1px solid #4a82c4', borderRadius: 4, color: '#fff', cursor: 'pointer',
                    opacity: promptName.trim() ? 1 : 0.5 }}>
                  Save
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
        <div className="open-btn-wrap" style={{ position: 'relative' }}>
          <button className="load-btn" onClick={() => setShowOpenMenu(s => !s)} aria-label="Open project menu">
            <IconOpen size={14} /> Project ▾
          </button>
          {showOpenMenu && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 100,
              background: '#2a2a2a', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.4)', minWidth: 160,
            }}>
              <button
                onClick={() => { setShowOpenMenu(false); handleLoadClick() }}
                style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'transparent', border: 'none', color: '#eee', cursor: 'pointer', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                Open Project…
              </button>
              <button
                onClick={() => {
                  setShowOpenMenu(false)
                  if (confirm('Start a new project? Any unsaved changes will be lost.')) {
                    newProject()
                  }
                }}
                style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'transparent', border: 'none', color: '#eee', cursor: 'pointer', fontSize: 12 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                New Project
              </button>
            </div>
          )}
        </div>
        {showOpenMenu && (
          <div onClick={() => setShowOpenMenu(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 99 }} />
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".garage,application/json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
          aria-hidden="true"
        />
        <button className="export-btn" onClick={() => {
          // Auto-switch to high quality before exporting so captures look their best.
          // Remember the current preset so we can restore it when the modal closes.
          preExportQuality.current = qualityPreset
          if (qualityPreset !== 'high') {
            setQualityPreset('high')
            setTimeout(() => setShowExport(true), 400)
          } else {
            setShowExport(true)
          }
        }} aria-label="Export as PDF">Export PDF</button>
      </div>

      <span className="topbar-version">v{__APP_VERSION__}</span>

      {showExport && <ExportModal
        onClose={handleExportClose}
        onCapturesReady={handleCapturesReady}
      />}
      {showImport && <ImportModelModal onClose={() => setShowImport(false)} />}
      {showTextures && <TextureLibraryModal onClose={() => setShowTextures(false)} />}
    </div>
  )
}
