import type { ImageAsset, LayerItem, LayerStyleConfig, LayerTransform } from '../types/editor.ts'
import { createLayerStyleConfig } from './layerStyles.ts'
import type { RenderedLayerAppearance } from '../services/renderDocument.ts'

export function layerCanRasterize(layer?: LayerItem) {
  if (!layer || layer.kind === 'adjustment' || layer.kind === 'pixel') return false
  return Boolean((layer.transform && (layer.image || layer.text)) || (layer.kind === 'background' && !layer.image))
}

// Raster layers (image/background/pixel) keep rotation as CSS metadata during
// a drag, but once a rotated transform commits it gets baked into the pixels
// and reset to an axis-aligned box — matching how Photoshop settles a Free
// Transform on an ordinary pixel layer, so the next Ctrl+T starts straight.
export function layerSupportsRotationBaking(layer?: LayerItem) {
  return Boolean(
    layer?.image &&
    (layer.kind === 'image' || layer.kind === 'background' || layer.kind === 'pixel')
  )
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
