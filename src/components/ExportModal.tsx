import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import jsPDF from 'jspdf'
import { useGarageStore } from '../store/garageStore'
import type { GarageWall, PlacedCabinet, Countertop } from '../store/garageStore'
import { exportCaptureRef } from '../utils/exportCapture'
import WallElevationBlueprint from './WallElevationBlueprint'
import FloorPlanBlueprint from './FloorPlanBlueprint'
import { IconDelete, IconDownload } from './Icons'
import './ExportModal.css'

// ── PDF helpers ──────────────────────────────────────────────────────────────
// Rasterize an <img> or data URL source to a PNG data URL at a target width.
// Used to convert the .webp logo into a jsPDF-compatible PNG (jsPDF has no
// native webp support) and to size it correctly for the footer.
function rasterizeImageToPng(src: string, targetWidthPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const aspect = img.naturalHeight / img.naturalWidth
      const w = Math.max(1, Math.round(targetWidthPx))
      const h = Math.max(1, Math.round(targetWidthPx * aspect))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('no 2d context')); return }
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('image load failed'))
    img.src = src
  })
}

// Rasterize a live <svg> DOM node to a PNG data URL at a target pixel width.
// We serialize the SVG (with a white background, in case it has none) and
// load it into an <img>, then draw to a canvas at the requested width. This
// bypasses the browser's print-path re-encoding entirely.
function rasterizeSvgToPng(svg: SVGSVGElement, targetWidthPx: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // Clone so we don't mutate the live DOM
    const clone = svg.cloneNode(true) as SVGSVGElement
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    // The SVG inherits font-family from page CSS when displayed in the modal,
    // but serializing it into an isolated <img> loses that context and the
    // browser falls back to Times. Inject the app's font stack explicitly so
    // dimension text renders with the same Segoe UI / sans-serif face as the
    // on-screen preview.
    clone.setAttribute(
      'font-family',
      "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    )
    // Determine intrinsic size from viewBox (SVGs here are viewBox-driven)
    const vb = clone.viewBox?.baseVal
    const vbW = vb && vb.width ? vb.width : (svg.clientWidth || 1000)
    const vbH = vb && vb.height ? vb.height : (svg.clientHeight || 1000)
    const aspect = vbH / vbW
    const w = Math.max(1, Math.round(targetWidthPx))
    const h = Math.max(1, Math.round(targetWidthPx * aspect))
    clone.setAttribute('width', String(w))
    clone.setAttribute('height', String(h))

    const xml = new XMLSerializer().serializeToString(clone)
    const svg64 = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('no 2d context')); return }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('svg rasterize failed'))
    img.src = svg64
  })
}

