import { Worker } from 'node:worker_threads'
import type { RustPixelPocRequest, RustPixelPocResponse } from '../../../src/editor/rustPixelPocProtocol.ts'
import type { RustPixelPocWorkerPort } from '../../../src/editor/rustPixelPocWorkerClient.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

/** Shared harness runs the real TS Worker behind the Node self/postMessage bridge. */
export function createRustPixelWorkerHarness(options: { mediaFixtures?: boolean; encodeDelayMs?: number; failEncodeCount?: number; holdEncoding?: boolean } = {}) {
  const worker = new Worker(new URL('../../rustPixelPoc.node-worker.mjs', import.meta.url), { workerData: options })
  const pending = new Map<number, { resolve: (value: RustPixelPocResponse) => void;
    reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>()
  let nextId = 0
  function rejectPending(error: Error) {
    for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(error) }
    pending.clear()
  }
  worker.on('message', (message: RustPixelPocResponse) => {
    const entry = pending.get(message.id)
    if (!entry) return
    clearTimeout(entry.timeout)
    pending.delete(message.id)
    entry.resolve(message)
  })
  worker.on('error', rejectPending)
  worker.on('exit', code => rejectPending(new Error(`Worker encerrado: ${code}`)))
  const port: RustPixelPocWorkerPort = {
    postMessage: (message, transfers) => worker.postMessage(message, transfers),
    onMessage: listener => { worker.on('message', listener); return () => { worker.off('message', listener) } },
    onFailure: listener => {
      worker.on('error', listener); worker.on('messageerror', listener); worker.on('exit', listener)
      return () => { worker.off('error', listener); worker.off('messageerror', listener); worker.off('exit', listener) }
    },
    terminate: async () => { await worker.terminate() }
  }
  return {
    port,
    releaseEncoding() { worker.postMessage({ type: 'fixture-release-encoding' }) },
    waitForEncoding() {
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { worker.off('message', listener); reject(new Error('Encoder não iniciou.')) }, 5000)
        function listener(message: { type?: string }) {
          if (message.type !== 'fixture-encode-started') return
          clearTimeout(timeout); worker.off('message', listener); resolve()
        }
        worker.on('message', listener)
      })
    },
    cancel(id: number) { worker.postMessage({ type: 'cancel', id }) },
    send(request: WithoutId<RustPixelPocRequest>, transfers: ArrayBuffer[] = []) {
      const id = ++nextId
      const promise = new Promise<RustPixelPocResponse>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`Worker sem resposta: ${id}`))
        }, 5000)
        pending.set(id, { resolve, reject, timeout })
        try { worker.postMessage({ ...request, id }, transfers) }
        catch (error) {
          clearTimeout(timeout)
          pending.delete(id)
          reject(error)
        }
      })
      return Object.assign(promise, { id })
    },
    async close() {
      rejectPending(new Error('Harness fechado.'))
      await worker.terminate()
    }
  }
}
