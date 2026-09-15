import type { LayerItem, LayerStyleConfig } from '../types/editor.ts'
import { activeLayerStyleEffects } from './layerStyleCompositor.ts'
import { cloneLayerStyleConfig, createLayerStyleConfig } from './layerStyles.ts'

export interface LayerStyleChange {
  before: LayerStyleConfig
  after: LayerStyleConfig
}

function styleChange(layer: LayerItem, next: LayerStyleConfig): LayerStyleChange | null {
  const before = cloneLayerStyleConfig(layer.styles)
  const after = cloneLayerStyleConfig(next)
  return JSON.stringify(before) === JSON.stringify(after) ? null : { before, after }
}

export function copyLayerStyleConfig(styles: LayerStyleConfig) {
  return cloneLayerStyleConfig(styles)
}

export function layerCanPasteStyle(layer: LayerItem, styles?: LayerStyleConfig) {
  if (!styles) return false
  return Boolean(layer.image) || activeLayerStyleEffects(styles).length === 0
}

export function pastedLayerStyleChange(layer: LayerItem, styles: LayerStyleConfig) {
  return styleChange(layer, styles)
}

export function clearedLayerStyleChange(layer: LayerItem) {
  return styleChange(layer, createLayerStyleConfig())
}
