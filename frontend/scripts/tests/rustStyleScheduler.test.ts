import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { snapshotRustPixelPocStyleRequest } from '../../src/editor/rustPixelPocStyleInput.ts'
import { RustPixelPocStyleScheduler, type RustPixelPocSchedulerLimits } from '../../src/editor/rustPixelPocStyleScheduler.ts'
import { RustPixelPocStyleCancelledError } from '../../src/editor/rustPixelPocStyleSession.ts'
import type { RustPixelPocServiceRequest } from '../../src/editor/rustPixelPocStyleService.ts'
import { RustPixelPocWorkerClient } from '../../src/editor/rustPixelPocWorkerClient.ts'
import { DEFAULT_TEXT_LAYER } from '../../src/editor/text.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const workingBytes = 96 * 1024 * 1024
const input = (rgba = [40, 60, 80, 255]): RustPixelPocServiceRequest => ({ sourceIdentity: 'same-identity', sourceWidth: 1, sourceHeight: 1,
  styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 }, source: { type: 'raster', blob: rustMediaBlob({ rgba }) } })
const decoded = async (blob: Blob) => JSON.parse(await blob.text()) as { width: number; height: number; rgba: number[] }
const code = (expected: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function fixture(options: Parameters<typeof createRustPixelWorkerHarness>[0] = {}, limits: RustPixelPocSchedulerLimits = {}) {
  const harness = createRustPixelWorkerHarness({ ...options, mediaFixtures: true })
  let connections = 0
  const scheduler = new RustPixelPocStyleScheduler(async () => {
    connections++
    const client = new RustPixelPocWorkerClient(harness.port)
    assert.equal((await client.send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    return client
  }, limits)
  return { harness, scheduler, connections: () => connections,
    close: async () => { await scheduler.dispose(); await harness.close() } }
}

test('Agendador valida limites e pedidos antes de abrir Worker', async () => {
  let connections = 0
  const connect = async () => { connections++; throw new Error('must not connect') }
  for (const limits of [{ maxPendingConsumers: 0 }, { maxPendingConsumers: 65 }, { maxPendingConsumers: NaN },
    { maxResidentBytes: workingBytes - 1 }, { maxLeases: 65 }, { taskTimeoutMs: 60_001 }]) {
    assert.throws(() => new RustPixelPocStyleScheduler(connect, limits), code('invalid-input'))
  }
  const scheduler = new RustPixelPocStyleScheduler(connect)
  try {
    assert.equal(connections, 0)
    await assert.rejects(scheduler.render('', input()), code('invalid-input'))
    await assert.rejects(scheduler.render('x'.repeat(513), input()), code('invalid-input'))
    await assert.rejects(scheduler.render('A', { ...input(), sourceWidth: 0 }), code('invalid-input'))
    await assert.rejects(scheduler.render('A', { ...input(), sourceWidth: 100_000, sourceHeight: 100_000 }), code('memory-limit'))
    assert.equal(connections, 0); assert.equal(scheduler.stats.reservedBytes, 0)
  } finally { await scheduler.dispose() }
})

test('Três camadas compartilham um Worker em FIFO, sem cancelamento cruzado ou alias de fonte', async () => {
  const f = fixture({ holdEncoding: true }), order: string[] = []
  try {
    const started = f.harness.waitForEncoding()
    const first = f.scheduler.render('A', input()).then(lease => { order.push('A'); return lease })
    await started
    const second = f.scheduler.render('B', input([1, 2, 3, 255])).then(lease => { order.push('B'); return lease })
    const third = f.scheduler.render('C', input([4, 5, 6, 255])).then(lease => { order.push('C'); return lease })
    assert.equal(f.scheduler.stats.active, 1); assert.equal(f.scheduler.stats.pending, 2)
    f.harness.releaseEncoding()
    const leases = await Promise.all([first, second, third])
    assert.deepEqual(order, ['A', 'B', 'C']); assert.equal(f.connections(), 1)
    assert.deepEqual((await decoded(leases[1]!.result.blob)).rgba, [1, 2, 3, 255])
    assert.deepEqual((await decoded(leases[2]!.result.blob)).rgba, [4, 5, 6, 255])
    assert.equal(new Set(leases.map(lease => lease.result.sourceId)).size, 3)
    assert.equal(f.scheduler.stats.leases, 3)
    for (const lease of leases) lease.release()
    await tick(); assert.equal(f.scheduler.stats.pending, 0); assert.equal(f.scheduler.stats.active, 0)
  } finally { await f.close() }
})

test('Rajada substitui apenas o pendente da própria camada e conserva sua posição FIFO', async () => {
  const f = fixture({ holdEncoding: true }), order: string[] = []
  try {
    const started = f.harness.waitForEncoding(), first = f.scheduler.render('A', input())
    await started
    const cancelled: Promise<void>[] = [assert.rejects(f.scheduler.render('B', input()), RustPixelPocStyleCancelledError)]
    const third = f.scheduler.render('C', input()).then(lease => { order.push('C'); return lease })
    const bytes = f.scheduler.stats.queuedInputBytes
    for (let index = 0; index < 12; index++) {
      cancelled.push(assert.rejects(f.scheduler.render('B', input()), RustPixelPocStyleCancelledError))
      assert.equal(f.scheduler.stats.pending, 2); assert.equal(f.scheduler.stats.queuedInputBytes, bytes)
    }
    const request = input()
    request.styles = normalizeLayerStyleConfig({ effects: [{ type: 'color-overlay', color: '#ff0000' }] })
    const latest = f.scheduler.render('B', request).then(lease => { order.push('B'); return lease })
    request.styles.effects.length = 0
    f.harness.releaseEncoding()
    const [a, b, c] = await Promise.all([first, latest, third]); await Promise.all(cancelled)
    assert.deepEqual(order, ['B', 'C']); assert.deepEqual((await decoded(b.result.blob)).rgba, [255, 0, 0, 255])
    assert.equal(f.connections(), 1); a.release(); b.release(); c.release()
  } finally { await f.close() }
})

test('Cancelar ativo rejeita cedo, mas outra camada só inicia após drenar o encoder antigo', async () => {
  const f = fixture({ holdEncoding: true }), order: string[] = []
  let staged = 0
  const unsubscribe = f.harness.port.onMessage(message => { if ((message as { type?: string }).type === 'source-staged') staged++ })
  try {
    const started = f.harness.waitForEncoding(), old = f.scheduler.render('A', input())
    const cancelled = assert.rejects(old, RustPixelPocStyleCancelledError)
    await started
    const second = f.scheduler.render('B', input()).then(lease => { order.push('B'); return lease })
    const third = f.scheduler.render('C', input()).then(lease => { order.push('C'); return lease })
    const latest = f.scheduler.render('A', input([1, 2, 3, 255])).then(lease => { order.push('A'); return lease })
    await cancelled; await tick()
    assert.equal(staged, 1); assert.equal(f.scheduler.stats.active, 1); assert.equal(f.scheduler.stats.pending, 3)
    f.harness.releaseEncoding()
    const leases = await Promise.all([second, third, latest])
    assert.deepEqual(order, ['B', 'C', 'A']); assert.equal(f.scheduler.stats.leases, 3)
    assert.deepEqual((await decoded(leases[2]!.result.blob)).rgba, [1, 2, 3, 255])
    for (const lease of leases) lease.release()
  } finally { unsubscribe(); await f.close() }
})

test('Cancelar pendente ou consumidor desconhecido não invalida outras camadas', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding(), a = f.scheduler.render('A', input())
    await started
    const b = assert.rejects(f.scheduler.render('B', input()), RustPixelPocStyleCancelledError)
    const c = f.scheduler.render('C', input())
    f.scheduler.cancel('B'); f.scheduler.cancel('unknown'); await b
    assert.equal(f.scheduler.stats.pending, 1)
    f.harness.releaseEncoding()
    const leases = await Promise.all([a, c]); assert.equal(f.scheduler.stats.leases, 2)
    for (const lease of leases) lease.release()
  } finally { await f.close() }
})

test('Pedido novo inválido elimina somente o antigo da mesma camada', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding(), a = f.scheduler.render('A', input())
    const aCancelled = assert.rejects(a, RustPixelPocStyleCancelledError)
    await started
    const bCancelled = assert.rejects(f.scheduler.render('B', input()), RustPixelPocStyleCancelledError)
    const c = f.scheduler.render('C', input())
    await assert.rejects(f.scheduler.render('B', { ...input(), sourceWidth: 0 }), code('invalid-input'))
    await bCancelled
    await assert.rejects(f.scheduler.render('A', { ...input(), sourceWidth: 0 }), code('invalid-input'))
    await aCancelled; assert.equal(f.scheduler.stats.pending, 1)
    f.harness.releaseEncoding(); const lease = await c
    assert.equal(f.scheduler.stats.leases, 1); lease.release()
  } finally { await f.close() }
})

