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

  // ── Windows ────────────────────────────────────────────────────────────────
  {
    id: 'window-square',
    name: 'Square Window',
    file: 'window-square.glb',
    type: 'window',
    preview: '#87CEEB',
  },
  {
    id: 'window-square-detailed',
    name: 'Detailed Window',
    file: 'window-square-detailed.glb',
    type: 'window',
    preview: '#5F9EA0',
  },
  {
    id: 'window-wide',
    name: 'Wide Window',
    file: 'window-wide.glb',
    type: 'window',
    preview: '#4682B4',
  },
  {
    id: 'window-round',
    name: 'Round Window',
    file: 'window-round.glb',
    type: 'window',
    preview: '#B0C4DE',
  },
]

/** Get models that match a given opening type */
export function getModelsForType(type: OpeningModelType): OpeningModel[] {
  return openingModels.filter(m => m.type === type)
}

/** Look up a model by ID */
export function getOpeningModelById(id: string): OpeningModel | undefined {
  return openingModels.find(m => m.id === id)
}
