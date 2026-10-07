import type { LayerStyleRenderRequest, LayerStyleRenderResult } from '../services/layerStyleCompositor.ts'
import type { LayerStylePatternAsset } from '../types/editor.ts'
import { buildLayerStylePipeline } from './layerStyleCompositor.ts'
import { normalizeLayerStyleConfig, normalizeLayerStyleGlobalLight } from './layerStyles.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RustPixelPocStyleCancelledError } from './rustPixelPocStyleSession.ts'
import { prepareRustStyleSourceLayout } from './rustPixelPocStylePreparation.ts'
import { rustStylePngLayout } from './rustPixelPocPng.ts'
import type { RustPixelPocServiceRequest } from './rustPixelPocStyleService.ts'
import type { RustPixelPocStyleScheduler, RustPixelPocSchedulerLimits } from './rustPixelPocStyleScheduler.ts'
import { rustPixelPocStyleMetadataBytes } from './rustPixelPocStyleInput.ts'
import { rustStylePriorityValid, type RustStylePriority } from './rustStyleScheduling.ts'
import { RustStylePreviewCancelledError, type LayerStylePreviewRequest, type LayerStylePreviewResult } from './rustStylePreviewProtocol.ts'
export { RustStylePreviewCancelledError, rustStylePreviewEnabled, type LayerStylePreviewRequest, type LayerStylePreviewResult } from './rustStylePreviewProtocol.ts'
type Scheduler = Pick<RustPixelPocStyleScheduler, 'renderPrepared' | 'setPriority' | 'cancel' | 'dispose' | 'stats'>
type Owner = { consumerId: string; epoch: number; revision: symbol; controller?: AbortController;
  failed: boolean; identity?: string; sourceVersion: number; priority: RustStylePriority }
type Context = { epoch: number; failed: boolean; scheduler?: Scheduler; opening?: Promise<Scheduler> }
const MiB = 1024 * 1024

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
  createScheduler(limits: RustPixelPocSchedulerLimits, onChange: () => void): Promise<Scheduler>
  prepare(request: LayerStylePreviewRequest, signal: AbortSignal): Promise<Pick<RustPixelPocServiceRequest, 'source' | 'patterns'>>
  fallback(request: LayerStyleRenderRequest): Promise<LayerStyleRenderResult>
  clock?: () => number
  onChange?: () => void
}

/** Opt-in canvas consumers share one scheduler; thumbnails keep the legacy compositor. */
export class RustStylePreview {
  private readonly owners = new Map<string, Owner>()
  private context: Context | undefined
  private nextEpoch = 0
  private retiring = Promise.resolve()
  private readonly ports: RustStylePreviewPorts
  private readonly clock: () => number
  private counts = { attempts: 0, rendered: 0, fallbacks: 0, cancelled: 0 }
  private resultLeases = 0
  private resultBytes = 0
  private last: { backend: 'rust' | 'legacy'; fallbackReason: string | null; preparationMs: number;
    renderMs: number; totalMs: number; kernelMs: number | null; encodeMs: number | null } | null = null

  constructor(ports: RustStylePreviewPorts) { this.ports = ports; this.clock = ports.clock ?? (() => performance.now()) }

  get stats() {
    const priorities = { active: 0, visible: 0, background: 0 }
    for (const owner of this.owners.values()) priorities[owner.priority]++
    return { ...this.counts, resultLeases: this.resultLeases, retainedResultBytes: this.resultBytes,
      occupied: this.owners.size > 0, consumers: this.owners.size,
      priorities,
      circuitOpen: !!this.context?.failed || [...this.owners.values()].some(owner => owner.failed),
      backendCircuitOpen: this.context?.failed ?? false,
      service: this.context?.scheduler?.stats ?? null, last: this.last ? { ...this.last } : null }
  }

