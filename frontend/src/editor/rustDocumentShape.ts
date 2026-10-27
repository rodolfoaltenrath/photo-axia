import type { LayerTransform, ShapeLayerContent } from '../types/editor.ts'
import { normalizeShapeConfig, traceShapePath } from './shape.ts'
import { layerDocumentBounds } from './renderBounds.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_DOCUMENT_SOURCE_BYTES } from './rustDocumentBudget.ts'
import { textStyleRasterPlan } from './textCanvas.ts'

export interface RustDocumentShapeSource {
  type: 'shape'
  shape: ShapeLayerContent
  transform: LayerTransform
  width: number; height: number; originX: number; originY: number; alpha: number
}

function validShape(shape: ShapeLayerContent) {
  return !!shape && ['rectangle', 'ellipse', 'triangle', 'star'].includes(shape.kind) &&
    typeof shape.color === 'string' && /^#[\da-f]{6}$/i.test(shape.color) &&
    [shape.baseWidth, shape.baseHeight].every(value => Number.isFinite(value) && value > 0) &&
    [shape.cornerRadius, shape.squareness, shape.starPoints, shape.starInnerRatio].every(Number.isFinite)
}

export function planRustDocumentShape(shape: ShapeLayerContent, transform: LayerTransform,
  documentWidth: number, documentHeight: number, alpha: number): RustDocumentShapeSource | null {
  if (!validShape(shape) || !transform ||
      ![transform.width, transform.height].every(value => Number.isFinite(value) && value > 0) ||
      ![transform.x, transform.y, transform.rotation ?? 0].every(Number.isFinite) ||
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

/**
 * Forma com efeitos ou `Mesclar se`: raster no referencial da camada, sem rotação, no
 * tamanho de exibição — a semântica de texto com estilo e de imagem. Fill vem do STG1;
 * a cobertura é desenhada com alfa 1. O fundo sintético com estilo usa o mesmo caminho
 * como retângulo do tamanho do documento.
 */
export interface RustDocumentStyledShapeSource {
  type: 'styled-shape'
  shape: ShapeLayerContent
  width: number; height: number; drawScaleX: number; drawScaleY: number
}

export function planRustDocumentStyledShape(shape: ShapeLayerContent, transform: Pick<LayerTransform, 'width' | 'height'>) {
  if (!validShape(shape) || !transform ||
      ![transform.width, transform.height].every(value => Number.isFinite(value) && value > 0) ||
      [transform.width / shape.baseWidth, transform.height / shape.baseHeight].some(value => value > 1_000_000)) {
    throw new RustPixelPocError('invalid-input')
  }
  const plan = textStyleRasterPlan(shape, transform)
  if (plan.width * plan.height * 4 > RUST_DOCUMENT_SOURCE_BYTES) throw new RustPixelPocError('memory-limit')
  const source: RustDocumentStyledShapeSource = { type: 'styled-shape',
    shape: { ...normalizeShapeConfig(shape), baseWidth: shape.baseWidth, baseHeight: shape.baseHeight },
    width: plan.width, height: plan.height, drawScaleX: plan.drawScaleX, drawScaleY: plan.drawScaleY }
  return { source, effectScale: plan.effectScale }
}

/** Validação no Worker: dimensões do raster e escala de desenho precisam bater com a forma. */
export function validateRustDocumentStyledShape(source: RustDocumentStyledShapeSource, width: number, height: number) {
  if (!source || !validShape(source.shape) || source.width !== width || source.height !== height ||
      ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) ||
      width * height * 4 > RUST_DOCUMENT_SOURCE_BYTES ||
      Math.abs(source.drawScaleX - width / source.shape.baseWidth) > 1e-9 ||
      Math.abs(source.drawScaleY - height / source.shape.baseHeight) > 1e-9) throw new RustPixelPocError('invalid-input')
}

export function drawRustDocumentStyledShape(source: RustDocumentStyledShapeSource, check: () => void) {
  check()
  if (typeof OffscreenCanvas !== 'function') throw new RustPixelPocError('wasm-unavailable')
  const canvas = new OffscreenCanvas(source.width, source.height)
  try {
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new RustPixelPocError('wasm-unavailable')
    const { shape } = source
    context.scale(source.drawScaleX, source.drawScaleY)
    traceShapePath(context, { x: 0, y: 0, width: shape.baseWidth, height: shape.baseHeight }, shape)
    context.fillStyle = shape.color
    context.fill()
    const result = context.getImageData(0, 0, source.width, source.height)
    check()
    return { width: result.width, height: result.height, data: result.data }
  } finally { canvas.width = 1; canvas.height = 1 }
}
