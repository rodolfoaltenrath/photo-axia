import { createRustPixelPocRuntime, RustPixelPocError } from '../editor/rustPixelPocRuntime.ts'
import { padRustStyleSource, prepareRustStyleJob, prepareRustStyleSourceLayout } from '../editor/rustPixelPocStylePreparation.ts'
import { decodeRustStyleSource, decodeRustStyleAssets, prepareRustStyleAssets } from '../editor/rustPixelPocMedia.ts'
import { RustPixelPocMediaQueue } from '../editor/rustPixelPocMediaQueue.ts'
import { encodeRustStylePng, rustStylePngLayout } from '../editor/rustPixelPocPng.ts'
import type { RustPixelPocRequest, RustPixelPocResponse } from '../editor/rustPixelPocProtocol.ts'
import { emptyRustStyleDecodeTimings } from '../editor/rustStyleMediaTimings.ts'

type Runtime = Awaited<ReturnType<typeof createRustPixelPocRuntime>>
let runtimePromise: Promise<Runtime> | null = null
let generation = 0
const pending = new Set<number>()
const cancelled = new Set<number>()
const mediaQueue = new RustPixelPocMediaQueue()
let preparedSource: { sourceId: number; sourceKey: string } | null = null

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
    preparedSource = null
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
    preparedSource = null
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
  const isRender = request.type === 'compose-document-region' || request.type === 'style-media-staged-png' || request.type === 'style-media-staged-region' || request.type === 'render' || request.type === 'render-region' ||
    request.type === 'render-staged-region' || request.type === 'blend-if-staged-region' ||
    request.type === 'blend-if-this-layer-staged-region' ||
    request.type === 'color-overlay-staged-region' || request.type === 'pattern-overlay-staged-region' ||
    request.type === 'gradient-overlay-staged-region' || request.type === 'local-batch-staged-region' || request.type === 'style-stages-staged-region' ||
    request.type === 'alpha-mask-staged-region' || request.type === 'drop-shadow-staged-region' || request.type === 'inner-shadow-staged-region' || request.type === 'glow-staged-region' || request.type === 'satin-staged-region' || request.type === 'stroke-staged-region' || request.type === 'bevel-staged-region'
  if (isRender) pending.add(request.id)
  void runtime.then(async (engine) => {
    if (current !== generation || cancelled.has(request.id)) {
      reply({ type: 'cancelled', id: request.id })
      return
    }
    const ensureCurrent = () => {
      if (current !== generation || cancelled.has(request.id)) throw new RustPixelPocError('invalid-input')
    }
    if (request.type === 'compose-document-region') {
      if (!(request.packet instanceof ArrayBuffer)) throw new RustPixelPocError('invalid-input')
      const { rgba, region, width, height, timings } = engine.composeDocumentPacket(new Uint8Array(request.packet))
      ensureCurrent()
      reply({ type: 'rendered-document-region', id: request.id, rgba: rgba.buffer, region, width, height, timings }, [rgba.buffer])
      return
    }
    if (request.type === 'stage-style-media') {
      let prepared: Extract<RustPixelPocResponse, { type: 'source-staged' }>['prepared']
      const staged = await engine.stagePreparedSourceAsync(checkSource => mediaQueue.run(async () => {
        const started = performance.now()
        const check = () => { ensureCurrent(); checkSource() }
        check()
        const layout = prepareRustStyleSourceLayout(request.input)
        const media = emptyRustStyleDecodeTimings()
        const source = await decodeRustStyleSource(request.source, layout, check, media)
        check()
        const paddingStarted = performance.now()
        const rgba = padRustStyleSource(source, layout)
        const paddingMs = performance.now() - paddingStarted
        prepared = { sourceKey: layout.sourceKey, width: layout.width, height: layout.height,
          offsetX: layout.offsetX, offsetY: layout.offsetY, preparationMs: performance.now() - started, media, paddingMs }
        return { rgba, width: layout.width, height: layout.height }
      }), request.generation)
      ensureCurrent()
      preparedSource = { sourceId: staged.sourceId, sourceKey: prepared!.sourceKey }
      reply({ type: 'source-staged', id: request.id, ...staged, prepared })
      return
    }
    if (request.type === 'style-media-staged-region' || request.type === 'style-media-staged-png') {
      const layout = prepareRustStyleSourceLayout(request.input)
      const metadata = engine.sourceMetadata(request.sourceId)
      const check = () => {
        ensureCurrent()
        engine.sourceMetadata(request.sourceId)
        if (preparedSource?.sourceId !== request.sourceId || preparedSource.sourceKey !== layout.sourceKey ||
            metadata.width !== layout.width || metadata.height !== layout.height) throw new RustPixelPocError('invalid-input')
      }
      check()
      const assets = prepareRustStyleAssets(layout, request.patterns)
      // Validate region before any asynchronous decode.
      const region = request.region
      if (!region || ![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
          region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
          region.x + region.width > layout.width || region.y + region.height > layout.height) {
        throw new RustPixelPocError('invalid-input')
      }
      const retainedBytes = layout.width * layout.height * 4 + assets.decodedBytes
      if (request.type === 'style-media-staged-png') rustStylePngLayout(region.width, region.height, retainedBytes)
      const result = await mediaQueue.run(async () => {
        check()
        const patternMedia = emptyRustStyleDecodeTimings()
        const patterns = await decodeRustStyleAssets(assets, check, patternMedia)
        check()
        const job = prepareRustStyleJob({ ...request.input, region, patterns })
        if (job.workingBytes + assets.decodedBytes + job.packetBytes > 96 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
        if (request.type === 'style-media-staged-png') rustStylePngLayout(region.width, region.height, retainedBytes + job.packetBytes)
        const rendered = engine.styleStagesStagedRegion(request.sourceId, job.region, job.plan)
        const common = { id: request.id, width: region.width, height: region.height, sourceId: request.sourceId,
          generation: rendered.generation, timings: rendered.timings, patternMedia }
        if (request.type === 'style-media-staged-png') {
          const encoded = await encodeRustStylePng(rendered.rgba, region.width, region.height, check, retainedBytes + job.packetBytes)
          return { type: 'encoded-staged-region' as const, ...common, ...encoded }
        }
        return { type: 'rendered-staged-region' as const, ...common, rgba: rendered.rgba.buffer as ArrayBuffer }
      })
      check()
      if (result.type === 'encoded-staged-region') reply(result)
      else reply(result, [result.rgba])
      return
    }
    if (request.type === 'stage-style-source') {
      let prepared: Extract<RustPixelPocResponse, { type: 'source-staged' }>['prepared']
      const staged = engine.stagePreparedSource(() => {
        const started = performance.now()
        const layout = prepareRustStyleSourceLayout(request.input)
        if (!(request.rgba instanceof ArrayBuffer)) throw new RustPixelPocError('invalid-input')
        const rgba = padRustStyleSource({ width: layout.sourceWidth, height: layout.sourceHeight,
          data: new Uint8ClampedArray(request.rgba) }, layout)
        prepared = { sourceKey: layout.sourceKey, width: layout.width, height: layout.height,
          offsetX: layout.offsetX, offsetY: layout.offsetY, preparationMs: performance.now() - started }
        return { rgba, width: layout.width, height: layout.height }
      }, request.generation)
      preparedSource = { sourceId: staged.sourceId, sourceKey: prepared!.sourceKey }
      reply({ type: 'source-staged', id: request.id, ...staged, prepared })
      return
    }
    if (request.type === 'stage-source') {
      const { sourceId, generation: sourceGeneration, stagingMs } = engine.stageSource(
        new Uint8Array(request.rgba), request.sourceWidth, request.sourceHeight, request.generation)
      preparedSource = null
      reply({ type: 'source-staged', id: request.id, sourceId, generation: sourceGeneration, stagingMs })
      return
    }
    if (request.type === 'invalidate-source') {
      engine.invalidateSource(request.generation)
      preparedSource = null
      reply({ type: 'source-invalidated', id: request.id, generation: request.generation })
      return
    }
    if (request.type === 'release-source') {
      engine.releaseSource(request.sourceId)
      preparedSource = null
      reply({ type: 'source-released', id: request.id, sourceId: request.sourceId })
      return
    }
    if (request.type === 'render-staged-region' || request.type === 'blend-if-staged-region' ||
        request.type === 'blend-if-this-layer-staged-region' ||
        request.type === 'color-overlay-staged-region' || request.type === 'pattern-overlay-staged-region' ||
        request.type === 'gradient-overlay-staged-region' || request.type === 'local-batch-staged-region' || request.type === 'style-stages-staged-region' ||
        request.type === 'alpha-mask-staged-region' || request.type === 'drop-shadow-staged-region' || request.type === 'inner-shadow-staged-region' || request.type === 'glow-staged-region' || request.type === 'satin-staged-region' || request.type === 'stroke-staged-region' || request.type === 'bevel-staged-region') {
      const result = (() => {
        switch (request.type) {
          case 'style-stages-staged-region':
            return engine.styleStagesStagedRegion(request.sourceId, request.region, request.plan)
          case 'bevel-staged-region':
            return engine.bevelStagedRegion(request.sourceId, request.region, new Uint8Array(request.target), request.bevel)
          case 'stroke-staged-region':
            return engine.strokeStagedRegion(request.sourceId, request.region, new Uint8Array(request.target), request.stroke)
          case 'satin-staged-region':
            return engine.satinStagedRegion(request.sourceId, request.region, new Uint8Array(request.target), request.satin)
          case 'glow-staged-region':
            return engine.glowStagedRegion(request.sourceId, request.region, new Uint8Array(request.target), request.glow)
          case 'inner-shadow-staged-region':
            return engine.innerShadowStagedRegion(request.sourceId, request.region, new Uint8Array(request.target), request.shadow)
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
    if (current !== generation || cancelled.has(request.id)) {
      reply({ type: 'cancelled', id: request.id })
      return
    }
    const code = error instanceof RustPixelPocError ? error.code : 'wasm-failure'
    reply({ type: 'error', id: request.id, code })
  }).finally(() => {
    pending.delete(request.id)
    cancelled.delete(request.id)
  })
}
