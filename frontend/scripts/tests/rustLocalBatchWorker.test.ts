import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { batchPlan, batchReference } from './support/rustBatchFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker do lote transfere assets, reusa máscara e rejeita resposta/edição ultrapassada', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 7, height = 5
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  const original = source.slice()
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate()
    const staged = await send({ type: 'stage-source', rgba: source.buffer, sourceWidth: width, sourceHeight: height,
      generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    const region = { x: 1, y: 1, width: 3, height: 2 }, plan = structuredClone(batchPlan)
    const expected = gradientTile(batchReference(original, width, height, plan), width, region)
    const pattern = plan.effects[2]!
    assert.equal(pattern.type, 'pattern-overlay')
    const job = send({ type: 'local-batch-staged-region', sourceId: staged.sourceId, region, plan }, [pattern.pattern.rgba.buffer as ArrayBuffer])
    const token = gate.captureTile('batch', job.id), result = await job
    assert.equal(pattern.pattern.rgba.byteLength, 0)
    assert.ok(token && token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), expected)
    gate.beginViewChange()
    assert.equal(token.isCurrent(result), false)
    const older = send({ type: 'local-batch-staged-region', sourceId: staged.sourceId, region, plan: batchPlan })
    const olderToken = gate.captureTile('batch', older.id)
    const newer = send({ type: 'local-batch-staged-region', sourceId: staged.sourceId, region,
      plan: { ...batchPlan, fillOpacity: 0 } })
    const newerToken = gate.captureTile('batch', newer.id)
    const [first, last] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(first), false)
    assert.ok(newerToken && newerToken.isCurrent(last))
    assert.equal(last.sourceId, staged.sourceId)
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(batchReference(original, width, height,
      { ...batchPlan, fillOpacity: 0 }), width, region))
    const bad = await send({ type: 'local-batch-staged-region', sourceId: staged.sourceId, region,
      plan: { ...batchPlan, fillOpacity: NaN } })
    assert.deepEqual(bad, { type: 'error', id: bad.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'local-batch-staged-region', sourceId: staged.sourceId, region, plan: batchPlan })).type,
      'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    assert.equal(newerToken.isCurrent(last), false)
    const stale = await send({ type: 'local-batch-staged-region', sourceId: staged.sourceId, region, plan: batchPlan })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
