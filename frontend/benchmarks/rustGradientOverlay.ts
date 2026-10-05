import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { createRustPixelPocRuntime, type RustPixelPocGradientOverlay } from '../src/editor/rustPixelPocRuntime.ts'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const side = Number(process.argv[2] ?? 1024)
const samples = Number(process.argv[3] ?? 20)
const type = process.argv[4] ?? 'linear'
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 ||
    !Number.isSafeInteger(samples) || samples < 5 || samples > 100 ||
    (type !== 'linear' && type !== 'reflected' && type !== 'diamond')) {
  throw new Error('Uso: benchmark:rust-gradient-overlay -- [lado 16..2048] [amostras 5..100] [linear|reflected|diamond]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const runtime = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 19 % 256)
const tsSource = { width: side, height: side, data: new Uint8ClampedArray(source) }
const fillOpacity = 60
const styles = normalizeLayerStyleConfig({ fillOpacity, effects: [{ type: 'gradient-overlay', id: 'benchmark',
  angle: 33.333, scale: 175.5, reverse: false, opacity: 73.5, blendMode: 'overlay', gradient: {
    type, interpolation: 'srgb', colorStops: [{ position: 0, color: '#cb4795ff' },
      { position: 0.5, color: '#4795cb80' }, { position: 1, color: '#95cb47ff' }],
    opacityStops: [{ position: 0, opacity: 25 }, { position: 0.4, opacity: 100 }, { position: 1, opacity: 50 }]
  } }] })
const normalized = styles.effects[0]!
if (normalized.type !== 'gradient-overlay') throw new Error('Gradiente ausente no benchmark.')
const effect: RustPixelPocGradientOverlay = { angle: normalized.angle, scale: normalized.scale,
  reverse: normalized.reverse, opacity: normalized.opacity, blendMode: normalized.blendMode,
  gradient: { type, opacityStops: normalized.gradient.opacityStops,
    colorStops: normalized.gradient.colorStops.map(stop => ({ position: stop.position,
      color: [1, 3, 5, 7].map(index => Number.parseInt(stop.color.slice(index, index + 2), 16)) as [number, number, number, number] })) } }
const staged = runtime.stageSource(source, side, side, 1)
const region = { x: 0, y: 0, width: side, height: side }
const times = { tsTotalMs: [] as number[], rustRuntimeTotalMs: [] as number[],
  rustKernelsMs: [] as number[], rustCopyInMs: [] as number[], rustCopyOutMs: [] as number[] }
function tsPass() {
  const started = performance.now()
  const output = composeLayerStyleRaster(tsSource, styles, { angle: 30, altitude: 30 }).data
  return { output, elapsed: performance.now() - started }
}
function rustPass() {
  const started = performance.now()
  const filled = runtime.renderStagedRegion(staged.sourceId, region, fillOpacity)
  const gradient = runtime.gradientOverlayStagedRegion(staged.sourceId, region, filled.rgba, effect)
  return { rgba: gradient.rgba, elapsed: performance.now() - started,
    kernels: filled.timings.kernelMs + gradient.timings.kernelMs,
    copyIn: filled.timings.copyInMs + gradient.timings.copyInMs,
    copyOut: filled.timings.copyOutMs + gradient.timings.copyOutMs }
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    let ts, rust
    if (iteration % 2 === 0) { ts = tsPass(); rust = rustPass() }
    else { rust = rustPass(); ts = tsPass() }
    assert.deepEqual(rust.rgba, new Uint8Array(ts.output))
    if (iteration < 0) continue
    times.tsTotalMs.push(ts.elapsed); times.rustRuntimeTotalMs.push(rust.elapsed)
    times.rustKernelsMs.push(rust.kernels); times.rustCopyInMs.push(rust.copyIn); times.rustCopyOutMs.push(rust.copyOut)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version,
    platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, fillOpacity, effect,
    stagingMs: staged.stagingMs, timings: Object.fromEntries(Object.entries(times).map(([key, values]) => [key, summarize(values)])),
    parity: 'byte-exact', scope: 'Node fill → gradient; includes intermediate copies and stop uploads; excludes Worker, Canvas, DOM and GPU' })}\n`)
} finally { runtime.dispose() }
