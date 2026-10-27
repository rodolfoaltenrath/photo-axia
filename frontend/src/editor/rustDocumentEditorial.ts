import type { DocumentSpec, LayerItem, LayerTransform } from '../types/editor.ts'
import type { DocumentBounds } from './renderBounds.ts'
import { styledLayerIntersectsBounds } from './renderBounds.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight, layerStyleFillOpacity,
  layerStyleBlendIfUsesUnderlying, layerStyleBlendIfIsDefault } from './layerStyles.ts'
import { activeLayerStyleEffects, layerStyleNeedsCompositing } from './layerStyleCompositor.ts'
import { prepareRustStyleSourceLayout, type RustPixelPocStyleSourceInput } from './rustPixelPocStylePreparation.ts'
import type { RustDocumentRasterLayer, RustDocumentOutputGrid } from './rustDocumentComposite.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_DOCUMENT_SOURCE_BYTES } from './rustDocumentBudget.ts'
import { rustPixelPocStyleMetadataBytes } from './rustPixelPocStyleInput.ts'
import { planRustDocumentShape, planRustDocumentStyledShape, type RustDocumentShapeSource,
  type RustDocumentStyledShapeSource } from './rustDocumentShape.ts'
import { DEFAULT_SHAPE_CONFIG } from './shape.ts'
import { planRustDocumentStyledText, planRustDocumentText, rustDocumentTextFontsReady, type RustDocumentStyledTextPixels,
  type RustDocumentStyledTextSource, type RustDocumentTextPixels, type RustDocumentTextSource } from './rustDocumentText.ts'
import { rustRasterAxisScales, rustRasterSamplingMode, rustRotationCoverageSupported } from './rustDocumentSampling.ts'

