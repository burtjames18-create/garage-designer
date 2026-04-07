export interface FlooringColor {
  id: string
  name: string
  file: string
  /** Subdirectory under assets/textures/ where the file lives */
  dir: string
  series: 'classic' | 'stone' | 'concrete'
}

/** Build the full texture path for a flooring entry */
export function flooringTexturePath(entry: FlooringColor): string {
  return `assets/textures/${entry.dir}/${entry.file}`
}

/** Resolve a flooring ID to its full texture path */
export function flooringTexturePathById(id: string): string {
  const entry = flooringColors.find(c => c.id === id)
  if (!entry) return `assets/textures/flooring/${id}.jpg`
  return flooringTexturePath(entry)
}

export const flooringColors: FlooringColor[] = [
  // Classic FLOORTEX® Series
  { id: 'glacier',      name: 'Glacier',      file: 'glacier.jpg',      dir: 'flooring', series: 'classic' },
  { id: 'smokey',       name: 'Smokey',       file: 'smokey.jpg',       dir: 'flooring', series: 'classic' },
  { id: 'quicksilver',  name: 'Quicksilver',  file: 'quicksilver.jpg',  dir: 'flooring', series: 'classic' },
  { id: 'charcoal',     name: 'Charcoal',     file: 'charcoal.jpg',     dir: 'flooring', series: 'classic' },
  { id: 'basalt',       name: 'Basalt',       file: 'basalt.jpg',       dir: 'flooring', series: 'classic' },
  { id: 'slate',        name: 'Slate',        file: 'slate.jpg',        dir: 'flooring', series: 'classic' },
  { id: 'blue-nightfall', name: 'Blue Nightfall', file: 'blue-nightfall.jpg', dir: 'flooring', series: 'classic' },
  { id: 'nightfall',    name: 'Nightfall',    file: 'nightfall.jpg',    dir: 'flooring', series: 'classic' },
  { id: 'carbonite',    name: 'Carbonite',    file: 'carbonite.jpg',    dir: 'flooring', series: 'classic' },
  { id: 'harbor-blue',  name: 'Harbor Blue',  file: 'harbor-blue.jpg',  dir: 'flooring', series: 'classic' },
  { id: 'orbit',        name: 'Orbit',        file: 'orbit.jpg',        dir: 'flooring', series: 'classic' },
  { id: 'tudor',        name: 'Tudor',        file: 'tudor.jpg',        dir: 'flooring', series: 'classic' },
  { id: 'sedona',       name: 'Sedona',       file: 'sedona.jpg',       dir: 'flooring', series: 'classic' },
  { id: 'khaki',        name: 'Khaki',        file: 'khaki.jpg',        dir: 'flooring', series: 'classic' },
  { id: 'pebble-beach', name: 'Pebble Beach', file: 'pebble-beach.jpg', dir: 'flooring', series: 'classic' },
  { id: 'cappuccino',   name: 'Cappuccino',   file: 'cappuccino.jpg',   dir: 'flooring', series: 'classic' },
  { id: 'creek-bed',    name: 'Creek Bed',    file: 'creek-bed.jpg',    dir: 'flooring', series: 'classic' },
  { id: 'obsidian',     name: 'Obsidian',     file: 'obsidian.jpg',     dir: 'flooring', series: 'classic' },

  // Stone-Inspired Series
  { id: 'limestone',    name: 'Limestone',    file: 'limestone.jpg',    dir: 'flooring', series: 'stone' },
  { id: 'terrazzo',     name: 'Terrazzo',     file: 'terrazzo.jpg',     dir: 'flooring', series: 'stone' },
  { id: 'natura',       name: 'Natura',       file: 'natura.jpg',       dir: 'flooring', series: 'stone' },
  { id: 'dolomite',     name: 'Dolomite',     file: 'dolomite.jpg',     dir: 'flooring', series: 'stone' },
  { id: 'armor',        name: 'Armor',        file: 'armor.jpg',        dir: 'flooring', series: 'stone' },
  { id: 'shale',        name: 'Shale',        file: 'shale.jpg',        dir: 'flooring', series: 'stone' },

  // Concrete Series (bare / polished / industrial)
  { id: 'concrete-floor',         name: 'Concrete',          file: 'concrete-floor.jpg',         dir: 'concrete', series: 'concrete' },
  { id: 'garage-floor',           name: 'Stained Garage',    file: 'garage-floor.jpg',           dir: 'concrete', series: 'concrete' },
  { id: 'anti-slip-concrete',     name: 'Anti-Slip',         file: 'anti-slip-concrete.jpg',     dir: 'concrete', series: 'concrete' },
  { id: 'brushed-concrete-floor', name: 'Brushed Concrete',  file: 'brushed-concrete-floor.jpg', dir: 'concrete', series: 'concrete' },
  { id: 'raw-concrete',           name: 'Raw Concrete',      file: 'concrete.jpg',               dir: 'concrete', series: 'concrete' },
]
