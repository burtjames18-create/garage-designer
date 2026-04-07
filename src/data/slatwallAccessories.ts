export interface SlatwallAccessoryDef {
  type: string
  label: string
  sku: string
  w: number   // inches
  h: number   // inches
  d: number   // inches (depth from wall)
  price: number
  color: string  // hex default color
}

export const SLATWALL_ACCESSORIES: SlatwallAccessoryDef[] = [
  // Hooks
  { type: 'hook-single',  label: 'Single Hook',   sku: 'GL-ACC-HOOK-SGL', w: 2,  h: 4,  d: 3,  price: 8,   color: '#888888' },
  { type: 'hook-double',  label: 'Double Hook',   sku: 'GL-ACC-HOOK-DBL', w: 4,  h: 4,  d: 5,  price: 12,  color: '#888888' },
  { type: 'hook-bike',    label: 'Bike Hook',     sku: 'GL-ACC-BIKE',     w: 4,  h: 6,  d: 12, price: 24,  color: '#555555' },

  // Bins & Baskets
  { type: 'bin-small',    label: 'Small Bin',      sku: 'GL-ACC-BIN-SM',   w: 8,  h: 6,  d: 6,  price: 18,  color: '#d0d0d0' },
  { type: 'bin-large',    label: 'Large Bin',      sku: 'GL-ACC-BIN-LG',   w: 12, h: 8,  d: 8,  price: 28,  color: '#d0d0d0' },

  // Shelves
  { type: 'shelf-12',     label: '12" Shelf',      sku: 'GL-ACC-SHELF-12', w: 24, h: 1,  d: 12, price: 32,  color: '#a0a0a0' },
  { type: 'shelf-24',     label: '24" Shelf',      sku: 'GL-ACC-SHELF-24', w: 24, h: 1,  d: 24, price: 45,  color: '#a0a0a0' },
]
