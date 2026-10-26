import type { DocumentSpec, LayerItem } from '../types/editor.ts'
import type { DocumentBounds } from '../editor/renderBounds.ts'
import { planRustEditorialDocument, RustDocumentUnsupported, type RustDocumentBoundsPolicy } from '../editor/rustDocumentEditorial.ts'
import { RustDocumentOffscreen } from '../editor/rustDocumentOffscreen.ts'
import { connectRustStyleWorker } from './rustPixelPocStyleService.ts'
import { RustPixelPocError } from '../editor/rustPixelPocError.ts'
import { rustDocumentSamplingCompatible } from './rustDocumentSamplingCompatibility.ts'
import { rustRasterSamplingNeedsPlatformProbe } from '../editor/rustDocumentSampling.ts'

let renderer: RustDocumentOffscreen | undefined
let retiring = Promise.resolve()
let epoch = 0
export function disposeRustDocumentRenderer() {
  epoch++
  const previous = renderer; renderer = undefined
  if (previous) retiring = Promise.all([retiring, previous.dispose()]).then(() => {})
  return retiring
}
window.addEventListener('pagehide', () => { void disposeRustDocumentRenderer().catch(() => {}) })
export function rustDocumentRendererStats() {
  return renderer?.stats ?? { connections: 0, preparations: 0, reuses: 0, rendered: 0,
    active: false, queued: 0, workerAlive: false, preparedBytes: 0 }
}
export async function renderRustDocumentCanvas(document: DocumentSpec, layers: LayerItem[], width: number, height: number,
  viewport: DocumentBounds, boundsPolicy: RustDocumentBoundsPolicy = 'document') {
  const current = epoch
  const plan = planRustEditorialDocument(document, layers, width, height, viewport, boundsPolicy)
  // A média de área é convenção do Rust; só os modos bilineares dependem do Canvas da plataforma.
  if (plan.layers.some(layer => rustRasterSamplingNeedsPlatformProbe(layer.sampling)) && !await rustDocumentSamplingCompatible()) {
    throw new RustDocumentUnsupported('source-transform-platform')
  }
  await retiring
  if (current !== epoch) throw new RustPixelPocError('wasm-unavailable')
  const session = renderer ??= new RustDocumentOffscreen(connectRustStyleWorker)
  const canvas = window.document.createElement('canvas'); canvas.width = width; canvas.height = height
  try {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas-unavailable')
    await session.render(plan, (rgba, region) => {
      context.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), region.width, region.height), region.x, region.y)
    })
    return canvas
  } catch (error) { canvas.width = 1; canvas.height = 1; throw error }
}
