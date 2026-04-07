/**
 * Persistent model library — stored in localStorage (metadata) + IndexedDB (binary).
 * Independent of project state. Models added here are available across all projects.
 */

export interface LibraryModel {
  id: string
  name: string         // original filename
  label: string        // display name
  category: 'car' | 'motorcycle' | 'equipment' | 'furniture'
}

const STORAGE_KEY = 'garage-designer-model-library'

/** Load all library model metadata from localStorage */
export function getLibraryModels(): LibraryModel[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as LibraryModel[]
  } catch {
    return []
  }
}

/** Save a model to the library */
export function addLibraryModel(model: LibraryModel): void {
  const models = getLibraryModels()
  // Don't duplicate
  if (models.some(m => m.id === model.id)) return
  models.push(model)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models))
}

/** Remove a model from the library */
export function removeLibraryModel(id: string): void {
  const models = getLibraryModels().filter(m => m.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(models))
}
