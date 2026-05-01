// GLB model catalog for doors and windows
// Kenney Building Kit models (CC0) — free for any use

export type OpeningModelType = 'door' | 'garage-door' | 'window'
export type OpeningModelKind = 'glb' | 'procedural'

export interface OpeningModel {
  id: string
  name: string
  file: string          // GLB filename in public/assets/models/ (empty for procedural)
  type: OpeningModelType // which opening types this model can be used for
  preview: string       // CSS color or emoji for the picker swatch
  kind?: OpeningModelKind // 'glb' (default) renders from GLB file; 'procedural' renders from primitives
  /** Ratio of the visible FRAME extent to the GLB's full bounding box. The
   *  Kenney building-kit GLBs include a wall panel surrounding the frame.
   *  We render the model bigger by 1/frameScale so its visible frame fills
   *  the user's opening rectangle, and the wall panel extends past — that
   *  surplus is hidden behind the surrounding solid wall.
   *  Default: 1 (no surrounding wall section). */
  frameScale?: number
}

export const openingModels: OpeningModel[] = [
  // ── Doors ──────────────────────────────────────────────────────────────────
  {
    id: 'custom-plain',
    name: 'Custom Plain',
    file: '',
    type: 'door',
    preview: '#e0dedd',
    kind: 'procedural',
  },
  {
    id: 'custom-double',
    name: 'Double Door Closet',
    file: '',
    type: 'door',
    preview: '#dcd5c6',
    kind: 'procedural',
  },

  // Window 3D model variants (square / detailed / wide / round) were
  // removed — they shipped with awkward bundled wall panels. Windows now
  // always render as the procedural flat panel.
]

/** Get models that match a given opening type */
export function getModelsForType(type: OpeningModelType): OpeningModel[] {
  return openingModels.filter(m => m.type === type)
}

/** Look up a model by ID */
export function getOpeningModelById(id: string): OpeningModel | undefined {
  return openingModels.find(m => m.id === id)
}
