/**
 * Module-level cache for imported 3D model blob URLs AND raw buffers.
 * Keeps large binary data OUT of Zustand state to avoid re-render lag.
 * Automatically persists to IndexedDB so models survive page reloads.
 */
import { saveModelToDB, loadModelFromDB, deleteModelFromDB } from './modelStorage'

const urlCache = new Map<string, string>()
const bufferCache = new Map<string, ArrayBuffer>()

/** Store raw ArrayBuffer as a blob URL + persist to IndexedDB */
export function cacheModelBuffer(assetId: string, buffer: ArrayBuffer): string {
  const existing = urlCache.get(assetId)
  if (existing) URL.revokeObjectURL(existing)
  const blob = new Blob([buffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  urlCache.set(assetId, url)
  bufferCache.set(assetId, buffer)
  // Persist in background — don't block
  saveModelToDB(assetId, buffer).catch(() => {})
  return url
}

/** Store base64 GLB data as a blob URL (for loading from saved .garage files) */
export function cacheModelBase64(assetId: string, base64: string): string {
  const existing = urlCache.get(assetId)
  if (existing) return existing
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const buffer = bytes.buffer
  const blob = new Blob([buffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  urlCache.set(assetId, url)
  bufferCache.set(assetId, buffer)
  saveModelToDB(assetId, buffer).catch(() => {})
  return url
}

/** Get cached blob URL — if not in memory, try IndexedDB */
export function getCachedModelUrl(assetId: string): string | undefined {
  return urlCache.get(assetId)
}

/**
 * Restore a model from IndexedDB into the memory cache.
 * Call this on app startup for each imported 3D model asset.
 * Returns the blob URL, or undefined if not found in IndexedDB.
 */
export async function restoreModelFromDB(assetId: string): Promise<string | undefined> {
  const existing = urlCache.get(assetId)
  if (existing) return existing

  const buffer = await loadModelFromDB(assetId)
  if (!buffer) return undefined

  const blob = new Blob([buffer], { type: 'model/gltf-binary' })
  const url = URL.createObjectURL(blob)
  urlCache.set(assetId, url)
  bufferCache.set(assetId, buffer)
  return url
}

/** Get the raw ArrayBuffer for serialization into save files */
export function getCachedModelBuffer(assetId: string): ArrayBuffer | undefined {
  return bufferCache.get(assetId)
}

/** Convert a cached model's buffer to base64 for saving (handles large files via Blob/FileReader) */
export async function getCachedModelBase64Async(assetId: string): Promise<string | undefined> {
  const buffer = bufferCache.get(assetId)
  if (!buffer) return undefined

  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const dataUrl = reader.result as string
      // dataUrl is "data:application/octet-stream;base64,XXXXX"
      const base64 = dataUrl.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => resolve(undefined)
    reader.readAsDataURL(blob)
  })
}

/** Remove a cached model from memory and IndexedDB */
export function removeCachedModel(assetId: string): void {
  const url = urlCache.get(assetId)
  if (url) URL.revokeObjectURL(url)
  urlCache.delete(assetId)
  bufferCache.delete(assetId)
  deleteModelFromDB(assetId).catch(() => {})
}
