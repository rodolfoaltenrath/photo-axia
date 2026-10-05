import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { prepareRustDropShadow } from '../../src/editor/rustPixelPocDropShadow.ts'
import { shadowEffect, shadowLight, shadowReference } from './support/rustDropShadowFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker sombra transfere target, mantém fonte e invalida ruído/luz/tile ultrapassados', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 37, height = 29, source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 29 % 256)
  const original = source.slice(), fullTarget = Uint8Array.from(source, (_, index) => index * 19 % 256)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate(), staged = await send({ type: 'stage-source', rgba: source.buffer,
      sourceWidth: width, sourceHeight: height, generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    assert.equal(source.byteLength, 0)
    const region = { x: 9, y: 12, width: 7, height: 5 }, target = gradientTile(fullTarget, width, region), effect = shadowEffect()
    const request = send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId, region,
      target: target.buffer as ArrayBuffer, shadow: prepareRustDropShadow(effect, shadowLight, 1) }, [target.buffer as ArrayBuffer])
    const token = gate.captureTile('shadow', request.id), result = await request
    assert.equal(target.byteLength, 0)
    assert.ok(token && token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), gradientTile(shadowReference(original, width, height, fullTarget, effect), width, region))
    gate.beginViewChange()
    assert.equal(token.isCurrent(result), false)
    const changed = shadowEffect({ useGlobalLight: true, noise: 100, id: 'edited-seed' })
    const older = send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, shadow: prepareRustDropShadow(effect, shadowLight, 1) })
    const olderToken = gate.captureTile('shadow', older.id)
    const newer = send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, shadow: prepareRustDropShadow(changed, shadowLight, 1) })
    const newerToken = gate.captureTile('shadow', newer.id), [first, last] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(first), false); assert.ok(newerToken && newerToken.isCurrent(last))
    assert.equal(last.sourceId, staged.sourceId)
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(shadowReference(original, width, height, fullTarget, changed), width, region))
    const bad = await send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(1), shadow: prepareRustDropShadow(effect, shadowLight, 1) })
    assert.deepEqual(bad, { type: 'error', id: bad.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, shadow: prepareRustDropShadow(effect, shadowLight, 1) })).type,
      'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    assert.equal(newerToken.isCurrent(last), false)
    const stale = await send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(7 * 5 * 4), shadow: prepareRustDropShadow(effect, shadowLight, 1) })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
