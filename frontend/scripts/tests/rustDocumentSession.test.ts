import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustDocumentOffscreen, loadRustDocumentMedia } from '../../src/editor/rustDocumentOffscreen.ts'
import { RustPixelPocWorkerClient } from '../../src/editor/rustPixelPocWorkerClient.ts'
import type { RustEditorialPlan } from '../../src/editor/rustDocumentEditorial.ts'
import type { RustPixelPocResponse } from '../../src/editor/rustPixelPocProtocol.ts'
import type { RustPixelPocSend } from '../../src/editor/rustPixelPocStyleSession.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
function plan(): RustEditorialPlan {
  return { documentWidth: 2, documentHeight: 1, width: 2, height: 1,
    grid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layers: [{
      source: { type: 'raster', url: 'blob:fixture' },
      input: { sourceIdentity: 'fixture', sourceWidth: 1, sourceHeight: 1,
        styles: normalizeLayerStyleConfig({}), globalLight: { angle: 120, altitude: 30 } },
      matrix: [1, 0, 0, 1, 0, 0], opacity: 100, blendMode: 'normal' }] }
}
function fixture(options: { idleMs?: number; timeoutMs?: number; retire?: () => Promise<void>; failRetire?: boolean;
  response?: (value: RustPixelPocResponse) => RustPixelPocResponse | Promise<RustPixelPocResponse> } = {}) {
  const state = { alive: 0, peak: 0, loads: 0, failLoad: false, releases: 0, generations: [] as number[] }
  const clients: RustPixelPocWorkerClient[] = []
  const service = new RustDocumentOffscreen(async () => {
    const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
    state.alive++; state.peak = Math.max(state.peak, state.alive)
    const client = new RustPixelPocWorkerClient({ ...worker.port, terminate: async () => {
      await options.retire?.(); await worker.port.terminate(); state.alive--
    } })
    try { await client.send({ type: 'init', wasm: wasm.slice(0) }) }
    catch (error) { await client.terminate(); throw error }
    clients.push(client)
    const send: RustPixelPocSend = (request, transfer) => {
      if (request.type === 'prepare-document-media') state.generations.push(request.generation)
      if (request.type === 'release-document') state.releases++
      const result = client.send(request, transfer)
      return Object.assign(result.then(value => options.response?.(value) ?? value), { id: result.id })
    }
    return { get closed() { return client.closed }, send, cancel: (id: number) => client.cancel(id), terminate: async () => {
      await client.terminate()
      if (options.failRetire) throw new Error('termination-failed')
    } }
  }, async (snapshot, signal) => {
    state.loads++
    if (state.failLoad) throw new Error('load-failed')
    return loadRustDocumentMedia(snapshot, signal, async () => rustMediaBlob())
  }, options.timeoutMs ?? 30_000, options.idleMs ?? 5_000)
  return { service, state, clients }
}
function deferred() {
  let resolve!: () => void
  return { promise: new Promise<void>(done => { resolve = done }), resolve: () => resolve() }
}
async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 3000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'condição da sessão não foi atendida')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

test('sessão real reutiliza pixels em novas regiões sem buscar/decode/preparar novamente', async () => {
  const { service, state } = fixture(), values: number[][] = []
  try {
    await service.render(plan(), rgba => values.push([...rgba]))
    const sample = plan(); sample.width = 1; sample.grid.originX = 1
    await service.render(sample, rgba => values.push([...rgba]))
    sample.grid.originX = 0
    await service.render(sample, rgba => values.push([...rgba]))
    assert.deepEqual(values, [[40, 60, 80, 255, 0, 0, 0, 0], [0, 0, 0, 0], [40, 60, 80, 255]])
    assert.equal(state.loads, 1); assert.deepEqual(state.generations, [1]); assert.equal(service.stats.reuses, 2)
    assert.ok(service.stats.preparedBytes > 0); assert.equal(state.peak, 1)
  } finally { await service.dispose(); assert.equal(state.alive, 0) }
})

test('mudanças editoriais liberam preparação anterior e incrementam geração, sem recriar Worker', async () => {
  const { service, state } = fixture(), request = plan(), values: number[][] = []
  try {
    await service.render(request, rgba => values.push([...rgba]))
    request.layers[0]!.matrix = [1, 0, 0, 1, 1, 0]
    await service.render(request, rgba => values.push([...rgba]))
    request.layers[0]!.input.styles.fillOpacity = 50
    await service.render(request, rgba => values.push([...rgba]))
    request.layers[0]!.opacity = 50
    await service.render(request, rgba => values.push([...rgba]))
    assert.deepEqual(values.map(value => value.filter((_, index) => index % 4 === 3)), [[255, 0], [0, 255], [0, 128], [0, 64]])
    assert.deepEqual(state.generations, [1, 2, 3, 4]); assert.equal(state.releases, 3)
    assert.equal(service.stats.connections, 1); assert.equal(state.loads, 4); assert.equal(service.stats.reuses, 0)
  } finally { await service.dispose() }
})

