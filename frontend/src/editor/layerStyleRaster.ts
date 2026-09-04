import {
  activeLayerStyleEffects,
  layerStyleEffectIsRasterSupported,
  layerStyleInsets,
  type LayerStyleRaster
} from './layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import type {
  BevelEmbossEffect,
  ColorOverlayEffect,
  DropShadowEffect,
  GradientOverlayEffect,
  InnerShadowEffect,
  LayerBlendMode,
  LayerStyleContour,
  LayerStyleGradient,
  LayerStylePaint,
  LayerStyleConfig,
  LayerStyleGlobalLight,
  InnerGlowEffect,
  OuterGlowEffect,
  PatternOverlayEffect,
  SatinEffect,
  StrokeEffect
} from '../types/editor.ts'

export interface ComposedLayerStyleRaster extends LayerStyleRaster {
  offsetX: number
  offsetY: number
}

export type LayerStylePatternRasters = Map<string, LayerStyleRaster>

export class LayerStylePatternMissingError extends Error {
  constructor(effectType: string) {
    super(`Padrão não foi decodificado para compor o efeito: ${effectType}.`)
    this.name = 'LayerStylePatternMissingError'
  }
}

const MAX_COMPOSED_PIXELS = 80_000_000

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function parseColor(value: string) {
  const hex = value.slice(1)
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16)
  ] as const
}

function colorOpacity(value: string) {
  return value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) / 255 : 1
}

function maxFilterHorizontal(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const output = new Uint8ClampedArray(source.length)
  const queue = new Int32Array(width)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let head = 0
    let tail = 0
    let next = 0
    for (let x = 0; x < width; x++) {
      const end = Math.min(width - 1, x + radius)
      while (next <= end) {
        while (tail > head && source[row + queue[tail - 1]!] <= source[row + next]!) tail--
        queue[tail++] = next++
      }
      const start = x - radius
      while (tail > head && queue[head]! < start) head++
      output[row + x] = source[row + queue[head]!]!
    }
  }
  return output
}

function maxFilterVertical(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const output = new Uint8ClampedArray(source.length)
  const queue = new Int32Array(height)
  for (let x = 0; x < width; x++) {
    let head = 0
    let tail = 0
    let next = 0
    for (let y = 0; y < height; y++) {
      const end = Math.min(height - 1, y + radius)
      while (next <= end) {
        while (tail > head && source[queue[tail - 1]! * width + x]! <= source[next * width + x]!) tail--
        queue[tail++] = next++
      }
      const start = y - radius
      while (tail > head && queue[head]! < start) head++
      output[y * width + x] = source[queue[head]! * width + x]!
    }
  }
  return output
}

function minFilterHorizontal(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const output = new Uint8ClampedArray(source.length)
  const paddedWidth = width + radius * 2
  const window = radius * 2 + 1
  const queue = new Int32Array(paddedWidth)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let head = 0
    let tail = 0
    const valueAt = (index: number) => index < radius || index >= radius + width
      ? 0
      : source[row + index - radius]!
    for (let index = 0; index < paddedWidth; index++) {
      const value = valueAt(index)
      while (tail > head && valueAt(queue[tail - 1]!) >= value) tail--
      queue[tail++] = index
      while (tail > head && queue[head]! <= index - window) head++
      if (index >= window - 1) output[row + index - window + 1] = valueAt(queue[head]!)
    }
  }
  return output
}

function minFilterVertical(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const output = new Uint8ClampedArray(source.length)
  const paddedHeight = height + radius * 2
  const window = radius * 2 + 1
  const queue = new Int32Array(paddedHeight)
  for (let x = 0; x < width; x++) {
    let head = 0
    let tail = 0
    const valueAt = (index: number) => index < radius || index >= radius + height
      ? 0
      : source[(index - radius) * width + x]!
    for (let index = 0; index < paddedHeight; index++) {
      const value = valueAt(index)
      while (tail > head && valueAt(queue[tail - 1]!) >= value) tail--
      queue[tail++] = index
      while (tail > head && queue[head]! <= index - window) head++
      if (index >= window - 1) output[(index - window + 1) * width + x] = valueAt(queue[head]!)
    }
  }
  return output
}

