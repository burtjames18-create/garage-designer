// Texture catalog for walls, doors, concrete floors, metal, wood, and ceiling
// All textures are CC0 from Poly Haven (polyhaven.com) — free for any use

export type TextureCategory = 'walls' | 'doors' | 'concrete' | 'metal' | 'wood' | 'ceiling'

export interface TextureEntry {
  id: string
  name: string
  category: TextureCategory
  file: string                // diffuse/color map filename
  normalFile?: string         // normal map filename (if available)
  roughFile?: string          // roughness map filename (if available)
  tags: string[]              // for search/filter
}

const BASE = 'assets/textures'

// Helper to build full path from category + file
export function texturePath(category: TextureCategory, file: string): string {
  return `${BASE}/${category}/${file}`
}

export const wallTextures: TextureEntry[] = [
  {
    id: 'beige-wall-001', name: 'Painted Drywall (Beige)', category: 'walls',
    file: 'beige-wall-001.jpg', normalFile: 'beige-wall-001_normal.jpg',
    tags: ['drywall', 'painted', 'beige', 'interior', 'smooth'],
  },
  {
    id: 'beige-wall-002', name: 'Painted Drywall (Warm)', category: 'walls',
    file: 'beige-wall-002.jpg', normalFile: 'beige-wall-002_normal.jpg',
    tags: ['drywall', 'painted', 'warm', 'interior', 'smooth'],
  },
  {
    id: 'brushed-concrete', name: 'Brushed Concrete', category: 'walls',
    file: 'brushed-concrete.jpg', normalFile: 'brushed-concrete_normal.jpg', roughFile: 'brushed-concrete_rough.jpg',
    tags: ['concrete', 'industrial', 'garage', 'rough'],
  },
  {
    id: 'clay-plaster', name: 'Clay Plaster / Stucco', category: 'walls',
    file: 'clay-plaster.jpg',
    tags: ['plaster', 'stucco', 'clay', 'interior', 'textured'],
  },
  {
    id: 'blue-plaster-weathered', name: 'Weathered Blue Plaster', category: 'walls',
    file: 'blue-plaster-weathered.jpg',
    tags: ['plaster', 'blue', 'weathered', 'exterior'],
  },
  {
    id: 'brick-wall-001', name: 'Red Brick Wall', category: 'walls',
    file: 'brick-wall-001.jpg',
    tags: ['brick', 'red', 'classic', 'exterior'],
  },
  {
    id: 'brick-wall-02', name: 'Brown Brick Wall', category: 'walls',
    file: 'brick-wall-02.jpg',
    tags: ['brick', 'brown', 'classic'],
  },
  {
    id: 'brick-wall-04', name: 'Gray Brick Wall', category: 'walls',
    file: 'brick-wall-04.jpg',
    tags: ['brick', 'gray', 'modern'],
  },
  {
    id: 'brick-wall-006', name: 'White Brick Wall', category: 'walls',
    file: 'brick-wall-006.jpg', normalFile: 'brick-wall-006_normal.jpg',
    tags: ['brick', 'white', 'painted', 'modern'],
  },
]

export const doorTextures: TextureEntry[] = [
  {
    id: 'wooden-garage-door', name: 'Wooden Garage Door', category: 'doors',
    file: 'wooden-garage-door.jpg', normalFile: 'wooden-garage-door_normal.jpg',
    tags: ['wood', 'garage', 'panel', 'classic'],
  },
  {
    id: 'corrugated-iron', name: 'Corrugated Metal Door', category: 'doors',
    file: 'corrugated-iron.jpg',
    tags: ['metal', 'corrugated', 'industrial', 'roll-up'],
  },
  {
    id: 'rusty-painted-metal', name: 'Painted Metal Door', category: 'doors',
    file: 'rusty-painted-metal.jpg',
    tags: ['metal', 'painted', 'industrial', 'weathered'],
  },
]

