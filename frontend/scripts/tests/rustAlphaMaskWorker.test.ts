import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { alphaMaskReference } from './support/rustAlphaMaskFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker máscara reusa fonte/contexto, transfere saída e rejeita tiles obsoletos', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 37, height = 29, source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
  const original = source.slice()
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate()
    const staged = await send({ type: 'stage-source', rgba: source.buffer, sourceWidth: width, sourceHeight: height,
      generation: gate.beginSourceChange() }, [source.buffer])
    assert.equal(source.byteLength, 0)
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    const region = { x: 9, y: 12, width: 7, height: 5 }, config = { spreadRadius: 2, blurRadius: 4, precise: false }
    const request = send({ type: 'alpha-mask-staged-region', sourceId: staged.sourceId, region, config })
    const token = gate.captureTile('mask', request.id), result = await request
    assert.ok(token && token.isCurrent(result))
    assert.equal(result.timings.copyInMs, 0)
    assert.deepEqual(new Uint8Array(result.rgba), gradientTile(alphaMaskReference(original, width, height, config), width, region))
    gate.beginViewChange()
    assert.equal(token.isCurrent(result), false)
    const newer = send({ type: 'alpha-mask-staged-region', sourceId: staged.sourceId, region,
      config: { ...config, precise: true } })
    const newerToken = gate.captureTile('mask', newer.id), last = await newer
    assert.ok(newerToken && newerToken.isCurrent(last))
    assert.equal(last.sourceId, staged.sourceId)
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(alphaMaskReference(original, width, height,
      { ...config, precise: true }), width, region))
    const bad = await send({ type: 'alpha-mask-staged-region', sourceId: staged.sourceId, region, config: { ...config, blurRadius: NaN } })
    assert.deepEqual(bad, { type: 'error', id: bad.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'alpha-mask-staged-region', sourceId: staged.sourceId, region, config })).type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    assert.equal(newerToken.isCurrent(last), false)
    const stale = await send({ type: 'alpha-mask-staged-region', sourceId: staged.sourceId, region, config })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
