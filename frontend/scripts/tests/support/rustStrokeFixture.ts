import assert from 'node:assert/strict'
import { renderStroke } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerEffect, normalizeLayerStyleConfig } from '../../../src/editor/layerStyles.ts'
import { layerStyleInsets } from '../../../src/editor/layerStyleCompositor.ts'
import type { LayerStyleRaster } from '../../../src/editor/layerStyleCompositor.ts'
import type { StrokeEffect } from '../../../src/types/editor.ts'

export const strokePattern = { rgba: new Uint8Array([203, 71, 149, 101, 71, 149, 203, 255, 149, 203, 71, 0,
  73, 17, 99, 255, 255, 128, 0, 128, 17, 199, 33, 255]), width: 3, height: 2 }
export const strokePatternAsset = { id: 'pattern', name: 'Pattern', width: 3, height: 2,
  mimeType: 'image/png', sourceUrl: 'memory:pattern' }
export const strokeGradient = { type: 'gradient' as const, angle: 33.333, scale: 137.5, reverse: true, alignWithLayer: true,
  gradient: { type: 'radial' as const, colorStops: [{ position: 0.25, color: '#33669980' }, { position: 0.25, color: '#ee772200' }, { position: 0.75, color: '#7799eeff' }],
    opacityStops: [{ position: 0.125, opacity: 73.5 }, { position: 0.125, opacity: 100 }, { position: 0.625, opacity: 17.5 }] } }
export function strokeEffect(overrides: Record<string, unknown> = {}): StrokeEffect {
  const effect = normalizeLayerEffect({ type: 'stroke', id: 'stroke-😀-中文', paint: { type: 'color', color: '#33669980' },
    size: 4, position: 'outside', opacity: 73.5, ...overrides })
  assert.ok(effect?.type === 'stroke')
  return effect
}
export function strokeReference(source: Uint8Array, width: number, height: number, target: Uint8Array,
  effect: StrokeEffect, scale = 1, pattern = strokePattern) {
  const alpha = new Uint8ClampedArray(width * height), data = new Uint8ClampedArray(target)
  for (let i = 0; i < alpha.length; i++) alpha[i] = source[i * 4 + 3]!
  renderStroke(data, alpha, width, height, effect, scale, { width: pattern.width, height: pattern.height, data: new Uint8ClampedArray(pattern.rgba) })
  return new Uint8Array(data)
}
export function paddedStrokeSource(source: Uint8Array, width: number, height: number, effect: StrokeEffect, scale = 1) {
  const insets = layerStyleInsets(normalizeLayerStyleConfig({ effects: [effect] }), { angle: 0, altitude: 30 }, scale)
  const fullWidth = width + insets.left + insets.right, fullHeight = height + insets.top + insets.bottom
  const rgba = new Uint8Array(fullWidth * fullHeight * 4)
  for (let y = 0; y < height; y++) rgba.set(source.subarray(y * width * 4, (y + 1) * width * 4), ((y + insets.top) * fullWidth + insets.left) * 4)
  return { rgba, width: fullWidth, height: fullHeight, offsetX: insets.left ? -insets.left : 0, offsetY: insets.top ? -insets.top : 0 }
}
export function patternRasters(): Map<string, LayerStyleRaster> {
  return new Map([[strokePatternAsset.id, { width: strokePattern.width, height: strokePattern.height, data: new Uint8ClampedArray(strokePattern.rgba) }]])
}
