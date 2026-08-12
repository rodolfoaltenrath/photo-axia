import type { LayerBlendMode } from '../types/editor'

export interface LayerBlendModeOption {
  value: LayerBlendMode
  label: string
}

export const LAYER_BLEND_MODES: readonly LayerBlendModeOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiplicação' },
  { value: 'screen', label: 'Divisão' },
  { value: 'overlay', label: 'Sobrepor' },
  { value: 'darken', label: 'Escurecer' },
  { value: 'lighten', label: 'Clarear' }
]

const blendModes = new Set<LayerBlendMode>(LAYER_BLEND_MODES.map(({ value }) => value))

export function isLayerBlendMode(value: unknown): value is LayerBlendMode {
  return typeof value === 'string' && blendModes.has(value as LayerBlendMode)
}

export function normalizeLayerBlendMode(value: unknown): LayerBlendMode {
  return isLayerBlendMode(value) ? value : 'normal'
}

export function canvasBlendOperation(value: unknown): GlobalCompositeOperation {
  const normalized = normalizeLayerBlendMode(value)
  return normalized === 'normal' ? 'source-over' : normalized
}

export function cssBlendMode(value: unknown) {
  return normalizeLayerBlendMode(value)
}

export function layerCompositingStyle(blendMode: unknown, opacity: unknown) {
  const normalizedBlendMode = normalizeLayerBlendMode(blendMode)
  const normalizedOpacity = typeof opacity === 'number' && Number.isFinite(opacity)
    ? Math.max(0, Math.min(100, opacity))
    : 100
  return {
    mixBlendMode: normalizedBlendMode === 'normal' ? undefined : normalizedBlendMode,
    opacity: normalizedOpacity === 100 ? undefined : normalizedOpacity / 100
  }
}

export function blendModeLabel(value: unknown) {
  const normalized = normalizeLayerBlendMode(value)
  return LAYER_BLEND_MODES.find((option) => option.value === normalized)!.label
}
