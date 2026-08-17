import type { LayerItem, LayerStyleGlobalLight } from '../types/editor'
import type { HistoryDirection } from './history'
import type { SelectionRegion } from './selection'
import type { EditorGuide } from './guides'
import { cloneLayerStyleConfig, createLayerStyleConfig, layerStylePatternAssets } from './layerStyles.ts'

interface SelectionDelta {
  activeBefore?: string
  activeAfter?: string
}

export interface LayerHistoryItem {
  index: number
  layer: LayerItem
}

export interface AddLayersDelta extends SelectionDelta {
  type: 'layers:add'
  items: LayerHistoryItem[]
}

export interface RemoveLayersDelta extends SelectionDelta {
  type: 'layers:remove'
  items: LayerHistoryItem[]
}

export interface ReplaceLayersDelta extends SelectionDelta {
  type: 'layers:replace'
  before: LayerHistoryItem[]
  after: LayerHistoryItem[]
}

export interface PatchLayerDelta extends SelectionDelta {
  type: 'layer:patch'
  layerId: string
  before: Partial<LayerItem>
  after: Partial<LayerItem>
  selectionBefore?: SelectionRegion | null
  selectionAfter?: SelectionRegion | null
}

export interface ReorderLayerDelta extends SelectionDelta {
  type: 'layer:reorder'
  layerId: string
  beforeIndex: number
  afterIndex: number
}

export interface ChangeGuidesDelta {
  type: 'guides:change'
  before: EditorGuide[]
  after: EditorGuide[]
}

export interface ChangeLayerStyleGlobalLightDelta {
  type: 'document:global-light'
  before: LayerStyleGlobalLight
  after: LayerStyleGlobalLight
}

export type EditorHistoryDelta =
  | AddLayersDelta
  | RemoveLayersDelta
  | ReplaceLayersDelta
  | PatchLayerDelta
  | ReorderLayerDelta
  | ChangeGuidesDelta
  | ChangeLayerStyleGlobalLightDelta

export function cloneLayerState(layer: LayerItem): LayerItem {
  return {
    ...layer,
    image: layer.image ? { ...layer.image } : undefined,
    text: layer.text ? { ...layer.text } : undefined,
    transform: layer.transform ? { ...layer.transform } : undefined,
    styles: layer.styles ? cloneLayerStyleConfig(layer.styles) : createLayerStyleConfig()
  }
}

export function cloneLayerPatch(patch: Partial<LayerItem>): Partial<LayerItem> {
  const cloned = { ...patch }
  if ('image' in patch) cloned.image = patch.image ? { ...patch.image } : patch.image
  if ('text' in patch) cloned.text = patch.text ? { ...patch.text } : patch.text
  if ('transform' in patch) cloned.transform = patch.transform ? { ...patch.transform } : patch.transform
  if ('styles' in patch) cloned.styles = patch.styles ? cloneLayerStyleConfig(patch.styles) : patch.styles
  return cloned
}

export function mergeEditorHistoryDelta(previous: EditorHistoryDelta, next: EditorHistoryDelta) {
  if (previous.type === 'guides:change' && next.type === 'guides:change') {
    return { ...next, before: previous.before.map((guide) => ({ ...guide })) } satisfies ChangeGuidesDelta
  }
  if (previous.type === 'document:global-light' && next.type === 'document:global-light') {
    return { ...next, before: { ...previous.before } } satisfies ChangeLayerStyleGlobalLightDelta
  }
  if (previous.type !== 'layer:patch' || next.type !== 'layer:patch' || previous.layerId !== next.layerId) {
    return next
  }

  return {
    ...next,
    before: previous.before,
    activeBefore: previous.activeBefore,
    selectionBefore: previous.selectionBefore
  } satisfies PatchLayerDelta
}

export function estimateEditorHistoryBytes(delta: EditorHistoryDelta) {
  const referencedImageBytes = delta.type === 'layer:patch'
    ? [delta.before.image, delta.after.image].reduce((total, image) => total + (image?.byteSize ?? 0), 0)
    : historyDeltaLayers(delta).reduce((total, layer) => total + (layer.image?.byteSize ?? 0), 0)
  const styleAssets = delta.type === 'layer:patch'
    ? [...layerStylePatternAssets(delta.before.styles), ...layerStylePatternAssets(delta.after.styles)]
    : historyDeltaLayers(delta).flatMap((layer) => layerStylePatternAssets(layer.styles))
  const referencedStyleBytes = [...new Map(styleAssets.map((asset) => [asset.sourceUrl, asset])).values()]
    .reduce((total, asset) => total + (asset.byteSize ?? 0), 0)
  return JSON.stringify(delta).length * 2 + referencedImageBytes + referencedStyleBytes + 96
}