// Get the pixel dimensions of a PNG/JPEG data URL so we can preserve its
// aspect ratio when fitting into a PDF content box.
function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => reject(new Error('image size probe failed'))
    img.src = dataUrl
  })
}

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
    walls, slatwallPanels, stainlessBacksplashPanels, cabinets, countertops, floorPoints, floorSteps,
    overheadRacks, exportShots } = useGarageStore()
  const [captures, setCaptures] = useState<string[]>([])
  const [status, setStatus] = useState<'capturing' | 'ready' | 'no-shots'>('capturing')
  const [progress, setProgress] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const logoRef = useRef<HTMLImageElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const pagesRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const today = new Date().toLocaleDateString('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit',
  })

  // Walls that have at least one cabinet, slatwall panel, backsplash, or countertop placed
  const activeWalls = walls.filter(w =>
    slatwallPanels.some(p => p.wallId === w.id) ||
    stainlessBacksplashPanels.some(p => p.wallId === w.id) ||
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

  // Build a PDF entirely in-memory with jsPDF. 3D renders are embedded as
  // lossless PNG (compression: 'NONE'), which bypasses Chrome's print-to-PDF
  // re-encoding path that caused visible banding/rings on smooth spotlight
  // gradients. Blueprint SVGs are rasterized to high-DPI PNG and embedded
  // the same way.
  const handleDownloadPdf = async () => {
    if (downloading) return
    setDownloading(true)
    try {
      // US Letter landscape: 11 × 8.5 in = 792 × 612 pt
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
      const pageW = doc.internal.pageSize.getWidth()
      const pageH = doc.internal.pageSize.getHeight()

      // Layout (points)
      const marginX = 36
      const marginTop = 24
      const footerH = 72
      const footerGap = 12
      const contentTop = marginTop
      const contentBottom = pageH - marginX - footerH - footerGap
      const contentW = pageW - marginX * 2
      const contentH = contentBottom - contentTop

      // Preload the logo as PNG (jsPDF doesn't support webp)
      let logoPng: string | null = null
      let logoSize: { w: number; h: number } | null = null
      try {
        const logoUrl = `${import.meta.env.BASE_URL}assets/gl-logo.png.webp`
        logoPng = await rasterizeImageToPng(logoUrl, 400)
        logoSize = await imageSize(logoPng)
      } catch {
        // Logo optional — continue without it
      }

      // ── Footer drawing (jsPDF primitives — crisp vector text & lines) ──
      const drawFooter = () => {
        const fx = marginX
        const fy = pageH - marginX - footerH
        const fw = contentW
        const fh = footerH

        doc.setDrawColor(51)
        doc.setLineWidth(0.75)
        doc.rect(fx, fy, fw, fh)

        const logoBoxW = 160
        // Logo cell divider
        doc.line(fx + logoBoxW, fy, fx + logoBoxW, fy + fh)

        if (logoPng && logoSize) {
          const pad = 12
          const maxW = logoBoxW - pad * 2
          const maxH = fh - pad * 2
          const aspect = logoSize.h / logoSize.w
          let lw = maxW
          let lh = lw * aspect
          if (lh > maxH) { lh = maxH; lw = lh / aspect }
          const lx = fx + (logoBoxW - lw) / 2
          const ly = fy + (fh - lh) / 2
          doc.addImage(logoPng, 'PNG', lx, ly, lw, lh, undefined, 'NONE')
        }

        // Fields grid: 2 columns × 2 rows to the right of the logo
        const gx = fx + logoBoxW
        const gw = fw - logoBoxW
        const colW = gw / 2
        const rowH = fh / 2

        // Inner grid lines
        doc.line(gx + colW, fy, gx + colW, fy + fh)
        doc.line(gx, fy + rowH, gx + fw - logoBoxW, fy + rowH)

        const drawField = (col: number, row: number, label: string, value: string) => {
          const cx = gx + col * colW + 14
          const cy = fy + row * rowH
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.setTextColor(80)
          doc.text(label, cx, cy + rowH / 2 - 6)
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(13)
          doc.setTextColor(17)
          doc.text(value || '—', cx, cy + rowH / 2 + 12)
        }

        drawField(0, 0, 'Customer Name', customerName || '—')
        drawField(1, 0, 'Site Address', siteAddress || '—')
        drawField(0, 1, 'Design Consultant', consultantName || 'Garage Living')
        drawField(1, 1, 'Date', today)
      }

      // ── Fit an image into the content box, preserving aspect ──
      const drawContentImage = async (dataUrl: string) => {
        const { w: iw, h: ih } = await imageSize(dataUrl)
        const scale = Math.min(contentW / iw, contentH / ih)
        const w = iw * scale
        const h = ih * scale
        const x = marginX + (contentW - w) / 2
        const y = contentTop + (contentH - h) / 2
        // 'NONE' = no deflate, lossless embedding — the whole reason for this rewrite
        doc.addImage(dataUrl, 'PNG', x, y, w, h, undefined, 'NONE')
      }

      // ── 3D render pages ──
      for (let i = 0; i < captures.length; i++) {
        if (i > 0) doc.addPage()
        await drawContentImage(captures[i])
        drawFooter()
      }

      // ── Blueprint pages (rasterized from live SVG nodes in the modal) ──
      const blueprintEls = pagesRef.current?.querySelectorAll('.export-page-blueprint') ?? []
      for (const el of Array.from(blueprintEls)) {
        const svg = el.querySelector('svg') as SVGSVGElement | null
        if (!svg) continue
        // 2400px wide gives ~216 DPI on an 11" page — plenty for crisp lines
        const png = await rasterizeSvgToPng(svg, 2400)
        doc.addPage()
        await drawContentImage(png)
        drawFooter()
      }

      const filename = `${customerName || 'Garage'} — Export.pdf`
      doc.save(filename)
    } catch (e) {
      console.error('PDF export failed:', e)
      alert('PDF export failed. Check the console for details.')
    } finally {
      setDownloading(false)
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
            <button className="export-print-btn" onClick={handleDownloadPdf}
              disabled={status !== 'ready' || captures.length === 0 || downloading}
              aria-label="Download PDF">
              <IconDownload size={13} /> {downloading ? 'Building PDF…' : 'Download PDF'}
            </button>
            <button className="export-close-btn" onClick={onClose} aria-label="Close export modal">
              <IconDelete size={12} />
            </button>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="export-pages" id="export-pages" ref={pagesRef}>

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
                  stainlessBacksplashPanels={stainlessBacksplashPanels}
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
                  stainlessBacksplashPanels={stainlessBacksplashPanels}
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