export const concreteTextures: TextureEntry[] = [
  {
    id: 'concrete-floor', name: 'Concrete Floor', category: 'concrete',
    file: 'concrete-floor.jpg', normalFile: 'concrete-floor_normal.jpg', roughFile: 'concrete-floor_rough.jpg',
    tags: ['concrete', 'floor', 'bare', 'industrial'],
  },
  {
    id: 'garage-floor', name: 'Stained Garage Floor', category: 'concrete',
    file: 'garage-floor.jpg', normalFile: 'garage-floor_normal.jpg', roughFile: 'garage-floor_rough.jpg',
    tags: ['concrete', 'floor', 'stained', 'garage', 'worn'],
  },
  {
    id: 'anti-slip-concrete', name: 'Anti-Slip Concrete', category: 'concrete',
    file: 'anti-slip-concrete.jpg',
    tags: ['concrete', 'floor', 'textured', 'safety', 'grip'],
  },
  {
    id: 'brushed-concrete-floor', name: 'Brushed Concrete Floor', category: 'concrete',
    file: 'brushed-concrete-floor.jpg',
    tags: ['concrete', 'floor', 'brushed', 'smooth'],
  },
  {
    id: 'concrete', name: 'Raw Concrete', category: 'concrete',
    file: 'concrete.jpg',
    tags: ['concrete', 'raw', 'industrial', 'exposed'],
  },
]

export const metalTextures: TextureEntry[] = [
  {
    id: 'box-profile-metal-sheet', name: 'Box Profile Metal Sheet', category: 'metal',
    file: 'box-profile-metal-sheet.jpg',
    tags: ['metal', 'panel', 'corrugated', 'siding'],
  },
  {
    id: 'blue-metal-plate', name: 'Blue Metal Plate', category: 'metal',
    file: 'blue-metal-plate.jpg',
    tags: ['metal', 'plate', 'blue', 'painted'],
  },
  {
    id: 'metal-plate-02', name: 'Diamond Plate Metal', category: 'metal',
    file: 'metal-plate-02.jpg',
    tags: ['metal', 'diamond', 'plate', 'floor', 'industrial'],
  },
  {
    id: 'worn-corrugated-iron', name: 'Worn Corrugated Iron', category: 'metal',
    file: 'worn-corrugated-iron.jpg',
    tags: ['metal', 'corrugated', 'weathered', 'iron'],
  },
]

export const woodTextures: TextureEntry[] = [
  {
    id: 'plywood', name: 'Plywood / OSB', category: 'wood',
    file: 'plywood.jpg',
    tags: ['wood', 'plywood', 'OSB', 'panel', 'construction'],
  },
  {
    id: 'brown-planks', name: 'Dark Wood Planks', category: 'wood',
    file: 'brown-planks.jpg',
    tags: ['wood', 'planks', 'dark', 'brown', 'floor'],
  },
  {
    id: 'brown-planks-05', name: 'Light Wood Planks', category: 'wood',
    file: 'brown-planks-05.jpg',
    tags: ['wood', 'planks', 'light', 'natural'],
  },
  {
    id: 'blue-painted-planks', name: 'Blue Painted Planks', category: 'wood',
    file: 'blue-painted-planks.jpg',
    tags: ['wood', 'planks', 'painted', 'blue'],
  },
]

export const ceilingTextures: TextureEntry[] = [
  {
    id: 'ceiling-interior', name: 'Interior Ceiling', category: 'ceiling',
    file: 'ceiling-interior.jpg',
    tags: ['ceiling', 'drywall', 'white', 'interior'],
  },
]

// All textures combined
export const allTextures: TextureEntry[] = [
  ...wallTextures,
  ...doorTextures,
  ...concreteTextures,
  ...metalTextures,
  ...woodTextures,
  ...ceilingTextures,
]

// Lookup by ID
export function getTextureById(id: string): TextureEntry | undefined {
  return allTextures.find(t => t.id === id)
}

// Filter by tags
export function getTexturesByTag(tag: string): TextureEntry[] {
  return allTextures.filter(t => t.tags.includes(tag))
}