test('Fila limitada rejeita novo consumidor sem retirar o ativo ou impedir substituição', async () => {
  const f = fixture({ holdEncoding: true }, { maxPendingConsumers: 1 })
  try {
    const started = f.harness.waitForEncoding(), a = f.scheduler.render('A', input())
    await started
    const cancelled = assert.rejects(f.scheduler.render('B', input()), RustPixelPocStyleCancelledError)
    await assert.rejects(f.scheduler.render('C', input()), code('memory-limit'))
    const b = f.scheduler.render('B', input())
    await cancelled; assert.equal(f.scheduler.stats.pending, 1)
    f.harness.releaseEncoding()
    const leases = await Promise.all([a, b]); assert.equal(f.scheduler.stats.leases, 2)
    for (const lease of leases) lease.release()
  } finally { await f.close() }
})

test('Orçamento agrega ativo e entradas de todas as camadas; rejeição não cancela vizinhos', async () => {
  const request = input(), fixtureText = await rustMediaBlob().text()
  request.source = { type: 'raster', blob: new Blob([fixtureText, ' '.repeat(2000 - fixtureText.length)]) }
  const charge = snapshotRustPixelPocStyleRequest(request).inputBytes + 2
  const f = fixture({ holdEncoding: true }, { maxResidentBytes: workingBytes + charge * 2 })
  try {
    const started = f.harness.waitForEncoding(), a = f.scheduler.render('A', request)
    await started
    const bCancelled = assert.rejects(f.scheduler.render('B', request), RustPixelPocStyleCancelledError)
    assert.equal(f.scheduler.stats.reservedBytes, workingBytes + charge * 2)
    assert.equal(f.scheduler.stats.queuedInputBytes, charge)
    await assert.rejects(f.scheduler.render('C', request), code('memory-limit'))
    const large = { ...request, source: { type: 'raster' as const, blob: new Blob(['x'.repeat(charge * 2)]) } }
    await assert.rejects(f.scheduler.render('B', large), code('memory-limit')); await bCancelled
    assert.equal(f.scheduler.stats.pending, 0); assert.equal(f.scheduler.stats.reservedBytes, workingBytes + charge)
    f.harness.releaseEncoding(); const lease = await a; lease.release()
  } finally { await f.close() }
})