test('fonte externa é recarregada e liberada a cada chamada, mas compartilha o Worker', async () => {
  const { service, state } = fixture(), request = plan()
  request.layers[0]!.source = { type: 'raster', url: 'https://example.test/mutable.png' }
  try {
    await service.render(request, () => {}); await service.render(request, () => {})
    assert.equal(state.loads, 2); assert.equal(state.releases, 2)
    assert.equal(service.stats.connections, 1); assert.equal(service.stats.preparedBytes, 0); assert.equal(service.stats.reuses, 0)
  } finally { await service.dispose() }
})

test('falha de carga invalida o residente e próxima chamada abre contexto limpo', async () => {
  const { service, state } = fixture(), request = plan()
  try {
    await service.render(request, () => {})
    state.failLoad = true; request.layers[0]!.input.sourceIdentity = 'changed'
    await assert.rejects(service.render(request, () => {}), /load-failed/)
    assert.equal(service.stats.preparedBytes, 0); assert.equal(state.alive, 0)
    state.failLoad = false
    await service.render(plan(), () => {})
    assert.deepEqual(state.generations, [1, 1]); assert.equal(service.stats.connections, 2); assert.equal(state.peak, 1)
  } finally { await service.dispose() }
})

test('pedidos concorrentes conservam snapshots e ordem sem cache cruzado entre revisões', async () => {
  const { service, state } = fixture(), request = plan(), values: number[][] = []
  try {
    const first = service.render(request, rgba => values.push([...rgba]))
    request.layers[0]!.matrix = [1, 0, 0, 1, 1, 0]
    const second = service.render(request, rgba => values.push([...rgba]))
    request.layers[0]!.opacity = 50
    const third = service.render(request, rgba => values.push([...rgba]))
    request.layers[0]!.opacity = 0
    await Promise.all([first, second, third])
    assert.deepEqual(values, [[40, 60, 80, 255, 0, 0, 0, 0], [0, 0, 0, 0, 40, 60, 80, 255], [0, 0, 0, 0, 40, 60, 80, 128]])
    assert.deepEqual(state.generations, [1, 2, 3]); assert.equal(service.stats.connections, 1)
  } finally { await service.dispose() }
})

test('Worker fechado entre chamadas não deixa handle residente reutilizável', async () => {
  const { service, state, clients } = fixture()
  try {
    await service.render(plan(), () => {}); await clients[0]!.terminate()
    await service.render(plan(), () => {})
    assert.equal(state.loads, 2); assert.equal(service.stats.connections, 2); assert.equal(service.stats.reuses, 0)
    assert.deepEqual(state.generations, [1, 1]); assert.equal(state.peak, 1)
  } finally { await service.dispose() }
})

test('inatividade drena término antes de admitir outro Worker, inclusive com consumidor chegando durante cleanup', async () => {
  const entered = deferred(), finish = deferred()
  let held = true
  const { service, state } = fixture({ idleMs: 10, retire: async () => {
    if (held) { entered.resolve(); await finish.promise }
  } })
  try {
    await service.render(plan(), () => {}); await entered.promise
    assert.equal(service.stats.preparedBytes, 0)
    const next = service.render(plan(), () => {})
    assert.equal(service.stats.queued, 1); assert.equal(service.stats.connections, 1); assert.equal(state.alive, 1)
    held = false; finish.resolve(); await next
    assert.equal(service.stats.connections, 2); assert.equal(state.peak, 1)
    await waitFor(() => state.alive === 0)
    assert.equal(service.stats.preparedBytes, 0)
  } finally { held = false; finish.resolve(); await service.dispose() }
})

test('falha de término rejeita fila e impede abrir um segundo contexto', async () => {
  const entered = deferred(), finish = deferred()
  const { service, state } = fixture({ idleMs: 0, failRetire: true, retire: async () => {
    entered.resolve(); await finish.promise
  } })
  try {
    await service.render(plan(), () => {}); await entered.promise
    const queued = assert.rejects(service.render(plan(), () => {}), /wasm-unavailable/)
    finish.resolve(); await queued
    await assert.rejects(service.render(plan(), () => {}), /wasm-unavailable/)
    assert.equal(state.alive, 0); assert.equal(service.stats.connections, 1); assert.equal(service.stats.preparedBytes, 0)
  } finally { finish.resolve(); await service.dispose() }
})

