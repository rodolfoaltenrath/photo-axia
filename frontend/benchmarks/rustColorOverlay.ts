import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { createRustPixelPocRuntime, type RustPixelPocColorOverlay } from '../src/editor/rustPixelPocRuntime.ts'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const side = Number(process.argv[2] ?? 1024)
const samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 ||
    !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-color-overlay -- [lado 16..2048] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const runtime = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 19 % 256)
const tsSource = { width: side, height: side, data: new Uint8ClampedArray(source) }
const fillOpacity = 60
const effect: RustPixelPocColorOverlay = { color: [203, 71, 149, 143], opacity: 73.5, blendMode: 'overlay' }
const styles = normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects: [
  { type: 'color-overlay', id: 'benchmark', color: '#cb47958f', opacity: effect.opacity, blendMode: effect.blendMode }
] })
const light = { angle: 0, altitude: 30 }
const staged = runtime.stageSource(source, side, side, 1)
const region = { x: 0, y: 0, width: side, height: side }
const times = { tsTotalMs: [] as number[], rustRuntimeTotalMs: [] as number[],
  rustKernelsMs: [] as number[], rustCopyInMs: [] as number[], rustCopyOutMs: [] as number[] }
function tsPass() {
  const started = performance.now()
  const output = composeLayerStyleRaster(tsSource, styles, light).data
  return { output, elapsed: performance.now() - started }
}
function rustPass() {
  const started = performance.now()
  const filled = runtime.renderStagedRegion(staged.sourceId, region, fillOpacity)
  const colored = runtime.colorOverlayStagedRegion(staged.sourceId, region, filled.rgba, effect)
  return { rgba: colored.rgba, elapsed: performance.now() - started,
    kernels: filled.timings.kernelMs + colored.timings.kernelMs,
    copyIn: filled.timings.copyInMs + colored.timings.copyInMs,
    copyOut: filled.timings.copyOutMs + colored.timings.copyOutMs }
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    // Compare equivalent fill → overlay outputs. Includes both runtime calls,
    // intermediate WASM → JS → WASM copies, allocations and final output copy.
    let ts, rust
    if (iteration % 2 === 0) { ts = tsPass(); rust = rustPass() }
    else { rust = rustPass(); ts = tsPass() }
    assert.deepEqual(rust.rgba, new Uint8Array(ts.output))
    if (iteration < 0) continue
    times.tsTotalMs.push(ts.elapsed)
    times.rustRuntimeTotalMs.push(rust.elapsed)
    times.rustKernelsMs.push(rust.kernels)
    times.rustCopyInMs.push(rust.copyIn)
    times.rustCopyOutMs.push(rust.copyOut)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version,
    platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, fillOpacity, effect,
    stagingMs: staged.stagingMs, timings: Object.fromEntries(Object.entries(times)
      .map(([key, values]) => [key, summarize(values)])), parity: 'byte-exact',
    scope: 'Node, fill → color overlay; includes intermediate copies and both WASM calls; excludes Worker, Canvas, DOM and GPU' })}\n`)
} finally { runtime.dispose() }
