import type { LayerItem, LayerStyleConfig } from '../types/editor.ts'
import { activeLayerStyleEffects } from './layerStyleCompositor.ts'
import {
  cloneLayerStyleConfig,
  createLayerStyleConfig,
  layerStyleBlendIfIsDefault,
  normalizeLayerStyleConfig
} from './layerStyles.ts'

export const MIN_LAYER_EFFECT_SCALE = 1
export const MAX_LAYER_EFFECT_SCALE = 1_000

export interface LayerStyleChange {
  before: LayerStyleConfig
  after: LayerStyleConfig
}

export interface LayerStyleTargetChange extends LayerStyleChange {
  layerId: string
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
  return Boolean(layer.image) || (activeLayerStyleEffects(styles).length === 0 && layerStyleBlendIfIsDefault(styles.blendIf))
}

export function pastedLayerStyleChange(layer: LayerItem, styles: LayerStyleConfig) {
  return styleChange(layer, styles)
}

export function pastedLayerStyleChanges(layers: readonly LayerItem[], styles: LayerStyleConfig) {
  return layers.flatMap((layer): LayerStyleTargetChange[] => {
    const change = pastedLayerStyleChange(layer, styles)
    return change ? [{ layerId: layer.id, ...change }] : []
  })
}

export function clearedLayerStyleChange(layer: LayerItem) {
  return styleChange(layer, createLayerStyleConfig())
}

export function layerStyleCanClear(styles?: LayerStyleConfig) {
  return Boolean(styles && (
    !styles.enabled || styles.fillOpacity !== 100 || !layerStyleBlendIfIsDefault(styles.blendIf) || styles.effects.length > 0
  ))
}

export function toggledLayerStyleVisibilityChange(layer: LayerItem) {
  return styleChange(layer, { ...cloneLayerStyleConfig(layer.styles), enabled: !layer.styles.enabled })
}

export function toggledLayerEffectVisibilityChange(layer: LayerItem, effectId: string) {
  const next = cloneLayerStyleConfig(layer.styles)
  const effect = next.effects.find((item) => item.id === effectId)
  if (!effect) return null
  effect.enabled = !effect.enabled
  return styleChange(layer, next)
}

export function clearedLayerStyleChanges(layers: readonly LayerItem[]) {
  return layers.flatMap((layer): LayerStyleTargetChange[] => {
    const change = clearedLayerStyleChange(layer)
    return change ? [{ layerId: layer.id, ...change }] : []
  })
}

export function normalizeLayerEffectScale(value: unknown) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 100
  return Math.min(MAX_LAYER_EFFECT_SCALE, Math.max(MIN_LAYER_EFFECT_SCALE, Math.round(numeric)))
}

export function layerStylesCanScale(styles?: LayerStyleConfig) {
  return Boolean(styles?.effects.some((effect) => {
    switch (effect.type) {
      case 'drop-shadow':
      case 'inner-shadow':
      case 'satin':
        return effect.distance > 0 || effect.size > 0
      case 'outer-glow':
      case 'inner-glow':
        return effect.size > 0
      case 'stroke':
        return effect.size > 0
      case 'bevel-emboss':
        return effect.size > 0 || effect.soften > 0
      default:
        return false
    }
  }))
}

function scaledLength(value: number, factor: number) {
  return Math.round(value * factor)
}

export function scaledLayerStyleChange(layer: LayerItem, percentage: unknown) {
  const normalizedPercentage = normalizeLayerEffectScale(percentage)
  if (normalizedPercentage === 100 || !layerStylesCanScale(layer.styles)) return null
  const factor = normalizedPercentage / 100
  const next = cloneLayerStyleConfig(layer.styles)
  for (const effect of next.effects) {
    switch (effect.type) {
      case 'drop-shadow':
      case 'inner-shadow':
      case 'satin':
        effect.distance = scaledLength(effect.distance, factor)
        effect.size = scaledLength(effect.size, factor)
        break
      case 'outer-glow':
      case 'inner-glow':
      case 'stroke':
        effect.size = scaledLength(effect.size, factor)
        break
      case 'bevel-emboss':
        effect.size = scaledLength(effect.size, factor)
        effect.soften = scaledLength(effect.soften, factor)
        break
    }
  }
  return styleChange(layer, normalizeLayerStyleConfig(next))
}

export function scaledLayerStyleChanges(layers: readonly LayerItem[], percentage: unknown) {
  return layers.flatMap((layer): LayerStyleTargetChange[] => {
    const change = scaledLayerStyleChange(layer, percentage)
    return change ? [{ layerId: layer.id, ...change }] : []
  })
}
