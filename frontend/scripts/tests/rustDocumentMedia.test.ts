import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { createRustPixelPocRuntime } from '../../src/editor/rustPixelPocRuntime.ts'
import { prepareRustDocumentMedia } from '../../src/editor/rustDocumentMedia.ts'
import { RustDocumentOffscreen, loadRustDocumentMedia } from '../../src/editor/rustDocumentOffscreen.ts'
import { RustPixelPocWorkerClient } from '../../src/editor/rustPixelPocWorkerClient.ts'
import type { RustDocumentMediaInput, RustEditorialPlan } from '../../src/editor/rustDocumentEditorial.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob, installRustMediaFixtures } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
function input(): RustDocumentMediaInput {
  return { documentWidth: 2, documentHeight: 1, width: 2, height: 1,
    grid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layers: [{
      source: { type: 'raster', blob: rustMediaBlob() }, patterns: {},
      input: { sourceIdentity: 'fixture', sourceWidth: 1, sourceHeight: 1,
        styles: normalizeLayerStyleConfig({}), globalLight: { angle: 120, altitude: 30 } },
      matrix: [1, 0, 0, 1, 0, 0], opacity: 100, blendMode: 'normal' }] }
}
function plan(): RustEditorialPlan {
  const request = input()
  return { ...request, layers: request.layers.map(layer => ({ ...layer, source: { type: 'raster', url: 'blob:fixture' } })) }
}

test('preparação documental decodifica, estiliza e corrige insets antes da composição Rust', async () => {
  const fixtures = installRustMediaFixtures(), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const request = input()
    request.layers[0]!.matrix = [1, 0, 0, 1, 1, 0]
    request.layers[0]!.input.styles = normalizeLayerStyleConfig({ fillOpacity: 0, effects: [
      { type: 'drop-shadow', color: '#ff0000', size: 0, distance: 1, angle: 0, useGlobalLight: false,
        opacity: 100, layerKnocksOutShadow: false }, { type: 'color-overlay', color: '#0000ff', opacity: 50 }
    ] })
    const prepared = runtime.prepareDocumentPacket(await prepareRustDocumentMedia(request, () => {}), 1)
    assert.deepEqual([...runtime.composePreparedDocument(prepared.documentId, { x: 0, y: 0, width: 2, height: 1 }).rgba], [255, 0, 0, 255, 0, 0, 255, 128])
    assert.equal(fixtures.state.decodes, 1); assert.equal(fixtures.state.closes, 1)
    assert.ok(fixtures.state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
  } finally { fixtures.restore(); runtime.dispose() }
})

test('preflight agregado rejeita fontes grandes antes de chamar decoder e respeita invalidação', async () => {
  const fixtures = installRustMediaFixtures()
  try {
    const request = input(); request.layers[0]!.input.sourceWidth = 4096; request.layers[0]!.input.sourceHeight = 2048
    await assert.rejects(prepareRustDocumentMedia(request, () => {}), /memory-limit/)
    assert.equal(fixtures.state.decodes, 0)
    await assert.rejects(prepareRustDocumentMedia(input(), () => { throw new Error('obsolete') }), /obsolete/)
  } finally { fixtures.restore() }
})

test('Worker documental real prepara mídia e rejeita mistura com fonte individual', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const prepared = await worker.send({ type: 'prepare-document-media', input: input(), generation: 1 })
    if (prepared.type !== 'document-prepared') throw new Error('documento ausente')
    const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId,
      region: { x: 0, y: 0, width: 2, height: 1 } })
    if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
    assert.deepEqual([...new Uint8Array(tile.rgba)], [40, 60, 80, 255, 0, 0, 0, 0])
    const mixed = await worker.send({ type: 'stage-source', rgba: new Uint8Array(4).buffer, sourceWidth: 1, sourceHeight: 1, generation: 2 })
    assert.equal(mixed.type, 'error')
    assert.equal((await worker.send({ type: 'release-document', documentId: prepared.documentId })).type, 'document-released')
  } finally { await worker.close() }
})

test('Worker não inicia mídia documental num contexto usado pelo protocolo geral', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    await worker.send({ type: 'render', rgba: new Uint8Array(4).buffer, fillOpacity: 100 })
    assert.equal((await worker.send({ type: 'prepare-document-media', input: input(), generation: 1 })).type, 'error')
  } finally { await worker.close() }
})

