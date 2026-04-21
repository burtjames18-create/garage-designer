import { useRef } from 'react'
import { useGarageStore } from '../store/garageStore'
import type { TracingImage } from '../store/garageStore'
import { IconDelete, IconLocked, IconUnlocked } from './Icons'

/** Sidebar controls for the floor-plan tracing reference image. Allows the
 *  user to upload a photo or blueprint, adjust opacity, lock its position,
 *  and remove it. The image itself renders in the 2D floor plan view; these
 *  controls just drive its state.
 *
 *  Image is stored as a base64 data URL on the project — it saves with the
 *  `.garage` file and appears only in the interactive floor plan, never in
 *  the exported PDF. */
export default function TracingImageControls() {
  const { tracingImage, setTracingImage, updateTracingImage, garageWidth } = useGarageStore()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (file: File) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    // Read natural dimensions so we can preserve aspect ratio when sizing.
    const { w, h } = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
      img.onerror = reject
      img.src = dataUrl
    })
    // Default to the garage width so the image lands at roughly the right scale.
    // The user can resize from there by dragging the corner handle.
    const widthIn = garageWidth
    const heightIn = widthIn * (h / w)
    const img: TracingImage = {
      id: crypto.randomUUID(),
      dataUrl,
      x: 0,
      z: 0,
      widthIn,
      heightIn,
      opacity: 0.5,
      locked: false,
    }
    setTracingImage(img)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleUpload(f)
    e.target.value = ''  // allow selecting the same file twice
  }

  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span className="section-label" style={{ fontSize: 11 }}>Reference Image</span>
        {tracingImage && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              className={`step-lock-btn${tracingImage.locked ? ' locked' : ''}`}
              aria-label={tracingImage.locked ? 'Unlock reference image' : 'Lock reference image'}
              onClick={() => updateTracingImage({ locked: !tracingImage.locked })}
            >
              {tracingImage.locked ? <IconLocked size={12} /> : <IconUnlocked size={12} />}
            </button>
            <button
              className="delete-btn"
              aria-label="Remove reference image"
              onClick={() => setTracingImage(null)}
            >
              <IconDelete size={12} />
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onFileChange}
      />
      {!tracingImage ? (
        <>
          <button className="add-btn" style={{ width: '100%' }} onClick={() => fileInputRef.current?.click()}>
            + Upload Floor Plan / Photo
          </button>
          <p className="field-hint" style={{ margin: '6px 0 0' }}>
            Trace walls over an existing garage photo or blueprint. The image shows only in the 2D floor plan — it is not included in the exported PDF.
          </p>
        </>
      ) : (
        <>
          <label style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
            Opacity: {Math.round(tracingImage.opacity * 100)}%
          </label>
          <input
            type="range"
            min={10} max={100} step={5}
            value={Math.round(tracingImage.opacity * 100)}
            onChange={e => updateTracingImage({ opacity: Math.max(0.1, Math.min(1, parseInt(e.target.value) / 100)) })}
            style={{ width: '100%' }}
          />
          <button
            className="add-btn"
            style={{ width: '100%', marginTop: 6, background: 'var(--surface2)', color: 'var(--text)' }}
            onClick={() => fileInputRef.current?.click()}
          >
            Replace image
          </button>
          <p className="field-hint" style={{ margin: '6px 0 0' }}>
            Drag the image to position. Drag the blue corner handle to resize.
          </p>
        </>
      )}
    </div>
  )
}
