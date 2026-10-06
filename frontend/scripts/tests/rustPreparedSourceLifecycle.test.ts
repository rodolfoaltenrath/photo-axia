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

test('Preparação assíncrona não sobrevive à invalidação, substituição ou dispose', async () => {
  for (const action of ['invalidate', 'replace', 'dispose'] as const) {
    const runtime = await createRustPixelPocRuntime(wasm)
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    try {
      const old = runtime.stageSource(pixels, 1, 1, 1)
      const pending = runtime.stagePreparedSourceAsync(async check => {
        await wait; check(); return { rgba: pixels, width: 1, height: 1 }
      }, 2)
      assert.throws(() => runtime.sourceMetadata(old.sourceId), invalid)
      const newer = action === 'replace' ? runtime.stageSource(new Uint8Array([1, 2, 3, 255]), 1, 1, 3) : null
      if (action === 'invalidate') runtime.invalidateSource(3)
      if (action === 'dispose') runtime.dispose()
      const rejected = assert.rejects(pending, (error: unknown) => error instanceof RustPixelPocError &&
        error.code === (action === 'dispose' ? 'wasm-unavailable' : 'invalid-input'))
      release(); await rejected
      if (newer) assert.deepEqual(runtime.renderStagedRegion(newer.sourceId, region, 100).rgba, new Uint8Array([1, 2, 3, 255]))
      if (action === 'invalidate') {
        const next = runtime.stageSource(pixels, 1, 1, 3)
        assert.deepEqual(runtime.sourceMetadata(next.sourceId), { width: 1, height: 1, generation: 3 })
      }
    } finally { release(); runtime.dispose() }
  }
})

test('Falha de preparação assíncrona consome geração; duplicata falha antes de chamar decoder', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let calls = 0
  try {
    runtime.invalidateSource(1)
    await assert.rejects(runtime.stagePreparedSourceAsync(async () => { calls++; throw new Error('decode-failed') }, 1), /decode-failed/)
    await assert.rejects(runtime.stagePreparedSourceAsync(async () => {
      calls++; return { rgba: pixels, width: 1, height: 1 }
    }, 1), invalid)
    assert.equal(calls, 1)
    const next = await runtime.stagePreparedSourceAsync(async () => ({ rgba: pixels, width: 1, height: 1 }), 2)
    assert.deepEqual(runtime.renderStagedRegion(next.sourceId, region, 100).rgba, pixels)
  } finally { runtime.dispose() }
})

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
