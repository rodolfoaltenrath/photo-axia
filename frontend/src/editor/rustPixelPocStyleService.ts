import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_STYLE_WORKING_BYTES as WORKING_BYTES, rustPixelPocServiceLimits, snapshotRustPixelPocStyleRequest,
  type RustPixelPocServiceRequest, type RustPixelPocServiceLimits } from './rustPixelPocStyleInput.ts'
import { RustPixelPocStyleSession, RustPixelPocStyleCancelledError, type RustPixelPocSend } from './rustPixelPocStyleSession.ts'
import type { RustPixelPocConnection } from './rustPixelPocWorkerClient.ts'
export type { RustPixelPocServiceRequest, RustPixelPocServiceLimits } from './rustPixelPocStyleInput.ts'

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
  private readonly idleWaiters = new Set<() => void>()
  private retiring = Promise.resolve()

  constructor(connect: RustPixelPocConnect, limits: RustPixelPocServiceLimits = {}) {
    this.connect = connect
    this.limits = rustPixelPocServiceLimits(limits)
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
      const prepared = snapshotRustPixelPocStyleRequest(input)
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
    this.notifyIdle()
  }

  // A rejected visual promise does not mean decode/encode has drained.
  async whenIdle() {
    if (this.active || this.pending) await new Promise<void>(resolve => this.idleWaiters.add(resolve))
    await this.retiring
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
      this.notifyIdle()
    }
  }

  private ensureConnection() {
    if (this.context && !this.context.connection.closed) return Promise.resolve(this.context)
    if (this.context?.connection.closed) void this.retire()
    if (this.opening) return this.opening
    const epoch = ++this.epoch, controller = new AbortController()
    this.controller = controller
    const connected = Promise.resolve().then(async () => {
      await this.retiring
      if (controller.signal.aborted || epoch !== this.epoch || this.stopped) throw new RustPixelPocError('wasm-unavailable')
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
              if (Number.isSafeInteger(bytes) && bytes > 0 && bytes <= 64 * 1024 * 1024) this.sourceBytes = bytes
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
    this.retiring = Promise.all([this.retiring, connection?.terminate() ?? Promise.resolve()]).then(() => {})
    return this.retiring
  }

  private notifyIdle() {
    if (this.active || this.pending) return
    for (const resolve of this.idleWaiters) resolve()
    this.idleWaiters.clear()
  }
}
