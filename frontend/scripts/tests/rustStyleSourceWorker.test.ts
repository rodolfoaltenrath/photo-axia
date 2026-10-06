import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { copyRustStyleSource, padRustStyleSource, prepareRustStyleSourceLayout } from '../../src/editor/rustPixelPocStylePreparation.ts'
import type { RustPixelPocStyleSourceInput } from '../../src/editor/rustPixelPocStylePreparation.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const light = { angle: 123.5, altitude: 48 }
const styles = normalizeLayerStyleConfig({ effects: [
  { type: 'drop-shadow', id: 'shadow', size: 3, distance: 5, useGlobalLight: true },
  { type: 'stroke', id: 'stroke', size: 2, position: 'outside' }
] })
const input: RustPixelPocStyleSourceInput = { sourceIdentity: 'doc/layer/edit-1', sourceWidth: 7, sourceHeight: 5, styles, globalLight: light }
const source = { width: 7, height: 5, data: Uint8ClampedArray.from({ length: 7 * 5 * 4 }, (_, i) => i * 29 % 256) }
const region = { x: 0, y: 0, width: 1, height: 1 }

test('Worker prepara padding real após transfer da fonte original e confirma geometria/identidade', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  const original = source.data.slice()
  let generation = 0
  try {
    assert.equal((await send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    for (const scale of [0.5, 1, 1.375, 8, 10, NaN]) for (const enabled of [true, false]) {
      const args = { ...input, resolutionScale: scale, styles: { ...styles, enabled } }
      const layout = prepareRustStyleSourceLayout(args), rgba = copyRustStyleSource(source, layout)
      assert.equal(rgba.byteLength, source.data.byteLength)
      assert.notEqual(rgba.buffer, source.data.buffer)
      const staged = await send({ type: 'stage-style-source', input: args, rgba: rgba.buffer, generation: ++generation }, [rgba.buffer])
      assert.equal(rgba.byteLength, 0); assert.deepEqual(source.data, original)
      assert.ok(staged.type === 'source-staged' && staged.prepared)
      assert.equal(staged.prepared.sourceKey, layout.sourceKey)
      assert.equal(staged.prepared.width, layout.width); assert.equal(staged.prepared.height, layout.height)
      assert.equal(staged.prepared.offsetX, layout.offsetX); assert.equal(staged.prepared.offsetY, layout.offsetY)
      assert.ok(Number.isFinite(staged.prepared.preparationMs) && staged.prepared.preparationMs >= 0)
      assert.ok(Number.isFinite(staged.stagingMs) && staged.stagingMs >= 0)
      const full = { x: 0, y: 0, width: layout.width, height: layout.height }
      const rendered = await send({ type: 'render-staged-region', sourceId: staged.sourceId, region: full, fillOpacity: 100 })
      assert.ok(rendered.type === 'rendered-staged-region')
      assert.deepEqual(new Uint8Array(rendered.rgba), padRustStyleSource(source, layout))
    }
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})

test('Preflight/bytes inválidos no Worker retiram fonte anterior; geração atrasada não retira a atual', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  let generation = 0
  const upload = async () => send({ type: 'stage-style-source', input,
    rgba: new Uint8Array(source.data).buffer, generation: ++generation })
  try {
    assert.equal((await send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    const badInputs = [{ ...input, sourceWidth: 0 }, { ...input, sourceHeight: 0.5 },
      { ...input, sourceIdentity: '' }, null as unknown as typeof input,
      { ...input, sourceWidth: 3000, sourceHeight: 3000, styles: normalizeLayerStyleConfig({}) }]
    for (const badInput of badInputs) {
      const old = await upload(); assert.ok(old.type === 'source-staged')
      const failedGeneration = ++generation
      const failed = await send({ type: 'stage-style-source', input: badInput,
        rgba: new Uint8Array(source.data).buffer, generation: failedGeneration })
      assert.ok(failed.type === 'error')
      assert.equal(failed.code, badInput?.sourceWidth === 3000 ? 'memory-limit' : 'invalid-input')
      const stale = await send({ type: 'render-staged-region', sourceId: old.sourceId, region, fillOpacity: 100 })
      assert.ok(stale.type === 'error' && stale.code === 'invalid-input')
      const duplicate = await send({ type: 'stage-style-source', input,
        rgba: new Uint8Array(source.data).buffer, generation: failedGeneration })
      assert.ok(duplicate.type === 'error' && duplicate.code === 'invalid-input')
    }
    for (const rgba of [new ArrayBuffer(0), new ArrayBuffer(1), new ArrayBuffer(source.data.byteLength - 4)]) {
      const old = await upload(); assert.ok(old.type === 'source-staged')
      const failed = await send({ type: 'stage-style-source', input, rgba, generation: ++generation })
      assert.ok(failed.type === 'error' && failed.code === 'invalid-input')
      assert.equal((await send({ type: 'render-staged-region', sourceId: old.sourceId, region, fillOpacity: 100 })).type, 'error')
    }
    const current = await upload(); assert.ok(current.type === 'source-staged')
    const late = await send({ type: 'stage-style-source', input, rgba: new ArrayBuffer(1), generation: generation - 1 })
    assert.ok(late.type === 'error' && late.code === 'invalid-input')
    assert.equal((await send({ type: 'render-staged-region', sourceId: current.sourceId, region, fillOpacity: 100 })).type, 'rendered-staged-region')
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})

test('Fonte preparada respeita geração reservada, é liberável e não sobrevive ao dispose/reinit', async () => {
  const harness = createRustPixelWorkerHarness(), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    await send({ type: 'invalidate-source', generation: 1 })
    const staged = await send({ type: 'stage-style-source', input, rgba: new Uint8Array(source.data).buffer, generation: 1 })
    assert.ok(staged.type === 'source-staged')
    assert.equal((await send({ type: 'release-source', sourceId: staged.sourceId })).type, 'source-released')
    assert.equal((await send({ type: 'render-staged-region', sourceId: staged.sourceId, region, fillOpacity: 100 })).type, 'error')
    await send({ type: 'dispose' })
    const absent = await send({ type: 'stage-style-source', input, rgba: new Uint8Array(source.data).buffer, generation: 2 })
    assert.ok(absent.type === 'error' && absent.code === 'wasm-unavailable')
    await send({ type: 'init', wasm: wasm.slice(0) })
    const next = await send({ type: 'stage-style-source', input, rgba: new Uint8Array(source.data).buffer, generation: 1 })
    assert.ok(next.type === 'source-staged'); assert.notEqual(next.sourceId, staged.sourceId)
    assert.equal((await send({ type: 'render-staged-region', sourceId: staged.sourceId, region, fillOpacity: 100 })).type, 'error')
  } finally { await harness.close() }
})

test('Factory não executa para geração rejeitada/runtime encerrado; falha consome geração e libera fonte', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const original = new Uint8Array([40, 60, 80, 101]), full = { x: 0, y: 0, width: 1, height: 1 }
  let calls = 0
  const prepare = () => { calls++; return { rgba: original, width: 1, height: 1 } }
  try {
    const first = runtime.stagePreparedSource(prepare, 1)
    assert.equal(calls, 1)
    assert.throws(() => runtime.stagePreparedSource(prepare, 1), RustPixelPocError)
    assert.equal(calls, 1)
    assert.deepEqual(runtime.renderStagedRegion(first.sourceId, full, 100).rgba, original)
    assert.throws(() => runtime.stagePreparedSource(() => { throw new RustPixelPocError('memory-limit') }, 2),
      (e: unknown) => e instanceof RustPixelPocError && e.code === 'memory-limit')
    assert.throws(() => runtime.renderStagedRegion(first.sourceId, full, 100), RustPixelPocError)
    assert.throws(() => runtime.stagePreparedSource(prepare, 2), RustPixelPocError)
    assert.equal(calls, 1)
    runtime.invalidateSource(3)
    const next = runtime.stagePreparedSource(prepare, 3)
    assert.equal(calls, 2); assert.deepEqual(runtime.renderStagedRegion(next.sourceId, full, 100).rgba, original)
    runtime.dispose()
    assert.throws(() => runtime.stagePreparedSource(prepare, 4), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-unavailable')
    assert.equal(calls, 2)
  } finally { runtime.dispose() }
})
