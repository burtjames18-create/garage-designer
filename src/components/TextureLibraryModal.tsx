// Texture Library modal — drop images or AmbientCG-style zip packs to import.
import { useRef, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { unzip } from 'fflate'
import { useGarageStore } from '../store/garageStore'
import type { ImportedAsset } from '../store/garageStore'
import { isTextureFile, readTextureFile, TEXTURE_EXTENSIONS } from '../utils/modelConverter'
import { showToast } from './Toast'
import './ImportModelModal.css'

// PBR map classification — AmbientCG / PolyHaven / Sketchfab texture packs
// commonly include 5-10 maps per material. We surface each one as its own
// importable texture so the user can pick which flavor they want (color for a
// solid look, normal for bumped detail, etc.). Non-raster files like
// .blend/.mtlx/.tres/.usdc inside the archive are silently ignored — they're
// metadata/engine-specific and don't render.
type MapKind = 'color' | 'normal' | 'roughness' | 'metalness' | 'ao' | 'displacement' | 'opacity' | 'emissive' | 'other'

const MAP_PATTERNS: { kind: MapKind; rx: RegExp; label: string }[] = [
  { kind: 'color',        rx: /(_|-| )(color|diffuse|albedo|basecolor)\b/i,       label: 'Color' },
  { kind: 'normal',       rx: /(_|-| )(normal|nrm|normalgl|normaldx)\b/i,         label: 'Normal' },
  { kind: 'roughness',    rx: /(_|-| )(rough|roughness)\b/i,                      label: 'Roughness' },
  { kind: 'metalness',    rx: /(_|-| )(metal|metallic|metalness)\b/i,             label: 'Metalness' },
  { kind: 'ao',           rx: /(_|-| )(ao|ambientocclusion|occlusion)\b/i,        label: 'AO' },
  { kind: 'displacement', rx: /(_|-| )(disp|displacement|height|bump)\b/i,        label: 'Displacement' },
  { kind: 'opacity',      rx: /(_|-| )(alpha|opacity|mask)\b/i,                   label: 'Opacity' },
  { kind: 'emissive',     rx: /(_|-| )(emiss|emission|emissive)\b/i,              label: 'Emissive' },
]

function isImageFilename(name: string) {
  return TEXTURE_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext))
}

function classifyMap(name: string): { kind: MapKind; label: string } {
  const leaf = name.split('/').pop() ?? name
  for (const p of MAP_PATTERNS) {
    if (p.rx.test(leaf)) return { kind: p.kind, label: p.label }
  }
  return { kind: 'other', label: 'Image' }
}

function mimeFromName(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png')  return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif')  return 'image/gif'
  if (ext === 'bmp')  return 'image/bmp'
  return 'application/octet-stream'
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Copy into a fresh ArrayBuffer to satisfy TS's BlobPart narrowing
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const blob = new Blob([ab as ArrayBuffer], { type: mime })
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function unzipFile(file: File): Promise<Record<string, Uint8Array>> {
  return new Promise(async (resolve, reject) => {
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      unzip(buf, (err, data) => {
        if (err) reject(err)
        else resolve(data)
      })
    } catch (err) {
      reject(err)
    }
  })
}

interface Props {
  onClose: () => void
}

/** All imported textures are usable across walls, flooring, baseboards, and
 *  shapes. Wall/floor/generic distinction is kept on each asset for history
 *  compatibility but every picker surfaces all of them.
 */
const TEXTURE_TYPES = new Set(['wall-texture', 'floor-texture', 'texture'])

