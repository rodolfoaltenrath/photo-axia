import type { DocumentSpec, LayerItem } from '../types/editor.ts'
import type { DocumentBounds } from '../editor/renderBounds.ts'
import { planRustEditorialDocument } from '../editor/rustDocumentEditorial.ts'
import { RustDocumentOffscreen } from '../editor/rustDocumentOffscreen.ts'
import { connectRustStyleWorker } from './rustPixelPocStyleService.ts'

const renderer = new RustDocumentOffscreen(connectRustStyleWorker)
export async function renderRustDocumentCanvas(document: DocumentSpec, layers: LayerItem[], width: number, height: number,
  viewport: DocumentBounds) {
  const plan = planRustEditorialDocument(document, layers, width, height, viewport)
  const canvas = window.document.createElement('canvas'); canvas.width = width; canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas-unavailable')
    await renderer.render(plan, (rgba, region) => {
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), region.width, region.height), region.x, region.y)
    })
    return canvas
  } catch (error) { canvas.width = 1; canvas.height = 1; throw error }
}
