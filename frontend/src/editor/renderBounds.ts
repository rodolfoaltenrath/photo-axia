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
  const bounds = layerDocumentBounds(layer)
  if (!bounds) return false
  return bounds.x + bounds.width > 0 && bounds.y + bounds.height > 0 &&
    bounds.x < document.width && bounds.y < document.height
}
