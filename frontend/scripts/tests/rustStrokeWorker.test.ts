import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { prepareRustStroke } from '../../src/editor/rustPixelPocStroke.ts'
import { strokeEffect, strokeReference, strokeGradient, strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker traçado transfere target/textura e invalida pintura, posição, vista e fonte antigas', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 37, height = 29, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 29 % 256)
  const original = source.slice(), fullTarget = Uint8Array.from(source, (_, i) => i * 19 % 256)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate(), staged = await send({ type: 'stage-source', rgba: source.buffer,
      sourceWidth: width, sourceHeight: height, generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged)); assert.equal(source.byteLength, 0)
    const region = { x: 9, y: 12, width: 7, height: 5 }, effect = strokeEffect({ position: 'center',
      paint: { type: 'pattern', pattern: strokePatternAsset, angle: -77.75, scale: 137.5 } })
    const texture = { ...strokePattern, rgba: strokePattern.rgba.slice() }, target = gradientTile(fullTarget, width, region)
    const request = send({ type: 'stroke-staged-region', sourceId: staged.sourceId, region,
      target: target.buffer as ArrayBuffer, stroke: prepareRustStroke(effect, 1, texture) }, [target.buffer as ArrayBuffer, texture.rgba.buffer])
    const token = gate.captureTile('stroke', request.id), result = await request
    assert.equal(target.byteLength, 0); assert.equal(texture.rgba.byteLength, 0); assert.ok(token && token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), gradientTile(strokeReference(original, width, height, fullTarget, effect), width, region))
    gate.beginViewChange(); assert.equal(token.isCurrent(result), false)
    const changed = strokeEffect({ position: 'inside', size: 7, paint: strokeGradient })
    const older = send({ type: 'stroke-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, stroke: prepareRustStroke(effect, 1, strokePattern) })
    const olderToken = gate.captureTile('stroke', older.id)
    const newer = send({ type: 'stroke-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, stroke: prepareRustStroke(changed, 1) })
    const newerToken = gate.captureTile('stroke', newer.id), [first, last] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(first), false); assert.ok(newerToken && newerToken.isCurrent(last))
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(strokeReference(original, width, height, fullTarget, changed), width, region))
    const stroke = prepareRustStroke(changed, 1)
    for (const bad of [stroke, { ...stroke, insideRadius: NaN }]) {
      const failure = await send({ type: 'stroke-staged-region', sourceId: staged.sourceId, region,
        target: bad === stroke ? new ArrayBuffer(1) : new ArrayBuffer(7 * 5 * 4), stroke: bad })
      assert.deepEqual(failure, { type: 'error', id: failure.id, code: 'invalid-input' })
    }
    assert.equal((await send({ type: 'stroke-staged-region', sourceId: staged.sourceId, region, target: new ArrayBuffer(7 * 5 * 4), stroke })).type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    const stale = await send({ type: 'stroke-staged-region', sourceId: staged.sourceId, region, target: new ArrayBuffer(7 * 5 * 4), stroke })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
