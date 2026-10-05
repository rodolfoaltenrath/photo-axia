import assert from 'node:assert/strict'
import { renderInnerShadow } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerEffect } from '../../../src/editor/layerStyles.ts'
import type { InnerShadowEffect, LayerStyleGlobalLight } from '../../../src/types/editor.ts'

export const innerShadowLight = { angle: 33.333, altitude: 30 }
export function innerShadowEffect(overrides: Partial<InnerShadowEffect> = {}): InnerShadowEffect {
  const effect = normalizeLayerEffect({ type: 'inner-shadow', id: 'inner-😀-中文', color: '#33669980',
    size: 4, choke: 37.5, distance: 3.75, angle: -77.75, useGlobalLight: false, opacity: 73.5, noise: 37.5, ...overrides })
  assert.ok(effect?.type === 'inner-shadow')
  return effect
}

export function innerShadowReference(source: Uint8Array, width: number, height: number, target: Uint8Array,
  effect: InnerShadowEffect, light: LayerStyleGlobalLight = innerShadowLight, scale = 1) {
  const alpha = new Uint8ClampedArray(width * height), data = new Uint8ClampedArray(target)
  for (let index = 0; index < alpha.length; index++) alpha[index] = source[index * 4 + 3]!
  renderInnerShadow(data, alpha, width, height, effect, light, scale)
  return new Uint8Array(data)
}
