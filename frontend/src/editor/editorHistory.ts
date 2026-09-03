import type { LayerItem, LayerStyleConfig, LayerStyleGlobalLight, LayerTransform } from '../types/editor'
import type { HistoryDirection } from './history'
import type { SelectionRegion } from './selection'
import type { EditorGuide } from './guides'
import { cloneLayerStyleConfig, createLayerStyleConfig, layerStylePatternAssets } from './layerStyles.ts'
import { cloneSmartLayerContent } from './smartLayers.ts'

interface SelectionDelta {
  activeBefore?: string
  activeAfter?: string
  selectedBefore?: string[]
  selectedAfter?: string[]
  selectionBefore?: SelectionRegion | null
  selectionAfter?: SelectionRegion | null
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
}

export interface TransformLayersDelta extends SelectionDelta {
  type: 'layers:transform'
  items: Array<{
    layerId: string
    before: LayerTransform
    after: LayerTransform
  }>
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

export interface ChangeLayerStylesDelta extends SelectionDelta {
  type: 'layer-styles:change'
  layerId: string
  before: LayerStyleConfig
  after: LayerStyleConfig
  globalLightBefore: LayerStyleGlobalLight
  globalLightAfter: LayerStyleGlobalLight
}

export type EditorHistoryDelta =
  | AddLayersDelta
  | RemoveLayersDelta
  | ReplaceLayersDelta
  | PatchLayerDelta
  | TransformLayersDelta
  | ReorderLayerDelta
  | ChangeGuidesDelta
  | ChangeLayerStyleGlobalLightDelta
  | ChangeLayerStylesDelta

export function cloneLayerState(layer: LayerItem): LayerItem {
  return {
    ...layer,
    image: layer.image ? { ...layer.image } : undefined,
    smart: cloneSmartLayerContent(layer.smart),
    text: layer.text ? { ...layer.text } : undefined,
    shape: layer.shape ? { ...layer.shape } : undefined,
    transform: layer.transform ? { ...layer.transform } : undefined,
    styles: layer.styles ? cloneLayerStyleConfig(layer.styles) : createLayerStyleConfig()
  }
}

export function cloneLayerHistoryState(layer: LayerItem): LayerItem {
  const cloned = cloneLayerState(layer)
  if (cloned.kind === 'smart' && cloned.smart) {
    cloned.image = undefined
    cloned.smart.layers = cloned.smart.layers.map(cloneLayerHistoryState)
  }
  return cloned
}

export function cloneLayerPatch(patch: Partial<LayerItem>): Partial<LayerItem> {
  const cloned = { ...patch }
  if ('image' in patch) cloned.image = patch.image ? { ...patch.image } : patch.image
  if ('smart' in patch) cloned.smart = cloneSmartLayerContent(patch.smart)
  if (patch.smart) cloned.image = undefined
  if ('text' in patch) cloned.text = patch.text ? { ...patch.text } : patch.text
  if ('shape' in patch) cloned.shape = patch.shape ? { ...patch.shape } : patch.shape
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
    selectedBefore: previous.selectedBefore,
    selectionBefore: previous.selectionBefore
  } satisfies PatchLayerDelta
}

function historyLayerTree(layer: Partial<LayerItem>): Partial<LayerItem>[] {
  return [layer, ...(layer.smart?.layers.flatMap(historyLayerTree) ?? [])]
}

export function estimateEditorHistoryBytes(delta: EditorHistoryDelta) {
  const referencedLayers = delta.type === 'layer-styles:change'
    ? [{ styles: delta.before }, { styles: delta.after }]
    : delta.type === 'layer:patch'
      ? [delta.before, delta.after].flatMap(historyLayerTree)
      : historyDeltaLayers(delta).flatMap(historyLayerTree)
  const referencedImageBytes = referencedLayers
    .reduce((total, layer) => total + (layer.image?.byteSize ?? 0), 0)
  const styleAssets = referencedLayers.flatMap((layer) => layerStylePatternAssets(layer.styles))
  const referencedStyleBytes = [...new Map(styleAssets.map((asset) => [asset.sourceUrl, asset])).values()]
    .reduce((total, asset) => total + (asset.byteSize ?? 0), 0)
  return JSON.stringify(delta).length * 2 + referencedImageBytes + referencedStyleBytes + 96
}

