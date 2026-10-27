import { prepareRustStyleSourceLayout, prepareRustStyleJob, padRustStyleSource } from './rustPixelPocStylePreparation.ts'
import { decodeRustStyleSource, prepareRustStyleAssets, decodeRustStyleAssets } from './rustPixelPocMedia.ts'
import { readRustStyleImageDimensions } from './rustStyleImageHeader.ts'
import { encodeStyledDocument } from './rustStyledDocument.ts'
import { rustEditorialUnderlying, type RustDocumentMediaInput } from './rustDocumentEditorial.ts'
import type { RustDocumentRasterLayer } from './rustDocumentComposite.ts'
import { prepareRustStyleStages, type RustPixelPocStagesPlan } from './rustPixelPocStages.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_DOCUMENT_ENCODED_BYTES, RUST_DOCUMENT_SOURCE_BYTES } from './rustDocumentBudget.ts'
import { rustPixelPocStyleMetadataBytes } from './rustPixelPocStyleInput.ts'
import { drawRustDocumentShape, validateRustDocumentShape } from './rustDocumentShape.ts'
import { validateRustDocumentTextPixels } from './rustDocumentText.ts'
import { activeLayerStyleEffects } from './layerStyleCompositor.ts'
import { layerStyleBlendIfIsDefault } from './layerStyles.ts'
import { rustRasterSamplingSupported } from './rustDocumentSampling.ts'

export function rustStylePlanIsIdentity(plan: RustPixelPocStagesPlan) {
  return plan.fillOpacity === 100 && plan.thisLayerBlendIf === undefined && !plan.external.length &&
    !plan.internal.length && !plan.overlay.length && !plan.upper.length
}

