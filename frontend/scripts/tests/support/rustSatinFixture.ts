import assert from 'node:assert/strict'
import { renderSatin } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerEffect } from '../../../src/editor/layerStyles.ts'
import type { SatinEffect } from '../../../src/types/editor.ts'

export function satinEffect(overrides: Partial<SatinEffect> = {}): SatinEffect {
  const effect = normalizeLayerEffect({ type: 'satin', id: 'satin-😀-中文', color: '#33669980',
    size: 4, distance: 3.75, angle: -77.75, opacity: 73.5, invert: true, ...overrides })
  assert.ok(effect?.type === 'satin')
  return effect
}

export function satinReference(source: Uint8Array, width: number, height: number, target: Uint8Array,
  effect: SatinEffect, scale = 1) {
  const alpha = new Uint8ClampedArray(width * height), data = new Uint8ClampedArray(target)
  for (let index = 0; index < alpha.length; index++) alpha[index] = source[index * 4 + 3]!
  renderSatin(data, alpha, width, height, effect, scale)
  return new Uint8Array(data)
}
