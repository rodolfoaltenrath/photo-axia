import { normalizeLayerBlendMode } from './blendModes.ts'
import type {
  BevelEmbossEffect,
  LayerEffect,
  LayerEffectType,
  LayerStyleConfig,
  LayerStyleContour,
  LayerStyleGlobalLight,
  LayerStyleGradient,
  LayerStylePaint,
  LayerStylePatternAsset
} from '../types/editor.ts'

export const DEFAULT_LAYER_STYLE_GLOBAL_LIGHT: Readonly<LayerStyleGlobalLight> = Object.freeze({
  angle: 120,
  altitude: 30
})

export const LAYER_STYLE_LIMITS = Object.freeze({
  blur: 250,
  distance: 1_000,
  effectCount: 64,
  gradientStops: 32,
  patternDimension: 8_192,
  patternPixels: 16_777_216,
  scale: 1_000
})

const LINEAR_CONTOUR: LayerStyleContour = {
  preset: 'linear',
  points: [{ x: 0, y: 0 }, { x: 1, y: 1 }]
}

const DEFAULT_GRADIENT: LayerStyleGradient = {
  type: 'linear',
  colorStops: [{ position: 0, color: '#000000' }, { position: 1, color: '#ffffff' }],
  opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }],
  interpolation: 'srgb'
}

let fallbackEffectSequence = 0

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function finite(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  return Math.min(maximum, Math.max(minimum, finite(value, fallback)))
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? value as T : fallback
}

function angle(value: unknown, fallback: number) {
  const normalized = ((finite(value, fallback) + 180) % 360 + 360) % 360 - 180
  return Object.is(normalized, -0) ? 0 : normalized
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[\da-f]{6}([\da-f]{2})?$/i.test(value) ? value.toLowerCase() : fallback
}

function effectId(value: unknown, type: LayerEffectType) {
  if (typeof value === 'string' && value.trim().length > 0 && value.length <= 128) return value
  if (globalThis.crypto?.randomUUID) return `${type}-${globalThis.crypto.randomUUID()}`
  fallbackEffectSequence += 1
  return `${type}-${Date.now().toString(36)}-${fallbackEffectSequence.toString(36)}`
}

function normalizeContour(value: unknown): LayerStyleContour {
  const source = record(value)
  const preset = choice(source.preset, ['linear', 'cone', 'inverted-cone', 'gaussian', 'ring', 'custom'] as const, 'linear')
  if (preset !== 'custom' || !Array.isArray(source.points)) return { preset, points: LINEAR_CONTOUR.points.map((point) => ({ ...point })) }
  const points = source.points.slice(0, 32).map((item) => {
    const point = record(item)
    return { x: clamp(point.x, 0, 1, 0), y: clamp(point.y, 0, 1, 0) }
  }).sort((first, second) => first.x - second.x)
  if (points.length < 2) return { preset: 'linear', points: LINEAR_CONTOUR.points.map((point) => ({ ...point })) }
  return { preset, points }
}

function normalizeGradient(value: unknown): LayerStyleGradient {
  const source = record(value)
  const rawColors = Array.isArray(source.colorStops) ? source.colorStops.slice(0, LAYER_STYLE_LIMITS.gradientStops) : []
  const rawOpacities = Array.isArray(source.opacityStops) ? source.opacityStops.slice(0, LAYER_STYLE_LIMITS.gradientStops) : []
  const colorStops = rawColors.map((item) => {
    const stop = record(item)
    return { position: clamp(stop.position, 0, 1, 0), color: color(stop.color, '#000000') }
  }).sort((first, second) => first.position - second.position)
  const opacityStops = rawOpacities.map((item) => {
    const stop = record(item)
    return { position: clamp(stop.position, 0, 1, 0), opacity: clamp(stop.opacity, 0, 100, 100) }
  }).sort((first, second) => first.position - second.position)
  return {
    type: choice(source.type, ['linear', 'radial', 'angle', 'reflected', 'diamond'] as const, 'linear'),
    colorStops: colorStops.length >= 2 ? colorStops : DEFAULT_GRADIENT.colorStops.map((stop) => ({ ...stop })),
    opacityStops: opacityStops.length >= 2 ? opacityStops : DEFAULT_GRADIENT.opacityStops.map((stop) => ({ ...stop })),
    interpolation: 'srgb'
  }
}

