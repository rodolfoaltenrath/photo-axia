import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { prepareRustGlow } from '../../src/editor/rustPixelPocGlow.ts'
import { glowEffect, glowGradient, glowReference } from './support/rustGlowFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'

test('Worker brilho transfere buffers, mantém fonte e invalida paint/técnica/ruído e pedidos ultrapassados', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const width = 37, height = 29, source = Uint8Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? (i >>> 2) % 256 : i * 29 % 256)
  const original = source.slice(), fullTarget = Uint8Array.from(source, (_, i) => i * 19 % 256)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate(), staged = await send({ type: 'stage-source', rgba: source.buffer,
      sourceWidth: width, sourceHeight: height, generation: gate.beginSourceChange() }, [source.buffer])
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged)); assert.equal(source.byteLength, 0)
    const region = { x: 9, y: 12, width: 7, height: 5 }
    for (const kind of ['outer', 'inner-edge', 'inner-center'] as const) {
      const effect = glowEffect(kind), target = gradientTile(fullTarget, width, region)
      const request = send({ type: 'glow-staged-region', sourceId: staged.sourceId, region,
        target: target.buffer as ArrayBuffer, glow: prepareRustGlow(effect, 1) }, [target.buffer as ArrayBuffer])
      const token = gate.captureTile('glow', request.id), result = await request
      assert.equal(target.byteLength, 0); assert.ok(token && token.isCurrent(result))
      assert.deepEqual(new Uint8Array(result.rgba), gradientTile(glowReference(original, width, height, fullTarget, effect), width, region))
      gate.beginViewChange(); assert.equal(token.isCurrent(result), false)
      const changed = glowEffect(kind, { paint: glowGradient, technique: 'precise', range: 1, jitter: 100, noise: 100, id: 'edited-seed' })
      const older = send({ type: 'glow-staged-region', sourceId: staged.sourceId, region,
        target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, glow: prepareRustGlow(effect, 1) })
      const olderToken = gate.captureTile('glow', older.id)
      const newer = send({ type: 'glow-staged-region', sourceId: staged.sourceId, region,
        target: gradientTile(fullTarget, width, region).buffer as ArrayBuffer, glow: prepareRustGlow(changed, 1) })
      const newerToken = gate.captureTile('glow', newer.id), [first, last] = await Promise.all([older, newer])
      assert.equal(olderToken?.isCurrent(first), false); assert.ok(newerToken && newerToken.isCurrent(last))
      assert.equal(last.sourceId, staged.sourceId)
      assert.deepEqual(new Uint8Array(last.rgba), gradientTile(glowReference(original, width, height, fullTarget, changed), width, region))
    }
    const glow = prepareRustGlow(glowEffect('outer'), 1)
    for (const bad of [glow, { ...glow, jitter: NaN }]) {
      const result = await send({ type: 'glow-staged-region', sourceId: staged.sourceId, region,
        target: bad === glow ? new ArrayBuffer(1) : new ArrayBuffer(7 * 5 * 4), glow: bad })
      assert.deepEqual(result, { type: 'error', id: result.id, code: 'invalid-input' })
    }
    assert.equal((await send({ type: 'glow-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(7 * 5 * 4), glow })).type, 'rendered-staged-region')
    await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    const stale = await send({ type: 'glow-staged-region', sourceId: staged.sourceId, region,
      target: new ArrayBuffer(7 * 5 * 4), glow })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
