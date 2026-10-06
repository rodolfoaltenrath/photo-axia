import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform } from 'node:os'
import { createRustPixelPocRuntime } from '../src/editor/rustPixelPocRuntime.ts'
import { styleStagesLayout } from '../src/editor/rustPixelPocStages.ts'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { stagesFixture, combinedStages } from '../scripts/tests/support/rustStagesFixture.ts'
import { strokePattern, strokePatternAsset } from '../scripts/tests/support/rustStrokeFixture.ts'
import { gradientTile } from '../scripts/tests/support/rustGradientFixture.ts'

const side = Number(process.argv[2] ?? 512), samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 1024 || !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-stages -- [lado 16..1024] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL('../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const source = Uint8Array.from({ length: side * side * 4 }, (_, i) => i * 29 % 256), light = { angle: 123.5, altitude: 48 }
const styles = combinedStages(), patterns = new Map([[strokePatternAsset.id, strokePattern]])
const job = stagesFixture(source, side, side, styles, light, 1, patterns), runtime = await createRustPixelPocRuntime(wasm)
const staged = runtime.stageSource(job.rgba, job.width, job.height, 1)
const tile = { x: Math.floor(job.width / 4), y: Math.floor(job.height / 4), width: Math.floor(job.width / 2), height: Math.floor(job.height / 2) }
const expected = new Uint8Array(job.expected.data), tileExpected = gradientTile(expected, job.width, tile)
const rasterPatterns = new Map([[strokePatternAsset.id, { width: strokePattern.width, height: strokePattern.height, data: new Uint8ClampedArray(strokePattern.rgba) }]])
const raster = { width: side, height: side, data: new Uint8ClampedArray(source) }
const timings = { tsFullMs: [] as number[], rustFullMs: [] as number[], rustFullKernelMs: [] as number[],
  rustFullCopyInMs: [] as number[], rustFullCopyOutMs: [] as number[], rustTileMs: [] as number[], rustTileKernelMs: [] as number[] }
function tsPass() {
  const started = performance.now(), result = composeLayerStyleRaster(raster, styles, light, 1, rasterPatterns)
  return { rgba: result.data, elapsed: performance.now() - started }
}
function rustPass(region: typeof tile) {
  const started = performance.now(), result = runtime.styleStagesStagedRegion(staged.sourceId, region, job.plan)
  return { ...result, elapsed: performance.now() - started }
}
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    let a, b
    if (iteration % 2 === 0) { a = tsPass(); b = rustPass(job.region) } else { b = rustPass(job.region); a = tsPass() }
    const c = rustPass(tile)
    assert.deepEqual(new Uint8Array(a.rgba), expected); assert.deepEqual(b.rgba, expected); assert.deepEqual(c.rgba, tileExpected)
    if (iteration < 0) continue
    timings.tsFullMs.push(a.elapsed); timings.rustFullMs.push(b.elapsed); timings.rustFullKernelMs.push(b.timings.kernelMs)
    timings.rustFullCopyInMs.push(b.timings.copyInMs); timings.rustFullCopyOutMs.push(b.timings.copyOutMs)
    timings.rustTileMs.push(c.elapsed); timings.rustTileKernelMs.push(c.timings.kernelMs)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version, platform: platform(), cpu: cpus()[0]?.model,
    effects: styles.effects.map(effect => effect.type), fillOpacity: styles.fillOpacity, stagingMs: staged.stagingMs, parity: 'byte-exact',
    layouts: { full: styleStagesLayout(job.plan, job.width, job.height, job.region), tile: styleStagesLayout(job.plan, job.width, job.height, tile) },
    preparedSize: [job.width, job.height], tile,
    timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])),
    scope: 'Node layer styles only. TS compositor includes padding/normalization; Rust uses staged padded source and prepared parameters, with packet assembly/copies in adapter. No decode, Worker, Canvas, UI, document transforms or RSS.' })}\n`)
} finally { runtime.dispose() }
