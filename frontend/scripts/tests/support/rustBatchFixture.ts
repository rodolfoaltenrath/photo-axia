import type { RustPixelPocBatchPlan } from '../../../src/editor/rustPixelPocBatch.ts'
import { composeLayerStyleRaster } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../../src/editor/layerStyles.ts'
import { gradientEffect, gradientStyle } from './rustGradientFixture.ts'

export const batchPlan: RustPixelPocBatchPlan = { fillOpacity: 37.5, effects: [
  { type: 'color-overlay', effect: { color: [31, 63, 95, 128], opacity: 73.5, blendMode: 'screen' } },
  { type: 'gradient-overlay', effect: structuredClone(gradientEffect) },
  { type: 'pattern-overlay', effect: { angle: -33.333, scale: 175.5, opacity: 37.5, blendMode: 'overlay' },
    pattern: { width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]) } }
], thisLayerBlendIf: { channel: 'red', shadows: [0, 50], highlights: [200, 255] } }

export function batchReference(source: Uint8Array, width: number, height: number, plan: RustPixelPocBatchPlan) {
  const patterns = new Map<string, { width: number; height: number; data: Uint8ClampedArray }>()
  const effects = plan.effects.map((pass, index) => {
    const id = `effect-${index}`
    switch (pass.type) {
      case 'color-overlay': return { type: pass.type, id, ...pass.effect,
        color: `#${pass.effect.color.map(byte => byte.toString(16).padStart(2, '0')).join('')}` }
      case 'gradient-overlay': return gradientStyle(pass.effect, id)
      case 'pattern-overlay':
        patterns.set(id, { ...pass.pattern, data: new Uint8ClampedArray(pass.pattern.rgba) })
        return { type: pass.type, id, ...pass.effect, pattern: { id, name: id, sourceUrl: `fixture:${id}`,
          mimeType: 'image/png', width: pass.pattern.width, height: pass.pattern.height } }
      default: pass satisfies never; throw new Error('Unsupported fixture')
    }
  })
  const config = normalizeLayerStyleConfig({ fillOpacity: plan.fillOpacity, effects,
    blendIf: plan.thisLayerBlendIf ? { channel: plan.thisLayerBlendIf.channel, thisLayer: plan.thisLayerBlendIf } : undefined })
  return new Uint8Array(composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
    config, { angle: 30, altitude: 30 }, 1, patterns).data)
}
