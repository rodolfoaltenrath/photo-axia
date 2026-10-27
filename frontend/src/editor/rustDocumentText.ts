import type { LayerTransform, TextLayerContent } from '../types/editor.ts'
import { layerDocumentBounds } from './renderBounds.ts'
import { drawTextLayerContent, textStyleRasterPlan } from './textCanvas.ts'
import { MAX_TEXT_FONT_FAMILY_LENGTH, textContentIsWithinLimits, textFont } from './text.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_DOCUMENT_SOURCE_BYTES } from './rustDocumentBudget.ts'

/**
 * Descritor do texto no plano editorial. Não carrega pixels: é a identidade
 * comparada pela sessão persistente, e o raster só nasce na carga da mídia.
 */
export interface RustDocumentTextSource {
  type: 'text'
  text: TextLayerContent
  transform: Required<LayerTransform>
  width: number; height: number; originX: number; originY: number; alpha: number
}

/**
 * Texto já rasterizado pelo navegador na grade documental. Os pixels viajam como
 * ArrayBuffer: não tem propriedades enumeráveis e passa pela contagem de
 * metadados do Worker como um Blob, sem enumerar bytes.
 */
export interface RustDocumentTextPixels {
  type: 'text-pixels'
  width: number; height: number; originX: number; originY: number
  rgba: ArrayBuffer
}

type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type RustDocumentTextCanvas = (width: number, height: number) => {
  context: TextContext
  release(): void
}

function validText(text: TextLayerContent) {
  return !!text && typeof text.content === 'string' && textContentIsWithinLimits(text.content) &&
    typeof text.fontFamily === 'string' && text.fontFamily.length > 0 &&
    text.fontFamily.length <= MAX_TEXT_FONT_FAMILY_LENGTH &&
    typeof text.color === 'string' && text.color.length > 0 && text.color.length <= 64 &&
    [text.fontSize, text.baseWidth, text.baseHeight, text.lineHeight].every(value => Number.isFinite(value) && value > 0) &&
    Number.isFinite(text.fontWeight) && Number.isFinite(text.letterSpacing ?? 0) && Number.isFinite(text.pathOffset ?? 0)
}

export function planRustDocumentText(text: TextLayerContent, transform: LayerTransform,
  documentWidth: number, documentHeight: number, alpha: number): RustDocumentTextSource | null {
  if (!validText(text) || !transform ||
      ![transform.width, transform.height].every(value => Number.isFinite(value) && value > 0) ||
      ![transform.x, transform.y, transform.rotation ?? 0].every(Number.isFinite) ||
      ![documentWidth, documentHeight].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff) ||
      !Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RustPixelPocError('invalid-input')
  if ([transform.width / text.baseWidth, transform.height / text.baseHeight].some(value => !Number.isFinite(value) || value > 1_000_000)) {
    throw new RustPixelPocError('invalid-input')
  }
  const bounds = layerDocumentBounds({ transform })!
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) throw new RustPixelPocError('invalid-input')
  const left = Math.max(0, Math.floor(bounds.x)), top = Math.max(0, Math.floor(bounds.y))
  const right = Math.min(documentWidth, Math.ceil(bounds.x + bounds.width)), bottom = Math.min(documentHeight, Math.ceil(bounds.y + bounds.height))
  if (right <= left || bottom <= top) return null
  const width = right - left, height = bottom - top
  if (width > 16384 || height > 16384 || width * height * 4 > RUST_DOCUMENT_SOURCE_BYTES) throw new RustPixelPocError('memory-limit')
  return { type: 'text', text: { ...text },
    transform: { x: transform.x, y: transform.y, width: transform.width, height: transform.height, rotation: transform.rotation ?? 0 },
    width, height, originX: left, originY: top, alpha }
}

/**
 * `false` somente quando uma fonte declarada por `@font-face` ainda não carregou.
 * Fontes do sistema e famílias inexistentes não precisam de carga e retornam
 * `true`, como no `fillText` do legado. Sem FontFaceSet (Node), não há o que esperar.
 */
export function rustDocumentTextFontsReady(text: TextLayerContent,
  fonts: Pick<FontFaceSet, 'check'> | undefined = globalThis.document?.fonts) {
  if (!fonts) return true
  try { return fonts.check(textFont(text), text.content.slice(0, 4096) || ' ') } catch { return false }
}

function documentTextCanvas(width: number, height: number) {
  if (typeof document === 'undefined') throw new RustPixelPocError('wasm-unavailable')
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) { canvas.width = 1; canvas.height = 1; throw new RustPixelPocError('wasm-unavailable') }
  return { context, release() { canvas.width = 1; canvas.height = 1 } }
}

