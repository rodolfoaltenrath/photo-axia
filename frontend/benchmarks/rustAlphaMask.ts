import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { cpus, platform } from 'node:os'
import { createRustPixelPocRuntime } from '../src/editor/rustPixelPocRuntime.ts'
import { alphaMaskLayout } from '../src/editor/rustPixelPocAlphaMask.ts'
import { alphaMaskReference } from '../scripts/tests/support/rustAlphaMaskFixture.ts'
import { gradientTile } from '../scripts/tests/support/rustGradientFixture.ts'

const side = Number(process.argv[2] ?? 1024), samples = Number(process.argv[3] ?? 20)
if (!Number.isSafeInteger(side) || side < 16 || side > 2048 || !Number.isSafeInteger(samples) || samples < 5 || samples > 100) {
  throw new Error('Uso: benchmark:rust-alpha-mask -- [lado 16..2048] [amostras 5..100]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const runtime = await createRustPixelPocRuntime(wasm)
const source = Uint8Array.from({ length: side * side * 4 }, (_, index) => index * 29 % 256)
const staged = runtime.stageSource(source, side, side, 1), config = { spreadRadius: 4, blurRadius: 12, precise: false }
const region = { x: 0, y: 0, width: side, height: side }
const tile = { x: Math.floor(side / 4), y: Math.floor(side / 4), width: Math.floor(side / 2), height: Math.floor(side / 2) }
const expected = alphaMaskReference(source, side, side, config), tileExpected = gradientTile(expected, side, tile)
const timings = { tsFullMs: [] as number[], rustFullMs: [] as number[], rustFullKernelMs: [] as number[],
  rustTileMs: [] as number[], rustTileKernelMs: [] as number[] }
function tsPass() {
  const started = performance.now(), rgba = alphaMaskReference(source, side, side, config)
  return { rgba, elapsed: performance.now() - started }
}
function rustPass(area: typeof region) {
  const started = performance.now(), result = runtime.alphaMaskStagedRegion(staged.sourceId, area, config)
  return { ...result, elapsed: performance.now() - started }
}
function summary(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return { median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] }
}
try {
  for (let iteration = -3; iteration < samples; iteration++) {
    let a, b
    if (iteration % 2 === 0) { a = tsPass(); b = rustPass(region) }
    else { b = rustPass(region); a = tsPass() }
    const c = rustPass(tile)
    assert.deepEqual(a.rgba, expected); assert.deepEqual(b.rgba, expected); assert.deepEqual(c.rgba, tileExpected)
    if (iteration < 0) continue
    timings.tsFullMs.push(a.elapsed); timings.rustFullMs.push(b.elapsed); timings.rustFullKernelMs.push(b.timings.kernelMs)
    timings.rustTileMs.push(c.elapsed); timings.rustTileKernelMs.push(c.timings.kernelMs)
  }
  process.stdout.write(`${JSON.stringify({ side, samples, warmups: 3, node: process.version, platform: platform(),
    cpu: cpus()[0]?.model, config, stagingMs: staged.stagingMs, parity: 'byte-exact',
    layouts: { full: alphaMaskLayout(side, side, region, config), tile: alphaMaskLayout(side, side, tile, config) },
    timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, summary(values)])),
    scope: 'Node alpha mask primitives only; TS full raster vs Rust full/half-side tile with halo; no shadow color/offset/contour, Worker, Canvas, UI or RSS measurement' })}\n`)
} finally { runtime.dispose() }
