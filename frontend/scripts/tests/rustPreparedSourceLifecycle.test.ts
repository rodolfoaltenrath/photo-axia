import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const region = { x: 0, y: 0, width: 1, height: 1 }
const pixels = new Uint8Array([75, 20, 30, 101])
const invalid = (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input'

test('Invalidação reserva uma geração para seu upload, sem aceitar duplicatas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    for (const generation of [null, undefined, '1', 0, NaN]) {
      assert.throws(() => runtime.stageSource(pixels, 1, 1, generation as number), invalid)
    }
    const first = runtime.stageSource(pixels, 1, 1, 1)
    runtime.invalidateSource(2)
    assert.throws(() => runtime.renderStagedRegion(first.sourceId, region, 100), invalid)
    assert.throws(() => runtime.invalidateSource(2), invalid)
    assert.throws(() => runtime.stageSource(pixels, 1, 1, 1), invalid)
    const next = runtime.stageSource(pixels, 1, 1, 2)
    assert.equal(next.generation, 2)
    assert.throws(() => runtime.stageSource(pixels, 1, 1, 2), invalid)
    assert.throws(() => runtime.stageSource(pixels, 1, 1, null as unknown as number), invalid)
    assert.deepEqual(runtime.renderStagedRegion(next.sourceId, region, 100).rgba, pixels)
    assert.equal(runtime.renderStagedRegion(next.sourceId, region, 100).timings.copyInMs, 0)
    runtime.releaseSource(next.sourceId)
    assert.throws(() => runtime.stageSource(pixels, 1, 1, 2), invalid)
  } finally { runtime.dispose() }
})

test('Upload atrasado não consome a reserva atual; upload inválido consome a própria geração', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    runtime.invalidateSource(1)
    runtime.invalidateSource(2)
    for (const generation of [0, 1, -1, NaN, Infinity, 2.5]) {
      assert.throws(() => runtime.stageSource(pixels, 1, 1, generation), invalid)
    }
    assert.throws(() => runtime.stageSource(pixels, 2, 2, 2), invalid)
    assert.throws(() => runtime.stageSource(pixels, 1, 1, 2), invalid)
    runtime.invalidateSource(3)
    const staged = runtime.stageSource(pixels, 1, 1, 3)
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, region, 100).rgba, pixels)
    runtime.invalidateSource(4)
    const newer = runtime.stageSource(pixels, 1, 1, 5)
    assert.throws(() => runtime.stageSource(pixels, 1, 1, 4), invalid)
    assert.deepEqual(runtime.renderStagedRegion(newer.sourceId, region, 100).rgba, pixels)
    assert.throws(() => runtime.stageSource(pixels, 2, 2, 6), invalid)
    assert.throws(() => runtime.renderStagedRegion(newer.sourceId, region, 100), invalid)
    const recovered = runtime.stageSource(pixels, 1, 1, 7)
    assert.equal(recovered.generation, 7)
    runtime.dispose()
    assert.throws(() => runtime.stageSource(pixels, 1, 1, 8),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})
