import type { LayerStyleWorkerSource } from './layerStyleRenderProtocol.ts'
import { prepareRustStyleAssets, validateRustStyleMediaSource } from './rustPixelPocMedia.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'
import { rustStylePngLayout } from './rustPixelPocPng.ts'
import { prepareRustStyleSourceLayout, type RustPixelPocStyleSourceInput } from './rustPixelPocStylePreparation.ts'
import { RustPixelPocStyleSession, RustPixelPocStyleCancelledError, type RustPixelPocSend } from './rustPixelPocStyleSession.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { RustPixelPocConnection } from './rustPixelPocWorkerClient.ts'

const MiB = 1024 * 1024
const WORKING_BYTES = 96 * MiB
const METADATA_BYTES = 4 * MiB

export interface RustPixelPocServiceRequest extends RustPixelPocStyleSourceInput {
  source: LayerStyleWorkerSource
  patterns?: Record<string, Blob>
  region?: RustPixelPocRegion
}

export interface RustPixelPocServiceLimits {
  maxResidentBytes?: number
  maxResultBytes?: number
  maxLeases?: number
  taskTimeoutMs?: number
}

export interface RustPixelPocResultLease {
  readonly result: Readonly<Awaited<ReturnType<RustPixelPocStyleSession['composeMediaPng']>>>
  release(): void
}

type Ticket = {
  request: RustPixelPocServiceRequest; inputBytes: number; settled: boolean; renderId?: number
  resolve: (lease: RustPixelPocResultLease) => void; reject: (error: unknown) => void
}
type Context = { connection: RustPixelPocConnection; session: RustPixelPocStyleSession }
export type RustPixelPocConnect = (signal: AbortSignal) => Promise<RustPixelPocConnection>

function metadataBytes(value: unknown) {
  let bytes = 0, nodes = 0
  function visit(item: unknown, depth: number) {
    if (++nodes > 100_000 || depth > 16) throw new RustPixelPocError('memory-limit')
    if (typeof item === 'string') bytes += item.length * 2
    else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) { bytes += key.length * 2; visit(child, depth + 1) }
    } else bytes += 8
    if (bytes > METADATA_BYTES) throw new RustPixelPocError('memory-limit')
  }
  visit(value, 0)
  return bytes
}

function snapshot(input: RustPixelPocServiceRequest) {
  if (!input || typeof input.sourceIdentity !== 'string' || input.sourceIdentity.length > 4096) {
    throw new RustPixelPocError('invalid-input')
  }
  validateRustStyleMediaSource(input.source)
  const layout = prepareRustStyleSourceLayout(input)
  const region = input.region ? { ...input.region } : { x: 0, y: 0, width: layout.width, height: layout.height }
  if (![region.x, region.y, region.width, region.height].every(Number.isSafeInteger) ||
      region.x < 0 || region.y < 0 || region.width <= 0 || region.height <= 0 ||
      region.x + region.width > layout.width || region.y + region.height > layout.height) throw new RustPixelPocError('invalid-input')
  const patterns = { ...input.patterns }
  const assets = prepareRustStyleAssets(layout, patterns)
  rustStylePngLayout(region.width, region.height, layout.width * layout.height * 4 + assets.decodedBytes)
  const metadata = { sourceIdentity: input.sourceIdentity, styles: layout.styles, globalLight: layout.light,
    text: input.source.type === 'text' ? input.source.text : null, region }
  const bytes = metadataBytes(metadata) + metadataBytes(Object.keys(patterns))
  if (bytes > METADATA_BYTES) throw new RustPixelPocError('memory-limit')
  const copy = structuredClone(metadata)
  const source: LayerStyleWorkerSource = input.source.type === 'raster' ? { type: 'raster', blob: input.source.blob } :
    { type: 'text', text: copy.text!, drawScaleX: input.source.drawScaleX, drawScaleY: input.source.drawScaleY }
  const request: RustPixelPocServiceRequest = { sourceIdentity: copy.sourceIdentity, sourceWidth: layout.sourceWidth,
    sourceHeight: layout.sourceHeight, styles: copy.styles, globalLight: copy.globalLight,
    resolutionScale: layout.scale, quality: layout.quality, source, region, patterns }
  return { request, inputBytes: bytes + (source.type === 'raster' ? source.blob.size : 0) +
    Object.values(patterns).reduce((total, blob) => total + blob.size, 0) }
}

