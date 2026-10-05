import { composeLayerStyleRaster } from '../../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../../src/editor/layerStyles.ts'
import type { RustPixelPocGradientOverlay, RustPixelPocRegion } from '../../../src/editor/rustPixelPocRuntime.ts'

export const gradientEffect: RustPixelPocGradientOverlay = {
  gradient: { type: 'linear', colorStops: [
    { position: 0, color: [203, 71, 149, 255] },
    { position: 0.5, color: [71, 149, 203, 128] },
    { position: 1, color: [149, 203, 71, 255] }
  ], opacityStops: [{ position: 0, opacity: 25 }, { position: 0.4, opacity: 100 }, { position: 1, opacity: 50 }] },
  angle: ((33.333 + 180) % 360 + 360) % 360 - 180,
  scale: 175.5, reverse: false, opacity: 73.5, blendMode: 'normal'
}

export function gradientStyle(effect: RustPixelPocGradientOverlay, id = 'gradient') {
  return { type: 'gradient-overlay', id, ...effect, gradient: { ...effect.gradient, interpolation: 'srgb',
    colorStops: effect.gradient.colorStops.map(stop => ({ position: stop.position,
      color: `#${stop.color.map(value => value.toString(16).padStart(2, '0')).join('')}` })) } }
}

export function gradientReference(source: Uint8Array, width: number, height: number, fillOpacity: number,
  effects: unknown[] = []) {
  return composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) },
    normalizeLayerStyleConfig({ fillOpacity, effects }), { angle: 30, altitude: 30 })
}

export function gradientTile(source: Uint8Array, width: number, region: RustPixelPocRegion) {
  const result = new Uint8Array(region.width * region.height * 4)
  for (let row = 0; row < region.height; row++) {
    const offset = ((region.y + row) * width + region.x) * 4
    result.set(source.subarray(offset, offset + region.width * 4), row * region.width * 4)
  }
  return result
}