export async function prepareRustDocumentMedia(input: RustDocumentMediaInput, check: () => void) {
  check()
  if (!input || !Array.isArray(input.layers) || input.layers.length > 32) throw new RustPixelPocError('invalid-input')
  if (rustPixelPocStyleMetadataBytes(input) > 1024 * 1024) throw new RustPixelPocError('memory-limit')
  let encoded = 0, padded = 0
  const layouts = input.layers.map(layer => {
    if (layer.sampling !== undefined && (layer.source.type !== 'raster' ||
        !['raster-bilinear', 'raster-bilinear-precise', 'raster-area'].includes(layer.sampling) ||
        !Array.isArray(layer.matrix) || !rustRasterSamplingSupported(layer.matrix, input.grid, layer.sampling))) throw new RustPixelPocError('invalid-input')
    const layout = prepareRustStyleSourceLayout(layer.input, 'document')
    if (layout.width > 16384 || layout.height > 16384) throw new RustPixelPocError('memory-limit')
    padded += layout.width * layout.height * 4
    if (layer.source.type === 'raster') {
      if (!(layer.source.blob instanceof Blob)) throw new RustPixelPocError('invalid-input')
      encoded += layer.source.blob.size
    } else if (layer.source.type === 'shape') {
      const source = layer.source, matrix = [1, 0, 0, 1, source.originX, source.originY]
      validateRustDocumentShape(source, input.documentWidth, input.documentHeight)
      if (layer.input.sourceWidth !== source.width || layer.input.sourceHeight !== source.height ||
          layer.opacity !== 100 || layer.input.styles.fillOpacity !== 100 || activeLayerStyleEffects(layer.input.styles).length ||
          !layerStyleBlendIfIsDefault(layer.input.styles.blendIf) ||
          !Array.isArray(layer.matrix) || layer.matrix.length !== 6 || matrix.some((value, index) => value !== layer.matrix[index])) {
        throw new RustPixelPocError('invalid-input')
      }
    } else if (layer.source.type === 'text-pixels') {
      // Texto chega pronto da thread principal: 1:1, opacidade incorporada, sem estilos e só Normal.
      const source = layer.source, matrix = [1, 0, 0, 1, source.originX, source.originY]
      validateRustDocumentTextPixels(source, input.documentWidth, input.documentHeight)
      if (layer.input.sourceWidth !== source.width || layer.input.sourceHeight !== source.height ||
          layer.opacity !== 100 || layer.blendMode !== 'normal' || layer.input.styles.fillOpacity !== 100 ||
          activeLayerStyleEffects(layer.input.styles).length || !layerStyleBlendIfIsDefault(layer.input.styles.blendIf) ||
          !Array.isArray(layer.matrix) || layer.matrix.length !== 6 || matrix.some((value, index) => value !== layer.matrix[index])) {
        throw new RustPixelPocError('invalid-input')
      }
    } else if (layer.source.type !== 'solid' || layer.input.sourceWidth !== 1 || layer.input.sourceHeight !== 1 ||
        !Array.isArray(layer.source.color) || layer.source.color.length !== 4 ||
        layer.source.color.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new RustPixelPocError('invalid-input')
    }
    const assets = prepareRustStyleAssets(layout, layer.patterns)
    for (const blob of Object.values(layer.patterns)) encoded += blob.size
    padded += assets.decodedBytes
    if (padded > RUST_DOCUMENT_SOURCE_BYTES || encoded > RUST_DOCUMENT_ENCODED_BYTES) throw new RustPixelPocError('memory-limit')
    return { layout, assets }
  })
  const layers: RustDocumentRasterLayer[] = [], plans: (RustPixelPocStagesPlan | null)[] = []
  for (let index = 0; index < input.layers.length; index++) {
    check()
    const layer = input.layers[index]!, { layout, assets } = layouts[index]!
    if (layer.source.type === 'raster') {
      const intrinsic = await readRustStyleImageDimensions(layer.source.blob, check)
      if (intrinsic.bytes > RUST_DOCUMENT_SOURCE_BYTES) throw new RustPixelPocError('memory-limit')
    }
    const source = layer.source.type === 'raster' ? await decodeRustStyleSource(layer.source, layout, check) :
      layer.source.type === 'shape' ? drawRustDocumentShape(layer.source, check) :
      layer.source.type === 'text-pixels'
        ? { width: layer.source.width, height: layer.source.height, data: new Uint8ClampedArray(layer.source.rgba) }
        : { width: 1, height: 1, data: new Uint8ClampedArray(layer.source.color) }
    const patterns = await decodeRustStyleAssets(assets, check)
    // Sem efeitos, Fill 100 e sem Blend If próprio o STG1 só copiaria a fonte (prova em stages.rs):
    // dispensá-lo evita a cópia estilizada residente, o pico 2× e as quotas de estágio no núcleo.
    const styled = layer.source.type !== 'shape' && layer.source.type !== 'text-pixels' &&
      !rustStylePlanIsIdentity(prepareRustStyleStages(layout.styles, layout.light, layout.scale, patterns))
    plans.push(styled ? prepareRustStyleJob({ ...layer.input, patterns }, 'document').plan : null)
    const rgba = padRustStyleSource(source, layout, true), [a, b, c, d, tx, ty] = layer.matrix
    layers.push({ rgba, width: layout.width, height: layout.height, x: 0, y: 0, visible: true,
      opacity: layer.opacity, blendMode: layer.blendMode,
      ...(layer.sampling ? { sampling: layer.sampling } : {}),
      sourceToDocument: [a, b, c, d, tx + a * layout.offsetX + c * layout.offsetY, ty + b * layout.offsetX + d * layout.offsetY],
      underlyingBlendIf: rustEditorialUnderlying(layer.input) })
  }
  check()
  return encodeStyledDocument({ documentWidth: input.documentWidth, documentHeight: input.documentHeight,
    region: { x: 0, y: 0, width: Math.min(256, input.width), height: Math.min(256, input.height) },
    resolutionScale: 1, outputGrid: input.grid, layersBottomToTop: layers }, plans)
}