test('serviço offscreen serializa consumidores, usa tiles e termina cada Worker antes de resolver', async () => {
  let alive = 0, peak = 0, created = 0, prepared = 0
  const service = new RustDocumentOffscreen(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true })
    const client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); created++; alive++; peak = Math.max(peak, alive)
    let terminated = false
    return { get closed() { return client.closed }, send: client.send, cancel: (id: number) => client.cancel(id),
      terminate: async () => { await client.terminate(); if (!terminated) { terminated = true; alive-- } } }
  }, async () => { prepared++; return input() })
  const values: number[][] = []
  try {
    await Promise.all([service.render(plan(), rgba => values.push([...rgba])), service.render(plan(), rgba => values.push([...rgba]))])
    assert.equal(prepared, 2); assert.equal(created, 2); assert.equal(peak, 1); assert.equal(alive, 0)
    assert.deepEqual(values, [[40, 60, 80, 255, 0, 0, 0, 0], [40, 60, 80, 255, 0, 0, 0, 0]])
  } finally { await service.dispose() }
})

test('serviço libera a sessão mesmo quando consumidor falha ao pintar', async () => {
  let alive = 0
  const service = new RustDocumentOffscreen(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); alive++
    return { get closed() { return client.closed }, send: client.send, cancel: () => {}, terminate: async () => { await client.terminate(); alive-- } }
  }, async () => input())
  try {
    await assert.rejects(service.render(plan(), () => { throw new Error('paint-failed') }), /paint-failed/)
    assert.equal(alive, 0)
    await service.render(plan(), () => {}); assert.equal(alive, 0)
  } finally { await service.dispose() }
})

test('deadline interrompe contexto e fila sem abrir Worker tardio ou pintar resposta obsoleta', async () => {
  let open = 0, paint = 0, unblock!: () => void
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  const service = new RustDocumentOffscreen(async () => { open++; throw new Error('late-open') },
    async () => { await blocked; return input() }, 10)
  const first = service.render(plan(), () => { paint++ }), second = service.render(plan(), () => { paint++ })
  await Promise.all([assert.rejects(first, /wasm-unavailable/), assert.rejects(second, /wasm-unavailable/)])
  unblock(); await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(open, 0); assert.equal(paint, 0); await service.dispose()
})

test('carga de mídia reserva saldo codificado e aborta antes de abrir contexto', async () => {
  const request = plan(); request.layers.push(structuredClone(request.layers[0]!))
  const limits: number[] = []
  const result = await loadRustDocumentMedia(request, new AbortController().signal,
    async (_url, _signal, limit) => { limits.push(limit!); return rustMediaBlob() })
  assert.equal(result.layers.length, 2); assert.equal(limits[0], 32 * 1024 * 1024)
  assert.equal(limits[1], limits[0]! - (result.layers[0]!.source.type === 'raster' ? result.layers[0]!.source.blob.size : 0))
  const controller = new AbortController(); controller.abort()
  await assert.rejects(loadRustDocumentMedia(request, controller.signal), /abort/i)
})

test('fila offscreen admite um ativo e três pendentes sem perder snapshots', async () => {
  let unblock!: () => void, firstX = -1
  const blocked = new Promise<void>(resolve => { unblock = resolve })
  const service = new RustDocumentOffscreen(async () => { throw new Error('connect-failed') }, async snapshot => {
    if (firstX < 0) firstX = snapshot.layers[0]!.matrix[4]
    await blocked; return input()
  })
  const request = plan(), first = service.render(request, () => {})
  const checks = [assert.rejects(first, /connect-failed/)]
  request.layers[0]!.matrix = [1, 0, 0, 1, 99, 0]
  for (let i = 0; i < 3; i++) checks.push(assert.rejects(service.render(request, () => {}), /connect-failed/))
  await assert.rejects(service.render(request, () => {}), /memory-limit/)
  unblock(); await Promise.all(checks); assert.equal(firstX, 0); await service.dispose()
})

test('falha de preparação de mídia no Worker preserva o documento preparado anterior', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const prepared = await worker.send({ type: 'prepare-document-media', input: input(), generation: 1 })
    if (prepared.type !== 'document-prepared') throw new Error('documento ausente')
    const bad = input(); bad.layers[0]!.source = { type: 'raster', blob: new Blob(['invalid']) }
    assert.equal((await worker.send({ type: 'prepare-document-media', input: bad, generation: 2 })).type, 'error')
    const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId,
      region: { x: 0, y: 0, width: 2, height: 1 } })
    if (tile.type !== 'rendered-prepared-document') throw new Error('cache perdido')
    assert.deepEqual([...new Uint8Array(tile.rgba)], [40, 60, 80, 255, 0, 0, 0, 0])
  } finally { await worker.close() }
})