/** Experimental: one consumer, one Worker, one active and one latest pending job. */
export class RustPixelPocStyleService {
  private readonly connect: RustPixelPocConnect
  private readonly limits: Required<RustPixelPocServiceLimits>
  private context: Context | null = null
  private opening: Promise<Context> | null = null
  private controller: AbortController | null = null
  private epoch = 0
  private stopped = false
  private disposal: Promise<void> | null = null
  private active: Ticket | null = null
  private pending: Ticket | null = null
  private sourceBytes = 0
  private resultBytes = 0
  private readonly leases = new Map<symbol, number>()

  constructor(connect: RustPixelPocConnect, limits: RustPixelPocServiceLimits = {}) {
    this.connect = connect
    this.limits = { maxResidentBytes: limits.maxResidentBytes ?? 256 * MiB,
      maxResultBytes: limits.maxResultBytes ?? 64 * MiB, maxLeases: limits.maxLeases ?? 64,
      taskTimeoutMs: limits.taskTimeoutMs ?? 30_000 }
    const values = this.limits
    if (!Object.values(values).every(value => Number.isSafeInteger(value) && value > 0) ||
        values.maxResidentBytes < WORKING_BYTES || values.maxResidentBytes > 512 * MiB ||
        values.maxResultBytes > 64 * MiB || values.maxLeases > 64 || values.taskTimeoutMs > 60_000) {
      throw new RustPixelPocError('invalid-input')
    }
  }

  get stats() {
    return { active: Number(!!this.active), pending: Number(!!this.pending), sourceBytes: this.sourceBytes,
      retainedResultBytes: this.resultBytes, leases: this.leases.size,
      reservedBytes: this.resultBytes + (this.active ? WORKING_BYTES + this.active.inputBytes : this.sourceBytes) +
        (this.pending?.inputBytes ?? 0), disposed: this.stopped }
  }

  render(input: RustPixelPocServiceRequest): Promise<RustPixelPocResultLease> {
    if (this.stopped) return Promise.reject(new RustPixelPocError('wasm-unavailable'))
    this.cancel()
    try {
      const prepared = snapshot(input)
      if (this.stats.reservedBytes + prepared.inputBytes > this.limits.maxResidentBytes ||
          WORKING_BYTES + prepared.inputBytes + this.resultBytes > this.limits.maxResidentBytes) {
        throw new RustPixelPocError('memory-limit')
      }
      const promise = new Promise<RustPixelPocResultLease>((resolve, reject) => {
        this.pending = { ...prepared, settled: false, resolve, reject }
      })
      this.pump()
      return promise
    } catch (error) { return Promise.reject(error instanceof RustPixelPocError ? error : new RustPixelPocError('invalid-input')) }
  }

  cancel() {
    if (this.pending) { this.reject(this.pending, new RustPixelPocStyleCancelledError()); this.pending = null }
    if (this.active && !this.active.settled) {
      this.reject(this.active, new RustPixelPocStyleCancelledError())
      this.context?.session.cancelPendingRender()
      if (this.active.renderId !== undefined) this.context?.connection.cancel(this.active.renderId)
    }
  }

  async invalidate() {
    this.cancel()
    const context = this.context
    if (!context) { await this.retire(); return }
    try { await context.session.invalidate() }
    catch (error) { if (this.context === context) await this.retire(); throw error }
  }

  dispose() {
    if (this.disposal) return this.disposal
    this.stopped = true
    this.cancel()
    this.disposal = this.retire()
    return this.disposal
  }

  private reject(ticket: Ticket, error: unknown) {
    if (!ticket.settled) { ticket.settled = true; ticket.reject(error) }
  }

