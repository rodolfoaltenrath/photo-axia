import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { prepareRustStyleJob } from '../../src/editor/rustPixelPocStylePreparation.ts'
import { RustPixelPocStyleSession, RustPixelPocStyleCancelledError, type RustPixelPocSend, type RustPixelPocStyleRequest } from '../../src/editor/rustPixelPocStyleSession.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { combinedStages } from './support/rustStagesFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const light = { angle: 123.5, altitude: 48 }, patterns = new Map([[strokePatternAsset.id, strokePattern]])
const pixels = { width: 17, height: 13, data: Uint8ClampedArray.from({ length: 17 * 13 * 4 }, (_, i) => i * 29 % 256) }
const base: RustPixelPocStyleRequest = { sourceIdentity: 'doc/layer/revision-1', sourceWidth: 17, sourceHeight: 13,
  styles: combinedStages(), globalLight: light, patterns, source: async () => pixels }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function setup() {
  const harness = createRustPixelWorkerHarness(), calls: Parameters<RustPixelPocSend>[0][] = []
  const send: RustPixelPocSend = (request, transfers) => { calls.push(request); return harness.send(request, transfers) }
  assert.equal((await send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
  return { harness, send, calls, session: new RustPixelPocStyleSession(send), count: (type: string) => calls.filter(call => call.type === type).length }
}
function expected(request: RustPixelPocStyleRequest = base) {
  return composeLayerStyleRaster(pixels, request.styles, request.globalLight, request.resolutionScale,
    new Map([...request.patterns ?? []].map(([id, item]) => [id, { width: item.width, height: item.height, data: new Uint8ClampedArray(item.rgba) }])))
}

test('Sessão reproduz os 16 goldens a partir da fonte original e devolve offsets corretos', async () => {
  const { harness, session } = await setup()
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  try {
    for (const fixture of corpus.rasterCases) {
      const source = { width: fixture.source.width, height: fixture.source.height, data: new Uint8ClampedArray(fixture.source.rgba) }
      const original = source.data.slice()
      const result = await session.compose({ sourceIdentity: fixture.id, sourceWidth: source.width, sourceHeight: source.height,
        source: async () => source, styles: fixture.styles, globalLight: fixture.globalLight, resolutionScale: fixture.resolutionScale,
        patterns: new Map((fixture.patterns ?? []).map((item: { id: string; width: number; height: number; rgba: number[] }) =>
          [item.id, { width: item.width, height: item.height, rgba: new Uint8Array(item.rgba) }])) })
      assert.deepEqual([...new Uint8Array(result.rgba)], fixture.expected.rgba, fixture.id)
      assert.equal(result.width, fixture.expected.width); assert.equal(result.height, fixture.expected.height)
      assert.equal(result.offsetX, fixture.expected.offsetX); assert.equal(result.offsetY, fixture.expected.offsetY)
      assert.deepEqual(source.data, original)
    }
    await session.dispose()
  } finally { await harness.close() }
})

test('Sessão reusa upload entre Fill, cores, faixas, textura e tiles; reenvia se geometria/escala muda', async () => {
  const { harness, session, count } = await setup()
  let loads = 0
  const request = { ...base, source: async () => { loads++; return pixels } }
  try {
    const first = await session.compose(request), reference = expected()
    assert.deepEqual(new Uint8Array(first.rgba), new Uint8Array(reference.data))
    const region = { x: 2, y: 3, width: 7, height: 5 }
    const tiled = await session.compose({ ...request, region })
    assert.equal(tiled.sourceId, first.sourceId); assert.equal(loads, 1); assert.equal(count('stage-style-source'), 1)
    assert.equal(tiled.offsetX, reference.offsetX + region.x); assert.equal(tiled.offsetY, reference.offsetY + region.y)
    assert.deepEqual(new Uint8Array(tiled.rgba), gradientTile(new Uint8Array(reference.data), reference.width, region))
    const styles = normalizeLayerStyleConfig({ ...base.styles, fillOpacity: 0,
      effects: base.styles.effects.map(effect => effect.type === 'color-overlay' ? { ...effect, color: '#abcdef' } : effect),
      blendIf: { channel: 'blue', thisLayer: { shadows: [0, 70], highlights: [200, 255] } } })
    const changed = { ...request, styles, patterns: new Map([[strokePatternAsset.id, { ...strokePattern, rgba: strokePattern.rgba.slice().fill(117) }]]) }
    const second = await session.compose(changed)
    assert.deepEqual(new Uint8Array(second.rgba), new Uint8Array(expected(changed).data))
    assert.equal(second.sourceId, first.sourceId); assert.equal(loads, 1); assert.equal(count('stage-style-source'), 1)
    for (const change of [{ resolutionScale: 1.00001 }, { quality: 'interactive' as const },
      { sourceIdentity: 'doc/layer/revision-2' }, { globalLight: { angle: 0, altitude: 48 } }]) {
      const result = await session.compose({ ...request, ...change })
      assert.notEqual(result.sourceId, first.sourceId)
      assert.deepEqual(new Uint8Array(result.rgba), new Uint8Array(expected({ ...request, ...change }).data))
    }
    assert.equal(loads, 5); assert.equal(count('stage-style-source'), 5)
    await session.dispose()
  } finally { await harness.close() }
})

test('Pedidos concorrentes compartilham decode pendente mas só o último publica', async () => {
  const { harness, session, count } = await setup(), loaded = deferred<typeof pixels>(), started = deferred<void>()
  let loads = 0
  const request = { ...base, source: async () => { loads++; started.resolve(); return loaded.promise } }
  try {
    const first = session.compose(request), firstRejected = assert.rejects(first, RustPixelPocStyleCancelledError)
    await started.promise
    const second = session.compose({ ...request, styles: normalizeLayerStyleConfig({ ...base.styles, fillOpacity: 0 }) })
    loaded.resolve(pixels)
    await firstRejected
    const result = await second
    assert.equal(loads, 1); assert.equal(count('stage-style-source'), 1); assert.equal(count('style-stages-staged-region'), 1)
    assert.deepEqual(new Uint8Array(result.rgba), new Uint8Array(expected({ ...request, styles: normalizeLayerStyleConfig({ ...base.styles, fillOpacity: 0 }) }).data))
    await session.dispose()
  } finally { await harness.close() }
})

test('Decode antigo, invalidação e fechamento não podem subir pixels atrasados', async () => {
  const { harness, session, count } = await setup(), loaded = deferred<typeof pixels>(), started = deferred<void>()
  try {
    const first = session.compose({ ...base, source: async () => { started.resolve(); return loaded.promise } })
    const rejected = assert.rejects(first, RustPixelPocStyleCancelledError)
    await started.promise
    const current = await session.compose({ ...base, sourceIdentity: 'new-content' })
    loaded.resolve(pixels); await rejected
    assert.equal(count('stage-style-source'), 1)
    await session.invalidate()
    const stale = await harness.send({ type: 'style-stages-staged-region', sourceId: current.sourceId,
      region: prepareRustStyleJob(base).region, plan: prepareRustStyleJob(base).plan })
    assert.equal(stale.type, 'error')
    const next = await session.compose({ ...base, sourceIdentity: 'new-content' })
    assert.notEqual(next.sourceId, current.sourceId)
    const loadedAgain = deferred<typeof pixels>(), startedAgain = deferred<void>()
    const pending = session.compose({ ...base, sourceIdentity: 'pending', source: async () => { startedAgain.resolve(); return loadedAgain.promise } })
    const pendingRejected = assert.rejects(pending, RustPixelPocStyleCancelledError)
    await startedAgain.promise; await session.dispose(); loadedAgain.resolve(pixels); await pendingRejected
    assert.equal(count('stage-style-source'), 2)
    await session.dispose()
    await assert.rejects(session.compose(base), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-unavailable')
  } finally { await harness.close() }
})

test('Falha de decode/validação permite retry; preflight não decodifica nem manda upload', async () => {
  const { harness, session, count } = await setup()
  try {
    await assert.rejects(session.compose({ ...base, source: async () => { throw new Error('decode-failed') } }), /decode-failed/)
    await assert.rejects(session.compose({ ...base, source: async () => ({ ...pixels, data: new Uint8ClampedArray(1) }) }), RustPixelPocError)
    const first = await session.compose(base)
    assert.equal(count('stage-style-source'), 1)
    const before = count('invalidate-source')
    await assert.rejects(session.compose({ ...base, sourceWidth: 3000, sourceHeight: 3000,
      styles: normalizeLayerStyleConfig({}), region: { x: 0, y: 0, width: 1, height: 1 }, source: async () => { assert.fail('must not decode') } }),
      (e: unknown) => e instanceof RustPixelPocError && e.code === 'memory-limit')
    assert.equal(count('invalidate-source'), before)
    const second = await session.compose(base)
    assert.equal(second.sourceId, first.sourceId)
    await session.dispose()
  } finally { await harness.close() }
})

test('Resposta tardia de kernel não publica nem invalida fonte atual; erro de render permite retry', async () => {
  const { harness, send, count } = await setup()
  const responseReady = deferred<void>(), delayed = deferred<void>()
  let hold = true, fail = false, wrongLength = false
  const transport: RustPixelPocSend = (request, transfers) => {
    const execution = send(request, transfers)
    const wrapped = execution.then(async response => {
      if (request.type === 'style-stages-staged-region') {
        if (hold) { hold = false; responseReady.resolve(); await delayed.promise }
        if (fail) { fail = false; return { type: 'error' as const, id: execution.id, code: 'wasm-failure' as const } }
        if (wrongLength && response.type === 'rendered-staged-region') { wrongLength = false; return { ...response, rgba: new ArrayBuffer(1) } }
      }
      return response
    })
    return Object.assign(wrapped, { id: execution.id })
  }
  const session = new RustPixelPocStyleSession(transport)
  try {
    const first = session.compose(base), rejected = assert.rejects(first, RustPixelPocStyleCancelledError)
    await responseReady.promise
    const changed = { ...base, styles: normalizeLayerStyleConfig({ ...base.styles, fillOpacity: 0 }) }
    const current = await session.compose(changed)
    delayed.resolve(); await rejected
    assert.equal(count('stage-style-source'), 1)
    assert.deepEqual(new Uint8Array(current.rgba), new Uint8Array(expected(changed).data))
    fail = true
    await assert.rejects(session.compose(base), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-failure')
    wrongLength = true
    await assert.rejects(session.compose(base), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-failure')
    const retry = await session.compose(base)
    assert.equal(retry.sourceId, current.sourceId); assert.equal(count('stage-style-source'), 1)
    assert.deepEqual(new Uint8Array(retry.rgba), new Uint8Array(expected().data))
    const one = session.dispose(), two = session.dispose()
    assert.equal(one, two); await one
  } finally { delayed.resolve(); await harness.close() }
})

test('Reinício exige sessão nova e não aceita pixels staged do Worker anterior', async () => {
  const { harness, session, send } = await setup()
  try {
    const first = await session.compose(base)
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
    await assert.rejects(session.compose(base), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-unavailable')
    assert.equal((await send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    await assert.rejects(session.compose(base), (e: unknown) => e instanceof RustPixelPocError && e.code === 'invalid-input')
    const replacement = new RustPixelPocStyleSession(send), next = await replacement.compose(base)
    assert.notEqual(first.sourceId, next.sourceId)
    assert.deepEqual(new Uint8Array(next.rgba), new Uint8Array(expected().data))
    await replacement.dispose()
  } finally { await harness.close() }
})

test('Sessão envia só RGBA original próprio para preparação, sem textura e sem destacar dados do editor', async () => {
  const { harness, session, calls } = await setup(), original = pixels.data.slice()
  try {
    await session.compose(base)
    const uploads = calls.filter(call => call.type === 'stage-style-source')
    assert.equal(uploads.length, 1); assert.equal(calls.some(call => call.type === 'stage-source'), false)
    const upload = uploads[0]!
    assert.equal(upload.rgba.byteLength, 0)
    assert.equal(upload.input.sourceWidth, pixels.width); assert.equal(upload.input.sourceHeight, pixels.height)
    assert.equal('patterns' in upload.input, false)
    assert.deepEqual(pixels.data, original)
    assert.ok(pixels.data.byteLength > 0 && strokePattern.rgba.byteLength > 0)
    await session.dispose()
  } finally { await harness.close() }
})

test('Ack de preparação ausente ou incompatível não publica; retry refaz upload com geração nova', async () => {
  const { harness, send, count } = await setup()
  let corrupt: 'missing' | 'key' | 'width' | 'offset' | 'timing' | null = null
  const transport: RustPixelPocSend = (request, transfers) => {
    const execution = send(request, transfers)
    return Object.assign(execution.then(response => {
      if (request.type === 'stage-style-source' && response.type === 'source-staged' && corrupt) {
        const kind = corrupt
        corrupt = null
        if (kind === 'missing') return { ...response, prepared: undefined }
        const prepared = { ...response.prepared! }
        if (kind === 'key') prepared.sourceKey = 'wrong-key'
        if (kind === 'width') prepared.width++
        if (kind === 'offset') prepared.offsetX++
        if (kind === 'timing') prepared.preparationMs = NaN
        return { ...response, prepared }
      }
      return response
    }), { id: execution.id })
  }
  const session = new RustPixelPocStyleSession(transport)
  try {
    for (const kind of ['missing', 'key', 'width', 'offset', 'timing'] as const) {
      await session.invalidate()
      corrupt = kind
      const before = count('style-stages-staged-region'), uploads = count('stage-style-source')
      await assert.rejects(session.compose(base), (e: unknown) => e instanceof RustPixelPocError && e.code === 'wasm-failure')
      assert.equal(count('style-stages-staged-region'), before)
      const next = await session.compose(base)
      assert.equal(count('stage-style-source'), uploads + 2)
      assert.deepEqual(new Uint8Array(next.rgba), new Uint8Array(expected().data))
    }
    await session.dispose()
  } finally { await harness.close() }
})
