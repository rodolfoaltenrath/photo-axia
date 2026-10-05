import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform } from 'node:os'
import { createRustPixelPocRuntime } from '../src/editor/rustPixelPocRuntime.ts'
import { prepareRustSatin, encodeSatin, satinLayout } from '../src/editor/rustPixelPocSatin.ts'
import { satinEffect, satinReference } from '../scripts/tests/support/rustSatinFixture.ts'
import { gradientTile } from '../scripts/tests/support/rustGradientFixture.ts'

const side = Number(process.argv[2] ?? 1024), samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 || !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-satin -- [lado 16..2048] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const runtime = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 29 % 256)
const target = Uint8Array.from(source, (_, index) => index * 19 % 256)
const effect = satinEffect({ size: 16, distance: 11.25 })
const satin = prepareRustSatin(effect, 1), packet = encodeSatin(satin)
const staged = runtime.stageSource(source, side, side, 1), region = { x: 0, y: 0, width: side, height: side }
const tile = { x: Math.floor(side / 4), y: Math.floor(side / 4), width: Math.floor(side / 2), height: Math.floor(side / 2) }
const tileTarget = gradientTile(target, side, tile), expected = satinReference(source, side, side, target, effect)
const tileExpected = gradientTile(expected, side, tile)
const timings = { tsFullMs: [] as number[], rustFullMs: [] as number[], rustFullKernelMs: [] as number[],
  rustFullCopyInMs: [] as number[], rustFullCopyOutMs: [] as number[], rustTileMs: [] as number[], rustTileKernelMs: [] as number[] }
function tsPass() {
  const started = performance.now(), rgba = satinReference(source, side, side, target, effect)
  return { rgba, elapsed: performance.now() - started }
}
function rustPass(area: typeof region, backdrop: Uint8Array) {
  const started = performance.now(), result = runtime.satinStagedRegion(staged.sourceId, area, backdrop, satin)
  return { ...result, elapsed: performance.now() - started }
}
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    let a, b
    if (iteration % 2 === 0) { a = tsPass(); b = rustPass(region, target) }
    else { b = rustPass(region, target); a = tsPass() }
    const c = rustPass(tile, tileTarget)
    assert.deepEqual(a.rgba, expected); assert.deepEqual(b.rgba, expected); assert.deepEqual(c.rgba, tileExpected)
    if (iteration < 0) continue
    timings.tsFullMs.push(a.elapsed); timings.rustFullMs.push(b.elapsed); timings.rustFullKernelMs.push(b.timings.kernelMs)
    timings.rustFullCopyInMs.push(b.timings.copyInMs); timings.rustFullCopyOutMs.push(b.timings.copyOutMs)
    timings.rustTileMs.push(c.elapsed); timings.rustTileKernelMs.push(c.timings.kernelMs)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version, platform: platform(),
    cpu: cpus()[0]?.model, effect, stagingMs: staged.stagingMs, parity: 'byte-exact',
    layouts: { full: satinLayout(side, side, region, satin, packet.length), tile: satinLayout(side, side, tile, satin, packet.length) },
    timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])),
    scope: 'Node satin on prepared raster/target; TS full vs Rust full/half-side tile with halo; no document padding/preparation, Worker, Canvas, UI or RSS' })}\n`)
} finally { runtime.dispose() }
