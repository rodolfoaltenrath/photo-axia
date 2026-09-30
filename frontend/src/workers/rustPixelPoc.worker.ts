import { createRustPixelPocRuntime, RustPixelPocError } from '../editor/rustPixelPocRuntime.ts'
import type { RustPixelPocRequest, RustPixelPocResponse } from '../editor/rustPixelPocProtocol.ts'

type Runtime = Awaited<ReturnType<typeof createRustPixelPocRuntime>>
let runtimePromise: Promise<Runtime> | null = null
let generation = 0
const pending = new Set<number>()
const cancelled = new Set<number>()

function reply(message: RustPixelPocResponse, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

self.onmessage = (event: MessageEvent<RustPixelPocRequest>) => {
  const request = event.data
  if (request.type === 'cancel') {
    if (pending.has(request.id)) cancelled.add(request.id)
    return
  }
  if (request.type === 'dispose') {
    generation++
    runtimePromise = null
    reply({ type: 'disposed', id: request.id })
    return
  }
  if (request.type === 'init') {
    const current = ++generation
    runtimePromise = createRustPixelPocRuntime(request.wasm)
    void runtimePromise.then(() => {
      if (current === generation) reply({ type: 'ready', id: request.id })
    }).catch(() => {
      if (current === generation) {
        runtimePromise = null
        reply({ type: 'error', id: request.id, code: 'wasm-unavailable' })
      }
    })
    return
  }

  if (!runtimePromise) {
    reply({ type: 'error', id: request.id, code: 'wasm-unavailable' })
    return
  }
  const current = generation
  const runtime = runtimePromise
  pending.add(request.id)
  void runtime.then((engine) => {
    if (current !== generation || cancelled.has(request.id)) {
      reply({ type: 'cancelled', id: request.id })
      return
    }
    const { rgba, timings } = engine.render(new Uint8Array(request.rgba), request.fillOpacity)
    // Rendering is synchronous. The caller must also ignore obsolete IDs;
    // cancel cannot interrupt a running WASM call on this Worker thread.
    reply({ type: 'rendered', id: request.id, rgba: rgba.buffer as ArrayBuffer, timings }, [rgba.buffer])
  }).catch((error: unknown) => {
    const code = error instanceof RustPixelPocError ? error.code : 'wasm-failure'
    reply({ type: 'error', id: request.id, code })
  }).finally(() => {
    pending.delete(request.id)
    cancelled.delete(request.id)
  })
}
