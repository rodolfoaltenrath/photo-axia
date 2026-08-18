import type { DocumentSpec, LayerItem, SmartLayerContent } from '../types/editor.ts'
import { cloneSmartLayerContent, cloneSmartLayerSource, smartLayerContentHash } from './smartLayers.ts'

export function createSmartLayerEditDocument(layer: LayerItem): DocumentSpec {
  const content = layer.smart
  if (layer.kind !== 'smart' || !content) throw new Error('A camada não possui conteúdo inteligente editável.')
  return {
    id: `smart:${content.id}`,
    name: layer.name,
    width: content.width,
    height: content.height,
    unit: 'px',
    physicalWidth: content.width,
    physicalHeight: content.height,
    resolutionDpi: content.resolutionDpi,
    colorSpace: content.colorSpace,
    background: content.background,
    createdAt: '',
    layerStyleGlobalLight: { ...content.layerStyleGlobalLight }
  }
}

export function createEditedSmartLayerContent(
  source: SmartLayerContent,
  document: DocumentSpec,
  layers: readonly LayerItem[]
): SmartLayerContent {
  return {
    ...cloneSmartLayerContent(source)!,
    width: document.width,
    height: document.height,
    resolutionDpi: document.resolutionDpi,
    colorSpace: document.colorSpace,
    background: document.background,
    layerStyleGlobalLight: { ...document.layerStyleGlobalLight },
    layers: layers.map(cloneSmartLayerSource),
    revision: Math.max(1, Math.floor(source.revision)) + 1
  }
}

export function smartLayerEditHasChanges(before: SmartLayerContent, after: SmartLayerContent) {
  return smartLayerContentHash(before) !== smartLayerContentHash(after)
}
