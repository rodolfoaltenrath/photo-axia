export interface OrderedLayer {
  id: string
}

export interface LayerOrderChange<T extends OrderedLayer> {
  afterIndex: number
  beforeIndex: number
  layers: T[]
}

export function moveLayerBy<T extends OrderedLayer>(
  layers: readonly T[],
  layerId: string,
  direction: -1 | 1
): LayerOrderChange<T> | undefined {
  const beforeIndex = layers.findIndex((layer) => layer.id === layerId)
  const afterIndex = beforeIndex + direction
  if (beforeIndex < 0 || afterIndex < 0 || afterIndex >= layers.length) return undefined
  const reordered = [...layers]
  const [layer] = reordered.splice(beforeIndex, 1)
  reordered.splice(afterIndex, 0, layer!)
  return { layers: reordered, beforeIndex, afterIndex }
}

export function moveLayerRelativeTo<T extends OrderedLayer>(
  layers: readonly T[],
  layerId: string,
  targetId: string,
  position: 'before' | 'after'
): LayerOrderChange<T> | undefined {
  const beforeIndex = layers.findIndex((layer) => layer.id === layerId)
  if (beforeIndex < 0 || layerId === targetId) return undefined
  const reordered = layers.filter((layer) => layer.id !== layerId)
  const targetIndex = reordered.findIndex((layer) => layer.id === targetId)
  if (targetIndex < 0) return undefined
  const afterIndex = targetIndex + Number(position === 'after')
  reordered.splice(afterIndex, 0, layers[beforeIndex]!)
  if (reordered.every((layer, index) => layer.id === layers[index]?.id)) return undefined
  return { layers: reordered, beforeIndex, afterIndex }
}