function boxBlurHorizontal(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const output = new Uint8ClampedArray(source.length)
  const window = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let sum = 0
    for (let x = 0; x <= Math.min(radius, width - 1); x++) sum += source[row + x]!
    for (let x = 0; x < width; x++) {
      output[row + x] = Math.round(sum / window)
      const leaving = x - radius
      const entering = x + radius + 1
      if (leaving >= 0) sum -= source[row + leaving]!
      if (entering < width) sum += source[row + entering]!
    }
  }
  return output
}

function boxBlurVertical(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const output = new Uint8ClampedArray(source.length)
  const window = radius * 2 + 1
  for (let x = 0; x < width; x++) {
    let sum = 0
    for (let y = 0; y <= Math.min(radius, height - 1); y++) sum += source[y * width + x]!
    for (let y = 0; y < height; y++) {
      output[y * width + x] = Math.round(sum / window)
      const leaving = y - radius
      const entering = y + radius + 1
      if (leaving >= 0) sum -= source[leaving * width + x]!
      if (entering < height) sum += source[entering * width + x]!
    }
  }
  return output
}

function spreadAlpha(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  return radius > 0
    ? maxFilterVertical(maxFilterHorizontal(source, width, height, radius), width, height, radius)
    : new Uint8ClampedArray(source)
}

function erodeAlpha(source: Uint8ClampedArray, width: number, height: number, radius: number) {
  return radius > 0
    ? minFilterVertical(minFilterHorizontal(source, width, height, radius), width, height, radius)
    : new Uint8ClampedArray(source)
}

function blurAlpha(source: Uint8ClampedArray, width: number, height: number, radius: number, precise: boolean) {
  if (radius <= 0) return new Uint8ClampedArray(source)
  const passes = precise ? [radius] : [
    Math.floor(radius / 3),
    Math.floor((radius + 1) / 3),
    Math.floor((radius + 2) / 3)
  ].filter((value) => value > 0)
  let current = new Uint8ClampedArray(source)
  for (const passRadius of passes) {
    current = boxBlurVertical(
      boxBlurHorizontal(current, width, height, passRadius),
      width,
      height,
      passRadius
    )
  }
  return current
}

function contourValue(contour: LayerStyleContour, value: number) {
  const x = clamp01(value)
  if (contour.preset === 'cone') return clamp01(1 - Math.abs(x * 2 - 1))
  if (contour.preset === 'inverted-cone') return clamp01(Math.abs(x * 2 - 1))
  if (contour.preset === 'gaussian') return x * x * (3 - 2 * x)
  if (contour.preset === 'ring') return clamp01(Math.sin(x * Math.PI))
  if (contour.preset !== 'custom') return x
  const points = contour.points
  const right = points.findIndex((point) => point.x >= x)
  if (right <= 0) return clamp01(points[0]?.y ?? x)
  const before = points[right - 1]!
  const after = points[right]!
  const span = after.x - before.x
  return clamp01(span <= 0 ? after.y : before.y + (after.y - before.y) * ((x - before.x) / span))
}

function gradientValue(gradient: LayerStyleGradient, value: number) {
  const x = clamp01(value)
  const colors = gradient.colorStops
  const right = colors.findIndex((stop) => stop.position >= x)
  const before = colors[Math.max(0, right <= 0 ? 0 : right - 1)]!
  const after = colors[right < 0 ? colors.length - 1 : right]!
  const span = after.position - before.position
  const amount = span <= 0 ? 0 : (x - before.position) / span
  const beforeColor = parseColor(before.color)
  const afterColor = parseColor(after.color)
  const colorAlpha = colorOpacity(before.color) + (colorOpacity(after.color) - colorOpacity(before.color)) * amount

  const opacities = gradient.opacityStops
  const opacityRight = opacities.findIndex((stop) => stop.position >= x)
  const opacityBefore = opacities[Math.max(0, opacityRight <= 0 ? 0 : opacityRight - 1)]!
  const opacityAfter = opacities[opacityRight < 0 ? opacities.length - 1 : opacityRight]!
  const opacitySpan = opacityAfter.position - opacityBefore.position
  const opacityAmount = opacitySpan <= 0 ? 0 : (x - opacityBefore.position) / opacitySpan
  return {
    color: beforeColor.map((channel, index) => Math.round(channel + (afterColor[index]! - channel) * amount)) as unknown as readonly [number, number, number],
    opacity: colorAlpha * (opacityBefore.opacity + (opacityAfter.opacity - opacityBefore.opacity) * opacityAmount) / 100
  }
}

