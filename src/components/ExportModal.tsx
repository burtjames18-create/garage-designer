import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useGarageStore } from '../store/garageStore'
import type { GarageWall, PlacedCabinet, Countertop } from '../store/garageStore'
import { exportCaptureRef } from '../utils/exportCapture'
import WallElevationBlueprint from './WallElevationBlueprint'
import FloorPlanBlueprint from './FloorPlanBlueprint'
import { IconDelete, IconPrint, IconDownload } from './Icons'
import './ExportModal.css'

interface ExportModalProps {
  onClose: () => void
}

// ── Geometry helpers (to detect which walls have content) ────────────────────
function wallLen(w: GarageWall) { return Math.hypot(w.x2 - w.x1, w.z2 - w.z1) }
function wallDir(w: GarageWall): [number, number] {
  const l = wallLen(w); if (l < 0.01) return [1, 0]
  return [(w.x2 - w.x1) / l, (w.z2 - w.z1) / l]
}
function cabinetOnWall(cab: PlacedCabinet, w: GarageWall) {
  const len = wallLen(w)
  const [dx, dz] = wallDir(w)
  const vx = cab.x - w.x1, vz = cab.z - w.z1
  const along = vx * dx + vz * dz
  const perp = Math.abs(vx * (-dz) + vz * dx)
  if (perp > cab.d / 2 + w.thickness / 2 + 10) return false
  if (along <= -cab.w / 2 || along >= len + cab.w / 2) return false
  // Cabinet must face this wall (within 45°) — prevents corner bleed
  const expectedRotY = Math.atan2(-dz, dx)
  let diff = Math.abs(cab.rotY - expectedRotY) % (Math.PI * 2)
  if (diff > Math.PI) diff = Math.PI * 2 - diff
  return diff < Math.PI / 4
}
function countertopOnWall(ct: Countertop, w: GarageWall) {
  const len = wallLen(w)
  const [dx, dz] = wallDir(w)
  const vx = ct.x - w.x1, vz = ct.z - w.z1
  const along = vx * dx + vz * dz
  const perp = Math.abs(vx * (-dz) + vz * dx)
  return perp <= 25 / 2 + w.thickness / 2 + 10 && along > -ct.width / 2 && along < len + ct.width / 2
}

