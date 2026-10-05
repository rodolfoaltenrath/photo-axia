import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { createRustPixelPocRuntime } from '../src/editor/rustPixelPocRuntime.ts'
import { batchPlan, batchReference } from '../scripts/tests/support/rustBatchFixture.ts'

const side = Number(process.argv[2] ?? 1024), samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 || !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-local-batch -- [lado 16..2048] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const single = await createRustPixelPocRuntime(wasm), batch = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 19 % 256)
const plan = structuredClone(batchPlan)
plan.fillOpacity = 60
delete plan.thisLayerBlendIf
const color = plan.effects[0]!, gradient = plan.effects[1]!, pattern = plan.effects[2]!
assert.equal(color.type, 'color-overlay'); assert.equal(gradient.type, 'gradient-overlay'); assert.equal(pattern.type, 'pattern-overlay')
const colorEffect = color.effect, gradientEffect = gradient.effect, patternEffect = pattern.effect, patternRaster = pattern.pattern
const singleSource = single.stageSource(source, side, side, 1), batchSource = batch.stageSource(source, side, side, 1)
const region = { x: 0, y: 0, width: side, height: side }
const expected = batchReference(source, side, side, plan)
const timings = { singleTotalMs: [] as number[], batchTotalMs: [] as number[], singleKernelsMs: [] as number[],
  batchKernelMs: [] as number[], singleCopyInMs: [] as number[], batchCopyInMs: [] as number[],
  singleCopyOutMs: [] as number[], batchCopyOutMs: [] as number[] }
function singlePass() {
  const started = performance.now()
  const fill = single.renderStagedRegion(singleSource.sourceId, region, plan.fillOpacity)
  const colored = single.colorOverlayStagedRegion(singleSource.sourceId, region, fill.rgba, colorEffect)
  const graded = single.gradientOverlayStagedRegion(singleSource.sourceId, region, colored.rgba, gradientEffect)
  const patterned = single.patternOverlayStagedRegion(singleSource.sourceId, region, graded.rgba, patternRaster, patternEffect)
  const elapsed = performance.now() - started
  const passes = [fill, colored, graded, patterned]
  return { rgba: patterned.rgba, elapsed, kernel: passes.reduce((sum, pass) => sum + pass.timings.kernelMs, 0),
    copyIn: passes.reduce((sum, pass) => sum + pass.timings.copyInMs, 0), copyOut: passes.reduce((sum, pass) => sum + pass.timings.copyOutMs, 0) }
}
function batchPass() {
  const started = performance.now()
  const result = batch.localBatchStagedRegion(batchSource.sourceId, region, plan)
  return { rgba: result.rgba, elapsed: performance.now() - started, kernel: result.timings.kernelMs,
    copyIn: result.timings.copyInMs, copyOut: result.timings.copyOutMs }
}
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    let a, b
    if (iteration % 2 === 0) { a = singlePass(); b = batchPass() }
    else { b = batchPass(); a = singlePass() }
    assert.deepEqual(a.rgba, expected); assert.deepEqual(b.rgba, expected)
    if (iteration < 0) continue
    timings.singleTotalMs.push(a.elapsed); timings.batchTotalMs.push(b.elapsed)
    timings.singleKernelsMs.push(a.kernel); timings.batchKernelMs.push(b.kernel)
    timings.singleCopyInMs.push(a.copyIn); timings.batchCopyInMs.push(b.copyIn)
    timings.singleCopyOutMs.push(a.copyOut); timings.batchCopyOutMs.push(b.copyOut)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version, platform: platform(),
    osRelease: release(), cpu: cpus()[0]?.model, fillOpacity: plan.fillOpacity, effects: plan.effects.map(pass => pass.type),
    stagingMs: { single: singleSource.stagingMs, batch: batchSource.stagingMs }, parity: 'byte-exact',
    timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])),
    copyOutBytes: { single: source.byteLength * 4, batch: source.byteLength },
    scope: 'Node Rust/WASM fill → color → gradient → pattern; prepared masks; excludes This layer, Worker, Canvas and UI' })}\n`)
} finally { single.dispose(); batch.dispose() }
