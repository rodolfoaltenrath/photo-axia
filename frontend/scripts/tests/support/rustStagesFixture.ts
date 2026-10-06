import { layerStyleInsets } from '../../../src/editor/layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from '../../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../../../src/editor/layerStyleRaster.ts'
import { prepareRustStyleStages } from '../../../src/editor/rustPixelPocStages.ts'
import type { RustPixelPocPatternRaster } from '../../../src/editor/rustPixelPocRuntime.ts'
import type { LayerStyleConfig, LayerStyleGlobalLight } from '../../../src/types/editor.ts'
import type { LayerBlendMode } from '../../../src/types/editor.ts'
import { strokePatternAsset, strokeGradient } from './rustStrokeFixture.ts'

export function combinedStages(mode: LayerBlendMode = 'normal', fillOpacity = 73.5, reverseOrder = false) {
  const effects = [
    { type: 'stroke', id: 'stroke', size: 2, position: 'center', paint: strokeGradient, blendMode: mode },
    { type: 'bevel-emboss', id: 'bevel', size: 2, soften: 1, depth: 187.5, altitude: 30, textureEnabled: true,
      texture: strokePatternAsset, textureDepth: 17.5, textureScale: 137.5, highlightMode: mode, shadowMode: mode },
    { type: 'gradient-overlay', id: 'gradient', gradient: strokeGradient.gradient, angle: 33.333, scale: 137.5, reverse: true, blendMode: mode },
    { type: 'inner-shadow', id: 'inner-shadow', size: 3, distance: 1.5, choke: 17.5, noise: 7.5, blendMode: mode },
    { type: 'drop-shadow', id: 'drop-shadow', size: 3, distance: 2.5, spread: 17.5, noise: 7.5, blendMode: mode },
    { type: 'pattern-overlay', id: 'pattern', pattern: strokePatternAsset, angle: -77.75, scale: 137.5, blendMode: mode },
    { type: 'outer-glow', id: 'outer-glow', size: 3, spread: 17.5, noise: 7.5, jitter: 7.5, paint: strokeGradient, blendMode: mode },
    { type: 'color-overlay', id: 'color', color: '#33669980', opacity: 73.5, blendMode: mode },
    { type: 'satin', id: 'satin', size: 2, distance: 1.5, invert: true, opacity: 73.5, blendMode: mode },
    { type: 'inner-glow', id: 'inner-glow', size: 2, source: 'center', choke: 7.5, range: 73.5, paint: strokeGradient, blendMode: mode },
  ]
  return normalizeLayerStyleConfig({ fillOpacity, effects: reverseOrder ? effects.reverse() : effects,
    blendIf: { channel: 'red', thisLayer: { shadows: [17, 73], highlights: [199, 237] } } })
}

export function stagesFixture(source: Uint8Array, width: number, height: number, styles: LayerStyleConfig,
  light: LayerStyleGlobalLight, scale = 1, patterns: ReadonlyMap<string, RustPixelPocPatternRaster> = new Map()) {
  const config = normalizeLayerStyleConfig(styles), globalLight = normalizeLayerStyleGlobalLight(light)
  const insets = layerStyleInsets(config, globalLight, scale), fullWidth = width + insets.left + insets.right, fullHeight = height + insets.top + insets.bottom
  const rgba = new Uint8Array(fullWidth * fullHeight * 4)
  for (let y = 0; y < height; y++) rgba.set(source.subarray(y * width * 4, (y + 1) * width * 4), ((y + insets.top) * fullWidth + insets.left) * 4)
  const plan = prepareRustStyleStages(config, globalLight, scale, patterns)
  const rasterPatterns = new Map([...patterns].map(([id, raster]) => [id, { width: raster.width, height: raster.height, data: new Uint8ClampedArray(raster.rgba) }]))
  const expected = composeLayerStyleRaster({ width, height, data: new Uint8ClampedArray(source) }, config, globalLight, scale, rasterPatterns)
  return { rgba, width: fullWidth, height: fullHeight, plan, expected, region: { x: 0, y: 0, width: fullWidth, height: fullHeight } }
}
