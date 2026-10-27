import type { LayerTransform, ShapeLayerContent } from '../types/editor.ts'
import { normalizeShapeConfig, traceShapePath } from './shape.ts'
import { layerDocumentBounds } from './renderBounds.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_DOCUMENT_SOURCE_BYTES } from './rustDocumentBudget.ts'

export interface RustDocumentShapeSource {
  type: 'shape'
  shape: ShapeLayerContent
  transform: LayerTransform
  width: number; height: number; originX: number; originY: number; alpha: number
}

export function planRustDocumentShape(shape: ShapeLayerContent, transform: LayerTransform,
  documentWidth: number, documentHeight: number, alpha: number): RustDocumentShapeSource | null {
  if (!shape || !transform || !['rectangle', 'ellipse', 'triangle', 'star'].includes(shape.kind) ||
      typeof shape.color !== 'string' || !/^#[\da-f]{6}$/i.test(shape.color) ||
      ![shape.baseWidth, shape.baseHeight, transform.width, transform.height].every(value => Number.isFinite(value) && value > 0) ||
      ![shape.cornerRadius, shape.squareness, shape.starPoints, shape.starInnerRatio,
        transform.x, transform.y, transform.rotation ?? 0].every(Number.isFinite) ||
      ![documentWidth, documentHeight].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff) ||
      !Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RustPixelPocError('invalid-input')
  if ([transform.width / shape.baseWidth, transform.height / shape.baseHeight].some(value => !Number.isFinite(value) || value > 1_000_000)) {
    throw new RustPixelPocError('invalid-input')
  }
  const bounds = layerDocumentBounds({ transform })!
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) throw new RustPixelPocError('invalid-input')
  const left = Math.max(0, Math.floor(bounds.x)), top = Math.max(0, Math.floor(bounds.y))
  const right = Math.min(documentWidth, Math.ceil(bounds.x + bounds.width)), bottom = Math.min(documentHeight, Math.ceil(bounds.y + bounds.height))
  if (right <= left || bottom <= top) return null
  const width = right - left, height = bottom - top
  if (width > 16384 || height > 16384 || width * height * 4 > RUST_DOCUMENT_SOURCE_BYTES) throw new RustPixelPocError('memory-limit')
  return { type: 'shape', shape: { ...normalizeShapeConfig(shape), baseWidth: shape.baseWidth, baseHeight: shape.baseHeight },
    transform: { x: transform.x, y: transform.y, width: transform.width, height: transform.height, rotation: transform.rotation ?? 0 },
    width, height, originX: left, originY: top, alpha }
}

export function validateRustDocumentShape(source: RustDocumentShapeSource, documentWidth: number, documentHeight: number) {
  const expected = planRustDocumentShape(source.shape, source.transform, documentWidth, documentHeight, source.alpha)
  if (!expected || (['width', 'height', 'originX', 'originY'] as const).some(key => expected[key] !== source[key])) {
    throw new RustPixelPocError('invalid-input')
  }
}

export function drawRustDocumentShape(source: RustDocumentShapeSource, check: () => void) {
  check()
  if (typeof OffscreenCanvas !== 'function') throw new RustPixelPocError('wasm-unavailable')
  const canvas = new OffscreenCanvas(source.width, source.height)
  try {
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new RustPixelPocError('wasm-unavailable')
    const { shape, transform } = source
    // Bake coverage/Fill/opacity in document pixels; Rust must not resample this vector source.
    context.globalAlpha = source.alpha
    context.translate(transform.x + transform.width / 2 - source.originX, transform.y + transform.height / 2 - source.originY)
    context.rotate((transform.rotation ?? 0) * Math.PI / 180)
    context.scale(transform.width / shape.baseWidth, transform.height / shape.baseHeight)
    traceShapePath(context, { x: -shape.baseWidth / 2, y: -shape.baseHeight / 2,
      width: shape.baseWidth, height: shape.baseHeight }, shape)
    context.fillStyle = shape.color
    context.fill()
    const result = context.getImageData(0, 0, source.width, source.height)
    check()
    return { width: result.width, height: result.height, data: result.data }
  } finally { canvas.width = 1; canvas.height = 1 }
}