test('Limite de leases é compartilhado e release permite outra camada sem novo Worker', async () => {
  const f = fixture({}, { maxLeases: 1 })
  try {
    const a = f.scheduler.render('A', input()), b = assert.rejects(f.scheduler.render('B', input()), code('memory-limit'))
    const first = await a; await b
    assert.equal(f.scheduler.stats.leases, 1); first.release(); first.release()
    const next = await f.scheduler.render('C', input())
    assert.equal(f.connections(), 1); next.release(); assert.equal(f.scheduler.stats.retainedResultBytes, 0)
  } finally { await f.close() }
})

test('Limite de PNG acumulado é comum a todas as camadas e não perde leases anteriores', async () => {
  const probe = fixture()
  let bytes: number
  try { const lease = await probe.scheduler.render('A', input()); bytes = lease.result.blob.size; lease.release() }
  finally { await probe.close() }
  const f = fixture({}, { maxResultBytes: bytes * 2 - 1 })
  try {
    const first = await f.scheduler.render('A', input())
    await assert.rejects(f.scheduler.render('B', input()), code('memory-limit'))
    assert.equal(f.scheduler.stats.retainedResultBytes, bytes)
    assert.deepEqual((await decoded(first.result.blob)).rgba, [40, 60, 80, 255])
    first.release(); const next = await f.scheduler.render('B', input()); next.release()
  } finally { await f.close() }
})

