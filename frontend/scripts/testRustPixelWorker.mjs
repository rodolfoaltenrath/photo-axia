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

    worker.postMessage({ type: 'render', id: 4, rgba: new Uint8Array(4).buffer, fillOpacity: 101 })
    assert.deepEqual(await waitFor(4), { type: 'error', id: 4, code: 'invalid-input' })
    worker.postMessage({ type: 'dispose', id: 5 })
    assert.equal((await waitFor(5)).type, 'disposed')
    worker.postMessage({ type: 'render', id: 6, rgba: new Uint8Array(4).buffer, fillOpacity: 50 })
    assert.deepEqual(await waitFor(6), { type: 'error', id: 6, code: 'wasm-unavailable' })
  } finally {
    await worker.terminate()
  }
})
