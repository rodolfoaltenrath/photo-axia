import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { prepareRustBevel } from '../../src/editor/rustPixelPocBevel.ts'
import { bevelEffect, bevelReference, bevelLight } from './support/rustBevelFixture.ts'
import { strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker bisel transfere target/textura e invalida técnica, vista e fonte antigas', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 37, height = 29, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 29 % 256)
  const original = source.slice(), fullTarget = Uint8Array.from(source, (_, i) => i * 19 % 256)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate(), staged = await send({ type: 'stage-source', rgba: source.buffer,
      sourceWidth: width, sourceHeight: height, generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged)); assert.equal(source.byteLength, 0)
    const region = { x: 9, y: 12, width: 7, height: 5 }, effect = bevelEffect({ style: 'emboss',
      textureEnabled: true, texture: strokePatternAsset, textureScale: 137.5, textureDepth: 17.5 })
    const texture = { ...strokePattern, rgba: strokePattern.rgba.slice() }, target = gradientTile(fullTarget, width, region)
    const request = send({ type: 'bevel-staged-region', sourceId: staged.sourceId, region,
      target: target.buffer as ArrayBuffer, bevel: prepareRustBevel(effect, bevelLight, 1, texture) }, [target.buffer as ArrayBuffer, texture.rgba.buffer])
    const token = gate.captureTile('bevel', request.id), result = await request
    assert.equal(target.byteLength, 0); assert.equal(texture.rgba.byteLength, 0); assert.ok(token && token.isCurrent(result))
    assert.deepEqual(new Uint8Array(result.rgba), gradientTile(bevelReference(original, width, height, fullTarget, effect, bevelLight, 1, strokePattern), width, region))
    gate.beginViewChange(); assert.equal(token.isCurrent(result), false)
    const changed = bevelEffect({ technique: 'chisel-hard', style: 'pillow-emboss', direction: 'down', size: 7 })
    const older = send({ type: 'bevel-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, bevel: prepareRustBevel(effect, bevelLight, 1, strokePattern) })
    const olderToken = gate.captureTile('bevel', older.id)
    const newer = send({ type: 'bevel-staged-region', sourceId: staged.sourceId, region,
      target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, bevel: prepareRustBevel(changed, bevelLight, 1) })
    const newerToken = gate.captureTile('bevel', newer.id), [first, last] = await Promise.all([older, newer])
    assert.equal(olderToken?.isCurrent(first), false); assert.ok(newerToken && newerToken.isCurrent(last))
    assert.deepEqual(new Uint8Array(last.rgba), gradientTile(bevelReference(original, width, height, fullTarget, changed), width, region))
    const bevel = prepareRustBevel(changed, bevelLight, 1)
    for (const bad of [bevel, { ...bevel, radius: NaN }]) {
      const failure = await send({ type: 'bevel-staged-region', sourceId: staged.sourceId, region,
        target: bad === bevel ? new ArrayBuffer(1) : new ArrayBuffer(7 * 5 * 4), bevel: bad })
      assert.deepEqual(failure, { type: 'error', id: failure.id, code: 'invalid-input' })
    }
    assert.equal((await send({ type: 'bevel-staged-region', sourceId: staged.sourceId, region, target: new ArrayBuffer(7 * 5 * 4), bevel })).type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    const stale = await send({ type: 'bevel-staged-region', sourceId: staged.sourceId, region, target: new ArrayBuffer(7 * 5 * 4), bevel })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
