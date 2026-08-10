import type { LayerItem } from '../types/editor'
import type { HistoryDirection } from './history'
import type { SelectionRegion } from './selection'

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

export type EditorHistoryDelta = AddLayersDelta | RemoveLayersDelta | PatchLayerDelta | ReorderLayerDelta

export function cloneLayerState(layer: LayerItem): LayerItem {
  return {
    ...layer,
    image: layer.image ? { ...layer.image } : undefined,
    text: layer.text ? { ...layer.text } : undefined,
    transform: layer.transform ? { ...layer.transform } : undefined
  }
}

export function cloneLayerPatch(patch: Partial<LayerItem>): Partial<LayerItem> {
  const cloned = { ...patch }
  if ('image' in patch) cloned.image = patch.image ? { ...patch.image } : patch.image
  if ('text' in patch) cloned.text = patch.text ? { ...patch.text } : patch.text
  if ('transform' in patch) cloned.transform = patch.transform ? { ...patch.transform } : patch.transform
  return cloned
}

export function mergeEditorHistoryDelta(previous: EditorHistoryDelta, next: EditorHistoryDelta) {
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
    : 0
  return JSON.stringify(delta).length * 2 + referencedImageBytes + 96
}

export function isEditorHistoryDeltaNoop(delta: EditorHistoryDelta) {
  if (delta.type === 'layer:patch') {
    return JSON.stringify(delta.before) === JSON.stringify(delta.after) &&
      JSON.stringify(delta.selectionBefore) === JSON.stringify(delta.selectionAfter)
  }
  if (delta.type === 'layer:reorder') return delta.beforeIndex === delta.afterIndex
  return false
}

export function historyDeltaLayers(delta: EditorHistoryDelta) {
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
  }
  if (delta.type === 'layers:add' || delta.type === 'layers:remove') {
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

  if (delta.type === 'layers:add') {
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
      if (layer.image && (patch.transform || patch.image)) refreshLayerIds.push(layer.id)
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
