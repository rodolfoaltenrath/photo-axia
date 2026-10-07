import type { LayerStyleConfig, LayerStyleGlobalLight, LayerTransform } from '../types/editor.ts'
import { layerStyleInsets, type LayerStyleInsets } from './layerStyleCompositor.ts'
import { transformedLayerBounds } from './guides.ts'

export type RustStylePriority = 'background' | 'visible' | 'active'
export interface RustStyleViewport {
  offsetX: number; offsetY: number; scale: number; width: number; height: number
}

export function rustStylePriorityValid(value: unknown): value is RustStylePriority {
  return value === 'background' || value === 'visible' || value === 'active'
}

export function layerStylePreviewInsets(styles: LayerStyleConfig, light: LayerStyleGlobalLight, transform: LayerTransform,
  source: { width: number; height: number; resolutionScale: number }): LayerStyleInsets {
  const scale = Number.isFinite(source.resolutionScale) && source.resolutionScale > 0
    ? Math.min(8, Math.max(0.01, source.resolutionScale)) : 1
  const insets = layerStyleInsets(styles, light, scale)
  const scaleX = transform.width / source.width, scaleY = transform.height / source.height
  return { left: insets.left * scaleX, right: insets.right * scaleX,
    top: insets.top * scaleY, bottom: insets.bottom * scaleY }
}

export function layerStylePreviewPriority(active: boolean, transform: LayerTransform,
  viewport: RustStyleViewport, insets: LayerStyleInsets): RustStylePriority {
  if (active) return 'active'
  const { offsetX, offsetY, scale, width, height } = viewport
  if (![offsetX, offsetY, scale, width, height, transform.x, transform.y, transform.width,
    transform.height, transform.rotation ?? 0, ...Object.values(insets)].every(Number.isFinite) ||
    scale <= 0 || width <= 0 || height <= 0 || transform.width <= 0 || transform.height <= 0) return 'visible'
  const bounds = transformedLayerBounds(transform)
  // A conservative halo also covers asymmetric effects after rotation.
  const margin = Math.max(0, ...Object.values(insets)) * Math.SQRT2 * scale
  const left = offsetX + bounds.x * scale - margin, top = offsetY + bounds.y * scale - margin
  const right = offsetX + (bounds.x + bounds.width) * scale + margin
  const bottom = offsetY + (bounds.y + bounds.height) * scale + margin
  if (![left, top, right, bottom].every(Number.isFinite)) return 'visible'
  return right >= 0 && bottom >= 0 && left <= width && top <= height ? 'visible' : 'background'
}
