import type { RustEditorialPlan, RustDocumentMediaInput } from './rustDocumentEditorial.ts'
import { rustStylePreviewPatternAssets } from './rustStylePreview.ts'
import { readRustStylePreviewBlob } from './rustStylePreviewMedia.ts'
import { rustPixelPocStyleMetadataBytes } from './rustPixelPocStyleInput.ts'
import type { RustPixelPocConnect } from './rustPixelPocStyleService.ts'
import type { RustPixelPocConnection } from './rustPixelPocWorkerClient.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_DOCUMENT_ENCODED_BYTES } from './rustDocumentBudget.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import { rustDocumentReusable, sameRustDocumentPreparation } from './rustDocumentReuse.ts'
import { drawRustDocumentStyledText, drawRustDocumentText } from './rustDocumentText.ts'

export async function loadRustDocumentMedia(plan: RustEditorialPlan, signal: AbortSignal,
  read = readRustStylePreviewBlob, rasterizeText = drawRustDocumentText,
  rasterizeStyledText = drawRustDocumentStyledText): Promise<RustDocumentMediaInput> {
  const layers: RustDocumentMediaInput['layers'] = []
  let encoded = 0
  for (const layer of plan.layers) {
    signal.throwIfAborted()
    const patterns: Record<string, Blob> = Object.create(null)
    for (const asset of rustStylePreviewPatternAssets({ styles: layer.input.styles })) {
      const blob = await read(asset.sourceUrl, signal, RUST_DOCUMENT_ENCODED_BYTES - encoded)
      encoded += blob.size; patterns[asset.id] = blob
    }
    // Texto rasteriza aqui, na thread principal: fontes de @font-face não existem no Worker.
    const source = layer.source.type === 'raster'
      ? { type: 'raster' as const, blob: await read(layer.source.url, signal, RUST_DOCUMENT_ENCODED_BYTES - encoded) }
      : layer.source.type === 'text' ? rasterizeText(layer.source)
      : layer.source.type === 'styled-text' ? rasterizeStyledText(layer.source) : layer.source
    if (source.type === 'raster') encoded += source.blob.size
    if (source.type === 'text-pixels' || source.type === 'styled-text-pixels') encoded += source.rgba.byteLength
    if (encoded > RUST_DOCUMENT_ENCODED_BYTES) throw new RustPixelPocError('memory-limit')
    layers.push({ ...layer, source, patterns })
  }
  signal.throwIfAborted()
  return { ...plan, layers }
}

type Paint = (rgba: Uint8Array<ArrayBuffer>, region: RustPixelPocRegion) => void
type Ticket = { plan: RustEditorialPlan; paint: Paint; resolve(): void; reject(error: unknown): void }

