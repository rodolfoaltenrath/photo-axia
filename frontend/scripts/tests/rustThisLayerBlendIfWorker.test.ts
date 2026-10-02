import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

test('Worker Esta camada reusa raster estilizado, invalida faixas e encadeia Camada abaixo', async () => {
  const harness = createRustPixelWorkerHarness()
  const { send } = harness
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate()
    const source = new Uint8Array([75, 20, 30, 101, 100, 40, 50, 255, 20, 60, 70, 255])
    const staged = await send({ type: 'stage-source', rgba: source.buffer, sourceWidth: 3,
      sourceHeight: 1, generation: gate.beginSourceChange() }, [source.buffer])
    assert.equal(source.byteLength, 0)
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    const region = { x: 0, y: 0, width: 3, height: 1 }
    const blendIf = { channel: 'red' as const, shadows: [50, 100] as [number, number],
      highlights: [255, 255] as [number, number] }
    const request = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    const token = gate.captureTile('this-layer', request.id)
    assert.ok(token)
    const result = await request
    assert.ok(token.isCurrent(result))
    assert.deepEqual([...new Uint8Array(result.rgba)], [75, 20, 30, 51, 100, 40, 50, 255, 20, 60, 70, 0])
    assert.equal(result.timings.copyInMs, 0)

    gate.beginViewChange() // Threshold/channel changes do not require a source upload.
    assert.equal(token.isCurrent(result), false)
    const invalid = await send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId,
      region, blendIf: { ...blendIf, shadows: [100, 50] } })
    assert.deepEqual(invalid, { type: 'error', id: invalid.id, code: 'invalid-input' })
    const next = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId,
      region, blendIf: { ...blendIf, shadows: [0, 0] } })
    const currentToken = gate.captureTile('this-layer', next.id)
    assert.ok(currentToken)
    const recovered = await next
    assert.ok(currentToken.isCurrent(recovered))
    assert.equal(recovered.sourceId, result.sourceId)
    assert.equal(recovered.generation, result.generation)
    assert.deepEqual([...new Uint8Array(recovered.rgba)], [75, 20, 30, 101, 100, 40, 50, 255, 20, 60, 70, 255])

    const older = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    const olderToken = gate.captureTile('same-tile', older.id)
    const newer = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    const newerToken = gate.captureTile('same-tile', newer.id)
    const [olderResult, newerResult] = await Promise.all([older, newer])
    assert.ok(olderToken && newerToken)
    assert.equal(olderToken.isCurrent(olderResult), false)
    assert.ok(newerToken.isCurrent(newerResult))

    // Underlying Blend If must read the alpha already filtered by This layer.
    const nextSource = await send({ type: 'stage-source', rgba: newerResult.rgba, sourceWidth: 3,
      sourceHeight: 1, generation: gate.beginSourceChange() }, [newerResult.rgba])
    assert.equal(newerToken.isCurrent(newerResult), false)
    assert.ok(nextSource.type === 'source-staged' && gate.adoptSource(nextSource))
    const backdrop = new Uint8Array([75, 0, 0, 255, 100, 0, 0, 0, 75, 0, 0, 255])
    const underlyingRequest = send({ type: 'blend-if-staged-region', sourceId: nextSource.sourceId,
      region, backdrop: backdrop.buffer, blendIf }, [backdrop.buffer])
    const underlyingToken = gate.captureTile('underlying', underlyingRequest.id)
    const underlying = await underlyingRequest
    assert.ok(underlyingToken?.isCurrent(underlying))
    assert.deepEqual([...new Uint8Array(underlying.rgba)], [75, 20, 30, 26, 100, 40, 50, 255, 20, 60, 70, 0])
    const stale = await send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    const released = await send({ type: 'release-source', sourceId: nextSource.sourceId })
    assert.equal(released.type, 'source-released')
    const afterRelease = await send({ type: 'blend-if-this-layer-staged-region', sourceId: nextSource.sourceId, region, blendIf })
    assert.deepEqual(afterRelease, { type: 'error', id: afterRelease.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
