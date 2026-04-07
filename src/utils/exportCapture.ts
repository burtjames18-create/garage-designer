import type { ExportShot } from '../store/garageStore'

/** Module-level ref so Topbar can trigger capture from inside the Canvas */
export const exportCaptureRef: {
  capture: ((shots: ExportShot[], onProgress?: (step: number) => void) => Promise<string[]>) | null
  saveShot: (() => ExportShot | null) | null
} = { capture: null, saveShot: null }