function paintValue(paint: Extract<LayerStylePaint, { type: 'color' | 'gradient' }>, value: number) {
  if (paint.type === 'color') return { color: parseColor(paint.color), opacity: colorOpacity(paint.color) }
  return gradientValue(paint.gradient, paint.reverse ? 1 - value : value)
}

interface SpatialGradientPaint {
  gradient: LayerStyleGradient
  angle: number
  scale: number
  reverse: boolean
}

function spatialGradientPosition(
  paint: SpatialGradientPaint,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const centerX = width / 2
  const centerY = height / 2
  const dx = x + 0.5 - centerX
  const dy = y + 0.5 - centerY
  const radiusX = Math.max(0.5, width / 2)
  const radiusY = Math.max(0.5, height / 2)
  let position: number
  if (paint.gradient.type === 'radial') {
    position = Math.hypot(dx / radiusX, dy / radiusY)
  } else if (paint.gradient.type === 'angle') {
    position = ((Math.atan2(dy, dx) - paint.angle * Math.PI / 180) / (Math.PI * 2) + 1) % 1
  } else if (paint.gradient.type === 'diamond') {
    position = Math.abs(dx) / radiusX + Math.abs(dy) / radiusY
  } else {
    const radians = paint.angle * Math.PI / 180
    const cosine = Math.cos(radians)
    const sine = Math.sin(radians)
    const extent = Math.max(0.5, Math.abs(cosine) * radiusX + Math.abs(sine) * radiusY)
    const linear = 0.5 + (dx * cosine + dy * sine) / (extent * 2)
    position = paint.gradient.type === 'reflected' ? Math.abs(linear - 0.5) * 2 : linear
  }
  const scaled = 0.5 + (position - 0.5) * 100 / paint.scale
  return clamp01(paint.reverse ? 1 - scaled : scaled)
}

function patternSample(
  pattern: LayerStyleRaster,
  x: number,
  y: number,
  angle: number,
  scale: number
) {
  const scaleFactor = Math.max(0.01, scale / 100)
  const radians = -angle * Math.PI / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const rotatedX = (x * cosine - y * sine) / scaleFactor
  const rotatedY = (x * sine + y * cosine) / scaleFactor
  const patternX = Math.floor(((rotatedX % pattern.width) + pattern.width) % pattern.width)
  const patternY = Math.floor(((rotatedY % pattern.height) + pattern.height) % pattern.height)
  const offset = (patternY * pattern.width + patternX) * 4
  return {
    color: [pattern.data[offset]!, pattern.data[offset + 1]!, pattern.data[offset + 2]!] as const,
    opacity: pattern.data[offset + 3]! / 255
  }
}

function blendChannel(backdrop: number, source: number, mode: LayerBlendMode) {
  if (mode === 'multiply') return backdrop * source
  if (mode === 'screen') return 1 - (1 - backdrop) * (1 - source)
  if (mode === 'overlay') return backdrop <= 0.5
    ? 2 * backdrop * source
    : 1 - 2 * (1 - backdrop) * (1 - source)
  if (mode === 'darken') return Math.min(backdrop, source)
  if (mode === 'lighten') return Math.max(backdrop, source)
  return source
}

function compositePixel(
  target: Uint8ClampedArray,
  offset: number,
  color: readonly [number, number, number],
  alphaByte: number,
  blendMode: LayerBlendMode
) {
  const sourceAlpha = alphaByte / 255
  if (sourceAlpha <= 0) return
  const backdropAlpha = target[offset + 3]! / 255
  const outputAlpha = sourceAlpha + backdropAlpha - sourceAlpha * backdropAlpha
  for (let channel = 0; channel < 3; channel++) {
    const source = color[channel]! / 255
    const backdrop = target[offset + channel]! / 255
    const blended = blendChannel(backdrop, source, blendMode)
    const premultiplied =
      (1 - sourceAlpha) * backdrop * backdropAlpha +
      (1 - backdropAlpha) * source * sourceAlpha +
      sourceAlpha * backdropAlpha * blended
    target[offset + channel] = Math.round(clamp01(premultiplied / outputAlpha) * 255)
  }
  target[offset + 3] = Math.round(outputAlpha * 255)
}

function effectSeed(effect: { id: string }) {
  let seed = 0x811c9dc5
  for (let index = 0; index < effect.id.length; index++) {
    seed ^= effect.id.charCodeAt(index)
    seed = Math.imul(seed, 0x01000193)
  }
  return seed >>> 0
}

