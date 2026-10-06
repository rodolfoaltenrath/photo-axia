import type { LayerStyleRenderRequest, LayerStyleRenderResult } from '../services/layerStyleCompositor.ts'
import type { LayerStylePatternAsset } from '../types/editor.ts'
import { buildLayerStylePipeline } from './layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RustPixelPocStyleCancelledError } from './rustPixelPocStyleSession.ts'
import { prepareRustStyleSourceLayout } from './rustPixelPocStylePreparation.ts'
import { rustStylePngLayout } from './rustPixelPocPng.ts'
import type { RustPixelPocStyleService, RustPixelPocServiceRequest } from './rustPixelPocStyleService.ts'
import { RustStylePreviewCancelledError, type LayerStylePreviewRequest, type LayerStylePreviewResult } from './rustStylePreviewProtocol.ts'
export { RustStylePreviewCancelledError, rustStylePreviewEnabled, type LayerStylePreviewRequest, type LayerStylePreviewResult } from './rustStylePreviewProtocol.ts'
type Service = Pick<RustPixelPocStyleService, 'render' | 'cancel' | 'dispose' | 'stats'>
type Owner = { consumerId: string; epoch: number; revision: symbol; controller?: AbortController; service?: Service;
  opening?: Promise<Service>; failed: boolean; identity?: string; sourceVersion: number }

export function rustStylePreviewPatternAssets(request: LayerStylePreviewRequest) {
  const pipeline = buildLayerStylePipeline(request.styles), assets = new Map<string, LayerStylePatternAsset>()
  function add(asset: LayerStylePatternAsset | undefined) {
    if (!asset) return
    const previous = assets.get(asset.id)
    if (previous && (previous.sourceUrl !== asset.sourceUrl || previous.width !== asset.width || previous.height !== asset.height)) {
      throw new RustPixelPocError('invalid-input')
    }
    assets.set(asset.id, asset)
  }
  for (const effect of pipeline.overlay) if (effect.type === 'pattern-overlay') add(effect.pattern)
  for (const effect of pipeline.upper) {
    if (effect.type === 'stroke' && effect.paint.type === 'pattern') add(effect.paint.pattern)
    if (effect.type === 'bevel-emboss' && effect.textureEnabled) add(effect.texture)
  }
  return [...assets.values()]
}

export interface RustStylePreviewPorts {
  createService(): Promise<Service>
  prepare(request: LayerStylePreviewRequest, signal: AbortSignal): Promise<Pick<RustPixelPocServiceRequest, 'source' | 'patterns'>>
  fallback(request: LayerStyleRenderRequest): Promise<LayerStyleRenderResult>
  clock?: () => number
  onChange?: () => void
}

/** One experimental canvas owner; other consumers keep the existing compositor. */
export class RustStylePreview {
  private owner: Owner | null = null
  private nextEpoch = 0
  private retiring = Promise.resolve()
  private readonly ports: RustStylePreviewPorts
  private readonly clock: () => number
  private counts = { attempts: 0, rendered: 0, fallbacks: 0, cancelled: 0 }
  private resultLeases = 0
  private last: { backend: 'rust' | 'legacy'; fallbackReason: string | null; preparationMs: number;
    renderMs: number; totalMs: number; kernelMs: number | null; encodeMs: number | null } | null = null

  constructor(ports: RustStylePreviewPorts) { this.ports = ports; this.clock = ports.clock ?? (() => performance.now()) }

  get stats() {
    return { ...this.counts, resultLeases: this.resultLeases, occupied: !!this.owner, circuitOpen: this.owner?.failed ?? false,
      service: this.owner?.service?.stats ?? null, last: this.last ? { ...this.last } : null }
  }

