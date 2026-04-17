/**
 * Persistent texture library — stored in IndexedDB.
 * Imported textures survive across app sessions regardless of project save state.
 */

import type { ImportedAsset } from '../store/garageStore'

const DB_NAME = 'garage-designer-textures'
const STORE_NAME = 'textures'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Save a texture asset to IndexedDB (idempotent on id). */
export async function saveTextureToDB(asset: ImportedAsset): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(asset, asset.id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Load all texture assets from IndexedDB. */
export async function loadAllTexturesFromDB(): Promise<ImportedAsset[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result as ImportedAsset[]) ?? [])
    req.onerror = () => reject(req.error)
  })
}

/** Remove a texture from IndexedDB. */
export async function deleteTextureFromDB(id: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