export default function ExportModal({ onClose }: ExportModalProps) {
  const { customerName, siteAddress, consultantName,
    walls, slatwallPanels, cabinets, countertops, floorPoints, floorSteps,
    overheadRacks, exportShots } = useGarageStore()
  const [captures, setCaptures] = useState<string[]>([])
  const [status, setStatus] = useState<'capturing' | 'ready' | 'no-shots'>('capturing')
  const [progress, setProgress] = useState(0)
  const logoRef = useRef<HTMLImageElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit',
  })

  // Walls that have at least one cabinet, slatwall panel, or countertop placed
  const activeWalls = walls.filter(w =>
    slatwallPanels.some(p => p.wallId === w.id) ||
    cabinets.some(c => cabinetOnWall(c, w)) ||
    countertops.some(ct => countertopOnWall(ct, w))
  )

  // Focus trap + Escape to close
  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement
    modalRef.current?.focus()

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }

      // Trap tab focus within modal
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('keydown', handleKey)
      previousFocus.current?.focus()
    }
  }, [onClose])

  useEffect(() => {
    if (exportShots.length === 0) {
      setStatus('no-shots')
      return
    }

    let cancelled = false
    async function run() {
      if (!exportCaptureRef.capture) {
        setStatus('ready')
        return
      }
      try {
        setProgress(0)
        const result = await exportCaptureRef.capture(exportShots, (step: number) => {
          if (!cancelled) setProgress(step)
        })
        if (!cancelled) {
          setCaptures(result)
          setStatus('ready')
        }
      } catch (e) {
        console.error('Export capture failed:', e)
        if (!cancelled) setStatus('ready')
      }
    }
    run()
    return () => { cancelled = true }
  }, [exportShots])

  const handlePrint = () => {
    // Open a dedicated print window with just the export content.
    // This avoids CSS conflicts with the app's DOM tree.
    const printWin = window.open('', '_blank', 'width=1100,height=800')
    if (!printWin) return

    const logoUrl = `${window.location.origin}${import.meta.env.BASE_URL}assets/gl-logo.png.webp`

    const footerHtml = `
      <div class="footer">
        <div class="footer-logo"><img src="${logoUrl}" alt="Garage Living" onerror="this.style.display='none'" /></div>
        <div class="footer-fields">
          <div class="footer-field" style="border-right:1px solid #333;border-bottom:1px solid #333">
            <span class="footer-label">Customer Name</span>
            <span class="footer-value">${customerName || '—'}</span>
          </div>
          <div class="footer-field" style="border-bottom:1px solid #333">
            <span class="footer-label">Site Address</span>
            <span class="footer-value">${siteAddress || '—'}</span>
          </div>
          <div class="footer-field" style="border-right:1px solid #333">
            <span class="footer-label">Design Consultant</span>
            <span class="footer-value">${consultantName || 'Garage Living'}</span>
          </div>
          <div class="footer-field">
            <span class="footer-label">Date</span>
            <span class="footer-value">${today}</span>
          </div>
        </div>
      </div>
    `

    // Build render pages
    const renderPages = captures.map((src, i) => `
      <div class="page">
        <div class="page-image-wrap">
          <img src="${src}" class="page-image" />
        </div>
        ${footerHtml}
      </div>
    `).join('')

    // Grab blueprint SVGs from the modal DOM
    const blueprintEls = document.querySelectorAll('#export-pages .export-page-blueprint')
    const blueprintPages = Array.from(blueprintEls).map(el => {
      const svgWrap = el.querySelector('.export-page-svg-wrap')
      const svgHtml = svgWrap?.innerHTML || ''
      return `
        <div class="page">
          <div class="page-svg-wrap">${svgHtml}</div>
          ${footerHtml}
        </div>
      `
    }).join('')

    printWin.document.write(`<!DOCTYPE html>
<html><head><title>${customerName || 'Garage'} — Export</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'DM Sans', Arial, sans-serif; }
  .page {
    width: 100%;
    height: 100vh;
    display: flex;
    flex-direction: column;
    page-break-after: always;
    break-after: page;
  }
  .page:last-child { page-break-after: auto; }
  .page-image-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
    padding: 8px;
  }
  .page-image {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  .page-svg-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 8px;
    min-height: 0;
  }
  .page-svg-wrap svg {
    max-width: 100%;
    max-height: 100%;
  }
  .footer {
    display: flex;
    align-items: stretch;
    border: 1px solid #333;
    margin: 8px 20px 12px;
    flex-shrink: 0;
  }
  .footer-logo {
    width: 160px;
    flex-shrink: 0;
    border-right: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 10px 14px;
  }
  .footer-logo img { max-width: 100%; max-height: 56px; object-fit: contain; }
  .footer-fields {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
  }
  .footer-field {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 6px 16px;
    gap: 2px;
  }
  .footer-label { font-size: 10px; color: #444; }
  .footer-value { font-size: 16px; font-weight: 700; color: #111; }
</style>
</head><body>${renderPages}${blueprintPages}</body></html>`)
    printWin.document.close()

    // Wait for images to load then print
    printWin.onload = () => {
      setTimeout(() => {
        printWin.print()
        printWin.close()
      }, 500)
    }
  }

  const handleDownload = (dataUrl: string, label: string) => {
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${customerName || 'Garage'} — ${label}.jpg`
    a.click()
  }

  const Footer = () => (
    <div className="export-footer">
      <div className="export-footer-logo">
        <img
          ref={logoRef}
          src={`${import.meta.env.BASE_URL}assets/gl-logo.png.webp`}
          alt="Garage Living"
          onError={() => {
            if (logoRef.current) logoRef.current.style.display = 'none'
          }}
        />
      </div>
      <div className="export-footer-fields">
        <div className="export-footer-field">
          <span className="export-footer-label">Customer Name</span>
          <span className="export-footer-value">{customerName || '—'}</span>
        </div>
        <div className="export-footer-field">
          <span className="export-footer-label">Site Address</span>
          <span className="export-footer-value">{siteAddress || '—'}</span>
        </div>
        <div className="export-footer-field">
          <span className="export-footer-label">Design Consultant</span>
          <span className="export-footer-value">{consultantName || 'Garage Living'}</span>
        </div>
        <div className="export-footer-field">
          <span className="export-footer-label">Date</span>
          <span className="export-footer-value">{today}</span>
        </div>
      </div>
    </div>
  )

  return createPortal(
    <div className="export-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}
      role="dialog" aria-modal="true" aria-label="Export renderings">
      <div className="export-modal" ref={modalRef} tabIndex={-1}>

        <div className="export-modal-header">
          <h2>Export Renderings</h2>
          <div className="export-header-actions">
            <button className="export-print-btn" onClick={handlePrint}
              disabled={status !== 'ready' || captures.length === 0}
              aria-label="Print or save as PDF">
              <IconPrint size={13} /> Print / Save PDF
            </button>
            <button className="export-close-btn" onClick={onClose} aria-label="Close export modal">
              <IconDelete size={12} />
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="export-pages" id="export-pages">

          {status === 'no-shots' && (
            <div className="export-capturing" role="alert">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <p>No export shots saved yet.</p>
              <p style={{ fontSize: 12, opacity: 0.5, marginTop: -8 }}>
                Navigate to the angle you want in the 3D view, then click <strong>Save Shot</strong> (bottom-left).
                <br />Save as many angles as you need, then come back here to export.
              </p>
            </div>
          )}

          {status === 'capturing' && (
            <div className="export-capturing" role="status" aria-live="polite">
              <div className="export-spinner" aria-hidden="true" />
              <p>Rendering shot {progress + 1} of {exportShots.length}…</p>
              <p style={{ fontSize: 11, opacity: 0.4, marginTop: -8 }}>High-resolution capture in progress</p>
            </div>
          )}

          {status === 'ready' && captures.length === 0 && exportShots.length > 0 && (
            <div className="export-capturing" role="alert">
              <p style={{ color: '#f88' }}>Capture failed. Make sure the 3D view is loaded.</p>
            </div>
          )}

          {/* ── 3D render pages (user's saved shots) ── */}
          {captures.map((src, i) => (
            <div key={i} className="export-page">
              <div className="export-page-image-wrap">
                <img src={src} alt={exportShots[i]?.label || `Shot ${i + 1}`} className="export-page-image" />
              </div>
              <Footer />
              <button
                className="export-dl-btn no-print"
                onClick={() => handleDownload(src, exportShots[i]?.label || `Shot ${i + 1}`)}
                aria-label={`Download ${exportShots[i]?.label || `Shot ${i + 1}`}`}
              >
                <IconDownload size={12} /> Download {exportShots[i]?.label || `Shot ${i + 1}`}
              </button>
            </div>
          ))}

          {/* ── Floor plan blueprint page ── */}
          {(status === 'ready' && captures.length > 0) && (
            <div className="export-page-blueprint">
              <div className="export-page-bp-header">Floor Plan — Dimensions</div>
              <div className="export-page-svg-wrap">
                <FloorPlanBlueprint
                  walls={walls}
                  cabinets={cabinets}
                  countertops={countertops}
                  floorPoints={floorPoints}
                  floorSteps={floorSteps}
                  slatwallPanels={slatwallPanels}
                  overheadRacks={overheadRacks}
                />
              </div>
              <Footer />
            </div>
          )}

          {/* ── Wall elevation blueprint pages (one per active wall) ── */}
          {(status === 'ready' && captures.length > 0) && activeWalls.map(w => (
            <div key={w.id} className="export-page-blueprint">
              <div className="export-page-bp-header">{w.label} — Elevation</div>
              <div className="export-page-svg-wrap">
                <WallElevationBlueprint
                  wall={w}
                  slatwallPanels={slatwallPanels}
                  cabinets={cabinets}
                  countertops={countertops}
                  allWalls={walls}
                  floorSteps={floorSteps}
                />
              </div>
              <Footer />
            </div>
          ))}

        </div>

      </div>
    </div>,
    document.body
  )
}