test('cache não aceita confirmação de preparação adulterada nem publica pixels de geração incorreta', async () => {
  for (const field of ['generation', 'documentId', 'bytes', 'layerCount', 'tile-generation'] as const) {
    let paints = 0
    const { service, state } = fixture({ response: value => {
      if (field === 'tile-generation' && value.type === 'rendered-prepared-document') return { ...value, generation: value.generation + 1 }
      if (value.type !== 'document-prepared' || field === 'tile-generation') return value
      return { ...value, [field]: field === 'generation' ? value.generation + 1 : field === 'layerCount' ? 99 : 0 }
    } })
    try {
      await assert.rejects(service.render(plan(), () => { paints++ }), /wasm-failure/)
      assert.equal(paints, 0); assert.equal(service.stats.preparedBytes, 0); assert.equal(state.alive, 0)
    } finally { await service.dispose() }
  }
})

test('dispose com preparação residente é idempotente e impede reabrir a sessão', async () => {
  const { service, state } = fixture()
  await service.render(plan(), () => {})
  await Promise.all([service.dispose(), service.dispose()])
  assert.equal(state.alive, 0); assert.equal(service.stats.preparedBytes, 0)
  await assert.rejects(service.render(plan(), () => {}), /wasm-unavailable/)
})

test('admissão de saída também vale em cache hit e não invalida preparação válida', async () => {
  const { service, state } = fixture()
  try {
    await service.render(plan(), () => {})
    for (const mutate of [
      (request: RustEditorialPlan) => { request.width = 0 },
      (request: RustEditorialPlan) => { request.height = Infinity },
      (request: RustEditorialPlan) => { request.grid.originX = NaN },
      (request: RustEditorialPlan) => { request.grid.scaleX = 0.5 },
      (request: RustEditorialPlan) => { request.width = 8192; request.height = 8192 }
    ]) {
      const request = plan(); mutate(request)
      await assert.rejects(service.render(request, () => {}), /invalid-input|memory-limit/)
    }
    await service.render(plan(), () => {})
    assert.equal(state.loads, 1); assert.equal(service.stats.reuses, 1)
  } finally { await service.dispose() }
})

test('deadline em tile residente encerra contexto/fila e ignora resposta tardia', async () => {
  const gate = deferred(), entered = deferred()
  let hold = false, paints = 0
  const { service, state } = fixture({ timeoutMs: 2000, response: async value => {
    if (hold && value.type === 'rendered-prepared-document') { entered.resolve(); await gate.promise }
    return value
  } })
  try {
    await service.render(plan(), () => {})
    hold = true
    const first = assert.rejects(service.render(plan(), () => { paints++ }), /wasm-unavailable/)
    await entered.promise
    const second = assert.rejects(service.render(plan(), () => { paints++ }), /wasm-unavailable/)
    await Promise.all([first, second])
    assert.equal(state.alive, 0); assert.equal(service.stats.preparedBytes, 0)
    gate.resolve(); await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(paints, 0); assert.equal(service.stats.connections, 1)
  } finally { gate.resolve(); await service.dispose() }
})

test('dispose durante confirmação tardia não restaura preparação depois de encerrar sessão', async () => {
  const gate = deferred(), entered = deferred()
  const { service, state } = fixture({ response: async value => {
    if (value.type === 'document-prepared') { entered.resolve(); await gate.promise }
    return value
  } })
  try {
    const render = assert.rejects(service.render(plan(), () => { throw new Error('late-paint') }), /wasm-unavailable/)
    await entered.promise; await service.dispose(); await render
    gate.resolve(); await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(state.alive, 0); assert.equal(service.stats.preparedBytes, 0)
  } finally { gate.resolve(); await service.dispose() }
})

test('dispose durante conexão tardia encerra Worker devolvido depois do abort sem publicar pixels', async () => {
  const gate = deferred(), opened = deferred(), terminated = deferred()
  let paints = 0
  const service = new RustDocumentOffscreen(async () => {
    const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
    const client = new RustPixelPocWorkerClient({ ...worker.port, terminate: async () => {
      await worker.port.terminate(); terminated.resolve()
    } })
    await client.send({ type: 'init', wasm: wasm.slice(0) }); opened.resolve(); await gate.promise
    return client
  }, async (snapshot, signal) => loadRustDocumentMedia(snapshot, signal, async () => rustMediaBlob()))
  try {
    const render = service.render(plan(), () => { paints++ }), rejected = assert.rejects(render, /wasm-unavailable/)
    await opened.promise; await service.dispose(); await rejected; gate.resolve()
    await terminated.promise
    assert.equal(paints, 0); assert.equal(service.stats.workerAlive, false)
  } finally { gate.resolve(); await service.dispose() }
})
