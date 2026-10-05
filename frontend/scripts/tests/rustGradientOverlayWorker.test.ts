import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { gradientEffect, gradientReference, gradientStyle } from './support/rustGradientFixture.ts'

test('Worker gradiente transfere target, reusa máscara e rejeita respostas e tipos obsoletos', async () => {
  const harness = createRustPixelWorkerHarness()
  const { send } = harness
  const source = new Uint8Array([75, 20, 30, 101, 100, 40, 50, 255, 20, 60, 70, 0])
  const original = source.slice()
  const region = { x: 0, y: 0, width: 3, height: 1 }
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate()
    const staged = await send({ type: 'stage-source', rgba: source.buffer, sourceWidth: 3,
      sourceHeight: 1, generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    const target = new Uint8Array(12)
    const request = send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: target.buffer, effect: gradientEffect }, [target.buffer])
    const token = gate.captureTile('gradient', request.id)
    const result = await request
    assert.equal(target.byteLength, 0)
    assert.ok(token)
    assert.ok(token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), new Uint8Array(gradientReference(original, 3, 1, 0, [gradientStyle(gradientEffect)]).data))
    gate.beginViewChange()
    assert.equal(token.isCurrent(result), false)
    const effect = { ...gradientEffect, reverse: true }
    const older = send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(12), effect: gradientEffect })
    const olderToken = gate.captureTile('gradient', older.id)
    const newer = send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(12), effect })
    const newerToken = gate.captureTile('gradient', newer.id)
    const [olderResult, newerResult] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(olderResult), false)
    assert.ok(newerToken)
    assert.ok(newerToken.isCurrent(newerResult))
    assert.equal(newerResult.sourceId, staged.sourceId)
    assert.deepEqual(new Uint8Array(newerResult.rgba), new Uint8Array(gradientReference(original, 3, 1, 0, [gradientStyle(effect)]).data))
    const invalid = await send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(12), effect: { ...effect, scale: 0 } })
    assert.deepEqual(invalid, { type: 'error', id: invalid.id, code: 'invalid-input' })
    const unsupported = await send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(12), effect: { ...effect, gradient: { ...effect.gradient, type: 'radial' as 'linear' } } })
    assert.deepEqual(unsupported, { type: 'error', id: unsupported.id, code: 'invalid-input' })
    const recovered = await send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(12), effect })
    assert.equal(recovered.type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    assert.equal(newerToken.isCurrent(newerResult), false)
    const stale = await send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(12), effect })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
