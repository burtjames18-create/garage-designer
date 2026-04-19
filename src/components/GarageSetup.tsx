import { useState, useRef, useEffect } from 'react'
import { useGarageStore } from '../store/garageStore'
import { PATCH_NOTES } from '../data/patchNotes'
import './GarageSetup.css'

export default function GarageSetup() {
  const { setCustomerInfo, initializeGarage, completeSetup } = useGarageStore()

  const [customerName, setCustomerName] = useState('')
  const [siteAddress, setSiteAddress]   = useState('')
  const [consultant,  setConsultant]    = useState('Garage Living')
  const [widthFt,     setWidthFt]       = useState('20')
  const [depthFt,     setDepthFt]       = useState('22')
  const [heightFt,    setHeightFt]      = useState('9')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const firstInputRef = useRef<HTMLInputElement>(null)

  // Feedback form state
  const [fbType, setFbType] = useState<'bug' | 'feature'>('bug')
  const [fbText, setFbText] = useState('')
  const [fbSubmitting, setFbSubmitting] = useState(false)
  const [fbStatus, setFbStatus] = useState<{ kind: 'success' | 'error'; msg: string } | null>(null)

  const LICENSE_SERVER = 'https://gl-license-server-production.up.railway.app'

  const submitFeedback = async () => {
    if (!fbText.trim() || fbSubmitting) return
    setFbSubmitting(true)
    setFbStatus(null)
    try {
      const res = await fetch(`${LICENSE_SERVER}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: fbType,
          message: fbText.trim(),
          app_version: __APP_VERSION__,
          customer_name: customerName || undefined,
          consultant: consultant || undefined,
        }),
      })
      if (!res.ok) throw new Error(`Server ${res.status}`)
      setFbStatus({ kind: 'success', msg: 'Submitted — thank you!' })
      setFbText('')
    } catch (err) {
      setFbStatus({ kind: 'error', msg: 'Could not send. Check your connection.' })
    } finally {
      setFbSubmitting(false)
    }
  }

  useEffect(() => { firstInputRef.current?.focus() }, [])

  const validate = () => {
    const e: Record<string, string> = {}
    const w = parseFloat(widthFt), d = parseFloat(depthFt), h = parseFloat(heightFt)
    if (!w || w < 8 || w > 60) e.width = '8–60 ft'
    if (!d || d < 8 || d > 60) e.depth = '8–60 ft'
    if (!h || h < 7 || h > 20) e.height = '7–20 ft'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleStart = () => {
    if (!validate()) return
    setCustomerInfo(customerName, siteAddress, consultant)
    initializeGarage(
      parseFloat(widthFt)  || 20,
      parseFloat(depthFt)  || 22,
      parseFloat(heightFt) || 9,
    )
    completeSetup()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleStart()
  }

  return (
    <div className="setup-overlay">
      <div className="setup-layout">
      <div className="setup-modal" role="dialog" aria-label="Project setup" onKeyDown={handleKeyDown}>
        <div className="setup-logo">
          <img
            src={`${import.meta.env.BASE_URL}assets/gl-logo.png.webp`}
            alt="Garage Living"
            className="setup-logo-img"
            onError={e => {
              const img = e.target as HTMLImageElement
              img.style.display = 'none'
              const fallback = img.nextElementSibling as HTMLElement
              if (fallback) fallback.style.display = 'flex'
            }}
          />
          <div className="setup-logo-fallback" style={{ display: 'none' }}>
            <span className="logo-box">GARAGE</span>
            <span className="logo-living">LIVING</span>
          </div>
        </div>

        <h1>3D Garage Designer</h1>
        <p className="setup-sub">Enter project details to begin</p>

        <div className="setup-section">
          <label htmlFor="setup-customer">Customer Name</label>
          <input
            id="setup-customer"
            ref={firstInputRef}
            value={customerName}
            onChange={e => setCustomerName(e.target.value)}
            placeholder="e.g. Christina Lunt"
            autoComplete="name"
          />
        </div>
        <div className="setup-section">
          <label htmlFor="setup-address">Site Address</label>
          <input
            id="setup-address"
            value={siteAddress}
            onChange={e => setSiteAddress(e.target.value)}
            placeholder="e.g. 4223 Amherst St"
            autoComplete="street-address"
          />
        </div>
        <div className="setup-section">
          <label htmlFor="setup-consultant">Design Consultant</label>
          <input
            id="setup-consultant"
            value={consultant}
            onChange={e => setConsultant(e.target.value)}
          />
        </div>

        <div className="setup-section-label">Starting Dimensions</div>
        <div className="setup-dims">
          <div className="setup-section">
            <label htmlFor="setup-width">Width (ft)</label>
            <input
              id="setup-width"
              type="number"
              value={widthFt}
              min={8} max={60} step={0.5}
              onChange={e => { setWidthFt(e.target.value); setErrors(prev => { const { width, ...rest } = prev; return rest }) }}
              aria-invalid={!!errors.width}
              aria-describedby={errors.width ? 'err-width' : undefined}
            />
            {errors.width && <span id="err-width" className="setup-error" role="alert">{errors.width}</span>}
          </div>
          <div className="setup-section">
            <label htmlFor="setup-depth">Depth (ft)</label>
            <input
              id="setup-depth"
              type="number"
              value={depthFt}
              min={8} max={60} step={0.5}
              onChange={e => { setDepthFt(e.target.value); setErrors(prev => { const { depth, ...rest } = prev; return rest }) }}
              aria-invalid={!!errors.depth}
              aria-describedby={errors.depth ? 'err-depth' : undefined}
            />
            {errors.depth && <span id="err-depth" className="setup-error" role="alert">{errors.depth}</span>}
          </div>
          <div className="setup-section">
            <label htmlFor="setup-height">Height (ft)</label>
            <input
              id="setup-height"
              type="number"
              value={heightFt}
              min={7} max={20} step={0.5}
              onChange={e => { setHeightFt(e.target.value); setErrors(prev => { const { height, ...rest } = prev; return rest }) }}
              aria-invalid={!!errors.height}
              aria-describedby={errors.height ? 'err-height' : undefined}
            />
            {errors.height && <span id="err-height" className="setup-error" role="alert">{errors.height}</span>}
          </div>
        </div>
        <p className="setup-hint">All walls and dimensions are fully editable after setup.</p>

        <button className="setup-btn" onClick={handleStart}>Start Design →</button>

        {/* Show uninstall link only in Electron */}
        {(window as any).launcher && (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <a
              onClick={() => (window as any).launcher.uninstall()}
              style={{ color: '#555', fontSize: 11, cursor: 'pointer', textDecoration: 'none' }}
            >Uninstall</a>
          </div>
        )}
      </div>

      <div className="setup-right-col">
        <aside className="setup-patchnotes" aria-label="Release notes">
          <div className="patchnotes-header">
            <span className="patchnotes-title">Patch Notes</span>
            <span className="patchnotes-version">v{__APP_VERSION__}</span>
          </div>
          <div className="patchnotes-body">
            {PATCH_NOTES.slice(0, 5).map(rel => (
              <div key={rel.version} className="patchnotes-release">
                <div className="patchnotes-release-head">
                  <span className="patchnotes-release-ver">v{rel.version}</span>
                  <span className="patchnotes-release-date">{rel.date}</span>
                </div>
                <ul>
                  {rel.items.map((it, i) => <li key={i}>{it}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </aside>
        <section className="setup-feedback" aria-label="Send feedback">
          <div className="feedback-title">Send Feedback</div>
          <div className="feedback-sub">Report a bug or request a feature.</div>
          <select
            className="feedback-type"
            value={fbType}
            onChange={e => setFbType(e.target.value as 'bug' | 'feature')}
            aria-label="Feedback type"
          >
            <option value="bug">🐞 Bug Report</option>
            <option value="feature">✨ Feature Request</option>
          </select>
          <textarea
            className="feedback-textarea"
            value={fbText}
            onChange={e => setFbText(e.target.value)}
            placeholder="Describe the issue or idea in as much detail as you'd like…"
            aria-label="Feedback message"
          />
          <button
            className="feedback-submit"
            onClick={submitFeedback}
            disabled={!fbText.trim() || fbSubmitting}
          >
            {fbSubmitting ? 'Sending…' : 'Submit'}
          </button>
          {fbStatus && (
            <div className={`feedback-status ${fbStatus.kind}`} role="status">
              {fbStatus.msg}
            </div>
          )}
        </section>
      </div>
      </div>
    </div>
  )
}
