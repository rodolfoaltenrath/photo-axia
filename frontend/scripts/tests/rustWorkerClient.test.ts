import assert from 'node:assert/strict'
import test from 'node:test'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { RustPixelPocWorkerClient, type RustPixelPocWorkerPort } from '../../src/editor/rustPixelPocWorkerClient.ts'

const code = (expected: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected
function fixture(timeoutMs = 1000) {
  let message: ((message: unknown) => void) | undefined, fail: (() => void) | undefined
  const state = { terminated: 0, stops: 0, throwPost: false, posts: [] as { message: unknown; transfers: ArrayBuffer[] }[] }
  const port: RustPixelPocWorkerPort = {
    postMessage(message, transfers) { if (state.throwPost) throw new Error('clone'); state.posts.push({ message, transfers }) },
    onMessage(listener) { message = listener; return () => { message = undefined; state.stops++ } },
    onFailure(listener) { fail = listener; return () => { fail = undefined; state.stops++ } },
    terminate() { state.terminated++ }
  }
  return { client: new RustPixelPocWorkerClient(port, timeoutMs), state, message: (value: unknown) => message?.(value), fail: () => fail?.() }
}

test('RPC correlaciona respostas fora de ordem, ignora ruído e preserva lista de transferências', async () => {
  const f = fixture()
  try {
    const buffer = new ArrayBuffer(4), first = f.client.send({ type: 'init', wasm: buffer }, [buffer]), second = f.client.send({ type: 'dispose' })
    f.message(null); f.message({ type: 'sidechannel' }); f.message({ id: 900, type: 'ready' }); f.message({ id: NaN, type: 'ready' })
    f.message({ id: second.id, type: 'disposed' }); f.message({ id: first.id, type: 'ready' })
    assert.equal((await first).type, 'ready'); assert.equal((await second).type, 'disposed')
    assert.equal(f.state.posts[0]!.transfers[0], buffer)
    assert.deepEqual(f.state.posts[0]!.message, { type: 'init', wasm: buffer, id: first.id })
  } finally { await f.client.terminate() }
})

test('Falha de clone libera slot RPC e próximo pedido ainda funciona', async () => {
  const f = fixture()
  try {
    f.state.throwPost = true
    await assert.rejects(f.client.send({ type: 'dispose' }), code('invalid-input'))
    f.state.throwPost = false
    const next = f.client.send({ type: 'dispose' }); f.message({ id: next.id, type: 'disposed' })
    assert.equal((await next).type, 'disposed'); assert.equal(f.client.closed, false)
  } finally { await f.client.terminate() }
})

test('RPC limita oito pendentes e libera capacidade ao receber resposta', async () => {
  const f = fixture()
  try {
    const pending = Array.from({ length: 8 }, () => f.client.send({ type: 'dispose' }))
    await assert.rejects(f.client.send({ type: 'dispose' }), code('memory-limit'))
    f.message({ id: pending[0]!.id, type: 'disposed' }); await pending[0]
    pending.push(f.client.send({ type: 'dispose' }))
    for (const operation of pending.slice(1)) f.message({ id: operation.id, type: 'disposed' })
    await Promise.all(pending)
  } finally { await f.client.terminate() }
})

test('Cancelamento não aguarda ack separado e resposta correlacionada libera pedido original', async () => {
  const f = fixture()
  try {
    const operation = f.client.send({ type: 'render', rgba: new ArrayBuffer(4), fillOpacity: 100 })
    f.client.cancel(operation.id); f.client.cancel(999)
    assert.equal(f.state.posts.length, 2)
    assert.deepEqual(f.state.posts[1]!.message, { type: 'cancel', id: operation.id })
    f.message({ id: operation.id, type: 'cancelled' }); assert.equal((await operation).type, 'cancelled')
    f.client.cancel(operation.id); assert.equal(f.state.posts.length, 2)
  } finally { await f.client.terminate() }
})

test('RPC não cancela barreiras de lifecycle nem espera ack de mensagem cancel', async () => {
  const f = fixture()
  try {
    const operation = f.client.send({ type: 'invalidate-source', generation: 1 })
    f.client.cancel(operation.id); assert.equal(f.state.posts.length, 1)
    await assert.rejects(f.client.send({ type: 'cancel' }), code('invalid-input'))
    f.message({ id: operation.id, type: 'source-invalidated', generation: 1 }); await operation
  } finally { await f.client.terminate() }
})

test('RPC preserva preparação/release documental como barreiras e permite cancelar tiles', async () => {
  const f = fixture()
  try {
    const prepared = f.client.send({ type: 'prepare-document', packet: new ArrayBuffer(32), generation: 1 })
    f.client.cancel(prepared.id); assert.equal(f.state.posts.length, 1)
    f.message({ id: prepared.id, type: 'document-prepared', documentId: 1, generation: 1, bytes: 48, layerCount: 0, preparationMs: 0 })
    await prepared
    const tile = f.client.send({ type: 'compose-prepared-document', documentId: 1, region: { x: 0, y: 0, width: 1, height: 1 } })
    f.client.cancel(tile.id); assert.deepEqual(f.state.posts[2]!.message, { type: 'cancel', id: tile.id })
    f.message({ id: tile.id, type: 'cancelled' }); await tile
    const released = f.client.send({ type: 'release-document', documentId: 1 })
    f.client.cancel(released.id); assert.equal(f.state.posts.length, 4)
    f.message({ id: released.id, type: 'document-released', documentId: 1 }); await released
  } finally { await f.client.terminate() }
})

for (const trigger of ['failure', 'malformed', 'timeout'] as const) {
  test(`RPC ${trigger} rejeita todos, remove listeners e termina apenas uma vez`, async () => {
    const f = fixture(trigger === 'timeout' ? 20 : 1000)
    const first = f.client.send({ type: 'dispose' }), second = f.client.send({ type: 'dispose' })
    const checks = [assert.rejects(first, code('wasm-unavailable')), assert.rejects(second, code('wasm-unavailable'))]
    if (trigger === 'failure') f.fail()
    else if (trigger === 'malformed') f.message({ id: first.id, type: 12 })
    await Promise.all(checks)
    const disposal = f.client.terminate(); assert.equal(disposal, f.client.terminate()); await disposal
    assert.equal(f.state.terminated, 1); assert.equal(f.state.stops, 2); assert.equal(f.client.closed, true)
    await assert.rejects(f.client.send({ type: 'dispose' }), code('wasm-unavailable'))
  })
}

test('RPC valida timeout antes de registrar listeners', () => {
  const port = {} as RustPixelPocWorkerPort
  for (const timeout of [0, -1, NaN, Infinity, 1.5, 60_001]) assert.throws(() => new RustPixelPocWorkerClient(port, timeout), code('invalid-input'))
})
