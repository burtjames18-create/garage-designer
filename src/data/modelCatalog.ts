export type ModelCategory = 'car' | 'motorcycle' | 'equipment' | 'furniture' | 'car-lift'

export interface ModelDef {
  type: string          // unique id — also the filename: public/assets/models/{type}.glb
  label: string
  category: ModelCategory
  w: number             // width in inches (x)
  h: number             // height in inches (y)
  d: number             // depth in inches (z)
  modelRotY?: number    // optional baked-in Y rotation (radians) to fix model orientation
  credit?: string       // attribution for CC-BY models
  downloadUrl?: string  // where to get the GLB
}

export const MODEL_CATALOG: ModelDef[] = []

export const CATEGORY_LABELS: Record<ModelCategory, string> = {
  car:        'Cars',
  motorcycle: 'Motorcycles',
  equipment:  'Equipment',
  furniture:  'Furniture',
  'car-lift': 'Car Lifts',
}

export const CATEGORY_COLORS: Record<ModelCategory, string> = {
  car:        '#1a4a8a',
  motorcycle: '#3a2a6a',
  equipment:  '#2a4a2a',
  furniture:  '#4a3a1a',
  'car-lift': '#5a4a1a',
}
