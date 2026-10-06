import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustPixelPocStyleSession, RustPixelPocStyleCancelledError, type RustPixelPocSend } from '../../src/editor/rustPixelPocStyleSession.ts'
import type { RustPixelPocResponse } from '../../src/editor/rustPixelPocProtocol.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const region = { x: 0, y: 0, width: 1, height: 1 }
const input = { sourceIdentity: 'png-v1', sourceWidth: 1, sourceHeight: 1,
  styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 } }
const source = async () => ({ type: 'raster' as const, blob: rustMediaBlob() })
const decoded = async (blob: Blob) => JSON.parse(await blob.text()) as { width: number; height: number; rgba: number[] }

test('Sessão retorna PNG integral/tile com mesmos bytes/offsets do RGBA e reutiliza fonte', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  let loads = 0
  const args = { ...input, styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [
    { type: 'drop-shadow', size: 0, distance: 1, angle: 0, useGlobalLight: false, opacity: 100, color: '#ff0000', layerKnocksOutShadow: false },
    { type: 'color-overlay', opacity: 50, color: '#0000ff' }
  ] }), source: async () => { loads++; return source() } }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const raw = await session.composeMedia(args)
    const png = await session.composeMediaPng(args)
    assert.equal(png.sourceId, raw.sourceId); assert.equal(png.offsetX, -1); assert.equal(png.width, 2)
    assert.deepEqual((await decoded(png.blob)).rgba, [...new Uint8Array(raw.rgba)])
    assert.ok(!('rgba' in png))
    const tile = await session.composeMediaPng({ ...args, region: { ...region, x: 1 },
      styles: normalizeLayerStyleConfig({ ...args.styles, fillOpacity: 100 }) })
    assert.deepEqual(await decoded(tile.blob), { width: 1, height: 1, rgba: [20, 30, 168, 255] })
    assert.equal(tile.offsetX, 0); assert.equal(tile.sourceId, png.sourceId); assert.equal(loads, 1)
    assert.ok(Object.values(tile.encoding).every(value => Number.isFinite(value) && value >= 0))
  } finally { await session.dispose(); await harness.close() }
})

test('PNG usa padrão atual sem cache de resultado nem upload da fonte repetido', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  const pattern = { id: 'pattern', name: 'fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }
  const args = { ...input, source, styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [{ type: 'pattern-overlay', pattern }] }) }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const red = await session.composeMediaPng({ ...args, patterns: { pattern: rustMediaBlob({ rgba: [255, 0, 0, 255] }) } })
    const green = await session.composeMediaPng({ ...args, patterns: { pattern: rustMediaBlob({ rgba: [0, 255, 0, 255] }) } })
    assert.deepEqual((await decoded(red.blob)).rgba, [255, 0, 0, 255])
    assert.deepEqual((await decoded(green.blob)).rgba, [0, 255, 0, 255]); assert.equal(red.sourceId, green.sourceId)
  } finally { await session.dispose(); await harness.close() }
})

test('Cancelamento durante encode não publica PNG e mantém fonte reutilizável', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: true }), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const staged = await send({ type: 'stage-style-media', input, source: await source(), generation: 1 })
    assert.ok(staged.type === 'source-staged')
    const started = harness.waitForEncoding()
    const pending = send({ type: 'style-media-staged-png', input, region, sourceId: staged.sourceId, patterns: {} })
    await started; harness.cancel(pending.id)
    harness.releaseEncoding()
    assert.equal((await pending).type, 'cancelled')
    const next = await send({ type: 'style-media-staged-png', input, region, sourceId: staged.sourceId, patterns: {} })
    assert.ok(next.type === 'encoded-staged-region')
    assert.deepEqual((await decoded(next.blob)).rgba, [40, 60, 80, 255])
  } finally { await harness.close() }
})

test('Troca de fonte durante encode rejeita PNG antigo sem bloquear lifecycle', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: true }), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const staged = await send({ type: 'stage-style-media', input, source: await source(), generation: 1 })
    assert.ok(staged.type === 'source-staged')
    const started = harness.waitForEncoding()
    const pending = send({ type: 'style-media-staged-png', input, region, sourceId: staged.sourceId, patterns: {} })
    await started
    assert.equal((await send({ type: 'invalidate-source', generation: 2 })).type, 'source-invalidated')
    const replacement = send({ type: 'stage-style-media', input, generation: 2,
      source: { type: 'raster', blob: rustMediaBlob({ rgba: [1, 2, 3, 255] }) } })
    harness.releaseEncoding()
    const obsolete = await pending; assert.ok(obsolete.type === 'error' && obsolete.code === 'invalid-input')
    const next = await replacement; assert.ok(next.type === 'source-staged')
    const png = await send({ type: 'style-media-staged-png', input, region, sourceId: next.sourceId, patterns: {} })
    assert.ok(png.type === 'encoded-staged-region')
    assert.deepEqual((await decoded(png.blob)).rgba, [1, 2, 3, 255])
  } finally { await harness.close() }
})