/** One bounded transaction and one prepared document, retired after inactivity. */
export class RustDocumentOffscreen {
  private pending: Ticket[] = []
  private active: AbortController | null = null
  private stopped = false
  private connection: RustPixelPocConnection | null = null
  private running: Promise<void> | null = null
  private retiring: Promise<void> | null = null
  private idle: ReturnType<typeof setTimeout> | undefined
  private prepared: { plan: RustEditorialPlan; documentId: number; generation: number; bytes: number } | null = null
  private generation = 0
  private counts = { connections: 0, preparations: 0, reuses: 0, rendered: 0 }
  private readonly connect: RustPixelPocConnect
  private readonly load: typeof loadRustDocumentMedia
  private readonly timeoutMs: number
  private readonly idleMs: number
  constructor(connect: RustPixelPocConnect, load = loadRustDocumentMedia, timeoutMs = 30_000, idleMs = 5_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000 ||
        !Number.isSafeInteger(idleMs) || idleMs < 0 || idleMs > 60_000) throw new RustPixelPocError('invalid-input')
    this.connect = connect; this.load = load; this.timeoutMs = timeoutMs; this.idleMs = idleMs
  }
  get stats() {
    return { ...this.counts, active: this.active !== null, queued: this.pending.length,
      workerAlive: !!this.connection && !this.connection.closed, preparedBytes: this.prepared?.bytes ?? 0 }
  }
  render(plan: RustEditorialPlan, paint: Paint): Promise<void> {
    if (this.stopped) return Promise.reject(new RustPixelPocError('wasm-unavailable'))
    try {
      if (!plan || ![plan.width, plan.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) ||
          ![plan.documentWidth, plan.documentHeight].every(value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff) ||
          !plan.grid || plan.grid.scaleX !== 1 || plan.grid.scaleY !== 1 ||
          ![plan.grid.originX, plan.grid.originY].every(value => Number.isFinite(value) && Math.abs(value) <= 0xffffffff)) {
        throw new RustPixelPocError('invalid-input')
      }
      if (plan.width * plan.height * 4 > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
      if (this.pending.length >= 3 || rustPixelPocStyleMetadataBytes(plan) > 1024 * 1024) throw new RustPixelPocError('memory-limit')
      const snapshot = structuredClone(plan)
      const result = new Promise<void>((resolve, reject) => this.pending.push({ plan: snapshot, paint, resolve, reject }))
      this.pump(); return result
    } catch (error) { return Promise.reject(error) }
  }
  async dispose() {
    this.stop()
    await Promise.all([this.retire(), this.running])
  }
  private stop() {
    this.stopped = true; clearTimeout(this.idle); this.idle = undefined; this.active?.abort()
    for (const ticket of this.pending.splice(0)) ticket.reject(new RustPixelPocError('wasm-unavailable'))
  }
  private retire() {
    if (this.retiring) return this.retiring
    const connection = this.connection
    this.connection = null; this.prepared = null; this.generation = 0
    if (!connection) return Promise.resolve()
    const retiring = this.retiring = Promise.resolve().then(() => connection.terminate())
    void retiring.then(() => {
      if (this.retiring === retiring) this.retiring = null
      this.pump()
    }, () => {
      if (this.retiring === retiring) this.retiring = null
      this.stop()
    })
    return retiring
  }
  private pump() {
    if (this.active || this.stopped || this.retiring) return
    const ticket = this.pending.shift()
    if (!ticket) {
      if (this.connection && this.idle === undefined) {
        this.idle = setTimeout(() => { this.idle = undefined; void this.retire().catch(() => {}) }, this.idleMs)
      }
      return
    }
    clearTimeout(this.idle); this.idle = undefined
    const controller = this.active = new AbortController()
    this.running = this.run(ticket, controller)
  }
  private async run(ticket: Ticket, controller: AbortController) {
    let timeout: ReturnType<typeof setTimeout> | undefined, connection: RustPixelPocConnection | undefined
    const work = (async () => {
      if (this.connection?.closed) await this.retire()
      controller.signal.throwIfAborted()
      const reusable = rustDocumentReusable(ticket.plan)
      let prepared = this.prepared
      if (prepared && reusable && sameRustDocumentPreparation(prepared.plan, ticket.plan)) {
        connection = this.connection!
        this.counts.reuses++
      } else {
        connection = this.connection ?? undefined
        if (connection && prepared) {
          const released = await connection.send({ type: 'release-document', documentId: prepared.documentId })
          if (released.type !== 'document-released' || released.documentId !== prepared.documentId) {
            throw new RustPixelPocError(released.type === 'error' ? released.code : 'wasm-failure')
          }
          this.prepared = null
        }
        controller.signal.throwIfAborted()
        const input = await this.load(ticket.plan, controller.signal)
        controller.signal.throwIfAborted()
        if (!connection) {
          connection = await this.connect(controller.signal)
          if (controller.signal.aborted) { await connection.terminate(); controller.signal.throwIfAborted() }
          this.connection = connection; this.counts.connections++
        }
        const generation = ++this.generation
        if (!Number.isSafeInteger(generation)) throw new RustPixelPocError('wasm-failure')
        const response = await connection.send({ type: 'prepare-document-media', input, generation })
        controller.signal.throwIfAborted()
        if (response.type !== 'document-prepared' || response.generation !== generation ||
            !Number.isSafeInteger(response.documentId) || response.documentId <= 0 ||
            !Number.isSafeInteger(response.bytes) || response.bytes <= 0 || response.bytes > 64 * 1024 * 1024 ||
            response.layerCount !== ticket.plan.layers.length) {
          throw new RustPixelPocError(response.type === 'error' ? response.code : 'wasm-failure')
        }
        prepared = this.prepared = { plan: ticket.plan, documentId: response.documentId, generation, bytes: response.bytes }
        this.counts.preparations++
      }
      const { documentId, generation } = prepared
      for (let y = 0; y < ticket.plan.height; y += 256) for (let x = 0; x < ticket.plan.width; x += 256) {
        controller.signal.throwIfAborted()
        const region = { x, y, width: Math.min(256, ticket.plan.width - x), height: Math.min(256, ticket.plan.height - y) }
        const tile = await connection.send({ type: 'compose-prepared-document', documentId, region, grid: ticket.plan.grid })
        if (tile.type !== 'rendered-prepared-document' || tile.documentId !== documentId || tile.generation !== generation ||
            tile.width !== region.width || tile.height !== region.height || !(tile.rgba instanceof ArrayBuffer) ||
            tile.rgba.byteLength !== region.width * region.height * 4 ||
            tile.region.x !== x || tile.region.y !== y || tile.region.width !== region.width || tile.region.height !== region.height) {
          throw new RustPixelPocError(tile.type === 'error' ? tile.code : 'wasm-failure')
        }
        controller.signal.throwIfAborted()
        ticket.paint(new Uint8Array(tile.rgba), region)
      }
      if (!reusable) {
        const released = await connection.send({ type: 'release-document', documentId })
        if (released.type !== 'document-released' || released.documentId !== documentId) {
          throw new RustPixelPocError(released.type === 'error' ? released.code : 'wasm-failure')
        }
        this.prepared = null
      }
    })()
    let abort = () => {}, succeeded = false, failure: unknown
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new RustPixelPocError('wasm-unavailable'))
      controller.signal.addEventListener('abort', abort, { once: true })
      if (controller.signal.aborted) abort()
    })
    try {
      timeout = setTimeout(() => { void this.dispose().catch(() => {}) }, this.timeoutMs)
      await Promise.race([work, aborted])
      succeeded = true
    } catch (error) {
      failure = error
      if (error instanceof RustPixelPocError && error.code === 'wasm-unavailable') {
        this.stop()
      }
    }
    finally {
      clearTimeout(timeout)
      try { if (!succeeded || controller.signal.aborted) await this.retire() }
      catch (error) {
        this.stop(); succeeded = false; failure = error
      }
      controller.signal.removeEventListener('abort', abort)
      if (this.active === controller) this.active = null
      if (controller.signal.aborted) { succeeded = false; failure = new RustPixelPocError('wasm-unavailable') }
      if (succeeded) { this.counts.rendered++; ticket.resolve() } else ticket.reject(failure)
      this.pump()
    }
  }
}
