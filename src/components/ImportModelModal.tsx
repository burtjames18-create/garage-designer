import { useRef, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useGarageStore } from '../store/garageStore'
import type { ImportAssetType } from '../store/garageStore'
import {
  isModelFile, isTextureFile, loadModelFile,
  centerModel, readTextureFile,
  MODEL_EXTENSIONS, TEXTURE_EXTENSIONS,
} from '../utils/modelConverter'
import { optimizeAndExportGLB } from '../utils/modelOptimizer'
import { cacheModelBuffer } from '../utils/importedModelCache'
import { addLibraryModel } from '../utils/modelLibrary'
import { showToast } from './Toast'
import './ImportModelModal.css'

interface Props {
  onClose: () => void
}

const ASSET_TYPES: { key: ImportAssetType; label: string; desc: string; accepts: 'model' | 'texture' }[] = [
  { key: '3d-model',      label: '3D Model',      desc: 'Place as a 3D object in the scene (vehicle, furniture, equipment)', accepts: 'model' },
  { key: 'wall-texture',  label: 'Wall Texture',   desc: 'Apply as a wall surface material', accepts: 'texture' },
  { key: 'floor-texture', label: 'Floor Texture',   desc: 'Apply as a floor surface material', accepts: 'texture' },
]

export default function ImportModelModal({ onClose }: Props) {
  const { addImportedAsset, addItem } = useGarageStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)
  const [assetType, setAssetType] = useState<ImportAssetType>('3d-model')
  const [modelCategory, setModelCategory] = useState<'car' | 'motorcycle' | 'equipment' | 'furniture'>('car')
  const [modelLabel, setModelLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('Converting...')
  const [dragOver, setDragOver] = useState(false)

  // Draggable modal position
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragging = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)

  // Center on mount
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

  const onHeaderPointerUp = useCallback(() => {
    dragging.current = null
  }, [])

  const selectedType = ASSET_TYPES.find(t => t.key === assetType)!
  const acceptsModel = selectedType.accepts === 'model'
  const acceptStr = acceptsModel
    ? MODEL_EXTENSIONS.join(',')
    : TEXTURE_EXTENSIONS.map(e => e + ',image/' + e.slice(1)).join(',')

  const processFile = useCallback(async (file: File) => {
    const isModel = isModelFile(file.name)
    const isTexture = isTextureFile(file.name)

    if (acceptsModel && !isModel) {
      showToast(`Invalid file type for 3D model. Accepted: ${MODEL_EXTENSIONS.join(', ')}`, 'error')
      return
    }
    if (!acceptsModel && !isTexture) {
      showToast(`Invalid file type for texture. Accepted: ${TEXTURE_EXTENSIONS.join(', ')}`, 'error')
      return
    }

    setLoading(true)
    setLoadingMsg('Loading...')
    try {
      if (isModel) {
        const assetId = crypto.randomUUID()
        const fileType = file.name.toLowerCase().split('.').pop()
        const isGLB = fileType === 'glb' || fileType === 'gltf'

        let finalBuffer: ArrayBuffer

        if (isGLB) {
          // GLB/GLTF: use the original file directly — preserves all textures & materials
          finalBuffer = await file.arrayBuffer()
          cacheModelBuffer(assetId, finalBuffer)
        } else {
          // OBJ/FBX/STL: must convert to GLB, then optimize
          const scene = await loadModelFile(file)
          centerModel(scene)
          setLoadingMsg('Optimizing...')
          const { buffer } = await optimizeAndExportGLB(scene)
          finalBuffer = buffer
          cacheModelBuffer(assetId, finalBuffer)
        }

        const sizeMB = (finalBuffer.byteLength / 1024 / 1024).toFixed(1)
        const label = modelLabel.trim() || file.name.replace(/\.[^.]+$/, '')

        // Save to permanent app-wide model library (survives across projects)
        addLibraryModel({ id: assetId, name: file.name, label, category: modelCategory })

        // Also place in current scene
        addItem({
          id: crypto.randomUUID(),
          type: `imported:${assetId}`,
          label,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1],
        })

        showToast(`Added "${label}" to model library (${sizeMB}MB)`, 'success')
      } else {
        // Texture file — read as data URL and store
        const dataUrl = await readTextureFile(file)
        const assetId = crypto.randomUUID()
        const asset = {
          id: assetId,
          name: file.name,
          assetType: assetType as ImportAssetType,
          data: dataUrl,
        }
        addImportedAsset(asset)
        // Persist to IndexedDB so it survives across app sessions
        const { saveTextureToDB } = await import('../utils/textureLibrary')
        saveTextureToDB(asset).catch(err => console.warn('Texture persist failed:', err))
        showToast(`Imported texture "${file.name}" — available in ${assetType === 'wall-texture' ? 'Wall' : 'Flooring'} panel`, 'success')
      }

      onClose()
    } catch (err: any) {
      console.error('Import error:', err)
      showToast(`Failed to import: ${err.message || 'Unknown error'}`, 'error')
    } finally {
      setLoading(false)
    }
  }, [acceptsModel, assetType, addImportedAsset, addItem, onClose])

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }, [processFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const modalStyle: React.CSSProperties = pos
    ? { position: 'fixed', left: pos.x, top: pos.y, margin: 0 }
    : {}

  return createPortal(
    <div className="import-overlay" onClick={onClose}>
      <div ref={modalRef} className="import-modal" style={modalStyle} onClick={e => e.stopPropagation()}>
        <div
          className="import-header"
          style={{ cursor: 'grab' }}
          onPointerDown={onHeaderPointerDown}
          onPointerMove={onHeaderPointerMove}
          onPointerUp={onHeaderPointerUp}
        >
          <h2>Import Asset</h2>
          <button className="import-close" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>
            </svg>
          </button>
        </div>

        <a
          href="https://sketchfab.com/3d-models/categories/cars-vehicles?date=week&features=downloadable&sort_by=-likeCount"
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: 'block', padding: '8px 16px', fontSize: 13, color: '#6cb4ee', textAlign: 'center' }}
        >
          Browse models on Sketchfab →
        </a>

        {/* Asset type selector */}
        <div className="import-section">
          <label className="import-label">Asset Type</label>
          <div className="import-type-grid">
            {ASSET_TYPES.map(t => (
              <button
                key={t.key}
                className={`import-type-btn ${assetType === t.key ? 'active' : ''}`}
                onClick={() => setAssetType(t.key)}
              >
                <span className="import-type-name">{t.label}</span>
                <span className="import-type-desc">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Model options — only for 3D models */}
        {acceptsModel && (
          <div className="import-section">
            <label className="import-label">Category</label>
            <div className="import-cat-row">
              {([
                { key: 'car', label: 'Cars' },
                { key: 'motorcycle', label: 'Motorcycles' },
                { key: 'equipment', label: 'Equipment' },
                { key: 'furniture', label: 'Furniture' },
              ] as const).map(c => (
                <button
                  key={c.key}
                  className={`import-cat-btn ${modelCategory === c.key ? 'active' : ''}`}
                  onClick={() => setModelCategory(c.key)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <label className="import-label" style={{ marginTop: 10 }}>Display Name (optional)</label>
            <input
              className="import-name-input"
              type="text"
              placeholder="e.g. Porsche 911 GT3"
              value={modelLabel}
              onChange={e => setModelLabel(e.target.value)}
            />
          </div>
        )}

        {/* Accepted formats */}
        <div className="import-section">
          <label className="import-label">Accepted Formats</label>
          <div className="import-formats">
            {(acceptsModel ? MODEL_EXTENSIONS : TEXTURE_EXTENSIONS).map(ext => (
              <span key={ext} className="import-format-tag">{ext.toUpperCase()}</span>
            ))}
          </div>
        </div>

        {/* Drop zone / file picker */}
        <div
          className={`import-dropzone ${dragOver ? 'drag-over' : ''} ${loading ? 'loading' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !loading && fileInputRef.current?.click()}
        >
          {loading ? (
            <div className="import-loading">
              <div className="import-spinner" />
              <span>{loadingMsg}</span>
            </div>
          ) : (
            <>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span className="import-drop-text">
                Drag & drop a file here, or <strong>click to browse</strong>
              </span>
            </>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={acceptStr}
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />
      </div>
    </div>,
    document.body
  )
}
