import { performance } from 'node:perf_hooks'
import {
  createGradientPreviewLookup,
  renderGradientPreviewPixels
} from '../src/editor/gradientPreview.ts'
import { gradientStopsFixture } from './gradientStops.fixtures.mjs'

for (const [width, height] of [[512, 512], [724, 724], [1024, 1024]]) {
  for (const stopCount of [2, 8, 32]) {
    const config = gradientStopsFixture(stopCount)
    const lookupStarted = performance.now()
    const lookup = createGradientPreviewLookup(config)
    const lookupMilliseconds = performance.now() - lookupStarted
    const request = {
      width,
      height,
      documentWidth: 3840,
      documentHeight: 2160,
      geometry: {
        start: { x: 240, y: 180 },
        end: { x: 3600, y: 1980 }
      },
      config,
      lookup
    }
    const output = renderGradientPreviewPixels(request)
    const renderStarted = performance.now()
    renderGradientPreviewPixels({ ...request, output })
    const renderMilliseconds = performance.now() - renderStarted
    console.log(JSON.stringify({
      stopCount,
      width,
      height,
      lookupMilliseconds: Math.round(lookupMilliseconds * 100) / 100,
      renderMilliseconds: Math.round(renderMilliseconds * 100) / 100,
      outputBytes: output.byteLength
    }))
  }
}
