import type { DocumentSpec, LayerItem } from '../types/editor.ts'

export interface DocumentBounds {
  x: number
  y: number
  width: number
  height: number
}

export function layerDocumentBounds(layer: LayerItem): DocumentBounds | undefined {
  if (!layer.transform) return undefined
  const { x, y, width, height, rotation = 0 } = layer.transform
  if (width <= 0 || height <= 0) return undefined
  const radians = rotation * Math.PI / 180
  const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
  const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  return {
    x: x + width / 2 - rotatedWidth / 2,
    y: y + height / 2 - rotatedHeight / 2,
    width: rotatedWidth,
    height: rotatedHeight
  }
}

export function layerIntersectsDocument(layer: LayerItem, document: Pick<DocumentSpec, 'width' | 'height'>) {
  return layerIntersectsBounds(layer, { x: 0, y: 0, width: document.width, height: document.height })
}

export function boundsIntersect(first: DocumentBounds, second: DocumentBounds) {
  if (first.width <= 0 || first.height <= 0 || second.width <= 0 || second.height <= 0) return false
  return first.x + first.width > second.x && first.y + first.height > second.y &&
    first.x < second.x + second.width && first.y < second.y + second.height
}

export function layerIntersectsBounds(layer: LayerItem, viewport: DocumentBounds) {
  const bounds = layerDocumentBounds(layer)
  return bounds ? boundsIntersect(bounds, viewport) : false
}