  async render(input: LayerStylePreviewRequest): Promise<LayerStylePreviewResult> {
    if (!input.consumerId.startsWith('canvas:') || !this.owners.has(input.consumerId) && this.owners.size >= 64) {
      return { ...await this.ports.fallback(input), release() {} }
    }
    let owner = this.owners.get(input.consumerId)
    if (!owner) {
      owner = { consumerId: input.consumerId, epoch: ++this.nextEpoch, revision: Symbol(), failed: false, sourceVersion: 0, priority: 'visible' }
      this.owners.set(input.consumerId, owner)
    }
    const context = this.context ??= { epoch: ++this.nextEpoch, failed: false }
    this.cancel(input.consumerId)
    const revision = owner.revision = Symbol(), controller = owner.controller = new AbortController()
    const same = () => this.owners.get(input.consumerId) === owner && owner.revision === revision && this.context === context
    const current = () => same() && !controller.signal.aborted
    const check = () => { if (!current()) throw new RustStylePreviewCancelledError() }
    const started = this.clock()
    let timeout: ReturnType<typeof setTimeout> | undefined
    let preparationMs = 0, fallbackReason: string | null = null
    try {
      this.setPriority(input.consumerId, input.priority ?? 'visible')
      const source = input.source instanceof Blob || typeof input.source === 'function' ? input.source : structuredClone(input.source)
      const request = { ...input, source, styles: normalizeLayerStyleConfig(input.styles),
        globalLight: normalizeLayerStyleGlobalLight(input.globalLight), resolutionScale:
          Number.isFinite(input.resolutionScale) && input.resolutionScale! > 0 ? Math.min(8, Math.max(0.01, input.resolutionScale!)) : 1 }
      if (!owner.failed && !context.failed) {
        this.counts.attempts++
        try {
          if (owner.identity !== request.sourceIdentity) { owner.identity = request.sourceIdentity; owner.sourceVersion++ }
          const sourceIdentity = `preview-source:${owner.epoch}:${owner.sourceVersion}`
          const layout = prepareRustStyleSourceLayout({ ...request, sourceIdentity })
          rustStylePngLayout(layout.width, layout.height, layout.width * layout.height * 4)
          const inputBytes = rustPixelPocStyleMetadataBytes({ sourceIdentity, styles: layout.styles, globalLight: layout.light,
            text: typeof source === 'function' || source instanceof Blob ? null : source.text,
            region: { x: 0, y: 0, width: layout.width, height: layout.height } }) +
            rustPixelPocStyleMetadataBytes(rustStylePreviewPatternAssets(request).map(asset => asset.id))
          if (inputBytes > 4 * MiB) throw new RustPixelPocError('memory-limit')
          let abort = () => {}
          const aborted = new Promise<never>((_, reject) => {
            abort = () => reject(new RustStylePreviewCancelledError())
            controller.signal.addEventListener('abort', abort, { once: true })
          })
          const deadline = new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new RustPixelPocError('wasm-unavailable')), 30_000)
          })
          const work = (async () => {
            const scheduler = await this.scheduler(context)
            check()
            const lease = await scheduler.renderPrepared(input.consumerId, {
              inputBytes,
              prepare: async signal => {
                check()
                const prepared = await this.ports.prepare(request, signal)
                preparationMs = this.clock() - started
                check()
                return { ...request, sourceIdentity, ...prepared }
              }
            }, { priority: owner.priority })
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
          if (this.resultBytes + lease.result.blob.size > 64 * MiB || this.resultLeases >= 64) {
            lease.release(); throw new RustPixelPocError('memory-limit')
          }
          this.counts.rendered++
          this.last = { backend: 'rust', fallbackReason: null, preparationMs,
            renderMs: this.clock() - started - preparationMs, totalMs: this.clock() - started,
            kernelMs: lease.result.timings.kernelMs, encodeMs: lease.result.encoding.pngEncodeMs }
          this.resultLeases++
          this.resultBytes += lease.result.blob.size
          let released = false
          const release = () => {
            if (released) return
            released = true; lease.release(); this.resultLeases--; this.resultBytes -= lease.result.blob.size; this.changed()
          }
          this.changed()
          return { blob: lease.result.blob, width: lease.result.width, height: lease.result.height,
            offsetX: lease.result.offsetX, offsetY: lease.result.offsetY,
            cacheKey: `rust-preview:${context.epoch}:${owner.epoch}:${request.layerId}:${owner.sourceVersion}:${lease.result.id}`, fromCache: false, release }
        } catch (error) {
          check()
          if (error instanceof RustStylePreviewCancelledError || error instanceof RustPixelPocStyleCancelledError && !context.failed) throw error
          fallbackReason = context.failed ? 'wasm-unavailable' : error instanceof RustPixelPocError ? error.code : 'render-failure'
          owner.failed = true
          controller.abort()
          context.scheduler?.cancel(input.consumerId)
          if (fallbackReason === 'wasm-unavailable') { context.failed = true; await this.retireScheduler(context) }
          // The revision still identifies this request after aborting its loaders.
          if (!same()) throw new RustStylePreviewCancelledError()
        }
      }
      this.counts.fallbacks++
      const rendered = await this.ports.fallback(request)
      if (!same()) throw new RustStylePreviewCancelledError()
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
    const owner = this.owners.get(consumerId)
    if (!owner) return
    owner.revision = Symbol(); owner.controller?.abort(); this.context?.scheduler?.cancel(consumerId)
  }

  setPriority(consumerId: string, priority: RustStylePriority) {
    if (!rustStylePriorityValid(priority)) throw new RustPixelPocError('invalid-input')
    const owner = this.owners.get(consumerId)
    if (!owner) return
    if (owner.priority === priority) return
    owner.priority = priority
    this.context?.scheduler?.setPriority(consumerId, priority)
    this.changed()
  }

  releaseConsumer(consumerId: string) {
    if (!this.owners.has(consumerId)) return Promise.resolve()
    this.cancel(consumerId); this.owners.delete(consumerId)
    let retired = Promise.resolve()
    if (!this.owners.size && this.context) {
      const context = this.context; this.context = undefined
      retired = this.retireScheduler(context)
    }
    this.changed()
    return retired
  }

  dispose() {
    for (const consumerId of this.owners.keys()) this.cancel(consumerId)
    this.owners.clear()
    const context = this.context; this.context = undefined
    const retired = context ? this.retireScheduler(context) : this.retiring
    this.changed()
    return retired
  }

  private changed() {
    // Diagnostics cannot fail rendering or leak a lease.
    try { this.ports.onChange?.() } catch {}
  }

  private scheduler(context: Context) {
    if (context.scheduler) return Promise.resolve(context.scheduler)
    if (context.opening) return context.opening
    context.opening = this.retiring.then(() => {
      if (this.context !== context || context.failed) throw new RustStylePreviewCancelledError()
      if (this.resultBytes >= 64 * MiB || this.resultLeases >= 64) throw new RustPixelPocError('memory-limit')
      return this.ports.createScheduler({ maxResidentBytes: 256 * MiB - this.resultBytes,
        maxResultBytes: 64 * MiB - this.resultBytes, maxLeases: 64 - this.resultLeases }, () => this.changed())
    }).then(scheduler => {
      if (this.context !== context || context.failed) { void scheduler.dispose(); throw new RustStylePreviewCancelledError() }
      context.scheduler = scheduler
      return scheduler
    })
    return context.opening
  }

  private retireScheduler(context: Context) {
    const disposed = context.scheduler?.dispose() ?? Promise.resolve()
    context.scheduler = undefined
    this.retiring = Promise.all([this.retiring, disposed]).then(() => {})
    return this.retiring
  }
}