function offsetAlpha(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number
) {
  if (offsetX === 0 && offsetY === 0) return source
  const shifted = new Uint8ClampedArray(source.length)
  for (let y = 0; y < height; y++) {
    const sourceY = y - offsetY
    if (sourceY < 0 || sourceY >= height) continue
    for (let x = 0; x < width; x++) {
      const sourceX = x - offsetX
      if (sourceX < 0 || sourceX >= width) continue
      shifted[y * width + x] = source[sourceY * width + sourceX]!
    }
  }
  return shifted
}

function renderDropShadow(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: DropShadowEffect,
  globalLight: LayerStyleGlobalLight,
  resolutionScale: number
) {
  const radius = Math.max(0, Math.round(effect.size * resolutionScale))
  const spreadRadius = Math.min(radius, Math.round(radius * effect.spread / 100))
  const angle = (effect.useGlobalLight ? globalLight.angle : effect.angle) * Math.PI / 180
  const distance = effect.distance * resolutionScale
  const offsetX = Math.round(-Math.cos(angle) * distance)
  const offsetY = Math.round(Math.sin(angle) * distance)
  const shifted = offsetAlpha(sourceAlpha, width, height, offsetX, offsetY)
  const spread = spreadAlpha(shifted, width, height, spreadRadius)
  const blurred = blurAlpha(spread, width, height, radius - spreadRadius, false)
  const color = parseColor(effect.color)
  const colorAlpha = colorOpacity(effect.color)
  const seed = effectSeed(effect)
  for (let index = 0; index < blurred.length; index++) {
    let shadow = blurred[index]! / 255
    if (effect.layerKnocksOutShadow) shadow = Math.max(0, shadow - sourceAlpha[index]! / 255)
    if (shadow <= 0) continue
    const contoured = contourValue(effect.contour, shadow)
    const noise = effect.noise > 0
      ? 1 - randomAt(seed ^ 0x9e3779b9, index) * effect.noise / 100
      : 1
    const alpha = Math.round(255 * contoured * colorAlpha * effect.opacity / 100 * noise)
    compositePixel(target, index * 4, color, alpha, effect.blendMode)
  }
}

function renderInnerShadow(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: InnerShadowEffect,
  globalLight: LayerStyleGlobalLight,
  resolutionScale: number
) {
  const radius = Math.max(0, Math.round(effect.size * resolutionScale))
  const angle = (effect.useGlobalLight ? globalLight.angle : effect.angle) * Math.PI / 180
  const distance = effect.distance * resolutionScale
  // A máscara do conteúdo se move contra a projeção externa. A diferença que
  // permanece dentro da máscara original forma a sombra nas bordas internas.
  const offsetX = Math.round(Math.cos(angle) * distance)
  const offsetY = Math.round(-Math.sin(angle) * distance)
  const shifted = offsetAlpha(sourceAlpha, width, height, offsetX, offsetY)
  const blurred = blurAlpha(shifted, width, height, radius, false)
  const chokeThreshold = Math.min(0.99, effect.choke / 100)
  const color = parseColor(effect.color)
  const colorAlpha = colorOpacity(effect.color)
  const seed = effectSeed(effect)
  for (let index = 0; index < blurred.length; index++) {
    const mask = sourceAlpha[index]! / 255
    if (mask <= 0) continue
    const raw = mask * clamp01((1 - blurred[index]! / 255) * 2)
    if (raw <= 0) continue
    const choked = clamp01(raw / Math.max(0.01, 1 - chokeThreshold))
    const contoured = Math.min(mask, contourValue(effect.contour, choked))
    const noise = effect.noise > 0
      ? 1 - randomAt(seed ^ 0x9e3779b9, index) * effect.noise / 100
      : 1
    const alpha = Math.round(255 * contoured * colorAlpha * effect.opacity / 100 * noise)
    compositePixel(target, index * 4, color, alpha, effect.blendMode)
  }
}

