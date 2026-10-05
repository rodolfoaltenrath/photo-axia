import assert from 'node:assert/strict'
import { renderInnerGlow, renderOuterGlow } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerEffect, normalizeLayerStyleConfig } from '../../../src/editor/layerStyles.ts'
import { layerStyleInsets } from '../../../src/editor/layerStyleCompositor.ts'
import type { RustPixelPocGlow } from '../../../src/editor/rustPixelPocGlow.ts'
import type { InnerGlowEffect, OuterGlowEffect } from '../../../src/types/editor.ts'

export const glowGradient = { type: 'gradient' as const, angle: 77.75, scale: 137.5, reverse: true, alignWithLayer: true,
  gradient: { type: 'radial' as const, colorStops: [{ position: 0.25, color: '#33669980' },
    { position: 0.25, color: '#ee772200' }, { position: 0.75, color: '#7799eeff' }],
  opacityStops: [{ position: 0.125, opacity: 73.5 }, { position: 0.125, opacity: 100 }, { position: 0.625, opacity: 17.5 }] } }

export function glowEffect(kind: RustPixelPocGlow['kind'], overrides: Record<string, unknown> = {}): InnerGlowEffect | OuterGlowEffect {
  const effect = normalizeLayerEffect({ type: kind === 'outer' ? 'outer-glow' : 'inner-glow', id: 'glow-😀-中文',
    source: kind === 'inner-center' ? 'center' : 'edge', paint: { type: 'color', color: '#33669980' },
    size: 4, spread: 37.5, choke: 37.5, range: 73.5, jitter: 37.5, technique: 'softer', opacity: 73.5, noise: 37.5, ...overrides })
  assert.ok(effect?.type === 'inner-glow' || effect?.type === 'outer-glow')
  return effect
}

export function glowReference(source: Uint8Array, width: number, height: number, target: Uint8Array,
  effect: InnerGlowEffect | OuterGlowEffect, scale = 1) {
  const alpha = new Uint8ClampedArray(width * height), data = new Uint8ClampedArray(target)
  for (let index = 0; index < alpha.length; index++) alpha[index] = source[index * 4 + 3]!
  if (effect.type === 'outer-glow') renderOuterGlow(data, alpha, width, height, effect, scale)
  else renderInnerGlow(data, alpha, width, height, effect, scale)
  return new Uint8Array(data)
}

export function paddedGlowSource(source: Uint8Array, width: number, height: number,
  effects: (InnerGlowEffect | OuterGlowEffect)[], scale = 1) {
  const insets = layerStyleInsets(normalizeLayerStyleConfig({ effects }), { angle: 0, altitude: 30 }, scale)
  const fullWidth = width + insets.left + insets.right, fullHeight = height + insets.top + insets.bottom
  const rgba = new Uint8Array(fullWidth * fullHeight * 4)
  for (let y = 0; y < height; y++) rgba.set(source.subarray(y * width * 4, (y + 1) * width * 4),
    ((y + insets.top) * fullWidth + insets.left) * 4)
  return { rgba, width: fullWidth, height: fullHeight,
    offsetX: insets.left ? -insets.left : 0, offsetY: insets.top ? -insets.top : 0 }
}
