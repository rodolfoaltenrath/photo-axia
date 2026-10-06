import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { RustPixelPocStyleCancelledError } from '../../src/editor/rustPixelPocStyleSession.ts'
import { RustPixelPocStyleService, type RustPixelPocServiceRequest } from '../../src/editor/rustPixelPocStyleService.ts'
import { RustPixelPocWorkerClient, type RustPixelPocConnection } from '../../src/editor/rustPixelPocWorkerClient.ts'
import { DEFAULT_TEXT_LAYER } from '../../src/editor/text.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const input = (): RustPixelPocServiceRequest => ({ sourceIdentity: 'service-v1', sourceWidth: 1, sourceHeight: 1,
  styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 }, source: { type: 'raster', blob: rustMediaBlob() } })
const decoded = async (blob: Blob) => JSON.parse(await blob.text()) as { width: number; height: number; rgba: number[] }
const code = (expected: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected

function fixture(options: Parameters<typeof createRustPixelWorkerHarness>[0] = {}, limits: ConstructorParameters<typeof RustPixelPocStyleService>[1] = {}) {
  const harness = createRustPixelWorkerHarness({ ...options, mediaFixtures: true })
  let connections = 0, client: RustPixelPocWorkerClient | undefined
  const service = new RustPixelPocStyleService(async () => {
    connections++; client = new RustPixelPocWorkerClient(harness.port)
    assert.equal((await client.send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    return client
  }, limits)
  return { harness, service, connections: () => connections, client: () => client,
    close: async () => { await service.dispose(); await harness.close() } }
}

test('Serviço abre Worker sob demanda, reutiliza fonte e mantém leases até liberação explícita', async () => {
  const f = fixture()
  try {
    assert.equal(f.connections(), 0)
    const first = await f.service.render(input()), second = await f.service.render(input())
    assert.equal(f.connections(), 1); assert.equal(first.result.sourceId, second.result.sourceId)
    assert.deepEqual((await decoded(first.result.blob)).rgba, [40, 60, 80, 255])
    assert.equal(f.service.stats.leases, 2); assert.equal(f.service.stats.sourceBytes, 4)
    assert.ok(Object.isFrozen(first.result)); assert.ok(Object.isFrozen(first.result.encoding))
    first.release(); first.release()
    assert.equal(f.service.stats.leases, 1)
    await f.service.dispose()
    assert.equal(f.service.stats.sourceBytes, 0); assert.equal(f.service.stats.retainedResultBytes, second.result.blob.size)
    assert.deepEqual((await decoded(second.result.blob)).rgba, [40, 60, 80, 255])
    second.release(); assert.equal(f.service.stats.reservedBytes, 0)
    await assert.rejects(f.service.render(input()), code('wasm-unavailable'))
  } finally { await f.close() }
})

test('Rajada durante encode mantém só último pendente, não publica antigos e preserva snapshot', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding()
    const first = f.service.render(input()), rejected = assert.rejects(first, RustPixelPocStyleCancelledError)
    await started
    const obsolete: Promise<void>[] = []
    for (let index = 0; index < 15; index++) obsolete.push(assert.rejects(f.service.render(input()), RustPixelPocStyleCancelledError))
    const request = input()
    request.styles = normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#ff0000' }] })
    request.region = { x: 0, y: 0, width: 1, height: 1 }
    const latest = f.service.render(request)
    request.styles.effects.length = 0; request.region.x = 50
    assert.equal(f.service.stats.active, 1); assert.equal(f.service.stats.pending, 1)
    f.harness.releaseEncoding()
    const lease = await latest
    await Promise.all([rejected, ...obsolete])
    assert.deepEqual((await decoded(lease.result.blob)).rgba, [255, 0, 0, 255])
    assert.equal(f.service.stats.leases, 1); assert.equal(f.connections(), 1)
    lease.release()
  } finally { await f.close() }
})

test('Novo pedido inválido também torna o resultado antigo obsoleto', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding(), old = f.service.render(input())
    const cancelled = assert.rejects(old, RustPixelPocStyleCancelledError)
    await started
    await assert.rejects(f.service.render({ ...input(), sourceWidth: 0 }), code('invalid-input'))
    f.harness.releaseEncoding(); await cancelled
    const lease = await f.service.render(input())
    assert.equal(f.service.stats.leases, 1); lease.release()
  } finally { await f.close() }
})

test('Limite de leases rejeita saída, sem perder fonte, e permite repetição após liberar', async () => {
  const f = fixture({}, { maxLeases: 1 })
  try {
    const first = await f.service.render(input())
    await assert.rejects(f.service.render(input()), code('memory-limit'))
    assert.equal(f.service.stats.leases, 1)
    first.release()
    const next = await f.service.render(input())
    assert.equal(next.result.sourceId, first.result.sourceId); next.release()
  } finally { await f.close() }
})

