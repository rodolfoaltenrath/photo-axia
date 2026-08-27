import { performance } from 'node:perf_hooks'
import { applyGradientRaster } from '../src/editor/gradientRaster.ts'
import { gradientStopsFixture } from './gradientStops.fixtures.mjs'

const width = 3840
const height = 2160

for (const stopCount of [2, 8, 32]) {
  const started = performance.now()
  const result = applyGradientRaster({
    sourcePixels: new Uint8ClampedArray(width * height * 4),
    sourceWidth: width,
    sourceHeight: height,
    transform: { x: 0, y: 0, width, height, rotation: 0 },
    geometry: {
      start: { x: 0, y: height / 2 },
      end: { x: width, y: height / 2 }
    },
    config: gradientStopsFixture(stopCount),
    selection: null,
    documentWidth: width,
    documentHeight: height,
    reuseSourceBuffer: true
  })
  console.log(JSON.stringify({
    stopCount,
    width,
    height,
    milliseconds: Math.round((performance.now() - started) * 100) / 100,
    outputBytes: result.pixels.byteLength
  }))
}