function normalizePattern(value: unknown): LayerStylePatternAsset | undefined {
  const source = record(value)
  const width = Math.round(clamp(source.width, 1, LAYER_STYLE_LIMITS.patternDimension, 0))
  const height = Math.round(clamp(source.height, 1, LAYER_STYLE_LIMITS.patternDimension, 0))
  if (!width || !height || width * height > LAYER_STYLE_LIMITS.patternPixels) return undefined
  if (typeof source.id !== 'string' || !source.id || source.id.length > 128) return undefined
  if (typeof source.sourceUrl !== 'string' || !source.sourceUrl || source.sourceUrl.length > 16_384) return undefined
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(String(source.mimeType))) return undefined
  const mimeType = source.mimeType as 'image/png' | 'image/jpeg' | 'image/webp'
  return {
    id: source.id,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.slice(0, 256) : 'Padrão',
    width,
    height,
    mimeType,
    sourceUrl: source.sourceUrl,
    byteSize: source.byteSize === undefined ? undefined : Math.round(clamp(source.byteSize, 0, Number.MAX_SAFE_INTEGER, 0))
  }
}

function normalizePaint(value: unknown, allowed: LayerStylePaint['type'][] = ['color', 'gradient', 'pattern']): LayerStylePaint {
  const source = record(value)
  const type = choice(source.type, allowed, 'color')
  if (type === 'gradient') {
    return {
      type,
      gradient: normalizeGradient(source.gradient),
      angle: angle(source.angle, 90),
      scale: clamp(source.scale, 1, LAYER_STYLE_LIMITS.scale, 100),
      reverse: bool(source.reverse, false),
      alignWithLayer: bool(source.alignWithLayer, true)
    }
  }
  if (type === 'pattern') {
    return {
      type,
      pattern: normalizePattern(source.pattern),
      angle: angle(source.angle, 0),
      scale: clamp(source.scale, 1, LAYER_STYLE_LIMITS.scale, 100),
      linkWithLayer: bool(source.linkWithLayer, true)
    }
  }
  return { type: 'color', color: color(source.color, '#000000') }
}

function base(value: Record<string, unknown>, type: LayerEffectType, opacity = 100, blendMode: 'normal' | 'multiply' | 'screen' = 'normal') {
  return {
    id: effectId(value.id, type),
    enabled: bool(value.enabled, true),
    opacity: clamp(value.opacity, 0, 100, opacity),
    blendMode: normalizeLayerBlendMode(value.blendMode ?? blendMode)
  }
}

export function createDefaultLayerEffect(type: LayerEffectType, id?: string): LayerEffect {
  return normalizeLayerEffect({ type, id })!
}

