import type { LayerItem } from '../types/editor'

export type LayerSelectionMode = 'replace' | 'toggle' | 'range'

export interface LayerSelectionState {
  selectedIds: string[]
  activeId: string
  anchorId: string
}

export function updateLayerSelection(
  layers: readonly Pick<LayerItem, 'id'>[],
  selectedIds: readonly string[],
  activeId: string,
  anchorId: string,
  targetId: string,
  mode: LayerSelectionMode
): LayerSelectionState {
  const ids = layers.map((layer) => layer.id)
  if (!ids.includes(targetId)) return { selectedIds: [...selectedIds], activeId, anchorId }

  if (mode === 'replace') {
    return { selectedIds: [targetId], activeId: targetId, anchorId: targetId }
  }

  if (mode === 'range') {
    const anchorIndex = ids.indexOf(anchorId)
    const targetIndex = ids.indexOf(targetId)
    if (anchorIndex < 0) return { selectedIds: [targetId], activeId: targetId, anchorId: targetId }
    const start = Math.min(anchorIndex, targetIndex)
    const end = Math.max(anchorIndex, targetIndex)
    return { selectedIds: ids.slice(start, end + 1), activeId: targetId, anchorId }
  }

  const selected = new Set(selectedIds.filter((id) => ids.includes(id)))
  if (selected.has(targetId)) {
    if (selected.size === 1) return { selectedIds: [targetId], activeId: targetId, anchorId: targetId }
    selected.delete(targetId)
  } else {
    selected.add(targetId)
  }
  const orderedSelection = ids.filter((id) => selected.has(id))
  const nextActiveId = selected.has(targetId)
    ? targetId
    : selected.has(activeId)
      ? activeId
      : orderedSelection[0]!
  return { selectedIds: orderedSelection, activeId: nextActiveId, anchorId: targetId }
}