  async render(input: LayerStylePreviewRequest): Promise<LayerStylePreviewResult> {
    if (!input.consumerId.startsWith('canvas:') || this.owner && this.owner.consumerId !== input.consumerId) {
      return { ...await this.ports.fallback(input), release() {} }
    }
    const owner = this.owner ??= { consumerId: input.consumerId, epoch: ++this.nextEpoch,
      revision: Symbol(), failed: false, sourceVersion: 0 }
    this.cancel(input.consumerId)
    const revision = owner.revision = Symbol(), controller = owner.controller = new AbortController()
    const current = () => this.owner === owner && owner.revision === revision && !controller.signal.aborted
    const check = () => { if (!current()) throw new RustStylePreviewCancelledError() }
    const started = this.clock()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let preparationMs = 0, fallbackReason: string | null = null
    try {
      const source = input.source instanceof Blob || typeof input.source === 'function' ? input.source : structuredClone(input.source)
      const request = { ...input, source, styles: normalizeLayerStyleConfig(input.styles),
        globalLight: normalizeLayerStyleGlobalLight(input.globalLight), resolutionScale:
          Number.isFinite(input.resolutionScale) && input.resolutionScale! > 0 ? Math.min(8, Math.max(0.01, input.resolutionScale!)) : 1 }
      if (!owner.failed) {
        this.counts.attempts++
        try {
          if (owner.identity !== request.sourceIdentity) { owner.identity = request.sourceIdentity; owner.sourceVersion++ }
          const sourceIdentity = `preview-source:${owner.sourceVersion}`
          const layout = prepareRustStyleSourceLayout({ ...request, sourceIdentity })
          rustStylePngLayout(layout.width, layout.height, layout.width * layout.height * 4)
          let abort = () => {}
          const aborted = new Promise<never>((_, reject) => {
            abort = () => reject(new RustStylePreviewCancelledError())
            controller.signal.addEventListener('abort', abort, { once: true })
          })
          const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new RustPixelPocError('wasm-unavailable')), 30_000)
          })
          const work = (async () => {
            const prepared = await this.ports.prepare(request, controller.signal)
            preparationMs = this.clock() - started
            check()
            const service = await this.service(owner)
            check()
            const lease = await service.render({ ...request, sourceIdentity, ...prepared })
            if (!current()) { lease.release(); throw new RustStylePreviewCancelledError() }
            return lease
          })()
          let expired = false
          // A timed-out preparation may resolve after fallback; never retain its result.
          void work.then(lease => { if (expired) lease.release() }, () => {})
          let lease: Awaited<typeof work>
          try { lease = await Promise.race([work, aborted, deadline]) }
          catch (error) { expired = true; throw error }
          finally { controller.signal.removeEventListener('abort', abort); clearTimeout(timeout) }
          check()
          this.counts.rendered++
          this.last = { backend: 'rust', fallbackReason: null, preparationMs,
            renderMs: this.clock() - started - preparationMs, totalMs: this.clock() - started,
            kernelMs: lease.result.timings.kernelMs, encodeMs: lease.result.encoding.pngEncodeMs }
          this.resultLeases++
          let released = false
          const release = () => {
            if (released) return
            released = true; lease.release(); this.resultLeases--; this.changed()
          }
          this.changed()
          return { blob: lease.result.blob, width: lease.result.width, height: lease.result.height,
            offsetX: lease.result.offsetX, offsetY: lease.result.offsetY,
            cacheKey: `rust-preview:${owner.epoch}:${request.layerId}:${owner.sourceVersion}:${lease.result.id}`, fromCache: false, release }
        } catch (error) {
          check()
          if (error instanceof RustPixelPocStyleCancelledError || error instanceof RustStylePreviewCancelledError) throw error
          fallbackReason = error instanceof RustPixelPocError ? error.code : 'render-failure'
          owner.failed = true
          controller.abort()
          await this.retireService(owner)
          // The revision still identifies this request after aborting its loaders.
          if (this.owner !== owner || owner.revision !== revision) throw new RustStylePreviewCancelledError()
        }
      }
      this.counts.fallbacks++
      const rendered = await this.ports.fallback(request)
      if (this.owner !== owner || owner.revision !== revision) throw new RustStylePreviewCancelledError()
      this.last = { backend: 'legacy', fallbackReason: fallbackReason ?? 'circuit-open', preparationMs,
        renderMs: this.clock() - started - preparationMs, totalMs: this.clock() - started, kernelMs: null, encodeMs: null }
      this.changed()
      return { ...rendered, release() {} }
    } catch (error) {
      if (error instanceof RustPixelPocStyleCancelledError || error instanceof RustStylePreviewCancelledError) this.counts.cancelled++
      this.changed()
      throw error
    } finally { clearTimeout(timeout) }
  }

  cancel(consumerId: string) {
    const owner = this.owner
    if (owner?.consumerId !== consumerId) return
    owner.revision = Symbol(); owner.controller?.abort(); owner.service?.cancel()
  }

  releaseConsumer(consumerId: string) {
    const owner = this.owner
    if (owner?.consumerId !== consumerId) return Promise.resolve()
    this.cancel(consumerId); this.owner = null
    const retired = this.retireService(owner)
    this.changed()
    return retired
  }

  dispose() { return this.owner ? this.releaseConsumer(this.owner.consumerId) : this.retiring }

  private changed() {
    // Diagnostics cannot fail rendering or leak a lease.
    try { this.ports.onChange?.() } catch {}
  }

  private service(owner: Owner) {
    if (owner.service) return Promise.resolve(owner.service)
    if (owner.opening) return owner.opening
    owner.opening = this.retiring.then(() => {
      if (this.owner !== owner || owner.failed) throw new RustStylePreviewCancelledError()
      return this.ports.createService()
    }).then(service => {
      if (this.owner !== owner || owner.failed) { void service.dispose(); throw new RustStylePreviewCancelledError() }
      owner.service = service
      return service
    })
    return owner.opening
  }

  private retireService(owner: Owner) {
    const disposed = owner.service?.dispose() ?? Promise.resolve()
    owner.service = undefined
    this.retiring = Promise.all([this.retiring, disposed]).then(() => {})
    return this.retiring
  }
}
