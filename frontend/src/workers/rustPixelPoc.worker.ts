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
    const previous = runtimePromise
    runtimePromise = null
    if (previous) {
      void previous.then((engine) => engine.dispose()).catch(() => {}).finally(() => {
        reply({ type: 'disposed', id: request.id })
      })
    } else {
      reply({ type: 'disposed', id: request.id })
    }
    return
  }
  if (request.type === 'init') {
    const previous = runtimePromise
    if (previous) void previous.then((engine) => engine.dispose()).catch(() => {})
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
  // Source lifecycle commands are correctness barriers, never cancellable.
  const isRender = request.type === 'render' || request.type === 'render-region' ||
    request.type === 'render-staged-region'
  if (isRender) pending.add(request.id)
  void runtime.then((engine) => {
    if (current !== generation || cancelled.has(request.id)) {
      reply({ type: 'cancelled', id: request.id })
      return
    }
    if (request.type === 'stage-source') {
      const { sourceId, generation: sourceGeneration, stagingMs } = engine.stageSource(
        new Uint8Array(request.rgba), request.sourceWidth, request.sourceHeight, request.generation)
      reply({ type: 'source-staged', id: request.id, sourceId, generation: sourceGeneration, stagingMs })
      return
    }
    if (request.type === 'invalidate-source') {
      engine.invalidateSource(request.generation)
      reply({ type: 'source-invalidated', id: request.id, generation: request.generation })
      return
    }
    if (request.type === 'release-source') {
      engine.releaseSource(request.sourceId)
      reply({ type: 'source-released', id: request.id, sourceId: request.sourceId })
      return
    }
    if (request.type === 'render-staged-region') {
      const { rgba, timings, generation: sourceGeneration } = engine.renderStagedRegion(
        request.sourceId, request.region, request.fillOpacity)
      reply({ type: 'rendered-staged-region', id: request.id, rgba: rgba.buffer as ArrayBuffer,
        width: request.region.width, height: request.region.height, sourceId: request.sourceId,
        generation: sourceGeneration, timings }, [rgba.buffer])
      return
    }
    const { rgba, timings } = request.type === 'render-region'
      ? engine.renderRegion(new Uint8Array(request.rgba), request.sourceWidth, request.sourceHeight,
        request.region, request.fillOpacity)
      : engine.render(new Uint8Array(request.rgba), request.fillOpacity)
    // Rendering is synchronous. The caller must also ignore obsolete IDs;
    // cancel cannot interrupt a running WASM call on this Worker thread.
    if (request.type === 'render-region') {
      reply({ type: 'rendered-region', id: request.id, rgba: rgba.buffer as ArrayBuffer,
        width: request.region.width, height: request.region.height, timings }, [rgba.buffer])
    } else {
      reply({ type: 'rendered', id: request.id, rgba: rgba.buffer as ArrayBuffer, timings }, [rgba.buffer])
    }
  }).catch((error: unknown) => {
    const code = error instanceof RustPixelPocError ? error.code : 'wasm-failure'
    reply({ type: 'error', id: request.id, code })
  }).finally(() => {
    pending.delete(request.id)
    cancelled.delete(request.id)
  })
}
