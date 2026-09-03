import type { DocumentSpec, ImageAsset, LayerItem } from '../types/editor.ts'
import { layerStyleNeedsCompositing } from './layerStyleCompositor.ts'
import { createLayerStyleConfig } from './layerStyles.ts'

function layerHasVisualContent(layer: LayerItem, document: Pick<DocumentSpec, 'background'>) {
  if (!layer.visible || layer.kind === 'adjustment') return false
  if (layer.kind === 'background' && !layer.image) return document.background !== 'transparent'
  return Boolean(layer.image || layer.text || layer.shape || (layer.kind === 'smart' && layer.smart))
}

export function documentCanFlatten(document: Pick<DocumentSpec, 'width' | 'height' | 'background'>, layers: readonly LayerItem[]) {
  if (!layers.some((layer) => layerHasVisualContent(layer, document))) return false
  if (layers.length !== 1) return true
  const layer = layers[0]!
  return layer.kind !== 'pixel' || !layer.image || !layer.transform ||
    layer.transform.x !== 0 || layer.transform.y !== 0 ||
    layer.transform.width !== document.width || layer.transform.height !== document.height ||
    (layer.transform.rotation ?? 0) !== 0 || layer.opacity !== 100 || layer.blendMode !== 'normal' ||
    layerStyleNeedsCompositing(layer.styles)
}

export function createFlattenedLayer(document: Pick<DocumentSpec, 'width' | 'height'>, image: ImageAsset, id: string): LayerItem {
  return {
    id,
    name: 'Imagem achatada',
    visible: true,
    opacity: 100,
    blendMode: 'normal',
    kind: 'pixel',
    styles: createLayerStyleConfig(),
    image: { ...image },
    transform: { x: 0, y: 0, width: document.width, height: document.height, rotation: 0 }
  }
}
