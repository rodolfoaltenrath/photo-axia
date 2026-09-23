import { performance } from 'node:perf_hooks'
import { quickSelectionSpans } from '../src/editor/quickSelection.ts'

const width = 3840
const height = 2160
const pixels = new Uint8ClampedArray(width * height * 4)
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const offset = (y * width + x) * 4
  const object = x < width / 2
  const noise = ((x * 73 + y * 31 + 17) % 17) - 8
  pixels[offset] = (object ? 35 : 175) + noise
  pixels[offset + 1] = (object ? 105 : 85) + noise
  pixels[offset + 2] = (object ? 195 : 55) + noise
  pixels[offset + 3] = 255
}

const started = performance.now()
const result = quickSelectionSpans(pixels, width, height, {
  positiveSeeds: [{ x: 100, y: 100 }], colorTolerance: 30, edgeTolerance: 40
})
console.log(JSON.stringify({
  fixture: '4K noisy object with hard boundary',
  width,
  height,
  pixels: result.pixelCount,
  spans: Array.isArray(result.spans) ? result.spans.length : result.spans.length,
  milliseconds: Number((performance.now() - started).toFixed(2))
}, null, 2))
