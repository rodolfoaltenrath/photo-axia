import assert from 'node:assert/strict'
import { renderBevelEmboss } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerEffect } from '../../../src/editor/layerStyles.ts'
import type { RustPixelPocPatternRaster } from '../../../src/editor/rustPixelPocRuntime.ts'
import type { BevelEmbossEffect, LayerStyleGlobalLight } from '../../../src/types/editor.ts'

export const bevelLight: LayerStyleGlobalLight = { angle: 123.5, altitude: 48 }
export function bevelEffect(overrides: Partial<BevelEmbossEffect> = {}): BevelEmbossEffect {
  const effect = normalizeLayerEffect({ type: 'bevel-emboss', id: 'bevel-😀-中文', highlightColor: '#33669980',
    shadowColor: '#ee7722bb', size: 4, soften: 2, depth: 187.5, angle: -77.75, altitude: 30, opacity: 73.5, ...overrides })
  assert.ok(effect?.type === 'bevel-emboss')
  return effect
}
export function bevelReference(source: Uint8Array, width: number, height: number, target: Uint8Array,
  effect: BevelEmbossEffect, light = bevelLight, scale = 1, texture?: RustPixelPocPatternRaster) {
  const alpha = new Uint8ClampedArray(width * height), data = new Uint8ClampedArray(target)
  for (let index = 0; index < alpha.length; index++) alpha[index] = source[index * 4 + 3]!
  renderBevelEmboss(data, alpha, width, height, effect, light, scale,
    effect.textureEnabled && effect.texture && texture ? { data: new Uint8ClampedArray(texture.rgba), width: texture.width, height: texture.height } : undefined)
  return new Uint8Array(data)
}