test('PNG retido entra na admissão agregada e é liberável depois de dispose', async () => {
  const probe = fixture()
  let bytes: number
  try { const lease = await probe.scheduler.render('A', input()); bytes = lease.result.blob.size; lease.release() }
  finally { await probe.close() }
  const charge = snapshotRustPixelPocStyleRequest(input()).inputBytes + 2
  const f = fixture({}, { maxResidentBytes: workingBytes + charge + bytes - 1 })
  try {
    const first = await f.scheduler.render('A', input()); await tick()
    await assert.rejects(f.scheduler.render('B', input()), code('memory-limit'))
    first.release(); const next = await f.scheduler.render('B', input())
    await f.scheduler.dispose()
    assert.equal(f.scheduler.stats.retainedResultBytes, bytes); assert.equal(f.scheduler.stats.reservedBytes, bytes)
    next.release(); next.release(); assert.equal(f.scheduler.stats.reservedBytes, 0)
  } finally { await f.close() }
})

test('Reuso é local à fonte consecutiva da mesma camada, sem colisão de identidades entre camadas', async () => {
  const f = fixture()
  try {
    const a = await f.scheduler.render('A', input()), same = await f.scheduler.render('A', input())
    assert.equal(a.result.sourceId, same.result.sourceId)
    const b = await f.scheduler.render('B', input([255, 0, 0, 255])), back = await f.scheduler.render('A', input())
    assert.notEqual(b.result.sourceId, same.result.sourceId); assert.notEqual(back.result.sourceId, a.result.sourceId)
    assert.deepEqual((await decoded(b.result.blob)).rgba, [255, 0, 0, 255])
    assert.deepEqual((await decoded(back.result.blob)).rgba, [40, 60, 80, 255])
    for (const lease of [a, same, b, back]) lease.release()
  } finally { await f.close() }
})

test('Snapshots pendentes preservam texto, região e mapa de padrões antes do staging', async () => {
  const f = fixture({ holdEncoding: true })
  const pattern = { id: 'asset', name: 'fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }
  const request = { ...input(), styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [{ type: 'pattern-overlay', pattern }] }),
    patterns: { asset: rustMediaBlob({ rgba: [255, 0, 0, 255] }) }, region: { x: 0, y: 0, width: 1, height: 1 } }
  const text = { ...input(), source: { type: 'text' as const, text: { ...DEFAULT_TEXT_LAYER, content: 'Axia' }, drawScaleX: 1, drawScaleY: 1 } }
  try {
    const started = f.harness.waitForEncoding(), a = f.scheduler.render('A', input())
    await started
    const b = f.scheduler.render('B', request), c = f.scheduler.render('C', text)
    request.styles.effects.length = 0; request.region.x = 20; request.patterns.asset = rustMediaBlob({ rgba: [0, 255, 0, 255] })
    text.source.text.fontSize = 0; text.source.text.content = 'changed'
    f.harness.releaseEncoding()
    const leases = await Promise.all([a, b, c])
    assert.deepEqual((await decoded(leases[1]!.result.blob)).rgba, [255, 0, 0, 255])
    assert.deepEqual((await decoded(leases[2]!.result.blob)).rgba, [0, 0, 0, 255])
    for (const lease of leases) lease.release()
  } finally { await f.close() }
})

