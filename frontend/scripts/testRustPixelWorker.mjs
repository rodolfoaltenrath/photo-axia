import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { Worker } from 'node:worker_threads'

const wasmPath = new URL('../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url)

test('Worker Rust/WASM inicializa, transfere RGBA, cancela pendência e descarta estado', async () => {
  const worker = new Worker(new URL('./rustPixelPoc.node-worker.mjs', import.meta.url))
  const received = []
  const listeners = new Set()
  worker.on('message', (message) => {
    received.push(message)
    for (const listener of listeners) listener()
  })
  worker.on('error', (error) => {
    received.push({ type: 'worker-error', error })
    for (const listener of listeners) listener()
  })
  function waitFor(id) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        listeners.delete(check)
        reject(new Error(`Tempo esgotado no Worker para id ${id}: ${JSON.stringify(received)}`))
      }, 5000)
      function check() {
        const failure = received.find((item) => item.type === 'worker-error')
        if (failure) {
          clearTimeout(timeout)
          listeners.delete(check)
          reject(failure.error)
          return
        }
        const result = received.find((item) => item.id === id)
        if (!result) return
        clearTimeout(timeout)
        listeners.delete(check)
        resolve(result)
      }
      listeners.add(check)
      check()
    })
  }

  try {
    const wasm = readFileSync(wasmPath)
    const wasmBuffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
    worker.postMessage({ type: 'init', id: 1, wasm: wasmBuffer }, [wasmBuffer])
    assert.equal(wasmBuffer.byteLength, 0, 'WASM transferido sem cópia')
    const pending = new Uint8Array([10, 20, 30, 255])
    worker.postMessage({ type: 'render', id: 2, rgba: pending.buffer, fillOpacity: 50 }, [pending.buffer])
    worker.postMessage({ type: 'cancel', id: 2 })
    assert.equal((await waitFor(1)).type, 'ready')
    assert.equal((await waitFor(2)).type, 'cancelled')

    const source = new Uint8Array([10, 20, 30, 101, 90, 80, 70, 255])
    worker.postMessage({ type: 'render', id: 3, rgba: source.buffer, fillOpacity: 50 }, [source.buffer])
    assert.equal(source.byteLength, 0, 'fonte transferida, sem cópia entre threads')
    const rendered = await waitFor(3)
    assert.equal(rendered.type, 'rendered')
    assert.deepEqual([...new Uint8Array(rendered.rgba)], [10, 20, 30, 51, 90, 80, 70, 128])

    const regionSource = new Uint8Array([1, 2, 3, 255, 40, 50, 60, 255,
      4, 5, 6, 255, 7, 8, 9, 0])
    worker.postMessage({ type: 'render-region', id: 7, rgba: regionSource.buffer,
      sourceWidth: 2, sourceHeight: 2, region: { x: 1, y: 0, width: 1, height: 2 },
      fillOpacity: 50 }, [regionSource.buffer])
    assert.equal(regionSource.byteLength, 0)
    const tile = await waitFor(7)
    assert.equal(tile.type, 'rendered-region')
    assert.deepEqual([tile.width, tile.height], [1, 2])
    assert.deepEqual([...new Uint8Array(tile.rgba)], [40, 50, 60, 128, 0, 0, 0, 0])

    worker.postMessage({ type: 'render-region', id: 8, rgba: new Uint8Array(16).buffer,
      sourceWidth: 2, sourceHeight: 2, region: { x: 2, y: 0, width: 1, height: 1 },
      fillOpacity: 50 })
    assert.deepEqual(await waitFor(8), { type: 'error', id: 8, code: 'invalid-input' })

    const stagedSource = new Uint8Array([1, 2, 3, 255, 40, 50, 60, 255,
      4, 5, 6, 255, 7, 8, 9, 0])
    worker.postMessage({ type: 'stage-source', id: 9, rgba: stagedSource.buffer,
      sourceWidth: 2, sourceHeight: 2, generation: 1 }, [stagedSource.buffer])
    assert.equal(stagedSource.byteLength, 0)
    const staged = await waitFor(9)
    assert.equal(staged.type, 'source-staged')
    assert.ok(staged.sourceId > 0)
    assert.equal(staged.generation, 1)
    worker.postMessage({ type: 'stage-source', id: 18, rgba: new Uint8Array(4).buffer,
      sourceWidth: 2, sourceHeight: 2, generation: 1 })
    assert.deepEqual(await waitFor(18), { type: 'error', id: 18, code: 'invalid-input' })
    const stagedRegion = { x: 1, y: 0, width: 1, height: 2 }
    worker.postMessage({ type: 'render-staged-region', id: 10, sourceId: staged.sourceId,
      region: stagedRegion, fillOpacity: 50 })
    const stagedTile = await waitFor(10)
    assert.equal(stagedTile.type, 'rendered-staged-region')
    assert.equal(stagedTile.generation, 1)
    assert.equal(stagedTile.sourceId, staged.sourceId)
    assert.deepEqual([...new Uint8Array(stagedTile.rgba)], [...new Uint8Array(tile.rgba)])
    assert.equal(stagedTile.timings.copyInMs, 0, 'tile reutilizado não copia a fonte inteira')
    worker.postMessage({ type: 'render-staged-region', id: 11, sourceId: staged.sourceId,
      region: { x: 0, y: 0, width: 1, height: 2 }, fillOpacity: 50 })
    assert.deepEqual([...new Uint8Array((await waitFor(11)).rgba)], [1, 2, 3, 128, 4, 5, 6, 128])
    worker.postMessage({ type: 'release-source', id: 12, sourceId: staged.sourceId })
    assert.deepEqual(await waitFor(12), { type: 'source-released', id: 12, sourceId: staged.sourceId })
    worker.postMessage({ type: 'render-staged-region', id: 13, sourceId: staged.sourceId,
      region: stagedRegion, fillOpacity: 50 })
    assert.deepEqual(await waitFor(13), { type: 'error', id: 13, code: 'invalid-input' })

    worker.postMessage({ type: 'stage-source', id: 14, rgba: new Uint8Array([9, 8, 7, 255]).buffer,
      sourceWidth: 1, sourceHeight: 1, generation: 2 })
    const replaced = await waitFor(14)
    worker.postMessage({ type: 'stage-source', id: 15, rgba: new Uint8Array([6, 5, 4, 255]).buffer,
      sourceWidth: 1, sourceHeight: 1, generation: 3 })
    const replacement = await waitFor(15)
    assert.notEqual(replacement.sourceId, replaced.sourceId)
    worker.postMessage({ type: 'render-staged-region', id: 16, sourceId: replaced.sourceId,
      region: { x: 0, y: 0, width: 1, height: 1 }, fillOpacity: 50 })
    assert.deepEqual(await waitFor(16), { type: 'error', id: 16, code: 'invalid-input' })
    worker.postMessage({ type: 'render-staged-region', id: 17, sourceId: replacement.sourceId,
      region: { x: 0, y: 0, width: 1, height: 1 }, fillOpacity: 50 })
    const newestTile = await waitFor(17)
    assert.deepEqual([...new Uint8Array(newestTile.rgba)], [6, 5, 4, 128])
    assert.equal(newestTile.generation, 3)

    worker.postMessage({ type: 'invalidate-source', id: 20, generation: 4 })
    assert.deepEqual(await waitFor(20), { type: 'source-invalidated', id: 20, generation: 4 })
    worker.postMessage({ type: 'render-staged-region', id: 21, sourceId: replacement.sourceId,
      region: { x: 0, y: 0, width: 1, height: 1 }, fillOpacity: 50 })
    assert.deepEqual(await waitFor(21), { type: 'error', id: 21, code: 'invalid-input' })
    worker.postMessage({ type: 'stage-source', id: 22, rgba: new Uint8Array([3, 2, 1, 255]).buffer,
      sourceWidth: 1, sourceHeight: 1, generation: 3 })
    assert.deepEqual(await waitFor(22), { type: 'error', id: 22, code: 'invalid-input' })
    worker.postMessage({ type: 'stage-source', id: 23, rgba: new Uint8Array(4).buffer,
      sourceWidth: 2, sourceHeight: 2, generation: 5 })
    assert.deepEqual(await waitFor(23), { type: 'error', id: 23, code: 'invalid-input' })
    worker.postMessage({ type: 'stage-source', id: 24, rgba: new Uint8Array([3, 2, 1, 255]).buffer,
      sourceWidth: 1, sourceHeight: 1, generation: 5 })
    assert.deepEqual(await waitFor(24), { type: 'error', id: 24, code: 'invalid-input' })
    worker.postMessage({ type: 'stage-source', id: 25, rgba: new Uint8Array([3, 2, 1, 255]).buffer,
      sourceWidth: 1, sourceHeight: 1, generation: 6 })
    const latest = await waitFor(25)
    assert.equal(latest.type, 'source-staged')
    worker.postMessage({ type: 'render-staged-region', id: 26, sourceId: latest.sourceId,
      region: { x: 0, y: 0, width: 1, height: 1 }, fillOpacity: 50 })
    assert.deepEqual([...new Uint8Array((await waitFor(26)).rgba)], [3, 2, 1, 128])

    worker.postMessage({ type: 'render', id: 4, rgba: new Uint8Array(4).buffer, fillOpacity: 101 })
    assert.deepEqual(await waitFor(4), { type: 'error', id: 4, code: 'invalid-input' })
    worker.postMessage({ type: 'dispose', id: 5 })
    assert.equal((await waitFor(5)).type, 'disposed')
    worker.postMessage({ type: 'render', id: 6, rgba: new Uint8Array(4).buffer, fillOpacity: 50 })
    assert.deepEqual(await waitFor(6), { type: 'error', id: 6, code: 'wasm-unavailable' })
    worker.postMessage({ type: 'render-staged-region', id: 19, sourceId: replacement.sourceId,
      region: { x: 0, y: 0, width: 1, height: 1 }, fillOpacity: 50 })
    assert.deepEqual(await waitFor(19), { type: 'error', id: 19, code: 'wasm-unavailable' })

    const secondWasm = readFileSync(wasmPath)
    worker.postMessage({ type: 'init', id: 30, wasm: secondWasm.buffer.slice(
      secondWasm.byteOffset, secondWasm.byteOffset + secondWasm.byteLength) })
    worker.postMessage({ type: 'stage-source', id: 31, rgba: new Uint8Array([8, 7, 6, 255]).buffer,
      sourceWidth: 1, sourceHeight: 1, generation: 1 })
    worker.postMessage({ type: 'cancel', id: 31 })
    assert.equal((await waitFor(30)).type, 'ready')
    const stageAfterCancel = await waitFor(31)
    assert.equal(stageAfterCancel.type, 'source-staged')
    assert.notEqual(stageAfterCancel.sourceId, replacement.sourceId)
    worker.postMessage({ type: 'invalidate-source', id: 32, generation: 2 })
    worker.postMessage({ type: 'cancel', id: 32 })
    assert.deepEqual(await waitFor(32), { type: 'source-invalidated', id: 32, generation: 2 })
    worker.postMessage({ type: 'render-staged-region', id: 33, sourceId: stageAfterCancel.sourceId,
      region: { x: 0, y: 0, width: 1, height: 1 }, fillOpacity: 50 })
    assert.deepEqual(await waitFor(33), { type: 'error', id: 33, code: 'invalid-input' })
    worker.postMessage({ type: 'dispose', id: 34 })
    assert.equal((await waitFor(34)).type, 'disposed')
  } finally {
    await worker.terminate()
  }
})
