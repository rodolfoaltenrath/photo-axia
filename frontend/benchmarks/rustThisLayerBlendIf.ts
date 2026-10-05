import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { createRustPixelPocRuntime } from '../src/editor/rustPixelPocRuntime.ts'
import { layerStyleBlendIfOpacity, normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const side = Number(process.argv[2] ?? 1024)
const samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 ||
    !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-this-layer-blend-if -- [lado 16..2048] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const runtime = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 19 % 256)
const config = { channel: 'gray' as const, shadows: [50, 100] as [number, number],
  highlights: [180, 240] as [number, number] }
const blendIf = normalizeLayerStyleConfig({ enabled: true, effects: [],
  blendIf: { channel: config.channel, thisLayer: config } }).blendIf
const staged = runtime.stageSource(source, side, side, 1)
const region = { x: 0, y: 0, width: side, height: side }
const times = { tsReferenceTotalMs: [] as number[], rustRuntimeTotalMs: [] as number[],
  rustKernelMs: [] as number[], rustCopyOutMs: [] as number[] }

function tsPass() {
  const started = performance.now()
  const output = new Uint8ClampedArray(source)
  // Alpha-only reference, not full compositor timing.
  for (let offset = 0; offset < output.length; offset += 4) {
    if (output[offset + 3] === 0) continue
    output[offset + 3] = Math.round(output[offset + 3]! * layerStyleBlendIfOpacity(blendIf,
      { red: output[offset]!, green: output[offset + 1]!, blue: output[offset + 2]! }))
  }
  return { output, elapsed: performance.now() - started }
}
function rustPass() {
  const started = performance.now()
  const result = runtime.blendIfThisLayerStagedRegion(staged.sourceId, region, config)
  return { ...result, elapsed: performance.now() - started }
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    // Alternate order; validate every result outside timing.
    let ts, rust
    if (iteration % 2 === 0) { ts = tsPass(); rust = rustPass() }
    else { rust = rustPass(); ts = tsPass() }
    assert.deepEqual(rust.rgba, new Uint8Array(ts.output))
    assert.equal(rust.timings.copyInMs, 0)
    if (iteration < 0) continue
    times.tsReferenceTotalMs.push(ts.elapsed)
    times.rustRuntimeTotalMs.push(rust.elapsed)
    times.rustKernelMs.push(rust.timings.kernelMs)
    times.rustCopyOutMs.push(rust.timings.copyOutMs)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version,
    platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, channel: config.channel,
    stagingMs: staged.stagingMs, timings: Object.fromEntries(Object.entries(times)
      .map(([key, values]) => [key, summarize(values)])), parity: 'byte-exact',
    scope: 'Node, styled RGBA; TS alpha-only reference loop using current opacity helper vs staged Rust pass; excludes fill/effects, Worker, Canvas, DOM and GPU' })}\n`)
} finally { runtime.dispose() }