export function isEditorHistoryDeltaNoop(delta: EditorHistoryDelta) {
  if (delta.type === 'guides:change') return JSON.stringify(delta.before) === JSON.stringify(delta.after)
  if (delta.type === 'document:global-light') return JSON.stringify(delta.before) === JSON.stringify(delta.after)
  if (delta.type === 'layer-styles:change') {
    return JSON.stringify(delta.before) === JSON.stringify(delta.after) &&
      JSON.stringify(delta.globalLightBefore) === JSON.stringify(delta.globalLightAfter)
  }
  if (delta.type === 'layer:patch') {
    return JSON.stringify(delta.before) === JSON.stringify(delta.after) &&
      JSON.stringify(delta.selectionBefore) === JSON.stringify(delta.selectionAfter)
  }
  if (delta.type === 'layers:transform') {
    return delta.items.every((item) => JSON.stringify(item.before) === JSON.stringify(item.after))
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
    for (const item of historyLayerTree(layer)) {
      for (const source of [item.image?.sourceUrl, item.image?.previewUrl]) {
        if (source?.startsWith('blob:')) urls.add(source)
      }
      for (const asset of layerStylePatternAssets(item.styles)) {
        if (asset.sourceUrl.startsWith('blob:')) urls.add(asset.sourceUrl)
      }
    }
  }
  if (delta.type === 'layers:replace') {
    for (const item of [...delta.before, ...delta.after]) collect(item.layer)
  } else if (delta.type === 'layers:add' || delta.type === 'layers:remove') {
    for (const item of delta.items) collect(item.layer)
  } else if (delta.type === 'layer:patch') {
    collect(delta.before)
    collect(delta.after)
  } else if (delta.type === 'layer-styles:change') {
    collect({ styles: delta.before })
    collect({ styles: delta.after })
  }
  return [...urls]
}

export function applyEditorHistoryDelta(
  layers: LayerItem[],
  activeLayerId: string,
  delta: EditorHistoryDelta,
  direction: HistoryDirection,
  selectedLayerIds: readonly string[] = [activeLayerId]
) {
  const redo = direction === 'redo'
  const insertedLayers: LayerItem[] = []
  const removedLayerIds: string[] = []
  const refreshLayerIds: string[] = []

  if (delta.type === 'guides:change' || delta.type === 'document:global-light') {
    return { activeLayerId, selectedLayerIds: [...selectedLayerIds], insertedLayers, refreshLayerIds, removedLayerIds }
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
  } else if (delta.type === 'layer-styles:change') {
    const layer = layers.find((item) => item.id === delta.layerId)
    if (layer) {
      layer.styles = cloneLayerStyleConfig(redo ? delta.after : delta.before)
      if (layer.image) refreshLayerIds.push(layer.id)
    }
  } else if (delta.type === 'layers:transform') {
    for (const item of delta.items) {
      const layer = layers.find((candidate) => candidate.id === item.layerId)
      if (!layer) continue
      layer.transform = { ...(redo ? item.after : item.before) }
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

  const requestedSelection = redo ? delta.selectedAfter : delta.selectedBefore
  const availableIds = new Set(layers.map((layer) => layer.id))
  const retainedSelection = (requestedSelection ?? selectedLayerIds).filter((id) => availableIds.has(id))
  const nextSelectedLayerIds = retainedSelection.length
    ? [...new Set(retainedSelection)]
    : [nextActiveId]
  if (!nextSelectedLayerIds.includes(nextActiveId)) nextSelectedLayerIds.push(nextActiveId)

  return { activeLayerId: nextActiveId, selectedLayerIds: nextSelectedLayerIds, insertedLayers, refreshLayerIds, removedLayerIds }
}
