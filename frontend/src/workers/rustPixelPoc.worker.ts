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
  // Never cancel source lifecycle barriers.
  const isRender = request.type === 'render' || request.type === 'render-region' ||
    request.type === 'render-staged-region' || request.type === 'blend-if-staged-region' ||
    request.type === 'blend-if-this-layer-staged-region' ||
    request.type === 'color-overlay-staged-region' || request.type === 'pattern-overlay-staged-region' ||
    request.type === 'gradient-overlay-staged-region' || request.type === 'local-batch-staged-region' ||
    request.type === 'alpha-mask-staged-region' || request.type === 'drop-shadow-staged-region'
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
    if (request.type === 'render-staged-region' || request.type === 'blend-if-staged-region' ||
        request.type === 'blend-if-this-layer-staged-region' ||
        request.type === 'color-overlay-staged-region' || request.type === 'pattern-overlay-staged-region' ||
        request.type === 'gradient-overlay-staged-region' || request.type === 'local-batch-staged-region' ||
        request.type === 'alpha-mask-staged-region' || request.type === 'drop-shadow-staged-region') {
      const result = (() => {
        switch (request.type) {
          case 'drop-shadow-staged-region':
            return engine.dropShadowStagedRegion(request.sourceId, request.region, new Uint8Array(request.target), request.shadow)
          case 'alpha-mask-staged-region':
            return engine.alphaMaskStagedRegion(request.sourceId, request.region, request.config)
          case 'local-batch-staged-region':
            return engine.localBatchStagedRegion(request.sourceId, request.region, request.plan)
          case 'blend-if-this-layer-staged-region':
            return engine.blendIfThisLayerStagedRegion(request.sourceId, request.region, request.blendIf)
          case 'blend-if-staged-region':
            return engine.blendIfStagedRegion(request.sourceId, request.region,
              new Uint8Array(request.backdrop), request.blendIf)
          case 'color-overlay-staged-region':
            return engine.colorOverlayStagedRegion(request.sourceId, request.region,
              new Uint8Array(request.target), request.effect)
          case 'pattern-overlay-staged-region':
            return engine.patternOverlayStagedRegion(request.sourceId, request.region,
              new Uint8Array(request.target), { rgba: new Uint8Array(request.pattern.rgba),
                width: request.pattern.width, height: request.pattern.height }, request.effect)
          case 'gradient-overlay-staged-region':
            return engine.gradientOverlayStagedRegion(request.sourceId, request.region,
              new Uint8Array(request.target), request.effect)
          case 'render-staged-region':
            return engine.renderStagedRegion(request.sourceId, request.region, request.fillOpacity)
          default:
            request satisfies never
            throw new RustPixelPocError('invalid-input')
        }
      })()
      const { rgba, timings, generation: sourceGeneration } = result
      reply({ type: 'rendered-staged-region', id: request.id, rgba: rgba.buffer as ArrayBuffer,
        width: request.region.width, height: request.region.height, sourceId: request.sourceId,
        generation: sourceGeneration, timings }, [rgba.buffer])
      return
    }
    const { rgba, timings } = request.type === 'render-region'
      ? engine.renderRegion(new Uint8Array(request.rgba), request.sourceWidth, request.sourceHeight,
        request.region, request.fillOpacity)
      : engine.render(new Uint8Array(request.rgba), request.fillOpacity)
    // WASM is synchronous; callers must reject obsolete replies.
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
