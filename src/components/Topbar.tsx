import { useRef, useState } from 'react'
import { useGarageStore } from '../store/garageStore'
import type { ViewMode, QualityPreset } from '../store/garageStore'
import ExportModal from './ExportModal'
import ImportModelModal from './ImportModelModal'
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
    qualityPreset, setQualityPreset } = useGarageStore()
  const [showExport, setShowExport] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const preExportQuality = useRef<typeof qualityPreset | null>(null)

  function handleLoadClick() {
    fileInputRef.current?.click()
  }

  async function handleSave() {
    showToast('Saving project...', 'success')
    await saveProject()
    showToast('Project saved', 'success')
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string)
        loadProject(data)
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
        <button className="save-btn" onClick={handleSave} aria-label="Save project to file">
          <IconSave size={14} /> Save
        </button>
        <button className="load-btn" onClick={handleLoadClick} aria-label="Open saved project">
          <IconOpen size={14} /> Open Project
        </button>
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

      {showExport && <ExportModal onClose={() => {
        setShowExport(false)
        // Restore the user's original quality preset (they didn't choose high manually)
        if (preExportQuality.current && preExportQuality.current !== 'high') {
          setQualityPreset(preExportQuality.current)
        }
        preExportQuality.current = null
      }} />}
      {showImport && <ImportModelModal onClose={() => setShowImport(false)} />}
    </div>
  )
}
