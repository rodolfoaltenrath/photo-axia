import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { stagesFixture, combinedStages } from './support/rustStagesFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'

test('Worker executa sequência inteira, transfere textura uma vez e rejeita respostas antigas', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness, gate = new RustPixelPocTileGate()
  const source = Uint8Array.from({ length: 17 * 13 * 4 }, (_, i) => i * 29 % 256), light = { angle: 123.5, altitude: 48 }
  const decoded = { ...strokePattern, rgba: strokePattern.rgba.slice() }, patterns = new Map([[strokePatternAsset.id, decoded]])
  const job = stagesFixture(source, 17, 13, combinedStages(), light, 1, patterns)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const staged = await send({ type: 'stage-source', rgba: job.rgba.buffer, sourceWidth: job.width,
      sourceHeight: job.height, generation: gate.beginSourceChange() }, [job.rgba.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged)); assert.equal(job.rgba.byteLength, 0)
    const region = { x: 3, y: 5, width: 7, height: 5 }, request = send({ type: 'style-stages-staged-region', sourceId: staged.sourceId,
      region, plan: job.plan }, [decoded.rgba.buffer])
    const token = gate.captureTile('stages', request.id), result = await request
    assert.equal(decoded.rgba.byteLength, 0); assert.ok(token && token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), gradientTile(new Uint8Array(job.expected.data), job.width, region))
    gate.beginViewChange(); assert.equal(token.isCurrent(result), false)
    const untransferred = stagesFixture(source, 17, 13, combinedStages(), light, 1, new Map([[strokePatternAsset.id, strokePattern]])).plan
    const older = send({ type: 'style-stages-staged-region', sourceId: staged.sourceId, region, plan: untransferred })
    const olderToken = gate.captureTile('stages', older.id)
    const newer = send({ type: 'style-stages-staged-region', sourceId: staged.sourceId, region, plan: untransferred })
    const newerToken = gate.captureTile('stages', newer.id), [first, last] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(first), false); assert.ok(newerToken && newerToken.isCurrent(last))
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(new Uint8Array(job.expected.data), job.width, region))
    const failed = await send({ type: 'style-stages-staged-region', sourceId: staged.sourceId, region, plan: { ...untransferred, fillOpacity: NaN } })
    assert.deepEqual(failed, { type: 'error', id: failed.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'style-stages-staged-region', sourceId: staged.sourceId, region, plan: untransferred })).type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    const stale = await send({ type: 'style-stages-staged-region', sourceId: staged.sourceId, region, plan: untransferred })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