  private pump() {
    if (this.active || !this.pending || this.stopped) return
    const ticket = this.pending
    this.pending = null
    if (WORKING_BYTES + ticket.inputBytes + this.resultBytes > this.limits.maxResidentBytes) {
      this.reject(ticket, new RustPixelPocError('memory-limit')); return
    }
    this.active = ticket
    void this.run(ticket)
  }

  private async run(ticket: Ticket) {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const deadline = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => { void this.retire(); reject(new RustPixelPocError('wasm-unavailable')) }, this.limits.taskTimeoutMs)
      })
      const work = (async () => {
        const context = await this.ensureConnection()
        if (ticket.settled || this.stopped) throw new RustPixelPocStyleCancelledError()
        return context.session.composeMediaPng({ ...ticket.request, source: async () => ticket.request.source })
      })()
      const result = await Promise.race([work, deadline])
      if (ticket.settled || this.stopped) return
      const bytes = result.blob.size
      if (this.resultBytes + bytes > this.limits.maxResultBytes || this.leases.size >= this.limits.maxLeases ||
          this.sourceBytes + this.resultBytes + bytes + (this.pending?.inputBytes ?? 0) > this.limits.maxResidentBytes) {
        throw new RustPixelPocError('memory-limit')
      }
      const token = Symbol()
      this.leases.set(token, bytes); this.resultBytes += bytes
      ticket.settled = true
      ticket.resolve({ result: Object.freeze({ ...result, encoding: Object.freeze({ ...result.encoding }),
        timings: Object.freeze({ ...result.timings }) }), release: () => {
        const retained = this.leases.get(token)
        if (retained !== undefined) { this.leases.delete(token); this.resultBytes -= retained }
      } })
    } catch (error) {
      if (error instanceof RustPixelPocError && error.code === 'wasm-unavailable' || this.context?.connection.closed) await this.retire()
      this.reject(ticket, error)
    } finally {
      clearTimeout(timeout)
      if (this.active === ticket) this.active = null
      this.pump()
    }
  }

  private ensureConnection() {
    if (this.context && !this.context.connection.closed) return Promise.resolve(this.context)
    if (this.context?.connection.closed) void this.retire()
    if (this.opening) return this.opening
    const epoch = ++this.epoch, controller = new AbortController()
    this.controller = controller
    const connected = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new RustPixelPocError('wasm-unavailable')
      return this.connect(controller.signal)
    }).then(connection => {
      if (this.stopped || epoch !== this.epoch || controller.signal.aborted || connection.closed) {
        void connection.terminate(); throw new RustPixelPocError('wasm-unavailable')
      }
      const send: RustPixelPocSend = (request, transfers) => {
        const operation = connection.send(request, transfers)
        if (request.type === 'style-media-staged-png' && this.active) this.active.renderId = operation.id
        const tracked = operation.then(response => {
          if (this.context?.connection === connection) {
            if (response.type === 'source-invalidated') this.sourceBytes = 0
            else if (response.type === 'source-staged' && response.prepared) {
              const bytes = response.prepared.width * response.prepared.height * 4
              if (Number.isSafeInteger(bytes) && bytes > 0 && bytes <= 64 * MiB) this.sourceBytes = bytes
            }
          }
          return response
        })
        return Object.assign(tracked, { id: operation.id })
      }
      this.context = { connection, session: new RustPixelPocStyleSession(send) }
      return this.context
    })
    let onAbort = () => {}
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new RustPixelPocError('wasm-unavailable'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    const opening = Promise.race([connected, aborted]).finally(() => {
      controller.signal.removeEventListener('abort', onAbort)
      if (this.opening === opening) this.opening = null
    })
    this.opening = opening
    return opening
  }

  private retire() {
    this.epoch++
    this.controller?.abort(); this.controller = null
    this.context?.session.cancelPendingRender()
    const connection = this.context?.connection
    this.context = null; this.opening = null; this.sourceBytes = 0
    return connection?.terminate() ?? Promise.resolve()
  }
}