export function normalizeLayerEffect(value: unknown): LayerEffect | undefined {
  const source = record(value)
  const type = source.type as LayerEffectType
  if (![
    'drop-shadow', 'inner-shadow', 'outer-glow', 'inner-glow', 'stroke',
    'color-overlay', 'gradient-overlay', 'pattern-overlay', 'satin', 'bevel-emboss'
  ].includes(type)) return undefined

  if (type === 'drop-shadow') return {
    type, ...base(source, type, 75, 'multiply'), color: color(source.color, '#000000'), angle: angle(source.angle, 120),
    useGlobalLight: bool(source.useGlobalLight, true), distance: clamp(source.distance, 0, LAYER_STYLE_LIMITS.distance, 5),
    spread: clamp(source.spread, 0, 100, 0), size: clamp(source.size, 0, LAYER_STYLE_LIMITS.blur, 5),
    noise: clamp(source.noise, 0, 100, 0), contour: normalizeContour(source.contour),
    layerKnocksOutShadow: bool(source.layerKnocksOutShadow, true)
  }
  if (type === 'inner-shadow') return {
    type, ...base(source, type, 75, 'multiply'), color: color(source.color, '#000000'), angle: angle(source.angle, 120),
    useGlobalLight: bool(source.useGlobalLight, true), distance: clamp(source.distance, 0, LAYER_STYLE_LIMITS.distance, 5),
    choke: clamp(source.choke, 0, 100, 0), size: clamp(source.size, 0, LAYER_STYLE_LIMITS.blur, 5),
    noise: clamp(source.noise, 0, 100, 0), contour: normalizeContour(source.contour)
  }
  if (type === 'outer-glow' || type === 'inner-glow') {
    const common = {
      type, ...base(source, type, 75, 'screen'),
      paint: normalizePaint(source.paint ?? { type: 'color', color: '#ffffbe' }, ['color', 'gradient']) as Extract<LayerStylePaint, { type: 'color' | 'gradient' }>,
      technique: choice(source.technique, ['softer', 'precise'] as const, 'softer'),
      size: clamp(source.size, 0, LAYER_STYLE_LIMITS.blur, 5), noise: clamp(source.noise, 0, 100, 0),
      contour: normalizeContour(source.contour), range: clamp(source.range, 1, 100, 50), jitter: clamp(source.jitter, 0, 100, 0)
    }
    return type === 'outer-glow'
      ? { ...common, type, spread: clamp(source.spread, 0, 100, 0) }
      : { ...common, type, source: choice(source.source, ['edge', 'center'] as const, 'edge'), choke: clamp(source.choke, 0, 100, 0) }
  }
  if (type === 'stroke') return {
    type, ...base(source, type), size: clamp(source.size, 1, LAYER_STYLE_LIMITS.blur, 3),
    position: choice(source.position, ['inside', 'center', 'outside'] as const, 'outside'),
    paint: normalizePaint(source.paint)
  }
  if (type === 'color-overlay') return { type, ...base(source, type), color: color(source.color, '#ff0000') }
  if (type === 'gradient-overlay') {
    return {
      type, ...base(source, type), gradient: normalizeGradient(source.gradient), angle: angle(source.angle, 90),
      scale: clamp(source.scale, 1, LAYER_STYLE_LIMITS.scale, 100), reverse: bool(source.reverse, false),
      alignWithLayer: bool(source.alignWithLayer, true)
    }
  }
  if (type === 'pattern-overlay') {
    return {
      type, ...base(source, type), pattern: normalizePattern(source.pattern), angle: angle(source.angle, 0),
      scale: clamp(source.scale, 1, LAYER_STYLE_LIMITS.scale, 100), linkWithLayer: bool(source.linkWithLayer, true)
    }
  }
  if (type === 'satin') return {
    type, ...base(source, type, 50, 'multiply'), color: color(source.color, '#000000'), angle: angle(source.angle, 19),
    distance: clamp(source.distance, 0, LAYER_STYLE_LIMITS.distance, 11), size: clamp(source.size, 0, LAYER_STYLE_LIMITS.blur, 14),
    invert: bool(source.invert, true), contour: normalizeContour(source.contour)
  }

  return {
    type, ...base(source, type), style: choice(source.style, ['inner-bevel', 'outer-bevel', 'emboss', 'pillow-emboss'] as const, 'inner-bevel'),
    technique: choice(source.technique, ['smooth', 'chisel-hard', 'chisel-soft'] as const, 'smooth'),
    depth: clamp(source.depth, 1, 1_000, 100), direction: choice(source.direction, ['up', 'down'] as const, 'up'),
    size: clamp(source.size, 0, LAYER_STYLE_LIMITS.blur, 5), soften: clamp(source.soften, 0, LAYER_STYLE_LIMITS.blur, 0),
    angle: angle(source.angle, 120), altitude: clamp(source.altitude, 0, 90, 30), useGlobalLight: bool(source.useGlobalLight, true),
    glossContour: normalizeContour(source.glossContour), highlightMode: normalizeLayerBlendMode(source.highlightMode ?? 'screen'),
    highlightColor: color(source.highlightColor, '#ffffff'), highlightOpacity: clamp(source.highlightOpacity, 0, 100, 75),
    shadowMode: normalizeLayerBlendMode(source.shadowMode ?? 'multiply'), shadowColor: color(source.shadowColor, '#000000'),
    shadowOpacity: clamp(source.shadowOpacity, 0, 100, 75), contourEnabled: bool(source.contourEnabled, false),
    contour: normalizeContour(source.contour), contourRange: clamp(source.contourRange, 1, 100, 50),
    textureEnabled: bool(source.textureEnabled, false), texture: normalizePattern(source.texture),
    textureScale: clamp(source.textureScale, 1, LAYER_STYLE_LIMITS.scale, 100),
    textureDepth: clamp(source.textureDepth, -1_000, 1_000, 100), textureInvert: bool(source.textureInvert, false),
    textureLinkWithLayer: bool(source.textureLinkWithLayer, true)
  } satisfies BevelEmbossEffect
}

