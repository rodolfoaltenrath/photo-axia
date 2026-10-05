import assert from 'node:assert/strict'
import { renderDropShadow } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerEffect, normalizeLayerStyleConfig } from '../../../src/editor/layerStyles.ts'
import { layerStyleInsets } from '../../../src/editor/layerStyleCompositor.ts'
import type { DropShadowEffect, LayerStyleGlobalLight } from '../../../src/types/editor.ts'

export const shadowLight = { angle: 33.333, altitude: 30 }
export function shadowEffect(overrides: Partial<DropShadowEffect> = {}): DropShadowEffect {
  const effect = normalizeLayerEffect({ type: 'drop-shadow', id: 'shadow-😀-中文', color: '#33669980',
    size: 4, spread: 37.5, distance: 3.75, angle: -77.75, useGlobalLight: false, opacity: 73.5, noise: 37.5, ...overrides })
  assert.ok(effect?.type === 'drop-shadow')
  return effect
}

export function shadowReference(source: Uint8Array, width: number, height: number, target: Uint8Array,
  effect: DropShadowEffect, light: LayerStyleGlobalLight = shadowLight, scale = 1) {
  const alpha = new Uint8ClampedArray(width * height), data = new Uint8ClampedArray(target)
  for (let index = 0; index < alpha.length; index++) alpha[index] = source[index * 4 + 3]!
  renderDropShadow(data, alpha, width, height, effect, light, scale)
  return new Uint8Array(data)
}

export function paddedShadowSource(source: Uint8Array, width: number, height: number,
  effects: DropShadowEffect[], light: LayerStyleGlobalLight = shadowLight, scale = 1) {
  const insets = layerStyleInsets(normalizeLayerStyleConfig({ effects }), light, scale)
  const fullWidth = width + insets.left + insets.right, fullHeight = height + insets.top + insets.bottom
  const rgba = new Uint8Array(fullWidth * fullHeight * 4)
  for (let y = 0; y < height; y++) {
    rgba.set(source.subarray(y * width * 4, (y + 1) * width * 4), ((y + insets.top) * fullWidth + insets.left) * 4)
  }
  return { rgba, width: fullWidth, height: fullHeight, offsetX: -insets.left, offsetY: -insets.top }
}
