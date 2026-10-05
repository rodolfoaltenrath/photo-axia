import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { prepareRustSatin } from '../../src/editor/rustPixelPocSatin.ts'
import { satinEffect, satinReference } from './support/rustSatinFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker acetinado transfere buffers e rejeita tiles antigos após editar efeito, vista e fonte', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 37, height = 29, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 29 % 256)
  const original = source.slice(), fullTarget = Uint8Array.from(source, (_, i) => i * 19 % 256)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate(), staged = await send({ type: 'stage-source', rgba: source.buffer,
      sourceWidth: width, sourceHeight: height, generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged)); assert.equal(source.byteLength, 0)
    const region = { x: 9, y: 12, width: 7, height: 5 }, effect = satinEffect(), target = gradientTile(fullTarget, width, region)
    const request = send({ type: 'satin-staged-region', sourceId: staged.sourceId, region,
      target: target.buffer as ArrayBuffer, satin: prepareRustSatin(effect, 1) }, [target.buffer as ArrayBuffer])
    const token = gate.captureTile('satin', request.id), result = await request
    assert.equal(target.byteLength, 0); assert.ok(token && token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), gradientTile(satinReference(original, width, height, fullTarget, effect), width, region))
    gate.beginViewChange(); assert.equal(token.isCurrent(result), false)
    const changed = satinEffect({ invert: !effect.invert, angle: 33.333, distance: 8, size: 7,
      contour: { preset: 'custom', points: [{ x: 0, y: 0.75 }, { x: 1, y: 0.25 }] } })
    const older = send({ type: 'satin-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, satin: prepareRustSatin(effect, 1) })
    const olderToken = gate.captureTile('satin', older.id)
    const newer = send({ type: 'satin-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, satin: prepareRustSatin(changed, 1) })
    const newerToken = gate.captureTile('satin', newer.id), [first, last] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(first), false); assert.ok(newerToken && newerToken.isCurrent(last))
    assert.equal(last.sourceId, staged.sourceId)
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(satinReference(original, width, height, fullTarget, changed), width, region))
    const satin = prepareRustSatin(effect, 1)
    for (const bad of [satin, { ...satin, radius: NaN }]) {
      const failure = await send({ type: 'satin-staged-region', sourceId: staged.sourceId, region,
        target: bad === satin ? new ArrayBuffer(1) : new ArrayBuffer(7 * 5 * 4), satin: bad })
      assert.deepEqual(failure, { type: 'error', id: failure.id, code: 'invalid-input' })
    }
    assert.equal((await send({ type: 'satin-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(7 * 5 * 4), satin })).type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    const stale = await send({ type: 'satin-staged-region', sourceId: staged.sourceId, region, target: new ArrayBuffer(7 * 5 * 4), satin })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