export function isEditorHistoryDeltaNoop(delta: EditorHistoryDelta) {
  if (delta.type === 'guides:change') return JSON.stringify(delta.before) === JSON.stringify(delta.after)
  if (delta.type === 'document:global-light') return JSON.stringify(delta.before) === JSON.stringify(delta.after)
  if (delta.type === 'layer:patch') {
    return JSON.stringify(delta.before) === JSON.stringify(delta.after) &&
      JSON.stringify(delta.selectionBefore) === JSON.stringify(delta.selectionAfter)
  }
  if (delta.type === 'layer:reorder') return delta.beforeIndex === delta.afterIndex
  return false
}

export function historyDeltaLayers(delta: EditorHistoryDelta) {
  if (delta.type === 'layers:replace') return [...delta.before, ...delta.after].map((item) => item.layer)
  return delta.type === 'layers:add' || delta.type === 'layers:remove'
    ? delta.items.map((item) => item.layer)
    : []
}

export function historyDeltaObjectUrls(delta: EditorHistoryDelta) {
  const urls = new Set<string>()
  const collect = (layer: Partial<LayerItem>) => {
    for (const source of [layer.image?.sourceUrl, layer.image?.previewUrl]) {
      if (source?.startsWith('blob:')) urls.add(source)
    }
    for (const asset of layerStylePatternAssets(layer.styles)) {
      if (asset.sourceUrl.startsWith('blob:')) urls.add(asset.sourceUrl)
    }
  }
  if (delta.type === 'layers:replace') {
    for (const item of [...delta.before, ...delta.after]) collect(item.layer)
  } else if (delta.type === 'layers:add' || delta.type === 'layers:remove') {
    for (const item of delta.items) collect(item.layer)
  } else if (delta.type === 'layer:patch') {
    collect(delta.before)
    collect(delta.after)
  }
  return [...urls]
}

export function applyEditorHistoryDelta(
  layers: LayerItem[],
  activeLayerId: string,
  delta: EditorHistoryDelta,
  direction: HistoryDirection
) {
  const redo = direction === 'redo'
  const insertedLayers: LayerItem[] = []
  const removedLayerIds: string[] = []
  const refreshLayerIds: string[] = []

  if (delta.type === 'guides:change' || delta.type === 'document:global-light') {
    return { activeLayerId, insertedLayers, refreshLayerIds, removedLayerIds }
  }

  const insert = (items: LayerHistoryItem[]) => {
    for (const item of [...items].sort((first, second) => first.index - second.index)) {
      const layer = cloneLayerState(item.layer)
      layers.splice(Math.min(item.index, layers.length), 0, layer)
      insertedLayers.push(layer)
      if (layer.image) refreshLayerIds.push(layer.id)
    }
  }
  const remove = (items: LayerHistoryItem[]) => {
    const ids = new Set(items.map((item) => item.layer.id))
    for (let index = layers.length - 1; index >= 0; index--) {
      if (!ids.has(layers[index]!.id)) continue
      const [layer] = layers.splice(index, 1)
      removedLayerIds.push(layer!.id)
      if (layer!.image) refreshLayerIds.push(layer!.id)
    }
  }

  if (delta.type === 'layers:replace') {
    remove(redo ? delta.before : delta.after)
    insert(redo ? delta.after : delta.before)
  } else if (delta.type === 'layers:add') {
    if (redo) insert(delta.items)
    else remove(delta.items)
  } else if (delta.type === 'layers:remove') {
    if (redo) remove(delta.items)
    else insert(delta.items)
  } else if (delta.type === 'layer:patch') {
    const layer = layers.find((item) => item.id === delta.layerId)
    if (layer) {
      const patch = cloneLayerPatch(redo ? delta.after : delta.before)
      Object.assign(layer, patch)
      if (layer.image && (patch.transform || patch.image || patch.styles)) refreshLayerIds.push(layer.id)
    }
  } else {
    const index = layers.findIndex((layer) => layer.id === delta.layerId)
    if (index >= 0) {
      const [layer] = layers.splice(index, 1)
      const targetIndex = redo ? delta.afterIndex : delta.beforeIndex
      layers.splice(Math.min(targetIndex, layers.length), 0, layer!)
    }
  }

  const selectedId = redo ? delta.activeAfter : delta.activeBefore
  const nextActiveId = selectedId && layers.some((layer) => layer.id === selectedId)
    ? selectedId
    : layers.some((layer) => layer.id === activeLayerId)
      ? activeLayerId
      : layers[0]!.id

  return { activeLayerId: nextActiveId, insertedLayers, refreshLayerIds, removedLayerIds }
}
