import type { LayerStyleRenderQuality } from './layerStyleCompositor.ts'
import { activeLayerStyleEffects } from './layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import { rasterPreviewSnapshot, type RustPixelPocPreviewSnapshot } from './rustPixelPocPreviewObserver.ts'
import { RustPixelPocError } from './rustPixelPocRuntime.ts'

export interface RustPixelPocStyledRasterIdentity {
  /** Revise for source edits, including text and shape changes. */
  contentKey: string
  /** Revise for decoded pattern/texture changes. */
  assetKey: string
  width: number
  height: number
  offsetX: number
  offsetY: number
  resolutionScale: number
  quality: LayerStyleRenderQuality
}

type PreviewArguments = Parameters<typeof rasterPreviewSnapshot>

/** Identity of styled pixels before either Blend If filter. */
export function styledRasterPreviewSnapshot(
  document: PreviewArguments[0],
  layer: PreviewArguments[1],
  transform: PreviewArguments[2],
  viewport: PreviewArguments[3],
  raster: RustPixelPocStyledRasterIdentity | null
): RustPixelPocPreviewSnapshot {
  const snapshot = rasterPreviewSnapshot(document, layer, transform, viewport)
  if (!raster) return { ...snapshot, sourceKey: null }
  if (typeof raster.contentKey !== 'string' || !raster.contentKey ||
      typeof raster.assetKey !== 'string' ||
      !Number.isSafeInteger(raster.width) || !Number.isSafeInteger(raster.height) ||
      raster.width <= 0 || raster.height <= 0 ||
      raster.width * raster.height * 4 > 64 * 1024 * 1024 ||
      !Number.isSafeInteger(raster.offsetX) || !Number.isSafeInteger(raster.offsetY) ||
      !Number.isFinite(raster.resolutionScale) || raster.resolutionScale <= 0 ||
      (raster.quality !== 'interactive' && raster.quality !== 'final')) {
    throw new RustPixelPocError('invalid-input')
  }
  const styles = normalizeLayerStyleConfig(layer.styles)
  const effects = activeLayerStyleEffects(styles)
  const usesGlobalLight = effects.some(effect =>
    (effect.type === 'drop-shadow' || effect.type === 'inner-shadow' || effect.type === 'bevel-emboss') &&
    effect.useGlobalLight)
  return {
    ...snapshot,
    sourceKey: JSON.stringify([
      'styled-before-blend-if-v1', document.id, layer.id, layer.kind, snapshot.sourceKey,
      document.colorSpace, document.resolutionDpi, raster.contentKey, raster.assetKey,
      raster.width, raster.height, raster.offsetX, raster.offsetY,
      raster.resolutionScale, raster.quality,
      styles.fillOpacity, effects, usesGlobalLight ? normalizeLayerStyleGlobalLight(document.layerStyleGlobalLight) : null
    ])
  }
}
