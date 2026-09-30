import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { createDefaultLayerEffect, normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { applyLayerStyleBlendIfUnderlying, composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'

const size = Number(process.argv[2] ?? 512)
const samples = Number(process.argv[3] ?? 5)
if (!Number.isInteger(size) || size < 16 || size > 2048 ||
    !Number.isInteger(samples) || samples < 1 || samples > 20) {
  throw new Error('Uso: node --experimental-strip-types benchmarks/layerStyleBaseline.mjs [lado 16..2048] [amostras 1..20]')
}

const source = { width: size, height: size, data: new Uint8ClampedArray(size * size * 4) }
const backdrop = new Uint8ClampedArray(size * size * 4)
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const offset = (y * size + x) * 4
  source.data[offset] = x % 256
  source.data[offset + 1] = y % 256
  source.data[offset + 2] = (x + y) % 256
  source.data[offset + 3] = x > size / 8 && x < size * 7 / 8 && y > size / 8 && y < size * 7 / 8 ? 255 : 0
  backdrop[offset] = (x * 17 + y * 7) % 256
  backdrop[offset + 1] = 60
  backdrop[offset + 2] = 120
  backdrop[offset + 3] = 255
}

const light = { angle: 120, altitude: 30 }
const shadow = createDefaultLayerEffect('drop-shadow', 'benchmark-shadow')
shadow.size = 12
shadow.distance = 6
const gradient = createDefaultLayerEffect('gradient-overlay', 'benchmark-gradient')
const bevel = createDefaultLayerEffect('bevel-emboss', 'benchmark-bevel')
bevel.size = 5
const pattern = createDefaultLayerEffect('pattern-overlay', 'benchmark-pattern')
pattern.pattern = {
  id: 'benchmark-pattern-asset', name: 'Benchmark', width: 4, height: 4,
  mimeType: 'image/png', sourceUrl: 'benchmark:pattern'
}
const patternPixels = new Uint8ClampedArray(4 * 4 * 4)
for (let i = 0; i < patternPixels.length; i += 4) {
  patternPixels[i] = i % 32 ? 30 : 210
  patternPixels[i + 1] = 90
  patternPixels[i + 2] = 170
  patternPixels[i + 3] = 255
}
const patterns = new Map([[pattern.pattern.id, { width: 4, height: 4, data: patternPixels }]])

function styles(effects, fillOpacity = 100, blendIf) {
  return normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects, blendIf })
}

const jobs = [
  { id: 'fill-opacity', run: () => composeLayerStyleRaster(source, styles([], 50), light).data },
  { id: 'drop-shadow', run: () => composeLayerStyleRaster(source, styles([shadow]), light).data },
  { id: 'gradient-overlay', run: () => composeLayerStyleRaster(source, styles([gradient]), light).data },
  { id: 'bevel-emboss', run: () => composeLayerStyleRaster(source, styles([bevel]), light).data },
  { id: 'pattern-overlay', run: () => composeLayerStyleRaster(source, styles([pattern]), light, 1, patterns).data },
  { id: 'blend-if-underlying', run: () => {
    const data = source.data.slice()
    applyLayerStyleBlendIfUnderlying(data, backdrop, styles([], 100, {
      channel: 'red', thisLayer: { shadows: [0, 0], highlights: [255, 255] },
      underlyingLayer: { shadows: [64, 192], highlights: [255, 255] }
    }))
    return data
  } }
]

function percentile(sorted, fraction) {
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}

console.log(JSON.stringify({
  kind: 'environment', node: process.version, platform: process.platform,
  arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model,
  cpuCount: os.cpus().length, size, samples, warmups: 2,
  scope: 'CPU TS puro; não inclui decode, Canvas, Worker, handoff ou GC controlado'
}))

for (const job of jobs) {
  for (let index = 0; index < 2; index++) job.run()
  const elapsed = []
  let output
  for (let index = 0; index < samples; index++) {
    const started = performance.now()
    output = job.run()
    elapsed.push(performance.now() - started)
  }
  elapsed.sort((first, second) => first - second)
  console.log(JSON.stringify({
    kind: 'case', id: job.id, medianMs: percentile(elapsed, 0.5),
    p95Ms: percentile(elapsed, 0.95), minMs: elapsed[0], maxMs: elapsed.at(-1),
    outputBytes: output.byteLength, rssBytes: process.memoryUsage().rss,
    checksum: output.reduce((sum, value, index) => (sum + Math.imul(value, index + 1)) >>> 0, 0)
  }))
}