test('Serviço recebe padrão atual e região sem cache de resultado, mantendo fonte original', async () => {
  const f = fixture()
  const pattern = { id: 'asset', name: 'fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }
  const request = { ...input(), styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [{ type: 'pattern-overlay', pattern }] }),
    patterns: { asset: rustMediaBlob({ rgba: [255, 0, 0, 255] }) }, region: { x: 0, y: 0, width: 1, height: 1 } }
  try {
    const redPending = f.service.render(request)
    request.patterns.asset = rustMediaBlob({ rgba: [0, 255, 0, 255] })
    const red = await redPending, green = await f.service.render(request)
    assert.deepEqual((await decoded(red.result.blob)).rgba, [255, 0, 0, 255])
    assert.deepEqual((await decoded(green.result.blob)).rgba, [0, 255, 0, 255])
    assert.equal(red.result.sourceId, green.result.sourceId)
    red.release(); green.release()
  } finally { await f.close() }
})

test('Serviço captura texto editorial antes de abrir Worker', async () => {
  const f = fixture()
  try {
    const request = { ...input(), source: { type: 'text' as const, text: { ...DEFAULT_TEXT_LAYER, content: 'Axia' }, drawScaleX: 1, drawScaleY: 1 } }
    const pending = f.service.render(request)
    request.source.text.fontSize = 0; request.source.text.content = 'changed'
    const lease = await pending
    assert.deepEqual((await decoded(lease.result.blob)).rgba, [0, 0, 0, 255]); lease.release()
  } finally { await f.close() }
})

test('Limite acumulado de PNG não publica resultado e não altera contabilidade', async () => {
  const f = fixture({}, { maxResultBytes: 1 })
  try {
    await assert.rejects(f.service.render(input()), code('memory-limit'))
    assert.equal(f.service.stats.leases, 0); assert.equal(f.service.stats.retainedResultBytes, 0)
    assert.equal(f.service.stats.sourceBytes, 4)
  } finally { await f.close() }
})

test('Preflight de entrada/região/metadados e orçamento ocorre antes de abrir Worker', async () => {
  let calls = 0
  const service = new RustPixelPocStyleService(async () => { calls++; throw new Error('unexpected') }, { maxResidentBytes: 96 * 1024 * 1024 })
  try {
    await assert.rejects(service.render({ ...input(), source: { type: 'raster', blob: new Blob([]) } }), code('invalid-input'))
    await assert.rejects(service.render({ ...input(), region: { x: 1, y: 0, width: 1, height: 1 } }), code('invalid-input'))
    await assert.rejects(service.render({ ...input(), sourceIdentity: 'x'.repeat(4097) }), code('invalid-input'))
    const text = { ...DEFAULT_TEXT_LAYER, color: 'x'.repeat(3 * 1024 * 1024) }
    await assert.rejects(service.render({ ...input(), source: { type: 'text', text, drawScaleX: 1, drawScaleY: 1 } }), code('memory-limit'))
    await assert.rejects(service.render(input()), code('memory-limit'))
    assert.equal(calls, 0); assert.equal(service.stats.reservedBytes, 0)
  } finally { await service.dispose() }
})

test('Orçamento inclui entrada ativa e pendente; substituição não acumula pendentes', async () => {
  const f = fixture({ holdEncoding: true }, { maxResidentBytes: 96 * 1024 * 1024 + 6000 })
  try {
    const started = f.harness.waitForEncoding(), first = f.service.render(input())
    const cancelled = assert.rejects(first, RustPixelPocStyleCancelledError)
    await started
    const before = f.service.stats.reservedBytes
    const pending = f.service.render(input()), superseded = assert.rejects(pending, RustPixelPocStyleCancelledError)
    assert.ok(f.service.stats.reservedBytes > before)
    const large = input(); large.source = { type: 'raster', blob: new Blob(['x'.repeat(6000)]) }
    await assert.rejects(f.service.render(large), code('memory-limit'))
    assert.equal(f.service.stats.pending, 0)
    f.harness.releaseEncoding(); await Promise.all([cancelled, superseded])
    const retry = await f.service.render(input()); retry.release()
  } finally { await f.close() }
})

test('Lease retida participa da admissão, e release permite pedido que não cabia', async () => {
  const f = fixture({}, { maxResidentBytes: 96 * 1024 * 1024 + 6000 })
  try {
    const fixtureText = await rustMediaBlob().text()
    const first = await f.service.render(input())
    const base = input(), second = input()
    base.source = { type: 'raster', blob: new Blob([fixtureText, ' '.repeat(2000 - fixtureText.length)]) }
    const probe = f.service.render(base)
    const snapshot = f.service.stats
    const metadata = snapshot.reservedBytes - 96 * 1024 * 1024 - 2000 - first.result.blob.size
    const size = 6000 - metadata
    const probeRejected = assert.rejects(probe, RustPixelPocStyleCancelledError)
    f.service.cancel(); await probeRejected
    await new Promise(resolve => setImmediate(resolve))
    second.source = { type: 'raster', blob: new Blob([fixtureText, ' '.repeat(size - fixtureText.length)]) }
    await assert.rejects(f.service.render(second), code('memory-limit'))
    first.release()
    const admitted = await f.service.render(second)
    assert.equal(admitted.result.sourceId, first.result.sourceId); admitted.release()
  } finally { await f.close() }
})

