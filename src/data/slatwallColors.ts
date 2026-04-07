export interface SlatwallColor {
  id: string
  name: string
  hex: string
}

// Garage Living standard slatwall panel colors (industrial rigid cellular PVC)
// Hex values matched from official product images at garageliving.com/products/slatwall-panels
export const slatwallColors: SlatwallColor[] = [
  { id: 'white',       name: 'White',       hex: '#efefed' },
  { id: 'mist',        name: 'Mist',        hex: '#cdd0cf' },
  { id: 'grey',        name: 'Grey',        hex: '#939490' },
  { id: 'gunmetal',    name: 'Gunmetal',    hex: '#606264' },
  { id: 'taupe',       name: 'Taupe',       hex: '#9e9080' },
  { id: 'harbor-blue', name: 'Harbor Blue', hex: '#3d4a6b' },
  { id: 'black',       name: 'Black',       hex: '#2e2e2e' },
]

export const defaultSlatwallColor = 'white'
