import type { RustEditorialPlan, RustDocumentMediaInput } from './rustDocumentEditorial.ts'
import { rustStylePreviewPatternAssets } from './rustStylePreview.ts'
import { readRustStylePreviewBlob } from './rustStylePreviewMedia.ts'
import { rustPixelPocStyleMetadataBytes } from './rustPixelPocStyleInput.ts'
import type { RustPixelPocConnect } from './rustPixelPocStyleService.ts'
import type { RustPixelPocConnection } from './rustPixelPocWorkerClient.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'

export async function loadRustDocumentMedia(plan: RustEditorialPlan, signal: AbortSignal,
  read = readRustStylePreviewBlob): Promise<RustDocumentMediaInput> {
  const layers: RustDocumentMediaInput['layers'] = []
  let encoded = 0
  for (const layer of plan.layers) {
    signal.throwIfAborted()
    const patterns: Record<string, Blob> = Object.create(null)
    for (const asset of rustStylePreviewPatternAssets({ styles: layer.input.styles })) {
      const blob = await read(asset.sourceUrl, signal, 32 * 1024 * 1024 - encoded)
      encoded += blob.size; patterns[asset.id] = blob
    }
    const source = layer.source.type !== 'raster' ? layer.source :
      { type: 'raster' as const, blob: await read(layer.source.url, signal, 32 * 1024 * 1024 - encoded) }
    if (source.type === 'raster') encoded += source.blob.size
    if (encoded > 32 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
    layers.push({ ...layer, source, patterns })
  }
  signal.throwIfAborted()
  return { ...plan, layers }
}

type Paint = (rgba: Uint8Array<ArrayBuffer>, region: RustPixelPocRegion) => void
type Ticket = { plan: RustEditorialPlan; paint: Paint; resolve(): void; reject(error: unknown): void }

/** One bounded offscreen transaction at a time; no resident Worker between jobs. */
export class RustDocumentOffscreen {
  private pending: Ticket[] = []
  private active: AbortController | null = null
  private stopped = false
  private connection: RustPixelPocConnection | null = null
  private running: Promise<void> | null = null
  private readonly connect: RustPixelPocConnect
  private readonly load: typeof loadRustDocumentMedia
  private readonly timeoutMs: number
  constructor(connect: RustPixelPocConnect, load = loadRustDocumentMedia, timeoutMs = 30_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new RustPixelPocError('invalid-input')
    this.connect = connect; this.load = load; this.timeoutMs = timeoutMs
  }
  render(plan: RustEditorialPlan, paint: Paint): Promise<void> {
    if (this.stopped) return Promise.reject(new RustPixelPocError('wasm-unavailable'))
    try {
      if (this.pending.length >= 3 || rustPixelPocStyleMetadataBytes(plan) > 1024 * 1024) throw new RustPixelPocError('memory-limit')
      const snapshot = structuredClone(plan)
      const result = new Promise<void>((resolve, reject) => this.pending.push({ plan: snapshot, paint, resolve, reject }))
      this.pump(); return result
    } catch (error) { return Promise.reject(error) }
  }
  async dispose() {
    this.stopped = true; this.active?.abort()
    for (const ticket of this.pending.splice(0)) ticket.reject(new RustPixelPocError('wasm-unavailable'))
    await this.connection?.terminate()
    await this.running
  }
  private pump() {
    if (this.active || this.stopped) return
    const ticket = this.pending.shift(); if (!ticket) return
    const controller = this.active = new AbortController()
    this.running = this.run(ticket, controller)
  }
  private async run(ticket: Ticket, controller: AbortController) {
    let timeout: ReturnType<typeof setTimeout> | undefined, connection: RustPixelPocConnection | undefined
    let documentId: number | undefined
    const work = (async () => {
      const input = await this.load(ticket.plan, controller.signal)
      controller.signal.throwIfAborted()
      connection = await this.connect(controller.signal)
      if (controller.signal.aborted) { await connection.terminate(); controller.signal.throwIfAborted() }
      this.connection = connection
      const prepared = await connection.send({ type: 'prepare-document-media', input, generation: 1 })
      if (prepared.type !== 'document-prepared') throw new RustPixelPocError(prepared.type === 'error' ? prepared.code : 'wasm-failure')
      documentId = prepared.documentId
      for (let y = 0; y < ticket.plan.height; y += 256) for (let x = 0; x < ticket.plan.width; x += 256) {
        controller.signal.throwIfAborted()
        const region = { x, y, width: Math.min(256, ticket.plan.width - x), height: Math.min(256, ticket.plan.height - y) }
        const tile = await connection.send({ type: 'compose-prepared-document', documentId, region })
        if (tile.type !== 'rendered-prepared-document' || tile.documentId !== documentId || tile.generation !== 1 ||
            tile.width !== region.width || tile.height !== region.height || !(tile.rgba instanceof ArrayBuffer) ||
            tile.rgba.byteLength !== region.width * region.height * 4 ||
            tile.region.x !== x || tile.region.y !== y || tile.region.width !== region.width || tile.region.height !== region.height) {
          throw new RustPixelPocError(tile.type === 'error' ? tile.code : 'wasm-failure')
        }
        controller.signal.throwIfAborted()
        ticket.paint(new Uint8Array(tile.rgba), region)
      }
    })()
    let abort = () => {}, succeeded = false, failure: unknown
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new RustPixelPocError('wasm-unavailable'))
      controller.signal.addEventListener('abort', abort, { once: true })
    })
    try {
      timeout = setTimeout(() => { void this.dispose().catch(() => {}) }, this.timeoutMs)
      await Promise.race([work, aborted])
      succeeded = true
    } catch (error) {
      failure = error
      if (error instanceof RustPixelPocError && error.code === 'wasm-unavailable') {
        this.stopped = true
        for (const waiting of this.pending.splice(0)) waiting.reject(error)
      }
    }
    finally {
      clearTimeout(timeout)
      if (connection && !connection.closed && documentId !== undefined && !controller.signal.aborted) {
        try { await connection.send({ type: 'release-document', documentId }) } catch {}
      }
      try { await connection?.terminate() }
      catch (error) {
        this.stopped = true; succeeded = false; failure = error
        for (const waiting of this.pending.splice(0)) waiting.reject(new RustPixelPocError('wasm-unavailable'))
      }
      controller.signal.removeEventListener('abort', abort)
      if (this.connection === connection) this.connection = null
      if (this.active === controller) this.active = null
      if (controller.signal.aborted) { succeeded = false; failure = new RustPixelPocError('wasm-unavailable') }
      if (succeeded) ticket.resolve(); else ticket.reject(failure)
      this.pump()
    }
  }
}