test('Dispose/reinit durante encode não publica resultado do runtime anterior', async () => {
  for (const dispose of [true, false]) {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: true }), { send } = harness
    try {
      await send({ type: 'init', wasm: wasm.slice(0) })
      const staged = await send({ type: 'stage-style-media', input, source: await source(), generation: 1 })
      assert.ok(staged.type === 'source-staged')
      const started = harness.waitForEncoding()
      const pending = send({ type: 'style-media-staged-png', input, region, sourceId: staged.sourceId, patterns: {} })
      await started
      if (dispose) assert.equal((await send({ type: 'dispose' })).type, 'disposed')
      assert.equal((await send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
      harness.releaseEncoding()
      assert.equal((await pending).type, 'cancelled')
      const next = await send({ type: 'stage-style-media', input, source: await source(), generation: 1 })
      assert.ok(next.type === 'source-staged')
      assert.equal((await send({ type: 'style-media-staged-png', input, region, sourceId: next.sourceId, patterns: {} })).type, 'encoded-staged-region')
    } finally { await harness.close() }
  }
})

test('Sessão publica só o último pedido mesmo se o PNG anterior estiver codificando', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: true }), session = new RustPixelPocStyleSession(harness.send)
  let loads = 0
  const args = { ...input, source: async () => { loads++; return source() } }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const started = harness.waitForEncoding()
    const first = session.composeMediaPng(args)
    const rejected = assert.rejects(first, error => error instanceof RustPixelPocStyleCancelledError)
    await started
    const second = session.composeMediaPng({ ...args, styles: normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#ff0000' }] }) })
    harness.releaseEncoding()
    await rejected
    assert.deepEqual((await decoded((await second).blob)).rgba, [255, 0, 0, 255]); assert.equal(loads, 1)
  } finally { await session.dispose(); await harness.close() }
})

test('Cancelamento remoto durante encode chega à sessão como cancelamento, não erro de pixels', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: true })
  let renderId = 0
  const send: RustPixelPocSend = (request, transfers) => {
    const pending = harness.send(request, transfers)
    if (request.type === 'style-media-staged-png') renderId = pending.id
    return pending
  }
  const session = new RustPixelPocStyleSession(send)
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const started = harness.waitForEncoding()
    const pending = session.composeMediaPng({ ...input, source })
    const rejected = assert.rejects(pending, error => error instanceof RustPixelPocStyleCancelledError)
    await started; harness.cancel(renderId); harness.releaseEncoding()
    await rejected
    assert.equal((await session.composeMediaPng({ ...input, source })).blob.type, 'image/png')
  } finally { await session.dispose(); await harness.close() }
})

test('Falha de encoder permite retry com mesma fonte; preflight PNG evita loader', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true, failEncodeCount: 1 }), session = new RustPixelPocStyleSession(harness.send)
  let loads = 0
  const args = { ...input, source: async () => { loads++; return source() } }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    await assert.rejects(session.composeMediaPng({ ...args, sourceWidth: 2700, sourceHeight: 2700 }), /memory-limit/)
    assert.equal(loads, 0)
    const raw = await session.composeMedia(args)
    await assert.rejects(session.composeMediaPng(args), /wasm-failure/)
    const png = await session.composeMediaPng(args)
    assert.equal(png.sourceId, raw.sourceId); assert.equal(loads, 1)
    assert.deepEqual((await decoded(png.blob)).rgba, [40, 60, 80, 255])
  } finally { await session.dispose(); await harness.close() }
})

test('Sessão rejeita ack PNG malformado ou de outro tipo sem envenenar fonte', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true })
  let mutation: ((response: Extract<RustPixelPocResponse, { type: 'encoded-staged-region' }>) => RustPixelPocResponse) | null = null
  const send: RustPixelPocSend = (request, transfers) => {
    const pending = harness.send(request, transfers)
    return Object.assign(pending.then(response => response.type === 'encoded-staged-region' && mutation ? mutation(response) : response), { id: pending.id })
  }
  const session = new RustPixelPocStyleSession(send)
  let loads = 0
  const args = { ...input, source: async () => { loads++; return source() } }
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    for (const change of [
      { width: 2 }, { generation: 999 }, { sourceId: 999 }, { id: 999 }, { blob: new Blob() },
      { blob: new Blob(['x'], { type: 'image/jpeg' }) }, { encoding: { canvasUploadMs: NaN, pngEncodeMs: 0 } },
      { encoding: { canvasUploadMs: 0, pngEncodeMs: -1 } }, { type: 'rendered-staged-region', rgba: new ArrayBuffer(4) }
    ]) {
      mutation = response => ({ ...response, ...change }) as RustPixelPocResponse
      await assert.rejects(session.composeMediaPng(args), /wasm-failure/)
    }
    mutation = null
    assert.equal((await session.composeMediaPng(args)).blob.type, 'image/png'); assert.equal(loads, 1)
  } finally { await session.dispose(); await harness.close() }
})
