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

export const MODEL_CATALOG: ModelDef[] = [
  // ── Cars ──────────────────────────────────────────────────────────────────
  {
    type: 'mclaren-w1',
    label: 'McLaren W1 (2025)',
    category: 'car',
    w: 76, h: 48, d: 181,
  },
  {
    type: 'mclaren-720s',
    label: 'McLaren 720S',
    category: 'car',
    w: 76, h: 47, d: 178,
  },
  {
    type: 'ferrari-488-pista',
    label: 'Ferrari 488 Pista',
    category: 'car',
    w: 77, h: 47, d: 182,
  },
  {
    type: 'delorean-dmc',
    label: 'DeLorean DMC-12',
    category: 'car',
    w: 73, h: 45, d: 168,
  },
  {
    type: 'g-wagon',
    label: 'Mercedes G-Wagon',
    category: 'car',
    w: 76, h: 78, d: 190,
  },
  {
    type: 'sedan-black',
    label: 'Sedan (Black)',
    category: 'car',
    w: 73, h: 58, d: 193,
  },
  {
    type: 'lamborghini-aventador',
    label: 'Lamborghini Aventador',
    category: 'car',
    w: 80, h: 45, d: 188,
    modelRotY: -Math.PI / 2,  // GLB faces +X by default; rotate -90° so it faces +Z
  },
  {
    type: 'lamborghini-huracan-lb',
    label: 'Lamborghini Huracan LB Silhouette',
    category: 'car',
    w: 76, h: 47, d: 175,
  },
  {
    type: 'porsche-911-carrera-4s',
    label: 'Porsche 911 Carrera 4S',
    category: 'car',
    w: 73, h: 51, d: 178,
  },
  {
    type: 'porsche-911-930-turbo',
    label: 'Porsche 911 930 Turbo (1975)',
    category: 'car',
    w: 70, h: 51, d: 168,
  },

  // ── Motorcycles ───────────────────────────────────────────────────────────
  {
    type: 'spy-hypersport-motorbike',
    label: 'Spy Hypersport',
    category: 'motorcycle',
    w: 32, h: 50, d: 84,
  },

  // ── Wildfire Car Lifts ────────────────────────────────────────────────────
  // All are 4-post storage/parking lifts. Dimensions in inches.
  // Footprint: w = overall width (side-to-side), d = overall depth (front-to-back incl. ramps),
  // h = post height. Source: wildfirelifts.com + install manuals.
  {
    type: 'wildfire-standard',
    label: 'Wildfire Standard (WF9000)',
    category: 'car-lift',
    w: 114, h: 92, d: 183,
    // 9,000 lb capacity | 6'0" clearance under deck | 19" runways | 36" ramps
  },
  {
    type: 'wildfire-xlt',
    label: 'Wildfire XLT (WF9000 XLT)',
    category: 'car-lift',
    w: 121, h: 102, d: 204,
    // 9,000 lb | 6'10" clearance | 19" runways | 36" ramps | extra length for long wheelbase
  },
  {
    type: 'wildfire-exotic',
    label: 'Wildfire Exotic (WF9000EXW)',
    category: 'car-lift',
    w: 121, h: 92, d: 183,
    // 9,000 lb | 6'0" clearance | 23" wide runways | 48" ramps | low-slung exotics
  },
  {
    type: 'wildfire-exotic-tall',
    label: 'Wildfire Exotic Tall (WF9000EXW-T)',
    category: 'car-lift',
    w: 121, h: 102, d: 183,
    // 9,000 lb | 6'9" clearance | 23" wide runways | 48" ramps | taller post version
  },
  {
    type: 'wildfire-truck',
    label: 'Wildfire Truck Lift (WF12000)',
    category: 'car-lift',
    w: 132, h: 102, d: 226,
    // 12,000 lb | 6'9" clearance | 19" runways | 48" ramps | extended trucks/dualies
  },
  {
    type: 'wildfire-double-wide',
    label: 'Wildfire Double Wide (WF10000DW)',
    category: 'car-lift',
    w: 213, h: 100, d: 204,
    // 10,000 lb total | 6'9" clearance | 4 runways | 2 cars side-by-side
  },
  {
    type: 'wildfire-trailer',
    label: 'Wildfire Trailer Lift (WF7500)',
    category: 'car-lift',
    w: 107, h: 96, d: 213,
    // 7,500 lb | 6'10" clearance | adjustable-width runways | boats/trailers/vehicles
  },
]

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
