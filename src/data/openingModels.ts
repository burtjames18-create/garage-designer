// GLB model catalog for doors and windows
// Kenney Building Kit models (CC0) — free for any use

export type OpeningModelType = 'door' | 'garage-door' | 'window'

export interface OpeningModel {
  id: string
  name: string
  file: string          // GLB filename in public/assets/models/
  type: OpeningModelType // which opening types this model can be used for
  preview: string       // CSS color or emoji for the picker swatch
}

export const openingModels: OpeningModel[] = [
  // ── Doors ──────────────────────────────────────────────────────────────────
  {
    id: 'door-panel',
    name: 'Panel Door',
    file: 'door-panel.glb',
    type: 'door',
    preview: '#8B7355',
  },
  {
    id: 'door-panel-glass',
    name: 'Panel Door (Glass)',
    file: 'door-panel-glass.glb',
    type: 'door',
    preview: '#6B8E9B',
  },
  {
    id: 'door-arched',
    name: 'Arched Door',
    file: 'door-arched.glb',
    type: 'door',
    preview: '#A0522D',
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
