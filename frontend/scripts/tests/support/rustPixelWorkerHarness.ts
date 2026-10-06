import { Worker } from 'node:worker_threads'
import type { RustPixelPocRequest, RustPixelPocResponse } from '../../../src/editor/rustPixelPocProtocol.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

/** Shared harness runs the real TS Worker behind the Node self/postMessage bridge. */
export function createRustPixelWorkerHarness(options: { mediaFixtures?: boolean } = {}) {
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
  return {
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