function renderInnerGlow(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: InnerGlowEffect,
  resolutionScale: number
) {
  const radius = Math.max(0, Math.round(effect.size * resolutionScale))
  if (radius <= 0) return
  const blurred = blurAlpha(sourceAlpha, width, height, radius, effect.technique === 'precise')
  const chokeThreshold = Math.min(0.99, effect.choke / 100)
  const seed = effectSeed(effect)
  const solidPaint = effect.paint.type === 'color'
    ? { color: parseColor(effect.paint.color), opacity: colorOpacity(effect.paint.color) }
    : undefined
  for (let index = 0; index < blurred.length; index++) {
    const mask = sourceAlpha[index]! / 255
    if (mask <= 0) continue
    const blurredMask = blurred[index]! / 255
    // O blur considera pixels fora do raster como transparentes. Isso mantém o
    // brilho de borda correto mesmo quando a forma toca os limites da imagem.
    const raw = effect.source === 'edge'
      ? mask * clamp01((1 - blurredMask) * 2)
      : mask * blurredMask
    if (raw <= 0) continue
    const choked = clamp01(raw / Math.max(0.01, 1 - chokeThreshold))
    const ranged = clamp01(choked * 100 / effect.range)
    const contoured = contourValue(effect.contour, ranged)
    const jittered = effect.jitter > 0
      ? clamp01(contoured + (randomAt(seed, index) - 0.5) * effect.jitter / 100)
      : contoured
    const paint = solidPaint ?? paintValue(effect.paint, jittered)
    const noise = effect.noise > 0
      ? 1 - randomAt(seed ^ 0x9e3779b9, index) * effect.noise / 100
      : 1
    const alpha = Math.round(255 * jittered * paint.opacity * effect.opacity / 100 * noise * mask)
    compositePixel(target, index * 4, paint.color, alpha, effect.blendMode)
  }
}

function randomAt(seed: number, index: number) {
  let value = (seed ^ Math.imul(index + 1, 0x45d9f3b)) >>> 0
  value ^= value >>> 16
  value = Math.imul(value, 0x45d9f3b) >>> 0
  value ^= value >>> 16
  return value / 0xffffffff
}

function renderOuterGlow(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: OuterGlowEffect,
  resolutionScale: number
) {
  const radius = Math.max(0, Math.round(effect.size * resolutionScale))
  const spreadRadius = Math.min(radius, Math.round(radius * effect.spread / 100))
  const expanded = spreadAlpha(sourceAlpha, width, height, spreadRadius)
  const blurred = blurAlpha(expanded, width, height, radius - spreadRadius, effect.technique === 'precise')
  const seed = effectSeed(effect)
  const solidPaint = effect.paint.type === 'color'
    ? { color: parseColor(effect.paint.color), opacity: colorOpacity(effect.paint.color) }
    : undefined
  for (let index = 0; index < blurred.length; index++) {
    const outer = Math.max(0, blurred[index]! - sourceAlpha[index]!) / 255
    if (outer <= 0) continue
    const ranged = clamp01(outer * 100 / effect.range)
    const contoured = contourValue(effect.contour, ranged)
    const jittered = effect.jitter > 0
      ? clamp01(contoured + (randomAt(seed, index) - 0.5) * effect.jitter / 100)
      : contoured
    const paint = solidPaint ?? paintValue(effect.paint, jittered)
    const noise = effect.noise > 0
      ? 1 - randomAt(seed ^ 0x9e3779b9, index) * effect.noise / 100
      : 1
    const alpha = Math.round(255 * jittered * paint.opacity * effect.opacity / 100 * noise)
    compositePixel(target, index * 4, paint.color, alpha, effect.blendMode)
  }
}

function bevelHeightAt(ramp: Uint8ClampedArray, width: number, height: number, x: number, y: number) {
  const clampedX = Math.min(width - 1, Math.max(0, x))
  const clampedY = Math.min(height - 1, Math.max(0, y))
  return ramp[clampedY * width + clampedX]! / 255
}

