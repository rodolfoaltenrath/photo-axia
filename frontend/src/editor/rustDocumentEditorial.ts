import type { DocumentSpec, LayerItem, LayerTransform } from '../types/editor.ts'
import type { DocumentBounds } from './renderBounds.ts'
import { styledLayerIntersectsBounds } from './renderBounds.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight, layerStyleFillOpacity,
  layerStyleBlendIfUsesUnderlying, layerStyleBlendIfIsDefault } from './layerStyles.ts'
import { activeLayerStyleEffects } from './layerStyleCompositor.ts'
import { prepareRustStyleSourceLayout, type RustPixelPocStyleSourceInput } from './rustPixelPocStylePreparation.ts'
import type { RustDocumentRasterLayer, RustDocumentOutputGrid } from './rustDocumentComposite.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { rustPixelPocStyleMetadataBytes } from './rustPixelPocStyleInput.ts'
import { planRustDocumentShape, type RustDocumentShapeSource } from './rustDocumentShape.ts'

type Matrix = NonNullable<RustDocumentRasterLayer['sourceToDocument']>
export interface RustEditorialLayer {
  source: { type: 'raster'; url: string } | { type: 'solid'; color: [number, number, number, number] } | RustDocumentShapeSource
  input: RustPixelPocStyleSourceInput
  matrix: Matrix
  opacity: number
  blendMode: RustDocumentRasterLayer['blendMode']
}
export interface RustEditorialPlan {
  documentWidth: number; documentHeight: number; width: number; height: number
  grid: RustDocumentOutputGrid; layers: RustEditorialLayer[]
}
export interface RustDocumentMediaInput extends Omit<RustEditorialPlan, 'layers'> {
  layers: (Omit<RustEditorialLayer, 'source'> & {
    source: { type: 'raster'; blob: Blob } | { type: 'solid'; color: [number, number, number, number] } | RustDocumentShapeSource
    patterns: Record<string, Blob>
  })[]
}
export class RustDocumentUnsupported extends Error {
  readonly reason: string
  constructor(reason: string) { super(reason); this.reason = reason; this.name = 'RustDocumentUnsupported' }
}
export function rustDocumentEnabled(search: string) {
  return new URLSearchParams(search).get('axiaRustDocument') === '1'
}
export function rustDocumentSourceMatrix(transform: LayerTransform, sourceWidth: number, sourceHeight: number,
  offsetX = 0, offsetY = 0): Matrix {
  if (![transform.x, transform.y, transform.width, transform.height, transform.rotation ?? 0, sourceWidth, sourceHeight]
    .every(Number.isFinite) || Math.min(transform.width, transform.height, sourceWidth, sourceHeight) <= 0) {
    throw new RustPixelPocError('invalid-input')
  }
  const angle = (transform.rotation ?? 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
  const a = cos * transform.width / sourceWidth, b = sin * transform.width / sourceWidth
  const c = -sin * transform.height / sourceHeight, d = cos * transform.height / sourceHeight
  return [a, b, c, d,
    transform.x + transform.width / 2 - cos * transform.width / 2 + sin * transform.height / 2 + a * offsetX + c * offsetY,
    transform.y + transform.height / 2 - sin * transform.width / 2 - cos * transform.height / 2 + b * offsetX + d * offsetY]
}
export function planRustEditorialDocument(document: DocumentSpec, layers: LayerItem[], width: number, height: number,
  viewport: DocumentBounds): RustEditorialPlan {
  if (![width, height, document.width, document.height].every(value => Number.isSafeInteger(value) && value > 0) ||
      ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) ||
      viewport.width <= 0 || viewport.height <= 0) throw new RustPixelPocError('invalid-input')
  if (width !== viewport.width || height !== viewport.height || width > 16384 || height > 16384 ||
      width * height * 4 > 64 * 1024 * 1024) throw new RustDocumentUnsupported('output-scale-or-size')
  const light = normalizeLayerStyleGlobalLight(document.layerStyleGlobalLight)
  const result: RustEditorialPlan = { documentWidth: document.width, documentHeight: document.height,
    width, height, grid: { scaleX: 1, scaleY: 1, originX: viewport.x, originY: viewport.y }, layers: [] }
  const background = layers.find(layer => layer.kind === 'background')
  if (background?.visible && !background.image && document.background !== 'transparent') {
    if (activeLayerStyleEffects(background.styles).length || !layerStyleBlendIfIsDefault(background.styles.blendIf)) {
      throw new RustDocumentUnsupported('background-style')
    }
    const color = document.background === 'black' ? 0 : 255
    result.layers.push({ source: { type: 'solid', color: [color, color, color, 255] },
      input: { sourceIdentity: 'document-background', sourceWidth: 1, sourceHeight: 1,
        styles: normalizeLayerStyleConfig({}), globalLight: light },
      matrix: [document.width, 0, 0, document.height, 0, 0],
      opacity: background.opacity * layerStyleFillOpacity(background.styles), blendMode: 'normal' })
  }
  let sourceBytes = 0, metadata = 0
  for (const layer of [...layers].reverse()) {
    if (!layer.visible || !layer.transform || !styledLayerIntersectsBounds(layer, viewport, light)) continue
    if (!layer.image && layer.shape && !layer.text) {
      if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 100) throw new RustPixelPocError('invalid-input')
      if (activeLayerStyleEffects(layer.styles).length || !layerStyleBlendIfIsDefault(layer.styles.blendIf)) {
        throw new RustDocumentUnsupported('shape-style')
      }
      const source = planRustDocumentShape(layer.shape, layer.transform, document.width, document.height,
        (layer.opacity / 100) * layerStyleFillOpacity(layer.styles))
      if (!source) continue
      sourceBytes += source.width * source.height * 4
      metadata += rustPixelPocStyleMetadataBytes(source)
      if (sourceBytes > 16 * 1024 * 1024 || result.layers.length >= 32 || metadata > 512 * 1024) {
        throw new RustPixelPocError('memory-limit')
      }
      result.layers.push({ source, input: { sourceIdentity: `shape:${layer.id}`, sourceWidth: source.width,
        sourceHeight: source.height, styles: normalizeLayerStyleConfig({}), globalLight: light, quality: 'final' },
        matrix: [1, 0, 0, 1, source.originX, source.originY], opacity: 100, blendMode: layer.blendMode })
      continue
    }
    if (!layer.image) throw new RustDocumentUnsupported('non-image-layer')
    const image = layer.image, transform = layer.transform
    if (transform.width < image.width || transform.height < image.height) throw new RustDocumentUnsupported('source-minification')
    const styles = normalizeLayerStyleConfig(layer.styles)
    metadata += rustPixelPocStyleMetadataBytes({ id: layer.id, url: image.sourceUrl, styles })
    if (metadata > 512 * 1024) throw new RustPixelPocError('memory-limit')
    const input: RustPixelPocStyleSourceInput = { sourceIdentity: `${layer.id}:${image.editToken ?? ''}:${image.sourceUrl}`,
      sourceWidth: image.width, sourceHeight: image.height, styles, globalLight: light, quality: 'final',
      resolutionScale: 1 / Math.sqrt(transform.width / image.width * (transform.height / image.height)) }
    const layout = prepareRustStyleSourceLayout(input)
    sourceBytes += layout.width * layout.height * 4
    if (sourceBytes > 16 * 1024 * 1024 || result.layers.length >= 32) throw new RustPixelPocError('memory-limit')
    result.layers.push({ source: { type: 'raster', url: image.sourceUrl }, input,
      matrix: rustDocumentSourceMatrix(transform, image.width, image.height), opacity: layer.opacity, blendMode: layer.blendMode })
  }
  if (rustPixelPocStyleMetadataBytes(result) > 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return structuredClone(result)
}

export function rustEditorialUnderlying(input: RustPixelPocStyleSourceInput) {
  const styles = normalizeLayerStyleConfig(input.styles)
  return layerStyleBlendIfUsesUnderlying(styles.blendIf) ? { channel: styles.blendIf.channel,
    shadows: styles.blendIf.underlyingLayer.shadows, highlights: styles.blendIf.underlyingLayer.highlights } : undefined
}
