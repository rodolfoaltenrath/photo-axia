import type { ImageAsset, LayerItem, LayerStyleConfig, LayerTransform } from '../types/editor.ts'
import { createLayerStyleConfig } from './layerStyles.ts'
import type { RenderedLayerAppearance } from '../services/renderDocument.ts'

export function layerCanRasterize(layer?: LayerItem) {
  if (!layer || layer.kind === 'adjustment' || layer.kind === 'pixel') return false
  return Boolean((layer.transform && (layer.image || layer.text)) || (layer.kind === 'background' && !layer.image))
}

export interface RasterizedLayerPatch {
  kind: 'pixel'
  image: ImageAsset
  smart: undefined
  text: undefined
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
