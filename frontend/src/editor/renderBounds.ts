import { layerStyleInsets } from './layerStyleCompositor.ts'
import type { DocumentSpec, LayerItem, LayerStyleGlobalLight, LayerTransform } from '../types/editor.ts'

export interface DocumentBounds {
  x: number
  y: number
  width: number
  height: number
}

function transformedBounds(transform: LayerTransform): DocumentBounds | undefined {
  const { x, y, width, height, rotation = 0 } = transform
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

export function layerDocumentBounds(layer: LayerItem): DocumentBounds | undefined {
  return layer.transform ? transformedBounds(layer.transform) : undefined
}

export function layerStyledDocumentBounds(layer: LayerItem, globalLight: LayerStyleGlobalLight) {
  const transform = layer.transform
  if (!transform) return undefined
  const insets = layerStyleInsets(layer.styles, globalLight)
  const centerX = transform.x + transform.width / 2
  const centerY = transform.y + transform.height / 2
  const radians = (transform.rotation ?? 0) * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const left = transform.x - insets.left
  const right = transform.x + transform.width + insets.right
  const top = transform.y - insets.top
  const bottom = transform.y + transform.height + insets.bottom
  const points = [
    [left, top], [right, top], [right, bottom], [left, bottom]
  ].map(([x, y]) => ({
    x: centerX + (x! - centerX) * cosine - (y! - centerY) * sine,
    y: centerY + (x! - centerX) * sine + (y! - centerY) * cosine
  }))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
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

export function styledLayerIntersectsBounds(
  layer: LayerItem,
  viewport: DocumentBounds,
  globalLight: LayerStyleGlobalLight
) {
  const bounds = layerStyledDocumentBounds(layer, globalLight)
  return bounds ? boundsIntersect(bounds, viewport) : false
}
