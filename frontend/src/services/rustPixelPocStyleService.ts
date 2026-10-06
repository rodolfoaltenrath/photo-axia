import wasmUrl from '../generated/axia_pixel_core.wasm?url'
import { RustPixelPocError } from '../editor/rustPixelPocError.ts'
import { RustPixelPocStyleService, type RustPixelPocServiceLimits } from '../editor/rustPixelPocStyleService.ts'
import { RustPixelPocStyleScheduler, type RustPixelPocSchedulerLimits } from '../editor/rustPixelPocStyleScheduler.ts'
import { RustPixelPocWorkerClient, type RustPixelPocWorkerPort } from '../editor/rustPixelPocWorkerClient.ts'

/** Lazy, local WASM only; not enabled in the editor's normal render path. */
export function createRustPixelPocStyleService(limits: RustPixelPocServiceLimits = {}) {
  return new RustPixelPocStyleService(connectRustStyleWorker, limits)
}

export function createRustPixelPocStyleScheduler(limits: RustPixelPocSchedulerLimits = {}, onChange?: () => void) {
  return new RustPixelPocStyleScheduler(connectRustStyleWorker, limits, onChange)
}

async function connectRustStyleWorker(signal: AbortSignal) {
    let client: RustPixelPocWorkerClient | undefined
    const abort = () => { void client?.terminate() }
    signal.addEventListener('abort', abort, { once: true })
    try {
      const response = await fetch(wasmUrl, { signal })
      if (!response.ok) throw new RustPixelPocError('wasm-unavailable')
      const wasm = await response.arrayBuffer()
      if (signal.aborted || !wasm.byteLength || wasm.byteLength > 4 * 1024 * 1024) throw new RustPixelPocError('wasm-unavailable')
      const worker = new Worker(new URL('../workers/rustPixelPoc.worker.ts', import.meta.url), { type: 'module' })
      const port: RustPixelPocWorkerPort = {
        postMessage: (message, transfers) => worker.postMessage(message, transfers),
        onMessage: listener => {
          const handler = (event: MessageEvent<unknown>) => listener(event.data)
          worker.addEventListener('message', handler)
          return () => worker.removeEventListener('message', handler)
        },
        onFailure: listener => {
          worker.addEventListener('error', listener); worker.addEventListener('messageerror', listener)
          return () => { worker.removeEventListener('error', listener); worker.removeEventListener('messageerror', listener) }
        },
        terminate: () => worker.terminate()
      }
      client = new RustPixelPocWorkerClient(port)
      const result = await client.send({ type: 'init', wasm }, [wasm])
      if (signal.aborted || result.type !== 'ready') throw new RustPixelPocError('wasm-unavailable')
      return client
    } catch {
      await client?.terminate()
      throw new RustPixelPocError('wasm-unavailable')
    } finally { signal.removeEventListener('abort', abort) }
}
