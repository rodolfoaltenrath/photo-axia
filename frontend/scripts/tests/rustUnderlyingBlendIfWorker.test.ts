import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Worker } from 'node:worker_threads'
import type { RustPixelPocRequest, RustPixelPocResponse } from '../../src/editor/rustPixelPocProtocol.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

test('Worker Blend If transfere backdrop, reutiliza fonte e protege publicação após mudança inferior', async () => {
  const worker = new Worker(new URL('../rustPixelPoc.node-worker.mjs', import.meta.url))
  const pending = new Map<number, { resolve: (value: RustPixelPocResponse) => void;
    reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>()
  let nextId = 0
  worker.on('message', (message: RustPixelPocResponse) => {
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timeout)
    pending.delete(message.id)
    entry.resolve(message)
  })
  worker.on('error', (error) => {
    for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(error) }
    pending.clear()
  })
  function send(request: WithoutId<RustPixelPocRequest>, transfers: ArrayBuffer[] = []) {
    const id = ++nextId
    const promise = new Promise<RustPixelPocResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Worker sem resposta: ${id}`))
      }, 5000)
      pending.set(id, { resolve, reject, timeout })
      worker.postMessage({ ...request, id }, transfers)
    })
    return Object.assign(promise, { id })
  }
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const gate = new RustPixelPocTileGate()
    const generation = gate.beginSourceChange()
    const source = new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 0])
    const staged = await send({ type: 'stage-source', rgba: source.buffer, sourceWidth: 3,
      sourceHeight: 1, generation }, [source.buffer])
    assert.equal(source.byteLength, 0)
    assert.ok(staged.type === 'source-staged')
    assert.equal(gate.adoptSource(staged), true)
    const region = { x: 0, y: 0, width: 3, height: 1 }
    const blendIf = { channel: 'red' as const, shadows: [50, 100] as [number, number],
      highlights: [255, 255] as [number, number] }
    const backdrop = new Uint8Array([50, 255, 255, 255, 75, 0, 0, 0, 100, 0, 0, 255])
    const request = send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region, backdrop: backdrop.buffer, blendIf }, [backdrop.buffer])
    assert.equal(backdrop.byteLength, 0, 'backdrop transferido à thread de cálculo')
    const token = gate.captureTile('tile', request.id)
    assert.ok(token)
    const result = await request
    assert.ok(token.isCurrent(result))
    assert.deepEqual([...new Uint8Array(result.rgba)], [10, 20, 30, 0, 40, 50, 60, 128, 70, 80, 90, 0])

    gate.beginViewChange() // A lower layer changed; only backdrop/output changes.
    assert.equal(token.isCurrent(result), false)
    const changedBackdrop = new Uint8Array([100, 0, 0, 0, 50, 255, 255, 255, 75, 0, 0, 0])
    const next = send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region, backdrop: changedBackdrop.buffer, blendIf }, [changedBackdrop.buffer])
    const currentToken = gate.captureTile('tile', next.id)
    assert.ok(currentToken)
    const updated = await next
    assert.ok(currentToken.isCurrent(updated))
    assert.equal(updated.sourceId, result.sourceId)
    assert.equal(updated.generation, result.generation)
    assert.deepEqual([...new Uint8Array(updated.rgba)], [10, 20, 30, 255, 40, 50, 60, 0, 70, 80, 90, 0])

    const invalid = await send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region, backdrop: new ArrayBuffer(8), blendIf })
    assert.deepEqual(invalid, { type: 'error', id: invalid.id, code: 'invalid-input' })
    const recovered = await send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region, backdrop: new ArrayBuffer(12), blendIf: { ...blendIf, shadows: [0, 0] } })
    assert.ok(recovered.type === 'rendered-staged-region')
    assert.deepEqual([...new Uint8Array(recovered.rgba)], [10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 0])
    const invalidated = await send({ type: 'invalidate-source', generation: gate.beginSourceChange() })
    assert.equal(invalidated.type, 'source-invalidated')
    assert.equal(currentToken.isCurrent(updated), false)
    const stale = await send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region, backdrop: new ArrayBuffer(12), blendIf })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally {
    for (const entry of pending.values()) clearTimeout(entry.timeout)
    await worker.terminate()
  }
})
