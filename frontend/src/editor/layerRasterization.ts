import type { ImageAsset, LayerItem, LayerStyleConfig, LayerTransform } from '../types/editor.ts'
import { createLayerStyleConfig, layerStyleBlendIfUsesUnderlying } from './layerStyles.ts'
import type { RenderedLayerAppearance } from '../services/renderDocument.ts'

export function layerCanRasterize(layer?: LayerItem) {
  if (!layer || layer.kind === 'adjustment' || layer.kind === 'pixel') return false
  if (layerStyleBlendIfUsesUnderlying(layer.styles.blendIf)) return false
  return Boolean((layer.transform && (layer.image || layer.text || layer.shape)) || (layer.kind === 'background' && !layer.image))
}

// Bake raster rotation only on commit, never during drag.
export function layerSupportsRotationBaking(layer?: LayerItem) {
  return Boolean(
    layer?.image &&
    (layer.kind === 'background' || layer.kind === 'pixel') &&
    !layerStyleBlendIfUsesUnderlying(layer.styles.blendIf)
  )
}

export interface RasterizedLayerPatch {
  kind: 'pixel'
  image: ImageAsset
  smart: undefined
  text: undefined
  shape: undefined
  transform: LayerTransform
  styles: LayerStyleConfig
}

export function rasterizedLayerPatch(
  appearance: Pick<RenderedLayerAppearance, 'x' | 'y' | 'width' | 'height'>,
  image: ImageAsset
): RasterizedLayerPatch {
  return {
    kind: 'pixel',
    image: { ...image },
    smart: undefined,
    text: undefined,
    shape: undefined,
    transform: {
      x: appearance.x,
      y: appearance.y,
      width: appearance.width,
      height: appearance.height,
      rotation: 0
    },
    styles: createLayerStyleConfig()
  }
}