function renderBevelEmboss(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: BevelEmbossEffect,
  globalLight: LayerStyleGlobalLight,
  resolutionScale: number,
  texture: LayerStyleRaster | undefined
) {
  if (effect.textureEnabled && !effect.texture) { /* nada selecionado ainda: segue sem textura */ }
  else if (effect.textureEnabled && !texture) throw new LayerStylePatternMissingError('bevel-emboss')
  const radius = Math.max(1, Math.round(effect.size * resolutionScale))
  const softenRadius = Math.max(0, Math.round(effect.soften * resolutionScale))
  const precise = effect.technique !== 'smooth'
  // A rampa de altura é aproximada pelo próprio alfa borrado: perto da borda
  // original o valor varia suavemente de dentro para fora, funcionando como um
  // mapa de relevo sem exigir uma transformada de distância dedicada.
  let ramp = blurAlpha(sourceAlpha, width, height, radius, precise)
  if (softenRadius > 0) ramp = blurAlpha(ramp, width, height, softenRadius, false)
  if (effect.technique === 'chisel-hard') {
    const sharpened = new Uint8ClampedArray(ramp.length)
    for (let index = 0; index < ramp.length; index++) {
      sharpened[index] = Math.round(clamp01((ramp[index]! / 255 - 0.5) * 2 + 0.5) * 255)
    }
    ramp = sharpened
  }
  if (effect.textureEnabled && texture) {
    // A textura soma um relevo fino de baixa amplitude sobre a rampa do bisel,
    // amostrada pela luminância do padrão em vez de reconstruir um mapa de altura.
    const textureSign = effect.textureInvert ? -1 : 1
    const depthFactor = effect.textureDepth / 100 * textureSign
    const textured = new Uint8ClampedArray(ramp.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = y * width + x
        const sample = patternSample(texture, x, y, 0, effect.textureScale)
        const luminance = (sample.color[0] + sample.color[1] + sample.color[2]) / 3 / 255
        const delta = (luminance - 0.5) * 2 * depthFactor
        textured[index] = Math.round(clamp01(ramp[index]! / 255 + delta) * 255)
      }
    }
    ramp = textured
  }

  const lightAngle = (effect.useGlobalLight ? globalLight.angle : effect.angle) * Math.PI / 180
  const lightAltitude = effect.altitude * Math.PI / 180
  const lightX = Math.cos(lightAngle) * Math.cos(lightAltitude)
  const lightY = -Math.sin(lightAngle) * Math.cos(lightAltitude)
  const lightZ = Math.sin(lightAltitude)

  const directionSign = effect.direction === 'down' ? -1 : 1
  const styleSign = effect.style === 'pillow-emboss' ? -1 : 1
  const strength = Math.max(0, effect.depth) / 100 * 4

  const highlightColor = parseColor(effect.highlightColor)
  const highlightAlpha = colorOpacity(effect.highlightColor)
  const shadowColor = parseColor(effect.shadowColor)
  const shadowAlpha = colorOpacity(effect.shadowColor)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x
      const mask = sourceAlpha[index]! / 255
      const weight = effect.style === 'inner-bevel' ? mask : effect.style === 'outer-bevel' ? 1 - mask : 1
      if (weight <= 0) continue

      const left = bevelHeightAt(ramp, width, height, x - 1, y)
      const right = bevelHeightAt(ramp, width, height, x + 1, y)
      const top = bevelHeightAt(ramp, width, height, x, y - 1)
      const bottom = bevelHeightAt(ramp, width, height, x, y + 1)
      const dx = (right - left) / 2 * strength * directionSign * styleSign
      const dy = (bottom - top) / 2 * strength * directionSign * styleSign

      const normalX = -dx
      const normalY = -dy
      const normalZ = 1
      const length = Math.sqrt(normalX * normalX + normalY * normalY + normalZ * normalZ)
      const dot = (normalX * lightX + normalY * lightY + normalZ * lightZ) / length
      if (dot === 0) continue

      const intensity = contourValue(effect.glossContour, clamp01(Math.abs(dot)))
      const ranged = effect.contourEnabled
        ? contourValue(effect.contour, clamp01(intensity * 100 / effect.contourRange))
        : intensity

      if (dot > 0) {
        const alpha = Math.round(255 * ranged * weight * highlightAlpha * effect.highlightOpacity / 100 * effect.opacity / 100)
        compositePixel(target, index * 4, highlightColor, alpha, effect.highlightMode)
      } else {
        const alpha = Math.round(255 * ranged * weight * shadowAlpha * effect.shadowOpacity / 100 * effect.opacity / 100)
        compositePixel(target, index * 4, shadowColor, alpha, effect.shadowMode)
      }
    }
  }
}

