import type { DocumentSpec, LayerItem } from '../types/editor.ts'

export function layerIntersectsDocument(layer: LayerItem, document: Pick<DocumentSpec, 'width' | 'height'>) {
  if (!layer.transform) return false
  const { x, y, width, height, rotation = 0 } = layer.transform
  if (width <= 0 || height <= 0) return false
  const radians = rotation * Math.PI / 180
  const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
  const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  const centerX = x + width / 2
  const centerY = y + height / 2
  return centerX + rotatedWidth / 2 > 0 && centerY + rotatedHeight / 2 > 0 &&
    centerX - rotatedWidth / 2 < document.width && centerY - rotatedHeight / 2 < document.height
}