/**
 * Rasteriza na thread principal, onde vivem as fontes do documento. A sequência
 * de transformações é a do `drawPreparedLayer` legado, deslocada pela origem
 * inteira da fonte: a fase subpixel dos glifos não muda. Opacidade é incorporada
 * uma vez; o Rust compõe esta fonte 1:1, sem reamostrar.
 */
export function drawRustDocumentText(source: RustDocumentTextSource,
  createCanvas: RustDocumentTextCanvas = documentTextCanvas): RustDocumentTextPixels {
  const { context, release } = createCanvas(source.width, source.height)
  try {
    const { text, transform } = source
    context.globalAlpha = source.alpha
    context.translate(transform.x + transform.width / 2 - source.originX, transform.y + transform.height / 2 - source.originY)
    context.rotate(transform.rotation * Math.PI / 180)
    context.scale(transform.width / text.baseWidth, transform.height / text.baseHeight)
    context.translate(-text.baseWidth / 2, -text.baseHeight / 2)
    context.beginPath()
    context.rect(0, 0, text.baseWidth, text.baseHeight)
    context.clip()
    drawTextLayerContent(context, text)
    const pixels = context.getImageData(0, 0, source.width, source.height)
    if (pixels.width !== source.width || pixels.height !== source.height ||
        pixels.data.byteLength !== source.width * source.height * 4) throw new RustPixelPocError('wasm-failure')
    return { type: 'text-pixels', width: source.width, height: source.height,
      originX: source.originX, originY: source.originY, rgba: pixels.data.buffer as ArrayBuffer }
  } finally { release() }
}

/** Validação no Worker: não confia na geometria nem no tamanho do buffer recebido. */
export function validateRustDocumentTextPixels(source: RustDocumentTextPixels, documentWidth: number, documentHeight: number) {
  if (!source || ![source.width, source.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) ||
      ![source.originX, source.originY].every(value => Number.isSafeInteger(value) && value >= 0) ||
      source.originX + source.width > documentWidth || source.originY + source.height > documentHeight ||
      source.width * source.height * 4 > RUST_DOCUMENT_SOURCE_BYTES ||
      !(source.rgba instanceof ArrayBuffer) || source.rgba.byteLength !== source.width * source.height * 4) {
    throw new RustPixelPocError('invalid-input')
  }
}

/**
 * Texto com estilo, Fill ou `Mesclar se`: como no legado (`textStyleRasterPlan`), o
 * texto vira um raster no referencial da camada, sem rotação, que recebe os estilos e
 * é desenhado com a matriz da camada — o mesmo caminho de uma imagem com estilo.
 */
export interface RustDocumentStyledTextSource {
  type: 'styled-text'
  text: TextLayerContent
  width: number; height: number; drawScaleX: number; drawScaleY: number
}

export interface RustDocumentStyledTextPixels {
  type: 'styled-text-pixels'
  width: number; height: number
  rgba: ArrayBuffer
}

export function planRustDocumentStyledText(text: TextLayerContent, transform: LayerTransform) {
  if (!validText(text) || !transform ||
      ![transform.width, transform.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new RustPixelPocError('invalid-input')
  }
  const plan = textStyleRasterPlan(text, transform)
  if (plan.width * plan.height * 4 > RUST_DOCUMENT_SOURCE_BYTES) throw new RustPixelPocError('memory-limit')
  const source: RustDocumentStyledTextSource = { type: 'styled-text', text: { ...text },
    width: plan.width, height: plan.height, drawScaleX: plan.drawScaleX, drawScaleY: plan.drawScaleY }
  return { source, effectScale: plan.effectScale }
}

/** Mesma sequência do `decodeRustStyleSource` do Worker de estilos legado, na thread das fontes. */
export function drawRustDocumentStyledText(source: RustDocumentStyledTextSource,
  createCanvas: RustDocumentTextCanvas = documentTextCanvas): RustDocumentStyledTextPixels {
  const { context, release } = createCanvas(source.width, source.height)
  try {
    drawTextLayerContent(context, source.text, { x: source.drawScaleX, y: source.drawScaleY })
    const pixels = context.getImageData(0, 0, source.width, source.height)
    if (pixels.width !== source.width || pixels.height !== source.height ||
        pixels.data.byteLength !== source.width * source.height * 4) throw new RustPixelPocError('wasm-failure')
    return { type: 'styled-text-pixels', width: source.width, height: source.height, rgba: pixels.data.buffer as ArrayBuffer }
  } finally { release() }
}

export function validateRustDocumentStyledTextPixels(source: RustDocumentStyledTextPixels, width: number, height: number) {
  if (!source || source.width !== width || source.height !== height ||
      ![width, height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) ||
      width * height * 4 > RUST_DOCUMENT_SOURCE_BYTES ||
      !(source.rgba instanceof ArrayBuffer) || source.rgba.byteLength !== width * height * 4) {
    throw new RustPixelPocError('invalid-input')
  }
}