function renderStroke(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: StrokeEffect,
  resolutionScale: number,
  pattern: LayerStyleRaster | undefined
) {
  if (effect.paint.type === 'pattern' && !effect.paint.pattern) return
  if (effect.paint.type === 'pattern' && !pattern) throw new LayerStylePatternMissingError('stroke')
  const thickness = Math.max(1, Math.round(effect.size * resolutionScale))
  const outsideRadius = effect.position === 'outside'
    ? thickness
    : effect.position === 'center' ? Math.ceil(thickness / 2) : 0
  const insideRadius = effect.position === 'inside'
    ? thickness
    : effect.position === 'center' ? Math.floor(thickness / 2) : 0
  const expanded = outsideRadius > 0
    ? spreadAlpha(sourceAlpha, width, height, outsideRadius)
    : sourceAlpha
  const eroded = insideRadius > 0
    ? erodeAlpha(sourceAlpha, width, height, insideRadius)
    : sourceAlpha
  const solidPaint = effect.paint.type === 'color'
    ? { color: parseColor(effect.paint.color), opacity: colorOpacity(effect.paint.color) }
    : undefined
  const gradientPaint = effect.paint.type === 'gradient' ? effect.paint : undefined
  const patternPaint = effect.paint.type === 'pattern' ? effect.paint : undefined
  for (let index = 0; index < sourceAlpha.length; index++) {
    const mask = Math.max(0, expanded[index]! - eroded[index]!) / 255
    if (mask <= 0) continue
    const x = index % width
    const y = Math.floor(index / width)
    const paint = solidPaint ?? (patternPaint
      ? patternSample(pattern!, x, y, patternPaint.angle, patternPaint.scale)
      : gradientValue(
          gradientPaint!.gradient,
          spatialGradientPosition(gradientPaint!, x, y, width, height)
        ))
    const alpha = Math.round(255 * mask * paint.opacity * effect.opacity / 100)
    compositePixel(target, index * 4, paint.color, alpha, effect.blendMode)
  }
}

function renderColorOverlay(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  effect: ColorOverlayEffect
) {
  const color = parseColor(effect.color)
  const colorAlpha = colorOpacity(effect.color)
  for (let index = 0; index < sourceAlpha.length; index++) {
    const mask = sourceAlpha[index]! / 255
    if (mask <= 0) continue
    const alpha = Math.round(255 * mask * colorAlpha * effect.opacity / 100)
    compositePixel(target, index * 4, color, alpha, effect.blendMode)
  }
}

function renderSatin(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: SatinEffect,
  resolutionScale: number
) {
  const radius = Math.max(0, Math.round(effect.size * resolutionScale))
  const radians = effect.angle * Math.PI / 180
  const distance = effect.distance * resolutionScale
  const dx = Math.round(Math.cos(radians) * distance)
  const dy = Math.round(-Math.sin(radians) * distance)
  const shiftedPositive = offsetAlpha(sourceAlpha, width, height, dx, dy)
  const shiftedNegative = offsetAlpha(sourceAlpha, width, height, -dx, -dy)
  const blurredPositive = blurAlpha(shiftedPositive, width, height, radius, false)
  const blurredNegative = blurAlpha(shiftedNegative, width, height, radius, false)
  const color = parseColor(effect.color)
  const colorAlpha = colorOpacity(effect.color)
  for (let index = 0; index < sourceAlpha.length; index++) {
    const mask = sourceAlpha[index]! / 255
    if (mask <= 0) continue
    let diff = (blurredPositive[index]! - blurredNegative[index]!) / 255
    if (effect.invert) diff = -diff
    const raw = clamp01(diff)
    const contoured = Math.min(mask, contourValue(effect.contour, raw))
    const alpha = Math.round(255 * contoured * colorAlpha * effect.opacity / 100 * mask)
    compositePixel(target, index * 4, color, alpha, effect.blendMode)
  }
}

function renderGradientOverlay(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: GradientOverlayEffect
) {
  for (let index = 0; index < sourceAlpha.length; index++) {
    const mask = sourceAlpha[index]! / 255
    if (mask <= 0) continue
    const x = index % width
    const y = Math.floor(index / width)
    const position = spatialGradientPosition(effect, x, y, width, height)
    const paint = gradientValue(effect.gradient, position)
    const alpha = Math.round(255 * mask * paint.opacity * effect.opacity / 100)
    compositePixel(target, index * 4, paint.color, alpha, effect.blendMode)
  }
}

function renderPatternOverlay(
  target: Uint8ClampedArray,
  sourceAlpha: Uint8ClampedArray,
  width: number,
  height: number,
  effect: PatternOverlayEffect,
  pattern: LayerStyleRaster | undefined
) {
  if (!effect.pattern) return
  if (!pattern) throw new LayerStylePatternMissingError('pattern-overlay')
  for (let index = 0; index < sourceAlpha.length; index++) {
    const mask = sourceAlpha[index]! / 255
    if (mask <= 0) continue
    const x = index % width
    const y = Math.floor(index / width)
    const sample = patternSample(pattern, x, y, effect.angle, effect.scale)
    const alpha = Math.round(255 * mask * sample.opacity * effect.opacity / 100)
    compositePixel(target, index * 4, sample.color, alpha, effect.blendMode)
  }
}