type Matrix = NonNullable<RustDocumentRasterLayer['sourceToDocument']>
export type RustDocumentBoundsPolicy = 'document' | 'appearance'
export interface RustEditorialLayer {
  source: { type: 'raster'; url: string } | { type: 'solid'; color: [number, number, number, number] } |
    RustDocumentShapeSource | RustDocumentTextSource | RustDocumentStyledTextSource | RustDocumentStyledShapeSource
  input: RustPixelPocStyleSourceInput
  matrix: Matrix
  opacity: number
  blendMode: RustDocumentRasterLayer['blendMode']
  sampling?: RustDocumentRasterLayer['sampling']
}
export interface RustEditorialPlan {
  documentWidth: number; documentHeight: number; width: number; height: number
  grid: RustDocumentOutputGrid; layers: RustEditorialLayer[]
}
export interface RustDocumentMediaInput extends Omit<RustEditorialPlan, 'layers'> {
  layers: (Omit<RustEditorialLayer, 'source'> & {
    source: { type: 'raster'; blob: Blob } | { type: 'solid'; color: [number, number, number, number] } |
      RustDocumentShapeSource | RustDocumentTextPixels | RustDocumentStyledTextPixels | RustDocumentStyledShapeSource
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
function pixelAlignedSource(matrix: Matrix) {
  const rounded = matrix.map(Math.round), [a, b, c, d] = rounded as [number, number, number, number, number, number]
  return matrix.every((value, index) => Math.abs(value - rounded[index]!) <= 1e-9) &&
    a * a + b * b === 1 && c * c + d * d === 1 && a * c + b * d === 0
}
export function planRustEditorialDocument(document: DocumentSpec, layers: LayerItem[], width: number, height: number,
  viewport: DocumentBounds, boundsPolicy: RustDocumentBoundsPolicy = 'document', usePreviewSources = false): RustEditorialPlan {
  if (![width, height, document.width, document.height].every(value => Number.isSafeInteger(value) && value > 0) ||
      ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) ||
      viewport.width <= 0 || viewport.height <= 0) throw new RustPixelPocError('invalid-input')
  if (!['document', 'appearance'].includes(boundsPolicy) || boundsPolicy === 'appearance' &&
      ![viewport.x, viewport.y].every(value => Number.isSafeInteger(value) && Math.abs(value) <= 0xffffffff)) {
    throw new RustPixelPocError('invalid-input')
  }
  if (width > 16384 || height > 16384 || width * height * 4 > 64 * 1024 * 1024) throw new RustDocumentUnsupported('output-scale-or-size')
  const scaleX = width / viewport.width, scaleY = height / viewport.height, scaled = scaleX !== 1 || scaleY !== 1
  if (![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) throw new RustPixelPocError('invalid-input')
  // Saída com escala (exportação em outro DPI, miniatura) ou origem fracionária: o plano inteiro passa ao
  // espaço da saída, como a aparência isolada. As matrizes recebem escala e origem, a grade fica identidade
  // e os modos de amostragem decidem sobre a matriz efetiva; vetores e texto rasterizam na resolução da saída.
  const outputSpace = boundsPolicy === 'appearance' || scaled || ![viewport.x, viewport.y].every(Number.isSafeInteger)
  const light = normalizeLayerStyleGlobalLight(document.layerStyleGlobalLight)
  const shiftX = outputSpace ? viewport.x : 0, shiftY = outputSpace ? viewport.y : 0
  const result: RustEditorialPlan = { documentWidth: outputSpace ? width : document.width,
    documentHeight: outputSpace ? height : document.height,
    width, height, grid: { scaleX: 1, scaleY: 1, originX: viewport.x - shiftX, originY: viewport.y - shiftY }, layers: [] }
  const place = ([a, b, c, d, tx, ty]: Matrix): Matrix => scaled
    ? [a * scaleX, b * scaleY, c * scaleX, d * scaleY, (tx - shiftX) * scaleX, (ty - shiftY) * scaleY]
    : [a, b, c, d, tx - shiftX, ty - shiftY]
  // Rasters de texto/forma com estilo na resolução da saída, para não ampliar pixels na exportação.
  const rasterScale = Math.sqrt(scaleX * scaleY)
  let sourceBytes = 0, metadata = 0
  /** Fonte raster com estilos e matriz da camada: imagem ou texto com estilo. */
  function pushRaster(layer: LayerItem, transform: LayerTransform, source: RustEditorialLayer['source'],
    sourceWidth: number, sourceHeight: number, sourceIdentity: string, resolutionScale: number, identity: object) {
    const matrix = place(rustDocumentSourceMatrix(transform, sourceWidth, sourceHeight))
    const resampled = !pixelAlignedSource(matrix)
    // Ampliação e redução até 0,5 usam o bilinear compatível com Canvas; abaixo, a média de área.
    const sampling = resampled ? rustRasterSamplingMode(matrix, result.grid, layer.blendMode) : undefined
    // Rotação arbitrária fica no modo de cobertura (sem `sampling`); ver rustRotationCoverageSupported.
    if (resampled && !sampling && !rustRotationCoverageSupported(matrix, result.grid)) {
      throw new RustDocumentUnsupported('source-transform-quality')
    }
    const styles = normalizeLayerStyleConfig(layer.styles)
    metadata += rustPixelPocStyleMetadataBytes({ ...identity, styles })
    if (metadata > 512 * 1024) throw new RustPixelPocError('memory-limit')
    const input: RustPixelPocStyleSourceInput = { sourceIdentity, sourceWidth, sourceHeight, styles, globalLight: light,
      quality: 'final', resolutionScale }
    const layout = prepareRustStyleSourceLayout(input, 'document')
    sourceBytes += layout.width * layout.height * 4
    if (sourceBytes > RUST_DOCUMENT_SOURCE_BYTES || result.layers.length >= 32) throw new RustPixelPocError('memory-limit')
    result.layers.push({ source, input, matrix, opacity: layer.opacity,
      blendMode: layer.blendMode, ...(sampling ? { sampling } : {}) })
  }
  const background = layers.find(layer => layer.kind === 'background')
  if (background?.visible && !background.image && document.background !== 'transparent') {
    const color = document.background === 'black' ? 0 : 255
    // Fundo com estilo: retângulo do tamanho do documento pelo caminho de forma com estilo.
    if (activeLayerStyleEffects(background.styles).length || !layerStyleBlendIfIsDefault(background.styles.blendIf)) {
      const transform = { x: 0, y: 0, width: document.width, height: document.height, rotation: 0 }
      const styled = planRustDocumentStyledShape({ ...DEFAULT_SHAPE_CONFIG, kind: 'rectangle', cornerRadius: 0,
        color: color ? '#ffffff' : '#000000', baseWidth: document.width, baseHeight: document.height }, transform, rasterScale)
      pushRaster({ ...background, blendMode: 'normal' }, transform, styled.source, styled.source.width, styled.source.height,
        'document-background', styled.effectScale, { id: background.id, shape: styled.source.shape })
    } else result.layers.push({ source: { type: 'solid', color: [color, color, color, 255] },
      input: { sourceIdentity: 'document-background', sourceWidth: 1, sourceHeight: 1,
        styles: normalizeLayerStyleConfig({}), globalLight: light },
      matrix: place([document.width, 0, 0, document.height, 0, 0]),
      opacity: background.opacity * layerStyleFillOpacity(background.styles), blendMode: 'normal' })
  }
  for (const layer of [...layers].reverse()) {
    if (!layer.visible || !layer.transform || !styledLayerIntersectsBounds(layer, viewport, light)) continue
    if (!layer.image && layer.shape && !layer.text) {
      if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 100) throw new RustPixelPocError('invalid-input')
      // Com efeitos ou Mesclar se a forma vira raster da camada com estilos, como texto com estilo.
      if (activeLayerStyleEffects(layer.styles).length || !layerStyleBlendIfIsDefault(layer.styles.blendIf)) {
        const styled = planRustDocumentStyledShape(layer.shape, layer.transform, rasterScale)
        pushRaster(layer, layer.transform, styled.source, styled.source.width, styled.source.height, `shape:${layer.id}`,
          styled.effectScale, { id: layer.id, shape: styled.source.shape })
        continue
      }
      const transform = { ...layer.transform, x: layer.transform.x - shiftX, y: layer.transform.y - shiftY }
      const source = planRustDocumentShape(layer.shape, transform, result.documentWidth, result.documentHeight,
        (layer.opacity / 100) * layerStyleFillOpacity(layer.styles), scaleX, scaleY)
      if (!source) continue
      sourceBytes += source.width * source.height * 4
      metadata += rustPixelPocStyleMetadataBytes(source)
      if (sourceBytes > RUST_DOCUMENT_SOURCE_BYTES || result.layers.length >= 32 || metadata > 512 * 1024) {
        throw new RustPixelPocError('memory-limit')
      }
      result.layers.push({ source, input: { sourceIdentity: `shape:${layer.id}`, sourceWidth: source.width,
        sourceHeight: source.height, styles: normalizeLayerStyleConfig({}), globalLight: light, quality: 'final' },
        matrix: [1, 0, 0, 1, source.originX, source.originY], opacity: 100, blendMode: layer.blendMode })
      continue
    }
    if (!layer.image && layer.text && !layer.shape) {
      if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 100) throw new RustPixelPocError('invalid-input')
      // Texto é desenhado isolado e mesclado uma vez, como no preview (decisão do contrato de texto, seção 4).
      if (!rustDocumentTextFontsReady(layer.text)) throw new RustDocumentUnsupported('text-font-pending')
      // Com composição de estilo o legado desenha o texto num raster da camada e o trata como imagem.
      if (layerStyleNeedsCompositing(layer.styles) || !layerStyleBlendIfIsDefault(layer.styles.blendIf)) {
        const styled = planRustDocumentStyledText(layer.text, layer.transform, rasterScale)
        pushRaster(layer, layer.transform, styled.source, styled.source.width, styled.source.height, `text:${layer.id}`, styled.effectScale,
          { id: layer.id, text: styled.source.text })
        continue
      }
      const transform = { ...layer.transform, x: layer.transform.x - shiftX, y: layer.transform.y - shiftY }
      const source = planRustDocumentText(layer.text, transform, result.documentWidth, result.documentHeight, layer.opacity / 100,
        scaleX, scaleY)
      if (!source) continue
      sourceBytes += source.width * source.height * 4
      metadata += rustPixelPocStyleMetadataBytes(source)
      if (sourceBytes > RUST_DOCUMENT_SOURCE_BYTES || result.layers.length >= 32 || metadata > 512 * 1024) {
        throw new RustPixelPocError('memory-limit')
      }
      result.layers.push({ source, input: { sourceIdentity: `text:${layer.id}`, sourceWidth: source.width,
        sourceHeight: source.height, styles: normalizeLayerStyleConfig({}), globalLight: light, quality: 'final' },
        matrix: [1, 0, 0, 1, source.originX, source.originY], opacity: 100, blendMode: layer.blendMode })
      continue
    }
    if (!layer.image) throw new RustDocumentUnsupported('non-image-layer')
    const transform = layer.transform
    // Miniaturas e prévias interativas usam a versão reduzida da imagem, como o legado.
    const preview = usePreviewSources && layer.image.previewUrl ? layer.image : undefined
    const image = preview ? { ...preview, sourceUrl: preview.previewUrl!, width: preview.previewWidth ?? preview.width,
      height: preview.previewHeight ?? preview.height } : layer.image
    // Rotação com redução abaixo de 0,5: o decodificador já entrega a fonte reduzida (resize de
    // createImageBitmap), no menor tamanho que devolve as duas escalas a ≥ 0,5 e ao modo de cobertura.
    const rotated = !rustRasterAxisScales(rustDocumentSourceMatrix(transform, image.width, image.height))
    const reduce = (size: number, display: number) =>
      rotated && display / size < 0.5 ? Math.max(1, Math.floor(display * 2)) : size
    const sourceWidth = reduce(image.width, transform.width * scaleX), sourceHeight = reduce(image.height, transform.height * scaleY)
    pushRaster(layer, transform, { type: 'raster', url: image.sourceUrl }, sourceWidth, sourceHeight,
      `${layer.id}:${image.editToken ?? ''}:${image.sourceUrl}`,
      1 / Math.sqrt(transform.width / sourceWidth * (transform.height / sourceHeight)), { id: layer.id, url: image.sourceUrl })
  }
  if (rustPixelPocStyleMetadataBytes(result) > 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return structuredClone(result)
}

export function rustEditorialUnderlying(input: RustPixelPocStyleSourceInput) {
  const styles = normalizeLayerStyleConfig(input.styles)
  return layerStyleBlendIfUsesUnderlying(styles.blendIf) ? { channel: styles.blendIf.channel,
    shadows: styles.blendIf.underlyingLayer.shadows, highlights: styles.blendIf.underlyingLayer.highlights } : undefined
}
