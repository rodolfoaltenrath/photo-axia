import { readFileSync } from 'node:fs'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'

const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))

for (const item of fixture.rasterCases) {
  const source = {
    width: item.source.width,
    height: item.source.height,
    data: new Uint8ClampedArray(item.source.rgba)
  }
  const result = composeLayerStyleRaster(
    source, normalizeLayerStyleConfig(item.styles), item.globalLight, item.resolutionScale,
    new Map((item.patterns ?? []).map((pattern) => [pattern.id, {
      width: pattern.width, height: pattern.height, data: new Uint8ClampedArray(pattern.rgba)
    }]))
  )
  console.log(JSON.stringify({
    id: item.id,
    expected: {
      width: result.width, height: result.height, offsetX: result.offsetX, offsetY: result.offsetY,
      rgba: [...result.data]
    }
  }))
}

for (const item of fixture.underlyingCases) {
  const data = new Uint8ClampedArray(item.rgba)
  applyLayerStyleBlendIfUnderlying(data, new Uint8ClampedArray(item.backdrop), normalizeLayerStyleConfig(item.styles))
  console.log(JSON.stringify({ id: item.id, expected: { rgba: [...data] } }))
}
