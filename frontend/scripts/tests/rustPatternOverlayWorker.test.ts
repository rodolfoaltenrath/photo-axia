import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

test('Worker padrão transfere target/textura, reusa máscara e rejeita tiles obsoletos', async () => {
  const harness = createRustPixelWorkerHarness()
  const { send } = harness
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate()
    const source = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 128, 70, 80, 90, 0])
    const staged = await send({ type: 'stage-source', rgba: source.buffer, sourceWidth: 3,
      sourceHeight: 1, generation: gate.beginSourceChange() }, [source.buffer])
    assert.equal(source.byteLength, 0)
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    const region = { x: 1, y: 0, width: 2, height: 1 }
    const effect = { angle: 0, scale: 100, opacity: 100, blendMode: 'normal' as const }
    const target = new Uint8Array(8)
    const pattern = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
    const request = send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region, target: target.buffer, pattern: { rgba: pattern.buffer, width: 2, height: 1 }, effect },
    [target.buffer, pattern.buffer])
    assert.equal(target.byteLength, 0)
    assert.equal(pattern.byteLength, 0)
    const token = gate.captureTile('pattern', request.id)
    assert.ok(token)
    const result = await request
    assert.ok(token.isCurrent(result))
    assert.equal(result.generation, staged.generation)
    assert.deepEqual([...new Uint8Array(result.rgba)], [0, 0, 255, 128, 0, 0, 0, 0])

    const invalid = await send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region, target: new ArrayBuffer(8), pattern: { rgba: new ArrayBuffer(4), width: 2, height: 1 }, effect })
    assert.deepEqual(invalid, { type: 'error', id: invalid.id, code: 'invalid-input' })
    gate.beginViewChange() // Changing texture/scale must not reuse an older appearance.
    assert.equal(token.isCurrent(result), false)
    const changedPattern = new Uint8Array([200, 120, 40, 255])
    const newer = send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region, target: new ArrayBuffer(8), pattern: { rgba: changedPattern.buffer, width: 1, height: 1 }, effect },
    [changedPattern.buffer])
    const currentToken = gate.captureTile('pattern', newer.id)
    assert.ok(currentToken)
    const current = await newer
    assert.ok(currentToken.isCurrent(current))
    assert.equal(current.sourceId, result.sourceId)
    assert.equal(current.generation, result.generation)
    assert.deepEqual([...new Uint8Array(current.rgba)], [200, 120, 40, 128, 0, 0, 0, 0])

    // Capture two consecutive requests for one tile before consuming either result.
    const older = send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region, target: new ArrayBuffer(8), pattern: { rgba: new ArrayBuffer(4), width: 1, height: 1 }, effect })
    const olderToken = gate.captureTile('pattern', older.id)
    const newerAgain = send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region, target: new ArrayBuffer(8), pattern: { rgba: new ArrayBuffer(4), width: 1, height: 1 }, effect })
    const newestToken = gate.captureTile('pattern', newerAgain.id)
    const [olderResult, newestResult] = await Promise.all([older, newerAgain])
    assert.ok(olderToken && newestToken)
    assert.equal(olderToken.isCurrent(olderResult), false)
    assert.ok(newestToken.isCurrent(newestResult))
    const invalidated = await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    assert.equal(invalidated.type, 'source-invalidated')
    assert.equal(newestToken.isCurrent(newestResult), false)
    const stale = await send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region, target: new ArrayBuffer(8), pattern: { rgba: new ArrayBuffer(4), width: 1, height: 1 }, effect })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