export default function TextureLibraryModal({ onClose }: Props) {
  const { importedAssets, addImportedAsset, deleteImportedAsset } = useGarageStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [loading, setLoading] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // Draggable modal position
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  useEffect(() => {
    const el = modalRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setPos({
      x: Math.round((window.innerWidth - rect.width) / 2),
      y: Math.round((window.innerHeight - rect.height) / 2),
    })
  }, [])

  const onHeaderPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.import-close')) return
    e.preventDefault()
    const el = modalRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragging.current = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }, [])

  const onHeaderPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragging.current
    if (!d) return
    setPos({
      x: d.origX + (e.clientX - d.startX),
      y: d.origY + (e.clientY - d.startY),
    })
  }, [])

  const onHeaderPointerUp = useCallback(() => { dragging.current = null }, [])

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const all = Array.from(files)
    const images = all.filter(f => isTextureFile(f.name))
    const zips = all.filter(f => f.name.toLowerCase().endsWith('.zip'))
    if (images.length === 0 && zips.length === 0) {
      showToast(`No valid texture or zip files. Accepted: ${TEXTURE_EXTENSIONS.join(', ')}, .zip`, 'error')
      return
    }
    setLoading(true)
    let importedCount = 0
    try {
      const { saveTextureToDB } = await import('../utils/textureLibrary')
      // Plain image files
      for (const file of images) {
        const dataUrl = await readTextureFile(file)
        const asset = {
          id: crypto.randomUUID(),
          name: file.name,
          assetType: 'texture' as const,
          data: dataUrl,
        }
        addImportedAsset(asset)
        saveTextureToDB(asset).catch(err => console.warn('Persist failed:', err))
        importedCount++
      }
      // Zip archives (AmbientCG / PolyHaven / Sketchfab PBR packs) — classify
      // every raster image by map type (Color / Normal / Rough / Metal / AO /
      // Disp) and build a SINGLE library entry combining all of them into one
      // PBR material. Non-raster files (.blend, .mtlx, .tres, .usdc, .usd,
      // .fbx, preview pngs) are silently skipped.
      for (const zip of zips) {
        const entries = await unzipFile(zip)
        const names = Object.keys(entries).filter(n => !n.endsWith('/'))
        const imgs = names.filter(isImageFilename)
        if (imgs.length === 0) {
          showToast(`No images found in ${zip.name}`, 'error')
          continue
        }
        const baseLabel = zip.name.replace(/\.zip$/i, '').split(/[\\/]/).pop() || zip.name

        // Bucket images by kind. For duplicates (e.g. NormalDX and NormalGL),
        // prefer the first one sorted alphabetically — NormalDX wins over GL
        // which matches three.js's expected convention for most cases.
        const buckets: Partial<Record<MapKind, string>> = {}
        const sortedImgs = [...imgs].sort()
        for (const imgPath of sortedImgs) {
          const { kind } = classifyMap(imgPath)
          if (!buckets[kind]) buckets[kind] = imgPath
        }

        // Need at least one image to build an asset. Prefer color; otherwise
        // fall back to whatever raster we found first.
        const colorPath = buckets.color ?? sortedImgs[0]
        const colorBytes = entries[colorPath]
        const colorUrl = await bytesToDataUrl(colorBytes, mimeFromName(colorPath))

        // Helper to read a sidecar map if present
        const readMap = async (kind: MapKind): Promise<string | undefined> => {
          const p = buckets[kind]
          if (!p) return undefined
          return bytesToDataUrl(entries[p], mimeFromName(p))
        }

        const normalUrl       = await readMap('normal')
        const roughnessUrl    = await readMap('roughness')
        const metalnessUrl    = await readMap('metalness')
        const aoUrl           = await readMap('ao')
        const displacementUrl = await readMap('displacement')

        const asset = {
          id: crypto.randomUUID(),
          name: baseLabel,
          assetType: 'texture' as const,
          data: colorUrl,
          normalMap:       normalUrl,
          roughnessMap:    roughnessUrl,
          metalnessMap:    metalnessUrl,
          aoMap:           aoUrl,
          displacementMap: displacementUrl,
        }
        addImportedAsset(asset)
        saveTextureToDB(asset).catch(err => console.warn('Persist failed:', err))
        importedCount++
      }
      if (importedCount > 0) {
        showToast(`Imported ${importedCount} texture${importedCount > 1 ? 's' : ''}`, 'success')
      }
    } catch (err: any) {
      console.error('Texture import error:', err)
      showToast(`Failed to import: ${err.message || 'Unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [addImportedAsset])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) processFiles(e.target.files)
    e.target.value = ''
  }, [processFiles])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) processFiles(e.dataTransfer.files)
  }, [processFiles])

  const textures = importedAssets.filter((a: ImportedAsset) => TEXTURE_TYPES.has(a.assetType))
  const acceptStr = [
    ...TEXTURE_EXTENSIONS.map(e => e + ',image/' + e.slice(1)),
    '.zip,application/zip,application/x-zip-compressed',
  ].join(',')

  const modalStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 }
    : {}

  return createPortal(
    <div className="import-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="import-modal"
        style={{ ...modalStyle, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="import-header"
          style={{ cursor: 'grab' }}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
        >
          <h2>Texture Library</h2>
          <button className="import-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>

        {/* Source hint — where to grab free high-quality textures */}
        <div className="import-section" style={{ paddingTop: 4, paddingBottom: 4 }}>
          <div style={{ fontSize: 11, color: '#aaa', lineHeight: 1.4 }}>
            Need textures? Download free PBR materials from{' '}
            <a
              href="https://ambientcg.com/list?type=material%2Cdecal%2Catlas&sort=popular"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#4a94ff', textDecoration: 'none', fontWeight: 600 }}
              onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
              onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
            >
              AmbientCG
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 3, verticalAlign: '-1px' }}>
                <path d="M7 17L17 7" /><path d="M8 7h9v9" />
              </svg>
            </a>
            {' '}— then drop the image files below.
          </div>
        </div>

        {/* Upload zone */}
        <div className="import-section">
          <div
            className={`import-dropzone${dragOver ? ' drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            style={{ cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="9" cy="9" r="2" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600 }}>
              {loading ? 'Importing…' : 'Drop images here or click to browse'}
            </div>
            <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>
              PNG, JPG, WebP, or .zip · multiple files supported
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptStr}
            multiple
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
        </div>

        {/* Library grid */}
        <div className="import-section" style={{ overflowY: 'auto', flex: 1 }}>
          <label className="import-label" style={{ marginBottom: 8 }}>
            Library ({textures.length} texture{textures.length === 1 ? '' : 's'})
          </label>
          {textures.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: '#888', fontSize: 11 }}>
              No imported textures yet. Add some above — they'll appear in the Walls, Flooring, Shapes, and Baseboard pickers.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
                gap: 8,
              }}
            >
              {textures.map(t => (
                <div key={t.id} className="texture-lib-item" style={{ position: 'relative' }}>
                  <div
                    style={{
                      width: '100%',
                      aspectRatio: '1 / 1',
                      borderRadius: 6,
                      border: '1px solid rgba(255,255,255,0.12)',
                      backgroundImage: `url(${t.data})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  />
                  <div
                    style={{
                      marginTop: 4,
                      fontSize: 10,
                      lineHeight: 1.2,
                      color: '#ccc',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={t.name}
                  >
                    {t.name.replace(/\.[^.]+$/, '')}
                  </div>
                  {confirmDeleteId === t.id ? (
                    <div
                      style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(20,22,26,0.9)',
                        borderRadius: 6,
                        display: 'flex', flexDirection: 'column',
                        alignItems: 'center', justifyContent: 'center',
                        gap: 6, padding: 6, textAlign: 'center',
                      }}
                    >
                      <div style={{ fontSize: 10, color: '#fff' }}>Delete?</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          onClick={() => {
                            deleteImportedAsset(t.id)
                            import('../utils/textureLibrary').then(m => m.deleteTextureFromDB(t.id).catch(() => {}))
                            setConfirmDeleteId(null)
                            showToast('Texture deleted', 'success')
                          }}
                          style={{
                            background: '#c84a3a', color: '#fff', border: 0,
                            borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                          }}
                        >Yes</button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          style={{
                            background: 'rgba(255,255,255,0.1)', color: '#fff', border: 0,
                            borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                          }}
                        >No</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(t.id)}
                      aria-label={`Delete ${t.name}`}
                      title="Delete texture"
                      style={{
                        position: 'absolute', top: 4, right: 4,
                        width: 20, height: 20, borderRadius: 10,
                        background: 'rgba(20,22,26,0.75)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 0,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
