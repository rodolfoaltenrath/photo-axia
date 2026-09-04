import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import type {
  LayerEffect,
  LayerEffectType,
  LayerStyleConfig,
  LayerStyleGlobalLight
} from '../types/editor.ts'

export type LayerStyleRenderQuality = 'interactive' | 'final'
export type LayerStyleCompositionStage = 'external' | 'content' | 'internal' | 'overlay' | 'upper'

export interface LayerStyleInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface LayerStylePipeline {
  external: LayerEffect[]
  internal: LayerEffect[]
  overlay: LayerEffect[]
  upper: LayerEffect[]
}

export interface LayerStyleRaster {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface LayerStyleCacheIdentity {
  layerId: string
  sourceIdentity: string
  sourceWidth: number
  sourceHeight: number
  styles: LayerStyleConfig
  globalLight: LayerStyleGlobalLight
  resolutionScale: number
  quality: LayerStyleRenderQuality
}

export const LAYER_STYLE_COMPOSITION_ORDER: readonly LayerStyleCompositionStage[] = Object.freeze([
  'external', 'content', 'internal', 'overlay', 'upper'
])

const RASTER_SUPPORTED_EFFECTS = new Set<LayerEffectType>([
  'drop-shadow',
  'inner-shadow',
  'outer-glow',
  'inner-glow',
  'satin',
  'color-overlay',
  'gradient-overlay',
  'pattern-overlay',
  'stroke',
  'bevel-emboss'
])

const EFFECT_STAGE: Readonly<Record<LayerEffectType, Exclude<LayerStyleCompositionStage, 'content'>>> = Object.freeze({
  'drop-shadow': 'external',
  'outer-glow': 'external',
  'inner-shadow': 'internal',
  'inner-glow': 'internal',
  satin: 'internal',
  'color-overlay': 'overlay',
  'gradient-overlay': 'overlay',
  'pattern-overlay': 'overlay',
  'bevel-emboss': 'upper',
  stroke: 'upper'
})

function finitePositive(value: number, fallback = 1) {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function roundInset(value: number, scale: number) {
  return Math.ceil(Math.max(0, value) * scale)
}

function shadowInsets(
  angle: number,
  distance: number,
  radius: number,
  scale: number
): LayerStyleInsets {
  const radians = angle * Math.PI / 180
  // O ângulo representa a direção da luz; a sombra é projetada na direção oposta.
  const dx = -Math.cos(radians) * distance
  const dy = Math.sin(radians) * distance
  return {
    left: roundInset(radius - dx, scale),
    right: roundInset(radius + dx, scale),
    top: roundInset(radius - dy, scale),
    bottom: roundInset(radius + dy, scale)
  }
}

function uniformInsets(value: number, scale: number): LayerStyleInsets {
  const inset = roundInset(value, scale)
  return { top: inset, right: inset, bottom: inset, left: inset }
}

function mergeInsets(target: LayerStyleInsets, source: LayerStyleInsets) {
  target.top = Math.max(target.top, source.top)
  target.right = Math.max(target.right, source.right)
  target.bottom = Math.max(target.bottom, source.bottom)
  target.left = Math.max(target.left, source.left)
}

export function activeLayerStyleEffects(styles: LayerStyleConfig) {
  if (!styles.enabled) return []
  return styles.effects.filter((effect) => effect.enabled && effect.opacity > 0)
}

export function layerStyleEffectIsRasterSupported(effect: LayerEffect) {
  return RASTER_SUPPORTED_EFFECTS.has(effect.type)
}

export function buildLayerStylePipeline(styles: LayerStyleConfig): LayerStylePipeline {
  const pipeline: LayerStylePipeline = { external: [], internal: [], overlay: [], upper: [] }
  for (const effect of activeLayerStyleEffects(styles)) pipeline[EFFECT_STAGE[effect.type]].push(effect)
  return pipeline
}

export function layerStyleInsets(
  stylesValue: LayerStyleConfig,
  globalLightValue: LayerStyleGlobalLight,
  resolutionScale = 1
) {
  const styles = normalizeLayerStyleConfig(stylesValue)
  const globalLight = normalizeLayerStyleGlobalLight(globalLightValue)
  const scale = finitePositive(resolutionScale)
  const insets: LayerStyleInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  for (const effect of activeLayerStyleEffects(styles)) {
    if (effect.type === 'drop-shadow') {
      const angle = effect.useGlobalLight ? globalLight.angle : effect.angle
      mergeInsets(insets, shadowInsets(angle, effect.distance, effect.size, scale))
    } else if (effect.type === 'outer-glow') {
      mergeInsets(insets, uniformInsets(effect.size, scale))
    } else if (effect.type === 'stroke') {
      const outside = effect.position === 'outside' ? effect.size : effect.position === 'center' ? effect.size / 2 : 0
      mergeInsets(insets, uniformInsets(outside, scale))
    } else if (effect.type === 'bevel-emboss' && effect.style !== 'inner-bevel') {
      mergeInsets(insets, uniformInsets(effect.size + effect.soften, scale))
    }
  }
  return insets
}

export function layerStyleNeedsCompositing(stylesValue: LayerStyleConfig) {
  const styles = normalizeLayerStyleConfig(stylesValue)
  return styles.fillOpacity !== 100 || activeLayerStyleEffects(styles).length > 0
}

export function applyLayerFillOpacity(source: LayerStyleRaster, fillOpacity: number): LayerStyleRaster {
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width <= 0 || source.height <= 0) {
    throw new Error('Dimensões de raster inválidas para composição.')
  }
  if (source.data.length !== source.width * source.height * 4) {
    throw new Error('Buffer RGBA incompatível com as dimensões do raster.')
  }
  const opacity = Math.min(100, Math.max(0, Number.isFinite(fillOpacity) ? fillOpacity : 100))
  const data = new Uint8ClampedArray(source.data)
  if (opacity === 100) return { width: source.width, height: source.height, data }
  const factor = opacity / 100
  for (let index = 3; index < data.length; index += 4) data[index] = Math.round(data[index]! * factor)
  return { width: source.width, height: source.height, data }
}

export function composeLayerStyleBase(source: LayerStyleRaster, stylesValue: LayerStyleConfig) {
  const styles = normalizeLayerStyleConfig(stylesValue)
  const effects = activeLayerStyleEffects(styles)
  if (effects.length) {
    throw new Error(`Efeitos ainda não suportados pelo compositor: ${effects.map((effect) => effect.type).join(', ')}.`)
  }
  return applyLayerFillOpacity(source, styles.fillOpacity)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  const source = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) sorted[key] = stableValue(source[key])
  return sorted
}

export function layerStyleHash(stylesValue: LayerStyleConfig, globalLightValue: LayerStyleGlobalLight) {
  const styles = normalizeLayerStyleConfig(stylesValue)
  const effects = activeLayerStyleEffects(styles)
  const usesGlobalLight = effects.some((effect) =>
    (effect.type === 'drop-shadow' || effect.type === 'inner-shadow' || effect.type === 'bevel-emboss') &&
    effect.useGlobalLight
  )
  const payload = JSON.stringify(stableValue({
    fillOpacity: styles.fillOpacity,
    effects,
    globalLight: usesGlobalLight ? normalizeLayerStyleGlobalLight(globalLightValue) : undefined
  }))
  let hash = 0x811c9dc5
  for (let index = 0; index < payload.length; index++) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function layerStyleCacheKey(identity: LayerStyleCacheIdentity) {
  const scale = Math.round(finitePositive(identity.resolutionScale) * 10_000) / 10_000
  return [
    identity.layerId,
    identity.sourceIdentity,
    `${identity.sourceWidth}x${identity.sourceHeight}`,
    layerStyleHash(identity.styles, identity.globalLight),
    scale,
    identity.quality
  ].join('|')
}