test('Invalidate cancela encode, libera fonte staged e adota outra fonte', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding(), first = f.service.render(input())
    const cancelled = assert.rejects(first, RustPixelPocStyleCancelledError)
    await started; await f.service.invalidate()
    assert.equal(f.service.stats.sourceBytes, 0)
    f.harness.releaseEncoding(); await cancelled
    const next = await f.service.render({ ...input(), sourceIdentity: 'replacement', source: { type: 'raster', blob: rustMediaBlob({ rgba: [1, 2, 3, 255] }) } })
    assert.deepEqual((await decoded(next.result.blob)).rgba, [1, 2, 3, 255]); next.release()
  } finally { await f.close() }
})

test('Dispose durante encode é idempotente e termina Worker sem aguardar encoder', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding(), first = f.service.render(input())
    const cancelled = assert.rejects(first, RustPixelPocStyleCancelledError)
    await started
    const disposal = f.service.dispose()
    assert.equal(f.service.dispose(), disposal)
    await disposal; await cancelled
    assert.equal(f.client()?.closed, true); assert.equal(f.service.stats.leases, 0)
  } finally { await f.close() }
})

test('Falha ao abrir não paralisa serviço; próxima solicitação cria Worker novo', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true })
  let attempts = 0
  const service = new RustPixelPocStyleService(async () => {
    if (++attempts === 1) throw new RustPixelPocError('wasm-unavailable')
    const client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); return client
  })
  try {
    await assert.rejects(service.render(input()), code('wasm-unavailable'))
    const lease = await service.render(input()); lease.release(); assert.equal(attempts, 2)
  } finally { await service.dispose(); await harness.close() }
})

test('Worker encerrado é recriado com upload novo, sem invalidar lease já publicado', async () => {
  const workers: ReturnType<typeof createRustPixelWorkerHarness>[] = []
  let connection: RustPixelPocWorkerClient | undefined
  const service = new RustPixelPocStyleService(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true }); workers.push(harness)
    connection = new RustPixelPocWorkerClient(harness.port)
    await connection.send({ type: 'init', wasm: wasm.slice(0) }); return connection
  })
  try {
    const first = await service.render(input())
    await connection!.terminate()
    const next = await service.render(input())
    assert.equal(workers.length, 2)
    assert.deepEqual((await decoded(first.result.blob)).rgba, [40, 60, 80, 255])
    assert.deepEqual((await decoded(next.result.blob)).rgba, [40, 60, 80, 255])
    first.release(); next.release()
  } finally { await service.dispose(); await Promise.all(workers.map(worker => worker.close())) }
})

test('Timeout de encode termina Worker e próxima solicitação pode recuperar em outro Worker', async () => {
  const workers: ReturnType<typeof createRustPixelWorkerHarness>[] = []
  const service = new RustPixelPocStyleService(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: workers.length === 0 }); workers.push(harness)
    const client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); return client
  }, { taskTimeoutMs: 3000 })
  try {
    await assert.rejects(service.render(input()), code('wasm-unavailable'))
    const next = await service.render(input()); assert.equal(workers.length, 2); next.release()
  } finally { await service.dispose(); await Promise.all(workers.map(worker => worker.close())) }
})

function unopenedConnection(onTerminate: () => void): RustPixelPocConnection {
  return { closed: false, send: () => { throw new Error('must not send') }, cancel() {}, terminate: async () => onTerminate() }
}

test('Watchdog aborta abertura travada; conexão tardia não é adotada', async () => {
  let finish: ((connection: RustPixelPocConnection) => void) | undefined, signal: AbortSignal | undefined, terminated = 0
  const service = new RustPixelPocStyleService(abort => { signal = abort; return new Promise(resolve => { finish = resolve }) }, { taskTimeoutMs: 25 })
  try {
    await assert.rejects(service.render(input()), code('wasm-unavailable'))
    assert.equal(signal?.aborted, true)
    finish!(unopenedConnection(() => terminated++))
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(terminated, 1); assert.equal(service.stats.sourceBytes, 0)
  } finally { await service.dispose() }
})

test('Fechamento durante abertura aborta e descarta conexão que resolve depois', async () => {
  let finish: ((connection: RustPixelPocConnection) => void) | undefined, signal: AbortSignal | undefined, terminated = 0
  const service = new RustPixelPocStyleService(abort => { signal = abort; return new Promise(resolve => { finish = resolve }) })
  const pending = service.render(input()), cancelled = assert.rejects(pending, RustPixelPocStyleCancelledError)
  await new Promise(resolve => setImmediate(resolve))
  await service.dispose(); assert.equal(signal?.aborted, true)
  finish!(unopenedConnection(() => terminated++))
  await cancelled; await new Promise(resolve => setImmediate(resolve))
  assert.equal(terminated, 1); assert.equal(service.stats.reservedBytes, 0)
})

test('Dispose não espera factory que ignora abort e nunca resolve', async () => {
  const service = new RustPixelPocStyleService(() => new Promise(() => {}))
  const pending = service.render(input()), cancelled = assert.rejects(pending, RustPixelPocStyleCancelledError)
  await new Promise(resolve => setImmediate(resolve))
  await service.dispose(); await cancelled
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(service.stats.reservedBytes, 0)
})