test('Dispose cancela ativo e fila, é terminal/idempotente e não espera encoder travado', async () => {
  const f = fixture({ holdEncoding: true })
  try {
    const started = f.harness.waitForEncoding(), a = assert.rejects(f.scheduler.render('A', input()), RustPixelPocStyleCancelledError)
    await started
    const b = assert.rejects(f.scheduler.render('B', input()), RustPixelPocStyleCancelledError)
    const disposed = f.scheduler.dispose(); assert.equal(f.scheduler.dispose(), disposed)
    await disposed; await Promise.all([a, b])
    assert.equal(f.scheduler.stats.active, 0); assert.equal(f.scheduler.stats.pending, 0)
    assert.equal(f.scheduler.stats.reservedBytes, 0)
    await assert.rejects(f.scheduler.render('C', input()), code('wasm-unavailable'))
  } finally { await f.close() }
})

test('Dispose aborta abertura que nunca resolve e rejeita toda a fila', async () => {
  let signal: AbortSignal | undefined
  const scheduler = new RustPixelPocStyleScheduler(abort => { signal = abort; return new Promise(() => {}) })
  const a = assert.rejects(scheduler.render('A', input()), RustPixelPocStyleCancelledError)
  const b = assert.rejects(scheduler.render('B', input()), RustPixelPocStyleCancelledError)
  await tick(); await scheduler.dispose(); await Promise.all([a, b]); await tick()
  assert.equal(signal?.aborted, true); assert.equal(scheduler.stats.reservedBytes, 0)
})

test('Falha de abertura não cancela camadas aguardando; próximo consumidor pode recuperar', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true })
  let connections = 0
  const scheduler = new RustPixelPocStyleScheduler(async () => {
    if (++connections === 1) throw new RustPixelPocError('wasm-unavailable')
    const client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); return client
  })
  try {
    const failed = assert.rejects(scheduler.render('A', input()), code('wasm-unavailable'))
    const b = scheduler.render('B', input()), c = scheduler.render('C', input())
    const leases = await Promise.all([b, c]); await failed
    assert.equal(connections, 2); assert.equal(scheduler.stats.leases, 2)
    for (const lease of leases) lease.release()
  } finally { await scheduler.dispose(); await harness.close() }
})

test('Reconexão espera confirmação de término físico anterior e conserva PNGs publicados', async () => {
  const workers: ReturnType<typeof createRustPixelWorkerHarness>[] = []
  let client: RustPixelPocWorkerClient | undefined, finishTermination = () => {}
  const terminated = new Promise<void>(resolve => { finishTermination = resolve })
  const scheduler = new RustPixelPocStyleScheduler(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true }); workers.push(harness)
    const port = workers.length === 1 ? { ...harness.port, terminate: async () => { await harness.port.terminate(); await terminated } } : harness.port
    client = new RustPixelPocWorkerClient(port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); return client
  })
  try {
    const first = await scheduler.render('A', input())
    const closing = client!.terminate(), next = scheduler.render('B', input([1, 2, 3, 255]))
    await tick(); await tick(); assert.equal(workers.length, 1)
    finishTermination(); await closing
    const second = await next; assert.equal(workers.length, 2)
    assert.deepEqual((await decoded(first.result.blob)).rgba, [40, 60, 80, 255])
    assert.deepEqual((await decoded(second.result.blob)).rgba, [1, 2, 3, 255])
    first.release(); second.release()
  } finally { finishTermination(); await scheduler.dispose(); await Promise.all(workers.map(worker => worker.close())) }
})

test('Watchdog retira encoder travado e continua a fila em novo Worker', async () => {
  const workers: ReturnType<typeof createRustPixelWorkerHarness>[] = []
  const scheduler = new RustPixelPocStyleScheduler(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true, holdEncoding: workers.length === 0 }); workers.push(harness)
    const client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); return client
  }, { taskTimeoutMs: 3000 })
  try {
    const failed = assert.rejects(scheduler.render('A', input()), code('wasm-unavailable'))
    const b = scheduler.render('B', input())
    await failed; const lease = await b; assert.equal(workers.length, 2); lease.release()
  } finally { await scheduler.dispose(); await Promise.all(workers.map(worker => worker.close())) }
})