export function createLayerStyleConfig(): LayerStyleConfig {
  return { enabled: true, fillOpacity: 100, effects: [] }
}

export function normalizeLayerStyleConfig(value: unknown): LayerStyleConfig {
  const source = record(value)
  const seen = new Set<string>()
  const effects: LayerEffect[] = []
  const rawEffects = Array.isArray(source.effects) ? source.effects.slice(0, LAYER_STYLE_LIMITS.effectCount) : []
  for (const rawEffect of rawEffects) {
    const effect = normalizeLayerEffect(rawEffect)
    if (!effect) continue
    if (seen.has(effect.id)) effect.id = effectId(undefined, effect.type)
    seen.add(effect.id)
    effects.push(effect)
  }
  return {
    enabled: bool(source.enabled, true),
    fillOpacity: clamp(source.fillOpacity, 0, 100, 100),
    effects
  }
}

export function cloneLayerStyleConfig(styles: LayerStyleConfig): LayerStyleConfig {
  return normalizeLayerStyleConfig(styles)
}

export function normalizeLayerStyleGlobalLight(value: unknown): LayerStyleGlobalLight {
  const source = record(value)
  return { angle: angle(source.angle, DEFAULT_LAYER_STYLE_GLOBAL_LIGHT.angle), altitude: clamp(source.altitude, 0, 90, DEFAULT_LAYER_STYLE_GLOBAL_LIGHT.altitude) }
}

export function layerStylePatternAssets(styles: LayerStyleConfig | undefined) {
  if (!styles) return []
  const assets: LayerStylePatternAsset[] = []
  for (const effect of styles.effects) {
    if (effect.type === 'pattern-overlay' && effect.pattern) assets.push(effect.pattern)
    if (effect.type === 'stroke' && effect.paint.type === 'pattern' && effect.paint.pattern) assets.push(effect.paint.pattern)
    if (effect.type === 'bevel-emboss' && effect.texture) assets.push(effect.texture)
  }
  return assets
}

export function replaceLayerStylePatternAssets(
  styles: LayerStyleConfig,
  replacement: (asset: LayerStylePatternAsset) => LayerStylePatternAsset | undefined
) {
  const cloned = cloneLayerStyleConfig(styles)
  for (const effect of cloned.effects) {
    if (effect.type === 'pattern-overlay' && effect.pattern) effect.pattern = replacement(effect.pattern)
    if (effect.type === 'stroke' && effect.paint.type === 'pattern' && effect.paint.pattern) effect.paint.pattern = replacement(effect.paint.pattern)
    if (effect.type === 'bevel-emboss' && effect.texture) effect.texture = replacement(effect.texture)
  }
  return cloned
}
