import type {
  DocumentSpec,
  ImageAsset,
  LayerItem,
  SmartLayerContent
} from '../types/editor.ts'
import { cloneLayerStyleConfig, createLayerStyleConfig } from './layerStyles.ts'

export const SMART_LAYER_MAX_DEPTH = 8
export type SmartLayerRenderQuality = 'interactive' | 'final'

export interface IndexedLayerItem {
  index: number
  layer: LayerItem
}

export interface SmartLayerAppearance {
  x: number
  y: number
  width: number
  height: number
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) sorted[key] = stableValue(source[key])
  return sorted
}

function smartContentLayerIdentity(layer: LayerItem): unknown {
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    blendMode: layer.blendMode,
    kind: layer.kind,
    styles: layer.styles,
    image: layer.kind === 'smart' ? undefined : layer.image
      ? {
          width: layer.image.width,
          height: layer.image.height,
          mimeType: layer.image.mimeType,
          sourceUrl: layer.image.sourceUrl,
          byteSize: layer.image.byteSize,
          editToken: layer.image.editToken
        }
      : undefined,
    smart: layer.smart ? {
      id: layer.smart.id,
      revision: layer.smart.revision,
      hash: smartLayerContentHash(layer.smart)
    } : undefined,
    text: layer.text,
    transform: layer.transform
  }
}

export function smartLayerContentHash(content: SmartLayerContent) {
  const payload = JSON.stringify(stableValue({
    width: content.width,
    height: content.height,
    resolutionDpi: content.resolutionDpi,
    colorSpace: content.colorSpace,
    background: content.background,
    layerStyleGlobalLight: content.layerStyleGlobalLight,
    layers: content.layers.map(smartContentLayerIdentity)
  }))
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index++) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function smartLayerCacheKey(
  content: SmartLayerContent,
  width: number,
  height: number,
  quality: SmartLayerRenderQuality
) {
  return [
    content.id,
    Math.max(1, Math.floor(content.revision)),
    smartLayerContentHash(content),
    `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`,
    quality
  ].join('|')
}

export function cloneSmartLayerContent(content?: SmartLayerContent): SmartLayerContent | undefined {
  if (!content) return undefined
  return {
    ...content,
    layerStyleGlobalLight: { ...content.layerStyleGlobalLight },
    layers: content.layers.map(cloneSmartLayerSource)
  }
}

export function cloneSmartLayerSource(layer: LayerItem): LayerItem {
  return {
    ...layer,
    image: layer.image ? { ...layer.image } : undefined,
    smart: cloneSmartLayerContent(layer.smart),
    text: layer.text ? { ...layer.text } : undefined,
    transform: layer.transform ? { ...layer.transform } : undefined,
    styles: cloneLayerStyleConfig(layer.styles)
  }
}

export function smartLayerDepth(layer: LayerItem): number {
  if (!layer.smart) return 0
  return 1 + Math.max(0, ...layer.smart.layers.map(smartLayerDepth))
}

export function layersCanConvertToSmart(items: readonly IndexedLayerItem[]) {
  if (items.some(({ layer }) => layer.kind === 'smart')) return false
  const hasVisualContent = items.some(({ layer }) => Boolean(layer.image || layer.text || layer.kind === 'background'))
  const hasVisibleContent = items.some(({ layer }) => layer.visible && Boolean(layer.image || layer.text || layer.kind === 'background'))
  return items.length > 0 && hasVisualContent && (items.length === 1 || hasVisibleContent) &&
    items.every(({ layer }) => layer.kind !== 'adjustment' && smartLayerDepth(layer) < SMART_LAYER_MAX_DEPTH)
}

function translateLayerToContent(layer: LayerItem, offsetX: number, offsetY: number) {
  const cloned = cloneSmartLayerSource(layer)
  if (cloned.transform) {
    cloned.transform.x -= offsetX
    cloned.transform.y -= offsetY
  }
  return cloned
}

export function createSmartLayer(
  document: Pick<DocumentSpec, 'resolutionDpi' | 'colorSpace' | 'background' | 'layerStyleGlobalLight'>,
  items: readonly IndexedLayerItem[],
  appearance: SmartLayerAppearance,
  cache: ImageAsset,
  id: string
): LayerItem {
  if (!layersCanConvertToSmart(items)) throw new Error('As camadas selecionadas não podem formar uma camada inteligente.')
  const single = items.length === 1 ? items[0]!.layer : undefined
  const internalLayers = items.map(({ layer }) => translateLayerToContent(layer, appearance.x, appearance.y))

  if (single) {
    internalLayers[0]!.visible = true
    internalLayers[0]!.opacity = 100
    internalLayers[0]!.blendMode = 'normal'
  }

  const smart: SmartLayerContent = {
    id,
    width: appearance.width,
    height: appearance.height,
    resolutionDpi: document.resolutionDpi,
    colorSpace: document.colorSpace,
    background: document.background,
    layerStyleGlobalLight: { ...document.layerStyleGlobalLight },
    layers: internalLayers,
    revision: 1
  }

  return {
    id,
    name: single?.name ?? `Camada inteligente (${items.length})`,
    visible: single?.visible ?? true,
    opacity: single?.opacity ?? 100,
    blendMode: single?.blendMode ?? 'normal',
    kind: 'smart',
    styles: createLayerStyleConfig(),
    image: { ...cache },
    smart,
    transform: {
      x: appearance.x,
      y: appearance.y,
      width: appearance.width,
      height: appearance.height,
      rotation: 0
    }
  }
}

export function smartLayerObjectLayers(layer: LayerItem): LayerItem[] {
  return layer.smart
    ? [layer, ...layer.smart.layers.flatMap(smartLayerObjectLayers)]
    : [layer]
}
