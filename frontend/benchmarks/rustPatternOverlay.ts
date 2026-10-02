import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { createRustPixelPocRuntime, type RustPixelPocPatternRaster,
  type RustPixelPocPatternOverlay } from '../src/editor/rustPixelPocRuntime.ts'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const side = Number(process.argv[2] ?? 1024)
const samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 ||
    !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-pattern-overlay -- [lado 16..2048] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const runtime = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 19 % 256)
const pattern: RustPixelPocPatternRaster = { width: 31, height: 17,
  rgba: Uint8Array.from({ length: 31 * 17 * 4 }, (_, index) => (index * 37 + 13) % 256) }
const tsSource = { width: side, height: side, data: new Uint8ClampedArray(source) }
const tsPatterns = new Map([['pattern', { width: pattern.width, height: pattern.height,
  data: new Uint8ClampedArray(pattern.rgba) }]])
const fillOpacity = 60
const styles = normalizeLayerStyleConfig({ enabled: true, fillOpacity, effects: [
  { type: 'pattern-overlay', id: 'benchmark', angle: -33.333, scale: 175.5, opacity: 73.5, blendMode: 'overlay',
    pattern: { id: 'pattern', name: 'Pattern', mimeType: 'image/png', sourceUrl: 'fixture:pattern',
      width: pattern.width, height: pattern.height } }
] })
const normalizedEffect = styles.effects[0]!
if (normalizedEffect.type !== 'pattern-overlay') throw new Error('Efeito inválido no benchmark.')
const effect: RustPixelPocPatternOverlay = { angle: normalizedEffect.angle, scale: normalizedEffect.scale,
  opacity: normalizedEffect.opacity, blendMode: normalizedEffect.blendMode }
const light = { angle: 0, altitude: 30 }
const staged = runtime.stageSource(source, side, side, 1)
const region = { x: 0, y: 0, width: side, height: side }
const times = { tsTotalMs: [] as number[], rustRuntimeTotalMs: [] as number[],
  rustKernelsMs: [] as number[], rustCopyInMs: [] as number[], rustCopyOutMs: [] as number[] }
function tsPass() {
  const started = performance.now()
  const output = composeLayerStyleRaster(tsSource, styles, light, 1, tsPatterns).data
  return { output, elapsed: performance.now() - started }
}
function rustPass() {
  const started = performance.now()
  const filled = runtime.renderStagedRegion(staged.sourceId, region, fillOpacity)
  const patterned = runtime.patternOverlayStagedRegion(staged.sourceId, region, filled.rgba, pattern, effect)
  return { rgba: patterned.rgba, elapsed: performance.now() - started,
    kernels: filled.timings.kernelMs + patterned.timings.kernelMs,
    copyIn: filled.timings.copyInMs + patterned.timings.copyInMs,
    copyOut: filled.timings.copyOutMs + patterned.timings.copyOutMs }
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    // Includes both calls, intermediate output/reupload and pattern upload per job.
    // The source/texture are decoded before timing; parity comparison is untimed.
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
    platform: platform(), osRelease: release(), cpu: cpus()[0]?.model, fillOpacity,
    pattern: { width: pattern.width, height: pattern.height, bytes: pattern.rgba.byteLength },
    effect: { angle: effect.angle, scale: effect.scale, opacity: effect.opacity, blendMode: effect.blendMode },
    stagingMs: staged.stagingMs, timings: Object.fromEntries(Object.entries(times)
      .map(([key, values]) => [key, summarize(values)])), parity: 'byte-exact',
    scope: 'Node, fill → pattern overlay; includes intermediate copies and pattern upload per job; excludes Worker, Canvas, DOM and GPU' })}\n`)
} finally { runtime.dispose() }