function compositeContent(
  target: Uint8ClampedArray,
  source: LayerStyleRaster,
  left: number,
  top: number,
  targetWidth: number,
  fillOpacity: number
) {
  const fill = fillOpacity / 100
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      const sourceOffset = (y * source.width + x) * 4
      const targetOffset = ((y + top) * targetWidth + x + left) * 4
      compositePixel(
        target,
        targetOffset,
        [source.data[sourceOffset]!, source.data[sourceOffset + 1]!, source.data[sourceOffset + 2]!],
        Math.round(source.data[sourceOffset + 3]! * fill),
        'normal'
      )
    }
  }
}

export function composeLayerStyleRaster(
  source: LayerStyleRaster,
  stylesValue: LayerStyleConfig,
  globalLightValue: LayerStyleGlobalLight,
  resolutionScale = 1,
  patterns?: LayerStylePatternRasters
): ComposedLayerStyleRaster {
  if (!Number.isInteger(source.width) || !Number.isInteger(source.height) || source.width <= 0 || source.height <= 0) {
    throw new Error('Dimensões de raster inválidas para composição.')
  }
  if (source.data.length !== source.width * source.height * 4) {
    throw new Error('Buffer RGBA incompatível com as dimensões do raster.')
  }
  const styles = normalizeLayerStyleConfig(stylesValue)
  const globalLight = normalizeLayerStyleGlobalLight(globalLightValue)
  const scale = Number.isFinite(resolutionScale) && resolutionScale > 0 ? Math.min(8, resolutionScale) : 1
  const effects = activeLayerStyleEffects(styles)
  const unsupported = effects.filter((effect) => !layerStyleEffectIsRasterSupported(effect))
  if (unsupported.length) {
    throw new Error(`Efeitos ainda não suportados pelo compositor: ${unsupported.map((effect) => effect.type).join(', ')}.`)
  }

  const insets = layerStyleInsets(styles, globalLight, scale)
  const width = source.width + insets.left + insets.right
  const height = source.height + insets.top + insets.bottom
  if (width * height > MAX_COMPOSED_PIXELS) {
    throw new Error('O estilo ultrapassa o orçamento de pixels do compositor.')
  }
  const sourceAlpha = new Uint8ClampedArray(width * height)
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      sourceAlpha[(y + insets.top) * width + x + insets.left] = source.data[(y * source.width + x) * 4 + 3]!
    }
  }
  const data = new Uint8ClampedArray(width * height * 4)
  for (const effect of effects) {
    if (effect.type === 'drop-shadow') renderDropShadow(data, sourceAlpha, width, height, effect, globalLight, scale)
    else if (effect.type === 'outer-glow') renderOuterGlow(data, sourceAlpha, width, height, effect, scale)
  }
  compositeContent(data, source, insets.left, insets.top, width, styles.fillOpacity)
  for (const effect of effects) {
    if (effect.type === 'inner-shadow') renderInnerShadow(data, sourceAlpha, width, height, effect, globalLight, scale)
    else if (effect.type === 'inner-glow') renderInnerGlow(data, sourceAlpha, width, height, effect, scale)
    else if (effect.type === 'satin') renderSatin(data, sourceAlpha, width, height, effect, scale)
  }
  for (const effect of effects) {
    if (effect.type === 'color-overlay') renderColorOverlay(data, sourceAlpha, effect)
    else if (effect.type === 'gradient-overlay') renderGradientOverlay(data, sourceAlpha, width, height, effect)
    else if (effect.type === 'pattern-overlay') {
      renderPatternOverlay(data, sourceAlpha, width, height, effect, effect.pattern && patterns?.get(effect.pattern.id))
    }
  }
  for (const effect of effects) {
    if (effect.type === 'bevel-emboss') {
      renderBevelEmboss(data, sourceAlpha, width, height, effect, globalLight, scale, effect.texture && patterns?.get(effect.texture.id))
    } else if (effect.type === 'stroke') {
      const patternId = effect.paint.type === 'pattern' ? effect.paint.pattern?.id : undefined
      renderStroke(data, sourceAlpha, width, height, effect, scale, patternId ? patterns?.get(patternId) : undefined)
    }
  }
  return {
    width,
    height,
    data,
    offsetX: insets.left ? -insets.left : 0,
    offsetY: insets.top ? -insets.top : 0
  }
}
